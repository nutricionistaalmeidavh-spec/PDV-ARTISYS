'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('autoatendimento paired surface is absent while public table ordering remains canonical',()=>{
  const mobileDevices=read('js/domains/restaurant/mobile-device-service.js');
  const releaseMigrations=read('js/core/database/release-migrations.js');
  const runtime=read('js/core/pdv-runtime.js');
  const localServer=read('server/local-server.js');
  const verticalRouter=read('server/e48-e54-router.js');
  const mobileApp=read('server/mobile/app.js');
  const mobileStyles=read('server/mobile/styles.css');
  const verticalUi=read('desktop/renderer/vertical-modules.js');
  const finalUi=read('desktop/renderer/e48-e54-ui.js');
  const capabilities=read('release/capabilities.json');
  const customerCapabilities=read('release/customer-capabilities.json');
  const publicRouter=read('server/public-ordering-router.js');
  const publicOrdering=read('js/domains/restaurant/public-ordering.js');

  for(const source of [mobileDevices,releaseMigrations,runtime,localServer,verticalRouter,mobileApp,verticalUi,finalUi,capabilities,customerCapabilities]){
    assert.doesNotMatch(source,/SELF_SERVICE|self-service|Autoatendimento|autoatendimento/);
  }
  assert.doesNotMatch(mobileStyles,/\.self-service-/);
  assert.doesNotMatch(runtime,/createSelfService|selfService/);
  assert.doesNotMatch(localServer,/createSelfServiceMobileRouter|selfServiceMobileRouter/);
  assert.doesNotMatch(verticalRouter,/\/vertical\/self-service/);
  assert.doesNotMatch(finalUi,/renderSelfService|data-self-device|self-create/);
  assert.doesNotMatch(verticalUi,/data-food-capability="SELF_SERVICE"|Autoatendimento/);

  assert.doesNotMatch(mobileDevices,/TABLET/);
  assert.doesNotMatch(releaseMigrations,/device_type[^\n]*TABLET/);
  assert.match(publicRouter,/\/m\/:token|customer-menu|public/i);
  assert.match(publicOrdering,/publicContext|submitOrder/);
});

test('removed autoatendimento implementation files are not part of the runtime tree',()=>{
  assert.equal(fs.existsSync(path.join(root,'js/domains/self-service/self-service.js')),false);
  assert.equal(fs.existsSync(path.join(root,'server/self-service-mobile-router.js')),false);
});
