# Inventário funcional — UX Produtos e Clientes

Data-base: 2026-09-21  
Escopo: Entrega 1 do roadmap de UX de Produtos e Clientes.  
Branch de trabalho: `feat/ux-products-clients-e1-e2`.

## Regra de paridade

A UI atual é a fonte de verdade funcional para as próximas entregas. A migração visual não pode remover, substituir silenciosamente ou tornar inacessível nenhum fluxo já disponível.

Critério mínimo para qualquer troca de tela futura:

- funcionalidades depois >= funcionalidades antes;
- regras de negócio continuam no core/serviços atuais;
- seletores usados por módulos de extensão e QA só podem mudar com adaptação explícita e teste;
- componentes criados na Entrega 2 permanecem inertes nesta branch: não substituem Produtos nem Clientes;
- kits, combos, variações, fotos, campos fiscais e endereço de cliente fazem parte da superfície funcional mesmo quando são injetados por módulos separados de `app.js`.

---

## 1. Shell, rota e estado compartilhado

### Arquivos principais

| Responsabilidade | Arquivo atual |
| --- | --- |
| Shell desktop / rotas / telas-base | `desktop/renderer/app.js` |
| Contrato HTTP/IPC usado pelo renderer | `desktop/renderer/api-client.js` |
| Busca, atalhos e helpers de apresentação | `desktop/renderer/ui-model.js` |
| Estilos do shell e telas-base | `desktop/renderer/styles.css` |
| Bootstrap de scripts | `desktop/renderer/index.html` |
| Persistência e validações de catálogo | `js/domains/catalog/catalog-service.js` |
| API local | `server/router.js` |
| Schema/migrations canônicas | `js/core/database/migrations.js` e migrations de release/recursos |

`app.js` mantém no estado de tela, entre outros:

- `products`, `categories`, `customers`;
- `productQuery`, `categoryId`, `customerQuery`;
- `selectedProductId` para venda;
- `photoSyncStatus`;
- usuário, caixa e venda corrente que conectam cadastro com operação.

`loadCommonData()` carrega categorias, produtos, clientes e vendedores em conjunto. Portanto, Produtos e Clientes não são ilhas: os mesmos objetos alimentam balcão, venda e cadastros.

---

# 2. Produtos — superfície atual

## 2.1 Entrada e renderização-base

Rota: `products`  
Renderer-base: `renderProducts()` em `desktop/renderer/app.js`.

A tela-base atual expõe:

1. título e descrição do catálogo;
2. `Sincronizar fotos agora`;
3. `Categoria`;
4. `Novo produto`;
5. busca por nome, SKU ou código de barras;
6. filtro por categoria;
7. estado da sincronização de fotos;
8. lista dos produtos ativos retornados pela API;
9. nome, SKU, categoria, preço, custo, estoque e unidade por produto;
10. adicionar/trocar foto;
11. remover foto quando existente;
12. editar produto;
13. estado vazio quando não há registros filtrados.

### Seletores/contratos de DOM que não podem sumir sem migração coordenada

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

Os módulos de variações e kits/combos observam a tela e dependem dessa estrutura ou desses seletores.

## 2.2 Busca e filtros

A busca é aplicada por `ui.filterProducts(...)` usando `state.productQuery` e `state.categoryId`.

Contrato a preservar:

- texto digitado permanece no estado durante rerender;
- filtro de categoria permanece no estado;
- busca considera os identificadores de produto suportados pelo helper atual;
- a tela atual volta o foco ao campo após rerender por digitação.

Qualquer futura tabela densa deve reaproveitar a mesma semântica antes de introduzir filtros novos.

## 2.3 Cadastro/edição de produto

Modal-base: `openProductForm(product)`.

Campos atuais:

- nome obrigatório;
- SKU/código;
- código de barras;
- categoria;
- unidade (`UN`, `KG`, `LT`, `CX`);
- preço de venda;
- custo;
- margem calculada;
- estoque mínimo;
- controlar estoque;
- produto ativo.

Comportamentos:

- margem é recalculada ao editar preço/custo;
- salvar usa `api.saveProduct(...)`;
- item salvo é atualizado/inserido no estado local;
- coleção local é reordenada por nome;
- tela Produtos é rerenderizada após sucesso.

## 2.4 Categoria

Modal: `openCategoryForm()`.

- cria categoria por nome;
- usa `api.saveCategory(...)`;
- atualiza e reordena `state.categories`;
- rerenderiza Produtos.

A futura UX não pode eliminar a criação de categoria apenas porque o mockup mostra somente um filtro de categoria.

