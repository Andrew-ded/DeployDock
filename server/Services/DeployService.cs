using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using DeployDock.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DeployDock.Services;

public class BusyException(string message) : Exception(message);

/// <summary>
/// Сердце инструмента: гоняет деплой и откат по этапам, шлёт лог и состояние во фронт.
/// Одновременно идёт только один запуск — чтобы два dotnet publish не дрались за одни файлы.
/// </summary>
public class DeployService(
    IDbContextFactory<AppDb> dbFactory,
    SecretProtector secrets,
    IHubContext<DeployHub> hub,
    ILogger<DeployService> logger)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    const string BackupNameFormat = "yyyyMMdd-HHmmss";

    readonly SemaphoreSlim _gate = new(1, 1);
    readonly ConcurrentDictionary<Guid, RunState> _recent = new();
    RunState? _current;

    public RunState? Current => _current;
    public bool IsBusyWith(int targetId) => _current is { Status: "Running" } c && c.TargetId == targetId;

    public RunState? GetLive(Guid id) => _recent.GetValueOrDefault(id);

    // ───────────────────────── запуск ─────────────────────────

    public async Task<RunState> StartDeployAsync(int targetId)
    {
        var target = await LoadTargetAsync(targetId);
        var run = CreateRun(target, "Deploy", new[]
        {
            ("tests", "Тесты"), ("publish", "Публикация"), ("config", "Конфиги"),
            ("backup", "Бэкап"), ("copy", "Копирование"), ("health", "Health-check"),
        });
        Launch(run, ct => DeployAsync(run, target, ct));
        return run;
    }

    public async Task<RunState> StartRollbackAsync(int targetId, string? backupName)
    {
        var target = await LoadTargetAsync(targetId);
        var backups = ListBackups(targetId);
        var backup = backupName == null ? backups.FirstOrDefault() : backups.FirstOrDefault(b => b.Name == backupName);
        if (backup == null) throw new InvalidOperationException("Бэкапов для отката нет.");

        var run = CreateRun(target, "Rollback", new[] { ("copy", "Восстановление"), ("health", "Health-check") });
        run.RestoredFrom = backup.Name;
        run.CanCancel = false;
        Launch(run, ct => RollbackAsync(run, target, backup.Name, ct));
        return run;
    }

    public bool Cancel(Guid runId)
    {
        if (_current?.Id != runId || !_current.CanCancel) return false;
        _current.Cts.Cancel();
        return true;
    }

    RunState CreateRun(DeployTarget target, string kind, (string key, string title)[] stages)
    {
        if (!_gate.Wait(0))
            throw new BusyException($"Уже идёт {(_current?.Kind == "Rollback" ? "откат" : "деплой")} «{_current?.AppName} / {_current?.TargetName}». Дождись окончания.");

        var id = Guid.NewGuid();
        var run = new RunState
        {
            Id = id, TargetId = target.Id, AppId = target.AppProjectId,
            AppName = target.App!.Name, TargetName = target.Name, Kind = kind,
            StartedAt = DateTime.Now,
            Stages = stages.Select(s => new StageState { Key = s.key, Title = s.title }).ToList(),
            LogFile = Path.Combine(AppPaths.Logs, $"{id}.log"),
        };
        _current = run;
        _recent[id] = run;
        foreach (var old in _recent.Values.OrderByDescending(r => r.StartedAt).Skip(20).ToList())
            _recent.TryRemove(old.Id, out _);
        return run;
    }

    void Launch(RunState run, Func<CancellationToken, Task> body)
    {
        _ = Task.Run(async () =>
        {
            using var flusher = new LogFlusher(run, hub);
            Log(run, $"=== {(run.Kind == "Rollback" ? "Откат" : "Деплой")} {run.AppName} / {run.TargetName} — {run.StartedAt:dd.MM.yyyy HH:mm:ss} ===");
            await PersistAsync(run);
            try
            {
                await body(run.Cts.Token);
            }
            catch (DeployHandledException)
            {
                // статус и ошибка уже выставлены
            }
            catch (OperationCanceledException)
            {
                run.Status = "Cancelled";
                run.Error = "Отменено вручную";
                Log(run, "✖ Отменено");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Run {Id} crashed", run.Id);
                run.Status = "Failed";
                run.Error = ex.Message;
                Log(run, $"✖ {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                foreach (var s in run.Stages.Where(s => s.Status == "running"))
                {
                    s.Status = run.Status == "Cancelled" ? "skipped" : "failed";
                    s.FinishedAt = DateTime.Now;
                }
                foreach (var s in run.Stages.Where(s => s.Status == "pending"))
                    (s.Status, s.Detail) = ("skipped", "не дошли");
                run.FinishedAt = DateTime.Now;
                run.CanCancel = false;
                run.CanRollback = ServerTouched(run) && ListBackups(run.TargetId).Count > 0;
                Log(run, $"=== Итог: {StatusRu(run.Status)} за {(run.FinishedAt.Value - run.StartedAt).TotalSeconds:0.0} с ===");
                flusher.Flush();
                await PersistAsync(run);
                await Broadcast(run);
                _current = null;
                _gate.Release();
            }
        });
    }

    // ───────────────────────── деплой ─────────────────────────

    async Task DeployAsync(RunState run, DeployTarget target, CancellationToken ct)
    {
        var app = target.App!;
        var work = Path.Combine(AppPaths.Work, run.Id.ToString("N"));
        var publishDir = Path.Combine(work, "publish");
        var testsDir = Path.Combine(work, "tests");
        var settings = await LoadSettingsAsync();
        var mirror = new FileMirror(Lines(app.Exclusions), l => Log(run, l));

        try
        {
            // 1. Тесты — упали, значит дальше не идём
            if (string.IsNullOrWhiteSpace(app.TestPath))
            {
                await Skip(run, "tests", "тестовый проект не указан");
            }
            else
            {
                await Begin(run, "tests");
                var code = await ProcessRunner.RunAsync("dotnet",
                    new[] { "test", app.TestPath, "-c", "Release", "--logger", "trx", "--results-directory", testsDir },
                    DirOf(app.TestPath), l => Log(run, l), ct);

                var summary = TrxParser.ParseDirectory(testsDir);
                run.Tests = summary;

                if (code != 0)
                {
                    run.Status = "TestsFailed";
                    var why = summary.Failed > 0
                        ? $"упало {summary.Failed} из {summary.Total}"
                        : $"dotnet test вернул {code} — скорее всего не собрались тесты, смотри лог";
                    run.Error = $"Тесты: {why}. Публикация отменена.";
                    await Fail(run, "tests", why);
                    return;
                }
                await Ok(run, "tests", summary.Total == 0
                    ? "тестов не найдено (проект собрался, но тестов 0)"
                    : $"{summary.Passed} пройдено" + (summary.Skipped > 0 ? $", {summary.Skipped} пропущено" : ""));
            }

            // 2. Публикация во временную папку
            await Begin(run, "publish");
            var publishArgs = new List<string> { "publish", app.ProjectPath, "-c", "Release", "-o", publishDir };
            publishArgs.AddRange(ProcessRunner.SplitArgs(app.PublishArgs));
            var pcode = await ProcessRunner.RunAsync("dotnet", publishArgs, DirOf(app.ProjectPath), l => Log(run, l), ct);
            if (pcode != 0)
            {
                run.Status = "Failed";
                run.Error = $"dotnet publish вернул {pcode}";
                await Fail(run, "publish", $"код выхода {pcode}, смотри лог");
                return;
            }
            var fileCount = Directory.EnumerateFiles(publishDir, "*", SearchOption.AllDirectories).Count();
            await Ok(run, "publish", Files(fileCount));

            // 3. Строки подключения и ключи — только в папке публикации
            await Begin(run, "config");
            if (!await PatchConfigAsync(run, target, publishDir, settings))
            {
                run.Status = "Failed";
                run.Error = "Не удалось поправить appsettings";
                await Fail(run, "config", "ошибка в appsettings, смотри изменения");
                return;
            }
            var replaced = run.Changes.Count(c => c.Action is "replace" or "add");
            var warns = run.Changes.Count(c => c.Level == "warn");
            await Ok(run, "config", $"{replaced} замен" + (warns > 0 ? $", {warns} предупр." : ""));

            ct.ThrowIfCancellationRequested();

            // 4. Бэкап текущей версии на сервере
            if (Directory.Exists(target.TargetPath) && Directory.EnumerateFileSystemEntries(target.TargetPath).Any())
            {
                await Begin(run, "backup");
                var name = DateTime.Now.ToString(BackupNameFormat, CultureInfo.InvariantCulture);
                var dir = Path.Combine(BackupRoot(target.Id), name);
                var n = mirror.Backup(target.TargetPath, dir, ct);
                run.BackupName = name;
                var pruned = PruneBackups(target.Id, settings.BackupsToKeep);
                await Ok(run, "backup", $"{Files(n)} → {name}" + (pruned > 0 ? $", старых удалено: {pruned}" : ""));
            }
            else
            {
                await Skip(run, "backup", "целевая папка пустая — первый деплой");
            }

            // 5. Копирование. С этого момента отмена запрещена — нельзя бросать сервер на полпути.
            run.CanCancel = false;
            await Begin(run, "copy");
            await CopyWithOfflineAsync(run, mirror, publishDir, target.TargetPath, settings, ct);

            // 6. Health
            await HealthStageAsync(run, target, settings);
        }
        finally
        {
            try { if (Directory.Exists(work)) Directory.Delete(work, recursive: true); }
            catch (Exception ex) { Log(run, $"(не смог удалить временную папку: {ex.Message})"); }
        }
    }

    async Task RollbackAsync(RunState run, DeployTarget target, string backupName, CancellationToken ct)
    {
        var settings = await LoadSettingsAsync();
        var mirror = new FileMirror(Lines(target.App!.Exclusions), l => Log(run, l));
        var source = Path.Combine(BackupRoot(target.Id), backupName);
        Log(run, $"Восстанавливаю версию из бэкапа {backupName}");

        await Begin(run, "copy");
        await CopyWithOfflineAsync(run, mirror, source, target.TargetPath, settings, ct);
        await HealthStageAsync(run, target, settings);
    }

    async Task CopyWithOfflineAsync(RunState run, FileMirror mirror, string source, string target, ToolSettings settings, CancellationToken ct)
    {
        Directory.CreateDirectory(target);
        var offline = Path.Combine(target, FileMirror.OfflineFile);
        await File.WriteAllTextAsync(offline,
            "<!doctype html><meta charset=utf-8><title>Обновление</title><body style=\"font-family:sans-serif;padding:40px\">" +
            "<h2>Идёт обновление приложения</h2><p>Обнови страницу через минуту.</p>", ct);
        Log(run, $"app_offline.htm положен, жду {settings.OfflineDelaySec} с, пока IIS отпустит файлы");
        await Task.Delay(TimeSpan.FromSeconds(settings.OfflineDelaySec), CancellationToken.None);

        MirrorStats stats;
        try
        {
            stats = await Task.Run(() => mirror.Mirror(source, target, CancellationToken.None), CancellationToken.None);
        }
        catch (Exception ex)
        {
            run.Status = "Failed";
            run.Error = $"Копирование упало: {ex.Message}. Сайт оставлен в режиме app_offline — жми «Откатить» или задеплой заново.";
            await Fail(run, "copy", ex.Message);
            throw new DeployHandledException();
        }

        run.Mirror = stats;
        File.Delete(offline);
        Log(run, "app_offline.htm убран");
        await Ok(run, "copy", $"скопировано {stats.Copied}, без изменений {stats.Unchanged}, удалено {stats.Deleted}" +
                              (stats.Excluded > 0 ? $", исключено {stats.Excluded}" : ""));
    }

    async Task HealthStageAsync(RunState run, DeployTarget target, ToolSettings settings)
    {
        if (string.IsNullOrWhiteSpace(target.HealthUrl))
        {
            await Skip(run, "health", "URL не указан");
            run.Status = "Succeeded";
            return;
        }

        await Begin(run, "health");
        var res = await HealthChecker.WaitHealthyAsync(target.HealthUrl, target.IgnoreTlsErrors,
            TimeSpan.FromSeconds(settings.HealthTimeoutSec), l => Log(run, l), CancellationToken.None);
        run.Health = res;
        await SaveHealthAsync(target.Id, res);

        if (res.Ok)
        {
            await Ok(run, "health", res.Message);
            run.Status = "Succeeded";
        }
        else
        {
            run.Status = "HealthFailed";
            run.Error = $"Health-check не прошёл: {res.Message}";
            await Fail(run, "health", res.Message);
        }
    }

    async Task<bool> PatchConfigAsync(RunState run, DeployTarget target, string publishDir, ToolSettings settings)
    {
        var patcher = new ConfigPatcher(publishDir);

        foreach (var b in target.Bindings)
        {
            if (b.ConnectionString == null) continue;
            patcher.SetConnection(b.JsonPath, secrets.Unprotect(b.ConnectionString.ProtectedValue), b.ConnectionString.Name);
        }

        await using var db = await dbFactory.CreateDbContextAsync();
        var keys = await db.SigningKeys.Where(k => k.DeployTargetId == target.Id).ToListAsync();
        foreach (var path in Lines(target.App!.KeyPaths))
        {
            patcher.ReplaceDevKey(path, () =>
            {
                var existing = keys.FirstOrDefault(k => k.JsonPath.Equals(path, StringComparison.OrdinalIgnoreCase));
                if (existing != null) return secrets.Unprotect(existing.ProtectedValue);

                var value = SecretProtector.GenerateKey(settings.KeyBytes, "base64");
                var entity = new SigningKey
                {
                    DeployTargetId = target.Id, JsonPath = path,
                    ProtectedValue = secrets.Protect(value), CreatedAt = DateTime.Now,
                };
                db.SigningKeys.Add(entity);
                keys.Add(entity);
                Log(run, $"  сгенерирован новый ключ для {path} (окружение {target.Name}) — дальше будет использоваться он же");
                return value;
            });
        }
        await db.SaveChangesAsync();

        run.Changes = patcher.Changes;
        foreach (var c in patcher.Changes)
            Log(run, $"  [{c.Action}] {c.File} → {c.Path}: {c.Detail}");

        if (patcher.Changes.Any(c => c.Level == "error")) return false;
        patcher.Save();
        return true;
    }

    // ───────────────────────── бэкапы ─────────────────────────

    public record BackupInfo(string Name, DateTime CreatedAt);

    static string BackupRoot(int targetId) => Path.Combine(AppPaths.Backups, $"target-{targetId}");

    public List<BackupInfo> ListBackups(int targetId)
    {
        var root = BackupRoot(targetId);
        if (!Directory.Exists(root)) return new();
        return Directory.GetDirectories(root)
            .Select(Path.GetFileName)
            .Select(n => DateTime.TryParseExact(n, BackupNameFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
                ? new BackupInfo(n!, d) : null)
            .Where(b => b != null).Cast<BackupInfo>()
            .OrderByDescending(b => b.CreatedAt).ToList();
    }

    int PruneBackups(int targetId, int keep)
    {
        int removed = 0;
        foreach (var b in ListBackups(targetId).Skip(Math.Max(1, keep)))
        {
            try { Directory.Delete(Path.Combine(BackupRoot(targetId), b.Name), true); removed++; }
            catch { /* не критично */ }
        }
        return removed;
    }

    public static void DeleteTargetBackups(int targetId)
    {
        var root = BackupRoot(targetId);
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }

    // ───────────────────────── этапы и лог ─────────────────────────

    Task Begin(RunState run, string key) => SetStage(run, key, "running", null);
    Task Ok(RunState run, string key, string? d) => SetStage(run, key, "ok", d);
    Task Fail(RunState run, string key, string? d) => SetStage(run, key, "failed", d);
    Task Skip(RunState run, string key, string? d) => SetStage(run, key, "skipped", d);

    async Task SetStage(RunState run, string key, string status, string? detail)
    {
        var s = run.Stage(key);
        s.Status = status;
        s.Detail = detail;
        if (status == "running") { s.StartedAt = DateTime.Now; Log(run, $"── {s.Title} ──"); }
        else
        {
            s.FinishedAt = DateTime.Now;
            var mark = status switch { "ok" => "✔", "failed" => "✖", _ => "·" };
            Log(run, $"{mark} {s.Title}{(detail != null ? ": " + detail : "")}");
        }
        await Broadcast(run);
    }

    static void Log(RunState run, string line)
    {
        var stamped = $"[{DateTime.Now:HH:mm:ss}] {line}";
        lock (run.Log) run.Log.Add(stamped);
        try { File.AppendAllText(run.LogFile, stamped + Environment.NewLine); } catch { /* лог в файл — best effort */ }
    }

    Task Broadcast(RunState run) => hub.Clients.All.SendAsync("runUpdated", run);

    /// <summary>Пачками шлёт новые строки лога во фронт, чтобы не спамить SignalR на каждую строку.</summary>
    sealed class LogFlusher : IDisposable
    {
        readonly RunState _run;
        readonly IHubContext<DeployHub> _hub;
        readonly Timer _timer;
        int _sent;

        public LogFlusher(RunState run, IHubContext<DeployHub> hub)
        {
            _run = run; _hub = hub;
            _timer = new Timer(_ => Flush(), null, 200, 200);
        }

        public void Flush()
        {
            string[] batch;
            lock (_run.Log)
            {
                if (_sent >= _run.Log.Count) return;
                batch = _run.Log.Skip(_sent).ToArray();
                _sent = _run.Log.Count;
            }
            _hub.Clients.All.SendAsync("runLog", _run.Id, batch);
        }

        public void Dispose() => _timer.Dispose();
    }

    // ───────────────────────── хранение ─────────────────────────

    async Task PersistAsync(RunState run)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var e = await db.Runs.FindAsync(run.Id);
        if (e == null)
        {
            e = new DeployRun { Id = run.Id, DeployTargetId = run.TargetId, Kind = run.Kind, StartedAt = run.StartedAt };
            db.Runs.Add(e);
        }
        e.Status = run.Status;
        e.FinishedAt = run.FinishedAt;
        e.Error = run.Error;
        e.BackupName = run.BackupName ?? run.RestoredFrom;
        e.StagesJson = JsonSerializer.Serialize(run.Stages, Json);
        e.TestSummaryJson = run.Tests == null ? null : JsonSerializer.Serialize(run.Tests, Json);
        e.ChangesJson = JsonSerializer.Serialize(new { run.Changes, run.Mirror, run.Health, run.RestoredFrom }, Json);
        await db.SaveChangesAsync();

        // Истории не нужно — держим по 5 последних запусков на окружение
        var old = await db.Runs.Where(r => r.DeployTargetId == run.TargetId)
            .OrderByDescending(r => r.StartedAt).Skip(5).ToListAsync();
        foreach (var o in old)
        {
            try { File.Delete(Path.Combine(AppPaths.Logs, $"{o.Id}.log")); } catch { }
            db.Runs.Remove(o);
        }
        await db.SaveChangesAsync();
    }

    /// <summary>Снимок запуска для фронта: из памяти или восстановленный из базы.</summary>
    public async Task<(RunState run, string[] log)?> GetRunAsync(Guid id)
    {
        if (_recent.TryGetValue(id, out var live))
        {
            lock (live.Log) return (live, live.Log.ToArray());
        }

        await using var db = await dbFactory.CreateDbContextAsync();
        var e = await db.Runs.FindAsync(id);
        if (e == null) return null;
        var target = await db.Targets.Include(t => t.App).FirstOrDefaultAsync(t => t.Id == e.DeployTargetId);

        var extra = e.ChangesJson == null ? null : JsonSerializer.Deserialize<PersistedExtra>(e.ChangesJson, Json);
        var run = new RunState
        {
            Id = e.Id, TargetId = e.DeployTargetId, AppId = target?.AppProjectId ?? 0,
            AppName = target?.App?.Name ?? "?", TargetName = target?.Name ?? "?",
            Kind = e.Kind, StartedAt = e.StartedAt,
            Stages = e.StagesJson == null ? new() : JsonSerializer.Deserialize<List<StageState>>(e.StagesJson, Json)!,
        };
        run.Status = e.Status;
        run.FinishedAt = e.FinishedAt;
        run.Error = e.Error;
        run.CanCancel = false;
        run.Tests = e.TestSummaryJson == null ? null : JsonSerializer.Deserialize<TestSummary>(e.TestSummaryJson, Json);
        run.Changes = extra?.Changes ?? new();
        run.Mirror = extra?.Mirror;
        run.Health = extra?.Health;
        run.RestoredFrom = extra?.RestoredFrom;
        run.BackupName = e.Kind == "Deploy" ? e.BackupName : null;
        run.CanRollback = ServerTouched(run) && ListBackups(e.DeployTargetId).Count > 0;

        var logPath = Path.Combine(AppPaths.Logs, $"{id}.log");
        var log = File.Exists(logPath) ? await File.ReadAllLinesAsync(logPath) : Array.Empty<string>();
        return (run, log);
    }

    /// <summary>Откат имеет смысл, только если файлы на сервере уже трогали.</summary>
    static bool ServerTouched(RunState run) =>
        run.Stages.Any(s => s.Key == "copy" && s.Status is "ok" or "failed");

    record PersistedExtra(List<ConfigChange>? Changes, MirrorStats? Mirror, HealthResult? Health, string? RestoredFrom);

    async Task<DeployTarget> LoadTargetAsync(int id)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var t = await db.Targets
            .Include(x => x.App)
            .Include(x => x.Bindings).ThenInclude(b => b.ConnectionString)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id) ?? throw new KeyNotFoundException("Окружение не найдено");

        if (string.IsNullOrWhiteSpace(t.TargetPath)) throw new InvalidOperationException("У окружения не указана целевая папка.");
        if (string.IsNullOrWhiteSpace(t.App!.ProjectPath)) throw new InvalidOperationException("У приложения не указан путь к проекту.");
        return t;
    }

    async Task<ToolSettings> LoadSettingsAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.Settings.OrderBy(s => s.Id).FirstOrDefaultAsync() ?? new ToolSettings();
    }

    async Task SaveHealthAsync(int targetId, HealthResult res)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var t = await db.Targets.FindAsync(targetId);
        if (t == null) return;
        t.LastHealthOk = res.Ok;
        t.LastHealthMessage = res.Message;
        t.LastHealthAt = DateTime.Now;
        await db.SaveChangesAsync();
        await hub.Clients.All.SendAsync("healthUpdated", targetId, res.Ok, res.Message, t.LastHealthAt);
    }

    static string StatusRu(string s) => s switch
    {
        "Succeeded" => "успешно", "TestsFailed" => "упали тесты", "HealthFailed" => "health не прошёл",
        "Cancelled" => "отменено", "Failed" => "ошибка", _ => s,
    };

    static string Files(int n)
    {
        var m10 = n % 10; var m100 = n % 100;
        var w = m10 == 1 && m100 != 11 ? "файл" : m10 is >= 2 and <= 4 && m100 is < 12 or > 14 ? "файла" : "файлов";
        return $"{n} {w}";
    }

    public static List<string> Lines(string? s) =>
        (s ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    static string? DirOf(string path) =>
        Directory.Exists(path) ? path : Path.GetDirectoryName(Path.GetFullPath(path));
}

/// <summary>Ошибка уже записана в run — просто выходим из пайплайна.</summary>
public class DeployHandledException : Exception;
