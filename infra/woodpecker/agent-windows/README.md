# Agent Windows

Use `install-agent.ps1` para instalar o `woodpecker-agent` e o `plugin-git` no Windows e preparar o clone compartilhado de `utilidades`.

Depois use `start-agent.ps1` para conectar o Agent normal ao Woodpecker Server usando backend `local`.

O backend local executa comandos diretamente neste Windows; mantenha os Agents restritos aos repositorios ArtiSys confiaveis.

## Agent elevado ArtiSys

O Agent normal continua existindo. O segundo Agent e separado e usa:

- tarefa: `ArtiSys Woodpecker Agent Elevated`;
- conta: usuario Windows interativo atual;
- `RunLevel Highest`;
- backend `local`;
- workspace: `%USERPROFILE%\ArtiSys\woodpecker-work-elevated`;
- labels: `privilege=elevated`, `owner=artisys`;
- identidade herdada pelos jobs: `ARTISYS_AGENT_PRIVILEGE=elevated`, `ARTISYS_AGENT_OWNER=artisys`, `ARTISYS_AGENT_PLATFORM=windows/amd64`.

O launcher usa uma copia Git isolada do `utilidades` em `C:\ProgramData\ArtiSys\utilidades-elevated`, para nao trocar a branch do clone usado pelo Agent normal.

### Instalacao

Abra PowerShell **como Administrador** na raiz deste repositorio e execute:

```powershell
& .\infra\woodpecker\agent-windows\install-elevated-agent.ps1
```

Durante o desenvolvimento da infraestrutura, o instalador usa por padrao `feat/artisys-windows-ci-elevated`. Depois que esse modulo estiver na `main`, execute com:

```powershell
& .\infra\woodpecker\agent-windows\install-elevated-agent.ps1 -UtilidadesRef main
```

O instalador nao substitui nem encerra a tarefa `ArtiSys Woodpecker Agent` normal.

### Politica

O Agent elevado deve ser selecionado por workflow com:

```yaml
labels:
  platform: windows/amd64
  backend: local
  privilege: elevated
  owner: artisys
```

Antes de executar comandos de produto, o workflow deve chamar `artisys-windows-ci verify-elevated`. Pull requests sao recusados no caminho elevado; PRs continuam no Agent normal.
