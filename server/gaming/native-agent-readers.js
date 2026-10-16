/** Public native read composition. No player token, pod-wide grant or private
 * character data is requested. Trust comes from the host's verified binding,
 * configured identity authority and independently pinned relay signing key.
 */
import { NATIVE_OWNER_AGENT_GRANT_SCHEMA } from './native-agent-proof.js';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DCT = 'http://purl.org/dc/terms/';
const GRANT_TYPE = NATIVE_OWNER_AGENT_GRANT_SCHEMA.$id;
const SHAPE = { get_current_head: ['urn', 'pod_url'], get_descriptor: ['url'], verify_agent: ['agent_id', 'pod_url'] };
const SCOPES = { ReadWrite: ['discover', 'publish', 'subscribe'], ReadOnly: ['discover', 'subscribe'], PublishOnly: ['publish'], DiscoverOnly: ['discover'] };
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export class NativeAgentReaderError extends Error {
  constructor(code) { super(code); this.name = 'NativeAgentReaderError'; this.code = code; }
}
const fail = code => { throw new NativeAgentReaderError(code); };
function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f\\]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) fail('unsafe_native_url');
  let url; try { url = new URL(value); } catch { fail('unsafe_native_url'); }
  if ((url.href !== value && value !== url.origin) || url.username || url.password || url.hash || url.search || /\/{2}/.test(url.pathname)) fail('unsafe_native_url');
  return url;
}
function graphIri(value) {
  if (typeof value !== 'string' || !/^urn:graph:[A-Za-z0-9:._/-]{1,1000}$/.test(value)) fail('invalid_native_grant_graph');
  return value;
}
function iso(value) {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value) fail('invalid_native_time');
  return at;
}

/** Publish this payload through the owner's existing native publish affordance. */
export function ownerAgentGrantGraph({ graphIri: iri, grant } = {}) {
  graphIri(iri);
  if (!plain(grant) || grant.schema !== NATIVE_OWNER_AGENT_GRANT_SCHEMA.properties.schema.const
    || Object.keys(grant).length !== NATIVE_OWNER_AGENT_GRANT_SCHEMA.required.length
    || NATIVE_OWNER_AGENT_GRANT_SCHEMA.required.some(key => !Object.hasOwn(grant, key))) fail('invalid_native_grant_payload');
  const json = JSON.stringify(grant); if (Buffer.byteLength(json) > 16_384) fail('native_grant_too_large');
  return `@prefix schema: <https://schema.org/> .\n@prefix dct: <${DCT}> .\n@prefix rdf: <${RDF}> .\n`
    + `<${iri}> a schema:DigitalDocument ; dct:conformsTo <${GRANT_TYPE}> ; rdf:value ${JSON.stringify(json)}^^rdf:JSON .\n`;
}

