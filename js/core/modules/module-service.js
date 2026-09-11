'use strict';

const { MODULES,getModuleDefinition }=require('./module-registry');

class ModuleDisabledError extends Error{constructor(id){super(`Modulo ${id} desativado.`);this.code='MODULE_DISABLED';this.moduleId=id;}}

function createModuleService({db,settings,now=()=>new Date().toISOString()}={}){
  if(!db||!settings)throw new TypeError('db and settings are required.');
  const key=id=>`modules.${id}.enabled`;
  function normalize(id){const value=String(id||'').trim().toUpperCase();if(!getModuleDefinition(value))throw new Error(`Modulo desconhecido: ${value||id}.`);return value;}
  function isEnabled(id){const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);return Boolean(settings.get(key(moduleId),{defaultValue:Boolean(definition.defaultEnabled)}));}
  function list(){return MODULES.map(def=>({...def,enabled:isEnabled(def.id)}));}
  function setEnabled(id,enabled,actor={}){
    const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);if(!['admin','system'].includes(String(actor?.role||'')))throw new Error('Permissao insuficiente para alterar modulo.');
    const target=Boolean(enabled);
    if(target){
      const missing=(definition.dependsOn||[]).filter(dependency=>!isEnabled(dependency));
      if(missing.length)throw new Error(`Modulo ${moduleId} depende de ${missing.join(', ')}.`);
    }else{
      const dependents=MODULES.filter(candidate=>candidate.id!==moduleId&&(candidate.dependsOn||[]).includes(moduleId)&&isEnabled(candidate.id));
      if(dependents.length)throw new Error(`Nao e possivel desativar ${moduleId}; modulo(s) dependente(s): ${dependents.map(item=>item.id).join(', ')}.`);
    }
    settings.set(key(moduleId),target,{scope:'global',actor});
    return{...definition,enabled:target};
  }
  function requireEnabled(id){const moduleId=normalize(id);if(!isEnabled(moduleId))throw new ModuleDisabledError(moduleId);return true;}
  function enabledIds(){return list().filter(m=>m.enabled).map(m=>m.id);}
  return{list,isEnabled,setEnabled,requireEnabled,enabledIds};
}

module.exports={createModuleService,ModuleDisabledError};
