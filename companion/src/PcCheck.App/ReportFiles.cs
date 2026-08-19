using System.Text;
using PcCheck.Core;

namespace PcCheck.App;

public static class ReportFiles
{
    public static string GetOutputDirectory(string baseDirectory, DateTimeOffset timestamp)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseDirectory);
        return Path.Combine(
            baseDirectory,
            "Reports",
            $"PC-Check-{timestamp:yyyyMMdd-HHmmss}");
    }

    public static async Task<string> WriteAsync(
        string baseDirectory,
        PcCheckReport report,
        CancellationToken cancellationToken)
    {
        var outputDirectory = GetOutputDirectory(baseDirectory, report.GeneratedAtUtc);
        Directory.CreateDirectory(outputDirectory);

        var jsonPath = Path.Combine(outputDirectory, "report.json");
        var htmlPath = Path.Combine(outputDirectory, "report.html");
        await File.WriteAllTextAsync(
            jsonPath,
            ReportBuilder.BuildJson(report),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            cancellationToken).ConfigureAwait(false);
        await File.WriteAllTextAsync(
            htmlPath,
            ReportBuilder.BuildHtml(report),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            cancellationToken).ConfigureAwait(false);
        return htmlPath;
    }
}
