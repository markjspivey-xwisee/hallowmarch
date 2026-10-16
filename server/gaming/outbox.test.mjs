import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningOutbox, learningOutboxDigest } from './outbox.js';
import { createFoxxiSink, projectGamingEvents, FOXXI_XAPI_ACTION, FOXXI_XAPI_ACTION_PUBLISHED } from './learning.js';

const NOW = Date.parse('2026-10-16T00:16:18.000Z');
const TARGET = 'https://foxxi.example/advertised/xapi';
const DOMAIN = { domain: 'hallowmarch', gameId: 'expedition:1' };
const event = (n, actorId = 'alice') => ({ id: `event-${n}-${actorId}`, streamId: 'expedition:1', version: n, at: new Date(NOW).toISOString(), actorId, kind: 'damage', payload: { amount: n, sourceId: actorId, targetId: 'guardian' }, teamId: 'party', realmId: '0' });
const consent = (name = 'alice', extra = {}) => ({ enabled: true, expiresAt: NOW + 60000, recipient: TARGET, actorDid: `did:example:${name}`, sessionId: `session-${name}`, ...extra });
const entry = (n, name = 'alice', c = consent(name)) => ({ event: event(n, name), consent: structuredClone(c) });
function fixture(entries = [entry(1)], options = {}) {
  let committed = structuredClone(entries);
  const grants = Object.fromEntries(entries.map(e => [e.event.actorId, structuredClone(e.consent)]));
  const deliveries = [], acknowledgements = [], remoteIds = new Set();
  const durableSink = {
    descriptor: { action: FOXXI_XAPI_ACTION, method: 'POST', target: TARGET },
    publish: async (events, context) => {
      deliveries.push({ events: structuredClone(events), context: structuredClone(context) });
      const receipts = projectGamingEvents(events, DOMAIN).evidence.map(e => ({ statementId: e.id, persisted: true }));
      receipts.forEach(r => remoteIds.add(r.statementId));
      return { ok: true, exported: events.length, receipts };
    }
  };
  const acknowledge = async data => {
    acknowledgements.push(structuredClone(data));
    assert.ok(data.eventIds.every(id => committed.some(e => e.event.id === id)), 'ack only durable queued events');
    assert.ok(data.sourceDigests.every(ref => committed.some(e => e.event.id === ref.eventId && learningOutboxDigest(e) === ref.sha256)), 'compare exact durable source');
    committed = committed.filter(e => !data.eventIds.includes(e.event.id));
    return { durable: true, version: acknowledgements.length + 1 };
  };
  const dispatcher = createLearningOutbox({ sink: durableSink, getEntries: async () => structuredClone(committed), getConsent: async ({ actorId }) => grants[actorId], acknowledge, now: () => NOW, ...DOMAIN, ...options });
  return { dispatcher, deliveries, acknowledgements, remoteIds, grants, durableSink, acknowledge, entries: () => structuredClone(committed) };
}

test('delivers committed facts and removes only after an exact durable acknowledgement', async () => {
  const f = fixture([entry(1), entry(2)]);
  const r = await f.dispatcher.flush();
  assert.equal(r.exported, 2); assert.equal(r.discarded, 0); assert.equal(r.retained, 0);
  assert.equal(f.entries().length, 0); assert.equal(f.remoteIds.size, 2);
  assert.equal(f.acknowledgements[0].status, 'exported');
  assert.deepEqual(f.acknowledgements[0].binding, { actorId: 'alice', sessionId: 'session-alice', recipient: TARGET, actorDid: 'did:example:alice' });
  assert.equal(f.acknowledgements[0].receipts.length, 2);
  assert.equal((await f.dispatcher.flush()).exported, 0);
});

test('published HTTPS action dispatches only to its explicitly configured recipient', async () => {
  const f = fixture([entry(1)], { sink: {
    descriptor: { action: FOXXI_XAPI_ACTION_PUBLISHED, method: 'POST', target: TARGET },
    publish: async (events, context) => f.durableSink.publish(events, context)
  } });
  assert.equal((await f.dispatcher.flush()).exported, 1);
  const wrongRecipient = fixture([entry(1)], { sink: {
    descriptor: { action: FOXXI_XAPI_ACTION_PUBLISHED, method: 'POST', target: 'https://another.example/advertised/xapi' },
    publish: async () => { throw new Error('wrong recipient must never receive evidence'); }
  } });
  assert.equal((await wrongRecipient.dispatcher.flush()).retained, 1);
  assert.equal(wrongRecipient.acknowledgements.length, 0);
  const wrongAction = fixture([entry(1)], { sink: {
    descriptor: { action: 'https://other.example/ns/iep/action/foxxi/write-xapi-statements-signed', method: 'POST', target: TARGET },
    publish: async () => { throw new Error('suffix lookalike must never receive evidence'); }
  } });
  assert.equal((await wrongAction.dispatcher.flush()).retained, 1);
});

