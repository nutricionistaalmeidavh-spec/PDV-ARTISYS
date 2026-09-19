(function initUpdaterUi() {
  const updater = window.artisysDesktop?.updater;
  if (!updater) return;

  const root = document.createElement('div');
  root.className = 'updater-toast hidden';
  root.innerHTML = '<strong id="updaterTitle">Atualização</strong><span id="updaterText"></span><div id="updaterProgress" class="updater-progress hidden"><i></i></div><div class="updater-actions"><button id="updaterPrimary" type="button" class="primary">Atualizar</button><button id="updaterDismiss" type="button" class="secondary">Depois</button></div>';
  document.body.appendChild(root);

  const title = root.querySelector('#updaterTitle');
  const text = root.querySelector('#updaterText');
  const progress = root.querySelector('#updaterProgress');
  const bar = progress.querySelector('i');
  const primary = root.querySelector('#updaterPrimary');
  const dismiss = root.querySelector('#updaterDismiss');
  let state = { status: 'idle' };

  const render = (next) => {
    state = next || state;
    root.classList.toggle('hidden', ['idle', 'current', 'unsupported'].includes(state.status));
    progress.classList.toggle('hidden', state.status !== 'downloading');
    bar.style.width = `${state.progress || 0}%`;
    primary.classList.remove('hidden');

    if (state.status === 'checking') {
      title.textContent = 'Atualização';
      text.textContent = 'Verificando nova versão...';
      primary.classList.add('hidden');
    } else if (state.status === 'available') {
      title.textContent = `ArtiSys PDV ${state.availableVersion || ''} disponível`;
      text.textContent = 'Baixe a nova versão sem reinstalar manualmente.';
      primary.textContent = 'Baixar agora';
    } else if (state.status === 'downloading') {
      title.textContent = 'Baixando atualização';
      text.textContent = `${state.progress || 0}% concluído`;
      primary.classList.add('hidden');
    } else if (state.status === 'downloaded') {
      title.textContent = 'Atualização pronta';
      text.textContent = 'O sistema reiniciará para concluir a atualização.';
      primary.textContent = 'Atualizar e reiniciar';
    } else if (state.status === 'error') {
      title.textContent = 'Não foi possível atualizar';
      text.textContent = state.error || 'Tente novamente mais tarde.';
      primary.textContent = 'Tentar novamente';
    }
  };

  primary.addEventListener('click', async () => {
    try {
      if (state.status === 'available') await updater.download();
      else if (state.status === 'downloaded') await updater.install();
      else await updater.check();
    } catch (error) {
      render({ ...state, status: 'error', error: error.message });
    }
  });
  dismiss.addEventListener('click', () => root.classList.add('hidden'));
  updater.onState(render);
  updater.state().then(render).catch(() => {});
})();
