import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createNativeCapabilityPublication, createNativeCapabilityComposition } from './native-capability-publication.js';

// Transport unit tests stub the SDK boundary, not a signature verifier. Set
// INTEREGO_SDK_TEST_ROOT to exercise the real core/solid serialization and scope.
let realSdk;
if (process.env.INTEREGO_SDK_TEST_ROOT) {
  const root = resolve(process.env.INTEREGO_SDK_TEST_ROOT);
  realSdk = {
    core: await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js'))),
    solid: await import(pathToFileURL(resolve(root, 'packages/solid/dist/index.js'))),
  };
}
const mockSdk = {
  core: {
    canonicalGraphDigest: text => 'graph-nquads-sha256:' + createHash('sha256').update(text.trim()).digest('hex'),
    // A transport-test stub only; the real parser is exercised below when the
    // built SDK is supplied. It exposes fixture graph references, not Turtle semantics.
    parseTrig: text => ({ subjects: [{ properties: new Map([['fixture', [...text.matchAll(/<(urn:graph:[^>]+)>/g)].map(match => ({ kind: 'iri', iri: match[1] }))]]) }] }),
  },
  solid: {
    parseAuthorshipProofFromDescriptorTurtle: text => JSON.parse(text).proof,
    parseDistributionFromDescriptorTurtle: text => JSON.parse(text).distribution,
    digestedGraphRegion: ({ graphContent, descriptorTurtle }) => ({ ok: true, graphIri: JSON.parse(descriptorTurtle).graphIri, turtle: graphContent }),
  },
};
const relay = 'https://relay.example';
const graphIri = 'urn:graph:service:capabilities';
const graphContent = '<urn:service> <https://schema.org/name> "Service capabilities" .';
const identity = { owner: 'did:web:identity.example:users:u-service', ownerWebId: 'https://identity.example/users/u-service/profile#me',
  agentDid: 'did:web:identity.example:agents:service-u-service', userId: 'u-service', podUrl: 'https://gate.example/u-service/',
  podAliases: ['http://css.internal:3456/u-service/'] };
