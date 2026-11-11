'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

test('legacy local user remains valid without email', () => {
  const runtime = createPdvRuntime({ now: () => '2026-09-25T20:00:00.000Z', idFactory: prefix => `${prefix}-legacy` });
  try {
    const user = runtime.catalog.createUser({ username:'legacy', name:'Legado', profileId:'profile-administrator', password:'senha-forte-123' });
    assert.equal(Object.hasOwn(user, 'email'), false);
    assert.equal(runtime.catalog.verifyUserPassword('legacy', 'senha-forte-123').ok, true);
  } finally {
    runtime.close();
  }
});

test('user email is optional, normalized and unique when present', () => {
  const runtime = createPdvRuntime({ now: () => '2026-09-25T20:00:00.000Z', idFactory: prefix => `${prefix}-${Math.random()}` });
  try {
    const user = runtime.catalog.createUser({
      id:'user-email-1', username:'admin1', name:'Admin 1', profileId:'profile-administrator', password:'senha-forte-123', email:'  Admin@Example.COM '
    });
    assert.equal(user.email, 'admin@example.com');
    const raw = runtime.db.prepare('SELECT email,email_normalized FROM users WHERE id=?').get('user-email-1');
    assert.deepEqual({ ...raw }, { email:'admin@example.com', email_normalized:'admin@example.com' });

    assert.throws(() => runtime.catalog.createUser({
      id:'user-email-2', username:'admin2', name:'Admin 2', profileId:'profile-administrator', password:'senha-forte-123', email:'ADMIN@example.com'
    }), /UNIQUE|e-mail|email/i);
  } finally {
    runtime.close();
  }
});
test('login local por nome de usuário ou e-mail usa a mesma senha mesmo sem internet',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    runtime.catalog.createUser({username:'loja-admin',name:'Responsável',profileId:'profile-administrator',email:' Dono@EXAMPLE.com ',password:'senha-forte-123'});
    assert.equal(runtime.catalog.verifyUserPassword('loja-admin','senha-forte-123').ok,true);
    assert.equal(runtime.catalog.verifyUserPassword(' DONO@EXAMPLE.COM ','senha-forte-123').ok,true);
    assert.equal(runtime.catalog.verifyUserPassword('dono@example.com','senha-incorreta').ok,false);
    assert.equal(runtime.catalog.verifyUserPassword('outro@example.com','senha-forte-123').ok,false);
  }finally{runtime.close();}
});

test('login por e-mail não escolhe usuário arbitrário quando há colisão com username',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    runtime.catalog.createUser({username:'first',name:'Primeiro',profileId:'profile-administrator',email:'first@example.com',password:'senha-forte-123'});
    runtime.catalog.createUser({username:'first@example.com',name:'Segundo',profileId:'profile-administrator',email:'second@example.com',password:'senha-forte-456'});
    assert.equal(runtime.catalog.verifyUserPassword('first@example.com','senha-forte-123').ok,false);
    assert.equal(runtime.catalog.verifyUserPassword('first@example.com','senha-forte-456').ok,false);
  }finally{runtime.close();}
});

test('recuperação por chave local também aceita e-mail cadastrado sem depender de serviço externo',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    const owner=runtime.catalog.createUser({username:'owner',name:'Proprietário',profileId:'profile-administrator',email:'owner@example.com',password:'senha-forte-123'});
    const {key}=runtime.localRecovery.issue({userId:owner.id,password:'senha-forte-123'});
    assert.equal(runtime.localRecovery.recover({username:'OWNER@EXAMPLE.COM',key,password:'senha-nova-456'}).userId,owner.id);
    assert.equal(runtime.catalog.verifyUserPassword('owner@example.com','senha-nova-456').ok,true);
    assert.equal(runtime.catalog.verifyUserPassword('owner','senha-forte-123').ok,false);
  }finally{runtime.close();}
});
