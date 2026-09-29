'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'qa', 'flows', 'sales-enhancements-v2.json'), 'utf8'));

function indexOfStep(name) {
  return flow.steps.findIndex((step) => step.name === name);
}

test('sales-enhancements waits for app readiness and opens Home before navigating to sellers', () => {
  const authenticated = indexOfStep('authenticated');
  const appReady = indexOfStep('app-ready');
  const homeNavReady = indexOfStep('home-nav-ready');
  const openHome = indexOfStep('open-home');
  const openSellers = indexOfStep('open-sellers');

  assert.ok(authenticated >= 0, 'authenticated step must exist');
  assert.ok(appReady > authenticated, 'app-ready must run after authentication');
  assert.ok(homeNavReady > appReady, 'home navigation must be ready after app load');
  assert.ok(openHome > homeNavReady, 'flow must explicitly open Home');
  assert.ok(openSellers > openHome, 'sellers must only open after Home is active');

  assert.equal(flow.steps[appReady].selector, '#app-topbar');
  assert.equal(flow.steps[homeNavReady].selector, "#sidebar-nav [data-route='home']");
  assert.equal(flow.steps[openHome].selector, "#sidebar-nav [data-route='home']");
  assert.equal(flow.steps[openSellers].selector, "[data-home-route='sellers']");
});
