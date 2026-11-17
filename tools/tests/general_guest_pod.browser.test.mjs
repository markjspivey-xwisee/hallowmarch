/** An Interego guest through the door and into the March in a real browser, with its character kept in the
 * guest's own pod: the built page, the real server, and local stand-ins for the door page, identity's
 * exchange and the pod. Chromium (SwiftShader) over HTTPS on localhost, with a certificate made here.
 * Made-up origins, tokens and characters only; no live service is called.
 *
 *   node --test tools/tests/general_guest_pod.browser.test.mjs      (after `python3 build.py`; about four minutes)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const built = path.join(root, 'hallowmarch.html');
const three = readFileSync(new URL('../node_modules/three/build/three.module.min.js', import.meta.url), 'utf8');
const real = new URL('../../server/gaming/general-guest.js', import.meta.url).href, realPod = new URL('../../server/gaming/general-guest-pod.js', import.meta.url).href;
const USERS = 'did:web:identity.example:users:', POD_TOKEN = 'cg2_fixture_guest_application_token';
const log = (...line) => console.log('   ', ...line);

async function freePort() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const { port } = s.address(); await new Promise(r => s.close(r)); return port; }

/** The server behind TLS on localhost, the door page on an origin of its own, and identity and the pod stood in inside the server's process. */
async function deployment(t, env) {
  const data = await mkdtemp(path.join(tmpdir(), 'hallowmarch-guest-pod-browser-'));
  await mkdir(path.join(data, 'saves'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(data, 'key.pem'), '-out', path.join(data, 'cert.pem')], { stdio: 'ignore' });
  const key = await readFile(path.join(data, 'key.pem')), cert = await readFile(path.join(data, 'cert.pem'));
  const port = await freePort(), gamePort = await freePort(), doorPort = await freePort();
  const game = `https://localhost:${gamePort}`, door = `https://localhost:${doorPort}`;
  // TLS in front of the server, as its platform's proxy is: bytes through, the WebSocket too.
  const front = tls.createServer({ key, cert }, socket => {
    const back = net.connect(port, '127.0.0.1'); socket.pipe(back); back.pipe(socket);
    socket.on('error', () => back.destroy()); back.on('error', () => socket.destroy());
  });
  front.listen(gamePort, '127.0.0.1'); await once(front, 'listening');
  // The door page: one guest for this browser (kept at the door's origin), and it proceeds only on a click.
  const doorPage = `<!doctype html><meta charset="utf-8"><title>Stand-in guest door</title><button id="enter" type="button">Enter as this browser's guest</button><script>
    const grant = JSON.parse(atob(new URLSearchParams(location.hash.slice(1)).get('grant').replace(/-/g, '+').replace(/_/g, '/')));
    const asked = JSON.parse(grant._signed_payload);
    history.replaceState(null, '', location.pathname);
    let guest = localStorage.getItem('guest');
    if (!guest) { guest = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem('guest', guest); }
    document.getElementById('enter').onclick = () => { location.assign(asked.audience + '/guest/general/return?code=code-' + guest + '&state=' + encodeURIComponent(asked.state)); };
  </script>`;
  const doorServer = https.createServer({ key, cert }, (req, res) => {
    if (req.url !== '/guest/door') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(doorPage);
  });
  doorServer.listen(doorPort, '127.0.0.1'); await once(doorServer, 'listening');
  const fixture = path.join(data, 'general-guest-fixture.mjs'), podFixture = path.join(data, 'general-guest-pod-fixture.mjs'), shim = path.join(data, 'shim.mjs');
  await writeFile(fixture, `export * from ${JSON.stringify(real)};
import { configuredGeneralGuest as actual } from ${JSON.stringify(real)};
export function configuredGeneralGuest(options) {
  return actual({ ...options,
    signGrant: async request => ({ _signed_payload: JSON.stringify({ ...request, agent_id: 'did:web:identity.example:agents:game-service' }), _signature: '0x' + 'ab'.repeat(65) }),
    fetch: async (url, init) => {
      const asked = JSON.parse(init.body), named = /^code-([0-9a-f]{32})$/.exec(asked.code);
      if (url !== 'https://identity.example/guest/exchange' || !named) return new Response(JSON.stringify({ valid: false, error: 'invalid_guest_code' }), { status: 401 });
      const userId = 'u-try-guest-' + named[1], ownerDid = ${JSON.stringify(USERS)} + userId, until = Math.floor(Date.now() / 1000) + 86400;
      return new Response(JSON.stringify({ valid: true, provisional: true, general: true, issuer: 'https://identity.example', audience: asked.audience, userId, ownerDid,
        podUrl: 'https://pods.example/' + userId + '/', guestExpiresAt: new Date(until * 1000).toISOString(), namespace: 'hallowmarch',
        subjectAttributes: { subject: ownerDid, provisional: true, claimed: false, standingUntil: until, admittedBy: [asked.audience] },
        token: ${JSON.stringify(POD_TOKEN)}, tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
    } });
}`);
  await writeFile(podFixture, `export * from ${JSON.stringify(realPod)};
import { configuredGuestPod as actual } from ${JSON.stringify(realPod)};
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const documents = new Map(), log = [];
export function configuredGuestPod(options) {
  return actual({ ...options, fetch: async (url, init) => {
    log.push({ url, method: init.method, authorized: init.headers.Authorization === 'Bearer ' + ${JSON.stringify(POD_TOKEN)}, type: init.headers['Content-Type'] ?? null,
      condition: init.headers['If-Match'] ?? (init.headers['If-None-Match'] ? 'absent' : null), body: init.body ?? null });
    writeFileSync(${JSON.stringify(path.join(data, 'pod-log.json'))}, JSON.stringify(log));
    const found = documents.get(url);
    if (init.method === 'GET') return found ? new Response(found.text, { status: 200, headers: { ETag: '"' + found.revision + '"' } }) : new Response('', { status: 404 });
    if (init.headers.Authorization !== 'Bearer ' + ${JSON.stringify(POD_TOKEN)} || init.headers['Content-Type'] !== 'application/vnd.interego.native-commit+json') return new Response('', { status: 401 });
    const command = JSON.parse(init.body), text = Buffer.from(command.bodyBase64, 'base64').toString('utf8'), envelope = JSON.parse(text);
    if (envelope.version !== 1 || envelope.algorithm !== 'X25519-XSalsa20-Poly1305' || envelope.content?.algorithm !== 'XSalsa20-Poly1305' || envelope.wrappedKeys?.length !== 1) return new Response('', { status: 400 });
    if ((found?.revision ?? null) !== command.expectedRevision) return new Response('', { status: 412 });
    const revision = 'sha256:' + createHash('sha256').update(text + log.length).digest('hex');
    documents.set(url, { text, revision });
    return new Response(JSON.stringify({ version: 1, status: 'committed', revision }), { status: 200, headers: { ETag: '"' + revision + '"' } });
  } });
}`);
  const swapped = { [real]: pathToFileURL(fixture).href, [realPod]: pathToFileURL(podFixture).href };
  await writeFile(shim, `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(`const swapped = ${JSON.stringify(swapped)};
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  return swapped[result.url] && context.parentURL !== swapped[result.url] ? { ...result, url: swapped[result.url], shortCircuit: true } : result;
}`)}));`);
  const child = spawn(process.execPath, ['--import', pathToFileURL(shim).href, path.join(root, 'server', 'server.js')], { cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), HM_DATA: data, HM_SECRET: 'synthetic-guest-pod-browser-secret', HM_PUBLIC_ORIGIN: game,
      HM_GAMING_BOOTSTRAP: '0', HM_GAMING_ENABLED: '0', HM_WORLD_PERSISTENCE_MODE: 'legacy', HM_GAMING_SERVICE_IDENTITY_ORIGIN: 'https://identity.example',
      HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: door, HM_GENERAL_GUEST_POD_ORIGIN: 'https://pods.example', ...env },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-12000); });
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    front.close(); doorServer.close(); doorServer.closeAllConnections?.();
    await rm(data, { recursive: true, force: true });
  });
  for (let until = Date.now() + 15000; ; ) {
    assert.equal(child.exitCode, null, output);
    try { if ([200, 503].includes((await fetch(`http://127.0.0.1:${port}/health`)).status)) break; } catch { /* starting */ }
    assert.ok(Date.now() < until, 'the server did not start: ' + output);
    await new Promise(r => setTimeout(r, 50));
  }
  return { data, game, door, output: () => output,
    podLog: async () => { try { return JSON.parse(await readFile(path.join(data, 'pod-log.json'), 'utf8')); } catch { return []; } },
    saves: async () => (await readdir(path.join(data, 'saves'))).filter(name => name.startsWith('gg-')),
    stats: async () => (await (await fetch(`http://127.0.0.1:${port}/stats`)).json()) };
}

