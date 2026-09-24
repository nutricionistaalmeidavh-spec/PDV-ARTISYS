'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rendererRoot = path.join(__dirname, '..', 'desktop', 'renderer');
const returnsSource = fs.readFileSync(path.join(rendererRoot, 'returns-ui.js'), 'utf8');
const apiClientSource = fs.readFileSync(path.join(rendererRoot, 'api-client.js'), 'utf8');

test('returns compatibility UI is valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(returnsSource));
});

test('desktop API client exposes delegated return authorization', () => {
  assert.match(apiClientSource, /authorizeReturn\s*\(body\)\s*\{\s*return this\.request\('\/api\/v1\/auth\/authorize'/);
});

test('cashier flow uses one-time manager approval without replacing the PR 74 returns UI', () => {
  assert.match(returnsSource, /const requiresApproval = \(\) => currentRole\(\) === 'cashier'/);
  assert.match(returnsSource, /data-return-authorization/);
  assert.match(returnsSource, /api\.authorizeReturn\(/);
  assert.match(returnsSource, /scope:'return\.complete'/);
  assert.match(returnsSource, /payload\.approvalToken = state\.approval\.approvalToken/);
  assert.match(returnsSource, /state\.approval = null;[\s\S]{0,120}setStatus\('Carregando detalhes da venda/);
  assert.doesNotMatch(returnsSource, /const roleAllowed/);
});

test('manager and admin remain direct return authorizers while unsupported roles stay blocked', () => {
  assert.match(returnsSource, /\['admin','manager'\]\.includes\(currentRole\(\)\)/);
  assert.match(returnsSource, /const canOperate = \(\) => directAllowed\(\) \|\| requiresApproval\(\)/);
  assert.match(returnsSource, /Seu perfil não possui permissão para concluir devoluções/);
});
