import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectGamingEvents, createFoxxiSink, FOXXI_XAPI_ACTION, FOXXI_XAPI_ACTION_PUBLISHED, isFoxxiXapiAction, GAMING_NS } from './learning.js';

const DID = 'did:example:alice';
const at = '2026-10-16T00:16:18.000Z';
const event = (version, kind = 'damage', payload = { sourceId: 'p1', targetId: 'monster1', amount: 12, dead: false }, extra = {}) => ({ id: `event-${version}`, streamId: 'realm-0', version, at, actorId: DID, kind, payload, teamId: 'company-a', realmId: '0', ...extra });
const descriptor = { action: FOXXI_XAPI_ACTION, method: 'POST', target: 'https://foxxi.example/advertised/signed-xapi' };
const fixture = (options = {}) => {
  const calls = [], signed = [], consents = [];
  const consent = { allowed: true, sessionId: 'session1', actorId: DID, subjectDid: DID, recipient: descriptor.target, expiresAt: '2026-10-17T00:00:00.000Z' };
  const sink = createFoxxiSink({
    descriptor, now: () => Date.parse(at),
    getConsent: async args => { consents.push(args); return consent; },
    signRequest: async (body, context) => {
      signed.push({ body, context });
      return { _signed_payload: JSON.stringify({ ...body, agent_id: context.subjectDid, timestamp: at }), _signature: 'test-signature' };
    },
    transport: async request => {
      calls.push(request);
      const ids = JSON.parse(request.body._signed_payload).statements.map(s => s.id);
      return { status: 200, body: { ok: true, durable: true, lrsAccepted: true, statementIds: ids, receipts: ids.map(statementId => ({ statementId, persisted: true })) } };
    }, ...options
  });
  return { sink, calls, signed, consents, consent };
};
const session = { sessionId: 'session1', actorId: DID, domain: 'hallowmarch', gameId: 'march' };

test('committed facts project player/team/realm/game scopes without competence claims', () => {
  const rows = [event(1), event(2, 'loot.granted', { claimantId: 'p1', itemId: 'stone', quantity: 3 }), event(3, 'resource.gathered', { entityId: 'p1', resourceId: 'wood', quantity: 4 }), event(4, 'teaching.delivered', {}), event(5, 'knowledge.consulted', {}), event(6, 'movement.applied', { entityId: 'p1', x: 3, z: 8 }), event(7, 'companion.spawned', { entityId: 'pet', ownerPlayerId: 'p1' })];
  const before = JSON.stringify(rows);
  const result = projectGamingEvents(rows, { domain: 'hallowmarch' });
  assert.equal(JSON.stringify(rows), before, 'does not mutate authoritative input');
  assert.equal(result.eventCount, 7);
  for (const scope of [result.scopes.game, result.scopes.players[DID], result.scopes.teams['company-a'], result.scopes.realms['0']]) {
    assert.equal(scope.eventCount, 7);
    assert.deepEqual(scope.metrics, { damageDealt: 12, kills: 0, lootQuantity: 3, resourcesGathered: 4, teachingActions: 1, knowledgeConsultations: 1, companionsSpawned: 1, movements: 1 });
    assert.equal(scope.competencyStatus, 'not-assessed');
  }
  assert.deepEqual(result.competencyClaims, []);
  assert.equal(result.evidence[0].source.binding, 'committed-log-reference');
  assert.equal(result.evidence[0].epistemicStatus, 'observed-activity');
});

test('deduplicates events and kills; refuses immutable identity/version conflicts', () => {
  const killed = event(1, 'damage', { amount: 10, dead: true, killId: 'kill-1' });
  const later = event(2, 'damage', { amount: 0, dead: true, killId: 'kill-1' });
  const result = projectGamingEvents([killed, killed, later]);
  assert.equal(result.duplicatesIgnored, 1);
  assert.equal(result.scopes.game.metrics.kills, 1);
  assert.deepEqual(result.evidence[1], projectGamingEvents([later]).evidence[0], 'per-event evidence stays immutable across replay windows');
  assert.throws(() => projectGamingEvents([killed, { ...killed, payload: { amount: 20 } }]), /conflicting event id/);
  assert.throws(() => projectGamingEvents([killed, { ...killed, id: 'another-id' }]), /conflicting stream version/);
  assert.equal(projectGamingEvents([killed]).evidence[0].id, projectGamingEvents([killed]).evidence[0].id);
});

