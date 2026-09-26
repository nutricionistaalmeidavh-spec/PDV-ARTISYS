# ArtiSys PDV 1.4.1

PDV desktop da ArtiSys para operação **local-first**, self-hosted e em rede LAN. O funcionamento diário não depende de SaaS, nuvem ou internet: venda, estoque, caixa, impressão, módulos operacionais e persistência permanecem no ambiente do estabelecimento.

O projeto usa um único núcleo transacional para venda, estoque, caixa, pagamentos, devoluções, impressão e auditoria. Recursos por segmento são módulos opcionais sobre esse mesmo núcleo, sem transformar cada nicho em um produto separado.

## Estado do produto

As entregas **E01–E54**, **E54.1** e a **Fase 9 — profundidade operacional** estão integradas na linha 1.4. A versão atual inclui operação de balcão, retaguarda, estoque por local, compras, pedidos, módulos verticais, hardware local, LAN, backup, importação, observabilidade e gates automatizados de release.

### Operação comercial

- Balcão com busca por nome, SKU e código de barras;
- seleção de variações, cliente e vendedor;
- suspensão e retomada de vendas;
- descontos e alteração de preço com autorização;
- pagamentos mistos registrados manualmente;
- caixa com abertura, suprimento, sangria, reversões e fechamento com divergência;
- histórico de vendas e cancelamentos;
- devoluções parciais e totais com seleção de itens, quantidades, reembolso, controle do saldo devolvível e autorização conforme perfil;
- observação interna vinculada à venda/cliente e impressão opcional no comprovante não fiscal;
- relatórios operacionais e exportação CSV.

### Catálogo e estoque

- produtos, categorias, clientes, vendedores e fornecedores;
- **Produto pai e subitens** no catálogo comum, com SKU, código de barras, preço, custo, atributos e estoque próprios por variação;
- **Kits e combos promocionais** configuráveis, com snapshots históricos para preservar baixa e reversão corretas;
- ficha técnica versionada e consumo de ingredientes pelo ledger de estoque;
- estoque por ledger imutável, inventário e alertas de mínimo;
- estoque por local, com físico, reservado e disponível;
- reservas e transferências com estado em trânsito;
- snapshot histórico de custo por item vendido para preservar margem histórica.

Detalhes de catálogo: `docs/architecture/catalog-parent-variants-kits-combos.md`.

### Compras e pedidos

- pedidos de compra vinculados a fornecedores;
- recebimento parcial;
- custo médio móvel;
- conta a pagar vinculada ao recebimento;
- orçamentos e pedidos com retirada ou entrega;
- reserva de estoque;
- atendimento parcial ou total;
- conversão para a mesma venda canônica usada pelo Balcão.

O saldo legado é migrado para `MAIN — Estoque principal`. `inventory_balances` permanece como projeção agregada de compatibilidade, enquanto as operações novas usam saldos por local.

### Módulos opcionais

O núcleo básico do PDV não é desativável. Em `Configurações > Módulos`, o estabelecimento pode ativar somente os fluxos que utiliza:

- Restaurante;
- Pizzaria;
- Delivery;
- Fast-food / Lanchonete;
- Mercado / Conveniência / Padaria;
- Varejo;
- Serviços;
- Oficina;
- Autoatendimento.

Os módulos reutilizam o mesmo núcleo de venda, estoque, caixa, impressão, auditoria e eventos. Um módulo desativado deixa de aparecer como fluxo operacional e não aceita novas mutações específicas.

### LAN, dispositivos e dados

- servidor local autoritativo;
- terminais pareados usando API LAN, sem acesso direto ao SQLite;
- interface móvel self-hosted em `/mobile`;
- dispositivos de garçom, tablet de mesa, KDS e autoatendimento com credenciais próprias;
- QR de acesso local em `http://IP-DO-SERVIDOR:4174/mobile`;
- handshake de versão e deduplicação de mutações;
- backup com manifesto/SHA-256, validação e restore atômico;
- importação CSV/XLSX com preview, erros por linha e commit idempotente;
- health, logs estruturados, diagnóstico ZIP e checklist persistente de piloto;
- telemetria opcional e opt-in para fluxos e falhas, com fila SQLite local e backend Cloudflare configurável sem dependência operacional.

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
             SQLite / Hardware
```

Em rede existe um único servidor autoritativo. Terminais e dispositivos móveis não recebem caminho do SQLite e não acessam o banco por SMB; usam somente a API local na LAN. O renderer Electron não possui acesso Node, SQL, filesystem ou serial genérico.

O `SaleService` permanece como fluxo canônico de venda. Estoque, caixa, impressão, auditoria e efeitos de domínio são compartilhados entre o Balcão e os módulos verticais.

Hardware físico fica atrás de `desktop/hardware-runtime.cjs`. Módulos reutilizáveis são vendorizados e fixados por commit em `vendor/artisys-modules.lock.json`, preservando build reproduzível sem depender de registry privado.

## Requisitos e desenvolvimento

- Node.js 22+;
- Windows x64 é o alvo de empacotamento comercial 1.4.1.

```bash
npm install
npm run start:desktop
```

Servidor standalone de desenvolvimento:

```bash
npm run start:server
```

## Perfis de implantação

O padrão é `server-terminal`. Para um terminal cliente, configure `PDV_DEPLOYMENT_PROFILE=terminal`, `PDV_SERVER_URL`, `PDV_TERMINAL_ID` e a credencial do terminal pareado.

O servidor desktop publica a LAN por padrão na porta 4174. `PDV_ENABLE_LAN=false` desabilita esse listener; `PDV_LAN_HOST` e `PDV_LAN_PORT` ajustam bind e porta.

A interface móvel local usa `http://IP-DO-SERVIDOR:4174/mobile`. Esse transporte HTTP é destinado somente a LAN confiável e não é apresentado como HTTPS ou exposição segura à internet. A interface atual não é declarada PWA instalável.

