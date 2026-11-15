/** Retained-key discovery uses real encrypted native records and read-only ports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
globalThis.self = globalThis;
const { createRetainedCharacterRecovery } = await import('./recovery.mjs');
const { createNativePodClient } = await import('./client.mjs');
const { playerProfileIndexGraphIri, playerProfileGraphIri } = await import('./profile.mjs');
const { ClientKeyVault } = await import('./vendor/interego-browser.mjs');
const { computeCid } = await import('./vendor/interego-public-browser.mjs');
const { ownerKeyAliasAddress } = await import('./key-scope.mjs');

const OWNER = 'did:web:identity.example:users:recovery-owner', POD = 'https://pod.example/recovery-owner/';
const RELAY = 'https://relay.example', OLD_RELAY = 'https://retained-relay.example';
const AGENT = 'did:web:identity.example:agents:recovery-session';
const WEBID = 'https://identity.example/users/recovery-owner/profile#me';
const IEP = 'https://markjspivey-xwisee.github.io/interego/ns/iep#';
const CHECKPOINT = 'hallowmarch-character/v1', GAME = 'urn:game:hallowmarch';
const TOKEN = 'fixture-recovery-bearer-never-returned';
const binding = { subjectDid: OWNER, podUrl: POD };
const credential = { kind: 'relay-oauth-bearer', accessToken: TOKEN, method: 'webauthn', refreshToken: null, expiresAt: Date.now() + 3600000 };
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const scopeFor = (relay = OLD_RELAY, owner = OWNER, podName = 'recovery-owner') => JSON.stringify(['interego-client-key/v1', relay, owner, podName]);
const character = { name: 'Retained fixture hero', level: 12, realm: 2, cls: 'mage', rp: 174,
  inventory: ['private inventory item'], privateDescription: 'private character detail' };
const profileRecord = (save = { v: 1, char: character }) => ({ schema: 'hallowmarch.player-profile/v1', ownerDid: OWNER, game: GAME, save });
const indexRecord = graphIri => ({ schema: 'hallowmarch.player-profile-index/v1', ownerDid: OWNER, game: GAME, profileGraphIri: graphIri });

function assertSafeResult(result, secrets = []) {
  const output = JSON.stringify(result);
  for (const secret of [OWNER, POD, RELAY, OLD_RELAY, TOKEN, 'private inventory item', 'private character detail', ...secrets]) {
    assert(!output.includes(secret), 'recovery result must not expose private records, routing, keys or credentials');
  }
  assert(Object.keys(result).every(key => ['status', 'summary', 'handle'].includes(key)));
  if (result.handle !== undefined) {
    assert.equal(typeof result.handle, 'string'); assert(result.handle.length >= 16 && result.handle.length <= 256);
  }
}

async function encryptedFixture({ withIndex = true, save = { v: 1, char: character }, keyRelay = OLD_RELAY } = {}) {
  const resources = new Map(), heads = new Map(), records = new Map(), agents = new Map(), keyRecords = new Map();
  const calls = [], httpCalls = [], opened = [], closed = [], keyCreates = [];
  const keyStorage = { load: async key => keyRecords.get(key) || null,
    create: async (key, value) => { keyCreates.push(key); if (!keyRecords.has(key)) keyRecords.set(key, value); return keyRecords.get(key); } };
  let allowWrites = true, revision = 0;
  const transport = { setCredential() {}, connect: async names => ({ granted: names }),
    async callTool(name, args) {
      calls.push({ name, args: structuredClone(args) });
      if (name === 'get_pod_status') return { pod: POD, userId: 'recovery-owner', identity: { did: OWNER }, sessionAgent: { did: AGENT } };
      if (name === 'get_current_head') return { urn: args.urn, podUrl: POD, head: heads.get(args.urn) || null, forked: false, message: 'No descriptor on this pod describes the requested urn.' };
      if (name === 'register_agent') {
        assert(allowWrites, 'recovery must not register a key'); agents.set(args.agent_id, args.encryption_public_key); return { agent: args.agent_id, scope: args.scope };
      }
      if (name === 'get_descriptor' && args.url === POD + 'agents') return { turtle: [...agents].map(([id, key], i) => `<#a${i}> <${IEP}agentIdentity> <${id}> ; <${IEP}encryptionPublicKey> "${key}" .`).join('\n') };
      if (name === 'publish_context') {
        assert(allowWrites, 'recovery must not publish records');
        const url = POD + 'context-graphs/' + args.descriptor_id.slice(9) + '.ttl';
        const turtle = `@prefix iep: <${IEP}> .\n<> iep:describes <${args.graph_iri}> ; iep:authorshipProof [ iep:issuer <${AGENT}> ; iep:verificationMethod <did:ethr:0xfixture> ;\n`
          + `iep:signerAddress "0xfixture" ; iep:created "2026-10-17T12:00:00.000Z" ; iep:ownerWebId <${WEBID}> ;\n`
          + `iep:descriptorId <${args.descriptor_id}> ; iep:contentHash "${args.content_digest}" ; iep:proofValue "explicit-native-contract-fixture" ] .\n`;
        const found = { url, turtle, head: { descriptorUrl: url, cid: computeCid(turtle) }, args: structuredClone(args) };
        heads.set(args.graph_iri, found.head); records.set(url, found); return { published: true, status: 'committed', descriptorUrl: url };
      }
      if (name === 'get_descriptor') {
        const found = records.get(args.url); assert(found);
        return { url: found.url, turtle: found.turtle, authorship: { authorshipVerified: true, signatureAuthority: 'relay',
          signedBy: AGENT, contentBinding: 'declared', descriptorBinding: { bound: true, basis: 'slug-and-owner' } } };
      }
      if (name === 'get_encrypted_graph') return { encrypted: true, url: args.url, envelope: records.get(args.url).args.graph_content };
      throw Error('Unexpected recovery fixture operation: ' + name);
    } };
  const fetcher = async (url, init) => {
    assert(url.startsWith(POD + 'hallowmarch/checkpoints/'));
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + TOKEN);
    assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    httpCalls.push({ url, method: init.method || 'GET' });
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Interego-Native-Commit': '1', 'Accept-Put': 'application/vnd.interego.native-commit+json' } });
    if (init.method === 'PUT') {
      assert(allowWrites, 'recovery must not write a checkpoint');
      const command = JSON.parse(init.body), before = resources.get(url);
      if (command.expectedRevision !== (before?.revision || null)) return new Response(null, { status: 412 });
      const body = new Uint8Array(Buffer.from(command.bodyBase64, 'base64'));
      const found = { body, contentType: command.contentType, revision: sha(Buffer.concat([body, Buffer.from(String(++revision))])) };
      resources.set(url, found);
      const atom = 'urn:pgsl:atom:' + sha(Buffer.from('atom:' + command.bodyBase64)).slice(7, 47);
      return Response.json({ version: 1, status: 'committed', expectedRevision: command.expectedRevision,
        resource: url, path: url, pod: 'css', bodyDigest: sha(body), contentType: command.contentType, size: body.length,
        updatedAt: Date.now(), revision: found.revision, topUri: atom, opaqueUri: atom }, { headers: { ETag: '"' + found.revision + '"' } });
    }
    const found = resources.get(url); if (!found) return new Response(null, { status: 404 });
    return new Response(found.body, { headers: { 'Content-Type': found.contentType, ETag: '"' + found.revision + '"',
      'Interego-Revision': found.revision, 'Interego-Body-Digest': sha(found.body) } });
  };
  const nativeClient = options => createNativePodClient({ ...options, transport, keyStorage, crypto: webcrypto, fetch: fetcher });
  const bootstrap = nativeClient({ relayUrl: keyRelay, credential, ownerDid: OWNER, podUrl: POD });
  await bootstrap.connect(); const key = await bootstrap.createKey();
  const graphIri = await playerProfileGraphIri(OWNER, webcrypto), indexGraphIri = await playerProfileIndexGraphIri(OWNER, webcrypto);
  assert.equal((await bootstrap.createAt({ graphIri, checkpoint: CHECKPOINT, record: profileRecord(save) })).saved, true);
  if (withIndex) assert.equal((await bootstrap.createAt({ graphIri: indexGraphIri, record: indexRecord(graphIri) })).saved, true);
  bootstrap.close(); allowWrites = false; calls.length = 0; httpCalls.length = 0;
  const before = { keyCreates: keyCreates.length, keyEntries: [...keyRecords], heads: structuredClone([...heads]),
    records: structuredClone([...records]), resources: structuredClone([...resources]) };
  const candidate = { scope: scopeFor(keyRelay), publicKey: key.publicKey };
  const candidateSource = { list: async () => [candidate], openVault: async item => { opened.push(item); return new ClientKeyVault(item.scope, keyStorage, webcrypto); } };
  const createClient = options => {
    assert.equal(options.ownerDid, OWNER); assert.equal(options.podUrl, POD); assert.equal(options.relayUrl, RELAY);
    assert.deepEqual(Object.keys(options.vault).sort(), ['open', 'publicKey'], 'recovery receives no key mutation or backup capability');
    const client = nativeClient(options), close = client.close;
    return { ...client, close() { closed.push(true); close(); } };
  };
  return { options: { binding, relayUrl: RELAY, credential, candidateSource, createClient, crypto: webcrypto }, candidate, key,
    calls, httpCalls, opened, closed, keyStorage,
    exportRecovery: passphrase => new ClientKeyVault(candidate.scope, keyStorage, webcrypto).backup(passphrase),
    assertUnchanged() {
      assert.equal(keyCreates.length, before.keyCreates); assert.deepEqual([...keyRecords], before.keyEntries);
      assert.deepEqual([...heads], before.heads); assert.deepEqual([...records], before.records); assert.deepEqual([...resources], before.resources);
      assert(!calls.some(call => ['register_agent', 'publish_context'].includes(call.name)));
      assert(httpCalls.every(call => ['GET', 'HEAD', 'OPTIONS'].includes(call.method)));
    } };
}

async function portFixture({ index = true, profile = profileRecord(), candidates, loadHook, headHook, connectHook } = {}) {
  const graphIri = await playerProfileGraphIri(OWNER, webcrypto), indexGraphIri = await playerProfileIndexGraphIri(OWNER, webcrypto);
  const publicKey = Buffer.alloc(32, 7).toString('base64'), candidate = { scope: scopeFor(), publicKey };
  const calls = [], opened = [], closed = [];
  const head = graph => ({ descriptorUrl: POD + 'context-graphs/' + (graph === indexGraphIri ? 'index' : 'profile') + '.ttl',
    cid: 'sha256:' + 'a'.repeat(64), ...(graph === indexGraphIri ? {} : { nativeRevision: 'sha256:' + 'b'.repeat(64), recordCid: 'graph-nquads-sha256:' + 'c'.repeat(64) }) });
  const candidateSource = { list: async () => candidates || [candidate], openVault: async item => {
    opened.push(item); return { publicKey: async () => item.publicKey, open: async value => value, create: () => assert.fail('no key writes'), backup: () => assert.fail('no backup extraction') };
  } };
  const createClient = options => ({ connect: async () => { calls.push({ operation: 'connect' }); if (connectHook) await connectHook(); return { ownerDid: OWNER, podUrl: POD, keyPresent: true }; },
    currentHead: async input => { calls.push({ operation: 'head', ...input });
      if (headHook) { const value = await headHook(input, { calls, graphIri, indexGraphIri, head }); if (value !== undefined) return value; }
      return input.graphIri === indexGraphIri ? index ? head(indexGraphIri) : null : profile ? head(graphIri) : null; },
    load: async input => { calls.push({ operation: 'load', ...input });
      if (loadHook) { const value = await loadHook(input, { calls, graphIri, indexGraphIri, head }); if (value !== undefined) return value; }
      const record = input.graphIri === indexGraphIri ? index ? indexRecord(graphIri) : null : profile;
      return record ? { graphIri: input.graphIri, head: head(input.graphIri), record: structuredClone(record) } : null;
    }, close() { closed.push(options.vault); },
    registerKey: () => assert.fail('recovery must not register a key'), createKey: () => assert.fail('recovery must not create a key'),
    save: () => assert.fail('recovery must not save'), createAt: () => assert.fail('recovery must not create records') });
  return { options: { binding, relayUrl: RELAY, credential, candidateSource, createClient, crypto: webcrypto }, candidate, publicKey,
    calls, opened, closed, graphIri, indexGraphIri, head };
}

function importStorage({ beforeCreate = async () => {} } = {}) {
  const map = new Map(), attempts = [], writes = [];
  return { map, attempts, writes, load: async scope => map.get(scope) || null,
    async create(scope, record, options = {}) {
      attempts.push({ scope, options }); await beforeCreate(options);
      if (options.signal?.aborted || options.isCurrent && !options.isCurrent()) throw Object.assign(Error('cancelled import'), { code: 'recovery_cancelled' });
      if (!map.has(scope) && options.absentKeys?.some(key => map.has(key))) throw Object.assign(Error('a recovery link won'), { code: 'key_scope_changed' });
      if (!map.has(scope)) { map.set(scope, record); writes.push(scope); }
      return map.get(scope);
    } };
}

function importOptions(f, keyStorage, extra = {}) {
  return { ...f.options, keyStorage, candidateSource: {
    list: async () => assert.fail('an uploaded recovery file must not fall back to a different retained candidate'),
    openVault: async candidate => { f.opened.push(candidate); return new ClientKeyVault(candidate.scope, keyStorage, webcrypto); },
  }, ...extra };
}

test('an older relay-scoped actual vault opens the same encrypted character with no writes or key changes', async () => {
  const f = await encryptedFixture(), recovery = createRetainedCharacterRecovery(f.options);
  const result = await recovery.discover();
  assert.equal(result.status, 'verified_character');
  assert.deepEqual(result.summary, { name: character.name, level: character.level, realm: character.realm, calling: character.cls, realmPoints: character.rp });
  assertSafeResult(result, [f.key.publicKey, f.candidate.scope]);
  assert.equal(f.opened.length, 1); assert(f.closed.length >= 1); f.assertUnchanged();
  assert.equal(recovery.discard(result.handle), true); assert.equal(recovery.discard(result.handle), false); recovery.close();
});

test('a missing index can still verify the deterministic encrypted checkpoint without creating its index', async () => {
  const f = await encryptedFixture({ withIndex: false }), recovery = createRetainedCharacterRecovery(f.options);
  const result = await recovery.discover(); assert.equal(result.status, 'verified_character');
  assertSafeResult(result, [f.key.publicKey]); f.assertUnchanged(); recovery.close();
});

test('an actual encrypted empty profile is verified_empty rather than permission to create a replacement', async () => {
  const f = await encryptedFixture({ save: { v: 1, char: null } }), recovery = createRetainedCharacterRecovery(f.options);
  const result = await recovery.discover(); assert.equal(result.status, 'verified_empty'); assert.equal(result.summary, undefined);
  assertSafeResult(result, [f.key.publicKey]); f.assertUnchanged(); recovery.close();
});

test('wrong owner, pod name, non-HTTPS relay and unknown scope versions are filtered before a vault opens', async () => {
  const candidates = [scopeFor(OLD_RELAY, OWNER + '-other'), scopeFor(OLD_RELAY, OWNER, 'different-pod'),
    scopeFor('http://insecure.example'), JSON.stringify(['interego-client-key/v2', OLD_RELAY, OWNER, 'recovery-owner'])]
    .map(scope => ({ scope, publicKey: Buffer.alloc(32, 8).toString('base64') }));
  const f = await portFixture({ candidates }), recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'no_match' }); assert.equal(f.opened.length, 0); assert.equal(f.calls.length, 0); recovery.close();
});

test('a wrong decryption key is skipped and cannot produce a matching handle', async () => {
  const f = await portFixture({ loadHook: async () => { throw Object.assign(Error('wrong candidate key'), { code: 'cannot_decrypt' }); } });
  const recovery = createRetainedCharacterRecovery(f.options), result = await recovery.discover();
  assert.deepEqual(result, { status: 'no_match' }); assert.equal(f.closed.length, 1); recovery.close();
});

test('a vault whose actual public key differs from its advertised candidate is never used for record reads', async () => {
  const f = await portFixture(); f.options.candidateSource.openVault = async () => ({ publicKey: async () => Buffer.alloc(32, 9).toString('base64'), open: async value => value });
  const recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'no_match' }); assert.equal(f.calls.length, 0); recovery.close();
});

for (const defect of ['owner', 'game', 'schema', 'graph']) test('a decrypted profile with a foreign ' + defect + ' fails closed', async () => {
  const f = await portFixture({ loadHook: async (input, context) => {
    if (input.graphIri === context.indexGraphIri) return undefined;
    const record = profileRecord(); if (defect === 'owner') record.ownerDid += '-other';
    if (defect === 'game') record.game = 'urn:game:other'; if (defect === 'schema') record.schema = 'unrecognized-profile/v1';
    return { graphIri: defect === 'graph' ? 'urn:graph:foreign:character' : input.graphIri, head: context.head(input.graphIri), record };
  } });
  const recovery = createRetainedCharacterRecovery(f.options), result = await recovery.discover();
  assert.deepEqual(result, { status: 'unavailable' }); assertSafeResult(result); recovery.close();
});

test('a corrupt owner index is not bypassed by a valid deterministic character', async () => {
  const f = await portFixture({ loadHook: async (input, context) => input.graphIri === context.indexGraphIri
    ? { graphIri: input.graphIri, head: context.head(input.graphIri), record: { ...indexRecord(context.graphIri), ownerDid: OWNER + '-other' } } : undefined });
  const recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'unavailable' });
  assert(!f.calls.some(call => call.operation === 'load' && call.graphIri === f.graphIri)); recovery.close();
});

test('an owner-index head changed during character verification invalidates the proof', async () => {
  let reads = 0;
  const f = await portFixture({ headHook: async (input, context) => {
    if (input.graphIri !== context.indexGraphIri) return undefined;
    const selected = context.head(input.graphIri); if (++reads > 1) selected.cid += '-changed'; return selected;
  } });
  const recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'conflict' }); recovery.close();
});

test('an authenticated index whose target payload is absent is index_only with no invented character summary', async () => {
  const f = await portFixture({ profile: null }), recovery = createRetainedCharacterRecovery(f.options);
  const result = await recovery.discover(); assert.equal(result.status, 'index_only'); assert.equal(result.summary, undefined);
  assertSafeResult(result); recovery.close();
});

test('a forked owner head stops recovery rather than trying another key', async () => {
  const f = await portFixture({ headHook: async () => { throw Object.assign(Error('native fork'), { code: 'conflict' }); } });
  const recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'conflict' }); assert.equal(f.opened.length, 1); recovery.close();
});

for (const field of ['cid', 'descriptorUrl', 'nativeRevision', 'recordCid']) test('a changing profile ' + field + ' invalidates its recovery proof', async () => {
  let reads = 0;
  const f = await portFixture({ headHook: async (input, context) => {
    if (input.graphIri !== context.graphIri) return undefined;
    const selected = context.head(input.graphIri); if (++reads > 1) selected[field] += '-changed'; return selected;
  } });
  const recovery = createRetainedCharacterRecovery(f.options), result = await recovery.discover();
  assert.deepEqual(result, { status: 'conflict' }); assert.equal(result.handle, undefined); recovery.close();
});

test('loss of authentication during probing returns unavailable without a recovery handle', async () => {
  const f = await portFixture({ connectHook: async () => { throw Object.assign(Error('expired access'), { code: 'needs_reauth' }); } });
  const recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'unavailable' }); assert.equal(f.closed.length, 1); recovery.close();
});

test('owner-session replacement during a read cancels discovery and closes the candidate client', async () => {
  let current = true;
  const f = await portFixture({ loadHook: async () => { current = false; return undefined; } });
  const recovery = createRetainedCharacterRecovery({ ...f.options, isCurrent: () => current });
  assert.deepEqual(await recovery.discover(), { status: 'cancelled' }); assert.equal(f.closed.length, 1); recovery.close();
});

test('an aborted scan ignores a late candidate list and never opens its vault', async () => {
  const f = await portFixture(), controller = new AbortController(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  f.options.candidateSource.list = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const recovery = createRetainedCharacterRecovery({ ...f.options, signal: controller.signal }), pending = recovery.discover();
  await started; controller.abort(); release([f.candidate]);
  assert.deepEqual(await pending, { status: 'cancelled' }); assert.equal(f.opened.length, 0); recovery.close();
});

test('a truncated retained-key catalogue cannot be reported as no_match', async () => {
  const f = await portFixture();
  f.options.candidateSource.list = async ({ limit }) => { assert(limit > 0 && limit <= 1024); return { candidates: [], truncated: true }; };
  const recovery = createRetainedCharacterRecovery(f.options);
  assert.deepEqual(await recovery.discover(), { status: 'limit_reached' }); recovery.close();
});

test('the candidate cap stops failed probes without opening a later retained vault', async () => {
  const f = await portFixture({ loadHook: async () => { throw Object.assign(Error('wrong candidate key'), { code: 'cannot_decrypt' }); } });
  f.options.candidateSource.list = async () => [f.candidate, { scope: scopeFor('https://another-retained-relay.example'), publicKey: Buffer.alloc(32, 10).toString('base64') }];
  const recovery = createRetainedCharacterRecovery({ ...f.options, limits: { maxCandidates: 1 } });
  assert.deepEqual(await recovery.discover(), { status: 'limit_reached' }); assert.equal(f.opened.length, 1); recovery.close();
});

test('unexpected retained-vault storage errors fail closed without returning their details', async () => {
  const f = await portFixture();
  f.options.candidateSource.openVault = async () => { throw Error('private local storage detail: ' + f.candidate.scope); };
  const recovery = createRetainedCharacterRecovery(f.options), result = await recovery.discover();
  assert.deepEqual(result, { status: 'unavailable' }); assertSafeResult(result); assert.equal(f.calls.length, 0); recovery.close();
});

test('character n is not invented as a level and private save fields are excluded from the summary', async () => {
  const f = await portFixture({ profile: profileRecord({ v: 1, char: { name: 'Fixture name', n: 999, realm: 1, cls: 'warrior', rp: 0,
    privateDescription: 'private character detail' }, privateToken: TOKEN }) });
  const recovery = createRetainedCharacterRecovery(f.options), result = await recovery.discover();
  assert.equal(result.status, 'verified_character');
  assert.deepEqual(result.summary, { name: 'Fixture name', realm: 1, calling: 'warrior', realmPoints: 0 });
  assertSafeResult(result); recovery.close();
});

test('proof handles are opaque, one-discovery-only and discarded when the controller closes', async () => {
  const f = await portFixture(), recovery = createRetainedCharacterRecovery(f.options);
  const first = await recovery.discover(), second = await recovery.discover();
  assert.equal(first.status, 'verified_character'); assert.equal(second.status, 'verified_character');
  assert.notEqual(first.handle, second.handle); assertSafeResult(first, [f.publicKey, f.candidate.scope]);
  assertSafeResult(second, [f.publicKey, f.candidate.scope]);
  assert.equal(recovery.discard(first.handle), false); assert.equal(recovery.discard('invented-handle'), false);
  recovery.close(); assert.equal(recovery.discard(second.handle), false);
  assert.deepEqual(await recovery.discover(), { status: 'cancelled' });
});

test('activation reopens and re-proves an actual encrypted character before one local scope adoption', async () => {
  const f = await encryptedFixture(), adoptions = [];
  const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async options => {
    assert.equal(f.opened.length, 2, 'activation must reopen the retained candidate rather than trust its old vault');
    assert.equal(options.scope, scopeFor(RELAY)); assert.equal(options.sourceScope, f.candidate.scope);
    assert.equal(options.publicKey, f.key.publicKey); assert.equal(options.crypto, webcrypto);
    assert.equal(options.signal.aborted, false); assert.equal(options.isCurrent(), true);
    adoptions.push(options); return { adopted: true };
  } });
  const found = await recovery.discover(); assert.equal(found.status, 'verified_character');
  const result = await recovery.activate(found.handle);
  assert.deepEqual(result, { status: 'activated' }); assertSafeResult(result, [f.key.publicKey, f.candidate.scope]);
  assert.equal(adoptions.length, 1); assert.equal(f.opened.length, 2); assert(f.closed.length >= 2); f.assertUnchanged();
  assert.deepEqual(await recovery.activate(found.handle), { status: 'unavailable' });
  assert.equal(adoptions.length, 1, 'a consumed handle never adopts twice'); recovery.close();
});

test('unknown, discarded and superseded proof handles cannot adopt a key', async () => {
  const f = await portFixture(); let adoptions = 0;
  const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
  assert.deepEqual(await recovery.activate('invented-proof-handle'), { status: 'unavailable' });
  const discarded = await recovery.discover(); assert.equal(recovery.discard(discarded.handle), true);
  assert.deepEqual(await recovery.activate(discarded.handle), { status: 'unavailable' });
  const superseded = await recovery.discover(); await recovery.discover();
  assert.deepEqual(await recovery.activate(superseded.handle), { status: 'unavailable' });
  assert.equal(adoptions, 0); recovery.close();
});

for (const graph of ['index', 'profile']) for (const field of ['cid', 'descriptorUrl', 'nativeRevision', 'recordCid']) {
  test('activation refuses a changed ' + graph + ' ' + field + ' and consumes its old proof handle', async () => {
    let changed = false, adoptions = 0;
    const f = await portFixture({ headHook: async (input, context) => {
      if (!changed || input.graphIri !== (graph === 'index' ? context.indexGraphIri : context.graphIri)) return undefined;
      return { ...context.head(input.graphIri), [field]: 'changed-' + field };
    } });
    const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
    const found = await recovery.discover(); assert.equal(found.status, 'verified_character'); changed = true;
    assert.deepEqual(await recovery.activate(found.handle), { status: 'conflict' });
    changed = false; assert.deepEqual(await recovery.activate(found.handle), { status: 'unavailable' });
    assert.equal(adoptions, 0); recovery.close();
  });
}

for (const defect of ['owner', 'graph', 'summary', 'private-payload', 'index-target']) {
  test('activation refuses changed ' + defect + ' evidence even when native heads look unchanged', async () => {
    let changed = false, adoptions = 0;
    const f = await portFixture({ loadHook: async (input, context) => {
      if (!changed) return undefined;
      if (input.graphIri === context.indexGraphIri) return defect === 'index-target'
        ? { graphIri: input.graphIri, head: context.head(input.graphIri), record: indexRecord('urn:graph:changed:target') } : undefined;
      const record = profileRecord(structuredClone({ v: 1, char: character }));
      if (defect === 'owner') record.ownerDid += '-changed';
      if (defect === 'summary') record.save.char.name = 'Different private character';
      if (defect === 'private-payload') record.save.char.inventory = ['different private progress'];
      return { graphIri: defect === 'graph' ? 'urn:graph:changed:character' : input.graphIri, head: context.head(input.graphIri), record };
    } });
    const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
    const found = await recovery.discover(); assert.equal(found.status, 'verified_character'); changed = true;
    const result = await recovery.activate(found.handle);
    assert.deepEqual(result, { status: 'conflict' }); assertSafeResult(result); assert.equal(adoptions, 0); recovery.close();
  });
}

test('activation reopens the exact candidate and refuses a changed retained public key before adoption', async () => {
  const f = await portFixture(); let adoptions = 0;
  const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
  const found = await recovery.discover();
  f.options.candidateSource.openVault = async () => ({ publicKey: async () => Buffer.alloc(32, 11).toString('base64'), open: async value => value });
  assert.deepEqual(await recovery.activate(found.handle), { status: 'conflict' }); assert.equal(adoptions, 0); recovery.close();
});

test('a concurrent local adoption conflict cannot report the retained key as activated', async () => {
  const f = await portFixture(); let adoptions = 0;
  const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => {
    adoptions++; throw Object.assign(Error('another local key selection won'), { code: 'recovery_conflict' });
  } });
  const found = await recovery.discover();
  assert.deepEqual(await recovery.activate(found.handle), { status: 'conflict' });
  assert.deepEqual(await recovery.activate(found.handle), { status: 'unavailable' }); assert.equal(adoptions, 1); recovery.close();
});

for (const boundary of ['abort', 'session', 'close']) {
  test('late ' + boundary + ' cancellation prevents the adoption helper from committing its local link', { timeout: 3000 }, async () => {
    const f = await portFixture(), controller = new AbortController();
    let current = true, entered, release, settled, commits = 0;
    const started = new Promise(resolve => { entered = resolve; }), finished = new Promise(resolve => { settled = resolve; });
    const recovery = createRetainedCharacterRecovery({ ...f.options, signal: controller.signal, isCurrent: () => current,
      adoptCandidate: async options => {
        entered(); await new Promise(resolve => { release = resolve; });
        try {
          if (options.signal.aborted || !options.isCurrent()) throw Object.assign(Error('owner cancelled'), { code: 'recovery_cancelled' });
          commits++; return { adopted: true };
        } finally { settled(); }
      } });
    const found = await recovery.discover(), pending = recovery.activate(found.handle); await started;
    if (boundary === 'abort') controller.abort(); else if (boundary === 'session') current = false; else recovery.close();
    release(); assert.deepEqual(await pending, { status: 'cancelled' }); await finished;
    assert.equal(commits, 0); recovery.close();
  });
}

test('a session switch during activation re-proof never reaches local adoption', async () => {
  let activating = false, current = true, adoptions = 0;
  const f = await portFixture({ loadHook: async () => { if (activating) current = false; return undefined; } });
  const recovery = createRetainedCharacterRecovery({ ...f.options, isCurrent: () => current,
    adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
  const found = await recovery.discover(); activating = true;
  assert.deepEqual(await recovery.activate(found.handle), { status: 'cancelled' }); assert.equal(adoptions, 0); recovery.close();
});

test('closing a controller cancels activation and discards every retained approval handle', async () => {
  const f = await portFixture(); let adoptions = 0;
  const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
  const found = await recovery.discover(); recovery.close();
  assert.deepEqual(await recovery.activate(found.handle), { status: 'cancelled' }); assert.equal(adoptions, 0);
});

test('an encrypted recovery file proves its old-scope key in memory and persists only on separate activation', async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), adoptions = [];
  const passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase), unchangedFile = JSON.stringify(file);
  let protectedRecord;
  const crypto = { randomUUID: () => webcrypto.randomUUID(), getRandomValues: bytes => webcrypto.getRandomValues(bytes),
    subtle: new Proxy(webcrypto.subtle, { get(target, name) {
      if (name === 'encrypt') return async (algorithm, key, bytes) => {
        const ciphertext = await target.encrypt(algorithm, key, bytes);
        protectedRecord = { key, iv: new Uint8Array(algorithm.iv), ciphertext }; return ciphertext;
      };
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } }) };
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { crypto, adoptCandidate: async options => { adoptions.push(options); return { adopted: true }; } }));
  const result = await recovery.restore(file, passphrase);
  assert.equal(result.status, 'verified_character'); assert.equal(result.summary.name, character.name);
  assertSafeResult(result, [file.publicKey, file.scope, file.ciphertext, passphrase]); assert.equal(JSON.stringify(file), unchangedFile);
  assert.equal(keyStorage.map.size, 0); assert.equal(keyStorage.writes.length, 0, 'file proof must not persist a key before owner activation');
  assert.equal(await keyStorage.load(scopeFor(RELAY)), null); assert.equal(adoptions.length, 0, 'import proof alone cannot activate a key');
  assert.deepEqual(await recovery.activate(result.handle), { status: 'activated' }); assert.equal(adoptions.length, 1);
  assert.deepEqual([...keyStorage.map.keys()], [file.scope]); assert.equal(keyStorage.map.get(file.scope).publicKey, file.publicKey);
  const persisted = keyStorage.map.get(file.scope);
  assert.equal(persisted.wrappingKey.extractable, false); assert.equal(persisted.wrappingKey, protectedRecord.key);
  assert.deepEqual(persisted.iv, protectedRecord.iv); assert.deepEqual(persisted.ciphertext, protectedRecord.ciphertext, 'activation preserves the original SDK protection and AAD');
  assert(keyStorage.attempts.every(attempt => attempt.options.signal && typeof attempt.options.isCurrent === 'function'));
  f.assertUnchanged(); recovery.close();
});

test('an encrypted empty-character recovery file verifies emptiness without creating a character', async () => {
  const f = await encryptedFixture({ save: { v: 1, char: null } }), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase';
  const file = await f.exportRecovery(passphrase), recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage));
  const result = await recovery.restore(file, passphrase);
  assert.equal(result.status, 'verified_empty'); assert.equal(result.summary, undefined); assert.equal(typeof result.handle, 'string');
  assertSafeResult(result, [file.publicKey, file.scope, passphrase]); assert.equal(keyStorage.map.size, 0); assert.equal(keyStorage.writes.length, 0);
  assert.equal(await keyStorage.load(scopeFor(RELAY)), null); f.assertUnchanged(); recovery.close();
});

test('mutation of the caller file during recovery derivation cannot redirect the imported scope or key', { timeout: 5000 }, async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const originalScope = file.scope, originalKey = file.publicKey; let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const crypto = { randomUUID: () => webcrypto.randomUUID(), getRandomValues: bytes => webcrypto.getRandomValues(bytes),
    subtle: new Proxy(webcrypto.subtle, { get(target, name) {
      if (name === 'deriveKey') return async (...args) => {
        const key = await target.deriveKey(...args); entered(); await new Promise(resolve => { release = resolve; }); return key;
      };
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } }) };
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { crypto, adoptCandidate: async () => ({ adopted: true }) })), pending = recovery.restore(file, passphrase);
  await started; file.scope = scopeFor(OLD_RELAY, OWNER + '-changed'); file.publicKey = Buffer.alloc(32, 12).toString('base64'); release();
  const result = await pending; assert.equal(result.status, 'verified_character');
  assert.equal(keyStorage.map.size, 0); assert.deepEqual(await recovery.activate(result.handle), { status: 'activated' });
  assert.deepEqual([...keyStorage.map.keys()], [originalScope]); assert.equal(keyStorage.map.get(originalScope).publicKey, originalKey);
  assertSafeResult(result, [originalScope, originalKey, passphrase]); f.assertUnchanged(); recovery.close();
});

test('wrong recovery phrases and foreign or malformed file contracts create no source key or approval handle', async () => {
  const f = await encryptedFixture(), passphrase = 'fixture private recovery passphrase', original = await f.exportRecovery(passphrase);
  const cases = [
    ['phrase', file => file, 'wrong private recovery passphrase'],
    ['owner', file => ({ ...file, scope: scopeFor(OLD_RELAY, OWNER + '-foreign') })],
    ['pod', file => ({ ...file, scope: scopeFor(OLD_RELAY, OWNER, 'foreign-pod') })],
    ['relay', file => ({ ...file, scope: scopeFor('http://insecure.example') })],
    ['scope version', file => ({ ...file, scope: JSON.stringify(['interego-client-key/v2', OLD_RELAY, OWNER, 'recovery-owner']) })],
    ['KDF', file => ({ ...file, kdf: 'unrecognized-kdf' })],
    ['iterations', file => ({ ...file, iterations: 1 })],
    ['public key', file => ({ ...file, publicKey: 'not-a-valid-key' })],
  ];
  for (const [name, mutate, phrase] of cases) {
    const keyStorage = importStorage(), file = mutate(structuredClone(original)), before = JSON.stringify(file);
    const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage));
    const result = await recovery.restore(file, phrase || passphrase);
    assert.deepEqual(result, { status: 'unavailable' }, name); assertSafeResult(result, [original.publicKey, passphrase]);
    assert.equal(keyStorage.writes.length, 0, name); assert.equal(keyStorage.map.size, 0, name); assert.equal(JSON.stringify(file), before, name);
    recovery.close();
  }
  assert.equal(f.opened.length, 0); f.assertUnchanged();
});

test('a different canonical key is preserved and prevents importing any recovery source key', async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase';
  await new ClientKeyVault(scopeFor(RELAY), keyStorage, webcrypto).create();
  const original = [...keyStorage.map], before = keyStorage.writes.length, file = await f.exportRecovery(passphrase);
  assert.notEqual(keyStorage.map.get(scopeFor(RELAY)).publicKey, file.publicKey);
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage));
  assert.deepEqual(await recovery.restore(file, passphrase), { status: 'conflict' });
  assert.equal(keyStorage.writes.length, before); assert.deepEqual([...keyStorage.map], original); assert.equal(f.opened.length, 0);
  f.assertUnchanged(); recovery.close();
});

test('failed remote proof persists no uploaded key and never selects another candidate', async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { createClient: options => {
    const client = f.options.createClient(options);
    return { ...client, load: async () => { throw Object.assign(Error('this file does not open the current character'), { code: 'cannot_decrypt' }); } };
  } }));
  const result = await recovery.restore(file, passphrase);
  assert.deepEqual(result, { status: 'unavailable' }); assertSafeResult(result, [file.publicKey, passphrase]);
  assert.equal(keyStorage.map.size, 0, 'a file that failed proof must never occupy a persistent source or canonical slot');
  assert.equal(keyStorage.writes.length, 0); assert.equal(await keyStorage.load(scopeFor(RELAY)), null);
  f.assertUnchanged(); recovery.close();
});

test('a valid canonical-scope file for the wrong random key cannot poison an empty persistent key slot', async () => {
  const f = await encryptedFixture({ keyRelay: RELAY }), keyStorage = importStorage(), foreignStorage = importStorage();
  const passphrase = 'fixture private recovery passphrase', foreignVault = new ClientKeyVault(scopeFor(RELAY), foreignStorage, webcrypto);
  await foreignVault.create(); const file = await foreignVault.backup(passphrase);
  assert.notEqual(file.publicKey, f.key.publicKey); assert.equal(file.scope, scopeFor(RELAY));
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { adoptCandidate: async () => assert.fail('wrong key cannot be adopted') }));
  const result = await recovery.restore(file, passphrase);
  assert.deepEqual(result, { status: 'unavailable' }); assertSafeResult(result, [file.publicKey, passphrase]);
  assert.equal(keyStorage.map.size, 0); assert.equal(keyStorage.writes.length, 0); f.assertUnchanged(); recovery.close();
});

test('a concurrent different source key prevents activation without replacing either retained key', async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { adoptCandidate: async () => assert.fail('conflicting source cannot be adopted') }));
  const found = await recovery.restore(file, passphrase); assert.equal(found.status, 'verified_character'); assert.equal(keyStorage.map.size, 0);
  await new ClientKeyVault(file.scope, keyStorage, webcrypto).create(); const concurrent = keyStorage.map.get(file.scope), before = keyStorage.writes.length;
  assert.notEqual(concurrent.publicKey, file.publicKey);
  assert.deepEqual(await recovery.activate(found.handle), { status: 'conflict' });
  assert.equal(keyStorage.map.get(file.scope), concurrent); assert.equal(keyStorage.writes.length, before);
  assert.equal(await keyStorage.load(scopeFor(RELAY)), null); f.assertUnchanged(); recovery.close();
});

test('a concurrent canonical key wins before activation can persist an uploaded source key', async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { adoptCandidate: async () => assert.fail('canonical conflict cannot be adopted') }));
  const found = await recovery.restore(file, passphrase); assert.equal(found.status, 'verified_character');
  await new ClientKeyVault(scopeFor(RELAY), keyStorage, webcrypto).create(); const concurrent = keyStorage.map.get(scopeFor(RELAY)), before = keyStorage.writes.length;
  assert.deepEqual(await recovery.activate(found.handle), { status: 'conflict' });
  assert.deepEqual([...keyStorage.map.keys()], [scopeFor(RELAY)]); assert.equal(keyStorage.map.get(scopeFor(RELAY)), concurrent);
  assert.equal(keyStorage.writes.length, before); f.assertUnchanged(); recovery.close();
});

test('an alias adopted during uploaded-key insertion wins without being shadowed by a protected key', async () => {
  const f = await encryptedFixture(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const aliasAddress = ownerKeyAliasAddress(file.scope), alias = { schema: 'hallowmarch-key-scope/v1',
    sourceScope: scopeFor('https://earlier-relay.example'), publicKey: file.publicKey };
  const keyStorage = importStorage({ beforeCreate: async options => {
    assert.deepEqual(options.absentKeys, [aliasAddress]); keyStorage.map.set(aliasAddress, alias);
  } });
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, {
    adoptCandidate: async () => assert.fail('a concurrent recovery choice must not be replaced'),
  }));
  const found = await recovery.restore(file, passphrase); assert.equal(found.status, 'verified_character');
  assert.deepEqual(await recovery.activate(found.handle), { status: 'conflict' });
  assert.deepEqual([...keyStorage.map], [[aliasAddress, alias]]); assert.equal(keyStorage.writes.length, 0);
  assertSafeResult(found, [file.scope, file.publicKey, passphrase]); f.assertUnchanged(); recovery.close();
});

for (const boundary of ['abort', 'close']) test(boundary + ' after uploaded-file proof persists no key before activation', async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const controller = new AbortController();
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { signal: controller.signal,
    adoptCandidate: async () => assert.fail('cancelled proof cannot be activated') }));
  const found = await recovery.restore(file, passphrase); assert.equal(found.status, 'verified_character');
  if (boundary === 'abort') controller.abort(); else recovery.close();
  assert.deepEqual(await recovery.activate(found.handle), { status: 'cancelled' });
  assert.equal(keyStorage.map.size, 0); assert.equal(keyStorage.writes.length, 0); f.assertUnchanged(); recovery.close();
});

test('cancellation after source insertion preserves that committed protected key without creating an alias', { timeout: 5000 }, async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const controller = new AbortController(); let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { signal: controller.signal, adoptCandidate: async options => {
    entered(); await new Promise(resolve => { release = resolve; });
    if (options.signal.aborted || !options.isCurrent()) throw Object.assign(Error('cancelled alias adoption'), { code: 'recovery_cancelled' });
    assert.fail('cancelled alias adoption cannot commit');
  } }));
  const found = await recovery.restore(file, passphrase); const pending = recovery.activate(found.handle); await started;
  assert.deepEqual([...keyStorage.map.keys()], [file.scope]); const committed = keyStorage.map.get(file.scope);
  controller.abort(); release(); assert.deepEqual(await pending, { status: 'cancelled' });
  assert.equal(keyStorage.map.get(file.scope), committed); assert.equal(committed.publicKey, file.publicKey);
  assert.equal(keyStorage.writes.length, 1); assert.equal(await keyStorage.load(scopeFor(RELAY)), null); f.assertUnchanged(); recovery.close();
});

test('a file already bound to the canonical scope restores and activates without an alias adoption', async () => {
  const f = await encryptedFixture({ keyRelay: RELAY }), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase';
  const file = await f.exportRecovery(passphrase); let adoptions = 0;
  assert.equal(file.scope, scopeFor(RELAY));
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { adoptCandidate: async () => { adoptions++; return { adopted: true }; } }));
  const found = await recovery.restore(file, passphrase); assert.equal(found.status, 'verified_character');
  assert.equal(keyStorage.map.size, 0); assert.equal(keyStorage.writes.length, 0);
  assert.deepEqual(await recovery.activate(found.handle), { status: 'activated' }); assert.equal(adoptions, 0);
  assert.deepEqual([...keyStorage.map.keys()], [scopeFor(RELAY)]); f.assertUnchanged(); recovery.close();
});

test('a discovered canonical candidate activates after fresh proof without attempting a self-alias', async () => {
  const f = await portFixture(); f.candidate.scope = scopeFor(RELAY); let adoptions = 0;
  const recovery = createRetainedCharacterRecovery({ ...f.options, adoptCandidate: async () => { adoptions++; return { adopted: true }; } });
  const found = await recovery.discover(); assert.equal(found.status, 'verified_character');
  assert.deepEqual(await recovery.activate(found.handle), { status: 'activated' }); assert.equal(adoptions, 0); recovery.close();
});

test('cancelling a pending recovery derivation returns without creating a protected source key', { timeout: 3000 }, async () => {
  const f = await encryptedFixture(), keyStorage = importStorage(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const controller = new AbortController(); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const crypto = { randomUUID: () => webcrypto.randomUUID(), getRandomValues: bytes => webcrypto.getRandomValues(bytes),
    subtle: new Proxy(webcrypto.subtle, { get(target, name) {
      if (name === 'deriveKey') return () => { entered(); return new Promise(() => {}); };
      const value = Reflect.get(target, name); return typeof value === 'function' ? value.bind(target) : value;
    } }) };
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { crypto, signal: controller.signal }));
  const pending = recovery.restore(file, passphrase); await started; controller.abort();
  assert.deepEqual(await pending, { status: 'cancelled' }); assert.equal(keyStorage.writes.length, 0); assert.equal(f.opened.length, 0); recovery.close();
});

for (const boundary of ['abort', 'session']) test('late ' + boundary + ' cancellation fences persistent source insertion during activation', { timeout: 3000 }, async () => {
  const f = await encryptedFixture(), passphrase = 'fixture private recovery passphrase', file = await f.exportRecovery(passphrase);
  const controller = new AbortController(); let current = true, entered, release, settled;
  const started = new Promise(resolve => { entered = resolve; }), finished = new Promise(resolve => { settled = resolve; });
  const keyStorage = importStorage({ beforeCreate: async options => {
    assert(options.signal); assert.equal(typeof options.isCurrent, 'function'); entered();
    try { await new Promise(resolve => { release = resolve; }); } finally { settled(); }
  } });
  const recovery = createRetainedCharacterRecovery(importOptions(f, keyStorage, { signal: controller.signal, isCurrent: () => current,
    adoptCandidate: async () => assert.fail('a cancelled source insertion must not reach alias adoption') }));
  const found = await recovery.restore(file, passphrase); assert.equal(found.status, 'verified_character');
  assert.equal(keyStorage.map.size, 0); const pending = recovery.activate(found.handle); await started;
  if (boundary === 'abort') controller.abort(); else current = false;
  release(); assert.deepEqual(await pending, { status: 'cancelled' }); await finished;
  assert.equal(keyStorage.writes.length, 0); assert.equal(keyStorage.map.size, 0); assert.equal(f.opened.length, 0); recovery.close();
});

test('a scan deadline aborts a stalled candidate catalogue without a vault or private result', { timeout: 2000 }, async () => {
  const f = await portFixture(); let observed;
  f.options.candidateSource.list = async ({ signal }) => { observed = signal; return new Promise(() => {}); };
  const recovery = createRetainedCharacterRecovery({ ...f.options, limits: { deadlineMs: 20 } });
  assert.deepEqual(await recovery.discover(), { status: 'unavailable' }); assert.equal(observed.aborted, true); assert.equal(f.opened.length, 0); recovery.close();
});

test('the default browser source retries a failed database inventory on the same recovery controller', async () => {
  let inventories = 0, opens = 0;
  const indexedDB = { async databases() {
    if (++inventories === 1) throw Error('temporary fixture storage failure');
    return [];
  }, open() { opens++; assert.fail('an absent database must never be opened or created'); } };
  const recovery = createRetainedCharacterRecovery({ binding, relayUrl: RELAY, credential, indexedDB, crypto: webcrypto,
    createClient: () => assert.fail('an empty retained-key inventory must not open the owner pod') });
  assert.deepEqual(await recovery.discover(), { status: 'unavailable' });
  assert.deepEqual(await recovery.discover(), { status: 'no_match' });
  assert.equal(inventories, 2); assert.equal(opens, 0); recovery.close();
});

test('a late blocked database connection is closed without replacing the successful retry connection', async () => {
  const requests = [], transactions = [], closes = { obsolete: 0, current: 0 };
  const emptyDatabase = label => ({ objectStoreNames: { contains: name => name === 'keys' },
    transaction(store, mode) {
      assert.equal(store, 'keys'); assert.equal(mode, 'readonly'); transactions.push({ label, mode });
      const tx = { objectStore(name) {
        assert.equal(name, 'keys');
        return { openCursor() {
          const request = { result: null };
          queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()); });
          return request;
        } };
      }, abort() { queueMicrotask(() => tx.onabort?.()); } };
      return tx;
    }, close() { closes[label]++; } });
  const obsolete = emptyDatabase('obsolete'), current = emptyDatabase('current');
  const indexedDB = { databases: async () => [{ name: 'interego-client-keys-v1' }], open(name) {
    assert.equal(name, 'interego-client-keys-v1'); const request = {}; requests.push(request);
    queueMicrotask(() => {
      if (requests.length === 1) request.onblocked?.();
      else { request.result = current; request.onsuccess?.(); }
    });
    return request;
  } };
  const recovery = createRetainedCharacterRecovery({ binding, relayUrl: RELAY, credential, indexedDB, crypto: webcrypto,
    createClient: () => assert.fail('an empty retained-key database must not open the owner pod') });
  assert.deepEqual(await recovery.discover(), { status: 'unavailable' });
  assert.deepEqual(await recovery.discover(), { status: 'no_match' }); assert.equal(requests.length, 2);
  assert.deepEqual(closes, { obsolete: 0, current: 0 });
  requests[0].result = obsolete; requests[0].onsuccess();
  assert.deepEqual(closes, { obsolete: 1, current: 0 });
  assert.deepEqual(await recovery.discover(), { status: 'no_match' }); assert.equal(requests.length, 2);
  assert.deepEqual(transactions, [{ label: 'current', mode: 'readonly' }, { label: 'current', mode: 'readonly' }]);
  recovery.close(); assert.deepEqual(closes, { obsolete: 1, current: 1 });
});
