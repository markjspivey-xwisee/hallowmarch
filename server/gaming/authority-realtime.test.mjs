import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthoritativeRoom } from './authority.js';
import { createHallowmarchDomain } from './hallowmarch.js';
import { createLearningOutbox } from './outbox.js';
import { projectGamingEvents } from './learning.js';

// Explicit test fixture. Production never replaces native persistence with it.
class CheckpointFixture {
  saved = { version: 0, state: null };
  requests = [];
  receipts = new Map();
  fail = false;
  async load() { return structuredClone(this.saved); }
  blockNext() {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = new Promise(resolve => { started = resolve; });
    this.block = async () => { this.block = null; started(); await gate; };
    return { release, started: pending };
  }
  async commit(id, request) {
    this.requests.push(structuredClone(request));
    if (this.block) await this.block();
    if (this.fail) throw new Error('deliberately unavailable');
    if (this.receipts.has(request.idempotencyKey)) return { ...structuredClone(this.receipts.get(request.idempotencyKey)), replayed: true };
    if (request.expectedVersion !== this.saved.version) throw Object.assign(new Error('stale'), { code: 'VERSION_CONFLICT' });
    this.saved = { version: this.saved.version + 1, state: structuredClone(request.state) };
    this.receipts.set(request.idempotencyKey, structuredClone(this.saved));
    if (this.loseResponse) { this.loseResponse = false; throw new Error('response lost after successful write'); }
    return structuredClone(this.saved);
  }
}
const person = { playerId: 'alice', realmId: '0', name: 'Alice' };
let number = 0;
const command = (type, fields = {}) => ({ type, commandId: `realtime-${++number}`, ...fields });
async function fixture(t, overrides = {}) {
  const store = new CheckpointFixture(); let now = 100000;
  const options = { roomId: 'live-proof', store, domain: createHallowmarchDomain({ monsterHp: 10 }), clock: () => now,
    persistenceMode: 'realtime', checkpointIntervalMs: 30000, learningDeliveryAvailable: () => true, ...overrides };
  const room = await new AuthoritativeRoom(options).open();
  t.after(() => room.close().catch(() => {}));
  await room.execute(person, command('join')); await room.flushPersistence();
  return { room, store, options, advance(ms = 1000) { now += ms; } };
}

test('live moves and combat finish while the native checkpoint is blocked, with exact coalesced cold recovery', async t => {
  const f = await fixture(t); f.advance();
  const before = f.room.durableSequence, baselineWrites = f.store.requests.length;
  const block = f.store.blockNext();
  const first = await f.room.execute(person, command('move', { x: 0, z: 1 }));
  const checkpoint = f.room.flushPersistence(); await block.started;
  f.advance();
  const second = await f.room.execute(person, command('move', { x: 0, z: 3 }));
  const hit = await f.room.execute(person, command('attack', { targetId: 'march-guardian' }));
  assert.equal(first.durable, false); assert.equal(second.version, first.version + 1); assert.equal(hit.version, second.version + 1);
  assert.equal(f.room.durableSequence, before); assert.equal(f.room.current.entities['march-guardian'].hp, 0);
  assert.equal((await f.room.observe(person)).persistence.pendingCommands, 3);
  block.release(); await checkpoint; await f.room.flushPersistence();
  assert.equal(f.store.requests.length - baselineWrites, 2, 'the two later commands share one checkpoint');
  assert.equal(f.room.durableSequence, hit.liveSequence); assert.equal(f.room.durableVersion, f.store.saved.version);
  assert(f.room.durableVersion < f.room.version, 'native revisions and live command sequences have separate meanings');
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert.deepEqual(restarted.current, f.room.current); assert.equal(restarted.version, hit.liveSequence);
  assert.equal((await restarted.observe(person)).persistence.status, 'saved');
});

