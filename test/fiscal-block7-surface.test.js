'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('P17 keeps NFe model55 in fiscal core while P18 NFS-e remains a separate module',()=>{
 const runtime=read('js/core/pdv-runtime.js');assert.match(runtime,/createNfseService/);assert.match(runtime,/nfseProviderResolver/);assert.match(runtime,/nfse,/);
 const service=read('js/domains/nfse/nfse-service.js');assert.doesNotMatch(service,/fiscal_documents/);assert.match(service,/nfse_documents/);
});

test('P18 local authenticated API exposes NFS-e issue/query/reconcile without secret material',()=>{
 const router=read('server/nfse-router.js');const local=read('server/local-server.js');for(const marker of ['/api/v1/nfse/documents','/reconcile','/events'])assert.match(router,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.match(local,/createNfseRouter/);assert.doesNotMatch(router,/pfx|passphrase|password/i);
});

test('Bloco 8 remains integrated on the complete branch',()=>{
 const pkg=JSON.parse(read('package.json'));assert.equal(pkg.scripts['test:fiscal:p20-p21'].includes('fiscal-packaging'),true);assert.ok(pkg.build.extraResources.some(item=>item.to==='fiscal/sidecar'));assert.ok(fs.existsSync(path.join(root,'js/domains/fiscal/fiscal-pack-store.js')));assert.ok(fs.existsSync(path.join(root,'desktop/fiscal-runtime-paths.cjs')));
});
