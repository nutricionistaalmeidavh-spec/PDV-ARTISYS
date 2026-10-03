# Central de Licenças ArtiSys

Worker comercial do **PDV ArtiSys** na conta Cloudflare `sistema-artisys`.

Este serviço é separado do core local do PDV. O PDV continua local/self-hosted; a nuvem participa somente da liberação inicial, consulta de status da licença e recuperação administrativa.

## Fluxo de liberação

1. Acesse `/admin` no Worker `pdv-artisys`.
2. Informe o `ADMIN_TOKEN`.
3. Digite o e-mail do cliente e, opcionalmente, a validade da licença.
4. Clique em **Gerar código**.
5. A Central mostra um código de 6 dígitos e o botão **Copiar código**.
6. **Você envia esse código ao cliente** pelo meio que preferir.
7. No primeiro acesso, o cliente informa o mesmo e-mail + código.
8. O código é consumido uma única vez e a instalação fica vinculada à licença.
9. O primeiro Administrador é criado localmente no PDV; senha e hash nunca são enviados ao Cloudflare.

Não existe envio automático de e-mail neste fluxo.

## Central

- `GET /admin` — interface da Central.
- `GET /v1/admin/licenses` — lista licenças; exige Bearer `ADMIN_TOKEN`.
- `POST /v1/admin/licenses` — cria/libera uma licença e retorna o código.
- `PATCH /v1/admin/licenses/:id` — altera status para `ACTIVE`, `SUSPENDED`, `CANCELLED` ou `EXPIRED`.
- `POST /v1/admin/recovery` — gera código manual de recuperação para uma instalação ativa.

## API do PDV

- `GET /health`
- `POST /v1/activation/request` — não envia código; apenas orienta a usar o código fornecido pela ArtiSys.
- `POST /v1/activation/verify` — valida e consome o código.
- `GET /v1/license/status?installationId=...` — retorna apenas se a licença está ativa.
- `POST /v1/password-recovery/request`
- `POST /v1/password-recovery/verify`

## D1

O Worker aceita os dois nomes de binding:

- `artisys` — binding existente no Worker `pdv-artisys`;
- `DB` — compatibilidade com configuração antiga.

Na primeira operação que precisa do banco, o Worker cria de forma idempotente as tabelas próprias da Central caso ainda não existam. Ele não apaga tabelas nem dados existentes.

Tabelas usadas:

- `accounts`
- `licenses`
- `activation_tokens`
- `installations`
- `password_recovery_tokens`

## Segredos de runtime

Configure em **Workers & Pages → pdv-artisys → Configurações → Variáveis e segredos**:

- `ADMIN_TOKEN` — senha/token forte para abrir os dados da Central;
- `ACTIVATION_PEPPER` — segredo forte usado para armazenar somente o digest dos códigos;
- `RECOVERY_PEPPER` — segredo independente para códigos de recuperação.

Esses valores são segredos de **runtime**, não variáveis do build.

## Deploy pelo repositório

O Worker conectado no Cloudflare é `pdv-artisys`, branch de produção `main`.

O `package.json` da raiz possui `npm run build` apenas para validar a sintaxe e os testes da Central antes do deploy.

**Importante:** não adicione um `wrangler.toml/jsonc` incompleto na raiz. Wrangler trata a configuração como fonte de verdade e uma configuração sem o D1/R2 reais pode remover bindings configurados pelo painel.

O arquivo `wrangler.toml.example` serve apenas como referência para uma futura configuração declarativa, quando o ID real do D1 desta conta for copiado do painel.

## Core local

O Cloudflare não é dependência do funcionamento diário do PDV já ativado. Nenhum dado operacional de venda, caixa, clientes, produtos ou senha do Administrador é armazenado nesta Central.
