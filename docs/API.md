# 浏览器 SDK 与运行接口 v2

Core 提供通用场景、播放会话、参数保存和插件事件传输，不提供 OBS、弹幕或暂离业务模型。原生 Contracts SDK 仍为 major 1。

## 客户端与播放会话

~~~js
import {createClient, getSceneContext} from '/sdk/streamui.js';
const client = createClient();
const context = getSceneContext();
client.onState(state => {});
client.on('plugin.my-plugin.status', value => {});
client.start();
~~~

场景和扩展参数页通过 URL 获得 sceneId、presetId、pluginId、preview 和 previewId。createClient 自动继承当前 previewId；普通输出没有 previewId。也可显式 createClient({baseUrl, previewId})。

公开状态包含 apiVersion:2、scenes、scene、preset、plugins、preview、outputUrl、configUrl、startup。scene 包含 activeId、previousId、revision、playback；playback 为 null 或 {id,startedAt,animate}。这里没有 obs、chat 或 away 字段。

client.selectScene(id, {animate, cue, startedAt}) 选择该客户端所属会话的场景；animate 默认为 true。预览客户端只改变预览。外部能力事件可提供稳定 cue，多个输出页面对同一事件的请求只执行一次；startedAt 让场景动效加入同一个时钟。晚到的旧 cue 不会覆盖较新的播放。

client.on('scene.enter', callback) 和 scene.leave 是播放器发送的页面生命周期事件。同一 runtimeGroup 的视图复用 iframe，也会收到新的 scene.enter 和场景上下文。client.stop() 关闭事件与二进制订阅。

## 预览

配置端口 POST /api/previews 创建 {id,state}。GET /api/state?preview=<id>、WebSocket /ws/events?preview=<id> 和 POST /api/actions/scene?preview=<id> 使用该会话。DELETE /api/previews/<id> 释放它。预览是临时状态，不写入实际输出的选择；独立配置页的预览互不影响。

输出页面使用 /?preview=<id> 作为预览播放器地址，普通 / 始终表示实际输出。场景中的 SDK 自动使用父播放器传入的 streamuiPreview。能力组件必须根据 getSceneContext().preview 判断是否执行真实自动联动；预览不响应外部 OBS 切换。

预览隔离主场景播放状态；持久化参数仍由相应场景、预设或插件共享。Host 控件可用预设共享参数控制覆盖效果，而不调用 selectScene。

场景的 role 默认为 scene；overlay 描述仅用于配置，不进入主场景下拉，也不能作为 selectScene 的目标。覆盖层的组成和显隐由预设自行实现。选择“场景配置”中的条目只改变编辑对象，不改变预览或输出。

## 参数

~~~js
import {createClient, getSceneContext, createAutoSave} from '/sdk/streamui.js';
const settings = createClient().settings('scene', getSceneContext().sceneId);
const values = await settings.read();
const save = createAutoSave(patch => settings.patch(patch), {
  onStatus: status => {},
  onError: error => {},
});
input.oninput = () => { if (input.checkValidity()) save.update({myText:input.value}); };
input.onchange = () => { if (input.checkValidity()) save.update({myText:input.value}, true); };
addEventListener('pagehide', () => void save.flush().catch(() => {}));
~~~

字段由扩展定义。支持 scene、preset、plugin 三种 scope。read 返回作者默认值与用户覆盖的合并结果；patch 只递归合并提供的字段，数组整体替换，null 是明确值；save / PUT 替换整个覆盖对象。场景和预设保存时剔除与作者默认值相同的字段，因此修改一个文字不会固定其余默认布局。

createAutoSave 合并约 300 ms 的连续输入，第二参数 true 立即提交。写入按顺序完成，失败保留待保存字段，下次 update 或 flush 可重试。不要在单项编辑时发送初始化时读到的完整快照。

配置页从扩展的 settingsPage 加载 HTML，自动适应其内容高度。场景、预设和插件分别收到对应 ID。preset.sidebarPage 可提供侧栏控件，并获得当前配置页的 previewId；Core 不解释控件含义。

## 插件能力

插件发布的 JSON 事件名为 plugin.<id>.<topic>。plugins[].topics 包含每个 topic 的最新公开值，便于新页面取得初始状态。私有设置不会出现在公开状态。

client.binary(pluginId, topic, callback) 订阅插件定义的二进制帧，返回关闭订阅函数。事件和二进制传输不解释业务内容。

官方能力约定见各自插件 README：obs-scenes 报告当前 OBS 场景和场景变化事件，laplace 发布标准化弹幕；场景组件负责使用这些事件。

## HTTP

输出与配置端口仅监听回环地址，默认 5280、5281。写请求必须包含 X-StreamUI-Request:1。

公开接口：
- GET /api/state
- GET /api/scenes/<id>/settings、GET /api/presets/<id>/settings
- POST /api/actions/scene
- WebSocket /ws/events、/ws/plugins/<id>/<topic>
- /user/scenes/...、/user/presets/...、/sdk/streamui.js

配置端口额外提供：
- GET、PUT、PATCH /api/settings，仅允许 enabledPlugins
- GET /api/presets、POST /api/presets/reload、POST /api/presets/activate
- POST /api/previews、DELETE /api/previews/<id>
- PUT、PATCH /api/scenes/<id>/settings、/api/presets/<id>/settings
- GET、PUT、PATCH /api/plugins/<id>/settings
- POST /api/plugins/reload、GET /api/storage
- PUT /api/startup、POST /api/open/<page>、POST /api/shutdown

没有 OBS、弹幕或暂离专用 API。scene.enter / leave 与转场 play({container,from,to,covered,signal}) 协议保持不变。转场完全遮盖时调用 covered()，完成时返回；取消响应 signal，最长 15 秒。
