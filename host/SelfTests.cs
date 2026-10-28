using System.Net;
using System.Net.Sockets;
using System.Text.Json;
namespace StreamUI;
internal static class SelfTests
{
    public static int Run(string[] args)
    {
        var reportIndex = Array.IndexOf(args, "--report");
        var report = reportIndex >= 0 && reportIndex + 1 < args.Length ? Path.GetFullPath(args[reportIndex + 1]) : Path.Combine(Path.GetTempPath(), "streamui-core-self-test.json");
        var checks = new List<string>();
        void Check(bool value, string name) { if (!value) throw new Exception(name); checks.Add(name); }
        try {
            HostSettings.Default.Validate();
            Check(HostSettings.Default.Scenes.Length == 0 && HostSettings.Default.ActivePresetId is null, "a new Host starts without loading a preset");
            var selected = Fixture.Select("live").SetAway(true);
            Check(selected.ActiveSceneId == "away" && selected.SelectedSceneId == "live" && selected.SetAway(false).ActiveSceneId == "live", "away mode preserves the selected scene");
            var settingsJson = JsonSerializer.Serialize(HostSettings.Default, SettingsStore.Json);
            Check(!settingsJson.Contains("audio") && !settingsJson.Contains("titles") && !settingsJson.Contains("layout"), "core settings contain no visual or audio schema");
            var rejected = false;
            try { HostSettings.ValidatePath("scenes/../private.html", "scenes", ".html"); } catch (ArgumentException) { rejected = true; }
            Check(rejected, "scene entries cannot escape the user directory");
            var normalizer = new ChatEvents();
            using var message = JsonDocument.Parse("""{"type":"message","id":"one","origin":"test","uid":9,"username":"用户","userLvl":12,"message":"hello","timestampNormalized":1700000000000}""");
            var first = normalizer.Normalize(message.RootElement);
            Check(first?.User.Level == 12 && first.Timestamp == 1700000000000 && first.Text == "hello", "chat preserves structured user data and sending time");
            Check(normalizer.Normalize(message.RootElement) is null, "duplicate chat events are rejected");
            using var gift = JsonDocument.Parse("""{"type":"gift","id":"two","origin":"test","uid":9,"username":"用户","giftName":"花","num":2}""");
            Check(normalizer.Normalize(gift.RootElement) is { User.Level: 12, Gift.Count: 2 }, "gift data retains user level and quantity without display formatting");
            Verify(report, Check).GetAwaiter().GetResult();
            File.WriteAllText(report, JsonSerializer.Serialize(new { passed = checks }, SettingsStore.Json));
            return 0;
        } catch (Exception error) { File.WriteAllText(report, error.ToString()); return 1; }
    }
    private static HostSettings Fixture => new() { Scenes = [new("live", "Live", "scenes/live/index.html"), new("away", "Away", "scenes/away/index.html")], SelectedSceneId = "live", Away = new(false, "away") };
    private static async Task Verify(string report, Action<bool, string> check)
    {
        var root = Path.Combine(Path.GetDirectoryName(report)!, "core-self-test-" + Guid.NewGuid().ToString("N"));
        var store = new SettingsStore(root, Path.Combine(root, "presets"), Path.Combine(root, "bundled-plugins"));
        await store.Save(Fixture);
        Directory.CreateDirectory(Path.Combine(root, "scenes", "live"));
        Directory.CreateDirectory(Path.Combine(root, "scenes", "away"));
        File.WriteAllText(Path.Combine(root, "scenes", "live", "index.html"), "<script type=module>import { createClient } from '/sdk/streamui.js';</script>");
        File.WriteAllText(Path.Combine(root, "scenes", "away", "index.html"), "away");
        var webRoot = WebAssets.Resolve(root, null);
        int FreePort() { var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop(); return port; }
        await using var runtime = new HostRuntime(store, webRoot, FreePort(), FreePort());
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        await runtime.Start();
        check((await http.GetStringAsync(runtime.ConfigUrl)).Contains("tab-preview"), "configuration page is embedded");
        check((await http.GetStringAsync(runtime.ObsUrl + "sdk/streamui.js")).Contains("createClient"), "the SDK is served at a stable URL");
        check((await http.GetStringAsync(runtime.ObsUrl + "user/scenes/live/index.html")).Contains("createClient"), "external user scenes are served separately from the program");
        check((await http.GetAsync(runtime.ObsUrl + "api/settings")).StatusCode == HttpStatusCode.NotFound, "OBS pages cannot read private connection settings");
        using var state = JsonDocument.Parse(await http.GetStringAsync(runtime.ObsUrl + "api/state"));
        check(!state.RootElement.TryGetProperty("audio", out _) && state.RootElement.GetProperty("plugins").GetArrayLength() == 0, "no optional capability starts in the core");
        File.WriteAllText(Path.Combine(root, "scenes", "live", "index.html"), "user-edited");
        await runtime.Stop(); await runtime.Start();
        check((await http.GetStringAsync(runtime.ObsUrl + "user/scenes/live/index.html")) == "user-edited", "restarting never overwrites user scenes");
        await runtime.SetAway(true);
        check(runtime.AwayEnabled, "tray and API share away state");
        await runtime.Stop();
        var restored = new SettingsStore(root);
        check(restored.Current.Away.Enabled && restored.Current.SelectedSceneId == "live", "scene and away selections survive restart");
    }
}
