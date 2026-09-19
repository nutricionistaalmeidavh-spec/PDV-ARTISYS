param(
  [string]$UtilidadesPath = $env:ARTISYS_UTILIDADES_PATH,
  [string]$LogPath = '.\artifacts\woodpecker-release.log',
  [int]$QaModuleTestTimeoutMs = 90000
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($UtilidadesPath)) { throw 'ARTISYS_UTILIDADES_PATH ausente.' }
if (-not (Test-Path $UtilidadesPath)) { throw "utilidades nao encontrado em $UtilidadesPath" }
if ($QaModuleTestTimeoutMs -lt 1000) { throw 'QaModuleTestTimeoutMs deve ser >= 1000.' }

$logDir = Split-Path -Parent $LogPath
if ($logDir) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
'=== validar-core-compartilhado ===' | Add-Content -Path $LogPath -Encoding utf8

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][scriptblock]$Command
  )
  Write-Host "[Core] $Name"
  Add-Content -Path $LogPath -Value "[Core] $Name" -Encoding utf8
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | ForEach-Object {
      $text = [string]$_
      Write-Host $text
      Add-Content -Path $LogPath -Value $text -Encoding utf8
    }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
    $watch.Stop()
  }
  $duration = [Math]::Round($watch.Elapsed.TotalSeconds, 2)
  $resultLine = "[Core] $Name -> exit $code em ${duration}s"
  Write-Host $resultLine
  Add-Content -Path $LogPath -Value $resultLine -Encoding utf8
  if ($code -ne 0) { throw "$Name falhou com codigo $code apos ${duration}s." }
}

Invoke-NativeChecked 'git pull utilidades' { git -C $UtilidadesPath pull --ff-only }
Invoke-NativeChecked 'testes artisys-release' { npm --prefix "$UtilidadesPath\modules\artisys-release" test }
Invoke-NativeChecked 'check artisys-release' { npm --prefix "$UtilidadesPath\modules\artisys-release" run check }
Invoke-NativeChecked 'testes artisys-ci-reporter' { npm --prefix "$UtilidadesPath\modules\artisys-ci-reporter" test }
Invoke-NativeChecked 'check artisys-ci-reporter' { npm --prefix "$UtilidadesPath\modules\artisys-ci-reporter" run check }
Invoke-NativeChecked 'deps artisys-qa' { npm --prefix "$UtilidadesPath\modules\artisys-qa" ci --no-audit --no-fund }

$qaPackagePath = Join-Path $UtilidadesPath 'modules\artisys-qa\package.json'
$qaPackage = Get-Content $qaPackagePath -Raw | ConvertFrom-Json
$qaVersionLine = "[Core] artisys-qa version: $($qaPackage.version)"
Write-Host $qaVersionLine
Add-Content -Path $LogPath -Value $qaVersionLine -Encoding utf8

$previousQaTimeout = $env:ARTISYS_QA_TEST_TIMEOUT_MS
try {
  $env:ARTISYS_QA_TEST_TIMEOUT_MS = [string]$QaModuleTestTimeoutMs
  Write-Host "[Core] timeout artisys-qa por arquivo: $QaModuleTestTimeoutMs ms"
  Add-Content -Path $LogPath -Value "[Core] timeout artisys-qa por arquivo: $QaModuleTestTimeoutMs ms" -Encoding utf8
  Invoke-NativeChecked 'testes artisys-qa' { npm --prefix "$UtilidadesPath\modules\artisys-qa" test }
} finally {
  if ([string]::IsNullOrWhiteSpace($previousQaTimeout)) {
    Remove-Item Env:ARTISYS_QA_TEST_TIMEOUT_MS -ErrorAction SilentlyContinue
  } else {
    $env:ARTISYS_QA_TEST_TIMEOUT_MS = $previousQaTimeout
  }
}

Invoke-NativeChecked 'check artisys-qa' { npm --prefix "$UtilidadesPath\modules\artisys-qa" run check }
Invoke-NativeChecked 'testes artisys-security' { py -3 -m unittest discover -s "$UtilidadesPath\modules\artisys-security\tests" -v }

Write-Host '[Core] Modulos compartilhados aprovados.'
'[Core] Modulos compartilhados aprovados.' | Add-Content -Path $LogPath -Encoding utf8
