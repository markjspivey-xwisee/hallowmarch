import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createOfflineRecoveryHandler, startOfflineRecovery } from './server.mjs';
import { checkedPublicScope, candidateSlots } from './scope.mjs';

const publicScope = { ownerDid: 'did:example:offline-test-owner', podUrl: 'https://pod.example.test/offline-test/' };
let server, port;
before(async () => {
  server = http.createServer(createOfflineRecoveryHandler(publicScope));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
function request({ method = 'GET', path = '/', host = '127.0.0.1:8787', origin } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path,
      headers: { Host: host, ...(origin !== undefined ? { Origin: origin } : {}) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}
test('explicit canonical public scope limits lookup to fixed relay and exact owner/pod slot', () => {
  assert.deepEqual(checkedPublicScope(publicScope), { schema: 'hallowmarch.offline-character-key-recovery/v1',
    ...publicScope, relayOrigins: ['https://relay.interego.xwisee.com'] });
  assert.deepEqual(candidateSlots(publicScope), [{ relayOrigin: 'https://relay.interego.xwisee.com',
    scope: JSON.stringify(['interego-client-key/v1', 'https://relay.interego.xwisee.com', publicScope.ownerDid, 'offline-test']) }]);
  for (const input of [undefined, {}, { ...publicScope, arbitrary: 'ignored' }, { ...publicScope, schema: 'other' },
    { ...publicScope, ownerDid: 'did:example:<script>' }, { ...publicScope, ownerDid: 'did:example:null\u0000byte' },
    { ...publicScope, podUrl: 'http://pod.example.test/offline-test/' },
    { ...publicScope, podUrl: 'https://pod.example.test/offline-test/?owner=other' },
    { ...publicScope, podUrl: 'https://pod.example.test/offline-test/#other' },
    { ...publicScope, podUrl: 'https://pod.example.test/offline-test/nested/' },
    { ...publicScope, relayOrigins: ['https://attacker.example.test'] }]) {
    assert.throws(() => checkedPublicScope(input));
  }
});
test('actual fixed page has inert public configuration and strict offline response policy', async () => {
  const page = await request();
  assert.equal(page.status, 200);
  const html = page.body.toString();
  assert.match(html, /<template id="public-scope">/);
  assert.match(html, /No browser storage has been checked/);
  assert.match(html, /id="consent" type="checkbox"/);
  assert.match(html, /id="check" type="button" disabled/);
  assert.doesNotMatch(html, /<script[^>]*>[\s\S]+?<\/script>/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin');
  assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(page.headers['content-security-policy'], /form-action 'none'/);
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-|https?:/);
  assert.equal(page.headers['set-cookie'], undefined);
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  const config = await request({ path: '/scope.json' });
  assert.deepEqual(JSON.parse(config.body.toString()), checkedPublicScope(publicScope));
});
test('fixed asset whitelist serves byte-identical already-vendored SDK and HEAD', async () => {
  for (const path of ['/assets/style.css', '/assets/recovery-ui.mjs', '/assets/recovery-core.mjs', '/assets/scope.mjs',
    '/client/native-pod/vendor/interego-browser.mjs']) {
    const get = await request({ path }), head = await request({ method: 'HEAD', path });
    assert.equal(get.status, 200, path); assert.equal(head.status, 200, path);
    assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), get.body.length);
    assert.equal(get.headers['cache-control'], 'no-store');
  }
  const sdk = await request({ path: '/client/native-pod/vendor/interego-browser.mjs' });
  const original = readFileSync(new URL('../../client/native-pod/vendor/interego-browser.mjs', import.meta.url));
  assert.deepEqual(sdk.body, original);
  assert.equal(createHash('sha256').update(sdk.body).digest('hex'), '99767d34921142c24fc8afde2f505b25f905b14348a168c2d66eda1c48c211e6');
});
test('host rebinding, cross-origin requests, writes, selectors and non-whitelisted paths fail closed', async () => {
  for (const options of [{ host: 'localhost:8787' }, { host: '127.0.0.1:9999' }, { host: 'evil.example.test' },
    { origin: 'https://relay.interego.xwisee.com' }, { origin: 'null' }]) {
    assert.equal((await request(options)).status, 403);
  }
  assert.equal((await request({ origin: 'http://127.0.0.1:8787' })).status, 200);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await request({ method })).status, 405);
  for (const path of ['/?owner=other', '/scope.json?pod=other', '/assets/../server.mjs', '/server.mjs', '/.env',
    '/assets/%2e%2e/server.mjs', '//scope.json', 'http://127.0.0.1:8787/']) {
    const rejected = await request({ path });
    assert.equal(rejected.status, 404, path);
    assert.equal(rejected.body.toString(), 'This recovery request is unavailable.');
    assert.doesNotMatch(rejected.body.toString(), /other|\.env|server\.mjs/);
  }
});

test('production launch requests only the fixed loopback address and refuses a busy port without fallback', async t => {
  const attempts = [], servers = []; let busy = false;
  t.mock.method(http, 'createServer', handler => {
    assert.equal(typeof handler, 'function');
    const server = new EventEmitter(); server.closed = 0;
    server.close = () => { server.closed++; return server; };
    server.listen = (port, host, ready) => {
      attempts.push({ port, host });
      queueMicrotask(() => busy
        ? server.emit('error', Object.assign(new Error('private synthetic bind detail'), { code: 'EADDRINUSE' }))
        : ready());
      return server;
    };
    servers.push(server); return server;
  });
  // Extra caller properties cannot change the production bind contract.
  const launched = await startOfflineRecovery({ publicScope, port: 0, host: '0.0.0.0' });
  assert.equal(launched, servers[0]); assert.equal(launched.closed, 0);
  assert.equal(launched.requestTimeout, 5000); assert.equal(launched.headersTimeout, 5000);
  assert.deepEqual(attempts, [{ port: 8787, host: '127.0.0.1' }]);
  busy = true;
  await assert.rejects(startOfflineRecovery({ publicScope }), error => {
    assert.equal(error.message, 'The recovery page could not start. Close another local recovery tool before trying again.');
    assert.doesNotMatch(error.message, /private synthetic|EADDRINUSE/); return true;
  });
  assert.equal(servers[1].closed, 1);
  assert.deepEqual(attempts, [{ port: 8787, host: '127.0.0.1' }, { port: 8787, host: '127.0.0.1' }]);
});
