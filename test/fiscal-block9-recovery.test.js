'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {applyPendingRestore}=require('../js/core/backup/pending-restore');
const {createFiscalRecoveryService}=require('../js/domains/fiscal/fiscal-recovery-service');

const admin={userId:'admin',role:'admin'};

test('P22 backup fiscal restores SQLite, document state, XML, Fiscal Packs and sequence without copying secrets',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-p22-'));
  const dbPath=path.join(root,'pdv.sqlite');const backupDir=path.join(root,'backups');const recoveryDir=path.join(root,'recovery');const archiveDir=path.join(root,'fiscal-archive');const packRoot=path.join(root,'fiscal-packs');const credentialSentinel=path.join(root,'pdv-fiscal-credentials.enc');
  fs.mkdirSync(archiveDir,{recursive:true});fs.mkdirSync(path.join(packRoot,'br-core','1.0.0','parameters'),{recursive:true});fs.writeFileSync(path.join(archiveDir,'authorized.xml'),'<NFe id="original"/>');fs.writeFileSync(path.join(packRoot,'br-core','1.0.0','parameters','runtime.json'),'\n{"pack":"original"}\n');fs.writeFileSync(credentialSentinel,'OS-BOUND-SECRET-DO-NOT-BACKUP');
  let runtime=createPdvRuntime({dbPath,backupDir,fiscalArchiveDir:archiveDir});
  runtime.db.prepare("INSERT OR REPLACE INTO fiscal_sequences(document_type,environment,series,next_number,updated_at) VALUES('nfce','homologation','1',77,'2026-09-21T00:00:00Z')").run();
  runtime.db.prepare("INSERT INTO nfse_documents(id,reference,provider,environment,status,payload_json,signed_dps_xml,provider_response_json,access_key,authorized_xml,attempts,reconcile_required,authorized_at,created_at,updated_at) VALUES('nfse-backup','SERV-77','nfse-national','homologation','AUTHORIZED','{}','<DPS><Signature/></DPS>','{}','NFSEKEY77','<NFSe/>',1,0,'2026-09-21T00:00:00Z','2026-09-21T00:00:00Z','2026-09-21T00:00:00Z')").run();
  const recovery=createFiscalRecoveryService({db:runtime.db,backups:runtime.backups,backupDir,recoveryDir,fiscalArchiveDir:archiveDir,fiscalPackStoreRoot:packRoot,appVersion:'1.4.0'});
  const bundle=recovery.createBundle({reason:'p22-e2e',actor:admin});
  assert.equal(bundle.manifest.secrets.included,false);assert.match(bundle.manifest.secrets.policy,/reconfig|sistema operacional|OS/i);assert.equal(fs.readFileSync(credentialSentinel,'utf8'),'OS-BOUND-SECRET-DO-NOT-BACKUP');
  const prepared=recovery.prepareRestore(bundle.id,{actor:admin});assert.equal(prepared.pending,true);runtime.close();
  fs.rmSync(dbPath,{force:true});fs.rmSync(archiveDir,{recursive:true,force:true});fs.rmSync(packRoot,{recursive:true,force:true});
  const applied=applyPendingRestore({dbPath,backupDir});assert.equal(applied.applied,true);assert.equal(applied.companionsRestored,2);
  runtime=createPdvRuntime({dbPath,backupDir,fiscalArchiveDir:archiveDir});
  assert.equal(runtime.db.prepare("SELECT next_number FROM fiscal_sequences WHERE document_type='nfce' AND environment='homologation' AND series='1'").get().next_number,77);
  assert.equal(runtime.nfse.getDocument('nfse-backup').status,'AUTHORIZED');assert.equal(fs.readFileSync(path.join(archiveDir,'authorized.xml'),'utf8'),'<NFe id="original"/>');assert.match(fs.readFileSync(path.join(packRoot,'br-core','1.0.0','parameters','runtime.json'),'utf8'),/original/);assert.equal(fs.readFileSync(credentialSentinel,'utf8'),'OS-BOUND-SECRET-DO-NOT-BACKUP');
  runtime.close();fs.rmSync(root,{recursive:true,force:true});
});
