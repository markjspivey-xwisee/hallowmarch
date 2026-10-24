import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createPlayerPodProfile, validatePlayerProfile, validatePlayerProfileIndex, playerProfileIndexGraphIri, playerProfileGraphIri } from './profile.mjs';

const OWNER = 'did:web:identity.example:users:alice';
const binding = { subjectDid: OWNER, podUrl: 'https://pod.example/alice/' };
const copy = value => JSON.parse(JSON.stringify(value));
const profileRecord = save => ({ schema: 'hallowmarch.player-profile/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch', save });
const INDEX = await playerProfileIndexGraphIri(OWNER, webcrypto);
const indexRecord = graphIri => ({ schema: 'hallowmarch.player-profile-index/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch', profileGraphIri: graphIri });
let fixtureVersion = 0;
function gate() { let release, entered; return { ready: new Promise(resolve => { entered = resolve; }),
  hold: new Promise(resolve => { release = resolve; }), entered: () => entered(), release: () => release() }; }
function fixture({ pointer = null, initial = null, initialGraph = null, ownerIndex = null, sharedRecords = null,
  keyPresent = true, mode = 'saved', indexMode = 'saved', indexFailures = 0, forked = false, metadataError = null,
  linkFailures = 0, createGate = null, linkGate = null, loadGate = null, deferRelationship = false, bridgeRequest = null } = {}) {
  const calls = [], requests = [], states = [], records = sharedRecords || new Map(), operations = new Map();
  let clientClosed = false, confirms = 0, indexConfirms = 0;
  const observed = (graphIri, record) => ({ saved: true, status: 'saved', graphIri, head: {
    cid: 'fixture-cid-' + (++fixtureVersion), descriptorUrl: binding.podUrl + 'context-graphs/' + fixtureVersion + '.ttl' }, record: copy(record) });
  if (initial) { const graph = initialGraph || pointer.graphIri; records.set(graph, observed(graph, initial)); }
  if (ownerIndex) records.set(INDEX, observed(INDEX, ownerIndex));
  const native = {
    connect: async () => { calls.push({ op: 'connect' }); return { keyPresent }; },
    reauthenticate: async () => { calls.push({ op: 'reauthenticate' }); return { keyPresent }; },
    currentHead: async ({ graphIri, checkpoint }) => { calls.push({ op: 'currentHead', graphIri, checkpoint });
      if (metadataError) throw Object.assign(Error('Fixture metadata unavailable'), { code: metadataError });
      if (forked) throw Object.assign(Error('Fixture native fork'), { code: 'conflict' });
      return records.get(graphIri)?.head || null; },
    registerKey: async () => { calls.push({ op: 'registerKey' }); },
    createKey: async () => { calls.push({ op: 'createKey' }); keyPresent = true; },
    restoreRecovery: async () => { keyPresent = true; }, exportRecovery: async () => ({}),
    load: async ({ graphIri, checkpoint }) => { calls.push({ op: 'load', graphIri, checkpoint }); const value = records.get(graphIri) || null;
      if (loadGate) { loadGate.entered(); await loadGate.hold; } return value; },
    create: async ({ record, graphIri: requestedGraph, checkpoint }) => {
      calls.push({ op: 'create', graphIri: requestedGraph, checkpoint, record: copy(record) });
      const graphIri = requestedGraph || 'urn:graph:fixture:private-character-' + calls.filter(call => call.op === 'create').length;
      const result = observed(graphIri, record);
      if (createGate) { createGate.entered(); await createGate.hold; }
      if (mode === 'saved') { records.set(graphIri, result); return result; }
      operations.set('fixture-op-1', result);
      if (mode === 'uncertain') records.set(graphIri, result);
      return { saved: false, status: mode, operationId: 'fixture-op-1', graphIri };
    },
    createAt: async ({ graphIri, record, checkpoint }) => {
      calls.push({ op: 'createAt', graphIri, checkpoint, record: copy(record) }); assert.equal(graphIri, INDEX);
      if (indexFailures-- > 0) throw Object.assign(Error('Fixture index publication refused'), { code: 'native_refused' });
      assert(!records.has(graphIri), 'named creation must never overwrite an unread index');
      const result = observed(graphIri, record);
      if (indexMode === 'saved') { records.set(graphIri, result); return result; }
      operations.set('fixture-index-op-1', result);
      if (indexMode === 'uncertain') records.set(graphIri, result);
      return { saved: false, status: indexMode, operationId: 'fixture-index-op-1', graphIri };
    },
    confirm: async operationId => {
      calls.push({ op: 'confirm', operationId });
      if (operationId === 'fixture-index-op-1') {
        indexConfirms++; if (indexMode === 'pending-twice' && indexConfirms === 1) return { saved: false, status: 'pending', operationId };
      } else { confirms++; if (mode === 'pending-twice' && confirms === 1) return { saved: false, status: 'pending', operationId }; }
      const result = operations.get(operationId); assert(result, 'confirmation must identify a real fixture operation');
      if (operationId === 'fixture-index-op-1' && records.has(INDEX) && records.get(INDEX).head.cid !== result.head.cid) {
        return { saved: false, status: 'conflict', operationId };
      }
      records.set(result.graphIri, result); return copy(result);
    },
    save: async ({ graphIri, expectedHead, record, checkpoint }) => {
      calls.push({ op: 'save', graphIri, checkpoint, expectedHead: copy(expectedHead), record: copy(record) });
      assert.equal(expectedHead.cid, records.get(graphIri)?.head.cid, 'CAS must follow the confirmed/read predecessor');
      const result = observed(graphIri, record); records.set(graphIri, result); return result;
    },
    close: () => { clientClosed = true; calls.push({ op: 'close' }); },
  };
  const profile = createPlayerPodProfile({ binding, credential: { kind: 'fixture-only' }, relayUrl: 'https://relay.example', pointer,
    deferRelationship,
    createClient: () => native, crypto: webcrypto, onState: next => states.push(next),
    request: async (url, options) => {
      requests.push({ url, ...copy(options) });
      assert.equal(url, '/gaming/identity/record-link');
      assert.deepEqual(Object.keys(options.body).sort(), ['cid', 'descriptorUrl', 'graphIri', 'kind']);
      assert(!JSON.stringify(options.body).includes('private fixture save'));
      if (linkGate) { linkGate.entered(); await linkGate.hold; }
      if (linkFailures-- > 0) throw Error('Fixture pointer link unavailable');
      if (bridgeRequest) return bridgeRequest(url, options);
      return { linked: true };
    } });
  return { profile, calls, requests, states, records, isClosed: () => clientClosed };
}

