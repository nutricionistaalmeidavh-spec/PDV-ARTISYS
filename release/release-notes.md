# ArtiSys PDV 1.1.0 — Restaurante

Release local-first que amplia o PDV 1.0 com operação completa de restaurante sem transformar nuvem ou serviço pago em dependência do núcleo.

## Entregas E30–E39

- **E30 — Impressão operacional não fiscal:** cupom de venda, pré-conta, pedido de cozinha e fechamento de caixa usando a fila durável já existente.
- **E31 — Mesas e comandas:** mapa de mesas, abertura de sessão, pedidos, observações, transferência e fechamento convertido para a venda canônica do PDV.
- **E32 — Cozinha/KDS:** setores de produção, vínculo produto→setor, tickets duráveis, estados novo/em preparo/pronto e roteamento opcional por impressora.
- **E33 — Garçom na LAN:** dispositivo com credencial própria para visualizar mesas/chamados, abrir mesa, lançar pedido e atender solicitações.
- **E34 — Tablet de mesa:** cardápio local, pedidos, conta atual, chamar garçom e solicitar fechamento, sempre vinculado a uma mesa.
- **E35 — Workspace desktop:** operação de restaurante integrada à interface Electron, sem duplicar o motor de vendas, caixa ou estoque.
- **E36 — Cliente móvel self-hosted:** interface HTML/CSS/JS servida diretamente pelo servidor local em `/mobile`, sem CDN, SaaS ou internet.
- **E37 — Relatórios do restaurante:** pedidos, faturamento bruto, ticket médio, origem dos pedidos, produtos mais vendidos e exportação CSV.
- **E38 — Hardening e QA:** credenciais móveis com hash, bloqueio/rotação, idempotência por mutation ID, testes de LAN e regressão junto da suíte existente.
- **E39 — Release 1.1.0:** versão, documentação operacional, capability manifest e gates de release atualizados.

## Arquitetura e dependências

O banco continua SQLite local com migrações incrementais. O servidor central continua autoritativo na LAN. O restaurante reaproveita `SaleService`, `CashService`, estoque, EventBus/outbox, impressão, auditoria, backup e observabilidade existentes.

O core não exige serviço externo. Emissão fiscal permanece uma camada opcional e explicitamente configurável. A UI móvel é servida pelo próprio PDV e deve ser usada em rede local confiável; não é apresentada como transporte HTTPS.
