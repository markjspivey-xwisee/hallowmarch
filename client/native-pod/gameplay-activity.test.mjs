import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createGameplayActivityProfile, gameplayActivityStatement, GAMEPLAY_MILESTONES, GAMEPLAY_ACTIVITY_LIMITS, GAMEPLAY_EVENT_TYPES } from './gameplay-activity.mjs';
import { createOwnerGameplayActivityArchive } from './gameplay-activity-archive.mjs';

const OWNER = 'did:web:identity.example:users:alice', CHARACTER = 'alice-character';
const SESSION = 'e33daf53-f15a-407d-9a5c-a069511c7ec8', NEXT = 'f99e0250-ec87-44fc-984c-04c7b364c57b';
const reference = suffix => ({ graphIri: 'urn:graph:hallowmarch:gameplay-activity:' + suffix.repeat(64),
  cid: 'cid-' + suffix, descriptorUrl: 'https://pod.example/alice/context-graphs/' + suffix + '.ttl' });
function fixture({ state, sessionId = SESSION, ownerDid = OWNER } = {}) {
  let clock = Date.parse('2026-10-17T13:00:00.000Z');
  const profile = createGameplayActivityProfile({ ownerDid, characterId: CHARACTER, sessionId, state,
    now: () => clock, uuid: () => webcrypto.randomUUID() });
  const outcome = (type = 'resource.gathered', extra = {}) => ({ type, body: { id: CHARACTER, kind: 'character' },
    actor: { kind: 'unattributed' }, object: { id: 'stone', kind: 'resource' }, result: { quantity: 2, success: true }, context: { party: false }, ...extra });
  return { profile, outcome, advance: ms => { clock += ms; } };
}

test('real outcomes preserve counters, actual quantities and duplicate identities across profile restore', () => {
  const f = fixture(), id = 'urn:uuid:' + webcrypto.randomUUID();
  const input = f.outcome('combat.healed', { id, result: { quantity: 7.5, success: true } });
  assert.equal(f.profile.record(input).recorded, true); input.result.quantity = 999;
  assert.deepEqual(f.profile.record(f.outcome('combat.healed', { id })), { recorded: false, duplicate: true });
  const saved = f.profile.save(), resumed = fixture({ state: saved, sessionId: NEXT });
  assert.equal(resumed.profile.snapshot().summary.quantities['combat.healed'], 7.5);
  assert.equal(resumed.profile.snapshot().eventCount, 1);
  assert.deepEqual(resumed.profile.record(resumed.outcome('combat.healed', { id })), { recorded: false, duplicate: true });
  saved.counters['combat.healed'] = 999;
  assert.equal(resumed.profile.snapshot().summary.counters['combat.healed'], 1);
  assert.throws(() => fixture({ state: resumed.profile.save(), ownerDid: 'did:web:identity.example:users:bob' }), { code: 'activity_scope' });
});

test('restored counters, detail accounting, times and session cursors cannot contradict retained events', () => {
  const f = fixture(); f.profile.record(f.outcome()); f.profile.record(f.outcome());
  const mutations = [
    state => { state.counters['resource.gathered'] = 1; },
    state => { state.archivedEvents = 1; },
    state => { state.lastEventAt = null; },
    state => { state.sessions[0].sequence = 0; },
  ];
  for (const mutate of mutations) {
    const state = f.profile.save(); mutate(state);
    assert.throws(() => fixture({ state }));
  }
});

