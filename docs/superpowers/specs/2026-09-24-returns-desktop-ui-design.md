# Desktop Returns UI Design

**Date:** 2026-09-24  
**Branch:** `feat/returns-desktop-ui`  
**Scope:** Desktop return flow from completed-sale lookup through item selection, refund, manager authorization, persistence, and end-to-end verification.

## Goal

Turn the existing returns page into a complete POS workflow that lets an operator locate a completed sale, select refundable quantities, choose the refund method, provide a reason, obtain manager/admin authorization when required, complete the return, and immediately see the resulting transaction in history.

The original sale remains immutable. A return is stored as its own transaction and continues to drive the existing idempotent inventory, cash, commission, audit, and outbox effects.

## Constraints

- Core implementation must remain local/self-hosted and require no paid external service.
- Reuse the existing Electron renderer, local HTTP API, SQLite runtime, authentication, event/outbox, and ArtiSys QA/Playwright stack.
- No external identity or authorization provider is introduced.
- Existing `/api/v1/returns` behavior for manager/admin sessions remains compatible.
- The backend remains authoritative for refund totals, refundable quantities, sale status, authorization, and mutation idempotency.
- Passwords used for delegated authorization must never be persisted, logged, returned to the renderer after validation, or embedded in audit payloads.

## Current State

The repository already contains:

- `renderReturns()` in `desktop/renderer/operational-pages.js` with manual sale-ID entry, item checkboxes, one refund method, reason, and submit;
- `ApiClient.returns()`, `returnDetails()`, `createReturn()`, and `cancelReturn()`;
- `/api/v1/returns` routes;
- `return-service.js`, which validates manager/admin actors, sale status, refundable quantities, and refund totals;
- domain tests for partial/total returns, over-return rejection, immutable sales, cost snapshots, and effects;
- ArtiSys QA/Playwright flows and runtime.

The main UX gaps are sale discovery, explicit refund review, explicit authorization for a cashier-operated flow, visibility into previously returned quantities, and a complete desktop E2E scenario.

## User Flow

### 1. Open Returns

The user opens the existing `returns` operational route (`F11` remains valid). The page shows two desktop columns:

- left/main: new-return workflow;
- right/secondary: recent return history.

### 2. Search completed sales

Replace raw sale-ID-only entry with a search field and result list.

The renderer calls:

```text
GET /api/v1/sales/history?status=COMPLETED&query=<text>&limit=<n>
```

Searchable information follows the existing sales-history semantics, including sale number, customer, seller/operator, or other indexed query data already supported by the sales service.

Each result shows at minimum:

- sale number;
- completion date/time;
- customer;
- seller/operator;
- total;
- action to select the sale.

Direct sale-ID entry may remain as a compatibility/fallback path, but it is not the primary desktop workflow.

### 3. Load sale and refundable balances

After selecting a sale, the renderer loads sale details and return history for that sale in parallel:

```text
GET /api/v1/sales/:id/details
GET /api/v1/returns?saleId=:id
```

For each sale item the UI computes a display-only returned quantity from completed returns and derives:

```text
available = sold quantity - completed returned quantity
```

The backend independently recomputes and validates availability when the return is created.

Each row shows:

- product name;
- quantity sold;
- quantity already returned;
- quantity available;
- unit price from the original sale snapshot;
- editable return quantity;
- line subtotal;
- selection control.

Rows with zero available quantity are disabled.

### 4. Build refund

The page shows a live summary:

- selected item count;
- total quantity;
- return total;
- refund method;
- refund amount.

For this scope, the UI submits one refund line whose amount equals the calculated return total. Supported methods remain the domain-supported methods exposed in the UI: `CASH`, `PIX`, `DEBIT_CARD`, `CREDIT_CARD`, and `STORE_CREDIT`.

The domain remains prepared to validate multiple refund lines even though this UI scope uses one line.

### 5. Reason

A non-empty reason is required before completion. The renderer provides inline validation, while the service remains the authoritative validator.

### 6. Authorization

Returns can be operated in two modes.

