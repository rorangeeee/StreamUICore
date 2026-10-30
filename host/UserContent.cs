using System.Text.Json;
namespace StreamUI;
public sealed class UserContent
{
    public string Root { get; }
    public string Scenes => Path.Combine(Root, "scenes");
    public string Plugins { get; }
    public UserContent(string directory, string? pluginsDirectory = null)
    {
        Root = Path.GetFullPath(directory);
        Plugins = Path.GetFullPath(pluginsDirectory ?? Path.Combine(Root, "plugins"));
        foreach (var name in new[] { "scenes", "scene-settings", "plugin-settings" }) Directory.CreateDirectory(Path.Combine(Root, name));
        Directory.CreateDirectory(Plugins);
    }
    private string SettingsPath(string kind, string id)
    {
        if (kind is not ("scene" or "plugin") || !HostSettings.IsId(id)) throw new ArgumentException("设置对象无效。");
        return Path.Combine(Root, kind + "-settings", id + ".json");
    }
    public JsonElement ReadSettings(string kind, string id, System.Text.Json.Nodes.JsonObject? defaults = null)
    {
        var path = SettingsPath(kind, id);
        var values = defaults?.DeepClone().AsObject() ?? new System.Text.Json.Nodes.JsonObject();
        if (File.Exists(path)) JsonSettings.Merge(values, JsonSettings.Object(File.ReadAllText(path)));
        return JsonSerializer.SerializeToElement(values, SettingsStore.Json);
    }
    public async Task<bool> SaveSettings(string kind, string id, JsonElement settings, bool patch = false, System.Text.Json.Nodes.JsonObject? defaults = null)
    {
        var submitted = JsonSettings.Object(settings);
        var path = SettingsPath(kind, id);
        var values = patch ? JsonSettings.Object(ReadSettings(kind, id)) : new System.Text.Json.Nodes.JsonObject();
        JsonSettings.Merge(values, submitted);
        if (defaults is not null) values = JsonSettings.Overrides(values, defaults);
        if (File.Exists(path) && System.Text.Json.Nodes.JsonNode.DeepEquals(values, JsonSettings.Object(File.ReadAllText(path)))) return false;
        await File.WriteAllTextAsync(path + ".tmp", values.ToJsonString(SettingsStore.Json));
        File.Move(path + ".tmp", path, true);
        return true;
    }
}
