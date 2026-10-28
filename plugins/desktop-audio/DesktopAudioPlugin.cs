using System.Text.Json;
using StreamUI.Contracts;
namespace StreamUI.DesktopAudio;

public record AudioSettings(bool Enabled = true, string DeviceId = "default", int Channel = -1, double Gain = 1);
public sealed class DesktopAudioPlugin : IStreamUIPlugin
{
    private readonly AudioService audio = new();
    private CancellationTokenSource? stop;
    private Task? worker;
    public Task StartAsync(IPluginContext context, CancellationToken stopping)
    {
        var settings = context.Settings.Deserialize<AudioSettings>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new();
        if (settings.DeviceId is null || settings.Channel is < -1 or > 31 || !double.IsFinite(settings.Gain) || settings.Gain is < 0 or > 4)
            throw new ArgumentException("音频设备、声道或增益无效。");
        AudioDevice[] devices;
        try { devices = Wasapi.Devices(); } catch { devices = []; }
        void Publish() => context.Publish("status", new { audio = audio.Status, devices });
        audio.Frame += bytes => context.PublishBinary("frames", bytes);
        audio.Changed += Publish;
        stop = CancellationTokenSource.CreateLinkedTokenSource(stopping);
        audio.Configure(settings); Publish();
        worker = Task.Run(async () => {
            try { using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1)); while (await timer.WaitForNextTickAsync(stop.Token)) Publish(); }
            catch (OperationCanceledException) { }
        });
        return Task.CompletedTask;
    }
    public async ValueTask DisposeAsync()
    {
        if (stop is not null) await stop.CancelAsync();
        audio.Dispose(); if (worker is not null) await worker; stop?.Dispose();
    }
}
