# Central de Licenças ArtiSys

Worker comercial do **PDV ArtiSys** na conta Cloudflare `sistema-artisys`.

Este serviço é separado do core local do PDV. O PDV continua local/self-hosted; a nuvem participa somente da liberação inicial, consulta de status da licença e recuperação administrativa.

## Produtos na mesma Central

A Central permite selecionar **PDV ArtiSys** (`PDV`), **ArtiSys Oficina** (`OFICINA`), **ArtiSys Almoxarifado** (`ALMOXARIFADO`) e **ArtiSys CRM WhatsApp Prospector** (`WPPPROSPECTOR`) no mesmo painel. Licenças antigas são migradas com produto padrão
`PDV`. O mesmo e-mail pode ter uma licença ativa por produto; códigos, suspensão,
reativação e expiração são independentes. Para compatibilidade, APIs legadas sem
campo `product` continuam usando `PDV`. O Oficina envia `product: 'OFICINA'` e o Almoxarifado envia `product: 'ALMOXARIFADO'` na ativação, com o mesmo escopo na consulta; nunca compartilhar ativação entre produtos.

**Operação:** aplicar a migração aditiva e validar com dados anonimizados do D1
antes do deploy da Central. O Worker `pdv-artisys` pertence à conta
`sistema-artisys`; não publicar alterações por outra conta Cloudflare.

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

## Licenças vitalícias e computadores do CRM

A Central usa a mesma autenticação administrativa, banco D1 e emissão de códigos para os três produtos. Selecione **ArtiSys CRM WhatsApp Prospector**, indique o e-mail e mantenha a validade em branco para licença vitalícia (sem data de expiração). Escolha o limite de **1 a 20 computadores**, com padrão **3**. O código de ativação de **6 dígitos** permanece válido por **48 horas** e é de uso único; isso não limita a licença vitalícia.

Uma licença CRM tem slots por instalação, e o limite é aplicado no servidor por instrução SQL atômica. O administrador pode **Alterar limite** (não abaixo do número já ativado), **Desativar PC** para liberar uma vaga ou **Reativar instalação** para emitir outro código. Desativar um PC faz a próxima consulta online dele negar acesso; uma instalação que está offline pode continuar usando a última ativação local válida até reconectar, portanto a revogação offline não é instantânea.

O PDV e a Oficina **não recebem limite de computadores novo** nesta mudança; continuam com a política anterior. Uma licença de produto não ativa outro produto. A Central armazena apenas licença, e-mail normalizado e identidade de instalação: **nunca** armazena leads, conversas ou o banco de dados operacional do CRM. O compartilhamento de dados entre vários PCs é um problema distinto da licença e requer implantação de CRM em servidor de rede; ativar o mesmo software em vários PCs não sincroniza SQLite automaticamente.

**Segurança:** a ativação inicial requer HTTPS; somente uma instalação previamente ativada pode continuar offline. O cliente Windows armazena o comprovante de ativação usando a proteção do sistema operacional (Electron safeStorage/DPAPI). Não publicar nenhuma chave privada nem tokens administrativos no instalador. A adição de campo max_devices à tabela licenses no D1 é aditiva e preserva os registros existentes.

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


## Recuperação automática do Oficina pela Hostinger (opcional)

O **core open source/local** permanece independente de nuvem e e-mail. Apenas a edição comercial do Oficina, após ativação da licença, pode solicitar a recuperação de senha pela Central.

O Worker Cloudflare `pdv-artisys` fica na conta **Sistema.artisys@gmail.com's Account**; o domínio e a caixa de e-mail podem estar associados a outra conta Cloudflare. **Não é necessária uma ponte entre as contas Cloudflare**: o Worker se conecta diretamente ao servidor SMTP da Hostinger (`smtp.hostinger.com`, porta 465, TLS).

A caixa existente é `contato@artisys.dev`. Não configurar `send_email` ou Cloudflare Email Sending para este fluxo; não usar o token de sessão do conector Hostinger Mail do ChatGPT em produção.

