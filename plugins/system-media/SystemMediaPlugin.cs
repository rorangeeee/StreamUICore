using StreamUI.Contracts;
namespace StreamUI.SystemMedia;
public sealed class SystemMediaPlugin : IStreamUIPlugin
{
    private readonly NowPlayingService media = new();
    private CancellationTokenSource? stop;
    private Task? worker;
    public Task StartAsync(IPluginContext context, CancellationToken stopping)
    {
        void Publish() => context.Publish("track", media.Status);
        media.Changed += Publish; media.Start(); Publish();
        stop = CancellationTokenSource.CreateLinkedTokenSource(stopping);
        worker = Task.Run(async () => {
            try { using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1)); while (await timer.WaitForNextTickAsync(stop.Token)) Publish(); }
            catch (OperationCanceledException) { }
        });
        return Task.CompletedTask;
    }
    public async ValueTask DisposeAsync()
    {
        if (stop is not null) await stop.CancelAsync();
        await media.DisposeAsync(); if (worker is not null) await worker; stop?.Dispose();
    }
}
