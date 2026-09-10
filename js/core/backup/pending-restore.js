'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');

function sha256(filePath){return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');}
function inspect(filePath){
  let db;
  try{
    db=new DatabaseSync(filePath);
    const row=db.prepare('PRAGMA integrity_check').get();
    const integrity=row?.integrity_check||Object.values(row||{})[0];
    if(integrity!=='ok')throw new Error(`integrity_check=${integrity}`);
    const schemaVersion=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version||0);
    return{schemaVersion};
  }finally{try{db?.close();}catch{}}
}

function applyPendingRestore({dbPath,backupDir,maxSchemaVersion=Number.MAX_SAFE_INTEGER}={}){
  if(!dbPath||!backupDir)throw new TypeError('dbPath and backupDir are required.');
  const markerPath=path.join(backupDir,'pending-restore.json');
  if(!fs.existsSync(markerPath))return{applied:false,reason:'none'};
  let marker;
  try{marker=JSON.parse(fs.readFileSync(markerPath,'utf8'));}catch(error){throw new Error(`Marcador de restore invalido: ${error.message}`);}
  if(!marker.backupPath||!fs.existsSync(marker.backupPath))throw new Error('Backup pendente nao encontrado.');
  const actual=sha256(marker.backupPath);
  if(actual!==marker.sha256)throw new Error('Checksum do backup pendente invalido.');
  const source=inspect(marker.backupPath);
  if(source.schemaVersion>Number(maxSchemaVersion))throw new Error('Schema do backup e mais novo que o aplicativo instalado.');
  const temp=`${dbPath}.restore-new`;
  const rollback=`${dbPath}.restore-rollback`;
  for(const file of [temp,rollback,`${dbPath}-wal`,`${dbPath}-shm`]){try{if(fs.existsSync(file))fs.rmSync(file,{force:true});}catch{}}
  fs.copyFileSync(marker.backupPath,temp);
  const copied=inspect(temp);
  if(copied.schemaVersion!==source.schemaVersion||sha256(temp)!==actual){fs.rmSync(temp,{force:true});throw new Error('Copia temporaria do restore falhou na validacao.');}
  let movedActive=false;
  try{
    if(fs.existsSync(dbPath)){fs.renameSync(dbPath,rollback);movedActive=true;}
    fs.renameSync(temp,dbPath);
    inspect(dbPath);
    fs.rmSync(rollback,{force:true});
    fs.rmSync(markerPath,{force:true});
    return{applied:true,backupId:marker.backupId,safetyBackupId:marker.safetyBackupId||null,schemaVersion:source.schemaVersion};
  }catch(error){
    try{if(fs.existsSync(dbPath))fs.rmSync(dbPath,{force:true});}catch{}
    try{if(movedActive&&fs.existsSync(rollback))fs.renameSync(rollback,dbPath);}catch{}
    try{if(fs.existsSync(temp))fs.rmSync(temp,{force:true});}catch{}
    throw error;
  }
}

module.exports={applyPendingRestore};
