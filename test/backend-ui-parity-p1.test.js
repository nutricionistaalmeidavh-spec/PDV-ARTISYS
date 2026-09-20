'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createVerticalRouter}=require('../server/vertical-router');
const {createE48E54Router}=require('../server/e48-e54-router');

function request({method='GET',path='/',token='',body=null}={}){
  const req=Readable.from(body==null?[]:[Buffer.from(JSON.stringify(body))]);
  req.method=method;req.url=path;req.headers={host:'localhost'};
  if(token)req.headers.authorization=`Bearer ${token}`;
  return req;
}
function response(){
  return{
    statusCode:0,headers:null,payload:null,
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;},
    end(value){this.payload=value?JSON.parse(String(value)):null;}
  };
}
async function call(handler,input){const res=response();await handler(request(input),res);return res;}

function runtime(calls){
  return{
    logger:{log(){}},
    modules:{list(){return[];}},
    restaurantSettlement:{
      createEqualSettlement(id,data,actor){calls.push({op:'equal',id,data,actor});return{settlement:{id:'settlement-1'}};},
      cancelOrderItem(id,reason,actor){calls.push({op:'cancel-item',id,reason,actor});return{orderItemId:id,cancelled:true};}
    },
    marketBakery:{
      getBakeryOrder(id){calls.push({op:'bakery-get',id});return{id,status:'OPEN'};},
      cancelBakeryOrder(id,reason,actor){calls.push({op:'bakery-cancel',id,reason,actor});return{id,status:'CANCELLED'};}
    },
    services:{
      updateAppointmentStatus(id,status,actor){calls.push({op:'service-status',id,status,actor});return{id,status};}
    },
    workshop:{
      addItem(id,data,actor){calls.push({op:'workshop-item',id,data,actor});return{id,status:'OPEN',items:[]};}
    }
  };
}

function sessions(){return new Map([['token-manager',{userId:'manager-1',role:'manager',terminalId:'PDV-01',expiresAt:Date.now()+60_000}]]);}

test('vertical P1 routes reject unauthenticated access when sharing the desktop session store',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'GET',path:'/api/v1/vertical/bakery/orders/b1'});
  assert.equal(res.statusCode,401);
  assert.match(res.payload.error,/Sessao invalida/i);
  assert.equal(calls.length,0);
});

test('restaurant equal split receives the authenticated manager actor and terminal',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'POST',path:'/api/v1/vertical/restaurant/sessions/session-1/settlements/equal',token:'token-manager',body:{parts:2,operatorId:'manager-1'}});
  assert.equal(res.statusCode,201);
  assert.equal(calls[0].op,'equal');
  assert.equal(calls[0].data.terminalId,'PDV-01');
  assert.deepEqual(calls[0].actor,{userId:'manager-1',role:'manager',terminalId:'PDV-01'});
});

test('manager identity reaches protected restaurant item cancellation',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'POST',path:'/api/v1/vertical/restaurant/order-items/item-1/cancel',token:'token-manager',body:{reason:'duplicado'}});
  assert.equal(res.statusCode,200);
  assert.equal(calls[0].actor.role,'manager');
  assert.equal(calls[0].reason,'duplicado');
});

test('bakery order lookup and cancellation are exposed through the vertical HTTP boundary',async()=>{
  const calls=[];const handler=createVerticalRouter({runtime:runtime(calls),sessionStore:sessions()});
  const lookup=await call(handler,{method:'GET',path:'/api/v1/vertical/bakery/orders/b1',token:'token-manager'});
  assert.equal(lookup.statusCode,200);assert.equal(lookup.payload.id,'b1');
  const cancelled=await call(handler,{method:'POST',path:'/api/v1/vertical/bakery/orders/b1/cancel',token:'token-manager',body:{reason:'cliente desistiu'}});
  assert.equal(cancelled.statusCode,200);assert.equal(cancelled.payload.status,'CANCELLED');
  assert.deepEqual(calls.map(item=>item.op),['bakery-get','bakery-cancel']);
});

test('services and workshop final vertical routes reject requests without an authenticated desktop session',async()=>{
  const calls=[];const handler=createE48E54Router({runtime:runtime(calls),sessionStore:sessions()});
  const res=await call(handler,{method:'PATCH',path:'/api/v1/vertical/services/appointments/a1/status',body:{status:'IN_PROGRESS'}});
  assert.equal(res.statusCode,401);
  assert.match(res.payload.error,/Sessao invalida/i);
  assert.equal(calls.length,0);
});

test('services and workshop final vertical routes receive the logged-in manager actor',async()=>{
  const calls=[];const handler=createE48E54Router({runtime:runtime(calls),sessionStore:sessions()});
  let res=await call(handler,{method:'PATCH',path:'/api/v1/vertical/services/appointments/a1/status',token:'token-manager',body:{status:'IN_PROGRESS'}});
  assert.equal(res.statusCode,200);
  res=await call(handler,{method:'POST',path:'/api/v1/vertical/workshop/orders/os1/items',token:'token-manager',body:{kind:'LABOR',serviceId:'srv1',quantity:1}});
  assert.equal(res.statusCode,201);
  assert.equal(calls[0].actor.role,'manager');
  assert.equal(calls[1].actor.userId,'manager-1');
  assert.equal(calls[1].actor.terminalId,'PDV-01');
});

test('extra workspace observer becomes idempotent before mutating an already-bound button',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/vertical-parity-p1.js'),'utf8');
  const start=source.indexOf('function mountExtraWorkspaceEntries()');
  const end=source.indexOf('async function mountPizzeria()',start);
  assert.ok(start>=0&&end>start,'mountExtraWorkspaceEntries must exist');
  const block=source.slice(start,end);
  const guard=block.indexOf("if(button.dataset.parityWorkspaceBound==='1')return;");
  const disableMutation=block.indexOf('button.disabled=false;');
  const labelMutation=block.indexOf("replaceChildren(document.createTextNode('Abrir módulo'))");
  assert.ok(guard>=0,'bound guard must exist');
  assert.ok(disableMutation>=0&&labelMutation>=0,'workspace button mutations must exist');
  assert.ok(guard<disableMutation&&guard<labelMutation,'bound guard must run before DOM mutations to avoid MutationObserver feedback loops');
});
