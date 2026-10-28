using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;

namespace StreamUI;

public sealed class HostServer : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly SettingsStore store;
    private readonly UserContent content;
    private readonly ObsSceneService obs = new();
    private readonly LaplaceService chat;
    private readonly ChatEvents chatEvents = new();
    private readonly PluginHost plugins;
    private readonly PresetCatalog presets;
    private string? presetError;
    private readonly SocketHub events = new(WebSocketMessageType.Text, 128);
    private readonly SemaphoreSlim mutations = new(1);
    private readonly int obsPort, configPort;
    private long revision;
    private string reason = "startup";
    public string ObsUrl => $"http://127.0.0.1:{obsPort}/";
    public string ConfigUrl => $"http://127.0.0.1:{configPort}/";
    public event Action? ShutdownRequested;
    public event Action? SettingsChanged;
    private object State() => new {
        apiVersion = 1, scenes = store.Current.Scenes, preset = presets.Active(store.Current.ActivePresetId), presetError,
        scene = new { selectedId = store.Current.SelectedSceneId, activeId = store.Current.ActiveSceneId, away = store.Current.Away.Enabled, awaySceneId = store.Current.Away.SceneId, revision, reason },
        obs = obs.Status, chat = chat.Status, plugins = plugins.Status, outputUrl = ObsUrl, configUrl = ConfigUrl, startup = WindowsStartup.Enabled
    };
    private object StateMessage() => new { type = "state", data = State() };
    private void Broadcast() => events.Publish(StateMessage());
    private void Emit(string topic, object? data) => events.Publish(new { type = "event", topic, data });
    private async Task Save(HostSettings next, string cause)
    {
        await store.Save(next); revision++; reason = cause; Broadcast(); SettingsChanged?.Invoke();

    }
    public HostServer(SettingsStore store, string webRoot, int obsPort, int configPort)
    {
        this.store = store; this.obsPort = obsPort; this.configPort = configPort;
        content = new(store.DirectoryPath);
        if (store.IsNew) store.Save(store.Current).GetAwaiter().GetResult();
        Directory.CreateDirectory(store.PresetsDirectory);
        presets = new(store.PresetsDirectory, store.DirectoryPath);
        content.InitializePlugins(store.BundledPluginsDirectory);
        chat = new(store.DirectoryPath); plugins = new(content);
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
            var runtimeAction = path.StartsWith("/api/actions/", StringComparison.Ordinal);
            var admin = path.StartsWith("/api/", StringComparison.Ordinal) && path != "/api/state" && !runtimeAction
                && !(context.Request.Method == "GET" && (path.StartsWith("/api/scenes/", StringComparison.Ordinal) || path.StartsWith("/api/presets/", StringComparison.Ordinal)) && path.EndsWith("/settings", StringComparison.Ordinal));
            if (admin && context.Connection.LocalPort != configPort) { context.Response.StatusCode = 404; return; }
            if (mutation && context.Request.Headers["X-StreamUI-Request"] != "1") { context.Response.StatusCode = 403; return; }
            context.Response.Headers["X-Content-Type-Options"] = "nosniff"; context.Response.Headers.CacheControl = "no-store";
            try { await next(context); }
            catch (Exception error) when (error is ArgumentException or JsonException or BadHttpRequestException)
            { if (!context.Response.HasStarted) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = error.Message }); } }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            { if (!context.Response.HasStarted) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { error = error.Message }); } }
        });
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
        app.MapGet("/api/state", () => Results.Json(State(), SettingsStore.Json));
        app.MapGet("/api/settings", () => Results.Json(new BroadcasterSettings(store.Current.Obs, store.Current.Laplace, store.Current.EnabledPlugins), SettingsStore.Json));
        app.MapGet("/api/storage", () => Results.Json(new { directory = content.Root, scenes = content.Scenes, plugins = content.Plugins }));
        app.MapPut("/api/settings", async (HttpRequest request) => {
            var update = await request.ReadFromJsonAsync<BroadcasterSettings>(SettingsStore.Json) ?? throw new ArgumentException("配置为空。");
            await mutations.WaitAsync();
            try {
                var previous = store.Current;
                var next = previous with { Obs = update.Obs, Laplace = update.Laplace, EnabledPlugins = update.EnabledPlugins };
                next.Validate();
                await Save(next, "settings");
                if (previous.Obs != next.Obs) obs.Configure(next.Obs);
                if (previous.Laplace != next.Laplace) await chat.Configure(next.Laplace);
                if (!previous.EnabledPlugins.SequenceEqual(next.EnabledPlugins)) await plugins.Reload(presets.EffectivePlugins(next));
                Broadcast(); return Results.Json(State(), SettingsStore.Json);
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
                var previous = store.Current;
                var next = presets.Apply(previous, change.Id, plugins.Status); next.Validate();
                try {
                    await plugins.Reload(presets.EffectivePlugins(next));
                    var failed = plugins.Status.FirstOrDefault(p => presets.Required(next.ActivePresetId).Contains(p.Id) && p.State != "running");
                    if (failed is not null) throw new ArgumentException($"预设插件 {failed.Id} 启动失败：{failed.Error}");
                    await Save(next, "preset"); presetError = null; Broadcast();
                } catch { await plugins.Reload(presets.EffectivePlugins(previous)); throw; }
                return Results.Json(State(), SettingsStore.Json);
            } finally { mutations.Release(); }
        });
        app.MapGet("/api/presets/{id}/settings", (string id) => Results.Json(presets.ReadSettings(id), SettingsStore.Json));
        app.MapPut("/api/presets/{id}/settings", async (string id, HttpRequest request) => {
            using var json = await JsonDocument.ParseAsync(request.Body);
            await mutations.WaitAsync();
            try { await presets.SaveSettings(id, json.RootElement); Emit("preset.settingsChanged", new { id }); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapGet("/api/scenes/{id}/settings", (string id) => {
            if (!store.Current.Scenes.Any(s => s.Id == id)) return Results.NotFound();
            return Results.Json(content.ReadSettings("scene", id), SettingsStore.Json);
        });
        app.MapPut("/api/scenes/{id}/settings", async (string id, HttpRequest request) => {
            if (!store.Current.Scenes.Any(s => s.Id == id)) return Results.NotFound();
            using var json = await JsonDocument.ParseAsync(request.Body);
            await mutations.WaitAsync();
            try { await content.SaveSettings("scene", id, json.RootElement); Emit("scene.settingsChanged", new { id }); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapPost("/api/actions/scene", async (HttpRequest request) => {
            var change = await request.ReadFromJsonAsync<SelectSceneRequest>(SettingsStore.Json) ?? throw new ArgumentException("请选择场景。");
            await mutations.WaitAsync();
            try { await Save(store.Current.Select(change.Id), "manual"); return Results.Json(State(), SettingsStore.Json); }
            finally { mutations.Release(); }
        });
        app.MapPost("/api/actions/away", async (HttpRequest request) => {
            var change = await request.ReadFromJsonAsync<AwayRequest>(SettingsStore.Json);
            if (change?.Enabled is not bool enabled) throw new ArgumentException("暂离状态无效。");
            await SetAway(enabled); return Results.Json(State(), SettingsStore.Json);
        });
        app.MapPost("/api/obs/reconnect", () => { obs.Configure(store.Current.Obs); return Results.Ok(); });
        app.MapPost("/api/chat/reconnect", async () => { await mutations.WaitAsync(); try { await chat.Configure(store.Current.Laplace); return Results.Ok(); } finally { mutations.Release(); } });
        app.MapPost("/api/plugins/reload", async () => {
            await mutations.WaitAsync(); try { await plugins.Reload(presets.EffectivePlugins(store.Current)); return Results.Json(plugins.Status, SettingsStore.Json); } finally { mutations.Release(); }
        });
        app.MapGet("/api/plugins/{id}/settings", (string id) => plugins.Contains(id) ? Results.Json(content.ReadSettings("plugin", id), SettingsStore.Json) : Results.NotFound());
        app.MapPut("/api/plugins/{id}/settings", async (string id, HttpRequest request) => {
            if (!plugins.Contains(id)) return Results.NotFound();
            using var json = await JsonDocument.ParseAsync(request.Body);
            await mutations.WaitAsync();
            try { await content.SaveSettings("plugin", id, json.RootElement); await plugins.Restart(id); return Results.Ok(); } finally { mutations.Release(); }
        });
        app.MapPut("/api/startup", async (HttpRequest request) => {
            var data = await request.ReadFromJsonAsync<StartupRequest>() ?? throw new ArgumentException("启动设置为空。");
            WindowsStartup.Set(data.Enabled); Broadcast(); return Results.Ok();
        });
        app.MapPost("/api/open/{page}", (string page) => {
            var target = page switch { "obs" => ObsUrl, "config" => ConfigUrl, "data" => content.Root, "plugins" => content.Plugins, _ => null };
            if (target is null) return Results.NotFound(); Program.Open(target); return Results.Ok();
        });
        app.MapPost("/api/shutdown", (HttpResponse response) => { response.OnCompleted(() => { ShutdownRequested?.Invoke(); return Task.CompletedTask; }); return Results.Accepted(); });
        app.Map("/ws/events", context => events.Handle(context, StateMessage(), app.Lifetime.ApplicationStopping));
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
        obs.Changed += () => { Broadcast(); Emit("obs.status", obs.Status); };
        obs.SceneChanged += ApplyObsScene;
        chat.Changed += () => { Broadcast(); Emit("chat.status", chat.Status); };
        chat.Event += data => { if (chatEvents.Normalize(data) is { } item) Emit("chat." + item.Kind, item); };
        plugins.Publish += Emit; plugins.Changed += Broadcast;
    }
    public async Task Start()
    {
        await app.StartAsync();
        await plugins.Reload(store.Current.EnabledPlugins);
        if (store.Current.ActivePresetId is { } presetId)
        {
            try {
                var previous = store.Current;
                var restored = presets.Apply(previous, presetId, plugins.Status);
                restored = restored with { SelectedSceneId = restored.Scenes.Any(s => s.Id == previous.SelectedSceneId) ? previous.SelectedSceneId : restored.SelectedSceneId,
                    Away = restored.Away with { Enabled = previous.Away.Enabled && restored.Away.SceneId is not null } };
                await store.Save(restored); await plugins.Reload(presets.EffectivePlugins(restored));
            }
            catch (ArgumentException error) { presetError = error.Message; await store.Save(presets.Apply(store.Current, null, [])); }
        }
        obs.Configure(store.Current.Obs); await chat.Configure(store.Current.Laplace); Broadcast();
    }
    public async Task SetAway(bool enabled)
    {
        await mutations.WaitAsync();
        try { await Save(store.Current.SetAway(enabled), enabled ? "away" : "return");  }
        finally { mutations.Release(); }
    }
    private async Task ApplyObsScene(string name)
    {
        await mutations.WaitAsync();
        try {

            var target = store.Current.Scenes.FirstOrDefault(s => s.ObsScene == name && name.Length > 0);
            if (target is not null && target.Id != store.Current.SelectedSceneId) await Save(store.Current.Select(target.Id, keepAway: true), "obs");
        } finally { mutations.Release(); }
    }
    public async ValueTask DisposeAsync()
    {
        await obs.DisposeAsync(); await chat.DisposeAsync(); await plugins.DisposeAsync();
        await app.StopAsync(TimeSpan.FromSeconds(5)); await app.DisposeAsync(); mutations.Dispose();
    }
    private record SelectSceneRequest(string Id);
    private record PresetRequest(string? Id);
    private record AwayRequest(bool? Enabled);
    private record StartupRequest(bool Enabled);
}
