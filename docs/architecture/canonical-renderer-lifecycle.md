# Renderer canônico e lifecycle semântico

## Estado atual

O renderer desktop do ArtiSys usa ownership explícito por rota e eventos semânticos para extensões de superfície.

- cada rota registrada em `PdvRouteRegistry` possui um único owner;
- `PdvUiLifecycle` publica `route:before`, `route:mounted`, `route:updated` e `route:unmounted`;
- superfícies internas que não são rotas publicam `surface:mounted` com identificador estável;
- o renderer de produção possui orçamento de `MutationObserver` igual a **zero**;
- extensões operacionais não aguardam alterações arbitrárias de DOM: reagem somente a eventos de rota/superfície conhecidos.

## Home

A Home é renderizada diretamente pelo owner `app`. A apresentação usa `PdvHomeRoleModel` para derivar os atalhos permitidos e chama `PdvAppNavigation.navigate()` diretamente. Não existe mais uma Home nativa escondida servindo de ponte para controles da Home apresentada.

## Extensões operacionais

As antigas camadas de parity foram aposentadas. As capacidades preservadas estão em módulos semânticos:

- `operational-route-extensions.js` para extensões de Estoque, Logística, Devoluções e Financeiro;
- `operational-detail-extensions.js` para recebimento parcial, atendimento parcial, detalhes de devolução e operações complementares de Configurações.

Esses módulos são acionados por `route:mounted` / `route:updated` e pelos eventos `surface:mounted` emitidos pelos fluxos internos correspondentes.

## Bridges aposentadas

- `backend-parity-ui.js`;
- `ui-parity-p0-p2.js`;
- `reporting-v2-legacy-export.js`;
- monkey-patch de `toastRoot.appendChild`.

A exportação detalhada do overview de Relatórios pertence ao próprio `reporting-v2.js`. Toasts novos devem usar `PdvToast.show()`.

## Gate

O teste estrutural varre todos os arquivos JavaScript em `desktop/renderer` e exige zero ocorrências de `new MutationObserver`. O mesmo gate confirma que as bridges aposentadas não voltaram ao entrypoint.
