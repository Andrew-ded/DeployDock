using System.Text.Json.Serialization;

namespace DeployDock.Services;

public class StageState
{
    public string Key { get; set; } = "";
    public string Title { get; set; } = "";
    /// <summary>pending | running | ok | failed | skipped</summary>
    public string Status { get; set; } = "pending";
    public string? Detail { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
}

/// <summary>Состояние одного запуска (деплой или откат) — то, что видит фронт.</summary>
public class RunState
{
    public Guid Id { get; init; }
    public int TargetId { get; init; }
    public int AppId { get; init; }
    public string AppName { get; init; } = "";
    public string TargetName { get; init; } = "";
    /// <summary>Deploy | Rollback</summary>
    public string Kind { get; init; } = "Deploy";
    /// <summary>Running | Succeeded | TestsFailed | Failed | HealthFailed | Cancelled</summary>
    public string Status { get; set; } = "Running";
    public DateTime StartedAt { get; init; }
    public DateTime? FinishedAt { get; set; }
    public string? Error { get; set; }
    public bool CanCancel { get; set; } = true;
    public bool CanRollback { get; set; }

    public List<StageState> Stages { get; init; } = new();
    public TestSummary? Tests { get; set; }
    public List<ConfigChange> Changes { get; set; } = new();
    public MirrorStats? Mirror { get; set; }
    public string? BackupName { get; set; }
    public string? RestoredFrom { get; set; }
    public HealthResult? Health { get; set; }

    [JsonIgnore] public List<string> Log { get; } = new();
    [JsonIgnore] public CancellationTokenSource Cts { get; } = new();
    [JsonIgnore] public string LogFile { get; init; } = "";

    public StageState Stage(string key) => Stages.First(s => s.Key == key);
}
