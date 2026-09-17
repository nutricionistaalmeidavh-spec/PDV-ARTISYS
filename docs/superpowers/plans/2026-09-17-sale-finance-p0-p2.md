# Sale → Finance P0–P2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `sale.completed` projetar pagamentos da venda no Financeiro, com origem rastreável, idempotência, recebíveis de cartão e parcelamento configurável, sem duplicar a receita do Caixa.

**Architecture:** A venda continua sendo concluída pelo domínio de Sales e emitindo `sale.completed`. Um novo efeito idempotente `finance.sale-completed` transforma cada pagamento em um ou mais `financial_entries`; CASH/PIX são liquidados imediatamente e cartões/fiado ficam como recebíveis conforme política de adquirência. O Financeiro não passa a ser fonte do Caixa nem altera o total comercial da venda.

**Tech Stack:** Node.js 22, CommonJS, SQLite/better-sqlite3, domain events/outbox/effect store, Electron renderer, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-17-sale-finance-p0-p2-design.md`

## Global Constraints

- Preservar bancos existentes com migration incremental; nenhum dado atual pode ser apagado.
- `CASH` e `PIX` geram RECEIVABLE imediatamente SETTLED.
- `DEBIT_CARD`, `CREDIT_CARD`, `STORE_CREDIT` e `OTHER` geram recebíveis OPEN conforme regras abaixo.
- `feeBps=0`, `settlementDays=0`, `firstSettlementDays=0`, `intervalDays=30` quando não configurados.
- Crédito aceita 1–24 parcelas; ausência de metadata significa 1 parcela.
- A soma de bruto/taxa/líquido das parcelas deve conservar exatamente o valor original e a taxa total.
- Dupla proteção de idempotência: `domain_event_effects` + índice único `(source_type,source_id,source_line_key)`.
- Não implementar P3/P4 neste plano: cancelamento/devolução financeira automática ficam fora do escopo.
- Não somar Venda + Caixa + Financeiro como três receitas distintas em relatórios.

---

## File map

- `js/core/database/migrations.js`: migration v4 com metadados de origem/recebível e índice único.
- `js/domains/finance/finance-service.js`: mapeamento/validação dos novos campos e criação idempotente por origem.
- `js/domains/finance/acquiring-policy.js`: cálculo puro de taxas, parcelas e vencimentos.
- `js/domains/finance/finance-effects.js`: projeção de `sale.completed` no Financeiro.
- `js/domains/sales/sale-service.js`: preservar `paymentId` e `metadata` no payload do evento.
- `js/core/pdv-runtime.js`: registrar o novo efeito.
- `desktop/renderer/app.js`: parcelas no pagamento com cartão de crédito.
- `desktop/renderer/operational-pages.js`: bloco administrativo de configuração de adquirência.
- `test/sale-finance-projection.test.js`: integração P0/P1/P2.
- `test/finance-acquiring-policy.test.js`: matemática de taxas/parcelas/vencimentos.
- `test/finance-schema-v4.test.js`: migration/compatibilidade/idempotência estrutural.
- `test/finance-ui-p2.test.js`: contratos estruturais do checkout/configurações.

---

### Task 1: Schema v4 e contrato financeiro P0

**Files:**
- Modify: `js/core/database/migrations.js`
- Modify: `js/domains/finance/finance-service.js`
- Create: `test/finance-schema-v4.test.js`

**Interfaces:**
- Produces: `financial_entries.source_line_key`, `payment_method`, `gross_amount_cents`, `fee_amount_cents`, `net_amount_cents`, `original_entry_id`, `installment_number`, `installment_count`.
- Produces: `finance.createEntry(input, actor)` aceitando os campos novos sem quebrar payload antigo.

- [ ] **Step 1: Write failing migration/finance tests**

Cobrir:

```js
test('schema v4 adds sale-finance origin and receivable metadata without losing old rows', () => {
  // cria banco até v3, insere financial_entries legado, roda migration v4
  // verifica linha preservada e colunas novas null
});

test('sale finance origin is unique per source line', () => {
  // duas linhas SALE/sale-1/pay-1 devem violar índice único
});

test('finance entry exposes gross fee net payment and installment metadata', () => {
  // createEntry(...) e getEntry(...) preservam os novos campos
});

