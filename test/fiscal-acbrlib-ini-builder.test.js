'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {compileAcbrIni}=require('../server/acbrlib/fiscal-ini-builder');
const company={
 name:'COMERCIO TESTE LTDA',tradeName:'Loja Teste',cnpj:'12345678000195',
 stateRegistration:'123456789',uf:'SP',crt:'1',ibsCbsRegime:'regular',environment:'homologation',series:1,
 street:'RUA DAS FLORES',streetNumber:'123',district:'CENTRO',municipalityCode:'3543402',
 municipalityName:'RIBEIRAO PRETO',postalCode:'14000000'
};
function example(overrides={}){
 const item={itemId:'item-1',productId:'ABC-123',productName:'Café torrado',
 sku:'CAF-1',quantityMilli:2000,unitPriceCents:1000,grossCents:2000,
 discountCents:200,netTotalCents:1800,
 taxProfile:{ncm:'09012100',cfop:'5102',origin:'0',csosn:'102',cAtivSN:'01',
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
 assert.match(ini,/dhEmi=04\/11\/2026 15:00:00/);
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
 d=example();d.snapshot.payments=[{method:'OTHER',amountCents:2000}];
 assert.throws(()=>build(rehash(d)),/pagamento|forma|não suportad/i);
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

function rehash(d){d.snapshotHash=createHash('sha256').update(JSON.stringify(d.snapshot)).digest('hex');return d;}
test('normal CRT3 with reviewed ICMS/PIS/COFINS produces real taxable totals',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 d.snapshot.issuer.crt='3';p.cst='00';p.csosn='';
 p.icms={basePercent:'100.0000',rate:'18.0000'};
 p.pisCst='01';p.pis={rate:'1.6500'};
 p.cofinsCst='01';p.cofins={rate:'7.6000'};
 const {ini}=build(rehash(d));
 for(const line of ['[ICMS001]','CST=00','pICMS=18.0000','vICMS=3.24',
  '[PIS001]','pPIS=1.6500','vPIS=0.30',
  '[COFINS001]','pCOFINS=7.6000','vCOFINS=1.37',
  '[Total]','vBC=18.00','vICMS=3.24','vCOFINS=1.37'])
  assert.ok(ini.includes(line),line);
});
test('retained ICMS-ST in CSOSN 500 is recorded without duplicating ST due',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 p.csosn='500';p.cfop='5405';p.cest='1701200';p.icmsRetained={baseCents:1800,amountCents:324};
 const {ini}=build(rehash(d));
 assert.match(ini,/\[ICMS001\][\s\S]*CSOSN=500/);
 assert.match(ini,/vBCSTRet=18\.00/);
 assert.match(ini,/vICMSSTRet=3\.24/);
 assert.match(ini,/\[Total\][\s\S]*vST=0\.00/);
});
test('ST due is not emitted until commercial settlement includes the extra fiscal amount',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 p.csosn='202';p.cfop='5403';p.cest='1701200';p.icmsSt={baseCents:2400,rate:'18.0000',amountCents:432};
 assert.throws(()=>build(rehash(d)),/ICMS ST|total comercial/i);
});
test('reviewed card acquirer metadata becomes ACBr card payment fields, never card PAN',()=>{
 const d=example();
 d.snapshot.payments=[{method:'CREDIT_CARD',amountCents:1800,fiscalMetadata:{
  tpIntegra:'1',cnpj:'12345678000195',tBand:'01',cAut:'ABC123',indPag:'0'
 }}];
 d.snapshot.changeCents=0;
 const {ini}=build(rehash(d));
 assert.match(ini,/\[pag001\][\s\S]*tPag=03/);
 assert.match(ini,/tpIntegra=1/);
 assert.match(ini,/tBand=01/);
 assert.match(ini,/cAut=ABC123/);
 assert.doesNotMatch(ini,/cardNumber|pan|cvv/i);
});
test('card payments without canonical acquirer metadata are rejected',()=>{
 const d=example();
 d.snapshot.payments=[{method:'DEBIT_CARD',amountCents:1800}];
 d.snapshot.changeCents=0;
 assert.throws(()=>build(rehash(d)),/adquirente|cartão|integração|CNPJ/i);
});

