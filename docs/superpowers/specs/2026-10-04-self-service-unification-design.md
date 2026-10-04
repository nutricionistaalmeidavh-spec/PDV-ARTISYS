# Unificação de Autoatendimento e remoção do TABLET legado

Data: 2026-10-04  
Branch: `fix/self-service-local-access-flow`

## Objetivo

Eliminar o fluxo legado `TABLET` e consolidar o dispositivo de cliente pareado em um único conceito: `SELF_SERVICE`, configurado como:

- `TABLE`: dispositivo fixo vinculado a uma mesa/comanda;
- `PICKUP`: autoatendimento para retirada no balcão.

O cardápio público por QR (`/m/:token`) permanece independente, público e responsivo. A experiência visual do autoatendimento deve seguir a direção canônica já existente nesse cardápio: produto em primeiro plano, fotos reais quando existentes, categorias, busca, configuração de item e carrinho com hierarquia touch-first.

Não há exigência de compatibilidade com instalações antigas que já tenham dispositivos `TABLET` persistidos. O sistema ainda não teve uso real, portanto a remoção pode ser limpa em schema, domínio, UI, testes e documentação.

## Princípios que devem permanecer canônicos

1. O servidor local/SQLite continua sendo a autoridade operacional.
2. QR de mesa continua usando token opaco e não exige credencial de dispositivo.
3. Dispositivos pareados continuam usando ID + credencial armazenada somente como hash/salt.
4. Mesa, comanda, pedido, preço, configuração de produto, KDS e despacho continuam usando os serviços canônicos existentes.
5. `SELF_SERVICE + TABLE` nunca cria uma segunda comanda paralela: usa exclusivamente a comanda da mesa vinculada.
6. `SELF_SERVICE + PICKUP` continua registrando pedido de retirada pelo fluxo de fast-food/retirada já existente.
7. Fotos, descrições, disponibilidade e configurações exibidas ao cliente devem vir da mesma projeção pública/canônica do cardápio; não expor custo, receita, SKU, estoque interno ou credenciais.
8. Operação diária continua local-first, sem CDN, SaaS ou serviço pago obrigatório.

## Modelo de produto final

### QR da mesa

`/m/:token`

- público;
- não é um dispositivo pareado;
- funciona em celular, tablet ou desktop;
- mantém o cardápio responsivo atual;
- pode chamar garçom e pedir conta conforme regras atuais;
- envia pedidos à comanda canônica da mesa.

### Autoatendimento pareado

`SELF_SERVICE`

#### Modo TABLE

- dispositivo fixo vinculado a uma mesa;
- mostra a identidade do dispositivo e a mesa;
- lê a comanda ativa da mesa;
- envia pedidos para essa comanda;
- oferece chamar garçom e pedir conta;
- usa a mesma linguagem visual do cardápio QR, adaptada a tela maior e uso contínuo.

#### Modo PICKUP

- dispositivo fixo de retirada;
- exige responsável local;
- não depende de mesa/comanda;
- registra pedidos no fluxo canônico de retirada;
- não mostra ações de garçom/conta;
- usa a mesma linguagem visual do cardápio QR.

### Dispositivos da equipe

Permanecem separados:

- `WAITER`: operação do garçom;
- `KITCHEN`: KDS/produção.

`TABLET` deixa de existir como tipo de dispositivo.

## Propriedade dos fluxos

### Alimentação → Autoatendimento

É a única superfície que cria e configura `SELF_SERVICE`.

Fluxo:

1. Novo dispositivo.
2. Nome do dispositivo.
3. Escolher onde será usado:
   - Mesa fixa;
   - Retirada no balcão.
4. Se Mesa fixa: escolher mesa.
5. Se Retirada: escolher responsável local.
6. Criar e configurar atomicamente do ponto de vista da experiência.
7. Mostrar credencial uma única vez e acesso local/QR.
8. Atualizar imediatamente a lista de dispositivos configurados.

Falha na configuração não deve deixar o operador acreditando que o dispositivo ficou pronto. O formulário preserva as escolhas e oferece nova tentativa.

