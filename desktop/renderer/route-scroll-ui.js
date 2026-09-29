'use strict';

(() => {
  const content=document.getElementById('route-content');
  if(!content)return;
  const positions=new Map();
  let surface='';let restoreNext=false;let scheduled=false;
  const surfaceKey=()=>{const route=document.body.dataset.activeRoute||'unknown';const title=content.querySelector('h1')?.textContent?.trim()||'';return title?`${route}:${title}`:route;};
  const currentTop=()=>Math.max(content.scrollTop||0,document.documentElement.scrollTop||0,document.body.scrollTop||0);
  const moveTo=top=>{content.scrollTo?.({top,behavior:'auto'});content.scrollTop=top;window.scrollTo?.({top,behavior:'auto'});};
  const reconcile=()=>{scheduled=false;const next=surfaceKey();if(!next||next===surface)return;if(surface)positions.set(surface,currentTop());const top=restoreNext?(positions.get(next)||0):0;surface=next;restoreNext=false;requestAnimationFrame(()=>moveTo(top));};
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(reconcile);};
  document.addEventListener('click',event=>{restoreNext=Boolean(event.target.closest?.('[data-scroll-restore],.sidebar-back,[id$="-back"],[data-back]'));},true);
  new MutationObserver(schedule).observe(content,{childList:true,subtree:true});
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['data-active-route']});
  schedule();
})();
