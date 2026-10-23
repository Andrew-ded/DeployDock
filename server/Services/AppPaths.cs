namespace DeployDock.Services;

/// <summary>Где инструмент хранит свои данные: %LOCALAPPDATA%\DeployDock.</summary>
public static class AppPaths
{
    public static string Root { get; } = InitRoot();

    public static string Database => Path.Combine(Root, "deploydock.db");
    public static string ProtectionKeys => Ensure(Path.Combine(Root, "protection-keys"));
    public static string Work => Ensure(Path.Combine(Root, "work"));
    public static string Backups => Ensure(Path.Combine(Root, "backups"));
    public static string Logs => Ensure(Path.Combine(Root, "logs"));

    static string InitRoot()
    {
        var overridden = Environment.GetEnvironmentVariable("DEPLOYDOCK_DATA");
        var root = !string.IsNullOrWhiteSpace(overridden)
            ? overridden
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeployDock");
        return Ensure(root);
    }

    static string Ensure(string p)
    {
        Directory.CreateDirectory(p);
        return p;
    }
}
