# ArtiSys PDV 1.1 — Release checklist

A versão 1.1 só é considerada publicável quando todos os gates técnicos abaixo estão comprovados no commit que será integrado.

- [x] E01–E20 preservadas e integradas ao núcleo/UI operacional.
- [x] E21 LAN com pareamento, compatibilidade e idempotência.
- [x] E22 backup, validação e restore seguro.
- [x] E23 configurações públicas tipadas com RBAC/auditoria.
- [x] E24 importação CSV/XLSX com preview e commit idempotente.
- [x] E25 health, logs, auditoria e diagnóstico sanitizado.
- [x] E26 `verify:release` com concorrência, recovery e segurança.
- [x] E27 perfis Servidor+Terminal e Terminal sem SQLite no cliente.
- [x] E28 checklist persistente de implantação.
- [x] E29 manifesto, manuais e pipeline de release.
- [x] E30 impressão operacional não fiscal desacoplada do provedor fiscal.
- [x] E31 mesas, comandas, pedidos, transferência e fechamento pela venda canônica.
- [x] E32 setores de produção, KDS e roteamento produto→setor/impressora.
- [x] E33 dispositivo de garçom autenticado na LAN.
- [x] E34 tablet vinculado à mesa com pedido, conta e chamados.
- [x] E35 workspace Restaurante integrado ao desktop Electron.
- [x] E36 interface móvel self-hosted pelo servidor local, sem CDN/SaaS.
- [x] E37 indicadores do restaurante e exportação CSV.
- [x] E38 credenciais derivadas/revogáveis, mutation ID e regressões de LAN/concorrência.
- [x] E39 versão 1.1.0, documentação, capability manifest e gates de release atualizados.
- [ ] `npm run verify` verde no HEAD de release.
- [ ] `npm run verify:release` verde no HEAD de release.
- [ ] Windows x64 NSIS gerado no CI a partir do mesmo HEAD.
- [ ] Artefato e manifesto SHA-256 publicados pelo CI.
- [ ] PR revisado/mergeado em `main` sem divergência do HEAD verificado.
- [ ] Gates pós-merge em `main` verdes.

## Piloto

Cada implantação real usa o checklist interno. `BLOCKED` é bloqueio técnico; `BLOCKED_EXTERNAL` documenta dependência externa ausente e **não** equivale a READY. Fiscal de produção, impressora, gaveta e balança só recebem READY quando validados no ambiente real aplicável.

A operação de restaurante, KDS e dispositivos LAN pertence ao núcleo local. Serviços pagos ou cloud não são pré-requisito para E30–E39. A interface móvel usa HTTP somente em LAN confiável; exposição direta à internet não faz parte do escopo aprovado.
