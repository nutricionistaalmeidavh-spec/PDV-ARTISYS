'use strict';

const fs=require('node:fs');
const path=require('node:path');

const MAX_XML_BYTES=8*1024*1024;

function safeSegment(value,fallback='fiscal'){
  const text=String(value||'').trim().replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'');
  return (text||fallback).slice(0,120);
}

function createFiscalArtifactStore({rootDir,maxXmlBytes=MAX_XML_BYTES}={}){
  const root=path.resolve(String(rootDir||'').trim());
  if(!rootDir)throw new TypeError('Diretorio do arquivo fiscal e obrigatorio.');
  const maxBytes=Math.max(1024,Number(maxXmlBytes)||MAX_XML_BYTES);
  fs.mkdirSync(root,{recursive:true,mode:0o700});

  function assertInside(candidate){
    const resolved=path.resolve(candidate);
    if(resolved!==root&&!resolved.startsWith(`${root}${path.sep}`))throw new Error('Caminho de artefato fiscal fora do arquivo local.');
    return resolved;
  }

  function readSource({xml,sourcePath}){
    if(xml!==null&&xml!==undefined&&String(xml).trim())return Buffer.from(String(xml),'utf8');
    if(!sourcePath)return null;
    const file=path.resolve(String(sourcePath));
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return null;
    const stat=fs.statSync(file);if(stat.size>maxBytes)throw new Error('XML fiscal excede o limite permitido.');
    return fs.readFileSync(file);
  }

  function persistXml({kind='authorized',document={},xml=null,sourcePath=null,occurredAt=null}={}){
    const bytes=readSource({xml,sourcePath});if(!bytes)return null;
    if(bytes.length>maxBytes)throw new Error('XML fiscal excede o limite permitido.');
    const when=new Date(occurredAt||Date.now());const year=String(when.getUTCFullYear());const month=String(when.getUTCMonth()+1).padStart(2,'0');
    const dir=assertInside(path.join(root,year,month));fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const base=safeSegment(document.reference||document.id||'documento');const suffix=safeSegment(kind,'xml');const target=assertInside(path.join(dir,`${base}-${suffix}.xml`));
    const temp=assertInside(`${target}.tmp-${process.pid}-${Date.now()}`);fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,target);
    try{fs.chmodSync(target,0o600);}catch{}
    return target;
  }

  function readXml(filePath){
    if(!filePath)throw new Error('XML fiscal nao armazenado.');const target=assertInside(filePath);
    if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw new Error('XML fiscal nao encontrado no arquivo local.');
    const stat=fs.statSync(target);if(stat.size>maxBytes)throw new Error('XML fiscal excede o limite permitido.');
    return fs.readFileSync(target,'utf8');
  }

  return Object.freeze({rootDir:root,persistXml,readXml});
}

module.exports={MAX_XML_BYTES,createFiscalArtifactStore};
