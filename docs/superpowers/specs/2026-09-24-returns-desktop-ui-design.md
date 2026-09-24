# Desktop Returns UI Design

**Date:** 2026-09-24  
**Branch:** `feat/returns-desktop-ui`  
**Scope:** Desktop return flow from completed-sale lookup through item selection, refund, manager authorization, persistence, and end-to-end verification.

## Goal

Turn the existing returns page into a complete POS workflow that lets an operator locate a completed sale, select refundable quantities, choose the refund method, provide a reason, obtain manager/admin authorization when required, complete the return, and immediately see the resulting transaction in history.

The original sale remains immutable. A return is stored as its own transaction and continues to drive the existing idempotent inventory, cash, commission, audit, and outbox effects.

## Constraints

- Core implementation remains local/self-hosted and requires no paid external service.
- Reuse the existing Electron renderer, local HTTP API, SQLite runtime, authentication, event/outbox, and ArtiSys QA/Playwright stack.
- No external identity or authorization provider is introduced.
- Existing `/api/v1/returns` behavior for manager/admin sessions remains compatible.
- The backend remains authoritative for refund totals, refundable quantities, sale status, authorization, and mutation idempotency.
- Passwords used for delegated authorization are never persisted, logged, returned after validation, or embedded in audit payloads.

## Current State

The repository already contains:

- `renderReturns()` in `desktop/renderer/operational-pages.js` with manual sale-ID entry, item checkboxes, one refund method, reason, and submit;
- `ApiClient.returns()`, `returnDetails()`, `createReturn()`, and `cancelReturn()`;
- `/api/v1/returns` routes;
- `return-service.js`, which validates manager/admin actors, sale status, refundable quantities, and refund totals;
- domain tests for partial/total returns, over-return rejection, immutable sales, cost snapshots, and effects;
- ArtiSys QA/Playwright flows and runtime.

The UX gaps are sale discovery, refund review, delegated authorization for a cashier-operated flow, visibility into previously returned quantities, and a complete desktop E2E scenario.

## User Flow

### 1. Open Returns

The user opens the existing `returns` operational route; `F11` remains valid. The page uses two desktop columns:

- main column: new-return workflow;
- secondary column: recent return history.

### 2. Search completed sales

The raw sale-ID field is replaced by a sale search field and result list.

The renderer calls:

```text
GET /api/v1/sales/history?status=COMPLETED&query=<text>&limit=25
```

Search follows the existing sales-history semantics. Each result shows sale number, completion date/time, customer, seller/operator, total, and a select action.

### 3. Load sale and refundable balances

After selection, the renderer loads in parallel:

```text
GET /api/v1/sales/:id/details
GET /api/v1/returns?saleId=:id
```

For each sale item the UI derives a display balance from completed returns:

```text
available = sold quantity - completed returned quantity
```

The backend independently recomputes availability during creation.

Each item row shows product name, sold quantity, already-returned quantity, available quantity, original-sale unit price, editable return quantity, line subtotal, and selection control. Rows with zero availability are disabled.

Changing the selected sale clears every item selection, refund draft, reason, and delegated approval token.

### 4. Build refund

The page shows a live summary with selected item count, total quantity, return total, refund method, and refund amount.

The desktop UI sends exactly one refund line whose amount equals the selected return total. The exposed methods are `CASH`, `PIX`, `DEBIT_CARD`, `CREDIT_CARD`, and `STORE_CREDIT`. The domain remains capable of validating multiple refund lines, but split refunds are outside this UI scope.

### 5. Reason

A non-empty reason is mandatory. The renderer validates it before submission and the service validates it again.

### 6. Authorization

Returns support two authorization modes.

#### Manager/admin session

A logged-in manager/admin self-authorizes the return. `authorizedById` is the current authenticated manager/admin user.

#### Cashier/operator session

The operator prepares the return but cannot complete it without delegated approval. The UI opens an authorization dialog asking for a manager/admin username and password and posts them once to the local server.

The new endpoint is:

