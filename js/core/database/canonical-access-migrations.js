'use strict';

const {withTransaction}=require('./sqlite-database');
const {DEFAULT_PROFILES,DEFAULT_PROFILE_IDS}=require('../auth/default-profiles');

const CANONICAL_ACCESS_SCHEMA_VERSION=31;
const CANONICAL_ACCESS_MIGRATION_NAME='pdv_canonical_access_profiles_v31';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function tableExists(db,table){
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(String(table)));
}

function seedCanonicalProfiles(db,now){
  const timestamp=now();
  const profileColumns=columns(db,'profiles');
  const hasLegacyRole=profileColumns.has('legacy_role');
  const insert=hasLegacyRole
    ?db.prepare(`INSERT OR IGNORE INTO profiles(id,name,slug,system_key,legacy_role,protected,active,created_at,updated_at)
      VALUES(?,?,?,?,NULL,?,1,?,?)`)
    :db.prepare(`INSERT OR IGNORE INTO profiles(id,name,slug,system_key,protected,active,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,?)`);
  const update=db.prepare('UPDATE profiles SET name=?,slug=?,system_key=?,protected=?,active=1,updated_at=? WHERE id=?');
  const insertPermission=db.prepare('INSERT INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)');

  for(const profile of DEFAULT_PROFILES){
    insert.run(profile.id,profile.name,profile.slug,profile.systemKey,profile.protected?1:0,timestamp,timestamp);
    update.run(profile.name,profile.slug,profile.systemKey,profile.protected?1:0,timestamp,profile.id);
    db.prepare('DELETE FROM profile_permissions WHERE profile_id=?').run(profile.id);
    for(const permission of profile.permissions)insertPermission.run(profile.id,permission,timestamp);
  }
}

function migrateLegacyUsers(db){
  const userColumns=columns(db,'users');
  if(!userColumns.has('role'))return;
  const mapping=[
    ['admin',DEFAULT_PROFILE_IDS.ADMINISTRATOR],
    ['manager',DEFAULT_PROFILE_IDS.MANAGER],
    ['cashier',DEFAULT_PROFILE_IDS.CASHIER]
  ];
  for(const [role,profileId] of mapping){
    db.prepare('UPDATE users SET profile_id=? WHERE role=?').run(profileId,role);
  }
}

