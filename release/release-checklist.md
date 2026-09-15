# ArtiSys PDV 1.3.2 — Release checklist

A versão 1.3.2 só é considerada publicável quando todos os gates técnicos abaixo estão comprovados no mesmo HEAD.

- [x] E01–E54 e E54.1 preservadas e integradas ao núcleo local-first.
- [x] `SaleService` permanece o motor canônico de conclusão de vendas.
- [x] SQLite permanece autoritativo somente no servidor local.
- [x] Pagamentos permanecem manuais e documentos comerciais permanecem **NÃO FISCAL**.
- [x] Observação interna da venda limitada a 500 caracteres e persistida junto da venda.
- [x] Impressão da observação permanece opcional e desmarcada por padrão.
- [x] Observação impressa limitada a 120 caracteres e no máximo 4 linhas.
- [x] Cupom mantém suporte às larguras 32/42/48 colunas.
- [x] Reimpressão usa a observação persistida da venda.
- [x] Pacote mantém `productName` = `ArtiSys PDV` e artefato `ArtiSys-PDV-1.3.2-x64-Setup.exe`.
- [x] E54.1 inclui harness de simulação reproduzível para periféricos.
- [x] Matriz usa `PROTOCOL_VERIFIED`, `FIELD_VERIFIED` e `UNTESTED_MODEL` sem confundir CI com teste físico.
- [ ] `npm run verify` verde no HEAD final de release.
- [ ] `npm run verify:release` verde no HEAD final de release.
- [ ] Windows x64 NSIS gerado localmente ou no CI a partir do mesmo HEAD.
- [ ] Instalador `ArtiSys-PDV-1.3.2-x64-Setup.exe` aberto e validado sem tela preta.
- [ ] Artefato e manifesto SHA-256 gerados a partir do mesmo HEAD.
- [ ] Branch revisada/mergeada em `main` sem divergência do HEAD verificado.
- [ ] Gates pós-merge em `main` verdes quando executados.
- [ ] GitHub Release `v1.3.2` publicada quando houver decisão de publicação formal.

## Validação física

A CI pode validar protocolo, recuperação, framing, parser e contratos do driver, mas não substitui eletrônica, firmware, cabo e driver do equipamento real.

- protocolo coberto pela suíte: `PROTOCOL_VERIFIED`;
- modelo específico ainda não testado fisicamente: `UNTESTED_MODEL`;
- fabricante/modelo testado em campo com evidência: `FIELD_VERIFIED`.

Esse modelo permite comercializar compatibilidade por protocolo sem alegar homologação física inexistente.

A interface móvel continua em HTTP somente em LAN confiável e não é apresentada como HTTPS/PWA. A versão comercial continua somente **NÃO FISCAL** e sem TEF, adquirente, banco, SaaS ou serviço cloud obrigatório.
