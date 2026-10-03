'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  AuthorizationError,
  createAuthorizationService,
  normalizePrincipal
}=require('../js/core/auth/authorization-service');
const {
  createLegacyPermissionResolver,
  principalFromLegacyActor
}=require('../js/core/auth/legacy-authorization-adapter');

test('P2 canonical principals distinguish humans devices system and public resources',()=>{
  assert.deepEqual(normalizePrincipal({kind:'human',id:'u1'}),{kind:'human',id:'u1'});
  assert.deepEqual(
    normalizePrincipal({kind:'device',id:'d1',surface:'KITCHEN',userId:'u2'}),
    {kind:'device',id:'d1',surface:'kitchen',userId:'u2'}
  );
  assert.deepEqual(normalizePrincipal({kind:'system'}),{kind:'system',id:'system'});
  assert.deepEqual(
    normalizePrincipal({kind:'public-resource',id:'table-token',resourceType:'table',resourceId:'t1'}),
    {kind:'public-resource',id:'table-token',resourceType:'table',resourceId:'t1'}
  );
  assert.equal(normalizePrincipal(null),null);
  assert.equal(normalizePrincipal({kind:'human'}),null);
  assert.equal(normalizePrincipal({kind:'unknown',id:'x'}),null);
});

test('P2 authorization service fails closed and system only bypasses known capabilities',()=>{
  const authorization=createAuthorizationService({resolvePermissions:()=>['sales.view']});
  assert.equal(authorization.can({principal:{kind:'human',id:'u1'},capability:'sales.view'}),true);
  assert.equal(authorization.can({principal:{kind:'human',id:'u1'},capability:'sales.cancel'}),false);
  assert.equal(authorization.can({principal:{kind:'human',id:'u1'},capability:'made.up'}),false);
  assert.equal(authorization.can({principal:{kind:'system'},capability:'sales.cancel'}),true);
  assert.equal(authorization.can({principal:{kind:'system'},capability:'made.up'}),false);
  assert.equal(authorization.can({principal:null,capability:'sales.view'}),false);
});

test('P2 authorization composes capability with surface and resource policies',()=>{
  const authorization=createAuthorizationService({
    resolvePermissions:principal=>principal.kind==='device'?['kitchen.view','kitchen.update_status']:['sales.view'],
    surfacePolicy:({principal,capability,surface})=>principal.kind!=='device'||(principal.surface===surface&&capability.startsWith('kitchen.')),
    resourcePolicy:({resource})=>!resource||resource.allowed===true
  });
  const kitchen={kind:'device',id:'kds-1',surface:'kitchen'};
  assert.equal(authorization.can({principal:kitchen,capability:'kitchen.view',surface:'kitchen',resource:{allowed:true}}),true);
  assert.equal(authorization.can({principal:kitchen,capability:'kitchen.view',surface:'waiter',resource:{allowed:true}}),false);
  assert.equal(authorization.can({principal:kitchen,capability:'kitchen.view',surface:'kitchen',resource:{allowed:false}}),false);
});

test('P2 require returns authorization decision or throws a stable 403 error',()=>{
  const authorization=createAuthorizationService({resolvePermissions:()=>[]});
  assert.throws(
    ()=>authorization.require({principal:{kind:'human',id:'u1'},capability:'finance.manage'}),
    error=>error instanceof AuthorizationError&&error.statusCode===403&&error.code==='AUTHORIZATION_DENIED'&&error.capability==='finance.manage'
  );
  assert.equal(authorization.require({principal:{kind:'system'},capability:'finance.manage'}),true);
});

test('P2 legacy adapter keeps role knowledge outside the canonical authorization core',()=>{
  const resolvePermissions=createLegacyPermissionResolver();
  const admin=principalFromLegacyActor({userId:'a1',role:'admin'});
  const manager=principalFromLegacyActor({userId:'m1',role:'manager'});
  const cashier=principalFromLegacyActor({userId:'c1',role:'cashier'});
  const kitchen=principalFromLegacyActor({userId:null,role:'mobile-kitchen'},{device:{id:'kds1',deviceType:'KITCHEN'}});
  const system=principalFromLegacyActor({userId:'setup',role:'system'});

  assert.deepEqual(admin,{kind:'human',id:'a1',legacyRole:'admin'});
  assert.equal(resolvePermissions(admin).includes('profiles.edit'),true);
  assert.equal(resolvePermissions(manager).includes('reports.view'),true);
  assert.equal(resolvePermissions(manager).includes('profiles.edit'),false);
  assert.equal(resolvePermissions(cashier).includes('sales.create'),true);
  assert.equal(resolvePermissions(cashier).includes('finance.manage'),false);
  assert.deepEqual(kitchen,{kind:'device',id:'kds1',surface:'kitchen',userId:null,legacyDeviceType:'KITCHEN'});
  assert.equal(resolvePermissions(kitchen).includes('kitchen.update_status'),true);
  assert.deepEqual(system,{kind:'system',id:'system'});
});

test('P2 public resource principals receive only explicit public capabilities',()=>{
  const resolvePermissions=createLegacyPermissionResolver();
  const publicTable={kind:'public-resource',id:'opaque-token',resourceType:'table',resourceId:'t1'};
  assert.equal(resolvePermissions(publicTable).includes('public.menu.view'),true);
  assert.equal(resolvePermissions(publicTable).includes('public.order.create'),true);
  assert.equal(resolvePermissions(publicTable).includes('users.view'),false);
});
