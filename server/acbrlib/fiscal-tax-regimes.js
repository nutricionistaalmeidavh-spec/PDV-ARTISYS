'use strict';
// Reviewed fiscal ICMS/PIS/COFINS mapping for ACBrLib. NOT a tax classifier.
// Every rate, exemption, retained ST amount and CSOSN/CST originates in
// per-product accountant-reviewed configuration; no rate is guessed.
function cents(value,label){
 if(!Number.isSafeInteger(value)||value<0)throw Error('Valor fiscal inválido: '+label);
 return value;
}
const brl=value=>(cents(value,'valor')/100).toFixed(2);
function rate(value,label){
 const str=String(value??'');
 if(!/^[0-9]{1,3}\.[0-9]{4}$/.test(str))throw Error('Alíquota fiscal revisada obrigatória: '+label);
 const [whole,fraction]=str.split('.');
 const units=Number(whole)*10000+Number(fraction);
 if(units>1000000)throw Error('Alíquota fiscal superior a 100%: '+label);
 return {text:str,units};
}
function amount(base,percentage){
 const raw=cents(base,'base fiscal')*percentage.units;
 if(!Number.isSafeInteger(raw))throw Error('Cálculo fiscal excedeu o limite de precisão');
 return Math.round(raw/1000000);
}
function reviewed(profile){
 if(!profile||typeof profile!=='object'||!String(profile.reviewedBy||'').trim()
   ||!/^\d{4}-\d{2}-\d{2}$/.test(String(profile.reviewedAt||'')))
  throw Error('Perfil tributário não revisado pela contabilidade');
}
function origin(profile){
 const s=String(profile.origin??'');
 if(!/^[0-8]$/.test(s))throw Error('Origem fiscal inválida');
 return s;
}
function requiredReviewedZero(profile,context){
 if(profile.zeroLegacyTaxesConfirmed!==true)
  throw Error(context+': tratamento fiscal zero precisa confirmação explícita de revisão contábil');
}
function stRetained(profile){
 const r=profile.icmsRetained;
 if(!r)throw Error('ICMS ST retido exige base e imposto retidos revisados');
 const base=cents(r.baseCents,'base ST retida'),paid=cents(r.amountCents,'ICMS ST retido');
 return {vBCSTRet:brl(base),vICMSSTRet:brl(paid)};
}
function stDue(profile){
 const r=profile.icmsSt;
 if(!r)throw Error('ICMS ST devido exige base, alíquota e valor explicitamente revisados');
 const base=cents(r.baseCents,'base ST'),paid=cents(r.amountCents,'ICMS ST');
 const p=rate(r.rate,'ICMS ST');
 // Do not calculate or assume ST value from the rate alone: deductions,
 // MVA, credit, FCP and local rules may change it. Values must be reviewed.
 if(base<1||paid<1)throw Error('ICMS ST não pode ser presumido como zero');
 return {fields:{modBCST:4,vBCST:brl(base),pICMSST:p.text,vICMSST:brl(paid)},base,paid};
}
function ownIcms(profile,net,{reduced=false}={}){
 if(!profile.icms)throw Error('ICMS exige alíquota e base tributável revisadas');
 const cfg=profile.icms,basisRate=rate(cfg.basePercent,'base ICMS'),
  ir=rate(cfg.rate,'ICMS');
 if(!reduced&&basisRate.units!==1000000)
  throw Error('Redução de base ICMS exige CST apropriado');
 if(reduced){
  const reduction=rate(cfg.reduction,'redução de base ICMS (pRedBC)');
  if(reduction.units+basisRate.units!==1000000)
   throw Error('Base e percentual de redução ICMS divergentes');
 }
 const base=amount(net,basisRate),tax=amount(base,ir);
 return {fields:{modBC:3,
  ...(reduced?{pRedBC:cfg.reduction}:{}),
  vBC:brl(base),pICMS:ir.text,vICMS:brl(tax)},base,tax};
}
function simpleCredit(profile,net){
 const cfg=profile.simpleCredit;
 if(!cfg)throw Error('Crédito Simples exige alíquota e valor explicitamente revisados');
 const cr=rate(cfg.rate,'crédito Simples Nacional');
 const calculated=amount(net,cr),given=cents(cfg.amountCents,'crédito do Simples');
 if(Math.abs(calculated-given)>1)throw Error('Crédito do Simples diverge da alíquota');
 return {pCredSN:cr.text,vCredICMSSN:brl(given)};
}
function zeroPisCofins(profile,code){
 requiredReviewedZero(profile,'PIS/COFINS');
 return {CST:code};
}
function contribution(profile,net,kind){
 const key=kind.toLowerCase(),cst=String(profile[kind==='PIS'?'pisCst':'cofinsCst']||'');
 if(!/^\d{2}$/.test(cst))throw Error(kind+' exige CST revisado');
 if(['01','02'].includes(cst)){
  const config=profile[key];
  if(!config)throw Error('Alíquota '+kind+' não informada');
  const r=rate(config.rate,kind);
  const value=amount(net,r);
  return {fields:{CST:cst,vBC:brl(net),[kind==='PIS'?'pPIS':'pCOFINS']:r.text,
   [kind==='PIS'?'vPIS':'vCOFINS']:brl(value)},total:value};
 }
 if(['04','05','06','07','08','09','49'].includes(cst)){
  return {fields:zeroPisCofins(profile,cst),total:0};
 }
 throw Error('CST '+kind+' '+cst+' exige mapeamento fiscal específico');
}
function compileLegacyTaxGroups({profile,crt,netCents}={}){
 reviewed(profile);
 const n=cents(netCents,'valor líquido do produto');
 const orig=origin(profile),mode=String(crt??'');
 if(!['1','2','3','4'].includes(mode))throw Error('CRT do emitente não suportado');
 const sections={},totals={icmsCents:0,icmsBaseCents:0,stCents:0,stBaseCents:0,pisCents:0,cofinsCents:0};
 let icms;
 if(mode==='3'||mode==='2'){
  const cst=String(profile.cst||'');
  if(!/^\d{2}$/.test(cst))throw Error('CRT 3 exige CST ICMS revisado; CSOSN não é válido neste regime');
  icms={CST:cst,orig};
  if(['00','10','20','70'].includes(cst)){
   const result=ownIcms(profile,n,{reduced:['20','70'].includes(cst)});
   Object.assign(icms,result.fields);
   totals.icmsBaseCents=result.base;totals.icmsCents=result.tax;
  }else if(['40','41','50','30'].includes(cst)){
   requiredReviewedZero(profile,'ICMS CST '+cst);
  }else if(cst==='60'){
   Object.assign(icms,stRetained(profile));
  }else{
   throw Error('CST ICMS '+cst+' não mapeado: revisão fiscal obrigatória');
  }
  if(['10','30','70'].includes(cst)){
   const st=stDue(profile);Object.assign(icms,st.fields);
   totals.stBaseCents=st.base;totals.stCents=st.paid;
  }
 }else{
  const csosn=String(profile.csosn||'');
  if(!/^\d{3}$/.test(csosn))throw Error('CRT Simples/MEI exige CSOSN revisado; CST não é válido neste regime');
  if(mode==='4'&&!['102','300','400'].includes(csosn))
    throw Error('MEI CRT 4 exige CSOSN compatível; outros códigos rejeitados');
  icms={CSOSN:csosn,orig};
  if(['102','103','300','400'].includes(csosn)){
   requiredReviewedZero(profile,'ICMS CSOSN '+csosn);
  }else if(csosn==='500'){
   Object.assign(icms,stRetained(profile));
  }else if(['101','201','202','203'].includes(csosn)){
   if(['101','201'].includes(csosn))Object.assign(icms,simpleCredit(profile,n));
   if(['201','202','203'].includes(csosn)){
    const st=stDue(profile);Object.assign(icms,st.fields);
    totals.stBaseCents=st.base;totals.stCents=st.paid;
   }
  }else{
   throw Error('CSOSN '+csosn+' requer tratamento tributário especializado');
  }
 }
 sections.ICMS=icms;
 const pis=contribution(profile,n,'PIS'),cofins=contribution(profile,n,'COFINS');
 sections.PIS=pis.fields;sections.COFINS=cofins.fields;
 totals.pisCents=pis.total;totals.cofinsCents=cofins.total;
 return {sections,totals};
}
module.exports={compileLegacyTaxGroups,rate,amount};
