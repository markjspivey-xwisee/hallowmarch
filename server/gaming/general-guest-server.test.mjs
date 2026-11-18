/** The real server with the general guest off, misconfigured, and on (issue 105). Offline: with the
 * door on, the relay's signer and identity are replaced by a made-up fixture through a module hook,
 * and guest sessions are minted with the test's own session secret. No live service is called. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { createGameSessionTokens } from './game-session.js';
import { generalGuestAccountId, GENERAL_GUEST_COOKIE } from './general-guest.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const real = new URL('./general-guest.js', import.meta.url).href, realPod = new URL('./general-guest-pod.js', import.meta.url).href;
const DOOR = 'https://door.identity.example', USERS = 'did:web:identity.example:users:';
const GUEST = USERS + 'u-try-guest-' + 'b'.repeat(32), ACCOUNT = USERS + 'u-pk-0123456789ab';
const POD_TOKEN = 'cg2_fixture_guest_application_token', POD_ENV = { HM_GAMING_SERVICE_IDENTITY_ORIGIN: 'https://identity.example', HM_GENERAL_GUEST_POD_ORIGIN: 'https://pods.example', HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-real-ip' };
const hex = value => createHash('sha256').update(value).digest('hex');
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function spawned(t, env, { fixtureSigner = false, fixtureIdentity = false, seed = null } = {}) {
  const data = await mkdtemp(path.join(tmpdir(), 'hallowmarch-general-guest-test-'));
  await mkdir(path.join(data, 'saves'));
  if (seed) await seed(data);
  const port = await freePort(), secret = 'synthetic-general-guest-session-secret';
  const args = [];
  if (fixtureSigner) {
    // Only the two outbound ports are replaced: the service agent's relay signature and identity's exchange.
    const fixture = path.join(data, 'general-guest-fixture.mjs'), podFixture = path.join(data, 'general-guest-pod-fixture.mjs'), shim = path.join(data, 'shim.mjs');
    // With `fixtureIdentity`, identity's exchange admits the made-up guest a code names ("code-<32 hex>", "linked-<32 hex>"),
    // as PROVISIONAL-PLAY.md describes its answer; without it every code is refused.
    await writeFile(fixture, `export * from ${JSON.stringify(real)};
import { configuredGeneralGuest as actual } from ${JSON.stringify(real)};
const USERS = ${JSON.stringify(USERS)}, ACCOUNT = ${JSON.stringify(ACCOUNT)};
export function configuredGeneralGuest(options) {
  return actual({ ...options,
    signGrant: async request => ({ _signed_payload: JSON.stringify({ ...request, agent_id: 'did:web:identity.example:agents:game-service' }), _signature: '0x' + 'ab'.repeat(65) }),
    fetch: async (url, init) => {
      const asked = JSON.parse(init.body), named = /^(code|linked)-([0-9a-f]{32})$/.exec(asked.code);
      if (!${JSON.stringify(fixtureIdentity)} || !named) return new Response(JSON.stringify({ valid: false, error: 'invalid_guest_code' }), { status: 401 });
      const userId = 'u-try-guest-' + named[2], ownerDid = USERS + userId, until = Math.floor(Date.now() / 1000) + 86400;
      return new Response(JSON.stringify({ valid: true, provisional: true, general: true, issuer: 'https://identity.example', audience: asked.audience, userId, ownerDid,
        podUrl: 'https://pods.example/' + userId + '/', guestExpiresAt: new Date(until * 1000).toISOString(), namespace: 'hallowmarch',
        subjectAttributes: { subject: ownerDid, provisional: true, claimed: false, standingUntil: until, admittedBy: [asked.audience], ...(named[1] === 'linked' ? { linkedTo: ACCOUNT } : {}) },
        token: ${JSON.stringify(POD_TOKEN)}, tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() }), { status: 200 });
    } });
}`);
    // The guests' pods: a document store that takes a native commit under the fixture's token, and writes down what it was sent.
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
    if (init.headers.Authorization !== 'Bearer ' + ${JSON.stringify(POD_TOKEN)}) return new Response('', { status: 401 });
    const command = JSON.parse(init.body), text = Buffer.from(command.bodyBase64, 'base64').toString('utf8');
    if ((found?.revision ?? null) !== command.expectedRevision) return new Response('', { status: 412 });
    const revision = 'sha256:' + createHash('sha256').update(text + log.length).digest('hex');
    documents.set(url, { text, revision });
    return new Response(JSON.stringify({ version: 1, status: 'committed', revision }), { status: 200, headers: { ETag: '"' + revision + '"' } });
  } });
}`);
    const swapped = { [real]: pathToFileURL(fixture).href, [realPod]: pathToFileURL(podFixture).href };
    const hooks = `const swapped = ${JSON.stringify(swapped)};
export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  return swapped[result.url] && context.parentURL !== swapped[result.url] ? { ...result, url: swapped[result.url], shortCircuit: true } : result;
}`;
    await writeFile(shim, `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}));`);
    args.push('--import', pathToFileURL(shim).href);
  }
  const child = spawn(process.execPath, [...args, path.join(root, 'server', 'server.js')], { cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), HM_DATA: data, HM_SECRET: secret, HM_PUBLIC_ORIGIN: 'https://game.example',
      HM_GAMING_BOOTSTRAP: '0', HM_GAMING_ENABLED: '0', HM_WORLD_PERSISTENCE_MODE: 'legacy',
      // These fixtures are reached directly, with no proxy before them (a test that names the proxy's header says so itself).
      ...(env.HM_GENERAL_GUEST_CLIENT_IP_HEADER === undefined ? { HM_GENERAL_GUEST_DIRECT: '1' } : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-8000); });
  const exited = once(child, 'exit'), sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    await rm(data, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`, tokens = createGameSessionTokens({ secret });
  async function started() {
    const until = Date.now() + 8000;
    while (Date.now() < until) {
      if (child.exitCode !== null) return false;
      try { if ([200, 503].includes((await fetch(base + '/health')).status)) return true; } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return false;
  }
  async function connect(token, replyType = 'welcome') {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
    await once(ws, 'open'); const messages = []; ws.on('message', bytes => messages.push(JSON.parse(String(bytes))));
    const receive = async type => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(message => message.t === type);
        if (index !== -1) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail('Local socket did not answer ' + type + ': ' + output);
    };
    ws.send(JSON.stringify({ t: 'hello', token }));
    const reply = await receive(replyType), send = message => ws.send(JSON.stringify(message)); let humanActivity = 0;
    return { [replyType]: reply, send, receive, async play() {
      send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: ++humanActivity } });
      send({ t: 'ping', c: humanActivity }); await receive('pong');
    } };
  }
  /** A guest through the door, as a browser carries it: start, the door's answer for `code`, return, collect. */
  async function throughDoor(code, address = '203.0.113.9') {
    const from = { 'X-Real-IP': address };
    const start = await visit(base, '/guest/general/start', from);
    if (start.status !== 302 || !start.headers['set-cookie']) return { start };
    const cookie = start.headers['set-cookie'][0].split(';')[0];
    const grant = JSON.parse(Buffer.from(new URL(start.headers.location).hash.slice('#grant='.length), 'base64url').toString('utf8'));
    const returned = await visit(base, `/guest/general/return?code=${code}&state=${JSON.parse(grant._signed_payload).state}`, { ...from, Cookie: cookie });
    const collected = await visit(base, '/guest/general/session', { ...from, Cookie: cookie, Origin: 'https://game.example' }, 'POST');
    return { start, returned, collected, session: collected.status === 200 ? JSON.parse(collected.body) : null };
  }
  const podLog = async () => { try { return JSON.parse(await readFile(path.join(data, 'pod-log.json'), 'utf8')); } catch { return []; } };
  return { base, child, exited, started, connect, tokens, throughDoor, podLog, data, output: () => output, file: id => path.join(data, 'saves', id + '.json') };
}
/** A request as the public origin's proxy delivers it: fetch cannot name a Host. */
const visit = (base, pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
  const call = request(base + pathname, { method, headers: { Host: 'game.example', ...headers } }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
    response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
  });
  call.once('error', reject); call.end();
});
const guestSession = (tokens, { subject = GUEST, linked = false, expiresAt = Date.now() + 3_600_000 } = {}) =>
  tokens.issueGeneralGuest(generalGuestAccountId(subject), { subjectDid: subject, guestDid: GUEST, linked, expiresAt }).token;

