using System.Text.Json;
namespace StreamUI;
public sealed class UserContent
{
    public string Root { get; }
    public string Scenes => Path.Combine(Root, "scenes");
    public string Plugins => Path.Combine(Root, "plugins");
    public UserContent(string directory)
    {
        Root = Path.GetFullPath(directory);
        foreach (var name in new[] { "scenes", "plugins", "scene-settings", "plugin-settings" }) Directory.CreateDirectory(Path.Combine(Root, name));
    }
    public void InitializePlugins(string source)
    {
        if (!Directory.Exists(source) || Path.GetFullPath(source) == Path.GetFullPath(Plugins)) return;
        foreach (var directory in Directory.EnumerateDirectories(source))
        {
            if (!HostSettings.IsId(Path.GetFileName(directory)) || !File.Exists(Path.Combine(directory, "plugin.json"))) continue;
            var destination = Path.Combine(Plugins, Path.GetFileName(directory));
            if (Directory.Exists(destination)) continue;
            Copy(directory, destination);
        }
        static void Copy(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            foreach (var file in Directory.EnumerateFiles(source))
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
            foreach (var directory in Directory.EnumerateDirectories(source))
                if (!new[] { ".git", ".local", "bin", "obj", "node_modules" }.Contains(Path.GetFileName(directory))
                    && (File.GetAttributes(directory) & FileAttributes.ReparsePoint) == 0) Copy(directory, Path.Combine(destination, Path.GetFileName(directory)));
        }
    }
    private string SettingsPath(string kind, string id)
    {
        if (kind is not ("scene" or "plugin") || !HostSettings.IsId(id)) throw new ArgumentException("设置对象无效。");
        return Path.Combine(Root, kind + "-settings", id + ".json");
    }
    public JsonElement ReadSettings(string kind, string id)
    {
        var path = SettingsPath(kind, id);
        using var document = JsonDocument.Parse(File.Exists(path) ? File.ReadAllText(path) : "{}");
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new ArgumentException("设置应为 JSON 对象。");
        return document.RootElement.Clone();
    }
    public async Task SaveSettings(string kind, string id, JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object) throw new ArgumentException("设置应为 JSON 对象。");
        var path = SettingsPath(kind, id);
        await File.WriteAllTextAsync(path + ".tmp", settings.GetRawText());
        File.Move(path + ".tmp", path, true);
    }
}
