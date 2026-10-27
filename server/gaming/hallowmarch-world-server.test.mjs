import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { loadRealmModule } from '../season.js';
import { createProgressiveOwnedState } from './progressive-owned-state.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const realm = loadRealmModule(path.join(root, 'src'), path.join(root, 'server'));
const world = { k: [0, 0, 1, 1, 2, 2], g: [1, 1, 1, 1, 1, 1], td: 0.3, tm: 0, cn: 3, at: 1000 };
const seedSeason = () => ({ ...realm.realmSimInit(17, { len: 28 * 86400, season: 7 }), n: 7, savedAt: Date.now() });
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

// Explicit local load/commit contract fixture. The production server module is
// real; only its configured provider is replaced by a Node test loader. This
// backend is not a production native store and makes no encryption claims.
const providerSource = `
import fs from 'node:fs';
const WORLD = 'hallowmarch-world-season-v1';
export async function configuredGamingStore(env) {
  const read = () => JSON.parse(fs.readFileSync(env.TEST_DURABLE_FILE, 'utf8'));
  const control = () => JSON.parse(fs.readFileSync(env.TEST_CONTROL_FILE, 'utf8'));
  return { owner: 'did:web:world-test.example', ready: async () => {},
    async load(id) {
      if (id === WORLD && control().loadError) throw new Error('private test credential');
      return structuredClone(read().streams[id] || {version: 0, state: null});
    },
    async commit(id, input) {
      const fault = control();
      if (id === WORLD && fault.holdMs) await new Promise(resolve => setTimeout(resolve, fault.holdMs));
      if (id === WORLD && fault.commitError) throw new Error('private test transport');
      if (id === WORLD && fault.corruptAck) return {version: input.expectedVersion + 1,
        state: {...input.state, digest: 'sha256:corrupt-test-acknowledgement'}};
      const data = read(), key = id + ':' + input.idempotencyKey, previous = data.operations[key];
      if (previous) return structuredClone(previous);
      const current = data.streams[id] || {version: 0, state: null};
      if (current.version !== input.expectedVersion) throw Object.assign(new Error('changed'), {code: 'VERSION_CONFLICT'});
      const result = {version: current.version + 1, state: structuredClone(input.state), events: input.event ? [input.event] : []};
      data.streams[id] = result; data.operations[key] = result;
      fs.writeFileSync(env.TEST_DURABLE_FILE + '.tmp', JSON.stringify(data)); fs.renameSync(env.TEST_DURABLE_FILE + '.tmp', env.TEST_DURABLE_FILE);
      return structuredClone(result);
    }
  };
}
`;

