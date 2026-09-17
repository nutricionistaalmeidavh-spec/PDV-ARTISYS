# Design — Integração Venda → Financeiro (P0–P2)

Data: 2026-09-17
Branch: `feat/qa-user-all`
Escopo aprovado: P0, P1 e P2 do roadmap Venda → Financeiro.

## Objetivo

Integrar a conclusão de uma venda ao módulo Financeiro sem duplicar receita, preservando o papel operacional do Caixa e usando a arquitetura de eventos já existente no PDV.

O fluxo desejado é:

```text
sale.completed
├─ estoque
├─ caixa
├─ impressão
├─ comissão
└─ financeiro
```

Caixa continua representando a movimentação operacional do terminal. Financeiro passa a representar o recebimento/recebível originado na mesma venda.

## Abordagens consideradas

### A. Efeito financeiro em `sale.completed` — escolhida

Adicionar `finance-effects.js` seguindo o mesmo padrão de `cash-effects.js`, com `createIdempotentDomainEffect` e `SqliteEffectStore`.

Vantagens:
- mantém `sale-service` desacoplado de Financeiro;
- aproveita outbox/event bus já existentes;
- idempotência fica coerente com Estoque/Caixa/Impressão;
- facilita P3/P4 depois para cancelamento/devolução.

### B. Chamar Financeiro diretamente dentro de `completeSale`

Mais simples no curto prazo, mas acopla vendas e financeiro e dificulta reprocessamento/rollback de efeitos.

### C. Derivar Financeiro a partir de movimentos de Caixa

Evitaria novo efeito, mas perderia cartão/fiado e misturaria movimentação operacional com recebível financeiro.

**Decisão:** abordagem A.

---

# P0 — Modelo e regras de origem

## Estado atual

`financial_entries` já possui `source_type` e `source_id`. O Financeiro já suporta contas, lançamentos, baixas e cancelamentos.

## Migration

Adicionar uma nova migration incremental ao schema principal, sem recriar a tabela e sem apagar dados existentes.

Campos novos em `financial_entries`:

```text
source_line_key TEXT
payment_method TEXT
gross_amount_cents INTEGER
fee_amount_cents INTEGER
net_amount_cents INTEGER
original_entry_id TEXT
installment_number INTEGER
installment_count INTEGER
```

Regras:
- `amount_cents` permanece o valor financeiro efetivamente a receber/recebido;
- para venda, `amount_cents = net_amount_cents`;
- `gross_amount_cents` guarda o valor bruto da parte/parcela;
- `fee_amount_cents` guarda a taxa descontada;
- `net_amount_cents = gross_amount_cents - fee_amount_cents`;
- `source_type='SALE'` para P1/P2;
- `source_id=saleId`;
- `source_line_key` identifica de forma estável a origem dentro da venda (`paymentId` ou `paymentId:parcela`);
- `original_entry_id` fica reservado para P3/P4;
- `installment_number/installment_count` são nulos para pagamentos não parcelados.

Criar índice único parcial:

```text
(source_type, source_id, source_line_key)
WHERE source_type IS NOT NULL
  AND source_id IS NOT NULL
  AND source_line_key IS NOT NULL
```

Isso impede duplicação mesmo fora do effect store.

## Finance service

`mapEntry` passa a expor os novos campos.

`createEntry` passa a aceitar esses campos opcionalmente e validar:
- valores monetários não negativos;
- líquido não maior que bruto;
- taxa igual à diferença bruto-líquido quando os três forem informados;
- parcelas `1 <= installmentNumber <= installmentCount`.

Lançamentos manuais continuam funcionando com os campos novos nulos.

---

# P1 — Venda concluída → Financeiro

## Payload de `sale.completed`

Hoje o evento expõe método e valor. Para idempotência por linha e P2, o evento passará a carregar também:

```json
{
  "paymentId": "pay-...",
  "method": "PIX",
  "amountCents": 10000,
  "metadata": null
}
```

Os IDs dos pagamentos serão gerados antes da persistência e reutilizados no evento.

## Novo `finance-effects.js`

Registrar efeito:

```text
effectKey = finance.sale-completed
```

Entrada: `sale.completed`.

O handler chama um novo serviço/projetor financeiro responsável por transformar os pagamentos da venda em `financial_entries`.

## Regras por forma de pagamento

### CASH

Criar `RECEIVABLE` com:
- origem `SALE`;
- bruto = líquido = valor do pagamento;
- taxa = 0;
- vencimento = momento da conclusão;
- criar baixa financeira imediata com método `CASH`;
- resultado final: `SETTLED`.

### PIX

Mesma regra de CASH, com baixa imediata `PIX`.

### DEBIT_CARD

Criar recebível conforme política de adquirência do P2.
- status inicial: `OPEN`;
- vencimento calculado pela configuração;
- bruto/taxa/líquido persistidos.

### CREDIT_CARD

Criar um ou mais recebíveis conforme parcelas do pagamento e política de adquirência do P2.
- status inicial: `OPEN`;
- uma linha por parcela;
- cada linha vinculada ao mesmo `paymentId` por `source_line_key`.

### STORE_CREDIT

Criar um `RECEIVABLE` aberto.
- `amount_cents = valor`;
- taxa = 0;
- vencimento usa `metadata.dueAt` quando informado;
- sem `dueAt`, usa a data da venda como fallback explícito, sem inventar prazo comercial.

