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

## Fluxos E2E legados

Os fluxos automatizados antigos e as comparações visuais foram retirados dos gates ativos por estarem acoplados a versões anteriores da interface. Até a reconstrução de cenários representativos do produto atual, use os testes unitários/de integração e `npm run qa:validate`; a validação do harness não significa aprovação dos fluxos de usuário. Não adicione ou reative um gate E2E amplo sem revisar o fluxo contra a interface atual e demonstrar que ele termina e verifica um resultado útil.
