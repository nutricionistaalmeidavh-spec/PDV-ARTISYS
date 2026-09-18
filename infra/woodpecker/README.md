# Piloto Woodpecker — PDV ArtiSys

Escopo desta entrega: fases 0 a 3. A pipeline `.woodpecker` do produto fica para a fase 4; portanto este branch nao dispara build automaticamente ainda.

## Fase 0 — baseline confirmado

- Produto: `PDV-ARTISYS` v1.3.2.
- Runtime: Node >=22 + Electron.
- Instalador: Electron Builder / NSIS x64, saida em `dist/`.
- QA: runtime local em `qa/runtime`, com Playwright/Chromium.
- O repositorio raiz nao possui `package-lock.json`; por isso o bootstrap do produto usa `npm install`. O runtime de QA possui lockfile e usa `npm ci --prefix qa/runtime`.

## Fase 1 — ArtiSys Release

Configuracao do produto: `.artisys/release.json`.

Fluxo `full`:

`deps -> lint -> test -> build/manifest -> installer -> qa`

O wrapper `scripts/artisys-release.ps1` localiza o motor compartilhado em `utilidades/modules/artisys-release` e, por padrao, reaproveita o clone existente em `%USERPROFILE%\utilidades`.

Teste manual do motor, sem Woodpecker:

```powershell
.\scripts\artisys-release.ps1 -Profile full -UpdateUtilidades
```

## Fase 2 — Woodpecker Server

O server usa Docker Compose + SQLite local. Nao ha servico pago obrigatorio.

Arquivos:

- `server/docker-compose.yml`
- `server/.env.example`
- `server/start-server.ps1`

### 1. Criar uma GitHub OAuth App

No GitHub, crie uma **OAuth App** (nao GitHub App):

- Homepage URL: o mesmo valor de `WOODPECKER_HOST`.
- Authorization callback URL: `<WOODPECKER_HOST>/authorize`.

O host precisa ser alcancavel pelo GitHub para receber webhooks. Um Cloudflare Tunnel pode ser usado como camada gratuita, mas credenciais e DNS nao sao armazenados neste repositorio.

### 2. Preencher o `.env`

```powershell
Copy-Item .\infra\woodpecker\server\.env.example .\infra\woodpecker\server\.env
notepad .\infra\woodpecker\server\.env
```

Preencha:

- `WOODPECKER_HOST`
- `WOODPECKER_GITHUB_CLIENT`
- `WOODPECKER_GITHUB_SECRET`

O `WOODPECKER_AGENT_SECRET` pode ficar vazio: `start-server.ps1` gera 32 bytes aleatorios e grava apenas no `.env` local. O `.env` esta ignorado pelo Git.

### 3. Subir o server

```powershell
.\infra\woodpecker\server\start-server.ps1
```

Portas do piloto:

- `8000`: interface HTTP do Woodpecker.
- `9000`: gRPC para o Agent Windows.

## Fase 3 — Agent Windows

O Agent usa o backend `local`, portanto build Electron, NSIS e Playwright executam diretamente no Windows. Esse backend deve ser usado apenas com repositorios confiaveis.

### 1. Instalar o Agent

```powershell
.\infra\woodpecker\agent-windows\install-agent.ps1
```

O script:

- valida Git, Node e npm;
- baixa `woodpecker-agent` 3.18.1 para `%USERPROFILE%\ArtiSys\woodpecker-agent`;
- baixa `plugin-git` 2.10.1 para permitir clone no backend local;
- reutiliza/atualiza `%USERPROFILE%\utilidades` em vez de criar outro clone;
- valida a existencia do `artisys-release` compartilhado.

### 2. Iniciar o Agent

Com server e agent na mesma maquina:

```powershell
.\infra\woodpecker\agent-windows\start-agent.ps1
```

O launcher le automaticamente `WOODPECKER_AGENT_SECRET` de `server/.env`, usa `localhost:9000`, backend `local`, um workflow por vez e label `pilot=pdv-artisys`.

Se o server estiver em outra maquina:

```powershell
.\infra\woodpecker\agent-windows\start-agent.ps1 -Server 'HOST:9000' -AgentSecret 'SEGREDO_DO_SERVER'
```

## Estado ao fim da fase 3

Preparado:

- PDV conectado ao motor `artisys-release`.
- dependencias do PDV + runtime Playwright provisionaveis pelo release engine.
- Woodpecker Server reproduzivel por Docker Compose.
- SQLite persistente em volume Docker.
- OAuth GitHub externalizada para `.env` local.
- Agent Windows instalavel/reproduzivel.
- `plugin-git` preparado para clone no backend local.
- clone compartilhado de `utilidades` reutilizado.

Ainda deliberadamente fora do escopo:

- `.woodpecker/*.yaml` do PDV (fase 4).
- publicacao automatica de GitHub Release.
- auto-update do cliente.
