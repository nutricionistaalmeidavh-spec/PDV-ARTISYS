'use strict';

const { writeAudit } = require('../audit-log');

const SENSITIVE_KEY = /(password|passwd|senha|token|secret|segredo|authorization|credential|api[-_.]?key|private[-_.]?key)/i;

function ensureSettingsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    scope TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope,setting_key)
  );
  CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key,scope);`);
}

function typeOfValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (!['string','number','boolean','object'].includes(type)) throw new Error('Tipo de configuracao nao suportado.');
  if (type === 'number' && !Number.isFinite(value)) throw new Error('Numero de configuracao invalido.');
  return type;
}

function assertPublicKey(key) {
  const normalized = String(key || '').trim();
  if (!normalized || normalized.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) throw new Error('Chave de configuracao invalida.');
  if (SENSITIVE_KEY.test(normalized)) throw new Error('Configuracao sensivel/segredo deve usar armazenamento protegido, nao app_settings.');
  return normalized;
}

function assertScope(scope) {
  const value = String(scope || 'global').trim();
  if (!value || value.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(value)) throw new Error('Escopo de configuracao invalido.');
  return value;
}

function mapRow(row) {
  if (!row) return null;
  let value = null;
  try { value = JSON.parse(row.value_json); } catch { value = null; }
  return { scope:row.scope,key:row.setting_key,value,type:row.value_type,updatedBy:row.updated_by,createdAt:row.created_at,updatedAt:row.updated_at };
}

function createSettingsService({db,now=()=>new Date().toISOString()}={}) {
  if (!db) throw new TypeError('Database is required.');
  ensureSettingsTable(db);

  function get(key,{scope='global',defaultValue=null}={}) {
    const safeKey=assertPublicKey(key);const safeScope=assertScope(scope);
    const row=db.prepare('SELECT * FROM app_settings WHERE scope=? AND setting_key=?').get(safeScope,safeKey);
    return row ? mapRow(row).value : defaultValue;
  }

  function list({scope=null,prefix=''}={}) {
    const clauses=[];const params=[];
    if(scope){clauses.push('scope=?');params.push(assertScope(scope));}
    if(prefix){clauses.push('setting_key LIKE ?');params.push(`${String(prefix)}%`);}
    return db.prepare(`SELECT * FROM app_settings${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY setting_key,scope`).all(...params).map(mapRow);
  }

  function mayWrite(key,scope,actor) {
    const role=String(actor?.role||'');
    if(['admin','manager'].includes(role)) return true;
    return role==='cashier' && key.startsWith('ui.') && scope===`user:${String(actor?.userId||'')}`;
  }

  function set(key,value,{scope='global',actor={}}={}) {
    const safeKey=assertPublicKey(key);const safeScope=assertScope(scope);const type=typeOfValue(value);
    if(!mayWrite(safeKey,safeScope,actor)) throw new Error('Permissao insuficiente para alterar configuracao.');
    const timestamp=now();
    db.prepare(`INSERT INTO app_settings(scope,setting_key,value_json,value_type,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(scope,setting_key) DO UPDATE SET value_json=excluded.value_json,value_type=excluded.value_type,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(safeScope,safeKey,JSON.stringify(value),type,actor?.userId||null,timestamp,timestamp);
    writeAudit(db,{action:'settings.update',entity:'setting',entityId:`${safeScope}:${safeKey}`,actor,context:{key:safeKey,scope:safeScope,type}},now);
    return mapRow(db.prepare('SELECT * FROM app_settings WHERE scope=? AND setting_key=?').get(safeScope,safeKey));
  }

  function remove(key,{scope='global',actor={}}={}) {
    const safeKey=assertPublicKey(key);const safeScope=assertScope(scope);
    if(!mayWrite(safeKey,safeScope,actor)) throw new Error('Permissao insuficiente para alterar configuracao.');
    const result=db.prepare('DELETE FROM app_settings WHERE scope=? AND setting_key=?').run(safeScope,safeKey);
    if(result.changes) writeAudit(db,{action:'settings.remove',entity:'setting',entityId:`${safeScope}:${safeKey}`,actor,context:{key:safeKey,scope:safeScope}},now);
    return Boolean(result.changes);
  }

  return {get,list,set,remove};
}

module.exports={createSettingsService,ensureSettingsTable,assertPublicKey,SENSITIVE_KEY};
