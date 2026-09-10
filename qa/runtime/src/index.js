/** Explicitly wait for readiness instead of sleeping an arbitrary duration. */
export async function waitForHealth(url, { timeoutMs = 15000, intervalMs = 100, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('timeoutMs and intervalMs must be positive finite numbers');
  const deadline = Date.now() + timeoutMs; let lastError;
  while (Date.now() < deadline) { signal?.throwIfAborted(); try { const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())), ...(signal ? [signal] : [])]) }); await response.body?.cancel(); if (response.ok) return; lastError = new Error(`HTTP ${response.status}`); } catch (error) { lastError = error; } signal?.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now())))); }
  throw new Error(`Health check timed out for ${url}`, { cause: lastError });
}
export async function withTerminals(browser, { count = 2, contextOptions = {} } = {}, run) { if (!Number.isInteger(count) || count < 1 || count > 16) throw new RangeError('count must be between 1 and 16'); if (typeof run !== 'function') throw new TypeError('run callback required'); const contexts = []; try { for (let i = 0; i < count; i++) contexts.push(await browser.newContext(contextOptions)); const terminals = await Promise.all(contexts.map(async (context, index) => ({ index, context, page: await context.newPage() }))); return await run(terminals); } finally { await Promise.all(contexts.map(context => context.close())); } }
export { createQaConfig, VIEWPORTS, DEMO_PRESETS } from './config.js';
export { loadQaManifest, validateQaManifest, resolveEnvironment, resolveFlow, resolveViewport, resolveDemo, resolveDemoPreset, resolveDemoProfile } from './manifest.js';
export { loadDemoAdapter, validateDemoAdapter } from './adapters.js';
export { prepareDemoProfile, resetDemoProfile, getDemoProfileStatus, finalizeDemoProfile, resolveDemoCredentials } from './demo-profile.js';
export { createFixtureRegistry, resolveFixturePacks, listBuiltInFixturePacks } from './fixture-registry.js';
export { resolveFlowComposition, loadFlowFile, BUILTIN_FLOW_ROOT } from './flow-library.js';
export { redactSecrets, collectProfileSecretValues } from './redaction.js';
export { runQaFlow } from './runner.js';
export { runDemoFlow, buildDemoSummary } from './demo.js';
export { executeStep } from './steps.js';
export { normalizeDemoVideo, buildNormalizeArgs } from './video.js';
export { attachPageTelemetry } from './telemetry.js';
export { sanitizeName, resolveSecret, stepLabel } from './helpers.js';