## 2.5 Fotos de produto

Arquivos relevantes:

- `desktop/renderer/app.js`;
- `desktop/renderer/api-client.js`;
- `desktop/product-photo-bridge.cjs`;
- `js/domains/catalog/product-photo-service.js`.

Operações expostas na tela atual:

- sincronização manual;
- acompanhamento de sincronização em segundo plano;
- seleção/upload;
- troca;
- remoção com período de segurança indicado pela UI;
- atualização da coleção após mudança.

Métodos de cliente atuais:

- `syncProductPhotos(force)`;
- `productPhotoSyncStatus()`;
- `productPhotoDataUrl(productId, variant)`;
- `uploadProductPhoto(productId)`;
- `removeProductPhoto(productId)`.

Essas ações precisam continuar descobríveis na futura tabela/listagem.

## 2.6 Dados fiscais — funcionalidade injetada

Arquivo: `desktop/renderer/product-fiscal-fields.js`.

Esse módulo amplia `#product-form` depois que o modal abre e adiciona:

- perfil tributário;
- GTIN/EAN;
- resumo da tributação atual;
- persistência fiscal após confirmação do cadastro do produto.

Ele identifica criação por `#new-product` e edição por `[data-edit-product]`.

**Guardrail:** trocar esses seletores sem adaptar `product-fiscal-fields.js` quebra funcionalidade já existente mesmo que o formulário visual pareça correto.

## 2.7 Variações/subitens — funcionalidade injetada

Arquivo: `desktop/renderer/product-variants-ui.js`.

Na tela Produtos o módulo atualmente:

- carrega pais e variações;
- insere badge de produto pai;
- mostra quantidade de variações ativas;
- mostra estoque agregado/indicação de estoque nos subitens;
- injeta botão `＋ Variação` antes de editar;
- insere linhas-filhas de variações;
- permite editar variação;
- encontra variações pela busca mesmo quando o pai não está visível;
- usa `[data-edit-product]`, `.page .data-card` e `.data-row` como pontos de integração.

No Balcão ele também:

- transforma produto pai com variações em escolha de subitem;
- permite localizar subitens pela busca;
- adiciona a variação correta à venda;
- controla estoque da variação.

**Guardrail:** a futura lista Produtos deve tratar variações como parte do fluxo existente, não como recurso opcional a ser descartado.

## 2.8 Kits e combos — funcionalidade injetada

Arquivo: `desktop/renderer/kits-combos-ui.js`.

Ao detectar a página Produtos, o módulo adiciona:

- botão `+ Kit`;
- botão `+ Combo`;
- bloco `Kits e combos` ao final da tela;
- lista de kits;
- lista de combos promocionais;
- edição de kits;
- edição de combos.

Kit inclui, entre outros:

- nome, SKU, código de barras, categoria;
- preço e custo;
- componentes e quantidades;
- ativo/inativo;
- regra de baixa dos componentes, sem estoque paralelo do kit.

Combo inclui, entre outros:

- nome;
- modo de seleção;
- quantidade requerida;
- preço do combo;
- limite de aplicações;
- vigência;
- produtos participantes;
- acumulação ou bloqueio de desconto manual;
- ativo/inativo.

O mesmo módulo também mostra efeitos promocionais no checkout.

**Guardrail absoluto:** `Kits e combos` não pode desaparecer quando a lista de produtos migrar para tabela.

## 2.9 Persistência e regras de domínio de produto

Serviço canônico: `js/domains/catalog/catalog-service.js`.

`upsertProduct()` valida/persiste:

- nome obrigatório;
- valores monetários em centavos;
- preço/custo não negativos;
- estoque mínimo válido e não negativo;
- SKU/código de barras opcionais normalizados;
- categoria;
- unidade;
- controle de estoque;
- ativo/inativo;
- criação do saldo de estoque quando necessário;
- auditoria `product.upsert`.

`listProducts()` agrega:

- categoria;
- saldo atual;
- metadados de foto quando o recurso está presente.

A UI futura deve exibir estados derivados desses dados; não deve recriar regras de persistência no renderer.

## 2.10 API atual de Produtos

Pelo cliente canônico e extensões atuais:

- `GET /api/v1/categories`
- `POST /api/v1/categories`
- `GET /api/v1/products`
- `POST /api/v1/products`
- APIs de produto fiscal em `/api/v1/products/:id/fiscal`
- APIs de variações em `/api/v1/product-variants...`
- APIs de kits/combos pelo cliente/roteador dedicado
- fotos trafegam pelo bridge desktop, não por um botão puramente visual.

---

# 3. Clientes — superfície atual

