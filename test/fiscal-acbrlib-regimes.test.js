'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compileLegacyTaxGroups}=require('../server/acbrlib/fiscal-tax-regimes');
const reviewed={reviewedBy:'Contador',reviewedAt:'2026-11-04',origin:'0'};
function tax(profile,crt='3',net=10000){return compileLegacyTaxGroups({profile:{...reviewed,...profile},crt,netCents:net});}
test('CRT3 uses reviewed ICMS 00, PIS 01 and COFINS 01 rates with exact totals',()=>{
 const result=tax({cst:'00',icms:{basePercent:'100.0000',rate:'18.0000'},
 pisCst:'01',pis:{rate:'1.6500'},cofinsCst:'01',cofins:{rate:'7.6000'}});
 assert.equal(result.sections.ICMS.CST,'00');
 assert.equal(result.sections.ICMS.vBC,'100.00');
 assert.equal(result.sections.ICMS.pICMS,'18.0000');
 assert.equal(result.sections.ICMS.vICMS,'18.00');
 assert.equal(result.sections.PIS.vPIS,'1.65');
 assert.equal(result.sections.COFINS.vCOFINS,'7.60');
 assert.deepEqual(result.totals,{icmsCents:1800,icmsBaseCents:10000,stCents:0,stBaseCents:0,pisCents:165,cofinsCents:760});
});
test('CRT3 CST 20 demands explicit basis reduction rather than implied tax rate',()=>{
 const result=tax({cst:'20',icms:{basePercent:'60.0000',reduction:'40.0000',rate:'18.0000'},
 pisCst:'06',cofinsCst:'06',zeroLegacyTaxesConfirmed:true});
 assert.equal(result.sections.ICMS.vBC,'60.00');
 assert.equal(result.sections.ICMS.pRedBC,'40.0000');
 assert.equal(result.sections.ICMS.vICMS,'10.80');
 assert.equal(result.totals.icmsCents,1080);
 assert.throws(()=>tax({cst:'20',icms:{basePercent:'60.0000',rate:'18.0000'},pisCst:'06',cofinsCst:'06',zeroLegacyTaxesConfirmed:true}),/redução|reducao|pRedBC/i);
});
test('simple regime supports CSOSN 500 retained ST only with reviewed retained figures',()=>{
 const result=tax({csosn:'500',icmsRetained:{baseCents:4000,amountCents:720},
 pisCst:'49',cofinsCst:'49',zeroLegacyTaxesConfirmed:true},'1');
 assert.equal(result.sections.ICMS.CSOSN,'500');
 assert.equal(result.sections.ICMS.vBCSTRet,'40.00');
 assert.equal(result.sections.ICMS.vICMSSTRet,'7.20');
 assert.equal(result.totals.stCents,0);
 assert.throws(()=>tax({csosn:'500',pisCst:'49',cofinsCst:'49',zeroLegacyTaxesConfirmed:true},'1'),/ST|retido/i);
});
test('simple regime CSOSN 201 requires explicit ICMS ST and credit rate',()=>{
 const result=tax({csosn:'201',icmsSt:{baseCents:12000,rate:'18.0000',amountCents:2160},
 simpleCredit:{rate:'1.0000',amountCents:100},
 pisCst:'49',cofinsCst:'49',zeroLegacyTaxesConfirmed:true},'1');
 assert.equal(result.sections.ICMS.CSOSN,'201');
 assert.equal(result.sections.ICMS.vBCST,'120.00');
 assert.equal(result.sections.ICMS.vICMSST,'21.60');
 assert.equal(result.sections.ICMS.vCredICMSSN,'1.00');
 assert.equal(result.totals.stCents,2160);
});
test('normal CST10 requires reviewed own ICMS and ST, no zero-default',()=>{
 const result=tax({cst:'10',icms:{basePercent:'100.0000',rate:'18.0000'},
 icmsSt:{baseCents:15000,rate:'18.0000',amountCents:2700},
 pisCst:'01',pis:{rate:'1.6500'},cofinsCst:'01',cofins:{rate:'7.6000'}});
 assert.equal(result.sections.ICMS.vICMS,'18.00');
 assert.equal(result.sections.ICMS.vICMSST,'27.00');
 assert.equal(result.totals.stCents,2700);
});
test('CRT2/4 have distinct explicit profiles and CST incompatible with Simples is refused',()=>{
 assert.equal(tax({csosn:'102',pisCst:'49',cofinsCst:'49',zeroLegacyTaxesConfirmed:true},'4').sections.ICMS.CSOSN,'102');
 assert.equal(tax({cst:'00',icms:{basePercent:'100.0000',rate:'18.0000'},pisCst:'49',cofinsCst:'49',zeroLegacyTaxesConfirmed:true},'2').sections.ICMS.CST,'00');
 assert.throws(()=>tax({cst:'00',icms:{basePercent:'100.0000',rate:'18.0000'},pisCst:'49',cofinsCst:'49'},'1'),/CSOSN|regime/i);
 assert.throws(()=>tax({csosn:'102',pisCst:'49',cofinsCst:'49'},'3'),/CST|regime/i);
});
test('PIS/COFINS non-taxed categories are not silently zeroed without review',()=>{
 assert.throws(()=>tax({cst:'40',pisCst:'07',cofinsCst:'07'}),/revis|confirm/i);
 const r=tax({cst:'40',pisCst:'07',cofinsCst:'07',zeroLegacyTaxesConfirmed:true});
 assert.equal(r.sections.PIS.CST,'07');assert.equal(r.sections.COFINS.CST,'07');
});
test('incorrect decimal rate, arithmetic overflow and missing ST block issuance',()=>{
 assert.throws(()=>tax({cst:'00',icms:{basePercent:'100.0000',rate:'99,99'},pisCst:'49',cofinsCst:'49'}),/alíquota|taxa|rate/i);
 assert.throws(()=>tax({cst:'10',icms:{basePercent:'100.0000',rate:'18.0000'},pisCst:'49',cofinsCst:'49',zeroLegacyTaxesConfirmed:true}),/ST/i);
 assert.throws(()=>tax({cst:'00',icms:{basePercent:'100.0000',rate:'18.0000'},pisCst:'01',cofinsCst:'01'}),/PIS|COFINS|alíquota/i);
});
