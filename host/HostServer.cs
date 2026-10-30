using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.FileProviders;

namespace StreamUI;

public sealed class HostServer : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly SettingsStore store;
    private readonly UserContent content;
    private readonly PluginHost plugins;
    private readonly PresetCatalog presets;
    private readonly SceneRuntime output;
    private readonly ConcurrentDictionary<string, SceneRuntime> previews = new();
    private readonly SemaphoreSlim mutations = new(1);
    private string? presetError;
    public string ObsUrl { get; }
    public string ConfigUrl { get; }
    public event Action? ShutdownRequested;
    public event Action? SettingsChanged;
    private SceneRuntime Scope(HttpRequest request)
    {
        var id = request.Query["preview"].ToString();
        return id == "" ? output : previews.GetValueOrDefault(id) ?? throw new KeyNotFoundException("预览已关闭。");
    }
    private object State(SceneRuntime scope) => new {
        apiVersion = 2, scenes = store.Current.Scenes, preset = presets.Active(store.Current.ActivePresetId), presetError,
        scene = scope.State, preview = !ReferenceEquals(scope, output), plugins = plugins.Status,
        outputUrl = ObsUrl, configUrl = ConfigUrl, startup = WindowsStartup.Enabled
    };
    private object Snapshot(SceneRuntime scope) => new { type = "state", data = State(scope) };
    private void Broadcast()
    {
        output.Events.Publish(Snapshot(output));
        foreach (var preview in previews.Values) preview.Events.Publish(Snapshot(preview));
        SettingsChanged?.Invoke();
    }
    private void Emit(string topic, object? data)
    {
        var message = new { type = "event", topic, data };
        output.Events.Publish(message);
        foreach (var preview in previews.Values) preview.Events.Publish(message);
    }
    private JsonObject SceneDefaults(SceneSlot scene)
    {
        if (scene.Defaults == "") return new();
        var file = scene.Defaults.StartsWith("presets/", StringComparison.Ordinal)
            ? Path.Combine(presets.Root, scene.Defaults["presets/".Length..]) : Path.Combine(content.Root, scene.Defaults);
        return JsonSettings.Object(File.ReadAllText(file));
    }
    public HostServer(SettingsStore store, string webRoot, int obsPort, int configPort)
    {
        this.store = store;
        ObsUrl = $"http://127.0.0.1:{obsPort}/"; ConfigUrl = $"http://127.0.0.1:{configPort}/";
        output = new(store.Current.SelectedSceneId);
        content = new(store.DirectoryPath, store.PluginsDirectory);
        Directory.CreateDirectory(store.PresetsDirectory);
        presets = new(store.PresetsDirectory, store.DirectoryPath); plugins = new(content);
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ContentRootPath = AppContext.BaseDirectory, WebRootPath = webRoot });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => {
            options.Listen(IPAddress.Loopback, obsPort); options.Listen(IPAddress.Loopback, configPort);
            options.Limits.MaxRequestBodySize = 64 * 1024;
        });
        app = builder.Build();
        app.Use(async (context, next) => {
            if (context.Request.Host.Host is not ("127.0.0.1" or "localhost") || context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote))
            { context.Response.StatusCode = 403; return; }
            var origin = context.Request.Headers.Origin.ToString();
            string[] allowed = [ObsUrl.TrimEnd('/'), ConfigUrl.TrimEnd('/'), $"http://localhost:{obsPort}", $"http://localhost:{configPort}", "http://127.0.0.1:5373", "http://localhost:5373"];
            if (origin.Length > 0 && !allowed.Contains(origin)) { context.Response.StatusCode = 403; return; }
            var path = context.Request.Path.Value ?? "";
            var mutation = context.Request.Method is not ("GET" or "HEAD");
            var publicRead = context.Request.Method == "GET" && (path.StartsWith("/api/scenes/", StringComparison.Ordinal) || path.StartsWith("/api/presets/", StringComparison.Ordinal)) && path.EndsWith("/settings", StringComparison.Ordinal);
            var admin = path.StartsWith("/api/", StringComparison.Ordinal) && path != "/api/state" && !path.StartsWith("/api/actions/", StringComparison.Ordinal) && !publicRead;
            if (admin && context.Connection.LocalPort != configPort) { context.Response.StatusCode = 404; return; }
            if (mutation && context.Request.Headers["X-StreamUI-Request"] != "1") { context.Response.StatusCode = 403; return; }
            context.Response.Headers["X-Content-Type-Options"] = "nosniff"; context.Response.Headers.CacheControl = "no-store";
            try { await next(context); }
            catch (KeyNotFoundException error) { if (!context.Response.HasStarted) { context.Response.StatusCode = 404; await context.Response.WriteAsJsonAsync(new { error = error.Message }); } }
            catch (Exception error) when (error is ArgumentException or JsonException or BadHttpRequestException)
            { if (!context.Response.HasStarted) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = error.Message }); } }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            { if (!context.Response.HasStarted) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { error = error.Message }); } }
        });
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
        app.MapGet("/api/state", (HttpRequest request) => Results.Json(State(Scope(request)), SettingsStore.Json));
        app.MapGet("/api/settings", () => Results.Json(new BroadcasterSettings(store.Current.EnabledPlugins), SettingsStore.Json));
        app.MapGet("/api/storage", () => Results.Json(new { directory = content.Root, scenes = content.Scenes, plugins = content.Plugins, presets = presets.Root }));
        app.MapMethods("/api/settings", ["PUT", "PATCH"], async (HttpRequest request) => {
            var update = await request.ReadFromJsonAsync<BroadcasterSettings>(SettingsStore.Json) ?? throw new ArgumentException("配置为空。");
            await mutations.WaitAsync();
            try {
                var next = store.Current with { EnabledPlugins = update.EnabledPlugins }; next.Validate();
                await store.Save(next); await plugins.Reload(presets.EffectivePlugins(next)); Broadcast();
                return Results.Json(State(output), SettingsStore.Json);
            } finally { mutations.Release(); }
        });
        app.MapPost("/api/previews", () => {
            var id = Guid.NewGuid().ToString("N");
            previews[id] = new(output.ActiveId);
            return Results.Json(new { id, state = State(previews[id]) }, SettingsStore.Json);
        });
        app.MapDelete("/api/previews/{id}", (string id) => {
            if (previews.TryRemove(id, out var preview)) preview.Dispose();
            return Results.NoContent();
        });
        app.MapPost("/api/actions/scene", async (HttpRequest request) => {
            var change = await request.ReadFromJsonAsync<SelectSceneRequest>() ?? throw new ArgumentException("请选择场景。");
            await mutations.WaitAsync();
            try {
                var next = store.Current.Select(change.Id); var scope = Scope(request);
                if (scope.Accept(change.Cue, change.StartedAt)) {
                    if (ReferenceEquals(scope, output)) await store.Save(next);
                    scope.Select(change.Id, change.Animate, change.Cue, change.StartedAt);
                    if (ReferenceEquals(scope, output)) Broadcast(); else scope.Events.Publish(Snapshot(scope));
                }
                return Results.Json(State(scope), SettingsStore.Json);
            } finally { mutations.Release(); }
        });
        app.MapGet("/api/presets", () => Results.Json(presets.Items, SettingsStore.Json));
        app.MapPost("/api/presets/reload", async () => {
            await mutations.WaitAsync();
            try { presets.Reload(); return Results.Json(presets.Items, SettingsStore.Json); }
            finally { mutations.Release(); }
        });
        app.MapPost("/api/presets/activate", async (HttpRequest request) => {
            var change = await request.ReadFromJsonAsync<PresetRequest>() ?? throw new ArgumentException("请选择预设。");
            await mutations.WaitAsync();
            try {
                var previous = store.Current; var next = presets.Apply(previous, change.Id, plugins.Status); next.Validate();
                try {
                    await plugins.Reload(presets.EffectivePlugins(next));
                    var failed = plugins.Status.FirstOrDefault(p => presets.Required(next.ActivePresetId).Contains(p.Id) && p.State != "running");
                    if (failed is not null) throw new ArgumentException($"预设插件 {failed.Id} 启动失败：{failed.Error}");
                    await store.Save(next); presetError = null; output.Reset(next.SelectedSceneId);
                    foreach (var preview in previews.Values) preview.Reset(next.SelectedSceneId);
                    Broadcast();
                } catch { await plugins.Reload(presets.EffectivePlugins(previous)); throw; }
                return Results.Json(State(output), SettingsStore.Json);
            } finally { mutations.Release(); }
        });
        app.MapGet("/api/presets/{id}/settings", (string id) => Results.Json(presets.ReadSettings(id), SettingsStore.Json));
        app.MapMethods("/api/presets/{id}/settings", ["PUT", "PATCH"], async (string id, HttpRequest request) => {
            using var json = await JsonDocument.ParseAsync(request.Body); await mutations.WaitAsync();
            try { await presets.SaveSettings(id, json.RootElement, request.Method == "PATCH"); Emit("preset.settingsChanged", new { id }); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapGet("/api/scenes/{id}/settings", (string id, HttpRequest request) => {
            var scene = store.Current.Scenes.FirstOrDefault(s => s.Id == id);
            return scene is null ? Results.NotFound() : Results.Json(content.ReadSettings("scene", id, request.Query.ContainsKey("overrides") ? null : SceneDefaults(scene)), SettingsStore.Json);
        });
        app.MapMethods("/api/scenes/{id}/settings", ["PUT", "PATCH"], async (string id, HttpRequest request) => {
            var scene = store.Current.Scenes.FirstOrDefault(s => s.Id == id); if (scene is null) return Results.NotFound();
            using var json = await JsonDocument.ParseAsync(request.Body); await mutations.WaitAsync();
            try { await content.SaveSettings("scene", id, json.RootElement, request.Method == "PATCH", SceneDefaults(scene)); Emit("scene.settingsChanged", new { id }); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapPost("/api/plugins/reload", async () => {
            await mutations.WaitAsync();
            try { await plugins.Reload(presets.EffectivePlugins(store.Current)); Broadcast(); return Results.Json(plugins.Status, SettingsStore.Json); }
            finally { mutations.Release(); }
        });
        app.MapGet("/api/plugins/{id}/settings", (string id) => plugins.Contains(id) ? Results.Json(content.ReadSettings("plugin", id), SettingsStore.Json) : Results.NotFound());
        app.MapMethods("/api/plugins/{id}/settings", ["PUT", "PATCH"], async (string id, HttpRequest request) => {
            if (!plugins.Contains(id)) return Results.NotFound();
            using var json = await JsonDocument.ParseAsync(request.Body); await mutations.WaitAsync();
            try { if (await content.SaveSettings("plugin", id, json.RootElement, request.Method == "PATCH")) await plugins.Restart(id); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapPut("/api/startup", async (HttpRequest request) => {
            var data = await request.ReadFromJsonAsync<StartupRequest>() ?? throw new ArgumentException("启动设置为空。");
            WindowsStartup.Set(data.Enabled); Broadcast(); return Results.Ok();
        });
        app.MapPost("/api/open/{page}", (string page) => {
            var target = page switch { "obs" => ObsUrl, "config" => ConfigUrl, "data" => content.Root, "plugins" => content.Plugins, "presets" => presets.Root, _ => null };
            if (target is null) return Results.NotFound(); Program.Open(target); return Results.Ok();
        });
        app.MapPost("/api/shutdown", (HttpResponse response) => { response.OnCompleted(() => { ShutdownRequested?.Invoke(); return Task.CompletedTask; }); return Results.Accepted(); });
        app.Map("/ws/events", (HttpContext context) => {
            var scope = Scope(context.Request);
            return scope.Events.Handle(context, Snapshot(scope), scope.Lifetime.Token);
        });
        app.Map("/ws/plugins/{id}/{topic}", (HttpContext context, string id, string topic) => plugins.HandleBinary(context, id, topic, app.Lifetime.ApplicationStopping));
        app.Use(async (context, next) => {
            if (context.Request.Path == "/" || context.Request.Path == "/index.html")
            { context.Response.ContentType = "text/html; charset=utf-8"; await context.Response.SendFileAsync(Path.Combine(webRoot, context.Connection.LocalPort == configPort ? "config.html" : "index.html")); return; }
            if (context.Request.Path == "/config.html" && context.Connection.LocalPort != configPort) { context.Response.StatusCode = 404; return; }
            await next(context);
        });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(content.Scenes), RequestPath = "/user/scenes" });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(presets.Root), RequestPath = "/user/presets" });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(content.Plugins), RequestPath = "/user/plugins" });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(webRoot) });
        plugins.Publish += Emit; plugins.Changed += Broadcast;
    }
    public async Task Start()
    {
        await plugins.Reload(store.Current.EnabledPlugins);
        if (store.Current.ActivePresetId is { } presetId) {
            try {
                var previous = store.Current; var restored = presets.Apply(previous, presetId, plugins.Status);
                restored = restored with { SelectedSceneId = restored.Scenes.Any(s => s.Id == previous.SelectedSceneId && s.Role == "scene") ? previous.SelectedSceneId : restored.SelectedSceneId };
                await store.Save(restored); await plugins.Reload(presets.EffectivePlugins(restored));
            } catch (ArgumentException error) { presetError = error.Message; await store.Save(presets.Apply(store.Current, null, [])); }
        }
        else await store.Save(store.Current);
        output.Reset(store.Current.SelectedSceneId); await app.StartAsync(); Broadcast();
    }
    public async ValueTask DisposeAsync()
    {
        output.Dispose(); foreach (var preview in previews.Values) preview.Dispose(); previews.Clear();
        await plugins.DisposeAsync(); await app.StopAsync(TimeSpan.FromSeconds(5)); await app.DisposeAsync(); mutations.Dispose();
    }
    private record SelectSceneRequest(string Id, bool Animate = true, string? Cue = null, long? StartedAt = null);
    private record PresetRequest(string? Id);
    private record StartupRequest(bool Enabled);
}
