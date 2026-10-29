# StreamUICore

Windows x64 本地直播场景宿主。Core 提供 OBS、弹幕、场景协调、外置预设、能力插件和版本化 SDK。

**此仓库不携带官方插件或预设源码，也不把它们打进 Host。首次启动没有已安装预设、没有场景、没有音频或曲目抓取能力。** 测试目录中的最小夹具仅供自动验证，不作为扩展安装。

## 构建干净的 Core

需要 Windows x64、Node.js 22.18+、.NET 10 SDK。

~~~powershell
npm ci
npm run host:package
~~~

生成独立的 StreamUI Core.exe，以及供第三方插件引用的 sdk/native/StreamUI.Contracts.dll（SDK major 1）。Host 发布包只包含 Host 和运行说明；原生 SDK、插件和预设独立分发。

运行后配置页为 http://127.0.0.1:5281/，OBS 输出为 http://127.0.0.1:5280/。首次启动为空输出。

## 从三个独立仓库安装官方扩展

在 Core 目录运行：

~~~powershell
git clone https://github.com/rorangeeee/StreamUI-Plugin-DesktopAudio.git plugins/desktop-audio
git clone https://github.com/rorangeeee/StreamUI-Plugin-SystemMedia.git plugins/system-media
git clone https://github.com/rorangeeee/StreamUI-Preset-Latenite.git presets/latenite

powershell.exe -NoProfile -File plugins/desktop-audio/build.ps1 -SdkPath sdk/native
powershell.exe -NoProfile -File plugins/system-media/build.ps1 -SdkPath sdk/native

npm --prefix presets/latenite ci
npm --prefix presets/latenite run build
~~~

两个插件只引用独立 SDK DLL，不引用 Core 源码。预设只使用运行时 /sdk/streamui.js 与 SDK 1 类型定义，自带前端构建配置。

在配置页「预览」刷新预设列表，选择 LATENITE 并应用。扫描不会自动启用，也不会加载预设参数页或启动其插件。可切换 21:9、16:9，并用暂离开关进入或返回。配置页只负责主播参数，场景与转场由预设作者预先定义。

LATENITE 保留 3840 × 2160 双布局、常驻运行页面、弹幕历史、像素转场、暂离、频谱、示波器和曲目显示。字体不随预设分发；获得原外观需安装相同本机字体，详见预设仓库。

## 数据和更新

预设从 EXE 旁 presets/<id>/ 扫描，插件放在 plugins/<id>/。这两个安装目录被本仓库 Git 忽略，各自保留独立 Git 历史。

本机数据默认在 %LOCALAPPDATA%/StreamUICore；EXE 旁存在 .local/core-data 时使用它。npm run host 使用工程的 .local/core-data。

- core-settings.json：连接偏好、所选预设/场景、暂离和插件偏好。
- preset-settings/：主播参数覆盖，与预设作者默认值分离。
- plugin-settings/、plugin-data/：插件配置和持久化数据。

首次发现 EXE 旁已编译插件时复制到本机插件目录；不覆盖已有安装，不启动插件。复制时排除 Git、构建目录、依赖缓存和符号链接。更新已安装插件应替换用户目录对应文件。

可用 --data-dir、--presets-dir、--plugins-dir、--obs-port、--config-port 指定隔离实例。HTTP 仅监听回环地址。本轮支持独立 Git 仓库的手动 clone 与确定化构建，尚未实现配置页 Git URL 安装器。

## 开发与验证

~~~powershell
npm test
npm run host:test
node tests/presets-integration.mjs 'StreamUI Core.exe'
~~~

Core 的自动验证仅用合成预设和探针插件，不依赖官方扩展。预设自身的适配测试位于独立预设仓库，运行 npm test。

[原生插件 SDK](docs/SDK.md) · [预设格式](docs/PRESETS.md) · [运行接口](docs/API.md) · [项目来源](docs/ORIGIN.md)
