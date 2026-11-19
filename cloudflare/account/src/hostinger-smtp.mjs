// SMTP transacional de uso opcional para a edicao comercial Oficina.
// Sem dependencias externas, sem API de outra conta Cloudflare e sem credenciais no bundle.
const enc=new TextEncoder(),dec=new TextDecoder();
const HOST='smtp.hostinger.com',PORT=465;
const address=value=>String(value||'').trim().toLowerCase();
const validEmail=value=>/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)&&value.length<=254;
function base64(value){
 const bytes=enc.encode(value);
 let raw='';
 for(const byte of bytes)raw+=String.fromCharCode(byte);
 return btoa(raw);
}
export async function sendHostingerRecoveryEmail({
 recipient,code,username='contato@artisys.dev',password,connectSocket
}={}){
 const to=address(recipient),from=address(username);
 if(!validEmail(to)||!validEmail(from)||!/^[0-9]{6}$/.test(String(code||''))||
    typeof password!=='string'||!password)
  throw new Error('SMTP recovery configuration invalid');
 const dial=connectSocket||(await import('cloudflare:sockets')).connect;
 const socket=dial({hostname:HOST,port:PORT},{secureTransport:'on'});
 const reader=socket.readable.getReader(),writer=socket.writable.getWriter();
 let pending='',lines=0;
 async function line(){
   while(!pending.includes('\n')){
     const {value,done}=await reader.read();
     if(done)throw new Error('SMTP connection unexpectedly closed');
     pending+=dec.decode(value,{stream:true});
     if(pending.length>32768)throw new Error('SMTP response exceeds limit');
   }
   const index=pending.indexOf('\n'),result=pending.slice(0,index).replace(/\r$/,'');
   pending=pending.slice(index+1);
   return result;
 }
 async function reply(expected){
   for(let i=0;i<60;i++){
     const value=await line();
     lines++;
     if(!/^[0-9]{3}[ -]/.test(value))throw new Error('Invalid SMTP response');
     const code=Number(value.slice(0,3));
     if(value[3]==='-')continue;
     if(code!==expected)throw new Error('SMTP rejected command ('+code+')');
     return value;
   }
   throw new Error('SMTP response exceeded line limit');
 }
 async function send(value,expected){
   await writer.write(enc.encode(value+'\r\n'));
   return reply(expected);
 }
 const body='Voce solicitou a recuperacao de senha do ArtiSys Oficina.\r\n\r\n'+
   'Codigo: '+code+'\r\nValido por 15 minutos e para uso unico.\r\n\r\n'+
   'Se nao solicitou esta recuperacao, ignore este e-mail.\r\n'+
   'Nunca compartilhe este codigo.\r\n';
 const headers=[
   'From: ArtiSys Oficina <'+from+'>',
   'To: <'+to+'>',
   'Subject: ArtiSys Oficina - codigo de recuperacao',
   'Date: '+new Date().toUTCString(),
   'MIME-Version: 1.0',
   'Content-Type: text/plain; charset=UTF-8',
   'Content-Transfer-Encoding: 8bit',
   'X-Auto-Response-Suppress: All'
 ].join('\r\n');
 try{
   await reply(220);
   await send('EHLO sistema-artisys.workers.dev',250);
   await send('AUTH PLAIN '+base64('\u0000'+from+'\u0000'+password),235);
   await send('MAIL FROM:<'+from+'>',250);
   await send('RCPT TO:<'+to+'>',250);
   await send('DATA',354);
   // The message is composed only of generated constant lines and validated address/code.
   await writer.write(enc.encode(headers+'\r\n\r\n'+body+'\r\n.\r\n'));
   await reply(250);
   await send('QUIT',221);
   return {accepted:true};
 }finally{
   try{reader.releaseLock();}catch{}
   try{writer.releaseLock();}catch{}
   try{socket.close();}catch{}
 }
}