async function fixture(t, { worlds = { march: world }, season = seedSeason(), control = {} } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hallowmarch-owned-world-'));
  const data = path.join(directory, 'data'), durable = path.join(directory, 'durable.json'), controls = path.join(directory, 'control.json');
  await mkdir(data); await writeFile(durable, JSON.stringify({ streams: {}, operations: {} })); await writeFile(controls, JSON.stringify(control));
  if (worlds !== undefined) await writeFile(path.join(data, 'worlds.json'), typeof worlds === 'string' ? worlds : JSON.stringify(worlds));
  if (season !== undefined) await writeFile(path.join(data, 'season.json'), typeof season === 'string' ? season : JSON.stringify(season));
  const provider = path.join(directory, 'provider.mjs'), loader = path.join(directory, 'loader.mjs'), preload = path.join(directory, 'preload.mjs');
  await writeFile(provider, providerSource);
  await writeFile(loader, `export async function resolve(specifier, context, next) {
    if (context.parentURL === ${JSON.stringify(pathToFileURL(path.join(root, 'server/server.js')).href)} && specifier === './gaming/provider.js')
      return {url:${JSON.stringify(pathToFileURL(provider).href)},shortCircuit:true};
    return next(specifier, context);
  }`);
  await writeFile(preload, `import {register} from 'node:module'; register(new URL('./loader.mjs', import.meta.url));`);
  const children = [], sockets = [];
  async function stop(child) {
    if (child.exitCode !== null) return;
    const done = once(child, 'exit'); child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 17000); await done; clearTimeout(timeout);
  }
  t.after(async () => { for (const socket of sockets) socket.terminate(); for (const child of children) await stop(child); await rm(directory, { recursive: true, force: true }); });
  async function start({ expectFailure = false, env = {}, loaderEnabled = true } = {}) {
    const port = await freePort(), base = 'http://127.0.0.1:' + port;
    const child = spawn(process.execPath, [...(loaderEnabled ? ['--import', preload] : []), path.join(root, 'server/server.js')], {
      cwd: root, env: { PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), HM_DATA: data,
        HM_SECRET: 'synthetic-local-world-test-secret', HM_GAMING_BOOTSTRAP: '0', HM_GAMING_ENABLED: '1',
        HM_PUBLIC_ORIGIN: 'https://game.example', HM_ADMIN: 'synthetic-world-admin', HM_SEASON_STEP: '600000', HM_WORLD_CHECKPOINT_MS: '60000',
        TEST_DURABLE_FILE: durable, TEST_CONTROL_FILE: controls, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { output = (output + bytes).slice(-12000); });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && child.exitCode === null) {
      try { const response = await fetch(base + '/health'); if ([200, 503].includes(response.status)) {
        if (expectFailure) assert.fail('Native world served a stale fallback');
        return { child, base, output: () => output,
          admin: async query => { const response = await fetch(base + '/admin?op=' + query, { method: 'POST', headers: { 'x-hm-admin': 'synthetic-world-admin' } }); return { status: response.status, body: await response.json() }; },
          status: async () => (await fetch(base + '/gaming/world-state')).json(),
          connect: async ({ live = false } = {}) => {
            const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws'); sockets.push(ws); await once(ws, 'open');
            const messages = []; ws.on('message', bytes => messages.push(JSON.parse(String(bytes))));
            async function receive(type, matches = () => true) { const end = Date.now() + 3000; while (Date.now() < end) { const index = messages.findIndex(m => m.t === type && matches(m)); if (index >= 0) return messages.splice(index, 1)[0]; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('No ' + type); }
            ws.send(JSON.stringify({ t: 'hello' })); const welcome = await receive('welcome');
            const send = value => ws.send(JSON.stringify(value)); let humanActivity = 0;
            const actor = { ws, welcome, receive, send, async play() {
              send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: ++humanActivity,
                n: 'Live world fixture', c: 'warrior', l: 3 } });
              send({ t: 'ping', c: humanActivity }); await receive('pong');
            } };
            if (live) await actor.play();
            return actor;
          } };
      } } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!expectFailure) assert.fail('Real server did not start: ' + output);
    assert.notEqual(child.exitCode, null, 'Startup fails before listening: ' + output);
    return { output: () => output, child };
  }
  const fakeProvider = await import(pathToFileURL(provider).href);
  return { data, durable, controls, start, stop, setControl: value => writeFile(controls, JSON.stringify(value)),
    readDurable: async () => JSON.parse(await readFile(durable, 'utf8')),
    store: () => fakeProvider.configuredGamingStore({ TEST_DURABLE_FILE: durable, TEST_CONTROL_FILE: controls }) };
}

test('real server refuses native world startup on configuration failure instead of silently serving volume authority', async t => {
  const f = await fixture(t), result = await f.start({ expectFailure: true, loaderEnabled: false });
  assert.match(result.output(), /world startup refused/); assert.doesNotMatch(result.output(), /season: (kept|a new)/);
});

test('real server does not consult or seed legacy files when the native startup read is unavailable', async t => {
  const f = await fixture(t, { control: { loadError: true } }), result = await f.start({ expectFailure: true });
  assert.doesNotMatch(result.output(), /season: (kept|a new)|private test credential/);
  assert.equal(Object.keys((await f.readDurable()).streams).length, 0);
});

