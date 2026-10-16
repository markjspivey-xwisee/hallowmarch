/** Install only in the explicitly owned QA popup. No network or credential calls. */
export function installNativeOAuthProofDiagnostics({ identityOrigin } = {}) {
  const refused = () => { throw Object.assign(new Error('Manual OAuth proof diagnostics unavailable.'), { code: 'qa_oauth_proof_diagnostics_unavailable' }); };
  let identity; try { identity = new URL(identityOrigin); } catch { refused(); }
  if (identity.protocol !== 'https:' || identity.origin !== identityOrigin) refused();
  const page = window;
  if (page.__hmNativeProofDiagnostics?.status) return page.__hmNativeProofDiagnostics.status();
  if (typeof page.fetch !== 'function' || typeof page.navigator?.credentials?.get !== 'function') refused();
  const nativeFetch = page.fetch, credentials = page.navigator.credentials, nativeGet = credentials.get;
  const allowedErrors = new Set(['NotAllowedError', 'AbortError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'UnknownError']);
  let challengeRequests = 0, challenges = 0, challengeStatus = null, pendingCredentials = 0, credentialError = null;
  const selected = (input, init) => {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, page.location.href);
      return url.origin === identity.origin && url.pathname === '/challenges' && !url.search && !url.hash
        && !url.username && !url.password && String(init?.method ?? input?.method ?? 'GET').toUpperCase() === 'POST';
    } catch { return false; }
  };
  const settleBody = async response => {
    // Observe a clone without parsing, retaining or changing any body bytes.
    // A stalled body remains in flight even after its HTTP headers arrive.
    const reader = response.clone().body?.getReader();
    if (!reader) return;
    try { for (;;) { if ((await reader.read()).done) break; } }
    finally { reader.releaseLock(); }
  };
  page.fetch = async function(input, init) {
    if (!selected(input, init)) return Reflect.apply(nativeFetch, this, [input, init]);
    challengeRequests = Math.min(16, challengeRequests + 1); challenges++; challengeStatus = null;
    let response;
    try { response = await Reflect.apply(nativeFetch, this, [input, init]); }
    catch (error) { challenges--; throw error; }
    challengeStatus = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : null;
    let observer;
    try { observer = settleBody(response); }
    catch { return response; }
    void observer.then(() => { challenges--; }, () => { challenges--; });
    return response;
  };
  credentials.get = function(...args) {
    pendingCredentials++; credentialError = null;
    const reject = error => { pendingCredentials--; credentialError = allowedErrors.has(error?.name) ? error.name : 'UnknownError'; throw error; };
    let result; try { result = Reflect.apply(nativeGet, this, args); } catch (error) { return reject(error); }
    return Promise.resolve(result).then(value => { pendingCredentials--; return value; }, reject);
  };
  const status = () => {
    const elements = ['uid-status', 'pk-status'].map(id => page.document.getElementById(id)).filter(Boolean);
    const errors = elements.filter(element => element.classList.contains('err'));
    let uiCode = 'idle';
    if (errors.length) {
      if (challengeStatus >= 400 || errors.some(element => ['No passkey is registered for that identifier',
        'No passkeys are registered for that userId.', 'Could not read this account just now', 'no challenge'].includes(element.textContent.trim()))) uiCode = 'challenge_refused';
      else if (credentialError) uiCode = 'browser_refused';
      else uiCode = 'unknown_error';
    } else if (elements.some(element => element.textContent.trim() === 'Waiting for passkey...')) uiCode = 'waiting_passkey';
    else if (elements.some(element => element.textContent.trim().startsWith('Requesting challenge'))) uiCode = 'challenge_requested';
    const buttons = Array.from(page.document.querySelectorAll('button'));
    return { challengeRequests, challengeInFlight: challenges > 0, challengeStatus, credentialInFlight: pendingCredentials > 0,
      credentialError, uiCode, uidFieldPresent: !!page.document.getElementById('uid-userid'),
      signInPresent: buttons.some(button => button.textContent.trim() === 'Sign in') };
  };
  Object.defineProperty(page, '__hmNativeProofDiagnostics', { value: Object.freeze({ status }), configurable: true });
  return status();
}
