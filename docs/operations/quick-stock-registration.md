# Cadastro rápido de produtos — Estoque e primeiro uso

## Para o comerciante

Acesse **Início → Prepare sua loja → Cadastrar produto** ou **Cadastros → Estoque → Cadastro rápido**. Na página de Cardápio também existe a opção **Cadastrar produto novo**. O cadastro funciona no servidor local/LAN, inclusive sem internet.

1. Escolha **Produto pronto** para bebidas, cigarros e itens de revenda. Para petiscos feitos na hora ou produtos com preparo, escolha **Preparado na hora**: o sistema direciona para o cadastro de ficha técnica, que mantém os ingredientes e destino de produção.
2. Informe **nome** e **preço** e, se controlar unidades físicas, a **quantidade disponível**.
3. Categoria e código de barras são opcionais. SKU, unidade e custo ficam em **Mais opções**.
4. Com saldo positivo, pode marcar **Mostrar no Cardápio e no Balcão**. Com saldo zero, o produto fica cadastrado, mas **não é apresentado como disponível para venda**; registre a entrada antes de publicá-lo.
5. **Salvar e cadastrar outro** mantém a mesma tela, preserva categoria/unidade e limpa apenas campos específicos do próximo produto.
6. **Salvar produto** exibe confirmação com nome, preço, saldo do local de estoque e status de publicação, com atalhos para Estoque, Balcão e cadastro de outro item.

## Da primeira mercadoria até a primeira venda

O vídeo **13 — Cadastrar produto e concluir a primeira venda** não termina após salvar no Estoque. Ele segue o fluxo canônico:
1. Em **Cadastros → Estoque → Cadastro rápido**, escolha **Produto pronto**, informe nome, preço e quantidade positiva, e mantenha marcada **Mostrar no Cardápio e no Balcão**.
2. Salve e confirme o texto **No Cardápio e no Balcão**. Caso o status informe **Não publicado**, não prossiga supondo que o produto esteja disponível: revise a quantidade e a publicação.
3. Use **Ir para o Balcão**, procure o produto por nome e clique no cartão para adicioná-lo à venda. Confira o item no carrinho.
4. Clique em **Finalizar venda (F12)**. Para a demonstração, o caixa já estará aberto no ambiente isolado de testes; em uma loja real, o sistema solicitará a abertura do caixa caso necessário.
5. Confira o pagamento em **Dinheiro** e clique em **Concluir venda**. O tutorial só pode terminar depois de o PDV exibir **Venda … finalizada**. A venda do vídeo é criada apenas no ambiente descartável de QA e nunca no banco de um cliente.

Esse percurso é automatizado em `qa/demo/tutorials/13-cadastrar-produto.json` e validado pelo teste `test/tutorial-product-to-sale.test.js`. O CI gera `tutorial-13-cadastro-ate-venda` como artefato de vídeo a partir do próprio sistema. O roteiro pode ser reproduzido localmente sem SaaS ou serviço pago obrigatório.

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
