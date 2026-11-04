# Fiscal ACBrLib OSS — adaptação da Oficina ao PDV

## Estado do trabalho

Branch experimental, baseada em `main`: `feat/fiscal-acbrlib-oss-oficina`.
**Não ativa emissão fiscal no PDV, não altera tabelas de vendas e não é distribuída aos clientes.**
O `main` atual deliberadamente não possui runtime fiscal (E20). Esta entrega prepara e testa
a ponte nativa, mas não restabelece sozinha rotas fiscais, migrações, UI ou autoemissão.

Origem adaptada: `OficinaAgricola/src/platform/acbrlib-worker.py` e scripts de build
do ArtiSys Oficina. O worker invoca diretamente a **ACBrLib NFe** compilada dos fontes
open source: não usa ACBrMonitorPLUS, Focus, SaaS, token pago nem API comercial.

## Comportamento implementado

- `server/acbrlib/acbrlib-adapter.js`: ponte CommonJS para NFC-e modelo 65 e NF-e
  modelo 55; por padrão `configured=false`.
- `server/acbrlib/acbrlib-worker.py`: executor nativo `ctypes` portado da Oficina.
  Requer XML assinado, total em centavos, emitente, ambiente, modelo e protocolo oficial
  coerentes antes de devolver autorização; grava o XML assinado antes do envio.
- Requisição exige um manifesto `<reference>.json` e um INI tributário
  `<reference>.ini` no mesmo diretório privado, cujo SHA-256 precisa bater.
  O snapshot da venda recebido deve corresponder integralmente ao manifesto.
- Após gravar `<reference>.signed.xml`, a ponte **não retransmite cegamente**:
  somente permite consulta/reconciliação. Timeout/retorno incompleto é indeterminado.
- Cancelamento nativo, contingência e produção continuam bloqueados. Emissão
  legal depende de homologação, regras tributárias atualizadas e credenciais
  próprias do contribuinte.

## Contrato do adaptador

```js
const {createAcbrLibAdapter}=require('./server/acbrlib/acbrlib-adapter');
const adapter=createAcbrLibAdapter({
  inputDir:'C:\\Users\\Operador\\AppData\\Local\\ArtiSys\\PDV\\fiscal\\entrada',
  nfeLib:'C:\\ACBrOSS\\ACBrNFe64.dll',
  nfeConfig:'C:\\Users\\Operador\\AppData\\Local\\ArtiSys\\PDV\\fiscal\\ACBrLibNFe.ini',
  workerExe:'C:\\ACBrOSS\\acbrlib-worker.exe'
  // productionDisabled por padrão. Não habilitar sem evidência SEFAZ.
});
const result=await adapter.issue({
  type:'nfce',
  reference:'sale-123',
  environment:'homologation',
  payload:{document:{...canonicalFiscalManifest}}
});
```

Manifesto local esperado, após construir documento fiscal da venda concluída:

```json
{
  "reference": "sale-123",
  "documentType": "nfce",
  "snapshotHash": "<sha256 da venda imutável>",
  "amountCents": 1250,
  "issuerCnpj": "12345678000195",
  "environment": "homologation",
  "model": 65,
  "lot": 123,
  "iniSha256": "<sha256 do arquivo sale-123.ini revisado>"
}
```

Os campos acima não substituem o INI ACBr com grupos tributários completos. **Não**
gerar NCM, CFOP, CST, CSOSN, IBS/CBS ou alíquotas por inferência. A biblioteca
não deve receber dados genéricos ou fictícios.

## Compilação livre — apenas no builder Windows

A base da Oficina foi preservada em `scripts/fiscal/build-acbr-native.ps1` e
`scripts/fiscal/stage-fiscal-bundle-reference.mjs`. É preciso validar a revisão
SVN pinada e as licenças das dependências ao compilar. Exemplo de build isolado:

```powershell
# Executar da raiz do repositório PDV. Ferramentas OSS no computador de BUILD:
# Git, SVN, Lazarus/FPC, Python 3 e PyInstaller.
./scripts/fiscal/build-acbr-native.ps1 -Revision 48608
python -m PyInstaller --noconfirm --clean --onefile --console --name acbrlib-worker --distpath build/fiscal-worker --workpath build/pyinstaller-tmp --specpath build/pyinstaller-src server/acbrlib/acbrlib-worker.py
node scripts/fiscal/stage-fiscal-bundle-reference.mjs
```

**Atenção:** o pacote gerado em `build/fiscal` ainda NÃO é incluído
automaticamente no instalador PDV. Incorporá-lo somente depois de testes
Windows x64 em instalação limpa, smoke de DLL, compliance de licenças,
integração com o fiscal canônico e homologação externa. Nunca empacotar
certificado, senha, CSC, token ou XML do cliente.

## Testes

```bash
node --test test/fiscal-acbrlib-oss.test.js
python3 -m unittest test/python/test_acbrlib_worker.py
npm run verify
```

O teste Node usa runner simulado apenas para validar isolamento e invariantes;
não é uma evidência de emissão real. O teste Python verifica parser e regras
locais sem DLL real. A autorização externa deve ser comprovada em ambiente
de homologação, com certificado A1, CSC, configuração por UF, cancelamento,
XML autorizado, DANFE e reconciliação reais.

## Pendências para uma entrega comercial fiscal

1. Reconciliar migrações e serviços fiscais históricos com o runtime `main`
   atual, sem apagar dados ou duplicar movimentações de venda, caixa e estoque.
2. Produzir INI fiscal canônico a partir do snapshot de venda e perfil fiscal
   revisado, com estado de emissão, numeração e idempotência no SQLite.
3. Implementar habilitação por estabelecimento, administração segura do A1/CSC
   e configurações tributárias, monitor de eventos e DANFE.
4. Integrar e testar o bundle do Windows instalado; auditar licenças e
   suprir código-fonte/avisos obrigatórios de componentes LGPL.
5. Executar e registrar homologação real NFC-e por UF e NF-e modelo 55,
   incluindo consulta após timeout, cancelamento, contingência e rejeições.

O PDV continua operando e imprimindo **NÃO FISCAL** até que esses itens sejam
concluídos. O core permanece R$ 0, local-first e sem API fiscal paga obrigatória.

Fontes: https://projetoacbr.com.br/fontes/ e
https://acbr.sourceforge.io/ACBrLib/BemVindo.html
