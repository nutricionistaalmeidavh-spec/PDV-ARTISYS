'use strict';

const {qrSvg}=require('./qr-code');

function createMobileAccessService(){
  function getLanAccess({host,port=4174,path='/mobile'}={}){
    const safeHost=String(host||'').trim();if(!safeHost)throw new Error('Host LAN obrigatorio.');if(/[\s/@]/.test(safeHost))throw new Error('Host LAN invalido.');
    const safePort=Number(port);if(!Number.isInteger(safePort)||safePort<1||safePort>65535)throw new Error('Porta LAN invalida.');
    let safePath=String(path||'/mobile').trim();if(!safePath.startsWith('/'))safePath=`/${safePath}`;if(safePath.includes('..'))throw new Error('Caminho mobile invalido.');
    const url=`http://${safeHost}:${safePort}${safePath}`;
    return{url,qrSvg:qrSvg(url),security:'trusted-lan-http',installablePwa:false,warning:'Use somente na rede local confiavel. Este acesso HTTP nao deve ser exposto diretamente a internet.'};
  }
  return{getLanAccess};
}

module.exports={createMobileAccessService};