test('existing profile is read and validated before a CAS update; bridge receives relationships only', async () => {
  const pointer = { graphIri: 'urn:graph:fixture:existing', descriptorUrl: 'old-link', cid: 'old-link-cid' };
  const f = fixture({ pointer, initial: profileRecord({ v: 1, private: 'private fixture save', n: 1 }) });
  await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 2 }), { code: 'unread_record' });
  assert.equal(f.calls.filter(call => ['save', 'create'].includes(call.op)).length, 0);
  const loaded = await f.profile.get(); assert.equal(loaded.exists, true); assert.equal(loaded.data().n, 1);
  const save = loaded.data(); save.n = 999; assert.equal(loaded.data().n, 1, 'host cannot mutate the loaded snapshot');
  await f.profile.set({ v: 1, private: 'private fixture save', n: 2 });
  assert.equal(f.calls.filter(call => call.op === 'create').length, 0);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 1);
  assert.equal(f.profile.status().state, 'saved'); assert.equal(f.requests.length, 1);
});

test('character opt-in is explicit while the one-time owner index remains immutable', async () => {
  const f = fixture(); await f.profile.connect(); await f.profile.get();
  await f.profile.set({ v: 1, count: 1 }); await f.profile.set({ v: 1, count: 2 });
  const graphIri = await playerProfileGraphIri(OWNER, webcrypto);
  assert.equal(f.calls.find(call => call.op === 'create').graphIri, graphIri);
  for (const call of f.calls.filter(call => ['create', 'save', 'load'].includes(call.op) && call.graphIri !== INDEX)) assert.equal(call.checkpoint, 'hallowmarch-character/v1');
  for (const call of f.calls.filter(call => call.graphIri === INDEX)) assert.equal(call.checkpoint, undefined);
});
test('claim target confirms private record and index before an explicit game relationship', async () => {
  const f = fixture({ deferRelationship: true }); await f.profile.connect();
  assert.equal(f.profile.reference(), null); await f.profile.get();
  await f.profile.set({ v: 1, char: { name: 'private claimed hero' } });
  assert.equal(f.requests.length, 0); assert(f.profile.reference()); assert.equal(f.profile.status().state, 'private_saved');
  const writes = f.calls.filter(call => ['create', 'createAt', 'save'].includes(call.op)).length;
  await f.profile.confirmRelationship(); assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => ['create', 'createAt', 'save'].includes(call.op)).length, writes);
});
test('ordinary game saves retain native logical-character provenance after claim', async () => {
  const f = fixture(); await f.profile.connect(); await f.profile.get();
  const nativePlay = { schema: 'hallowmarch.provisional-character/v1', characterId: 'durable-character-id' };
  await f.profile.set({ v: 1, char: { level: 1 }, nativePlay });
  await f.profile.set({ v: 1, char: { level: 2 } });
  assert.deepEqual((await f.profile.get()).data().nativePlay, nativePlay);
});