function enforceProfiles(db){
  const missing=Number(db.prepare('SELECT COUNT(*) AS count FROM users WHERE profile_id IS NULL').get()?.count||0);
  if(missing>0)throw new Error(`Existem ${missing} usuario(s) sem perfil canonico. Corrija os dados antes de iniciar o ArtiSys.`);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_users_profile_required_insert
    BEFORE INSERT ON users
    WHEN NEW.profile_id IS NULL
    BEGIN
      SELECT RAISE(ABORT,'profile_id obrigatorio');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_users_profile_required_update
    BEFORE UPDATE OF profile_id ON users
    WHEN NEW.profile_id IS NULL
    BEGIN
      SELECT RAISE(ABORT,'profile_id obrigatorio');
    END;
  `);
}

function dropLegacyColumns(db){
  const profileColumns=columns(db,'profiles');
  if(profileColumns.has('legacy_role'))db.exec('ALTER TABLE profiles DROP COLUMN legacy_role');
  const userColumns=columns(db,'users');
  if(userColumns.has('role'))db.exec('ALTER TABLE users DROP COLUMN role');
}

function runCanonicalAccessMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  if(!tableExists(db,'profiles')||!columns(db,'users').has('profile_id')){
    throw new Error('Access profile schema must exist before canonical access migration.');
  }
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(CANONICAL_ACCESS_SCHEMA_VERSION));
  const canonical=!columns(db,'profiles').has('legacy_role')&&!columns(db,'users').has('role');
  if(applied&&canonical)return CANONICAL_ACCESS_SCHEMA_VERSION;

  withTransaction(db,()=>{
    seedCanonicalProfiles(db,now);
    migrateLegacyUsers(db);
    enforceProfiles(db);
    dropLegacyColumns(db);
    if(!applied)db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(CANONICAL_ACCESS_SCHEMA_VERSION,CANONICAL_ACCESS_MIGRATION_NAME,now());
  });
  return CANONICAL_ACCESS_SCHEMA_VERSION;
}

const CASHIER_COMMANDS_SCHEMA_VERSION=35;
const CASHIER_COMMANDS_MIGRATION_NAME='pdv_cashier_default_comanda_permissions_v35';
const CASHIER_COMMAND_PERMISSIONS=Object.freeze([
  'restaurant.access',
  'restaurant.orders.view',
  'restaurant.orders.create',
  'restaurant.orders.cancel'
]);

// Existing installations already have protected default profiles in SQLite.
// Add only the new cashier grants; never replace assignments or custom profiles.
function runCashierDefaultCommandsMigration(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(CASHIER_COMMANDS_SCHEMA_VERSION)){
    return CASHIER_COMMANDS_SCHEMA_VERSION;
  }
  withTransaction(db,()=>{
    const existing=db.prepare('SELECT 1 FROM profiles WHERE id=? AND system_key=? AND protected=1')
      .get(DEFAULT_PROFILE_IDS.CASHIER,'cashier');
    if(!existing)throw new Error('Perfil Caixa padrao nao encontrado.');
    const insert=db.prepare('INSERT OR IGNORE INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)');
    const timestamp=now();
    for(const permission of CASHIER_COMMAND_PERMISSIONS)insert.run(DEFAULT_PROFILE_IDS.CASHIER,permission,timestamp);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(CASHIER_COMMANDS_SCHEMA_VERSION,CASHIER_COMMANDS_MIGRATION_NAME,timestamp);
  });
  return CASHIER_COMMANDS_SCHEMA_VERSION;
}

const COMANDA_WORKFLOW_SCHEMA_VERSION=36;
const COMANDA_WORKFLOW_MIGRATION_NAME='restaurant_command_edit_cancel_v36';
const WORKFLOW_PERMISSIONS=Object.freeze([
  ['CASHIER',['restaurant.orders.edit','restaurant.sessions.cancel']],
  ['SUPERVISOR',['restaurant.orders.edit','restaurant.sessions.cancel','restaurant.sessions.cancel.production']],
  ['MANAGER',['restaurant.orders.edit','restaurant.sessions.cancel','restaurant.sessions.cancel.production']],
  ['ADMINISTRATOR',['restaurant.orders.edit','restaurant.sessions.cancel','restaurant.sessions.cancel.production']]
]);
function runComandaWorkflowMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  return withTransaction(db,()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS restaurant_session_cancellations (
      session_id TEXT PRIMARY KEY REFERENCES table_sessions(id),
      reason TEXT NOT NULL CHECK(length(trim(reason))>=3),
      actor_id TEXT REFERENCES users(id),
      cancelled_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_restaurant_session_cancellations_at
      ON restaurant_session_cancellations(cancelled_at);`);
    if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(COMANDA_WORKFLOW_SCHEMA_VERSION)){
      const insert=db.prepare('INSERT OR IGNORE INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)');
      const ts=now();
      for(const [profileKey,grants] of WORKFLOW_PERMISSIONS){
        const id=DEFAULT_PROFILE_IDS[profileKey];
        if(!db.prepare('SELECT 1 FROM profiles WHERE id=? AND protected=1').get(id))continue;
        for(const grant of grants)insert.run(id,grant,ts);
      }
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(COMANDA_WORKFLOW_SCHEMA_VERSION,COMANDA_WORKFLOW_MIGRATION_NAME,ts);
    }
    return COMANDA_WORKFLOW_SCHEMA_VERSION;
  });
}

module.exports={
  CANONICAL_ACCESS_SCHEMA_VERSION,
  CANONICAL_ACCESS_MIGRATION_NAME,
  runCanonicalAccessMigrations,
  runCashierDefaultCommandsMigration,
  CASHIER_COMMANDS_SCHEMA_VERSION,
  CASHIER_COMMAND_PERMISSIONS,
  runComandaWorkflowMigrations,
  COMANDA_WORKFLOW_SCHEMA_VERSION
};
