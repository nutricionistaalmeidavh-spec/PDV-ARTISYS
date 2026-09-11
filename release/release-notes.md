# ArtiSys PDV 1.3.0 — Módulos opcionais finais

Release local-first que conclui as entregas E48–E54 sobre o mesmo núcleo do ArtiSys PDV, mantendo um único motor canônico de vendas e módulos por segmento ativados somente quando o estabelecimento precisar.

## Entregas E48–E54

- **E48 — Varejo:** variantes por produto com SKU/código de barras, atributos e estoque por variante, mantendo a venda no `SaleService` canônico;
- **E49 — Serviços:** catálogo de serviços, profissionais, agenda local, bloqueio de conflito de horários e comissão;
- **E50 — Oficina:** veículos/equipamentos, ordem de serviço, peças, mão de obra, diagnóstico, orçamento, aprovação e fechamento em venda canônica;
- **E51 — Autoatendimento:** dispositivo pareado para pedido local, com operação de mesa ou retirada e pagamento manual no caixa;
- **E52 — Configuração inicial:** seleção de segmento, recomendação editável de módulos e persistência local;
- **E53 — Acesso mobile:** geração local de material QR para `http://IP-DO-SERVIDOR:4174/mobile`, destinado somente a LAN confiável;
- **E54 — Homologação de periféricos:** matriz/versionamento de evidências; modelo físico sem teste documentado permanece `BLOCKED_EXTERNAL`.

As entregas anteriores E40–E47 continuam presentes: catálogo configurável, ficha técnica, registro de módulos opcionais, Pizzaria, Restaurante avançado, Delivery, Fast-food e Mercado/Padaria.

## Arquitetura e operação

O sistema continua **local-first**: SQLite autoritativo no servidor local, terminais/dispositivos pela API LAN, EventBus/outbox para efeitos derivados e `SaleService` como único motor canônico de vendas.

Os fluxos E40–E54 usam **pagamentos manuais** e documentos comerciais explicitamente **NÃO FISCAL**. Não há TEF, gateway bancário, confirmação automática de PIX, SaaS ou internet obrigatória para a operação diária.

A interface mobile continua self-hosted na LAN. O QR facilita o acesso ao endereço local, mas a versão 1.3.0 **não declara PWA instalável nem HTTPS**.

O schema desta release é **v8** e as migrações são incrementais/aditivas, preservando dados existentes.
