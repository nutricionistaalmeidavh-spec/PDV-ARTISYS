'use strict';

const { randomUUID } = require('node:crypto');
const { renderSaleReceipt } = require('./receipt-renderer');
const { renderTablePreBill, renderKitchenTicket, renderCashClose } = require('./non-fiscal-renderer');

function createNonFiscalPrintService({printService,storeName='ArtiSys',width=42,idFactory=prefix=>`${prefix}-${randomUUID()}`}={}){
  if(!printService)throw new TypeError('Print service is required.');
  function queue({id,type,entityType,entityId,text,printerName=null,terminalId=null}){
    return printService.queueJob({id:id||idFactory('print'),type,entityType,entityId,payload:{text,printerName:printerName||null,terminalId:terminalId||null},width});
  }
  function saleReceipt(sale,{printerName=null}={}){if(!sale?.id)throw new Error('Venda invalida.');return queue({type:'SALE_RECEIPT',entityType:'sale',entityId:sale.id,text:renderSaleReceipt({storeName,documentLabel:'CUPOM NAO FISCAL',sale,width}),printerName,terminalId:sale.terminalId});}
  function tablePreBill(session,{printerName=null}={}){if(!session?.id)throw new Error('Comanda invalida.');return queue({type:'TABLE_PREBILL',entityType:'table-session',entityId:session.id,text:renderTablePreBill({storeName,session,width}),printerName});}
  function kitchenTicket(ticket,{printerName=null,id=null}={}){if(!ticket?.id)throw new Error('Pedido de cozinha invalido.');return queue({id,type:'KITCHEN_TICKET',entityType:'kitchen-ticket',entityId:ticket.id,text:renderKitchenTicket({storeName,ticket,width}),printerName:printerName??ticket.printerName});}
  function cashClose(session,{printerName=null,id=null}={}){if(!session?.id)throw new Error('Caixa invalido.');return queue({id,type:'CASH_CLOSE',entityType:'cash-session',entityId:session.id,text:renderCashClose({storeName,session,width}),printerName,terminalId:session.terminalId});}
  function kitchenChangeNotice(ticket,{action='ALTERACAO DE ITEM',reason='',id=null}={}){
    if(!ticket?.id)throw new Error('Ticket de cozinha invalido.');
    const clean=value=>String(value||'').replace(/[\r\n]+/g,' ').slice(0,150);
    const lines=[
      storeName,
      '*** '+clean(action)+' ***',
      'Mesa: '+clean(ticket.tableLabel),
      'Setor: '+clean(ticket.stationName),
      'Ticket: '+clean(ticket.id),
      ...((ticket.items||[]).map(item=>String(item.quantity)+'x '+clean(item.productName)+(item.note?' - '+clean(item.note):''))),
      ...(reason?['Motivo: '+clean(reason)]:[]),
      'Comprovante operacional nao fiscal'
    ];
    return queue({id,type:'KITCHEN_TICKET',entityType:'kitchen-ticket',entityId:ticket.id,
      text:lines.join('\n'),printerName:ticket.printerName||null});
  }
  return{saleReceipt,tablePreBill,kitchenTicket,kitchenChangeNotice,cashClose};
}

module.exports={createNonFiscalPrintService};
