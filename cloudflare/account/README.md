# Central de Licenças do PDV ArtiSys

Worker comercial isolado do **PDV ArtiSys** para liberar novas instalações. Ele pertence a este repositório e ao Worker `pdv-artisys`.

O PDV continua local-first. Venda, estoque, caixa, usuários, senhas e dados operacionais não dependem do Cloudflare para funcionar depois da ativação.

## Fluxo de liberação

1. Abra `/admin` no Worker `pdv-artisys`.
2. Informe o `ADMIN_TOKEN`.
3. Digite o e-mail do cliente e, se quiser, a validade da licença.
4. Clique em **Gerar código**.
5. A Central mostra um código de seis dígitos.
6. **Você copia e envia esse código ao cliente.**
7. No primeiro acesso ao PDV, o cliente informa o mesmo e-mail e o código.
8. O código é consumido e a licença fica vinculada ao `installationId` daquele PDV.
9. Depois disso o cliente cria a senha do Administrador local.

Não há envio automático de e-mail neste fluxo.

O código de ativação é de uso único, expira em 30 minutos e é bloqueado após cinco tentativas inválidas.

## Central administrativa

- `GET /admin` — interface da Central.
- `GET /v1/admin/licenses` — lista licenças.
- `POST /v1/admin/licenses` — cria/libera licença e devolve o código.
- `PATCH /v1/admin/licenses/:id` — altera status.
- `POST /v1/admin/recovery` — gera código manual de recuperação.

As rotas `/v1/admin/*` exigem `Authorization: Bearer <ADMIN_TOKEN>`.

## Endpoints usados pelo PDV

- `POST /v1/activation/request` — apenas orienta que o código é fornecido pela ArtiSys; não envia mensagem.
- `POST /v1/activation/verify` — valida e consome e-mail + código.
- `GET /v1/license/status?installationId=...` — informa se a instalação continua ativa.
- `POST /v1/password-recovery/request` — inicia o fluxo manual.
- `POST /v1/password-recovery/verify` — valida o código manual de recuperação.

Senha e hash de senha nunca são enviados ao Worker.

## Recursos Cloudflare deste sistema

O deploy deste repositório preserva os recursos já associados ao Worker:

- Worker: `pdv-artisys`;
- D1 binding: `artisys`;
- R2 binding: `artisysr2`;
- bucket R2: `artisyspdv`.

O Worker aceita o binding D1 `artisys` mostrado no painel atual. O alias legado `DB` continua aceito para desenvolvimento/testes.

A Central inicializa de forma idempotente as tabelas que precisa no D1 dedicado. Não existe `DROP TABLE`, limpeza de banco ou criação automática de outro D1.

## Segredos de runtime

Configure no Worker, em **Settings > Variables and Secrets**, como **Secret**:

- `ADMIN_TOKEN` — senha/token forte usado para entrar na Central;
- `ACTIVATION_PEPPER` — segredo forte para hash dos códigos de ativação;
- `RECOVERY_PEPPER` — segredo independente para códigos de recuperação.

Não coloque esses valores no Git.

## Build conectado ao GitHub

O painel atual executa `npm run build` na raiz. Este repositório passa a usar esse comando somente para o Worker comercial:

1. executa os testes da Central;
2. quando detecta Workers Builds (`WORKERS_CI=1`), localiza o D1 **existente** chamado `artisys`;
3. gera temporariamente `wrangler.jsonc` apontando para `pdv-artisys`;
4. preserva o D1 `artisys`, o R2 `artisysr2 -> artisyspdv` e variáveis do dashboard;
5. o comando já configurado no Cloudflare, `npx wrangler deploy`, publica o Worker.

O script **nunca executa `wrangler d1 create`**. Se não localizar exatamente o D1 existente, o build falha em vez de criar outro banco.

Para contas em que o build token não puder listar D1, defina a variável de build `ARTISYS_D1_DATABASE_ID` com o ID do banco existente.

## Testes

```bash
npm run test:cloudflare:account
npm run build
```

O empacotamento do PDV Windows continua separado em `npm run dist:win`.