export function createNativeAgentProofReaders(options = {}) {
  const core = options.nativeCore, solid = options.nativeSolid;
  for (const name of ['computeCid', 'parseTrig', 'canonicalGraphDigest', 'verifySignedAuthorship', 'proofBindsToDescriptorUrl', 'canonicalCredentialPayload', 'makeWalletDelegationVerifier']) {
    if (typeof core?.[name] !== 'function') throw new TypeError('Pinned native core validators are required');
  }
  for (const name of ['parseAuthorshipProofFromDescriptorTurtle', 'digestedGraphRegion', 'readAgentRegistry', 'readDelegationCredential']) {
    if (typeof solid?.[name] !== 'function') throw new TypeError('Pinned native Solid validators are required');
  }
  if (typeof options.lookupOwnerGrant !== 'function') throw new TypeError('A trusted verified owner relationship lookup is required');
  const catalogUrl = safeUrl(options.operationsUrl), identity = safeUrl(options.identityOrigin);
  if (catalogUrl.protocol !== 'https:' || identity.protocol !== 'https:' || identity.pathname !== '/') throw new TypeError('Native read discovery requires configured HTTPS authorities');
  const relayOrigin = catalogUrl.origin;
  if (typeof options.relaySigningDid !== 'string' || !/^did:ethr:0x[0-9a-f]{40}$/i.test(options.relaySigningDid)) throw new TypeError('An independently pinned native relay signing DID is required');
  const signerDid = options.relaySigningDid.toLowerCase(), signerAddress = signerDid.slice('did:ethr:'.length);
  const stores = options.storeBases?.map(safeUrl);
  if (!stores?.length || stores.length > 16 || stores[0].protocol !== 'https:'
    || stores.some(base => !['https:', 'http:'].includes(base.protocol) || !base.pathname.endsWith('/'))) throw new TypeError('Configured public native store and exact aliases are required');
  const transport = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now;
  if (typeof transport !== 'function' || typeof now !== 'function') throw new TypeError('Native read transport and clock required');
  const maxConcurrent = options.maxConcurrent ?? 32, timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 256 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new TypeError('Invalid native reader bound');
  let active = 0, catalog = null, discovery = null, catalogUntil = 0, closed = false;
  const controllers = new Set();
  const ownerFlights = new Map(), agentFlights = new Map();
  function coalesce(map, key, operation, signal) {
    if (closed || signal?.aborted) fail('native_read_cancelled');
    let task = map.get(key);
    if (!task) {
      if (map.size >= maxConcurrent) fail('native_read_capacity');
      task = Promise.resolve().then(operation); map.set(key, task);
      task.then(() => map.delete(key), () => map.delete(key));
    }
    return task.then(result => { if (closed || signal?.aborted) fail('native_read_cancelled'); return result; });
  }
  function normalize(value) {
    const url = safeUrl(value), base = stores.find(candidate => url.origin === candidate.origin && url.pathname.startsWith(candidate.pathname));
    if (!base) fail('untrusted_native_store');
    return stores[0].href + url.pathname.slice(base.pathname.length);
  }
  function owner(binding) {
    if (!plain(binding) || typeof binding.userId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(binding.userId)) fail('verified_owner_binding_required');
    const did = 'did:web:' + identity.host.replace(/:/g, '%3A') + ':users:' + binding.userId;
    const webId = identity.origin + '/users/' + binding.userId + '/profile#me', podUrl = stores[0].href + binding.userId + '/';
    if (binding.subjectDid !== did || binding.webId !== webId || normalize(binding.podUrl) !== podUrl) fail('verified_owner_binding_required');
    return { did, webId, podUrl, userId: binding.userId };
  }
  async function request(url, init = {}, limit = 262_144, outerSignal) {
    if (closed || outerSignal?.aborted) fail('native_read_cancelled');
    if (active >= maxConcurrent) fail('native_read_capacity');
    const target = safeUrl(url); if (target.protocol !== 'https:') fail('unsafe_native_url');
    const controller = new AbortController(); controllers.add(controller); active++;
    const abort = () => controller.abort(); outerSignal?.addEventListener('abort', abort, { once: true }); let timer;
    const task = (async () => {
      const response = await transport(target.href, { ...init, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...(init.headers ?? {}) } });
      if (!response.ok || (response.url && response.url !== target.href)) fail('native_read_refused');
      const length = Number(response.headers.get('content-length') ?? 0); if (length > limit) fail('native_read_too_large');
      let size = 0; const chunks = [], reader = response.body?.getReader();
      if (reader) try { for (;;) {
        const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > limit) { await reader.cancel(); fail('native_read_too_large'); } chunks.push(Buffer.from(part.value));
      } } finally { reader.releaseLock(); }
      const raw = Buffer.concat(chunks).toString('utf8');
      return new Response(raw, { status: response.status, headers: response.headers });
    })();
    // Retain capacity when an upstream ignores abort, until its read settles.
    task.then(() => { active--; controllers.delete(controller); }, () => { active--; controllers.delete(controller); });
    try { return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(new NativeAgentReaderError('native_read_timeout'));
    }, timeoutMs); })]); }
    catch (error) { if (error instanceof NativeAgentReaderError) throw error; fail('native_read_unavailable'); }
    finally { clearTimeout(timer); controller.abort(); outerSignal?.removeEventListener('abort', abort); }
  }
  async function json(url, init, limit, signal) {
    const response = await request(url, init, limit, signal); let value;
    try { value = await response.json(); } catch { fail('invalid_native_response'); }
    if (!plain(value) || value.error) fail('native_read_refused'); return value;
  }
  async function discover() {
    if (catalog && catalogUntil > now()) return catalog;
    if (!discovery) discovery = (async () => {
      const document = await json(catalogUrl.href), members = document['hydra:member'];
      if (document['@id'] !== catalogUrl.href || !Array.isArray(members) || members.length > 256) fail('invalid_native_catalog');
      const next = {};
      await Promise.all(Object.entries(SHAPE).map(async ([name, inputs]) => {
        const rows = members.filter(member => member?.['@id'] === 'urn:iep:operation:' + name);
        if (rows.length !== 1) fail('missing_native_operation');
        const op = rows[0], target = safeUrl(op.target), expects = safeUrl(op.expects), action = safeUrl(op.action);
        if (op.method !== 'POST' || target.origin !== relayOrigin || expects.origin !== relayOrigin || action.origin !== relayOrigin
          || !op['hydra:expectsHeader']?.some(header => header['hydra:headerName'] === 'Authorization' && header['hydra:required'] === false)) fail('invalid_native_operation');
        const schema = await json(expects.href, {}, 65_536);
        if (schema.$id !== expects.href || schema.type !== 'object' || inputs.some(key => schema.properties?.[key]?.type !== 'string')) fail('unsupported_native_input_schema');
        next[name] = freeze({ target: target.href, action: action.href, expects: expects.href, inputs });
      }));
      catalog = freeze(next); catalogUntil = now() + 600_000; return catalog;
    })().finally(() => { discovery = null; });
    return discovery;
  }
  async function invoke(name, payload, signal) {
    const op = (await discover())[name];
    if (Object.keys(payload).length !== op.inputs.length || op.inputs.some(key => typeof payload[key] !== 'string')) fail('invalid_native_operation_input');
    return json(op.target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 1_048_576, signal);
  }
  const verification = core.makeWalletDelegationVerifier();
  const pinnedVerifier = async (message, proof) => !!proof && typeof proof.signerAddress === 'string' && same(proof.signerAddress, signerAddress)
    && typeof proof.verificationMethod === 'string' && same(proof.verificationMethod, signerDid) && await verification(message, proof);
  function inWindow(from, until) { const time = now(); if (iso(from) > time || (until !== undefined && iso(until) <= time)) fail('native_delegation_expired'); }
  async function delegation(agentDid, sourceOwner, signal) {
    const expected = normalize(sourceOwner.podUrl), result = await invoke('verify_agent', { agent_id: agentDid, pod_url: expected }, signal);
    if (normalize(result.subjectPodUrl) !== expected || normalize(result.subject_pod_url) !== expected || result.owner !== sourceOwner.webId
      || result.agent !== agentDid || result.valid !== true || result.verified !== true || result.trustLevel !== 'CryptographicallyVerified'
      || result.chainLength !== 1 || result.delegationChain?.anchored !== true || result.delegationChain.owner !== sourceOwner.webId
      || result.delegationChain.agent !== agentDid || result.delegationChain.length !== 1
      || result.signing?.credentialAgentId !== agentDid || result.signing.canSignDelegatedRequests !== true
      || !same(String(result.signing.relayAnchor), signerAddress) || !same(String(result.signing.credentialAnchor), signerAddress)) fail('native_delegation_rejected');
    const publicFetch = async (url, init = {}) => {
      const target = normalize(String(url)); if (!target.startsWith(expected)) fail('native_delegation_outside_pod');
      if (init.method && init.method !== 'GET') fail('native_read_only');
      return request(target, { method: 'GET', headers: { Accept: init.headers?.Accept ?? 'application/json' } }, 131_072, signal);
    };
    const [registry, vc] = await Promise.all([solid.readAgentRegistry(expected, { fetch: publicFetch }), solid.readDelegationCredential(expected, agentDid, { fetch: publicFetch })]);
    const rows = registry?.authorizedAgents?.filter(row => row.agentId === agentDid);
    if (registry?.webId !== sourceOwner.webId || rows?.length !== 1 || rows[0].delegatedBy !== sourceOwner.webId
      || rows[0].revoked || !Object.hasOwn(SCOPES, rows[0].scope) || result.scope !== rows[0].scope || result.delegationChain.scope !== rows[0].scope) fail('native_delegation_rejected');
    inWindow(rows[0].validFrom, rows[0].validUntil);
    const subject = vc?.credentialSubject, proof = vc?.proof;
    if (!vc || !vc.type?.includes('VerifiableCredential') || !vc.type?.includes('AgentDelegation') || vc.issuer !== sourceOwner.webId
      || subject?.id !== agentDid || subject.delegatedBy !== sourceOwner.webId || normalize(subject.pod) !== expected
      || normalize(vc.id) !== expected + 'credentials/' + encodeURIComponent(agentDid) + '.jsonld'
      || !Array.isArray(subject.scope) || subject.scope.length !== SCOPES[rows[0].scope].length
      || [...subject.scope].sort().join(',') !== SCOPES[rows[0].scope].join(',')
      || proof?.type !== 'EcdsaSecp256k1Signature2019' || proof.proofPurpose !== 'assertionMethod') fail('native_credential_binding_rejected');
    inWindow(vc.issuanceDate, vc.expirationDate); inWindow(proof.created);
    if (!await pinnedVerifier(core.canonicalCredentialPayload(vc), proof)) fail('native_credential_signature_rejected');
    return Math.min(rows[0].validUntil === undefined ? Infinity : iso(rows[0].validUntil), vc.expirationDate === undefined ? Infinity : iso(vc.expirationDate));
  }
  async function agentDocument(agentDid, signal) {
    const prefix = 'did:web:' + identity.host.replace(/:/g, '%3A') + ':agents:';
    if (typeof agentDid !== 'string' || !agentDid.startsWith(prefix)) fail('unsupported_native_agent_identity');
    const id = agentDid.slice(prefix.length); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(id)) fail('unsupported_native_agent_identity');
    const doc = await json(identity.origin + '/agents/' + id + '/did.json', {}, 65_536, signal);
    const controllerPrefix = 'did:web:' + identity.host.replace(/:/g, '%3A') + ':users:';
    if (doc.id !== agentDid || typeof doc.controller !== 'string' || !doc.controller.startsWith(controllerPrefix)) fail('native_agent_document_rejected');
    const userId = doc.controller.slice(controllerPrefix.length);
    const sourceOwner = owner({ userId, subjectDid: doc.controller, webId: identity.origin + '/users/' + userId + '/profile#me', podUrl: stores[0].href + userId + '/' });
    const service = type => { const rows = doc.service?.filter(row => row.type === type); if (rows?.length !== 1) fail('native_agent_document_rejected'); return rows[0].serviceEndpoint; };
    if (normalize(service('SolidStorage')) !== sourceOwner.podUrl || normalize(service('ContextGraphsAgentRegistry')) !== sourceOwner.podUrl + 'agents'
      || safeUrl(service('InteregoRelay')).origin !== relayOrigin) fail('native_agent_document_rejected');
    return sourceOwner;
  }
  async function head(reference, signal) {
    const result = await invoke('get_current_head', { urn: reference.graphIri, pod_url: reference.owner.podUrl }, signal);
    if (result.urn !== reference.graphIri || normalize(result.podUrl) !== reference.owner.podUrl || result.forked !== false
      || (Array.isArray(result.heads) && result.heads.length > 1)
      || !plain(result.head) || typeof result.head.cid !== 'string') fail('native_grant_head_unavailable');
    const url = normalize(result.head.descriptorUrl);
    if (!url.startsWith(reference.owner.podUrl) || !url.endsWith('.ttl')) fail('native_grant_head_outside_pod');
    return { descriptorUrl: url, cid: result.head.cid };
  }
  const ready = discover(); ready.catch(() => {});
  return Object.freeze({ ready,
    async readOwnerGrantHead({ grantId, signal } = {}) {
      const observedAt = now();
      let ref; try { ref = copy(await options.lookupOwnerGrant({ grantId })); } catch { fail('verified_owner_binding_required'); }
      if (!plain(ref)) fail('verified_owner_binding_required');
      const reference = { owner: owner(ref.binding), graphIri: graphIri(ref.graphIri) };
      return coalesce(ownerFlights, reference.owner.did + '|' + reference.graphIri + '|' + grantId, async () => {
      const current = await head(reference, signal);
      const descriptor = await invoke('get_descriptor', { url: current.descriptorUrl }, signal), turtle = descriptor.turtle;
      if (typeof turtle !== 'string' || normalize(descriptor.url) !== current.descriptorUrl || String(core.computeCid(turtle)) !== current.cid
        || descriptor.graph?.encrypted !== false || typeof descriptor.graph.content !== 'string') fail('native_grant_descriptor_rejected');
      const report = descriptor.authorship;
      if (report?.authorshipVerified !== true || report.contentBinding !== 'bound' || report.effectiveTrustLevel !== 'CryptographicallyVerified'
        || report.descriptorBinding?.bound !== true || !['exact-url', 'slug-and-owner'].includes(report.descriptorBinding.basis)) fail('native_grant_authorship_rejected');
      const proof = solid.parseAuthorshipProofFromDescriptorTurtle(turtle), region = solid.digestedGraphRegion({ descriptorTurtle: turtle, graphContent: descriptor.graph.content });
      if (!proof || proof.ownerWebId !== reference.owner.webId || report.signedBy !== proof.issuer || region.ok !== true || region.graphIri !== reference.graphIri) fail('native_grant_owner_rejected');
      const bound = core.proofBindsToDescriptorUrl(proof.descriptorId, current.descriptorUrl, normalize,
        { claimedOwner: proof.ownerWebId, servingPodOwner: reference.owner.webId });
      if (!bound.bound || !['exact-url', 'slug-and-owner'].includes(bound.basis)) fail('native_grant_location_rejected');
      const contentDigest = core.canonicalGraphDigest(region.turtle);
      if (!contentDigest || proof.contentHash !== contentDigest || !(await core.verifySignedAuthorship(proof, pinnedVerifier, { contentHash: contentDigest })).valid) fail('native_grant_content_rejected');
      const publisher = await agentDocument(proof.issuer, signal);
      if (publisher.did !== reference.owner.did || publisher.podUrl !== reference.owner.podUrl) fail('native_grant_publisher_rejected');
      await delegation(proof.issuer, publisher, signal);
      const doc = core.parseTrig(region.turtle), subjects = doc.subjects.filter(subject => subject.subject === reference.graphIri);
      if (subjects.length !== 1) fail('native_grant_payload_rejected');
      const value = subjects[0].properties.get(RDF + 'value'), conforms = subjects[0].properties.get(DCT + 'conformsTo');
      if (value?.length !== 1 || value[0].kind !== 'literal' || value[0].datatype !== RDF + 'JSON'
        || !conforms?.some(term => term.kind === 'iri' && term.iri === GRANT_TYPE)) fail('native_grant_payload_rejected');
      let grant; try { grant = JSON.parse(value[0].value); } catch { fail('native_grant_payload_rejected'); }
      if (!plain(grant) || grant.id !== grantId || grant.issuer !== reference.owner.did) fail('native_grant_payload_rejected');
      const confirmed = await head(reference, signal);
      if (confirmed.cid !== current.cid || confirmed.descriptorUrl !== current.descriptorUrl) fail('native_grant_head_changed');
      return freeze({ grant, ownerPodUrl: reference.owner.podUrl, descriptorUrl: current.descriptorUrl, graphIri: reference.graphIri,
        cid: current.cid, contentDigest, observedAt });
      }, signal);
    },
    async resolveAgentProof({ agentDid, signatureSigner, signal } = {}) {
      const observedAt = now();
      if (typeof signatureSigner !== 'string' || !same(signatureSigner, signerDid)) fail('native_agent_signer_rejected');
      return coalesce(agentFlights, agentDid + '|' + signerDid, async () => {
      const sourceOwner = await agentDocument(agentDid, signal), expires = await delegation(agentDid, sourceOwner, signal);
      return freeze({ agentDid, podUrl: sourceOwner.podUrl, mode: 'relay-mediated', signerDid, observedAt,
        expiresAt: Math.min(expires, observedAt + 30_000) });
      }, signal);
    },
    status() { return { enabled: !closed && !!catalog, active, ownerFlights: ownerFlights.size, agentFlights: agentFlights.size, supportedIdentityModes: ['relay-mediated'], publicGrantOnly: true,
      operations: catalog ? Object.fromEntries(Object.entries(catalog).map(([name, operation]) => [name, { ...operation }])) : {},
      sourceRestLimit: { basis: 'audited-relay-source', requestsPerMinutePerIp: 60 } }; },
    close() { closed = true; ownerFlights.clear(); agentFlights.clear(); for (const controller of controllers) controller.abort(); },
  });
}
