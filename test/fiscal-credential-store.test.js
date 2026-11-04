'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFiscalCredentialStore}=require('../desktop/acbrlib-credential-store.cjs');
function make(t,{encryption=true}={}){
 const userData=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-pfx-'));
 t.after(()=>fs.rmSync(userData,{recursive:true,force:true}));
 const source=path.join(userData,'temporary-source.pfx');
 fs.writeFileSync(source,Buffer.alloc(1500,0x55));
 const safeStorage={
  isEncryptionAvailable:()=>encryption,
  encryptString:s=>Buffer.from('SEALED:'+Buffer.from(s,'utf8').toString('base64')),
  decryptString:buffer=>Buffer.from(String(buffer).slice(7),'base64').toString('utf8')
 };
 return {userData,source,safeStorage,store:createFiscalCredentialStore({userData,safeStorage})};
}
test('import A1 into per-user private store and seal password/CSC without HTTP or program directory',t=>{
 const f=make(t);const details=f.store.importCertificate({certificatePath:f.source,password:'S3cret-pass',uf:'SP',csc:'NFCe-Test-CSC-123',idCsc:'1'});
 assert.equal(details.configured,true);
 assert.equal(details.uf,'SP');
 assert.equal(JSON.stringify(details).includes('S3cret-pass'),false);
 assert.equal(JSON.stringify(details).includes('NFCe-Test-CSC'),false);
 const privateDir=path.join(f.userData,'fiscal','private');
 const sealed=fs.readFileSync(path.join(privateDir,'credentials.bin'),'utf8');
 assert.equal(sealed.includes('S3cret-pass'),false);
 assert.equal(sealed.includes('NFCe-Test-CSC'),false);
 assert.ok(fs.existsSync(path.join(privateDir,'certificate.pfx')));
 const status=f.store.status();assert.equal(status.configured,true);
 assert.equal(status.homologationEnabled,false);
 assert.equal(fs.existsSync(path.join(privateDir,'ACBrLibNFe.ini')),false);
});
test('materializes ACBr homologation INI temporarily, omits production, supports restart recovery',t=>{
 const f=make(t);
 f.store.importCertificate({certificatePath:f.source,password:'test-pwd',uf:'SP',csc:'csc-xyz',idCsc:'1'});
 const ini=f.store.materialize();
 const text=fs.readFileSync(ini,'utf8');
 assert.match(text,/\[NFe\][\s\S]*Ambiente=1/);
 assert.match(text,/\[DFe\][\s\S]*VerificarValidade=1/);
 assert.match(text,/ArquivoPFX=.*certificate\.pfx/);
 assert.match(text,/Senha=test-pwd/);
 assert.equal(text.includes('Ambiente=0'),false);
 f.store.removeRuntimeConfig();
 assert.equal(fs.existsSync(ini),false);
 const reopened=createFiscalCredentialStore({userData:f.userData,safeStorage:f.safeStorage});
 assert.equal(reopened.materialize(),ini);
 assert.equal(reopened.status().configured,true);
});
test('homologation is separately opt-in, persists across restarts and fails closed without a stored certificate',t=>{
 const f=make(t);assert.throws(()=>f.store.enableHomologation(),/certificado|configura/i);
 f.store.importCertificate({certificatePath:f.source,password:'test',uf:'SP'});
 f.store.materialize();
 const next=f.store.enableHomologation();
 assert.equal(next.restartRequired,true);
 assert.equal(f.store.status().homologationEnabled,true);
 const reopened=createFiscalCredentialStore({userData:f.userData,safeStorage:f.safeStorage});
 assert.equal(reopened.status().homologationEnabled,true);
 reopened.disableHomologation();
 assert.equal(reopened.status().homologationEnabled,false);
});
test('plain secret, malformed certificate path, unencrypted safeStorage and input injections are rejected',t=>{
 const f=make(t,{encryption:false});
 assert.throws(()=>f.store.importCertificate({certificatePath:f.source,password:'test',uf:'SP'}),/seguro|criptograf/i);
 const g=make(t);
 assert.throws(()=>g.store.importCertificate({certificatePath:f.source,password:'pass\n[NFe]',uf:'SP'}),/senha|caractere|inválid/i);
 assert.throws(()=>g.store.importCertificate({certificatePath:f.source,password:'test',uf:'XX'}),/UF|estado|inválid/i);
 assert.throws(()=>g.store.importCertificate({certificatePath:'/not-there.pfx',password:'test',uf:'SP'}),/certificado|arquivo|PFX/i);
});

test('homologation opt-in does not keep decrypted A1 password in an INI at rest',t=>{
 const f=make(t);
 f.store.importCertificate({certificatePath:f.source,password:'SECRET-IN-MEMORY',uf:'SP',csc:'TEST',idCsc:'1'});
 const flag=f.store.enableHomologation();
 assert.equal(flag.homologationEnabled,true);
 assert.equal(f.store.status().homologationEnabled,true);
 assert.equal(fs.existsSync(f.store.paths.iniPath),false);
});
