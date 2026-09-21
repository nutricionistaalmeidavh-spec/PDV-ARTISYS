'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Trilha A P2-P5 exposes canonical fiscal client surface',()=>{
 const src=read('desktop/renderer/fiscal-config-api-client.js');
 ['/api/v1/fiscal/settings','/api/v1/fiscal/profiles','/api/v1/products/','/api/v1/fiscal/product-coverage','/api/v1/fiscal/sequences'].forEach(x=>assert.ok(src.includes(x),x));
});
test('Trilha A P2-P5 UI covers company profiles products and sequence without secret inputs',()=>{
 const src=read('desktop/renderer/fiscal-config-ui.js');
 ['P2 · Dados fiscais da empresa','P3 · Perfis tributários','P4 · Tributação por produto','P5 · Sequência e prontidão'].forEach(x=>assert.ok(src.includes(x),x));
 ['pfxPassword','certificatePassword','cscToken','focusToken'].forEach(x=>assert.equal(src.includes(x),false,x));
});
test('P2-P5 scripts are loaded and release QA is fail-closed',()=>{
 const html=read('desktop/renderer/index.html');
 ['fiscal-config-api-client.js','fiscal-config-ui.js','fiscal-config.css'].forEach(x=>assert.ok(html.includes(x),x));
 const qa=JSON.parse(read('qa/artisys-qa.config.json'));
 assert.equal(qa.flows['fiscal-config-p2-p5'],'flows/fiscal-config-p2-p5.json');
 assert.ok(qa.qaProfiles.release.criticalFlows.includes('fiscal-config-p2-p5'));
});
