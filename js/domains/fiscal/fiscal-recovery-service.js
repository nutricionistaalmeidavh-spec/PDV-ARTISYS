'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const {inspectSqlite,sha256File}=require('../../core/backup/backup-service');

function requireAdmin(actor={}){if(String(actor.role||'')!=='admin')throw new Error('Backup/restore fiscal exige usuario administrador.');}
function ensureInside(root,target){const base=path.resolve(root);const resolved=path.resolve(target);if(resolved!==base&&!resolved.startsWith(`${base}${path.sep}`))throw new Error('Caminho fiscal fora da area de recovery.');return resolved;}
function copyTree(source,target){if(!source||!fs.existsSync(source))return false;const stat=fs.statSync(source);if(!stat.isDirectory())throw new Error('Componente fiscal deve ser diretorio.');fs.mkdirSync(target,{recursive:true});for(const entry of fs.readdirSync(source,{withFileTypes:true})){const from=path.join(source,entry.name);const to=path.join(target,entry.name);if(entry.isDirectory())copyTree(from,to);else if(entry.isFile()){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}else throw new Error('Recovery fiscal nao aceita links ou arquivos especiais.');}return true;}
function listFiles(root){if(!root||!fs.existsSync(root))return[];const out=[];function walk(current){for(const entry of fs.readdirSync(current,{withFileTypes:true})){const absolute=path.join(current,entry.name);if(entry.isDirectory())walk(absolute);else if(entry.isFile())out.push(absolute);else throw new Error('Recovery fiscal nao aceita links ou arquivos especiais.');}}walk(root);return out.sort();}
function treeManifest(root){return listFiles(root).map(file=>({path:path.relative(root,file).split(path.sep).join('/'),sha256:sha256File(file),size:fs.statSync(file).size}));}
function treeDigest(entries){const canonical=JSON.stringify((entries||[]).map(item=>({path:item.path,sha256:item.sha256,size:item.size})));return createHash('sha256').update(canonical).digest('hex');}

