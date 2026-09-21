'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderNfceIni, parseAcbrResponse } = require('./acbr-monitor-protocol');

function safeReference(value) {
  return String(value || 'documento').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'documento';
}

function acbrQuotedValue(value) {
  const text = String(value || '');
  if (!text || /[\r\n"]/u.test(text)) throw new Error('Valor invalido para comando ACBrMonitor.');
  return `"${text}"`;
}

function indeterminateTransport(error) {
  const message=String(error?.message || error || '');
  return /timeout|sem resposta|ECONNRESET|ECONNABORTED|socket|connection.*closed|conexao.*encerrada/i.test(message);
}

function createAcbrMonitorAdapter({ transport, fsImpl = fs, tempDir = os.tmpdir() } = {}) {
  if (!transport || typeof transport.send !== 'function') throw new TypeError('ACBrMonitor transport com send() e obrigatorio.');
  if (!fsImpl || typeof fsImpl.writeFileSync !== 'function') throw new TypeError('Filesystem e obrigatorio para adapter ACBrMonitor.');

  async function status() {
    try {
      const raw = await transport.send('NFe.StatusServico');
      if (/^(?:ERRO|ERROR):/i.test(String(raw || '').trim())) return { ok:false, status:503, data:{ backend:'acbr-monitor' }, error:String(raw).trim() };
      return { ok:true, status:200, data:{ backend:'acbr-monitor', reachable:true }, error:null };
    } catch (error) {
      return { ok:false, status:503, data:{ backend:'acbr-monitor', reachable:false }, error:error?.message || String(error) };
    }
  }

  async function issue({ type, reference, payload, environment } = {}) {
    if (String(type || '').toLowerCase() !== 'nfce') return { ok:false, status:501, data:null, error:'Bloco 3 habilita emissao ACBr real somente para NFC-e.' };
    const env = String(environment || payload?.environment || '').toLowerCase();
    if (env !== 'homologation') return { ok:false, status:409, data:null, error:'Bloco 3 permite ACBrMonitor real somente em homologacao.' };
    if (!payload || payload.documentType !== 'nfce' || payload.environment !== 'homologation') return { ok:false, status:400, data:null, error:'Documento fiscal canonico NFC-e de homologacao obrigatorio.' };

    const root = fsImpl.mkdtempSync(path.join(String(tempDir), 'artisys-fiscal-'));
    const filePath = path.join(root, `nfce-${safeReference(reference)}.ini`);
    try {
      const ini = renderNfceIni(payload);
      fsImpl.writeFileSync(filePath, ini, { encoding:'utf8', mode:0o600 });
      const command = `NFe.CriarEnviarNFe(${acbrQuotedValue(filePath)},1,0,1)`;
      const raw = await transport.send(command);
      return parseAcbrResponse(raw, { expectedNumber:payload.identification?.number, expectedSeries:payload.identification?.series });
    } catch (error) {
      if(indeterminateTransport(error)) return { ok:false, status:408, indeterminate:true, data:null, error:error?.message || String(error) };
      return { ok:false, status:502, data:null, error:error?.message || String(error) };
    } finally {
      try { fsImpl.rmSync(root, { recursive:true, force:true }); } catch {}
    }
  }

  async function query({ type, accessKey, environment } = {}) {
    if(!['nfce','nfe'].includes(String(type||'').toLowerCase())) return {ok:false,status:400,data:null,error:'Tipo fiscal invalido para consulta ACBr.'};
    if(String(environment||'homologation').toLowerCase()!=='homologation') return {ok:false,status:409,data:null,error:'Consulta ACBr do Bloco 4 permanece restrita a homologacao.'};
    const key=String(accessKey||'').trim().toUpperCase();
    if(!/^[A-Z0-9]{44}$/.test(key)) return {ok:false,status:409,data:null,error:'Chave de acesso ainda indisponivel para reconciliacao ACBr real.'};
    try{
      const raw=await transport.send(`NFe.ConsultarNFe(${acbrQuotedValue(key)})`);
      return parseAcbrResponse(raw);
    }catch(error){
      if(indeterminateTransport(error)) return {ok:false,status:408,indeterminate:true,data:null,error:error?.message||String(error)};
      return {ok:false,status:502,data:null,error:error?.message||String(error)};
    }
  }

  async function cancel() {
    return { ok:false, status:501, data:null, error:'Cancelamento fiscal real sera habilitado no bloco de cancelamento.' };
  }

  return Object.freeze({ status, issue, query, cancel });
}

module.exports = { createAcbrMonitorAdapter };