import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openNativeQaCheckpoint, nativeQaCheckpointFailureCode } from './native-qa-checkpoint.mjs';

const scope = { gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example', identityOrigin: 'https://identity.example',
  agentDid: 'did:web:identity.example:agents:synthetic-qa', agentPodUrl: 'https://pods.example/synthetic-agent/' };
const credentialId = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const credential = { credentialId: Buffer.from(credentialId, 'base64url').toString('base64'),
  privateKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  rpId: 'relay.example', userHandle: Buffer.from('synthetic-checkpoint-user').toString('base64'), isResidentCredential: true, signCount: 0 };
const owner = { userId: 'u-pk-eb9f16800c90', subjectDid: 'did:web:identity.example:users:u-pk-eb9f16800c90',
  podUrl: 'https://pods.example/u-pk-eb9f16800c90/', accountId: 'synthetic-qa-account' };
const recovery = { format: 'interego-client-key', version: 1,
  scope: JSON.stringify(['interego-client-key/v1', scope.relayOrigin, owner.subjectDid, owner.userId]),
  publicKey: Buffer.alloc(32, 1).toString('base64'), kdf: 'PBKDF2-SHA256', iterations: 600000,
  salt: Buffer.alloc(16, 2).toString('base64'), iv: Buffer.alloc(12, 3).toString('base64'), ciphertext: Buffer.alloc(48, 4).toString('base64') };
function fixture() {
  const run = '20261017000000000-abcdef12', characterName = 'QA Native abcdef12';
  return { run, displayName: 'Hallowmarch QA native E2E ' + run, characterName, room: 'native-qa-abcdef12', ...scope,
    expectedSave: { v: 1,
      char: { name: characterName, realm: 0, cls: 'warrior', level: 1, xp: 0, rp: 0, kills: 0, realmKills: 0, deaths: 0, played: 0,
        bounty: null, pos: null, gold: 0, potions: 0, bag: [], eq: {}, lore: null, gift: {}, x: {} },
      settings: { quality: 'low', auto: false, tod: 'morning', sound: false, weather: 'clear' },
      qa: { run, privateMarker: 'private-native-qa-' + '12'.repeat(24), purpose: 'Synthetic owner-pod persistence verification', authoritativeGameOutcome: false } },
    passphrase: Buffer.alloc(32, 5).toString('base64url') };
}
const profile = { kind: 'profile', graphIri: 'urn:graph:client-owned:11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222', digest: 'graph-nquads-sha256:' + 'a'.repeat(64) };
const index = { kind: 'index', graphIri: 'urn:graph:hallowmarch:player-profile-index:' + createHash('sha256').update(owner.subjectDid).digest('hex'),
  operationId: '33333333-3333-4333-8333-333333333333', digest: 'graph-nquads-sha256:' + 'b'.repeat(64) };
const reference = { grantId: 'urn:uuid:44444444-4444-4444-8444-444444444444',
  graphIri: 'urn:graph:interego:gaming:owner-agent-grant:44444444-4444-4444-8444-444444444444' };
function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-checkpoint-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let count = 0;
  return () => path.join(root, 'case-' + ++count);
}
function open(directory, changes = {}) { return openNativeQaCheckpoint({ directory, mode: 'new', fixture: fixture(), expectedScope: scope, ...changes }); }
function resume(directory, changes = {}) { return openNativeQaCheckpoint({ directory, mode: 'resume', expectedScope: scope, ...changes }); }
function resumeUnregistered(directory, changes = {}) {
  return openNativeQaCheckpoint({ directory, mode: 'resume-unregistered', expectedScope: scope, ...changes });
}
function populate(store) { store.recordRegistrationIntent(); store.recordCredential(credential); store.recordOwner(owner); store.recordRecovery(recovery); return store; }
function refused(action, code) {
  assert.throws(action, error => error.code === 'qa_checkpoint_' + code && error.message === 'Native QA checkpoint refused.'
    && !Object.hasOwn(error, 'cause'));
}