const descriptorUrl = 'http://css.internal:3456/u-service/context-graphs/next.ttl';
const graphUrl = 'http://css.internal:3456/u-service/context-graphs/next-graph.trig';
const publicDescriptorUrl = identity.podUrl + 'context-graphs/next.ttl';
const publicGraphUrl = identity.podUrl + 'context-graphs/next-graph.trig';
function catalog() {
  const schemas = {
    get_current_head: { type: 'object', properties: { urn: { type: 'string' }, pod_url: { type: 'string' } }, required: ['urn', 'pod_url'] },
    get_descriptor: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    publish_context: { type: 'object', properties: Object.fromEntries(['graph_iri', 'graph_content', 'pod_name', 'agent_did', 'if_match'].map(k => [k, { type: 'string' }]).concat([
      ['visibility', { type: 'string', enum: ['public', 'private', 'shared'] }], ['sign_authorship', { type: 'boolean' }], ['auto_supersede_prior', { type: 'boolean' }]])), required: ['graph_iri', 'graph_content'] },
  };
  return { '@id': relay + '/tools', 'dct:identifier': 'sha256:catalog', 'hydra:member': Object.entries(schemas).map(([name, inputSchema]) => ({
    '@id': relay + '/tool/' + name, name, inputSchema,
    affordances: [{ action: 'urn:iep:action:invoke:' + name, target: relay + '/tool/' + name, method: 'POST' }],
  })) };
}
function fixture(options = {}) {
  const sdk = options.sdk || mockSdk;
  const calls = [], records = new Map(); let head = options.initialHead || null, reads = 0;
  const digest = body => sdk.core.canonicalGraphDigest(body);
  function record(url, body = graphContent) {
    const proof = { issuer: identity.agentDid, ownerWebId: identity.ownerWebId, agentDid: identity.agentDid, contentHash: digest(body),
      verificationMethod: 'did:ethr:0x1111111111111111111111111111111111111111', signerAddress: '0x1111111111111111111111111111111111111111',
      created: '2026-10-16T00:00:00.000Z', descriptorId: 'urn:descriptor:' + url.split('/').pop().slice(0, -4), proofValue: '0x00', scheme: 'EcdsaSecp256k1Signature2019' };
    const distribution = { accessURL: url.replace('.ttl', '-graph.trig'), encrypted: false, visibility: 'public' };
    const turtle = options.sdk ? '@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .\n@prefix dct: <http://purl.org/dc/terms/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n@prefix dcat: <http://www.w3.org/ns/dcat#> .\n@prefix hydra: <http://www.w3.org/ns/hydra/core#> .\n<' + proof.descriptorId + '> iep:describes <' + graphIri + '> .\n<> iep:affordance [ a dcat:Distribution ; hydra:target <' + distribution.accessURL + '> ; dcat:mediaType "application/trig" ; iep:encrypted false ; iep:visibility "public" ] .\n' + sdk.solid.buildAuthorshipProofBlock(proof) : JSON.stringify({ proof, graphIri, distribution });
    return { url, turtle, graph: { url: url.replace('.ttl', '-graph.trig'), encrypted: false,
      content: options.sdk ? sdk.solid.wrapAsTriG(turtle, body, graphIri) : body },
    authorship: { authorshipVerified: true, signedBy: identity.agentDid, contentBinding: 'bound', descriptorBinding: { bound: true, basis: 'slug-and-owner' }, effectiveTrustLevel: 'CryptographicallyVerified' } };
  }
  if (head) records.set(head.descriptorUrl, record(head.descriptorUrl, options.initialContent || graphContent));
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, ...init, body });
    if (url.startsWith(identity.podUrl)) {
      if (options.publicThrow) throw new Error('sensitive public transport detail');
      const nativeUrl = url.replace(identity.podUrl, identity.podAliases[0]);
      const record = records.get(nativeUrl) || [...records.values()].find(read => read.graph.url === nativeUrl);
      let text = nativeUrl.endsWith('.ttl') ? record?.turtle : record?.graph.content;
      const mutate = nativeUrl.endsWith('.ttl') ? options.mutatePublicDescriptor : options.mutatePublicGraph;
      if (mutate) text = mutate(text);
      return new Response(text, { status: options.publicStatus || 200 });
    }
    let answer;
    if (url === relay + '/tools') answer = options.catalog || catalog();
    else if (url.endsWith('/get_current_head')) answer = { urn: graphIri, podUrl: identity.podAliases[0], head, ...(options.headOverride || {}),
      ...(calls.some(c => c.url.endsWith('/publish_context')) ? options.afterPublishHeadOverride || {} : {}) };
    else if (url.endsWith('/publish_context')) {
      if (options.publishThrow) throw new Error('transport contains sensitive upstream detail');
      if (options.publishResult) answer = options.publishResult;
      else {
        head = { descriptorUrl, cid: 'bafknew' }; records.set(descriptorUrl, record(descriptorUrl));
        answer = { published: true, status: options.pending ? 'pending' : 'committed', owner: identity.ownerWebId, agent: identity.agentDid,
          pod: identity.podAliases[0], descriptorUrl, graphUrl, visibility: 'public', encrypted: false,
          ...(body.if_match ? { previousHeadCid: body.if_match, previousHeadUrl: options.initialHead?.descriptorUrl,
            ...(options.omitPrecondition ? {} : { precondition: { passed: true, observedCid: body.if_match, expectedCid: body.if_match } }) } : {}) };
      }
    } else if (url.endsWith('/get_descriptor')) {
      reads++;
      if (reads <= (options.pendingReads || 0)) answer = { error: 'HTTP 404' };
      else {
        answer = structuredClone(records.get(body.url));
        if (options.mutateRead) answer = options.mutateRead(answer);
        if (options.wrapRead) answer = { structuredContent: answer };
      }
    } else throw new Error('unexpected target');
    const status = options.httpStatus || 200;
    return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/ld+json' } });
  };
  const publisher = createNativeCapabilityPublication({ identity, credentialsProvider: async () => ({ Authorization: 'Bearer service-secret' }),
    catalogUrl: relay + '/tools', graphIri, graphContent, publicData: true, ...sdk, fetch, wait: async () => {}, maxPolls: 3, ...options.factory });
  return { publisher, calls, record, records, setHead: value => { head = value; } };
}

