'use strict';

const fs=require('node:fs');
const path=require('node:path');

function walk(dir){
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name);
    return entry.isDirectory()?walk(full):[full];
  });
}

function normalize(p){return String(p||'').replace(/\\/g,'/');}

function validateReference({root,capability,layer,reference,errors}){
  if(!reference||!reference.path){errors.push(`${capability.id}: ${layer} reference is missing path`);return false;}
  const absolute=path.join(root,reference.path);
  if(!fs.existsSync(absolute)){errors.push(`${capability.id}: ${layer} path missing: ${reference.path}`);return false;}
  if(reference.marker){
    const content=fs.readFileSync(absolute,'utf8');
    if(!content.includes(reference.marker)){errors.push(`${capability.id}: ${layer} marker missing in ${reference.path}: ${reference.marker}`);return false;}
  }
  return true;
}

function validateRegistry({root=path.resolve(__dirname,'..'),registry,requireE2e=false,maxPhase=Number.POSITIVE_INFINITY,require100=false}={}){
  const errors=[];
  const capabilities=Array.isArray(registry?.capabilities)?registry.capabilities:[];
  if(registry?.schemaVersion!==1)errors.push('registry: schemaVersion must be 1');
  if(!capabilities.length)errors.push('registry: capabilities must not be empty');
  const ids=new Set();
  const referencedBackend=new Set();
  let customerAdmin=0;let surfaceComplete=0;let e2eComplete=0;let completeCapabilities=0;

  for(const capability of capabilities){
    if(!capability?.id){errors.push('registry: capability without id');continue;}
    if(ids.has(capability.id))errors.push(`${capability.id}: duplicate capability id`);
    ids.add(capability.id);
    const exposure=capability.exposure;
    if(!['customer','admin','internal'].includes(exposure))errors.push(`${capability.id}: invalid exposure ${exposure}`);
    const supported=capability.status==='supported';
    const phase=Number.isFinite(Number(capability.targetPhase))?Number(capability.targetPhase):Number.POSITIVE_INFINITY;
    const layers=['backend','api','client','ui','e2e'];
    for(const layer of layers){if(!Array.isArray(capability[layer]))errors.push(`${capability.id}: ${layer} must be an array`);}
    for(const ref of capability.backend||[])referencedBackend.add(normalize(ref.path));
    if(!supported)continue;

    const surface=exposure==='customer'||exposure==='admin';
    if(surface){
      customerAdmin+=1;
      let surfaceOk=true;
      for(const layer of ['backend','api','client','ui']){
        if(!(capability[layer]||[]).length){errors.push(`${capability.id}: supported ${exposure} capability missing ${layer}`);surfaceOk=false;continue;}
        for(const reference of capability[layer])if(!validateReference({root,capability,layer,reference,errors}))surfaceOk=false;
      }
      if(surfaceOk)surfaceComplete+=1;

      const e2eRequired=requireE2e&&phase<=maxPhase;
      const hasE2e=(capability.e2e||[]).length>0;
      let e2eOk=true;
      if(e2eRequired&&!hasE2e){errors.push(`${capability.id}: phase ${phase} capability missing e2e`);e2eOk=false;}
      for(const reference of capability.e2e||[])if(!validateReference({root,capability,layer:'e2e',reference,errors}))e2eOk=false;
      if(hasE2e&&e2eOk)e2eComplete+=1;
      if(surfaceOk&&hasE2e&&e2eOk)completeCapabilities+=1;
    }else{
      for(const reference of capability.backend||[])validateReference({root,capability,layer:'backend',reference,errors});
    }
  }

  const ignored=new Set((registry?.backendIgnore||[]).map(normalize));
  const serviceRoots=['js/core','js/domains'];
  const discovered=serviceRoots.flatMap(relative=>walk(path.join(root,relative)))
    .filter(file=>/-service\.js$/.test(file))
    .map(file=>normalize(path.relative(root,file)));
  for(const backendPath of discovered){
    if(!referencedBackend.has(backendPath)&&!ignored.has(backendPath))errors.push(`backend inventory: ${backendPath} is not mapped to a capability or backendIgnore`);
  }

  const declaredPath=path.join(root,'release','capabilities.json');
  if(fs.existsSync(declaredPath)){
    const declared=JSON.parse(fs.readFileSync(declaredPath,'utf8'));
    const mapped=new Set(capabilities.flatMap(capability=>capability.declaredCapabilities||[]));
    for(const id of declared)if(!mapped.has(id))errors.push(`declared capability not mapped: ${id}`);
  }

  const coveragePercent=customerAdmin===0?100:Number(((completeCapabilities/customerAdmin)*100).toFixed(2));
  if(require100&&coveragePercent!==100)errors.push(`capability coverage: ${coveragePercent}% < 100% (${completeCapabilities}/${customerAdmin} supported customer/admin capabilities complete)`);

  return {ok:errors.length===0,errors,counts:{total:capabilities.length,customerAdmin,surfaceComplete,e2eComplete,completeCapabilities,coveragePercent,backendServices:discovered.length}};
}

function parseArgs(argv){
  const requireE2e=argv.includes('--require-e2e');
  const require100=argv.includes('--require-100');
  const phaseIndex=argv.indexOf('--max-phase');
  const maxPhase=phaseIndex>=0?Number(argv[phaseIndex+1]):Number.POSITIVE_INFINITY;
  return {requireE2e,require100,maxPhase:Number.isFinite(maxPhase)?maxPhase:Number.POSITIVE_INFINITY};
}

function main(){
  const root=path.resolve(__dirname,'..');
  const registryPath=path.join(root,'release','customer-capabilities.json');
  if(!fs.existsSync(registryPath)){console.error('CAPABILITY PARITY FAIL\nrelease/customer-capabilities.json not found');process.exitCode=1;return;}
  const registry=JSON.parse(fs.readFileSync(registryPath,'utf8'));
  const options=parseArgs(process.argv.slice(2));
  const result=validateRegistry({root,registry,...options});
  const c=result.counts;
  console.log(`CAPABILITY PARITY\nregistry=${c.total} customer/admin=${c.customerAdmin} surface=${c.surfaceComplete}/${c.customerAdmin} e2e=${c.e2eComplete}/${c.customerAdmin} complete=${c.completeCapabilities}/${c.customerAdmin} coverage=${c.coveragePercent}% backend-services=${c.backendServices}`);
  if(!result.ok){for(const error of result.errors)console.error(`- ${error}`);process.exitCode=1;return;}
  console.log('PASS');
}

if(require.main===module)main();
module.exports={validateRegistry};
