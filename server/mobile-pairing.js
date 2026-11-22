'use strict';
const {randomBytes}=require('node:crypto');
const TOKEN=/^[A-Za-z0-9_-]{32,128}$/;

/**
 * Server-process-only enrollment challenges. QR never carries the permanent key.
 * Expire after 2 minutes, single use, invalidated when renewed/restarted.
 */
function createMobilePairing({now=()=>Date.now(),ttlMs=120000,tokenFactory=()=>randomBytes(32).toString('base64url')}={}){
  const pending=new Map();
  function cleanup(){for(const [token,entry] of pending)if(now()>=entry.expiresAt)pending.delete(token);}
  function invalidateDevice(deviceId){for(const [token,entry] of pending)if(entry.id===String(deviceId))pending.delete(token);}
  function issue({deviceId,credential}={}){
    const id=String(deviceId||'').trim(),key=String(credential||'');
    if(!id||!key)throw new Error('Dispositivo e credencial obrigatorios para parear.');
    cleanup();invalidateDevice(id);
    if(pending.size>=100)throw new Error('Muitos pareamentos pendentes. Tente novamente.');
    const token=String(tokenFactory());if(!TOKEN.test(token)||pending.has(token))throw new Error('Token de pareamento invalido.');
    const expiresAt=now()+ttlMs;
    pending.set(token,{id,key,expiresAt});
    return{token,expiresAt};
  }
  function redeem(token){
    const normalized=String(token||'');
    if(!TOKEN.test(normalized))return null;
    const entry=pending.get(normalized);pending.delete(normalized);
    if(!entry||now()>=entry.expiresAt)return null;
    return{id:entry.id,key:entry.key};
  }
  return{issue,redeem,invalidateDevice};
}
module.exports={createMobilePairing};
