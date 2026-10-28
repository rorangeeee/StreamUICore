using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace StreamUI;

public record PresetScene(string Id, string Name, string Entry, int Width = 1920, int Height = 1080,
    string Transition = "", string SettingsPage = "", string View = "", string RuntimeGroup = "", string ObsScene = "");
public record PresetDependency(string Id, string MinimumVersion = "1.0.0", bool Required = true);
public record PresetManifest(int FormatVersion, int SdkVersion, string Id, string Name, string Version,
    string Description, PresetScene[] Scenes, string DefaultScene, string? AwayScene = null,
    string SettingsPage = "", string Defaults = "", PresetDependency[]? Plugins = null);
public record PresetInfo(string Id, string Name, string Version, string Description, int SceneCount,
    PresetDependency[] Plugins, bool Available, string? Error);

public sealed class PresetCatalog
{
    private readonly Dictionary<string, PresetManifest> manifests = new();
    private PresetInfo[] items = [];
    private readonly string data;
    public string Root { get; }
    public PresetInfo[] Items => items;
    public PresetCatalog(string root, string dataDirectory) { Root = Path.GetFullPath(root); data = dataDirectory; Reload(); }
    private static bool Slug(string? id) => id is not null && Regex.IsMatch(id, "^[a-z0-9][a-z0-9-]{0,29}$");
    public static string SceneId(string preset, string scene) => preset + "__" + scene;
    private static string Relative(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Contains('\\') || path.Contains(':') || path.Contains('%')
            || path.Contains('?') || path.Contains('#') || path.Split('/').Any(part => part is "" or "." or ".."))
            throw new ArgumentException("预设路径必须位于自己的目录内。");
        return path;
    }
    private static void CheckTree(string directory)
    {
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("预设不能使用符号链接。");
        foreach (var entry in Directory.EnumerateFileSystemEntries(directory))
        {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("预设不能使用符号链接。");
            if ((attributes & FileAttributes.Directory) != 0) CheckTree(entry);
        }
    }
    private static void FileEntry(string directory, string value, string extension, bool optional = false)
    {
        if (optional && value == "") return;
        Relative(value);
        if (!value.EndsWith(extension, StringComparison.OrdinalIgnoreCase) || !File.Exists(Path.Combine(directory, value)))
            throw new ArgumentException("预设文件不存在或类型不匹配：" + value);
    }
    public void Reload()
    {
        manifests.Clear(); var found = new List<PresetInfo>();
        if (Directory.Exists(Root)) foreach (var directory in Directory.EnumerateDirectories(Root).Order())
        {
            var id = Path.GetFileName(directory);
            if (!File.Exists(Path.Combine(directory, "preset.json"))) continue;
            try
            {
                if (!Slug(id)) throw new ArgumentException("预设目录 ID 无效。");
                CheckTree(directory);
                var manifest = JsonSerializer.Deserialize<PresetManifest>(File.ReadAllText(Path.Combine(directory, "preset.json")), SettingsStore.Json)
                    ?? throw new ArgumentException("预设清单为空。");
                if (manifest.FormatVersion != 1 || manifest.SdkVersion != 1) throw new ArgumentException("预设格式或 SDK 版本不兼容。");
                if (manifest.Id != id || string.IsNullOrWhiteSpace(manifest.Name) || !Version.TryParse(manifest.Version, out _)
                    || manifest.Scenes is null || manifest.Scenes.Length is < 1 or > 100 || manifest.SettingsPage is null || manifest.Defaults is null)
                    throw new ArgumentException("预设清单无效。");
                if (manifest.Scenes.Any(s => s is null || !Slug(s.Id) || string.IsNullOrWhiteSpace(s.Name)
                    || s.Entry is null || s.Transition is null || s.SettingsPage is null || s.RuntimeGroup is null || s.View is null || s.ObsScene is null))
                    throw new ArgumentException("预设场景无效。");
                if (manifest.Scenes.Select(s => s.Id).Distinct().Count() != manifest.Scenes.Length
                    || !manifest.Scenes.Any(s => s.Id == manifest.DefaultScene)
                    || manifest.AwayScene is not null && !manifest.Scenes.Any(s => s.Id == manifest.AwayScene))
                    throw new ArgumentException("预设默认场景、暂离场景或场景 ID 无效。");
                foreach (var scene in manifest.Scenes)
                {
                    FileEntry(directory, scene.Entry, ".html"); FileEntry(directory, scene.Transition, ".js", true); FileEntry(directory, scene.SettingsPage, ".html", true);
                    if (scene.RuntimeGroup != "" && !Slug(scene.RuntimeGroup)) throw new ArgumentException("场景运行组无效。");
                }
                FileEntry(directory, manifest.SettingsPage, ".html", true); FileEntry(directory, manifest.Defaults, ".json", true);
                if (manifest.Defaults != "") Object(File.ReadAllText(Path.Combine(directory, manifest.Defaults)));
                var dependencies = manifest.Plugins ?? [];
                if (dependencies.Any(p => p is null || !HostSettings.IsId(p.Id) || !Version.TryParse(p.MinimumVersion, out _))
                    || dependencies.Select(p => p.Id).Distinct().Count() != dependencies.Length) throw new ArgumentException("预设插件依赖无效。");
                var candidate = ApplyManifest(HostSettings.Default, manifest); candidate.Validate();
                manifests[id] = manifest;
                found.Add(new(id, manifest.Name, manifest.Version, manifest.Description ?? "", manifest.Scenes.Length, dependencies, true, null));
            }
            catch (Exception error) when (error is JsonException or ArgumentException or IOException or UnauthorizedAccessException)
            { found.Add(new(id, id, "", "", 0, [], false, error.Message)); }
        }
        items = found.ToArray();
    }
    public PresetManifest Get(string id) => manifests.GetValueOrDefault(id) ?? throw new ArgumentException("预设不可用或不存在。");
    public object? Active(string? id)
    {
        if (id is null || !manifests.TryGetValue(id, out var manifest)) return null;
        return new { manifest.Id, manifest.Name, manifest.Version, manifest.Description,
            settingsPage = manifest.SettingsPage == "" ? "" : $"presets/{id}/{manifest.SettingsPage}",
            requiredPlugins = Required(id) };
    }
    public string[] Required(string? id) => id is null || !manifests.TryGetValue(id, out var manifest) ? [] : (manifest.Plugins ?? []).Where(p => p.Required).Select(p => p.Id).ToArray();
    public string[] EffectivePlugins(HostSettings settings) => settings.EnabledPlugins.Concat(Required(settings.ActivePresetId)).Distinct().ToArray();
    public HostSettings Apply(HostSettings current, string? id, PluginInfo[] plugins)
    {
        if (id is null) return current with { ActivePresetId = null, Scenes = [], SelectedSceneId = null, Away = new(false, null) };
        var manifest = Get(id);
        foreach (var dependency in (manifest.Plugins ?? []).Where(p => p.Required))
        {
            var installed = plugins.FirstOrDefault(p => p.Id == dependency.Id);
            if (installed is null || !Version.TryParse(installed.Version, out var version) || version < Version.Parse(dependency.MinimumVersion))
                throw new ArgumentException($"预设需要插件 {dependency.Id} {dependency.MinimumVersion} 或更高版本。");
        }
        return ApplyManifest(current, manifest);
    }
    private static HostSettings ApplyManifest(HostSettings current, PresetManifest manifest) => current with
    {
        ActivePresetId = manifest.Id,
        Scenes = manifest.Scenes.Select(s => new SceneSlot(SceneId(manifest.Id, s.Id), s.Name, $"presets/{manifest.Id}/{s.Entry}",
            s.ObsScene, s.Width, s.Height, s.Transition == "" ? "" : $"presets/{manifest.Id}/{s.Transition}",
            s.SettingsPage == "" ? "" : $"presets/{manifest.Id}/{s.SettingsPage}")
            { PresetId = manifest.Id, SceneId = s.Id, View = s.View, RuntimeGroup = s.RuntimeGroup == "" ? "" : SceneId(manifest.Id, s.RuntimeGroup) }).ToArray(),
        SelectedSceneId = SceneId(manifest.Id, manifest.DefaultScene),
        Away = new(false, manifest.AwayScene is null ? null : SceneId(manifest.Id, manifest.AwayScene))
    };
    private static JsonObject Object(string json) => JsonNode.Parse(json) as JsonObject ?? throw new ArgumentException("预设参数应为 JSON 对象。");
    private static void Merge(JsonObject target, JsonObject source)
    {
        foreach (var (key, value) in source)
            if (target[key] is JsonObject before && value is JsonObject after) Merge(before, after);
            else target[key] = value?.DeepClone();
    }
    public JsonObject ReadSettings(string id)
    {
        var manifest = Get(id);
        var defaults = manifest.Defaults == "" ? new JsonObject() : Object(File.ReadAllText(Path.Combine(Root, id, manifest.Defaults)));
        var file = Path.Combine(data, "preset-settings", id + ".json");
        if (File.Exists(file)) Merge(defaults, Object(File.ReadAllText(file)));
        return defaults;
    }
    public async Task SaveSettings(string id, JsonElement value)
    {
        Get(id);
        if (value.ValueKind != JsonValueKind.Object) throw new ArgumentException("预设参数应为 JSON 对象。");
        var directory = Path.Combine(data, "preset-settings"); Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, id + ".json");
        await File.WriteAllTextAsync(file + ".tmp", value.GetRawText()); File.Move(file + ".tmp", file, true);
    }
}
