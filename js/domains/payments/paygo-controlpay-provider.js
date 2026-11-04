'use strict';
// Optional PayGo ControlPay adapter. Vendor product and terminal enrollment are
// NOT part of the ArtiSys free self-hosted core. No credential is persisted here.
// API contract: https://paygodev.readme.io/docs/exemplo-de-fluxo-m%C3%ADnimo-para-uso
const DEFAULT_TIMEOUT_MS=20000;
function centavosToBRL(amount){
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Valor TEF invalido.');
  return(Math.trunc(amount/100))+','+String(amount%100).padStart(2,'0');
}
function brlToCentavos(text){
  const value=String(text||'').trim();
  const match=/^(\d{1,10}),(\d{2})$/.exec(value);
  if(!match)throw new Error('Valor informado pelo PayGo invalido.');
  const cents=Number(match[1])*100+Number(match[2]);
  if(!Number.isSafeInteger(cents))throw new Error('Valor informado pelo PayGo invalido.');
  return cents;
}
function createPayGoControlPayProvider({
  baseUrl,integrationKey,terminalId,requestImpl=null,
  fetchImpl=globalThis.fetch,timeoutMs=DEFAULT_TIMEOUT_MS
}={}){
  let origin;
  try{origin=new URL(String(baseUrl||''));}
  catch{throw new Error('Endpoint PayGo HTTPS obrigatorio.');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)
    throw new Error('Endpoint PayGo exige HTTPS sem segredo na URL.');
  if(!origin.pathname.endsWith('/'))throw new Error('Endpoint PayGo deve terminar com barra.');
  const secret=String(integrationKey||'').trim();
  if(!secret||secret.length>1024)throw new Error('Chave de integracao PayGo obrigatoria.');
  const terminal=String(terminalId||'').trim();
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(terminal))throw new Error('Terminal PayGo invalido.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error('Timeout PayGo invalido.');
  async function call(method,route,{query={},body=null}={}){
    const url=new URL(route,origin);
    if(url.origin!==origin.origin||!url.pathname.startsWith(origin.pathname))
      throw new Error('Rota PayGo nao autorizada.');
    url.searchParams.set('key',secret);
    for(const [key,value]of Object.entries(query))url.searchParams.set(key,String(value));
    if(requestImpl)return requestImpl(url.pathname+url.search,{method,body});
    if(typeof fetchImpl!=='function')throw new Error('Cliente HTTPS PayGo indisponivel.');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(url,{
        method,headers:{'Accept':'application/json','Content-Type':'application/json','User-Agent':'PdvArtiSys/2'},
        ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:controller.signal
      });
      if(!response?.ok)throw new Error('PayGo nao confirmou requisicao HTTP '+(response?.status||0)+'.');
      const raw=await response.text();
      if(Buffer.byteLength(raw,'utf8')>1024*1024)throw new Error('Resposta PayGo excede limite seguro.');
      let result;
      try{result=JSON.parse(raw);}catch{throw new Error('PayGo retornou resposta invalida.');}
      if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Resposta PayGo invalida.');
      return result;
    }catch(error){
      // Keep key, terminal and request URL out of errors and logs.
      if(error?.name==='AbortError')throw new Error('PayGo sem resposta: resultado indeterminado, nao repetir a cobranca.');
      if(/PayGo/.test(String(error?.message)))throw error;
      throw new Error('Falha de comunicacao PayGo: resultado indeterminado, nao repetir a cobranca.');
    }finally{clearTimeout(timer);}
  }
  function validCommand({txid,method,amountCents}={}){
    if(!/^[A-Za-z0-9]{26,35}$/.test(String(txid||'')))throw new Error('Identificador TEF invalido.');
    if(!['CREDIT_CARD','DEBIT_CARD'].includes(method))throw new Error('Metodo de cartao invalido.');
    centavosToBRL(amountCents);
  }
  const methodId=method=>method==='DEBIT_CARD'?22:21;
  return {
    async start({txid,method,amountCents,saleId}={}){
      validCommand({txid,method,amountCents});
      const response=await call('POST','Venda/Vender/',{body:{
        formaPagamentoId:methodId(method),
        pedidoId:null,terminalId:terminal,
        observacao:txid,aguardarTefIniciarTransacao:true,
        parcelamentoAdmin:true,quantidadeParcelas:1,
        valorTotalVendido:centavosToBRL(amountCents)
      }});
      const id=response?.intencaoVenda?.id;
      if(!Number.isSafeInteger(Number(id))||Number(id)<=0)
        throw new Error('PayGo nao retornou identificador de intencao valido: revisar antes de repetir.');
      // Starting the terminal is NOT evidence of authorization. Status must be
      // polled through the vendor (and external payment settled) before checkout.
      return{status:'PENDING',txid,amountCents,providerReference:String(id)};
    },
    async reconcile({txid,method,amountCents,providerReference}={}){
      validCommand({txid,method,amountCents});
      const id=String(providerReference||'').trim();
      if(!/^[0-9]{1,20}$/.test(id))throw new Error('Identificador de cobranca PayGo nao persistido.');
      const response=await call('GET','IntencaoVenda/GetById/',{query:{intencaoVendaId:id}});
      const sale=response?.intencaoVenda;
      if(!sale||String(sale.id)!==id)throw new Error('PayGo devolveu uma intencao de venda diferente.');
      const status=Number(sale?.intencaoVendaStatus?.id);
      if([20,25].includes(status))return{status:'DECLINED',txid};
      if(status!==10)return{status:'PENDING',txid};
      if(brlToCentavos(sale.valorFinalFormat)!==amountCents)throw new Error('PayGo confirmou valor diferente do solicitado.');
      if(Number(sale?.formaPagamento?.id)!==methodId(method))throw new Error('PayGo confirmou metodo de cartao diferente.');
      const payments=Array.isArray(sale.pagamentosExternos)?sale.pagamentosExternos:[];
      if(payments.length!==1||Number(payments[0]?.pagamentoExternoStatus?.id)!==15||
        !String(payments[0]?.autorizacao||'').trim()||!Number.isSafeInteger(Number(payments[0].id)))
        throw new Error('PayGo nao forneceu comprovacao completa do pagamento externo.');
      return{
        status:'APPROVED',txid,amountCents,providerReference:id,acquirer:'PAYGO',
        paymentExternalId:String(payments[0].id),
        authorizationCode:String(payments[0].autorizacao)
      };
    }
  };
}
module.exports={createPayGoControlPayProvider,centavosToBRL,brlToCentavos};
