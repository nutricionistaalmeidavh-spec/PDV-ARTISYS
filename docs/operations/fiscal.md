# Fiscal — NFC-e/NF-e

A camada fiscal é desacoplada do checkout. A venda é concluída no domínio e a emissão fiscal ocorre por efeito durável/idempotente, permitindo retry sem duplicar o documento.

## Estado atual — Fiscal Bloco 1

O núcleo suporta dois providers no contrato:

- `acbr-local`: provider local destinado ao core sem mensalidade;
- `focus`: provider externo opcional mantido por compatibilidade.

O provider `acbr-local` conversa somente com o Fiscal Sidecar iniciado pelo Electron em loopback. O sidecar deste bloco ainda usa adapter controlado e **não representa emissão real via ACBr/SEFAZ**. O modo padrão é `unconfigured`, que recusa emissão em vez de produzir autorização falsa. O modo `mock-success` é exclusivo de testes.

A versão comercial continua não fiscal até que certificado, tributação, XML, homologação SEFAZ, contingência e DANFE sejam concluídos e validados.

## Configuração

A configuração fiscal continua protegida fora do renderer pelo armazenamento seguro do sistema operacional.

Para Focus, o token continua obrigatório.

Para `acbr-local`, não existe token de API paga. O endpoint do sidecar não é configurado pelo usuário: ele é resolvido pelo processo principal e precisa ser loopback local.

Teste primeiro em homologação. Produção não deve ser habilitada antes de validar dados da empresa, certificado, CSC quando aplicável, série/numeração, tributação e requisitos fiscais do estabelecimento.

## Fiscal Sidecar

O processo principal inicia o sidecar somente no perfil que possui servidor local autoritativo.

Propriedades de segurança e recuperação:

- bind permitido apenas em `127.0.0.1` ou `::1`;
- acesso por `0.0.0.0`, IP da LAN ou host remoto é rejeitado;
- falha de startup do sidecar não derruba o PDV;
- queda inesperada após startup dispara tentativas limitadas de reinício;
- shutdown do aplicativo encerra o sidecar;
- o renderer não recebe acesso direto ao processo ou ao filesystem fiscal.

Rotas internas do Bloco 1:

```text
GET  /v1/health
GET  /v1/sefaz/status
POST /v1/documents/:type/:reference
GET  /v1/documents/:type/:reference
POST /v1/documents/:type/:reference/cancel
```

Essas rotas são contrato local interno e não são API LAN do PDV.

## Falhas e invariantes

Falha de rede/provider/sidecar não deve apagar ou reverter a venda.

O documento permanece pendente/falho conforme o estado persistido e pode ser reenviado pelo domínio fiscal sem repetir efeitos de estoque ou caixa.

Os testes do Bloco 1 protegem explicitamente:

- venda `COMPLETED` preservada quando o fiscal falha;
- estoque movimentado uma única vez;
- caixa movimentado uma única vez;
- retry fiscal sem criar outro `fiscal_document`;
- persistência após reinício;
- instalação sem autoemissão continua operando normalmente.

Nunca marque emissão como aprovada sem resposta válida do provider.

## Homologação real

Emissão real permanece `BLOCKED_EXTERNAL` até os próximos blocos fornecerem:

- adapter ACBr real;
- certificado e armazenamento de segredo correspondente;
- payload tributário completo;
- XML e validação;
- credenciamento/CSC quando exigido;
- comunicação de homologação com SEFAZ;
- evidência E2E externa de autorização.
