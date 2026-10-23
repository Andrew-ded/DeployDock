using Microsoft.EntityFrameworkCore;

namespace DeployDock.Data;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<AppProject> Apps => Set<AppProject>();
    public DbSet<DeployTarget> Targets => Set<DeployTarget>();
    public DbSet<ConnectionBinding> Bindings => Set<ConnectionBinding>();
    public DbSet<ConnectionStringEntry> ConnectionStrings => Set<ConnectionStringEntry>();
    public DbSet<SigningKey> SigningKeys => Set<SigningKey>();
    public DbSet<DeployRun> Runs => Set<DeployRun>();
    public DbSet<ToolSettings> Settings => Set<ToolSettings>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppProject>()
            .HasMany(a => a.Targets).WithOne(t => t.App!)
            .HasForeignKey(t => t.AppProjectId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<DeployTarget>()
            .HasMany(t => t.Bindings).WithOne()
            .HasForeignKey(x => x.DeployTargetId).OnDelete(DeleteBehavior.Cascade);

        b.Entity<DeployTarget>()
            .HasMany(t => t.Keys).WithOne()
            .HasForeignKey(x => x.DeployTargetId).OnDelete(DeleteBehavior.Cascade);

        // Строку из справочника нельзя удалить, пока она где-то привязана.
        b.Entity<ConnectionBinding>()
            .HasOne(x => x.ConnectionString).WithMany()
            .HasForeignKey(x => x.ConnectionStringId).OnDelete(DeleteBehavior.Restrict);

        b.Entity<SigningKey>().HasIndex(x => new { x.DeployTargetId, x.JsonPath }).IsUnique();
        b.Entity<DeployRun>().HasIndex(x => new { x.DeployTargetId, x.StartedAt });
    }
}
