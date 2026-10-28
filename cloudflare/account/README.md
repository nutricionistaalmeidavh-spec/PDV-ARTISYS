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
8. O código é válido por **48 horas** após sua emissão, é consumido uma única vez e a instalação fica vinculada à licença. O prazo do código não limita a duração da licença.
9. O primeiro Administrador é criado localmente no PDV; senha e hash nunca são enviados ao Cloudflare.

Não existe envio automático de e-mail neste fluxo.

## Reinstalação após formatação

1. Confirme que o cliente está na tela **Ativar instalação**, usando o instalador ArtiSys já divulgado. O link não gera nem renova códigos.
2. Na Central em `/admin`, localize a licença **ACTIVE** pelo e-mail e clique em **Reativar instalação**.
3. Copie e envie o novo código de seis dígitos ao cliente (48 horas, uso único).
4. O cliente informa o e-mail da licença e o novo código. A licença original permanece ativa; não é criada outra cobrança nem uma nova licença.
5. Se a formatação removeu a base local, restaure um backup do banco operacional antes de esperar recuperar cadastros, estoque, vendas e credenciais. O serviço de licenças **não guarda dados operacionais nem senhas**. Não prometa recuperar dados apagados sem backup.
6. Para senha esquecida em instalação que conserva a base local, use recuperação local ou administrativa; não confunda código de recuperação de senha (15 minutos) com código de ativação (48 horas).

Não use **Liberar novo acesso** para reativar a licença de um cliente existente.


## Login administrativo

A Central não mantém mais o `ADMIN_TOKEN` na interface depois do login.

Fluxo:

1. `GET /admin` sem sessão mostra somente a tela de login.
2. O `ADMIN_TOKEN` é enviado uma única vez para `POST /v1/admin/session`.
3. O Worker cria uma sessão aleatória de 8 horas.
4. O navegador recebe apenas um cookie `__Host-artisys_admin_session` com `HttpOnly`, `Secure` e `SameSite=Strict`.
5. O D1 armazena somente o digest da sessão, nunca o token bruto.
6. `DELETE /v1/admin/session` revoga a sessão no D1 e limpa o cookie.
7. Rotacionar o `ADMIN_TOKEN` invalida a autenticação baseada no valor anterior.

As APIs administrativas de licença exigem uma sessão válida.

## Central

- `GET /admin` — interface da Central.
- `GET /v1/admin/licenses` — lista licenças; exige Bearer `ADMIN_TOKEN`.
- `POST /v1/admin/licenses` — cria/libera uma licença nova. Se o e-mail já tem licença ativa, retorna 409 e não cancela a licença.
- `POST /v1/admin/licenses/:id/activation-code` — **Reativar instalação**: gera outro código de 48 horas para a mesma licença ativa; os códigos pendentes anteriores são invalidados. Exige sessão administrativa.
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

A raiz contém o `wrangler.jsonc` canônico com:

- entrypoint `cloudflare/account/src/worker.mjs`;
- binding D1 `artisys`;
- binding R2 `artisysr2`;
- sem IDs de conta gravados no repositório.

O Cloudflare/Wrangler mantém recursos já vinculados ao Worker pelo binding nas implantações seguintes. O build não chama `d1 list`, não cria recursos e não depende de o token de build possuir permissão de leitura do D1.

O `npm run build` valida a configuração e executa os testes da Central antes de o comando de implantação `npx wrangler deploy` publicar a nova versão.

## Core local

O Cloudflare não é dependência do funcionamento diário do PDV já ativado. Nenhum dado operacional de venda, caixa, clientes, produtos ou senha do Administrador é armazenado nesta Central.
