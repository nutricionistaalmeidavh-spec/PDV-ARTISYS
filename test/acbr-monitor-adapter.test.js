'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACBR_TERMINATOR,
  renderNfceIni,
  parseAcbrResponse,
  createAcbrMonitorTcpTransport
} = require('../server/fiscal-sidecar/acbr-monitor-protocol');
const { createAcbrMonitorAdapter } = require('../server/fiscal-sidecar/acbr-monitor-adapter');

function fiscalDocument() {
  return {
    documentType:'nfce', environment:'homologation', reference:'V-1001',
    issuer:{ cnpj:'12345678000195', legalName:'EMPRESA HOMOLOGACAO LTDA', tradeName:'EMPRESA HOMOLOGACAO', stateRegistration:'123456789', crt:'1', address:{ street:'Rua Teste', number:'100', district:'Centro', cityCode:'3543402', city:'Ribeirao Preto', state:'SP', zip:'14000000' } },
    identification:{ model:'65', series:'1', number:'42', operationNature:'VENDA', issuedAt:'2026-09-20T19:00:00-03:00' },
    items:[
      { line:1, code:'A-1', description:'Produto A', quantity:1, unit:'UN', unitPriceCents:1000, grossCents:1000, discountCents:67, totalCents:1000, tax:{ ncm:'22021000', cfop:'5102', origin:'0', csosn:'102', pisCst:'49', cofinsCst:'49' } },
      { line:2, code:'B-1', description:'Produto B', quantity:1, unit:'UN', unitPriceCents:500, grossCents:500, discountCents:34, totalCents:500, tax:{ ncm:'19059090', cfop:'5102', origin:'0', csosn:'102', pisCst:'49', cofinsCst:'49' } }
    ],
    payments:[{ method:'PIX', amountCents:1399 }],
    totals:{ subtotalCents:1500, discountCents:101, totalCents:1399, paymentCents:1399, changeCents:0 }
  };
}

test('renders NFC-e INI with model 65, homologation and exact canonical totals', () => {
  const ini = renderNfceIni(fiscalDocument());
  assert.match(ini, /\[infNFe\][\s\S]*versao=4\.00/);
  assert.match(ini, /\[Identificacao\][\s\S]*mod=65/);
  assert.match(ini, /tpAmb=2/);
  assert.match(ini, /serie=1/);
  assert.match(ini, /nNF=42/);
  assert.match(ini, /\[Produto001\][\s\S]*vProd=10\.00/);
  assert.match(ini, /\[Produto002\][\s\S]*vProd=5\.00/);
  assert.match(ini, /\[Total\][\s\S]*vProd=15\.00[\s\S]*vDesc=1\.01[\s\S]*vNF=13\.99/);
  assert.match(ini, /\[pag001\][\s\S]*tPag=17[\s\S]*vPag=13\.99/);
});

test('parses ACBr authorization response into stable provider data', () => {
  const response = [
    'OK: Lote processado',
    '[RETORNO]',
    'CStat=104',
    'XMotivo=Lote processado',
    '[NFE42]',
    'CStat=100',
    'XMotivo=Autorizado o uso da NF-e',
    'ChDFe=35260912345678000195650010000000421000000420',
    'NProt=135260000123456',
    'DhRecbto=2026-09-20T19:00:03-03:00',
    '[NFe_Arq42]',
    'Arquivo=C:\\ACBrMonitorPLUS\\Arqs\\3526-nfe.xml'
  ].join('\r\n');
  const parsed = parseAcbrResponse(response, { expectedNumber:'42', expectedSeries:'1' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.cStat, 100);
  assert.equal(parsed.data.chave, '35260912345678000195650010000000421000000420');
  assert.equal(parsed.data.protocolo, '135260000123456');
  assert.equal(parsed.data.xmlPath, 'C:\\ACBrMonitorPLUS\\Arqs\\3526-nfe.xml');
  assert.equal(parsed.data.numero, '42');
  assert.equal(parsed.data.serie, '1');
});

test('does not authorize non-100 ACBr response', () => {
  const parsed = parseAcbrResponse('[NFE42]\r\nCStat=539\r\nXMotivo=Duplicidade de NF-e', { expectedNumber:'42', expectedSeries:'1' });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.data.cStat, 539);
  assert.match(parsed.error, /Duplicidade/);
});

test('TCP transport is loopback-only and sends ACBr command terminator', async () => {
  let written = '';
  const fakeSocket = {
    setTimeout(){},
    write(value){ written += value; },
    end(){},
    destroy(){},
    once(event, handler){ if (event === 'connect') queueMicrotask(handler); },
    on(event, handler){ if (event === 'data') queueMicrotask(() => handler(Buffer.from('OK: teste\r\n.\r\n'))); }
  };
  const transport = createAcbrMonitorTcpTransport({ host:'127.0.0.1', port:3434, connect:() => fakeSocket });
  const result = await transport.send('ACBr.DataHora');
  assert.equal(result, 'OK: teste');
  assert.equal(written, `ACBr.DataHora${ACBR_TERMINATOR}`);
  assert.throws(() => createAcbrMonitorTcpTransport({ host:'192.168.0.10', port:3434 }), /loopback/i);
});

test('adapter issues NFC-e synchronously through NFe.CriarEnviarNFe and normalizes authorization', async () => {
  const commands = [];
  const transport = {
    async send(command) {
      commands.push(command);
      return '[NFE42]\r\nCStat=100\r\nXMotivo=Autorizado o uso da NF-e\r\nChDFe=35260912345678000195650010000000421000000420\r\nNProt=135260000123456\r\n[NFe_Arq42]\r\nArquivo=C:\\ACBr\\3526-nfe.xml';
    }
  };
  const adapter = createAcbrMonitorAdapter({ transport });
  const result = await adapter.issue({ type:'nfce', reference:'V-1001', payload:fiscalDocument(), environment:'homologation' });
  assert.equal(result.ok, true);
  assert.equal(result.data.chave, '35260912345678000195650010000000421000000420');
  assert.equal(result.data.protocolo, '135260000123456');
  assert.equal(commands.length, 1);
  assert.match(commands[0], /^NFe\.CriarEnviarNFe\("/);
  assert.match(commands[0], /",1,0,1\)$/);
});
