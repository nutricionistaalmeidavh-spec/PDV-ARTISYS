param(
  [string]$QaRoot = ".\qa-delivery-artifacts"
)

$ErrorActionPreference = "Stop"

$installer = Get-ChildItem ".\dist" -Filter "ArtiSys-PDV-*-Setup.exe" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw "Instalador nao encontrado em dist/ antes do QA. O gate exige installer -> QA."
}

Write-Host "[PDV QA] Instalador ja gerado: $($installer.FullName)"
Write-Host "[PDV QA] Iniciando gate completo: 26 fluxos de usuario."

New-Item -ItemType Directory -Force -Path ".\artifacts" | Out-Null
$qaReportPath = ".\artifacts\qa-summary.json"
$qaReportTextPath = ".\artifacts\qa-summary.txt"
$qaLogPath = ".\artifacts\qa-user-all.log"
Remove-Item $qaLogPath -Force -ErrorAction SilentlyContinue

function Get-QaLogDiagnostics {
  param([string]$Path)
  $lines = if (Test-Path $Path) { @(Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue) } else { @() }
  $lastFlow = $null
  $lastFailure = $null
  foreach ($line in $lines) {
    $text = [string]$line
    if ($text -match '^=== Fluxo (.+) ===$') { $lastFlow = $Matches[1].Trim() }
    if ($text -match 'FALHA em (.+?):\s*(.+)$') { $lastFailure = "$($Matches[1].Trim()): $($Matches[2].Trim())" }
  }
  [pscustomobject]@{
    lastFlow = if ($lastFlow) { $lastFlow } else { 'qa-user-all' }
    lastFailure = if ($lastFailure) { $lastFailure } else { 'qa:user:all terminou sem QA-SUMMARY.json; consulte qa-user-all.log.' }
  }
}

function Write-FallbackQaSummary {
  param(
    [int]$ExitCode,
    [string]$Reason
  )
  $diag = Get-QaLogDiagnostics -Path $qaLogPath
  $fallbackSummary = [ordered]@{
    schemaVersion = 1
    status = 'FAIL'
    synthetic = $true
    reason = $Reason
    exitCode = $ExitCode
    generatedAt = (Get-Date).ToString('o')
    counts = [ordered]@{ stepsPassed = 0; stepsFailed = 1; flowsPassed = 0; flowsFailed = 1 }
    steps = @([ordered]@{ label = 'qa:user:all'; status = 'FAIL'; exitCode = $ExitCode; error = $diag.lastFailure })
    flows = @([ordered]@{
      flow = $diag.lastFlow
      status = 'FAIL'
      error = $diag.lastFailure
      failedStep = [ordered]@{ name = 'processo QA'; action = 'qa:user:all'; error = $diag.lastFailure }
      evidence = [ordered]@{ log = $qaLogPath }
    })
    artifacts = [ordered]@{ log = $qaLogPath }
  }
  $fallbackSummary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $qaReportPath -Encoding utf8
  @(
    'PDV ArtiSys QA fallback',
    'Status: FAIL',
    "Exit code: $ExitCode",
    "Ultimo fluxo: $($diag.lastFlow)",
    "Erro: $($diag.lastFailure)",
    "Log: $qaLogPath"
  ) | Set-Content -LiteralPath $qaReportTextPath -Encoding utf8
  Write-Host "[PDV QA] Resumo fallback exportado: $qaReportPath"
  return $fallbackSummary
}

$env:ARTISYS_QA_SKIP_INSTALLER = "1"
$qaExitCode = 1
try {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npm run qa:user:all *>&1 | ForEach-Object {
    $line = [string]$_
    Write-Host $line
    Add-Content -LiteralPath $qaLogPath -Value $line -Encoding utf8
  }
  $qaExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
}
finally {
  Remove-Item Env:ARTISYS_QA_SKIP_INSTALLER -ErrorAction SilentlyContinue
}

$summaryFile = $null
if (Test-Path $qaReportPath) {
  $summaryFile = Get-Item -LiteralPath $qaReportPath
} else {
  $summaryFile = Get-ChildItem $QaRoot -Filter "QA-SUMMARY.json" -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

if (-not $summaryFile) {
  $summary = Write-FallbackQaSummary -ExitCode $qaExitCode -Reason 'qa-summary-missing'
  throw "qa:user:all terminou sem QA-SUMMARY.json. Resumo fallback: $qaReportPath; log: $qaLogPath"
}

$canonicalSummary = Get-Item -LiteralPath $qaReportPath -ErrorAction SilentlyContinue
if (-not $canonicalSummary -or $summaryFile.FullName -ne $canonicalSummary.FullName) {
  Copy-Item -LiteralPath $summaryFile.FullName -Destination $qaReportPath -Force
}
$summaryTextFile = Join-Path $summaryFile.Directory.FullName "QA-SUMMARY.txt"
if (Test-Path $summaryTextFile) {
  Copy-Item -LiteralPath $summaryTextFile -Destination $qaReportTextPath -Force
}
Write-Host "[PDV QA] Resumo estruturado exportado: $qaReportPath"
Write-Host "[PDV QA] Log bruto exportado: $qaLogPath"

$summary = Get-Content $qaReportPath -Raw | ConvertFrom-Json
$passed = [int]$summary.counts.flowsPassed
$failed = [int]$summary.counts.flowsFailed

if ($qaExitCode -ne 0) {
  $failedFlows = @($summary.flows | Where-Object { $_.status -eq "FAIL" })
  if ($failedFlows.Count -eq 0) {
    $summary = Write-FallbackQaSummary -ExitCode $qaExitCode -Reason 'qa-exit-without-failed-flow'
    $failedFlows = @($summary.flows)
  }
  Write-Host "[PDV QA] Falhas detectadas: $($failedFlows.Count)"
  foreach ($flow in $failedFlows) {
    $stepName = if ($flow.failedStep -and $flow.failedStep.name) { $flow.failedStep.name } elseif ($flow.failedStep -and $flow.failedStep.action) { $flow.failedStep.action } else { "etapa nao identificada" }
    Write-Host "[PDV QA] FAIL $($flow.flow) | $stepName | $($flow.error)"
  }
  throw "qa:user:all falhou com exit code $qaExitCode. Resumo: $qaReportPath; log: $qaLogPath"
}

if ($summary.status -ne "PASS") {
  throw "QA user-all terminou com status $($summary.status). Resumo: $qaReportPath; log: $qaLogPath"
}
if ($passed -ne 26) {
  throw "Gate QA: esperado 26/26 fluxos; passaram $passed/26. Resumo: $qaReportPath"
}
if ($failed -ne 0) {
  throw "Gate QA: $failed fluxo(s) falharam. Resumo: $qaReportPath"
}

Write-Host "[PDV QA] 26/26 fluxos: PASS"
Write-Host "[PDV QA] Executando smoke no instalador exato produzido pelo pipeline."

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\qa-installed-smoke.ps1" -Installer $installer.FullName -OutputDir $summaryFile.Directory.FullName
$smokeExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($smokeExitCode -ne 0) {
  throw "Installed EXE smoke falhou com exit code $smokeExitCode. QA summary: $qaReportPath"
}

Write-Host "[PDV QA] INSTALLED_EXE_SMOKE=PASS"
Write-Host "[PDV QA] Gate completo aprovado: 26/26 + installed EXE smoke."
