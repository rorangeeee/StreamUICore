# 独立原生插件 SDK 1

Core 的 contracts 项目维护 IStreamUIPlugin 与 IPluginContext。运行 npm run sdk:build，或构建 Host，即在 sdk/native 生成 StreamUI.Contracts.dll 和 sdk.json。二者是独立的编译参考 SDK，不是能力插件。

外置插件项目通过 Reference 与 StreamUISdkPath 引用该 DLL，Private=false，不需要 Core 的项目路径或源码。构建可指定：

~~~powershell
dotnet build MyPlugin.csproj -c Release -p:StreamUISdkPath=PATH_TO_SDK_NATIVE
~~~

官方插件自带 build.ps1，会检查 DLL 的程序集名称和 SDK major 1，随后构建并将运行 DLL、deps.json 放在 plugin.json 旁。

Host 与插件共享同一份 Contracts 程序集，由 PluginLoadContext 优先提供。SDK major 用于接口兼容检查；接口破坏性变更须升级 major，独立插件再明确迁移。现有 SDK major 1 的接口保持不变。

独立源码示例：

- https://github.com/rorangeeee/StreamUI-Plugin-DesktopAudio
- https://github.com/rorangeeee/StreamUI-Plugin-SystemMedia
- https://github.com/rorangeeee/StreamUI-Plugin-ObsScenes
- https://github.com/rorangeeee/StreamUI-Plugin-Laplace

Core 0.5 的浏览器 SDK 为 major 2，见 [API.md](API.md)。这与本页的原生 Contracts SDK major 1 分开版本化；原生接口保持不变。

插件直接在安装仓库中构建和加载，不再复制到运行数据目录。源码、构建配置必须进入 Git，DLL、deps.json、bin、obj 等产物不提交，详见 [REPOSITORIES.md](REPOSITORIES.md)。插件以当前用户权限运行；SDK 版本校验不构成代码沙箱。
