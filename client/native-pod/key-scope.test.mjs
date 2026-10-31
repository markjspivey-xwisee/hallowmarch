import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';
globalThis.self = { crypto: webcrypto };
const { ClientKeyVault } = await import('./vendor/interego-browser.mjs');
const { adoptRetainedKey, createOwnerKeyVault, parseOwnerKeyScope } = await import('./key-scope.mjs');

const owner = 'did:web:identity.example:users:u-pk-recovery';
const scope = relay => JSON.stringify(['interego-client-key/v1', relay, owner, 'u-pk-recovery']);
const current = scope('https://relay.example'), previous = scope('https://old-relay.example');
function storage() {
  const records = new Map(); let writes = 0;
  return { records, get writes() { return writes; },
    load: async key => records.get(key) || null,
    async create(key, value, context = {}) {
      if (context.signal?.aborted || context.isCurrent && !context.isCurrent()) throw Object.assign(Error('Cancelled'), { code: 'cancelled' });
      if (context.absentKeys?.some(address => records.has(address))) throw Object.assign(Error('Key selection changed'), { code: 'key_scope_changed' });
      if (!records.has(key)) { records.set(key, value); writes++; }
      return records.get(key);
    } };
}
async function fixture() {
  const keyStorage = storage(), original = new ClientKeyVault(previous, keyStorage, webcrypto);
  const publicKey = await original.create(), envelope = await original.seal('private fixture character');
  return { keyStorage, original, publicKey, envelope, scope: current, sourceScope: previous, crypto: webcrypto };
}
const ownerVault = keyStorage => createOwnerKeyVault({ scope: current, keyStorage, crypto: webcrypto });

test('ordinary canonical vault creation and encryption are unchanged', async () => {
  const keyStorage = storage(), vault = ownerVault(keyStorage);
  assert.equal(await vault.publicKey(), null);
  const key = await vault.create();
  assert.equal(await vault.publicKey(), key);
  const before = keyStorage.writes; assert.equal(await vault.create(), key); assert.equal(keyStorage.writes, before);
  assert.equal(await vault.open(await vault.seal('ordinary fixture')), 'ordinary fixture');
  assert.equal(keyStorage.records.size, 1);
});
test('explicit recovery stores only a public link and keeps the original protected key', async () => {
  const f = await fixture(), original = f.keyStorage.records.get(previous);
  assert.deepEqual(await adoptRetainedKey(f), { adopted: true });
  assert.equal(f.keyStorage.records.get(previous), original);
  assert.equal(f.keyStorage.records.has(current), false);
  assert.equal(f.keyStorage.records.size, 2);
  const alias = [...f.keyStorage.records.values()].find(value => value.schema);
  assert.deepEqual(Object.keys(alias).sort(), ['publicKey', 'schema', 'sourceScope']);
  const reloaded = ownerVault(f.keyStorage);
  assert.equal(await reloaded.publicKey(), f.publicKey);
  assert.equal(await reloaded.open(f.envelope), 'private fixture character');
  assert.equal(await f.original.open(await reloaded.seal('same key')), 'same key');
});
test('backup retains its authenticated original scope and restores through the public SDK', async () => {
  const f = await fixture(); await adoptRetainedKey(f);
  const backup = await ownerVault(f.keyStorage).backup('fixture recovery passphrase');
  assert.equal(backup.scope, previous);
  const elsewhere = storage(), restored = new ClientKeyVault(previous, elsewhere, webcrypto);
  await restored.restore(backup, 'fixture recovery passphrase');
  await adoptRetainedKey({ ...f, keyStorage: elsewhere });
  assert.equal(await ownerVault(elsewhere).open(f.envelope), 'private fixture character');
});
test('canonical target key is preserved and takes precedence over a recovery link', async () => {
  const f = await fixture(); await adoptRetainedKey(f);
  const canonical = new ClientKeyVault(current, f.keyStorage, webcrypto), key = await canonical.create();
  await assert.rejects(adoptRetainedKey(f), { code: 'key_exists' });
  assert.equal(await ownerVault(f.keyStorage).publicKey(), key);
});
test('a concurrent canonical insert wins and no key is overwritten', async () => {
  const f = await fixture(), insert = f.keyStorage.create.bind(f.keyStorage);
  const canonicalStore = storage(), canonical = new ClientKeyVault(current, canonicalStore, webcrypto);
  const key = await canonical.create();
  f.keyStorage.create = async (address, value, context) => {
    f.keyStorage.records.set(current, canonicalStore.records.get(current));
    return insert(address, value, context);
  };
  await assert.rejects(adoptRetainedKey(f), { code: 'key_scope_changed' });
  assert.equal(f.keyStorage.records.size, 2, 'A refused recovery leaves no public alias behind.');
  assert.equal(await ownerVault(f.keyStorage).publicKey(), key);
  assert.equal(await f.original.publicKey(), f.publicKey);
});
test('alias cannot cross an owner or pod, and invalid relay origins are refused', async () => {
  for (const sourceScope of [
    JSON.stringify(['interego-client-key/v1', 'https://old-relay.example', owner + '-other', 'u-pk-recovery']),
    JSON.stringify(['interego-client-key/v1', 'https://old-relay.example', owner, 'another-pod']),
    scope('http://old-relay.example'), scope('https://old-relay.example/path'), current,
  ]) {
    const f = await fixture();
    await assert.rejects(adoptRetainedKey({ ...f, sourceScope }), { code: 'invalid_recovery_link' });
    assert.equal(f.keyStorage.records.size, 1);
  }
  assert.equal(parseOwnerKeyScope('not JSON'), null);
});
test('a corrupt source does not install a recovery link', async () => {
  const f = await fixture(), record = f.keyStorage.records.get(previous);
  const changed = new Uint8Array(record.ciphertext.slice(0)); changed[0] ^= 1;
  f.keyStorage.records.set(previous, { ...record, ciphertext: changed.buffer });
  await assert.rejects(adoptRetainedKey(f));
  assert.equal(f.keyStorage.records.size, 1);
});
test('missing retained source never silently generates a replacement key', async () => {
  const f = await fixture(); await adoptRetainedKey(f);
  const vault = ownerVault(f.keyStorage); await vault.publicKey();
  f.keyStorage.records.delete(previous);
  await assert.rejects(vault.create(), { code: 'key_required' });
  await assert.rejects(vault.publicKey(), { code: 'key_required' });
  await assert.rejects(vault.open(f.envelope), { code: 'key_required' });
  await assert.rejects(vault.seal('must not invent a missing source key'), { code: 'key_required' });
  await assert.rejects(vault.backup('fixture recovery passphrase'), { code: 'key_required' });
  await assert.rejects(ownerVault(f.keyStorage).publicKey(), { code: 'key_required' });
  assert.equal(f.keyStorage.records.has(current), false);
  assert.equal(f.keyStorage.records.has(previous), false);
});
test('aborted or changed-owner activations cannot create a recovery link', async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(adoptRetainedKey({ ...f, signal: controller.signal }), { code: 'cancelled' });
  await assert.rejects(adoptRetainedKey({ ...f, isCurrent: () => false }), { code: 'cancelled' });
  let active = true; const insert = f.keyStorage.create.bind(f.keyStorage);
  f.keyStorage.create = async (address, value, context) => { active = false; return insert(address, value, context); };
  await assert.rejects(adoptRetainedKey({ ...f, isCurrent: () => active }), { code: 'cancelled' });
  assert.equal(f.keyStorage.records.size, 1);
});

