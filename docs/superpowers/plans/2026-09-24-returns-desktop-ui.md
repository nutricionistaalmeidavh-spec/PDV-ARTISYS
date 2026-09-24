# Returns Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete desktop return workflow that searches completed sales, selects refundable items, calculates refunds, supports local manager/admin authorization for cashier-operated returns, and proves the full flow with ArtiSys QA E2E.

**Architecture:** Preserve the immutable-sale/return-transaction model. Add a focused in-memory approval store and local authorization router using the existing user/password store; the main returns route consumes a scoped one-time approval and passes separate operator/authorizer identities to the domain. Rebuild only `renderReturns()` plus namespaced operational CSS and add one dedicated QA flow.

**Tech Stack:** Node.js >=22, `node:sqlite`/`DatabaseSync`, Electron 39, local HTTP `/api/v1`, existing scrypt authentication, `node:test`, ArtiSys QA/Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-09-24-returns-desktop-ui-design.md`

## Global Constraints

- Core implementation must remain local/self-hosted and require no paid external service.
- Reuse the existing Electron renderer, local HTTP API, SQLite runtime, authentication, event/outbox, and ArtiSys QA/Playwright stack.
- No external identity or authorization provider is introduced.
- Existing `/api/v1/returns` behavior for manager/admin sessions remains compatible.
- The backend remains authoritative for refund totals, refundable quantities, sale status, authorization, and mutation idempotency.
- Passwords used for delegated authorization must never be persisted, logged, returned after validation, or embedded in audit payloads.
- Approval TTL is exactly `120000` ms, stored only in server memory, scoped to `return.complete`, bound to requester session/user + terminal + sale, and single-use.
- `cancelReturn()` remains manager/admin-only.
- Do not redesign unrelated operational pages or introduce a new UI framework.

## File Structure

- Create `server/return-approval-store.js` — token issue/consume, TTL, binding, single-use.
- Create `server/return-authorization-router.js` — authenticated local manager/admin credential verification and approval issuance.
- Modify `server/local-server.js` — create/share one approval store.
- Modify `server/router.js` — consume approval for cashier return creation; preserve manager/admin direct creation.
- Modify `js/domains/returns/return-service.js` — persist operator and authorizer independently.
- Modify `desktop/renderer/api-client.js` — add `authorizeReturn()`.
- Modify `desktop/renderer/operational-pages.js` — search/select/refund/authorize/submit flow.
- Modify `desktop/renderer/operational-pages.css` — returns-only layout and states.
- Create `test/return-approval-store.test.js`.
- Modify `test/e15-returns-history.test.js`.
- Create `test/returns-authorization-api.test.js`.
- Create `test/returns-desktop-ui.test.js`.
- Create `qa/flows/returns-desktop-e2e.json`.
- Modify `qa/artisys-qa.config.json`.
- Modify `package.json` — add new server modules to `lint:core`.

## Review Focus

1. **Sale changed after approval:** renderer clears approval immediately and server rejects a token bound to another sale.
2. **Concurrent return consumes remaining quantity:** backend rejects the stale/excess return and UI clears delegated approval before another attempt.
3. **Approval replay:** first matching mutation succeeds; another mutation ID with the same approval fails; same mutation-ID retry remains idempotent through the existing mutation store.
4. **Approver is cashier or inactive:** no approval token is issued.
5. **Fractional quantity:** renderer uses `Math.round(unitPriceCents * quantity)`, matching domain cents calculation.

---

### Task 1: In-memory scoped approval store

**Files:**
- Create: `server/return-approval-store.js`
- Create: `test/return-approval-store.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces `createReturnApprovalStore({ now, randomBytesFn, ttlMs })`.
- `issue({ requesterSessionToken, requesterUserId, terminalId, saleId, authorizedBy })` returns `{ approvalToken, authorizedBy, expiresAt }`.
- `consume(token, { requesterSessionToken, requesterUserId, terminalId, saleId, scope })` returns `{ userId, role, name }`.

- [ ] **Step 1: Write RED store tests**

Create `test/return-approval-store.test.js`:

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
    randomBytesFn: () => Buffer.from(`approval-${++seq}`)
  });
  return { store, advance(ms) { now += ms; } };
}

const binding = {
  requesterSessionToken:'session-cashier',
  requesterUserId:'cashier1',
  terminalId:'PDV-01',
  saleId:'sale1'
};
const manager = { userId:'manager1', role:'manager', name:'Gerente QA' };

