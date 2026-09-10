# Atualização do ArtiSys PDV

A atualização do executável é separada dos dados do cliente. Banco, backups e configuração ficam no diretório de dados do usuário e não são substituídos pelo instalador.

## Procedimento

1. Encerre vendas e feche o caixa quando operacionalmente possível.
2. Crie e valide um backup manual.
3. Feche o ArtiSys PDV em servidor e terminais.
4. Instale a nova versão Windows sobre a instalação existente.
5. Inicie primeiro a máquina **Servidor + Terminal**. As migrations incrementais e não destrutivas são aplicadas automaticamente.
6. Confira health/schema, abra o sistema e execute um smoke de login, consulta de produtos e venda controlada.
7. Atualize os terminais clientes para versão compatível e valide o handshake LAN.

## Rollback

Se a nova versão não puder operar, preserve os arquivos atuais, reinstale a versão anterior compatível e restaure o último backup validado somente quando necessário. Nunca apague/reset o banco apenas porque a versão do aplicativo mudou.
