'use strict';
const {spawn}=require('node:child_process');
const {isAbsolute}=require('node:path');

/**
 * Optional TEF subprocess bridge. Executes only a locally configured,
 * absolute executable and exchanges a single JSON line per charge.
 * The bridge itself MUST be provided by a separately audited and
 * homologated ACBr/PayGo/SiTef implementation.
 */
function createLocalTefProvider({executable,args=[],timeoutMs=45000,allowedTerminalId=null,spawnImpl=spawn}={}){
  const executablePath=String(executable||'').trim();
  if(!executablePath||!isAbsolute(executablePath))throw new Error('TEF exige caminho absoluto para bridge nativa local.');
  if(!Array.isArray(args)||args.some(arg=>typeof arg!=='string'||arg.length>512))
    throw new Error('Argumentos do bridge TEF invalidos.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw new Error('Timeout TEF invalido.');

  function run(command){
    return new Promise((resolve,reject)=>{
      let child,done=false,output='',errorText='';
      const rejectOnce=error=>{if(done)return;done=true;reject(error);};
      const resolveOnce=value=>{if(done)return;done=true;resolve(value);};
      try{
        // Do not leak the PDV environment (tokens/passwords) to an external binary.
        const environment={};
        for(const name of ['SystemRoot','SystemDrive','WINDIR','TEMP','TMP','HOME','USERPROFILE','LANG'])
          if(process.env[name])environment[name]=process.env[name];
        child=spawnImpl(executablePath,args,{
          shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:environment
        });
      }catch(err){return rejectOnce(err);}
      const timer=setTimeout(()=>{try{child.kill();}catch{}rejectOnce(new Error('Tempo limite TEF; resultado indeterminado.'))},timeoutMs);
      const finishError=err=>{clearTimeout(timer);rejectOnce(err);};
      child.once('error',finishError);
      child.stdout.on('data',chunk=>{
        output+=chunk.toString('utf8');
        if(Buffer.byteLength(output,'utf8')>16384){
          try{child.kill();}catch{}
          finishError(new Error('Resposta TEF excede limite seguro.'));
        }
      });
      child.stderr.on('data',chunk=>{if(errorText.length<1024)errorText+=chunk.toString('utf8').slice(0,1024);});
      child.once('close',code=>{
        clearTimeout(timer);if(done)return;
        if(code!==0)return rejectOnce(new Error('Bridge TEF nao confirmou a transacao.'));
        let reply;
        try{reply=JSON.parse(output.trim());}catch{return rejectOnce(new Error('Resposta TEF invalida.'));}
        if(!reply||typeof reply!=='object'||Array.isArray(reply))return rejectOnce(new Error('Resposta TEF invalida.'));
        // Keep only fields from the explicit provider contract.
        resolveOnce({status:String(reply.status||'UNKNOWN'),txid:String(reply.txid||''),
          amountCents:reply.amountCents,nsu:reply.nsu,authorizationCode:reply.authorizationCode,
          acquirer:reply.acquirer});
      });
      child.stdin.on('error',finishError);
      child.stdin.end(JSON.stringify(command)+'\n');
    });
  }
  function validateTerminal(terminalId){
    const configured=String(allowedTerminalId||'').trim();
    if(configured&&String(terminalId||'').trim()!==configured)
      throw new Error('Bridge TEF local nao atende outro terminal LAN.');
    return String(terminalId||'').trim();
  }
  return{
    validateTerminal,
    async start({id,txid,amountCents,method,saleId,terminalId}={}){
      validateTerminal(terminalId);
      if(!/^[A-Za-z0-9]{26,35}$/.test(String(txid||''))||
        !Number.isSafeInteger(amountCents)||amountCents<=0||
        !['DEBIT_CARD','CREDIT_CARD'].includes(method))throw new Error('Transacao TEF invalida.');
      return run({op:'charge',id:String(id||''),txid,amountCents,method,saleId:String(saleId||'')});
    }
  };
}
module.exports={createLocalTefProvider};
