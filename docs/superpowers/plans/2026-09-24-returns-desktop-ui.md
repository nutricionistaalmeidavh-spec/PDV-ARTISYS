# Returns Desktop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the desktop returns workflow: completed-sale search, refundable-item selection, refund calculation, local manager/admin authorization for cashier returns, persistence, and full E2E verification.

**Architecture:** Preserve immutable completed sales and the existing return transaction/effects model. Add an in-memory approval store and local authorization router using the existing scrypt user store; the return API consumes a scoped one-time approval and passes separate operator/authorizer identities to the domain. Rebuild only `renderReturns()` plus namespaced operational CSS.

**Tech Stack:** Node.js >=22, `node:sqlite`/`DatabaseSync`, Electron 39, local `/api/v1`, `node:test`, ArtiSys QA/Playwright 1.63.0.

**Spec:** `docs/superpowers/specs/2026-09-24-returns-desktop-ui-design.md`

## Global Constraints

- Core is R$ 0, local/self-hosted, and has no paid/external dependency.
- Approval TTL is exactly `120000` ms, memory-only, single-use, scoped to `return.complete`, and bound to requester session/user + terminal + sale.
- Manager passwords are verified locally and never stored, logged, audited, or returned.
- Backend remains authoritative for sale status, refundable quantity, cents totals, authorization, and mutation idempotency.
- Manager/admin direct return creation remains compatible; `cancelReturn()` remains manager/admin-only.
- Do not refactor unrelated operational pages.

## File Structure

- Create `server/return-approval-store.js` — token lifecycle and binding.
- Create `server/return-authorization-router.js` — local manager/admin credential verification and approval issuance.
- Modify `server/local-server.js` — share one approval store with both routers.
- Modify `server/router.js` — consume approval for cashier return creation.
- Modify `js/domains/returns/return-service.js` — separate `operatorId` from `authorizedById`.
- Modify `desktop/renderer/api-client.js` — add `authorizeReturn()`.
- Modify `desktop/renderer/operational-pages.js` — complete returns UI flow.
- Modify `desktop/renderer/operational-pages.css` — returns layout/states.
- Create `test/return-approval-store.test.js`.
- Modify `test/e15-returns-history.test.js`.
- Create `test/returns-authorization-api.test.js`.
- Create `test/returns-desktop-ui.test.js`.
- Create `qa/flows/returns-desktop-e2e.json`.
- Modify `qa/artisys-qa.config.json` and `package.json`.

## Review Focus

1. Selecting another sale after approval clears the UI token; server binding rejects cross-sale use.
2. A concurrent return that consumes remaining quantity makes the stale return fail and forces fresh approval.
3. Approval replay with another mutation ID fails; same mutation-ID retry remains idempotent.
4. Correct credentials for cashier/inactive users do not produce approval.
5. Fractional quantities use `Math.round(unitPriceCents * quantity)` in both UI and domain.

---

### Task 1: Scoped approval store

**Files:** Create `server/return-approval-store.js`, `test/return-approval-store.test.js`; modify `package.json`.

**Interfaces:** `createReturnApprovalStore({now,randomBytesFn,ttlMs})`; `issue(binding)`; `consume(token,binding)`.

- [ ] **Step 1: Write RED store tests**