test('a full detail queue rolls forward with actual fresh outcomes and contiguous retained sequences', () => {
  const f = fixture();
  for (let index = 0; index < 64; index++) assert.equal(f.profile.record(f.outcome()).retained, true);
  assert.equal(f.profile.record(f.outcome()).retained, true);
  let snapshot = f.profile.snapshot(); assert.equal(snapshot.eventCount, 65);
  assert.equal(snapshot.summary.counters['resource.gathered'], 65); assert.equal(snapshot.summary.quantities['resource.gathered'], 130);
  assert.equal(snapshot.history.pendingEvents, 64); assert.equal(snapshot.history.detailsDropped, 1); assert.equal(snapshot.history.complete, false);
  const archived = f.profile.nextArchivePage(); assert.equal(archived.events[0].sequence, 2); f.profile.archiveConfirmed(archived, reference('a'));
  const after = f.profile.record(f.outcome()); assert.equal(after.event.sequence, 66); assert.equal(after.event.ordinal, 66);
  snapshot = f.profile.snapshot(); assert.equal(snapshot.history.archivedEvents, 64); assert.equal(snapshot.history.pendingEvents, 1);
  assert.equal(f.profile.nextArchivePage().events[0].sequence, 66);
});

test('hundreds of unarchived actions preserve milestones and keep fresh bounded detail available for coaching and xAPI', () => {
  const f = fixture(); const early = f.profile.record(f.outcome('craft.completed')).event;
  for (let index = 0; index < 255; index++) { f.advance(1000); const result = f.profile.record(f.outcome());
    assert(result.retained); assert.equal(result.event.ordinal, index + 2); }
  const snapshot = f.profile.snapshot(), saved = f.profile.save();
  assert.equal(snapshot.eventCount, 256); assert.equal(saved.pending.length, 64); assert.equal(saved.recent.length, 16);
  assert.equal(saved.pending[0].ordinal, 193); assert.equal(saved.pending.at(-1).ordinal, 256);
  assert.equal(saved.recent[0].ordinal, 241); assert.equal(saved.recent.at(-1).ordinal, 256);
  assert.equal(snapshot.summary.counters['resource.gathered'], 255); assert.equal(snapshot.summary.quantities['resource.gathered'], 510);
  const craft = snapshot.milestones.find(item => item.id === 'craft-one'); assert(craft.completed); assert.deepEqual(craft.evidenceIds, [early.id]);
  assert.equal(snapshot.history.detailsDropped, 192); assert.equal(snapshot.history.complete, false);
  assert.deepEqual(snapshot.history.coverage, { kind: 'bounded-rolling-detail', retainedEvents: 64, firstOrdinal: 193, lastOrdinal: 256,
    from: saved.pending[0].observedAt, until: saved.pending.at(-1).observedAt, maxPendingEvents: 64, maxRecentEvents: 16 });
  assert(new TextEncoder().encode(JSON.stringify(saved)).length <= GAMEPLAY_ACTIVITY_LIMITS.bytes);
  const latest = gameplayActivityStatement(saved.recent.at(-1), OWNER);
  assert.equal(latest.result.extensions['urn:interego:gaming:activity:observation'].historyOrdinal, 256);
  assert.equal(latest.timestamp, saved.pending.at(-1).observedAt); assert.equal(latest.actor.account.name, OWNER);
  const restored = fixture({ state: saved, sessionId: NEXT }); restored.advance(256000);
  const next = restored.profile.record(restored.outcome('craft.refused', { result: { success: false, reason: 'requirements' } }));
  assert.equal(next.event.ordinal, 257); assert.equal(restored.profile.snapshot().current.id, 'craft-readiness');
  assert.equal(restored.profile.snapshot().milestones.find(item => item.id === 'craft-one').completed, true);
});

test('evicted in-flight archive prefixes cannot confirm or erase a newer rolling window', () => {
  const f = fixture(); f.profile.record(f.outcome()); const original = f.profile.nextArchivePage();
  for (let index = 0; index < 128; index++) f.profile.record(f.outcome());
  const before = f.profile.save();
  assert.throws(() => f.profile.archiveConfirmed(original, reference('a')), { code: 'activity_archive_changed' });
  assert.deepEqual(f.profile.save(), before); assert.equal(before.pending.at(-1).ordinal, 129);
  const available = f.profile.nextArchivePage(); f.profile.archiveConfirmed(available, reference('b'));
  const snapshot = f.profile.snapshot(); assert.equal(snapshot.history.archivedEvents, 64);
  assert.equal(snapshot.history.detailsDropped, 65); assert.equal(snapshot.history.complete, false);
});

