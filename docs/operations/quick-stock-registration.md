# Cadastro rápido de produtos no Estoque

## Objetivo

A primeira carga para uma loja pequena não precisa de ficha técnica, margem, KDS ou regras de atacado. O botão **Estoque → Cadastro rápido** abre um formulário para produtos de revenda e itens prontos.

1. Informe **nome** e **preço de venda**. Esses campos são obrigatórios.
2. Informe a **quantidade inicial** (zero quando ainda não existe saldo).
3. Opcionalmente escolha **categoria** e leia/digite o **código de barras**.
4. Deixe marcada a opção **Mostrar no Cardápio e nas vendas** para disponibilizar o item. Com Alimentação ativa, a rota direta (sem KDS) é gravada antes da publicação.
5. Use **Salvar e cadastrar outro** para cadastrar vários itens sem voltar ao menu.

**Mais opções** expande SKU, unidade e custo. **Cadastro completo** continua acessível para insumos, produtos e insumos, fichas técnicas, preparo KDS, preços por quantidade e demais ajustes.

## Regras de segurança

- O cadastro rápido nunca altera saldos existentes: cria produto novo com controle de saldo ativado e lança o saldo informado na API canônica de movimentações, com tipo de abertura.
- Quantidade inicial zero não gera lançamento fictício.
- Nome e preço são validados antes da primeira escrita; preços inválidos, valores negativos e mais de três casas decimais na quantidade são recusados.
- O primeiro salvamento não publica no Cardápio. Quando marcado, publica após gravar os demais dados e configurar rota direta quando Alimentação está ativa.
- Se houver falha depois de criar o produto, o formulário fecha para evitar duplicidade; o aviso informa que o cadastro foi preservado e quais etapas verificar.
- A importação em lote já existente em **Configurações → Importação** permanece disponível para cadastros grandes.
- Tudo funciona no servidor local/LAN, sem dependência de serviços pagos ou internet.

## Cobertura

O teste test/quick-stock-registration.test.js exercita as validações e verifica que o formulário avançado continua disponível. Também devem passar os testes de catálogo, publicação no Cardápio e movimentação de estoque.
