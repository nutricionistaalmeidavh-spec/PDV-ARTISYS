'use strict';

function parseDate(value,fallback){if(value==null||value==='')return fallback;const time=Date.parse(String(value));if(!Number.isFinite(time))throw new Error('Periodo de relatorio invalido.');return new Date(time).toISOString();}
function csvCell(value){const text=String(value==null?'':value);return /[;"\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}
function round3(value){return Math.round(Number(value||0)*1000)/1000;}

function createAdvancedReportingService({db,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');
  function period(filters={}){return{from:parseDate(filters.from,'1970-01-01T00:00:00.000Z'),to:parseDate(filters.to,'9999-12-31T23:59:59.999Z')};}
  function tableExists(name){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(String(name)));}

  function buildAdvancedSalesAnalytics(filters={}){
    const p=period(filters);
    const sales=db.prepare(`SELECT s.*,COALESCE(s.seller_id,s.operator_id) AS sellerId,COALESCE(s.seller_name_snapshot,u.name,'Nao identificado') AS sellerName
      FROM sales s LEFT JOIN users u ON u.id=COALESCE(s.seller_id,s.operator_id)
      WHERE s.status='COMPLETED' AND s.completed_at>=? AND s.completed_at<=? ORDER BY s.completed_at,s.id`).all(p.from,p.to);
    const cancelled=db.prepare(`SELECT s.*,COALESCE(s.seller_id,s.operator_id) AS sellerId,COALESCE(s.seller_name_snapshot,u.name,'Nao identificado') AS sellerName
      FROM sales s LEFT JOIN users u ON u.id=COALESCE(s.seller_id,s.operator_id)
      WHERE s.status='CANCELLED' AND s.cancelled_at>=? AND s.cancelled_at<=? ORDER BY s.cancelled_at,s.id`).all(p.from,p.to);
    const saleIds=new Set(sales.map(s=>s.id));
    const itemRows=saleIds.size?db.prepare(`SELECT si.*,p.cost_cents AS costCents,p.category_id AS categoryId,c.name AS categoryName,s.completed_at AS completedAt,
      COALESCE(s.seller_id,s.operator_id) AS sellerId FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id LEFT JOIN categories c ON c.id=p.category_id
      WHERE s.status='COMPLETED' AND s.completed_at>=? AND s.completed_at<=?`).all(p.from,p.to):[];
    const products=new Map();const categories=new Map();let overrideCount=0;let overrideDelta=0;
    for(const row of itemRows){
      const quantity=Number(row.quantity||0);const revenue=Number(row.total_cents||0);const cost=Math.round(Number(row.costCents||0)*quantity);const current=products.get(row.product_id)||{productId:row.product_id,productName:row.product_name,quantity:0,grossRevenueCents:0,costCents:0,grossMarginCents:0};current.quantity=round3(current.quantity+quantity);current.grossRevenueCents+=revenue;current.costCents+=cost;current.grossMarginCents+=revenue-cost;products.set(row.product_id,current);
      const categoryId=row.categoryId||'uncategorized';const category=categories.get(categoryId)||{categoryId:row.categoryId||null,categoryName:row.categoryName||'Sem categoria',quantity:0,grossRevenueCents:0,costCents:0,grossMarginCents:0};category.quantity=round3(category.quantity+quantity);category.grossRevenueCents+=revenue;category.costCents+=cost;category.grossMarginCents+=revenue-cost;categories.set(categoryId,category);
      if(row.price_override_reason){overrideCount+=1;overrideDelta+=Math.round((Number(row.catalog_unit_price_cents??row.unit_price_cents)-Number(row.unit_price_cents))*quantity);}
    }
    const totalRevenue=[...products.values()].reduce((sum,row)=>sum+row.grossRevenueCents,0);const totalQuantity=[...products.values()].reduce((sum,row)=>sum+row.quantity,0);
    function abc(metric,total){let cumulative=0;return[...products.values()].sort((a,b)=>b[metric]-a[metric]||a.productName.localeCompare(b.productName)).map(row=>{cumulative+=row[metric];const share=total?row[metric]/total:0;const cumulativeShare=total?cumulative/total:0;return{productId:row.productId,productName:row.productName,quantity:row.quantity,grossRevenueCents:row.grossRevenueCents,share:Number(share.toFixed(4)),cumulativeShare:Number(cumulativeShare.toFixed(4)),class:cumulativeShare<=0.8?'A':cumulativeShare<=0.95?'B':'C'};});}
    const byHourMap=new Map();const byDayMap=new Map();for(const sale of sales){const date=new Date(sale.completed_at);const hour=date.getUTCHours();const day=date.getUTCDay();const h=byHourMap.get(hour)||{hour,salesCount:0,salesCents:0};h.salesCount++;h.salesCents+=Number(sale.total_cents||0);byHourMap.set(hour,h);const d=byDayMap.get(day)||{dayOfWeek:day,salesCount:0,salesCents:0};d.salesCount++;d.salesCents+=Number(sale.total_cents||0);byDayMap.set(day,d);}
    const returns=tableExists('return_transactions')?db.prepare(`SELECT rt.*,COALESCE(s.seller_id,s.operator_id) AS sellerId FROM return_transactions rt JOIN sales s ON s.id=rt.sale_id WHERE rt.status='COMPLETED' AND rt.created_at>=? AND rt.created_at<=?`).all(p.from,p.to):[];
    const sellers=new Map();for(const sale of sales){const id=sale.sellerId;const row=sellers.get(id)||{sellerId:id,sellerName:sale.sellerName,salesCount:0,grossSalesCents:0,returnedCents:0,cancelledSalesCount:0,cancelledSalesCents:0,totalDiscountCents:0,priceOverrideCount:0};row.salesCount++;row.grossSalesCents+=Number(sale.total_cents||0);row.totalDiscountCents+=Number(sale.discount_cents||0);sellers.set(id,row);}for(const row of itemRows){if(row.price_override_reason){const seller=sellers.get(row.sellerId);if(seller)seller.priceOverrideCount++;}}for(const ret of returns){const seller=sellers.get(ret.sellerId);if(seller)seller.returnedCents+=Number(ret.total_cents||0);}for(const sale of cancelled){const id=sale.sellerId;const row=sellers.get(id)||{sellerId:id,sellerName:sale.sellerName,salesCount:0,grossSalesCents:0,returnedCents:0,cancelledSalesCount:0,cancelledSalesCents:0,totalDiscountCents:0,priceOverrideCount:0};row.cancelledSalesCount++;row.cancelledSalesCents+=Number(sale.total_cents||0);sellers.set(id,row);}const sellerRows=[...sellers.values()].map(row=>({...row,netSalesCents:row.grossSalesCents-row.returnedCents,averageDiscountCents:row.salesCount?Math.round(row.totalDiscountCents/row.salesCount):0})).sort((a,b)=>b.netSalesCents-a.netSalesCents||a.sellerName.localeCompare(b.sellerName));
    const netSalesCents=sales.reduce((sum,row)=>sum+Number(row.total_cents||0),0)-returns.reduce((sum,row)=>sum+Number(row.total_cents||0),0);
    return{from:p.from,to:p.to,salesCount:sales.length,netSalesCents,averageTicketCents:sales.length?Math.round(sales.reduce((sum,row)=>sum+Number(row.total_cents||0),0)/sales.length):0,abcRevenue:abc('grossRevenueCents',totalRevenue),abcQuantity:abc('quantity',totalQuantity),margins:[...products.values()].sort((a,b)=>b.grossMarginCents-a.grossMarginCents||a.productName.localeCompare(b.productName)),categoryMargins:[...categories.values()].sort((a,b)=>b.grossMarginCents-a.grossMarginCents||a.categoryName.localeCompare(b.categoryName)),byHour:[...byHourMap.values()].sort((a,b)=>a.hour-b.hour),byDayOfWeek:[...byDayMap.values()].sort((a,b)=>a.dayOfWeek-b.dayOfWeek),sellers:sellerRows,priceOverrides:{count:overrideCount,deltaCents:overrideDelta}};
  }

  function buildInventoryAnalytics(filters={}){
    const p=period(filters);const asOf=parseDate(filters.asOf,now());
    const rows=db.prepare(`SELECT p.id AS productId,p.name,p.sku,p.minimum_stock AS minimumStock,COALESCE(b.quantity,0) AS quantity FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id WHERE p.active=1 AND p.track_stock=1 ORDER BY p.name,p.id`).all();
    const items=rows.map(row=>{const sold=Number(db.prepare(`SELECT COALESCE(SUM(si.quantity),0) AS quantity FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=? AND s.status='COMPLETED' AND s.completed_at>=? AND s.completed_at<=?`).get(row.productId,p.from,p.to)?.quantity||0);const last=db.prepare(`SELECT MAX(s.completed_at) AS lastSaleAt FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=? AND s.status='COMPLETED'`).get(row.productId)?.lastSaleAt||null;const daysSince=last?Math.max(0,Math.floor((Date.parse(asOf)-Date.parse(last))/86400000)):null;const quantity=round3(row.quantity);return{productId:row.productId,productName:row.name,sku:row.sku,quantity,minimumStock:round3(row.minimumStock),lowStock:quantity<=Number(row.minimumStock||0),quantitySold:round3(sold),lastSaleAt:last,daysSinceLastSale:daysSince,stale:last?daysSince>=30:true,turnoverEstimate:Number((sold/Math.max(quantity,1)).toFixed(3))};});
    return{from:p.from,to:p.to,asOf,lowStockCount:items.filter(row=>row.lowStock).length,stockoutCount:items.filter(row=>row.quantity<=0).length,staleCount:items.filter(row=>row.stale).length,items};
  }

  function buildPurchasingAnalytics(filters={}){
    if(!tableExists('purchase_receipts'))return{from:filters.from||null,to:filters.to||null,totalSpendCents:0,bySupplier:[],byProduct:[]};const p=period(filters);const rows=db.prepare(`SELECT pr.supplier_id AS supplierId,s.name AS supplierName,pri.product_id AS productId,p.name AS productName,pri.quantity,pri.unit_cost_cents AS unitCostCents,pr.created_at AS createdAt FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id=pri.receipt_id LEFT JOIN suppliers s ON s.id=pr.supplier_id LEFT JOIN products p ON p.id=pri.product_id WHERE pr.created_at>=? AND pr.created_at<=?`).all(p.from,p.to);const suppliers=new Map();const products=new Map();let total=0;for(const row of rows){const spend=Math.round(Number(row.quantity||0)*Number(row.unitCostCents||0));total+=spend;const s=suppliers.get(row.supplierId)||{supplierId:row.supplierId,supplierName:row.supplierName||'Nao identificado',quantity:0,spendCents:0};s.quantity=round3(s.quantity+Number(row.quantity||0));s.spendCents+=spend;suppliers.set(row.supplierId,s);const product=products.get(row.productId)||{productId:row.productId,productName:row.productName||'Nao identificado',quantity:0,spendCents:0};product.quantity=round3(product.quantity+Number(row.quantity||0));product.spendCents+=spend;products.set(row.productId,product);}return{from:p.from,to:p.to,totalSpendCents:total,bySupplier:[...suppliers.values()].sort((a,b)=>b.spendCents-a.spendCents||a.supplierName.localeCompare(b.supplierName)),byProduct:[...products.values()].sort((a,b)=>b.spendCents-a.spendCents||a.productName.localeCompare(b.productName))};
  }

  function exportAdvancedCsv(type,filters={}){
    const normalized=String(type||'sales').toLowerCase();let lines=[];
    if(normalized==='sales'){const report=buildAdvancedSalesAnalytics(filters);lines=['produto;quantidade;receita_centavos;margem_bruta_centavos;classe_abc'];const classes=new Map(report.abcRevenue.map(row=>[row.productId,row.class]));for(const row of report.margins)lines.push([row.productName,row.quantity,row.grossRevenueCents,row.grossMarginCents,classes.get(row.productId)||''].map(csvCell).join(';'));}
    else if(normalized==='inventory'){const report=buildInventoryAnalytics(filters);lines=['produto;sku;estoque;estoque_minimo;vendido_periodo;dias_sem_venda;giro_estimado'];for(const row of report.items)lines.push([row.productName,row.sku||'',row.quantity,row.minimumStock,row.quantitySold,row.daysSinceLastSale??'',row.turnoverEstimate].map(csvCell).join(';'));}
    else if(normalized==='purchasing'){const report=buildPurchasingAnalytics(filters);lines=['fornecedor;quantidade;gasto_centavos'];for(const row of report.bySupplier)lines.push([row.supplierName,row.quantity,row.spendCents].map(csvCell).join(';'));}
    else throw new Error('Tipo de relatorio avancado invalido.');
    return `${lines.join('\n')}\n`;
  }

  return{buildAdvancedSalesAnalytics,buildInventoryAnalytics,buildPurchasingAnalytics,exportAdvancedCsv};
}

module.exports={createAdvancedReportingService};
