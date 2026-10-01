'use strict';

(() => {
  const root=window;
  if(root.PdvModuleStateSync)return;

  let settingsRefreshScheduled=false;

  function routeContent(){return document.getElementById('route-content');}
  function annotateWorkspace(){
    const content=routeContent();
    if(!content)return null;
    const workspace=content.querySelector('.vertical-page,.restaurant-page,.page')||content.firstElementChild;
    const moduleId=document.body.dataset.activeModuleWorkspace||null;
    if(moduleId)workspace?.setAttribute('data-module-workspace',moduleId);
    else workspace?.removeAttribute('data-module-workspace');
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
    const modules=Array.isArray(detail.catalog)?detail.catalog:[];
    const changed=Array.isArray(detail.changedIds)?detail.changedIds:[];
    annotateWorkspace();
    if(onSettingsPage()&&changed.some(id=>modules.some(module=>module.id===id)&&!document.querySelector(`[data-module-toggle="${id}"]`))){
      reloadSettingsModules();
    }
  }

  root.addEventListener('artisys:modules-state-changed',handleStateChange);
  const content=routeContent();
  if(content&&typeof MutationObserver==='function')new MutationObserver(()=>annotateWorkspace()).observe(content,{childList:true,subtree:true});
  annotateWorkspace();
  root.PdvModuleStateSync=Object.freeze({annotateWorkspace,reloadSettingsModules});
})();