```js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReturnApprovalStore}=require('../server/return-approval-store');
function fixture(){let now=1000,seq=0;const store=createReturnApprovalStore({now:()=>now,ttlMs:120000,randomBytesFn:()=>Buffer.from(`approval-${++seq}`)});return{store,advance:ms=>{now+=ms;}};}
const base={requesterSessionToken:'session-cashier',requesterUserId:'cashier1',terminalId:'PDV-01',saleId:'sale1'};
const manager={userId:'manager1',role:'manager',name:'Gerente QA'};
test('approval is single use',()=>{const{store}=fixture();const issued=store.issue({...base,authorizedBy:manager});assert.deepEqual(store.consume(issued.approvalToken,{...base,scope:'return.complete'}),manager);assert.throws(()=>store.consume(issued.approvalToken,{...base,scope:'return.complete'}),/invalida|consumida/i);});
test('approval rejects another sale',()=>{const{store}=fixture();const issued=store.issue({...base,authorizedBy:manager});assert.throws(()=>store.consume(issued.approvalToken,{...base,saleId:'sale2',scope:'return.complete'}),/vinculo|escopo/i);});
test('approval rejects another session',()=>{const{store}=fixture();const issued=store.issue({...base,authorizedBy:manager});assert.throws(()=>store.consume(issued.approvalToken,{...base,requesterSessionToken:'other',scope:'return.complete'}),/vinculo|escopo/i);});
test('approval rejects another terminal',()=>{const{store}=fixture();const issued=store.issue({...base,authorizedBy:manager});assert.throws(()=>store.consume(issued.approvalToken,{...base,terminalId:'PDV-02',scope:'return.complete'}),/vinculo|escopo/i);});
test('approval expires after 120 seconds',()=>{const{store,advance}=fixture();const issued=store.issue({...base,authorizedBy:manager});advance(120001);assert.throws(()=>store.consume(issued.approvalToken,{...base,scope:'return.complete'}),/expirada/i);});
test('approval rejects cashier authorizer',()=>{const{store}=fixture();assert.throws(()=>store.issue({...base,authorizedBy:{userId:'cashier2',role:'cashier',name:'Caixa'}}),/gerente|autorizacao/i);});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/return-approval-store.test.js
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement store**

```js
'use strict';
const {randomBytes}=require('node:crypto');
function createReturnApprovalStore({now=()=>Date.now(),randomBytesFn=randomBytes,ttlMs=120000}={}){
  const approvals=new Map();const norm=value=>value==null?null:String(value);
  function issue({requesterSessionToken,requesterUserId,terminalId,saleId,authorizedBy}){
    if(!requesterSessionToken||!requesterUserId||!saleId)throw new Error('Dados da autorizacao incompletos.');
    if(!['manager','admin'].includes(String(authorizedBy?.role||'')))throw new Error('Autorizacao de gerente necessaria para devolucao.');
    const approvalToken=randomBytesFn(32).toString('hex');const expiresAtMs=now()+ttlMs;
    const identity={userId:String(authorizedBy.userId),role:String(authorizedBy.role),name:String(authorizedBy.name||'')};
    approvals.set(approvalToken,{requesterSessionToken:String(requesterSessionToken),requesterUserId:String(requesterUserId),terminalId:norm(terminalId),saleId:String(saleId),scope:'return.complete',authorizedBy:identity,expiresAtMs});
    return{approvalToken,authorizedBy:identity,expiresAt:new Date(expiresAtMs).toISOString()};
  }
  function consume(token,expected={}){
    const key=String(token||'');const approval=approvals.get(key);if(!approval)throw new Error('Autorizacao invalida ou ja consumida.');
    if(approval.expiresAtMs<=now()){approvals.delete(key);throw new Error('Autorizacao expirada.');}
    const matches=approval.requesterSessionToken===String(expected.requesterSessionToken||'')&&approval.requesterUserId===String(expected.requesterUserId||'')&&approval.terminalId===norm(expected.terminalId)&&approval.saleId===String(expected.saleId||'')&&approval.scope===String(expected.scope||'');
    if(!matches)throw new Error('Autorizacao nao corresponde ao vinculo ou escopo desta devolucao.');
    approvals.delete(key);return approval.authorizedBy;
  }
  return{issue,consume};
}
module.exports={createReturnApprovalStore};
```

- [ ] **Step 4: Verify GREEN and register syntax check**

```bash
node --test test/return-approval-store.test.js
node --check server/return-approval-store.js
```

Add `node --check server/return-approval-store.js` to `lint:core` beside the server checks.

- [ ] **Step 5: Commit**

```bash
git add server/return-approval-store.js test/return-approval-store.test.js package.json
git commit -m "feat: add scoped return approval store"
```

---

### Task 2: Separate operator and authorizer in the return domain

**Files:** Modify `js/domains/returns/return-service.js`, `test/e15-returns-history.test.js`.

**Interfaces:** trusted `input.authorizedBy={userId,role,name}`; self-authorization falls back to manager/admin `actor`.

- [ ] **Step 1: Write RED domain tests**

```js
function cashierActor(){return{userId:'cashier1',role:'cashier',terminalId:'PDV-01'};}
async function delegatedFixture(){let seq=100;const runtime=createPdvRuntime({now:()=>`2026-09-09T14:00:${String(seq++%60).padStart(2,'0')}Z`,idFactory:p=>`${p}-${seq++}`});seed(runtime);runtime.catalog.createUser({id:'cashier1',username:'caixa',name:'Caixa',role:'cashier',password:'senha-forte-123'});const sale=await completeSale(runtime);return{runtime,saleItemId:sale.items[0].id};}
test('return persists cashier operator and manager authorizer separately',async()=>{const{runtime,saleItemId}=await delegatedFixture();const created=runtime.returns.createReturn({saleId:'sale1',terminalId:'PDV-01',operatorId:'cashier1',reason:'Devolucao autorizada',items:[{saleItemId,quantity:1}],refunds:[{method:'CASH',amountCents:1000}],actor:cashierActor(),authorizedBy:{userId:'mgr',role:'manager',name:'Gerente'}});assert.equal(created.operatorId,'cashier1');assert.equal(created.authorizedById,'mgr');runtime.close();});
test('return rejects cashier as delegated authorizer',async()=>{const{runtime,saleItemId}=await delegatedFixture();assert.throws(()=>runtime.returns.createReturn({saleId:'sale1',terminalId:'PDV-01',operatorId:'cashier1',reason:'Autorizador invalido',items:[{saleItemId,quantity:1}],refunds:[{method:'CASH',amountCents:1000}],actor:cashierActor(),authorizedBy:{userId:'cashier2',role:'cashier',name:'Caixa 2'}}),/Autorizacao de gerente/i);runtime.close();});
```

Also assert `first.authorizedById === 'mgr'` in the existing manager partial-return test.

- [ ] **Step 2: Verify RED**

```bash
node --test test/e15-returns-history.test.js
```

Expected: delegated cashier test fails at current `assertManager(actor)`.

- [ ] **Step 3: Implement explicit authorizer resolution**

```js
function resolveAuthorizedBy(input,actor){const candidate=input.authorizedBy||actor;assertManager(candidate);const userId=String(candidate?.userId||'').trim();if(!userId)throw new Error('Identidade do autorizador e obrigatoria.');return{userId,role:String(candidate.role),name:String(candidate.name||'')};}
```

At `createReturn()` start use `const authorizedBy=resolveAuthorizedBy(input,actor);`; keep `operatorId` from `input.operatorId || actor.userId`; persist `authorized_by_id=authorizedBy.userId`. Add `authorizedById` to `return.completed` payload and audit context without changing existing item/refund keys. Leave `cancelReturn()` unchanged.

- [ ] **Step 4: Verify GREEN**

```bash
node --test test/e15-returns-history.test.js test/historical-cost-snapshot.test.js
```

- [ ] **Step 5: Commit**

```bash
git add js/domains/returns/return-service.js test/e15-returns-history.test.js
git commit -m "feat: separate return operator and authorizer"
```

---

### Task 3: Local manager authorization API

**Files:** Create `server/return-authorization-router.js`, `test/returns-authorization-api.test.js`; modify `server/local-server.js`, `server/router.js`, `desktop/renderer/api-client.js`, `package.json`.

**Interfaces:** `POST /api/v1/auth/authorize`; response `{approvalToken,authorizedBy:{id,name,role},expiresAt}`; cashier `POST /api/v1/returns` requires approval.

- [ ] **Step 1: Write RED API tests**

Create a real `createLocalServer()` fixture with manager `manager1`, cashiers `cashier1`/`cashier2`, product `p1` at 1000 cents, an open cash session, and completed `sale1` containing quantity 2. Add separate tests for: unauthenticated authorize=401; wrong manager password=401; correct cashier approver=403; missing/non-completed sale=no token; valid manager approval=200; cashier return without token=403; valid approval=201 with `operatorId='cashier1'` and `authorizedById='manager1'`; reused token with a different mutation id=403; token from another cashier session=403; token for another sale=403; manager direct return=201; repeated successful request with the same mutation id returns cached success and does not create a second return.

Use this exact return body in positive/replay cases:

```js
{saleId:'sale1',reason:'Cliente devolveu uma unidade',items:[{saleItemId,quantity:1}],refunds:[{method:'CASH',amountCents:1000}],approvalToken}
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/returns-authorization-api.test.js
```

Expected: authorize route absent and cashier return forbidden.

- [ ] **Step 3: Implement `server/return-authorization-router.js`**

Follow `auth-session-router.js` boolean-handler style. For `POST /api/v1/auth/authorize`: authenticate Bearer token from shared `sessionStore`; parse bounded JSON; require `scope==='return.complete'`; require `resource.saleId`; require `resource.terminalId` to equal `session.terminalId`; require `runtime.sales.getSale(saleId)?.status==='COMPLETED'`; call `runtime.catalog.verifyUserPassword(username,password)`; return 401 for invalid credentials; return 403 unless role is manager/admin; issue with `approvalStore.issue({requesterSessionToken:token,requesterUserId:session.userId,terminalId:session.terminalId,saleId,authorizedBy:{userId:auth.user.id,role:auth.user.role,name:auth.user.name}})`; respond 200 with token, `{id,name,role}`, expiry. Never pass password/token to logs or audit.

- [ ] **Step 4: Wire store/router in `local-server.js`**

```js
const {createReturnApprovalStore}=require('./return-approval-store');
const {createReturnAuthorizationRouter}=require('./return-authorization-router');
```

Create `returnApprovalStore=createReturnApprovalStore({ttlMs:120000})`; create `returnAuthorizationHandler` with runtime/sessionStore/store/bodyLimit; invoke it immediately after `authSessionHandler`; pass `returnApprovalStore` into `createRouter()`.

- [ ] **Step 5: Extend return creation in `server/router.js`**

Allow `['admin','manager','cashier']`. For cashier, inside the existing `mutation()` callback call:

```js
authorizedBy=returnApprovalStore.consume(body.approvalToken,{requesterSessionToken:bearer(request),requesterUserId:session.userId,terminalId:session.terminalId||body.terminalId||null,saleId:body.saleId,scope:'return.complete'});
```

Map consume errors to HTTP 403. Before calling the domain destructure and discard renderer-supplied `approvalToken` and `authorizedBy`; call `runtime.returns.createReturn({...returnBody,terminalId:session.terminalId||returnBody.terminalId,operatorId:session.userId,actor:currentActor,authorizedBy,mutationId:mid})`. Manager/admin set `authorizedBy=currentActor` and need no token.

- [ ] **Step 6: Add client method**

```js
authorizeReturn({username,password,saleId,terminalId}){return this.request('/api/v1/auth/authorize',{method:'POST',body:{username,password,scope:'return.complete',resource:{saleId,terminalId}}});}
```

- [ ] **Step 7: Register syntax and verify GREEN**

Add `node --check server/return-authorization-router.js` to `lint:core`, then run:

```bash
node --test test/return-approval-store.test.js test/e15-returns-history.test.js test/returns-authorization-api.test.js test/e13-e20-api-ui.test.js
node --check server/return-authorization-router.js
node --check server/local-server.js
node --check server/router.js
node --check desktop/renderer/api-client.js
```

- [ ] **Step 8: Commit**

```bash
git add server/return-authorization-router.js server/local-server.js server/router.js desktop/renderer/api-client.js test/returns-authorization-api.test.js package.json
git commit -m "feat: authorize cashier returns locally"
```

---

### Task 4: Complete desktop `renderReturns()`

**Files:** Modify `desktop/renderer/operational-pages.js`, `desktop/renderer/operational-pages.css`; create `test/returns-desktop-ui.test.js`.

**Stable selectors:** `#ops-return-search`, `#ops-return-results`, `[data-return-sale-select]`, `#ops-return-selected-sale`, `[data-return-item]`, `[data-return-qty]`, `#ops-return-method`, `#ops-return-reason`, `#ops-return-total`, `#ops-return-authorize`, `#ops-return-authorization`, `#ops-return-submit`, `#ops-return-history`.

