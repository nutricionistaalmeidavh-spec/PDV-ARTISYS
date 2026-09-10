# ArtiSys PDV 1.1

PDV desktop da ArtiSys para operação **local-first** e em rede LAN, sem SaaS e sem dependência de internet para a operação diária do estabelecimento. A linha 1.1 acrescenta operação de restaurante mantendo venda, estoque, caixa e dados no mesmo núcleo transacional.

## Estado do produto

As entregas **E01–E39 estão integradas** na linha de release 1.1: núcleo transacional, UI operacional, rede local multi-terminal, backup/restore, importação, observabilidade, QA de release, empacotamento Windows, restaurante, dispositivos móveis LAN e checklist de implantação.

Principais capacidades:

- EventBus + outbox durável + efeitos idempotentes;
- SQLite autoritativo acessado somente pelo servidor local;
- migrations incrementais e não destrutivas;
- autenticação, usuários, RBAC e auditoria sanitizada;
- produtos, categorias, clientes, vendedores e fornecedores;
- estoque por ledger imutável, inventário e alertas de mínimo;
- Balcão com busca/código de barras, suspensão/retomada, descontos, cliente e pagamentos mistos;
- caixa com abertura, suprimento, sangria, reversões e fechamento com divergência;
- histórico de vendas, cancelamentos e devoluções parciais/totais;
- financeiro, relatórios e exportação CSV;
- fila de impressão com retry/reimpressão e documentos operacionais não fiscais;
- restaurante com mesas, comandas, pedidos, transferência de mesa, pré-conta e fechamento reutilizando o Balcão;
- cozinha/KDS com setores de produção, produto→setor e roteamento opcional para impressora;
- dispositivos LAN de garçom, tablet vinculado à mesa e KDS, com credenciais derivadas, bloqueio e rotação;
- interface móvel self-hosted em `/mobile`, sem CDN, SaaS ou internet obrigatória;
- chamados de garçom/conta, indicadores do restaurante e exportação de pedidos CSV;
- adaptadores de leitor, balança, impressora e gaveta;
- camada fiscal NFC-e/NF-e opcional, com credenciais protegidas;
- LAN com pareamento de terminais, handshake de versão e deduplicação de mutações;
- backup com manifesto/SHA-256, validação e restore atômico;
- importação CSV/XLSX com preview, erros por linha e commit idempotente;
- health, logs estruturados, diagnóstico ZIP e checklist persistente de piloto;
- perfis de implantação **Servidor + Terminal** e **Terminal**.

## Arquitetura

```text
Desktop / mobile LAN / atalhos / código de barras
                     ↓
          preload IPC / API local
                     ↓
            Application Services
                     ↓
                  Domain
                     ↓
       Repositories / Services
                     ↓
 SQLite / Hardware / Fiscal opcional
```

Em rede, existe um único servidor autoritativo. Terminais e dispositivos móveis não recebem caminho do SQLite e não acessam o banco por SMB; usam somente a API local na LAN. O renderer Electron não possui acesso Node, SQL, filesystem ou serial genérico.

O módulo de restaurante não mantém um segundo motor de venda: no fechamento, a comanda é convertida para a venda canônica e passa pelos mesmos efeitos de estoque, caixa, impressão e auditoria do PDV.

## Requisitos e execução de desenvolvimento

- Node.js 22+;
- Windows x64 é o alvo de empacotamento comercial 1.1.

```bash
npm install
npm run start:desktop
```

Servidor standalone de desenvolvimento:

```bash
npm run start:server
```

## Perfis de implantação

O padrão é `server-terminal`. Para um terminal cliente, configure `PDV_DEPLOYMENT_PROFILE=terminal`, `PDV_SERVER_URL`, `PDV_TERMINAL_ID` e a credencial do terminal pareado. Veja os manuais de instalação e pareamento em `docs/operations/`.

O servidor desktop publica a LAN por padrão na porta 4174; `PDV_ENABLE_LAN=false` desabilita esse listener. `PDV_LAN_HOST` e `PDV_LAN_PORT` ajustam bind/porta.

Dispositivos de restaurante usam a interface self-hosted `http://IP-DO-SERVIDOR:4174/mobile`. O transporte HTTP é destinado somente a LAN confiável e não é apresentado como HTTPS ou exposição segura à internet.

## Verificação e release

```bash
npm run verify
npm run verify:release
npm run dist:win
npm run release:manifest -- --output dist/release-manifest.json --artifact dist/ArtiSys-PDV-1.1.0-x64-Setup.exe
```

`verify` cobre domínio/API/UI e architecture checks. `verify:release` acrescenta gates de concorrência, recovery e segurança. O workflow Windows gera o NSIS x64, manifesto e checksum a partir do mesmo commit.

## Operação

- `docs/operations/install-server.md`
- `docs/operations/install-terminal.md`
- `docs/operations/pairing.md`
- `docs/operations/cash-sales-returns.md`
- `docs/operations/backup-restore.md`
- `docs/operations/hardware-printing.md`
- `docs/operations/fiscal.md`
- `docs/operations/import.md`
- `docs/operations/diagnostics.md`
- `docs/operations/update.md`
- `docs/architecture/e30-e39-restaurant.md`

## Limitações externas

O funcionamento diário de venda, estoque, caixa, restaurante, KDS e LAN não depende de nuvem nem de serviço pago. Emissão fiscal real é uma integração opcional e depende das credenciais/configuração do estabelecimento e dos serviços fiscais externos. Periféricos opcionais dependem do hardware/driver presente no terminal. Esses casos são registrados como `BLOCKED_EXTERNAL` durante o piloto até validação real.

Metadados completos de capacidades e limitações ficam em `release/capabilities.json` e `release/limitations.json`.
