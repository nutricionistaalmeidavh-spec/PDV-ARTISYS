'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'..');

async function loadBuild(){
  return import(pathToFileURL(path.join(root,'scripts','prepare-cloudflare-account-build.mjs')).href+'?test='+Date.now());
}

test('Cloudflare account build resolves the existing artisys D1 without creating resources',async()=>{
  const {parseD1List}=await loadBuild();
  const db=parseD1List(JSON.stringify([{uuid:'db-123',name:'artisys'},{uuid:'other',name:'other'}]),'artisys');
  assert.equal(db.uuid,'db-123');
  assert.throws(()=>parseD1List(JSON.stringify([]),'artisys'),/nao encontrado/i);
  const source=fs.readFileSync(path.join(root,'scripts','prepare-cloudflare-account-build.mjs'),'utf8');
  assert.doesNotMatch(source,/d1\s+create/i);
});

test('generated Wrangler config targets only the pdv-artisys worker and preserves known bindings',async()=>{
  const {buildWranglerConfig}=await loadBuild();
  const config=buildWranglerConfig({databaseId:'db-123'});
  assert.equal(config.name,'pdv-artisys');
  assert.equal(config.main,'cloudflare/account/src/worker.mjs');
  assert.equal(config.keep_vars,true);
  assert.deepEqual(config.d1_databases,[{binding:'artisys',database_name:'artisys',database_id:'db-123',migrations_dir:'cloudflare/account/migrations'}]);
  assert.deepEqual(config.r2_buckets,[{binding:'artisysr2',bucket_name:'artisyspdv'}]);
  assert.deepEqual(config.previews,{});
});

test('root npm build is dedicated to Cloudflare account Worker preparation',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts.build,'node scripts/prepare-cloudflare-account-build.mjs');
  assert.equal(pkg.scripts['test:cloudflare:account'],'node --test test/cloudflare-account-worker.test.js test/cloudflare-account-build.test.js');
});
