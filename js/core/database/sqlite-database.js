'use strict';

const { DatabaseSync } = require('node:sqlite');

let savepointSequence = 0;

function openDatabase(filename) {
  if (!filename) throw new TypeError('Database filename is required.');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (filename !== ':memory:') {
    try { db.exec('PRAGMA journal_mode = WAL'); } catch { /* read-only/unusual FS */ }
    try { db.exec('PRAGMA synchronous = NORMAL'); } catch { /* best effort */ }
  }
  return db;
}

function withTransaction(db, fn) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('Database is required.');
  if (typeof fn !== 'function') throw new TypeError('Transaction callback is required.');

  const nested = Boolean(db.isTransaction);
  const savepoint = nested ? `artisys_sp_${++savepointSequence}` : null;
  if (nested) db.exec(`SAVEPOINT ${savepoint}`);
  else db.exec('BEGIN IMMEDIATE');

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new TypeError('withTransaction callback must be synchronous with DatabaseSync.');
    }
    if (nested) db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    else db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      if (nested) {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      } else {
        db.exec('ROLLBACK');
      }
    } catch { /* preserve original error */ }
    throw error;
  }
}

module.exports = { openDatabase, withTransaction };
