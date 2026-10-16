import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCompanionBrowserRequest } from './native-companion-browser-request.mjs';

test('optional browser public transport rejects credentials/origin swaps before fetching and omits cookies', async () => {
  const previous = { location: globalThis.location, fetch: globalThis.fetch }; let calls = 0;
  globalThis.location = { origin: 'https://game.example' };
  globalThis.fetch = async (url, init) => { calls++; assert.equal(init.credentials, 'omit'); assert.equal(init.headers.Authorization, undefined);
    const response = Response.json({ ok: true, result: { public: true } }); Object.defineProperty(response, 'url', { value: url }); return response; };
  const base = { url: 'https://game.example/gaming/native-agents', init: { method: 'GET', headers: { Accept: 'application/json' },
    credentials: 'omit', cache: 'no-store', redirect: 'error' } };
  try {
    for (const input of [
      { ...base, url: 'https://other.example/read' }, { ...base, url: 'https://game.example/read?token=PRIVATE' },
      { ...base, init: { ...base.init, credentials: 'include' } },
      { ...base, init: { ...base.init, headers: { Authorization: 'Bearer PRIVATE' } } },
      { ...base, init: { ...base.init, method: 'POST', body: JSON.stringify({ accessToken: 'PRIVATE' }) } },
      { ...base, init: { ...base.init, method: 'POST', body: JSON.stringify({ sessionPublicKeyJwk: { kty: 'OKP', d: 'PRIVATE' } }) } },
    ]) await assert.rejects(nativeCompanionBrowserRequest(input));
    assert.equal(calls, 0); const result = await nativeCompanionBrowserRequest(base); assert.equal(result.value.result.public, true); assert.equal(calls, 1);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});