test('fresh browser discovers the first deterministic character after an index publication failed without creating another character', async () => {
  const first = fixture({ indexFailures: 1 }); await first.profile.connect(); await first.profile.get();
  await assert.rejects(first.profile.set({ v: 1, marker: 'first save without owner index' }));
  assert.equal(first.records.has(INDEX), false);
  const fresh = fixture({ sharedRecords: first.records }); await fresh.profile.connect();
  assert.equal((await fresh.profile.get()).data().marker, 'first save without owner index');
  assert(!fresh.calls.some(call => call.op === 'create'));
  assert.equal(fresh.calls.filter(call => call.op === 'createAt').length, 1);
});

test('reauthentication detects a changed checkpoint revision even when the binding descriptor CID is stable', async () => {
  const graphIri = 'urn:graph:fixture:stable-binding', pointer = { graphIri, descriptorUrl: 'original', cid: 'original' };
  const f = fixture({ pointer, initial: profileRecord({ v: 1, count: 1 }) });
  const stored = f.records.get(graphIri); stored.head.nativeRevision = 'revision-one'; stored.head.recordCid = 'record-one';
  await f.profile.connect(); await f.profile.get();
  f.records.set(graphIri, { ...stored, head: { ...stored.head, nativeRevision: 'revision-two', recordCid: 'record-two' } });
  const writes = f.calls.filter(call => ['create', 'save'].includes(call.op)).length;
  await assert.rejects(f.profile.reauthenticate({ credential: { fixture: true } }), { code: 'conflict' });
  assert.equal(f.calls.filter(call => ['create', 'save'].includes(call.op)).length, writes);
});

test('reauthentication confirms pending character and index operations without publishing or losing latest progress', async () => {
  for (const options of [{ mode: 'uncertain' }, { indexMode: 'uncertain' }]) {
    const f = fixture(options); await f.profile.connect(); await f.profile.get();
    await assert.rejects(f.profile.set({ v: 1, n: 2 }));
    const writes = f.calls.filter(c => ['create', 'createAt', 'save', 'registerKey'].includes(c.op)).length;
    await f.profile.reauthenticate({ credential: { fixture: 'new-owner-grant' } });
    assert.equal(f.profile.status().pending, false);
    assert.equal(f.calls.filter(c => ['create', 'createAt', 'save', 'registerKey'].includes(c.op)).length, writes);
    await f.profile.set({ v: 1, n: 3 });
    assert.equal((await f.profile.get()).data().n, 3);
    assert.equal(f.calls.filter(c => c.op === 'create').length, 1);
  }
});

test('reauthentication refuses another device head without adopting it as the next save baseline', async () => {
  const f = fixture(); await f.profile.connect(); await f.profile.get(); await f.profile.set({ v: 1, n: 1 });
  const graph = f.profile.status().profileGraphIri, first = f.records.get(graph);
  f.records.set(graph, { ...first, head: { ...first.head, cid: 'foreign-new-head' }, record: profileRecord({ v: 1, n: 99 }) });
  const writes = f.calls.filter(c => ['create', 'createAt', 'save'].includes(c.op)).length;
  await assert.rejects(f.profile.reauthenticate({ credential: {} }), { code: 'conflict' });
  assert.equal(f.calls.filter(c => ['create', 'createAt', 'save'].includes(c.op)).length, writes);
  assert.equal(f.records.get(graph).record.save.n, 99);
});

