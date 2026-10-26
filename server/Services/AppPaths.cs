namespace DeployDock.Services;

/// <summary>
/// Где инструмент хранит свои данные.
/// Десктоп-версия передаёт --data-dir = папка data рядом с DeployDock.exe, поэтому всё переносимо:
/// скопировал папку data — забрал приложения, справочник, ключи и бэкапы.
/// Без аргумента (старый консольный режим) — %LOCALAPPDATA%\DeployDock.
/// </summary>
public static class AppPaths
{
    public static string LegacyRoot { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeployDock");

    static string? _root;
    public static string Root => _root ??= Ensure(DefaultRoot());

    /// <summary>Вызывается из Program до первого обращения к путям.</summary>
    public static void Init(string[] args)
    {
        var i = Array.IndexOf(args, "--data-dir");
        var fromArgs = i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        var fromEnv = Environment.GetEnvironmentVariable("DEPLOYDOCK_DATA");
        var chosen = !string.IsNullOrWhiteSpace(fromArgs) ? fromArgs
            : !string.IsNullOrWhiteSpace(fromEnv) ? fromEnv
            : DefaultRoot();
        _root = Ensure(Path.GetFullPath(chosen));
    }

    static string DefaultRoot() => LegacyRoot;

    public static bool IsPortable => !string.Equals(
        Path.GetFullPath(Root).TrimEnd('\\', '/'), Path.GetFullPath(LegacyRoot).TrimEnd('\\', '/'),
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    public static string Database => Path.Combine(Root, "deploydock.db");
    public static string KeyFile => Path.Combine(Root, "deploydock.key");
    public static string Work => Ensure(Path.Combine(Root, "work"));
    public static string Backups => Ensure(Path.Combine(Root, "backups"));
    public static string Logs => Ensure(Path.Combine(Root, "logs"));

    /// <summary>Ключи Data Protection старых версий (закрыты DPAPI) — только чтобы расшифровать старую базу.</summary>
    public static string LegacyProtectionKeys => Path.Combine(LegacyRoot, "protection-keys");
    public static string LegacyDatabase => Path.Combine(LegacyRoot, "deploydock.db");

    static string Ensure(string p)
    {
        Directory.CreateDirectory(p);
        return p;
    }
}