test('requires explicit tmp path, exact configuration and a pinned HTTPS scope', t => {
  const directory = sandbox(t)();
  refused(() => openNativeQaCheckpoint(), 'transition_refused');
  refused(() => openNativeQaCheckpoint({ mode: 'new', fixture: fixture(), expectedScope: scope }), 'transition_refused');
  refused(() => open('relative'), 'path_refused');
  refused(() => open(os.tmpdir()), 'path_refused');
  refused(() => open(path.resolve('tools/manual/qa-private')), 'path_refused');
  refused(() => open(directory, { mode: 'replace' }), 'configuration');
  refused(() => open(directory, { expectedScope: { ...scope, gameOrigin: 'https://foreign.example' } }), 'scope_mismatch');
  refused(() => open(directory, { expectedScope: { ...scope, accessToken: 'DO_NOT_ACCEPT' } }), 'transition_refused');
  refused(() => open(directory, { expectedScope: { ...scope, relayOrigin: 'http://relay.example' } }), 'transition_refused');
});

test('failure-code mapper admits only its fixed codes without returning error text', () => {
  assert.equal(nativeQaCheckpointFailureCode({ code: 'qa_checkpoint_write_failed', message: 'PRIVATE' }), 'qa_checkpoint_write_failed');
  assert.equal(nativeQaCheckpointFailureCode({ code: 'qa_checkpoint_PRIVATE_SECRET', message: 'PRIVATE' }), null);
  assert.equal(nativeQaCheckpointFailureCode(new Error('PRIVATE')), null);
  assert.equal(nativeQaCheckpointFailureCode(null), null);
  assert.equal(nativeQaCheckpointFailureCode({ get code() { throw new Error('PRIVATE'); } }), null);
});

test('uses private owned files, snapshots are detached and new refuses an existing checkpoint', t => {
  const directory = sandbox(t)(), store = open(directory);
  t.after(() => store.close());
  assert.equal(fs.statSync(directory).mode & 0o7777, 0o700);
  for (const filename of ['checkpoint.json', 'writer.lock']) {
    const stat = fs.statSync(path.join(directory, filename)); assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.uid, process.getuid());
  }
  const initial = store.snapshot(); assert.equal(initial.revision, 1); assert.equal(initial.credential, null);
  initial.fixture.passphrase = 'CHANGED'; initial.lifecycle.grantMayExist = true;
  assert.notEqual(store.snapshot().fixture.passphrase, 'CHANGED'); assert.equal(store.snapshot().lifecycle.grantMayExist, false);
  store.close(); assert(!fs.existsSync(path.join(directory, 'writer.lock')));
  refused(() => open(directory), 'exists'); assert(!fs.existsSync(path.join(directory, 'writer.lock')));
  refused(() => store.snapshot(), 'closed');
});

test('refuses unsafe existing permissions, symlink components, repo and Library paths', t => {
  const next = sandbox(t), directory = next(); fs.mkdirSync(directory, { mode: 0o755 });
  refused(() => open(directory), 'permissions_refused'); assert.equal(fs.statSync(directory).mode & 0o777, 0o755);
  const safe = next(), store = populate(open(safe)); store.close(); fs.chmodSync(path.join(safe, 'checkpoint.json'), 0o644);
  refused(() => resume(safe), 'permissions_refused'); assert.equal(fs.statSync(path.join(safe, 'checkpoint.json')).mode & 0o777, 0o644);
  const link = next(); fs.symlinkSync(safe, link); refused(() => resume(link), 'path_refused');
  refused(() => open(path.join(link, 'nested')), 'path_refused');
  const repo = next(); fs.mkdirSync(repo, { mode: 0o700 }); fs.writeFileSync(path.join(repo, '.git'), 'gitdir: synthetic');
  refused(() => open(path.join(repo, 'secrets')), 'path_refused');
  refused(() => open(path.join(path.dirname(repo), 'Library', 'secrets')), 'path_refused');
  const unsafeParent = next(); fs.mkdirSync(unsafeParent, { mode: 0o700 }); fs.chmodSync(unsafeParent, 0o777);
  refused(() => open(path.join(unsafeParent, 'secrets')), 'path_refused');
  assert.equal(fs.statSync(unsafeParent).mode & 0o777, 0o777);
});

