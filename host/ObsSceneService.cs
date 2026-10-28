using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StreamUI;

public record ObsTransition(string Id, string Name, long StartedAt, string Phase);
public record ObsStatus(string State, string? Scene = null, string? Error = null, ObsTransition? Transition = null, string? Detail = null);
public record ObsConnectionOptions
{
    public TimeSpan HandshakeTimeout { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan ResponseTimeout { get; init; } = TimeSpan.FromSeconds(5);
    public TimeSpan HealthInterval { get; init; } = TimeSpan.FromSeconds(10);
    public TimeSpan RetryDelay { get; init; } = TimeSpan.FromSeconds(3);
}

/// <summary>OBS WebSocket v5: observe the program scene, without changing OBS scenes or sources.</summary>
public sealed class ObsSceneService : IAsyncDisposable
{
    private CancellationTokenSource? cancellation;
    private ClientWebSocket? socket;
    private readonly List<(Task Task, CancellationTokenSource Source)> runs = [];
    private readonly ObsConnectionOptions options;
    private readonly object statusLock = new();
    private long generation;
    public ObsStatus Status { get; private set; } = new("disabled");
    public event Action? Changed;
    public event Func<string, Task>? SceneChanged;
    public ObsSceneService(ObsConnectionOptions? options = null) { this.options = options ?? new(); }

    public static string Authentication(string password, string salt, string challenge)
    {
        static string Hash(string text) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        return Hash(Hash(password + salt) + challenge);
    }

    public void Configure(ObsSettings settings)
    {
        var runId = Interlocked.Increment(ref generation);
        cancellation?.Cancel(); socket?.Abort();
        foreach (var run in runs.Where(run => run.Task.IsCompleted)) run.Source.Dispose();
        runs.RemoveAll(run => run.Task.IsCompleted);
        cancellation = null;
        SetStatus(new(settings.Enabled ? "connecting" : "disabled"), runId);
        if (!settings.Enabled) return;
        var source = new CancellationTokenSource(); cancellation = source;
        runs.Add((Run(settings, source, runId), source));
    }

    private void SetStatus(ObsStatus status, long runId)
    {
        lock (statusLock)
        {
            if (runId != Interlocked.Read(ref generation) || Status == status) return;
            Status = status;
        }
        Changed?.Invoke();
    }

