# UX contract — ArtiSys PDV

## Canonical behavior

The local server and `js/core/modules/module-registry.js` own the optional-module definitions: stable ID, customer-facing name, description, family/area, dependency list, route ID, icon, allowed roles, management roles, and default activation. `js/core/modules/module-service.js` owns persisted activation and server-side authorization. Renderer code consumes the returned catalog; it must not maintain parallel module labels, family membership, icons, or permission lists.

`desktop/renderer/restaurant-module-gate.js` is the sole renderer-side cache of the last authoritative module catalog. It publishes `artisys:modules-state-changed` with `{catalog, modules, changedIds}`. A failed refresh preserves the last known catalog and displays/handles request errors at the affected operation; it does not synthesize a module state. `desktop/renderer/vertical-modules.js` derives settings, grouped navigation, role visibility, and route selection from that catalog. `desktop/renderer/module-state-sync.js` uses stable route IDs, never translated headings.

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

- Public ordering requires both `RESTAURANT` and `SELF_SERVICE` to be enabled. Each table has an opaque, locally generated QR token; the token identifies only that table and never grants administrative access.
- `/m/:token` is a public customer surface. It does not use `x-device-id`, `x-device-key`, operator login, or desktop session credentials.
- The public product projection contains only customer-safe fields: product/category name, public description, sale price, availability, photo presence, and sanitized option/variant/combo labels and price deltas. Never serialize cost, recipe/ficha técnica, SKU, barcode, stock quantity, user, credential, or filesystem fields into this response.
- Public descriptions are independent metadata. A recipe may inform a human-authored menu description, but the system does not expose or automatically publish recipe lines.
- The browser never owns the authoritative price. It may show an estimate from safe deltas, but submission sends product/selection identifiers; the local server runs canonical configuration pricing and persists the resulting snapshot/price.
- If `autoOpenTable` is enabled, the first confirmed QR order may open the table session. If disabled, orders are rejected until a session exists; a waiter call may establish an empty service session so staff can attend the table.
- Public mutations use mutation IDs. Order success is shown only after the server confirms persistence; on failure the cart remains intact and the UI identifies what is still usable.
- Public orders enter the existing `restaurant.addOrder()` path and the existing event dispatch to kitchen. No second order store or kitchen queue is allowed.
- Rotating a table QR invalidates the previous token. The desktop UI uses an app-owned confirmation step before rotation.

## Restaurante: equipe móvel e PWA

- `/mobile` is staff-only and continues to use paired device credentials. Customer QR users must never be directed to the device login screen.
- Waiter mode prioritizes table state, service calls and fast order entry across all authorized tables. Kitchen mode prioritizes `Novo → Em preparo → Pronto` production lanes. Paired table and self-service kiosk modes retain their existing device contracts.
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
- Na base Caixa, vendas registradas em `STORE_CREDIT` não são reconhecidas como receita recebida enquanto não houver recebimento financeiro efetivo. O valor ainda a prazo deve ser identificável no contexto da DRE.
- A DRE pode ser exportada em CSV sem alterar seu cálculo e permite navegar para sua composição. Gestão e Relatórios possuem navegação explícita entre si sem duplicar regras de cálculo.
- Relatórios comerciais oferecem atalhos de período, abas acessíveis por teclado e drill-down das linhas de cliente, produto e meio de pagamento para as vendas de origem.
- A tabela principal de produtos prioriza quantidade líquida, receita líquida, custo, margem e margem percentual. O CSV continua preservando o detalhamento analítico completo.
- Alterações P1/P2 permanecem restritas às áreas Financeiro, Gestão/DRE e Relatórios; páginas já aprovadas fora desse escopo não devem sofrer redesign incidental.
