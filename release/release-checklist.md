# ArtiSys PDV 1.3.1 — Release checklist

A versão 1.3.1 só é considerada publicável quando todos os gates técnicos abaixo estão comprovados no mesmo HEAD.

- [x] E01–E54 preservadas e integradas ao núcleo local-first.
- [x] `SaleService` permanece o único motor canônico de conclusão de vendas.
- [x] SQLite permanece autoritativo somente no servidor local.
- [x] Pagamentos permanecem manuais e documentos comerciais permanecem **NÃO FISCAL**.
- [x] E54.1 inclui harness de simulação reproduzível para periféricos.
- [x] Falha de escrita serial força estado recuperável e nova abertura reconstrói a porta.
- [x] COM ocupada/inexistente é tratada sem travar o processo e permite tentativa posterior.
- [x] Balança cobre resposta fragmentada, ponto/vírgula, lixo, timeout e retry.
- [x] Epson/Star cobrem acentos, corte, gaveta e larguras 32/42/48 em simulação.
- [x] Spooler Electron/Windows cobre offline e recuperação posterior.
- [x] Leitor `keyboard-wedge` cobre leituras repetidas e código inválido.
- [x] Gaveta serial cobre falha, fechamento e pulso posterior bem-sucedido.
- [x] Stress serial executa ciclos repetidos sem deixar porta aberta.
- [x] Matriz usa `PROTOCOL_VERIFIED`, `FIELD_VERIFIED` e `UNTESTED_MODEL` sem confundir CI com teste físico.
- [x] `FIELD_VERIFIED` exige evidência de modelo físico realmente testado.
- [ ] `npm run verify` verde no HEAD final de release.
- [ ] `npm run verify:release` verde no HEAD final de release.
- [ ] Windows x64 NSIS gerado no CI a partir do mesmo HEAD.
- [ ] Artefato e manifesto SHA-256 gerados pelo CI.
- [ ] PR revisado/mergeado em `main` sem divergência do HEAD verificado.
- [ ] Gates pós-merge em `main` verdes.
- [ ] GitHub Release `v1.3.1` publicada a partir de `main`.

## Validação física

A CI pode validar protocolo, recuperação, framing, parser e contratos do driver, mas não substitui eletrônica, firmware, cabo e driver do equipamento real.

- protocolo coberto pela suíte: `PROTOCOL_VERIFIED`;
- modelo específico ainda não testado fisicamente: `UNTESTED_MODEL`;
- fabricante/modelo testado em campo com evidência: `FIELD_VERIFIED`.

Esse modelo permite comercializar compatibilidade por protocolo sem alegar homologação física inexistente.

A interface móvel continua em HTTP somente em LAN confiável e não é apresentada como HTTPS/PWA. A versão comercial continua somente **NÃO FISCAL** e sem TEF, adquirente, banco, SaaS ou serviço cloud obrigatório.
