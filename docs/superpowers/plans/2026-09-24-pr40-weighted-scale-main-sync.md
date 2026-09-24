# PR #40 Weighted Scale Main Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase the functional intent of PR #40 onto the current `main` without regressing the dedicated Urano US 31/2 POP-S integration, then validate every roadmap item needed for merge.

**Architecture:** Keep current `main` hardware configuration, persistence, native Settings UI, updater and dedicated Urano POP-S protocol as authoritative. Add PR #40's weighted-product model, checkout flow and additional scale presets as extensions around that architecture; do not restore the old generic Urano POP parser or a second scale-settings surface.

**Tech Stack:** Electron, Node.js CommonJS, `node:test`, JSON QA flows, GitHub Actions.

**Spec:** PR #40 `feat: weighted checkout and scale protocols` description and changed-file contract.

## Global Constraints

- Preserve current `urano-pop-s` behavior: 9600 baud, 8 data bits, no parity, 2 stop bits, binary request/status protocol.
- Preserve current persisted hardware configuration and `Settings > Balança` UI as the single configuration surface.
- Preserve legacy `UN` sales behavior.
- `KG`/`G` lines must snapshot `unit`, `unitPrice` and `weight_kg` immutably at sale finalization.
- Zero, negative, invalid and overweight readings must never silently add an item.
- Manual weight fallback must be explicit and policy-controlled.
- No physical-hardware certification claim without real-device evidence.
- Release E2E must include the weighted-scale flow while preserving all current release flows.

## Review Focus

- Dedicated POP-S 8N2 path must not be routed through the old PR #40 8N1/fixed-five parser.
- Fragmented and multiple serial frames must remain safe for text-based presets.
- `G` products must convert correctly to kilograms while keeping unit-price semantics deterministic.
- QA simulation must not alter production serial defaults or persist simulator state.
- Existing post-sale PDF/printing and hardware configuration E2E entries must remain present when weighted-scale is added.

---

### Task 1: Pin coexistence contract with a failing test

**Files:**
- Create: `test/scale-main-compatibility.test.js`

**Interfaces:**
- Consumes: `desktop/hardware-config-store.cjs`, `js/hardware/scale-protocols.js`.
- Produces: regression contract that current POP-S remains dedicated while additional presets are supported.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHardwareConfig } = require('../desktop/hardware-config-store.cjs');
const { createScaleProtocol } = require('../js/hardware/scale-protocols.js');

