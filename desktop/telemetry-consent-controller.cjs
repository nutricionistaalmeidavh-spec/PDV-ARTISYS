'use strict';
const { TELEMETRY_CONSENT_VERSION, buildTelemetryConsentSettings } = require('./telemetry-consent.cjs');

function createTelemetryConsentController({ settings, updater, now = () => new Date() } = {}) {
  if (!settings || typeof settings.set !== 'function') throw new Error('settings.set is required');
  if (!updater || typeof updater.install !== 'function') throw new Error('updater.install is required');

  async function persistAndInstall(accepted) {
    const values = buildTelemetryConsentSettings({ accepted, now: now() });
    for (const [key, value] of Object.entries(values)) await settings.set(key, value);
    return updater.install();
  }

  function state() {
    const version = typeof settings.get === 'function'
      ? Number(settings.get('telemetry.consent_version', { scope:'global', defaultValue:0 }) || 0)
      : 0;
    return {
      version,
      requiredVersion: TELEMETRY_CONSENT_VERSION,
      needsPrompt: version < TELEMETRY_CONSENT_VERSION
    };
  }

  return {
    state,
    acceptAndInstall: () => persistAndInstall(true),
    declineAndInstall: () => persistAndInstall(false)
  };
}

module.exports = { createTelemetryConsentController };
