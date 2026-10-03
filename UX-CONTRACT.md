# UX contract — ArtiSys PDV

## Canonical behavior

The local server and `js/core/modules/module-registry.js` own the optional-module definitions: stable ID, customer-facing name, description, family/area, dependency list, route ID, icon, allowed roles, management roles, and default activation. `js/core/modules/module-service.js` owns persisted activation and server-side authorization. Renderer code consumes the returned catalog; it must not maintain parallel module labels, family membership, icons, or permission lists.

`desktop/renderer/restaurant-module-gate.js` is the sole renderer-side cache of the last authoritative module catalog. It publishes `artisys:modules-state-changed` with `{catalog, modules, changedIds}`. A failed refresh preserves the last known catalog and displays/handles request errors at the affected operation; it does not synthesize a module state. `desktop/renderer/vertical-modules.js` derives settings, navigation, role visibility, and route selection from that catalog. `desktop/renderer/module-state-sync.js` uses stable route IDs, never translated headings.

## Core commercial capabilities

Product variants, recipes/ficha técnica, stock behavior and weighted sale are Core capabilities. They must not depend on a retail, market, bakery or other segment module. A product sold in KG/G may use manual weight or the configured local scale in the canonical checkout.

## Module lifecycle

1. Administrator activates or deactivates a catalog entry in Settings.
2. The server validates role, dependencies, and persistence; the UI reports success only after the server accepts the change.
3. The returned catalog updates the renderer cache and triggers one state-change event.
4. Navigation and module settings are regenerated from the same catalog. Disabled modules are absent from navigation and cannot be opened by a stale link.
5. A user sees only entries permitted by their role. A user who cannot manage modules can still see the permitted operational destinations but cannot change activation.
6. Disabling a module does not delete its operational history. Shared core services remain available to other authorized workflows.

An area whose navigation mode is `group` has exactly one sidebar destination; its enabled modules are presented inside that area. Standalone areas route to their own catalog entry. Do not persist compatibility aliases or map old labels to routes.

## Loading, failure, and feedback

- Every module API request that can delay navigation/settings has a bounded timeout and visible retry action.
- Refreshes are single-flight; no repeated network fetch is triggered merely by sidebar rendering or DOM mutations.
- A timeout affects only the requested module panel and never blocks Home, the sidebar, cash register, or other routes.
- On save failure, restore the switch to its authoritative value and explain the failure. Never show a successful state before the server confirms it.
- On refresh failure, retain the last known authoritative catalog; identify that state as stale when the UI has a suitable status surface. Do not silently fall back to local defaults.
- After disabling the currently open capability, route to its still-enabled parent area when possible; otherwise return to Home.

## Access and data safety

- `manageRoles` in the catalog defines module-management roles; the server independently enforces the same declaration for activation. The internal `system` actor remains permitted for setup/automation.
- Catalog `accessRoles` govern renderer navigation, but are not a replacement for server-side permission checks on API operations.
- A hidden sidebar entry is not an authorization boundary. Keep route-level and API-level gates.
- Never remove module data or historical records as a side effect of hiding/deactivating navigation.

## Product invariants

- Brazilian Portuguese is the user-facing language; internal IDs/enums must not leak into the normal workflow.
- Operational sales, inventory, cash, and audit remain shared core capabilities.
- Cloud telemetry remains independent of module activation and local operation.
- Home and other specifically approved screens are protected from incidental redesign.
- User-facing error states state what failed, what remains usable, and the next safe action.

## Restaurante: ordering público por QR

- Public ordering requires the `FOOD` / Alimentação area to be enabled. Pedidos and Produção/KDS are structural parts of Alimentação; self-service is a channel of that same area, not a separate module. Each table has an opaque, locally generated QR token; the token identifies only that table and never grants administrative access.
- `/m/:token` is a public customer surface. It does not use `x-device-id`, `x-device-key`, operator login, or desktop session credentials.
- The public product projection contains only customer-safe fields: product/category name, public description, sale price, availability, photo presence, and sanitized option/variant/combo labels and price deltas. Never serialize cost, recipe/ficha técnica, SKU, barcode, stock quantity, user, credential, or filesystem fields into this response.
- Public descriptions are independent metadata. A recipe may inform a human-authored menu description, but the system does not expose or automatically publish recipe lines.
- The browser never owns the authoritative price. It may show an estimate from safe deltas, but submission sends product/selection identifiers; the local server runs canonical configuration pricing and persists the resulting snapshot/price.
- If `autoOpenTable` is enabled, the first confirmed QR order may open the table session. If disabled, orders are rejected until a session exists; a waiter call may establish an empty service session so staff can attend the table.
- Public mutations use mutation IDs. Order success is shown only after the server confirms persistence; on failure the cart remains intact and the UI identifies what is still usable.
- Public orders enter the existing `restaurant.addOrder()` path and the existing event dispatch to kitchen. No second order store or kitchen queue is allowed.
- Restaurant menu items use an explicit service route: `DIRECT` remains on the command and never creates a KDS ticket; `PRODUCTION` requires an active production station and is the only mode routed to KDS. An item with no route is a configuration error, never an implicit direct-service item.
- Rotating a table QR invalidates the previous token. The desktop UI uses an app-owned confirmation step before rotation.


