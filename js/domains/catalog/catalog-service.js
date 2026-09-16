'use strict';

const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const { assertCents } = require('../shared/money');
const { writeAudit } = require('../../core/audit-log');

function normalizeDocument(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits || null;
}

function normalizeOptional(value) {
  const text = String(value || '').trim();
  return text || null;
}

function booleanInt(value, fallback = true) {
  return (value == null ? fallback : Boolean(value)) ? 1 : 0;
}

function rowToCategory(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name ?? null,
    unit: row.unit,
    salePriceCents: row.sale_price_cents,
    costCents: row.cost_cents,
    trackStock: Boolean(row.track_stock),
    trackLots: Boolean(row.track_lots ?? 0),
    minimumStock: row.minimum_stock,
    stockQuantity: Number(row.stock_quantity ?? 0),
    photo: row.photo_thumbnail_sha256 ? { version:row.photo_version, thumbnailSha256:row.photo_thumbnail_sha256, originalSha256:row.photo_original_sha256, updatedAt:row.photo_updated_at } : null,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToCustomer(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, document: row.document, phone: row.phone, email: row.email, notes: row.notes,
    creditLimitCents: row.credit_limit_cents, creditUsedCents: row.credit_used_cents, active: Boolean(row.active),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function rowToSupplier(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, document: row.document, phone: row.phone, email: row.email, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role, active: Boolean(row.active), createdAt: row.created_at, updatedAt: row.updated_at };
}

function createCatalogService({ db, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');
  const hasProductPhotos=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_photos'").get());
  const productColumns=new Set(db.prepare('PRAGMA table_info(products)').all().map(row=>row.name));
  const hasTrackLots=productColumns.has('track_lots');

  function upsertCategory(input = {}, actor = null) {
    const id = String(input.id || idFactory('cat')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome da categoria obrigatorio.');
    const timestamp = now();
    db.prepare(`INSERT INTO categories (id,name,active,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, name, booleanInt(input.active), timestamp, timestamp);
    writeAudit(db, { action: 'category.upsert', entity: 'category', entityId: id, actor, context: { name } }, now);
    return rowToCategory(db.prepare('SELECT * FROM categories WHERE id=?').get(id));
  }

  function listCategories({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM categories ORDER BY name,id').all()
      : db.prepare('SELECT * FROM categories WHERE active=1 ORDER BY name,id').all();
    return rows.map(rowToCategory);
  }

  function productSelect(where = '') {
    const photoColumns=hasProductPhotos?'ph.version AS photo_version,ph.original_sha256 AS photo_original_sha256,ph.thumbnail_sha256 AS photo_thumbnail_sha256,ph.updated_at AS photo_updated_at':'NULL AS photo_version,NULL AS photo_original_sha256,NULL AS photo_thumbnail_sha256,NULL AS photo_updated_at';
    const photoJoin=hasProductPhotos?'LEFT JOIN product_photos ph ON ph.product_id=p.id AND ph.deleted_at IS NULL':'';
    return `SELECT p.*, c.name AS category_name, COALESCE(b.quantity,0) AS stock_quantity,${photoColumns}
      FROM products p
      LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN inventory_balances b ON b.product_id=p.id ${photoJoin} ${where}`;
  }

  function upsertProduct(input = {}, actor = null) {
    const id = String(input.id || idFactory('prod')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do produto obrigatorio.');
    const salePriceCents = assertCents(input.salePriceCents ?? 0, 'salePriceCents');
    const costCents = assertCents(input.costCents ?? 0, 'costCents');
    if (salePriceCents < 0 || costCents < 0) throw new Error('Valores do produto nao podem ser negativos.');
    const minimumStock = Number(input.minimumStock ?? 0);
    if (!Number.isFinite(minimumStock) || minimumStock < 0) throw new Error('Estoque minimo invalido.');
    const timestamp = now();
    db.prepare(`INSERT INTO products
      (id,sku,barcode,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,barcode=excluded.barcode,name=excluded.name,category_id=excluded.category_id,
        unit=excluded.unit,sale_price_cents=excluded.sale_price_cents,cost_cents=excluded.cost_cents,track_stock=excluded.track_stock,
        minimum_stock=excluded.minimum_stock,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, normalizeOptional(input.sku), normalizeOptional(input.barcode), name, normalizeOptional(input.categoryId), String(input.unit || 'UN').trim().toUpperCase(),
        salePriceCents, costCents, booleanInt(input.trackStock), Number(minimumStock.toFixed(3)), booleanInt(input.active), timestamp, timestamp);
    if(hasTrackLots && input.trackLots !== undefined) db.prepare('UPDATE products SET track_lots=?,updated_at=? WHERE id=?').run(booleanInt(input.trackLots,false),timestamp,id);
    db.prepare('INSERT OR IGNORE INTO inventory_balances (product_id,quantity,updated_at) VALUES (?,0,?)').run(id, timestamp);
    writeAudit(db, { action: 'product.upsert', entity: 'product', entityId: id, actor, context: { sku: input.sku, barcode: input.barcode, name, trackLots:hasTrackLots?Boolean(input.trackLots):false } }, now);
    return getProduct(id);
  }

  function getProduct(id) {
    return rowToProduct(db.prepare(`${productSelect('WHERE p.id=?')}`).get(String(id)));
  }

  function listProducts({ includeInactive = false } = {}) {
    const sql = includeInactive
      ? `${productSelect()} ORDER BY p.name,p.id`
      : `${productSelect('WHERE p.active=1')} ORDER BY p.name,p.id`;
    return db.prepare(sql).all().map(rowToProduct);
  }

  function upsertCustomer(input = {}, actor = null) {
    const id = String(input.id || idFactory('cust')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do cliente obrigatorio.');
    const creditLimitCents = assertCents(input.creditLimitCents ?? 0, 'creditLimitCents');
    const creditUsedCents = assertCents(input.creditUsedCents ?? 0, 'creditUsedCents');
    if (creditLimitCents < 0 || creditUsedCents < 0) throw new Error('Credito nao pode ser negativo.');
    const timestamp = now();
    db.prepare(`INSERT INTO customers
      (id,name,document,phone,email,notes,credit_limit_cents,credit_used_cents,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,notes=excluded.notes,
        credit_limit_cents=excluded.credit_limit_cents,credit_used_cents=excluded.credit_used_cents,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, name, normalizeDocument(input.document), normalizeOptional(input.phone), normalizeOptional(input.email), normalizeOptional(input.notes),
        creditLimitCents, creditUsedCents, booleanInt(input.active), timestamp, timestamp);
    writeAudit(db, { action: 'customer.upsert', entity: 'customer', entityId: id, actor, context: { name, document: normalizeDocument(input.document) } }, now);
    return getCustomer(id);
  }

  function getCustomer(id) {
    return rowToCustomer(db.prepare('SELECT * FROM customers WHERE id=?').get(String(id)));
  }

  function listCustomers({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM customers ORDER BY name,id').all()
      : db.prepare('SELECT * FROM customers WHERE active=1 ORDER BY name,id').all();
    return rows.map(rowToCustomer);
  }

  function upsertSupplier(input = {}, actor = null) {
    const id = String(input.id || idFactory('sup')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do fornecedor obrigatorio.');
    const timestamp = now();
    db.prepare(`INSERT INTO suppliers (id,name,document,phone,email,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,phone=excluded.phone,email=excluded.email,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, name, normalizeDocument(input.document), normalizeOptional(input.phone), normalizeOptional(input.email), booleanInt(input.active), timestamp, timestamp);
    writeAudit(db, { action: 'supplier.upsert', entity: 'supplier', entityId: id, actor, context: { name, document: normalizeDocument(input.document) } }, now);
    return rowToSupplier(db.prepare('SELECT * FROM suppliers WHERE id=?').get(id));
  }

  function listSuppliers({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM suppliers ORDER BY name,id').all()
      : db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name,id').all();
    return rows.map(rowToSupplier);
  }

  function createUser(input = {}, actor = null) {
    const role = String(input.role || '').trim().toLowerCase();
    if (!['admin', 'manager', 'cashier'].includes(role)) throw new Error('Perfil de usuario invalido.');
    const password = String(input.password || '');
    if (password.length < 10) throw new Error('Senha deve possuir pelo menos 10 caracteres.');
    const id = String(input.id || idFactory('user')).trim();
    const username = String(input.username || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    if (!username || !name) throw new Error('Usuario e nome sao obrigatorios.');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    const timestamp = now();
    db.prepare(`INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, username, name, role, hash, salt, booleanInt(input.active), timestamp, timestamp);
    writeAudit(db, { action: 'user.create', entity: 'user', entityId: id, actor, context: { username, name, role } }, now);
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }

  function upsertUser(input = {}, actor = null) {
    const id = String(input.id || '').trim();
    const username = String(input.username || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    const role = String(input.role || '').trim().toLowerCase();
    if (!id) return createUser(input, actor);
    if (!username || !name) throw new Error('Usuario e nome sao obrigatorios.');
    if (!['admin', 'manager', 'cashier'].includes(role)) throw new Error('Perfil de usuario invalido.');
    const existing = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!existing) return createUser(input, actor);
    const password = String(input.password || '');
    let hash = existing.password_hash;
    let salt = existing.password_salt;
    if (password) {
      if (password.length < 10) throw new Error('Senha deve possuir pelo menos 10 caracteres.');
      salt = randomBytes(16).toString('hex');
      hash = scryptSync(password, salt, 64).toString('hex');
    }
    const timestamp = now();
    db.prepare(`UPDATE users SET username=?,name=?,role=?,password_hash=?,password_salt=?,active=?,updated_at=? WHERE id=?`)
      .run(username, name, role, hash, salt, booleanInt(input.active), timestamp, id);
    writeAudit(db, { action: 'user.upsert', entity: 'user', entityId: id, actor, context: { username, name, role } }, now);
    return getUser(id);
  }

  function getUser(id) {
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(String(id)));
  }

  function listUsers({ includeInactive = false } = {}) {
    const rows = includeInactive
      ? db.prepare('SELECT * FROM users ORDER BY name,id').all()
      : db.prepare('SELECT * FROM users WHERE active=1 ORDER BY name,id').all();
    return rows.map(publicUser);
  }

  function countUsers() {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count || 0);
  }

  function verifyUserPassword(username, password) {
    const row = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username || '').trim().toLowerCase());
    if (!row) return { ok: false, reason: 'invalid-credentials' };
    const actual = scryptSync(String(password || ''), row.password_salt, 64);
    const expected = Buffer.from(row.password_hash, 'hex');
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    return ok ? { ok: true, user: publicUser(row) } : { ok: false, reason: 'invalid-credentials' };
  }

  return {
    upsertCategory, listCategories,
    upsertProduct, getProduct, listProducts,
    upsertCustomer, getCustomer, listCustomers,
    upsertSupplier, listSuppliers,
    createUser, upsertUser, getUser, listUsers, countUsers, verifyUserPassword
  };
}

module.exports = { normalizeDocument, createCatalogService };
