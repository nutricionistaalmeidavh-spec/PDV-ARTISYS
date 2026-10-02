'use strict';

const {
  normalize,
  saveDataServerConfig,
  isExternalMode
}=require('./data-server-config.cjs');

const BUSINESS_DATA_TABLES=Object.freeze([
  'users','categories','products','customers','suppliers',
  'sales','sale_items','payments','return_transactions','return_items',
  'inventory_movements','inventory_location_balances','inventory_lots','inventory_reservations',
  'cash_sessions','cash_movements',
  'financial_accounts','financial_entries','financial_settlements',
  'product_recipes','recipe_components',
  'sales_orders','sales_order_items','wholesale_price_tiers',
  'product_kits','product_kit_components','promotional_combos','promotional_combo_products',
  'restaurant_tables','restaurant_sessions','restaurant_orders','restaurant_order_items','restaurant_settlements',
  'delivery_orders','fast_food_orders','bakery_orders',
  'appointments','service_professionals',
  'product_variants','retail_variant_balances',
  'purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items'
]);

function existingTables(db){
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>String(row.name)));
}

function localBusinessDataSummary(db){
  if(!db)return{hasData:false,tables:[]};
  const existing=existingTables(db);const tables=[];
  for(const table of BUSINESS_DATA_TABLES){
    if(!existing.has(table))continue;
    const total=Number(db.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get()?.total||0);
    if(total>0)tables.push({table,total});
  }
  return{hasData:tables.length>0,tables};
}

function usableInputSecret(value){
  const text=String(value||'').trim();
  return text&&text!=='••••••••'?text:'';
}

function resolveTerminalSecret(input,currentConfig,credentialStore){
  return usableInputSecret(input?.terminalKey)||usableInputSecret(currentConfig?.terminalKey)||String(credentialStore?.load?.()||'').trim();
}

function migrateLegacyDataServerCredential({config,filePath,credentialStore}={}){
  if(!config)throw new TypeError('config is required.');
  const legacy=usableInputSecret(config.terminalKey);
  if(!legacy)return{...config,terminalKey:''};
  if(!credentialStore?.save)throw new Error('Armazenamento seguro da credencial do terminal indisponivel.');
  credentialStore.save(legacy);
  return saveDataServerConfig(filePath,{...config,terminalKey:legacy});
}

function saveDataServerSelection({db,filePath,input={},currentConfig={},credentialStore}={}){
  const candidateMode=String(input.mode||currentConfig.mode||'local');
  const external=['lan-client','own-server'].includes(candidateMode);
  let terminalKey='';
  if(external){
    const summary=localBusinessDataSummary(db);
    if(summary.hasData){
      const labels=summary.tables.slice(0,5).map(item=>`${item.table}:${item.total}`).join(', ');
      throw new Error(`Esta instalação possui dados locais (${labels}). Exporte ou migre os dados antes de conectá-la como terminal; a troca não foi aplicada.`);
    }
    terminalKey=resolveTerminalSecret(input,currentConfig,credentialStore);
    normalize({...currentConfig,...input,mode:candidateMode,terminalKey});
    if(!credentialStore?.save)throw new Error('Armazenamento seguro da credencial do terminal indisponivel.');
    credentialStore.save(terminalKey);
  }
  return saveDataServerConfig(filePath,{...currentConfig,...input,mode:candidateMode,terminalKey});
}

async function testDataServerTarget({input={},currentConfig={},credentialStore,fetchImpl=globalThis.fetch,timeoutMs=5000}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl is required.');
  const serverUrl=String(input.serverUrl||currentConfig.serverUrl||'').trim().replace(/\/+$/,'');
  if(!serverUrl)throw new Error('Informe o endereço do servidor.');
  const inferredMode=String(input.mode||(['lan-client','own-server'].includes(currentConfig.mode)?currentConfig.mode:'lan-client'));
  const terminalId=String(input.terminalId||currentConfig.terminalId||'PDV-01').trim();
  const terminalKey=resolveTerminalSecret(input,currentConfig,credentialStore);
  normalize({...currentConfig,...input,mode:inferredMode,serverUrl,terminalId,terminalKey});

  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
    let response;
    try{response=await fetchImpl(`${serverUrl}/api/v1/health`,{headers:{accept:'application/json'},...(controller?{signal:controller.signal}:{})});}
    catch(error){if(error?.name==='AbortError')throw new Error('O servidor não respondeu dentro do tempo esperado.');throw error;}
    if(!response?.ok)throw new Error(`Servidor respondeu com HTTP ${response?.status||0}.`);

    try{response=await fetchImpl(`${serverUrl}/api/v1/vertical/catalog/kits`,{headers:{accept:'application/json','x-terminal-id':terminalId,'x-terminal-key':terminalKey},...(controller?{signal:controller.signal}:{})});}
    catch(error){if(error?.name==='AbortError')throw new Error('O servidor não respondeu dentro do tempo esperado.');throw error;}
    if(!response?.ok){
      if(Number(response?.status)===401||Number(response?.status)===403)throw new Error('Servidor encontrado, mas o terminal ou a chave de pareamento não foram aceitos.');
      throw new Error(`Servidor encontrado, mas a validação do terminal respondeu com HTTP ${response?.status||0}.`);
    }
    return{ok:true,server:true,terminal:true};
  }finally{if(timer)clearTimeout(timer);}
}

module.exports={BUSINESS_DATA_TABLES,localBusinessDataSummary,migrateLegacyDataServerCredential,saveDataServerSelection,testDataServerTarget};
