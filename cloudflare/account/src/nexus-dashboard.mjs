/** Commercial metrics are scoped to Nexus and contain no customer PII. */
export function daysUntil(expiresAt,now=new Date().toISOString()){
 const expiry=Date.parse(expiresAt||'');
 const current=Date.parse(now);
 if(!Number.isFinite(expiry)||!Number.isFinite(current))return null;
 return Math.max(0,Math.ceil((expiry-current)/86400000));
}
export function summarizeNexusLicenses(rows,now=new Date().toISOString()){
 const t=Date.parse(now);
 if(!Number.isFinite(t))throw Error('Data de referencia invalida');
 const kpi={totalTrials:0,activeTrials:0,expiring24h:0,expiredTrials:0,converted:0,conversionRatePct:0,
   failedWelcomeEmails:0,manualCommercial:0,suspendedOrCancelled:0,totalNexusLicenses:0,trialStartsLast7Days:0};
 for(const r of rows){
  if(r.product!=='PDV_NEXUS_2')continue;
  kpi.totalNexusLicenses++;
  let metadata={};
  try{metadata=JSON.parse(r.metadata_json||'{}')||{}}catch{}
  const isTrial=metadata.kind==='TRIAL';
  const converted=metadata.kind==='COMMERCIAL'&&metadata.source==='ADMIN_CONVERSION';
  const historicTrial=isTrial||converted;
  if(historicTrial)kpi.totalTrials++;
  if(converted)kpi.converted++;
  if(!historicTrial)kpi.manualCommercial++;
  if(r.welcome_status==='failed')kpi.failedWelcomeEmails++;
  const end=Date.parse(r.expires_at||'');
  if(r.status==='SUSPENDED'||r.status==='CANCELLED')kpi.suspendedOrCancelled++;
  if(isTrial){
   if(r.status==='ACTIVE'&&Number.isFinite(end)&&end>t){
    kpi.activeTrials++;
    if(end-t<=86400000)kpi.expiring24h++;
   }else if((Number.isFinite(end)&&end<=t)||r.status==='EXPIRED')kpi.expiredTrials++;
  }
  const created=Date.parse(r.created_at||'');
  if(historicTrial&&Number.isFinite(created)&&created<=t&&t-created<7*86400000)kpi.trialStartsLast7Days++;
 }
 kpi.conversionRatePct=kpi.totalTrials?Math.round(kpi.converted*10000/kpi.totalTrials)/100:0;
 return kpi;
}
