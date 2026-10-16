import test from 'node:test';
import assert from 'node:assert/strict';
import {
  grantCompanion, authorizeCompanion, revokeCompanion, redactObservation,
  applyCompanionEvent, CompanionError,
} from './companions.js';

const NOW = 1_800_000_000_000;
const human = { playerId: 'alice' };
const request = { agentId: 'did:key:z6MkgamingAgent', role: 'teammate', entityId: 'pet-alice' };
const command = { type: 'attack', roomId: 'room-a', entityId: 'pet-alice', targetId: 'wolf' };
function world(roomId = 'room-a') {
  return { roomId, entities: {
    alice: { id: 'alice', kind: 'player', ownerPlayerId: 'alice', realmId: 'north', hp: 100 },
    bob: { id: 'bob', kind: 'player', ownerPlayerId: 'bob', realmId: 'south', hp: 100 },
    'pet-alice': { id: 'pet-alice', kind: 'companion', ownerPlayerId: 'alice', hp: 30 },
    wolf: { id: 'wolf', kind: 'npc', hp: 50 },
  } };
}
function throwsCode(fn, code) {
  assert.throws(fn, error => error instanceof CompanionError && error.code === code);
}

test('explicit human grant returns an opaque token once, stores only its hash, and derives agent identity', () => {
  const state = world();
  const issued = grantCompanion(state, human, request, NOW);
  assert.match(issued.token, /^hmca_[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(state).includes(issued.token));
  assert.ok(!JSON.stringify(issued.event).includes(issued.token));
  assert.equal(issued.grant.tokenHash, undefined);
  const authorized = authorizeCompanion(state, issued.token, command, NOW + 1);
  assert.equal(authorized.ownerPlayerId, 'alice');
  assert.equal(authorized.actorId, request.agentId);
  assert.equal(authorized.entityId, 'pet-alice');
  assert.deepEqual(authorized.command, command);
  assert.equal(state.entities.wolf.hp, 50, 'authorization never applies damage or grants loot');
  const other = grantCompanion(state, human, request, NOW + 2);
  assert.notEqual(other.token, issued.token);
});

test('human identity cannot be impersonated or delegated from an agent principal', () => {
  const state = world();
  const before = structuredClone(state);
  throwsCode(() => grantCompanion(state, human, { ...request, ownerPlayerId: 'bob' }, NOW), 'owner_mismatch');
  throwsCode(() => grantCompanion(state, human, { ...request, playerId: 'bob' }, NOW), 'owner_mismatch');
  throwsCode(() => grantCompanion(state, { playerId: 'intruder' }, request, NOW), 'human_required');
  throwsCode(() => grantCompanion(state, { ...human, kind: 'agent' }, request, NOW), 'human_required');
  throwsCode(() => grantCompanion(state, { ...human, agentId: request.agentId }, request, NOW), 'human_required');
  throwsCode(() => grantCompanion(state, human, { ...request, entityId: 'bob' }, NOW), 'entity_forbidden');
  throwsCode(() => grantCompanion(state, human, { ...request, entityId: 'wolf' }, NOW), 'entity_forbidden');
  assert.deepEqual(state, before);
});

test('room, entity ownership, and payload identity restrictions are checked on every command', () => {
  const state = world();
  const { token } = grantCompanion(state, human, request, NOW);
  throwsCode(() => authorizeCompanion(state, token, { ...command, roomId: 'room-b' }, NOW + 1), 'room_mismatch');
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 1, { roomId: 'room-b' }), 'room_mismatch');
  throwsCode(() => authorizeCompanion({ ...state, roomId: 'room-b' }, token, command, NOW + 1), 'room_mismatch');
  throwsCode(() => authorizeCompanion(state, token, { ...command, entityId: 'bob' }, NOW + 1), 'entity_forbidden');
  throwsCode(() => authorizeCompanion(state, token, { ...command, ownerPlayerId: 'bob' }, NOW + 1), 'command_fields');
  throwsCode(() => authorizeCompanion(state, token, { ...command, damage: 99999 }, NOW + 1), 'command_fields');
  state.entities['pet-alice'].ownerPlayerId = 'bob';
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 1), 'entity_forbidden');
});

