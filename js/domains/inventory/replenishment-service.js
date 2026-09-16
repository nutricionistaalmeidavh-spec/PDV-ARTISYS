'use strict';

const { writeAudit } = require('../../core/audit-log');
const { roundQuantity } = require('./inventory-rules');

function createReplenishmentService({db,inventory,now=()=>new Date().toISOString(),defaults={leadTimeDays:7,safetyStock:0},purchasing=null}={}){
  if(!db||!inventory)throw new TypeError('Database and inventory are required.');

  function getPolicy(productId){
    const row=db.prepare('SELECT * FROM replenishment_policies WHERE product_id=?').get(String(productId));
    return{
      productId:String(productId),
      leadTimeDays:row?.lead_time_days??Number(defaults.leadTimeDays??7),
      safetyStock:roundQuantity(row?.safety_stock??Number(defaults.safetyStock??0)),
      minimumPurchaseQuantity:roundQuantity(row?.minimum_purchase_quantity??0),
      preferredSupplierId:row?.preferred_supplier_id??null,
      excludeExpiringDays:Number(row?.exclude_expiring_days??0),
      updatedAt:row?.updated_at??null
    };
  }

  function saveProductPolicy(productId,input={},actor=null){
    const id=String(productId||'').trim();if(!db.prepare('SELECT 1 FROM products WHERE id=?').get(id))throw new Error('Produto nao encontrado.');
    const lead=input.leadTimeDays==null?null:Number(input.leadTimeDays);if(lead!=null&&(!Number.isInteger(lead)||lead<0))throw new Error('Lead time invalido.');
    const safety=roundQuantity(Number(input.safetyStock??0));if(safety<0)throw new Error('Estoque de seguranca invalido.');
    const minimum=roundQuantity(Number(input.minimumPurchaseQuantity??0));if(minimum<0)throw new Error('Compra minima invalida.');
    const supplier=String(input.preferredSupplierId||'').trim()||null;if(supplier&&!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND active=1').get(supplier))throw new Error('Fornecedor preferencial nao encontrado ou inativo.');
    const exclude=Number(input.excludeExpiringDays??0);if(!Number.isInteger(exclude)||exclude<0)throw new Error('Janela de validade invalida.');
    const timestamp=now();db.prepare(`INSERT INTO replenishment_policies(product_id,lead_time_days,safety_stock,minimum_purchase_quantity,preferred_supplier_id,exclude_expiring_days,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET lead_time_days=excluded.lead_time_days,safety_stock=excluded.safety_stock,
      minimum_purchase_quantity=excluded.minimum_purchase_quantity,preferred_supplier_id=excluded.preferred_supplier_id,exclude_expiring_days=excluded.exclude_expiring_days,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(id,lead,safety,minimum,supplier,exclude,actor?.userId||null,timestamp);
    writeAudit(db,{action:'inventory.replenishment-policy.update',entity:'product',entityId:id,actor,context:{leadTimeDays:lead,safetyStock:safety,minimumPurchaseQuantity:minimum,preferredSupplierId:supplier,excludeExpiringDays:exclude}},now);
    return getPolicy(id);
  }

  function salesQuantity(productId,from,to){
    return Number(db.prepare(`SELECT COALESCE(SUM(si.quantity),0) AS quantity FROM sale_items si JOIN sales s ON s.id=si.sale_id
      WHERE si.product_id=? AND s.status='COMPLETED' AND s.completed_at>? AND s.completed_at<=?`).get(String(productId),from,to)?.quantity||0);
  }
  function onOrder(productId){
    return roundQuantity(Number(db.prepare(`SELECT COALESCE(SUM(poi.ordered_quantity-poi.received_quantity),0) AS quantity FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id=poi.purchase_order_id WHERE poi.product_id=? AND po.status IN('ORDERED','PARTIAL')`).get(String(productId))?.quantity||0));
  }
  function nearExpiry(productId,asOf,days){
    if(!days)return 0;const until=new Date(Date.parse(asOf)+days*86400000).toISOString();return roundQuantity(Number(db.prepare(`SELECT COALESCE(SUM(b.quantity),0) AS quantity FROM inventory_lots l JOIN inventory_lot_balances b ON b.lot_id=l.id
      WHERE l.product_id=? AND l.active=1 AND b.quantity>0 AND l.expires_at IS NOT NULL AND l.expires_at<=?`).get(String(productId),until)?.quantity||0));
  }

  function listSuggestions({lookbackDays=30,asOf=now(),includeZero=false}={}){
    const days=Math.max(1,Math.min(Number(lookbackDays)||30,365));const to=new Date(Date.parse(asOf)).toISOString();if(!Number.isFinite(Date.parse(to)))throw new Error('Data de referencia invalida.');const from=new Date(Date.parse(to)-days*86400000).toISOString();
    const products=db.prepare(`SELECT id AS productId,name,sku,cost_cents AS costCents FROM products WHERE active=1 AND track_stock=1 ORDER BY name,id`).all();
    const result=[];
    for(const product of products){
      const policy=getPolicy(product.productId);const sold=roundQuantity(salesQuantity(product.productId,from,to));const avg=roundQuantity(sold/days);const onHand=roundQuantity(inventory.getBalance(product.productId));const ordered=onOrder(product.productId);const excluded=nearExpiry(product.productId,to,policy.excludeExpiringDays);const effective=roundQuantity(Math.max(onHand-excluded,0));const target=roundQuantity(avg*policy.leadTimeDays+policy.safetyStock);let recommended=roundQuantity(Math.max(target-effective-ordered,0));if(recommended>0&&policy.minimumPurchaseQuantity>0&&recommended<policy.minimumPurchaseQuantity)recommended=policy.minimumPurchaseQuantity;
      const row={...product,lookbackDays:days,quantitySold:sold,averageDailySales:avg,leadTimeDays:policy.leadTimeDays,safetyStock:policy.safetyStock,onHand,onOrder:ordered,excludedNearExpiry:excluded,effectiveOnHand:effective,targetQuantity:target,recommendedQuantity:roundQuantity(recommended),minimumPurchaseQuantity:policy.minimumPurchaseQuantity,preferredSupplierId:policy.preferredSupplierId,unitCostCents:product.costCents};
      if(includeZero||row.recommendedQuantity>0)result.push(row);
    }
    return result.sort((a,b)=>b.recommendedQuantity-a.recommendedQuantity||a.name.localeCompare(b.name));
  }

  function createDraft({supplierId,productIds=null,lookbackDays=30,asOf=now(),orderNumber=null,expectedAt=null}={},actor=null){
    if(!purchasing)throw new Error('Servico de compras indisponivel para conversao de sugestoes.');let suggestions=listSuggestions({lookbackDays,asOf});if(Array.isArray(productIds)&&productIds.length){const ids=new Set(productIds.map(String));suggestions=suggestions.filter(item=>ids.has(item.productId));}return purchasing.createDraftFromSuggestions({supplierId,suggestions,orderNumber,expectedAt},actor);
  }

  return{getPolicy,saveProductPolicy,listSuggestions,createDraft};
}

module.exports={createReplenishmentService};
