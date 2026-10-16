/** Public signing-request broker. The host owns stdin; this module never reads
 * credentials, files, environment tokens or arbitrary JavaScript commands. */
import { randomUUID } from 'node:crypto';

const FIELDS = ['purpose', 'applicationId', 'audience', 'challenge', 'grantId', 'grantDigest', 'sessionPublicKeyJwk'];
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const canonical = value => plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : JSON.stringify(value);
const fail = code => { throw Object.assign(new Error('Manual native signing request refused.'), { code }); };
export function createNativeCompanionSigningBroker({ enabled, agentDid, agentPodUrl, writePublicRequest, now = Date.now, timeoutMs = 25000 } = {}) {
  if (enabled !== true) fail('qa_companion_opt_in');
  if (!/^did:web:[^\s]+:agents:[^\s]+$/.test(agentDid || '') || typeof writePublicRequest !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) fail('qa_companion_signing_configuration');
  let pod; try { pod = new URL(agentPodUrl); } catch { fail('qa_companion_signing_configuration'); }
  if (pod.protocol !== 'https:' || pod.href !== agentPodUrl || !pod.pathname.endsWith('/') || pod.username || pod.password || pod.search || pod.hash) fail('qa_companion_signing_configuration');
  let pending = null, closed = false;
  function rejectPending(code) { if (!pending) return; const held = pending; pending = null; clearTimeout(held.timer); held.reject(Object.assign(new Error('Manual native signing refused.'), { code })); }
  return Object.freeze({
    status() { return { kind: 'native_companion_signing', pending: !!pending, closed }; },
    signNativeRequest({ payload, expiresAt } = {}) {
      if (closed || pending) fail('qa_companion_signing_busy');
      if (!exact(payload, FIELDS) || payload.purpose !== 'urn:interego:gaming:agent-admission:v1'
        || !exact(payload.sessionPublicKeyJwk, ['kty', 'crv', 'x']) || payload.sessionPublicKeyJwk.kty !== 'OKP'
        || payload.sessionPublicKeyJwk.crv !== 'Ed25519' || !/^[A-Za-z0-9_-]{43}$/.test(payload.sessionPublicKeyJwk.x)
        || !/^did:[a-z0-9]+:[^\s]{1,500}$/.test(payload.applicationId || '') || !/^https:\/\/[A-Za-z0-9.:-]+$/.test(payload.audience || '')
        || !/^[A-Za-z0-9_-]{43}$/.test(payload.challenge || '') || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.grantId || '')
        || !/^[a-f0-9]{64}$/.test(payload.grantDigest || '') || !Number.isSafeInteger(expiresAt) || expiresAt <= now()
        || Buffer.byteLength(JSON.stringify(payload)) > 8192) fail('qa_companion_signing_payload');
      const requestId = randomUUID(), immutable = JSON.parse(JSON.stringify(payload));
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => rejectPending('qa_companion_signature_timeout'), Math.min(timeoutMs, expiresAt - now()));
        pending = { requestId, payload: immutable, expiresAt, resolve, reject, timer };
      });
      try { writePublicRequest({ kind: 'native_companion_sign_request', requestId, tool: 'interego.sign_request', args: { payload: immutable } }); }
      catch { rejectPending('qa_companion_signature_output'); }
      return promise;
    },
    acceptLine(line) {
      if (closed || !pending || typeof line !== 'string' || Buffer.byteLength(line) > 32768) return false;
      let value; try { value = JSON.parse(line); } catch { return false; }
      if (value?.kind !== 'native_companion_signed_envelope') return false;
      // Consume only this protocol's line; never echo rejected raw input.
      if (!exact(value, ['kind', 'requestId', 'envelope']) || value.requestId !== pending.requestId) return true;
      const envelope = value.envelope;
      if (!exact(envelope, ['_signed_payload', '_signature']) || typeof envelope._signed_payload !== 'string'
        || Buffer.byteLength(envelope._signed_payload) > 16384 || typeof envelope._signature !== 'string'
        || !/^0x[a-f0-9]{130}$/i.test(envelope._signature)) { rejectPending('qa_companion_signature_envelope'); return true; }
      let signed; try { signed = JSON.parse(envelope._signed_payload); } catch { rejectPending('qa_companion_signature_envelope'); return true; }
      const current = pending;
      if (!exact(signed, [...FIELDS, 'agent_id', 'subject_pod_url', 'timestamp']) || signed.agent_id !== agentDid
        || signed.subject_pod_url !== agentPodUrl || FIELDS.some(key => canonical(signed[key]) !== canonical(current.payload[key]))
        || typeof signed.timestamp !== 'string' || !Number.isFinite(Date.parse(signed.timestamp))
        || new Date(Date.parse(signed.timestamp)).toISOString() !== signed.timestamp || Math.abs(now() - Date.parse(signed.timestamp)) > 30000
        || current.expiresAt <= now()) { rejectPending('qa_companion_signature_binding'); return true; }
      clearTimeout(current.timer); pending = null; current.resolve({ ...envelope }); return true;
    },
    close() { closed = true; rejectPending('qa_companion_signing_closed'); },
  });
}
