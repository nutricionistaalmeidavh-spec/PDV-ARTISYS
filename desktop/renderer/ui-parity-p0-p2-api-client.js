'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;if(!ApiClient)return;
  const p=ApiClient.prototype;
  p.terminals=function(){return this.request('/api/v1/terminals');};
  p.createPairingCode=function(ttlSeconds=300){return this.request('/api/v1/lan/pairing-codes',{method:'POST',body:{ttlSeconds}});};
  p.setTerminalStatus=function(terminalId,status){return this.request(`/api/v1/terminals/${encodeURIComponent(terminalId)}`,{method:'PATCH',body:{status}});};
})();
