'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  const content=document.getElementById('route-content');
  if(!ApiClient||!content)return;
  const api=new ApiClient();
  let sellers=[];
  let loadedAt=0;
  let loading=null;
  let scheduled=false;

  async function loadSellers(force=false){
    if(!force&&sellers.length&&Date.now()-loadedAt<1000)return sellers;
    if(loading)return loading;
    loading=api.sellers().then(rows=>{
      sellers=Array.isArray(rows)?rows:[];
      loadedAt=Date.now();
      return sellers;
    }).finally(()=>{loading=null;});
    return loading;
  }

  async function syncCheckoutSeller(){
    const select=content.querySelector('#seller-select');
    if(!select||select.dataset.liveSellerSync==='done')return;
    select.dataset.liveSellerSync='loading';
    try{
      const current=select.value;
      const rows=await loadSellers();
      if(!select.isConnected)return;
      select.replaceChildren(...rows.map(seller=>{
        const option=document.createElement('option');
        option.value=String(seller.id);
        option.textContent=String(seller.name||seller.username||seller.id);
        return option;
      }));
      const next=rows.some(seller=>String(seller.id)===String(current))?String(current):String(rows[0]?.id||'');
      select.value=next;
      select.dataset.liveSellerSync='done';
      if(next&&next!==current)select.dispatchEvent(new Event('change',{bubbles:true}));
    }catch{
      if(select.isConnected)delete select.dataset.liveSellerSync;
    }
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    setTimeout(()=>{scheduled=false;void syncCheckoutSeller();},20);
  }

  document.addEventListener('submit',event=>{
    if(event.target?.id!=='seller-form')return;
    sellers=[];
    loadedAt=0;
  },true);
  new MutationObserver(schedule).observe(content,{childList:true,subtree:true});
  schedule();
})();
