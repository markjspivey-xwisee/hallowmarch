/** Explicit native contract fixture. Reports attestations; it does not mint real native identities. */
import { webcrypto } from 'node:crypto';
import { RelayMcpTransport, canonicalGraphDigest } from './vendor/interego-browser.mjs';
import { computeCid } from './vendor/interego-public-browser.mjs';
import { createNativePublicRecordClient } from './public-record.mjs';
import { signingDelegationFixture } from './signing-delegation.fixture.mjs';

export const ownerDid = 'did:web:identity.example:users:alice', webId = 'https://identity.example/users/alice/profile#me';
export const pod = 'https://pod.example/alice/', agentDid = 'did:web:identity.example:agents:browser-alice';
export const binding = { subjectDid: ownerDid, webId, podUrl: pod };
const names = ['get_pod_status', 'get_current_head', 'get_descriptor', 'publish_context', 'verify_agent', 'register_agent'];
export function publicRecordFixture({ css, projectMcpResult = value => value, nativeSigning = 'verified', repairAck = 'normal', repairCapability = true } = {}) {
  const heads = new Map(), records = new Map(), calls = [], publicCalls = [];
  const storagePod = css ? css + 'alice/' : pod;
  const signing = signingDelegationFixture({ ownerDid, agentDid, podUrl: pod });
  signing.status.capabilities.register_agent_repair_only = repairCapability;
  let signingReady = nativeSigning === 'verified';
  let count = 0, mode = 'normal', delayed = null, mutate = value => value, forked = false, afterRead = () => {};
  function makeRecord(args) {
    const descriptorUrl = pod + 'context-graphs/' + (++count) + '.ttl', graphUrl = pod + 'graphs/' + count + '.trig';
    const digest = canonicalGraphDigest(args.graph_content);
    const turtle = `@prefix iep: <https://markjspivey-xwisee.github.io/interego/ns/iep#> .\n`
      + `<> iep:describes <${args.graph_iri}> ; iep:authorshipProof [ iep:issuer <${agentDid}> ; iep:verificationMethod <did:ethr:0xfixture> ;\n`
      + `iep:signerAddress "0xfixture" ; iep:created "2026-10-16T00:00:00.000Z" ; iep:ownerWebId <${webId}> ;\n`
      + `iep:descriptorId <${args.descriptor_id}> ; iep:agentDid "${agentDid}" ; iep:contentHash "${digest}" ; iep:proofValue "explicit-native-contract-fixture" ] ;\n`
      + `iep:affordance [ dcat:accessURL <${graphUrl}> ; dcat:mediaType "application/trig" ; iep:encrypted false ; iep:visibility "public" ] .\n`;
    const lines = args.graph_content.trimEnd().split('\n'), prefixes = lines.filter(line => line.startsWith('@prefix'));
    const body = lines.filter(line => !line.startsWith('@prefix'));
    const graphContent = prefixes.join('\n') + '\n' + `<${args.graph_iri}> {\n` + body.map(line => '    ' + line).join('\n') + '\n}\n';
    const selected = { descriptorUrl, cid: computeCid(turtle) };
    const read = { url: descriptorUrl, turtle, graph: { url: graphUrl, encrypted: false, content: graphContent },
      authorship: { authorshipVerified: true, signedBy: agentDid, signatureAuthority: 'relay', contentBinding: 'bound', effectiveTrustLevel: 'SelfAsserted',
        descriptorBinding: { bound: true, basis: 'slug-and-owner' } } };
    return { selected, read, args: structuredClone(args) };
  }
  const apply = record => { heads.set(record.args.graph_iri, record.selected); records.set(record.selected.descriptorUrl, record); };
  async function dispatch(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'get_pod_status') return { ...structuredClone(signing.status), ...(css ? { css } : {}) };
    if (name === 'verify_agent') return structuredClone(signingReady ? signing.verified : signing.missing);
    if (name === 'register_agent' && nativeSigning === 'missing') {
      if (repairAck !== 'lost-before') signingReady = true;
      if (repairAck !== 'normal') throw Error('Explicit fixture lost repair acknowledgement');
      return { registered: true };
    }
    if (name === 'get_current_head') {
      const selected = heads.get(args.urn) || null;
      if (!selected && mode === 'empty-head-no-forked') return { urn: args.urn, podUrl: pod, head: null, message: 'No descriptor on this pod describes the requested urn.' };
      if (!selected && mode === 'missing-head') return { urn: args.urn, podUrl: pod, message: 'Native head reply is unreadable.' };
      if (!selected && mode === 'contradictory-head') return { urn: args.urn, podUrl: pod, head: null, heads: [{ descriptorUrl: pod + 'context-graphs/elsewhere.ttl', cid: 'elsewhere' }] };
      if (!selected) return { urn: args.urn, podUrl: storagePod, head: null, message: 'No descriptor on this pod describes the requested urn.' };
      return { urn: args.urn, podUrl: storagePod, head: selected, forked };
    }
    if (name === 'get_descriptor') {
      const record = records.get(args.url); if (!record) return { error: 'not found', code: 404 };
      const result = mutate(structuredClone(record.read)); afterRead(record); return result;
    }
    if (name === 'publish_context') {
      const before = heads.get(args.graph_iri);
      if (mode === 'conflict' || (args.if_match && args.if_match !== before?.cid)) return { error: 'precondition failed', code: 412 };
      if (mode === 'throw-before') throw Error('Explicit fixture outage');
      const record = makeRecord(args);
      if (mode === 'pending') delayed = () => apply(record); else apply(record);
      if (mode === 'fork') forked = true;
      if (mode === 'throw-after') throw Error('Explicit fixture lost acknowledgement');
      return { published: true, status: mode === 'pending' ? 'pending' : 'committed', descriptorUrl: record.selected.descriptorUrl,
        owner: webId, agent: agentDid, pod: storagePod, visibility: 'public', encrypted: false,
        ...(before ? { previousHeadCid: before.cid, precondition: { passed: true, observedCid: before.cid } } : {}) };
    }
    throw Error('Unexpected native fixture tool');
  }
  const mcpFetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    let result;
    if (request.method === 'tools/list') result = { tools: names.map(name => ({ name })) };
    else {
      const payload = await dispatch(request.params.name, request.params.arguments || {});
      result = { structuredContent: projectMcpResult(payload), content: [{ type: 'text', text: JSON.stringify(payload) }] };
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
    return new Response(calls.length % 2 ? 'event: message\ndata: ' + body + '\n\n' : body,
      { headers: { 'Content-Type': calls.length % 2 ? 'text/event-stream' : 'application/json' } });
  };
  const anonymousFetch = async (target, init) => {
    publicCalls.push({ target, init: { ...init, signal: undefined } });
    if (mode === 'public-outage') return new Response('Unavailable', { status: 503 });
    const record = [...records.values()].find(value => value.selected.descriptorUrl === target || value.read.graph.url === target);
    if (!record) return new Response('Not found', { status: 404 });
    const body = target === record.selected.descriptorUrl ? record.read.turtle : record.read.graph.content;
    return new Response(mode === 'public-tamper' ? body + '\n<urn:evil> <urn:p> "tampered" .\n' : body);
  };
  const credential = { kind: 'relay-oauth-bearer', accessToken: 'fixture-owner-bearer', refreshToken: null, method: 'webauthn', expiresAt: Date.now() + 3600000 };
  const options = extra => ({ relayUrl: 'https://relay.example', credential, ownerDid, podUrl: pod, webId, publicData: true,
    transport: new RelayMcpTransport('https://relay.example', credential, mcpFetch), crypto: webcrypto, fetch: anonymousFetch, ...extra });
  return { calls, publicCalls, heads, records, mcpFetch, anonymousFetch, credential, options,
    client: extra => createNativePublicRecordClient(options(extra)),
    setMode: value => { mode = value; }, setForked: value => { forked = value; },
    mutateRead: value => { mutate = value; }, afterRead: value => { afterRead = value; },
    release() { delayed?.(); delayed = null; }, makeRecord, apply, dispatch };
}
