'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {AREAS,MODULES,getModuleDefinition,getAreaDefinition}=require('../js/core/modules/module-registry');
const {createModuleService}=require('../js/core/modules/module-service');

test('module registry exposes only flows that materially change the operation',()=>{
  assert.deepEqual(Object.keys(AREAS),['FOOD','WHOLESALE','SERVICES']);
  assert.deepEqual(MODULES.map(module=>module.id),['FOOD','WHOLESALE','SERVICES']);
  assert.equal(new Set(MODULES.map(module=>module.id)).size,MODULES.length);
  for(const module of MODULES){
    assert.ok(module.name&&module.description&&module.routeId&&module.icon);
    assert.ok(getAreaDefinition(module.area.id));
    assert.ok(module.accessRoles.includes('admin'));
    assert.ok(module.manageRoles.includes('admin'));
    for(const dependency of module.dependsOn)assert.ok(getModuleDefinition(dependency));
  }
  assert.equal(getAreaDefinition('FOOD').navigation,'module');
  assert.equal(getModuleDefinition('FOOD').name,'Alimentação');
  assert.equal(getModuleDefinition('WHOLESALE').name,'Atacado');
  assert.equal(getModuleDefinition('WHOLESALE').defaultEnabled,false);
  for(const legacy of ['RESTAURANT','PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RETAIL','SELF_SERVICE','WORKSHOP'])assert.equal(getModuleDefinition(legacy),null);
});

test('module service returns the same route/access metadata used to build navigation',()=>{
  const values=new Map();
  const service=createModuleService({db:{},settings:{get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue,set:(key,value)=>values.set(key,value)}});
  const listed=service.list();
  const food=listed.find(module=>module.id==='FOOD');
  const wholesale=listed.find(module=>module.id==='WHOLESALE');
  assert.equal(food.routeId,'FOOD');
  assert.equal(food.area.routeId,'FOOD');
  assert.equal(food.enabled,true);
  assert.ok(food.accessRoles.includes('manager'));
  assert.ok(food.manageRoles.includes('admin'));
  assert.equal(wholesale.enabled,false);
  assert.equal(wholesale.routeId,'WHOLESALE');
  assert.throws(()=>service.setEnabled('FOOD',false,{role:'cashier'}),/Permissao insuficiente/);
  assert.equal(service.setEnabled('FOOD',false,{role:'admin'}).enabled,false);
});
