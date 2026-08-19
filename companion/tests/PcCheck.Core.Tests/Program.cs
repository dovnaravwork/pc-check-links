using System.Text.Json;
using PcCheck.Core;

var tests = new (string Name, Action Body)[]
{
    ("Verdict priority: pass", () => AssertEx.Equal(CheckStatus.Pass, Verdict(CheckStatus.Pass, CheckStatus.Pass).Status)),
    ("Verdict priority: caution", () => AssertEx.Equal(CheckStatus.Caution, Verdict(CheckStatus.Pass, CheckStatus.Caution).Status)),
    ("Verdict priority: unverified", () => AssertEx.Equal(CheckStatus.Unverified, Verdict(CheckStatus.Caution, CheckStatus.Unverified).Status)),
    ("Verdict priority: stop", () => AssertEx.Equal(CheckStatus.Stop, Verdict(CheckStatus.Stop, CheckStatus.Unverified).Status)),
    ("Empty verdict is unverified", EmptyVerdictIsUnverified),
    ("Pass is not a guarantee", PassIsNotGuarantee),
    ("CPU mismatch stops purchase", CpuMismatchStopsPurchase),
    ("GPU suffix mismatch stops purchase", GpuSuffixMismatchStopsPurchase),
    ("WMI CPU decorations still match", WmiCpuDecorationsStillMatch),
    ("Disabled device is caution, not stop", DisabledDeviceIsCaution),
    ("Active device problem still stops", ActiveDeviceProblemStillStops),
    ("Unhealthy storage stops purchase", UnhealthyStorageStopsPurchase),
    ("Unknown storage is unverified", UnknownStorageIsUnverified),
    ("Low SSD wear is not a caution", LowSsdWearIsNotCaution),
    ("High SSD wear is a caution", HighSsdWearIsCaution),
    ("Storage evidence includes wear and hours", StorageEvidenceIncludesWearAndHours),
    ("Historic WHEA is context", HistoricWheaIsContext),
    ("New WHEA stops and requires retest", NewWheaStopsAndRequiresRetest),
    ("HTML escapes evidence and stays offline", HtmlEscapesEvidenceAndStaysOffline),
    ("JSON excludes sensitive identity", JsonExcludesSensitiveIdentity),
};

var failures = 0;
foreach (var test in tests)
{
    try
    {
        test.Body();
        Console.WriteLine($"PASS {test.Name}");
    }
    catch (Exception exception)
    {
        failures++;
        Console.Error.WriteLine($"FAIL {test.Name}: {exception.Message}");
    }
}

Console.WriteLine($"{tests.Length - failures}/{tests.Length} tests passed");
return failures == 0 ? 0 : 1;

static Verdict Verdict(params CheckStatus[] statuses) =>
    VerdictEngine.Compute(statuses.Select((status, index) => Section(index.ToString(), status)));

static CheckSection Section(string id, CheckStatus status) =>
    new(id, id, status, "summary", ["evidence"]);

static void EmptyVerdictIsUnverified()
{
    var result = VerdictEngine.Compute([]);
    AssertEx.Equal(CheckStatus.Unverified, result.Status);
    AssertEx.Contains("обязательные", result.Explanation);
}

static void PassIsNotGuarantee()
{
    var result = Verdict(CheckStatus.Pass);
    AssertEx.Contains("короткой проверке", result.Explanation);
    AssertEx.DoesNotContain("гарант", result.Explanation);
}

static void CpuMismatchStopsPurchase()
{
    var claims = new PurchaseClaims("Ryzen 7 5700X", "RTX 3070", 32);
    var inventory = new HardwareInventory(
        "Windows 11",
        [new CpuInfo("Ryzen 5 5600", 6, 12)],
        [new GpuInfo("RTX 3070", 8_000_000_000, "1.0")],
        new MemoryInfo(32L * 1024 * 1024 * 1024, 2),
        [],
        []);

    var section = AssessmentRules.AssessInventory(claims, inventory);

    AssertEx.Equal(CheckStatus.Stop, section.Status);
    AssertEx.Contains("CPU", section.Summary);
}

static void GpuSuffixMismatchStopsPurchase()
{
    var claims = new PurchaseClaims(null, "RTX 4070", 32);
    var inventory = new HardwareInventory(
        "Windows 11",
        [new CpuInfo("AMD Ryzen 7 5700X", 8, 16)],
        [new GpuInfo("NVIDIA GeForce RTX 4070 Ti", null, "1.0")],
        new MemoryInfo(32L * 1024 * 1024 * 1024, 2),
        [],
        []);

    var section = AssessmentRules.AssessInventory(claims, inventory);

    AssertEx.Equal(CheckStatus.Stop, section.Status);
    AssertEx.Contains("GPU", section.Summary);
}

static void WmiCpuDecorationsStillMatch()
{
    var claims = new PurchaseClaims("Intel Core i7-12700K", "RTX 4070", 32);
    var inventory = new HardwareInventory(
        "Windows 11",
        [new CpuInfo("12th Gen Intel(R) Core(TM) i7-12700K CPU @ 3.60GHz", 12, 20)],
        [new GpuInfo("NVIDIA GeForce RTX 4070", null, "1.0")],
        new MemoryInfo(32L * 1024 * 1024 * 1024, 2),
        [],
        []);

    var section = AssessmentRules.AssessInventory(claims, inventory);

    AssertEx.Equal(CheckStatus.Pass, section.Status);
}

static void DisabledDeviceIsCaution()
{
    var inventory = HealthyInventory([new DeviceProblem("MEDIA", 22)]);

    var section = AssessmentRules.AssessInventory(new PurchaseClaims(null, null, null), inventory);

    AssertEx.Equal(CheckStatus.Caution, section.Status);
    AssertEx.Contains("отключ", section.Summary);
}

