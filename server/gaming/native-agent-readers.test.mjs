import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createNativeAgentProofReaders, ownerAgentGrantGraph } from './native-agent-readers.js';

// Like the other real-SDK tests, accept the explicitly built reviewed checkout.
// Otherwise use installed native packages (as in the production image). Missing
// proof dependencies fail this suite; there is no skipped or mock verifier path.
const sdkRoot = process.env.INTEREGO_SDK_TEST_ROOT;
const [nativeCore, nativeSolid] = await Promise.all(['core', 'solid'].map(name => import(sdkRoot
  ? pathToFileURL(resolve(sdkRoot, 'packages', name, 'dist/index.js')).href : '@interego/' + name)));

// Synthetic HTTP service only. Signatures, VC generation/parsing, raw CID,
// graph wrapping, graph extraction and authorship verification use real SDKs.
// Passing these tests is not evidence of live pod publication or delegation.
const relayWallet = await nativeCore.createWallet('agent', 'native-reader-relay-fixture');
const otherWallet = await nativeCore.createWallet('agent', 'native-reader-untrusted-fixture');
const signer = nativeCore.makeWalletDelegationSigner(relayWallet);
const RELAY = 'https://relay.example';
const IDENTITY = 'https://identity.example';
const STORE = 'https://pods.example/';
const OPERATIONS = RELAY + '/.well-known/operations';
const GRANT_ID = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
const GRAPH = 'urn:graph:hallowmarch:owner-agent-grant:test';
const OWNER_DID = 'did:web:identity.example:users:owner-a';
const OWNER_WEBID = IDENTITY + '/users/owner-a/profile#me';
const OWNER_POD = STORE + 'owner-a/';
const PUBLISHER = 'did:web:identity.example:agents:publisher-owner-a';
const AGENT = 'did:web:identity.example:agents:companion-agent-a';
const PIN = 'did:ethr:' + relayWallet.address.toLowerCase();
const OP_NAMES = ['get_current_head', 'get_descriptor', 'verify_agent'];
const TARGETS = Object.fromEntries(OP_NAMES.map(name => [name, RELAY + '/advertised/' + name]));
const iid = did => did.slice(did.lastIndexOf(':') + 1);
const clone = value => structuredClone(value);

