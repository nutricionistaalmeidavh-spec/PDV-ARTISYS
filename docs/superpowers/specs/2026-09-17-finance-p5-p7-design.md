# Financeiro P5–P7 — Design

## Escopo aprovado

Continuar o roadmap Sale → Finance após P0–P4.

### P5 — Interface e rastreabilidade

O Financeiro deve permitir filtrar lançamentos por:

- origem (`SALE`, `RETURN`, manual/outros);
- forma de pagamento;
- status;
- período de vencimento;
- vendedor;
- cliente;
- venda/origem específica.

Cada lançamento projetado de venda/devolução deve expor contexto navegável da venda: `saleId`, `saleNumber`, `sellerId`, `sellerName`, `customerId`, `customerName`. Lançamentos manuais não inventam esses campos.

A UI deve permitir:

- Financeiro → Ver venda;
- Venda → Ver financeiro;
- filtrar sem perder as ações existentes de baixa/cancelamento de lançamento manual.

A implementação de UI será um enhancer separado, para não aumentar ainda mais `operational-pages.js`.

### P6 — Relatórios sem dupla contabilização

As perspectivas ficam explicitamente separadas:

- **Comercial:** vendas líquidas e desempenho comercial;
- **Caixa:** movimentos operacionais do terminal;
- **Financeiro:** recebimentos, pagamentos, recebíveis e obrigações.

Não será criado nenhum campo que some `Venda + Caixa + Financeiro` como receita. O relatório financeiro deve expor `netSettledCents = receivableSettledCents - payableSettledCents` e breakdown por origem, deixando claro que é uma perspectiva financeira, não receita comercial adicional.

O filtro de vendedor no relatório financeiro deve considerar a venda vinculada quando a origem for `SALE` ou `RETURN`.

### P7 — Idempotência reforçada

Manter a proteção já existente por `domain_event_effects(event_id,effect_key)` e pelo índice único de origem financeira.

Adicionar API interna `finance.createSourceEntry(input, actor)` com semântica idempotente:

- exige `sourceType`, `sourceId` e `sourceLineKey`;
- se a origem já existir, retorna a entrada existente;
- se houver corrida/duplicação e o índice único disparar, relê e retorna a entrada existente;
- os efeitos `sale.completed` e `return.completed` passam a usar essa API.

Assim, mesmo que o mesmo efeito de negócio seja reprocessado com outro `eventId`, a origem financeira continua única.

## Compatibilidade

- sem nova migration;
- sem apagar histórico;
- sem alterar os totais comerciais da venda;
- P3/P4 permanecem válidos;
- lançamentos manuais continuam funcionando;
- nenhuma automação bancária nova entra neste escopo.

## Testes obrigatórios

1. filtros de origem, forma, vendedor, cliente e venda;
2. contexto de navegação `saleId/saleNumber` em `SALE` e `RETURN`;
3. relatório financeiro com `netSettledCents` e breakdown por origem;
4. relatório financeiro filtrado por vendedor;
5. ausência de total combinado Venda + Caixa + Financeiro;
6. `createSourceEntry` repetido não duplica;
7. evento de negócio duplicado com nova identidade continua sem duplicar origem financeira;
8. P0–P4 continuam passando.
