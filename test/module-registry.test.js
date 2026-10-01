'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {AREAS,MODULES,getModuleDefinition,getAreaDefinition}=require('../js/core/modules/module-registry');
const {createModuleService}=require('../js/core/modules/module-service');

test('module registry is the complete source for identity, access, routing, icons, and family',()=>{
  assert.deepEqual(Object.keys(AREAS),['FOOD','RETAIL','SERVICES']);
  assert.equal(new Set(MODULES.map(module=>module.id)).size,MODULES.length);
  for(const module of MODULES){
    assert.ok(module.name&&module.description&&module.routeId&&module.icon);
    assert.ok(getAreaDefinition(module.area.id));
    assert.ok(module.accessRoles.includes('admin'));
    assert.ok(module.manageRoles.includes('admin'));
    for(const dependency of module.dependsOn)assert.ok(getModuleDefinition(dependency));
  }
  assert.equal(getAreaDefinition('FOOD').navigation,'group');
  assert.equal(getModuleDefinition('PIZZERIA').area.id,'FOOD');
  assert.equal(getModuleDefinition('WORKSHOP'),null);
});

test('module service returns the same route/access metadata used to build navigation',()=>{
  const values=new Map();
  const service=createModuleService({db:{},settings:{get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue,set:(key,value)=>values.set(key,value)}});
  const listed=service.list();
  const pizza=listed.find(module=>module.id==='PIZZERIA');
  assert.equal(pizza.routeId,'PIZZERIA');
  assert.equal(pizza.area.routeId,'FOOD');
  assert.ok(pizza.accessRoles.includes('manager'));
  assert.ok(pizza.manageRoles.includes('admin'));
  assert.throws(()=>service.setEnabled('PIZZERIA',true,{role:'cashier'}),/Permissao insuficiente/);
  assert.equal(service.setEnabled('PIZZERIA',true,{role:'admin'}).enabled,true);
});
