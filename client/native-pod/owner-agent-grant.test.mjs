import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRecordFixture as nativeFixture, ownerDid, binding } from './public-record.fixture.mjs';
import { createOwnerAgentGrants } from './owner-agent-grant.mjs';
import { OWNER_AGENT_GRANT_SCHEMA, NATIVE_OWNER_AGENT_GRANT_SCHEMA, OWNER_AGENT_GRANT_ROLES } from './owner-agent-grant-schema.mjs';
const input = { publicDisclosureAccepted: true, actor: 'did:web:identity.example:agents:teammate', roomId: 'expedition',
  entityId: 'body-alice-pet', role: 'pet', actions: ['observe', 'move'], maxCommandsPerSecond: 10, lifetimeMs: 600_000 };
function publicRecordFixture() {
  const fixture = nativeFixture();
  return { ...fixture, domain: extra => createOwnerAgentGrants({ ...fixture.options(), binding,
    applicationId: 'did:key:zHallowmarchFixture', audience: 'https://game.example', ...extra }) };
}

test('shared schema preserves exact required properties, immutable role sets and public bounded relationship', () => {
  assert.equal(NATIVE_OWNER_AGENT_GRANT_SCHEMA, OWNER_AGENT_GRANT_SCHEMA); assert.equal(OWNER_AGENT_GRANT_SCHEMA.additionalProperties, false);
  assert.deepEqual(OWNER_AGENT_GRANT_SCHEMA.required.slice().sort(), Object.keys(OWNER_AGENT_GRANT_SCHEMA.properties).sort());
  assert.deepEqual(OWNER_AGENT_GRANT_ROLES.coach, ['observe']); assert.deepEqual(OWNER_AGENT_GRANT_ROLES.pet, ['observe', 'move', 'attack']);
  assert(Object.isFrozen(OWNER_AGENT_GRANT_SCHEMA.properties)); assert(Object.isFrozen(OWNER_AGENT_GRANT_ROLES.pet));
});
test('owner-native public grant and same-id revocation compose through native CAS without storage delegation', async () => {
  const f = publicRecordFixture(), grants = f.domain(); await grants.connect();
  const saved = await grants.publish(input); assert.equal(saved.saved, true);
  assert.deepEqual(Object.keys(saved).sort(), ['operationId', 'receipt', 'reference', 'saved', 'status']);
  assert(saved.reference.graphIri.endsWith(saved.reference.grantId.slice(9)));
  const loaded = await grants.load(saved.reference);
  assert.equal(loaded.grant.issuer, ownerDid); assert.equal(loaded.grant.actor, input.actor); assert.equal(loaded.grant.revoked, false);
  assert.deepEqual(Object.keys(loaded.grant).sort(), OWNER_AGENT_GRANT_SCHEMA.required.slice().sort());
  const revoked = await grants.revoke(saved.reference); assert.equal(revoked.saved, true);
  const after = await grants.load(saved.reference); assert.equal(after.grant.revoked, true);
  assert.equal(after.grant.id, loaded.grant.id); assert.equal(after.grant.entityId, loaded.grant.entityId);
  assert.notEqual(after.head.cid, loaded.head.cid); assert.equal(f.calls.filter(call => call.name === 'publish_context')[1].args.if_match, loaded.head.cid);
  const again = await grants.revoke(saved.reference); assert.equal(again.alreadyRevoked, true); assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 2);
  const replacement = await grants.publish(input); assert.notEqual(replacement.reference.grantId, saved.reference.grantId);
  assert(!f.calls.some(call => call.name === 'register_agent')); assert(!JSON.stringify(f.calls).includes('private character'));
});
for (const [label, change] of [
  ['no public choice', { publicDisclosureAccepted: undefined }], ['self user actor', { actor: ownerDid }],
  ['unsupported wallet identity', { actor: 'did:ethr:0x0000000000000000000000000000000000000001' }],
  ['lifetime too long', { lifetimeMs: 3_600_001 }], ['missing lifetime', { lifetimeMs: undefined }],
  ['rate too high', { maxCommandsPerSecond: 21 }], ['duplicate actions', { actions: ['move', 'move'] }],
  ['pet loot privilege', { actions: ['claimLoot'] }], ['coach move privilege', { role: 'coach', actions: ['move'] }],
  ['empty actions', { actions: [] }], ['invalid room', { roomId: 'wrong room' }], ['oversized body', { entityId: 'a'.repeat(257) }],
]) test('grant refuses ' + label + ' before any native publication', async () => {
  const f = publicRecordFixture(), grants = f.domain(); await grants.connect();
  await assert.rejects(grants.publish({ ...input, ...change })); assert(!f.calls.some(call => call.name === 'publish_context'));
});
test('uncertain grant and revocation retain references and require readback before a saved receipt', async () => {
  const f = publicRecordFixture(), grants = f.domain(); await grants.connect(); f.setMode('throw-after');
  const uncertain = await grants.publish(input); assert.equal(uncertain.saved, false); assert(!uncertain.receipt);
  const confirmed = await grants.confirm(uncertain.operationId); assert.equal(confirmed.saved, true); assert.deepEqual(confirmed.reference, uncertain.reference);
  f.setMode('pending'); const revocation = await grants.revoke(confirmed.reference); assert.equal(revocation.saved, false);
  assert.equal((await grants.load(confirmed.reference)).grant.revoked, false);
  f.release(); const revoked = await grants.confirm(revocation.operationId); assert.equal(revoked.saved, true);
  assert.equal((await grants.load(revoked.reference)).grant.revoked, true);
});
test('foreign application/owner/context and malformed public payload are refused', async () => {
  const f = publicRecordFixture(), grants = f.domain(); await grants.connect(); const saved = await grants.publish(input);
  const otherApp = f.domain({ applicationId: 'did:key:zAnotherGame' }); await otherApp.connect();
  await assert.rejects(otherApp.load(saved.reference), { code: 'invalid_grant' });
  await assert.rejects(grants.load({ ...saved.reference, grantId: 'urn:uuid:00000000-0000-4000-8000-000000000000' }), { code: 'invalid_grant_reference' });
  grants.close(); await assert.rejects(grants.load(saved.reference), { code: 'not_connected' });
});
