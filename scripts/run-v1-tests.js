'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const testDir=path.join(process.cwd(),'test');
const excluded=name=>name==='e20-fiscal.test.js'||name.startsWith('fiscal-');
const files=fs.readdirSync(testDir)
  .filter(name=>name.endsWith('.test.js')&&!excluded(name))
  .sort()
  .map(name=>path.join('test',name));

if(!files.length){console.error('Nenhum teste V1 encontrado.');process.exit(1);}

const extraArgs=process.argv.slice(2);
const result=spawnSync(process.execPath,['--test',...extraArgs,...files],{
  stdio:'inherit',
  env:process.env
});
if(result.error){console.error(result.error);process.exit(1);}
process.exit(result.status??1);
