/** Real startup save/identity functions, with delayed native transport fixtures. No live I/O. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const saveSource = (await fs.readFile(new URL('../../src/12_save.js', import.meta.url), 'utf8')).split('function graphicsSaveSettings()')[0];
const identitySource = await fs.readFile(new URL('../../src/14v_nativeidentity.js', import.meta.url), 'utf8');
const saved = { v: 1, char: { name: 'Native owner character', realm: 0, cls: 'warrior', level: 4 }, settings: { quality: 'low' }, world: { keeps: [0, 1, 2] }, qa: { marker: 'exact-private-body' } };
function deferred() { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
function scheduler() {
  let now = 0, count = 0; const timers = new Map();
  return { setTimeout(fn, delay) { const id = ++count; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) { const end = now + ms; for (;;) { let chosen;
      for (const [id, timer] of timers) if (timer.at <= end && (!chosen || timer.at < chosen[1].at)) chosen = [id, timer];
      if (!chosen) break; now = chosen[1].at; timers.delete(chosen[0]); chosen[1].fn(); await flush();
    } now = end; await flush(); } };
}
function fixture({ manifestGate, readGate, connectGate, readFailure, connectFailure, manifestFailure } = {}) {
  const clock = scheduler(), counts = { manifest: 0, status: 0, profiles: 0, connect: 0, reads: 0, writes: 0, keyCreations: 0, localReads: 0, serverReads: 0, title: 0, settings: 0, world: 0, closes: 0 };
  const binding = { subjectDid: 'did:fixture:owner', podUrl: 'https://pod.example/owner/' };
  const profile = { status: () => ({ state: 'ready', keyPresent: true, hasRecord: true, pending: false, indexed: true, linked: true }),
    async connect() { counts.connect++; if (connectGate) await connectGate.promise;
      if (connectFailure) { connectFailure = false; throw Object.assign(Error('fixture transport failed'), { code: 'native_unavailable' }); }
      return { keyPresent: true }; },
    async get() { counts.reads++; if (readGate) await readGate.promise;
      if (readFailure) { readFailure = false; throw Object.assign(Error('fixture read failed'), { code: 'native_unavailable' }); }
      return { exists: true, data: () => structuredClone(saved) }; },
    set() { counts.writes++; throw Error('Startup must never publish a character'); },
    createKey() { counts.keyCreations++; throw Error('Startup must never replace a key'); },
    close() { counts.closes++; },
  };
  const context = vm.createContext({ URL, AbortController, console, structuredClone, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    AbortSignal: { timeout(ms) { const controller = new AbortController(); clock.setTimeout(() => controller.abort(), ms); return controller.signal; } },
    async fetch(input, init) {
      const path = new URL(input, 'https://game.example').pathname;
      if (path === '/gaming/manifest') { counts.manifest++;
        if (manifestFailure) { manifestFailure = false; throw Error('fixture temporarily unavailable'); }
        if (manifestGate) await Promise.race([manifestGate.promise, new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('fixture timeout')), { once: true }))]);
        return { ok: true, status: 200, json: async () => ({ playerIdentity: {} }) };
      }
      assert.equal(path, '/gaming/identity/status'); counts.status++;
      return { ok: true, json: async () => ({ enabled: true, bound: true, verified: true, binding, account: { id: 'owner' }, recordLinks: {} }) };
    },
    window: { __hm: {} }, localStorage: { getItem() { counts.localReads++; return JSON.stringify({ v: 1, char: null, qa: 'wrong browser save' }); } },
    netServerSaveRef: async () => { counts.serverReads++; throw Error('Native startup must not use the central save'); },
    netLinkWS: async () => true, netServerUrl: () => 'wss://game.example/ws',
    NETWS: { token: 'same-game-token', acct: { id: 'owner', nativeBound: true }, host: 'game.example', reload: false },
    GAME: { ready: true, started: false }, CLASSES: { warrior: {} }, LEVEL_CAP: 50,
    coreKey: value => JSON.stringify(value), applySettings: () => counts.settings++, applyWorldSave: () => counts.world++,
    setupTitle: () => counts.title++,
    fixtureModule: { createPlayerPodProfile() { counts.profiles++; return profile; } },
    fixtureCache: { list: async () => [{ ownerDid: binding.subjectDid, podUrl: binding.podUrl, relayUrl: 'https://relay.example' }], get: async () => ({ credential: { kind: 'fixture-native-grant' } }) },
  });
  vm.runInContext(saveSource + '\n' + identitySource + `\nNATIVE_PLAYER.module = Promise.resolve(fixtureModule); NATIVE_PLAYER.cache = fixtureCache;
    nativePlayerRender = () => {};
    globalThis.fixture = { SAVE, GAME, NETWS, NATIVE_PLAYER, loadSave, nativePlayerRetryLoad,
      status: () => window.__hm.nativePlayerStatus() };`, context);
  return { ...context.fixture, clock, counts, profile, context };
}
function noFallback(f) { assert.equal(f.counts.localReads, 0); assert.equal(f.counts.serverReads, 0); assert.equal(f.counts.writes, 0); assert.equal(f.counts.keyCreations, 0); assert.equal(f.NETWS.token, 'same-game-token'); }

test('native manifest cold read may exceed four seconds without permanently blocking the title', async () => {
  const manifestGate = deferred(), f = fixture({ manifestGate }); const boot = f.loadSave(); await flush();
  await f.clock.advance(5000); assert.equal(f.SAVE.readConfirmed, false); manifestGate.resolve();
  assert.equal(JSON.stringify(await boot), JSON.stringify(saved)); assert.equal(f.SAVE.readConfirmed, true); assert.equal(f.counts.profiles, 1); noFallback(f);
});
test('read finishing after the bounded boot wait opens the same native character on the title', async () => {
  const readGate = deferred(), f = fixture({ readGate }); const boot = f.loadSave(); await flush();
  assert.equal(f.counts.reads, 1); await f.clock.advance(45000); assert.equal(await boot, null);
  assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.SAVE.loading.settled, false);
  const retry = f.nativePlayerRetryLoad(); await flush(); assert.equal(f.counts.reads, 1, 'Retry retains the exact pending read');
  readGate.resolve(); await retry; await flush();
  assert.equal(JSON.stringify(f.SAVE.loaded), JSON.stringify(saved)); assert.equal(f.SAVE.readConfirmed, true);
  assert.equal(f.counts.title, 1); assert.equal(f.counts.world, 1); assert.equal(f.counts.profiles, 1); assert.equal(f.NATIVE_PLAYER.profile, f.profile); noFallback(f);
});
test('late success between the boot wait and game readiness hydrates after the title is ready', async () => {
  const readGate = deferred(), f = fixture({ readGate }); f.GAME.ready = false;
  const boot = f.loadSave(); await flush(); await f.clock.advance(45000); await boot;
  readGate.resolve(); await flush(); assert.equal(f.counts.title, 0); assert.equal(JSON.stringify(f.SAVE.loaded), JSON.stringify(saved));
  f.GAME.ready = true; await f.clock.advance(100); assert.equal(f.counts.title, 1); noFallback(f);
});
test('native connection failure retries the same profile and held key without reloading', async () => {
  const f = fixture({ connectFailure: true }); assert.equal(await f.loadSave(), null);
  assert.equal(f.SAVE.readConfirmed, false); const ref = f.SAVE.ref;
  await f.nativePlayerRetryLoad(); assert.equal(f.SAVE.ref, ref); assert.equal(f.counts.profiles, 1);
  assert.equal(f.counts.connect, 2); assert.equal(f.counts.reads, 1); assert.equal(JSON.stringify(f.SAVE.loaded), JSON.stringify(saved)); assert.equal(f.counts.title, 1); noFallback(f);
});
test('native read failure retries the same connected profile rather than replacing its operation state', async () => {
  const f = fixture({ readFailure: true }); assert.equal(await f.loadSave(), null); const ref = f.SAVE.ref;
  await f.nativePlayerRetryLoad(); assert.equal(f.SAVE.ref, ref); assert.equal(f.counts.profiles, 1);
  assert.equal(f.counts.connect, 1); assert.equal(f.counts.reads, 2); assert.equal(JSON.stringify(f.SAVE.loaded), JSON.stringify(saved)); noFallback(f);
});
test('an identity discovery failure can retry in place and remains fail closed meanwhile', async () => {
  const f = fixture({ manifestFailure: true }); assert.equal(await f.loadSave(), null);
  assert.equal(f.SAVE.native, true); assert.equal(f.SAVE.ref.blocked, true); assert.equal(f.SAVE.readConfirmed, false); noFallback(f);
  await f.nativePlayerRetryLoad(); assert.equal(f.SAVE.readConfirmed, true); assert.equal(f.counts.manifest, 2); assert.equal(f.counts.profiles, 1); noFallback(f);
});
test('account/host changes or game entry invalidate a late native read without replacing progress', async () => {
  for (const change of [f => { f.NETWS.acct = { id: 'foreign-owner' }; }, f => { f.NETWS.host = 'another.example'; },
    f => { f.GAME.started = true; }, f => { f.SAVE.pending = { retained: 'live-progress' }; }, f => { f.NETWS.reload = true; }]) {
    const readGate = deferred(), f = fixture({ readGate }); const boot = f.loadSave(); await flush(); await f.clock.advance(45000); await boot;
    change(f); readGate.resolve(); await flush(); assert.equal(f.SAVE.loaded, null); assert.equal(f.SAVE.readConfirmed, false);
    assert.equal(f.counts.title, 0); assert.equal(f.counts.world, 0); noFallback(f);
  }
});
test('a newer startup generation wins over an older delayed read of the same owner', async () => {
  const readGate = deferred(), f = fixture({ readGate }); const boot = f.loadSave(); await flush(); await f.clock.advance(45000); await boot;
  // Explicitly invalidate the old generation before beginning the newer one.
  f.SAVE.loading = null; const next = f.loadSave(); await flush(); const generation = f.SAVE.loading;
  readGate.resolve(); await next; await flush(); assert.equal(f.SAVE.loading, generation);
  assert.equal(JSON.stringify(f.SAVE.loaded), JSON.stringify(saved)); assert.equal(f.counts.title, 0); noFallback(f);
});
