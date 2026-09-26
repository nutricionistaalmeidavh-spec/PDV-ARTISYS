'use strict';

const { spawnSync } = require('node:child_process');

const packages = [
  'better-sqlite3@8.7.0',
  'serialport-legacy@npm:serialport@10.5.0'
];

// electron-builder follows the production dependency graph when assembling the
// app. The legacy-only native modules therefore need to be promoted to
// production dependencies in this ephemeral CI workspace before packaging.
// --no-package-lock keeps the repository clean; --ignore-scripts lets
// electron-builder rebuild the native modules for Electron 22 and the target
// architecture during the packaging step.
const args = ['install', '--save-prod', '--no-package-lock', '--ignore-scripts', ...packages];
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