test('real server rejects malformed legacy JSON and malformed season rather than committing a fresh migration', async t => {
  for (const options of [{ worlds: '{truncated' }, { season: { v: 1, realms: [] } }]) {
    const f = await fixture(t, options), result = await f.start({ expectFailure: true });
    assert.doesNotMatch(result.output(), /season: (kept|a new)/);
    assert.equal(Object.keys((await f.readDurable()).streams).length, 0);
  }
});

test('real server keeps a confirmed-absent seed in memory until a live human checkpoint', async t => {
  const f = await fixture(t); await rm(path.join(f.data, 'worlds.json')); await rm(path.join(f.data, 'season.json'));
  const server = await f.start(); assert.match(server.output(), /season: a new season/);
  assert.deepEqual((await f.readDurable()).streams, {}, 'Idle boot never commits a migration seed');
  const idleCheckpoint = await server.admin('world-checkpoint');
  assert.equal(idleCheckpoint.body.persistence.durable, false);
  assert.deepEqual((await f.readDurable()).streams, {}, 'An idle checkpoint cannot start persistence');
  await server.connect({ live: true });
  assert.equal((await server.admin('world-checkpoint')).body.persistence.durable, true);
  const snapshot = (await f.readDurable()).streams['hallowmarch-world-season-v1'].state.value;
  assert.deepEqual(snapshot.worlds, {}); assert.equal(snapshot.season.v, 1); assert.equal(snapshot.season.realms.length, 3);
});

test('real server recovers canonical owned world and season before constructing modules and ignores stale volume copies', async t => {
  const f = await fixture(t), first = await f.start();
  assert.equal((await first.status()).snapshotOwnershipMigrated, true);
  assert.equal((await first.status()).authoritativeCombat, false);
  assert.deepEqual((await f.readDurable()).streams, {}, 'Read-only idle startup does not seed native storage');
  await first.connect({ live: true });
  await first.admin('keep&i=0&r=2'); assert.equal((await first.admin('world-checkpoint')).status, 200);
  await f.stop(first.child);
  await writeFile(path.join(f.data, 'worlds.json'), JSON.stringify({ march: { ...world, cn: 999 } }));
  await writeFile(path.join(f.data, 'season.json'), JSON.stringify({ ...seedSeason(), n: 99 }));
  const second = await f.start(), socket = await second.connect();
  assert.equal(socket.welcome.worldAuthority.scope, 'world-and-season');
  assert.equal(socket.welcome.worldAuthority.fenced, false); assert.ok(socket.welcome.worldAuthority.confirmedVersion > 0);
  assert.equal((await (await fetch(second.base + '/season')).json()).n, 7);
  assert.equal(socket.welcome.world.cn, 3); assert.equal(socket.welcome.world.k[0], 2);
  assert.match(second.output(), /season: kept/);
  await f.stop(second.child);
  assert.equal(JSON.parse(await readFile(path.join(f.data, 'worlds.json'), 'utf8')).march.cn, 999, 'native authority never rewrites or trusts the stale canonical file');
  const native = (await f.readDurable()).streams['hallowmarch-world-season-v1'].state.value;
  assert.deepEqual(Object.keys(native).sort(), ['season', 'worlds']);
  assert.equal(native.worlds.march.cn, 3);
});

test('real server returns from a live world mutation before slow native writes, then confirms only the explicit checkpoint', async t => {
  const f = await fixture(t), server = await f.start(); await server.connect({ live: true }); await server.admin('world-checkpoint');
  await f.setControl({ holdMs: 500 });
  const before = (await server.status()).confirmedVersion, start = Date.now();
  const changed = await server.admin('keep&i=0&r=1'); assert.equal(changed.status, 200);
  assert.ok(Date.now() - start < 300, 'live mutation does not await a 500ms native store');
  const pending = await server.status(); assert.equal(pending.confirmedVersion, before); assert.equal(pending.durable, false);
  assert.ok(pending.liveVersion > pending.confirmedLiveVersion);
  const confirmed = await server.admin('world-checkpoint'); assert.equal(confirmed.body.persistence.durable, true);
  await f.setControl({});
});