test('switch off: the routes are absent, nothing is advertised, and a guest session enters nothing', async t => {
  for (const value of [undefined, '0', 'true']) {
    const f = await spawned(t, value === undefined ? {} : { HM_GENERAL_GUEST: value, HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR });
    assert.ok(await f.started(), f.output());
    for (const route of ['/guest/general/start', '/guest/general/return?code=c&state=' + 's'.repeat(43)]) {
      const response = await fetch(f.base + route, { redirect: 'manual' });
      assert.equal(response.status, 404, route); assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal((await fetch(f.base + '/guest/general/session', { method: 'POST', headers: { Origin: 'https://game.example' } })).status, 404);
    assert.equal((await (await fetch(f.base + '/gaming/manifest')).json()).generalGuest, undefined);
    const denied = (await f.connect(guestSession(f.tokens), 'denied')).denied;
    assert.equal(denied.code, 'native_signin_required');
  }
});

test('switch on with a prerequisite missing: the server refuses to start, and says why', async t => {
  const missingDoor = await spawned(t, { HM_GENERAL_GUEST: '1' });
  const [code] = await missingDoor.exited;
  assert.notEqual(code, 0); assert.match(missingDoor.output(), /HM_GENERAL_GUEST=1: HM_GENERAL_GUEST_DOOR_ORIGIN is not set/);
  // No service agent (the native service is not configured here): no grant could be signed.
  const noAgent = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR });
  assert.notEqual((await noAgent.exited)[0], 0); assert.match(noAgent.output(), /HM_GENERAL_GUEST=1: the game's service agent is unavailable/);
  const noOrigin = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_PUBLIC_ORIGIN: '' }, { fixtureSigner: true });
  assert.notEqual((await noOrigin.exited)[0], 0); assert.match(noOrigin.output(), /HM_GENERAL_GUEST=1: this deployment's public origin is not configured/);
});

