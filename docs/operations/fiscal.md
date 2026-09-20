# Fiscal — NFC-e/NF-e

A camada fiscal é desacoplada do checkout. A venda é concluída no domínio e a emissão fiscal ocorre por efeito durável/idempotente, permitindo retry sem duplicar os efeitos de venda, estoque e caixa.

## Estado atual — Fiscal Blocos 1 e 3

O núcleo suporta dois providers no contrato:

- `acbr-local`: provider local destinado ao core sem mensalidade e sem custo por documento para a ArtiSys;
- `focus`: provider externo opcional mantido por compatibilidade.

O provider `acbr-local` conversa somente com o Fiscal Sidecar iniciado pelo Electron em loopback. O modo padrão do sidecar continua sendo `unconfigured`, que recusa emissão em vez de produzir autorização falsa. Os modos `mock-success` e `mock-failure` existem apenas para testes controlados.

O Bloco 3 acrescenta:

- `FiscalDocumentBuilder` canônico, independente de provider;
- preservação dos totais da venda em centavos, sem recálculo fiscal paralelo;
- rateio determinístico do desconto da venda entre itens;
- resolução explícita dos dados tributários de cada produto a partir de `fiscalContext`;
- geração de INI NFC-e modelo 65 para ACBrMonitorPLUS;
- transporte TCP local para ACBrMonitor com terminador de comando `CRLF . CRLF`;
- parser de resposta de autorização com `cStat`, chave, protocolo e caminho do XML;
- adapter `acbr-monitor` disponível somente por opt-in e somente em homologação neste bloco;
- E2E determinístico do caminho `Sale -> FiscalDocument -> Sidecar -> ACBr adapter -> autorização normalizada`;
- E2E externo opt-in para homologação real.

A versão comercial continua sendo tratada como não fiscal enquanto o Bloco 2 não fornecer configuração persistida de certificado/CSC/tributação e enquanto uma autorização externa real em homologação não for executada e registrada como evidência.

## Documento fiscal canônico

Para `acbr-local`, quando `resolveConfiguration()` fornecer `fiscalContext`, o efeito automático de `sale.completed` constrói um documento fiscal canônico antes de chamar `FiscalService.requestIssue()`.

Fluxo:

```text
Sale COMPLETED
  -> FiscalDocumentBuilder
  -> FiscalDocument
  -> FiscalService
  -> acbr-local
  -> Fiscal Sidecar
  -> ACBrMonitor adapter
```

O builder exige que:

- `subtotalCents - discountCents === totalCents`;
- a soma bruta dos itens seja igual ao subtotal canônico;
- o rateio dos descontos preserve exatamente `totalCents`;
- `pagamentos - troco === totalCents`;
- todo item possua dados fiscais resolvidos;
- venda diferente de `COMPLETED` seja recusada sem mutar a venda.

O domínio de vendas não conhece ACBr, XML, CSC, certificado ou SEFAZ.

## Configuração

A configuração fiscal continua protegida fora do renderer pelo armazenamento seguro do sistema operacional.

Para Focus, o token continua obrigatório.

Para `acbr-local`, não existe token de API paga. O endpoint HTTP do sidecar não é configurado pelo usuário: ele é resolvido pelo processo principal e precisa ser loopback local.

O Bloco 2 ainda é necessário para persistir e operar de forma segura:

- certificado A1/PFX e senha;
- CSC/ID CSC;
- emitente e endereço fiscal;
- série e sequência fiscal transacional;
- perfis tributários/NCM/CFOP/CST/CSOSN/PIS/COFINS.

Até essa etapa existir, o adapter ACBrMonitor pode ser exercitado por configuração técnica explícita em homologação, mas não constitui release fiscal pronto para cliente.

## Fiscal Sidecar

O processo principal inicia o sidecar somente no perfil que possui servidor local autoritativo.

Propriedades de segurança e recuperação:

