# Returns Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete desktop return workflow that searches completed sales, selects refundable items, calculates refunds, supports local manager/admin authorization for cashier-operated returns, and proves the full flow with ArtiSys QA E2E.

**Architecture:** Keep the existing immutable-sale/return-transaction domain model. Add a small in-memory, single-use approval store plus a focused local authorization router that validates existing local manager/admin credentials; the main returns route consumes the scoped approval before calling the return service with separate operator and authorizer identities. Rebuild only `renderReturns()` and its operational CSS around existing APIs and selectors, then register one dedicated E2E flow.

**Tech Stack:** Node.js >=22, `node:sqlite`/`DatabaseSync`, Electron 39, local HTTP `/api/v1`, existing scrypt user authentication, `node:test`, ArtiSys QA/Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-09-24-returns-desktop-ui-design.md`

## Global Constraints

- Core implementation must remain local/self-hosted and require no paid external service.
- Reuse the existing Electron renderer, local HTTP API, SQLite runtime, authentication, event/outbox, and ArtiSys QA/Playwright stack.
- No external identity or authorization provider is introduced.
- Existing `/api/v1/returns` behavior for manager/admin sessions remains compatible.
- The backend remains authoritative for refund totals, refundable quantities, sale status, authorization, and mutation idempotency.
- Passwords used for delegated authorization must never be persisted, logged, returned to the renderer after validation, or embedded in audit payloads.
- Approval TTL is exactly 120000 ms (2 minutes), stored only in server memory, scoped to `return.complete`, bound to requester session/user + terminal + sale, and single-use.
- Do not redesign unrelated operational pages or introduce a new UI framework.

## File Structure

- Create `server/return-approval-store.js` — issue/consume short-lived scoped approval tokens; no credential verification here.
- Create `server/return-authorization-router.js` — authenticate requesting session, validate manager/admin credentials through `runtime.catalog.verifyUserPassword()`, validate sale/scope binding, and issue approval tokens.
- Modify `server/local-server.js` — create one approval store per local-server process and share it between authorization and main routers.
- Modify `server/router.js` — allow cashier return POST only with consumed approval; preserve manager/admin direct path; pass explicit authorizer identity to the domain.
- Modify `js/domains/returns/return-service.js` — persist operator and authorizer separately while preserving manager/admin self-authorization compatibility.
- Modify `desktop/renderer/api-client.js` — add `authorizeReturn(body)` and keep return mutation idempotency.
- Modify `desktop/renderer/operational-pages.js` — replace manual-ID return UX with search → sale selection → refundable quantities → refund/reason → authorization → submit.
- Modify `desktop/renderer/operational-pages.css` — desktop returns layout, result list, item rows, summary, and authorization dialog/panel states.
- Create `test/return-approval-store.test.js` — isolated expiry/binding/single-use tests.
- Modify `test/e15-returns-history.test.js` — explicit operator/authorizer domain contract tests.
- Create `test/returns-authorization-api.test.js` — HTTP authorization and delegated return tests.
- Create `test/returns-desktop-ui.test.js` — stable renderer/client/CSS contract assertions.
- Create `qa/flows/returns-desktop-e2e.json` — complete desktop scenario.
- Modify `qa/artisys-qa.config.json` — register E2E in `flows`, `full`, `release`, and critical-flow lists.
- Modify `package.json` — include the two new server files in `lint:core` so syntax verification cannot silently skip them.

## Review Focus

1. **A cashier changes the selected sale after manager approval:** the renderer must clear the approval token immediately, and the server binding must reject a token for another sale.
2. **Two returns race for the same remaining quantity:** the backend must reject the stale/excess second return even if its approval was valid; the UI must surface the server error and require fresh authorization before another submit.
3. **A valid approval request is replayed:** the first matching return may succeed, but a second mutation with a different mutation ID must fail because the approval is single-use; same-mutation retry remains protected by the existing mutation-id cache.
4. **Manager credentials are correct but the account is cashier/inactive:** `verifyUserPassword()`/role checks must reject authorization and never issue a token.
5. **Return total has fractional quantities:** display totals and submitted refund cents must use the same `Math.round(unitPriceCents * quantity)` rule as the domain to avoid UI/server mismatch.

---

### Task 1: In-memory return approval store

**Files:**
- Create: `server/return-approval-store.js`
- Create: `test/return-approval-store.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Node `crypto.randomBytes`; no runtime/database dependency.
- Produces: `createReturnApprovalStore({ now, randomBytesFn, ttlMs })` with:
  - `issue({ requesterSessionToken, requesterUserId, terminalId, saleId, authorizedBy }) -> { approvalToken, authorizedBy, expiresAt }`
  - `consume(approvalToken, { requesterSessionToken, requesterUserId, terminalId, saleId, scope:'return.complete' }) -> { userId, role, name }`
  - TTL default and production value: `120000` ms.

