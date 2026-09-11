'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {VERTICAL_SCHEMA_VERSION}=require('../js/core/database/vertical-migrations');

const admin={userId:'admin',role:'admin',terminalId:'PDV-01'};
function setup(){
  let seq=0;
  const rt=createPdvRuntime({
    dbPath:':memory:',
    idFactory:p=>`${p}-${++seq}`,
    now:()=>`2026-09-11T10:${String(Math.floor(seq/60)).padStart(2,'0')}:${String(seq%60).padStart(2,'0')}.000Z`,
    appVersion:'1.3.0',serverVersion:'1.3.0'
  });
  rt.catalog.createUser({id:'admin',username:'admin',name:'Admin',role:'admin',password:'senha-forte-123'},admin);
  rt.catalog.upsertCustomer({id:'cust-1',name:'Cliente Teste',phone:'16999999999'},admin);
  return rt;
}

test('E48-E54 advance vertical schema to v8 and expose final modular services',()=>{
  const rt=setup();
  try{
    assert.equal(VERTICAL_SCHEMA_VERSION,8);
    for(const name of ['retail','services','workshop','selfService','onboarding','mobileAccess','hardwareCompatibility']){
      assert.ok(rt[name],`runtime.${name} deve existir`);
    }
  }finally{rt.close();}
});

test('E48 retail reuses E40 variant and keeps stock per variant through canonical sale',async()=>{
  const rt=setup();
  try{
    rt.modules.setEnabled('RETAIL',true,admin);
    rt.catalog.upsertProduct({id:'shirt',name:'Camiseta',salePriceCents:10000,costCents:3500,trackStock:false},admin);
    rt.catalogCustomization.upsertVariant({id:'shirt-red-m',productId:'shirt',name:'Vermelha M',sku:'CAM-VM',barcode:'789100000001',priceDeltaCents:1000,costCents:4000},admin);
    rt.retail.setVariantStock('shirt-red-m',5,admin);
    assert.equal(rt.retail.getVariantStock('shirt-red-m').quantity,5);
    assert.equal(rt.retail.searchVariants('CAM-VM')[0].variantId,'shirt-red-m');
    const sale=rt.sales.openSale({id:'sale-retail',saleNumber:'R1',terminalId:'PDV-01',operatorId:'admin'},admin);
    const withItem=rt.retail.addVariantToSale(sale.id,{variantId:'shirt-red-m',quantity:2},admin);
    assert.equal(withItem.totalCents,22000);
    assert.equal(withItem.items[0].configuration.retailVariant.id,'shirt-red-m');
    rt.sales.completeSale(sale.id,{payments:[{method:'PIX',amountCents:22000}],actor:admin});
    await rt.dispatchPending();
    assert.equal(rt.retail.getVariantStock('shirt-red-m').quantity,3);
  }finally{rt.close();}
});

test('E49 services schedules locally, blocks professional overlap and creates canonical sale with commission',async()=>{
  const rt=setup();
  try{
    rt.modules.setEnabled('SERVICES',true,admin);
    const service=rt.services.upsertService({id:'svc-cut',name:'Corte',durationMinutes:30,priceCents:5000},admin);
    assert.equal(service.priceCents,5000);
    const pro=rt.services.upsertProfessional({id:'pro-ana',name:'Ana',defaultCommissionBps:2000},admin);
    rt.services.linkProfessional(service.id,pro.id,{commissionBps:2000},admin);
    const appointment=rt.services.scheduleAppointment({id:'appt-1',serviceId:service.id,professionalId:pro.id,customerId:'cust-1',startsAt:'2026-09-12T10:00:00.000Z'},admin);
    assert.equal(appointment.endsAt,'2026-09-12T10:30:00.000Z');
    assert.throws(()=>rt.services.scheduleAppointment({serviceId:service.id,professionalId:pro.id,customerId:'cust-1',startsAt:'2026-09-12T10:15:00.000Z'},admin),/conflito/i);
    rt.services.updateAppointmentStatus(appointment.id,'IN_PROGRESS',admin);
    rt.services.updateAppointmentStatus(appointment.id,'COMPLETED',admin);
    const sale=rt.services.createSale(appointment.id,{terminalId:'PDV-01',operatorId:'admin'},admin);
    assert.equal(sale.totalCents,5000);
    rt.sales.completeSale(sale.id,{payments:[{method:'PIX',amountCents:5000}],actor:admin});
    await rt.dispatchPending();
    const report=rt.services.commissionReport();
    assert.equal(report.totalCommissionCents,1000);
    assert.equal(report.rows[0].professionalId,'pro-ana');
  }finally{rt.close();}
});

