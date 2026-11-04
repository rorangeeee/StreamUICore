using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
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
            VerifyTrayControls(report, Check).GetAwaiter().GetResult();
            File.WriteAllText(report, JsonSerializer.Serialize(new { passed = checks }, SettingsStore.Json)); return 0;
        } catch (Exception error) { File.WriteAllText(report, error.ToString()); return 1; }
    }
    private static async Task VerifyTrayControls(string report, Action<bool, string> check)
    {
        var root = Path.Combine(Path.GetDirectoryName(report)!, "tray-test-" + Guid.NewGuid().ToString("N"));
        var catalog = Path.Combine(root, "presets"); var preset = Path.Combine(catalog, "demo");
        Directory.CreateDirectory(preset);
        File.WriteAllText(Path.Combine(preset, "scene.html"), "<body>Tray control fixture</body>");
        File.WriteAllText(Path.Combine(preset, "defaults.json"), """{"title":"Original","controls":{"cover":false,"other":true}}""");
        var manifest = new PresetManifest(1, 2, "demo", "Demo", "1.0.0", "", [new("main", "Main", "scene.html")],
            "main", Defaults: "defaults.json", TrayControls: [new("显示遮罩", "controls.cover")]);
        var manifestFile = Path.Combine(preset, "preset.json");
        foreach (var control in new[] { new PresetTrayControl("Invalid", "title"), new("Invalid", "controls.missing"), new("Invalid", "controls..cover") }) {
            File.WriteAllText(manifestFile, JsonSerializer.Serialize(manifest with { TrayControls = [control] }, SettingsStore.Json));
            check(!new PresetCatalog(catalog, root).Items.Single().Available, "invalid tray binding is rejected: " + control.Setting);
        }
        File.WriteAllText(manifestFile, JsonSerializer.Serialize(manifest, SettingsStore.Json));
        var store = new SettingsStore(root, catalog, Path.Combine(root, "plugins"));
        int Port() { var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop(); return port; }
        await using var runtime = new HostRuntime(store, WebAssets.Resolve(root, null), Port(), Port());
        using var http = new HttpClient(); http.DefaultRequestHeaders.Add("X-StreamUI-Request", "1");
        StringContent Json(string value) => new(value, System.Text.Encoding.UTF8, "application/json");
        async Task<string> Scene(string query = "") {
            using var state = JsonDocument.Parse(await http.GetStringAsync(runtime.ConfigUrl + "api/state" + query));
            return state.RootElement.GetProperty("scene").GetRawText();
        }
        await runtime.Start();
        check(runtime.TrayControls.Length == 0, "no preset exposes no tray controls");
        (await http.PostAsync(runtime.ConfigUrl + "api/presets/activate", Json("""{"id":"demo"}"""))).EnsureSuccessStatusCode();
        check(runtime.TrayControls is [{ PresetId: "demo", Label: "显示遮罩", Setting: "controls.cover", Value: false }],
            "the active preset declares its tray label, binding and current value");
        (await http.PostAsync(runtime.ConfigUrl + "api/actions/scene", Json("""{"id":"demo__main","cue":"live-cue"}"""))).EnsureSuccessStatusCode();
        using var created = JsonDocument.Parse(await (await http.PostAsync(runtime.ConfigUrl + "api/previews", null)).Content.ReadAsStringAsync());
        var preview = "?preview=" + created.RootElement.GetProperty("id").GetString();
        (await http.PostAsync(runtime.ConfigUrl + "api/actions/scene" + preview, Json("""{"id":"demo__main","cue":"preview-cue"}"""))).EnsureSuccessStatusCode();
        var outputScene = await Scene(); var previewScene = await Scene(preview);
        using var outputEvents = new ClientWebSocket(); using var previewEvents = new ClientWebSocket();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        async Task<JsonDocument> Message(ClientWebSocket socket) {
            using var bytes = new MemoryStream(); var buffer = new byte[4096];
            WebSocketReceiveResult result;
            do { result = await socket.ReceiveAsync(buffer, timeout.Token); bytes.Write(buffer, 0, result.Count); } while (!result.EndOfMessage);
            return JsonDocument.Parse(bytes.ToArray());
        }
        await outputEvents.ConnectAsync(new Uri(runtime.ObsUrl.Replace("http:", "ws:") + "ws/events"), timeout.Token);
        await previewEvents.ConnectAsync(new Uri(runtime.ConfigUrl.Replace("http:", "ws:") + "ws/events" + preview), timeout.Token);
        using var initialOutput = await Message(outputEvents); using var initialPreview = await Message(previewEvents);
        await runtime.ToggleTrayControl("demo", "controls.cover");
        using var outputEvent = await Message(outputEvents); using var previewEvent = await Message(previewEvents);
        check(new[] { outputEvent, previewEvent }.All(value => value.RootElement.GetProperty("topic").GetString() == "preset.settingsChanged"),
            "native tray changes notify both the output and independent previews");
        check(runtime.TrayControls.Single().Value == true && outputScene == await Scene() && previewScene == await Scene(preview),
            "native tray toggles persist without changing output or preview scene clocks");
        var notifications = 0; runtime.Changed += () => Interlocked.Increment(ref notifications);
        (await http.PatchAsync(runtime.ConfigUrl + "api/presets/demo/settings", Json("""{"title":"Personal","controls":{"cover":false}}"""))).EnsureSuccessStatusCode();
        check(runtime.TrayControls.Single().Value == false && notifications > 0, "web control changes refresh the native tray state");
        await Task.WhenAll(runtime.ToggleTrayControl("demo", "controls.cover"), runtime.ToggleTrayControl("demo", "controls.cover"));
        using var values = JsonDocument.Parse(await http.GetStringAsync(runtime.ConfigUrl + "api/presets/demo/settings"));
        check(!values.RootElement.GetProperty("controls").GetProperty("cover").GetBoolean()
            && values.RootElement.GetProperty("controls").GetProperty("other").GetBoolean() && values.RootElement.GetProperty("title").GetString() == "Personal",
            "queued tray clicks preserve unrelated settings without losing toggles");
        var rejected = false;
        try { await runtime.ToggleTrayControl("demo", "controls.other"); } catch (ArgumentException) { rejected = true; }
        check(rejected, "tray actions cannot change an undeclared parameter");
        await runtime.ToggleTrayControl("demo", "controls.cover"); await runtime.Stop(); await runtime.Start();
        check(runtime.TrayControls.Single().Value == true, "tray toggle state survives a service restart");
        (await http.PostAsync(runtime.ConfigUrl + "api/presets/activate", Json("""{"id":null}"""))).EnsureSuccessStatusCode();
        rejected = false;
        try { await runtime.ToggleTrayControl("demo", "controls.cover"); } catch (InvalidOperationException) { rejected = true; }
        check(runtime.TrayControls.Length == 0 && rejected, "deactivating a preset removes its controls and rejects a stale menu action");
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
        var configuration = await http.GetStringAsync(runtime.ConfigUrl);
        check(new[] { "tab-preview", "tab-settings", "scene-navigation", "plugin-navigation" }.All(configuration.Contains),
            "configuration includes preview and grouped scene/plugin settings navigation");
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