async function fixture(options = {}) {
  let clock = Date.parse('2026-10-16T12:00:00Z');
  const requests = [], lookups = [], documents = new Map();
  let catalogTransform = options.catalogTransform ?? (x => x), schemaTransform = options.schemaTransform ?? (x => x);
  let headTransform = x => x, descriptorTransform = x => x, verificationTransform = x => x;
  let documentTransform = (_url, value) => value, lookupTransform = x => x;
  let headCalls = 0;
  const grant = { schema: 'interego.gaming.owner-agent-grant/v1', id: GRANT_ID, issuer: OWNER_DID,
    actor: AGENT, applicationId: 'did:web:identity.example:users:hallowmarch-game', audience: 'https://game.example',
    roomId: 'room-a', entityId: 'pet-a', role: 'pet', actions: ['observe', 'move', 'attack'],
    notBefore: '2026-10-16T11:59:59.000Z', expiresAt: '2026-10-16T12:30:00.000Z',
    maxCommandsPerSecond: 5, revoked: false };
  const state = { grant, descriptorUrl: OWNER_POD + 'context-graphs/grant.ttl', turtle: '', graph: '', cid: '', proof: null, payload: '' };
  const installIdentity = async (agentDid, ownerId) => {
    const pod = STORE + ownerId + '/', ownerDid = 'did:web:identity.example:users:' + ownerId;
    const webId = IDENTITY + '/users/' + ownerId + '/profile#me';
    const row = { agentId: agentDid, delegatedBy: webId, scope: 'ReadWrite', validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z' };
    const profile = nativeCore.createOwnerProfile(webId, 'Fixture owner', [row]);
    const credential = await nativeCore.createSignedDelegationCredential(profile, row, pod, signer);
    credential.issuanceDate = '2026-10-16T11:00:00.000Z';
    const payload = nativeCore.canonicalCredentialPayload(credential), proof = await signer(payload);
    credential.proof = { ...credential.proof, created: '2026-10-16T11:00:00.000Z', proofValue: proof.signature, signerAddress: proof.signerAddress, verificationMethod: proof.verificationMethod };
    documents.set(pod + 'agents', nativeCore.ownerProfileToTurtle(profile));
    documents.set(pod + 'credentials/' + encodeURIComponent(agentDid) + '.jsonld', JSON.parse(nativeCore.delegationCredentialToJsonLd(credential)));
    documents.set(IDENTITY + '/agents/' + iid(agentDid) + '/did.json', { id: agentDid, controller: ownerDid,
      service: [
        { id: agentDid + '#pod', type: 'SolidStorage', serviceEndpoint: pod },
        { id: agentDid + '#relay', type: 'InteregoRelay', serviceEndpoint: RELAY + '/' },
        { id: agentDid + '#registry', type: 'ContextGraphsAgentRegistry', serviceEndpoint: pod + 'agents' },
      ] });
  };
  await installIdentity(PUBLISHER, 'owner-a'); await installIdentity(AGENT, 'agent-a');
  const rebuild = async ({ payload = ownerAgentGrantGraph({ graphIri: GRAPH, grant: state.grant }), proofInputs = {}, signingWallet = relayWallet } = {}) => {
    const contentHash = nativeCore.canonicalGraphDigest(payload); assert(contentHash, 'fixture graph must be actual parseable RDF');
    state.payload = payload;
    state.proof = await nativeCore.createSignedAuthorship({ agentId: PUBLISHER, agentDid: PUBLISHER,
      ownerWebId: OWNER_WEBID, descriptorId: state.descriptorUrl, created: new Date(clock).toISOString(), contentHash,
      ...proofInputs }, nativeCore.makeWalletDelegationSigner(signingWallet));
    state.turtle = '@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .\n'
      + '@prefix dct: <http://purl.org/dc/terms/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n'
      + `<${state.descriptorUrl}> a iep:ContextDescriptor ; iep:describes <${GRAPH}> .\n`
      + nativeSolid.buildAuthorshipProofBlock(state.proof);
    state.graph = nativeSolid.wrapAsTriG(state.turtle, payload, GRAPH);
    state.cid = nativeCore.computeCid(state.turtle);
  };
  await rebuild();
  const catalog = () => catalogTransform({ '@id': OPERATIONS, 'hydra:member': OP_NAMES.map(name => ({ '@id': 'urn:iep:operation:' + name,
    action: RELAY + '/ns/iep/action/relay/' + name, target: TARGETS[name], method: 'POST',
    expects: OPERATIONS + '/' + name + '/input',
    'hydra:expectsHeader': [{ 'hydra:headerName': 'Authorization', 'hydra:required': false }] })) });
  const fetcher = async (input, init = {}) => {
    const url = String(input), method = init.method ?? 'GET'; requests.push({ url, ...init, method });
    assert.equal(new Headers(init.headers).get('authorization'), null, 'public proof reads never carry a bearer');
    assert.equal(init.redirect, 'error', 'discovery and pod reads never follow unverified redirects');
    if (url === OPERATIONS) return Response.json(catalog());
    const name = OP_NAMES.find(name => url === OPERATIONS + '/' + name + '/input');
    if (name) {
      const properties = name === 'get_current_head' ? { urn: { type: 'string' }, pod_url: { type: 'string' } }
        : name === 'get_descriptor' ? { url: { type: 'string' } } : { agent_id: { type: 'string' }, pod_url: { type: 'string' } };
      return Response.json(schemaTransform({ $id: url, type: 'object', properties,
        ...(name === 'get_current_head' ? { anyOf: [{ required: ['urn'] }, { required: ['graph_iri'] }] }
          : { required: [name === 'get_descriptor' ? 'url' : 'agent_id'] }) }, name));
    }
    const operation = OP_NAMES.find(name => url === TARGETS[name]);
    if (operation) {
      assert.equal(method, 'POST'); const args = JSON.parse(init.body);
      if (operation === 'get_current_head') {
        headCalls++; assert.equal(args.urn, GRAPH); assert.equal(args.pod_url, OWNER_POD);
        return Response.json(headTransform({ urn: GRAPH, podUrl: OWNER_POD, head: { descriptorUrl: state.descriptorUrl, cid: state.cid }, forked: false }, headCalls));
      }
      if (operation === 'get_descriptor') {
        assert.equal(args.url, state.descriptorUrl);
        return Response.json(descriptorTransform({ url: state.descriptorUrl, turtle: state.turtle,
          graph: { url: OWNER_POD + 'graphs/grant.trig', content: state.graph, encrypted: false },
          authorship: { authorshipVerified: true, contentBinding: 'bound', descriptorBinding: { bound: true, basis: 'slug-and-owner' },
            effectiveTrustLevel: 'CryptographicallyVerified', signedBy: PUBLISHER, verificationMethod: PIN } }));
      }
      const ownerId = args.agent_id === PUBLISHER ? 'owner-a' : args.agent_id === AGENT ? 'agent-a' : null;
      assert(ownerId, 'only requested native identity is examined');
      const pod = STORE + ownerId + '/', owner = IDENTITY + '/users/' + ownerId + '/profile#me';
      assert.equal(args.pod_url, pod, 'peer verification uses the agent source pod, not the caller pod');
      return Response.json(verificationTransform({ subjectPodUrl: pod, subject_pod_url: pod, subject_pod_name: ownerId,
        verified: true, valid: true, trustLevel: 'CryptographicallyVerified', chainLength: 1,
        owner, agent: args.agent_id, scope: 'ReadWrite', delegationChain: { anchored: true, owner, agent: args.agent_id, scope: 'ReadWrite', length: 1 },
        signing: { relayAnchor: relayWallet.address, credentialAnchor: relayWallet.address, credentialAgentId: args.agent_id, canSignDelegatedRequests: true },
        enforcement: { enforced: true, scope: 'ReadWrite', writeEligible: true, basis: 'signed-chain' } }, args.agent_id));
    }
    if (documents.has(url)) {
      const value = documentTransform(url, clone(documents.get(url)));
      return typeof value === 'string' ? new Response(value, { headers: { 'content-type': 'text/turtle' } }) : Response.json(value);
    }
    throw new Error('Unexpected test transport target: ' + url);
  };
  const settings = { nativeCore, nativeSolid, operationsUrl: OPERATIONS, identityOrigin: IDENTITY + '/',
    storeBases: [STORE], relaySigningDid: PIN,
    lookupOwnerGrant: async args => { lookups.push(args); return lookupTransform({ binding: { subjectDid: OWNER_DID,
      webId: OWNER_WEBID, userId: 'owner-a', podUrl: OWNER_POD }, graphIri: GRAPH }); },
    fetch: fetcher, now: () => clock, ...(options.readerOptions ?? {}) };
  const readers = createNativeAgentProofReaders(settings);
  if (options.autoReady !== false) await readers.ready;
  return { readers, settings, state, documents, requests, lookups, rebuild,
    read: () => readers.readOwnerGrantHead({ grantId: GRANT_ID }),
    resolve: (fields = {}) => readers.resolveAgentProof({ agentDid: AGENT, signatureSigner: PIN, ...fields }),
    head(fn) { headTransform = fn; }, descriptor(fn) { descriptorTransform = fn; }, verification(fn) { verificationTransform = fn; },
    document(fn) { documentTransform = fn; }, lookup(fn) { lookupTransform = fn; }, advance(ms) { clock += ms; }, clock: () => clock,
  };
}
const rejects = action => assert.rejects(async () => action());

test('concurrent same-scope native reads coalesce without caching completed authority or extending observations', async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.read(), f.read()]);
  assert.equal(first, second); assert.equal(first.observedAt, f.clock());
  assert.equal(f.requests.filter(request => request.url === TARGETS.get_current_head).length, 2);
  assert.equal(f.requests.filter(request => request.url === TARGETS.get_descriptor).length, 1);
  f.advance(100);
  const third = await f.read(); assert.equal(third.observedAt, f.clock()); assert.notEqual(third, first);
  assert.equal(f.requests.filter(request => request.url === TARGETS.get_current_head).length, 4);
  const before = f.requests.filter(request => request.url === TARGETS.verify_agent).length;
  const [agentA, agentB] = await Promise.all([f.resolve(), f.resolve()]); assert.equal(agentA, agentB);
  assert.equal(f.requests.filter(request => request.url === TARGETS.verify_agent).length, before + 1);
  f.advance(100); await f.resolve();
  assert.equal(f.requests.filter(request => request.url === TARGETS.verify_agent).length, before + 2);
  assert.equal(f.readers.status().ownerFlights, 0); assert.equal(f.readers.status().agentFlights, 0);
});

