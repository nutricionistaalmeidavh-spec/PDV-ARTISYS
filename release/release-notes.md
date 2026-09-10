# ArtiSys PDV 1.1.1 — Hardware reutilizável

Patch de integração da linha 1.1 que substitui implementações locais duplicadas de comunicação serial e impressão por módulos ArtiSys reutilizáveis, mantendo o PDV local-first e sem serviço pago obrigatório.

## Entregas

- `@artisys/serialport` 0.1.0 fixado localmente para balança, gaveta e impressora serial;
- `@artisys/printing` 0.1.0 fixado localmente para renderer de recibo, impressão Electron, térmica Epson/Star e transporte serial;
- `PDV_PRINTER_MODE=electron|thermal|serial` com configuração explícita e sem fallback silencioso;
- renderer de cupom de venda reaproveitando o módulo compartilhado;
- provenance lock em `vendor/artisys-modules.lock.json` apontando para o commit central do repositório `utilidades`;
- CI passa a instalar as dependências reais antes dos gates de verificação;
- fila persistente, retry, reimpressão, EventBus, SQLite e operação de restaurante permanecem inalterados.

## Custo e operação

O núcleo continua R$ 0 para software de infraestrutura: execução self-hosted/local, bibliotecas open source e nenhuma dependência de SaaS. Hardware físico, drivers do fabricante e emissão fiscal externa continuam dependências opcionais do estabelecimento.
