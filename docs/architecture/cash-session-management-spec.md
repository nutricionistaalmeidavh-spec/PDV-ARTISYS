# Gestão de caixas: responsáveis, correções e anulação segura

## Escopo
Implementar no módulo de caixa existente, sem alterar código fiscal e sem serviços pagos obrigatórios.

## Situação verificada na main (15/11/2026)
- `js/domains/cash/cash-service.js` já possui `openSession`, `closeSession`, `listSessions`, `getSession`, movimentos e `writeAudit`.
- `cash_sessions.operator_id` identifica operador da abertura; o fechamento registra ator no audit log, mas `mapSession` não expõe responsável pelo fechamento.
- `cash_movements` registra vendas, estornos, suprimentos e sangrias. Não excluir registros diretamente.

## Regras de produto
1. Financeiro > Caixas: listagem filtrável por data, terminal, estado, operador; exibir aberto por, fechado por, horários, valor previsto, contado e divergência.
2. Detalhes: linha do tempo imutável de abertura, movimentos, fechamento, ajustes e anulação, com ator, timestamp e justificativa.
3. Correção: administrador autorizado, justificativa obrigatória; ajustes financeiros compensatórios, nunca sobrescrever movimentos nem a identidade original do operador.
4. Anular caixa: operação excepcional, somente administrador, com confirmação explícita, justificativa e transação atômica. Não usar DELETE. Caixa anulado permanece consultável e excluído apenas de agregados que explicitamente suportem estado anulado.
5. Bloquear anulação automática se houver vendas, devoluções, TEF/Pix liquidados, fiscal ou qualquer outro efeito externo; orientar cancelamento/devolução no fluxo próprio antes de habilitar anulação. Nunca inferir que um pagamento é de teste.
6. Reabertura e anulação não devem alterar vendas/estoque sem reversões transacionais e idempotentes já homologadas.
7. Preservar compatibilidade de bancos instalados, migração aditiva, dados históricos e operação offline.

## Critérios de aceite
- Operador de abertura e de fechamento distintos aparecem corretamente em histórico e relatório.
- Permissões são validadas no servidor, não apenas ocultando botões.
- Caixa fechado sem movimentos de venda pode ser anulado por administrador com motivo; segunda tentativa é idempotente ou rejeitada sem duplicar efeitos.
- Caixa com venda, PIX, TEF, devolução ou referência fiscal é bloqueado para anulação simples.
- Caixa anulado não desaparece da auditoria nem dos backups.
- Testes automatizados de permissões, integridade, relatórios, migração, concorrência, idempotência e restauração.
- Não disparar atualização para clientes antes de QA e autorização explícita de release.

## Implementação prevista
- Migração aditiva para metadados de fechamento/anulação e eventos auditáveis.
- Serviço de domínio com regras de autorização e integridade, endpoint protegido e componentes de histórico/detalhes.
- Relatórios com tratamento explícito do estado anulado e testes de regressão.