test('owner and distinct agent scopes remain separate during parallel native proof reads', async () => {
  const f = await fixture(); const [head, agent] = await Promise.all([f.read(), f.resolve()]);
  assert.equal(head.ownerPodUrl, OWNER_POD); assert.equal(head.grant.issuer, OWNER_DID);
  assert.equal(agent.agentDid, AGENT); assert.equal(agent.podUrl, STORE + 'agent-a/');
  assert.notEqual(agent.podUrl, head.ownerPodUrl);
  const checked = f.requests.filter(request => request.url === TARGETS.verify_agent).map(request => JSON.parse(request.body));
  assert(checked.some(row => row.agent_id === PUBLISHER && row.pod_url === OWNER_POD));
  assert(checked.some(row => row.agent_id === AGENT && row.pod_url === agent.podUrl));
});

test('relay, current registry and credential reads dispatch independently before any settles', async t => {
  const f = await fixture();
  const targets = new Set([TARGETS.verify_agent, STORE + 'agent-a/agents',
    STORE + 'agent-a/credentials/' + encodeURIComponent(AGENT) + '.jsonld']);
  const entered = new Set(), settled = new Set();
  let release, allEntered;
  const barrier = new Promise(resolve => { release = resolve; });
  const dispatched = new Promise(resolve => { allEntered = resolve; });
  const readers = createNativeAgentProofReaders({ ...f.settings, fetch: async (url, init) => {
    const target = String(url);
    if (!targets.has(target)) return f.settings.fetch(url, init);
    entered.add(target); if (entered.size === targets.size) allEntered();
    await barrier;
    const response = await f.settings.fetch(url, init); settled.add(target); return response;
  } });
  t.after(() => { release(); readers.close(); });
  await readers.ready;
  const started = f.clock(); let completed = false;
  const resolving = readers.resolveAgentProof({ agentDid: AGENT, signatureSigner: PIN }).then(value => { completed = true; return value; });
  let timer;
  try {
    await Promise.race([dispatched, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('All three independent reads must dispatch before release')), 2000); })]);
    assert.deepEqual(entered, targets); assert.equal(settled.size, 0); assert.equal(completed, false);
    f.advance(750); release();
    const result = await resolving;
    assert.equal(result.observedAt, started, 'parallel read completion must not reset evidence freshness');
    assert.equal(result.expiresAt, started + 30_000, 'identity expiry remains anchored to the original observation');
    assert.equal(settled.size, targets.size); assert.equal(result.agentDid, AGENT);
  } finally { clearTimeout(timer); release(); }
});