## Convenções de operação — datas, feedback e catálogo

- Campos de data digitáveis do desktop exibem e aceitam **dd/mm/aaaa**; data e hora usam **dd/mm/aaaa hh:mm**. Valores canônicos enviados aos serviços permanecem ISO/AAAA-MM-DD conforme o contrato de cada API.
- O desktop mantém no máximo uma notificação transitória gerenciada por vez. Feedback de sucesso sem ação pendente é descartado ao trocar de rota; erros permanecem até o ciclo normal de fechamento para não ocultar falhas.
- No Balcão, quando existe item na venda, a região de carrinho preserva espaço mínimo suficiente para conferir item, quantidade/preço e total antes de **Finalizar venda**, inclusive no viewport compacto do gate.
- **Produtos** é a visão do catálogo de venda (nome, preço, categoria e disponibilidade comercial). **Estoque** continua sendo a superfície operacional para saldo, insumos e fichas técnicas; Produtos oferece um atalho explícito para essa área sem duplicar o cadastro canônico.
- Ações de criação usam texto/glyphs portáveis (`+`) e não dependem de glifos específicos da fonte do sistema.


## Restaurante: equipe móvel e PWA

- `/mobile` is staff-only and continues to use paired device credentials. Customer QR users must never be directed to the device login screen.
- Waiter mode prioritizes table state, service calls and fast order entry across all authorized tables. After submission, the selected table keeps its command visible: `DIRECT` items are labelled as direct service, while production items reflect the canonical order state (`Novo → Em preparo → Pronto`). Kitchen mode prioritizes the same production lanes and never receives `DIRECT` items. Paired table and self-service kiosk modes retain their existing device contracts.
- Staff mutations disable the initiating control while pending and use pessimistic confirmation. Background refresh is single-flight and must not erase a local in-progress cart.
- Manifest/service worker registration occurs only in secure contexts (HTTPS or localhost). LAN HTTP remains supported as an ordinary web application and is not labelled installable PWA.
- Service-worker caching is limited to the staff application shell. `/api/` requests remain network-authoritative and are never satisfied from an offline cache.



## Financeiro e Gestão: confiança P0

- Na área Gestão, os KPIs de receita, resultado e margem usam a mesma base selecionada na DRE: `cash` para Caixa e `accrual` para Competência. Uma tela não pode misturar bases sem identificação explícita.
- A comparação com o período anterior usa o intervalo imediatamente precedente com a mesma quantidade inclusiva de dias do período atual. A interface mostra as datas efetivamente comparadas.
- Baixa e cancelamento de lançamentos financeiros usam diálogo próprio do ArtiSys. Não usar `prompt()`, `confirm()` ou `alert()` nesses fluxos. A mutação ocorre somente após confirmação explícita; em falha, o diálogo permanece aberto com o contexto preenchido e mensagem local.
- A conciliação bancária exige revisão visível da sugestão antes de registrar a baixa. A revisão mostra o movimento do extrato, o lançamento candidato, valores, datas e os critérios objetivos usados na correspondência.
- Ignorar uma sugestão exige motivo, registra a decisão com auditoria e impede que o mesmo par movimentação-lançamento seja sugerido novamente. Ignorar não marca a movimentação como conciliada, permitindo avaliar outro candidato.
- Essas regras são restritas aos fluxos financeiros/gerenciais envolvidos e não autorizam alterações visuais ou comportamentais incidentais nas páginas já aprovadas.


## Financeiro, DRE e Relatórios: rastreabilidade P1/P2

