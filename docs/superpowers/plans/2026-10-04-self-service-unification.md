# Self-Service Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `TABLET` device channel, make `SELF_SERVICE + TABLE/PICKUP` the only paired customer-device flow, and bring the self-service catalog UI into the canonical visual direction already used by the public table menu.

**Architecture:** The restaurant domain keeps one table-order source (`TABLE`) independent of hardware. `publicOrdering` becomes a canonical runtime dependency so both public QR ordering and authenticated self-service consume the same safe menu projection. Self-service owns atomic device+profile creation and authenticated table service actions, while the Access Center remains only the security/credential management surface for already-created self-service devices.

**Tech Stack:** Node.js/CommonJS, SQLite, vanilla HTML/CSS/JS, Electron renderer, `node:test`, local HTTP routers.

**Spec:** `docs/superpowers/specs/2026-10-04-self-service-unification-design.md`

## Global Constraints

- The local server/SQLite remains authoritative for operational data.
- Public table QR access stays token-based and never requires a device credential.
- Paired devices continue to use ID + one-time credential with only hash/salt persisted.
- `SELF_SERVICE + TABLE` must use only the persisted table profile and the canonical active table session.
- `SELF_SERVICE + PICKUP` must keep the existing fast-food/pickup order path.
- Customer-facing product data must come from the same safe public menu projection; never expose costs, recipes, internal stock metadata, SKU/barcode data, or credentials.
- No mandatory SaaS, CDN, remote font, or paid dependency may be introduced.
- Touch actions remain at least 44×44 px, visible keyboard focus remains supported, and cart/configuration state must survive recoverable failures.
- No compatibility layer is required for previously persisted `TABLET` devices.

## Review Focus

- A self-service creation failure after credential generation must roll back both device and profile so no partial device is left behind; Task 2 adds an explicit rollback test.
- A `SELF_SERVICE + TABLE` request must ignore any client-supplied table identity and always resolve the table from its persisted profile; Task 3 exercises this through the HTTP service/order paths.
- A product becoming unavailable between context load and submit must be rejected without clearing the client cart; Tasks 2 and 5 pin backend rejection and UI recovery.
- A self-service product photo request for a hidden/unavailable-to-menu product must not leak the image; Task 3 verifies authenticated photo authorization against the canonical menu projection.
- Public QR ordering must continue working at both mobile and tablet viewports after the shared projection/runtime changes; Tasks 6 and 7 retain web-surface and responsive QA coverage.

---

### Task 1: Remove the TABLET domain contract and rename table-origin orders

**Files:**
- Modify: `js/core/database/release-migrations.js`
- Modify: `js/core/database/device-access-migrations.js`
- Modify: `js/core/auth/device-access-service.js`
- Modify: `js/domains/restaurant/mobile-device-service.js`
- Modify: `js/domains/restaurant/restaurant-service.js`
- Modify: `js/domains/restaurant/public-ordering.js`
- Test: `test/e30-e39-restaurant.test.js`
- Test: `test/access-profiles-and-device-access.test.js`
- Test: `test/access-profiles-device-access.test.js`
- Test: `test/access-control-p5-p10.test.js`

**Interfaces:**
- Produces: supported device types exactly `WAITER | KITCHEN | SELF_SERVICE`.
- Produces: restaurant order sources exactly `DESKTOP | WAITER | TABLE`.
- Produces: paired `SELF_SERVICE` principal surface `self-service` with establishment scope; table binding belongs to `self_service_profiles`, not `mobile_devices`.

- [ ] **Step 1: Write failing domain/schema tests**

Add assertions that:
- `runtime.mobileDevices.createDevice({deviceType:'TABLET'})` throws `Tipo de dispositivo invalido`;
- the fresh `mobile_devices` schema CHECK does not contain `TABLET`;
- the fresh `restaurant_orders` schema CHECK contains `TABLE` and not `TABLET`;
- `SURFACE_PERMISSIONS` has no `table` entry;
- public QR table orders persist `source === 'TABLE'`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:
`node --test test/e30-e39-restaurant.test.js test/access-profiles-and-device-access.test.js test/access-profiles-device-access.test.js test/access-control-p5-p10.test.js`

