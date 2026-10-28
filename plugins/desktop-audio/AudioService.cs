using System.Diagnostics;

namespace StreamUI.DesktopAudio;

public record AudioStatus(string State, string? Error = null, string? DeviceId = null, int SampleRate = 0, int Channels = 0, int DeviceSampleRate = 0, double FrameRate = 0);
public sealed class AudioService : IDisposable
{
    public const int TargetFrameRate = 60;
    private CancellationTokenSource? cancellation;
    private Thread? thread;
    private volatile AudioStatus status = new("idle");
    public AudioStatus Status => status;
    public event Action<byte[]>? Frame;
    public event Action? Changed;
    public void Configure(AudioSettings settings)
    {
        Stop();
        if (!settings.Enabled) { Set(new("idle")); return; }
        cancellation = new();
        var token = cancellation.Token;
        Set(new("connecting"));
        thread = new Thread(() => Run(settings, token)) { IsBackground = true, Name = "StreamUI WASAPI" };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }
    private void Run(AudioSettings settings, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                using var capture = new Wasapi(settings.DeviceId);
                using var frames = new AudioFrameClock(TargetFrameRate, token);
                var analysis = new AudioAnalysis();
                Set(new("live", null, capture.DeviceId, capture.SampleRate, capture.Channels, capture.DeviceSampleRate));
                var clock = Stopwatch.StartNew();
                long receivedAt = 0, silentAt = 0, checkedAt = 0, measuredAt = 0;
                int sentFrames = 0;
                while (frames.WaitNext())
                {
                    var now = clock.ElapsedMilliseconds;
                    if (capture.Drain(analysis, settings.Channel, settings.Gain) > 0) receivedAt = silentAt = now;
                    else if (now - receivedAt > 100)
                    {
                        // Render endpoints may stop supplying packets while silent.
                        int count = Math.Min(AudioAnalysis.Size, (int)((now - silentAt) * capture.SampleRate / 1000));
                        for (int i = 0; i < count; i++) analysis.Push(0);
                        silentAt = now;
                    }
                    Frame?.Invoke(analysis.Frame(capture.SampleRate));
                    sentFrames++;
                    if (now - measuredAt >= 1000)
                    {
                        Set(Status with { FrameRate = Math.Round(sentFrames * 1000.0 / (now - measuredAt), 1) });
                        sentFrames = 0; measuredAt = now;
                    }
                    if (settings.DeviceId == "default" && now - checkedAt >= 2000)
                    {
                        checkedAt = now;
                        if (!capture.IsStillDefault()) break;
                    }
                }
            }
            catch (Exception error)
            {
                if (token.IsCancellationRequested) break;
                Set(new("error", $"无法获取桌面音频：{error.Message}（将自动重试）"));
                token.WaitHandle.WaitOne(3000);
            }
        }
    }
    private void Set(AudioStatus next) { status = next; Changed?.Invoke(); }
    private void Stop()
    {
        cancellation?.Cancel();
        thread?.Join();
        thread = null;
        cancellation?.Dispose(); cancellation = null;
    }
    public void Dispose() { Stop(); Set(new("idle")); }
}
