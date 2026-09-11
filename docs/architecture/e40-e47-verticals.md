# E40–E47 — Catálogo avançado e módulos verticais

## Princípio arquitetural

E40–E47 ampliam o mesmo núcleo local-first do ArtiSys PDV. Nenhum módulo cria outro motor de venda, caixa, estoque ou banco de dados.

```text
Desktop / dispositivos LAN
          ↓ API local
Servidor local autoritativo
          ↓
Catálogo / módulos verticais
          ↓
SaleService canônico + EventBus/Outbox
          ↓
SQLite local / estoque / caixa / impressão não fiscal
```

- SQLite é autoritativo somente no servidor local.
- Clientes desktop/LAN não acessam SQLite diretamente.
- Internet não é necessária para a operação diária.
- Pagamentos dos novos fluxos são registros manuais; não há TEF, gateway ou API bancária embutida.
- Documentos operacionais/comerciais dos fluxos E40–E47 são **NÃO FISCAL**.
- A camada fiscal legada continua isolada e não é dependência dos módulos E40–E47.

## Schema

O schema operacional atual desses módulos é **v7**, aplicado por migrações aditivas e não destrutivas. Dados anteriores de vendas, restaurante e estoque são preservados.

## E40 — Catálogo configurável

O catálogo suporta grupos de opções, adicionais, variantes e grupos de combo. O preço final é calculado em centavos inteiros e a seleção usada na venda é salva como snapshot imutável no item.

## E41 — Ficha técnica

Produtos compostos podem ter receita/ficha técnica. Na conclusão da venda, o efeito de estoque expande o item em insumos e grava movimentos pelo mecanismo idempotente existente. Reprocessar o mesmo evento não duplica baixa de estoque.

## E42 — Módulos opcionais

A ativação é persistida em `app_settings`, auditada e validada pelo backend. Dependências são explícitas. Desativar um módulo não apaga histórico.

Módulos verticais implementados neste bloco:

- `RESTAURANT`
- `PIZZERIA`
- `DELIVERY`
- `FAST_FOOD`
- `MARKET_BAKERY`

A UI só oferece os workspaces ativados; campos de pizzaria, por exemplo, não aparecem para estabelecimentos que não usam esse módulo.

## E43 — Pizzaria

Suporta tamanho, limite de sabores, múltiplos sabores/meio a meio, borda, adicionais e políticas `HIGHEST_FLAVOR` e `PROPORTIONAL_AVERAGE`. A configuração acompanha o pedido até o KDS, pré-conta e venda canônica.

## E44 — Restaurante avançado

Amplia mesas/comandas existentes com divisão parcial por itens, taxa de serviço, transferência seletiva, junção de comandas e cancelamento autorizado com motivo. Cada parcela liquidada continua sendo venda criada pelo `SaleService`.

## E45 — Delivery

Suporta entrega ou retirada, snapshot de cliente/endereço, região, taxa, entregador, ETA manual, observação e forma de pagamento manual. Quando convertido em venda, reutiliza o `SaleService`; a taxa de entrega é registrada como item sistêmico sem estoque.

## E46 — Fast-food / Lanchonete

Mantém senha diária sequencial e fila `NEW → PREPARING → READY → DELIVERED`. O painel de prontos expõe somente número/status. Customizações e combos continuam usando E40.

## E47 — Mercado / Conveniência / Padaria

Venda por peso usa gramas como unidade base para cálculo monetário. Entrada manual é sempre possível; leitura de balança é opcional. Etiquetas de peso só são interpretadas quando existe perfil de formato explicitamente configurado — não há tentativa heurística de adivinhar layouts.

Encomendas de padaria mantêm cliente, horário solicitado, itens e ciclo `OPEN | READY | PICKED_UP | CANCELLED`.

## Contrato de etiqueta por peso

Cada perfil define explicitamente:

- prefixo;
- comprimento total;
- posição/comprimento do código do produto;
- posição/comprimento do campo de peso;
- casas decimais.

Um código que não corresponda ao perfil configurado deve ser rejeitado.

## Impressão e fiscal

Pré-conta, ticket de produção/cozinha e documentos operacionais permanecem não fiscais. Configurações de item relevantes à produção — como tamanho, frações de sabores, borda e adicionais — são preservadas no KDS e na impressão.

E40–E47 não chamam emissão NFC-e/NF-e/SAT/MFE/SEFAZ e não exigem provedor fiscal para funcionar.
