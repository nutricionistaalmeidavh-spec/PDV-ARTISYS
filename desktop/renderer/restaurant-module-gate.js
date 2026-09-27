'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient||root.PdvModuleGate)return;

  const api=new ApiClient();
  const MODULE_SETTING_PATTERN=/^modules\.([A-Z_]+)\.enabled$/;
  const GATE_STYLE_ID='restaurant-module-gate-style';
  const REFRESH_INTERVAL_MS=5000;
  const moduleStates=new Map();

  function ensureGateStyle(){
    if(document.getElementById(GATE_STYLE_ID))return;
    const style=document.createElement('style');
    style.id=GATE_STYLE_ID;
    style.textContent='html[data-restaurant-module-enabled="false"] [data-restaurant-route]{display:none !important}';
    (document.head||document.documentElement).appendChild(style);
  }

  function normalizeId(value){return String(value||'').trim().toUpperCase();}
  function snapshot(){return Object.freeze(Object.fromEntries(moduleStates.entries()));}
  function isEnabled(id){return moduleStates.get(normalizeId(id))===true;}
  function isResolved(id){return moduleStates.has(normalizeId(id));}

  function applyLauncherState(id){
    const moduleId=normalizeId(id);
    if(!moduleId||!isResolved(moduleId))return;
    const enabled=isEnabled(moduleId);
    if(moduleId==='RESTAURANT'){
      ensureGateStyle();
      document.documentElement?.setAttribute('data-restaurant-module-enabled',enabled?'true':'false');
      document.querySelectorAll('[data-restaurant-route]').forEach(launcher=>{
        launcher.hidden=!enabled;
        launcher.setAttribute('aria-hidden',enabled?'false':'true');
        if(enabled)launcher.removeAttribute('tabindex');
        else launcher.setAttribute('tabindex','-1');
      });
    }
    document.querySelectorAll(`[data-module-open="${moduleId}"]`).forEach(launcher=>{
      launcher.hidden=!enabled;
      launcher.setAttribute('aria-hidden',enabled?'false':'true');
      if(enabled){launcher.removeAttribute('tabindex');launcher.removeAttribute('aria-disabled');}
      else{launcher.setAttribute('tabindex','-1');launcher.setAttribute('aria-disabled','true');}
    });
  }

  function emitStateChanged(changedIds){
    if(!changedIds.length)return;
    root.dispatchEvent(new CustomEvent('artisys:modules-state-changed',{
      detail:{changedIds:[...changedIds],modules:snapshot()}
    }));
  }

  function setEnabled(id,enabled,{emit=true}={}){
    const moduleId=normalizeId(id);
    if(!moduleId)return false;
    const value=Boolean(enabled);
    const changed=!moduleStates.has(moduleId)||moduleStates.get(moduleId)!==value;
    moduleStates.set(moduleId,value);
    applyLauncherState(moduleId);
    if(changed&&emit)emitStateChanged([moduleId]);
    return value;
  }

  function reconcileModules(modules){
    const changedIds=[];
    for(const module of Array.isArray(modules)?modules:[]){
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
    try{
      const modules=await api.modules();
      reconcileModules(modules);
      // Keep the Restaurant lookup explicit for backwards-compatible diagnostics/tests.
      const restaurant=Array.isArray(modules)?modules.find(module=>module.id==='RESTAURANT'):null;
      if(restaurant&&!isResolved('RESTAURANT'))setEnabled('RESTAURANT',Boolean(restaurant?.enabled));
    }catch(_error){
      // Restaurant historically fails closed. Unknown optional modules stay unresolved rather than being invented as disabled.
      if(!isResolved('RESTAURANT'))setEnabled('RESTAURANT',false);
    }
    return snapshot();
  }

  root.addEventListener('click',event=>{
    const target=event.target?.closest?.('[data-restaurant-route],[data-module-open]');
    if(!target)return;
    const moduleId=target.matches?.('[data-restaurant-route]')?'RESTAURANT':normalizeId(target.getAttribute('data-module-open'));
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

  root.PdvModuleGate=Object.freeze({refresh,setEnabled,isEnabled,snapshot});
  root.PdvRestaurantModuleGate=Object.freeze({
    refresh,
    setEnabled:enabled=>setEnabled('RESTAURANT',enabled),
    isEnabled:()=>isEnabled('RESTAURANT'),
    snapshot:()=>({enabled:isEnabled('RESTAURANT'),resolved:isResolved('RESTAURANT')})
  });

  ensureGateStyle();
  setEnabled('RESTAURANT',false,{emit:false});
  void refresh();
})();
