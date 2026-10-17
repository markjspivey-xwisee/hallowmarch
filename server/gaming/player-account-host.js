/**
 * Compose a game's authenticated account session with the native owner ledger.
 * The game retains its own short-lived session credentials; native credentials
 * are handled only by the OAuth bridge and the consenting owner's browser.
 */
import { createHash } from 'node:crypto';
import { createPlayerBindingLedger, PlayerBindingError } from './player-bindings.js';
import { createPlayerIdentityBridge } from './player-identity.js';
import { nativeIdentityDescription } from './native-identity-description.js';

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
  return result;
}
async function readBody(req) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) fail('json_body_required', 415);
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length; if (size > 4096) fail('request_body_too_large', 413); chunks.push(chunk);
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
  const routes = Object.freeze({ status: '/gaming/identity/status', legacyImport: '/gaming/identity/legacy-import', recordLink: '/gaming/identity/record-link' });
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
  function freshDid(claims, accountId) {
    const record = recordFor(accountId);
    if (!record || !plain(claims) || claims.purpose !== undefined || claims.id !== accountId || claims.nativeDid !== record.binding.subjectDid
      || !Number.isFinite(claims.exp) || claims.exp <= now() || !Number.isFinite(claims.nativeVerifiedAt)
      || claims.nativeVerifiedAt > now() || claims.nativeVerifiedAt <= now() - FRESH_NATIVE_MS) return null;
    return record.binding.subjectDid;
  }
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
  const contract = nativeIdentityDescription({ publicOrigin: publicUrl.origin,
    paths: { ...bridge.paths, ...routes }, allowOwnerBrowserHandoff: options.allowOwnerBrowserHandoff === true });
  const publicRoutes = { '/gaming/identity/affordances': ['application/ld+json', contract.description],
    '/gaming/identity/schemas': ['application/schema+json', contract.schemas] };
  async function statusResponse(req, res) {
    const { account, claims } = authenticated(req), record = recordFor(account.id), verified = !!freshDid(claims, account.id);
    const legacyImportAvailable = verified && (await options.readLegacySave(account.id)) != null;
    json(res, 200, { enabled: true, status: record && !verified ? 'native_signin_required' : verified ? 'verified' : 'native_identity_required',
      account: accountSummary(account), bound: !!record, verified, binding: verified ? publicBinding(record.binding) : null,
      recordLinks: verified ? structuredClone(record.records ?? {}) : {}, legacyImportAvailable,
      saveAuthority: record ? 'player-pod' : 'legacy-server' });
  }
  return Object.freeze({ ready,
    // Native publication is owned by the injected host service. This immutable
    // public graph contains contracts only; it is not a signed descriptor.
    metadataGraph() { return contract.graphContent; },
    manifest() { return { ...contract.manifest, enabled: enabled() }; },
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
    close() {
      closed = true; readyOk = false; proofs.clear(); bridge.close();
      clearInterval(recoveryTimer);
      if (recoveryFlight) { clearTimeout(recoveryFlight.timer); recoveryFlight.stop(); }
    },
    async handle(req, res) {
      let url;
      try { url = new URL(req.url, publicUrl); } catch { return false; }
      const route = Object.entries(routes).find(([, target]) => target === url.pathname)?.[0];
      const native = Object.values(bridge.paths).includes(url.pathname);
      const documentation = publicRoutes[url.pathname];
      if (!route && !native && !documentation) return false;
      try {
        if (req.headers.host !== publicUrl.host || url.origin !== publicUrl.origin) fail('invalid_identity_origin', 403);
        if (documentation) {
          if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); fail('method_not_allowed', 405); }
          json(res, 200, documentation[1], documentation[0]); return true;
        }
        await requireReady();
        if (native) return await bridge.handle(req, res);
        const method = route === 'recordLink' ? 'POST' : 'GET';
        if (req.method !== method) { res.setHeader('Allow', method); fail('method_not_allowed', 405); }
        if (method === 'POST' && req.headers.origin !== publicUrl.origin) fail('invalid_identity_origin', 403);
        if (route === 'status') await statusResponse(req, res);
        else {
          const auth = authenticated(req), subjectDid = freshDid(auth.claims, auth.account.id);
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
        const known = error instanceof HostError ? error : error instanceof PlayerBindingError
          ? new HostError('native_record_rejected', [400, 403, 409, 413].includes(error.status) ? error.status : 503)
          : new HostError('native_identity_unavailable', 503);
        if (!res.headersSent) json(res, known.status, { error: known.code }); else res.end();
      }
      return true;
    },
  });
}
