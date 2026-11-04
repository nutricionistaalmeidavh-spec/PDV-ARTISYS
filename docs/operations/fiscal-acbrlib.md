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


## Continuação de integração — preparação canônica e interface opcional

A implementação atual inclui:

- `server/acbrlib/fiscal-draft-service.js`: extensão SQLite aditiva, carregada
  somente quando a API opcional de laboratório é habilitada. Preserva
  cadastro público da empresa, perfis fiscais revisados por produto,
  sequência e snapshot imutável da venda.
- `server/acbrlib/fiscal-preview-router.js`: API administrativa autenticada
  de configuração, perfis e rascunhos; nega tentativa de transmissão.
- `desktop/renderer/acbrlib-fiscal-preview-ui.js`: cartão de Configurações
  com razão social/CNPJ/IE/CRT/série, perfil por produto (NCM/CEST/CFOP/
  CST/CSOSN/PIS/COFINS/IBS-CBS) e escolha da venda concluída.
- `server/acbrlib/bundle-verifier.js`: verifica SHA-256, origem, formato,
  DLL, worker, dependências, arquitetura Windows x64 e aviso de licença.
- `scripts/fiscal/build-windows-lab.ps1`: constrói o ACBr OSS via SVN,
  Lazarus/FPC e PyInstaller, cria um NSIS **separado** de laboratório
  em `dist-fiscal-lab/`. Não publica Release, não toca em `dist/`.
  
### Ativação do laboratório (sem emissão)

**Por padrão não há endpoint fiscal, migração fiscal, card nem emissão.**
Somente em execução de desenvolvimento, no próprio PC servidor:

```powershell
$env:ARTISYS_FISCAL_PREVIEW='1'
npm start
```

No servidor `server/start.js`, o modo só é permitido no host loopback.
No Electron, só é permitido quando `app.isPackaged === false`;
não pode ser ativado por variável de ambiente no instalador comercial.

Rotas autenticadas, restritas à capacidade `settings.manage`:

```text
GET   /api/v1/fiscal-preview/status
GET   /api/v1/fiscal-preview/company
PUT   /api/v1/fiscal-preview/company
GET   /api/v1/fiscal-preview/products/:productId
PUT   /api/v1/fiscal-preview/products/:productId
GET   /api/v1/fiscal-preview/documents
GET   /api/v1/fiscal-preview/documents/:id
POST  /api/v1/fiscal-preview/sales/:saleId/prepare
POST  /api/v1/fiscal-preview/documents/:id/transmit -> bloqueio 409
```

O motor de venda do PDV continua canônico. O rascunho só aceita uma
venda `COMPLETED`, valida subtotais, descontos alocados por item,
pagamentos menos troco e quantidade com até três casas. Não recalcula
impostos, movimenta estoque, grava pagamento, imprime DANFE ou emite NF.
A mesma venda/tipo/ambiente usa a mesma numeração e documento, inclusive
após reinício. A configuração tributária é revisada pelo operador,
nunca inferida automaticamente.

Testes:

```bash
node --test test/fiscal-acbrlib-oss.test.js test/fiscal-acbrlib-drafts.test.js test/fiscal-acbrlib-preview-api.test.js test/fiscal-acbrlib-bundle.test.js test/fiscal-acbrlib-build-config.test.js
python3 -m unittest discover -s test/python -p 'test_acbrlib_worker.py'
```

### Empacotamento separado de laboratório

No builder Windows x64 com toolchains OSS instaladas:

```powershell
./scripts/fiscal/build-windows-lab.ps1 -Revision 48608
```

O processo falha se faltar fonte, DLL, worker, dependência ou hash.
O instalador comercial padrão permanece **sem recursos fiscais**, e
o pacote de laboratório também **não habilita** emissão no Electron
empacotado. É apenas verificação de distribuição, sujeito a smoke
Windows e QA físico. O build nativo de verdade ainda não foi
comprovado em CI/hardware.

### Pendências reais de emissão

Ainda falta integrar o rascunho revisado a um gerador de INI tributário
completo e validado contra os schemas vigentes, certificado A1/CSC,
emissão/resposta da ACBrLib no runtime, reconciliação e cancelamento,
DANFE, contingência e evidência de autorização real da SEFAZ.
Sem isso, a emissão fiscal permanece **indisponível**, mesmo com dados
e rascunhos preenchidos. Nenhum serviço pago é dependência do core.


