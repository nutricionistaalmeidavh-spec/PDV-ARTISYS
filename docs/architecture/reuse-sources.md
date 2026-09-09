# Fontes de reuso E02–E06

Este arquivo registra as origens dos módulos reaproveitados no núcleo do PDV ArtiSys.

## PDVNexus

Reutilizar/adaptar:
- `windows-10/packages/database/src/pdv.ts`: regras puras de pagamento, estoque, inventário, caixa, autorização e cancelamento.
- `windows-10/tests/pdv-payment.test.ts`: contratos de regressão das regras acima.
- `windows-10/apps/nexus-desktop/main.cjs`: uso de `node:sqlite`, `DatabaseSync`, servidor `node:http`, backup local e token LAN.

Não reutilizar literalmente:
- persistência por snapshot JSON como fonte primária;
- reset destrutivo do banco quando a versão do aplicativo muda;
- senhas em texto simples;
- baixa direta de estoque dentro de `completePdvSale`;
- CORS wildcard do sync server.

## CLINICASMEDICAS

Reutilizar/adaptar:
- `js/core/migrations.js`: padrão de migrations versionadas e idempotentes.
- `js/core/audit.js`: sanitização de payload e exclusão de segredos.

## Mudanças de arquitetura no novo PDV

- dinheiro em centavos inteiros;
- SQLite acessado apenas pelo servidor central;
- outbox persistente + EventBus;
- efeitos idempotentes por `eventId + effectKey`;
- estoque via movimentos imutáveis e projeção de saldo;
- API `/api/v1` em vez de sincronização de snapshot completo.