- [ ] **Step 1: Write RED UI contract tests**

```js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..','desktop','renderer');const operational=fs.readFileSync(path.join(root,'operational-pages.js'),'utf8');const api=fs.readFileSync(path.join(root,'api-client.js'),'utf8');const css=fs.readFileSync(path.join(root,'operational-pages.css'),'utf8');
test('returns desktop exposes stable workflow markers',()=>{for(const marker of ['ops-return-search','ops-return-results','data-return-sale-select','ops-return-selected-sale','data-return-item','data-return-qty','ops-return-method','ops-return-reason','ops-return-total','ops-return-authorize','ops-return-authorization','ops-return-submit','ops-return-history'])assert.match(operational,new RegExp(marker));assert.match(api,/authorizeReturn\s*\(/);assert.match(operational,/salesHistory\(\{[^}]*status:\s*'COMPLETED'/);assert.match(operational,/api\.returns\(\{saleId/);});
test('returns desktop matches domain line rounding',()=>assert.match(operational,/Math\.round\(Number\([^)]*unitPriceCents[^)]*\)\s*\*\s*quantity\)/));
test('returns desktop styles are namespaced',()=>{for(const marker of ['ops-returns-layout','ops-return-search-results','ops-return-summary','ops-return-auth-panel'])assert.match(css,new RegExp(`\\.${marker}`));});
```