- [ ] **Step 1: Write failing approval-store tests**

Create `test/return-approval-store.test.js` with deterministic time/token generation and explicit binding assertions:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturnApprovalStore } = require('../server/return-approval-store');

function fixture() {
  let now = 1_000;
  let seq = 0;
  const store = createReturnApprovalStore({
    now: () => now,
    ttlMs: 120_000,
    randomBytesFn: () => Buffer.from(`token-${++seq}`)
  });
  return { store, advance(ms) { now += ms; } };
}

const request = {
  requesterSessionToken:'session-cashier',
  requesterUserId:'cashier1',
  terminalId:'PDV-01',
  saleId:'sale1'
};
const approver = { userId:'manager1', role:'manager', name:'Gerente QA' };

test('approval is scoped, single-use and returns only approver identity', () => {
  const { store } = fixture();
  const issued = store.issue({ ...request, authorizedBy:approver });
  assert.ok(issued.approvalToken);
  assert.equal(issued.authorizedBy.userId, 'manager1');
  const consumed = store.consume(issued.approvalToken, { ...request, scope:'return.complete' });
  assert.deepEqual(consumed, approver);
  assert.throws(() => store.consume(issued.approvalToken, { ...request, scope:'return.complete' }), /invalida|consumida/i);
});

test('approval rejects sale/session/terminal mismatch without authorizing return', () => {
  const { store } = fixture();
  const issued = store.issue({ ...request, authorizedBy:approver });
  assert.throws(() => store.consume(issued.approvalToken, { ...request, saleId:'sale2', scope:'return.complete' }), /vinculo|escopo/i);
});

test('approval expires after exactly 120 seconds', () => {
  const { store, advance } = fixture();
  const issued = store.issue({ ...request, authorizedBy:approver });
  advance(120_001);
  assert.throws(() => store.consume(issued.approvalToken, { ...request, scope:'return.complete' }), /expirada/i);
});
```

- [ ] **Step 2: Run the isolated test and verify RED**

Run:

```bash
node --test test/return-approval-store.test.js
```

Expected: FAIL because `server/return-approval-store.js` does not exist.

- [ ] **Step 3: Implement the minimal store**

Create `server/return-approval-store.js` with a `Map` keyed by opaque token. Normalize nullable terminal IDs consistently and never serialize credentials:

```js
'use strict';
const { randomBytes } = require('node:crypto');

function createReturnApprovalStore({ now=()=>Date.now(), randomBytesFn=randomBytes, ttlMs=120_000 }={}) {
  const approvals = new Map();
  const norm = value => value == null ? null : String(value);

  function issue({ requesterSessionToken, requesterUserId, terminalId, saleId, authorizedBy }) {
    if (!requesterSessionToken || !requesterUserId || !saleId) throw new Error('Dados da autorizacao incompletos.');
    if (!['manager','admin'].includes(String(authorizedBy?.role || ''))) throw new Error('Autorizacao de gerente necessaria para devolucao.');
    const approvalToken = randomBytesFn(32).toString('hex');
    const expiresAtMs = now() + ttlMs;
    approvals.set(approvalToken, {
      requesterSessionToken:String(requesterSessionToken),
      requesterUserId:String(requesterUserId),
      terminalId:norm(terminalId),
      saleId:String(saleId),
      scope:'return.complete',
      authorizedBy:{ userId:String(authorizedBy.userId), role:String(authorizedBy.role), name:String(authorizedBy.name || '') },
      expiresAtMs
    });
    return { approvalToken, authorizedBy:approvals.get(approvalToken).authorizedBy, expiresAt:new Date(expiresAtMs).toISOString() };
  }

  function consume(token, expected) {
    const key = String(token || '');
    const approval = approvals.get(key);
    if (!approval) throw new Error('Autorizacao invalida ou ja consumida.');
    if (approval.expiresAtMs <= now()) { approvals.delete(key); throw new Error('Autorizacao expirada.'); }
    const same = approval.requesterSessionToken === String(expected.requesterSessionToken || '') &&
      approval.requesterUserId === String(expected.requesterUserId || '') &&
      approval.terminalId === norm(expected.terminalId) &&
      approval.saleId === String(expected.saleId || '') &&
      approval.scope === String(expected.scope || '');
    if (!same) throw new Error('Autorizacao nao corresponde ao vinculo ou escopo desta devolucao.');
    approvals.delete(key);
    return approval.authorizedBy;
  }

  return { issue, consume };
}

