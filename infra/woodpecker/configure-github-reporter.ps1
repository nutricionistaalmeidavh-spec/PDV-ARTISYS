param(
  [string]$TokenFile = 'C:\ProgramData\ArtiSys\github-report-token.txt',
  [string]$AgentTaskName = 'ArtiSys Woodpecker Agent'
)

$ErrorActionPreference = 'Stop'

Write-Host 'Fine-grained PAT recomendado para PDV-ARTISYS:'
Write-Host '  Contents: Read and write (GitHub Releases e comentarios em commit)'
Write-Host '  Commit statuses: Read and write'
Write-Host '  Pull requests: Read and write (opcional para comentario no PR)'
Write-Host ''
$secureToken = Read-Host 'Cole o Fine-grained GitHub PAT do ArtiSys CI (entrada oculta)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($token)) { throw 'Token vazio. Nenhuma alteracao realizada.' }

$dir = Split-Path -Parent $TokenFile
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -Path $TokenFile -Value $token.Trim() -Encoding ascii -NoNewline

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $TokenFile /inheritance:r /grant:r "${currentUser}:(R,W)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Falha ao restringir as permissoes do arquivo de token.' }

Write-Host "[ArtiSys CI] Token salvo com ACL restrita em $TokenFile"

$task = Get-ScheduledTask -TaskName $AgentTaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $AgentTaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $AgentTaskName
  Start-Sleep -Seconds 3
  $agent = Get-Process woodpecker-agent -ErrorAction SilentlyContinue
  if (-not $agent) { throw 'Token salvo, mas o Woodpecker Agent nao permaneceu em execucao apos o restart.' }
  Write-Host '[ArtiSys CI] Woodpecker Agent reiniciado e ativo.'
} else {
  Write-Warning "Tarefa '$AgentTaskName' nao encontrada. Reinicie o Agent manualmente para carregar o token."
}