test('one committed version can contain damage and retaliation with distinct indexes', () => {
  const attack = event(1, 'damage', { sourceId: DID, targetId: 'guardian', amount: 10 }, { index: 0 });
  const retaliation = event(1, 'damage', { sourceId: 'guardian', targetId: DID, amount: 5 }, { id: 'retaliation-1', index: 1, actorId: 'npc:march-guardian', actorKind: 'npc', humanSubject: false, teamId: 'wild', realmId: 'wild' });
  const r = projectGamingEvents([retaliation, attack]);
  assert.equal(r.eventCount, 2);
  assert.equal(r.scopes.players[DID].metrics.damageDealt, 10);
  assert.equal(r.scopes.players['npc:march-guardian'], undefined);
  assert.equal(r.scopes.actors['npc:march-guardian'].metrics.damageDealt, 5);
  assert.equal(r.scopes.teams['company-a'].metrics.damageDealt, 10);
  assert.equal(r.scopes.teams.wild.metrics.damageDealt, 5);
  assert.equal(r.scopes.game.metrics.damageDealt, 15);
  assert.deepEqual(r.evidence.map(e => e.source.index), [0, 1]);
  assert.throws(() => projectGamingEvents([attack, { ...retaliation, index: 0 }]), /conflicting stream version/);
  assert.throws(() => projectGamingEvents([event(1), { ...retaliation, index: 0 }]), /conflicting stream version/, 'absent index defaults to zero');
  for (const index of [-1, 1.5, '1', Infinity]) assert.throws(() => projectGamingEvents([{ ...attack, index }]), /event.index/);
});

test('replay and namespaces isolate games, realms, teams, streams and actors', () => {
  const one = event(1), two = event(2, 'damage', { amount: 3 }, { actorId: 'did:example:bob', realmId: '1', teamId: 'company-b' });
  const r = projectGamingEvents([two, one], { gameId: 'game-a' });
  assert.equal(r.scopes.players[DID].metrics.damageDealt, 12);
  assert.equal(r.scopes.players['did:example:bob'].metrics.damageDealt, 3);
  assert.equal(r.scopes.teams['company-a'].eventCount, 1);
  assert.equal(r.scopes.realms['1'].eventCount, 1);
  assert.equal(r.scopes.game.metrics.damageDealt, 15);
  assert.deepEqual(r, projectGamingEvents([one, two], { gameId: 'game-a' }));
  assert.notEqual(r.evidence[0].id, projectGamingEvents([one], { gameId: 'game-b' }).evidence[0].id);
  assert.notEqual(r.evidence[0].id, projectGamingEvents([{ ...one, streamId: 'different' }], { gameId: 'game-a' }).evidence[0].id);
  assert.equal(projectGamingEvents([event(1, 'player.joined', {}, { actorId: '__proto__', teamId: 'constructor' })]).scopes.players.__proto__.eventCount, 1);
});

test('network samples report measured units and averages, never a performance verdict', () => {
  const r = projectGamingEvents([event(1, 'telemetry.sample', { rttMs: 40, tickMs: 6 }), event(2, 'telemetry.sample', { rttMs: 80, queueMs: 4 })]);
  assert.deepEqual(r.scopes.game.telemetry.rttMs, { count: 2, sum: 120, min: 40, max: 80, mean: 60 });
  assert.equal(r.scopes.game.telemetry.tickMs.count, 1);
  for (const amount of [NaN, Infinity, -1, '30']) assert.throws(() => projectGamingEvents([event(1, 'damage', { amount })]), /finite nonnegative/);
  assert.throws(() => projectGamingEvents([event(0)]), /positive safe integer/);
  assert.throws(() => projectGamingEvents([event(1, 'damage', { amount: 1 }, { at: 'not-a-time' })]), /timestamp/);
});

test('external export requires an advertised concrete signed adapter and server consent', async () => {
  assert.throws(() => createFoxxiSink(), /descriptor/);
  assert.throws(() => createFoxxiSink({ descriptor: { ...descriptor, target: 'https://foxxi.example/{base}/write' } }), /descriptor/);
  const f = fixture({ getConsent: async () => null });
  assert.equal((await f.sink.publish([event(1)], session)).reason, 'export-consent-required');
  assert.equal((await f.sink.publish([event(1)], { actorId: DID })).reason, 'export-session-required');
  assert.equal(f.calls.length, 0); assert.equal(f.signed.length, 0);
});

