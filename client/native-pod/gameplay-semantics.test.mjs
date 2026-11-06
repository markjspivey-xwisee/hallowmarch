import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameplayActivityProfile, gameplayActivityStatement } from './gameplay-activity.mjs';
import { gameplayEvidenceGraph } from './gameplay-semantics.mjs';

const owner = 'did:web:identity.example:users:synthetic-owner';
function fixture() {
  return createGameplayActivityProfile({ ownerDid: owner, characterId: 'body',
    sessionId: '7713bc0b-c892-4f5b-8086-2f7ff1b402f7' });
}
test('semantic evidence distinguishes occurrence from record and preserves exact xAPI JSON', () => {
  const activity = fixture(), event = activity.record({ type: 'resource.gathered', body: { id: 'body', kind: 'character' },
    object: { id: 'stone', kind: 'resource' }, result: { quantity: 1 }, context: { party: false } }).event;
  const graph = gameplayEvidenceGraph([event, event], owner);
  assert.equal(graph['@graph'].length, 2);
  const [occurrence, record] = graph['@graph'];
  assert.notEqual(occurrence['@id'], record['@id']);
  assert.equal(occurrence['@type'], 'prov:Activity'); assert.equal(record['@type'], 'prov:Entity');
  assert.equal(record['prov:wasGeneratedBy']['@id'], occurrence['@id']);
  assert.equal(occurrence['prov:startedAtTime']['@type'], 'http://www.w3.org/2001/XMLSchema#dateTime');
  assert.deepEqual(record['i2x:isClassifiedBy'], { '@id': 'i2idl:xapi-statement' });
  assert.equal(record['gaming:mappingStatus'], 'Hypothetical');
  assert.deepEqual(record['gaming:statement']['@value'], gameplayActivityStatement(event, owner));
  assert.equal(graph['gaming:glossaryPublicationVersion'], 'v0.0.93');
  assert.equal(occurrence['gaming:competencyStatus'], 'not-assessed');
  assert.equal(occurrence['i2x:isClassifiedBy'], undefined, 'An ordinary game occurrence is not classified as learned knowledge');
  const changed = structuredClone(event); changed.result.quantity = 9;
  assert.throws(() => gameplayEvidenceGraph([event, changed], owner), /Conflicting evidence/);
  assert.throws(() => gameplayEvidenceGraph(Array(65).fill(event), owner));
});