async function rejectsStaleOperations(vault, envelope, backup) {
  const operations = [() => vault.publicKey(), () => vault.open(envelope), () => vault.seal('must not encrypt with a changed key'),
    () => vault.backup('fixture private recovery passphrase'), () => vault.create()];
  if (backup) operations.push(() => vault.restore(backup, 'fixture private recovery passphrase'));
  for (const operation of operations) await assert.rejects(operation(), { code: 'key_scope_changed' });
}

test('a selected alias refuses a later valid source-key replacement for every ordinary operation', async () => {
  const f = await fixture(); await adoptRetainedKey(f);
  const vault = ownerVault(f.keyStorage); assert.equal(await vault.publicKey(), f.publicKey);
  const backup = await vault.backup('fixture private recovery passphrase');
  const replacementStore = storage(), replacementVault = new ClientKeyVault(previous, replacementStore, webcrypto);
  const replacementKey = await replacementVault.create(), replacement = replacementStore.records.get(previous);
  assert.notEqual(replacementKey, f.publicKey); f.keyStorage.records.set(previous, replacement);
  const writes = f.keyStorage.writes;
  await rejectsStaleOperations(vault, f.envelope, backup);
  assert.equal(f.keyStorage.writes, writes); assert.equal(f.keyStorage.records.get(previous), replacement);
  assert.equal(f.keyStorage.records.has(current), false);
});

