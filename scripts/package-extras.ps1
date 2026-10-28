$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $coreRoot 'release'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
foreach ($presetName in @('latenite','minimal')) {
    Compress-Archive -LiteralPath (Join-Path $coreRoot ('presets\' + $presetName)) -DestinationPath (Join-Path $releaseRoot ($presetName + '.preset.zip')) -Force
}
$pluginStage = Join-Path $coreRoot ('.local\external-plugins-' + [guid]::NewGuid().ToString('N'))
foreach ($provider in @(@{ Id='desktop-audio'; Assembly='DesktopAudio' },@{ Id='system-media'; Assembly='SystemMedia' })) {
    $source = Join-Path $coreRoot ('plugins\' + $provider.Id)
    $destination = Join-Path $pluginStage ('plugins\' + $provider.Id)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($name in @('plugin.json',($provider.Assembly + '.dll'),($provider.Assembly + '.deps.json'))) { Copy-Item -LiteralPath (Join-Path $source $name) -Destination $destination }
    if (Test-Path -LiteralPath (Join-Path $source 'settings.html')) { Copy-Item -LiteralPath (Join-Path $source 'settings.html') -Destination $destination }
}
Compress-Archive -LiteralPath (Join-Path $pluginStage 'plugins') -DestinationPath (Join-Path $releaseRoot 'optional-capability-plugins.zip') -Force
Write-Output 'External presets and capability plugins packaged separately from Host.'