test('all bounded bodies and event types keep cumulative counts and current evidence under the byte ceiling', () => {
  const f = fixture(); let count = 0, latest;
  for (let round = 0; round < 3; round++) for (let body = 0; body < GAMEPLAY_ACTIVITY_LIMITS.bodies; body++) for (const type of GAMEPLAY_EVENT_TYPES) {
    const result = f.profile.record(f.outcome(type, { body: { id: 'unit-'.repeat(24) + String(body), kind: 'owned-unit' },
      object: { id: 'x'.repeat(128), kind: 'task' } })); count++; latest = result.event;
    assert(result.retained, 'the latest actual observation remains available under aggregate pressure');
  }
  const saved = f.profile.save(), restored = fixture({ state: saved, sessionId: NEXT });
  assert.equal(saved.eventCount, count); assert.equal(saved.pending.at(-1).ordinal, count);
  assert.equal(saved.pending.at(-1).id, latest.id); assert(saved.pending.length <= 64); assert(saved.recent.length <= 16);
  assert(new TextEncoder().encode(JSON.stringify(saved)).length <= GAMEPLAY_ACTIVITY_LIMITS.bytes);
  for (const type of GAMEPLAY_EVENT_TYPES) assert.equal(restored.profile.snapshot().summary.counters[type], GAMEPLAY_ACTIVITY_LIMITS.bodies * 3);
  for (const body of restored.profile.snapshot().summary.bodyObservations) for (const type of GAMEPLAY_EVENT_TYPES) {
    assert.equal(body.counters[type], 3); assert.equal(body.evidenceByType[type].length, 1);
  }
  assert.equal(saved.archivedEvents + saved.pending.length + saved.historyGaps.detailsDropped, count);
});

test('unavailable capture is preserved as an explicit historical gap without invented events', () => {
  const f = fixture(); f.profile.record(f.outcome()); f.profile.captureGap(3);
  const resumed = fixture({ state: f.profile.save(), sessionId: NEXT });
  assert.equal(resumed.profile.snapshot().eventCount, 1);
  assert.equal(resumed.profile.snapshot().history.captureUnavailable, 3);
  assert.equal(resumed.profile.snapshot().history.complete, false);
  assert.equal(resumed.profile.snapshot().summary.counters['resource.gathered'], 1);
});

test('confirming a native page leaves outcomes observed during its write pending', () => {
  const f = fixture(); f.profile.record(f.outcome()); const writing = f.profile.nextArchivePage();
  f.profile.record(f.outcome('craft.completed', { object: { id: 'stone-tool', kind: 'recipe' } }));
  f.profile.archiveConfirmed(writing, reference('b'));
  const snapshot = f.profile.snapshot(); assert.equal(snapshot.history.archivedEvents, 1); assert.equal(snapshot.history.pendingEvents, 1);
  const next = f.profile.nextArchivePage(); assert.equal(next.events[0].sequence, 2); assert.deepEqual(next.previous, reference('b'));
  assert.equal(snapshot.eventCount, 2); assert.equal(snapshot.summary.counters['craft.completed'], 1);
});

test('archive batches are contiguous front runs and never remove an intervening session', () => {
  const first = fixture(); first.profile.record(first.outcome());
  const second = fixture({ state: first.profile.save(), sessionId: NEXT }); second.profile.record(second.outcome());
  assert.throws(() => fixture({ state: second.profile.save() }), { code: 'activity_scope' });
  const malformed = second.profile.save();
  malformed.pending.push({ ...malformed.pending[0], id: 'urn:uuid:' + webcrypto.randomUUID(), sequence: 2, ordinal: 3 });
  assert.throws(() => fixture({ state: malformed }), { code: 'invalid_activity' });
  const writing = second.profile.nextArchivePage(); assert.equal(writing.events.length, 1);
  assert.equal(writing.events[0].sessionId, SESSION); second.profile.archiveConfirmed(writing, reference('c'));
  const next = second.profile.nextArchivePage(); assert.equal(next.events.length, 1); assert.equal(next.sessionId, NEXT);
  assert.equal(second.profile.save().pending.length, 1);
});

