'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFiscalDocument } = require('../js/domains/fiscal/fiscal-document-builder');
const { createAcbrLocalProvider } = require('../js/domains/fiscal/acbr-local-provider');
const { createFiscalSidecar } = require('../server/fiscal-sidecar');
const { createAcbrMonitorAdapter } = require('../server/fiscal-sidecar/acbr-monitor-adapter');

function sampleSale(overrides = {}) {
  return {
    id:'sale-e2e', saleNumber:'V-E2E-1', status:'COMPLETED', subtotalCents:1000, discountCents:0, totalCents:1000, changeCents:0,
    completedAt:'2026-09-20T19:00:00-03:00', customerId:null,
    items:[{ id:'item-e2e', productId:'p-e2e', productName:'Produto E2E', sku:'E2E', quantity:1, unitPriceCents:1000, totalCents:1000 }],
    payments:[{ id:'pay-e2e', method:'PIX', amountCents:1000 }],
    ...overrides
  };
}

function sampleFiscalContext(overrides = {}) {
  return {
    issuer:{ cnpj:'12345678000195', legalName:'EMPRESA HOMOLOGACAO LTDA', tradeName:'EMPRESA HOMOLOGACAO', stateRegistration:'123456789', crt:'1', address:{ street:'Rua Teste', number:'100', district:'Centro', cityCode:'3543402', city:'Ribeirao Preto', state:'SP', zip:'14000000' } },
    series:'1', number:'77', operationNature:'VENDA',
    items:{ 'p-e2e':{ ncm:'22021000', cfop:'5102', unit:'UN', origin:'0', csosn:'102', pisCst:'49', cofinsCst:'49' } },
    ...overrides
  };
}

function buildDocument({ reference = 'V-E2E-1', number = '77' } = {}) {
  const sale = sampleSale({ saleNumber:reference });
  const fiscalContext = sampleFiscalContext({ number });
  return { sale, document:buildFiscalDocument({ sale, fiscalContext, documentType:'nfce', environment:'homologation', reference }) };
}

function readIniFromCreateSendCommand(command) {
  const match = String(command).match(/^NFe\.CriarEnviarNFe\("([^"]+)",1,0,1\)$/);
  assert.ok(match, `Comando ACBr inesperado: ${command}`);
  return fs.readFileSync(match[1], 'utf8');
}

test('E2E P6-P7 deterministic: canonical sale reaches ACBr adapter and returns authorization metadata', async t => {
  const { sale, document } = buildDocument();
  const transport = {
    async send(command) {
      const ini = readIniFromCreateSendCommand(command);
      assert.match(ini, /mod=65/);
      assert.match(ini, /vNF=10\.00/);
      return '[NFE77]\r\nCStat=100\r\nXMotivo=Autorizado o uso da NF-e\r\nChDFe=35260912345678000195650010000000771000000770\r\nNProt=135260000777777\r\n[NFe_Arq77]\r\nArquivo=C:\\ACBr\\3526-e2e-nfe.xml';
    }
  };
  const adapter = createAcbrMonitorAdapter({ transport });
  const sidecar = createFiscalSidecar({ adapter, host:'127.0.0.1', port:0 });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());

  const provider = createAcbrLocalProvider({
    connection:{ provider:'acbr-local', environment:'homologation', documentType:'nfce' },
    baseUrl:`http://127.0.0.1:${address.port}`
  });
  const result = await provider.issue({ documentType:'nfce', reference:sale.saleNumber, payload:document });

  assert.equal(result.ok, true);
  assert.equal(result.data.chave, '35260912345678000195650010000000771000000770');
  assert.equal(result.data.protocolo, '135260000777777');
  assert.equal(result.data.xmlPath, 'C:\\ACBr\\3526-e2e-nfe.xml');
  assert.equal(document.totals.totalCents, sale.totalCents);
  assert.equal(sale.totalCents, 1000);
});

test('E2E P7 guard: ACBr rejection stays failed and never becomes authorization', async t => {
  const { document } = buildDocument({ reference:'V-REJECT', number:'1' });
  const adapter = createAcbrMonitorAdapter({ transport:{ async send(command){ readIniFromCreateSendCommand(command); return '[NFE1]\r\nCStat=225\r\nXMotivo=Falha no Schema XML'; } } });
  const sidecar = createFiscalSidecar({ adapter, host:'127.0.0.1', port:0 });
  const address = await sidecar.start();
  t.after(() => sidecar.stop());
  const provider = createAcbrLocalProvider({ connection:{ provider:'acbr-local', environment:'homologation', documentType:'nfce' }, baseUrl:`http://127.0.0.1:${address.port}` });
  const result = await provider.issue({ documentType:'nfce', reference:'V-REJECT', payload:document });
  assert.equal(result.ok, false);
  assert.equal(result.data.cStat, 225);
  assert.match(result.error, /Schema XML/);
});
