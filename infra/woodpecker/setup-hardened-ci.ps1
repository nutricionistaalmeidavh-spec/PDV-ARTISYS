param(
  [string]$Hostname = 'ci.artisys.dev',
  [string]$TunnelName = 'artisys-woodpecker',
  [string]$UtilidadesPath = 'C:\VICTOR\Artisys\AgroFrota\utilidades',
  [int]$HealthEveryMinutes = 10
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$persistent = Join-Path $root 'setup-persistent-ci.ps1'
$watchdog = Join-Path $root 'install-health-task.ps1'
$health = Join-Path $root 'health-check.ps1'

& $persistent -Hostname $Hostname -TunnelName $TunnelName -UtilidadesPath $UtilidadesPath
& $watchdog -UtilidadesPath $UtilidadesPath -EveryMinutes $HealthEveryMinutes
& $health -Repair -UtilidadesPath $UtilidadesPath
if ($LASTEXITCODE -ne 0) { throw 'Setup concluido, mas o health check final falhou.' }

Write-Host ''
Write-Host '=== ArtiSys CI hardened ==='
Write-Host 'Server/Tunnel/Agent persistentes: OK'
Write-Host "Watchdog: a cada $HealthEveryMinutes min"
Write-Host 'Limpeza de workspaces antigos: ativa'
Write-Host 'Rotacao do log do Agent: ativa'
Write-Host 'Self-healing de Docker/Server/Agent/Tunnel: ativo'
