import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createOwnerGameplayActivityArchive } from './gameplay-activity-archive.mjs';

const OWNER = 'did:web:identity.example:users:alice', POD = 'https://pod.example/alice/';
const SESSION = '48a438b2-e4ac-46ae-8fd1-d304922c1bd5', OTHER = '72f06f2e-4ea3-420f-b563-f99115b51d95';
const clone = value => JSON.parse(JSON.stringify(value));
const event = (sequence = 1, sessionId = SESSION) => ({ schema: 'hallowmarch.gameplay-event/v1',
  id: 'urn:uuid:' + webcrypto.randomUUID(), sessionId, sequence, type: 'combat.healed',
  ordinal: sequence, observedAt: '2026-10-17T12:00:00.000Z', body: { id: 'character-1', kind: 'character' },
  actor: { kind: 'unattributed' }, object: { id: 'character-1', kind: 'character' }, result: { quantity: 12, success: true }, context: { party: false } });
const page = (events = [event()], previous = null) => ({ sessionId: events[0].sessionId, events, previous });
function fixture({ records = new Map(), keyPresent = true, mode = 'saved', ownerDid = OWNER, podUrl = POD } = {}) {
  const calls = [], operations = new Map(); let version = records.size, confirmMode = 'saved', gate = null;
  const stored = (graphIri, record) => ({ saved: true, status: 'saved', graphIri, record: clone(record),
    head: { cid: 'cid-' + ++version, descriptorUrl: podUrl + 'context-graphs/' + version + '.ttl' } });
  const client = {
    connect: async () => { calls.push(['connect']); return { keyPresent, ownerDid, podUrl }; },
    registerKey: async () => { calls.push(['registerKey']); },
    createKey: async () => assert.fail('Archive must never mint an encryption key'),
    restoreRecovery: async () => assert.fail('Archive must never replace a recovery key'),
    currentHead: async ({ graphIri }) => { calls.push(['head', graphIri]); return clone(records.get(graphIri)?.head || null); },
    load: async ({ graphIri }) => { calls.push(['load', graphIri]); if (gate) await gate; return clone(records.get(graphIri) || null); },
    createAt: async ({ graphIri, record }) => {
      calls.push(['createAt', graphIri, clone(record)]); assert(!records.has(graphIri));
      const result = stored(graphIri, record);
      if (mode === 'throw') { records.set(graphIri, result); throw Object.assign(Error('Connection lost after write'), { code: 'native_unavailable' }); }
      if (mode === 'unconfirmable') return { saved: false, status: 'uncertain', graphIri };
      records.set(graphIri, result);
      if (mode === 'pending') {
        const operationId = webcrypto.randomUUID(); operations.set(operationId, result);
        return { saved: false, status: 'uncertain', operationId, graphIri, acceptedPending: true, receipt: { opaque: 'native-receipt' } };
      }
      return clone(result);
    },
    confirm: async operationId => {
      calls.push(['confirm', operationId]); const result = operations.get(operationId); assert(result);
      if (confirmMode === 'throw') throw Object.assign(Error('Still unavailable'), { code: 'native_unavailable' });
      if (confirmMode === 'pending') return { saved: false, status: 'pending', operationId, graphIri: result.graphIri };
      if (confirmMode === 'conflict') return { saved: false, status: 'conflict', operationId, graphIri: result.graphIri };
      return clone(result);
    },
    close: () => calls.push(['close']),
  };
  const archive = createOwnerGameplayActivityArchive({ binding: { subjectDid: ownerDid, podUrl }, credential: { testOnly: true },
    relayUrl: 'https://relay.example/', crypto: webcrypto, createClient: args => { calls.push(['client', { ...args, crypto: undefined }]); return client; } });
  return { archive, calls, records, stored, client, writes: () => calls.filter(call => call[0] === 'createAt').length,
    confirmMode: value => { confirmMode = value; }, holdLoad: promise => { gate = promise; } };
}

test('connect reuses only an existing owner key and verifies it before writing', async () => {
  const absent = fixture({ keyPresent: false });
  await assert.rejects(absent.archive.connect(), { code: 'key_required' });
  assert(!absent.calls.some(call => call[0] === 'registerKey')); assert.equal(absent.writes(), 0);
  const f = fixture(); assert.deepEqual(await f.archive.connect(), { connected: true, keyPresent: true });
  assert.deepEqual(f.calls.filter(call => ['connect', 'registerKey'].includes(call[0])).map(call => call[0]), ['connect', 'registerKey']);
  assert.equal(f.writes(), 0); assert.deepEqual(Object.keys(f.archive.status()).sort(), ['closed', 'code', 'connected', 'keyPresent', 'pending', 'stopped']);
});

