# ArtiSys PDV — roteiro de homologação fiscal do estabelecimento

**Escopo:** Windows x64, ACBrLib OSS local, NF-e (55) e NFC-e (65). Nenhum provedor fiscal pago é necessário. O responsável pelo estabelecimento e seu contador executam as validações legais na SEFAZ; a ArtiSys não precisa receber o certificado, a senha, o CSC nem dados de clientes.

## 1. Preparar a máquina principal

1. Instale a versão candidata Windows fornecida para **homologação**, sem remover o perfil ArtiSys antigo. Confirme que vendas, estoque, impressoras e dados históricos continuam intactos. Terminais de rede não hospedam a emissão fiscal.
2. Inicie o ArtiSys PDV no computador principal com um administrador. Acesse **Configurações → Fiscal — preparação e homologação ACBrLib**. Se a seção não aparecer, não force a instalação de DLLs soltas: use o diagnóstico do pacote e acione o suporte.
3. Preencha razão social, CNPJ, IE, endereço, código do município, UF, CRT e série conforme aprovação da contabilidade. O sistema exige perfis fiscais revisados para cada produto (NCM, CFOP, CSOSN/CST, PIS/COFINS e IBS/CBS conforme o caso). **Não usar valores genéricos sem validação.**
4. Importe, no próprio Windows, o certificado A1 PFX/P12, informe a senha e o CSC/IdCSC **de homologação** para NFC-e. O certificado não é enviado ao suporte, à nuvem nem ao GitHub. Reinicie o aplicativo quando solicitado.
5. Habilite explicitamente **envio somente em homologação** e reinicie novamente. A emissão em produção permanece desativada nesta candidata.

## 2. Executar as provas fiscais

| Prova | Ação do cliente/contador | Evidência esperada |
|---|---|---|
| Preparação | Finalizar venda de teste com item tributário revisado; selecionar NF-e/NFC-e; gerar INI | Documento READY, totais e numeração conferidos |
| Autorização NFC-e (65) | Enviar à homologação da UF após conferir A1 e CSC de testes | XML autorizado com chave de 44 dígitos, cStat 100 e protocolo |
| Autorização NF-e (55) | Fornecer destinatário e endereço completo; emitir em homologação | XML autorizado com chave, modelo, valores e protocolo correspondentes |
| Impressão / DANFE | Gerar DANFE após autorização e salvar PDF pelo diálogo do Windows | PDF válido, referenciando a nota autorizada |
| Rejeição | Exercitar um cenário de rejeição recomendado pelo contador | Status REJECTED sem baixa indevida de estoque e sem envio automático adicional |
| Interrupção / timeout | Simular queda antes da resposta da SEFAZ em ambiente controlado | Status UNKNOWN, somente consulta / conciliação; nunca repetir envio às cegas |
| Cancelamento | Cancelar documento de teste autorizado, dentro do prazo e com justificativa válida | Evento aceito com protocolo e status CANCELLED |
| Inutilização | Fora de SP, conferir com a SEFAZ/contador se o pedido é aplicável e a faixa está realmente não utilizada | Protocolo oficial e status CONFIRMED; em SP o sistema bloqueia pedidos desde 01/11/2026 |
| Instalação / restauração | Reabrir aplicativo e atualizar versão, mantendo o perfil existente | Banco, certificado criptografado, XMLs e numeração preservados |

Para cada prova registre **UF, ambiente, modelo, versão do instalador, data, resultado, cStat, chave/protocolo e eventual mensagem**. Não inclua senha do certificado, CSC, chave privada ou dados pessoais de consumidores em tickets públicos.

## 2.1. CC-e e preparação da contingência

- **Carta de Correção Eletrônica (CC-e), somente NF-e 55 autorizada:** no documento, abrir **Carta de Correção**, inserir texto de 15–1000 caracteres e identificar o contador responsável. A correção não pode mudar valores, impostos, quantidades, datas ou identificação fiscal das partes. Sequência de 1 a 20, sempre crescente; a segunda e posteriores devem consolidar todas as correções anteriores. O evento só fica **CONFIRMED** com protocolo oficial associado à NF-e. Na dúvida/timeout, o evento fica **UNKNOWN** e não deve ser retransmitido sem conciliação.
- **Preparação da NFC-e em contingência:** usar apenas para indisponibilidade real da autorização normal, com justificativa revisada. O sistema prepara INI/XML com **tpEmis=9** e manifesto independente, mas **preparar não é emitir**. Esta implementação não imprime DANFE de contingência nem considera a NFC-e autorizada durante indisponibilidade; a transmissão é manual após restabelecer comunicação. O fluxo completo de emissão offline e impressão com aviso legal necessita testes específicos por UF e não deve ser tratado como operacional sem esses testes.
- **São Paulo (desde 01/11/2026):** a SEFAZ/SP dispensou pedidos de inutilização de números NF-e (55) e NFC-e (65). O sistema bloqueia esses pedidos e mantém a numeração sequencial com registro de lacunas conforme orientação do contador. A regra não é aplicada automaticamente a outras UFs.

Fontes: https://portal.fazenda.sp.gov.br/servicos/nfe e https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Conting%C3%AAncia.aspx

## 3. Regras de segurança

- **UNKNOWN:** não reenvie emissão, cancelamento ou inutilização. Consulte situação oficial e registre a conciliação com a contabilidade. A candidata não implementa reenvio automático de operações indeterminadas.
- O INI de configuração que contém senha e CSC fica no perfil privado do Windows somente durante operações nativas. Mesmo assim, proteja o PC com conta de usuário individual, atualização de segurança e antivírus.
- O módulo é opcional: a ausência de certificado ou ACBrLib íntegra não pode interromper operações comerciais não fiscais.
- Não publicar uma build candidata para todos os clientes apenas porque a suíte automática está verde. Testes de CI sem certificado não comprovam autorização fiscal real por UF.

## 4. Critério de aceite do estabelecimento

O responsável e o contador validam os cenários fiscais aplicáveis à loja, sua UF, seu regime, suas regras de tributação e obrigações de cancelamento/contingência/CC-e. A homologação de uma operação não valida automaticamente outras UFs, regimes ou contingências.

**Produção:** esta candidata mantém o envio fiscal em produção bloqueado. Para liberação de produção é necessária uma atualização explicitamente habilitada para esse ambiente, depois das provas oficiais e da revisão dos cenários fiscais. Não basta alterar o INI de homologação.

## 5. Referências técnicas

- Manual e configuração operacional: `docs/operations/fiscal-acbrlib.md`.
- APIs e evidências: `test/fiscal-acbrlib-preview-api.test.js`, `test/fiscal-acbrlib-issuance.test.js`.
- Fonte oficial da ACBrLib OSS: https://svn.code.sf.net/p/acbr/code/trunk2
- Manual da ACBrLib: https://acbr.sourceforge.io/ACBrLib/ComoemitirumaNFeouNFCe.html