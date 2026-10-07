'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app, safeStorage } = require('electron');

if (process.env.ARTISYS_QA === '1') {
  const explicit = String(process.env.ARTISYS_QA_USER_DATA_DIR || '').trim();
  const runId = `${process.pid}-${Date.now()}`;
  const userDataDir = explicit || path.join(os.tmpdir(), 'artisys-pdv-qa', runId);
  app.setPath('userData', userDataDir);

  if (process.env.ARTISYS_QA_LAN_HOST === '1') {
    fs.mkdirSync(userDataDir, { recursive:true });
    fs.writeFileSync(path.join(userDataDir, 'data-server.json'), JSON.stringify({
      selected:true,
      setupIntent:null,
      mode:'lan-host',
      host:'0.0.0.0',
      port:4174,
      serverUrl:'',
      terminalId:'PDV-01'
    }));
  }

  // Headless Linux runners do not expose an OS keyring. Production still
  // requires Electron safeStorage; only this QA entrypoint substitutes a
  // process-local reversible codec so terminal pairing can be exercised.
  safeStorage.isEncryptionAvailable = () => true;
  safeStorage.encryptString = value => Buffer.from('artisys-qa:' + String(value || ''), 'utf8');
  safeStorage.decryptString = buffer => {
    const value = Buffer.from(buffer).toString('utf8');
    return value.startsWith('artisys-qa:') ? value.slice('artisys-qa:'.length) : value;
  };
}

require('../../desktop/main.cjs');
