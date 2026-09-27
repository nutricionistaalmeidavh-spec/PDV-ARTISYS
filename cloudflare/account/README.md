# ArtiSys Account Worker (opcional)

Serviço comercial isolado para ativação de novas instalações do ArtiSys PDV. O PDV continua local/self-hosted por padrão; este Worker só participa do primeiro acesso quando `PDV_REQUIRE_COMMERCIAL_ACTIVATION=true` **e** `PDV_ACCOUNT_ENDPOINT` está configurado.

## Limites de responsabilidade

O Worker recebe somente `installationId`, e-mail e código de ativação. Senhas, hashes de senha, vendas, clientes, produtos, caixa e demais dados operacionais não são enviados ao serviço comercial.

Instalações que já possuem usuário local não exigem ativação comercial, mesmo que o endpoint seja configurado posteriormente. Se o Worker ou a rede ficarem indisponíveis, o login de uma instalação existente continua local.

## Endpoints

- `GET /health`
- `POST /v1/activation/request` — resposta genérica `202` para não revelar se o e-mail possui licença.
- `POST /v1/activation/verify` — valida código de seis dígitos, expirável e de uso único.
- `GET /v1/license/status?installationId=...`

## D1

A migration `migrations/0001_account.sql` cria apenas as tabelas comerciais mínimas: `accounts`, `licenses`, `activation_tokens`, `installations` e `email_delivery_log`.

O pipeline de venda/licenciamento deve provisionar `accounts` e uma `license` com `status='ACTIVE'`. O endpoint de ativação não cria licença automaticamente.

## Deploy

1. Copie `wrangler.toml.example` para `wrangler.toml` e preencha o `database_id` e um remetente de domínio já habilitado no Cloudflare Email Service.
2. Crie/aplique o D1 usando Wrangler e a pasta `migrations`.
3. Configure um segredo forte para o hash dos códigos:

```bash
npx wrangler secret put ACTIVATION_PEPPER
```

4. Faça o deploy do Worker.
5. Na máquina/empacotamento do PDV que realmente deve exigir ativação comercial, configure:

```text
PDV_ACCOUNT_ENDPOINT=https://SEU-WORKER.workers.dev
PDV_REQUIRE_COMMERCIAL_ACTIVATION=true
```

Não grave essas opções em `deployment.json`; elas são deliberadamente opt-in por ambiente/build.

## E-mail

O Worker usa o binding `EMAIL.send({ to, from, subject, text })`. `EMAIL_FROM` deve pertencer a um domínio habilitado para envio na sua conta Cloudflare.

## Testes

Os testes do contrato ficam em `test/cloudflare-account-worker.test.js` e usam um store/e-mail em memória; nenhuma conta Cloudflare é necessária para executar a suíte local/CI.
