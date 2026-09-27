'use strict';

(() => {
  const root=window;
  if(root.PdvModuleStateSync)return;

  const MODULE_HEADINGS=Object.freeze({
    RESTAURANT:'Restaurante',
    PIZZERIA:'Pizzaria',
    DELIVERY:'Delivery',
    FAST_FOOD:'Fast-food / Lanchonete',
    MARKET_BAKERY:'Mercado / Conveniência / Padaria',
    RETAIL:'Varejo',
    SERVICES:'Serviços',
    WORKSHOP:'Oficina',
    SELF_SERVICE:'Autoatendimento'
  });
  const HEADING_TO_ID=new Map(Object.entries(MODULE_HEADINGS).map(([id,heading])=>[heading,id]));
  let settingsRefreshScheduled=false;

  function routeContent(){return document.getElementById('route-content');}
  function annotateWorkspace(){
    const content=routeContent();
    if(!content)return null;
    const heading=content.querySelector('h1')?.textContent?.trim();
    const moduleId=HEADING_TO_ID.get(heading)||null;
    if(!moduleId)return null;
    const workspace=content.querySelector('.vertical-page,.restaurant-page,.page')||content.firstElementChild;
    workspace?.setAttribute('data-module-workspace',moduleId);
    return moduleId;
  }
  function onSettingsPage(){
    const content=routeContent();
    return content?.querySelector('.ops-head h1')?.textContent?.trim()==='Configurações';
  }
  function reloadSettingsModules(){
    if(settingsRefreshScheduled||!onSettingsPage())return;
    settingsRefreshScheduled=true;
    root.PdvOperationalUi?.showRoute?.('settings');
    root.setTimeout?.(()=>{
      settingsRefreshScheduled=false;
      document.getElementById('ops-load-establishment-modules')?.click();
    },0);
  }
  function handleStateChange(event){
    const detail=event?.detail||{};
    const modules=detail.modules&&typeof detail.modules==='object'?detail.modules:{};
    const changed=Array.isArray(detail.changedIds)?detail.changedIds:[];
    const activeId=annotateWorkspace();
    if(activeId&&changed.includes(activeId)&&modules[activeId]===false){
      root.PdvOperationalUi?.showRoute?.('settings');
      root.setTimeout?.(()=>document.getElementById('ops-load-establishment-modules')?.click(),0);
      return;
    }
    if(onSettingsPage()&&changed.some(id=>modules[id]===true&&!document.querySelector(`[data-module-open="${id}"]`))){
      reloadSettingsModules();
    }
  }

  root.addEventListener('artisys:modules-state-changed',handleStateChange);
  const content=routeContent();
  if(content&&typeof MutationObserver==='function')new MutationObserver(()=>annotateWorkspace()).observe(content,{childList:true,subtree:true});
  annotateWorkspace();
  root.PdvModuleStateSync=Object.freeze({annotateWorkspace,reloadSettingsModules});
})();
