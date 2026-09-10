# Restaurante — arquitetura E30–E39

## Princípios

O módulo de restaurante é uma extensão do PDV local-first. Não cria um segundo motor de venda, estoque, caixa ou impressão. Mesas e pedidos acumulam intenção operacional; no fechamento, a comanda é convertida em uma venda normal pelo `SaleService`. A partir daí, os efeitos existentes de estoque, caixa, cupom e auditoria continuam sendo a fonte canônica.

O servidor autoritativo permanece local. Desktop, terminais e dispositivos móveis operam na mesma LAN. Não existe dependência obrigatória de nuvem, CDN, SaaS ou API paga.

## E30 — impressão não fiscal

`non-fiscal-service.js` usa o `print-service.js` existente e apenas adiciona renderizações de pré-conta, cozinha e fechamento de caixa. Jobs continuam persistidos em `print_jobs`, com retry e reimpressão. A emissão fiscal é independente deste caminho.

## E31 — mesas e comandas

`restaurant-service.js` mantém `restaurant_tables`, `table_sessions`, `restaurant_orders` e itens. Uma mesa pode ter somente uma sessão ativa. `checkoutToSale()` agrega os itens ativos da comanda e cria uma venda normal, preservando preço em centavos e o fluxo existente de pagamento.

## E32 — cozinha/KDS

`kitchen-service.js` mantém setores, vínculo produto→setor e tickets. `restaurant.order-created` é roteado por efeito idempotente. A restrição única `(order_id, station_id)` evita duplicidade de ticket mesmo se um efeito for reprocessado. Impressão de produção usa IDs determinísticos por ticket.

## E33/E34 — dispositivos LAN

`mobile-device-service.js` gera uma credencial aleatória exibida somente na criação/rotação e persiste apenas `scrypt(hash + salt)`. Dispositivos podem ser bloqueados ou ter a chave rotacionada. Tipos suportados: `WAITER`, `TABLET`, `KITCHEN`.

A interface `/mobile` é composta apenas por HTML/CSS/JS locais. O tablet ignora qualquer `tableId` informado pelo cliente e usa exclusivamente a mesa gravada no vínculo do dispositivo. O garçom opera mesas/comandas e o KDS altera apenas tickets de cozinha.

## E35 — workspace desktop

`restaurant-ui.js` é carregado como módulo de renderer e usa a ponte IPC já existente (`artisys:api`). O Electron injeta o token local somente para rotas de restaurante no perfil servidor; terminais remotos usam sua credencial de terminal já pareada.

## E36 — roteamento HTTP local

`restaurant-router.js` é composto antes do router legado em `local-server.js`. Rotas não relacionadas ao restaurante continuam sendo tratadas pelo router original sem alteração de contrato. Rotas `/api/v1/restaurant/*` exigem token local ou terminal pareado; rotas `/api/v1/mobile/*` exigem credencial do dispositivo.

## E37 — relatórios

`restaurant-reporting-service.js` consulta diretamente as tabelas operacionais e não mantém agregados paralelos. Fornece resumo e CSV de pedidos sem depender de serviço externo.

## E38 — confiabilidade

Operações críticas aceitam `x-mutation-id` e reutilizam `processed_mutations`. Eventos de domínio continuam persistidos na outbox. Tickets de cozinha e jobs de impressão têm chaves idempotentes próprias. A suíte cobre fluxo completo, credenciais, revogação, LAN e concorrência de abertura de mesa.

## E39 — release

A versão de pacote é 1.1.0. A migração de release avança o schema para v5 de forma incremental sobre v4. `npm run verify` e `npm run verify:release` permanecem os gates canônicos; o empacotamento Windows continua em `npm run dist:win`.