- Lançamentos financeiros usam categoria gerencial, centro de custo e competência como dimensões canônicas. O campo livre de categoria não faz parte do fluxo normal de criação; valores legados permanecem somente para compatibilidade histórica.
- Todo lançamento financeiro permite abrir detalhes e consultar o histórico completo de baixas, inclusive baixas estornadas. Estorno exige motivo e preserva a baixa original no histórico.
- Filtros do Financeiro podem combinar busca, tipo, situação, vencimento, categoria e centro de custo. Valores técnicos como `PAYABLE`, `RECEIVABLE`, `OPEN`, `PARTIAL`, `SETTLED` e naturezas DRE não aparecem como rótulo normal para o usuário.
- Grupos da DRE são os agrupadores apresentados na Gestão; categorias vinculadas ao mesmo grupo são consolidadas e a ordem configurada do grupo é respeitada. Cada grupo preserva referências aos lançamentos ou vendas que compõem o valor.
- A DRE pode ser exportada em CSV sem alterar seu cálculo e permite navegar para sua composição. Gestão e Relatórios possuem navegação explícita entre si sem duplicar regras de cálculo.
- Relatórios comerciais oferecem atalhos de período, abas acessíveis por teclado e drill-down das linhas de cliente, produto e meio de pagamento para as vendas de origem.
- A tabela principal de produtos prioriza quantidade líquida, receita líquida, custo, margem e margem percentual. O CSV continua preservando o detalhamento analítico completo.
- Alterações P1/P2 permanecem restritas às áreas Financeiro, Gestão/DRE e Relatórios; páginas já aprovadas fora desse escopo não devem sofrer redesign incidental.

## Ownership de rotas e lifecycle do renderer

- `desktop/renderer/route-registry.js` é o owner canônico da resolução de rotas internas do desktop. Cada route ID possui exatamente um renderer registrado; um segundo owner para a mesma rota é erro de contrato.
- `desktop/renderer/ui-lifecycle.js` publica `route:before`, `route:mounted`, `route:updated`, `route:unmounted` e `route:error`. Extensões novas devem reagir a lifecycle/eventos semânticos em vez de observar o DOM para descobrir mudanças provocadas pelo próprio ArtiSys.
- `app.js` possui Home, Balcão, Clientes, Equipe, Gestão, Cardápio e os hubs agrupadores. `operational-pages.js` possui Estoque, Caixa, Últimas vendas, Financeiro e Configurações. `reporting-v2.js` possui Relatórios. `returns-ui.js` possui Devoluções.
- Financeiro possui navegação interna canônica e explícita: `finance` = Lançamentos (owner `operational-pages`), `finance-banks`, `finance-recurrences` e `finance-alerts` = operações financeiras (owner `erp-finance-operations`). Essas rotas são alcançadas por navegação semântica e nunca por inspeção/mutação do DOM.
- Gestão permanece dona de DRE, fluxo de caixa, comparação e drill-down gerencial; conciliação bancária, transferências entre contas próprias, recorrências e alertas pertencem às rotas do Financeiro.
- A edição de categoria gerencial, centro de custo e competência altera as dimensões do lançamento financeiro canônico; não cria lançamento, espelho ou registro financeiro paralelo.
- O antigo watchdog `operational-route-stability.js` não faz parte da arquitetura atual. Uma rota não deve ser recriada em resposta a `MutationObserver`; conflitos de ownership devem falhar nos testes/registro.
- O orçamento de `MutationObserver` do renderer não pode aumentar silenciosamente. Observers legados permanecem somente durante migrações progressivas já documentadas e devem ser substituídos por lifecycle/owners explícitos quando a superfície for migrada.
- O gate de UI executa `all-pages-audit` em Electron a 1366×768 e 1024×768, verifica overflow horizontal, controles críticos e que a finalização do Balcão permaneça dentro do viewport. O job de UI também sobe o servidor local e valida `/mobile` e `/m/:token`. Screenshots/trace permanecem como evidência; o gate continua sendo smoke estrutural/visual e não substitui testes transacionais específicos.



## P3/P4 — lifecycle sem observers em Shell e Configurações

- Home clássica reage a `route:mounted`, `route:updated` e `user:changed`; não observa mais `#route-content` nem atributos do `body`.
- Preservação de scroll reage a `route:before`/`route:mounted` e mantém a intenção de retorno por `data-scroll-restore`/back.
- Primeiro acesso reage a `auth:rendered`; `app.js` publica auth somente depois de ligar os formulários canônicos.
- Observação de venda reage ao lifecycle do Balcão e ao update semântico `sales/sale-detail`.
- Admin, configuração fiscal, monitor fiscal e NFS-e montam exclusivamente pela rota `settings`, anunciam a própria extensão e não observam mutações de DOM.
- O Settings Hub não possui mais observer de compatibilidade: extensões de Configurações devem publicar `route:updated('settings')` após inserir sua superfície.
- Orçamento máximo de `MutationObserver` no renderer após P3/P4: **14**. Nenhum novo observer pode ser incluído sem reduzir ou atualizar explicitamente esse contrato.


