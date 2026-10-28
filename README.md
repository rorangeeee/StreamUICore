# StreamUICore

Windows x64 本地直播场景宿主。Core 提供 OBS 连接、弹幕事件、场景协调、预设加载和能力插件接口；场景布局、素材、组件与转场由外置预设实现。

**Host 本体不包含任何预设或音频/媒体插件。首次启动不启用预设，不加载场景或预设参数页。**

## 运行与安装预设

运行 `StreamUI Core.exe` 后，打开 <http://127.0.0.1:5281/>。OBS 浏览器输出地址为 <http://127.0.0.1:5280/>。

将他人提供的预设文件夹放到 EXE 旁的 `presets/<id>/`，每个预设必须带 `preset.json`。需要能力插件时，单独安装到 `plugins/<id>/`。这两个目录均不在 Host 本体中。

在「预览」刷新预设列表，选择预设并点击「应用预设」。扫描只读取清单，不会自动启用；只有明确应用后才登记场景、启动所需的已安装插件和加载参数页。选「不启用预设」并应用会清空输出，关闭由预设启动的插件。已有场景通过场景下拉框切换，暂离使用独立的暂离开关。

配置页只调整 OBS、弹幕、插件和预设开放的主播参数。场景定义、画布、素材、转场等固定内容由作者预先做好，不提供场景增删或结构编辑接口。

## 当前独立示例

源码仓库单独放置两个可移出的示例目录，Host 打包不会收进这些目录：

- `presets/minimal/`：不依赖插件的直播、暂离和淡入淡出转场。
- `presets/latenite/`：3840 × 2160 个人双布局，包含 21:9、16:9 和暂离。双布局共用常驻运行页面，保留弹幕与动画状态。依赖 `desktop-audio` 和 `system-media` 两个外置插件。

LATENITE 的源代码位于 `preset-sources/latenite/`，构建结果直接位于独立预设的 `ui/`。布局、标题及暂离默认值在预设自己的 `defaults.json`，没有 OBS 密码、弹幕 Token 或本机音频设备 ID。要获得与原布局相同的字体效果，需在本机安装 Retro Pixel、405 SS 像素体、Blue Screen Personal Use、JetBrains Mono 等原布局字体；字体未随预设分发。

## 从源码构建

需要 Node.js 22.18+、.NET 10 SDK 和 Windows x64。

```powershell
npm ci
npm run host:package
```

这只构建 Core，不构建或打包预设及插件。按需单独构建扩展：

```powershell
npm run presets:build
npm run plugins:build
powershell.exe -NoProfile -File scripts/package-extras.ps1
```

`scripts/package-release.ps1` 生成只含 Host EXE 和运行说明的发布 ZIP，并校验没有预设。`scripts/package-extras.ps1` 分别生成 `latenite.preset.zip`、`minimal.preset.zip`、`optional-capability-plugins.zip`。

## 数据与接口

默认参数保存在 `%LOCALAPPDATA%/StreamUICore`；EXE 旁已存在 `.local/core-data` 时使用该本地数据目录。`npm run host` 使用工程自己的 `.local/core-data`。预设始终默认从 EXE 旁 `presets/` 扫描。

- `core-settings.json`：本机连接偏好、已选预设、场景选择和插件偏好。
- `preset-settings/<id>.json`：主播的参数覆盖，和作者的预设文件分离；读参数时与作者默认值合并。
- `scene-settings/`：兼容独立场景参数。
- `plugins/`、`plugin-settings/`、`plugin-data/`：安装的能力插件及其本机状态。

EXE 旁 `plugins/` 的已编译插件首次运行时复制到用户插件目录，已有用户插件不会被覆盖，也不会自动启动。更新已安装插件时请替换用户目录中的相应插件文件。

可用 `--data-dir`、`--presets-dir`、`--plugins-dir` 指定独立目录，用 `--obs-port`、`--config-port` 指定端口。两个 HTTP 端口仅监听本机回环地址。

预设格式见 [docs/PRESETS.md](docs/PRESETS.md)，SDK、转场与能力插件接口见 [docs/API.md](docs/API.md)。

## 验证

```powershell
npm test
npm run host:test
node tests/presets-integration.mjs 'StreamUI Core.exe'
```

测试使用独立用户目录、本机模拟 OBS/弹幕及随机或测试端口，不操作真实 OBS。预设集成测试需要先单独构建预设和插件。

独立项目来源见 [docs/ORIGIN.md](docs/ORIGIN.md)。