test('legal mixed-size detail queues produce pages accepted by the native archive byte bound', async () => {
  const f = fixture();
  for (let index = 0; index < 35; index++) f.profile.record(f.outcome('resource.gathered', {
    body: { id: 'x'.repeat(128), kind: 'character' }, actor: { kind: 'agent', id: 'did:web:' + 'x'.repeat(490) },
    object: { id: 'x'.repeat(128), kind: 'resource' }, result: { quantity: 1, success: true, reason: 'x'.repeat(64) },
  }));
  for (let index = 0; index < 16; index++) f.profile.record(f.outcome());
  const native = createOwnerGameplayActivityArchive({ binding: { subjectDid: OWNER, podUrl: 'https://pod.example/alice/' },
    crypto: webcrypto, createClient: () => ({ connect: async () => ({ keyPresent: true }), registerKey: async () => {},
      currentHead: async () => null, createAt: async ({ graphIri, record }) => ({ saved: true, graphIri, record,
        head: { cid: 'test-page', descriptorUrl: 'https://pod.example/alice/context-graphs/test.ttl' } }), close() {} }) });
  await native.connect(); const selected = f.profile.nextArchivePage();
  const result = await native.appendPage(selected); assert.equal(result.saved, true);
  f.profile.archiveConfirmed(selected, result.reference);
  assert(f.profile.snapshot().history.pendingEvents > 0, 'Additional legal detail waits for the next bounded page');
});

test('mismatched confirmation pages and references cannot advance the cursor', () => {
  const f = fixture(); f.profile.record(f.outcome()); const original = f.profile.nextArchivePage(), changed = structuredClone(original);
  changed.events[0].result.quantity = 100;
  assert.throws(() => f.profile.archiveConfirmed(changed, reference('d')), { code: 'activity_archive_changed' });
  assert.throws(() => f.profile.archiveConfirmed(original, null));
  assert.equal(f.profile.snapshot().history.pendingEvents, 1); assert.equal(f.profile.snapshot().history.archivedEvents, 0);
});

test('interventions link later observed evidence without asserting a causal effect or competency', () => {
  const f = fixture(); const started = f.profile.interventionStart('one-foe-practice');
  f.advance(1000); const outcome = f.profile.record(f.outcome('combat.defeated', { object: { id: 'wolf', kind: 'foe' } }));
  const attempt = f.profile.snapshot().summary.attempts[0]; assert.equal(attempt.id, started.attemptId);
  assert.deepEqual(attempt.evidenceIds, [outcome.event.id]); assert.equal(f.profile.snapshot().summary.competencyStatus, 'not-assessed');
  assert.equal(f.profile.snapshot().milestones.find(item => item.id === 'defeat-one').completed, true);
  assert.throws(() => f.profile.interventionStart('unadvertised'), { code: 'invalid_intervention' });
});

test('statement provenance keeps agent control explicit and never promotes private observations to assessment', () => {
  const f = fixture(), did = 'did:web:identity.example:agents:helper';
  const observed = f.profile.record(f.outcome('ability.executed', { actor: { kind: 'agent', id: did }, object: { id: 'mend', kind: 'ability' } })).event;
  const statement = gameplayActivityStatement(observed, OWNER);
  assert.equal(statement.actor.account.name, OWNER); assert.equal(statement.context.registration, SESSION);
  assert.equal(statement.context.extensions['urn:interego:gaming:activity:context'].controllerKind, 'agent');
  assert.equal(statement.context.extensions['urn:interego:gaming:activity:context'].controllerId, did);
  assert.equal(statement.result.extensions['urn:interego:gaming:activity:observation'].competencyStatus, 'not-assessed');
  assert(!Object.hasOwn(statement, 'authority')); assert(!Object.hasOwn(statement, 'stored'));
});

