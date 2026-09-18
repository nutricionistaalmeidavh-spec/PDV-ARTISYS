(() => {
  'use strict';

  const api = window.artisysDesktop?.updater;
  if (!api) return;

  const host = document.querySelector('.app-footer > div:last-child');
  if (!host) return;

  const button = document.createElement('button');
  button.id = 'updater-status';
  button.type = 'button';
  button.className = 'updater-status hidden';
  button.setAttribute('aria-live', 'polite');
  host.prepend(button);

  let current = { status: 'idle' };

  function setText(text, action, title = '') {
    button.textContent = text;
    button.dataset.action = action || '';
    button.title = title;
    button.classList.toggle('hidden', !text);
  }

  function render(state) {
    current = state || { status: 'idle' };
    switch (current.status) {
      case 'checking':
        setText('Verificando atualização…', '');
        break;
      case 'available':
        setText(`Atualização ${current.availableVersion || ''} disponível`, 'download', 'Clique para baixar');
        break;
      case 'downloading':
        setText(`Baixando atualização ${Number(current.progress || 0)}%`, '');
        break;
      case 'downloaded':
        setText('Atualização pronta — reiniciar', 'install', 'Clique para instalar agora');
        break;
      case 'error':
        setText('Atualização indisponível — tentar novamente', 'check', current.error || 'Falha ao atualizar');
        break;
      default:
        setText('', '');
        break;
    }
  }

  async function invoke(action) {
    const fn = api[action];
    if (typeof fn !== 'function') return;
    const result = await fn();
    if (result?.ok && result.data) render(result.data);
    if (result?.ok === false) render({ ...current, status: 'error', error: result.error?.message || 'Falha na atualização.' });
  }

  button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action) void invoke(action);
  });

  api.onStateChanged(render);
  void api.state().then((result) => {
    if (result?.ok && result.data) render(result.data);
  });
})();
