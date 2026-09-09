# PDV ArtiSys

PDV desktop da ArtiSys para operação **local-first** e em rede LAN, sem dependência de SaaS ou internet para a operação diária do cliente.

## Estado atual — E01 a E12

O produto já possui o núcleo operacional e a primeira UI definitiva:

- EventBus + outbox durável + efeitos idempotentes;
- SQLite central no servidor local;
- migrations versionadas e não destrutivas;
- autenticação, usuários e permissões;
- produtos, categorias, clientes e fornecedores;
- estoque por movimentos imutáveis + projeção de saldo;
- motor de vendas com suspensão, retomada, desconto, pagamento misto, conclusão e cancelamento;
- caixa com abertura, suprimento, sangria, venda, reversão e fechamento;
- API LAN `/api/v1` com autenticação e permissões no servidor;
- shell Electron com servidor loopback embutido e bridge IPC segura;
- **E07** foundation visual, sidebar, topbar, status local, operador e atalhos;
- **E08** tela Início definitiva com cards F2–F11;
- **E09/E10** Balcão definitivo com busca, categorias, carrinho, cliente, desconto, pagamentos e F12;
- **E11** gestão visual de Clientes e Vendedores;
- **E12** gestão visual de Produtos, categorias, preço, custo, margem e estoque mínimo.

Cards de Estoque, Caixa, Financeiro, Relatórios, Últimas vendas, Devolução e Configurações permanecem visíveis para preservar a navegação definitiva, mas mostram explicitamente a entrega futura correspondente em vez de simular funcionalidades ainda não entregues.

## Requisitos

- Node.js 22+;
- npm para instalar o Electron de desenvolvimento;
- Windows é o alvo comercial principal desta etapa; o shell também segue APIs Electron multiplataforma.

## Executar o desktop

```bash
npm install
npm run start:desktop
```

O desktop cria o banco `pdv-artisys.sqlite` no diretório `userData` do Electron e inicia um servidor HTTP **somente em loopback**, em porta dinâmica. O renderer não recebe o token de instalação: todas as chamadas passam pelo preload/IPC.

Variáveis opcionais:

- `PDV_STORE_NAME` — nome exibido da loja;
- `PDV_TERMINAL_ID` — padrão `PDV-01`;
- `PDV_TERMINAL_NAME` — padrão `Terminal PDV-01`.

## Executar somente o servidor

Modo standalone:

```bash
npm run start:server
```

Modo servidor LAN:

```bash
PDV_HOST=0.0.0.0 PDV_INSTALL_TOKEN="troque-este-token" npm run start:server
```

Para LAN, `PDV_INSTALL_TOKEN` é obrigatório. A UI cliente/pareamento de múltiplos terminais será endurecida em E21.

## Verificação

```bash
npm run verify
```

A verificação executa testes de domínio/API/UI, checks do EventBus, núcleo e arquivos desktop.

## Arquitetura

- `docs/architecture/event-bus.md`
- `docs/architecture/core-e02-e06.md`
- `docs/architecture/ui-e07-e12.md`
- `docs/architecture/reuse-sources.md`

## Próximas entregas

- **E13** Estoque visual completo;
- **E14** Caixa visual completo;
- **E15** Últimas vendas e devoluções;
- **E16** Financeiro;
- **E17** Relatórios;
- **E18–E20** hardware, impressão e fiscal;
- **E21+** robustez LAN, backup, configurações, migração, QA, instalador e piloto.