test('where native players are required, a live guest session passes the entry policy and an ended one does not', { timeout: 30000 }, async t => {
  // The native service is asked for but not configured here, so its ledger is unavailable: the
  // identity gate is what this isolates, as player-server.test.mjs does for native owners.
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GAMING_ENABLED: '1', HM_NATIVE_PLAYER_REQUIRED: '1' }, { fixtureSigner: true });
  assert.ok(await f.started(), f.output());
  const guest = await f.connect(guestSession(f.tokens, { expiresAt: Date.now() + 1800 }));
  await guest.play();
  assert.equal((await guest.receive('world-status')).admission, 'live');
  guest.send({ t: 'save', d: { v: 1, char: { name: 'Guest character' } } });
  assert.equal((await guest.receive('saved')).error, 'native_ownership_unavailable', 'past the identity gate; only the unavailable ledger refuses');
  // An ordinary guest account has no principal on this deployment, as before.
  const plain = await f.connect(undefined);
  plain.send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: 1 } });
  assert.equal((await plain.receive('world-status')).admission, 'identity-required');
  await new Promise(resolve => setTimeout(resolve, 2000));
  guest.send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: 9 } });
  // The live lease ends first (a standby notice), then the session's end is said.
  let ended = await guest.receive('world-status');
  if (ended.admission === 'standby') ended = await guest.receive('world-status');
  assert.equal(ended.admission, 'identity-required'); assert.equal(ended.code, 'native_signin_required');
  guest.send({ t: 'save', d: { v: 1, char: { name: 'After the bound' } } });
  assert.equal((await guest.receive('saved')).error, 'native_identity_required');
});

test('switch on: the door is advertised, and a guest session plays a server-held character until its bound', { timeout: 30000 }, async t => {
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR }, { fixtureSigner: true });
  assert.ok(await f.started(), f.output());
  assert.match(f.output(), /general guest: on \(door https:\/\/door\.identity\.example, return \/guest\/general\/return\)/);
  assert.deepEqual((await (await fetch(f.base + '/gaming/manifest')).json()).generalGuest,
    { enabled: true, startPath: '/guest/general/start', returnPath: '/guest/general/return', sessionPath: '/guest/general/session', doorOrigin: DOOR });
  assert.equal((await (await fetch(f.base + '/stats')).json()).generalGuestPod, undefined, 'no pod is configured unless asked');
  // Start: bound to the browser, then to the door. Return without a visit: a flag and nothing else.
  const start = await visit(f.base, '/guest/general/start');
  assert.equal(start.status, 302); assert.ok(start.headers.location.startsWith(DOOR + '/guest/door#grant='));
  assert.match(start.headers['set-cookie'][0], new RegExp(`^${GENERAL_GUEST_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`));
  const stray = await visit(f.base, '/guest/general/return?code=c&state=' + 's'.repeat(43));
  assert.equal(stray.headers.location, 'https://game.example/?interego-guest=refused');
  assert.equal((await fetch(f.base + '/guest/general/start', { redirect: 'manual' })).status, 403, 'another host is not this origin');

  // The guest plays as its own account, with the March's server holding its character.
  const own = guestSession(f.tokens), id = generalGuestAccountId(GUEST), guest = await f.connect(own);
  assert.equal(guest.welcome.acct.id, id); assert.equal(guest.welcome.acct.guest, true); assert.equal(guest.welcome.acct.nativeBound, false);
  assert.equal(guest.welcome.token, own, 'no long-lived bearer is handed out for a guest\'s account');
  assert.deepEqual(guest.welcome.generalGuest, { expiresAt: f.tokens.read(own).exp, linked: false });
  await guest.play();
  guest.send({ t: 'save', d: { v: 1, char: { name: 'Guest character' } } }); assert.equal((await guest.receive('saved')).ok, true);
  guest.send({ t: 'load' }); assert.equal((await guest.receive('save')).d.char.name, 'Guest character');
  // It keeps no name or password here, and a legacy bearer for its account opens nothing.
  guest.send({ t: 'acct', op: 'claim', name: 'Password Bypass', pass: 'must-not-create-this' }); assert.equal((await guest.receive('acct')).ok, false);
  assert.equal((await f.connect(f.tokens.issueLegacy(id), 'denied')).denied.code, 'native_signin_required');
  // A session whose account is not the one its subject derives enters nothing.
  const crossed = f.tokens.issueGeneralGuest(generalGuestAccountId(ACCOUNT), { subjectDid: GUEST, guestDid: GUEST, expiresAt: Date.now() + 60_000 }).token;
  assert.equal((await f.connect(crossed, 'denied')).denied.code, 'native_signin_required');
  // The native owner routes take a guest session for no account at all.
  assert.notEqual((await visit(f.base, '/gaming/identity/status', { Authorization: 'Bearer ' + own })).status, 200);

  // Linked: the account's guest character may be played and saved, never deleted, by a browser holding only a guest's key.
  const linkedId = generalGuestAccountId(ACCOUNT), linked = await f.connect(guestSession(f.tokens, { subject: ACCOUNT, linked: true, expiresAt: Date.now() + 1800 }));
  assert.equal(linked.welcome.acct.id, linkedId); assert.equal(linked.welcome.generalGuest.linked, true);
  await linked.play();
  linked.send({ t: 'save', d: { v: 1, char: { name: 'Account guest character' } } }); assert.equal((await linked.receive('saved')).ok, true);
  linked.send({ t: 'wipe' }); assert.deepEqual(await linked.receive('saved'), { t: 'saved', ok: false, error: 'linked_guest_cannot_delete' });
  assert.equal(JSON.parse(await readFile(f.file(linkedId), 'utf8')).char.name, 'Account guest character');
  // At its bound the session is over on the open socket too: nothing more is written or read.
  await new Promise(resolve => setTimeout(resolve, 2000));
  linked.send({ t: 'save', d: { v: 1, char: { name: 'After the bound' } } });
  assert.deepEqual(await linked.receive('saved'), { t: 'saved', ok: false, error: 'native_identity_required' });
  linked.send({ t: 'load' }); assert.equal((await linked.receive('save')).error, 'native_identity_required');
  assert.equal(JSON.parse(await readFile(f.file(linkedId), 'utf8')).char.name, 'Account guest character');
  // The guest itself may delete its own character.
  guest.send({ t: 'wipe' }); assert.equal((await guest.receive('saved')).ok, true);
  await assert.rejects(readFile(f.file(id), 'utf8'), /ENOENT/);
});

