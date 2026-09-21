# Inventário funcional — UX Produtos e Clientes

Data-base: 2026-09-21  
Branch de trabalho: `feat/ux-products-clients-e1-e2`.

Este documento começou como o baseline das Entregas 1 e 2 e agora registra também como a fundação foi adotada pelas camadas de melhoria progressiva sem substituir os fluxos canônicos.

## Regra de paridade

A UI operacional existente continua sendo a fonte de verdade funcional. Evolução de UX não autoriza remoção, substituição silenciosa ou perda de descobribilidade de recursos já disponíveis.

Critério mínimo permanente:

- **funcionalidades depois >= funcionalidades antes**;
- regras de negócio continuam no core/serviços canônicos;
- seletores usados por módulos de extensão e QA só mudam com adaptação explícita e teste;
- os componentes da Entrega 2 são hoje consumidos pelas camadas de melhoria progressiva, sem substituir os renderers e handlers canônicos;
- kits, combos, variações, fotos, campos fiscais e endereço de cliente pertencem à superfície funcional mesmo quando são injetados por módulos separados de `app.js`;
- Produtos e Clientes devem avançar com evidências de maturidade equivalentes.

---

## 1. Shell, estado e contratos compartilhados

Arquivos principais:

| Responsabilidade | Arquivo |
| --- | --- |
| Shell, rotas e renderers-base | `desktop/renderer/app.js` |
| Contrato HTTP/IPC | `desktop/renderer/api-client.js` |
| Helpers de apresentação | `desktop/renderer/ui-model.js` |
| Bootstrap de assets | `desktop/renderer/index.html` |
| Fundação reutilizável | `desktop/renderer/ux-components.js` / `.css` |
| Domínio de catálogo | `js/domains/catalog/catalog-service.js` |
| API local | `server/router.js` |

`loadCommonData()` carrega categorias, produtos, clientes e vendedores. Os mesmos dados alimentam cadastro, checkout, estoque e relatórios; portanto Produtos e Clientes não são telas isoladas.

---

# 2. Produtos — superfície atual

## 2.1 Renderer canônico + camada Dense

Rota: `products`.

`renderProducts()` em `desktop/renderer/app.js` continua construindo página, toolbar, linhas, botões e listeners canônicos. Depois disso, `products-dense-controller.js` aplica **progressive enhancement** quando `window.PdvFeatureFlags.productsDenseView !== false`.

A camada Dense não substitui os nós que fiscal, fotos, variações e kits/combos observam. Ela acrescenta cabeçalho denso, status de estoque, filtro de estoque, hierarquia visual e atalho `Ctrl/Cmd+K`.

Seletores que permanecem contratos de integração:

- `#new-product`
- `#new-category`
- `#product-page-search`
- `#product-category-filter`
- `#sync-product-photos`
- `[data-edit-product]`
- `[data-product-photo-edit]`
- `[data-product-photo-remove]`
- `.page .data-card`
- `.data-row`
- `#product-form`

A feature flag desligada restaura a apresentação Legacy sem recriar handlers.

## 2.2 Cadastro e categoria

`openProductForm(product)` continua expondo:

- nome obrigatório;
- SKU/código e código de barras;
- categoria;
- unidade;
- preço de venda e custo;
- margem calculada;
- estoque mínimo;
- controle de estoque;
- ativo/inativo.

Persistência continua em `api.saveProduct(...)` e no serviço de catálogo. `openCategoryForm()` e `api.saveCategory(...)` continuam sendo o caminho canônico de categoria.

## 2.3 Fotos de produto

Arquivos principais:

- `desktop/renderer/app.js`
- `desktop/renderer/api-client.js`
- `desktop/product-photo-bridge.cjs`
- `js/domains/catalog/product-photo-service.js`

Ações preservadas:

- sincronização manual e status de sincronização;
- adicionar/trocar foto;
- remover foto;
- atualização da coleção após mudança.

Métodos canônicos incluem `syncProductPhotos`, `productPhotoSyncStatus`, `productPhotoDataUrl`, `uploadProductPhoto` e `removeProductPhoto`.

## 2.4 Dados fiscais — funcionalidade injetada

`desktop/renderer/product-fiscal-fields.js` amplia `#product-form` e mantém:

- perfil tributário;
- GTIN/EAN;
- resumo da tributação atual;
- persistência fiscal após salvar produto.

O módulo continua dependendo de `#new-product`, `[data-edit-product]` e `#product-form`. A UX Dense preserva esses contratos.

## 2.5 Variações/subitens — funcionalidade injetada

`desktop/renderer/product-variants-ui.js` mantém:

- produto pai;
- badge/quantidade de variações;
- estoque agregado e estoque de subitem;
- `＋ Variação`;
- linhas-filhas;
- criação/edição da variação;
- busca e seleção da variação no checkout;
- baixa de estoque da variação.

A extensão continua integrada a `.page .data-card`, `.data-row` e `[data-edit-product]`.

## 2.6 Kits e combos — funcionalidade injetada

`desktop/renderer/kits-combos-ui.js` preserva:

- `+ Kit`;
- `+ Combo`;
- bloco **Kits e combos**;
- criação/edição de kits;
- componentes e quantidades;
- criação/edição de combos;
- seleção, quantidade, preço, vigência, limite e produtos participantes;
- efeitos promocionais no checkout.

O bloco não pode desaparecer por causa da tabela Dense.

## 2.7 Persistência e integrações