test('current POP-S stays 8N2 while Toledo preset coexists', () => {
  const urano = normalizeHardwareConfig({ scale:{ profile:'urano-pop-s', port:'COM7' } }).scale;
  assert.equal(urano.stopBits, 2);
  const toledo = createScaleProtocol({ preset:'toledo-prix3-prt5' });
  assert.equal(toledo.serial.stopBits, 1);
});
```

- [ ] **Step 2: Run `verify` and confirm RED**

Expected: failure because `js/hardware/scale-protocols.js` / non-Urano presets are not available on current main.

- [ ] **Step 3: Commit the red contract**

Commit message: `test: pin PR40 scale compatibility contract`.

### Task 2: Add preset registry without replacing POP-S

**Files:**
- Create: `js/hardware/scale-protocols.js`
- Modify: `desktop/hardware-config-store.cjs`
- Modify: `desktop/hardware-runtime.cjs`
- Test: `test/scale-main-compatibility.test.js`
- Test: `test/scale-runtime-presets.test.js`

**Interfaces:**
- Consumes: current runtime's dedicated `createUranoPopSProtocol()` path.
- Produces: `createScaleProtocol({preset,...})` for Toledo Prix 3/PRT 5, Urano UDC, Filizola BP/CS and generic numeric; persisted preset selection via hardware store.

- [ ] **Step 1: Add parser tests for fragmented/multiple frames, zero/negative/invalid values and serial defaults.**
- [ ] **Step 2: Implement the text-protocol registry; do not implement POP-S as a generic text preset.**
- [ ] **Step 3: Extend hardware config normalization/env mapping for supported presets while preserving `profile:'urano-pop-s'`.**
- [ ] **Step 4: Extend runtime setup so POP-S uses the existing binary path and other presets use `createScaleProtocol`.**
- [ ] **Step 5: Run `verify` and require all scale/runtime tests green.**
- [ ] **Step 6: Commit `feat: integrate scale presets with current hardware runtime`.**

### Task 3: Integrate weighted checkout and immutable sale snapshot

**Files:**
- Modify: `desktop/renderer/api-client.js`
- Modify: `desktop/renderer/ui-model.js`
- Create/Modify: `desktop/renderer/weighted-product-unit-ui.js`
- Create: `desktop/renderer/scale-ui.js`
- Create: `desktop/renderer/scale-ui.css`
- Modify: `desktop/renderer/index.html`
- Modify: `js/domains/printing/receipt-renderer.js`
- Test: `test/weighted-products-scale-protocols.test.js`
- Test: `test/scale-ui.test.js`
- Test: `test/weighted-receipt.test.js`

**Interfaces:**
- Consumes: existing `HardwareApi` weight/status methods and current sale APIs.
- Produces: `UN|KG|G` unit behavior, explicit scale modal/manual fallback, `weight_kg` snapshot and weighted receipt rendering.

- [ ] **Step 1: Add/port tests for `UN`, `KG`, `G`, stable reads, manual fallback policy, zero/negative/overweight rejection and snapshot immutability.**
- [ ] **Step 2: Port product-unit UI/model changes from PR #40 onto current renderer files.**
- [ ] **Step 3: Port only checkout/pesagem behavior from `scale-ui.js`; omit the old duplicate Settings card/localStorage configuration.**
- [ ] **Step 4: Load the weighted UI assets from the current `index.html` without removing newer post-sale/hardware scripts.**
- [ ] **Step 5: Port weighted receipt text formatting.**
- [ ] **Step 6: Run `verify`; commit `feat: integrate weighted checkout with current renderer`.**

### Task 4: Extend the existing Settings scale card

**Files:**
- Modify: `desktop/renderer/hardware-scale-ui.js`
- Modify: `desktop/main.cjs` only if additional env fields are required.
- Test: `test/scale-main-compatibility.test.js`

**Interfaces:**
- Consumes: persisted hardware config/store from Task 2.
- Produces: one native Settings surface for generic, POP-S and supported additional presets.

- [ ] **Step 1: Add UI contract tests for all supported preset options and locked serial values where required.**
- [ ] **Step 2: Extend the existing profile/preset selector and preserve save/test behavior.**
- [ ] **Step 3: Run `verify`; commit `feat: expose scale presets in hardware settings`.**

### Task 5: Restore weighted-scale release QA without losing current gates

**Files:**
- Create: `qa/flows/weighted-scale-e2e.json`
- Modify: `qa/artisys-qa.config.json`
- Modify: `test/artisys-qa-integration.test.js`
- Create: `test/qa-scale-simulator.test.js`

**Interfaces:**
- Consumes: `PDV_SCALE_SIM_VALUE`, `PDV_SCALE_SIM_SEQUENCE`, current QA runner.
- Produces: blocking `weighted-scale` release E2E and simulator coverage.

- [ ] **Step 1: Port the weighted E2E/simulator tests and require `weighted-scale` in `releaseE2E`.**
- [ ] **Step 2: Append `weighted-scale` to the current config; preserve `ARTISYS_QA_PDF_DIR:'../qa-artifacts/pdf'`, printing flows and hardware config E2E.**
- [ ] **Step 3: Run `verify` and full E2E.**
- [ ] **Step 4: Commit `test: restore weighted scale release coverage`.**

### Task 6: Documentation, roadmap audit and branch promotion

**Files:**
- Modify: `docs/operations/hardware-printing.md`
- Review: PR #40 body/changed files against Tasks 1-5.

**Interfaces:**
- Consumes: validated implementation and QA evidence.
- Produces: truthful supported-vs-unverified hardware matrix and merge-readiness report.

- [ ] **Step 1: Document supported presets and retain explicit physical-homologation limitations.**
- [ ] **Step 2: Run `verify`, release E2E, fiscal certification and Windows 7/8 Legacy build on the exact integration HEAD.**
- [ ] **Step 3: Compare every PR #40 roadmap item against code/tests and list any remaining physical-only or product-policy gaps.**
- [ ] **Step 4: If all software gates pass, fast-forward `feat/weighted-products-scale-protocols` to the validated merge commit (old PR #40 head remains its ancestor) and re-check PR #40 mergeability.**
