'use strict';

const {createIdempotentDomainEffect}=require('../../core/idempotent-domain-effect');

function registerRetailEffects({bus,retailService,effectStore}={}){
  if(!bus||!retailService||!effectStore)throw new TypeError('bus, retailService and effectStore are required.');
  const completed=createIdempotentDomainEffect({effectKey:'retail.sale-completed',effectStore,handler:async event=>retailService.applySaleEvent(event,'sale')});
  const cancelled=createIdempotentDomainEffect({effectKey:'retail.sale-cancelled',effectStore,handler:async event=>retailService.applySaleEvent(event,'cancel')});
  return[bus.subscribe('sale.completed',completed),bus.subscribe('sale.cancelled',cancelled)];
}

module.exports={registerRetailEffects};
