using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PcCheck.Core;

public static class ReportBuilder
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string BuildJson(PcCheckReport report)
    {
        ArgumentNullException.ThrowIfNull(report);
        return JsonSerializer.Serialize(report, JsonOptions);
    }

    public static string BuildHtml(PcCheckReport report)
    {
        ArgumentNullException.ThrowIfNull(report);

        var html = new StringBuilder();
        html.AppendLine("<!doctype html>");
        html.AppendLine("<html lang=\"ru\"><head><meta charset=\"utf-8\">");
        html.AppendLine("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
        html.AppendLine("<title>PC Check — локальный отчёт</title>");
        html.AppendLine("<style>body{max-width:920px;margin:40px auto;padding:0 20px;background:#f3f0e7;color:#18221d;font:16px/1.55 Segoe UI,Arial,sans-serif}h1{font-size:42px;line-height:1}.verdict,.section{padding:20px;margin:18px 0;border:1px solid #c7ccc3;background:#fff}.pass{border-left:7px solid #4e7118}.caution{border-left:7px solid #9d6a00}.stop{border-left:7px solid #bd3c32}.unverified{border-left:7px solid #67736c}code{overflow-wrap:anywhere}small{color:#59655d}@media print{body{margin:0}.section{break-inside:avoid}}</style>");
        html.AppendLine("</head><body>");
        html.AppendLine("<h1>PC Check</h1>");
        html.Append("<p><small>Локальный обезличенный отчёт · ")
            .Append(Encode(report.GeneratedAtUtc.ToString("O")))
            .AppendLine("</small></p>");
        html.Append("<section class=\"verdict ")
            .Append(StatusClass(report.Verdict.Status))
            .Append("\"><h2>")
            .Append(StatusLabel(report.Verdict.Status))
            .Append("</h2><p>")
            .Append(Encode(report.Verdict.Explanation))
            .AppendLine("</p></section>");

        foreach (var section in report.Sections)
        {
            html.Append("<section class=\"section ")
                .Append(StatusClass(section.Status))
                .Append("\"><h2>")
                .Append(Encode(section.Title))
                .Append(" — ")
                .Append(StatusLabel(section.Status))
                .Append("</h2><p>")
                .Append(Encode(section.Summary))
                .AppendLine("</p><ul>");
            foreach (var evidence in section.Evidence)
            {
                html.Append("<li><code>")
                    .Append(Encode(evidence))
                    .AppendLine("</code></li>");
            }

            html.AppendLine("</ul></section>");
        }

        html.AppendLine("<p><small>Короткая проверка не гарантирует будущую исправность. Блок питания и физическое состояние подтверждает человек.</small></p>");
        html.AppendLine("</body></html>");
        return html.ToString();
    }

    private static string Encode(string value) => HtmlEncoder.Default.Encode(value);

    private static string StatusClass(CheckStatus status) => status switch
    {
        CheckStatus.Pass => "pass",
        CheckStatus.Caution => "caution",
        CheckStatus.Stop => "stop",
        _ => "unverified",
    };

    private static string StatusLabel(CheckStatus status) => status switch
    {
        CheckStatus.Pass => "ПРОЙДЕНО",
        CheckStatus.Caution => "ТОРГ / ОГОВОРКИ",
        CheckStatus.Stop => "СТОП И ДИАГНОСТИКА",
        _ => "НЕ ПРОВЕРЕНО",
    };
}
