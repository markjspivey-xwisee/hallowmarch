import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { readNativeQaCheckpoint } from './native-qa-resume.mjs';
import { readNativeQaCurrentOwnerSave, verifyNativeQaCurrentTitle } from './native-qa-current-save.mjs';
import { currentOwnerSaveHash } from './native-player-orchestration.mjs';
globalThis.self = globalThis;
const [{ createNativePodClient }, profileModule, { ClientKeyVault, canonicalGraphDigest, escapeTurtleLiteral }] = await Promise.all([
  import('../../client/native-pod/client.mjs'), import('../../client/native-pod/profile.mjs'),
  import('../../client/native-pod/vendor/interego-browser.mjs'),
]);
const IEP = 'https://markjspivey-xwisee.github.io/interego/ns/iep#';
const rawProfileId = '59664cd3-8291-4b93-80d8-5d6f9dff4a1a', rawIndexId = '662ba998-628e-4d98-88b8-7f0f808ce2b2';
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function memory() {
  const map = new Map();
  return { map, creates: 0, async load(scope) { return map.get(scope) || null; },
    async create(scope, candidate) { if (!map.has(scope)) { this.creates++; map.set(scope, candidate); } return map.get(scope); } };
}
async function fixture(options = {}) {
  const owner = { accountId: 'fixture-account', subjectDid: 'did:web:identity.example:users:qa', podUrl: 'https://pod.example/qa/' };
  const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
  const expected = options.expected || { v: 1, qa: { run: 'generated-checkpoint-fixture', marker: 'NEVER_OUTPUT_PRIVATE_BODY' } };
  const passphrase = 'NEVER_OUTPUT_RECOVERY_PASSPHRASE';
  const source = new ClientKeyVault(JSON.stringify(['interego-client-key/v1', relayOrigin, owner.subjectDid, 'qa']), memory(), webcrypto);
  await source.create(); const recovery = await source.backup(passphrase), recipient = await source.publicKey();
  const recipientId = owner.podUrl + 'agents#browser-encryption-' + createHash('sha256').update(recipient).digest('hex');
  const graphIri = 'urn:graph:client-owned:5e885b15-4b0a-4a33-bbdd-e1b9ee19a9af';
  const indexGraphIri = await profileModule.playerProfileIndexGraphIri(owner.subjectDid);
  const indexRecord = { schema: 'hallowmarch.player-profile-index/v1', ownerDid: owner.subjectDid, game: 'urn:game:hallowmarch', profileGraphIri: graphIri };
  const profileRecord = { schema: 'hallowmarch.player-profile/v1', ownerDid: owner.subjectDid, game: 'urn:game:hallowmarch',
    provenance: { authority: 'player-authored', importedProgressIsAuthoritative: false }, save: expected };
  const records = new Map(), descriptors = new Map();
  async function seed(kind, record, operationId = kind === 'index' ? rawIndexId : rawProfileId) {
    const selected = kind === 'index' ? indexGraphIri : graphIri;
    const value = { schema: 'interego.client-owned-record/v1', owner: owner.subjectDid, graphIri: selected, operationId, record };
    const plaintext = `<${selected}> <http://www.w3.org/ns/prov#wasAttributedTo> <${owner.subjectDid}> ;\n  <http://www.w3.org/1999/02/22-rdf-syntax-ns#value> "${escapeTurtleLiteral(JSON.stringify(value))}" .\n`;
    const digest = canonicalGraphDigest(plaintext), envelope = await source.seal(plaintext);
    const revision = (records.get(selected)?.revision || 0) + 1;
    const suffix = revision === 1 ? '' : '-' + revision;
    const head = { cid: 'fixture-cid-' + kind + suffix, descriptorUrl: owner.podUrl + 'context-graphs/' + kind + suffix + '.ttl' };
    const entry = { kind, graphIri: selected, operationId, digest, envelope, head, revision };
    records.set(selected, entry); descriptors.set(head.descriptorUrl, entry);
    return { kind, graphIri: selected, operationId, digest };
  }
  const publications = [await seed('profile', profileRecord), await seed('index', indexRecord)];
  const storage = memory(), calls = { tools: [], connect: 0, restore: 0, createKey: 0, cacheGet: 0, cacheClose: 0, clientClose: 0, status: 0 };
  const nativeBinding = { subjectDid: owner.subjectDid, podUrl: owner.podUrl, authenticatedAgentDid: 'did:web:identity.example:agents:qa-delegate' };
  let token = 'NEVER_OUTPUT_GAME_TOKEN';
  const net = { token, generation: 1, acct: { id: owner.accountId, nativeBound: true } };
  const context = vm.createContext({ Date, Set, Object, Promise, Error, JSON, URL, AbortSignal, crypto: options.crypto || webcrypto, TextEncoder,
    location: { origin: gameOrigin, host: 'game.example' }, __hm: { net: { NETWS: net } },
    localStorage: { getItem: () => token },
    fetch: async (path, init) => {
      calls.status++; assert.equal(path, '/gaming/identity/status'); assert.equal(init.headers.Authorization, 'Bearer ' + token);
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      if (options.statusHook) await options.statusHook(calls.status, context);
      return { ok: true, json: async () => ({ bound: true, verified: true, account: { id: owner.accountId }, binding: { ...nativeBinding } }) };
    } });
  class ReadOnlyTransport {
    async connect(required) { return { granted: required }; }
    async callTool(name, input) {
      calls.tools.push(name);
      if (options.toolHook) await options.toolHook(name, input, context);
      if (options.nativeFailure) throw Object.assign(Error('NEVER_OUTPUT_RAW_NATIVE_ERROR'), { code: options.nativeFailure });
      if (name === 'get_pod_status') return { pod: owner.podUrl, userId: 'qa', identity: { did: options.foreignOwner ? 'did:fixture:foreign' : owner.subjectDid },
        sessionAgent: { did: nativeBinding.authenticatedAgentDid } };
      if (name === 'get_current_head') return { podUrl: owner.podUrl, urn: input.urn, head: records.get(input.urn)?.head || null };
      if (name === 'get_descriptor' && input.url === owner.podUrl + 'agents') return { turtle: options.missingRecipient ? ''
        : `<urn:registry> <${IEP}agentIdentity> <${recipientId}> ; <${IEP}encryptionPublicKey> "${recipient}" .` };
      const entry = descriptors.get(input.url);
      if (name === 'get_descriptor') return { turtle: `<urn:proof> <${IEP}contentHash> "${options.invalidProof ? 'graph-nquads-sha256:' + '0'.repeat(64) : entry.digest}" .`,
        authorship: { authorshipVerified: true, descriptorBinding: { bound: true } } };
      if (name === 'get_encrypted_graph') return { encrypted: true, url: input.url, envelope: JSON.stringify(entry.envelope) };
      throw Error('A forbidden native write reached the offline fixture.');
    }
  }
  const modules = [{ createBrowserAccessCache: () => ({ async get() { calls.cacheGet++; return {
    credential: { kind: 'relay-oauth-bearer', method: 'webauthn', accessToken: 'NEVER_OUTPUT_NATIVE_TOKEN', expiresAt: Date.now() + 60000 }, expiresAt: Date.now() + 60000,
  }; }, async close() { calls.cacheClose++; if (options.cleanupHook) await options.cleanupHook(context); },
  forgetAll() { throw Error('Checkpoint reads cannot forget the owner access session.'); } }) },
  { createNativePodClient: input => {
    const actual = createNativePodClient({ ...input, keyStorage: storage, crypto: webcrypto });
    return { ...actual, async connect() { calls.connect++; return actual.connect(); },
      async restoreRecovery(...args) { calls.restore++; return actual.restoreRecovery(...args); },
      createKey() { calls.createKey++; throw Error('Checkpoint reads cannot create a recipient key.'); },
      async close() { calls.clientClose++; actual.close(); if (options.clientCloseFailure) throw Error('NEVER_OUTPUT_CLEANUP_ERROR'); } };
  } }, profileModule, { RelayMcpTransport: ReadOnlyTransport }];
  const read = vm.runInContext('(' + (options.readFunction || readNativeQaCheckpoint).toString() + ')', context);
  const config = { owner, relayOrigin, gameOrigin, expected, recovery, passphrase, publications };
  return { owner, expected, config, context, net, nativeBinding, records, graphIri, indexGraphIri, publications, profileRecord, indexRecord,
    calls, storage, seed, setToken(value) { token = value; }, run: extra => read({ ...config, ...extra }, modules) };
}
function noWrites(f) {
  assert.equal(f.calls.createKey, 0); assert(!f.calls.tools.includes('register_agent')); assert(!f.calls.tools.includes('publish_context'));
  assert.equal(f.calls.clientClose, f.calls.connect); assert.equal(f.calls.cacheClose, f.calls.cacheGet);
}
function redacted(value) { const output = JSON.stringify(value); assert(!output.includes('NEVER_OUTPUT')); assert(!output.includes('accessToken')); assert(!output.includes('descriptorUrl')); }