test('immutable named pages preflight native absence and reconcile exact owner records across instances', async () => {
  const f = fixture(); await f.archive.connect(); const input = page([event(1), event(2)]);
  const first = await f.archive.appendPage(input); assert.equal(first.saved, true);
  assert.match(first.reference.graphIri, /^urn:graph:hallowmarch:gameplay-activity:[a-f0-9]{64}$/);
  const createIndex = f.calls.findIndex(call => call[0] === 'createAt');
  assert(f.calls.slice(0, createIndex).some(call => call[0] === 'head' && call[1] === first.reference.graphIri));
  const newConnection = fixture({ records: f.records }); await newConnection.archive.connect();
  const shuffled = { previous: null, events: input.events.map(item => Object.fromEntries(Object.entries(item).reverse())), sessionId: SESSION };
  assert.deepEqual(await newConnection.archive.appendPage(shuffled), first); assert.equal(newConnection.writes(), 0);
  const read = await newConnection.archive.readPage(first.reference); assert.deepEqual(read.record.events, input.events);
  read.record.events[0].result.quantity = 999;
  assert.equal((await newConnection.archive.readPage(first.reference)).record.events[0].result.quantity, 12);
  const conflicting = clone(input); conflicting.events[0].result.quantity = 99;
  await assert.rejects(newConnection.archive.appendPage(conflicting), { code: 'archive_conflict' }); assert.equal(newConnection.writes(), 0);
});

test('graph names separate owner, session and bounds while rejecting cross-owner content', async () => {
  const first = fixture(), second = fixture({ ownerDid: 'did:web:identity.example:users:bob', podUrl: 'https://pod.example/bob/' });
  await first.archive.connect(); await second.archive.connect();
  const input = page(); const a = await first.archive.appendPage(input), b = await second.archive.appendPage(input);
  assert.notEqual(a.reference.graphIri, b.reference.graphIri);
  first.records.get(a.reference.graphIri).record.ownerDid = 'did:web:identity.example:users:bob';
  await assert.rejects(first.archive.readPage(a.reference), { code: 'owner_mismatch' });
  await assert.rejects(second.archive.readPage(a.reference), { code: 'owner_mismatch' });
});

test('page chains preserve contiguous per-session sequences and permit a new session from one', async () => {
  const f = fixture(); await f.archive.connect();
  const first = await f.archive.appendPage(page([event(1), event(2)]));
  const second = await f.archive.appendPage(page([event(3)], first.reference));
  assert.equal((await f.archive.readPage(second.reference)).record.previous.cid, first.reference.cid);
  await assert.rejects(f.archive.appendPage(page([event(5)], second.reference)), { code: 'invalid_activity' });
  await assert.rejects(f.archive.appendPage(page([event(2, OTHER)], second.reference)), { code: 'invalid_activity' });
  assert.equal((await f.archive.appendPage(page([event(1, OTHER)], second.reference))).saved, true);
  assert.equal(f.writes(), 3);
});

test('an already observed page can never become permission to recreate a missing record', async () => {
  const f = fixture(); await f.archive.connect(); const input = page(), saved = await f.archive.appendPage(input);
  f.records.delete(saved.reference.graphIri);
  await assert.rejects(f.archive.appendPage(input), { code: 'missing_archive' }); assert.equal(f.writes(), 1);
  const fresh = fixture(); await fresh.archive.connect();
  await assert.rejects(fresh.archive.readPage(saved.reference), { code: 'missing_archive' });
  await assert.rejects(fresh.archive.appendPage(input), { code: 'missing_archive' }); assert.equal(fresh.writes(), 0);
});

test('pending receipts stay exact, retry confirms the original operation even when its graph is visible', async () => {
  const f = fixture({ mode: 'pending' }); await f.archive.connect(); const input = page();
  const receipt = await f.archive.appendPage(input); assert.equal(receipt.saved, false);
  assert.equal(f.archive.status().pending, true); assert(!JSON.stringify(f.archive.status()).includes('native-receipt'));
  await assert.rejects(f.archive.appendPage(page([event(2)], null)), { code: 'confirmation_required' });
  f.confirmMode('pending'); assert.deepEqual(await f.archive.appendPage(input), { saved: false, status: 'pending' });
  f.confirmMode('throw'); await assert.rejects(f.archive.appendPage(input), { code: 'native_unavailable' });
  assert.equal(f.archive.status().pending, true);
  f.confirmMode('saved'); const saved = await f.archive.appendPage(input); assert.equal(saved.saved, true);
  assert.equal(f.writes(), 1); assert.equal(f.archive.status().pending, false);
  assert.equal(new Set(f.calls.filter(call => call[0] === 'confirm').map(call => call[1])).size, 1);
  assert.deepEqual(receipt, { saved: false, status: 'pending' });
});

