# Manual Windows x64 lab build of LGPL ACBrLib (no ACBr Pro/paid API).
# DOES NOT publish a commercial installer, activate fiscal production or contact SEFAZ.
param([string]$Revision = '48608')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT'){throw 'Executor fiscal nativo exige Windows x64'}
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $root
try {
  $required=@('svn','git','python','node','npm','npx')
  foreach($name in $required){if(-not (Get-Command $name -ErrorAction SilentlyContinue)){throw "Ferramenta OSS ausente no computador de build: $name"}}
  function Assert-Ok([string]$label) {
    if($LASTEXITCODE -ne 0){throw "$label falhou ($LASTEXITCODE)"}
  }
  npm ci --no-audit --no-fund
  Assert-Ok 'npm ci'
  python -m pip install 'pyinstaller==6.16.0'
  Assert-Ok 'PyInstaller'
  & (Join-Path $PSScriptRoot 'build-acbr-native.ps1') -Revision $Revision
  Assert-Ok 'Compilação nativa ACBr'
  python -m PyInstaller --noconfirm --clean --onefile --console --name acbrlib-worker --distpath build/fiscal-worker --workpath build/pyinstaller-tmp --specpath build/pyinstaller-src server/acbrlib/acbrlib-worker.py
  Assert-Ok 'Worker ACBrLib'
  node scripts/fiscal/stage-fiscal-bundle-reference.mjs
  Assert-Ok 'Staging ACBr'
  node scripts/fiscal/create-lab-builder-config.js
  Assert-Ok 'Configuração do instalador'
  npx electron-builder --config build/fiscal-lab-electron-builder.json --win nsis --x64 --publish never
  Assert-Ok 'Empacotamento LAB'
  Write-Host 'Instalador fiscal LAB isolado em dist-fiscal-lab/ — NAO homologado e NAO publicar.'
} finally { Pop-Location }