test('actual native client restores the original key and verifies both exact encrypted publications without a write', async () => {
  const f = await fixture(); const report = await f.run();
  assert.equal(report.ok, true); assert.equal(report.readOnly, true); assert.equal(report.publicationsVerified, true);
  assert.deepEqual(JSON.parse(JSON.stringify(report.heads)), { indexGraphIri: f.indexGraphIri, indexCid: 'fixture-cid-index', indexDigest: f.publications[1].digest,
    graphIri: f.graphIri, cid: 'fixture-cid-profile', digest: f.publications[0].digest });
  assert.equal(f.storage.creates, 1); assert.equal(f.calls.status, 3); noWrites(f); redacted(report);
});
test('both checkpoint publication IDs and signed content digests must match the exact native records', async () => {
  for (const kind of ['index', 'profile']) for (const field of ['operationId', 'digest']) {
    const f = await fixture(); const publications = f.publications.map(value => ({ ...value }));
    publications.find(value => value.kind === kind)[field] = field === 'digest' ? 'graph-nquads-sha256:' + 'f'.repeat(64) : '5cc92892-cb70-4d65-a7af-65bd8d1a34dc';
    const report = await f.run({ publications }); assert.equal(report.ok, false); assert.equal(report.code, 'qa_checkpoint_publication_mismatch');
    assert.equal(report.phase, kind === 'index' ? 'owner-index-read' : 'profile-read'); noWrites(f); redacted(report);
  }
});
test('missing index or profile remains an explicit read-only failure and an unindexed existing profile is never repaired', async () => {
  for (const kind of ['index', 'profile']) {
    const f = await fixture(); f.records.delete(kind === 'index' ? f.indexGraphIri : f.graphIri);
    const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, 'qa_checkpoint_' + kind + '_absent');
    assert.equal(report.phase, kind === 'index' ? 'owner-index-head' : 'profile-head'); noWrites(f);
  }
  for (const kind of ['index', 'profile']) {
    const f = await fixture(); const report = await f.run({ publications: f.publications.filter(value => value.kind !== kind) });
    assert.equal(report.code, 'qa_checkpoint_' + kind + '_intent_missing'); assert.equal(f.calls.connect, 0); noWrites(f);
  }
});
test('the stable owner index and its selected profile must match the checkpoint intent before profile reading', async () => {
  const wrongGraph = await fixture();
  const publications = wrongGraph.publications.map(value => value.kind === 'index' ? { ...value, graphIri: 'urn:graph:another-index' } : value);
  assert.equal((await wrongGraph.run({ publications })).code, 'qa_checkpoint_publication_mismatch');
  assert.equal(wrongGraph.calls.connect, 0); noWrites(wrongGraph);
  const target = await fixture(); target.publications[1] = await target.seed('index', { ...target.indexRecord, profileGraphIri: 'urn:graph:another-profile' });
  const report = await target.run(); assert.equal(report.code, 'qa_checkpoint_target_mismatch');
  assert.equal(target.calls.tools.filter(name => name === 'get_encrypted_graph').length, 1); noWrites(target);
});
test('exact synthetic save, profile owner/schema and nonauthoritative player provenance remain mandatory', async () => {
  for (const patch of [{ save: { v: 1, qa: { run: 'another-fixture' } } }, { ownerDid: 'did:fixture:another-owner' },
    { schema: 'another-schema' }, { provenance: { authority: 'player-authored', importedProgressIsAuthoritative: true } }]) {
    const f = await fixture(); f.publications[0] = await f.seed('profile', { ...f.profileRecord, ...patch });
    const report = await f.run(); assert.equal(report.ok, false); assert(['invalid_profile', 'qa_checkpoint_readback'].includes(report.code)); noWrites(f); redacted(report);
  }
});
test('missing recipient registration is blocked before any native write reaches the actual client transport', async () => {
  const f = await fixture({ missingRecipient: true }); const report = await f.run();
  assert.equal(report.ok, false); assert.equal(report.phase, 'key-restore'); assert.equal(report.code, 'qa_checkpoint_write_blocked');
  noWrites(f); redacted(report);
});
test('actual native owner, signature and transport failures return only bounded safe codes and phases', async () => {
  for (const [options, code] of [[{ foreignOwner: true }, 'owner_mismatch'], [{ invalidProof: true }, 'invalid_proof'],
    [{ nativeFailure: 'NEVER_OUTPUT_ARBITRARY_TOKEN' }, 'native_unavailable']]) {
    const f = await fixture(options); const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, code); noWrites(f); redacted(report);
  }
});
test('an owner or generation change during native reads cannot complete or continue another native read', async () => {
  for (const change of ['owner', 'generation', 'game', 'token']) {
    let changed = false;
    const f = await fixture({ toolHook: (name, _input, context) => {
      if (name !== 'get_encrypted_graph' || changed) return; changed = true;
      if (change === 'owner') context.__hm.net.NETWS.acct.id = 'another-owner';
      if (change === 'generation') context.__hm.net.NETWS.generation++;
      if (change === 'game') context.__hm = { ...context.__hm };
      if (change === 'token') context.__hm.net.NETWS.token = 'another-token';
    } });
    const report = await f.run(); assert.equal(report.ok, false); assert(!report.heads); assert.equal(f.calls.tools.filter(name => name === 'get_encrypted_graph').length, 1);
    noWrites(f); redacted(report);
  }
});
test('fresh native binding checks after read and after cleanup cannot accept an old owner or delegate', async () => {
  for (const at of [2, 3]) {
    let f; f = await fixture({ statusHook: count => { if (count === at) f.nativeBinding.authenticatedAgentDid = 'did:fixture:changed-delegate'; } });
    const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, 'qa_checkpoint_binding'); assert(!report.heads); noWrites(f);
  }
  const cleanup = await fixture({ cleanupHook: context => { context.__hm.net.NETWS.generation++; } });
  assert.equal((await cleanup.run()).code, 'qa_checkpoint_binding'); noWrites(cleanup);
});
test('concurrent reads share one flight and later retries re-read native state rather than trust an earlier PASS', async () => {
  const gate = deferred(); let entered = false;
  const f = await fixture({ toolHook: async name => { if (name === 'get_encrypted_graph' && !entered) { entered = true; await gate.promise; } } });
  const first = f.run(); while (!entered) await tick(); const second = f.run(); await tick(); assert.equal(f.calls.restore, 1);
  gate.release(); const reports = await Promise.all([first, second]); assert(reports.every(report => report.ok)); assert.equal(f.calls.restore, 1);
  f.records.delete(f.indexGraphIri); const retry = await f.run(); assert.equal(retry.ok, false); assert.equal(retry.code, 'qa_checkpoint_index_absent');
  assert.equal(f.calls.restore, 2); assert.equal(f.storage.creates, 1); noWrites(f);
});
test('retained checkpoint scope refuses changed private expectations and an owner change during the first binding await', async () => {
  const f = await fixture(); assert.equal((await f.run()).ok, true); const before = f.calls.connect;
  assert.equal((await f.run({ expected: { v: 1, qa: { run: 'different-run' } } })).code, 'qa_checkpoint_scope'); assert.equal(f.calls.connect, before);
  const changed = await fixture({ statusHook: (_count, context) => { context.__hm.net.NETWS.acct.id = 'another-owner'; } });
  assert.equal((await changed.run()).code, 'qa_checkpoint_binding'); assert.equal(changed.calls.connect, 0); noWrites(changed);
});
test('client cleanup failure still closes the access cache and cannot expose a successful private-read proof', async () => {
  const f = await fixture({ clientCloseFailure: true }); const report = await f.run();
  assert.equal(report.ok, false); assert.equal(report.phase, 'cleanup'); assert.equal(report.code, 'qa_checkpoint_cleanup');
  assert(!report.heads); noWrites(f); redacted(report);
});