test('discover then publish only explicit public data and confirm owner, content and current head', async () => {
  const { publisher, calls } = fixture();
  const receipt = await publisher.publish();
  assert.equal(receipt.verified, true); assert.equal(receipt.state, 'verified'); assert.equal(receipt.descriptorUrl, publicDescriptorUrl);
  assert.equal(receipt.graphUrl, publicGraphUrl);
  assert.equal(receipt.cas, 'initial-head-absent'); assert.equal(receipt.authorship.authority, 'relay-attestation');
  const publication = calls.find(c => c.url.endsWith('/publish_context'));
  assert.deepEqual(publication.body, { graph_iri: graphIri, graph_content: graphContent, pod_name: identity.userId, visibility: 'public', sign_authorship: true, agent_did: identity.agentDid, auto_supersede_prior: false });
  const relayCalls = calls.filter(c => c.url.startsWith(relay + '/'));
  const publicCalls = calls.filter(c => !c.url.startsWith(relay + '/'));
  assert.deepEqual(publicCalls.map(c => c.url), [publicDescriptorUrl, publicGraphUrl]);
  assert(publicCalls.every(c => c.method === 'GET' && c.headers.Authorization === undefined && c.redirect === 'error'));
  assert.equal(calls[0].headers.Authorization, undefined);
  assert(relayCalls.slice(1).every(c => c.headers.Authorization === 'Bearer service-secret' && c.redirect === 'error'));
  assert(!JSON.stringify(receipt).includes('service-secret'));
});

test('same durable content is reused without another publication', async () => {
  const { publisher, calls } = fixture({ initialHead: { descriptorUrl, cid: 'bafkold' } });
  const result = await publisher.publish();
  assert.equal(result.verified, true); assert.equal(result.unchanged, true);
  assert(!calls.some(c => c.url.endsWith('/publish_context')));
});

test('public alias readback must confirm the exact verified descriptor and graph before exposing URLs', async () => {
  for (const options of [
    { publicThrow: true }, { publicStatus: 403 }, { publicStatus: 302 },
    { mutatePublicDescriptor: text => text.replace(identity.ownerWebId, 'https://identity.example/users/other/profile#me') },
    { mutatePublicDescriptor: text => text.replace(identity.agentDid, 'did:web:identity.example:agents:other') },
    { mutatePublicGraph: text => text.replace('Service capabilities', 'Changed public capabilities') },
  ]) {
    const { publisher, calls } = fixture(options);
    const result = await publisher.publish();
    assert.equal(result.verified, false); assert.equal(result.state, 'unconfirmed');
    assert.equal(result.descriptorUrl, undefined); assert.equal(result.graphUrl, undefined);
    assert.equal(calls.filter(c => c.url.endsWith('/publish_context')).length, 1);
    assert(!JSON.stringify(result).includes('sensitive'));
  }
});

test('an inaccessible public old head is retained without rewriting or republishing it', async () => {
  const { publisher, calls } = fixture({ initialHead: { descriptorUrl, cid: 'bafkold' }, publicStatus: 503 });
  const result = await publisher.publish();
  assert.equal(result.state, 'unconfirmed'); assert.equal(result.reason, 'public_readback_unavailable');
  assert.equal(result.descriptorUrl, undefined);
  assert(!calls.some(c => c.url.endsWith('/publish_context')));
});

test('trusted alias projection preserves the exact owner path and encoded resource suffix', async () => {
  const suffix = 'context-graphs/part%20one.ttl';
  const { publisher, calls } = fixture({ initialHead: { descriptorUrl: identity.podAliases[0] + suffix, cid: 'bafkold' } });
  const result = await publisher.publish();
  assert.equal(result.verified, true); assert.equal(result.descriptorUrl, identity.podUrl + suffix);
  assert.equal(result.graphUrl, identity.podUrl + suffix.replace('.ttl', '-graph.trig'));
  assert(calls.filter(c => c.method === 'GET' && c.url !== relay + '/tools').every(c => c.url.startsWith(identity.podUrl)));
  const foreign = fixture({ mutateRead: read => ({ ...read, graph: { ...read.graph, url: 'https://untrusted.example/u-service/context-graphs/next-graph.trig' } }) });
  assert.equal((await foreign.publisher.publish()).reason, 'foreign_descriptor');
  assert(foreign.calls.every(c => c.url.startsWith(relay + '/')));
});

test('anonymous public reads keep the response-size bound and fail closed without credentials', async () => {
  const { publisher, calls } = fixture({ factory: { maxResponseBytes: 4096 }, mutatePublicDescriptor: text => text + 'x'.repeat(5000) });
  const result = await publisher.publish();
  assert.equal(result.state, 'unconfirmed'); assert.equal(result.verified, false);
  assert.equal(result.descriptorUrl, undefined);
  assert(calls.filter(c => c.url.startsWith(identity.podUrl)).every(c => c.headers.Authorization === undefined));
});

