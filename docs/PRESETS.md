# 外置预设格式 v1 / 浏览器 SDK 2

预设以独立源码仓库分发，构建后由 Core 从 presets/<id>/preset.json 发现。Core 不携带场景，也不自动执行扩展构建脚本。

~~~json
{
  "formatVersion":1,"sdkVersion":2,
  "id":"my-preset","name":"我的直播间","version":"1.0.0",
  "defaultScene":"live","defaults":"defaults.json","sidebarPage":"sidebar.html",
  "scenes":[
    {"id":"live","name":"直播","entry":"ui/index.html","settingsPage":"settings/live.html","defaults":"defaults/live.json","width":1920,"height":1080,"view":"live","runtimeGroup":"overlay"},
    {"id":"pause","name":"覆盖层配置","role":"overlay","entry":"ui/index.html","settingsPage":"settings/pause.html","defaults":"defaults/pause.json","width":1920,"height":1080,"view":"pause","runtimeGroup":"overlay"}
  ],
  "plugins":[],
  "build":{"kind":"vite","output":"ui"}
}
~~~

目录名与清单 id 相同，预设和局部场景 ID 使用 1–30 位小写字母、数字和横线。全局场景 ID 为 <preset-id>__<scene-id>。所有资源是仓库内的相对路径，不允许绝对路径、URL、.. 或符号链接。settingsPage、defaults、sidebarPage 可省略；构建后的入口和声明的文件必须存在。

## 场景参数与侧栏

每个场景通过自己的 defaults 定义作者参数，由 settingsPage 提供配置页面。用户覆盖保存在 scene-settings/<global-id>.json。根 defaults 和 settingsPage 可用于跨场景共享参数，与场景 scope 分开。

Core 不定义标题、颜色、OBS 场景名或暂离字段。参数页使用 getSceneContext().sceneId 读取该场景设置，并 PATCH 具体改动。保存只保留与当前作者默认值不同的覆盖，避免一个标题修改固定其余默认布局。

view 是预设作者的标记，Core 不解释它。role 默认为 scene，表示可播放主场景；role:overlay 保留独立配置和默认值，不可通过 selectScene 替换主场景。覆盖画面由预设运行页自行组合，Core 不另建覆盖 iframe。默认场景必须为主场景。

预设可用 sidebarPage 提供 Host 控件。LATENITE 的暂离开关更新共享预设参数 controls.away，实际输出和预览同步响应，不改变各自的主场景与播放时钟；暂离表现属于预设，Core 没有 awayScene 或暂离专用 API。

## 能力组件

plugins 声明独立能力依赖，例如：

~~~json
{"id":"obs-scenes","minimumVersion":"1.0.0","required":true,"repository":"https://github.com/rorangeeee/StreamUI-Plugin-ObsScenes.git","ref":"main"}
~~~

启用时检查并启动必需插件，扫描不会启动代码。OBS 插件只提供连接和事件。LATENITE 在各场景参数中声明 obsSceneName，其组件监听 plugin.obs-scenes.scene-changed；只有非空且匹配的场景才切换并播放动效。未匹配的事件不改变输出，也不播放动效。预览组件不执行实际 OBS 联动。

其他组件按需订阅 laplace、desktop-audio、system-media 数据。连接参数保存在插件 scope，视觉与业务逻辑不进入 Core。

## 常驻运行与动画

相同 runtimeGroup、entry 和画布尺寸的视图复用 iframe，通过 scene.leave / scene.enter 更新上下文，保留弹幕历史与动画时钟。scene.playback 包含通用 id、startedAt、animate，预设自行绘制连续动效。

普通场景可指定 transition 模块，导出 play({container,from,to,covered,signal})。动画遮住画面后调用 covered()，完成时返回，取消时释放动画；最长 15 秒。

透明输出根页面使用 color-scheme:normal，并显式设置 html,body 背景透明。深色配色只用于配置面板或局部控件。

## 更新

源码仓库结构见 REPOSITORIES.md。在安装仓库中修改、构建；修改清单后刷新并重新应用，修改源码后构建并刷新预览和 OBS。用户参数与作者文件分开。

Core 0.5 使用浏览器 SDK 2。旧预设不能再依赖 Core 的 obs、chat、away 字段，需改为自己的能力组件与场景实现。