test('reauthentication refuses a changed owner index or an unread initial character without publishing', async () => {
  const unread = fixture(); await unread.profile.connect();
  await assert.rejects(unread.profile.reauthenticate({ credential: {} }), { code: 'unread_record' });
  const f = fixture(); await f.profile.connect(); await f.profile.get(); await f.profile.set({ v: 1, n: 1 });
  const original = f.records.get(INDEX);
  f.records.set(INDEX, { ...original, head: { ...original.head, cid: 'foreign-index-head' } });
  const writes = f.calls.filter(c => ['create', 'createAt', 'save'].includes(c.op)).length;
  await assert.rejects(f.profile.reauthenticate({ credential: {} }), { code: 'profile_index_conflict' });
  assert.equal(f.calls.filter(c => ['create', 'createAt', 'save'].includes(c.op)).length, writes);
});

test('wrong owner, schema, game and save shape are refused without native publication', async () => {
  const pointer = { graphIri: 'urn:graph:fixture:existing' };
  const good = profileRecord({ v: 1 });
  for (const invalid of [{ ...good, ownerDid: 'did:web:identity.example:users:bob' },
    { ...good, schema: 'other-profile/v1' }, { ...good, game: 'urn:game:other' }, { ...good, save: [] }]) {
    assert.throws(() => validatePlayerProfile(invalid, OWNER), { code: 'invalid_profile' });
    const f = fixture({ pointer, initial: invalid }); await f.profile.connect();
    await assert.rejects(f.profile.get(), { code: 'invalid_profile' });
    await assert.rejects(f.profile.set({ v: 1 }), { code: 'unread_record' });
    assert.equal(f.calls.filter(call => ['save', 'create'].includes(call.op)).length, 0);
  }
});

for (const mode of ['pending', 'uncertain', 'pending-twice']) test(mode + ' acknowledgement confirms original creation before latest-state CAS; no duplicate creation', async () => {
  const f = fixture({ mode }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_pending' });
  assert.equal(f.profile.status().pending, true); assert.equal(f.requests.length, 0);
  if (mode === 'pending-twice') {
    await assert.rejects(f.profile.retry(), { code: 'pod_pending' });
    assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  }
  await f.profile.set({ v: 1, n: 2 });
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 1);
  const mutations = f.calls.filter(call => ['create', 'confirm', 'save'].includes(call.op));
  assert.equal(mutations.at(-1).op, 'save');
  assert.equal(mutations.at(-1).record.save.n, 2);
  assert.equal(f.profile.status().state, 'saved'); assert.equal(f.profile.status().pending, false);
});

test('confirming an unchanged pending save does not mint an extra native version', async () => {
  const f = fixture({ mode: 'pending' }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_pending' });
  await f.profile.retry();
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.profile.status().state, 'saved');
});

test('link failure retains native current record; retry repairs only its relationship', async () => {
  const f = fixture({ linkFailures: 1 }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_link_pending' });
  assert.equal(f.profile.status().hasRecord, true); assert.equal(f.profile.status().linked, false);
  await f.profile.retry();
  assert.equal(f.profile.status().linked, true);
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0, 'repairing a pointer must not mint a redundant private version');
  assert.equal(f.requests.length, 2);
});

