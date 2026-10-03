# Restaurante — arquitetura E30–E39

## Princípios

O módulo de restaurante é uma extensão do PDV local-first. Não cria um segundo motor de venda, estoque, caixa ou impressão. Mesas e pedidos acumulam intenção operacional; no fechamento, a comanda é convertida em uma venda normal pelo `SaleService`. A partir daí, os efeitos existentes de estoque, caixa, cupom e auditoria continuam sendo a fonte canônica.

O servidor autoritativo permanece local. Desktop, terminais e dispositivos móveis operam na mesma LAN. Não existe dependência obrigatória de nuvem, CDN, SaaS ou API paga.

## E30 — impressão não fiscal

`non-fiscal-service.js` usa o `print-service.js` existente e apenas adiciona renderizações de pré-conta, cozinha e fechamento de caixa. Jobs continuam persistidos em `print_jobs`, com retry e reimpressão. A V1 não realiza emissão fiscal neste ou em qualquer outro caminho operacional.

## E31 — mesas e comandas

`restaurant-service.js` mantém `restaurant_tables`, `table_sessions`, `restaurant_orders` e itens. Uma mesa pode ter somente uma sessão ativa. A sessão separa o operador que abriu a mesa do garçom responsável e preserva quantidade de pessoas e cliente opcional; trocar o responsável não reescreve a autoria da abertura. O desktop usa um compositor de pedido multi-item antes do envio e as superfícies mobile/QR reutilizam o mesmo contrato de composição. `checkoutToSale()` agrega os itens ativos da comanda, preserva o cliente da sessão e cria uma venda normal pelo fluxo canônico de pagamento.

## E32 — cozinha/KDS

`kitchen-service.js` mantém setores, roteamento explícito de produto e tickets. Cada item de cardápio usado no restaurante deve ser classificado como **PRODUCTION** (com setor ativo) ou **DIRECT** (atendimento direto, sem KDS). Produtos já vinculados a setor em instalações existentes são migrados como `PRODUCTION`; produtos sem regra permanecem não configurados para que um erro de cadastro não seja tratado silenciosamente como atendimento direto. Em pedidos mistos, itens `DIRECT` continuam na comanda, enquanto somente itens `PRODUCTION` geram ticket. `restaurant.order-created` é roteado por efeito idempotente. A restrição única `(order_id, station_id)` evita duplicidade de ticket mesmo se um efeito for reprocessado. Impressão de produção usa IDs determinísticos por ticket.

## E33/E34 — dispositivos LAN

`mobile-device-service.js` gera uma credencial aleatória exibida somente na criação/rotação e persiste apenas `scrypt(hash + salt)`. Dispositivos podem ser bloqueados ou ter a chave rotacionada. Tipos suportados: `WAITER`, `TABLET`, `KITCHEN`.

A interface `/mobile` é composta apenas por HTML/CSS/JS locais. O tablet ignora qualquer `tableId` informado pelo cliente e usa exclusivamente a mesa gravada no vínculo do dispositivo. O garçom pode abrir atendimento informando pessoas e cliente, registra pedidos pelo compositor compartilhado e mantém a comanda visível. Tablet, QR e autoatendimento usam o mesmo formato de itens/configurações; o KDS altera apenas tickets de cozinha. Itens `DIRECT` aparecem como atendimento direto e itens de produção acompanham o estado agregado `NEW → PREPARING → READY` retornado pelo mesmo pedido canônico.

## E35 — workspace desktop

`restaurant-ui.js` é carregado como módulo de renderer e usa a ponte IPC já existente (`artisys:api`). O Electron injeta o token local somente para rotas de restaurante no perfil servidor; terminais remotos usam sua credencial de terminal já pareada.

A superfície desktop separa duas visões sem duplicar domínio: **Operação** concentra mapa de mesas, contexto do atendimento, compositor multi-item, comanda, chamados, KDS, pré-conta e fechamento; **Configuração**, disponível apenas para gerente/administrador, concentra setores de produção, dispositivos LAN e indicadores/exportação. As operações avançadas de divisão, liquidação, transferência, junção e cancelamento continuam no fluxo avançado já existente, sem duplicar o domínio de mesas. A abertura do workspace sempre prioriza Operação, e a comanda selecionada é preservada ao alternar de visão.

## E36 — roteamento HTTP local

`restaurant-router.js` é composto antes do router legado em `local-server.js`. Rotas não relacionadas ao restaurante continuam sendo tratadas pelo router original sem alteração de contrato. Rotas `/api/v1/restaurant/*` exigem token local ou terminal pareado; rotas `/api/v1/mobile/*` exigem credencial do dispositivo.

## E37 — relatórios

`restaurant-reporting-service.js` consulta diretamente as tabelas operacionais e não mantém agregados paralelos. Fornece resumo e CSV de pedidos sem depender de serviço externo.

## E38 — confiabilidade

Operações críticas aceitam `x-mutation-id` e reutilizam `processed_mutations`. Eventos de domínio continuam persistidos na outbox. Tickets de cozinha e jobs de impressão têm chaves idempotentes próprias. O gate de UI cobre o ciclo transacional abrir mesa → contexto/responsável → pedido multi-item → KDS → conta → Caixa → venda concluída → mesa livre. A suíte de integração HTTP cobre garçom, tablet e QR usando o mesmo compositor/configuração canônica, enquanto o smoke de superfícies valida `/mobile` e `/m/:token`.

## E39 — release

A versão de pacote é 1.1.0. A migração de release avança o schema para v5 de forma incremental sobre v4. `npm run verify` e `npm run verify:release` permanecem os gates canônicos; o empacotamento Windows continua em `npm run dist:win`.


## Gate do módulo no boundary HTTP

As rotas desktop e mobile específicas de Restaurante autenticam o chamador e, em seguida, exigem a área `FOOD` / Alimentação habilitada. Com o módulo desligado, novas operações específicas são rejeitadas com `MODULE_DISABLED`; o serviço interno permanece disponível para drenar efeitos duráveis já persistidos. O renderer reconcilia o estado no foco, retorno de visibilidade e em intervalo local para refletir mudanças feitas por outro terminal.