test('refuses foreign ownership metadata without attempting an ownership repair', t => {
  const next = sandbox(t), directory = next(); fs.mkdirSync(directory, { mode: 0o700 });
  const other = next(); fs.mkdirSync(other, { mode: 0o700 });
  const file = path.join(other, 'checkpoint.json'); fs.writeFileSync(file, '{}', { mode: 0o600 });
  // This runtime maps only one uid, so inject foreign ownership at the stat
  // boundary rather than changing real file ownership or moving QA secrets.
  const originalLstat = fs.lstatSync, originalChown = fs.chownSync; let repairs = 0;
  try {
    fs.lstatSync = (target, ...args) => { const stat = originalLstat(target, ...args);
      if (target === directory || target === file) stat.uid = process.getuid() + 1; return stat; };
    fs.chownSync = () => { repairs++; throw new Error('Ownership must not be repaired.'); };
    refused(() => open(directory), 'permissions_refused'); refused(() => resume(other), 'permissions_refused');
    assert.equal(repairs, 0);
  } finally { fs.lstatSync = originalLstat; fs.chownSync = originalChown; }
});

test('exclusive writer is never automatically broken, including an empty or stale lock', t => {
  const next = sandbox(t), directory = next(), store = open(directory); t.after(() => store.close());
  refused(() => open(directory), 'writer_conflict'); refused(() => resume(directory), 'writer_conflict');
  store.close(); const lock = path.join(directory, 'writer.lock'); fs.writeFileSync(lock, '', { mode: 0o600 });
  refused(() => resume(directory), 'writer_conflict'); assert.equal(fs.readFileSync(lock, 'utf8'), '');
  fs.unlinkSync(lock);
  const other = next(); fs.writeFileSync(other, 'synthetic'); fs.symlinkSync(other, lock);
  refused(() => resume(directory), 'writer_conflict'); assert(fs.lstatSync(lock).isSymbolicLink());
});

test('a removed/replaced lock poisons the first writer and its close preserves the new writer lock', t => {
  const directory = sandbox(t)(), first = populate(open(directory));
  const lock = path.join(directory, 'writer.lock'); fs.unlinkSync(lock);
  const second = resume(directory); t.after(() => second.close());
  const newLock = fs.statSync(lock).ino;
  refused(() => first.recordCredential({ ...credential, signCount: 2 }), 'corrupt');
  refused(() => first.snapshot(), 'closed'); first.close();
  assert.equal(fs.statSync(lock).ino, newLock);
  second.recordCredential({ ...credential, signCount: 3 }); assert.equal(second.snapshot().credential.signCount, 3);
});

