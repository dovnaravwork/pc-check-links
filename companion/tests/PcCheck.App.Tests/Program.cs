using PcCheck.App;
using PcCheck.Core;

if (args.Contains("--sleep-child", StringComparer.Ordinal))
{
    await Task.Delay(TimeSpan.FromMilliseconds(600));
    var markerIndex = Array.IndexOf(args, "--marker");
    if (markerIndex >= 0 && markerIndex + 1 < args.Length)
    {
        await File.WriteAllTextAsync(args[markerIndex + 1], "child survived");
    }

    return 0;
}

var tests = new (string Name, Action Body)[]
{
    ("PowerShell request is constrained", PowerShellRequestIsConstrained),
    ("PowerShell path is canonical", PowerShellPathIsCanonical),
    ("Collector script has no network or protection bypass", ScriptHasNoNetworkOrProtectionBypass),
    ("Collector parses sanitized inventory", CollectorParsesSanitizedInventory),
    ("Collector rejects broken Cyrillic encoding", CollectorRejectsBrokenCyrillicEncoding),
    ("Collector failure stays unverified", CollectorFailureStaysUnverified),
    ("Embedded collector runs on Windows", EmbeddedCollectorRunsOnWindows),
    ("Report directory name is fixed", ReportDirectoryNameIsFixed),
    ("Process timeout terminates child", ProcessTimeoutTerminatesChild),
    ("Caller cancellation terminates child", CallerCancellationTerminatesChild),
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

static void PowerShellRequestIsConstrained()
{
    var request = WindowsCollector.CreateRequest();

    AssertEx.True(request.FileName.EndsWith("powershell.exe", StringComparison.OrdinalIgnoreCase), "Unexpected PowerShell executable.");
    if (OperatingSystem.IsWindows())
    {
        AssertEx.Contains("System32", request.FileName);
    }
    AssertEx.Contains("-NoProfile", request.Arguments);
    AssertEx.Contains("-NonInteractive", request.Arguments);
    AssertEx.Contains("-EncodedCommand", request.Arguments);
    AssertEx.DoesNotContain("Bypass", request.Arguments);
    AssertEx.DoesNotContain("ExecutionPolicy", request.Arguments);
}

static void PowerShellPathIsCanonical()
{
    var systemDirectory = Path.Combine("C:", "Windows", "System32");
    var expected = Path.Combine(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");

    AssertEx.Equal(expected, WindowsCollector.GetPowerShellPath(systemDirectory));
}

static void ScriptHasNoNetworkOrProtectionBypass()
{
    var source = WindowsCollector.PowerShellSource;
    foreach (var forbidden in new[]
    {
        "Invoke-WebRequest", "Start-BitsTransfer", "Invoke-Expression", "Set-ExecutionPolicy",
        "Add-MpPreference", "Set-MpPreference", "Exception.Message", "http://", "https://",
    })
    {
        AssertEx.DoesNotContain(forbidden, source);
    }
}

static void CollectorParsesSanitizedInventory()
{
    const string json = """
        {
          "operatingSystem":"Windows 11 Pro 10.0.26100",
          "cpus":[{"name":"AMD Ryzen 7 5700X","cores":8,"logicalProcessors":16}],
          "gpus":[{"name":"NVIDIA GeForce RTX 4070","adapterRamBytes":null,"driverVersion":"32.0"}],
          "memory":{"totalBytes":34359738368,"moduleCount":2},
          "storage":[{"model":"Example SSD","sizeBytes":1000204886016,"mediaType":"SSD","healthStatus":"Healthy","temperatureCelsius":41,"wearPercentUsed":8,"powerOnHours":2000}],
          "problemDevices":[{"displayName":"Anton's AirPods","deviceClass":"Bluetooth","problemCode":22}],
          "hardwareEvents":[],
          "collectionIssues":[],
          "encodingProbe":"Проверка",
          "hostName":"must-not-survive",
          "userName":"must-not-survive",
          "serialNumber":"must-not-survive"
        }
        """;
    var collector = new WindowsCollector(new FakeRunner(new CommandResult(0, json, "", false)));

    var result = collector.CollectAsync(CancellationToken.None).GetAwaiter().GetResult();

    AssertEx.Equal("AMD Ryzen 7 5700X", result.Inventory.Cpus.Single().Name);
    AssertEx.Equal(8, result.Inventory.Storage.Single().WearPercentUsed);
    AssertEx.Equal(0, result.Issues.Count);
    var reportJson = ReportBuilder.BuildJson(result.BuildPreliminaryReport(new PurchaseClaims(null, null, null)));
    AssertEx.DoesNotContain("must-not-survive", reportJson);
    AssertEx.DoesNotContain("AirPods", reportJson);
}

static void CollectorRejectsBrokenCyrillicEncoding()
{
    const string json = """
        {
          "operatingSystem":"Windows 11",
          "cpus":[],"gpus":[],"memory":{"totalBytes":0,"moduleCount":0},
          "storage":[],"problemDevices":[],"hardwareEvents":[],"collectionIssues":[],
          "encodingProbe":"��������"
        }
        """;
    var collector = new WindowsCollector(new FakeRunner(new CommandResult(0, json, "", false)));

    var result = collector.CollectAsync(CancellationToken.None).GetAwaiter().GetResult();

    AssertEx.True(result.Issues.Any(issue => issue.Area == "collector"), "Broken encoding must fail closed.");
}

static void CollectorFailureStaysUnverified()
{
    var collector = new WindowsCollector(new FakeRunner(new CommandResult(1, "", "access denied", false)));

    var result = collector.CollectAsync(CancellationToken.None).GetAwaiter().GetResult();
    var report = result.BuildPreliminaryReport(new PurchaseClaims(null, null, null));

    AssertEx.Equal(CheckStatus.Unverified, report.Verdict.Status);
    AssertEx.True(result.Issues.Count > 0, "Expected a recorded collection issue.");
    var collection = report.Sections.Single(section => section.Id == "collection");
    AssertEx.Equal(CheckStatus.Unverified, collection.Status);
    AssertEx.DoesNotContain("access denied", string.Join(" ", collection.Evidence));
}

static void EmbeddedCollectorRunsOnWindows()
{
    if (!OperatingSystem.IsWindows())
    {
        return;
    }

    using var cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(2));
    var result = new WindowsCollector(new ProcessCommandRunner())
        .CollectAsync(cancellation.Token)
        .GetAwaiter()
        .GetResult();

    AssertEx.True(result.Inventory.Cpus.Count > 0, "Windows smoke test did not collect a CPU.");
    AssertEx.True(result.Inventory.Memory.TotalBytes > 0, "Windows smoke test did not collect RAM.");
    AssertEx.DoesNotContain("�", result.Inventory.OperatingSystem);
    var reportJson = ReportBuilder.BuildJson(result.BuildPreliminaryReport(new PurchaseClaims(null, null, null)));
    AssertEx.DoesNotContain("hostname", reportJson);
    AssertEx.DoesNotContain("username", reportJson);
    AssertEx.DoesNotContain("serialnumber", reportJson);
}

static void ReportDirectoryNameIsFixed()
{
    var path = ReportFiles.GetOutputDirectory("C:\\USB", new DateTimeOffset(2026, 8, 19, 12, 34, 56, TimeSpan.Zero));

    AssertEx.Equal(Path.Combine("C:\\USB", "Reports", "PC-Check-20260819-123456"), path);
}

static void ProcessTimeoutTerminatesChild()
{
    var marker = Path.Combine(Path.GetTempPath(), $"pc-check-timeout-{Guid.NewGuid():N}.txt");
    var started = DateTimeOffset.UtcNow;
    var result = new ProcessCommandRunner()
        .RunAsync(SleepingChildRequest(TimeSpan.FromMilliseconds(100), marker), CancellationToken.None)
        .GetAwaiter()
        .GetResult();
    Thread.Sleep(800);

    AssertEx.True(result.TimedOut, "Expected timeout result.");
    AssertEx.True(DateTimeOffset.UtcNow - started < TimeSpan.FromSeconds(5), "Timed-out child was not terminated promptly.");
    AssertEx.True(!File.Exists(marker), "Timed-out child survived and wrote its marker.");
}

static void CallerCancellationTerminatesChild()
{
    var marker = Path.Combine(Path.GetTempPath(), $"pc-check-cancel-{Guid.NewGuid():N}.txt");
    using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
    var started = DateTimeOffset.UtcNow;

    try
    {
        new ProcessCommandRunner()
            .RunAsync(SleepingChildRequest(TimeSpan.FromSeconds(30), marker), cancellation.Token)
            .GetAwaiter()
            .GetResult();
        throw new InvalidOperationException("Expected OperationCanceledException.");
    }
    catch (OperationCanceledException)
    {
        Thread.Sleep(800);
        AssertEx.True(DateTimeOffset.UtcNow - started < TimeSpan.FromSeconds(5), "Cancelled child was not terminated promptly.");
        AssertEx.True(!File.Exists(marker), "Cancelled child survived and wrote its marker.");
    }
}

static CommandRequest SleepingChildRequest(TimeSpan timeout, string marker)
{
    var processPath = Environment.ProcessPath ?? throw new InvalidOperationException("Current process path is unavailable.");
    var assemblyPath = typeof(FakeRunner).Assembly.Location;
    return new CommandRequest(processPath, [assemblyPath, "--sleep-child", "--marker", marker], timeout);
}

internal sealed class FakeRunner(CommandResult result) : ICommandRunner
{
    public Task<CommandResult> RunAsync(CommandRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(result);
}

internal static class AssertEx
{
    public static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException($"Expected '{expected}', got '{actual}'.");
        }
    }

    public static void Contains(string expected, IEnumerable<string> actual)
    {
        if (!actual.Contains(expected, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Expected arguments to contain '{expected}'.");
        }
    }

    public static void Contains(string expected, string actual)
    {
        if (!actual.Contains(expected, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Expected text to contain '{expected}'.");
        }
    }

    public static void DoesNotContain(string unexpected, IEnumerable<string> actual)
    {
        if (actual.Contains(unexpected, StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Expected arguments not to contain '{unexpected}'.");
        }
    }

    public static void DoesNotContain(string unexpected, string actual)
    {
        if (actual.Contains(unexpected, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException($"Expected text not to contain '{unexpected}'.");
        }
    }

    public static void True(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
