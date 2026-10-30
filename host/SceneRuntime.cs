namespace StreamUI;

public record ScenePlayback(string Id, long StartedAt, bool Animate);
public sealed class SceneRuntime(string? initial) : IDisposable
{
    public string? ActiveId { get; private set; } = initial;
    public string? PreviousId { get; private set; }
    public long Revision { get; private set; }
    public ScenePlayback? Playback { get; private set; }
    public SocketHub Events { get; } = new(System.Net.WebSockets.WebSocketMessageType.Text, 128);
    public CancellationTokenSource Lifetime { get; } = new();
    public object State => new { ActiveId, PreviousId, Revision, Playback };
    public bool Accept(string? cue, long? startedAt) => Playback is null || (Playback.Id != cue && (startedAt is null || startedAt >= Playback.StartedAt));
    public bool Select(string id, bool animate = true, string? cue = null, long? startedAt = null)
    {
        var time = startedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (Playback is not null && (Playback.Id == cue || time < Playback.StartedAt)) return false;
        PreviousId = ActiveId; ActiveId = id; Revision++;
        Playback = new(cue ?? Guid.NewGuid().ToString("N"), time, animate);
        return true;
    }
    public void Reset(string? id) { PreviousId = null; ActiveId = id; Playback = null; Revision++; }
    public void Dispose() { Lifetime.Cancel(); Lifetime.Dispose(); }
}