    private async Task Run(ObsSettings settings, CancellationTokenSource source, long runId)
    {
        var token = source.Token;
        while (!token.IsCancellationRequested)
        {
            using var client = new ClientWebSocket(); socket = client;
            client.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
            client.Options.KeepAliveTimeout = TimeSpan.FromSeconds(15);
            Task<JsonDocument>? receiving = null;
            var stage = "连接";
            try
            {
                SetStatus(new("connecting", Detail: "正在连接 OBS WebSocket…"), runId);
                using (var handshake = CancellationTokenSource.CreateLinkedTokenSource(token))
                {
                    handshake.CancelAfter(options.HandshakeTimeout);
                    await client.ConnectAsync(new Uri(settings.Url), handshake.Token);
                    stage = "协议握手";
                    SetStatus(new("connecting", Detail: "正在等待 OBS 协议握手…"), runId);
                    using var hello = await Receive(client, handshake.Token);
                    if (hello.RootElement.GetProperty("op").GetInt32() != 0) throw new InvalidDataException("OBS 未返回 WebSocket v5 握手。");
                    var data = hello.RootElement.GetProperty("d");
                    var identify = new Dictionary<string, object> { ["rpcVersion"] = 1, ["eventSubscriptions"] = 22 };
                    if (data.TryGetProperty("authentication", out var auth))
                        identify["authentication"] = Authentication(settings.Password, auth.GetProperty("salt").GetString()!, auth.GetProperty("challenge").GetString()!);
                    await Send(client, new { op = 1, d = identify }, handshake.Token);
                    stage = "身份验证";
                    SetStatus(new("connecting", Detail: "正在验证 OBS 密码…"), runId);
                    while (true)
                    {
                        using var identified = await Receive(client, handshake.Token);
                        var operation = identified.RootElement.GetProperty("op").GetInt32();
                        if (operation == 2) break;
                        if (operation != 5) throw new InvalidDataException("OBS 未完成 WebSocket 身份验证。");
                    }
                }
                if (token.IsCancellationRequested) break;
                // Authentication alone is not readiness: OBS can still stop
                // answering requests while the underlying socket stays open.
                stage = "读取输出场景";
                SetStatus(new("connecting", Detail: "正在读取 OBS 当前输出场景…"), runId);
                string? requestId = null;
                long sceneRevision = 0, queryRevision = 0, responseDeadline = 0;
                var nextProbe = Environment.TickCount64;
                async Task QueryScene()
                {
                    if (requestId is not null) return;
                    requestId = Guid.NewGuid().ToString("N");
                    queryRevision = sceneRevision;
                    responseDeadline = Environment.TickCount64 + (long)options.ResponseTimeout.TotalMilliseconds;
                    using var sending = CancellationTokenSource.CreateLinkedTokenSource(token);
                    sending.CancelAfter(options.ResponseTimeout);
                    await Send(client, new { op = 6, d = new { requestType = "GetCurrentProgramScene", requestId } }, sending.Token);
                }
                await QueryScene();
                while (!token.IsCancellationRequested)
                {
                    var now = Environment.TickCount64;
                    if (requestId is not null && now >= responseDeadline) throw new TimeoutException("OBS 已完成验证，但读取输出场景超时，正在重新连接。");
                    receiving ??= Receive(client, token);
                    var deadline = requestId is not null ? responseDeadline : nextProbe;
                    using var waiting = CancellationTokenSource.CreateLinkedTokenSource(token);
                    var timer = Task.Delay(TimeSpan.FromMilliseconds(Math.Max(1, deadline - now)), waiting.Token);
                    var completed = await Task.WhenAny(receiving, timer);
                    waiting.Cancel(); token.ThrowIfCancellationRequested();
                    if (completed != receiving) { await QueryScene(); continue; }
                    using var message = await receiving;
                    receiving = null;
                    var root = message.RootElement;
                    var op = root.GetProperty("op").GetInt32();
                    var data = root.GetProperty("d");
                    string? scene = null;
                    if (op == 5)
                    {
                        var type = data.GetProperty("eventType").GetString();
                        if (type == "CurrentProgramSceneChanged")
                        {
                            scene = data.GetProperty("eventData").GetProperty("sceneName").GetString(); sceneRevision++;
                        }
                        else if (type == "SceneTransitionStarted")
                        {
                            var name = data.GetProperty("eventData").GetProperty("transitionName").GetString() ?? "";
                            SetStatus(Status with { Transition = new(Guid.NewGuid().ToString("N"), name, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "started") }, runId);
                        }
                        else if (type is "SceneTransitionEnded" or "SceneTransitionVideoEnded")
                        {
                            var name = data.GetProperty("eventData").GetProperty("transitionName").GetString() ?? "";
                            if (Status.Transition is { } transition && transition.Name == name)
                                SetStatus(Status with { Transition = transition with { Phase = type == "SceneTransitionEnded" ? "ended" : "video-ended" } }, runId);
                            await QueryScene();
                        }
                        else if (type == "CurrentSceneCollectionChanging")
                        {
                            requestId = null; sceneRevision++;
                            nextProbe = Environment.TickCount64 + (long)options.HealthInterval.TotalMilliseconds;
                            SetStatus(Status with { Transition = null }, runId);
                        }
                        else if (type == "CurrentSceneCollectionChanged") await QueryScene();
                    }
                    else if (op == 7 && data.GetProperty("requestId").GetString() == requestId)
                    {
                        requestId = null;
                        nextProbe = Environment.TickCount64 + (long)options.HealthInterval.TotalMilliseconds;
                        if (queryRevision != sceneRevision) continue;
                        if (!data.GetProperty("requestStatus").GetProperty("result").GetBoolean())
                        {
                            var status = data.GetProperty("requestStatus");
                            var comment = status.TryGetProperty("comment", out var description) ? description.GetString() : "请求被拒绝";
                            throw new InvalidDataException($"OBS 无法读取当前输出场景：{comment}");
                        }
                        var response = data.GetProperty("responseData");
                        scene = response.TryGetProperty("sceneName", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() : null;
                        scene ??= response.TryGetProperty("currentProgramSceneName", out var legacyName) && legacyName.ValueKind == JsonValueKind.String ? legacyName.GetString() : null;
                        if (string.IsNullOrWhiteSpace(scene)) throw new InvalidDataException("OBS 未返回有效的输出场景，请确认当前场景集合已加载。");
                    }
                    if (scene is null || token.IsCancellationRequested || runId != Interlocked.Read(ref generation)) continue;
                    SetStatus(Status with { State = "connected", Scene = scene, Error = null, Detail = null }, runId);
                    if (SceneChanged is { } callback) await callback(scene);
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (Exception error) when (error is WebSocketException or OperationCanceledException or JsonException or IOException or InvalidDataException or KeyNotFoundException or InvalidOperationException or TimeoutException)
            {
                if (token.IsCancellationRequested) break;
                var detail = client.CloseStatus == (WebSocketCloseStatus)4009 ? "OBS 密码不正确，请核对密码后重新连接。"
                    : error is OperationCanceledException ? $"OBS {stage}超时，请确认 OBS WebSocket 服务可用。"
                    : error is TimeoutException or InvalidDataException ? error.Message
                    : $"OBS {stage}失败：{error.Message}";
                SetStatus(new("reconnecting", Error: detail), runId);
            }
            finally
            {
                client.Abort();
                if (receiving is not null) try { using var discarded = await receiving; } catch { /* The pending receive is canceled by Abort. */ }
                if (ReferenceEquals(socket, client)) socket = null;
            }
            try { await Task.Delay(options.RetryDelay, token); } catch (OperationCanceledException) { break; }
        }
    }

    private static async Task Send(ClientWebSocket client, object message, CancellationToken token) =>
        await client.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message), WebSocketMessageType.Text, true, token);

    private static async Task<JsonDocument> Receive(ClientWebSocket client, CancellationToken token)
    {
        using var buffer = new MemoryStream();
        var bytes = new byte[4096];
        while (true)
        {
            var result = await client.ReceiveAsync(bytes, token);
            if (result.MessageType == WebSocketMessageType.Close) throw new WebSocketException("OBS 已关闭连接。");
            if (result.MessageType != WebSocketMessageType.Text || buffer.Length + result.Count > 65536) throw new InvalidDataException("OBS 消息格式无效。");
            buffer.Write(bytes, 0, result.Count);
            if (result.EndOfMessage) return JsonDocument.Parse(buffer.ToArray());
        }
    }

    public async ValueTask DisposeAsync()
    {
        Interlocked.Increment(ref generation);
        cancellation?.Cancel(); socket?.Abort();
        await Task.WhenAll(runs.Select(run => run.Task));
        foreach (var run in runs) run.Source.Dispose();
    }
}