Expected: failures showing `TABLET` is still accepted/persisted and table QR orders still use the legacy source.

- [ ] **Step 3: Implement the domain cleanup**

Change:
- `DEVICE_TYPES` to `WAITER/KITCHEN/SELF_SERVICE`;
- remove TABLET-specific binding, surface, scope and table-id handling from `mobile-device-service.js`;
- remove `table` from `SURFACE_PERMISSIONS`;
- remove TABLET backfill branches from device-access migration;
- update fresh schema device CHECK/indexes so no TABLET-specific unique index remains;
- change restaurant order CHECK and `ORDER_SOURCES` from `TABLET` to `TABLE`;
- change public table QR order creation to `source:'TABLE'`.

Keep generic resource-scope policy code only if still used by non-TABLET principals; do not preserve a fake `table` surface solely for compatibility.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same `node --test ...` command.

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

Commit message:
`refactor(restaurant): remove legacy tablet device contract`

---

### Task 2: Make public ordering a runtime dependency and create self-service atomically

**Files:**
- Modify: `js/core/pdv-runtime.js`
- Modify: `js/domains/self-service/self-service.js`
- Modify: `js/domains/restaurant/mobile-device-service.js`
- Modify: `server/self-service-mobile-router.js`
- Modify: `server/e48-e54-router.js`
- Test: `test/e48-e54-final.test.js`
- Test: `test/public-menu-layouts.test.js`

**Interfaces:**
- Produces: `runtime.publicOrdering` constructed in `createPdvRuntime()` before `runtime.selfService`.
- Produces: `selfService.createConfiguredDevice(input, actor) -> {device, profile}`, where `device.credential` is present only in the immediate returned creation result.
- Consumes: `publicOrdering.listMenu({includeHidden:false})` as the canonical safe customer product projection.
- Produces: `POST /api/v1/vertical/self-service/devices` for atomic creation; existing GET list and PUT reconfiguration remain valid.

- [ ] **Step 1: Write failing tests for canonical projection and atomic creation**

Add tests that:
- `runtime.publicOrdering` exists immediately after runtime creation;
- `selfService.context()` exposes product description, photo marker, availability, category and configuration exactly from the public safe menu projection;
- `createConfiguredDevice({name,mode:'TABLE',tableId})` creates a device/profile together;
- `createConfiguredDevice({name,mode:'PICKUP',operatorId})` creates a device/profile together;
- invalid table/operator causes creation to throw and leaves neither `mobile_devices` nor `self_service_profiles` rows behind;
- generic `mobileDevices.createDevice({deviceType:'SELF_SERVICE'})` no longer inserts an incomplete default profile as a side effect.

- [ ] **Step 2: Run focused tests and verify RED**

Run:
`node --test test/e48-e54-final.test.js test/public-menu-layouts.test.js`

Expected: failures because `publicOrdering` is router-created, self-service has a separate projection, and creation is two-step/non-atomic.

- [ ] **Step 3: Implement runtime ownership and atomic creation**

In `pdv-runtime.js`:
- construct `publicOrdering=createPublicOrderingService({...})` after catalog/product-photo dependencies and before `createSelfService`;
- inject `publicOrdering` into `createSelfService`;
- expose `publicOrdering` on the runtime object.

In `self-service.js`:
- remove the duplicate `safeConfiguration/productView` customer projection;
- use `publicOrdering.listMenu()`;
- add `createConfiguredDevice(input, actor)` using the existing SQLite transaction helper so device insert + profile insert + audit commit together or roll back together;
- keep `configureDevice(deviceId,input,actor)` for editing an existing self-service profile;
- keep `listConfiguredDevices()` filtered explicitly to `md.device_type='SELF_SERVICE'`.

In `mobile-device-service.js`:
- stop creating a default `PICKUP` profile inside generic device creation.

In the routers:
- stop constructing `publicOrdering` ad hoc in `self-service-mobile-router.js`;
- add `POST /api/v1/vertical/self-service/devices` returning the atomic creation result.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused command.

