param(
  [string]$UtilidadesPath = 'C:\VICTOR\Artisys\AgroFrota\utilidades',
  [int]$EveryMinutes = 10
)

$ErrorActionPreference = 'Stop'
if ($EveryMinutes -lt 5) { throw 'EveryMinutes deve ser >= 5.' }
$healthScript = Join-Path $PSScriptRoot 'health-check.ps1'
if (-not (Test-Path $healthScript)) { throw "health-check.ps1 nao encontrado em $healthScript" }

$stateRoot = 'C:\ProgramData\ArtiSys'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$runner = Join-Path $stateRoot 'run-woodpecker-health.ps1'
$watchLog = Join-Path $stateRoot 'woodpecker-watchdog.log'
@"
`$ErrorActionPreference='Continue'
& '$healthScript' -Repair -UtilidadesPath '$UtilidadesPath' *>> '$watchLog'
exit 0
"@ | Set-Content $runner -Encoding UTF8

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) -RepetitionDuration ([TimeSpan]::FromDays(3650))
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'ArtiSys Woodpecker Health' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'ArtiSys Woodpecker Health'
Write-Host "[Woodpecker Health] Watchdog instalado: a cada $EveryMinutes min."
Write-Host "[Woodpecker Health] Log: $watchLog"
