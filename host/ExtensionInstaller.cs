using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace StreamUI;

internal record ExtensionInstallResult(string Kind, string Id, string Name);

internal sealed class ExtensionInstaller(SettingsStore store, SemaphoreSlim mutations)
{
    private sealed record Placement(string Checkout, string Destination);
    private readonly SemaphoreSlim installation = new(1);

    public async Task<ExtensionInstallResult> Install(string? address, Func<ExtensionInstallResult, Task> discover, CancellationToken cancellation)
    {
        var repository = RepositoryAddress(address);
        if (!await installation.WaitAsync(0, cancellation)) throw new ArgumentException("已有扩展正在安装，请等待完成。");
        var staging = new List<string>();
        var placements = new List<Placement>();
        try
        {
            var checkout = StagingCheckout(store.PresetsDirectory, staging);
            await Clone(repository, checkout, cancellation);
            var isPreset = File.Exists(Path.Combine(checkout, "preset.json"));
            var isPlugin = File.Exists(Path.Combine(checkout, "plugin.json"));
            if (isPreset == isPlugin) throw new ArgumentException("仓库根目录应包含 preset.json 或 plugin.json 之一。");

            ExtensionInstallResult result;
            if (isPreset)
            {
                var preset = await PreparePreset(checkout, repository, staging, placements, cancellation);
                result = new("preset", preset.Id, preset.Name);
            }
            else
            {
                var plugin = await PluginHost.ReadManifest(checkout, cancellation: cancellation);
                var destination = Path.Combine(store.PluginsDirectory, plugin.Id);
                // Stage on the destination volume even when the two install roots are on different drives.
                if (!Directory.Exists(destination) && !string.Equals(store.PresetsDirectory, store.PluginsDirectory, StringComparison.OrdinalIgnoreCase))
                {
                    var pluginCheckout = StagingCheckout(store.PluginsDirectory, staging);
                    await Run("准备插件目录", "git.exe", ["clone", "--no-hardlinks", "--", checkout, pluginCheckout], store.PluginsDirectory, cancellation);
                    await Run("设置插件仓库地址", "git.exe", ["remote", "set-url", "origin", repository], pluginCheckout, cancellation);
                    checkout = pluginCheckout;
                }
                plugin = await PreparePlugin(checkout, repository, plugin, placements, cancellation);
                result = new("plugin", plugin.Id, plugin.Name);
            }

            await mutations.WaitAsync(cancellation);
            try
            {
                cancellation.ThrowIfCancellationRequested();
                Publish(placements);
                await discover(result);
            }
            finally { mutations.Release(); }
            return result;
        }
        finally
        {
            foreach (var directory in staging)
            {
                try { RemoveStaging(directory); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { Trace.TraceWarning(error.Message); }
            }
            installation.Release();
        }
    }

    private async Task<PresetManifest> PreparePreset(string checkout, string repository, List<string> staging,
        List<Placement> placements, CancellationToken cancellation)
    {
        var manifest = PresetCatalog.ReadManifest(checkout);
        var list = Path.Combine(checkout, "plugins.txt");
        if (!File.Exists(list)) throw new ArgumentException("预设仓库根目录缺少 plugins.txt。没有插件依赖时也需要提交空文件。");
        var lines = await File.ReadAllLinesAsync(list, cancellation);
        var repositories = new HashSet<string>(StringComparer.Ordinal);
        var dependencies = new List<string>();
        for (var index = 0; index < lines.Length; index++)
        {
            if (string.IsNullOrWhiteSpace(lines[index])) continue;
            var address = RepositoryAddress(lines[index], $"plugins.txt 第 {index + 1} 行");
            if (repositories.Add(RepositoryKey(address))) dependencies.Add(address);
        }

        var destination = Path.Combine(store.PresetsDirectory, manifest.Id);
        var installed = Directory.Exists(destination);
        if (installed)
        {
            await RequireSameRepository(destination, repository, cancellation);
            manifest = PresetCatalog.ReadManifest(destination, manifest.Id);
            PresetCatalog.ValidateFiles(destination, manifest);
        }

        var plugins = new Dictionary<string, PluginManifest>(StringComparer.Ordinal);
        foreach (var dependency in dependencies)
        {
            var pluginCheckout = StagingCheckout(store.PluginsDirectory, staging);
            await Clone(dependency, pluginCheckout, cancellation);
            if (!File.Exists(Path.Combine(pluginCheckout, "plugin.json")) || File.Exists(Path.Combine(pluginCheckout, "preset.json")))
                throw new ArgumentException($"plugins.txt 中的仓库 {dependency} 需要在根目录提供 plugin.json。");
            var plugin = await PluginHost.ReadManifest(pluginCheckout, cancellation: cancellation);
            if (plugins.ContainsKey(plugin.Id)) throw new ArgumentException($"plugins.txt 中多个仓库使用了同一个插件 ID {plugin.Id}。");
            plugins.Add(plugin.Id, await PreparePlugin(pluginCheckout, dependency, plugin, placements, cancellation));
        }

        if (!installed)
        {
            await Run("安装预设的 npm 依赖", "cmd.exe", ["/d", "/c", "npm.cmd", "ci"], checkout, cancellation);
            await Run("构建预设", "cmd.exe", ["/d", "/c", "npm.cmd", "run", "build"], checkout, cancellation);
            manifest = PresetCatalog.ReadManifest(checkout, manifest.Id);
            PresetCatalog.ValidateFiles(checkout, manifest);
            placements.Add(new(checkout, destination));
        }
        foreach (var dependency in (manifest.Plugins ?? []).Where(plugin => plugin.Required))
        {
            if (!plugins.TryGetValue(dependency.Id, out var plugin))
                throw new ArgumentException($"plugins.txt 中缺少必需插件 {dependency.Id} 的仓库地址。");
            PresetCatalog.RequirePluginVersion(dependency, plugin.Version);
        }
        return manifest;
    }

    private async Task<PluginManifest> PreparePlugin(string checkout, string repository, PluginManifest manifest,
        List<Placement> placements, CancellationToken cancellation)
    {
        var destination = Path.Combine(store.PluginsDirectory, manifest.Id);
        if (Directory.Exists(destination))
        {
            await RequireSameRepository(destination, repository, cancellation);
            var installed = await PluginHost.ReadManifest(destination, manifest.Id, cancellation);
            RequireAssembly(destination, installed);
            return installed;
        }

        var script = Path.Combine(checkout, "build.ps1");
        if (!File.Exists(script)) throw new ArgumentException($"插件 {manifest.Id} 的仓库根目录缺少 build.ps1。");
        var sdk = Path.Combine(AppContext.BaseDirectory, "sdk", "native");
        if (!File.Exists(Path.Combine(sdk, "StreamUI.Contracts.dll")))
            throw new ArgumentException("Core 旁缺少 sdk/native 原生 SDK，请使用包含原生 SDK 的安装包。");
        await Run($"构建插件 {manifest.Id}", "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-SdkPath", sdk], checkout, cancellation);
        manifest = await PluginHost.ReadManifest(checkout, manifest.Id, cancellation);
        RequireAssembly(checkout, manifest);
        placements.Add(new(checkout, destination));
        return manifest;
    }