/** The browser's side of the pod: the shipping sealing module, with a key store of the test's own. */
globalThis.self = globalThis;
const { createGuestCheckpoint } = await import('../../client/native-pod/guest-checkpoint.mjs');
function browserVault(account) {
  const map = new Map();
  return createGuestCheckpoint({ account, storage: { load: async key => map.get(key) ?? null, create: async (key, value) => { if (!map.has(key)) map.set(key, value); return map.get(key); } } });
}
const CHARACTER = { v: 1, savedAt: 1, char: { name: 'Synthetic Shadow', realm: 0, cls: 'warrior', level: 3 } };
let asks = 0;
async function pod(socket, op, extra = {}) { const n = ++asks; socket.send({ t: 'gpod', op, n, ...extra }); const reply = await socket.receive('gpod'); assert.equal(reply.n, n); assert.equal(reply.op, op); return reply; }

test('the pod flags need the guest and the pods\' origin, or the server refuses to start', async t => {
  const noOrigin = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_POD_SHADOW: '1' }, { fixtureSigner: true });
  assert.notEqual((await noOrigin.exited)[0], 0); assert.match(noOrigin.output(), /HM_GENERAL_GUEST_POD_SHADOW=1\): HM_GENERAL_GUEST_POD_ORIGIN is not set/);
  const noGuest = await spawned(t, { HM_GENERAL_GUEST_POD_AUTHORITATIVE: '1', ...POD_ENV });
  assert.notEqual((await noGuest.exited)[0], 0); assert.match(noGuest.output(), /HM_GENERAL_GUEST_POD_AUTHORITATIVE=1\): HM_GENERAL_GUEST is not 1/);
});