let browser;
test.before(async () => {
  assert.ok(existsSync(built), 'build the page first: python3 build.py');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
});
test.after(async () => { await browser?.close(); });

async function browserContext(t) {
  const context = await browser.newContext({ viewport: { width: 800, height: 450 }, ignoreHTTPSErrors: true });
  t.after(() => context.close());
  await context.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js', route => route.fulfill({ contentType: 'application/javascript', body: three, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
  return context;
}
const settled = page => page.waitForFunction(() => { const H = window.__hm; return !!(H && H.ready && H.GAME.ready && H.generalGuest && document.getElementById('title')?.getAttribute('aria-busy') !== 'true'); }, null, { timeout: 240000, polling: 250 });
/** From the game's first screen through the door and back: what a visitor does, by clicks. */
async function throughTheDoor(page, d) {
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const navigations = []; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await page.goto(d.game + '/', { waitUntil: 'commit' });
  // The control is offered beside the native sign-in, which this offline deployment does not configure (its box is
  // hidden here), so the shipping control's own handler is run where a visitor would press it.
  await page.waitForFunction(() => { const control = document.getElementById('loading-general-guest'); return !!control && !control.disabled && typeof control.onclick === 'function'; }, null, { timeout: 120000 });
  assert.equal(await page.locator('#loading-general-guest').textContent(), 'Continue as an Interego guest');
  await page.evaluate(() => document.getElementById('loading-general-guest').click());
  await page.waitForURL(url => url.origin === d.door, { timeout: 30000 });
  assert.equal(new URL(page.url()).pathname, '/guest/door');
  await page.locator('#enter').click();
  await page.waitForURL(url => url.origin === d.game && url.pathname === '/' && !url.search, { timeout: 60000 });
  await settled(page);
  return { errors, navigations };
}
async function startPlaying(page, name) {
  const focus = await page.context().newCDPSession(page);
  await focus.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.evaluate(async chosen => {
    await __hm.start({ realm: 0, cls: 'warrior', level: 5, name: chosen }); __hm.UI.modal = null;
    for (const id of ['prologue', 'menu', 'dialog']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  }, name);
  await page.bringToFront(); await page.keyboard.press('Shift');
  await page.waitForFunction(() => __hm.net.NETWS.state === 'on' && typeof __hm.net.NETWS.acct?.id === 'string', null, { timeout: 30000 });
}
/** Play a little, save, and wait for what the pod side of that save comes to. */
async function saveAndSettle(page, gold) {
  await page.keyboard.press('Shift');
  return page.evaluate(async coins => {
    const G = __hm.generalGuest, before = { ...G.GENERAL_GUEST_POD.stats };
    __hm.INV.gold = coins; __hm.simulate(0.2);
    await __hm.fn.saveNow();
    for (let n = 0; n < 300; n++) {
      const s = G.GENERAL_GUEST_POD.stats;
      if (!G.GENERAL_GUEST_POD.busy && s.written + s.failed + s.skipped > before.written + before.failed + before.skipped) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { before, after: { ...G.GENERAL_GUEST_POD.stats }, usage: G.usage(G.GENERAL_GUEST.session.accountId), account: G.GENERAL_GUEST.session.accountId, pod: G.GENERAL_GUEST.session.pod };
  }, gold);
}
const everythingThePageKeeps = page => page.evaluate(async () => {
  const kept = [document.cookie, JSON.stringify(Object.entries(localStorage)), JSON.stringify(Object.entries(sessionStorage))];
  const record = await new Promise((resolve, reject) => {
    const open = indexedDB.open('hallowmarch-general-guest', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const all = open.result.transaction('keys', 'readonly').objectStore('keys').getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => reject(all.error); };
  });
  return { kept: kept.join('\n'), keys: record.map(r => ({ publicKey: r.publicKey, wrapping: r.wrappingKey?.type, extractable: r.wrappingKey?.extractable, usages: r.wrappingKey?.usages, cipherBytes: r.ciphertext?.byteLength })) };
});

test('shadow: a guest comes through the door, plays, and each save is also sealed in the browser and forwarded to its own pod', { timeout: 600000 }, async t => {
  const d = await deployment(t, { HM_GENERAL_GUEST_POD_SHADOW: '1' }), context = await browserContext(t), page = await context.newPage();
  const visit = await throughTheDoor(page, d);
  // The round trip: the game, the door, the return route (code and state), and the game again with nothing in its address.
  const origins = visit.navigations.map(url => new URL(url)).map(url => url.origin === d.door ? 'door' : url.pathname + (url.search ? '?' + [...url.searchParams.keys()].join('&') : ''));
  log('navigations:', origins.join(' -> '));
  assert.deepEqual(origins.filter((step, n) => step !== origins[n - 1]).slice(-3), ['door', '/?interego-guest', '/'].slice(-3));
  assert.equal(page.url(), d.game + '/');
  assert.deepEqual((await context.cookies()).filter(cookie => cookie.name.includes('guest-door')), [], 'the visit\'s cookie is gone once the session is collected');
  const session = await page.evaluate(() => { const s = __hm.generalGuest.GENERAL_GUEST.session; return s && { accountId: s.accountId, pod: s.pod, linked: s.linked, left: s.expiresAt - Date.now() }; });
  assert.match(session.accountId, /^gg-[0-9a-f]{40}$/); assert.equal(session.pod, 'shadow'); assert.equal(session.linked, false);
  assert.ok(session.left > 3 * 3_600_000 && session.left <= 4 * 3_600_000, 'bounded at the game\'s four hours');
  assert.equal(await page.locator('#loading-general-guest').isHidden(), true);

  await startPlaying(page, 'Synthetic Wayfarer');
  const first = await saveAndSettle(page, 4321);
  log('first save:', JSON.stringify(first.after), 'usage', JSON.stringify(first.usage));
  assert.equal(first.after.written, 1, JSON.stringify(first) + d.output()); assert.equal(first.after.failed, 0);
  // The server's save is the character, as before.
  assert.deepEqual(await d.saves(), [session.accountId + '.json']);
  const held = JSON.parse(await readFile(path.join(d.data, 'saves', session.accountId + '.json'), 'utf8'));
  assert.equal(held.char.name, 'Synthetic Wayfarer'); assert.equal(held.char.gold, 4321);
  // The pod was sent one conditional native commit of ciphertext, under the guest's token, to the guest's own document.
  const podLog = await d.podLog(), writes = podLog.filter(entry => entry.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /^https:\/\/pods\.example\/u-try-guest-[0-9a-f]{32}\/hallowmarch\/checkpoints\/[0-9a-f]{64}\.json$/);
  assert.equal(writes[0].authorized, true); assert.equal(writes[0].condition, 'absent');
  const envelope = JSON.parse(Buffer.from(JSON.parse(writes[0].body).bodyBase64, 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(envelope).sort(), ['algorithm', 'content', 'version', 'wrappedKeys']); assert.equal(envelope.wrappedKeys.length, 1);
  assert.ok(!JSON.stringify(podLog).includes('Synthetic Wayfarer') && !JSON.stringify(podLog).includes('4321'), 'nothing readable reached the pod');
  log('sealed envelope:', first.usage.bytes, 'bytes for a server save of', JSON.stringify(held).length, 'bytes');
  assert.equal(first.usage.writes, 1); assert.ok(first.usage.bytes > 300 && first.usage.bytes < 200_000);
  // The key is this browser's: made here, its secret wrapped by a key that cannot be exported; and the page never holds the pod token.
  const kept = await everythingThePageKeeps(page);
  assert.equal(kept.keys.length, 1); assert.equal(kept.keys[0].publicKey, envelope.wrappedKeys[0].recipientPublicKey);
  assert.equal(kept.keys[0].extractable, false); assert.equal(kept.keys[0].wrapping, 'secret');
  assert.ok(!kept.kept.includes(POD_TOKEN) && !(await page.content()).includes(POD_TOKEN));
  // Saves a moment apart: the server takes each, the pod's copy waits for its spacing.
  const second = await saveAndSettle(page, 5000);
  assert.equal(second.after.written, 1); assert.ok(second.after.skipped > second.before.skipped, JSON.stringify(second)); assert.equal(second.after.last, 'spaced');
  assert.equal(JSON.parse(await readFile(path.join(d.data, 'saves', session.accountId + '.json'), 'utf8')).char.gold, 5000);
  assert.equal((await d.podLog()).filter(entry => entry.method === 'PUT').length, 1);
  const stats = await d.stats();
  log('server counts:', JSON.stringify(stats.generalGuestPod), JSON.stringify(stats.generalGuest));
  assert.equal(stats.generalGuestPod.mode, 'shadow'); assert.equal(stats.generalGuestPod.written, 1); assert.equal(stats.generalGuestPod.failed, 0);
  assert.ok(!d.output().includes(POD_TOKEN) && !d.output().includes('Synthetic Wayfarer'), 'the server logs neither token nor content');
  // A reload: the same guest session, and the server's character.
  await page.reload({ waitUntil: 'commit' }); await settled(page);
  assert.equal(await page.evaluate(() => __hm.SAVE.loaded?.char?.name), 'Synthetic Wayfarer');
  assert.deepEqual(visit.errors, []);
});

test('authoritative: the character is kept in the guest\'s pod and this browser alone; the server writes no save, and another browser cannot open it', { timeout: 600000 }, async t => {
  const d = await deployment(t, { HM_GENERAL_GUEST_POD_AUTHORITATIVE: '1' }), context = await browserContext(t), page = await context.newPage();
  const visit = await throughTheDoor(page, d);
  await startPlaying(page, 'Synthetic Podkeeper');
  const first = await saveAndSettle(page, 777);
  log('first save:', JSON.stringify(first.after), 'usage', JSON.stringify(first.usage));
  assert.equal(first.pod, 'authoritative'); assert.equal(first.after.written, 1, JSON.stringify(first) + d.output());
  assert.deepEqual(await d.saves(), [], 'no saves/gg-* is written');
  const podLog = await d.podLog();
  assert.equal(podLog.filter(entry => entry.method === 'PUT').length, 1); assert.ok(!JSON.stringify(podLog).includes('Synthetic Podkeeper'));
  // A later save within the spacing stays in this browser; the pod's copy lags.
  const second = await saveAndSettle(page, 888);
  assert.equal(second.after.written, 1); assert.ok(second.after.skipped > second.before.skipped, JSON.stringify(second)); assert.deepEqual(await d.saves(), []);
  // Reload: the newer of the two copies. Then with this browser's own copy gone: the pod's, opened with this browser's key.
  await page.reload({ waitUntil: 'commit' }); await settled(page);
  assert.deepEqual(await page.evaluate(() => [__hm.SAVE.loaded?.char?.name, __hm.SAVE.loaded?.char?.gold]), ['Synthetic Podkeeper', 888]);
  await page.evaluate(account => localStorage.removeItem('hallowmarch.generalguest.save.' + account), first.account);
  await page.reload({ waitUntil: 'commit' }); await settled(page);
  const fromPod = await page.evaluate(() => ({ name: __hm.SAVE.loaded?.char?.name, gold: __hm.SAVE.loaded?.char?.gold, stats: { ...__hm.generalGuest.GENERAL_GUEST_POD.stats } }));
  log('read back from the pod:', JSON.stringify(fromPod));
  // Which save the one spaced write carried (the game's own first, or the one above) is the game's timing; never the later one.
  assert.equal(fromPod.name, 'Synthetic Podkeeper'); assert.ok(fromPod.gold !== 888 && Number.isFinite(fromPod.gold), 'the pod\'s copy lags by its spacing'); assert.equal(fromPod.stats.opened, 1);
  assert.deepEqual(await d.saves(), []);
  // The same guest in a browser without this browser's key (its key store emptied): the pod's copy does not open, and nothing of it is shown.
  await page.evaluate(() => new Promise(resolve => { const gone = indexedDB.deleteDatabase('hallowmarch-general-guest'); gone.onsuccess = gone.onerror = gone.onblocked = () => resolve(); }));
  await page.reload({ waitUntil: 'commit' }); await settled(page);
  const other = await page.evaluate(() => ({ loaded: __hm.SAVE.loaded?.char ?? null, unreadable: __hm.generalGuest.GENERAL_GUEST.podUnreadable === true, stats: { ...__hm.generalGuest.GENERAL_GUEST_POD.stats } }));
  log('without the key:', JSON.stringify(other));
  assert.equal(other.loaded, null); assert.equal(other.unreadable, true); assert.equal(other.stats.unreadable, 1);
  assert.equal((await d.stats()).generalGuestPod.written, 1);
  assert.deepEqual(visit.errors, []);
});