static void ActiveDeviceProblemStillStops()
{
    var inventory = HealthyInventory(
        [new DeviceProblem("MEDIA", 22), new DeviceProblem("Display", 28)]);

    var section = AssessmentRules.AssessInventory(new PurchaseClaims(null, null, null), inventory);

    AssertEx.Equal(CheckStatus.Stop, section.Status);
}

static HardwareInventory HealthyInventory(IReadOnlyList<DeviceProblem> problems) =>
    new(
        "Windows 11",
        [new CpuInfo("AMD Ryzen 5 7500F", 6, 12)],
        [new GpuInfo("NVIDIA GeForce RTX 4070", null, "1.0")],
        new MemoryInfo(32L * 1024 * 1024 * 1024, 2),
        [],
        problems);

static void UnhealthyStorageStopsPurchase()
{
    var drives = new[]
    {
        new StorageDevice("Example SSD", 1_000_000_000_000, "SSD", "Unhealthy", 45, 8, 12_000),
    };

    var section = AssessmentRules.AssessStorage(drives, collectionSucceeded: true);
    AssertEx.Equal(CheckStatus.Stop, section.Status);
}

static void UnknownStorageIsUnverified()
{
    var drives = new[]
    {
        new StorageDevice("USB bridge", 500_000_000_000, "Unknown", null, null, null, null),
    };

    var section = AssessmentRules.AssessStorage(drives, collectionSucceeded: true);
    AssertEx.Equal(CheckStatus.Unverified, section.Status);
}

static void LowSsdWearIsNotCaution()
{
    var drives = new[]
    {
        new StorageDevice("Healthy SSD", 500_000_000_000, "SSD", "Healthy", 38, 8, 2_000),
    };

    var section = AssessmentRules.AssessStorage(drives, collectionSucceeded: true);
    AssertEx.Equal(CheckStatus.Pass, section.Status);
}

static void HighSsdWearIsCaution()
{
    var drives = new[]
    {
        new StorageDevice("Worn SSD", 500_000_000_000, "SSD", "Healthy", 38, 95, 20_000),
    };

    var section = AssessmentRules.AssessStorage(drives, collectionSucceeded: true);
    AssertEx.Equal(CheckStatus.Caution, section.Status);
}

static void StorageEvidenceIncludesWearAndHours()
{
    var drives = new[]
    {
        new StorageDevice("Example SSD", 500_000_000_000, "SSD", "Healthy", 38, 8, 2_000),
    };

    var section = AssessmentRules.AssessStorage(drives, collectionSucceeded: true);
    var evidence = string.Join(" ", section.Evidence);

    AssertEx.Contains("Wear=8%", evidence);
    AssertEx.Contains("Hours=2000", evidence);
}

static void HistoricWheaIsContext()
{
    var testStartedUtc = new DateTimeOffset(2026, 8, 19, 10, 0, 0, TimeSpan.Zero);
    var events = new[]
    {
        new HardwareEvent(100, testStartedUtc.AddDays(-2), "Microsoft-Windows-WHEA-Logger", 17),
    };

    var section = AssessmentRules.AssessEvents(events, testStartedUtc, testFinishedUtc: null);

    AssertEx.Equal(CheckStatus.Unverified, section.Status);
    AssertEx.Contains("нагрузк", section.Summary);
}

static void NewWheaStopsAndRequiresRetest()
{
    var started = new DateTimeOffset(2026, 8, 19, 10, 0, 0, TimeSpan.Zero);
    var finished = started.AddMinutes(10);
    var events = new[]
    {
        new HardwareEvent(101, started.AddMinutes(3), "Microsoft-Windows-WHEA-Logger", 18),
    };

    var section = AssessmentRules.AssessEvents(events, started, finished);

    AssertEx.Equal(CheckStatus.Stop, section.Status);
    AssertEx.Contains("повтор", section.Summary);
}

static void HtmlEscapesEvidenceAndStaysOffline()
{
    var html = ReportBuilder.BuildHtml(SampleReport("<script>alert('x')</script>"));

    AssertEx.DoesNotContain("<script>alert", html);
    AssertEx.Contains("&lt;script&gt;", html);
    AssertEx.DoesNotContain("http://", html);
    AssertEx.DoesNotContain("https://", html);
}

static void JsonExcludesSensitiveIdentity()
{
    var json = ReportBuilder.BuildJson(SampleReport("safe"));
    using var document = JsonDocument.Parse(json);

    AssertEx.DoesNotContain("hostname", json);
    AssertEx.DoesNotContain("username", json);
    AssertEx.DoesNotContain("serialnumber", json);
    AssertEx.Equal("1.0", document.RootElement.GetProperty("schemaVersion").GetString());
}

static PcCheckReport SampleReport(string evidence) =>
    new(
        "1.0",
        new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero),
        new PurchaseClaims(null, null, null),
        [new CheckSection("inventory", "Состав", CheckStatus.Pass, "Совпало", [evidence])],
        new Verdict(CheckStatus.Pass, "В этой короткой проверке проблем не обнаружено."));

internal static class AssertEx
{
    public static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException($"Expected '{expected}', got '{actual}'.");
        }
    }

    public static void Contains(string expected, string actual)
    {
        if (!actual.Contains(expected, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Expected text to contain '{expected}'.");
        }
    }

    public static void DoesNotContain(string unexpected, string actual)
    {
        if (actual.Contains(unexpected, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Expected text not to contain '{unexpected}'.");
        }
    }
}
