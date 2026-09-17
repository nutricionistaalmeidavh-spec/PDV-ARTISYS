# PDV Full User QA Design

## Goal

Provide one local, self-hosted QA command that validates the PDV from preflight through Windows installer generation, realistic user journeys, persistence/recovery, LAN behavior, UI regressions, installed-app smoke testing, and final evidence packaging.

## Constraints

- Core QA must be R$ 0, local/self-hosted and open-source only.
- GitHub Actions is not required for execution.
- The installer must be generated before browser/Electron QA so a later QA failure does not erase the build artifact.
- QA data must never reuse the real customer's Electron userData/database.
- Playwright/Electron evidence must include screenshots, video, trace and logs.
- Critical P0 failures must mark the run as not approved for delivery.

## User journeys

The complete suite covers: preflight, first-run/onboarding, core registrations, cash drawer lifecycle, primary sale, alternate payments and sale states, receipt/printing, inventory, post-sale/returns, reports, finance, settings, establishment modules, vertical modules, permissions, persistence/backup/restore, LAN/multi-terminal, UI regression, installed executable smoke, and final evidence packaging.

## Execution model

`npm run qa:user:all` is the canonical terminal command. A Node orchestrator performs preflight, runs `npm ci` unless explicitly skipped, runs repository verification, builds the Windows installer first, then invokes a dedicated `user-all` QA profile. It finally performs artifact indexing/hash generation and, on Windows, an installed-executable smoke check in an isolated QA data directory.

The regular `qa:quick`, `qa:full`, and `qa:release` profiles remain available. The new profile is deliberately heavier and intended for pre-delivery validation.

## Isolation

All Electron QA runs use an isolated `userData` directory. The production desktop entry honors `ARTISYS_QA=1` plus `ARTISYS_QA_USER_DATA_DIR`, so both source Electron runs and the installed executable can be validated without touching customer data.

## Evidence and gate

Each run writes timestamped evidence containing screenshots, videos, traces, logs, JSON/HTML reports, the generated installer, and SHA-256. The final summary reports PASS/FAIL/SKIPPED and an explicit delivery gate. Critical flows include onboarding/login, cash, primary sale, inventory, payments/cancellation, persistence, settings/modules, printing, and installed-app startup.