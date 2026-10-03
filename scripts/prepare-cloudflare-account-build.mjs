import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const WRANGLER=['--yes','wrangler@4.102.0'];
const WORKER_NAME='pdv-artisys';

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

function parseJson(stdout,label){
  try{return JSON.parse(String(stdout||''));}
  catch{throw new Error(`Nao foi possivel interpretar ${label}.`);}
}

function asRows(value){
  if(Array.isArray(value))return value;
  if(Array.isArray(value?.result))return value.result;
  if(Array.isArray(value?.versions))return value.versions;
  if(Array.isArray(value?.deployments))return value.deployments;
  return [];
}

export function parseD1List(stdout,databaseName='artisys'){
  const rows=asRows(parseJson(stdout,'`wrangler d1 list --json`'));
  const matches=rows.filter(item=>item?.name===databaseName||item?.database_name===databaseName);
  if(matches.length===0)throw new Error(`D1 ${databaseName} nao encontrado. O build nunca cria um banco novo automaticamente.`);
  if(matches.length>1)throw new Error(`Mais de um D1 chamado ${databaseName}; descoberta ambigua.`);
  return matches[0];
}

function databaseIdOf(row){
  const id=row?.uuid||row?.id||row?.database_id||row?.databaseId;
  if(!id)throw new Error('O D1 encontrado nao informou database_id/uuid.');
  return String(id);
}

export function parseLatestVersionId(stdout){
  const rows=asRows(parseJson(stdout,'`wrangler versions list --json`'));
  const row=rows[0];
  const id=row?.id||row?.version_id||row?.versionId;
  if(!id)throw new Error('Nenhuma versao existente do Worker informou version id.');
  return String(id);
}

function walkObjects(value,visit){
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value))visit(value);
  if(Array.isArray(value)){for(const item of value)walkObjects(item,visit);return;}
  for(const child of Object.values(value))walkObjects(child,visit);
}

function bindingName(row){
  return String(row?.binding||row?.name||row?.variable_name||row?.variableName||'');
}

export function parseLiveBindings(stdout,{
  d1Binding='artisys',
  r2Binding='artisysr2'
}={}){
  const payload=parseJson(stdout,'`wrangler versions view --json`');
  let databaseId='';
  let databaseName='';
  let r2BucketName='';
  walkObjects(payload,row=>{
    const name=bindingName(row);
    if(name===d1Binding&&!databaseId){
      const id=row.database_id||row.databaseId||row.id||row.uuid;
      const type=String(row.type||row.kind||'').toLowerCase();
      if(id&&(!type||type.includes('d1')||row.database_id||row.databaseId)){
        databaseId=String(id);
        databaseName=String(row.database_name||row.databaseName||row.resource_name||row.resourceName||'artisys');
      }
    }
    if(name===r2Binding&&!r2BucketName){
      const bucket=row.bucket_name||row.bucketName||row.bucket||row.resource_name||row.resourceName;
      const type=String(row.type||row.kind||'').toLowerCase();
      if(bucket&&(!type||type.includes('r2')||row.bucket_name||row.bucketName)){
        r2BucketName=String(bucket);
      }
    }
  });
  if(!databaseId)throw new Error(`Binding D1 ${d1Binding} nao encontrado na versao ativa do Worker.`);
  return {databaseId,databaseName:databaseName||'artisys',r2BucketName:r2BucketName||null};
}

export function buildWranglerConfig({
  databaseId,
  databaseName='artisys',
  r2BucketName='artisyspdv'
}={}){
  if(!databaseId)throw new Error('databaseId e obrigatorio.');
  return {
    name:WORKER_NAME,
    main:'cloudflare/account/src/worker.mjs',
    compatibility_date:'2026-10-03',
    keep_vars:true,
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

export function writeWranglerConfig(config,{cwd=process.cwd()}={}){
  const target=path.join(cwd,'wrangler.jsonc');
  fs.writeFileSync(target,`${JSON.stringify(config,null,2)}\n`,'utf8');
  return target;
}

function wrangler(runner,args,{cwd,env}){
  return runner(npxCommand(),[...WRANGLER,...args],{cwd,env});
}

export function discoverExistingBindings({cwd=process.cwd(),env=process.env,runner=run}={}){
  const configuredId=String(env.ARTISYS_D1_DATABASE_ID||'').trim();
  const configuredName=String(env.ARTISYS_D1_DATABASE_NAME||'artisys').trim()||'artisys';
  const configuredBucket=String(env.ARTISYS_R2_BUCKET_NAME||'').trim();

  if(configuredId){
    return {
      databaseId:configuredId,
      databaseName:configuredName,
      r2BucketName:configuredBucket||'artisyspdv',
      source:'build-env'
    };
  }

  try{
    const versions=wrangler(runner,['versions','list','--name',WORKER_NAME,'--json'],{cwd,env});
    const versionId=parseLatestVersionId(versions);
    const view=wrangler(runner,['versions','view',versionId,'--name',WORKER_NAME,'--json'],{cwd,env});
    const live=parseLiveBindings(view);
    return {
      databaseId:live.databaseId,
      databaseName:live.databaseName||configuredName,
      r2BucketName:configuredBucket||live.r2BucketName||'artisyspdv',
      source:'live-worker'
    };
  }catch(liveError){
    try{
      const stdout=wrangler(runner,['d1','list','--json'],{cwd,env});
      const row=parseD1List(stdout,configuredName);
      return {
        databaseId:databaseIdOf(row),
        databaseName:configuredName,
        r2BucketName:configuredBucket||'artisyspdv',
        source:'d1-list'
      };
    }catch(d1Error){
      throw new Error(
        'Nao foi possivel preservar o D1 existente do pdv-artisys. '+
        'O deploy foi bloqueado para nao criar/remover bindings. '+
        'Defina ARTISYS_D1_DATABASE_ID no build ou ajuste a permissao do build token.\n'+
        `Worker atual: ${liveError.message}\nD1 list: ${d1Error.message}`
      );
    }
  }
}

export function prepareCloudflareConfig({cwd=process.cwd(),env=process.env,runner=run}={}){
  const bindings=discoverExistingBindings({cwd,env,runner});
  return writeWranglerConfig(buildWranglerConfig(bindings),{cwd});
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
  const target=prepareCloudflareConfig({cwd,env});
  console.log(`Configuracao de deploy preparada em ${path.relative(cwd,target)} para o Worker ${WORKER_NAME}.`);
}

const isMain=process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href;
if(isMain)main().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
