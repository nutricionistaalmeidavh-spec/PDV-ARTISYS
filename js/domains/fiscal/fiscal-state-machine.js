'use strict';

const FISCAL_STATES=Object.freeze({
  PENDING:'PENDING',
  PROCESSING:'PROCESSING',
  AUTHORIZED:'AUTHORIZED',
  REJECTED:'REJECTED',
  UNKNOWN:'UNKNOWN',
  FAILED:'FAILED',
  CANCELLED:'CANCELLED'
});

const ALLOWED_TRANSITIONS=Object.freeze({
  PENDING:new Set(['PROCESSING','FAILED']),
  PROCESSING:new Set(['AUTHORIZED','REJECTED','UNKNOWN','FAILED']),
  AUTHORIZED:new Set(['CANCELLED']),
  REJECTED:new Set(),
  UNKNOWN:new Set(['AUTHORIZED','REJECTED','PENDING','FAILED']),
  FAILED:new Set(['PENDING']),
  CANCELLED:new Set()
});

const LEGACY_STATUS=Object.freeze({
  PENDING:'PENDING',
  PROCESSING:'PENDING',
  AUTHORIZED:'ISSUED',
  REJECTED:'FAILED',
  UNKNOWN:'FAILED',
  FAILED:'FAILED',
  CANCELLED:'CANCELLED'
});

function normalizeFiscalState(value){
  const state=String(value||'').trim().toUpperCase();
  if(!Object.values(FISCAL_STATES).includes(state)) throw new Error(`Estado fiscal invalido: ${state||'(vazio)'}.`);
  return state;
}

function assertFiscalTransition(from,to){
  const source=normalizeFiscalState(from);const target=normalizeFiscalState(to);
  if(source===target) return target;
  if(!ALLOWED_TRANSITIONS[source]?.has(target)) throw new Error(`Transicao fiscal invalida: ${source} -> ${target}.`);
  return target;
}

function legacyStatusFor(state){return LEGACY_STATUS[normalizeFiscalState(state)];}

function numericCStat(result){
  const value=result?.data?.cStat;
  if(value===null||value===undefined||value==='') return null;
  const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
}

function classifyIssueResult(result={}){
  if(result?.ok===true) return FISCAL_STATES.AUTHORIZED;
  const cStat=numericCStat(result);
  if(cStat===105) return FISCAL_STATES.UNKNOWN;
  const status=Number(result?.status||0);
  if(result?.indeterminate===true||status===0||status===408||status===504) return FISCAL_STATES.UNKNOWN;
  if(cStat!==null) return FISCAL_STATES.REJECTED;
  return FISCAL_STATES.FAILED;
}

function classifyReconcileResult(result={}){
  const cStat=numericCStat(result);
  if(result?.ok===true&&(cStat===null||cStat===100)) return 'AUTHORIZED';
  if(cStat===100) return 'AUTHORIZED';
  if(cStat===217) return 'NOT_FOUND';
  if(cStat===105||result?.indeterminate===true||[0,408,504].includes(Number(result?.status||0))) return 'UNKNOWN';
  if(cStat!==null) return 'REJECTED';
  return 'UNKNOWN';
}

module.exports={FISCAL_STATES,ALLOWED_TRANSITIONS,normalizeFiscalState,assertFiscalTransition,legacyStatusFor,classifyIssueResult,classifyReconcileResult};