## P5 — extensões operacionais simples sem observers

- Gestão de catálogo/usuários reage a `route:mounted`, `route:updated`, `surface:mounted` e `user:changed`; não observa mais mutações do `#route-content`.
- Endereço de entrega reage a `modal:mounted` para o formulário de cliente e a `inventory/enterprise-orders` para pedidos; o snapshot de endereço continua sendo responsabilidade do domínio.
- Kits e combos reagem ao lifecycle de Produtos/Balcão e preservam os contratos de promoção e bloqueio de desconto manual.
- `module-state-sync.js` reage ao lifecycle de rota/superfície e usa o registry canônico para atualizar Configurações.
- Campos operacionais amigáveis reagem a rota, modal e módulo montados; não existe varredura acionada por mutações de DOM.
- `enterprise-depth-ui.js` publica updates semânticos de Compras, Logística e Pedidos; `vertical-modules.js` publica `surface:mounted` para área e workspace.
- Orçamento máximo de `MutationObserver` após P5: **9**. Os observers restantes pertencem às extensões complexas reservadas ao P6.


## Intuitividade P2 — reconhecimento e separação de contexto

- A navegação lateral de alto nível combina ícone e rótulo textual curto. O ícone continua servindo ao operador frequente, mas o rótulo elimina a necessidade de decorar destinos como Balcão, Caixa, Vendas, Cadastros e Gestão.
- Os rótulos curtos não alteram route IDs, permissões, atalhos de teclado ou a navegação canônica; `title` e `aria-label` continuam usando o nome completo do destino.
- **Mesas e comandas** abre sempre em **Operação**. Mapa de mesas, comanda ativa, chamados e KDS permanecem na rotina principal.
- **Configuração** de Alimentação é uma visão separada, acessível somente a gerente/administrador. Setores de produção, dispositivos LAN e indicadores/CSV não ficam misturados à rotina de salão.
- Trocar entre Operação e Configuração preserva a comanda selecionada; ao retornar para Operação, o contexto operacional é restaurado.
- O P2 não cria um segundo domínio ou segunda fonte de dados: ambas as visões usam os mesmos serviços de restaurante, pedidos, KDS e relatórios locais.

## Produto P5/P6 — ativação e navegação final

- **Configurações → Áreas** é a superfície canônica para ativar Alimentação e Atacado.
- O **Núcleo ArtiSys** permanece sempre ativo: Balcão/Caixa, Cardápio/Estoque, Clientes e Gestão/Relatórios não são módulos opcionais.
- A aba Áreas carrega automaticamente; não existe uma segunda etapa “Gerenciar módulos”.
- Ativar ou desativar uma área atualiza a navegação imediatamente e preserva os domínios canônicos compartilhados.
- O menu lateral e o Início usam apenas fluxos de alto nível. Para caixa: Início, Balcão, Caixa, Vendas e devoluções e Cadastros. Para gerente, soma-se Gestão financeira. Para administrador, somam-se Gestão financeira e o atalho Configurações; a ativação de áreas continua exclusiva de Configurações → Áreas.
- **Cadastros** agrupa Clientes, Cardápio/produtos, Estoque e Equipe, filtrando as opções conforme a permissão do perfil.
- Rotas internas permanecem estáveis para atalhos, deep links e integrações; simplificar a navegação não remove funcionalidades.
- Alimentação e Atacado aparecem como entradas adicionais somente quando a área está ativa e o perfil possui acesso.
- O Balcão continua sendo o faturamento canônico para vendas avulsas, comandas e pedidos de Atacado.


## Escopo de produto — alimentação e B2B

- O produto ativo é **Core + Alimentação + Atacado**.
- Não existe área de Serviços, agenda de profissionais ou comissão paralela por serviço.
- Pessoas e acessos pertencem a **Equipe**; comissões pertencem ao motor canônico do Core.
- Tabelas `service_*` antigas permanecem somente como legado preservado e não possuem runtime, API, onboarding, navegação ou UI ativa.
- A necessidade de agenda do Atacado é representada pela previsão de entrega/retirada do pedido (`expectedAt`), não por agenda de profissionais.
