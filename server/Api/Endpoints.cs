using DeployDock.Data;
using DeployDock.Services;
using Microsoft.EntityFrameworkCore;

namespace DeployDock.Api;

public static class Endpoints
{
    public static void MapApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        // ───────── дашборд ─────────
        api.MapGet("/dashboard", async (AppDb db, DeployService deploy) =>
        {
            var apps = await db.Apps.Include(a => a.Targets).AsNoTracking().OrderBy(a => a.Name).ToListAsync();
            var targetIds = apps.SelectMany(a => a.Targets).Select(t => t.Id).ToList();
            var lastRuns = (await db.Runs.Where(r => targetIds.Contains(r.DeployTargetId)).ToListAsync())
                .GroupBy(r => r.DeployTargetId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.StartedAt).First());

            return apps.Select(a => new DashboardApp(a.Id, a.Name, a.ProjectPath, !string.IsNullOrWhiteSpace(a.TestPath),
                a.Targets.OrderBy(t => t.Id).Select(t =>
                {
                    var live = deploy.Current is { } c && c.TargetId == t.Id ? c : null;
                    RunBrief? brief = live != null
                        ? new RunBrief(live.Id, live.Kind, live.Status, live.StartedAt, live.FinishedAt, live.Error)
                        : lastRuns.TryGetValue(t.Id, out var r) ? new RunBrief(r.Id, r.Kind, r.Status, r.StartedAt, r.FinishedAt, r.Error) : null;
                    return new DashboardTarget(t.Id, t.Name, t.TargetPath, t.HealthUrl,
                        t.LastHealthOk, t.LastHealthAt, t.LastHealthMessage,
                        brief, deploy.ListBackups(t.Id).Count, live != null);
                }).ToList())).ToList();
        });

        // ───────── приложения ─────────
        api.MapGet("/apps", async (AppDb db) =>
            (await LoadApps(db).OrderBy(a => a.Name).ToListAsync()).Select(ToDto));

        api.MapGet("/apps/{id:int}", async (int id, AppDb db) =>
            await LoadApps(db).FirstOrDefaultAsync(a => a.Id == id) is { } a ? Results.Ok(ToDto(a)) : Results.NotFound());

        api.MapPost("/apps", async (AppDto dto, AppDb db) =>
        {
            if (Validate(dto) is { } err) return Results.BadRequest(new { error = err });
            var entity = new AppProject();
            Apply(entity, dto, db);
            db.Apps.Add(entity);
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(await LoadApps(db).FirstAsync(a => a.Id == entity.Id)));
        });

        api.MapPut("/apps/{id:int}", async (int id, AppDto dto, AppDb db, DeployService deploy) =>
        {
            if (Validate(dto) is { } err) return Results.BadRequest(new { error = err });
            var entity = await LoadApps(db).FirstOrDefaultAsync(a => a.Id == id);
            if (entity == null) return Results.NotFound();
            if (entity.Targets.Any(t => deploy.IsBusyWith(t.Id)))
                return Results.Conflict(new { error = "Сейчас идёт деплой этого приложения — подожди." });

            var removed = Apply(entity, dto, db);
            await db.SaveChangesAsync();
            foreach (var tid in removed) DeployService.DeleteTargetBackups(tid);
            return Results.Ok(ToDto(await LoadApps(db).FirstAsync(a => a.Id == id)));
        });

        api.MapDelete("/apps/{id:int}", async (int id, AppDb db, DeployService deploy) =>
        {
            var entity = await db.Apps.Include(a => a.Targets).FirstOrDefaultAsync(a => a.Id == id);
            if (entity == null) return Results.NotFound();
            if (entity.Targets.Any(t => deploy.IsBusyWith(t.Id)))
                return Results.Conflict(new { error = "Сейчас идёт деплой этого приложения." });
            var ids = entity.Targets.Select(t => t.Id).ToList();
            db.Runs.RemoveRange(db.Runs.Where(r => ids.Contains(r.DeployTargetId)));
            db.Apps.Remove(entity);
            await db.SaveChangesAsync();
            foreach (var tid in ids) DeployService.DeleteTargetBackups(tid);
            return Results.NoContent();
        });

        // ───────── справочник строк подключения ─────────
        api.MapGet("/connections", async (AppDb db, SecretProtector sp) =>
        {
            var list = await db.ConnectionStrings.AsNoTracking().OrderBy(c => c.Name).ToListAsync();
            var usage = await db.Bindings.Include(b => b.ConnectionString)
                .Join(db.Targets.Include(t => t.App), b => b.DeployTargetId, t => t.Id,
                    (b, t) => new { b.ConnectionStringId, Label = t.App!.Name + " / " + t.Name })
                .ToListAsync();
            return list.Select(c => new ConnectionDto(c.Id, c.Name, c.Description,
                MaskSafe(sp, c.ProtectedValue),
                usage.Where(u => u.ConnectionStringId == c.Id).Select(u => u.Label).Distinct().ToList()));
        });

        api.MapGet("/connections/{id:int}/value", async (int id, AppDb db, SecretProtector sp) =>
            await db.ConnectionStrings.FindAsync(id) is { } c
                ? Results.Ok(new { value = SafeUnprotect(sp, c.ProtectedValue) })
                : Results.NotFound());

        api.MapPost("/connections", async (ConnectionSaveDto dto, AppDb db, SecretProtector sp) =>
        {
            if (string.IsNullOrWhiteSpace(dto.Name) || string.IsNullOrWhiteSpace(dto.Value))
                return Results.BadRequest(new { error = "Нужны название и строка подключения." });
            var e = new ConnectionStringEntry { Name = dto.Name.Trim(), Description = dto.Description, ProtectedValue = sp.Protect(dto.Value.Trim()) };
            db.ConnectionStrings.Add(e);
            await db.SaveChangesAsync();
            return Results.Ok(new { e.Id });
        });

        api.MapPut("/connections/{id:int}", async (int id, ConnectionSaveDto dto, AppDb db, SecretProtector sp) =>
        {
            var e = await db.ConnectionStrings.FindAsync(id);
            if (e == null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(dto.Name)) return Results.BadRequest(new { error = "Нужно название." });
            e.Name = dto.Name.Trim();
            e.Description = dto.Description;
            if (!string.IsNullOrWhiteSpace(dto.Value)) e.ProtectedValue = sp.Protect(dto.Value.Trim());
            await db.SaveChangesAsync();
            return Results.Ok(new { e.Id });
        });

        api.MapDelete("/connections/{id:int}", async (int id, AppDb db) =>
        {
            var e = await db.ConnectionStrings.FindAsync(id);
            if (e == null) return Results.NotFound();
            if (await db.Bindings.AnyAsync(b => b.ConnectionStringId == id))
                return Results.Conflict(new { error = "Строка используется в окружениях — сначала отвяжи её." });
            db.ConnectionStrings.Remove(e);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ───────── ключи подписи ─────────
        api.MapGet("/keys/generate", (int? bytes, string? format) =>
            new { value = SecretProtector.GenerateKey(bytes ?? 64, format ?? "base64") });

        api.MapGet("/targets/{id:int}/keys", async (int id, AppDb db, SecretProtector sp) =>
            (await db.SigningKeys.Where(k => k.DeployTargetId == id).OrderBy(k => k.JsonPath).ToListAsync())
            .Select(k => new KeyDto(k.Id, k.JsonPath, MaskSafe(sp, k.ProtectedValue), k.CreatedAt)));

        api.MapGet("/keys/{id:int}/value", async (int id, AppDb db, SecretProtector sp) =>
            await db.SigningKeys.FindAsync(id) is { } k
                ? Results.Ok(new { value = SafeUnprotect(sp, k.ProtectedValue) })
                : Results.NotFound());

        api.MapPost("/targets/{id:int}/keys/regenerate", async (int id, RegenerateKeyDto dto, AppDb db, SecretProtector sp) =>
        {
            if (string.IsNullOrWhiteSpace(dto.JsonPath)) return Results.BadRequest(new { error = "Нужен путь ключа." });
            if (await db.Targets.FindAsync(id) == null) return Results.NotFound();
            var settings = await db.Settings.OrderBy(s => s.Id).FirstOrDefaultAsync() ?? new ToolSettings();
            var path = dto.JsonPath.Trim();
            var k = await db.SigningKeys.FirstOrDefaultAsync(x => x.DeployTargetId == id && x.JsonPath == path);
            if (k == null) { k = new SigningKey { DeployTargetId = id, JsonPath = path }; db.SigningKeys.Add(k); }
            k.ProtectedValue = sp.Protect(SecretProtector.GenerateKey(settings.KeyBytes, "base64"));
            k.CreatedAt = DateTime.Now;
            await db.SaveChangesAsync();
            return Results.Ok(new { k.Id });
        });

        api.MapDelete("/keys/{id:int}", async (int id, AppDb db) =>
        {
            var k = await db.SigningKeys.FindAsync(id);
            if (k == null) return Results.NotFound();
            db.SigningKeys.Remove(k);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ───────── деплой / откат / запуски ─────────
        api.MapPost("/targets/{id:int}/deploy", async (int id, DeployService deploy) =>
            await StartSafe(() => deploy.StartDeployAsync(id)));

        api.MapPost("/targets/{id:int}/rollback", async (int id, RollbackDto? dto, DeployService deploy) =>
            await StartSafe(() => deploy.StartRollbackAsync(id, dto?.Backup)));

        api.MapGet("/targets/{id:int}/backups", (int id, DeployService deploy) => deploy.ListBackups(id));

        api.MapPost("/targets/{id:int}/health", async (int id, AppDb db, HealthMonitor monitor) =>
        {
            var t = await db.Targets.FindAsync(id);
            if (t == null) return Results.NotFound();
            if (string.IsNullOrWhiteSpace(t.HealthUrl)) return Results.BadRequest(new { error = "URL health не указан." });
            return Results.Ok(await monitor.CheckOneAsync(id, t.HealthUrl, t.IgnoreTlsErrors, CancellationToken.None));
        });

        api.MapPost("/health/check-all", async (HealthMonitor monitor) =>
        {
            await monitor.CheckAllAsync(CancellationToken.None);
            return Results.NoContent();
        });

        api.MapGet("/runs/current", (DeployService deploy) =>
            deploy.Current is { } c ? Results.Ok(new { c.Id }) : Results.NoContent());

        api.MapGet("/runs/{id:guid}", async (Guid id, DeployService deploy) =>
            await deploy.GetRunAsync(id) is { } r ? Results.Ok(new { run = r.run, log = r.log }) : Results.NotFound());

        api.MapPost("/runs/{id:guid}/cancel", (Guid id, DeployService deploy) =>
            deploy.Cancel(id) ? Results.NoContent() : Results.Conflict(new { error = "Этот запуск уже нельзя отменить." }));

        // ───────── настройки и мелочи ─────────
        api.MapGet("/settings", async (AppDb db) =>
            await db.Settings.OrderBy(s => s.Id).FirstOrDefaultAsync() is { } s
                ? new SettingsDto(s.BackupsToKeep, s.HealthTimeoutSec, s.OfflineDelaySec, s.KeyBytes)
                : new SettingsDto(5, 60, 3, 64));

        api.MapPut("/settings", async (SettingsDto dto, AppDb db) =>
        {
            var s = await db.Settings.OrderBy(s => s.Id).FirstOrDefaultAsync();
            if (s == null) { s = new ToolSettings(); db.Settings.Add(s); }
            s.BackupsToKeep = Math.Clamp(dto.BackupsToKeep, 1, 50);
            s.HealthTimeoutSec = Math.Clamp(dto.HealthTimeoutSec, 5, 600);
            s.OfflineDelaySec = Math.Clamp(dto.OfflineDelaySec, 0, 60);
            s.KeyBytes = Math.Clamp(dto.KeyBytes, 32, 256);
            await db.SaveChangesAsync();
            return Results.Ok(dto with { BackupsToKeep = s.BackupsToKeep, HealthTimeoutSec = s.HealthTimeoutSec, OfflineDelaySec = s.OfflineDelaySec, KeyBytes = s.KeyBytes });
        });

        api.MapPost("/fs/check", (PathCheckDto dto) =>
            dto.Paths.Select(p => new PathStatus(p,
                string.IsNullOrWhiteSpace(p) ? "empty"
                : File.Exists(p) ? "file"
                : Directory.Exists(p) ? "dir" : "missing")));

        api.MapGet("/info", () => new { dataDir = AppPaths.Root, portable = AppPaths.IsPortable, version = typeof(Endpoints).Assembly.GetName().Version?.ToString(3) });
    }

    static async Task<IResult> StartSafe(Func<Task<RunState>> start)
    {
        try { return Results.Ok(new { (await start()).Id }); }
        catch (BusyException ex) { return Results.Conflict(new { error = ex.Message }); }
        catch (KeyNotFoundException ex) { return Results.NotFound(new { error = ex.Message }); }
        catch (InvalidOperationException ex) { return Results.BadRequest(new { error = ex.Message }); }
    }

    const string Unreadable = "(не расшифровывается: нет подходящего deploydock.key)";

    static string MaskSafe(SecretProtector sp, string cipher)
    {
        try { return SecretProtector.Mask(sp.Unprotect(cipher)); }
        catch { return Unreadable; }
    }

    static string SafeUnprotect(SecretProtector sp, string cipher)
    {
        try { return sp.Unprotect(cipher); }
        catch { return Unreadable; }
    }

    static IQueryable<AppProject> LoadApps(AppDb db) =>
        db.Apps.Include(a => a.Targets).ThenInclude(t => t.Bindings).AsSplitQuery();

    static string? Validate(AppDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Name)) return "Нужно название приложения.";
        if (string.IsNullOrWhiteSpace(dto.ProjectPath)) return "Нужен путь к проекту (.csproj или папка).";
        if (dto.Targets.Count == 0) return "Добавь хотя бы одно окружение.";
        foreach (var t in dto.Targets)
        {
            if (string.IsNullOrWhiteSpace(t.Name)) return "У окружения нет названия.";
            if (string.IsNullOrWhiteSpace(t.TargetPath)) return $"У окружения «{t.Name}» нет целевой папки.";
            if (t.Bindings.Any(b => string.IsNullOrWhiteSpace(b.JsonPath))) return $"В окружении «{t.Name}» есть привязка без JSON-пути.";
        }
        if (dto.Targets.GroupBy(t => t.Name.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1))
            return "Названия окружений должны быть разными.";
        return null;
    }

    /// <summary>Переносит DTO в сущность. Окружения матчим по Id, чтобы не потерять их ключи. Возвращает id удалённых окружений.</summary>
    static List<int> Apply(AppProject e, AppDto dto, AppDb db)
    {
        e.Name = dto.Name.Trim();
        e.ProjectPath = dto.ProjectPath.Trim();
        e.TestPath = string.IsNullOrWhiteSpace(dto.TestPath) ? null : dto.TestPath.Trim();
        e.PublishArgs = string.IsNullOrWhiteSpace(dto.PublishArgs) ? null : dto.PublishArgs.Trim();
        e.Exclusions = string.Join('\n', dto.Exclusions.Select(x => x.Trim()).Where(x => x.Length > 0));
        e.KeyPaths = string.Join('\n', dto.KeyPaths.Select(x => x.Trim()).Where(x => x.Length > 0));

        var keepIds = dto.Targets.Where(t => t.Id != null).Select(t => t.Id!.Value).ToHashSet();
        var removed = e.Targets.Where(t => !keepIds.Contains(t.Id)).ToList();
        foreach (var r in removed)
        {
            db.Runs.RemoveRange(db.Runs.Where(x => x.DeployTargetId == r.Id));
            e.Targets.Remove(r);
        }

        foreach (var td in dto.Targets)
        {
            var t = td.Id != null ? e.Targets.FirstOrDefault(x => x.Id == td.Id) : null;
            if (t == null) { t = new DeployTarget(); e.Targets.Add(t); }
            t.Name = td.Name.Trim();
            t.TargetPath = td.TargetPath.Trim();
            t.HealthUrl = string.IsNullOrWhiteSpace(td.HealthUrl) ? null : td.HealthUrl.Trim();
            t.IgnoreTlsErrors = td.IgnoreTlsErrors;

            db.Bindings.RemoveRange(t.Bindings);
            t.Bindings = td.Bindings
                .Select(b => new ConnectionBinding { JsonPath = b.JsonPath.Trim(), ConnectionStringId = b.ConnectionStringId })
                .ToList();
        }
        return removed.Select(r => r.Id).Where(id => id > 0).ToList();
    }

    static AppDto ToDto(AppProject a) => new(
        a.Id, a.Name, a.ProjectPath, a.TestPath, a.PublishArgs,
        DeployService.Lines(a.Exclusions), DeployService.Lines(a.KeyPaths),
        a.Targets.OrderBy(t => t.Id).Select(t => new TargetDto(
            t.Id, t.Name, t.TargetPath, t.HealthUrl, t.IgnoreTlsErrors,
            t.Bindings.Select(b => new BindingDto(b.JsonPath, b.ConnectionStringId)).ToList(),
            t.LastHealthOk, t.LastHealthAt, t.LastHealthMessage)).ToList());
}
