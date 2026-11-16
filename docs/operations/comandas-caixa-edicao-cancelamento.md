# Comandas no Caixa — edição e cancelamento (PDV ArtiSys)

## Para operadores

Com o módulo **Alimentação** ativo, faça login no PDV usando o perfil padrão **Caixa**. Não é necessário criar perfil adicional.

1. No **Balcão/Caixa**, abra **Comandas e pedidos** e procure pela mesa ou comanda.
2. Em uma comanda **em aberto**, escolha **Editar comanda**. A ação abre os pedidos da mesa sem gerar venda antecipadamente.
3. Para adicionar produtos, use **Novo pedido**, revise o carrinho e confirme **Enviar**.
4. Para corrigir um item já lançado, escolha **Editar** na linha do item e altere **Quantidade** e/ou **Observação**. O total é recalculado. Se o preparo já começou ou houver cobrança vinculada, o PDV explica por que não é permitido; cancele o item conforme as permissões e lance outro.
5. Para cancelar uma comanda inteira, abra a comanda e escolha **Cancelar comanda**. Informe o motivo e confirme. Uma comanda cancelada não é apagada do histórico, os pedidos ficam identificados como cancelados e a mesa volta a ficar livre.

## Regras operacionais e segurança

- O perfil **Caixa** pode visualizar e lançar pedidos, corrigir itens não cobrados e cancelar comandas abertas sem pagamentos. O cancelamento integral exige motivo.
- **Comanda com divisão de conta ou pagamento registrado não pode ser cancelada** pela operação simples. Utilize o fluxo financeiro de estorno/correção apropriado.
- **Produção já iniciada ou pronta:** cancelamento da comanda inteira exige autorização de perfil Gerente/Administrador/Supervisor, com confirmação explícita. O Caixa não recebe essa autorização por padrão.
- A edição de quantidade/observação só é permitida enquanto o ticket de produção ainda não passou de **Novo**. Alterações em tickets Novos e cancelamentos geram avisos de cozinha/KDS e impressão não fiscal quando configurada.
- Cancelar uma comanda **não cancela uma venda concluída**, não estorna pagamentos nem interfere em NFC-e/NF-e. O módulo fiscal continua fora deste fluxo.
- A atualização de banco adiciona permissões ao **perfil Caixa padrão já existente**. Usuários, estoque, pedidos, dados financeiros e perfis personalizados não são substituídos.
- O núcleo continua **local, self-hosted e open source**, sem serviço externo pago obrigatório.

## Checklist de validação antes da atualização

- [ ] Caixa consegue acessar a comanda aberta e adicionar novos itens.
- [ ] Caixa consegue corrigir itens diretos e itens de produção ainda não iniciada.
- [ ] Tentativa de editar item em preparo, cancelado ou com pagamento é recusada.
- [ ] Cancelamento vazio e cancelamento com pedidos em estado Novo liberam a mesa e preservam histórico.
- [ ] Produção iniciada é bloqueada para Caixa; Gerente autorizado consegue cancelar.
- [ ] KDS, impressão não fiscal e pré-conta refletem corretamente as alterações.
- [ ] Não há emissão fiscal, pagamento ou movimento de caixa gerado pelo cancelamento.
- [ ] Testes de migração e regressão passam com instalações existentes e novas.
