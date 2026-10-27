import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlayerBrowserAssets } from './player-browser-assets.js';
const handler = createPlayerBrowserAssets();
function request(pathname, method = 'GET') {
  const result = {};
  const handled = handler({ method }, { writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(body) { result.body = body; } }, pathname);
  return { handled, ...result };
}
test('owner companion compositions expose fixed JavaScript assets and never a directory or test surface', () => {
  for (const name of ['public-record.mjs', 'signing-delegation.mjs', 'owner-agent-grant.mjs', 'owner-agent-grant-schema.mjs', 'performance-consultation.mjs', 'foxxi-consulting.mjs', 'agent-own-session.mjs', 'gameplay-activity.mjs', 'gameplay-activity-archive.mjs', 'vendor/interego-public-browser.mjs']) {
    const result = request('/gaming/identity/assets/' + name); assert.equal(result.status, 200);
    assert.match(result.headers['Content-Type'], /javascript/); assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(request('/gaming/identity/assets/' + name, 'HEAD').body, undefined);
    assert.equal(request('/gaming/identity/assets/' + name, 'POST').status, 404);
  }
  for (const name of ['../client.mjs', 'signing-delegation.fixture.mjs', 'signing-delegation.test.mjs', 'public-record.fixture.mjs', 'public-record.test.mjs', 'performance-consultation.test.mjs', 'owner-agent-grant.README.md', 'vendor/', '']) {
    assert.equal(request('/gaming/identity/assets/' + name).status, 404);
  }
  assert.equal(request('/unrelated').handled, false);
});

test('activity modules expose exact authored bytes with fixed security headers and no neighboring test files', () => {
  for (const name of ['gameplay-activity.mjs', 'gameplay-patterns.mjs', 'gameplay-semantics.mjs', 'gameplay-activity-archive.mjs', 'gameplay-learning-delivery.mjs', 'checkpoint.mjs', 'vendor/interego-native-resource-browser.mjs']) {
    const path = '/gaming/identity/assets/' + name, response = request(path);
    assert.deepEqual(response.body, readFileSync(new URL('../../client/native-pod/' + name, import.meta.url)));
    assert.equal(response.headers['Referrer-Policy'], 'no-referrer'); assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(request(path, 'HEAD').status, 200); assert.equal(request(path, 'HEAD').body, undefined);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(request(path, method).status, 404);
  }
  for (const name of ['gameplay-activity.test.mjs', 'gameplay-patterns.test.mjs', 'gameplay-semantics.test.mjs', 'gameplay-activity-archive.test.mjs', 'gameplay-learning-delivery.test.mjs', 'gameplay-learning-delivery.integration.test.mjs', 'checkpoint.test.mjs', 'vendor/interego-native-resource-browser.manifest.json', 'gameplay-activity.mjs/anything', '%2e%2e/gameplay-activity.mjs']) {
    assert.equal(request('/gaming/identity/assets/' + name).status, 404);
  }
});

test('agent directory is an exact read-only JavaScript asset without neighboring file access', () => {
  const path = '/gaming/identity/assets/agent-directory.mjs', response = request(path);
  assert.equal(response.handled, true); assert.equal(response.status, 200);
  assert.deepEqual(response.body, readFileSync(new URL('../../client/native-pod/agent-directory.mjs', import.meta.url)));
  assert.equal(response.headers['Content-Type'], 'text/javascript; charset=utf-8');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  const head = request(path, 'HEAD');
  assert.equal(head.status, 200); assert.deepEqual(head.headers, response.headers); assert.equal(head.body, undefined);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) assert.equal(request(path, method).status, 404);
  for (const name of ['agent-directory.test.mjs', 'agent-directory.fixture.mjs', 'agent-directory.mjs/anything', '../agent-directory.mjs', '%2e%2e/agent-directory.mjs']) {
    assert.equal(request('/gaming/identity/assets/' + name).status, 404);
  }
});
