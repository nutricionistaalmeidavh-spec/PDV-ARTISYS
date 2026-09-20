'use strict';

(() => {
  const root=document.getElementById('route-content');
  if(!root)return;
  const aliases=Object.freeze({
    'reports-filter':'ops-report-filter',
    'reports-commission-rule':'ops-commission-rule'
  });
  function apply(){
    for(const [current,legacy] of Object.entries(aliases)){
      const node=document.getElementById(current);
      if(!node||document.getElementById(legacy))continue;
      const wrapper=document.createElement('div');
      wrapper.id=legacy;
      wrapper.className='reports-legacy-contract';
      node.parentNode.insertBefore(wrapper,node);
      wrapper.appendChild(node);
    }
  }
  new MutationObserver(apply).observe(root,{childList:true,subtree:true});
  apply();
})();
