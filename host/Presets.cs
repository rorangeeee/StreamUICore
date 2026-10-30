using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace StreamUI;

public record PresetScene(string Id, string Name, string Entry, int Width = 1920, int Height = 1080,
    string Transition = "", string SettingsPage = "", string View = "", string RuntimeGroup = "", string Defaults = "", string Role = "scene");
public record PresetDependency(string Id, string MinimumVersion = "1.0.0", bool Required = true);
public record PresetManifest(int FormatVersion, int SdkVersion, string Id, string Name, string Version,
    string Description, PresetScene[] Scenes, string DefaultScene,
    string SettingsPage = "", string Defaults = "", PresetDependency[]? Plugins = null, string SidebarPage = "");
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
                if (manifest.FormatVersion != 1 || manifest.SdkVersion != 2) throw new ArgumentException("预设格式或浏览器 SDK 版本不兼容。");
                if (manifest.Id != id || string.IsNullOrWhiteSpace(manifest.Name) || !Version.TryParse(manifest.Version, out _)
                    || manifest.Scenes is null || manifest.Scenes.Length is < 1 or > 100 || manifest.SettingsPage is null || manifest.Defaults is null)
                    throw new ArgumentException("预设清单无效。");
                if (manifest.Scenes.Any(s => s is null || !Slug(s.Id) || string.IsNullOrWhiteSpace(s.Name)
                    || s.Entry is null || s.Transition is null || s.SettingsPage is null || s.RuntimeGroup is null || s.View is null || s.Defaults is null))
                    throw new ArgumentException("预设场景无效。");
                if (manifest.Scenes.Select(s => s.Id).Distinct().Count() != manifest.Scenes.Length || !manifest.Scenes.Any(s => s.Id == manifest.DefaultScene && s.Role == "scene"))
                    throw new ArgumentException("预设默认场景或场景 ID 无效。");
                foreach (var scene in manifest.Scenes)
                {
                    FileEntry(directory, scene.Entry, ".html"); FileEntry(directory, scene.Transition, ".js", true); FileEntry(directory, scene.SettingsPage, ".html", true);
                    FileEntry(directory, scene.Defaults, ".json", true);
                    if (scene.RuntimeGroup != "" && !Slug(scene.RuntimeGroup)) throw new ArgumentException("场景运行组无效。");
                }
                FileEntry(directory, manifest.SettingsPage, ".html", true); FileEntry(directory, manifest.Defaults, ".json", true);
                FileEntry(directory, manifest.SidebarPage, ".html", true);
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
            sidebarPage = manifest.SidebarPage == "" ? "" : $"presets/{id}/{manifest.SidebarPage}",
            requiredPlugins = Required(id) };
    }
    public string[] Required(string? id) => id is null || !manifests.TryGetValue(id, out var manifest) ? [] : (manifest.Plugins ?? []).Where(p => p.Required).Select(p => p.Id).ToArray();
    public string[] EffectivePlugins(HostSettings settings) => settings.EnabledPlugins.Concat(Required(settings.ActivePresetId)).Distinct().ToArray();
    public HostSettings Apply(HostSettings current, string? id, PluginInfo[] plugins)
    {
        if (id is null) return current with { ActivePresetId = null, Scenes = [], SelectedSceneId = null };
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
            s.Width, s.Height, s.Transition == "" ? "" : $"presets/{manifest.Id}/{s.Transition}",
            s.SettingsPage == "" ? "" : $"presets/{manifest.Id}/{s.SettingsPage}", s.Defaults == "" ? "" : $"presets/{manifest.Id}/{s.Defaults}")
            { PresetId = manifest.Id, SceneId = s.Id, View = s.View, Role = s.Role, RuntimeGroup = s.RuntimeGroup == "" ? "" : SceneId(manifest.Id, s.RuntimeGroup) }).ToArray(),
        SelectedSceneId = SceneId(manifest.Id, manifest.DefaultScene)
    };
    private static JsonObject Object(string json) => JsonSettings.Object(json);
    private JsonObject Defaults(string id)
    {
        var manifest = Get(id);
        return manifest.Defaults == "" ? new JsonObject() : Object(File.ReadAllText(Path.Combine(Root, id, manifest.Defaults)));
    }
    public JsonObject ReadSettings(string id)
    {
        var defaults = Defaults(id);
        var file = Path.Combine(data, "preset-settings", id + ".json");
        if (File.Exists(file)) JsonSettings.Merge(defaults, Object(File.ReadAllText(file)));
        return defaults;
    }
    public async Task SaveSettings(string id, JsonElement value, bool patch = false)
    {
        var defaults = Defaults(id);
        var submitted = JsonSettings.Object(value);
        var directory = Path.Combine(data, "preset-settings"); Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, id + ".json");
        var values = patch && File.Exists(file) ? Object(File.ReadAllText(file)) : new JsonObject();
        JsonSettings.Merge(values, submitted);
        var overrides = JsonSettings.Overrides(values, defaults);
        await File.WriteAllTextAsync(file + ".tmp", overrides.ToJsonString(SettingsStore.Json)); File.Move(file + ".tmp", file, true);
    }
}
