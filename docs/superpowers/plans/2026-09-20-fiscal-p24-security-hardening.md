# Fiscal P24 Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endurecer o canal fiscal local sem alterar venda, estoque, caixa, P8–P9/reconciliação ou regras tributárias.

**Architecture:** O Electron gera um token efêmero por processo para autenticar o Fiscal Sidecar em loopback. O token não é persistido nem exposto no status público; o runtime o entrega ao provider ACBr local apenas em memória. O sidecar aplica autenticação antes do adapter, limites HTTP, sanitização de respostas/logs e bloqueio fail-closed de mocks em produção.

**Tech Stack:** Node.js 22, Electron, HTTP local, `node:crypto`, `node:test`, GitHub Actions release/E2E.

**Spec:** `docs/operations/fiscal.md`

## Global Constraints

- Core fiscal permanece R$ 0/mês, self-hosted/local-first e open source.
- ACBr/local permanece provider padrão; Focus continua opcional e nunca vira dependência silenciosa.
- Não alterar checkout, estoque, caixa, máquina de estados/reconciliação P8–P9 nem regras tributárias.
- Falha fiscal não pode desfazer venda nem duplicar efeitos comerciais.
- Branch isolada; nenhum merge em `main` durante P24.
- Conclusão exige `verify:release` e E2E de release verdes.

## Review Focus

- Requisição local sem token ou com token incorreto deve falhar antes de tocar no adapter.
- Segredos em mensagens/objetos não podem atravessar logs/respostas sem redaction.
- Payload/headers/timeouts fora dos limites devem falhar fechado.
- `mock-success`/`mock-failure` jamais podem inicializar em produção/package.
- Restart do sidecar deve manter o canal autenticado e não expor o token no status.

---

### Task 1: Primitive security boundary

**Files:**
- Create: `js/domains/fiscal/security-hardening.js`
- Test: `test/fiscal-security-hardening.test.js`

**Interfaces:**
- Produces: `normalizeAuthToken`, `authorizeRequest`, `sanitizeText`, `sanitizeValue`, `assertProductionAdapterMode`, `normalizeBoundedInteger`.

- [x] **Step 1: Write failing redaction/mock-guard tests.**
- [x] **Step 2: Run RED and confirm missing security module.**
- [x] **Step 3: Implement bounded token validation, timing-safe comparison, redaction and production guard.**
- [x] **Step 4: Run focused tests GREEN.**

### Task 2: Authenticate and bound the local sidecar

**Files:**
- Modify: `server/fiscal-sidecar/index.js`
- Modify: `server/fiscal-sidecar/entry.js`
- Modify: `server/fiscal-sidecar/controlled-adapter.js`
- Test: `test/fiscal-security-hardening.test.js`

**Interfaces:**
- Consumes: security primitives from Task 1.
- Produces: bearer-authenticated loopback API with bounded payload, headers and request receive time.

- [x] **Step 1: Add tests proving unauthenticated access is rejected before adapter invocation.**
- [x] **Step 2: Require a strong sidecar token and validate limits before listen.**
- [x] **Step 3: Sanitize adapter data/errors crossing the HTTP boundary.**
- [x] **Step 4: Block controlled mocks in production while preserving `unconfigured` fail-closed mode.**

### Task 3: Keep the token ephemeral and isolate child secrets

**Files:**
- Modify: `desktop/fiscal-sidecar-runtime.cjs`
- Modify: `desktop/fiscal-bridge.cjs`
- Test: `test/fiscal-sidecar-runtime.test.js`
- Test: `test/fiscal-security-hardening.test.js`

**Interfaces:**
- Produces: in-memory active sidecar token resolver; child environment allowlist.
- Consumes: provider base URL resolver already owned by the fiscal bridge.

- [x] **Step 1: Generate a random token per runtime and pass it only to the sidecar child environment.**
- [x] **Step 2: Replace inherited process environment with a narrow OS/fiscal allowlist.**
- [x] **Step 3: Detect packaged Electron as production and set the production guard flag.**
- [x] **Step 4: Sanitize child stderr/startup errors and clear active token on stop/exit.**

### Task 4: Authenticate the ACBr local provider

**Files:**
- Modify: `js/domains/fiscal/acbr-local-provider.js`
- Modify: `js/domains/fiscal/provider-registry.js`
- Modify: `desktop/fiscal-bridge.cjs`
- Test: `test/fiscal-provider-registry.test.js`
- Test: `test/fiscal-sidecar-contract.test.js`
- Test: `test/fiscal-block3-flow.test.js`

**Interfaces:**
- Consumes: sidecar base URL + ephemeral auth token.
- Produces: `Authorization: Bearer <token>` on every sidecar request without public token exposure.

- [x] **Step 1: Add request/response size and timeout bounds to the local provider.**
- [x] **Step 2: Inject bearer auth only into the local provider HTTP request.**
- [x] **Step 3: Keep Focus behavior and paid-provider token contract unchanged.**
- [x] **Step 4: Update deterministic fiscal contracts/E2E fixtures to use the authenticated channel.**

### Task 5: Release verification

**Files:**
- CI: `.github/workflows/verify.yml` (existing workflow, unchanged)

**Interfaces:**
- Consumes: all P24 changes.
- Produces: release evidence from the existing `verify` and `e2e` jobs.

- [ ] **Step 1: Run `npm run verify:release` in the existing `verify` job.**
- [ ] **Step 2: Run `npm run qa:validate` and `xvfb-run -a npm run qa:release` in the existing `e2e` job.**
- [ ] **Step 3: Fix any Critical/Important regression and rerun until both jobs are green.**
- [ ] **Step 4: Do not merge `main`; retain P24 on `feat/fiscal-p24-security-hardening`.**