Expected: all tests pass, including rollback assertions.

- [ ] **Step 5: Commit**

Commit message:
`refactor(self-service): own configured device creation`

---

### Task 3: Consolidate authenticated self-service TABLE behavior and remove mobile TABLET routes

**Files:**
- Modify: `server/restaurant-router.js`
- Modify: `server/self-service-mobile-router.js`
- Modify: `js/domains/self-service/self-service.js`
- Test: `test/restaurant-main-clean-multichannel.test.js`
- Test: `test/e48-e54-final.test.js`
- Test: `test/ui-web-surfaces.test.js`

**Interfaces:**
- Produces: `selfService.requestService(deviceId, requestType, actor, mutationId) -> serviceRequest`.
- Produces: `POST /api/v1/mobile/self-service/service` accepting only `WAITER | BILL` for `SELF_SERVICE + TABLE`.
- Produces: `GET /api/v1/mobile/self-service/products/:productId/photo` authenticated by self-service device and authorized by the canonical visible menu projection.
- Removes: TABLET branches from `GET /api/v1/mobile/context`, `POST /api/v1/mobile/orders`, and `POST /api/v1/mobile/service`.

- [ ] **Step 1: Rewrite the multichannel regression test around WAITER + SELF_SERVICE(TABLE) + QR**

Replace the legacy tablet fixture with:
- `SELF_SERVICE` created/configured for the table;
- authenticated context through `/api/v1/mobile/context`;
- order through `/api/v1/mobile/self-service/orders`;
- QR order through public menu;
- assertions that all table-origin orders persist `source:'TABLE'`, price/configuration/note stay canonical, and KDS dispatch count remains correct.

Add route assertions that:
- `POST /api/v1/mobile/self-service/service` creates `WAITER` and `BILL` requests for the profile table;
- PICKUP self-service receives a 4xx for service requests;
- a client-supplied fake `tableId` is ignored/not accepted;
- authenticated photo route returns an allowed product photo and denies a product not in the visible menu.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:
`node --test test/restaurant-main-clean-multichannel.test.js test/e48-e54-final.test.js test/ui-web-surfaces.test.js`

Expected: failures because self-service service/photo routes do not yet exist and restaurant mobile still contains TABLET handling.

- [ ] **Step 3: Implement the consolidated self-service routes**

In `self-service.js`:
- change TABLE order creation to `source:'TABLE'`;
- add `requestService()` that loads the persisted profile, requires `mode==='TABLE'`, validates `WAITER/BILL`, and calls `restaurant.requestService(profile.tableId,...)`.

In `self-service-mobile-router.js`:
- add service POST route using the authenticated SELF_SERVICE principal;
- add authenticated binary product-photo route with ETag/cache behavior matching the public photo route, but authorize against `runtime.publicOrdering.listMenu()`;
- keep context/orders under the self-service router.

In `restaurant-router.js`:
- remove TABLET context/order/service branches;
- `/api/v1/mobile/orders` becomes WAITER-only.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused command.

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message:
`feat(self-service): absorb fixed-table customer flow`

---

### Task 4: Make Autoatendimento the sole creation surface

**Files:**
- Modify: `desktop/renderer/access-center-ui.js`
- Modify: `desktop/renderer/e48-e54-ui.js`
- Test: `test/intuitive-p0-p1.test.js`
- Test: `test/access-center-ux-model.test.js` or nearest existing Access Center UI contract test

**Interfaces:**
- Consumes: `POST /api/v1/vertical/self-service/devices`.
- Produces: Access Center device creation choices only `WAITER` and `KITCHEN`.
- Produces: Autoatendimento form creates `SELF_SERVICE` in one request and still displays the one-time device credential plus local-access QR action.

- [ ] **Step 1: Write failing UI contract tests**

Assert that:
- Access Center creation HTML contains `WAITER` and `KITCHEN`, and does not contain `TABLET` or `SELF_SERVICE` as create options;
- Access Center still lists/manages existing self-service rows and allows block/rotate credential;
- Autoatendimento creation uses one POST to `/api/v1/vertical/self-service/devices`, not POST restaurant device + PUT profile;
- submit pending state remains disabled/`Criando…`;
- failure path does not reset the form values;
- success refreshes the configured-device list and displays the one-time credential.

