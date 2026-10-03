# QA Multi-Device LAN

Este gate valida a operacao do ArtiSys com um unico servidor autoritativo e varios clientes logicos simultaneos sobre HTTP local. Ele nao depende de SaaS, internet, D1, R2 ou qualquer servico pago.

## Disparo

O workflow `.github/workflows/qa-multi-device-lan.yml` usa apenas `workflow_dispatch`.

Ele nao roda em `push`, `pull_request` ou `schedule`.

Depois de integrado na branch padrao:

1. abra **Actions**;
2. escolha **QA Multi-Device LAN**;
3. escolha o perfil;
4. execute **Run workflow**.

## Perfis

- `smoke`: propagacao de preco, baixa de estoque, corrida pela ultima unidade, idempotencia e invariantes finais.
- `full`: inclui dois caixas, isolamento de sessao, garcom -> KDS, totem e invariantes de banco.
- `stress`: executa o perfil completo e repete 50 corridas concorrentes pela ultima unidade.

## Invariantes obrigatorios

- **price-propagation**: alteracao administrativa de preco precisa aparecer para uma nova venda no caixa.
- **sale-stock-decrement**: venda concluida precisa baixar o estoque exatamente uma vez.
- **last-unit-race**: com saldo 1 e dois caixas tentando concluir ao mesmo tempo, apenas uma venda pode concluir.
- **idempotent-completion**: reenvio com o mesmo `mutationId` nao pode duplicar pagamento, venda ou baixa.
- **cash-session-isolation**: cada venda deve permanecer vinculada a sessao do terminal correto.
- **restaurant-kds-flow**: pedido do garcom precisa chegar ao KDS e o status READY precisa voltar para a comanda.
- **self-service-order**: o totem precisa criar pedido autenticado com o dispositivo pareado.
- **database-invariants**: nao pode haver estoque negativo, pagamento orfao, venda concluida sem pagamento ou venda concluida sem sessao de caixa.

## Evidencias

Cada execucao grava em `qa-artifacts/multi-device`:

- `report.json`: resultado estruturado por cenario;
- `summary.md`: resumo usado tambem no GitHub Step Summary;
- `events.jsonl`: trilha de inicio, sucesso e falha de cada cenario;
- `final.sqlite`: banco final para auditoria pos-teste.

O artifact e enviado mesmo quando algum cenario falha.

## Execucao local

```bash
npm run qa:multi-device -- --profile smoke --output qa-artifacts/multi-device
npm run qa:multi-device -- --profile full --output qa-artifacts/multi-device
npm run qa:multi-device -- --profile stress --output qa-artifacts/multi-device
```

O teste usa `127.0.0.1` para representar a LAN dentro do runner. Isso valida contratos HTTP, concorrencia, persistencia e efeitos de dominio. Firewall do Windows, roteador, perda fisica de Wi-Fi e hardware real continuam sendo validacoes de bancada.