test('an intact prior version is updated using its exact CAS token', async () => {
  const { publisher, calls } = fixture({ initialHead: { descriptorUrl: descriptorUrl.replace('next', 'prior'), cid: 'bafkold' }, initialContent: '<urn:service> <https://schema.org/name> "Prior content" .' });
  const result = await publisher.publish();
  assert.equal(result.verified, true); assert.equal(result.cas, 'matched-prior-head');
  assert.equal(calls.find(c => c.url.endsWith('/publish_context')).body.if_match, 'bafkold');
  assert.equal(calls.find(c => c.url.endsWith('/publish_context')).body.auto_supersede_prior, true);
});

test('advertised previousHeadCid confirms CAS without an extra precondition object', async () => {
  const { publisher } = fixture({ initialHead: { descriptorUrl: descriptorUrl.replace('next', 'prior'), cid: 'bafkold' },
    initialContent: '<urn:service> <https://schema.org/name> "Prior content" .', omitPrecondition: true });
  assert.equal((await publisher.publish()).verified, true);
});

test('first creation cannot automatically retire a concurrent unseen head', async () => {
  const { publisher, calls } = fixture({ afterPublishHeadOverride: { forked: true, heads: [{ descriptorUrl }, { descriptorUrl: descriptorUrl.replace('next', 'concurrent') }] } });
  const result = await publisher.publish();
  assert.equal(calls.find(c => c.url.endsWith('/publish_context')).body.auto_supersede_prior, false);
  assert.equal(result.verified, false); assert.equal(result.reason, 'forked_publication'); assert.equal(result.descriptorUrl, undefined);
});

test('pending is only successful after bounded actual descriptor readback', async () => {
  const { publisher, calls } = fixture({ pending: true, pendingReads: 2, wrapRead: true });
  const result = await publisher.publish();
  assert.equal(result.verified, true);
  assert.equal(calls.filter(c => c.url.endsWith('/get_descriptor')).length, 3);
});

test('unresolved pending and ambiguous transport never expose a successful descriptor receipt', async () => {
  for (const options of [{ pending: true, pendingReads: 20 }, { publishThrow: true }]) {
    const { publisher, calls } = fixture(options);
    const result = await publisher.publish();
    assert.equal(result.verified, false); assert.equal(result.state, 'unconfirmed');
    assert.equal(result.descriptorUrl, undefined); assert.equal(result.graphUrl, undefined);
    assert.equal(calls.filter(c => c.url.endsWith('/publish_context')).length, 1);
    assert(!JSON.stringify(result).includes('sensitive'));
  }
});

test('forks, foreign pods and conflicts never authorize a publication retry', async () => {
  for (const options of [{ headOverride: { forked: true, heads: [{}, {}] } }, { headOverride: { podUrl: 'https://evil.example/u-service/' } },
    { publishResult: { error: 'precondition_failed', code: 412 } }]) {
    const { publisher, calls } = fixture(options);
    const result = await publisher.publish();
    assert.equal(result.verified, false); assert.equal(result.state, 'refused'); assert.equal(result.descriptorUrl, undefined);
    assert(calls.filter(c => c.url.endsWith('/publish_context')).length <= 1);
  }
});

test('readback refuses wrong owner, signer, proof binding, content and graph scope', async () => {
  const mutations = [
    read => ({ ...read, turtle: read.turtle.replace(identity.ownerWebId, 'https://identity.example/users/other/profile#me') }),
    read => ({ ...read, authorship: { ...read.authorship, signedBy: 'did:web:other' } }),
    read => ({ ...read, authorship: { ...read.authorship, contentBinding: 'unbound' } }),
    read => ({ ...read, authorship: { ...read.authorship, descriptorBinding: { bound: true, basis: 'slug-only' } } }),
    read => ({ ...read, graph: { ...read.graph, content: '<urn:service> <https://schema.org/name> "Changed" .' } }),
    read => ({ ...read, graph: { ...read.graph, url: 'https://evil.example/u-service/context-graphs/graph.trig' } }),
    read => ({ ...read, turtle: read.turtle.replace(graphIri, 'urn:graph:other') }),
    read => ({ ...read, turtle: read.turtle.replace('"visibility":"public"', '"visibility":"private"') }),
  ];
  for (const mutateRead of mutations) {
    const { publisher } = fixture({ mutateRead });
    const result = await publisher.publish();
    assert.equal(result.verified, false); assert.equal(result.state, 'refused'); assert.equal(result.descriptorUrl, undefined);
  }
});