- [ ] **Step 2: Run the focused UI tests and verify RED**

Run:
`node --test test/intuitive-p0-p1.test.js test/access-center-ux-model.test.js`

Expected: failures showing the generic creation modal still offers legacy/self-service paths and Autoatendimento is still two-step.

- [ ] **Step 3: Implement the UI ownership change**

In `access-center-ui.js`:
- remove table loading/selection that existed only for TABLET creation;
- creation modal choices become Garçom and KDS/produção;
- keep device table, status toggle, credential rotation and KDS station management for all listed devices.

In `e48-e54-ui.js`:
- submit the complete `{name,mode,tableId|operatorId}` payload to the new atomic endpoint;
- keep all entered values on failure;
- on success show `device.id`, one-time `device.credential`, profile mode label, QR action, then refresh list.

- [ ] **Step 4: Run focused UI tests and verify GREEN**

Run the same focused command.

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message:
`fix(self-service): use one canonical setup flow`

---

### Task 5: Rebuild the authenticated self-service catalog in the public-menu visual direction

**Files:**
- Modify: `server/mobile/app.js`
- Modify: `server/mobile/styles.css`
- Modify: `server/mobile/index.html` only if a self-service-specific structural hook is required
- Test: `test/intuitive-p0-p1.test.js`
- Test: `test/ui-web-surfaces.test.js`

**Interfaces:**
- Consumes self-service context fields: `device`, `profile`, `table`, `session`, `products`, `categories`, `config.menuLayout`, `paymentMode`.
- Consumes photo URL: `/api/v1/mobile/self-service/products/:productId/photo`.
- Reuses existing shared order composer and existing `configureProduct()` pricing/configuration behavior.
- Produces customer-facing self-service UI without `renderTablet()`.

- [ ] **Step 1: Write failing source/UI contracts**

Assert in `test/intuitive-p0-p1.test.js` that:
- `renderTablet` and `type==='TABLET'` are absent;
- self-service has explicit search state, category state, category strip, photo/fallback product cards, unavailable state and persistent cart/review affordance;
- self-service photo URLs use the authenticated self-service photo endpoint;
- TABLE mode renders the table context plus `Chamar garçom` and `Pedir conta`;
- PICKUP mode omits those table actions;
- self-service no longer renders through the staff `shell()` header;
- submit failure leaves the cart intact and re-enables the action;
- successful submit clears the cart only after the backend response.

Add web-surface assertions for 44px touch targets and responsive self-service product layout.

- [ ] **Step 2: Run focused tests and verify RED**

Run:
`node --test test/intuitive-p0-p1.test.js test/ui-web-surfaces.test.js`

Expected: failures because current self-service is still `cartHtml()+products()` inside the staff shell.

- [ ] **Step 3: Implement the self-service presentation**

In `server/mobile/app.js`:
- delete `renderTablet()`;
- add self-service UI state for query/category/cart presentation;
- render a dedicated customer-facing self-service shell instead of `shell()`;
- follow the existing public-menu hierarchy: navy context header, search, horizontal categories, photo-led product cards when photos exist, deliberate text fallback when they do not, prominent price/add action, and persistent cart summary;
- preserve existing product configuration logic; when self-service is active, add photo/context styling to the configuration dialog without changing pricing rules;
- TABLE mode shows device + table and the two service actions;
- PICKUP mode shows `Retirada no balcão` and no table service controls;
- keep cart contents on request failure; clear only after confirmed success.

In `server/mobile/styles.css`:
- use the same ArtiSys navy/blue/ink/muted/line/surface values and typography already defined by the public menu;
- make the self-service grid responsive for kiosk/tablet widths without introducing a competing theme;
- preserve 44px hit areas, visible focus and reduced-motion behavior.

Do not copy public-token authentication code into the self-service UI.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same focused command.

Expected: all focused UI/web-surface tests pass.

