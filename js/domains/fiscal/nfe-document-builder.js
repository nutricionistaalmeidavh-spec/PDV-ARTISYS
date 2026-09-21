'use strict';

const { buildFiscalDocument } = require('./fiscal-document-builder');

function required(value,label){const text=String(value??'').trim();if(!text)throw new Error(`${label} obrigatorio.`);return text;}
function digits(value){return String(value??'').replace(/\D/g,'');}
function normalizeTaxId(value){const raw=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(!(raw.length===11||raw.length===14))throw new Error('CPF/CNPJ do destinatario invalido.');return raw;}
function normalizeRecipient(input={}){
  if(!input||typeof input!=='object')throw new Error('Destinatario obrigatorio para NF-e modelo 55.');
  const address=input.address&&typeof input.address==='object'?input.address:{};
  return {
    taxId:normalizeTaxId(input.taxId||input.cnpj||input.cpf),
    name:required(input.name||input.legalName,'Nome do destinatario'),
    stateRegistration:String(input.stateRegistration||'').trim()||null,
    email:String(input.email||'').trim()||null,
    address:{
      street:required(address.street,'Logradouro do destinatario'),
      number:required(address.number,'Numero do destinatario'),
      complement:String(address.complement||'').trim()||null,
      district:required(address.district,'Bairro do destinatario'),
      cityCode:required(digits(address.cityCode),'Codigo IBGE do destinatario'),
      city:required(address.city,'Municipio do destinatario'),
      state:required(address.state,'UF do destinatario').toUpperCase(),
      zip:required(digits(address.zip),'CEP do destinatario')
    }
  };
}

function buildNfeDocument({sale,fiscalContext,recipient,environment='homologation',reference}={}){
  const normalizedRecipient=normalizeRecipient(recipient||fiscalContext?.recipient);
  const document=buildFiscalDocument({sale,fiscalContext:{...(fiscalContext||{}),recipient:normalizedRecipient},documentType:'nfe',environment,reference});
  return {...document,recipient:normalizedRecipient};
}

module.exports={normalizeRecipient,buildNfeDocument};