test('return approval is bound and single-use', () => {
  const { store } = fixture();
  const issued = store.issue({ ...binding, authorizedBy:manager });
  assert.ok(issued.approvalToken);
  assert.equal(issued.authorizedBy.userId, 'manager1');
  assert.deepEqual(store.consume(issued.approvalToken, { ...binding, scope:'return.complete' }), manager);
  assert.throws(() => store.consume(issued.approvalToken, { ...binding, scope:'return.complete' }), /invalida|consumida/i);
});

test('return approval rejects a different sale and remains unusable for that sale', () => {
  const { store } = fixture();
  const issued = store.issue({ ...binding, authorizedBy:manager });
  assert.throws(() => store.consume(issued.approvalToken, { ...binding, saleId:'sale2', scope:'return.complete' }), /vinculo|escopo/i);
});

test('return approval rejects a different requester session', () => {
  const { store } = fixture();
  const issued = store.issue({ ...binding, authorizedBy:manager });
  assert.throws(() => store.consume(issued.approvalToken, { ...binding, requesterSessionToken:'session-other', scope:'return.complete' }), /vinculo|escopo/i);
});

test('return approval rejects a different terminal', () => {
  const { store } = fixture();
  const issued = store.issue({ ...binding, authorizedBy:manager });
  assert.throws(() => store.consume(issued.approvalToken, { ...binding, terminalId:'PDV-02', scope:'return.complete' }), /vinculo|escopo/i);
});

test('return approval expires after 120 seconds', () => {
  const { store, advance } = fixture();
  const issued = store.issue({ ...binding, authorizedBy:manager });
  advance(120_001);
  assert.throws(() => store.consume(issued.approvalToken, { ...binding, scope:'return.complete' }), /expirada/i);
});

test('return approval accepts only manager or admin identity', () => {
  const { store } = fixture();
  assert.throws(() => store.issue({ ...binding, authorizedBy:{userId:'cashier2',role:'cashier',name:'Caixa 2'} }), /gerente|autorizacao/i);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/return-approval-store.test.js
```

Expected: FAIL because `server/return-approval-store.js` is absent.

- [ ] **Step 3: Implement the store**

Create `server/return-approval-store.js`:

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
    const identity = {
      userId:String(authorizedBy.userId),
      role:String(authorizedBy.role),
      name:String(authorizedBy.name || '')
    };
    approvals.set(approvalToken, {
      requesterSessionToken:String(requesterSessionToken),
      requesterUserId:String(requesterUserId),
      terminalId:norm(terminalId),
      saleId:String(saleId),
      scope:'return.complete',
      authorizedBy:identity,
      expiresAtMs
    });
    return { approvalToken, authorizedBy:identity, expiresAt:new Date(expiresAtMs).toISOString() };
  }

  function consume(token, expected={}) {
    const key = String(token || '');
    const approval = approvals.get(key);
    if (!approval) throw new Error('Autorizacao invalida ou ja consumida.');
    if (approval.expiresAtMs <= now()) {
      approvals.delete(key);
      throw new Error('Autorizacao expirada.');
    }
    const matches = approval.requesterSessionToken === String(expected.requesterSessionToken || '') &&
      approval.requesterUserId === String(expected.requesterUserId || '') &&
      approval.terminalId === norm(expected.terminalId) &&
      approval.saleId === String(expected.saleId || '') &&
      approval.scope === String(expected.scope || '');
    if (!matches) throw new Error('Autorizacao nao corresponde ao vinculo ou escopo desta devolucao.');
    approvals.delete(key);
    return approval.authorizedBy;
  }

  return { issue, consume };
}

module.exports = { createReturnApprovalStore };
```

- [ ] **Step 4: Run GREEN tests and syntax check**

```bash
node --test test/return-approval-store.test.js
node --check server/return-approval-store.js
```

Expected: PASS.

- [ ] **Step 5: Register the file in `lint:core`**

Add `node --check server/return-approval-store.js` beside the existing `server/router.js` check in `package.json`. Do not add dependencies.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/return-approval-store.js test/return-approval-store.test.js package.json
git commit -m "feat: add scoped return approval store"
```

---

### Task 2: Separate return operator from authorizer

**Files:**
- Modify: `js/domains/returns/return-service.js`
- Modify: `test/e15-returns-history.test.js`

**Interfaces:**
- Consumes trusted `input.authorizedBy = { userId, role, name }` from the server/runtime boundary.
- When `authorizedBy` is absent and `actor` is manager/admin, self-authorization remains valid.
- Produces distinct `operatorId` and `authorizedById` on the return record.

- [ ] **Step 1: Add RED delegated-authorization tests**

Append to `test/e15-returns-history.test.js`:

```js
function cashierActor() { return { userId:'cashier1', role:'cashier', terminalId:'PDV-01' }; }

async function delegatedFixture() {
  let seq = 100;
  const runtime = createPdvRuntime({ now:()=>`2026-09-09T14:00:${String(seq++ % 60).padStart(2,'0')}Z`, idFactory:p=>`${p}-${seq++}` });
  seed(runtime);
  runtime.catalog.createUser({id:'cashier1',username:'caixa',name:'Caixa',role:'cashier',password:'senha-forte-123'});
  const sale = await completeSale(runtime);
  return { runtime, sale, saleItemId:sale.items[0].id };
}

test('return persists cashier operator separately from manager authorizer', async () => {
  const { runtime, saleItemId } = await delegatedFixture();
  const created = runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'cashier1', reason:'Devolucao autorizada',
    items:[{ saleItemId, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }],
    actor:cashierActor(), authorizedBy:{ userId:'mgr', role:'manager', name:'Gerente' }
  });
  assert.equal(created.operatorId, 'cashier1');
  assert.equal(created.authorizedById, 'mgr');
  runtime.close();
});

