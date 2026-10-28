using System.Diagnostics;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text.Json;

namespace StreamUI;

public record LaplaceStatus(string State, string? Error = null, bool LocalBridge = false, long Events = 0, DateTimeOffset? LastEventAt = null);
public sealed class LaplaceService : IAsyncDisposable
{
    private readonly string directory;
    private CancellationTokenSource? cancellation;
    private Task? worker;
    private Process? bridge;
    private volatile LaplaceStatus status = new("disconnected");
    public LaplaceStatus Status => status;
    public event Action<JsonElement>? Event;
    public event Action? Changed;
    public LaplaceService(string directory) { this.directory = directory; }
    public async Task Configure(LaplaceSettings settings)
    {
        await Stop();
        if (!settings.Enabled) { Set(new("disconnected")); return; }
        cancellation = new();
        Set(new("connecting"));
        worker = Run(settings, cancellation.Token);
    }
    private async Task Run(LaplaceSettings settings, CancellationToken token)
    {
        long count = 0;
        while (!token.IsCancellationRequested)
        {
            try
            {
                if (settings.StartLocalBridge) await EnsureBridge(settings, token);
                using var socket = new ClientWebSocket();
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                socket.Options.KeepAliveTimeout = TimeSpan.FromSeconds(20);
                var url = new UriBuilder(settings.Url);
                if (!string.IsNullOrEmpty(settings.Token))
                {
                    socket.Options.AddSubProtocol("laplace-event-bridge-role-client");
                    url.Query = string.IsNullOrEmpty(url.Query) ? "token=" + Uri.EscapeDataString(settings.Token) : url.Query.TrimStart('?') + "&token=" + Uri.EscapeDataString(settings.Token);
                }
                using var connect = CancellationTokenSource.CreateLinkedTokenSource(token);
                connect.CancelAfter(TimeSpan.FromSeconds(10));
                await socket.ConnectAsync(url.Uri, connect.Token);
                Set(new("connected", null, settings.StartLocalBridge, count));
                var buffer = new byte[16384];
                while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
                {
                    using var message = new MemoryStream();
                    ValueWebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(buffer.AsMemory(), token);
                        if (result.MessageType == WebSocketMessageType.Close) throw new WebSocketException("桥接服务已关闭连接。");
                        if (message.Length + result.Count > 1024 * 1024) throw new InvalidDataException("LAPLACE 事件超过 1 MB。");
                        message.Write(buffer, 0, result.Count);
                    } while (!result.EndOfMessage);
                    if (result.MessageType != WebSocketMessageType.Text) continue;
                    JsonDocument document;
                    try { document = JsonDocument.Parse(message.ToArray()); }
                    catch (JsonException) { continue; }
                    using (document)
                    {
                        var data = document.RootElement;
                        if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("type", out var kind)) continue;
                        if (kind.GetString() == "ping")
                        {
                            var pong = JsonSerializer.SerializeToUtf8Bytes(new { type = "pong", timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), respondingTo = data.TryGetProperty("timestamp", out var timestamp) ? timestamp.Clone() : (object?)null });
                            await socket.SendAsync(pong.AsMemory(), WebSocketMessageType.Text, true, token);
                        }
                        else if (kind.GetString() is "message" or "gift" or "superchat")
                        {
                            count++;
                            status = status with { Events = count, LastEventAt = DateTimeOffset.UtcNow };
                            Event?.Invoke(data.Clone());
                        }
                    }
                }
            }
            catch (Exception error) when (!token.IsCancellationRequested)
            {
                // Do not echo the connection URL or token into logs / OBS state.
                Set(new("reconnecting", error is WebSocketException ? "LAPLACE 未连接，请检查地址、Token 和采集端。" : error is OperationCanceledException ? "LAPLACE 连接超时。" : error.Message, settings.StartLocalBridge, count, status.LastEventAt));
            }
            catch (Exception) when (token.IsCancellationRequested) { break; }
            try { await Task.Delay(3000, token); } catch (OperationCanceledException) { break; }
        }
    }
    private async Task EnsureBridge(LaplaceSettings settings, CancellationToken token)
    {
        if (bridge is { HasExited: false }) return;
        // Reuse a pre-existing service without taking ownership of it.
        using (var probe = new TcpClient())
        {
            try { await probe.ConnectAsync("localhost", 9696, token).AsTask().WaitAsync(TimeSpan.FromSeconds(1), token); return; }
            catch (Exception error) when (error is SocketException or TimeoutException) { }
        }
        const string version = "0.3.21";
        const string expectedHash = "f312bc92ff9988a6753a2d53745baea8af9dce9c17f4f94b105892ab98594ab1";
        if (System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture != System.Runtime.InteropServices.Architecture.X64)
            throw new NotSupportedException("自动桥接仅提供 Windows x64 版本；其他架构请关闭自动启动并填写已有桥接地址。");
        var folder = Path.Combine(directory, "event-bridge", version);
        Directory.CreateDirectory(folder);
        var binary = Path.Combine(folder, "leb-server-windows-x64.exe");
        static bool Valid(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).Equals(expectedHash, StringComparison.OrdinalIgnoreCase);
        if (!File.Exists(binary) || !Valid(await File.ReadAllBytesAsync(binary, token)))
        {
            Set(new("connecting", "正在准备本地 LAPLACE 桥接服务…", true));
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            var tag = Uri.EscapeDataString("@laplace.live/event-bridge-server@" + version);
            var bytes = await http.GetByteArrayAsync($"https://github.com/laplace-live/event-bridge/releases/download/{tag}/leb-server-windows-x64.exe", token);
            if (!Valid(bytes)) throw new InvalidDataException("LAPLACE 桥接文件校验失败。");
            await File.WriteAllBytesAsync(binary + ".tmp", bytes, token);
            File.Move(binary + ".tmp", binary, true);
        }
        var start = new ProcessStartInfo(binary) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = folder };
        foreach (var item in new[] { "--host", "localhost", "--port", "9696", "--auth", settings.Token }) start.ArgumentList.Add(item);
        bridge?.Dispose();
        bridge = Process.Start(start) ?? throw new IOException("无法启动本地 LAPLACE 桥接。");
        await Task.Delay(500, token);
        if (bridge.HasExited) throw new IOException("本地 LAPLACE 桥接启动失败，端口 9696 可能已被占用。");
    }
    private void Set(LaplaceStatus next) { status = next; Changed?.Invoke(); }
    private async Task Stop()
    {
        cancellation?.Cancel();
        if (worker is not null) await worker;
        worker = null; cancellation?.Dispose(); cancellation = null;
        if (bridge is not null)
        {
            if (!bridge.HasExited) { bridge.Kill(true); await bridge.WaitForExitAsync(); }
            bridge.Dispose(); bridge = null;
        }
    }
    public async ValueTask DisposeAsync() { await Stop(); Set(new("disconnected")); }
}
