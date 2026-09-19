'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'validate-shared-core.ps1'), 'utf8');

test('shared core installs artisys-qa dependencies before running its tests', () => {
  const installIndex = script.indexOf("deps artisys-qa");
  const testIndex = script.indexOf("testes artisys-qa");
  assert.ok(installIndex >= 0, 'validate-shared-core deve ter etapa deps artisys-qa');
  assert.ok(testIndex > installIndex, 'deps artisys-qa deve ocorrer antes dos testes');
  assert.match(script, /npm\s+--prefix\s+.*artisys-qa.*\s+ci\s+--no-audit\s+--no-fund/i);
});
