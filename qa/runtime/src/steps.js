import path from 'node:path';
import { resolveSecret, stepLabel } from './helpers.js';
import { isVisualValidationRequested, shouldUpdateVisualBaselines, validateVisualSnapshot } from './visual.js';

function locator(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.role) return page.getByRole(step.role, step.name ? { name: step.name } : undefined);
  if (step.text) return page.getByText(step.text, { exact: step.exact ?? false });
  if (step.label) return page.getByLabel(step.label, { exact: step.exact ?? false });
  if (step.selector) {
    // The desktop shell intentionally exposes three different controls that all
    // navigate home (brand, sidebar item and back button). QA journeys that use
    // the legacy generic home selector should target the canonical sidebar item.
    if (step.selector === "[data-route='home']") return page.locator("[data-route='home'][aria-label='Início']");
    return page.locator(step.selector);
  }
  throw new Error(`Step ${step.action} requires selector, testId, role, text or label`);
}

function qaState(runtimeContext) {
  if (!runtimeContext) throw new Error('QA state requires runtime context');
  if (!runtimeContext.qaState || typeof runtimeContext.qaState !== 'object') runtimeContext.qaState = {};
  return runtimeContext.qaState;
}

async function clickWithRendererDialogShim(page, target, specs, dialogTimeoutMs) {
  await page.evaluate(input => {
    const originals = { prompt: window.prompt, confirm: window.confirm, alert: window.alert };
    const state = { specs: input, seen: 0, error: null, originals };
    const consume = (type, message, defaultValue) => {
      const spec = state.specs[state.seen] || {};
      if (spec.type && spec.type !== type) {
        state.error = `Expected ${spec.type} dialog, got ${type}`;
      } else if (spec.messageIncludes && !String(message ?? '').includes(String(spec.messageIncludes))) {
        state.error = `Dialog did not include ${spec.messageIncludes}`;
      }
      state.seen += 1;
      if (type === 'prompt') {
        if (spec.accept === false) return null;
        return spec.promptText == null ? String(defaultValue ?? '') : String(spec.promptText);
      }
      if (type === 'confirm') return spec.accept !== false;
      return undefined;
    };
    window.__ARTISYS_QA_PROMPT_SHIM__ = state;
    window.prompt = (message, defaultValue) => consume('prompt', message, defaultValue);
    window.confirm = message => consume('confirm', message);
    window.alert = message => { consume('alert', message); };
  }, specs);

  try {
    await target.click();
    await page.waitForFunction(expected => {
      const state = window.__ARTISYS_QA_PROMPT_SHIM__;
      return Boolean(state?.error) || Number(state?.seen || 0) >= expected;
    }, specs.length, { timeout: dialogTimeoutMs });
    const result = await page.evaluate(() => ({
      seen: Number(window.__ARTISYS_QA_PROMPT_SHIM__?.seen || 0),
      error: window.__ARTISYS_QA_PROMPT_SHIM__?.error || null,
    }));
    if (result.error) throw new Error(result.error);
    if (result.seen < specs.length) throw new Error(`Timed out waiting for ${specs.length} dialog(s); received ${result.seen} after ${dialogTimeoutMs}ms`);
  } finally {
    await page.evaluate(() => {
      const state = window.__ARTISYS_QA_PROMPT_SHIM__;
      if (!state?.originals) return;
      window.prompt = state.originals.prompt;
      window.confirm = state.originals.confirm;
      window.alert = state.originals.alert;
      delete window.__ARTISYS_QA_PROMPT_SHIM__;
    }).catch(() => {});
  }
}