test('reward confirmation waits outside the command queue and never claims volatile rewards are saved', async t => {
  const f = await fixture(t); f.advance();
  await f.room.execute(person, command('move', { x: 0, z: 3 }));
  await f.room.execute(person, command('attack', { targetId: 'march-guardian' })); await f.room.flushPersistence();
  const block = f.store.blockNext(); let confirmed = false;
  const claim = f.room.execute(person, command('claimLoot', { targetId: 'march-guardian' })).then(value => { confirmed = true; return value; });
  await block.started; f.advance();
  const move = await f.room.execute(person, command('move', { x: 1, z: 3 }));
  assert.equal(confirmed, false); assert.equal(move.durable, false);
  const live = await f.room.observe(person); assert.equal(live.rewards['guardian-token'], 1); assert.equal(live.persistence.pendingRewards, true);
  block.release(); const accepted = await claim;
  assert.equal(accepted.durable, true); assert(accepted.durableSequence >= accepted.liveSequence);
  await f.room.flushPersistence();
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert.equal((await restarted.observe(person)).rewards['guardian-token'], 1);
  assert.equal((await restarted.observe(person)).entities.alice.x, 1);
});

test('failed checkpoints retain their immutable retry body, bound the backlog, then resume without dropping actions', async t => {
  const f = await fixture(t, { maxPendingCommands: 2 }); f.advance(); f.store.fail = true;
  await f.room.execute(person, command('move', { x: 0, z: 1 }));
  await assert.rejects(f.room.flushPersistence());
  const failed = f.store.requests.at(-1); f.advance();
  await f.room.execute(person, command('move', { x: 0, z: 2 })); f.advance();
  await assert.rejects(f.room.execute(person, command('move', { x: 0, z: 3 })), { code: 'durability_backlog' });
  assert.equal(f.room.current.entities.alice.z, 2); assert.equal(f.room.persistenceStatus().status, 'blocked');
  f.store.fail = false; await f.room.flushPersistence();
  assert.deepEqual(f.store.requests.at(-2), failed, 'uncertain native writes retry exactly the captured body');
  assert.equal(f.room.persistenceStatus().status, 'saved');
  await f.room.execute(person, command('move', { x: 0, z: 3 })); await f.room.flushPersistence();
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert.equal(restarted.current.entities.alice.z, 3);
});

test('an uncertain successful checkpoint is retried idempotently and never rolls later live actions back', async t => {
  const f = await fixture(t); f.advance(); f.store.loseResponse = true;
  await f.room.execute(person, command('move', { x: 0, z: 1 })); await assert.rejects(f.room.flushPersistence());
  const nativeVersion = f.store.saved.version; f.advance();
  await f.room.execute(person, command('move', { x: 0, z: 2 })); await f.room.flushPersistence();
  assert.equal(f.store.saved.version, nativeVersion + 1); assert.equal(f.room.current.entities.alice.z, 2);
  assert.equal(f.room.durableSequence, f.room.version);
});

test('another native writer freezes the live owner instead of overwriting or silently merging speculative state', async t => {
  const f = await fixture(t); f.advance();
  await f.room.execute(person, command('move', { x: 0, z: 1 }));
  f.store.saved.version++;
  await assert.rejects(f.room.flushPersistence(), { code: 'checkpoint_conflict' });
  assert.equal(f.room.persistenceStatus().lastError, 'checkpoint_conflict'); f.advance();
  await assert.rejects(f.room.execute(person, command('move', { x: 0, z: 2 })), { code: 'durability_backlog' });
  assert.equal(f.room.current.entities.alice.z, 1);
});

test('grants reveal tokens only after durable save, and pending revocation is immediately enforced in live authority', async t => {
  const f = await fixture(t); const block = f.store.blockNext(); let granted = false;
  const pendingGrant = f.room.execute(person, command('grantCompanion', { request: { agentId: 'did:example:agent', role: 'teammate' } })).then(value => { granted = true; return value; });
  await block.started; f.advance();
  await f.room.execute(person, command('move', { x: 0, z: 1 })); assert.equal(granted, false);
  block.release(); const grant = await pendingGrant; await f.room.flushPersistence();
  assert(grant.result.token); assert(!JSON.stringify(f.store.saved).includes(grant.result.token));
  const agent = { kind: 'agent', token: grant.result.token, entityId: 'alice' };
  f.advance(); await f.room.execute(person, command('move', { x: 0, z: 2 }));
  const agentView = await f.room.observe(agent);
  assert.equal(agentView.durable, false); assert(agentView.liveSequence > agentView.durableSequence);
  assert.equal(agentView.persistence.status, 'pending'); assert.equal(agentView.persistence.pendingCommands, 1);
  await f.room.flushPersistence();
  const revokeBlock = f.store.blockNext();
  const revoke = f.room.execute(person, command('revokeCompanion', { grantId: grant.result.grant.id })); await revokeBlock.started;
  await assert.rejects(f.room.observe(agent), { code: 'revoked' });
  await assert.rejects(f.room.execute(agent, command('move', { x: 0, z: 2 })), { code: 'revoked' });
  revokeBlock.release(); await revoke;
});