const originalCharacter = { name: 'QA Native fixture', realm: 0, cls: 'warrior', level: 1, xp: 0 };
const currentExpected = () => ({ v: 1, char: { ...originalCharacter }, settings: { quality: 'low' },
  qa: { run: 'generated-checkpoint-fixture', marker: 'NEVER_OUTPUT_PRIVATE_BODY' } });
const currentSave = () => ({ v: 1, char: { ...originalCharacter, xp: 7, pos: { x: 2, z: 3 } },
  settings: { quality: 'low', music: 0.5 }, world: { keeps: [0, 1, 2] } });
const currentFixture = options => fixture({ readFunction: readNativeQaCurrentOwnerSave, expected: currentExpected(), ...options });
const currentOperation = 'f914e823-f79e-40c4-a07b-f2ea434b144b';
async function seedCurrent(f, patch = {}) {
  const save = currentSave();
  await f.seed('profile', { ...f.profileRecord, save, ...patch }, currentOperation);
  return save;
}

test('current owner-save proof accepts a native player-authored save without qa while preserving original key and index intent', async () => {
  const f = await currentFixture(), originalPublications = JSON.stringify(f.publications), save = await seedCurrent(f);
  const report = await f.run(); assert.equal(report.ok, true); assert.equal(report.currentOwnerSave, true); assert.equal(report.currentHeadsVerified, true);
  assert.equal(report.saveHash, createHash('sha256').update(JSON.stringify(save)).digest('hex'));
  assert.equal(report.heads.indexDigest, f.publications[1].digest); assert.equal(report.heads.indexCid, 'fixture-cid-index');
  assert.equal(report.heads.cid, 'fixture-cid-profile-2'); assert.notEqual(report.heads.digest, f.publications[0].digest);
  assert.equal(JSON.stringify(f.publications), originalPublications); assert.equal(f.storage.creates, 1);
  assert.deepEqual(Object.keys(report).sort(), ['ok', 'complete', 'readOnly', 'currentOwnerSave', 'indexVerified', 'profileVerified', 'currentHeadsVerified', 'saveHash', 'heads'].sort());
  assert.equal(f.calls.tools.filter(name => name === 'get_current_head').length, 6); noWrites(f); redacted(report);
});

