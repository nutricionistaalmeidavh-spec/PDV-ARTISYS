# ArtiSys PDV 1.2.0 — Release checklist

A versão 1.2.0 só é considerada publicável quando todos os gates técnicos abaixo estão comprovados no commit integrado.

- [x] E01–E39 preservadas e integradas ao núcleo local-first.
- [x] E40 catálogo avançado com opções, variações, combos e snapshots imutáveis.
- [x] E41 ficha técnica versionada e baixa idempotente de insumos.
- [x] E42 módulos opcionais persistidos localmente, auditados e bloqueados também no backend.
- [x] E43 Pizzaria isolada do catálogo genérico, com tamanho, sabores, borda e política de preço.
- [x] E44 Restaurante avançado com divisão, taxa de serviço, transferências e cancelamento autorizado.
- [x] E45 Delivery/retirada com venda canônica e roteamento compartilhado para KDS.
- [x] E46 Fast-food com senha diária, venda canônica e KDS compartilhado.
- [x] E47 Mercado/Padaria com itens por peso, etiqueta configurável e encomendas.
- [x] `SaleService` permanece o único motor canônico de conclusão de vendas.
- [x] SQLite permanece autoritativo somente no servidor local.
- [x] Fluxos comerciais E40–E47 usam pagamentos manuais e documentos **NÃO FISCAL**.
- [x] Módulos desativados não aceitam novas mutações específicas e não apagam histórico.
- [ ] `npm run verify` verde no HEAD final de release.
- [ ] `npm run verify:release` verde no HEAD final de release.
- [ ] Windows x64 NSIS gerado no CI a partir do mesmo HEAD.
- [ ] Artefato e manifesto SHA-256 gerados pelo CI.
- [ ] PR revisado/mergeado em `main` sem divergência do HEAD verificado.
- [ ] Gates pós-merge em `main` verdes.
- [ ] GitHub Release `v1.2.0` publicada a partir de `main`.

## Validação externa

Periféricos físicos e formatos específicos de balança permanecem dependentes do equipamento real. Quando o hardware não estiver disponível, o estado correto é `BLOCKED_EXTERNAL`, nunca uma alegação de homologação.

A interface móvel usa HTTP somente em LAN confiável; exposição direta à internet não faz parte do escopo. A versão comercial 1.2.0 é somente **NÃO FISCAL** e não depende de TEF, adquirente, banco, SaaS ou serviço cloud.
