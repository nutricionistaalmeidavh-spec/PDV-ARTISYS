# Piloto Woodpecker — PDV ArtiSys

Escopo atual: fases 0 a 4, com Server, Tunnel publico, Agent Windows persistente e pipeline real do PDV.

## Fase 0 — baseline confirmado

- Produto: `PDV-ARTISYS` v1.3.2.
- Runtime: Node >=22 + Electron.
- Instalador: Electron Builder / NSIS x64, saida em `dist/`.
- QA: runtime local em `qa/runtime`, com Playwright/Chromium.
- A raiz nao possui `package-lock.json`; por isso o bootstrap usa `npm install`. O runtime de QA possui lockfile e usa `npm ci --prefix qa/runtime`.

## Fase 1 — ArtiSys Release

Configuracao do produto: `.artisys/release.json`.

Fluxo `full`:

`deps -> lint -> test -> build/manifest -> installer -> qa`

O wrapper `scripts/artisys-release.ps1` localiza o motor compartilhado `utilidades/modules/artisys-release`. No Agent homologado, `ARTISYS_UTILIDADES_PATH` aponta para `C:\VICTOR\Artisys\AgroFrota\utilidades`.

Teste manual do motor:

```powershell
.\scripts\artisys-release.ps1 -Profile full
```

## Fase 2 — Woodpecker Server

O server usa Docker Compose + SQLite local. Nao ha servico pago obrigatorio.

Arquivos:

- `server/docker-compose.yml`
- `server/.env.example`
- `server/start-server.ps1`

Portas:

- `8000`: interface HTTP do Woodpecker.
- `9000`: gRPC para o Agent Windows.

O `.env` local guarda OAuth GitHub e `WOODPECKER_AGENT_SECRET` e permanece ignorado pelo Git.

O webhook publico usa `WOODPECKER_EXPERT_WEBHOOK_HOST=https://ci.artisys.dev`, entregue ao server local por Cloudflare Tunnel.

## Fase 3 — Agent Windows

O Agent usa backend `local`, portanto Electron, NSIS e Playwright executam diretamente no Windows. Esse backend deve ser usado apenas com repositorios confiaveis.

Componentes:

- Woodpecker Agent 3.18.1.
- plugin-git 2.10.1 no PATH do Agent.
- `WOODPECKER_BACKEND=local`.
- `WOODPECKER_MAX_WORKFLOWS=1`.
- label `pilot=pdv-artisys`.
- config local Windows em `%USERPROFILE%\ArtiSys\woodpecker-agent\agent.conf`.

O Agent e o Cloudflare Tunnel sao mantidos em segundo plano por tarefas agendadas do Windows.

## Fase 4 — Pipeline real do PDV

Workflow: `.woodpecker/pdv-release.yaml`.

Selecao do Agent:

- `platform=windows/amd64`
- `backend=local`
- `pilot=pdv-artisys`

Disparos:

- manual em qualquer branch;
- push em `main`;
- push no branch de homologacao `chore/woodpecker-pilot-phases-0-3`.

Fluxo:

1. valida Node, npm, Git e `ARTISYS_UTILIDADES_PATH`;
2. chama `scripts/artisys-release.ps1 -Profile full`;
3. o motor executa `deps -> lint -> test -> build -> installer -> qa`;
4. valida o relatorio `artifacts/artisys-release-report.json`;
5. confirma a existencia de `dist/ArtiSys-PDV-*-Setup.exe`.

A ordem `installer -> qa` e intencional: mesmo se o QA bloquear a entrega, o build do instalador ja foi produzido para diagnostico/homologacao.

## Homologacao fisica realizada em 18/09/2026

Confirmado no Windows do piloto:

- container `artisys-woodpecker-server` healthy;
- `http://localhost:8000/healthz` retorna `204`;
- `https://ci.artisys.dev/healthz` retorna `204`;
- Cloudflare Tunnel ativo;
- `woodpecker-agent.exe` ativo;
- tarefa `ArtiSys Woodpecker Agent` permanece em execucao (`LastTaskResult 267009`).

## Estado ao fim da fase 4

Configuracao do pipeline commitada e pronta para execucao pelo Agent Windows. O primeiro run completo ainda precisa ser observado no Woodpecker para validar clone, comandos do produto, instalador e QA no ambiente real.

## Proximas fases

- primeiro run completo do pipeline e coleta das evidencias reais;
- testes controlados de falha;
- publicacao automatica em GitHub Release;
- auto-update do cliente via `electron-updater`.
