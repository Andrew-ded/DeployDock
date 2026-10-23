using System.Xml.Linq;

namespace DeployDock.Services;

public record TestCase(string Name, string Outcome, double DurationMs, string? Message, string? StackTrace, string Source);

public record TestSummary(int Total, int Passed, int Failed, int Skipped, List<TestCase> Tests)
{
    public static TestSummary Empty => new(0, 0, 0, 0, new());
}

/// <summary>Разбирает .trx-файлы, которые пишет dotnet test --logger trx.</summary>
public static class TrxParser
{
    static readonly XNamespace Ns = "http://microsoft.com/schemas/VisualStudio/TeamTest/2010";

    public static TestSummary ParseDirectory(string dir)
    {
        if (!Directory.Exists(dir)) return TestSummary.Empty;
        var tests = new List<TestCase>();

        foreach (var file in Directory.EnumerateFiles(dir, "*.trx", SearchOption.AllDirectories))
        {
            XDocument doc;
            try { doc = XDocument.Load(file); } catch { continue; }

            // Имя тестовой сборки берём из TestDefinitions → storage
            var storageById = doc.Descendants(Ns + "UnitTest")
                .ToDictionary(
                    u => (string?)u.Attribute("id") ?? "",
                    u => Path.GetFileNameWithoutExtension((string?)u.Attribute("storage") ?? Path.GetFileName(file)));

            foreach (var r in doc.Descendants(Ns + "UnitTestResult"))
            {
                var testId = (string?)r.Attribute("testId") ?? "";
                var err = r.Element(Ns + "Output")?.Element(Ns + "ErrorInfo");
                tests.Add(new TestCase(
                    Name: (string?)r.Attribute("testName") ?? "?",
                    Outcome: (string?)r.Attribute("outcome") ?? "Unknown",
                    DurationMs: TimeSpan.TryParse((string?)r.Attribute("duration"), out var d) ? d.TotalMilliseconds : 0,
                    Message: err?.Element(Ns + "Message")?.Value.Trim(),
                    StackTrace: err?.Element(Ns + "StackTrace")?.Value.Trim(),
                    Source: storageById.GetValueOrDefault(testId, Path.GetFileNameWithoutExtension(file))));
            }
        }

        int passed = tests.Count(t => t.Outcome == "Passed");
        int failed = tests.Count(t => t.Outcome is "Failed" or "Error" or "Timeout" or "Aborted");
        int skipped = tests.Count - passed - failed;

        // Упавшие наверх, чтобы сразу было видно
        var ordered = tests.OrderBy(t => t.Outcome == "Passed" ? 2 : t.Outcome == "NotExecuted" ? 1 : 0)
            .ThenBy(t => t.Source).ThenBy(t => t.Name).ToList();

        return new TestSummary(tests.Count, passed, failed, skipped, ordered);
    }
}
