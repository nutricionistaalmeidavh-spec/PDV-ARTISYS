'use strict';
// Security boundary for the *private* local ACBrLib INI.
// Never emit config contents, certificate data, passwords or CSC in errors.
const fs=require('node:fs');
const path=require('node:path');
function parsePrivateIni(text){
 const sections=new Map();let name='';
 for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=raw.trim();
  if(!line||line.startsWith(';')||line.startsWith('#'))continue;
  const header=/^\[([A-Za-z0-9_]+)\]$/.exec(line);
  if(header){
   name=header[1].toUpperCase();
   if(sections.has(name))throw Error('Seção duplicada no INI ACBr: configuração ambígua');
   sections.set(name,new Map());continue;
  }
  if(!name||!line.includes('='))throw Error('Linha do INI ACBr inválida');
  const i=line.indexOf('='),key=line.slice(0,i).trim().toUpperCase();
  if(!/^[A-Z0-9_.]+$/.test(key))throw Error('Chave do INI ACBr inválida');
  if(sections.get(name).has(key))throw Error('Chave duplicada no INI ACBr');
  sections.get(name).set(key,line.slice(i+1).trim());
 }
 return sections;
}
function inspectLocalAcbrConfig({file,model,issuerUF}={}){
 if(!file||!path.isAbsolute(file))throw Error('Configuração ACBr exige arquivo INI local absoluto');
 const iniFile=fs.realpathSync(file),stat=fs.statSync(iniFile);
 if(!stat.isFile()||stat.size>1024*1024||stat.size<24)throw Error('Configuração ACBr inválida');
 const all=parsePrivateIni(fs.readFileSync(iniFile,'utf8'));
 const nfe=all.get('NFE'),dfe=all.get('DFE');
 if(!nfe||!dfe)throw Error('INI ACBr deve conter seções NFe e DFe');
 // In ACBrLib [NFe] Ambiente: 0 = produção, 1 = homologação.
 if(nfe.get('AMBIENTE')!=='1')throw Error('Ambiente ACBr não é HOMOLOGAÇÃO; produção bloqueada');
 if(nfe.get('FORMAEMISSAO')!=='0')throw Error('A emissão fiscal deve usar modo normal até homologação de contingência');
 const uf=String(dfe.get('UF')||'').toUpperCase();
 if(!/^[A-Z]{2}$/.test(uf)||uf!==issuerUF)throw Error('UF da configuração ACBr diverge do emitente');
 if(dfe.get('VERIFICARVALIDADE')!=='1')throw Error('Validação de certificado A1 deve estar habilitada');
 if(!dfe.get('SENHA'))throw Error('Senha do certificado A1 não configurada');
 const certPath=dfe.get('ARQUIVOPFX');
 if(!certPath||!path.isAbsolute(certPath)||!/\.(pfx|p12)$/i.test(certPath))
  throw Error('Certificado A1 PFX local não configurado');
 const pfx=fs.statSync(fs.realpathSync(certPath));
 if(!pfx.isFile()||pfx.size<512||pfx.size>256*1024)throw Error('Certificado A1 ausente ou fora do tamanho esperado');
 const m=Number(model);
 if(![55,65].includes(m))throw Error('Modelo NF-e/NFC-e inválido');
 if(m===65){
  if(!String(nfe.get('CSC')||'').trim()||!/^[0-9]{1,8}$/.test(nfe.get('IDCSC')||''))
   throw Error('CSC e IdCSC da NFC-e de homologação são obrigatórios');
 }
 return Object.freeze({ready:true,environment:'homologation',uf,model:m});
}
module.exports={inspectLocalAcbrConfig,parsePrivateIni};
