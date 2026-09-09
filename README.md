# PDV ArtiSys

Novo PDV desktop da ArtiSys, projetado para operação **local-first** e em rede LAN, sem dependência de SaaS ou internet para a operação diária do cliente.

## Estado atual

O núcleo **E02–E06** está implementado sem depender da UI final:

- EventBus + outbox durável + efeitos idempotentes;
- SQLite central no servidor local;
- migrations versionadas e não destrutivas;
- usuários, categorias, produtos, clientes e fornecedores;
- estoque por movimentos imutáveis + projeção de saldo;
- motor de vendas com suspensão, retomada, pagamento misto, conclusão e cancelamento;
- caixa com abertura, suprimento, sangria, venda, reversão e fechamento;
- API LAN `/api/v1` com autenticação e permissões no servidor;
- restart preservando banco e eventos pendentes.

## Requisitos

- Node.js 22 ou runtime Electron que disponibilize `node:sqlite`/`DatabaseSync`.
- Para expor o serviço na LAN, configure obrigatoriamente `PDV_INSTALL_TOKEN`.

## Executar o servidor

Modo standalone, somente no computador local:

```bash
npm run start:server
```

Modo servidor LAN, exemplo:

```bash
PDV_HOST=0.0.0.0 PDV_INSTALL_TOKEN="troque-este-token" npm run start:server
```

Variáveis aceitas:

- `PDV_HOST` — padrão `127.0.0.1`;
- `PDV_PORT` — padrão `4174`;
- `PDV_DB_PATH` — padrão `./data/pdv-artisys.sqlite`;
- `PDV_INSTALL_TOKEN` — obrigatório fora de loopback;
- `PDV_ALLOWED_ORIGINS` — lista separada por vírgulas quando houver renderer HTTP autorizado.

## Verificação

```bash
npm run verify
```

## Arquitetura

- `docs/architecture/event-bus.md`
- `docs/architecture/core-e02-e06.md`
- `docs/architecture/reuse-sources.md`

## Próximas entregas

E07+ adicionará hardware, fiscal, robustez adicional de implantação LAN, backup/restauração operacional, relatórios, UI final e empacotamento desktop.
