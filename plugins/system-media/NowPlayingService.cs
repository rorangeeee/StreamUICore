using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StreamUI.SystemMedia;

public record NowPlayingStatus(string Title = "", string Artist = "", bool Playing = false, string State = "idle");

/// <summary>One read-only system-media reader shared by all OBS and preview pages.</summary>
public sealed class NowPlayingService : IAsyncDisposable
{
    private readonly CancellationTokenSource stop = new();
    private Task? worker;
    private NowPlayingStatus status = new(State: "connecting");
    public NowPlayingStatus Status => Volatile.Read(ref status);
    public event Action? Changed;
    public void Start() => worker ??= Task.Run(ReadLoop);

    private static string Clean(string? value)
    {
        var text = Regex.Replace(value ?? "", @"[\p{Cc}\p{Zl}\p{Zp}]+", " ").Trim();
        var elements = StringInfo.GetTextElementEnumerator(text);
        var result = new StringBuilder();
        for (var count = 0; count < 256 && elements.MoveNext(); count++) result.Append(elements.GetTextElement());
        return result.ToString();
    }
    internal static bool TryParse(string json, out NowPlayingStatus result)
    {
        result = new();
        try
        {
            var input = JsonSerializer.Deserialize<NowPlayingStatus>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            if (input is null) return false;
            var title = Clean(input.Title); var artist = Clean(input.Artist);
            var playing = input.Playing && title.Length > 0;
            var state = playing ? "playing" : input.State is "paused" or "unavailable" ? input.State : "idle";
            result = playing ? new(title, artist, true, state) : new("", "", false, state);
            return true;
        }
        catch (JsonException) { return false; }
    }
    private void Update(NowPlayingStatus next)
    {
        if (Interlocked.Exchange(ref status, next) != next) Changed?.Invoke();
    }
    private async Task ReadLoop()
    {
        using var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("StreamUI.MediaSession.ps1");
        if (resource is null) { Update(new(State: "unavailable")); return; }
        using var reader = new StreamReader(resource, Encoding.UTF8);
        var command = Convert.ToBase64String(Encoding.Unicode.GetBytes(await reader.ReadToEndAsync()));
        while (!stop.IsCancellationRequested)
        {
            using var process = new Process();
            try
            {
                process.StartInfo = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
                    UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                };
                foreach (var argument in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command }) process.StartInfo.ArgumentList.Add(argument);
                process.Start(); process.ErrorDataReceived += (_, _) => { }; process.BeginErrorReadLine();
                while (!stop.IsCancellationRequested)
                {
                    var line = await process.StandardOutput.ReadLineAsync(stop.Token).AsTask().WaitAsync(TimeSpan.FromSeconds(12), stop.Token);
                    if (line is null) break;
                    if (TryParse(line, out var next)) Update(next);
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            catch (Exception error) when (error is IOException or InvalidOperationException or System.ComponentModel.Win32Exception or TimeoutException)
            { Update(new(State: "unavailable")); }
            finally
            {
                try { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(); } }
                catch (InvalidOperationException) { }
            }
            if (!stop.IsCancellationRequested)
            {
                Update(new(State: "unavailable"));
                try { await Task.Delay(5000, stop.Token); } catch (OperationCanceledException) { }
            }
        }
    }
    public async ValueTask DisposeAsync()
    {
        await stop.CancelAsync();
        if (worker is not null) await worker;
        stop.Dispose();
    }
}
