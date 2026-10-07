'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {priceConfigured}=require('../shared/order-composer');

const base={
  groups:[
    {id:'size',pricingMode:'ADDITIVE',options:[{id:'g',priceDeltaCents:500}]},
    {id:'flavors',pricingMode:'HIGHEST_FLAVOR',options:[{id:'cal',priceDeltaCents:400},{id:'mar',priceDeltaCents:200}]},
    {id:'crust',pricingMode:'ADDITIVE',options:[{id:'cat',priceDeltaCents:600}]}
  ],
  variants:[],
  combos:[]
};

test('shared preview matches highest-flavor pizza policy without UI-specific code',()=>{
  assert.equal(priceConfigured({
    basePriceCents:3000,
    configuration:base,
    selections:['g','cal','mar','cat']
  }),4500);
});

test('shared preview supports proportional-average groups generically',()=>{
  const configuration=JSON.parse(JSON.stringify(base));
  configuration.groups.find(group=>group.id==='flavors').pricingMode='PROPORTIONAL_AVERAGE';
  assert.equal(priceConfigured({
    basePriceCents:3000,
    configuration,
    selections:['g','cal','mar','cat']
  }),4400);
});
