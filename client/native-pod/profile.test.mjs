import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerPodProfile, validatePlayerProfile } from './profile.mjs';

const OWNER = 'did:web:identity.example:users:alice';
const binding = { subjectDid: OWNER, podUrl: 'https://pod.example/alice/' };
const copy = value => JSON.parse(JSON.stringify(value));
const profileRecord = save => ({ schema: 'hallowmarch.player-profile/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch', save });
function gate() { let release, entered; return { ready: new Promise(resolve => { entered = resolve; }),
  hold: new Promise(resolve => { release = resolve; }), entered: () => entered(), release: () => release() }; }
function fixture({ pointer = null, initial = null, mode = 'saved', linkFailures = 0, createGate = null, linkGate = null, loadGate = null } = {}) {
  const calls = [], requests = [], states = [], records = new Map(), operations = new Map();
  let version = 0, clientClosed = false, confirms = 0;
  const observed = (graphIri, record) => ({ saved: true, status: 'saved', graphIri, head: {
    cid: 'fixture-cid-' + (++version), descriptorUrl: binding.podUrl + 'context-graphs/' + version + '.ttl' }, record: copy(record) });
  if (initial) records.set(pointer.graphIri, observed(pointer.graphIri, initial));
  const native = {
    connect: async () => { calls.push({ op: 'connect' }); return { keyPresent: true }; },
    registerKey: async () => { calls.push({ op: 'registerKey' }); },
    createKey: async () => { calls.push({ op: 'createKey' }); },
    restoreRecovery: async () => {}, exportRecovery: async () => ({}),
    load: async ({ graphIri }) => { calls.push({ op: 'load', graphIri }); const value = records.get(graphIri) || null;
      if (loadGate) { loadGate.entered(); await loadGate.hold; } return value; },
    create: async ({ record }) => {
      calls.push({ op: 'create', record: copy(record) });
      const graphIri = 'urn:graph:fixture:private-character-' + calls.filter(call => call.op === 'create').length;
      const result = observed(graphIri, record);
      if (createGate) { createGate.entered(); await createGate.hold; }
      if (mode === 'saved') { records.set(graphIri, result); return result; }
      operations.set('fixture-op-1', result);
      if (mode === 'uncertain') records.set(graphIri, result);
      return { saved: false, status: mode, operationId: 'fixture-op-1', graphIri };
    },
    confirm: async operationId => {
      calls.push({ op: 'confirm', operationId }); confirms++;
      if (mode === 'pending-twice' && confirms === 1) return { saved: false, status: 'pending', operationId };
      const result = operations.get(operationId); assert(result, 'confirmation must identify a real fixture operation');
      records.set(result.graphIri, result); return copy(result);
    },
    save: async ({ graphIri, expectedHead, record }) => {
      calls.push({ op: 'save', graphIri, expectedHead: copy(expectedHead), record: copy(record) });
      assert.equal(expectedHead.cid, records.get(graphIri)?.head.cid, 'CAS must follow the confirmed/read predecessor');
      const result = observed(graphIri, record); records.set(graphIri, result); return result;
    },
    close: () => { clientClosed = true; calls.push({ op: 'close' }); },
  };
  const profile = createPlayerPodProfile({ binding, credential: { kind: 'fixture-only' }, relayUrl: 'https://relay.example', pointer,
    createClient: () => native, onState: next => states.push(next),
    request: async (url, options) => {
      requests.push({ url, ...copy(options) });
      assert.equal(url, '/gaming/identity/record-link');
      assert.deepEqual(Object.keys(options.body).sort(), ['cid', 'descriptorUrl', 'graphIri', 'kind']);
      assert(!JSON.stringify(options.body).includes('private fixture save'));
      if (linkGate) { linkGate.entered(); await linkGate.hold; }
      if (linkFailures-- > 0) throw Error('Fixture pointer link unavailable');
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
