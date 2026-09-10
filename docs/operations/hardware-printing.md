# Hardware e impressão

Periféricos são tratados pelo processo principal do Electron por adaptadores estreitos; o renderer não recebe filesystem, serial ou driver genérico.

## Leitor de código de barras

O modo padrão é **keyboard-wedge**: mantenha o foco no campo de busca do Balcão e configure o leitor para enviar Enter ao final do código quando possível.

## Balança e gaveta

Balança/gaveta seriais podem usar `PDV_SCALE_PORT`, `PDV_SCALE_BAUD`, `PDV_SCALE_COMMAND`, `PDV_DRAWER_PORT` e `PDV_DRAWER_BAUD`. Confirme o status e execute os testes em **Configurações** antes do piloto. Hardware ausente deve ser registrado como dependência externa, não como teste aprovado.

## Impressão

A impressão usa uma fila persistente. Vendas geram jobs de comprovante; falhas ficam como `FAILED` e podem voltar à fila por **Tentar novamente**. A impressora pode ser escolhida por `PDV_PRINTER_NAME`; `PDV_PRINT_SILENT=true` habilita impressão silenciosa quando suportado pelo driver/Windows.

Reimpressão cria uma nova tentativa auditável sem alterar a venda original.