test('return rejects delegated authorization from cashier role', async () => {
  const { runtime, saleItemId } = await delegatedFixture();
  assert.throws(() => runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'cashier1', reason:'Autorizador invalido',
    items:[{ saleItemId, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }],
    actor:cashierActor(), authorizedBy:{ userId:'cashier2', role:'cashier', name:'Caixa 2' }
  }), /Autorizacao de gerente/i);
  runtime.close();
});
```

In the existing partial-return test, add:

```js
assert.equal(first.authorizedById, 'mgr');
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/e15-returns-history.test.js
```

Expected: delegated cashier case FAIL because current code validates `actor` as manager/admin.

- [ ] **Step 3: Implement explicit authorization resolution**

In `return-service.js` add:

```js
function resolveAuthorizedBy(input, actor) {
  const candidate = input.authorizedBy || actor;
  assertManager(candidate);
  const userId = String(candidate?.userId || '').trim();
  if (!userId) throw new Error('Identidade do autorizador e obrigatoria.');
  return { userId, role:String(candidate.role), name:String(candidate.name || '') };
}
```

At the start of `createReturn()` use:

```js
const actor = input.actor || {};
const authorizedBy = resolveAuthorizedBy(input, actor);
const saleId = String(input.saleId || '').trim();
const terminalId = String(input.terminalId || actor.terminalId || '').trim();
const operatorId = String(input.operatorId || actor.userId || '').trim();
```

Change the insert argument from `actor.userId || null` to `authorizedBy.userId`.

Add non-secret `authorizedById` to the completed event payload and audit context without removing keys consumed by return effects:

```js
payload:{
  saleId, terminalId, totalCents, authorizedById:authorizedBy.userId,
  items:normalizedItems.map(item=>({productId:item.productId,quantity:item.quantity,configuration:item.configuration||null})),
  refunds
}
```

`cancelReturn()` keeps its current direct manager/admin check.

- [ ] **Step 4: Run domain regressions**

```bash
node --test test/e15-returns-history.test.js test/historical-cost-snapshot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add js/domains/returns/return-service.js test/e15-returns-history.test.js
git commit -m "feat: separate return operator and authorizer"
```

---

### Task 3: Local manager authorization API

**Files:**
- Create: `server/return-authorization-router.js`
- Modify: `server/local-server.js`
- Modify: `server/router.js`
- Modify: `desktop/renderer/api-client.js`
- Create: `test/returns-authorization-api.test.js`
- Modify: `package.json`

**Interfaces:**
- `POST /api/v1/auth/authorize` body: `{ username, password, scope:'return.complete', resource:{ saleId, terminalId } }`.
- Response: `{ approvalToken, authorizedBy:{ id, name, role }, expiresAt }`.
- `POST /api/v1/returns` accepts optional `approvalToken`; cashier requires it, manager/admin do not.
- Client: `authorizeReturn({ username, password, saleId, terminalId })`.

- [ ] **Step 1: Write RED API fixture and tests**

Create `test/returns-authorization-api.test.js` with these helpers:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

function headers(token, mutationId) {
  return {
    authorization:`Bearer ${token}`,
    'content-type':'application/json',
    ...(mutationId ? {'x-mutation-id':mutationId} : {})
  };
}

async function login(base, username, password) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method:'POST', headers:{'content-type':'application/json','x-pdv-token':'install-secret'},
    body:JSON.stringify({username,password,terminalId:'PDV-01'})
  });
  assert.equal(response.status, 200);
  return (await response.json()).sessionToken;
}
```

