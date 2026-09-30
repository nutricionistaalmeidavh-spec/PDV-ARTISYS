# Capturas manuais de demonstração

As jornadas E2E antigas de interface e as comparações com baseline visual foram removidas. Não há atualmente um gate de screenshots que aprove ou reprove alterações de interface.

O workflow **Actions > QA Capture > Run workflow** é destinado somente a Demo Flows: gravações manuais de apresentação configuradas em `qa/demo/` e registradas em `qa/artisys-qa.config.json`. Essas capturas não são testes funcionais nem evidência de aprovação de QA.

Para criar uma apresentação, adicione um roteiro sintético, seguro e não destrutivo em `qa/demo/`, registre-o em `demos` e atualize as opções do workflow se necessário. Para QA visual futuro, desenhe novos cenários sobre a interface atual em uma entrega separada; não restaure os fluxos ou baselines antigos em bloco.
