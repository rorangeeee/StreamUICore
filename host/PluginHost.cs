using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Net.WebSockets;
using StreamUI.Contracts;

namespace StreamUI;

public record PluginManifest(string Id, string Name, string Version, string Assembly, string Type, string[] Capabilities, string SettingsPage = "");
public record PluginInfo(string Id, string Name, string Version, string[] Capabilities, string SettingsPage, bool Enabled, string State, string? Error);

public sealed class PluginHost : IAsyncDisposable
{
    private sealed class PluginLoadContext(string file) : AssemblyLoadContext(isCollectible: true)
    {
        private readonly AssemblyDependencyResolver resolver = new(file);
        protected override Assembly? Load(AssemblyName name)
        {
            if (name.Name == typeof(IStreamUIPlugin).Assembly.GetName().Name) return typeof(IStreamUIPlugin).Assembly;
            return resolver.ResolveAssemblyToPath(name) is { } path ? LoadFromAssemblyPath(path) : null;
        }
        protected override nint LoadUnmanagedDll(string name) => resolver.ResolveUnmanagedDllToPath(name) is { } path ? LoadUnmanagedDllFromPath(path) : 0;
    }
    private sealed class Entry(PluginManifest manifest)
    {
        public PluginManifest Manifest = manifest;
        public bool Enabled;
        public string State = "disabled";
        public string? Error;
        public IStreamUIPlugin? Instance;
        public PluginLoadContext? Loader;
        public CancellationTokenSource? Lifetime;
        public readonly ConcurrentDictionary<string, SocketHub> Binary = new();
    }
    private sealed class Context(PluginHost owner, Entry entry, JsonElement settings, string dataDirectory) : IPluginContext
    {
        public string Id => entry.Manifest.Id;
        public string DataDirectory => dataDirectory;
        public JsonElement Settings => settings;
        public void Publish(string topic, object? data)
        {
            ValidateTopic(topic);
            if (entry.Lifetime?.IsCancellationRequested == false) owner.Publish?.Invoke("plugin." + Id + "." + topic, data);
        }
        public void PublishBinary(string topic, ReadOnlyMemory<byte> data)
        {
            ValidateTopic(topic);
            if (entry.Lifetime?.IsCancellationRequested == false) entry.Binary.GetOrAdd(topic, _ => new(WebSocketMessageType.Binary, 2)).Publish(data.ToArray());
        }
    }
    private readonly UserContent content;
    private readonly ConcurrentDictionary<string, Entry> entries = new();
    public event Action<string, object?>? Publish;
    public event Action? Changed;
    public PluginHost(UserContent content) { this.content = content; }
    public PluginInfo[] Status => entries.Values.OrderBy(e => e.Manifest.Name).Select(e => new PluginInfo(
        e.Manifest.Id, e.Manifest.Name, e.Manifest.Version, e.Manifest.Capabilities, e.Manifest.SettingsPage, e.Enabled, e.State, e.Error)).ToArray();
    public bool Contains(string id) => entries.ContainsKey(id);
    private static void ValidateTopic(string topic)
    {
        if (!Regex.IsMatch(topic, "^[a-z0-9][a-z0-9._-]{0,79}$")) throw new ArgumentException("事件名称无效。");
    }
    private static void ValidateFile(string value, string extension)
    {
        if (string.IsNullOrWhiteSpace(value) || Path.IsPathRooted(value) || value.Contains('\\') || value.Contains(':')
            || value.Split('/').Any(s => s is "" or "." or "..") || !value.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("插件文件路径无效。");
    }
    public async Task Reload(string[] enabled)
    {
        await StopAll();
        entries.Clear();
        foreach (var directory in Directory.EnumerateDirectories(content.Plugins))
        {
            var id = Path.GetFileName(directory);
            if (!HostSettings.IsId(id) || !File.Exists(Path.Combine(directory, "plugin.json"))) continue;
            try
            {
                var manifest = JsonSerializer.Deserialize<PluginManifest>(await File.ReadAllTextAsync(Path.Combine(directory, "plugin.json")), SettingsStore.Json)
                    ?? throw new ArgumentException("插件清单为空。");
                if (manifest.Id != id || string.IsNullOrWhiteSpace(manifest.Name) || string.IsNullOrWhiteSpace(manifest.Version)
                    || string.IsNullOrWhiteSpace(manifest.Type) || manifest.Capabilities is null || manifest.SettingsPage is null || manifest.Capabilities.Any(c => string.IsNullOrWhiteSpace(c) || c.Length > 100)) throw new ArgumentException("插件清单无效。");
                ValidateFile(manifest.Assembly, ".dll");
                if (manifest.SettingsPage.Length > 0) ValidateFile(manifest.SettingsPage, ".html");
                entries[id] = new(manifest) { Enabled = enabled.Contains(id) };
            }
            catch (Exception error) when (error is JsonException or ArgumentException or IOException)
            {
                entries[id] = new(new(id, id, "", "", "", [])) { Enabled = enabled.Contains(id), State = "error", Error = error.Message };
            }
        }
        foreach (var entry in entries.Values.Where(e => e.Enabled && e.Error is null)) await Start(entry);
        Changed?.Invoke();
    }
    private async Task Start(Entry entry)
    {
        try
        {
            entry.State = "starting"; entry.Error = null;
            var root = Path.Combine(content.Plugins, entry.Manifest.Id);
            entry.Lifetime = new();
            entry.Loader = new(Path.GetFullPath(Path.Combine(root, entry.Manifest.Assembly)));
            var assembly = entry.Loader.LoadFromAssemblyPath(Path.GetFullPath(Path.Combine(root, entry.Manifest.Assembly)));
            var type = assembly.GetType(entry.Manifest.Type, throwOnError: true)!;
            entry.Instance = Activator.CreateInstance(type) as IStreamUIPlugin ?? throw new ArgumentException("插件必须实现 IStreamUIPlugin。");
            var data = Path.Combine(content.Root, "plugin-data", entry.Manifest.Id);
            Directory.CreateDirectory(data);
            await entry.Instance.StartAsync(new Context(this, entry, content.ReadSettings("plugin", entry.Manifest.Id), data), entry.Lifetime.Token).WaitAsync(TimeSpan.FromSeconds(10));
            entry.State = "running";
        }
        catch (Exception error)
        {
            await Stop(entry);
            entry.State = "error"; entry.Error = error.GetBaseException().Message;
        }
    }
    private static async Task Stop(Entry entry)
    {
        if (entry.Lifetime is { } lifetime) await lifetime.CancelAsync();
        if (entry.Instance is { } instance)
        {
            try { await instance.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5)); }
            catch (Exception error) { entry.Error = error.GetBaseException().Message; }
        }
        entry.Instance = null; entry.Lifetime?.Dispose(); entry.Lifetime = null;
        entry.Binary.Clear(); entry.Loader?.Unload(); entry.Loader = null;
        entry.State = "disabled";
    }
    public async Task Restart(string id)
    {
        if (!entries.TryGetValue(id, out var entry)) throw new ArgumentException("插件不存在。");
        await Stop(entry);
        if (entry.Enabled) await Start(entry);
        Changed?.Invoke();
    }
    public Task HandleBinary(HttpContext context, string id, string topic, CancellationToken stopping)
    {
        ValidateTopic(topic);
        if (!entries.TryGetValue(id, out var entry) || entry.State != "running" || entry.Lifetime is not { } lifetime)
        { context.Response.StatusCode = 404; return Task.CompletedTask; }
        CancellationToken pluginToken;
        try { pluginToken = lifetime.Token; }
        catch (ObjectDisposedException) { context.Response.StatusCode = 404; return Task.CompletedTask; }
        return Handle(pluginToken);
        async Task Handle(CancellationToken token)
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(stopping, token);
            await entry.Binary.GetOrAdd(topic, _ => new(WebSocketMessageType.Binary, 2)).Handle(context, stopping: linked.Token);
        }
    }
    private async Task StopAll() { foreach (var entry in entries.Values) await Stop(entry); }
    public async ValueTask DisposeAsync() { await StopAll(); }
}
