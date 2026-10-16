/** Manual QA ceremony retention. No top-level browser, network or credential I/O. */
import { createHash } from 'node:crypto';

const error = code => Object.assign(new Error('Retained native OAuth QA refused.'), { code });
const ensure = (value, code) => { if (!value) throw error(code); };
const numericStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const callbackCodes = new Set(['invalid_identity_callback', 'invalid_identity_ceremony', 'identity_authorization_declined',
  'identity_service_unavailable', 'identity_binding_timeout', 'identity_binding_rejected', 'identity_status_refused',
  'identity_request_timeout', 'identity_provider_unavailable', 'unexpected_native_grant', 'native_owner_mismatch',
  'identity_bridge_closed', 'identity_ceremony_limit', 'invalid_app_session', 'expired_native_grant']);
const finishCodes = new Map([
  ['Finishing your identity connection…', 'finish_pending'],
  ['Connected. Your game can now open your private pod.', 'finish_connected'],
  ['The sign-in window expired. Return to the game and connect again.', 'finish_expired'],
  ['The connection could not be confirmed. Return to the game and connect again.', 'finish_claim_refused'],
  ['The owner pod grant is incomplete. Return to the game and connect again.', 'finish_grant_incomplete'],
  ['This game is playing another identity’s character. Reconnect its original identity; your current progress has not been moved.', 'finish_owner_mismatch'],
  ['This identity relay needs a compatible browser credential bridge.', 'finish_mcp_incompatible'],
  ['This identity provider needs a compatible browser credential bridge.', 'finish_provider_incompatible'],
]);
export const nativeOAuthFinishCode = value => finishCodes.get(value) || null;

// Provider bridge pinned to Interego 5fe8ed, identity/derive-userid.ts: UTF-8
// SHA256 of verified credential.id (base64url STRING), not raw bytes/userHandle.
// This is only a QA consistency hint. Actual owner authority is still verified
// by WebAuthn, the native callback and the host's authenticated status response.
function retainedCredentialId(credential) {
  ensure(credential?.privateKey && credential.isResidentCredential === true && typeof credential.credentialId === 'string'
    && /^[A-Za-z0-9+/]{1,4096}={0,2}$/.test(credential.credentialId), 'qa_oauth_passkey_required');
  const bytes = Buffer.from(credential.credentialId, 'base64');
  ensure(bytes.length > 0 && bytes.toString('base64').replace(/=+$/, '') === credential.credentialId.replace(/=+$/, ''), 'qa_oauth_passkey_required');
  return bytes.toString('base64url');
}
export const nativeOAuthCredentialUserId = credentialId => {
  ensure(typeof credentialId === 'string' && /^[A-Za-z0-9_-]{1,4096}$/.test(credentialId)
    && Buffer.from(credentialId, 'base64url').toString('base64url') === credentialId, 'qa_oauth_registration_provenance');
  return 'u-pk-' + createHash('sha256').update(credentialId, 'utf8').digest('hex').slice(0, 12);
};

export async function retainedNativeOAuthPopup({ page, gameOrigin, onPopup }) {
  const watched = promise => { promise.catch(() => {}); return promise; };
  const startResponse = watched(page.waitForResponse(response => new URL(response.url()).origin === gameOrigin
    && new URL(response.url()).pathname === '/gaming/identity/start' && response.request().method() === 'POST'));
  // Retain at the event boundary, before awaiting click/navigation. A timed-out
  // click can already have opened the original authorization popup.
  const popupPromise = watched(page.waitForEvent('popup').then(popup => { onPopup(popup); return popup; }));
  try { await page.locator('#title .native-player button').first().click(); }
  catch { /* The original event/response promises determine whether opening succeeded. */ }
  const popup = await popupPromise, response = await startResponse;
  return { popup, advertised: await response.json(), startStatus: response.status(),
    startAuthorization: response.request().headers().authorization };
}

