# ArtiSys PDV 1.3.2

PDV desktop da ArtiSys para operação **local-first** e em rede LAN, sem SaaS e sem dependência de internet para a operação diária. A linha 1.3 mantém um único núcleo transacional de venda, estoque, caixa, impressão e dados, acrescentando módulos opcionais por segmento sem transformar cada nicho em um produto separado.

## Estado do produto

As entregas **E01–E54 estão integradas** e a **E54.1** reforça a compatibilidade de periféricos com simulação automatizada de protocolos, falhas e recuperação. O produto inclui núcleo transacional, UI operacional, rede local multi-terminal, backup/restore, importação, observabilidade, QA de release, empacotamento Windows, restaurante, dispositivos móveis LAN, catálogo avançado, ficha técnica, **produto pai/subitens**, **kits**, **combos promocionais configuráveis** e módulos opcionais de Pizzaria, Restaurante avançado, Delivery, Fast-food, Mercado/Padaria, Varejo, Serviços, Oficina e Autoatendimento.

Principais capacidades:

- EventBus + outbox durável + efeitos idempotentes;
- SQLite autoritativo acessado somente pelo servidor local;
- migrations incrementais e preservação de dados existentes;
- autenticação, usuários, RBAC e auditoria sanitizada;
- produtos, categorias, clientes, vendedores e fornecedores;
- adicionais, opções e configurações com snapshot das escolhas no item vendido;
- **produto pai e subitens/variações no catálogo comum**, com SKU, código de barras, preço, custo, atributos e estoque próprios por variação;
- **kits** definidos pelo usuário, com composição e snapshot histórico dos componentes para baixa e reversão de estoque;
- **combos promocionais configuráveis** pelo usuário, como `3 por R$ 10,00`, com produtos participantes, validade, limite e política de acúmulo de desconto;
- ficha técnica versionada e baixa de ingredientes pelo ledger de estoque existente;
- estoque por ledger imutável, inventário e alertas de mínimo;
- Balcão com busca/código de barras, seleção direta de variações, suspensão/retomada, descontos, cliente e pagamentos mistos manuais;
- observação vinculada à venda/cliente, com até 500 caracteres para registro interno e impressão opcional limitada a 120 caracteres e 4 linhas no cupom não fiscal;
- caixa com abertura, suprimento, sangria, reversões e fechamento com divergência;
- histórico de vendas, cancelamentos e devoluções parciais/totais;
- financeiro, relatórios e exportação CSV;
- fila de impressão com retry/reimpressão, documentos operacionais **NÃO FISCAL** e identidade configurável do cupom com nome, endereço, telefone e logo local;
- impressão Electron, térmica Epson/Star e serial por drivers locais explícitos;
- balança e gaveta serial usando `@artisys/serialport`;
- E54.1 com simulação obrigatória de impressora, balança, gaveta, leitor, COM, timeout, fragmentação, falha e recuperação;
- restaurante com mesas, comandas, pedidos, transferência, pré-conta e fechamento pela venda canônica;
- restaurante avançado com divisão de conta, taxa de serviço, pagamento parcial, transferência seletiva e cancelamento autorizado;
- cozinha/KDS com setores de produção, produto→setor e roteamento compartilhado por Restaurante, Delivery e Fast-food;
- Pizzaria opcional com tamanhos, múltiplos sabores/meio a meio, bordas e política configurável de preço;
- Delivery opcional com entrega/retirada, região, taxa, entregador, ETA e status operacional;
- Fast-food/Lanchonete opcional com senha diária e fila de produção;
- Mercado/Conveniência/Padaria opcional com itens por peso, formato de etiqueta configurável e encomendas;
- Varejo opcional amplia o catálogo comum com fluxos específicos do segmento; produto pai/subitens e estoque por variação não dependem da ativação desse módulo;
- Serviços opcional com catálogo, profissionais, agenda local, bloqueio de conflitos e comissão;
- Oficina opcional com veículos/equipamentos, OS, diagnóstico, orçamento, aprovação, peças e mão de obra;
- Autoatendimento opcional por dispositivo pareado, com pedido local para mesa/retirada e pagamento manual no caixa;
- configuração inicial por segmento com recomendações editáveis de módulos;
- QR de acesso à interface mobile local em `http://IP-DO-SERVIDOR:4174/mobile`;
- matriz versionada de compatibilidade separando protocolo validado de modelo físico testado;
- dispositivos LAN de garçom, tablet vinculado à mesa, KDS e autoatendimento, com credenciais derivadas, bloqueio e rotação;
- interface móvel self-hosted em `/mobile`, sem CDN, SaaS ou internet obrigatória;
- LAN com pareamento de terminais, handshake de versão e deduplicação de mutações;
- backup com manifesto/SHA-256, validação e restore atômico;
- importação CSV/XLSX com preview, erros por linha e commit idempotente;
- health, logs estruturados, diagnóstico ZIP e checklist persistente de piloto;
- perfis de implantação **Servidor + Terminal** e **Terminal**.

