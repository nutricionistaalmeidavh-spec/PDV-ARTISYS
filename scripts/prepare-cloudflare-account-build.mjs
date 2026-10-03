import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function run(command,args,{cwd=process.cwd(),env=process.env}={}){
  const result=spawnSync(command,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(result.status!==0){
    const detail=[result.stdout,result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(detail||`Falha ao executar ${command} ${args.join(' ')}`);
  }
  return String(result.stdout||'');
}

function npmCommand(){return process.platform==='win32'?'npm.cmd':'npm';}
function npxCommand(){return process.platform==='win32'?'npx.cmd':'npx';}

export function parseD1List(stdout,databaseName='artisys'){
  let rows;
  try{rows=JSON.parse(String(stdout||'[]'));}catch{throw new Error('Nao foi possivel interpretar `wrangler d1 list --json`.');}
  if(!Array.isArray(rows))rows=Array.isArray(rows?.result)?rows.result:Array.isArray(rows?.databases)?rows.databases:[];
  const matches=rows.filter(item=>item?.name===databaseName||item?.database_name===databaseName);
  if(matches.length===0)throw new Error(`D1 ${databaseName} nao encontrado. O build nunca cria um banco novo automaticamente.`);
  if(matches.length>1)throw new Error(`Mais de um D1 chamado ${databaseName}; descoberta ambigua.`);
  return matches[0];
}

function databaseIdOf(row){
  const id=row?.uuid||row?.id||row?.database_id;
  if(!id)throw new Error('O D1 encontrado nao informou database_id/uuid.');
  return String(id);
}

export function buildWranglerConfig({
  databaseId,
  databaseName='artisys',
  r2BucketName='artisyspdv'
}={}){
  if(!databaseId)throw new Error('databaseId e obrigatorio.');
  return {
    name:'pdv-artisys',
    main:'cloudflare/account/src/worker.mjs',
    compatibility_date:'2026-10-03',
    keep_vars:true,
    secrets:{required:['ADMIN_TOKEN','ACTIVATION_PEPPER','RECOVERY_PEPPER']},
    d1_databases:[{
      binding:'artisys',
      database_name:databaseName,
      database_id:String(databaseId),
      migrations_dir:'cloudflare/account/migrations'
    }],
    r2_buckets:[{
      binding:'artisysr2',
      bucket_name:r2BucketName
    }],
    previews:{}
  };
}

export function buildPreviewWranglerConfig(){
  return {
    name:'pdv-artisys',
    main:'cloudflare/account/src/worker.mjs',
    compatibility_date:'2026-10-03',
    keep_vars:true,
    previews:{}
  };
}

export function writeWranglerConfig(config,{cwd=process.cwd()}={}){
  const target=path.join(cwd,'wrangler.jsonc');
  fs.writeFileSync(target,`${JSON.stringify(config,null,2)}\n`,'utf8');
  return target;
}

export function prepareCloudflareConfig({cwd=process.cwd(),env=process.env,runner=run}={}){
  const databaseName=String(env.ARTISYS_D1_DATABASE_NAME||'artisys').trim()||'artisys';
  const r2BucketName=String(env.ARTISYS_R2_BUCKET_NAME||'artisyspdv').trim()||'artisyspdv';
  let databaseId=String(env.ARTISYS_D1_DATABASE_ID||'').trim();
  if(!databaseId){
    const stdout=runner(npxCommand(),['--yes','wrangler@4.102.0','d1','list','--json'],{cwd,env});
    databaseId=databaseIdOf(parseD1List(stdout,databaseName));
  }
  return writeWranglerConfig(buildWranglerConfig({databaseId,databaseName,r2BucketName}),{cwd});
}

export function validateAccountWorker({cwd=process.cwd(),env=process.env,runner=run}={}){
  runner(npmCommand(),['run','test:cloudflare:account'],{cwd,env});
}

export async function main({cwd=process.cwd(),env=process.env}={}){
  validateAccountWorker({cwd,env});
  if(env.WORKERS_CI!=='1'){
    console.log('Cloudflare Workers CI nao detectado; configuracao de deploy nao foi gerada.');
    return;
  }
  if(env.WORKERS_CI_BRANCH&&env.WORKERS_CI_BRANCH!=='main'){
    const target=writeWranglerConfig(buildPreviewWranglerConfig(),{cwd});
    console.log(`Configuracao de preview preparada em ${path.relative(cwd,target)} sem acesso ao D1 de producao.`);
    return;
  }
  const target=prepareCloudflareConfig({cwd,env});
  console.log(`Configuracao de deploy preparada em ${path.relative(cwd,target)} para o Worker pdv-artisys.`);
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain)main().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
