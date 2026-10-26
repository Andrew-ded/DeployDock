using DeployDock.Data;
using Microsoft.EntityFrameworkCore;

namespace DeployDock.Services;

/// <summary>
/// Переезд со старой версии при старте.
/// 1) Если в папке данных базы ещё нет, а в %LOCALAPPDATA%\DeployDock есть — копирует базу и бэкапы.
/// 2) Все секреты старого формата перешифровывает в новый, чтобы база дальше не зависела от DPAPI.
/// </summary>
public static class DataMigrator
{
    public record Report(bool CopiedFromLegacy, int Reencrypted, int Unreadable);

    public static Report? Last { get; private set; }

    public static void CopyLegacyIfNeeded(ILogger log)
    {
        if (!AppPaths.IsPortable || File.Exists(AppPaths.Database) || !File.Exists(AppPaths.LegacyDatabase)) return;

        File.Copy(AppPaths.LegacyDatabase, AppPaths.Database);
        var legacyBackups = Path.Combine(AppPaths.LegacyRoot, "backups");
        if (Directory.Exists(legacyBackups)) CopyDir(legacyBackups, AppPaths.Backups);
        log.LogInformation("Скопирована база и бэкапы из {Legacy}", AppPaths.LegacyRoot);
        Last = new Report(true, 0, 0);
    }

    public static void ReencryptSecrets(AppDb db, SecretProtector sp, ILogger log)
    {
        int done = 0, failed = 0;

        foreach (var c in db.ConnectionStrings.Where(x => !x.ProtectedValue.StartsWith("dd2:")).ToList())
            if (TryMove(sp, c.ProtectedValue, v => c.ProtectedValue = v)) done++; else failed++;

        foreach (var k in db.SigningKeys.Where(x => !x.ProtectedValue.StartsWith("dd2:")).ToList())
            if (TryMove(sp, k.ProtectedValue, v => k.ProtectedValue = v)) done++; else failed++;

        if (done > 0) db.SaveChanges();
        if (done + failed > 0)
            log.LogInformation("Перешифровано секретов: {Done}, не удалось прочитать: {Failed}", done, failed);

        Last = new Report(Last?.CopiedFromLegacy ?? false, done, failed);
    }

    static bool TryMove(SecretProtector sp, string old, Action<string> set)
    {
        try { set(sp.Protect(sp.Unprotect(old))); return true; }
        catch { return false; }
    }

    static void CopyDir(string from, string to)
    {
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
        {
            var dst = Path.Combine(to, Path.GetRelativePath(from, file));
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            if (!File.Exists(dst)) File.Copy(file, dst);
        }
    }

    public static void EnsureSchema(AppDb db)
    {
        db.Database.EnsureCreated();
        // Без WAL всё лежит в одном deploydock.db — файл можно просто скопировать, рядом нет -wal/-shm
        db.Database.ExecuteSqlRaw("PRAGMA journal_mode=DELETE;");
    }
}
