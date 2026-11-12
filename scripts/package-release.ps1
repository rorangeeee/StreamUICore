$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $coreRoot 'release'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
$coreVersion = (Get-Content -Raw -LiteralPath (Join-Path $coreRoot 'package.json') | ConvertFrom-Json).version
$hostInstructions = Join-Path $releaseRoot 'README-Host.txt'
@'
StreamUICore

Run StreamUI Core.exe. Configuration: http://127.0.0.1:5281/
OBS browser output: http://127.0.0.1:5280/

This Host package contains no presets and no capability plugins.
Install Git for Windows, Node.js 22.18+ and the .NET 10 SDK before building extensions.
In the configuration page, choose Install from Git and paste the preset or plugin repository URL.
Choose an installed preset on the Preview page and enable it when you are ready to switch the output.

Source and instructions: https://github.com/rorangeeee/StreamUICore
'@ | Set-Content -LiteralPath $hostInstructions -Encoding UTF8
$hostArchive = Join-Path $releaseRoot ('StreamUICore-' + $coreVersion + '-win-x64.zip')
Compress-Archive -LiteralPath @((Join-Path $coreRoot 'StreamUI Core.exe'),$hostInstructions,(Join-Path $coreRoot 'sdk')) -DestinationPath $hostArchive -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($hostArchive)
try {
    $names = @($archive.Entries | Where-Object Name | ForEach-Object { $_.FullName.Replace('\','/') })
    $expected = @('StreamUI Core.exe','README-Host.txt','sdk/native/StreamUI.Contracts.dll','sdk/native/sdk.json')
    if (Compare-Object $expected $names) { throw 'Host archive contains unexpected files or is missing the native SDK.' }
} finally { $archive.Dispose() }
((Get-FileHash -LiteralPath $hostArchive -Algorithm SHA256).Hash.ToLower() + '  ' + [IO.Path]::GetFileName($hostArchive)) | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ascii
Write-Output ('Core-only release: ' + $hostArchive)
