using System.Diagnostics;
using System.Text.Json.Serialization;
using DeployDock.Api;
using DeployDock.Data;
using DeployDock.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // Чтобы wwwroot и appsettings находились рядом с exe, откуда бы его ни запустили
    ContentRootPath = AppContext.BaseDirectory,
});

builder.Services.AddDbContextFactory<AppDb>(o => o.UseSqlite($"Data Source={AppPaths.Database}"));
builder.Services.AddScoped(sp => sp.GetRequiredService<IDbContextFactory<AppDb>>().CreateDbContext());

var dp = builder.Services.AddDataProtection()
    .SetApplicationName("DeployDock")
    .PersistKeysToFileSystem(new DirectoryInfo(AppPaths.ProtectionKeys));
if (OperatingSystem.IsWindows()) dp.ProtectKeysWithDpapi();

builder.Services.AddSingleton<SecretProtector>();
builder.Services.AddSingleton<DeployService>();
builder.Services.AddSingleton<HealthMonitor>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<HealthMonitor>());

builder.Services.AddSignalR().AddJsonProtocol(o =>
    o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    db.Database.EnsureCreated();
    if (!db.Settings.Any()) { db.Settings.Add(new ToolSettings()); db.SaveChanges(); }
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapApi();
app.MapHub<DeployHub>("/hubs/deploy");
app.MapFallbackToFile("index.html");

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = app.Urls.FirstOrDefault() ?? "http://localhost:5080";
    Console.WriteLine();
    Console.WriteLine($"  DeployDock запущен: {url}");
    Console.WriteLine($"  Данные: {AppPaths.Root}");
    Console.WriteLine("  Закрой это окно, чтобы остановить.");
    Console.WriteLine();
    if (OperatingSystem.IsWindows() && !args.Contains("--no-browser"))
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
});

app.Run();
