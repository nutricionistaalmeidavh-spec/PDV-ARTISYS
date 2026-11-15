#!/usr/bin/env node
'use strict';
// FFmpeg captions based only on steps successfully captured by Playwright.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const arg=n=>{const i=process.argv.indexOf('--'+n);return i<0?null:process.argv[i+1]};
function run(cmd,args){
 const p=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:10*1024*1024});
 if(p.status!==0)throw new Error(cmd+': '+(p.stderr||p.stdout||p.error||'').slice(-3200));
 return p.stdout;
}
const input=arg('input'),summaryPath=arg('summary'),output=arg('output');
if(!input||!summaryPath||!output)throw new Error('Use --input MP4 --summary run-summary.json --output MP4');
const summary=JSON.parse(fs.readFileSync(summaryPath,'utf8'));
if(summary.status!=='passed')throw new Error('O fluxo de QA não foi aprovado');
const timing={};let cursor=0;
for(const s of summary.steps||[]){
 timing[s.name]={start:cursor,end:cursor+s.durationMs/1000,status:s.status};
 cursor+=s.durationMs/1000;
}
const required=['autenticado','ver-detalhes-caixa-com-venda','anulacao-bloqueada','correcao-auditada','fechar-caixa-vazio','anulacao-auditada','cash.verifiedAnnul'];
for(const name of required)if(timing[name]?.status!=='passed')throw new Error('Etapa não comprovada: '+name);
const duration=Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',input]).trim());
if(!Number.isFinite(duration)||duration<30||duration>280)throw new Error('Duração não esperada do vídeo: '+duration);
const chapters=[
 {start:0,end:timing.autenticado.end,caption:'1. Acesse o PDV com perfil de administrador'},
 {start:timing['abrir-historico-caixa'].start,end:timing['ver-detalhes-caixa-com-venda'].end,caption:'2. Consulte responsáveis e histórico do caixa'},
 {start:timing['anulacao-bloqueada'].start,end:timing['corrigir-contagem'].start,caption:'3. Caixa com venda não pode ser anulado'},
 {start:timing['corrigir-contagem'].start,end:timing['correcao-auditada'].end,caption:'4. Corrija a contagem com justificativa'},
 {start:timing['abrir-caixa-vazio'].start,end:timing['ver-detalhes-caixa-vazio'].end,caption:'5. Abra e feche um caixa vazio de teste'},
 {start:timing['anular-caixa-vazio'].start,end:timing['anulacao-auditada'].end,caption:'6. Digite ANULAR e justifique a operação'},
 {start:timing['anulacao-auditada'].start,end:duration,caption:'7. Anulado: histórico e auditoria preservados'}
];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-video-caixa-'));
try {
 const font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
 const filters=chapters.map((chapter,index)=>{
  const textfile=path.join(temp,'caption-'+index+'.txt');
  fs.writeFileSync(textfile,chapter.caption,'utf8');
  const begin=Math.max(0,chapter.start-0.05).toFixed(2);
  const end=Math.min(duration,chapter.end+0.25).toFixed(2);
  return 'drawtext=fontfile='+font+':textfile='+textfile+
   ':fontsize=30:fontcolor=white:box=1:boxcolor=0x071b3c@0.89:boxborderw=16'+
   ':x=(w-text_w)/2:y=38:enable=\'between(t,'+begin+','+end+')\'';
 });
 fs.mkdirSync(path.dirname(output),{recursive:true});
 run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,
  '-vf',filters.join(','),'-c:v','libx264','-preset','veryfast','-crf','22',
  '-pix_fmt','yuv420p','-movflags','+faststart','-an',output]);
 const size=fs.statSync(output).size;
 if(size<50000)throw Error('MP4 final vazio');
 console.log(JSON.stringify({output,durationSec:duration,bytes:size,chapters:chapters.map(ch=>ch.caption)},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
