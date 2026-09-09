'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
function registerInventoryEffects({bus,inventoryService,effectStore}={}){
  if(!bus||!inventoryService||!effectStore) throw new TypeError('bus, inventoryService and effectStore are required.');
  const completed=createIdempotentDomainEffect({
    effectKey:'inventory.sale-completed',effectStore,
    handler:async event=>inventoryService.applySaleItems({eventId:event.eventId,saleId:event.aggregateId,items:event.payload.items,direction:'sale',createdAt:event.occurredAt})
  });
  const cancelled=createIdempotentDomainEffect({
    effectKey:'inventory.sale-cancelled',effectStore,
    handler:async event=>inventoryService.applySaleItems({eventId:event.eventId,saleId:event.aggregateId,items:event.payload.items,direction:'cancel',createdAt:event.occurredAt})
  });
  return [bus.subscribe('sale.completed',completed),bus.subscribe('sale.cancelled',cancelled)];
}
module.exports={registerInventoryEffects};
