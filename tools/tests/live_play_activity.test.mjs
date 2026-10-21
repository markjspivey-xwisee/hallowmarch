import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('src/14m_liveplay.js', root), 'utf8');
const netSource = readFileSync(new URL('src/14n_net.js', root), 'utf8');
const slowSource = netSource.slice(netSource.indexOf('function netSlowObj()'), netSource.indexOf('function netFastObj('));
function fixture({ playing = true } = {}) {
  let now = 1000, nextTimer = 1;
  const timers = new Map(), documentEvents = new Map(), windowEvents = new Map(), sent = [];
  const document = { hidden: false, focused: true, hasFocus() { return this.focused; },
    addEventListener(type, fn) { documentEvents.set(type, fn); } };
  const window = { addEventListener(type, fn) { windowEvents.set(type, fn); } };
  const player = {}, GAME = { started: playing, player: playing ? player : null, prog: null }, UI = { modal: null };
  const NET = { since: 1, isHost: false, slowAt: 0, slowKey: '' };
  const context = vm.createContext({ document, window, GAME, UI, NET, performance: { now: () => now }, Number,
    queueMicrotask, setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, netKeepsMine: () => false, netOn: () => true,
    netSendSlow() { sent.push(JSON.parse(JSON.stringify(context.H.netSlowObj()))); } });
  vm.runInContext(source + '\n' + slowSource + '\nglobalThis.H={netHumanLive,netHumanSync,netHumanSuspend,netSlowObj,NET_HUMAN_PLAY};', context);
  async function input(type = 'keydown', values = {}) {
    documentEvents.get(type)?.({ type, isTrusted: true, ...values });
    await Promise.resolve();
  }
  async function event(type, { hidden, focused } = {}) {
    if (hidden !== undefined) document.hidden = hidden;
    if (focused !== undefined) document.focused = focused;
    (documentEvents.get(type) || windowEvents.get(type))?.({ type });
    await Promise.resolve();
  }
  function advance(ms) {
    now += ms;
    for (;;) {
      const ready = [...timers].find(([, timer]) => timer.at <= now);
      if (!ready) break;
      timers.delete(ready[0]); ready[1].fn();
    }
  }
  return { H: context.H, GAME, UI, document, player, sent, timers, input, event, advance };
}

test('a page, socket, loaded character and synthetic input cannot start the human lease', async () => {
  const f = fixture();
  f.H.netHumanSync();
  assert.equal(f.H.netHumanLive(), false);
  await f.input('keydown', { isTrusted: false });
  assert.equal(f.H.netHumanLive(), false);
  assert.equal(f.H.NET_HUMAN_PLAY.activity, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.timers.size, 0);
});

test('actual trusted input activates the emitted slow profile and frames cannot renew its lease', async () => {
  const f = fixture();
  await f.input();
  assert.equal(f.H.netHumanLive(), true);
  assert.equal(f.H.netSlowObj().humanLive, 1);
  assert.equal(f.H.netSlowObj().humanActivity, 1);
  for (let n = 0; n < 89; n++) { f.advance(1000); f.H.netHumanSync(); }
  assert.equal(f.H.netHumanLive(), true);
  assert.equal(f.H.NET_HUMAN_PLAY.activity, 1);
  f.advance(1000);
  assert.equal(f.H.netHumanLive(), false);
  assert.equal(f.sent.at(-1).humanLive, 0);
  assert.equal(f.timers.size, 0);
  f.H.netHumanSync(); f.advance(90000);
  assert.equal(f.H.netHumanLive(), false);
  assert.equal(f.H.NET_HUMAN_PLAY.activity, 1);
});

test('only new trusted input extends the live lease and advances its counter', async () => {
  const f = fixture();
  await f.input('pointerdown');
  f.advance(80000);
  await f.input('pointermove', { movementX: 2 });
  const count = f.H.NET_HUMAN_PLAY.activity;
  f.advance(10000);
  assert.equal(f.H.netHumanLive(), true);
  await f.input('pointermove', { movementX: 0, movementY: 0, buttons: 0 });
  assert.equal(f.H.NET_HUMAN_PLAY.activity, count);
  f.advance(80000);
  assert.equal(f.H.netHumanLive(), false);
});

test('hidden, blur and pagehide withdraw immediately; visibility and focus alone never resume', async () => {
  for (const type of ['visibilitychange', 'blur', 'pagehide']) {
    const f = fixture();
    await f.input();
    await f.event(type, type === 'visibilitychange' ? { hidden: true } : type === 'blur' ? { focused: false } : {});
    assert.equal(f.H.netHumanLive(), false, type);
    assert.equal(f.sent.at(-1).humanLive, 0, type);
    assert.equal(f.timers.size, 0, type);
    await f.event('visibilitychange', { hidden: false });
    await f.event('focus', { focused: true });
    assert.equal(f.H.netHumanLive(), false, type);
    await f.input();
    assert.equal(f.H.netHumanLive(), true, type);
  }
});

test('menu, prologue, title and replaced character cannot retain a previous active lease', async () => {
  for (const modal of ['menu', 'prologue']) {
    const f = fixture();
    await f.input();
    f.UI.modal = modal; f.H.netHumanSync();
    assert.equal(f.H.netHumanLive(), false);
    assert.equal(f.sent.at(-1).humanLive, 0);
    f.UI.modal = null; f.H.netHumanSync();
    assert.equal(f.H.netHumanLive(), false);
    await f.input(); assert.equal(f.H.netHumanLive(), true);
    f.GAME.player = {}; f.H.netHumanSync(); assert.equal(f.H.netHumanLive(), false);
  }
  const f = fixture();
  await f.input();
  f.GAME.started = false; f.GAME.player = null; f.H.netHumanSync();
  assert.equal(f.H.netHumanLive(), false);
  assert.equal(f.sent.at(-1).humanLive, 0);
});

test('a fresh trusted Enter gesture can cross asynchronous character startup, but an old one cannot', async () => {
  const f = fixture({ playing: false });
  await f.input('click');
  assert.equal(f.H.netHumanLive(), false);
  f.advance(1000); f.GAME.started = true; f.GAME.player = f.player; f.H.netHumanSync();
  assert.equal(f.H.netHumanLive(), true);
  const old = fixture({ playing: false });
  await old.input('click');
  old.advance(6000); old.GAME.started = true; old.GAME.player = old.player; old.H.netHumanSync();
  assert.equal(old.H.netHumanLive(), false);
});

test('unfocused or hidden input never creates a live lease', async () => {
  const f = fixture();
  await f.event('blur', { focused: false });
  await f.input();
  assert.equal(f.H.NET_HUMAN_PLAY.activity, 0);
  await f.event('focus', { focused: true });
  await f.event('visibilitychange', { hidden: true });
  await f.input();
  assert.equal(f.H.NET_HUMAN_PLAY.activity, 0);
});
