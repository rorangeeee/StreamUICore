# StreamUICore

Windows x64 本地场景宿主。Core 负责通用场景播放、独立预览、扩展装载和参数保存。OBS 联动、弹幕、音频和曲目读取分别由插件提供，暂离由预设场景实现。首次启动没有场景或已启用扩展。

## 构建与安装

需要 Node.js 22.18+、.NET 10 SDK、Windows x64。

~~~powershell
npm ci
npm run host:package
~~~

生成 StreamUI Core.exe 和独立原生 SDK（sdk/native，major 1）。配置页 http://127.0.0.1:5281/，输出 http://127.0.0.1:5280/。浏览器 SDK 为 2。EXE 不含预设或插件。

在 Core 目录安装源码：

~~~powershell
git clone https://github.com/rorangeeee/StreamUI-Plugin-DesktopAudio.git plugins/desktop-audio
git clone https://github.com/rorangeeee/StreamUI-Plugin-SystemMedia.git plugins/system-media
git clone https://github.com/rorangeeee/StreamUI-Plugin-ObsScenes.git plugins/obs-scenes
git clone https://github.com/rorangeeee/StreamUI-Plugin-Laplace.git plugins/laplace
git clone https://github.com/rorangeeee/StreamUI-Preset-Latenite.git presets/latenite
powershell.exe -NoProfile -File plugins/desktop-audio/build.ps1 -SdkPath sdk/native
powershell.exe -NoProfile -File plugins/system-media/build.ps1 -SdkPath sdk/native
powershell.exe -NoProfile -File plugins/obs-scenes/build.ps1 -SdkPath sdk/native
powershell.exe -NoProfile -File plugins/laplace/build.ps1 -SdkPath sdk/native
npm --prefix presets/latenite ci
npm --prefix presets/latenite run build
~~~

启动 Core，选择并启用 LATENITE。字体由本机提供，具体要求见预设 README。

## 配置与预览

侧栏提供预览、场景配置和插件配置。场景与插件自行提供配置面板；Core 没有固定的标题、暂离、OBS 或弹幕参数。参数改后自动保存。

预览切场景、重播动效和暂离开关只作用于当前配置页的独立播放会话，不改变实际输出。OBS 输出切换也不会带动预览。文字等持久化参数是共享的，修改后立即更新使用它的画面。

LATENITE 在每个场景的配置页提供 OBS 场景名字段。留空不参与自动联动；只有非空且匹配的场景会响应实际 OBS 切换并播放动效。只填一个场景同样适用。OBS 插件只报告事件，匹配和播放由预设组件完成。

暂离是 LATENITE 的一个普通场景，文字在该场景配置中编辑。侧栏暂离开关由预设提供，用于预览；实际输出进入暂离时，使用绑定到该场景的 OBS 场景名。

OBS 地址和密码位于 OBS 场景联动插件。Event Bridge 地址、端口、Token、本地桥接开关位于 LAPLACE 插件。服务启停和 Windows 自启保留在托盘。

## 数据与更新

插件直接加载 plugins/<id>/，预设直接读取 presets/<id>/，安装仓库就是编辑目录。仓库包含源码和构建配置，产物由用户或 agent 本地生成，不提交 Git。更新原生插件前退出 Core，合并 Git 更新、构建后再启动。参数与持久化数据保存在独立用户目录。

默认数据目录为 %LOCALAPPDATA%/StreamUICore；EXE 旁有 .local/core-data 时使用它。可用 --data-dir、--presets-dir、--plugins-dir、--obs-port、--config-port 指定隔离实例。

Core 0.5 使用浏览器 SDK 2，旧 SDK 1 预设需要升级。旧 core-settings.json 会备份为 core-settings.v1.json；两个新插件按各自声明导入旧连接配置。Core 停止时，可迁移旧 LATENITE 标题、绑定与暂离参数：

~~~powershell
npm --prefix presets/latenite run migrate -- <Core数据目录>
~~~

旧用户目录中的插件副本保留，可迁到安装目录，或用 --plugins-dir 继续使用原目录。

## 验证

~~~powershell
npm test
npm run host:test
node tests/presets-integration.mjs 'StreamUI Core.exe'
npm run extensions:check -- plugins/desktop-audio plugins/system-media plugins/obs-scenes plugins/laplace presets/latenite
~~~

Core 测试使用合成场景和探针插件。协议、绑定和迁移测试位于相应扩展仓库。

[原生 SDK](docs/SDK.md) · [预设格式](docs/PRESETS.md) · [浏览器 API](docs/API.md) · [源码仓库约定](docs/REPOSITORIES.md) · [项目来源](docs/ORIGIN.md)