test('transport failures retain the durable queue and retries preserve event identity', async () => {
  let fail = true;
  const f = fixture([entry(1)], { sink: {
    descriptor: { action: FOXXI_XAPI_ACTION, method: 'POST', target: TARGET },
    publish: async (events, context) => {
      if (fail) { fail = false; throw new Error('uncertain network failure'); }
      return f.durableSink.publish(events, context);
    }
  } });
  assert.equal((await f.dispatcher.flush()).retained, 1);
  assert.equal(f.entries().length, 1); assert.equal(f.acknowledgements.length, 0);
  assert.equal((await f.dispatcher.flush()).exported, 1);
  assert.equal(f.deliveries[0].events[0].id, 'event-1-alice');
});

test('failed acknowledgement replays the same external statement without a duplicate record', async () => {
  let failures = 1;
  const f = fixture([entry(1)], { acknowledge: async data => {
    if (failures--) throw new Error('native commit failed');
    return f.acknowledge(data);
  } });
  const r = await f.dispatcher.flush();
  assert.equal(r.exported, 0); assert.equal(r.retained, 1); assert.equal(f.entries().length, 1);
  assert.equal(f.remoteIds.size, 1);
  assert.equal((await f.dispatcher.flush()).exported, 1);
  assert.equal(f.deliveries.length, 2); assert.equal(f.remoteIds.size, 1, 'same immutable ids after uncertain acknowledgement');
});

test('missing, deleted, revoked and expired consent are durably discarded without export claims', async () => {
  for (const grant of [undefined, null, consent('alice', { enabled: false }), consent('alice', { expiresAt: NOW }), consent('alice', { sessionId: 'replacement-session' }), consent('alice', { recipient: 'https://another.example/' }), consent('alice', { actorDid: 'did:example:someone-else' })]) {
    const f = fixture(); f.grants.alice = grant;
    const r = await f.dispatcher.flush();
    assert.equal(r.discarded, 1); assert.equal(r.exported, 0);
    assert.equal(f.deliveries.length, 0); assert.equal(f.entries().length, 0);
    assert.equal(f.acknowledgements[0].status, 'discarded');
    assert.deepEqual(f.acknowledgements[0].receipts, []);
  }
});

test('failed discard commit retains the row and does not claim cancellation persisted', async () => {
  const f = fixture([entry(1)], { acknowledge: async () => ({ durable: false }) });
  delete f.grants.alice;
  const r = await f.dispatcher.flush();
  assert.equal(r.discarded, 0); assert.equal(r.retained, 1); assert.equal(f.entries().length, 1); assert.equal(f.deliveries.length, 0);
});

test('consent read failure retains evidence rather than assuming revocation', async () => {
  const f = fixture([entry(1)], { getConsent: async () => { throw new Error('store temporarily unavailable'); } });
  const r = await f.dispatcher.flush();
  assert.equal(r.retained, 1); assert.equal(r.discarded, 0); assert.equal(f.acknowledgements.length, 0);
  const clockFailure = fixture([entry(1)], { now: () => NaN });
  assert.equal((await clockFailure.dispatcher.flush()).retained, 1);
  assert.equal(clockFailure.acknowledgements.length, 0, 'unavailable clock cannot authorize disposal as expired');
});

test('users, sessions, recipients and consent snapshots never mix in a signed batch', async () => {
  const old = consent('alice', { expiresAt: NOW + 30000 });
  const rows = [entry(1, 'alice', old), entry(2, 'bob'), entry(3, 'alice'), entry(4, 'bob')];
  const f = fixture(rows);
  const r = await f.dispatcher.flush();
  assert.equal(r.discarded, 1, 'older consent snapshot expires when replaced');
  assert.equal(r.exported, 3);
  assert.equal(f.deliveries.length, 2);
  for (const d of f.deliveries) assert.ok(d.events.every(e => e.actorId === d.context.actorId));
  assert.deepEqual(new Set(f.deliveries.map(d => d.context.sessionId)), new Set(['session-alice', 'session-bob']));
  const wrong = fixture([entry(1, 'alice', consent('alice', { recipient: 'https://different.example/' }))]);
  assert.equal((await wrong.dispatcher.flush()).retained, 1); assert.equal(wrong.deliveries.length, 0);
});

