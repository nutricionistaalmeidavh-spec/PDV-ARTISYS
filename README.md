# PDV ArtiSys

Novo PDV desktop da ArtiSys, projetado para operação local e em rede LAN, sem dependência de SaaS/web para funcionamento do cliente.

## Infraestrutura já incorporada

- Domain Event Bus desacoplado da UI
- Dispatcher compatível com outbox persistente
- Efeitos idempotentes por `eventId + effectKey`
- Catálogo canônico inicial de eventos do PDV
- Testes de contrato com `node:test`

Documentação: `docs/architecture/event-bus.md`.