- bind permitido apenas em `127.0.0.1` ou `::1`;
- acesso por `0.0.0.0`, IP da LAN ou host remoto é rejeitado;
- ACBrMonitor também precisa estar em loopback;
- falha de startup do sidecar não derruba o PDV;
- queda inesperada após startup dispara tentativas limitadas de reinício;
- shutdown do aplicativo encerra o sidecar;
- o renderer não recebe acesso direto ao processo ou ao filesystem fiscal.

Rotas internas:

```text
GET  /v1/health
GET  /v1/sefaz/status
POST /v1/documents/:type/:reference
GET  /v1/documents/:type/:reference
POST /v1/documents/:type/:reference/cancel
```

Essas rotas são contrato local interno e não são API LAN do PDV.

## ACBrMonitor — modo de homologação do Bloco 3

O modo real é deliberadamente opt-in. O default permanece `unconfigured`.

Variáveis técnicas:

```text
ARTISYS_FISCAL_SIDECAR_MODE=acbr-monitor
ARTISYS_ACBR_HOST=127.0.0.1
ARTISYS_ACBR_PORT=3434
ARTISYS_ACBR_TIMEOUT_MS=30000
```

O adapter do Bloco 3 aceita somente:

```text
documentType = nfce
environment  = homologation
model        = 65
```

Tentativa de produção é recusada. NF-e modelo 55, consulta/reconciliação e cancelamento real permanecem para os blocos correspondentes do roadmap.

A emissão usa arquivo INI temporário com permissão restrita, chama `NFe.CriarEnviarNFe(..., 1, 0, 1)` de forma síncrona e remove o arquivo temporário ao final. Somente resposta fiscal com `cStat=100` é normalizada como autorizada.

## E2E externo de homologação

O teste externo fica fora da suíte normal para não tornar o CI dependente de certificado, internet, ACBrMonitor ou disponibilidade da SEFAZ.

Arquivo:

```text
test/external/fiscal-acbr-homologation.external.test.js
```

Execução explícita:

```text
ARTISYS_FISCAL_EXTERNAL_E2E=1
ARTISYS_FISCAL_EXTERNAL_DOCUMENT_FILE=<caminho-json-fiscal-canonico>
ARTISYS_ACBR_HOST=127.0.0.1
ARTISYS_ACBR_PORT=3434
node --test test/external/fiscal-acbr-homologation.external.test.js
```

O teste exige retorno `cStat=100`, chave de 44 dígitos, protocolo e caminho do XML. Sem opt-in ele é ignorado.

## Falhas e invariantes

Falha de rede/provider/sidecar não deve apagar ou reverter a venda.

O documento permanece pendente/falho conforme o estado persistido e pode ser reenviado pelo domínio fiscal sem repetir efeitos de estoque ou caixa.

Os testes protegem explicitamente:

- venda `COMPLETED` preservada quando o fiscal falha;
- estoque movimentado uma única vez;
- caixa movimentado uma única vez;
- retry fiscal sem criar outro `fiscal_document`;
- persistência após reinício;
- instalação sem autoemissão continua operando normalmente;
- `total fiscal === total canônico da venda`;
- rejeição ACBr não vira autorização;
- provider e ACBrMonitor restritos a loopback;
- Focus opcional continua compatível.

Nunca marque emissão como aprovada sem resposta válida do provider.

## Homologação real — status

A implementação do protocolo ACBrMonitor e o harness externo estão prontos, mas a evidência externa de autorização permanece pendente enquanto não houver, no ambiente autorizado de teste:

- ACBrMonitorPLUS configurado;
- certificado A1 válido de homologação;
- CSC/credenciamento quando aplicável;
- série/numeração de homologação;
- dados tributários válidos para os itens;
- acesso ao serviço SEFAZ correspondente.

Portanto, o Bloco 3 é **homologation-ready**, mas não deve ser anunciado como NFC-e real homologada até o `EXTERNAL_E2E` retornar autorização real e essa evidência ser registrada.
