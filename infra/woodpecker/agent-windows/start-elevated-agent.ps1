param(
  [string]$Server = $(if ($env:WOODPECKER_SERVER) { $env:WOODPECKER_SERVER } else { 'localhost:9000' }),
  [string]$AgentSecret = $(if ($env:WOODPECKER_AGENT_SECRET) { $env:WOODPECKER_AGENT_SECRET } else { $env:ARTISYS_WOODPECKER_AGENT_SECRET }),
  [string]$ServerEnvPath = '',
  [string]$InstallDir = (Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-agent'),
  [string]$UtilidadesPath = 'C:\ProgramData\ArtiSys\utilidades-elevated',
  [string]$WorkDir = (Join-Path $env:USERPROFILE 'ArtiSys\woodpecker-work-elevated'),
  [string]$GitHubReportTokenFile = 'C:\ProgramData\ArtiSys\github-report-token.txt'
)

$ErrorActionPreference = 'Stop'
$agentExe = Join-Path $InstallDir 'woodpecker-agent.exe'
$pluginGit = Join-Path $InstallDir 'plugin-git.exe'
$agentConfig = Join-Path $InstallDir 'agent-elevated.conf'
$policyCli = Join-Path $UtilidadesPath 'modules\artisys-windows-ci\bin\artisys-windows-ci.mjs'

if ([string]::IsNullOrWhiteSpace($AgentSecret)) {
  if ([string]::IsNullOrWhiteSpace($ServerEnvPath)) {
    $woodpeckerRoot = Split-Path -Parent $PSScriptRoot
    $ServerEnvPath = Join-Path $woodpeckerRoot 'server\.env'
  }
  if (Test-Path $ServerEnvPath) {
    $secretLine = Get-Content $ServerEnvPath | Where-Object { $_ -match '^WOODPECKER_AGENT_SECRET=' } | Select-Object -Last 1
    if ($secretLine) { $AgentSecret = ($secretLine -split '=', 2)[1].Trim() }
  }
}

if ([string]::IsNullOrWhiteSpace($AgentSecret)) { throw 'WOODPECKER_AGENT_SECRET ausente.' }
if (-not (Test-Path $agentExe)) { throw "Agent nao instalado em $agentExe." }
if (-not (Test-Path $pluginGit)) { throw "plugin-git nao instalado em $pluginGit." }
if (-not (Test-Path $policyCli)) { throw "artisys-windows-ci nao encontrado em $policyCli." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git nao encontrado no PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado no PATH.' }

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

$env:PATH = "$InstallDir;$env:PATH"
$env:WOODPECKER_SERVER = $Server
$env:WOODPECKER_AGENT_SECRET = $AgentSecret
$env:WOODPECKER_AGENT_CONFIG_FILE = $agentConfig
$env:WOODPECKER_BACKEND = 'local'
$env:WOODPECKER_BACKEND_LOCAL_TEMP_DIR = $WorkDir
$env:WOODPECKER_MAX_WORKFLOWS = '1'
$env:WOODPECKER_AGENT_LABELS = 'repo=nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL,!privilege=elevated,owner=artisys'
$env:WOODPECKER_HOSTNAME = "$env:COMPUTERNAME-artisys-elevated"
$env:ARTISYS_UTILIDADES_PATH = $UtilidadesPath
$env:ARTISYS_AGENT_PRIVILEGE = 'elevated'
$env:ARTISYS_AGENT_OWNER = 'artisys'
$env:ARTISYS_AGENT_PLATFORM = 'windows/amd64'

if (Test-Path $GitHubReportTokenFile) {
  $reportToken = (Get-Content $GitHubReportTokenFile -Raw).Trim()
  if (-not [string]::IsNullOrWhiteSpace($reportToken)) { $env:GITHUB_REPORT_TOKEN = $reportToken }
}

Write-Host '[Woodpecker Elevated] Iniciando Agent administrativo ArtiSys...'
Write-Host "[Woodpecker Elevated] Server: $Server"
Write-Host "[Woodpecker Elevated] Config: $agentConfig"
Write-Host "[Woodpecker Elevated] Workspace: $WorkDir"
Write-Host "[Woodpecker Elevated] utilidades: $UtilidadesPath"
Write-Host '[Woodpecker Elevated] Repo: nutricionistaalmeidavh-spec/OBRANAMAOCOMERCIAL'
Write-Host '[Woodpecker Elevated] Labels: !privilege=elevated, owner=artisys'
Write-Host '[Woodpecker Elevated] Max workflows: 1'

$previousErrorActionPreference = $ErrorActionPreference
$nativeExitCode = $null
try {
  $ErrorActionPreference = 'Continue'
  & $agentExe
  $nativeExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

if ($nativeExitCode -ne 0) { throw "Woodpecker Elevated Agent encerrou com codigo $nativeExitCode." }
