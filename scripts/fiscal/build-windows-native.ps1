# Windows x64 release: compile ACBrLib from auditable OSS source and freeze
# local Python worker. No paid provider and no dependency on the client PC.
param([string]$Revision = '48608')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT'){throw 'A compilação nativa ACBr requer Windows x64.'}
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $root
try {
  foreach($name in @('python','node','svn','git','lazbuild')){
    if(-not (Get-Command $name -ErrorAction SilentlyContinue) -and $name -ne 'lazbuild'){
      throw "Dependência de build OSS indisponível: $name"
    }
  }
  & (Join-Path $PSScriptRoot 'build-acbr-native.ps1') -Revision $Revision
  if($LASTEXITCODE -ne 0){throw 'Compilação ACBrLib retornou erro'}
  python -m pip install --disable-pip-version-check 'pyinstaller==6.16.0'
  if($LASTEXITCODE -ne 0){throw 'Instalação PyInstaller falhou'}
  python -m PyInstaller --noconfirm --clean --onefile --console --name acbrlib-worker --distpath build/fiscal-worker --workpath build/pyinstaller-tmp --specpath build/pyinstaller-src server/acbrlib/acbrlib-worker.py
  if($LASTEXITCODE -ne 0){throw 'Compilação worker ACBr falhou'}
  node scripts/fiscal/stage-fiscal-bundle-reference.mjs
  if($LASTEXITCODE -ne 0){throw 'Verificação integridade ACBr falhou'}
  $worker=(Resolve-Path 'build/fiscal/acbrlib-worker.exe').Path
  $dll=(Resolve-Path 'build/fiscal/ACBrNFe64.dll').Path
  & $worker '--self-test'
  if($LASTEXITCODE -ne 0){throw 'Worker fiscal não executou'}
  & $worker '--probe' $dll
  if($LASTEXITCODE -ne 0){throw 'ACBr nativa não carregou em Windows x64'}
  node scripts/fiscal/create-release-builder-config.js
  if($LASTEXITCODE -ne 0){throw 'Configuração instalador Windows fiscal inválida'}
  Write-Host "Bundle fiscal compilado e sondado, SVN r$Revision. Sem certificado e sem transmissão."
} finally {Pop-Location}
