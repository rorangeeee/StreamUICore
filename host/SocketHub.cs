using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;

namespace StreamUI;

public sealed class SocketHub
{
    private readonly ConcurrentDictionary<Guid, Channel<byte[]>> clients = new();
    private readonly WebSocketMessageType type;
    private readonly int capacity;
    public SocketHub(WebSocketMessageType type, int capacity) { this.type = type; this.capacity = capacity; }
    public void Publish(byte[] data) { foreach (var channel in clients.Values) channel.Writer.TryWrite(data); }
    public void Publish(object message) => Publish(JsonSerializer.SerializeToUtf8Bytes(message, SettingsStore.Json));
    public async Task Handle(HttpContext context, object? initial = null, CancellationToken stopping = default)
    {
        if (!context.WebSockets.IsWebSocketRequest) { context.Response.StatusCode = 400; return; }
        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(capacity) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        clients[id] = channel;
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping);
        if (initial is not null) channel.Writer.TryWrite(JsonSerializer.SerializeToUtf8Bytes(initial, SettingsStore.Json));
        var receive = Task.Run(async () =>
        {
            try
            {
                var buffer = new byte[1024];
                while (!lifetime.IsCancellationRequested && socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(buffer.AsMemory(), lifetime.Token);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                }
            }
            catch (Exception error) when (error is WebSocketException or OperationCanceledException) { }
            finally { lifetime.Cancel(); }
        });
        try
        {
            await foreach (var data in channel.Reader.ReadAllAsync(lifetime.Token))
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                await socket.SendAsync(data.AsMemory(), type, true, timeout.Token);
            }
        }
        catch (Exception error) when (error is WebSocketException or OperationCanceledException) { }
        finally
        {
            clients.TryRemove(id, out _);
            channel.Writer.TryComplete(); lifetime.Cancel(); socket.Abort();
            await receive;
        }
    }
}
