using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace StreamUI;

public record SceneSlot(string Id, string Name, string Entry, int Width = 1920, int Height = 1080, string Transition = "", string SettingsPage = "", string Defaults = "")
{
    public string PresetId { get; init; } = "";
    public string SceneId { get; init; } = "";
    public string View { get; init; } = "";
    public string RuntimeGroup { get; init; } = "";
    public string Role { get; init; } = "scene";
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record BroadcasterSettings(string[] EnabledPlugins);
public record HostSettings
{
    public int FormatVersion { get; init; } = 2;
    public SceneSlot[] Scenes { get; init; } = [];
    public string? SelectedSceneId { get; init; }
    public string? ActivePresetId { get; init; }
    public string[] EnabledPlugins { get; init; } = [];
    public static HostSettings Default => new();
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
            || s.Width is < 320 or > 7680 || s.Height is < 180 or > 4320 || s.Entry is null || s.Transition is null || s.SettingsPage is null || s.Defaults is null || s.Role is not ("scene" or "overlay")))
            throw new ArgumentException("场景信息无效。");
        if (Scenes.Select(s => s.Id).Distinct().Count() != Scenes.Length) throw new ArgumentException("场景 ID 重复。");
        foreach (var scene in Scenes)
        {
            void ContentPath(string path, string extension) => ValidatePath(path, path.StartsWith("presets/", StringComparison.Ordinal) ? "presets" : "scenes", extension);
            ContentPath(scene.Entry, ".html");
            if (scene.Transition.Length > 0) ContentPath(scene.Transition, ".js");
            if (scene.SettingsPage.Length > 0) ContentPath(scene.SettingsPage, ".html");
            if (scene.Defaults.Length > 0) ContentPath(scene.Defaults, ".json");
        }
        if (ActivePresetId is not null && !IsId(ActivePresetId)) throw new ArgumentException("预设 ID 无效。");
        if (SelectedSceneId is not null && !Scenes.Any(s => s.Id == SelectedSceneId && s.Role == "scene")) throw new ArgumentException("所选主场景不存在。");
        if (EnabledPlugins is null || EnabledPlugins.Any(id => !IsId(id)) || EnabledPlugins.Distinct().Count() != EnabledPlugins.Length)
            throw new ArgumentException("插件 ID 无效。");
    }
    public HostSettings Select(string id)
    {
        if (!Scenes.Any(s => s.Id == id && s.Role == "scene")) throw new ArgumentException("请选择主场景。");
        return this with { SelectedSceneId = id };
    }
}

public sealed class SettingsStore
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public string DirectoryPath { get; }
    public string PresetsDirectory { get; }
    public string PluginsDirectory { get; }
    public HostSettings Current { get; private set; }
    public bool IsNew { get; private set; }
    public SettingsStore(string directory, string? presetsDirectory = null, string? pluginsDirectory = null)
    {
        DirectoryPath = Path.GetFullPath(directory);
        PresetsDirectory = Path.GetFullPath(presetsDirectory ?? Path.Combine(AppContext.BaseDirectory, "presets"));
        PluginsDirectory = Path.GetFullPath(pluginsDirectory ?? Path.Combine(AppContext.BaseDirectory, "plugins"));
        Directory.CreateDirectory(DirectoryPath);
        var file = Path.Combine(DirectoryPath, "core-settings.json");
        IsNew = !File.Exists(file);
        if (!IsNew)
        {
            var original = File.ReadAllText(file);
            using var document = JsonDocument.Parse(original);
            if (!document.RootElement.TryGetProperty("formatVersion", out _) && !File.Exists(Path.Combine(DirectoryPath, "core-settings.v1.json")))
                File.WriteAllText(Path.Combine(DirectoryPath, "core-settings.v1.json"), original);
            Current = JsonSerializer.Deserialize<HostSettings>(original, Json) ?? throw new ArgumentException("配置文件为空。");
        }
        else Current = HostSettings.Default;
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