test('real server fences a second world writer and restores that writer through the explicit operator recovery affordance', async t => {
  const f = await fixture(t), server = await f.start(); await server.connect({ live: true }); await server.admin('world-checkpoint');
  const other = createProgressiveOwnedState({ store: await f.store(), streamId: 'hallowmarch-world-season-v1', checkpointIntervalMs: 60000 });
  const snapshot = await other.start(); snapshot.season.n = 23; snapshot.season.keeps[0].h = 2;
  other.capture(snapshot); await other.checkpoint();
  await server.admin('keep&i=0&r=1'); const conflicting = await server.admin('world-checkpoint');
  assert.equal(conflicting.status, 503); assert.equal((await server.status()).fenced, true);
  assert.equal((await fetch(server.base + '/season')).status, 503);
  assert.equal((await server.admin('keep&i=0&r=0')).status, 503);
  const recovered = await server.admin('world-recover'); assert.equal(recovered.status, 200); assert.equal(recovered.body.persistence.fenced, false);
  assert.equal((await (await fetch(server.base + '/season')).json()).n, 23);
  await server.connect({ live: true });
  assert.equal((await server.admin('world-checkpoint')).body.persistence.durable, true);
  const next = await other.recover({ discardUnconfirmed: true, restore: () => {} }); next.season.n = 24;
  other.capture(next); await other.checkpoint();
  await server.admin('keep&i=0&r=0'); assert.equal((await server.admin('world-checkpoint')).status, 503);
  await f.stop(server.child);
  assert.equal((await f.readDurable()).streams['hallowmarch-world-season-v1'].state.value.season.n, 24,
    'shutdown does not overwrite the other writer after a known conflict');
});

test('real server rejects an invalid confirmed native world without falling back to valid legacy copies', async t => {
  const f = await fixture(t), first = await f.start(); await first.connect({ live: true }); await first.admin('world-checkpoint'); await f.stop(first.child);
  const native = await f.readDurable(); native.streams['hallowmarch-world-season-v1'].state.owner = 'did:web:foreign.example';
  await writeFile(f.durable, JSON.stringify(native));
  const result = await f.start({ expectFailure: true });
  assert.doesNotMatch(result.output(), /season: (kept|a new)/);
  assert.equal(JSON.parse(await readFile(path.join(f.data, 'worlds.json'), 'utf8')).march.cn, 3);
});

