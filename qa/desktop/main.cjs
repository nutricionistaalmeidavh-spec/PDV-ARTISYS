'use strict';

const path = require('node:path');
const os = require('node:os');
const { app } = require('electron');

if (process.env.ARTISYS_QA === '1') {
  const explicit = String(process.env.ARTISYS_QA_USER_DATA_DIR || '').trim();
  const runId = `${process.pid}-${Date.now()}`;
  const userDataDir = explicit || path.join(os.tmpdir(), 'artisys-pdv-qa', runId);
  app.setPath('userData', userDataDir);
}

require('../../desktop/main.cjs');
