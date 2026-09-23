'use strict';

(function attachScaleUi(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.PdvScaleUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function scaleUiFactory(root) {
  const SCALE_STORAGE_KEY = 'artisys.scaleConfig';
  const PRESETS = Object.freeze([
    Object.freeze({ id:'toledo-prix3-prt5', manufacturer:'Toledo do Brasil', models:Object.freeze(['Prix 3 Fit','Prix 3 Plus']), protocol:'Prt5', defaultBaudRate:9600, status:'manufacturer-verified' }),
    Object.freeze({ id:'urano-pop', manufacturer:'Urano', models:Object.freeze(['POP-S','POP-Z']), protocol:'PROT-3', defaultBaudRate:9600, status:'manufacturer-verified' }),
    Object.freeze({ id:'urano-udc', manufacturer:'Urano', models:Object.freeze(['UDC CO','UDC CO-E']), protocol:'Std04', defaultBaudRate:9600, status:'manufacturer-verified' }),
    Object.freeze({ id:'filizola-bp-cs', manufacturer:'Filizola', models:Object.freeze(['BP-S','CS']), protocol:'Legado numérico', defaultBaudRate:9600, status:'legacy-needs-physical-validation' }),
    Object.freeze({ id:'generic-numeric', manufacturer:'Genérica', models:Object.freeze(['Serial numérica']), protocol:'Numérico', defaultBaudRate:9600, status:'generic' })
  ]);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  }

  function clonePreset(preset) {
    return { ...preset, models:[...preset.models] };
  }

  function getScalePresets() {
    return PRESETS.map(clonePreset);
  }

  function normalizeUnit(value) {
    return String(value || 'UN').trim().toUpperCase();
  }

  function isWeightedProduct(product) {
    const unit = normalizeUnit(product?.unit);
    return unit === 'KG' || unit === 'G';
  }

  function round3(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }

  function parseDecimal(value) {
    let text = String(value ?? '').trim().replace(/\s+/g, '');
    if (!text) return NaN;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    return Number(text);
  }

  function calculateWeightedSale(product = {}, grams) {
    const unit = normalizeUnit(product.unit);
    if (!['KG','G'].includes(unit)) throw new Error('Produto não configurado para venda por peso.');
    const normalizedGrams = Number(grams);
    if (!Number.isFinite(normalizedGrams) || normalizedGrams <= 0) throw new Error('Peso inválido.');
    const unitPriceCents = Math.round(Number(product.salePriceCents));
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new Error('Preço do produto inválido.');
    const quantity = unit === 'KG' ? normalizedGrams / 1000 : normalizedGrams;
    return {
      productId:String(product.id || ''),
      grams:round3(normalizedGrams),
      quantity:round3(quantity),
      unit,
      unitPriceCents,
      totalCents:Math.round(unitPriceCents * quantity)
    };
  }

  function readingToGrams(reading = {}) {
    const weight = Number(reading?.weight);
    if (!Number.isFinite(weight) || weight <= 0) throw new Error('Leitura de peso inválida.');
    const unit = String(reading?.unit || 'kg').trim().toLowerCase();
    const grams = unit === 'g' ? weight : unit === 'kg' ? weight * 1000 : NaN;
    if (!Number.isFinite(grams) || grams <= 0) throw new Error('Unidade de peso não suportada.');
    return round3(grams);
  }

  function manualWeightToGrams(value, productUnit = 'KG') {
    const numeric = parseDecimal(value);
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Peso manual inválido.');
    const unit = normalizeUnit(productUnit);
    if (!['KG','G'].includes(unit)) throw new Error('Unidade de produto inválida para pesagem.');
    return round3(unit === 'KG' ? numeric * 1000 : numeric);
  }

  function classifyScaleState({ status, error } = {}) {
    const code = String(error?.code || '');
    const message = String(error?.message || error || '');
    if (code === 'SCALE_WEIGHT_UNSTABLE' || /peso\s+inst[aá]vel/i.test(message)) {
      return { kind:'unstable', label:'Peso instável', message:message || 'Aguarde a estabilização da balança.' };
    }
    if (error) {
      if (/n[aã]o configurad|not-configured/i.test(message)) return { kind:'disconnected', label:'Balança desconectada', message };
      return { kind:'error', label:'Erro na balança', message:message || 'Não foi possível comunicar com a balança.' };
    }
    if (status?.available) return { kind:'connected', label:'Balança conectada', message:'' };
    return { kind:'disconnected', label:'Balança desconectada', message:status?.reason === 'not-configured' ? 'Configure uma balança neste terminal.' : '' };
  }

  function formatWeight(reading) {
    const weight = Number(reading?.weight);
    if (!Number.isFinite(weight)) return '—';
    const unit = String(reading?.unit || 'kg').toLowerCase();
    const normalizedKg = unit === 'g' ? weight / 1000 : weight;
    return `${normalizedKg.toFixed(3).replace('.', ',')} kg`;
  }

  function formatGramsForUnit(grams, unit = 'KG') {
    const normalized = Number(grams);
    if (!Number.isFinite(normalized)) return '—';
    if (normalizeUnit(unit) === 'G') return `${normalized.toLocaleString('pt-BR', { maximumFractionDigits:3 })} g`;
    return `${(normalized / 1000).toFixed(3).replace('.', ',')} kg`;
  }

  function formatCents(cents) {
    return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  function weightedCartSummary(weighted = {}) {
    const unit = normalizeUnit(weighted.unit);
    const amount = formatGramsForUnit(weighted.grams, unit);
    const suffix = unit === 'G' ? '/g' : '/kg';
    return `${amount} × ${formatCents(weighted.unitPriceCents)}${suffix}`;
  }

  function renderScaleStatusMarkup(state = classifyScaleState()) {
    return `<span class="scale-state scale-state-${escapeHtml(state.kind)}" data-scale-status data-scale-state="${escapeHtml(state.kind)}"><i aria-hidden="true"></i><strong>${escapeHtml(state.label)}</strong>${state.message ? `<small>${escapeHtml(state.message)}</small>` : ''}</span>`;
  }

  function renderScaleSettingsMarkup(context = {}) {
    const ports = Array.isArray(context.ports) ? context.ports.filter(port => port?.path) : [];
    const current = context.configuration?.scale || context.scale || {};
    const selectedPreset = String(current.preset || 'generic-numeric');
    const selectedConnection = String(current.connection || 'serial');
    const selectedPort = String(current.port || '');
    const selectedBaud = Number(current.baud || PRESETS.find(item => item.id === selectedPreset)?.defaultBaudRate || 9600);
    const options = PRESETS.map(preset => `<option value="${escapeHtml(preset.id)}" ${preset.id === selectedPreset ? 'selected' : ''}>${escapeHtml(preset.manufacturer)} — ${escapeHtml(preset.models.join(' / '))}</option>`).join('');
    const portMap = new Map(ports.map(port => [String(port.path), port]));
    if (selectedPort && !portMap.has(selectedPort)) portMap.set(selectedPort, { path:selectedPort, manufacturer:null });
    const portOptions = [`<option value="">Selecione a porta</option>`, ...[...portMap.values()].map(port => `<option value="${escapeHtml(port.path)}" ${String(port.path) === selectedPort ? 'selected' : ''}>${escapeHtml(port.path)}${port.manufacturer ? ` — ${escapeHtml(port.manufacturer)}` : ''}</option>`)].join('');
    const preset = PRESETS.find(item => item.id === selectedPreset) || PRESETS[PRESETS.length - 1];
    const validationNote = preset.status === 'legacy-needs-physical-validation' ? '<p class="scale-note">Perfil legado: compatibilidade por protocolo; requer validação no equipamento físico antes de ser marcado como homologado.</p>' : '<p class="scale-note">Perfil por protocolo. Homologação física é registrada separadamente por modelo.</p>';
    return `<section class="ops-card scale-settings-card" data-scale-settings>
      <div class="scale-settings-head"><div><h2>Hardware → Balança</h2><p>Configure a balança usada para pesar produtos diretamente no caixa.</p></div><div data-scale-settings-status>${renderScaleStatusMarkup(context.scaleState || classifyScaleState({status:context.status?.scale}))}</div></div>
      <div class="scale-settings-grid">
        <label>Marca e modelo<select class="ops-input" data-scale-preset>${options}</select></label>
        <label>Conexão<select class="ops-input" data-scale-connection><option value="serial" ${selectedConnection === 'serial' ? 'selected' : ''}>Serial (RS-232 / COM)</option><option value="usb-serial" ${selectedConnection === 'usb-serial' ? 'selected' : ''}>USB / Serial virtual (COM)</option></select></label>
        <label>Porta<select class="ops-input" data-scale-port>${portOptions}</select></label>
        <label>Baud rate<input class="ops-input" data-scale-baud type="number" min="1200" step="1" value="${escapeHtml(selectedBaud)}"></label>
      </div>
      <div class="scale-preset-detail"><strong>${escapeHtml(preset.manufacturer)}</strong><span>${escapeHtml(preset.models.join(' / '))}</span><small>Protocolo ${escapeHtml(preset.protocol)}</small></div>
      ${validationNote}
      <div class="ops-actions scale-actions"><button type="button" class="ops-secondary" data-scale-detect-ports>Detectar portas</button><button type="button" class="ops-primary" data-scale-save>Salvar configuração</button><button type="button" class="ops-secondary" data-scale-test>Testar balança</button></div>
      <div class="scale-test-result" data-scale-test-result aria-live="polite"></div>
    </section>`;
  }

  function renderWeightedDialogMarkup(product = {}, reading = null, state = classifyScaleState(), preview = null) {
    const unit = normalizeUnit(product.unit || 'KG');
    const weighted = preview || (reading ? calculateWeightedSale(product, readingToGrams(reading)) : null);
    const weightText = weighted ? formatGramsForUnit(weighted.grams, unit) : 'Aguardando leitura…';
    const manualUnit = unit === 'G' ? 'g' : 'kg';
    const perUnit = unit === 'G' ? '/g' : '/kg';
    return `<section class="scale-weigh-card" data-scale-weigh-dialog role="dialog" aria-modal="true" aria-labelledby="scale-weigh-title">
      <header><div><span class="scale-eyebrow">Venda por peso</span><h2 id="scale-weigh-title">${escapeHtml(product.name || 'Produto')}</h2><p>${escapeHtml(formatCents(product.salePriceCents))}${perUnit} · cadastro ${escapeHtml(unit)}</p></div><button type="button" class="scale-close" data-scale-close aria-label="Fechar pesagem">×</button></header>
      <div class="scale-weigh-status">${renderScaleStatusMarkup(state)}</div>
      <div class="scale-weight-display"><span>Peso recebido</span><strong data-scale-weight-value>${escapeHtml(weightText)}</strong><small data-scale-weight-source>${weighted ? 'Peso pronto para confirmação' : 'O item ainda não foi adicionado ao carrinho.'}</small></div>
      <div class="scale-total-preview"><span>Total deste item</span><strong data-scale-total-value>${weighted ? escapeHtml(formatCents(weighted.totalCents)) : '—'}</strong><small data-scale-calculation>${weighted ? escapeHtml(weightedCartSummary(weighted)) : `Preço: ${escapeHtml(formatCents(product.salePriceCents))}${perUnit}`}</small></div>
      <div class="scale-manual-fallback">
        <div><strong>Digitar peso manualmente</strong><small>Fallback disponível mesmo sem balança conectada.</small></div>
        <div class="scale-manual-row"><label><span>Peso (${manualUnit})</span><input class="ops-input" data-scale-manual-weight inputmode="decimal" autocomplete="off" placeholder="${unit === 'G' ? '742' : '0,742'}"></label><button type="button" class="ops-secondary" data-scale-manual-apply>Usar peso digitado</button></div>
      </div>
      <div class="scale-weigh-error" data-scale-weigh-error aria-live="polite"></div>
      <div class="scale-weigh-actions"><button type="button" class="ops-secondary" data-scale-read-again>Ler novamente</button><button type="button" class="ops-primary" data-add-weighted-item ${weighted ? '' : 'disabled'}>Adicionar ao carrinho</button></div>
    </section>`;
  }

  const browser = root && root.document ? {
    api:null,
    initialized:false,
    products:new Map(),
    ports:[],
    diagnostics:null,
    scaleState:classifyScaleState(),
    syncTimers:new Set(),
    currentSession:null
  } : null;
  const weighingState = typeof WeakMap === 'function' ? new WeakMap() : null;

  function showInlineResult(node, message, kind = '') {
    if (!node) return;
    node.className = `scale-test-result ${kind ? `is-${kind}` : ''}`;
    node.textContent = message;
  }

  function showWeighError(overlay, message = '') {
    const node = overlay?.querySelector?.('[data-scale-weigh-error]');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-visible', Boolean(message));
  }

  async function ensureApi() {
    if (!browser || !root.PdvApiClient?.ApiClient) return null;
    if (!browser.api) browser.api = new root.PdvApiClient.ApiClient();
    if (!browser.initialized) {
      await browser.api.initialize();
      browser.initialized = true;
    }
    return browser.api;
  }

  async function ensureSession() {
    const api = await ensureApi();
    if (!api) return null;
    if (!browser.currentSession) browser.currentSession = await api.currentSession();
    return browser.currentSession;
  }

  async function refreshProducts() {
    try {
      const api = await ensureApi();
      if (!api) return;
      const products = await api.products(false);
      browser.products = new Map((Array.isArray(products) ? products : []).map(product => [String(product.id), product]));
    } catch {
      /* autenticação pode ainda não ter sido concluída; nova tentativa ocorre ao entrar no Balcão */
    }
  }

  function savedScaleConfiguration() {
    try {
      const raw = root.localStorage?.getItem(SCALE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function persistScaleConfiguration(configuration) {
    try { root.localStorage?.setItem(SCALE_STORAGE_KEY, JSON.stringify(configuration)); } catch {/* armazenamento local opcional */}
  }

  async function refreshHardwareState() {
    try {
      const [status, diagnostics] = await Promise.all([
        root.artisysDesktop.hardware.status(),
        root.artisysDesktop.hardware.diagnostics()
      ]);
      browser.diagnostics = diagnostics || {};
      browser.ports = Array.isArray(diagnostics?.serialPorts) ? diagnostics.serialPorts : browser.ports;
      browser.scaleState = classifyScaleState({ status:status?.scale });
      return { status, diagnostics };
    } catch (error) {
      browser.scaleState = classifyScaleState({ error });
      return { status:{scale:{available:false}}, diagnostics:browser.diagnostics || {} };
    }
  }

  function formConfiguration(section) {
    return {
      enabled:true,
      preset:String(section.querySelector('[data-scale-preset]')?.value || 'generic-numeric'),
      connection:String(section.querySelector('[data-scale-connection]')?.value || 'serial'),
      port:String(section.querySelector('[data-scale-port]')?.value || '').trim(),
      baud:Number(section.querySelector('[data-scale-baud]')?.value || 9600)
    };
  }

  function updateSettingsState(section, state) {
    const slot = section?.querySelector('[data-scale-settings-status]');
    if (slot) slot.innerHTML = renderScaleStatusMarkup(state);
  }

  async function applyScaleFromSection(section, { test = false } = {}) {
    const resultNode = section.querySelector('[data-scale-test-result]');
    const configuration = formConfiguration(section);
    if (!configuration.port) {
      const state = classifyScaleState({ error:new Error('Selecione a porta da balança.') });
      updateSettingsState(section, state);
      showInlineResult(resultNode, 'Selecione uma porta COM antes de salvar ou testar.', 'error');
      return null;
    }
    try {
      const configured = await root.artisysDesktop.hardware.configureScale(configuration);
      persistScaleConfiguration(configuration);
      if (test) {
        showInlineResult(resultNode, 'Lendo peso…');
        const reading = await root.artisysDesktop.hardware.readWeight();
        browser.scaleState = classifyScaleState({ status:{available:true} });
        updateSettingsState(section, browser.scaleState);
        showInlineResult(resultNode, `Conexão validada. Peso recebido: ${formatWeight(reading)}.`, 'success');
      } else {
        browser.scaleState = classifyScaleState({ status:{available:true} });
        updateSettingsState(section, browser.scaleState);
        showInlineResult(resultNode, `Configuração salva em ${configured.port}.`, 'success');
      }
      await refreshHardwareState();
      void syncCheckoutStatus();
      return configured;
    } catch (error) {
      browser.scaleState = classifyScaleState({ error });
      updateSettingsState(section, browser.scaleState);
      showInlineResult(resultNode, error.message || 'Falha ao configurar a balança.', 'error');
      return null;
    }
  }

  function bindScaleSettings(section) {
    if (!section || section.dataset.scaleBound === 'true') return;
    section.dataset.scaleBound = 'true';
    section.querySelector('[data-scale-preset]')?.addEventListener('change', event => {
      const preset = PRESETS.find(item => item.id === event.currentTarget.value);
      const baud = section.querySelector('[data-scale-baud]');
      if (preset && baud) baud.value = String(preset.defaultBaudRate);
      const detail = section.querySelector('.scale-preset-detail');
      if (preset && detail) detail.innerHTML = `<strong>${escapeHtml(preset.manufacturer)}</strong><span>${escapeHtml(preset.models.join(' / '))}</span><small>Protocolo ${escapeHtml(preset.protocol)}</small>`;
    });
    section.querySelector('[data-scale-detect-ports]')?.addEventListener('click', async () => {
      const resultNode = section.querySelector('[data-scale-test-result]');
      try {
        showInlineResult(resultNode, 'Detectando portas seriais…');
        const ports = await root.artisysDesktop.hardware.listSerialPorts();
        browser.ports = Array.isArray(ports) ? ports.filter(port => port?.path) : [];
        const select = section.querySelector('[data-scale-port]');
        const current = select?.value || '';
        if (select) {
          const values = new Map(browser.ports.map(port => [String(port.path), port]));
          if (current && !values.has(current)) values.set(current, {path:current});
          select.innerHTML = `<option value="">Selecione a porta</option>${[...values.values()].map(port => `<option value="${escapeHtml(port.path)}" ${String(port.path) === current ? 'selected' : ''}>${escapeHtml(port.path)}${port.manufacturer ? ` — ${escapeHtml(port.manufacturer)}` : ''}</option>`).join('')}`;
        }
        showInlineResult(resultNode, browser.ports.length ? `${browser.ports.length} porta(s) encontrada(s).` : 'Nenhuma porta serial encontrada.');
      } catch (error) { showInlineResult(resultNode, error.message, 'error'); }
    });
    section.querySelector('[data-scale-save]')?.addEventListener('click', () => { void applyScaleFromSection(section); });
    section.querySelector('[data-scale-test]')?.addEventListener('click', () => { void applyScaleFromSection(section, { test:true }); });
  }

  async function syncScaleSettings() {
    if (!browser) return;
    const page = root.document.querySelector('#route-content .ops-page');
    const title = page?.querySelector('.ops-head h1')?.textContent?.trim();
    if (title !== 'Configurações') return;
    if (page.querySelector('[data-scale-settings]')) return;
    const { status, diagnostics } = await refreshHardwareState();
    if (root.document.querySelector('#route-content .ops-head h1')?.textContent?.trim() !== 'Configurações') return;
    const holder = root.document.createElement('div');
    holder.innerHTML = renderScaleSettingsMarkup({
      ports:browser.ports,
      configuration:diagnostics?.configuration || {},
      status,
      scaleState:browser.scaleState
    });
    const section = holder.firstElementChild;
    const grid = page.querySelector('.ops-grid.two');
    if (grid) grid.insertAdjacentElement('afterend', section);
    else page.appendChild(section);
    bindScaleSettings(section);
  }

  async function currentOpenSale() {
    try {
      const api = await ensureApi();
      const session = await ensureSession();
      if (!api || !session?.user?.id) return null;
      const terminalId = api.config?.terminalId || session.terminalId;
      const sales = await api.sales('OPEN', 20);
      return (Array.isArray(sales) ? sales : []).find(sale => sale.terminalId === terminalId && sale.operatorId === session.user.id) || null;
    } catch { return null; }
  }

  async function syncWeightedCartPresentation() {
    if (!browser) return;
    const checkout = root.document.querySelector('#route-content .checkout-layout');
    if (!checkout) return;
    const sale = await currentOpenSale();
    if (!sale?.items?.length || !checkout.isConnected) return;
    const queues = new Map();
    for (const item of sale.items) {
      const weight = item.configuration?.weight;
      if (!weight) continue;
      const id = String(item.productId);
      if (!queues.has(id)) queues.set(id, []);
      queues.get(id).push(item);
    }
    for (const line of checkout.querySelectorAll('.cart-line[data-select-product]')) {
      const productId = String(line.dataset.selectProduct || '');
      const item = queues.get(productId)?.shift();
      if (!item?.configuration?.weight) continue;
      const weighted = {
        grams:Number(item.configuration.weight.grams),
        unit:item.configuration.weight.unit,
        unitPriceCents:Number(item.unitPriceCents || 0)
      };
      line.dataset.weightedItem = 'true';
      const qty = line.querySelector('.qty-control');
      if (qty) qty.innerHTML = `<span class="weighted-cart-quantity">${escapeHtml(formatGramsForUnit(weighted.grams, weighted.unit))}</span>`;
      const info = line.querySelector('div:first-child');
      info?.querySelector('[data-weighted-cart-summary]')?.remove();
      if (info) info.insertAdjacentHTML('beforeend', `<small class="weighted-cart-summary" data-weighted-cart-summary>${escapeHtml(weightedCartSummary(weighted))}</small>`);
    }
  }

  async function syncCheckoutStatus() {
    if (!browser) return;
    const checkout = root.document.querySelector('#route-content .checkout-layout');
    if (!checkout) return;
    let slot = checkout.querySelector('[data-scale-checkout-status]');
    if (!slot) {
      slot = root.document.createElement('div');
      slot.className = 'checkout-scale-status';
      slot.dataset.scaleCheckoutStatus = '';
      const hero = checkout.querySelector('.checkout-hero') || checkout;
      hero.appendChild(slot);
    }
    try {
      const status = await root.artisysDesktop.hardware.status();
      browser.scaleState = classifyScaleState({ status:status?.scale });
    } catch (error) {
      browser.scaleState = classifyScaleState({ error });
    }
    if (slot.isConnected) slot.innerHTML = renderScaleStatusMarkup(browser.scaleState);
    void syncWeightedCartPresentation();
  }

  function closeWeightDialog() {
    root.document.querySelector('[data-scale-weigh-overlay]')?.remove();
  }

  function updateWeightPreview(product, overlay, grams, source) {
    const preview = calculateWeightedSale(product, grams);
    weighingState?.set(overlay, { preview, source });
    const weightNode = overlay.querySelector('[data-scale-weight-value]');
    const totalNode = overlay.querySelector('[data-scale-total-value]');
    const calculationNode = overlay.querySelector('[data-scale-calculation]');
    const sourceNode = overlay.querySelector('[data-scale-weight-source]');
    const addButton = overlay.querySelector('[data-add-weighted-item]');
    if (weightNode) weightNode.textContent = formatGramsForUnit(preview.grams, preview.unit);
    if (totalNode) totalNode.textContent = formatCents(preview.totalCents);
    if (calculationNode) calculationNode.textContent = weightedCartSummary(preview);
    if (sourceNode) sourceNode.textContent = source === 'MANUAL' ? 'Peso digitado manualmente' : 'Peso recebido da balança';
    if (addButton) addButton.disabled = false;
    overlay.dataset.weightReady = 'true';
    overlay.dataset.weightSource = source;
    showWeighError(overlay, '');
    return preview;
  }

  async function readIntoWeightDialog(product, overlay) {
    if (!overlay?.isConnected) return;
    const card = overlay.querySelector('[data-scale-weigh-dialog]');
    const statusSlot = card?.querySelector('.scale-weigh-status');
    const weightNode = card?.querySelector('[data-scale-weight-value]');
    if (weightNode) weightNode.textContent = 'Lendo…';
    showWeighError(overlay, '');
    try {
      const reading = await root.artisysDesktop.hardware.readWeight();
      const grams = readingToGrams(reading);
      browser.scaleState = classifyScaleState({ status:{available:true} });
      if (statusSlot) statusSlot.innerHTML = renderScaleStatusMarkup(browser.scaleState);
      updateWeightPreview(product, overlay, grams, 'SCALE');
      void syncCheckoutStatus();
    } catch (error) {
      browser.scaleState = classifyScaleState({ error });
      if (statusSlot) statusSlot.innerHTML = renderScaleStatusMarkup(browser.scaleState);
      if (!weighingState?.get(overlay)?.preview && weightNode) weightNode.textContent = browser.scaleState.kind === 'unstable' ? 'Peso instável' : 'Sem leitura';
      showWeighError(overlay, browser.scaleState.kind === 'unstable' ? 'Aguarde a estabilização ou informe o peso manualmente.' : 'Balança indisponível. Informe o peso manualmente ou tente novamente.');
      void syncCheckoutStatus();
    }
  }

  function applyManualWeight(product, overlay) {
    const input = overlay.querySelector('[data-scale-manual-weight]');
    try {
      const grams = manualWeightToGrams(input?.value, product.unit);
      updateWeightPreview(product, overlay, grams, 'MANUAL');
    } catch (error) {
      showWeighError(overlay, error.message || 'Peso manual inválido.');
      input?.focus();
    }
  }

  async function ensureCheckoutSale() {
    const api = await ensureApi();
    const session = await ensureSession();
    if (!api || !session?.user?.id) throw new Error('Sessão do operador indisponível.');
    const terminalId = api.config?.terminalId || session.terminalId;
    if (!terminalId) throw new Error('Terminal do PDV não identificado.');
    const sales = await api.sales('OPEN', 20);
    let sale = (Array.isArray(sales) ? sales : []).find(item => item.terminalId === terminalId && item.operatorId === session.user.id) || null;
    if (sale) return sale;
    const saleNumber = `${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Date.now().toString().slice(-6)}`;
    const sellerId = root.document.querySelector('#seller-select')?.value || session.user.id;
    sale = await api.openSale({ saleNumber, terminalId, sellerId });
    return sale;
  }

  async function addWeightedItemFromDialog(product, overlay) {
    const state = weighingState?.get(overlay);
    if (!state?.preview) {
      showWeighError(overlay, 'Leia ou informe um peso válido antes de adicionar.');
      return null;
    }
    const button = overlay.querySelector('[data-add-weighted-item]');
    if (button) { button.disabled = true; button.textContent = 'Adicionando…'; }
    try {
      const api = await ensureApi();
      const sale = await ensureCheckoutSale();
      const preview = state.preview;
      const updated = await api.request(`/api/v1/vertical/sales/${encodeURIComponent(sale.id)}/configured-item`, {
        method:'POST',
        body:{
          productId:preview.productId,
          quantity:preview.quantity,
          unitPriceCents:preview.unitPriceCents,
          configurationSnapshot:{ version:1, weight:{ grams:preview.grams, source:state.source, unit:preview.unit } },
          forceSeparateLine:true
        }
      });
      closeWeightDialog();
      const checkoutRoute = root.document.querySelector('[data-route="checkout"]');
      if (checkoutRoute) checkoutRoute.click();
      else scheduleSync('checkout');
      return updated;
    } catch (error) {
      showWeighError(overlay, error.message || 'Não foi possível adicionar o item pesado.');
      if (button) { button.disabled = false; button.textContent = 'Adicionar ao carrinho'; }
      return null;
    }
  }

  async function openWeightDialog(product) {
    closeWeightDialog();
    try {
      const status = await root.artisysDesktop.hardware.status();
      browser.scaleState = classifyScaleState({ status:status?.scale });
    } catch (error) { browser.scaleState = classifyScaleState({ error }); }
    const overlay = root.document.createElement('div');
    overlay.className = 'scale-weigh-overlay';
    overlay.dataset.scaleWeighOverlay = '';
    overlay.innerHTML = renderWeightedDialogMarkup(product, null, browser.scaleState, null);
    root.document.body.appendChild(overlay);
    weighingState?.set(overlay, { preview:null, source:null });
    overlay.querySelector('[data-scale-close]')?.addEventListener('click', closeWeightDialog);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeWeightDialog(); });
    overlay.querySelector('[data-scale-read-again]')?.addEventListener('click', () => { void readIntoWeightDialog(product, overlay); });
    overlay.querySelector('[data-scale-manual-apply]')?.addEventListener('click', () => applyManualWeight(product, overlay));
    overlay.querySelector('[data-scale-manual-weight]')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyManualWeight(product, overlay); } });
    overlay.querySelector('[data-add-weighted-item]')?.addEventListener('click', () => { void addWeightedItemFromDialog(product, overlay); });
    await readIntoWeightDialog(product, overlay);
    if (browser.scaleState.kind !== 'connected') overlay.querySelector('[data-scale-manual-weight]')?.focus();
  }

  function scheduleSync(route = '') {
    if (!browser) return;
    for (const delay of [0,80,250,600]) {
      const timer = root.setTimeout(() => {
        browser.syncTimers.delete(timer);
        if (!route || route === 'settings') void syncScaleSettings();
        if (!route || route === 'checkout') {
          void refreshProducts();
          void syncCheckoutStatus();
        }
      }, delay);
      browser.syncTimers.add(timer);
    }
  }

  function handleCapturedClick(event) {
    const addButton = event.target?.closest?.('[data-add-product]');
    if (addButton) {
      const product = browser.products.get(String(addButton.dataset.addProduct));
      if (product && isWeightedProduct(product)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void openWeightDialog(product);
        return;
      }
      if (!product) void refreshProducts();
    }
    const routeTarget = event.target?.closest?.('[data-route],[data-home-route]');
    const route = routeTarget?.dataset?.route || routeTarget?.dataset?.homeRoute || '';
    if (route === 'settings' || route === 'checkout') scheduleSync(route);
    else if (root.document.querySelector('.checkout-layout')) scheduleSync('checkout');
  }

  async function bootBrowser() {
    if (!browser || !root.artisysDesktop?.hardware) return;
    const saved = savedScaleConfiguration();
    if (saved?.port) {
      try { await root.artisysDesktop.hardware.configureScale(saved); }
      catch (error) { browser.scaleState = classifyScaleState({ error }); }
    }
    root.addEventListener('click', handleCapturedClick, true);
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape' && root.document.querySelector('[data-scale-weigh-overlay]')) closeWeightDialog();
      if (event.key === 'F2' || event.key === 'F3') scheduleSync('checkout');
    }, true);
    scheduleSync();
  }

  if (browser) void bootBrowser();

  return Object.freeze({
    getScalePresets,
    isWeightedProduct,
    calculateWeightedSale,
    readingToGrams,
    manualWeightToGrams,
    weightedCartSummary,
    classifyScaleState,
    formatWeight,
    renderScaleStatusMarkup,
    renderScaleSettingsMarkup,
    renderWeightedDialogMarkup
  });
});
