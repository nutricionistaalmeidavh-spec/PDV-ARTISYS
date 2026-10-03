'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient||root.PdvModuleGate)return;

  const api=new ApiClient();
  const MODULE_SETTING_PATTERN=/^modules\.([A-Z_]+)\.enabled$/;
  const REFRESH_INTERVAL_MS=5000;
  const moduleStates=new Map();
  let moduleCatalog=[];
  let refreshInFlight=null;

  function normalizeId(value){return String(value||'').trim().toUpperCase();}
  function snapshot(){return Object.freeze(Object.fromEntries(moduleStates.entries()));}
  function isEnabled(id){return moduleStates.get(normalizeId(id))===true;}
  function isResolved(id){return moduleStates.has(normalizeId(id));}

  function applyLauncherState(id){
    const moduleId=normalizeId(id);
    if(!moduleId||!isResolved(moduleId))return;
    const enabled=isEnabled(moduleId);
    const currentRoute=document.body.dataset.activeModuleWorkspace;
    if(!enabled&&currentRoute===moduleId){
      const current=moduleCatalog.find(module=>module.id===moduleId);
      const area=current?.area;
      const areaStillAvailable=area?.navigation==='group'&&moduleCatalog.some(module=>module.area?.id===area.id&&module.enabled&&module.accessCapability&&root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,module.accessCapability));
      if(areaStillAvailable)root.PdvVerticalModules?.openWorkspace?.(area.routeId);
      else document.querySelector('#sidebar-nav [data-route="home"]')?.click();
    }
    document.querySelectorAll(`[data-module-open="${moduleId}"], [data-module-nav="${moduleId}"]`).forEach(launcher=>{
      launcher.hidden=!enabled;
      launcher.setAttribute('aria-hidden',enabled?'false':'true');
      if(enabled){launcher.removeAttribute('tabindex');launcher.removeAttribute('aria-disabled');}
      else{launcher.setAttribute('tabindex','-1');launcher.setAttribute('aria-disabled','true');}
    });
  }

  function emitStateChanged(changedIds){
    if(!changedIds.length)return;
    root.dispatchEvent(new CustomEvent('artisys:modules-state-changed',{
      detail:{changedIds:[...changedIds],modules:snapshot(),catalog:moduleCatalog.map(module=>({...module}))}
    }));
  }

  function setEnabled(id,enabled,{emit=true}={}){
    const moduleId=normalizeId(id);
    if(!moduleId)return false;
    const value=Boolean(enabled);
    const changed=!moduleStates.has(moduleId)||moduleStates.get(moduleId)!==value;
    moduleStates.set(moduleId,value);
    moduleCatalog=moduleCatalog.map(module=>module.id===moduleId?{...module,enabled:value}:module);
    applyLauncherState(moduleId);
    if(changed&&emit)emitStateChanged([moduleId]);
    return value;
  }

  function reconcileModules(modules){
    const changedIds=[];
    moduleCatalog=(Array.isArray(modules)?modules:[]).map(module=>({...module,enabled:Boolean(module?.enabled)}));
    for(const module of moduleCatalog){
      const moduleId=normalizeId(module?.id);
      if(!moduleId)continue;
      const value=Boolean(module?.enabled);
      if(!moduleStates.has(moduleId)||moduleStates.get(moduleId)!==value)changedIds.push(moduleId);
      moduleStates.set(moduleId,value);
      applyLauncherState(moduleId);
    }
    emitStateChanged(changedIds);
    return snapshot();
  }

  async function refresh(){
    if(refreshInFlight)return refreshInFlight;
    refreshInFlight=(async()=>{
      try{
        const modules=await api.modules();
        reconcileModules(modules);
      }catch(_error){
        // Keep the last authoritative catalog; a failed refresh never fabricates module state.
      }
      return snapshot();
    })();
    try{return await refreshInFlight;}finally{refreshInFlight=null;}
  }

  root.addEventListener('click',event=>{
    const target=event.target?.closest?.('[data-module-open]');
    if(!target)return;
    const moduleId=normalizeId(target.getAttribute('data-module-open'));
    if(!moduleId||!isResolved(moduleId)||isEnabled(moduleId))return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);

  const originalSaveSetting=ApiClient.prototype.saveSetting;
  if(typeof originalSaveSetting==='function'&&!originalSaveSetting.__moduleGateWrapped){
    const wrappedSaveSetting=async function(key,value,...args){
      const result=await originalSaveSetting.call(this,key,value,...args);
      const match=String(key||'').match(MODULE_SETTING_PATTERN);
      if(match)setEnabled(match[1],Boolean(value));
      return result;
    };
    Object.defineProperty(wrappedSaveSetting,'__moduleGateWrapped',{value:true});
    ApiClient.prototype.saveSetting=wrappedSaveSetting;
  }

  const originalLogin=ApiClient.prototype.login;
  if(typeof originalLogin==='function'&&!originalLogin.__moduleGateWrapped){
    const wrappedLogin=async function(...args){
      const result=await originalLogin.apply(this,args);
      queueMicrotask(()=>{void refresh();});
      return result;
    };
    Object.defineProperty(wrappedLogin,'__moduleGateWrapped',{value:true});
    ApiClient.prototype.login=wrappedLogin;
  }

  root.addEventListener('focus',()=>{void refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  if(typeof root.setInterval==='function')root.setInterval(()=>{void refresh();},REFRESH_INTERVAL_MS);

  root.PdvModuleGate=Object.freeze({refresh,reconcile:reconcileModules,setEnabled,isEnabled,snapshot,catalog:()=>moduleCatalog.map(module=>({...module}))});
  void refresh();
})();
