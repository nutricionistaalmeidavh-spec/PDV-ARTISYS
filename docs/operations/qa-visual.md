# QA visual remoto e Demo Flows

O PDV é o primeiro consumidor real do módulo central `artisys-qa`. Além do QA visual, o módulo oferece **Demo Flows** separados para gravações de apresentação do produto.

Para não depender de habilitar compartilhamento de Actions entre repositórios privados, o PDV mantém em `qa/runtime/` um runtime vendorizado e fixado da versão central. A origem exata fica registrada em `qa/artisys-qa.lock.json`.

## Executar pelo GitHub

Abra **Actions > QA Capture > Run workflow**.

Para QA:

- `mode`: `qa`;
- `flow`: `smoke` ou `home`;
- `viewport`: `desktop`, `tablet` ou `mobile`.

Para vídeo de demonstração:

- `mode`: `demo`;
- `demo`: `quick-30s` ou `overview-60s`;
- `preset`: `reels-9x16`, `landscape-16x9` ou `square-1x1`.

O preset padrão do `quick-30s` é **Reels 9:16, 1080×1920 MP4**. Em Electron, a interface permanece numa viewport desktop legível e o vídeo é escalado/proporcionado para o canvas vertical, sem deformar a UI.

## Evidências

QA produz screenshots, vídeo, `trace.zip`, `telemetry.json` e `run-summary.json`. Demo Flow acrescenta:

- `demo-video.mp4` — arquivo final no formato social escolhido;
- `demo-summary.json` — preset, dimensões, duração-alvo, duração real e desvio de tempo.

## Criar um novo Demo Flow

1. Crie `qa/demo/<nome>.json`.
2. Registre em `demos` dentro de `qa/artisys-qa.config.json`.
3. Defina `preset` e `durationTargetSec`.
4. Use `holdMs` nas etapas para controlar o ritmo.
5. Adicione o nome às opções do workflow quando desejar execução manual pelo GitHub.
6. Use apenas dados sintéticos e ações não destrutivas para vídeos comerciais.

Exemplo:

```json
{
  "name": "quick-30s",
  "durationTargetSec": 30,
  "steps": [
    {"action": "click", "selector": "button[data-route='products']", "holdMs": 3500},
    {"action": "click", "selector": "button[data-route='inventory']", "holdMs": 3500}
  ]
}
```

A duração-alvo é orientativa e não reprova a execução. Isso evita falhas causadas por pequenas variações de inicialização do runner.

## Atualizar o módulo

Quando `utilidades/modules/artisys-qa` receber uma nova versão estável, sincronize `qa/runtime/`, atualize `qa/artisys-qa.lock.json` para o novo commit e execute o QA `smoke` e o Demo Flow `quick-30s` antes do merge.

O QA visual complementa, mas não substitui, `npm run verify` e `npm run verify:release`. Demo Flows servem para apresentação e gravação, não para substituir testes funcionais.
