'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const packageJson = require('../package.json');
const { resolveFiscalRuntimePaths } = require('../desktop/fiscal-runtime-paths.cjs');
const { createFiscalPackService } = require('../js/domains/fiscal/fiscal-pack-store');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writePack(root, {
  id = 'br-core',
  version = '2026.09.0',
  relativePath = 'parameters/runtime.json',
  kind = 'parameters',
  content = '{"environment":"homologation"}',
  checksum = null
} = {}) {
  const target = path.join(root, ...relativePath.replace(/\\/g, '/').split('/'));
  fs.mkdirSync(path.dirname(target), { recursive:true });
  fs.writeFileSync(target, content);
  const manifest = {
    formatVersion:1,
    id,
    version,
    createdAt:'2026-09-20T00:00:00.000Z',
    files:[{
      path:relativePath,
      kind,
      sha256:checksum || sha256(content)
    }]
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

test('P20: packaged runtime paths resolve exclusively below process.resourcesPath/fiscal', () => {
  const resourcesPath = path.join(path.sep, 'opt', 'artisys', 'resources');
  const resolved = resolveFiscalRuntimePaths({ isPackaged:true, resourcesPath });

  assert.equal(resolved.runtimeRoot, path.join(resourcesPath, 'fiscal'));
  assert.equal(resolved.sidecarEntry, path.join(resourcesPath, 'fiscal', 'sidecar', 'entry.js'));
  assert.equal(resolved.acbrRoot, path.join(resourcesPath, 'fiscal', 'acbr'));
  assert.equal(resolved.configsRoot, path.join(resourcesPath, 'fiscal', 'configs'));
  assert.equal(resolved.schemasRoot, path.join(resourcesPath, 'fiscal', 'schemas'));
  assert.equal(resolved.manifestPath, path.join(resourcesPath, 'fiscal', 'manifest.json'));
  assert.equal(resolved.runtimeRoot.includes('app.asar'), false);
});

test('P20: development paths remain local and do not require an installed package', () => {
  const projectRoot = tempDir('artisys-fiscal-dev-');
  const resolved = resolveFiscalRuntimePaths({ isPackaged:false, projectRoot });

  assert.equal(resolved.sidecarEntry, path.join(projectRoot, 'server', 'fiscal-sidecar', 'entry.js'));
  assert.equal(resolved.acbrRoot, path.join(projectRoot, 'fiscal-runtime', 'acbr'));
  assert.equal(resolved.configsRoot, path.join(projectRoot, 'fiscal-runtime', 'configs'));
  assert.equal(resolved.schemasRoot, path.join(projectRoot, 'fiscal-runtime', 'schemas'));
});

test('P20: electron-builder copies sidecar, ACBr, configs, schemas and manifest with extraResources outside ASAR', () => {
  assert.equal(packageJson.build.asar, true);
  assert.ok(Array.isArray(packageJson.build.extraResources));
  const pairs = new Set(packageJson.build.extraResources.map(item => `${item.from}=>${item.to}`));

  assert.ok(pairs.has('server/fiscal-sidecar=>fiscal/sidecar'));
  assert.ok(pairs.has('fiscal-runtime/acbr=>fiscal/acbr'));
  assert.ok(pairs.has('fiscal-runtime/configs=>fiscal/configs'));
  assert.ok(pairs.has('fiscal-runtime/schemas=>fiscal/schemas'));
  assert.ok(pairs.has('fiscal-runtime/manifest.json=>fiscal/manifest.json'));
});

test('P21: validates and imports a local versioned fiscal pack with checksums', () => {
  const source = tempDir('artisys-pack-source-');
  const storeRoot = tempDir('artisys-pack-store-');
  writePack(source);

  const service = createFiscalPackService({ storeRoot });
  const validation = service.validate(source);
  assert.equal(validation.valid, true);
  assert.equal(validation.manifest.id, 'br-core');
  assert.equal(validation.manifest.version, '2026.09.0');

  const imported = service.importPack(source);
  assert.equal(imported.installed, true);
  assert.equal(imported.id, 'br-core');
  assert.equal(imported.version, '2026.09.0');
  assert.ok(imported.installPath.startsWith(path.resolve(storeRoot)));
  assert.equal(fs.readFileSync(path.join(imported.installPath, 'parameters', 'runtime.json'), 'utf8'), '{"environment":"homologation"}');

  const installed = service.listInstalled();
  assert.deepEqual(installed.map(pack => `${pack.id}@${pack.version}`), ['br-core@2026.09.0']);
});

test('P21: repeated import of identical pack is idempotent', () => {
  const source = tempDir('artisys-pack-idempotent-source-');
  const storeRoot = tempDir('artisys-pack-idempotent-store-');
  writePack(source);
  const service = createFiscalPackService({ storeRoot });

  const first = service.importPack(source);
  const second = service.importPack(source);

  assert.equal(first.installPath, second.installPath);
  assert.equal(second.installed, false);
  assert.equal(second.alreadyInstalled, true);
});

test('P21: rejects checksum tampering before changing installed packs', () => {
  const source = tempDir('artisys-pack-tamper-source-');
  const storeRoot = tempDir('artisys-pack-tamper-store-');
  writePack(source, { checksum:'0'.repeat(64) });
  const service = createFiscalPackService({ storeRoot });

  assert.throws(() => service.importPack(source), /checksum|sha256/i);
  assert.deepEqual(service.listInstalled(), []);
});

test('P21: rejects traversal, absolute paths and executable content from fiscal packs', () => {
  const storeRoot = tempDir('artisys-pack-security-store-');
  const service = createFiscalPackService({ storeRoot });

  for (const relativePath of ['../escape.json', '/tmp/escape.json', 'C:\\escape.json', 'rules/run.js']) {
    const source = tempDir('artisys-pack-security-source-');
    const targetPath = relativePath.startsWith('..') || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)
      ? 'safe.json'
      : relativePath;
    fs.mkdirSync(path.dirname(path.join(source, targetPath)), { recursive:true });
    fs.writeFileSync(path.join(source, targetPath), '{}');
    const manifest = {
      formatVersion:1,
      id:'security-test',
      version:'1.0.0',
      createdAt:'2026-09-20T00:00:00.000Z',
      files:[{ path:relativePath, kind:'rules', sha256:sha256('{}') }]
    };
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => service.validate(source), /path|extensao|arquivo|permitid/i, relativePath);
  }
});