test('native authority observations remain anchored before slow proof reads and aborted callers fail closed', async () => {
  const f = await fixture();
  const slow = createNativeAgentProofReaders({ ...f.settings, fetch: async (url, init) => {
    const response = await f.settings.fetch(url, init);
    if (String(url) === TARGETS.get_descriptor || String(url).includes('/agents/companion-agent-a/did.json')) f.advance(250);
    return response;
  } });
  await slow.ready;
  const start = f.clock(); const head = await slow.readOwnerGrantHead({ grantId: GRANT_ID });
  assert.equal(head.observedAt, start); assert(f.clock() > head.observedAt);
  const next = f.clock(); const agent = await slow.resolveAgentProof({ agentDid: AGENT, signatureSigner: PIN });
  assert.equal(agent.observedAt, next); assert(f.clock() > agent.observedAt);
  const controller = new AbortController(); controller.abort(); const count = f.requests.length;
  await rejects(() => slow.readOwnerGrantHead({ grantId: GRANT_ID, signal: controller.signal }));
  await rejects(() => slow.resolveAgentProof({ agentDid: AGENT, signatureSigner: PIN, signal: controller.signal }));
  assert.equal(f.requests.length, count); slow.close();
});

test('discovery follows the advertised REST targets and schemas, and native proof reads never carry credentials', async () => {
  const f = await fixture(); const result = await f.read();
  assert.deepEqual(result.grant, f.state.grant); assert.equal(result.ownerPodUrl, OWNER_POD);
  assert.equal(result.descriptorUrl, f.state.descriptorUrl); assert.equal(result.graphIri, GRAPH); assert.equal(result.cid, f.state.cid);
  assert.equal(result.contentDigest, nativeCore.canonicalGraphDigest(f.state.payload)); assert.equal(result.observedAt, f.clock());
  for (const name of OP_NAMES) {
    assert(f.requests.some(r => r.url === OPERATIONS + '/' + name + '/input'));
    assert(f.requests.some(r => r.url === TARGETS[name]));
  }
  assert.equal(f.requests.filter(r => r.url === TARGETS.get_current_head).length, 2, 'current owner head is rechecked after proof reads');
  assert(f.lookups.every(request => request.grantId === GRANT_ID));
  const serialized = JSON.stringify(result); assert(!serialized.includes('_signature')); assert(!serialized.includes('Bearer'));
});

