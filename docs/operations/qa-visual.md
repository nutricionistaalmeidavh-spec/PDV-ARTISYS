# QA visual e capturas de demonstração

As jornadas E2E antigas e os baselines pixel a pixel continuam removidos. O gate atual usa a interface Electron corrente e mantém screenshots/trace como evidência operacional, sem comparação visual por baseline.

`npm run qa:e2e:p0` executa dois fluxos no CI:

- `all-pages-audit`: smoke das superfícies principais, controles críticos e overflow;
- `restaurant-table-lifecycle`: jornada transacional de Alimentação/Mesas, cobrindo abertura de atendimento, responsável, pedido, KDS, conta, checkout e liberação da mesa.

O workflow **Actions > QA Capture > Run workflow** continua destinado somente a Demo Flows: gravações manuais de apresentação configuradas em `qa/demo/` e registradas em `qa/artisys-qa.config.json`. Essas demos não substituem o gate funcional.

Novos cenários devem partir da UI atual, usar dados isolados de QA e verificar um resultado operacional útil. Não restaure fluxos ou baselines antigos em bloco.
