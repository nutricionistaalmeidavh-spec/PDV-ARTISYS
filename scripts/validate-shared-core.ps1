param(
  [string]$UtilidadesPath = $env:ARTISYS_UTILIDADES_PATH,
  [string]$LogPath = '.\artifacts\woodpecker-release.log'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($UtilidadesPath)) { throw 'ARTISYS_UTILIDADES_PATH ausente.' }
if (-not (Test-Path $UtilidadesPath)) { throw "utilidades nao encontrado em $UtilidadesPath" }

$logDir = Split-Path -Parent $LogPath
if ($logDir) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
'=== validar-core-compartilhado ===' | Add-Content -Path $LogPath -Encoding utf8

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][scriptblock]$Command
  )
  Write-Host "[Core] $Name"
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $Command 2>&1)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  foreach ($line in $output) {
    $text = [string]$line
    Write-Host $text
    Add-Content -Path $LogPath -Value $text -Encoding utf8
  }
  if ($code -ne 0) { throw "$Name falhou com codigo $code." }
}

Invoke-NativeChecked 'git pull utilidades' { git -C $UtilidadesPath pull --ff-only }
Invoke-NativeChecked 'testes artisys-release' { npm --prefix "$UtilidadesPath\modules\artisys-release" test }
Invoke-NativeChecked 'check artisys-release' { npm --prefix "$UtilidadesPath\modules\artisys-release" run check }
Invoke-NativeChecked 'testes artisys-ci-reporter' { npm --prefix "$UtilidadesPath\modules\artisys-ci-reporter" test }
Invoke-NativeChecked 'check artisys-ci-reporter' { npm --prefix "$UtilidadesPath\modules\artisys-ci-reporter" run check }
Invoke-NativeChecked 'testes artisys-security' { py -3 -m unittest discover -s "$UtilidadesPath\modules\artisys-security\tests" -v }

Write-Host '[Core] Modulos compartilhados aprovados.'
'[Core] Modulos compartilhados aprovados.' | Add-Content -Path $LogPath -Encoding utf8
