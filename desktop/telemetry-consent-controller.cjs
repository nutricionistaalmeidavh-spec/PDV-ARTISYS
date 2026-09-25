'use strict';
const { buildTelemetryConsentSettings } = require('./telemetry-consent.cjs');

function createTelemetryConsentController({ settings, updater, now = () => new Date() } = {}) {
  if (!settings || typeof settings.set !== 'function') throw new Error('settings.set is required');
  if (!updater || typeof updater.install !== 'function') throw new Error('updater.install is required');

  async function persistAndInstall(accepted) {
    const values = buildTelemetryConsentSettings({ accepted, now: now() });
    for (const [key, value] of Object.entries(values)) await settings.set(key, value);
    return updater.install();
  }

  return {
    acceptAndInstall: () => persistAndInstall(true),
    declineAndInstall: () => persistAndInstall(false)
  };
}

module.exports = { createTelemetryConsentController };