test('body aggregates survive detail rollover, archiving and reload without inferring agent outcomes', () => {
  const f = fixture();
  for (let index = 0; index < 40; index++) f.profile.record(f.outcome('combat.healed', {
    body: { id: index % 2 ? 'owned-companion' : CHARACTER, kind: index % 2 ? 'owned-unit' : 'character' }, result: { quantity: 3, success: true },
  }));
  const page = f.profile.nextArchivePage(); f.profile.archiveConfirmed(page, reference('e'));
  const restored = fixture({ state: f.profile.save(), sessionId: NEXT }), summary = restored.profile.snapshot().summary;
  assert.equal(summary.bodyObservations.length, 2); assert.equal(summary.bodyHistory.complete, true);
  for (const body of summary.bodyObservations) {
    assert.equal(body.counters['combat.healed'], 20); assert.equal(body.quantities['combat.healed'], 60);
    assert.equal(body.controllerCounts.unattributed, 20); assert.equal(body.controllerCounts.agent, undefined);
    assert.equal(body.competencyStatus, 'not-assessed'); assert.equal(body.observationAuthority, 'owner-browser-observation');
  }
  assert.equal(restored.profile.snapshot().history.recent.length, 16);
  assert.equal(restored.profile.snapshot().history.archivedEvents, 40);
});

test('older v1 activity remains readable and never invents historical body breakdowns', () => {
  const f = fixture(); for (let i = 0; i < 3; i++) f.profile.record(f.outcome());
  const old = f.profile.save(); delete old.bodyObservations; delete old.bodyHistory; delete old.lastMeaningfulContext;
  const migrated = fixture({ state: old, sessionId: NEXT });
  assert.equal(migrated.profile.snapshot().summary.bodyHistory.unknownHistoricalEvents, 3);
  assert.equal(migrated.profile.snapshot().summary.bodyHistory.complete, false);
  assert.deepEqual(migrated.profile.snapshot().summary.bodyObservations, []);
  migrated.profile.record(migrated.outcome());
  assert.equal(migrated.profile.snapshot().summary.bodyObservations[0].eventCount, 1);
  assert.equal(migrated.profile.snapshot().eventCount, 4);
  assert.equal(fixture({ state: migrated.profile.save(), sessionId: webcrypto.randomUUID() }).profile.snapshot().summary.bodyHistory.unknownHistoricalEvents, 3);
});

test('bounded body identities expose overflow instead of manufacturing a mixed per-body total', () => {
  const f = fixture();
  for (let i = 0; i < 18; i++) f.profile.record(f.outcome('combat.healed', { body: { id: 'owned-unit-' + i, kind: 'owned-unit' } }));
  const summary = fixture({ state: f.profile.save(), sessionId: NEXT }).profile.snapshot().summary;
  assert.equal(summary.bodyObservations.length, 17); assert.equal(summary.bodyHistory.unassignedEvents, 1);
  assert.equal(summary.bodyHistory.complete, false); assert.equal(summary.counters['combat.healed'], 18);
  const invalid = f.profile.save(); invalid.bodyObservations[0].eventCount++;
  assert.throws(() => fixture({ state: invalid }), { code: 'invalid_activity' });
});

test('fresh failures choose practical context and intent markers cannot displace an observed task', () => {
  const f = fixture(); f.profile.record(f.outcome('ability.refused', { object: { id: 'strike', kind: 'ability' }, result: { success: false, reason: 'range' } }));
  const current = f.profile.snapshot().current; assert.equal(current.id, 'ability-readiness'); assert.equal(current.bodyId, CHARACTER);
  assert.equal(current.current, 0); assert.equal(current.target, 1); assert(current.interventions.some(item => item.id === 'combat-field-guide'));
  f.profile.interventionStart('combat-field-guide');
  for (let i = 0; i < 20; i++) f.profile.record(f.outcome('agent.command-accepted', { object: { id: 'move', kind: 'agent' },
    actor: { kind: 'agent', id: 'did:web:identity.example:agents:helper' } }));
  assert.equal(f.profile.snapshot().current.id, 'ability-readiness');
  f.profile.record(f.outcome('ability.executed', { body: { id: 'other-unit', kind: 'owned-unit' } }));
  assert.equal(f.profile.observeCriterion(current.criterion).current, 0, 'Another unit does not complete this body criterion');
  f.profile.record(f.outcome('ability.executed')); const observed = f.profile.observeCriterion(current.criterion);
  assert.equal(observed.current, 1); assert.equal(observed.evidenceIds.length, 1); assert.equal(observed.bodyId, CHARACTER);
  assert.equal(observed.competencyStatus, 'not-assessed');
});

