/** Browser-owned PUBLIC native records. This module grants no pod permissions. */
import { RelayMcpTransport, canonicalGraphDigest, turtleIriRef } from './vendor/interego-browser.mjs';
import { computeCid, digestedGraphRegion, parseAuthorshipProofFromDescriptorTurtle,
  parseDistributionFromDescriptorTurtle } from './vendor/interego-public-browser.mjs';
import { createNativeSigningDelegation } from './signing-delegation.mjs';

const REQUIRED = ['get_pod_status', 'get_current_head', 'get_descriptor', 'publish_context', 'verify_agent', 'register_agent'];
const MAX_BYTES = 32 * 1024, MAX_READ_BYTES = 256 * 1024;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
export class NativePublicRecordError extends Error {
  constructor(code) { super(code); this.name = 'NativePublicRecordError'; this.code = code; }
}
const fail = code => { throw new NativePublicRecordError(code); };
function url(value, { root = false, publicOnly = false } = {}) {
  let result; try { result = new URL(value); } catch { fail('invalid_native_url'); }
  if (typeof value !== 'string' || value.length > 2048 || result.href !== value || result.username || result.password
    || result.hash || result.search || /[%\\\s]/.test(value) || /\/{2}/.test(result.pathname)
    || !['https:', ...(publicOnly ? [] : ['http:'])].includes(result.protocol)
    || (root && !/^\/[A-Za-z0-9_-]+\/$/.test(result.pathname))) fail('invalid_native_url');
  return result;
}
function graph(value) {
  if (typeof value !== 'string' || value.length > 1024 || !turtleIriRef(value)) fail('invalid_graph');
  return value;
}
function content(value, limit = MAX_BYTES) {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > limit) fail('record_capacity');
  const digest = canonicalGraphDigest(value); if (!digest) fail('invalid_graph'); return digest;
}

/** Trusts the configured relay's authenticated authorship report, explicitly
 * labelled relay-attestation in receipts. Anonymous readback proves publication,
 * not independently held owner signing keys. Personal state belongs elsewhere. */