`js/domains/catalog/catalog-service.js` continua sendo a fonte de verdade para validação, normalização, estoque mínimo, unidade, categoria, preço/custo, controle de estoque, ativo/inativo e auditoria `product.upsert`.

Produtos permanecem encadeados a:

- estoque e movimentações;
- checkout e venda;
- relatório por produto;
- relatório de estoque;
- fiscal;
- fotos;
- variações;
- kits/combos.

O E2E profundo cobre criação, edição, categoria, fiscal, foto, variação, kit, combo, filtros, estoque, venda, baixa e relatórios.

---

# 3. Clientes — superfície atual

## 3.1 Renderer canônico + master-detail

Rota: `customers`.

`renderCustomers()` em `desktop/renderer/app.js` continua criando os registros e listeners canônicos. `customers-master-detail-controller.js` aplica melhoria progressiva quando `window.PdvFeatureFlags.customersMasterDetailView !== false`.

Contratos preservados:

- `#new-customer`
- `#customer-page-search`
- `[data-edit-customer]`
- `#customer-form`
- `.page .data-card`
- `.data-row`

A camada nova acrescenta lista + painel de detalhe, crédito disponível, última compra, histórico e `Ctrl/Cmd+K`, mas delega edição ao botão canônico.

## 3.2 Cadastro/edição

`openCustomerForm(customer)` preserva:

- nome completo obrigatório;
- CPF/CNPJ;
- telefone;
- e-mail;
- limite de crédito;
- crédito utilizado existente;
- observações;
- ativo/inativo.

Persistência continua em `api.saveCustomer(...)` e no serviço de catálogo.

## 3.3 Endereço de entrega — funcionalidade injetada

`desktop/renderer/delivery-address-ui.js` continua ampliando `#customer-form` com:

- CEP;
- logradouro;
- número;
- complemento;
- bairro;
- cidade;
- UF;
- referência.

O módulo continua interceptando o save canônico para persistir endereço e alimentar pedidos de entrega. O painel lateral é resumo, não substituto do formulário completo.

## 3.4 Cliente no fluxo de venda

O vínculo no checkout continua usando busca/sugestões canônicas e `api.setSaleCustomer(...)`. A evolução da tela de Clientes não altera a seleção do cliente na venda.

## 3.5 Histórico e crédito

O master-detail usa histórico paginado filtrado pelo `customerId`, em vez de derivar o cliente apenas das últimas vendas globais. Isso evita falso “Sem compras” para clientes antigos.

Crédito disponível é derivado de `creditLimitCents` e `creditUsedCents`; a regra de domínio não é recriada no renderer.

## 3.6 Persistência e integrações

`upsertCustomer()` no catálogo mantém normalização/validação de nome, documento, contato, crédito, ativo/inativo, endereço e auditoria `customer.upsert`.

Clientes permanecem encadeados a:

- checkout e vínculo com venda;
- endereço de entrega;
- crédito;
- histórico de vendas;
- relatórios e auditoria.

---

# 4. Fundação reutilizável da Entrega 2

Arquivos:

- `desktop/renderer/ux-components.js`
- `desktop/renderer/ux-components.css`

Componentes:

- `DataTable`
- `StatusBadge`
- `SearchField`
- `FilterBar`
- `EmptyState`
- `ActionMenu`
- `DetailPanel`

A fundação começou inerte no baseline. No estado atual da branch ela é carregada em `index.html` e consumida pelas melhorias progressivas onde apropriado. Isso não transforma a fundação em nova fonte de regras de negócio.

---

# 5. Matriz de preservação obrigatória

| Fluxo | Fonte canônica | Preservação |
| --- | --- | --- |
| Novo/editar produto | `app.js -> openProductForm` | obrigatória |
| Nova categoria | `app.js -> openCategoryForm` | obrigatória |
| Foto de produto | `app.js` + bridge/service | obrigatória |
| Fiscal de produto | `product-fiscal-fields.js` | obrigatória |
| Variação | `product-variants-ui.js` | obrigatória |
| Kit/combo | `kits-combos-ui.js` | obrigatória |
| Novo/editar cliente | `app.js -> openCustomerForm` | obrigatória |
| Endereço | `delivery-address-ui.js` | obrigatória |
| Cliente na venda | `app.js` / API de venda | obrigatória |
| Histórico de cliente | `/api/v1/sales/history` filtrado | obrigatória |

---

# 6. Evidências de regressão e evolução pareada

A branch mantém:

- contratos funcionais automatizados;
- matriz Legacy × Dense de Produtos;
- matriz Legacy × master-detail de Clientes;
- testes de integração dos controllers;
- cross-flow Produtos → Clientes → Estoque → Venda → Relatórios;
- E2E profundo de Produtos;
- regressão do histórico paginado de Clientes;
- fallback de feature flags;
- evidência responsiva nos viewports desktop, tablet e narrow/mobile;
- `docs/architecture/ux-products-clients-evidence.json` como contrato simétrico de maturidade;
- release gate que executa as evidências no mesmo SHA.

O `PRODUCTS_UX_LEVEL` e o `CUSTOMERS_UX_LEVEL` continuam pareados, mas igualdade de nível sozinha não é suficiente: a matriz de evidências também precisa permanecer simétrica.

---

## Resultado atual

Produtos e Clientes continuam apoiados nos renderers canônicos e nos módulos já existentes, enquanto as novas camadas melhoram organização, densidade e descoberta. O fallback Legacy permanece reversível; a evolução futura das duas telas deve preservar simultaneamente funcionalidade, integração, E2E e evidência visual/responsiva.
