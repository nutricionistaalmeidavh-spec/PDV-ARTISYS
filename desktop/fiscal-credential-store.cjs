'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');

const MAX_PFX_BYTES = 4 * 1024 * 1024;

function encryptionReady(safeStorage) {
  return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable());
}

function loadPfxContext({ pfx, password = '' } = {}) {
  const buffer = Buffer.isBuffer(pfx) ? pfx : Buffer.from(pfx || []);
  if (!buffer.length || buffer.length > MAX_PFX_BYTES) throw new Error('Certificado PFX/PKCS#12 invalido.');
  try {
    return tls.createSecureContext({ pfx:buffer, passphrase:String(password ?? '') });
  } catch {
    throw new Error('Certificado PFX/PKCS#12 invalido ou senha incorreta.');
  }
}

function validatePfxBuffer(input = {}) {
  loadPfxContext(input);
  return true;
}

function inspectPfxBuffer(input = {}) {
  const secureContext=loadPfxContext(input);
  const der=typeof secureContext.context?.getCertificate==='function' ? secureContext.context.getCertificate() : null;
  if(!der||!Buffer.from(der).length) throw new Error('Certificado X.509 nao encontrado dentro do PFX/PKCS#12.');
  const certificate=new X509Certificate(Buffer.from(der));
  return {
    fingerprint:certificate.fingerprint256 || certificate.fingerprint || null,
    subject:certificate.subject || null,
    serialNumber:certificate.serialNumber || null,
    validFrom:certificate.validFrom ? new Date(certificate.validFrom).toISOString() : null,
    validTo:certificate.validTo ? new Date(certificate.validTo).toISOString() : null,
    cnpj:null
  };
}

function decodePfxBase64(value) {
  const text=String(value||'').trim();
  if(!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('Certificado PFX em base64 invalido.');
  const buffer=Buffer.from(text,'base64');
  if(!buffer.length || buffer.length>MAX_PFX_BYTES) throw new Error('Certificado PFX/PKCS#12 invalido.');
  return buffer;
}

function normalizeMetadata(value = {}) {
  const input=value&&typeof value==='object'?value:{};
  const optional=v=>{const text=String(v??'').trim();return text||null;};
  return {
    fingerprint:optional(input.fingerprint),
    subject:optional(input.subject),
    serialNumber:optional(input.serialNumber),
    validFrom:optional(input.validFrom),
    validTo:optional(input.validTo),
    cnpj:optional(input.cnpj)?.toUpperCase() || null
  };
}

function createFiscalCredentialStore({
  app,
  safeStorage,
  fileName='pdv-fiscal-credentials.enc',
  inspectPfx=null,
  now=()=>new Date()
}={}) {
  if(!app||typeof app.getPath!=='function'||!safeStorage) throw new TypeError('app and safeStorage are required.');
  const filePath=path.join(app.getPath('userData'),fileName);
  const inspector=typeof inspectPfx==='function' ? inspectPfx : inspectPfxBuffer;

  function requireEncryption(){if(!encryptionReady(safeStorage)) throw new Error('Criptografia segura do sistema operacional indisponivel.');}

  function encryptPayload(value){
    requireEncryption();
    const encrypted=safeStorage.encryptString(JSON.stringify(value));
    fs.mkdirSync(path.dirname(filePath),{recursive:true});
    fs.writeFileSync(filePath,Buffer.from(encrypted).toString('base64'),{encoding:'utf8',mode:0o600});
  }

  function readSecret(){
    if(!fs.existsSync(filePath)) return null;
    requireEncryption();
    try{
      const encoded=fs.readFileSync(filePath,'utf8');
      const decrypted=safeStorage.decryptString(Buffer.from(encoded,'base64'));
      const parsed=JSON.parse(decrypted);
      if(!parsed||typeof parsed!=='object'||!parsed.pfxBase64) throw new Error('invalid');
      return parsed;
    }catch{
      throw new Error('Credenciais fiscais protegidas invalidas ou corrompidas.');
    }
  }

  function calculateStatus(secret){
    if(!secret) return {configured:false};
    const metadata=normalizeMetadata(secret.certificate||{});
    const validTo=metadata.validTo?new Date(metadata.validTo):null;
    const validToMs=validTo&&Number.isFinite(validTo.getTime())?validTo.getTime():null;
    const nowValue=now();
    const nowDate=nowValue instanceof Date?nowValue:new Date(nowValue);
    const expired=validToMs==null?false:validToMs<=nowDate.getTime();
    return {
      configured:true,
      certificateName:String(secret.certificateName||'').trim()||null,
      cscId:String(secret.cscId||'').trim()||null,
      certificate:metadata,
      expiryVerified:validToMs!=null,
      expired
    };
  }

  function publicStatus(){return calculateStatus(readSecret());}

  function save(input={}){
    requireEncryption();
    const pfx=decodePfxBase64(input.pfxBase64);
    const password=String(input.password??'');
    const csc=String(input.csc??'').trim();
    const cscId=String(input.cscId??'').trim();
    const certificateName=String(input.certificateName??'').trim();
    if(!csc) throw new Error('CSC obrigatorio para NFC-e local.');
    if(!cscId) throw new Error('ID CSC obrigatorio para NFC-e local.');
    let metadata;
    try{
      metadata=normalizeMetadata(inspector({pfx,password}));
    }catch(error){
      const message=String(error?.message||error||'');
      if(/PFX|PKCS|certificado|senha/i.test(message)) throw error;
      throw new Error(`Falha ao validar certificado PFX: ${message}`);
    }
    const timestampValue=now();
    const timestamp=timestampValue instanceof Date?timestampValue:new Date(timestampValue);
    encryptPayload({
      schemaVersion:1,
      pfxBase64:pfx.toString('base64'),
      password,
      csc,
      cscId,
      certificateName:certificateName||null,
      certificate:metadata,
      updatedAt:timestamp.toISOString()
    });
    return publicStatus();
  }

  function assertUsable(){
    const secret=readSecret();
    if(!secret) throw new Error('Certificado A1/CSC nao configurado.');
    const status=calculateStatus(secret);
    if(!status.expiryVerified) throw new Error('Validade do certificado A1 nao verificada.');
    if(status.expired) throw new Error('Certificado A1 expirado/vencido.');
    return secret;
  }

  function remove(){if(fs.existsSync(filePath)) fs.rmSync(filePath,{force:true});return {configured:false};}

  return Object.freeze({filePath,save,readSecret,publicStatus,assertUsable,remove});
}

module.exports={MAX_PFX_BYTES,validatePfxBuffer,inspectPfxBuffer,createFiscalCredentialStore};