test('a valid old head without strong attribution is never overwritten', async () => {
  const { publisher, calls } = fixture({ initialHead: { descriptorUrl, cid: 'bafkold' },
    mutateRead: read => ({ ...read, authorship: { ...read.authorship, authorshipVerified: false } }) });
  assert.equal((await publisher.publish()).verified, false);
  assert(!calls.some(c => c.url.endsWith('/publish_context')));
});

test('catalog action and schema pins reject replacement routes before sending credentials', async () => {
  for (const mutate of [
    data => { data['hydra:member'][1].affordances[0].target = 'https://evil.example/tool/publish_context'; },
    data => { data['hydra:member'][1].affordances[0].method = 'GET'; },
    data => { data['hydra:member'][1].affordances[0].action = 'urn:wrong'; },
    data => { data['hydra:member'][1].inputSchema.required.push('new_required_field'); },
    data => { data['hydra:member'].push(data['hydra:member'][1]); },
  ]) {
    const data = catalog(); mutate(data);
    const { publisher, calls } = fixture({ catalog: data });
    assert.equal((await publisher.publish()).verified, false);
    assert(!calls.some(c => c.url.endsWith('/publish_context')));
    assert(calls.every(c => c.url.startsWith(relay + '/')));
  }
});

test('large replies are bounded, credentials are required, and concurrent calls coalesce', async () => {
  const { publisher, calls } = fixture();
  const one = publisher.publish(), two = publisher.publish(); assert.equal(one, two);
  await Promise.all([one, two]); assert.equal(calls.filter(c => c.url.endsWith('/publish_context')).length, 1);
  const large = fixture({ catalog: { ...catalog(), padding: 'x'.repeat(3000) }, factory: { maxResponseBytes: 1024 } });
  assert.equal((await large.publisher.publish()).reason, 'response_too_large');
  const missing = fixture({ factory: { credentialsProvider: async () => ({}) } });
  assert.equal((await missing.publisher.publish()).reason, 'service_credentials_required');
});

test('real Interego graph region handles its TriG rewrite and ignores unrelated default-graph triples', { skip: !realSdk }, async () => {
  const { publisher } = fixture({ sdk: realSdk });
  const result = await publisher.publish();
  assert.equal(result.verified, true);
  assert.equal(result.graphDigest, realSdk.core.canonicalGraphDigest(graphContent));
  const changed = fixture({ sdk: realSdk, mutateRead: read => ({ ...read, graph: { ...read.graph, content: read.graph.content.replace('Service capabilities', 'Modified capability') } }) });
  assert.equal((await changed.publisher.publish()).verified, false);
});

const parts = [
  { graphIri: 'urn:graph:part:a', graphContent: '<urn:a> <https://schema.org/name> "Part A" .' },
  { graphIri: 'urn:graph:part:b', graphContent: '<urn:b> <https://schema.org/name> "Part B" .' },
];
const root = { graphIri: 'urn:graph:root', graphContent: '<urn:root> <http://purl.org/dc/terms/hasPart> <urn:graph:part:a>, <urn:graph:part:b> .' };
function compositionFixture() {
  const calls = [], heads = new Map(), records = new Map();
  let failedGraph = null, failureEnabled = false, active = 0, peak = 0, sequence = 0;
  const fetch = async (url, init) => {
    active++; peak = Math.max(peak, active);
    await Promise.resolve();
    try {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body }); let value;
      if (url.startsWith(identity.podUrl)) {
        const record = records.get(url) || [...records.values()].find(read => read.graph.url === url);
        return new Response(url.endsWith('.ttl') ? record?.turtle : record?.graph.content, { status: 200 });
      }
      if (url.endsWith('/tools')) value = catalog();
      else if (url.endsWith('/get_current_head')) value = { urn: body.urn, podUrl: identity.podUrl, head: heads.get(body.urn) || null };
      else if (url.endsWith('/get_descriptor')) value = records.get(body.url);
      else if (url.endsWith('/publish_context')) {
        if (failureEnabled && body.graph_iri === failedGraph) return new Response('{"error":"temporary_failure"}', { status: 503 });
        const url = identity.podUrl + 'context-graphs/part-' + (++sequence) + '.ttl';
        const graphUrl = url.replace('.ttl', '-graph.trig');
        const proof = { issuer: identity.agentDid, ownerWebId: identity.ownerWebId, agentDid: identity.agentDid, contentHash: mockSdk.core.canonicalGraphDigest(body.graph_content) };
        records.set(url, { url, turtle: JSON.stringify({ graphIri: body.graph_iri, proof, distribution: { accessURL: graphUrl, visibility: 'public', encrypted: false } }),
          graph: { url: graphUrl, encrypted: false, content: body.graph_content }, authorship: { authorshipVerified: true, signedBy: identity.agentDid, contentBinding: 'bound', descriptorBinding: { bound: true, basis: 'slug-and-owner' } } });
        heads.set(body.graph_iri, { descriptorUrl: url, cid: 'bafk' + sequence });
        value = { published: true, status: 'committed', owner: identity.ownerWebId, agent: identity.agentDid, pod: identity.podUrl,
          descriptorUrl: url, graphUrl, visibility: 'public', encrypted: false };
      } else throw new Error('Unexpected composition target');
      return new Response(JSON.stringify(value), { status: 200 });
    } finally { active--; }
  };
  const publisher = createNativeCapabilityComposition({ identity, credentialsProvider: async () => ({ Authorization: 'Bearer service-secret' }),
    catalogUrl: relay + '/tools', root, parts, publicData: true, ...mockSdk, fetch, maxPolls: 1, wait: async () => {} });
  return { publisher, calls, heads, fail(graph) { failedGraph = graph; failureEnabled = true; }, resume() { failureEnabled = false; }, peak: () => peak };
}