test('death and craft refusal focus stay observational, expire and do not replace canonical milestones', () => {
  const f = fixture(); f.profile.record(f.outcome('combat.died', { result: { success: false } }));
  assert.equal(f.profile.snapshot().current.id, 'recover-after-fall'); assert.equal(f.profile.snapshot().current.bodyKind, 'character');
  assert.equal(f.profile.snapshot().current.criterion.eventType, 'character.respawned');
  assert(f.profile.snapshot().current.interventions.some(item => item.id === 'recovery-reference'));
  f.advance(120001); assert.equal(f.profile.snapshot().current.id, 'gather-one');
  f.profile.record(f.outcome('craft.refused', { object: { id: 'recipe', kind: 'craft' }, result: { success: false, reason: 'requirements' } }));
  assert.equal(f.profile.snapshot().current.id, 'craft-readiness');
  assert(f.profile.snapshot().milestones.some(item => item.id === 'gather-one' && !item.completed));
});

test('fallen companion guidance offers real party management without an impossible respawn criterion', () => {
  const f = fixture(); f.profile.record(f.outcome('combat.died', { body: { id: 'party-unit', kind: 'owned-unit' }, result: { success: false } }));
  const current = f.profile.snapshot().current;
  assert.equal(current.id, 'party-after-fall'); assert.equal(current.bodyId, 'party-unit'); assert.equal(current.bodyKind, 'owned-unit');
  assert(!Object.hasOwn(current, 'criterion')); assert(!Object.hasOwn(current, 'target'));
  const aid = current.interventions.find(item => item.id === 'party-recovery-reference');
  assert.equal(aid.destination, 'party'); assert.match(aid.note, /stays fallen/); assert.doesNotMatch(aid.note, /Release when ready/);
  assert(!current.interventions.some(item => item.id === 'recovery-reference'));
  const restored = fixture({ state: f.profile.save(), sessionId: NEXT });
  assert.equal(restored.profile.snapshot().current.id, 'party-after-fall'); assert(!Object.hasOwn(restored.profile.snapshot().current, 'criterion'));
  restored.advance(120001); assert.equal(restored.profile.snapshot().current.id, 'gather-one');
});

test('intent markers do not change repeatable task evidence after milestones are complete', () => {
  const f = fixture();
  for (const milestone of GAMEPLAY_MILESTONES) for (let index = 0; index < milestone.target; index++) f.profile.record(f.outcome(milestone.eventTypes[0]));
  const before = f.profile.snapshot().current;
  assert.equal(before.id, 'field-practice');
  f.profile.interventionStart('one-foe-practice');
  for (let index = 0; index < 20; index++) f.profile.record(f.outcome('agent.command-accepted', {
    actor: { kind: 'agent', id: 'did:web:identity.example:agents:helper' }, object: { id: 'move', kind: 'agent' },
  }));
  assert.deepEqual(f.profile.snapshot().current, before, 'Marker traffic cannot manufacture new task progress or change evidence after tail eviction');
  assert.deepEqual(f.profile.snapshot().summary.attempts.at(-1).evidenceIds, [], 'Input acceptance is not an intervention outcome');
  const restored = fixture({ state: f.profile.save(), sessionId: NEXT });
  assert.deepEqual(restored.profile.snapshot().current, before, 'Fallback totals and evidence survive reload without claiming a session total');
  const actual = restored.profile.record(restored.outcome('supply.delivered'));
  assert.notDeepEqual(restored.profile.snapshot().current.evidenceIds, before.evidenceIds);
  assert.deepEqual(restored.profile.snapshot().summary.attempts.at(-1).evidenceIds, [actual.event.id]);
});
