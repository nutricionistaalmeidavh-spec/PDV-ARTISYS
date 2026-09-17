param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path $Installer).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$installDir = Join-Path $env:TEMP ("artisys-pdv-qa-installed-" + $PID)
$userDataDir = Join-Path $env:TEMP ("artisys-pdv-qa-userdata-" + $PID)
Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $userDataDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null

$log = [System.Collections.Generic.List[string]]::new()
$log.Add("Installer: $installerPath")
$log.Add("InstallDir: $installDir")

try {
  $install = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
  $log.Add("InstallerExitCode: $($install.ExitCode)")
  if ($install.ExitCode -ne 0) { throw "Instalador retornou código $($install.ExitCode)." }

  $exe = Get-ChildItem -Path $installDir -Recurse -File -Filter '*.exe' |
    Where-Object { $_.Name -notmatch 'uninstall|unins' -and $_.Name -match 'ArtiSys|PDV' } |
    Select-Object -First 1
  if (-not $exe) { throw "Executável instalado não encontrado em $installDir." }
  $log.Add("InstalledExe: $($exe.FullName)")

  $oldQa = $env:ARTISYS_QA
  $oldUserData = $env:ARTISYS_QA_USER_DATA_DIR
  $oldLan = $env:PDV_ENABLE_LAN
  $oldPrint = $env:PDV_AUTO_PRINT
  $env:ARTISYS_QA = '1'
  $env:ARTISYS_QA_USER_DATA_DIR = $userDataDir
  $env:PDV_ENABLE_LAN = 'false'
  $env:PDV_AUTO_PRINT = 'false'
  try {
    $app = Start-Process -FilePath $exe.FullName -PassThru
    Start-Sleep -Seconds 8
    $app.Refresh()
    if ($app.HasExited) { throw "Aplicativo instalado encerrou durante o smoke test. ExitCode=$($app.ExitCode)" }
    $log.Add("ProcessAliveAfter8s: true")
    Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  } finally {
    $env:ARTISYS_QA = $oldQa
    $env:ARTISYS_QA_USER_DATA_DIR = $oldUserData
    $env:PDV_ENABLE_LAN = $oldLan
    $env:PDV_AUTO_PRINT = $oldPrint
  }

  $uninstaller = Get-ChildItem -Path $installDir -Recurse -File -Filter '*.exe' |
    Where-Object { $_.Name -match 'uninstall|unins' } |
    Select-Object -First 1
  if ($uninstaller) {
    $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -PassThru -Wait
    $log.Add("UninstallerExitCode: $($uninstall.ExitCode)")
  }

  $log.Add('RESULT: PASS')
  $log | Set-Content -Path (Join-Path $OutputDir 'installed-exe-smoke.txt') -Encoding UTF8
  Write-Host 'INSTALLED_EXE_SMOKE=PASS'
  exit 0
} catch {
  $log.Add("ERROR: $($_.Exception.Message)")
  $log.Add('RESULT: FAIL')
  $log | Set-Content -Path (Join-Path $OutputDir 'installed-exe-smoke.txt') -Encoding UTF8
  Write-Error $_
  exit 1
} finally {
  Remove-Item $installDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $userDataDir -Recurse -Force -ErrorAction SilentlyContinue
}
