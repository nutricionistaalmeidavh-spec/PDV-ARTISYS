'use strict';

const { spawnSync } = require('node:child_process');

const packages = [
  'better-sqlite3@8.7.0',
  'serialport-legacy@npm:serialport@10.5.0'
];

const args = ['install', '--no-save', '--no-package-lock', ...packages];
const command = process.platform === 'win32'
  ? ['cmd.exe', ['/d', '/s', '/c', 'npm', ...args]]
  : ['npm', args];

const result = spawnSync(command[0], command[1], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  shell: false
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
