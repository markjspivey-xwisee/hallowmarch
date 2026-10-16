/** Hallowmarch main-world agent client. WebCrypto + fetch only; no ambient
 * credential, filesystem, token, LLM provider, or import-time network access. */
const encoder = new TextEncoder();
const PREFIX = 'urn:interego:hallowmarch:main-world-agent:';
const PURPOSE = 'urn:interego:gaming:agent-admission:v1';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DID = /^did:[a-z0-9]+:[^\s\u0000-\u001f\u007f]{1,500}$/;
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const canonical = v => plain(v) ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : JSON.stringify(v);
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const sameDid = (a, b) => /^did:ethr:0x[0-9a-f]{40}$/i.test(a) ? a.toLowerCase() === b?.toLowerCase() : a === b;
const text = (v, max = 128) => typeof v === 'string' && v.length > 0 && encoder.encode(v).length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export class WorldAgentClientError extends Error {
  constructor(code, { uncertain = false } = {}) {
    super(code); this.name = 'WorldAgentClientError'; this.code = code; this.uncertain = uncertain;
  }
}
const fail = (code, options) => { throw new WorldAgentClientError(code, options); };
function snapshot(value, limit = 65536) {
  // Reject getters/toJSON and non-JSON values before serializing a caller value.
  const visit = (v, depth = 0, seen = new Set()) => {
    if (depth > 12) fail('agent_input_too_large');
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v)) return;
    if ((!Array.isArray(v) && !plain(v)) || seen.has(v) || Object.keys(v).length > 128) fail('invalid_agent_input');
    seen.add(v);
    for (const key of Object.keys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (!d || !Object.hasOwn(d, 'value')) fail('invalid_agent_input');
      visit(d.value, depth + 1, seen);
    }
    seen.delete(v);
  };
  visit(value);
  const json = JSON.stringify(value);
  if (encoder.encode(json).length > limit) fail('agent_input_too_large');
  return JSON.parse(json);
}
function target(value, origin) {
  let url; try { url = new URL(value); } catch { fail('invalid_agent_target'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.href !== value || url.username || url.password || url.search || url.hash
    || !/^\/[A-Za-z0-9/_.,-]+$/.test(url.pathname) || url.pathname.includes('//') || url.pathname.split('/').some(p => p === '.' || p === '..')) fail('invalid_agent_target');
  return url;
}
function base64url(bytes) {
  let value = ''; for (const b of bytes) value += String.fromCharCode(b);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Pin the game origin/application DID and your native agent DID. sign_request
 * receives {payload} and must return the native {_signed_payload,_signature}
 * envelope as your own bound identity; unwrap MCP result wrappers in that port.
 * Browser calls need the game's same-origin trusted host (no cross-origin CORS
 * grant). Remote agent runtimes can use Node 22+ with their own native connector. */
export function createWorldAgentClient({ origin, applicationId, agentDid, sign_request,
  fetch: request = globalThis.fetch, crypto: webcrypto = globalThis.crypto, now = Date.now, timeoutMs = 40000 } = {}) {
  let parsed; try { parsed = new URL(origin); } catch { fail('invalid_agent_configuration'); }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin || !DID.test(applicationId || '') || !DID.test(agentDid || '')
    || typeof sign_request !== 'function' || typeof request !== 'function' || !webcrypto?.subtle || typeof webcrypto.randomUUID !== 'function'
    || typeof now !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 45000) fail('invalid_agent_configuration');
  let closed = false, routes = null, session = null, chain = Promise.resolve(), queued = 0, epoch = 0;
  const calls = new Set();
  const at = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0) fail('invalid_agent_clock'); return value; };
  const open = () => { if (closed) fail('agent_client_closed'); };
  const drop = () => { session = null; epoch++; };
  const checkEpoch = value => { open(); if (epoch !== value) fail('agent_connection_changed'); };
  function enqueue(task) {
    if (closed) return Promise.reject(new WorldAgentClientError('agent_client_closed'));
    if (queued >= 16) return Promise.reject(new WorldAgentClientError('agent_queue_full'));
    queued++;
    const promise = chain.then(async () => { open(); return task(); });
    chain = promise.catch(() => {});
    return promise.finally(() => { queued--; });
  }
  async function bounded(task, deadline = at() + timeoutMs) {
    open(); const selected = epoch, controller = new AbortController(); calls.add(controller);
    let timer;
    try {
      const duration = Math.min(timeoutMs, deadline - at());
      if (duration <= 0) fail('agent_operation_expired');
      const result = await Promise.race([Promise.resolve().then(() => { checkEpoch(selected); return task(controller.signal); }), new Promise((_, reject) => {
        const stop = () => reject(new WorldAgentClientError(closed ? 'agent_client_closed' : 'agent_operation_unconfirmed', { uncertain: true }));
        controller.signal.addEventListener('abort', stop, { once: true });
        timer = setTimeout(() => controller.abort(), duration);
      })]);
      checkEpoch(selected); return result;
    } catch (error) {
      if (error instanceof WorldAgentClientError) throw error;
      fail('agent_operation_unconfirmed', { uncertain: true });
    } finally { clearTimeout(timer); calls.delete(controller); }
  }
  async function http(url, body) {
    target(url, origin);
    return bounded(async signal => {
      const response = await request(url, { method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', credentials: 'omit',
        referrerPolicy: 'no-referrer', signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(snapshot(body, 32768)) } : {}) });
      if (response.redirected || response.url && response.url !== url) fail('invalid_agent_response');
      if (!response.ok) {
        // Never echo a remote error body, response URL, signed envelope, or key.
        fail('agent_request_refused', { uncertain: !!body });
      }
      const type = response.headers.get('content-type') || '';
      if (!/^application\/(?:json|ld\+json)(?:;|$)/i.test(type)) fail('invalid_agent_response');
      const reader = response.body?.getReader();
      if (!reader) fail('invalid_agent_response');
      const chunks = []; let size = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 65536) { await reader.cancel(); fail('agent_response_too_large'); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('invalid_agent_response'); }
      return snapshot(value);
    });
  }
  async function post(name, body) {
    const result = await http(routes[name], body);
    if (result.ok !== true || !plain(result.result)) fail('invalid_agent_response');
    return result.result;
  }
  async function discover() {
    const manifest = await http(origin + '/gaming/manifest'), entry = manifest.mainWorldAgents;
    if (entry?.enabled !== true || entry.scope !== 'main-world' || entry.audience !== origin || entry.applicationId !== applicationId) fail('agent_service_unavailable');
    const descriptor = target(entry.affordances, origin);
    if (descriptor.pathname !== '/world/native-agents') fail('invalid_agent_descriptor');
    const document = await http(descriptor.href);
    if (document['@id'] !== descriptor.href || document.enabled !== true || document.scope !== 'main-world' || document.audience !== origin
      || document.applicationId !== applicationId || document.proof?.sessionKey !== 'Ed25519' || !Array.isArray(document.operations)
      || document.operations.length > 32) fail('invalid_agent_descriptor');
    const found = {};
    for (const name of ['challenge', 'complete', 'renew', 'command', 'observe']) {
      const operations = document.operations.filter(op => op?.['iep:action']?.['@id'] === PREFIX + name);
      if (operations.length !== 1 || operations[0]['hydra:method'] !== 'POST') fail('invalid_agent_descriptor');
      const url = target(operations[0]['hydra:target'], origin);
      if (!url.pathname.startsWith('/world/') || Object.values(found).includes(url.href)) fail('invalid_agent_descriptor');
      found[name] = url.href;
    }
    routes = freeze(found);
    return freeze({ applicationId, audience: origin, scope: 'main-world', operations: { ...routes }, execution: 'owner-page-input-applied' });
  }
  function receipt(result, expected, durable = false) {
    const r = result.receipt, s = r?.scope;
    if (!TOKEN.test(result.sessionId || '') || result.sessionId !== (expected.sessionId || result.sessionId)
      || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= at() || result.expiresAt > at() + 30000
      || r?.grantId !== expected.grantId || r.applicationId !== applicationId || r.audience !== origin || !sameDid(r.agentDid, agentDid)
      || !s || s.roomId !== expected.roomId || s.entityId !== expected.entityId || !['teammate', 'pet', 'coach'].includes(s.role)
      || !Array.isArray(s.actions) || !s.actions.length || s.actions.some(a => !['observe', 'move', 'attack'].includes(a))
      || new Set(s.actions).size !== s.actions.length || !Number.isInteger(s.maxCommandsPerSecond) || s.maxCommandsPerSecond < 1 || s.maxCommandsPerSecond > 20
      || durable && (result.authority?.scope !== 'main-world' || result.authority.durable !== true)) fail('invalid_agent_admission');
    if (expected.scope && canonical(s) !== canonical(expected.scope)) fail('agent_scope_changed');
    return freeze(snapshot(s));
  }
  async function connect(input) {
    const config = snapshot(input, 2048);
    if (!exact(config, ['grantId', 'roomId', 'entityId']) || !UUID.test(config.grantId) || !text(config.roomId) || !text(config.entityId)) fail('invalid_agent_scope');
    drop(); const selected = epoch;
    try {
      await discover();
      const key = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); checkEpoch(selected);
      const exported = await webcrypto.subtle.exportKey('jwk', key.publicKey); checkEpoch(selected);
      const publicKey = { kty: exported.kty, crv: exported.crv, x: exported.x };
      const challenge = await post('challenge', { grantId: config.grantId, sessionPublicKeyJwk: publicKey }), p = challenge.payload;
      const fields = ['purpose', 'applicationId', 'audience', 'challenge', 'grantId', 'grantDigest', 'sessionPublicKeyJwk'];
      if (!exact(p, fields) || !TOKEN.test(challenge.challengeId || '') || p.challenge !== challenge.challengeId || p.purpose !== PURPOSE
        || p.applicationId !== applicationId || p.audience !== origin || p.grantId !== config.grantId || !/^[0-9a-f]{64}$/.test(p.grantDigest || '')
        || canonical(p.sessionPublicKeyJwk) !== canonical(publicKey) || !Number.isSafeInteger(challenge.expiresAt)
        || challenge.expiresAt <= at() || challenge.expiresAt > at() + 60000) fail('invalid_agent_challenge');
      const envelope = snapshot(await bounded(signal => sign_request({ payload: freeze(snapshot(p)) }, { expiresAt: challenge.expiresAt, signal }), challenge.expiresAt), 32768);
      if (!exact(envelope, ['_signature', '_signed_payload']) || !/^0x[0-9a-f]{130}$/i.test(envelope._signature || '')
        || typeof envelope._signed_payload !== 'string' || encoder.encode(envelope._signed_payload).length > 16384) fail('invalid_native_envelope');
      let signed; try { signed = JSON.parse(envelope._signed_payload); } catch { fail('invalid_native_envelope'); }
      if (!exact(signed, [...fields, 'agent_id', 'subject_pod_url', 'timestamp']) || fields.some(k => canonical(p[k]) !== canonical(signed[k]))
        || !sameDid(signed.agent_id, agentDid) || typeof signed.timestamp !== 'string' || !Number.isFinite(Date.parse(signed.timestamp))
        || new Date(Date.parse(signed.timestamp)).toISOString() !== signed.timestamp || Math.abs(at() - Date.parse(signed.timestamp)) > 60000) fail('native_envelope_binding_rejected');
      let pod; try { pod = new URL(signed.subject_pod_url); } catch { fail('native_envelope_binding_rejected'); }
      if (pod.protocol !== 'https:' || pod.href !== signed.subject_pod_url || !pod.pathname.endsWith('/') || pod.username || pod.password || pod.search || pod.hash) fail('native_envelope_binding_rejected');
      if (challenge.expiresAt <= at()) fail('agent_operation_expired');
      const signature = base64url(new Uint8Array(await webcrypto.subtle.sign('Ed25519', key.privateKey,
        encoder.encode('Interego gaming agent session possession v1\n' + canonical(p))))); checkEpoch(selected);
      // One completion attempt only: a lost response must never reuse a challenge.
      const admitted = await post('complete', { challengeId: challenge.challengeId, envelope, sessionSignature: signature });
      const scope = receipt(admitted, config, true);
      session = { ...config, scope, key: key.privateKey, sessionId: admitted.sessionId, expiresAt: admitted.expiresAt, sequence: 0 };
      return status();
    } catch (error) { drop(); throw error; }
  }
  const held = () => { open(); if (!session || session.expiresAt <= at()) { drop(); fail('agent_connection_required'); } return session; };
  async function sign(value) {
    const current = held(), selected = epoch;
    const signature = await webcrypto.subtle.sign('Ed25519', current.key, encoder.encode(value)); checkEpoch(selected);
    return base64url(new Uint8Array(signature));
  }
  async function renew() {
    const current = held(), sequence = ++current.sequence, time = at();
    try {
      const signature = await sign('Interego gaming agent renewal v1\n' + canonical({ sessionId: current.sessionId, sequence, at: time }));
      const result = await post('renew', { sessionId: current.sessionId, sequence, at: time, signature });
      receipt(result, current); current.expiresAt = result.expiresAt; return status();
    } catch (error) { drop(); throw error; }
  }
  async function operation(action, payload) {
    let current = held();
    if (!current.scope.actions.includes(action)) fail('agent_action_not_granted');
    if (current.expiresAt - at() <= 2000) { await renew(); current = held(); }
    const path = target(routes[action === 'observe' ? 'observe' : 'command'], origin).pathname;
    const command = action === 'observe' ? null : { type: action, commandId: current.sessionId + ':' + webcrypto.randomUUID(),
      roomId: current.roomId, entityId: current.entityId, ...payload };
    const body = command ? { command } : { roomId: current.roomId, entityId: current.entityId };
    const sequence = ++current.sequence, time = at(); let attempted = false;
    try {
      const signature = await sign('Interego gaming agent command v1\n' + canonical({ sessionId: current.sessionId,
        request: { sequence, at: time, method: 'POST', path, action, roomId: current.roomId, entityId: current.entityId, body } }));
      attempted = true;
      const result = await post(command ? 'command' : 'observe', { sessionId: current.sessionId, sequence, at: time, signature, ...body });
      if (command) {
        if (!exact(result, ['accepted', 'execution', 'requestId']) || result.accepted !== true || result.execution !== 'owner-page-input-applied' || !text(result.requestId)) fail('invalid_agent_execution_ack');
        return freeze(snapshot(result));
      }
      if (result.roomId !== current.roomId || result.entityId !== current.entityId || result.authority !== 'owner-page-observation'
        || !exact(result.state, ['ownerSession', 'at', 'body', 'targets']) || !text(result.state.ownerSession) || !Number.isSafeInteger(result.state.at)
        || !Array.isArray(result.state.targets) || result.state.targets.length > 24) fail('invalid_agent_observation');
      const bodyKeys = ['id', 'kind', 'name', 'x', 'y', 'z', 'hp', 'maxHp'], targetKeys = bodyKeys.filter(k => k !== 'kind');
      const validBody = (v, keys) => exact(v, keys) && text(v.id) && typeof v.name === 'string' && encoder.encode(v.name).length <= 160
        && !/[\u0000-\u001f\u007f]/.test(v.name) && [v.x, v.y, v.z].every(n => finite(n, -4000, 4000))
        && finite(v.hp, 0, 1e7) && finite(v.maxHp, 1, 1e7);
      if (!validBody(result.state.body, bodyKeys) || result.state.body.id !== current.entityId || !['player', 'companion'].includes(result.state.body.kind)
        || !result.state.targets.every(v => validBody(v, targetKeys))) fail('invalid_agent_observation');
      return freeze(snapshot(result));
    } catch (error) {
      if (command && attempted && error instanceof WorldAgentClientError) error.uncertain = true;
      drop(); throw error;
    }
  }
  function status() { return freeze({ connected: !closed && !!session && session.expiresAt > at(), closed,
    applicationId, audience: origin, agentDid, ...(session ? { grantId: session.grantId, expiresAt: session.expiresAt, scope: snapshot(session.scope) } : {}) }); }
  function inputOperation(action, value) {
    let input;
    try {
      input = snapshot(value, 1024);
      if (action === 'move' && (!exact(input, ['dx', 'dz', 'durationMs']) || !finite(input.dx, -1, 1) || !finite(input.dz, -1, 1)
        || Math.hypot(input.dx, input.dz) > 1.01 || !Number.isInteger(input.durationMs) || input.durationMs < 50 || input.durationMs > 500)) fail('invalid_agent_move');
      if (action === 'attack' && (!exact(input, ['targetId']) || !/^[A-Za-z0-9:_-]{1,100}$/.test(input.targetId || ''))) fail('invalid_agent_attack');
    } catch (error) { return Promise.reject(error); }
    return enqueue(() => operation(action, input));
  }
  return Object.freeze({ discover: () => enqueue(discover), connect(input) {
    let config; try { config = snapshot(input, 2048); } catch (error) { return Promise.reject(error); }
    return enqueue(() => connect(config));
  }, observe: () => enqueue(() => operation('observe')), move: input => inputOperation('move', input), attack: input => inputOperation('attack', input),
  renew: () => enqueue(renew), status, close() { if (!closed) { closed = true; drop(); routes = null; for (const controller of calls) controller.abort(); } } });
}
