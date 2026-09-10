# Instalação — Terminal de rede

O perfil **terminal** executa somente a interface e os adaptadores locais de hardware. Ele não cria nem abre SQLite; todas as operações compartilhadas usam a API do servidor autoritativo na LAN.

## Configuração

1. Instale o mesmo pacote Windows x64.
2. Defina `PDV_DEPLOYMENT_PROFILE=terminal`.
3. Informe `PDV_SERVER_URL`, por exemplo `http://192.168.1.10:4174`.
4. Defina `PDV_TERMINAL_ID` e um nome amigável.
5. No servidor, gere um código temporário de pareamento e conclua o pareamento desse terminal.
6. Configure a credencial específica do terminal no ambiente/configuração protegida usada pela instalação.
7. Abra o aplicativo, valide o handshake e faça login com o usuário do caixa.

Se o servidor ficar indisponível, o terminal não confirma vendas, caixa ou outras mutações compartilhadas. A versão 1.0 não mantém uma fila offline de vendas no terminal.
