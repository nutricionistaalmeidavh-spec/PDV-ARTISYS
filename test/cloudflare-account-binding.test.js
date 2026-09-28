'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

async function loadWorker(){return import('../cloudflare/account/src/worker.mjs');}
function request(path){return new Request(`https://account.example${path}`);}

function fakeD1(){
  return {
    prepare(){
      return {
        bind(){
          return {
            first:async()=>({
              installation_id:'install-1',
              license_id:'lic-1',
              activated_at:'2026-09-27T00:00:00.000Z',
              account_email:'owner@example.com',
              status:'ACTIVE',
              expires_at:null
            })
          };
        }
      };
    }
  };
}

test('Cloudflare account worker accepts the dashboard D1 binding named artisys',async()=>{
  const {handleRequest}=await loadWorker();
  const response=await handleRequest(
    request('/v1/license/status?installationId=install-1'),
    {artisys:fakeD1()}
  );

  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    active:true,
    installationId:'install-1',
    licenseId:'lic-1',
    accountEmail:'owner@example.com',
    activatedAt:'2026-09-27T00:00:00.000Z'
  });
});