### Acessos e equipe → Dispositivos

Continua sendo a central técnica de credenciais e segurança.

Pode:

- listar dispositivos já existentes;
- bloquear/reativar;
- rotacionar credencial;
- configurar setores de KDS.

Não deve oferecer criação genérica de `SELF_SERVICE` nem `TABLET`.

A criação de `WAITER` e `KITCHEN` pode continuar aqui enquanto não houver uma superfície operacional mais específica para esses dois tipos.

## Remoção de TABLET

Remover `TABLET` de:

- enum/validação de `mobile-device-service`;
- schema/check de `mobile_devices.device_type`;
- mapeamento de superfície e escopo;
- criação de dispositivos no Access Center;
- `renderTablet()` e seus handlers exclusivos;
- `/api/v1/mobile/context`, `/api/v1/mobile/orders` e `/api/v1/mobile/service` como caminhos de tablet;
- permissões/superfície `table` quando existirem somente para esse legado;
- labels, capacidades declaradas, documentação e testes que apresentem Tablet de mesa como canal suportado.

Como não há compatibilidade de dados antigos a preservar, não haverá adaptador de leitura, conversão automática ou UI de migração de `TABLET`.

### Fonte de pedido

O enum de origem do pedido deve representar o canal, não o hardware. A implementação deve substituir a origem interna `TABLET` por `TABLE` para pedidos iniciados pelo cliente em contexto de mesa (QR público ou `SELF_SERVICE + TABLE`), mantendo `DESKTOP` e `WAITER` inalterados.

Isso evita remover o tipo de dispositivo `TABLET` e deixar o mesmo conceito legado sobrevivendo em relatórios/auditoria interna.

## Experiência visual do autoatendimento

A referência visual é o cardápio público existente em `server/customer-menu`; não criar uma terceira linguagem.

### Elementos a compartilhar semanticamente

- topo/navy ArtiSys com contexto do atendimento;
- busca;
- categorias horizontais;
- destaque visual quando há foto real;
- cards de produto com nome, descrição pública, preço, disponibilidade e ação de adicionar;
- produto sem foto com fallback tipográfico deliberado;
- configuração de variação/adicionais/combos em diálogo/sheet;
- carrinho persistente e fácil de recuperar;
- ações com alvo mínimo de 44×44 px;
- feedback de adição, envio, erro e indisponibilidade;
- contraste/foco/reduced-motion equivalentes ao cardápio público.

### Adaptação específica do totem

Não copiar elementos de mesa que não pertencem ao contexto.

`TABLE`:
- contexto principal: nome do dispositivo + mesa;
- conta/comanda podem aparecer como contexto secundário;
- chamar garçom/pedir conta disponíveis.

`PICKUP`:
- contexto principal: retirada no balcão;
- sem conta da mesa, chamar garçom ou pedir conta;
- após envio, confirmação clara do pedido e retorno ao estado inicial adequado ao próximo cliente.

### Compartilhamento de dados e apresentação

O autoatendimento deve consumir a mesma projeção segura de menu usada pelo cardápio público para:

- descrição pública;
- foto;
- disponibilidade;
- ordenação;
- categoria;
- configuração segura.

Evitar manter duas funções independentes que decidam quais dados de produto o cliente pode ver.

A apresentação pode reutilizar CSS/componentes compartilhados quando isso reduzir divergência, mas não deve acoplar autenticação pública por token ao dispositivo pareado. Autenticação e contexto continuam específicos de cada canal.

## API e domínio

### SELF_SERVICE context

O contexto autenticado deve fornecer:

- device;
- profile;
- mesa/comanda quando `TABLE`;
- produtos pela projeção pública segura;
- categorias;
- aparência canônica do cardápio quando aplicável;
- modo de pagamento/retirada quando `PICKUP`.

### Pedidos

`SELF_SERVICE + TABLE`:
- exige comanda ativa;
- registra na comanda vinculada;
- usa origem `TABLE`;
- mantém `deviceId` para rastreabilidade.

