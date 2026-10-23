using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DeployDock.Services;

public record ConfigChange(string File, string Path, string Action, string Detail, string Level = "info");

/// <summary>
/// Правит appsettings*.json уже в папке публикации (исходники не трогаем).
/// Строки подключения: пишем в appsettings.json всегда и в appsettings.*.json — если там этот ключ есть,
/// иначе appsettings.Production.json перебил бы значение.
/// Ключи подписи: меняем только значения, начинающиеся на «dev» (в любом регистре).
/// </summary>
public class ConfigPatcher
{
    static readonly JsonDocumentOptions ReadOpts = new() { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true };
    static readonly JsonSerializerOptions WriteOpts = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    readonly string _dir;
    readonly Dictionary<string, JsonObject> _docs = new(StringComparer.OrdinalIgnoreCase);
    readonly HashSet<string> _dirty = new(StringComparer.OrdinalIgnoreCase);
    public List<ConfigChange> Changes { get; } = new();

    public ConfigPatcher(string publishDir)
    {
        _dir = publishDir;
        foreach (var f in Directory.EnumerateFiles(publishDir, "appsettings*.json", SearchOption.TopDirectoryOnly))
        {
            var name = System.IO.Path.GetFileName(f);
            try
            {
                if (JsonNode.Parse(File.ReadAllText(f), documentOptions: ReadOpts) is JsonObject o) _docs[name] = o;
            }
            catch (JsonException ex)
            {
                Changes.Add(new(name, "", "error", $"Не смог разобрать JSON: {ex.Message}", "error"));
            }
        }
        if (!_docs.ContainsKey("appsettings.json"))
        {
            _docs["appsettings.json"] = new JsonObject();
            Changes.Add(new("appsettings.json", "", "create", "В публикации не было appsettings.json — создан новый", "warn"));
            _dirty.Add("appsettings.json");
        }
    }

    public void SetConnection(string jsonPath, string value, string label)
    {
        foreach (var (file, root) in _docs)
        {
            bool isMain = file.Equals("appsettings.json", StringComparison.OrdinalIgnoreCase);
            var existing = Find(root, jsonPath);
            if (existing == null && !isMain) continue;

            Set(root, jsonPath, value);
            _dirty.Add(file);
            Changes.Add(new(file, jsonPath, existing == null ? "add" : "replace", $"строка подключения «{label}»"));
        }
    }

    /// <summary>Ищет dev-ключи по пути и подменяет. getKey вызывается лениво — ключ создаётся только если реально нужен.</summary>
    public void ReplaceDevKey(string jsonPath, Func<string> getKey)
    {
        bool found = false;
        foreach (var (file, root) in _docs)
        {
            var node = Find(root, jsonPath);
            if (node == null) continue;
            found = true;

            var current = node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
            if (current == null)
            {
                Changes.Add(new(file, jsonPath, "skip", "значение не строка — не трогаю", "warn"));
                continue;
            }
            if (!current.StartsWith("dev", StringComparison.OrdinalIgnoreCase))
            {
                Changes.Add(new(file, jsonPath, "skip", "не dev-значение — оставил как есть"));
                continue;
            }

            Set(root, jsonPath, getKey());
            _dirty.Add(file);
            Changes.Add(new(file, jsonPath, "replace", "dev-ключ заменён на боевой"));
        }
        if (!found)
            Changes.Add(new("—", jsonPath, "skip", "ключ не найден ни в одном appsettings", "warn"));
    }

    public void Save()
    {
        foreach (var file in _dirty)
            File.WriteAllText(System.IO.Path.Combine(_dir, file), _docs[file].ToJsonString(WriteOpts));
    }

    static string[] Split(string path) =>
        // Только «:», как в IConfiguration: точки встречаются в ключах (Microsoft.AspNetCore)
        path.Split(':', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // Конфиг в .NET регистронезависимый, ищем так же
    static string? MatchKey(JsonObject o, string key) =>
        o.Select(kv => kv.Key).FirstOrDefault(k => k.Equals(key, StringComparison.OrdinalIgnoreCase));

    static JsonNode? Find(JsonObject root, string path)
    {
        JsonNode? cur = root;
        foreach (var seg in Split(path))
        {
            if (cur is not JsonObject o) return null;
            var k = MatchKey(o, seg);
            if (k == null) return null;
            cur = o[k];
            if (cur == null) return null;
        }
        return cur;
    }

    static void Set(JsonObject root, string path, string value)
    {
        var segs = Split(path);
        var cur = root;
        for (int i = 0; i < segs.Length - 1; i++)
        {
            var k = MatchKey(cur, segs[i]);
            if (k == null || cur[k] is not JsonObject next)
            {
                next = new JsonObject();
                cur[k ?? segs[i]] = next;
            }
            cur = next;
        }
        var last = MatchKey(cur, segs[^1]) ?? segs[^1];
        cur[last] = value;
    }
}
