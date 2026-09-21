'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Trilha A uses canonical P1 APIs without redefining fiscal backend',()=>{
 const src=read('desktop/renderer/fiscal-config-api-client.js');
 ['/api/v1/fiscal/settings','/api/v1/fiscal/profiles','/api/v1/products/','/api/v1/fiscal/product-coverage'].forEach(x=>assert.ok(src.includes(x),x));
});

test('P2-P5 UI matches roadmap: company, profiles, product taxation and pending-tax audit',()=>{
 const src=read('desktop/renderer/fiscal-config-ui.js');
 ['P2 · Dados fiscais da empresa','P3 · Perfis tributários','P4 · Tributação por produto','P5 · Pendências tributárias'].forEach(x=>assert.ok(src.includes(x),x));
 assert.ok(src.includes('fiscal-profile-search'),'P3 profile search');
 assert.ok(src.includes('fiscal-profile-duplicate'),'P3 profile duplication');
 assert.ok(src.includes('MISSING_PROFILE'),'P5 missing-profile filter');
 assert.ok(src.includes('MISSING_NCM'),'P5 missing-NCM filter');
 assert.ok(src.includes('MISSING_CFOP'),'P5 missing-CFOP filter');
 assert.ok(src.includes('RTC_INCOMPLETE'),'P5 RTC filter');
 assert.equal(src.includes('P5 · Sequência e prontidão'),false,'P6 sequence must not masquerade as P5');
 ['pfxPassword','certificatePassword','cscToken','focusToken'].forEach(x=>assert.equal(src.includes(x),false,x));
 assert.doesNotThrow(()=>new Function(src),'fiscal config renderer must parse');
});

test('P4 is also present in the canonical product create/edit modal and waits for catalog success',()=>{
 const src=read('desktop/renderer/product-fiscal-fields.js');
 assert.ok(src.includes('#product-form'));
 assert.ok(src.includes('product-fiscal-fields'));
 assert.ok(src.includes('fiscalProfileId'));
 assert.ok(src.includes('fiscalGtin'));
 assert.ok(src.includes('saveProductFiscal'));
 assert.ok(src.includes('[data-edit-product]'));
 assert.ok(src.includes('#new-product'));
 assert.ok(src.includes('waitForCatalogSave'),'P4 must wait for canonical product save');
 assert.ok(src.includes("node.textContent.trim()==='Produto salvo.'"),'P4 must observe a fresh successful catalog save');
 assert.ok(src.indexOf('await waitForCatalogSave')<src.indexOf('await api.saveProductFiscal'),'tax binding cannot run before catalog save succeeds');
 assert.doesNotThrow(()=>new Function(src),'product fiscal extension must parse');
});

test('P2-P5 scripts are loaded and release QA is fail-closed',()=>{
 const html=read('desktop/renderer/index.html');
 ['fiscal-config-api-client.js','fiscal-config-ui.js','product-fiscal-fields.js','fiscal-config.css'].forEach(x=>assert.ok(html.includes(x),x));
 assert.equal(html.includes('\\n  <script'),false,'shell must not contain escaped newline artifacts');
 const qa=JSON.parse(read('qa/artisys-qa.config.json'));
 assert.equal(qa.flows['fiscal-config-p2-p5'],'flows/fiscal-config-p2-p5.json');
 assert.ok(qa.qaProfiles.release.criticalFlows.includes('fiscal-config-p2-p5'));
});

test('Trilha A E2E performs mutations and verifies persisted/corrected state instead of visibility only',()=>{
 const flow=JSON.parse(read('qa/flows/fiscal-config-p2-p5.json'));
 assert.equal(flow.steps[0].uses,'core-business-e2e.json');
 const serialized=JSON.stringify(flow);
 for(const marker of ['p2-save-company','p2-company-data-reloaded','p3-save-profile','p3-save-duplicate','p3-copy-inactive','p4-save-product-with-fiscal','p4-profile-persisted','p5-pending-visible','p5-save-correction','p5-correction-now-ok'])assert.ok(serialized.includes(marker),marker);
 assert.ok(serialized.includes("#product-fiscal-fields"),'P4 must exercise fiscal fields inside product modal');
 assert.ok(serialized.includes("[data-audit-filter='MISSING_PROFILE']"),'P5 must exercise pending filter');
});