The fixture must create users `manager1/manager`, `cashier1/cashier`, `cashier2/cashier`; create product `p1` at 1000 cents; open a cash session; create and complete `sale1` with quantity 2 and cash payment 2000; start `createLocalServer({token:'install-secret',port:0})`; and expose the created `saleItemId`.

Add these exact behaviors as separate `test()` blocks:

```text
- unauthenticated POST /api/v1/auth/authorize => 401
- cashier session + wrong manager password => 401
- cashier session + correct cashier2 password => 403
- cashier session + manager credentials + OPEN/nonexistent sale => 400 or 404, with no token
- cashier session + manager credentials + completed sale => 200 and authorizedBy.role === 'manager'
- cashier POST /api/v1/returns without approvalToken => 403
- cashier + valid approval => 201, operatorId === 'cashier1', authorizedById === 'manager1'
- reuse same approval with mutation id `return-second` => 403
- approval issued by one cashier session cannot be used by a second cashier session => 403
- approval issued for sale1 cannot be used with another completed sale id => 403
- manager session can POST /api/v1/returns without approvalToken => 201
- repeat the same successful cashier request with the same `x-mutation-id` => same cached success response and no second return row
```

For each return request send concrete payload:

```js
{
  saleId:'sale1',
  reason:'Cliente devolveu uma unidade',
  items:[{saleItemId,quantity:1}],
  refunds:[{method:'CASH',amountCents:1000}],
  approvalToken
}
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/returns-authorization-api.test.js
```

Expected: FAIL because authorization endpoint/store wiring does not exist and cashier is currently forbidden from return creation.

- [ ] **Step 3: Implement `server/return-authorization-router.js`**

Create a focused boolean handler. Use local helpers equivalent to `auth-session-router.js` for Bearer parsing and JSON response, plus bounded JSON parsing. Core request logic must be:

```js
const token = bearer(request);
const session = sessionStore.get(token);
if (!session || session.expiresAt <= Date.now()) return sendError(response, 401, 'Sessao invalida ou expirada.');
const body = await readJson(request, bodyLimitBytes);
if (body.scope !== 'return.complete') return sendError(response, 400, 'Escopo de autorizacao invalido.');
const saleId = String(body.resource?.saleId || '').trim();
if (!saleId) return sendError(response, 400, 'Venda obrigatoria para autorizacao.');
const requestedTerminal = body.resource?.terminalId == null ? null : String(body.resource.terminalId);
const sessionTerminal = session.terminalId == null ? null : String(session.terminalId);
if (requestedTerminal !== sessionTerminal) return sendError(response, 403, 'Terminal da autorizacao divergente.');
const sale = runtime.sales.getSale(saleId);
if (!sale || sale.status !== 'COMPLETED') return sendError(response, 400, 'Somente venda concluida pode ser autorizada para devolucao.');
const auth = runtime.catalog.verifyUserPassword(body.username, body.password);
if (!auth.ok) return sendError(response, 401, 'Usuario ou senha invalidos.');
if (!['manager','admin'].includes(auth.user.role)) return sendError(response, 403, 'Autorizacao de gerente necessaria para devolucao.');
const issued = approvalStore.issue({
  requesterSessionToken:token,
  requesterUserId:session.userId,
  terminalId:session.terminalId || null,
  saleId,
  authorizedBy:{userId:auth.user.id,role:auth.user.role,name:auth.user.name}
});
sendJson(response, 200, {
  approvalToken:issued.approvalToken,
  authorizedBy:{id:issued.authorizedBy.userId,name:issued.authorizedBy.name,role:issued.authorizedBy.role},
  expiresAt:issued.expiresAt
});
return true;
```

