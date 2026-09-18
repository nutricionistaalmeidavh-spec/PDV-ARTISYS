param(
  [string]$LogPath = '.\artifacts\woodpecker-release.log'
)

$ErrorActionPreference = 'Stop'
$token = $(if ($env:GITHUB_RELEASE_TOKEN) { $env:GITHUB_RELEASE_TOKEN } else { $env:GITHUB_REPORT_TOKEN })
if ([string]::IsNullOrWhiteSpace($token)) { throw 'Token GitHub ausente.' }
if ([string]::IsNullOrWhiteSpace($env:CI_REPO)) { throw 'CI_REPO ausente.' }
if ([string]::IsNullOrWhiteSpace($env:CI_COMMIT_SHA)) { throw 'CI_COMMIT_SHA ausente.' }

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
'=== validar-permissao-release ===' | Add-Content -Path $LogPath -Encoding utf8

$repo = $env:CI_REPO
$short = $env:CI_COMMIT_SHA.Substring(0, [Math]::Min(12, $env:CI_COMMIT_SHA.Length))
$tag = "artisys-release-auth-$short"
$headers = @{
  Accept = 'application/vnd.github+json'
  Authorization = "Bearer $token"
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'artisys-release-auth-smoke'
}
$releaseId = $null

try {
  $body = @{
    tag_name = $tag
    target_commitish = $env:CI_COMMIT_SHA
    name = "ArtiSys release permission smoke $short"
    body = 'Temporary CI permission check. Safe to delete.'
    draft = $true
    prerelease = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -ContentType 'application/json' -Body $body
  $releaseId = $release.id
  if (-not $releaseId) { throw 'GitHub nao retornou o id da release temporaria.' }
  $ok='[PDV Release] Contents/Release WRITE: OK'
  Write-Host $ok
  $ok | Add-Content -Path $LogPath -Encoding utf8
} catch {
  $status = $null
  try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch {}
  $message = if ($status) { "[PDV Release] GitHub Release permission FAILED: HTTP $status" } else { "[PDV Release] GitHub Release permission FAILED: $($_.Exception.Message)" }
  Write-Host $message
  $message | Add-Content -Path $LogPath -Encoding utf8
  throw
} finally {
  if ($releaseId) {
    try { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/$releaseId" -Headers $headers | Out-Null } catch { Write-Warning 'Nao foi possivel apagar a release draft temporaria.' }
  }
  try { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/git/refs/tags/$tag" -Headers $headers | Out-Null } catch {}
}
