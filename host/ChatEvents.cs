using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StreamUI;

public record ChatUser(string Id, string Name, int? Level, string? MedalName, int? MedalLevel);
public record ChatGift(string Name, double? Count);
public record ChatPayment(double? Amount, string Currency);
public record ChatEvent(string? Id, string Kind, string Platform, long Timestamp, ChatUser User, string Text, ChatGift? Gift, ChatPayment? Payment);

public sealed class ChatEvents
{
    private readonly Dictionary<string, int> levels = new();
    private readonly HashSet<string> seen = [];
    private readonly Queue<string> ids = new();
    public ChatEvent? Normalize(JsonElement input, long? receivedAt = null)
    {
        if (input.ValueKind != JsonValueKind.Object) return null;
        string Text(string key) => input.TryGetProperty(key, out var value) ? Clean(value) : "";
        double? Number(string key) => input.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) && number >= 0 ? number : null;
        var kind = Text("type");
        if (kind is not ("message" or "gift" or "superchat")) return null;
        if (input.TryGetProperty("deleted", out var deleted) && deleted.ValueKind == JsonValueKind.True) return null;
        var platform = Text("origin");
        var userId = Text("uid");
        var userKey = platform + ":" + userId;
        var level = Number("userLvl") is { } n ? (int?)Math.Min(int.MaxValue, Math.Floor(n)) : null;
        if (level is not null && userId.Length > 0)
        {
            levels[userKey] = level.Value;
            if (levels.Count > 2000) levels.Remove(levels.Keys.First());
        }
        else if (userId.Length > 0 && levels.TryGetValue(userKey, out var stored)) level = stored;
        string? medalName = null; int? medalLevel = null;
        if (input.TryGetProperty("medal", out var medal) && medal.ValueKind == JsonValueKind.Object)
        {
            if (medal.TryGetProperty("name", out var name)) medalName = Clean(name);
            if (medal.TryGetProperty("level", out var ml) && ml.ValueKind == JsonValueKind.Number && ml.TryGetInt32(out var value)) medalLevel = value;
        }
        var message = Text("message");
        if (kind == "message" && message.Length == 0) return null;
        var stableId = new[] { Text("stableKey"), Text("idStr"), Text("id") }.FirstOrDefault(v => v.Length > 0);
        var id = stableId is null ? null : platform + ":" + kind + ":" + stableId;
        if (id is not null)
        {
            if (!seen.Add(id)) return null;
            ids.Enqueue(id); if (ids.Count > 2000) seen.Remove(ids.Dequeue());
        }
        double timestamp = Number("timestampNormalized") ?? 0;
        if (timestamp <= 0)
        {
            timestamp = Number("timestamp") ?? 0;
            if (timestamp > 0 && timestamp < 1e11) timestamp *= 1000;
            else if (timestamp >= 1e17) timestamp /= 1e6;
            else if (timestamp >= 1e14) timestamp /= 1000;
        }
        var sentAt = timestamp is > 0 and < 253402300800000 ? (long)timestamp : receivedAt ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return new(id, kind, platform, sentAt,
            new(userId, Text("username"), level, medalName, medalLevel), message,
            kind == "gift" ? new(Text("giftName"), Number("num") ?? Number("count")) : null,
            kind == "superchat" ? new(Number("priceNormalized"), "CNY") : null);
    }
    private static string Clean(JsonElement value)
    {
        var text = value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ValueKind == JsonValueKind.Number ? value.GetRawText() : "";
        return Regex.Replace(text, @"[\p{Cc}\p{Zl}\p{Zp}]+", " ").Trim();
    }
}