test('only durable learning events leave the room and acknowledgement checkpoints preserve concurrent live movement', async t => {
  const f = await fixture(t), principal = { ...person, verifiedDid: 'did:example:alice' };
  await f.room.execute(principal, command('learningConsent', { enabled: true, expiresAt: 150000, actorDid: principal.verifiedDid, recipient: 'https://foxxi.example/write', sessionId: 'session-1' }));
  await f.room.execute(principal, command('knowledge.consulted', { resourceId: 'https://example.org/notes' }));
  assert.equal((await f.room.learningContext()).outbox.length, 0);
  await f.room.flushPersistence(); assert.equal((await f.room.learningContext()).outbox.length, 1);
  const sink = { descriptor: { action: 'urn:iep:action:foxxi:write-xapi-statements-signed', method: 'POST', target: 'https://foxxi.example/write' },
    async publish(events) { return { ok: true, exported: events.length, receipts: projectGamingEvents(events, { domain: 'hallowmarch', gameId: f.room.id }).evidence.map(item => ({ statementId: item.id, persisted: true })) }; } };
  const outbox = createLearningOutbox({ sink, domain: 'hallowmarch', gameId: f.room.id, now: () => 100000,
    getEntries: async () => (await f.room.learningContext()).outbox, getConsent: async ({ actorId }) => (await f.room.learningContext()).consent[actorId], acknowledge: data => f.room.acknowledgeLearning(data) });
  const block = f.store.blockNext(), flush = outbox.flush(); await block.started; f.advance();
  await f.room.execute(principal, command('move', { x: 0, z: 2 }));
  block.release(); assert.equal((await flush).exported, 1); await f.room.flushPersistence();
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert.equal(restarted.current.entities.alice.z, 2); assert.equal(restarted.current.outbox.length, 1);
  assert.equal(restarted.current.outbox[0].event.kind, 'movement.applied', 'the later movement retains its own unexported evidence');
  assert.equal(Object.values(restarted.current.learningReceipts)[0].status, 'exported');
});

test('critical save timeout explicitly reports applied but unconfirmed while native persistence continues', async t => {
  const f = await fixture(t, { durableWaitMs: 20 });
  const block = f.store.blockNext();
  const result = f.room.execute(person, command('grantCompanion', { request: { agentId: 'did:example:agent', role: 'coach' } }));
  await block.started; await assert.rejects(result, { code: 'durability_pending' });
  assert.equal(f.room.persistenceStatus().pendingCommands, 1);
  block.release(); await f.room.flushPersistence();
  assert.equal(f.room.persistenceStatus().status, 'saved');
});

test('old pending work pauses mutation even below the command-count bound and checkpoint recovery unpauses it', async t => {
  const f = await fixture(t, { maxPendingAgeMs: 10 }); f.advance();
  await f.room.execute(person, command('move', { x: 0, z: 1 }));
  // A fixture clock does not control operational deadlines: those are monotonic.
  await new Promise(resolve => setTimeout(resolve, 15)); f.advance();
  await assert.rejects(f.room.execute(person, command('move', { x: 0, z: 2 })), { code: 'durability_backlog' });
  assert.equal(f.room.persistenceStatus().pendingCommands, 1);
  await f.room.flushPersistence();
  await f.room.execute(person, command('move', { x: 0, z: 2 }));
});

test('uncertain bootstrap replay loads its confirmed checkpoint before accepting live commands', async t => {
  const store = new CheckpointFixture(), commit = store.commit.bind(store);
  store.commit = async (...args) => ({ ...await commit(...args), replayed: true });
  const room = await new AuthoritativeRoom({ roomId: 'bootstrap-live', store, domain: createHallowmarchDomain(), persistenceMode: 'realtime' }).open();
  t.after(() => room.close());
  assert.equal(room.version, 1); assert(room.current.entities['march-guardian']);
  await room.execute(person, command('join'));
});

