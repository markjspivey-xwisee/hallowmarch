/** Read-only discovery of the current owner's existing native delegates.
 * A directory choice is not agent admission, a signing capability or consent. */
import { RelayMcpTransport } from './vendor/interego-browser.mjs';

const REQUIRED = ['get_pod_status', 'verify_agent'];
const SCOPES = new Set(['ReadWrite', 'ReadOnly', 'PublishOnly', 'DiscoverOnly']);
const MAX_AGENTS = 128;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const absent = value => value === undefined || value === null;
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
export class OwnerAgentDirectoryError extends Error {
  constructor(code) { super('Your saved agents could not be confirmed. Reconnect your identity and try again.'); this.name = 'OwnerAgentDirectoryError'; this.code = code; }
}
const fail = code => { throw new OwnerAgentDirectoryError(code); };
function nativeUrl(value, { root = false, secure = false } = {}) {
  let url; try { url = new URL(value); } catch { fail('agent_directory_configuration'); }
  if (typeof value !== 'string' || value.length > 2048 || url.href !== value || url.username || url.password || url.search || url.hash
    || /[%\\\s]/.test(value) || !(secure ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol))
    || (root && !/^\/[A-Za-z0-9_-]+\/$/.test(url.pathname))) fail('agent_directory_configuration');
  return url;
}
function agentDid(value, identityHost) {
  return typeof value === 'string' && value.length <= 512
    && value.startsWith('did:web:' + identityHost + ':agents:')
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value.slice(('did:web:' + identityHost + ':agents:').length));
}
function metadata(value, kind) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > (kind === 'surface' ? 64 : 128)
    || /[\u0000-\u001f\u007f]/.test(value) || kind === 'surface' && value && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    || /\bBearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----|[?&#](?:access_token|refresh_token|api_key|token)=/i.test(value)) fail('agent_directory_contract');
  return value;
}
function time(value) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) fail('agent_directory_contract');
  return Date.parse(value);
}

/** The binding and credential come from the already verified owner browser.
 * list() returns candidates, with no default selection. verify(did) freshly
 * checks only an exact current candidate's direct native delegation. Neither
 * operation registers, repairs, signs, publishes or grants anything. */