test('a different canonical key appearing after alias selection fences the old client while fresh clients use canonical', async () => {
  const f = await fixture(); await adoptRetainedKey(f);
  const vault = ownerVault(f.keyStorage); assert.equal(await vault.publicKey(), f.publicKey);
  const backup = await vault.backup('fixture private recovery passphrase'), original = f.keyStorage.records.get(previous);
  const canonicalStore = storage(), canonical = new ClientKeyVault(current, canonicalStore, webcrypto);
  const canonicalKey = await canonical.create(), canonicalEnvelope = await canonical.seal('concurrent canonical character');
  const canonicalRecord = canonicalStore.records.get(current); f.keyStorage.records.set(current, canonicalRecord);
  const writes = f.keyStorage.writes;
  await rejectsStaleOperations(vault, f.envelope, backup);
  assert.equal(f.keyStorage.writes, writes); assert.equal(f.keyStorage.records.get(previous), original);
  assert.equal(f.keyStorage.records.get(current), canonicalRecord);
  const reopened = ownerVault(f.keyStorage); assert.equal(await reopened.publicKey(), canonicalKey);
  assert.equal(await reopened.open(canonicalEnvelope), 'concurrent canonical character');
});

test('an alias activated after empty resolution prevents the old client from creating a new canonical key', async () => {
  const f = await fixture(), vault = ownerVault(f.keyStorage), original = f.keyStorage.records.get(previous);
  assert.equal(await vault.publicKey(), null); await adoptRetainedKey(f);
  const writes = f.keyStorage.writes, alias = f.keyStorage.records.get('hallowmarch-key-scope/v1:' + current);
  await rejectsStaleOperations(vault, f.envelope);
  assert.equal(f.keyStorage.writes, writes); assert.equal(f.keyStorage.records.has(current), false);
  assert.equal(f.keyStorage.records.get(previous), original); assert.equal(f.keyStorage.records.get('hallowmarch-key-scope/v1:' + current), alias);
  assert.equal(await ownerVault(f.keyStorage).open(f.envelope), 'private fixture character');
});

test('an alias that wins immediately before canonical insertion is checked in the same storage create operation', async () => {
  const f = await fixture(), vault = ownerVault(f.keyStorage), original = f.keyStorage.records.get(previous);
  assert.equal(await vault.publicKey(), null);
  const aliasAddress = 'hallowmarch-key-scope/v1:' + current, insert = f.keyStorage.create.bind(f.keyStorage), writes = f.keyStorage.writes;
  let absenceGuard;
  f.keyStorage.create = async (address, value, context) => {
    if (address === current) {
      absenceGuard = context?.absentKeys;
      f.keyStorage.records.set(aliasAddress, { schema: 'hallowmarch-key-scope/v1', sourceScope: previous, publicKey: f.publicKey });
    }
    return insert(address, value, context);
  };
  await assert.rejects(vault.create(), { code: 'key_scope_changed' });
  assert(Array.isArray(absenceGuard) && absenceGuard.includes(aliasAddress)); assert.equal(f.keyStorage.records.has(current), false);
  assert.equal(f.keyStorage.records.get(previous), original); assert.equal(f.keyStorage.writes, writes);
  assert.equal(await ownerVault(f.keyStorage).open(f.envelope), 'private fixture character');
});

test('a canonical key created by an empty client is pinned against later replacement', async () => {
  const keyStorage = storage(), vault = ownerVault(keyStorage);
  assert.equal(await vault.publicKey(), null); const originalKey = await vault.create();
  const envelope = await vault.seal('original canonical character'), backup = await vault.backup('fixture private recovery passphrase');
  const replacementStore = storage(), replacementVault = new ClientKeyVault(current, replacementStore, webcrypto);
  const replacementKey = await replacementVault.create(), replacementEnvelope = await replacementVault.seal('replacement canonical character');
  assert.notEqual(replacementKey, originalKey); const replacement = replacementStore.records.get(current);
  keyStorage.records.set(current, replacement); const writes = keyStorage.writes;
  await rejectsStaleOperations(vault, envelope, backup);
  assert.equal(keyStorage.writes, writes); assert.equal(keyStorage.records.get(current), replacement);
  const reopened = ownerVault(keyStorage); assert.equal(await reopened.publicKey(), replacementKey);
  assert.equal(await reopened.open(replacementEnvelope), 'replacement canonical character');
});

test('repeating the same validated alias selection preserves its protected source and public link', async () => {
  const f = await fixture(); await adoptRetainedKey(f);
  const original = f.keyStorage.records.get(previous), alias = f.keyStorage.records.get('hallowmarch-key-scope/v1:' + current), writes = f.keyStorage.writes;
  assert.deepEqual(await adoptRetainedKey(f), { adopted: true });
  assert.equal(f.keyStorage.records.get(previous), original); assert.equal(f.keyStorage.records.get('hallowmarch-key-scope/v1:' + current), alias);
  assert.equal(f.keyStorage.writes, writes);
  const vault = ownerVault(f.keyStorage); assert.equal(await vault.create(), f.publicKey);
  assert.equal(await vault.open(await vault.seal('unchanged retained key')), 'unchanged retained key');
  assert.equal(f.keyStorage.writes, writes);
});
