/** Synthetic storage only: no owner browser, profile, key or network access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.self = globalThis;
const { ClientKeyVault } = await import('../../client/native-pod/vendor/interego-browser.mjs');
const { createRetainedCharacterRecovery } = await import('../../client/native-pod/recovery.mjs');
const { playerProfileIndexGraphIri } = await import('../../client/native-pod/profile.mjs');
const { createOfflineKeyRecovery } = await import('./recovery-core.mjs');
const { checkedPublicScope, candidateSlots, KEY_DATABASE, KEY_STORE, RECOVERY_ORIGIN } = await import('./scope.mjs');

const OWNER = 'did:web:identity.example:users:offline-fixture';
const POD = 'https://pod.example/offline-fixture/';
const PUBLIC = checkedPublicScope({ ownerDid: OWNER, podUrl: POD });
const SCOPE = candidateSlots(PUBLIC)[0].scope;
const PASSPHRASE = 'private synthetic NEW recovery phrase';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// A deliberately tiny IndexedDB event model. It only permits exact readonly gets;
// actual IndexedDB transaction semantics are also exercised in the browser suite.
function syntheticDatabase(records = new Map(), { exists = true, upgrade = false } = {}) {
  const calls = [], forbidden = operation => { calls.push({ operation }); throw Error('Forbidden synthetic write or enumeration.'); };
  const database = { objectStoreNames: { contains: name => name === KEY_STORE }, close() { calls.push({ operation: 'close' }); },
    transaction(name, mode) {
      calls.push({ operation: 'transaction', name, mode }); assert.equal(name, KEY_STORE); assert.equal(mode, 'readonly');
      const transaction = { abort() { calls.push({ operation: 'abort' }); transaction.onabort?.(); }, objectStore(store) {
        assert.equal(store, KEY_STORE);
        return { get(scope) {
          calls.push({ operation: 'get', scope }); const request = {};
          queueMicrotask(() => { request.result = records.get(scope); request.onsuccess?.(); queueMicrotask(() => transaction.oncomplete?.()); });
          return request;
        }, put: () => forbidden('put'), add: () => forbidden('add'), delete: () => forbidden('delete'),
        clear: () => forbidden('clear'), openCursor: () => forbidden('cursor'), getAll: () => forbidden('getAll') };
      } }; return transaction;
    } };
  const indexedDB = {
    async databases() { calls.push({ operation: 'databases' }); return exists ? [{ name: KEY_DATABASE }] : []; },
    open(name) {
      calls.push({ operation: 'open', name }); assert.equal(name, KEY_DATABASE); const request = {};
      queueMicrotask(() => {
        if (upgrade) {
          request.transaction = { abort() { calls.push({ operation: 'upgradeAbort' }); queueMicrotask(() => request.onerror?.()); } };
          request.onupgradeneeded?.();
        } else { request.result = database; request.onsuccess?.(); }
      }); return request;
    }, deleteDatabase: () => forbidden('deleteDatabase'),
  };
  return { records, indexedDB, calls, assertReadOnly() {
    assert(!calls.some(call => ['put', 'add', 'delete', 'clear', 'cursor', 'getAll', 'deleteDatabase'].includes(call.operation)));
    assert(calls.filter(call => call.operation === 'get').every(call => call.scope === SCOPE));
  } };
}

async function fixture({ crypto = webcrypto } = {}) {
  const records = new Map(); let writes = 0;
  const storage = { load: async scope => records.get(scope) || null, create: async (scope, record) => {
    writes++; assert(!records.has(scope)); records.set(scope, record); return record;
  } };
  const vault = new ClientKeyVault(SCOPE, storage, webcrypto), publicKey = await vault.create();
  const db = syntheticDatabase(records);
  const core = createOfflineKeyRecovery({ publicScope: PUBLIC, origin: RECOVERY_ORIGIN, indexedDB: db.indexedDB, crypto });
  return { ...db, core, vault, publicKey, writes: () => writes, original: records.get(SCOPE) };
}
async function candidate(f) {
  const result = await f.core.check({ consent: true }); assert.equal(result.status, 'candidates'); assert.equal(result.candidates.length, 1);
  const item = result.candidates[0]; assert.deepEqual(Object.keys(item).sort(), ['handle', 'publicKey', 'relayOrigin']);
  assert.equal(item.publicKey, f.publicKey); assert.equal(item.relayOrigin, PUBLIC.relayOrigins[0]);
  assert.equal(typeof item.handle, 'string'); assert(item.handle.length >= 16); return item;
}
function guardedCrypto() {
  const started = deferred(), released = deferred();
  const subtle = new Proxy(webcrypto.subtle, { get(target, property) {
    const member = Reflect.get(target, property);
    if (property === 'deriveKey') return async (...args) => { started.resolve(); await released.promise; return member.apply(target, args); };
    return typeof member === 'function' ? member.bind(target) : member;
  } });
  return { crypto: { subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID: webcrypto.randomUUID.bind(webcrypto) }, started, released };
}

test('constructor and unchecked consent do not inspect browser storage', async () => {
  const db = syntheticDatabase(), core = createOfflineKeyRecovery({ publicScope: PUBLIC, origin: RECOVERY_ORIGIN, indexedDB: db.indexedDB, crypto: webcrypto });
  assert.deepEqual(db.calls, []); assert.deepEqual(await core.check(), { status: 'consent_required' });
  assert.deepEqual(await core.check({ consent: false }), { status: 'consent_required' });
  assert.deepEqual(await core.backup({ handle: 'unknown', passphrase: PASSPHRASE, consent: false }), { status: 'consent_required' });
  assert.deepEqual(db.calls, []); core.close();
});

test('only the fixed old loopback origin and known public identity scope are accepted', () => {
  for (const origin of ['http://localhost:8787', 'http://127.0.0.1:8788', 'https://127.0.0.1:8787', 'https://game.example']) {
    const db = syntheticDatabase();
    assert.throws(() => createOfflineKeyRecovery({ publicScope: PUBLIC, origin, indexedDB: db.indexedDB, crypto: webcrypto }));
    assert.deepEqual(db.calls, []);
  }
  for (const patch of [{ relayOrigins: ['https://arbitrary.example'] }, { podUrl: POD + '?secret=x' }, { ownerDid: 'not-a-did' }, { extra: true }]) {
    assert.throws(() => checkedPublicScope({ ...PUBLIC, ...patch }));
  }
  assert(Object.isFrozen(PUBLIC)); assert(Object.isFrozen(PUBLIC.relayOrigins));
});

test('a missing database is never opened or created', async () => {
  const db = syntheticDatabase(new Map(), { exists: false });
  const core = createOfflineKeyRecovery({ publicScope: PUBLIC, origin: RECOVERY_ORIGIN, indexedDB: db.indexedDB, crypto: webcrypto });
  assert.deepEqual(await core.check({ consent: true }), { status: 'no_candidate' });
  assert.deepEqual(db.calls, [{ operation: 'databases' }]); core.close();
});

test('a database removed between presence and open is aborted rather than upgraded', async () => {
  const db = syntheticDatabase(new Map(), { upgrade: true });
  const core = createOfflineKeyRecovery({ publicScope: PUBLIC, origin: RECOVERY_ORIGIN, indexedDB: db.indexedDB, crypto: webcrypto });
  assert.deepEqual(await core.check({ consent: true }), { status: 'unavailable' });
  assert.equal(db.calls.filter(call => call.operation === 'upgradeAbort').length, 1); db.assertReadOnly(); core.close();
});

test('check reads only the finite exact owner, pod and known-relay slot', async () => {
  const f = await fixture();
  f.records.set(SCOPE.replace(OWNER, OWNER + '-other'), f.original);
  f.records.set(SCOPE.replace('relay.interego.xwisee.com', 'foreign.example'), f.original);
  const item = await candidate(f); assert(!JSON.stringify(item).includes(SCOPE));
  f.assertReadOnly(); assert.equal(f.writes(), 1); assert.equal(f.records.size, 3); f.core.close();
});

test('public SDK backup preserves original scope and restores the same encryption key without writes', async () => {
  const f = await fixture(), item = await candidate(f), envelope = await f.vault.seal('synthetic encrypted original character');
  const result = await f.core.backup({ handle: item.handle, passphrase: PASSPHRASE, consent: true });
  assert.equal(result.status, 'backup_ready'); const file = result.recovery;
  assert.deepEqual(Object.keys(file).sort(), ['ciphertext', 'format', 'iterations', 'iv', 'kdf', 'publicKey', 'salt', 'scope', 'version']);
  assert.equal(file.format, 'interego-client-key'); assert.equal(file.scope, SCOPE); assert.equal(file.publicKey, f.publicKey);
  assert.equal(file.iterations, 600000); assert.equal(file.kdf, 'PBKDF2-SHA256');
  const imported = new Map(), restored = new ClientKeyVault(SCOPE, { load: async key => imported.get(key) || null,
    create: async (key, record) => { imported.set(key, record); return record; } }, webcrypto);
  await restored.restore(file, PASSPHRASE); assert.equal(await restored.open(envelope), 'synthetic encrypted original character');
  assert.equal(f.records.get(SCOPE), f.original); assert.equal(f.writes(), 1); f.assertReadOnly(); f.core.close();
});

test('invalid private input and unknown handles never export recovery data', async () => {
  const f = await fixture(), item = await candidate(f);
  for (const passphrase of ['', 'short', 'x'.repeat(4097), null]) {
    assert.deepEqual(await f.core.backup({ handle: item.handle, passphrase, consent: true }), { status: 'invalid_passphrase' });
  }
  const outcome = await f.core.backup({ handle: 'unknown', passphrase: PASSPHRASE, consent: true });
  assert(['changed', 'unavailable'].includes(outcome.status)); assert(!('recovery' in outcome)); f.assertReadOnly(); f.core.close();
});

test('corrupt or mismatched protected records fail closed with no record details', async () => {
  for (const defect of ['ciphertext', 'iv', 'version', 'wrapping', 'publicKey']) {
    const f = await fixture();
    const record = { ...f.original };
    if (defect === 'ciphertext') record.ciphertext = new Uint8Array(48).buffer;
    if (defect === 'iv') record.iv = new Uint8Array(11);
    if (defect === 'version') record.version = 2;
    if (defect === 'wrapping') record.wrappingKey = { extractable: true, algorithm: { name: 'AES-GCM', length: 256 } };
    if (defect === 'publicKey') record.publicKey = 'private-malformed-fixture-record';
    f.records.set(SCOPE, record);
    const checked = await f.core.check({ consent: true });
    if (checked.status === 'candidates') {
      const result = await f.core.backup({ handle: checked.candidates[0].handle, passphrase: PASSPHRASE, consent: true });
      assert.notEqual(result.status, 'backup_ready'); assert(!('recovery' in result));
    } else assert(['unavailable', 'no_candidate'].includes(checked.status));
    assert(!JSON.stringify(checked).includes('private-malformed-fixture-record')); f.assertReadOnly(); f.core.close();
  }
});

test('a changed public key or changed same-key ciphertext invalidates the selected candidate', async () => {
  for (const change of ['publicKey', 'ciphertext', 'iv', 'removed']) {
    const f = await fixture(), item = await candidate(f), record = { ...f.original };
    if (change === 'publicKey') record.publicKey = Buffer.alloc(32, 7).toString('base64');
    if (change === 'ciphertext') record.ciphertext = new Uint8Array(48).buffer;
    if (change === 'iv') record.iv = new Uint8Array(12);
    if (change === 'removed') f.records.delete(SCOPE); else f.records.set(SCOPE, record);
    const result = await f.core.backup({ handle: item.handle, passphrase: PASSPHRASE, consent: true });
    assert.deepEqual(result, { status: 'changed' }); f.assertReadOnly(); f.core.close();
  }
});

test('same-key ciphertext changed while SDK encryption runs cannot produce a late download', async () => {
  const gate = guardedCrypto(), f = await fixture({ crypto: gate.crypto }), item = await candidate(f);
  const pending = f.core.backup({ handle: item.handle, passphrase: PASSPHRASE, consent: true });
  await gate.started.promise; f.records.set(SCOPE, { ...f.original, ciphertext: new Uint8Array(48).buffer }); gate.released.resolve();
  assert.deepEqual(await pending, { status: 'changed' }); f.assertReadOnly(); f.core.close();
});

test('cancel and close during nonabortable SDK encryption discard every late result', async () => {
  for (const operation of ['cancel', 'close']) {
    const gate = guardedCrypto(), f = await fixture({ crypto: gate.crypto }), item = await candidate(f);
    const pending = f.core.backup({ handle: item.handle, passphrase: PASSPHRASE, consent: true });
    await gate.started.promise; f.core[operation](); gate.released.resolve();
    assert.deepEqual(await pending, { status: 'cancelled' }); assert.equal(f.records.get(SCOPE), f.original); f.assertReadOnly(); f.core.close();
  }
});

test('cancellation while the database presence read is pending never opens a database', async () => {
  const db = syntheticDatabase(), gate = deferred(); db.indexedDB.databases = async () => { await gate.promise; return [{ name: KEY_DATABASE }]; };
  const core = createOfflineKeyRecovery({ publicScope: PUBLIC, origin: RECOVERY_ORIGIN, indexedDB: db.indexedDB, crypto: webcrypto });
  const pending = core.check({ consent: true }); core.cancel(); gate.resolve();
  assert.deepEqual(await pending, { status: 'cancelled' }); assert(!db.calls.some(call => call.operation === 'open')); core.close();
});

test('offline export passes current game encrypted index and profile proof without persistent or remote writes', async () => {
  const f = await fixture(), item = await candidate(f), { recovery: file } = await f.core.backup({ handle: item.handle, passphrase: PASSPHRASE, consent: true });
  const indexGraph = await playerProfileIndexGraphIri(OWNER, webcrypto), graph = 'urn:graph:hallowmarch:offline-fixture-profile';
  const encrypted = new Map([
    [indexGraph, await f.vault.seal(JSON.stringify({ schema: 'hallowmarch.player-profile-index/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch', profileGraphIri: graph }))],
    [graph, await f.vault.seal(JSON.stringify({ schema: 'hallowmarch.player-profile/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch',
      save: { v: 1, char: { name: 'Synthetic original hero', level: 12, realm: 1, cls: 'mage', rp: 42 } } }))],
  ]);
  const head = graphIri => ({ descriptorUrl: POD + 'context-graphs/' + (graphIri === indexGraph ? 'index' : 'profile') + '.ttl',
    cid: 'sha256:' + 'a'.repeat(64), ...(graphIri === indexGraph ? {} : { nativeRevision: 'sha256:' + 'b'.repeat(64), recordCid: 'graph-nquads-sha256:' + 'c'.repeat(64) }) });
  let writes = 0;
  const game = createRetainedCharacterRecovery({ binding: { subjectDid: OWNER, podUrl: POD }, relayUrl: PUBLIC.relayOrigins[0], crypto: webcrypto,
    credential: { kind: 'relay-oauth-bearer', accessToken: 'synthetic-offline-proof-token', expiresAt: Date.now() + 600000 },
    keyStorage: { load: async () => null, create: async () => { writes++; throw Error('No key may persist before proof and owner selection.'); } },
    candidateSource: { list: async () => [], openVault: () => assert.fail('Only the explicitly imported file may be tried.') },
    createClient: options => ({ connect: async () => ({ ownerDid: OWNER, podUrl: POD }),
      currentHead: async ({ graphIri }) => encrypted.has(graphIri) ? head(graphIri) : null,
      load: async ({ graphIri }) => encrypted.has(graphIri) ? { graphIri, head: head(graphIri), digest: 'synthetic-authenticated-record',
        record: JSON.parse(await options.vault.open(encrypted.get(graphIri))) } : null,
      close() {}, createKey: () => assert.fail('No key generation'), createAt: () => assert.fail('No pod write') }) });
  try {
    assert.equal((await game.restore(file, 'wrong synthetic phrase')).status, 'unavailable'); assert.equal(writes, 0);
    const result = await game.restore(file, PASSPHRASE); assert.equal(result.status, 'verified_character');
    assert.deepEqual(result.summary, { name: 'Synthetic original hero', level: 12, realm: 1, calling: 'mage', realmPoints: 42 });
    assert.equal(writes, 0); assert(!JSON.stringify(result).includes(file.ciphertext)); assert(!JSON.stringify(result).includes(SCOPE));
  } finally { game.close(); f.core.close(); }
});
