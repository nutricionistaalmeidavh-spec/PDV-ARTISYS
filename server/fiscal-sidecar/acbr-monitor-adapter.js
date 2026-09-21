'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderNfceIni, parseAcbrResponse, parseAcbrCancellationResponse } = require('./acbr-monitor-protocol');

function safeReference(value){return String(value||'documento').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,80)||'documento';}
function acbrQuotedValue(value){const text=String(value||'');if(!text||/[\r\n"]/u.test(text))throw new Error('Valor invalido para comando ACBrMonitor.');return `"${text}"`;}
function indeterminateTransport(error){const message=String(error?.message||error||'');return /timeout|sem resposta|ECONNRESET|ECONNABORTED|socket|connection.*closed|conexao.*encerrada/i.test(message);}
function validEnvironment(value){const env=String(value||'').toLowerCase();if(!['homologation','production'].includes(env))throw new Error('Ambiente fiscal invalido para ACBrMonitor.');return env;}
function accessKeyFromXml(xml){return String(xml||'').match(/Id=["']NFe([A-Z0-9]{44})["']/i)?.[1]?.toUpperCase()||null;}
function extractGeneratedXml(raw,fsImpl){
  const text=String(raw||'').trim();const inline=text.match(/(<\?xml[\s\S]*|<NFe[\s\S]*)/i)?.[1]||null;if(inline)return inline.trim();
  const candidate=text.match(/(?:criada em|arquivo)\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim().replace(/^"|"$/g,'')||null;
  if(candidate&&typeof fsImpl.existsSync==='function'&&fsImpl.existsSync(candidate)&&typeof fsImpl.readFileSync==='function')return String(fsImpl.readFileSync(candidate,'utf8')).trim();
  return null;
}

function createAcbrMonitorAdapter({ transport, fsImpl = fs, tempDir = os.tmpdir() } = {}) {
  if (!transport || typeof transport.send !== 'function') throw new TypeError('ACBrMonitor transport com send() e obrigatorio.');
  if (!fsImpl || typeof fsImpl.writeFileSync !== 'function') throw new TypeError('Filesystem e obrigatorio para adapter ACBrMonitor.');

  async function status(){try{const raw=await transport.send('NFe.StatusServico');if(/^(?:ERRO|ERROR):/i.test(String(raw||'').trim()))return{ok:false,status:503,data:{backend:'acbr-monitor'},error:String(raw).trim()};return{ok:true,status:200,data:{backend:'acbr-monitor',reachable:true},error:null};}catch(error){return{ok:false,status:503,data:{backend:'acbr-monitor',reachable:false},error:error?.message||String(error)};}}

  async function issue({ type, reference, payload, environment } = {}) {
    if (String(type || '').toLowerCase() !== 'nfce') return { ok:false, status:501, data:null, error:'Emissao ACBr real habilitada somente para NFC-e neste fluxo.' };
    let env;try{env=validEnvironment(environment||payload?.environment);}catch(error){return{ok:false,status:400,data:null,error:error.message};}
    if (!payload || payload.documentType !== 'nfce' || String(payload.environment||'').toLowerCase()!==env) return { ok:false, status:400, data:null, error:'Documento fiscal canonico NFC-e do ambiente selecionado obrigatorio.' };
    const root=fsImpl.mkdtempSync(path.join(String(tempDir),'artisys-fiscal-'));const filePath=path.join(root,`nfce-${safeReference(reference)}.ini`);
    try{const ini=renderNfceIni(payload);fsImpl.writeFileSync(filePath,ini,{encoding:'utf8',mode:0o600});const raw=await transport.send(`NFe.CriarEnviarNFe(${acbrQuotedValue(filePath)},1,0,1)`);return parseAcbrResponse(raw,{expectedNumber:payload.identification?.number,expectedSeries:payload.identification?.series});}
    catch(error){if(indeterminateTransport(error))return{ok:false,status:408,indeterminate:true,data:null,error:error?.message||String(error)};return{ok:false,status:502,data:null,error:error?.message||String(error)};}
    finally{try{fsImpl.rmSync(root,{recursive:true,force:true});}catch{}}
  }

  async function createContingency({type,reference,payload,environment}={}){
    if(String(type||'').toLowerCase()!=='nfce')return{ok:false,status:501,data:null,error:'Contingencia offline habilitada somente para NFC-e.'};
    let env;try{env=validEnvironment(environment||payload?.environment);}catch(error){return{ok:false,status:400,data:null,error:error.message};}
    if(!payload||payload.documentType!=='nfce'||String(payload.environment||'').toLowerCase()!==env||String(payload.contingency?.tpEmis||'')!=='9')return{ok:false,status:400,data:null,error:'Documento NFC-e canonico de contingencia tpEmis=9 obrigatorio.'};
    const root=fsImpl.mkdtempSync(path.join(String(tempDir),'artisys-contingency-'));const filePath=path.join(root,`nfce-${safeReference(reference)}.ini`);
    try{
      fsImpl.writeFileSync(filePath,renderNfceIni(payload),{encoding:'utf8',mode:0o600});
      const raw=await transport.send(`NFe.CriarNFe(${acbrQuotedValue(filePath)},1)`);const text=String(raw||'').trim();if(/^(?:ERRO|ERROR):/i.test(text))return{ok:false,status:502,data:null,error:text};
      const xml=extractGeneratedXml(raw,fsImpl);if(!xml)return{ok:false,status:502,data:null,error:'ACBrMonitor nao retornou o XML assinado da contingencia.'};
      return{ok:true,status:200,data:{xml,chave:accessKeyFromXml(xml),numero:payload.identification?.number||null,serie:payload.identification?.series||null},error:null};
    }catch(error){if(indeterminateTransport(error))return{ok:false,status:408,indeterminate:true,data:null,error:error?.message||String(error)};return{ok:false,status:502,data:null,error:error?.message||String(error)};}
    finally{try{fsImpl.rmSync(root,{recursive:true,force:true});}catch{}}
  }

  async function sendContingency({type,reference,xml,payload,environment}={}){
    if(String(type||'').toLowerCase()!=='nfce')return{ok:false,status:501,data:null,error:'Transmissao de contingencia habilitada somente para NFC-e.'};
    try{validEnvironment(environment||payload?.environment);}catch(error){return{ok:false,status:400,data:null,error:error.message};}
    const signedXml=String(xml||'').trim();if(!signedXml||!/<NFe\b/i.test(signedXml))return{ok:false,status:400,data:null,error:'XML assinado de contingencia obrigatorio.'};
    const root=fsImpl.mkdtempSync(path.join(String(tempDir),'artisys-contingency-send-'));const filePath=path.join(root,`nfce-${safeReference(reference)}.xml`);
    try{
      fsImpl.writeFileSync(filePath,signedXml,{encoding:'utf8',mode:0o600});
      const raw=await transport.send(`NFe.EnviarNFe(${acbrQuotedValue(filePath)},1,0,0,"",1,1,0)`);const result=parseAcbrResponse(raw,{expectedNumber:payload?.identification?.number,expectedSeries:payload?.identification?.series});if(result.data&&!result.data.chave)result.data.chave=accessKeyFromXml(signedXml);return result;
    }catch(error){if(indeterminateTransport(error))return{ok:false,status:408,indeterminate:true,data:null,error:error?.message||String(error)};return{ok:false,status:502,data:null,error:error?.message||String(error)};}
    finally{try{fsImpl.rmSync(root,{recursive:true,force:true});}catch{}}
  }

  async function query({ type, accessKey, environment } = {}) {
    if(!['nfce','nfe'].includes(String(type||'').toLowerCase()))return{ok:false,status:400,data:null,error:'Tipo fiscal invalido para consulta ACBr.'};
    try{validEnvironment(environment||'homologation');}catch(error){return{ok:false,status:400,data:null,error:error.message};}
    const key=String(accessKey||'').trim().toUpperCase();if(!/^[A-Z0-9]{44}$/.test(key))return{ok:false,status:409,data:null,error:'Chave de acesso ainda indisponivel para reconciliacao ACBr real.'};
    try{const raw=await transport.send(`NFe.ConsultarNFe(${acbrQuotedValue(key)})`);return parseAcbrResponse(raw);}catch(error){if(indeterminateTransport(error))return{ok:false,status:408,indeterminate:true,data:null,error:error?.message||String(error)};return{ok:false,status:502,data:null,error:error?.message||String(error)};}
  }

  async function cancel({type,accessKey,justification,issuerCnpj,environment}={}){
    if(String(type||'').toLowerCase()!=='nfce')return{ok:false,status:501,data:null,error:'Cancelamento ACBr real habilitado somente para NFC-e.'};
    try{validEnvironment(environment||'homologation');}catch(error){return{ok:false,status:400,data:null,error:error.message};}
    const key=String(accessKey||'').trim().toUpperCase();if(!/^[A-Z0-9]{44}$/.test(key))return{ok:false,status:400,data:null,error:'Chave de acesso valida e obrigatoria para cancelamento.'};
    const reason=String(justification||'').trim().replace(/\s+/g,' ');if(reason.length<15||reason.length>255)return{ok:false,status:400,data:null,error:'Justificativa de cancelamento deve conter entre 15 e 255 caracteres.'};
    const cnpj=String(issuerCnpj||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();if(!/^[A-Z0-9]{12}\d{2}$/.test(cnpj))return{ok:false,status:400,data:null,error:'CNPJ do emitente invalido para cancelamento ACBr.'};
    try{
      const modelResult=await transport.send('NFe.SetModeloDF(65)');if(/^(?:ERRO|ERROR):/i.test(String(modelResult||'').trim()))return{ok:false,status:502,data:null,error:String(modelResult).trim()};
      const raw=await transport.send(`NFe.CancelarNFe(${acbrQuotedValue(key)},${acbrQuotedValue(reason)},${acbrQuotedValue(cnpj)})`);return parseAcbrCancellationResponse(raw);
    }catch(error){if(indeterminateTransport(error))return{ok:false,status:408,indeterminate:true,data:null,error:error?.message||String(error)};return{ok:false,status:502,data:null,error:error?.message||String(error)};}
  }

  return Object.freeze({ status, issue, createContingency, sendContingency, query, cancel });
}

module.exports = { createAcbrMonitorAdapter };