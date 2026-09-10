#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, _electron as electron } from 'playwright';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
};

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
function slug(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}
async function mkdir(dir) { await fs.mkdir(dir, { recursive: true }); return dir; }
async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
function getValue(step) {
  if (step.valueFromEnv) {
    const value = process.env[step.valueFromEnv];
    if (value == null) throw new Error(`Missing secret/env ${step.valueFromEnv}`);
    return value;
  }
  return step.value ?? '';
}
function locate(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.role) return page.getByRole(step.role, step.name ? { name: step.name } : undefined);
  if (step.text) return page.getByText(step.text, { exact: step.exact ?? false });
  if (step.label) return page.getByLabel(step.label, { exact: step.exact ?? false });
  if (step.selector) return page.locator(step.selector);
  throw new Error(`${step.action} requires a locator`);
}
async function step(page, item, index, screenshots, baseURL) {
  const label = `${String(index + 1).padStart(2, '0')}-${slug(item.name || item.action)}`;
  switch (item.action) {
    case 'goto': await page.goto(item.url || new URL(item.path, baseURL).toString(), { waitUntil: item.waitUntil || 'domcontentloaded' }); break;
    case 'click': await locate(page, item).click(); break;
    case 'fill': await locate(page, item).fill(getValue(item)); break;
    case 'press': await locate(page, item).press(item.key || 'Enter'); break;
    case 'check': await locate(page, item).check(); break;
    case 'uncheck': await locate(page, item).uncheck(); break;
    case 'hover': await locate(page, item).hover(); break;
    case 'selectOption': await locate(page, item).selectOption(getValue(item)); break;
    case 'reload': await page.reload({ waitUntil: item.waitUntil || 'domcontentloaded' }); break;
    case 'waitFor': await locate(page, item).waitFor({ state: item.state || 'visible', timeout: item.timeoutMs }); break;
    case 'waitForTimeout': await page.waitForTimeout(item.timeoutMs ?? 250); break;
    case 'expectVisible': if (!(await locate(page, item).isVisible())) throw new Error(`${label} not visible`); break;
    case 'expectText': {
      const actual = (await locate(page, item).textContent()) ?? '';
      if (!actual.includes(item.expected ?? '')) throw new Error(`${label} text mismatch: ${actual}`);
      break;
    }
    case 'expectURL': {
      const actual = page.url();
      if (item.equals && actual !== item.equals) throw new Error(`${label} URL mismatch: ${actual}`);
      if (item.includes && !actual.includes(item.includes)) throw new Error(`${label} URL mismatch: ${actual}`);
      break;
    }
    case 'screenshot': await page.screenshot({ path: path.join(screenshots, `${label}.png`), fullPage: item.fullPage ?? false }); break;
    default: throw new Error(`Unsupported action ${item.action}`);
  }
  return label;
}
function telemetry(page, sink) {
  const push = (type, data = {}) => sink.push({ at: new Date().toISOString(), type, ...data });
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) push('console', { level: m.type(), text: m.text() }); });
  page.on('pageerror', e => push('pageerror', { message: e.message }));
  page.on('requestfailed', r => push('requestfailed', { method: r.method(), url: r.url(), failure: r.failure()?.errorText }));
  page.on('response', r => { if (r.status() >= 400) push('http-error', { status: r.status(), url: r.url() }); });
}
function runProcess(command, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', x => { error += x; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${error}`)));
  });
}
function recorder(page, dir, fps = 4) {
  let stop = false, count = 0, loop;
  return {
    async start() {
      await mkdir(dir);
      loop = (async () => {
        while (!stop) {
          try { await page.screenshot({ path: path.join(dir, `${String(count++).padStart(6, '0')}.png`) }); } catch {}
          await new Promise(r => setTimeout(r, Math.max(100, 1000 / fps)));
        }
      })();
    },
    async finish(output) {
      stop = true;
      await loop;
      if (count < 2) return null;
      try {
        await runProcess('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(dir, '%06d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
        await fs.rm(dir, { recursive: true, force: true });
        return output;
      } catch (error) {
        await fs.writeFile(path.join(dir, 'VIDEO_BUILD_FAILED.txt'), `${error.stack || error}\n`);
        return null;
      }
    }
  };
}

const cli = args(process.argv.slice(2));
if (!cli.config) throw new Error('Use --config qa/artisys-qa.config.json');
const configFile = path.resolve(cli.config);
const root = path.dirname(configFile);
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
const envName = cli.environment || config.defaultEnvironment || Object.keys(config.environments)[0];
const environment = config.environments[envName];
if (!environment) throw new Error(`Unknown environment ${envName}`);
const flowName = cli.flow || config.defaultFlow || Object.keys(config.flows)[0];
const flowFile = path.resolve(root, config.flows[flowName]);
const flow = JSON.parse(await fs.readFile(flowFile, 'utf8'));
const viewportName = cli.viewport || config.defaultViewport || 'desktop';
const viewport = VIEWPORTS[viewportName];
if (!viewport) throw new Error(`Unknown viewport ${viewportName}`);
const id = `${slug(config.systemId)}-${slug(flowName)}-${viewportName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const output = path.resolve(cli.output || 'qa-artifacts', id);
const shots = await mkdir(path.join(output, 'screenshots'));
const events = [], executed = [];
let browser, context, page, app, frames, nativeVideo, video = null, status = 'passed', failure = null;
const startedAt = new Date().toISOString();

try {
  if (config.mode === 'electron') {
    app = await electron.launch({
      args: [path.resolve(root, config.electron.entry), ...(config.electron.args || [])],
      executablePath: config.electron.executablePath ? path.resolve(root, config.electron.executablePath) : undefined,
      cwd: root,
      env: { ...process.env, ...(config.electron.env || {}), ...(environment.env || {}) },
      timeout: config.launchTimeoutMs || 30000
    });
    context = app.context();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await app.firstWindow();
    await page.setViewportSize(viewport).catch(() => {});
    if (config.capture?.video !== false) {
      frames = recorder(page, path.join(output, '.frames'), config.capture?.fps || 4);
      await frames.start();
    }
  } else {
    browser = await chromium.launch({ headless: config.headless ?? true });
    context = await browser.newContext({ viewport, recordVideo: config.capture?.video === false ? undefined : { dir: path.join(output, '.video'), size: viewport } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    page = await context.newPage();
    nativeVideo = page.video();
    if (environment.baseURL && flow.autoGoto !== false) await page.goto(environment.baseURL, { waitUntil: flow.waitUntil || 'domcontentloaded' });
  }
  telemetry(page, events);
  for (let i = 0; i < flow.steps.length; i++) {
    const started = Date.now();
    try {
      const label = await step(page, flow.steps[i], i, shots, environment.baseURL);
      if (config.capture?.screenshotEachStep) await page.screenshot({ path: path.join(shots, `${label}-after.png`) });
      executed.push({ index: i, action: flow.steps[i].action, status: 'passed', durationMs: Date.now() - started });
    } catch (error) {
      executed.push({ index: i, action: flow.steps[i].action, status: 'failed', durationMs: Date.now() - started, error: error.message });
      throw error;
    }
  }
} catch (error) {
  status = 'failed';
  failure = { message: error.message, stack: error.stack };
  if (page) await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
} finally {
  if (context) await context.tracing.stop({ path: path.join(output, 'trace.zip') }).catch(() => {});
  if (frames) video = await frames.finish(path.join(output, 'video.mp4'));
  if (app) await app.close().catch(() => {});
  if (config.mode === 'web' && context) await context.close().catch(() => {});
  if (nativeVideo) {
    try { video = path.join(output, 'video.webm'); await nativeVideo.saveAs(video); } catch { video = null; }
  }
  if (browser) await browser.close().catch(() => {});
}
const summary = {
  schemaVersion: 1,
  module: '@artisys/qa',
  moduleVersion: '1.0.0',
  systemId: config.systemId,
  flow: flowName,
  environment: envName,
  viewport: viewportName,
  status,
  startedAt,
  finishedAt: new Date().toISOString(),
  video: video ? path.relative(output, video) : null,
  trace: 'trace.zip',
  telemetryCount: events.length,
  steps: executed,
  failure
};
await writeJson(path.join(output, 'telemetry.json'), events);
await writeJson(path.join(output, 'run-summary.json'), summary);
console.log(JSON.stringify(summary, null, 2));
console.log(`ARTISYS_QA_OUTPUT=${output}`);
if (status !== 'passed') process.exitCode = 1;
