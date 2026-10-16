/** Generic bridge composition: discover the relay's advertised tools, publish
 * caller-selected public capability data, and verify the durable owner-bound read.
 * Signatures and graph scope belong to Interego's core/solid implementations. */
const REQUIRED = Object.freeze(['get_current_head', 'publish_context', 'get_descriptor']);
const ACTION = name => 'urn:iep:action:invoke:' + name;
const copy = value => JSON.parse(JSON.stringify(value));
const failure = code => Object.assign(new Error(code), { code });
const safeIri = value => typeof value === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(value) && !/[\s<>"{}|^`\\]/.test(value);
function checkedUrl(value, httpsOnly = true) {
  let url; try { url = new URL(value); } catch { throw failure('invalid_url'); }
  if ((httpsOnly ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash) throw failure('invalid_url');
  return url;
}
function schemaAccepts(schema, payload) {
  if (schema?.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') return false;
  if ((schema.required || []).some(key => !(key in payload))) return false;
  if (schema.anyOf && !schema.anyOf.some(option => (option.required || []).every(key => key in payload))) return false;
  return Object.entries(payload).every(([key, value]) => {
    const field = schema.properties[key];
    if (!field || !['string', 'boolean'].includes(field.type) || typeof value !== field.type) return false;
    if (field.enum && !field.enum.includes(value)) return false;
    if (typeof value === 'string' && ((field.minLength && value.length < field.minLength) || (field.maxLength && value.length > field.maxLength))) return false;
    return true;
  });
}
function toolBody(value) {
  // REST returns decorated JSON. These wrappers cover supported MCP adapters,
  // without guessing a human-readable summary back into a successful receipt.
  for (let depth = 0; depth < 5; depth++) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw failure('invalid_tool_response'); } continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('invalid_tool_response');
    if (value.isError === true) throw failure('tool_refused');
    if (value.structuredContent && typeof value.structuredContent === 'object') { value = value.structuredContent; continue; }
    if (value.result && typeof value.result === 'object') { value = value.result; continue; }
    if (Array.isArray(value.content)) {
      const texts = value.content.filter(block => block?.type === 'text');
      if (texts.length !== 1) throw failure('ambiguous_tool_response');
      value = texts[0].text; continue;
    }
    if (value.error || (Number.isInteger(value.code) && value.code >= 400)) throw failure(value.code === 412 ? 'publication_conflict' : 'tool_refused');
    return value;
  }
  throw failure('invalid_tool_response');
}
async function boundedJson(response, maxBytes) {
  let text = '', size = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw failure('response_too_large'); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw failure('response_too_large');
  }
  try { return JSON.parse(text); } catch { throw failure('invalid_json_response'); }
}

/** identity is verified upstream, not a caller-claimed DID. ownerWebId is the
 * identity ceremony's returned WebID; podAliases must be verified spellings of
 * that SAME pod. No bearer is ever sent to a pod, redirect, or catalog peer.
 * publicData=true is the caller's explicit selection of open-web content. */