QR público de mesa:
- mantém política atual de abertura automática configurável;
- usa origem `TABLE`;
- `deviceId=null`.

`SELF_SERVICE + PICKUP`:
- mantém o fluxo canônico de retirada existente.

### Serviço da mesa

Adicionar ao roteador autenticado de autoatendimento uma ação de serviço válida somente quando o perfil for `TABLE`:

- `WAITER`;
- `BILL`.

O roteador resolve a mesa pelo perfil persistido; o cliente não fornece um `tableId` arbitrário.

## Estados e recuperação

### Criação/configuração

Pending:
- ação de criar desabilitada;
- rótulo de progresso.

Success:
- dispositivo aparece na lista;
- credencial é mostrada uma única vez;
- QR/acesso local disponível no mesmo contexto.

Failure:
- valores de nome, modo, mesa/responsável permanecem;
- erro explica o que faltou/falhou;
- nova tentativa disponível;
- nenhum sucesso parcial é apresentado como configuração concluída.

### Cardápio/totem

Loading:
- estrutura estável com feedback local.

Produto indisponível:
- visível como indisponível e não adicionável.

Falha ao enviar:
- carrinho permanece intacto;
- botão volta ao estado acionável;
- erro é mostrado sem perder configuração/observação.

Success:
- confirma o pedido realmente registrado;
- limpa carrinho somente após confirmação do backend.

Falha de atualização:
- não deve apagar silenciosamente o último estado útil do carrinho.

## Testes obrigatórios

### Domínio

- `TABLET` rejeitado como tipo de dispositivo.
- `SELF_SERVICE + TABLE` exige mesa válida.
- `SELF_SERVICE + PICKUP` exige responsável ativo.
- contexto de self-service usa projeção segura do menu com foto/descrição/disponibilidade.
- `TABLE` envia à comanda correta com `deviceId`.
- `PICKUP` mantém criação de retirada.
- chamada de garçom/conta funciona somente em `TABLE`.

### Rotas

- Access Center não oferece `TABLET` ou criação genérica de `SELF_SERVICE`.
- rotas mobile antigas de `TABLET` deixam de aceitar esse principal.
- self-service autenticado recebe contexto, envia pedido e solicita serviço em modo `TABLE`.
- dispositivo de outro tipo não acessa rota de self-service.

### UI

- não existe `renderTablet()`;
- self-service contém busca, categorias, cards, foto/fallback e carrinho coerentes com a direção do cardápio público;
- modo `TABLE` mostra mesa e ações de serviço;
- modo `PICKUP` não mostra ações de mesa;
- criação em Autoatendimento preserva estado em erro e atualiza a lista em sucesso.

### Regressão

- QR público continua funcionando em mobile e viewport tablet;
- garçom e KDS continuam autenticando e operando;
- compositor/configuração de produto continua calculando preço e observações pelos serviços canônicos;
- suite completa e gates de verificação devem ser executados antes de considerar a entrega concluída.

## Fora de escopo

- cloud pairing novo;
- pagamento online;
- mudança do motor de preço;
- mudança de regras de estoque;
- redesign de garçom/KDS;
- redesign do cardápio QR já aprovado, exceto extração de peças compartilhadas necessária para evitar duplicação;
- migração de instalações reais com registros `TABLET`.

## Critérios de aceite

1. O operador encontra uma única forma funcional de criar autoatendimento.
2. Não existe opção `Tablet de mesa` em nenhum fluxo de criação.
3. Um dispositivo de mesa pareado é `SELF_SERVICE + TABLE`.
4. O autoatendimento usa visual e dados de produto coerentes com o cardápio público atual.
5. Mesa e retirada apresentam somente ações pertinentes ao seu modo.
6. QR público continua independente de credencial de dispositivo.
7. Pedidos de mesa continuam chegando à comanda/KDS corretos sem duplicação.
8. Falhas preservam carrinho e configuração em andamento.
9. Testes de domínio, rota, UI e regressão cobrem a remoção do legado e o fluxo consolidado.