test('unconfirmable writes stop; a fresh explicit instance can reconcile a possibly committed deterministic page', async () => {
  for (const mode of ['throw', 'unconfirmable']) {
    const f = fixture({ mode }); await f.archive.connect(); const input = page();
    await assert.rejects(f.archive.appendPage(input)); assert.equal(f.archive.status().stopped, true);
    await assert.rejects(f.archive.appendPage(input), { code: 'archive_uncertain' }); assert.equal(f.writes(), 1);
    if (mode === 'throw') {
      const explicit = fixture({ records: f.records }); await explicit.archive.connect();
      assert.equal((await explicit.archive.appendPage(input)).saved, true); assert.equal(explicit.writes(), 0);
    }
  }
});

test('readPage requires exact CID and descriptor and refuses a head changed during decryption', async () => {
  const f = fixture(); await f.archive.connect(); const saved = await f.archive.appendPage(page());
  await assert.rejects(f.archive.readPage({ ...saved.reference, cid: 'another-cid' }), { code: 'archive_changed' });
  await assert.rejects(f.archive.readPage({ ...saved.reference, descriptorUrl: POD + 'another.ttl' }), { code: 'archive_changed' });
  let release; const held = new Promise(resolve => { release = resolve; }); f.holdLoad(held);
  const reading = f.archive.readPage(saved.reference);
  await new Promise(resolve => setImmediate(resolve));
  f.records.get(saved.reference.graphIri).head.cid = 'new-head'; release();
  await assert.rejects(reading, { code: 'archive_changed' });
});

test('invalid JSON, credentials, event types, identities, dates, gaps and capacities fail before I/O', async () => {
  const f = fixture(); await f.archive.connect(); const before = f.calls.length;
  const bad = [
    { ...event(), type: 'arbitrary.event' }, { ...event(), id: 'urn:uuid:bad' },
    { ...event(), observedAt: 'today' }, { ...event(), sequence: 0 },
    { ...event(), access_token: 'never-store-this' }, { ...event(), nested: { privateKey: 'secret' } },
    { ...event(), nested: new Date() }, { ...event(), amount: Infinity },
  ];
  for (const item of bad) assert.throws(() => f.archive.appendPage(page([item])), { code: 'invalid_activity' });
  assert.throws(() => f.archive.appendPage(page([event(1), event(3)])), { code: 'invalid_activity' });
  assert.throws(() => f.archive.appendPage(page([event(1), { ...event(2), id: 'urn:uuid:bad' }])), { code: 'invalid_activity' });
  assert.throws(() => f.archive.appendPage(page(Array.from({ length: 65 }, (_, index) => event(index + 1)))), { code: 'invalid_activity' });
  const oversized = Array.from({ length: 64 }, (_, index) => ({ ...event(index + 1),
    actor: { kind: 'agent', id: 'did:web:' + 'x'.repeat(490) }, object: { kind: 'resource', id: 'x'.repeat(128) },
    result: { quantity: 12, success: true, reason: 'x'.repeat(64) } }));
  assert.throws(() => f.archive.appendPage(page(oversized)), { code: 'activity_capacity' });
  const cyclic = event(); cyclic.loop = cyclic;
  assert.throws(() => f.archive.appendPage(page([cyclic])), { code: 'invalid_activity' });
  const executable = event(); Object.defineProperty(executable, 'toJSON', { value: () => assert.fail('Must not execute supplied JSON hooks') });
  assert.throws(() => f.archive.appendPage(page([executable])), { code: 'invalid_activity' });
  assert.equal(f.calls.length, before);
});

test('queued drafts are snapshotted and close prevents in-flight reads from yielding plaintext', async () => {
  const f = fixture(); await f.archive.connect(); const input = page();
  const writing = f.archive.appendPage(input); input.events[0].result.quantity = 999;
  const saved = await writing; assert.equal((await f.archive.readPage(saved.reference)).record.events[0].result.quantity, 12);
  let release; f.holdLoad(new Promise(resolve => { release = resolve; }));
  const reading = f.archive.readPage(saved.reference); await new Promise(resolve => setImmediate(resolve));
  f.archive.close(); release(); await assert.rejects(reading, { code: 'revoked' });
  assert.equal(f.archive.status().connected, false); assert.equal(f.writes(), 1);
});
