$ErrorActionPreference = 'Stop'
$coreRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $coreRoot 'sdk\native'
& dotnet build (Join-Path $coreRoot 'contracts\StreamUI.Contracts.csproj') -c Release --configfile (Join-Path $coreRoot 'host\NuGet.Config')
if ($LASTEXITCODE -ne 0) { throw 'Core SDK build failed.' }
New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $coreRoot 'contracts\bin\Release\net10.0\StreamUI.Contracts.dll') -Destination $sdkRoot -Force
$sdkName = [Reflection.AssemblyName]::GetAssemblyName((Join-Path $sdkRoot 'StreamUI.Contracts.dll'))
@{sdkVersion=1;assembly=$sdkName.Name;assemblyVersion=$sdkName.Version.ToString();targetFramework='net10.0'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sdkRoot 'sdk.json') -Encoding UTF8
Write-Output ('Native plugin SDK: ' + $sdkRoot)