Do not pass password or approval token to logger/audit calls.

- [ ] **Step 4: Wire shared store in `server/local-server.js`**

Add imports and instantiate exactly once per server:

```js
const { createReturnApprovalStore }=require('./return-approval-store');
const { createReturnAuthorizationRouter }=require('./return-authorization-router');
```

Inside `createLocalServer()`:

```js
const sessionStore=new Map();
const returnApprovalStore=createReturnApprovalStore({ttlMs:120_000});
const authSessionHandler=createAuthSessionRouter({runtime,sessionStore,requireTerminalAuth});
const returnAuthorizationHandler=createReturnAuthorizationRouter({runtime,sessionStore,approvalStore:returnApprovalStore,bodyLimitBytes});
const handler=createRouter({runtime,installationToken:token,bodyLimitBytes,allowedOrigins,requireTerminalAuth,sessionStore,returnApprovalStore});
```

In `route()`, invoke `returnAuthorizationHandler` immediately after `authSessionHandler`.

- [ ] **Step 5: Extend `POST /api/v1/returns` in `server/router.js`**

Add `returnApprovalStore=null` to `createRouter()` options. For return creation, use:

```js
if(request.method==='POST'&&pathname==='/api/v1/returns'){
  requireRole(session,['admin','manager','cashier']);
  const body=await readJson(request,bodyLimitBytes);
  const result=await mutation(request,pathname,201,async mid=>{
    let authorizedBy=currentActor;
    if(session.role==='cashier'){
      if(!returnApprovalStore)throw new HttpError(503,'Servico de autorizacao de devolucao indisponivel.');
      try{
        authorizedBy=returnApprovalStore.consume(body.approvalToken,{
          requesterSessionToken:bearer(request),
          requesterUserId:session.userId,
          terminalId:session.terminalId||body.terminalId||null,
          saleId:body.saleId,
          scope:'return.complete'
        });
      }catch(error){throw new HttpError(403,error.message);}
    }
    const { approvalToken, authorizedBy:ignoredAuthorizer, ...returnBody }=body;
    const ret=runtime.returns.createReturn({
      ...returnBody,
      terminalId:session.terminalId||returnBody.terminalId,
      operatorId:session.userId,
      actor:currentActor,
      authorizedBy,
      mutationId:mid
    });
    const dispatchResult=await dispatch();
    return{return:ret,dispatch:dispatchResult};
  });
  sendJson(response,result.statusCode,result.payload,request,allowedOrigins);
  return;
}
```

This explicitly discards any client-supplied `authorizedBy` field.

- [ ] **Step 6: Add the API client method**

In `desktop/renderer/api-client.js` directly before the return methods:

```js
authorizeReturn({ username, password, saleId, terminalId }) {
  return this.request('/api/v1/auth/authorize', {
    method:'POST',
    body:{username,password,scope:'return.complete',resource:{saleId,terminalId}}
  });
}
```

- [ ] **Step 7: Add syntax coverage**

Add `node --check server/return-authorization-router.js` to `lint:core` beside `return-approval-store.js`.

- [ ] **Step 8: Run GREEN API checks**

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

### Task 4: Desktop `renderReturns()` workflow

**Files:**
- Modify: `desktop/renderer/operational-pages.js`
- Modify: `desktop/renderer/operational-pages.css`
- Create: `test/returns-desktop-ui.test.js`

**Interfaces:**
- Consumes `currentSession`, `salesHistory`, `saleDetails`, `returns`, `authorizeReturn`, `createReturn`.
- Stable selectors: `#ops-return-search`, `#ops-return-results`, `[data-return-sale-select]`, `#ops-return-selected-sale`, `[data-return-item]`, `[data-return-qty]`, `#ops-return-method`, `#ops-return-reason`, `#ops-return-total`, `#ops-return-authorize`, `#ops-return-authorization`, `#ops-return-submit`, `#ops-return-history`.

- [ ] **Step 1: Write RED UI contract tests**

