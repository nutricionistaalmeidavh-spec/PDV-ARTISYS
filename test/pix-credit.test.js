const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runSalesEnhancementMigrations } = require('../js/core/database/sales-enhancement-migrations');
const { runCommercialMediaMigrations } = require('../js/core/database/commercial-media-migrations');
const { runCommercialCoreMigrations } = require('../js/core/database/commercial-core-migrations');
const { createSettingsService } = require('../js/core/settings/settings-service');
const { createPixService } = require('../js/domains/payments/pix-service');
const { createCreditService } = require('../js/domains/payments/credit-service');
const { crc16Ccitt, buildPixPayload } = require('../js/domains/payments/pix-brcode');

function setup() {
  let sequence = 0;
  const idFactory = prefix => `${prefix}-${++sequence}`;
  const now = () => '2026-09-16T15:00:00.000Z';
  const db = openDatabase(':memory:');
  runMigrations(db, now);
  runSalesEnhancementMigrations(db, now);
  runCommercialMediaMigrations(db, now);
  runCommercialCoreMigrations(db, now);
  db.prepare("INSERT INTO customers(id,name,credit_limit_cents,credit_used_cents,active,created_at,updated_at) VALUES('c1','Cliente',0,0,1,?,?)").run(now(),now());
  const settings = createSettingsService({ db, now });
  const pix = createPixService({ db, settings, now, idFactory });
  const credits = createCreditService({ db, now, idFactory });
  const actor = { userId:'manager-1', role:'manager', terminalId:'pdv-1' };
  return { db, settings, pix, credits, actor };
}

test('Pix BR Code is deterministic and appends a valid CRC field', () => {
  const payload = buildPixPayload({
    pixKey:'pix@example.com', merchantName:'ARTISYS TESTE', merchantCity:'RIBEIRAO PRETO', amountCents:1234, txid:'VENDA123'
  });
  assert.match(payload, /^000201/);
  assert.match(payload, /BR\.GOV\.BCB\.PIX/);
  assert.match(payload, /5303986/);
  assert.match(payload, /540512\.34/);
  assert.match(payload, /6304[0-9A-F]{4}$/);
  const base = payload.slice(0,-4);
  assert.equal(payload.slice(-4), crc16Ccitt(base));
  assert.equal(buildPixPayload({ pixKey:'pix@example.com', merchantName:'ARTISYS TESTE', merchantCity:'RIBEIRAO PRETO', amountCents:1234, txid:'VENDA123' }), payload);
});

test('Pix charge stays pending until explicit manual confirmation', () => {
  const { db, pix, actor } = setup();
  pix.saveConfiguration({ enabled:true, pixKey:'pix@example.com', merchantName:'ARTISYS', merchantCity:'RIBEIRAO PRETO', descriptionPrefix:'Venda' }, actor);
  const charge = pix.createCharge({ id:'pix-1', saleId:'sale-1', amountCents:2500 }, actor);
  assert.equal(charge.status, 'PENDING');
  assert.ok(charge.payload.includes('BR.GOV.BCB.PIX'));
  assert.throws(() => pix.assertConfirmedPayment({ chargeId:'pix-1', saleId:'other', amountCents:2500 }), /venda|diverg/i);
  const confirmed = pix.confirmCharge('pix-1', actor);
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(pix.assertConfirmedPayment({ chargeId:'pix-1', saleId:'sale-1', amountCents:2500 }).id, 'pix-1');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='pix.charge.confirm'").get());
  db.close();
});

test('credit ledger issues, redeems, refunds and reverses without mutable balance source of truth', () => {
  const { db, credits, actor } = setup();
  const issued = credits.issueCustomerCredit({ customerId:'c1', amountCents:10000, sourceType:'manual', sourceId:'credit-1', note:'Credito inicial' }, actor);
  assert.equal(credits.getBalance(issued.account.id), 10000);

  const redemption = credits.redeem({ accountId:issued.account.id, amountCents:3500, sourceType:'sale', sourceId:'sale-1' }, actor);
  assert.equal(credits.getBalance(issued.account.id), 6500);
  assert.throws(() => credits.redeem({ accountId:issued.account.id, amountCents:7000, sourceType:'sale', sourceId:'sale-2' }, actor), /saldo/i);

  credits.refund({ accountId:issued.account.id, amountCents:1000, sourceType:'return', sourceId:'return-1' }, actor);
  assert.equal(credits.getBalance(issued.account.id), 7500);
  credits.reverse(redemption.entry.id, { reason:'Cancelamento da venda', actor });
  assert.equal(credits.getBalance(issued.account.id), 11000);
  assert.throws(() => credits.reverse(redemption.entry.id, { reason:'Repetido', actor }), /estorn|revers/i);
  db.close();
});

test('gift card persists only a hash and can be resolved by plaintext code', () => {
  const { db, credits, actor } = setup();
  const created = credits.createGiftCard({ amountCents:5000, sourceType:'gift-card-sale', sourceId:'gc-sale-1' }, actor);
  assert.ok(created.code);
  assert.equal(created.account.type, 'GIFT_CARD');
  const row = db.prepare('SELECT code_hash AS hash FROM credit_accounts WHERE id=?').get(created.account.id);
  assert.ok(row.hash);
  assert.notEqual(row.hash, created.code);
  assert.equal(credits.findGiftCard(created.code).id, created.account.id);
  assert.equal(credits.getBalance(created.account.id), 5000);
  db.close();
});
