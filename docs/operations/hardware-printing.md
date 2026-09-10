# Hardware e impressão

O PDV usa os módulos locais e reutilizáveis `@artisys/serialport` e `@artisys/printing`, fixados no repositório em `vendor/` com origem registrada em `vendor/artisys-modules.lock.json`. O núcleo não depende de SaaS, nuvem ou serviço pago.

## Leitor de código de barras

O modo padrão é **keyboard-wedge**: mantenha o foco no campo de busca do Balcão e configure o leitor para enviar Enter ao final do código quando possível.

## Balança

Configure `PDV_SCALE_PORT` e, quando necessário, `PDV_SCALE_BAUD`, `PDV_SCALE_COMMAND` e `PDV_SCALE_TIMEOUT_MS`. A leitura passa pelo transporte e adapter do `@artisys/serialport`; a UI recebe somente peso normalizado em kg, nunca uma porta serial genérica.

## Gaveta

Para gaveta serial, configure `PDV_DRAWER_PORT` e opcionalmente `PDV_DRAWER_BAUD`. O comando padrão usa o pulso ESC/POS do módulo compartilhado. Abertura por impressora térmica pode ser habilitada com `PDV_PRINTER_OPEN_DRAWER=true` quando o driver suportar.

## Impressão

`PDV_PRINTER_MODE` aceita somente:

- `electron` — padrão, usa a impressão nativa do Electron/Windows;
- `thermal` — usa `node-thermal-printer` local; exige `PDV_PRINTER_TYPE=epson|star` e `PDV_PRINTER_INTERFACE`;
- `serial` — usa o transporte serial local; exige `PDV_PRINTER_PORT` e aceita `PDV_PRINTER_BAUD`.

Opções comuns: `PDV_PRINTER_NAME`, `PDV_PRINT_SILENT`, `PDV_RECEIPT_WIDTH=32|42|48`, `PDV_PRINTER_CUT` e `PDV_PRINTER_TIMEOUT_MS`. Um modo inválido ou incompleto falha explicitamente no startup; não existe fallback silencioso entre drivers, evitando impressão duplicada.

A impressão continua usando a fila persistente do PDV. Vendas geram jobs de comprovante; falhas ficam como `FAILED` e podem voltar à fila por **Tentar novamente**. Reimpressão cria uma nova tentativa auditável sem alterar a venda original.

## Validação em estabelecimento

A CI valida contratos, renderização e limites dos drivers sem fingir presença de equipamento físico. Antes do piloto, valide impressora, gaveta e balança reais em **Configurações**; hardware ausente deve permanecer registrado como dependência externa.
