# 外置预设格式 v1

一个预设就是可以单独复制、压缩和分享的文件夹。Host 仅从 `presets/<id>/preset.json` 发现它；EXE 内没有默认预设。ZIP 是文件夹的分发形式，使用者解压到 `presets/` 即可，当前不实现联网下载或在线商店。

## 清单

```json
{
  "formatVersion": 1,
  "sdkVersion": 1,
  "id": "my-preset",
  "name": "我的直播间",
  "version": "1.0.0",
  "description": "说明",
  "defaultScene": "live",
  "awayScene": "away",
  "defaults": "defaults.json",
  "settingsPage": "settings.html",
  "plugins": [],
  "scenes": [
    {"id":"live","name":"直播","entry":"scenes/live.html","width":1920,"height":1080,"transition":"transitions/fade.js"},
    {"id":"away","name":"暂离","entry":"scenes/away.html","width":1920,"height":1080,"transition":"transitions/fade.js"}
  ]
}
```

目录名须与清单 `id` 相同。预设与局部场景 ID 使用 1–30 位小写字母、数字和横线。内部场景 ID 为 `<preset-id>__<scene-id>`，因此不同预设都叫 `live` 时仍可独立保存状态。版本使用 `1.0.0` 这样的数字版本。

所有入口均相对于本预设目录，不能使用绝对路径、`..`、URL、符号链接或跨目录资源路径。HTML、转场 JS、默认 JSON、参数页必须存在；当前支持 `formatVersion=1` 和 `sdkVersion=1`。无效预设显示不可用，不会影响其他预设或启动其代码。

可选 `plugins` 项形如 `{ "id": "desktop-audio", "minimumVersion": "1.0.0", "required": true }`。应用时检查已安装插件及版本；必需插件在明确应用后启动，停用预设后释放。用户自己显式启用的插件保持其独立偏好。扫描清单不会加载本机 DLL。

## 场景与参数

场景页面通过固定地址 `/sdk/streamui.js` 使用 Core SDK。`getSceneContext()` 返回当前的 `presetId`、全局 `sceneId` 和预览标记。清单的 `view` 是作者自定义的字符串，随场景元数据出现在公开状态中，Core 不解释其含义。

```js
import { createClient, getSceneContext } from '/sdk/streamui.js';
const client = createClient();
const context = getSceneContext();
const settings = client.settings('preset', context.presetId);
const values = await settings.read();
client.on('preset.settingsChanged', ({ id }) => {
  if (id === context.presetId) void settings.read().then(applyParameters);
});
client.start();
```

在配置端口的参数页中可以 `settings.save(object)`。作者的 `defaults.json` 始终不被修改；用户覆盖保存在独立数据目录的 `preset-settings/<id>.json`。对象递归合并，数组和基本值整体覆盖。参数页只在预设启用后出现在主播配置中。

OBS 密码、弹幕 Token、设备 ID 等本机偏好不属于预设默认值。示例中的 OBS 场景名只是可修改的绑定；应用前可编辑清单 `scenes[].obsScene`，或继续从预览手动切换。

## 转场与常驻运行组

每个场景可指定 `transition`，模块导出 `play({container,from,to,covered,signal})`。动画完全遮住输出时调用 `covered()`，完成时返回，取消时释放动画；最长 15 秒。普通场景交接加载新 iframe 并释放旧页面。

同一预设的多个视图可以设置相同的 `runtimeGroup` 和 `entry`，并使用相同画布尺寸。此时 Core 复用同一 iframe，通过 `scene.leave` / `scene.enter` 更新场景上下文，不重建页面。作者可在页面内部根据 `view` 或全局状态切布局并播放连续动画。`getSceneContext().sceneId` 在进入新视图后会更新。该机制可保留弹幕历史、音频连接与动画时钟。

LATENITE 使用该机制让 21:9、16:9 与暂离共用原有运行页面，像素转场由预设内部绘制。Core 的公开 `obs.transition` 包含转场 ID 和 `startedAt`，用于跟随 OBS 开始时钟；帧是否精确对齐仍需在实际 OBS 环境验收。

## 安装、使用与更新

复制预设文件夹后在预览刷新列表、明确应用。刷新不会更换正在显示的内容；停用后输出为空并卸载预设参数面板。新用户始终没有已选预设；已经明确选用的预设和场景在重启后恢复。预设被移走或依赖缺失时，重启会退回空输出并显示错误。

更新时替换作者的预设文件夹，用户数据目录保持独立。修改清单中的场景定义后重新应用或重启以登记新结构。预设文件是可执行前端代码，本机能力插件是独立 .NET 扩展，接口不提供本机代码沙箱。
