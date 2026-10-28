# StreamUI 接口 v1

## 场景槽位

每个槽位包含 id、name、entry、obsScene、width、height、transition、settingsPage。ID 使用小写字母、数字、横线或下划线；入口、转场和设置页均是用户目录下 scenes/ 内的相对路径。

这些结构由开发者在启动前写入用户目录的 core-settings.json。scenes 是固定槽位列表，selectedSceneId 是初始选择，away.sceneId 是固定暂离场景。运行时配置页和 HTTP 接口不创建、删除或修改槽位；主播仅切换现有场景及调整场景自定义参数。

entry 为 HTML，transition 为可选的 JavaScript 模块，settingsPage 为可选的 HTML 配置面板。核心不保存标题、颜色、组件树或几何数据。

场景播放时，入口 URL 附带 streamuiScene 和 streamuiPreview 参数。设置页也附带 streamuiScene；插件设置页附带 streamuiPlugin。

## 浏览器客户端

~~~js
import { createClient, getSceneContext } from '/sdk/streamui.js';
const client = createClient();
const context = getSceneContext();
const off = client.on('chat.message', data => {});
client.onState(state => {});
client.start();
// 释放订阅或离开页面：
off();
client.stop();
~~~

客户端维护一条事件 WebSocket，自动重连。onState 在已有快照时立即调用订阅者；新连接获得当前快照。公开快照不包含 OBS 密码、弹幕 Token 或插件私有设置。

外置预设格式和独立打包边界见 PRESETS.md。Host 新用户默认没有场景或已选预设；只有明确应用清单后才登记它的固定场景。

事件：

- chat.message、chat.gift、chat.superchat：标准化弹幕事件。
- chat.status、obs.status：连接状态。
- obs.sceneChanged：实际输出场景名称。
- scene.changed：当前槽位及暂离状态。
- away.changed：暂离开关。
- scene.enter、scene.leave：播放器交接场景时发出的生命周期事件。
- scene.settingsChanged：场景独立配置发生变化。
- preset.settingsChanged：预设共享参数发生变化。
- plugin.<id>.<topic>：能力插件发布的事件。

on 返回取消订阅函数。scene.enter / scene.leave 来自同源播放器父页面。预加载期间客户端可接收数据，进入/退出时机由生命周期事件区分。

client.selectScene(id) 手动选择槽位并退出暂离。
client.setAway(enabled) 进入或退出暂离。
client.settings('scene', id).read() 读取场景配置。
client.settings('scene', id).save(object) 在配置端口保存该场景配置。
client.settings('plugin', id) 访问插件配置，只在配置端口可用。
client.settings('preset', id) 读取预设默认值与用户覆盖合并后的参数，只在配置端口可保存。
client.binary(pluginId, topic, callback) 订阅插件二进制帧，返回关闭订阅函数。

## 弹幕结构

~~~json
{
  "id": "bilibili:message:123",
  "kind": "message",
  "platform": "bilibili",
  "timestamp": 1700000000000,
  "user": { "id": "1", "name": "观众", "level": 12, "medalName": null, "medalLevel": null },
  "text": "你好",
  "gift": null,
  "payment": null
}
~~~

礼物的 gift 包含 name 和 count；SC 的 payment 包含标准化 amount 和 currency。金额未知时为 null。时间统一为毫秒；接口不生成展示文案或规定排队和打字效果。

## 转场

~~~js
export async function play({ container, from, to, covered, signal }) {
  // 在 container 中绘制覆盖动画。
  // 完全遮住画面时调用 covered()，播放器此时交接两个场景。
  // 动画结束后返回。
}
~~~

初次加载直接进入场景。已选择的目标未变时不会重建页面。新切换会取消尚未完成的旧切换；转场需响应 AbortSignal 并释放动画。covered() 只提交一次；模块完成前未调用它会报告错误并保留原场景。执行上限 15 秒。

这里协调的是网页场景交接。OBS 视频源之间的覆盖时序由 OBS 转场承担。

