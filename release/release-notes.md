# ArtiSys PDV 1.3.1 — Hardware Simulation QA

Patch local-first que reforça a E54 sem exigir compra prévia de periféricos. A versão 1.3.1 adiciona uma suíte automatizada de simulação para elevar a confiança em impressoras, balanças, gavetas e leitores antes do primeiro teste físico em cliente.

## E54.1 — Hardware Simulation QA

- transporte serial entra em estado de erro em falha de escrita/dreno e consegue reconstruir a porta em tentativa posterior;
- porta COM ocupada ou inexistente falha de forma controlada e pode ser reaberta quando o ambiente volta ao normal;
- respostas de balança fragmentadas aguardam uma pequena janela de silêncio antes de serem interpretadas;
- balança cobre ponto/vírgula decimal, resposta inválida, timeout e nova tentativa;
- drivers térmicos Epson/Star são simulados com acentos, corte, pulso de gaveta e larguras 32/42/48;
- impressão Electron/Windows cobre spooler offline seguido de recuperação;
- leitor de código no modo `keyboard-wedge` passa por leituras repetidas e entradas inválidas;
- transporte serial passa por ciclos repetidos de abrir/escrever/fechar para detectar porta presa;
- a matriz de compatibilidade passa a separar `PROTOCOL_VERIFIED`, `FIELD_VERIFIED` e `UNTESTED_MODEL`.

## Significado comercial da compatibilidade

`PROTOCOL_VERIFIED` significa que a família de integração foi validada automaticamente no software. Não significa que todos os modelos físicos que usam esse protocolo foram testados.

`FIELD_VERIFIED` é reservado para fabricante/modelo realmente testado em equipamento físico, com evidência registrada. Um modelo ainda não testado usa `UNTESTED_MODEL`, mesmo quando o protocolo correspondente já está `PROTOCOL_VERIFIED`.

Isso permite vender com uma afirmação tecnicamente correta, por exemplo: **compatível por protocolo com impressão Epson/Star/Windows e periféricos seriais suportados; modelos específicos podem exigir configuração de driver, porta, baud rate ou comando.**

## Arquitetura e regras preservadas

O sistema continua **local-first**: SQLite autoritativo no servidor local, terminais/dispositivos pela API LAN, EventBus/outbox para efeitos derivados e `SaleService` como único motor canônico de vendas.

Os fluxos comerciais usam **pagamentos manuais** e documentos explicitamente **NÃO FISCAL**. Não há TEF, gateway bancário, confirmação automática de PIX, SaaS ou internet obrigatória para a operação diária.

A interface mobile continua self-hosted em `http://IP-DO-SERVIDOR:4174/mobile`, destinada somente à LAN confiável; a versão 1.3.1 não declara HTTPS nem PWA instalável.

O schema avança de **v8 para v9** apenas para migrar a classificação de evidências de hardware. A migração é aditiva/preservadora: `VERIFIED` legado vira `FIELD_VERIFIED` e `BLOCKED_EXTERNAL` legado vira `UNTESTED_MODEL`, mantendo os demais dados e evidências.
