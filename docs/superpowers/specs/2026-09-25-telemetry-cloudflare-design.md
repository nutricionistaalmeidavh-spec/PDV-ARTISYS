# ArtiSys Telemetry + Cloudflare — Design

Date: 2026-09-25
Branch: `feat/telemetry-cloudflare`
Status: approved design, pending implementation plan

## 1. Context

ArtiSys already has strong local observability primitives: persistent settings, sanitized system logs, health snapshots and diagnostic packages. The next maturity step is to collect privacy-preserving product telemetry from active installations so the team can map real flows, detect regressions, aggregate recurring bugs and understand production behavior that automated tests cannot fully reproduce.

The system remains local-first. Telemetry must never be required for sales, fiscal operations, printing, stock, restaurant flows, authentication or any other operational path.

Cloudflare is an optional hosted destination for the first implementation because it removes the need to keep a VPS or workstation running. The ArtiSys client must remain structurally independent from Cloudflare and communicate only with a configurable HTTPS telemetry endpoint.

## 2. Goals

1. Capture a small, explicit set of product-flow and diagnostic events.
2. Preserve operation when offline or when telemetry infrastructure is unavailable.
3. Keep telemetry disabled by default and require explicit opt-in.
4. Prevent collection of customer content, commercial content, credentials and fiscal payloads.
5. Batch and retry events from a bounded local SQLite queue.
6. Aggregate events in Cloudflare Analytics Engine and store control/state data in D1.
7. Generate stable error fingerprints so repeated failures become one diagnosable issue family.
8. Provide automated terminal provisioning and deployment using Wrangler.
9. Add tests that prove privacy, failure isolation, retry behavior and Worker validation.

## 3. Non-goals

The initial version will not:

- record raw UI sessions, screenshots, keystrokes or screen contents;
- capture sale item descriptions, customer names, documents, contact data or addresses;
- capture full fiscal XML, DANFE contents or provider secrets;
- capture payment card data, passwords, tokens, authorization headers, certificates or CSC;
- replace existing local logs, health snapshots or diagnostic packages;
- build a full analytics dashboard inside ArtiSys;
- make Cloudflare mandatory for operation;
- automatically open GitHub issues from telemetry in the first release.

## 4. Architectural principles

### 4.1 Local-first and fail-open

Telemetry runs strictly outside transactional critical paths. Recording an event may append to a local queue, but network transmission happens asynchronously. Any telemetry exception is contained and cannot propagate into the business operation that produced the event.

If the telemetry endpoint, DNS, internet connection, Worker, D1 or Analytics Engine is unavailable, the PDV continues normally.

### 4.2 Privacy by design

Collection follows an allowlist model. An event can contain only fields defined by the telemetry schema. Unknown fields are rejected or removed before persistence and transmission.

A second sanitizer runs in the Worker so that client-side mistakes cannot silently become server-side data retention.

### 4.3 Vendor independence

The client depends on an HTTPS contract, not directly on a Cloudflare SDK. Cloudflare-specific code is isolated under `cloudflare/telemetry/`.

The endpoint is configurable, allowing a future self-hosted collector without changes to domain services.

### 4.4 Bounded resource usage

Local queue size, payload size, batch size, retry count and retention are bounded. Telemetry cannot grow the local database indefinitely or create unbounded network traffic.

## 5. High-level architecture

```text
ArtiSys domain/UI/runtime
        |
        | telemetry.record(event)
        v
Telemetry schema + sanitizer
        |
        v
SQLite telemetry queue
        |
        | background batch sender
        v
Configurable HTTPS endpoint
        |
        v
Cloudflare Worker
   |             |
   v             v
Analytics      D1
Engine         control/state
```

No business service waits for the remote path.

## 6. Client components

Create a focused telemetry subsystem under:

```text
js/core/telemetry/
  telemetry-events.js
  telemetry-sanitizer.js
  telemetry-queue.js
  telemetry-service.js
  telemetry-fingerprint.js
```

### 6.1 `telemetry-events.js`

Owns the event allowlist and field schemas. It exposes validation for event names and allowed dimensions/measurements.

Initial events:

- `app_started`
- `app_closed`
- `screen_opened`
- `sale_started`
- `sale_completed`
- `sale_failed`
- `return_started`
- `return_completed`
- `return_failed`
- `printer_failed`
- `fiscal_failed`
- `database_failed`
- `network_failed`
- `operation_failed`

Additional events require an explicit schema change and tests.

### 6.2 `telemetry-sanitizer.js`

Uses an allowlist rather than recursively sending arbitrary objects.

It must also defensively reject field names matching patterns such as:

- password / senha / passwd
- token / authorization / credential
- secret / segredo / api key / private key
- certificate / certificado / CSC
- cpf / cnpj / document / documento
- email / telefone / phone / address / endereco
- xml / danfe
- card / cartão / cartao / pan / cvv
- observation / observacao / notes / message content

String values are length bounded. Stack traces are normalized before fingerprinting and are not allowed to include arbitrary request bodies or environment values.

### 6.3 `telemetry-queue.js`

Creates and owns the local queue table:

```sql
CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  sent_at TEXT
);
```

Indexes support pending-event selection and retention cleanup.

Queue rules:

- default maximum retained pending events: 5,000;
- successful events are removed or compacted after acknowledgment;
- oldest low-value events can be dropped when the hard cap is reached;
- diagnostic/error events receive priority over flow events when trimming;
- queue writes are short local SQLite operations;
- malformed queued payloads are discarded locally and logged safely.

### 6.4 `telemetry-service.js`

Public interface:

```js
telemetry.record(eventName, payload)
telemetry.flush()
telemetry.status()
telemetry.setEnabled(enabled, actor)
telemetry.close()
```

`record()` never throws into the caller. Schema/sanitizer problems are written to the existing local logger at a bounded rate.

The service receives the existing `settings`, `logger`, `db`, `now`, `idFactory`, application version, schema version and an injectable HTTP sender for testing.

### 6.5 `telemetry-fingerprint.js`

Creates a stable hash from normalized technical dimensions only:

```text
error class
+ subsystem
+ operation
+ normalized stack signature
```

Dynamic UUIDs, numeric IDs, file-system user paths, request values and message fragments likely to contain business/user content are removed before hashing.

## 7. Local configuration

Use the existing `SettingsService` for non-secret telemetry configuration.

Initial settings:

```text
telemetry.enabled = false
telemetry.diagnostics = false
telemetry.endpoint = <release default or empty>
telemetry.batchSize = 50
```

Secret material must not be stored in `app_settings` because the existing service correctly rejects sensitive keys. Installation credentials use the same protected-storage pattern already used for sensitive desktop credentials or a dedicated protected file/key store.

The UI will expose a privacy/diagnostics setting that clearly states what is collected and what is never collected. First release behavior is opt-in; upgrades do not silently enable telemetry.

## 8. Identifiers

Allowed identifiers are pseudonymous technical identifiers:

- `installation_id`
- `terminal_id`
- random `session_id`
- `release_id` / git SHA
- `app_version`
- `database_schema_version`

No real `userId`, username or employee name is transmitted.

If future analysis requires same-operator correlation, it must use a one-way HMAC scoped to the installation with a documented retention purpose. That is outside the initial scope.

## 9. Event envelope

Every event uses a versioned envelope:

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "event_name": "sale_completed",
  "occurred_at": "2026-09-25T18:00:00.000Z",
  "installation_id": "pseudonymous-id",
  "terminal_id": "terminal-02",
  "session_id": "random-session-id",
  "app_version": "1.4.1",
  "release_id": "git-sha-or-build-id",
  "database_schema_version": 42,
  "dimensions": {
    "module": "pos",
    "result": "success"
  },
  "measurements": {
    "duration_ms": 18340,
    "items_count": 5,
    "payment_methods_count": 2
  }
}
```

Dimensions and measurements are event-specific allowlisted fields.

## 10. Batch sender and retry policy

The sender posts up to `telemetry.batchSize` events per request.

Request contract:

```text
POST /v1/events
Content-Type: application/json
Authorization: Bearer <installation telemetry credential>
```

Body:

```json
{
  "schema_version": 1,
  "events": []
}
```

Rules:

- network timeout is short and independent from PDV operations;
- retry uses exponential backoff with jitter;
- `2xx` acknowledges the batch;
- `400/413/422` marks invalid events as non-retryable;
- `401/403` pauses transmission until credentials/configuration change;
- `429` and `5xx` retry with backoff;
- app shutdown may attempt a short best-effort flush but cannot delay exit materially;
- duplicate delivery is allowed and handled by `event_id` at the collector boundary.

## 11. Runtime integration

`createPdvRuntime()` creates and exposes `runtime.telemetry` alongside existing `settings`, `logger`, `health` and `diagnostics`.

Instrumentation must be added at semantic operation boundaries, not scattered at every internal function.

Examples:

- successful completion of a sale -> `sale_completed`;
- failed fiscal authorization -> `fiscal_failed`;
- print job final failure -> `printer_failed`;
- completed return -> `return_completed`.

UI-only events such as `screen_opened` should be emitted from the renderer through a narrow IPC/API boundary rather than giving renderer code direct database access.

## 12. Cloudflare project

Add an independent project:

```text
cloudflare/telemetry/
  src/index.js
  migrations/0001_init.sql
  wrangler.jsonc
  package.json
  README.md
