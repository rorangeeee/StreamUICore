using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace StreamUI;

public record LaplaceSettings(bool Enabled = false, string Url = "ws://localhost:9696", string Token = "", bool StartLocalBridge = false);
public record ObsSettings(bool Enabled = false, string Url = "ws://127.0.0.1:4455", string Password = "");
public record SceneSlot(string Id, string Name, string Entry, string ObsScene = "", int Width = 1920, int Height = 1080, string Transition = "", string SettingsPage = "")
{
    public string PresetId { get; init; } = "";
    public string SceneId { get; init; } = "";
    public string View { get; init; } = "";
    public string RuntimeGroup { get; init; } = "";
}
public record AwaySettings(bool Enabled = false, string? SceneId = null);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record BroadcasterSettings(ObsSettings Obs, LaplaceSettings Laplace, string[] EnabledPlugins);
public record HostSettings
{
    public ObsSettings Obs { get; init; } = new();
    public LaplaceSettings Laplace { get; init; } = new();
    public SceneSlot[] Scenes { get; init; } = [];
    public string? SelectedSceneId { get; init; }
    public string? ActivePresetId { get; init; }
    public AwaySettings Away { get; init; } = new();
    public string[] EnabledPlugins { get; init; } = [];
    public static HostSettings Default => new();
    public string? ActiveSceneId => Away.Enabled ? Away.SceneId : SelectedSceneId;
    public static bool IsId(string? value) => value is not null && Regex.IsMatch(value, "^[a-z0-9][a-z0-9_-]{0,63}$");
    public static void ValidatePath(string path, string prefix, string extension)
    {
        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith(prefix + "/", StringComparison.Ordinal) || path.Contains('\\') || path.Contains(':')
            || path.Contains('?') || path.Contains('#') || path.Split('/').Any(part => part is "" or "." or "..") || !path.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("文件路径无效。");
    }
    public void Validate()
    {
        if (Scenes is null || Scenes.Length > 100 || Scenes.Any(s => s is null || !IsId(s.Id) || string.IsNullOrWhiteSpace(s.Name) || s.Name.Length > 100
            || s.Width is < 320 or > 7680 || s.Height is < 180 or > 4320 || s.ObsScene is null || s.Entry is null || s.Transition is null || s.SettingsPage is null || s.ObsScene.Length > 256))
            throw new ArgumentException("场景信息无效。");
        if (Scenes.Select(s => s.Id).Distinct().Count() != Scenes.Length) throw new ArgumentException("场景 ID 重复。");
        var names = Scenes.Where(s => s.ObsScene.Length > 0).Select(s => s.ObsScene);
        if (names.Distinct().Count() != names.Count()) throw new ArgumentException("OBS 场景已绑定到其他槽位。");
        foreach (var scene in Scenes)
        {
            void ContentPath(string path, string extension) => ValidatePath(path, path.StartsWith("presets/", StringComparison.Ordinal) ? "presets" : "scenes", extension);
            ContentPath(scene.Entry, ".html");
            if (scene.Transition.Length > 0) ContentPath(scene.Transition, ".js");
            if (scene.SettingsPage.Length > 0) ContentPath(scene.SettingsPage, ".html");
            if (scene.PresetId is null || scene.SceneId is null || scene.View is null || scene.RuntimeGroup is null) throw new ArgumentException("场景上下文无效。");
        }
        if (ActivePresetId is not null && !IsId(ActivePresetId)) throw new ArgumentException("预设 ID 无效。");
        if (SelectedSceneId is not null && !Scenes.Any(s => s.Id == SelectedSceneId)) throw new ArgumentException("所选场景不存在。");
        if (Away is null || Away.SceneId is not null && !Scenes.Any(s => s.Id == Away.SceneId) || Away.Enabled && Away.SceneId is null)
            throw new ArgumentException("请选择暂离场景。");
        if (EnabledPlugins is null || EnabledPlugins.Any(id => !IsId(id)) || EnabledPlugins.Distinct().Count() != EnabledPlugins.Length)
            throw new ArgumentException("插件 ID 无效。");
        static bool SocketUrl(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "ws" or "wss" && uri.UserInfo == "" && uri.Fragment == "";
        if (Obs is null || !SocketUrl(Obs.Url) || Obs.Password is null || Obs.Password.Length > 2048) throw new ArgumentException("OBS 连接信息无效。");
        if (Laplace is null || !SocketUrl(Laplace.Url) || Laplace.Token is null || Laplace.Token.Length > 4096 || Laplace.Token.Any(char.IsControl))
            throw new ArgumentException("弹幕连接信息无效。");
        var bridge = new Uri(Laplace.Url);
        if (Laplace.StartLocalBridge && (!bridge.IsLoopback || bridge.Port != 9696 || bridge.AbsolutePath != "/"))
            throw new ArgumentException("本地桥接地址应为 ws://localhost:9696。");
    }
    public HostSettings Select(string id, bool keepAway = false)
    {
        if (!Scenes.Any(s => s.Id == id)) throw new ArgumentException("场景不存在。");
        return this with { SelectedSceneId = id, Away = Away with { Enabled = keepAway && Away.Enabled } };
    }
    public HostSettings SetAway(bool enabled)
    {
        if (enabled && Away.SceneId is null) throw new ArgumentException("请选择暂离场景。");
        return this with { Away = Away with { Enabled = enabled } };
    }
}

public sealed class SettingsStore
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public string DirectoryPath { get; }
    public string PresetsDirectory { get; }
    public string BundledPluginsDirectory { get; }
    public HostSettings Current { get; private set; }
    public bool IsNew { get; private set; }
    public SettingsStore(string directory, string? presetsDirectory = null, string? bundledPluginsDirectory = null)
    {
        DirectoryPath = Path.GetFullPath(directory);
        PresetsDirectory = Path.GetFullPath(presetsDirectory ?? Path.Combine(AppContext.BaseDirectory, "presets"));
        BundledPluginsDirectory = Path.GetFullPath(bundledPluginsDirectory ?? Path.Combine(AppContext.BaseDirectory, "plugins"));
        Directory.CreateDirectory(DirectoryPath);
        var file = Path.Combine(DirectoryPath, "core-settings.json");
        IsNew = !File.Exists(file);
        Current = IsNew ? HostSettings.Default : JsonSerializer.Deserialize<HostSettings>(File.ReadAllText(file), Json) ?? throw new ArgumentException("配置文件为空。");
        Current.Validate();
    }
    public async Task Save(HostSettings settings)
    {
        settings.Validate();
        var temporary = Path.Combine(DirectoryPath, "core-settings.tmp");
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(settings, Json));
        File.Move(temporary, Path.Combine(DirectoryPath, "core-settings.json"), true);
        Current = settings; IsNew = false;
    }
}

public static class WindowsStartup
{
    private const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Name = "StreamUI Core";
    public static string Arguments { get; set; } = "--no-open";
    public static bool Enabled { get { using var key = Registry.CurrentUser.OpenSubKey(Key); return key?.GetValue(Name) is string; } }
    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(Key);
        if (enabled) key.SetValue(Name, $"\"{Environment.ProcessPath}\" {Arguments}");
        else key.DeleteValue(Name, false);
    }
}
