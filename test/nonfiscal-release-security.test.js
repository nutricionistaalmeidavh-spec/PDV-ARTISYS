'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));

test('nenhum parser XLSX vulnerável de 2022 é distribuído em produção',()=>{
  const dependency=pkg.dependencies.xlsx;
  assert.equal(dependency,'npm:@e965/xlsx@0.20.3');
  assert.equal(lock.packages[''].dependencies.xlsx,dependency);
  const item=lock.packages['node_modules/xlsx'];
  assert.equal(item.version,'0.20.3');
  assert.equal(item.name,'@e965/xlsx');
  assert.match(item.integrity||'',/^sha512-[a-zA-Z0-9+/]+={0,2}$/);
  assert.ok(!lock.packages['node_modules/@e965/xlsx'],'alias deve instalar apenas node_modules/xlsx');
  assert.ok(!Object.values(lock.packages).some(row=>row?.version==='0.18.5'&&row?.name==='xlsx'));
});

test('pacote de planilhas não exige nenhum serviço pago nem usa build fiscal',()=>{
  assert.ok(!pkg.dependencies['exceljs']);
  assert.ok(!pkg.dependencies['sheetjs']);
  const release=fs.readFileSync(path.join(root,'.github/workflows/release-windows.yml'),'utf8');
  assert.match(release,/npm run dist:win(?:\s|$)/m);
  assert.doesNotMatch(release,/dist:win:fiscal|build-windows-native\.ps1/);
});

test('Electron empacotado usa linha estável atualizada para incluir as correções CVE',()=>{
  assert.equal(pkg.devDependencies.electron,'44.11.1');
  assert.equal(lock.packages['node_modules/electron'].version,'44.11.1');
});

test('Playwright desktop E2E preinstala binário Electron 44 no CI antes da primeira janela',()=>{
  const ci=fs.readFileSync(path.join(root,'.github/workflows/verify.yml'),'utf8');
  assert.match(ci,/Install Electron binary for Playwright desktop QA[\s\S]*?npx install-electron --no[\s\S]*?Run current UI E2E at 1366x768/);
});
