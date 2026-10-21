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