test('shadow: the server\'s save stays the character, and the browser\'s sealed copy is forwarded to the guest\'s own pod', { timeout: 30000 }, async t => {
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_POD_SHADOW: '1', HM_GENERAL_GUEST_POD_LOG_MS: '1000', ...POD_ENV },
    { fixtureSigner: true, fixtureIdentity: true });
  assert.ok(await f.started(), f.output());
  assert.match(f.output(), /general guest: on \(door https:\/\/door\.identity\.example, return \/guest\/general\/return, pod shadow\)/);
  assert.equal((await (await fetch(f.base + '/gaming/manifest')).json()).generalGuest.pod, 'shadow');
  const hexId = 'd'.repeat(32), door = await f.throughDoor('code-' + hexId);
  assert.equal(door.returned.headers.location, 'https://game.example/?interego-guest=arrived', f.output());
  const id = generalGuestAccountId(USERS + 'u-try-guest-' + hexId);
  assert.equal(door.session.acct.id, id); assert.ok(!door.collected.body.includes(POD_TOKEN), 'the page is never given the pod token');
  const guest = await f.connect(door.session.token); await guest.play();
  guest.send({ t: 'save', d: CHARACTER }); assert.equal((await guest.receive('saved')).ok, true);
  assert.equal(JSON.parse(await readFile(f.file(id), 'utf8')).char.name, 'Synthetic Shadow', 'the server\'s save is written as before');
  const vault = browserVault(id), sealed = await vault.seal(CHARACTER);
  const put = await pod(guest, 'put', { env: sealed.envelope });
  assert.equal(put.ok, true, JSON.stringify(put)); assert.equal(put.budget.writesLeft, 191);
  const log = await f.podLog(), write = log.find(entry => entry.method === 'PUT');
  assert.equal(write.url, `https://pods.example/u-try-guest-${hexId}/hallowmarch/checkpoints/${hex(`urn:graph:hallowmarch:player-profile:${hex(USERS + 'u-try-guest-' + hexId)}`)}.json`);
  assert.equal(write.authorized, true); assert.equal(write.type, 'application/vnd.interego.native-commit+json'); assert.equal(write.condition, 'absent');
  assert.ok(log.filter(entry => entry.method === 'GET').every(entry => !entry.authorized), 'reads carry no bearer');
  assert.ok(!JSON.stringify(log).includes('Synthetic Shadow'), 'only ciphertext reached the pod');
  assert.equal((await vault.open(JSON.parse(Buffer.from(JSON.parse(write.body).bodyBase64, 'base64').toString('utf8')))).save.char.name, 'Synthetic Shadow');
  // Spaced: a second write at once is refused here and never reaches the pod. Anything but an envelope is refused too.
  assert.equal((await pod(guest, 'put', { env: sealed.envelope })).code, 'too_soon');
  assert.equal((await pod(guest, 'put', { env: { ...sealed.envelope, plain: CHARACTER } })).code, 'not_sealed');
  assert.equal((await f.podLog()).filter(entry => entry.method === 'PUT').length, 1);
  // The server still serves its own save; the pod's copy can be read back sealed.
  guest.send({ t: 'load' }); assert.equal((await guest.receive('save')).d.char.name, 'Synthetic Shadow');
  assert.equal((await vault.open((await pod(guest, 'get')).env)).save.char.name, 'Synthetic Shadow');
  // The usage is kept with the account (a restart cannot reset it), and the counts are logged without content.
  await new Promise(resolve => setTimeout(resolve, 1500));
  const account = JSON.parse(await readFile(path.join(f.data, 'accounts.json'), 'utf8'))[id];
  assert.equal(account.pod.writes, 1); assert.equal(account.pod.bytes, sealed.bytes); assert.ok(account.guestUntil > Date.now());
  assert.ok(!JSON.stringify(account).includes(POD_TOKEN), 'the pod token is never written down');
  assert.match(f.output(), /general guest pod \(shadow\): \{"guests":1,"admitted":1,"written":1,"refused":2,"failed":0,"read":1,/);
  assert.ok(!f.output().includes(POD_TOKEN) && !f.output().includes('Synthetic Shadow'));
  const stats = (await (await fetch(f.base + '/stats')).json()).generalGuestPod;
  assert.equal(stats.mode, 'shadow'); assert.equal(stats.written, 1); assert.deepEqual(stats.reasons, { too_soon: 1, not_sealed: 1 });
  // A linked guest plays an account's character: nothing of it goes to the guest's pod.
  const linkedDoor = await f.throughDoor('linked-' + 'e'.repeat(32)), linked = await f.connect(linkedDoor.session.token);
  assert.equal(linkedDoor.session.linked, true);
  assert.equal((await pod(linked, 'put', { env: sealed.envelope })).code, 'linked');
  // A session the server holds no pod token for (it restarted since the door): the page is told to go back through it.
  const cold = await f.connect(guestSession(f.tokens));
  assert.deepEqual([(await pod(cold, 'budget')).code, (await pod(cold, 'put', { env: sealed.envelope })).code], ['reauth', 'reauth']);
});

test('authoritative: the pod\'s sealed copy is an unlinked guest\'s character, and the server writes no save for it', { timeout: 30000 }, async t => {
  const hexId = 'f'.repeat(32), id = generalGuestAccountId(USERS + 'u-try-guest-' + hexId);
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_POD_AUTHORITATIVE: '1', ...POD_ENV },
    { fixtureSigner: true, fixtureIdentity: true, seed: data => writeFile(path.join(data, 'saves', id + '.json'), JSON.stringify({ v: 1, char: { name: 'Kept Before' } })) });
  assert.ok(await f.started(), f.output());
  assert.equal((await (await fetch(f.base + '/gaming/manifest')).json()).generalGuest.pod, 'authoritative');
  const door = await f.throughDoor('code-' + hexId);
  assert.equal(door.returned?.headers.location, 'https://game.example/?interego-guest=arrived', f.output() + JSON.stringify(door.start));
  const guest = await f.connect(door.session.token); await guest.play();
  assert.equal((await pod(guest, 'budget')).ok, true);
  // A character the server kept before the flag is read once more, never written again.
  assert.equal((await pod(guest, 'get')).env, null);
  guest.send({ t: 'load' }); assert.equal((await guest.receive('save')).d.char.name, 'Kept Before');
  guest.send({ t: 'save', d: CHARACTER }); assert.deepEqual(await guest.receive('saved'), { t: 'saved', ok: false, error: 'guest_pod_only' });
  assert.equal(JSON.parse(await readFile(f.file(id), 'utf8')).char.name, 'Kept Before');
  const vault = browserVault(id);
  assert.equal((await pod(guest, 'put', { env: (await vault.seal(CHARACTER)).envelope })).ok, true);
  await assert.rejects(readFile(f.file(id), 'utf8'), /ENOENT/, 'once the pod holds it, the server\'s copy is removed');
  assert.equal((await vault.open((await pod(guest, 'get')).env)).save.char.name, 'Synthetic Shadow');
  guest.send({ t: 'load' }); assert.equal((await guest.receive('save')).d, null);
  assert.deepEqual((await readdir(path.join(f.data, 'saves'))).filter(name => name.startsWith('gg-')), []);
  // An account's guest character (a linked guest) stays with the server, as before.
  const linkedDoor = await f.throughDoor('linked-' + 'e'.repeat(32)), linked = await f.connect(linkedDoor.session.token); await linked.play();
  linked.send({ t: 'save', d: { v: 1, char: { name: 'Account guest character' } } }); assert.equal((await linked.receive('saved')).ok, true);
  assert.equal(JSON.parse(await readFile(f.file(generalGuestAccountId(ACCOUNT)), 'utf8')).char.name, 'Account guest character');
});