test('resume missing, corrupt, unknown schema, secret fields and incomplete original owner all refuse', t => {
  const next = sandbox(t);
  refused(() => resume(next()), 'missing');
  const incomplete = next(), store = open(incomplete); store.close(); refused(() => resume(incomplete), 'unrecoverable');
  const variants = [
    () => '{secret:unparseable',
    value => ({ ...value, schema: 'unknown/v1' }),
    value => ({ ...value, version: 2 }),
    value => ({ ...value, revision: 0 }),
    value => ({ ...value, accessToken: 'DO_NOT_ACCEPT' }),
    value => ({ ...value, fixture: { ...value.fixture, accessToken: 'DO_NOT_ACCEPT' } }),
    value => ({ ...value, credential: { ...value.credential, refreshToken: 'DO_NOT_ACCEPT' } }),
    value => ({ ...value, owner: { ...value.owner, signedEnvelope: 'DO_NOT_ACCEPT' } }),
    value => ({ ...value, recovery: { ...value.recovery, privateKey: 'DO_NOT_ACCEPT' } }),
    value => ({ ...value, fixture: { ...value.fixture, expectedSave: { ...value.fixture.expectedSave, token: 'DO_NOT_ACCEPT' } } }),
    value => ({ ...value, lifecycle: { ...value.lifecycle, token: 'DO_NOT_ACCEPT' } }),
  ];
  for (const variant of variants) {
    const directory = next(), populated = populate(open(directory)), value = populated.snapshot(); populated.close();
    const changed = variant(value); fs.writeFileSync(path.join(directory, 'checkpoint.json'), typeof changed === 'string' ? changed : JSON.stringify(changed));
    refused(() => resume(directory), 'corrupt'); assert(!fs.existsSync(path.join(directory, 'writer.lock')));
  }
});

test('explicit unregistered resume preserves the exact stored fixture and continues its first registration lane', t => {
  const directory = sandbox(t)(), original = open(directory), initial = original.snapshot(); original.close();
  const filename = path.join(directory, 'checkpoint.json'), before = fs.readFileSync(filename);
  refused(() => resume(directory), 'unrecoverable');
  const store = resumeUnregistered(directory); t.after(() => store.close());
  assert.deepEqual(store.snapshot(), initial); assert.deepEqual(fs.readFileSync(filename), before);
  assert.deepEqual(store.snapshot().fixture, fixture());
  populate(store); store.recordPublication(profile); store.recordPublication(index);
  assert.deepEqual(store.snapshot().fixture, initial.fixture); assert.deepEqual(store.snapshot().credential, credential);
  assert.deepEqual(store.snapshot().publications, [profile, index]);
  store.recordLifecycle({ kind: 'main-world-grant-intent' }); assert.equal(store.snapshot().lifecycle.grantMayExist, true);
  store.close(); refused(() => resumeUnregistered(directory), 'lifecycle_blocked');
});

test('unregistered resume refuses every partial registration or later state without resetting the file', t => {
  const next = sandbox(t), steps = [
    store => store.recordRegistrationIntent(),
    store => { store.recordRegistrationIntent(); store.recordCredential(credential); },
    store => { store.recordRegistrationIntent(); store.recordCredential(credential); store.recordOwner(owner); },
    store => populate(store),
    store => { populate(store); store.recordPublication(profile); },
    store => { populate(store); store.recordLifecycle({ kind: 'main-world-grant-intent' }); },
    store => { populate(store); store.recordLifecycle({ kind: 'main-world-grant-intent' }); store.recordLifecycle({ kind: 'main-world-grant-reference', reference }); },
    store => { populate(store); store.recordLifecycle({ kind: 'main-world-grant-intent' }); store.recordLifecycle({ kind: 'main-world-grant-reference', reference }); store.recordLifecycle({ kind: 'main-world-revoked' }); },
    store => { populate(store); store.recordLifecycle({ kind: 'coaching-delivery-intent' }); },
  ];
  for (let index = 0; index < steps.length; index++) {
    const directory = next(), store = open(directory); steps[index](store); store.close();
    const filename = path.join(directory, 'checkpoint.json'), before = fs.readFileSync(filename);
    refused(() => resumeUnregistered(directory), index >= 5 ? 'lifecycle_blocked' : 'unrecoverable');
    assert.deepEqual(fs.readFileSync(filename), before); assert(!fs.existsSync(path.join(directory, 'writer.lock')));
  }
});

