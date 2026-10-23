using System.Diagnostics;

namespace DeployDock.Services;

public record HealthResult(bool Ok, string Message);

public static class HealthChecker
{
    static HttpClient CreateClient(bool ignoreTls)
    {
        var handler = new HttpClientHandler
        {
            // IIS с Windows-аутентификацией пустит под твоей учёткой
            UseDefaultCredentials = true,
        };
        if (ignoreTls)
            handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(10) };
    }

    public static async Task<HealthResult> CheckOnceAsync(string url, bool ignoreTls, CancellationToken ct = default)
    {
        using var client = CreateClient(ignoreTls);
        var sw = Stopwatch.StartNew();
        try
        {
            using var resp = await client.GetAsync(url, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (body.Length > 200) body = body[..200] + "…";
            var msg = $"{(int)resp.StatusCode} {resp.ReasonPhrase} за {sw.ElapsedMilliseconds} мс" +
                      (string.IsNullOrWhiteSpace(body) ? "" : $": {body.Trim()}");
            return new HealthResult(resp.IsSuccessStatusCode, msg);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new HealthResult(false, "таймаут 10 с");
        }
        catch (Exception ex)
        {
            return new HealthResult(false, ex.InnerException?.Message ?? ex.Message);
        }
    }

    /// <summary>Долбим health, пока не ответит 2xx или не выйдет время.</summary>
    public static async Task<HealthResult> WaitHealthyAsync(
        string url, bool ignoreTls, TimeSpan timeout, Action<string> log, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow + timeout;
        HealthResult last = new(false, "не проверялось");
        int attempt = 0;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            attempt++;
            last = await CheckOnceAsync(url, ignoreTls, ct);
            log($"  health #{attempt}: {(last.Ok ? "OK" : "нет")} — {last.Message}");
            if (last.Ok) return last;
            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }
        return last with { Message = $"не поднялось за {timeout.TotalSeconds:0} с. Последний ответ: {last.Message}" };
    }
}
