namespace StreamUI;

public enum ServiceState { Stopped, Starting, Running, Stopping, Error }

/// <summary>Owns a replaceable server so the tray remains available while the service is stopped.</summary>
public sealed class HostRuntime : IAsyncDisposable
{
    private readonly SettingsStore store;
    private readonly string root;
    private readonly int obsPort, configPort;
    private readonly SemaphoreSlim operations = new(1);
    private HostServer? server;
    public ServiceState State { get; private set; } = ServiceState.Stopped;
    public string? Error { get; private set; }
    public string ObsUrl => $"http://127.0.0.1:{obsPort}/";
    public string ConfigUrl => $"http://127.0.0.1:{configPort}/";
    public event Action? Changed;
    public event Action? ShutdownRequested;
    public HostRuntime(SettingsStore store, string root, int obsPort, int configPort)
    { this.store = store; this.root = root; this.obsPort = obsPort; this.configPort = configPort; }
    public async Task Start() { await operations.WaitAsync(); try { await StartCore(); } finally { operations.Release(); } }
    public async Task Stop() { await operations.WaitAsync(); try { await StopCore(); } finally { operations.Release(); } }
    public async Task Restart()
    {
        await operations.WaitAsync();
        try { await StopCore(); await StartCore(); }
        finally { operations.Release(); }
    }
    private async Task StartCore()
    {
        if (server is not null) return;
        Set(ServiceState.Starting);
        HostServer? next = null;
        try
        {
            next = new HostServer(store, root, obsPort, configPort);
            next.ShutdownRequested += () => ShutdownRequested?.Invoke();
            next.SettingsChanged += () => Changed?.Invoke();
            await next.Start(); server = next; Set(ServiceState.Running);
        }
        catch (Exception error)
        {
            try { if (next is not null) await next.DisposeAsync(); } catch { /* Preserve the original startup error. */ }
            Set(ServiceState.Error, error.Message); throw;
        }
    }
    private async Task StopCore()
    {
        if (server is null) { Set(ServiceState.Stopped); return; }
        Set(ServiceState.Stopping);
        var previous = server; server = null;
        try { await previous.DisposeAsync(); Set(ServiceState.Stopped); }
        catch (Exception error) { Set(ServiceState.Error, error.Message); throw; }
    }
    private void Set(ServiceState state, string? error = null) { State = state; Error = error; Changed?.Invoke(); }
    public async ValueTask DisposeAsync() { await Stop(); operations.Dispose(); }
}
