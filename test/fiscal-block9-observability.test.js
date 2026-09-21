'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createFiscalObservability}=require('../js/domains/fiscal/fiscal-observability');

test('P23 records local fiscal timings/status/reconciliation with aggressive secret redaction and exports sanitized support snapshot',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-p23-'));const dbPath=path.join(root,'pdv.sqlite');const runtime=createPdvRuntime({dbPath,backupDir:path.join(root,'backups'),diagnosticsDir:path.join(root,'diagnostics')});
  const obs=createFiscalObservability({db:runtime.db,logger:runtime.logger});
  obs.record({operation:'issue',provider:'acbr-local',documentType:'nfce',environment:'homologation',durationMs:321,outcome:'REJECTED',sefazCode:'225',reference:'V-1',context:{password:'senha-real',csc:'CSC-SECRETO',pfxBase64:'PFX-SECRETO',token:'TOKEN-SECRETO',message:'Bearer abcdefghijklmnopqrstuvwxyz0123456789'}});
  obs.record({operation:'reconcile',provider:'acbr-local',documentType:'nfce',durationMs:87,outcome:'AUTHORIZED',reference:'V-1',retry:1});
  const snapshot=obs.snapshot();assert.equal(snapshot.total>=2,true);assert.equal(snapshot.byOperation.issue,1);assert.equal(snapshot.byOperation.reconcile,1);assert.equal(snapshot.rejections['225'],1);assert.equal(snapshot.maxDurationMs>=321,true);
  const serialized=JSON.stringify(snapshot);for(const secret of ['senha-real','CSC-SECRETO','PFX-SECRETO','TOKEN-SECRETO','abcdefghijklmnopqrstuvwxyz0123456789'])assert.equal(serialized.includes(secret),false);
  const pkg=runtime.diagnostics.createPackage({actor:{userId:'admin',role:'admin'}});const zip=fs.readFileSync(pkg.filePath).toString('utf8');assert.match(zip,/fiscal-diagnostics\.json/);for(const secret of ['senha-real','CSC-SECRETO','PFX-SECRETO','TOKEN-SECRETO'])assert.equal(zip.includes(secret),false);
  runtime.close();fs.rmSync(root,{recursive:true,force:true});
});