    private static void RequireAssembly(string directory, PluginManifest manifest)
    {
        if (!File.Exists(Path.Combine(directory, manifest.Assembly)))
            throw new ArgumentException($"插件 {manifest.Id} 缺少构建产物 {manifest.Assembly}。");
    }

    private static async Task RequireSameRepository(string directory, string repository, CancellationToken cancellation)
    {
        var conflict = $"目录 {directory} 已存在，且无法确认它来自同一仓库。请先处理该目录再重试。";
        string origin;
        try { origin = await Run("读取已安装扩展的仓库地址", "git.exe", ["config", "--local", "--get", "remote.origin.url"], directory, cancellation); }
        catch (ArgumentException error) { throw new ArgumentException(conflict, error); }
        if (RepositoryKey(origin) != RepositoryKey(repository)) throw new ArgumentException(conflict);
    }

    private static string RepositoryAddress(string? value, string label = "仓库地址")
    {
        var address = value?.Trim() ?? "";
        if (!address.Any(c => char.IsWhiteSpace(c) || char.IsControl(c))
            && ((Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" or "ssh" or "git"
                && uri.Host.Length > 0 && uri.AbsolutePath.Length > 1 && uri.Fragment.Length == 0
                && (uri.UserInfo.Length == 0 || (uri.Scheme == "ssh" && !uri.UserInfo.Contains(':'))))
                || Regex.IsMatch(address, @"\A[\w.-]+@(?:[\w.-]+|\[[a-fA-F0-9:]+\]):[^\s]+\z")))
            return address;
        throw new ArgumentException($"{label}需要填写 Git 仓库地址，例如 https://github.com/作者/仓库。");
    }

