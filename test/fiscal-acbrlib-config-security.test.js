'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {inspectLocalAcbrConfig}=require('../server/acbrlib/acbr-config-check');
function files(t,{ambiente='1',withCsc=true,uf='SP',withPfx=true}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acbr-config-tdd-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pfx=path.join(dir,'client.pfx');
 if(withPfx)fs.writeFileSync(pfx,Buffer.alloc(1024,5));
 const ini=path.join(dir,'ACBrLibNFe.ini');
 fs.writeFileSync(ini,'[Principal]\nTipoResposta=0\nLogNivel=0\n'+
  '[NFe]\nAmbiente='+ambiente+'\nFormaEmissao=0\n'+
  (withCsc?'CSC=123456789abcdef0123456789\nIdCSC=1\n':'')+
  '[DFe]\nUF='+uf+'\nArquivoPFX='+pfx+'\nSenha=SUPER-SEGREDO-DO-CLIENTE\nVerificarValidade=1\n');
 return ini;
}
test('rejects production setting even when document manifest says homologation',t=>{
 const ini=files(t,{ambiente:'0'});
 assert.throws(()=>inspectLocalAcbrConfig({file:ini,model:65,issuerUF:'SP'}),/produção|homologa|ambiente/i);
});
test('valid local A1 homologation config is accepted without returning secrets',t=>{
 const ini=files(t);
 const result=inspectLocalAcbrConfig({file:ini,model:65,issuerUF:'SP'});
 assert.equal(result.ready,true);assert.equal(result.environment,'homologation');
 assert.equal(result.uf,'SP');assert.equal(result.model,65);
 assert.equal(JSON.stringify(result).includes('SUPER-SEGREDO'),false);
 assert.equal(JSON.stringify(result).includes('123456789abcdef'),false);
});
test('rejects absent certificate, CSC for NFC-e and wrong issuer UF',t=>{
 assert.throws(()=>inspectLocalAcbrConfig({file:files(t,{withPfx:false}),model:65,issuerUF:'SP'}),/certificado|PFX/i);
 assert.throws(()=>inspectLocalAcbrConfig({file:files(t,{withCsc:false}),model:65,issuerUF:'SP'}),/CSC/i);
 assert.throws(()=>inspectLocalAcbrConfig({file:files(t,{uf:'RJ'}),model:65,issuerUF:'SP'}),/UF|estado/i);
});
test('NF-e model 55 does not demand CSC but requires same certificate and homologation',t=>{
 const ini=files(t,{withCsc:false});
 assert.equal(inspectLocalAcbrConfig({file:ini,model:55,issuerUF:'SP'}).ready,true);
});
test('malformed duplicate INI sections or keys must fail closed',t=>{
 const ini=files(t);
 fs.appendFileSync(ini,'\n[NFe]\nAmbiente=0\n');
 assert.throws(()=>inspectLocalAcbrConfig({file:ini,model:65,issuerUF:'SP'}),/duplicad|ambiguidade|ambiente/i);
});
