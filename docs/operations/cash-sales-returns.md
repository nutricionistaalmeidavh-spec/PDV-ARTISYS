# Caixa, vendas e devoluções

## Caixa

Abra o caixa antes das vendas, informando o fundo inicial. Suprimentos e sangrias são movimentos imutáveis. No fechamento, informe o valor contado; o sistema calcula esperado e divergência e preserva o histórico da sessão.

## Venda

Use **F2** para abrir o Balcão. Pesquise por nome/SKU/código de barras ou use leitor keyboard-wedge. Adicione/ajuste itens, selecione cliente, aplique desconto autorizado e escolha uma ou mais formas de pagamento. **F12** conclui a venda quando estoque, caixa e pagamentos são válidos. A conclusão é idempotente: reenvio da mesma mutação não cria uma segunda venda.

No Balcão, a busca/catálogo permanecem à esquerda. À direita, os botões compactos **Vendedor** e **Cliente** abrem dialogs com os seletores já existentes; os botões **Observação** e **Desconto** abrem dialogs sem substituir os campos e listeners originais. A observação mantém o limite de impressão no cupom não fiscal. O desconto continua percentual e usa o cálculo canônico. O botão **Limpar** exige confirmação antes de acionar a remoção existente.

Os itens da venda recebem a maior parte do espaço vertical, com rolagem própria; **Ampliar itens** oculta temporariamente o catálogo e **Voltar ao catálogo** restaura a visão de duas colunas. Subtotal, desconto aplicado, total, meios de pagamento e F12 ficam no rodapé fixo da área de venda. Os atalhos F1/F2/F3/F4/F6/F12, alteração de preço autorizada, vendas suspensas e APIs de venda, estoque e caixa permanecem inalterados. Na revisão P1–P3, a altura útil do Balcão passa a ser calculada a partir do viewport e da área efetiva da rota em pixels CSS (inclusive zoom/escala do Windows), em vez do antigo deslocamento fixo de 190 px. O painel direito usa linhas de grade para contexto, carrinho rolável e rodapé não rolável: subtotal, desconto, total, pagamentos e F12 continuam acessíveis enquanto somente os itens rolam. Observação e desconto dividem a faixa superior do rodapé. Janelas estreitas alternam entre **Ver produtos** e **Ver carrinho**, iniciando pela conferência do carrinho; o modo ampliado anterior continua disponível. Em alturas extremamente baixas, o espaço do carrinho inevitavelmente diminui e deve ser conferido no QA de escala/viewport.

A busca do Balcão, a busca da página **Produtos** e a busca da página **Clientes** preservam o próprio campo enquanto a digitação está em andamento. Isso evita recriar o input entre teclas e mantém a ordem enviada por leitores keyboard-wedge. Testes funcionais automatizados verificam as regras do domínio; os E2Es antigos de UI foram removidos e serão reconstruídos com base nos fluxos atuais.

Vendas podem ser suspensas e retomadas. Cancelamento de venda concluída exige permissão/motivo e gera os efeitos de reversão pelo EventBus/outbox, sem apagar o documento original.

## Devolução

Abra **Devolução (F11)**, pesquise uma venda concluída, carregue os detalhes, selecione itens/quantidades, informe o motivo e a forma de reembolso e confirme. A interface calcula o total selecionado e considera devoluções anteriores para mostrar somente a quantidade ainda disponível.

Sessões de **gerente ou administrador** podem concluir a devolução diretamente. Um operador de caixa pode concluir somente após informar credenciais válidas de gerente/admin; o servidor emite uma autorização de uso único vinculada ao contexto da devolução e preserva separadamente as identidades do operador e do autorizador na auditoria. Outros perfis sem permissão podem consultar a tela, mas não concluir a operação.

O servidor continua sendo a autoridade final de permissão, quantidade disponível, total e forma de reembolso. A autorização delegada não substitui essas validações nem permite devolver acima do saldo restante.

Devoluções parciais preservam a venda original e registram estoque/caixa como movimentos próprios e idempotentes. Depois de concluir, o histórico da própria venda é recarregado para exibir a devolução e impedir nova devolução acima da quantidade restante.

Os roteiros E2E antigos de UI, incluindo `desktop-regressions-e2e`, foram removidos. A próxima cobertura visual deverá ser criada do zero sobre o produto atual.
