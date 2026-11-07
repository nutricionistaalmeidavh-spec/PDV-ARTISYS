'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('commercial renderer contains no loaded fiscal screen or settings hook',()=>{
 const html=read('desktop/renderer/index.html');
 assert.doesNotMatch(html,/acbrlib-fiscal-preview-ui\.js|fiscal-config-ui\.js|fiscal-monitor\.js/);
 const pkg=require('../package.json');
 for(const excluded of ['!desktop/renderer/acbrlib-fiscal-preview-ui.js','!desktop/acbrlib-*.cjs','!server/acbrlib/**/*'])
  assert.ok(pkg.build.files.includes(excluded),excluded);
 assert.deepEqual(pkg.build.extraResources,[]);
 assert.match(read('desktop/renderer/operational-pages.js'),/Fila de impressão/);
});

test('no fiscal IPC, credential-store bootstrap or native ACBr worker in Electron runtime',()=>{
 const main=read('desktop/main.cjs'),preload=read('desktop/preload.cjs');
 assert.doesNotMatch(main,/acbrlib-desktop-runtime|acbrlib-credential-store|acbr-config-check/);
 assert.doesNotMatch(main,/fiscalCredentialStore|fiscalServerOptions|withFiscalConfig|artisys:fiscal:|resolveFiscalDesktopRuntime/);
 assert.doesNotMatch(preload,/artisys:fiscal:|saveOfflineDanfe|fiscal:\s*{/);
 assert.match(main,/registerReceiptIpc/);
 assert.match(main,/startPrintWorker/);
});

test('local and headless server never mount fiscal router or enable environment opt-in',()=>{
 const local=read('server/local-server.js'),headless=read('server/start.js');
 assert.doesNotMatch(local,/require\('\.\/acbrlib\/fiscal-preview-router'\)|createFiscalPreviewRouter|fiscalPreviewHandler/);
 assert.doesNotMatch(headless,/ARTISYS_FISCAL_PREVIEW|ARTISYS_ACBR_HOMOLOGATION|fiscalNativeOptions/);
});

test('even forced legacy preview options cannot open API, issue, or create fiscal tables',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-off-'));
 const runtime=createPdvRuntime({dbPath:path.join(directory,'database.sqlite')});
 runtime.catalog.createUser({id:'admin-fiscal-off',username:'admin-fiscal-off',name:'Admin',
  profileId:'profile-administrator',password:'senha-123456789'});
 const server=createLocalServer({
  runtime,host:'127.0.0.1',port:0,token:'fiscal-disabled-test',
  fiscalPreviewEnabled:true,
  fiscalNativeOptions:{inputDir:'/definitely/invalid',allowHomologation:true,
   get nfeLib(){throw Error('Fiscal native options must never be inspected');}}
 });
 t.after(async()=>{await server.stop();runtime.close();fs.rmSync(directory,{recursive:true,force:true});});
 const bind=await server.start(),base='http://'+bind.host+':'+bind.port;
 const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{
  'content-type':'application/json','x-pdv-token':'fiscal-disabled-test'
 },body:JSON.stringify({username:'admin-fiscal-off',password:'senha-123456789',terminalId:'PDV-01'})});
 assert.equal(login.status,200);
 const sessionToken=(await login.json()).sessionToken;
 for(const endpoint of ['/status','/company','/documents','/offline-queue','/offline-queue/flush','/sales/one/prepare','/documents/one/transmit','/documents/one/offline-issue','/documents/one/cce']){
  const response=await fetch(base+'/api/v1/fiscal-preview'+endpoint,{
   method:/flush|prepare|transmit|offline-issue|\/cce/.test(endpoint)?'POST':'GET',
   headers:{authorization:'Bearer '+sessionToken,'content-type':'application/json'},
   body:/flush|prepare|transmit|offline-issue|\/cce/.test(endpoint)?'{}':undefined
  });
  assert.equal(response.status,404,endpoint);
 }
 assert.deepEqual(runtime.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'acbr_fiscal_%'").all(),[]);
});

test('LAN capability handshake cannot announce fiscal even if provided by legacy caller',()=>{
 const {openDatabase}=require('../js/core/database/sqlite-database');
 const {runMigrations}=require('../js/core/database/migrations');
 const {createTerminalRegistry}=require('../server/lan/terminal-registry');
 const db=openDatabase(':memory:');
 try{
  runMigrations(db);
  const registry=createTerminalRegistry({db,capabilities:['sales','printing','fiscal']});
  const handshake=registry.handshake({appVersion:'1.0.0'});
  assert.deepEqual(handshake.capabilities,['sales','printing']);
 }finally{db.close();}
});

test('commercial Windows release uses standard non-fiscal installer, not native ACBr toolchain',()=>{
 const release=read('.github/workflows/release-windows.yml');
 assert.match(release,/npm run dist:win(?:\s|$)/m);
 assert.doesNotMatch(release,/dist:win:fiscal|build-windows-native\.ps1|verifyAcbrBundle|Install OSS Windows compiler prerequisites|Install OSS Windows toolchain/);
 assert.match(read('package.json'),/dist:win/);
});
