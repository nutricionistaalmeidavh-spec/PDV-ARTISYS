'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAcbrMonitorTcpTransport } = require('../../server/fiscal-sidecar/acbr-monitor-protocol');
const { createAcbrMonitorAdapter } = require('../../server/fiscal-sidecar/acbr-monitor-adapter');

const enabled = process.env.ARTISYS_FISCAL_EXTERNAL_E2E === '1';

test('EXTERNAL_E2E: ACBrMonitor authorizes one NFC-e in homologation', { skip:!enabled }, async () => {
  const documentFile = String(process.env.ARTISYS_FISCAL_EXTERNAL_DOCUMENT_FILE || '').trim();
  if (!documentFile) throw new Error('ARTISYS_FISCAL_EXTERNAL_DOCUMENT_FILE obrigatorio.');
  const document = JSON.parse(fs.readFileSync(documentFile, 'utf8'));
  assert.equal(document.documentType, 'nfce');
  assert.equal(document.environment, 'homologation');
  assert.equal(document.identification?.model, '65');

  const transport = createAcbrMonitorTcpTransport({
    host:String(process.env.ARTISYS_ACBR_HOST || '127.0.0.1'),
    port:Number(process.env.ARTISYS_ACBR_PORT || 3434),
    timeoutMs:Number(process.env.ARTISYS_ACBR_TIMEOUT_MS || 30000)
  });
  const adapter = createAcbrMonitorAdapter({ transport });
  const status = await adapter.status();
  assert.equal(status.ok, true, status.error || 'ACBrMonitor indisponivel');

  const result = await adapter.issue({
    type:'nfce',
    reference:String(document.reference),
    payload:document,
    environment:'homologation'
  });
  assert.equal(result.ok, true, result.error || 'NFC-e nao autorizada em homologacao');
  assert.equal(result.data?.cStat, 100);
  assert.match(String(result.data?.chave || ''), /^\d{44}$/);
  assert.match(String(result.data?.protocolo || ''), /^\d+$/);
  assert.ok(String(result.data?.xmlPath || '').length > 0);
});
