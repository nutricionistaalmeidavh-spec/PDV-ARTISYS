param(
  [string]$InstallDir = 'C:\ArtiSys\woodpecker',
  [string]$UtilidadesPath = 'C:\ArtiSys\utilidades',
  [string]$WoodpeckerVersion = '3.18.1',
  [string]$GitPluginVersion = '2.10.1'
)

$ErrorActionPreference = 'Stop'
$binDir = Join-Path $InstallDir 'bin'
$tempDir = Join-Path $env:TEMP 'artisys-woodpecker-install'
$agentZip = Join-Path $tempDir "woodpecker-agent-$WoodpeckerVersion.zip"

New-Item -ItemType Directory -Force -Path $binDir, $tempDir | Out-Null

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Pre-requisito ausente no PATH: $Name"
  }
}

Require-Command 'git'
Require-Command 'node'
Require-Command 'npm'

$agentUrl = "https://github.com/woodpecker-ci/woodpecker/releases/download/v$WoodpeckerVersion/woodpecker-agent_windows_amd64.zip"
$pluginGitUrl = "https://github.com/woodpecker-ci/plugin-git/releases/download/$GitPluginVersion/windows-amd64_plugin-git.exe"

Write-Host "[Woodpecker] Baixando Agent v$WoodpeckerVersion..."
Invoke-WebRequest -Uri $agentUrl -OutFile $agentZip -UseBasicParsing
Expand-Archive -Path $agentZip -DestinationPath $tempDir -Force

$agentExe = Get-ChildItem -Path $tempDir -Recurse -Filter 'woodpecker-agent*.exe' | Select-Object -First 1
if (-not $agentExe) { throw 'woodpecker-agent.exe nao encontrado no pacote baixado.' }
Copy-Item $agentExe.FullName (Join-Path $binDir 'woodpecker-agent.exe') -Force

Write-Host "[Woodpecker] Instalando plugin-git v$GitPluginVersion para backend local..."
Invoke-WebRequest -Uri $pluginGitUrl -OutFile (Join-Path $binDir 'plugin-git.exe') -UseBasicParsing

if (-not (Test-Path $UtilidadesPath)) {
  Write-Host "[ArtiSys] Clonando utilidades em $UtilidadesPath..."
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $UtilidadesPath) | Out-Null
  & git clone https://github.com/nutricionistaalmeidavh-spec/utilidades.git $UtilidadesPath
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao clonar utilidades. Confirme a autenticacao do Git no Windows.' }
}

$engine = Join-Path $UtilidadesPath 'modules\artisys-release\bin\artisys-release.mjs'
if (-not (Test-Path $engine)) {
  throw "Motor artisys-release nao encontrado em $engine"
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $binDir) {
  [Environment]::SetEnvironmentVariable('Path', (($parts + $binDir) -join ';'), 'User')
}
[Environment]::SetEnvironmentVariable('ARTISYS_UTILIDADES_PATH', $UtilidadesPath, 'User')

$env:Path = "$binDir;$env:Path"
$env:ARTISYS_UTILIDADES_PATH = $UtilidadesPath

& (Join-Path $binDir 'woodpecker-agent.exe') --version
& (Join-Path $binDir 'plugin-git.exe') --help | Select-Object -First 1
node --version
git --version

Write-Host ''
Write-Host '[Woodpecker] Agent Windows preparado.'
Write-Host "[Woodpecker] Binarios: $binDir"
Write-Host "[ArtiSys] Utilidades: $UtilidadesPath"
Write-Host '[Woodpecker] Proximo passo: configurar WOODPECKER_SERVER e WOODPECKER_AGENT_SECRET e executar start-agent.ps1.'
