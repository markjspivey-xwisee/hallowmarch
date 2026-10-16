import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerBrowserAssets } from './player-browser-assets.js';
const handler = createPlayerBrowserAssets();
function request(pathname, method = 'GET') {
  const result = {};
  const handled = handler({ method }, { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(body) { result.body = body; } }, pathname);
  return { handled, ...result };
}
test('owner companion compositions expose fixed JavaScript assets and never a directory or test surface', () => {
  for (const name of ['public-record.mjs', 'owner-agent-grant.mjs', 'owner-agent-grant-schema.mjs', 'performance-consultation.mjs', 'vendor/interego-public-browser.mjs']) {
    const result = request('/gaming/identity/assets/' + name); assert.equal(result.status, 200);
    assert.match(result.headers['Content-Type'], /javascript/); assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(request('/gaming/identity/assets/' + name, 'HEAD').body, undefined);
    assert.equal(request('/gaming/identity/assets/' + name, 'POST').status, 404);
  }
  for (const name of ['../client.mjs', 'public-record.fixture.mjs', 'public-record.test.mjs', 'performance-consultation.test.mjs', 'owner-agent-grant.README.md', 'vendor/', '']) {
    assert.equal(request('/gaming/identity/assets/' + name).status, 404);
  }
  assert.equal(request('/unrelated').handled, false);
});
