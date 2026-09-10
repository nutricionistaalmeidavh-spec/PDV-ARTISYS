const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'qa', 'artisys-qa.config.json');

test('PDV declares a reusable ArtiSys QA consumer manifest', () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.systemId, 'pdv-artisys');
  assert.equal(config.mode, 'electron');
  assert.equal(config.defaultEnvironment, 'ci');
  assert.equal(config.defaultFlow, 'smoke');
  assert.equal(config.capture.video, true);
  assert.ok(config.electron.entry.endsWith('desktop/main.cjs'));
  assert.ok(config.electron.executablePath.includes('node_modules/electron'));
  for (const flow of Object.values(config.flows)) {
    assert.ok(fs.existsSync(path.resolve(path.dirname(configPath), flow)), `missing flow ${flow}`);
  }
});

test('QA flows use stable DOM hooks and capture screenshots', () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  for (const flowPath of Object.values(config.flows)) {
    const flow = JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath), flowPath), 'utf8'));
    assert.ok(Array.isArray(flow.steps) && flow.steps.length > 0);
    assert.ok(flow.steps.some(step => step.action === 'screenshot'));
    for (const step of flow.steps) {
      assert.ok(!Object.prototype.hasOwnProperty.call(step, 'password'));
      assert.ok(!Object.prototype.hasOwnProperty.call(step, 'token'));
    }
  }
});