test('finance entry rejects inconsistent gross fee net totals', () => {
  // gross 10000, fee 300, net 9800 => rejeitar
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test test/finance-schema-v4.test.js
```

Expected: FAIL porque migration v4/campos ainda não existem.

- [ ] **Step 3: Add migration v4**

Adicionar migration:

```sql
ALTER TABLE financial_entries ADD COLUMN source_line_key TEXT;
ALTER TABLE financial_entries ADD COLUMN payment_method TEXT;
ALTER TABLE financial_entries ADD COLUMN gross_amount_cents INTEGER;
ALTER TABLE financial_entries ADD COLUMN fee_amount_cents INTEGER;
ALTER TABLE financial_entries ADD COLUMN net_amount_cents INTEGER;
ALTER TABLE financial_entries ADD COLUMN original_entry_id TEXT;
ALTER TABLE financial_entries ADD COLUMN installment_number INTEGER;
ALTER TABLE financial_entries ADD COLUMN installment_count INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_entries_source_line
ON financial_entries(source_type,source_id,source_line_key)
WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND source_line_key IS NOT NULL;
```

- [ ] **Step 4: Extend finance service mapping/validation**

`mapEntry()` deve expor camelCase dos oito campos novos.

`createEntry()` deve validar:

```js
const gross = input.grossAmountCents == null ? null : assertNonNegativeCents(...);
const fee = input.feeAmountCents == null ? null : assertNonNegativeCents(...);
const net = input.netAmountCents == null ? amountCents : assertNonNegativeCents(...);
if (gross != null && fee != null && net != null && gross - fee !== net) throw new Error('Valores bruto, taxa e liquido inconsistentes.');
```

Parcelas:

```js
if (installmentCount != null && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 24)) throw ...;
if (installmentNumber != null && (!Number.isInteger(installmentNumber) || installmentNumber < 1 || installmentNumber > installmentCount)) throw ...;
```

- [ ] **Step 5: Run GREEN**

```powershell
node --test test/finance-schema-v4.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/core/database/migrations.js js/domains/finance/finance-service.js test/finance-schema-v4.test.js
git commit -m "feat: extend finance entries for sale receivables"
```

---

### Task 2: Política pura de adquirência P2

**Files:**
- Create: `js/domains/finance/acquiring-policy.js`
- Create: `test/finance-acquiring-policy.test.js`

**Interfaces:**
- Produces: `resolveAcquiringPolicy({ method, amountCents, completedAt, metadata, settings }) -> Array<ReceivableLine>`.
- `ReceivableLine`: `{ sourceSuffix, grossAmountCents, feeAmountCents, netAmountCents, dueAt, installmentNumber, installmentCount }`.

- [ ] **Step 1: Write failing policy tests**

Cobrir:

```js
test('debit applies fee bps and settlement days', ...);
test('credit 1x preserves gross fee and net', ...);
test('credit 3x conserves gross fee and net after integer rounding', ...);
test('credit due dates use firstSettlementDays plus intervalDays', ...);
test('credit rejects installments outside 1..24', ...);
test('zero/default policy does not invent fee or delay', ...);
```

- [ ] **Step 2: Run RED**

```powershell
node --test test/finance-acquiring-policy.test.js
```

Expected: FAIL porque módulo não existe.

- [ ] **Step 3: Implement pure policy**

Regras:

```js
const feeTotal = Math.round(amountCents * feeBps / 10000);
const netTotal = amountCents - feeTotal;
```

Rateio determinístico:

```js
function splitCents(total, count) {
  const base = Math.floor(total / count);
  return Array.from({length:count}, (_,i) => i === count - 1 ? total - base * (count - 1) : base);
}
```

Crédito usa `metadata.installments || 1`; débito sempre uma linha.

- [ ] **Step 4: Run GREEN**

```powershell
node --test test/finance-acquiring-policy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/domains/finance/acquiring-policy.js test/finance-acquiring-policy.test.js
git commit -m "feat: add card acquiring receivable policy"
```

---

### Task 3: Payload estável de pagamento em `sale.completed`

**Files:**
- Modify: `js/domains/sales/sale-service.js`
- Test: `test/sale-finance-projection.test.js`

**Interfaces:**
- Produces em `sale.completed.payload.payments[]`: `{ paymentId, method, amountCents, metadata }`.
- `paymentId` é o mesmo ID persistido na tabela `payments`.

- [ ] **Step 1: Write failing event-payload test**

```js
test('sale.completed carries stable payment ids and metadata', async () => {
  // venda cartão 3x
  // assert payment persistido possui o mesmo id do payload
  // assert payload.metadata.installments === 3
});
```

- [ ] **Step 2: Run RED**

```powershell
node --test test/sale-finance-projection.test.js --test-name-pattern="stable payment ids"
```

Expected: FAIL porque payload atual não contém `paymentId`/`metadata`.

- [ ] **Step 3: Generate IDs once and reuse**

Antes do insert:

```js
const persistedPayments = normalizedPayments.map(payment => ({ ...payment, paymentId:idFactory('pay') }));
```

Usar `payment.paymentId` no INSERT e no evento.

- [ ] **Step 4: Run GREEN**

```powershell
node --test test/sale-finance-projection.test.js --test-name-pattern="stable payment ids"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/domains/sales/sale-service.js test/sale-finance-projection.test.js
git commit -m "feat: preserve payment identity in sale events"
```

---

### Task 4: Projeção `sale.completed` → Financeiro P1/P2

**Files:**
- Create: `js/domains/finance/finance-effects.js`
- Modify: `js/core/pdv-runtime.js`
- Modify: `js/domains/finance/finance-service.js`
- Modify: `test/sale-finance-projection.test.js`

**Interfaces:**
- Consumes: `resolveAcquiringPolicy(...)` da Task 2.
- Produces: `registerFinanceEffects({ bus, financeService, settingsService, effectStore })`.
- Produces: `financeService.projectSaleCompleted(event, policySettings)` ou helper equivalente encapsulado no domínio Financeiro.

- [ ] **Step 1: Write failing projection tests**

Casos obrigatórios:

```js
test('cash sale creates settled finance entry', ...);
test('pix sale creates settled finance entry', ...);
test('debit creates open net receivable with configured fee and due date', ...);
test('credit 3x creates three open receivables', ...);
test('store credit creates open receivable', ...);
test('other creates open receivable without assuming settlement', ...);
test('mixed payment creates independent finance lines', ...);
test('re-dispatching sale.completed does not duplicate finance entries', ...);
```

- [ ] **Step 2: Run RED**

```powershell
node --test test/sale-finance-projection.test.js
```

Expected: FAIL porque efeito financeiro ainda não existe.

- [ ] **Step 3: Implement finance effect**

Estrutura:

```js
const completed = createIdempotentDomainEffect({
  effectKey:'finance.sale-completed',
  effectStore,
  handler: async event => projectSaleCompleted(event)
});
return [bus.subscribe('sale.completed', completed)];
```

Configurações lidas de `settingsService.get(...)` com defaults da spec.

Para CASH/PIX:
1. `createEntry` RECEIVABLE com `sourceType:'SALE'`, `sourceId:event.aggregateId`, `sourceLineKey:paymentId`.
2. `settleEntry` pelo valor líquido e método correspondente.

Para cartões:
1. Resolver linhas com `resolveAcquiringPolicy`.
2. Criar uma entrada por parcela com `sourceLineKey = paymentId + ':' + installmentNumber`.
3. Não criar settlement automático.

- [ ] **Step 4: Register effect in runtime**

Após `registerCashEffects(...)`:

```js
registerFinanceEffects({bus,financeService:finance,settingsService:settings,effectStore});
```

- [ ] **Step 5: Run GREEN and integrity suite**

```powershell
node --test test/sale-finance-projection.test.js test/user-flow-integrity.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/domains/finance/finance-effects.js js/domains/finance/finance-service.js js/core/pdv-runtime.js test/sale-finance-projection.test.js
git commit -m "feat: project completed sales into finance"
```

---

### Task 5: Checkout de cartão com parcelas

**Files:**
- Modify: `desktop/renderer/app.js`
- Create: `test/finance-ui-p2.test.js`

**Interfaces:**
- Produces no draft de crédito: `{ method:'CREDIT_CARD', amountCents, metadata:{ installments } }`.
- Métodos não crédito não recebem `metadata.installments`.

- [ ] **Step 1: Write failing structural/UI contract tests**

Verificar no source que:

```js
assert.match(app, /new-payment-installments/);
assert.match(app, /metadata:\s*\{\s*installments/);
assert.match(app, /CREDIT_CARD/);
```

E que o seletor de parcelas fica associado apenas ao método `CREDIT_CARD`.

- [ ] **Step 2: Run RED**

```powershell
node --test test/finance-ui-p2.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement installments field**

Adicionar ao modal:

```html
<div class="field" id="new-payment-installments-field" hidden>
  <label>Parcelas</label>
  <select id="new-payment-installments">1..24</select>
</div>
```

Ao mudar método, mostrar apenas para `CREDIT_CARD`.

Ao adicionar pagamento:

```js
const payment = { method, amountCents };
if (method === 'CREDIT_CARD') payment.metadata = { installments:Number(root.querySelector('#new-payment-installments').value || 1) };
state.paymentDraft.push(payment);
```

A lista de pagamentos deve exibir `3x`, `4x`, etc. quando aplicável.

- [ ] **Step 4: Run GREEN**

```powershell
node --test test/finance-ui-p2.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/renderer/app.js test/finance-ui-p2.test.js
git commit -m "feat: capture credit card installments at checkout"
```

---

### Task 6: Configuração administrativa de adquirência

**Files:**
- Modify: `desktop/renderer/operational-pages.js`
- Modify: `test/finance-ui-p2.test.js`

**Interfaces:**
- Consumes APIs existentes `api.settings()` e `api.saveSetting()`.
- Produces settings globais:
  - `finance.acquiring.debit.feeBps`
  - `finance.acquiring.debit.settlementDays`
  - `finance.acquiring.credit.feeBps`
  - `finance.acquiring.credit.firstSettlementDays`
  - `finance.acquiring.credit.intervalDays`

- [ ] **Step 1: Extend failing UI contract tests**

Verificar que a página Configurações contém os cinco nomes de chave e formulário `#ops-acquiring-form`.

- [ ] **Step 2: Run RED**

```powershell
node --test test/finance-ui-p2.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add admin/manager configuration card**

Carregar `api.settings({prefix:'finance.acquiring.'})`, montar mapa e preencher defaults.

Conversão de percentual para bps:

```js
const feeBps = Math.round(Number(percent.replace(',','.')) * 100);
```

Salvar cada chave com `scope='global'`.

Cashier não deve receber formulário editável; manter proteção existente do backend como segunda barreira.

- [ ] **Step 4: Run GREEN**

```powershell
node --test test/finance-ui-p2.test.js test/settings-service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/renderer/operational-pages.js test/finance-ui-p2.test.js
git commit -m "feat: add acquiring settings to finance configuration"
```

---

### Task 7: Gate final P0–P2

**Files:**
- Test existing suite only; modify only if a test exposes a real regression.

**Interfaces:**
- Verifies all contracts from Tasks 1–6 together.

- [ ] **Step 1: Run targeted suite**

```powershell
node --test test/finance-schema-v4.test.js test/finance-acquiring-policy.test.js test/sale-finance-projection.test.js test/finance-ui-p2.test.js test/user-flow-integrity.test.js
```

Expected: PASS.

- [ ] **Step 2: Run repository verification**

```powershell
npm run verify
```

Expected: exit code 0.

- [ ] **Step 3: Run full user-flow QA**

```powershell
Remove-Item Env:ARTISYS_QA_FROM -ErrorAction SilentlyContinue
npm run qa:user:all
```

Expected:

```text
QA_RESULT=PASS
INSTALLED_EXE_SMOKE=PASS
```

- [ ] **Step 4: Inspect Finance manually in QA build**

Confirmar uma venda CASH e uma CREDIT_CARD 3x e verificar:
- CASH aparece como RECEIVABLE/SETTLED;
- cartão aparece em três RECEIVABLE/OPEN;
- total comercial da venda não é duplicado no relatório de vendas.

- [ ] **Step 5: Final commit if gate required fixes**

```bash
git status
git add <arquivos-corretivos>
git commit -m "fix: close sale finance P0-P2 verification gaps"
```
