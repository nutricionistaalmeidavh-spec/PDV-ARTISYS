'use strict';

const { money, fit, center, columns } = require('./receipt-renderer');

function widthOf(width){const value=Number(width);if(![32,42,48].includes(value))throw new Error('Largura de cupom invalida.');return value;}
function tableHeading(session){return session?.tableLabel || session?.tableId || 'Mesa';}

function renderTablePreBill({storeName='ArtiSys',session,width=42}={}){
  const w=widthOf(width);if(!session?.id)throw new Error('Comanda invalida para impressao.');
  const lines=[center(storeName,w),center('PRE-CONTA - NAO FISCAL',w),'-'.repeat(w),fit(`Mesa: ${tableHeading(session)}`,w),fit(`Comanda: ${session.id}`,w),fit(`Abertura: ${session.openedAt||''}`,w),'-'.repeat(w)];
  const orders=(session.orders||[]).filter(order=>order.status!=='CANCELLED');
  for(const order of orders){for(const item of order.items||[]){lines.push(fit(item.productName||'Item',w));lines.push(columns(`${Number(item.quantity||0)} x ${money(item.unitPriceCents)}`,money(item.totalCents),w));if(item.note)lines.push(fit(`  Obs: ${item.note}`,w));}}
  lines.push('-'.repeat(w));lines.push(columns('TOTAL PARCIAL',money(session.totalCents),w));lines.push('-'.repeat(w));lines.push(center('Documento sem valor fiscal',w));
  return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
}

function renderKitchenTicket({storeName='ArtiSys',ticket,width=42}={}){
  const w=widthOf(width);if(!ticket?.id)throw new Error('Pedido de cozinha invalido para impressao.');
  const lines=[center(storeName,w),center(`PEDIDO - ${ticket.stationName||'COZINHA'}`,w),'-'.repeat(w),fit(`Mesa: ${ticket.tableLabel||ticket.tableId||'—'}`,w),fit(`Pedido: ${ticket.orderId||ticket.id}`,w),fit(`Hora: ${ticket.createdAt||''}`,w),'-'.repeat(w)];
  for(const item of ticket.items||[]){lines.push(fit(`${Number(item.quantity||0)}x ${item.productName||'Item'}`,w));if(item.note)lines.push(fit(`  OBS: ${item.note}`,w));}
  if(ticket.orderNote){lines.push('-'.repeat(w));lines.push(fit(`OBS GERAL: ${ticket.orderNote}`,w));}
  lines.push('-'.repeat(w));lines.push(center('PEDIDO INTERNO - NAO FISCAL',w));
  return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
}

function renderCashClose({storeName='ArtiSys',session,width=42}={}){
  const w=widthOf(width);if(!session?.id)throw new Error('Caixa invalido para impressao.');
  const lines=[center(storeName,w),center('FECHAMENTO DE CAIXA - NAO FISCAL',w),'-'.repeat(w),fit(`Sessao: ${session.id}`,w),fit(`Operador: ${session.operatorId||''}`,w),fit(`Abertura: ${session.openedAt||''}`,w),fit(`Fechamento: ${session.closedAt||''}`,w),'-'.repeat(w),columns('Inicial',money(session.initialCashCents),w),columns('Esperado',money(session.expectedCashCents),w),columns('Contado',money(session.countedCashCents),w),columns('Divergencia',money(session.divergenceCents),w),'-'.repeat(w),center('Documento sem valor fiscal',w)];
  return `${lines.map(line=>fit(line,w)).join('\n')}\n`;
}

module.exports={renderTablePreBill,renderKitchenTicket,renderCashClose};