module.exports = { createReturnApprovalStore };
```

- [ ] **Step 4: Run store tests and syntax check**

Run:

```bash
node --test test/return-approval-store.test.js
node --check server/return-approval-store.js
```

Expected: PASS.

- [ ] **Step 5: Add the new server file to `lint:core`**

In `package.json`, append `node --check server/return-approval-store.js` beside the other server checks. Do not change dependencies.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/return-approval-store.js test/return-approval-store.test.js package.json
git commit -m "feat: add scoped return approval store"
```

---

### Task 2: Separate operator and authorizer in return domain

**Files:**
- Modify: `js/domains/returns/return-service.js`
- Modify: `test/e15-returns-history.test.js`

**Interfaces:**
- Consumes: trusted `input.authorizedBy = { userId, role, name? }` from server/runtime boundary.
- Produces: return record where `operatorId` is the authenticated operator and `authorizedById` is the validating manager/admin.
- Compatibility: when `authorizedBy` is omitted and `actor.role` is manager/admin, use `actor` as self-authorizer so existing domain callers stay valid.

- [ ] **Step 1: Add RED domain tests for delegated and self authorization**

Extend `test/e15-returns-history.test.js` with a cashier actor and assertions:

```js
function cashierActor() { return { userId:'cashier1', role:'cashier', terminalId:'PDV-01' }; }

test('return persists operator separately from delegated manager authorizer', async () => {
  const runtime = createPdvRuntime();
  seed(runtime);
  runtime.catalog.createUser({id:'cashier1',username:'caixa',name:'Caixa',role:'cashier',password:'senha-forte-123'});
  const sale = await completeSale(runtime);
  const created = runtime.returns.createReturn({
    saleId:sale.id,
    terminalId:'PDV-01',
    operatorId:'cashier1',
    reason:'Teste autorizado',
    items:[{ saleItemId:sale.items[0].id, quantity:1 }],
    refunds:[{ method:'CASH', amountCents:1000 }],
    actor:cashierActor(),
    authorizedBy:{ userId:'mgr', role:'manager', name:'Gerente' }
  });
  assert.equal(created.operatorId, 'cashier1');
  assert.equal(created.authorizedById, 'mgr');
  runtime.close();
});

test('return rejects delegated authorization from non manager role', async () => {
  // seed sale as above
  assert.throws(() => runtime.returns.createReturn({
    /* valid sale/items/refund */
    actor:cashierActor(),
    authorizedBy:{ userId:'cashier2', role:'cashier' }
  }), /Autorizacao de gerente/i);
});
```

Also add an explicit assertion to an existing manager-created return that `authorizedById === 'mgr'` to pin backward compatibility.

- [ ] **Step 2: Run domain test and verify RED**

Run:

```bash
node --test test/e15-returns-history.test.js
```

Expected: delegated cashier case FAIL because current `assertManager(actor)` rejects the operator.

- [ ] **Step 3: Implement explicit authorization resolution**

In `return-service.js`, replace direct `assertManager(actor)` at return creation with a resolver:

```js
function resolveAuthorizedBy(input, actor) {
  const candidate = input.authorizedBy || actor;
  assertManager(candidate);
  const userId = String(candidate?.userId || '').trim();
  if (!userId) throw new Error('Identidade do autorizador e obrigatoria.');
  return { userId, role:String(candidate.role), name:String(candidate.name || '') };
}
```

Inside `createReturn()`:

```js
const actor = input.actor || {};
const authorizedBy = resolveAuthorizedBy(input, actor);
const operatorId = String(input.operatorId || actor.userId || '').trim();
// ...
.run(id, saleId, terminalId, operatorId, totalCents, reason, authorizedBy.userId, timestamp);
```

Keep `cancelReturn()` manager/admin-only; delegated authorization is only for `return.complete` in this scope.

