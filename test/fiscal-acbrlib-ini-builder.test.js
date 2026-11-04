'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {compileAcbrIni}=require('../server/acbrlib/fiscal-ini-builder');
const company={
 name:'COMERCIO TESTE LTDA',tradeName:'Loja Teste',cnpj:'12345678000195',
 stateRegistration:'123456789',uf:'SP',crt:'1',environment:'homologation',series:1,
 street:'RUA DAS FLORES',streetNumber:'123',district:'CENTRO',municipalityCode:'3543402',
 municipalityName:'RIBEIRAO PRETO',postalCode:'14000000'
};
function example(overrides={}){
 const item={itemId:'item-1',productId:'ABC-123',productName:'Café torrado',
 sku:'CAF-1',quantityMilli:2000,unitPriceCents:1000,grossCents:2000,
 discountCents:200,netTotalCents:1800,
 taxProfile:{ncm:'09012100',cfop:'5102',origin:'0',csosn:'102',
 pisCst:'49',cofinsCst:'49',unit:'UN',reviewedBy:'Contador',reviewedAt:'2026-11-04',
 zeroLegacyTaxesConfirmed:true,
 ibsCbsCst:'000',cClassTrib:'000001',
 reformTax:{baseCents:1800,ibsUfRate:'0.1000',ibsUfCents:2,
 ibsMunRate:'0.0000',ibsMunCents:0,cbsRate:'0.9000',cbsCents:16}}};
 const snapshot={schemaVersion:1,documentType:'nfce',model:65,issuer:{...company},
 sale:{id:'sale-1',saleNumber:'V100',completedAt:'2026-11-04T12:00:00-03:00'},
 subtotalCents:2000,discountCents:200,totalCents:1800,changeCents:200,
 items:[item],payments:[{method:'CASH',amountCents:2000}]};
 const value={...snapshot,...overrides};
 return {id:'inv1',number:11,series:1,model:65,documentType:'nfce',
 environment:'homologation',totalCents:1800,status:'REVIEW_REQUIRED',
 snapshot:value,snapshotHash:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}
function build(doc=example()){return compileAcbrIni({document:doc,issuedAt:'2026-11-04T15:00:00-03:00',cNF:'87654321'});}
test('ACBr INI official sections preserve exact discounts, total, payments, model and reviewed IBS/CBS values',()=>{
 const {ini,reference,manifest}=build();
 for(const text of ['[infNFe]','versao=4.00','[Identificacao]','nNF=11','serie=1',
  'mod=65','tpAmb=2','cNF=87654321','cUF=35',
  '[Emitente]','CNPJCPF=12345678000195','cMun=3543402',
  '[Produto001]','cProd=CAF-1','qCom=2.000','vUnCom=10.00',
  'vProd=20.00','vDesc=2.00','[ICMS001]','CSOSN=102',
  '[PIS001]','CST=49','[COFINS001]','[IBSCBS001]',
  'cClassTrib=000001','[gIBSCBS001]','vBC=18.00',
  '[gIBSUF001]','pIBSUF=0.1000','vIBSUF=0.02',
  '[gCBS001]','vCBS=0.16',
  '[Total]','vProd=20.00','vDesc=2.00','vNF=18.00',
  '[pag001]','tPag=01','vPag=20.00','vTroco=2.00'])assert.ok(ini.includes(text),text);
 assert.ok(reference.startsWith('acbr-inv1'));
 assert.equal(manifest.amountCents,1800);
 assert.equal(manifest.snapshotHash,example().snapshotHash);
 assert.equal(manifest.issuerCnpj,company.cnpj);
 assert.match(ini,/dEmi=04\/11\/2026 15:00:00/);
});
test('no taxpayer address or accountant-reviewed values means no fiscal INI',()=>{
 let d=example();delete d.snapshot.issuer.street;
 assert.throws(()=>build(d),/logradouro|endereço|emitente/i);
 d=example();delete d.snapshot.items[0].taxProfile.reformTax;
 assert.throws(()=>build(d),/IBS|CBS|reforma|revis/i);
 d=example();delete d.snapshot.items[0].taxProfile.zeroLegacyTaxesConfirmed;
 assert.throws(()=>build(d),/PIS|COFINS|zero|revis/i);
 d=example();d.snapshot.issuer.municipalityCode='9999999';
 assert.throws(()=>build(d),/municipio|município|UF/i);
});
test('rejects injected INI lines, invalid payment mapping and fraudulent totals',()=>{
 let d=example();d.snapshot.items[0].productName='Cafe\n[Emitente]\nCRT=3';
 assert.throws(()=>build(d),/campo|linha|caracter|inválid/i);
 d=example();d.snapshot.payments=[{method:'STORE_CREDIT',amountCents:2000}];
 assert.throws(()=>build(d),/pagamento|forma|não suportad/i);
 d=example();d.snapshot.items[0].grossCents=2100;
 assert.throws(()=>build(d),/total|inconsist|diverge/i);
});
test('rejects NFC-e interstate CFOP and NF-e without explicit recipient',()=>{
 let d=example();d.snapshot.items[0].taxProfile.cfop='6102';
 assert.throws(()=>build(d),/CFOP|operação|estadual/i);
 d=example({documentType:'nfe',model:55});d.documentType='nfe';d.model=55;
 assert.throws(()=>build(d),/destinatário|destinatario/i);
});
test('requires legitimate cNF and rejects snapshot tampering and inconsistent IBS/CBS math',()=>{
 let d=example();d.snapshot.items[0].taxProfile.reformTax.ibsUfCents=700;
 assert.throws(()=>build(d),/IBS|aliquota|alíquota|cálculo/i);
 d=example();assert.throws(()=>compileAcbrIni({document:d,cNF:'123',issuedAt:'2026-11-04T15:00:00-03:00'}),/cNF|aleatóri/i);
 d=example();d.snapshot.totalCents=1801;
 assert.throws(()=>build(d),/snapshot|alterado|hash/i);
});