for (const [fault, errorCode] of [
  [{ commitError: true }, 'CHECKPOINT_UNCONFIRMED'],
  [{ corruptAck: true }, 'CORRUPT_DURABLE_STATE'],
]) test('real server fences ' + errorCode + ' before accepting further season mutations and recovers natively', async t => {
  const f = await fixture(t), server = await f.start(), actor = await server.connect({ live: true });
  await server.admin('world-checkpoint');
  const before = (await f.readDurable()).streams['hallowmarch-world-season-v1'];
  await f.setControl(fault);
  assert.equal((await server.admin('keep&i=0&r=1')).status, 200);
  assert.equal((await server.admin('world-checkpoint')).status, 503);
  const blocked = await server.status();
  assert.equal(blocked.error, errorCode);
  assert.equal(blocked.fenced, true);
  assert.equal(blocked.durable, false);
  assert.equal((await server.admin('keep&i=0&r=2')).status, 503);
  assert.equal((await fetch(server.base + '/season')).status, 503);
  actor.send({ t: 'contrib', q: 481, k: 'food', n: 1 });
  const contribution = await actor.receive('contrib');
  assert.equal(contribution.ok, false); assert.equal(contribution.q, 481);
  actor.send({ t: 'order', q: 482, o: { kind: 'target', keep: 0 } });
  const order = await actor.receive('order');
  assert.equal(order.ok, false); assert.equal(order.q, 482);
  assert.deepEqual((await f.readDurable()).streams['hallowmarch-world-season-v1'], before,
    'failed storage never advances the confirmed native snapshot');
  await f.setControl({});
  const disconnected = once(actor.ws, 'close');
  const recovered = await server.admin('world-recover');
  assert.equal(recovered.status, 200); assert.equal(recovered.body.persistence.fenced, false);
  await disconnected;
  // Recovery closes old sessions. Wait for the last human withdrawal before
  // admitting a fresh socket, which standby intentionally closes otherwise.
  const idleDeadline = Date.now() + 3000;
  while ((await (await fetch(server.base + '/health')).json()).players !== 0) {
    assert(Date.now() < idleDeadline, 'Recovered session did not withdraw');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await server.connect({ live: true });
  assert.equal((await server.admin('keep&i=0&r=2')).status, 200);
  assert.equal((await server.admin('world-checkpoint')).body.persistence.durable, true);
  assert.equal((await f.readDurable()).streams['hallowmarch-world-season-v1'].state.value.season.keeps[0].h, 2);
});

test('cold world admission rejects retained private worlds and accepts only initialized same-season host reports', async t => {
  const f = await fixture(t, { worlds: {} }), server = await f.start();
  const actor = await server.connect({ live: true }), observer = await server.connect({ live: true });
  const admission = actor.welcome.worldAdmission;
  assert.deepEqual(admission, { origin: 'https://game.example', epoch: 7 });
  assert.deepEqual((await (await fetch(server.base + '/gaming/manifest')).json()).worldAdmission, admission);
  assert.equal(actor.welcome.world.cn, 1);
  assert.deepEqual(actor.welcome.world.cl, [[0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(actor.welcome.world.g, new Array(6).fill(1));
  const initialKeeps = (await (await fetch(server.base + '/season')).json()).keeps.map(k => k.r);
  assert.deepEqual(actor.welcome.world.k, initialKeeps);
  const stale = { ...world, k: new Array(6).fill(2), g: new Array(6).fill(0), cn: 99, cl: [[99, 99], [99, 99], [99, 99]] };
  let activity = 1;
  for (const binding of [undefined, { ...admission, epoch: 6 }, { ...admission, origin: 'https://other.example' }]) {
    const label = 'admission-' + ++activity;
    actor.send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: activity, n: label, c: 'warrior', l: 3,
      w: stale, worldAdmission: binding, wx: { v: 1, c: [] } } });
    const forwarded = await observer.receive('peer', m => m.slow?.n === label);
    assert.equal(forwarded.slow.w, undefined, 'rejected private world is not forwarded to current peers');
    assert.equal(forwarded.slow.wx, undefined, 'unbound weather is not forwarded');
    await server.admin('world-checkpoint');
    assert.deepEqual((await f.readDurable()).streams['hallowmarch-world-season-v1'].state.value.worlds, {});
    assert.deepEqual((await (await fetch(server.base + '/season')).json()).keeps.map(k => k.r), initialKeeps);
  }
  const legitimate = { ...stale, k: initialKeeps, cn: 1, cl: [[2, 3], [4, 5], [6, 7]] };
  actor.send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: ++activity, n: 'current-host', c: 'warrior', l: 3,
    w: legitimate, worldAdmission: admission } });
  const accepted = await observer.receive('peer', m => m.slow?.n === 'current-host');
  assert.deepEqual(accepted.slow.w, legitimate, 'same-epoch initialized host keeps legitimate elected authority');
  await server.admin('world-checkpoint');
  const persisted = (await f.readDurable()).streams['hallowmarch-world-season-v1'].state.value.worlds.march;
  assert.deepEqual(persisted.k, initialKeeps); assert.equal(persisted.cn, 1); assert.deepEqual(persisted.cl, legitimate.cl);
  assert.deepEqual(persisted.g, legitimate.g);
  await server.admin('reset');
  actor.send({ t: 'slow', d: { r: 0, on: 1, realmManagement: 1, seasonField: 2, sharedCombat: 1, actorDevelopment: 1, sharedScene: 2, humanLive: 1, humanActivity: ++activity, n: 'old-season', c: 'warrior', l: 3,
    w: stale, worldAdmission: admission } });
  const rejected = await observer.receive('peer', m => m.slow?.n === 'old-season');
  assert.equal(rejected.slow.w, undefined, 'a previously initialized old epoch is fenced after reset');
  assert.equal((await (await fetch(server.base + '/season')).json()).n, 8);
});
