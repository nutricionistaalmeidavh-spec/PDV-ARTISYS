# Caixa, vendas e devoluções

## Caixa

Abra o caixa antes das vendas, informando o fundo inicial. Suprimentos e sangrias são movimentos imutáveis. No fechamento, informe o valor contado; o sistema calcula esperado e divergência e preserva o histórico da sessão.

## Venda

Use **F2** para abrir o Balcão. Pesquise por nome/SKU/código de barras ou use leitor keyboard-wedge. Adicione/ajuste itens, selecione cliente, aplique desconto autorizado e escolha uma ou mais formas de pagamento. **F12** conclui a venda quando estoque, caixa e pagamentos são válidos. A conclusão é idempotente: reenvio da mesma mutação não cria uma segunda venda.

Vendas podem ser suspensas e retomadas. Cancelamento de venda concluída exige permissão/motivo e gera os efeitos de reversão pelo EventBus/outbox, sem apagar o documento original.

## Devolução

Abra **Devolução (F11)**, carregue a venda, selecione itens/quantidades e a forma de reembolso. Devoluções parciais preservam a venda original e registram estoque/caixa como movimentos próprios e idempotentes.
