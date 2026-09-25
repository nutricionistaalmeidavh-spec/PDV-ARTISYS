# ArtiSys Telemetry + Cloudflare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar telemetria opt-in, privacy-first e fail-open ao ArtiSys, com fila SQLite local, eventos semânticos, diagnóstico/fingerprints e coletor serverless em Cloudflare Workers + Analytics Engine + D1, sem tornar a nuvem requisito operacional do PDV.

**Architecture:** O cliente ArtiSys expõe um serviço de telemetria independente de fornecedor que valida eventos por allowlist, persiste batches em SQLite e envia por HTTPS fora do caminho crítico. Eventos de negócio são derivados do EventBus durável existente e eventos de UI passam por IPC estreito; o Worker revalida/sanitiza, envia o stream de alta cardinalidade ao Analytics Engine e usa D1 somente para cadastro de instalações, credenciais hashadas, fingerprints e receipts idempotentes de baixo volume.

**Tech Stack:** Node.js >=22, CommonJS no core/desktop, `node:test`, `node:crypto`, SQLite (`node:sqlite` via abstração existente), Electron 39 `safeStorage`, Cloudflare Workers, D1, Workers Analytics Engine, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-25-telemetry-cloudflare-design.md`

## Global Constraints

- Telemetria fica `false` por padrão e upgrades não podem ativá-la silenciosamente.
- Venda, devolução, impressão, fiscal, estoque, restaurante, login e startup devem funcionar quando internet/Worker/D1/Analytics Engine estiverem indisponíveis.
- Core obrigatório permanece local/self-hosted/open; Cloudflare é destino opcional e configurável, nunca dependência silenciosa.
- Endpoint padrão em source/dev é vazio; build oficial pode injetar `PDV_TELEMETRY_ENDPOINT` explicitamente.
- Renderer não recebe SQLite, filesystem, credencial de ingestão nem `safeStorage`.
- Credencial de telemetria fica separada das credenciais de login/LAN/fiscal e é persistida com `safeStorage`.
- Nenhum evento pode conter nome de cliente/operador, CPF/CNPJ, telefone, e-mail, endereço, observação livre, XML/DANFE, PAN/CVV, senha, token, Authorization, certificado, CSC ou segredo equivalente.
- Identificadores de telemetria são aleatórios e não derivados de MAC, hostname, usuário do Windows, documento fiscal ou serial de hardware.
- Fila local: máximo padrão de 5.000 eventos; batch padrão de 50; erros/diagnósticos têm prioridade de retenção sobre eventos de fluxo.
- Delivery é at-least-once; somente mutações D1 de erro/controle usam receipt dedupe por `event_id`.
- D1 não armazena o stream geral de cliques/eventos; Analytics Engine é o destino de alta cardinalidade.
- Testes normais/CI não dependem de conta Cloudflare real.

## Review Focus

1. **Payload aparentemente válido contendo PII/segredo em chave ou string:** cliente e Worker devem rejeitar/sanitizar sem persistir o valor proibido.
2. **Worker lento/fora do ar durante uma venda:** a operação de negócio deve concluir normalmente; somente a fila/retry de telemetria muda.
3. **401/403 por credencial expirada/revogada:** envio pausa e registro é tentado apenas em ciclo de background; não pode criar loop agressivo nem bloquear UI.
4. **SQLite cheio/erro ao gravar telemetria:** `record()` deve engolir a falha de telemetria, logar de forma limitada e nunca falhar o fluxo chamador.
5. **Mesmo erro entregue mais de uma vez:** Analytics pode receber duplicata at-least-once, mas contadores D1/fingerprint não podem duplicar a mesma mutação pelo mesmo `event_id`.

---

## Mapa de arquivos

### Criar

- `js/core/telemetry/telemetry-events.js` — catálogo/schema allowlisted de eventos.
- `js/core/telemetry/telemetry-sanitizer.js` — validação de campos/valores e limites.
- `js/core/telemetry/telemetry-fingerprint.js` — normalização técnica e hash estável.
- `js/core/telemetry/telemetry-queue.js` — fila SQLite limitada e prioridade/retry.
- `js/core/telemetry/telemetry-service.js` — fachada `record/flush/status/setEnabled/close`.
- `js/core/telemetry/telemetry-effects.js` — adaptação do EventBus para eventos semânticos de telemetria.
- `desktop/telemetry-credentials.cjs` — credencial de ingestão em `safeStorage`.
- `desktop/telemetry-identity.cjs` — IDs aleatórios de instalação/terminal persistidos em `userData`.
- `desktop/telemetry-bridge.cjs` — registro/bootstrap, sender HTTPS, IPC estreito e worker de flush.
- `test/telemetry-schema.test.js`.
- `test/telemetry-queue.test.js`.
- `test/telemetry-service.test.js`.
- `test/telemetry-effects.test.js`.
- `test/telemetry-desktop.test.js`.
- `test/telemetry-settings-ui.test.js`.
- `cloudflare/telemetry/package.json`.
- `cloudflare/telemetry/wrangler.jsonc`.
- `cloudflare/telemetry/src/schema.js`.
- `cloudflare/telemetry/src/auth.js`.
- `cloudflare/telemetry/src/storage.js`.
- `cloudflare/telemetry/src/index.js`.
- `cloudflare/telemetry/migrations/0001_init.sql`.
- `cloudflare/telemetry/test/worker.test.js`.
- `cloudflare/telemetry/README.md`.
- `scripts/setup-cloudflare-telemetry.mjs`.
- `docs/operations/telemetry.md`.

### Modificar

- `js/core/pdv-runtime.js` — compor/expor `runtime.telemetry` e registrar telemetry effects.
- `desktop/main.cjs` — inicializar identity/credential/sender/background flush e shutdown best-effort.
- `desktop/preload.cjs` — namespace estreito `telemetry` para status/record UI-only.
- `desktop/renderer/api-client.js` — helpers de configuração pública.
- `desktop/renderer/admin-ops.js` — cartão Privacidade e Diagnóstico.
- `desktop/renderer/app.js` — `screen_opened` nos limites de navegação já existentes.
- `server/router.js` — endpoint autenticado de status/configuração somente se necessário para UI; preferir `settings` existente para toggle.
- `server/start.js` — endpoint configurável no modo servidor por `PDV_TELEMETRY_ENDPOINT` sem obrigatoriedade.
- `package.json` — scripts/lints e `telemetry:cloudflare:setup`.
- `README.md` — referência operacional e natureza opcional.
- `release/release-notes.md` — release note da telemetria opt-in.

---

### Task 1: Schema allowlisted, sanitizer e fingerprint

**Files:**
- Create: `js/core/telemetry/telemetry-events.js`
- Create: `js/core/telemetry/telemetry-sanitizer.js`
- Create: `js/core/telemetry/telemetry-fingerprint.js`
- Test: `test/telemetry-schema.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateTelemetryEvent(eventName, payload) -> {dimensions,measurements}`.
- Produces: `sanitizeTelemetryEnvelope(envelope) -> sanitizedEnvelope`.
- Produces: `normalizeErrorSignature({errorClass,subsystem,operation,stack}) -> string`.
- Produces: `fingerprintError(input) -> "ERR-<hex>"`.
- Event names iniciais: `app_started`, `app_closed`, `screen_opened`, `sale_started`, `sale_completed`, `sale_failed`, `return_started`, `return_completed`, `return_failed`, `printer_failed`, `fiscal_failed`, `database_failed`, `network_failed`, `operation_failed`.

- [ ] **Step 1: Write failing schema/privacy tests**

Adicionar testes que provem:
- evento desconhecido é rejeitado;
- campo desconhecido em `dimensions`/`measurements` é rejeitado;
- chaves contendo `token`, `authorization`, `password`, `cpf`, `cnpj`, `email`, `phone`, `address`, `xml`, `danfe`, `card`, `cvv`, `observation` são rejeitadas;
- strings acima do limite definido são rejeitadas/truncadas conforme o schema, nunca aceitas livremente;
- fingerprint não muda quando UUID, caminho `C:\Users\...` ou números dinâmicos mudam;
- fingerprint muda quando `subsystem`/`operation`/classe técnica muda.

- [ ] **Step 2: Run RED**

Run: `node --test test/telemetry-schema.test.js`

Expected: FAIL por módulos ausentes.

- [ ] **Step 3: Implement schemas mínimos e allowlist**

Implementar `EVENT_SCHEMAS` com conjuntos explícitos de dimensões/medições por evento. Não aceitar objetos arbitrários nem payload recursivo.

- [ ] **Step 4: Implement sanitizer/fingerprint**

Usar `node:crypto.createHash('sha256')`; remover UUIDs, sequências numéricas dinâmicas, caminhos de perfil de usuário e fragments fora da allowlist antes do hash. Prefixar fingerprint com `ERR-` e usar representação hexadecimal curta estável.

- [ ] **Step 5: Verify GREEN + syntax**

Run: `node --test test/telemetry-schema.test.js && node --check js/core/telemetry/telemetry-events.js && node --check js/core/telemetry/telemetry-sanitizer.js && node --check js/core/telemetry/telemetry-fingerprint.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/core/telemetry test/telemetry-schema.test.js package.json
git commit -m "feat(telemetry): add privacy-safe event schemas"
```

---

### Task 2: Fila SQLite limitada e serviço fail-open

**Files:**
- Create: `js/core/telemetry/telemetry-queue.js`
- Create: `js/core/telemetry/telemetry-service.js`
- Test: `test/telemetry-queue.test.js`
- Test: `test/telemetry-service.test.js`
- Modify: `js/core/pdv-runtime.js`

**Interfaces:**
- Produces: `createTelemetryQueue({db,now,maxPending=5000})` com `enqueue`, `listReady`, `ack`, `discard`, `reschedule`, `count`, `prune`.
- Produces: `createTelemetryService({db,settings,logger,now,idFactory,httpSender,identity,appVersion,releaseId,schemaVersionResolver,credentialProvider})`.
- Service: `record(eventName,payload)`, `flush()`, `status()`, `setEnabled(enabled,actor)`, `close()`.
- `record()` é síncrono/best-effort e nunca lança para o chamador.
- `flush()` retorna resumo `{attempted,sent,retryable,discarded,paused}`.

- [ ] **Step 1: Write failing queue tests** para persistência após restart, limite de 5.000, prioridade de erros, seleção por `next_attempt_at` e remoção após ACK.
- [ ] **Step 2: Run RED** com `node --test test/telemetry-queue.test.js`.
- [ ] **Step 3: Implement queue** criando `telemetry_events` idempotentemente e índices para pendentes/retry; malformed rows são descartadas com logger sanitizado.
- [ ] **Step 4: Write failing service tests** para disabled-by-default, `record()` fail-open em erro SQLite, batch 50, backoff/jitter, `400/413/422` discard, `401/403` pause, `429/5xx` retry.
- [ ] **Step 5: Run RED** com `node --test test/telemetry-service.test.js`.
- [ ] **Step 6: Implement service mínimo** sem timer interno: timers/background ficam no desktop/server host; serviço só expõe `flush()` e estado.
- [ ] **Step 7: Compose in `createPdvRuntime()`** expondo `runtime.telemetry`; defaults `telemetry.enabled=false`, `telemetry.diagnostics=false`, `telemetry.endpoint=''`, `telemetry.batchSize=50`. Runtime sem sender/endpoint continua totalmente funcional.
- [ ] **Step 8: Verify focused suite**

Run: `node --test test/telemetry-queue.test.js test/telemetry-service.test.js test/pdv-runtime.integration.test.js`

Expected: PASS e nenhum fluxo de negócio depende de telemetria.

- [ ] **Step 9: Commit** `feat(telemetry): add durable fail-open queue and service`.

---

### Task 3: Eventos semânticos via EventBus

**Files:**
- Create: `js/core/telemetry/telemetry-effects.js`
- Test: `test/telemetry-effects.test.js`
- Modify: `js/core/pdv-runtime.js`

**Interfaces:**
- Produces: `registerTelemetryEffects({bus,telemetry}) -> unsubscribe[]`.
- Consumes `PDV_EVENT_TYPES` e `DomainEventBus.subscribe()` existentes.
- Mapeamentos iniciais obrigatórios:
  - `SALE_OPENED -> sale_started`;
  - `SALE_COMPLETED -> sale_completed`;
  - `RETURN_COMPLETED -> return_completed`;
  - `RECEIPT_FAILED -> printer_failed`;
  - `FISCAL_FAILED|FISCAL_REJECTED|FISCAL_UNKNOWN -> fiscal_failed` com dimensão de estado técnico allowlisted.

- [ ] **Step 1: Write failing effect tests** provando que payload de domínio não é repassado inteiro e que `actor.userId`, produto, cliente, valores livres e IDs comerciais não entram no envelope.
- [ ] **Step 2: Add Review Focus test:** fazer `telemetry.record()` lançar artificialmente e provar que `runtime.dispatchPending()`/efeitos de negócio continuam concluindo sem tornar o outbox de domínio falho por causa de observabilidade.
- [ ] **Step 3: Run RED** `node --test test/telemetry-effects.test.js`.
- [ ] **Step 4: Implement adapters** lendo somente contagens/status/módulo/duração quando os campos são explicitamente seguros; não usar spread de `event.payload`.
- [ ] **Step 5: Register effects after telemetry creation** no runtime.
- [ ] **Step 6: Verify** `node --test test/telemetry-effects.test.js test/pdv-runtime.integration.test.js`.
- [ ] **Step 7: Commit** `feat(telemetry): observe semantic domain events`.

---

### Task 4: Identidade, credencial segura, bootstrap e flush no Electron

**Files:**
- Create: `desktop/telemetry-identity.cjs`
- Create: `desktop/telemetry-credentials.cjs`
- Create: `desktop/telemetry-bridge.cjs`
- Test: `test/telemetry-desktop.test.js`
- Modify: `desktop/main.cjs`
- Modify: `desktop/preload.cjs`
- Modify: `server/start.js`
- Modify: `package.json`

**Interfaces:**
- `createTelemetryIdentityStore({filePath,randomUUID})` -> `loadOrCreate()` retornando `{installationId,terminalId}`; IDs são UUIDs aleatórios e arquivo não contém PII.
- `createTelemetryCredentialStore({app,safeStorage})` -> `save`, `load`, `remove`, `status`; arquivo dedicado `telemetry-credential.bin`.
- `createTelemetryHttpSender({endpoint,credentialStore,fetchImpl,registerInstallation,timeoutMs})` -> `sendBatch(batch)`.
- Registration: `POST /v1/installations/register` somente depois de opt-in e quando não houver credencial.
- IPC preload: `artisysDesktop.telemetry.status()` e `artisysDesktop.telemetry.recordUi(eventName,payload)`; não expor segredo/endpoint privado.

- [ ] **Step 1: Write failing desktop tests** para persistência de IDs, `safeStorage` obrigatório, credential nunca em plaintext e endpoint vazio = nenhuma request.
- [ ] **Step 2: Write failing bootstrap tests**: registro envia somente `installation_id`, versão/release/schema/protocolo; falha de registro retorna estado offline sem lançar para runtime.
- [ ] **Step 3: Run RED** `node --test test/telemetry-desktop.test.js`.
- [ ] **Step 4: Implement stores e sender** com `AbortController`/timeout curto e credential Bearer somente no main process.
- [ ] **Step 5: Integrate main/server hosts**: endpoint vem de `PDV_TELEMETRY_ENDPOINT` ou setting explícito; criar timer de flush desacoplado e `unref()` quando disponível; shutdown faz best-effort curto e fecha runtime independentemente do resultado.
- [ ] **Step 6: Add Review Focus tests** para timeout, 401/403, falha de `safeStorage`, falha de escrita da fila e shutdown com endpoint indisponível.
- [ ] **Step 7: Verify syntax + tests**.
- [ ] **Step 8: Commit** `feat(telemetry): add protected desktop transport`.

---

### Task 5: Opt-in e eventos de navegação na UI

**Files:**
- Modify: `desktop/renderer/admin-ops.js`
- Modify: `desktop/renderer/api-client.js`
- Modify: `desktop/renderer/app.js`
- Test: `test/telemetry-settings-ui.test.js`

**Interfaces:**
- UI em **Configurações > Privacidade e Diagnóstico** dentro do control center existente.
- Toggle principal persiste `telemetry.enabled` via `settings.set`; toggle diagnóstico persiste `telemetry.diagnostics`.
- Texto obrigatório deixa explícito que não são enviados clientes, documentos, credenciais, XML fiscal, cartão nem conteúdo de venda.
- `screen_opened` usa somente identificador de rota allowlisted, nunca query de busca nem texto digitado.

- [ ] **Step 1: Write failing static/DOM contract tests** comprovando toggle default off, copy de privacidade, uso de `api.saveSetting('telemetry.enabled',...)` e ausência de exposição de credential.
- [ ] **Step 2: Write navigation test** provando que `screen_opened` recebe apenas nome normalizado da rota e que pesquisa/ID de entidade não vai no evento.
- [ ] **Step 3: Run RED**.
- [ ] **Step 4: Implement card em `admin-ops.js`** reutilizando `settings()`/`saveSetting()` existentes; não criar endpoint administrativo novo se o SettingsService já cobre RBAC.
- [ ] **Step 5: Wire renderer IPC estreito** para evento de tela; falha é ignorada/bounded warning.
- [ ] **Step 6: Verify** `node --test test/telemetry-settings-ui.test.js` e testes renderer relacionados.
- [ ] **Step 7: Commit** `feat(telemetry): add privacy controls and screen flow events`.

---

### Task 6: Worker Cloudflare, D1 e Analytics Engine

**Files:**
- Create: `cloudflare/telemetry/package.json`
- Create: `cloudflare/telemetry/wrangler.jsonc`
- Create: `cloudflare/telemetry/src/schema.js`
- Create: `cloudflare/telemetry/src/auth.js`
- Create: `cloudflare/telemetry/src/storage.js`
- Create: `cloudflare/telemetry/src/index.js`
- Create: `cloudflare/telemetry/migrations/0001_init.sql`
- Create: `cloudflare/telemetry/test/worker.test.js`

**Interfaces:**
- `GET /health -> 200 {ok:true,schemaVersion:1}` sem segredos.
- `POST /v1/installations/register` aceita body limitado e devolve `{installation_id,credential}` uma vez; D1 armazena somente hash.
- `POST /v1/events` requer `Authorization: Bearer ...`, máximo 50 eventos/batch inicialmente e request-size bounded.
- Bindings: `DB` (D1) e `ANALYTICS` (Analytics Engine).
- Funções puras exportáveis para testes: `validateRegistration`, `validateBatch`, `hashCredential`, `handleRequest`.

- [ ] **Step 1: Write failing Worker tests** para health, content-type, tamanho, schema, auth, sanitização server-side, evento válido e erro interno = 500 (nunca 400/401 mascarado).
- [ ] **Step 2: Add Review Focus duplicate test**: mesmo `event_id` de `fiscal_failed` duas vezes atualiza fingerprint D1 uma vez; flow event duplicado não cria receipt D1.
- [ ] **Step 3: Add affected-installation test**: primeira combinação `(fingerprint,installation)` incrementa `affected_installations`; repetição da mesma instalação não incrementa.
- [ ] **Step 4: Run RED** dentro de `cloudflare/telemetry`: `npm test`.
- [ ] **Step 5: Implement migration** com `installations`, `error_fingerprints`, `error_fingerprint_installations`, `event_receipts` e índices/constraints necessários.
- [ ] **Step 6: Implement auth/registration** usando segredo aleatório >=32 bytes e SHA-256/HMAC apropriado para representação persistida; plaintext só existe na resposta inicial e no cliente protegido.
- [ ] **Step 7: Implement ingestion**: validar novamente por allowlist, escrever datapoint no `ANALYTICS`, atualizar `installations.last_seen_at`; somente eventos de erro/controle mutam tabelas agregadas/receipts.
- [ ] **Step 8: Implement maintenance** para remover `event_receipts` antigos e documentar retenção inicial de 30 dias; não deletar dados de erro necessários para análise sem política explícita.
- [ ] **Step 9: Verify Worker tests** e `wrangler deploy --dry-run` quando suportado sem credenciais reais.
- [ ] **Step 10: Commit** `feat(telemetry): add Cloudflare ingestion worker`.

---

### Task 7: Provisionamento automático via terminal

**Files:**
- Create: `scripts/setup-cloudflare-telemetry.mjs`
- Modify: `package.json`
- Modify: `cloudflare/telemetry/wrangler.jsonc`
- Create: `cloudflare/telemetry/README.md`
- Test: `test/cloudflare-telemetry-setup.test.js`

**Interfaces:**
- Root script: `npm run telemetry:cloudflare:setup`.
- Script usa `npx wrangler`/CLI instalado no subprojeto e não requer edição manual de dashboard para caminho normal.
- Fluxo idempotente: `whoami` -> localizar/criar D1 -> escrever/validar `database_id` no `wrangler.jsonc` -> migrations remote -> deploy -> `/health` -> imprimir endpoint e próximo comando/configuração.

- [ ] **Step 1: Write failing setup-script tests** com executor CLI fake: recurso já existe deve ser reutilizado; primeira execução cria; rerun não duplica; falha em health resulta exit !=0.
- [ ] **Step 2: Run RED** `node --test test/cloudflare-telemetry-setup.test.js`.
- [ ] **Step 3: Implement command runner injetável** (`run(cmd,args,opts)`) para permitir teste sem Cloudflare.
- [ ] **Step 4: Implement D1 discovery/create** parseando saída Wrangler estruturada quando disponível; nunca escolher database ambíguo silenciosamente.
- [ ] **Step 5: Implement binding update seguro** preservando o restante de `wrangler.jsonc`; validar `ANALYTICS` binding e aplicar `wrangler d1 migrations apply ... --remote`.
- [ ] **Step 6: Deploy + health check** e imprimir ao final:

```text
Worker: <url>
D1: <name/id>
Analytics binding: ANALYTICS
ArtiSys: defina PDV_TELEMETRY_ENDPOINT=<url> no build/ambiente oficial ou configure explicitamente.
```

- [ ] **Step 7: Verify idempotency tests + `node --check scripts/setup-cloudflare-telemetry.mjs`**.
- [ ] **Step 8: Commit** `feat(telemetry): automate Cloudflare provisioning`.

---

### Task 8: Documentação, lint, release gates e verificação final

**Files:**
- Create: `docs/operations/telemetry.md`
- Modify: `README.md`
- Modify: `release/release-notes.md`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-25-telemetry-cloudflare-design.md` apenas se a implementação exigir esclarecer algo sem mudar escopo.

