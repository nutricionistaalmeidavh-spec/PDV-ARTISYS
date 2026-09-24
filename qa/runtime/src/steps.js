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

async function ensureHomeRouteContext(page, step) {
  if (typeof step.selector !== 'string' || !step.selector.includes('[data-home-route=')) return;
  const target = page.locator(step.selector);
  if (await target.isVisible().catch(() => false)) return;
  const homeNav = page.locator("#sidebar-nav [data-route='home']");
  if (!(await homeNav.isVisible().catch(() => false))) return;
  await homeNav.click();
  await target.waitFor({ state: 'visible', timeout: step.timeoutMs ?? 10000 });
}

function waitState(step) {
  if (step.state) return step.state;
  const selector = typeof step.selector === 'string' ? step.selector : '';
  return /\boption(?=[:.\[#\s>+~]|$)/.test(selector) ? 'attached' : 'visible';
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive integer`);
  return parsed;
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
    case 'click': {
      await ensureHomeRouteContext(page, step);
      const target = locator(page, step);
      const isModalClose = typeof step.selector === 'string' && step.selector.includes('[data-close-modal]');
      if (isModalClose && !(await target.isVisible().catch(() => false))) break;
      if (step.selector === "#ops-inventory-form button[type='submit']") {
        const selectedProduct = await page.locator("#ops-inventory-form select[name='productId'] option:checked").textContent();
        const quantity = await page.locator("#ops-inventory-form input[name='quantity']").inputValue();
        const type = await page.locator("#ops-inventory-form select[name='type']").inputValue();
        await target.click();
        if (selectedProduct && type !== 'adjustment-out') {
          const expectedQuantity = Number(quantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
          await page.locator("#ops-inventory-body tr", { hasText: selectedProduct.trim() }).filter({ hasText: expectedQuantity }).waitFor({ state: 'visible', timeout: step.timeoutMs ?? 15000 });
        } else {
          await page.locator("#ops-inventory-form").waitFor({ state: 'visible', timeout: step.timeoutMs ?? 15000 });
        }
      } else {
        await target.click();
      }
      break;
    }
    case 'fill': await locator(page, step).fill(resolveSecret(step, env)); break;
    case 'type': await locator(page, step).pressSequentially(resolveSecret(step, env), { delay: Number(step.delayMs ?? 0) }); break;
    case 'press': await locator(page, step).press(step.key || 'Enter'); break;
    case 'check': await locator(page, step).check(); break;
    case 'uncheck': await locator(page, step).uncheck(); break;
    case 'hover': await locator(page, step).hover(); break;
    case 'selectOption': await locator(page, step).selectOption(resolveSecret(step, env)); break;
    case 'reload': await page.reload({ waitUntil: step.waitUntil || 'domcontentloaded' }); break;
    case 'setFeatureFlags': {
      const allowed = new Set(['productsDenseView', 'customersMasterDetailView']);
      const flags = step.flags;
      if (!flags || typeof flags !== 'object' || Array.isArray(flags)) throw new TypeError('setFeatureFlags requires a flags object');
      for (const [key, value] of Object.entries(flags)) {
        if (!allowed.has(key)) throw new Error(`Unsupported QA feature flag: ${key}`);
        if (typeof value !== 'boolean') throw new TypeError(`QA feature flag ${key} must be boolean`);
      }
      await page.evaluate(nextFlags => {
        window.PdvFeatureFlags = {
          ...(window.PdvFeatureFlags || {}),
          ...nextFlags,
        };
      }, flags);
      break;
    }
    case 'setViewportSize': {
      const width = positiveInteger(step.width, `${label}: width`);
      const height = positiveInteger(step.height, `${label}: height`);
      await page.setViewportSize({ width, height });
      break;
    }
    case 'waitFor': await locator(page, step).waitFor({ state: waitState(step), timeout: step.timeoutMs }); break;
    case 'waitForTimeout': await page.waitForTimeout(step.timeoutMs ?? 250); break;
    case 'expectVisible': {
      if (!(await locator(page, step).isVisible())) throw new Error(`${label}: expected locator to be visible`);
      break;
    }
    case 'expectValue': {
      if (step.expected == null) throw new Error(`${label}: expectValue requires expected`);
      const target = locator(page, step);
      await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
      const actual = await target.inputValue();
      if (actual !== String(step.expected)) throw new Error(`${label}: expected value ${JSON.stringify(String(step.expected))}, got ${JSON.stringify(actual)}`);
      break;
    }
    case 'expectNoHorizontalOverflow': {
      const tolerancePx = Number(step.tolerancePx ?? 2);
      if (!Number.isFinite(tolerancePx) || tolerancePx < 0) throw new TypeError(`${label}: tolerancePx must be a non-negative number`);
      let measurement;
      if (step.selector || step.testId || step.role || step.text || step.label) {
        const target = locator(page, step).first();
        await target.waitFor({ state: 'visible', timeout: step.timeoutMs });
        measurement = await target.evaluate((element, tolerance) => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          ok: element.scrollWidth <= element.clientWidth + tolerance,
        }), tolerancePx);
      } else {
        measurement = await page.evaluate(tolerance => {
          const element = document.documentElement;
          return {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            ok: element.scrollWidth <= element.clientWidth + tolerance,
          };
        }, tolerancePx);
      }
      if (!measurement.ok) {
        throw new Error(`${label}: horizontal overflow detected (${measurement.scrollWidth}px > ${measurement.clientWidth}px + ${tolerancePx}px tolerance)`);
      }
      break;
    }
    case 'expectText': {
      const expected = step.expected ?? '';
      const texts = await locator(page, step).allTextContents();
      if (!texts.some(actual => actual.includes(expected))) {
        throw new Error(`${label}: expected text ${JSON.stringify(expected)}, got ${JSON.stringify(texts.join(' | '))}`);
      }
      break;
    }
    case 'expectURL': {
      const actual = page.url();
      if (step.equals && actual !== step.equals) throw new Error(`${label}: URL mismatch: ${actual}`);
      if (step.includes && !actual.includes(step.includes)) throw new Error(`${label}: URL does not include ${step.includes}: ${actual}`);
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
