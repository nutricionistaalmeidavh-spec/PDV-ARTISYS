'use strict';
const { ensurePdvFinance }=require('../js/domains/finance/pdv-finance-extension');
class PdvFinanceHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
async function readBody(req,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new PdvFinanceHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PdvFinanceHttpError(400,'JSON invalido.');}}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function pathMatch(pathname,pattern){const p=pattern.split('/').filter(Boolean),a=pathname.split('/').filter(Boolean);if(p.length!==a.length)return null;const out={};for(let i=0;i<p.length;i++){if(p[i].startsWith(':'))out[p[i].slice(1)]=decodeURIComponent(a[i]);else if(p[i]!==a[i])return null;}return out;}
function dateRange(url){const today=new Date().toISOString().slice(0,10);const month=`${today.slice(0,7)}-01`;return{from:url.searchParams.get('from')||month,to:url.searchParams.get('to')||today};}
function createErpFinanceRouter({runtime,sessionStore=null,bodyLimitBytes=1024*1024,requireTerminalAuth=false}={}){
  ensurePdvFinance(runtime);
  const sessions=sessionStore||new Map();
  function principal(req){const token=bearer(req);const session=sessions.get(token);if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new PdvFinanceHttpError(401,'Sessao invalida ou expirada.');}if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new PdvFinanceHttpError(401,'Terminal nao autorizado.');}return{userId:session.userId,role:session.role,terminalId:session.terminalId||null};}
  function manager(actor){if(!['admin','manager'].includes(String(actor?.role||'')))throw new PdvFinanceHttpError(403,'Permissao insuficiente.');}
  return async function erpFinanceRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/erp-finance/'))return false;
    try{
      const actor=principal(req);manager(actor);let match;
      if(pathname==='/api/v1/erp-finance/dre-groups'&&req.method==='GET'){json(res,200,runtime.financeDimensions.listDreGroups({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
      if(pathname==='/api/v1/erp-finance/categories'){
        if(req.method==='GET'){json(res,200,runtime.financeDimensions.listCategories({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
        if(req.method==='POST'){json(res,201,runtime.financeDimensions.saveCategory(await readBody(req,bodyLimitBytes),actor));return true;}
      }
      if(pathname==='/api/v1/erp-finance/cost-centers'){
        if(req.method==='GET'){json(res,200,runtime.financeDimensions.listCostCenters({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
        if(req.method==='POST'){json(res,201,runtime.financeDimensions.saveCostCenter(await readBody(req,bodyLimitBytes),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/erp-finance/entries/:id/dimensions'))&&req.method==='PATCH'){json(res,200,runtime.financeDimensions.setEntryDimensions(match.id,await readBody(req,bodyLimitBytes),actor));return true;}
      const range=dateRange(url);
      if(pathname==='/api/v1/erp-finance/dashboard'&&req.method==='GET'){json(res,200,runtime.financeManagement.dashboard(range));return true;}
      if(pathname==='/api/v1/erp-finance/dre'&&req.method==='GET'){json(res,200,runtime.financeManagement.dre({...range,basis:url.searchParams.get('basis')||'cash'}));return true;}
      if(pathname==='/api/v1/erp-finance/cashflow'&&req.method==='GET'){json(res,200,runtime.financeManagement.cashflow({...range,projectionDays:Number(url.searchParams.get('projectionDays')||30)}));return true;}
      if(pathname==='/api/v1/erp-finance/compare'&&req.method==='GET'){json(res,200,runtime.financeManagement.compare({...range,previousFrom:url.searchParams.get('previousFrom'),previousTo:url.searchParams.get('previousTo'),basis:url.searchParams.get('basis')||'cash'}));return true;}
      if(pathname==='/api/v1/erp-finance/drilldown'&&req.method==='GET'){const entryId=url.searchParams.get('entryId');if(!entryId)throw new PdvFinanceHttpError(400,'entryId obrigatorio.');try{json(res,200,runtime.financeManagement.drilldown({entryId}));}catch(error){if(/nao encontrado/i.test(error.message||''))throw new PdvFinanceHttpError(404,error.message);throw error;}return true;}
      throw new PdvFinanceHttpError(405,'Metodo nao permitido.');
    }catch(error){let status=error.statusCode||(/UNIQUE constraint failed/.test(error.message||'')?409:400);try{runtime.logger?.log({level:'warn',subsystem:'pdv-finance-http',message:error.message||'Erro interno.',context:{method:req.method,path:pathname,status}});}catch{}json(res,status,{error:error.message||'Erro interno.'});return true;}
  };
}
module.exports={createErpFinanceRouter,PdvFinanceHttpError};
