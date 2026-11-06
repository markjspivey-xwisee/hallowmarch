/** Real browser storage and WebCrypto, in fresh synthetic contexts only.
 * The historic origin is intercepted; this fixture NEVER binds port 8787.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createOfflineRecoveryHandler } from './server.mjs';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';
import { checkedPublicScope, candidateSlots, RECOVERY_ORIGIN } from './scope.mjs';

if (!process.env.HM_PLAYWRIGHT_MODULE) throw Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const publicScope = checkedPublicScope({ ownerDid: 'did:web:identity.example:users:offline-browser-fixture', podUrl: 'https://pod.example/offline-browser-fixture/' });
const scope = candidateSlots(publicScope)[0].scope, phrase = 'synthetic NEW private backup phrase';
const handler = createOfflineRecoveryHandler(publicScope), gameAssets = createPlayerBrowserAssets();
const serverErrors = [], serverRequests = [], failures = [];
const server = http.createServer((request, response) => {
  serverRequests.push({ method: request.method, path: request.url });
  try {
    if (request.url.startsWith('/fixture-game/')) {
      if (gameAssets(request, response, '/gaming/identity/assets/' + request.url.slice('/fixture-game/'.length))) return;
      response.writeHead(404); response.end(); return;
    }
    handler(request, response);
  } catch { serverErrors.push('fixture-handler-failed'); response.writeHead(500); response.end('Fixture unavailable.'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert.notEqual(port, 8787, 'The synthetic fixture must never occupy the historic owner origin.');
let browser;

function readThroughFixture(request) {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url());
    const headers = { host: '127.0.0.1:8787' };
    if (request.headers().origin) headers.origin = request.headers().origin;
    const outgoing = http.request({ host: '127.0.0.1', port, method: request.method(), path: url.pathname + url.search, headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    }); outgoing.on('error', reject); outgoing.end();
  });
}

async function check(name, run) {
  const context = await browser.newContext({ acceptDownloads: true }); context.setDefaultTimeout(7000);
  const observed = { requests: [], console: [], messages: [], errors: [] };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    observed.requests.push({ url: request.url(), method: request.method(), body: request.postData() });
    if (url.origin !== RECOVERY_ORIGIN) { await route.abort('blockedbyclient'); return; }
    const result = await readThroughFixture(request);
    await route.fulfill(result);
  });
  await context.addInitScript(() => {
    const audit = { enabled: true, operations: [], messages: [], deriveWaiting: false, releaseDerive: null };
    Object.defineProperty(window, '__offlineFixtureAudit', { value: audit });
    const capture = (operation, values = {}) => { if (audit.enabled) audit.operations.push({ operation, ...values }); };
    for (const name of ['databases', 'open', 'deleteDatabase']) {
      const original = IDBFactory.prototype[name];
      IDBFactory.prototype[name] = function (...args) { capture(name, name === 'databases' ? {} : { database: args[0] }); return original.apply(this, args); };
    }
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) { capture('transaction', { mode: args[1] ?? 'readonly' }); return transaction.apply(this, args); };
    for (const name of ['get', 'getAll', 'openCursor', 'add', 'put', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[name];
      IDBObjectStore.prototype[name] = function (...args) { capture(name, name === 'get' ? { key: args[0] } : {}); return original.apply(this, args); };
    }
    window.addEventListener('message', event => { audit.messages.push(event.data); });
  });
  try {
    const page = await context.newPage();
    page.on('console', message => observed.console.push(message.text()));
    page.on('pageerror', error => observed.errors.push(error.message));
    await page.goto(RECOVERY_ORIGIN + '/');
    await page.locator('#status').waitFor();
    await run({ context, page, observed });
    assert.deepEqual(observed.errors, [], 'The actual module must not throw in the browser.');
    for (const request of observed.requests) {
      assert.equal(request.method, 'GET'); assert.equal(request.body, null);
      assert(!request.url.includes('?'), 'The helper sends no query data.');
    }
    assert(!JSON.stringify(observed.requests).includes(phrase));
    assert(!JSON.stringify(observed.console).includes(phrase));
    console.log('PASS ' + name);
  } catch (error) { failures.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
  finally { await context.close(); }
}

async function audit(page) { return page.evaluate(() => structuredClone(globalThis.__offlineFixtureAudit.operations)); }
function assertReadOnly(operations) {
  assert(!operations.some(value => ['deleteDatabase', 'getAll', 'openCursor', 'add', 'put', 'delete', 'clear'].includes(value.operation)));
  assert(operations.filter(value => value.operation === 'transaction').every(value => value.mode === 'readonly'));
  assert(operations.filter(value => value.operation === 'get').every(value => value.key === scope));
}
async function seed(page, { slot = scope, corrupt = false, withProfile = false } = {}) {
  return page.evaluate(async ({ slot, corrupt, withProfile }) => {
    const audit = globalThis.__offlineFixtureAudit; audit.enabled = false;
    try {
      const { ClientKeyVault } = await import('/client/native-pod/vendor/interego-browser.mjs');
      let record; const storage = { load: async () => record ?? null, create: async (_scope, value) => { record = value; return record; } };
      const vault = new ClientKeyVault(slot, storage, crypto), publicKey = await vault.create();
      const envelope = await vault.seal('synthetic original encrypted character');
      if (corrupt) record = { ...record, ciphertext: new Uint8Array(48).buffer };
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('interego-client-keys-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('keys');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => { const tx = db.transaction('keys', 'readwrite'); tx.objectStore('keys').add(record, slot);
        tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); }); db.close();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', record.ciphertext))].map(value => value.toString(16).padStart(2, '0')).join('');
      let proof = null;
      if (withProfile) {
        const { playerProfileIndexGraphIri } = await import('/fixture-game/profile.mjs');
        const [, relayUrl, ownerDid, slug] = JSON.parse(slot), podUrl = 'https://pod.example/' + slug + '/';
        const indexGraph = await playerProfileIndexGraphIri(ownerDid), profileGraph = 'urn:graph:hallowmarch:offline-browser-fixture-profile';
        proof = { indexGraph, profileGraph, ownerDid, relayUrl, podUrl, encrypted: [
          [indexGraph, await vault.seal(JSON.stringify({ schema: 'hallowmarch.player-profile-index/v1', ownerDid, game: 'urn:game:hallowmarch', profileGraphIri: profileGraph }))],
          [profileGraph, await vault.seal(JSON.stringify({ schema: 'hallowmarch.player-profile/v1', ownerDid, game: 'urn:game:hallowmarch',
            save: { v: 1, char: { name: 'Synthetic offline original hero', level: 23, realm: 2, cls: 'mage', rp: 73 } } }))],
        ] };
      }
      return { publicKey, envelope, ciphertextDigest: digest, iv: [...record.iv], proof };
    } finally { audit.operations.length = 0; audit.enabled = true; }
  }, { slot, corrupt, withProfile });
}
async function snapshot(page) {
  return page.evaluate(async slot => {
    const audit = globalThis.__offlineFixtureAudit; audit.enabled = false;
    try {
      const names = await indexedDB.databases(); if (!names.some(value => value.name === 'interego-client-keys-v1')) return { absent: true };
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('interego-client-keys-v1');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const values = await new Promise((resolve, reject) => {
        const tx = db.transaction('keys', 'readonly'), store = tx.objectStore('keys'); let record, count;
        store.get(slot).onsuccess = event => { record = event.target.result; }; store.count().onsuccess = event => { count = event.target.result; };
        tx.oncomplete = () => resolve({ record, count }); tx.onerror = tx.onabort = () => reject(tx.error);
      }); db.close();
      return { count: values.count, publicKey: values.record?.publicKey, iv: values.record ? [...values.record.iv] : null,
        ciphertextDigest: values.record ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', values.record.ciphertext))].map(value => value.toString(16).padStart(2, '0')).join('') : null };
    } finally { audit.enabled = true; }
  }, scope);
}
async function findCandidate(page) {
  await page.locator('#consent').check(); await page.locator('#check').click();
  await page.locator('input[name="candidate"]').waitFor();
  await page.locator('input[name="candidate"]').check();
  await page.locator('#passphrase').fill(phrase); await page.locator('#confirm-passphrase').fill(phrase);
  await page.waitForFunction(() => !document.getElementById('download').disabled);
}
async function holdEncryption(page) {
  await page.evaluate(() => {
    const original = crypto.subtle.deriveKey.bind(crypto.subtle), encrypt = crypto.subtle.encrypt.bind(crypto.subtle), audit = globalThis.__offlineFixtureAudit;
    const gate = new Promise(resolve => { audit.releaseDerive = resolve; });
    crypto.subtle.deriveKey = async (...args) => { audit.deriveWaiting = true; await gate; return original(...args); };
    crypto.subtle.encrypt = async (...args) => { try { return await encrypt(...args); } finally { audit.encryptFinished = true; } };
  });
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  await check('explicit owner consent and a trusted Check precede every storage operation', async ({ page }) => {
    assert.deepEqual(await audit(page), []);
    assert.equal(await page.locator('#check').isDisabled(), true);
    await page.evaluate(() => document.getElementById('check').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.deepEqual(await audit(page), []);
    await page.locator('#consent').check(); assert.deepEqual(await audit(page), []);
    await page.locator('#check').click(); await page.waitForFunction(() => document.getElementById('status').textContent.includes('No existing key'));
    assert.deepEqual(await snapshot(page), { absent: true }); assertReadOnly(await audit(page));
    assert.deepEqual(await page.evaluate(() => globalThis.__offlineFixtureAudit.messages), []);
  });

  await check('real IndexedDB key export preserves the protected original and never claims a character match', async ({ page, observed }) => {
    const key = await seed(page), before = await snapshot(page);
    const originalGlobals = await page.evaluate(() => Object.getOwnPropertyNames(window));
    await findCandidate(page);
    assert((await page.locator('#status').textContent()).includes('not been matched'));
    assert((await page.locator('#candidates').textContent()).includes(key.publicKey));
    const pending = page.waitForEvent('download'); await page.locator('#download').click(); const download = await pending;
    assert.equal(download.suggestedFilename(), 'hallowmarch-encrypted-recovery.json');
    const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const file = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(file.scope, scope); assert.equal(file.publicKey, key.publicKey); assert.equal(file.iterations, 600000);
    assert.equal(await page.locator('#passphrase').inputValue(), ''); assert.equal(await page.locator('#confirm-passphrase').inputValue(), '');
    assert.deepEqual(await snapshot(page), before); assertReadOnly(await audit(page));
    const leaks = await page.evaluate(({ originals, secret, ciphertext }) => ({ globals: Object.getOwnPropertyNames(window).filter(key => !originals.includes(key)),
      strings: Object.getOwnPropertyNames(window).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(window, key); return typeof descriptor?.value === 'string'
          && (descriptor.value.includes(secret) || descriptor.value.includes(ciphertext));
      }), messages: globalThis.__offlineFixtureAudit.messages }), { originals: originalGlobals, secret: phrase, ciphertext: file.ciphertext });
    assert.deepEqual(leaks.globals, []); assert.equal(leaks.strings, false); assert.deepEqual(leaks.messages, []);
    assert(!JSON.stringify(observed.console).includes(file.ciphertext));
    const restored = await page.evaluate(async ({ file, phrase, envelope }) => {
      const { ClientKeyVault } = await import('/client/native-pod/vendor/interego-browser.mjs');
      const records = new Map(), vault = new ClientKeyVault(file.scope, { load: async key => records.get(key) || null,
        create: async (key, record) => { records.set(key, record); return record; } }, crypto);
      await vault.restore(file, phrase); return { publicKey: await vault.publicKey(), text: await vault.open(envelope) };
    }, { file, phrase, envelope: key.envelope });
    assert.deepEqual(restored, { publicKey: key.publicKey, text: 'synthetic original encrypted character' });
  });

  await check('other-owner and other-relay records are never read as recovery candidates', async ({ page }) => {
    await seed(page, { slot: scope.replace(publicScope.ownerDid, publicScope.ownerDid + '-other') });
    await seed(page, { slot: scope.replace('relay.interego.xwisee.com', 'another-relay.example') });
    const before = await snapshot(page); await page.locator('#consent').check(); await page.locator('#check').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('No existing key'));
    assert.equal(await page.locator('input[name="candidate"]').count(), 0); assert.deepEqual(await snapshot(page), before); assertReadOnly(await audit(page));
  });

  await check('corrupt retained ciphertext cannot be exported or overwritten', async ({ page }) => {
    await seed(page, { corrupt: true }); const before = await snapshot(page), downloads = []; page.on('download', value => downloads.push(value));
    await findCandidate(page); await page.locator('#download').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('could not be completed'));
    assert.equal(downloads.length, 0); assert.deepEqual(await snapshot(page), before); assertReadOnly(await audit(page));
  });

  await check('cancelling nonabortable encryption clears private inputs and prevents a late download', async ({ page }) => {
    await seed(page); const before = await snapshot(page), downloads = []; page.on('download', value => downloads.push(value));
    await findCandidate(page); await holdEncryption(page); await page.locator('#download').click();
    await page.waitForFunction(() => globalThis.__offlineFixtureAudit.deriveWaiting);
    await page.locator('#cancel').click(); await page.evaluate(() => globalThis.__offlineFixtureAudit.releaseDerive());
    await page.waitForFunction(() => globalThis.__offlineFixtureAudit.encryptFinished);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(downloads.length, 0); assert((await page.locator('#status').textContent()).startsWith('Cancelled.'));
    assert.equal(await page.locator('#passphrase').inputValue(), ''); assert.equal(await page.locator('#confirm-passphrase').inputValue(), '');
    assert.equal(await page.locator('#consent').isChecked(), false); assert.deepEqual(await snapshot(page), before); assertReadOnly(await audit(page));
  });

  await check('same-public-key record mutation while encrypting prevents a stale backup', async ({ page }) => {
    await seed(page); const downloads = []; page.on('download', value => downloads.push(value));
    await findCandidate(page); await holdEncryption(page); await page.locator('#download').click();
    await page.waitForFunction(() => globalThis.__offlineFixtureAudit.deriveWaiting);
    await page.evaluate(async slot => {
      const audit = globalThis.__offlineFixtureAudit; audit.enabled = false;
      try {
        const db = await new Promise(resolve => { const request = indexedDB.open('interego-client-keys-v1'); request.onsuccess = () => resolve(request.result); });
        await new Promise((resolve, reject) => { const tx = db.transaction('keys', 'readwrite'), store = tx.objectStore('keys');
          store.get(slot).onsuccess = event => store.put({ ...event.target.result, ciphertext: new Uint8Array(48).buffer }, slot);
          tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); }); db.close();
      } finally { audit.enabled = true; }
      audit.releaseDerive();
    }, scope);
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('changed during the check'));
    assert.equal(downloads.length, 0); assertReadOnly(await audit(page));
  });

  await check('connect-none blocks outbound requests and the real response forbids framing and referrers', async ({ page, observed }) => {
    const response = await page.reload(); const headers = response.headers();
    assert(headers['content-security-policy'].includes("connect-src 'none'"));
    assert(headers['content-security-policy'].includes("frame-ancestors 'none'"));
    assert(headers['content-security-policy'].includes("form-action 'none'")); assert.equal(headers['referrer-policy'], 'no-referrer');
    const before = observed.requests.length;
    assert.equal(await page.evaluate(async () => { try { await fetch('https://blocked-fixture.invalid/'); return 'unexpected'; } catch { return 'blocked'; } }), 'blocked');
    assert.equal(observed.requests.length, before, 'CSP must block before the request reaches the network routing layer.');
    assert.deepEqual(await audit(page), []);
  });

  await check('downloaded file proves the actual game encrypted index and profile before any key or pod write', async ({ page }) => {
    const fixture = await seed(page, { withProfile: true }), before = await snapshot(page);
    await findCandidate(page);
    const pending = page.waitForEvent('download'); await page.locator('#download').click(); const download = await pending;
    const stream = await download.createReadStream(), chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const file = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await page.evaluate(async ({ file, phrase, proof }) => {
      const { createRetainedCharacterRecovery } = await import('/fixture-game/recovery.mjs');
      const encrypted = new Map(proof.encrypted), { ownerDid, podUrl, relayUrl } = proof;
      const calls = [];
      const head = graphIri => ({ descriptorUrl: podUrl + 'context-graphs/' + (graphIri === proof.indexGraph ? 'index' : 'profile') + '.ttl',
        cid: 'sha256:' + 'a'.repeat(64), ...(graphIri === proof.indexGraph ? {} : { nativeRevision: 'sha256:' + 'b'.repeat(64), recordCid: 'graph-nquads-sha256:' + 'c'.repeat(64) }) });
      let writes = 0, connectedOwner = ownerDid, tamperHead = false;
      const recovery = createRetainedCharacterRecovery({ binding: { subjectDid: ownerDid, podUrl }, relayUrl, crypto,
        credential: { kind: 'relay-oauth-bearer', accessToken: 'synthetic-offline-proof-bearer', expiresAt: Date.now() + 600000 },
        keyStorage: { load: async () => null, create: async () => { writes++; throw Error('No persistence before explicit owner selection.'); } },
        candidateSource: { list: async () => [], openVault: () => { throw Error('Only the explicitly imported backup may be tried.'); } },
        createClient: options => ({ connect: async () => ({ ownerDid: connectedOwner, podUrl }),
          currentHead: async ({ graphIri }) => { calls.push('head'); const value = head(graphIri); return tamperHead && graphIri === proof.profileGraph
            ? { ...value, nativeRevision: 'sha256:' + 'd'.repeat(64) } : value; },
          load: async ({ graphIri }) => { calls.push('load'); return encrypted.has(graphIri)
            ? { graphIri, head: head(graphIri), digest: 'synthetic-authenticated-checkpoint', record: JSON.parse(await options.vault.open(encrypted.get(graphIri))) } : null; },
          close() {}, createKey: () => { writes++; throw Error('No key generation'); }, createAt: () => { writes++; throw Error('No pod write'); } }) });
      try {
        const wrongPassphrase = await recovery.restore(file, 'wrong synthetic recovery phrase');
        connectedOwner += '-other'; const wrongOwner = await recovery.restore(file, phrase); connectedOwner = ownerDid;
        tamperHead = true; const wrongHead = await recovery.restore(file, phrase); tamperHead = false;
        const verified = await recovery.restore(file, phrase);
        return { wrongPassphrase, wrongOwner, wrongHead, verified, writes, calls };
      } finally { recovery.close(); }
    }, { file, phrase, proof: fixture.proof });
    assert.equal(result.wrongPassphrase.status, 'unavailable'); assert.notEqual(result.wrongOwner.status, 'verified_character');
    assert.notEqual(result.wrongHead.status, 'verified_character'); assert.equal(result.verified.status, 'verified_character');
    assert.deepEqual(result.verified.summary, { name: 'Synthetic offline original hero', level: 23, realm: 2, calling: 'mage', realmPoints: 73 });
    assert.equal(result.writes, 0); assert(result.calls.includes('load')); assert.deepEqual(await snapshot(page), before); assertReadOnly(await audit(page));
  });
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
assert.deepEqual(serverErrors, []);
assert(serverRequests.every(request => request.method === 'GET' && !request.path.includes('?')));
if (failures.length) { console.error(JSON.stringify({ failed: failures.length, total: 8 })); process.exitCode = 1; }
else console.log('PASS offline recovery browser invariants (8 cases; synthetic contexts only; no historic-origin listener)');
