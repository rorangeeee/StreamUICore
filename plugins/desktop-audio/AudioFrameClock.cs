using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace StreamUI.DesktopAudio;

/// <summary>Frame deadlines use a high-resolution one-shot timer, independent of Windows' coarse timeout tick.</summary>
internal sealed class AudioFrameClock : IDisposable
{
    private sealed class TimerWaitHandle : WaitHandle { public TimerWaitHandle(SafeWaitHandle handle) => SafeWaitHandle = handle; }
    private readonly TimerWaitHandle timer;
    private readonly WaitHandle[] handles;
    private readonly CancellationToken cancellation;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly double interval;
    private double deadline;

    public AudioFrameClock(int framesPerSecond, CancellationToken cancellation)
    {
        this.cancellation = cancellation;
        interval = (double)Stopwatch.Frequency / framesPerSecond;
        var handle = CreateWaitableTimerExW(IntPtr.Zero, null, 2, 0x1F0003); // CREATE_WAITABLE_TIMER_HIGH_RESOLUTION (Windows 10 1803+)
        if (handle.IsInvalid) { handle.Dispose(); handle = CreateWaitableTimerExW(IntPtr.Zero, null, 0, 0x1F0003); }
        if (handle.IsInvalid) { var error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
        timer = new TimerWaitHandle(handle);
        handles = [cancellation.WaitHandle, timer];
    }
    public bool WaitNext()
    {
        if (cancellation.IsCancellationRequested) return false;
        deadline += interval;
        var now = clock.ElapsedTicks;
        if (now - deadline >= interval) deadline = now; // Skip missed frames instead of queuing a burst.
        var remaining = deadline - now;
        if (remaining <= 0) return true;
        var dueTime = -Math.Max(1, (long)Math.Ceiling(remaining * TimeSpan.TicksPerSecond / Stopwatch.Frequency));
        if (!SetWaitableTimer(timer.SafeWaitHandle, ref dueTime, 0, IntPtr.Zero, IntPtr.Zero, false)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return WaitHandle.WaitAny(handles) == 1 && !cancellation.IsCancellationRequested;
    }
    public void Dispose() => timer.Dispose();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeWaitHandle CreateWaitableTimerExW(IntPtr attributes, string? name, uint flags, uint access);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWaitableTimer(SafeWaitHandle timer, ref long dueTime, int period, IntPtr callback, IntPtr argument, [MarshalAs(UnmanagedType.Bool)] bool resume);
}