### OTHER

Criar um recebível aberto, sem baixa automática, para não presumir liquidação de um método desconhecido.

## Pagamento misto

Cada componente da venda gera sua própria linha financeira.

Exemplo:

```text
Venda R$ 150
├─ CASH R$ 50  → lançamento SETTLED
└─ CREDIT R$100 → recebível OPEN
```

O relatório de vendas não soma Financeiro ao total da venda. Financeiro é outra visão da mesma operação.

---

# P2 — Cartão e recebíveis

## Configuração de adquirência

Usar `app_settings` para evitar nova tabela de configuração.

Chaves globais:

```text
finance.acquiring.debit.feeBps
finance.acquiring.debit.settlementDays
finance.acquiring.credit.feeBps
finance.acquiring.credit.firstSettlementDays
finance.acquiring.credit.intervalDays
```

Valores padrão seguros, quando nunca configurados:

```text
feeBps = 0
settlementDays = 0
firstSettlementDays = 0
intervalDays = 30
```

Os defaults deliberadamente não inventam taxas nem prazos da adquirente. O usuário precisa configurar os valores reais.

## Parcelamento

`CREDIT_CARD` aceita em `payment.metadata`:

```json
{
  "installments": 3
}
```

Regras:
- mínimo 1;
- máximo 24;
- ausência = 1 parcela;
- `gross_amount_cents` é rateado entre as parcelas;
- taxa é calculada sobre o bruto total usando basis points (`feeBps`);
- taxa líquida é rateada de forma determinística;
- diferenças de arredondamento ficam na última parcela;
- soma dos brutos das parcelas = valor original;
- soma das taxas = taxa total;
- soma dos líquidos = líquido total.

## Vencimentos

Débito:

```text
completedAt + settlementDays
```

Crédito:

```text
parcela 1 = completedAt + firstSettlementDays
parcela N = parcela 1 + (N-1) * intervalDays
```

## Checkout

O modal de pagamento será estendido apenas para o necessário ao P2:
- ao selecionar `CREDIT_CARD`, mostrar número de parcelas;
- armazenar `metadata.installments` na parcela de pagamento;
- pagamentos mistos continuam suportados;
- nenhuma taxa será digitada pelo operador durante a venda; ela vem da configuração administrativa.

## Configurações

Adicionar bloco administrativo em Configurações para:
- taxa débito (%);
- prazo débito (dias);
- taxa crédito (%);
- primeiro recebimento crédito (dias);
- intervalo entre parcelas (dias).

Salvar nas chaves `finance.acquiring.*` existentes, com permissão apenas de admin/manager pelo `settings-service` atual.

---

# Idempotência e consistência

Duas barreiras:

1. `createIdempotentDomainEffect` impede o mesmo evento de aplicar `finance.sale-completed` duas vezes;
2. índice único `(source_type, source_id, source_line_key)` impede linhas duplicadas por origem.

O efeito deve ser transacional ao criar cada conjunto de recebíveis/baixas da venda.

Falha no efeito não altera a venda concluída; o evento permanece reprocessável pela outbox.

---

# Compatibilidade

- migrations incrementais preservam bancos existentes;
- lançamentos financeiros manuais continuam válidos;
- APIs atuais de Financeiro continuam aceitando payloads antigos;
- `financial_entries.amount_cents` mantém significado de saldo financeiro principal;
- Caixa não passa a ler `financial_entries`;
- relatórios existentes não devem somar Venda + Caixa + Financeiro como receitas independentes.

---

# Testes obrigatórios

## Migration / Finance service

- banco v3 migra para nova versão sem perder lançamentos existentes;
- campos novos nulos em lançamentos antigos;
- índice de origem bloqueia duplicação;
- validações de bruto/taxa/líquido e parcelas.

## Efeito de venda

- CASH cria RECEIVABLE liquidado;
- PIX cria RECEIVABLE liquidado;
- DEBIT_CARD cria recebível aberto;
- STORE_CREDIT cria recebível aberto;
- OTHER cria recebível aberto;
- pagamento misto cria linhas independentes;
- reprocessamento do mesmo evento não duplica.

## Cartão

- crédito 1x;
- crédito 3x;
- taxa em basis points;
- rateio conserva bruto/taxa/líquido;
- vencimentos seguem primeira data + intervalo;
- débito usa prazo configurado;
- configuração 0%/0 dias funciona sem valores implícitos escondidos.

## UI

- checkout só mostra parcelas para crédito;
- `metadata.installments` chega ao backend;
- configurações de adquirência persistem em `app_settings`;
- permissões de cashier continuam bloqueando configuração global.

## Regressão

- venda continua alimentando estoque, caixa, comissão, impressão e relatórios;
- QA de integridade existente continua verde;
- nenhum teste pode considerar Venda + Financeiro como duas receitas.

---

# Fora de escopo deste ciclo

Ficam para P3+:
- cancelamento financeiro de venda;
- devolução financeira parcial/total;
- estorno automático dos recebíveis;
- conciliação bancária/adquirente;
- antecipação de recebíveis;
- MDR diferente por número de parcelas/bandeira;
- múltiplas adquirentes/bandeiras;
- DRE contábil de taxa como despesa separada;
- filtros e navegação cruzada completos da UI Financeiro (P5).
