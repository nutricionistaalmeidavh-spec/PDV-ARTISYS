'use strict';

const { createHash } = require('node:crypto');
const { validateReference } = require('./fiscal-core');

const DOCUMENT_MODELS = Object.freeze({ nfce:'65', nfe:'55' });
const ENVIRONMENTS = new Set(['homologation', 'production']);

function assertCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} deve ser inteiro nao negativo em centavos.`);
  return value;
}

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} obrigatorio.`);
  return text;
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function deriveNumericCode({ issuerCnpj, model, series, number, reference }) {
  const seed = [issuerCnpj, model, series, number, reference].map(value => String(value ?? '').trim()).join('|');
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  let value = digest.readUInt32BE(0) % 100000000;
  const invoiceDigits = digits(number).slice(-8).padStart(8, '0');
  let code = String(value).padStart(8, '0');
  if (code === '00000000' || code === invoiceDigits) {
    value = (value + 1) % 100000000 || 1;
    code = String(value).padStart(8, '0');
  }
  return code;
}

function allocateDiscountCents(items = [], discountCents = 0) {
  const discount = assertCents(Number(discountCents), 'Desconto');
  const totals = items.map((item, index) => assertCents(Number(item?.totalCents), `Total do item ${index + 1}`));
  const subtotal = totals.reduce((sum, value) => sum + value, 0);
  if (discount > subtotal) throw new Error('Desconto nao pode exceder o subtotal.');
  if (!totals.length || discount === 0) return totals.map(() => 0);
  if (subtotal === 0) throw new Error('Nao e possivel ratear desconto sobre subtotal zero.');

  const allocations = totals.map(total => Math.floor((discount * total) / subtotal));
  let remaining = discount - allocations.reduce((sum, value) => sum + value, 0);
  const ranking = totals
    .map((total, index) => ({ index, remainder:(discount * total) % subtotal }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let i = 0; i < remaining; i += 1) allocations[ranking[i % ranking.length].index] += 1;
  return allocations;
}

function validateFiscalTax(tax, productId, crt) {
  if (!tax || typeof tax !== 'object') throw new Error(`Dados fiscais ausentes para produto ${productId}.`);
  const normalized = {
    ncm:requiredText(tax.ncm, `NCM do produto ${productId}`),
    cest:tax.cest ? String(tax.cest).trim() : null,
    cfop:requiredText(tax.cfop, `CFOP do produto ${productId}`),
    unit:requiredText(tax.unit, `Unidade tributavel do produto ${productId}`).toUpperCase(),
    origin:requiredText(tax.origin, `Origem do produto ${productId}`),
    csosn:tax.csosn ? String(tax.csosn).trim() : null,
    icmsCst:tax.icmsCst ? String(tax.icmsCst).trim() : null,
    pisCst:requiredText(tax.pisCst, `CST PIS do produto ${productId}`),
    cofinsCst:requiredText(tax.cofinsCst, `CST COFINS do produto ${productId}`),
    rtc:tax.rtc && typeof tax.rtc === 'object' ? structuredClone(tax.rtc) : null
  };
  if (String(crt) === '1' && !normalized.csosn) throw new Error(`CSOSN obrigatorio para produto ${productId}.`);
  if (String(crt) !== '1' && !normalized.icmsCst && !normalized.csosn) throw new Error(`CST/CSOSN ICMS obrigatorio para produto ${productId}.`);
  return normalized;
}

function buildFiscalDocument({ sale, fiscalContext, documentType = 'nfce', environment = 'homologation', reference } = {}) {
  if (!sale || typeof sale !== 'object') throw new Error('Venda obrigatoria para documento fiscal.');
  if (String(sale.status || '').toUpperCase() !== 'COMPLETED') throw new Error('Somente venda concluida pode gerar documento fiscal.');
  const type = String(documentType || '').trim().toLowerCase();
  if (!DOCUMENT_MODELS[type]) throw new Error('Tipo de documento fiscal invalido para builder.');
  const env = String(environment || '').trim().toLowerCase();
  if (!ENVIRONMENTS.has(env)) throw new Error('Ambiente fiscal invalido para builder.');
  const context = fiscalContext && typeof fiscalContext === 'object' ? fiscalContext : {};
  const issuerInput = context.issuer && typeof context.issuer === 'object' ? context.issuer : {};
  const addressInput = issuerInput.address && typeof issuerInput.address === 'object' ? issuerInput.address : {};
  const crt = requiredText(issuerInput.crt, 'CRT do emitente');
  const issuer = {
    cnpj:requiredText(digits(issuerInput.cnpj), 'CNPJ do emitente'),
    legalName:requiredText(issuerInput.legalName, 'Razao social do emitente'),
    tradeName:String(issuerInput.tradeName || issuerInput.legalName || '').trim(),
    stateRegistration:requiredText(digits(issuerInput.stateRegistration), 'Inscricao estadual do emitente'),
    crt,
    address:{
      street:requiredText(addressInput.street, 'Logradouro do emitente'),
      number:requiredText(addressInput.number, 'Numero do emitente'),
      complement:String(addressInput.complement || '').trim() || null,
      district:requiredText(addressInput.district, 'Bairro do emitente'),
      cityCode:requiredText(digits(addressInput.cityCode), 'Codigo IBGE do municipio'),
      city:requiredText(addressInput.city, 'Municipio do emitente'),
      state:requiredText(addressInput.state, 'UF do emitente').toUpperCase(),
      zip:requiredText(digits(addressInput.zip), 'CEP do emitente')
    }
  };

  const saleItems = Array.isArray(sale.items) ? sale.items : [];
  if (!saleItems.length) throw new Error('Venda sem itens nao pode gerar documento fiscal.');
  const subtotalCents = assertCents(Number(sale.subtotalCents), 'Subtotal da venda');
  const discountCents = assertCents(Number(sale.discountCents || 0), 'Desconto da venda');
  const totalCents = assertCents(Number(sale.totalCents), 'Total da venda');
  if (subtotalCents - discountCents !== totalCents) throw new Error('Total canonico inconsistente na venda.');
  const itemSubtotal = saleItems.reduce((sum, item, index) => sum + assertCents(Number(item?.totalCents), `Total do item ${index + 1}`), 0);
  if (itemSubtotal !== subtotalCents) throw new Error('Subtotal canonico dos itens difere do subtotal da venda.');

  const discounts = allocateDiscountCents(saleItems, discountCents);
  const fiscalItems = saleItems.map((item, index) => {
    const productId = requiredText(item.productId, `Produto do item ${index + 1}`);
    const tax = validateFiscalTax(context.items?.[productId], productId, crt);
    const grossCents = assertCents(Number(item.totalCents), `Total do produto ${productId}`);
    const unitPriceCents = assertCents(Number(item.unitPriceCents), `Preco unitario do produto ${productId}`);
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Quantidade fiscal invalida para produto ${productId}.`);
    return {
      line:index + 1,
      sourceItemId:String(item.id || ''),
      productId,
      code:String(item.sku || productId),
      description:requiredText(item.productName, `Descricao do produto ${productId}`),
      quantity,
      unit:tax.unit,
      unitPriceCents,
      grossCents,
      totalCents:grossCents,
      discountCents:discounts[index],
      netCents:grossCents - discounts[index],
      tax
    };
  });
  const allocatedNet = fiscalItems.reduce((sum, item) => sum + item.netCents, 0);
  if (allocatedNet !== totalCents) throw new Error('Rateio fiscal nao preservou o total canonico da venda.');

  const payments = (Array.isArray(sale.payments) ? sale.payments : []).map((payment, index) => ({
    method:requiredText(payment.method, `Forma de pagamento ${index + 1}`).toUpperCase(),
    amountCents:assertCents(Number(payment.amountCents), `Pagamento ${index + 1}`)
  }));
  const paymentCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const changeCents = assertCents(Number(sale.changeCents || 0), 'Troco da venda');
  if (paymentCents - changeCents !== totalCents) throw new Error('Pagamentos da venda nao reconciliam com o total canonico.');

  const fiscalReference = validateReference(reference || sale.saleNumber || sale.id);
  const series = requiredText(context.series, 'Serie fiscal');
  const number = requiredText(context.number, 'Numero fiscal');
  const model = DOCUMENT_MODELS[type];
  return {
    schemaVersion:1,
    documentType:type,
    environment:env,
    reference:fiscalReference,
    source:{ saleId:String(sale.id), saleNumber:String(sale.saleNumber || sale.id) },
    issuer,
    recipient:context.recipient && typeof context.recipient === 'object' ? structuredClone(context.recipient) : null,
    identification:{
      model,
      series,
      number,
      numericCode:deriveNumericCode({ issuerCnpj:issuer.cnpj, model, series, number, reference:fiscalReference }),
      operationNature:requiredText(context.operationNature || 'VENDA', 'Natureza da operacao'),
      issuedAt:requiredText(sale.completedAt, 'Data de conclusao da venda')
    },
    items:fiscalItems,
    payments,
    totals:{ subtotalCents, discountCents, totalCents, paymentCents, changeCents }
  };
}

module.exports = {
  DOCUMENT_MODELS,
  deriveNumericCode,
  allocateDiscountCents,
  buildFiscalDocument
};
