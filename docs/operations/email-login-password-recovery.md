# Login por nome de usuário ou e-mail e recuperação de senha (desktop)

## Garantias do core
- Login e senha continuam verificados **localmente**, pelo SQLite; internet, D1 e envio de e-mail não são necessários para operar.
- O campo **Usuário ou e-mail** aceita o `username` antigo ou um endereço já cadastrado no **mesmo usuário local**.
- O e-mail é normalizado e único na instalação. Tentativa ambígua entre nome de usuário e e-mail de pessoas diferentes é rejeitada.
- A recuperação local por chave continua disponível sem internet.
- Alterações de identidade e senha não recriam usuário, não substituem SQLite, não apagam estoque, vendas ou comandas.
- Não existe senha mestra nem envio de senha ao D1.

## Primeiro acesso: vínculo seguro no D1
Após conferir o código de ativação, a Central gera um segredo aleatório de 256 bits.
O Worker armazena só o SHA-256 do segredo na instalação, e o backend desktop
guarda o segredo no banco local (`installation_activation.identity_sync_secret`).
A resposta local de `/api/v1/setup/status` não expõe esse segredo ao renderer.

Quando o administrador é criado, a instalação associa `owner_user_id`, o e-mail
da licença e o nome de login local. A sincronização para a Central
`POST /v1/identity/sync` usa o segredo, exige licença ativa e nunca bloqueia
a operação do PDV quando indisponível.

O painel administrativo de licenças exibe o usuário e o ID local vinculados;
apenas o administrador da Central tem acesso a essa lista.

**Instalações anteriores** não possuem segredo de sincronização e não devem
ser vinculadas por instalaçãoId isolado, porque esse identificador não é
credencial. Ao validar um código de recuperação emitido pelo administrador,
o Worker também pode registrar com segurança o ID e login locais. Nunca
reative uma licença ou reconfigure a loja só para sincronizar uma identidade.

## Recuperação de senha sem perda de dados
1. Na tela de login, clique em **Esqueci minha senha**.
2. Utilize a chave local que foi salva no primeiro acesso, ou selecione
   **Recuperação comercial por e-mail** e informe o e-mail da licença.
3. Com envio configurado, o Worker encaminha código de 6 dígitos ao e-mail;
   o código vence em 15 minutos, é de uso único e limita tentativas.
4. Sem envio configurado, o código continua sendo gerado pelo painel
   administrativo da Central na ação **Recuperação**, e o suporte o fornece
   ao titular após confirmar a identidade.
5. Informe o código na instalação original e crie uma senha nova.
   Sessões anteriores do usuário são revogadas.

O Worker nunca recebe a nova senha. O e-mail de recuperação também não
contém senha nem o ID local. A resposta pública à solicitação não revela
se a instalação ou o e-mail são válidos.

## Transporte de e-mail opcional (self-hosted / código aberto)
O D1 **não envia e-mails por conta própria**. Sem depender de plataforma paga,
um serviço próprio pode disponibilizar um endpoint de envio por HTTPS.

Configurar no Worker:
- `EMAIL_DELIVERY_URL`: URL HTTPS do bridge privado com rota de envio.
- `EMAIL_DELIVERY_TOKEN`: token Bearer do bridge; configurar como secret.
- `RECOVERY_PEPPER`: segredo independente para armazenar apenas digest dos códigos.

Contrato de `POST EMAIL_DELIVERY_URL`:
- Header `Authorization: Bearer <token>`
- JSON: `{"to":"cliente@dominio.com","subject":"...","text":"..."}`
- Responder HTTP 2xx somente quando o bridge aceitar a mensagem.
- Validar o Bearer em tempo constante, restringir origens e destinatários,
  não registrar o token nem o conteúdo do e-mail em logs.
- É possível usar um servidor SMTP próprio com um bridge open source,
  desde que este servidor seja configurado pelo operador, não pelo PDV.

No core, serviço pago não é obrigatório nem instalado implicitamente.
Se o bridge falhar, o atendimento manual continua disponível.

## Homologação antes de publicar
- `node --test test/account-user-identity.test.js test/password-recovery-api.test.js test/cloudflare-account-worker.test.js`
- `npm run verify`
- Testar localmente recuperação por chave e por código; código errado, expirado,
  reutilizado e excesso de tentativas; senha antiga e sessões antigas.
- Testar ativação de nova instalação e migração de uma instalação existente,
  inclusive quando o serviço de conta está offline.
- Verificar entrega real do e-mail na caixa de testes. Teste com stub não
  comprova recebimento real nem autorização do remetente.