test('runner hash guard accepts the actual native current-save report and refuses prefixed hashes or incomplete proof flags', async () => {
  const f = await currentFixture(); await seedCurrent(f); const report = await f.run();
  assert.equal(currentOwnerSaveHash(report), report.saveHash);
  assert.throws(() => currentOwnerSaveHash({ ...report, saveHash: 'sha256:' + report.saveHash }), { code: 'qa_native_step_failed' });
  for (const key of ['ok', 'complete', 'readOnly', 'currentOwnerSave', 'indexVerified', 'profileVerified', 'currentHeadsVerified']) {
    const incomplete = { ...report }; delete incomplete[key];
    assert.throws(() => currentOwnerSaveHash(incomplete), { code: 'qa_native_step_failed' });
    assert.throws(() => currentOwnerSaveHash({ ...report, [key]: false }), { code: 'qa_native_step_failed' });
  }
  noWrites(f); redacted(report);
});

test('exact checkpoint read still rejects the legitimately changed profile accepted by the separate current-save helper', async () => {
  const f = await fixture({ expected: currentExpected() });
  // Even if publication metadata is supplied for this native version, the
  // original exact-body lane still requires its original expected save.
  f.publications[0] = await f.seed('profile', { ...f.profileRecord, save: currentSave() }, currentOperation);
  const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, 'qa_checkpoint_readback'); noWrites(f); redacted(report);
});

