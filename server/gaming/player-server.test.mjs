import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createGameSessionTokens } from './game-session.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function fixture(t, enabled = false, required = false) {
  const data = await mkdtemp(path.join(tmpdir(), 'hallowmarch-native-account-test-'));
  const saves = path.join(data, 'saves');
  const { mkdir } = await import('node:fs/promises'); await mkdir(saves);
  const original = JSON.stringify({ v: 1, player: { name: 'Preserved original character', inventory: ['original-item'] } });
  await writeFile(path.join(saves, 'alice.json'), original);
  await writeFile(path.join(data, 'accounts.json'), JSON.stringify({
    alice: { id: 'alice', name: 'Alice', guest: true, nativeBound: true },
    bob: { id: 'bob', name: 'Bob', guest: true },
  }));
  const port = await freePort(), secret = 'synthetic-local-server-session-secret';
  const tokens = createGameSessionTokens({ secret });
  const child = spawn(process.execPath, [path.join(root, 'server', 'server.js')], { cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), HM_DATA: data, HM_SECRET: secret,
      HM_PUBLIC_ORIGIN: 'https://game.example', HM_GAMING_BOOTSTRAP: '0', HM_GAMING_ENABLED: enabled ? '1' : '0',
      HM_NATIVE_PLAYER_REQUIRED: required ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-8000); });
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; }
    await rm(data, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 8000; let started = false;
  while (Date.now() < until) {
    if (child.exitCode !== null) assert.fail('Local server failed: ' + output);
    try { const response = await fetch(base + '/health'); if ([200, 503].includes(response.status)) { started = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert(started, 'Local server starts: ' + output);
  async function connect(token) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.push(ws);
    await once(ws, 'open'); const messages = []; ws.on('message', bytes => messages.push(JSON.parse(String(bytes))));
    const receive = async type => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const index = messages.findIndex(message => message.t === type);
        if (index !== -1) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail('Local socket did not answer ' + type);
    };
    ws.send(JSON.stringify({ t: 'hello', token }));
    return { ws, receive, welcome: await receive('welcome'), send: message => ws.send(JSON.stringify(message)) };
  }
  return { base, connect, tokens, original, file: id => path.join(saves, id + '.json') };
}

test('real server preserves native game credentials and prevents personal-file save/wipe/load fallback', async t => {
  const f = await fixture(t), native = f.tokens.issueNative('alice', 'did:example:alice');
  const alice = await f.connect(native.token);
  assert.equal(alice.welcome.token, native.token); assert.equal(alice.welcome.acct.nativeBound, true);
  alice.send({ t: 'save', d: { v: 1, player: { name: 'Must not overwrite' } } });
  assert.equal((await alice.receive('saved')).error, 'nativepodsave_required');
  alice.send({ t: 'wipe' }); assert.equal((await alice.receive('saved')).error, 'nativepodsave_required');
  alice.send({ t: 'load' }); const loaded = await alice.receive('save');
  assert.equal(loaded.error, 'nativepodsave_required'); assert.equal(loaded.d, null);
  assert.equal(await readFile(f.file('alice'), 'utf8'), f.original);
  alice.send({ t: 'acct', op: 'claim', name: 'Legacy Password Bypass', pass: 'must-not-create-this' });
  assert.equal((await alice.receive('acct')).ok, false);
  alice.send({ t: 'slow', d: { r: 0, on: 1, nativeParticipant: true } });
  assert.equal((await alice.receive('company')).s.guest, true);
  alice.send({ t: 'co', op: 'found', name: 'Copper Watch', nativeParticipant: true });
  const refusedCompany = await alice.receive('co'); assert.equal(refusedCompany.ok, false); assert.match(refusedCompany.why, /native owner/);
  const bob = await f.connect(f.tokens.issueLegacy('bob'));
  assert.equal(f.tokens.read(bob.welcome.token).nativeDid, undefined);
  bob.send({ t: 'save', d: { v: 1, player: { name: 'Legacy Bob' } } }); assert.equal((await bob.receive('saved')).ok, true);
  assert.equal(JSON.parse(await readFile(f.file('bob'), 'utf8')).player.name, 'Legacy Bob');
  assert.equal((await fetch(f.base + '/gaming/identity/finish')).status, 200);
  const manifestResponse = await fetch(f.base + '/gaming/manifest');
  assert.equal(manifestResponse.headers.get('access-control-allow-origin'), '*', 'public entry policy is readable by an external game client');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.playerIdentity, undefined, 'intentionally unconfigured legacy servers advertise no native entry policy');
});

test('configured native ownership outage blocks unknown-account central writes without touching old files', async t => {
  const f = await fixture(t, true), bob = await f.connect(f.tokens.issueLegacy('bob'));
  bob.send({ t: 'save', d: { v: 1, player: { name: 'Must remain local pending native authority' } } });
  const saved = await bob.receive('saved'); assert.equal(saved.ok, false); assert.equal(saved.error, 'native_ownership_unavailable');
  bob.send({ t: 'load' }); const loaded = await bob.receive('save');
  assert.equal(loaded.error, 'native_ownership_unavailable'); assert.equal(loaded.d, null);
  await assert.rejects(readFile(f.file('bob')), { code: 'ENOENT' });
  assert.equal(await readFile(f.file('alice'), 'utf8'), f.original);
  const manifest = await (await fetch(f.base + '/gaming/manifest')).json();
  assert.equal(manifest.playerIdentity.affordances, 'https://game.example/gaming/identity/affordances');
  assert.equal(manifest.playerIdentity.enabled, false, 'a configured outage retains the native entry contract');
});

test('native-required deployment rejects legacy participation and personal-file writes before owner verification', async t => {
  const f = await fixture(t, true, true), bob = await f.connect(f.tokens.issueLegacy('bob'));
  const manifest = await (await fetch(f.base + '/gaming/manifest')).json();
  assert.equal(manifest.playerIdentity.required, true); assert.equal(manifest.requiresVerifiedPlayers, true);
  for (const message of [{ t: 'save', d: { v: 1, char: null } }, { t: 'wipe' }]) {
    bob.send(message); const result = await bob.receive('saved');
    assert.equal(result.ok, false); assert.equal(result.error, 'native_identity_required');
  }
  bob.send({ t: 'load' }); assert.equal((await bob.receive('save')).error, 'native_identity_required');
  bob.send({ t: 'ping', c: 42 }); assert.equal((await bob.receive('pong')).c, 42, 'sign-in transport remains usable');
  await assert.rejects(readFile(f.file('bob')), { code: 'ENOENT' });
  assert.equal(await readFile(f.file('alice'), 'utf8'), f.original);
});