test('agent resolver binds the configured native DID document, source pod, current delegation and pinned relay signer', async () => {
  const f = await fixture(); const identity = await f.resolve();
  assert.equal(identity.agentDid, AGENT); assert.equal(identity.podUrl, STORE + 'agent-a/');
  assert.equal(identity.mode, 'relay-mediated'); assert.equal(identity.signerDid, PIN); assert.equal(identity.observedAt, f.clock());
  assert(identity.expiresAt > f.clock());
  await rejects(() => f.resolve({ agentDid: PIN }));
  await rejects(() => f.resolve({ signatureSigner: 'did:ethr:' + otherWallet.address.toLowerCase() }));
});

test('constructor requires real native validators, owner lookup and an independently configured relay anchor', async () => {
  const f = await fixture();
  for (const replacement of [{ relaySigningDid: undefined }, { lookupOwnerGrant: undefined }, { nativeCore: {} }, { nativeSolid: {} }]) {
    assert.throws(() => createNativeAgentProofReaders({ ...f.settings, ...replacement }));
  }
});

test('catalog refuses foreign, authenticated, duplicate and unusable operation contracts', async t => {
  for (const [label, change] of [
    ['foreign target', c => { c['hydra:member'][0].target = 'https://evil.example/read'; return c; }],
    ['wrong method', c => { c['hydra:member'][0].method = 'GET'; return c; }],
    ['authorization required', c => { c['hydra:member'][0]['hydra:expectsHeader'][0]['hydra:required'] = true; return c; }],
    ['duplicate operation', c => { c['hydra:member'].push(clone(c['hydra:member'][0])); return c; }],
    ['missing operation', c => { c['hydra:member'].pop(); return c; }],
    ['foreign schema', c => { c['hydra:member'][0].expects = 'https://evil.example/input'; return c; }],
  ]) await t.test(label, async () => {
    const f = await fixture({ autoReady: false, catalogTransform: change }); await assert.rejects(f.readers.ready);
    assert(!f.requests.some(request => request.method === 'POST'));
  });
});

test('owner heads cannot escape their trusted lookup binding or select a fork, stale graph, missing CID or changing tip', async t => {
  for (const [label, mutate] of [
    ['foreign pod', h => ({ ...h, podUrl: STORE + 'other-owner/' })],
    ['foreign graph', h => ({ ...h, urn: 'urn:graph:other-game:grant' })],
    ['foreign descriptor', h => ({ ...h, head: { ...h.head, descriptorUrl: STORE + 'other-owner/context-graphs/grant.ttl' } })],
    ['missing CID', h => ({ ...h, head: { ...h.head, cid: null } })],
    ['wrong CID', h => ({ ...h, head: { ...h.head, cid: nativeCore.computeCid('wrong bytes') } })],
    ['fork', h => ({ ...h, forked: true, heads: [h.head, { ...h.head, descriptorUrl: OWNER_POD + 'context-graphs/other.ttl' }] })],
    ['changed tip during read', (h, n) => n > 1 ? ({ ...h, head: { ...h.head, cid: nativeCore.computeCid('next bytes') } }) : h],
  ]) await t.test(label, async () => { const f = await fixture(); f.head(mutate); await rejects(f.read); });
  await t.test('unregistered owner grant', async () => { const f = await fixture(); f.lookup(() => null); await rejects(f.read); });
});

