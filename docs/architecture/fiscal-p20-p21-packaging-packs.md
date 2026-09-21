# Fiscal P20–P21 — Packaging e Fiscal Packs

## Escopo

Esta entrega adiciona somente a infraestrutura de distribuição do runtime fiscal (P20) e o formato/importador local de Fiscal Packs (P21). Não altera checkout, estoque, caixa nem a máquina de estados fiscal.

O princípio comercial continua invariável: o core fiscal local usa `acbr-local`, custa R$ 0/mês para a ArtiSys, não cobra por documento e não exige cloud. Focus permanece provider opcional contratado pelo cliente.

## P20 — layout empacotado

Em desenvolvimento, o sidecar continua em `server/fiscal-sidecar/entry.js`. Em aplicativo empacotado, `desktop/fiscal-runtime-paths.cjs` resolve exclusivamente `process.resourcesPath/fiscal`:

```text
resources/
└── fiscal/
    ├── sidecar/
    │   ├── entry.js
    │   └── demais módulos do sidecar
    ├── acbr/
    ├── configs/
    ├── schemas/
    └── manifest.json
```

`electron-builder.extraResources` copia esses artefatos fora do `app.asar`. O Electron passa ao lifecycle do sidecar o `entryPath` externo; em caso de ausência/falha do runtime fiscal, o PDV continua operando sem emissão local.

O repositório não contém hoje o binário oficial `ACBrMonitorPLUS.exe`. O diretório `fiscal-runtime/acbr` é o slot de distribuição e o manifesto declara explicitamente `bundledExecutable: false`. O build de produção não deve inventar um executável: a inclusão do artefato oficial, com origem/licença/integridade verificadas, é dependência externa ainda pendente.

## P21 — formato Fiscal Pack

Fiscal Pack é um diretório local com `manifest.json` versão 1 e arquivos declarativos. Categorias permitidas:

- `schemas/`: `.xsd`, `.xml`, `.json`, `.txt`;
- `tables/`: `.csv`, `.json`, `.xml`, `.txt`;
- `parameters/`: `.json`, `.ini`, `.xml`, `.txt`, `.csv`;
- `rules/`: apenas formatos declarativos permitidos; código executável é rejeitado.

Exemplo:

```json
{
  "formatVersion": 1,
  "id": "br-core",
  "version": "2026.09.0",
  "createdAt": "2026-09-20T00:00:00.000Z",
  "files": [
    {
      "path": "parameters/runtime.json",
      "kind": "parameters",
      "sha256": "<64 hex>"
    }
  ]
}
```

A validação rejeita path absoluto/traversal, symlink, extensão executável, arquivo grande, pack excessivo, duplicidade e checksum divergente. A importação copia somente arquivos declarados para staging no mesmo filesystem, revalida e faz rename atômico. Reimportação idêntica é idempotente; mesmo `id@version` com conteúdo diferente é conflito.

Não há download remoto, chamada HTTP, servidor ArtiSys, migration de SQLite ou dependência paga nesta etapa.

## Dependências deliberadamente não resolvidas (P8–P19)

P20–P21 podem ser desenvolvidos em paralelo, mas não tornam o fiscal comercialmente pronto:

- P8–P9: estados definitivos, `UNKNOWN`, timeout e reconciliação ainda governam a segurança de reemissão real;
- P10–P11: monitor fiscal e cancelamento ainda são necessários para operação administrativa completa;
- P12–P13: arquivo XML/eventos e DANFE fiscal ainda precisam do fluxo operacional definitivo;
- P14–P15: UI de configuração e habilitação controlada de produção ainda são gates;
- P16: contingência ainda não é implementada por este bloco;
- P17–P18: NF-e e NFS-e não são habilitadas por Packaging/Fiscal Packs;
- P19: Focus permanece compatível apenas como provider opcional, nunca como requisito do core.

A homologação/produção reais também dependem do binário oficial ACBr distribuível e dos dados/certificado/CSC do estabelecimento. Fiscal Packs não podem decidir tributação empresarial nem substituir homologação legal.

## Evidência

`test/fiscal-packaging-packs.test.js` cobre contracts/unit/integration de paths e importação usando `js/domains/fiscal/fiscal-pack-store.js`. `test/fiscal-packaging-e2e.test.js` monta um layout de instalação em diretório temporário, inicia o sidecar a partir do caminho externo ao ASAR e comprova persistência de um pack após recriar o serviço. O gate final continua `npm run verify:release` seguido do E2E Electron de release.