test('the door is bounded for each client address, as the deployment\'s proxy states it', { timeout: 30000 }, async t => {
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-real-ip' }, { fixtureSigner: true });
  assert.ok(await f.started(), f.output());
  for (let n = 0; n < 6; n++) assert.ok((await visit(f.base, '/guest/general/start', { 'X-Real-IP': '198.51.100.20' })).headers.location.startsWith(DOOR));
  assert.equal((await visit(f.base, '/guest/general/start', { 'X-Real-IP': '198.51.100.20' })).headers.location, 'https://game.example/?interego-guest=busy');
  assert.ok((await visit(f.base, '/guest/general/start', { 'X-Real-IP': '198.51.100.21' })).headers.location.startsWith(DOOR), 'another visitor is not held by it');
  assert.equal((await visit(f.base, '/guest/general/start', { 'X-Real-IP': '198.51.100.22', 'Sec-Fetch-Site': 'cross-site' })).headers.location, 'https://game.example/?interego-guest=refused');
});

const saveNames = async data => (await readdir(path.join(data, 'saves'))).filter(name => !name.endsWith('.guest.json')).sort();
const recordNames = async data => (await readdir(path.join(data, 'saves'))).filter(name => name.endsWith('.guest.json')).sort();
const record = (data, id, kept) => writeFile(path.join(data, 'saves', id + '.guest.json'), JSON.stringify({ v: 1, id, ...kept }));

test('a guest\'s save does not outlive the guest: expired accounts and their saves are removed, at start and with the door off', { timeout: 30000 }, async t => {
  const day = 86_400_000, now = Date.now(), id = n => 'gg-' + String(n).repeat(40);
  const accounts = {
    [id(1)]: { id: id(1), name: 'Guest', guest: true, generalGuest: true, created: now - 3 * day, last: now - 3 * day, guestUntil: now - 2 * day, pod: { writes: 4, bytes: 4000, lastAt: 1, full: false } },
    [id(2)]: { id: id(2), name: 'Guest', guest: true, generalGuest: true, created: now - 9 * day, last: now - 9 * day },
    [id(3)]: { id: id(3), name: 'Guest', guest: true, generalGuest: true, created: now - 3 * day, last: now - 60_000, guestUntil: now + day },
    [id(4)]: { id: id(4), name: 'Guest', guest: true, generalGuest: true, linked: true, created: now - 400 * day, last: now - 400 * day }, // a registered account's: kept, however idle
    gplainguest: { id: 'gplainguest', name: 'Guest', guest: true, created: now - 400 * day, last: now - 400 * day },
  };
  const seed = async data => {
    await writeFile(path.join(data, 'accounts.json'), JSON.stringify(accounts));
    for (const name of [id(1), id(2), id(3), id(4), id(5), id(6), id(7), id(8), id(9), 'gplainguest']) await writeFile(path.join(data, 'saves', name + '.json'), JSON.stringify({ v: 1, char: { name } }));
    // Saves with no account entry. With a record of their own, the record decides, by the sweep's rule:
    await record(data, id(5), { linked: false, guestUntil: now - 2 * day, last: now - 3 * day });   // an unlinked guest past its deadline
    await record(data, id(6), { linked: true, guestUntil: null, last: now - 400 * day });           // a registered account's
    await record(data, id(7), { linked: false, guestUntil: now + day, last: now - 60_000 });        // a guest still alive
    // With none (id 8, long untouched; id 9, new), neither age nor the missing entry removes them.
    const old = new Date(now - 400 * day); await utimes(path.join(data, 'saves', id(8) + '.json'), old, old);
    await writeFile(path.join(data, 'saves', id(1) + '.guest.json'), 'not a record');
  };
  const f = await spawned(t, {}, { seed });
  assert.ok(await f.started(), f.output());
  assert.match(f.output(), /general guest cleanup: 2 expired accounts, 3 saves removed/);
  assert.match(f.output(), /general guest cleanup: 2 saves with no account entry and no record of their own are kept/);
  assert.equal(f.output().split('\n').filter(line => /general guest cleanup/.test(line)).length, 2);
  assert.deepEqual(await saveNames(f.data), [id(3), id(4), id(6), id(7), id(8), id(9), 'gplainguest'].map(name => name + '.json').sort());
  // Every guest account still here states its own record, and a removed save's record goes with it.
  assert.deepEqual(await recordNames(f.data), [id(3), id(4), id(6), id(7)].map(name => name + '.guest.json').sort());
  assert.deepEqual(JSON.parse(await readFile(path.join(f.data, 'saves', id(4) + '.guest.json'), 'utf8')), { v: 1, id: id(4), linked: true, guestUntil: null, last: now - 400 * day });
  assert.deepEqual(JSON.parse(await readFile(path.join(f.data, 'saves', id(3) + '.guest.json'), 'utf8')), { v: 1, id: id(3), linked: false, guestUntil: now + day, last: now - 60_000 });
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(f.data, 'accounts.json'), 'utf8'))).sort(), [id(3), id(4), 'gplainguest'].sort());
  // Where the deployment opted into an idle age for accounts' characters, an account's own record is judged by it too.
  const g = await spawned(t, { HM_GENERAL_GUEST_SWEEP_MS: '1000', HM_GENERAL_GUEST_LINKED_IDLE_DAYS: '20' }, { seed });
  assert.ok(await g.started(), g.output());
  assert.match(g.output(), /general guest cleanup: 3 expired accounts, 5 saves removed/, 'a shorter idle age for accounts\' characters, as configured');
  assert.deepEqual(await saveNames(g.data), [id(3), id(7), id(8), id(9), 'gplainguest'].map(name => name + '.json').sort());
});

