# PDV Full User QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-command, local full-user QA pipeline for the ArtiSys PDV that builds the installer first, exercises critical user journeys, validates isolation/persistence/recovery, and packages evidence with an explicit delivery gate.

**Architecture:** Extend the existing ArtiSys QA runtime rather than introducing a second framework. Add an isolated Electron QA entry path, a `user-all` profile composed from focused JSON flows, a Node orchestration script for preflight/build/QA/evidence, and a Windows installed-app smoke helper. Existing unit/integration tests remain the deep domain layer; Playwright flows validate the real UI/user paths.

**Tech Stack:** Node.js 22, Electron, Playwright, node:test, electron-builder/NSIS, PowerShell on Windows.

**Spec:** `docs/superpowers/specs/2026-09-17-pdv-full-user-qa-design.md`

## Global Constraints

- Core QA is local/self-hosted and free; no paid service is required.
- Installer generation happens before UI QA.
- QA userData must be isolated from production/customer data.
- Existing `qa:quick`, `qa:full`, and `qa:release` remain compatible.
- The user-all command produces screenshots, video, trace, logs, JSON/HTML report, installer copy and SHA-256.

---

### Task 1: Lock QA isolation and profile contract

**Files:**
- Modify: `desktop/main.cjs`
- Modify: `qa/artisys-qa.config.json`
- Test: `test/qa-user-all.test.js`

**Interfaces:**
- Consumes: `ARTISYS_QA`, `ARTISYS_QA_USER_DATA_DIR`
- Produces: `qaProfiles.user-all`, isolated Electron launch behavior.

- [ ] Write tests asserting production `userData` is never used when `ARTISYS_QA=1` and that `user-all` contains all required flow IDs.
- [ ] Run the focused test and confirm RED.
- [ ] Add the isolation hook before Electron readiness and add the profile/config entries.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Add reusable QA flow building blocks

**Files:**
- Create: `qa/flows/common/first-run-login.json`
- Create: `qa/flows/common/basic-catalog.json`
- Create: `qa/flows/common/open-cash.json`
- Test: `test/qa-user-all.test.js`

**Interfaces:**
- Produces reusable `uses` fragments for standalone flows.

- [ ] Add tests that parse every common flow and resolve flow composition.
- [ ] Confirm tests fail before files exist.
- [ ] Add deterministic synthetic admin/catalog/cash setup flows using only QA credentials/data.
- [ ] Confirm tests pass.

### Task 3: Add complete user-flow suite

**Files:**
- Create focused flows under `qa/flows/user/` for onboarding, registrations, cash, primary sale, payment states, printing, inventory, post-sale, reports, finance, settings, establishment modules, vertical modules, permissions, persistence/recovery, LAN, UI regression and installed-app smoke prerequisites.
- Modify: `qa/artisys-qa.config.json`
- Test: `test/qa-user-all.test.js`

**Interfaces:**
- Produces flow IDs consumed by `qaProfiles.user-all`.

- [ ] Add a test that every configured flow exists, is valid JSON and contains at least one step.
- [ ] Confirm RED.
- [ ] Add the flow files and mappings.
- [ ] Confirm GREEN.

### Task 4: Add full-run orchestrator and evidence index

**Files:**
- Create: `scripts/qa-user-all.mjs`
- Create: `scripts/qa-installed-smoke.ps1`
- Modify: `package.json`
- Test: `test/qa-user-all.test.js`

**Interfaces:**
- Produces terminal command `npm run qa:user:all`.
- Produces timestamped `qa-delivery-artifacts/<run>/` with installer hash, copied installer, logs, QA report links and final summary.

- [ ] Add static contract tests for command ordering: install/dependencies -> verify -> `dist:win` -> QA -> installed smoke -> evidence summary.
- [ ] Confirm RED.
- [ ] Implement orchestration with child-process exit-code capture and build-first semantics.
- [ ] Implement Windows installed executable smoke in a temporary install/userData directory; non-Windows records SKIPPED.
- [ ] Confirm focused tests GREEN.

### Task 5: Verify and integrate

**Files:** no new production files.

- [ ] Run syntax checks for new/modified Node files.
- [ ] Run `node --test test/qa-user-all.test.js`.
- [ ] Run the existing QA integration/static tests available without Electron dependencies.
- [ ] Review branch diff for paid/cloud dependencies, secrets and customer data.
- [ ] Merge the verified branch to `main` only after the checks above are green.