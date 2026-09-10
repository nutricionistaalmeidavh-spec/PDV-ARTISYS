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
  assert.equal(config.defaultDemo, 'quick-30s');
  assert.equal(config.capture.video, true);
  assert.ok(config.electron.entry.endsWith('desktop/main.cjs'));
  assert.ok(config.electron.executablePath.includes('node_modules/electron'));
  for (const flow of Object.values(config.flows)) {
    assert.ok(fs.existsSync(path.resolve(path.dirname(configPath), flow)), `missing flow ${flow}`);
  }
  for (const [name, demo] of Object.entries(config.demos)) {
    assert.ok(fs.existsSync(path.resolve(path.dirname(configPath), demo.file)), `missing demo ${name}`);
    assert.ok(['reels-9x16', 'landscape-16x9', 'square-1x1'].includes(demo.preset));
    assert.ok(Number.isFinite(demo.durationTargetSec) && demo.durationTargetSec > 0);
  }
});

test('QA and demo flows use stable hooks, screenshots and no embedded secrets', () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const files = [
    ...Object.values(config.flows),
    ...Object.values(config.demos).map(demo => demo.file),
  ];
  for (const flowPath of files) {
    const flow = JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath), flowPath), 'utf8'));
    assert.ok(Array.isArray(flow.steps) && flow.steps.length > 0);
    assert.ok(flow.steps.some(step => step.action === 'screenshot'));
    for (const step of flow.steps) {
      assert.ok(!Object.prototype.hasOwnProperty.call(step, 'password'));
      assert.ok(!Object.prototype.hasOwnProperty.call(step, 'token'));
      if (step.holdMs != null) assert.ok(Number.isFinite(step.holdMs) && step.holdMs >= 0);
    }
  }
});

test('PDV quick demo defaults to a 30-second Reels deliverable', () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const demo = config.demos['quick-30s'];
  assert.equal(demo.preset, 'reels-9x16');
  assert.equal(demo.durationTargetSec, 30);
  const flow = JSON.parse(fs.readFileSync(path.resolve(path.dirname(configPath), demo.file), 'utf8'));
  assert.equal(flow.durationTargetSec, 30);
  assert.ok(flow.steps.some(step => step.name === 'produtos'));
  assert.ok(flow.steps.some(step => step.name === 'balcao'));
  assert.ok(flow.steps.some(step => step.name === 'caixa'));
  assert.ok(flow.steps.some(step => step.name === 'relatorios'));
});

test('vendored QA runtime is 1.1.1 and normalizes demo media duration', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'qa', 'artisys-qa.lock.json'), 'utf8'));
  const runtime = fs.readFileSync(path.join(root, 'qa', 'runtime', 'artisys-qa.mjs'), 'utf8');
  assert.equal(lock.version, '1.1.1');
  assert.match(runtime, /MODULE_VERSION = '1\.1\.1'/);
  assert.match(runtime, /ffprobe/);
  assert.match(runtime, /setpts=/);
  assert.match(runtime, /videoDurationSec/);
});
