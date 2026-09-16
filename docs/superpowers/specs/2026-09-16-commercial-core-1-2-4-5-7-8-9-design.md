# ArtiSys PDV — Commercial Core 1/2/4/5/7/8/9

Date: 2026-09-16
Branch: `feature/commercial-core-1-2-4-5-7-8-9`
Base: `main@157eea5330800fa00d6199e46ee7e498c0b34915`

## Scope

Implement the roadmap items selected by the user:

1. Close and normalize the current commercial release.
2. Purchasing + supplier receiving.
4. Local Pix QR / Pix Copia e Cola with manual confirmation.
5. Lots + expiry with FEFO support.
7. Store credit / gift card ledger.
8. Advanced local analytics.
9. Automatic local replenishment suggestions.

All mandatory/core functionality must remain R$0, local-first and self-hosted. Any future bank/acquirer/SaaS integration must be optional behind an adapter and must never become a required dependency.

## Existing architecture reused

- `InventoryService` remains the single stock balance/movement authority.
- Existing inventory movement type `purchase` is reused for receipts.
- `FinanceService` remains the accounts payable/receivable authority.
- Existing `suppliers` catalog is reused.
- Existing `payments.method = STORE_CREDIT` is reused instead of introducing a second payment vocabulary.
- `ReportingService` remains the aggregate report entrypoint.
- Audit log, role checks and transaction helpers remain mandatory for all mutations.
- Desktop/API patterns already used by product variants, kits/combos and operational pages are followed.

## 1. Release normalization

Target version: `1.4.0`.

Normalize:
- `package.json`
- README release heading/version references
- `release/capabilities.json`
- `release/limitations.json`
- release manifest expectations/tests

The release must explicitly include the already implemented seller, per-item price override, product photo, period reporting and commission flows.

Acceptance:
- docs consistency passes;
- `verify` and release tests pass;
- generated installer name becomes `ArtiSys-PDV-1.4.0-x64-Setup.exe`.

## 2. Purchasing and receiving

### Data model

Add a dedicated migration containing:

- `purchase_orders`
  - id, supplier_id, order_number, status (`DRAFT`, `ORDERED`, `PARTIAL`, `RECEIVED`, `CANCELLED`), expected_at, notes, subtotal_cents, total_cents, created_by, created_at, updated_at, ordered_at, received_at, cancelled_at.
- `purchase_order_items`
  - id, purchase_order_id, product_id, product_name_snapshot, sku_snapshot, ordered_quantity, received_quantity, unit_cost_cents, total_cents.
- `purchase_receipts`
  - id, purchase_order_id, supplier_id, received_by, document_number, notes, created_at.
- `purchase_receipt_items`
  - id, receipt_id, purchase_order_item_id, product_id, quantity, unit_cost_cents, lot_id nullable.

### Service

Create `js/domains/purchasing/purchasing-service.js` with:
- create/update draft order;
- submit/order;
- partial/full receipt;
- cancel before full receipt;
- list/filter orders;
- receive idempotently by receipt id.

Receiving is transactional:
1. validate remaining ordered quantity;
2. create receipt rows;
3. call `InventoryService.move({ type:'purchase', ... })` per product;
4. update product cost to latest received cost only when explicitly configured by the order/receipt flow;
5. optionally create a PAYABLE in `FinanceService` when a due date/payment term is provided;
6. update order status to PARTIAL/RECEIVED;
7. audit the operation.

No direct stock table mutation outside `InventoryService`.

## 4. Local Pix QR / Copia e Cola

Create a zero-cost local BR Code generator using pure JavaScript already in the repo or a small vendored implementation; do not require a remote API.

### Configuration

Store per-business Pix settings in local settings:
- enabled;
- pix key;
- merchant name;
- merchant city;
- optional description prefix.

### Flow

At checkout, for a PIX payment:
1. create a Pix charge record bound to sale id and amount;
2. generate EMV/BR Code payload locally;
3. generate QR data for renderer/printing;
4. show `Pix Copia e Cola` and QR;
5. cashier explicitly marks payment as confirmed manually;
6. only then finalize that PIX payment entry.

### Data model

- `pix_charges`: id, sale_id, amount_cents, payload, status (`PENDING`, `CONFIRMED`, `CANCELLED`), created_at, confirmed_at, confirmed_by.

Future automatic confirmation must use an optional `PixProvider` adapter and cannot change the local manual core contract.

## 5. Lots and expiry

### Data model

- `inventory_lots`
  - id, product_id, supplier_id nullable, lot_code, manufactured_at nullable, expires_at nullable, received_at, unit_cost_cents nullable, active.
- `inventory_lot_balances`
  - lot_id, quantity, updated_at.
- `inventory_lot_movements`
  - id, lot_id, product_id, type, quantity_delta, quantity_before, quantity_after, source_type, source_id, event_id, created_at.

### Rules

