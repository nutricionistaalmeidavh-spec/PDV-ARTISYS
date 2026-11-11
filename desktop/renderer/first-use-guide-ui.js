'use strict';

(()=>{
  const model=window.PdvFirstUseModel;
  const ApiClient=window.PdvApiClient?.ApiClient;
  const lifecycle=window.PdvUiLifecycle;
  const navigation=()=>window.PdvAppNavigation;
  const home=()=>document.querySelector('#route-content .classic-home-grid');
  const auth=()=>document.getElementById('auth-overlay');
  if(!model||!ApiClient||!lifecycle)return;

  const api=new ApiClient();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const CAPTION={done:'Concluído',pending:'Pendente',unknown:'Não verificado',optional:'Opcional'};
  let snapshot={onboarding:null,products:null,cashSession:undefined,sales:null,modules:[]};
  let pending=null;
  let lastRead=0;
  let renderedUser='';
  let autoOpened='';
  let tour=null;
  let tourPanel=null;
  let highlighted=null;
  const user=()=>window.PdvCurrentAccess||null;
  const isAdmin=()=>Boolean(user()&&window.PdvAccessPolicy?.hasCapability(user(),'modules.manage'));
  const permitted=route=>Boolean(window.PdvAccessPolicy?.canAccessRoute(user(),route,{
    moduleState:window.PdvModuleGate?.snapshot?.()||{}
  }));
  const prefKey=()=>{
    const terminal=document.getElementById('terminal-name')?.textContent?.trim()||'principal';
    return 'artisys:first-use-dismissed:v1:'+String(user()?.id||'')+':'+terminal;
  };
  const isDismissed=()=>{try{return localStorage.getItem(prefKey())==='yes';}catch{return false;}};
  const isStarted=()=>{try{return localStorage.getItem(prefKey()+':started')==='yes';}catch{return false;}};
  const markStarted=()=>{try{localStorage.setItem(prefKey()+':started','yes');}catch{/* preference only */}};
  const dismiss=()=>{try{localStorage.setItem(prefKey(),'yes');}catch{/* preference only */}mountHome();};
  const toast=(msg,type='error')=>window.PdvToast?.show?.(String(msg),type);

  function readStatus(force=false){
    if(pending)return pending;
    if(!user()||!isAdmin())return Promise.resolve(snapshot);
    if(!force&&Date.now()-lastRead<2500)return Promise.resolve(snapshot);
    const currentId=String(user().id);
    pending=(async()=>{
      const configPromise=window.artisysDesktop?.getConfig?.().catch(()=>null)||Promise.resolve(null);
      const [onboarding,products,sales,modules,config]=await Promise.allSettled([
        api.request('/api/v1/vertical/onboarding'),
        api.products(),
        api.sales('COMPLETED',1),
        api.modules(),
        configPromise
      ]);
      if(String(user()?.id)!==currentId)return snapshot;
      const value=settled=>settled.status==='fulfilled'?settled.value:null;
      const next={
        onboarding:value(onboarding),
        products:value(products),
        sales:value(sales),
        modules:Array.isArray(value(modules))?value(modules):[],
        cashSession:undefined
      };
      const terminalId=value(config)?.terminalId;
      if(terminalId){
        try{next.cashSession=await api.openCash(terminalId);}
        catch(error){if(error.status===404)next.cashSession=null;}
      }
      if(String(user()?.id)===currentId){
        snapshot=next;lastRead=Date.now();
        mountHome();
      }
      return snapshot;
    })().finally(()=>{pending=null;});
    return pending;
  }

  function insertHelp(){
    let button=document.getElementById('first-use-help');
    if(!button){
      button=document.createElement('button');
      button.id='first-use-help';
      button.type='button';
      button.className='nav-button first-use-help';
      button.title='Ajuda · Primeiros passos';
      button.setAttribute('aria-label','Ajuda: primeiros passos e tour guiado');
      button.innerHTML='<span class="nav-button-icon" aria-hidden="true">?</span><span class="nav-label">Ajuda</span>';
      const spacer=document.querySelector('#app-sidebar .sidebar-spacer');
      spacer?.insertAdjacentElement('afterend',button);
      button.addEventListener('click',()=>void openGuide());
    }
    button.hidden=!user();
  }

  function statusMarkup(step){
    return '<li class="first-use-step" data-state="'+step.status+'">'+
      '<span class="first-use-step-indicator" aria-hidden="true">'+(step.status==='done'?'✓':step.status==='optional'?'·':'○')+'</span>'+
      '<div class="first-use-step-copy"><strong>'+esc(step.title)+'</strong>'+
      '<small>'+esc(step.description)+'</small></div>'+
      '<span class="first-use-status">'+CAPTION[step.status]+'</span>'+
      '<button type="button" class="secondary-button" data-first-use-step="'+esc(step.id)+'">'+
      (step.id==='profile'&&step.status!=='done'?'Configurar':step.id==='products'?(step.status==='done'?'Ver itens':'Cadastrar'):'Abrir')+'</button></li>';
  }

  function summaryMarkup(compact=false){
    const status=model.firstUseSteps(snapshot);
    return '<div class="first-use-summary">'+
      '<div><span class="first-use-eyebrow">Primeiros passos</span>'+
      '<h2>Prepare sua loja</h2><p>Configure o essencial no seu ritmo. Etapas são verificadas no PDV local.</p></div>'+
      '<span class="first-use-count">'+status.completed+' de '+status.total+'</span></div>'+
      '<progress max="'+status.total+'" value="'+status.completed+'" aria-label="Configuração concluída"></progress>'+
      (compact?'':'<ul class="first-use-steps">'+status.steps.map(statusMarkup).join('')+'</ul>');
  }

  function mountHome(){
    insertHelp();
    const existing=document.getElementById('first-use-home-card');
    const progress=model.firstUseSteps(snapshot);
    const eligible=isStarted()||model.shouldOfferAutomatically(snapshot);
    const visible=Boolean(isAdmin()&&home()&&!isDismissed()&&eligible&&progress.completed<progress.total);
    if(!visible){existing?.remove();return;}
    const container=home();
    const card=existing||document.createElement('section');
    card.id='first-use-home-card';
    card.className='first-use-home-card';
    card.setAttribute('aria-label','Preparação da loja');
    card.innerHTML=summaryMarkup()+
      '<div class="first-use-actions">'+
      (progress.steps.some(step=>step.id==='products'&&step.status!=='done')?'<button type="button" class="primary-button" data-first-use-add-product>+ Cadastrar produto</button>':'')+
      '<button type="button" class="secondary-button" data-first-use-open>Continuar configuração</button>'+
      '<button type="button" class="secondary-button" data-first-use-tour>Conhecer o PDV</button>'+
      '<button type="button" class="first-use-later" data-first-use-later>Continuar depois</button></div>';
    if(!existing)container.insertBefore(card,container.firstChild.nextSibling);
    card.onclick=event=>{
      const control=event.target.closest('button');
      if(!control)return;
      if(control.hasAttribute('data-first-use-add-product'))void openStep('products');
      else if(control.hasAttribute('data-first-use-open'))void openGuide();
      else if(control.hasAttribute('data-first-use-tour'))void startTour();
      else if(control.hasAttribute('data-first-use-later'))dismiss();
      else if(control.dataset.firstUseStep)void openStep(control.dataset.firstUseStep);
    };
  }

  function maybeOffer(){
    const id=String(user()?.id||'');
    if(!id||!isAdmin()||autoOpened===id||isDismissed()||
       document.body.dataset.activeRoute!=='home'||!auth()?.classList.contains('hidden')||
       !document.getElementById('modal-root')?.classList.contains('hidden'))return;
    if(!model.shouldOfferAutomatically(snapshot))return;
    autoOpened=id;
    markStarted();
    mountHome(); // Orientação automática sem modal que bloqueie o Balcão ou o QA.
  }

  async function updateHome(){
    if(!user()){insertHelp();document.getElementById('first-use-home-card')?.remove();stopTour();return;}
    insertHelp();
    if(document.body.dataset.activeRoute==='home'&&isAdmin()){
      await readStatus();
      mountHome();
      window.setTimeout(maybeOffer,120);
    }
  }

  function openGuide(){
    if(!user())return;
    if(isAdmin()){markStarted();mountHome();}
    if(!window.PdvModal?.open)return;
    const state=model.firstUseSteps(snapshot);
    const modal='<div class="first-use-modal">'+summaryMarkup()+
      '<p class="first-use-note">A configuração pode ser retomada depois. O tutorial nunca cria produtos, pagamentos ou vendas sozinho.</p>'+
      '<div class="first-use-actions"><button type="button" class="primary-button" data-first-use-tour>Iniciar tour pelas telas</button>'+
      '<button type="button" class="secondary-button" data-first-use-refresh>Verificar etapas</button>'+
      '<button type="button" class="secondary-button" data-first-use-close>Continuar depois</button></div></div>';
    window.PdvModal.open('Ajuda · Prepare sua loja',modal,{onMount(root){
      root.querySelectorAll('[data-first-use-step]').forEach(button=>button.addEventListener('click',()=>{
        window.PdvModal.close();void openStep(button.dataset.firstUseStep);
      }));
      root.querySelector('[data-first-use-tour]')?.addEventListener('click',()=>{
        window.PdvModal.close();void startTour();
      });
      root.querySelector('[data-first-use-refresh]')?.addEventListener('click',()=>{
        window.PdvModal.close();void readStatus(true).then(openGuide);
      });
      root.querySelector('[data-first-use-close]')?.addEventListener('click',()=>{
        window.PdvModal.close();dismiss();
      });
    }});
    return state;
  }

  async function openStep(id){
    const item=model.firstUseSteps(snapshot).steps.find(step=>step.id===id);
    if(!item)return;
    if(id==='profile'){await openProfile();return;}
    if(id==='products'){
      const destination=item.status==='done'&&permitted('products')?'products':permitted('inventory')?'inventory':null;
      if(!destination){toast('Seu perfil não possui acesso ao cadastro de produtos.');return;}
      await navigation()?.navigate?.(destination);
      if(destination==='inventory'&&item.status!=='done')window.PdvCatalogAdmin?.openQuickStockProductForm?.();
      return;
    }
    if(!permitted(item.route)){
      toast('Seu perfil não possui acesso a essa área.');return;
    }
    await navigation()?.navigate?.(item.route);
    if(item.category){
      const openCategory=()=>document.querySelector('#settings-hub [data-settings-category="'+item.category+'"]')?.click();
      if(!document.querySelector('#settings-hub [data-settings-category="'+item.category+'"]'))queueMicrotask(openCategory);
      else openCategory();
    }
    if(document.body.dataset.activeRoute==='home')mountHome();
  }

  async function openProfile(){
    if(!isAdmin())return toast('Somente o administrador pode definir as áreas da loja.');
    try{
      const modules=Array.isArray(snapshot.modules)&&snapshot.modules.length?snapshot.modules:await api.modules();
      const formHtml='<form id="first-use-profile-form" class="first-use-profile-form">'+
        '<p>Escolha a operação e as áreas ativas. Nenhum módulo será alterado antes de salvar.</p>'+
        '<label class="field"><span>Nome do estabelecimento</span><input name="businessName" required minlength="2" maxlength="100" value="'+esc(snapshot.onboarding?.businessName||'')+'"></label>'+
        '<label class="field"><span>Tipo de operação</span><select name="segment">'+
          '<option value="GENERIC">Comércio em geral</option><option value="FOOD">Alimentação</option><option value="WHOLESALE">Atacado</option></select></label>'+
        '<fieldset class="first-use-module-options"><legend>Áreas opcionais</legend>'+
        (modules||[]).map(module=>'<label><input type="checkbox" name="moduleIds" value="'+esc(module.id)+'" '+(module.enabled?'checked':'')+'><span>'+esc(module.name)+' — '+esc(module.description||'')+'</span></label>').join('')+'</fieldset>'+
        '<p data-first-use-error role="alert"></p>'+
        '<div class="first-use-actions"><button type="submit" class="primary-button">Salvar configuração</button>'+
        '<button type="button" class="secondary-button" data-profile-cancel>Cancelar</button></div></form>';
      window.PdvModal.open('Dados e operação da loja',formHtml,{onMount(root){
        const form=root.querySelector('#first-use-profile-form');
        const segment=form.elements.segment;
        segment.value=snapshot.onboarding?.segment||'GENERIC';

        segment.addEventListener('change',async()=>{
          try{
            const recommendation=await api.request('/api/v1/vertical/onboarding/recommend?segment='+encodeURIComponent(segment.value));
            if(!form.isConnected)return;
            form.querySelectorAll('[name="moduleIds"]').forEach(input=>{
              input.checked=recommendation.moduleIds.includes(input.value);
            });
          }catch(error){root.querySelector('[data-first-use-error]').textContent=error.message;}
        });
        root.querySelector('[data-profile-cancel]').addEventListener('click',()=>window.PdvModal.close());
        form.addEventListener('submit',async event=>{
          event.preventDefault();
          const button=form.querySelector('[type="submit"]');
          button.disabled=true;
          const data=new FormData(form);
          try{
            const selected=data.getAll('moduleIds');
            await api.request('/api/v1/vertical/onboarding/complete',{
              method:'POST',
              body:{businessName:String(data.get('businessName')||'').trim(),
                segment:data.get('segment'),moduleIds:selected}
            });
            window.PdvModal.close();
            toast('Configuração da loja salva.','success');
            await readStatus(true);
            window.dispatchEvent(new Event('artisys:first-use-saved'));
          }catch(error){
            root.querySelector('[data-first-use-error]').textContent=error.message;
          }finally{button.disabled=false;}
        });
      }});
    }catch(error){toast('Não foi possível consultar as áreas: '+error.message);}
  }

  function removeHighlight(){
    highlighted?.classList.remove('first-use-tour-highlight');
    highlighted=null;
  }

  function stopTour(){
    tour=null;
    removeHighlight();
    tourPanel?.remove();tourPanel=null;
    document.removeEventListener('keydown',onTourKeydown);
  }

  function onTourKeydown(event){
    if(event.key==='Escape'){event.preventDefault();stopTour();}
  }

  async function displayTour(){
    if(!tour)return;
    const current=tour;
    const item=current.steps[current.index];
    if(!item){stopTour();return;}
    if(document.body.dataset.activeRoute!==item.route){
      await navigation()?.navigate?.(item.route);
      if(tour!==current)return;
    }
    removeHighlight();
    const selector='#app-sidebar [data-route="'+item.route+'"]';
    highlighted=document.querySelector(selector)&&!document.querySelector(selector).hidden
      ?document.querySelector(selector)
      :document.querySelector('#route-content .page-head, #route-content .ops-head, #route-content .classic-home-head');
    highlighted?.classList.add('first-use-tour-highlight');
    tourPanel?.remove();
    tourPanel=document.createElement('section');
    tourPanel.className='first-use-tour-panel';
    tourPanel.setAttribute('role','dialog');
    tourPanel.setAttribute('aria-label','Tour guiado do PDV');
    tourPanel.innerHTML='<span class="first-use-eyebrow">Tour guiado · '+(current.index+1)+' de '+current.steps.length+'</span>'+
      '<h2>'+esc(item.title)+'</h2><p>'+esc(item.description)+'</p>'+
      '<div class="first-use-actions">'+
        '<button type="button" class="secondary-button" data-tour-back '+(current.index===0?'disabled':'')+'>Anterior</button>'+
        '<button type="button" class="primary-button" data-tour-next>'+(current.index===current.steps.length-1?'Concluir':'Próximo')+'</button>'+
        '<button type="button" class="first-use-later" data-tour-close>Encerrar</button></div>';
    document.body.appendChild(tourPanel);
    tourPanel.querySelector('[data-tour-back]').addEventListener('click',()=>{current.index--;void displayTour();});
    tourPanel.querySelector('[data-tour-next]').addEventListener('click',()=>{
      if(current.index===current.steps.length-1){stopTour();return;}
      current.index++;void displayTour();
    });
    tourPanel.querySelector('[data-tour-close]').addEventListener('click',stopTour);
    tourPanel.querySelector('[data-tour-next]').focus({preventScroll:true});
  }

  async function startTour(){
    if(!user())return;
    stopTour();
    const modules=Array.isArray(snapshot.modules)?snapshot.modules:[];
    const steps=model.tourForUser(permitted,modules);
    if(!steps.length)return toast('Não há telas disponíveis para este perfil.');
    tour={steps,index:0};
    document.addEventListener('keydown',onTourKeydown);
    await displayTour();
  }

  lifecycle.on('route:mounted',({route})=>{
    if(tour&&route!==tour.steps[tour.index]?.route)stopTour();
    if(route==='home')void updateHome();
  });
  lifecycle.on('user:changed',()=>{
    const id=String(user()?.id||'');
    if(renderedUser!==id){
      renderedUser=id;
      snapshot={onboarding:null,products:null,cashSession:undefined,sales:null,modules:[]};
      lastRead=0;stopTour();
    }
    insertHelp();
  });
  lifecycle.on('auth:hidden',()=>{void updateHome();});
  window.addEventListener('artisys:first-use-saved',()=>{
    if(document.body.dataset.activeRoute==='home')void updateHome();
  });
  insertHelp();
  if(user())void updateHome();
  window.PdvFirstUseGuide=Object.freeze({open:openGuide,refresh:()=>readStatus(true),startTour});
})();
