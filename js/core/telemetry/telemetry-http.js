'use strict';
function safePath(raw=''){try{return new URL(String(raw||'/'),'http://localhost').pathname;}catch{return String(raw||'').split('?')[0];}}
function moduleFor(pathname){const m=pathname.match(/^\/api\/v1\/([^/]+)/);return m?m[1].replace(/[^a-z0-9_-]/gi,'').slice(0,32):'api';}
function sqliteLike(error){const code=String(error?.code||'');const name=String(error?.name||'');return /^SQLITE_/i.test(code)||/sqlite/i.test(name);}
function classifyTelemetryHttpFailure({method='GET',pathname='/',status=0,error=null}={}){
 const code=Number(status||0);if(code<500)return null;const path=safePath(pathname);const verb=String(method||'GET').toUpperCase();
 if(sqliteLike(error))return{eventName:'database_failed',dimensions:{module:moduleFor(path),operation:'database_operation',subsystem:'sqlite',error_class:String(error?.name||'SQLiteError').slice(0,64)}};
 if(/^\/api\/v1\/sales(?:\/|$)/.test(path))return{eventName:'sale_failed',dimensions:{module:'pos',operation:verb==='POST'?'sale_mutation':'sale_request',error_class:'http_5xx'}};
 if(/^\/api\/v1\/returns(?:\/|$)/.test(path))return{eventName:'return_failed',dimensions:{module:'returns',operation:'return_mutation',error_class:'http_5xx'}};
 if(/^\/api\/v1\/(cash|inventory|finance|fiscal|print|restaurant|vertical|orders|procurement)(?:\/|$)/.test(path))return{eventName:'operation_failed',dimensions:{module:moduleFor(path),operation:'http_request',subsystem:'api',error_class:'http_5xx'}};
 return null;
}
function observeTelemetryResponse({request,response,telemetry,errorProvider=()=>null}={}){
 if(!request||!response||!telemetry?.record)return()=>{};const handler=()=>{try{const result=classifyTelemetryHttpFailure({method:request.method,pathname:request.url,status:response.statusCode,error:errorProvider()});if(result)telemetry.record(result.eventName,{dimensions:result.dimensions},{terminalKey:String(request.headers?.['x-terminal-id']||'server-terminal')});}catch{}};response.once('finish',handler);return()=>response.removeListener('finish',handler);
}
module.exports={safePath,classifyTelemetryHttpFailure,observeTelemetryResponse};