#### Manager/admin already logged in

The current session can authorize its own return. No secondary credential prompt is necessary. `authorizedById` is the current authenticated manager/admin user.

#### Cashier/operator logged in

The operator can prepare the return but cannot complete it without delegated approval.

The UI opens an authorization panel/dialog asking for a manager/admin username and password. Credentials are posted once to a local protected authorization endpoint.

Proposed endpoint:

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

On successful credential verification, the server returns an opaque one-time approval token and minimal non-secret approver metadata:

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

The approval is stored only in server memory and contains:

- approving user ID and role;
- requesting session/user ID;
- terminal ID;
- scope `return.complete`;
- sale ID;
- expiry;
- consumed flag or single-use deletion semantics.

The token has a short TTL (target: 2 minutes), is cryptographically random, is bound to the requesting session/terminal/sale/scope, and can be consumed only once.

### 7. Complete return

`POST /api/v1/returns` is extended to support two valid authorization paths:

1. caller session role is `manager` or `admin`; or
2. caller session is another allowed operational role and supplies a valid one-time approval token for this exact return scope/resource.

The renderer sends the approval token only when delegated approval was needed.

The router consumes and validates the approval before calling the return service. It passes separate identities:

```text
operatorId       = current authenticated session user
actor             = current authenticated session actor
authorizedById    = approving manager/admin user
```

For manager/admin self-authorization, `authorizedById` equals the current session user.

The service must no longer infer `authorizedById` exclusively from `actor.userId`; it accepts the validated authorization identity from the router/runtime boundary while still rejecting any untrusted direct attempt to forge authorization.

### 8. Success state

After successful creation:

- show success toast/message with return identifier and total;
- clear the draft workflow;
- refresh recent return history;
- keep the returns route active;
- show authorization identity in the returned transaction detail/history where practical.

## Authorization Security Model

The authorization endpoint uses the existing local user store and password verification function.

Rules:

- only active `manager` or `admin` users can approve;
- the requesting operator must already have a valid authenticated session;
- failed approval never creates a return;
- password is handled only during request processing;
- password is excluded from audit/log payloads;
- approval token is opaque, random, short-lived, single-use, and stored only in memory;
- approval token is bound to session, terminal, scope, and sale ID;
- changing the selected sale invalidates any approval held by the renderer;
- consuming or expiring a token removes it from the authorization store;
- restarting the local server invalidates outstanding approvals by design.

## API Changes

### New

```text
POST /api/v1/auth/authorize
```

Purpose: verify a local manager/admin credential and issue a scoped, one-time approval.

### Extended

```text
POST /api/v1/returns
```

Request gains optional:

```json
{
  "approvalToken": "..."
}
```

Manager/admin callers do not need this field. Cashier/operator callers require it.

No external network service is required.

## Domain Changes

`js/domains/returns/return-service.js` keeps ownership of business invariants:

- completed sale required;
- at least one return item;
- no duplicate sale item IDs;
- positive quantity;
- quantity cannot exceed remaining refundable quantity;
- refund total equals return total;
- valid refund method;
- non-empty reason;
- immutable original sale;
- audit/outbox/effects unchanged in principle.

Authorization is represented explicitly in the call contract rather than inferred from the operator identity.

The service should receive a trusted authorization context produced by the server layer, for example:

```js
{
  actor,
  authorizedBy: { userId, role },
  ...returnInput
}
```

The service validates `authorizedBy.role` as `manager` or `admin` and persists `authorized_by_id` from `authorizedBy.userId`.

This preserves direct runtime testability without making the renderer authoritative.

## Renderer Design

`renderReturns()` remains the route entry point but is restructured into focused helpers local to `operational-pages.js` unless file size/readability requires extraction.

Suggested responsibilities:

- render search/results;
- render selected sale summary;
- render refundable item rows;
- calculate selected totals;
- render refund/reason summary;
- request delegated authorization;
- submit return;
- render recent returns.

No unrelated operational pages are refactored.

The UI should follow existing `ops-*` component and CSS conventions. Any added CSS belongs in the existing operational renderer stylesheet rather than a new UI framework.