test('current save requires original character identity and explicit player-authored nonauthoritative provenance', async () => {
  for (const [field, value] of [['name', 'Another character'], ['realm', 1], ['cls', 'mage']]) {
    const f = await currentFixture(); const save = currentSave(); save.char[field] = value; await seedCurrent(f, { save });
    const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, 'qa_current_save_character'); noWrites(f); redacted(report);
  }
  for (const provenance of [undefined, { authority: 'server-authored', importedProgressIsAuthoritative: false },
    { authority: 'player-authored', importedProgressIsAuthoritative: true }]) {
    const f = await currentFixture(); await seedCurrent(f, { provenance });
    const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, 'qa_current_save_readback'); noWrites(f); redacted(report);
  }
});

test('current save retains exact original index operation/digest and original profile graph', async () => {
  for (const field of ['operationId', 'digest']) {
    const f = await currentFixture(); await seedCurrent(f);
    const publications = f.publications.map(value => ({ ...value }));
    publications[1][field] = field === 'digest' ? 'graph-nquads-sha256:' + 'a'.repeat(64) : currentOperation;
    const report = await f.run({ publications }); assert.equal(report.code, 'qa_current_save_publication_mismatch'); noWrites(f); redacted(report);
  }
  const f = await currentFixture(); await seedCurrent(f);
  const publications = f.publications.map(value => value.kind === 'profile' ? { ...value, graphIri: 'urn:graph:client-owned:foreign' } : value);
  const report = await f.run({ publications }); assert.equal(report.code, 'qa_current_save_target_mismatch');
  assert.equal(f.calls.tools.filter(name => name === 'get_encrypted_graph').length, 1); noWrites(f); redacted(report);
});

