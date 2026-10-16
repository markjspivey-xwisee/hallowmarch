/** Native identity admission and a short, holder-bound realtime lease.
 *
 * REQUIRED TRUST PORTS (not implemented here): readOwnerGrantHead verifies the
 * current OWNER-POD head, owner/authorship and content binding before extracting
 * the exact grant; resolveAgentProof verifies the current canonical native agent
 * and its signer against independently trusted native identity/delegation data.
 * Neither port may trust caller-supplied pod URLs, keys, anchors or booleans.
 *
 * The native rev-196 envelope authenticates admission, not movement. Every local
 * command then proves possession of the Ed25519 key bound by that admission.
 * Cross-pod revocation is bounded by leaseMs; native renewal fails closed. This
 * module publishes nothing and accepts no native bearer, private key or fallback.
 */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { NATIVE_OWNER_AGENT_GRANT_SCHEMA, OWNER_AGENT_GRANT_FIELDS as GRANT_FIELDS,
  OWNER_AGENT_GRANT_ROLES as ROLES } from '../../client/native-pod/owner-agent-grant-schema.mjs';
export { NATIVE_OWNER_AGENT_GRANT_SCHEMA };

const PURPOSE = 'urn:interego:gaming:agent-admission:v1';
const GRANT_SCHEMA = 'interego.gaming.owner-agent-grant/v1';
const REQUEST_FIELDS = ['sequence', 'at', 'method', 'path', 'action', 'roomId', 'entityId', 'body'];
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DID = /^did:[a-z0-9]+:[^\s\u0000-\u001f\u007f]{1,500}$/;
const ADDRESS = /^did:ethr:(0x[0-9a-f]{40})$/i;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : JSON.stringify(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const sameDid = (a, b) => ADDRESS.test(a) && ADDRESS.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b;

export class NativeAgentProofError extends Error {
  constructor(code) { super(code); this.name = 'NativeAgentProofError'; this.code = code; }
}
const fail = code => { throw new NativeAgentProofError(code); };
function fields(value, expected) {
  if (!plain(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) fail('invalid_proof_shape');
  return value;
}
function bounded(value, fallback, min, max) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new TypeError('Invalid native proof bound');
  return result;
}
function text(value, max = 512) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > max || /[\s\u0000-\u001f\u007f]/.test(value)) fail('invalid_proof_shape');
  return value;
}
function instant(value) {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(result) || new Date(result).toISOString() !== value) fail('invalid_proof_time');
  return result;
}
function publicUrl(value, root = false) {
  let url;
  try { url = new URL(text(value, 2048)); } catch { fail('invalid_proof_url'); }
  if (url.protocol !== 'https:' || url.href !== value || url.username || url.password || url.search || url.hash
    || /[%\\]/.test(value) || /\/{2}/.test(url.pathname) || (root && !url.pathname.endsWith('/'))) fail('invalid_proof_url');
  return url;
}
function snapshot(value, limit = 16_384) {
  let bytes;
  try { bytes = JSON.stringify(value); } catch { fail('invalid_proof_shape'); }
  if (!bytes || Buffer.byteLength(bytes) > limit) fail('proof_too_large');
  const check = (item, depth = 0) => {
    if (depth > 12 || (typeof item === 'number' && !Number.isFinite(item)) || item === undefined
      || !['object', 'string', 'number', 'boolean'].includes(typeof item) && item !== null) fail('invalid_proof_shape');
    if (item && typeof item === 'object') {
      if (!Array.isArray(item) && !plain(item)) fail('invalid_proof_shape');
      if (Object.keys(item).length > 128) fail('proof_too_large');
      Object.values(item).forEach(child => check(child, depth + 1));
    }
  };
  check(value); return JSON.parse(bytes);
}
function sessionKey(value) {
  fields(value, ['kty', 'crv', 'x']);
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519' || !TOKEN.test(value.x)
    || Buffer.from(value.x, 'base64url').length !== 32 || Buffer.from(value.x, 'base64url').toString('base64url') !== value.x) fail('invalid_session_key');
  try {
    const key = createPublicKey({ key: value, format: 'jwk' });
    if (key.export({ format: 'jwk' }).x !== value.x) fail('invalid_session_key');
    return key;
  } catch { fail('invalid_session_key'); }
}
function validSignature(message, signature, key) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)
    || Buffer.from(signature, 'base64url').toString('base64url') !== signature) fail('invalid_session_signature');
  if (!verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64url'))) fail('invalid_session_signature');
}

