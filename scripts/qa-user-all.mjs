import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const qaRuntimeRoot = path.join(root, 'qa/runtime');
const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const deliveryRoot = path.join(root, 'qa-delivery-artifacts', stamp);
const qaOutput = path.join(deliveryRoot, 'qa-artifacts');
const qaFrom = String(process.env.ARTISYS_QA_FROM || '').trim();
process.env.ARTISYS_QA_CASHIER_PASSWORD ||= `Qa-${randomBytes(12).toString('base64url')}-1aA!`;
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  system: 'pdv-artisys',
  resumedFrom: qaFrom || null,
  steps: [],
  flows: [],
  artifacts: {},
};

fs.mkdirSync(deliveryRoot, { recursive: true });

function npmArgs(...args) {
  return process.platform === 'win32' ? ['/d', '/s', '/c', 'npm', ...args] : args;
}

function run(label, command, args, { required = false, cwd = root } = {}) {
  console.log(`\n=== ${label} ===`);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  const code = Number.isInteger(result.status) ? result.status : 1;
  const error = result.error?.message || null;
  if (error) console.error(`Falha ao iniciar ${command}: ${error}`);
  report.steps.push({ label, command: [command, ...args].join(' '), cwd, status: code === 0 ? 'PASS' : 'FAIL', exitCode: code, durationMs: Date.now() - started, ...(error ? { error } : {}) });
  if (code !== 0 && required) {
    writeSummary();
    process.exit(code || 1);
  }
  return code === 0;
}

