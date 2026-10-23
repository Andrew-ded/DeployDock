using DeployDock.Data;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace DeployDock.Services;

/// <summary>Раз в минуту опрашивает health всех окружений для дашборда.</summary>
public class HealthMonitor(IDbContextFactory<AppDb> dbFactory, DeployService deploy, IHubContext<DeployHub> hub) : BackgroundService
{
    static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await CheckAllAsync(stoppingToken); } catch when (!stoppingToken.IsCancellationRequested) { }
            await Task.Delay(Interval, stoppingToken);
        }
    }

    public async Task CheckAllAsync(CancellationToken ct)
    {
        List<(int id, string url, bool tls)> targets;
        await using (var db = await dbFactory.CreateDbContextAsync(ct))
        {
            targets = (await db.Targets.Where(t => t.HealthUrl != null && t.HealthUrl != "")
                    .Select(t => new { t.Id, t.HealthUrl, t.IgnoreTlsErrors }).ToListAsync(ct))
                .Select(t => (t.Id, t.HealthUrl!, t.IgnoreTlsErrors)).ToList();
        }

        await Parallel.ForEachAsync(targets, new ParallelOptions { MaxDegreeOfParallelism = 6, CancellationToken = ct },
            async (t, token) =>
            {
                if (deploy.IsBusyWith(t.id)) return; // во время деплоя health и так проверит пайплайн
                await CheckOneAsync(t.id, t.url, t.tls, token);
            });
    }

    public async Task<HealthResult> CheckOneAsync(int targetId, string url, bool ignoreTls, CancellationToken ct)
    {
        var res = await HealthChecker.CheckOnceAsync(url, ignoreTls, ct);
        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var target = await db.Targets.FindAsync(new object[] { targetId }, ct);
        if (target == null) return res;
        target.LastHealthOk = res.Ok;
        target.LastHealthMessage = res.Message;
        target.LastHealthAt = DateTime.Now;
        await db.SaveChangesAsync(ct);
        await hub.Clients.All.SendAsync("healthUpdated", targetId, res.Ok, res.Message, target.LastHealthAt, ct);
        return res;
    }
}
