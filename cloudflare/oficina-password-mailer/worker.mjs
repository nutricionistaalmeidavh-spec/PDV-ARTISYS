// Public relay endpoint; no shared secret between the two Cloudflare accounts.
// Every send requires a short-lived HMAC ticket validated and atomically consumed by the licensing Worker.
const AUTH_URL='https://pdv-artisys.sistema-artisys.workers.dev/v1/password-recovery/relay-authorize';
const WELCOME_AUTH_URL='https://pdv-artisys.sistema-artisys.workers.dev/v1/license-welcome/relay-authorize';
const FROM='contato@artisys.dev';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET')
    return json({ok:true,service:'oficina-password-mailer',emailReady:Boolean(env.EMAIL?.send)});
  if(url.pathname==='/nexus'){
    if(request.method!=='POST'||!String(request.headers.get('content-type')||'').startsWith('application/json'))return json({error:'Invalid request'},405);
    let p;try{const raw=await request.text();if(raw.length>4096)throw Error('large');p=JSON.parse(raw);}
    catch{return json({error:'Invalid payload'},400);}
    const {email,installationId,purpose,code,licenseId,expiresAt,issuedAt,signature}=p||{};
    if(!['verify','welcome'].includes(purpose)||typeof email!=='string'||email.length>254||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof installationId!=='string'||
       !/^[a-zA-Z0-9._:-]{8,128}$/.test(installationId)||!Number.isFinite(Date.parse(issuedAt))||
       Math.abs(Date.now()-Date.parse(issuedAt))>65000||
       typeof signature!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(signature)||
       (purpose==='verify'&&!/^\d{6}$/.test(String(code||'')))||
       (purpose==='welcome'&&(typeof licenseId!=='string'||typeof expiresAt!=='string')))
       return json({error:'Invalid ticket'},400);
    if(!env.EMAIL?.send)return json({error:'Email unavailable'},503);
    try{
      const authorized=await fetch('https://pdv-artisys.sistema-artisys.workers.dev/v1/nexus/trial/relay-authorize',{
        method:'POST',redirect:'manual',headers:{'content-type':'application/json'},
        body:JSON.stringify(p),signal:AbortSignal.timeout(6500)
      });
      if(!authorized.ok||(await authorized.json())?.authorized!==true)return json({error:'Not authorized'},403);
      const subject=purpose==='verify'?'PDV Nexus 2.0 | Confirme seu e-mail':'Bem-vindo ao PDV Nexus 2.0 | Avaliação liberada';
      const body=purpose==='verify'?
        'Olá!\n\nSeu código de confirmação para iniciar a avaliação do PDV Nexus 2.0 é: '+code+
        '\n\nEle expira em 15 minutos. Se você não solicitou o cadastro, ignore esta mensagem.\n\nEquipe ArtiSys':
        'Olá!\n\nSeu acesso ao PDV Nexus 2.0 foi liberado por 3 dias (72 horas).\n'+
        'E-mail vinculado: '+email+'\nValidade: '+expiresAt+
        '\n\nEntre no aplicativo com a conta local do estabelecimento. Durante a avaliação, suas vendas ficam armazenadas localmente. '+
        'Quando a avaliação vencer, seus dados e backups serão preservados.\n\nPrecisa de suporte? Responda a este e-mail.\n\nEquipe ArtiSys';
      await env.EMAIL.send({from:FROM,to:email,subject,text:body});
      return json({accepted:true},202);
    }catch{return json({error:'Delivery unavailable'},503)}
  }
  if(url.pathname==='/welcome'){
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(!String(request.headers.get('content-type')||'').startsWith('application/json'))
      return json({error:'Invalid content type'},415);
    let payload;try{const raw=await request.text();if(raw.length>4096)throw Error('large');payload=JSON.parse(raw);}
    catch{return json({error:'Invalid request'},400);}
    const {email,licenseId,code,codeExpiresAt,issuedAt,signature}=payload||{};
    // Sem campo 'product' mantém a compatibilidade dos tickets existentes da Loja Roupas.
    const product=payload?.product==null?'LOJA_ROUPAS':String(payload.product);
    if(product!=='LOJA_ROUPAS'&&product!=='ALMOXARIFADO')return json({error:'Unsupported product'},400);
    if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
       typeof licenseId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(licenseId)||
       !/^[0-9]{6}$/.test(String(code||''))||!/^[a-f0-9]{64}$/i.test(String(signature||''))||
       typeof codeExpiresAt!=='string'||!Number.isFinite(Date.parse(codeExpiresAt))||
       typeof issuedAt!=='string'||Math.abs(Date.now()-Date.parse(issuedAt))>65000)
      return json({error:'Invalid welcome ticket'},400);
    if(!env.EMAIL?.send)return json({error:'Email delivery unavailable'},503);
    try{
      const check=await fetch(WELCOME_AUTH_URL,{method:'POST',redirect:'manual',
        headers:{'content-type':'application/json'},body:JSON.stringify(payload),
        signal:AbortSignal.timeout(6500)});
      if(!check.ok)return json({error:'Authorization rejected'},403);
      const authorization=await check.json();
      if(authorization?.authorized!==true||(product==='ALMOXARIFADO'&&authorization.product!=='ALMOXARIFADO')||
         (authorization.product&&authorization.product!==product))
        return json({error:'Authorization rejected'},403);
      const subject=product==='ALMOXARIFADO'
        ?'ArtiSys Almoxarifado | Instalação, licença e manual'
        :'Loja Roupas ArtiSys | Seu acesso foi liberado';
      const text=product==='ALMOXARIFADO'?
        'Olá!\n\nObrigado por adquirir o ArtiSys Almoxarifado. Seu acesso comercial está liberado.\n\n'+
        'E-mail vinculado: '+email+
        '\nCódigo de ativação: '+code+
        '\nCódigo válido até: '+codeExpiresAt+
        '\n\nDOWNLOAD DIRETO - Instalador Windows 64 bits:\nhttps://pdv-artisys.sistema-artisys.workers.dev/download/almoxarifado'+
        '\n\nMANUAL DE INSTRUÇÕES (PDF):\nhttps://pdv-artisys.sistema-artisys.workers.dev/manual/almoxarifado.pdf'+
        '\n\nPrimeiros passos:\n1. Baixe e instale no computador principal (Windows 10/11 x64).'+
        '\n2. Abra ArtiSys Almoxarifado e informe este e-mail e o código acima.'+
        '\n3. Crie a senha do administrador local (mínimo de 10 caracteres).'+
        '\n4. Cadastre os materiais e os depósitos, seguindo o manual.'+
        '\n5. Acesse pelo celular/tablet na mesma rede com o computador principal ligado.'+
        '\n\nO código é de uso único e expira em 48 horas. A validade da licença é independente da validade do código.'+
        '\nGuarde este e-mail. Não compartilhe o código de ativação. Os dados do estoque permanecem no computador principal.'+
        '\n\nSuporte: responda a este e-mail.\n\nEquipe ArtiSys'
        :'Olá!\\n\\nSua licença do Loja Roupas foi liberada pela ArtiSys.\\n\\nE-mail vinculado: '+email+
        '\nCódigo de ativação: '+code+'\nCódigo válido até: '+codeExpiresAt+
        '\n\nComo começar:\n1. Quando receber o instalador homologado da ArtiSys, instale no computador principal.\n2. Na edição comercial, informe seu e-mail e o código acima.\n3. Cadastre a loja e siga o tour de primeiro acesso.\n4. A vitrine online é opcional e depende da publicação dos produtos.\n\nA versão livre local não exige Cloudflare nem assinatura.\n\nO código é de uso único. Não o compartilhe.\nSe precisar de ajuda, responda a este e-mail.\n\nEquipe ArtiSys';
      await env.EMAIL.send({from:FROM,to:email,subject,text});
      return json({accepted:true},202);
    }catch{return json({error:'Email delivery failed'},503);}
  }
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