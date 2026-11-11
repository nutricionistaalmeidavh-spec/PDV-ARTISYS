'use strict';

(function(root, factory) {
  const model = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (root) root.PdvQuickStockRules = model;
})(typeof window !== 'undefined' ? window : null, function() {
  const units = new Set(['UN','KG','G','LT','CX']);

  function cents(value,label,required=false) {
    const raw=String(value ?? '').trim();
    if(!raw&&!required)return 0;
    if(!/^\d{1,9}(?:[,.]\d{1,2})?$/.test(raw)) {
      throw new Error(label+' inválido. Use 12,50, por exemplo.');
    }
    const parts=raw.replace(',','.').split('.');
    const amount=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
    if(!Number.isSafeInteger(amount)||(required&&amount<=0)) {
      throw new Error(label+' deve ser maior que zero.');
    }
    return amount;
  }

  function quantity(value) {
    const raw=String(value ?? '').trim().replace(',','.');
    if(!raw)return 0;
    if(!/^\d+(?:\.\d{1,3})?$/.test(raw)) {
      throw new Error('Quantidade inicial inválida. Use zero ou um número positivo com até três casas decimais.');
    }
    const amount=Number(raw);
    if(!Number.isFinite(amount)||amount<0)throw new Error('Quantidade inicial inválida.');
    return amount;
  }

  function normalizeQuickStockInput(input={}) {
    const name=String(input.name||'').trim();
    if(!name)throw new Error('Informe o nome do produto.');
    if(name.length>180)throw new Error('O nome deve ter no máximo 180 caracteres.');
    if(String(input.kind||'READY').toUpperCase()!=='READY')throw new Error('Item preparado precisa de ficha técnica e destino de produção. Use o cadastro de item preparado.');
    const unit=String(input.unit||'UN').trim().toUpperCase();
    if(!units.has(unit))throw new Error('Unidade inválida.');
    const openingQuantity=quantity(input.openingQuantity);
    const publish=Boolean(input.publish);
    if(publish&&openingQuantity<=0)throw new Error('Informe uma quantidade inicial maior que zero para colocar à venda ou desmarque a publicação.');
    return {
      product:{
        name,
        sku:String(input.sku||'').trim()||null,
        barcode:String(input.barcode||'').trim()||null,
        categoryId:String(input.categoryId||'').trim()||null,
        unit,
        usageType:'DIRECT',
        salePriceCents:cents(input.salePrice,'Preço de venda',true),
        costCents:cents(input.cost,'Custo'),
        minimumStock:0,
        trackStock:true,
        menuEnabled:false,
        active:true
      },
      openingQuantity,
      publish
    };
  }

  return Object.freeze({normalizeQuickStockInput});
});
