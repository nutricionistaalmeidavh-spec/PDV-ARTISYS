'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildNfeDocument}=require('../js/domains/fiscal/nfe-document-builder');
const {renderNfeIni}=require('../server/fiscal-sidecar/acbr-monitor-protocol');
const {createAcbrMonitorAdapter}=require('../server/fiscal-sidecar/acbr-monitor-adapter');
const {renderDanfeNfeA4}=require('../js/domains/fiscal/danfe-nfe-renderer');

function sale(){return{id:'sale-nfe',saleNumber:'V-55',status:'COMPLETED',createdAt:'2026-09-21T10:00:00-03:00',subtotalCents:2500,discountCents:0,totalCents:2500,changeCents:0,items:[{productId:'p1',sku:'SKU1',name:'Produto modelo 55',quantity:1,unitPriceCents:2500,totalCents:2500}],payments:[{method:'PIX',amountCents:2500}]};}
function context(){return{provider:'acbr-local',environment:'homologation',series:'2',number:42,operationNature:'VENDA DE MERCADORIA',issuer:{cnpj:'12345678000195',stateRegistration:'123456789',legalName:'Empresa Teste LTDA',tradeName:'Empresa Teste',crt:'1',address:{street:'Rua A',number:'1',district:'Centro',cityCode:'3543402',city:'Ribeirao Preto',state:'SP',zip:'14010000'}},items:{p1:{ncm:'61091000',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49',unit:'UN'}}};}
const recipient={taxId:'98765432000198',name:'Cliente Empresa LTDA',stateRegistration:'ISENTO',address:{street:'Rua B',number:'20',district:'Centro',cityCode:'3550308',city:'Sao Paulo',state:'SP',zip:'01001000'}};

test('P17 builds model 55 from canonical sale, requires recipient and keeps independent sequence',()=>{
 const doc=buildNfeDocument({sale:sale(),fiscalContext:context(),recipient});
 assert.equal(doc.documentType,'nfe');assert.equal(doc.identification.model,'55');assert.equal(doc.identification.series,'2');assert.equal(doc.identification.number,42);assert.equal(doc.recipient.taxId,recipient.taxId);assert.equal(doc.totals.totalCents,2500);
 assert.throws(()=>buildNfeDocument({sale:sale(),fiscalContext:context()}),/destinat|recipient/i);
});

test('P17 renders ACBr INI model 55 with recipient and A4 print mode',()=>{
 const doc=buildNfeDocument({sale:sale(),fiscalContext:context(),recipient});const ini=renderNfeIni(doc);
 assert.match(ini,/mod=55/);assert.match(ini,/tpImp=1/);assert.match(ini,/\[Destinatario\]/);assert.match(ini,/CNPJCPF=98765432000198/);assert.match(ini,/idDest=1/);
});

test('P17 ACBr adapter selects model 55 and sends NFe without changing NFC-e path',async()=>{
 const commands=[];let written='';const fsImpl={mkdtempSync:()=>'/tmp/nfe55',writeFileSync:(_p,c)=>{written=c;},rmSync:()=>{}};
 const transport={send:async command=>{commands.push(command);if(command==='NFe.SetModeloDF(55)')return 'OK';return '[NFe]\r\nCStat=100\r\nXMotivo=Autorizado\r\nChNFe=35260912345678000195550020000000421000000420\r\nNProt=135260000123456\r\n.';}};
 const adapter=createAcbrMonitorAdapter({transport,fsImpl,tempDir:'/tmp'});const doc=buildNfeDocument({sale:sale(),fiscalContext:context(),recipient});const result=await adapter.issue({type:'nfe',reference:'V-55',payload:doc,environment:'homologation'});
 assert.equal(result.ok,true);assert.equal(commands[0],'NFe.SetModeloDF(55)');assert.match(commands[1],/NFe\.CriarEnviarNFe/);assert.match(written,/mod=55/);
});

test('P17 generates dedicated printable A4 DANFE, never the NFC-e thermal receipt',()=>{
 const payload=buildNfeDocument({sale:sale(),fiscalContext:context(),recipient});const html=renderDanfeNfeA4({document:{documentType:'nfe',lifecycleStatus:'AUTHORIZED',accessKey:'35260912345678000195550020000000421000000420',authorizationProtocol:'135260000123456',requestPayload:payload}});
 assert.match(html,/DANFE/);assert.match(html,/A4/);assert.match(html,/Cliente Empresa LTDA/);assert.match(html,/3526 0912/);assert.doesNotMatch(html,/Documento Auxiliar da NFC-e/);
});