## Produto pai e subitens

O catálogo comum suporta hierarquia de produto pai → variações, independentemente do módulo opcional Varejo.

Exemplos:

- Tang → Uva, Limão, Laranja;
- Coca-Cola → 350 ml, 600 ml, 2 L;
- Camiseta → P, M, G e combinações de cor/tamanho.

Cada subitem pode ter SKU, código de barras, preço, custo, atributos e estoque próprios. Quando existem variações ativas, o item pai não é vendido diretamente: o caixa exige a seleção da variação correta. O estoque do pai deve estar zerado ou distribuído antes da criação da primeira variação; depois disso o controle ocorre nos subitens. Venda, cancelamento e devolução preservam o subitem pelo snapshot histórico.

## Kits e combos promocionais

**Kit** é um produto composto cujo nome, preço, custo e componentes são definidos pelo usuário. A venda baixa os componentes reais e salva a composição vigente como snapshot para que cancelamentos/devoluções posteriores não dependam de uma edição futura do cadastro.

**Combo promocional** é uma regra de preço configurável aplicada aos produtos existentes. Exemplo: unidade por R$ 3,99 e `3 por R$ 10,00`. A regra pode definir participantes, quantidade, preço do grupo, validade, limite por venda e se pode acumular com desconto manual. O desconto promocional fica registrado separadamente do desconto manual.

Detalhes arquiteturais: `docs/architecture/catalog-parent-variants-kits-combos.md`.

## Módulos opcionais

O núcleo básico do PDV não é desativável. Em `Configurações > Módulos`, o estabelecimento ativa somente o que utiliza, sem reinstalação e sem apagar histórico:

- Restaurante;
- Pizzaria;
- Delivery;
- Fast-food / Lanchonete;
- Mercado / Conveniência / Padaria;
- Varejo;
- Serviços;
- Oficina;
- Autoatendimento.

O bloqueio existe tanto na UI quanto no backend. Um módulo desativado não aparece como fluxo operacional e não aceita novas mutações específicas.

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

Em rede, existe um único servidor autoritativo. Terminais e dispositivos móveis não recebem caminho do SQLite e não acessam o banco por SMB; usam somente a API local na LAN. O renderer Electron não possui acesso Node, SQL, filesystem ou serial genérico.

Todos os módulos verticais reutilizam o `SaleService` canônico. Estoque, caixa, impressão, auditoria e efeitos de domínio continuam compartilhados.

Hardware físico fica atrás de `desktop/hardware-runtime.cjs`. Os módulos reutilizáveis são vendorizados e fixados por commit em `vendor/artisys-modules.lock.json`, preservando build reproduzível sem depender de registry privado.

## Requisitos e execução de desenvolvimento

- Node.js 22+;
- Windows x64 é o alvo de empacotamento comercial 1.3.2.

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

Dispositivos móveis usam a interface self-hosted `http://IP-DO-SERVIDOR:4174/mobile`. O transporte HTTP é destinado somente a LAN confiável e não é apresentado como HTTPS ou exposição segura à internet. O QR da E53 apenas codifica esse endereço local; a interface atual **não é declarada PWA instalável**.

## Hardware

A impressão padrão é `PDV_PRINTER_MODE=electron`. Para impressora térmica local, use `thermal` com tipo Epson/Star e interface explícita; para porta serial, use `serial` com porta e baud rate. Balança e gaveta permanecem opcionais e usam `PDV_SCALE_*` e `PDV_DRAWER_*`. Para respostas fragmentadas de balança, `PDV_SCALE_SETTLE_MS` controla a janela de silêncio antes do parse, com padrão de 30 ms.