export function createOwnerAgentDirectory({ binding, credential, relayUrl,
  createTransport = (relay, grant) => new RelayMcpTransport(relay, grant, globalThis.fetch.bind(globalThis)),
  now = Date.now } = {}) {
  if (!plain(binding) || typeof now !== 'function' || typeof createTransport !== 'function') fail('agent_directory_configuration');
  const owner = /^did:web:([^:]+):users:([A-Za-z0-9_-]+)$/.exec(binding.subjectDid || '');
  if (!owner) fail('agent_directory_configuration');
  let identity; try { identity = new URL('https://' + decodeURIComponent(owner[1])); } catch { fail('agent_directory_configuration'); }
  if (identity.pathname !== '/' || identity.search || identity.hash || identity.username || identity.password
    || identity.host.replaceAll(':', '%3A') !== owner[1]) fail('agent_directory_configuration');
  const canonicalPod = nativeUrl(binding.podUrl, { root: true, secure: true });
  const ownerDid = binding.subjectDid, slug = owner[2], webId = identity.origin + '/users/' + slug + '/profile#me';
  const sessionDid = binding.authenticatedAgentDid;
  if (canonicalPod.pathname !== '/' + slug + '/' || binding.webId !== webId || !agentDid(sessionDid, owner[1])) fail('agent_directory_configuration');
  let relay; try { relay = new URL(relayUrl); } catch { fail('agent_directory_configuration'); }
  if (relay.protocol !== 'https:' || relay.origin !== relayUrl) fail('agent_directory_configuration');
  const initialTime = now();
  if (!Number.isSafeInteger(initialTime) || initialTime < 0 || !plain(credential) || credential.kind !== 'relay-oauth-bearer'
    || typeof credential.accessToken !== 'string' || credential.accessToken.length < 16 || credential.accessToken.length > 16384
    || /[\s\u0000-\u001f\u007f]/.test(credential.accessToken) || !['webauthn', 'siwe'].includes(credential.method)
    || !Number.isSafeInteger(credential.expiresAt) || credential.expiresAt <= initialTime || !absent(credential.refreshToken)
    || !absent(credential.clientId) && (typeof credential.clientId !== 'string' || credential.clientId.length > 512)) fail('needs_reauth');
  let held = { kind: credential.kind, accessToken: credential.accessToken, method: credential.method,
    expiresAt: credential.expiresAt, refreshToken: null, clientId: credential.clientId ?? null };
  let closed = false, tx = null, connected = false, queue = Promise.resolve();
  const controllers = new Set();
  function active() {
    if (closed) fail('agent_directory_closed');
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0 || !held || held.expiresAt <= at) { clearCredential(); fail('needs_reauth'); }
    return at;
  }
  function clearCredential() {
    if (held) held.accessToken = '';
    held = null;
    try { tx?.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', refreshToken: null, expiresAt: 0 }); } catch { /* Local closure remains final. */ }
  }
  async function connect() {
    active(); if (connected) return;
    try {
      tx ||= createTransport(relay.origin, { ...held });
      if (!tx || typeof tx.connect !== 'function' || typeof tx.callTool !== 'function') fail('agent_directory_contract');
      const manifest = await tx.connect(REQUIRED, 'get_pod_status'); active();
      if (!Array.isArray(manifest?.granted) || !REQUIRED.every(name => manifest.granted.includes(name))) fail('agent_directory_capability_missing');
      connected = true;
    } catch (error) {
      active();
      if (error instanceof OwnerAgentDirectoryError) throw error;
      fail(error?.code === 'needs_reauth' ? 'needs_reauth' : 'agent_directory_unavailable');
    }
  }
  async function tool(name, args) {
    active(); const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 35000);
    controllers.add(controller);
    try {
      const result = await tx.callTool(name, args, { cache: false, signal: controller.signal }); active();
      if (!plain(result) || result.error) fail('agent_directory_contract');
      return result;
    } catch (error) {
      active();
      if (error instanceof OwnerAgentDirectoryError) throw error;
      fail(error?.code === 'needs_reauth' ? 'needs_reauth' : 'agent_directory_unavailable');
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function roster() {
    const status = await tool('get_pod_status', {}), at = active();
    let actualPod; try { actualPod = nativeUrl(status.pod, { root: true }); } catch { fail('agent_directory_owner_mismatch'); }
    if (status.userId !== slug || status.identity?.did !== ownerDid || status.sessionAgent?.did !== sessionDid
      || actualPod.pathname !== canonicalPod.pathname || status.identity?.webId !== undefined && status.identity.webId !== webId
      || status.webId !== undefined && status.webId !== webId || status.registry?.owner !== undefined && status.registry.owner !== webId) fail('agent_directory_owner_mismatch');
    const registry = status.delegationRegistry;
    if (!plain(registry) || registry.owner !== webId || registry.url !== actualPod.href + 'agents'
      || !Array.isArray(registry.rows) || registry.count !== registry.rows.length) fail('agent_directory_contract');
    const entries = status.agents ?? [];
    if (!Array.isArray(entries) || !['identity-server', 'pod-delegation-registry', 'none'].includes(status.agentsSource)
      || entries.length && status.agentsSource === 'none') fail('agent_directory_contract');
    if (entries.length > MAX_AGENTS || registry.rows.length > MAX_AGENTS) fail('agent_directory_capacity');
    const labels = new Map();
    for (const entry of entries) {
      if (!plain(entry)) fail('agent_directory_contract');
      if (!agentDid(entry.did, owner[1])) continue;
      const next = { label: metadata(entry.label, 'label'), surface: metadata(entry.surface, 'surface') };
      const previous = labels.get(entry.did);
      if (previous && (previous.label !== next.label || previous.surface !== next.surface)) fail('agent_directory_ambiguous');
      labels.set(entry.did, next);
    }
    const candidates = new Map();
    for (const row of registry.rows) {
      if (!plain(row)) fail('agent_directory_contract');
      if (!agentDid(row.agentId, owner[1])) continue;
      if (row.revoked !== undefined && typeof row.revoked !== 'boolean' || !SCOPES.has(row.scope)) fail('agent_directory_contract');
      if (row.revoked === true || row.validFrom !== undefined && time(row.validFrom) > at
        || row.validUntil !== undefined && time(row.validUntil) <= at) continue;
      if (candidates.has(row.agentId)) fail('agent_directory_ambiguous');
      const known = labels.get(row.agentId), label = metadata(row.label, 'label') || known?.label || row.agentId;
      candidates.set(row.agentId, { agent: Object.freeze({ did: row.agentId, label, surface: known?.surface || '' }),
        scope: row.scope, validFrom: row.validFrom, validUntil: row.validUntil });
    }
    return { candidates, actualPod: actualPod.href };
  }
  const outward = agents => Object.freeze({ ownerDid, podUrl: canonicalPod.href, agents: Object.freeze(agents) });
  async function list() {
    await connect(); const current = await roster(); active();
    return outward([...current.candidates.values()].map(candidate => candidate.agent));
  }
  async function verify(did) {
    active(); if (!agentDid(did, owner[1])) fail('agent_directory_not_registered');
    await connect(); const before = await roster(), selected = before.candidates.get(did);
    if (!selected) fail('agent_directory_not_registered');
    const verdict = await tool('verify_agent', { agent_id: did, pod_url: canonicalPod.href });
    const roots = new Set([canonicalPod.href, before.actualPod]), chain = verdict.delegationChain, signing = verdict.signing, enforcement = verdict.enforcement;
    // Match the production native reader's direct, owner-anchored signer
    // contract. ReadOnly/DiscoverOnly agents need no storage-scope widening.
    if (!roots.has(verdict.subjectPodUrl) || verdict.subject_pod_url !== verdict.subjectPodUrl
      || verdict.subject_pod_name !== slug || verdict.subject_pod_selected_by !== 'pod_url'
      || verdict.owner !== webId || verdict.agent !== did || verdict.valid !== true || verdict.verified !== true
      || verdict.trustLevel !== 'CryptographicallyVerified' || verdict.chainLength !== 1 || !absent(verdict.reason)
      || !plain(chain) || chain.anchored !== true || chain.length !== 1 || chain.owner !== webId || chain.agent !== did
      || verdict.scope !== selected.scope || chain.scope !== selected.scope
      || !plain(enforcement) || enforcement.enforced !== true || enforcement.scope !== selected.scope
      || enforcement.basis !== 'signed-chain' || !absent(enforcement.chainReason)
      || !plain(signing) || signing.credentialAgentId !== did || signing.canSignDelegatedRequests !== true
      || !address(signing.relayAnchor) || !address(signing.credentialAnchor)
      || signing.relayAnchor.toLowerCase() !== signing.credentialAnchor.toLowerCase()) fail('agent_directory_unverified');
    const after = await roster(), current = after.candidates.get(did); active();
    if (!current || current.scope !== selected.scope || current.validFrom !== selected.validFrom
      || current.validUntil !== selected.validUntil) fail('agent_directory_unverified');
    return Object.freeze({ verified: true, ownerDid, podUrl: canonicalPod.href, agent: current.agent });
  }
  const enqueue = run => {
    const next = queue.then(() => { active(); return run(); }); queue = next.catch(() => {}); return next;
  };
  return Object.freeze({ list: () => enqueue(list), verify: did => enqueue(() => verify(did)), close() {
    if (closed) return;
    closed = true; connected = false;
    for (const controller of controllers) controller.abort(); controllers.clear();
    clearCredential(); tx = null;
  } });
}
