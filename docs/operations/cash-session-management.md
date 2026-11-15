# Gestão e auditoria de caixas no PDV ArtiSys

O caixa mantém um registro permanente dos movimentos. Correções não apagam vendas nem substituem o fechamento original.

## Consultar
1. Abra a opção **Caixa** no menu lateral.
2. Na seção **Histórico de caixas**, consulte data de abertura e fechamento, responsáveis, esperado, contado, diferença e situação.
3. Clique em **Detalhes** para ver os movimentos, o operador responsável por cada um quando disponível, o histórico de correções e a auditoria.

Administradores podem visualizar os caixas de todos os terminais. Outros perfis consultam o terminal conforme suas permissões.

## Corrigir o valor contado
1. Entre com perfil **Administrador** que possua `cash.manage`.
2. Abra **Caixa > Histórico de caixas > Detalhes** da sessão encerrada.
3. Selecione **Corrigir contagem**; informe o novo valor conferido e uma justificativa de 10 a 500 caracteres.
4. Confirme. O fechamento original não é sobrescrito; a nova contagem é registrada separadamente, com usuário, data e justificativa. A divergência e o relatório passam a refletir a contagem corrigida.

Não use este comando para cancelar pagamentos, estornar vendas nem movimentar dinheiro: utilize os fluxos próprios.

## Anular caixa de teste
1. Com permissão administrativa, escolha um caixa **fechado**.
2. Se não houver qualquer movimentação além do fundo inicial e nenhuma venda registrada no período, a interface apresenta **Anular caixa**.
3. Digite **ANULAR**, informe a justificativa e confirme.
4. A sessão passa a constar como **Anulado**, com quem anulou e quando. O registro não é excluído. O relatório operacional de caixa deixa de incluir as quantias da sessão anulada.

**O sistema impede anulação simples** se existirem vendas, devoluções, suprimentos, sangrias ou outros movimentos no caixa, ou vendas no período, inclusive quando os efeitos financeiros estejam atrasados. Pix, TEF e operações com efeitos externos exigem tratamento nos fluxos adequados. Não existe exclusão física de caixa nem de movimentos.

## Responsáveis e histórico legado
- **Abertura:** usuário autenticado na criação do caixa.
- **Fechamento:** usuário autenticado na conclusão do fechamento.
- **Movimentos:** operador registrado no movimento ou vinculado à venda/devolução.
- **Caixas antigos:** a migração tenta recuperar quem encerrou o caixa pelo log existente; se a informação não foi gravada anteriormente, não inventa um responsável.
- **Auditoria:** ações de abertura, suprimento, sangria, fechamento, correção e anulação mantidas em SQLite.

## Arquitetura
A migração aditiva `cash-management-migrations.js` preserva instalações existentes. Correções são lançamentos imutáveis em `cash_session_corrections`. A anulação é uma marcação na sessão original, com validação transacional e exclusão das métricas operacionais do relatório de caixa. A regra é aplicada na API e no serviço de domínio, não apenas na interface.

Toda a funcionalidade é local, com Node.js e SQLite, sem dependência de serviço pago e sem alteração de módulos fiscais.