## Error Handling

User-visible cases include:

- no completed sale found;
- selected sale no longer exists or is not completed;
- no refundable items remain;
- no items selected;
- invalid or excessive quantity;
- missing reason;
- unsupported refund method;
- refund mismatch returned by server;
- invalid manager credentials;
- approving user is not manager/admin;
- approval expired;
- approval already consumed;
- approval belongs to a different sale/session/terminal;
- concurrent return reduced available quantity before submit;
- server/network failure.

Server messages remain the final source for race-condition/business-rule failures; the UI adds concise inline guidance and toasts.

## Testing Strategy

### Domain tests

Extend return tests to verify:

- explicit `authorizedBy` identity is persisted separately from `operatorId`;
- cashier operator + manager authorization succeeds;
- non-manager authorization is rejected;
- existing manager self-authorization remains valid;
- over-return, refund mismatch, immutable sale, effects, and historical cost behavior remain green.

### API tests

Add tests for:

- `/api/v1/auth/authorize` requires an authenticated requesting session;
- valid local manager/admin credentials issue approval;
- cashier can complete a return with valid approval;
- cashier cannot complete without approval;
- wrong credentials fail;
- non-manager approver fails;
- expired approval fails;
- reused approval fails;
- approval bound to another sale/terminal/session fails;
- manager/admin direct return still succeeds.

### Renderer/contract tests

Assert the desktop returns renderer exposes stable selectors/markers for:

- sale search;
- result selection;
- refundable-item rows;
- quantity inputs;
- refund method;
- reason;
- authorization action;
- submit action;
- recent return history.

### End-to-end

Create a dedicated ArtiSys QA flow, expected filename:

```text
qa/flows/returns-desktop-e2e.json
```

Primary scenario:

1. launch with deterministic fixture data;
2. log in as cashier/operator;
3. open Returns;
4. search for a completed sale by sale number/customer text;
5. select sale;
6. select one item and partial quantity;
7. verify displayed return total;
8. choose refund method;
9. enter reason;
10. request authorization;
11. authenticate manager/admin;
12. complete return;
13. assert success state;
14. assert return appears in history;
15. reload/reopen sale and assert remaining refundable quantity decreased.

Negative coverage should include at least invalid authorization and excessive quantity through the narrowest appropriate test level; the full E2E need not duplicate every domain/API invariant.

## Files Expected to Change

Primary:

- `desktop/renderer/operational-pages.js`
- `desktop/renderer/api-client.js`
- existing operational renderer CSS file if layout/states require styling
- `server/router.js`
- `js/domains/returns/return-service.js`
- return/API/UI contract tests under `test/`
- `qa/flows/returns-desktop-e2e.json`
- `qa/artisys-qa.config.json` only if registration is required by the current QA configuration

Additional files are allowed only when required to keep authorization storage/test helpers isolated and understandable.

## Non-Goals

- changing the immutable-sale model;
- refund gateway integration;
- automatic card-provider reversal;
- cloud authorization service;
- multi-level approval chains;
- split/multiple refund methods in the desktop UI;
- changing inventory/cash event semantics beyond what existing return effects already implement;
- redesigning unrelated operational pages.

## Acceptance Criteria

The work is complete when all of the following are true:

- `renderReturns()` provides desktop sale search instead of requiring knowledge of an internal sale ID;
- a completed sale can be selected and its remaining refundable quantities are visible;
- partial and total item selection is supported up to remaining availability;
- the refund total is calculated from selected original-sale prices;
- a reason is required;
- manager/admin can self-authorize;
- cashier/operator can complete only after a local, scoped manager/admin authorization;
- operator and authorizer identities are persisted distinctly;
- authorization is short-lived, single-use, local, and not dependent on paid/external services;
- successful return continues to trigger existing inventory/cash/commission/outbox behavior;
- the original sale remains unchanged;
- unit/API/contract tests pass;
- a dedicated E2E proves the complete desktop flow;
- the branch is opened as a PR against `main` after verification.