## Etapas 2 e 3: compilador ACBr e homologação local (04/11/2026)

Foram acrescentados o compilador server/acbrlib/fiscal-ini-builder.js
e o coordenador server/acbrlib/fiscal-issuance-service.js. Eles
permitem preparar INI e manifesto vinculados à venda e acionar a
ACBrLib para assinatura e envio em homologação, quando habilitados
explicitamente. **Não houve autorização real da SEFAZ neste trabalho.**

### Perfil tributário coberto inicialmente

- Venda interna de mercadoria: CFOP 5102.
- Emitente Simples Nacional, CSOSN 102, PIS e COFINS CST 49; o
  tratamento sem valores de ICMS/PIS/COFINS exige confirmação
  expressa da contabilidade.
- Reforma tributária: códigos IBS/CBS CST 000 e cClassTrib informado,
  alíquotas IBS UF, IBS município e CBS fornecidas e revisadas.
  Os valores por item são calculados a partir do total líquido
  da venda, em centavos, sem taxas padrão presumidas.
- Emitente precisa ter endereço completo e código IBGE municipal
  coerente com UF. NF-e modelo 55 exige destinatário completo.
  NFC-e modelo 65 pode ser preparada sem destinatário identificado.
- Meios aceitos nesta versão: dinheiro e PIX. Cartões, crédito de loja,
  crédito fiscal, ICMS ST, tributação especial, operações
  interestaduais e outros cenários não mapeados são bloqueados.

Este escopo é propositalmente estreito: não converter todos os itens
para CSOSN 102 ou IBS/CBS CST 000 por padrão. Cada cenário adicional
precisa de mapeamento e validação contábil.

### Fluxo HTTP disponível somente em desenvolvimento

1. POST /api/v1/fiscal-preview/sales/:id/prepare — snapshot e numeração
   idempotentes da venda concluída, sem estoque/caixa adicionais.
2. POST /api/v1/fiscal-preview/documents/:id/compile — gera INI ACBr
   e manifesto com SHA-256, CNPJ, modelo, número, série e cNF.
3. POST /api/v1/fiscal-preview/documents/:id/transmit — grava
   estado UNKNOWN antes do worker e solicita envio à SEFAZ somente
   em homologação explicitamente habilitada.
4. POST /api/v1/fiscal-preview/documents/:id/consult — consulta
   pela chave do XML assinado sem retransmitir a nota.

O retorno da autorização é confrontado com chave e DV, emitente,
ambiente, modelo, número/série, cNF, total, assinatura, cStat e
protocolo. A resposta desconhecida não dispara reenvio. A mesma venda
não pode gerar NFC-e e NF-e simultaneamente.

### Configuração manual de teste

O operador deve compilar ou instalar localmente bibliotecas ACBr OSS,
configurar certificado/CSC no INI privado da ACBrLib (fora do banco
e do controle de versão) e definir as variáveis seguintes no PC de
desenvolvimento Windows, ajustando os caminhos reais:

    ARTISYS_FISCAL_PREVIEW=1
    ARTISYS_ACBR_INPUT_DIR=C:\ArtiSys-Privado\Fiscal\input
    ARTISYS_ACBR_NFE_DLL=C:\ArtiSys-OSS\ACBrNFe64.dll
    ARTISYS_ACBR_WORKER_EXE=C:\ArtiSys-OSS\acbrlib-worker.exe
    ARTISYS_ACBR_CONFIG_INI=C:\ArtiSys-Privado\ACBrLibNFe.ini
    ARTISYS_ACBR_HOMOLOGATION=1

O modo não funciona no Electron empacotado e o servidor standalone
somente admite host loopback. Certificado, senha e CSC não devem
ser registrados no Git, enviados pela API ou gravados em logs.

### Pendências para considerar concluída a etapa 3

- Build real da DLL/worker em Windows e smoke test do instalador.
- Certificado A1/CSC e credenciamento válido do cliente para sua UF.
- Validação XML/schema e notas técnicas vigentes pelo ACBr e SEFAZ,
  autorização real, rejeição, consulta e teste de internet interrompida.
- DANFE, cancelamento, contingência e configuração de certificado
  na interface final do PDV.

Os testes automatizados usam um worker simulado e não substituem
respostas reais da SEFAZ. Main e clientes instalados não são alterados.
Nenhum serviço pago é dependência do módulo local.
