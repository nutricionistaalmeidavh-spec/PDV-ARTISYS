'use strict';

// Conservative, source-linked whitelist for NFC-e model 65 offline contingency.
// A state's participation in NFC-e does not automatically imply permission to
// issue in contingency. The State/SEFAZ can restrict individual taxpayers.
// This module is NOT an issuer credential / tax classification validator.
function policy(uf,deadlineRule,sourceUrl,extra={}){
 return Object.freeze({uf,deadlineRule,sourceUrl,...extra});
}
const OFFLINE_UF_POLICIES=Object.freeze({
 AC:policy('AC','next-business-day','https://sefaz.ac.gov.br/2021/?p=4850'),
 AL:policy('AL','next-business-day','https://www.sefaz.al.gov.br/nise/faq/documentos-fiscais-nfc-e/514-4-emissao-em-contingencia'),
 AM:policy('AM','24h','https://www.sefaz.am.gov.br/noticias/10204'),
 DF:policy('DF','next-business-day','https://www.sinj.df.gov.br/sinj/Norma/3efbac69483f4b74b65ffd53ba901b0a/Portaria_387_20_12_2019.html'),
 GO:policy('GO','next-business-day','https://goias.gov.br/economia/ocorrencia-de-problemas-tecnicos-3/'),
 MG:policy('MG','next-business-day','https://portalsped.fazenda.mg.gov.br/spedmg/nfce/Perguntas-Frequentes/respostas_iii/index.html'),
 MT:policy('MT','next-business-day','https://www5.sefaz.mt.gov.br/servicos?c=16773297&e=74924341&s=74925870'),
 PB:policy('PB','24h','https://sefaz.pb.gov.br/info/notas-fiscais/nfc-e'),
 PE:policy('PE','24h','https://www.sefaz.pe.gov.br/Servicos/Nota-Fiscal-de-Consumidor-Eletronica/Paginas/contingencia.aspx'),
 PR:policy('PR','24h','https://sped.fazenda.pr.gov.br/NFCe/Pagina/Contingencia'),
 RN:policy('RN','next-business-day','https://www.sefaz.rn.gov.br/postagem/nfce-contingencia/',{
  offlineSeriesMin:890,offlineSeriesMax:989
 }),
 RS:policy('RS','next-business-day','https://atendimento.receita.rs.gov.br/e-possivel-emitir-uma-nfc-e-em-contingencia'),
 SP:policy('SP','next-business-day','https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Conting%C3%AAncia.aspx')
});

function validSeries(series){
 if(!Number.isSafeInteger(series)||series<1||series>999)
  throw Error('Série fiscal deve ser inteira entre 1 e 999');
}

function assertOfflineAllowed({uf,model=65,series}={}){
 if(model!==65)throw Error('Contingência offline exclusiva da NFC-e modelo 65');
 validSeries(series);
 const policy=OFFLINE_UF_POLICIES[uf];
 if(!policy)throw Error('UF '+String(uf??'não informada')+
  ': contingência offline não mapeada para homologação nesta versão; conferir regra da SEFAZ');
 if(policy.offlineSeriesMin!==undefined&&
    (series<policy.offlineSeriesMin||series>policy.offlineSeriesMax))
  throw Error('SEFAZ/'+uf+': contingência NFC-e exige série '+
   policy.offlineSeriesMin+'–'+policy.offlineSeriesMax+
   ' exclusiva; configurar série de contingência aprovada');
 return policy;
}

function assertOrdinarySeriesAllowed({uf,model,series}={}){
 validSeries(series);
 const policy=OFFLINE_UF_POLICIES[uf];
 if(model===65&&policy?.offlineSeriesMin!==undefined&&
    series>=policy.offlineSeriesMin&&series<=policy.offlineSeriesMax)
  throw Error('SEFAZ/'+uf+': séries '+policy.offlineSeriesMin+'–'+
   policy.offlineSeriesMax+' reservadas à contingência, não usar para NFC-e normal');
}

function offlineMonitoringInfo({uf,issuedAt,now=null}={}){
 const policy=OFFLINE_UF_POLICIES[uf];
 if(!policy)throw Error('UF '+String(uf)+' não mapeada para contingência offline');
 const issued=Date.parse(issuedAt);
 if(!Number.isFinite(issued))throw Error('Data de emissão NFC-e offline inválida');
 const due=issued+24*60*60*1000;
 const current=now===null?Date.now():Date.parse(now);
 if(!Number.isFinite(current))throw Error('Relógio de monitoramento inválido');
 return {
  uf,deadlineRule:policy.deadlineRule,sourceUrl:policy.sourceUrl,
  // Conservative alert. "next-business-day" cannot be calculated safely
  // without state/municipal holidays and the taxpayer's local calendar.
  monitoringDueAt:new Date(due).toISOString(),
  monitoringOverdue:current>due,
  legalDeadlineAt:policy.deadlineRule==='24h'?new Date(due).toISOString():null,
  deadlineLabel:policy.deadlineRule==='24h'?
   'Transmitir em até 24 horas e assim que a conexão voltar':
   'Transmitir imediatamente após a reconexão, no máximo até o primeiro dia útil subsequente (verificar feriados locais com a contabilidade)'
 };
}

module.exports={OFFLINE_UF_POLICIES,assertOfflineAllowed,assertOrdinarySeriesAllowed,offlineMonitoringInfo};
