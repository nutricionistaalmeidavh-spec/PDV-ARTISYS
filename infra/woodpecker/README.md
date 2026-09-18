# Woodpecker CI — PDV ArtiSys

Estado do fluxo de CI/release do `PDV-ARTISYS`.

## Arquitetura

```text
Git push/tag
  -> GitHub webhook
  -> https://ci.artisys.dev (Cloudflare Tunnel)
  -> Woodpecker Server local
  -> Windows Agent (backend local)
  -> utilidades/modules/artisys-release
  -> installer -> QA -> security/evidence -> publish
  -> GitHub Release
  -> electron-updater
```

O host homologado usa Node 22+, Electron Builder/NSIS, Playwright/Chromium e o repositório compartilhado `utilidades` em `C:\VICTOR\Artisys\AgroFrota\utilidades`.

## Fases 0–4 — homologadas

- baseline do produto e instalador;
- `artisys-release` compartilhado;
- Woodpecker Server em Docker;
- Agent Windows persistente com backend local;
- Cloudflare Tunnel em `https://ci.artisys.dev`;
- pipeline real `deps -> lint -> test -> build -> installer -> qa`;
- instalador sempre antes do QA;
- reporter automático de falhas para GitHub.

A Fase 4 foi validada com pipeline verde e integrada em `main` em 18/09/2026.

## Fases 5–8 — branch de homologação

Branch: `feat/woodpecker-phases-5-8`.

### Fase 5 — GitHub Release

O perfil `release` adiciona os gates de publicação depois do instalador/QA. O fluxo de tag `v*` deve publicar somente após todos os gates obrigatórios aprovarem.

Assets esperados:

- `ArtiSys-PDV-<versao>-x64-Setup.exe`;
- `latest.yml`;
- `.blockmap`;
- manifesto/checksums SHA-256;
- evidências permitidas pela política de release.

Push comum não publica release.

### Fase 6 — atualização automática

O desktop usa `electron-updater` com:

- `autoDownload = false`;
- `autoInstallOnAppQuit = true`;
- consulta de nova versão;
- download sob ação do usuário;
- progresso;
- instalação após download;
- estado/erros expostos à UI via IPC seguro.

Como o repositório do PDV é privado, a distribuição para clientes não deve embutir PAT GitHub no aplicativo. A homologação final do updater exige um canal público/proxy seguro para os assets de atualização.

### Fase 7 — hardening do host

`infra/woodpecker/health-check.ps1` verifica:

- Docker;
- Woodpecker Server local;
- `https://ci.artisys.dev/healthz`;
- Agent Windows;
- Cloudflare Tunnel;
- `artisys-release`;
- `artisys-ci-reporter`;
- limpeza de workspaces antigos e rotação de logs.

O teste real de 18/09/2026 confirmou todos esses componentes saudáveis.

### Fase 8 — reporter compartilhado

O reporter fica em `utilidades/modules/artisys-ci-reporter` e não contém lógica específica do PDV. Ele publica:

- status de sucesso/falha no commit;
- step, exit code e comando quando disponíveis;
- resumo dos gates;
- presença/caminho do instalador;
- link público do pipeline;
- comentário de diagnóstico em falhas;
- comentário opcional em PR.

## Token GitHub do Agent

O token não fica no repositório. O Agent lê:

```text
C:\ProgramData\ArtiSys\github-report-token.txt
```

Configuração local:

```powershell
.\infra\woodpecker\configure-github-reporter.ps1
```

Para o fluxo completo (reporter + GitHub Release), o Fine-grained PAT precisa de:

- **Contents: Read and write** — necessário para criar/editar GitHub Releases e tags de release;
- **Commit statuses: Read and write** — necessário para os status detalhados do CI;
- **Pull requests: Read and write** — opcional, usado para repetir o diagnóstico no PR.

O token pode ter acesso a todos os repositórios ArtiSys se o mesmo Agent/reporter for reutilizado entre produtos.

## Homologação física conhecida

Confirmado no Windows do piloto:

- Woodpecker Server healthy;
- `http://localhost:8000/healthz` -> 204;
- `https://ci.artisys.dev/healthz` -> 204;
- Cloudflare Tunnel ativo;
- `woodpecker-agent.exe` ativo;
- Docker ativo;
- módulos compartilhados `artisys-release`, `artisys-ci-reporter` e `artisys-security` com testes aprovados durante a homologação.

## Gates antes de mergear Fases 5–8

1. pipeline normal da branch verde;
2. instalador gerado;
3. QA verde;
4. health do host verde;
5. smoke de permissão de GitHub Release verde;
6. PR revisado e mergeado em `main`;
7. teste de release por tag;
8. homologação do canal seguro usado pelo `electron-updater`.
