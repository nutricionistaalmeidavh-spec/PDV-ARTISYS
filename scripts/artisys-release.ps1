param(
  [ValidateSet('quick', 'full', 'release')]
  [string]$Profile = 'full',
  [string]$UtilidadesPath = $env:ARTISYS_UTILIDADES_PATH,
  [switch]$UpdateUtilidades
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot '.artisys\release.json'
$reportPath = Join-Path $repoRoot 'artifacts\artisys-release-report.json'

$candidates = @()
if ($UtilidadesPath) { $candidates += $UtilidadesPath }
$candidates += (Join-Path $env:USERPROFILE 'utilidades')
$candidates += (Join-Path $env:USERPROFILE 'ArtiSys\utilidades')
$candidates += 'C:\ArtiSys\utilidades'
$candidates += (Join-Path (Split-Path -Parent $repoRoot) 'utilidades')
$candidates += (Join-Path (Split-Path -Parent $repoRoot) 'RepoUteis')

$resolvedUtilidades = $null
foreach ($candidate in $candidates | Select-Object -Unique) {
  if (-not $candidate) { continue }
  $engineCandidate = Join-Path $candidate 'modules\artisys-release\bin\artisys-release.mjs'
  if (Test-Path $engineCandidate) {
    $resolvedUtilidades = (Resolve-Path $candidate).Path
    break
  }
}

if (-not $resolvedUtilidades) {
  throw 'Repo utilidades nao encontrado. Defina ARTISYS_UTILIDADES_PATH ou mantenha o clone compartilhado em %USERPROFILE%\utilidades.'
}

$engine = Join-Path $resolvedUtilidades 'modules\artisys-release\bin\artisys-release.mjs'

if ($UpdateUtilidades) {
  Write-Host '[ArtiSys Release] Atualizando utilidades por fast-forward...'
  & git -C $resolvedUtilidades pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar utilidades.' }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js nao encontrado no PATH.'
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportPath) | Out-Null

Write-Host '[ArtiSys Release] Produto: PDV-ARTISYS'
Write-Host "[ArtiSys Release] Perfil: $Profile"
Write-Host "[ArtiSys Release] Engine: $engine"
Write-Host "[ArtiSys Release] Config: $configPath"

Push-Location $repoRoot
try {
  & node $engine $configPath --profile $Profile --report $reportPath
  if ($LASTEXITCODE -ne 0) {
    throw "ArtiSys Release falhou com codigo $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Write-Host "[ArtiSys Release] Concluido. Relatorio: $reportPath"
