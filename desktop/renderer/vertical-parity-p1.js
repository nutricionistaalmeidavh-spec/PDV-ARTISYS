'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const cents=value=>{const normalized=String(value??'').trim().replace(/\./g,'').replace(',','.');const number=Number(normalized||0);return Number.isFinite(number)?Math.round(number*100):0;};
  const field=(name,label,type='text',extra='')=>`<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" ${extra}></label>`;
  const toast=(message,error=false)=>{const root=document.getElementById('toast-root');if(!root)return;const node=document.createElement('div');node.className=`toast ${error?'error':'success'}`;node.textContent=message;root.appendChild(node);setTimeout(()=>node.remove(),3200);};
  const page=()=>document.getElementById('route-content')?.querySelector('.page,.ops-page');
  const title=()=>page()?.querySelector('h1')?.textContent?.trim()||'';
  const optionalId=data=>{const id=String(data.get('id')||'').trim();return id?{id}:{};};
  const showSettings=()=>window.PdvOperationalUi?.showRoute?.('settings');
  const backButton=()=>'<button class="secondary-button" type="button" id="vertical-back">← Configurações</button>';

  function normalizeDeliveryPhone(value){
    let digits=String(value??'').replace(/\D/g,'');
    if(digits.length>11&&digits.startsWith('55'))digits=digits.slice(2);
    return /^\d{10,11}$/.test(digits)?digits:null;
  }

  function pickupWhatsappButton(order){
    if(!(order.fulfillmentType === 'PICKUP' && order.status === 'READY'))return '';
    const phone=normalizeDeliveryPhone(order.phone);
    return `<button type="button" class="ghost" data-whatsapp-pickup-ready="${esc(order.id)}" ${phone?'':'disabled title="Cadastre um telefone com DDD (10 ou 11 números) para avisar o cliente."'}>${phone?'Avisar no WhatsApp':'WhatsApp sem telefone'}</button>`;
  }

  async function openPickupWhatsapp(order,button){
    const openWhatsapp=window.artisysDesktop?.external?.openWhatsapp;
    const phone=normalizeDeliveryPhone(order.phone);
    if(typeof openWhatsapp!=='function'){toast('Abertura do WhatsApp indisponível neste terminal.',true);return;}
    if(!phone){toast('Cadastre um telefone com DDD (10 ou 11 números) para avisar o cliente.',true);return;}
    button.disabled=true;
    button.textContent='Abrindo WhatsApp...';
    try{
      await openWhatsapp({phone,customerName:order.customerName});
      button.textContent='WhatsApp aberto';
    }catch(error){
      button.disabled=false;
      button.textContent='Tentar novamente';
      toast(error?.message||'Falha ao abrir WhatsApp.',true);
    }
  }

  function renderExtraWorkspace(id){
    const content=document.getElementById('route-content');if(!content)return;
    const config=id==='SERVICES'
      ?{title:'Serviços',description:'Agenda, atendimento e venda canônica de serviços.'}
      :{title:'Oficina',description:'Ordens de serviço, peças, mão de obra e fechamento em venda.'};
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>${config.title}</h1><p>${config.description}</p></div>${backButton()}</header><div class="data-card"><p class="vertical-rule">Módulo ativo. As operações completas aparecem abaixo.</p></div></section>`;
    document.getElementById('vertical-back')?.addEventListener('click',showSettings);
  }

  function mountExtraWorkspaceEntries(){
    for(const id of ['SERVICES','WORKSHOP']){
      document.querySelectorAll(`[data-module-open='${id}']`).forEach(button=>{
        if(button.dataset.parityWorkspaceBound==='1')return;
        button.dataset.parityWorkspaceBound='1';
        button.disabled=false;
        button.querySelector('span')?.replaceChildren(document.createTextNode('Abrir módulo'));
        button.addEventListener('click',()=>renderExtraWorkspace(id));
      });
    }
  }

  async function mountPizzeria(){
    const target=page();if(!target||title()!=='Pizzaria'||target.querySelector('#parity-pizzeria-p1'))return;
    const card=document.createElement('section');card.id='parity-pizzeria-p1';card.className='data-card';
    card.innerHTML=`<h2>Cadastro de tamanhos, sabores e bordas</h2><p class="vertical-rule">Cadastre diretamente os componentes usados pela política de preço da pizza.</p>
      <div class="ops-grid two">
        <form id="pizza-size-form" class="vertical-form"><h3>Tamanho</h3>${field('productId','ID do produto base','text','required')}${field('id','ID do tamanho (opcional)')}${field('name','Nome','text','required')}${field('maxFlavors','Máximo de sabores','number','min="1" max="8" value="1" required')}${field('priceDelta','Acréscimo em R$','text','inputmode="decimal" value="0"')}<button class="primary-button">Salvar tamanho</button></form>
        <form id="pizza-flavor-form" class="vertical-form"><h3>Sabor</h3>${field('productId','ID do produto base','text','required')}${field('id','ID do sabor (opcional)')}${field('name','Nome','text','required')}${field('priceDelta','Acréscimo em R$','text','inputmode="decimal" value="0"')}<button class="primary-button">Salvar sabor</button></form>
        <form id="pizza-crust-form" class="vertical-form"><h3>Borda</h3>${field('productId','ID do produto base','text','required')}${field('id','ID da borda (opcional)')}${field('name','Nome','text','required')}${field('priceDelta','Acréscimo em R$','text','inputmode="decimal" value="0"')}<button class="primary-button">Salvar borda</button></form>
      </div>`;
    target.appendChild(card);
    const bind=(selector,kind,extra=()=>({}))=>card.querySelector(selector)?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const payload={kind,productId:String(data.get('productId')||'').trim(),...optionalId(data),name:String(data.get('name')||'').trim(),priceDeltaCents:cents(data.get('priceDelta')),...extra(data)};try{await api.savePizzeriaCatalog(payload);toast(`${kind==='size'?'Tamanho':kind==='flavor'?'Sabor':'Borda'} salvo(a).`);}catch(error){toast(error.message,true);}});
    bind('#pizza-size-form','size',data=>({maxFlavors:Number(data.get('maxFlavors'))}));
    bind('#pizza-flavor-form','flavor');
    bind('#pizza-crust-form','crust');
  }

  function nextDeliveryStatus(order){
    const delivery={NEW:'PREPARING',PREPARING:'READY',READY:'OUT_FOR_DELIVERY',OUT_FOR_DELIVERY:'DELIVERED'};
    const pickup={NEW:'PREPARING',PREPARING:'READY',READY:'PICKED_UP'};
    return (order.fulfillmentType==='PICKUP'?pickup:delivery)[order.status]||null;
  }

  async function mountDelivery(){
    const target=page();if(!target||title()!=='Delivery'||target.querySelector('#parity-delivery-p1'))return;
    const card=document.createElement('section');card.id='parity-delivery-p1';card.className='data-card';card.innerHTML=`<h2>Operação completa do delivery</h2><p class="vertical-rule">Avance o pedido, atribua entregador, cancele com motivo ou gere a venda canônica.</p><div data-delivery-ops><div class="ops-loader"></div></div><h3>Gerar venda do pedido</h3><form id="delivery-sale-form" class="vertical-form">${field('orderId','ID do pedido','text','required')}${field('productId','ID do produto','text','required')}${field('quantity','Quantidade','number','min="0.001" step="0.001" value="1" required')}${field('unitPrice','Preço unitário em R$ (opcional)','text','inputmode="decimal"')}<label class="field"><span>Operador</span><select name="operatorId" required></select></label><button class="primary-button">Criar venda</button></form><pre id="delivery-sale-output" class="vertical-output"></pre>`;target.appendChild(card);
    let cfg=null;
    async function load(){
      try{
        const [orders,users,config]=await Promise.all([api.delivery(),api.users(true),api.initialize()]);cfg=config;
        const operator=card.querySelector('select[name="operatorId"]');operator.innerHTML=users.filter(user=>user.active!==false).map(user=>`<option value="${esc(user.id)}">${esc(user.name)} · ${esc(user.role)}</option>`).join('');
        card.querySelector('[data-delivery-ops]').innerHTML=orders.map(order=>{const next=nextDeliveryStatus(order);const terminal=['DELIVERED','PICKED_UP','CANCELLED'].includes(order.status);return `<div class="vertical-row" data-delivery-order="${esc(order.id)}"><div><strong>${esc(order.customerName)}</strong><small>${esc(order.id)} · ${esc(order.fulfillmentType)} · ${esc(order.status)}${order.courier?` · ${esc(order.courier)}`:''}</small></div><div class="vertical-actions">${pickupWhatsappButton(order)}${next?`<button type="button" data-delivery-next="${esc(order.id)}:${esc(next)}">Avançar para ${esc(next)}</button>`:''}${order.fulfillmentType==='DELIVERY'&&!terminal?`<button type="button" data-delivery-courier="${esc(order.id)}">Entregador</button>`:''}${!terminal?`<button type="button" data-delivery-cancel="${esc(order.id)}">Cancelar</button>`:''}${!order.saleId?`<button type="button" data-delivery-prefill-sale="${esc(order.id)}">Gerar venda</button>`:`<span>Venda ${esc(order.saleId)}</span>`}</div></div>`;}).join('')||'<p class="vertical-empty">Nenhum pedido de delivery.</p>';
        const ordersById=new Map(orders.map(order=>[String(order.id),order]));
        card.querySelectorAll('[data-whatsapp-pickup-ready]').forEach(button=>button.addEventListener('click',async()=>{const order=ordersById.get(String(button.dataset.whatsappPickupReady||''));if(order)await openPickupWhatsapp(order,button);}));
        card.querySelectorAll('[data-delivery-next]').forEach(button=>button.addEventListener('click',async()=>{const [id,status]=button.dataset.deliveryNext.split(':');try{await api.updateDeliveryStatus(id,status);toast('Status do delivery atualizado.');await load();}catch(error){toast(error.message,true);}}));
        card.querySelectorAll('[data-delivery-courier]').forEach(button=>button.addEventListener('click',async()=>{const courier=window.prompt('Nome do entregador:');if(!courier)return;try{await api.assignDeliveryCourier(button.dataset.deliveryCourier,courier);toast('Entregador atribuído.');await load();}catch(error){toast(error.message,true);}}));
        card.querySelectorAll('[data-delivery-cancel]').forEach(button=>button.addEventListener('click',async()=>{const reason=window.prompt('Motivo do cancelamento:');if(!reason)return;try{await api.cancelDelivery(button.dataset.deliveryCancel,reason);toast('Pedido cancelado.');await load();}catch(error){toast(error.message,true);}}));
        card.querySelectorAll('[data-delivery-prefill-sale]').forEach(button=>button.addEventListener('click',()=>{card.querySelector('#delivery-sale-form [name="orderId"]').value=button.dataset.deliveryPrefillSale;card.querySelector('#delivery-sale-form [name="productId"]').focus();}));
      }catch(error){card.querySelector('[data-delivery-ops]').innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
    }
    card.querySelector('#delivery-sale-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const item={productId:String(data.get('productId')||'').trim(),quantity:Number(data.get('quantity'))};const rawPrice=String(data.get('unitPrice')||'').trim();if(rawPrice)item.unitPriceCents=cents(rawPrice);try{const result=await api.createDeliverySale(String(data.get('orderId')||'').trim(),{terminalId:cfg?.terminalId,operatorId:String(data.get('operatorId')||'').trim(),items:[item]});card.querySelector('#delivery-sale-output').textContent=`Venda ${result.id} · ${money(result.totalCents)}`;toast('Venda do delivery criada.');await load();}catch(error){toast(error.message,true);}});
    await load();
  }

  async function mountMarket(){
    const target=page();if(!target||title()!=='Mercado / Conveniência / Padaria'||target.querySelector('#parity-market-p1'))return;
    const card=document.createElement('section');card.id='parity-market-p1';card.className='data-card';card.innerHTML=`<h2>Perfil de peso e encomendas</h2><div class="ops-grid two"><form id="weight-profile-form" class="vertical-form"><h3>Perfil de etiqueta de balança</h3>${field('name','Nome do perfil','text','required')}${field('prefix','Prefixo','text','required')}${field('totalLength','Comprimento total','number','min="1" value="13" required')}${field('productStart','Início do produto','number','min="0" value="2" required')}${field('productLength','Tamanho do produto','number','min="1" value="5" required')}${field('weightStart','Início do peso','number','min="0" value="7" required')}${field('weightLength','Tamanho do peso','number','min="1" value="5" required')}${field('decimalPlaces','Casas decimais','number','min="0" value="3" required')}<button class="primary-button">Salvar perfil</button></form><form id="bakery-order-form" class="vertical-form"><h3>Nova encomenda de padaria</h3>${field('customerName','Cliente','text','required')}${field('productId','ID do produto','text','required')}${field('quantity','Quantidade','number','min="0.001" step="0.001" value="1" required')}${field('requestedPickupAt','Retirada prevista','datetime-local')}${field('note','Observação')}<button class="primary-button">Criar encomenda</button></form></div><pre id="bakery-create-output" class="vertical-output"></pre><h3>Consultar e operar encomenda</h3><form id="bakery-control-form" class="vertical-form">${field('orderId','ID da encomenda','text','required')}<label class="field"><span>Ação</span><select name="action"><option value="LOOKUP">Consultar</option><option value="READY">Marcar pronta</option><option value="PICKED_UP">Marcar retirada</option><option value="CANCELLED">Cancelar</option></select></label>${field('reason','Motivo do cancelamento')}<button class="secondary-button">Executar</button></form><pre id="bakery-control-output" class="vertical-output"></pre>`;target.appendChild(card);
    card.querySelector('#weight-profile-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const payload={name:data.get('name'),prefix:data.get('prefix'),totalLength:Number(data.get('totalLength')),productStart:Number(data.get('productStart')),productLength:Number(data.get('productLength')),weightStart:Number(data.get('weightStart')),weightLength:Number(data.get('weightLength')),decimalPlaces:Number(data.get('decimalPlaces'))};try{const result=await api.saveWeightProfile(payload);toast(`Perfil ${result.name} salvo.`);}catch(error){toast(error.message,true);}});
    card.querySelector('#bakery-order-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.createBakeryOrder({customerName:data.get('customerName'),requestedPickupAt:String(data.get('requestedPickupAt')||'')||null,note:data.get('note'),items:[{productId:data.get('productId'),quantity:Number(data.get('quantity'))}]});card.querySelector('#bakery-create-output').textContent=`Encomenda ${result.id} · ${money(result.totalCents)} · ${result.status}`;card.querySelector('#bakery-control-form [name="orderId"]').value=result.id;toast('Encomenda criada.');}catch(error){toast(error.message,true);}});
    card.querySelector('#bakery-control-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const id=String(data.get('orderId')||'').trim();const action=String(data.get('action')||'LOOKUP');try{let result;if(action==='LOOKUP')result=await api.bakeryOrder(id);else if(action==='CANCELLED')result=await api.cancelBakeryOrder(id,String(data.get('reason')||''));else result=await api.updateBakeryOrderStatus(id,action);card.querySelector('#bakery-control-output').textContent=`${result.id} · ${result.customerName} · ${result.status} · ${money(result.totalCents)}`;toast(action==='LOOKUP'?'Encomenda consultada.':'Encomenda atualizada.');}catch(error){toast(error.message,true);}});
  }

  async function mountRestaurant(){
    const target=page();if(!target||title()!=='Restaurante avançado'||target.querySelector('#parity-restaurant-p1'))return;
    const card=document.createElement('section');card.id='parity-restaurant-p1';card.className='data-card';card.innerHTML=`<h2>Divisão e liquidação avançada</h2><p class="vertical-rule">Divida por item ou partes iguais, conclua a cobrança, transfira itens/comandas e cancele itens com autorização do usuário logado.</p><div class="ops-grid two"><form id="restaurant-settlement-form" class="vertical-form"><h3>Dividir por item</h3>${field('sessionId','ID da comanda','text','required')}${field('orderItemId','ID do item','text','required')}${field('quantity','Quantidade','number','min="0.001" step="0.001" value="1" required')}${field('serviceChargePercent','Taxa de serviço %','number','min="0" max="100" step="0.01" value="0"')}<label class="field"><span>Operador</span><select name="operatorId" required></select></label><button class="primary-button">Criar divisão</button></form><form id="restaurant-equal-settlement-form" class="vertical-form"><h3>Dividir igualmente</h3>${field('sessionId','ID da comanda','text','required')}${field('parts','Número de partes','number','min="2" max="50" value="2" required')}${field('serviceChargePercent','Taxa de serviço %','number','min="0" max="100" step="0.01" value="0"')}<label class="field"><span>Operador</span><select name="operatorId" required></select></label><button class="primary-button">Criar parte igual</button></form><form id="restaurant-complete-settlement-form" class="vertical-form"><h3>Concluir divisão</h3>${field('settlementId','ID da divisão','text','required')}<label class="field"><span>Pagamento</span><select name="method"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option><option value="OTHER">Outro</option></select></label>${field('amount','Valor em R$','text','inputmode="decimal" required')}<button class="primary-button">Concluir cobrança</button></form><form id="restaurant-transfer-form" class="vertical-form"><h3>Transferir item</h3>${field('sourceSessionId','Comanda origem','text','required')}${field('targetSessionId','Comanda destino','text','required')}${field('orderItemId','ID do item','text','required')}${field('quantity','Quantidade','number','min="0.001" step="0.001" value="1" required')}<button>Transferir item</button></form><form id="restaurant-merge-form" class="vertical-form"><h3>Juntar comandas</h3>${field('sourceSessionId','Comanda origem','text','required')}${field('targetSessionId','Comanda destino','text','required')}<button>Juntar</button></form><form id="restaurant-cancel-item-form" class="vertical-form"><h3>Cancelar item</h3>${field('orderItemId','ID do item','text','required')}${field('reason','Motivo','text','required')}<button class="secondary-button">Cancelar item</button></form></div><pre id="restaurant-p1-output" class="vertical-output"></pre>`;target.appendChild(card);
    try{
      const [users,cfg]=await Promise.all([api.users(true),api.initialize()]);const options=users.filter(user=>user.active!==false).map(user=>`<option value="${esc(user.id)}">${esc(user.name)} · ${esc(user.role)}</option>`).join('');card.querySelectorAll('select[name="operatorId"]').forEach(select=>{select.innerHTML=options;});const output=card.querySelector('#restaurant-p1-output');
      const rememberSettlement=result=>{const settlement=result?.settlement;if(settlement){card.querySelector('#restaurant-complete-settlement-form [name="settlementId"]').value=settlement.id;card.querySelector('#restaurant-complete-settlement-form [name="amount"]').value=(settlement.amountCents/100).toFixed(2).replace('.',',');output.textContent=`Divisão ${settlement.id} · venda ${settlement.saleId} · ${money(settlement.amountCents)}`;}};
      card.querySelector('#restaurant-settlement-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.createRestaurantSettlement(String(data.get('sessionId')||''),{terminalId:cfg.terminalId,operatorId:data.get('operatorId'),serviceChargePercent:Number(data.get('serviceChargePercent')||0),items:[{orderItemId:data.get('orderItemId'),quantity:Number(data.get('quantity'))}]});rememberSettlement(result);toast('Divisão criada.');}catch(error){toast(error.message,true);}});
      card.querySelector('#restaurant-equal-settlement-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.createRestaurantEqualSettlement(String(data.get('sessionId')||''),{terminalId:cfg.terminalId,operatorId:data.get('operatorId'),serviceChargePercent:Number(data.get('serviceChargePercent')||0),parts:Number(data.get('parts'))});rememberSettlement(result);toast('Divisão igual criada.');}catch(error){toast(error.message,true);}});
      card.querySelector('#restaurant-complete-settlement-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.completeRestaurantSettlement(String(data.get('settlementId')||''),{payments:[{method:data.get('method'),amountCents:cents(data.get('amount'))}]});output.textContent=`Divisão ${result.settlementId} concluída · saldo restante ${money(result.remaining?.totalCents||0)}`;toast('Cobrança concluída.');}catch(error){toast(error.message,true);}});
      card.querySelector('#restaurant-transfer-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.transferRestaurantItems(String(data.get('sourceSessionId')||''),{targetSessionId:String(data.get('targetSessionId')||''),items:[{orderItemId:data.get('orderItemId'),quantity:Number(data.get('quantity'))}]});output.textContent=`${result.moved.length} item(ns) transferido(s) · ${money(result.totalCents)}`;toast('Item transferido.');}catch(error){toast(error.message,true);}});
      card.querySelector('#restaurant-merge-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.mergeRestaurantSessions(String(data.get('sourceSessionId')||''),String(data.get('targetSessionId')||''));output.textContent=`Comanda ${result.sourceSessionId} incorporada em ${result.targetSessionId}`;toast('Comandas unidas.');}catch(error){toast(error.message,true);}});
      card.querySelector('#restaurant-cancel-item-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.cancelRestaurantOrderItem(String(data.get('orderItemId')||''),String(data.get('reason')||''));output.textContent=`Item ${result.orderItemId} cancelado.`;toast('Item cancelado.');}catch(error){toast(error.message,true);}});
    }catch(error){card.querySelector('#restaurant-p1-output').textContent=error.message;}
  }

  function mount(){mountExtraWorkspaceEntries();void mountPizzeria();void mountDelivery();void mountMarket();void mountRestaurant();}
  const content=document.getElementById('route-content');if(content)new MutationObserver(()=>queueMicrotask(mount)).observe(content,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',mount,{once:true});
  mount();
})();
