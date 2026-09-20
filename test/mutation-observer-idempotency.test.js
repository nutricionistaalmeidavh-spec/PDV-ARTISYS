'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const rendererDir=path.join(__dirname,'../desktop/renderer');
const read=file=>fs.readFileSync(path.join(rendererDir,file),'utf8');

function between(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  const end=source.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0,`missing start marker: ${startMarker}`);
  assert.ok(end>start,`missing end marker after: ${startMarker}`);
  return source.slice(start,end);
}

function assertBefore(block,guard,mutations,label){
  const guardIndex=block.indexOf(guard);
  assert.ok(guardIndex>=0,`${label}: missing guard ${guard}`);
  for(const mutation of mutations){
    const mutationIndex=block.indexOf(mutation);
    assert.ok(mutationIndex>=0,`${label}: missing mutation ${mutation}`);
    assert.ok(guardIndex<mutationIndex,`${label}: guard must run before DOM mutation ${mutation}`);
  }
}

test('every renderer MutationObserver is explicitly covered by the idempotency audit',()=>{
  const actual=fs.readdirSync(rendererDir)
    .filter(file=>file.endsWith('.js')&&read(file).includes('MutationObserver'))
    .sort();
  const expected=[
    'backend-parity-ui.js',
    'delivery-address-ui.js',
    'e48-e54-ui.js',
    'product-variants-ui.js',
    'sale-observation-ui.js',
    'seller-select-sync.js',
    'store-branding-ui.js',
    'vertical-parity-p1.js'
  ].sort();
  assert.deepEqual(actual,expected,'new or removed MutationObserver requires an explicit idempotency review');
});

test('module-manager observers guard already-bound buttons before changing watched child nodes',()=>{
  const p1=read('vertical-parity-p1.js');
  const p1Block=between(p1,'function mountExtraWorkspaceEntries()','async function mountPizzeria()');
  assertBefore(
    p1Block,
    "if(button.dataset.parityWorkspaceBound==='1')return;",
    ['button.disabled=false;',"replaceChildren(document.createTextNode('Abrir módulo'))"],
    'vertical-parity-p1'
  );

  const e48=read('e48-e54-ui.js');
  const e48Block=between(e48,'function patchModuleManager(root=document){','const observer=new MutationObserver');
  assertBefore(
    e48Block,
    'if(button.dataset.e48Bound)return;',
    ['button.disabled=false;',"span.textContent='Abrir módulo'"],
    'e48-e54-ui'
  );
});

test('remaining renderer observers have a pre-mutation guard, lock, or scheduler',()=>{
  const seller=read('seller-select-sync.js');
  assert.match(seller,/if \(select === observedSelect \|\| activeRequest\) return;[\s\S]*observedSelect = select;[\s\S]*select\.replaceChildren\(fragment\)/);
  assert.match(seller,/if \(select !== observedSelect\) void synchronizeSellerSelect\(\)/);

  const sale=read('sale-observation-ui.js');
  assert.match(sale,/if \(!card \|\| card\.querySelector\('\[data-sale-observation-detail\]'\)\) return;[\s\S]*card\.appendChild\(block\)/);
  assert.match(sale,/if \(!panel \|\| !finalize \|\| panel\.querySelector\('\[data-sale-observation\]'\)\) return;[\s\S]*panel\.insertBefore\(block, finalize\)/);

  const branding=read('store-branding-ui.js');
  assert.match(branding,/if\(mounting\|\|!content\)return;[\s\S]*mounting=true;[\s\S]*(?:page\.insertBefore\(card,firstGrid\)|page\.appendChild\(card\))[\s\S]*page\.dataset\.storeBrandingMounted='true'/);

  const delivery=read('delivery-address-ui.js');
  assert.match(delivery,/if\(form\.querySelector\('\[data-customer-address\]'\)\)return;[\s\S]*(?:grid\.insertBefore\(section,active\)|grid\.appendChild\(section\))/);
  assert.match(delivery,/if\(form\.querySelector\('\[data-delivery-address\]'\)\)return;[\s\S]*form\.appendChild\(block\)/);
  assert.match(delivery,/if\(article\.querySelector\('\[data-delivery-summary\]'\)\)return;[\s\S]*appendChild\(summary\)/);

  const variants=read('product-variants-ui.js');
  assert.match(variants,/if\(enhancing\)return;enhancing=true;/);
  assert.match(variants,/if\(scheduled\)return;scheduled=true;/);
  assert.match(variants,/new MutationObserver\(scheduleEnhance\)\.observe\(content,\{childList:true\}\)/);

  const backend=read('backend-parity-ui.js');
  for(const marker of ['#backend-parity-stock','#backend-terminal-stock','#backend-return-cancel','#backend-finance-parity','#backend-services-lifecycle','#backend-workshop-lifecycle']){
    assert.ok(backend.includes(marker),`backend-parity-ui missing idempotency marker ${marker}`);
  }
});