test('a durable record remains readable while its game relationship is pending', async () => {
  const f = fixture({ linkFailures: 1 }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_link_pending' });
  const loaded = await f.profile.get(); assert.equal(loaded.exists, true); assert.equal(loaded.data().n, 1);
});

test('concurrent sets coalesce around in-flight create and preserve latest private state', async () => {
  const held = gate(), f = fixture({ createGate: held }); await f.profile.connect();
  const first = f.profile.set({ v: 1, n: 1 }); await held.ready;
  const second = f.profile.set({ v: 1, n: 2 }), third = f.profile.set({ v: 1, n: 3 });
  held.release(); await Promise.all([first, second, third]);
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  const saves = f.calls.filter(call => call.op === 'save'); assert.equal(saves.length, 1); assert.equal(saves[0].record.save.n, 3);
  assert.equal((await f.profile.get()).data().n, 3);
});

test('closing during in-flight publication cannot reconnect, link or change UI state after close', async () => {
  const held = gate(), f = fixture({ createGate: held }); await f.profile.connect();
  const saving = f.profile.set({ v: 1, n: 1 }); await held.ready; f.profile.close(); held.release();
  await assert.rejects(saving, { code: 'revoked' });
  assert.equal(f.isClosed(), true); assert.equal(f.profile.status().state, 'closed'); assert.equal(f.requests.length, 0);
});

test('closing during pointer linking preserves the closed state when its acknowledgement arrives', async () => {
  const held = gate(), f = fixture({ linkGate: held }); await f.profile.connect();
  const saving = f.profile.set({ v: 1, n: 1 }); await held.ready; f.profile.close(); held.release();
  await assert.rejects(saving, { code: 'revoked' });
  assert.equal(f.profile.status().state, 'closed');
});

test('closing during an existing private record load refuses its late plaintext result', async () => {
  const held = gate(), pointer = { graphIri: 'urn:graph:fixture:existing' };
  const f = fixture({ pointer, initial: profileRecord({ v: 1, n: 1 }), loadGate: held }); await f.profile.connect();
  const loading = f.profile.get(); await held.ready; f.profile.close(); held.release();
  await assert.rejects(loading, { code: 'revoked' });
  assert.equal(f.profile.status().state, 'closed');
});

test('owner index naming is stable across game authorities and distinct for another owner', async () => {
  assert.match(INDEX, /^urn:graph:hallowmarch:player-profile-index:[0-9a-f]{64}$/);
  assert.equal(await playerProfileIndexGraphIri(OWNER, webcrypto), INDEX);
  assert.notEqual(await playerProfileIndexGraphIri('did:web:identity.example:users:bob', webcrypto), INDEX);
  assert.equal(validatePlayerProfileIndex(indexRecord('urn:graph:fixture:profile'), OWNER), 'urn:graph:fixture:profile');
});

test('confirmed owner index is published before the game hint and is not rewritten per character save', async () => {
  const f = fixture(); await f.profile.connect(); await f.profile.set({ v: 1, n: 1 });
  assert.equal(f.profile.status().indexed, true); assert.equal(f.profile.status().indexGraphIri, INDEX);
  const profile = f.calls.find(call => call.op === 'create'), index = f.calls.find(call => call.op === 'createAt');
  assert(index); assert.equal(index.record.schema, 'hallowmarch.player-profile-index/v1');
  assert.deepEqual(Object.keys(index.record).sort(), ['game', 'ownerDid', 'profileGraphIri', 'schema']);
  assert.equal(index.record.profileGraphIri, f.requests[0].body.graphIri);
  assert(!JSON.stringify(index.record).includes('fixture-cid'), 'the native profile head is followed, not pinned in the index');
  assert(f.calls.indexOf(profile) < f.calls.indexOf(index));
  await f.profile.set({ v: 1, n: 2 });
  assert.equal(f.calls.filter(call => call.op === 'createAt').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 1);
});

for (const indexMode of ['pending', 'uncertain', 'pending-twice']) test(indexMode + ' owner-index acknowledgement confirms before another profile write; never duplicates profile/index', async () => {
  const f = fixture({ indexMode }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_index_pending' });
  assert.equal(f.profile.status().pending, true); assert.equal(f.profile.status().state, 'index_pending');
  assert.equal(f.profile.status().indexed, false); assert.equal(f.requests.length, 0);
  assert(!f.states.some(value => value.state === 'saved'));
  if (indexMode === 'pending-twice') await assert.rejects(f.profile.retry(), { code: 'pod_index_pending' });
  await f.profile.set({ v: 1, n: 2 });
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'createAt').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 1);
  assert.equal(f.calls.find(call => call.op === 'save').record.save.n, 2);
  const confirm = f.calls.findIndex(call => call.op === 'confirm' && call.operationId === 'fixture-index-op-1');
  assert(confirm >= 0 && confirm < f.calls.findIndex(call => call.op === 'save'));
  assert.equal(f.profile.status().state, 'saved'); assert.equal(f.profile.status().pending, false);
});

test('index publication refusal retains the original private profile and cannot claim saved or create a duplicate', async () => {
  const f = fixture({ indexFailures: 1 }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'native_refused' });
  assert.equal(f.requests.length, 0); assert.equal(f.profile.status().indexed, false);
  assert(!f.states.some(value => value.state === 'saved'));
  await f.profile.retry();
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0);
  assert.equal(f.calls.filter(call => call.op === 'createAt').length, 2);
  assert.equal(f.profile.status().state, 'saved');
});

