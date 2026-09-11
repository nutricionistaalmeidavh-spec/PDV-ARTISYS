# ArtiSys PDV 1.2.0 — Módulos opcionais

Release local-first que amplia o mesmo núcleo do ArtiSys PDV com catálogo configurável e verticais opcionais, sem transformar nichos em produtos separados.

## Entregas E40–E47

- **E40 — Catálogo avançado:** adicionais, opções, variações, combos e snapshot imutável das escolhas no item vendido;
- **E41 — Ficha técnica:** receitas versionadas e baixa idempotente de ingredientes/insumos pelo ledger existente;
- **E42 — Módulos opcionais:** ativação local, auditada e com dependências validadas;
- **E43 — Pizzaria:** tamanho, múltiplos sabores/meio a meio, borda, adicionais e políticas configuráveis de preço;
- **E44 — Restaurante avançado:** divisão de conta, pagamento parcial, taxa de serviço, transferência seletiva, junção de comandas e cancelamento autorizado;
- **E45 — Delivery:** entrega/retirada, endereço, região, taxa, entregador, ETA e status operacional;
- **E46 — Fast-food/Lanchonete:** senha diária e fila de preparação/pronto/entregue;
- **E47 — Mercado/Padaria:** itens por peso, formato de etiqueta configurável e encomendas para retirada;
- KDS, pré-conta e cupom preservam as configurações relevantes dos itens, incluindo tamanho, sabores, borda e adicionais;
- interface desktop exibe somente os módulos opcionais habilitados para o estabelecimento.

## Arquitetura e operação

O sistema continua **local-first**: SQLite autoritativo no servidor local, terminais/dispositivos pela API LAN, EventBus/outbox para efeitos derivados e `SaleService` como único motor canônico de vendas.

Os fluxos E40–E47 usam **pagamentos manuais** e documentos comerciais explicitamente **NÃO FISCAL**. Não há TEF, gateway bancário, confirmação automática de PIX, SaaS ou internet obrigatória para a operação diária.

O schema desta release é v7 e as migrações são aditivas, preservando os dados existentes.
