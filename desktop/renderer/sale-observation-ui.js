'use strict';

(() => {
  const ApiClient = window.PdvApiClient?.ApiClient;
  if (!ApiClient) return;

  const MAX_INTERNAL = 500;
  const MAX_PRINTED = 120;
  const draft = { note:'', print:false };

  const originalCompleteSale = ApiClient.prototype.completeSale;
  ApiClient.prototype.completeSale = async function completeSaleWithObservation(id, payments) {
    const prepared = Array.isArray(payments) ? payments.map(payment => ({ ...payment })) : [];
    if (prepared.length) {
      prepared[0].saleObservation = draft.note.slice(0, MAX_INTERNAL);
      prepared[0].printObservation = Boolean(draft.print && draft.note.trim());
    }
    const result = await originalCompleteSale.call(this, id, prepared);
    draft.note = '';
    draft.print = false;
    return result;
  };

  function mount() {
    const panel = document.querySelector('.sale-panel');
    const finalize = document.getElementById('finalize-sale');
    if (!panel || !finalize || panel.querySelector('[data-sale-observation]')) return;

    const block = document.createElement('section');
    block.dataset.saleObservation = 'true';
    block.style.cssText = 'padding:12px 16px;border-top:1px solid #edf1f6;background:#fbfcfe';
    block.innerHTML = `
      <label for="sale-observation" style="display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:700;color:#42526b;margin-bottom:6px">
        <span>Observação da venda</span><span id="sale-observation-counter">0/${MAX_INTERNAL}</span>
      </label>
      <textarea id="sale-observation" rows="2" maxlength="${MAX_INTERNAL}" placeholder="Ex.: separar 2 caixas; cliente retira amanhã às 10h." style="width:100%;resize:vertical;min-height:54px;box-sizing:border-box;border:1px solid #d9e0ea;border-radius:8px;padding:8px 10px;font:inherit;color:#223047;background:white"></textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#526176;cursor:pointer">
        <input id="sale-observation-print" type="checkbox"> Imprimir esta observação no cupom não fiscal
      </label>
      <small id="sale-observation-hint" style="display:block;margin-top:5px;color:#78869a">Registro interno: até ${MAX_INTERNAL} caracteres. Impresso: até ${MAX_PRINTED} caracteres / 4 linhas.</small>`;

    panel.insertBefore(block, finalize);
    const textarea = block.querySelector('#sale-observation');
    const checkbox = block.querySelector('#sale-observation-print');
    const counter = block.querySelector('#sale-observation-counter');
    const hint = block.querySelector('#sale-observation-hint');
    textarea.value = draft.note;
    checkbox.checked = draft.print;

    function refresh() {
      const limit = checkbox.checked ? MAX_PRINTED : MAX_INTERNAL;
      textarea.maxLength = limit;
      counter.textContent = `${textarea.value.length}/${limit}`;
      draft.note = textarea.value.slice(0, MAX_INTERNAL);
      draft.print = checkbox.checked;
      hint.textContent = checkbox.checked
        ? `Será impressa no cupom: máximo ${MAX_PRINTED} caracteres e 4 linhas.`
        : `Fica apenas no registro interno da venda: máximo ${MAX_INTERNAL} caracteres.`;
    }

    textarea.addEventListener('input', refresh);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked && textarea.value.length > MAX_PRINTED) {
        checkbox.checked = false;
        hint.textContent = `Reduza a observação para ${MAX_PRINTED} caracteres antes de habilitar a impressão.`;
        textarea.focus();
        refresh();
        return;
      }
      refresh();
    });
    refresh();
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.documentElement, { childList:true, subtree:true });
  document.addEventListener('DOMContentLoaded', mount, { once:true });
  mount();
})();
