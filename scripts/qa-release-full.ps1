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

$env:ARTISYS_QA_SKIP_INSTALLER = "1"
try {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npm run qa:user:all
  $qaExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($qaExitCode -ne 0) {
    throw "qa:user:all falhou com exit code $qaExitCode."
  }
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

$summary = Get-Content $summaryFile.FullName -Raw | ConvertFrom-Json
$passed = [int]$summary.counts.flowsPassed
$failed = [int]$summary.counts.flowsFailed

if ($summary.status -ne "PASS") {
  throw "QA user-all terminou com status $($summary.status)."
}
if ($passed -ne 26) {
  throw "Gate QA: esperado 26/26 fluxos; passaram $passed/26."
}
if ($failed -ne 0) {
  throw "Gate QA: $failed fluxo(s) falharam."
}

Write-Host "[PDV QA] 26/26 fluxos: PASS"
Write-Host "[PDV QA] Executando smoke no instalador exato produzido pelo pipeline."

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\qa-installed-smoke.ps1" -Installer $installer.FullName -OutputDir $summaryFile.Directory.FullName
$smokeExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference
if ($smokeExitCode -ne 0) {
  throw "Installed EXE smoke falhou com exit code $smokeExitCode."
}

Write-Host "[PDV QA] INSTALLED_EXE_SMOKE=PASS"
Write-Host "[PDV QA] Gate completo aprovado: 26/26 + installed EXE smoke."
