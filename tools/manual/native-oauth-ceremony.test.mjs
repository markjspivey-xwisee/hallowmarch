import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createRetainedNativeOAuth, retainedNativeOAuthPopup, verifyNativeOAuthStartAccount, nativeOAuthCredentialUserId, nativeOAuthFinishCode, nativeOAuthFailureCode, nativeOAuthPrivacy } from './native-oauth-ceremony.mjs';
import vm from 'node:vm';

const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
const id = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const credential = { credentialId: Buffer.from(id, 'base64url').toString('base64'), privateKey: 'RAM_ONLY_NOT_LOGGED', isResidentCredential: true };
const owner = { userId: 'u-pk-eb9f16800c90', subjectDid: 'did:web:identity.example:users:u-pk-eb9f16800c90',
  podUrl: 'https://pods.example/u-pk-eb9f16800c90/', accountId: 'qa-original-account' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const counts = { starts: 0, proofs: 0, registrations: 0, closes: 0, ownerReads: 0 }, popups = [], intents = [];
  let heldKey = options.initialCredential ?? (options.register === false ? credential : null), deferred = null,
    observations = { startAuthorization: [], claimAuthorization: [] };
  const accountChecks = [], failedAccountChecks = new Set();
  const setup = { captures: 0, proofAttachments: 0 };
  function response(popup, path, { status = 200, body = {}, method = 'GET', requestBody, authorization, query = '' } = {}) {
    const url = (path === '/oauth/verify' ? relayOrigin : gameOrigin) + path + query;
    const request = { url: () => url, method: () => method, postData: () => requestBody ? JSON.stringify(requestBody) : null,
      headers: () => authorization ? { authorization } : {} };
    popup.emit('request', request);
    popup.emit('response', { url: () => url, status: () => status, ok: () => status >= 200 && status < 300,
      json: async () => {
        if (path === '/oauth/verify' && options.nodeBodyUnavailable) throw Error('Protocol response body unavailable');
        if (path === '/oauth/verify' && options.nodeJsonMalformed) throw new SyntaxError('FIXTURE_NOT_LOGGED');
        return body;
      }, request: () => request });
    if (path === '/gaming/identity/claim') observations.claimAuthorization.push(authorization);
  }
  function finish(popup, state, { callback = 303, callbackState = state, claim = 200, claimAuthorization = popup.authorization, close = true } = {}) {
    response(popup, '/gaming/identity/callback', { status: callback, query: '?code=RAM_ONLY_CODE&state=' + callbackState,
      body: { error: callback >= 400 ? 'identity_binding_timeout' : null } });
    if (callback >= 400) return;
    response(popup, '/gaming/identity/finish');
    if (options.missingClaimResponse) {
      popup.emit('request', { url: () => gameOrigin + '/gaming/identity/claim', method: () => 'POST', headers: () => ({ authorization: popup.authorization }) });
      return;
    }
    response(popup, '/gaming/identity/claim', { status: claim, method: 'POST', authorization: claimAuthorization });
    if (close) popup.close();
  }
  const controller = createRetainedNativeOAuth({ register: options.register ?? true, gameOrigin, relayOrigin,
    expectedOwner: options.register === false ? owner : null, getPasskey: () => heldKey, timeoutMs: options.timeoutMs || 30,
    async prepareCapture(popup, { onReceipt }) { setup.captures++; popup.captureReceipt = onReceipt;
      if (options.captureGateAtStart === counts.starts) await options.setupGate;
      if (options.captureInstallFailureAt === counts.starts) throw Error('PRIVATE capture install failed after attachment'); },
    async prepareProof() { setup.proofAttachments++;
      if (options.proofGateAtStart === counts.starts) await options.setupGate; },
    async verifyStartAccount({ gameOrigin: suppliedOrigin, startAuthorization }) {
      assert.equal(suppliedOrigin, gameOrigin); assert.equal(startAuthorization, popups.at(-1).authorization);
      accountChecks.push(startAuthorization);
      if (options.accountGateAtCheck === accountChecks.length) await options.accountGate;
      if (options.failStartAccountAt?.includes(counts.starts) && !failedAccountChecks.has(counts.starts)) {
        failedAccountChecks.add(counts.starts); throw Object.assign(Error('PRIVATE account read failure'), { code: 'qa_oauth_start_account_refused' });
      }
      return options.startAccountIds?.[counts.starts - 1] ?? 'qa-initiating-guest';
    },
    async start({ onPopup }) {
      counts.starts++; const popup = new EventEmitter(); popup.closed = false;
      popup.close = async () => { if (!popup.closed) {
        if ((options.closeEmitsClaim && counts.starts === 1) || options.closeEmitsClaimAt === counts.starts) {
          await tick();
          popup.emit('request', { url: () => gameOrigin + '/gaming/identity/claim', method: () => 'POST', headers: () => ({ authorization: popup.authorization }) });
        }
        if (options.closeEmitsProofAt === counts.starts) popup.emit('request', {
          url: () => relayOrigin + '/oauth/verify', method: () => 'POST' });
        popup.closed = true; counts.closes++; popup.emit('close');
      } };
      popups.push(popup); onPopup(popup);
      const state = 's'.repeat(42) + counts.starts, authorize = new URL(relayOrigin + '/authorize');
      for (const [key, value] of Object.entries({ scope: 'mcp:write', response_type: 'code', code_challenge_method: 'S256',
        code_challenge: 'c'.repeat(43), state, redirect_uri: gameOrigin + '/gaming/identity/callback' })) authorize.searchParams.set(key, value);
      popup.state = state; popup.authorization = options.rotateBearer ? 'Bearer game-session-' + counts.starts : 'Bearer game-session';
      observations.startAuthorization.push(popup.authorization);
      return { popup, startStatus: 200, startAuthorization: popup.authorization,
        advertised: { ownerPodWriteAccess: true, authorizationUrl: authorize.href } };
    },
    async prove(popup, intent) {
      counts.proofs++; intents.push({ register: intent.register, userId: intent.userId }); if (intent.register) counts.registrations++;
      if (options.proofStep) intent.onStep(options.proofStep);
      if (options.proveError || options.proveErrorAt === counts.starts) throw options.proveError || Error('PRIVATE proof failure');
      if (intent.register) heldKey = credential;
      const redirect = gameOrigin + '/gaming/identity/callback?code=RAM_ONLY_CODE&state=' + popup.state;
      const captured = () => popup.captureReceipt({ code: options.badCapture ? 'DO_NOT_LOG' : 'capture_complete', status: 200,
        redirectHash: options.mismatchedCapture ? 'f'.repeat(64) : createHash('sha256').update(redirect).digest('hex') });
      if (options.captureFirst) captured();
      response(popup, '/oauth/verify', { method: 'POST', status: options.verifyStatus ?? 200, body: options.verifyBody ?? { redirect },
        requestBody: { pending_id: 'a'.repeat(32), method: intent.register ? 'webauthn-register' : 'webauthn-authenticate',
          response: { id: options.foreignCredential ? 'dW5yZWxhdGVk' : id, rawId: options.foreignCredential ? 'dW5yZWxhdGVk' : id } } });
      if (options.capture && !options.captureFirst) captured();
      if (options.duplicateCapture) captured();
      if (options.verifyStatus && options.verifyStatus !== 200) return;
      if (options.pending && counts.starts === 1) { deferred = () => finish(popup, popup.state); return; }
      finish(popup, popup.state, { callback: options.callbackFailure && counts.starts === 1 ? 504 : 303,
        callbackState: options.wrongState ? 'foreign-state' : popup.state,
        claimAuthorization: options.foreignClaim ? 'Bearer FOREIGN_NOT_LOGGED' : popup.authorization });
    },
    async verifyOwner() { counts.ownerReads++; if (options.ownerGate) await options.ownerGate;
      return options.foreignOwner ? { ...owner, userId: 'u-pk-000000000000' } : owner; },
    inspectFinish: async () => 'Finishing your identity connection…',
    inspectProof: options.inspectProof || (async () => options.proofDiagnostics || null),
  });
  return { controller, counts, popups, intents, observations, accountChecks, setup, finish: () => deferred(), loseKey() { heldKey = null; },
    changeKey() { heldKey = { ...credential, credentialId: Buffer.from('foreign-fixture-key').toString('base64') }; },
    queueReadObservation() { response(popups.at(-1), '/unrelated-read'); } };
}

