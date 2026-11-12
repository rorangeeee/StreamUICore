# StreamUICore

Windows x64 本地场景宿主。Core 负责通用场景播放、独立预览、扩展装载和参数保存。OBS 联动、弹幕、音频和曲目读取分别由插件提供，暂离由预设场景实现。首次启动没有场景或已启用扩展。

## 构建与安装

需要 Node.js 22.18+、.NET 10 SDK、Windows x64。

~~~powershell
npm ci
npm run host:package
~~~

生成 StreamUI Core.exe 和独立原生 SDK（sdk/native，major 1）。配置页 http://127.0.0.1:5281/，输出 http://127.0.0.1:5280/。浏览器 SDK 为 2。EXE 不含预设或插件。

## 从 Git 安装

安装扩展需要 Git for Windows、Node.js（含 npm）和 .NET 10 SDK。安装这些工具后重启 Core，让它读取更新后的 PATH。Core 安装包提供插件编译用的原生 SDK。

在配置页点击「从 Git 安装」，粘贴预设或插件的仓库地址，再点「安装」。Core 会拉取仓库的默认分支并运行构建脚本。安装预设时，Core 会读取仓库根目录的 `plugins.txt`，一并安装每行地址指向的插件。安装同一来源的预设或插件时会复用本机已有的构建产物。

在预览区选择已安装的预设，点击「启用预设」。清单里标记为必需的插件随预设启动。单独安装的插件可在「设置 → 插件设置」里启用和配置。

## 配置与预览

顶部提供“预览”和“设置”。设置页按场景预设、插件设置分组导航，右侧保留独立预览；窄屏使用横向分类。配置页的布局、控件与深浅色主题移植自旧版 [StreamUI 的配置页提交](https://github.com/rorangeeee/StreamUI/commit/e9d00adf8cdee1923d72c0cbf0db869d3cd41ff3)。场景与插件自行提供配置面板；Core 没有固定的标题、暂离、OBS 或弹幕参数。参数改后自动保存。

预览切场景和重播动效只作用于当前配置页，不改变实际输出；OBS 输出切换也不会带动预览。Host 的暂离开关控制实际输出，预览同步显示覆盖效果。文字等持久化参数是共享的，修改后立即更新使用它的画面。

LATENITE 是个人化示例，配置页只保留多段标题和暂离文字。OBS 绑定在预设 defaults/<场景>.json 的 obsSceneName 中指定：留空不参与自动联动；只有非空且匹配的场景会响应实际 OBS 切换并播放动效。只填一个场景同样适用。OBS 插件在转场开始时读取节目目标场景，并保留开始时钟；匹配和播放由预设组件完成，Stinger 视频结束不会再次触发动效。

暂离是 LATENITE 的独立上层覆盖层，与 OBS 场景无关。托盘右键菜单和“预览”中的开关由预设提供，两处状态同步并保存在预设共享参数中；开启和关闭都不切主场景或触发主转场。覆盖期间底层场景可继续更新，退出时直接显示当前画面。文案仍在“设置 → 场景预设”中编辑。

OBS 地址和密码位于 OBS 场景联动插件。Event Bridge 地址、端口、Token、本地桥接开关位于 LAPLACE 插件。服务启停和 Windows 自启保留在托盘。

## 数据与更新

插件直接加载 plugins/<id>/，预设直接读取 presets/<id>/，安装仓库就是编辑目录。构建产物保留在本机。更新原生插件前退出 Core，合并 Git 更新、构建后再启动。参数与持久化数据保存在独立用户目录。

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
node tests/extension-installation-integration.mjs
npm run extensions:check -- plugins/desktop-audio plugins/system-media plugins/obs-scenes plugins/laplace presets/latenite
~~~

Core 测试使用合成场景和探针插件。协议、绑定和迁移测试位于相应扩展仓库。

[原生 SDK](docs/SDK.md) · [预设格式](docs/PRESETS.md) · [浏览器 API](docs/API.md) · [源码仓库约定](docs/REPOSITORIES.md) · [项目来源](docs/ORIGIN.md)
