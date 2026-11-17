/** The real server with the general guest off, misconfigured, and on (issue 105). Offline: with the
 * door on, the relay's signer and identity are replaced by a made-up fixture through a module hook,
 * and guest sessions are minted with the test's own session secret. No live service is called. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { WebSocket } from 'ws';
import { createGameSessionTokens } from './game-session.js';
import { generalGuestAccountId, GENERAL_GUEST_COOKIE } from './general-guest.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const real = new URL('./general-guest.js', import.meta.url).href;
const DOOR = 'https://door.identity.example', USERS = 'did:web:identity.example:users:';
const GUEST = USERS + 'u-try-guest-' + 'b'.repeat(32), ACCOUNT = USERS + 'u-pk-0123456789ab';
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function spawned(t, env, { fixtureSigner = false } = {}) {
  const data = await mkdtemp(path.join(tmpdir(), 'hallowmarch-general-guest-test-'));
  await mkdir(path.join(data, 'saves'));
  const port = await freePort(), secret = 'synthetic-general-guest-session-secret';
  const args = [];
  if (fixtureSigner) {
    // Only the two outbound ports are replaced: the service agent's relay signature and identity's exchange.
    const fixture = path.join(data, 'general-guest-fixture.mjs'), shim = path.join(data, 'shim.mjs');
    await writeFile(fixture, `export * from ${JSON.stringify(real)};
import { configuredGeneralGuest as actual } from ${JSON.stringify(real)};
export function configuredGeneralGuest(options) {
  return actual({ ...options,
    signGrant: async request => ({ _signed_payload: JSON.stringify({ ...request, agent_id: 'did:web:identity.example:agents:game-service' }), _signature: '0x' + 'ab'.repeat(65) }),
    fetch: async () => new Response(JSON.stringify({ valid: false, error: 'invalid_guest_code' }), { status: 401 }) });
}`);
    const hooks = `export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  return result.url === ${JSON.stringify(real)} && context.parentURL !== ${JSON.stringify(pathToFileURL(fixture).href)}
    ? { ...result, url: ${JSON.stringify(pathToFileURL(fixture).href)}, shortCircuit: true } : result;
}`;
    await writeFile(shim, `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hooks)}));`);
    args.push('--import', pathToFileURL(shim).href);
  }
  const child = spawn(process.execPath, [...args, path.join(root, 'server', 'server.js')], { cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), HM_DATA: data, HM_SECRET: secret, HM_PUBLIC_ORIGIN: 'https://game.example',
      HM_GAMING_BOOTSTRAP: '0', HM_GAMING_ENABLED: '0', HM_WORLD_PERSISTENCE_MODE: 'legacy', ...env },
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
  return { base, child, exited, started, connect, tokens, output: () => output, file: id => path.join(data, 'saves', id + '.json') };
}
/** A request as the public origin's proxy delivers it: fetch cannot name a Host. */
const visit = (base, pathname, headers = {}) => new Promise((resolve, reject) => {
  const call = request(base + pathname, { method: 'GET', headers: { Host: 'game.example', ...headers } }, response => {
    response.resume(); response.once('end', () => resolve({ status: response.statusCode, headers: response.headers }));
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
