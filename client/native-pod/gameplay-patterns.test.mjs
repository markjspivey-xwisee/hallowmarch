import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gameplayActivityStatement, GAMEPLAY_EVENT_SCHEMA } from './gameplay-activity.mjs';
import { analyzeGameplayPatterns } from './gameplay-patterns.mjs';

const current = JSON.parse(await readFile(new URL('../../server/gaming/gameplay-activity-profile.jsonld', import.meta.url)));
const legacy = JSON.parse(await readFile(new URL('../../server/gaming/gameplay-activity-profile-1.0.0.jsonld', import.meta.url)));
const version = current.versions[0].id, owner = 'did:web:identity.example:users:fixture';
const registration = '8bb38ad2-c605-4ba6-956c-168fa3c825df';
let counter = 0;
function statement(type, { body = 'fixture-body', object = 'fixture-object', ordinal, at = '2026-10-27T12:00:00.000Z', session = registration, profileVersion = version, actor = { kind: 'unattributed' } } = {}) {
  const index = ++counter;
  return gameplayActivityStatement({ schema: profileVersion === version ? GAMEPLAY_EVENT_SCHEMA : 'hallowmarch.gameplay-event/v1',
    id: 'urn:uuid:8bb38ad2-c605-4ba6-956c-' + String(index).padStart(12, '0'), sessionId: session, sequence: index, ordinal: ordinal || index,
    type, observedAt: at, body: { id: body, kind: 'character' }, actor,
    object: { id: object, kind: type.split('.')[0] }, result: { success: !type.endsWith('.refused') && type !== 'combat.died' }, context: { party: false } }, owner);
}
const motif = (analysis, suffix, partition = 0) => analysis.partitions[partition].motifs.find(item => item.id.endsWith('/' + suffix));

test('current and immutable legacy snapshots validate separately, never by metadata history alone', () => {
  const old = statement('resource.gathered', { profileVersion: legacy.versions[0].id }), fresh = statement('resource.gathered');
  const analysis = analyzeGameplayPatterns([fresh, old], [current, legacy]);
  assert.equal(analysis.status, 'matched'); assert.equal(analysis.partitions.length, 2);
  assert.deepEqual(new Set(analysis.partitions.map(item => item.profileVersion)), new Set([version, legacy.versions[0].id]));
  assert.equal(analyzeGameplayPatterns([old], current).status, 'unmatched');
  assert.equal(analyzeGameplayPatterns([fresh], legacy).status, 'unmatched');
  assert.equal(analyzeGameplayPatterns([old], legacy).partitions[0].motifs.length, 0);
});

test('four truthful motifs match chronologically, with unrelated observations allowed between candidate events', () => {
  for (const [id, first, last] of [['ability-recovery', 'ability.refused', 'ability.executed'], ['craft-recovery', 'craft.refused', 'craft.completed'],
    ['bounty-reward', 'bounty.completed', 'bounty.claimed'], ['character-recovery', 'combat.died', 'character.respawned']]) {
    const start = statement(first, { ordinal: 1, object: id === 'character-recovery' ? 'killer' : 'same-object' });
    const unrelated = statement('resource.gathered', { ordinal: 2 });
    const end = statement(last, { ordinal: 3, object: id === 'character-recovery' ? 'release' : 'same-object' });
    const result = analyzeGameplayPatterns([end, unrelated, start], current);
    assert.equal(result.status, 'matched'); assert.equal(motif(result, id).status, 'matched');
    assert.deepEqual(motif(result, id).matches, [{ statementIds: [start.id, end.id] }]);
    assert.deepEqual(result.partitions[0].statementIds, [start.id, unrelated.id, end.id]);
  }
});

test('partial windows stay primary-matched while secondary starts are incomplete and isolated ends are unmatched', () => {
  const start = statement('ability.refused');
  const incomplete = analyzeGameplayPatterns([start], current);
  assert.equal(incomplete.partitions[0].primary.status, 'matched'); assert.equal(motif(incomplete, 'ability-recovery').status, 'incomplete');
  assert.deepEqual(motif(incomplete, 'ability-recovery').incomplete, [{ statementIds: [start.id] }]);
  assert.equal(motif(analyzeGameplayPatterns([statement('ability.executed')], current), 'ability-recovery').status, 'unmatched');
  assert.equal(analyzeGameplayPatterns([], current).status, 'unmatched');
});

