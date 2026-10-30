param([string]$HostExecutable = '', [switch]$NoRestore)
$ErrorActionPreference = 'Stop'
$streamUiRoot = Split-Path -Parent $PSScriptRoot
$streamUiHost = if ($HostExecutable) { [IO.Path]::GetFullPath($HostExecutable) } else { Join-Path $streamUiRoot 'StreamUI Core.exe' }
$streamUiReport = Join-Path $streamUiRoot '.local\core-self-test.json'
$streamUiBuildArguments = @('build',(Join-Path $streamUiRoot 'tests\fixtures\uptime\Uptime.csproj'),'-c','Release')
if ($NoRestore) { $streamUiBuildArguments += '--no-restore' }
else { $streamUiBuildArguments += @('--configfile',(Join-Path $streamUiRoot 'host\NuGet.Config')) }
& dotnet @streamUiBuildArguments
if ($LASTEXITCODE -ne 0) { throw 'Test capability plugin build failed.' }
$streamUiSelfTest = Start-Process -FilePath $streamUiHost -ArgumentList @('--self-test','--report',('"' + $streamUiReport + '"')) -WindowStyle Hidden -PassThru -Wait
Get-Content -LiteralPath $streamUiReport
if ($streamUiSelfTest.ExitCode -ne 0) { throw 'Core self-test failed.' }
foreach ($streamUiPort in @(5288,5289)) {
  $probe = [Net.Sockets.TcpClient]::new()
  try { $probe.Connect('127.0.0.1',$streamUiPort); throw "Test port $streamUiPort is in use." }
  catch [Net.Sockets.SocketException] { }
  finally { $probe.Dispose() }
}
$streamUiData = Join-Path $streamUiRoot ('.local\integration-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $streamUiData -Force | Out-Null
& node (Join-Path $streamUiRoot 'tests\prepare-core-fixture.mjs') $streamUiData
if ($LASTEXITCODE -ne 0) { throw 'Test preset preparation failed.' }
$streamUiProcess = Start-Process -FilePath $streamUiHost -ArgumentList @('--headless','--no-open','--obs-port','5288','--config-port','5289','--data-dir',('"' + $streamUiData + '"'),'--plugins-dir',('"' + (Join-Path $streamUiData 'installed-plugins') + '"'),'--presets-dir',('"' + (Join-Path $streamUiData 'presets') + '"')) -WindowStyle Hidden -PassThru
try {
  & node (Join-Path $streamUiRoot 'tests\core-integration.mjs') 'http://127.0.0.1:5288/' 'http://127.0.0.1:5289/' $streamUiData
  if ($LASTEXITCODE -ne 0) { throw 'Core integration test failed.' }
  Invoke-WebRequest -Uri 'http://127.0.0.1:5289/api/shutdown' -Method Post -Headers @{'X-StreamUI-Request'='1'} -UseBasicParsing | Out-Null
  if (-not $streamUiProcess.WaitForExit(10000)) { throw 'Core did not stop.' }
  $streamUiProcess = Start-Process -FilePath $streamUiHost -ArgumentList @('--headless','--no-open','--obs-port','5288','--config-port','5289','--data-dir',('"' + $streamUiData + '"'),'--plugins-dir',('"' + (Join-Path $streamUiData 'installed-plugins') + '"'),'--presets-dir',('"' + (Join-Path $streamUiData 'presets') + '"')) -WindowStyle Hidden -PassThru
  $restored = $null
  for ($attempt=0; $attempt -lt 40; $attempt++) { try { $restored = Invoke-RestMethod -Uri 'http://127.0.0.1:5289/api/state'; break } catch { Start-Sleep -Milliseconds 100 } }
  if ($restored.scenes.Count -ne 3 -or $restored.scene.activeId -ne 'live') { throw 'Core did not restore its slots.' }
  Write-Output 'Restart preserves the prebuilt scenes and broadcaster settings.'
} finally {
  if (-not $streamUiProcess.HasExited) {
    try { Invoke-WebRequest -Uri 'http://127.0.0.1:5289/api/shutdown' -Method Post -Headers @{'X-StreamUI-Request'='1'} -UseBasicParsing | Out-Null } catch { }
    if (-not $streamUiProcess.WaitForExit(5000)) { Stop-Process -Id $streamUiProcess.Id -Force }
  }
}
