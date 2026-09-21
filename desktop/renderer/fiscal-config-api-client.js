'use strict';
(function attach(root,factory){root.FiscalConfigApi=factory(root);})(window,function(root){
 const {ApiClient}=root.PdvApiClient;
 class FiscalConfigClient{
  constructor(){this.api=new ApiClient();}
  initialize(){return this.api.initialize();}
  settings(){return this.api.request('/api/v1/fiscal/settings');}
  saveSettings(body){return this.api.request('/api/v1/fiscal/settings',{method:'PUT',body});}
  profiles(includeInactive=true){return this.api.request('/api/v1/fiscal/profiles'+(includeInactive?'?includeInactive=true':''));}
  profile(id){return this.api.request('/api/v1/fiscal/profiles/'+encodeURIComponent(id));}
  createProfile(body){return this.api.request('/api/v1/fiscal/profiles',{method:'POST',body});}
  saveProfile(id,body){return this.api.request('/api/v1/fiscal/profiles/'+encodeURIComponent(id),{method:'PUT',body});}
  products(){return this.api.products(true);}
  productFiscal(id){return this.api.request('/api/v1/products/'+encodeURIComponent(id)+'/fiscal');}
  saveProductFiscal(id,body){return this.api.request('/api/v1/products/'+encodeURIComponent(id)+'/fiscal',{method:'PUT',body});}
  coverage(){return this.api.request('/api/v1/fiscal/product-coverage');}
  sequence(filters){return this.api.request('/api/v1/fiscal/sequences'+this.api.params(filters));}
  saveSequence(body){return this.api.request('/api/v1/fiscal/sequences',{method:'PUT',body});}
  readiness(){return this.api.request('/api/v1/fiscal/production/readiness');}
 }
 return {FiscalConfigClient};
});