test('empty browser with no game hint discovers existing owner index, requires recovery, then reads exact profile', async () => {
  const original = fixture({ linkFailures: 1 }); await original.profile.connect();
  await assert.rejects(original.profile.set({ v: 1, private: 'private fixture save', n: 7 }), { code: 'pod_link_pending' });
  const originalGraph = original.profile.status().profileGraphIri;
  const fresh = fixture({ sharedRecords: original.records, keyPresent: false });
  const connected = await fresh.profile.connect(); assert.equal(connected.hasRecord, true);
  assert.equal(fresh.profile.status().hasRecord, true); assert.equal(fresh.profile.status().keyPresent, false);
  await assert.rejects(fresh.profile.createKey(), { code: 'recovery_required' });
  await assert.rejects(fresh.profile.get(), { code: 'key_required' });
  assert.equal(fresh.calls.filter(call => call.op === 'createKey').length, 0);
  await fresh.profile.restoreRecovery({ fixture: 'encrypted recovery only' }, 'fixture passphrase');
  const found = await fresh.profile.get(); assert.equal(found.exists, true); assert.equal(found.data().n, 7);
  assert.equal(fresh.profile.status().profileGraphIri, originalGraph); assert.equal(fresh.profile.status().indexed, true);
  assert.equal(fresh.requests.length, 0, 'reading owner discovery does not require a game-cache write');
  assert.equal(fresh.calls.filter(call => ['create', 'createAt', 'save'].includes(call.op)).length, 0);
});

test('an owner index overrides a stale game hint and is read before any profile can be changed', async () => {
  const graph = 'urn:graph:fixture:canonical-owner-profile';
  const f = fixture({ initialGraph: graph, initial: profileRecord({ v: 1, n: 9 }), ownerIndex: indexRecord(graph),
    pointer: { graphIri: 'urn:graph:fixture:stale-hallow-hint' } });
  await f.profile.connect(); await assert.rejects(f.profile.set({ v: 1, n: 10 }), { code: 'unread_record' });
  assert.equal((await f.profile.get()).data().n, 9);
  assert.deepEqual(f.calls.filter(call => call.op === 'load').map(call => call.graphIri), [INDEX, graph]);
  assert.equal(f.calls.filter(call => ['create', 'createAt', 'save'].includes(call.op)).length, 0);
});

test('verified legacy game hint migrates into an absent owner index without duplicating its profile', async () => {
  const graph = 'urn:graph:fixture:verified-legacy-profile';
  const f = fixture({ pointer: { graphIri: graph }, initial: profileRecord({ v: 1, n: 4 }) });
  await f.profile.connect(); assert.equal((await f.profile.get()).data().n, 4);
  assert(f.calls.findIndex(call => call.op === 'load' && call.graphIri === graph)
    < f.calls.findIndex(call => call.op === 'createAt'));
  assert.equal(f.calls.filter(call => call.op === 'create').length, 0);
  assert.equal(f.records.get(INDEX).record.profileGraphIri, graph);
});

test('corrupt, wrong-owner and wrong-game owner indices block hint fallback, new keys and every publication', async () => {
  const graph = 'urn:graph:fixture:hint';
  for (const invalid of [{ ...indexRecord(graph), ownerDid: 'did:web:identity.example:users:bob' },
    { ...indexRecord(graph), schema: 'other-index/v1' }, { ...indexRecord(graph), game: 'urn:game:other' },
    { ...indexRecord(graph), profileGraphIri: 'https://not-a-profile.example/' }, { ...indexRecord(graph), cid: 'forbidden-pinned-head' }]) {
    const f = fixture({ pointer: { graphIri: graph }, initial: profileRecord({ v: 1 }), ownerIndex: invalid });
    await f.profile.connect();
    await assert.rejects(f.profile.get(), { code: 'invalid_profile_index' });
    await assert.rejects(f.profile.createKey(), { code: 'recovery_required' });
    await assert.rejects(f.profile.set({ v: 1, n: 2 }), { code: 'unread_record' });
    assert.equal(f.calls.filter(call => ['create', 'createAt', 'save', 'createKey'].includes(call.op)).length, 0);
  }
});

test('native index fork and a failed metadata read cannot authorize a new key or character', async () => {
  const f = fixture({ keyPresent: false, forked: true });
  await assert.rejects(f.profile.connect(), { code: 'conflict' });
  await assert.rejects(f.profile.createKey(), { code: 'conflict' });
  await assert.rejects(f.profile.get(), { code: 'conflict' });
  assert.equal(f.calls.filter(call => ['create', 'createAt', 'save', 'createKey'].includes(call.op)).length, 0);
});

test('a fresh confirmed-absent index permits one key; a held key is never replaced', async () => {
  const f = fixture({ keyPresent: false }); await f.profile.connect();
  assert.equal((await f.profile.get()).exists, false); await f.profile.createKey();
  await assert.rejects(f.profile.createKey(), { code: 'key_exists' });
  assert.equal(f.calls.filter(call => call.op === 'createKey').length, 1);
});

