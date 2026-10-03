# ArtiSys Account Worker (opcional)

Serviço comercial isolado para ativação de novas instalações do ArtiSys PDV. O PDV continua local/self-hosted por padrão; este Worker só participa do primeiro acesso quando `PDV_REQUIRE_COMMERCIAL_ACTIVATION=true` e `PDV_ACCOUNT_ENDPOINT` está configurado.

## Fluxo de licença

1. Acesse `/admin` no Worker e informe o `ADMIN_TOKEN`.
2. Informe o e-mail do cliente e, opcionalmente, a validade da licença.
3. Clique em **Liberar**. O painel cria a conta/licença `ACTIVE` e mostra um código de ativação de seis dígitos.
4. No primeiro acesso ao PDV, o cliente informa e-mail + código.
5. O código é consumido, a licença é vinculada ao `installationId` e o cliente define a senha do administrador.
6. A senha e seu hash permanecem somente no banco local do PDV.

O código de ativação administrativo é de uso único, expira em 30 minutos e é bloqueado após cinco tentativas inválidas.

## Recuperação de senha

Para uma instalação já ativada, o painel permite gerar um código de recuperação com validade de 15 minutos e no máximo cinco tentativas inválidas. O código fica vinculado ao e-mail e ao `installationId`; ele não funciona em outro computador. Depois da validação, o PDV grava apenas o novo hash local e revoga as sessões locais anteriores.

O serviço comercial não recebe senha nem hash de senha.

## Endpoints

- `GET /health`
- `GET /admin` — painel administrativo.
- `GET /v1/admin/licenses` — lista licenças; exige Bearer `ADMIN_TOKEN`.
- `POST /v1/admin/licenses` — libera licença e devolve o código; exige Bearer `ADMIN_TOKEN`.
- `PATCH /v1/admin/licenses/:id` — altera status da licença; exige Bearer `ADMIN_TOKEN`.
- `POST /v1/admin/recovery` — gera código de recuperação para instalação ativa; exige Bearer `ADMIN_TOKEN`.
- `POST /v1/activation/verify` — valida e consome o código de ativação.
- `POST /v1/password-recovery/request` — valida silenciosamente o contexto e orienta a solicitar o código ao administrador.
- `POST /v1/password-recovery/verify` — valida código de recuperação vinculado à instalação.
- `GET /v1/license/status?installationId=...` — retorna somente `active`; e-mail, licença e data de ativação não são expostos.

## D1

Aplique todas as migrations em `migrations/`. A `0003_manual_license_panel.sql` adiciona o vínculo de recuperação ao `installation_id`.

O painel passa a provisionar `accounts` e `licenses`; não é mais necessário inserir a licença manualmente no D1.

## Deploy

1. Copie `wrangler.toml.example` para `wrangler.toml` e preencha o `database_id`.
2. Crie/aplique o D1 usando Wrangler e a pasta `migrations`.
3. Configure segredos fortes e independentes:

```bash
npx wrangler secret put ACTIVATION_PEPPER
npx wrangler secret put RECOVERY_PEPPER
npx wrangler secret put ADMIN_TOKEN
```

4. Faça o deploy do Worker.
5. No PDV que deve exigir ativação comercial, configure:

```text
PDV_ACCOUNT_ENDPOINT=https://SEU-WORKER.workers.dev
PDV_REQUIRE_COMMERCIAL_ACTIVATION=true
```

Não grave essas opções em `deployment.json`; elas são opt-in por ambiente/build.

## Testes

Os testes do contrato ficam em `test/cloudflare-account-worker.test.js` e usam store em memória; nenhum serviço de envio de e-mail é necessário.