## 3.1 Entrada e renderização-base

Rota: `customers`  
Renderer-base: `renderCustomers()` em `desktop/renderer/app.js`.

A tela-base atual expõe:

1. título e descrição;
2. `Novo cliente`;
3. busca por nome, CPF/CNPJ ou telefone;
4. lista de clientes ativos;
5. nome;
6. documento;
7. telefone;
8. limite de crédito;
9. editar;
10. estado vazio.

### Seletores/contratos de DOM a preservar ou migrar explicitamente

- `#new-customer`
- `#customer-page-search`
- `[data-edit-customer]`
- `#customer-form`
- `.page .data-card`
- `.data-row`

## 3.2 Busca

`renderCustomers()` normaliza o texto e filtra em memória por:

- nome;
- documento;
- telefone.

O campo mantém `state.customerQuery` e recupera foco após o rerender.

A proposta futura pode mostrar lista + painel lateral, mas a busca existente continua sendo comportamento obrigatório.

## 3.3 Cadastro/edição de cliente

Modal-base: `openCustomerForm(customer)`.

Campos base atuais:

- nome completo obrigatório;
- CPF/CNPJ;
- telefone;
- e-mail;
- limite de crédito;
- observações;
- cliente ativo.

Ao salvar:

- usa `api.saveCustomer(...)`;
- preserva `creditUsedCents` do registro em edição;
- atualiza/insere no estado;
- reordena por nome;
- volta à tela Clientes.

## 3.4 Endereço de entrega — funcionalidade injetada

Arquivo: `desktop/renderer/delivery-address-ui.js`.

O módulo observa `#customer-form` e acrescenta:

- CEP;
- logradouro;
- número;
- complemento;
- bairro;
- cidade;
- UF;
- referência.

Também intercepta `ApiClient.prototype.saveCustomer` para anexar o endereço persistido ao mesmo cadastro.

O mesmo endereço alimenta pedidos com entrega e é copiado para o pedido para preservar o endereço usado na operação.

**Guardrail:** uma futura ficha lateral é resumo; ela não pode substituir o formulário completo nem eliminar endereço/observações/outros campos.

## 3.5 Cliente no fluxo de venda

Clientes também participam do Balcão:

- `customerSearchInput()` e `renderCustomerSuggestions()` buscam cliente durante a venda;
- a sugestão considera nome, documento e id;
- `setCustomer(customerId)` garante venda aberta e usa `api.setSaleCustomer(...)`;
- `selectedCustomer()` resolve o cliente vinculado à venda atual.

Logo, qualquer evolução do cadastro deve manter compatibilidade com seleção/vínculo no checkout.

## 3.6 Persistência e regras de domínio de cliente

Serviço canônico: `js/domains/catalog/catalog-service.js`.

`upsertCustomer()` trata:

- nome obrigatório;
- documento normalizado;
- telefone/e-mail/observações opcionais;
- limite e crédito utilizado em centavos;
- valores de crédito não negativos;
- ativo/inativo;
- endereço normalizado quando informado;
- CEP com 8 dígitos;
- UF com 2 letras;
- auditoria `customer.upsert`.

`rowToCustomer()` retorna ainda `creditUsedCents`, mesmo que a listagem-base mostre hoje principalmente o limite.

A futura UI pode expor melhor saldo/crédito, mas deve derivar isso do contrato persistido, não de estado visual inventado.

## 3.7 API atual de Clientes

- `GET /api/v1/customers`
- `POST /api/v1/customers`
- vínculo com venda: `POST /api/v1/sales/:id/customer`

O cliente do renderer suporta `includeInactive` para consultas administrativas quando módulos precisam dos registros inativos.

---

# 4. Modais e extensões que participam da migração

| Fluxo | Implementação atual | Deve sobreviver à mudança visual |
| --- | --- | --- |
| Novo/editar produto | `app.js -> openProductForm` | Sim |
| Nova categoria | `app.js -> openCategoryForm` | Sim |
| Foto produto | `app.js` + photo bridge/service | Sim |
| Dados fiscais do produto | `product-fiscal-fields.js` | Sim |
| Nova/editar variação | `product-variants-ui.js` | Sim |
| Novo/editar kit | `kits-combos-ui.js` | Sim |
| Novo/editar combo | `kits-combos-ui.js` | Sim |
| Novo/editar cliente | `app.js -> openCustomerForm` | Sim |
| Endereço do cliente | `delivery-address-ui.js` | Sim |
| Selecionar cliente em venda | `app.js` | Sim |

---

# 5. Queries, estado, eventos e auditoria

## Queries/leituras principais