test('expiry, human revocation, and invalid capabilities take effect immediately', () => {
  const state = world();
  const { token, grant } = grantCompanion(state, human, { ...request, expiresAt: NOW + 100 }, NOW);
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 100), 'expired');
  throwsCode(() => authorizeCompanion(state, 'hmca_' + 'a'.repeat(43), command, NOW + 1), 'invalid_capability');
  throwsCode(() => authorizeCompanion(state, 'not-a-token', command, NOW + 1), 'invalid_capability');
  throwsCode(() => revokeCompanion(state, { playerId: 'bob' }, grant.id, NOW + 1), 'grant_forbidden');
  authorizeCompanion(state, token, command, NOW + 1);
  const revoked = revokeCompanion(state, human, grant.id, NOW + 2);
  assert.equal(revoked.grant.revokedAt, NOW + 2);
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 2), 'revoked');
  assert.equal(revokeCompanion(state, human, grant.id, NOW + 3).grant.revokedAt, NOW + 2);
});

test('coach is read-only, pets have bounded actions, and loot claims require an explicit teammate scope', () => {
  const state = world();
  const coach = grantCompanion(state, human, { ...request, role: 'coach' }, NOW);
  authorizeCompanion(state, coach.token, { type: 'observe' }, NOW);
  throwsCode(() => authorizeCompanion(state, coach.token, command, NOW), 'scope_forbidden');
  throwsCode(() => grantCompanion(state, human, { ...request, role: 'coach', scopes: ['attack'] }, NOW), 'invalid_scopes');
  throwsCode(() => grantCompanion(state, human, { ...request, role: 'pet', scopes: ['claimLoot'] }, NOW), 'invalid_scopes');
  const ally = grantCompanion(state, human, request, NOW);
  for (const type of ['claimLoot', 'awardReward', 'editWorld', 'grant', 'trade', 'setHp']) {
    throwsCode(() => authorizeCompanion(state, ally.token, { type }, NOW), 'scope_forbidden');
  }
  const looter = grantCompanion(state, human, { ...request, scopes: ['observe', 'claimLoot'] }, NOW);
  const permitted = authorizeCompanion(state, looter.token, { type: 'claimLoot', targetId: 'loot-1' }, NOW);
  assert.equal(permitted.command.entityId, 'pet-alice');
  assert.equal(state.entities.wolf.hp, 50);
  assert.equal(state.loot, undefined);
});

test('rolling rate limit cannot be bypassed at second boundaries and failures do not consume capacity', () => {
  const state = world();
  const { token, grant } = grantCompanion(state, human, { ...request, maxCommandsPerSecond: 2 }, NOW);
  authorizeCompanion(state, token, command, NOW + 999);
  throwsCode(() => authorizeCompanion(state, token, { ...command, x: Infinity }, NOW + 999), 'invalid_command');
  authorizeCompanion(state, token, command, NOW + 1000);
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 1001), 'rate_limited');
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 1002), 'rate_limited');
  assert.equal(state.companions.grants[grant.id].commandTimes.length, 2);
  authorizeCompanion(state, token, command, NOW + 1999);
  throwsCode(() => authorizeCompanion(state, token, command, NOW + 1998), 'clock_regressed');
});

test('grant lifetime, scope, rate, identity, and active count are bounded', () => {
  const state = world();
  for (const patch of [
    { expiresAt: NOW }, { expiresAt: NOW + 3_600_001 }, { maxCommandsPerSecond: 0 },
    { maxCommandsPerSecond: 21 }, { maxCommandsPerSecond: 1.5 }, { scopes: [] },
    { scopes: ['editWorld'] }, { agentId: 'https://example.test/not-a-did' }, { role: '__proto__' },
  ]) assert.throws(() => grantCompanion(state, human, { ...request, ...patch }, NOW), CompanionError);
  for (let i = 0; i < 8; i++) grantCompanion(state, human, request, NOW);
  throwsCode(() => grantCompanion(state, human, request, NOW), 'grant_limit');
  grantCompanion(state, human, request, NOW + 900_000);
  assert.equal(Object.keys(state.companions.grants).length, 1, 'expired grants leave active state; journal retains history');
});