**Interfaces:**
- `npm run verify` inclui syntax checks dos novos arquivos core/desktop/setup.
- Worker mantém suite própria `npm --prefix cloudflare/telemetry test` e pode ser chamada por `npm run test:telemetry:cloudflare` no root.
- Documentação explica opt-in, dados coletados/não coletados, fila offline, como desativar, retenção, custos/quota Cloudflare e provisionamento.

- [ ] **Step 1: Add lint/scripts**:
  - novos arquivos `js/core/telemetry/*` em `lint:core`;
  - `desktop/telemetry-*.cjs` em `lint:desktop`;
  - `telemetry:cloudflare:setup`;
  - `test:telemetry:cloudflare`.
- [ ] **Step 2: Document operational procedure** com comando único de setup e comandos de inspeção/redeploy/migrations sem prometer quotas eternas; apontar que preços/limites Cloudflare devem ser conferidos antes de produção em escala.
- [ ] **Step 3: Run focused suites**:

```bash
node --test test/telemetry-schema.test.js test/telemetry-queue.test.js test/telemetry-service.test.js test/telemetry-effects.test.js test/telemetry-desktop.test.js test/telemetry-settings-ui.test.js test/cloudflare-telemetry-setup.test.js
npm --prefix cloudflare/telemetry test
```