export function createNativeCapabilityPublication({ identity, credentialsProvider, catalogUrl,
  graphIri, graphContent, publicData = false, core, solid, fetch: transport = globalThis.fetch,
  maxPolls = 5, pollIntervalMs = 1000, requestTimeoutMs = 45000, maxResponseBytes = 2 * 1024 * 1024,
  expectedCatalogDigest, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  if (!identity || !safeIri(identity.owner) || !/^did:/.test(identity.owner) || !safeIri(identity.ownerWebId) || !safeIri(identity.agentDid)
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(identity.userId || '') || typeof credentialsProvider !== 'function') throw failure('verified_identity_required');
  const catalog = checkedUrl(catalogUrl);
  const pod = checkedUrl(identity.podUrl);
  const pods = [pod, ...(identity.podAliases || []).map(url => checkedUrl(url, false))];
  if (pods.some(url => url.pathname !== '/' + identity.userId + '/')) throw failure('owner_pod_mismatch');
  if (!safeIri(graphIri) || !graphIri.startsWith('urn:graph:') || typeof graphContent !== 'string' || !graphContent.trim() || Buffer.byteLength(graphContent) > 1024 * 1024 || publicData !== true) throw failure('explicit_public_graph_required');
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 20 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 10000
    || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120000
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 4 * 1024 * 1024) throw failure('invalid_transport_bounds');
  const knownPod = value => {
    const url = checkedUrl(value, false);
    if (!pods.some(base => url.origin === base.origin && url.pathname === base.pathname)) throw failure('owner_pod_mismatch');
    return url.href;
  };
  const knownResource = value => {
    const url = checkedUrl(value, false);
    if (!pods.some(base => url.origin === base.origin && url.pathname.startsWith(base.pathname) && url.pathname !== base.pathname)) throw failure('foreign_descriptor');
    return url.href;
  };
  let state = { state: 'idle', verified: false, graphIri }, inflight = null, tools = null, sdk = core, podSdk = solid, expectedDigest;
  const set = (phase, extra = {}) => { state = { state: phase, verified: false, graphIri, ...(expectedDigest ? { graphDigest: expectedDigest } : {}), ...extra }; };

  async function jsonRequest(url, method, body, authenticated) {
    const target = checkedUrl(url);
    if (target.origin !== catalog.origin) throw failure('foreign_relay_target');
    const headers = { accept: 'application/ld+json, application/json' };
    if (authenticated) {
      const credentials = await credentialsProvider();
      const bearer = credentials?.Authorization ?? credentials?.authorization;
      if (typeof bearer !== 'string' || !/^Bearer [^\r\n\s]+$/.test(bearer)) throw failure('service_credentials_required');
      headers.Authorization = bearer;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response;
    try { response = await transport(target.href, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs) }); }
    catch { throw failure('transport_unavailable'); }
    if (!response.ok) throw failure(response.status === 412 ? 'publication_conflict' : response.status === 401 || response.status === 403 ? 'tool_refused' : 'relay_http_failure');
    return boundedJson(response, maxResponseBytes);
  }
  async function discover() {
    const data = toolBody(await jsonRequest(catalog.href, 'GET', undefined, false));
    const members = data['hydra:member'];
    if (data['@id'] !== catalog.href || !Array.isArray(members) || !members.length || members.length > 512
      || (expectedCatalogDigest && data['dct:identifier'] !== expectedCatalogDigest)) throw failure('catalog_pin_mismatch');
    const found = {};
    for (const name of REQUIRED) {
      const entries = members.filter(member => member?.name === name);
      if (entries.length !== 1 || !Array.isArray(entries[0].affordances)) throw failure('required_operation_missing');
      const controls = entries[0].affordances.filter(control => control?.action === ACTION(name));
      if (controls.length !== 1 || controls[0].method !== 'POST') throw failure('operation_contract_mismatch');
      const target = checkedUrl(controls[0].target);
      if (target.origin !== catalog.origin || entries[0]['@id'] !== target.href || !target.pathname.startsWith('/tool/')) throw failure('operation_target_mismatch');
      const schema = entries[0].inputSchema;
      if (schema?.type !== 'object' || !schema.properties) throw failure('operation_schema_missing');
      const probe = name === 'get_current_head' ? { urn: graphIri, pod_url: pod.href }
        : name === 'get_descriptor' ? { url: pod.href + 'schema-check.ttl' }
          : { graph_iri: graphIri, graph_content: graphContent, pod_name: identity.userId,
            visibility: 'public', sign_authorship: true, agent_did: identity.agentDid, auto_supersede_prior: false };
      if (!schemaAccepts(schema, probe)) throw failure('operation_schema_changed');
      found[name] = { target: target.href, schema };
    }
    tools = found;
    return data['dct:identifier'] || null;
  }
  async function invoke(name, payload) {
    const tool = tools[name];
    if (!schemaAccepts(tool.schema, payload)) throw failure('operation_schema_changed');
    return toolBody(await jsonRequest(tool.target, 'POST', payload, true));
  }
  async function currentHead() {
    const answer = await invoke('get_current_head', { urn: graphIri, pod_url: pod.href });
    if (answer.urn !== graphIri) throw failure('graph_identity_mismatch');
    knownPod(answer.podUrl);
    if (answer.forked === true || (answer.heads && answer.heads.length > 1)) throw failure('forked_publication');
    if (answer.head === null) return null;
    if (!answer.head || typeof answer.head.descriptorUrl !== 'string') throw failure('ambiguous_head');
    knownResource(answer.head.descriptorUrl);
    return answer.head;
  }
  async function verify(url, matchExpected = true) {
    knownResource(url);
    const read = await invoke('get_descriptor', { url });
    if (typeof read.url !== 'string' || knownResource(read.url) !== knownResource(url) || typeof read.turtle !== 'string') throw failure('descriptor_readback_mismatch');
    const proof = podSdk.parseAuthorshipProofFromDescriptorTurtle(read.turtle);
    const distribution = podSdk.parseDistributionFromDescriptorTurtle(read.turtle);
    const auth = read.authorship;
    if (!proof || proof.ownerWebId !== identity.ownerWebId || proof.issuer !== identity.agentDid || proof.agentDid !== identity.agentDid) throw failure('authorship_owner_mismatch');
    if (auth?.authorshipVerified !== true || auth.contentBinding !== 'bound' || auth.descriptorBinding?.bound !== true || !['exact-url', 'slug-and-owner'].includes(auth.descriptorBinding.basis)
      || auth.signedBy !== identity.agentDid || typeof proof.contentHash !== 'string') throw failure('verified_authorship_required');
    if (!read.graph || read.graph.encrypted !== false || typeof read.graph.content !== 'string') throw failure('public_graph_readback_required');
    knownResource(read.graph.url);
    if (!distribution || distribution.visibility !== 'public' || distribution.encrypted !== false
      || knownResource(distribution.accessURL) !== knownResource(read.graph.url)) throw failure('public_distribution_required');
    const region = podSdk.digestedGraphRegion({ graphContent: read.graph.content, descriptorTurtle: read.turtle });
    if (!region.ok || region.graphIri !== graphIri) throw failure('graph_scope_mismatch');
    const actualDigest = sdk.canonicalGraphDigest(region.turtle);
    if (!actualDigest || actualDigest !== proof.contentHash || (matchExpected && actualDigest !== expectedDigest)) throw failure('graph_digest_mismatch');
    return { descriptorUrl: url, graphUrl: read.graph.url, graphDigest: actualDigest, authorship: {
      verified: true, authority: 'relay-attestation', ownerWebId: proof.ownerWebId, agentDid: proof.issuer,
      contentBinding: auth.contentBinding, descriptorBinding: auth.descriptorBinding.basis,
      effectiveTrustLevel: auth.effectiveTrustLevel || null } };
  }
  async function run() {
    set('discovering');
    try {
      sdk ||= await import('@interego/core'); podSdk ||= await import('@interego/solid');
      if (typeof sdk.canonicalGraphDigest !== 'function' || typeof podSdk.digestedGraphRegion !== 'function' || typeof podSdk.parseAuthorshipProofFromDescriptorTurtle !== 'function'
        || typeof podSdk.parseDistributionFromDescriptorTurtle !== 'function') throw failure('native_sdk_required');
      expectedDigest = sdk.canonicalGraphDigest(graphContent);
      if (!expectedDigest) throw failure('graph_not_digestible');
      const catalogDigest = await discover();
      set('resolving-head');
      const before = await currentHead();
      if (before) {
        const existing = await verify(before.descriptorUrl, false);
        if (existing.graphDigest === expectedDigest) {
          const after = await currentHead();
          if (!after || knownResource(after.descriptorUrl) !== knownResource(before.descriptorUrl)) throw failure('publication_head_changed');
          set('verified', { ...existing, verified: true, owner: identity.owner, podUrl: pod.href, catalogDigest, unchanged: true, confirmedAt: new Date(now()).toISOString() });
          return copy(state);
        }
      }
      const payload = { graph_iri: graphIri, graph_content: graphContent, pod_name: identity.userId,
        // The live relay has no compare-and-create-empty-head precondition.
        // An initial race must leave a detectable fork rather than retire a
        // concurrent head which this publisher never inspected.
        visibility: 'public', sign_authorship: true, agent_did: identity.agentDid, auto_supersede_prior: !!before,
        ...(before ? { if_match: before.cid || before.descriptorUrl } : {}) };
      set('publishing');
      const result = await invoke('publish_context', payload);
      if (result.published !== true || !['pending', 'committed'].includes(result.status) || result.owner !== identity.ownerWebId || result.agent !== identity.agentDid
        || result.visibility !== 'public' || result.encrypted !== false) throw failure('publication_receipt_unconfirmed');
      knownPod(result.pod); knownResource(result.descriptorUrl);
      if (before) {
        const condition = result.precondition;
        // previousHeadCid/Url are the advertised receipt contract. Current
        // relays additionally report a precondition block, but older compatible
        // relays need not expose that extra representation of the same fact.
        const observedCid = result.previousHeadCid ?? condition?.observedCid;
        const observedUrl = result.previousHeadUrl ?? condition?.observedUrl;
        if ((condition && condition.passed !== true) || (before.cid
          ? observedCid !== before.cid
          : knownResource(observedUrl) !== knownResource(before.descriptorUrl))) throw failure('publication_precondition_unconfirmed');
      }
      set('verifying');
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        try {
          const verified = await verify(result.descriptorUrl);
          const after = await currentHead();
          if (!after || knownResource(after.descriptorUrl) !== knownResource(result.descriptorUrl)) throw failure('publication_head_changed');
          set('verified', { ...verified, verified: true, owner: identity.owner, podUrl: pod.href, catalogDigest,
            cas: before ? 'matched-prior-head' : 'initial-head-absent', confirmedAt: new Date(now()).toISOString() });
          return copy(state);
        } catch (error) {
          if (!['tool_refused', 'transport_unavailable', 'relay_http_failure', 'descriptor_readback_mismatch', 'public_graph_readback_required'].includes(error.code)) throw error;
          if (attempt + 1 < maxPolls) await wait(pollIntervalMs);
        }
      }
      set('unconfirmed', { reason: 'durable_readback_unconfirmed' });
    } catch (error) {
      set(['transport_unavailable', 'relay_http_failure', 'publication_receipt_unconfirmed'].includes(error.code) ? 'unconfirmed' : 'refused', { reason: error.code || 'native_publication_unavailable' });
    }
    return copy(state);
  }
  return Object.freeze({
    publish() { if (!inflight) inflight = run().finally(() => { inflight = null; }); return inflight; },
    status() { return copy(state); },
  });
}

