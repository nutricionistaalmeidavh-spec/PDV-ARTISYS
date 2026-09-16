'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { roundQuantity } = require('../inventory/inventory-rules');
const { assertCents } = require('../shared/money');

function createPurchasingService({ db, inventory, finance, lots=null, now=()=>new Date().toISOString(), idFactory=p=>`${p}-${randomUUID()}` }={}) {
  if(!db||!inventory||!finance) throw new TypeError('Database, inventory and finance are required.');

  function userIdOrNull(actor){
    const id=String(actor?.userId||'').trim();
    return id&&db.prepare('SELECT 1 FROM users WHERE id=?').get(id)?id:null;
  }

  function mapItem(row){return row&&{
    id:row.id,purchaseOrderId:row.purchase_order_id,productId:row.product_id,productName:row.product_name_snapshot,sku:row.sku_snapshot,
    orderedQuantity:roundQuantity(row.ordered_quantity),receivedQuantity:roundQuantity(row.received_quantity),unitCostCents:row.unit_cost_cents,totalCents:row.total_cents,
    remainingQuantity:roundQuantity(Number(row.ordered_quantity)-Number(row.received_quantity))
  };}
  function getItems(orderId){return db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY id').all(String(orderId)).map(mapItem);}
  function mapOrder(row){if(!row)return null;return{
    id:row.id,supplierId:row.supplier_id,orderNumber:row.order_number,status:row.status,expectedAt:row.expected_at,notes:row.notes,
    subtotalCents:row.subtotal_cents,totalCents:row.total_cents,createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at,
    orderedAt:row.ordered_at,receivedAt:row.received_at,cancelledAt:row.cancelled_at,items:getItems(row.id)
  };}
  function get(id){return mapOrder(db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(String(id)));}
  function requireOrder(id,statuses=null){const row=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(String(id));if(!row)throw new Error('Pedido de compra nao encontrado.');if(statuses&&!statuses.includes(row.status))throw new Error(`Pedido de compra nao permite esta operacao no status ${row.status}.`);return row;}

  function normalizeItems(items){
    if(!Array.isArray(items)||!items.length)throw new Error('Pedido de compra precisa de ao menos um item.');
    return items.map((input,index)=>{
      const productId=String(input.productId||'').trim();const product=db.prepare('SELECT id,name,sku FROM products WHERE id=? AND active=1').get(productId);if(!product)throw new Error(`Produto do item ${index+1} nao encontrado ou inativo.`);
      const quantity=roundQuantity(Number(input.quantity??input.orderedQuantity));if(quantity<=0)throw new Error('Quantidade de compra deve ser maior que zero.');
      const unitCostCents=assertCents(Number(input.unitCostCents??0),'unitCostCents');if(unitCostCents<0)throw new Error('Custo de compra nao pode ser negativo.');
      return{id:String(input.id||idFactory('poi')),productId,productName:product.name,sku:product.sku,quantity,unitCostCents,totalCents:Math.round(unitCostCents*quantity)};
    });
  }

  function createDraft(input={},actor=null){
    const supplierId=String(input.supplierId||'').trim();if(!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND active=1').get(supplierId))throw new Error('Fornecedor nao encontrado ou inativo.');
    const items=normalizeItems(input.items);const id=String(input.id||idFactory('po'));const orderNumber=String(input.orderNumber||id).trim();if(!orderNumber)throw new Error('Numero do pedido obrigatorio.');
    const timestamp=now();const subtotal=items.reduce((sum,item)=>sum+item.totalCents,0);const total=assertCents(Number(input.totalCents??subtotal),'totalCents');if(total<0)throw new Error('Total do pedido invalido.');
    return withTransaction(db,()=>{
      db.prepare(`INSERT INTO purchase_orders(id,supplier_id,order_number,status,expected_at,notes,subtotal_cents,total_cents,created_by,created_at,updated_at)
        VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?)`).run(id,supplierId,orderNumber,input.expectedAt||null,input.notes||null,subtotal,total,userIdOrNull(actor),timestamp,timestamp);
      const insert=db.prepare(`INSERT INTO purchase_order_items(id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,ordered_quantity,received_quantity,unit_cost_cents,total_cents)
        VALUES(?,?,?,?,?,?,0,?,?)`);
      for(const item of items)insert.run(item.id,id,item.productId,item.productName,item.sku,item.quantity,item.unitCostCents,item.totalCents);
      writeAudit(db,{action:'purchase.order.create',entity:'purchase-order',entityId:id,actor,context:{supplierId,orderNumber,totalCents:total}},now);
      return get(id);
    });
  }

  function updateDraft(id,input={},actor=null){
    const order=requireOrder(id,['DRAFT']);
    const supplierId=input.supplierId?String(input.supplierId):order.supplier_id;if(!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND active=1').get(supplierId))throw new Error('Fornecedor nao encontrado ou inativo.');
    const items=input.items?normalizeItems(input.items):getItems(id).map(item=>({id:item.id,productId:item.productId,productName:item.productName,sku:item.sku,quantity:item.orderedQuantity,unitCostCents:item.unitCostCents,totalCents:item.totalCents}));
    const subtotal=items.reduce((sum,item)=>sum+item.totalCents,0);const total=assertCents(Number(input.totalCents??subtotal),'totalCents');
    return withTransaction(db,()=>{
      db.prepare('UPDATE purchase_orders SET supplier_id=?,expected_at=?,notes=?,subtotal_cents=?,total_cents=?,updated_at=? WHERE id=?').run(supplierId,input.expectedAt??order.expected_at,input.notes??order.notes,subtotal,total,now(),String(id));
      if(input.items){db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id=?').run(String(id));const insert=db.prepare(`INSERT INTO purchase_order_items(id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,ordered_quantity,received_quantity,unit_cost_cents,total_cents) VALUES(?,?,?,?,?,?,0,?,?)`);for(const item of items)insert.run(item.id,String(id),item.productId,item.productName,item.sku,item.quantity,item.unitCostCents,item.totalCents);}
      writeAudit(db,{action:'purchase.order.update',entity:'purchase-order',entityId:String(id),actor,context:{supplierId,totalCents:total}},now);return get(id);
    });
  }

  function submit(id,actor=null){
    requireOrder(id,['DRAFT']);const timestamp=now();db.prepare("UPDATE purchase_orders SET status='ORDERED',ordered_at=?,updated_at=? WHERE id=?").run(timestamp,timestamp,String(id));writeAudit(db,{action:'purchase.order.submit',entity:'purchase-order',entityId:String(id),actor,context:{}},now);return get(id);
  }

  function getReceipt(id){const row=db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(String(id));if(!row)return null;return{
    id:row.id,purchaseOrderId:row.purchase_order_id,supplierId:row.supplier_id,receivedBy:row.received_by,documentNumber:row.document_number,notes:row.notes,createdAt:row.created_at,
    items:db.prepare(`SELECT id,receipt_id AS receiptId,purchase_order_item_id AS purchaseOrderItemId,product_id AS productId,quantity,unit_cost_cents AS unitCostCents,lot_id AS lotId FROM purchase_receipt_items WHERE receipt_id=? ORDER BY id`).all(row.id).map(item=>({...item,quantity:roundQuantity(item.quantity)}))
  };}

  function receive(id,input={},actor=null){
    const receiptId=String(input.receiptId||input.id||idFactory('receipt'));
    const previous=getReceipt(receiptId);if(previous)return{receipt:previous,order:get(previous.purchaseOrderId),idempotent:true};
    const order=requireOrder(id,['ORDERED','PARTIAL']);if(!Array.isArray(input.items)||!input.items.length)throw new Error('Recebimento precisa de ao menos um item.');
    return withTransaction(db,()=>{
      const timestamp=now();const receivedBy=userIdOrNull(actor);
      db.prepare(`INSERT INTO purchase_receipts(id,purchase_order_id,supplier_id,received_by,document_number,notes,created_at) VALUES(?,?,?,?,?,?,?)`).run(receiptId,String(id),order.supplier_id,receivedBy,input.documentNumber||null,input.notes||null,timestamp);
      let receiptTotal=0;
      for(const requested of input.items){
        const itemId=String(requested.purchaseOrderItemId||'').trim();const row=db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND purchase_order_id=?').get(itemId,String(id));if(!row)throw new Error('Item do pedido nao encontrado.');
        const quantity=roundQuantity(Number(requested.quantity||0));if(quantity<=0)throw new Error('Quantidade recebida deve ser maior que zero.');const remaining=roundQuantity(Number(row.ordered_quantity)-Number(row.received_quantity));if(quantity>remaining)throw new Error(`Quantidade recebida excede o saldo do item (${remaining}).`);
        const unitCostCents=assertCents(Number(requested.unitCostCents??row.unit_cost_cents),'unitCostCents');if(unitCostCents<0)throw new Error('Custo recebido invalido.');
        const product=db.prepare('SELECT track_stock AS trackStock,track_lots AS trackLots FROM products WHERE id=?').get(row.product_id);let lotId=null;
        if(Boolean(product?.trackLots)||requested.lot||requested.lotId){if(!lots)throw new Error('Servico de lotes indisponivel.');const lot=lots.receivePurchase({productId:row.product_id,supplierId:order.supplier_id,lot:requested.lot||null,lotId:requested.lotId||null,quantity,unitCostCents,sourceId:receiptId,eventId:`purchase-lot:${receiptId}:${itemId}`,actor});lotId=lot.id;}
        if(Boolean(product?.trackStock))inventory.move({productId:row.product_id,type:'purchase',quantityDelta:quantity,reason:'Recebimento de compra',sourceType:'purchase-receipt',sourceId:receiptId,eventId:`purchase:${receiptId}:${itemId}`,createdAt:timestamp},actor);
        db.prepare('UPDATE purchase_order_items SET received_quantity=received_quantity+? WHERE id=?').run(quantity,itemId);
        db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_cost_cents,lot_id) VALUES(?,?,?,?,?,?,?)`).run(idFactory('receipt-item'),receiptId,itemId,row.product_id,quantity,unitCostCents,lotId);
        if(input.updateProductCost===true)db.prepare('UPDATE products SET cost_cents=?,updated_at=? WHERE id=?').run(unitCostCents,timestamp,row.product_id);
        receiptTotal+=Math.round(unitCostCents*quantity);
      }
      const pending=db.prepare('SELECT COUNT(*) AS count FROM purchase_order_items WHERE purchase_order_id=? AND received_quantity+0.000001<ordered_quantity').get(String(id)).count;const status=pending?'PARTIAL':'RECEIVED';
      db.prepare(`UPDATE purchase_orders SET status=?,received_at=?,updated_at=? WHERE id=?`).run(status,status==='RECEIVED'?timestamp:null,timestamp,String(id));
      if(input.payableDueAt){const existing=db.prepare("SELECT id FROM financial_entries WHERE source_type='purchase-receipt' AND source_id=? AND status<>'CANCELLED'").get(receiptId);if(!existing)finance.createEntry({kind:'PAYABLE',description:`Compra ${order.order_number}${input.documentNumber?` - ${input.documentNumber}`:''}`,category:'Compras',amountCents:receiptTotal,dueAt:input.payableDueAt,sourceType:'purchase-receipt',sourceId:receiptId,notes:input.notes||null},actor);}
      writeAudit(db,{action:'purchase.receipt.create',entity:'purchase-receipt',entityId:receiptId,actor,context:{purchaseOrderId:String(id),receiptTotal,status}},now);
      return{receipt:getReceipt(receiptId),order:get(id),idempotent:false};
    });
  }

  function cancel(id,{reason='',actor=null}={}){const order=requireOrder(id,['DRAFT','ORDERED','PARTIAL']);const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo do cancelamento da compra.');const timestamp=now();db.prepare("UPDATE purchase_orders SET status='CANCELLED',cancelled_at=?,updated_at=?,notes=? WHERE id=?").run(timestamp,timestamp,[order.notes,`CANCELAMENTO: ${text}`].filter(Boolean).join(' | '),String(id));writeAudit(db,{action:'purchase.order.cancel',entity:'purchase-order',entityId:String(id),actor,context:{reason:text}},now);return get(id);}

  function list(filters={}){const clauses=[];const params=[];if(filters.status){clauses.push('status=?');params.push(String(filters.status).toUpperCase());}if(filters.supplierId){clauses.push('supplier_id=?');params.push(String(filters.supplierId));}if(filters.from){clauses.push('created_at>=?');params.push(String(filters.from));}if(filters.to){clauses.push('created_at<=?');params.push(String(filters.to));}return db.prepare(`SELECT * FROM purchase_orders${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params).map(mapOrder);}

  function createDraftFromSuggestions({supplierId,suggestions=[],orderNumber=null,expectedAt=null,notes='Gerado a partir de sugestoes de reposicao'}={},actor=null){
    const selected=(suggestions||[]).filter(item=>Number(item.recommendedQuantity)>0);if(!selected.length)throw new Error('Selecione ao menos uma sugestao com quantidade positiva.');
    return createDraft({supplierId,orderNumber:orderNumber||`REP-${Date.now()}`,expectedAt,notes,items:selected.map(item=>({productId:item.productId,quantity:item.recommendedQuantity,unitCostCents:item.unitCostCents??db.prepare('SELECT cost_cents AS cost FROM products WHERE id=?').get(String(item.productId))?.cost??0}))},actor);
  }

  return{createDraft,updateDraft,submit,receive,cancel,get,list,getReceipt,createDraftFromSuggestions};
}

module.exports={createPurchasingService};