- [ ] **Step 2: Verify RED**

```bash
node --test test/returns-desktop-ui.test.js
```

- [ ] **Step 3: Render state/search/history shell**

Load `[session,rows]=await Promise.all([api.currentSession(),api.returns()])`; local state is `{session,selectedSale:null,saleReturns:[],approvalToken:'',authorizedBy:null}`. Render `.ops-returns-layout`; left card has search/form/workflow, right card is `#ops-return-history`. Search submit calls `api.salesHistory({status:'COMPLETED',query,limit:50})`; each result displays sale/date/customer/operator/total and button `data-return-sale-select`.

- [ ] **Step 4: Select sale and compute remaining quantity**

On selection clear approval, then `Promise.all([api.saleDetails(saleId),api.returns({saleId})])`. For each sale item compute completed returned quantity by summing matching `saleItemId`; `available=Math.max(0,sold-returned)`. Render literal labels `Vendido`, `Já devolvido`, `Disponível`, `Preço` and the stable checkbox/quantity selectors; disable zero-available rows.

- [ ] **Step 5: Calculate selected return**

Create local helper:

```js
function selectedReturn(){const items=[];let totalCents=0;content.querySelectorAll('[data-return-item]:checked').forEach(check=>{const saleItemId=check.dataset.returnItem;const item=state.selectedSale.items.find(row=>row.id===saleItemId);const input=content.querySelector(`[data-return-qty="${CSS.escape(saleItemId)}"]`);const quantity=Number(input?.value||0);const max=Number(input?.max||0);if(!(quantity>0)||quantity>max)throw new Error('Quantidade devolvida invalida.');totalCents+=Math.round(Number(item.unitPriceCents||0)*quantity);items.push({saleItemId,quantity});});return{items,totalCents};}
```

