using System.Text.Json;

namespace StreamUI.Contracts;

/// <summary>A capability provider. StartAsync starts background work and returns promptly.</summary>
public interface IStreamUIPlugin : IAsyncDisposable
{
    Task StartAsync(IPluginContext context, CancellationToken stopping);
}

public interface IPluginContext
{
    string Id { get; }
    string DataDirectory { get; }
    JsonElement Settings { get; }
    void Publish(string topic, object? data);
    void PublishBinary(string topic, ReadOnlyMemory<byte> data);
}
