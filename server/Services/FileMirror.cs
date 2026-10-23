using System.IO.Enumeration;
using System.Security.Cryptography;

namespace DeployDock.Services;

public record MirrorStats(int Copied, int Unchanged, int Deleted, int Excluded);

/// <summary>
/// Делает целевую папку зеркалом исходной: копирует новое/изменённое, удаляет лишнее.
/// Исключения не трогаются вообще — ни перезапись, ни удаление.
/// </summary>
public class FileMirror(IEnumerable<string> exclusions, Action<string> log)
{
    public const string OfflineFile = "app_offline.htm";

    readonly List<string> _patterns = exclusions
        .Select(Normalize).Where(p => p.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public static string Normalize(string p) => p.Trim().Replace('\\', '/').Trim('/');

    /// <summary>
    /// «logs» — папка logs целиком; «web.config» — файл; можно со звёздочками: «*.log», «uploads/*».
    /// </summary>
    public bool IsExcluded(string rel)
    {
        rel = Normalize(rel);
        foreach (var p in _patterns)
        {
            if (rel.Equals(p, StringComparison.OrdinalIgnoreCase)) return true;
            if (rel.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase)) return true;
            if (p.Contains('*') || p.Contains('?'))
            {
                if (FileSystemName.MatchesSimpleExpression(p, rel, ignoreCase: true)) return true;
                // «*.log» без папки — матчим по имени файла на любой глубине
                if (!p.Contains('/') && FileSystemName.MatchesSimpleExpression(p, Path.GetFileName(rel), ignoreCase: true)) return true;
            }
        }
        return false;
    }

    public MirrorStats Mirror(string source, string target, CancellationToken ct)
    {
        Directory.CreateDirectory(target);
        int copied = 0, same = 0, deleted = 0, excluded = 0;
        var sourceFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sourceDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var src in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            ct.ThrowIfCancellationRequested();
            var rel = Rel(source, src);
            if (rel.Equals(OfflineFile, StringComparison.OrdinalIgnoreCase)) continue;
            sourceFiles.Add(rel);
            for (var d = Path.GetDirectoryName(rel); !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d))
                sourceDirs.Add(Normalize(d));

            if (IsExcluded(rel)) { excluded++; continue; }

            var dst = Path.Combine(target, rel);
            if (File.Exists(dst) && SameContent(src, dst)) { same++; continue; }

            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            Retry(() => File.Copy(src, dst, overwrite: true), $"копирование {rel}");
            copied++;
        }

        foreach (var dst in Directory.EnumerateFiles(target, "*", SearchOption.AllDirectories).ToList())
        {
            ct.ThrowIfCancellationRequested();
            var rel = Rel(target, dst);
            if (rel.Equals(OfflineFile, StringComparison.OrdinalIgnoreCase)) continue;
            if (sourceFiles.Contains(rel) || IsExcluded(rel)) continue;
            Retry(() => { File.SetAttributes(dst, FileAttributes.Normal); File.Delete(dst); }, $"удаление {rel}");
            log($"  - удалён {rel}");
            deleted++;
        }

        // Пустые папки, которых нет в новой сборке, — снизу вверх
        foreach (var dir in Directory.EnumerateDirectories(target, "*", SearchOption.AllDirectories)
                     .OrderByDescending(d => d.Length).ToList())
        {
            var rel = Rel(target, dir);
            if (sourceDirs.Contains(rel) || IsExcluded(rel)) continue;
            if (!Directory.EnumerateFileSystemEntries(dir).Any())
                Retry(() => Directory.Delete(dir), $"удаление папки {rel}");
        }

        return new MirrorStats(copied, same, deleted, excluded);
    }

    /// <summary>Копия целевой папки для отката (исключения не копируем — их и так не трогаем).</summary>
    public int Backup(string target, string backupDir, CancellationToken ct)
    {
        int n = 0;
        foreach (var src in Directory.EnumerateFiles(target, "*", SearchOption.AllDirectories))
        {
            ct.ThrowIfCancellationRequested();
            var rel = Rel(target, src);
            if (rel.Equals(OfflineFile, StringComparison.OrdinalIgnoreCase) || IsExcluded(rel)) continue;
            var dst = Path.Combine(backupDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dst)!);
            File.Copy(src, dst, overwrite: true);
            n++;
        }
        return n;
    }

    static string Rel(string root, string full) => Normalize(Path.GetRelativePath(root, full));

    static bool SameContent(string a, string b)
    {
        var fa = new FileInfo(a); var fb = new FileInfo(b);
        if (fa.Length != fb.Length) return false;
        try
        {
            using var sa = fa.OpenRead(); using var sb = fb.OpenRead();
            return SHA256.HashData(sa).AsSpan().SequenceEqual(SHA256.HashData(sb));
        }
        catch (IOException) { return false; } // залочен — пусть копирование разбирается с ретраями
    }

    void Retry(Action action, string what)
    {
        const int attempts = 10;
        for (int i = 1; ; i++)
        {
            try { action(); return; }
            catch (Exception ex) when ((ex is IOException or UnauthorizedAccessException) && i < attempts)
            {
                if (i == 1 || i % 3 == 0) log($"  ! {what}: {ex.Message} — жду и пробую ещё ({i}/{attempts})");
                Thread.Sleep(1000);
            }
        }
    }
}