- [ ] **Step 4: Preserve audit/outbox semantics and add authorizer context**

Keep event `actor` as the operator/session actor. Add non-secret `authorizedById` to return-complete audit context and event payload only if it is useful to current consumers; do not alter existing inventory/cash payload keys required by effects. Example safe addition:

```js
payload:{ saleId, terminalId, totalCents, authorizedById:authorizedBy.userId, items:[...], refunds }
```

- [ ] **Step 5: Run focused regression tests**

Run:

```bash
node --test test/e15-returns-history.test.js test/historical-cost-snapshot.test.js
```

Expected: PASS, including original-sale immutability, over-return rejection, cash/stock effects, and cost snapshot behavior.

- [ ] **Step 6: Commit Task 2**

```bash
git add js/domains/returns/return-service.js test/e15-returns-history.test.js
git commit -m "feat: separate return operator and authorizer"
```

---

### Task 3: Local manager authorization HTTP flow

**Files:**
- Create: `server/return-authorization-router.js`
- Modify: `server/local-server.js`
- Modify: `server/router.js`
- Modify: `desktop/renderer/api-client.js`
- Create: `test/returns-authorization-api.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `sessionStore`, `runtime.catalog.verifyUserPassword(username,password)`, `runtime.sales.getSale(saleId)`, and Task 1 approval store.
- Produces:
  - `POST /api/v1/auth/authorize` with body `{ username, password, scope:'return.complete', resource:{ saleId, terminalId } }`.
  - Response `{ approvalToken, authorizedBy:{id,name,role}, expiresAt }`.
  - `POST /api/v1/returns` accepts optional `approvalToken`; manager/admin self-authorize, cashier must present a valid token.
  - Client method `authorizeReturn({ username, password, saleId, terminalId })`.

- [ ] **Step 1: Write RED API tests**

Create `test/returns-authorization-api.test.js`. Build a local-server fixture with admin/manager/cashier users, a completed sale, and login helpers. Pin these cases:

```js
test('cashier obtains manager approval and completes return with separate identities', async () => {
  const approvalResponse = await fetch(`${base}/api/v1/auth/authorize`, {
    method:'POST',
    headers:headers(cashierToken),
    body:JSON.stringify({
      username:'manager', password:'manager-pass-123', scope:'return.complete',
      resource:{ saleId:'sale1', terminalId:'PDV-01' }
    })
  });
  assert.equal(approvalResponse.status, 200);
  const approval = await approvalResponse.json();
  assert.equal(approval.authorizedBy.role, 'manager');

  const result = await fetch(`${base}/api/v1/returns`, {
    method:'POST', headers:{...headers(cashierToken),'x-mutation-id':'return-1'},
    body:JSON.stringify({
      saleId:'sale1', approvalToken:approval.approvalToken,
      reason:'Cliente devolveu uma unidade',
      items:[{saleItemId,quantity:1}],
      refunds:[{method:'CASH',amountCents:1000}]
    })
  });
  assert.equal(result.status, 201);
  const payload = await result.json();
  assert.equal(payload.return.operatorId, 'cashier1');
  assert.equal(payload.return.authorizedById, 'manager1');
});
```

Add separate tests for:

```text
401 authorization endpoint without requester session
401 wrong manager password
403 correct password for cashier/non-manager approver
400/404 authorization against missing/non-completed sale
403 cashier POST /returns without approval
400/403 expired approval
400/403 reused approval with a different mutation ID
400/403 approval bound to another sale/session/terminal
201 manager/admin direct POST /returns without approvalToken
same x-mutation-id retry returns cached success rather than consuming approval twice
```

Use the real `createLocalServer()` and local user password hashes; never assert/log raw passwords beyond the test fixture literals.

- [ ] **Step 2: Run API test and verify RED**

```bash
node --test test/returns-authorization-api.test.js
```

Expected: FAIL because `/api/v1/auth/authorize` does not exist and cashier is rejected by current returns role guard.

- [ ] **Step 3: Implement `server/return-authorization-router.js`**

Create a focused handler following the boolean-handled convention used by `auth-session-router.js`:

```js
function createReturnAuthorizationRouter({ runtime, sessionStore, approvalStore, bodyLimitBytes=1024*1024 }={}) {
  // validate dependencies
  return async function returnAuthorizationRoute(request, response) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method !== 'POST' || url.pathname !== '/api/v1/auth/authorize') return false;
    // authenticate Bearer token from sessionStore; reject expired session
    // parse bounded JSON
    // require body.scope === 'return.complete'
    // bind terminal to current session; reject conflicting resource.terminalId
    // require saleId and completed sale
    // verifyUserPassword(username,password)
    // require verified user role manager/admin
    // approvalStore.issue(...)
    // return 200 with token + {id,name,role} + expiresAt
    return true;
  };
}
```

Do not pass `password` into logger/audit/store objects. Map invalid credentials to 401 and wrong role to 403.

- [ ] **Step 4: Wire one approval store through `local-server.js`**

Instantiate once:

```js
const approvalStore = createReturnApprovalStore({ ttlMs:120_000 });
const returnAuthorizationHandler = createReturnAuthorizationRouter({ runtime, sessionStore, approvalStore, bodyLimitBytes });
const handler = createRouter({ runtime, installationToken:token, bodyLimitBytes, allowedOrigins, requireTerminalAuth, sessionStore, returnApprovalStore:approvalStore });
```

Run `returnAuthorizationHandler` after `authSessionHandler` and before the general router.

- [ ] **Step 5: Extend returns POST in `server/router.js`**

Change the router factory signature to accept `returnApprovalStore`. Replace the hard manager/admin guard for `POST /api/v1/returns` with:

```js
requireRole(session, ['admin','manager','cashier']);
const body = await readJson(request, bodyLimitBytes);
const result = await mutation(request, pathname, 201, async mid => {
  let authorizedBy = currentActor;
  if (session.role === 'cashier') {
    if (!returnApprovalStore) throw new HttpError(503, 'Servico de autorizacao de devolucao indisponivel.');
    try {
      authorizedBy = returnApprovalStore.consume(body.approvalToken, {
        requesterSessionToken:bearer(request),
        requesterUserId:session.userId,
        terminalId:session.terminalId || body.terminalId || null,
        saleId:body.saleId,
        scope:'return.complete'
      });
    } catch (error) {
      throw new HttpError(403, error.message);
    }
  }
  const ret = runtime.returns.createReturn({
    ...body,
    terminalId:session.terminalId || body.terminalId,
    operatorId:session.userId,
    actor:currentActor,
    authorizedBy,
    mutationId:mid
  });
  const dispatchResult = await dispatch();
  return { return:ret, dispatch:dispatchResult };
});
```

Strip or ignore any renderer-supplied `authorizedBy`; only the session/self path or consumed store result may populate it.

- [ ] **Step 6: Add client method**

In `desktop/renderer/api-client.js`:

```js
authorizeReturn({ username, password, saleId, terminalId }) {
  return this.request('/api/v1/auth/authorize', {
    method:'POST',
    body:{ username, password, scope:'return.complete', resource:{ saleId, terminalId } }
  });
}
```

Keep `createReturn(body)` unchanged except that callers may include `approvalToken`.

- [ ] **Step 7: Register new files in syntax verification**

Add both new server modules to `lint:core`:

```text
node --check server/return-approval-store.js
node --check server/return-authorization-router.js
```

- [ ] **Step 8: Run focused API/domain/client checks**

```bash
node --test test/return-approval-store.test.js test/e15-returns-history.test.js test/returns-authorization-api.test.js test/e13-e20-api-ui.test.js
node --check server/return-authorization-router.js
node --check server/local-server.js
node --check server/router.js
node --check desktop/renderer/api-client.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add server/return-authorization-router.js server/local-server.js server/router.js desktop/renderer/api-client.js test/returns-authorization-api.test.js package.json
git commit -m "feat: authorize cashier returns locally"
```

---

### Task 4: Rebuild `renderReturns()` as the desktop workflow

**Files:**
- Modify: `desktop/renderer/operational-pages.js`
- Modify: `desktop/renderer/operational-pages.css`
- Create: `test/returns-desktop-ui.test.js`

**Interfaces:**
- Consumes: `api.currentSession()`, `api.salesHistory({status:'COMPLETED',query,limit})`, `api.saleDetails(id)`, `api.returns({saleId})`, `api.authorizeReturn(...)`, `api.createReturn(...)`.
- Produces stable selectors for QA:
  - `#ops-return-search`
  - `#ops-return-results`
  - `[data-return-sale-select]`
  - `#ops-return-selected-sale`
  - `[data-return-item]`
  - `[data-return-qty]`
  - `#ops-return-method`
  - `#ops-return-reason`
  - `#ops-return-total`
  - `#ops-return-authorize`
  - `#ops-return-authorization`
  - `#ops-return-submit`
  - `#ops-return-history`

