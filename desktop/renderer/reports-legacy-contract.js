'use strict';

(() => {
  const root=document.getElementById('route-content');
  if(!root)return;
  const aliases=Object.freeze({
    'reports-filter':'ops-report-filter',
    'reports-commission-rule':'ops-commission-rule',
    'reports-export':'ops-export-sales'
  });
  function apply(){
    for(const [current,legacy] of Object.entries(aliases)){
      const node=document.getElementById(current);
      if(node)node.id=legacy;
    }
  }
  new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  apply();
})();
