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
Install external preset folders beside the EXE under presets/<id>/.
Install optional capability plugins separately under plugins/<id>/.
Choose a preset on the Preview page and click Apply. A new Host starts empty.

Source and instructions: https://github.com/rorangeeee/StreamUICore
'@ | Set-Content -LiteralPath $hostInstructions -Encoding UTF8
$hostArchive = Join-Path $releaseRoot ('StreamUICore-' + $coreVersion + '-win-x64.zip')
Compress-Archive -LiteralPath @((Join-Path $coreRoot 'StreamUI Core.exe'),$hostInstructions) -DestinationPath $hostArchive -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($hostArchive)
try {
    $names = @($archive.Entries | ForEach-Object FullName)
    if ($names.Count -ne 2 -or $names -notcontains 'StreamUI Core.exe' -or $names -notcontains 'README-Host.txt') { throw 'Host archive contains unexpected files.' }
} finally { $archive.Dispose() }
((Get-FileHash -LiteralPath $hostArchive -Algorithm SHA256).Hash.ToLower() + '  ' + [IO.Path]::GetFileName($hostArchive)) | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ascii
Write-Output ('Core-only release: ' + $hostArchive)
