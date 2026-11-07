'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('três rotas financeiras registradas e parser CSV suporta aspas, vírgulas e BOM',()=>{
  const routes=[];
  const window={
    PdvApiClient:{ApiClient:class {params(){return'';}request(){}initialize(){return Promise.resolve();}}},
    PdvRouteRegistry:{register(route,owner){routes.push({route,owner});},updated(){}},
    PdvBusinessDate:{localBusinessDate:()=> '2026-11-07'},
    PdvAccessPolicy:{hasCapability:()=>true},PdvCurrentAccess:{permissions:['finance.view','finance.manage','finance.settle']},
    ArtisysUxComponents:{openFormDialog:()=>Promise.resolve({confirmed:false})},
    PdvFinanceOperationsUi:{navigation:()=>'',bindNavigation:()=>{}}
  };
  const document={getElementById:()=>({innerHTML:''}),body:{dataset:{activeRoute:'finance-kanban'}}};
  const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/finance-workspace-ui.js'),'utf8');
  vm.runInNewContext(source,{window,document,console,Blob,URL,setTimeout,FormData});
  assert.deepEqual(routes.map(r=>r.route),['finance-sheets','finance-bi','finance-kanban']);
  const rows=window.PdvFinanceWorkspaceUi.csvEntries('\uFEFFtipo;descricao;valor_centavos;vencimento;categoria\nPAYABLE;"Aluguel; loja";12550;2026-11-10;Despesas\nRECEIVABLE;"Cliente ""VIP""";19990;07/11/2026;Receitas');
  assert.equal(rows.length,2);
  assert.equal(rows[0].description,'Aluguel; loja');
  assert.equal(rows[0].amountCents,12550);
  assert.equal(rows[1].description,'Cliente "VIP"');
  assert.equal(rows[1].dueAt,'2026-11-07');
  assert.throws(()=>window.PdvFinanceWorkspaceUi.csvEntries('tipo;descricao;valor_centavos;vencimento\nPAYABLE;Item;-100;2026-11-05'),/invalido|inválido/i);
});