test('unregistered resume requires the existing exact-scope fixture with no defaults or replacement', t => {
  const next = sandbox(t); refused(() => resumeUnregistered(next()), 'missing');
  const emptyDirectory = next(); fs.mkdirSync(emptyDirectory, { mode: 0o700 });
  refused(() => resumeUnregistered(emptyDirectory), 'missing'); assert.deepEqual(fs.readdirSync(emptyDirectory), []);
  const directory = next(), store = open(directory); store.close();
  const filename = path.join(directory, 'checkpoint.json'), before = fs.readFileSync(filename);
  refused(() => resumeUnregistered(directory, { expectedScope: { ...scope, gameOrigin: 'https://foreign.example' } }), 'scope_mismatch');
  refused(() => resumeUnregistered(directory, { fixture: { ...fixture(), passphrase: Buffer.alloc(32, 9).toString('base64url') } }), 'scope_mismatch');
  refused(() => open(directory), 'exists'); assert.deepEqual(fs.readFileSync(filename), before);
  const reopened = resumeUnregistered(directory, { fixture: fixture() }); reopened.close();
});

test('unregistered resume keeps the same permission, symlink and exclusive-writer guards', t => {
  const next = sandbox(t), directory = next(), store = open(directory);
  refused(() => resumeUnregistered(directory), 'writer_conflict'); store.close();
  const filename = path.join(directory, 'checkpoint.json'); fs.chmodSync(filename, 0o644);
  refused(() => resumeUnregistered(directory), 'permissions_refused'); fs.chmodSync(filename, 0o600);
  const link = next(); fs.symlinkSync(directory, link); refused(() => resumeUnregistered(link), 'path_refused');
  const reopened = resumeUnregistered(directory); reopened.close();
});

test('credentials require durable registration intent, real PKCS8, canonical base64 and pinned relying party', t => {
  const store = open(sandbox(t)()); t.after(() => store.close());
  refused(() => store.recordCredential(credential), 'transition_refused'); store.recordRegistrationIntent();
  for (const changed of [
    { ...credential, privateKey: Buffer.from('not-a-private-key').toString('base64') },
    { ...credential, privateKey: credential.privateKey + '\n' },
    { ...credential, credentialId: credential.credentialId.replace(/=+$/, '') },
    { ...credential, rpId: 'foreign.example' }, { ...credential, isResidentCredential: false },
    { ...credential, userHandle: '' }, { ...credential, signCount: -1 }, { ...credential, signCount: 0x100000000 },
    { ...credential, accessToken: 'DO_NOT_ACCEPT' },
  ]) refused(() => store.recordCredential(changed), 'transition_refused');
  store.recordCredential(credential); assert.deepEqual(store.snapshot().credential, credential);
});

test('immutable passkey fields cannot change and assertion counter advances monotonically', t => {
  const store = populate(open(sandbox(t)())); t.after(() => store.close());
  store.recordCredential({ ...credential, signCount: 7 }); const revision = store.snapshot().revision;
  store.recordCredential({ ...credential, signCount: 7 }); assert.equal(store.snapshot().revision, revision);
  refused(() => store.recordCredential({ ...credential, signCount: 6 }), 'transition_refused');
  const secondKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  for (const changed of [{ credentialId: Buffer.alloc(32, 3).toString('base64') }, { privateKey: secondKey },
    { rpId: 'identity.example' }, { userHandle: Buffer.from('another-synthetic-user').toString('base64') }]) {
    refused(() => store.recordCredential({ ...credential, signCount: 8, ...changed }), 'transition_refused');
  }
  assert.equal(store.snapshot().credential.signCount, 7);
});

test('owner uses credential-string hash vector and cannot be substituted', t => {
  const store = open(sandbox(t)()); t.after(() => store.close()); store.recordRegistrationIntent(); store.recordCredential(credential);
  for (const changes of [{ userId: 'u-pk-000000000000' }, { subjectDid: 'did:web:foreign.example:users:' + owner.userId },
    { podUrl: 'https://pods.example/foreign/' }, { podUrl: 'https://pods.example/' + owner.userId + '/?token=private' },
    { accountId: 'account with spaces' }, { accessToken: 'DO_NOT_ACCEPT' }]) refused(() => store.recordOwner({ ...owner, ...changes }), 'transition_refused');
  store.recordOwner(owner); assert.equal(store.snapshot().owner.userId, 'u-pk-eb9f16800c90');
  refused(() => store.recordOwner({ ...owner, accountId: 'another-synthetic-account' }), 'transition_refused');
});