test('QA consistency derivation matches the native frozen string-hash vector', () => {
  assert.equal(nativeOAuthCredentialUserId(id), owner.userId);
  assert.throws(() => nativeOAuthCredentialUserId('bad id'), { code: 'qa_oauth_registration_provenance' });
});
test('success requires one real-shaped relay proof, callback, claim and authenticated owner result', async () => {
  const f = fixture(); assert.deepEqual(await f.controller.run(), owner);
  assert.equal(f.controller.status().successfulClaims, 1); assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), true);
  await f.controller.run(); assert.deepEqual(f.counts, { starts: 1, proofs: 1, registrations: 1, closes: 1, ownerReads: 1 });
  const text = JSON.stringify(f.controller.status());
  for (const secret of ['RAM_ONLY', id, owner.userId, 'https:', 'Bearer', 'FOREIGN']) assert(!text.includes(secret));
});
test('a timeout resumes the original pending popup without another proof, start or registration', async () => {
  const f = fixture({ pending: true }); await assert.rejects(f.controller.run(), { code: 'qa_oauth_pending' });
  assert.equal(f.controller.status().canRetrySameOwner, false);
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' });
  const resumed = f.controller.run(); await tick(); f.finish(); assert.deepEqual(await resumed, owner);
  assert.equal(f.popups.length, 1); assert.equal(f.counts.proofs, 1); assert.equal(f.counts.registrations, 1);
});
test('an exact native verification refusal fails promptly without a callback, claim or replacement ceremony', async () => {
  const f = fixture({ register: false, verifyStatus: 401, timeoutMs: 180000 });
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_native_proof_refused' });
  const report = f.controller.status();
  assert.equal(report.verifyStatus, 401); assert.equal(report.phase, 'native-proof-refused');
  assert.equal(report.claimRequests, 0); assert.equal(report.callbackStatus, null); assert.equal(report.canRetrySameOwner, false);
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' });
  assert.equal(f.counts.starts, 1); assert.equal(f.counts.registrations, 0); f.controller.close();
});
test('the first fresh-browser sign-in is usernameless while the resulting owner still must match exactly', async () => {
  const f = fixture({ register: false }); await f.controller.run();
  assert.deepEqual(f.intents, [{ register: false, userId: null }]);
  assert.equal(f.counts.registrations, 0); assert.equal(f.counts.ownerReads, 1);
  const foreign = fixture({ register: false, foreignOwner: true });
  await assert.rejects(foreign.controller.run(), { code: 'qa_oauth_owner_mismatch' }); foreign.controller.close();
});
test('pre-verification failures retain only fixed proof steps, error codes and sanitized provider diagnostics', async () => {
  const f = fixture({ register: false, timeoutMs: 10, proofStep: 'signin-click', proveError: new Error('PRIVATE raw selector URL'),
    proofDiagnostics: { challengeRequests: 1, challengeStatus: 503, challengeInFlight: false, credentialInFlight: false,
      credentialError: 'PRIVATE', uiCode: 'challenge_refused', uidFieldPresent: true, signInPresent: true, privateKey: 'PRIVATE' } });
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_pending' });
  const report = await f.controller.diagnose();
  assert.equal(report.proofStep, 'signin-click'); assert.equal(report.proveCode, 'qa_oauth_proof_failed');
  assert.equal(report.verifyRequests, 0); assert.equal(report.proofDiagnostics.challengeStatus, 503);
  assert.equal(report.proofDiagnostics.credentialError, null); assert.equal(report.proofDiagnostics.uiCode, 'challenge_refused');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.equal(report.canRetrySameOwner, false, 'a pre-proof failure cannot use the callback-only retry port');
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' }); f.controller.close();
});
test('a Playwright timeout stays distinguishable without exposing its exception text', async () => {
  const f = fixture({ register: false, timeoutMs: 10, proofStep: 'passkey-event',
    proveError: Object.assign(new Error('PRIVATE timeout selector'), { name: 'TimeoutError' }) });
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_pending' });
  const report = f.controller.status(); assert.equal(report.proveCode, 'qa_oauth_browser_timeout');
  assert.equal(report.proofStep, 'passkey-event'); assert.equal(JSON.stringify(report).includes('PRIVATE'), false); f.controller.close();
});
test('stalled provider diagnostics are bounded and cannot queue repeated browser reads', async t => {
  let reads = 0;
  const f = fixture({ pending: true, timeoutMs: 10, inspectProof: () => { reads++; return new Promise(() => {}); } });
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_pending' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const diagnosis = f.controller.diagnose(); await tick(); t.mock.timers.tick(2000);
  assert.equal((await diagnosis).diagnosticTimedOut, true); assert.equal(reads, 1);
  assert.equal((await f.controller.diagnose()).diagnosticTimedOut, true); assert.equal(reads, 1); f.controller.close();
});
test('definitive callback failure permits only an explicit same-passkey usernameless sign-in', async () => {
  const f = fixture({ callbackFailure: true }); await assert.rejects(f.controller.run(), { code: 'qa_oauth_callback_refused' });
  const report = f.controller.status(); assert.equal(report.callbackStatus, 504); assert.equal(report.callbackCode, 'identity_binding_timeout');
  assert.equal(report.claimRequests, 0); assert.equal(report.canRetrySameOwner, true);
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_callback_refused' }); assert.equal(f.counts.starts, 1);
  f.controller.requestSameOwnerRetry(); assert.deepEqual(await f.controller.run(), owner);
  assert.equal(f.counts.registrations, 1); assert.equal(f.counts.starts, 2); assert.equal(f.popups[0].closed, true);
  assert.deepEqual(f.intents[1], { register: false, userId: null });
  assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), true);
  assert.equal(f.controller.status().failedCeremonies, 1);
});
test('a rotated start bearer is accepted only after exact-bearer verification of the same initiating account', async () => {
  const f = fixture({ callbackFailure: true, rotateBearer: true }); await assert.rejects(f.controller.run());
  f.controller.requestSameOwnerRetry(); assert.deepEqual(await f.controller.run(), owner);
  assert.notEqual(f.observations.startAuthorization[0], f.observations.startAuthorization[1]);
  assert.deepEqual(f.accountChecks, f.observations.startAuthorization);
  assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), true);
  assert.equal(f.counts.registrations, 1); assert.equal(f.counts.proofs, 2);
});
test('a switched initiating game account is rejected before another proof even with the original resident passkey', async () => {
  const f = fixture({ callbackFailure: true, rotateBearer: true, startAccountIds: ['first-guest', 'another-guest'] });
  await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry();
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_start_account_mismatch' });
  assert.equal(f.counts.proofs, 1); assert.equal(f.counts.registrations, 1); assert.equal(f.controller.status().complete, false);
  assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), false); f.controller.close();
});
test('per-attempt claim bearer equality remains strict after independently verified token rotation', async () => {
  const f = fixture({ callbackFailure: true, rotateBearer: true, foreignClaim: true });
  await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry();
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_claim_provenance' });
  assert.equal(f.controller.status().complete, false); f.controller.close();
});
test('an explicit unproved-start restart retains the original registered passkey and accounts for its cancelled start', async () => {
  const f = fixture({ callbackFailure: true, rotateBearer: true, failStartAccountAt: [2] });
  await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry();
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_start_account_refused' });
  assert.equal(f.controller.status().canRestartUnprovedStart, true); assert.equal(f.counts.proofs, 1);
  f.controller.requestUnprovedStartRestart(); assert.deepEqual(await f.controller.run(), owner);
  assert.equal(f.counts.starts, 3); assert.equal(f.counts.proofs, 2); assert.equal(f.counts.registrations, 1);
  assert.equal(f.controller.status().history[1].cancelledUnproved, true);
  assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), true);
});
test('unproved-start restart refuses missing registration, attached proof, lost passkey and a claim racing popup close', async () => {
  const first = fixture({ failStartAccountAt: [1] }); await assert.rejects(first.controller.run());
  assert.throws(() => first.controller.requestUnprovedStartRestart(), { code: 'qa_oauth_unproved_restart_refused' }); first.controller.close();
  const attached = fixture({ callbackFailure: true, proveErrorAt: 2, timeoutMs: 10 }); await assert.rejects(attached.controller.run());
  attached.controller.requestSameOwnerRetry(); await assert.rejects(attached.controller.run());
  assert.throws(() => attached.controller.requestUnprovedStartRestart(), { code: 'qa_oauth_unproved_restart_refused' }); attached.controller.close();
  for (const loseKey of [true, false]) {
    const f = fixture({ callbackFailure: true, failStartAccountAt: [2], closeEmitsClaimAt: loseKey ? undefined : 2 });
    await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry(); await assert.rejects(f.controller.run());
    if (loseKey) { f.loseKey(); assert.throws(() => f.controller.requestUnprovedStartRestart(), { code: 'qa_oauth_unproved_restart_refused' }); }
    else { f.controller.requestUnprovedStartRestart(); await assert.rejects(f.controller.run(), { code: 'qa_oauth_unproved_restart_refused' }); }
    assert.equal(f.counts.starts, 2); assert.equal(f.counts.registrations, 1); f.controller.close();
  }
});
test('unproved-start restart cannot cross pending observer jobs or a native proof arriving while closing', async () => {
  for (const proofDuringClose of [false, true]) {
    const f = fixture({ callbackFailure: true, failStartAccountAt: [2], closeEmitsProofAt: proofDuringClose ? 2 : undefined });
    await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry(); await assert.rejects(f.controller.run());
    if (proofDuringClose) {
      f.controller.requestUnprovedStartRestart(); await assert.rejects(f.controller.run(), { code: 'qa_oauth_unproved_restart_refused' });
      assert.equal(f.controller.status().verifyRequests, 1);
    } else {
      f.queueReadObservation();
      assert.throws(() => f.controller.requestUnprovedStartRestart(), { code: 'qa_oauth_unproved_restart_refused' });
      await tick(); assert.equal(f.controller.status().canRestartUnprovedStart, true);
    }
    assert.equal(f.counts.starts, 2); assert.equal(f.counts.registrations, 1); f.controller.close();
  }
});
test('capture attachment is retained before its await and a partial install can never use unproved-start restart', async () => {
  const f = fixture({ callbackFailure: true, captureInstallFailureAt: 2 });
  await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry();
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_capture_refused' });
  assert.equal(f.controller.status().verifyRequests, 0); assert.equal(f.popups[1].captureReceipt instanceof Function, true);
  assert.equal(f.controller.status().canRestartUnprovedStart, false);
  assert.throws(() => f.controller.requestUnprovedStartRestart(), { code: 'qa_oauth_unproved_restart_refused' });
  assert.equal(f.counts.starts, 2); assert.equal(f.counts.proofs, 1); assert.equal(f.counts.registrations, 1); f.controller.close();
});
test('closing while account verification is pending prevents all later capture/proof/registration work', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ accountGateAtCheck: 1, accountGate: gate }), pending = f.controller.run();
  while (f.accountChecks.length < 1) await tick();
  f.controller.close(); release(); await assert.rejects(pending, { code: 'qa_oauth_closed' });
  assert.equal(f.counts.starts, 1); assert.equal(f.counts.proofs, 0); assert.equal(f.counts.registrations, 0);
  assert.equal(f.setup.captures, 0); assert.equal(f.setup.proofAttachments, 0);
});
test('closing while unproved cancellation verifies its exact bearer cannot start another ceremony', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ callbackFailure: true, failStartAccountAt: [2], accountGateAtCheck: 3, accountGate: gate });
  await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry(); await assert.rejects(f.controller.run());
  f.controller.requestUnprovedStartRestart(); const pending = f.controller.run();
  while (f.accountChecks.length < 3) await tick();
  f.controller.close(); release(); await assert.rejects(pending, { code: 'qa_oauth_closed' });
  assert.equal(f.counts.starts, 2); assert.equal(f.counts.proofs, 1); assert.equal(f.counts.registrations, 1);
});
test('closing during capture or proof attachment never submits a later native proof', async () => {
  for (const during of ['capture', 'proof']) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const f = fixture({ callbackFailure: true, setupGate: gate,
      captureGateAtStart: during === 'capture' ? 2 : undefined, proofGateAtStart: during === 'proof' ? 2 : undefined });
    await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry(); const pending = f.controller.run();
    while (during === 'capture' ? f.setup.captures < 2 : f.setup.proofAttachments < 2) await tick();
    f.controller.close(); release(); await assert.rejects(pending);
    assert.equal(f.counts.starts, 2); assert.equal(f.counts.proofs, 1); assert.equal(f.counts.registrations, 1);
  }
});
test('loss or replacement of the retained passkey during start-account verification stops before capture or proof', async () => {
  for (const fresh of [false, true]) for (const lost of [false, true]) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const f = fixture({ register: fresh ? false : true, callbackFailure: !fresh, accountGateAtCheck: fresh ? 1 : 2, accountGate: gate });
    if (!fresh) { await assert.rejects(f.controller.run()); f.controller.requestSameOwnerRetry(); }
    const pending = f.controller.run(); while (f.accountChecks.length < (fresh ? 1 : 2)) await tick();
    if (lost) f.loseKey(); else f.changeKey(); release();
    await assert.rejects(pending, { code: lost ? 'qa_oauth_passkey_required' : 'qa_oauth_owner_mismatch' });
    assert.equal(f.counts.proofs, fresh ? 0 : 1); assert.equal(f.counts.registrations, fresh ? 0 : 1);
    assert.equal(f.setup.captures, fresh ? 0 : 1); f.controller.close();
  }
});
test('a fresh controller rejects a retained passkey belonging to another expected owner before any start', () => {
  assert.throws(() => fixture({ register: false, initialCredential: { ...credential, credentialId: Buffer.from('foreign-fixture-key').toString('base64') } }),
    { code: 'qa_oauth_owner_mismatch' });
});
test('closing during final owner verification cannot retain or return a successful owner', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ ownerGate: gate }), pending = f.controller.run(); while (f.counts.ownerReads < 1) await tick();
  f.controller.close(); release(); await assert.rejects(pending, { code: 'qa_oauth_closed' });
  assert.equal(f.controller.status().complete, false);
});
test('missing or refusing start-account verification fails closed before any native proof', async () => {
  assert.throws(() => createRetainedNativeOAuth({ register: true, gameOrigin, relayOrigin,
    getPasskey() {}, start() {}, prove() {}, verifyOwner() {} }), { code: 'qa_oauth_configuration' });
  for (const options of [{ startAccountIds: [false] }, { failStartAccountAt: [1] }]) {
    const f = fixture(options); await assert.rejects(f.controller.run(), { code: 'qa_oauth_start_account_refused' });
    assert.equal(f.counts.proofs, 0); assert.equal(f.counts.registrations, 0); f.controller.close();
  }
});
test('browser start-account port sends only the exact observed bearer to the same-origin read endpoint', async () => {
  const calls = [], context = vm.createContext({ location: { origin: gameOrigin }, AbortSignal, Error, Object,
    fetch: async (path, init) => { calls.push({ path, init }); return { ok: true, json: async () => ({ account: { id: 'verified-initiating-account' } }) }; } });
  const verify = vm.runInContext('(' + verifyNativeOAuthStartAccount.toString() + ')', context);
  assert.equal(await verify({ gameOrigin, startAuthorization: 'Bearer EXACT_OBSERVED_START' }), 'verified-initiating-account');
  assert.equal(calls[0].path, '/gaming/identity/status'); assert.equal(calls[0].init.headers.Authorization, 'Bearer EXACT_OBSERVED_START');
  assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.cache, 'no-store'); assert.equal(calls[0].init.method, 'GET');
  context.location.origin = 'https://another.example';
  await assert.rejects(verify({ gameOrigin, startAuthorization: 'Bearer EXACT_OBSERVED_START' }), { code: 'qa_oauth_start_account_refused' });
  assert.equal(calls.length, 1);
});
test('a claim request without its response cannot authorize a replacement ceremony', async () => {
  const f = fixture({ missingClaimResponse: true }); await assert.rejects(f.controller.run(), { code: 'qa_oauth_pending' });
  assert.equal(f.controller.status().claimRequests, 1); assert.equal(f.controller.status().claimStatus, null);
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' });
  assert.equal(f.counts.starts, 1); f.controller.close();
});
test('a claim arriving during popup close prevents a new ceremony before any replacement start', async () => {
  const f = fixture({ callbackFailure: true, closeEmitsClaim: true }); await assert.rejects(f.controller.run(), { code: 'qa_oauth_callback_refused' });
  f.controller.requestSameOwnerRetry(); await assert.rejects(f.controller.run(), { code: 'qa_oauth_retry_refused' });
  assert.equal(f.counts.starts, 1); assert.equal(f.counts.registrations, 1); assert.equal(f.controller.status().claimRequests, 1);
  assert.equal(f.controller.status().canRetrySameOwner, false); f.controller.close();
});
test('losing the original passkey keeps diagnostics available and refuses replacement sign-in', async () => {
  const f = fixture({ callbackFailure: true }); await assert.rejects(f.controller.run()); f.loseKey();
  assert.equal(f.controller.status().canRetrySameOwner, false); assert.equal(f.controller.status().hasPasskey, false);
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' });
  assert.equal(f.counts.starts, 1); f.controller.close();
});
test('popup is retained before a click timeout and the original successful start is resumed', async () => {
  const popup = {}, events = []; let popupResolve;
  const page = {
    waitForEvent: () => new Promise(resolve => { popupResolve = resolve; }),
    waitForResponse: async predicate => { const response = { url: () => gameOrigin + '/gaming/identity/start',
      status: () => 200, request: () => ({ method: () => 'POST', headers: () => ({ authorization: 'Bearer RAM_ONLY' }) }),
      json: async () => ({ ownerPodWriteAccess: true }) }; assert.equal(predicate(response), true); return response; },
    locator: () => ({ first: () => ({ async click() { events.push('click'); popupResolve(popup); await tick();
      assert.deepEqual(events, ['click', 'retained']); throw Error('RAW URL NEVER_LOG'); } }) }),
  };
  const result = await retainedNativeOAuthPopup({ page, gameOrigin, onPopup: value => { assert.equal(value, popup); events.push('retained'); } });
  assert.equal(result.popup, popup); assert.deepEqual(events, ['click', 'retained']); assert.equal(result.startStatus, 200);
});
test('foreign credential, state, claim authorization or verified owner cannot pass', async () => {
  for (const options of [{ foreignCredential: true }, { wrongState: true }, { foreignClaim: true }, { foreignOwner: true }]) {
    const f = fixture(options); await assert.rejects(f.controller.run()); assert.equal(f.controller.status().complete, false);
    assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), false); f.controller.close();
  }
});
test('two successful ceremonies can include a proven failed callback, but no unaccounted start/claim', async () => {
  const first = fixture({ callbackFailure: true }); await assert.rejects(first.controller.run());
  first.controller.requestSameOwnerRetry(); await first.controller.run();
  const second = fixture({ register: false }); await second.controller.run();
  const observations = { startAuthorization: [...first.observations.startAuthorization, ...second.observations.startAuthorization],
    claimAuthorization: [...first.observations.claimAuthorization, ...second.observations.claimAuthorization] };
  assert.equal(nativeOAuthPrivacy([first.controller, second.controller], observations), true);
  assert.equal(nativeOAuthPrivacy([first.controller, second.controller], { ...observations, startAuthorization: [...observations.startAuthorization, 'Bearer UNKNOWN'] }), false);
  assert.equal(nativeOAuthPrivacy([first.controller, second.controller], { ...observations, claimAuthorization: [...observations.claimAuthorization, 'Bearer UNKNOWN'] }), false);
  assert.equal(second.counts.registrations, 0); assert.equal(second.intents[0].userId, null);
});
test('finish and error diagnostics accept fixed known strings only', () => {
  assert.equal(nativeOAuthFinishCode('The sign-in window expired. Return to the game and connect again.'), 'finish_expired');
  assert.equal(nativeOAuthFinishCode('secret arbitrary error'), null);
  assert.equal(nativeOAuthFailureCode({ code: 'qa_oauth_callback_refused' }), 'qa_oauth_callback_refused');
  assert.equal(nativeOAuthFailureCode({ code: 'qa_oauth_SECRET' }), null);
});
test('pre-navigation response hash survives Node body eviction without losing same-owner retry', async () => {
  for (const captureFirst of [false, true]) {
    const f = fixture({ callbackFailure: true, nodeBodyUnavailable: true, capture: true, captureFirst });
    await assert.rejects(f.controller.run(), { code: 'qa_oauth_callback_refused' });
    const status = f.controller.status();
    assert.equal(status.hasOriginalCredential, true); assert.equal(status.canRetrySameOwner, true);
    assert.equal(status.verifyBodyCode, 'verify_body_unavailable'); assert.equal(status.captureCode, 'capture_complete');
    assert.equal(status.redirectEvidence, 'browser-response');
    f.controller.requestSameOwnerRetry(); assert.deepEqual(await f.controller.run(), owner);
    assert.equal(f.counts.registrations, 1); assert.equal(f.controller.audit(f.observations.startAuthorization, f.observations.claimAuthorization), true);
  }
});
test('native HTTP acceptance without either exact response hash cannot authorize a retry', async () => {
  const f = fixture({ callbackFailure: true, nodeBodyUnavailable: true });
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_verify_body_unavailable' });
  assert.equal(f.controller.status().hasOriginalCredential, true); assert.equal(f.controller.status().canRetrySameOwner, false);
  assert.equal(f.controller.status().redirectEvidence, 'unconfirmed');
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' }); f.controller.close();
});
test('mismatched, duplicate or unrecognized captures refuse with fixed diagnostics', async () => {
  for (const options of [{ capture: true, mismatchedCapture: true }, { capture: true, duplicateCapture: true }, { capture: true, badCapture: true }]) {
    const f = fixture(options); await assert.rejects(f.controller.run());
    assert.equal(f.controller.status().complete, false); assert.equal(f.controller.status().canRetrySameOwner, false);
    assert(!JSON.stringify(f.controller.status()).includes('DO_NOT_LOG')); f.controller.close();
  }
});
test('a malformed independently readable native response cannot be rescued by a browser receipt', async () => {
  for (const options of [{ nodeJsonMalformed: true }, { verifyBody: { redirect: 'not-a-url' } },
    { verifyBody: { redirect: gameOrigin + '/gaming/identity/callback?code=OFFLINE&state=foreign' } }]) {
    const f = fixture({ callbackFailure: true, capture: true, ...options }); await assert.rejects(f.controller.run());
    assert.equal(f.controller.status().canRetrySameOwner, false);
    assert.match(f.controller.status().code, /^qa_oauth_verify_(json_invalid|url_refused|state_refused)$/);
    assert(!JSON.stringify(f.controller.status()).includes('FIXTURE_NOT_LOGGED')); f.controller.close();
  }
});
test('late duplicate or superseded receipts invalidate the final privacy audit', async () => {
  const first = fixture({ capture: true }); await first.controller.run();
  assert.equal(first.controller.audit(first.observations.startAuthorization, first.observations.claimAuthorization), true);
  first.popups[0].captureReceipt({ code: 'capture_complete', status: 200, redirectHash: 'a'.repeat(64) });
  assert.equal(first.controller.audit(first.observations.startAuthorization, first.observations.claimAuthorization), false);
  const second = fixture({ callbackFailure: true }); await assert.rejects(second.controller.run());
  second.controller.requestSameOwnerRetry(); await second.controller.run();
  second.popups[0].captureReceipt({ code: 'capture_complete', status: 200, redirectHash: 'a'.repeat(64) });
  assert.equal(second.controller.audit(second.observations.startAuthorization, second.observations.claimAuthorization), false);
});
test('a captured response with an unknown claim result still cannot authorize another sign-in', async () => {
  const f = fixture({ capture: true, nodeBodyUnavailable: true, missingClaimResponse: true });
  await assert.rejects(f.controller.run(), { code: 'qa_oauth_pending' });
  assert.equal(f.controller.status().redirectEvidence, 'browser-response'); assert.equal(f.controller.status().claimRequests, 1);
  assert.equal(f.controller.status().canRetrySameOwner, false);
  assert.throws(() => f.controller.requestSameOwnerRetry(), { code: 'qa_oauth_retry_refused' });
  assert.equal(f.counts.starts, 1); f.controller.close();
});
