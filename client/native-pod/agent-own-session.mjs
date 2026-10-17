/** Agent-host bridge over the pinned Interego native wallet sign-in flow.
 * The host keeps the wallet and encryption keys. Importing this module does no I/O. */
import { RelayMcpTransport } from './vendor/interego-browser.mjs';
import { createNativePodClient } from './client.mjs';
import { createOwnerPerformanceConsultation } from './performance-consultation.mjs';
import { createFoxxiConsultant } from './foxxi-consulting.mjs';

export const AGENT_OWN_SESSION_SURFACE = 'interego-delegate';
const REQUIRED = ['get_pod_status', 'sign_request'];
class AgentOwnSessionError extends Error { constructor(code, message) { super(message); this.name = 'AgentOwnSessionError'; this.code = code; } }
const fail = (code, message) => { throw new AgentOwnSessionError(code, message); };
const copy = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : plain(value)
  ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function finiteJson(value, depth = 0, seen = new Set()) {
  if (depth > 20) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if ((!Array.isArray(value) && !plain(value)) || seen.has(value)) return false;
  seen.add(value); const valid = (Array.isArray(value) ? [...value] : Object.values(value)).every(item => finiteJson(item, depth + 1, seen));
  seen.delete(value); return valid;
}
function origin(value) {
  let url; try { url = new URL(value); } catch { fail('invalid_agent_host', 'An HTTPS native service origin is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('invalid_agent_host', 'An HTTPS native service origin is required.');
  return url.origin;
}
function pod(value, secure = false) {
  let url; try { url = new URL(value); } catch { fail('agent_owner_mismatch', 'A native pod root is required.'); }
  if (!(secure ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash
    || !/^\/[a-zA-Z0-9_-]+\/$/.test(url.pathname)) fail('agent_owner_mismatch', 'A native pod root is required.');
  return url;
}
function credential(value, now) {
  if (value?.kind !== 'relay-oauth-bearer' || value.method !== 'siwe' || typeof value.accessToken !== 'string' || !value.accessToken
    || !Number.isFinite(value.expiresAt) || value.expiresAt <= now()) fail('agent_authentication_required', 'The agent host must provide a live native wallet OAuth session.');
  // Tokens stay inside the native transport. Reauthentication uses the host's
  // original signing callback; no refresh grant is exposed to game code.
  return { kind: value.kind, method: value.method, accessToken: value.accessToken, expiresAt: value.expiresAt, refreshToken: null, clientId: value.clientId || null };
}

/** nativeSignInWithWallet is the existing pinned SDK function exported from
 * applications/shared-workspace/desktop/src/auth.ts, supplied by the trusted host.
 * It receives (relay, identity, address, signMessage, redirectUri, clientName).
 * It must sign in this separate agent key, never add it to a human account. */
export function createAgentOwnSession({ walletAddress, signMessage, nativeSignInWithWallet,
  humanBinding, relayUrl, identityOrigin, redirectUri,
  createTransport = (relay, grant) => new RelayMcpTransport(relay, grant, globalThis.fetch.bind(globalThis)),
  crypto = globalThis.crypto, now = Date.now, fetch: nativeFetch = globalThis.fetch?.bind(globalThis) } = {}) {
  if (typeof walletAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)
    || typeof signMessage !== 'function' || typeof nativeSignInWithWallet !== 'function' || typeof createTransport !== 'function'
    || typeof now !== 'function' || typeof humanBinding?.subjectDid !== 'string') throw new TypeError('A separate host-held agent wallet, native sign-in function and verified player binding are required.');
  const relay = origin(relayUrl), identity = origin(identityOrigin), playerPod = pod(humanBinding.podUrl, true);
  const address = walletAddress.toLowerCase(), userId = 'u-eth-' + address.slice(2, 14);
  const ownerDid = 'did:web:' + new URL(identity).host + ':users:' + userId;
  const agentDid = 'did:web:' + new URL(identity).host + ':agents:' + AGENT_OWN_SESSION_SURFACE + '-' + userId;
  if (humanBinding.subjectDid === ownerDid || humanBinding.subjectDid.toLowerCase() === 'did:ethr:' + address
    || ['/' + userId + '/', '/eth-' + address.slice(2, 14) + '/'].includes(playerPod.pathname)) fail('separate_agent_identity_required', 'The agent wallet resolves to the player account. Use the agent host’s own identity.');
  let redirect; try { redirect = new URL(redirectUri); } catch { fail('invalid_agent_host', 'The native host needs an explicit OAuth callback.'); }
  if (redirect.username || redirect.password || redirect.hash || !(redirect.protocol === 'https:'
    || redirect.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname))) fail('invalid_agent_host', 'Use the native host’s HTTPS or loopback OAuth callback.');
  const binding = Object.freeze({ subjectDid: ownerDid, authenticatedAgentDid: agentDid,
    podUrl: new URL('/' + userId + '/', playerPod).href });
  let closed = false, connected = false, epoch = 0, opening = null, tx = null, nativeCredential = null;
  const children = new Set(), podAliases = new Set([binding.podUrl]);
  function check(selected = epoch) {
    if (closed || selected !== epoch) fail('agent_session_closed', 'The original agent host session is closed.');
    if (!connected) fail('agent_authentication_required', 'Connect the agent’s own native identity first.');
  }
  function clearTransport(port) {
    port?.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', refreshToken: null, method: 'siwe', expiresAt: now(), clientId: null });
  }
  function disconnect() {
    connected = false; epoch++;
    for (const child of children) child.close(); children.clear(); clearTransport(tx); tx = null; nativeCredential = null;
  }
  async function verify(port, selected) {
    let result;
    try { result = await port.callTool('get_pod_status', {}, { cache: false, signal: AbortSignal.timeout(35000) }); }
    catch { if (selected === epoch) disconnect(); clearTransport(port); fail('agent_identity_unavailable', 'Native agent identity verification did not complete.'); }
    if (closed || selected !== epoch) fail('agent_session_closed', 'The original agent host session is closed.');
    let reported; try { reported = pod(result?.pod); } catch (error) { disconnect(); clearTransport(port); throw error; }
    if (result?.error || result?.userId !== userId || result?.identity?.did !== ownerDid || result?.sessionAgent?.did !== agentDid
      || reported.pathname !== '/' + userId + '/') {
      disconnect(); clearTransport(port); fail('agent_owner_mismatch', 'Native sign-in did not prove this agent wallet’s own subject and pod.');
    }
    podAliases.add(reported.href); return result;
  }
  function port() {
    check(); const selected = epoch, native = tx;
    return Object.freeze({
      async connect(required, probe) { check(selected); const result = await native.connect(required, probe); check(selected); return result; },
      async callTool(name, input, options) { check(selected); const result = await native.callTool(name, input, options); check(selected); return result; },
    });
  }
  async function connect() {
    if (closed) fail('agent_session_closed', 'The agent host connection is closed.');
    if (opening) return opening;
    if (connected) { await verify(tx, epoch); return status(); }
    const selected = ++epoch;
    const run = (async () => {
      let native;
      try {
        const issued = await nativeSignInWithWallet(relay, identity, address, signMessage, redirect.href, AGENT_OWN_SESSION_SURFACE);
        if (closed || selected !== epoch) fail('agent_session_closed', 'The agent host connection closed during sign-in.');
        const ownCredential = credential(issued, now);
        native = createTransport(relay, ownCredential);
        if (!native || typeof native.connect !== 'function' || typeof native.callTool !== 'function') throw new TypeError('Native MCP transport required.');
        const capabilities = await native.connect(REQUIRED, 'get_pod_status');
        if (!REQUIRED.every(name => capabilities?.granted?.includes(name))) fail('agent_capability_missing', 'The agent native session lacks identity or signing capabilities.');
        await verify(native, selected); tx = native; nativeCredential = ownCredential; connected = true; return status();
      } catch (error) { clearTransport(native); if (error instanceof AgentOwnSessionError) throw error; fail('agent_authentication_failed', 'Native agent sign-in did not complete.'); }
    })();
    opening = run;
    try { return await run; } finally { if (opening === run) opening = null; }
  }
  function status() {
    return Object.freeze({ connected: connected && !closed, performerKind: 'agent', ownerDid, agentDid, podUrl: binding.podUrl,
      separateFromPlayer: true, keyCustody: 'agent-host', broadPlayerPodDelegation: false });
  }
  return Object.freeze({
    agentDid, connect, status,
    async reconnect() { if (opening) fail('agent_authentication_pending', 'Wait for the existing native sign-in attempt.'); if (closed) fail('agent_session_closed', 'The agent host connection is closed.'); disconnect(); return connect(); },
    binding() { check(); return copy(binding); },
    async verify() { check(); await verify(tx, epoch); return copy(binding); },
    async signRequest(request) {
      check(); if (!plain(request) || Object.keys(request).length !== 1 || !Object.hasOwn(request, 'payload') || !plain(request.payload)) fail('invalid_agent_request', 'Supply the exact native request payload.');
      if (['agent_id', 'timestamp', 'subject_pod_url'].some(key => Object.hasOwn(request.payload, key))) fail('invalid_agent_request', 'Native identity stamps cannot be caller-selected.');
      let payload; try {
        if (!finiteJson(request.payload)) throw Error('non-JSON');
        payload = copy(request.payload); const encoded = JSON.stringify(payload);
        if (new TextEncoder().encode(encoded).length > 16384) throw Error('oversized');
        if (canonical(payload) !== canonical(JSON.parse(encoded))) throw Error('non-JSON');
      } catch { fail('invalid_agent_request', 'The native request must be bounded finite JSON.'); }
      const selected = epoch; await verify(tx, selected); check(selected);
      let result;
      try { result = await tx.callTool('sign_request', { payload }, { cache: false, signal: AbortSignal.timeout(35000) }); }
      catch { fail('agent_signing_unavailable', 'Native agent signing did not complete.'); }
      check(selected);
      let signed; try { signed = JSON.parse(result?._signed_payload); } catch { fail('agent_signature_mismatch', 'Native signing did not return an agent envelope.'); }
      const stamped = pod(signed.subject_pod_url);
      const { agent_id: _agent, subject_pod_url: _pod, timestamp, ...body } = signed;
      if (signed.agent_id !== agentDid || !podAliases.has(stamped.href) || canonical(body) !== canonical(payload)
        || typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) || Math.abs(now() - Date.parse(timestamp)) > 60000
        || typeof result._signature !== 'string' || !result._signature) fail('agent_signature_mismatch', 'Native signing changed the exact request, agent, own pod or time.');
      return { _signature: result._signature, _signed_payload: result._signed_payload };
    },
    createPodProfile({ keyStorage } = {}) {
      check(); if (!keyStorage || typeof keyStorage.load !== 'function' || typeof keyStorage.create !== 'function') throw new TypeError('The agent host must supply its own durable encryption-key storage.');
      const profile = createNativePodClient({ relayUrl: relay, ownerDid, podUrl: binding.podUrl, credential: nativeCredential, transport: port(), keyStorage, crypto, now, fetch: nativeFetch });
      children.add(profile); return profile;
    },
    createJournal({ sessionId, keyStorage } = {}) {
      check(); if (!keyStorage || typeof keyStorage.load !== 'function' || typeof keyStorage.create !== 'function') throw new TypeError('The agent host must supply its own durable encryption-key storage.');
      const journal = createOwnerPerformanceConsultation({ binding, relayUrl: relay, sessionId, checkpoint: 'hallowmarch-performance-consultation/v1', credential: nativeCredential, transport: port(), keyStorage, crypto, now, fetch: nativeFetch });
      children.add(journal); return journal;
    },
    createConsultant({ sessionId, journal } = {}) {
      check();
      const consultant = createFoxxiConsultant({ binding, relayUrl: relay, sessionId, journal, subjectKind: 'agent', transport: port(), now });
      children.add(consultant); return consultant;
    },
    close() {
      if (closed) return; closed = true; disconnect();
    },
  });
}
