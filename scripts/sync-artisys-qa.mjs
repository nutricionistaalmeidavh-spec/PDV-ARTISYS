import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(repoRoot, 'qa', 'runtime');
const lockFile = path.join(repoRoot, 'qa', 'artisys-qa.lock.json');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function resolveSource() {
  const explicit = arg('--source') || process.env.ARTISYS_QA_SOURCE;
  const candidates = [
    explicit,
    path.resolve(repoRoot, '..', 'utilidades', 'modules', 'artisys-qa'),
    path.resolve(repoRoot, '..', '..', 'utilidades', 'modules', 'artisys-qa'),
  ].filter(Boolean);
  const source = candidates.find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
  if (!source) {
    throw new Error('ArtiSys QA source not found. Use --source <path> or ARTISYS_QA_SOURCE pointing to utilidades/modules/artisys-qa.');
  }
  return path.resolve(source);
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function shouldSkip(relative) {
  const normalized = relative.split(path.sep).join('/');
  if (!normalized) return false;
  if (normalized === 'node_modules' || normalized.startsWith('node_modules/')) return true;
  if (normalized === 'test-results' || normalized.startsWith('test-results/')) return true;
  if (normalized === 'playwright-report' || normalized.startsWith('playwright-report/')) return true;
  if (normalized === 'bridge/projects.json') return true;
  if (/^bridge\/jobs\/pending\/.*\.json$/i.test(normalized)) return true;
  return false;
}

function copyTree(source, destination, relative = '') {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (shouldSkip(nextRelative)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to, nextRelative);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

const source = resolveSource();
const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
if (pkg.name !== '@artisys/qa') throw new Error(`Unexpected QA package: ${pkg.name || 'unknown'}`);

const sourceRepoRoot = git(source, 'rev-parse', '--show-toplevel');
const sourceCommit = git(sourceRepoRoot, 'rev-parse', 'HEAD');
const sourcePath = path.relative(sourceRepoRoot, source).split(path.sep).join('/');
const sourceTree = git(sourceRepoRoot, 'rev-parse', `HEAD:${sourcePath}`);

fs.rmSync(runtimeDir, { recursive: true, force: true });
copyTree(source, runtimeDir);
fs.writeFileSync(
  path.join(runtimeDir, 'artisys-qa.mjs'),
  "#!/usr/bin/env node\nimport './src/cli.mjs';\n",
  'utf8',
);

const previous = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : {};
const lock = {
  schemaVersion: 2,
  module: '@artisys/qa',
  version: pkg.version,
  sourceRepository: previous.sourceRepository || 'nutricionistaalmeidavh-spec/utilidades',
  sourcePath,
  sourceCommit,
  sourceTree,
  consumption: 'full-vendored-runtime',
  policy: {
    consumerConfig: 'qa/artisys-qa.config.json',
    runtimeSelection: 'qaProfiles',
    ciNeedsSourceRepositoryAccess: false,
    excludedTransientState: [
      'bridge/projects.json',
      'bridge/jobs/pending/*.json'
    ]
  }
};
fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
console.log(`Synced @artisys/qa ${pkg.version} from ${sourceCommit.slice(0, 12)} (${sourceTree.slice(0, 12)})`);
