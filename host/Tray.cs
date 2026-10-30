namespace StreamUI;

internal sealed class Tray : ApplicationContext
{
    private readonly HostRuntime host;
    private readonly NotifyIcon icon;
    private readonly Icon appIcon;
    private readonly Control dispatcher = new();
    private readonly ToolStripMenuItem status = new() { Enabled = false };
    private readonly ToolStripMenuItem start = new("启动服务");
    private readonly ToolStripMenuItem stop = new("停止服务");
    private readonly ToolStripMenuItem restart = new("重启服务");
    private readonly ToolStripMenuItem startup = new("登录 Windows 时启动") { CheckOnClick = true };
    private readonly RegisteredWaitHandle activationWait;
    private bool busy;

    public Tray(HostRuntime host, WaitHandle activation)
    {
        this.host = host;
        dispatcher.CreateControl();
        appIcon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? (Icon)SystemIcons.Application.Clone();
        var menu = new ContextMenuStrip();
        menu.Items.Add(status); menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("打开配置页面", null, (_, _) => _ = Run(host.Start, host.ConfigUrl));
        menu.Items.Add("打开 OBS 画面", null, (_, _) => _ = Run(host.Start, host.ObsUrl));
        menu.Items.Add(new ToolStripSeparator());
        start.Click += (_, _) => _ = Run(host.Start);
        stop.Click += (_, _) => _ = Run(host.Stop);
        restart.Click += (_, _) => _ = Run(host.Restart);
        menu.Items.AddRange([start, stop, restart]);
        menu.Items.Add(new ToolStripSeparator());
        startup.Click += (_, _) =>
        {
            try { WindowsStartup.Set(startup.Checked); }
            catch (Exception error) { startup.Checked = WindowsStartup.Enabled; NotifyError(error); }
        };
        menu.Items.Add(startup);
        menu.Items.Add("退出 StreamUI Core", null, (_, _) => _ = Quit());
        menu.Opening += (_, _) => Update();
        icon = new NotifyIcon { Icon = appIcon, Visible = true, ContextMenuStrip = menu };
        icon.DoubleClick += (_, _) => _ = Run(host.Start, host.ConfigUrl);
        host.Changed += Refresh;
        host.ShutdownRequested += Shutdown;
        activationWait = ThreadPool.RegisterWaitForSingleObject(activation, (_, _) => Dispatch(() => _ = Run(host.Start, host.ConfigUrl)), null, Timeout.Infinite, false);
        Update();
    }

    private void Dispatch(Action action)
    {
        if (dispatcher.IsDisposed) return;
        try { dispatcher.BeginInvoke(action); } catch (InvalidOperationException) { /* The tray is exiting. */ }
    }
    private void Refresh() => Dispatch(Update);
    private void Shutdown() => Dispatch(() => _ = Quit());
    private void Update()
    {
        var text = host.State switch
        {
            ServiceState.Running => "运行中", ServiceState.Starting => "正在启动", ServiceState.Stopping => "正在停止",
            ServiceState.Error => "启动失败", _ => "已停止",
        };
        status.Text = "StreamUI Core · " + text;
        icon.Text = $"StreamUI Core · {text}";
        start.Enabled = !busy && host.State is ServiceState.Stopped or ServiceState.Error;
        stop.Enabled = !busy && host.State == ServiceState.Running;
        restart.Enabled = !busy && host.State == ServiceState.Running;
        startup.Checked = WindowsStartup.Enabled;
    }
    private async Task Run(Func<Task> action, string? open = null)
    {
        if (busy) return;
        busy = true; Update();
        try { await action(); if (open is not null) Program.Open(open); }
        catch (Exception error) { NotifyError(error); }
        finally { busy = false; Update(); }
    }
    private void NotifyError(Exception error) => icon.ShowBalloonTip(5000, "StreamUI Core", error.Message, ToolTipIcon.Error);
    private async Task Quit()
    {
        if (busy) return;
        busy = true; Update();
        try { await host.Stop(); }
        catch (Exception error) { NotifyError(error); }
        finally { ExitThread(); }
    }
    protected override void ExitThreadCore()
    {
        host.Changed -= Refresh; host.ShutdownRequested -= Shutdown;
        activationWait.Unregister(null);
        icon.Visible = false; icon.ContextMenuStrip?.Dispose(); icon.Dispose(); appIcon.Dispose(); dispatcher.Dispose();
        base.ExitThreadCore();
    }
}
