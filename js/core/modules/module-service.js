'use strict';

const { MODULES,getModuleDefinition }=require('./module-registry');
const { writeAudit }=require('../audit-log');

class ModuleDisabledError extends Error{constructor(id){super(`Modulo ${id} desativado.`);this.code='MODULE_DISABLED';this.moduleId=id;}}

function createModuleService({db,settings,now=()=>new Date().toISOString()}={}){
  if(!db||!settings)throw new TypeError('db and settings are required.');
  const key=id=>`modules.${id}.enabled`;
  function normalize(id){const value=String(id||'').trim().toUpperCase();if(!getModuleDefinition(value))throw new Error(`Modulo desconhecido: ${value||id}.`);return value;}
  function isEnabled(id){const moduleId=normalize(id);return Boolean(settings.get(key(moduleId),{defaultValue:false}));}
  function list(){return MODULES.map(def=>({...def,enabled:isEnabled(def.id)}));}
  function setEnabled(id,enabled,actor={}){
    const moduleId=normalize(id);const definition=getModuleDefinition(moduleId);if(!['admin','system'].includes(String(actor?.role||'')))throw new Error('Permissao insuficiente para alterar modulo.');
    if(enabled){for(const dependency of definition.dependsOn||[])if(!isEnabled(dependency))throw new Error(`Ative o modulo ${dependency} antes de ${moduleId}.`);}
    if(!enabled){const dependent=MODULES.find(item=>(item.dependsOn||[]).includes(moduleId)&&isEnabled(item.id));if(dependent)throw new Error(`Desative o modulo ${dependent.id} antes de ${moduleId}.`);}
    settings.set(key(moduleId),Boolean(enabled),{scope:'global',actor});
    writeAudit(db,{action:'module.toggle',entity:'module',entityId:moduleId,actor,context:{enabled:Boolean(enabled)}},now);
    return{...definition,enabled:Boolean(enabled)};
  }
  function requireEnabled(id){const moduleId=normalize(id);if(!isEnabled(moduleId))throw new ModuleDisabledError(moduleId);return true;}
  function enabledIds(){return list().filter(m=>m.enabled).map(m=>m.id);}
  return{list,isEnabled,setEnabled,requireEnabled,enabledIds};
}

module.exports={createModuleService,ModuleDisabledError};