test('recovery shape and scope are exact; original encrypted key cannot be replaced', t => {
  const store = open(sandbox(t)()); t.after(() => store.close());
  refused(() => store.recordRecovery(recovery), 'transition_refused'); store.recordRegistrationIntent(); store.recordCredential(credential); store.recordOwner(owner);
  for (const changes of [{ format: 'different' }, { version: 2 }, { iterations: 1 }, { kdf: 'unapproved' },
    { scope: recovery.scope + ' ' }, { publicKey: Buffer.alloc(31).toString('base64') },
    { salt: Buffer.alloc(15).toString('base64') }, { iv: Buffer.alloc(16).toString('base64') },
    { ciphertext: Buffer.alloc(47).toString('base64') }, { passphrase: 'DO_NOT_ACCEPT' }]) refused(() => store.recordRecovery({ ...recovery, ...changes }), 'transition_refused');
  store.recordRecovery(recovery); refused(() => store.recordRecovery({ ...recovery, ciphertext: Buffer.alloc(48, 6).toString('base64') }), 'transition_refused');
});

test('publication intent requires persisted recovery and contains only pinned safe identifiers', t => {
  const store = open(sandbox(t)()); t.after(() => store.close()); store.recordRegistrationIntent(); store.recordCredential(credential); store.recordOwner(owner);
  refused(() => store.recordPublication(profile), 'transition_refused'); store.recordRecovery(recovery);
  for (const changes of [{ graphIri: 'https://foreign.example/private' }, { operationId: 'not-a-uuid' },
    { digest: 'sha256:' + 'a'.repeat(64) }, { digest: 'graph-nquads-sha256:' + 'A'.repeat(64) },
    { kind: 'coaching' }, { token: 'DO_NOT_ACCEPT' }]) refused(() => store.recordPublication({ ...profile, ...changes }), 'transition_refused');
  store.recordPublication({ ...profile, operationId: 'urn:uuid:' + profile.operationId });
  const revision = store.snapshot().revision; store.recordPublication(profile); assert.equal(store.snapshot().revision, revision);
  refused(() => store.recordPublication({ ...index, graphIri: index.graphIri.replace(/.$/, '0') }), 'transition_refused');
  store.recordPublication(index); assert.deepEqual(store.snapshot().publications, [profile, index]);
  refused(() => store.recordPublication({ ...profile, operationId: '55555555-5555-4555-8555-555555555555' }), 'transition_refused');
});