test('composition verifies parts sequentially before publishing its root', async () => {
  const { publisher, calls, peak } = compositionFixture();
  const one = publisher.publish(), two = publisher.publish(); assert.equal(one, two);
  const receipt = await one;
  assert.equal(receipt.verified, true); assert.equal(receipt.completedParts, 2); assert.equal(receipt.totalParts, 2);
  assert.equal(receipt.root.verified, true); assert.equal(receipt.root.graphIri, root.graphIri);
  assert.deepEqual(calls.filter(c => c.url.endsWith('/publish_context')).map(c => c.body.graph_iri), [...parts.map(p => p.graphIri), root.graphIri]);
  assert.equal(peak(), 1);
});

test('a part failure leaves the root untouched, and retry reuses verified durable parts', async () => {
  const { publisher, calls, heads, fail, resume } = compositionFixture();
  fail(parts[1].graphIri);
  const first = await publisher.publish();
  assert.equal(first.verified, false); assert.equal(first.completedParts, 1); assert.equal(first.root, undefined);
  assert(!heads.has(root.graphIri));
  assert(!calls.some(c => c.url.endsWith('/publish_context') && c.body.graph_iri === root.graphIri));
  resume();
  const second = await publisher.publish(); assert.equal(second.verified, true);
  assert.equal(calls.filter(c => c.url.endsWith('/publish_context') && c.body.graph_iri === parts[0].graphIri).length, 1);
  assert.equal(calls.filter(c => c.url.endsWith('/publish_context') && c.body.graph_iri === root.graphIri).length, 1);
});

test('a failed root can be retried after re-reading existing parts without duplicate writes', async () => {
  const { publisher, calls, fail, resume } = compositionFixture();
  fail(root.graphIri);
  const first = await publisher.publish(); assert.equal(first.completedParts, 2); assert.equal(first.verified, false); assert.equal(first.root, undefined);
  const readsBefore = calls.filter(c => c.url.endsWith('/get_descriptor')).length;
  resume(); const second = await publisher.publish(); assert.equal(second.verified, true);
  assert(calls.filter(c => c.url.endsWith('/get_descriptor')).length > readsBefore);
  for (const part of parts) assert.equal(calls.filter(c => c.url.endsWith('/publish_context') && c.body.graph_iri === part.graphIri).length, 1);
});

test('composition rejects duplicate identities and a root missing part references before any write', async () => {
  const options = { identity, credentialsProvider: async () => ({ Authorization: 'Bearer service-secret' }), catalogUrl: relay + '/tools', publicData: true, ...mockSdk };
  assert.throws(() => createNativeCapabilityComposition({ ...options, root, parts: [parts[0], parts[0]] }), /unique_composition_graphs_required/);
  assert.throws(() => createNativeCapabilityComposition({ ...options, root: parts[0], parts }), /unique_composition_graphs_required/);
  let requests = 0;
  const publisher = createNativeCapabilityComposition({ ...options, root: { ...root, graphContent: '<urn:root> <https://schema.org/name> "No links" .' }, parts,
    fetch: async () => { requests++; throw new Error('must not fetch'); } });
  const result = await publisher.publish(); assert.equal(result.reason, 'composition_part_link_required'); assert.equal(requests, 0);
});
