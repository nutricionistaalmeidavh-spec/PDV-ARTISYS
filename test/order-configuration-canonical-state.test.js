'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  validateConfiguration,
  formatConfiguration,
  priceConfigured
}=require('../shared/order-composer');

const configuration={
  configurationKind:'PIZZA',
  basePriceCents:3000,
  groups:[
    {id:'size',name:'Tamanho',selectionType:'SINGLE',minSelections:1,maxSelections:1,required:true,options:[
      {id:'p',name:'Pequena',priceDeltaCents:0},
      {id:'g',name:'Grande',priceDeltaCents:500}
    ]},
    {id:'flavors',name:'Sabores',selectionType:'MULTIPLE',minSelections:1,maxSelections:2,required:true,
      selectionLimit:{sourceGroupId:'size',maxByOptionId:{p:1,g:2}},
      pricingMode:'HIGHEST_FLAVOR',options:[
        {id:'cal',name:'Calabresa',priceDeltaCents:400},
        {id:'mar',name:'Marguerita',priceDeltaCents:200}
      ]},
    {id:'crust',name:'Borda',selectionType:'SINGLE',minSelections:0,maxSelections:1,required:false,options:[
      {id:'cat',name:'Catupiry',priceDeltaCents:600}
    ]}
  ],
  variants:[],
  combos:[]
};

test('generic validation applies dependent option limits without pizza-specific UI state',()=>{
  assert.match(validateConfiguration(configuration,{selections:[]}),/Tamanho/);
  assert.match(validateConfiguration(configuration,{selections:['p','cal','mar']}),/Sabores.*1/);
  assert.equal(validateConfiguration(configuration,{selections:['g','cal','mar','cat']}),'');
});

test('generic preview uses canonical pricing metadata',()=>{
  assert.equal(priceConfigured({basePriceCents:3000,configuration,selections:['g','cal','mar','cat']}),4500);
});

test('persisted pizza snapshot has one canonical human-readable summary',()=>{
  assert.equal(formatConfiguration({pizza:{
    size:{id:'g',name:'Grande'},
    flavors:[
      {id:'cal',name:'Calabresa',fraction:0.5},
      {id:'mar',name:'Marguerita',fraction:0.5}
    ],
    crust:{id:'cat',name:'Catupiry'}
  }}),'Grande · ½ Calabresa + ½ Marguerita · Borda Catupiry');
});

test('generic snapshot formatting remains supported',()=>{
  assert.equal(formatConfiguration({
    variant:{name:'500 ml'},
    options:[{groupName:'Extras',name:'Gelo'}],
    comboSelections:[{groupName:'Acompanhamento',productName:'Batata'}]
  }),'500 ml · Gelo · Batata');
});
