# Produtos — matriz de paridade Legacy × Dense

Data-base: 2026-09-21  
Branch: `feat/ux-products-clients-e1-e2`  
Escopo: Entregas 3 e 4 do roadmap de UX de Produtos.

## Regra desta etapa

A tela Dense é uma **camada de melhoria progressiva sobre a UI Legacy existente**. Ela não recria os handlers de cadastro, foto, categoria, edição, fiscal, variações, kits ou combos.

O objetivo técnico é preservar os nós DOM que já possuem listeners e que são observados pelos módulos complementares. O controller denso acrescenta hierarquia visual, status, filtro de estoque e atalho de busca sem trocar os botões canônicos.

**Não remover o renderer legado** enquanto a feature flag existir e enquanto a paridade não estiver coberta por regressão automatizada e QA visual/operacional.

## Feature flag

- Flag: `window.PdvFeatureFlags.productsDenseView`.
- Default nesta branch: `true`.
- Fallback: definir a flag como `false` antes de montar/reabrir a rota Produtos restaura a apresentação Legacy.
- O renderer original de `app.js` continua sendo a fonte dos handlers e fluxos existentes.

## Matriz funcional

| Capacidade | Legacy | Dense | Estratégia de preservação |
| --- | --- | --- | --- |
| Novo produto | `#new-product` | Mesmo botão | Nó original preservado; mesmo listener de `app.js` |
| Editar produto | `[data-edit-product]` | Mesmo botão | Nó original preservado |
| Categoria | `#new-category` | Mesmo botão | Nó original preservado |
| Filtro por categoria | `#product-category-filter` | Mesmo select | Listener original preservado; apenas recebe estilo denso |
| Busca nome/SKU/barcode | `#product-page-search` | Mesmo input | Semântica e rerender continuam em `ui.filterProducts`; Dense acrescenta `Ctrl+K` |
| Sincronizar fotos | `#sync-product-photos` | Mesmo botão | Nó original preservado |
| Adicionar/trocar foto | `[data-product-photo-edit]` | Mesmo botão | Mesmo bridge e handlers existentes |
| Remover foto | `[data-product-photo-remove]` | Mesmo botão | Mesmo bridge e confirmação existentes |
| Preço | Visível | Visível | Mesmo texto do row Legacy |
| Custo | Visível | Visível | Mantido no mesmo agrupamento visual |
| Estoque | Visível | Visível | Mesmo valor canônico retornado pela API |
| Status de estoque | Implícito | Badge explícito | Derivado somente de `active`, `trackStock`, `stockQuantity` e `minimumStock` |
| Filtro de estoque | Não havia | Novo | Camada local que apenas oculta/exibe rows já retornados pelo filtro canônico |
| Estado sem resultado por estoque | Não havia | Novo | `EmptyState` da fundação UX; não altera persistência |
| Produto ativo/inativo | Formulário | Formulário | Formulário original preservado |
| Estoque mínimo | Formulário + row | Formulário + row | Sem alteração das regras do catálogo |
| Dados fiscais | Injetado em `#product-form` | Mesmo fluxo | `#new-product`, `[data-edit-product]` e `#product-form` preservados |
| Variações | Injetadas no `.data-card` e `.data-row` | Mesmo fluxo | Estrutura Legacy permanece; Dense apenas acrescenta classes/status à row pai |
| Kits e combos | Bloco injetado na página Produtos | Mesmo bloco | Página original não é substituída; seção continua sendo anexada ao final |
| Desconto/promos de combo | Checkout | Checkout | Fora da camada densa; nenhum código alterado |
| Persistência produto | `api.saveProduct` → catálogo | Igual | Dense não implementa gravação |
| Persistência categoria | `api.saveCategory` | Igual | Dense não implementa gravação |
| Auditoria | Core `product.upsert` | Igual | Nenhuma regra de domínio foi movida para o renderer |

## Comparação de estrutura

### Legacy

- `renderProducts()` em `desktop/renderer/app.js` constrói página, toolbar e `.data-card`.
- Os listeners são ligados imediatamente aos elementos criados.
- Módulos extras detectam esses elementos por seletores conhecidos.

### Dense

- `products-dense-controller.js` observa a rota depois do `renderProducts()`.
- Não substitui `.page`, `.toolbar`, `.data-card`, `.data-row` nem botões canônicos.
- Acrescenta:
  - cabeçalho de colunas;
  - classes de densidade;
  - coluna de Status;
  - badge de status usando `StatusBadge`;
  - filtro `#products-stock-filter`;
  - estado vazio específico do filtro;
  - atalho `Ctrl+K`/`Cmd+K` para a busca.
- `products-dense-view.js` concentra a regra de apresentação de status e o filtro puro de estoque.

## Status usados pela camada Dense

| Situação | Regra |
| --- | --- |
| Inativo | `active === false` |
| Sem controle | `trackStock === false` |
| Sem estoque | estoque `<= 0` com controle ativo |
| Baixo | estoque `> 0` e `<= minimumStock`, com mínimo maior que zero |
| Normal | demais produtos com controle ativo |

Esses estados são apenas interpretação visual de dados existentes. Nenhum saldo ou estado é gravado pela camada Dense.

## Contratos de DOM que permanecem obrigatórios

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

## Critério da Entrega 4

A apresentação Legacy permanece no repositório e continua sendo executada antes da melhoria progressiva. Portanto, desligar a feature flag não exige reconstruir handlers nem restaurar regras de negócio.

Antes de qualquer entrega futura que pretenda apagar a UI Legacy, deve existir evidência de paridade para:

1. criação e edição de produto;
2. categoria e busca;
3. fotos e sincronização;
4. preço, custo, margem e estoque;
5. ativo/inativo e estoque mínimo;
6. dados fiscais;
7. variações;
8. kits e combos;
9. integração com Balcão/estoque/relatórios;
10. estados vazios, erros e permissões aplicáveis.

Até que essa validação seja concluída em ambiente executável, a regra é: **não remover o renderer legado**.