## Telemetria opcional

A telemetria de produto e diagnóstico fica **desativada por padrão** e pode ser habilitada em `Configurações > Privacidade e diagnóstico`. O core continua funcionando integralmente sem internet ou Cloudflare.

O servidor autoritativo mantém uma fila SQLite limitada e envia eventos em background para um endpoint HTTPS configurável. Terminais LAN não recebem a credencial de ingestão e encaminham apenas eventos UI allowlisted pela API autenticada.

O backend Cloudflare opcional usa **Workers + Analytics Engine + D1**. Para provisionar automaticamente:

```bash
npm run telemetry:cloudflare:setup
```

Depois do deploy, configure explicitamente `PDV_TELEMETRY_ENDPOINT` com a URL exibida pelo script. Dados de cliente, CPF/CNPJ, e-mail, telefone, endereço, credenciais, XML/DANFE, dados de cartão, observações e texto livre não fazem parte do contrato de eventos.

Detalhes operacionais: `docs/operations/telemetry.md`.

## Hardware

A impressão padrão usa `PDV_PRINTER_MODE=electron`. Impressoras térmicas Epson/Star e interfaces seriais são suportadas por drivers locais explícitos. Balança e gaveta serial são opcionais e usam as configurações `PDV_SCALE_*` e `PDV_DRAWER_*`.

A E54.1 mantém simulação automatizada de impressora, balança, gaveta, leitor, COM, timeout, fragmentação, falha e recuperação. A matriz de compatibilidade usa três níveis:

- `PROTOCOL_VERIFIED`: protocolo/caminho validado automaticamente;
- `FIELD_VERIFIED`: fabricante/modelo físico testado com evidência;
- `UNTESTED_MODEL`: modelo específico ainda não testado fisicamente.

## Regra comercial fiscal e pagamentos

A versão comercial 1.4.1 opera com documentos e impressão claramente identificados como **NÃO FISCAL**. NFC-e, NF-e, SAT, MFE, SEFAZ, certificado digital e provedores fiscais não fazem parte dos fluxos comerciais desta release.

Pagamentos são registrados manualmente no PDV. Não há dependência obrigatória de TEF, PinPad, adquirente, API bancária ou confirmação automática de PIX. Autoatendimento também não processa pagamento eletrônico integrado.

## Verificação e release

```bash
npm run docs:check
npm run verify
npm run verify:release
npm run dist:win
npm run release:manifest -- --output dist/release-manifest.json --artifact dist/ArtiSys-PDV-1.4.1-x64-Setup.exe
```

`docs:check` valida consistência entre README, versão e metadados de release. `verify` cobre domínio, API, UI, arquitetura, documentação e integrações locais. `verify:release` acrescenta os gates de release, incluindo cenários críticos de concorrência, recovery, segurança e fluxos E2E.

Mudanças relevantes na `main` podem disparar `release-windows`, que executa os gates, gera o NSIS x64, valida os artefatos e publica a GitHub Release consumida pelo updater. Alterações somente em documentação/testes não precisam gerar um novo instalador.

## Documentação

### Operação

- `docs/operations/install-server.md`
- `docs/operations/install-terminal.md`
- `docs/operations/pairing.md`
- `docs/operations/cash-sales-returns.md`
- `docs/operations/backup-restore.md`
- `docs/operations/hardware-printing.md`
- `docs/operations/import.md`
- `docs/operations/diagnostics.md`
- `docs/operations/telemetry.md`
- `docs/operations/update.md`

### Arquitetura

- `docs/architecture/e30-e39-restaurant.md`
- `docs/architecture/e40-e47-verticals.md`
- `docs/architecture/catalog-parent-variants-kits-combos.md`
- `docs/superpowers/specs/2026-09-20-enterprise-depth-p0-design.md`

Detalhes de cada fluxo devem permanecer nos documentos específicos; o README serve como visão geral do produto e do estado atual da `main`.

## Regra de manutenção documental

`CONTRIBUTING.md` define como regra obrigatória que qualquer alteração de comportamento, arquitetura, operação, requisito, limitação ou release atualize a documentação correspondente **na mesma entrega**. Código atualizado com documentação desatualizada não é considerado uma entrega concluída.

## Limitações externas

Venda, estoque, caixa, módulos opcionais, KDS, LAN, impressão local e integração serial não dependem de nuvem nem de serviço pago. A telemetria Cloudflare é opcional e sua indisponibilidade não altera o funcionamento diário. Hardware, firmware, cabo e driver específicos continuam sendo variáveis externas e precisam ser validados no ambiente real quando aplicável.

Um modelo físico não testado permanece `UNTESTED_MODEL`; famílias de integração validadas automaticamente podem ser `PROTOCOL_VERIFIED`; somente equipamento realmente conectado e validado com evidência passa a `FIELD_VERIFIED`.

Metadados completos de capacidades, limitações e matriz de compatibilidade ficam em `release/capabilities.json`, `release/limitations.json` e `release/hardware-compatibility.json`.
