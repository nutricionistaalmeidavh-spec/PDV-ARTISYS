# Woodpecker CI — PDV ArtiSys

Fluxo self-hosted de CI/release do `PDV-ARTISYS` 1.3.4, sem serviço pago obrigatório.

## Arquitetura

```text
Git push/tag
  -> GitHub webhook
  -> https://ci.artisys.dev (Cloudflare Tunnel)
  -> Woodpecker Server local
  -> Windows Agent (backend local)
  -> utilidades/modules/artisys-release
  -> deps -> lint -> test -> build -> installer -> ArtiSys QA 2.6.0
  -> [tag] security -> evidence -> publish
  -> GitHub Release
  -> electron-updater / feed seguro configurado
```

O host homologado usa Node 22+, Electron Builder/NSIS, Playwright/Chromium e o repositório compartilhado `utilidades` em `C:\VICTOR\Artisys\AgroFrota\utilidades`.

## Fases 0–4 — CI do produto

Estão integrados:

- `artisys-release` compartilhado;
- Woodpecker Server em Docker;
- Agent Windows persistente com backend local;
- Cloudflare Tunnel em `https://ci.artisys.dev`;
- pipeline `deps -> lint -> test -> build -> installer -> qa`;
- validação explícita do ArtiSys QA 2.6.0 vendorizado;
- instalador antes do QA;
- reporter automático de falhas no GitHub.

O workflow normal é `.woodpecker/pdv-release.yaml`. Push em `main` executa o gate completo e não publica release.

## Fase 5 — publicação por tag

`.woodpecker/pdv-publish.yaml` aceita somente tags `v*` e chama o perfil `release` do motor compartilhado.

O perfil de release mantém todos os gates do produto e acrescenta:

1. `security` — `artisys-security`;
2. `evidence` — hashes SHA-256 dos artefatos;
3. `publish` — GitHub Release.

Assets obrigatórios:

- `ArtiSys-PDV-<versao>-x64-Setup.exe`;
- `latest.yml`;
- `.blockmap`.

A publicação é bloqueada se os assets exigidos estiverem ausentes ou se o evento não for uma tag.

## Fase 6 — atualização desktop

O desktop usa `electron-updater` com:

- checagem automática após a inicialização;
- `autoDownload = false`;
- download iniciado pelo usuário;
- progresso na UI;
- `autoInstallOnAppQuit = true`;
- instalação/reinício após o download;
- estados e erros expostos por IPC seguro;
- suporte a `ARTISYS_UPDATE_URL` para feed genérico.

O repositório `PDV-ARTISYS` é privado. O aplicativo **não deve** receber PAT/token GitHub. Portanto, o mecanismo do updater e os artefatos de atualização estão integrados, mas a distribuição direta a clientes precisa usar um feed público/proxy seguro ou outro canal sem segredo embutido no executável.

## Fase 7 — hardening do host

`infra/woodpecker/health-check.ps1` verifica:

- Docker;
- Woodpecker Server local;
- `https://ci.artisys.dev/healthz`;
- Agent Windows;
- Cloudflare Tunnel;
- `artisys-release`;
- `artisys-ci-reporter`;
- limpeza de workspaces antigos e rotação de logs.

## Fase 8 — reporter compartilhado

O reporter fica em `utilidades/modules/artisys-ci-reporter` e publica, quando aplicável:

- status no commit;
- step, exit code e comando;
- resumo dos gates;
- presença do instalador;
- link do pipeline;
- diagnóstico no commit e no PR.

O token fica apenas no Agent Windows, em:

```text
C:\ProgramData\ArtiSys\github-report-token.txt
```

Configuração local:

```powershell
.\infra\woodpecker\configure-github-reporter.ps1
```

Para reporter + publicação de release, o Fine-grained PAT do Agent precisa das permissões necessárias de Contents, Commit statuses e, quando usado para comentários, Pull requests. Nenhum token é versionado nem distribuído com o PDV.

## Evidência de recuperação das Fases 5–8

A branch antiga `feat/woodpecker-phases-5-8` falhava antes de concluir a homologação por regressões do runtime compartilhado de QA. A recuperação foi refeita sobre a `main` já com ArtiSys QA 2.6.0, sem mergear a branch antiga em bloco.

O pipeline de homologação da recuperação aprovou o fluxo normal completo com instalador e QA. A publicação efetiva por tag permanece uma ação deliberada de release, separada do push comum.
