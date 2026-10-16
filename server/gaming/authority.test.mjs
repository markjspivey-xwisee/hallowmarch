import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthoritativeRoom } from './authority.js';
import { createHallowmarchDomain } from './hallowmarch.js';
import { projectGamingEvents } from './learning.js';
import { createLearningOutbox } from './outbox.js';

// A disk fixture, not an Interego implementation or production fallback. Shared
// promise models CAS in one fixture process; native adapter tests cover HTTP CAS.
class DiskFixture {
  constructor(dir) { this.dir = dir; this.tail = Promise.resolve(); this.fail = false; }
  async load(id) { try { return JSON.parse(await readFile(path.join(this.dir, id + '.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { version: 0, state: null }; throw e; } }
  commit(id, request) {
    const work = this.tail.then(async () => {
      if (this.fail) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      const old = await this.load(id);
      if (old.version !== request.expectedVersion) throw Object.assign(new Error('stale'), { code: 'version_conflict' });
      const value = { version: old.version + 1, state: request.state, event: request.event };
      const file = path.join(this.dir, id + '.json'); await writeFile(file + '.tmp', JSON.stringify(value)); await rename(file + '.tmp', file);
      return structuredClone(value);
    }); this.tail = work.catch(() => {}); return work;
  }
}
const person = id => ({ playerId: id, realmId: '0', name: id });
let commandN = 0;
const command = (type, fields = {}) => ({ commandId: `test-${++commandN}`, type, ...fields });
async function fixture(t, monsterHp = 100) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gaming-authority-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new DiskFixture(dir); let now = 100000;
  const options = { roomId: 'march-proof', store, domain: createHallowmarchDomain({ monsterHp }), clock: () => now };
  const room = await new AuthoritativeRoom(options).open();
  return { room, store, options, advance: ms => { now += ms; } };
}

test('two players see one enemy, one death, one loot grant, and exact disk restart state', async t => {
  const f = await fixture(t, 20), a = person('alice'), b = person('bob');
  await f.room.execute(a, command('join')); await f.room.execute(b, command('join'));
  f.advance(1000);
  await f.room.execute(a, command('move', { x: 0, z: 3 })); await f.room.execute(b, command('move', { x: 1, z: 3 }));
  await Promise.all([f.room.execute(a, command('attack', { targetId: 'march-guardian' })), f.room.execute(b, command('attack', { targetId: 'march-guardian' }))]);
  assert.equal((await f.room.observe(a)).entities['march-guardian'].hp, 0);
  assert.equal((await f.room.observe(b)).entities['march-guardian'].hp, 0);
  const claims = await Promise.allSettled([f.room.execute(a, command('claimLoot', { targetId: 'march-guardian' })), f.room.execute(b, command('claimLoot', { targetId: 'march-guardian' }))]);
  assert.equal(claims.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(Object.values(f.room.current.rewards).reduce((n, r) => n + (r['guardian-token'] || 0), 0), 1);
  const version = f.room.version, saved = JSON.stringify(f.room.current);
  const restarted = await new AuthoritativeRoom(f.options).open();
  assert.equal(restarted.version, version); assert.equal(JSON.stringify(restarted.current), saved);
  assert.equal(Object.values(restarted.current.loot).length, 1);
  const projection = projectGamingEvents(restarted.current.events, { domain: 'hallowmarch' });
  assert.equal(projection.scopes.game.metrics.kills, 1);
  assert.equal(projection.scopes.players.alice.metrics.damageDealt, 10);
});

test('independent room writers reload CAS winner instead of losing another player', async t => {
  const f = await fixture(t), other = await new AuthoritativeRoom(f.options).open();
  await Promise.all([f.room.execute(person('alice'), command('join')), other.execute(person('bob'), command('join'))]);
  const restarted = await new AuthoritativeRoom(f.options).open();
  assert(restarted.current.entities.alice); assert(restarted.current.entities.bob);
  assert.equal(restarted.version, 3);
});

test('command replay survives restart; changed content cannot reuse commandId', async t => {
  const f = await fixture(t), a = person('alice'), join = command('join');
  const first = await f.room.execute(a, join); const restarted = await new AuthoritativeRoom(f.options).open();
  const replay = await restarted.execute(a, join); assert(replay.replayed); assert.equal(replay.version, first.version);
  await assert.rejects(restarted.execute(a, { ...join, type: 'attack', targetId: 'march-guardian' }), { code: 'idempotency_conflict' });
});

test('failed durability never publishes speculative movement or an acknowledgement', async t => {
  const f = await fixture(t), a = person('alice'); await f.room.execute(a, command('join')); f.advance(1000);
  const before = JSON.stringify(f.room.current), version = f.room.version; let notifications = 0; f.room.subscribe(() => notifications++); f.store.fail = true;
  await assert.rejects(f.room.execute(a, command('move', { x: 0, z: 2 })));
  assert.equal(JSON.stringify(f.room.current), before); assert.equal(f.room.version, version); assert.equal(notifications, 0);
});

test('server validates movement, damage, range, cooldown, and entity ownership', async t => {
  const f = await fixture(t), a = person('alice'), b = person('bob'); await f.room.execute(a, command('join')); await f.room.execute(b, command('join'));
  await assert.rejects(f.room.execute(a, command('move', { entityId: 'bob', x: 0, z: 1 })), { code: 'entity_forbidden' });
  await assert.rejects(f.room.execute(a, command('move', { x: 30, z: 0 })), { code: 'pace_exceeded' });
  await assert.rejects(f.room.execute(a, command('attack', { targetId: 'march-guardian', damage: 9999 })), { code: 'out_of_range' });
  f.advance(1000); await f.room.execute(a, command('move', { x: 0, z: 3 }));
  await f.room.execute(a, command('attack', { targetId: 'march-guardian', damage: 9999 }));
  assert.equal(f.room.current.entities['march-guardian'].hp, 90);
  await assert.rejects(f.room.execute(a, command('attack', { targetId: 'march-guardian' })), { code: 'cooldown' });
});

test('companion control uses the same durable rules and revocation is immediate', async t => {
  const f = await fixture(t), a = person('alice'); await f.room.execute(a, command('join'));
  const companion = await f.room.execute(a, command('spawnCompanion', { name: 'Pip' }));
  const entityId = companion.result.entityId;
  const response = await f.room.execute(a, command('grantCompanion', { request: { agentId: 'did:example:pip', role: 'pet', entityId } }));
  const token = response.result.token, grantId = response.result.grant.id;
  assert(token); assert(!JSON.stringify(f.room.current).includes(token)); f.advance(1000);
  const agent = { kind: 'agent', token, entityId };
  await f.room.execute(agent, command('move', { entityId, x: 0, z: 3 }));
  await f.room.execute(agent, command('attack', { entityId, targetId: 'march-guardian' }));
  assert.equal(f.room.current.entities['march-guardian'].hp, 95);
  await f.room.execute(a, command('revokeCompanion', { grantId }));
  await assert.rejects(f.room.execute(agent, command('move', { entityId, x: 0, z: 4 })), { code: 'revoked' });
});

test('learning exports require verified identity and explicit bounded consent', async t => {
  const f = await fixture(t), a = person('alice'); await f.room.execute(a, command('join'));
  await f.room.execute(a, command('knowledge.consulted', { resourceId: 'https://example.org/field-notes' }));
  assert.equal(f.room.current.outbox.length, 0);
  const consent = command('learningConsent', { enabled: true, expiresAt: 110000, actorDid: 'did:example:alice', recipient: 'https://foxxi.example/write', sessionId: 'session-1' });
  await assert.rejects(f.room.execute(a, consent), { code: 'identity_unverified' });
  await f.room.execute({ ...a, verifiedDid: 'did:example:alice' }, consent);
  await f.room.execute(a, command('knowledge.consulted', { resourceId: 'https://example.org/field-notes' }));
  assert.equal(f.room.current.outbox.length, 1);
  await f.room.execute(a, command('learningConsent', { enabled: false }));
  assert.equal(f.room.current.consent.alice.enabled, false);
  assert.equal(f.room.current.outbox.length, 0, 'withdrawing consent cancels undelivered exports');
});

test('verified learning receipts leave the native room outbox only after its durable acknowledgement', async t => {
  const f = await fixture(t), a = { ...person('alice'), verifiedDid: 'did:example:alice' };
  await f.room.execute(a, command('join'));
  await f.room.execute(a, command('learningConsent', { enabled: true, expiresAt: 110000, actorDid: a.verifiedDid, recipient: 'https://foxxi.example/write', sessionId: 'session-1' }));
  await f.room.execute(a, command('knowledge.consulted', { resourceId: 'https://example.org/field-notes' }));
  const sink = { descriptor: { action: 'urn:iep:action:foxxi:write-xapi-statements-signed', method: 'POST', target: 'https://foxxi.example/write' },
    async publish(events) { return { ok: true, exported: events.length, receipts: projectGamingEvents(events, { domain: 'hallowmarch', gameId: f.room.id }).evidence.map(e => ({ statementId: e.id, persisted: true })) }; } };
  const outbox = createLearningOutbox({ sink, domain: 'hallowmarch', gameId: f.room.id, now: () => 100000,
    getEntries: async () => (await f.room.learningContext()).outbox, getConsent: async ({ actorId }) => (await f.room.learningContext()).consent[actorId], acknowledge: data => f.room.acknowledgeLearning(data) });
  f.store.fail = true;
  // Failed native reads/writes are never replaced with a volatile acknowledgement.
  const first = await outbox.flush(); assert.equal(first.exported, 0); assert.equal(f.room.current.outbox.length, 1);
  f.store.fail = false;
  const result = await outbox.flush(); assert.equal(result.exported, 1); assert.equal(f.room.current.outbox.length, 0);
  const restarted = await new AuthoritativeRoom(f.options).open(); assert.equal(restarted.current.outbox.length, 0);
  assert.equal(Object.values(restarted.current.learningReceipts)[0].status, 'exported');
});

test('canonical refresh enforces revocation for cached observations and command replays on other processes', async t => {
  const f = await fixture(t), a = person('alice');
  await f.room.execute(a, command('join'));
  const granted = await f.room.execute(a, command('grantCompanion', { request: { agentId: 'did:example:pip', role: 'teammate' } }));
  const agent = { kind: 'agent', token: granted.result.token, entityId: 'alice' };
  const other = await new AuthoritativeRoom(f.options).open(); f.advance(1000);
  const move = command('move', { entityId: 'alice', x: 0, z: 1 }); await other.execute(agent, move);
  await f.room.execute(a, command('revokeCompanion', { grantId: granted.result.grant.id }));
  await assert.rejects(other.observe(agent), { code: 'revoked' });
  await assert.rejects(other.execute(agent, move), { code: 'revoked' });
  assert.equal((await f.store.load('march-proof')).state.entities.alice.z, 1);
});

test('rules evaluate the current committed world rather than a stale process cache', async t => {
  const f = await fixture(t), other = await new AuthoritativeRoom(f.options).open(), a = person('alice');
  await f.room.execute(a, command('join')); f.advance(1000);
  await other.execute(a, command('move', { x: 0, z: 1 }));
  assert.equal((await f.room.observe(a)).entities.alice.z, 1);
});

test('flat per-command movement tolerance cannot accumulate into free speed', async t => {
  const f = await fixture(t), a = person('alice'); await f.room.execute(a, command('join'));
  for (let i = 0; i < 5; i++) await assert.rejects(f.room.execute(a, command('move', { x: 0.01, z: 0 })), { code: 'pace_exceeded' });
  assert.equal(f.room.current.entities.alice.x, 0);
});

test('queued actor and payload are immutable and semantically identical field order replays', async t => {
  const f = await fixture(t), a = person('alice');
  const joined = await f.room.execute(a, { type: 'join', commandId: 'canonical-join' });
  const replayed = await f.room.execute(a, { commandId: 'canonical-join', type: 'join' });
  assert.equal(replayed.replayed, true); assert.equal(replayed.version, joined.version);
  let unblock; f.room.queue = new Promise(resolve => { unblock = resolve; });
  const actor = { ...a }, input = command('knowledge.consulted', { resourceId: 'https://example.org/original' });
  const queued = f.room.execute(actor, input); actor.playerId = 'bob'; input.resourceId = 'https://example.org/changed';
  unblock(); await queued;
  const event = f.room.current.events.at(-1);
  assert.equal(event.actorId, 'alice'); assert.equal(event.payload.resourceId, 'https://example.org/original');
});

test('uncertain receipt replay refreshes newer canonical state without rolling another writer back', async t => {
  const f = await fixture(t), a = person('alice'), b = person('bob'); await f.room.execute(a, command('join'));
  const other = await new AuthoritativeRoom(f.options).open(), original = f.store.commit.bind(f.store); let intercept = true;
  f.store.commit = async (id, request) => {
    const receipt = await original(id, request);
    if (!intercept) return receipt;
    intercept = false;
    await other.execute(b, command('join'));
    return { ...receipt, replayed: true };
  };
  await f.room.execute(a, command('knowledge.consulted', { resourceId: 'https://example.org/note' }));
  assert(f.room.current.entities.bob); assert.equal(f.room.version, 4);
});

test('invalid stored identity/version is rejected without resetting or rolling back the room', async t => {
  const f = await fixture(t), original = f.store.load.bind(f.store), saved = await original('march-proof');
  f.store.load = async () => ({ ...saved, state: { ...saved.state, roomId: 'different-room' } });
  await assert.rejects(new AuthoritativeRoom(f.options).open(), { code: 'corrupt_state' });
  f.store.load = original; await f.room.execute(person('alice'), command('join'));
  f.store.load = async () => saved;
  await assert.rejects(f.room.observe(person('alice')), { code: 'stale_state' });
  assert.equal(f.room.version, 2);
});

test('reserved entity identities and non-human principals cannot enter as players', async t => {
  const f = await fixture(t);
  await assert.rejects(f.room.execute(person('march-guardian'), command('join')), { code: 'identity_collision' });
  await assert.rejects(f.room.execute({ ...person('robot'), kind: 'npc' }, command('join')), { code: 'unauthenticated' });
  await f.room.execute(person('toString'), command('join'));
  assert.equal(f.room.current.entities.toString.kind, 'player');
});

test('nonfinite command data and invalid domain parameters are refused', async t => {
  const f = await fixture(t);
  await assert.rejects(f.room.execute(person('alice'), command('move', { x: NaN, z: 0 })), { code: 'invalid_command' });
  assert.throws(() => createHallowmarchDomain({ monsterHp: Infinity }), { code: 'invalid_domain' });
  assert.throws(() => createHallowmarchDomain({ origin: { x: 0, z: NaN } }), { code: 'invalid_domain' });
});

test('simultaneous same command recovers a native payload-idempotency conflict by logical fingerprint', async t => {
  const f = await fixture(t), other = await new AuthoritativeRoom(f.options).open(), original = f.store.commit.bind(f.store);
  const operations = new Set();
  f.store.commit = async (id, request) => {
    try { const receipt = await original(id, request); operations.add(request.idempotencyKey); return receipt; }
    catch (error) {
      if (error.code === 'version_conflict' && operations.has(request.idempotencyKey)) throw Object.assign(new Error('Different derived native payload'), { code: 'IDEMPOTENCY_CONFLICT' });
      throw error;
    }
  };
  const join = command('join'), a = person('alice');
  const accepted = await Promise.all([f.room.execute(a, join), other.execute(a, join)]);
  assert.equal(accepted.filter(result => result.replayed).length, 1);
  assert.equal(accepted[0].version, accepted[1].version);
  assert.equal((await f.store.load('march-proof')).version, 2);
});

test('world creation is attributed to the system rather than a human player', async t => {
  const f = await fixture(t), created = f.room.current.events[0];
  assert.equal(created.kind, 'world.created'); assert.equal(created.actorKind, 'system'); assert.equal(created.humanSubject, false);
  const restored = await new AuthoritativeRoom(f.options).open();
  const projection = projectGamingEvents(restored.current.events, { domain: 'hallowmarch' });
  assert.equal(projection.scopes.actors.server.eventCount, 1);
  assert.equal(projection.scopes.players.server, undefined);
  assert.equal(projection.scopes.game.eventCount, 1);
});