async function clickWithDialogs(page, target, step) {
  const specs = Array.isArray(step.dialogs) ? step.dialogs : step.dialog ? [step.dialog] : [];
  if (!specs.length) {
    await target.click();
    return;
  }
  const dialogTimeoutMs = Number.isFinite(step.dialogTimeoutMs)
    ? Number(step.dialogTimeoutMs)
    : Number.isFinite(step.timeoutMs)
      ? Number(step.timeoutMs)
      : 10000;

  // Electron renderer prompts are not consistently surfaced as Playwright
  // dialog events on every supported Windows/Electron combination. The PDV
  // uses window.prompt/confirm/alert, so shim those synchronously during the
  // click and restore them immediately afterwards.
  const shimSupported = specs.every(spec => !spec.type || ['prompt', 'confirm', 'alert'].includes(spec.type));
  if (shimSupported) {
    await clickWithRendererDialogShim(page, target, specs, dialogTimeoutMs);
    return;
  }

  let seen = 0;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  let timeoutHandle = null;
  const handler = async dialog => {
    const spec = specs[seen] || {};
    try {
      if (spec.type && dialog.type() !== spec.type) throw new Error(`Expected ${spec.type} dialog, got ${dialog.type()}`);
      if (spec.messageIncludes && !dialog.message().includes(spec.messageIncludes)) throw new Error(`Dialog did not include ${spec.messageIncludes}`);
      seen += 1;
      if (spec.accept === false) await dialog.dismiss();
      else await dialog.accept(spec.promptText == null ? undefined : String(spec.promptText));
      if (seen >= specs.length) resolveDone();
    } catch (error) {
      rejectDone(error);
    }
  };
  page.on('dialog', handler);
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${specs.length} dialog(s); received ${seen} after ${dialogTimeoutMs}ms`));
    }, dialogTimeoutMs);
  });
  try {
    await target.click();
    await Promise.race([done, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    page.off('dialog', handler);
  }
}

async function expectLocatorText(page, step, label) {
  const target = locator(page, step);
  const count = await target.count();
  const expected = String(step.expected ?? '');
  const actual = [];
  for (let index = 0; index < count; index += 1) {
    actual.push((await target.nth(index).textContent()) ?? '');
  }
  if (!actual.some(text => text.includes(expected))) {
    throw new Error(`${label}: expected text ${JSON.stringify(expected)}, got ${JSON.stringify(actual.join(' | '))}`);
  }
}

export async function executeStep({ page, step, index, screenshotsDir, baseURL, env = process.env, adapter = null, runtimeContext = null }) {
  const label = stepLabel(step, index);
  switch (step.action) {
    case 'goto': {
      const target = step.url || (step.path && baseURL ? new URL(step.path, baseURL).toString() : step.path);
      if (!target) throw new Error('goto requires url or path');
      await page.goto(target, { waitUntil: step.waitUntil || 'domcontentloaded' });
      break;
    }
    case 'click': await clickWithDialogs(page, locator(page, step), step); break;
    case 'fill': await locator(page, step).fill(resolveSecret(step, env)); break;
    case 'fillFromState': {
      if (!step.key) throw new Error('fillFromState requires key');
      const value = qaState(runtimeContext)[step.key];
      if (value == null) throw new Error(`${label}: QA state ${step.key} is empty`);
      await locator(page, step).fill(String(value));
      break;
    }
    case 'rememberAttribute': {
      if (!step.key || !step.attribute) throw new Error('rememberAttribute requires key and attribute');
      const value = await locator(page, step).first().getAttribute(step.attribute);
      if (value == null) throw new Error(`${label}: attribute ${step.attribute} is empty`);
      qaState(runtimeContext)[step.key] = value;
      break;
    }
    case 'rememberText': {
      if (!step.key) throw new Error('rememberText requires key');
      qaState(runtimeContext)[step.key] = (await locator(page, step).first().textContent()) ?? '';
      break;
    }
    case 'press': await locator(page, step).press(step.key || 'Enter'); break;
    case 'check': await locator(page, step).check(); break;
    case 'uncheck': await locator(page, step).uncheck(); break;
    case 'hover': await locator(page, step).hover(); break;
    case 'selectOption': {
      if (step.labelValue != null) await locator(page, step).selectOption({ label: String(step.labelValue) });
      else if (step.stateKey) {
        const value = qaState(runtimeContext)[step.stateKey];
        if (value == null) throw new Error(`${label}: QA state ${step.stateKey} is empty`);
        await locator(page, step).selectOption(String(value));
      } else await locator(page, step).selectOption(resolveSecret(step, env));
      break;
    }
    case 'reload': await page.reload({ waitUntil: step.waitUntil || 'domcontentloaded' }); break;
    case 'waitFor': await locator(page, step).waitFor({ state: step.state || 'visible', timeout: step.timeoutMs }); break;
    case 'waitForTimeout': await page.waitForTimeout(step.timeoutMs ?? 250); break;
    case 'expectVisible': {
      if (!(await locator(page, step).isVisible())) throw new Error(`${label}: expected locator to be visible`);
      break;
    }
    case 'expectNotVisible': {
      if (await locator(page, step).isVisible()) throw new Error(`${label}: expected locator not to be visible`);
      break;
    }
    case 'expectCount': {
      const actual = await locator(page, step).count();
      const expected = Number(step.expected);
      if (actual !== expected) throw new Error(`${label}: expected count ${expected}, got ${actual}`);
      break;
    }
    case 'expectText': {
      await expectLocatorText(page, step, label);
      break;
    }
    case 'expectValue': {
      const actual = await locator(page, step).inputValue();
      if (actual !== String(step.expected ?? '')) throw new Error(`${label}: expected value ${JSON.stringify(step.expected)}, got ${JSON.stringify(actual)}`);
      break;
    }
    case 'expectURL': {
      const actual = page.url();
      if (step.equals && actual !== step.equals) throw new Error(`${label}: URL mismatch: ${actual}`);
      if (step.includes && !actual.includes(step.includes)) throw new Error(`${label}: URL does not include ${step.includes}: ${actual}`);
      break;
    }
    case 'apiRequest': {
      if (!step.path || !String(step.path).startsWith('/api/v1/')) throw new Error('apiRequest requires an /api/v1/ path');
      const request = {
        path: String(step.path),
        method: String(step.method || 'GET').toUpperCase(),
        body: step.body,
        mutationId: step.mutationId || undefined,
      };
      const result = await page.evaluate(async input => {
        const sessionToken = window.sessionStorage?.getItem('artisys.sessionToken') || '';
        return window.artisysDesktop.apiRequest({ ...input, sessionToken });
      }, request);
      if (step.expectStatus != null && Number(result?.status) !== Number(step.expectStatus)) throw new Error(`${label}: expected HTTP ${step.expectStatus}, got ${result?.status}`);
      if (step.expectedText != null) {
        const actual = JSON.stringify(result?.payload ?? null);
        if (!actual.includes(String(step.expectedText))) throw new Error(`${label}: API payload did not include ${JSON.stringify(step.expectedText)}`);
      }
      if (step.saveAs) qaState(runtimeContext)[step.saveAs] = result?.payload;
      break;
    }
    case 'screenshot': {
      await page.screenshot({ path: path.join(screenshotsDir, `${label}.png`), fullPage: step.fullPage ?? false });
      break;
    }
    case 'visualSnapshot': {
      const requested = isVisualValidationRequested(env.ARTISYS_QA_VISUAL);
      if (!requested) break;
      const hasLocator = Boolean(step.testId || step.role || step.text || step.label || step.selector);
      await validateVisualSnapshot({
        page,
        name: step.snapshot || step.name || label,
        target: hasLocator ? locator(page, step) : null,
        requested,
        updateBaseline: shouldUpdateVisualBaselines(env.ARTISYS_QA_UPDATE_VISUAL_BASELINES),
        baselineDir: step.baselineDir ? path.resolve(step.baselineDir) : path.resolve('qa/visual-baselines'),
        artifactDir: step.artifactDir ? path.resolve(step.artifactDir) : path.join(path.dirname(screenshotsDir), 'visual'),
        fullPage: step.fullPage ?? false,
        pixelThreshold: step.pixelThreshold ?? 8,
        maxDiffRatio: step.maxDiffRatio ?? 0.001,
      });
      break;
    }
    case 'capability': {
      if (!step.name || typeof step.name !== 'string') throw new Error('capability requires name');
      const capability = adapter?.capabilities?.[step.name];
      if (typeof capability !== 'function') throw new Error(`Missing demo adapter capability: ${step.name}`);
      await capability({ page, step, runtimeContext });
      break;
    }
    default: throw new Error(`Unsupported QA action: ${step.action}`);
  }
  if (step.holdMs != null) {
    if (!Number.isFinite(step.holdMs) || step.holdMs < 0) throw new TypeError(`${label}: holdMs must be a non-negative number`);
    if (step.holdMs > 0) await page.waitForTimeout(step.holdMs);
  }
  return label;
}