/** Publish bounded native parts sequentially, then their root composition.
 * Each retry re-verifies durable part heads before considering another write.
 * The caller should give immutable/content-addressed IRIs to parts so an older
 * root keeps its original part set when a new composition cannot be committed. */
export function createNativeCapabilityComposition({ root, parts, ...options } = {}) {
  if (!root || !Array.isArray(parts) || !parts.length || parts.length > 128) throw failure('bounded_composition_required');
  const graphs = [...parts, root];
  const ids = new Set();
  for (const graph of graphs) {
    if (!graph || !safeIri(graph.graphIri) || !graph.graphIri.startsWith('urn:graph:') || typeof graph.graphContent !== 'string'
      || !graph.graphContent.trim() || ids.has(graph.graphIri)) throw failure('unique_composition_graphs_required');
    ids.add(graph.graphIri);
  }
  // Snapshot supplied graph strings and owner metadata; no caller mutation can
  // change which owner/graph the composition is working on midway through it.
  const metadata = options.identity ? copy(options.identity) : options.identity;
  const shared = { ...options, identity: metadata };
  const partGraphs = parts.map(graph => ({ graphIri: graph.graphIri, graphContent: graph.graphContent }));
  const rootGraph = { graphIri: root.graphIri, graphContent: root.graphContent };
  const publishers = partGraphs.map(graph => createNativeCapabilityPublication({ ...shared, ...graph }));
  const rootPublisher = createNativeCapabilityPublication({ ...shared, ...rootGraph });
  let status = { state: 'idle', verified: false, completedParts: 0, totalParts: parts.length }, inflight = null;
  const set = (state, completedParts, extra = {}) => {
    status = { state, verified: false, completedParts, totalParts: partGraphs.length, ...extra };
  };
  async function run() {
    set('validating', 0);
    try {
      const sdk = options.core || await import('@interego/core');
      if (typeof sdk.parseTrig !== 'function') throw failure('native_sdk_required');
      const references = new Set();
      const parsed = sdk.parseTrig(rootGraph.graphContent);
      for (const subject of parsed.subjects) for (const terms of subject.properties.values()) {
        for (const term of terms) if (term.kind === 'iri') references.add(term.iri);
      }
      if (partGraphs.some(graph => !references.has(graph.graphIri))) throw failure('composition_part_link_required');
      for (let index = 0; index < publishers.length; index++) {
        set('publishing-parts', index);
        const receipt = await publishers[index].publish();
        if (receipt.verified !== true || receipt.state !== 'verified') {
          set(receipt.state === 'refused' ? 'refused' : 'unconfirmed', index,
            { reason: receipt.reason || 'part_unconfirmed', failedPart: index });
          return copy(status);
        }
        set('publishing-parts', index + 1);
      }
      set('publishing-root', partGraphs.length);
      const receipt = await rootPublisher.publish();
      if (receipt.verified !== true || receipt.state !== 'verified') {
        set(receipt.state === 'refused' ? 'refused' : 'unconfirmed', partGraphs.length,
          { reason: receipt.reason || 'root_unconfirmed' });
      } else set('verified', partGraphs.length, { verified: true, root: receipt });
    } catch (error) {
      set('refused', status.completedParts, { reason: error.code || 'native_composition_unavailable' });
    }
    return copy(status);
  }
  return Object.freeze({
    publish() { if (!inflight) inflight = run().finally(() => { inflight = null; }); return inflight; },
    status() { return copy(status); },
  });
}
