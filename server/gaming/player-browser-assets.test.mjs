import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  for (const name of ['gameplay-activity.mjs', 'activity-dashboard.mjs', 'gameplay-record-reader.mjs', 'gameplay-patterns.mjs', 'gameplay-semantics.mjs', 'gameplay-activity-archive.mjs', 'gameplay-learning-delivery.mjs', 'checkpoint.mjs', 'vendor/interego-native-resource-browser.mjs']) {
    const path = '/gaming/identity/assets/' + name, response = request(path);
    assert.deepEqual(response.body, readFileSync(new URL('../../client/native-pod/' + name, import.meta.url)));
    assert.equal(response.headers['Referrer-Policy'], 'no-referrer'); assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(request(path, 'HEAD').status, 200); assert.equal(request(path, 'HEAD').body, undefined);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(request(path, method).status, 404);
  }
  for (const name of ['gameplay-activity.test.mjs', 'activity-dashboard.test.mjs', 'gameplay-record-reader.test.mjs', 'gameplay-patterns.test.mjs', 'gameplay-semantics.test.mjs', 'gameplay-activity-archive.test.mjs', 'gameplay-learning-delivery.test.mjs', 'gameplay-learning-delivery.integration.test.mjs', 'checkpoint.test.mjs', 'vendor/interego-native-resource-browser.manifest.json', 'gameplay-activity.mjs/anything', '%2e%2e/gameplay-activity.mjs']) {
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

function assertFixedInlineFinish(result, source) {
  const html = result.body.toString(), inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1, 'Only one fixed classic bootstrap can execute from the document');
  assert.equal(inline[0][1], source.replace(/\r\n?/g, '\n'));
  assert.equal([...html.matchAll(/<script[^>]*\bsrc=/g)].length, 0, 'No external script is needed before the claim');
  assert(html.indexOf(inline[0][0]) < html.indexOf('<link rel="stylesheet"'));
  const hash = createHash('sha256').update(inline[0][1]).digest('base64');
  assert.equal(result.headers['Content-Security-Policy'], "default-src 'none'; script-src 'self' 'sha256-" + hash
    + "'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert(!html.includes('<!--hallowmarch-finish-bootstrap-->'));
}

test('finish page contains only the authored inline bootstrap under its exact CSP hash before external CSS', () => {
  const result = request('/gaming/identity/finish'); assert.equal(result.status, 200);
  assertFixedInlineFinish(result, readFileSync(new URL('../../client/native-pod/finish-bootstrap.js', import.meta.url), 'utf8'));
  assert.equal(request('/gaming/identity/finish', 'HEAD').body, undefined);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(request('/gaming/identity/finish', method).status, 404);
});

test('CRLF authored bootstrap is normalized before both inline rendering and CSP hashing', () => {
  const root = mkdtempSync(join(tmpdir(), 'hallowmarch-fixed-finish-'));
  try {
    copyFileSync(new URL('../../client/native-pod/finish.html', import.meta.url), join(root, 'finish.html'));
    const source = readFileSync(new URL('../../client/native-pod/finish-bootstrap.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
    writeFileSync(join(root, 'finish-bootstrap.js'), source);
    const result = {};
    const handled = createPlayerBrowserAssets({ clientRoot: root })({ method: 'GET' }, {
      writeHead(status, headers) { Object.assign(result, { status, headers }); }, end(body) { result.body = body; },
    }, '/gaming/identity/finish');
    assert.equal(handled, true); assert.equal(result.status, 200); assertFixedInlineFinish(result, source);
    assert(!result.body.toString().includes('\r'));
  } finally { rmSync(join(root, 'finish.html'), { force: true }); rmSync(join(root, 'finish-bootstrap.js'), { force: true }); rmdirSync(root); }
});