test('public observations omit all private data, credentials, inventory, chat, and arbitrary nested fields', () => {
  const state = world();
  const { token } = grantCompanion(state, human, request, NOW);
  const auth = authorizeCompanion(state, token, { type: 'observe' }, NOW);
  const observation = {
    roomId: 'room-a', version: 2, tick: 4, time: NOW, chat: ['secret message'],
    inventory: ['private sword'], profile: { email: 'private@example.test' }, companions: state.companions,
    entities: { alice: { ...state.entities.alice, x: 1, z: 2, inventory: ['secret'], authToken: token, extra: { hp: 'secret' } } },
  };
  const safe = redactObservation(observation, auth);
  assert.deepEqual(safe, { roomId: 'room-a', version: 2, tick: 4, time: NOW,
    entities: [{ id: 'alice', kind: 'player', realmId: 'north', x: 1, z: 2, hp: 100 }] });
  assert.ok(!JSON.stringify(safe).includes('secret'));
  throwsCode(() => redactObservation({ ...observation, roomId: 'room-b' }, auth), 'observation_forbidden');
  throwsCode(() => redactObservation(observation, { ...auth, scopes: ['attack'] }), 'observation_forbidden');
  safe.entities[0].hp = 1;
  assert.equal(state.entities.alice.hp, 100);
});

test('durable events replay grants, command limits and revocation exactly without any token in the journal', () => {
  const state = world();
  const replay = world();
  const issued = grantCompanion(state, human, request, NOW);
  const allowed = authorizeCompanion(state, issued.token, command, NOW + 1);
  const revoked = revokeCompanion(state, human, issued.grant.id, NOW + 2);
  const events = [issued.event, allowed.event, revoked.event];
  for (const event of events) applyCompanionEvent(replay, event);
  assert.deepEqual(replay, state);
  assert.ok(!JSON.stringify(events).includes(issued.token));
  throwsCode(() => authorizeCompanion(replay, issued.token, command, NOW + 3), 'revoked');
  const later = grantCompanion(state, human, request, NOW + 4);
  applyCompanionEvent(replay, later.event);
  assert.deepEqual(replay, state, 'compaction is deterministic in journal replay');
  authorizeCompanion(replay, later.token, command, NOW + 5);
});

test('agent observations retain bounded live and durable progress while dropping arbitrary persistence details', () => {
  const state = world(), { token } = grantCompanion(state, human, request, NOW);
  const auth = authorizeCompanion(state, token, { type: 'observe' }, NOW);
  const observation = { roomId: 'room-a', version: 12, liveSequence: 12, durableSequence: 8, durableVersion: 3, durable: false,
    persistence: { mode: 'realtime', status: 'pending', liveSequence: 12, durableSequence: 8, durableVersion: 3,
      pendingCommands: 4, oldestPendingMs: 120, pendingRewards: true, token, owner: human, lastError: 'secret native exception' }, entities: {} };
  const safe = redactObservation(observation, auth);
  assert.deepEqual(safe, { roomId: 'room-a', version: 12, liveSequence: 12, durableSequence: 8, durableVersion: 3, durable: false,
    persistence: { mode: 'realtime', status: 'pending', liveSequence: 12, durableSequence: 8, durableVersion: 3,
      pendingCommands: 4, oldestPendingMs: 120, pendingRewards: true }, entities: [] });
  assert(!JSON.stringify(safe).includes(token)); assert(!JSON.stringify(safe).includes('secret'));
  const malformed = redactObservation({ ...observation, liveSequence: Infinity, durableVersion: -1,
    persistence: { ...observation.persistence, pendingCommands: -1, oldestPendingMs: 1.5, pendingRewards: token } }, auth);
  assert.equal(malformed.liveSequence, undefined); assert.equal(malformed.durableVersion, undefined);
  assert.equal(malformed.persistence.pendingCommands, undefined); assert.equal(malformed.persistence.oldestPendingMs, undefined);
  assert.equal(malformed.persistence.pendingRewards, undefined);
});
