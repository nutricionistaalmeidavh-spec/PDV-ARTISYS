# QA visual remoto

O PDV consome o módulo central `artisys-qa` do repositório `utilidades`.

## Executar pelo GitHub

Abra **Actions > QA Capture > Run workflow** e escolha:

- `flow`: `smoke` ou `home`;
- `environment`: `ci`;
- `viewport`: `desktop`, `tablet` ou `mobile`.

A execução instala as dependências do PDV, inicia o Electron no runner Ubuntu com Xvfb, abre a janela via Playwright e publica um artifact contendo screenshots, vídeo MP4, `trace.zip`, `telemetry.json` e `run-summary.json`.

## Adicionar fluxo

1. Crie `qa/flows/<nome>.json`.
2. Registre-o em `qa/artisys-qa.config.json`.
3. Adicione o nome às opções de `flow` em `.github/workflows/qa-capture.yml`.
4. Use apenas seletores estáveis e dados sintéticos.
5. Credenciais devem vir de GitHub Secrets via `valueFromEnv`.

O QA visual complementa, mas não substitui, `npm run verify` e `npm run verify:release`.