```

The Worker exposes:

```text
GET  /health
POST /v1/events
```

No public administration endpoint is required for the first release.

## 13. Worker request processing

`POST /v1/events` performs, in order:

1. method/path check;
2. content-type check;
3. request body size limit;
4. installation credential authentication;
5. JSON parsing;
6. envelope/schema-version validation;
7. event count limit;
8. server-side field allowlist/sanitization;
9. event-id deduplication where required;
10. Analytics Engine write;
11. D1 updates only for installation/fingerprint/control state;
12. bounded structured response.

The Worker never stores raw rejected bodies.

## 14. Cloudflare Analytics Engine

Analytics Engine is the main destination for high-volume event data.

Each event maps stable dimensions to blobs/indexes and numeric metrics to doubles. The exact binding layout is versioned with the event schema so future changes do not reinterpret historical dimensions silently.

Analytics Engine is used for questions such as:

- active installations by version;
- event/error rate by module;
- success/failure rate by operation;
- operation duration percentiles;
- recurring error fingerprints;
- flow counts between key milestones.

Raw customer/business content is never stored.

## 15. D1 responsibility

D1 stores low-volume control/state data, not every telemetry event.

Initial migration creates:

```sql
CREATE TABLE installations (
  installation_id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_app_version TEXT,
  last_release_id TEXT,
  telemetry_schema_version INTEGER NOT NULL
);

CREATE TABLE error_fingerprints (
  fingerprint TEXT PRIMARY KEY,
  subsystem TEXT NOT NULL,
  operation TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  affected_installations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  fixed_version TEXT
);