Create `test/returns-desktop-ui.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..','desktop','renderer');
const operational = fs.readFileSync(path.join(root,'operational-pages.js'),'utf8');
const api = fs.readFileSync(path.join(root,'api-client.js'),'utf8');
const css = fs.readFileSync(path.join(root,'operational-pages.css'),'utf8');

test('returns desktop exposes search selection refund authorization and history markers',()=>{
  for(const marker of ['ops-return-search','ops-return-results','data-return-sale-select','ops-return-selected-sale','data-return-item','data-return-qty','ops-return-method','ops-return-reason','ops-return-total','ops-return-authorize','ops-return-authorization','ops-return-submit','ops-return-history']) assert.match(operational,new RegExp(marker));
  assert.match(api,/authorizeReturn\s*\(/);
  assert.match(operational,/salesHistory\(\{[^}]*status:\s*'COMPLETED'/);
  assert.match(operational,/api\.returns\(\{saleId/);
});

test('returns desktop rounds selected line cents like the domain',()=>{
  assert.match(operational,/Math\.round\(Number\([^)]*unitPriceCents[^)]*\)\s*\*\s*quantity\)/);
});

test('returns desktop has namespaced layout styles',()=>{
  assert.match(css,/\.ops-returns-layout/);
  assert.match(css,/\.ops-return-search-results/);
  assert.match(css,/\.ops-return-summary/);
  assert.match(css,/\.ops-return-auth-panel/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/returns-desktop-ui.test.js
```

Expected: FAIL on new selectors/styles.

- [ ] **Step 3: Render page shell and state**

At the start of `renderReturns()` load session and recent returns:

```js
await ready();
const [session, rows]=await Promise.all([api.currentSession(),api.returns()]);
const state={session,selectedSale:null,saleReturns:[],approvalToken:'',authorizedBy:null};
```

Render a two-column `.ops-returns-layout`: new return on the left, `#ops-return-history` on the right. The new-return card contains search form/input, results container, selected-sale container, method/reason controls, authorization area, total, and submit button.

- [ ] **Step 4: Implement completed-sale search**

On search form submit:

```js
const query=String(new FormData(event.currentTarget).get('query')||'').trim();
const sales=await api.salesHistory({status:'COMPLETED',query,limit:50});
```

Render each result as `.ops-return-sale-result` with sale number/id, completion time, customer, seller/operator, total, and button `data-return-sale-select="<saleId>"`.

- [ ] **Step 5: Select sale and compute remaining refundable quantity**

On result selection:

```js
state.approvalToken='';
state.authorizedBy=null;
const saleId=button.dataset.returnSaleSelect;
const [sale,returns]=await Promise.all([api.saleDetails(saleId),api.returns({saleId})]);
state.selectedSale=sale;
state.saleReturns=returns.filter(row=>row.status==='COMPLETED');
```

For each sale item:

```js
const returned=state.saleReturns.flatMap(row=>row.items||[])
  .filter(row=>row.saleItemId===item.id)
  .reduce((sum,row)=>sum+Number(row.quantity||0),0);
const available=Math.max(0,Number(item.quantity||0)-returned);
```

Render sold, returned, available, original unit price, checkbox `[data-return-item]`, and quantity input `[data-return-qty]` with `max=available`. Disable rows with `available<=0`.

- [ ] **Step 6: Calculate refund using domain-equivalent cents rounding**

Create a local `selectedReturn()` helper inside `renderReturns()` that reads checked rows:

```js
function selectedReturn(){
  const items=[];
  let totalCents=0;
  content.querySelectorAll('[data-return-item]:checked').forEach(check=>{
    const saleItemId=check.dataset.returnItem;
    const item=state.selectedSale.items.find(row=>row.id===saleItemId);
    const input=content.querySelector(`[data-return-qty="${CSS.escape(saleItemId)}"]`);
    const quantity=Number(input?.value||0);
    const max=Number(input?.max||0);
    if(!(quantity>0)||quantity>max)throw new Error('Quantidade devolvida invalida.');
    totalCents+=Math.round(Number(item.unitPriceCents||0)*quantity);
    items.push({saleItemId,quantity});
  });
  return{items,totalCents};
}
```

Use it to refresh `#ops-return-total` after checkbox/quantity changes and immediately before submit.

- [ ] **Step 7: Implement delegated authorization UI**

For manager/admin session, show current user as already authorized and do not require a secondary credential prompt.

For cashier session, `#ops-return-authorize` reveals `#ops-return-authorization` with username/password fields. On authorization submit:

