$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
foreach ($pluginBuild in @(@{ Id='desktop-audio'; Assembly='DesktopAudio' }, @{ Id='system-media'; Assembly='SystemMedia' })) {
    $pluginRoot = Join-Path $coreRoot ('plugins\' + $pluginBuild.Id)
    & dotnet build (Join-Path $pluginRoot ($pluginBuild.Assembly + '.csproj')) -c Release --configfile (Join-Path $coreRoot 'host\NuGet.Config')
    if ($LASTEXITCODE -ne 0) { throw ('Plugin build failed: ' + $pluginBuild.Id) }
    foreach ($pluginExtension in @('.dll','.deps.json')) {
        Copy-Item -LiteralPath (Join-Path $pluginRoot ('bin\Release\net10.0-windows\' + $pluginBuild.Assembly + $pluginExtension)) -Destination $pluginRoot -Force
    }
}