test('E50 workshop requires Services, records approval and closes ready work order into canonical sale',()=>{
  const rt=setup();
  try{
    assert.throws(()=>rt.modules.setEnabled('WORKSHOP',true,admin),/SERVICES/);
    rt.modules.setEnabled('SERVICES',true,admin);
    rt.modules.setEnabled('WORKSHOP',true,admin);
    rt.catalog.upsertProduct({id:'filter',name:'Filtro de óleo',salePriceCents:3000,costCents:1500,trackStock:false},admin);
    const labor=rt.services.upsertService({id:'svc-oil',name:'Troca de óleo',durationMinutes:45,priceCents:7000},admin);
    const asset=rt.workshop.upsertAsset({id:'veh-1',customerId:'cust-1',kind:'VEHICLE',identifier:'ABC1D23',make:'Honda',model:'Civic'},admin);
    const order=rt.workshop.openWorkOrder({id:'wo-1',customerId:'cust-1',assetId:asset.id,complaint:'Revisão'},admin);
    rt.workshop.addItem(order.id,{kind:'PART',productId:'filter',quantity:1},admin);
    rt.workshop.addItem(order.id,{kind:'LABOR',serviceId:labor.id,quantity:1},admin);
    rt.workshop.updateStatus(order.id,'DIAGNOSIS',{diagnosis:'Troca necessária'},admin);
    rt.workshop.updateStatus(order.id,'QUOTED',{},admin);
    assert.throws(()=>rt.workshop.updateStatus(order.id,'APPROVED',{},admin),/aprova/i);
    rt.workshop.updateStatus(order.id,'APPROVED',{approvalNote:'Cliente aprovou no balcão'},admin);
    rt.workshop.updateStatus(order.id,'IN_PROGRESS',{},admin);
    rt.workshop.updateStatus(order.id,'READY',{},admin);
    const sale=rt.workshop.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin'},admin);
    assert.equal(sale.totalCents,10000);
    assert.equal(rt.workshop.getWorkOrder(order.id).status,'CLOSED');
    assert.equal(rt.workshop.getWorkOrder(order.id).saleId,sale.id);
  }finally{rt.close();}
});

test('E51 self-service uses paired device and creates pickup order without electronic payment integration',()=>{
  const rt=setup();
  try{
    rt.modules.setEnabled('SELF_SERVICE',true,admin);
    rt.catalog.upsertProduct({id:'snack',name:'Salgado',salePriceCents:1200,trackStock:false},admin);
    const device=rt.mobileDevices.createDevice({id:'totem-1',name:'Totem 1',deviceType:'SELF_SERVICE'},admin);
    rt.selfService.configureDevice(device.id,{mode:'PICKUP'},admin);
    const context=rt.selfService.context(device.id);
    assert.equal(context.profile.mode,'PICKUP');
    assert.ok(context.products.some(p=>p.id==='snack'));
    const order=rt.selfService.submitOrder(device.id,{terminalId:'SELF-SERVICE',operatorId:'admin',items:[{productId:'snack',quantity:2}],note:'Sem guardanapo'},admin,'mut-self-1');
    assert.equal(order.dailyNumber,1);
    assert.ok(order.saleId);
    assert.equal(rt.sales.getSale(order.saleId).status,'OPEN');
    assert.equal(rt.sales.getSale(order.saleId).totalCents,2400);
  }finally{rt.close();}
});

test('E52 onboarding recommends editable module sets and persists completion',()=>{
  const rt=setup();
  try{
    const recommended=rt.onboarding.recommend('PIZZERIA');
    assert.ok(recommended.moduleIds.includes('PIZZERIA'));
    assert.ok(recommended.moduleIds.includes('DELIVERY'));
    const state=rt.onboarding.complete({businessName:'Pizzaria Teste',segment:'PIZZERIA',moduleIds:['PIZZERIA','DELIVERY']},admin);
    assert.equal(state.completed,true);
    assert.equal(state.businessName,'Pizzaria Teste');
    assert.equal(rt.modules.isEnabled('PIZZERIA'),true);
    assert.equal(rt.modules.isEnabled('DELIVERY'),true);
    assert.equal(rt.modules.isEnabled('RETAIL'),false);
    assert.equal(rt.onboarding.getState().segment,'PIZZERIA');
  }finally{rt.close();}
});

test('E53 mobile access generates local HTTP QR material without claiming HTTPS or PWA',()=>{
  const rt=setup();
  try{
    const access=rt.mobileAccess.getLanAccess({host:'192.168.1.10',port:4174,path:'/mobile'});
    assert.equal(access.url,'http://192.168.1.10:4174/mobile');
    assert.match(access.qrSvg,/^<svg/);
    assert.match(access.qrSvg,/data-qr-payload=/);
    assert.equal(access.security,'trusted-lan-http');
    assert.equal(access.installablePwa,false);
    assert.doesNotMatch(access.url,/https:/);
  }finally{rt.close();}
});

test('E54 hardware evidence is versioned and untested physical models stay BLOCKED_EXTERNAL',()=>{
  const rt=setup();
  try{
    const evidence=rt.hardwareCompatibility.recordEvidence({
      manufacturer:'Epson',model:'TM-T20',kind:'PRINTER',connection:'USB',driver:'Windows',configuration:{mode:'electron'},
      os:'Windows 11 x64',testedAt:'2026-09-11T12:00:00.000Z',status:'BLOCKED_EXTERNAL',result:'Equipamento físico não disponível neste ambiente.',limitations:'Necessita teste físico.'
    },admin);
    assert.equal(evidence.status,'BLOCKED_EXTERNAL');
    assert.throws(()=>rt.hardwareCompatibility.recordEvidence({manufacturer:'Teste',model:'X',kind:'PRINTER',connection:'USB',os:'Windows',testedAt:'2026-09-11T12:00:00.000Z',status:'VERIFIED'},admin),/resultado/i);
    assert.equal(rt.hardwareCompatibility.listEvidence().length,1);
    const matrix=JSON.parse(fs.readFileSync(path.join(__dirname,'..','release','hardware-compatibility.json'),'utf8'));
    assert.ok(Array.isArray(matrix.entries));
    assert.ok(matrix.entries.every(item=>item.status!=='VERIFIED'||Boolean(item.evidence)));
  }finally{rt.close();}
});
