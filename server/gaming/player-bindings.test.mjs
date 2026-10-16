import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerBindingLedger } from './player-bindings.js';
import { createHash } from 'node:crypto';
import { DurableStoreConflictError, InteregoGamingStore } from './interego-store.js';

const clone = value => structuredClone(value);
const binding = (id = 'alice', host = 'identity.interego.xwisee.com') => ({
  subjectDid: `did:web:${host}:users:u-${id}`, webId: `https://${host}/users/u-${id}/profile#me`,
  userId: 'u-' + id, podUrl: `https://gate.interego.xwisee.com/u-${id}/`,
  authenticatedAgentDid: `did:web:${host}:agents:browser-u-${id}`,
  verifiedAt: '2026-10-16T12:00:00.000Z', issuer: 'https://relay.interego.xwisee.com/',
  verificationMethod: 'oauth-pkce+authenticated-mcp',
});
const pointer = (id = 'alice', suffix = 'context-graphs/123.ttl') => ({ kind: 'character',
  graphIri: 'urn:graph:gaming:' + id + ':character', descriptorUrl: `https://gate.interego.xwisee.com/u-${id}/` + suffix });

/**
 * Explicit LOCAL contract fixture. It implements atomic stream-version CAS,
 * detached snapshots, idempotency and injected faults, entirely in memory.
 * It does not prove encryption, the real native engine or production durability;
 * those remain the responsibility of the injected InteregoGamingStore adapter.
 */
function fixture() {
  let version = 0, state = null;
  const operations = new Map(), commits = [], controls = {};
  const store = {
    async ready() { if (controls.readyError) throw controls.readyError; },
    async load(streamId) {
      assert.equal(streamId, 'player-bindings-v1');
      if (controls.loadError) throw controls.loadError;
      if (controls.readbackError && commits.length) throw new Error('native readback unavailable');
      if (controls.corrupt) return clone(controls.corrupt);
      if (controls.oldReadback && commits.length) return { version: 0, state: null };
      return clone({ version, state });
    },
    async commit(streamId, input) {
      assert.equal(streamId, 'player-bindings-v1');
      if (controls.commitGate) await controls.commitGate;
      if (controls.commitError) throw controls.commitError;
      if (controls.contention) throw new DurableStoreConflictError(input.expectedVersion, input.expectedVersion + 1);
      const payload = JSON.stringify(input);
      if (operations.has(input.idempotencyKey)) {
        if (operations.get(input.idempotencyKey).payload !== payload) throw Object.assign(new Error('idempotency conflict'), { code: 'IDEMPOTENCY_CONFLICT' });
        return clone(operations.get(input.idempotencyKey).result);
      }
      if (input.expectedVersion !== version) throw new DurableStoreConflictError(input.expectedVersion, version);
      version++;
      // Native serialization orders fields differently from caller objects.
      const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
      state = sort(clone(input.state));
      const result = clone({ version, state });
      operations.set(input.idempotencyKey, { payload, result }); commits.push(clone(input));
      return clone(result);
    },
  };
  return { store, controls, commits, snapshot: () => clone({ version, state }),
    ledger: options => createPlayerBindingLedger({ store, ...options }) };
}
async function prepared() { const f = fixture(), ledger = f.ledger(); await ledger.ready; return { ...f, ledger }; }
async function bind(ledger, id = 'alice', accountId = 'g-' + id, operationId = 'bind-' + id) {
  return ledger.bindVerified(binding(id), accountId, { operationId, accountSummary: { id: accountId, name: id, guest: true } });
}

test('missing native store disables safely and cannot bind or link', async () => {
  const ledger = createPlayerBindingLedger(); await ledger.ready;
  assert.equal(ledger.enabled, false); assert.equal(ledger.bindingForDid(binding().subjectDid), null);
  assert.equal(await ledger.refresh(), null);
  await assert.rejects(bind(ledger), { code: 'NATIVE_BINDINGS_UNAVAILABLE', status: 503 });
  await assert.rejects(ledger.linkRecord('g-alice', binding().subjectDid, pointer(), { operationId: 'record' }), { status: 503 });
});