test('accepts the exact published HTTPS action and preserves its advertised identity', async () => {
  const published = { action: FOXXI_XAPI_ACTION_PUBLISHED, method: 'POST', target: 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/write' };
  const f = fixture({ descriptor: published, getConsent: async () => ({ ...f.consent, recipient: published.target }) });
  assert.equal(f.sink.descriptor.action, published.action);
  assert.equal((await f.sink.publish([event(1)], session)).exported, 1);
  assert.equal(f.calls[0].url, published.target);
  assert.equal(isFoxxiXapiAction(FOXXI_XAPI_ACTION), true);
  assert.equal(isFoxxiXapiAction(FOXXI_XAPI_ACTION_PUBLISHED), true);
  for (const action of [undefined, `${FOXXI_XAPI_ACTION_PUBLISHED}/`, 'https://other.example/ns/iep/action/foxxi/write-xapi-statements-signed', 'urn:other:write-xapi-statements-signed']) {
    assert.equal(isFoxxiXapiAction(action), false);
    assert.throws(() => createFoxxiSink({ descriptor: { ...published, action } }), /descriptor/);
  }
});

test('rejects other players and opaque unverified game accounts before signing', async () => {
  const f = fixture();
  assert.equal((await f.sink.publish([event(1, 'player.joined', {}, { actorId: 'other' })], session)).reason, 'cross-actor-export-denied');
  assert.equal((await f.sink.publish([event(1, 'player.joined', {}, { actorId: 'account1' })], { ...session, actorId: 'account1' })).reason, 'verified-actor-did-required');
  assert.equal(f.calls.length, 0); assert.equal(f.signed.length, 0);
  assert.equal((await f.sink.publish([event(1, 'damage', { amount: 5 }, { humanSubject: false, actorKind: 'npc' })], session)).reason, 'non-player-export-denied');
  assert.equal((await f.sink.publish([event(1, 'damage', { amount: 5 }, { humanSubject: false })], session)).reason, 'non-player-export-denied');
});

test('honors consent subject, recipient, expiry and revocation during signing', async () => {
  for (const changes of [{ subjectDid: 'did:example:other' }, { recipient: 'https://other.example/' }, { expiresAt: at }, { sessionId: 'other' }, { actorId: 'other' }, { allowed: false }]) {
    const f = fixture(); Object.assign(f.consent, changes);
    assert.equal((await f.sink.publish([event(1)], session)).reason, 'export-consent-required');
    assert.equal(f.calls.length, 0);
  }
  let reads = 0;
  const f = fixture({ getConsent: async () => ++reads === 1 ? f.consent : null });
  assert.equal((await f.sink.publish([event(1)], session)).reason, 'export-consent-changed');
  assert.equal(f.calls.length, 0);
  const mutated = fixture({ signRequest: async body => {
    mutated.consent.allowed = false;
    return { _signed_payload: JSON.stringify({ ...body, agent_id: DID }), _signature: 'test' };
  } });
  assert.equal((await mutated.sink.publish([event(1)], session)).reason, 'export-consent-changed', 'a store returning the same mutable object cannot bypass revocation');
  assert.equal(mutated.calls.length, 0);
});

test('exports exact measured own-lens xAPI with stable ids; never invents result.success', async () => {
  const f = fixture();
  assert.equal((await f.sink.publish([event(1)], session)).ok, true);
  const s = f.signed[0].body.statements[0];
  assert.equal(s.actor.account.name, DID);
  assert.equal(s.timestamp, at);
  assert.equal(s.context.extensions[`${GAMING_NS}measured`].metrics.damageDealt, 12);
  assert.equal(s.context.extensions[`${GAMING_NS}competencyStatus`], 'not-assessed');
  assert.equal(s.result, undefined); assert.equal(s.authority, undefined); assert.equal(s.stored, undefined);
  await f.sink.publish([event(1)], session);
  assert.equal(s.id, f.signed[1].body.statements[0].id);
  assert.equal(f.calls[0].url, descriptor.target);
});

test('batches at 20 and checks consent again before each batch', async () => {
  const f = fixture();
  const r = await f.sink.publish(Array.from({ length: 21 }, (_, i) => event(i + 1)), session);
  assert.equal(r.exported, 21); assert.equal(f.calls.length, 2); assert.equal(f.consents.length, 4);
  assert.deepEqual(f.signed.map(s => s.body.statements.length), [20, 1]);
});

test('does not acknowledge success on timeout, partial persistence, or wrong receipt ids', async () => {
  const timeout = fixture({ transport: async () => { throw new Error('timeout'); } });
  const r = await timeout.sink.publish([event(1)], session);
  assert.equal(r.reason, 'foxxi-transport-uncertain'); assert.equal(r.retryable, true);
  for (const body of [{ ok: true, durable: false, lrsAccepted: true }, { ok: true, durable: true, lrsAccepted: true, statementIds: ['wrong'], receipts: [{ statementId: 'wrong', persisted: true }] }]) {
    const f = fixture({ transport: async () => ({ status: 200, body }) });
    const p = await f.sink.publish([event(1)], session);
    assert.equal(p.reason, 'foxxi-durable-ack-required'); assert.equal(p.exported, 0);
  }
  const tamper = fixture({ signRequest: async body => ({ _signed_payload: JSON.stringify({ ...body, agent_id: 'did:example:other' }), _signature: 'test' }) });
  assert.equal((await tamper.sink.publish([event(1)], session)).reason, 'signed-subject-or-content-mismatch');
  assert.equal(tamper.calls.length, 0);
});

test('application vocabularies keep canonical glossary references and no equivalence claims', () => {
  for (const filename of ['vocabulary.jsonld', 'hallowmarch-vocabulary.jsonld']) {
    const profile = JSON.parse(readFileSync(new URL(filename, import.meta.url), 'utf8'));
    assert.ok(profile['@graph'].length > 0);
    assert.ok(JSON.stringify(profile).includes('https://id.i2idl.org/scheme'));
    assert.ok(!JSON.stringify(profile).includes('owl:sameAs'));
    assert.ok(!JSON.stringify(profile).includes('owl:equivalentClass'));
  }
});
