function normalizeId(value){return String(value||'').trim().toUpperCase();}
function safeArray(value){return Array.isArray(value)?value:[];}
function isRecord(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}

export function validateModuleProbeConfig({modules=[],probes={}}={}){
  const errors=[];
  if(!Array.isArray(modules))return{ok:false,errors:['modules must be an array']};
  if(!isRecord(probes))return{ok:false,errors:['probes must be an object']};

  const ids=new Set();
  for(const module of modules){
    const id=normalizeId(module?.id);
    if(!id){errors.push('module id is required');continue;}
    if(ids.has(id))errors.push(`duplicate module id: ${id}`);
    ids.add(id);
  }

  for(const module of modules){
    const id=normalizeId(module?.id);
    if(!id)continue;
    for(const dependencyValue of safeArray(module?.dependsOn)){
      const dependency=normalizeId(dependencyValue);
      if(!ids.has(dependency))errors.push(`unknown dependency for ${id}: ${dependency}`);
    }
    const probe=probes[id];
    if(probe==null){
      errors.push(`module ${id} probe requires an explicit reason`);
      continue;
    }
    if(!isRecord(probe)){
      errors.push(`module ${id} probe must be an object`);
      continue;
    }
    const fallbackReason=String(probe.reason||'').trim();
    if(!probe.launcherSelector&&!String(probe.launcherReason||fallbackReason).trim())errors.push(`module ${id} launcher requires an explicit reason`);
    if(!isRecord(probe.protectedProbe)&&!String(probe.protectedReason||fallbackReason).trim())errors.push(`module ${id} protected probe requires an explicit reason`);
    if(probe.supportsLiveSync!==true&&!String(probe.liveSyncReason||fallbackReason).trim())errors.push(`module ${id} live sync requires an explicit reason`);
  }

  for(const key of Object.keys(probes)){
    const id=normalizeId(key);
    if(!ids.has(id))errors.push(`unknown module probe: ${id}`);
  }
  return{ok:errors.length===0,errors};
}

function unavailable(reason){return{status:'not-applicable',reason:String(reason).trim()};}

export function buildModuleContractPlan({modules=[],probes={}}={}){
  const validation=validateModuleProbeConfig({modules,probes});
  if(!validation.ok)throw new Error(`Invalid module probe config: ${validation.errors.join('; ')}`);

  const contracts=modules.map(module=>{
    const moduleId=normalizeId(module.id);
    const probe=probes[moduleId];
    const fallbackReason=String(probe.reason||'').trim();
    const dependsOn=safeArray(module.dependsOn).map(normalizeId);
    const launcher=probe.launcherSelector
      ?{status:'covered',selector:String(probe.launcherSelector)}
      :unavailable(probe.launcherReason||fallbackReason);
    const protectedSurface=isRecord(probe.protectedProbe)
      ?{status:'covered',probe:{...probe.protectedProbe}}
      :unavailable(probe.protectedReason||fallbackReason);
    const liveSync=probe.supportsLiveSync===true
      ?{status:'covered'}
      :unavailable(probe.liveSyncReason||fallbackReason);
    const checks=[
      {kind:'registry',moduleId},
      ...dependsOn.map(dependency=>({kind:'dependency',dependency})),
      {kind:'launcher',status:launcher.status},
      {kind:'protected',status:protectedSurface.status},
      {kind:'live-sync',status:liveSync.status},
    ];
    return{
      id:`module-${moduleId.toLowerCase().replaceAll('_','-')}`,
      moduleId,
      critical:probe.critical!==false,
      defaultEnabled:Boolean(module.defaultEnabled),
      dependsOn,
      supportsLiveSync:probe.supportsLiveSync===true,
      launcherSelector:probe.launcherSelector||null,
      protectedProbe:isRecord(probe.protectedProbe)?{...probe.protectedProbe}:null,
      launcher,
      protected:protectedSurface,
      liveSync,
      checks,
    };
  });

  const covered=contracts.filter(contract=>contract.launcher.status==='covered'||contract.protected.status==='covered'||contract.liveSync.status==='covered').length;
  const uncovered=contracts.length-covered;
  const uncoveredCritical=contracts.filter(contract=>contract.critical&&contract.launcher.status!=='covered'&&contract.protected.status!=='covered'&&contract.liveSync.status!=='covered').length;
  return{contracts,coverage:{discovered:contracts.length,covered,uncovered,uncoveredCritical}};
}
