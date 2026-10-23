namespace DeployDock.Data;

/// <summary>Публикуемое приложение (один .NET-проект).</summary>
public class AppProject
{
    public int Id { get; set; }
    public string Name { get; set; } = "";

    /// <summary>Путь к .csproj или к папке с ним.</summary>
    public string ProjectPath { get; set; } = "";

    /// <summary>Путь к тестовому проекту / .sln. Пусто — тесты не гоняем.</summary>
    public string? TestPath { get; set; }

    /// <summary>Доп. аргументы для dotnet publish (например -r win-x64).</summary>
    public string? PublishArgs { get; set; }

    /// <summary>Пути в целевой папке, которые не трогаем. По одному на строку.</summary>
    public string Exclusions { get; set; } = "";

    /// <summary>JSON-пути ключей подписи (Jwt:Key). По одному на строку.</summary>
    public string KeyPaths { get; set; } = "";

    public List<DeployTarget> Targets { get; set; } = new();
}

/// <summary>Окружение приложения: куда кладём и как проверяем.</summary>
public class DeployTarget
{
    public int Id { get; set; }
    public int AppProjectId { get; set; }
    public AppProject? App { get; set; }

    public string Name { get; set; } = "Prod";
    public string TargetPath { get; set; } = "";
    public string? HealthUrl { get; set; }
    public bool IgnoreTlsErrors { get; set; }

    public List<ConnectionBinding> Bindings { get; set; } = new();
    public List<SigningKey> Keys { get; set; } = new();

    public bool? LastHealthOk { get; set; }
    public DateTime? LastHealthAt { get; set; }
    public string? LastHealthMessage { get; set; }
}

/// <summary>Связка «JSON-путь в appsettings → строка из справочника».</summary>
public class ConnectionBinding
{
    public int Id { get; set; }
    public int DeployTargetId { get; set; }
    public string JsonPath { get; set; } = "ConnectionStrings:Default";
    public int ConnectionStringId { get; set; }
    public ConnectionStringEntry? ConnectionString { get; set; }
}

/// <summary>Запись справочника строк подключения. Значение зашифровано.</summary>
public class ConnectionStringEntry
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string ProtectedValue { get; set; } = "";
}

/// <summary>Сгенерированный один раз ключ подписи для окружения + JSON-пути.</summary>
public class SigningKey
{
    public int Id { get; set; }
    public int DeployTargetId { get; set; }
    public string JsonPath { get; set; } = "";
    public string ProtectedValue { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class DeployRun
{
    public Guid Id { get; set; }
    public int DeployTargetId { get; set; }
    public string Kind { get; set; } = "Deploy";
    public string Status { get; set; } = "Running";
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? Error { get; set; }
    public string? StagesJson { get; set; }
    public string? TestSummaryJson { get; set; }
    public string? ChangesJson { get; set; }
    public string? BackupName { get; set; }
}

public class ToolSettings
{
    public int Id { get; set; }
    public int BackupsToKeep { get; set; } = 5;
    public int HealthTimeoutSec { get; set; } = 60;
    public int OfflineDelaySec { get; set; } = 3;
    public int KeyBytes { get; set; } = 64;
}
