# Fiscal — NFC-e/NF-e

A camada fiscal é desacoplada do checkout. A venda é concluída no domínio e a emissão fiscal ocorre por efeito durável/idempotente, permitindo retry sem duplicar o documento.

## Configuração

Em **Configurações > Fiscal**, escolha homologação ou produção, tipo de documento e configure a conexão com o provedor suportado. Credenciais fiscais ficam fora do renderer e são protegidas pelo armazenamento seguro do sistema operacional.

Teste primeiro em homologação. Somente mude para produção depois de validar dados da empresa, credenciais, série/numeração e requisitos fiscais do cliente.

## Falhas e contingência operacional

Falha de rede/provedor não deve apagar a venda. O documento permanece pendente/falho para diagnóstico e nova tentativa conforme o status persistido. Nunca marque emissão como aprovada sem resposta válida do provedor.

A emissão real depende de credenciais/configuração válidas do estabelecimento e conectividade externa com o serviço fiscal; ausência dessas dependências deve permanecer `BLOCKED_EXTERNAL` no checklist do piloto.
