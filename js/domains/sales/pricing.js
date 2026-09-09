'use strict';
const { assertCents } = require('../shared/money');
const { roundQuantity } = require('../inventory/inventory-rules');
function calculateSaleTotals({items=[],discountCents=0}={}){
  assertCents(discountCents,'discountCents');
  if(discountCents<0) throw new Error('Desconto nao pode ser negativo.');
  let subtotalCents=0;
  for(const item of items){
    assertCents(item.unitPriceCents,'unitPriceCents');
    const quantity=roundQuantity(item.quantity);
    if(quantity<=0) throw new Error('Quantidade deve ser maior que zero.');
    subtotalCents+=Math.round(item.unitPriceCents*quantity);
  }
  if(!Number.isSafeInteger(subtotalCents)) throw new RangeError('Subtotal excede limite seguro.');
  const appliedDiscount=Math.min(discountCents,subtotalCents);
  return {subtotalCents,discountCents:appliedDiscount,totalCents:subtotalCents-appliedDiscount};
}
module.exports={calculateSaleTotals};
