'use strict';
const {statusForError}=require('./http-error-status');

const fs=require('node:fs');
const path=require('node:path');

class RestaurantHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
function text(response,statusCode,payload,type='text/plain; charset=utf-8'){response.writeHead(statusCode,{'content-type':type,'cache-control':'no-store'});response.end(payload);}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new RestaurantHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RestaurantHttpError(400,'JSON invalido.');}}
function filters(url,names){const result={};for(const name of names){const value=url.searchParams.get(name);if(value!==null&&value!=='')result[name]=value;}return result;}

function createRestaurantRouter({runtime,installationToken='',requireTerminalAuth=false,mobileDir=path.join(__dirname,'mobile')}={}){
  if(!runtime)throw new TypeError('runtime is required.');

  function desktopPrincipal(request){
    if(requireTerminalAuth){
      const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');
      const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new RestaurantHttpError(401,'Terminal nao autorizado.');
      return{kind:'terminal',terminalId:id,actor:{userId:null,role:'terminal',terminalId:id}};
    }
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new RestaurantHttpError(401,'Token local invalido.');
    return{kind:'local',terminalId:null,actor:{userId:null,role:'system',terminalId:null}};
  }

  function mobilePrincipal(request,types=null){
    const id=String(request.headers['x-device-id']||'').trim();const key=String(request.headers['x-device-key']||'');
    const auth=runtime.mobileDevices.authenticate(id,key);if(!auth.ok)throw new RestaurantHttpError(401,'Dispositivo nao autorizado.');
    if(types&&!types.includes(auth.device.deviceType))throw new RestaurantHttpError(403,'Dispositivo sem permissao para esta operacao.');
    return{device:auth.device,actor:{userId:auth.device.userId||null,role:`mobile-${auth.device.deviceType.toLowerCase()}`,terminalId:null}};
  }

  function requireRestaurantEnabled(){runtime.modules?.requireEnabled('RESTAURANT');}

  async function mutate(request,pathname,statusCode,handler){
    const mutationId=String(request.headers['x-mutation-id']||'').trim();
    if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};
    return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));
  }

  function serveMobile(pathname,response){
    const files={'/mobile':'index.html','/mobile/':'index.html','/mobile/index.html':'index.html','/mobile/app.js':'app.js','/mobile/styles.css':'styles.css'};
    const file=files[pathname];if(!file)return false;
    const full=path.join(mobileDir,file);if(!fs.existsSync(full)){text(response,404,'Interface mobile nao instalada.');return true;}
    const type=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8';
    text(response,200,fs.readFileSync(full,'utf8'),type);return true;
  }

  async function mobileRoute(request,response,url,pathname){
    if(!pathname.startsWith('/api/v1/mobile/'))return false;
    if(request.method==='GET'&&pathname==='/api/v1/mobile/health'){json(response,200,{ok:true,localOnly:true});return true;}
    const principal=mobilePrincipal(request);
    requireRestaurantEnabled();
    if(request.method==='GET'&&pathname==='/api/v1/mobile/context'){
      const device=principal.device;const products=runtime.catalog.listProducts().map(p=>({id:p.id,name:p.name,categoryId:p.categoryId,categoryName:p.categoryName,salePriceCents:p.salePriceCents,unit:p.unit}));
      if(device.deviceType==='TABLET'){
        const table=runtime.restaurant.getTable(device.tableId);const session=table?runtime.restaurant.currentSession(table.id):null;
        json(response,200,{device,table,session,products});return true;
      }
      if(device.deviceType==='WAITER'){
        json(response,200,{device,tables:runtime.restaurant.listTables(),requests:runtime.restaurant.listServiceRequests({status:'OPEN'}),products});return true;
      }
      json(response,200,{device,tickets:runtime.kitchen.listTickets({limit:250})});return true;
    }
    const waiterOpen=pathname.match(/^\/api\/v1\/mobile\/tables\/([^/]+)\/open$/);
    if(request.method==='POST'&&waiterOpen){
      const p=mobilePrincipal(request,['WAITER']);const result=await mutate(request,pathname,201,async mutationId=>runtime.restaurant.openTable(decodeURIComponent(waiterOpen[1]),{operatorId:p.device.userId||null,actor:p.actor,mutationId}));json(response,result.statusCode,result.payload);return true;
    }
    const waiterTransfer=pathname.match(/^\/api\/v1\/mobile\/sessions\/([^/]+)\/transfer$/);
    if(request.method==='POST'&&waiterTransfer){
      const p=mobilePrincipal(request,['WAITER']);const data=await body(request);json(response,200,runtime.restaurant.transferTable(decodeURIComponent(waiterTransfer[1]),data.targetTableId,{actor:p.actor,mutationId:String(request.headers['x-mutation-id']||'')||null}));return true;
    }
    if(request.method==='POST'&&pathname==='/api/v1/mobile/orders'){
      const p=mobilePrincipal(request,['TABLET','WAITER']);const data=await body(request);let sessionId=String(data.sessionId||'').trim();
      if(p.device.deviceType==='TABLET'){
        const session=runtime.restaurant.currentSession(p.device.tableId);if(!session)throw new RestaurantHttpError(409,'Mesa sem comanda aberta.');sessionId=session.id;
      }
      if(!sessionId)throw new RestaurantHttpError(400,'Comanda obrigatoria.');
      const result=await mutate(request,pathname,201,async mutationId=>{const order=runtime.restaurant.addOrder(sessionId,{items:data.items||[],note:data.note||'',source:p.device.deviceType==='TABLET'?'TABLET':'WAITER',deviceId:p.device.id,actor:p.actor,mutationId});const dispatch=await runtime.dispatchPending();return{order,dispatch};});
      json(response,result.statusCode,result.payload);return true;
    }
    if(request.method==='POST'&&pathname==='/api/v1/mobile/service'){
      const p=mobilePrincipal(request,['TABLET']);const data=await body(request);const result=await mutate(request,pathname,201,async mutationId=>runtime.restaurant.requestService(p.device.tableId,data.requestType,{deviceId:p.device.id,actor:p.actor,mutationId}));json(response,result.statusCode,result.payload);return true;
    }
    const requestMatch=pathname.match(/^\/api\/v1\/mobile\/requests\/([^/]+)$/);
    if(request.method==='PATCH'&&requestMatch){const p=mobilePrincipal(request,['WAITER']);const data=await body(request);json(response,200,runtime.restaurant.updateServiceRequest(decodeURIComponent(requestMatch[1]),data.status,p.actor));return true;}
    const ticketMatch=pathname.match(/^\/api\/v1\/mobile\/kitchen\/tickets\/([^/]+)$/);
    if(request.method==='PATCH'&&ticketMatch){const p=mobilePrincipal(request,['KITCHEN']);const data=await body(request);json(response,200,runtime.kitchen.updateTicketStatus(decodeURIComponent(ticketMatch[1]),data.status,p.actor));return true;}
    throw new RestaurantHttpError(404,'Rota mobile nao encontrada.');
  }

  async function desktopRoute(request,response,url,pathname){
    if(!pathname.startsWith('/api/v1/restaurant/'))return false;
    const principal=desktopPrincipal(request);const actor=principal.actor;
    requireRestaurantEnabled();
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/tables'){json(response,200,runtime.restaurant.listTables({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
    if(request.method==='POST'&&pathname==='/api/v1/restaurant/tables'){json(response,201,runtime.restaurant.upsertTable(await body(request),actor));return true;}
    const tableOpen=pathname.match(/^\/api\/v1\/restaurant\/tables\/([^/]+)\/open$/);
    if(request.method==='POST'&&tableOpen){const data=await body(request);const result=await mutate(request,pathname,201,async mutationId=>runtime.restaurant.openTable(decodeURIComponent(tableOpen[1]),{operatorId:data.operatorId||null,actor:{...actor,userId:data.operatorId||actor.userId},mutationId}));json(response,result.statusCode,result.payload);return true;}
    const tableService=pathname.match(/^\/api\/v1\/restaurant\/tables\/([^/]+)\/service$/);
    if(request.method==='POST'&&tableService){const data=await body(request);json(response,201,runtime.restaurant.requestService(decodeURIComponent(tableService[1]),data.requestType,{actor,mutationId:String(request.headers['x-mutation-id']||'')||null}));return true;}
    const sessionGet=pathname.match(/^\/api\/v1\/restaurant\/sessions\/([^/]+)$/);
    if(request.method==='GET'&&sessionGet){const session=runtime.restaurant.getSession(decodeURIComponent(sessionGet[1]));if(!session)throw new RestaurantHttpError(404,'Comanda nao encontrada.');json(response,200,session);return true;}
    const orderAdd=pathname.match(/^\/api\/v1\/restaurant\/sessions\/([^/]+)\/orders$/);
    if(request.method==='POST'&&orderAdd){const data=await body(request);const result=await mutate(request,pathname,201,async mutationId=>{const order=runtime.restaurant.addOrder(decodeURIComponent(orderAdd[1]),{items:data.items||[],note:data.note||'',source:'DESKTOP',actor:{...actor,userId:data.operatorId||actor.userId},mutationId});const dispatch=await runtime.dispatchPending();return{order,dispatch};});json(response,result.statusCode,result.payload);return true;}
    const transfer=pathname.match(/^\/api\/v1\/restaurant\/sessions\/([^/]+)\/transfer$/);
    if(request.method==='POST'&&transfer){const data=await body(request);json(response,200,runtime.restaurant.transferTable(decodeURIComponent(transfer[1]),data.targetTableId,{actor,mutationId:String(request.headers['x-mutation-id']||'')||null}));return true;}
    const checkout=pathname.match(/^\/api\/v1\/restaurant\/sessions\/([^/]+)\/checkout$/);
    if(request.method==='POST'&&checkout){const data=await body(request);if(!data.operatorId)throw new RestaurantHttpError(400,'Operador obrigatorio.');const terminalId=data.terminalId||principal.terminalId;if(!terminalId)throw new RestaurantHttpError(400,'Terminal obrigatorio.');const result=await mutate(request,pathname,200,async mutationId=>runtime.restaurant.checkoutToSale(decodeURIComponent(checkout[1]),{terminalId,operatorId:data.operatorId,actor:{...actor,userId:data.operatorId},mutationId},runtime.sales));json(response,result.statusCode,result.payload);return true;}
    const prebill=pathname.match(/^\/api\/v1\/restaurant\/sessions\/([^/]+)\/prebill$/);
    if(request.method==='POST'&&prebill){const session=runtime.restaurant.getSession(decodeURIComponent(prebill[1]));if(!session)throw new RestaurantHttpError(404,'Comanda nao encontrada.');json(response,201,runtime.nonFiscalPrinting.tablePreBill(session,await body(request)));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/requests'){json(response,200,runtime.restaurant.listServiceRequests(filters(url,['status','requestType'])));return true;}
    const reqUpdate=pathname.match(/^\/api\/v1\/restaurant\/requests\/([^/]+)$/);
    if(request.method==='PATCH'&&reqUpdate){const data=await body(request);json(response,200,runtime.restaurant.updateServiceRequest(decodeURIComponent(reqUpdate[1]),data.status,actor));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/kitchen/stations'){json(response,200,runtime.kitchen.listStations({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
    if(request.method==='POST'&&pathname==='/api/v1/restaurant/kitchen/stations'){json(response,201,runtime.kitchen.upsertStation(await body(request),actor));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/kitchen/assignments'){json(response,200,runtime.kitchen.listAssignments());return true;}
    if(request.method==='POST'&&pathname==='/api/v1/restaurant/kitchen/assignments'){const data=await body(request);json(response,200,runtime.kitchen.assignProduct(data.productId,data.stationId,actor));return true;}
    const unassign=pathname.match(/^\/api\/v1\/restaurant\/kitchen\/assignments\/([^/]+)$/);
    if(request.method==='DELETE'&&unassign){json(response,200,runtime.kitchen.unassignProduct(decodeURIComponent(unassign[1]),actor));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/kitchen/tickets'){json(response,200,runtime.kitchen.listTickets(filters(url,['status','stationId','limit'])));return true;}
    const kitchenUpdate=pathname.match(/^\/api\/v1\/restaurant\/kitchen\/tickets\/([^/]+)$/);
    if(request.method==='PATCH'&&kitchenUpdate){const data=await body(request);json(response,200,runtime.kitchen.updateTicketStatus(decodeURIComponent(kitchenUpdate[1]),data.status,actor));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/devices'){json(response,200,runtime.mobileDevices.listDevices(filters(url,['deviceType','status'])));return true;}
    if(request.method==='POST'&&pathname==='/api/v1/restaurant/devices'){json(response,201,runtime.mobileDevices.createDevice(await body(request),actor));return true;}
    const deviceStatus=pathname.match(/^\/api\/v1\/restaurant\/devices\/([^/]+)\/status$/);
    if(request.method==='PATCH'&&deviceStatus){const data=await body(request);json(response,200,runtime.mobileDevices.setStatus(decodeURIComponent(deviceStatus[1]),data.status,actor));return true;}
    const deviceRotate=pathname.match(/^\/api\/v1\/restaurant\/devices\/([^/]+)\/rotate$/);
    if(request.method==='POST'&&deviceRotate){json(response,200,runtime.mobileDevices.rotateCredential(decodeURIComponent(deviceRotate[1]),actor));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/reports/summary'){json(response,200,runtime.restaurantReports.summary(filters(url,['from','to'])));return true;}
    if(request.method==='GET'&&pathname==='/api/v1/restaurant/reports/orders.csv'){json(response,200,{csv:runtime.restaurantReports.exportOrdersCsv(filters(url,['from','to']))});return true;}
    throw new RestaurantHttpError(404,'Rota de restaurante nao encontrada.');
  }

  return async function restaurantRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    if(request.method==='GET'&&serveMobile(pathname,response))return true;
    try{
      if(await mobileRoute(request,response,url,pathname))return true;
      if(await desktopRoute(request,response,url,pathname))return true;
      return false;
    }catch(error){
      if(!pathname.startsWith('/api/v1/mobile/')&&!pathname.startsWith('/api/v1/restaurant/'))throw error;
      const status=statusForError(error);
      try{runtime.logger?.log({level:status>=500?'error':'warn',subsystem:'restaurant-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}
      json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});
      return true;
    }
  };
}

module.exports={createRestaurantRouter,RestaurantHttpError};