'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient||root.PdvRestaurantModuleGate)return;

  const api=new ApiClient();
  const RESTAURANT_SETTING='modules.RESTAURANT.enabled';
  let restaurantEnabled=false;
  let stateResolved=false;

  function applyLauncherState(){
    document.querySelectorAll('[data-restaurant-route]').forEach(launcher=>{
      launcher.hidden = !restaurantEnabled;
      launcher.setAttribute('aria-hidden',restaurantEnabled?'false':'true');
      if(restaurantEnabled)launcher.removeAttribute('tabindex');
      else launcher.setAttribute('tabindex','-1');
    });
  }

  function setRestaurantEnabled(enabled){
    restaurantEnabled=Boolean(enabled);
    stateResolved=true;
    applyLauncherState();
  }

  async function refresh(){
    try{
      const modules=await api.modules();
      const restaurant=Array.isArray(modules)?modules.find(module=>module.id==='RESTAURANT'):null;
      setRestaurantEnabled(Boolean(restaurant?.enabled));
    }catch(_error){
      if(!stateResolved)setRestaurantEnabled(false);
    }
    return restaurantEnabled;
  }

  const observer=new MutationObserver(()=>applyLauncherState());
  observer.observe(document.documentElement||document.body,{childList:true,subtree:true});

  root.addEventListener('click',event=>{
    const target=event.target?.closest?.('[data-restaurant-route]');
    if(!target||restaurantEnabled)return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },true);

  const originalSaveSetting=ApiClient.prototype.saveSetting;
  if(typeof originalSaveSetting==='function'&&!originalSaveSetting.__restaurantModuleGateWrapped){
    const wrappedSaveSetting=async function(key,value,...args){
      const result=await originalSaveSetting.call(this,key,value,...args);
      if(String(key)===RESTAURANT_SETTING)setRestaurantEnabled(Boolean(value));
      return result;
    };
    Object.defineProperty(wrappedSaveSetting,'__restaurantModuleGateWrapped',{value:true});
    ApiClient.prototype.saveSetting=wrappedSaveSetting;
  }

  const originalLogin=ApiClient.prototype.login;
  if(typeof originalLogin==='function'&&!originalLogin.__restaurantModuleGateWrapped){
    const wrappedLogin=async function(...args){
      const result=await originalLogin.apply(this,args);
      queueMicrotask(()=>{void refresh();});
      return result;
    };
    Object.defineProperty(wrappedLogin,'__restaurantModuleGateWrapped',{value:true});
    ApiClient.prototype.login=wrappedLogin;
  }

  root.PdvRestaurantModuleGate=Object.freeze({
    refresh,
    setEnabled:setRestaurantEnabled,
    isEnabled:()=>restaurantEnabled
  });

  applyLauncherState();
  void refresh();
})();
