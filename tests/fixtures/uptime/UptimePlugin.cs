using StreamUI.Contracts;
namespace StreamUI.Examples;
public sealed class UptimePlugin : IStreamUIPlugin
{
    private Task? worker;
    public Task StartAsync(IPluginContext context, CancellationToken stopping)
    {
        var interval = context.Settings.TryGetProperty("interval", out var value) && value.TryGetInt32(out var milliseconds) ? Math.Clamp(milliseconds, 100, 60000) : 1000;
        worker = Task.Run(async () => {
            try {
                while (!stopping.IsCancellationRequested) {
                    var uptime = Environment.TickCount64;
                    context.Publish("tick", new { uptimeMs = uptime });
                    context.PublishBinary("raw", BitConverter.GetBytes(uptime));
                    await Task.Delay(interval, stopping);
                }
            } catch (OperationCanceledException) when (stopping.IsCancellationRequested) { }
        }, stopping);
        return Task.CompletedTask;
    }
    public async ValueTask DisposeAsync() { if (worker is not null) await worker; }
}
