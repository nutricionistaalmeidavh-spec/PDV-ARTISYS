'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { FISCAL_SCHEMA_VERSION } = require('../js/core/database/fiscal-migrations');
const { buildFiscalDocument } = require('../js/domains/fiscal/fiscal-document-builder');

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-fiscal-b2-'));
  return { dir, dbPath:path.join(dir, 'pdv.sqlite') };
}

const actor = { userId:'admin-1', role:'admin' };

function companyInput() {
  return {
    provider:'acbr-local',
    documentType:'nfce',
    environment:'homologation',
    autoIssue:true,
    cnpj:'AB123456789012',
    stateRegistration:'123456789',
    legalName:'Empresa Fiscal Teste Ltda',
    tradeName:'Empresa Fiscal',
    crt:'1',
    cnae:'4711302',
    series:'1',
    operationNature:'VENDA',
    cscId:'1',
    address:{
      street:'Rua Fiscal', number:'100', district:'Centro', cityCode:'3543402',
      city:'Ribeirao Preto', state:'SP', zip:'14010000'
    }
  };
}

function profileInput() {
  return {
    id:'profile-retail',
    name:'Revenda Simples RTC',
    ncm:'61091000',
    cest:null,
    cfop:'5102',
    origin:'0',
    csosn:'102',
    icmsCst:null,
    pisCst:'49',
    cofinsCst:'49',
    unit:'UN',
    ibsCbsCst:'000',
    cClassTrib:'000001',
    active:true
  };
}

function completedSale(productId='prod-fiscal') {
  return {
    id:'sale-fiscal', saleNumber:'VENDA-B2-1', status:'COMPLETED',
    subtotalCents:1000, discountCents:100, totalCents:900, changeCents:100,
    completedAt:'2026-09-20T18:00:00-03:00',
    items:[{ id:'item-1', productId, productName:'Produto Fiscal', sku:'PF-1', quantity:1, unitPriceCents:1000, totalCents:1000 }],
    payments:[{ method:'CASH', amountCents:1000 }]
  };
}

test('P3-P5 migrate additively, persist fiscal configuration and survive restart', () => {
  const { dir, dbPath } = tempDatabase();
  try {
    let runtime = createPdvRuntime({ dbPath });
    assert.ok(runtime.fiscalConfiguration, 'runtime must expose fiscalConfiguration');
    const version = Number(runtime.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version);
    assert.equal(version, FISCAL_SCHEMA_VERSION);
    assert.equal(Number(runtime.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=13').get().count), 1,
      'P3-P5 migration v13 must remain applied exactly once');

    runtime.catalog.upsertProduct({ id:'prod-fiscal', name:'Produto Fiscal', sku:'PF-1', unit:'UN', salePriceCents:1000, costCents:500 }, actor);
    runtime.catalog.upsertProduct({ id:'prod-sem-fiscal', name:'Produto Sem Fiscal', sku:'PSF-1', unit:'UN', salePriceCents:1000, costCents:500 }, actor);

    const company = runtime.fiscalConfiguration.saveCompanySettings(companyInput(), actor);
    assert.equal(company.cnpj, 'AB123456789012');
    assert.equal(company.cscId, '1');
    assert.equal(company.autoIssue, true);

    const profile = runtime.fiscalConfiguration.upsertProfile(profileInput(), actor);
    runtime.fiscalConfiguration.assignProductProfile({ productId:'prod-fiscal', profileId:profile.id, gtin:null }, actor);
    runtime.fiscalConfiguration.initializeSequence({ documentType:'nfce', environment:'homologation', series:'1', nextNumber:41 }, actor);

    assert.throws(
      () => runtime.fiscalConfiguration.buildFiscalContextForSale(completedSale('prod-sem-fiscal')),
      /perfil fiscal|dados fiscais/i
    );
    assert.equal(runtime.fiscalConfiguration.getSequence({ documentType:'nfce', environment:'homologation', series:'1' }).nextNumber, 41,
      'failed preparation must not consume fiscal numbering');

    const fiscalContext = runtime.fiscalConfiguration.buildFiscalContextForSale(completedSale());
    assert.equal(fiscalContext.number, '41');
    assert.equal(fiscalContext.issuer.cnpj, 'AB123456789012');
    assert.equal(fiscalContext.items['prod-fiscal'].cClassTrib, '000001');
    assert.equal(runtime.fiscalConfiguration.getSequence({ documentType:'nfce', environment:'homologation', series:'1' }).nextNumber, 42);

    const document = buildFiscalDocument({
      sale:completedSale(), fiscalContext, documentType:'nfce', environment:'homologation', reference:'VENDA-B2-1'
    });
    assert.equal(document.issuer.cnpj, 'AB123456789012', 'CNPJ alfanumerico must survive the canonical builder');
    assert.equal(document.totals.totalCents, 900);

    runtime.close();
    runtime = createPdvRuntime({ dbPath });
    assert.equal(runtime.fiscalConfiguration.getCompanySettings().cnpj, 'AB123456789012');
    assert.equal(runtime.fiscalConfiguration.getProductFiscalData('prod-fiscal').profileId, 'profile-retail');
    assert.equal(runtime.fiscalConfiguration.getSequence({ documentType:'nfce', environment:'homologation', series:'1' }).nextNumber, 42);

    const tables = new Set(runtime.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const name of ['fiscal_company_settings','fiscal_profiles','product_fiscal_data','fiscal_sequences','fiscal_certificates_metadata','fiscal_document_events']) {
      assert.equal(tables.has(name), true, `${name} must exist`);
    }
    const fiscalColumns = new Set(runtime.db.prepare('PRAGMA table_info(fiscal_documents)').all().map(row => row.name));
    for (const name of ['authorization_protocol','xml_path','danfe_path','contingency_type','authorized_at','rejected_at','sefaz_code','sefaz_message']) {
      assert.equal(fiscalColumns.has(name), true, `fiscal_documents.${name} must exist`);
    }
    runtime.close();
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('P4 validates legacy and RTC tax identity instead of accepting malformed product tax data', () => {
  const { dir, dbPath } = tempDatabase();
  try {
    const runtime = createPdvRuntime({ dbPath });
    assert.throws(() => runtime.fiscalConfiguration.upsertProfile({ ...profileInput(), ncm:'123' }, actor), /NCM/i);
    assert.throws(() => runtime.fiscalConfiguration.upsertProfile({ ...profileInput(), cClassTrib:'200001' }, actor), /cClassTrib|IBS/i);
    assert.throws(() => runtime.fiscalConfiguration.saveCompanySettings({ ...companyInput(), cnpj:'123' }, actor), /CNPJ/i);
    runtime.close();
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});