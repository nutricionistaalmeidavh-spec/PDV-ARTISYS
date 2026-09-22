'use strict';

const { spawnSync } = require('node:child_process');

const packages = [
  'better-sqlite3@8.7.0',
  'serialport-legacy@npm:serialport@10.5.0'
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['install', '--no-save', '--no-package-lock', ...packages], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
