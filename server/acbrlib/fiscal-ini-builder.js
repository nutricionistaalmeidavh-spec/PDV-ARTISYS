'use strict';
// Strict ACBrLib INI compiler for a reviewed, narrow NFC-e/NF-e retail pilot.
// Field names follow official ACBrLib NFe 4.00 examples.
// No tax percentages, fiscal operation, issuer address or recipient are inferred.
const {createHash}=require('node:crypto');
const {compileLegacyTaxGroups}=require('./fiscal-tax-regimes');
const UF_CODES=Object.freeze({RO:'11',AC:'12',AM:'13',RR:'14',PA:'15',AP:'16',
 TO:'17',MA:'21',PI:'22',CE:'23',RN:'24',PB:'25',PE:'26',AL:'27',SE:'28',
 BA:'29',MG:'31',ES:'32',RJ:'33',SP:'35',PR:'41',SC:'42',RS:'43',
 MS:'50',MT:'51',GO:'52',DF:'53'});
const PAYMENT=Object.freeze({CASH:'01',PIX:'17',DEBIT_CARD:'04',CREDIT_CARD:'03',STORE_CREDIT:'05'});
function required(v,label,{max=120,pattern=null}={}){
 const s=String(v??'').trim();
 if(!s||s.length>max||(pattern&&!pattern.test(s)))throw Error('Campo fiscal inválido ou ausente: '+label);
 if(/[\r\n\0=[\];]/.test(s))throw Error('Caractere de controle ou injeção no campo '+label);
 return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
}
function cents(n,label){
 if(!Number.isSafeInteger(n)||n<0)throw Error('Valor fiscal em centavos inválido: '+label);
 return n;
}
function brl(n){return (cents(n,'BRL')/100).toFixed(2);}
function decRate(v,label){
 const s=required(v,label,{max:8,pattern:/^(?:[0-9]{1,3})\.[0-9]{4}$/});
 const parts=s.split('.');
 const raw=Number(parts[0])*10000+Number(parts[1]);
 if(raw>1000000)throw Error('Alíquota acima de 100%: '+label);
 return {text:s,numerator:raw};
}
function rateCents(base,rate){
 return Math.round(base*rate.numerator/1000000);
}
function mm(milliQty){
 if(!Number.isSafeInteger(milliQty)||milliQty<=0)throw Error('Quantidade em milésimos inválida');
 return (milliQty/1000).toFixed(3);
}
function group(lines,name,values){
 lines.push('['+name+']');
 for(const [key,val] of Object.entries(values)){
  if(val!==undefined&&val!==null&&val!=='')lines.push(key+'='+String(val));
 }
 lines.push('');
}
function dateForAcbr(date){
 const s=required(date,'data e hora da emissão',{max:30,pattern:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/});
 const epoch=Date.parse(s);
 if(!Number.isFinite(epoch))throw Error('Data fiscal inválida');
 // ACBr INI example uses DD/MM/YYYY hh:mm:ss. The issuer clock and
 // timezone are supplied explicitly by the caller, not guessed from UTC.
 if(s.endsWith('Z'))throw Error('A emissão exige horário local com fuso explícito');
 return s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4)+' '+s.slice(11,19);
}
function issuer(emit){
 if(!emit||emit.environment!=='homologation')throw Error('Somente ambiente fiscal de homologação');
 const uf=required(emit.uf,'UF emitente',{max:2,pattern:/^[A-Z]{2}$/});
 const code=UF_CODES[uf];
 if(!code)throw Error('UF emitente desconhecida');
 const municipalityCode=required(emit.municipalityCode,'código IBGE do município',{max:7,pattern:/^\d{7}$/});
 if(!municipalityCode.startsWith(code))throw Error('Município e UF emitente divergentes');
 const cnpj=required(emit.cnpj,'CNPJ',{max:14,pattern:/^\d{14}$/});
 // Reject obvious invalid identifiers even if a test environment is used.
 if(/^(\d)\1{13}$/.test(cnpj))throw Error('CNPJ inválido');
 const crt=required(emit.crt,'CRT',{max:1,pattern:/^[1-4]$/});
 const taxRegime=String(emit.ibsCbsRegime||'unconfigured');
 // NT 2026.005: CRT 1/2 in regular IBS/CBS regime require indicator 1,
 // MEI (CRT 4) must omit all IBS/CBS groups, and Simples nonregular
 // requires gTribSN, which needs a separate validated ACBr layout.
 if(['1','2'].includes(crt)&&taxRegime!=='regular')
  throw Error('Simples Nacional sem opção pelo IBS/CBS regular exige gTribSN conforme NT 2026.005: emissão bloqueada até integração do layout');
 if(crt==='3'&&taxRegime!=='regular')
  throw Error('Regime IBS/CBS normal precisa ser confirmado, incluindo possíveis opções pendentes do Simples');
 if(crt==='4'&&taxRegime!=='mei')
  throw Error('MEI exige tratamento específico sem IBS/CBS conforme NT 2026.005');
 const r={
  CRT:crt,
  ...(['1','2'].includes(crt)?{tpRegimeIBSCBS:'1'}:{}),
  CNPJCPF:cnpj,xNome:required(emit.name,'razão social',{max:60}),
  xFant:emit.tradeName?required(emit.tradeName,'nome fantasia',{max:60}):undefined,
  IE:required(emit.stateRegistration,'inscrição estadual',{max:32}),
  xLgr:required(emit.street,'logradouro emitente',{max:60}),
  nro:required(emit.streetNumber,'número emitente',{max:60}),
  xBairro:required(emit.district,'bairro emitente',{max:60}),
  cMun:municipalityCode,xMun:required(emit.municipalityName,'município emitente',{max:60}),
  cUF:code,UF:uf,CEP:required(emit.postalCode,'CEP emitente',{max:8,pattern:/^\d{8}$/}),
  cPais:'1058',xPais:'BRASIL'
 };
 return {uf,code,values:r};
}
function recipientGroup(recipient){
 if(!recipient||typeof recipient!=='object')throw Error('NF-e modelo 55 exige destinatário identificado e endereço');
 const uf=required(recipient.uf,'UF destinatário',{max:2,pattern:/^[A-Z]{2}$/});
 if(!UF_CODES[uf])throw Error('UF destinatário inválida');
 const mun=required(recipient.municipalityCode,'município destinatário',{max:7,pattern:/^\d{7}$/});
 if(!mun.startsWith(UF_CODES[uf]))throw Error('Município destinatário incompatível com UF');
 return {
  CNPJCPF:required(recipient.taxId,'CPF/CNPJ destinatário',{max:14,pattern:/^(?:\d{11}|\d{14})$/}),
  xNome:required(recipient.name,'nome destinatário',{max:60}),
  indIEDest:required(recipient.indIEDest,'indicador IE destinatário',{max:1,pattern:/^[129]$/}),
  IE:recipient.ie?required(recipient.ie,'IE destinatário',{max:32}):undefined,
  xLgr:required(recipient.street,'logradouro destinatário',{max:60}),
  nro:required(recipient.streetNumber,'número destinatário',{max:60}),
  xBairro:required(recipient.district,'bairro destinatário',{max:60}),
  cMun:mun,xMun:required(recipient.municipalityName,'município destinatário',{max:60}),
  UF:uf,CEP:required(recipient.postalCode,'CEP destinatário',{max:8,pattern:/^\d{8}$/}),
  cPais:'1058',xPais:'BRASIL'
 };
}
function taxSections(lines,tax,index,net,crt){
 const mei=String(crt)==='4';
 if(!tax||typeof tax!=='object')throw Error('Perfil tributário não revisado');
 const legacy=compileLegacyTaxGroups({profile:tax,crt,netCents:net});
 for(const section of ['ICMS','PIS','COFINS'])
   group(lines,section+index,legacy.sections[section]);
 if(mei){
  // NT 2026.005: MEI cannot provide group IBSCBS.
  return {base:0,ufC:0,munC:0,cbsC:0,legacy:legacy.totals};
 }
 if(!tax.ibsCbsCst||!tax.cClassTrib||!tax.reformTax)
  throw Error('IBS/CBS requer código, classificação e cálculo revisados em 2026');
 const r=tax.reformTax,base=cents(r.baseCents,'base IBS/CBS');
 if(base!==net)throw Error('Base IBS/CBS deve corresponder à operação líquida revisada');
 const ibsUF=decRate(r.ibsUfRate,'IBS UF'),ibsMun=decRate(r.ibsMunRate,'IBS município'),cbs=decRate(r.cbsRate,'CBS');
 const ufC=cents(r.ibsUfCents,'valor IBS UF'),munC=cents(r.ibsMunCents,'valor IBS município'),cbsC=cents(r.cbsCents,'valor CBS');
 if(Math.abs(rateCents(base,ibsUF)-ufC)>1||Math.abs(rateCents(base,ibsMun)-munC)>1||Math.abs(rateCents(base,cbs)-cbsC)>1)
  throw Error('Cálculo de alíquota IBS/CBS diverge dos valores informados');
 const cst=required(tax.ibsCbsCst,'CST IBS/CBS',{max:3,pattern:/^\d{3}$/});
 const klass=required(tax.cClassTrib,'cClassTrib',{max:6,pattern:/^\d{6}$/});
 // Pilot standard regime only: other choices (monophase/credit transfer)
 // require dedicated ACBr mapping and cannot be silently approximated.
 if(cst!=='000')throw Error('CST IBS/CBS fora do regime padrão suportado');
 group(lines,'IBSCBS'+index,{CST:cst,cClassTrib:klass});
 group(lines,'gIBSCBS'+index,{vBC:brl(base),vIBS:brl(ufC+munC)});
 group(lines,'gIBSUF'+index,{pIBSUF:ibsUF.text,vIBSUF:brl(ufC)});
 group(lines,'gIBSMun'+index,{pIBSMun:ibsMun.text,vIBSMun:brl(munC)});
 group(lines,'gCBS'+index,{pCBS:cbs.text,vCBS:brl(cbsC)});
 return {base,ufC,munC,cbsC,legacy:legacy.totals};
}
function compileAcbrIni({document,issuedAt,cNF,recipient}={}){
 if(!document||!document.snapshot)throw Error('Documento fiscal canônico obrigatório');
 const s=document.snapshot;
 if(document.documentType!==s.documentType||
    document.model!==s.model||
    document.totalCents!==s.totalCents||
    !['nfce','nfe'].includes(s.documentType)||
    s.model!==(s.documentType==='nfce'?65:55))
   throw Error('Modelo ou total do documento e snapshot divergentes');
 if(s.issuer?.environment!=='homologation'||document.environment!=='homologation')
  throw Error('Produção fiscal bloqueada');
 if(s.issuer?.series!==document.series)throw Error('Série divergente do snapshot');
 if(!Number.isSafeInteger(document.number)||document.number<=0||document.number>999999999)
  throw Error('Número fiscal inválido');
 const emit=issuer(s.issuer);
 const c=required(cNF,'cNF aleatório',{max:8,pattern:/^\d{8}$/});
 if(!/^\d{8}$/.test(c))throw Error('Código cNF inválido');
 const stamp=dateForAcbr(issuedAt);
 if(s.model===55&&!recipient)throw Error('NF-e exige destinatário explícito');
 const dest=s.model===55?recipientGroup(recipient):null;
 if(dest&&dest.UF!==emit.uf)throw Error('Venda interestadual não suportada neste piloto');
 const lines=[];
 group(lines,'infNFe',{versao:'4.00'});
 group(lines,'Identificacao',{nNF:document.number,cNF:c,serie:document.series,
  natOp:'VENDA DE MERCADORIA',mod:s.model,dhEmi:stamp,tpNF:1,idDest:1,
  finNFe:1,indFinal:1,indPres:1,tpImp:s.model===65?4:1,
  tpAmb:2,tpEmis:1,procEmi:0,verProc:'ArtiSys-ACBrLib',cUF:emit.code,
  cMunFG:s.issuer.municipalityCode});
 group(lines,'Emitente',emit.values);
 if(dest)group(lines,'Destinatario',dest);
 let gross=0,discount=0,net=0,reform={base:0,ufC:0,munC:0,cbsC:0};
 const legacyTotals={icmsCents:0,icmsBaseCents:0,stCents:0,stBaseCents:0,pisCents:0,cofinsCents:0};
 const items=s.items;
 if(!Array.isArray(items)||items.length<1||items.length>990)throw Error('Quantidade de itens fiscais inválida');
 items.forEach((item,i)=>{
  const index=String(i+1).padStart(3,'0');
  const tax=item.taxProfile;
  if(!tax||!['5102','5403','5405'].includes(tax.cfop))
    throw Error('CFOP não suportado para venda interna neste fluxo fiscal');
  const code=['2','3'].includes(String(s.issuer.crt))?tax.cst:tax.csosn;
  if(tax.cfop==='5405'&&(!['60','500'].includes(code)||!tax.cest))
    throw Error('CFOP 5405 exige ICMS-ST retido (CSOSN 500/CST 60) e CEST revisado');
  if(tax.cfop==='5403'&&(!['10','30','70','201','202','203'].includes(code)||!tax.cest))
    throw Error('CFOP 5403 exige ICMS-ST devido e CEST revisado');
  if(tax.cfop==='5102'&&['60','500','10','30','70','201','202','203'].includes(code))
    throw Error('CFOP 5102 incompatível com grupo ICMS-ST; revisar classificação');
  const quantity=mm(item.quantityMilli);
  const g=cents(item.grossCents,'valor bruto'),d=cents(item.discountCents,'desconto'),n=cents(item.netTotalCents,'valor líquido');
  if(g-d!==n||Math.round(cents(item.unitPriceCents,'preço unitário')*item.quantityMilli/1000)!==g)
   throw Error('Total por item diverge de preço/quantidade/desconto');
  const productCode=required(item.sku||item.productId,'código produto',{max:60,pattern:/^[A-Za-z0-9._-]+$/});
  group(lines,'Produto'+index,{
   cProd:productCode,cEAN:'SEM GTIN',
   xProd:required(item.productName,'descrição produto',{max:120}),
   NCM:required(tax.ncm,'NCM',{max:8,pattern:/^\d{8}$/}),
   CEST:tax.cest?required(tax.cest,'CEST',{max:7,pattern:/^\d{7}$/}):undefined,
   CFOP:tax.cfop,
   ...(['1','2'].includes(String(s.issuer.crt))?
    {cAtivSN:required(tax.cAtivSN,'cAtivSN atividade Simples Nacional',{max:2,pattern:/^(?:01|02|03|04|90)$/})}:{ }),
   uCom:required(tax.unit,'unidade',{max:8,pattern:/^[A-Z0-9]+$/}),
   qCom:quantity,vUnCom:brl(item.unitPriceCents),vProd:brl(g),vDesc:brl(d),
   uTrib:tax.unit,qTrib:quantity,vUnTrib:brl(item.unitPriceCents),cEANTrib:'SEM GTIN',indTot:1
  });
  const t=taxSections(lines,tax,index,n,s.issuer.crt);
  for(const k of Object.keys(reform))reform[k]+=t[k];
  for(const k of Object.keys(legacyTotals))legacyTotals[k]+=t.legacy[k];
  gross+=g;discount+=d;net+=n;
 });
 if(gross!==s.subtotalCents||discount!==s.discountCents||net!==s.totalCents)
  throw Error('Totais do INI não conferem com a venda canônica');
 // ST due increases vNF under NF-e rules. The commercial sale currently
 // lacks a separate ST-addition field: refuse rather than issue a wrong total.
 if(legacyTotals.stCents>0)throw Error('ICMS ST devido requer integração explícita ao total comercial da venda antes da emissão');
 group(lines,'Total',{vBC:brl(legacyTotals.icmsBaseCents),vICMS:brl(legacyTotals.icmsCents),
  vBCST:brl(legacyTotals.stBaseCents),vST:brl(legacyTotals.stCents),
  vProd:brl(gross),vDesc:brl(discount),vPIS:brl(legacyTotals.pisCents),
  vCOFINS:brl(legacyTotals.cofinsCents),vNF:brl(net)});
 if(String(s.issuer.crt)!=='4'){
  group(lines,'IBSCBSTot',{vBCIBSCBS:brl(reform.base)});
  group(lines,'gIBS',{vIBS:brl(reform.ufC+reform.munC)});
  group(lines,'gIBSUFTot',{vIBSUF:brl(reform.ufC)});
  group(lines,'gIBSMunTot',{vIBSMun:brl(reform.munC)});
  group(lines,'gCBSTot',{vCBS:brl(reform.cbsC)});
 }
 group(lines,'Transportador',{modFrete:9});
 const payments=s.payments;
 if(!Array.isArray(payments)||!payments.length||payments.length>99)throw Error('Pagamentos fiscais ausentes');
 let paid=0;
 payments.forEach((p,i)=>{
  const key=required(p.method,'forma de pagamento',{max:30});
  if(!Object.hasOwn(PAYMENT,key))throw Error('Forma de pagamento não suportada no piloto fiscal');
  const amount=cents(p.amountCents,'pagamento');if(!amount)throw Error('Pagamento fiscal zerado');
  paid+=amount;
  const fields={tPag:PAYMENT[key],vPag:brl(amount),indPag:0};
  if(['CREDIT_CARD','DEBIT_CARD'].includes(key)){
   const meta=p.fiscalMetadata;
   if(!meta||typeof meta!=='object')throw Error('Pagamento com cartão exige metadados canônicos da adquirente/integração');
   fields.tpIntegra=required(meta.tpIntegra,'integração TEF/adquirente',{max:1,pattern:/^[12]$/});
   fields.CNPJ=required(meta.cnpj,'CNPJ adquirente',{max:14,pattern:/^[0-9]{14}$/});
   fields.tBand=required(meta.tBand,'bandeira do cartão',{max:2,pattern:/^[0-9]{2}$/});
   fields.cAut=required(meta.cAut,'autorização cartão',{max:20,pattern:/^[A-Za-z0-9_-]{1,20}$/});
   if(meta.indPag!=null)fields.indPag=required(meta.indPag,'indicador pagamento',{max:1,pattern:/^[01]$/});
  }
  if(i===payments.length-1)fields.vTroco=brl(s.changeCents||0);
  group(lines,'pag'+String(i+1).padStart(3,'0'),fields);
 });
 if(paid-cents(s.changeCents||0,'troco')!==s.totalCents)throw Error('Pagamentos e troco não conferem com a venda');
 const serialized=JSON.stringify(s);
 if(createHash('sha256').update(serialized).digest('hex')!==document.snapshotHash)
  throw Error('Hash do snapshot fiscal alterado');
 const reference='acbr-'+required(document.id,'identificador documento',{max:80,pattern:/^[A-Za-z0-9_-]+$/});
 const ini=lines.join('\n').replace(/\n{3,}/g,'\n\n')+'\n';
 return {reference,ini,manifest:{
  reference,documentType:s.documentType,snapshotHash:document.snapshotHash,
  amountCents:s.totalCents,issuerCnpj:s.issuer.cnpj,issuerUF:s.issuer.uf,
  environment:'homologation',model:s.model,lot:document.number,number:document.number,series:document.series,cNF:c,
  iniSha256:createHash('sha256').update(ini).digest('hex')
 }};
}
module.exports={compileAcbrIni};
