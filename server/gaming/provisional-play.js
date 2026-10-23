import { createHash, randomBytes } from 'node:crypto';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const digest = value => createHash('sha256').update(value).digest('base64url');
export class ProvisionalPlayError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status = 400) => { throw new ProvisionalPlayError(code, status); };
const safeChallenge = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(value);
const exactFields = (value, fields) => plain(value) && Object.keys(value).every(key => fields.includes(key));

export function provisionalKey(value) {
  if (!exactFields(value, ['kty', 'crv', 'x', 'y', 'ext', 'key_ops']) || value.kty !== 'EC' || value.crv !== 'P-256'
    || !/^[A-Za-z0-9_-]{43}$/.test(value.x || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.y || '')
    || (value.ext !== undefined && typeof value.ext !== 'boolean')
    || (value.key_ops !== undefined && (!Array.isArray(value.key_ops) || value.key_ops.some(op => op !== 'verify')))) fail('invalid_play_key');
  const publicKeyJwk = { crv: 'P-256', kty: 'EC', x: value.x, y: value.y };
  return { publicKeyJwk, thumbprint: digest(JSON.stringify(publicKeyJwk)) };
}
function https(value, originOnly = false) {
  let url; try { url = new URL(value); } catch { fail('invalid_play_provider', 500); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (originOnly && url.pathname !== '/')) fail('invalid_play_provider', 500);
  return url;
}
async function boundedJson(response, max = 32768) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > max) fail('play_response_too_large', 502);
  const reader = response.body?.getReader();
  let size = 0, chunks = [];
  if (reader) try { for (;;) {
    const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
    if (size > max) { await reader.cancel(); fail('play_response_too_large', 502); }
    chunks.push(Buffer.from(item.value));
  } } finally { reader.releaseLock(); }
  else { const value = await response.text(); size = Buffer.byteLength(value); if (size > max) fail('play_response_too_large', 502); chunks = [Buffer.from(value)]; }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_play_response', 502); }
}
function toolBody(value) {
  for (let depth = 0; depth < 6; depth++) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { fail('invalid_play_grant', 502); } continue; }
    if (!plain(value) || value.isError || value.error) fail('invalid_play_grant', 502);
    if (plain(value.structuredContent)) { value = value.structuredContent; continue; }
    if (plain(value.result)) { value = value.result; continue; }
    if (Array.isArray(value.content)) {
      const texts = value.content.filter(item => item?.type === 'text');
      if (texts.length !== 1) fail('invalid_play_grant', 502); value = texts[0].text; continue;
    }
    return value;
  }
  fail('invalid_play_grant', 502);
}

/** Discover and invoke the existing native service's signing affordance. The
 * service credential stays on the exact configured relay, never in a browser. */
export function createNativePlayGrantSigner({ identityProvider, catalogUrl = 'https://relay.interego.xwisee.com/tools',
  fetch: transport = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof identityProvider !== 'function' || typeof transport !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new TypeError('Native Play grant ports required.');
  const catalog = https(catalogUrl);
  let discovery = null;
  async function request(url, init = {}) {
    const target = https(url);
    if (target.origin !== catalog.origin) fail('foreign_play_signer', 502);
    let response;
    try { response = await transport(target.href, { ...init, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', ...(init.headers || {}) } }); }
    catch { fail('play_signer_unavailable', 503); }
    if (!response.ok || (response.url && response.url !== target.href)) fail('play_signer_refused', 503);
    return toolBody(await boundedJson(response, 1024 * 1024));
  }
  return async function sign(payload) {
    if (!discovery) discovery = request(catalog.href).then(data => {
      if (data['@id'] !== catalog.href || !Array.isArray(data['hydra:member']) || data['hydra:member'].length > 512) fail('invalid_play_signer_catalog', 502);
      const rows = data['hydra:member'].filter(item => item?.name === 'sign_request');
      if (rows.length !== 1) fail('missing_play_signer', 502);
      const controls = rows[0].affordances?.filter(item => item?.action === 'urn:iep:action:invoke:sign_request');
      if (controls?.length !== 1 || controls[0].method !== 'POST') fail('invalid_play_signer_contract', 502);
      const target = https(controls[0].target);
      if (target.origin !== catalog.origin || rows[0]['@id'] !== target.href || !rows[0].inputSchema?.properties?.payload) fail('invalid_play_signer_contract', 502);
      return target.href;
    }).catch(error => { discovery = null; throw error; });
    const [target, identity] = await Promise.all([discovery, identityProvider()]);
    if (!identity?.agentDid || !identity?.podUrl || typeof identity.credentialsProvider !== 'function') fail('play_service_identity_unavailable', 503);
    const credentials = await identity.credentialsProvider();
    const authorization = credentials?.Authorization ?? credentials?.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [^\r\n\s]+$/.test(authorization)) fail('play_service_identity_unavailable', 503);
    const signed = await request(target, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }) });
    if (typeof signed._signed_payload !== 'string' || Buffer.byteLength(signed._signed_payload) > 16384
      || typeof signed._signature !== 'string' || signed._signature.length > 1024) fail('invalid_play_grant', 502);
    let content; try { content = JSON.parse(signed._signed_payload); } catch { fail('invalid_play_grant', 502); }
    if (content.agent_id !== identity.agentDid || ![identity.podUrl, ...(identity.podAliases || [])].includes(content.subject_pod_url)
      || Object.keys(payload).some(key => content[key] !== payload[key])) fail('play_grant_binding_mismatch', 502);
    return { _signed_payload: signed._signed_payload, _signature: signed._signature };
  };
}