test('raw signed bytes control trust rather than optimistic relay verification labels', async t => {
  for (const [label, configure] of [
    ['changed graph payload', async f => { f.state.graph = f.state.graph.replace('pet-a', 'other-body'); }],
    ['unsigned descriptor', async f => {
      f.state.turtle = f.state.turtle.slice(0, f.state.turtle.indexOf('# ── Authorship'));
      f.state.cid = nativeCore.computeCid(f.state.turtle);
    }],
    ['foreign authorship signer', async f => f.rebuild({ signingWallet: otherWallet })],
    ['foreign authorship owner', async f => f.rebuild({ proofInputs: { ownerWebId: IDENTITY + '/users/other-owner/profile#me' } })],
    ['foreign proof descriptor', async f => f.rebuild({ proofInputs: { descriptorId: OWNER_POD + 'context-graphs/other.ttl' } })],
    ['private graph', async f => f.descriptor(d => ({ ...d, graph: { ...d.graph, encrypted: true, content: null } }))],
    ['top-level private-content fallback', async f => f.descriptor(d => ({ ...d, content: f.state.graph, graph: { ...d.graph, content: null, encrypted: true } }))],
    ['wrong described graph', async f => {
      f.state.turtle = f.state.turtle.replace(`iep:describes <${GRAPH}>`, 'iep:describes <urn:graph:other>'); f.state.cid = nativeCore.computeCid(f.state.turtle);
    }],
  ]) await t.test(label, async () => { const f = await fixture(); await configure(f); await rejects(f.read); });
  await t.test('unsigned default graph cannot replace the grant inside the signed named graph', async () => {
    const f = await fixture();
    f.state.graph = ownerAgentGrantGraph({ graphIri: GRAPH, grant: { ...f.state.grant, entityId: 'attacker-body' } }) + '\n' + f.state.graph;
    assert.equal((await f.read()).grant.entityId, 'pet-a');
  });
  await t.test('a signed owner document cannot issue a grant for a different owner', async () => {
    const f = await fixture(); f.state.grant.issuer = 'did:web:identity.example:users:other-owner'; await f.rebuild(); await rejects(f.read);
  });
});

test('native agent DID documents cannot redirect the resolver into a claimed owner, pod, relay or identity authority', async t => {
  const didUrl = IDENTITY + '/agents/' + iid(AGENT) + '/did.json';
  for (const [label, mutate] of [
    ['different DID', d => ({ ...d, id: PUBLISHER })],
    ['foreign controller', d => ({ ...d, controller: 'did:web:evil.example:users:agent-a' })],
    ['different controller owner', d => ({ ...d, controller: OWNER_DID })],
    ['foreign pod', d => ({ ...d, service: d.service.map(s => s.type === 'SolidStorage' ? { ...s, serviceEndpoint: 'https://evil.example/pod/' } : s) })],
    ['foreign relay', d => ({ ...d, service: d.service.map(s => s.type === 'InteregoRelay' ? { ...s, serviceEndpoint: 'https://evil.example' } : s) })],
    ['duplicate storage', d => ({ ...d, service: [...d.service, { id: 'other', type: 'SolidStorage', serviceEndpoint: OWNER_POD }] })],
    ['foreign registry', d => ({ ...d, service: d.service.map(s => s.type === 'ContextGraphsAgentRegistry' ? { ...s, serviceEndpoint: OWNER_POD + 'agents' } : s) })],
  ]) await t.test(label, async () => {
    const f = await fixture(); f.document((url, value) => url === didUrl ? mutate(value) : value); await rejects(() => f.resolve());
  });
  const f = await fixture(); await rejects(() => f.resolve({ agentDid: 'did:web:evil.example:agents:companion-agent-a' }));
});