test('confirmed native bindings survive a fresh ledger and isolate two owners', async () => {
  const f = await prepared();
  const first = await bind(f.ledger), second = await bind(f.ledger, 'bob');
  assert.equal(first.accountId, 'g-alice'); assert.equal(first.restored, false); assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  const fresh = createPlayerBindingLedger({ store: f.store }); await fresh.ready;
  assert.equal(fresh.bindingForDid(binding().subjectDid).accountId, 'g-alice');
  assert.equal(fresh.bindingForAccount('g-bob').binding.subjectDid, binding('bob').subjectDid);
  assert.equal(fresh.bindingForAccount('missing'), null);
  const detached = fresh.bindingForAccount('g-alice'); detached.binding.subjectDid = 'forged'; detached.records.character = pointer('bob');
  assert.equal(fresh.bindingForAccount('g-alice').binding.subjectDid, binding().subjectDid);
  assert.deepEqual(fresh.bindingForAccount('g-alice').records, {});
  assert.deepEqual(fresh.status(), { configured: true, ready: true, version: 2, bindings: 2, error: null });
});

test('same-owner retry and new-guest restoration reuse the original account without importing the guest', async () => {
  const f = await prepared(); await bind(f.ledger);
  const retry = await bind(f.ledger); assert.equal(retry.version, 1); assert.equal(retry.restored, false);
  const restore = await bind(f.ledger, 'alice', 'g-new-device', 'restore-device');
  assert.equal(restore.accountId, 'g-alice'); assert.equal(restore.restored, true); assert.equal(restore.version, 1);
  assert.equal(f.commits.length, 1); assert.equal(f.ledger.bindingForAccount('g-new-device'), null);
  assert.equal(f.ledger.bindingForAccount('g-alice').accountSummary.name, 'alice');
});

test('a game account cannot be rebound to a different verified owner', async () => {
  const f = await prepared(); await bind(f.ledger);
  await assert.rejects(bind(f.ledger, 'bob', 'g-alice'), { code: 'PLAYER_BINDING_CONFLICT', status: 409 });
  assert.equal(f.commits.length, 1); assert.equal(f.ledger.bindingForDid(binding('bob').subjectDid), null);
});

test('CAS races converge on one account for one DID across independent ledgers', async () => {
  const f = await prepared(), other = createPlayerBindingLedger({ store: f.store }); await other.ready;
  const results = await Promise.all([bind(f.ledger, 'alice', 'g-first', 'first'), bind(other, 'alice', 'g-second', 'second')]);
  assert.equal(results[0].accountId, results[1].accountId);
  assert.equal(results.filter(item => item.restored).length, 1);
  assert.equal(f.snapshot().state.bindings.length, 1); assert.equal(f.commits.length, 1);
});

test('CAS races preserve independent owners and reject conflicting claims on one account', async () => {
  const f = await prepared(), other = createPlayerBindingLedger({ store: f.store }); await other.ready;
  await Promise.all([bind(f.ledger), bind(other, 'bob')]);
  assert.equal(f.snapshot().state.bindings.length, 2);
  const g = await prepared(), second = createPlayerBindingLedger({ store: g.store }); await second.ready;
  const outcomes = await Promise.allSettled([bind(g.ledger, 'alice', 'g-shared'), bind(second, 'bob', 'g-shared')]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'PLAYER_BINDING_CONFLICT');
});

test('native CAS contention has bounded retries and never treats it as a successful bind', async () => {
  const f = await prepared(); f.controls.contention = true;
  await assert.rejects(bind(f.ledger), { code: 'VERSION_CONFLICT' });
  assert.equal(f.ledger.bindingForAccount('g-alice'), null); assert.equal(f.commits.length, 0);
});

test('pending and failed native writes never populate the synchronous binding cache', async () => {
  const f = await prepared(); let release;
  f.controls.commitGate = new Promise(resolve => { release = resolve; });
  const result = bind(f.ledger); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ledger.bindingForAccount('g-alice'), null);
  release(); await result;
  assert.equal(f.ledger.bindingForAccount('g-alice').accountId, 'g-alice');
  f.controls.commitError = Object.assign(new Error('unavailable'), { code: 'DURABILITY_UNAVAILABLE', status: 503 });
  await assert.rejects(bind(f.ledger, 'bob'), { code: 'DURABILITY_UNAVAILABLE' });
  assert.equal(f.ledger.enabled, false); assert.equal(f.ledger.bindingForAccount('g-bob'), null);
  assert.equal(f.snapshot().state.bindings.length, 1);
});

test('a successful commit without matching readback cannot acknowledge or cache a binding', async () => {
  for (const fault of ['readbackError', 'oldReadback']) {
    const f = await prepared(); f.controls[fault] = true;
    await assert.rejects(bind(f.ledger), error => error.status === 503);
    assert.equal(f.ledger.enabled, false); assert.equal(f.ledger.bindingForAccount('g-alice'), null);
    delete f.controls[fault]; await f.ledger.refresh();
    assert.equal(f.ledger.bindingForAccount('g-alice').accountId, 'g-alice', 'explicit recovery comes from native readback');
    const retry = await bind(f.ledger); assert.equal(retry.version, 1); assert.equal(f.commits.length, 1);
  }
});

