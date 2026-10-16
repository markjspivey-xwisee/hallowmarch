import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRetainedNativeOAuth, retainedNativeOAuthPopup, nativeOAuthCredentialUserId, nativeOAuthFinishCode, nativeOAuthFailureCode, nativeOAuthPrivacy } from './native-oauth-ceremony.mjs';

const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
const id = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA';
const credential = { credentialId: Buffer.from(id, 'base64url').toString('base64'), privateKey: 'RAM_ONLY_NOT_LOGGED', isResidentCredential: true };
const owner = { userId: 'u-pk-eb9f16800c90', subjectDid: 'did:web:identity.example:users:u-pk-eb9f16800c90',
  podUrl: 'https://pods.example/u-pk-eb9f16800c90/', accountId: 'qa-original-account' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const counts = { starts: 0, proofs: 0, registrations: 0, closes: 0, ownerReads: 0 }, popups = [], intents = [];
  let heldKey = credential, deferred = null, observations = { startAuthorization: [], claimAuthorization: [] };
  function response(popup, path, { status = 200, body = {}, method = 'GET', requestBody, authorization, query = '' } = {}) {
    const url = (path === '/oauth/verify' ? relayOrigin : gameOrigin) + path + query;
    const request = { url: () => url, method: () => method, postData: () => requestBody ? JSON.stringify(requestBody) : null,
      headers: () => authorization ? { authorization } : {} };
    popup.emit('request', request);
    popup.emit('response', { url: () => url, status: () => status, ok: () => status >= 200 && status < 300,
      json: async () => body, request: () => request });
    if (path === '/gaming/identity/claim') observations.claimAuthorization.push(authorization);
  }
  function finish(popup, state, { callback = 303, callbackState = state, claim = 200, claimAuthorization = 'Bearer game-session', close = true } = {}) {
    response(popup, '/gaming/identity/callback', { status: callback, query: '?code=RAM_ONLY_CODE&state=' + callbackState,
      body: { error: callback >= 400 ? 'identity_binding_timeout' : null } });
    if (callback >= 400) return;
    response(popup, '/gaming/identity/finish');
    if (options.missingClaimResponse) {
      popup.emit('request', { url: () => gameOrigin + '/gaming/identity/claim', method: () => 'POST', headers: () => ({ authorization: 'Bearer game-session' }) });
      return;
    }
    response(popup, '/gaming/identity/claim', { status: claim, method: 'POST', authorization: claimAuthorization });
    if (close) popup.close();
  }
  const controller = createRetainedNativeOAuth({ register: options.register ?? true, gameOrigin, relayOrigin,
    expectedOwner: options.register === false ? owner : null, getPasskey: () => heldKey, timeoutMs: options.timeoutMs || 30,
    async start({ onPopup }) {
      counts.starts++; const popup = new EventEmitter(); popup.closed = false;
      popup.close = async () => { if (!popup.closed) {
        if (options.closeEmitsClaim && counts.starts === 1) {
          await tick();
          popup.emit('request', { url: () => gameOrigin + '/gaming/identity/claim', method: () => 'POST', headers: () => ({ authorization: 'Bearer game-session' }) });
        }
        popup.closed = true; counts.closes++; popup.emit('close');
      } };
      popups.push(popup); onPopup(popup);
      const state = 's'.repeat(42) + counts.starts, authorize = new URL(relayOrigin + '/authorize');
      for (const [key, value] of Object.entries({ scope: 'mcp:write', response_type: 'code', code_challenge_method: 'S256',
        code_challenge: 'c'.repeat(43), state, redirect_uri: gameOrigin + '/gaming/identity/callback' })) authorize.searchParams.set(key, value);
      popup.state = state; observations.startAuthorization.push('Bearer game-session');
      return { popup, startStatus: 200, startAuthorization: 'Bearer game-session',
        advertised: { ownerPodWriteAccess: true, authorizationUrl: authorize.href } };
    },
    async prove(popup, intent) {
      counts.proofs++; intents.push(intent); if (intent.register) counts.registrations++;
      response(popup, '/oauth/verify', { method: 'POST', body: { redirect: gameOrigin + '/gaming/identity/callback?code=RAM_ONLY_CODE&state=' + popup.state },
        requestBody: { pending_id: 'a'.repeat(32), method: intent.register ? 'webauthn-register' : 'webauthn-authenticate',
          response: { id: options.foreignCredential ? 'dW5yZWxhdGVk' : id, rawId: options.foreignCredential ? 'dW5yZWxhdGVk' : id } } });
      if (options.pending && counts.starts === 1) { deferred = () => finish(popup, popup.state); return; }
      finish(popup, popup.state, { callback: options.callbackFailure && counts.starts === 1 ? 504 : 303,
        callbackState: options.wrongState ? 'foreign-state' : popup.state,
        claimAuthorization: options.foreignClaim ? 'Bearer FOREIGN_NOT_LOGGED' : 'Bearer game-session' });
    },
    async verifyOwner() { counts.ownerReads++; return options.foreignOwner ? { ...owner, userId: 'u-pk-000000000000' } : owner; },
    inspectFinish: async () => 'Finishing your identity connection…',
  });
  return { controller, counts, popups, intents, observations, finish: () => deferred(), loseKey() { heldKey = null; } };
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
  assert.equal(second.counts.registrations, 0); assert.equal(second.intents[0].userId, owner.userId);
});
test('finish and error diagnostics accept fixed known strings only', () => {
  assert.equal(nativeOAuthFinishCode('The sign-in window expired. Return to the game and connect again.'), 'finish_expired');
  assert.equal(nativeOAuthFinishCode('secret arbitrary error'), null);
  assert.equal(nativeOAuthFailureCode({ code: 'qa_oauth_callback_refused' }), 'qa_oauth_callback_refused');
  assert.equal(nativeOAuthFailureCode({ code: 'qa_oauth_SECRET' }), null);
});
