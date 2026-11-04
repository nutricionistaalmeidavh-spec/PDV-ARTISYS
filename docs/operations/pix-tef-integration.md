# Pix e TEF — tentativas locais, homologacao e seguranca

> Implementacao opt-in. O checkout manual existente continua o padrao. Nenhum gateway pago, nuvem, credencial ou contrato externo e requisito para vendas, estoque, caixa ou funcionamento LAN.

## Estado da entrega

- **PIX_STATIC**: BR Code/QR gerados localmente, valor exato em centavos e referencia por venda; **nao detecta recebimento**. Confirmacao manual exige operador com `sales.cancel`, confirmacao de credito na conta e registro de auditoria pelo intent.
- **PIX_API**: adaptador `js/domains/payments/pix-api-provider.js` para `PUT /cob/{txid}`, QR dinamico e verificacao `GET /cob/{txid}`. Requer banco que disponibilize API Pix, token OAuth valido e, quando exigido, certificado mTLS. O banco deve fornecer os dados ao estabelecimento; o aplicativo nao contem credenciais predefinidas.
- **TEF**: contrato `tefProvider.start({id,txid,amountCents,method,saleId})`. Exige implementacao compatível com a operadora/PinPad e homologacao real. O modulo fiscal ACBr existente na Oficina Agrícola nao implementa TEF; nao se declara hardware ou PayGo homologado.
- **Fiscal**: `paymentIntents.fiscalReferences(saleId)` entrega `endToEndId`, canal e referencia de adquirente. A release comercial atual nao emite NFC-e; nenhum XML fiscal e gerado, nem se declara vinculo SEFAZ habilitado.

## Como ativar Pix estatico (sem mensalidade)

Na tela **Balcão → Pagamento da venda → Configurar Pix da loja**, o gestor autorizado cadastra chave, nome do recebedor e cidade. A configuração fica no SQLite do servidor da loja, não no terminal e não é apagada por atualização. A chave Pix é pública para recebimentos; nenhuma senha bancária deve ser inserida nesse formulário.

Como alternativa para instalação administrada, no ambiente **do servidor autoritativo** (nunca nos terminais da LAN) configure:

```text
PDV_PIX_KEY=chave-registrada-do-estabelecimento
PDV_PIX_MERCHANT_NAME=NOME DA LOJA
PDV_PIX_CITY=CIDADE
```

Inicie o PDV; no Balcao, selecione Pix, clique **QR Pix**, exiba o QR ou use Copia e Cola. Apos consultar o extrato bancario, o responsavel autorizado escolhe **Conferi o credito no banco**. Um print de comprovante nao serve como prova. Use o botao **Voltar** para concluir a venda. Para desistir antes da confirmacao, escolha **Cancelar QR**.

A simples geracao de QR **nao** altera caixa/estoque e **nao** conclui a venda. QR do Pix estatico pode ser pago mesmo depois de abandonar a tentativa; o operador precisa conferir o extrato antes de receber novamente por outro meio.

## API local autenticada

Operacoes na API LAN exigem sessao e permissoes equivalentes ao checkout:

| Metodo | Caminho | Comportamento |
|---|---|---|
| GET | `/api/v1/payment-intents/capabilities` | Canais realmente configurados |
| POST | `/api/v1/payment-intents` | Cria intent idempotente |
| GET | `/api/v1/payment-intents?saleId=<id>` | Recupera tentativas |
| GET | `/api/v1/payment-intents/<id>` | Consulta estado |
| POST | `/api/v1/payment-intents/<id>/start` | Inicia no provedor apenas uma vez |
| POST | `/api/v1/payment-intents/<id>/reconcile` | Consulta banco Pix |
| POST | `/api/v1/payment-intents/<id>/confirm-manual` | Confere Pix estatico, exige permissao gerencial |
| POST | `/api/v1/payment-intents/<id>/cancel` | Cancela apenas intent Pix estatico ainda pendente |