- categorias, produtos, clientes são carregados por `loadCommonData()`;
- Produtos aplica busca + categoria no renderer;
- Clientes aplica busca no renderer;
- variações, kits, combos e campos fiscais fazem leituras próprias por seus clientes/rotas;
- saldo de estoque exibido em produto vem do domínio/banco, não de um contador local isolado.

## Eventos e efeitos

A arquitetura do PDV possui EventBus/outbox para operações de domínio, mas os cadastros-base de produto/cliente registram auditoria diretamente no serviço de catálogo (`product.upsert`, `customer.upsert`, `category.upsert`).

Para as Entregas 1 e 2 não será criado evento novo: são inventário + fundação de apresentação, sem mudança de regra de negócio.

---

# 6. Permissões e segurança da superfície

- toda comunicação canônica do `ApiClient` usa a sessão do operador;
- `app.js` possui bloqueio explícito por papel em algumas telas, como Vendedores;
- Produtos e Clientes não possuem hoje um `renderPermissionDenied(...)` próprio no renderer-base;
- portanto a migração de UX não deve inventar uma nova política de autorização local;
- eventuais restrições existentes no servidor/core continuam sendo a fonte de verdade.

A futura camada de componentes deve apenas refletir `disabled`, `hidden` ou ações permitidas quando a regra vier do fluxo real; não duplicar RBAC no HTML.

---

# 7. Testes e contratos de regressão relevantes

Arquivos já existentes que cobrem partes do território:

- `test/desktop-shell.test.js`
- `test/ui-model.test.js`
- `test/ui-api-routes.test.js`
- `test/catalog-service.test.js`
- `test/kits-combos.test.js`
- `test/kits-combos-api.test.js`
- `test/product-parent-variants.test.js`
- testes de fiscal/paridade relacionados a produto;
- QA de fluxo em `qa/flows/`.

A Entrega 2 acrescenta `test/ux-products-clients-components.test.js` para congelar o contrato dos componentes reutilizáveis antes de qualquer tela ser migrada.

---

# 8. Fundação criada na Entrega 2

Arquivos:

- `desktop/renderer/ux-components.js`
- `desktop/renderer/ux-components.css`

Componentes disponíveis:

- `DataTable`
- `StatusBadge`
- `SearchField`
- `FilterBar`
- `EmptyState`
- `ActionMenu`
- `DetailPanel`

Características deliberadas:

- JavaScript sem dependência de framework;
- compatível com o padrão atual do renderer;
- geração de markup sem handlers inline;
- `data-action`, `data-filter-id`, `data-remove-filter` e `data-row-id` preparados para event delegation;
- escaping por padrão para valores vindos de dados;
- estilos isolados no prefixo `ux-`;
- uso dos tokens visuais existentes do PDV;
- **não carregados em `index.html` nesta entrega**;
- **não referenciados por `app.js` nesta entrega**.

Isso garante que a Entrega 2 não altera a UI em produção. A adoção deve acontecer somente nas entregas seguintes, tela por tela, com teste de paridade.

---

# 9. Checklist obrigatório antes da futura migração de Produtos

- [ ] busca atual preservada;
- [ ] filtro de categoria preservado;
- [ ] criar produto;
- [ ] editar produto;
- [ ] criar categoria;
- [ ] preço/custo/margem;
- [ ] estoque mínimo e controle de estoque;
- [ ] ativo/inativo no formulário;
- [ ] foto adicionar/trocar/remover;
- [ ] sincronização de fotos;
- [ ] fiscal/GTIN;
- [ ] variações/subitens;
- [ ] estoque por variação;
- [ ] kits;
- [ ] combos;
- [ ] integrações com checkout intactas;
- [ ] seletores dos módulos externos adaptados antes de remover os antigos.

# 10. Checklist obrigatório antes da futura migração de Clientes

- [ ] busca atual preservada;
- [ ] novo cliente;
- [ ] editar cliente;
- [ ] nome/documento/telefone/e-mail;
- [ ] limite de crédito;
- [ ] crédito utilizado preservado;
- [ ] observações;
- [ ] ativo/inativo;
- [ ] endereço completo;
- [ ] vínculo/seleção de cliente na venda;
- [ ] formulário completo continua acessível a partir do futuro painel lateral;
- [ ] nenhuma regra de crédito é recriada apenas no frontend.

---

## Resultado das Entregas 1 e 2

O repositório passa a ter uma fotografia explícita da superfície funcional que não pode regredir e uma biblioteca de apresentação pronta para a próxima etapa. Nenhuma tela atual é trocada nesta fase.
