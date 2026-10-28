using System.Diagnostics;

namespace StreamUI;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--self-test")) return SelfTests.Run(args);
        ApplicationConfiguration.Initialize();
        string? Value(string key) { var index = Array.IndexOf(args, key); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
        var obsPort = int.TryParse(Value("--obs-port"), out var obs) ? obs : 5280;
        var configPort = int.TryParse(Value("--config-port"), out var config) ? config : 5281;
        if (obsPort is < 1024 or > 65535 || configPort is < 1024 or > 65535 || obsPort == configPort) return 1;
        var identity = $"Local\\StreamUI.Core.{obsPort}.{configPort}";
        using var single = new Mutex(true, identity, out var created);
        if (!created)
        {
            if (!args.Contains("--no-open"))
            {
                try { using var signal = EventWaitHandle.OpenExisting(identity + ".Activate"); signal.Set(); }
                catch (WaitHandleCannotBeOpenedException) { Open($"http://127.0.0.1:{configPort}/"); }
            }
            return 0;
        }
        using var activation = new EventWaitHandle(false, EventResetMode.AutoReset, identity + ".Activate");
        var projectData = Path.Combine(AppContext.BaseDirectory, ".local", "core-data");
        var directory = Value("--data-dir") ?? (Directory.Exists(projectData) ? projectData : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StreamUICore"));
        Directory.CreateDirectory(directory);
        HostRuntime? host = null;
        try
        {
            var explicitRoot = Value("--web-root");
            var root = WebAssets.Resolve(directory, explicitRoot);
            if (!File.Exists(Path.Combine(root, "config.html"))) throw new IOException("未找到网页文件。请先运行 npm run host:build。");
            WindowsStartup.Arguments = $"--no-open --obs-port {obsPort} --config-port {configPort} --data-dir \"{Path.GetFullPath(directory)}\"" + (explicitRoot is null ? "" : $" --web-root \"{Path.GetFullPath(root)}\"");
            host = new HostRuntime(new SettingsStore(directory, Value("--presets-dir"), Value("--plugins-dir")), Path.GetFullPath(root), obsPort, configPort);
            host.Start().GetAwaiter().GetResult();
            if (!args.Contains("--no-open") && !args.Contains("--headless")) Open(host.ConfigUrl);
            if (args.Contains("--headless"))
            {
                using var quit = new ManualResetEvent(false);
                Console.CancelKeyPress += (_, e) => { e.Cancel = true; quit.Set(); };
                host.ShutdownRequested += () => quit.Set();
                quit.WaitOne();
            }
            else Application.Run(new Tray(host, activation));
            return 0;
        }
        catch (Exception error)
        {
            File.AppendAllText(Path.Combine(directory, "host.log"), $"{DateTimeOffset.Now:O} {error}\n");
            if (!args.Contains("--headless")) MessageBox.Show("StreamUI Core 无法启动。\n" + error.Message + "\n\n日志：" + Path.Combine(directory, "host.log"), "StreamUI", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally { if (host is not null) host.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
    }
    public static void Open(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception error) { Debug.WriteLine(error); }
    }
}
