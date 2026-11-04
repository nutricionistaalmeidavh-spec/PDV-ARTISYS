'use strict';
// Only verifies OFFLINE bundles compiled from ACBr OSS sources.
// Verification does not enable fiscal emission, open certificate files, or contact SEFAZ.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const OFFICIAL_SOURCE='https://svn.code.sf.net/p/acbr/code/trunk2';
const HEX=/^[a-f0-9]{64}$/;
const SAFE=/^(?:[A-Za-z0-9._-]+|deps\/[A-Za-z0-9._-]+\.dll)$/;
const REQUIRED=['ACBrNFe64.dll','acbrlib-worker.exe','THIRD_PARTY_LICENSES.txt'];
function invalid(reason){return Object.freeze({valid:false,reason});}
function verifyAcbrBundle({resourcesPath,platform=process.platform,arch=process.arch}={}){
 if(platform!=='win32'||arch!=='x64')return invalid('unsupported-platform');
 if(!resourcesPath||!path.isAbsolute(resourcesPath))return invalid('invalid-root');
 const dir=path.join(resourcesPath,'fiscal'),file=path.join(dir,'acbr-bundle.json');
 if(!fs.existsSync(file))return invalid('missing');
 try{
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size<20||stat.size>65536)return invalid('invalid-manifest');
  const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  if(parsed?.schemaVersion!==1||parsed?.architecture!=='x64'||parsed?.source!==OFFICIAL_SOURCE||
     !/^[0-9]{3,12}$/.test(String(parsed.revision||''))||
     !parsed.files||typeof parsed.files!=='object'||Array.isArray(parsed.files))
    return invalid('invalid-manifest');
  const entries=Object.entries(parsed.files);
  if(entries.length<4||entries.length>150||!REQUIRED.every(name=>Object.hasOwn(parsed.files,name))||
     !entries.some(([name])=>name.startsWith('deps/')))return invalid('incomplete');
  // Reject DLL side-loading: a native loader can resolve files that the
  // manifest does not list. Never silently trust unlisted bundle contents.
  if(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink()||
     !fs.lstatSync(path.join(dir,'deps')).isDirectory()||
     fs.lstatSync(path.join(dir,'deps')).isSymbolicLink())return invalid('unsafe-directory');
  const allowed=new Set([...entries.map(([name])=>name),'acbr-bundle.json']);
  for(const entity of fs.readdirSync(dir,{withFileTypes:true})){
   if(entity.name==='deps'){if(!entity.isDirectory())return invalid('unsafe-entry');continue;}
   if(!entity.isFile()||!allowed.has(entity.name))return invalid('unlisted-entry');
  }
  for(const entity of fs.readdirSync(path.join(dir,'deps'),{withFileTypes:true})){
   if(!entity.isFile()||!allowed.has('deps/'+entity.name))return invalid('unlisted-entry');
  }
  for(const [name,hash] of entries){
   if(!SAFE.test(name)||name==='.'||name==='..'||!HEX.test(String(hash||'')))return invalid('unsafe-entry');
   const candidate=path.join(dir,name),relative=path.relative(dir,candidate);
   if(!relative||relative.startsWith('..')||path.isAbsolute(relative))return invalid('unsafe-entry');
   const fileStat=fs.lstatSync(candidate);
   if(!fileStat.isFile()||fileStat.isSymbolicLink()||
      fileStat.size<(name==='THIRD_PARTY_LICENSES.txt'?16:256)||
      fileStat.size>100*1024*1024)return invalid('invalid-file');
   const digest=createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
   if(digest!==hash)return invalid('hash-mismatch');
  }
  return Object.freeze({valid:true,revision:String(parsed.revision),source:OFFICIAL_SOURCE,
   nfeLib:path.join(dir,'ACBrNFe64.dll'),
   workerExe:path.join(dir,'acbrlib-worker.exe'),
   licenseFile:path.join(dir,'THIRD_PARTY_LICENSES.txt'),
   root:dir});
 }catch{return invalid('incomplete');}
}
module.exports={verifyAcbrBundle,OFFICIAL_SOURCE};
