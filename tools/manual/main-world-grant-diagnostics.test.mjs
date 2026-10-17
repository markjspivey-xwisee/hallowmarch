import test from 'node:test';
import assert from 'node:assert/strict';
import { readMainWorldGrant, safeMainWorldGrantRead } from './main-world-grant-diagnostics.mjs';

const id = '644ab51e-3e30-451c-a8be-589ae8701923';
const reference = { grantId: 'urn:uuid:' + id, graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + id };
const expected = { ownerId: 'qa-owner', bodyId: 'qa-companion', roomId: 'qa-room', actor: 'did:web:identity.example:agents:qa' };
async function fixture(run) {
  const original = globalThis.window, human = {}, counts = { load: 0, writes: 0 };
  const record = { reference: { ...reference }, grant: { actor: expected.actor, entityId: expected.bodyId, roomId: expected.roomId },
    operationId: 'PRIVATE_OPERATION_DO_NOT_PRINT', phase: 'publish', registered: false };
  const state = { busy: false, records: new Map([[reference.grantId, record]]), client: {
    async load(ref) { counts.load++; assert.deepEqual(ref, reference); return { reference, grant: { ...record.grant, revoked: false, expiresAt: new Date(Date.now() + 60000).toISOString() } }; },
    publish() { counts.writes++; throw Error('must not publish'); }, confirm() { counts.writes++; throw Error('must not confirm'); },
    revoke() { counts.writes++; throw Error('must not revoke'); }, register() { counts.writes++; throw Error('must not register'); },
  } };
  const game = { net: { NETWS: { acct: { id: expected.ownerId, nativeBound: true } } }, GAME: { player: human },
    worldAgents: { state, bodies: () => [{ id: expected.bodyId, entity: {} }] } };
  globalThis.window = { __hm: game };
  try { await run({ record, state, game, counts }); } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
}

test('pending public grant diagnostics use only native load and never advance or confirm its operation', async () => fixture(async f => {
  const result = safeMainWorldGrantRead(await readMainWorldGrant(expected));
  assert.deepEqual(result.reference, reference); assert.equal(result.phase, 'publish'); assert.equal(result.operationPresent, true);
  assert.equal(result.nativeRead, 'read'); assert.equal(result.exactActiveGrant, true); assert.equal(result.registered, false);
  assert.deepEqual(f.counts, { load: 1, writes: 0 }); assert.equal(f.record.phase, 'publish');
  assert.equal(f.record.operationId, 'PRIVATE_OPERATION_DO_NOT_PRINT'); assert(!JSON.stringify(result).includes('PRIVATE'));
}));

test('native proof failure returns only a known code while retaining the exact pending public reference', async () => fixture(async f => {
  f.state.client.load = async () => { f.counts.load++; throw Object.assign(Error('PRIVATE_NATIVE_TEXT'), { code: 'invalid_proof', privateBody: 'PRIVATE_BODY' }); };
  const result = safeMainWorldGrantRead(await readMainWorldGrant(expected));
  assert.equal(result.nativeRead, 'refused'); assert.equal(result.code, 'invalid_proof'); assert.deepEqual(result.reference, reference);
  assert.deepEqual(f.counts, { load: 1, writes: 0 }); assert(!JSON.stringify(result).includes('PRIVATE'));
}));

test('changed owner, actor, companion, reference, extra records or busy state refuse before native I/O', async () => {
  const changes = [f => { f.game.net.NETWS.acct.id = 'someone-else'; }, f => { f.game.net.NETWS.acct.nativeBound = false; },
    f => { f.record.grant.actor = 'another-agent'; }, f => { f.record.grant.entityId = 'another-body'; },
    f => { f.record.reference.graphIri = 'https://private.example/PRIVATE'; }, f => { f.state.records.set('another-record', {}); },
    f => { f.state.busy = true; }];
  for (const change of changes) await fixture(async f => { change(f); const result = safeMainWorldGrantRead(await readMainWorldGrant(expected));
    assert.equal(result.nativeRead, 'not-attempted'); assert.equal(result.reference, undefined); assert.equal(f.counts.load, 0); assert.equal(f.counts.writes, 0); });
  await fixture(async f => { const result = await readMainWorldGrant({ ...expected, reference: { ...reference, grantId: 'urn:uuid:00000000-0000-4000-8000-000000000000' } });
    assert.equal(result.referenceMatched, false); assert.equal(f.counts.load, 0); });
});

test('native binding, transport and exact scope continuity are rechecked after an awaited native read', async () => {
  const changes = [f => { f.game.net.NETWS.acct.id = 'changed'; }, f => { f.game.net.NETWS.acct.nativeBound = false; },
    f => { f.game.net.NETWS.token = 'PRIVATE_CHANGED_TOKEN'; }, f => { f.game.net.NETWS.generation = 2; },
    f => { f.game.net.NETWS = { ...f.game.net.NETWS }; }, f => { f.state.client = { ...f.state.client }; },
    f => { f.record.reference.graphIri = 'another-graph'; }, f => { f.record.grant.actor = 'another-agent'; },
    f => { f.record.grant.roomId = 'another-room'; }, f => { f.record.grant.entityId = 'another-body'; },
    f => { f.record.phase = 'register'; }, f => { f.record.operationId = 'another-operation'; },
    f => { f.record.registered = true; }, f => { f.record.localRevoked = true; }];
  for (const change of changes) await fixture(async f => {
    const load = f.state.client.load; f.state.client.load = async ref => { const result = await load(ref); change(f); return result; };
    const result = safeMainWorldGrantRead(await readMainWorldGrant(expected));
    assert.equal(result.ownerMatched, false); assert.equal(result.reference, undefined); assert.equal(result.exactActiveGrant, undefined);
    assert.deepEqual(f.counts, { load: 1, writes: 0 }); assert(!JSON.stringify(result).includes('PRIVATE'));
  });
});

test('stdout sanitizer drops arbitrary codes, phase, URLs, counts, body and extra reference properties', () => {
  const result = safeMainWorldGrantRead({ ownerMatched: true, referenceMatched: true, scopeMatched: true,
    recordsCount: 100000, code: 'PRIVATE_CODE', phase: 'PRIVATE_PHASE', privateBody: 'PRIVATE_BODY',
    reference: { ...reference, privateBody: 'PRIVATE_BODY' }, token: 'PRIVATE_TOKEN' });
  assert.deepEqual(result, { kind: 'main_world_grant_read', ownerMatched: true, referenceMatched: true, scopeMatched: true, reference });
  assert(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(safeMainWorldGrantRead({ ...result, reference: { grantId: reference.grantId, graphIri: 'https://private.example/PRIVATE' } }).reference, undefined);
});