test('configured strict rollback replaces the realtime counter and can subsequently return to realtime mode', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) await f.room.execute(person, command('knowledge.consulted', { resourceId: `https://example.org/live/${i}` }));
  await f.room.flushPersistence(); assert(f.room.version > f.room.durableVersion);
  const strict = await new AuthoritativeRoom({ ...f.options, persistenceMode: 'strict' }).open();
  for (let i = 0; i < 8; i++) await strict.execute(person, command('knowledge.consulted', { resourceId: `https://example.org/strict/${i}` }));
  assert.equal(strict.current.authoritySequence, strict.version);
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert.equal(restarted.version, strict.version);
  await restarted.execute(person, command('knowledge.consulted', { resourceId: 'https://example.org/back-to-live' })); await restarted.flushPersistence();
  assert.equal(restarted.durableSequence, strict.version + 1);
});

test('saved historical critical receipts replay consistently after strict rollback resets the live counter', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) await f.room.execute(person, command('knowledge.consulted', { resourceId: `https://example.org/prior-epoch/${i}` }));
  const grantCommand = command('grantCompanion', { request: { agentId: 'did:example:epoch-agent', role: 'coach' } });
  const granted = await f.room.execute(person, grantCommand); await f.room.close();
  const strict = await new AuthoritativeRoom({ ...f.options, persistenceMode: 'strict' }).open();
  await strict.execute(person, command('knowledge.consulted', { resourceId: 'https://example.org/reset-epoch' }));
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert(granted.version > restarted.version, 'the prior epoch used a larger command counter');
  await restarted.execute(person, command('knowledge.consulted', { resourceId: 'https://example.org/unrelated-pending' }));
  const replayed = await restarted.execute(person, grantCommand);
  assert.equal(replayed.replayed, true); assert.equal(replayed.durable, true);
  assert(replayed.version <= replayed.durableSequence); assert(replayed.liveSequence <= replayed.persistence.liveSequence);
  assert.equal(replayed.result.token, undefined, 'historical grants still never replay a bearer token');
  assert.equal(restarted.persistenceStatus().pendingCommands, 1, 'a saved replay does not wait for unrelated live actions');
});

test('durable learning acknowledgements also replay after a strict rollback resets their sequence epoch', async t => {
  const f = await fixture(t), principal = { ...person, verifiedDid: 'did:example:alice' };
  await f.room.execute(principal, command('learningConsent', { enabled: true, expiresAt: 150000, actorDid: principal.verifiedDid,
    recipient: 'https://foxxi.example/write', sessionId: 'epoch-session' }));
  for (let i = 0; i < 8; i++) await f.room.execute(principal, command('knowledge.consulted', { resourceId: `https://example.org/learning-epoch/${i}` }));
  await f.room.flushPersistence(); let exactAck;
  const sink = { descriptor: { action: 'urn:iep:action:foxxi:write-xapi-statements-signed', method: 'POST', target: 'https://foxxi.example/write' },
    async publish(events) { return { ok: true, exported: events.length, receipts: projectGamingEvents(events, { domain: 'hallowmarch', gameId: f.room.id }).evidence.map(item => ({ statementId: item.id, persisted: true })) }; } };
  const outbox = createLearningOutbox({ sink, domain: 'hallowmarch', gameId: f.room.id, now: () => 100000,
    getEntries: async () => (await f.room.learningContext()).outbox, getConsent: async ({ actorId }) => (await f.room.learningContext()).consent[actorId],
    acknowledge: data => { exactAck = structuredClone(data); return f.room.acknowledgeLearning(data); } });
  assert.equal((await outbox.flush()).exported, 8); await f.room.close();
  const originalVersion = Object.values(f.room.current.learningReceipts)[0].version;
  const strict = await new AuthoritativeRoom({ ...f.options, persistenceMode: 'strict' }).open();
  await strict.execute(person, command('learningConsent', { enabled: false }));
  const restarted = await new AuthoritativeRoom(f.options).open(); t.after(() => restarted.close());
  assert(originalVersion > restarted.version);
  const replayed = await restarted.acknowledgeLearning(exactAck);
  assert.equal(replayed.durable, true); assert(replayed.version <= restarted.durableSequence);
  assert.equal(restarted.persistenceStatus().pendingCommands, 0);
});