- lot tracking is optional per product (`track_lots`).
- products with lot tracking require a lot on purchase receipt.
- sale allocation defaults to FEFO: earliest non-expired `expires_at`, then oldest received lot; lots without expiry come after expiring lots.
- blocked by default if selected lot is expired; manager override requires reason and audit.
- return restores to the original lot when snapshot exists; otherwise requires authorized lot selection.
- global product balance and lot balances must remain reconcilable.

Sale item snapshots gain the allocated lot id/code as needed for deterministic returns.

## 7. Store credit / gift card ledger

Do not use a mutable single balance as the source of truth.

### Data model

- `credit_accounts`
  - id, type (`CUSTOMER`, `GIFT_CARD`), customer_id nullable, code_hash nullable, active, created_at, updated_at.
- `credit_ledger`
  - id, account_id, direction (`CREDIT`, `DEBIT`), amount_cents, source_type, source_id, note, actor_id, created_at, reversed_entry_id nullable.

Balance = credits - debits from non-reversed ledger entries.

### Operations

- issue customer credit;
- create/load gift card by generated code;
- redeem at checkout using existing `STORE_CREDIT` payment method;
- refund a return to store credit;
- reverse a ledger entry instead of deleting it;
- enforce positive available balance and idempotency by source.

Gift card codes stored only as hashes; the plaintext code is shown only at creation/print time.

## 8. Advanced analytics

Extend `ReportingService` without adding cloud/AI dependencies.

New reports:
- ABC curve by gross revenue and quantity;
- gross margin by product/category;
- average ticket by period;
- sales by hour/day of week;
- stale inventory / days since last sale;
- inventory turnover estimate;
- stockout/low-stock exposure;
- seller gross sales, returns, cancellation, average discount and price-override count;
- price override audit summary;
- purchasing spend by supplier/product/period.

Reports must accept `from`/`to` where applicable and return deterministic local data. CSV export is added for the commercial reports with the same semicolon convention already used.

## 9. Replenishment suggestions

Create `js/domains/inventory/replenishment-service.js`.

Per product suggestion:

`target = avg_daily_sales * lead_time_days + safety_stock`

`recommended_qty = max(target - on_hand - on_order, 0)`

Configuration per product:
- lead time days (default configurable globally);
- safety stock quantity;
- optional minimum purchase quantity;
- optional preferred supplier.

Inputs:
- completed sales over configurable lookback, default 30 days;
- current `InventoryService` balance;
- open quantity from purchase orders;
- lot expiry is considered so near-expiry stock can be optionally excluded from effective on-hand.

Output is a suggestion only. It never creates an order silently. User can convert selected suggestions into a DRAFT purchase order.

## API and desktop UI

Add API routes following the existing router pattern:
- `/api/v1/purchase-orders` and receipt endpoints;
- `/api/v1/inventory/lots`;
- `/api/v1/pix/charges`;
- `/api/v1/credits` / gift-card endpoints;
- `/api/v1/reports/advanced/*`;
- `/api/v1/replenishment`.

Desktop:
- new operational pages for Purchases, Lots/Expiry, Credits/Gift Cards and Replenishment;
- Pix QR integrated into the checkout payment dialog;
- Advanced Reports section added to existing reporting UI rather than a second report shell.

RBAC:
- cashier: checkout Pix and redeem store credit;
- manager/admin: purchase receiving, expired-lot override, credit issuance/reversal;
- admin: configuration and destructive/cancellation operations.

## Testing strategy

Use TDD for each subsystem.

Unit/integration tests:
- purchase partial/full receipt and idempotency;
- stock ledger remains authoritative after receipt;
- payable creation is optional and deterministic;
- Pix BR Code deterministic payload/CRC and manual confirmation gate;
- FEFO allocation, expired lot blocking, return to original lot;
- credit ledger issue/redeem/refund/reversal and overspend rejection;
- analytics calculations with known fixtures;
- replenishment formula, on-order subtraction and no-negative recommendation.

Regression:
- existing checkout, returns, restaurant, kits/combos and variant tests remain green;
- add new files to lint scripts;
- add new QA profile/checkpoints for the new pages and Pix checkout.

## Delivery sequence

1. Normalize release metadata to 1.4.0 and lock current regression baseline.
2. Purchasing core + tests + API + UI.
3. Lots/expiry integrated with purchasing and sales allocation.
4. Local Pix payload + checkout confirmation UI.
5. Store credit/gift-card ledger + checkout/returns integration.
6. Advanced analytics.
7. Replenishment suggestions + conversion to draft purchase order.
8. Full verification, QA profile, release docs and installer readiness.

## Out of scope

- NFC-e in this batch (roadmap item 3 was not selected).
- Loyalty/points (item 6 was not selected).
- automatic bank Pix confirmation;
- real TEF;
- cloud sync/multi-store replication;
- mandatory paid providers.