Na conta Cloudflare do Worker, configure explicitamente **somente na edição comercial**:
- Secret `SMTP_PASSWORD`: senha SMTP válida da caixa `contato@artisys.dev`. Necessária para envio automático; não incluir no código, no GitHub, no instalador, em comentários ou testes.
- Variável opcional `SMTP_USERNAME`: padrão `contato@artisys.dev`.

O pedido `POST /v1/password-recovery/request` valida e-mail, instalação e licença `OFICINA` ativa. O código é enviado exclusivamente ao e-mail vinculado, tem seis dígitos, expira em 15 minutos, possui limitação de reenvio e é de uso único. O `POST /v1/password-recovery/verify` consome o código; a senha nova não vai ao Cloudflare, pois é definida no PostgreSQL local e as sessões anteriores são invalidadas. Não há acesso ao banco operacional do cliente.

**Antes da release:** o envio SMTP real precisa de um segredo configurado; o conector Hostinger Mail disponível dentro do ChatGPT não revela a senha da caixa ao Worker. Sem `SMTP_PASSWORD`, o Worker retorna 503 em vez de fingir que enviou um código. A recuperação assistida pelo administrador da Central continua separada.

As verificações de GitHub Actions não dependem de Cloudflare Workers previews. Os previews não substituem teste de recebimento real de e-mail com a credencial do Worker.

## Boas-vindas do Almoxarifado

Ao liberar **ArtiSys Almoxarifado** (`ALMOXARIFADO`) pelo painel, a Central
mantém o código de seis dígitos e solicita ao relay de e-mail transacional o
envio para o endereço licenciado. O e-mail contém:

- o código de ativação e a data de expiração (48 horas, uso único);
- o download oficial **da edição comercial Windows**, sem apontar para o instalador livre;
- o link do **manual do usuário em PDF**;
- os primeiros passos para ativação e criação de senha local.

Os links públicos estáveis são:

- `GET /download/almoxarifado`: redireciona ao arquivo
  `ArtiSys-Almoxarifado-Setup-<versão>-Commercial.exe` da release pública mais recente;
- `GET /manual/almoxarifado.pdf`: redireciona ao
  `Manual-ArtiSys-Almoxarifado.pdf` da mesma release.

Caso o artefato ainda não esteja publicado, as rotas retornam HTTP 503 sem
trocar silenciosamente para a edição livre. Nunca enviar o artefato interno de
QA do GitHub Actions como se fosse download público.

O ticket de autorização de e-mail do Almoxarifado é **assinado e limitado ao
produto**, e a Central verifica o código não utilizado, a licença ativa, o
e-mail e a expiração antes de permitir o envio uma única vez. O fluxo anterior
da Loja Roupas conserva sua assinatura/compatibilidade original. A resposta
administrativa mostra `delivery.status = 'sent' | 'failed'`: falha de envio
não deve ser comunicada como sucesso ao cliente. A ação **Reativar instalação**
emite novo código e reenvia as instruções, sem cancelar a licença original.

A infraestrutura de e-mail e a Central pertencem somente à distribuição
comercial opcional. O core livre do Almoxarifado segue R$ 0 / self-hosted
e não depende de e-mail, Worker ou nuvem para funcionar.

## Boas-vindas da Loja de Roupas

Ao liberar **Loja Roupas** (`LOJA_ROUPAS`) no painel, a Central gera o código de seis dígitos e pede ao relay `oficina-mail.artisys.dev/welcome` o envio para o e-mail licenciado, com:

- código de ativação e validade (48 horas, uso único);
- download direto da **edição comercial** Windows: `GET /download/loja-roupas`;
- manual em PDF: `GET /manual/loja-roupas.pdf`;
- link dos termos de uso e da política de privacidade.

As duas rotas consultam as releases do repositório `loja-roupas` e redirecionam somente para a release `loja-comercial-vX.Y.Z` mais nova (não rascunho) que tenha `Loja-de-Roupas-Comercial-Setup-x64.exe` e `Manual-Loja-de-Roupas.pdf`. As releases `loja-fisica-v*` e `v*` (edições livres) nunca são usadas; sem release comercial a rota responde 503.

O texto do e-mail fica no Worker `oficina-password-mailer`, que é implantado separadamente na conta dona de `artisys.dev` (`wrangler deploy -c cloudflare/oficina-password-mailer/wrangler.jsonc`).
