'use strict';
(function attach(root,factory){root.NfseApi=factory(root);})(window,function(root){
 const {ApiClient}=root.PdvApiClient;
 class NfseClient{
  constructor(){this.api=new ApiClient();}
  initialize(){return this.api.initialize();}
  documents(status=''){return this.api.request('/api/v1/nfse/documents'+(status?'?status='+encodeURIComponent(status):''));}
  document(id){return this.api.request('/api/v1/nfse/documents/'+encodeURIComponent(id));}
  requestIssue(body){return this.api.request('/api/v1/nfse/documents',{method:'POST',body});}
  process(id){return this.api.request('/api/v1/nfse/documents/'+encodeURIComponent(id)+'/process',{method:'POST',body:{}});}
  reconcile(id){return this.api.request('/api/v1/nfse/documents/'+encodeURIComponent(id)+'/reconcile',{method:'POST',body:{}});}
  retry(id){return this.api.request('/api/v1/nfse/documents/'+encodeURIComponent(id)+'/retry',{method:'POST',body:{}});}
  events(id){return this.api.request('/api/v1/nfse/documents/'+encodeURIComponent(id)+'/events');}
  registerEvent(id,body){return this.api.request('/api/v1/nfse/documents/'+encodeURIComponent(id)+'/events',{method:'POST',body});}
 }
 return {NfseClient};
});