```text
POST /api/v1/auth/authorize
Authorization: Bearer <operator session>

{
  "username": "...",
  "password": "...",
  "scope": "return.complete",
  "resource": {
    "saleId": "...",
    "terminalId": "..."
  }
}
```

On success the server returns an opaque one-time approval token plus non-secret approver metadata:

```json
{
  "approvalToken": "opaque-random-value",
  "authorizedBy": {
    "id": "manager-id",
    "name": "Manager Name",
    "role": "manager"
  },
  "expiresAt": "..."
}
```

The approval record exists only in server memory and stores approver ID/role, requesting session token identity, requesting user ID, terminal ID, scope, sale ID, and expiration. The TTL is exactly 120 seconds. Tokens are generated from cryptographically secure random bytes, are single-use, and are bound to the requesting session, terminal, scope `return.complete`, and selected sale ID.

### 7. Complete return

`POST /api/v1/returns` accepts two authorization paths:

1. caller session role is `manager` or `admin`; or
2. caller is another authenticated operational role and supplies a valid delegated `approvalToken`.

For delegated approval, the router validates token binding and expiration and removes the token from the approval store immediately before invoking the domain operation. A domain failure therefore requires a new manager approval before retrying.

The router passes separate execution and authorization identities:

```text
operatorId    = current authenticated session user
authorizedBy = validated manager/admin identity
actor         = current authenticated session actor
```

For self-authorization, `authorizedBy` is derived from the current manager/admin session.

The return service accepts a trusted `authorizedBy` object and validates that its role is `manager` or `admin`. For backwards-compatible direct runtime calls, when `authorizedBy` is omitted and `actor.role` is manager/admin, the service treats `actor` as the authorizer. A cashier actor without explicit `authorizedBy` is rejected.

The renderer cannot set `authorizedById` directly.

### 8. Success state

After successful creation the UI:

- shows a success toast with return ID and total;
- clears the draft;
- refreshes recent return history;
- keeps the returns route active;
- shows operator and authorizer identities in the recent-return row/detail.

## Authorization Security Model

The authorization endpoint uses the existing local user store and password verifier.

Rules:

- the requesting user must already have a valid authenticated session;
- only active `manager` or `admin` credentials issue approval;
- password exists only for the duration of request processing;
- password is never stored in the approval record, audit log, application log, or response;
- approval token is opaque, random, expires after 120 seconds, and is single-use;
- approval is bound to session, user, terminal, sale, and scope;
- switching sales clears the renderer-held approval;
- invalid, expired, mismatched, or consumed approval cannot create a return;
- server restart invalidates outstanding approvals by design.

## API Changes

### New endpoint

```text
POST /api/v1/auth/authorize
```

Purpose: verify a local manager/admin credential and issue a scoped, one-time approval for `return.complete`.

### Extended endpoint

```text
POST /api/v1/returns
```

The request gains optional:

```json
{
  "approvalToken": "..."
}
```

Manager/admin callers do not need it. Cashier/operator callers do.

No external network service is required.

## Domain Changes

`js/domains/returns/return-service.js` continues to own business invariants:

- completed sale required;
- at least one return item;
- no duplicate sale item IDs;
- positive quantity;
- quantity cannot exceed remaining refundable quantity;
- refund total equals return total;
- valid refund method;
- non-empty reason;
- immutable original sale;
- audit/outbox/effect semantics remain unchanged.

Authorization becomes explicit:

```js
{
  actor,
  authorizedBy: { userId, role },
  ...returnInput
}
```

The service persists `authorized_by_id` from `authorizedBy.userId`; `operator_id` remains the authenticated operator executing the operation.

## Renderer Design

`renderReturns()` remains the route entry point and is restructured into focused helpers inside `desktop/renderer/operational-pages.js` unless extraction is necessary to keep the file testable and readable. The required responsibilities are sale search/results, selected-sale summary, refundable-item rendering, live totals, refund/reason state, delegated authorization, submit, and recent-return history.

Stable selectors are added for E2E/contract coverage. Styling changes go in `desktop/renderer/operational-pages.css` and reuse existing `ops-*` conventions; no UI framework or new paid dependency is introduced.