test('current owner-save proof rechecks CID and descriptor identity for both native heads after reading', async () => {
  for (const kind of ['index', 'profile']) for (const field of ['cid', 'descriptorUrl']) {
    let f; const counts = new Map(); f = await currentFixture({ toolHook: (name, input) => {
      if (name !== 'get_current_head') return;
      const count = (counts.get(input.urn) || 0) + 1; counts.set(input.urn, count);
      if (count === 3 && input.urn === (kind === 'index' ? f.indexGraphIri : f.graphIri)) {
        f.records.get(input.urn).head[field] = field === 'cid' ? 'changed-public-cid' : f.owner.podUrl + 'context-graphs/changed.ttl';
      }
    } }); await seedCurrent(f);
    const report = await f.run(); assert.equal(report.ok, false); assert.equal(report.code, 'qa_current_save_head_changed'); assert(!report.saveHash); noWrites(f); redacted(report);
  }
});

test('current read refuses owner/proof/key/cleanup races and blocks missing-recipient registration', async () => {
  for (const [options, code] of [[{ foreignOwner: true }, 'owner_mismatch'], [{ invalidProof: true }, 'invalid_proof'],
    [{ missingRecipient: true }, 'qa_current_save_write_blocked'], [{ cleanupHook: context => { context.__hm.net.NETWS.generation++; } }, 'qa_current_save_binding']]) {
    const f = await currentFixture(options); await seedCurrent(f); const report = await f.run();
    assert.equal(report.ok, false); assert.equal(report.code, code); assert(!report.saveHash); noWrites(f); redacted(report);
  }
  for (const at of [2, 3]) {
    let f; f = await currentFixture({ statusHook: count => { if (count === at) f.nativeBinding.authenticatedAgentDid = 'did:fixture:changed-delegate'; } });
    await seedCurrent(f); assert.equal((await f.run()).code, 'qa_current_save_binding'); noWrites(f);
  }
});

test('current reads share one flight, pin original character scope and re-read after a successful result', async () => {
  const gate = deferred(); let entered = false;
  const f = await currentFixture({ toolHook: async name => { if (name === 'get_encrypted_graph' && !entered) { entered = true; await gate.promise; } } }); await seedCurrent(f);
  const first = f.run(); while (!entered) await tick(); const second = f.run(); await tick(); assert.equal(f.calls.restore, 1);
  gate.release(); assert((await Promise.all([first, second])).every(report => report.ok)); assert.equal(f.calls.restore, 1);
  assert.equal((await f.run({ expected: { ...f.expected, char: { ...f.expected.char, name: 'Another original' } } })).code, 'qa_current_save_scope');
  f.records.delete(f.graphIri); assert.equal((await f.run()).code, 'qa_current_save_profile_absent'); assert.equal(f.calls.restore, 2); noWrites(f);
});

async function titleFixture(options = {}) {
  const f = await currentFixture(options); const loaded = await seedCurrent(f), report = await f.run(); assert.equal(report.ok, true);
  f.context.__hm.ready = true; f.context.__hm.GAME = { started: false };
  f.context.__hm.SAVE = { native: true, readConfirmed: true, loaded, loading: { settled: true } };
  const verify = vm.runInContext('(' + verifyNativeQaCurrentTitle.toString() + ')', f.context);
  return { ...f, loaded, report, verify: extra => verify({ owner: f.owner, gameOrigin: f.config.gameOrigin, saveHash: report.saveHash, ...extra }) };
}

