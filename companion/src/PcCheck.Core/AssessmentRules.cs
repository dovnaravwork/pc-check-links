using System.Globalization;
using System.Text.RegularExpressions;

namespace PcCheck.Core;

public static class AssessmentRules
{
    private const long Gibibyte = 1024L * 1024 * 1024;
    private static readonly HashSet<string> GenericModelWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "AMD", "NVIDIA", "INTEL", "GEFORCE", "RADEON", "CORE", "PROCESSOR",
        "GRAPHICS", "CPU", "GPU", "TM", "R", "GEN", "GENERATION", "SERIES",
    };

    public static CheckSection AssessInventory(PurchaseClaims claims, HardwareInventory inventory)
    {
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(inventory);

        var evidence = new List<string>
        {
            $"ОС: {inventory.OperatingSystem}",
        };

        evidence.AddRange(inventory.Cpus.Select(cpu =>
            $"CPU: {cpu.Name}; {cpu.Cores} ядер / {cpu.LogicalProcessors} потоков"));
        evidence.AddRange(inventory.Gpus.Select(gpu =>
            $"GPU: {gpu.Name}; драйвер {gpu.DriverVersion ?? "не определён"}"));

        var memoryGiB = (int)Math.Round(
            inventory.Memory.TotalBytes / (double)Gibibyte,
            MidpointRounding.AwayFromZero);
        evidence.Add($"RAM: {memoryGiB} ГиБ; модулей: {inventory.Memory.ModuleCount}");

        if (inventory.Cpus.Count == 0 || inventory.Gpus.Count == 0 || inventory.Memory.TotalBytes <= 0)
        {
            return Section(
                CheckStatus.Unverified,
                "Не удалось получить обязательные сведения о CPU, GPU или RAM.",
                evidence);
        }

        if (!MatchesClaim(claims.Cpu, inventory.Cpus.Select(cpu => cpu.Name)))
        {
            return Section(CheckStatus.Stop, "CPU не совпадает с объявлением.", evidence);
        }

        if (!MatchesClaim(claims.Gpu, inventory.Gpus.Select(gpu => gpu.Name)))
        {
            return Section(CheckStatus.Stop, "GPU не совпадает с объявлением.", evidence);
        }

        if (claims.MemoryGiB is int claimedMemory && claimedMemory != memoryGiB)
        {
            return Section(CheckStatus.Stop, "Объём RAM не совпадает с объявлением.", evidence);
        }

        if (inventory.ProblemDevices.Count > 0)
        {
            evidence.AddRange(inventory.ProblemDevices.Select(problem =>
                $"Проблемное устройство: класс {problem.DeviceClass}; код {problem.ProblemCode}"));

            if (inventory.ProblemDevices.Any(problem => problem.ProblemCode != 22))
            {
                return Section(
                    CheckStatus.Stop,
                    "Windows сообщает о проблемном устройстве. Выясни причину и повтори проверку.",
                    evidence);
            }

            return Section(
                CheckStatus.Caution,
                "В Windows есть отключённые устройства (код 22). Проверь, отключены ли они намеренно.",
                evidence);
        }

        return Section(CheckStatus.Pass, "Состав подтверждён собранными данными.", evidence);
    }

    public static CheckSection AssessStorage(
        IReadOnlyList<StorageDevice> drives,
        bool collectionSucceeded)
    {
        ArgumentNullException.ThrowIfNull(drives);

        var evidence = drives.Select(DescribeStorage).ToArray();
        if (!collectionSucceeded || drives.Count == 0)
        {
            return StorageSection(
                CheckStatus.Unverified,
                "Накопители или их состояние не удалось получить.",
                evidence);
        }

        if (drives.Any(IsUnhealthy))
        {
            return StorageSection(
                CheckStatus.Stop,
                "Найден накопитель с плохим состоянием. Останови сделку или исключи диск из цены.",
                evidence);
        }

        if (drives.Any(IsUnknown))
        {
            return StorageSection(
                CheckStatus.Unverified,
                "Состояние хотя бы одного накопителя не подтверждено.",
                evidence);
        }

        if (drives.Any(IsCaution))
        {
            return StorageSection(
                CheckStatus.Caution,
                "Есть накопитель, для которого нужно заложить стоимость замены.",
                evidence);
        }

        return StorageSection(
            CheckStatus.Pass,
            "Штатный источник не сообщил о проблемах накопителей.",
            evidence);
    }

    public static CheckSection AssessEvents(
        IReadOnlyList<HardwareEvent> events,
        DateTimeOffset testStartedUtc,
        DateTimeOffset? testFinishedUtc)
    {
        ArgumentNullException.ThrowIfNull(events);

        var historicCount = events.Count(item => item.TimestampUtc < testStartedUtc);
        var evidence = new List<string>
        {
            $"Исторических событий до старта: {historicCount}",
        };

        if (testFinishedUtc is null)
        {
            return new CheckSection(
                "events",
                "Нагрузка и WHEA",
                CheckStatus.Unverified,
                "Нагрузка ещё не завершена; исторические события сохранены только как baseline.",
                evidence);
        }

        var newWhea = events
            .Where(item =>
                item.Provider.Equals("Microsoft-Windows-WHEA-Logger", StringComparison.OrdinalIgnoreCase) &&
                item.TimestampUtc >= testStartedUtc &&
                item.TimestampUtc <= testFinishedUtc.Value)
            .OrderBy(item => item.TimestampUtc)
            .ToArray();

        evidence.AddRange(newWhea.Select(item =>
            $"Новый WHEA: Event ID {item.EventId}; Record ID {item.RecordId}; {item.TimestampUtc:O}"));

        return newWhea.Length > 0
            ? new CheckSection(
                "events",
                "Нагрузка и WHEA",
                CheckStatus.Stop,
                "Во время теста появился WHEA: останови нагрузку, выясни причину и повтори проверку.",
                evidence)
            : new CheckSection(
                "events",
                "Нагрузка и WHEA",
                CheckStatus.Pass,
                "В зафиксированном интервале новые WHEA не обнаружены.",
                evidence);
    }

    private static CheckSection Section(
        CheckStatus status,
        string summary,
        IReadOnlyList<string> evidence) =>
        new("inventory", "Состав компьютера", status, summary, evidence);

    private static CheckSection StorageSection(
        CheckStatus status,
        string summary,
        IReadOnlyList<string> evidence) =>
        new("storage", "Накопители", status, summary, evidence);

    private static bool MatchesClaim(string? claim, IEnumerable<string> actualValues)
    {
        if (string.IsNullOrWhiteSpace(claim))
        {
            return true;
        }

        var claimSignature = ModelSignature(claim);
        return claimSignature.Length > 0 && actualValues.Any(actual =>
        {
            var actualSignature = ModelSignature(actual);
            return actualSignature.Length >= claimSignature.Length &&
                actualSignature[^claimSignature.Length..]
                    .SequenceEqual(claimSignature, StringComparer.OrdinalIgnoreCase);
        });
    }

    private static string[] ModelSignature(string value)
    {
        var withoutClock = Regex.Replace(value, "@.*$", "", RegexOptions.CultureInvariant);
        var withoutCoreCount = Regex.Replace(
            withoutClock,
            @"\b\d+\s*[- ]?Core\s+Processor\b",
            "",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return Regex.Matches(withoutCoreCount.Normalize(), @"[\p{L}\p{N}]+")
            .Select(match => match.Value.ToUpperInvariant())
            .Where(token => !GenericModelWords.Contains(token))
            .ToArray();
    }

    private static bool IsUnhealthy(StorageDevice drive) =>
        EqualsStatus(drive.HealthStatus, "Unhealthy") ||
        EqualsStatus(drive.HealthStatus, "Bad");

    private static bool IsUnknown(StorageDevice drive) =>
        string.IsNullOrWhiteSpace(drive.HealthStatus) ||
        EqualsStatus(drive.HealthStatus, "Unknown");

    private static bool IsCaution(StorageDevice drive) =>
        EqualsStatus(drive.HealthStatus, "Warning") ||
        EqualsStatus(drive.HealthStatus, "Caution") ||
        drive.WearPercentUsed is >= 90;

    private static bool EqualsStatus(string? actual, string expected) =>
        actual?.Equals(expected, StringComparison.OrdinalIgnoreCase) == true;

    private static string DescribeStorage(StorageDevice drive)
    {
        var health = drive.HealthStatus ?? "Unknown";
        var temperature = drive.TemperatureCelsius is int value ? $"{value} °C" : "нет данных";
        var wear = drive.WearPercentUsed is int wearValue ? $"{wearValue}%" : "нет данных";
        var hours = drive.PowerOnHours is long hoursValue ? hoursValue.ToString(CultureInfo.InvariantCulture) : "нет данных";
        return $"{drive.Model}; {drive.MediaType}; {drive.SizeBytes} байт; Health={health}; Temp={temperature}; Wear={wear}; Hours={hours}";
    }
}
