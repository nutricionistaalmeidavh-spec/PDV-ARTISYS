'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const e=encodeURIComponent;
  Object.assign(ApiClient.prototype,{
    purchaseOrders(filters={}){return this.request(`/api/v1/purchase-orders${this.params(filters)}`);},
    purchaseOrder(id){return this.request(`/api/v1/purchase-orders/${e(id)}`);},
    createPurchaseOrder(body){return this.request('/api/v1/purchase-orders',{method:'POST',body});},
    submitPurchaseOrder(id){return this.request(`/api/v1/purchase-orders/${e(id)}/submit`,{method:'POST',body:{}});},
    receivePurchaseOrder(id,body){return this.request(`/api/v1/purchase-orders/${e(id)}/receive`,{method:'POST',body});},
    cancelPurchaseOrder(id,reason){return this.request(`/api/v1/purchase-orders/${e(id)}/cancel`,{method:'POST',body:{reason}});},

    lots(filters={}){return this.request(`/api/v1/inventory/lots${this.params(filters)}`);},
    lot(id){return this.request(`/api/v1/inventory/lots/${e(id)}`);},
    createLot(body){return this.request('/api/v1/inventory/lots',{method:'POST',body});},
    moveLot(id,body){return this.request(`/api/v1/inventory/lots/${e(id)}/movements`,{method:'POST',body});},

    pixConfig(){return this.request('/api/v1/pix/config');},
    savePixConfig(body){return this.request('/api/v1/pix/config',{method:'PUT',body});},
    pixCharges(filters={}){return this.request(`/api/v1/pix/charges${this.params(filters)}`);},
    createPixCharge(body){return this.request('/api/v1/pix/charges',{method:'POST',body});},
    pixCharge(id){return this.request(`/api/v1/pix/charges/${e(id)}`);},
    confirmPixCharge(id){return this.request(`/api/v1/pix/charges/${e(id)}/confirm`,{method:'POST',body:{}});},
    cancelPixCharge(id,reason){return this.request(`/api/v1/pix/charges/${e(id)}/cancel`,{method:'POST',body:{reason}});},

    issueCustomerCredit(body){return this.request('/api/v1/credits/customer',{method:'POST',body});},
    createGiftCard(body){return this.request('/api/v1/credits/gift-cards',{method:'POST',body});},
    redeemCredit(body){return this.request('/api/v1/credits/redeem',{method:'POST',body});},
    creditBalance(accountId){return this.request(`/api/v1/credits/accounts/${e(accountId)}/balance`);},
    creditLedger(accountId){return this.request(`/api/v1/credits/accounts/${e(accountId)}/ledger`);},
    reverseCreditEntry(id,reason){return this.request(`/api/v1/credits/entries/${e(id)}/reverse`,{method:'POST',body:{reason}});},

    advancedSalesReport(filters={}){return this.request(`/api/v1/reports/advanced/sales${this.params(filters)}`);},
    advancedInventoryReport(filters={}){return this.request(`/api/v1/reports/advanced/inventory${this.params(filters)}`);},
    advancedPurchasingReport(filters={}){return this.request(`/api/v1/reports/advanced/purchasing${this.params(filters)}`);},
    advancedReportCsv(type,filters={}){return this.request(`/api/v1/reports/advanced/${e(type)}.csv${this.params(filters)}`);},

    replenishment(filters={}){return this.request(`/api/v1/replenishment${this.params(filters)}`);},
    replenishmentPolicy(productId){return this.request(`/api/v1/replenishment/policies/${e(productId)}`);},
    saveReplenishmentPolicy(productId,body){return this.request(`/api/v1/replenishment/policies/${e(productId)}`,{method:'PUT',body});},
    createReplenishmentDraft(body){return this.request('/api/v1/replenishment/draft-order',{method:'POST',body});}
  });
})();