test('resubmitting identical progress during index confirmation does not mint a redundant character version', async () => {
  const f = fixture({ indexMode: 'pending' }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_index_pending' });
  await f.profile.set({ v: 1, n: 1 });
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'createAt').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0);
  assert.equal(f.profile.status().state, 'saved');
});

test('a competing native index after a lost acknowledgement cannot be overwritten or cause duplicate character creation', async () => {
  const f = fixture({ indexMode: 'uncertain' }); await f.profile.connect();
  await assert.rejects(f.profile.set({ v: 1, n: 1 }), { code: 'pod_index_pending' });
  f.records.set(INDEX, { ...f.records.get(INDEX), head: { cid: 'competing-native-cid', descriptorUrl: binding.podUrl + 'competing.ttl' },
    record: indexRecord('urn:graph:fixture:competing-character') });
  await assert.rejects(f.profile.retry(), { code: 'profile_index_conflict' });
  await assert.rejects(f.profile.retry(), { code: 'profile_index_conflict' });
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'createAt').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0); assert.equal(f.requests.length, 0);
  assert(!f.states.some(value => value.state === 'saved'));
});

test('index creation by another browser between connect and key creation requires recovery', async () => {
  const records = new Map(), empty = fixture({ sharedRecords: records, keyPresent: false }); await empty.profile.connect();
  const other = fixture({ sharedRecords: records }); await other.profile.connect(); await other.profile.set({ v: 1, n: 1 });
  await assert.rejects(empty.profile.createKey(), { code: 'recovery_required' });
  assert.equal(empty.profile.status().hasRecord, true);
  assert.equal(empty.calls.filter(call => call.op === 'createKey').length, 0);
});

test('metadata outage never counts as index absence or permits key creation', async () => {
  const f = fixture({ keyPresent: false, metadataError: 'native_unavailable' });
  await assert.rejects(f.profile.connect(), { code: 'native_unavailable' });
  await assert.rejects(f.profile.createKey(), { code: 'native_unavailable' });
  assert.equal(f.calls.filter(call => call.op === 'createKey').length, 0);
});

test('reconnecting invalidates a cached index body when its native head changed', async () => {
  const f = fixture(); await f.profile.connect(); await f.profile.set({ v: 1, n: 1 });
  f.records.set(INDEX, { ...f.records.get(INDEX), head: { cid: 'replacement-index-head', descriptorUrl: binding.podUrl + 'replacement-index.ttl' },
    record: indexRecord('urn:graph:fixture:replacement-profile') });
  await f.profile.connect(); assert.equal(f.profile.status().indexed, false);
  await assert.rejects(f.profile.get(), { code: 'profile_index_conflict' });
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0);
});


function actualGameBridge(fetchImpl, deadlineSignal = AbortSignal) {
  const client = readFileSync(new URL('../../src/14v_nativeidentity.js', import.meta.url), 'utf8');
  const first = client.indexOf('async function nativePlayerRequest('), last = client.indexOf('async function nativePlayerModules(', first);
  assert(first >= 0 && last > first, 'execute the production game request adapter');
  const context = vm.createContext({ NETWS: { token: 'explicit-fixture-app-proof' }, fetch: fetchImpl, AbortSignal: deadlineSignal,
    nativePlayerError: (code, message) => Object.assign(Error(message), { code }) });
  vm.runInContext(client.slice(first, last) + '\nglobalThis.request = nativePlayerRequest;', context);
  return context.request;
}
const acknowledged = () => ({ ok: true, json: async () => ({ linked: true }) });
function delayedAcknowledgement(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(acknowledged()); }, ms);
  });
}
function guestFixtureSave() {
  return { v: 1, char: { name: 'Native deadline fixture', level: 1 },
    nativePlay: { schema: 'hallowmarch.provisional-character/v1',
      characterId: 'urn:uuid:4dab27a4-9d1b-4e88-948c-082b78300a62', guestOwnerDid: OWNER,
      guestExpiresAt: Date.now() + 86400000 } };
}
test('the actual game adapter scopes 60s only to durable lifecycle POSTs and retains short/explicit bounds', async () => {
  const deadlines = [];
  const request = actualGameBridge(async () => acknowledged(), { timeout(ms) { deadlines.push(ms); return AbortSignal.timeout(ms); } });
  const cases = [
    ['/gaming/identity/play/complete', { method: 'POST' }, 60000],
    ['/gaming/identity/record-link', { method: 'POST' }, 60000],
    ['/gaming/identity/play/challenge', { method: 'POST' }, 18000],
    ['/gaming/identity/status', {}, 18000],
    ['/gaming/identity/record-link', {}, 18000],
    ['/gaming/identity/record-link?unrelated=1', { method: 'POST' }, 18000],
    ['/gaming/identity/play/claim-complete', { method: 'POST' }, 18000],
    ['/gaming/identity/record-link', { method: 'POST', timeoutMs: 25 }, 25],
  ];
  for (const [url, options, expected] of cases) { await request(url, options); assert.equal(deadlines.at(-1), expected); }
});
test('a real profile registration lasting over 18s confirms one private checkpoint with the actual request adapter',
  { timeout: 45000 }, async () => {
    let links = 0;
    const request = actualGameBridge(async (url, options) => {
      assert.equal(url, '/gaming/identity/record-link'); links++;
      return delayedAcknowledgement(19100, options.signal);
    });
    const f = fixture({ bridgeRequest: request }), save = guestFixtureSave(), started = Date.now();
    await f.profile.connect(); await f.profile.set(save);
    assert(Date.now() - started >= 19000, 'exercise a healthy registration beyond the former deadline');
    assert.equal(links, 1); assert.equal(f.profile.status().linked, true);
    assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
    assert.equal(f.calls.filter(call => call.op === 'createAt').length, 1);
    assert.equal(f.calls.filter(call => call.op === 'save' || call.op === 'createKey').length, 0);
    assert.deepEqual((await f.profile.get()).data().nativePlay, save.nativePlay, 'owner, character ID and fixed guest expiry are unchanged');
    assert.equal(f.calls.find(call => call.op === 'create').record.ownerDid, OWNER);
  });