test('a save whose account entry is gone is never removed for its age: with the table lost, only its own record ends it', { timeout: 30000 }, async t => {
  const day = 86_400_000, now = Date.now(), id = n => 'gg-' + String(n).repeat(40), old = new Date(now - 30 * day);
  const saves = async data => {
    for (const name of [id(1), id(2), id(3), id(4), id(5), 'gplainguest']) {
      await writeFile(path.join(data, 'saves', name + '.json'), JSON.stringify({ v: 1, char: { name: 'Synthetic ' + name.slice(0, 6) } }));
      await utimes(path.join(data, 'saves', name + '.json'), old, old);
    }
    await record(data, id(3), { linked: true, guestUntil: null, last: now - 30 * day });              // a registered account's guest character
    await record(data, id(4), { linked: false, guestUntil: now - 29 * day, last: now - 30 * day });   // a guest long gone
    await writeFile(path.join(data, 'saves', id(5) + '.guest.json'), JSON.stringify({ v: 1, id: id(4), linked: false, guestUntil: 1, last: 1 })); // another save's record
  };
  const kept = [id(1), id(2), id(3), id(5), 'gplainguest'].map(name => name + '.json').sort();
  const cases = {
    absent: async () => {},
    empty: async data => { await writeFile(path.join(data, 'accounts.json'), '{}'); },
    unparseable: async data => { await writeFile(path.join(data, 'accounts.json'), '{"' + id(1) + '":{"id":"' + id(1) + '","name":"Synthetic trunc'); },
    'not a table': async data => { await writeFile(path.join(data, 'accounts.json'), '[]'); },
    unreadable: async data => { await mkdir(path.join(data, 'accounts.json')); },
  };
  for (const [state, table] of Object.entries(cases)) {
    const f = await spawned(t, { HM_GENERAL_GUEST_SWEEP_MS: '1000' }, { seed: async data => { await saves(data); await table(data); } });
    assert.ok(await f.started(), f.output());
    await new Promise(resolve => setTimeout(resolve, 1300));
    assert.deepEqual(await saveNames(f.data), kept, state);
    const said = f.output().split('\n').filter(line => /general guest cleanup/.test(line));
    assert.deepEqual(said.map(line => line.replace(/^.*general guest cleanup: /, '')).sort(),
      ['0 expired accounts, 1 saves removed', '3 saves with no account entry and no record of their own are kept'], state + ': one line each, however often it sweeps');
    assert.doesNotMatch(f.output(), /Synthetic/, state + ': nothing of the file is logged');
    f.child.kill('SIGTERM'); await f.exited;
  }
});

test('an account table that cannot be read or parsed is moved aside before anything writes over it', { timeout: 30000 }, async t => {
  const id = 'gg-' + '1'.repeat(40);
  const cases = {
    unparseable: '{"aNamed":{"id":"aNamed","name":"Synthetic Named","pass":{"salt":"synthetic","hash":"synthetic"}},"' + id + '":{"id":"' + id + '","name":"Synthetic trunc',
    'not a table': '["Synthetic list"]',
  };
  const play = async f => { const guest = await f.connect(undefined); await guest.play(); await new Promise(resolve => setTimeout(resolve, 900)); };
  const asides = async f => (await readdir(f.data)).filter(name => name.startsWith('accounts.json.corrupt-')).sort();
  for (const [state, text] of Object.entries(cases)) {
    const f = await spawned(t, {}, { seed: data => writeFile(path.join(data, 'accounts.json'), text) });
    assert.ok(await f.started(), f.output());
    const [aside] = await asides(f);
    assert.match(aside ?? '', /^accounts\.json\.corrupt-\d{8}T\d{6}Z$/, state);
    assert.equal(await readFile(path.join(f.data, aside), 'utf8'), text, state + ': what was there is kept, byte for byte');
    const said = f.output().split('\n').filter(line => /^accounts: /.test(line));
    assert.equal(said.length, 1, state); assert.ok(said[0].includes('moved aside as ' + aside), said[0]);
    assert.doesNotMatch(f.output(), /Synthetic/, state + ': nothing of the file is logged');
    await play(f);
    assert.equal(await readFile(path.join(f.data, aside), 'utf8'), text, state + ': still there after the table was written');
    assert.equal(typeof JSON.parse(await readFile(path.join(f.data, 'accounts.json'), 'utf8')), 'object');
    f.child.kill('SIGTERM'); await f.exited;
  }
  // An earlier bad file already set aside under the name this one would take in the same second is never written over.
  const stamp = at => new Date(at).toISOString().replace(/[-:]|\.\d+/g, '');
  const again = await spawned(t, {}, { seed: async data => {
    await writeFile(path.join(data, 'accounts.json'), cases.unparseable);
    for (let n = -2; n < 25; n++) await writeFile(path.join(data, 'accounts.json.corrupt-' + stamp(Date.now() + n * 1000)), 'synthetic earlier ' + n);
  } });
  assert.ok(await again.started(), again.output());
  const all = await asides(again), second = all.filter(name => /Z-1$/.test(name));
  assert.equal(all.length, 28); assert.equal(second.length, 1);
  assert.equal(await readFile(path.join(again.data, second[0]), 'utf8'), cases.unparseable);
  for (const name of all) if (name !== second[0]) assert.match(await readFile(path.join(again.data, name), 'utf8'), /^synthetic earlier /);
  // Not a file at all: moved aside the same way, and the table can be written again.
  const dir = await spawned(t, {}, { seed: async data => { await mkdir(path.join(data, 'accounts.json')); await writeFile(path.join(data, 'accounts.json', 'inside'), 'synthetic'); } });
  assert.ok(await dir.started(), dir.output());
  const [moved] = await asides(dir);
  assert.equal(await readFile(path.join(dir.data, moved, 'inside'), 'utf8'), 'synthetic');
  await play(dir);
  assert.equal(typeof JSON.parse(await readFile(path.join(dir.data, 'accounts.json'), 'utf8')), 'object');
  // A table that was read, and one that is merely absent: nothing is moved, nothing is said.
  const table = { aNamed: { id: 'aNamed', name: 'Synthetic Named', guest: false, created: 1, last: 1 } };
  for (const seed of [data => writeFile(path.join(data, 'accounts.json'), JSON.stringify(table)), async () => {}]) {
    const fine = await spawned(t, {}, { seed });
    assert.ok(await fine.started(), fine.output());
    await play(fine);
    assert.deepEqual(await asides(fine), []); assert.doesNotMatch(fine.output(), /^accounts: /m);
    assert.ok(Object.keys(JSON.parse(await readFile(path.join(fine.data, 'accounts.json'), 'utf8'))).length >= 1);
    fine.child.kill('SIGTERM'); await fine.exited;
  }
});