    private static string RepositoryKey(string address)
    {
        var key = address.Trim().TrimEnd('/');
        return key.EndsWith(".git", StringComparison.OrdinalIgnoreCase) ? key[..^4] : key;
    }

    private static string StagingCheckout(string root, List<string> staging)
    {
        var directory = Path.Combine(root, ".install-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        staging.Add(directory);
        return Path.Combine(directory, "checkout");
    }

    private static void RemoveStaging(string directory)
    {
        if (!Directory.Exists(directory)) return;
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
        {
            Directory.Delete(directory);
            return;
        }
        // Git marks its pack files read-only on Windows.
        var options = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint };
        foreach (var file in Directory.EnumerateFiles(directory, "*", options))
        {
            var attributes = File.GetAttributes(file);
            if ((attributes & FileAttributes.ReadOnly) != 0) File.SetAttributes(file, attributes & ~FileAttributes.ReadOnly);
        }
        Directory.Delete(directory, recursive: true);
    }

    private static Task<string> Clone(string repository, string checkout, CancellationToken cancellation) =>
        Run($"拉取仓库 {repository}", "git.exe",
            ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.http.allow=always",
             "-c", "protocol.ssh.allow=always", "-c", "protocol.git.allow=always", "clone", "--depth", "1", "--", repository, checkout],
            Path.GetDirectoryName(checkout)!, cancellation);

    private static void Publish(List<Placement> placements)
    {
        var moved = new Stack<Placement>();
        try
        {
            foreach (var item in placements)
            {
                Directory.Move(item.Checkout, item.Destination);
                moved.Push(item);
            }
        }
        catch
        {
            foreach (var item in moved) Directory.Move(item.Destination, item.Checkout);
            throw;
        }
    }

    private static async Task<string> Run(string step, string executable, string[] arguments, string directory, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var start = new ProcessStartInfo(executable)
        {
            WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        if (executable == "git.exe")
        {
            start.Environment["GIT_TERMINAL_PROMPT"] = "0";
            start.Environment["GCM_INTERACTIVE"] = "never";
            start.Environment["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes";
        }
        using var process = new Process { StartInfo = start };
        try { process.Start(); }
        catch (Win32Exception error) when (error.NativeErrorCode == 2 && executable == "git.exe")
        { throw new ArgumentException("找不到 Git。请安装 Git for Windows 后重启 Core。", error); }
        catch (Win32Exception error) { throw new ArgumentException($"{step}失败。{error.Message}", error); }
        process.StandardInput.Close();

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromMinutes(15));
        var output = ReadTail(process.StandardOutput, timeout.Token);
        var errors = ReadTail(process.StandardError, timeout.Token);
        try
        {
            await process.WaitForExitAsync(timeout.Token);
            var logs = await Task.WhenAll(output, errors);
            if (process.ExitCode != 0)
            {
                var detail = string.Join("\n", logs.Where(log => log.Length > 0));
                throw new ArgumentException($"{step}失败（退出码 {process.ExitCode}）。\n{detail}".TrimEnd());
            }
            return logs[0];
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                    await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
                }
                catch (Exception error) when (error is Win32Exception or InvalidOperationException or TimeoutException) { Trace.TraceWarning(error.Message); }
            }
            cancellation.ThrowIfCancellationRequested();
            throw new ArgumentException($"{step}超时，请检查网络或构建环境后重试。");
        }
    }

    private static async Task<string> ReadTail(StreamReader reader, CancellationToken cancellation)
    {
        const int limit = 4000;
        var log = new StringBuilder();
        var buffer = new char[1024];
        int count;
        while ((count = await reader.ReadAsync(buffer.AsMemory(), cancellation)) > 0)
        {
            log.Append(buffer, 0, count);
            if (log.Length > limit) log.Remove(0, log.Length - limit);
        }
        return log.ToString().Trim();
    }
}
