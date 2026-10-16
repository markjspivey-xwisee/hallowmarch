import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareNativeOAuthRedirectCapture, nativeOAuthCaptureCode } from './native-oauth-redirect-capture.mjs';

const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example', state = 's'.repeat(43);
async function fixture() {
  let binding, installed; const receipts = [], frame = { url: () => relayOrigin + '/authorize' };
  const popup = { mainFrame: () => frame, async waitForURL(predicate) { assert(predicate(new URL(frame.url()))); },
    async exposeBinding(name, callback) { binding = callback; }, async evaluate(fn, value) { installed = value; } };
  await prepareNativeOAuthRedirectCapture(popup, { gameOrigin, relayOrigin, state, onReceipt: value => receipts.push(value) });
  const value = () => ({ captureId: installed.captureId, code: 'capture_complete', status: 200,
    redirectHash: createHash('sha256').update('fixture-public-digest').digest('hex') });
  return { popup, frame, receipts, installed, value, binding: (source, value) => binding(source, value) };
}
test('capture accepts only its exact popup/main-frame/relay/attempt and emits no raw URL or code', async () => {
  const f = await fixture(); f.binding({ page: f.popup, frame: f.frame }, f.value());
  assert.deepEqual(Object.keys(f.receipts[0]).sort(), ['code', 'redirectHash', 'status']);
  assert.equal(f.receipts[0].code, 'capture_complete');
  assert(!JSON.stringify(f.receipts).includes('https:')); assert(!JSON.stringify(f.receipts).includes(state));
  assert.throws(() => f.binding({ page: f.popup, frame: f.frame }, f.value()), { code: 'qa_oauth_capture_refused' });
  assert.equal(f.receipts.at(-1).code, 'capture_duplicate');
});
test('foreign page/frame/origin and stale or malformed receipts are rejected', async () => {
  for (const kind of ['page', 'frame', 'origin', 'stale', 'extra', 'hash', 'code']) {
    const f = await fixture(), source = { page: f.popup, frame: f.frame }, value = f.value();
    if (kind === 'page') source.page = {};
    if (kind === 'frame') source.frame = { url: f.frame.url };
    if (kind === 'origin') f.frame.url = () => 'https://foreign.example/authorize';
    if (kind === 'stale') value.captureId = 'foreign-attempt';
    if (kind === 'extra') value.rawRedirect = 'NEVER_LOG';
    if (kind === 'hash') value.redirectHash = 'NEVER_LOG';
    if (kind === 'code') value.code = 'NEVER_LOG';
    assert.throws(() => f.binding(source, value), { code: 'qa_oauth_capture_refused' });
    assert(!JSON.stringify(f.receipts).includes('NEVER_LOG')); assert(!JSON.stringify(f.receipts).includes('foreign.example'));
  }
  assert.equal(nativeOAuthCaptureCode('NEVER_LOG'), null);
});