test('a general guest\'s save is written with its record beside it: whose kind of character, and until when', { timeout: 30000 }, async t => {
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, ...POD_ENV }, { fixtureSigner: true, fixtureIdentity: true });
  assert.ok(await f.started(), f.output());
  const kept = async id => JSON.parse(await readFile(path.join(f.data, 'saves', id + '.guest.json'), 'utf8'));
  const door = await f.throughDoor('code-' + 'a'.repeat(32)), id = door.session.acct.id;
  assert.deepEqual(await readdir(path.join(f.data, 'saves')), [], 'no record where there is no save');
  const guest = await f.connect(door.session.token); await guest.play();
  guest.send({ t: 'save', d: { v: 1, char: { name: 'Synthetic guest character' } } }); assert.equal((await guest.receive('saved')).ok, true);
  const first = await kept(id);
  assert.deepEqual(Object.keys(first).sort(), ['guestUntil', 'id', 'last', 'linked', 'v']);
  assert.equal(first.id, id); assert.equal(first.linked, false); assert.ok(first.guestUntil > Date.now() && first.guestUntil <= Date.now() + 86_400_000);
  assert.ok(!JSON.stringify(first).includes('Synthetic'), 'nothing of the character is in it');
  const linkedDoor = await f.throughDoor('linked-' + 'e'.repeat(32)), linkedId = linkedDoor.session.acct.id, linked = await f.connect(linkedDoor.session.token);
  await linked.play();
  linked.send({ t: 'save', d: { v: 1, char: { name: 'Synthetic account guest character' } } }); assert.equal((await linked.receive('saved')).ok, true);
  assert.deepEqual({ ...(await kept(linkedId)), last: 0 }, { v: 1, id: linkedId, linked: true, guestUntil: null, last: 0 });
});

test('the server refuses to start with the guest on and no way to tell its clients apart', { timeout: 30000 }, async t => {
  const blind = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_DIRECT: '' }, { fixtureSigner: true });
  assert.notEqual((await blind.exited)[0], 0);
  assert.match(blind.output(), /HM_GENERAL_GUEST=1: HM_GENERAL_GUEST_CLIENT_IP_HEADER is not set/);
  // Behind two proxies: the entry the outer trusted proxy appended, not what the client wrote before it.
  const f = await spawned(t, { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-forwarded-for', HM_GENERAL_GUEST_CLIENT_IP_HOPS: '2' }, { fixtureSigner: true });
  assert.ok(await f.started(), f.output());
  for (let n = 0; n < 6; n++) assert.ok((await visit(f.base, '/guest/general/start', { 'X-Forwarded-For': `10.0.0.${n}, 198.51.100.30, 172.16.0.1` })).headers.location.startsWith(DOOR));
  assert.equal((await visit(f.base, '/guest/general/start', { 'X-Forwarded-For': '10.9.9.9, 198.51.100.30, 172.16.0.2' })).headers.location, 'https://game.example/?interego-guest=busy');
  assert.ok((await visit(f.base, '/guest/general/start', { 'X-Forwarded-For': '198.51.100.30, 198.51.100.31, 172.16.0.1' })).headers.location.startsWith(DOOR));
});
