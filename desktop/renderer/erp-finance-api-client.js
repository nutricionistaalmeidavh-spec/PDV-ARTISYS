'use strict';
(() => {
  const root=window;const ApiClient=root.PdvApiClient?.ApiClient;if(!ApiClient)return;
  const p=ApiClient.prototype;
  p.financeDreGroups=function(includeInactive=false){return this.request(`/api/v1/erp-finance/dre-groups${includeInactive?'?includeInactive=true':''}`);};
  p.financeCategories=function(includeInactive=false){return this.request(`/api/v1/erp-finance/categories${includeInactive?'?includeInactive=true':''}`);};
  p.saveFinanceCategory=function(body){return this.request('/api/v1/erp-finance/categories',{method:'POST',body});};
  p.costCenters=function(includeInactive=false){return this.request(`/api/v1/erp-finance/cost-centers${includeInactive?'?includeInactive=true':''}`);};
  p.saveCostCenter=function(body){return this.request('/api/v1/erp-finance/cost-centers',{method:'POST',body});};
  p.updateFinanceDimensions=function(id,body){return this.request(`/api/v1/erp-finance/entries/${encodeURIComponent(id)}/dimensions`,{method:'PATCH',body});};
  p.erpDashboard=function(filters={}){return this.request(`/api/v1/erp-finance/dashboard${this.params(filters)}`);};
  p.erpDre=function(filters={}){return this.request(`/api/v1/erp-finance/dre${this.params(filters)}`);};
  p.erpCashflow=function(filters={}){return this.request(`/api/v1/erp-finance/cashflow${this.params(filters)}`);};
  p.erpCompare=function(filters={}){return this.request(`/api/v1/erp-finance/compare${this.params(filters)}`);};
  p.erpDrilldown=function(entryId){return this.request(`/api/v1/erp-finance/drilldown${this.params({entryId})}`);};
  const model=root.PdvUiModel;
  if(model&&!model.HOME_TILES.some(tile=>tile.route==='management')){
    root.PdvUiModel={...model,HOME_TILES:Object.freeze([...model.HOME_TILES,{key:'management',label:'Gestão',description:'Resultado, DRE e fluxo de caixa',shortcut:'',route:'management',tone:'cyan',icon:'chart'}])};
  }
})();
