'use strict';
// Additive, opt-in fiscal preparation only. Not a SEFAZ issuer.
const {randomUUID,createHash}=require('node:crypto');
const {withTransaction}=require('../../js/core/database/sqlite-database');
const {assertOfflineAllowed,assertOrdinarySeriesAllowed}=require('./nfce-offline-uf-policy');

const FISCAL_MODEL={nfce:65,nfe:55};
function mandatory(value,label,max=128){
 const text=String(value??'').trim();
 if(!text||text.length>max)throw Error(label+' obrigatório ou inválido');
 return text;
}
function digits(value,size,label,optional=false){
 const text=String(value??'').trim();
 if(optional&&!text)return '';
 if(!new RegExp('^[0-9]{'+size+'}$').test(text))throw Error(label+' inválido');
 return text;
}
function money(value,label){
 if(!Number.isSafeInteger(value)||value<0)throw Error(label+' deve ser valor em centavos inteiros');
 return value;
}
function milli(value){
 const number=Number(value), m=number*1000;
 if(!Number.isFinite(number)||number<=0||!Number.isSafeInteger(Math.round(m))||Math.abs(m-Math.round(m))>1e-7)
   throw Error('Quantidade fiscal inválida, máximo de três casas');
 return Math.round(m);
}
function companyInput(value={}){
 const cnpj=mandatory(value.cnpj,'CNPJ',14).toUpperCase();
 if(!/^[A-Z0-9]{14}$/.test(cnpj))throw Error('CNPJ inválido');
 const environment=String(value.environment||'homologation');
 if(environment!=='homologation')throw Error('Produção fiscal bloqueada sem homologação real');
 const uf=mandatory(value.uf,'UF',2).toUpperCase();
 if(!/^[A-Z]{2}$/.test(uf))throw Error('UF inválida');
 const crt=mandatory(value.crt,'CRT',1);
 if(!['1','2','3','4'].includes(crt))throw Error('CRT inválido');
 const series=Number(value.series);
 if(!Number.isSafeInteger(series)||series<1||series>999)throw Error('Série fiscal inválida');
 const offlineSeries=value.offlineSeries==null||value.offlineSeries===''?null:Number(value.offlineSeries);
 if(offlineSeries!==null&&(!Number.isSafeInteger(offlineSeries)||offlineSeries<1||offlineSeries>999))throw Error('Série de contingência inválida');
 if(offlineSeries!==null&&uf==='RN')assertOfflineAllowed({uf,model:65,series:offlineSeries});
 return {offlineSeries,ibsCbsRegime:['regular','simples','mei','unconfigured'].includes(String(value.ibsCbsRegime||'unconfigured'))?String(value.ibsCbsRegime||'unconfigured'):'unconfigured',name:mandatory(value.name,'Razão social',160),cnpj,uf,stateRegistration:mandatory(value.stateRegistration,'Inscrição estadual',32),crt,environment,series,autoIssue:false,enabled:false,tradeName:String(value.tradeName||'').trim().slice(0,60),street:String(value.street||'').trim().slice(0,60),streetNumber:String(value.streetNumber||'').trim().slice(0,60),district:String(value.district||'').trim().slice(0,60),municipalityCode:String(value.municipalityCode||'').trim().slice(0,7),municipalityName:String(value.municipalityName||'').trim().slice(0,60),postalCode:String(value.postalCode||'').trim().slice(0,8)};
}
function profileInput(value={}){
 const productId=mandatory(value.productId,'Produto',128);
 const origin=digits(value.origin,1,'Origem');
 if(!/^[0-8]$/.test(origin))throw Error('Origem fiscal inválida');
 const csosn=digits(value.csosn,3,'CSOSN',true);
 const cst=digits(value.cst,2,'CST',true);
 if(!csosn&&!cst)throw Error('Perfil tributário exige CST ou CSOSN revisado');
 const reviewedBy=mandatory(value.reviewedBy,'Responsável pela revisão tributária',120);
 const reviewedAt=mandatory(value.reviewedAt,'Data da revisão tributária',10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(reviewedAt))throw Error('Data da revisão tributária inválida');
 const unit=mandatory(value.unit,'Unidade comercial',8).toUpperCase();
 if(!/^[A-Z0-9]{1,8}$/.test(unit))throw Error('Unidade inválida');
 return {productId,ncm:digits(value.ncm,8,'NCM'),cest:digits(value.cest,7,'CEST',true),
  cfop:digits(value.cfop,4,'CFOP'),origin,cst,csosn,
  pisCst:digits(value.pisCst,2,'CST PIS'),cofinsCst:digits(value.cofinsCst,2,'CST COFINS'),
  unit,cAtivSN:digits(value.cAtivSN,2,'Atividade Simples Nacional',true),ibsCbsCst:digits(value.ibsCbsCst,3,'CST IBS/CBS',true),
  cClassTrib:digits(value.cClassTrib,6,'cClassTrib',true),
  reviewedBy,reviewedAt,zeroLegacyTaxesConfirmed:value.zeroLegacyTaxesConfirmed===true,
  // Optional tax structures are reviewed per-product. Never store arbitrary extra keys.
  ...Object.fromEntries(['icms','icmsRetained','icmsSt','simpleCredit','pis','cofins'].map(key=>[
   key,value[key]&&typeof value[key]==='object'&&!Array.isArray(value[key])
    ? Object.fromEntries(Object.entries(value[key]).filter(([k])=>
      ({icms:['basePercent','rate','reduction'],icmsRetained:['baseCents','amountCents'],
       icmsSt:['baseCents','rate','amountCents'],simpleCredit:['rate','amountCents'],
       pis:['rate'],cofins:['rate']})[key].includes(k))):null])),
  reformTax:value.reformTax&&typeof value.reformTax==='object'&&!Array.isArray(value.reformTax)?
   Object.fromEntries(['baseCents','ibsUfRate','ibsUfCents','ibsMunRate','ibsMunCents','cbsRate','cbsCents'].map(key=>[key,value.reformTax[key]])):null};
}
function ensureSchema(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS acbr_fiscal_company (
  id INTEGER PRIMARY KEY CHECK(id=1),
  public_json TEXT NOT NULL, updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS acbr_fiscal_profiles (
  product_id TEXT PRIMARY KEY, public_json TEXT NOT NULL, updated_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS acbr_fiscal_sequences (
  document_type TEXT NOT NULL,environment TEXT NOT NULL,series INTEGER NOT NULL,
  next_number INTEGER NOT NULL CHECK(next_number>0),
  PRIMARY KEY(document_type,environment,series)
 );
 CREATE TABLE IF NOT EXISTS acbr_fiscal_documents (
  id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,document_type TEXT NOT NULL,
  environment TEXT NOT NULL,series INTEGER NOT NULL,number INTEGER NOT NULL,
  model INTEGER NOT NULL,total_cents INTEGER NOT NULL,status TEXT NOT NULL
   CHECK(status IN('REVIEW_REQUIRED','READY','UNKNOWN','AUTHORIZED','REJECTED','CANCELLED')),
  snapshot_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  UNIQUE(sale_id,document_type,environment),
  UNIQUE(document_type,environment,series,number)
 );
 CREATE INDEX IF NOT EXISTS acbr_fiscal_documents_recent
  ON acbr_fiscal_documents(created_at DESC,id);
 `);
}
function createFiscalDraftService({db,sales,now=()=>new Date().toISOString()}={}){
 if(!db||!sales||typeof sales.getSaleDetails!=='function')throw TypeError('Database and canonical SaleService are required');
 ensureSchema(db);
 function getCompany(){
  const row=db.prepare('SELECT public_json FROM acbr_fiscal_company WHERE id=1').get();
  return row?JSON.parse(row.public_json):null;
 }
 function saveCompany(value){
  const company=companyInput(value);
  withTransaction(db,()=>db.prepare(`INSERT INTO acbr_fiscal_company(id,public_json,updated_at) VALUES(1,?,?)
   ON CONFLICT(id) DO UPDATE SET public_json=excluded.public_json,updated_at=excluded.updated_at`)
   .run(JSON.stringify(company),now()));
  return company;
 }
 function saveProductProfile(value){
  const profile=profileInput(value);
  withTransaction(db,()=>db.prepare(`INSERT INTO acbr_fiscal_profiles(product_id,public_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(product_id) DO UPDATE SET public_json=excluded.public_json,updated_at=excluded.updated_at`)
    .run(profile.productId,JSON.stringify(profile),now()));
  return profile;
 }
 function getProductProfile(productId){
  const row=db.prepare('SELECT public_json FROM acbr_fiscal_profiles WHERE product_id=?').get(String(productId));
  return row?JSON.parse(row.public_json):null;
 }
 function mapDocument(row){
  if(!row)return null;
  return {id:row.id,saleId:row.sale_id,documentType:row.document_type,environment:row.environment,
   series:row.series,number:row.number,model:row.model,totalCents:row.total_cents,status:row.status,
   snapshotHash:row.snapshot_hash,snapshot:JSON.parse(row.snapshot_json),
   createdAt:row.created_at,updatedAt:row.updated_at};
 }
 function getDocument(id){return mapDocument(db.prepare('SELECT * FROM acbr_fiscal_documents WHERE id=?').get(String(id)));}
 function listDocuments({limit=100}={}){
  const safeLimit=Number.isSafeInteger(limit)?Math.max(1,Math.min(200,limit)):100;
  return db.prepare('SELECT * FROM acbr_fiscal_documents ORDER BY created_at DESC,id LIMIT ?').all(safeLimit).map(mapDocument);
 }
 function getStatus(){return{provider:'acbrlib-local',emissionEnabled:false,environment:getCompany()?.environment||'homologation',
  configured:Boolean(getCompany()),reviewOnly:true,requiresExternalHomologation:true};}
 function buildSnapshot(sale,company,documentType){
  if(sale?.status!=='COMPLETED')throw Error('A venda precisa estar concluída antes da preparação fiscal');
  const subtotalCents=money(sale.subtotalCents,'Subtotal fiscal');
  const discountCents=money(sale.discountCents,'Desconto fiscal');
  const totalCents=money(sale.totalCents,'Total fiscal');
  const changeCents=money(sale.changeCents||0,'Troco fiscal');
  if(subtotalCents-discountCents!==totalCents||totalCents<=0)throw Error('Total fiscal não confere com a venda concluída');
  const items=(sale.items||[]).map(item=>{
    const profile=getProductProfile(item.productId);
    if(!profile)throw Error('Produto '+String(item.productId||'sem identificação')+' sem perfil tributário revisado');
    if(['1','4'].includes(company.crt)&&!profile.csosn)throw Error('CSOSN obrigatório para CRT Simples Nacional/MEI');
    if(['2','3'].includes(company.crt)&&!profile.cst)throw Error('CST obrigatório para CRT normal');
    const qtyMilli=milli(item.quantity),gross=money(item.totalCents,'Subtotal do item');
    const discount=money(item.allocatedDiscountCents||0,'Desconto do item');
    const net=money(item.netTotalCents==null?gross-discount:item.netTotalCents,'Total líquido do item');
    if(gross-discount!==net)throw Error('Valor líquido de item diverge da venda');
    return {itemId:mandatory(item.id,'Item'),productId:mandatory(item.productId,'Produto'),
     productName:mandatory(item.productName,'Descrição do produto',300),sku:String(item.sku||'').slice(0,80),
     quantityMilli:qtyMilli,unitPriceCents:money(item.unitPriceCents,'Preço unitário'),
     grossCents:gross,discountCents:discount,netTotalCents:net,
     configuration:item.configuration||null,
     taxProfile:{...profile,
      reformTax:profile.reformTax?.ibsUfRate&&profile.reformTax?.ibsMunRate&&profile.reformTax?.cbsRate
       ? (()=>{const r=profile.reformTax;
          const rate=value=>{const s=String(value);if(!/^[0-9]{1,3}\.[0-9]{4}$/.test(s))throw Error('Alíquota IBS/CBS precisa de quatro casas decimais revisadas');
            const parts=s.split('.');const numerator=Number(parts[0])*10000+Number(parts[1]);if(numerator>1000000)throw Error('Alíquota fiscal inválida');return numerator;};
          const out={baseCents:net,ibsUfRate:r.ibsUfRate,ibsMunRate:r.ibsMunRate,cbsRate:r.cbsRate,
           ibsUfCents:Math.round(net*rate(r.ibsUfRate)/1000000),
           ibsMunCents:Math.round(net*rate(r.ibsMunRate)/1000000),
           cbsCents:Math.round(net*rate(r.cbsRate)/1000000)};
          if(['baseCents','ibsUfCents','ibsMunCents','cbsCents'].some(k=>r[k]!=null&&r[k]!==out[k]))
            throw Error('Base ou valor IBS/CBS configurado diverge da venda concluída');
          return out;})():null}};
  });
  if(!items.length)throw Error('Venda sem itens fiscais');
  const sums=items.reduce((a,i)=>({gross:a.gross+i.grossCents,discount:a.discount+i.discountCents,net:a.net+i.netTotalCents}),{gross:0,discount:0,net:0});
  if(sums.gross!==subtotalCents||sums.discount!==discountCents||sums.net!==totalCents)
    throw Error('Somatória fiscal por item diverge do total canônico');
  const payments=(sale.payments||[]).map(p=>({
   method:mandatory(p.method,'Forma de pagamento',40),
   amountCents:money(p.amountCents,'Pagamento'),
   // Payment metadata must originate in the canonical settlement, not user
   // input to the invoice API. It may include acquirer identity, never PAN.
   fiscalMetadata:p.metadata&&typeof p.metadata==='object'&&!Array.isArray(p.metadata)?
    Object.fromEntries(['tpIntegra','cnpj','tBand','cAut','indPag'].filter(k=>p.metadata[k]!=null).map(k=>[k,String(p.metadata[k]).slice(0,60)])):null
  }));
  if(!payments.length||payments.reduce((total,p)=>total+p.amountCents,0)-changeCents!==totalCents)
    throw Error('Pagamentos ou troco não correspondem ao total canônico');
  return {schemaVersion:1,documentType,model:FISCAL_MODEL[documentType],
   issuer:company,sale:{id:sale.id,saleNumber:sale.saleNumber,completedAt:sale.completedAt,customerId:sale.customerId||null},
   subtotalCents,discountCents,totalCents,changeCents,items,payments,
   reviewStatus:'NEEDS_ACCOUNTANT_AND_SEFAZ_VALIDATION'};
 }
 function prepareSale(saleId,{documentType='nfce',offline=false}={}){
  if(!Object.hasOwn(FISCAL_MODEL,documentType))throw Error('Tipo fiscal inválido');
  const company=getCompany();
  if(!company)throw Error('Empresa fiscal não configurada');
  if(offline!==true&&offline!==false)throw Error('Modo de contingência inválido');
  if(offline&&documentType!=='nfce')throw Error('Contingência offline exclusiva NFC-e 65');
  const chosenSeries=offline?(company.offlineSeries??company.series):company.series;
  if(offline)assertOfflineAllowed({uf:company.uf,model:65,series:chosenSeries});
  else if(documentType==='nfce')assertOrdinarySeriesAllowed({uf:company.uf,model:65,series:chosenSeries});
  return withTransaction(db,()=>{
   const existing=db.prepare(`SELECT * FROM acbr_fiscal_documents
    WHERE sale_id=? AND document_type=? AND environment=?`).get(String(saleId),documentType,company.environment);
   if(existing){
    const previous=mapDocument(existing);
    if(offline&&previous.series!==chosenSeries)throw Error('Venda já reservou outra série fiscal; não converter nem duplicar chave NFC-e');
    return previous;
   }
   const sibling=db.prepare('SELECT id,document_type FROM acbr_fiscal_documents WHERE sale_id=? AND environment=? LIMIT 1')
    .get(String(saleId),company.environment);
   if(sibling)throw Error('Esta venda já possui documento fiscal de outro modelo: emissão duplicada bloqueada');
   const sale=sales.getSaleDetails(saleId);
   if(!sale)throw Error('Venda não encontrada');
   const snapshot=buildSnapshot(sale,{...company,series:chosenSeries},documentType);
   const data=JSON.stringify(snapshot);
   const hash=createHash('sha256').update(data).digest('hex');
   const current=db.prepare('SELECT next_number FROM acbr_fiscal_sequences WHERE document_type=? AND environment=? AND series=?')
    .get(documentType,company.environment,chosenSeries);
   const number=current?.next_number||1;
   db.prepare(`INSERT INTO acbr_fiscal_sequences(document_type,environment,series,next_number)
    VALUES(?,?,?,?) ON CONFLICT(document_type,environment,series)
    DO UPDATE SET next_number=excluded.next_number`).run(documentType,company.environment,chosenSeries,number+1);
   const id=randomUUID(),ts=now();
   db.prepare(`INSERT INTO acbr_fiscal_documents
    (id,sale_id,document_type,environment,series,number,model,total_cents,status,snapshot_hash,snapshot_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'REVIEW_REQUIRED',?,?,?,?)`).run(id,String(saleId),documentType,company.environment,chosenSeries,number,snapshot.model,snapshot.totalCents,hash,data,ts,ts);
   return getDocument(id);
  });
 }
 function transmit(){throw Error('Emissão fiscal desabilitada até homologação externa e integração de ACBrLib com revisão tributária');}
 return Object.freeze({getCompany,saveCompany,saveProductProfile,getProductProfile,prepareSale,getDocument,listDocuments,getStatus,transmit});
}
module.exports={createFiscalDraftService,ensureSchema,companyInput,profileInput};
