'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('V1 renderer does not load fiscal, NFS-e or product fiscal extensions', () => {
  const index = read('desktop/renderer/index.html');
  for (const asset of ['fiscal-config.css','fiscal-config-api-client.js','fiscal-monitor.js','fiscal-config-ui.js','nfse-api-client.js','nfse-ui.js','product-fiscal-fields.js']) assert.equal(index.includes(asset), false, asset);
});

test('V1 settings has no fiscal category or fiscal credential workflow', () => {
  const hub = read('desktop/renderer/settings-hub-ui.js');
  const operational = read('desktop/renderer/operational-pages.js');
  assert.doesNotMatch(hub, /data-settings-category="fiscal"|\['fiscal','Fiscal'/);
  assert.doesNotMatch(operational, /settings-fiscal|ops-fiscal-form|artisysDesktop\.fiscal/);
});

test('V1 keeps non-fiscal print queue and reprint API client operations', () => {
  const operational = read('desktop/renderer/operational-pages.js');
  const api = read('desktop/renderer/api-client.js');
  assert.match(operational, /Fila de impressão/);
  assert.match(operational, /data-print-retry/);
  assert.match(api, /printJobs\s*\(/);
  assert.match(api, /retryPrint\s*\(/);
  assert.match(api, /reprint\s*\(/);
});

test('V1 local server does not mount fiscal or NFS-e routers', () => {
  const local = read('server/local-server.js');
  const router = read('server/router.js');
  assert.doesNotMatch(local, /createFiscalBlock5Router|createFiscalBlock6Router|createNfseRouter|fiscalBlock5Handler|fiscalBlock6Handler|nfseHandler/);
  assert.equal(router.includes('/api/v1/fiscal/documents'), false);
});
