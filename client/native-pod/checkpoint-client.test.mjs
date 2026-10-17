/** Application integration with actual browser vault, RDF and native CAS clients.
 * The HTTP/native descriptor responses below are explicit protocol fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
globalThis.self = globalThis;
const { createNativePodClient } = await import('./client.mjs');
const { createPlayerPodProfile, playerProfileGraphIri } = await import('./profile.mjs');
const { createOwnerPerformanceConsultation } = await import('./performance-consultation.mjs');
const { computeCid } = await import('./vendor/interego-public-browser.mjs');
const IEP = 'https://markjspivey-xwisee.github.io/interego/ns/iep#';
const OWNER = 'did:web:identity.example:users:alice', POD = 'https://pod.example/alice/';
const AGENT = 'did:web:identity.example:agents:session-alice', GRAPH = 'urn:graph:fixture:bounded-character';
const MODE = 'hallowmarch-character/v1', WEBID = 'https://identity.example/users/alice/profile#me';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function keys() { const map = new Map(); return { load: async key => map.get(key) || null,
  create: async (key, value) => { if (!map.has(key)) map.set(key, value); return map.get(key); } }; }
function fixture() {
  const resources = new Map(), heads = new Map(), records = new Map(), agents = new Map(), calls = [], http = [], storage = keys();
  let clock = Date.parse('2026-10-17T12:00:00Z'), count = 0, lost = false, supported = true, authority = 'relay', trust = 'CryptographicallyVerified';
  const credential = token => ({ kind: 'relay-oauth-bearer', accessToken: token, refreshToken: null, expiresAt: clock + 3600000 });
  function descriptor(args) {
    const url = POD + 'context-graphs/' + args.descriptor_id.slice(9) + '.ttl';
    const turtle = `@prefix iep: <${IEP}> .\n<> iep:describes <${args.graph_iri}> ; iep:authorshipProof [ iep:issuer <${AGENT}> ; iep:verificationMethod <did:ethr:0xfixture> ;\n`
      + `iep:signerAddress "0xfixture" ; iep:created "2026-10-17T12:00:00.000Z" ; iep:ownerWebId <${WEBID}> ;\n`
      + `iep:descriptorId <${args.descriptor_id}> ; iep:agentDid "${AGENT}" ; iep:contentHash "${args.content_digest}" ; iep:proofValue "explicit-native-contract-fixture" ] .\n`;
    return { url, turtle, head: { descriptorUrl: url, cid: computeCid(turtle) }, args: structuredClone(args) };
  }
  const transport = {
    setCredential() {},
    connect: async names => ({ granted: names }),
    async callTool(name, args) {
      calls.push({ name, args: structuredClone(args) });
      if (name === 'get_pod_status') return { pod: POD, userId: 'alice', identity: { did: OWNER }, sessionAgent: { did: AGENT } };
      if (name === 'get_current_head') return { urn: args.urn, podUrl: POD, head: heads.get(args.urn) || null, forked: false, message: 'No descriptor on this pod describes the requested urn.' };
      if (name === 'register_agent') { agents.set(args.agent_id, args.encryption_public_key); return { agent: args.agent_id, scope: args.scope }; }
      if (name === 'get_descriptor' && args.url === POD + 'agents') return { turtle: [...agents].map(([id, key], i) => `<#agent${i}> <${IEP}agentIdentity> <${id}> ; <${IEP}encryptionPublicKey> "${key}" .`).join('\n') };
      if (name === 'publish_context') {
        const before = heads.get(args.graph_iri);
        if (args.if_match && args.if_match !== before?.cid) return { error: 'precondition', code: 412 };
        const found = descriptor(args); heads.set(args.graph_iri, found.head); records.set(found.url, found);
        return { published: true, status: 'committed', descriptorUrl: found.url };
      }
      if (name === 'get_descriptor') {
        const found = records.get(args.url); assert(found);
        return { url: found.url, turtle: found.turtle, authorship: { authorshipVerified: true, signatureAuthority: authority,
          signedBy: AGENT, contentBinding: 'declared', effectiveTrustLevel: trust, descriptorBinding: { bound: true, basis: 'slug-and-owner' } } };
      }
      if (name === 'get_encrypted_graph') return { encrypted: true, url: args.url, envelope: records.get(args.url).args.graph_content };
      throw Error('Unexpected fixture native operation: ' + name);
    },
  };
  const fetcher = async (url, init) => {
    assert(url.startsWith(POD + 'hallowmarch/checkpoints/')); assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers); assert(['Bearer first-grant', 'Bearer refreshed-grant'].includes(headers.get('Authorization')));
    http.push({ url, method: init.method, token: headers.get('Authorization') });
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers: supported
      ? { 'Interego-Native-Commit': '1', 'Accept-Put': 'application/vnd.interego.native-commit+json' } : {} });
    if (init.method === 'PUT') {
      const command = JSON.parse(init.body), before = resources.get(url);
      if (command.expectedRevision !== (before?.revision || null)) return new Response(null, { status: 412 });
      assert.equal(headers.get(command.expectedRevision ? 'If-Match' : 'If-None-Match'), command.expectedRevision ? '"' + command.expectedRevision + '"' : '*');
      const body = new Uint8Array(Buffer.from(command.bodyBase64, 'base64')), revision = sha(Buffer.concat([body, Buffer.from(String(++count))]));
      const saved = { body, revision, contentType: command.contentType }; resources.set(url, saved);
      if (lost) { lost = false; throw Error('fixture response lost'); }
      const atom = 'urn:pgsl:atom:' + sha(Buffer.from('atom:' + command.bodyBase64)).slice(7, 47);
      return new Response(JSON.stringify({ version: 1, status: 'committed', expectedRevision: command.expectedRevision,
        resource: url, path: url, pod: 'css', bodyDigest: sha(body), contentType: command.contentType, size: body.length,
        updatedAt: clock, revision, topUri: atom, opaqueUri: atom }), { headers: { 'Content-Type': 'application/json', ETag: '"' + revision + '"' } });
    }
    const found = resources.get(url); if (!found) return new Response(null, { status: 404 });
    return new Response(found.body, { headers: { 'Content-Type': found.contentType, ETag: '"' + found.revision + '"',
      'Interego-Revision': found.revision, 'Interego-Body-Digest': sha(found.body) } });
  };
  const client = (keyStorage = storage) => createNativePodClient({ relayUrl: 'https://relay.example', ownerDid: OWNER, podUrl: POD,
    credential: credential('first-grant'), transport, keyStorage, crypto: webcrypto, now: () => clock, fetch: fetcher });
  return { client, calls, http, resources, heads, records, storage, credential,
    advance: ms => { clock += ms; }, now: () => clock, loseNextReply: () => { lost = true; },
    setSupported: value => { supported = value; }, setAuthority: value => { authority = value; }, setTrust: value => { trust = value; } };
}

test('actual vault, RDF binding proof and native CAS helper integrate; refresh uses the current credential only', async () => {
  const f = fixture(), c = f.client(); await c.connect(); await c.createKey();
  const first = await c.createAt({ graphIri: GRAPH, checkpoint: MODE, record: { v: 1, secret: 'private body' } });
  assert.equal(first.saved, true); assert.match(first.digest, /^graph-nquads-sha256:[a-f0-9]{64}$/);
  const next = await c.save({ graphIri: GRAPH, checkpoint: MODE, expectedHead: first.head, record: { v: 1, secret: 'second private body' } });
  assert.equal(next.head.cid, first.head.cid); assert.notEqual(next.head.nativeRevision, first.head.nativeRevision);
  assert.notEqual(next.head.recordCid, first.head.recordCid);
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
  assert(f.calls.filter(call => call.name === 'publish_context').every(call => !JSON.stringify(call.args).includes('private body')));
  await c.reauthenticate({ credential: f.credential('refreshed-grant') });
  assert.equal((await c.load({ graphIri: GRAPH, checkpoint: MODE })).record.secret, 'second private body');
  assert.equal(f.http.at(-1).token, 'Bearer refreshed-grant');
  f.advance(3600001); await assert.rejects(c.load({ graphIri: GRAPH, checkpoint: MODE }));
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
});

test('strict checkpoint binding refuses non-relay authority while later delegation trust changes do not destroy recovery', async () => {
  const f = fixture(), c = f.client(); await c.connect(); await c.createKey();
  await c.createAt({ graphIri: GRAPH, checkpoint: MODE, record: { v: 1 } });
  f.setAuthority('agent'); await assert.rejects(c.load({ graphIri: GRAPH, checkpoint: MODE }), { code: 'invalid_proof' });
  f.setAuthority('relay'); f.setTrust('Unverified');
  assert.deepEqual((await f.client().connect()).ownerDid, OWNER);
  assert.deepEqual((await c.load({ graphIri: GRAPH, checkpoint: MODE })).record, { v: 1 });
});

test('unsupported native protocol fails before any fixed-resource or graph write', async () => {
  const f = fixture(), c = f.client(); await c.connect(); await c.createKey(); f.setSupported(false);
  await assert.rejects(c.createAt({ graphIri: GRAPH, checkpoint: MODE, record: { v: 1 } }), { code: 'UNSUPPORTED', checkpointStage: 'protocol-discovery' });
  assert(!f.http.some(call => call.method === 'PUT')); assert(!f.calls.some(call => call.name === 'publish_context'));
});

test('full bounded consultation consent, observation, plan, followup, evaluation and revoke reload from one encrypted native head', async () => {
  const f = fixture(), bootstrap = f.client(); await bootstrap.connect(); await bootstrap.createKey();
  const scope = { purpose: 'retain-observations', recipient: POD, taskId: 'urn:uuid:checkpoint-coaching-task' };
  const create = () => createOwnerPerformanceConsultation({ binding: { subjectDid: OWNER, podUrl: POD }, sessionId: 'checkpoint-session',
    createClient: () => f.client(), crypto: webcrypto, now: f.now });
  const journal = create(); await journal.connect();
  await journal.grantConsent({ ...scope, accepted: true, lifetimeMs: 900000 });
  const task = { id: scope.taskId, desiredResult: 'Return safely', observedResult: 'Lost health', workContext: 'Hallowmarch main world' };
  const evidence = healthPercent => [{ kind: 'owner-browser-observation', performerDid: OWNER, at: new Date(f.now()).toISOString(), metrics: { healthPercent } }];
  const before = await journal.appendObservation({ task, evidence: evidence(30) });
  const plan = await journal.appendConsultation({ observationId: before.observation.id,
    service: { action: 'urn:foxxi:plan', target: 'https://foxxi.example/plan' }, response: { plan: ['Read the existing map'] } });
  f.advance(1000); const after = await journal.appendObservation({ task: { ...task, observedResult: 'Returned safely' }, evidence: evidence(80) });
  await journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: after.observation.id, playerReport: 'Observed a safer return' });
  await journal.revokeConsent(scope); journal.close();
  const reopened = create(); await reopened.connect(); const body = await reopened.read();
  assert.equal(body.observations.length, 2); assert.equal(body.consultations.length, 1); assert.equal(body.evaluations.length, 1);
  assert.equal(body.evaluations[0].comparison.healthPercent.change, 50);
  await assert.rejects(reopened.authorize(scope), { code: 'consultation_consent_required' });
  assert.equal(f.resources.size, 1); assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
});

test('first character and key recovery discover the deterministic fixed head even before its owner index exists', async () => {
  const f = fixture(), bootstrap = f.client(); await bootstrap.connect(); await bootstrap.createKey();
  const graphIri = await playerProfileGraphIri(OWNER, webcrypto);
  const first = await bootstrap.createAt({ graphIri, checkpoint: MODE,
    record: { schema: 'hallowmarch.player-profile/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch', save: { v: 1, marker: 'unindexed current character' } } });
  const recovery = await bootstrap.exportRecovery('long private recovery passphrase');
  const freshStorage = keys();
  const profile = createPlayerPodProfile({ binding: { subjectDid: OWNER, podUrl: POD }, relayUrl: 'https://relay.example',
    createClient: () => f.client(freshStorage), crypto: webcrypto, request: async () => ({ linked: true }) });
  await profile.connect(); await assert.rejects(profile.createKey(), { code: 'recovery_required' });
  await profile.restoreRecovery(recovery, 'long private recovery passphrase');
  assert.equal((await profile.get()).data().marker, 'unindexed current character');
  assert.equal(first.head.cid, f.heads.get(graphIri).cid);
  assert.equal(f.calls.filter(call => call.name === 'publish_context' && call.args.graph_iri === graphIri).length, 1);
});

test('fresh profile quarantines an interrupted first save and explicit Retry reconciles its existing operation', async () => {
  const f = fixture(), bootstrap = f.client(); await bootstrap.connect(); await bootstrap.createKey();
  const graphIri = await playerProfileGraphIri(OWNER, webcrypto); f.loseNextReply();
  const pending = await bootstrap.createAt({ graphIri, checkpoint: MODE,
    record: { schema: 'hallowmarch.player-profile/v1', ownerDid: OWNER, game: 'urn:game:hallowmarch', save: { v: 1, marker: 'original interrupted save' } } });
  assert.equal(pending.saved, false); const bytes = [...f.resources.values()][0].body.slice();
  const profile = createPlayerPodProfile({ binding: { subjectDid: OWNER, podUrl: POD }, relayUrl: 'https://relay.example',
    createClient: () => f.client(), crypto: webcrypto, request: async () => ({ linked: true }) });
  await profile.connect(); await assert.rejects(profile.get(), { code: 'pod_pending' });
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 0);
  assert.equal(profile.status().pending, true); await profile.retry();
  assert.equal(profile.status().pending, false); assert.equal((await profile.get()).data().marker, 'original interrupted save');
  assert.deepEqual([...f.resources.values()][0].body, bytes);
  assert.equal(f.http.filter(call => call.method === 'PUT').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'publish_context' && call.args.graph_iri === graphIri).length, 1);
});
