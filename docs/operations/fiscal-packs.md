# Operação local de Fiscal Packs

Fiscal Packs são arquivos/diretórios administrados localmente. O PDV não consulta catálogo cloud nem baixa atualização fiscal silenciosamente.

## Validar antes de importar

```bash
node scripts/fiscal-pack-cli.js validate C:\caminho\FiscalPack-2026.09 --store C:\ProgramData\ArtiSys\fiscal-packs
```

A validação confere versão do formato, `id`, versão SemVer, caminhos, tipos declarativos, tamanho e SHA-256 de cada arquivo.

## Importar

```bash
node scripts/fiscal-pack-cli.js import C:\caminho\FiscalPack-2026.09 --store C:\ProgramData\ArtiSys\fiscal-packs
```

A importação usa staging e rename local. Repetir exatamente o mesmo pack não duplica conteúdo. Um `id@version` já instalado com manifesto diferente é rejeitado.

## Listar

```bash
node scripts/fiscal-pack-cli.js list --store C:\ProgramData\ArtiSys\fiscal-packs
```

O caminho também pode ser definido por `ARTISYS_FISCAL_PACK_STORE` para ferramentas administrativas locais.

## Segurança

- não importar packs recebidos sem origem conhecida;
- verificar o SHA-256 fornecido pelo distribuidor;
- packs não carregam `.js`, `.exe`, `.dll`, `.bat`, `.cmd` ou PowerShell;
- não colocar certificado, senha de PFX, CSC completo ou token de provider dentro de pack;
- o importador não executa conteúdo do pack;
- esta etapa não habilita produção fiscal nem altera tributação automaticamente.

## Runtime empacotado

No aplicativo instalado, sidecar, pasta ACBr, configs e schemas ficam sob `resources/fiscal`, fora do ASAR. O binário oficial ACBr ainda precisa ser inserido pelo processo de distribuição homologado; não há download automático em runtime.
