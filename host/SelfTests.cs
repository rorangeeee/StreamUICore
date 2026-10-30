using System.Net;
using System.Net.Sockets;
using System.Text.Json;
namespace StreamUI;
internal static class SelfTests
{
    public static int Run(string[] args)
    {
        var index = Array.IndexOf(args, "--report");
        var report = index >= 0 && index + 1 < args.Length ? Path.GetFullPath(args[index + 1]) : Path.Combine(Path.GetTempPath(), "streamui-core-self-test.json");
        var checks = new List<string>();
        void Check(bool value, string name) { if (!value) throw new Exception(name); checks.Add(name); }
        try {
            HostSettings.Default.Validate();
            var json = JsonSerializer.Serialize(HostSettings.Default, SettingsStore.Json);
            Check(!json.Contains("obs") && !json.Contains("laplace") && !json.Contains("away") && !json.Contains("titles"), "Core settings have no integration or preset-specific fields");
            Verify(report, Check).GetAwaiter().GetResult();
            File.WriteAllText(report, JsonSerializer.Serialize(new { passed = checks }, SettingsStore.Json)); return 0;
        } catch (Exception error) { File.WriteAllText(report, error.ToString()); return 1; }
    }
    private static async Task Verify(string report, Action<bool, string> check)
    {
        var root = Path.Combine(Path.GetDirectoryName(report)!, "core-self-test-" + Guid.NewGuid().ToString("N"));
        var store = new SettingsStore(root, Path.Combine(root, "presets"), Path.Combine(root, "installed-plugins"));
        await store.Save(new() { Scenes = [new("one", "One", "scenes/one/index.html"), new("two", "Two", "scenes/two/index.html")], SelectedSceneId = "one" });
        Directory.CreateDirectory(Path.Combine(root, "scenes", "one")); Directory.CreateDirectory(Path.Combine(root, "scenes", "two"));
        File.WriteAllText(Path.Combine(root, "scenes", "one", "index.html"), "<script type=module>import { createClient } from '/sdk/streamui.js';</script>");
        File.WriteAllText(Path.Combine(root, "scenes", "two", "index.html"), "two");
        int Port() { var server = new TcpListener(IPAddress.Loopback, 0); server.Start(); var port = ((IPEndPoint)server.LocalEndpoint).Port; server.Stop(); return port; }
        await using var runtime = new HostRuntime(store, WebAssets.Resolve(root, null), Port(), Port());
        using var http = new HttpClient(); http.DefaultRequestHeaders.Add("X-StreamUI-Request", "1");
        await runtime.Start();
        check((await http.GetStringAsync(runtime.ConfigUrl)).Contains("tab-scenes"), "configuration includes preview, scene and plugin pages");
        check((await http.GetStringAsync(runtime.ObsUrl + "sdk/streamui.js")).Contains("createClient"), "browser SDK is embedded");
        check((await http.GetAsync(runtime.ObsUrl + "api/settings")).StatusCode == HttpStatusCode.NotFound, "output pages cannot read plugin preferences");
        using var storage = JsonDocument.Parse(await http.GetStringAsync(runtime.ConfigUrl + "api/storage"));
        check(storage.RootElement.GetProperty("plugins").GetString() == store.PluginsDirectory, "plugins run from their installed repository");
        var before = File.ReadAllText(Path.Combine(root, "core-settings.json"));
        using var created = JsonDocument.Parse(await (await http.PostAsync(runtime.ConfigUrl + "api/previews", null)).Content.ReadAsStringAsync());
        var id = created.RootElement.GetProperty("id").GetString();
        using var selected = await http.PostAsync(runtime.ConfigUrl + "api/actions/scene?preview=" + id, new StringContent("{\"id\":\"two\"}", System.Text.Encoding.UTF8, "application/json"));
        check(selected.IsSuccessStatusCode && File.ReadAllText(Path.Combine(root, "core-settings.json")) == before, "preview selection does not change saved output");
        using var output = JsonDocument.Parse(await http.GetStringAsync(runtime.ObsUrl + "api/state"));
        check(output.RootElement.GetProperty("scene").GetProperty("activeId").GetString() == "one", "preview animation does not select the OBS output scene");
        File.WriteAllText(Path.Combine(root, "scenes", "one", "index.html"), "edited");
        await runtime.Stop(); await runtime.Start();
        check(await http.GetStringAsync(runtime.ObsUrl + "user/scenes/one/index.html") == "edited", "restart preserves editable source");
        check(new SettingsStore(root).Current.SelectedSceneId == "one", "restart preserves output selection");
    }
}
