using Microsoft.AspNetCore.SignalR;

namespace DeployDock.Services;

/// <summary>
/// Канал живых обновлений. Сервер шлёт:
///  runLog(runId, string[] lines), runUpdated(run), healthUpdated(targetId, ok, message, at).
/// Пользователь один, поэтому шлём всем подключённым.
/// </summary>
public class DeployHub : Hub;
