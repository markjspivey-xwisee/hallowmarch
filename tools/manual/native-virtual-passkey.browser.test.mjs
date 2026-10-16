/** Actual Chromium WebAuthn counters; the HTTPS page is intercepted locally. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createNativeQaPasskey } from './native-virtual-passkey.mjs';

test('actual Chromium preserves one resident passkey counter across fresh contexts and reproduces stale-copy rejection',
  { skip: !process.env.HM_PLAYWRIGHT_MODULE, timeout: 30000 }, async () => {
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined });
const keeper = createNativeQaPasskey(), contexts = [];
const origin = 'https://relay.example';
async function page() {
  const context = await browser.newContext(); contexts.push(context);
  await context.route('**/*', async route => {
    if (route.request().url() !== origin + '/') return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Offline passkey counter test</title>' });
  });
  const result = await context.newPage(); await result.goto(origin + '/');
  return { page: result, context };
}
async function register(current) {
  return current.evaluate(async () => {
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { id: 'relay.example', name: 'Offline QA' },
      user: { id: new Uint8Array([1, 3, 5, 7]), name: 'synthetic-counter-test', displayName: 'Synthetic counter test' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 5000,
      attestation: 'none',
    } });
    return { id: credential.id, resident: credential.type === 'public-key' };
  });
}
async function authenticate(current) {
  return current.evaluate(async () => {
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: 'relay.example',
      userVerification: 'required', timeout: 5000,
    } });
    const data = credential.response.authenticatorData;
    return { id: credential.id, counter: new DataView(data).getUint32(33, false) };
  });
}
async function staleAuthenticator(current, credential) {
  const client = await current.context().newCDPSession(current); await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await client.send('WebAuthn.addCredential', { authenticatorId, credential });
}
try {
  const first = await page(), firstAuthenticator = await keeper.attach(first.page, { register: true });
  const registered = await register(first.page); assert.equal(registered.resident, true);
  await firstAuthenticator.sync();
  const initial = keeper.credential();
  assert.equal(!!initial?.privateKey && initial.isResidentCredential === true, true, 'a real resident key is retained in RAM');
  assert.equal(Number.isSafeInteger(initial.signCount), true);
  const matches = value => value.credentialId === initial.credentialId && value.privateKey === initial.privateKey
    && value.rpId === initial.rpId && value.userHandle === initial.userHandle;
  let last = initial.signCount;
  const accepted = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = attempt === 0 ? first : await page();
    const authenticator = attempt === 0 ? firstAuthenticator : await keeper.attach(current.page);
    const assertion = await authenticate(current.page); await authenticator.sync();
    const retained = keeper.credential();
    assert.equal(assertion.id === registered.id, true, 'every assertion uses the original credential');
    assert.equal(matches(retained), true, 'moving between authenticators preserves the exact key and owner fields');
    assert.equal(assertion.counter > last, true, 'actual authenticatorData exceeds the prior backend counter');
    assert.equal(retained.signCount, assertion.counter, 'the copied credential retains the actual assertion counter');
    last = assertion.counter; accepted.push(last); await current.context.close();
  }
  assert.deepEqual(accepted, [1, 2, 3].map(offset => initial.signCount + offset));
  // Reproduce the old stale-snapshot defect with the same real key. A strict
  // WebAuthn backend correctly refuses this non-increasing assertion counter.
  const stale = await page(); await staleAuthenticator(stale.page, initial);
  const rejected = await authenticate(stale.page);
  assert.equal(rejected.id === registered.id, true);
  assert.equal(rejected.counter <= last, true, 'a stale clone fails the normal backend monotonic-counter check');
  assert.equal(rejected.counter, initial.signCount + 1); await stale.context.close();
} finally {
  keeper.close(); await Promise.allSettled(contexts.map(context => context.close())); await browser.close();
}
});
