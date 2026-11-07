'use strict';

function runFinanceWorkspaceMigrations(db,now=()=>new Date().toISOString()){
  if(!db||typeof db.exec!=='function')throw new TypeError('db is required.');
  db.exec([
    'CREATE TABLE IF NOT EXISTS finance_kanban_cards (',
    'id TEXT PRIMARY KEY, entry_id TEXT UNIQUE REFERENCES financial_entries(id) ON DELETE CASCADE,',
    "title TEXT NOT NULL, details TEXT, due_at TEXT, priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH')),",
    "assignee_id TEXT, stage TEXT NOT NULL DEFAULT 'PENDING' CHECK(stage IN ('PENDING','IN_PROGRESS','DONE')),",
    'created_by TEXT, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)',
    ';',
    'CREATE INDEX IF NOT EXISTS idx_finance_kanban_stage ON finance_kanban_cards(stage,due_at)',
    ';',
    'CREATE TABLE IF NOT EXISTS finance_kanban_actions (',
    'idempotency_key TEXT PRIMARY KEY, card_id TEXT NOT NULL, stage TEXT NOT NULL, actor_id TEXT NOT NULL,',
    'settlement_id TEXT, created_at TEXT NOT NULL)',
    ';',
    'CREATE TABLE IF NOT EXISTS finance_workspace_imports (',
    'idempotency_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, row_count INTEGER NOT NULL,',
    'created_by TEXT NOT NULL, created_at TEXT NOT NULL)',
    ';'
  ].join('\n'));
  // Only system-defined protected profiles inherit newly introduced permissions.
  // Custom profiles must be granted these separately in the Access Center.
  const profiles=['profile-administrator','profile-manager','profile-finance'];
  const insert=db.prepare('INSERT OR IGNORE INTO profile_permissions (profile_id,permission_id,created_at) SELECT id,?,? FROM profiles WHERE id=?');
  for(const id of profiles)for(const permission of ['finance.settle','finance.reverse'])insert.run(permission,now(),id);
}
module.exports={runFinanceWorkspaceMigrations};
