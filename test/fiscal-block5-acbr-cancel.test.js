'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createAcbrMonitorAdapter}=require('../server/fiscal-sidecar/acbr-monitor-adapter');
const {parseAcbrCancellationResponse}=require('../server/fiscal-sidecar/acbr-monitor-protocol');

test('P11 parses registered cancellation event with protocol',()=>{
  const result=parseAcbrCancellationResponse('[EVENTO]\r\nCStat=135\r\nXMotivo=Evento registrado e vinculado a NF-e\r\nChNFe=35260912345678000123650010000000411234567890\r\nNProt=135260000009999\r\n');
  assert.equal(result.ok,true);assert.equal(result.data.cStat,135);assert.equal(result.data.protocolo,'135260000009999');
});

test('P11 ACBr adapter selects NFC-e model and sends CancelarNFe with key reason and issuer',async()=>{
  const commands=[];
  const transport={send:async command=>{commands.push(command);if(command==='NFe.SetModeloDF(65)')return 'OK: Modelo definido';return '[EVENTO]\r\nCStat=135\r\nXMotivo=Evento registrado e vinculado a NF-e\r\nChNFe=35260912345678000123650010000000411234567890\r\nNProt=135260000009999\r\n';}};
  const adapter=createAcbrMonitorAdapter({transport});
  const result=await adapter.cancel({type:'nfce',environment:'homologation',accessKey:'35260912345678000123650010000000411234567890',issuerCnpj:'12345678000195',justification:'Erro de digitacao identificado no documento'});
  assert.equal(result.ok,true);assert.deepEqual(commands,[
    'NFe.SetModeloDF(65)',
    'NFe.CancelarNFe("35260912345678000123650010000000411234567890","Erro de digitacao identificado no documento","12345678000195")'
  ]);
});

test('P11 ACBr cancellation timeout remains indeterminate and is never reported as cancelled',async()=>{
  let calls=0;const adapter=createAcbrMonitorAdapter({transport:{send:async command=>{calls+=1;if(command==='NFe.SetModeloDF(65)')return 'OK';throw new Error('Timeout aguardando resposta do ACBrMonitor.');}}});
  const result=await adapter.cancel({type:'nfce',environment:'homologation',accessKey:'35260912345678000123650010000000411234567890',issuerCnpj:'12345678000195',justification:'Erro de digitacao identificado no documento'});
  assert.equal(calls,2);assert.equal(result.ok,false);assert.equal(result.indeterminate,true);assert.equal(result.status,408);
});
