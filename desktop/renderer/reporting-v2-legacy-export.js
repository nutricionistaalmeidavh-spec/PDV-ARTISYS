'use strict';

(() => {
  const root = window;
  const { ApiClient } = root.PdvApiClient || {};
  if (!ApiClient) return;
  const api = new ApiClient();

  function download(name,text) {
    const blob = new Blob([`\uFEFF${String(text || '')}`],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  function notify(message,type='') {
    const toastRoot = document.getElementById('toast-root');
    if (!toastRoot) return;
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    toastRoot.appendChild(node);
    setTimeout(() => node.remove(),3500);
  }

  root.addEventListener('click',async event => {
    const button = event.target.closest?.('#report-export');
    if (!button) return;
    const activeView = document.querySelector('[data-report-view].active')?.dataset.reportView;
    if (activeView !== 'overview') return;
    const form = document.getElementById('report-v2-filter');
    if (!form) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const fields = new FormData(form);
    const fromDate = String(fields.get('fromDate') || '');
    const toDate = String(fields.get('toDate') || '');
    const sellerId = String(fields.get('sellerId') || '');
    try {
      const result = await api.exportSalesCsv({
        from:new Date(`${fromDate}T00:00:00`).toISOString(),
        to:new Date(`${toDate}T23:59:59.999`).toISOString(),
        sellerId
      });
      download(`vendas-detalhadas-${fromDate}-a-${toDate}.csv`,result.csv || '');
    } catch (error) {
      notify(error.message || 'Não foi possível exportar as vendas detalhadas.','error');
    }
  },true);
})();