Expected: PASS.

- [ ] **Step 4: Run full repository verification**

```bash
npm run verify
npm run test:release
```

Expected: todos os gates existentes passam; telemetria desligada não muda comportamento das suítes atuais.

- [ ] **Step 5: Run release verification**

```bash
npm run verify:release
```

Expected: PASS.

- [ ] **Step 6: Security/privacy grep**

Inspecionar fixtures/outputs para garantir que testes não introduziram credenciais reais e que nenhuma linha nova envia objetos arbitrários (`event.payload`, request body, `process.env`) para telemetria.

- [ ] **Step 7: Commit**

```bash
git add package.json README.md release/release-notes.md docs/operations/telemetry.md
git commit -m "docs(telemetry): document privacy and operations"
```

- [ ] **Step 8: Final branch review** comparando `feat/telemetry-cloudflare` com `main`, com foco em fail-open, PII, auth bootstrap, D1 growth, timers e regressões de EventBus.

---

## Ordem de entrega funcional

1. Tasks 1–2 entregam telemetria local testável sem rede.
2. Task 3 conecta fluxos reais sem dependência de Cloudflare.
3. Tasks 4–5 entregam opt-in, identidade e transporte seguro no produto.
4. Task 6 entrega o coletor serverless testável isoladamente.
5. Task 7 torna criação de Worker/D1/migrations/deploy automatizada pelo terminal.
6. Task 8 fecha documentação e gates.

Nenhuma task antes da 6 requer conta Cloudflare para passar testes, e nenhuma instalação do ArtiSys requer Cloudflare para vender ou operar.