export function createNativePublicRecordClient({ relayUrl, credential, ownerDid, podUrl, webId, publicData, transport,
  fetch: publicFetch = globalThis.fetch?.bind(globalThis), crypto = globalThis.crypto, now = Date.now } = {}) {
  if (publicData !== true) fail('public_disclosure_required');
  const relay = new URL(relayUrl);
  if (relay.protocol !== 'https:' || relay.origin !== relayUrl) fail('invalid_relay');
  if (!/^did:[a-z0-9]+:[^\s]{1,500}$/.test(ownerDid || '') || !crypto?.randomUUID || typeof publicFetch !== 'function') fail('invalid_identity');
  const pod = url(podUrl, { root: true, publicOnly: true }), podName = pod.pathname.slice(1, -1);
  let ownerWebId; try { ownerWebId = new URL(webId); } catch { fail('invalid_identity'); }
  if (ownerWebId.protocol !== 'https:' || ownerWebId.href !== webId || ownerWebId.username || ownerWebId.password
    || ownerWebId.search || ownerWebId.hash !== '#me') fail('invalid_identity');
  if (!transport && (credential?.kind !== 'relay-oauth-bearer' || typeof credential.accessToken !== 'string'
    || !credential.accessToken || credential.refreshToken)) fail('invalid_credential');
  const tx = transport || new RelayMcpTransport(relay.origin, { ...credential }, globalThis.fetch.bind(globalThis));
  const roots = [pod], pending = new Map(); let connected = false, closed = false, sessionAgent = null, queue = Promise.resolve(), signingDelegation = null;
  const open = () => { if (closed || !connected) fail('not_connected'); };
  function normalize(value) {
    const candidate = url(value), base = roots.find(root => candidate.origin === root.origin && candidate.pathname.startsWith(root.pathname));
    if (!base || candidate.pathname === base.pathname || candidate.pathname.endsWith('/')) fail('record_outside_owner_pod');
    return pod.href + candidate.pathname.slice(base.pathname.length);
  }
  const sameHead = (a, b) => !!a && !!b && a.cid === b.cid && a.descriptorUrl === b.descriptorUrl;
  async function tool(name, args) {
    if (closed) fail('not_connected'); let result;
    try { result = await tx.callTool(name, args, { cache: false, signal: AbortSignal.timeout(35000) }); }
    catch (error) { fail(error?.code === 'needs_reauth' ? 'needs_reauth' : 'native_unavailable'); }
    if (closed) fail('not_connected');
    if (!plain(result)) fail('native_contract');
    if (result.error) fail(Number(result.code) === 412 ? 'conflict' : 'native_refused');
    return result;
  }
  async function connect() {
    if (closed) fail('not_connected'); let manifest;
    try { manifest = await tx.connect(REQUIRED, 'get_pod_status'); } catch { fail('native_unavailable'); }
    if (!REQUIRED.every(name => manifest.granted?.includes(name))) fail('capability_missing');
    const status = await tool('get_pod_status', {}), authenticatedRoot = url(status.pod, { root: true });
    if (status.identity?.did !== ownerDid || status.userId !== podName || authenticatedRoot.pathname !== pod.pathname
      || !/^did:web:[^\s]+:agents:[^\s]+$/.test(status.sessionAgent?.did || '')) fail('owner_mismatch');
    // An alias is accepted only from this authenticated owner's pod status.
    if (!roots.some(root => root.href === authenticatedRoot.href)) roots.push(authenticatedRoot);
    // OAuth's identity-server pod URL and the relay's named-pod storage base
    // can be different aliases. get_current_head {pod_name} and publish_context
    // use this authenticated CSS base, not status.pod. Bind ONLY that base to
    // this already verified owner slug; arbitrary read-result hosts stay refused.
    if (status.css !== undefined) {
      const css = url(status.css);
      if (css.pathname !== '/') fail('native_contract');
      const storageRoot = url(css.href + podName + '/', { root: true });
      if (!roots.some(root => root.href === storageRoot.href)) roots.push(storageRoot);
    }
    if (sessionAgent !== status.sessionAgent.did) signingDelegation = null;
    sessionAgent = status.sessionAgent.did;
    signingDelegation ||= createNativeSigningDelegation({ ownerDid, podUrl: pod.href, agentDid: sessionAgent, callTool: tool, now });
    await signingDelegation.ensure();
    if (closed) fail('not_connected'); connected = true;
    return { ownerDid, podUrl: pod.href, publicRecords: true, proofAuthority: 'relay-attestation' };
  }
  async function currentHead({ graphIri }) {
    open(); graph(graphIri); const value = await tool('get_current_head', { urn: graphIri, pod_name: podName });
    const root = url(value.podUrl, { root: true });
    if (!roots.some(candidate => candidate.href === root.href) || value.urn !== graphIri) fail('owner_mismatch');
    if (value.forked === true || (Array.isArray(value.heads) && value.heads.length > 1)) fail('conflict');
    // The handler returns head:null, but native MCP toStructuredContent removes
    // null-valued keys. Accept that projection ONLY with the handler's exact
    // no-descriptor finding, after owner/URN validation and without any fork.
    const absent = (value.head === null || !Object.hasOwn(value, 'head'))
      && value.message === 'No descriptor on this pod describes the requested urn.';
    if (absent
      && [undefined, false].includes(value.forked) && (value.heads === undefined || Array.isArray(value.heads) && value.heads.length === 0)) return null;
    if (value.forked !== false) fail('conflict');
    if (!plain(value.head) || typeof value.head.cid !== 'string' || !value.head.cid) fail('native_contract');
    return { descriptorUrl: normalize(value.head.descriptorUrl), cid: value.head.cid };
  }
  async function anonymousRead(target, accept) {
    open(); let response;
    try { response = await publicFetch(target, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { Accept: accept }, signal: AbortSignal.timeout(8000) }); } catch { fail('public_readback_unavailable'); }
    open();
    if (!response.ok || (response.url && response.url !== target)) fail('public_readback_unavailable');
    if (Number(response.headers.get('content-length') || 0) > MAX_READ_BYTES) fail('record_capacity');
    const reader = response.body?.getReader(); if (!reader) fail('public_readback_unavailable');
    const parts = []; let length = 0;
    try { for (;;) { const part = await reader.read(); open(); if (part.done) break;
      length += part.value.byteLength; if (length > MAX_READ_BYTES) { await reader.cancel(); fail('record_capacity'); } parts.push(part.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  async function readAt(graphIri, selected, expectedAgent) {
    const read = await tool('get_descriptor', { url: selected.descriptorUrl });
    if (normalize(read.url) !== selected.descriptorUrl || typeof read.turtle !== 'string'
      || read.turtle.length > MAX_READ_BYTES || computeCid(read.turtle) !== selected.cid) fail('invalid_descriptor');
    const proof = parseAuthorshipProofFromDescriptorTurtle(read.turtle), auth = read.authorship;
    if (!proof || proof.ownerWebId !== webId || !/^did:web:[^\s]+:agents:[^\s]+$/.test(proof.issuer)
      || proof.agentDid !== proof.issuer || (expectedAgent && proof.issuer !== expectedAgent)
      || auth?.authorshipVerified !== true || auth.contentBinding !== 'bound' || auth.signedBy !== proof.issuer
      || auth.signatureAuthority !== 'relay' || auth.descriptorBinding?.bound !== true
      || !['exact-url', 'slug-and-owner'].includes(auth.descriptorBinding.basis)) fail('invalid_proof');
    const distribution = parseDistributionFromDescriptorTurtle(read.turtle);
    if (!read.graph || read.graph.encrypted !== false || typeof read.graph.content !== 'string'
      || read.graph.content.length > MAX_READ_BYTES || !distribution || distribution.visibility !== 'public' || distribution.encrypted !== false
      || normalize(distribution.accessURL) !== normalize(read.graph.url)) fail('public_distribution_required');
    const region = digestedGraphRegion({ graphContent: read.graph.content, descriptorTurtle: read.turtle });
    if (!region.ok || region.graphIri !== graphIri) fail('graph_scope_mismatch');
    const digest = content(region.turtle, MAX_READ_BYTES); if (proof.contentHash !== digest) fail('invalid_proof');
    const descriptor = await anonymousRead(selected.descriptorUrl, 'text/turtle');
    if (descriptor !== read.turtle) fail('public_readback_mismatch');
    const graphUrl = normalize(read.graph.url), publicGraph = await anonymousRead(graphUrl, 'application/trig, text/turtle');
    const publicRegion = digestedGraphRegion({ descriptorTurtle: descriptor, graphContent: publicGraph });
    if (!publicRegion.ok || publicRegion.graphIri !== graphIri || content(publicRegion.turtle, MAX_READ_BYTES) !== digest) fail('public_readback_mismatch');
    return { graphIri, head: { ...selected }, graphContent: region.turtle, operationId: proof.descriptorId?.replace(/^urn:uuid:/, ''),
      receipt: { descriptorUrl: selected.descriptorUrl, graphUrl, cid: selected.cid, contentDigest: digest, ownerDid, ownerPodUrl: pod.href,
        authorship: { verified: true, authority: 'relay-attestation', ownerWebId: webId, agentDid: proof.issuer },
        visibility: 'public', observedAt: now() } };
  }
  async function load({ graphIri }) {
    const before = await currentHead({ graphIri }); if (!before) return null;
    const result = await readAt(graphIri, before), after = await currentHead({ graphIri });
    if (!sameHead(before, after)) fail('conflict'); return result;
  }
  async function confirm(operationId) {
    open(); const operation = pending.get(operationId); if (!operation) fail('unknown_operation');
    const selected = await currentHead(operation);
    const waiting = () => ({ status: 'pending', saved: false, operationId, graphIri: operation.graphIri });
    if (!selected || sameHead(selected, operation.expectedHead)) return waiting();
    if (operation.descriptorUrl && selected.descriptorUrl !== operation.descriptorUrl) {
      pending.delete(operationId); return { status: 'conflict', saved: false, operationId, graphIri: operation.graphIri };
    }
    const result = await readAt(operation.graphIri, selected, sessionAgent), after = await currentHead(operation);
    if (!sameHead(selected, after)) fail('conflict');
    if (result.operationId !== operationId || result.receipt.contentDigest !== operation.digest) {
      pending.delete(operationId); return { status: 'conflict', saved: false, operationId, graphIri: operation.graphIri };
    }
    open(); pending.delete(operationId);
    return { status: 'saved', saved: true, ...result, operationId,
      receipt: { ...result.receipt, cas: operation.expectedHead ? 'matched-prior-head' : 'initial-head-absent' } };
  }
  async function publish({ graphIri, graphContent, expectedHead, publicData: publicWrite, creating = false }) {
    open(); if (publicWrite !== true) fail('public_disclosure_required'); graph(graphIri); const digest = content(graphContent);
    await signingDelegation.ensure(); open();
    if (pending.size >= 8 || [...pending.values()].some(operation => operation.graphIri === graphIri)) fail('confirmation_required');
    const before = await currentHead({ graphIri });
    if (creating ? before !== null : !sameHead(before, expectedHead)) fail('conflict');
    const operationId = crypto.randomUUID(), operation = { graphIri, digest, expectedHead: before, descriptorUrl: null };
    pending.set(operationId, operation); let result;
    try { result = await tool('publish_context', { pod_name: podName, graph_iri: graphIri, graph_content: graphContent,
      descriptor_id: 'urn:uuid:' + operationId, visibility: 'public', sign_authorship: true, agent_did: sessionAgent,
      auto_supersede_prior: !creating, ...(before ? { if_match: before.cid } : {}), sync: true });
    } catch (error) {
      if (['conflict', 'native_refused'].includes(error.code)) { pending.delete(operationId); throw error; }
      return { status: 'uncertain', saved: false, operationId, graphIri };
    }
    try {
      if (result.published !== true || !['pending', 'committed'].includes(result.status) || result.owner !== webId
        || result.agent !== sessionAgent || result.visibility !== 'public' || result.encrypted !== false) fail('native_contract');
      const resultPod = url(result.pod, { root: true }); if (!roots.some(root => root.href === resultPod.href)) fail('owner_mismatch');
      operation.descriptorUrl = normalize(result.descriptorUrl);
      if (before && ((result.precondition && result.precondition.passed !== true)
        || (result.previousHeadCid ?? result.precondition?.observedCid) !== before.cid)) fail('native_contract');
      return await confirm(operationId);
    } catch { return { status: 'uncertain', saved: false, operationId, graphIri }; }
  }
  const serialized = run => { const next = queue.then(run); queue = next.catch(() => {}); return next; };
  return Object.freeze({ connect, currentHead, load, confirm,
    create(input) { return serialized(() => publish({ ...input, creating: true })); },
    save(input) { if (!input?.expectedHead) fail('head_required'); return serialized(() => publish(input)); },
    status() { return { connected: connected && !closed, pending: pending.size, ownerDid, podUrl: pod.href, publicRecords: true }; },
    close() { closed = true; connected = false; pending.clear(); tx.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '',
      method: credential?.method || 'webauthn', expiresAt: now(), refreshToken: null, clientId: null }); },
  });
}
