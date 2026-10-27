/** Actual throne camera/input controller; rendering is verified by browser acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const core = read('src/09a_throne_rts.js');
function extract(source, name) {
  const at = source.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name);
  return source.slice(at, source.indexOf('\n}', at) + 2);
}
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
}
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  copy(q) { Object.assign(this, q); return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
}
class Target {
  constructor() { this.listeners = new Map(); this.captures = new Set(); this.style = { touchAction: 'pan-y' }; }
  addEventListener(type, run, options) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), { run, capture: options === true || !!options?.capture }]);
  }
  removeEventListener(type, run) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row.run !== run)); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { if (this.captures.delete(id)) this.fire('lostpointercapture', { pointerId: id }); }
  count() { return [...this.listeners.values()].reduce((n, list) => n + list.length, 0); }
  fire(type, values = {}) {
    const event = { type, target: this, isTrusted: true, repeat: false, defaultPrevented: false,
      ctrlKey: false, metaKey: false, altKey: false, isComposing: false,
      pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, deltaMode: 0, deltaY: 0,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
      stopImmediatePropagation() { this.stopped = true; }, ...values };
    // Window capture runs before its older ordinary gameplay listener.
    for (const { run } of [...(this.listeners.get(type) || [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      run(event); if (event.stopped) break;
    }
    // Browsers implicitly release capture when a pointer is cancelled.
    if (type === 'pointercancel') this.releasePointerCapture(event.pointerId);
    return event;
  }
}
function fixture() {
  let clock = 1000, granted = true, live = true;
  const window = new Target(), document = new Target(), stage = new Target();
  Object.assign(document, { activeElement: null, hidden: false, hasFocus: () => true });
  const player = { x: 12, y: 5, z: 8, yaw: 0.3, alive: true, hp: 100, maxHp: 100, seat: { y: 5.53 } };
  const CAM = { mode: 'play', pos: new Vector3(11, 13, 17), focus: new Vector3(2, 3, 5),
    yaw: 0.8, pitch: 0.4, dist: 9, targetDist: 10 };
  const camera = { position: new Vector3(19, 23, 29), quaternion: new Quaternion(0.1, 0.2, 0.3, 0.4),
    up: new Vector3(0, 0.8, 0.2), fov: 60, lookAt(v) { this.lookTarget = v.clone(); this.quaternion.copy(new Quaternion(0, 0, 0, 1)); },
    updateMatrixWorld() {} };
  const UI = { modal: 'rts' }, INPUT = { keys: new Set(), pointers: new Map(), joy: null };
  const normalKeys = [], picks = [], closed = [], forwarded = [], human = { activity: 0, pendingAt: null, focused: true };
  window.addEventListener('keydown', event => { if (!event.defaultPrevented) normalKeys.push(event.code); });
  const scope = vm.createContext({ window, document, camera, CAM, UI, INPUT, GAME: { started: true, player },
    THREE: { Vector3 }, view: { w: 1280, h: 720 }, HALF: 512, heightAt: () => 4,
    performance: { now: () => clock }, NET_HUMAN_PLAY: human, queueMicrotask: run => run(), netHumanSync() {},
    hallThroneGrant: () => granted && player.alive, netHumanLive: () => live,
    typing: () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || !!document.activeElement?.isContentEditable,
    cancelPlayerInput() { INPUT.keys.clear(); INPUT.pointers.clear(); INPUT.joy = null; },
    throneRtsPick: (x, y) => picks.push([x, y]),
    closeThroneRTS(release = true) { closed.push(release); scope.throneRtsStopCamera(); if (UI.modal === 'rts') UI.modal = null; },
  });
  vm.runInContext(extract(read('src/09_player.js'), 'gameplayKeyIgnored') + '\n'
    + extract(read('src/14m_liveplay.js'), 'netHumanInput') + '\n' + core + '\nthis.state = THRONE_RTS;', scope);
  const actualHumanInput = scope.netHumanInput;
  scope.netHumanInput = event => { forwarded.push(event); actualHumanInput(event); };
  const snapshot = () => JSON.parse(JSON.stringify({ CAM, position: camera.position, quaternion: camera.quaternion, up: camera.up }));
  const pose = () => JSON.parse(JSON.stringify(player));
  return { scope, window, document, stage, player, CAM, camera, UI, INPUT, normalKeys, picks, closed, forwarded, human,
    snapshot, pose, advance: ms => { clock += ms; }, grant: value => { granted = value; }, live: value => { live = value; },
    start() { UI.modal = 'rts'; return scope.throneRtsStartCamera(player.x, player.z); } };
}

test('only a confirmed live throne enters the camera, and repeated entry restores the exact prior view', () => {
  const f = fixture(), before = f.snapshot();
  f.grant(false); assert.equal(f.start(), false); assert.deepEqual(f.snapshot(), before);
  f.grant(true); f.live(false); assert.equal(f.start(), false);
  f.live(true); f.UI.modal = 'map'; assert.equal(f.scope.throneRtsStartCamera(0, 0), false);
  assert.equal(f.start(), true); assert.equal(f.CAM.mode, 'rts');
  assert.ok(f.camera.position.y > 16); assert.ok(f.camera.lookTarget.y < f.camera.position.y);
  f.scope.throneRtsStartCamera(30, 40);
  f.scope.throneRtsStopCamera(); assert.deepEqual(f.snapshot(), before);
  f.scope.throneRtsStopCamera(); assert.deepEqual(f.snapshot(), before, 'repeated cleanup cannot restore a stale intermediate RTS view');
});

test('camera navigation is finite and bounded without moving the seated avatar', () => {
  const f = fixture(), pose = f.pose(); f.start();
  f.scope.throneRtsPan(70, 40); f.scope.throneRtsZoom(0.5); f.scope.throneRtsUpdateCamera(0.05);
  assert.notEqual(f.scope.state.x, pose.x); assert.notEqual(f.scope.state.z, pose.z);
  assert.ok(f.scope.state.distance < 90); assert.deepEqual(f.pose(), pose);
  f.scope.throneRtsFocus(1e9, -1e9);
  assert.ok(Math.abs(f.scope.state.x) < 512 && Math.abs(f.scope.state.z) < 512);
  f.scope.throneRtsZoom(1e30); assert.equal(f.scope.state.targetDistance, 180);
  f.scope.throneRtsZoom(1e-30); assert.equal(f.scope.state.targetDistance, 45);
  const stable = { x: f.scope.state.x, z: f.scope.state.z, zoom: f.scope.state.targetDistance };
  assert.equal(f.scope.throneRtsFocus(NaN, 0), false); assert.equal(f.scope.throneRtsPan(Infinity, 0), false);
  assert.equal(f.scope.throneRtsZoom(0), false); assert.equal(f.scope.throneRtsZoom(NaN), false);
  assert.deepEqual({ x: f.scope.state.x, z: f.scope.state.z, zoom: f.scope.state.targetDistance }, stable);
  f.scope.throneRtsUpdateCamera(Infinity);
  assert.ok(Object.values(f.camera.position).every(Number.isFinite)); assert.deepEqual(f.pose(), pose);
});

test('captured navigation bypasses ordinary gameplay and forwards only its original input through the actual human lease gate', () => {
  const f = fixture();
  f.window.fire('keydown', { code: 'KeyW' }); assert.deepEqual(f.normalKeys, ['KeyW']);
  f.start(); const pose = f.pose(), normalCount = f.normalKeys.length;
  const key = f.window.fire('keydown', { code: 'KeyW' });
  assert.equal(key.defaultPrevented, true); assert.equal(f.normalKeys.length, normalCount);
  assert.equal(f.forwarded.length, 1); assert.equal(f.forwarded[0], key); assert.equal(f.human.activity, 1);
  const z = f.scope.state.z;
  for (let i = 0; i < 50; i++) f.scope.throneRtsUpdateCamera(0.05);
  assert.notEqual(f.scope.state.z, z); assert.deepEqual(f.pose(), pose);
  assert.equal(f.human.activity, 1, 'rendering and movement do not manufacture trusted input');
  f.window.fire('keyup', { code: 'KeyW' }); assert.equal(f.scope.state.keys.size, 0);
  const synthetic = f.window.fire('keydown', { code: 'KeyW', isTrusted: false });
  assert.equal(f.forwarded.at(-1), synthetic); assert.equal(f.human.activity, 1, 'synthetic input cannot renew the human lease');
  f.window.fire('keyup', { code: 'KeyW' });
  for (const values of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const event = f.window.fire('keydown', { code: 'KeyW', ...values });
    assert.equal(event.defaultPrevented, false); assert.equal(f.scope.state.keys.size, 0);
  }
  f.document.activeElement = { tagName: 'INPUT' };
  assert.equal(f.window.fire('keydown', { code: 'KeyW' }).defaultPrevented, false);
  f.document.activeElement = null;
  assert.equal(f.window.fire('keydown', { code: 'Tab' }).defaultPrevented, false);
  assert.equal(f.human.activity, 1, 'ignored browser and typing keys are left for normal document propagation');
});

test('a tap selects once while drags, cancellation, long presses and two-finger gestures cannot issue an order', () => {
  const f = fixture(); f.start(); f.scope.throneRtsBindStage(f.stage);
  const tap = (id = 1, values = {}) => { f.stage.fire('pointerdown', { pointerId: id, ...values }); f.advance(50); f.stage.fire('pointerup', { pointerId: id, ...values }); };
  tap(); assert.deepEqual(f.picks, [[100, 100]]); assert.equal(f.stage.captures.size, 0);
  const x = f.scope.state.x;
  f.stage.fire('pointerdown'); f.stage.fire('pointermove', { clientX: 140, clientY: 110 });
  f.stage.fire('pointerup', { clientX: 140, clientY: 110 });
  assert.notEqual(f.scope.state.x, x); assert.equal(f.picks.length, 1);
  f.stage.fire('pointerdown'); f.stage.fire('pointercancel');
  assert.equal(f.scope.state.pointers.size, 0); assert.equal(f.stage.captures.size, 0); assert.equal(f.picks.length, 1);
  f.stage.fire('pointerdown'); f.advance(600); f.stage.fire('pointerup'); assert.equal(f.picks.length, 1);
  tap(2, { button: 2 }); assert.equal(f.picks.length, 1);
  f.stage.fire('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 100 });
  f.stage.fire('pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 150 });
  const zoom = f.scope.state.targetDistance;
  f.stage.fire('pointermove', { pointerId: 4, pointerType: 'touch', clientX: 200 });
  assert.notEqual(f.scope.state.targetDistance, zoom);
  f.stage.fire('pointerup', { pointerId: 4, pointerType: 'touch', clientX: 200 });
  f.stage.fire('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 100 });
  assert.equal(f.picks.length, 1); assert.equal(f.scope.state.pointers.size, 0); assert.equal(f.stage.captures.size, 0);
  tap(5, { pointerType: 'touch' }); assert.equal(f.picks.length, 2, 'the next independent tap still works');
});

test('wheel zoom preserves browser modifier gestures and inactive input', () => {
  const f = fixture(); f.scope.throneRtsBindStage(f.stage);
  assert.equal(f.stage.fire('wheel', { deltaY: 60 }).defaultPrevented, false);
  f.start(); const before = f.scope.state.targetDistance;
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(f.stage.fire('wheel', { deltaY: 60, [modifier]: true }).defaultPrevented, false);
    assert.equal(f.scope.state.targetDistance, before);
  }
  assert.equal(f.stage.fire('wheel', { deltaY: 60 }).defaultPrevented, true);
  assert.ok(f.scope.state.targetDistance > before);
});

test('blur, hidden pages, expired human input and revoked grants release controls and restore the previous camera', () => {
  for (const stop of [f => f.window.fire('blur'), f => { f.document.hidden = true; f.document.fire('visibilitychange'); },
    f => f.window.fire('pagehide'), f => { f.live(false); f.scope.throneRtsUpdateCamera(0.05); },
    f => { f.grant(false); f.scope.throneRtsUpdateCamera(0.05); },
    f => { f.player.alive = false; f.scope.throneRtsUpdateCamera(0.05); }]) {
    const f = fixture(), before = f.snapshot(); f.start(); f.scope.throneRtsBindStage(f.stage);
    f.window.fire('keydown', { code: 'KeyW' }); f.stage.fire('pointerdown');
    stop(f);
    assert.equal(f.scope.state.active, false); assert.equal(f.scope.state.keys.size, 0);
    assert.equal(f.scope.state.pointers.size, 0); assert.equal(f.stage.captures.size, 0);
    assert.deepEqual(f.closed, [false]); assert.deepEqual(f.snapshot(), before); assert.equal(f.picks.length, 0);
  }
});

test('Escape and M leave once and subsequent gameplay input is not captured', () => {
  for (const code of ['Escape', 'KeyM']) {
    const f = fixture(), before = f.snapshot(); f.start();
    const event = f.window.fire('keydown', { code });
    assert.equal(event.defaultPrevented, true); assert.deepEqual(f.closed, [true]);
    assert.equal(f.forwarded[0], event); assert.equal(f.human.activity, 1);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.window.fire('keydown', { code: 'KeyW' }).defaultPrevented, false);
    assert.equal(f.normalKeys.at(-1), 'KeyW');
  }
});

test('rebinding and repeated entry do not accumulate listeners or leave captured pointers behind', () => {
  const f = fixture(), other = new Target(); f.start(); f.scope.throneRtsBindStage(f.stage);
  const count = f.stage.count();
  for (let i = 0; i < 12; i++) { f.scope.throneRtsBindStage(f.stage); f.scope.throneRtsStopCamera(); f.start(); }
  assert.equal(f.stage.count(), count);
  f.stage.fire('pointerdown'); f.scope.throneRtsBindStage(other);
  assert.equal(f.stage.captures.size, 0); assert.equal(f.stage.count(), 0);
  assert.equal(f.stage.style.touchAction, 'pan-y'); assert.equal(other.style.touchAction, 'none');
  f.scope.throneRtsBindStage(null); assert.equal(other.count(), 0); assert.equal(other.style.touchAction, 'pan-y');
});

test('cleanup preserves a newer title or photo camera owner instead of restoring the old play view', () => {
  const f = fixture(); f.start(); f.scope.throneRtsBindStage(f.stage);
  f.window.fire('keydown', { code: 'KeyW' }); f.stage.fire('pointerdown');
  f.CAM.mode = 'title'; f.CAM.pos.set(300, 80, 200); f.CAM.focus.set(20, 30, 40);
  f.camera.position.set(300, 80, 200); f.camera.quaternion.copy(new Quaternion(0.5, 0.5, 0.5, 0.5));
  const newer = f.snapshot();
  f.scope.throneRtsStopCamera();
  assert.deepEqual(f.snapshot(), newer); assert.equal(f.scope.state.active, false);
  assert.equal(f.scope.state.saved, null); assert.equal(f.scope.state.keys.size, 0);
  assert.equal(f.scope.state.pointers.size, 0); assert.equal(f.stage.captures.size, 0);
});

test('focusing a form cancels held RTS navigation and pointer capture without issuing an order', () => {
  const f = fixture(); f.start(); f.scope.throneRtsBindStage(f.stage);
  f.window.fire('keydown', { code: 'KeyW' }); f.stage.fire('pointerdown');
  f.document.activeElement = { tagName: 'INPUT' };
  f.document.fire('focusin', { target: f.document.activeElement });
  assert.equal(f.scope.state.active, true); assert.equal(f.scope.state.keys.size, 0);
  assert.equal(f.scope.state.pointers.size, 0); assert.equal(f.stage.captures.size, 0); assert.equal(f.picks.length, 0);
  const focus = [f.scope.state.x, f.scope.state.z];
  f.scope.throneRtsUpdateCamera(0.1); assert.deepEqual([f.scope.state.x, f.scope.state.z], focus);
  f.document.activeElement = null;
  f.window.fire('keydown', { code: 'KeyW' }); assert.equal(f.scope.state.keys.has('KeyW'), true);
  f.window.fire('keyup', { code: 'KeyW' });
});