Update `#ops-return-total` on checkbox/quantity change and immediately before submit.

- [ ] **Step 6: Implement authorization UI**

Manager/admin session shows current user as authorized and does not require credentials. Cashier sees `#ops-return-authorize`; it reveals `#ops-return-authorization` with username/password. Submit to `api.authorizeReturn({username,password,saleId:state.selectedSale.id,terminalId:state.session.terminalId})`; store only `approvalToken`/`authorizedBy`; immediately blank password input. Selecting another sale clears token and authorizer.

- [ ] **Step 7: Submit return and clear stale approval on error**

Require selected sale, items, reason, method, and cashier approval. Submit `{saleId,items,refunds:[{method,amountCents:totalCents}],reason,approvalToken?}`. On success show `Devolução concluída` and rerender. On any create-return error set `state.approvalToken=''` and `state.authorizedBy=null` before showing the server message, so race failures require fresh authorization.

- [ ] **Step 8: Add CSS**

```css
.ops-returns-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,.75fr);gap:18px}.ops-return-search-results{display:grid;gap:8px;max-height:260px;overflow:auto}.ops-return-sale-result{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid #e5e9f1;border-radius:12px}.ops-return-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.ops-return-auth-panel{margin-top:14px;padding:14px;border:1px solid #e5e9f1;border-radius:12px;background:#fafbfe}@media(max-width:1100px){.ops-returns-layout{grid-template-columns:1fr}.ops-return-summary{grid-template-columns:1fr}}
```

- [ ] **Step 9: Verify GREEN and commit**

```bash
node --test test/returns-desktop-ui.test.js test/e15-returns-history.test.js test/returns-authorization-api.test.js test/operational-route-stability.test.js test/e13-e20-api-ui.test.js
node --check desktop/renderer/operational-pages.js
node --check desktop/renderer/api-client.js
git add desktop/renderer/operational-pages.js desktop/renderer/operational-pages.css test/returns-desktop-ui.test.js
git commit -m "feat: complete desktop returns workflow"
```

---

### Task 5: Full returns E2E

**Files:** Create `qa/flows/returns-desktop-e2e.json`; modify `qa/artisys-qa.config.json`, `test/returns-desktop-ui.test.js`.

- [ ] **Step 1: Add RED QA registration test**

