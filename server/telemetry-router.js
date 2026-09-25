'use strict';
const { validateTelemetryEvent }=require('../js/core/telemetry/telemetry-events');
const UI_EVENTS=new Set(['screen_opened','return_started']);
const UI_ROUTES=new Set(['home','checkout','products','customers','inventory','finance','reports','sellers','cash','sales','returns','settings']);
function bearer(request){const value=String(request.headers?.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function sendJson(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function readJson(request,limit=16*1024){let total=0;const chunks=[];for await(const chunk of request){total+=chunk.length;if(total>limit){const error=new Error('Corpo da requisicao excede o limite permitido.');error.statusCode=413;throw error;}chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('JSON invalido.');error.statusCode=400;throw error;}}
function validateUiTelemetryEvent(eventName,payload={}){const name=String(eventName||'').trim();if(!UI_EVENTS.has(name))throw Object.assign(new Error('Evento de telemetria UI nao permitido.'),{statusCode:422});const validated=validateTelemetryEvent(name,payload);if(name==='screen_opened'){const route=validated.dimensions.route;if(!UI_ROUTES.has(route))throw Object.assign(new Error('Rota de telemetria UI nao permitida.'),{statusCode:422});}return validated;}
function createTelemetryRouter({runtime,sessionStore,requireTerminalAuth=false,bodyLimitBytes=16*1024}={}){
 if(!runtime?.telemetry)throw new TypeError('runtime.telemetry is required.');if(!sessionStore)throw new TypeError('sessionStore is required.');
 return async function telemetryRoute(request,response){
  const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);if(request.method!=='POST'||url.pathname!=='/api/v1/system/telemetry/events')return false;
  try{
   const token=bearer(request);const session=sessionStore.get(token);if(!session||session.expiresAt<=Date.now()){if(token)sessionStore.delete(token);sendJson(response,401,{error:'Sessao invalida ou expirada.'});return true;}
   if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE'){sendJson(response,401,{error:'Terminal nao autorizado.'});return true;}}
   const body=await readJson(request,bodyLimitBytes);const payload=validateUiTelemetryEvent(body.eventName,body.payload||{});runtime.telemetry.record(body.eventName,payload,{terminalKey:session.terminalId||'server-terminal'});sendJson(response,202,{accepted:true});return true;
  }catch(error){sendJson(response,Number(error?.statusCode)||500,{error:Number(error?.statusCode)>=500?'Falha interna ao registrar telemetria.':String(error?.message||'Requisicao invalida.')});return true;}
 };
}
module.exports={UI_EVENTS,UI_ROUTES,validateUiTelemetryEvent,createTelemetryRouter};
