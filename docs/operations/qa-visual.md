# QA visual remoto

O PDV é o primeiro consumidor real do módulo central `artisys-qa` 1.0.0 do repositório privado `utilidades`.

Para não depender de habilitar compartilhamento de Actions entre repositórios privados, o PDV mantém em `qa/runtime/` um **runtime vendorizado e fixado** da versão central. A origem exata fica registrada em `qa/artisys-qa.lock.json` com repositório, caminho, versão e commit. Assim o workflow funciona imediatamente, sem PAT ou configuração externa, e atualizações do módulo continuam sendo explícitas e rastreáveis.

## Executar pelo GitHub

Abra **Actions > QA Capture > Run workflow** e escolha:

- `flow`: `smoke` ou `home`;
- `environment`: `ci`;
- `viewport`: `desktop`, `tablet` ou `mobile`.

A execução instala as dependências do PDV e do runtime fixado, inicia o Electron no runner Ubuntu com Xvfb, abre a janela via Playwright e publica um artifact contendo screenshots, vídeo MP4, `trace.zip`, `telemetry.json` e `run-summary.json`.

## Adicionar fluxo

1. Crie `qa/flows/<nome>.json`.
2. Registre-o em `qa/artisys-qa.config.json`.
3. Adicione o nome às opções de `flow` em `.github/workflows/qa-capture.yml`.
4. Use apenas seletores estáveis e dados sintéticos.
5. Credenciais devem vir de GitHub Secrets via `valueFromEnv`.

## Atualizar o módulo

Quando `utilidades/modules/artisys-qa` receber uma nova versão estável, sincronize o runtime, atualize `qa/artisys-qa.lock.json` para o novo commit e execute `smoke` antes do merge. Não faça mudanças específicas do PDV dentro do runtime vendorizado; elas pertencem aos fluxos e ao manifesto do consumidor.

O QA visual complementa, mas não substitui, `npm run verify` e `npm run verify:release`.
