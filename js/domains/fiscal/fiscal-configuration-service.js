'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { validateConnection } = require('./fiscal-core');

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} obrigatorio.`);
  return text;
}

function normalizeCnpj(value) {
  const normalized = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length !== 14) throw new Error('CNPJ deve possuir 14 caracteres alfanumericos.');
  return normalized;
}

function digits(value, length, label, optional = false) {
  const normalized = String(value ?? '').replace(/\D/g, '');
  if (!normalized && optional) return null;
  if (normalized.length !== length) throw new Error(`${label} deve possuir ${length} digitos.`);
  return normalized;
}

function optionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeAddress(input = {}) {
  const address = input && typeof input === 'object' ? input : {};
  const state = required(address.state, 'UF').toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error('UF deve possuir 2 letras.');
  return {
    street:required(address.street, 'Logradouro'),
    number:required(address.number, 'Numero'),
    complement:optionalText(address.complement),
    district:required(address.district, 'Bairro'),
    cityCode:digits(address.cityCode, 7, 'Codigo IBGE'),
    city:required(address.city, 'Municipio'),
    state,
    zip:digits(address.zip, 8, 'CEP')
  };
}

function normalizeCompany(input = {}) {
  const connection = validateConnection(input);
  const crt = required(input.crt, 'CRT');
  if (!/^[1-4]$/.test(crt)) throw new Error('CRT invalido.');
  const cnae = input.cnae == null || input.cnae === '' ? null : digits(input.cnae, 7, 'CNAE');
  return {
    ...connection,
    autoIssue:Boolean(input.autoIssue),
    cnpj:normalizeCnpj(input.cnpj),
    stateRegistration:required(String(input.stateRegistration ?? '').replace(/\s/g,''), 'Inscricao estadual'),
    legalName:required(input.legalName, 'Razao social'),
    tradeName:optionalText(input.tradeName),
    crt,
    cnae,
    series:required(input.series, 'Serie fiscal'),
    operationNature:required(input.operationNature || 'VENDA', 'Natureza da operacao'),
    cscId:optionalText(input.cscId),
    address:normalizeAddress(input.address)
  };
}

function normalizeProfile(input = {}, idFactory = prefix => `${prefix}-${randomUUID()}`) {
  const id = required(input.id || idFactory('fiscal-profile'), 'ID do perfil fiscal');
  const name = required(input.name, 'Nome do perfil fiscal');
  const ncm = digits(input.ncm, 8, 'NCM');
  const cest = input.cest == null || input.cest === '' ? null : digits(input.cest, 7, 'CEST');
  const cfop = digits(input.cfop, 4, 'CFOP');
  const origin = required(input.origin, 'Origem');
  if (!/^[0-8]$/.test(origin)) throw new Error('Origem fiscal invalida.');
  const csosn = optionalText(input.csosn);
  const icmsCst = optionalText(input.icmsCst);
  if (csosn && !/^\d{3}$/.test(csosn)) throw new Error('CSOSN deve possuir 3 digitos.');
  if (icmsCst && !/^\d{2,3}$/.test(icmsCst)) throw new Error('CST ICMS invalido.');
  if (!csosn && !icmsCst) throw new Error('CST/CSOSN ICMS obrigatorio.');
  const pisCst = digits(input.pisCst, 2, 'CST PIS');
  const cofinsCst = digits(input.cofinsCst, 2, 'CST COFINS');
  const unit = required(input.unit, 'Unidade tributavel').toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(unit)) throw new Error('Unidade tributavel invalida.');
  const ibsCbsCst = input.ibsCbsCst == null || input.ibsCbsCst === '' ? null : digits(input.ibsCbsCst, 3, 'CST IBS/CBS');
  const cClassTrib = input.cClassTrib == null || input.cClassTrib === '' ? null : digits(input.cClassTrib, 6, 'cClassTrib');
  if (Boolean(ibsCbsCst) !== Boolean(cClassTrib)) throw new Error('CST IBS/CBS e cClassTrib devem ser informados em conjunto.');
  if (ibsCbsCst && !cClassTrib.startsWith(ibsCbsCst)) throw new Error('cClassTrib deve pertencer ao CST IBS/CBS informado.');
  return { id,name,ncm,cest,cfop,origin,csosn,icmsCst,pisCst,cofinsCst,unit,ibsCbsCst,cClassTrib,active:input.active !== false };
}

function mapCompany(row) {
  if (!row) return null;
  let address = {};
  try { address = JSON.parse(row.address_json || '{}'); } catch {}
  return {
    provider:row.provider, documentType:row.document_type, environment:row.environment,
    autoIssue:Boolean(row.auto_issue), cnpj:row.cnpj, stateRegistration:row.state_registration,
    legalName:row.legal_name, tradeName:row.trade_name, crt:row.crt, cnae:row.cnae,
    series:row.series, operationNature:row.operation_nature, cscId:row.csc_id,
    address, createdAt:row.created_at, updatedAt:row.updated_at
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id:row.id,name:row.name,ncm:row.ncm,cest:row.cest,cfop:row.cfop,origin:row.origin,
    csosn:row.csosn,icmsCst:row.icms_cst,pisCst:row.pis_cst,cofinsCst:row.cofins_cst,
    unit:row.unit,ibsCbsCst:row.ibs_cbs_cst,cClassTrib:row.c_class_trib,active:Boolean(row.active),
    createdAt:row.created_at,updatedAt:row.updated_at
  };
}

function createFiscalConfigurationService({ db, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function getCompanySettings() {
    return mapCompany(db.prepare("SELECT * FROM fiscal_company_settings WHERE id='default'").get());
  }

  function saveCompanySettings(input = {}, actor = {}) {
    const value = normalizeCompany(input);
    const existing = db.prepare("SELECT created_at FROM fiscal_company_settings WHERE id='default'").get();
    const timestamp = now();
    db.prepare(`INSERT INTO fiscal_company_settings
      (id,provider,document_type,environment,auto_issue,cnpj,state_registration,legal_name,trade_name,crt,cnae,series,operation_nature,csc_id,address_json,created_at,updated_at)
      VALUES ('default',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,document_type=excluded.document_type,environment=excluded.environment,
        auto_issue=excluded.auto_issue,cnpj=excluded.cnpj,state_registration=excluded.state_registration,legal_name=excluded.legal_name,
        trade_name=excluded.trade_name,crt=excluded.crt,cnae=excluded.cnae,series=excluded.series,operation_nature=excluded.operation_nature,
        csc_id=excluded.csc_id,address_json=excluded.address_json,updated_at=excluded.updated_at`)
      .run(value.provider,value.documentType,value.environment,value.autoIssue?1:0,value.cnpj,value.stateRegistration,value.legalName,value.tradeName,
        value.crt,value.cnae,value.series,value.operationNature,value.cscId,JSON.stringify(value.address),existing?.created_at||timestamp,timestamp);
    writeAudit(db,{action:'fiscal.settings.update',entity:'fiscal-settings',entityId:'default',actor,context:{provider:value.provider,documentType:value.documentType,environment:value.environment,autoIssue:value.autoIssue,series:value.series}},now);
    return getCompanySettings();
  }

  function getProfile(id) {
    return mapProfile(db.prepare('SELECT * FROM fiscal_profiles WHERE id=?').get(String(id)));
  }

  function listProfiles({ includeInactive=false }={}) {
    const rows=includeInactive?db.prepare('SELECT * FROM fiscal_profiles ORDER BY name,id').all():db.prepare('SELECT * FROM fiscal_profiles WHERE active=1 ORDER BY name,id').all();
    return rows.map(mapProfile);
  }

  function upsertProfile(input = {}, actor = {}) {
    const value=normalizeProfile(input,idFactory);const timestamp=now();
    const existing=db.prepare('SELECT created_at FROM fiscal_profiles WHERE id=?').get(value.id);
    db.prepare(`INSERT INTO fiscal_profiles
      (id,name,ncm,cest,cfop,origin,csosn,icms_cst,pis_cst,cofins_cst,unit,ibs_cbs_cst,c_class_trib,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,ncm=excluded.ncm,cest=excluded.cest,cfop=excluded.cfop,origin=excluded.origin,
        csosn=excluded.csosn,icms_cst=excluded.icms_cst,pis_cst=excluded.pis_cst,cofins_cst=excluded.cofins_cst,unit=excluded.unit,
        ibs_cbs_cst=excluded.ibs_cbs_cst,c_class_trib=excluded.c_class_trib,active=excluded.active,updated_at=excluded.updated_at`)
      .run(value.id,value.name,value.ncm,value.cest,value.cfop,value.origin,value.csosn,value.icmsCst,value.pisCst,value.cofinsCst,value.unit,
        value.ibsCbsCst,value.cClassTrib,value.active?1:0,existing?.created_at||timestamp,timestamp);
    writeAudit(db,{action:'fiscal.profile.upsert',entity:'fiscal-profile',entityId:value.id,actor,context:{name:value.name,ncm:value.ncm,cfop:value.cfop,active:value.active}},now);
    return getProfile(value.id);
  }

  function assignProductProfile({ productId, profileId, gtin=null, overrides={} }={}, actor={}) {
    const product=required(productId,'Produto');const profile=required(profileId,'Perfil fiscal');
    if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(product)) throw new Error('Produto nao encontrado para configuracao fiscal.');
    if(!getProfile(profile)) throw new Error('Perfil fiscal nao encontrado.');
    const safeGtin=gtin==null||gtin===''?null:String(gtin).replace(/\D/g,'');
    if(safeGtin && ![8,12,13,14].includes(safeGtin.length)) throw new Error('GTIN invalido.');
    const safeOverrides=overrides&&typeof overrides==='object'&&!Array.isArray(overrides)?overrides:{};
    const existing=db.prepare('SELECT created_at FROM product_fiscal_data WHERE product_id=?').get(product);const timestamp=now();
    db.prepare(`INSERT INTO product_fiscal_data(product_id,fiscal_profile_id,gtin,overrides_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET fiscal_profile_id=excluded.fiscal_profile_id,gtin=excluded.gtin,
      overrides_json=excluded.overrides_json,updated_at=excluded.updated_at`)
      .run(product,profile,safeGtin,JSON.stringify(safeOverrides),existing?.created_at||timestamp,timestamp);
    writeAudit(db,{action:'fiscal.product-profile.assign',entity:'product',entityId:product,actor,context:{profileId:profile,hasGtin:Boolean(safeGtin)}},now);
    return getProductFiscalData(product);
  }

  function getProductFiscalData(productId) {
    const row=db.prepare(`SELECT pfd.*,fp.* FROM product_fiscal_data pfd JOIN fiscal_profiles fp ON fp.id=pfd.fiscal_profile_id WHERE pfd.product_id=?`).get(String(productId));
    if(!row) return null;
    let overrides={};try{overrides=JSON.parse(row.overrides_json||'{}');}catch{}
    const profile=mapProfile(row);
    return { productId:String(productId),profileId:row.fiscal_profile_id,gtin:row.gtin,...profile,...overrides };
  }

  function initializeSequence({documentType,environment,series,nextNumber=1}={},actor={}) {
    const connection=validateConnection({provider:'acbr-local',documentType,environment});const safeSeries=required(series,'Serie fiscal');const number=Number(nextNumber);
    if(!Number.isSafeInteger(number)||number<1) throw new Error('Proximo numero fiscal invalido.');
    const timestamp=now();
    db.prepare(`INSERT INTO fiscal_sequences(document_type,environment,series,next_number,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(document_type,environment,series) DO UPDATE SET next_number=excluded.next_number,updated_at=excluded.updated_at`)
      .run(connection.documentType,connection.environment,safeSeries,number,timestamp);
    writeAudit(db,{action:'fiscal.sequence.initialize',entity:'fiscal-sequence',entityId:`${connection.documentType}:${connection.environment}:${safeSeries}`,actor,context:{nextNumber:number}},now);
    return getSequence({documentType:connection.documentType,environment:connection.environment,series:safeSeries});
  }

  function getSequence({documentType,environment,series}={}) {
    const connection=validateConnection({provider:'acbr-local',documentType,environment});const safeSeries=required(series,'Serie fiscal');
    const row=db.prepare('SELECT * FROM fiscal_sequences WHERE document_type=? AND environment=? AND series=?').get(connection.documentType,connection.environment,safeSeries);
    return row?{documentType:row.document_type,environment:row.environment,series:row.series,nextNumber:Number(row.next_number),updatedAt:row.updated_at}:null;
  }

  function reserveNumber(settings) {
    const row=db.prepare('SELECT next_number FROM fiscal_sequences WHERE document_type=? AND environment=? AND series=?').get(settings.documentType,settings.environment,settings.series);
    if(!row) throw new Error('Sequencia fiscal nao inicializada.');
    const number=Number(row.next_number);
    db.prepare('UPDATE fiscal_sequences SET next_number=?,updated_at=? WHERE document_type=? AND environment=? AND series=? AND next_number=?')
      .run(number+1,now(),settings.documentType,settings.environment,settings.series,number);
    const check=db.prepare('SELECT next_number FROM fiscal_sequences WHERE document_type=? AND environment=? AND series=?').get(settings.documentType,settings.environment,settings.series);
    if(Number(check?.next_number)!==number+1) throw new Error('Falha ao reservar numero fiscal de forma transacional.');
    return number;
  }

  function buildFiscalContextForSale(sale) {
    if(!sale||typeof sale!=='object') throw new Error('Venda obrigatoria para contexto fiscal.');
    const settings=getCompanySettings();if(!settings) throw new Error('Configuracao fiscal da empresa ausente.');
    const saleItems=Array.isArray(sale.items)?sale.items:[];if(!saleItems.length) throw new Error('Venda sem itens para contexto fiscal.');
    const resolved={};
    for(const item of saleItems){
      const productId=required(item.productId,'Produto fiscal');const tax=getProductFiscalData(productId);
      if(!tax||tax.active===false) throw new Error(`Perfil fiscal/dados fiscais ausentes para produto ${productId}.`);
      resolved[productId]={ ncm:tax.ncm,cest:tax.cest,cfop:tax.cfop,origin:tax.origin,csosn:tax.csosn,icmsCst:tax.icmsCst,
        pisCst:tax.pisCst,cofinsCst:tax.cofinsCst,unit:tax.unit,gtin:tax.gtin,ibsCbsCst:tax.ibsCbsCst,cClassTrib:tax.cClassTrib };
    }
    return withTransaction(db,()=>{
      const number=reserveNumber(settings);
      return {
        issuer:{ cnpj:settings.cnpj,legalName:settings.legalName,tradeName:settings.tradeName,stateRegistration:settings.stateRegistration,crt:settings.crt,address:settings.address },
        series:settings.series,number:String(number),operationNature:settings.operationNature,items:resolved
      };
    });
  }

  function saveCertificateMetadata(input = {}) {
    const timestamp=now();
    db.prepare(`INSERT INTO fiscal_certificates_metadata(id,certificate_name,fingerprint,subject,serial_number,valid_from,valid_to,cnpj,updated_at)
      VALUES('default',?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET certificate_name=excluded.certificate_name,fingerprint=excluded.fingerprint,
      subject=excluded.subject,serial_number=excluded.serial_number,valid_from=excluded.valid_from,valid_to=excluded.valid_to,cnpj=excluded.cnpj,updated_at=excluded.updated_at`)
      .run(optionalText(input.certificateName),optionalText(input.fingerprint),optionalText(input.subject),optionalText(input.serialNumber),optionalText(input.validFrom),optionalText(input.validTo),input.cnpj?normalizeCnpj(input.cnpj):null,timestamp);
    return getCertificateMetadata();
  }

  function getCertificateMetadata(){const row=db.prepare("SELECT * FROM fiscal_certificates_metadata WHERE id='default'").get();return row?{certificateName:row.certificate_name,fingerprint:row.fingerprint,subject:row.subject,serialNumber:row.serial_number,validFrom:row.valid_from,validTo:row.valid_to,cnpj:row.cnpj,updatedAt:row.updated_at}:null;}

  return { getCompanySettings,saveCompanySettings,getProfile,listProfiles,upsertProfile,assignProductProfile,getProductFiscalData,initializeSequence,getSequence,buildFiscalContextForSale,saveCertificateMetadata,getCertificateMetadata };
}

module.exports={ createFiscalConfigurationService,normalizeCnpj,normalizeCompany,normalizeProfile };
