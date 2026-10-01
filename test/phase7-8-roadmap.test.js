'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));

test('legacy UI E2E flows stay removed while the current all-pages audit remains',()=>{const flows=path.join(root,'qa','flows');const jsonFiles=fs.existsSync(flows)?fs.readdirSync(flows,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?[]:[entry.name]).filter(file=>file.endsWith('.json')).sort():[];assert.deepEqual(jsonFiles,['all-pages-audit.json']);assert.equal(fs.existsSync(path.join(root,'release','e2e-coverage.json')),false);});

test('release requires complete product-surface evidence without E2E flows',()=>{const pkg=readJson('package.json');assert.equal(pkg.scripts['capability:check:release'],'node scripts/check-customer-capability-parity.js --require-100');assert.match(pkg.scripts['verify:release'],/capability:check:release/);const registry=readJson('release/customer-capabilities.json');const surface=registry.capabilities.filter(item=>item.status==='supported'&&['customer','admin'].includes(item.exposure));assert.ok(surface.length>0);for(const capability of surface){for(const layer of ['backend','api','client','ui']){assert.ok(Array.isArray(capability[layer])&&capability[layer].length>0,`${capability.id} missing ${layer}`);for(const reference of capability[layer])assert.ok(fs.existsSync(path.join(root,reference.path)),`${capability.id} missing path ${reference.path}`);}assert.equal(Object.hasOwn(capability,'e2e'),false,`${capability.id} retains legacy E2E evidence`);}});
