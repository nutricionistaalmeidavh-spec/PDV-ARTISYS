'use strict';

const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');

function registerRestaurantEffects({bus,effectStore,restaurantService,kitchenService,nonFiscalPrintService}={}){
  if(!bus||!effectStore||!restaurantService||!kitchenService||!nonFiscalPrintService)throw new TypeError('Restaurant effects dependencies are required.');

  const orderCreated=createIdempotentDomainEffect({
    effectKey:'restaurant.route-order',
    effectStore,
    handler:async event=>{
      const tickets=kitchenService.routeOrder(event.aggregateId);
      const jobs=[];
      for(const ticket of tickets){
        if(!ticket.printEnabled)continue;
        jobs.push(nonFiscalPrintService.kitchenTicket(ticket,{printerName:ticket.printerName,id:`kitchen-${ticket.id}`}));
      }
      return{tickets:tickets.map(ticket=>ticket.id),jobs:jobs.map(job=>job.id)};
    }
  });

  const saleCompleted=createIdempotentDomainEffect({
    effectKey:'restaurant.close-table-after-sale',
    effectStore,
    handler:async event=>restaurantService.finalizeCompletedSale(event.aggregateId,{actor:event.actor||{}})
  });

  const saleCancelled=createIdempotentDomainEffect({
    effectKey:'restaurant.reopen-table-after-sale-cancel',
    effectStore,
    handler:async event=>restaurantService.reopenCancelledCheckout(event.aggregateId,{actor:event.actor||{}})
  });

  bus.on('restaurant.order-created',orderCreated);
  bus.on('sale.completed',saleCompleted);
  bus.on('sale.cancelled',saleCancelled);
  return()=>{bus.off('restaurant.order-created',orderCreated);bus.off('sale.completed',saleCompleted);bus.off('sale.cancelled',saleCancelled);};
}

module.exports={registerRestaurantEffects};
