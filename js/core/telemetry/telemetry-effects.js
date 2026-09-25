'use strict';
const REGISTERED_BUSES=new WeakSet();
const EVENT_MAP=Object.freeze({
 'sale.opened':['sale_started',{module:'pos'}],
 'sale.completed':['sale_completed',{module:'pos',result:'success'}],
 'return.completed':['return_completed',{module:'returns',result:'success'}],
 'receipt.failed':['printer_failed',{module:'printing',operation:'receipt_print'}],
 'fiscal.failed':['fiscal_failed',{module:'fiscal',subsystem:'fiscal',operation:'issue',state:'failed'}],
 'fiscal.rejected':['fiscal_failed',{module:'fiscal',subsystem:'fiscal',operation:'issue',state:'rejected'}],
 'fiscal.unknown':['fiscal_failed',{module:'fiscal',subsystem:'fiscal',operation:'issue',state:'unknown'}]
});
function registerTelemetryEffects({bus,telemetry}={}){
 if(!bus?.subscribe||!telemetry?.record)throw new TypeError('bus e telemetry obrigatorios.');
 if(REGISTERED_BUSES.has(bus))return[];REGISTERED_BUSES.add(bus);
 const unsub=[];
 for(const [domainType,[eventName,dimensions]] of Object.entries(EVENT_MAP))unsub.push(bus.subscribe(domainType,()=>{try{telemetry.record(eventName,{dimensions});}catch{/* observability is fail-open */}}));
 return unsub;
}
module.exports={EVENT_MAP,registerTelemetryEffects};
