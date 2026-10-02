'use strict';

(() => {
  const root=window;
  if(root.PdvModuleStateSync)return;
  const lifecycle=root.PdvUiLifecycle;
  const routeRegistry=root.PdvRouteRegistry;
  if(!lifecycle||!routeRegistry)return;

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
    queueMicrotask(()=>{
      const card=document.getElementById('ops-establishment-modules-card');
      if(card){
        root.PdvVerticalModules?.renderSettingsModules?.(card);
        settingsRefreshScheduled=false;
        return;
      }
      Promise.resolve(routeRegistry.render('settings')).finally(()=>{
        root.setTimeout?.(()=>{
          root.PdvVerticalModules?.renderSettingsModules?.();
          settingsRefreshScheduled=false;
        },0);
      });
    });
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
  lifecycle.on('route:mounted',()=>annotateWorkspace());
  lifecycle.on('route:updated',()=>annotateWorkspace());
  lifecycle.on('surface:mounted',()=>annotateWorkspace());
  annotateWorkspace();
  root.PdvModuleStateSync=Object.freeze({annotateWorkspace,reloadSettingsModules});
})();
