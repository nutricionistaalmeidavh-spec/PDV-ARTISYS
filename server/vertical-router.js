'use strict';

class VerticalHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new VerticalHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new VerticalHttpError(400,'JSON invalido.');}}
function bearer(request){const value=String(request.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}

function createVerticalRouter({runtime,installationToken='',requireTerminalAuth=false,sessionStore=null}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  const sessions=sessionStore||null;
  function principal(request){
    if(sessions){
      const token=bearer(request);const session=sessions.get(token);
      if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new VerticalHttpError(401,'Sessao invalida ou expirada.');}
      if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new VerticalHttpError(401,'Terminal nao autorizado.');}
      return{actor:{userId:session.userId,role:session.role,terminalId:session.terminalId||null},terminalId:session.terminalId||null};
    }
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new VerticalHttpError(401,'Terminal nao autorizado.');return{actor:{userId:null,role:'terminal',terminalId:id},terminalId:id};}
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new VerticalHttpError(401,'Token local invalido.');
    return{actor:{userId:null,role:'system',terminalId:null},terminalId:null};
  }
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}
  return async function verticalRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;if(!pathname.startsWith('/api/v1/vertical/'))return false;
    try{
      const p=principal(request);const actor=p.actor;
      if(request.method==='GET'&&pathname==='/api/v1/vertical/modules'){json(response,200,runtime.modules.list());return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/option-groups'){json(response,201,runtime.catalogCustomization.upsertOptionGroup(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/options'){json(response,201,runtime.catalogCustomization.upsertOption(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/variants'){json(response,201,runtime.catalogCustomization.upsertVariant(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/combo-groups'){json(response,201,runtime.catalogCustomization.upsertComboGroup(await body(request),actor));return true;}
      const linkGroup=pathname.match(/^\/api\/v1\/vertical\/catalog\/products\/([^/]+)\/option-groups\/([^/]+)$/);
      if(request.method==='PUT'&&linkGroup){json(response,200,runtime.catalogCustomization.linkGroupToProduct(decodeURIComponent(linkGroup[1]),decodeURIComponent(linkGroup[2]),await body(request),actor));return true;}
      const comboItem=pathname.match(/^\/api\/v1\/vertical\/catalog\/combo-groups\/([^/]+)\/items$/);
      if(request.method==='POST'&&comboItem){json(response,201,runtime.catalogCustomization.upsertComboItem(decodeURIComponent(comboItem[1]),await body(request),actor));return true;}
      const productConfig=pathname.match(/^\/api\/v1\/vertical\/catalog\/products\/([^/]+)\/configuration$/);
      if(request.method==='GET'&&productConfig){json(response,200,runtime.catalogCustomization.getProductConfiguration(decodeURIComponent(productConfig[1])));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/catalog/price'){json(response,200,runtime.catalogCustomization.priceConfiguredItem(await body(request)));return true;}

      const recipe=pathname.match(/^\/api\/v1\/vertical\/recipes\/([^/]+)$/);
      if(request.method==='GET'&&recipe){const value=runtime.recipes.getRecipe(decodeURIComponent(recipe[1]));if(!value)throw new VerticalHttpError(404,'Ficha tecnica nao encontrada.');json(response,200,value);return true;}
      if(request.method==='PUT'&&recipe){json(response,200,runtime.recipes.setRecipe(decodeURIComponent(recipe[1]),await body(request),actor));return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/pizzeria/profile'){json(response,201,runtime.pizzeria.upsertProfile(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/pizzeria/catalog'){const data=await body(request);let value;if(data.kind==='size')value=runtime.pizzeria.upsertSize(data,actor);else if(data.kind==='flavor')value=runtime.pizzeria.upsertFlavor(data,actor);else if(data.kind==='crust')value=runtime.pizzeria.upsertCrust(data,actor);else throw new VerticalHttpError(400,'Tipo de cadastro de pizzaria invalido.');json(response,201,value);return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/pizzeria/price'){json(response,200,runtime.pizzeria.pricePizza(await body(request)));return true;}
      const pizzaProfile=pathname.match(/^\/api\/v1\/vertical\/pizzeria\/products\/([^/]+)$/);
      if(request.method==='GET'&&pizzaProfile){const value=runtime.pizzeria.getProfile(decodeURIComponent(pizzaProfile[1]));if(!value)throw new VerticalHttpError(404,'Perfil de pizzaria nao encontrado.');json(response,200,value);return true;}

      const configuredSale=pathname.match(/^\/api\/v1\/vertical\/sales\/([^/]+)\/configured-item$/);
      if(request.method==='POST'&&configuredSale){const data=await body(request);json(response,200,runtime.sales.addItem(decodeURIComponent(configuredSale[1]),data));return true;}

      const settlement=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/settlements$/);
      if(request.method==='POST'&&settlement){const data=await body(request);const terminalId=data.terminalId||p.terminalId;if(!terminalId)throw new VerticalHttpError(400,'Terminal obrigatorio.');json(response,201,runtime.restaurantSettlement.createItemSettlement(decodeURIComponent(settlement[1]),{...data,terminalId},actor));return true;}
      const equalSettlement=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/settlements\/equal$/);
      if(request.method==='POST'&&equalSettlement){const data=await body(request);const terminalId=data.terminalId||p.terminalId;if(!terminalId)throw new VerticalHttpError(400,'Terminal obrigatorio.');json(response,201,runtime.restaurantSettlement.createEqualSettlement(decodeURIComponent(equalSettlement[1]),{...data,terminalId},actor));return true;}
      const remaining=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/remaining$/);
      if(request.method==='GET'&&remaining){json(response,200,runtime.restaurantSettlement.getRemainingBalance(decodeURIComponent(remaining[1])));return true;}
      const completeSettlement=pathname.match(/^\/api\/v1\/vertical\/restaurant\/settlements\/([^/]+)\/complete$/);
      if(request.method==='POST'&&completeSettlement){json(response,200,runtime.restaurantSettlement.completeSettlement(decodeURIComponent(completeSettlement[1]),await body(request),actor));return true;}
      const cancelOrderItem=pathname.match(/^\/api\/v1\/vertical\/restaurant\/order-items\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&cancelOrderItem){const data=await body(request);json(response,200,runtime.restaurantSettlement.cancelOrderItem(decodeURIComponent(cancelOrderItem[1]),data.reason,actor));return true;}
      const mergeSessions=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/merge$/);
      if(request.method==='POST'&&mergeSessions){const data=await body(request);json(response,200,runtime.restaurantSettlement.mergeSessions(decodeURIComponent(mergeSessions[1]),data.targetSessionId,actor));return true;}
      const transferItems=pathname.match(/^\/api\/v1\/vertical\/restaurant\/sessions\/([^/]+)\/transfer-items$/);
      if(request.method==='POST'&&transferItems){const data=await body(request);json(response,200,runtime.restaurantSettlement.transferItems(decodeURIComponent(transferItems[1]),data.targetSessionId,data.items||[],actor));return true;}

      if(request.method==='GET'&&pathname==='/api/v1/vertical/delivery'){json(response,200,runtime.delivery.list({status:url.searchParams.get('status')||null,fulfillmentType:url.searchParams.get('fulfillmentType')||null}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/delivery'){const data=await body(request);const result=await mutate(request,pathname,201,()=>runtime.delivery.create(data,actor));json(response,result.statusCode,result.payload);return true;}
      const deliveryStatus=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&deliveryStatus){const data=await body(request);json(response,200,runtime.delivery.updateStatus(decodeURIComponent(deliveryStatus[1]),data.status,actor));return true;}
      const deliveryCancel=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&deliveryCancel){const data=await body(request);json(response,200,runtime.delivery.cancel(decodeURIComponent(deliveryCancel[1]),data.reason,actor));return true;}
      const deliveryCourier=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/courier$/);
      if(request.method==='PATCH'&&deliveryCourier){const data=await body(request);json(response,200,runtime.delivery.assignCourier(decodeURIComponent(deliveryCourier[1]),data.courier,actor));return true;}
      const deliverySale=pathname.match(/^\/api\/v1\/vertical\/delivery\/([^/]+)\/sale$/);
      if(request.method==='POST'&&deliverySale){const data=await body(request);json(response,201,runtime.delivery.createSale(decodeURIComponent(deliverySale[1]),{...data,terminalId:data.terminalId||p.terminalId},actor));return true;}

      if(request.method==='GET'&&pathname==='/api/v1/vertical/fast-food/ready'){json(response,200,runtime.fastFood.readyBoard());return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/fast-food'){json(response,200,runtime.fastFood.list({status:url.searchParams.get('status')||null}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/fast-food'){const data=await body(request);const result=await mutate(request,pathname,201,()=>runtime.fastFood.create(data,actor));json(response,result.statusCode,result.payload);return true;}
      const fastStatus=pathname.match(/^\/api\/v1\/vertical\/fast-food\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&fastStatus){const data=await body(request);json(response,200,runtime.fastFood.updateStatus(decodeURIComponent(fastStatus[1]),data.status,actor));return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/market/price-weight'){json(response,200,runtime.marketBakery.priceWeightedItem(await body(request)));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/market/weight-profile'){json(response,201,runtime.marketBakery.upsertWeightBarcodeProfile(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/market/parse-weight'){const data=await body(request);json(response,200,runtime.marketBakery.parseWeightBarcode(data.barcode,{profileId:data.profileId||null}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/bakery/orders'){json(response,201,runtime.marketBakery.createBakeryOrder(await body(request),actor));return true;}
      const bakeryOrder=pathname.match(/^\/api\/v1\/vertical\/bakery\/orders\/([^/]+)$/);
      if(request.method==='GET'&&bakeryOrder){json(response,200,runtime.marketBakery.getBakeryOrder(decodeURIComponent(bakeryOrder[1])));return true;}
      const bakeryStatus=pathname.match(/^\/api\/v1\/vertical\/bakery\/orders\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&bakeryStatus){const data=await body(request);json(response,200,runtime.marketBakery.updateBakeryOrderStatus(decodeURIComponent(bakeryStatus[1]),data.status,actor));return true;}
      const bakeryCancel=pathname.match(/^\/api\/v1\/vertical\/bakery\/orders\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&bakeryCancel){const data=await body(request);json(response,200,runtime.marketBakery.cancelBakeryOrder(decodeURIComponent(bakeryCancel[1]),data.reason,actor));return true;}

      throw new VerticalHttpError(404,'Rota vertical nao encontrada.');
    }catch(error){const status=error.statusCode||(error.code==='MODULE_DISABLED'?409:/UNIQUE constraint failed/.test(error.message||'')?409:400);try{runtime.logger?.log({level:status>=500?'error':'warn',subsystem:'vertical-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});return true;}
  };
}
module.exports={createVerticalRouter,VerticalHttpError};
