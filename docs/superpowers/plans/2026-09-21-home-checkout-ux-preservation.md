# Home + Balcão — refatoração UX com preservação funcional

Baseline auditado: `main` em `ce798c727970433b442b44f901240bbfb574e35b`.

## Contrato

- Não remover rotas, atalhos, IDs operacionais ou handlers existentes.
- Home mantém os dez acessos F2–F11; somente muda hierarquia e agrupamento.
- Balcão mantém busca nome/SKU/barcode, categoria, vendedor, cliente, itens, +/- quantidade, remoção, alteração autorizada de preço, limpar carrinho, desconto, iniciar/cancelar/suspender/retomar, abertura de caixa, quatro atalhos de pagamento, pagamento múltiplo e F12.
- Regra/persistência/EventBus/outbox não são alterados.
- Core continua local/self-hosted e sem dependência paga.

## Slices

1. Caracterizar rotas/atalhos e controles existentes em teste.
2. Introduzir uma camada incremental carregada depois do renderer atual.
3. Reorganizar a Home movendo os botões existentes, preservando listeners e atalhos.
4. Reorganizar o Balcão movendo os elementos DOM existentes para regiões de produto, contexto da venda e carrinho, sem clonar controles nem alterar IDs/handlers.
5. Manter totais, pagamentos, observação e F12 compatíveis com extensões existentes; `#finalize-sale` permanece filho direto de `.sale-panel`.
6. Tornar `.sale-panel` internamente rolável e compactar a composição em alturas de até 800 px, cobrindo a classe 1366×768 sem esconder controles.
7. Executar `npm run verify:release` e os E2E de release pelo workflow oficial.
8. QA visual/operacional somente após os gates verdes.

## Gate de regressão

Qualquer rota, atalho, forma de pagamento ou controle listado no contrato que desapareça é regressão e bloqueia integração. O mesmo vale para perda da inserção dinâmica de observação antes do F12 ou para controles do painel direito que se tornem inalcançáveis em altura compacta.