test('an explicit short lifecycle deadline still aborts a live request', { timeout: 2000 }, async () => {
  const request = actualGameBridge(async (url, options) => delayedAcknowledgement(1000, options.signal));
  const started = Date.now();
  await assert.rejects(request('/gaming/identity/record-link', { method: 'POST', timeoutMs: 25 }), { name: 'TimeoutError' });
  assert(Date.now() - started < 500, 'an explicit bound must not inherit the longer lifecycle window');
});
test('a lost registration acknowledgement repairs the identical owned pointer without publishing another checkpoint', async () => {
  let links = 0; const registrations = new Map(), submitted = [], selectedDeadlines = [];
  const request = actualGameBridge(async (url, options) => {
    assert.equal(url, '/gaming/identity/record-link'); const pointer = JSON.parse(options.body); submitted.push(pointer); links++;
    registrations.set(JSON.stringify(pointer), true); // This exact relationship committed before its response was lost.
    return links === 1 ? delayedAcknowledgement(250, options.signal) : acknowledged();
  }, { timeout(ms) { selectedDeadlines.push(ms); return AbortSignal.timeout(links === 0 ? 25 : ms); } });
  const f = fixture({ bridgeRequest: request }), save = guestFixtureSave();
  await f.profile.connect();
  await assert.rejects(f.profile.set(save), { code: 'pod_link_pending' });
  const reference = f.profile.reference();
  assert.equal(f.profile.status().hasRecord, true); assert(f.profile.reference(), 'the original private checkpoint and index remain confirmed');
  assert.equal(f.profile.status().linked, false);
  await f.profile.retry();
  assert.equal(f.profile.status().linked, true); assert.deepEqual(f.profile.reference(), reference);
  assert.deepEqual(submitted[0], submitted[1]); assert.deepEqual(selectedDeadlines, [60000, 60000]);
  assert.equal(registrations.size, 1); assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'createAt').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save' || call.op === 'createKey').length, 0);
  assert.deepEqual((await f.profile.get()).data().nativePlay, save.nativePlay);
});
test('closing a profile during the longer lifecycle request keeps ownership closed when its late acknowledgement arrives', async () => {
  const held = gate();
  const request = actualGameBridge(async () => { held.entered(); await held.hold; return acknowledged(); });
  const f = fixture({ bridgeRequest: request }); await f.profile.connect();
  const saving = f.profile.set(guestFixtureSave()); await held.ready; f.profile.close();
  assert.equal(f.profile.status().state, 'closed'); held.release();
  await assert.rejects(saving, { code: 'revoked' });
  assert.equal(f.profile.status().state, 'closed'); assert.equal(f.profile.status().linked, false);
  assert.equal(f.calls.filter(call => call.op === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.op === 'save').length, 0);
});