## 暂离

暂离是对显示槽位的临时覆盖，保留正常选中的槽位。返回时显示该槽位。暂离期间 OBS 的匹配场景变化会更新正常槽位，返回后与实际 OBS 输出一致。手动切换场景会退出暂离。

暂离页面、倒计时、提示文字及其他表现由用户场景实现。

## 原生能力插件

配置面板可以引用 /config-appearance.js 和 /config-theme.css，跟随宿主的外观选择。配色使用 --surface、--field、--text、--muted、--border、--accent 等 CSS 变量；外观偏好独立于场景和插件的 JSON 设置。

参照 contracts/IStreamUIPlugin.cs。插件是实现 IStreamUIPlugin 的 .NET 10 类，StartAsync 启动后台工作并及时返回，停止时取消令牌并调用 DisposeAsync。保存插件设置会重新创建该实例。

插件文件放入用户 plugins/<id>/，清单 plugin.json：

~~~json
{
  "id": "uptime",
  "name": "系统运行时间",
  "version": "1.0.0",
  "assembly": "Uptime.dll",
  "type": "StreamUI.Examples.UptimePlugin",
  "capabilities": ["system.uptime"],
  "settingsPage": "settings.html"
}
~~~

IPluginContext 提供 ID、独立数据目录、只读 JSON 设置，以及 Publish(topic, data)、PublishBinary(topic, bytes)。JSON 事件名自动加上 plugin.<id>. 前缀；二进制流由 client.binary(id, topic, callback) 订阅，慢客户端丢弃旧帧。二进制格式由插件定义。

插件配置页通过 SDK 保存自己的 JSON，核心不解释字段。原生插件以当前用户权限运行；此机制不提供代码沙箱。

~~~sh
dotnet build examples/plugins/uptime/Uptime.csproj -c Release
~~~

将生成目录中的文件及示例 plugin.json、settings.html 放入用户 plugins/uptime/，在配置页刷新并启用。

## HTTP 与端口

公开输出端口：5280。配置端口：5281。两者仅监听回环地址。

公开接口：
- GET /api/state
- GET /api/scenes/<id>/settings
- GET /api/presets/<id>/settings
- POST /api/actions/scene，正文 { "id": "live" }
- POST /api/actions/away，正文 { "enabled": true }
- WebSocket /ws/events
- WebSocket /ws/plugins/<id>/<topic>
- /user/scenes/...、/user/plugins/...、/sdk/streamui.js

配置端口额外接口：
- GET /api/settings、PUT /api/settings
- GET /api/presets、POST /api/presets/reload、POST /api/presets/activate
- PUT /api/presets/<id>/settings
- PUT /api/scenes/<id>/settings
- GET /api/plugins/<id>/settings、PUT /api/plugins/<id>/settings
- POST /api/plugins/reload
- POST /api/obs/reconnect、POST /api/chat/reconnect
- GET /api/storage
- PUT /api/startup
- POST /api/open/obs、config、data、plugins
- POST /api/shutdown

写请求使用 JSON 正文及 X-StreamUI-Request: 1。设置变更只更新对应配置文件；用户场景源码和素材不由这些接口改写。

GET /api/settings 和 PUT /api/settings 仅包含 obs、laplace 和 enabledPlugins。PUT 会拒绝 scenes、selectedSceneId、away 等结构字段；保存连接或插件偏好不会改动预制槽位、当前选择或暂离状态。场景切换和暂离使用 /api/actions/scene、/api/actions/away；场景参数继续使用 /api/scenes/<id>/settings，设置页应通过 getSceneContext().sceneId 绑定当前 ID。

POST /api/presets/activate 使用 `{ "id": "latenite" }` 应用已安装预设，`{ "id": null }` 停用。它仅在配置端口可用。预设目录默认在 EXE 旁，通过 --presets-dir 可指定其他目录；预设和能力插件不包含在 Host EXE 或 Host 发布 ZIP 中。
