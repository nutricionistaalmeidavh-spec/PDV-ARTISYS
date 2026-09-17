import path from 'node:path';
import { resolveSecret, stepLabel } from './helpers.js';
import { isVisualValidationRequested, shouldUpdateVisualBaselines, validateVisualSnapshot } from './visual.js';

function locator(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.role) return page.getByRole(step.role, step.name ? { name: step.name } : undefined);
  if (step.text) return page.getByText(step.text, { exact: step.exact ?? false });
  if (step.label) return page.getByLabel(step.label, { exact: step.exact ?? false });
  if (step.selector) return page.locator(step.selector);
  throw new Error(`Step ${step.action} requires selector, testId, role, text or label`);
}

async function clickWithDialogs(page, target, step) {
  const specs = Array.isArray(step.dialogs) ? step.dialogs : step.dialog ? [step.dialog] : [];
  if (!specs.length) {
    await target.click();
    return;
  }
  let seen = 0;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const handler = async dialog => {
    const spec = specs[seen] || {};
    try {
      if (spec.type && dialog.type() !== spec.type) throw new Error(`Expected ${spec.type} dialog, got ${dialog.type()}`);
      if (spec.messageIncludes && !dialog.message().includes(spec.messageIncludes)) throw new Error(`Dialog did not include ${spec.messageIncludes}`);
      seen += 1;
      if (spec.accept === false) await dialog.dismiss();
      else await dialog.accept(spec.promptText == null ? undefined : String(spec.promptText));
      if (seen >= specs.length) {
        page.off('dialog', handler);
        resolveDone();
      }
    } catch (error) {
      page.off('dialog', handler);
      rejectDone(error);
    }
  };
  page.on('dialog', handler);
  try {
    await target.click();
    await done;
  } catch (error) {
    page.off('dialog', handler);
    throw error;
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
    case 'press': await locator(page, step).press(step.key || 'Enter'); break;
    case 'check': await locator(page, step).check(); break;
    case 'uncheck': await locator(page, step).uncheck(); break;
    case 'hover': await locator(page, step).hover(); break;
    case 'selectOption': {
      if (step.labelValue != null) await locator(page, step).selectOption({ label: String(step.labelValue) });
      else await locator(page, step).selectOption(resolveSecret(step, env));
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
      const actual = (await locator(page, step).textContent()) ?? '';
      if (!actual.includes(step.expected ?? '')) throw new Error(`${label}: expected text ${JSON.stringify(step.expected)}, got ${JSON.stringify(actual)}`);
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