/** Public, proof-only verification. Owner access bearers and character bodies
 * are intentionally not accepted by this transport. */
export function createProvisionalProofVerifier({ identityOrigin = 'https://identity.interego.xwisee.com',
  fetch: transport = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const issuer = https(identityOrigin, true), target = new URL('/play/provisional/verify', issuer);
  if (typeof transport !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new TypeError('Bounded provisional verifier required.');
  return async input => {
    if (!exactFields(input, ['attestation', 'audience', 'challenge', 'proof']) || typeof input.attestation !== 'string'
      || input.attestation.length > 16384 || !safeChallenge(input.challenge) || !/^[A-Za-z0-9_-]{86}$/.test(input.proof || '')) fail('invalid_play_proof');
    let response;
    try { response = await transport(target.href, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
    catch { fail('play_verification_unavailable', 503); }
    if (!response.ok || (response.url && response.url !== target.href)) fail('play_proof_refused', 403);
    return boundedJson(response);
  };
}

/** Bounded ceremonies only: durable ownership lives in the injected native
 * ledger; the ephemeral challenge map is never a character or account primary. */
export function createProvisionalPlayAdmission({ publicOrigin, identityOrigin = 'https://identity.interego.xwisee.com',
  relayUrl = 'https://relay.interego.xwisee.com', signGrant, verifyProof, bindOwner, now = Date.now, ttlMs = 120000, maxChallenges = 256 } = {}) {
  const audience = https(publicOrigin, true).origin, issuer = https(identityOrigin, true).origin;
  relayUrl = https(relayUrl, true).origin;
  if (![signGrant, verifyProof, bindOwner, now].every(fn => typeof fn === 'function') || !Number.isSafeInteger(ttlMs)
    || ttlMs < 1000 || ttlMs > 120000 || !Number.isSafeInteger(maxChallenges) || maxChallenges < 1 || maxChallenges > 1024) throw new TypeError('Bounded native Play admission required.');
  const challenges = new Map(); let closed = false;
  const prune = () => { for (const [key, value] of challenges) if (value.expiresAt <= now()) challenges.delete(key); };
  function current(auth, challenge) {
    prune(); const record = challenges.get(challenge);
    if (closed || !record || record.accountId !== auth.account.id || record.sessionId !== auth.sessionId) fail('play_challenge_unavailable', 409);
    return record;
  }
  function bindingFor(value, expectedKey) {
    if (!plain(value) || value.valid !== true || value.provisional !== true || value.issuer?.replace(/\/$/, '') !== issuer
      || !Array.isArray(value.capabilities) || value.capabilities.length !== 2
      || !['human-play', 'own-pod-checkpoint'].every(cap => value.capabilities.includes(cap))
      || typeof value.ownerDid !== 'string' || typeof value.userId !== 'string' || typeof value.webId !== 'string'
      || typeof value.authenticatedAgentDid !== 'string' || typeof value.podUrl !== 'string') fail('invalid_provisional_owner', 403);
    const key = provisionalKey(value.publicKeyJwk);
    if (key.thumbprint !== expectedKey) fail('play_key_mismatch', 403);
    const expiresAt = typeof value.expiresAt === 'number' ? value.expiresAt * 1000 : Date.parse(value.expiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > now() + 31 * 86400000) fail('provisional_owner_expired', 403);
    return { subjectDid: value.ownerDid, userId: value.userId, webId: value.webId, podUrl: value.podUrl,
      authenticatedAgentDid: value.authenticatedAgentDid, verifiedAt: new Date(now()).toISOString(), issuer: issuer + '/',
      verificationMethod: 'play-p256+provider-attestation', provisional: true, expiresAt: new Date(expiresAt).toISOString(),
      proofKeyThumbprint: key.thumbprint, capabilities: ['human-play', 'own-pod-checkpoint'] };
  }
  return Object.freeze({
    async verifyClaimSource(marker, input, challenge) {
      if (closed || !safeChallenge(challenge) || !exactFields(input, ['attestation', 'proof'])
        || typeof marker?.sourceDid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(marker.sourceKeyThumbprint || '')) fail('provisional_owner_required', 403);
      const verified = await verifyProof({ attestation: input.attestation, audience, challenge, proof: input.proof });
      const binding = bindingFor(verified, marker.sourceKeyThumbprint);
      if (binding.subjectDid !== marker.sourceDid) fail('play_owner_mismatch', 403);
      return binding;
    },
    async verifySource(auth, input, challenge) {
      if (closed || auth?.binding?.provisional !== true || !safeChallenge(challenge)
        || !exactFields(input, ['attestation', 'proof'])) fail('provisional_owner_required', 403);
      const verified = await verifyProof({ attestation: input.attestation, audience, challenge, proof: input.proof });
      const binding = bindingFor(verified, auth.binding.proofKeyThumbprint);
      if (binding.subjectDid !== auth.binding.subjectDid || binding.podUrl !== auth.binding.podUrl) fail('play_owner_mismatch', 403);
      return binding;
    },
    async challenge(auth, input) {
      prune();
      if (closed || !auth?.account?.id || !auth.sessionId || !exactFields(input, ['publicKeyJwk'])) fail('invalid_play_request');
      if (auth.binding && auth.binding.provisional !== true) fail('existing_owner_requires_signin', 409);
      const { publicKeyJwk, thumbprint } = provisionalKey(input.publicKeyJwk);
      if (auth.binding && auth.binding.proofKeyThumbprint !== thumbprint) fail('play_key_mismatch', 403);
      if (challenges.size >= maxChallenges) fail('play_admission_capacity', 429);
      if ([...challenges.values()].filter(item => item.accountId === auth.account.id).length >= 4) fail('play_admission_capacity', 429);
      const challenge = randomBytes(32).toString('base64url'), expiresAt = now() + ttlMs;
      const record = { accountId: auth.account.id, sessionId: auth.sessionId, thumbprint, publicKeyJwk, expiresAt, flight: null, answer: null, digest: null };
      challenges.set(challenge, record);
      try {
        const playGrant = await signGrant({ purpose: 'interego-play-provisional-v1', audience, publicKeyThumbprint: thumbprint,
          challenge, expiresAt: Math.floor(expiresAt / 1000) });
        current(auth, challenge);
        return { audience, challenge, issuer, relayUrl, provisionalEndpoint: issuer + '/play/provisional', verificationEndpoint: issuer + '/play/provisional/verify',
          expiresAt: new Date(expiresAt).toISOString(), playGrant };
      } catch (error) { challenges.delete(challenge); throw error; }
    },
    async complete(auth, input) {
      if (!exactFields(input, ['attestation', 'challenge', 'proof']) || !safeChallenge(input.challenge)) fail('invalid_play_request');
      const record = current(auth, input.challenge), requestDigest = digest(JSON.stringify(input));
      if (record.digest && record.digest !== requestDigest) fail('play_operation_changed', 409);
      if (record.answer) return structuredClone(record.answer);
      if (record.flight) return record.flight;
      record.digest = requestDigest;
      const operation = (async () => {
        const verified = await verifyProof({ attestation: input.attestation, audience, challenge: input.challenge, proof: input.proof });
        const binding = bindingFor(verified, record.thumbprint); current(auth, input.challenge);
        if (auth.binding && auth.binding.subjectDid !== binding.subjectDid) fail('play_owner_mismatch', 403);
        const answer = await bindOwner(binding, auth.account.id, 'provisional-play:' + digest(auth.sessionId + ':' + input.challenge));
        current(auth, input.challenge); record.answer = structuredClone({ ...answer, binding, provisional: true });
        return structuredClone(record.answer);
      })();
      record.flight = operation;
      try { return await operation; } finally { record.flight = null; }
    },
    close() { closed = true; challenges.clear(); },
    status() { prune(); return { enabled: !closed, pending: challenges.size }; },
  });
}
