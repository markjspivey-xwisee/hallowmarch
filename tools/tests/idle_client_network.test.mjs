import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL('src/' + name, root), 'utf8');
const between = (s, a, b) => { const start = s.indexOf(a), end = s.indexOf(b, start + a.length); assert.ok(start >= 0 && end > start); return s.slice(start, end); };

test('the actual network pump performs no connect, retry, send or world keep while idle and wakes on live play', () => {
  const source = between(read('14n_net.js'), 'function netPump(dt)', 'function netWorldKeep(');
  let live = false, connected = false;
  const calls = [];
  const context = vm.createContext({
    GAME: { ready: true }, NET: { state: 'on' }, NETWS: { state: 'off', link: {}, closed: false, reload: false },
    performance: { now: () => 100 }, netHumanSync() {}, netHumanLive: () => live, netOn: () => connected,
    netWsReconnect: () => calls.push('reconnect'), netConnect: () => calls.push('connect'), netServerUrl: () => 'wss://example.test',
    netHostElect: () => calls.push('host'), netInbox: () => calls.push('inbox'), netGhosts: () => calls.push('ghosts'),
    netSocialPending: () => false, netSendSlow() { calls.push('slow'); return true; }, netSendFast: () => calls.push('fast'),
    netDeathWatch: () => calls.push('death'), netWorldKeep: () => calls.push('keep')
  });
  vm.runInContext(source + '\nglobalThis.pump=netPump;', context);
  context.pump(0.1); assert.deepEqual(calls, []);
  live = true; context.pump(0.1); assert.deepEqual(calls, ['reconnect']);
  calls.length = 0; connected = true; context.NETWS.state = 'on'; context.pump(0.1);
  assert.deepEqual(calls, ['host', 'inbox', 'ghosts', 'slow', 'fast', 'death', 'keep']);
});

test('WebSocket retry callbacks and heartbeat cannot send or reopen a paused human session', async () => {
  const s = read('14p_netws.js');
  const source = between(s, 'function netWsSuspendHuman()', '// A timed-out FIFO') +
    between(s, 'async function netWsReconnect()', '// Only pending requests');
  let live = false, opens = 0, sends = 0, retired = 0, next = 1;
  const timeouts = new Map(), intervals = new Map();
  const context = vm.createContext({
    NETWS: { state: 'off', link: {}, closed: false, reload: false, retryTimer: 0, pingTimer: 0, backoff: 1, ws: {} },
    netHumanLive: () => live, netWsOpen: async () => { opens++; return true; }, netWsSend: () => sends++,
    netWsRetire: () => { retired++; context.NETWS.state = 'off'; },
    performance: { now: () => 10 }, setTimeout(fn) { const id = next++; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id), setInterval(fn) { const id = next++; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id)
  });
  vm.runInContext(source + '\nglobalThis.H={netWsRetryLater,netWsReconnect,netWsStartHumanPing};', context);
  context.H.netWsRetryLater(); await context.H.netWsReconnect();
  assert.equal(timeouts.size, 0); assert.equal(opens, 0);
  live = true; context.H.netWsRetryLater(); assert.equal(timeouts.size, 1);
  live = false; const retry = [...timeouts][0]; timeouts.delete(retry[0]); retry[1](); await Promise.resolve();
  assert.equal(opens, 0);
  live = true; context.H.netWsStartHumanPing(); assert.equal(intervals.size, 1);
  context.NETWS.state = 'on'; live = false; [...intervals.values()][0]();
  assert.equal(sends, 0); assert.equal(retired, 1); assert.equal(intervals.size, 0);
});