/** Exact bytes for the subordinate holder's one-use admission proof. */
export function agentSessionPossessionMessage(payload) {
  return 'Interego gaming agent session possession v1\n' + canonical(snapshot(payload));
}
/** The host MUST construct request from its actual method, path and parsed body. */
export function agentCommandMessage(sessionId, request) {
  if (!TOKEN.test(sessionId)) fail('invalid_session');
  fields(request, REQUEST_FIELDS);
  return 'Interego gaming agent command v1\n' + canonical({ sessionId, request: snapshot(request) });
}
export function agentRenewalMessage(sessionId, request) {
  if (!TOKEN.test(sessionId)) fail('invalid_session');
  fields(request, ['sequence', 'at']);
  return 'Interego gaming agent renewal v1\n' + canonical({ sessionId, ...snapshot(request) });
}

export function createNativeAgentProofAdapter(options = {}) {
  if (typeof options.nativeCore?.recoverMessageSigner !== 'function' || typeof options.readOwnerGrantHead !== 'function'
    || typeof options.resolveAgentProof !== 'function') throw new TypeError('Native signature, current owner-head and current agent-proof ports are required');
  let origin;
  try { origin = new URL(options.audience); } catch { throw new TypeError('An exact HTTPS audience is required'); }
  if (origin.protocol !== 'https:' || origin.origin !== options.audience) throw new TypeError('An exact HTTPS audience is required');
  if (typeof options.applicationId !== 'string' || !/^[a-z][a-z0-9+.-]*:[^\s]+$/i.test(options.applicationId)) throw new TypeError('An exact application IRI is required');
  const leaseMs = bounded(options.leaseMs, 10_000, 1000, 30_000);
  const challengeTtlMs = bounded(options.challengeTtlMs, 30_000, 1000, 60_000);
  const maxPending = bounded(options.maxPending, 256, 1, 4096), maxSessions = bounded(options.maxSessions, 256, 1, 4096);
  const requestTimeoutMs = bounded(options.requestTimeoutMs, 5000, 100, 10_000);
  const now = options.now ?? Date.now, pending = new Map(), sessions = new Map(), calls = new Set(), revoked = new Map();
  if (typeof now !== 'function') throw new TypeError('A trusted native proof clock is required');
  let active = 0, closed = false;
  const at = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) fail('invalid_proof_time'); return value; };
  const open = () => { if (closed) fail('proof_adapter_closed'); };
  const prune = () => {
    const time = at();
    for (const map of [pending, sessions]) for (const [id, entry] of map) if (entry.expiresAt <= time) map.delete(id);
    for (const [id, expiresAt] of revoked) if (expiresAt <= time) revoked.delete(id);
  };
  async function read(port, args) {
    open(); if (calls.size >= 2 * maxPending) fail('proof_capacity');
    const controller = new AbortController(); calls.add(controller); let timer;
    const task = Promise.resolve().then(() => port({ ...args, signal: controller.signal }));
    // A timed-out port that ignores abort retains its concurrency permit until
    // it settles, preventing repeated timeouts from spawning unlimited work.
    task.then(() => calls.delete(controller), () => calls.delete(controller));
    try {
      return await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new NativeAgentProofError('native_proof_unavailable'));
      }, requestTimeoutMs); })]);
    } catch { fail('native_proof_unavailable'); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  function recent(observedAt) {
    const time = at();
    if (!Number.isSafeInteger(observedAt) || observedAt > time || observedAt < time - leaseMs) fail('stale_native_proof');
  }
  async function ownerHead(grantId) {
    if (revoked.has(grantId)) fail('owner_grant_revoked');
    const value = snapshot(await read(options.readOwnerGrantHead, { grantId })), grant = value.grant;
    fields(grant, GRANT_FIELDS);
    if (grant.schema !== GRANT_SCHEMA || grant.id !== grantId || !/^urn:uuid:[0-9a-f-]{36}$/.test(grant.id)
      || !new RegExp(NATIVE_OWNER_AGENT_GRANT_SCHEMA.properties.id.pattern).test(grant.id)
      || !DID.test(grant.issuer) || !DID.test(grant.actor) || grant.applicationId !== options.applicationId || grant.audience !== origin.origin
      || grant.revoked !== false || !Object.hasOwn(ROLES, grant.role) || !Array.isArray(grant.actions) || !grant.actions.length
      || grant.actions.length > 4 || new Set(grant.actions).size !== grant.actions.length || grant.actions.some(action => !ROLES[grant.role].includes(action))
      || !Number.isSafeInteger(grant.maxCommandsPerSecond) || grant.maxCommandsPerSecond < 1 || grant.maxCommandsPerSecond > 20) fail('owner_grant_rejected');
    text(grant.roomId, 256); text(grant.entityId, 256);
    const starts = instant(grant.notBefore), ends = instant(grant.expiresAt), time = at();
    if (ends <= starts || ends - starts > 3_600_000 || time < starts || time >= ends) fail('owner_grant_expired');
    const pod = publicUrl(value.ownerPodUrl, true), descriptor = publicUrl(value.descriptorUrl);
    if (descriptor.origin !== pod.origin || !descriptor.pathname.startsWith(pod.pathname) || descriptor.pathname === pod.pathname
      || descriptor.pathname.endsWith('/')) fail('owner_record_outside_pod');
    text(value.graphIri, 1024); if (!value.graphIri.startsWith('urn:graph:')) fail('owner_grant_rejected');
    text(value.cid, 256); if (typeof value.contentDigest !== 'string' || !/^(?:(?:sha256|graph-nquads-sha256):)?[0-9a-f]{64}$/.test(value.contentDigest)) fail('owner_grant_rejected');
    recent(value.observedAt); if (revoked.has(grantId)) fail('owner_grant_revoked');
    return freeze({ grant, grantDigest: hash(canonical(grant)), record: { ownerPodUrl: pod.href, descriptorUrl: descriptor.href,
      graphIri: value.graphIri, cid: value.cid, contentDigest: value.contentDigest }, observedAt: value.observedAt });
  }
  async function agentIdentity(agentDid, signatureSigner) {
    const identity = snapshot(await read(options.resolveAgentProof, { agentDid, signatureSigner }));
    if (typeof identity.agentDid !== 'string' || !sameDid(identity.agentDid, agentDid) || identity.signerDid?.toLowerCase() !== signatureSigner
      || !['independent-key', 'relay-mediated'].includes(identity.mode) || !Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= at()) fail('native_agent_rejected');
    publicUrl(identity.podUrl, true); recent(identity.observedAt);
    if (identity.mode === 'independent-key' && (!ADDRESS.test(agentDid) || !sameDid(agentDid, signatureSigner))) fail('native_agent_key_unproven');
    if (identity.mode === 'relay-mediated' && !/^did:web:[^\s]+:agents:[^\s]+$/.test(agentDid)) fail('native_agent_rejected');
    return freeze({ agentDid: identity.agentDid, podUrl: identity.podUrl, mode: identity.mode,
      signerDid: identity.signerDid.toLowerCase(), observedAt: identity.observedAt, expiresAt: identity.expiresAt });
  }
  const expiry = (head, identity) => Math.min(head.observedAt + leaseMs, identity.observedAt + leaseMs,
    instant(head.grant.expiresAt), identity.expiresAt);
  function getSession(id) { open(); prune(); const session = sessions.get(id); if (!session) fail('agent_session_unavailable'); return session; }
  function sequence(session, sequence, timestamp) {
    if (at() < session.lastAt) fail('agent_clock_regressed');
    if (!Number.isSafeInteger(sequence) || sequence !== session.sequence + 1) fail('agent_sequence_rejected');
    if (!Number.isSafeInteger(timestamp) || Math.abs(at() - timestamp) > 5000) fail('agent_command_expired');
  }
  const receipt = (head, identity) => freeze({ ownerDid: head.grant.issuer, agentDid: head.grant.actor, applicationId: head.grant.applicationId,
    audience: head.grant.audience, grantId: head.grant.id, grantDigest: head.grantDigest, grantExpiresAt: head.grant.expiresAt, ownerRecord: { ...head.record },
    scope: { roomId: head.grant.roomId, entityId: head.grant.entityId, role: head.grant.role, actions: [...head.grant.actions],
      maxCommandsPerSecond: head.grant.maxCommandsPerSecond }, proofMode: identity.mode, signatureSigner: identity.signerDid,
    revocation: { model: 'bounded-native-lease', maxPropagationMs: leaseMs } });
  return Object.freeze({
    invalidateSession(sessionId) { sessions.delete(sessionId); },
    isSessionActive(sessionId) { prune(); return !closed && sessions.has(sessionId); },
    status() { prune(); return { enabled: !closed, pending: pending.size, active, sessions: sessions.size, nativeReads: calls.size, leaseMs }; },
    async challenge({ grantId, sessionPublicKeyJwk } = {}) {
      open(); prune(); if (pending.size + active >= maxPending || sessions.size >= maxSessions) fail('proof_capacity');
      text(grantId, 256); const publicKey = freeze(snapshot(sessionPublicKeyJwk)); sessionKey(publicKey); active++;
      try {
        const head = await ownerHead(grantId); open(); prune();
        if (pending.size + active > maxPending || sessions.size >= maxSessions) fail('proof_capacity');
        const challengeId = randomBytes(32).toString('base64url');
        const payload = freeze({ purpose: PURPOSE, applicationId: options.applicationId, audience: origin.origin,
          challenge: challengeId, grantId, grantDigest: head.grantDigest, sessionPublicKeyJwk: publicKey });
        const expiresAt = Math.min(at() + challengeTtlMs, instant(head.grant.expiresAt));
        pending.set(challengeId, { payload, agentDid: head.grant.actor, expiresAt });
        return freeze({ challengeId, payload, expiresAt });
      } finally { active--; }
    },
    async complete({ challengeId, envelope, sessionSignature } = {}) {
      open(); prune(); const challenge = pending.get(challengeId); if (!challenge) fail('agent_challenge_unavailable');
      pending.delete(challengeId); active++;
      try {
        const raw = snapshot(envelope, 32_768);
        if (typeof raw._signed_payload !== 'string' || Buffer.byteLength(raw._signed_payload) > 16_384 || typeof raw._signature !== 'string'
          || !/^0x[0-9a-fA-F]{130}$/.test(raw._signature)) fail('invalid_native_signature');
        let payload, signer;
        try {
          payload = JSON.parse(raw._signed_payload);
          signer = options.nativeCore.recoverMessageSigner('sha256:' + hash(raw._signed_payload), raw._signature);
        } catch { fail('invalid_native_signature'); }
        const keys = [...Object.keys(challenge.payload), 'agent_id', 'subject_pod_url', 'timestamp'];
        fields(payload, keys);
        if (Object.entries(challenge.payload).some(([key, value]) => canonical(payload[key]) !== canonical(value))
          || !sameDid(payload.agent_id, challenge.agentDid) || Math.abs(at() - instant(payload.timestamp)) > 60_000) fail('agent_challenge_mismatch');
        if (typeof signer !== 'string' || !/^0x[0-9a-f]{40}$/i.test(signer)) fail('invalid_native_signature');
        const signatureSigner = 'did:ethr:' + signer.toLowerCase(), key = sessionKey(challenge.payload.sessionPublicKeyJwk);
        validSignature(agentSessionPossessionMessage(challenge.payload), sessionSignature, key);
        const [head, identity] = await Promise.all([ownerHead(challenge.payload.grantId), agentIdentity(challenge.agentDid, signatureSigner)]);
        open(); prune();
        if (revoked.has(head.grant.id) || head.grantDigest !== challenge.payload.grantDigest || !sameDid(head.grant.actor, identity.agentDid)
          || payload.subject_pod_url !== identity.podUrl || challenge.expiresAt <= at()) fail('agent_challenge_mismatch');
        if (sessions.size >= maxSessions) fail('proof_capacity');
        const sessionId = randomBytes(32).toString('base64url'), expiresAt = expiry(head, identity);
        if (expiresAt <= at()) fail('agent_session_unavailable');
        const record = { head, identity, key, expiresAt, sequence: 0, commandTimes: [], renewing: false, lastAt: at() };
        sessions.set(sessionId, record);
        return freeze({ sessionId, expiresAt, identity: { ...identity }, receipt: receipt(head, identity) });
      } finally { active--; }
    },
    authorize({ sessionId, request, signature } = {}) {
      const session = getSession(sessionId), command = snapshot(request, 8192); fields(command, REQUEST_FIELDS);
      sequence(session, command.sequence, command.at);
      if (!/^(?:GET|POST|PUT|PATCH|DELETE)$/.test(command.method) || !/^\/[A-Za-z0-9/_.,-]+$/.test(command.path)
        || command.path.includes('//') || command.path.split('/').some(part => part === '.' || part === '..')) fail('invalid_command_target');
      const grant = session.head.grant;
      if (command.roomId !== grant.roomId || command.entityId !== grant.entityId || !grant.actions.includes(command.action)) fail('agent_scope_rejected');
      validSignature(agentCommandMessage(sessionId, command), signature, session.key);
      const time = at(), recentTimes = session.commandTimes.filter(value => value > time - 1000);
      if (recentTimes.length >= grant.maxCommandsPerSecond) fail('agent_rate_limited');
      session.sequence = command.sequence; session.commandTimes = [...recentTimes, time]; session.lastAt = time;
      return freeze({ agentDid: grant.actor, ownerDid: grant.issuer, grantId: grant.id, scope: { roomId: grant.roomId, entityId: grant.entityId,
        role: grant.role, actions: [...grant.actions], maxCommandsPerSecond: grant.maxCommandsPerSecond }, proofMode: session.identity.mode,
      receiptRef: { grantDigest: session.head.grantDigest, ...session.head.record }, expiresAt: session.expiresAt });
    },
    async renew({ sessionId, sequence: next, at: timestamp, signature } = {}) {
      const session = getSession(sessionId);
      try {
        if (session.renewing) fail('agent_renewal_in_progress');
        sequence(session, next, timestamp); validSignature(agentRenewalMessage(sessionId, { sequence: next, at: timestamp }), signature, session.key);
        session.renewing = true; session.sequence = next; session.lastAt = at();
        const [head, identity] = await Promise.all([ownerHead(session.head.grant.id), agentIdentity(session.head.grant.actor, session.identity.signerDid)]);
        open();
        if (revoked.has(head.grant.id) || sessions.get(sessionId) !== session || head.grantDigest !== session.head.grantDigest
          || identity.mode !== session.identity.mode || identity.podUrl !== session.identity.podUrl) fail('agent_renewal_rejected');
        const expiresAt = expiry(head, identity); if (expiresAt <= at()) fail('agent_session_unavailable');
        session.head = head; session.identity = identity; session.expiresAt = expiresAt; session.renewing = false;
        return freeze({ sessionId, expiresAt, identity: { ...identity }, receipt: receipt(head, identity) });
      } catch (error) { sessions.delete(sessionId); throw error; }
    },
    revoke(grantId) {
      open(); text(grantId, 256); prune();
      if (!revoked.has(grantId) && revoked.size >= maxPending + maxSessions) {
        closed = true; pending.clear(); sessions.clear(); for (const controller of calls) controller.abort();
        fail('proof_capacity');
      }
      // A revoked grant ID cannot be re-admitted from a still-active remote
      // snapshot. Grants last at most one hour; re-grants use a new UUID.
      revoked.set(grantId, at() + 3_600_000);
      for (const [id, entry] of pending) if (entry.payload.grantId === grantId) pending.delete(id);
      for (const [id, entry] of sessions) if (entry.head.grant.id === grantId) sessions.delete(id);
    },
    close() { closed = true; pending.clear(); sessions.clear(); for (const controller of calls) controller.abort(); },
  });
}
