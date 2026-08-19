using System.ComponentModel;
using System.Diagnostics;

namespace PcCheck.App;

public sealed record CommandRequest(
    string FileName,
    IReadOnlyList<string> Arguments,
    TimeSpan Timeout);

public sealed record CommandResult(
    int ExitCode,
    string StandardOutput,
    string StandardError,
    bool TimedOut);

public interface ICommandRunner
{
    Task<CommandResult> RunAsync(CommandRequest request, CancellationToken cancellationToken);
}

public sealed class ProcessCommandRunner : ICommandRunner
{
    public async Task<CommandResult> RunAsync(
        CommandRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = request.FileName,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            },
        };

        foreach (var argument in request.Arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }

        if (!process.Start())
        {
            throw new InvalidOperationException($"Не удалось запустить {request.FileName}.");
        }

        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(request.Timeout);

        try
        {
            await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            return new CommandResult(
                process.ExitCode,
                await outputTask.ConfigureAwait(false),
                await errorTask.ConfigureAwait(false),
                TimedOut: false);
        }
        catch (OperationCanceledException)
        {
            await TerminateAsync(process).ConfigureAwait(false);
            var output = await DrainAsync(outputTask).ConfigureAwait(false);
            var error = await DrainAsync(errorTask).ConfigureAwait(false);

            cancellationToken.ThrowIfCancellationRequested();
            return new CommandResult(
                -1,
                output,
                error,
                TimedOut: true);
        }
    }

    private static async Task TerminateAsync(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch (Exception exception) when (
            exception is InvalidOperationException or Win32Exception or NotSupportedException)
        {
            // The process exited between the checks.
        }

        try
        {
            await process.WaitForExitAsync(CancellationToken.None)
                .WaitAsync(TimeSpan.FromSeconds(2))
                .ConfigureAwait(false);
        }
        catch (Exception exception) when (
            exception is InvalidOperationException or Win32Exception or TimeoutException)
        {
            // Cleanup is bounded; the caller must never hang while Windows reaps a process.
        }
    }

    private static async Task<string> DrainAsync(Task<string> readTask)
    {
        try
        {
            return await readTask.WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(false);
        }
        catch (Exception exception) when (
            exception is IOException or InvalidOperationException or TimeoutException)
        {
            return string.Empty;
        }
    }
}
