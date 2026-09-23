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

  function isWeightedProduct(product) {
    const unit = String(product?.unit || 'UN').trim().toUpperCase();
    return unit === 'KG' || unit === 'G';
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

  function formatCents(cents) {
    return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
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

  function renderWeightedDialogMarkup(product = {}, reading = null, state = classifyScaleState()) {
    const unit = String(product.unit || 'KG').toUpperCase();
    const weightText = reading ? formatWeight(reading) : 'Aguardando leitura…';
    return `<section class="scale-weigh-card" data-scale-weigh-dialog role="dialog" aria-modal="true" aria-labelledby="scale-weigh-title">
      <header><div><span class="scale-eyebrow">Venda por peso</span><h2 id="scale-weigh-title">${escapeHtml(product.name || 'Produto')}</h2><p>${escapeHtml(formatCents(product.salePriceCents))} · cadastro ${escapeHtml(unit)}</p></div><button type="button" class="scale-close" data-scale-close aria-label="Fechar pesagem">×</button></header>
      <div class="scale-weigh-status">${renderScaleStatusMarkup(state)}</div>
      <div class="scale-weight-display"><span>Peso recebido</span><strong data-scale-weight-value>${escapeHtml(weightText)}</strong><small>O item ainda não foi adicionado ao carrinho.</small></div>
      <div class="scale-weigh-actions"><button type="button" class="ops-secondary" data-scale-read-again>Ler novamente</button></div>
    </section>`;
  }

  const browser = root && root.document ? {
    api:null,
    initialized:false,
    products:new Map(),
    ports:[],
    diagnostics:null,
    scaleState:classifyScaleState(),
    syncTimers:new Set()
  } : null;

  function showInlineResult(node, message, kind = '') {
    if (!node) return;
    node.className = `scale-test-result ${kind ? `is-${kind}` : ''}`;
    node.textContent = message;
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
  }

  function closeWeightDialog() {
    root.document.querySelector('[data-scale-weigh-overlay]')?.remove();
  }

  async function readIntoWeightDialog(product, overlay) {
    if (!overlay?.isConnected) return;
    const card = overlay.querySelector('[data-scale-weigh-dialog]');
    const statusSlot = card?.querySelector('.scale-weigh-status');
    const weightNode = card?.querySelector('[data-scale-weight-value]');
    if (weightNode) weightNode.textContent = 'Lendo…';
    try {
      const reading = await root.artisysDesktop.hardware.readWeight();
      browser.scaleState = classifyScaleState({ status:{available:true} });
      if (statusSlot) statusSlot.innerHTML = renderScaleStatusMarkup(browser.scaleState);
      if (weightNode) weightNode.textContent = formatWeight(reading);
      void syncCheckoutStatus();
    } catch (error) {
      browser.scaleState = classifyScaleState({ error });
      if (statusSlot) statusSlot.innerHTML = renderScaleStatusMarkup(browser.scaleState);
      if (weightNode) weightNode.textContent = browser.scaleState.kind === 'unstable' ? 'Peso instável' : 'Sem leitura';
      void syncCheckoutStatus();
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
    overlay.innerHTML = renderWeightedDialogMarkup(product, null, browser.scaleState);
    root.document.body.appendChild(overlay);
    overlay.querySelector('[data-scale-close]')?.addEventListener('click', closeWeightDialog);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeWeightDialog(); });
    overlay.querySelector('[data-scale-read-again]')?.addEventListener('click', () => { void readIntoWeightDialog(product, overlay); });
    await readIntoWeightDialog(product, overlay);
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
    classifyScaleState,
    formatWeight,
    renderScaleStatusMarkup,
    renderScaleSettingsMarkup,
    renderWeightedDialogMarkup
  });
});
