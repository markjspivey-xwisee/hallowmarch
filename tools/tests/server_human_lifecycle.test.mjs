import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../server/server.js', import.meta.url), 'utf8');
const lifecycle = source.slice(source.indexOf('function liveTask('), source.indexOf('let closing = false;'));
function fixture({ monitor = '1' } = {}) {
  let now = 1000, nextId = 1, humans = 0;
  const timers = new Map(), calls = [], connections = new Set();
  function add(fn, delay, every = 0) {
    const timer = { id: nextId++, at: now + delay, fn, every, unref() {} };
    timers.set(timer, timer); return timer;
  }
  const record = name => (...args) => { calls.push({ name, args, at: now }); };
  const world = { canMutate: () => true, setActive: record('world-active'), suspend: async (...a) => record('world-final')(...a) };
  const gaming = { setActive: record('gaming-active'), suspend: async (...a) => record('gaming-final')(...a) };
  const season = { RS: {}, lastStep: now, dirty: true, step: record('season-step'), save: record('season-save') };
  const context = vm.createContext({
    Date: { now: () => now }, Promise, console: { warn: record('warning') },
    process: { env: { HM_GAMING_MONITOR_ENABLED: monitor } },
    humanWorkRunning: false, humanWorkClosing: false, humanWorkAbort: new AbortController(), AbortController,
    liveWorkTimers: new Set(), LIVE_CONNECTIONS: connections,
    hasLiveHumans: () => humans > 0, isHumanPlaying: c => c.live === true,
    WORLD_STATE: world, GAMING: gaming, SEASON: season, FIELD: { step: record('field-step'), left: record('field-left') },
    worldAgentTransport: { close: record('agent-stop') },
    worldAgentHost: { setActive: record('agent-active'), suspend: async (...a) => record('agent-final')(...a) },
    nativeAgentHost: { setActive: record('native-agent-active') },
    send: record('send'), regionsTell: record('regions'), worldNow: () => ({k:[0,1,2]}),
    CFG: { seasonStep: 5000, seasonPush: 10000 }, ROOMS: new Map(),
    publishGamingCapabilities: record('publish-gaming'), publishPlayerCapabilities: record('publish-player'),
    publishWorldCapability: record('publish-world'), seasonTell: record('season-push'),
    initializeGamingMonitor: async () => record('monitor-initialize')(),
    sampleGamingService: () => { if (context.humanWorkRunning && humans) record('monitor-sample')(); },
    setInterval: (fn, ms) => add(fn, ms, ms), setTimeout: (fn, ms) => add(fn, ms),
    clearInterval: timer => timers.delete(timer), clearTimeout: timer => timers.delete(timer),
  });
  vm.runInContext('const liveWorkAllowed = () => humanWorkRunning && hasLiveHumans();\n' + lifecycle +
    '\nglobalThis.api = { setHumanWorkActive, endHumanSession, resumeHumanSession };', context);
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = [...timers.values()].filter(t => t.at <= target).sort((a,b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every; else timers.delete(due);
      due.fn(); await Promise.resolve(); await Promise.resolve();
    }
    now = target; await Promise.resolve(); await Promise.resolve();
  }
  return { context, calls, timers, connections, season, advance,
    active(n) { humans = n; context.api.setHumanWorkActive(n > 0); },
    counts(name) { return calls.filter(c => c.name === name).length; }, now: () => now };
}
test('cold standby schedules no repeating work across seven days', async () => {
  const f = fixture(); f.active(0); await f.advance(7 * 86400000);
  assert.equal(f.timers.size, 0); assert.equal(f.calls.length, 0);
  assert.equal((source.match(/setInterval\(/g) || []).length, 1, 'all permanent intervals must use liveTask');
});
test('last human stops every timer and permits one bounded final checkpoint', async () => {
  const f = fixture(); f.active(1); await f.advance(31000);
  assert.ok(f.counts('monitor-sample') > 0); assert.ok(f.counts('season-step') > 0);
  f.active(0); await Promise.resolve();
  assert.equal(f.timers.size, 0);
  assert.equal(f.counts('world-final'), 1); assert.equal(f.counts('gaming-final'), 1);
  const before = f.calls.length; f.active(0); await f.advance(2 * 86400000);
  assert.equal(f.calls.length, before);
});
test('resuming rebases wall-clock time instead of advancing the empty season', async () => {
  const f = fixture(); f.active(1); await f.advance(6000); f.active(0);
  await f.advance(5 * 86400000);
  const before = f.counts('season-step'); f.active(1);
  assert.equal(f.season.lastStep, f.now());
  assert.equal(f.counts('season-step'), before);
  await f.advance(5000); assert.equal(f.counts('season-step'), before + 1);
});
test('heartbeat stops while an established owner socket sleeps without timers', async () => {
  const f = fixture(); let humanPings = 0, idlePings = 0, closes = 0;
  f.connections.add({ live: true, hasPlayedLive: true, ws: { ping() { humanPings++; }, close() { closes++; }, terminate() {} } });
  f.connections.add({ live: false, ws: { ping() { idlePings++; }, close() { closes++; }, terminate() {} } });
  f.active(1); await f.advance(15000);
  assert.equal(humanPings, 1); assert.equal(idlePings, 0);
  f.active(0); assert.equal(closes, 1);
  await f.advance(60000); assert.equal(humanPings, 1); assert.equal(f.timers.size, 0);
});
test('monitor disabled by deployment never initializes or flushes during play', async () => {
  const f = fixture({ monitor: '0' }); f.active(1); await f.advance(120000);
  assert.equal(f.counts('monitor-initialize'), 0); assert.equal(f.counts('monitor-sample'), 0);
});

test('departure releases region ownership and tells active peers once without retiring the owner socket', () => {
  const f = fixture(), other = { live: true, nearAt: new Map([['owner-peer', 1]]), farAt: new Map([['owner-peer', 1]]) };
  const owner = { peer: 'owner-peer', slow: {on:1}, region:'h0', regionTold:true, fast:{}, pos:{},
    ws:{ close() { throw new Error('Dormant owner transport must remain established'); } } };
  owner.room = {clients:new Map([['owner-peer', owner], ['other', other]])};
  f.context.api.endHumanSession(owner);
  assert.equal(owner.humanDormant, true); assert.equal(owner.slow.on, 0);
  assert.equal(owner.region, null); assert.equal(owner.pos, null);
  assert.equal(other.nearAt.has('owner-peer'), false); assert.equal(other.farAt.has('owner-peer'), false);
  assert.equal(f.counts('send'), 1); assert.equal(f.counts('regions'), 1);
});
test('standby HTTP exceptions name only explicit owner relationship controls', () => {
  const definition = source.split('\n').find(line => line.includes('const explicitOwnerControl = '));
  assert.ok(definition); const regexText = definition.slice(definition.indexOf('= ') + 2, definition.lastIndexOf('.test'));
  const allowed = vm.runInNewContext(regexText);
  for (const prefix of ['/gaming', '/world']) {
    assert.equal(allowed.test(prefix+'/native-agent/register'), true);
    assert.equal(allowed.test(prefix+'/native-agent/revoke'), true);
    for (const action of ['challenge','complete','renew','command','observe']) assert.equal(allowed.test(prefix+'/native-agent/'+action), false);
  }
});

test('live resume clears omitted departed peers then sends one current snapshot without starting its own timer', () => {
  const f=fixture(), owner={peer:'owner',pausedPeerIds:['departed','still-live'],slow:{on:1}},
    other={peer:'still-live',acct:{id:'other'},live:true,slow:{on:1},fast:{ev:[['old-event']]}},
    dormant={peer:'asleep',acct:{id:'asleep'},live:false,slow:{on:0}};
  owner.room={clients:new Map([['owner',owner],['still-live',other],['asleep',dormant]])};
  f.context.api.resumeHumanSession(owner);
  const messages=f.calls.filter(call=>call.name==='send').map(call=>call.args[1]);
  assert.equal(messages.filter(m=>m.t==='left').length,2);
  assert.equal(messages.filter(m=>m.t==='peer').length,1);
  assert.equal(messages.find(m=>m.t==='peer').peer,'still-live');
  assert.equal(messages.find(m=>m.t==='peer').fast.ev.length,0);
  assert.equal(messages.filter(m=>m.t==='world').length,1);
  assert.equal(owner.pausedPeerIds,null);assert.equal(f.timers.size,0);
});
