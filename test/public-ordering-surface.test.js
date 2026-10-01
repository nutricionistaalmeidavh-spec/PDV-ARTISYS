'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('new restaurant ordering scripts parse and stay local-first',()=>{const scripts=['js/domains/restaurant/public-ordering.js','server/public-ordering-router.js','server/mobile-assets-router.js','server/customer-menu/app.js','server/mobile/pwa.js','server/mobile/sw.js','desktop/renderer/restaurant-public-ordering-ui.js'];for(const file of scripts)assert.doesNotThrow(()=>new vm.Script(read(file),{filename:file}),file);const html=read('server/customer-menu/index.html');assert.doesNotMatch(html,/https?:\/\//i);assert.match(html,/\/menu\/app\.js/);assert.match(html,/\/menu\/styles\.css/);const mobile=read('server/mobile/index.html');assert.match(mobile,/manifest\.webmanifest/);assert.match(mobile,/\/mobile\/pwa\.js/);});

test('desktop restaurant loads QR/menu extension without replacing canonical restaurant UI',()=>{const html=read('desktop/renderer/index.html');assert.match(html,/restaurant-ui\.js/);assert.match(html,/restaurant-public-ordering-ui\.js/);assert.match(html,/restaurant-public-ordering-ui\.css/);const ui=read('desktop/renderer/restaurant-public-ordering-ui.js');assert.match(ui,/public-ordering\/menu/);assert.match(ui,/tables\/\$\{encodeURIComponent\(table\.id\)\}\/qr/);assert.doesNotMatch(ui,/confirm\s*\(/);});

test('public router is composed ahead of paired self-service handling',()=>{const source=read('server/self-service-mobile-router.js');assert.match(source,/createPublicOrderingRouter/);assert.match(source,/await publicOrderingRouter\(request,response\)/);assert.match(source,/createMobileAssetsRouter/);const protectedSource=read('server/e48-e54-router.js');assert.match(protectedSource,/self-service\/public-ordering\/config/);assert.match(protectedSource,/public-ordering\/tables/);});