test('a failed native operation cannot resurrect an older unbound snapshot during recovery', async () => {
  const f = await prepared(); await bind(f.ledger);
  f.controls.commitError = Object.assign(new Error('unavailable'), { code: 'DURABILITY_UNAVAILABLE' });
  await assert.rejects(bind(f.ledger, 'bob'));
  f.controls.corrupt = { version: 0, state: null };
  await assert.rejects(f.ledger.refresh(), { code: 'CORRUPT_DURABLE_STATE' });
  assert.equal(f.ledger.enabled, false); assert.equal(f.ledger.bindingForAccount('g-alice'), null);
  delete f.controls.corrupt; await f.ledger.refresh();
  assert.equal(f.ledger.bindingForAccount('g-alice').binding.subjectDid, binding().subjectDid);
});

test('startup failures and corrupt or ambiguous native state fail closed', async () => {
  const f = fixture(); f.controls.readyError = new Error('native down'); const ledger = f.ledger();
  await assert.rejects(ledger.ready, { code: 'NATIVE_BINDINGS_UNAVAILABLE' });
  assert.equal(ledger.enabled, false); await assert.rejects(bind(ledger), { status: 503 });
  for (const corrupt of [
    { version: 1, state: null },
    { version: 0, state: {} },
    { version: 1, state: { schema: 'other', bindings: [] } },
    { version: 1, state: { schema: 'urn:interego:gaming:player-bindings:v1', bindings: [], accessToken: 'secret' } },
  ]) {
    const g = fixture(); g.controls.corrupt = corrupt; const bad = g.ledger();
    await assert.rejects(bad.ready, { code: 'CORRUPT_DURABLE_STATE' }); assert.equal(bad.bindingForAccount('g-alice'), null);
  }
  const g = await prepared(); await bind(g.ledger);
  const badState = g.snapshot(); badState.state.bindings.push(clone(badState.state.bindings[0])); g.controls.corrupt = badState;
  await assert.rejects(g.ledger.refresh(), { code: 'CORRUPT_DURABLE_STATE' });
  assert.equal(g.ledger.bindingForAccount('g-alice'), null);
});

test('only explicit public fields persist, never tokens or personal game state', async () => {
  const f = await prepared();
  await f.ledger.bindVerified({ ...binding(), accessToken: 'do-not-persist', privateKey: 'never', character: { inventory: ['secret'] } }, 'g-alice', {
    operationId: 'safe-whitelist', accountSummary: { id: 'g-alice', name: 'Alice', guest: false, password: 'do-not-persist', character: { level: 4 } },
  });
  await f.ledger.linkRecord('g-alice', binding().subjectDid, { ...pointer(), token: 'do-not-persist', inventory: ['secret'] }, { operationId: 'safe-pointer' });
  const serialized = JSON.stringify(f.commits);
  for (const forbidden of ['accessToken', 'privateKey', 'password', 'inventory', 'do-not-persist']) assert.equal(serialized.includes(forbidden), false);
  assert.deepEqual(Object.keys(f.snapshot().state.bindings[0].binding).sort(), Object.keys(binding()).sort());
});

test('binding syntax requires a canonical DID/WebID, agent owner and exact trusted pod suffix', async () => {
  const f = await prepared();
  for (const patch of [
    { subjectDid: 'did:key:zNotAnOwner' }, { userId: 'u-bob' }, { webId: binding('bob').webId },
    { webId: 'https://evil.example/users/u-alice/profile#me' }, { podUrl: binding('bob').podUrl },
    { podUrl: 'https://gate.interego.xwisee.com/u-alice-evil/' }, { podUrl: 'https://evil.example/u-alice/' },
    { authenticatedAgentDid: binding('bob').authenticatedAgentDid }, { issuer: 'http://relay.interego.xwisee.com/' },
    { verifiedAt: 'not-a-date' }, { subjectDid: 'did:web:identity.interego.xwisee.com%2fwrong:users:u-alice' },
  ]) await assert.rejects(f.ledger.bindVerified({ ...binding(), ...patch }, 'g-alice', { operationId: 'invalid' }), { status: 400 });
  assert.equal(f.commits.length, 0);
  await assert.rejects(f.ledger.bindVerified(binding(), 'g-alice', { operationId: 'x'.repeat(257) }), { status: 400 });
});

