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
  assert.doesNotMatch(source,/['"]d1['"]\s*,\s*['"]create['"]/i);
});

test('build can recover the D1 and R2 bindings from the already deployed Worker version',async()=>{
  const {parseLatestVersionId,parseLiveBindings}=await loadBuild();
  assert.equal(parseLatestVersionId(JSON.stringify([{id:'version-123'}])),'version-123');
  const live=parseLiveBindings(JSON.stringify({
    resources:{
      bindings:[
        {type:'d1_database',name:'artisys',database_id:'db-live',database_name:'artisys'},
        {type:'r2_bucket',name:'artisysr2',bucket_name:'artisyspdv'}
      ]
    }
  }));
  assert.deepEqual(live,{databaseId:'db-live',databaseName:'artisys',r2BucketName:'artisyspdv'});
});

test('binding discovery prefers the live Worker and never needs D1-list permission on the happy path',async()=>{
  const {discoverExistingBindings}=await loadBuild();
  const calls=[];
  const runner=(_command,args)=>{
    calls.push(args);
    if(args.includes('versions')&&args.includes('list'))return JSON.stringify([{id:'version-123'}]);
    if(args.includes('versions')&&args.includes('view'))return JSON.stringify({
      bindings:[
        {type:'d1_database',name:'artisys',database_id:'db-live',database_name:'artisys'},
        {type:'r2_bucket',name:'artisysr2',bucket_name:'artisyspdv'}
      ]
    });
    throw new Error('unexpected command');
  };
  const result=discoverExistingBindings({runner,cwd:root,env:{}});
  assert.equal(result.databaseId,'db-live');
  assert.equal(result.r2BucketName,'artisyspdv');
  assert.equal(result.source,'live-worker');
  assert.equal(calls.some(args=>args.includes('d1')),false);
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
