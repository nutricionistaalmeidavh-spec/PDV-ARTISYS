# QA visual e capturas de demonstração

As jornadas E2E antigas e os baselines pixel a pixel continuam removidos. O gate atual usa a interface Electron corrente e mantém screenshots/trace como evidência operacional, sem comparação visual por baseline.

`npm run qa:e2e:p0` executa três fluxos no CI:

- `all-pages-audit`: smoke das superfícies principais, controles críticos e overflow;
- `restaurant-table-lifecycle`: jornada transacional de Alimentação/Mesas, cobrindo pessoas, cliente, responsável, pedido, estado de produção no card, KDS, conta, checkout e liberação da mesa;
- `restaurant-multichannel-ui`: navega nas superfícies reais de garçom, tablet e QR, envia item configurado com observação em cada canal e confirma os três tickets no KDS.

O workflow **Actions > QA Capture > Run workflow** continua destinado somente a Demo Flows: gravações manuais de apresentação configuradas em `qa/demo/` e registradas em `qa/artisys-qa.config.json`. Essas demos não substituem o gate funcional.

Novos cenários devem partir da UI atual, usar dados isolados de QA e verificar um resultado operacional útil. Não restaure fluxos ou baselines antigos em bloco.
