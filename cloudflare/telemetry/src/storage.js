async function registerInstallation(db,input,credentialHash,now){
  await db.prepare(`INSERT INTO installations(installation_id,credential_hash,first_seen_at,last_seen_at,last_app_version,last_release_id,telemetry_schema_version)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(installation_id) DO UPDATE SET credential_hash=excluded.credential_hash,last_seen_at=excluded.last_seen_at,last_app_version=excluded.last_app_version,last_release_id=excluded.last_release_id,telemetry_schema_version=excluded.telemetry_schema_version`)
    .bind(input.installation_id,credentialHash,now,now,input.app_version,input.release_id,input.telemetry_schema_version).run();
}
async function updateInstallationSeen(db,{installationId,appVersion,releaseId},now){
  await db.prepare('UPDATE installations SET last_seen_at = ?, last_app_version = ?, last_release_id = ? WHERE installation_id = ?')
    .bind(now,appVersion,releaseId,installationId).run();
}
async function recordError(db,event,now){
  const fingerprint=event.dimensions?.fingerprint;if(!fingerprint)return false;
  const receipt=await db.prepare('INSERT OR IGNORE INTO event_receipts(event_id,receipt_type,received_at) VALUES(?,?,?)')
    .bind(event.event_id,'error',now).run();
  if(Number(receipt?.meta?.changes||0)===0)return false;
  await db.prepare(`INSERT OR IGNORE INTO error_fingerprint_installations(fingerprint,installation_id,first_seen_at,last_seen_at)
    VALUES(?,?,?,?)`).bind(fingerprint,event.installation_id,now,now).run();
  await db.prepare(`INSERT INTO error_fingerprints(fingerprint,subsystem,operation,first_seen_at,last_seen_at,occurrence_count,affected_installations,status)
    VALUES(?,?,?,?,?,1,(SELECT COUNT(*) FROM error_fingerprint_installations WHERE fingerprint=?),'open')
    ON CONFLICT(fingerprint) DO UPDATE SET last_seen_at=excluded.last_seen_at,occurrence_count=error_fingerprints.occurrence_count+1,affected_installations=(SELECT COUNT(*) FROM error_fingerprint_installations WHERE fingerprint=excluded.fingerprint)`)
    .bind(fingerprint,event.dimensions?.subsystem||event.dimensions?.module||'unknown',event.dimensions?.operation||null,now,now,fingerprint).run();
  return true;
}
async function purgeReceipts(db,now,days=30){const cutoff=new Date(Date.parse(now)-days*86400000).toISOString();await db.prepare('DELETE FROM event_receipts WHERE received_at < ?').bind(cutoff).run();}
export{registerInstallation,updateInstallationSeen,recordError,purgeReceipts};