- [ ] **Step 5: Commit**

Commit message:
`feat(self-service): align kiosk catalog with public menu`

---

### Task 6: Update current product documentation and release capability declarations

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `docs/architecture/e30-e39-restaurant.md`
- Modify: `docs/architecture/access-control-p4-device-access.md`
- Modify: `UX-CONTRACT.md`
- Modify: `release/capabilities.json`
- Modify: `release/customer-capabilities.json`
- Test: `test/user-facing-operational-labels.test.js` or a new focused contract test if no existing documentation assertion fits

**Interfaces:**
- Current product language exposes QR da mesa, Garçom, KDS and Autoatendimento; it does not advertise Tablet de mesa as a separate channel.
- Historical dated specs/plans may remain historical records; current product/architecture/release declarations must describe the new canonical model.

- [ ] **Step 1: Write a failing current-doc contract**

Add a small test that reads current authority files and asserts:
- no current capability named `table-bound-self-service-tablet`;
- README/current architecture do not list `TABLET` as a supported device type;
- DESIGN/UX contract describe `SELF_SERVICE + TABLE/PICKUP` and public QR as separate access models.

- [ ] **Step 2: Run the doc contract and verify RED**

Run the selected `node --test ...` file.

Expected: failure on current TABLET references/capability declaration.

- [ ] **Step 3: Update current documentation and release metadata**

Replace current-product references to Tablet de mesa with:
- public QR menu for customer-owned phones/tablets;
- paired self-service `TABLE` for fixed table hardware;
- paired self-service `PICKUP` for counter pickup.

Remove the current release capability `table-bound-self-service-tablet` and replace it only if an equivalent self-service-table capability identifier is required by release checks; use a name that describes the canonical feature rather than legacy hardware.

- [ ] **Step 4: Run doc checks**

Run:
`npm run docs:check`

Expected: exit 0.

Run the focused documentation test again.

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message:
`docs: document unified self-service channel`

---

### Task 7: Full regression and release verification

**Files:**
- Modify tests/QA only if verification reveals an obsolete TABLET expectation that belongs to the removed product contract.
- Do not weaken unrelated assertions to make the suite green.

**Interfaces:**
- Final branch must preserve public QR menu, WAITER, KDS, self-service PICKUP, self-service TABLE, KDS dispatch, public-menu responsive behavior and device credential security.

- [ ] **Step 1: Search for remaining active legacy references**

Run:
`git grep -n "TABLET\|Tablet de mesa\|table-bound-self-service-tablet" -- ':!docs/superpowers/specs/**' ':!docs/superpowers/plans/**'`

Expected: no active product-code/current-doc references representing TABLET as a supported device or order source. Any intentional occurrence must be reviewed and justified before proceeding.

- [ ] **Step 2: Run focused restaurant/self-service suite**

Run:
`node --test test/e30-e39-restaurant.test.js test/e48-e54-final.test.js test/restaurant-main-clean-multichannel.test.js test/public-menu-layouts.test.js test/ui-web-surfaces.test.js test/intuitive-p0-p1.test.js test/access-profiles-and-device-access.test.js test/access-profiles-device-access.test.js test/access-control-p5-p10.test.js`

Expected: 0 failures.

- [ ] **Step 3: Run the complete project test suite**

Run:
`npm test`

Expected: exit 0, 0 failing tests.

- [ ] **Step 4: Run canonical verification**

Run:
`npm run verify`

Expected: exit 0.

- [ ] **Step 5: Run responsive web/UI gates available in the execution environment**

Run:
`npm run qa:web-surfaces`

Then, when the environment supports Electron/Xvfb:
`npm run qa:e2e:tablet`

Expected: exit 0 and no horizontal-overflow/page-error failures. The `tablet` name here is a viewport size, not the removed device type.

- [ ] **Step 6: Inspect branch diff against main**

Verify only the intended self-service/tablet-removal, tests, current documentation and approved spec/plan files changed.

- [ ] **Step 7: Commit any verification-only test/QA corrections**

Commit message if needed:
`test(self-service): cover unified customer device flow`
