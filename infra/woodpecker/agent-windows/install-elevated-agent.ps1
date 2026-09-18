param(
  [string]$UtilidadesSourcePath = 'C:\VICTOR\Artisys\AgroFrota\utilidades',
  [string]$UtilidadesRef = 'feat/artisys-windows-ci-elevated',
  [string]$ElevatedUtilidadesPath = 'C:\ProgramData\ArtiSys\utilidades-elevated',
  [string]$TaskName = 'ArtiSys Woodpecker Agent Elevated'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principalCheck = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador e rode novamente.'
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$launcher = Join-Path $PSScriptRoot 'start-elevated-agent.ps1'
$normalAgentExe = Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-agent\woodpecker-agent.exe'
$normalPluginGit = Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-agent\plugin-git.exe'
if (-not (Test-Path $launcher)) { throw "Launcher elevado ausente: $launcher" }
if (-not (Test-Path $normalAgentExe)) { throw "woodpecker-agent.exe ausente: $normalAgentExe" }
if (-not (Test-Path $normalPluginGit)) { throw "plugin-git.exe ausente: $normalPluginGit" }
if (-not (Test-Path $UtilidadesSourcePath)) { throw "Clone utilidades ausente: $UtilidadesSourcePath" }

Write-Host '[1/5] Preparando copia isolada do utilidades para o Agent elevado...'
& git -C $UtilidadesSourcePath fetch origin $UtilidadesRef
if ($LASTEXITCODE -ne 0) { throw "Falha ao buscar utilidades ref $UtilidadesRef." }

if (-not (Test-Path $ElevatedUtilidadesPath)) {
  $parent = Split-Path -Parent $ElevatedUtilidadesPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  & git -C $UtilidadesSourcePath worktree add --detach $ElevatedUtilidadesPath "origin/$UtilidadesRef"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar worktree utilidades-elevated.' }
} else {
  if (-not (Test-Path (Join-Path $ElevatedUtilidadesPath '.git'))) { throw "$ElevatedUtilidadesPath existe, mas nao e um worktree Git." }
  & git -C $ElevatedUtilidadesPath reset --hard "origin/$UtilidadesRef"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar utilidades-elevated.' }
}

$policyCli = Join-Path $ElevatedUtilidadesPath 'modules\artisys-windows-ci\bin\artisys-windows-ci.mjs'
if (-not (Test-Path $policyCli)) { throw "artisys-windows-ci ausente no worktree elevado: $policyCli" }

Write-Host '[2/5] Preparando runner persistente...'
$stateRoot = 'C:\ProgramData\ArtiSys'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$runner = Join-Path $stateRoot 'run-woodpecker-agent-elevated.ps1'
$log = Join-Path $stateRoot 'woodpecker-agent-elevated.log'
@"
`$ErrorActionPreference='Continue'
& '$launcher' -UtilidadesPath '$ElevatedUtilidadesPath' *>> '$log'
"@ | Set-Content -Path $runner -Encoding UTF8

Write-Host '[3/5] Registrando tarefa elevada separada...'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host '[4/5] Iniciando Agent elevado...'
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host '[5/5] Validando tarefa...'
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Task: $($task.TaskName)"
Write-Host "State: $($task.State)"
Write-Host "RunAs: $currentUser"
Write-Host 'RunLevel: Highest'
Write-Host 'Labels: privilege=elevated, owner=artisys'
Write-Host "Utilidades: $ElevatedUtilidadesPath @ $UtilidadesRef"
Write-Host "Log: $log"
Write-Host "LastTaskResult: $($info.LastTaskResult)"