function createFiscalRecoveryService({db,backups,backupDir,recoveryDir,fiscalArchiveDir=null,fiscalPackStoreRoot=null,appVersion='0.0.0',now=()=>new Date().toISOString(),idFactory=null}={}){
 if(!db||!backups||!backupDir||!recoveryDir)throw new TypeError('db, backups, backupDir e recoveryDir sao obrigatorios para recovery fiscal.');
 fs.mkdirSync(recoveryDir,{recursive:true});fs.mkdirSync(backupDir,{recursive:true});
 const makeId=typeof idFactory==='function'?idFactory:()=>`fiscal-recovery-${Date.now()}-${randomBytes(4).toString('hex')}`;
 function bundlePath(id){const safe=String(id||'').trim();if(!/^fiscal-recovery-[A-Za-z0-9._-]+$/.test(safe))throw new Error('ID de recovery fiscal invalido.');return ensureInside(recoveryDir,path.join(recoveryDir,safe));}
 function loadManifest(id){const root=bundlePath(id);const file=path.join(root,'manifest.json');if(!fs.existsSync(file))throw new Error('Bundle de recovery fiscal nao encontrado.');let manifest;try{manifest=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){throw new Error(`Manifesto de recovery fiscal invalido: ${error.message}`);}return{root,file,manifest};}
 function createBundle({reason='manual',actor={}}={}){
  requireAdmin(actor);const createdAt=now();const id=String(makeId('fiscal-recovery'));const root=bundlePath(id);if(fs.existsSync(root))throw new Error('Bundle de recovery fiscal ja existe.');fs.mkdirSync(root,{recursive:true});
  const sqliteBackup=backups.createBackup(`fiscal-${String(reason||'manual')}`,{prune:false});const databaseDir=path.join(root,'database');fs.mkdirSync(databaseDir,{recursive:true});const databasePath=path.join(databaseDir,'pdv.sqlite');fs.copyFileSync(sqliteBackup.filePath,databasePath);
  const sqlite=inspectSqlite(databasePath);if(!sqlite.valid)throw new Error(`Snapshot SQLite fiscal invalido: ${sqlite.errors.join(' ')}`);
  const components=[];
  if(fiscalArchiveDir&&fs.existsSync(fiscalArchiveDir)){const target=path.join(root,'fiscal-archive');copyTree(fiscalArchiveDir,target);const files=treeManifest(target);components.push({kind:'fiscal-archive',relativePath:'fiscal-archive',digest:treeDigest(files),files});}
  if(fiscalPackStoreRoot&&fs.existsSync(fiscalPackStoreRoot)){const target=path.join(root,'fiscal-packs');copyTree(fiscalPackStoreRoot,target);const files=treeManifest(target);components.push({kind:'fiscal-packs',relativePath:'fiscal-packs',digest:treeDigest(files),files});}
  const sequenceRows=db.prepare('SELECT document_type,environment,series,next_number,updated_at FROM fiscal_sequences ORDER BY document_type,environment,series').all();
  const fiscalCounts={fiscalDocuments:Number(db.prepare('SELECT COUNT(*) AS count FROM fiscal_documents').get()?.count||0),nfseDocuments:Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='nfse_documents'").get()?db.prepare('SELECT COUNT(*) AS count FROM nfse_documents').get()?.count||0:0),fiscalEvents:Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='fiscal_document_events'").get()?db.prepare('SELECT COUNT(*) AS count FROM fiscal_document_events').get()?.count||0:0)};
  const manifest={schemaVersion:1,id,createdAt,createdBy:actor.userId||null,reason:String(reason||'manual'),appVersion:String(appVersion),database:{relativePath:'database/pdv.sqlite',sha256:sha256File(databasePath),size:fs.statSync(databasePath).size,schemaVersion:sqlite.schemaVersion},components,sequences:sequenceRows,counts:fiscalCounts,secrets:{included:false,policy:'Segredos vinculados ao sistema operacional nao sao incluidos no bundle; certificado A1, senha e CSC devem ser reconfigurados quando necessario.'}};
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),'utf8');return{id,root,manifest};
 }
 function validateBundle(id){const {root,manifest}=loadManifest(id);const errors=[];const dbPath=ensureInside(root,path.join(root,manifest.database?.relativePath||''));if(!fs.existsSync(dbPath))errors.push('Snapshot SQLite ausente.');else{const actual=sha256File(dbPath);if(actual!==manifest.database.sha256)errors.push('Checksum SQLite diverge do manifesto.');const inspected=inspectSqlite(dbPath);if(!inspected.valid)errors.push(...inspected.errors);if(inspected.schemaVersion!==Number(manifest.database.schemaVersion))errors.push('Schema SQLite diverge do manifesto.');}
  for(const component of manifest.components||[]){let componentRoot;try{componentRoot=ensureInside(root,path.join(root,component.relativePath));}catch(error){errors.push(error.message);continue;}if(!fs.existsSync(componentRoot)){errors.push(`Componente ${component.kind} ausente.`);continue;}let files;try{files=treeManifest(componentRoot);}catch(error){errors.push(error.message);continue;}if(treeDigest(files)!==component.digest)errors.push(`Checksum do componente ${component.kind} diverge do manifesto.`);}
  return{id:String(id),valid:errors.length===0,errors,manifest,root,databasePath:dbPath};
 }
 function prepareRestore(id,{actor={}}={}){requireAdmin(actor);const validation=validateBundle(id);if(!validation.valid)throw new Error(`Bundle fiscal invalido para restore: ${validation.errors.join(' ')}`);let safetyBackupId=null;try{safetyBackupId=backups.createBackup('pre-fiscal-recovery',{prune:false}).id;}catch{/* clean install may not have an active database file */}
  const byKind=new Map((validation.manifest.components||[]).map(component=>[component.kind,component]));const companions=[];
  const archive=byKind.get('fiscal-archive');if(archive&&fiscalArchiveDir)companions.push({kind:'fiscal-archive',sourcePath:ensureInside(validation.root,path.join(validation.root,archive.relativePath)),targetPath:path.resolve(fiscalArchiveDir),digest:archive.digest});
  const packs=byKind.get('fiscal-packs');if(packs&&fiscalPackStoreRoot)companions.push({kind:'fiscal-packs',sourcePath:ensureInside(validation.root,path.join(validation.root,packs.relativePath)),targetPath:path.resolve(fiscalPackStoreRoot),digest:packs.digest});
  const marker={version:2,backupId:validation.manifest.id,backupPath:validation.databasePath,sha256:validation.manifest.database.sha256,schemaVersion:validation.manifest.database.schemaVersion,requestedAt:now(),requestedBy:actor.userId||null,safetyBackupId,companions,secrets:validation.manifest.secrets};const markerPath=path.join(backupDir,'pending-restore.json');fs.writeFileSync(`${markerPath}.tmp`,JSON.stringify(marker,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(`${markerPath}.tmp`,markerPath);return{pending:true,markerPath,bundleId:validation.manifest.id,safetyBackupId,companions:companions.length};
 }
 function listBundles(){return fs.readdirSync(recoveryDir,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('fiscal-recovery-')).map(entry=>{try{return loadManifest(entry.name).manifest;}catch{return{id:entry.name,invalid:true};}}).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));}
 return Object.freeze({createBundle,validateBundle,prepareRestore,listBundles});
}

module.exports={createFiscalRecoveryService,treeManifest,treeDigest};