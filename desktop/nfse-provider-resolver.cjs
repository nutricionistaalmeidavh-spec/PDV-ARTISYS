'use strict';

const {createNfseNationalProvider}=require('../js/domains/nfse/nfse-national-provider');

const DEFAULT_BASE_URLS=Object.freeze({
  homologation:'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
  production:'https://sefin.nfse.gov.br/SefinNacional'
});

function createNfseProviderResolver({credentialStore,env=process.env,requestImpl}={}){
  if(!credentialStore||typeof credentialStore.readSecret!=='function')throw new TypeError('Cofre A1 fiscal e obrigatorio para NFS-e Nacional.');
  return async document=>{
    const environment=String(document?.environment||'homologation').toLowerCase();if(!['homologation','production'].includes(environment))throw new Error('Ambiente NFS-e invalido.');
    const secret=credentialStore.readSecret();if(!secret?.pfxBase64)throw new Error('Certificado A1 nao configurado para NFS-e Nacional.');
    const certificate=credentialStore.assertUsable?.()||null;
    const baseUrl=String(environment==='production'?(env.ARTISYS_NFSE_PRODUCTION_BASE_URL||DEFAULT_BASE_URLS.production):(env.ARTISYS_NFSE_HOMOLOGATION_BASE_URL||DEFAULT_BASE_URLS.homologation)).trim();
    return createNfseNationalProvider({environment,baseUrl,pfx:Buffer.from(secret.pfxBase64,'base64'),passphrase:String(secret.password||''),...(requestImpl?{requestImpl}:{}),certificate});
  };
}

module.exports={DEFAULT_BASE_URLS,createNfseProviderResolver};