```js
const approval=await api.authorizeReturn({
  username:String(form.get('username')||''),
  password:String(form.get('password')||''),
  saleId:state.selectedSale.id,
  terminalId:state.session.terminalId
});
state.approvalToken=approval.approvalToken;
state.authorizedBy=approval.authorizedBy;
event.currentTarget.elements.password.value='';
```

Never assign the password to `state`, storage, dataset, toast, or history HTML.

- [ ] **Step 8: Submit and invalidate stale approval**

On `#ops-return-submit`:

```js
const {items,totalCents}=selectedReturn();
if(!items.length)throw new Error('Selecione ao menos um item.');
const reason=document.getElementById('ops-return-reason').value.trim();
if(!reason)throw new Error('Informe o motivo da devolucao.');
if(state.session.user.role==='cashier'&&!state.approvalToken)throw new Error('Autorizacao de gerente necessaria para devolucao.');
const method=document.getElementById('ops-return-method').value;
await api.createReturn({
  saleId:state.selectedSale.id,
  items,
  refunds:[{method,amountCents:totalCents}],
  reason,
  ...(state.approvalToken?{approvalToken:state.approvalToken}:{})
});
showToast(`Devolucao concluida: ${money(totalCents)}.`,'success');
await renderReturns();
```

In the submit catch block always set:

```js
state.approvalToken='';
state.authorizedBy=null;
```

Selecting another sale performs the same invalidation before loading details.

- [ ] **Step 9: Add namespaced CSS**

Append to `operational-pages.css`:

```css
.ops-returns-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.75fr);gap:18px}
.ops-return-search-results{display:grid;gap:8px;max-height:260px;overflow:auto}
.ops-return-sale-result{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid #e5e9f1;border-radius:12px}
.ops-return-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.ops-return-auth-panel{margin-top:14px;padding:14px;border:1px solid #e5e9f1;border-radius:12px;background:#fafbfe}
.ops-returns-layout .ops-return-item{grid-template-columns:auto minmax(160px,1fr) repeat(4,minmax(70px,auto)) 90px}
@media(max-width:1100px){.ops-returns-layout{grid-template-columns:1fr}.ops-return-summary{grid-template-columns:1fr}.ops-returns-layout .ops-return-item{grid-template-columns:auto minmax(120px,1fr) 90px}}
```

- [ ] **Step 10: Run GREEN UI regressions**

