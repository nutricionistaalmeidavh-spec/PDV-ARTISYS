'use strict';

const net = require('node:net');

const ACBR_TERMINATOR = '\r\n.\r\n';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const PAYMENT_CODES = Object.freeze({ CASH:'01', CREDIT_CARD:'03', DEBIT_CARD:'04', STORE_CREDIT:'05', PIX:'17', OTHER:'99' });

function assertLoopbackHost(host) { const value=String(host||'').trim().toLowerCase();if(!LOOPBACK_HOSTS.has(value))throw new Error('ACBrMonitor deve ser acessado somente por loopback local.');return value; }
function assertPort(value) { const port=Number(value);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Porta ACBrMonitor invalida.');return port; }
function safeIniValue(value) { return String(value ?? '').replace(/[\r\n]/g, ' ').trim(); }
function cents(value) { if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('Valor monetario fiscal invalido.');return (Number(value) / 100).toFixed(2); }
function decimal(value, digits = 3) { const number = Number(value);if (!Number.isFinite(number) || number <= 0) throw new Error('Quantidade fiscal invalida.');return number.toFixed(digits); }
function acbrDateTime(value) { const text=String(value||'').trim();const match=text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);if(!match)throw new Error('Data fiscal invalida.');return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}`; }
function pushSection(lines,name,entries){lines.push(`[${name}]`);for(const [key,value] of entries){if(value===null||value===undefined||value==='')continue;lines.push(`${key}=${safeIniValue(value)}`);}lines.push('');}

function renderNfceIni(document = {}) {
  if (document.documentType !== 'nfce') throw new Error('Renderer ACBr aceita somente NFC-e.');
  if (document.identification?.model !== '65') throw new Error('Modelo NFC-e deve ser 65.');
  const environment = String(document.environment || '').toLowerCase();
  if (!['homologation','production'].includes(environment)) throw new Error('Ambiente fiscal invalido.');
  const issuer = document.issuer || {};const address = issuer.address || {};const identification = document.identification || {};const totals = document.totals || {};const items = Array.isArray(document.items) ? document.items : [];const payments = Array.isArray(document.payments) ? document.payments : [];
  const contingency=document.contingency&&typeof document.contingency==='object'?document.contingency:null;const offline=Boolean(contingency&&(String(contingency.tpEmis||'')==='9'||contingency.type==='offline'));
  if(offline){const reason=String(contingency.reason||'').trim().replace(/\s+/g,' ');if(reason.length<15||reason.length>255)throw new Error('Justificativa da contingencia deve conter entre 15 e 255 caracteres.');acbrDateTime(contingency.enteredAt);}
  if (!/^\d{8}$/.test(String(identification.numericCode || ''))) throw new Error('cNF fiscal deve conter 8 digitos.');
  if (!/^\d{7}$/.test(String(address.cityCode || ''))) throw new Error('Codigo IBGE do municipio invalido para NFC-e.');
  if (!items.length) throw new Error('NFC-e sem itens.');if (!payments.length) throw new Error('NFC-e sem pagamentos.');
  const stateCode = String(address.cityCode).slice(0, 2);const lines = [];
  pushSection(lines, 'infNFe', [['versao','4.00']]);
  pushSection(lines, 'Identificacao', [['cUF',stateCode],['cNF',identification.numericCode],['natOp',identification.operationNature],['mod','65'],['serie',identification.series],['nNF',identification.number],['dhEmi',acbrDateTime(identification.issuedAt)],['tpNF','1'],['idDest','1'],['cMunFG',address.cityCode],['tpImp','4'],['tpEmis',offline?'9':'1'],['dhCont',offline?acbrDateTime(contingency.enteredAt):null],['xJust',offline?contingency.reason:null],['tpAmb',environment==='production'?'1':'2'],['finNFe','1'],['indFinal','1'],['indPres','1'],['procEmi','0'],['verProc','ArtiSys PDV']]);
  pushSection(lines, 'Emitente', [['CNPJCPF',issuer.cnpj],['xNome',issuer.legalName],['xFant',issuer.tradeName],['IE',issuer.stateRegistration],['CRT',issuer.crt],['xLgr',address.street],['nro',address.number],['xCpl',address.complement],['xBairro',address.district],['cMun',address.cityCode],['xMun',address.city],['cUF',stateCode],['UF',address.state],['CEP',address.zip],['cPais','1058'],['xPais','BRASIL']]);
  items.forEach((item,index)=>{const suffix=String(index+1).padStart(3,'0');const tax=item.tax||{};pushSection(lines,`Produto${suffix}`,[['cProd',item.code],['cEAN','SEM GTIN'],['xProd',item.description],['NCM',tax.ncm],['CEST',tax.cest],['CFOP',tax.cfop],['uCom',item.unit],['qCom',decimal(item.quantity)],['vUnCom',cents(item.unitPriceCents)],['vProd',cents(item.grossCents)],['cEANTrib','SEM GTIN'],['uTrib',item.unit],['qTrib',decimal(item.quantity)],['vUnTrib',cents(item.unitPriceCents)],['vDesc',item.discountCents?cents(item.discountCents):null],['indTot','1']]);pushSection(lines,`ICMS${suffix}`,[['orig',tax.origin],['CSOSN',tax.csosn],['CST',tax.icmsCst]]);pushSection(lines,`PIS${suffix}`,[['CST',tax.pisCst]]);pushSection(lines,`COFINS${suffix}`,[['CST',tax.cofinsCst]]);});
  pushSection(lines,'Total',[['vProd',cents(totals.subtotalCents)],['vDesc',cents(totals.discountCents||0)],['vNF',cents(totals.totalCents)]]);
  payments.forEach((payment,index)=>{const suffix=String(index+1).padStart(3,'0');pushSection(lines,`pag${suffix}`,[['indPag','0'],['tPag',PAYMENT_CODES[payment.method]||PAYMENT_CODES.OTHER],['vPag',cents(payment.amountCents)]]);});if(totals.changeCents)pushSection(lines,'pag',[['vTroco',cents(totals.changeCents)]]);return lines.join('\r\n').trimEnd()+'\r\n';
}

function parseSections(raw){const sections={};let current='_root';sections[current]={};for(const rawLine of String(raw||'').split(/\r?\n/)){const line=rawLine.trim();if(!line||line==='.')continue;const section=line.match(/^\[([^\]]+)\]$/);if(section){current=section[1];sections[current]||={};continue;}const index=line.indexOf('=');if(index>0)sections[current][line.slice(0,index).trim()]=line.slice(index+1).trim();}return sections;}
function readKey(section,key){if(!section)return null;const found=Object.keys(section).find(candidate=>candidate.toLowerCase()===key.toLowerCase());return found?section[found]:null;}
function findFiscalSection(sections){const name=Object.keys(sections).find(candidate=>/^NFE\d*$/i.test(candidate)&&readKey(sections[candidate],'CStat'))||Object.keys(sections).find(candidate=>readKey(sections[candidate],'CStat'));return sections[name]||{};}
function rootError(text){return String(text||'').match(/^(?:ERRO|ERROR):\s*(.+)$/im)?.[1]||null;}

function parseAcbrResponse(raw,{expectedNumber=null,expectedSeries=null}={}){
  const text=String(raw||'').trim();const sections=parseSections(text);const fiscal=findFiscalSection(sections);const fileName=Object.keys(sections).find(name=>/^NFE_ARQ/i.test(name));const fileSection=sections[fileName]||{};const cStatRaw=readKey(fiscal,'CStat');const cStat=cStatRaw==null?null:Number(cStatRaw);const xMotivo=readKey(fiscal,'XMotivo')||readKey(fiscal,'Msg')||null;
  const data={cStat:Number.isFinite(cStat)?cStat:null,xMotivo,chave:readKey(fiscal,'ChDFe')||readKey(fiscal,'ChNFe')||null,protocolo:readKey(fiscal,'NProt')||null,receivedAt:readKey(fiscal,'DhRecbto')||null,xmlPath:readKey(fileSection,'Arquivo')||null,numero:expectedNumber==null?null:String(expectedNumber),serie:expectedSeries==null?null:String(expectedSeries)};
  if(data.cStat===100)return{ok:true,status:200,data,error:null};return{ok:false,status:data.cStat?422:502,data,error:xMotivo||rootError(text)||'ACBrMonitor nao retornou autorizacao fiscal.'};
}

function parseAcbrCancellationResponse(raw){
  const text=String(raw||'').trim();const sections=parseSections(text);const fiscal=findFiscalSection(sections);const fileName=Object.keys(sections).find(name=>/ARQ|EVENTO/i.test(name)&&readKey(sections[name],'Arquivo'));const fileSection=sections[fileName]||{};const cStatRaw=readKey(fiscal,'CStat');const cStat=cStatRaw==null?null:Number(cStatRaw);const xMotivo=readKey(fiscal,'XMotivo')||readKey(fiscal,'Msg')||null;const data={cStat:Number.isFinite(cStat)?cStat:null,xMotivo,chave:readKey(fiscal,'ChNFe')||readKey(fiscal,'ChDFe')||null,protocolo:readKey(fiscal,'NProt')||readKey(fiscal,'nProt')||null,receivedAt:readKey(fiscal,'DhRegEvento')||readKey(fiscal,'DhRecbto')||null,xmlPath:readKey(fileSection,'Arquivo')||readKey(fiscal,'Arquivo')||null};
  if([101,135].includes(data.cStat))return{ok:true,status:200,data,error:null};return{ok:false,status:data.cStat?422:502,data,error:xMotivo||rootError(text)||'ACBrMonitor nao confirmou o cancelamento fiscal.'};
}

function createAcbrMonitorTcpTransport({host='127.0.0.1',port=3434,timeoutMs=30000,maxResponseBytes=2*1024*1024,connect=options=>net.createConnection(options)}={}){
  const safeHost=assertLoopbackHost(host);const safePort=assertPort(port);const safeTimeout=Math.max(1000,Number(timeoutMs)||30000);const safeMax=Math.max(1024,Number(maxResponseBytes)||2*1024*1024);if(typeof connect!=='function')throw new TypeError('connect deve ser funcao.');
  async function send(command){const text=String(command||'').trim();if(!text)throw new Error('Comando ACBrMonitor obrigatorio.');return new Promise((resolve,reject)=>{const socket=connect({host:safeHost,port:safePort});let buffer=Buffer.alloc(0);let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;try{socket.end?.();}catch{}if(error)reject(error);else resolve(value);};socket.setTimeout?.(safeTimeout);socket.once?.('connect',()=>{try{socket.write(`${text}${ACBR_TERMINATOR}`);}catch(error){finish(error);}});socket.on?.('data',chunk=>{if(settled)return;buffer=Buffer.concat([buffer,Buffer.from(chunk)]);if(buffer.length>safeMax)return finish(new Error('Resposta ACBrMonitor excede o limite permitido.'));const content=buffer.toString('utf8');const marker=content.indexOf(ACBR_TERMINATOR);if(marker>=0)finish(null,content.slice(0,marker).trim());});socket.once?.('timeout',()=>{try{socket.destroy?.();}catch{}finish(new Error('Timeout aguardando resposta do ACBrMonitor.'));});socket.once?.('error',error=>finish(error));socket.once?.('close',()=>{if(!settled&&buffer.length)finish(null,buffer.toString('utf8').replace(/\r?\n\.\r?\n?$/,'').trim());else if(!settled)finish(new Error('Conexao ACBrMonitor encerrada sem resposta.'));});});}
  return Object.freeze({host:safeHost,port:safePort,send});
}

module.exports={ACBR_TERMINATOR,PAYMENT_CODES,assertLoopbackHost,renderNfceIni,parseAcbrResponse,parseAcbrCancellationResponse,createAcbrMonitorTcpTransport};