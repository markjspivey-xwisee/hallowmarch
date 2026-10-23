/** Native provisional play and explicit, read-confirmed owner-pod claims. */
import { createPlayerPodProfile } from './profile.mjs';
import { createBrowserAccessCache } from './access-cache.mjs';
import { createProvisionalDevice, provisionalBase64Url } from './provisional-device.mjs';

const SCHEMA = 'hallowmarch.provisional-character/v1';
const encoder = new TextEncoder();
const copy = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function secureOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_endpoint', 'A secure native endpoint is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    fail('invalid_endpoint', 'A secure native endpoint is required.');
  }
  return url.origin;
}
function endpoint(value, origin) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_endpoint', 'The provisional native endpoint is invalid.'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.search || url.hash) {
    fail('invalid_endpoint', 'The provisional native endpoint is invalid.');
  }
  return url.href;
}
function expiry(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail('invalid_expiry', 'The native session expiry is invalid.');
  return parsed;
}
function bindingOf(value) {
  if (!object(value) || typeof value.subjectDid !== 'string' || !/^did:[a-z0-9]+:[^\s]+$/.test(value.subjectDid)
    || value.subjectDid.length > 1024 || typeof value.podUrl !== 'string') fail('invalid_binding', 'A verified native owner and pod are required.');
  const pod = new URL(value.podUrl);
  if (pod.protocol !== 'https:' || pod.username || pod.password || pod.search || pod.hash
    || !/^\/[A-Za-z0-9_-]+\/$/.test(pod.pathname) || pod.href !== value.podUrl) fail('invalid_binding', 'The verified native pod is invalid.');
  return copy(value);
}
function sameBinding(left, right) {
  return left?.subjectDid === right?.subjectDid && left?.podUrl === right?.podUrl;
}
function publicBinding(value) {
  const found = bindingOf(value), selected = {};
  for (const name of ['subjectDid', 'podUrl', 'userId', 'webId', 'authenticatedAgentDid', 'verifiedAt', 'issuer', 'verificationMethod']) {
    if (found[name] !== undefined) selected[name] = found[name];
  }
  return selected;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function journalOf(value, source) {
  if (!object(value) || value.schema !== SCHEMA || typeof value.characterId !== 'string'
    || !/^urn:uuid:[0-9a-f-]{36}$/i.test(value.characterId)
    || value.guestOwnerDid !== source.ownerDid || value.guestExpiresAt !== source.guestExpiresAt
    || encoder.encode(JSON.stringify(value)).byteLength > 16384) fail('invalid_guest_checkpoint', 'The saved provisional character does not match this browser identity.');
  if (value.claim !== null && value.claim !== undefined) {
    const claim = value.claim;
    if (!object(claim) || !/^urn:uuid:[0-9a-f-]{36}$/i.test(claim.intentId || '')
      || !['prepared', 'copying', 'complete'].includes(claim.phase)
      || !Number.isSafeInteger(claim.createdAt)) fail('invalid_guest_checkpoint', 'The durable character-claim intent is invalid.');
  }
  return copy(value);
}
function credentialFrom(value, relayUrl, method, now) {
  if (!object(value) || value.tokenType && value.tokenType !== 'Bearer') fail('invalid_credential', 'The native relay access credential is invalid.');
  if (value.mcpUrl && endpoint(value.mcpUrl, relayUrl) !== relayUrl + '/mcp') fail('invalid_credential', 'The native credential belongs to another relay.');
  const expiresAt = expiry(value.expiresAt);
  if (expiresAt <= now || typeof value.accessToken !== 'string' || value.accessToken.length < 16) fail('credential_expired', 'Reconnect this native character to continue.');
  return { kind: 'relay-oauth-bearer', accessToken: value.accessToken, expiresAt, method, refreshToken: null };
}

/**
 * request is the authenticated game bridge. Native bearers only travel through
 * fetch to the identity/relay and the existing sealed browser access cache.
 * The encrypted own-pod checkpoint remains the save and claim-journal primary.
 */
export async function createProvisionalPlayerSession({ origin = globalThis.location?.origin,
  relayUrl, request, fetch: fetchImpl = globalThis.fetch, crypto = globalThis.crypto, now = Date.now,
  device = createProvisionalDevice({ origin, crypto, now }), accessCache = createBrowserAccessCache({ crypto, now }),
  createProfile = createPlayerPodProfile, onSession = async () => {}, onState = () => {} } = {}) {
  const gameOrigin = secureOrigin(origin);
  const configuredRelay = relayUrl ? secureOrigin(relayUrl) : null;
  if (typeof request !== 'function' || typeof fetchImpl !== 'function') throw new TypeError('A game bridge and native network transport are required.');
  let metadata = null, current = null, sourceProfile = null, currentBinding = null, targetProfile = null;
  let save = null, journal = null, state = 'idle', closed = false, claimed = false, sourceQuota = false, chain = Promise.resolve();
  let acknowledgedPromotion = null, pendingCanonicalSave = null;
  const active = () => { if (closed) fail('closed', 'This provisional character connection is closed.'); };
  const change = (next, extra = {}) => { if (closed) return; state = next; onState({ ...status(), ...extra }); };
  const serialized = run => { const next = chain.then(() => { active(); return run(); }); chain = next.catch(() => {}); return next; };
  const checkLifetime = () => {
    if (!metadata) fail('no_guest', 'Start native play before opening a provisional character.');
    if (!claimed && metadata.guestExpiresAt <= now()) fail('guest_expired', 'This provisional character has expired. Connect its owner identity to continue.');
  };
  async function remember(patch) {
    const latest = await device.peekMetadata();
    active();
    metadata = await device.remember({ ...(latest || metadata), ...patch });
    active();
    return metadata;
  }
  async function nativePost(url, body) {
    active();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
    const result = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, body: JSON.stringify(body) });
    const length = result.headers?.get('Content-Length');
    if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > 131072)) {
      await result.body?.cancel(); fail('native_unavailable', 'The native identity response exceeded its limit.');
    }
    if (!result.body?.getReader) fail('native_unavailable', 'The native identity response cannot be read within its limit.');
    const reader = result.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 131072) { await reader.cancel(); fail('native_unavailable', 'The native identity response exceeded its limit.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let data;
    try { data = JSON.parse(text); } catch { fail('native_unavailable', 'The native identity response could not be read.'); }
    if (!result.ok) fail(data.code || data.error || 'native_unavailable', data.message || data.error_description || 'The native identity did not confirm this operation.');
    if (!object(data)) fail('native_unavailable', 'The native identity response is invalid.');
    active();
    return data;
    } finally { clearTimeout(timer); }
  }
  async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value)));
    return 'sha256:' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function stamped(value, ownJournal = journal) {
    if (!object(value) || value.v !== 1) fail('invalid_save', 'A Hallowmarch save is required.');
    const result = { ...copy(value), nativePlay: copy(ownJournal) };
    if (encoder.encode(JSON.stringify(result)).byteLength > 384 * 1024) fail('record_capacity', 'This character exceeds the bounded native checkpoint size.');
    return result;
  }
  function status() {
    return { state, provisional: !!metadata && !claimed && !metadata.claimedOwnerDid, guestExpiresAt: metadata?.guestExpiresAt || null,
      characterId: journal?.characterId || metadata?.characterId || null, ownerDid: currentBinding?.subjectDid || metadata?.claimedOwnerDid || metadata?.ownerDid || null,
      keyPresent: current?.status().keyPresent || false, pending: !!pendingCanonicalSave || current?.status().pending || false,
      quota: sourceQuota && !claimed, claim: journal?.claim ? { ...copy(journal.claim), targetAvailable: !!metadata?.targetClaim } :
        metadata?.targetClaim ? { targetAvailable: true } : null };
  }
  function profile(binding, credential, deferred = false) {
    return createProfile({ binding, credential, relayUrl: metadata.relayUrl, request, deferRelationship: deferred,
      onState: detail => { if (!closed) onState({ ...status(), native: detail }); } });
  }
  async function readGuest(binding, credential, { deferRelationship = false } = {}) {
    checkLifetime();
    const reuse = sourceProfile && current === sourceProfile && sameBinding(currentBinding, binding);
    const candidate = reuse ? sourceProfile : profile(binding, credential, deferRelationship);
    try {
      if (reuse) await candidate.reauthenticate({ credential }); else await candidate.connect();
      if (reuse && deferRelationship) await candidate.deferRelationship();
      active();
      let loaded = await candidate.get();
      active();
      if (!loaded.exists) {
        if (metadata.characterId) fail('missing_guest_checkpoint', 'The existing provisional checkpoint is unavailable. Reconnect without creating another character.');
        if (!candidate.status().keyPresent) await candidate.createKey();
        const initialJournal = { schema: SCHEMA, characterId: 'urn:uuid:' + crypto.randomUUID(), guestOwnerDid: metadata.ownerDid,
          guestExpiresAt: metadata.guestExpiresAt, claim: { intentId: 'urn:uuid:' + crypto.randomUUID(), phase: 'prepared', createdAt: now() } };
        await candidate.set(stamped({ v: 1, char: null }, initialJournal));
        loaded = await candidate.get();
        if (!loaded.exists) fail('checkpoint_unconfirmed', 'The initial private checkpoint has not been confirmed.');
      }
      const found = loaded.data(), foundJournal = journalOf(found.nativePlay, metadata);
      if (metadata.characterId && metadata.characterId !== foundJournal.characterId) fail('guest_character_changed', 'The provisional pod contains another character.');
      await remember({ characterId: foundJournal.characterId });
      if (sourceProfile && sourceProfile !== candidate) sourceProfile.close();
      sourceProfile = candidate; current = candidate; currentBinding = binding; save = found; journal = foundJournal;
      claimed = false; change('ready'); return { exists: true, data: () => copy(save) };
    } catch (cause) {
      if (['key_required', 'recovery_required', 'pod_pending', 'pod_index_pending', 'pod_link_pending', 'guest_quota_exhausted'].includes(cause.code)) {
        if (sourceProfile && sourceProfile !== candidate) sourceProfile.close();
        sourceProfile = candidate; current = candidate; currentBinding = binding;
        if (cause.code === 'guest_quota_exhausted') sourceQuota = true;
        change(cause.code);
      } else if (!reuse) candidate.close();
      throw cause;
    }
  }
  async function provision(expectedBinding = null) {
    const prior = await device.peekMetadata(); metadata = prior;
    if (prior?.claimedOwnerDid) fail('already_claimed', 'This character belongs to its connected owner. Open that identity to continue.');
    if (prior && prior.guestExpiresAt <= now()) fail('guest_expired', 'This provisional character has expired.');
    const publicKey = await device.publicDescription();
    const challenge = await request('/gaming/identity/play/challenge', { method: 'POST', body: { publicKeyJwk: publicKey.publicKeyJwk } });
    active();
    const issuer = secureOrigin(challenge.issuer), relay = secureOrigin(challenge.relayUrl || configuredRelay);
    if (configuredRelay && relay !== configuredRelay || challenge.audience && secureOrigin(challenge.audience) !== gameOrigin) fail('invalid_binding', 'The native play challenge belongs to another game or relay.');
    if (prior && (issuer !== prior.issuer || relay !== prior.relayUrl)) fail('guest_identity_changed', 'Reconnect the original provisional native service.');
    const provisionalEndpoint = endpoint(challenge.provisionalEndpoint, issuer);
    const identity = await nativePost(provisionalEndpoint, { playGrant: challenge.playGrant, publicKeyJwk: publicKey.publicKeyJwk,
      proof: await device.signBootstrap(challenge.playGrant) });
    const ownerDid = identity.did || identity.ownerDid;
    const binding = bindingOf({ subjectDid: ownerDid, podUrl: identity.podUrl, userId: identity.userId });
    if (identity.provisional !== true || identity.proofKeyThumbprint !== publicKey.proofKeyThumbprint
      || typeof identity.token !== 'string' || identity.token.length < 16 || identity.token.length > 16384) fail('invalid_binding', 'The native provisional identity did not bind this browser key.');
    const guestExpiresAt = expiry(identity.guestExpiresAt);
    if (guestExpiresAt <= now() || expiry(identity.expiresAt) > guestExpiresAt) fail('guest_expired', 'The provisional native lifetime is invalid or expired.');
    if (prior && (ownerDid !== prior.ownerDid || binding.podUrl !== prior.podUrl || guestExpiresAt !== prior.guestExpiresAt)
      || expectedBinding && !sameBinding(binding, expectedBinding)) fail('guest_identity_changed', 'The native service did not resume the original provisional character.');
    metadata = await device.remember({ ...(prior || {}), ownerDid, podUrl: binding.podUrl, issuer, relayUrl: relay, provisionalEndpoint,
      attestation: identity.attestation, guestExpiresAt, proofKeyThumbprint: publicKey.proofKeyThumbprint });
    const tokenHash = provisionalBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(identity.token))));
    const exchange = await nativePost(relay + '/play/provisional/exchange', { identityToken: identity.token, attestation: identity.attestation,
      audience: gameOrigin, proof: await device.signProof({ attestation: identity.attestation, audience: gameOrigin, challenge: tokenHash }) });
    const credential = credentialFrom({ accessToken: exchange.access_token, expiresAt: exchange.expiresAt, tokenType: exchange.token_type }, relay, 'provisional', now());
    if (credential.expiresAt > guestExpiresAt) fail('invalid_credential', 'The relay access exceeded the fixed provisional lifetime.');
    await accessCache.put({ relayUrl: relay, ownerDid, podUrl: binding.podUrl, credential });
    await remember({ credentialExpiresAt: credential.expiresAt });
    const complete = await request('/gaming/identity/play/complete', { method: 'POST', body: { attestation: identity.attestation,
      challenge: challenge.challenge, proof: await device.signProof({ attestation: identity.attestation, audience: gameOrigin, challenge: challenge.challenge }) } });
    active();
    if (!sameBinding(complete.binding, binding)) fail('invalid_binding', 'The game did not confirm this provisional native owner.');
    await onSession(complete);
    await readGuest(bindingOf(complete.binding), credential);
    return { ...complete, profile: current, status: status() };
  }
  async function resume(input = {}) {
    metadata = await device.peekMetadata();
    if (!metadata) fail('no_guest', 'This browser has no provisional native character to resume.');
    if (metadata.claimedOwnerDid) fail('already_claimed', 'Open the connected owner identity to resume this character.');
    checkLifetime();
    if (input.binding && !sameBinding(input.binding, { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl })
      && !sameBinding(input.binding, metadata.targetClaim?.binding)) fail('guest_identity_changed', 'The game connection is unrelated to this pending native character claim.');
    const canonicalRecovery = !!metadata.targetClaim && (input.recoverPendingClaim === true
      || !!input.binding && sameBinding(input.binding, metadata.targetClaim.binding));
    const binding = input.binding && !canonicalRecovery ? bindingOf(input.binding) : { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl };
    if (!sameBinding(binding, { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl })) fail('guest_identity_changed', 'The game session belongs to another provisional owner.');
    // An original completion response may have been lost after the game retired
    // this guest. Recover that exact staged operation with the initiating game
    // token before attempting any fresh guest participation admission.
    const pendingClaimResume = !!metadata.targetClaim && (input.requireGameSession === true || canonicalRecovery);
    if (input.requireGameSession === true && !pendingClaimResume) return provision(binding);
    let credential = input.nativeSession ? credentialFrom(input.nativeSession, metadata.relayUrl, 'provisional', now()) :
      (await accessCache.get({ relayUrl: metadata.relayUrl, ownerDid: metadata.ownerDid, podUrl: metadata.podUrl }))?.credential;
    if (!credential && pendingClaimResume && metadata.targetClaim.confirmation) {
      // A durable completed admission can be recovered with public receipt +
      // a fresh key proof even when both pod grants expired. Confirming a game
      // assignment is not permission to read a private save: normal canonical
      // sign-in must renew that grant before loading or writing the character.
      const result = await recoverReceipt(metadata.targetClaim);
      await onSession(result); active(); claimed = true; currentBinding = metadata.targetClaim.binding;
      await remember({ claimedOwnerDid: currentBinding.subjectDid, targetClaim: null });
      change('native_signin_required');
      fail('credential_expired', 'Your kept character connection is recovered. Reconnect its Interego identity to renew private pod access.');
    }
    if (!credential && pendingClaimResume) fail('credential_expired', 'Reconnect the canonical owner to recover the pending character claim. The original private checkpoints remain available.');
    if (!credential) return provision(binding);
    await readGuest(binding, credential, { deferRelationship: pendingClaimResume });
    return { binding, appSession: input.appSession || null, provisional: true, pendingClaimResume, profile: current, status: status() };
  }
  async function persist(value) {
    active(); checkLifetime();
    if (!current || !journal && !claimed) fail('not_connected', 'Resume the native character before saving.');
    const next = journal ? stamped(value) : copy(value);
    try { await current.set(next); save = next; if (claimed) pendingCanonicalSave = null; change('saved'); }
    catch (cause) {
      if (cause.code === 'guest_quota_exhausted') { sourceQuota = true; change('guest_quota_exhausted'); }
      else change(cause.code || 'unavailable');
      throw cause;
    }
  }
  async function prepareClaim({ lastConfirmed = false } = {}) {
    checkLifetime();
    if (!sourceProfile || claimed || !save) fail('not_connected', 'Open the provisional character before keeping it.');
    if (sourceQuota && !lastConfirmed) fail('guest_quota_exhausted', 'Choose Keep last confirmed save to retain the checkpoint your pod has already confirmed.');
    if (!journal.claim || journal.claim.phase === 'complete') {
      journal = { ...journal, claim: { intentId: 'urn:uuid:' + crypto.randomUUID(), phase: 'prepared', createdAt: now() } };
      await persist(save);
    }
    await remember({ lastConfirmedClaim: lastConfirmed });
    const challenge = await request('/gaming/identity/play/claim-challenge', { method: 'POST', body: {} });
    if (secureOrigin(challenge.audience) !== gameOrigin) fail('invalid_binding', 'The character claim belongs to another game.');
    return request('/gaming/identity/claim-owner/start', { method: 'POST', body: { ownerPodWriteAccess: true,
      attestation: metadata.attestation, challenge: challenge.challenge,
      proof: await device.signProof({ attestation: metadata.attestation, audience: gameOrigin, challenge: challenge.challenge }) } });
  }
  async function stageClaimTarget(result) {
    metadata = await device.peekMetadata();
    if (!metadata) fail('no_guest', 'The original provisional browser key is required to keep this character.');
    const binding = publicBinding(result.binding), input = result.appSession;
    if (!object(input) || input.purpose !== 'character-claim-target' || input.guestOwnerDid !== metadata.ownerDid
      || input.targetOwnerDid !== binding.subjectDid || secureOrigin(input.audience) !== gameOrigin
      || typeof input.claimOperationId !== 'string' || input.claimOperationId.length > 256
      || typeof input.sourceChallenge !== 'string' || input.sourceChallenge.length > 512 || expiry(input.expiresAt) <= now()) {
      fail('invalid_claim', 'The canonical owner handoff does not match this provisional character.');
    }
    const appSession = {};
    for (const key of ['purpose', 'claimOperationId', 'guestOwnerDid', 'targetOwnerDid', 'audience', 'sourceChallenge', 'expiresAt', 'existingRecord']) {
      if (input[key] !== undefined) appSession[key] = copy(input[key]);
    }
    // Enrolling a passkey on the provisional pod retains its original DID and
    // u-try-play namespace. This canonical OAuth handoff proves that enrollment;
    // the namespace must not force a new owner, key, or private character.
    const enrolledSource = sameBinding(binding, { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl });
    const method = binding.userId?.startsWith('u-pk-') || enrolledSource ? 'webauthn' : binding.userId?.startsWith('u-eth-') ? 'siwe' : null;
    if (!method) fail('invalid_credential', 'This canonical owner needs a compatible browser credential bridge.');
    const credential = credentialFrom(result.nativeSession, metadata.relayUrl, method, now());
    await accessCache.put({ relayUrl: metadata.relayUrl, ownerDid: binding.subjectDid, podUrl: binding.podUrl, credential });
    const confirmation = metadata.targetClaim?.appSession.claimOperationId === appSession.claimOperationId
      && sameBinding(metadata.targetClaim.binding, binding) ? metadata.targetClaim.confirmation : null;
    await remember({ targetClaim: { binding, appSession, ...(confirmation ? { confirmation } : {}) } });
    change('claim_target_available'); return { targetAvailable: true, targetOwnerDid: binding.subjectDid };
  }
  async function finalizeClaim() {
    if (!sourceProfile || !save || !journal) await resume();
    metadata = await device.peekMetadata(); checkLifetime();
    const handoff = metadata.targetClaim;
    if (!handoff) fail('claim_target_missing', 'Connect the owner identity before completing this character claim.');
    const leaseExpired = expiry(handoff.appSession.expiresAt) <= now();
    if (leaseExpired && !handoff.confirmation) fail('claim_expired', 'The owner connection expired. Keep playing this provisional character or reconnect its owner.');
    if (!journal.claim) fail('claim_intent_missing', 'The provisional pod has not confirmed the original Keep my character intent.');
    const target = handoff.binding, lease = handoff.appSession;
    const cached = await accessCache.get({ relayUrl: metadata.relayUrl, ownerDid: target.subjectDid, podUrl: target.podUrl });
    if (!cached) fail('credential_expired', 'Reconnect the canonical owner to complete this character claim.');
    targetProfile?.close(); targetProfile = profile(target, cached.credential, true);
    await targetProfile.connect();
    const existing = await targetProfile.get();
    const body = existing.exists ? existing.data() : null;
    const inPlace = sameBinding(target, { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl });
    if (handoff.confirmation && (leaseExpired || handoff.confirmation.selection === 'use-existing')) {
      // An expired ceremony permits reconciliation of the frozen receipt only.
      // It must never authorize a fresh copy, key, or source-journal mutation.
      if (!existing.exists || handoff.confirmation.selection === 'copy-guest'
        && (body.nativePlay?.characterId !== journal.characterId || body.nativePlay?.claim?.intentId !== journal.claim.intentId)) {
        fail('claim_readback_failed', 'The original kept character is no longer confirmed. Reconnect its owner without changing either save.');
      }
      const sameHead = canonical(handoff.confirmation.targetRecord) === canonical(targetProfile.reference());
      return promote(handoff, body, handoff.confirmation.selection,
        !inPlace && sameHead && handoff.confirmation.selection === 'copy-guest' ? copy(save) : null, handoff.confirmation.targetRecord);
    }
    if (inPlace) {
      // Same-pod passkey enrollment changes authentication, not ownership. Read
      // the character with the canonical grant and require the exact confirmed
      // source receipt and gameplay before promoting that same native pointer.
      // A prepared intent has no targetOwnerDid yet and is valid in this path.
      const sourceRecord = sourceProfile.reference(), targetRecord = targetProfile.reference();
      const sourceGameplay = copy(save); delete sourceGameplay.nativePlay;
      const targetGameplay = body && copy(body); if (targetGameplay) delete targetGameplay.nativePlay;
      if (!existing.exists || body.nativePlay?.characterId !== journal.characterId
        || body.nativePlay?.claim?.intentId !== journal.claim.intentId || !sourceRecord || !targetRecord
        || canonical(sourceRecord) !== canonical(targetRecord)
        || await digest(sourceGameplay) !== await digest(targetGameplay)) {
        fail('claim_readback_failed', 'The enrolled owner did not confirm this exact existing character. Its private checkpoint has not been changed.');
      }
      const original = handoff.confirmation?.targetRecord;
      if (original && ['kind', 'graphIri', 'descriptorUrl', 'cid'].some(key => original[key] !== targetRecord[key])) {
        fail('claim_readback_failed', 'The enrolled character no longer has the original native binding. Its private checkpoint has not been changed.');
      }
      if (!original) await remember({ targetClaim: { ...handoff, confirmation: { selection: 'copy-guest', targetRecord } } });
      // The browser retains only this public immutable receipt. The private
      // character remains solely in its existing pod, including later progress.
      // Retry the original operation receipt even if that same resource advanced
      // after a successful response was lost.
      return promote(handoff, body, 'copy-guest', null, original || targetRecord);
    }
    const sameIntent = body?.nativePlay?.characterId === journal.characterId
      && body.nativePlay.claim?.intentId === journal.claim.intentId
      && body.nativePlay.claim?.targetOwnerDid === target.subjectDid;
    if (existing.exists && !sameIntent || lease.existingRecord && !sameIntent) {
      change('owner_character_exists');
      return { conflict: true, reason: 'owner_character_exists', existingCharacter: body?.char || null,
        targetOwnerDid: target.subjectDid, guestExpiresAt: metadata.guestExpiresAt };
    }
    // The source journal commits the exact gameplay digest before target writes.
    // A previous unacknowledged copy can be reused only for this same intent and
    // exact progress; another owner character is never an overwrite candidate.
    const gameplay = copy(save); delete gameplay.nativePlay;
    const sourceDigest = await digest(gameplay);
    if (sameIntent && journal.claim.claimOperationId === lease.claimOperationId && journal.claim.targetRecord) {
      if (canonical(journal.claim.targetRecord) !== canonical(targetProfile.reference())) {
        change('claim_progress_changed');
        return { conflict: true, reason: 'claim_progress_changed', targetOwnerDid: target.subjectDid };
      }
      // The server may have completed this exact operation before its response
      // was lost. Reconcile that frozen receipt before changing the copied head.
      // Fresh guest progress is already durable in the source pod and transfers
      // by canonical CAS only after the original admission is acknowledged.
      return promote(handoff, body, 'copy-guest', copy(save));
    }
    let refreshCopy = false;
    if (sameIntent) {
      const targetGameplay = copy(body); delete targetGameplay.nativePlay;
      const targetDigest = await digest(targetGameplay);
      if (targetDigest !== sourceDigest || body.nativePlay.claim.sourceDigest !== sourceDigest) {
        const previous = journal.claim.targetRecord;
        refreshCopy = !!previous && canonical(previous) === canonical(targetProfile.reference())
          && targetDigest === journal.claim.targetSourceDigest
          && body.nativePlay.claim.sourceDigest === journal.claim.targetSourceDigest;
        if (!refreshCopy) {
          change('claim_progress_changed');
          return { conflict: true, reason: 'claim_progress_changed', targetOwnerDid: target.subjectDid };
        }
      }
    }
    journal = { ...journal, claim: { ...journal.claim, phase: 'copying', targetOwnerDid: target.subjectDid,
      claimOperationId: lease.claimOperationId, sourceDigest } };
    if (!metadata.lastConfirmedClaim) { await sourceProfile.set(stamped(save)); save = stamped(save); }
    if (!sameIntent || refreshCopy) {
      if (!targetProfile.status().keyPresent) await targetProfile.createKey();
      await targetProfile.set(stamped(save));
    }
    const confirmed = await targetProfile.get();
    if (!confirmed.exists || await digest((() => { const value = confirmed.data(); delete value.nativePlay; return value; })()) !== sourceDigest
      || confirmed.data().nativePlay?.characterId !== journal.characterId
      || confirmed.data().nativePlay?.claim?.intentId !== journal.claim.intentId
      || confirmed.data().nativePlay?.claim?.targetOwnerDid !== target.subjectDid
      || confirmed.data().nativePlay?.claim?.sourceDigest !== sourceDigest) fail('claim_readback_failed', 'The canonical pod did not confirm this exact character. The provisional checkpoint remains available.');
    // Retain the exact previously acknowledged target head in the source pod.
    // A later explicit retry may refresh only this claim's unchanged copy using
    // its loaded CAS predecessor; independent canonical edits are a conflict.
    journal = { ...journal, claim: { ...journal.claim, targetRecord: targetProfile.reference(), targetSourceDigest: sourceDigest } };
    if (!metadata.lastConfirmedClaim) { await sourceProfile.set(stamped(save)); save = stamped(save); }
    return promote(handoff, confirmed.data(), 'copy-guest');
  }
  async function promote(handoff, confirmedSave, selection, latestGuestSave = null, confirmedRecord = null) {
    const target = handoff.binding, lease = handoff.appSession;
    const targetRecord = confirmedRecord || targetProfile.reference();
    if (!targetRecord?.nativeRevision || !targetRecord.digest || !targetRecord.recordCid) fail('claim_readback_failed', 'The canonical native checkpoint receipt is incomplete.');
    const original = metadata.targetClaim?.confirmation;
    if (original && (original.selection !== selection || canonical(original.targetRecord) !== canonical(targetRecord))) {
      fail('claim_operation_changed', 'Retry the original character choice before changing the claim.');
    }
    if (!original) await remember({ targetClaim: { ...handoff, confirmation: { selection, targetRecord } } });
    change('claim_confirming');
    let result;
    if (expiry(lease.expiresAt) <= now()) result = await recoverReceipt(metadata.targetClaim);
    else try {
      result = await request('/gaming/identity/play/claim-complete', { method: 'POST', body: {
        claimOperationId: lease.claimOperationId, attestation: metadata.attestation, readConfirmed: true, targetRecord, selection,
        proof: await device.signProof({ attestation: metadata.attestation, audience: gameOrigin, challenge: lease.sourceChallenge }) } });
    } catch (cause) {
      if (!['claim_operation_unavailable', 'claim_recovery_challenge_required'].includes(cause.code)) throw cause;
      result = await recoverReceipt(metadata.targetClaim);
    }
    active();
    if (!sameBinding(result.binding, target)) fail('invalid_binding', 'The game did not confirm the canonical owner promotion.');
    // The game admission is established before either the active save target or
    // its ordinary record relationship changes. A lost response keeps the
    // source journal and target copy for an explicit idempotent retry.
    current = targetProfile; currentBinding = target; claimed = true; save = confirmedSave;
    acknowledgedPromotion = copy(result);
    journal = save.nativePlay?.guestOwnerDid === metadata.ownerDid ? journalOf(save.nativePlay, metadata) : null;
    let localPersistencePending = false, localSessionPending = false, latestProgressPending = false;
    const gameplayOnly = value => { const result = copy(value); delete result.nativePlay; return result; };
    if (latestGuestSave && canonical(gameplayOnly(latestGuestSave)) !== canonical(gameplayOnly(confirmedSave))) {
      try {
        await current.set(latestGuestSave);
        const latest = await current.get();
        if (!latest.exists || canonical(latest.data()) !== canonical(latestGuestSave)) fail('claim_readback_failed', 'The latest kept progress has not been confirmed.');
        save = latest.data(); journal = journalOf(save.nativePlay, metadata);
      } catch { latestProgressPending = true; pendingCanonicalSave = copy(latestGuestSave); }
    }
    try { await onSession(result); }
    catch { localPersistencePending = true; localSessionPending = true; }
    if (!localSessionPending && !latestProgressPending) {
      try { await remember({ claimedOwnerDid: target.subjectDid, targetClaim: null }); }
      catch { localPersistencePending = true; }
    }
    change(latestProgressPending ? 'claim_latest_progress_pending' : localSessionPending ? 'claim_local_session_pending' : localPersistencePending ? 'claim_local_persistence_pending' : 'claimed');
    if (!localPersistencePending && !latestProgressPending) {
      try { await current.confirmRelationship(); } catch (cause) { change('link_pending', { detail: cause.message }); }
    }
    return { ...result, claimed: true, localPersistencePending, localSessionPending, latestProgressPending, profile: current, status: status() };
  }
  async function recoverReceipt(handoff) {
    const confirmation = handoff.confirmation;
    if (!confirmation) fail('claim_unconfirmed', 'The original character completion receipt is required.');
    const body = { claimOperationId: handoff.appSession.claimOperationId, readConfirmed: true,
      targetRecord: confirmation.targetRecord, selection: confirmation.selection };
    const nonce = await request('/gaming/identity/play/claim-recovery-challenge', { method: 'POST', body });
    if (secureOrigin(nonce.audience) !== gameOrigin || !/^[A-Za-z0-9_-]{43}$/.test(nonce.challenge || '')
      || expiry(nonce.expiresAt) <= now() || expiry(nonce.expiresAt) > now() + 120000) fail('invalid_claim', 'The fresh character recovery challenge is invalid.');
    const result = await request('/gaming/identity/play/claim-complete', { method: 'POST', body: { ...body,
      recoveryChallenge: nonce.challenge, attestation: metadata.attestation,
      proof: await device.signProof({ attestation: metadata.attestation, audience: gameOrigin, challenge: nonce.challenge }) } });
    active();
    if (!sameBinding(result.binding, handoff.binding)) fail('invalid_binding', 'The recovered character belongs to another canonical owner.');
    return result;
  }
  async function useExistingTarget() {
    metadata = await device.peekMetadata();
    if (!metadata?.targetClaim) fail('claim_target_missing', 'Connect the owner identity before opening its saved character.');
    const handoff = metadata.targetClaim;
    if (expiry(handoff.appSession.expiresAt) <= now() && handoff.confirmation?.selection !== 'use-existing') fail('claim_expired', 'Reconnect the canonical owner to open its saved character.');
    const target = handoff.binding;
    const cached = await accessCache.get({ relayUrl: metadata.relayUrl, ownerDid: target.subjectDid, podUrl: target.podUrl });
    if (!cached) fail('credential_expired', 'Reconnect the canonical owner to open its saved character.');
    targetProfile?.close(); targetProfile = profile(target, cached.credential, true);
    await targetProfile.connect();
    const confirmed = await targetProfile.get();
    if (!confirmed.exists) fail('missing_record', 'The canonical owner has no saved character to open.');
    return promote(handoff, confirmed.data(), 'use-existing', null, handoff.confirmation?.targetRecord || null);
  }
  async function retrySession() {
    if (!claimed || !acknowledgedPromotion) fail('claim_unconfirmed', 'The canonical owner admission has not been acknowledged. Retry the original character claim.');
    let localSessionPending = false, localPersistencePending = false, latestProgressPending = false, detail = '';
    try { await onSession(copy(acknowledgedPromotion)); active(); }
    catch (cause) { active(); localSessionPending = true; localPersistencePending = true; detail = cause.message; }
    if (pendingCanonicalSave) {
      const next = copy(pendingCanonicalSave);
      try {
        await current.set(next);
        const confirmed = await current.get();
        if (!confirmed.exists || canonical(confirmed.data()) !== canonical(next)) fail('claim_readback_failed', 'The latest kept progress is still awaiting confirmation.');
        save = confirmed.data(); journal = journalOf(save.nativePlay, metadata); pendingCanonicalSave = null;
      } catch (cause) { latestProgressPending = true; detail = cause.message; }
    }
    if (!localSessionPending && !latestProgressPending) {
      try { await remember({ claimedOwnerDid: currentBinding.subjectDid, targetClaim: null }); }
      catch (cause) { localPersistencePending = true; detail = cause.message; }
    }
    change(latestProgressPending ? 'claim_latest_progress_pending' : localSessionPending ? 'claim_local_session_pending' : localPersistencePending ? 'claim_local_persistence_pending' : 'claimed', { detail });
    if (!localPersistencePending && !latestProgressPending) {
      try { await current.confirmRelationship(); } catch (cause) { change('link_pending', { detail: cause.message }); }
    }
    return { ...copy(acknowledgedPromotion), claimed: true, localSessionPending, localPersistencePending, latestProgressPending,
      detail, profile: current, status: status() };
  }
  return Object.freeze({
    async peek() {
      active(); metadata = await device.peekMetadata();
      return metadata ? { ownerDid: metadata.ownerDid, podUrl: metadata.podUrl, guestExpiresAt: metadata.guestExpiresAt,
        characterId: metadata.characterId || null, credentialExpiresAt: metadata.credentialExpiresAt || null,
        claimedOwnerDid: metadata.claimedOwnerDid || null, expired: metadata.guestExpiresAt <= now(),
        targetAvailable: !!metadata.targetClaim, targetOwnerDid: metadata.targetClaim?.binding.subjectDid || null,
        lastConfirmedClaim: metadata.lastConfirmedClaim === true } : null;
    },
    bootstrap: () => serialized(() => provision()), resume: input => serialized(() => resume(input)),
    get: () => serialized(async () => {
      if (!current) fail('not_connected', 'Open the native character before reading it.');
      const found = await current.get();
      if (found.exists) { save = found.data(); journal = claimed && save.nativePlay?.guestOwnerDid !== metadata.ownerDid ? null : journalOf(save.nativePlay, metadata); }
      return found;
    }),
    set: value => serialized(() => persist(value)), prepareClaim: options => serialized(() => prepareClaim(options)),
    stageClaimTarget: result => serialized(() => stageClaimTarget(result)),
    claimTarget: result => serialized(async () => { if (result) await stageClaimTarget(result); return finalizeClaim(); }),
    resumeClaim: () => serialized(finalizeClaim),
    useExistingTarget: result => serialized(async () => { if (result) await stageClaimTarget(result); return useExistingTarget(); }),
    retrySession: () => serialized(retrySession),
    retry: () => serialized(async () => { if (!current) fail('not_connected', 'Resume the native character before retrying.'); await current.retry(); return status(); }),
    status, profile: () => current, claimProfile: () => targetProfile,
    close() { closed = true; current?.close(); if (sourceProfile !== current) sourceProfile?.close(); if (targetProfile !== current) targetProfile?.close(); device.close(); void accessCache.close?.(); },
  });
}
