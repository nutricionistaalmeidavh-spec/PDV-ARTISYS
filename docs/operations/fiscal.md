# Fiscal — NFC-e/NF-e

A camada fiscal é desacoplada do checkout. A venda é concluída no domínio e a emissão fiscal ocorre por efeito durável/idempotente, permitindo retry sem duplicar os efeitos de venda, estoque e caixa.

## Estado atual — Fiscal Blocos 1, 2 e 3

O núcleo suporta dois providers no contrato:

- `acbr-local`: provider local destinado ao core sem mensalidade e sem custo por documento para a ArtiSys;
- `focus`: provider externo opcional mantido por compatibilidade.

O provider `acbr-local` conversa somente com o Fiscal Sidecar iniciado pelo Electron em loopback. O modo padrão do sidecar continua sendo `unconfigured`, que recusa emissão em vez de produzir autorização falsa. Os modos `mock-success` e `mock-failure` existem apenas para testes controlados.

### Bloco 1 — fundação

- invariantes de venda/estoque/caixa protegidos por E2E;
- provider registry com `acbr-local` e Focus opcional;
- Fiscal Sidecar local e lifecycle controlado;
- isolamento de rede em loopback.

### Bloco 2 — configuração, tributação e persistência

O schema fiscal evolui de forma aditiva para v13 e acrescenta:

- `fiscal_company_settings`;
- `fiscal_profiles`;
- `product_fiscal_data`;
- `fiscal_sequences`;
- `fiscal_certificates_metadata`;
- `fiscal_document_events`;
- campos adicionais de autorização, XML, DANFE, contingência e retorno SEFAZ em `fiscal_documents`.

O runtime expõe `fiscalConfiguration` para persistir configuração pública da empresa, perfis fiscais, vínculo produto → perfil e sequência fiscal.

A preparação de uma venda fiscal resolve **todos os produtos antes de consumir numeração**. Se um produto estiver sem perfil fiscal, a venda permanece válida e a sequência não avança.

A reserva do número ocorre dentro de transação SQLite `BEGIN IMMEDIATE`, preservando a sequência entre restart e evitando uma numeração mantida apenas em memória.

O modelo de perfil suporta os campos legados necessários ao builder (`NCM`, `CEST`, `CFOP`, origem, CST/CSOSN, PIS, COFINS e unidade) e preserva identidade da RTC por `CST IBS/CBS` + `cClassTrib`, sem hardcode da tabela oficial que pode ser atualizada ao longo do tempo.

O CNPJ deixou de ser reduzido a somente dígitos no builder fiscal e é preservado como identificador alfanumérico de 14 posições. CNPJs numéricos legados continuam compatíveis.

### Certificado A1 e CSC

PFX, senha e CSC **não são gravados no SQLite**. O Electron usa `safeStorage` e arquivo local protegido no `userData`.

O cofre A1:

- valida o PKCS#12 e a senha usando o runtime TLS do Node;
- extrai o X.509 sem dependência externa;
- mantém fingerprint, serial, subject e validade como metadados públicos;
- não retorna PFX, senha ou CSC em status público;
- bloqueia o provider ACBr local quando o certificado está ausente, com validade não verificável ou vencido;
- não interfere no checkout: uma falha dessas bloqueia a emissão fiscal, não a venda.

A tabela `fiscal_certificates_metadata` existe apenas para metadados públicos; material criptográfico continua fora do SQLite comum.

### Bloco 3 — documento e integração ACBr

- `FiscalDocumentBuilder` canônico, independente de provider;
- preservação dos totais da venda em centavos, sem recálculo fiscal paralelo;
- rateio determinístico do desconto da venda entre itens;
- `cNF` determinístico por documento para retry estável;
- resolução explícita dos dados tributários de cada produto a partir de `fiscalContext`;
- geração de INI NFC-e modelo 65 para ACBrMonitorPLUS;
- transporte TCP local para ACBrMonitor com terminador de comando `CRLF . CRLF`;
- parser de resposta com `cStat`, chave, protocolo e caminho do XML;
- adapter `acbr-monitor` somente por opt-in e homologação;
- E2E determinístico do caminho `Sale -> FiscalDocument -> Sidecar -> ACBr adapter -> autorização normalizada`;
- E2E externo opt-in para homologação real.

A versão comercial continua sendo tratada como não fiscal enquanto não existir evidência de autorização externa real em homologação, configuração operacional completa do ACBrMonitor e mapeamento validado do layout fiscal vigente.

## Documento fiscal canônico

Para `acbr-local`, quando `resolveConfiguration()` fornecer `fiscalContext`, o efeito automático de `sale.completed` constrói um documento fiscal canônico antes de chamar `FiscalService.requestIssue()`.

```text
Sale COMPLETED
  -> fiscalConfiguration
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
- venda diferente de `COMPLETED` seja recusada sem mutar a venda;
- a mesma venda/série/número gere o mesmo `cNF` de 8 dígitos em retries.

O domínio de vendas não conhece ACBr, XML, CSC, certificado ou SEFAZ.

## Configuração pública

Para o core local devem ser persistidos sem segredo:

- provider;
- documento (`nfce`/`nfe`);
- ambiente;
- autoemissão;
- CNPJ/IE;
- razão social/nome fantasia;
- CRT/CNAE;
- endereço e código IBGE;
- série;
- natureza da operação;
- ID do CSC (o CSC em si permanece no cofre criptografado).

Para Focus, o token continua obrigatório e permanece no armazenamento seguro já existente.

Para `acbr-local`, não existe token de API paga. O endpoint HTTP do sidecar não é configurado pelo usuário: ele é resolvido pelo processo principal e precisa ser loopback local.

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

## ACBrMonitor — caminho de integração do Bloco 3

O modo real é deliberadamente opt-in. O default permanece `unconfigured`.

```text
ARTISYS_FISCAL_SIDECAR_MODE=acbr-monitor
ARTISYS_ACBR_HOST=127.0.0.1
ARTISYS_ACBR_PORT=3434
ARTISYS_ACBR_TIMEOUT_MS=30000
```

O adapter atual aceita somente:

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

Falha de rede/provider/sidecar/certificado/configuração não deve apagar ou reverter a venda.

Os testes protegem explicitamente:

- venda `COMPLETED` preservada quando o fiscal falha;
- estoque movimentado uma única vez;
- caixa movimentado uma única vez;
- retry fiscal sem criar outro `fiscal_document`;
- persistência após reinício;
- instalação sem autoemissão continua operando normalmente;
- `total fiscal === total canônico da venda`;
- `cNF` estável em retry;
- produto sem tributação não consome número fiscal;
- sequência fiscal persiste após restart;
- PFX/senha/CSC não aparecem em SQLite nem no status público;
- rejeição ACBr não vira autorização;
- provider e ACBrMonitor permanecem restritos a loopback;
- Focus opcional continua compatível.

Nunca marque emissão como aprovada sem resposta válida do provider.

## Homologação real — status

A estrutura P3–P7 está preparada, mas a evidência externa de autorização continua pendente até existir, no ambiente autorizado de teste:

- ACBrMonitorPLUS instalado e configurado;
- certificado A1 válido de homologação;
- CSC/credenciamento aplicável;
- série/numeração de homologação;
- dados tributários reais dos produtos;
- mapeamento ACBr compatível com os grupos vigentes da RTC;
- schemas fiscais vigentes;
- acesso ao serviço SEFAZ correspondente.

Portanto, os Blocos 1–3 não devem ser anunciados como NFC-e homologada nem como emissão fiscal pronta para cliente antes do `EXTERNAL_E2E` retornar autorização real com evidência registrada.