test('normal unstarted title independently verifies its confirmed native loaded hash and fresh owner binding', async () => {
  const f = await titleFixture(), before = f.calls.status, tools = f.calls.tools.length;
  const report = await f.verify(); assert.equal(report.ok, true); assert.equal(report.titleVerified, true); assert.equal(report.saveHash, f.report.saveHash);
  assert.equal(f.calls.status - before, 2); assert.equal(f.calls.tools.length, tools); noWrites(f); redacted(report);
  f.loaded.char.xp++; const retry = await f.verify(); assert.equal(retry.ok, false); assert.equal(retry.code, 'qa_current_title_hash'); assert(!retry.saveHash);
});

test('title pins its fresh session token independently from the preceding private-read document', async () => {
  const f = await titleFixture(); f.net.token = 'NEVER_OUTPUT_ROTATED_GAME_TOKEN'; f.net.generation++;
  f.setToken(f.net.token); const report = await f.verify();
  assert.equal(report.ok, true); assert.equal(report.titleVerified, true); noWrites(f); redacted(report);
});

test('title refuses wrong hashes, unfinished/native-unconfirmed title and session changes before any proof', async () => {
  const mutations = [f => { f.context.__hm.GAME.started = true; }, f => { f.context.__hm.ready = false; },
    f => { f.context.__hm.SAVE.native = false; }, f => { f.context.__hm.SAVE.readConfirmed = false; },
    f => { f.context.__hm.SAVE.loading.settled = false; }, f => { f.context.__hm.SAVE.pending = {}; },
    f => { f.net.acct.nativeBound = false; }, f => { f.net.acct.id = 'another-owner'; }];
  for (const change of mutations) {
    const f = await titleFixture(); change(f); const report = await f.verify(); assert.equal(report.ok, false); assert(!report.saveHash); noWrites(f); redacted(report);
  }
  const f = await titleFixture(); assert.equal((await f.verify({ saveHash: '0'.repeat(64) })).code, 'qa_current_title_hash');
});

test('title detects loaded body, token and generation races during asynchronous hashing', async () => {
  for (const change of ['body', 'token', 'generation', 'owner']) {
    let f, armed = false;
    const crypto = { subtle: { async digest(...args) {
      const result = await webcrypto.subtle.digest(...args);
      if (armed) {
        if (change === 'body') f.loaded.char.xp++;
        if (change === 'token') f.net.token = 'another-token';
        if (change === 'generation') f.net.generation++;
        if (change === 'owner') f.net.acct.id = 'another-owner';
      }
      return result;
    } } };
    f = await titleFixture({ crypto }); armed = true; const report = await f.verify();
    assert.equal(report.ok, false); assert(['qa_current_title_binding', 'qa_current_title_state'].includes(report.code)); assert(!report.saveHash); noWrites(f); redacted(report);
  }
});

test('title final fresh status rejects owner/delegate changes and never caches a successful check', async () => {
  for (const change of ['delegate', 'pod', 'body']) {
    let f, armed = false, statusAt = 0;
    f = await titleFixture({ statusHook: () => {
      if (!armed || ++statusAt !== 2) return;
      if (change === 'delegate') f.nativeBinding.authenticatedAgentDid = 'did:fixture:other-delegate';
      if (change === 'pod') f.nativeBinding.podUrl = 'https://pod.example/another-owner/';
      if (change === 'body') f.loaded.char.xp++;
    } }); armed = true;
    const report = await f.verify(); assert.equal(report.ok, false); assert(['qa_current_title_binding', 'qa_current_title_state'].includes(report.code)); assert(!report.saveHash); redacted(report);
  }
  const f = await titleFixture(); assert.equal((await f.verify()).ok, true); const before = f.calls.status;
  f.nativeBinding.authenticatedAgentDid = 'did:fixture:other-delegate'; assert.equal((await f.verify()).code, 'qa_current_title_binding'); assert.equal(f.calls.status, before + 1);
});

test('concurrent title checks share only an active flight and reject changed hash scope', async () => {
  const gate = deferred(); let f, armed = false, entered = false;
  f = await titleFixture({ statusHook: async () => { if (armed && !entered) { entered = true; await gate.promise; } } }); armed = true;
  const before = f.calls.status, first = f.verify(); while (!entered) await tick(); const second = f.verify(); await tick(); assert.equal(f.calls.status, before + 1);
  gate.release(); assert((await Promise.all([first, second])).every(report => report.ok)); assert.equal(f.calls.status, before + 2);
  assert.equal((await f.verify({ saveHash: '0'.repeat(64) })).code, 'qa_current_title_scope');
});