test('NT 2026.005: Simples regular must declare explicit regime and activity',()=>{
 let d=example();d.snapshot.issuer.ibsCbsRegime='unconfigured';
 assert.throws(()=>build(rehash(d)),/IBS|CBS|regime|opção/i);
 d=example();d.snapshot.items[0].taxProfile.cAtivSN='';
 assert.throws(()=>build(rehash(d)),/cAtivSN|atividade|Simples/i);
 const {ini}=build();
 assert.match(ini,/\[Emitente\][\s\S]*tpRegimeIBSCBS=1/);
 assert.match(ini,/\[Produto001\][\s\S]*cAtivSN=01/);
});
test('NT 2026.005: excess sublimite CRT2 uses CST ICMS and not CSOSN',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 d.snapshot.issuer.crt='2';
 p.cst='00';p.csosn='';
 p.icms={basePercent:'100.0000',rate:'18.0000'};
 const {ini}=build(rehash(d));
 assert.match(ini,/CRT=2/);assert.match(ini,/\[ICMS001\][\s\S]*CST=00/);
 assert.doesNotMatch(ini,/CSOSN=/);
 d.snapshot.items[0].taxProfile.cst='';
 d.snapshot.items[0].taxProfile.csosn='102';
 assert.throws(()=>build(rehash(d)),/CST|CRT 2|regime/i);
});
test('NT 2026.005: MEI CRT4 omits IBS/CBS group entirely',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 d.snapshot.issuer.crt='4';d.snapshot.issuer.ibsCbsRegime='mei';
 delete p.cAtivSN;delete p.reformTax;delete p.cClassTrib;delete p.ibsCbsCst;
 const {ini}=build(rehash(d));
 assert.match(ini,/CRT=4/);
 assert.doesNotMatch(ini,/\[IBSCBS001\]|\[gIBSCBS001\]|\[IBSCBSTot\]|tpRegimeIBSCBS=/);
 p.csosn='101';
 assert.throws(()=>build(rehash(d)),/MEI|CSOSN|regime/i);
});
test('NT 2026.005: regime regular is not assumed for CRT1/2 by default',()=>{
 const d=example();d.snapshot.issuer.ibsCbsRegime='simples';
 assert.throws(()=>build(rehash(d)),/gTribSN|regime|Simples|IBS/i);
});

test('CFOP 5405 retail ST-retained requires tax code 500/60 and a reviewed CEST',()=>{
 let d=example(),p=d.snapshot.items[0].taxProfile;
 p.cfop='5405';p.csosn='500';p.cest='1701200';
 p.icmsRetained={baseCents:1800,amountCents:324};
 const {ini}=build(rehash(d));assert.match(ini,/CFOP=5405/);
 assert.match(ini,/CEST=1701200/);
 d=example();p=d.snapshot.items[0].taxProfile;p.cfop='5405';
 assert.throws(()=>build(rehash(d)),/CFOP|ST|CSOSN|CST/i);
 d=example();p=d.snapshot.items[0].taxProfile;p.cfop='5405';p.csosn='500';
 p.icmsRetained={baseCents:1800,amountCents:324};
 assert.throws(()=>build(rehash(d)),/CEST|ST/i);
});
test('ST-retained code with CFOP 5102 never issues tax-inconsistent document',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 p.csosn='500';p.icmsRetained={baseCents:1800,amountCents:324};
 assert.throws(()=>build(rehash(d)),/CFOP|ST/i);
});

test('CRT2 (Simples excesso de sublimite) requires normal-regime CST 60 for retained ST',()=>{
 const d=example(),p=d.snapshot.items[0].taxProfile;
 d.snapshot.issuer.crt='2';p.csosn='';p.cst='60';p.cest='1234567';p.cAtivSN='01';
 p.cfop='5405';p.icmsRetained={baseCents:1800,amountCents:324};
 const {ini}=build(rehash(d));
 assert.match(ini,/CFOP=5405/);
 assert.match(ini,/CST=60/);
 assert.match(ini,/vICMSSTRet=3\.24/);
 assert.doesNotMatch(ini,/CSOSN=/);
});


test('offline contingency NFCE has distinct tpEmis=9, reason, timestamp and immutable manifest',()=>{
 const d=example();
 const options={document:d,cNF:'87654321',issuedAt:'2026-11-04T15:00:00-03:00',
  contingency:{startedAt:'2026-11-04T15:30:00-03:00',
   reason:'Falha de conexao com a SEFAZ durante teste offline.'}};
 const out=compileAcbrIni(options);
 assert.match(out.ini,/tpEmis=9/);
 assert.match(out.ini,/dhCont=04\/11\/2026 15:30:00/);
 assert.match(out.ini,/xJust=Falha de conexao com a SEFAZ/);
 assert.equal(out.manifest.issuanceMode,'nfce-offline');
 assert.match(out.reference,/offline/);
 assert.notEqual(out.reference,build().reference);
 assert.notEqual(out.manifest.iniSha256,build().manifest.iniSha256);
 const nfe=example({documentType:'nfe',model:55});nfe.documentType='nfe';nfe.model=55;
 assert.throws(()=>compileAcbrIni({...options,document:nfe}),/NFC-e|65|conting/i);
 assert.throws(()=>compileAcbrIni({...options,contingency:{...options.contingency,reason:'falha'}}),/justificativa|conting/i);
});
