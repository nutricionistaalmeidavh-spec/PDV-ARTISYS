'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const ROOT=path.join(__dirname,'..');
function matchingTests(prefix){return fs.readdirSync(path.join(ROOT,'test')).filter(name=>name.startsWith(prefix)&&name.endsWith('.test.js')).sort().map(name=>`test/${name}`);}
function buildCertificationPlan(){
 const fiscalBlocks=matchingTests('fiscal-block');
 return [
  {id:'unit-integration',required:true,command:'npm',args:['test'],description:'Suite unit/integration completa'},
  {id:'fiscal-blocks-contract-e2e',required:true,command:process.execPath,args:['--test',...fiscalBlocks],description:'Contratos e E2E deterministas fiscal-block P0-P25'},
  {id:'fiscal-security-hardening',required:true,command:process.execPath,args:['--test','test/fiscal-security-hardening.test.js'],description:'Seguranca P24'},
  {id:'fiscal-packaging-packs',required:true,command:process.execPath,args:['--test','test/fiscal-packaging-packs.test.js','test/fiscal-packaging-e2e.test.js','test/fiscal-pack-example.test.js'],description:'Packaging/runtime/Fiscal Packs P20-P21'},
  {id:'qa-full',required:true,command:'npm',args:['run','qa:full'],description:'QA Full'},
  {id:'verify-release',required:true,command:'npm',args:['run','verify:release'],description:'Gate final verify:release'}
 ];
}
function serializablePlan(plan){return plan.map(step=>({...step,command:step.command===process.execPath?'node':step.command}));}
function executeCertification({stdio='inherit'}={}){
 const plan=buildCertificationPlan();const startedAt=new Date().toISOString();const results=[];let failed=false;
 for(const step of plan){const start=Date.now();const result=spawnSync(step.command,step.args,{cwd:ROOT,stdio,env:{...process.env,ARTISYS_FISCAL_CERTIFICATION:'1'}});const status=Number.isInteger(result.status)?result.status:1;const record={id:step.id,required:step.required,status:status===0?'PASS':'FAIL',exitCode:status,durationMs:Date.now()-start};results.push(record);if(status!==0&&step.required){failed=true;break;}}
 const report={schemaVersion:1,startedAt,finishedAt:new Date().toISOString(),status:failed?'FAIL':'PASS',plan:serializablePlan(plan),results,externalHomologation:{requiredForProductionClaim:true,verified:false,note:'Este gate certifica o software local. Autorizacao real SEFAZ/NFS-e depende de credenciais e evidencias externas autorizadas.'}};
 fs.mkdirSync(path.join(ROOT,'release'),{recursive:true});fs.writeFileSync(path.join(ROOT,'release','fiscal-certification.json'),JSON.stringify(report,null,2)+'\n','utf8');return report;
}
if(require.main===module){if(process.argv.includes('--plan')){process.stdout.write(`${JSON.stringify(serializablePlan(buildCertificationPlan()),null,2)}\n`);}else{const report=executeCertification();process.stdout.write(`\nFISCAL CERTIFICATION: ${report.status}\n`);if(report.status!=='PASS')process.exitCode=1;}}
module.exports={buildCertificationPlan,executeCertification};