using System.Diagnostics;
using System.Text.Json.Serialization;
using DeployDock.Api;
using DeployDock.Data;
using DeployDock.Services;
using Microsoft.EntityFrameworkCore;

// Порядок важен: папку данных выбираем до того, как кто-то обратится к путям
AppPaths.Init(args);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // Чтобы wwwroot и appsettings находились рядом с exe, откуда бы его ни запустили
    ContentRootPath = AppContext.BaseDirectory,
});

builder.Services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={AppPaths.Database}"));
builder.Services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext());

builder.Services.AddSingleton<SecretProtector>();
builder.Services.AddSingleton<DeployService>();
builder.Services.AddSingleton<HealthMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<HealthMonitor>());

builder.Services.AddSignalR().AddJsonProtocol(o =>
    o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();
var log = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("DeployDock");

DataMigrator.CopyLegacyIfNeeded(log);
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    DataMigrator.EnsureSchema(db);
    if (!db.Settings.Any()) { db.Settings.Add(new ToolSettings()); db.SaveChanges(); }
    DataMigrator.ReencryptSecrets(db, scope.ServiceProvider.GetRequiredService<SecretProtector>(), log);
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapApi();
app.MapHub<DeployHub>("/hubs/deploy");
app.MapFallbackToFile("index.html");

// Десктоп-оболочка передаёт свой PID: умерла оболочка — уходим и мы, без висящих процессов
var pi = Array.IndexOf(args, "--parent-pid");
if (pi >= 0 && pi + 1 < args.Length && int.TryParse(args[pi + 1], out var parentPid))
{
    _ = Task.Run(async () =>
    {
        try
        {
            using var parent = Process.GetProcessById(parentPid);
            await parent.WaitForExitAsync();
        }
        catch { /* процесса уже нет */ }
        app.Lifetime.StopApplication();
    });
}

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = app.Urls.FirstOrDefault() ?? "http://localhost:5080";
    // Эту строку ждёт десктоп-оболочка, чтобы показать окно
    Console.WriteLine($"DEPLOYDOCK_READY {url}");
    Console.WriteLine($"  Данные: {AppPaths.Root}");
    if (OperatingSystem.IsWindows() && !args.Contains("--no-browser"))
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
});

app.Run();