```js
test('returns e2e is full and release critical',()=>{const qa=JSON.parse(fs.readFileSync(path.join(__dirname,'..','qa','artisys-qa.config.json'),'utf8'));assert.equal(qa.flows['returns-desktop-e2e'],'flows/returns-desktop-e2e.json');for(const profile of ['full','release']){assert.ok(qa.qaProfiles[profile].flows.includes('returns-desktop-e2e'));assert.ok(qa.qaProfiles[profile].criticalFlows.includes('returns-desktop-e2e'));}});
```

Run `node --test test/returns-desktop-ui.test.js` and confirm RED.

- [ ] **Step 2: Create exact QA flow sequence**

Create `qa/flows/returns-desktop-e2e.json` with `name:"returns-desktop-e2e"`. Use the same setup/login/product selectors already used by `sales-enhancements-v2.json`. Sequence:

```text
setup admin: QA Administrador / qaadmin / QaLocalOnly-12345!
login qaadmin
open [data-home-route='sellers']; create QA Caixa / qacaixa / QaCashierOnly-12345! (default seller role is cashier)
open [data-route='products']; create QA Produto Devolucao, SKU QA-RET-001, salePrice 10,00, cost 5,00; uncheck trackStock
open [data-route='checkout']; click .product-card:has-text('QA Produto Devolucao'); wait .cart-line; click [data-qty-plus] once so quantity becomes 2
click #finalize-sale; when #initial-cash appears fill 0,00 and click #confirm-open-cash; wait #confirm-payment and click it
execute {"action":"capability","name":"auth.logout"}
wait #login-form; login qacaixa / QaCashierOnly-12345!
open [data-home-route='returns']; wait #ops-return-search
fill #ops-return-search with QA Administrador; submit its containing form
wait [data-return-sale-select]; click first result; wait #ops-return-selected-sale
expect text #ops-return-selected-sale: QA Produto Devolucao; expect text: Disponível 2
check [data-return-item]; fill [data-return-qty] with 1; expect #ops-return-total contains 10,00
select CASH by pressing Home/Enter on #ops-return-method if CASH is already first; fill #ops-return-reason = QA devolucao parcial autorizada
click #ops-return-authorize; wait #ops-return-authorization
fill authorization username qaadmin; fill wrong password; submit; expect .toast contains Usuario ou senha invalidos
refill authorization username qaadmin and password QaLocalOnly-12345!; submit; expect #ops-return-authorization contains QA Administrador
click #ops-return-submit; wait #ops-return-history; expect #ops-return-history contains 10,00 and COMPLETED
fill #ops-return-search with QA Administrador; submit search again; click first [data-return-sale-select]; expect #ops-return-selected-sale contains Disponível 1
screenshot name returns-desktop-complete, fullPage true
```

Passwords in JSON use the same escaped-unicode style as existing QA flows; no production secrets/tokens are included.

- [ ] **Step 3: Register flow**

Add `"returns-desktop-e2e":"flows/returns-desktop-e2e.json"` and include its id in `full.flows`, `full.criticalFlows`, `release.flows`, `release.criticalFlows`; do not add to `quick`.

- [ ] **Step 4: Validate/run/commit**

```bash
npm run qa:validate
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
node --test test/returns-desktop-ui.test.js
git add qa/flows/returns-desktop-e2e.json qa/artisys-qa.config.json test/returns-desktop-ui.test.js
git commit -m "test: cover complete desktop return flow"
```

Expected: all PASS; final screenshot shows completed partial return and `Disponível 1`.

---

### Task 6: Final verification and PR

**Files:** no planned new scope.

- [ ] **Step 1: Run targeted suite**

```bash
node --test test/return-approval-store.test.js test/e15-returns-history.test.js test/historical-cost-snapshot.test.js test/returns-authorization-api.test.js test/returns-desktop-ui.test.js test/e13-e20-api-ui.test.js test/operational-route-stability.test.js
```

- [ ] **Step 2: Run repository verification and final E2E**

```bash
npm run verify
node qa/runtime/artisys-qa.mjs run --config qa/artisys-qa.config.json --flow returns-desktop-e2e --environment ci --viewport desktop --output qa-artifacts
```

- [ ] **Step 3: Inspect `main...HEAD`**

Confirm: no password/token persistence/logging; no paid/external dependency; `cancelReturn()` manager/admin-only; completed sale remains immutable; both new server files are in `lint:core`; E2E is full/release critical. Any branch-created defect gets a reproducing RED test before the smallest fix.

- [ ] **Step 4: Open PR, do not merge**

Title: `feat: complete desktop returns workflow`

Body:

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
