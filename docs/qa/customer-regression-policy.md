# Política de regressão para bugs de cliente

## Regra

Todo bug confirmado que chegou a um cliente deve deixar uma proteção permanente no repositório. A correção só é considerada completa quando existe um teste de regressão capaz de reproduzir o comportamento incorreto e impedir que ele volte.

## Fluxo obrigatório

1. Registrar o incidente com um identificador rastreável (`BUG-xxxx`, issue ou equivalente).
2. Reproduzir o problema no menor nível de teste que represente o defeito real.
3. Criar ou ajustar um teste que **falhe antes da correção** pelo motivo esperado.
4. Corrigir o código de produção.
5. Executar novamente o teste e a suíte relacionada; o teste novo deve passar após a correção.
6. Manter o teste no repositório enquanto a funcionalidade existir.
7. Para defeitos de UI, impressão ou artefatos, preservar evidências úteis de falha (screenshot, diff, trace, log, PDF ou arquivo gerado) quando aplicável.

## Escolha da camada

Use a camada mais barata que consiga detectar o defeito de verdade:

- regra pura ou cálculo: teste unitário;
- banco, evento, idempotência ou integração entre serviços: integração;
- comportamento percebido pelo operador: E2E;
- posição, orientação ou aparência: regressão visual;
- PDF, QR, código de barras ou outro arquivo gerado: validar também o conteúdo/semântica do artefato, não apenas sua existência;
- hardware físico: manter primeiro a prova automatizada de software no Git e homologar hardware separadamente quando necessário.

Não crie um E2E se um teste menor captura o mesmo defeito com segurança. Não aceite um teste que apenas percorra o fluxo sem uma asserção capaz de perceber o erro original.

## Exemplo: código de barras

O ArtiSys já possui regressão para preservar a ordem dos dígitos recebidos de um scanner no checkout (`test/checkout-barcode-scan.test.js`). Isso protege o comportamento de entrada. Um defeito futuro no desenho, orientação ou impressão de um código de barras exige um oráculo de saída diferente: comparação visual e, quando houver um artefato decodificável, gerar → ler/decodificar → comparar o valor obtido com o valor original.

## Critério para PR

Quando uma PR corrige bug de cliente, a descrição deve apontar:

- incidente/issue relacionado;
- teste de regressão adicionado ou fortalecido;
- evidência de que esse teste falhava no comportamento defeituoso;
- evidência de que passou após a correção;
- suíte/gate de CI que executa o teste.

Se não for um bug reportado por cliente, marque a seção correspondente do template como não aplicável.
