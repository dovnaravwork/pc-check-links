using System.Text;
using System.Text.Json;
using PcCheck.Core;

namespace PcCheck.App;

public sealed record CollectionIssue(string Area, string Message);

public sealed record CollectionResult(
    HardwareInventory Inventory,
    IReadOnlyList<HardwareEvent> HardwareEvents,
    IReadOnlyList<CollectionIssue> Issues)
{
    public PcCheckReport BuildPreliminaryReport(PurchaseClaims claims)
    {
        var collection = Issues.Count == 0
            ? new CheckSection(
                "collection",
                "Сбор данных Windows",
                CheckStatus.Pass,
                "Обязательные штатные источники ответили.",
                ["Данные обработаны локально и не отправлялись в интернет."])
            : new CheckSection(
                "collection",
                "Сбор данных Windows",
                CheckStatus.Unverified,
                "Часть сведений Windows недоступна; этот пункт нельзя считать пройденным.",
                Issues.Select(issue => $"{issue.Area}: {issue.Message}").ToArray());
        var inventory = AssessmentRules.AssessInventory(claims, Inventory);
        var storageSucceeded = !Issues.Any(issue =>
            issue.Area.Equals("storage", StringComparison.OrdinalIgnoreCase));
        var storage = AssessmentRules.AssessStorage(Inventory.Storage, storageSucceeded);
        var baseline = AssessmentRules.AssessEvents(
            HardwareEvents,
            DateTimeOffset.UtcNow,
            testFinishedUtc: null);
        var physical = new CheckSection(
            "physical",
            "Осмотр и блок питания",
            CheckStatus.Unverified,
            "Нужны фото внутренностей, наклейки БП и ручной осмотр.",
            ["Программа не может подтвердить модель и состояние блока питания."]);
        var load = new CheckSection(
            "load",
            "Нагрузка и температуры",
            CheckStatus.Unverified,
            "Безопасный нагрузочный тест ещё не выполнен.",
            ["Следующий шаг: открыть инструкцию сайта и провести тест с согласия продавца."]);

        var sections = new[] { collection, inventory, storage, baseline, physical, load };
        return new PcCheckReport(
            "1.0",
            DateTimeOffset.UtcNow,
            claims,
            sections,
            VerdictEngine.Compute(sections));
    }
}