test('current relay delegation verdicts must name the expected peer, owner, actor, direct chain and pinned signer', async t => {
  for (const [label, mutate] of [
    ['caller pod substituted', v => ({ ...v, subject_pod_url: OWNER_POD })],
    ['owner swapped', v => ({ ...v, owner: OWNER_WEBID })],
    ['agent swapped', v => ({ ...v, agent: PUBLISHER })],
    ['registry only', v => ({ ...v, verified: false, trustLevel: 'SelfAsserted', delegationChain: null, enforcement: { ...v.enforcement, basis: 'registry-only' } })],
    ['subdelegation', v => ({ ...v, chainLength: 2, delegationChain: { ...v.delegationChain, length: 2 } })],
    ['untrusted relay anchor', v => ({ ...v, signing: { ...v.signing, relayAnchor: otherWallet.address } })],
    ['credential anchor swapped', v => ({ ...v, signing: { ...v.signing, credentialAnchor: otherWallet.address } })],
    ['credential subject swapped', v => ({ ...v, signing: { ...v.signing, credentialAgentId: PUBLISHER } })],
    ['relay cannot sign', v => ({ ...v, signing: { ...v.signing, canSignDelegatedRequests: false } })],
  ]) await t.test(label, async () => { const f = await fixture(); f.verification(mutate); await rejects(() => f.resolve()); });
});

test('genuinely signed but misbound native credentials cannot borrow another subject, pod or delegator', async t => {
  const credentialUrl = STORE + 'agent-a/credentials/' + encodeURIComponent(AGENT) + '.jsonld';
  for (const [label, mutate] of [
    ['subject swapped', c => { c.credentialSubject.id = PUBLISHER; return c; }],
    ['pod swapped', c => { c.credentialSubject.pod = OWNER_POD; return c; }],
    ['delegator swapped', c => { c.credentialSubject.delegatedBy = OWNER_WEBID; return c; }],
    ['issuer swapped', c => { c.issuer = OWNER_WEBID; return c; }],
    ['future issuance', c => { c.issuanceDate = '2026-10-16T12:00:01.000Z'; return c; }],
    ['expired credential', c => { c.expirationDate = '2026-10-16T11:00:00.000Z'; return c; }],
    ['wrong credential type', c => { c.type = ['VerifiableCredential', 'UnrelatedCredential']; return c; }],
  ]) await t.test(label, async () => {
    const f = await fixture(), credential = mutate(clone(f.documents.get(credentialUrl)));
    const proof = await signer(nativeCore.canonicalCredentialPayload(credential));
    credential.proof = { ...credential.proof, proofValue: proof.signature, signerAddress: proof.signerAddress, verificationMethod: proof.verificationMethod };
    f.documents.set(credentialUrl, credential); await rejects(() => f.resolve());
  });
  await t.test('registry revocation despite stale affirmative relay labels', async () => {
    const f = await fixture(); f.documents.set(STORE + 'agent-a/agents', nativeCore.ownerProfileToTurtle(nativeCore.createOwnerProfile(
      IDENTITY + '/users/agent-a/profile#me', 'Agent owner', []))); await rejects(() => f.resolve());
  });
  await t.test('a self-signed credential is not a relay anchor', async () => {
    const f = await fixture(), credential = clone(f.documents.get(credentialUrl));
    const proof = await nativeCore.makeWalletDelegationSigner(otherWallet)(nativeCore.canonicalCredentialPayload(credential));
    credential.proof = { ...credential.proof, proofValue: proof.signature, signerAddress: proof.signerAddress, verificationMethod: proof.verificationMethod };
    f.documents.set(credentialUrl, credential); await rejects(() => f.resolve());
  });
  await t.test('credential verificationMethod must identify the independently pinned signer', async () => {
    const f = await fixture(), credential = clone(f.documents.get(credentialUrl));
    credential.proof.verificationMethod = 'did:ethr:' + otherWallet.address.toLowerCase();
    f.documents.set(credentialUrl, credential); await rejects(() => f.resolve());
  });
});
