using System.Diagnostics;
using PcCheck.App;
using PcCheck.Core;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("PC Check запускается только на Windows 10/11.");
    return 2;
}

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine("PC Check — предварительная проверка без отправки данных в интернет");
Console.WriteLine("Собираю сведения Windows. Это не нагрузочный тест и не проверка блока питания.");

var claims = ParseClaims(args);
var collector = new WindowsCollector(new ProcessCommandRunner());
var collection = await collector.CollectAsync(CancellationToken.None);
var report = collection.BuildPreliminaryReport(claims);

string reportPath;
try
{
    reportPath = await ReportFiles.WriteAsync(AppContext.BaseDirectory, report, CancellationToken.None);
}
catch (UnauthorizedAccessException)
{
    var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    reportPath = await ReportFiles.WriteAsync(documents, report, CancellationToken.None);
}

Console.WriteLine($"Результат: {report.Verdict.Status}");
Console.WriteLine($"Отчёт сохранён: {reportPath}");

if (!args.Contains("--no-open", StringComparer.OrdinalIgnoreCase))
{
    Process.Start(new ProcessStartInfo(reportPath) { UseShellExecute = true });
}

return 0;

static PurchaseClaims ParseClaims(string[] arguments)
{
    string? cpu = null;
    string? gpu = null;
    int? ram = null;

    for (var index = 0; index < arguments.Length; index++)
    {
        if (index + 1 >= arguments.Length)
        {
            continue;
        }

        switch (arguments[index].ToLowerInvariant())
        {
            case "--cpu":
                cpu = arguments[++index];
                break;
            case "--gpu":
                gpu = arguments[++index];
                break;
            case "--ram" when int.TryParse(arguments[index + 1], out var value) && value > 0:
                ram = value;
                index++;
                break;
        }
    }

    return new PurchaseClaims(cpu, gpu, ram);
}