test('federated identity host and explicitly configured store bases remain supported', async () => {
  const f = fixture(), ledger = f.ledger({ storeBases: ['https://pods.federated.example/storage/', 'http://native.federated.internal/'] }); await ledger.ready;
  const owner = { ...binding('carol', 'id.federated.example'), podUrl: 'http://native.federated.internal/u-carol/', issuer: 'https://relay.federated.example/' };
  const result = await ledger.bindVerified(owner, 'g-carol', { operationId: 'federated' });
  assert.equal(result.binding.podUrl, 'https://pods.federated.example/storage/u-carol/');
  await ledger.linkRecord('g-carol', owner.subjectDid, { ...pointer('carol'), descriptorUrl: 'http://native.federated.internal/u-carol/context-graphs/1.ttl' }, { operationId: 'record-carol' });
  assert.equal(ledger.bindingForAccount('g-carol').records.character.descriptorUrl, 'https://pods.federated.example/storage/u-carol/context-graphs/1.ttl');
});

test('record links require the bound account and owner, normalize a trusted internal alias, and are idempotent', async () => {
  const f = await prepared(); await bind(f.ledger); await bind(f.ledger, 'bob');
  await assert.rejects(f.ledger.linkRecord('g-alice', binding('bob').subjectDid, pointer('bob'), { operationId: 'wrong-owner' }), { status: 403 });
  await assert.rejects(f.ledger.linkRecord('g-missing', binding().subjectDid, pointer(), { operationId: 'missing-owner' }), { status: 403 });
  const internal = { ...pointer(), descriptorUrl: 'http://css.railway.internal:3456/u-alice/context-graphs/123.ttl' };
  const linked = await f.ledger.linkRecord('g-alice', binding().subjectDid, internal, { operationId: 'link' });
  assert.deepEqual(linked.pointer, pointer()); assert.equal(linked.version, 3);
  const retried = await f.ledger.linkRecord('g-alice', binding().subjectDid, pointer(), { operationId: 'link' });
  assert.equal(retried.version, 3); assert.equal(f.commits.length, 3);
  assert.deepEqual(f.ledger.bindingForAccount('g-bob').records, {});
});

test('record pointers reject foreign pods, URL confusion, traversal and invalid graph IRIs without fetching', async () => {
  const f = await prepared(); await bind(f.ledger);
  for (const descriptorUrl of [
    'https://gate.interego.xwisee.com/u-bob/context-graphs/1.ttl',
    'https://gate.interego.xwisee.com/u-alice-evil/context-graphs/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/../u-bob/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/%2e%2e/u-bob/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/context%2fgraphs/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/context%5cgraphs/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/context%252fgraphs/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/context-graphs/1.ttl?token=secret',
    'https://gate.interego.xwisee.com/u-alice/context-graphs/1.ttl#fragment',
    'https://alice:secret@gate.interego.xwisee.com/u-alice/1.ttl',
    'https://gate.interego.xwisee.com/u-alice//1.ttl',
    'http://unconfigured.internal/u-alice/1.ttl',
    'https://gate.interego.xwisee.com/u-alice/',
    'https://gate.interego.xwisee.com.evil.example/u-alice/1.ttl',
  ]) await assert.rejects(f.ledger.linkRecord('g-alice', binding().subjectDid, { ...pointer(), descriptorUrl }, { operationId: 'invalid-pointer' }));
  for (const graphIri of ['https://evil.example/graph', 'urn:graph:', 'urn:graph:bad\nvalue']) {
    await assert.rejects(f.ledger.linkRecord('g-alice', binding().subjectDid, { ...pointer(), graphIri }, { operationId: 'invalid-graph' }), { status: 400 });
  }
  assert.equal(f.commits.length, 1);
});

test('aborted requests cannot begin native mutation, and bounded capacity fails without fallback', async () => {
  const f = fixture(), ledger = f.ledger({ maxBindings: 1 }); await ledger.ready;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ledger.bindVerified(binding(), 'g-alice', { operationId: 'cancelled', signal: controller.signal }), { code: 'OPERATION_ABORTED' });
  assert.equal(f.commits.length, 0); await bind(ledger);
  await assert.rejects(bind(ledger, 'bob'), { code: 'BINDING_CAPACITY', status: 503 });
  assert.equal(f.snapshot().state.bindings.length, 1);
});

/**
 * Real InteregoGamingStore, synthetic native storage boundary. This copies the
 * native-client/artifact fixture pattern used in interego-store.test.mjs; the
 * base64 codec is intentionally NOT PGSL encryption. The test proves adapter
 * composition, state/operation artifact packing, CAS recovery and fresh-reader
 * restoration. It does not claim physical persistence or cryptographic tests.
 */
