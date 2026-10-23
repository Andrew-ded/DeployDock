namespace DeployDock.Api;

public record BindingDto(string JsonPath, int ConnectionStringId);

public record TargetDto(
    int? Id, string Name, string TargetPath, string? HealthUrl, bool IgnoreTlsErrors,
    List<BindingDto> Bindings,
    bool? LastHealthOk = null, DateTime? LastHealthAt = null, string? LastHealthMessage = null);

public record AppDto(
    int? Id, string Name, string ProjectPath, string? TestPath, string? PublishArgs,
    List<string> Exclusions, List<string> KeyPaths, List<TargetDto> Targets);

public record ConnectionDto(int Id, string Name, string? Description, string MaskedValue, List<string> UsedBy);
public record ConnectionSaveDto(string Name, string? Description, string? Value);

public record KeyDto(int Id, string JsonPath, string Masked, DateTime CreatedAt);
public record RegenerateKeyDto(string JsonPath);

public record RunBrief(Guid Id, string Kind, string Status, DateTime StartedAt, DateTime? FinishedAt, string? Error);

public record DashboardTarget(
    int Id, string Name, string TargetPath, string? HealthUrl,
    bool? LastHealthOk, DateTime? LastHealthAt, string? LastHealthMessage,
    RunBrief? LastRun, int BackupCount, bool Busy);

public record DashboardApp(int Id, string Name, string ProjectPath, bool HasTests, List<DashboardTarget> Targets);

public record PathCheckDto(List<string> Paths);
public record PathStatus(string Path, string Kind);

public record RollbackDto(string? Backup);
public record SettingsDto(int BackupsToKeep, int HealthTimeoutSec, int OfflineDelaySec, int KeyBytes);
