# Cadastro rápido de produtos — Estoque e primeiro uso

## Para o comerciante

Acesse **Início → Prepare sua loja → Cadastrar produto** ou **Cadastros → Estoque → Cadastro rápido**. Na página de Cardápio também existe a opção **Cadastrar produto novo**. O cadastro funciona no servidor local/LAN, inclusive sem internet.

1. Escolha **Produto pronto** para bebidas, cigarros e itens de revenda. Para petiscos feitos na hora ou produtos com preparo, escolha **Preparado na hora**: o sistema direciona para o cadastro de ficha técnica, que mantém os ingredientes e destino de produção.
2. Informe **nome** e **preço** e, se controlar unidades físicas, a **quantidade disponível**.
3. Categoria e código de barras são opcionais. SKU, unidade e custo ficam em **Mais opções**.
4. Com saldo positivo, pode marcar **Mostrar no Cardápio e no Balcão**. Com saldo zero, o produto fica cadastrado, mas **não é apresentado como disponível para venda**; registre a entrada antes de publicá-lo.
5. **Salvar e cadastrar outro** mantém a mesma tela, preserva categoria/unidade e limpa apenas campos específicos do próximo produto.
6. **Salvar produto** exibe confirmação com nome, preço, saldo do local de estoque e status de publicação, com atalhos para Estoque, Balcão e cadastro de outro item.

Para lotes maiores, **Estoque → Importar planilha** aponta para o importador CSV/XLSX existente em Configurações, com prévia obrigatória.

## Segurança e continuidade

- A API local **POST /api/v1/products/quick** usa as mesmas permissões de cadastro e ajuste de estoque; exige identificador de mutação para evitar cadastro duplicado em repetição após perda de resposta.
- O produto, a movimentação inicial, a rota direta dos produtos prontos e a publicação opcional são gravados em **uma transação SQLite**. Se qualquer etapa falhar, nenhuma delas permanece parcialmente salva.
- A rota direta de itens prontos é preparada mesmo quando o produto ainda está fora do Cardápio, permitindo publicação posterior após a entrada de saldo.
- Em erro de validação, o formulário preserva dados e informa o motivo. Em erro de resposta incerta, mantém a mesma operação para repetição segura, com dados temporariamente bloqueados até confirmação.
- A API escolhe o estoque associado ao terminal quando existir vínculo; caso contrário, usa o local padrão MAIN.
- O cadastro completo e o fluxo de ficha técnica continuam disponíveis. Nenhuma alteração de schema de produtos, saldos legados, dados existentes, regras fiscais ou dependência paga é introduzida.

## Validação

Testes: `node --test test/quick-stock-registration.test.js test/quick-stock-flow-integration.test.js test/quick-stock-api.test.js test/first-use-guide.test.js`.

Gates completos: `npm run verify` e E2E da UI. Antes de homologação, verificar com pessoas sem treinamento o percurso **abrir o PDV → cadastrar bebida → visualizar o saldo → abrir o Balcão → realizar venda** e **cadastrar petisco preparado**, além de interrupção de conexão no momento de salvar.

Não fazer merge, release ou disparo de atualização antes dos gates passarem.
