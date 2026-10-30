using System.Text.Json;
using System.Text.Json.Nodes;

namespace StreamUI;

internal static class JsonSettings
{
    public static JsonObject Object(string json) => JsonNode.Parse(json) as JsonObject
        ?? throw new ArgumentException("设置应为 JSON 对象。");

    public static JsonObject Object(JsonElement value) => value.ValueKind == JsonValueKind.Object
        ? Object(value.GetRawText()) : throw new ArgumentException("设置应为 JSON 对象。");

    public static void Merge(JsonObject target, JsonObject patch)
    {
        foreach (var (key, value) in patch)
            if (target[key] is JsonObject before && value is JsonObject after) Merge(before, after);
            else target[key] = value?.DeepClone();
    }

    // Defaults belong to the author. Persist only values the user actually changed.
    public static JsonObject Overrides(JsonObject values, JsonObject defaults)
    {
        var result = new JsonObject();
        foreach (var (key, value) in values)
        {
            if (!defaults.TryGetPropertyValue(key, out var baseline)) result[key] = value?.DeepClone();
            else if (value is JsonObject nested && baseline is JsonObject original)
            {
                var changes = Overrides(nested, original);
                if (changes.Count > 0) result[key] = changes;
            }
            else if (!JsonNode.DeepEquals(value, baseline)) result[key] = value?.DeepClone();
        }
        return result;
    }
}
