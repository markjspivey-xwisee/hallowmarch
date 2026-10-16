import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
globalThis.self = globalThis; // The browser bundle uses the browser CSPRNG port.
const { createNativePodClient } = await import('./client.mjs');
const { RelayMcpTransport } = await import('./vendor/interego-browser.mjs');
const IEP = 'https://markjspivey-xwisee.github.io/interego/ns/iep#';
const tools = ['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph', 'register_agent', 'publish_context'];
function keys() {
  const map = new Map();
  return { map, load: async scope => map.get(scope) || null,
    create: async (scope, record) => { if (!map.has(scope)) map.set(scope, record); return map.get(scope); } };
}
function fixture() {
  const owners = ['alice', 'bob']; const maps = Object.fromEntries(owners.map(owner => [owner, { agents: new Map(), heads: new Map(), records: new Map() }]));
  const calls = []; let n = 0, delayed = null, mode = 'normal', tamper = false, forked = false, badHash = false, forkAfterPublish = false;
  const ownerDid = owner => 'did:web:identity.example:users:' + owner;
  const podUrl = owner => 'https://pod.example/' + owner + '/';
  const apply = (owner, args, selected) => { const state = maps[owner]; state.heads.set(args.graph_iri, selected); state.records.set(selected.descriptorUrl, args); };
  async function dispatch(owner, name, args) {
    const state = maps[owner]; calls.push({ owner, name, args: structuredClone(args) });
    if (name === 'get_pod_status') return { pod: podUrl(owner), userId: owner, identity: { did: ownerDid(owner) }, sessionAgent: { did: 'did:web:identity.example:agents:session-' + owner } };
    if (name === 'get_current_head') return { urn: args.urn, podUrl: podUrl(owner), head: state.heads.get(args.urn) || null, forked, message: 'Native contract fixture head.' };
    if (name === 'register_agent') { state.agents.set(args.agent_id, args.encryption_public_key); return { agent: args.agent_id, scope: args.scope, registered: true }; }
    if (name === 'get_descriptor' && args.url === podUrl(owner) + 'agents') return { turtle: '@prefix iep: <' + IEP + '> .\n' + [...state.agents].map(([agent, key], i) => `<#agent-${i}> a iep:AuthorizedAgent ; iep:agentIdentity <${agent}> ; iep:encryptionPublicKey "${key}" .`).join('\n') };
    if (name === 'publish_context') {
      const current = state.heads.get(args.graph_iri);
      if (args.if_match && args.if_match !== current?.cid) return { error: 'precondition_failed', code: 412 };
      const selected = { descriptorUrl: podUrl(owner) + 'context-graphs/' + (++n) + '.ttl', cid: 'fixture-cid-' + n };
      if (mode === 'conflict') return { error: 'precondition_failed', code: 412 };
      if (mode === 'throw-before') throw Error('fixture network outage');
      if (mode === 'pending') delayed = () => apply(owner, args, selected);
      else apply(owner, args, selected);
      if (forkAfterPublish) forked = true;
      if (mode === 'throw-after') throw Error('fixture response lost');
      return { published: true, descriptorUrl: selected.descriptorUrl, status: mode === 'pending' ? 'pending' : 'published' };
    }
    if (name === 'get_descriptor') {
      const record = Object.values(maps).map(s => s.records.get(args.url)).find(Boolean);
      return { turtle: `<urn:proof> <${IEP}contentHash> "${badHash ? 'graph-nquads-sha256:' + '0'.repeat(64) : record?.content_digest}" .`,
        authorship: { authorshipVerified: true, descriptorBinding: { bound: true } } };
    }
    if (name === 'get_encrypted_graph') {
      const record = Object.values(maps).map(s => s.records.get(args.url)).find(Boolean);
      const envelope = JSON.parse(record.graph_content);
      if (tamper) envelope.content.ciphertext = (envelope.content.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.content.ciphertext.slice(1);
      return { url: args.url, encrypted: true, envelope: JSON.stringify(envelope) };
    }
    throw Error('Unexpected fixture operation');
  }
  const fetch = async (_url, init) => {
    const owner = init.headers.Authorization.slice('Bearer '.length); assert(owners.includes(owner));
    const req = JSON.parse(init.body); let result;
    if (req.method === 'tools/list') result = { tools: tools.map(name => ({ name })) };
    else result = { structuredContent: await dispatch(owner, req.params.name, req.params.arguments) };
    const body = JSON.stringify({ jsonrpc: '2.0', id: req.id, result });
    // Exercise the real SDK's JSON and Streamable HTTP SSE readers.
    return new Response(n % 2 ? 'event: message\ndata: ' + body + '\n\n' : body,
      { headers: { 'Content-Type': n % 2 ? 'text/event-stream' : 'application/json' } });
  };
  function client(owner, storage = keys()) {
    const credential = { kind: 'relay-oauth-bearer', accessToken: owner, method: 'webauthn', expiresAt: Date.now() + 3600000, refreshToken: null, clientId: 'fixture' };
    return createNativePodClient({ relayUrl: 'https://relay.example', credential, ownerDid: ownerDid(owner), podUrl: podUrl(owner),
      transport: new RelayMcpTransport('https://relay.example', credential, fetch), keyStorage: storage, crypto: webcrypto });
  }
  return { client, maps, calls, setMode: next => { mode = next; }, setTamper: value => { tamper = value; },
    setForkAfterPublish: value => { forkAfterPublish = value; },
    setForked: value => { forked = value; }, setBadHash: value => { badHash = value; }, release: () => { delayed?.(); delayed = null; } };
}

test('vendored browser bundle matches pinned provenance and contains no Node imports', async () => {
  const manifest = JSON.parse(await readFile(new URL('./vendor/interego-browser.manifest.json', import.meta.url)));
  const bytes = await readFile(new URL('./vendor/interego-browser.mjs', import.meta.url));
  assert.equal(manifest.revision, '87ee71626c015af3c1e7b9dac5579eff6899e8c1');
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.bytes, bytes.length); assert(!bytes.toString().includes('node:crypto'));
});
test('real client-held encryption, local readback and CAS update over SDK JSON/SSE transport', async () => {
  const f = fixture(), storage = keys(), alice = f.client('alice', storage);
  const status = await alice.connect(); assert.equal(status.keyPresent, false);
  const key = await alice.createKey(); assert.equal(key.scope, 'ReadOnly');
  assert(key.agentId.includes('/alice/agents#browser-encryption-'));
  const result = await alice.create({ record: { v: 1, text: 'secret field notes "quotes"\nnewline', count: 7 } });
  assert.equal(result.status, 'saved'); assert.equal(result.record.count, 7);
  const publication = f.calls.find(call => call.name === 'publish_context').args;
  assert.equal(publication.sealed_payload, true); assert.equal(publication.visibility, 'private');
  assert(!JSON.stringify(publication).includes('secret field notes')); assert(!('if_match' in publication));
  const envelope = JSON.parse(publication.graph_content); assert.equal(envelope.wrappedKeys.length, 1);
  assert.equal(envelope.wrappedKeys[0].recipientPublicKey, key.publicKey);
  const stored = [...storage.map.values()][0]; assert.equal(stored.wrappingKey.extractable, false);
  assert(!JSON.stringify(stored).includes('secretKey'));
  const updated = await alice.save({ graphIri: result.graphIri, record: { v: 2, count: 8 }, expectedHead: result.head });
  assert.equal(updated.status, 'saved'); assert.equal(updated.record.count, 8);
  const requests = f.calls.filter(call => call.name === 'publish_context'); assert.equal(requests[1].args.if_match, result.head.cid);
  await assert.rejects(alice.save({ graphIri: result.graphIri, record: { count: 9 }, expectedHead: result.head }), { code: 'conflict' });
  assert.equal(requests.length, 2);
});
test('ciphertext tampering and two-owner key isolation fail closed', async () => {
  const f = fixture(), alice = f.client('alice'), bob = f.client('bob');
  await alice.connect(); await alice.createKey(); await bob.connect(); await bob.createKey();
  const saved = await alice.create({ record: { personal: 'alice only' } });
  f.setTamper(true); await assert.rejects(alice.load({ graphIri: saved.graphIri }), { code: 'cannot_decrypt' });
  f.setTamper(false);
  f.setBadHash(true); await assert.rejects(alice.load({ graphIri: saved.graphIri }), { code: 'invalid_proof' }); f.setBadHash(false);
  // Even a malicious fixture copying Alice's ciphertext into Bob's pod cannot open it.
  f.maps.bob.heads.set(saved.graphIri, saved.head);
  await assert.rejects(bob.load({ graphIri: saved.graphIri }), { code: 'cannot_decrypt' });
  assert.equal((await alice.load({ graphIri: saved.graphIri })).record.personal, 'alice only');
});
test('a public-key registration conflict preserves the existing recipient and sends no replacement', async () => {
  const f = fixture(), alice = f.client('alice'); await alice.connect(); const key = await alice.createKey();
  f.maps.alice.agents.set(key.agentId, 'Q'.repeat(43) + '=');
  const before = f.calls.filter(call => call.name === 'register_agent').length;
  await assert.rejects(alice.registerKey(), { code: 'recipient_conflict' });
  assert.equal(f.calls.filter(call => call.name === 'register_agent').length, before);
  assert.equal(f.maps.alice.agents.get(key.agentId), 'Q'.repeat(43) + '=');
});
test('save before native key registration is refused; missing browser keys never mint a replacement on read', async () => {
  const f = fixture(), alice = f.client('alice'); await alice.connect();
  await assert.rejects(alice.create({ record: {} }), { code: 'key_registration_required' });
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 0);
  assert.equal((await alice.keyStatus()).keyPresent, false);
});
test('pending and lost acknowledgements never become local primary or false saved state', async () => {
  const f = fixture(), alice = f.client('alice'); await alice.connect(); await alice.createKey();
  f.setMode('pending'); const pending = await alice.create({ record: { value: 1 } });
  assert.equal(pending.saved, false); assert.equal(pending.status, 'pending');
  f.release(); const saved = await alice.confirm(pending.operationId); assert.equal(saved.saved, true);
  f.setMode('throw-after'); const uncertain = await alice.save({ graphIri: saved.graphIri, expectedHead: saved.head, record: { value: 2 } });
  assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.saved, false);
  const recovered = await alice.confirm(uncertain.operationId); assert.equal(recovered.record.value, 2); assert(recovered.saved);
  f.setMode('conflict'); await assert.rejects(alice.save({ graphIri: recovered.graphIri, expectedHead: recovered.head, record: {} }), { code: 'conflict' });
  f.setForked(true); await assert.rejects(alice.load({ graphIri: saved.graphIri }), { code: 'conflict' });
});
test('encrypted recovery restores exact key across browser storage and refuses wrong owner or password', async () => {
  const f = fixture(), alice = f.client('alice'); await alice.connect(); const first = await alice.createKey();
  const saved = await alice.create({ record: { portable: true } });
  const backup = await alice.exportRecovery('a long test recovery passphrase');
  assert.equal(backup.publicKey, first.publicKey); assert(!JSON.stringify(backup).includes('secretKey'));
  const restored = f.client('alice'); await restored.connect();
  await assert.rejects(restored.load({ graphIri: saved.graphIri }), { code: 'key_required' });
  await assert.rejects(restored.restoreRecovery(backup, 'wrong long passphrase'));
  assert.equal((await restored.keyStatus()).keyPresent, false);
  assert.equal((await restored.restoreRecovery(backup, 'a long test recovery passphrase')).publicKey, first.publicKey);
  assert.equal((await restored.load({ graphIri: saved.graphIri })).record.portable, true);
  const bob = f.client('bob'); await bob.connect();
  await assert.rejects(bob.restoreRecovery(backup, 'a long test recovery passphrase'));
  assert.equal((await bob.keyStatus()).keyPresent, false);
  alice.close(); await assert.rejects(alice.load({ graphIri: saved.graphIri }), { code: 'not_connected' });
});
test('explicit named creation and keyless metadata remain owner-pod scoped and never overwrite an existing head', async () => {
  const f = fixture(), alice = f.client('alice'), bob = f.client('bob'), graphIri = 'urn:graph:fixture:owner-index';
  await alice.connect(); await bob.connect();
  assert.equal(await alice.currentHead({ graphIri }), null);
  await alice.createKey();
  const result = await alice.createAt({ graphIri, record: { schema: 'fixture-owner-index/v1', target: 'urn:graph:fixture:private-profile' } });
  assert.equal(result.saved, true); assert.equal(result.graphIri, graphIri);
  const keyless = f.client('alice'); await keyless.connect();
  assert.deepEqual(await keyless.currentHead({ graphIri }), result.head);
  assert.equal((await keyless.keyStatus()).keyPresent, false);
  await assert.rejects(keyless.load({ graphIri }), { code: 'key_required' });
  assert.equal(await bob.currentHead({ graphIri }), null, 'another owner does not see this index head in their pod');
  const before = f.calls.filter(call => call.name === 'publish_context').length;
  await assert.rejects(alice.createAt({ graphIri, record: { replace: true } }), { code: 'conflict' });
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, before);
  assert.equal((await alice.load({ graphIri })).record.schema, 'fixture-owner-index/v1');
});
test('named lost acknowledgement confirms the original operation; a concurrent fork is never reported saved', async () => {
  const f = fixture(), alice = f.client('alice'); await alice.connect(); await alice.createKey();
  f.setMode('throw-after');
  const uncertain = await alice.createAt({ graphIri: 'urn:graph:fixture:lost-index', record: { ownerIndex: true } });
  assert.equal(uncertain.saved, false); assert.equal(uncertain.status, 'uncertain');
  assert.equal((await alice.confirm(uncertain.operationId)).saved, true);
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
  f.setMode('normal'); f.setForkAfterPublish(true);
  const fork = await alice.createAt({ graphIri: 'urn:graph:fixture:forked-index', record: { ownerIndex: true } });
  assert.equal(fork.saved, false);
  await assert.rejects(alice.confirm(fork.operationId), { code: 'conflict' });
  await assert.rejects(alice.currentHead({ graphIri: fork.graphIri }), { code: 'conflict' });
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 2);
});