## Error Handling

The UI handles and surfaces:

- no completed sale found;
- sale no longer exists or is no longer completed;
- no refundable items remain;
- no items selected;
- invalid or excessive quantity;
- missing reason;
- invalid manager credentials;
- approver not manager/admin;
- expired, consumed, or mismatched approval;
- concurrent return reducing availability before submit;
- refund/business-rule rejection from the server;
- server/network failure.

The server remains the final authority for race conditions and business rules.

## Testing Strategy

### Domain tests

Extend return tests to verify:

- explicit `authorizedBy` is persisted separately from `operatorId`;
- cashier actor + manager authorization succeeds;
- non-manager authorization is rejected;
- manager/admin actor without explicit `authorizedBy` remains self-authorized for backwards compatibility;
- existing over-return, refund mismatch, immutable-sale, effect, and historical-cost tests stay green.

### API tests

Add coverage proving:

- `/api/v1/auth/authorize` requires an authenticated requesting session;
- valid local manager/admin credentials issue approval;
- cashier completes a return with valid approval;
- cashier cannot complete without approval;
- wrong credentials fail;
- non-manager approver fails;
- approval expires after 120 seconds;
- approval cannot be reused;
- approval bound to another sale, terminal, session, or user fails;
- manager/admin direct return remains valid;
- credentials do not appear in returned/logged/audited data checked by the test surface.

### Renderer/contract tests

Assert stable selectors/markers for sale search, result selection, selected sale, refundable item rows, quantity inputs, refund method, reason, authorization dialog/action, submit action, success state, and recent return history.

### End-to-end

Create:

```text
qa/flows/returns-desktop-e2e.json
```

Primary scenario:

1. launch with deterministic fixture data;
2. log in as cashier/operator;
3. open Returns;
4. search for a completed sale;
5. select it;
6. select one item and a partial quantity;
7. assert displayed total;
8. choose refund method;
9. enter reason;
10. request authorization;
11. authenticate manager/admin;
12. complete return;
13. assert success;
14. assert history shows the return plus operator/authorizer;
15. reload/reselect the sale and assert remaining refundable quantity decreased.

Invalid authorization and excessive quantity are covered at API/domain level so the full E2E remains focused on the complete successful customer workflow.

## Files Expected to Change

Primary:

- `desktop/renderer/operational-pages.js`
- `desktop/renderer/operational-pages.css`
- `desktop/renderer/api-client.js`
- `server/router.js`
- `js/domains/returns/return-service.js`
- return/API/UI contract tests under `test/`
- `qa/flows/returns-desktop-e2e.json`
- `qa/artisys-qa.config.json` if the current QA runner requires explicit flow registration.

A small server-side authorization helper/store file may be added if keeping the approval lifecycle in `server/router.js` would materially reduce readability or isolated testability. It must remain in-memory and dependency-free.

## Non-Goals

- changing the immutable-sale model;
- refund gateway integration or automatic provider reversal;
- cloud authorization service;
- multi-level approval chains;
- split/multiple refund methods in this desktop UI;
- changing inventory/cash event semantics beyond existing return effects;
- redesigning unrelated operational pages.

## Acceptance Criteria

The work is complete when:

- `renderReturns()` provides completed-sale search without requiring an internal sale ID;
- a sale can be selected and its remaining refundable quantities are visible;
- partial and total item selection is supported up to remaining availability;
- the refund total uses original-sale prices;
- reason is mandatory;
- manager/admin self-authorization works;
- cashier/operator completion requires a local scoped manager/admin authorization;
- operator and authorizer identities are persisted and displayed distinctly;
- delegated authorization is 120-second, single-use, local, bound to the operation, and free of paid/external dependencies;
- successful return preserves existing inventory/cash/commission/outbox behavior;
- the original sale remains unchanged;
- domain/API/renderer contract tests pass;
- `qa/flows/returns-desktop-e2e.json` proves the complete desktop flow;
- verified changes are opened as a PR from `feat/returns-desktop-ui` to `main`.