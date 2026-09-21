# Fiscal Bloco 5 — P10–P13

Este bloco acrescenta operação e guarda documental ao núcleo fiscal já construído nos Blocos 1–4. Ele não altera o fechamento da venda, os movimentos de estoque, os movimentos de caixa nem as regras de reconciliação P8–P9.

## P10 — Monitor fiscal

A tela `Configurações > Fiscal · Documentos` lista documentos por estado (`PENDING`, `PROCESSING`, `AUTHORIZED`, `REJECTED`, `UNKNOWN`, `FAILED`, `CANCELLED`) e mostra venda, tipo, número/série, chave resumida, tentativas e atualização.

As ações são condicionadas ao estado:

- `UNKNOWN`: reconciliar; retry só depois de reconciliação conclusiva `NOT_FOUND`;
- `FAILED`: retry controlado;
- `AUTHORIZED`: visualizar XML, imprimir DANFE e solicitar cancelamento;
- `CANCELLED`: visualizar XML autorizado, XML do cancelamento e reimprimir DANFE marcado como cancelado;
- `REJECTED`: não permite retry do mesmo documento.

A API local exige sessão de gerente/admin para o monitor e suas ações. Caminhos do filesystem fiscal são removidos das respostas públicas; o renderer recebe o conteúdo do XML somente por endpoint autenticado.

## P11 — Cancelamento

O cancelamento é aceito somente para documento `AUTHORIZED`, com chave de acesso e justificativa entre 15 e 255 caracteres. A solicitação é persistida no outbox e processada de forma idempotente pelo efeito `fiscal.cancel-requested`.

Para ACBrMonitor/NFC-e em homologação, o adapter seleciona modelo 65 e usa `NFe.CancelarNFe(chave, justificativa, CNPJ)`.

Somente retorno fiscal confirmado de cancelamento (`cStat` aceito pelo adapter) muda o lifecycle para `CANCELLED`. Rejeição ou falha mantém o documento `AUTHORIZED` e grava `CANCEL_FAILED`. Timeout/resultado indeterminado grava `CANCEL_UNKNOWN` e nunca é tratado como cancelamento concluído.

O cancelamento fiscal não cancela a venda comercial, não devolve estoque e não movimenta caixa.

## P12 — Arquivo XML local

XML autorizado e XML de evento de cancelamento são copiados para um arquivo fiscal local persistente, organizado por ano/mês. A escrita usa arquivo temporário + rename e aplica permissões restritas quando suportadas pelo sistema operacional.

Regras:

- máximo de 8 MiB por XML;
- bloqueio de traversal para fora da raiz fiscal;
- o SQLite mantém apenas o vínculo/caminho interno;
- o renderer não recebe o caminho local;
- leitura de XML ocorre pelo serviço fiscal e API autenticada;
- os arquivos sobrevivem ao restart do PDV.

A estrutura fica pronta para integração posterior ao backup/restore fiscal P22.

## P13 — DANFE NFC-e

O renderer fiscal gera uma representação textual de DANFE NFC-e a partir do documento canônico autorizado e a envia ao `PrintService` já usado pelo PDV. O job é `DANFE_NFCE` e `entityType=fiscal-document`, distinto do cupom não fiscal.

O DANFE inclui emitente, número/série, itens, totais, pagamentos, chave de acesso e protocolo de autorização. Documento cancelado é impresso com marcação explícita de cancelamento. Reimpressão reutiliza o fluxo durável do `PrintService`.

A especificação de layout/QR Code deve continuar acompanhando o Manual de Especificações Técnicas do DANFE NFC-e e QR Code vigente do Portal Nacional da NF-e. A suíte automatizada valida a representação e integração de impressão, mas não substitui validação física de impressora/QR Code nem homologação externa junto à SEFAZ.

## Invariantes mantidos

- falha fiscal não desfaz venda;
- cancelamento fiscal não altera estoque/caixa;
- timeout de emissão continua `UNKNOWN` e exige reconciliação P9;
- retry não cria novo documento fiscal;
- cancelamento duplicado é bloqueado;
- XML e DANFE continuam locais, sem cloud obrigatório;
- Focus continua provider opcional;
- produção ACBr real continua bloqueada até os gates posteriores do roadmap.

## Evidência esperada para fechamento

O Bloco 5 só deve ser considerado concluído quando `npm run verify:release` e o E2E Electron de release estiverem verdes no commit final da branch. Emissão/cancelamento reais na SEFAZ continuam evidência externa (`BLOCKED_EXTERNAL`) até execução em ambiente de homologação autorizado com certificado e credenciais válidos.
