'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const exists = rel => fs.existsSync(path.join(ROOT, rel));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('E22-E29 migration remains preserved while current schema advances beyond restaurant v5', () => {
  const rel = 'js/core/database/release-migrations.js';
  assert.ok(exists(rel), `${rel} deve existir`);
  const { RELEASE_SCHEMA_VERSION, RELEASE_MIGRATIONS, runReleaseMigrations } = require(path.join(ROOT, rel));
  assert.equal(RELEASE_SCHEMA_VERSION, 5);
  assert.equal(typeof runReleaseMigrations, 'function');
  assert.ok(RELEASE_MIGRATIONS.some(migration => migration.version === 4 && migration.name === 'pdv_release_e22_e29'));
  assert.ok(RELEASE_MIGRATIONS.some(migration => migration.version === 5));
});

test('approved settings screen actually loads the E22-E28 operations control center', () => {
  const html = read('desktop/renderer/index.html');
  const pkg = JSON.parse(read('package.json'));
  assert.match(html, /admin-ops\.js/);
  assert.match(pkg.scripts['lint:desktop'], /admin-ops\.js/);
});

test('package keeps Windows NSIS and XLSX support in release 1.3.2', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '1.3.2');
  assert.equal(pkg.dependencies.xlsx, '^0.18.5');
  assert.equal(pkg.dependencies['@artisys/serialport'], 'file:vendor/artisys-serialport');
  assert.equal(pkg.dependencies['@artisys/printing'], 'file:vendor/artisys-printing');
  assert.ok(pkg.devDependencies['electron-builder']);
  assert.match(pkg.scripts['dist:win'], /electron-builder/);
  assert.match(pkg.scripts['release:manifest'], /generate-release-manifest/);
  assert.equal(pkg.build.appId, 'com.artisys.pdv');
  assert.equal(pkg.build.productName, 'ArtiSys PDV');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
});

test('release manifest remains deterministic and hashes supplied v1.3.2 artifacts', () => {
  const rel = 'scripts/generate-release-manifest.js';
  assert.ok(exists(rel), `${rel} deve existir`);
  const { buildReleaseManifest } = require(path.join(ROOT, rel));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-release-manifest-'));
  try {
    const artifact = path.join(dir, 'ArtiSys-PDV-1.3.2-x64-Setup.exe');
    fs.writeFileSync(artifact, 'fixture');
    const manifest = buildReleaseManifest({
      rootDir: ROOT,
      commit: 'abc123',
      builtAt: '2026-09-15T14:00:00.000Z',
      artifactPaths: [artifact],
      verification: { verify: 'pass', verifyRelease: 'pass', windowsBuild: 'pass' }
    });
    assert.equal(manifest.version, '1.3.2');
    assert.equal(manifest.commit, 'abc123');
    assert.equal(manifest.schemaVersion, 10);
    assert.equal(manifest.builtAt, '2026-09-15T14:00:00.000Z');
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0].sha256, crypto.createHash('sha256').update('fixture').digest('hex'));
    assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.length >= 10);
    assert.ok(Array.isArray(manifest.limitations));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('all operations manuals and release metadata exist without future-delivery placeholders', () => {
  const docs = [
    'docs/operations/install-server.md', 'docs/operations/install-terminal.md', 'docs/operations/pairing.md',
    'docs/operations/cash-sales-returns.md', 'docs/operations/backup-restore.md', 'docs/operations/hardware-printing.md',
    'docs/operations/fiscal.md', 'docs/operations/import.md', 'docs/operations/diagnostics.md', 'docs/operations/update.md',
    'docs/architecture/e30-e39-restaurant.md', 'release/capabilities.json', 'release/limitations.json', 'release/release-checklist.md'
  ];
  for (const rel of docs) assert.ok(exists(rel), `${rel} deve existir`);
  const readme = read('README.md');
  assert.match(readme, /ArtiSys PDV 1\.3\.2/);
  assert.doesNotMatch(readme, /E2[1-9].*(futuro|pendente|a fazer)/i);
});

test('CI verifies main while Windows packaging is explicit or version-tagged only', () => {
  const verify = read('.github/workflows/verify.yml');
  const windows = read('.github/workflows/release-windows.yml');
  assert.match(verify, /branches:\s*\n\s*- main/);
  assert.match(verify, /npm install/);
  assert.match(verify, /npm run verify:release/);
  assert.match(windows, /workflow_dispatch/);
  assert.match(windows, /tags:\s*\n\s*- 'v\*'/);
  assert.match(windows, /windows-latest/);
  assert.match(windows, /npm run verify:release/);
  assert.match(windows, /npm run dist:win/);
  assert.match(windows, /actions\/upload-artifact/);
  assert.match(windows, /gh release create/);
  assert.doesNotMatch(windows, /refs\/heads\/main/);
});
