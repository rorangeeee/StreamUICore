# Read-only Windows media metadata bridge. No playback-control methods are called.
# https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager.requestasync
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-MediaOperation($operation, [type]$resultType) {
    $task = $taskMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait(4000)) { throw 'Media operation timed out.' }
    return $task.GetAwaiter().GetResult()
}
$manager = $null
while ($true) {
    $result = @{ title=''; artist=''; playing=$false; state='idle' }
    try {
        if ($null -eq $manager) { $manager = Wait-MediaOperation ($managerType::RequestAsync()) $managerType }
        $current = $manager.GetCurrentSession()
        $candidates = @()
        if ($null -ne $current) { $candidates += $current }
        foreach ($session in $manager.GetSessions()) { $candidates += $session }
        foreach ($session in $candidates) {
            try {
                $status = [string]$session.GetPlaybackInfo().PlaybackStatus
                if ($status -eq 'Paused') { $result.state = 'paused' }
                if ($status -ne 'Playing') { continue }
                $properties = Wait-MediaOperation ($session.TryGetMediaPropertiesAsync()) $propertiesType
                $title = ([string]$properties.Title).Trim()
                if ([string]::IsNullOrWhiteSpace($title)) { continue }
                $artist = ([string]$properties.Artist).Trim()
                if ([string]::IsNullOrWhiteSpace($artist)) { $artist = ([string]$properties.AlbumArtist).Trim() }
                $result = @{ title=$title; artist=$artist; playing=$true; state='playing' }
                break
            } catch { continue }
        }
    } catch {
        $manager = $null
        $result = @{ title=''; artist=''; playing=$false; state='unavailable' }
    }
    [Console]::WriteLine(($result | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 1000
}