test('singleflight concurrent flushes use bounded batches and no transient queue primary', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(Array.from({ length: 25 }, (_, i) => entry(i + 1)), { sink: {
    descriptor: { action: FOXXI_XAPI_ACTION, method: 'POST', target: TARGET },
    publish: async (events, context) => { await gate; return f.durableSink.publish(events, context); }
  } });
  const first = f.dispatcher.flush(), second = f.dispatcher.flush();
  assert.equal(first, second);
  assert.equal(f.entries().length, 25, 'nothing removes or changes committed rows before acknowledgement');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b); assert.equal(a.exported, 25);
  assert.deepEqual(f.deliveries.map(d => d.events.length), [20, 5]);
});

test('no configured sink retains valid evidence, while stale consent can still be durably discarded', async () => {
  const f = fixture([entry(1), entry(2, 'bob')], { sink: null });
  delete f.grants.bob;
  const r = await f.dispatcher.flush();
  assert.equal(r.retained, 1); assert.equal(r.discarded, 1); assert.equal(r.exported, 0);
  assert.equal(f.entries()[0].event.actorId, 'alice'); assert.equal(f.deliveries.length, 0);
});

test('wrong or partial durable Foxxi receipts are never acknowledged as successful learning', async () => {
  for (const result of [{ ok: false, exported: 0, receipts: [] }, { ok: true, exported: 1, receipts: [{ statementId: 'wrong', persisted: true }] }, { ok: true, exported: 1, receipts: [{ statementId: 'wrong', persisted: false }] }]) {
    const f = fixture([entry(1)], { sink: { descriptor: { action: FOXXI_XAPI_ACTION, method: 'POST', target: TARGET }, publish: async () => result } });
    const r = await f.dispatcher.flush();
    assert.equal(r.retained, 1); assert.equal(r.exported, 0); assert.equal(f.acknowledgements.length, 0);
  }
});

test('the actual sink blocks consent revoked while signing, then dispatcher durably discards', async () => {
  let signCalls = 0, transports = 0;
  const getSinkConsent = () => {
    const c = f.grants.alice;
    return c && { allowed: c.enabled, expiresAt: new Date(c.expiresAt).toISOString(), subjectDid: c.actorDid, actorId: 'alice', sessionId: c.sessionId, recipient: c.recipient };
  };
  const sink = createFoxxiSink({ descriptor: { action: FOXXI_XAPI_ACTION, method: 'POST', target: TARGET }, now: () => NOW,
    resolveActorDid: async () => ({ did: 'did:example:alice', verified: true }), getConsent: getSinkConsent,
    signRequest: async args => { signCalls++; f.grants.alice.enabled = false; return { _signed_payload: JSON.stringify({ ...args, agent_id: 'did:example:alice' }), _signature: 'test' }; },
    transport: async () => { transports++; throw new Error('should not send'); }
  });
  const f = fixture([entry(1)], { sink });
  assert.equal((await f.dispatcher.flush()).retained, 1);
  assert.equal(signCalls, 1); assert.equal(transports, 0); assert.equal(f.entries().length, 1);
  assert.equal((await f.dispatcher.flush()).discarded, 1); assert.equal(f.entries().length, 0);
});

test('duplicates collapse; conflicting duplicate ids fail closed; read snapshots remain unchanged', async () => {
  const raw = [entry(1), entry(1)]; const before = structuredClone(raw);
  const f = fixture(raw);
  assert.equal((await f.dispatcher.flush()).exported, 1); assert.equal(f.deliveries[0].events.length, 1);
  assert.deepEqual(raw, before);
  const broken = fixture([entry(1), { ...entry(1), event: { ...event(1), payload: { amount: 999 } } }]);
  await assert.rejects(broken.dispatcher.flush(), /conflicting durable outbox event id/);
  assert.equal(broken.deliveries.length, 0);
  assert.throws(() => createLearningOutbox(), /durable/);
});
