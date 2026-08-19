namespace PcCheck.Core;

public enum CheckStatus
{
    Pass,
    Caution,
    Stop,
    Unverified,
}

public sealed record PurchaseClaims(
    string? Cpu,
    string? Gpu,
    int? MemoryGiB);

public sealed record CpuInfo(
    string Name,
    int Cores,
    int LogicalProcessors);

public sealed record GpuInfo(
    string Name,
    long? AdapterRamBytes,
    string? DriverVersion);

public sealed record MemoryInfo(
    long TotalBytes,
    int ModuleCount);

public sealed record StorageDevice(
    string Model,
    long SizeBytes,
    string MediaType,
    string? HealthStatus,
    int? TemperatureCelsius,
    int? WearPercentUsed,
    long? PowerOnHours);

public sealed record DeviceProblem(
    string DeviceClass,
    int ProblemCode);

public sealed record HardwareEvent(
    long RecordId,
    DateTimeOffset TimestampUtc,
    string Provider,
    int EventId);

public sealed record HardwareInventory(
    string OperatingSystem,
    IReadOnlyList<CpuInfo> Cpus,
    IReadOnlyList<GpuInfo> Gpus,
    MemoryInfo Memory,
    IReadOnlyList<StorageDevice> Storage,
    IReadOnlyList<DeviceProblem> ProblemDevices);

public sealed record CheckSection(
    string Id,
    string Title,
    CheckStatus Status,
    string Summary,
    IReadOnlyList<string> Evidence);

public sealed record Verdict(
    CheckStatus Status,
    string Explanation);

public sealed record PcCheckReport(
    string SchemaVersion,
    DateTimeOffset GeneratedAtUtc,
    PurchaseClaims Claims,
    IReadOnlyList<CheckSection> Sections,
    Verdict Verdict);
