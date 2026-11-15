#!/usr/bin/env node
'use strict';

// Open-source postproduction of the recorded Playwright/Electron tutorial.
// Captions are timed from the real QA step durations, never simulated scenes.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

function arg(name){const i=process.argv.indexOf('--'+name);return i<0?null:process.argv[i+1];}
function run(program,args){const result=spawnSync(program,args,{encoding:'utf8',maxBuffer:10*1024*1024});if(result.status!==0)throw Error(program+' failed: '+(result.stderr||result.stdout||result.error||'').slice(-3500));return result.stdout;}
const input=arg('input'),summaryPath=arg('summary'),output=arg('output');
if(!input||!summaryPath||!output)throw Error('Use --input MP4 --summary run-summary.json --output MP4');
const summary=JSON.parse(fs.readFileSync(summaryPath,'utf8'));
if(summary.status!=='passed'||!Array.isArray(summary.steps)||!summary.steps.length)throw Error('QA run did not pass');
for(const name of ['tela-de-login','autenticado','tour.record','abrir-cadastros','salvar-produto','ir-para-balcao','produto-no-carrinho','confirmar-pagamento','venda-finalizada','tutorial.assertSaleCompleted']){
  if(!summary.steps.some(s=>s.name===name&&s.status==='passed'))throw Error('Unverified tutorial stage: '+name);
}
let t=0;const timing={};
for(const step of summary.steps){
  timing[step.name]={start:t,end:t+step.durationMs/1000};
  t+=step.durationMs/1000;
}
const duration=Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',input]).trim());
if(!(duration>=20&&duration<360))throw Error('Unexpected real video duration: '+duration);
const chapters=[
  {start:0,end:timing.autenticado.end,caption:'1. Entre no PDV com seu usuário e senha'},
  {start:timing['abrir-ajuda-primeiros-passos'].start,end:timing['tour.record'].end,caption:'2. Conheça as áreas no tour guiado'},
  {start:timing['abrir-cadastros'].start,end:timing['salvar-produto'].end,caption:'3. Cadastre um produto para vender no Balcão'},
  {start:timing['produto-publicado'].start,end:timing['produto-no-carrinho'].end,caption:'4. Publique, localize e adicione o produto'},
  {start:timing['finalizar-venda'].start,end:timing['confirmar-pagamento'].end,caption:'5. Confira o total e confirme o pagamento'},
  {start:timing['venda-finalizada'].start,end:Math.min(duration,t+1),caption:'6. Venda concluída e registrada no PDV'}
];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-caption-'));
try {
  const font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const filters=chapters.map((c,i)=>{
    const cap=path.join(temp,'cap-'+i+'.txt');
    fs.writeFileSync(cap,c.caption+'\n','utf8');
    const start=Math.max(0,c.start-0.05).toFixed(2),end=Math.min(duration,c.end+0.30).toFixed(2);
    return 'drawtext=fontfile='+font+':textfile='+cap+
      ':fontsize=30:fontcolor=white:box=1:boxcolor=0x071B3C@0.86:boxborderw=18'+
      ':x=(w-text_w)/2:y=36:enable=\'between(t,'+start+','+end+')\'';
  });
  fs.mkdirSync(path.dirname(output),{recursive:true});
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-vf',filters.join(','),
    '-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p',
    '-movflags','+faststart','-an',output]);
  const size=fs.statSync(output).size;
  if(size<50000)throw Error('Empty tutorial video generated');
  console.log(JSON.stringify({output,durationSec:duration,sizeBytes:size,chapters:chapters.map(c=>c.caption)},null,2));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