public sealed class WindowsCollector(ICommandRunner commandRunner)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public static string PowerShellSource => """
        $ErrorActionPreference = 'Stop'
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [Console]::OutputEncoding = $utf8
        $OutputEncoding = $utf8
        $issues = [System.Collections.Generic.List[object]]::new()

        function Try-Collect([string] $Area, [scriptblock] $Action, $Fallback) {
            try { & $Action }
            catch {
                $issues.Add([ordered]@{ area = $Area; message = 'Штатный источник Windows не вернул данные.' })
                $Fallback
            }
        }

        $os = Try-Collect 'os' {
            $item = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1
            "$($item.Caption) $($item.Version)"
        } 'Windows (версия не определена)'

        $cpus = @(Try-Collect 'cpu' {
            @(Get-CimInstance Win32_Processor | ForEach-Object {
                [ordered]@{
                    name = [string]$_.Name
                    cores = [int]$_.NumberOfCores
                    logicalProcessors = [int]$_.NumberOfLogicalProcessors
                }
            })
        } @())

        $gpus = @(Try-Collect 'gpu' {
            @(Get-CimInstance Win32_VideoController | ForEach-Object {
                [ordered]@{
                    name = [string]$_.Name
                    adapterRamBytes = $null
                    driverVersion = [string]$_.DriverVersion
                }
            })
        } @())

        $memory = Try-Collect 'memory' {
            $modules = @(Get-CimInstance Win32_PhysicalMemory)
            [ordered]@{
                totalBytes = [long](($modules | Measure-Object Capacity -Sum).Sum)
                moduleCount = [int]$modules.Count
            }
        } ([ordered]@{ totalBytes = 0; moduleCount = 0 })

        $storage = @(Try-Collect 'storage' {
            @(Get-PhysicalDisk | ForEach-Object {
                $disk = $_
                $reliability = $null
                try { $reliability = $disk | Get-StorageReliabilityCounter }
                catch { $issues.Add([ordered]@{ area = 'storage'; message = 'Расширенные сведения накопителя недоступны.' }) }
                [ordered]@{
                    model = [string]$disk.FriendlyName
                    sizeBytes = [long]$disk.Size
                    mediaType = [string]$disk.MediaType
                    healthStatus = [string]$disk.HealthStatus
                    temperatureCelsius = if ($null -ne $reliability.Temperature) { [int]$reliability.Temperature } else { $null }
                    wearPercentUsed = if ($null -ne $reliability.Wear) { [int]$reliability.Wear } else { $null }
                    powerOnHours = if ($null -ne $reliability.PowerOnHours) { [long]$reliability.PowerOnHours } else { $null }
                }
            })
        } @())

        $problems = @(Try-Collect 'devices' {
            @(Get-PnpDevice -PresentOnly | Where-Object Status -ne 'OK' | ForEach-Object {
                [ordered]@{
                    deviceClass = [string]$_.Class
                    problemCode = if ($null -ne $_.Problem) { [int]$_.Problem } else { 1 }
                }
            })
        } @())

        $events = @(Try-Collect 'events' {
            @(Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=(Get-Date).AddDays(-30) } -ErrorAction SilentlyContinue | ForEach-Object {
                [ordered]@{
                    recordId = [long]$_.RecordId
                    timestampUtc = $_.TimeCreated.ToUniversalTime().ToString('o')
                    provider = [string]$_.ProviderName
                    eventId = [int]$_.Id
                }
            })
        } @())

        [ordered]@{
            operatingSystem = $os
            cpus = $cpus
            gpus = $gpus
            memory = $memory
            storage = $storage
            problemDevices = $problems
            hardwareEvents = $events
            collectionIssues = @($issues)
            encodingProbe = 'Проверка'
        } | ConvertTo-Json -Depth 6 -Compress
        """;

    public static CommandRequest CreateRequest()
    {
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(PowerShellSource));
        return new CommandRequest(
            OperatingSystem.IsWindows()
                ? GetPowerShellPath(Environment.SystemDirectory)
                : "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            TimeSpan.FromMinutes(2));
    }

    public static string GetPowerShellPath(string systemDirectory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(systemDirectory);
        return Path.Combine(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
    }

    public async Task<CollectionResult> CollectAsync(CancellationToken cancellationToken)
    {
        CommandResult command;
        try
        {
            command = await commandRunner.RunAsync(CreateRequest(), cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return Failure("PowerShell не запущен.");
        }

        if (command.TimedOut)
        {
            return Failure("Сбор данных остановлен по тайм-ауту.");
        }

        if (command.ExitCode != 0 || string.IsNullOrWhiteSpace(command.StandardOutput))
        {
            return Failure($"Сбор данных завершился с кодом {command.ExitCode}.");
        }

        try
        {
            var payload = JsonSerializer.Deserialize<CollectorPayload>(command.StandardOutput, JsonOptions)
                ?? throw new JsonException("Пустой JSON.");
            if (!string.Equals(payload.EncodingProbe, "Проверка", StringComparison.Ordinal))
            {
                return Failure("Кодировка ответа Windows повреждена.");
            }

            return new CollectionResult(
                new HardwareInventory(
                    payload.OperatingSystem ?? "Windows (версия не определена)",
                    payload.Cpus ?? [],
                    payload.Gpus ?? [],
                    payload.Memory ?? new MemoryInfo(0, 0),
                    payload.Storage ?? [],
                    payload.ProblemDevices ?? []),
                payload.HardwareEvents ?? [],
                payload.CollectionIssues ?? []);
        }
        catch (JsonException)
        {
            return Failure("Windows вернул некорректные данные.");
        }
    }

    private static CollectionResult Failure(string message) =>
        new(
            new HardwareInventory(
                "Windows (не определена)",
                [],
                [],
                new MemoryInfo(0, 0),
                [],
                []),
            [],
            [new CollectionIssue("collector", message)]);

    private sealed record CollectorPayload(
        string? OperatingSystem,
        IReadOnlyList<CpuInfo>? Cpus,
        IReadOnlyList<GpuInfo>? Gpus,
        MemoryInfo? Memory,
        IReadOnlyList<StorageDevice>? Storage,
        IReadOnlyList<DeviceProblem>? ProblemDevices,
        IReadOnlyList<HardwareEvent>? HardwareEvents,
        IReadOnlyList<CollectionIssue>? CollectionIssues,
        string? EncodingProbe);
}