test('P21 integration: local CLI validates and imports without any network endpoint', () => {
  const source = tempDir('artisys-pack-cli-source-');
  const storeRoot = tempDir('artisys-pack-cli-store-');
  writePack(source, { id:'cli-pack', version:'1.2.3' });

  const validateRun = spawnSync(process.execPath, ['scripts/fiscal-pack-cli.js', 'validate', source, '--store', storeRoot], {
    cwd:path.join(__dirname, '..'),
    encoding:'utf8',
    env:{ ...process.env, HTTP_PROXY:'', HTTPS_PROXY:'', ALL_PROXY:'' }
  });
  assert.equal(validateRun.status, 0, validateRun.stderr || validateRun.stdout);
  assert.match(validateRun.stdout, /cli-pack@1\.2\.3/);

  const importRun = spawnSync(process.execPath, ['scripts/fiscal-pack-cli.js', 'import', source, '--store', storeRoot], {
    cwd:path.join(__dirname, '..'),
    encoding:'utf8',
    env:{ ...process.env, HTTP_PROXY:'', HTTPS_PROXY:'', ALL_PROXY:'' }
  });
  assert.equal(importRun.status, 0, importRun.stderr || importRun.stdout);
  assert.match(importRun.stdout, /importado|installed/i);
  assert.equal(fs.existsSync(path.join(storeRoot, 'cli-pack', '1.2.3', 'manifest.json')), true);
});
