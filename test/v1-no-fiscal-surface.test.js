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

test('V1 desktop exposes no fiscal IPC, sidecar or provider bootstrap', () => {
  const main = read('desktop/main.cjs');
  const preload = read('desktop/preload.cjs');
  assert.doesNotMatch(main, /fiscal-bridge|fiscal-credential-store|fiscal-sidecar-runtime|fiscal-runtime-paths|nfse-provider-resolver|registerFiscalIpc|artisys:fiscal/);
  assert.doesNotMatch(preload, /artisys:fiscal|\bfiscal:\s*\{/);
});

test('V1 runtime has no fiscal or NFS-e services, migrations or sale effects', () => {
  const runtime = read('js/core/pdv-runtime.js');
  assert.doesNotMatch(runtime, /runFiscalMigrations|runNfseMigrations|createFiscalService|createFiscalConfigurationService|createFiscalProductionService|createFiscalObservability|createFiscalRecoveryService|createNfseService|registerFiscalEffects|registerFiscalAutoIssueEffect/);
  assert.match(runtime, /createNonFiscalPrintService/);
  assert.match(runtime, /registerNonFiscalEffects/);
});

test('V1 fresh core schema creates no fiscal document table and does not drop legacy data', () => {
  const migrations = read('js/core/database/migrations.js');
  assert.doesNotMatch(migrations, /CREATE TABLE IF NOT EXISTS fiscal_documents/);
  assert.doesNotMatch(migrations, /DROP TABLE[^;]*fiscal/i);
});

test('V1 infrastructure has no fiscal telemetry, diagnostics, restore companions or pilot check', () => {
  assert.doesNotMatch(read('js/core/telemetry/telemetry-effects.js'), /fiscal\./);
  assert.doesNotMatch(read('js/core/observability/diagnostic-package.js'), /fiscalSnapshot|fiscal-diagnostics/);
  assert.doesNotMatch(read('js/core/backup/pending-restore.js'), /fiscal-archive|fiscal-packs/);
  assert.doesNotMatch(read('js/core/pilot/pilot-service.js'), /fiscal-test|category:'fiscal'/);
  assert.doesNotMatch(read('js/core/pdv-event-types.js'), /FISCAL_|fiscal\./);
});