export function createRetainedNativeOAuth({ register, gameOrigin, relayOrigin, expectedOwner = null,
  getPasskey, start, prove, verifyOwner, inspectFinish = async () => null, timeoutMs = 180000 } = {}) {
  ensure(typeof register === 'boolean' && [getPasskey, start, prove, verifyOwner, inspectFinish].every(value => typeof value === 'function')
    && Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 180000, 'qa_oauth_configuration');
  for (const origin of [gameOrigin, relayOrigin]) { let u; try { u = new URL(origin); } catch { throw error('qa_oauth_configuration'); }
    ensure(u.protocol === 'https:' && u.origin === origin, 'qa_oauth_configuration'); }
  ensure(gameOrigin !== relayOrigin && (register ? expectedOwner === null : /^u-pk-[0-9a-f]{12}$/.test(expectedOwner?.userId || '')), 'qa_oauth_configuration');
  const attempts = [];
  let current = null, completeOwner = null, running = null, closed = false, retryApproved = false, registrationAttempted = false;
  let originalCredentialId = null, lastCode = null;
  const changed = attempt => { attempt.wake?.(); attempt.wake = null; };
  const registrationReady = () => { try { return !!originalCredentialId && retainedCredentialId(getPasskey()) === originalCredentialId; }
    catch { return false; } };
  const canRetry = () => !closed && !running && !!current && current.callbackStatus >= 400 && current.claimRequests === 0
    && current.jobs.size === 0 && current.verifySucceeded && current.redirectHash === current.callbackHash && !current.invalid
    && !completeOwner && !!registrationReady() && attempts.length < 4;
  function attach(attempt, popup) {
    ensure(!attempt.popup || attempt.popup === popup, 'qa_oauth_popup_mismatch');
    if (attempt.popup) return;
    attempt.popup = popup;
    attempt.onRequest = request => {
      try {
        const url = new URL(request.url());
        if (url.origin !== gameOrigin || url.pathname !== '/gaming/identity/claim' || request.method() !== 'POST') return;
        ensure(++attempt.claimRequests === 1, 'qa_oauth_claim_provenance');
        attempt.claimAuthorization = request.headers().authorization;
        ensure(attempt.claimAuthorization === attempt.startAuthorization, 'qa_oauth_claim_provenance');
        attempt.phase = 'claim';
      } catch { attempt.invalid = 'qa_oauth_claim_provenance'; }
      changed(attempt);
    };
    attempt.onClose = () => { attempt.popupClosed = true; changed(attempt); };
    attempt.onResponse = response => {
      const task = observe(attempt, response).catch(cause => { attempt.invalid = cause.code || 'qa_oauth_response_refused'; })
        .finally(() => { attempt.jobs.delete(task); changed(attempt); });
      attempt.jobs.add(task);
    };
    popup.on('close', attempt.onClose); popup.on('request', attempt.onRequest); popup.on('response', attempt.onResponse);
  }
  function detach(attempt) { attempt.popup?.off('close', attempt.onClose); attempt.popup?.off('request', attempt.onRequest); attempt.popup?.off('response', attempt.onResponse); }
  async function observe(attempt, response) {
    const url = new URL(response.url()), request = response.request(), method = request.method();
    if (url.origin === relayOrigin && url.pathname === '/oauth/verify' && method === 'POST') {
      ensure(++attempt.verifyResponses === 1, 'qa_oauth_registration_provenance');
      let body; try { body = JSON.parse(request.postData() || ''); } catch { throw error('qa_oauth_registration_provenance'); }
      ensure(Object.keys(body).sort().join(',') === 'method,pending_id,response' && /^[a-f0-9]{32}$/.test(body.pending_id || '')
        && body.method === (attempt.register ? 'webauthn-register' : 'webauthn-authenticate')
        && typeof body.response?.id === 'string' && body.response.id === body.response.rawId
        && body.response.id === retainedCredentialId(getPasskey()), 'qa_oauth_registration_provenance');
      if (originalCredentialId) ensure(body.response.id === originalCredentialId, 'qa_oauth_owner_mismatch');
      attempt.verifyStatus = numericStatus(response.status()); attempt.phase = 'native-proof-response';
      if (!response.ok()) return;
      const value = await response.json();
      ensure(value && Object.keys(value).join(',') === 'redirect' && typeof value.redirect === 'string', 'qa_oauth_response_refused');
      const redirect = new URL(value.redirect);
      ensure(redirect.origin === gameOrigin && redirect.pathname === '/gaming/identity/callback' && !redirect.username && !redirect.password
        && !redirect.hash && redirect.searchParams.getAll('state').length === 1 && redirect.searchParams.get('state') === attempt.state
        && redirect.searchParams.getAll('code').length === 1 && !!redirect.searchParams.get('code')
        && [...redirect.searchParams.keys()].sort().join(',') === 'code,state', 'qa_oauth_response_refused');
      originalCredentialId ||= body.response.id;
      attempt.redirectHash = createHash('sha256').update(redirect.href).digest('hex');
      attempt.verifySucceeded = true; attempt.phase = 'callback'; return;
    }
    if (url.origin !== gameOrigin) return;
    if (url.pathname === '/gaming/identity/callback' && method === 'GET') {
      ensure(url.searchParams.getAll('state').length === 1 && url.searchParams.get('state') === attempt.state,
        'qa_oauth_callback_provenance');
      attempt.callbackStatus = numericStatus(response.status());
      attempt.callbackHash = createHash('sha256').update(url.href).digest('hex');
      attempt.phase = 'finish-document';
      if (attempt.callbackStatus >= 400) {
        let value; try { value = await response.json(); } catch { /* A gateway error may be HTML. Never retain/print its body. */ }
        attempt.callbackCode = callbackCodes.has(value?.error) ? value.error : null;
      }
    } else if (url.pathname === '/gaming/identity/finish' && method === 'GET') {
      attempt.finishStatus = numericStatus(response.status()); attempt.phase = 'finish';
    }
    else if (url.pathname === '/gaming/identity/claim' && method === 'POST') {
      ensure(attempt.claimRequests === 1 && request.headers().authorization === attempt.claimAuthorization
        && attempt.claimAuthorization === attempt.startAuthorization, 'qa_oauth_claim_provenance');
      attempt.claimStatus = numericStatus(response.status());
    }
  }
  async function launch() {
    const attempt = { register: register && attempts.length === 0, popup: null, popupClosed: false, jobs: new Set(),
      phase: 'opening', state: null, pkce: false, verifyResponses: 0, verifyStatus: null, verifySucceeded: false,
      callbackStatus: null, callbackCode: null, finishStatus: null, finishCode: null, claimStatus: null,
      claimRequests: 0, superseded: false, completed: false, invalid: null };
    current = attempt; attempts.push(attempt);
    const opened = await start({ onPopup: popup => attach(attempt, popup) });
    attach(attempt, opened.popup);
    attempt.startAuthorization = opened.startAuthorization; attempt.startStatus = numericStatus(opened.startStatus);
    ensure(typeof attempt.startAuthorization === 'string' && /^Bearer \S+$/.test(attempt.startAuthorization), 'qa_oauth_start_provenance');
    if (attempts.length > 1) ensure(attempt.startAuthorization === attempts[0].startAuthorization, 'qa_oauth_start_provenance');
    const advertised = opened.advertised, authorize = new URL(advertised.authorizationUrl);
    ensure(attempt.startStatus === 200 && advertised.ownerPodWriteAccess === true && authorize.origin === relayOrigin
      && authorize.pathname === '/authorize' && authorize.searchParams.get('scope') === 'mcp:write'
      && authorize.searchParams.get('response_type') === 'code' && authorize.searchParams.get('code_challenge_method') === 'S256'
      && /^[A-Za-z0-9_-]{43}$/.test(authorize.searchParams.get('code_challenge') || '')
      && /^[A-Za-z0-9_-]{43}$/.test(authorize.searchParams.get('state') || '')
      && authorize.searchParams.get('redirect_uri') === gameOrigin + '/gaming/identity/callback', 'qa_oauth_start_provenance');
    attempt.state = authorize.searchParams.get('state'); attempt.pkce = true; attempt.phase = 'proof';
    if (attempt.register) { ensure(!registrationAttempted, 'qa_registration_retry_refused'); registrationAttempted = true; }
    try { await prove(attempt.popup, { register: attempt.register,
      // Explicit recovery is usernameless: only the original resident passkey
      // is installed. No caller supplies an identity or guessed userId.
      userId: attempts.length === 1 && !register ? expectedOwner.userId : null }); }
    catch { /* A navigation/click timeout can have completed native proof. Resume its original popup below. */ }
    if (attempt.phase === 'proof') attempt.phase = 'callback';
  }
  async function wait() {
    const attempt = current, deadline = Date.now() + timeoutMs;
    while (!closed) {
      await Promise.all([...attempt.jobs]);
      if (attempt.invalid) throw error(attempt.invalid);
      if (attempt.callbackStatus >= 400) {
        ensure(attempt.verifySucceeded && attempt.redirectHash === attempt.callbackHash, 'qa_oauth_callback_provenance');
        attempt.phase = 'callback-refused'; throw error('qa_oauth_callback_refused');
      }
      if (attempt.claimStatus >= 400) { attempt.phase = 'claim-refused'; throw error('qa_oauth_claim_refused'); }
      if (attempt.claimStatus === 200 && attempt.popupClosed) {
        attempt.phase = 'owner-verification'; const owner = await verifyOwner();
        ensure(attempt.verifySucceeded && attempt.redirectHash === attempt.callbackHash && attempt.pkce && attempt.callbackStatus === 303 && attempt.finishStatus === 200
          && originalCredentialId && owner.userId === nativeOAuthCredentialUserId(originalCredentialId)
          && (!expectedOwner || ['userId', 'subjectDid', 'podUrl', 'accountId'].every(key => owner[key] === expectedOwner[key])), 'qa_oauth_owner_mismatch');
        completeOwner = owner; attempt.completed = true; attempt.phase = 'complete'; lastCode = null; detach(attempt); return owner;
      }
      if (attempt.popupClosed) { attempt.phase = 'popup-closed'; throw error('qa_oauth_popup_closed'); }
      if (attempt.finishStatus === 200) {
        attempt.finishCode = nativeOAuthFinishCode(await inspectFinish(attempt.popup).catch(() => null));
        if (attempt.finishCode && !['finish_pending', 'finish_connected'].includes(attempt.finishCode)) {
          attempt.phase = 'finish-refused'; throw error('qa_oauth_finish_refused');
        }
      }
      if (Date.now() >= deadline) throw error('qa_oauth_pending');
      await new Promise(resolve => { const timer = setTimeout(() => { if (attempt.wake === wake) attempt.wake = null; resolve(); }, Math.min(1000, deadline - Date.now()));
        const wake = () => { clearTimeout(timer); resolve(); }; attempt.wake = wake; });
    }
    throw error('qa_oauth_closed');
  }
  const api = Object.freeze({
    status() { return { kind: 'native_qa_oauth', phase: current?.phase || 'not-started', busy: !!running, complete: !!completeOwner,
      attempts: attempts.length, registrationAttempted, hasOriginalCredential: !!originalCredentialId, hasPasskey: !!getPasskey(),
      callbackStatus: current?.callbackStatus || null, callbackCode: current?.callbackCode || null,
      startStatus: current?.startStatus || null,
      verifyStatus: current?.verifyStatus || null, finishStatus: current?.finishStatus || null, finishCode: current?.finishCode || null,
      claimStatus: current?.claimStatus || null, claimRequests: current?.claimRequests || 0, code: lastCode,
      popupOpen: !!current?.popup && !current.popupClosed, canRetrySameOwner: !!canRetry(),
      successfulClaims: attempts.filter(value => value.completed).length, failedCeremonies: attempts.filter(value => value.superseded).length,
      history: attempts.map(value => ({ mode: value.register ? 'register' : 'same-owner-signin', phase: value.phase,
        verifyStatus: value.verifyStatus, callbackStatus: value.callbackStatus, callbackCode: value.callbackCode,
        finishStatus: value.finishStatus, finishCode: value.finishCode, claimStatus: value.claimStatus,
        claimRequests: value.claimRequests, complete: value.completed, explicitlySuperseded: value.superseded })) }; },
    run() {
      if (closed) return Promise.reject(error('qa_oauth_closed'));
      if (running) return running;
      if (completeOwner) return Promise.resolve(completeOwner);
      lastCode = null;
      running = (async () => {
        ensure(!closed, 'qa_oauth_closed');
        if (retryApproved) {
          retryApproved = false; const previous = current;
          ensure(!previous.invalid && previous.jobs.size === 0 && previous.callbackStatus >= 400 && previous.claimRequests === 0
            && previous.verifySucceeded && previous.redirectHash === previous.callbackHash && registrationReady(), 'qa_oauth_retry_refused');
          if (!previous.popupClosed) await previous.popup.close();
          // Closing may flush an already-sent claim/request or a pending
          // response observer. Revalidate AFTER that await, before another
          // ceremony can overwrite the browser's one-use cookie/handoff.
          await Promise.all([...previous.jobs]);
          ensure(!previous.invalid && previous.jobs.size === 0 && previous.popupClosed && previous.callbackStatus >= 400 && previous.claimRequests === 0
            && previous.verifySucceeded && previous.redirectHash === previous.callbackHash && registrationReady(), 'qa_oauth_retry_refused');
          detach(previous); previous.superseded = true; await launch();
        } else if (!current) await launch();
        return wait();
      })().catch(cause => { lastCode = nativeOAuthFailureCode(cause) || 'qa_oauth_response_refused'; throw error(lastCode); })
        .finally(() => { running = null; });
      return running;
    },
    requestSameOwnerRetry() { ensure(canRetry(), 'qa_oauth_retry_refused'); retryApproved = true; },
    audit(starts, claims) {
      return !!completeOwner && starts.length === attempts.length && claims.length === 1
        && attempts.every((attempt, index) => attempt.pkce && attempt.verifySucceeded && attempt.redirectHash === attempt.callbackHash
          && starts[index] === attempt.startAuthorization
          && (attempt.completed ? attempt.claimStatus === 200 && attempt.claimRequests === 1 && claims[0] === attempt.claimAuthorization
            : attempt.superseded && attempt.callbackStatus >= 400 && attempt.claimRequests === 0));
    },
    close() { closed = true; if (current) { detach(current); changed(current); } },
  });
  return api;
}

const codes = new Set(['qa_oauth_configuration', 'qa_oauth_passkey_required', 'qa_oauth_registration_provenance', 'qa_oauth_response_refused',
  'qa_oauth_owner_mismatch', 'qa_oauth_callback_provenance', 'qa_oauth_claim_provenance', 'qa_oauth_start_provenance',
  'qa_registration_retry_refused', 'qa_oauth_callback_refused', 'qa_oauth_claim_refused', 'qa_oauth_popup_closed',
  'qa_oauth_finish_refused', 'qa_oauth_pending', 'qa_oauth_closed', 'qa_oauth_retry_refused', 'qa_oauth_popup_mismatch']);
export const nativeOAuthFailureCode = cause => codes.has(cause?.code) ? cause.code : null;
export function nativeOAuthPrivacy(controllers, observations) {
  if (controllers.length !== 2) return false;
  let starts = 0, claims = 0;
  for (const controller of controllers) {
    const status = controller.status();
    if (!controller.audit(observations.startAuthorization.slice(starts, starts + status.attempts),
      observations.claimAuthorization.slice(claims, claims + 1))) return false;
    starts += status.attempts; claims++;
  }
  return observations.startAuthorization.length === starts && observations.claimAuthorization.length === claims;
}
