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

$env:ARTISYS_QA_SKIP_INSTALLER = "1"
$qaExitCode = 1
try {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npm run qa:user:all
  $qaExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
}
finally {
  Remove-Item Env:ARTISYS_QA_SKIP_INSTALLER -ErrorAction SilentlyContinue
}

$summaryFile = Get-ChildItem $QaRoot -Filter "QA-SUMMARY.json" -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $summaryFile) {
  throw "QA-SUMMARY.json nao encontrado apos qa:user:all."
}

Copy-Item -LiteralPath $summaryFile.FullName -Destination $qaReportPath -Force
$summaryTextFile = Join-Path $summaryFile.Directory.FullName "QA-SUMMARY.txt"
if (Test-Path $summaryTextFile) {
  Copy-Item -LiteralPath $summaryTextFile -Destination $qaReportTextPath -Force
}
Write-Host "[PDV QA] Resumo estruturado exportado: $qaReportPath"

$summary = Get-Content $summaryFile.FullName -Raw | ConvertFrom-Json
$passed = [int]$summary.counts.flowsPassed
$failed = [int]$summary.counts.flowsFailed

if ($qaExitCode -ne 0) {
  $failedFlows = @($summary.flows | Where-Object { $_.status -eq "FAIL" })
  if ($failedFlows.Count -gt 0) {
    Write-Host "[PDV QA] Falhas detectadas: $($failedFlows.Count)"
    foreach ($flow in $failedFlows) {
      $stepName = if ($flow.failedStep -and $flow.failedStep.name) { $flow.failedStep.name } elseif ($flow.failedStep -and $flow.failedStep.action) { $flow.failedStep.action } else { "etapa nao identificada" }
      Write-Host "[PDV QA] FAIL $($flow.flow) | $stepName | $($flow.error)"
    }
  }
  throw "qa:user:all falhou com exit code $qaExitCode. Resumo: $qaReportPath"
}

if ($summary.status -ne "PASS") {
  throw "QA user-all terminou com status $($summary.status). Resumo: $qaReportPath"
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
