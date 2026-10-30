# 扩展源码仓库约定 v1

官方和第三方扩展都以独立 Git 源码仓库分发。仓库必须包含可编辑源码、构建配置、依赖锁定文件和构建说明；不要求用户获取预编译包，不提交构建产物。构建由用户或其 agent 明确执行，Core 不自动执行下载仓库中的构建脚本。

安装目录就是工作目录。预设位于 EXE 旁 `presets/<id>/`，插件位于 `plugins/<id>/`，也可分别通过 `--presets-dir`、`--plugins-dir` 指定。目录名须与清单 id 一致；自定义修改直接在该仓库中完成。构建产物留在工作目录，加入 `.gitignore`。

## 预设

```text
latenite/
  preset.json           # formatVersion=1、浏览器 sdkVersion=2、版本、场景及插件依赖
  defaults.json         # 作者默认参数，不含用户连接凭据
  settings/             # 各场景自行提供的参数页
  sidebar.html          # 可选，预设的侧栏控件
  package.json          # 必须提供 check、build 脚本
  package-lock.json
  tsconfig.json
  vite.config.ts
  source/               # 可编辑 HTML、CSS、TS/JS 和素材
    index.html
  ui/                   # 本地构建输出，Git 忽略
```

`preset.json` 声明 `"build": {"kind":"vite","output":"ui"}`。场景 entry 指向构建后的 `ui/` 文件；源码仓库刚下载、尚未构建时，Core 可以将它显示为不可用。插件依赖须声明 `repository` 和 `ref`，用于用户和 agent 确定源码来源与版本；Core 当前不自动下载或构建依赖。

构建命令：`npm ci`、`npm run build`。仅修改 `settings.html`、默认参数或清单时不必编译前端；修改 source 后必须重新构建并刷新预览/OBS，清单结构变更后刷新列表并重新应用预设。

## 原生插件

```text
desktop-audio/
  plugin.json           # sdkVersion、版本、入口程序集、类型和能力
  DesktopAudio.csproj   # 仅引用独立 Contracts SDK
  *.cs                 # 可编辑插件源码，也可放入源码子目录
  build.ps1            # 接受 -SdkPath，校验 SDK major
  NuGet.Config
  settings.html        # 可选，由插件自行定义配置项
  DesktopAudio.dll     # 本地构建输出，Git 忽略
  DesktopAudio.deps.json
```

`plugin.json` 声明 `"build": {"kind":"dotnet","project":"DesktopAudio.csproj","sdkVersion":1}`。保留插件依赖的资源和脚本源码；不得引用 Core 源码或依赖其源码目录结构。有额外 NuGet 包时须提交锁定文件并说明还原方式。

构建命令：`powershell.exe -NoProfile -File build.ps1 -SdkPath <SDK目录>`。输出的程序集和依赖描述放在清单声明的位置。更新前先停用使用它的预设/插件，退出 Core，再更新源码和构建，最后启动 Core。Core 直接加载安装目录，不再复制一个用户目录副本。

旧版留在用户数据目录 `plugins/` 的文件不会删除。若该目录里有独有插件或自定义源码，手动迁到安装目录，或用 `--plugins-dir` 指向原目录；原有 plugin-settings、plugin-data 仍保存在用户数据目录。

## 配置页与验证

Core 只承载配置面板和保存接口。标题、OBS 绑定、暂离等具体字段属于预设场景；连接参数属于能力插件，各自由 settingsPage 提供。预设可用 sidebarPage 提供侧栏预览控件。Core 没有 OBS、弹幕或暂离业务字段。

参数项应自动保存。文本输入合并约 300 ms 的连续修改，开关和选择项立即提交；只 PATCH 改动字段，不能把读取到的整份合并设置作为单个字段的保存内容。SDK 的 `createAutoSave` 提供写入排队及失败保留，见 API.md。作者默认值和用户覆盖分开；Git 更新不会重写用户配置。

在 Core 中运行：

```powershell
npm run extensions:check -- plugins/desktop-audio plugins/system-media presets/latenite
```

检查以 Git 跟踪列表为准：源码与构建配置必须被跟踪，DLL、EXE、bin、obj、ui、node_modules、release 不得被跟踪。校验不会执行扩展代码，也不替代构建及运行测试。仓库中的 README 必须说明 SDK/工具链要求、构建命令、配置项和更新步骤。