test('pairs cannot bridge body, object, controller, registration, owner or Profile version', () => {
  const first = statement('craft.refused', { ordinal: 1 });
  const second = statement('craft.completed', { ordinal: 2 });
  for (const change of [
    value => { value.context.extensions['urn:interego:gaming:activity:context'].bodyId = 'another-body'; },
    value => { value.object.id += '-another-recipe'; },
    value => { value.context.extensions['urn:interego:gaming:activity:context'].controllerKind = 'human-input'; },
    value => { value.context.registration = '8bb38ad2-c605-4ba6-956c-168fa3c825d0'; },
    value => { value.actor.account.name = 'did:web:identity.example:users:someone-else'; },
  ]) {
    const changed = structuredClone(second); change(changed);
    const result = analyzeGameplayPatterns([first, changed], current);
    assert.ok(result.partitions.every(partition => partition.motifs.find(item => item.id.endsWith('/craft-recovery')).matches.length === 0));
  }
  const old = statement('craft.completed', { ordinal: 2, profileVersion: legacy.versions[0].id });
  assert.equal(motif(analyzeGameplayPatterns([first, old], [current, legacy]), 'craft-recovery').matches.length, 0);
});

test('historical timestamps take precedence over ordinals and identical timestamps use capture ordinal', () => {
  const first = statement('ability.refused', { ordinal: 20, at: '2026-10-27T12:00:00.000Z' });
  const last = statement('ability.executed', { ordinal: 10, at: '2026-10-27T12:00:01.000Z' });
  assert.equal(motif(analyzeGameplayPatterns([last, first], current), 'ability-recovery').status, 'matched');
  last.timestamp = first.timestamp;
  assert.equal(motif(analyzeGameplayPatterns([last, first], current), 'ability-recovery').status, 'incomplete');
});

test('invalid provenance and unknown events are distinct from matched streams; enrichment and exact duplicates are accepted', () => {
  const valid = statement('resource.gathered'); valid.authority = { objectType: 'Agent', account: { name: 'fixture-lrs', homePage: 'https://lrs.example' } };
  valid.stored = '2026-10-27T12:00:01.000Z';
  const duplicate = analyzeGameplayPatterns([valid, structuredClone(valid)], current);
  assert.equal(duplicate.status, 'matched'); assert.equal(duplicate.duplicatesIgnored, 1);
  const reordered = Object.fromEntries(Object.entries(valid).reverse());
  assert.equal(analyzeGameplayPatterns([valid, reordered], current).duplicatesIgnored, 1);
  for (const change of [value => { value.result.extensions['urn:interego:gaming:activity:observation'].authority = 'server-verified'; },
    value => { value.context.extensions['urn:interego:gaming:activity:context'].token = 'not-retainable'; },
    value => { value.id = 'not-a-uuid'; }]) {
    const changed = structuredClone(valid); change(changed);
    assert.equal(analyzeGameplayPatterns([changed], current).status, 'invalid');
  }
  const unknown = structuredClone(valid); unknown.verb.id = 'urn:unknown:verb';
  assert.equal(analyzeGameplayPatterns([unknown], current).status, 'unmatched');
  const conflict = structuredClone(valid); conflict.timestamp = '2026-10-27T12:00:02.000Z';
  const result = analyzeGameplayPatterns([valid, conflict], current);
  assert.equal(result.status, 'invalid'); assert.equal(result.partitions[0].primary.status, 'invalid');
  assert.equal(result.partitions[0].motifs.length, 0);
  const bad = structuredClone(valid); bad.id = '8bb38ad2-c605-4ba6-956c-168fa3c825d0'; bad.result.extensions['urn:interego:gaming:activity:observation'].authority = 'server-verified';
  const mixed = analyzeGameplayPatterns([valid, bad], current);
  assert.equal(mixed.partitions[0].primary.status, 'invalid'); assert.equal(mixed.partitions[0].motifs.length, 0);
});

test('capacity and unsupported Profile constructs fail explicitly rather than imply broad validation', () => {
  assert.throws(() => analyzeGameplayPatterns(Array(257).fill({}), current), { code: 'gameplay_pattern_capacity' });
  const changed = structuredClone(current); changed.templates[0].rules[0].selector = '$.unimplemented';
  const value = statement('ability.executed');
  assert.throws(() => analyzeGameplayPatterns([value], changed), { code: 'unsupported_gameplay_profile' });
});
