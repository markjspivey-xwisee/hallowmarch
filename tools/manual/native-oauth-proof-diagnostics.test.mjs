import assert from 'node:assert/strict';
import test from 'node:test';
import { installNativeOAuthProofDiagnostics } from './native-oauth-proof-diagnostics.mjs';

async function fixture(run) {
  const previous = globalThis.window; let fetchPort = async () => Response.json({ nonce: 'MUST_NOT_CAPTURE' });
  let credentialPort = async () => ({ privateValue: 'MUST_NOT_CAPTURE' });
  const elements = new Map(), calls = [];
  const page = { location: { href: 'https://relay.example/authorize?code=MUST_NOT_CAPTURE' },
    navigator: { credentials: { get(...args) { calls.push(['get', this, ...args]); return credentialPort(...args); } } },
    fetch(...args) { calls.push(['fetch', this, ...args]); return fetchPort(...args); },
    document: { getElementById: id => elements.get(id), querySelectorAll: () => [{ textContent: 'Sign in' }] } };
  globalThis.window = page;
  try { await run({ page, calls, elements, setFetch: value => { fetchPort = value; }, setGet: value => { credentialPort = value; },
    install: () => installNativeOAuthProofDiagnostics({ identityOrigin: 'https://identity.example' }),
    status: () => page.__hmNativeProofDiagnostics.status() }); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}
const tick = () => new Promise(setImmediate);
test('installation is inert and tracks only exact identity challenge POSTs, preserving responses and arguments', async () => fixture(async f => {
  f.install(); assert.equal(f.calls.length, 0);
  const response = Response.json({ nonce: 'MUST_NOT_CAPTURE' }); f.setFetch(async () => response);
  const init = { method: 'POST', body: 'PRIVATE_REQUEST_BODY' };
  assert.equal(await f.page.fetch('https://identity.example/challenges', init), response);
  assert.equal(f.calls[0][1], f.page); assert.equal(f.calls[0][3], init);
  assert.deepEqual(await response.json(), { nonce: 'MUST_NOT_CAPTURE' }); await tick();
  assert.equal(f.status().challengeRequests, 1); assert.equal(f.status().challengeInFlight, false);
  for (const url of ['https://other.example/challenges', 'https://identity.example/challenges?private=x', 'https://identity.example/other']) {
    f.setFetch(async () => Response.json({})); await f.page.fetch(url, init);
  }
  await f.page.fetch('https://identity.example/challenges'); assert.equal(f.status().challengeRequests, 1);
  assert.equal(JSON.stringify(f.status()).includes('MUST_NOT_CAPTURE'), false);
}));
test('headers alone do not settle a stalled challenge body and unknown pending fetch stays in flight', async () => fixture(async f => {
  f.install(); let release;
  f.setFetch(async () => new Response(new ReadableStream({ start(controller) { release = () => controller.close(); } }), { status: 503 }));
  await f.page.fetch('https://identity.example/challenges', { method: 'POST' }); await tick();
  assert.equal(f.status().challengeInFlight, true); assert.equal(f.status().challengeStatus, 503);
  release(); await tick(); await tick(); assert.equal(f.status().challengeInFlight, false);
  f.setFetch(() => new Promise(() => {})); void f.page.fetch('https://identity.example/challenges', { method: 'POST' }); await tick();
  assert.equal(f.status().challengeInFlight, true); assert.equal(f.status().challengeStatus, null);
}));
test('credential results/errors retain identity while status exposes only pending flags and fixed enums', async () => fixture(async f => {
  f.install(); let release; const credential = { privateKey: 'MUST_NOT_CAPTURE' };
  f.setGet(() => new Promise(resolve => { release = resolve; })); const active = f.page.navigator.credentials.get({ publicKey: {} });
  assert.equal(f.status().credentialInFlight, true); release(credential); assert.equal(await active, credential);
  assert.equal(f.status().credentialInFlight, false);
  const refused = new DOMException('https://identity.example/private?key=MUST_NOT_CAPTURE', 'NotAllowedError');
  f.setGet(async () => { throw refused; }); await assert.rejects(f.page.navigator.credentials.get({}), value => value === refused);
  f.elements.set('uid-status', { textContent: 'private arbitrary text MUST_NOT_CAPTURE', classList: { contains: () => true } });
  assert.equal(f.status().credentialError, 'NotAllowedError'); assert.equal(f.status().uiCode, 'browser_refused');
  assert.equal(JSON.stringify(f.status()).includes('MUST_NOT_CAPTURE'), false);
}));
test('challenge UI error classifications exclude user identifiers and raw messages', async () => fixture(async f => {
  f.install(); f.setFetch(async () => Response.json({ error: 'PRIVATE_ACCOUNT' }, { status: 404 }));
  await f.page.fetch('https://identity.example/challenges', { method: 'POST' }); await tick();
  f.elements.set('uid-status', { textContent: 'No passkey is registered for that identifier', classList: { contains: () => true } });
  assert.equal(f.status().uiCode, 'challenge_refused'); assert.equal(f.status().challengeStatus, 404);
  assert.equal(JSON.stringify(f.status()).includes('PRIVATE_ACCOUNT'), false);
}));