- [ ] **Step 1: Write RED renderer contract tests**

Create `test/returns-desktop-ui.test.js` using source-level contract assertions consistent with existing operational UI tests:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'desktop', 'renderer');
const operational = fs.readFileSync(path.join(root, 'operational-pages.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api-client.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'operational-pages.css'), 'utf8');

test('returns desktop exposes sale search, item selection, refund and authorization controls', () => {
  for (const marker of [
    'ops-return-search','ops-return-results','data-return-sale-select','ops-return-selected-sale',
    'data-return-item','data-return-qty','ops-return-method','ops-return-reason','ops-return-total',
    'ops-return-authorize','ops-return-authorization','ops-return-submit','ops-return-history'
  ]) assert.match(operational, new RegExp(marker));
  assert.match(api, /authorizeReturn\s*\(/);
  assert.match(operational, /salesHistory\(\{[^}]*status:\s*'COMPLETED'/);
  assert.match(operational, /api\.returns\(\{saleId/);
});

test('returns total follows domain line rounding for fractional quantities', () => {
  assert.match(operational, /Math\.round\(Number\([^)]*unitPriceCents[^)]*\)\s*\*\s*quantity\)/);
});

test('changing sale clears delegated approval', () => {
  assert.match(operational, /approvalToken\s*=\s*''/);
});

test('returns layout has dedicated desktop selectors', () => {
  assert.match(css, /\.ops-returns-layout/);
  assert.match(css, /\.ops-return-search-results/);
  assert.match(css, /\.ops-return-summary/);
});
```

- [ ] **Step 2: Run UI contract test and verify RED**

```bash
node --test test/returns-desktop-ui.test.js
```

Expected: FAIL because new selectors/client authorization markers do not exist in the current renderer.

- [ ] **Step 3: Restructure `renderReturns()` around explicit state**

Inside `renderReturns()` keep state local to the invocation:

```js
const state = {
  session: await api.currentSession(),
  selectedSale:null,
  saleReturns:[],
  approvalToken:'',
  authorizedBy:null
};
```

Render the page shell first with search/new-return/history columns. Search only on submit or explicit search button to avoid uncontrolled requests:

```js
const results = await api.salesHistory({ status:'COMPLETED', query, limit:50 });
```

Each `[data-return-sale-select]` stores the sale ID only; fetch details on selection.

- [ ] **Step 4: Load sale details and completed returns in parallel**

On sale selection:

```js
state.approvalToken = '';
state.authorizedBy = null;
const [sale, returns] = await Promise.all([
  api.saleDetails(saleId),
  api.returns({ saleId })
]);
state.selectedSale = sale;
state.saleReturns = returns.filter(row => row.status === 'COMPLETED');
```

For each item compute display availability:

```js
const returned = state.saleReturns.flatMap(row => row.items || [])
  .filter(row => row.saleItemId === item.id)
  .reduce((sum,row) => sum + Number(row.quantity || 0), 0);
const available = Math.max(0, Number(item.quantity || 0) - returned);
```

Disable item selection and quantity input when `available <= 0`.

- [ ] **Step 5: Add live item/refund calculation with domain-equivalent rounding**

Build selected items only from checked rows. For every checked item:

```js
const quantity = Number(qtyInput.value || 0);
const max = Number(qtyInput.max || 0);
if (!(quantity > 0) || quantity > max) throw new Error('Quantidade devolvida invalida.');
const lineCents = Math.round(Number(item.unitPriceCents || 0) * quantity);
items.push({ saleItemId:item.id, quantity });
totalCents += lineCents;
```

Update `#ops-return-total` and submit the single refund line:

```js
refunds:[{ method:methodSelect.value, amountCents:totalCents }]
```

- [ ] **Step 6: Implement manager self-authorization vs cashier delegated authorization UI**

If `state.session.user.role` is `manager` or `admin`, render an already-authorized status using the current user and keep `#ops-return-authorize` hidden/disabled.

For `cashier`, `#ops-return-authorize` opens `#ops-return-authorization` containing username/password inputs. Submit credentials through:

```js
const approval = await api.authorizeReturn({
  username,
  password,
  saleId:state.selectedSale.id,
  terminalId:state.session.terminalId
});
state.approvalToken = approval.approvalToken;
state.authorizedBy = approval.authorizedBy;
passwordInput.value = '';
```

Never store the password in `state`, data attributes, local/session storage, or rendered HTML after the request.

Changing selected sale, changing route, or successful submission clears `approvalToken` and authorizer display.

- [ ] **Step 7: Submit and refresh safely**

Before `api.createReturn()` validate sale, at least one item, reason, refund method, and (for cashier) approval token. Submit:

```js
await api.createReturn({
  saleId:state.selectedSale.id,
  items,
  refunds:[{ method, amountCents:totalCents }],
  reason,
  ...(state.approvalToken ? { approvalToken:state.approvalToken } : {})
});
```

On success call `renderReturns()` to clear draft and refresh history. On server error, clear delegated approval so stale/raced submissions require a fresh manager action:

```js
state.approvalToken = '';
state.authorizedBy = null;
showToast(error.message, 'error');
```

- [ ] **Step 8: Add desktop-focused CSS without changing unrelated pages**

Extend `operational-pages.css` with namespaced rules such as:

```css
.ops-returns-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.75fr);gap:18px}
.ops-return-search-results{display:grid;gap:8px;max-height:260px;overflow:auto}
.ops-return-sale-result{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid #e5e9f1;border-radius:12px}
.ops-return-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.ops-return-auth-panel{margin-top:14px;padding:14px;border:1px solid #e5e9f1;border-radius:12px;background:#fafbfe}
@media(max-width:1100px){.ops-returns-layout{grid-template-columns:1fr}.ops-return-summary{grid-template-columns:1fr}}
```

Keep `.ops-return-item` compatible or refine it under `.ops-returns-layout` to show sold/returned/available/price/quantity clearly.

- [ ] **Step 9: Run UI/domain/API focused checks**

```bash
node --test test/returns-desktop-ui.test.js test/e15-returns-history.test.js test/returns-authorization-api.test.js test/operational-route-stability.test.js test/e13-e20-api-ui.test.js
node --check desktop/renderer/operational-pages.js
node --check desktop/renderer/api-client.js
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add desktop/renderer/operational-pages.js desktop/renderer/operational-pages.css test/returns-desktop-ui.test.js
git commit -m "feat: complete desktop returns workflow"
```

---

### Task 5: Complete ArtiSys QA E2E for returns

**Files:**
- Create: `qa/flows/returns-desktop-e2e.json`
- Modify: `qa/artisys-qa.config.json`
- Test: `test/artisys-qa-integration.test.js` only if the current integration test enumerates/guards registered flows and needs an explicit assertion.

**Interfaces:**
- Consumes: stable selectors from Task 4 and existing QA actions (`waitFor`, `fill`, `click`, `check`, `expectText`, `screenshot`, `reload`).
- Produces: registered flow id `returns-desktop-e2e` runnable with:

```bash
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
```

- [ ] **Step 1: Register a missing-flow RED contract first**

If `test/artisys-qa-integration.test.js` already validates named flows, add `returns-desktop-e2e` to that expected list. Otherwise add a narrow test in `test/returns-desktop-ui.test.js` that reads `qa/artisys-qa.config.json` and asserts:

```js
const qa = JSON.parse(fs.readFileSync(path.join(__dirname,'..','qa','artisys-qa.config.json'),'utf8'));
assert.equal(qa.flows['returns-desktop-e2e'], 'flows/returns-desktop-e2e.json');
assert.ok(qa.qaProfiles.full.flows.includes('returns-desktop-e2e'));
assert.ok(qa.qaProfiles.release.criticalFlows.includes('returns-desktop-e2e'));
```

Run the selected test and confirm RED before adding the config entry.

- [ ] **Step 2: Create the full E2E flow using existing UI-only setup**

`qa/flows/returns-desktop-e2e.json` must perform, in order:

```text
1. Initial setup as QA admin/manager.
2. Create a cashier user through the existing Sellers UI (`role=cashier`).
3. Create a deterministic product priced at R$ 10,00.
4. Open checkout and complete a sale with quantity 2 (R$ 20,00 total).
5. Log out and log in as the cashier user.
6. Open Returns (`[data-home-route='returns']` or `[data-route='returns']`).
7. Search the completed sale by the deterministic product/sale/customer text available in history.
8. Select the sale.
9. Assert sold=2 and available=2 in `#ops-return-selected-sale`/item row.
10. Select the item and set return quantity to 1.
11. Assert `#ops-return-total` shows R$ 10,00.
12. Select refund method CASH and enter a deterministic reason.
13. Open `#ops-return-authorization` and first submit invalid manager credentials; assert an error remains visible and no return appears.
14. Submit valid admin/manager credentials created in step 1; assert authorized-by identity is shown.
15. Click `#ops-return-submit`.
16. Assert success/history contains reason or R$ 10,00 and COMPLETED status.
17. Search/select the same sale again and assert remaining available quantity is now 1.
18. Capture a final full-page screenshot.
```

Use escaped fixture passwords in JSON in the same style as existing QA flows. Do not place production credentials or tokens in the flow.

- [ ] **Step 3: Register the flow in QA config**

Add:

```json
"returns-desktop-e2e": "flows/returns-desktop-e2e.json"
```

Add the flow id to `qaProfiles.full.flows`, `qaProfiles.full.criticalFlows`, `qaProfiles.release.flows`, and `qaProfiles.release.criticalFlows`. Do not add it to `quick` because it is a full business transaction scenario.

- [ ] **Step 4: Validate QA schema/config**

```bash
npm run qa:validate
```

Expected: PASS.

- [ ] **Step 5: Run the dedicated E2E**

```bash
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
```

Expected: PASS with the final screenshot showing the completed return and remaining refundable quantity.

If the first E2E run exposes selector/timing defects, fix only the returns flow/renderer selectors required for deterministic operation; do not replace the E2E with sleeps when a stable state selector exists.

- [ ] **Step 6: Commit Task 5**

```bash
git add qa/flows/returns-desktop-e2e.json qa/artisys-qa.config.json test/artisys-qa-integration.test.js test/returns-desktop-ui.test.js
git commit -m "test: cover complete desktop return flow"
```

Stage only whichever test file was actually changed.

---

### Task 6: Regression verification, branch review, and PR

**Files:**
- No new production scope expected.
- Modify only files required by failures proven by the verification commands below.

**Interfaces:**
- Consumes: all previous task deliverables.
- Produces: verified branch `feat/returns-desktop-ui` and PR against `main`.

- [ ] **Step 1: Run all targeted return/security tests together**

```bash
node --test \
  test/return-approval-store.test.js \
  test/e15-returns-history.test.js \
  test/historical-cost-snapshot.test.js \
  test/returns-authorization-api.test.js \
  test/returns-desktop-ui.test.js \
  test/e13-e20-api-ui.test.js \
  test/operational-route-stability.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full repository verification**

```bash
npm run verify
```

Expected: PASS. Fix regressions only when they are caused by this branch; do not broaden feature scope to unrelated pre-existing failures.

- [ ] **Step 3: Re-run dedicated E2E after all fixes**

```bash
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
```

Expected: PASS on the final branch head.

- [ ] **Step 4: Inspect branch diff for secrets and scope drift**

Review `main...HEAD` and specifically confirm:

```text
- no manager password/token is logged, persisted, audited, or rendered after authorization;
- no external/paid dependency was added;
- `cancelReturn` remains manager/admin-only;
- original sale mutation logic was not introduced;
- unrelated operational pages were not reformatted/refactored;
- new server files are included in lint:core;
- E2E is registered in full/release profiles.
```

- [ ] **Step 5: Commit any verification-only fixes**

If verification required changes:

```bash
git add <only-fixed-files>
git commit -m "fix: harden desktop return flow"
```

Skip this step when no fixes were required.

- [ ] **Step 6: Open the PR**

Open `feat/returns-desktop-ui` → `main` with title:

```text
feat: complete desktop returns workflow
```

PR body must summarize:

```markdown
## Summary
- adds completed-sale search and refundable item selection to `renderReturns()`
- adds local, short-lived manager/admin authorization for cashier returns
- preserves separate operator/authorizer identities and immutable original sales
- adds full ArtiSys QA E2E coverage

## Security
- approval tokens are in-memory, 120-second TTL, scoped and single-use
- manager passwords are verified locally and never persisted/logged
- no paid/external service dependency

## Verification
- `npm run verify`
- dedicated `returns-desktop-e2e` flow
```

Do not merge automatically; leave the verified PR open for review unless the human explicitly requests merge.
