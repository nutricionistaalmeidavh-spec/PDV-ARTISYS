const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dispatcherPath = path.join(__dirname, '..', 'js', 'core', 'domain-event-dispatcher.js');
const { DomainEventBus } = require('../js/core/domain-event-bus');

function sampleEvent(id = 'evt-1') {
  return {
    eventId: id,
    type: 'sale.completed',
    aggregate: 'sale',
    aggregateId: 'sale-1',
    occurredAt: '2026-09-09T14:00:00-03:00',
    actor: { userId: 'cashier-1', role: 'cashier', terminalId: 'pdv-01' },
    source: 'terminal',
    mutationId: null,
    payload: { total: 120.5 }
  };
}

test('domain event dispatcher module exists', () => {
  assert.equal(fs.existsSync(dispatcherPath), true);
});

test('marks an outbox event dispatched only after all subscribers succeed', async () => {
  const { DomainEventDispatcher } = require(dispatcherPath);
  const bus = new DomainEventBus();
  const event = sampleEvent();
  const calls = [];
  const outbox = {
    async listPending() { return [event]; },
    async markDispatched(eventId) { calls.push(['dispatched', eventId]); },
    async recordFailure(eventId, message) { calls.push(['failed', eventId, message]); }
  };
  bus.subscribe('sale.completed', () => calls.push(['inventory']));
  bus.subscribe('sale.completed', () => calls.push(['receipt']));

  const dispatcher = new DomainEventDispatcher({ bus, outbox });
  const result = await dispatcher.dispatchPending();

  assert.deepEqual(calls, [
    ['inventory'],
    ['receipt'],
    ['dispatched', 'evt-1']
  ]);
  assert.equal(result.dispatched, 1);
  assert.equal(result.failed, 0);
});

test('keeps an outbox event pending when any subscriber fails', async () => {
  const { DomainEventDispatcher } = require(dispatcherPath);
  const bus = new DomainEventBus();
  const event = sampleEvent('evt-2');
  const calls = [];
  const outbox = {
    async listPending() { return [event]; },
    async markDispatched(eventId) { calls.push(['dispatched', eventId]); },
    async recordFailure(eventId, message) { calls.push(['failed', eventId, message]); }
  };
  bus.subscribe('sale.completed', () => { throw new Error('fiscal unavailable'); });
  bus.subscribe('sale.completed', () => calls.push(['audit']));

  const dispatcher = new DomainEventDispatcher({ bus, outbox });
  const result = await dispatcher.dispatchPending();

  assert.equal(calls[0][0], 'audit');
  assert.equal(calls[1][0], 'failed');
  assert.equal(calls.some(([kind]) => kind === 'dispatched'), false);
  assert.equal(result.dispatched, 0);
  assert.equal(result.failed, 1);
});

test('waits for asynchronous effects before marking the outbox event dispatched', async () => {
  const { DomainEventDispatcher } = require(dispatcherPath);
  const bus = new DomainEventBus();
  const event = sampleEvent('evt-async-1');
  const calls = [];
  const outbox = {
    async listPending() { return [event]; },
    async markDispatched(eventId) { calls.push(['dispatched', eventId]); },
    async recordFailure(eventId, message) { calls.push(['failed', eventId, message]); }
  };
  bus.subscribe('sale.completed', async () => {
    await Promise.resolve();
    calls.push(['fiscal']);
  });

  const dispatcher = new DomainEventDispatcher({ bus, outbox });
  const result = await dispatcher.dispatchPending();

  assert.deepEqual(calls, [['fiscal'], ['dispatched', 'evt-async-1']]);
  assert.equal(result.dispatched, 1);
  assert.equal(result.failed, 0);
});
