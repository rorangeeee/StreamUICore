$ErrorActionPreference = 'Stop'
$streamUiRoot = Split-Path -Parent $PSScriptRoot
$streamUiExecutable = Join-Path $streamUiRoot 'StreamUI Core.exe'
if (-not (Test-Path -LiteralPath $streamUiExecutable)) { throw 'Run npm run host:package first.' }
$streamUiData = Join-Path $streamUiRoot '.local\core-data'
Start-Process -FilePath $streamUiExecutable -ArgumentList @('--data-dir',('"' + $streamUiData + '"')) -WorkingDirectory $streamUiRoot -WindowStyle Hidden