```bash
node --test test/returns-desktop-ui.test.js test/e15-returns-history.test.js test/returns-authorization-api.test.js test/operational-route-stability.test.js test/e13-e20-api-ui.test.js
node --check desktop/renderer/operational-pages.js
node --check desktop/renderer/api-client.js
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

```bash
git add desktop/renderer/operational-pages.js desktop/renderer/operational-pages.css test/returns-desktop-ui.test.js
git commit -m "feat: complete desktop returns workflow"
```

---

### Task 5: Dedicated ArtiSys QA E2E

**Files:**
- Create: `qa/flows/returns-desktop-e2e.json`
- Modify: `qa/artisys-qa.config.json`
- Modify: `test/returns-desktop-ui.test.js`

**Interfaces:**
- Produces flow id `returns-desktop-e2e`.
- Uses stable selectors from Task 4.

- [ ] **Step 1: Add RED QA registration assertions**

Append to `test/returns-desktop-ui.test.js`:

```js
test('returns desktop e2e is registered as full and release critical flow',()=>{
  const qa=JSON.parse(fs.readFileSync(path.join(__dirname,'..','qa','artisys-qa.config.json'),'utf8'));
  assert.equal(qa.flows['returns-desktop-e2e'],'flows/returns-desktop-e2e.json');
  assert.ok(qa.qaProfiles.full.flows.includes('returns-desktop-e2e'));
  assert.ok(qa.qaProfiles.full.criticalFlows.includes('returns-desktop-e2e'));
  assert.ok(qa.qaProfiles.release.flows.includes('returns-desktop-e2e'));
  assert.ok(qa.qaProfiles.release.criticalFlows.includes('returns-desktop-e2e'));
});
```

Run:

```bash
node --test test/returns-desktop-ui.test.js
```

Expected: FAIL because the flow is not registered.

- [ ] **Step 2: Create `qa/flows/returns-desktop-e2e.json`**

Build one JSON object with `name:"returns-desktop-e2e"` and a `steps` array using only existing QA actions. The steps are fixed in this order:

```text
waitFor #setup-form
fill setup name = QA Administrador
fill setup username = qaadmin
fill setup password = QaLocalOnly-12345!
submit setup
waitFor #login-form
login qaadmin / QaLocalOnly-12345!
waitFor #auth-overlay hidden
open Sellers
click #new-seller
fill seller name = QA Caixa
fill seller username = qacaixa
choose role cashier
fill seller password = QaCashierOnly-12345!
submit seller
open Products
create product QA Produto Devolucao, SKU QA-RET-001, price 10,00, cost 5,00, stock control unchecked
open Checkout
add QA Produto Devolucao
set item quantity to 2 using the current cart quantity control
finalize sale
open cash with 0,00 if prompted
confirm payment
navigate home
logout using the current logout control
login qacaixa / QaCashierOnly-12345!
open Returns
fill #ops-return-search with QA Produto Devolucao or the sale identifier exposed by results
submit search
waitFor [data-return-sale-select]
click first [data-return-sale-select]
waitFor #ops-return-selected-sale
assert selected sale text contains QA Produto Devolucao and available quantity 2
check [data-return-item]
fill [data-return-qty] with 1
assert #ops-return-total contains 10,00
select CASH in #ops-return-method
fill #ops-return-reason with QA devolucao parcial autorizada
click #ops-return-authorize
submit qaadmin with an intentionally wrong password first
assert toast/error contains Usuario ou senha invalidos
submit qaadmin / QaLocalOnly-12345!
assert #ops-return-authorization shows QA Administrador or authorized state
click #ops-return-submit
wait for history refresh
assert #ops-return-history contains 10,00 and COMPLETED
search/select same sale again
assert selected sale/item text contains available quantity 1
screenshot full page named returns-desktop-complete
```

When translating that sequence to JSON, use the same escaped password style already used by `sales-enhancements-v2.json`; do not store any production credential. Use `press`/`click` for select/quantity controls only according to the actual selectors present after Task 4; do not introduce arbitrary waits when `waitFor` can observe a deterministic state.

- [ ] **Step 3: Register the flow**

In `qa/artisys-qa.config.json` add:

```json
"returns-desktop-e2e": "flows/returns-desktop-e2e.json"
```

Add `returns-desktop-e2e` to `full.flows`, `full.criticalFlows`, `release.flows`, and `release.criticalFlows`. Do not add it to `quick`.

- [ ] **Step 4: Validate config and run the dedicated flow**

```bash
npm run qa:validate
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
```

Expected: both PASS. The final screenshot must show the completed partial return and remaining refundable quantity 1.

- [ ] **Step 5: Re-run the UI registration test**

```bash
node --test test/returns-desktop-ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add qa/flows/returns-desktop-e2e.json qa/artisys-qa.config.json test/returns-desktop-ui.test.js
git commit -m "test: cover complete desktop return flow"
```

---

### Task 6: Full verification and PR

**Files:**
- No planned production files beyond Tasks 1–5.

**Interfaces:**
- Produces verified branch `feat/returns-desktop-ui` and an open PR against `main`.

- [ ] **Step 1: Run targeted return/security suite**

```bash
node --test test/return-approval-store.test.js test/e15-returns-history.test.js test/historical-cost-snapshot.test.js test/returns-authorization-api.test.js test/returns-desktop-ui.test.js test/e13-e20-api-ui.test.js test/operational-route-stability.test.js
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

```bash
npm run verify
```

Expected: PASS.

- [ ] **Step 3: Re-run final E2E on branch head**

```bash
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
```

Expected: PASS.

- [ ] **Step 4: Review `main...HEAD` for security and scope**

Confirm all six statements directly from the diff:

```text
1. No manager password or approval token is persisted/logged/audited.
2. No paid/external dependency was added.
3. `cancelReturn()` remains manager/admin-only.
4. No code mutates the original completed sale during a return.
5. New server files are included in `lint:core`.
6. QA flow is registered in full/release critical profiles.
```

If a branch-created defect is found, add a reproducing test first, run it RED, apply the smallest fix, rerun GREEN, then commit only those files with:

```bash
git commit -m "fix: harden desktop return flow"
```

- [ ] **Step 5: Open PR without merging**

Open `feat/returns-desktop-ui` → `main` with title:

```text
feat: complete desktop returns workflow
```

Use this body:

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

Leave the verified PR open for review; do not merge unless explicitly requested.