CREATE TABLE event_receipts (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
```

`event_receipts` uses bounded retention and exists only if needed for idempotency. It must not grow indefinitely.

Credentials are stored as hashes, not plaintext.

## 16. Authentication and abuse controls

Each installation uses a telemetry-only credential unrelated to ArtiSys login/session credentials.

Properties:

- permission limited to event ingestion;
- revocable/rotatable;
- no read access to telemetry;
- no access to customer or PDV APIs;
- Worker compares a hash or derived credential representation rather than storing plaintext secrets in D1;
- endpoint enforces maximum events/request and maximum bytes/request;
- Cloudflare rate limiting or Worker-level limits can be added without changing the client contract.

Credential bootstrap must not require telemetry to be available for the PDV to operate. If no credential exists, events remain local or are discarded according to retention policy.

## 17. Error fingerprint aggregation

For error events the client sends the stable fingerprint plus allowed technical dimensions.

The Worker updates D1 summary state and writes the occurrence to Analytics Engine.

Example diagnostic view derivable from stored data:

```text
fingerprint: ERR-a83f29
occurrences: 8241
affected installations: 47
versions: 1.4.0, 1.4.1
subsystem: fiscal
operation: authorize_nfce
```

The first implementation does not store the original arbitrary exception message unless it passes a strict normalized allowlist. The local logger remains the richer source for support packages.

## 18. Cloudflare provisioning automation

Add a root command:

```text
npm run telemetry:cloudflare:setup
```

Backed by a script under `scripts/`, for example `scripts/setup-cloudflare-telemetry.mjs`.

The script orchestrates Wrangler and performs these steps:

1. verify Node/npm and Wrangler availability;
2. verify Cloudflare authentication (`wrangler whoami`);
3. create or locate the D1 database;
4. update/verify the D1 binding in `wrangler.jsonc`;
5. verify Analytics Engine binding configuration;
6. apply D1 migrations remotely;
7. request/set required Worker secrets interactively when absent;
8. deploy the Worker;
9. call `/health` and fail if the deployed service is not healthy;
10. print the resulting endpoint and the ArtiSys configuration command/value.

The setup script must be idempotent: rerunning it must reuse existing resources where possible instead of creating duplicates.

No paid Cloudflare service becomes a hidden requirement. The README documents which resources may incur Cloudflare charges if usage exceeds the account's included quotas.

## 19. Testing strategy

### 19.1 Client unit tests

Prove:

- disabled telemetry records/sends nothing remotely;
- event schemas reject unknown fields;
- sanitizer blocks sensitive field names and representative sensitive values;
- queue survives runtime restart;
- queue retention is bounded;
- priority trimming preserves error events over low-value flow events;
- sender batches correctly;
- retry/backoff behavior for network errors, 429 and 5xx;
- 4xx classification does not retry invalid payloads indefinitely;
- telemetry failures never fail a sale/business operation;
- error fingerprints are deterministic after normalization;
- dynamic IDs/paths do not change the fingerprint.

### 19.2 Worker tests

Prove:

- `/health` succeeds without exposing secrets;
- missing/invalid credentials return auth errors;
- invalid content type/body/schema is rejected;
- oversized payload is rejected;
- event count is bounded;
- server sanitizer rejects prohibited fields even when client sanitizer is bypassed;
- valid events write to Analytics Engine;
- installation/fingerprint state updates D1 correctly;
- duplicate `event_id` is idempotent when receipt dedupe is enabled;
- internal failures return `500`, not `400/401`.

### 19.3 Integration/release gates

Add telemetry files to syntax/lint checks and include telemetry tests in the existing `npm test` / release verification path.

Cloudflare integration tests must use local/mocked bindings in normal CI and must not require a production Cloudflare account for the core repository test suite.

An optional deployment smoke test may run only when Cloudflare CI credentials are explicitly configured.

## 20. Rollout

1. Ship telemetry code disabled by default.
2. Enable only in internal/test installations first.
3. Validate that no sensitive fields reach Worker fixtures or test captures.
4. Enable opt-in UI for pilot customers.
5. Monitor queue size, request rate and error rates.
6. Expand event coverage only when a concrete product/diagnostic question justifies it.

Telemetry schema changes are versioned and backwards compatible for at least the currently supported desktop release window.

## 21. Security and privacy acceptance rules

Implementation is rejected if any of the following is true:

- telemetry can block or fail a commercial operation;
- telemetry is enabled silently on upgrade;
- arbitrary application objects can be serialized and sent;
- credentials are written to `app_settings` or logs;
- customer PII or payment/fiscal secret payloads appear in telemetry tests;
- Worker logs raw request bodies;
- D1 becomes the per-event analytics store;
- local queue can grow without a hard cap;
- Cloudflare availability becomes a startup requirement.

## 22. Implementation acceptance criteria

The feature is complete when:

1. `runtime.telemetry` exists and is failure-isolated;
2. local queue is persistent, bounded and covered by tests;
3. telemetry is disabled by default with explicit opt-in;
4. the initial event allowlist is implemented;
5. client and Worker both enforce privacy sanitization;
6. batch upload, retry and backoff work without affecting business flows;
7. Cloudflare Worker supports `/health` and `/v1/events`;
8. Analytics Engine receives event metrics;
9. D1 stores installation/fingerprint control state only;
10. telemetry credentials are separated from PDV credentials;
11. automated Wrangler provisioning/deployment is idempotent;
12. repository verification gates include telemetry tests;
13. documentation includes the one-command Cloudflare setup and manual fallback commands;
14. existing PDV tests continue passing.

## 23. Expected initial operator flow

Repository setup:

```bash
npm install
npm run telemetry:cloudflare:setup
```

The setup command prints the deployed endpoint and any local configuration values required by ArtiSys. Day-to-day PDV operation requires no Cloudflare process, VPS, Docker container or workstation to remain running.