Em **Configurações > Dados da loja e cupom não fiscal**, nome, endereço, telefone e logo podem ser definidos localmente. Campos vazios são omitidos; a logo é convertida para PNG no próprio computador e o snapshot do branding é preservado na fila para que reimpressões mantenham a identidade do comprovante original.

A E54.1 executa na CI cenários de desconexão/reconexão, COM ocupada/inexistente, timeout e retry de balança, resposta serial fragmentada, dados inválidos, spooler offline/recuperado, Epson/Star, corte, pulso de gaveta, larguras 32/42/48, leitor `keyboard-wedge` repetido e stress de ciclos seriais.

A matriz usa três níveis centrais:

- `PROTOCOL_VERIFIED`: caminho/protocolo validado automaticamente pelo software;
- `FIELD_VERIFIED`: fabricante/modelo físico realmente testado com evidência;
- `UNTESTED_MODEL`: modelo específico ainda não testado fisicamente.

Isso permite oferecer compatibilidade por protocolo sem fingir homologação de um modelo que nunca esteve conectado ao PDV.

## Regra comercial fiscal e pagamentos

A versão comercial 1.3.2 opera somente com documentos e impressão claramente identificados como **NÃO FISCAL**. NFC-e, NF-e, SAT, MFE, SEFAZ, certificado digital e provedores fiscais não fazem parte dos fluxos comerciais. Código fiscal legado pode permanecer internamente por compatibilidade, mas não é requisito nem recurso comercial desta release.

Pagamentos são registrados manualmente no PDV. Não há TEF, PinPad, adquirente, API bancária ou confirmação automática de PIX. Autoatendimento também não processa pagamento eletrônico integrado.

## Verificação e release

```bash
npm run docs:check
npm run verify
npm run verify:release
npm run dist:win
npm run release:manifest -- --output dist/release-manifest.json --artifact dist/ArtiSys-PDV-1.3.2-x64-Setup.exe
```

`docs:check` valida invariantes documentais automatizáveis, incluindo versão do README e capacidades/limitações de release. `verify` cobre domínio/API/UI, architecture checks, documentação e E54.1. `verify:release` acrescenta gates de concorrência, recovery e segurança. O workflow Windows gera o NSIS x64, manifesto e checksum a partir do mesmo commit.

Para solicitar uma build Windows sem duplicar o pipeline de verificação, atualize `.github/release-request.json` no `main`. Esse arquivo dispara somente `release-windows`; o workflow executa `verify:release`, gera o instalador NSIS x64 nativo, cria `release-manifest.json` com SHA-256 e publica ambos como artefato. O fluxo manual por `workflow_dispatch` e o fluxo por tag `v*` continuam disponíveis.

## Operação e arquitetura

- `docs/operations/install-server.md`
- `docs/operations/install-terminal.md`
- `docs/operations/pairing.md`
- `docs/operations/cash-sales-returns.md`
- `docs/operations/backup-restore.md`
- `docs/operations/hardware-printing.md`
- `docs/operations/import.md`
- `docs/operations/diagnostics.md`
- `docs/operations/update.md`
- `docs/architecture/e30-e39-restaurant.md`
- `docs/architecture/e40-e47-verticals.md`
- `docs/architecture/catalog-parent-variants-kits-combos.md`

## Regra de manutenção documental

`CONTRIBUTING.md` define como regra obrigatória que qualquer alteração de comportamento, arquitetura, operação, requisito, limitação ou release atualize a documentação correspondente **na mesma entrega**. Código atualizado com README/metadados/documentação desatualizados não é considerado uma entrega concluída.

## Limitações externas

O funcionamento diário de venda, estoque, caixa, módulos opcionais, KDS, LAN, impressão local e integração serial não depende de nuvem nem de serviço pago. A E54.1 reduz o risco antes da instalação real validando os protocolos por simulação, mas hardware, firmware, cabo e driver específicos continuam sendo variáveis externas.

Um modelo físico não testado fica `UNTESTED_MODEL`; quando a família de integração já passou na CI, ela pode estar `PROTOCOL_VERIFIED`. Somente o modelo realmente conectado e validado com evidência passa a `FIELD_VERIFIED`.

Metadados completos de capacidades, limitações e matriz de compatibilidade ficam em `release/capabilities.json`, `release/limitations.json` e `release/hardware-compatibility.json`.
