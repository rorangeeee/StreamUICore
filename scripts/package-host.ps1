$ErrorActionPreference = 'Stop'
$streamUiRoot = Split-Path -Parent $PSScriptRoot
$streamUiOutput = Join-Path $streamUiRoot '.local\host-package'
$streamUiExecutable = Join-Path $streamUiRoot 'StreamUI Core.exe'
foreach ($streamUiProcess in @(Get-Process -Name 'StreamUI Core' -ErrorAction SilentlyContinue)) {
    if ($streamUiProcess.Path -eq $streamUiExecutable) { throw 'Exit StreamUI Core before rebuilding its EXE.' }
}
& dotnet publish (Join-Path $streamUiRoot 'host\StreamUI.Host.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:PublishReadyToRun=false -p:PublishTrimmed=false -p:NuGetAudit=false --configfile (Join-Path $streamUiRoot 'host\NuGet.Package.Config') -o $streamUiOutput
if ($LASTEXITCODE -ne 0) { throw 'Core packaging failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$coreAssetsPath = Join-Path $streamUiRoot 'host\obj\Release\net10.0-windows\win-x64\web-assets.zip'
$coreAssets = [IO.Compression.ZipFile]::OpenRead($coreAssetsPath)
try {
    if (@($coreAssets.Entries | Where-Object { $_.FullName -match '^(presets|examples|plugins)/' }).Count -ne 0) { throw 'Host assets must not contain presets, scene examples or capability plugins.' }
} finally { $coreAssets.Dispose() }
Copy-Item -LiteralPath (Join-Path $streamUiOutput 'StreamUI.Core.exe') -Destination $streamUiExecutable -Force
Write-Output ('Ready: ' + $streamUiExecutable)
