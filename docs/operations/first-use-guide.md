# Primeiro uso guiado do ArtiSys PDV

## Comportamento

O fluxo de ativação, criação do administrador e seleção do PC principal permanece inalterado. Depois que a sessão é autenticada, a Home clássica pode mostrar **Prepare sua loja**, sem tomar o lugar do Balcão ou bloquear a navegação.

O checklist lê o estado canônico da instalação pela API local:
- **Tipo de negócio e áreas**: `GET /api/v1/vertical/onboarding`; conclusão só via `POST /api/v1/vertical/onboarding/complete`, autorizada por `modules.manage` e confirmada pelo administrador.
- **Primeiros produtos**: produtos ativos na API do catálogo.
- **Caixa**: sessão aberta no terminal pela API de caixa.
- **Primeira venda**: uma venda concluída no histórico, sem criar venda de demonstração.
- **Periféricos, Pix e cartão**: orientação opcional para configurar e testar; não há selo de conclusão automático sem evidência operacional.
- **Alimentação**: orientação mostrada apenas quando a área FOOD está ativa.

Na falha de consulta, a etapa fica como **Não verificado**, nunca como concluída ou pendente fictícia. O progresso contabiliza somente as três primeiras etapas essenciais. Ter visto um tour não altera esses estados.

## Abertura e retomada

A exibição automática é apenas um cartão de orientação não bloqueante na Home, limitada a perfis capazes de gerenciar módulos e a uma instalação com onboarding não concluído, sem produtos e sem vendas na consulta. Instalações com dados operacionais não recebem o cartão automaticamente. O modal detalhado e o tour só abrem por clique explícito. A pessoa pode selecionar **Continuar depois**; esta preferência de interface é gravada no navegador por usuário e terminal e não é usada como dado operacional.

O botão **Ajuda** na barra lateral permite abrir novamente o checklist e iniciar um tour pelas telas autorizadas. O tour usa `PdvAppNavigation` e `PdvUiLifecycle`, nunca URLs externas ou uma nova navegação paralela; respeita as permissões e módulos ativos. O usuário pode sair do tour com **Encerrar** ou Escape.

Os atalhos de configuração acionam os botões de categoria do Settings Hub canônico para abrir a seção correspondente, sem criar um canal de seleção paralelo. Nenhum atalho executa uma operação financeira ou de estoque automaticamente.

## Arquitetura e custo

Interface: `desktop/renderer/first-use-guide-model.js`, `first-use-guide-ui.js` e `first-use-guide.css`. Fonte de verdade: serviços já existentes do runtime Node/SQLite e rotas HTTP locais com RBAC. Sem banco, tracking, SDK, assinatura ou serviço pago adicional.

## Verificação

Teste direcionado: `node --test test/first-use-guide.test.js`.

Regressão completa: `npm test` e `npm run verify`; validação final de toque, foco, janela 1024×768, impressora e fluxo multi-PC depende de homologação do cliente em hardware físico.

A implementação não cria release, instalador ou publicação automática para clientes. Novas instalações devem usar uma versão distribuída somente após homologação e release controlado.
