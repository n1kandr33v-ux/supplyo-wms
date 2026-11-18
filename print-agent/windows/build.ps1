$ErrorActionPreference='Stop'
$supplySource=Join-Path $PSScriptRoot 'SupplyPrintAgent.cs'
$supplyIcon=Join-Path $PSScriptRoot 'supply.ico'
$supplyOutput=Join-Path $PSScriptRoot 'build/supply-print-agent.exe'
$supplyCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(-not(Test-Path -LiteralPath $supplyCompiler)){$supplyCompiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe'}
New-Item -ItemType Directory -Path (Split-Path -Parent $supplyOutput) -Force | Out-Null
& $supplyCompiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$supplyOutput" "/win32icon:$supplyIcon" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll $supplySource
if($LASTEXITCODE -ne 0){throw 'Agent build failed'}
$supplyRepo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Copy-Item -LiteralPath $supplyOutput -Destination (Join-Path $supplyRepo 'public/downloads/supply-print-agent.exe') -Force
Get-FileHash -LiteralPath $supplyOutput -Algorithm SHA256 | Select-Object Algorithm,Hash
