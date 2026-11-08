'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');
const {firstUseSteps,shouldOfferAutomatically,tourForUser} = require('../desktop/renderer/first-use-guide-model');
const {createVerticalRouter} = require('../server/vertical-router');

test('progresso vem dos dados reais e nao de preferencias locais', () => {
  const initial = firstUseSteps({onboarding:{completed:false},products:[],cashSession:null,sales:[]});
  assert.equal(initial.completed,0);
  assert.equal(initial.total,3);
  assert.equal(initial.steps.find(step=>step.id==='sale').status,'optional');

  const ready = firstUseSteps({
    onboarding:{completed:true},products:[{id:'p1',active:true}],
    cashSession:{id:'cash-1',status:'OPEN'},
    sales:[{id:'sale-1',status:'COMPLETED'}]
  });
  assert.equal(ready.completed,3);
  assert.equal(ready.steps.find(step=>step.id==='sale').status,'done');
});

test('falha ao consultar dados nao gera falso pendente ou concluido', () => {
  const status = firstUseSteps({onboarding:null,products:null,cashSession:undefined,sales:null});
  assert.equal(status.completed,0);
  assert.equal(status.steps.filter(step=>step.status==='unknown').length,3);
});

test('instalacao existente com operacoes nunca recebe abertura automatica', () => {
  assert.equal(shouldOfferAutomatically({onboarding:{completed:false},products:[],sales:[]}),true);
  assert.equal(shouldOfferAutomatically({onboarding:{completed:true},products:[],sales:[]}),false);
  assert.equal(shouldOfferAutomatically({onboarding:{completed:false},products:[{id:'p1'}],sales:[]}),false);
  assert.equal(shouldOfferAutomatically({onboarding:{completed:false},products:[],sales:[{id:'s1'}]}),false);
  assert.equal(shouldOfferAutomatically({onboarding:null,products:[],sales:[]}),false);
});

test('tour respeita rotas autorizadas e areas ativadas', () => {
  const result=tourForUser(route=>route!=='settings'&&route!=='FOOD', [{id:'FOOD',enabled:true}]);
  assert.ok(result.some(item=>item.route==='checkout'));
  assert.ok(!result.some(item=>item.route==='settings'));
  assert.ok(!result.some(item=>item.route==='FOOD'));
  assert.ok(tourForUser(()=>true,[{id:'FOOD',enabled:false}]).every(item=>item.route!=='FOOD'));
});

test('guia esta ligado a Home atual, ajuda e a lifecycle sem observers', () => {
  const base=path.join(__dirname,'..','desktop','renderer');
  const ui=fs.readFileSync(path.join(base,'first-use-guide-ui.js'),'utf8');
  const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
  assert.match(html,/first-use-guide-model\.js/);
  assert.match(html,/first-use-guide-ui\.js/);
  assert.match(html,/first-use-guide\.css/);
  assert.match(ui,/classic-home-grid/);
  assert.match(ui,/route:mounted/);
  assert.match(ui,/auth:hidden/);
  assert.match(ui,/PdvAppNavigation/);
  assert.match(ui,/Ajuda/);
  assert.match(ui,/data-settings-category/);
  assert.doesNotMatch(ui,/settings:select/);
  assert.doesNotMatch(ui,/MutationObserver/);
});

async function dispatch(router,method,url,payload,token='valid') {
  const chunks=payload===undefined?[]:[Buffer.from(JSON.stringify(payload))];
  const request=Readable.from(chunks);
  request.method=method;
  request.url=url;
  request.headers={host:'localhost',authorization:'Bearer '+token};
  const response={status:0,body:'',writeHead(status){this.status=status;},end(content){this.body=content;}};
  const handled=await router(request,response);
  return {handled,status:response.status,payload:JSON.parse(response.body)};
}

test('API de onboarding autoriza leitura e salva apenas apos POST explicito', async()=>{
  let written=0;
  const sessions=new Map([
    ['valid',{userId:'admin',terminalId:'PDV-01',expiresAt:Date.now()+60000}],
    ['restricted',{userId:'cashier',terminalId:'PDV-01',expiresAt:Date.now()+60000}]
  ]);
  const runtime={
    catalog:{getUser:()=>({active:true,name:'Operador'})},
    authorization:{require({principal,capability}){
      if(capability==='modules.manage'&&principal.id!=='admin'){
        const error=new Error('Permissao insuficiente.');error.statusCode=403;throw error;
      }
    }},
    modules:{list:()=>[{id:'FOOD',enabled:true}]},
    onboarding:{
      SEGMENTS:{GENERIC:[],FOOD:['FOOD'],WHOLESALE:['WHOLESALE']},
      getState:()=>({completed:written>0,businessName:written?'Loja Teste':null}),
      recommend:segment=>({segment,moduleIds:segment==='FOOD'?['FOOD']:[]}),
      complete:input=>{written++;return {completed:true,businessName:input.businessName};}
    },
    logger:{log(){}}
  };
  const router=createVerticalRouter({runtime,sessionStore:sessions});
  const read=await dispatch(router,'GET','/api/v1/vertical/onboarding');
  assert.equal(read.status,200);
  assert.equal(read.payload.completed,false);
  assert.equal(written,0);
  const forbidden=await dispatch(router,'GET','/api/v1/vertical/onboarding',undefined,'restricted');
  assert.equal(forbidden.status,403);
  const recommended=await dispatch(router,'GET','/api/v1/vertical/onboarding/recommend?segment=FOOD');
  assert.deepEqual(recommended.payload.moduleIds,['FOOD']);
  assert.equal(written,0);
  const saved=await dispatch(router,'POST','/api/v1/vertical/onboarding/complete',
    {businessName:'Loja Teste',segment:'FOOD',moduleIds:['FOOD']});
  assert.equal(saved.status,200);
  assert.equal(written,1);
  assert.equal(saved.payload.completed,true);
  const denied=await dispatch(router,'POST','/api/v1/vertical/onboarding/complete',
    {businessName:'Outra',segment:'FOOD',moduleIds:[]},'restricted');
  assert.equal(denied.status,403);
  assert.equal(written,1);
});
