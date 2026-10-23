using System.Diagnostics;
using System.Text;

namespace DeployDock.Services;

/// <summary>Запускает dotnet и построчно отдаёт вывод в лог.</summary>
public static class ProcessRunner
{
    public static async Task<int> RunAsync(
        string fileName, IEnumerable<string> args, string? workingDir,
        Action<string> onLine, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = workingDir ?? Environment.CurrentDirectory,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        // Английский вывод + UTF-8: иначе на русской винде кириллица в OEM-кодировке едет кракозябрами.
        psi.Environment["DOTNET_CLI_UI_LANGUAGE"] = "en";
        psi.Environment["DOTNET_NOLOGO"] = "1";
        psi.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
        psi.Environment["MSBUILDTERMINALLOGGER"] = "off";

        onLine($"> {fileName} {string.Join(' ', psi.ArgumentList.Select(Quote))}");

        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => { if (e.Data != null) onLine(e.Data); };
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null) onLine(e.Data); };

        proc.Start();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        await using var reg = ct.Register(() =>
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* уже умер */ }
        });

        await proc.WaitForExitAsync(CancellationToken.None);
        ct.ThrowIfCancellationRequested();
        return proc.ExitCode;
    }

    static string Quote(string a) => a.Contains(' ') ? $"\"{a}\"" : a;

    /// <summary>Режет строку доп. аргументов с учётом кавычек.</summary>
    public static List<string> SplitArgs(string? s)
    {
        var res = new List<string>();
        if (string.IsNullOrWhiteSpace(s)) return res;
        var cur = new StringBuilder();
        bool inQ = false;
        foreach (var c in s)
        {
            if (c == '"') { inQ = !inQ; continue; }
            if (char.IsWhiteSpace(c) && !inQ)
            {
                if (cur.Length > 0) { res.Add(cur.ToString()); cur.Clear(); }
                continue;
            }
            cur.Append(c);
        }
        if (cur.Length > 0) res.Add(cur.ToString());
        return res;
    }
}
