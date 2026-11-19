// Public relay endpoint; no shared secret between the two Cloudflare accounts.
// Every send requires a short-lived HMAC ticket validated and atomically consumed by the licensing Worker.
const AUTH_URL='https://pdv-artisys.sistema-artisys.workers.dev/v1/password-recovery/relay-authorize';
const FROM='contato@artisys.dev';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')
    return json({ok:true,service:'oficina-password-mailer',emailReady:Boolean(env.EMAIL?.send)});
  if(url.pathname!=='/send'||request.method!=='POST')return json({error:'Not found'},404);
  if(!String(request.headers.get('content-type')||'').startsWith('application/json'))
    return json({error:'Invalid content type'},415);
  if(Number(request.headers.get('content-length')||0)>4096)
    return json({error:'Request too large'},413);
  let payload;
  try{const raw=await request.text();if(raw.length>4096)throw Error('large');payload=JSON.parse(raw)}
  catch{return json({error:'Invalid request'},400)}
  const {email,installationId,code,issuedAt,signature}=payload||{};
  if(typeof email!=='string'||email.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||
     typeof installationId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(installationId)||
     !/^[0-9]{6}$/.test(String(code||''))||!/^[a-f0-9]{64}$/i.test(String(signature||''))||
     typeof issuedAt!=='string'||Math.abs(Date.now()-Date.parse(issuedAt))>65000)
    return json({error:'Invalid request'},400);
  if(!env.EMAIL?.send)return json({error:'Email delivery unavailable'},503);
  try{
    const check=await fetch(AUTH_URL,{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},
      body:JSON.stringify({email,installationId,code,issuedAt,signature}),signal:AbortSignal.timeout(6500)});
    if(!check.ok)return json({error:'Authorization rejected'},403);
    const verdict=await check.json();
    if(verdict.authorized!==true)return json({error:'Authorization rejected'},403);
    const body='ArtiSys Oficina - recuperacao de senha.\n\nSeu codigo: '+code+
      '\nValido por 48 horas e para uso unico.\n\nSe nao solicitou, ignore este e-mail. Nao compartilhe o codigo.';
    await env.EMAIL.send({from:FROM,to:email,subject:'ArtiSys Oficina | Codigo de recuperacao',text:body});
    return json({accepted:true},202);
  }catch{return json({error:'Email delivery failed'},503)}
}};