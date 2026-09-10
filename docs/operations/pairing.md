# Pareamento de terminais

O servidor autoriza cada terminal de rede individualmente. A credencial do usuário e a credencial do terminal são controles distintos.

## Fluxo

1. Um administrador autenticado gera um código temporário em **Configurações > Rede e terminais**.
2. O código expira e só pode ser usado uma vez.
3. O terminal envia código, `terminalId`, nome, fingerprint da instalação e versão do app.
4. O servidor registra o terminal e entrega uma credencial específica.
5. Nas conexões seguintes, o terminal apresenta sua identidade/credencial e depois o usuário faz login.
6. O servidor valida versão mínima, status `ACTIVE|BLOCKED` e sessão do usuário.

## Bloqueio

Um administrador pode marcar um terminal como `BLOCKED`. O bloqueio invalida novos acessos operacionais daquele terminal sem apagar histórico de vendas, caixa ou auditoria. Para substituir uma máquina, cadastre uma nova identidade em vez de reutilizar fingerprints.
