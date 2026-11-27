# ArtiSys Oficina — Cloudflare Email Relay

Serviço separado da Central de Licenças e sem credenciais compartilhadas entre contas.

- Conta proprietária: `nutricionistaalmeidavh@gmail.com` (com `artisys.dev` e Email Sending existente).
- Worker: `oficina-password-mailer`.
- Requisições `POST /send` somente com bilhete HMAC curto assinado pela Central da conta `sistema.artisys@gmail.com`.
- Antes do e-mail, chama `POST /v1/password-recovery/relay-authorize`; a Central verifica licença, instalação, assinatura, validade e marca `relayed_at` no D1 por atualização atômica.
- Sem credenciais SMTP/Hostinger, sem dependência para o core gratuito Oficina.
- Para redistribuir: selecionar a conta Cloudflare correta e executar `wrangler deploy -c cloudflare/oficina-password-mailer/wrangler.jsonc`. O serviço foi originalmente provisionado via Cloudflare MCP.
- O domínio `artisys.dev` precisa continuar autorizado para envio pelo serviço existente.

Não exponha o e-mail do cliente nem o código nos logs.

## Deploy automático

O workflow `.github/workflows/deploy-oficina-mailer.yml` publica este Worker a cada merge na `main` que mexa nesta pasta (ou manualmente em Actions > Run workflow). Ele precisa de dois segredos do repositório, da conta Cloudflare dona do `artisys.dev`:

- `CLOUDFLARE_MAILER_API_TOKEN`: token de API com permissão **Account > Workers Scripts > Edit**.
- `CLOUDFLARE_MAILER_ACCOUNT_ID`: ID dessa conta.

Sem os segredos, o workflow só roda os testes e avisa que pulou o deploy. Os segredos já gravados no Worker (como a chave do relay) são mantidos pelo `wrangler deploy`.
