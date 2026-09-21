# Política de evolução pareada — Produtos e Clientes

## Objetivo

As adaptações de UX de **Produtos** e **Clientes** pertencem ao mesmo ciclo. Uma tela não deve avançar para uma arquitetura mais profunda enquanto a outra permanece em um estágio anterior de proteção contra regressão.

## Nível de maturidade

Cada módulo exporta seu nível local:

- `PRODUCTS_UX_LEVEL`
- `CUSTOMERS_UX_LEVEL`

Os dois devem permanecer com o **mesmo valor**.

O nível representa maturidade da adaptação, não quantidade de funcionalidades de negócio. As telas têm domínios diferentes, mas precisam manter a mesma profundidade de implementação e proteção.

## Regra para alteração estrutural

Qualquer **alteração estrutural** relevante em uma das duas telas — nova arquitetura de listagem, novo padrão de detalhe, substituição de handlers, mudança do mecanismo de fallback, retirada de Legacy ou avanço de paridade — deve:

1. elevar o `*_UX_LEVEL` da tela alterada;
2. implementar adaptação equivalente na outra tela;
3. elevar o nível da outra tela para o mesmo valor;
4. atualizar as duas matrizes de paridade quando aplicável;
5. manter testes de regressão específicos nas duas telas.

Se apenas um nível for elevado, o **CI deve falhar**.

## Guardas obrigatórias nas duas telas

Produtos e Clientes devem declarar as mesmas garantias estruturais:

- `reversible: true`;
- `progressiveEnhancement: true`;
- `legacyHandlersPreserved: true`;
- `parityGuarded: true`.

O teste `paired-ux-evolution-guard.test.js` compara diretamente os dois contratos.

## O que significa evolução pareada

Evolução pareada não significa copiar recursos de Produtos para Clientes ou vice-versa. Significa que, quando uma tela recebe uma melhoria de UX, a outra deve manter o mesmo padrão de segurança arquitetural:

- feature flag reversível;
- renderer Legacy preservado;
- melhoria progressiva sobre DOM/handlers existentes;
- matriz de paridade;
- testes de integração/paridade;
- teste de idempotência de observers;
- fallback sem perda funcional.

## Exceções

Correções estritamente locais de bug, acessibilidade ou estilo que não mudem o contrato estrutural não exigem aumento de nível. Mudanças que alterem fluxo, organização funcional, fonte de dados, fallback ou responsabilidade entre Legacy e nova UX exigem.