function latestInstaller() {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(dist)) return null;
  return fs.readdirSync(dist)
    .filter(name => /^ArtiSys-PDV-.*-Setup\.exe$/i.test(name))
    .map(name => ({ path: path.join(dist, name), mtime: fs.statSync(path.join(dist, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.path || null;
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function writeSummary() {
  report.finishedAt = new Date().toISOString();
  const failedSteps = report.steps.filter(item => item.status === 'FAIL');
  const failedFlows = report.flows.filter(item => item.status === 'FAIL');
  report.status = failedSteps.length || failedFlows.length ? 'FAIL' : 'PASS';
  report.counts = {
    stepsPassed: report.steps.filter(item => item.status === 'PASS').length,
    stepsFailed: failedSteps.length,
    flowsPassed: report.flows.filter(item => item.status === 'PASS').length,
    flowsFailed: failedFlows.length,
  };
  fs.writeFileSync(path.join(deliveryRoot, 'QA-SUMMARY.json'), JSON.stringify(report, null, 2));
  const text = [
    `PDV ArtiSys QA user-all`,
    `Status: ${report.status}`,
    `Início: ${report.startedAt}`,
    `Fim: ${report.finishedAt}`,
    `Retomado de: ${report.resumedFrom || 'início'}`,
    `Etapas: ${report.counts.stepsPassed} PASS / ${report.counts.stepsFailed} FAIL`,
    `Fluxos: ${report.counts.flowsPassed} PASS / ${report.counts.flowsFailed} FAIL`,
    '',
    ...report.steps.map(item => `${item.status} | ${item.label}${item.error ? ` | ${item.error}` : ''}`),
    ...report.flows.map(item => `${item.status} | ${item.flow}${item.error ? ` | ${item.error}` : ''}`),
  ].join('\n');
  fs.writeFileSync(path.join(deliveryRoot, 'QA-SUMMARY.txt'), text, 'utf8');
}

console.log(`ArtiSys PDV - QA completo de fluxos do usuário`);
console.log(`Artefatos: ${deliveryRoot}`);
if (qaFrom) console.log(`Retomada solicitada a partir de: ${qaFrom}`);

const hasLockfile = fs.existsSync(path.join(root, 'package-lock.json')) || fs.existsSync(path.join(root, 'npm-shrinkwrap.json'));
const dependencyArgs = hasLockfile ? ['ci'] : ['install', '--no-audit', '--no-fund'];
console.log(`Dependências: ${hasLockfile ? 'npm ci (lockfile encontrado)' : 'npm install (repositório sem lockfile)'}`);
run('Instalar dependências', npmCommand, npmArgs(...dependencyArgs), { required: true });

const qaRuntimeHasLockfile = fs.existsSync(path.join(qaRuntimeRoot, 'package-lock.json')) || fs.existsSync(path.join(qaRuntimeRoot, 'npm-shrinkwrap.json'));
const qaRuntimeDependencyArgs = qaRuntimeHasLockfile ? ['ci'] : ['install', '--no-audit', '--no-fund'];
run('Instalar runtime de QA', npmCommand, npmArgs(...qaRuntimeDependencyArgs), { required: true, cwd: qaRuntimeRoot });

// A pedido do processo de entrega, o instalador é gerado ANTES do QA.
const buildPassed = run('Gerar instalador Windows', npmCommand, npmArgs('run', 'dist:win'));
const installer = latestInstaller();
if (installer) {
  const installerCopy = path.join(deliveryRoot, path.basename(installer));
  fs.copyFileSync(installer, installerCopy);
  report.artifacts.installer = installerCopy;
  report.artifacts.installerSha256 = sha256(installerCopy);
  fs.writeFileSync(path.join(deliveryRoot, 'installer.sha256.txt'), `${report.artifacts.installerSha256}  ${path.basename(installerCopy)}\n`, 'utf8');
} else if (buildPassed) {
  report.steps.push({ label: 'Localizar instalador', status: 'FAIL', exitCode: 1, durationMs: 0 });
}

run('Verificação de código e testes existentes', npmCommand, npmArgs('run', 'verify'));
run('Gate financeiro P0-P10', npmCommand, npmArgs('run', 'test:finance-release'));

let runtimeAvailable = true;
try {
  const manifestModule = await import(pathToFileURL(path.join(root, 'qa/runtime/src/manifest.js')).href);
  const runnerModule = await import(pathToFileURL(path.join(root, 'qa/runtime/src/runner.js')).href);
  const configPath = path.join(root, 'qa/artisys-qa.config.json');
  const { manifest, rootDir } = await manifestModule.loadQaManifest(configPath);
  const { name: environmentName, environment } = manifestModule.resolveEnvironment(manifest, 'ci');
  const viewport = manifestModule.resolveViewport(manifest, 'desktop');
  const flowDir = path.join(root, 'qa/flows/user');
  let flowFiles = fs.readdirSync(flowDir)
    .filter(name => /^\d\d-.*\.json$/i.test(name) && !name.startsWith('25-'))
    .sort();

  if (qaFrom) {
    const requested = qaFrom.toLowerCase().replace(/\.json$/i, '');
    const startIndex = flowFiles.findIndex(file => path.basename(file, '.json').toLowerCase() === requested);
    if (startIndex < 0) throw new Error(`Fluxo informado em ARTISYS_QA_FROM não encontrado: ${qaFrom}`);
    flowFiles = flowFiles.slice(startIndex);
    console.log(`Fluxos anteriores a ${qaFrom} serão ignorados nesta retomada.`);
  }

  for (const file of flowFiles) {
    const flowName = path.basename(file, '.json');
    console.log(`\n=== Fluxo ${flowName} ===`);
    const started = Date.now();
    try {
      const result = await runnerModule.runQaFlow({
        manifest,
        rootDir,
        environmentName,
        environment,
        flowName,
        flowFile: path.join(flowDir, file),
        viewport,
        outputRoot: qaOutput,
        onProgress: event => {
          if (event.type === 'step-start') {
            console.log(`  [${event.current}/${event.total}] ${event.step}`);
          } else if (event.type === 'step-end' && event.status === 'failed') {
            console.error(`  FALHA em ${event.step}: ${event.error || 'erro não informado'}`);
          }
        },
      });
      report.flows.push({ flow: flowName, status: 'PASS', durationMs: Date.now() - started, outputDir: result.outputDir });
    } catch (error) {
      report.flows.push({ flow: flowName, status: 'FAIL', durationMs: Date.now() - started, error: error?.message || String(error), summary: error?.summary || null });
      console.error(error?.stack || error);
    }
  }
} catch (error) {
  runtimeAvailable = false;
  report.steps.push({ label: 'Inicializar runtime de QA', status: 'FAIL', exitCode: 1, durationMs: 0, error: error?.message || String(error) });
  console.error(error?.stack || error);
}

run('Backup e restore atômico', process.execPath, ['--test', 'test/e22-backup.test.js', 'test/release/recovery.test.js']);
run('Rede LAN e multi-terminal', process.execPath, ['--test', 'test/e21-lan-api.test.js']);

if (installer && process.platform === 'win32') {
  run('Instalar e abrir o executável gerado', powershell, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts/qa-installed-smoke.ps1'),
    '-Installer', installer,
    '-OutputDir', deliveryRoot,
  ]);
} else {
  report.steps.push({ label: 'Instalar e abrir o executável gerado', status: 'SKIPPED', exitCode: null, durationMs: 0, reason: installer ? 'Smoke de instalador requer Windows.' : 'Instalador não encontrado.' });
}

if (runtimeAvailable && fs.existsSync(qaOutput)) report.artifacts.qaArtifacts = qaOutput;
writeSummary();
console.log(`\nQA_RESULT=${report.status}`);
console.log(`QA_ARTIFACTS=${deliveryRoot}`);
process.exit(report.status === 'PASS' ? 0 : 1);