Exemplo de criação:
```json
{"saleId":"s1","channel":"PIX_STATIC","method":"PIX","amountCents":1999,"idempotencyKey":"uuid-da-tentativa"}
```
Inclua `metadata.paymentIntentId` no pagamento enviado para `/api/v1/sales/:saleId/complete`. O `SaleService` valida na mesma transacao SQLite que a tentativa foi confirmada, pertence a venda, tem metodo/valor identicos e ainda nao foi consumida. Tentativas nao vinculadas bloqueiam a finalizacao para evitar pagamento em duplicidade. O operador pode continuar com o fluxo manual se nenhuma tentativa integrada foi iniciada.

## Adaptador de API Pix (opcional, por banco)

O `createPixApiProvider` e exportado por `js/domains/payments/pix-api-provider.js`. O servidor pode receber `paymentOptions.pixProvider` ao criar `createPdvRuntime()`:

```js
const {createPixApiProvider}=require('./js/domains/payments/pix-api-provider');
const pixProvider=createPixApiProvider({
  baseUrl:'https://api.do-banco.example/pix/v2/',
  pixKey:chavePixDaLoja,
  certPath:caminhoCertCliente, keyPath:caminhoChavePrivada,
  tokenProvider:async()=>obterTokenOAuthVigenteDoBanco()
});
const runtime=createPdvRuntime({paymentOptions:{pixProvider}});
```

O adaptador nunca salva token, certificado ou chave privada no SQLite. O operador precisa configurar um banco de verdade e validar ambiente de homologacao com o provedor. Nao ha proxy Cloudflare, Asaas nem tarifa obrigatoria. Se nao existe adaptador configurado, Pix automatico fica desabilitado. O tokenProvider representa um fluxo OAuth2 proprio do banco, que ainda precisa ser provido para a instituicao escolhida.

## Contrato do TEF

`paymentOptions.tefProvider` recebe uma implementacao local e isolada. A resposta so sera marcada VERIFIED quando contiver `{status:'APPROVED',txid,amountCents,nsu,authorizationCode,acquirer}` associados exatamente a tentativa. Recusa vira FAILED; perda de conexao, resposta duvidosa ou queda vira REVIEW e **nao** provoca repeticao automatica. Para recuperar um resultado indeterminado, o adaptador pode implementar `tefProvider.verify({id,txid,amountCents,method,saleId})`; somente uma resposta autenticada, com valor e identificador coincidentes, devolve VERIFIED. Exigir status de transacao da operadora antes de nova tentativa.

O contrato do provedor **nao substitui** um executavel ACBr/PayGo/SiTef, PinPad homologado ou credenciamento. Esta fase entrega o motor de transacoes, nao um conector especifico de maquininha pronto para producao.

## Estorno, fiscal e limites

Tentativas integradas pendentes, indeterminadas ou consumidas bloqueiam o cancelamento da venda ate cancelamento seguro/estorno/conciliacao externa. Devolucoes de vendas com Pix/TEF integrado recebido tambem ficam bloqueadas, pois o movimento contabil local nao restitui dinheiro no banco ou adquirente. Pix devolucao, cancelamento TEF e conciliacao fiscal em producao **ainda necessitam de implementacao/homologacao**. Nao usar a compensacao contabil local como prova de estorno real.

Nao armazenar PAN, trilha, senha do PinPad, token OAuth ou senha de certificado em `payment_intents` ou logs. A tabela persiste somente status e referencias. Dados e migrations sao aditivos; nao ha reset de estoque nem das vendas existentes.

## Portao de release

Antes de disponibilizar ao cliente: `npm test`, `npm run verify`, `npm run qa:artifact-semantic` (decodificacao Pix com `rsvg-convert` e `zbarimg`), QA do checkout e pagamento misto, restart da base, teste bancario/TEF em homologacao com credenciais proprias, cancelamento/reembolso real e teste fisico do PinPad. Nao gerar release comercial da main apenas com mocks.
