/**
 * Compose a game's authenticated account session with the native owner ledger.
 * The game retains its own short-lived session credentials; native credentials
 * are handled only by the OAuth bridge and the consenting owner's browser.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createPlayerBindingLedger, PlayerBindingError } from './player-bindings.js';
import { createPlayerIdentityBridge } from './player-identity.js';
import { nativeIdentityDescription } from './native-identity-description.js';
import { createProvisionalPlayAdmission, createNativePlayGrantSigner, createProvisionalProofVerifier, ProvisionalPlayError } from './provisional-play.js';

const PROOF_TTL_MS = 300_000;
const FRESH_NATIVE_MS = 3_600_000;
const MAX_SESSION_PROOFS = 256;
const VERIFICATION_STAGES = ['ready-proof', 'ledger-bind', 'account-restore', 'issue-app-session'];
// Fixed public diagnostics only. Native stores and injected host ports can throw
// arbitrary exceptions; their messages, properties and identities stay private.
const VERIFICATION_CODES = new Set(['native_identity_unavailable', 'game_account_required', 'identity_binding_aborted',
  'account_restore_failed', 'app_session_unavailable', 'INVALID_PLAYER_BINDING', 'NATIVE_BINDINGS_UNAVAILABLE',
  'OPERATION_ABORTED', 'PLAYER_BINDING_CONFLICT', 'BINDING_CAPACITY', 'VERSION_CONFLICT', 'CORRUPT_DURABLE_STATE',
  'COMMIT_UNCERTAIN', 'INVALID_INPUT', 'PAYLOAD_TOO_LARGE', 'INVALID_CONFIGURATION', 'DURABILITY_UNAVAILABLE',
  'NATIVE_COMMIT_FENCED', 'NATIVE_COMMIT_CAPACITY', 'FENCED', 'IDEMPOTENCY_CONFLICT', 'NATIVE_CONTENTION']);
const diagnosticCode = value => typeof value === 'string' && VERIFICATION_CODES.has(value) ? value : 'other';
function failureCode(error) {
  try {
    // Do not invoke a foreign exception's getter while reporting its failure.
    const code = Object.getOwnPropertyDescriptor(error, 'code');
    return code && Object.hasOwn(code, 'value') ? diagnosticCode(code.value) : 'other';
  } catch { return 'other'; }
}
const increment = (value, key) => { value[key] = Math.min(Number.MAX_SAFE_INTEGER, (value[key] || 0) + 1); };
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

class HostError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new HostError(code, status); };
const aborted = signal => { if (signal?.aborted) fail('identity_binding_aborted', 503); };
function json(res, status, value, mediaType = 'application/json') {
  res.writeHead(status, { 'Content-Type': mediaType + '; charset=utf-8', 'Cache-Control': 'no-store',
    Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function accountSummary(account) {
  const letters = Array.from(typeof account.name === 'string' ? account.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : 'Traveller');
  while (Buffer.byteLength(letters.join('')) > 128) letters.pop();
  return { id: account.id, name: letters.join('') || 'Traveller', guest: account.guest === true };
}
function publicBinding(binding) {
  const result = {};
  for (const key of ['subjectDid', 'podUrl', 'webId', 'userId', 'authenticatedAgentDid', 'authenticatedAgentId', 'verifiedAt', 'issuer', 'verificationMethod']) {
    if (typeof binding?.[key] === 'string') result[key] = binding[key];
  }
  if (binding?.provisional === true) Object.assign(result, { provisional: true, expiresAt: binding.expiresAt,
    proofKeyThumbprint: binding.proofKeyThumbprint, capabilities: [...binding.capabilities] });
  return result;
}
async function readBody(req, maxBytes = 4096) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) fail('json_body_required', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length; if (size > maxBytes) fail('request_body_too_large', 413); chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_request_body'); }
  if (!plain(body)) fail('invalid_request_body');
  return body;
}

export function createPlayerAccountHost(options = {}) {
  for (const port of ['tokenClaims', 'issueAppSession', 'getAccount', 'restoreAccount', 'readLegacySave']) {
    if (typeof options[port] !== 'function') throw new TypeError(`Player account host requires ${port}`);
  }
  const publicUrl = new URL(options.publicOrigin);
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/'
    || publicUrl.search || publicUrl.hash) throw new TypeError('Player account host requires a public HTTPS origin');
  const now = options.now ?? Date.now;
  const recoveryTimeoutMs = options.recoveryTimeoutMs ?? 15_000;
  const recoveryCooldownMs = options.recoveryCooldownMs ?? 5_000;
  if (!Number.isSafeInteger(recoveryTimeoutMs) || recoveryTimeoutMs < 10 || recoveryTimeoutMs > 30_000
    || !Number.isSafeInteger(recoveryCooldownMs) || recoveryCooldownMs < 100 || recoveryCooldownMs > 60_000) {
    throw new TypeError('Bounded native ownership recovery timing is required');
  }
  const ledger = createPlayerBindingLedger({ ...(options.ledgerOptions ?? {}), store: options.store, now,
    ...(options.storeBases ? { storeBases: options.storeBases } : {}) });
  const proofs = new Map(); let closed = false, readyOk = false, initialReadySettled = false;
  const verificationDiagnostics = { attempts: 0, succeeded: 0, failed: 0, inFlight: 0, lastFailure: null,
    stages: Object.fromEntries(VERIFICATION_STAGES.map(stage => [stage, { entered: 0, failed: 0, codes: {} }])) };
  function verificationStatus() {
    return { attempts: verificationDiagnostics.attempts, succeeded: verificationDiagnostics.succeeded,
      failed: verificationDiagnostics.failed, inFlight: verificationDiagnostics.inFlight,
      lastFailure: verificationDiagnostics.lastFailure ? { ...verificationDiagnostics.lastFailure } : null,
      stages: Object.fromEntries(VERIFICATION_STAGES.map(stage => { const value = verificationDiagnostics.stages[stage];
        return [stage, { entered: value.entered, failed: value.failed, codes: { ...value.codes } }]; })),
      // Do not call ledger.status(): its retained foreign error may have a code
      // accessor. Public polling must never evaluate an exception's properties.
      ledger: { configured: Boolean(options.store), ready: ledger.enabled === true } };
  }
  let recoveryFlight = null, recoverAfter = 0;
  const ready = Promise.resolve(ledger.ready).then(() => { readyOk = ledger.enabled === true; }, () => { readyOk = false; })
    .finally(() => { initialReadySettled = true; });
  const routes = Object.freeze({ status: '/gaming/identity/status', legacyImport: '/gaming/identity/legacy-import', recordLink: '/gaming/identity/record-link',
    playChallenge: '/gaming/identity/play/challenge', playComplete: '/gaming/identity/play/complete',
    claimChallenge: '/gaming/identity/play/claim-challenge', claimComplete: '/gaming/identity/play/claim-complete' });
  const playRelayUrl = new URL(options.playRelayCatalog ?? 'https://relay.interego.xwisee.com/tools').origin;
  const playConfigured = typeof options.playGrantSigner === 'function' || typeof options.store?.publicationIdentity === 'function';
  const playDescription = () => ({ enabled: enabled() && playConfigured, relayUrl: playRelayUrl, audience: publicUrl.origin });
  const claimChallenges = new Map(), claimAuthorizations = new Map(), claimsPending = new Map();
  function pruneClaims() {
    for (const map of [claimChallenges, claimAuthorizations, claimsPending]) for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key);
  }
  const prune = () => { for (const [key, proof] of proofs) if (proof.expiresAt <= now()) proofs.delete(key); };
  const recordFor = accountId => ledger.bindingForAccount(accountId);
  const enabled = () => !closed && readyOk && ledger.enabled === true;
  function recover() {
    if (closed || !options.store || !initialReadySettled) return Promise.resolve(false);
    if (enabled()) return Promise.resolve(true);
    if (recoveryFlight) return recoveryFlight.result;
    if (now() < recoverAfter) return Promise.resolve(false);
    // A recovered view comes only from the ledger's native readback, including
    // its existing version/equivocation guards. Never revive a saved cache.
    readyOk = false;
    const attempt = { expired: false, timer: null, stop: null, result: null };
    const task = Promise.resolve().then(async () => {
      await options.store.ready();
      if (closed || attempt.expired) return false;
      await ledger.refresh();
      return ledger.enabled === true;
    }).catch(() => false);
    const deadline = new Promise(resolve => {
      attempt.stop = () => { attempt.expired = true; recoverAfter = now() + recoveryCooldownMs; resolve(false); };
      attempt.timer = setTimeout(attempt.stop, recoveryTimeoutMs);
    });
    attempt.result = Promise.race([task, deadline]).then(confirmed => {
      if (confirmed && !attempt.expired && !closed) readyOk = true;
      if (!enabled()) recoverAfter = now() + recoveryCooldownMs;
      return enabled();
    });
    recoveryFlight = attempt;
    // A transport may ignore cancellation. Keep its flight occupied until the
    // underlying read settles, so timed-out HTTP requests cannot pile up reads.
    void task.finally(() => {
      clearTimeout(attempt.timer);
      if (recoveryFlight === attempt) {
        recoveryFlight = null;
        if (!enabled()) recoverAfter = Math.max(recoverAfter, now() + recoveryCooldownMs);
      }
    });
    return attempt.result;
  }
  const recoveryTimer = options.store ? setInterval(() => { if (!enabled()) void recover(); }, recoveryCooldownMs) : null;
  recoveryTimer?.unref?.();
  async function requireReady() {
    await ready;
    if (!enabled()) await recover();
    if (!enabled()) fail('native_identity_unavailable', 503);
  }
  function authenticated(req, { reauthentication = false } = {}) {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192) fail('game_account_required', 401);
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) fail('game_account_required', 401);
    let claims;
    try { claims = options.tokenClaims(match[1]); } catch { fail('game_account_required', 401); }
    let recovery = null;
    if (reauthentication && typeof options.reauthenticationClaims === 'function') {
      try { recovery = options.reauthenticationClaims(match[1]); } catch { fail('game_account_required', 401); }
      if (recovery != null) {
        if (!plain(recovery) || recovery.purpose !== 'native-reauthentication-only'
          || typeof recovery.nativeDid !== 'string' || !recovery.nativeDid.startsWith('did:')
          || !Number.isSafeInteger(recovery.exp) || !Number.isSafeInteger(recovery.reauthenticationUntil)
          || recovery.reauthenticationUntil <= now() || recovery.reauthenticationUntil > recovery.exp + 86_400_000
          || (claims && (claims.id !== recovery.id || claims.nativeDid !== recovery.nativeDid))) fail('game_account_required', 401);
        claims = recovery;
      }
    }
    if (!plain(claims) || (!reauthentication && claims.purpose !== undefined) || typeof claims.id !== 'string' || !claims.id || claims.id.length > 256
      || !Number.isFinite(claims.exp) || (!recovery && claims.exp <= now())) fail('game_account_required', 401);
    const account = options.getAccount(claims.id);
    if (!account || account.id !== claims.id) fail('game_account_required', 401);
    if (reauthentication && claims.nativeDid && recordFor(account.id)?.binding.subjectDid !== claims.nativeDid) fail('game_account_required', 401);
    return { claims, account, sessionId: hash(match[1]), authorizationUntil: recovery ? recovery.reauthenticationUntil : claims.exp };
  }
  function freshDid(claims, accountId, { human = false } = {}) {
    const record = recordFor(accountId);
    if (!record || !plain(claims) || claims.purpose !== undefined || claims.id !== accountId || claims.nativeDid !== record.binding.subjectDid
      || !Number.isFinite(claims.exp) || claims.exp <= now() || !Number.isFinite(claims.nativeVerifiedAt)
      || claims.nativeVerifiedAt > now() || claims.nativeVerifiedAt <= now() - FRESH_NATIVE_MS) return null;
    if ((claims.provisional === true) !== (record.binding.provisional === true)) return null;
    if (record.binding.provisional && (!human || record.claim || Date.parse(record.binding.expiresAt) <= now())) return null;
    return record.binding.subjectDid;
  }
  function playAuth(req, { fresh = false } = {}) {
    const auth = authenticated(req), record = recordFor(auth.account.id);
    if (fresh && !freshDid(auth.claims, auth.account.id, { human: true })) fail('native_signin_required', 403);
    if (record?.binding.provisional && record.claim) fail('provisional_owner_claimed', 409);
    return { ...auth, binding: record?.binding };
  }
  async function playProofAuth(req) {
    // Only Play challenge/complete may recover an expired signed guest. The
    // returned purpose is unusable by freshDid, ordinary auth, OAuth or claim.
    try { return playAuth(req); }
    catch (error) {
      if (!(error instanceof HostError) || error.code !== 'game_account_required' || error.status !== 401) throw error;
    }
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 8192) fail('game_account_required', 401);
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match || typeof options.provisionalProofClaims !== 'function') fail('game_account_required', 401);
    let claims;
    try { claims = options.provisionalProofClaims(match[1]); } catch { fail('game_account_required', 401); }
    if (!plain(claims) || claims.purpose !== 'provisional-play-proof-only' || claims.provisional !== true
      || typeof claims.id !== 'string' || !claims.id || claims.id.length > 256 || typeof claims.nativeDid !== 'string'
      || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.nativeVerifiedAt) || claims.nativeVerifiedAt < 0
      || claims.nativeVerifiedAt > now() || claims.exp <= claims.nativeVerifiedAt || claims.exp > claims.nativeVerifiedAt + FRESH_NATIVE_MS
      || !Number.isSafeInteger(claims.provisionalProofUntil) || claims.provisionalProofUntil <= now()
      || claims.provisionalProofUntil > claims.exp + 86_400_000) fail('game_account_required', 401);
    const account = options.getAccount(claims.id);
    if (!account || account.id !== claims.id) fail('game_account_required', 401);
    // Reread confirmed native ownership; a retired source on another host
    // must not be recovered from this process's earlier disposable view.
    await ledger.refresh();
    const record = recordFor(account.id), expiresAt = Date.parse(record?.binding.expiresAt);
    if (record?.binding.provisional !== true || record.claim || record.binding.subjectDid !== claims.nativeDid
      || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) fail('game_account_required', 401);
    return { claims, account, binding: record.binding, sessionId: hash(match[1]),
      authorizationUntil: Math.min(expiresAt, claims.provisionalProofUntil) };
  }
  async function issueBoundSession(result) {
    let account = options.getAccount(result.accountId);
    if (!account) account = await options.restoreAccount(recordFor(result.accountId));
    if (!account || account.id !== result.accountId) fail('account_restore_failed', 503);
    const appSession = await options.issueAppSession(result.accountId, result.binding);
    if (!plain(appSession) || typeof appSession.token !== 'string' || !appSession.token || appSession.token.length > 8192
      || appSession.acct?.id !== result.accountId || Buffer.byteLength(JSON.stringify(appSession)) > 16384) fail('app_session_unavailable', 503);
    return { appSession };
  }
  const play = createProvisionalPlayAdmission({ publicOrigin: publicUrl.origin, identityOrigin: options.identityOrigin,
    relayUrl: playRelayUrl,
    now, signGrant: options.playGrantSigner ?? createNativePlayGrantSigner({ identityProvider: async () => {
      if (typeof options.store?.publicationIdentity !== 'function') fail('play_service_identity_unavailable', 503);
      return options.store.publicationIdentity();
    }, catalogUrl: options.playRelayCatalog, fetch: options.fetch }),
    verifyProof: options.provisionalProofVerifier ?? createProvisionalProofVerifier({ identityOrigin: options.identityOrigin, fetch: options.fetch }),
    bindOwner: async (binding, accountId, operationId) => {
      await requireReady();
      const account = options.getAccount(accountId); if (!account) fail('game_account_required', 401);
      const result = await ledger.bindVerified(binding, accountId, { operationId, accountSummary: accountSummary(account) });
      return issueBoundSession(result);
    } });
  async function authorizeGameAccount(req, body) {
    await requireReady(); prune();
    // This authority is intentionally restricted to the existing OAuth ceremony.
    // All ordinary account, record and companion operations keep strict expiry.
    const auth = authenticated(req, { reauthentication: true }), sessionBinding = hash(auth.sessionId);
    const expectedSubjectDid = recordFor(auth.account.id)?.binding.subjectDid;
    if (new URL(req.url, publicUrl).pathname === bridge.paths.start) {
      if (!proofs.has(sessionBinding) && proofs.size >= MAX_SESSION_PROOFS) fail('identity_ceremony_limit', 429);
      proofs.set(sessionBinding, { accountId: auth.account.id, claims: { ...auth.claims },
        expectedSubjectDid, expiresAt: Math.min(auth.authorizationUntil, now() + PROOF_TTL_MS) });
    }
    return { accountId: auth.account.id, sessionId: auth.sessionId, expectedSubjectDid, ownerPodWriteAccess: body?.ownerPodWriteAccess === true };
  }
  async function onVerified(binding, requestedAccountId, context) {
    let stage = 'ready-proof';
    const enter = next => { stage = next; increment(verificationDiagnostics.stages[stage], 'entered'); };
    increment(verificationDiagnostics, 'attempts'); increment(verificationDiagnostics, 'inFlight'); enter(stage);
    try {
      await requireReady(); prune(); aborted(context.signal);
      const proof = proofs.get(context.sessionBinding), initiatingAccount = options.getAccount(requestedAccountId);
      if (!proof || proof.accountId !== requestedAccountId || proof.claims.id !== requestedAccountId
        || proof.expiresAt <= now() || !initiatingAccount || initiatingAccount.id !== requestedAccountId
        || (proof.expectedSubjectDid && binding.subjectDid !== proof.expectedSubjectDid)) {
        fail('game_account_required', 401);
      }
      const operationId = 'player-bind:' + hash(context.sessionBinding + ':' + binding.subjectDid);
      enter('ledger-bind');
      const result = await ledger.bindVerified(binding, requestedAccountId, { operationId,
        accountSummary: accountSummary(initiatingAccount), signal: context.signal });
      aborted(context.signal);
      enter('account-restore');
      let account = options.getAccount(result.accountId);
      if (!account) {
        account = await options.restoreAccount(recordFor(result.accountId));
        if (!account || account.id !== result.accountId) fail('account_restore_failed', 503);
      }
      aborted(context.signal);
      enter('issue-app-session');
      const appSession = await options.issueAppSession(result.accountId, result.binding);
      aborted(context.signal);
      if (!plain(appSession) || typeof appSession.token !== 'string' || !appSession.token || appSession.token.length > 8192
        || !plain(appSession.acct) || appSession.acct.id !== result.accountId || Buffer.byteLength(JSON.stringify(appSession)) > 16_384) {
        fail('app_session_unavailable', 503);
      }
      proofs.delete(context.sessionBinding);
      increment(verificationDiagnostics, 'succeeded');
      return { appSession };
    } catch (error) {
      const code = failureCode(error), counters = verificationDiagnostics.stages[stage];
      increment(verificationDiagnostics, 'failed'); increment(counters, 'failed'); increment(counters.codes, code);
      verificationDiagnostics.lastFailure = { stage, code };
      throw error;
    } finally { verificationDiagnostics.inFlight = Math.max(0, verificationDiagnostics.inFlight - 1); }
  }
  const bridge = createPlayerIdentityBridge({ ...options, authorizeGameAccount, onVerified });
  const claimPaths = { start: '/gaming/identity/claim-owner/start', callback: '/gaming/identity/claim-owner/callback',
    clientMetadata: '/gaming/identity/claim-owner/client.json', claim: '/gaming/identity/claim-owner/claim' };
  const claimBridge = createPlayerIdentityBridge({ ...options, startPath: claimPaths.start, callbackPath: claimPaths.callback,
    clientMetadataPath: claimPaths.clientMetadata, claimPath: claimPaths.claim, cookieName: '__Host-hallowmarch-claim-owner',
    successPath: '/gaming/identity/finish?purpose=character-claim-target', requireCanonicalOwner: true,
    authorizeGameAccount: async (req, body) => {
      await requireReady(); pruneClaims();
      const auth = playAuth(req, { fresh: true }), sessionBinding = hash(auth.sessionId);
      if (auth.binding?.provisional !== true || body?.ownerPodWriteAccess !== true) fail('provisional_owner_required', 403);
      if (new URL(req.url, publicUrl).pathname === claimPaths.start) {
        const challenge = claimChallenges.get(body.challenge);
        if (!challenge || challenge.sessionId !== auth.sessionId || challenge.accountId !== auth.account.id) fail('claim_challenge_unavailable', 409);
        await play.verifySource(auth, { attestation: body.attestation, proof: body.proof }, body.challenge);
        if (claimAuthorizations.size >= MAX_SESSION_PROOFS && !claimAuthorizations.has(sessionBinding)) fail('identity_ceremony_limit', 429);
        claimAuthorizations.set(sessionBinding, { accountId: auth.account.id, sessionId: auth.sessionId,
          sourceBinding: structuredClone(auth.binding), expiresAt: Math.min(auth.claims.exp, now() + PROOF_TTL_MS) });
        claimChallenges.delete(body.challenge);
      }
      const authorization = claimAuthorizations.get(sessionBinding);
      if (!authorization || authorization.accountId !== auth.account.id || authorization.expiresAt <= now()) fail('claim_authorization_required', 403);
      return { accountId: auth.account.id, sessionId: auth.sessionId, ownerPodWriteAccess: true };
    },
    onVerified: async (binding, accountId, context) => {
      await requireReady(); pruneClaims(); aborted(context.signal);
      const authorization = claimAuthorizations.get(context.sessionBinding), source = recordFor(accountId);
      if (!authorization || authorization.accountId !== accountId || authorization.expiresAt <= now()
        || source?.binding.provisional !== true || source.claim || source.binding.subjectDid !== authorization.sourceBinding.subjectDid
        || context.ownerPodWriteAccess !== true) fail('claim_authorization_required', 403);
      const target = ledger.bindingForDid(binding.subjectDid);
      if (target?.binding.provisional && target.accountId !== accountId) fail('canonical_native_owner_required', 403);
      if (claimsPending.size >= MAX_SESSION_PROOFS) fail('identity_ceremony_limit', 429);
      const claimOperationId = 'character-claim:' + randomBytes(32).toString('base64url'), sourceChallenge = randomBytes(32).toString('base64url');
      const expiresAt = Math.min(authorization.expiresAt, now() + PROOF_TTL_MS, Date.parse(source.binding.expiresAt));
      const existingRecord = target?.records.character ?? null;
      claimsPending.set(claimOperationId, { accountId, sessionId: authorization.sessionId, sourceBinding: structuredClone(source.binding),
        targetBinding: structuredClone(binding), sourceChallenge, existingRecord: structuredClone(existingRecord), expiresAt,
        digest: null, flight: null, answer: null });
      // This purpose-limited result is not a game token or canonical principal.
      return { appSession: { purpose: 'character-claim-target', claimOperationId, audience: publicUrl.origin,
        guestOwnerDid: source.binding.subjectDid, targetOwnerDid: binding.subjectDid, sourceChallenge,
        expiresAt: new Date(expiresAt).toISOString(), existingRecord } };
    } });
  async function finalizeClaim(req, body) {
    pruneClaims(); const auth = authenticated(req), pending = claimsPending.get(body.claimOperationId);
    const originalSession = pending && pending.sessionId === auth.sessionId && pending.accountId === auth.account.id;
    // Only the exact session issued by this completed operation can recover its
    // receipt after a reload has already persisted the canonical game token.
    const completedSession = pending?.answer && hash(pending.answer.appSession.token) === auth.sessionId
      && pending.answer.appSession.acct.id === auth.account.id && auth.claims.provisional !== true
      && freshDid(auth.claims, auth.account.id) === pending.targetBinding.subjectDid;
    if (!pending || (!originalSession && !completedSession) || pending.expiresAt <= now()) fail('claim_operation_unavailable', 409);
    if (Object.keys(body).some(key => !['claimOperationId', 'attestation', 'proof', 'targetRecord', 'readConfirmed', 'selection'].includes(key))
      || (body.selection !== undefined && !['copy-guest', 'use-existing'].includes(body.selection))
      || body.readConfirmed !== true || !plain(body.targetRecord)) fail('invalid_claim_readback');
    const reference = body.targetRecord;
    if (Object.keys(reference).some(key => !['kind', 'graphIri', 'descriptorUrl', 'cid', 'bindingCid', 'nativeRevision', 'recordCid', 'proofKind', 'digest'].includes(key))
      || reference.proofKind !== 'owner-key-authenticated-checkpoint' || typeof reference.cid !== 'string' || !reference.cid
      || typeof reference.recordCid !== 'string' || !reference.recordCid || typeof reference.digest !== 'string' || !reference.digest
      || typeof reference.nativeRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(reference.nativeRevision)
      || Buffer.byteLength(JSON.stringify(reference)) > 8192) fail('invalid_claim_readback');
    const frozenReference = Object.fromEntries(Object.keys(reference).sort().map(key => [key, reference[key]]));
    const requestDigest = hash(JSON.stringify({ claimOperationId: body.claimOperationId, targetRecord: frozenReference,
      selection: body.selection ?? 'copy-guest', readConfirmed: true }));
    if ((!completedSession && (auth.claims.provisional !== true || auth.claims.nativeDid !== pending.sourceBinding.subjectDid)) || !Number.isFinite(auth.claims.nativeVerifiedAt)
      || auth.claims.nativeVerifiedAt <= now() - FRESH_NATIVE_MS || Date.parse(pending.sourceBinding.expiresAt) <= now()) fail('native_signin_required', 403);
    // ECDSA proofs can change on retry. Verify each fresh source proof, while
    // freezing only the personal record selection and native checkpoint receipt.
    await play.verifySource({ ...auth, binding: pending.sourceBinding }, { attestation: body.attestation, proof: body.proof }, pending.sourceChallenge);
    if (pending.expiresAt <= now()) fail('claim_operation_unavailable', 409);
    if (pending.digest && pending.digest !== requestDigest) fail('claim_operation_changed', 409);
    if (pending.answer) return structuredClone(pending.answer);
    if (pending.flight) return pending.flight;
    pending.digest = requestDigest;
    pending.flight = (async () => {
      if (pending.expiresAt <= now()) fail('claim_operation_unavailable', 409);
      const result = await ledger.promoteProvisional(pending.accountId, pending.sourceBinding.subjectDid, pending.targetBinding, reference,
        { operationId: body.claimOperationId, expectedTargetRecord: pending.existingRecord, checkpointDigest: hash(JSON.stringify(reference)) });
      pending.answer = { ...await issueBoundSession(result), binding: publicBinding(result.binding), provisional: false,
        claimed: true, claimOperationId: body.claimOperationId, pointer: result.pointer };
      return structuredClone(pending.answer);
    })();
    try { return await pending.flight; } finally { pending.flight = null; }
  }
  const contract = nativeIdentityDescription({ publicOrigin: publicUrl.origin,
    paths: { ...bridge.paths, ...routes }, allowOwnerBrowserHandoff: options.allowOwnerBrowserHandoff === true });
  const publicRoutes = { '/gaming/identity/affordances': ['application/ld+json', contract.description],
    '/gaming/identity/schemas': ['application/schema+json', contract.schemas] };
  async function statusResponse(req, res) {
    const { account, claims } = authenticated(req), record = recordFor(account.id), verified = !!freshDid(claims, account.id, { human: true });
    const legacyImportAvailable = verified && (await options.readLegacySave(account.id)) != null;
    json(res, 200, { enabled: true, status: record && !verified ? 'native_signin_required' : verified ? 'verified' : 'native_identity_required',
      account: accountSummary(account), bound: !!record, verified, binding: verified ? publicBinding(record.binding) : null,
      recordLinks: verified ? structuredClone(record.records ?? {}) : {}, legacyImportAvailable,
      // Lifecycle is an account hint, never owner proof. A stale guest still
      // needs its browser key to refresh; keep its binding and records private.
      provisional: record?.binding.provisional === true, provisionalPlay: playDescription(),
      saveAuthority: record ? 'player-pod' : 'legacy-server' });
  }
  return Object.freeze({ ready,
    // Native publication is owned by the injected host service. This immutable
    // public graph contains contracts only; it is not a signed descriptor.
    metadataGraph() { return contract.graphContent; },
    manifest() { return { ...contract.manifest, enabled: enabled(), provisionalPlay: playDescription() }; },
    status() { prune(); return { enabled: enabled(), status: closed ? 'closed' : enabled() ? 'ready' : 'unavailable',
      pending: bridge.status().pending, readyHandoffs: bridge.status().readyHandoffs,
      callbackFailures: bridge.status().callbackFailures, verificationDiagnostics: verificationStatus() }; },
    isBound(accountId) { return enabled() && !!recordFor(accountId); },
    // Privileged host ports: wire callers never choose a DID or pod to trust.
    bindingForAccount(accountId) { return enabled() && recordFor(accountId) ? publicBinding(recordFor(accountId).binding) : null; },
    async ownerForRequest(req) {
      await requireReady();
      const { claims, account } = authenticated(req), subjectDid = freshDid(claims, account.id);
      if (!subjectDid) fail('native_signin_required', 403);
      return { accountId: account.id, binding: publicBinding(recordFor(account.id).binding) };
    },
    principalFor(client) {
      if (!enabled() || !client?.acct?.id || options.getAccount(client.acct.id)?.id !== client.acct.id) return null;
      return freshDid(client.authClaims, client.acct.id);
    },
    humanPrincipalFor(client) {
      if (!enabled() || !client?.acct?.id || options.getAccount(client.acct.id)?.id !== client.acct.id) return null;
      return freshDid(client.authClaims, client.acct.id, { human: true });
    },
    close() {
      closed = true; readyOk = false; proofs.clear(); bridge.close(); claimBridge.close(); play.close();
      claimChallenges.clear(); claimAuthorizations.clear(); claimsPending.clear();
      clearInterval(recoveryTimer);
      if (recoveryFlight) { clearTimeout(recoveryFlight.timer); recoveryFlight.stop(); }
    },
    async handle(req, res) {
      let url;
      try { url = new URL(req.url, publicUrl); } catch { return false; }
      const route = Object.entries(routes).find(([, target]) => target === url.pathname)?.[0];
      const native = Object.values(bridge.paths).includes(url.pathname), claimNative = Object.values(claimBridge.paths).includes(url.pathname);
      const documentation = publicRoutes[url.pathname];
      if (!route && !native && !claimNative && !documentation) return false;
      try {
        if (req.headers.host !== publicUrl.host || url.origin !== publicUrl.origin) fail('invalid_identity_origin', 403);
        if (documentation) {
          if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); fail('method_not_allowed', 405); }
          json(res, 200, documentation[1], documentation[0]); return true;
        }
        await requireReady();
        if (native) return await bridge.handle(req, res);
        if (claimNative) return await claimBridge.handle(req, res);
        const method = ['status', 'legacyImport'].includes(route) ? 'GET' : 'POST';
        if (req.method !== method) { res.setHeader('Allow', method); fail('method_not_allowed', 405); }
        if (method === 'POST' && req.headers.origin !== publicUrl.origin) fail('invalid_identity_origin', 403);
        if (route === 'status') await statusResponse(req, res);
        else if (route === 'playChallenge') {
          if (!playConfigured) fail('play_service_identity_unavailable', 503);
          json(res, 200, await play.challenge(await playProofAuth(req), await readBody(req, 32768)));
        } else if (route === 'playComplete') json(res, 200, await play.complete(await playProofAuth(req), await readBody(req, 32768)));
        else if (route === 'claimChallenge') {
          const auth = playAuth(req, { fresh: true });
          if (auth.binding?.provisional !== true) fail('provisional_owner_required', 403);
          const body = await readBody(req); if (Object.keys(body).length) fail('invalid_claim_request');
          pruneClaims();
          if (claimChallenges.size >= MAX_SESSION_PROOFS || [...claimChallenges.values()].filter(item => item.accountId === auth.account.id).length >= 4) fail('identity_ceremony_limit', 429);
          const challenge = randomBytes(32).toString('base64url'), expiresAt = Math.min(auth.claims.exp, now() + 120000);
          claimChallenges.set(challenge, { accountId: auth.account.id, sessionId: auth.sessionId, expiresAt });
          json(res, 200, { challenge, audience: publicUrl.origin, expiresAt: new Date(expiresAt).toISOString() });
        } else if (route === 'claimComplete') json(res, 200, await finalizeClaim(req, await readBody(req, 32768)));
        else {
          const auth = authenticated(req), subjectDid = freshDid(auth.claims, auth.account.id, { human: true });
          if (!subjectDid) fail('native_signin_required', 403);
          if (route === 'legacyImport') json(res, 200, { save: await options.readLegacySave(auth.account.id),
            source: 'legacy-local-import', authoritative: false });
          else {
            const body = await readBody(req);
            const pointer = Object.fromEntries(['kind', 'graphIri', 'descriptorUrl', 'cid'].filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
            const result = await ledger.linkRecord(auth.account.id, subjectDid, pointer,
              { operationId: 'player-record:' + hash(auth.account.id + ':' + JSON.stringify(pointer)) });
            json(res, 200, { ok: true, pointer: result.pointer, version: result.version });
          }
        }
      } catch (error) {
        const known = error instanceof HostError || error instanceof ProvisionalPlayError ? error : error instanceof PlayerBindingError
          ? new HostError(({ CLAIM_CHARACTER_CONFLICT: 'claim_character_conflict', CLAIM_TARGET_CHANGED: 'claim_target_changed',
            PROVISIONAL_OWNER_CLAIMED: 'provisional_owner_claimed' })[error.code] ?? 'native_record_rejected', [400, 403, 409, 413].includes(error.status) ? error.status : 503)
          : new HostError('native_identity_unavailable', 503);
        if (!res.headersSent) json(res, known.status, { error: known.code }); else res.end();
      }
      return true;
    },
  });
}

