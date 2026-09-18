param(
  [string]$TokenFile = 'C:\ProgramData\ArtiSys\github-report-token.txt',
  [string]$Repository = 'nutricionistaalmeidavh-spec/PDV-ARTISYS',
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $TokenFile)) {
  throw "Token do reporter nao encontrado em $TokenFile"
}

$token = (Get-Content $TokenFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Arquivo de token existe, mas esta vazio.'
}

$sha = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sha)) {
  throw 'Nao foi possivel determinar o commit atual do repositorio.'
}

$headers = @{
  Accept = 'application/vnd.github+json'
  Authorization = "Bearer $token"
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'artisys-woodpecker-reporter-self-test'
}

Write-Host "[Reporter Self-Test] Repo: $Repository"
Write-Host "[Reporter Self-Test] Commit: $sha"

# 1. Confirma que o token enxerga o repositorio.
Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$Repository" -Headers $headers | Out-Null
Write-Host '[Reporter Self-Test] Acesso ao repositorio: OK'

# 2. Confirma Commit statuses: write. O status fica como evidencia auditavel do teste.
$statusBody = @{
  state = 'success'
  context = 'ci/woodpecker/reporter-auth-check'
  description = 'GitHub reporter token validated'
  target_url = 'https://ci.artisys.dev'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repository/statuses/$sha" -Headers $headers -ContentType 'application/json' -Body $statusBody | Out-Null
Write-Host '[Reporter Self-Test] Commit statuses: WRITE OK'

# 3. Confirma criacao de comentario em commit (Contents: read para este endpoint).
$commentBody = @{
  body = "<!-- artisys-reporter-auth-check -->`nArtiSys Woodpecker reporter: token e permissoes basicas validados para ``$($sha.Substring(0,12))``."
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repository/commits/$sha/comments" -Headers $headers -ContentType 'application/json' -Body $commentBody | Out-Null
Write-Host '[Reporter Self-Test] Commit comment: WRITE OK'

Write-Host '[Reporter Self-Test] RESULTADO: OK - token valido para status detalhado + comentario no commit.'
Write-Host '[Reporter Self-Test] Pull requests: write nao e necessario para o fallback principal; o comentario no PR permanece opcional.'
