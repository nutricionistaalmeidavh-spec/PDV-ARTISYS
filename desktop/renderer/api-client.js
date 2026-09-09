'use strict';

(function attach(root, factory) {
  root.PdvApiClient = factory(root);
})(window, function factory(root) {
  class ApiClient {
    constructor() {
      this.sessionToken = '';
      this.config = null;
    }

    async initialize() {
      this.config = await root.artisysDesktop.getConfig();
      return this.config;
    }

    async request(path, { method = 'GET', body, mutationId } = {}) {
      const result = await root.artisysDesktop.apiRequest({ path, method, body, mutationId, sessionToken: this.sessionToken });
      if (!result.ok) {
        const error = new Error(result.payload?.error || `Erro HTTP ${result.status}`);
        error.status = result.status;
        error.payload = result.payload;
        throw error;
      }
      return result.payload;
    }

    health() { return this.request('/api/v1/health'); }
    setupStatus() { return this.request('/api/v1/setup/status'); }
    setupAdmin(body) { return this.request('/api/v1/setup/admin', { method: 'POST', body }); }
    async login(body) {
      const result = await this.request('/api/v1/auth/login', { method: 'POST', body });
      this.sessionToken = result.sessionToken;
      return result;
    }
    logout() { this.sessionToken = ''; }

    categories(includeInactive = false) { return this.request(`/api/v1/categories${includeInactive ? '?includeInactive=true' : ''}`); }
    saveCategory(body) { return this.request('/api/v1/categories', { method: 'POST', body }); }
    products(includeInactive = false) { return this.request(`/api/v1/products${includeInactive ? '?includeInactive=true' : ''}`); }
    saveProduct(body) { return this.request('/api/v1/products', { method: 'POST', body }); }
    customers(includeInactive = false) { return this.request(`/api/v1/customers${includeInactive ? '?includeInactive=true' : ''}`); }
    saveCustomer(body) { return this.request('/api/v1/customers', { method: 'POST', body }); }
    users(includeInactive = false) { return this.request(`/api/v1/users${includeInactive ? '?includeInactive=true' : ''}`); }
    saveUser(body) { return this.request('/api/v1/users', { method: 'POST', body }); }

    openCash(terminalId) { return this.request(`/api/v1/cash/open?terminalId=${encodeURIComponent(terminalId)}`); }
    createCash(body) { return this.request('/api/v1/cash/sessions', { method: 'POST', body }); }
    cashAction(sessionId, action, body) { return this.request(`/api/v1/cash/sessions/${encodeURIComponent(sessionId)}/${action}`, { method: 'POST', body }); }

    sales(status = '', limit = 50) {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', String(limit));
      return this.request(`/api/v1/sales?${params}`);
    }
    sale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}`); }
    openSale(body) { return this.request('/api/v1/sales', { method: 'POST', body }); }
    setSaleCustomer(id, customerId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/customer`, { method: 'POST', body: { customerId } }); }
    addSaleItem(id, productId, quantity = 1) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items`, { method: 'POST', body: { productId, quantity } }); }
    updateSaleItem(id, productId, quantity) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(productId)}`, { method: 'PUT', body: { quantity } }); }
    removeSaleItem(id, productId) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/items/${encodeURIComponent(productId)}`, { method: 'DELETE' }); }
    discountSale(id, discountCents) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/discount`, { method: 'POST', body: { discountCents } }); }
    suspendSale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: {} }); }
    resumeSale(id) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/resume`, { method: 'POST', body: {} }); }
    completeSale(id, payments) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/complete`, { method: 'POST', body: { payments }, mutationId: crypto.randomUUID() }); }
    cancelSale(id, reason) { return this.request(`/api/v1/sales/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason }, mutationId: crypto.randomUUID() }); }
  }

  return { ApiClient };
});