function adapterFixture() {
  const owner = 'did:web:identity.interego.xwisee.com:users:u-hallowmarch';
  let head = { revision: null, records: new Map() }, sequence = 0;
  const controls = { refuse: false }, counts = { writes: 0, nativeConflicts: 0, streamConflicts: 0, artifacts: 0 };
  const artifactCodec = {
    createNativeByteArtifact(input) {
      counts.artifacts++;
      return { owner: input.owner, contentType: input.contentType, bytes: Buffer.from(input.bytes).toString('base64') };
    },
    readNativeByteArtifact(artifact) { return { ...artifact, bytes: Buffer.from(artifact.bytes, 'base64') }; },
  };
  function store() {
    const nativeClient = {
      async ready() {},
      async readHead() { return clone(head); },
      async readArtifact(reference) { return clone(reference); },
      async commit({ expected, changes, operationId }) {
        if (expected.revision !== head.revision) {
          counts.nativeConflicts++;
          throw Object.assign(new Error('Synthetic native head changed'), { name: 'NativeCommitConflictError', status: 412 });
        }
        if (controls.refuse) throw new Error('Synthetic native write refused');
        const records = new Map(expected.records);
        for (const change of changes) records.set(change.key, clone(change.artifact));
        const revision = 'sha256:' + createHash('sha256').update(JSON.stringify([...records]) + ++sequence).digest('hex');
        head = { revision, records }; counts.writes++;
        return { operationId, head: { revision }, snapshot: clone(head), replayed: false };
      },
    };
    const adapter = new InteregoGamingStore({ nativeClient, artifactCodec, owner, namespace: 'player-binding-composition-tests' });
    return {
      ready: () => adapter.ready(), load: id => adapter.load(id),
      async commit(id, input) {
        try { return await adapter.commit(id, input); }
        catch (error) { if (error.code === 'VERSION_CONFLICT') counts.streamConflicts++; throw error; }
      },
    };
  }
  return { store, counts, controls, head: () => clone(head) };
}

test('real native stream adapter composes with the ledger: CAS retry, two owners, receipts and fresh-reader restoration', async () => {
  const f = adapterFixture(), first = createPlayerBindingLedger({ store: f.store() }), second = createPlayerBindingLedger({ store: f.store() });
  await Promise.all([first.ready, second.ready]);
  const results = await Promise.all([bind(first), bind(second, 'bob')]);
  assert.deepEqual(results.map(value => value.version).sort(), [1, 2]);
  assert.ok(f.counts.nativeConflicts >= 1, 'independent native snapshots raced at the actual adapter CAS boundary');
  assert.ok(f.counts.streamConflicts >= 1, 'the real adapter surfaced VERSION_CONFLICT and the ledger reloaded/retried');
  assert.equal(f.counts.writes, 2);
  assert.equal(f.head().records.size, 3, 'one current stream artifact and two durable operation records');
  assert.ok(f.counts.artifacts >= 4, 'the real adapter packed both state and operation receipt artifacts');
  const nativeView = await f.store().load('player-bindings-v1');
  assert.equal(nativeView.version, 2); assert.equal(nativeView.state.bindings.length, 2);
  const restored = createPlayerBindingLedger({ store: f.store() }); await restored.ready;
  const result = await bind(restored, 'alice', 'g-new-device', 'restore-through-real-adapter');
  assert.equal(result.accountId, 'g-alice'); assert.equal(result.restored, true); assert.equal(result.version, 2);
  assert.equal(restored.bindingForDid(binding('bob').subjectDid).accountId, 'g-bob');
  assert.equal(restored.bindingForAccount('g-new-device'), null); assert.equal(f.counts.writes, 2);
  await restored.linkRecord('g-alice', binding().subjectDid, pointer(), { operationId: 'native-owner-record' });
  await assert.rejects(restored.linkRecord('g-bob', binding('bob').subjectDid, pointer(), { operationId: 'native-foreign-record' }), { status: 403 });
  const final = createPlayerBindingLedger({ store: f.store() }); await final.ready;
  assert.deepEqual(final.bindingForAccount('g-alice').records.character, pointer());
  assert.deepEqual(final.bindingForAccount('g-bob').records, {});
  f.controls.refuse = true;
  await assert.rejects(bind(final, 'carol'), { code: 'COMMIT_UNCERTAIN' });
  assert.equal(final.bindingForAccount('g-carol'), null); assert.equal(final.enabled, false);
  assert.equal((await f.store().load('player-bindings-v1')).state.bindings.length, 2);
});