test('interruption retains the exact updated passkey, owner and encrypted key; stale lock requires explicit handling', t => {
  const directory = sandbox(t)();
  const script = `import fs from 'node:fs'; import { openNativeQaCheckpoint } from ${JSON.stringify(new URL('./native-qa-checkpoint.mjs', import.meta.url).href)};
    const input = JSON.parse(fs.readFileSync(0, 'utf8')); const store = openNativeQaCheckpoint(input.options);
    store.recordRegistrationIntent(); store.recordCredential(input.credential); store.recordCredential({...input.credential, signCount: 19});
    store.recordOwner(input.owner); store.recordRecovery(input.recovery); store.recordPublication(input.profile);
    process.exit(0);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', input: JSON.stringify({
    options: { directory, mode: 'new', fixture: fixture(), expectedScope: scope }, credential, owner, recovery, profile }) });
  assert.equal(child.status, 0); assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
  refused(() => resume(directory), 'writer_conflict');
  // Explicit test-fixture cleanup; the adapter never deletes a stale lock.
  fs.unlinkSync(path.join(directory, 'writer.lock'));
  const store = resume(directory); t.after(() => store.close()); const snapshot = store.snapshot();
  assert.deepEqual(snapshot.credential, { ...credential, signCount: 19 }); assert.deepEqual(snapshot.owner, owner);
  assert.deepEqual(snapshot.recovery, recovery); assert.deepEqual(snapshot.publications, [profile]); assert.deepEqual(snapshot.fixture, fixture());
  assert(!/pass(?:ed)?|complete|stage/i.test(Object.keys(snapshot).join(' ')));
  assert.deepEqual(Object.keys(snapshot), ['schema', 'version', 'revision', 'fixture', 'registrationIntent', 'credential', 'owner', 'recovery', 'publications', 'lifecycle']);
});

test('resume independently pins origin, relay, identity and agent scope', t => {
  const directory = sandbox(t)(), original = populate(open(directory)); original.close();
  for (const [key, value] of [['gameOrigin', 'https://other.example'], ['relayOrigin', 'https://other.example'],
    ['identityOrigin', 'https://other.example'], ['agentDid', 'did:web:identity.example:agents:other'], ['agentPodUrl', 'https://pods.example/other/']]) {
    refused(() => resume(directory, { expectedScope: { ...scope, [key]: value } }), 'scope_mismatch');
  }
  const store = resume(directory); store.close();
});

test('resume permits counter synchronization, exact publication hints and a first durable lifecycle intent', t => {
  const directory = sandbox(t)(), original = populate(open(directory)); original.recordPublication(profile); original.close();
  const store = resume(directory); t.after(() => store.close());
  store.recordCredential({ ...credential, signCount: 2 }); store.recordPublication(profile);
  refused(() => store.recordPublication(index), 'transition_refused');
  assert.deepEqual(store.snapshot().publications, [profile]); assert.equal(store.snapshot().credential.signCount, 2);
  store.recordLifecycle({ kind: 'main-world-grant-intent' }); assert.equal(store.snapshot().lifecycle.grantMayExist, true);
  store.close(); refused(() => resume(directory), 'lifecycle_blocked');
});

test('explicit current-save resume preserves its exact baseline and only synchronizes the original passkey counter', t => {
  const directory = sandbox(t)(), original = populate(open(directory));
  original.recordPublication(profile); original.recordPublication(index); const before = original.snapshot(); original.close();
  const bytes = fs.readFileSync(path.join(directory, 'checkpoint.json'));
  const store = resume(directory, { mode: 'resume-current-owner-save' }); t.after(() => store.close());
  assert.deepEqual(store.snapshot(), before); assert.deepEqual(fs.readFileSync(path.join(directory, 'checkpoint.json')), bytes);
  store.recordOwner(owner); store.recordRecovery(recovery); store.recordPublication(profile); store.recordPublication(index);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'checkpoint.json')), bytes);
  store.recordCredential({ ...credential, signCount: 3 }); const after = store.snapshot();
  assert.deepEqual(after, { ...before, revision: before.revision + 1, credential: { ...credential, signCount: 3 } });
  refused(() => store.recordCredential({ ...credential, signCount: 2 }), 'transition_refused');
  refused(() => store.recordPublication({ ...profile, operationId: '55555555-5555-4555-8555-555555555555' }), 'transition_refused');
  assert.deepEqual(store.snapshot().fixture.expectedSave, before.fixture.expectedSave);
});

test('current-save resume blocks incomplete owner/key/index and every prior grant or coaching intent', t => {
  const next = sandbox(t);
  refused(() => resume(next(), { mode: 'resume-current-owner-save' }), 'missing');
  for (const state of ['unregistered', 'no-index', 'no-profile', 'grant', 'coaching']) {
    const directory = next(), original = state === 'unregistered' ? open(directory) : populate(open(directory));
    if (state !== 'unregistered') {
      if (state !== 'no-profile') original.recordPublication(profile);
      if (state !== 'no-index') original.recordPublication(index);
      if (state === 'grant') original.recordLifecycle({ kind: 'main-world-grant-intent' });
      if (state === 'coaching') original.recordLifecycle({ kind: 'coaching-delivery-intent' });
    }
    original.close(); const bytes = fs.readFileSync(path.join(directory, 'checkpoint.json'));
    refused(() => resume(directory, { mode: 'resume-current-owner-save' }), ['grant', 'coaching'].includes(state) ? 'lifecycle_blocked' : 'unrecoverable');
    assert.deepEqual(fs.readFileSync(path.join(directory, 'checkpoint.json')), bytes);
  }
});

test('main-world and coaching intents are monotonic and block every resume even after verified revocation', t => {
  const next = sandbox(t);
  for (const coaching of [false, true]) {
    const directory = next(), store = populate(open(directory));
    refused(() => store.recordLifecycle({ kind: 'main-world-grant-reference', reference }), 'transition_refused');
    refused(() => store.recordLifecycle({ kind: 'main-world-revoked' }), 'transition_refused');
    if (coaching) store.recordLifecycle({ kind: 'coaching-delivery-intent' });
    else {
      store.recordLifecycle({ kind: 'main-world-grant-intent' });
      refused(() => store.recordLifecycle({ kind: 'main-world-grant-reference', reference: { ...reference, admissionToken: 'DO_NOT_ACCEPT' } }), 'transition_refused');
      store.recordLifecycle({ kind: 'main-world-grant-reference', reference });
      store.recordLifecycle({ kind: 'main-world-revoked', reference }); assert.equal(store.snapshot().lifecycle.grantRevoked, true);
      refused(() => store.recordLifecycle({ kind: 'main-world-grant-intent' }), 'transition_refused');
    }
    store.close(); refused(() => resume(directory), 'lifecycle_blocked');
  }
});

test('failed atomic write preserves previous durable counter and poisons further API use', t => {
  const directory = sandbox(t)(), store = populate(open(directory)); const before = store.snapshot();
  const originalFsync = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw new Error('NEVER_EXPOSE_RAW_SECRET_DETAIL'); };
    refused(() => store.recordCredential({ ...credential, signCount: 99 }), 'write_failed');
  } finally { fs.fsyncSync = originalFsync; }
  refused(() => store.snapshot(), 'closed'); refused(() => store.recordCredential(credential), 'closed'); store.close();
  assert.equal(fs.readdirSync(directory).length, 1);
  const recovered = resume(directory); t.after(() => recovered.close()); assert.deepEqual(recovered.snapshot(), before);
});

test('a directory-fsync failure after rename remains closed; a later explicit resume revalidates durable state', t => {
  const directory = sandbox(t)(), store = populate(open(directory));
  const originalFsync = fs.fsyncSync; let calls = 0;
  try {
    fs.fsyncSync = fd => { if (++calls === 2) throw new Error('NEVER_EXPOSE_RAW_DIRECTORY_DETAIL'); return originalFsync(fd); };
    refused(() => store.recordCredential({ ...credential, signCount: 11 }), 'write_failed');
  } finally { fs.fsyncSync = originalFsync; }
  refused(() => store.snapshot(), 'closed'); store.close();
  const recovered = resume(directory); t.after(() => recovered.close());
  assert.equal(recovered.snapshot().credential.signCount, 11);
  assert.equal(recovered.snapshot().owner.userId, owner.userId);
  assert.deepEqual(recovered.snapshot().publications, []);
});

test('detects replacement, hard links and edits instead of trusting a cached snapshot', t => {
  const next = sandbox(t), directory = next(), store = populate(open(directory));
  const filename = path.join(directory, 'checkpoint.json'); fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace('"signCount":0', '"signCount":8'));
  refused(() => store.snapshot(), 'corrupt'); store.close();
  const second = next(), another = populate(open(second)); another.close();
  const file = path.join(second, 'checkpoint.json'); fs.linkSync(file, path.join(second, 'linked.json'));
  refused(() => resume(second), 'permissions_refused');
});