test('scheduled and periodic private autosaves stop at idle while retaining an explicit final save path', () => {
  const s = read('12_save.js');
  const source = between(s, 'function saveSoon(', '// Native saves') +
    between(s, '// a slow heartbeat:', 'function wipeSave()');
  let live = false, writes = 0, built = 0, pendingTimer = null, heartbeat;
  const context = vm.createContext({
    SAVE: { wiping: false, timer: 0, lastCore: '' }, GAME: { ready: true, player: {} }, netHumanLive: () => live,
    saveNow: () => { writes++; }, buildSave() { built++; return {}; }, coreKey: () => 'changed',
    clearTimeout() {}, setTimeout(fn) { pendingTimer = fn; return 1; }, setInterval(fn) { heartbeat = fn; return 2; }
  });
  vm.runInContext(source + '\nglobalThis.soon=saveSoon;', context);
  context.soon(); heartbeat(); assert.equal(pendingTimer, null); assert.equal(built, 0); assert.equal(writes, 0);
  live = true; context.soon(); assert.equal(typeof pendingTimer, 'function');
  live = false; pendingTimer(); assert.equal(writes, 0);
  live = true; heartbeat(); assert.equal(built, 1); assert.equal(writes, 1);
  assert.doesNotMatch(source, /addEventListener\('(pagehide|visibilitychange)'/);
});

test('a native final save cannot drain additional queued character snapshots after the human pauses', async () => {
  const s = read('12_save.js');
  const source = between(s, 'function nativeSavePending()', 'function saveNow()');
  let writes = 0;
  const SAVE = { nativeFlight: null, nativePaused: false, pending: { n: 1 }, chain: Promise.resolve(),
    ref: { async set() { writes++; SAVE.pending = { n: 2 }; } } };
  const context = vm.createContext({ SAVE, netHumanLive: () => false, coreKey: () => 'core', Promise,
    NATIVE_PLAYER: {}, nativePlayerRender() {}, nativePlayerError: () => new Error('unexpected') });
  vm.runInContext(source + '\nglobalThis.flush=nativeSavePending;', context);
  await context.flush();
  assert.equal(writes, 1); assert.deepEqual(SAVE.pending, { n: 2 });
});

test('actual simulation and rendering tick return before NPC, weather, clock, agent or network work when idle', () => {
  const s = read('13_main.js'), source = between(s, 'function simStep(dt)', 'function frame(now)');
  const context = vm.createContext({ GRAPHICS_CONTEXT_LOST: false, netHumanSync() {}, netHumanLive: () => false });
  vm.runInContext(source + '\nglobalThis.H={simStep,tick};', context);
  assert.doesNotThrow(() => context.H.simStep(100));
  assert.doesNotThrow(() => context.H.tick(100));
});

test('actual companion and diagnostic polling callbacks do no work without live human play', () => {
  const cases = [
    ['14w_worldagents.js', 'setInterval(() => {', '}, 500);', {}],
    ['14u_gaming.js', '  GAMING.timer = setInterval(() => {', '  }, 1000);', { GAMING: {} }]
  ];
  for (const [file, start, end, extra] of cases) {
    const s = read(file), at = s.lastIndexOf(start), stop = s.indexOf(end, at) + end.length;
    assert.ok(at >= 0 && stop > at);
    let poll;
    vm.runInNewContext(s.slice(at, stop), { ...extra, netHumanLive: () => false, setInterval(fn) { poll = fn; } });
    assert.doesNotThrow(() => poll(), file);
  }
});

test('automatic coaching and learning flush return before owner context or network access while idle', async () => {
  const coaching = between(read('14x_consulting.js'), 'function marchConsultingStep()', "chronAdd('coach'");
  const c = vm.createContext({ netHumanLive: () => false });
  vm.runInContext(coaching + '\nglobalThis.step=marchConsultingStep;', c);
  assert.doesNotThrow(() => c.step());
  const learning = between(read('14z_learningdelivery.js'), 'async function marchLearningFlush()', 'function marchLearningMount(');
  const l = vm.createContext({ netHumanLive: () => false, MARCH_LEARNING: { delivery: {}, enabledUntil: 1 }, document: { hidden: false } });
  vm.runInContext(learning + '\nglobalThis.flush=marchLearningFlush;', l);
  await assert.doesNotReject(() => l.flush());
});

test('an authenticated dormant socket has no timers or reconnects and preserves private owner scopes across live resume', async () => {
  const s = read('14p_netws.js');
  const helpers = between(s, 'function netWsSuspendHuman()', '// A timed-out FIFO') +
    between(s, 'async function netWsReconnect()', '// Only pending requests');
  const ownerKey = between(read('14x_consulting.js'), 'function marchConsultingOwnerKey()', 'function marchConsultingClose()');
  const activityScope = between(read('14y_activity.js'), 'function activityScope()', 'function activityModules()');
  let live = false, opens = 0, sends = 0, retired = 0, next = 1;
  const timeouts = new Map(), intervals = new Map();
  const socket = { readyState: 1 };
  const context = vm.createContext({
    NETWS: { state: 'on', link: {}, closed: false, reload: false, retryTimer: 11, pingTimer: 12,
      backoff: 1, ws: socket, acct: { id: 'owner' }, token: 'same-owner-token', generation: 7 },
    GAME: { started: true, player: { name: 'Owner', faction: 0, cls: 'warrior' }, prog: {} }, SAVE: { native: true }, CAPTURE: { on: false },
    NATIVE_PLAYER: { profile: {}, status: { verified: true, binding: { subjectDid: 'did:example:owner', podUrl: 'https://pod.example/owner/' } } },
    netHumanLive: () => live, netWsOpen: async () => { opens++; return true; }, netWsSend: () => sends++,
    netWsRetire: () => { retired++; context.NETWS.generation++; context.NETWS.state = 'off'; },
    performance: { now: () => 10 }, setTimeout(fn) { const id = next++; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id), setInterval(fn) { const id = next++; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id)
  });
  timeouts.set(11, () => { throw Error('idle retry leaked'); });
  intervals.set(12, () => { throw Error('idle keepalive leaked'); });
  vm.runInContext(helpers + ownerKey + activityScope +
    '\nglobalThis.H={netWsSuspendHuman,netWsRetryLater,netWsReconnect,netWsStartHumanPing,marchConsultingOwnerKey,activityScope,activityCurrent};', context);
  const key = context.H.marchConsultingOwnerKey(), scope = context.H.activityScope();
  assert.equal(context.H.netWsSuspendHuman(), true);
  assert.equal(context.NETWS.state, 'on'); assert.equal(context.NETWS.ws, socket);
  assert.equal(context.NETWS.generation, 7); assert.equal(retired, 0);
  assert.equal(timeouts.size, 0); assert.equal(intervals.size, 0);
  context.H.netWsRetryLater(); await context.H.netWsReconnect();
  assert.equal(opens, 0); assert.equal(sends, 0); assert.equal(timeouts.size, 0);
  assert.equal(context.H.marchConsultingOwnerKey(), key);
  assert.equal(context.H.activityCurrent(scope), true);
  live = true; context.H.netWsStartHumanPing();
  assert.equal(intervals.size, 1); [...intervals.values()][0]();
  assert.equal(sends, 1); assert.equal(context.NETWS.generation, 7);
  assert.equal(context.H.marchConsultingOwnerKey(), key);
  assert.equal(context.H.activityCurrent(scope), true);
});

test('trusted live resume republishes one unchanged standing pose on the same dormant socket', async () => {
  const net = read('14n_net.js');
  const source = read('14m_liveplay.js') +
    between(net, 'function netSendFast(now)', 'function netPump(dt)') +
    between(net, 'function netPump(dt)', 'function netWorldKeep(');
  let now = 1000, serverPose = null;
  const frames = [], documentEvents = new Map(), windowEvents = new Map(), timers = new Map();
  let nextTimer = 1;
  const socket = { readyState: 1 };
  const pose = { p: [10, 2, 20], y: 0, v: [0, 0], a: 0, h: 1, m: 100,
    d: 0, mo: 0, ph: 0, sw: 0, st: 0, cs: 0, fl: 0, tg: '' };
  const context = vm.createContext({
    document: { hidden: false, hasFocus: () => true, addEventListener(type, fn) { documentEvents.set(type, fn); } },
    window: { addEventListener(type, fn) { windowEvents.set(type, fn); } },
    GAME: { ready: true, started: true, player: {} }, UI: { modal: null },
    NET: { state: 'on', slowKey: '', slowAt: 0, fastKey: '', fastAt: -Infinity,
      out: [], cfg: { fastHz: 10, ringMax: 20 }, evSeq: 0, seq: 0,
      stats: { fastSent: 0, upBytes: 0 }, link: { kind: 'ws',
        setFast(frame) { frames.push(frame); serverPose = frame; } } },
    NETWS: { state: 'on', ws: socket, generation: 7, closed: false, reload: false },
    performance: { now: () => now }, queueMicrotask,
    setTimeout(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    netOn: () => true, netSendSlow: () => true, netSocialPending: () => false,
    netFastObj: () => ({ ...pose, p: pose.p.slice(), v: pose.v.slice() }),
    netWsSuspendHuman() { serverPose = null; },
    netWsStartHumanPing() {}, saveNow: async () => {},
    netHostElect() {}, netInbox() {}, netGhosts() {}, netDeathWatch() {}, netWorldKeep() {}
  });
  vm.runInContext(source + '\nglobalThis.H={netHumanSync,netHumanLive,netPump};', context);
  async function input() {
    documentEvents.get('keydown')({ type: 'keydown', isTrusted: true });
    await Promise.resolve();
  }
  await input(); context.H.netPump(0.1);
  assert.equal(frames.length, 1); assert.ok(serverPose);
  now += 1000; context.UI.modal = 'menu'; context.H.netHumanSync();
  assert.equal(context.H.netHumanLive(), false); assert.equal(serverPose, null);
  context.H.netPump(0.1); assert.equal(frames.length, 1, 'standby cannot resend the pose');
  context.UI.modal = null; context.H.netHumanSync(); context.H.netPump(0.1);
  assert.equal(frames.length, 1, 'closing the menu without trusted input cannot resume');
  await input(); context.H.netPump(0.1);
  assert.equal(frames.length, 2, 'resume must republish even an unchanged standing pose');
  assert.ok(serverPose); assert.deepEqual(Array.from(serverPose.p), pose.p);
  assert.equal(context.NETWS.ws, socket); assert.equal(context.NETWS.generation, 7);
  now += 1000; await input(); context.H.netPump(0.1);
  assert.equal(frames.length, 2, 'ordinary live input keeps standing-pose deduplication');
});

test('an idle room profile withdraws its body and hands the unchanged sky to a live follower', () => {
  const net = read('14n_net.js'), weather = read('14r_netwx.js');
  const source = between(net, 'function netSlowObj()', 'function netFastObj(') +
    between(net, 'function netSlowRead(o)', 'function netFastRead(') +
    between(net, 'function netHostElect()', 'function netWorldObj(') +
    between(weather, 'function netWxObj()', '// A bounded, detached snapshot') +
    between(weather, 'function netWxUnfollow()', '// the first host of a session');
  let live = true;
  const context = vm.createContext({
    GAME: { started: true, player: {}, prog: null }, NET_HUMAN_PLAY: { activity: 7 },
    NET: { self: 'follower', since: 2, host: '', isHost: false, peers: new Map(), regions: null },
    WX: { follow: 50, cells: [], wind: { from: 0, s: 1, toFrom: 0, toS: 1, next: 300 }, off: { x: 0, z: 0 } },
    NWX: { snap: null, snapAt: 0, snapKey: '', seq: 0, last: 'old-host-word',
      EVERY: 6000, stats: { sent: 0, unfollows: 0 } },
    performance: { now: () => 100 }, netHumanLive: () => live, netKeepsMine: () => false,
    netWorldObj: () => ({}), wxHeld: () => false, nwxR: (v, k) => Math.round(v * k) / k,
    netNum: (v, lo, hi, d = 0) => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d,
    netStr: (v, n) => typeof v === 'string' ? v.slice(0, n) : '', NET_REALM_OK: r => r >= 0 && r <= 2,
    CLASSES: { warrior: {} }, LEVEL_CAP: 60, netWxRead: () => null, netCompanionRead: () => null,
    netWorldTake() {}, netWxTake() {}, netNote() {}, uiLog() {}
  });
  vm.runInContext(source + '\nglobalThis.H={netSlowObj,netSlowRead,netHostElect};', context);
  function remoteProfile(active) {
    live = active; context.NET.since = 1; context.NET.isHost = false;
    const profile = context.H.netSlowObj();
    context.NET.since = 2; live = true;
    return profile;
  }
  const playing = remoteProfile(true);
  assert.equal(playing.on, 1); assert.equal(playing.humanLive, 1);
  context.NET.peers.set('host', { peer: 'host', slow: context.H.netSlowRead(playing) });
  context.H.netHostElect();
  assert.equal(context.NET.host, 'host'); assert.equal(context.NET.isHost, false);

  // The same character remains loaded in its menu, title transition, hidden tab
  // or expired input lease. Its single withdrawal must stop advertising a body.
  const paused = remoteProfile(false);
  assert.equal(paused.on, 0); assert.equal(paused.humanLive, 0);
  assert.equal(paused.humanActivity, playing.humanActivity);
  context.NET.peers.set('host', { peer: 'host', slow: context.H.netSlowRead(paused) });
  context.H.netHostElect();
  assert.equal(context.NET.isHost, true); assert.equal(context.NET.host, 'follower');
  assert.equal(context.WX.follow, 50);
  context.H.netSlowObj();
  assert.equal(context.WX.follow, 0); assert.equal(context.NWX.stats.unfollows, 1);
  assert.equal(context.NWX.stats.sent, 1);

  // An admitted authoritative server retains its established host precedence.
  context.NET.peers.set('server', { peer: 'server', srv: true, slow: { on: 1 } });
  context.H.netHostElect();
  assert.equal(context.NET.host, 'server'); assert.equal(context.NET.isHost, false);
});

function coldTownFixture(walkable = () => true) {
  const ai = read('08_ai.js'), world = read('01_world.js'), houses = read('04e_houses.js');
  const helperAt = ai.indexOf('function townVillagerSpawn(');
  const spawn = (helperAt < 0 ? '' : between(ai, 'function townVillagerSpawn(', 'function initTowns()')) +
    between(ai, 'function initTowns()', '/* ------------------------------------------------------------------ */\n/* keeps, temples, relics');
  const source = between(read('07_entities.js'), 'function makeEnt(o)', 'function removeEnt(') +
    between(world, 'const _cn = [];', '// is the straight segment clear') +
    between(houses, 'function collCovers(c, x, z, r)', '// a place to stand inside') + spawn;
  const prop = { type: 'box', x: 6, z: 0, hx: 1.55, hz: 1.05, cos: 1, sin: 0,
    tag: 'prop', active: true, baseY: 3, h: 2.2 };
  let randomCalls = 0, walkCalls = 0;
  const math = Object.create(Math);
  math.random = () => { randomCalls++; return 0; };
  const context = vm.createContext({
    Math: math, TAU: Math.PI * 2, ENT: [], ENT_BY_ID: new Map(), ENT_NEXT: 1,
    GAME: { player: null, started: false, t: 0 }, FACTION_MONSTER: 3, FACTION_NEUTRAL: 4,
    REALMS: [{ id: 0, name: 'Test', town: { x: 0, z: 0, yaw: 0 }, musterSite: { yaw: 0 } }],
    WB: {}, OUTFIT: {}, VILLAGER_NAMES: ['Villager'],
    heightAt: () => 3, isWalkable(x, z) { walkCalls++; return walkable(x, z); },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    dist2: (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2,
    collidersNear(x, z, r, out) { out.length = 0; out.push(prop); return out; },
    siteWorld: () => ({ x: 0, z: 0 }), classLook: () => ({}), villagerLook: () => ({}),
    setupStats() {}, pick: (random, names) => names[0], warUnitLevel: () => 1,
    spawnRealmUnit: () => ({ ai: {} })
  });
  vm.runInContext(source + '\nglobalThis.H={initTowns,collCovers};', context);
  context.H.initTowns();
  return { context, prop, randomCalls, walkCalls };
}

test('cold initial villagers avoid prop colliders and unwalkable ground without player or world ticks', () => {
  // The first collision-resolved landing is deliberately unwalkable. A bounded,
  // deterministic alternate must be chosen without consuming the world's RNG.
  const walkable = (x, z) => !(Math.abs(x - 6) < 0.01 && z > 1.4 && z < 1.5);
  const { context, prop, randomCalls, walkCalls } = coldTownFixture(walkable);
  const villagers = context.ENT.filter(e => e.role === 'villager');
  assert.equal(villagers.length, 6);
  for (const e of villagers) {
    assert.equal(context.H.collCovers(prop, e.x, e.z, e.radius * 0.9 - 1e-4), false);
    assert.equal(walkable(e.x, e.z), true);
    assert.equal(e.y, 3); assert.equal(e.prevX, e.x); assert.equal(e.prevZ, e.z);
  }
  assert.ok(walkCalls > 6);
  assert.equal(randomCalls, 26); // unchanged positions/looks/entity initialization draws
  assert.equal(context.GAME.player, null); assert.equal(context.GAME.started, false); assert.equal(context.GAME.t, 0);
});

test('cold initial villager search is bounded and does not place a body when no ground is walkable', () => {
  const { context, walkCalls } = coldTownFixture(() => false);
  assert.equal(context.ENT.filter(e => e.role === 'villager').length, 0);
  assert.equal(walkCalls, 6 * 24);
  assert.equal(context.GAME.t, 0); assert.equal(context.GAME.player, null);
});


test('a native save held in the queue past the final window stays pending until live resume', async () => {
  const source = between(read('12_save.js'), 'function nativeSavePending()', 'function saveNow()');
  let now = 0, live = false, release;
  const writes = [], pending = { character: 'accepted-history' };
  const SAVE = { nativeFlight: null, nativePaused: false, pending,
    chain: new Promise(resolve => { release = resolve; }) };
  const context = vm.createContext({ SAVE, netHumanLive: () => live, performance: { now: () => now },
    coreKey: () => 'core', NATIVE_PLAYER: {}, nativePlayerRender() {},
    nativePlayerError: () => new Error('unexpected'), Promise,
  });
  SAVE.ref = { async set(value) { writes.push(value); } };
  vm.runInContext(source + '\nglobalThis.flush=nativeSavePending;', context);
  const held = context.flush();
  now = 10001; release(); await held;
  assert.equal(writes.length, 0, 'an expired queued call cannot dispatch in standby');
  assert.equal(SAVE.pending, pending, 'the accepted body is retained without replacement');
  live = true; await context.flush();
  assert.equal(writes.length, 1); assert.equal(writes[0], pending);
  assert.equal(SAVE.pending, null);
});
