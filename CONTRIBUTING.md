# Contribuindo com o ArtiSys PDV

## Regra obrigatória de documentação

Toda alteração que muda comportamento observável, funcionalidade, arquitetura, requisito, limitação, instalação, operação, release ou integração deve atualizar a documentação correspondente **na mesma entrega**.

Antes de integrar no `main`, revise obrigatoriamente:

- `README.md` — estado atual do produto, capacidades, requisitos e limitações relevantes;
- `release/capabilities.json` — capacidades comerciais/técnicas efetivamente disponíveis;
- `release/limitations.json` — limitações e dependências externas reais;
- `docs/architecture/` — contratos e decisões arquiteturais afetados;
- `docs/operations/` — procedimentos de instalação/operação afetados;
- `package.json` e artefatos de release — versão e comandos quando aplicável.

### Critério de conclusão

Uma funcionalidade não é considerada concluída quando o código está atualizado e a documentação pública/operacional correspondente está desatualizada.

O comando `npm run verify` inclui `npm run docs:check`, que valida invariantes documentais automatizáveis. Esse gate não substitui a revisão humana de conteúdo: quem altera comportamento deve atualizar os textos e metadados afetados.

### Checklist mínimo por entrega

1. O README descreve corretamente o estado atual?
2. `release/capabilities.json` e `release/limitations.json` continuam verdadeiros?
3. Existe documentação arquitetural/operacional suficiente para a mudança?
4. A versão declarada no README corresponde ao `package.json`?
5. Não restaram afirmações antigas contradizendo o comportamento implementado?
6. Os testes/gates relevantes foram executados após a atualização documental?

Essa regra vale para código, UI, banco, API, módulos, hardware, QA, build/release e infraestrutura.

## QA transversal obrigatório

O gate `npm run qa:crosscut` cobre riscos de produto que não pertencem a uma única tela ou fluxo funcional: sincronização de estado entre clientes, contratos de módulos opcionais e saúde do renderer. Ele complementa `qa:release`; não é permitido remover, reduzir ou substituir o gate funcional de release para fazer o crosscut passar.

Mudanças que adicionam ou alteram módulo opcional devem manter cobertura em `qa/crosscut/modules.json` para launcher, proteção de rota/mutação e sincronização viva quando aplicável. Uma subcapacidade realmente não aplicável precisa de motivo explícito versionado; ausência silenciosa de cobertura não é aceita.

Mudanças que alteram estado compartilhado entre desktop, LAN, mobile ou outro cliente devem incluir evidência executável de sincronização quando houver comportamento observável entre clientes. Para o Restaurante, a regressão canônica é `qa/flows/restaurant-module-sync-e2e.json`.

Falhas de rede esperadas podem ser classificadas explicitamente e permanecem no bundle de evidência. Falhas inesperadas de rede/renderer, findings críticos e contratos críticos descobertos sem cobertura não podem ser suprimidos silenciosamente e devem bloquear o gate.

Antes de integrar uma alteração transversal no `main`, execute os gates aplicáveis após a última mudança:

```bash
npm run verify:release
npm run qa:release
npm run qa:crosscut
```

O bundle agregado de `qa:crosscut` deve ficar limpo em `qa-artifacts/product/pdv-artisys/crosscut/`, e `release/e2e-coverage.json` deve continuar refletindo a evidência versionada. O core de QA permanece local-first/self-hosted e não pode adquirir dependência obrigatória de serviço pago externo.
