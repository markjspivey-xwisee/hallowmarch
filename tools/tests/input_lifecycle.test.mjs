import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL('src/' + name, root), 'utf8');
const input = read('09_player.js').split('const _proj =')[0];
const classes = read('07b_classes.js');
const classUI = read('10d_classes_ui.js');
const mobileSyncSource = extract(read('10q_mobile.js'), 'mobileSync');

function mobileSaveFixture(touch = true) {
  class Node {
    constructor(id) { this.id = id; this.children = []; this.parentElement = null; this.dataset = {}; }
    appendChild(node) { this.detach(node); this.children.push(node); node.parentElement = this; }
    prepend(node) { this.detach(node); this.children.unshift(node); node.parentElement = this; }
    detach(node) { if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1); }
    closest(selector) { return selector === 'button' ? this : null; }
  }
  const hud = new Node('hud'), utilities = new Node('mobile-tray-utilities'), nav = new Node('mobile-tray-nav');
  const keep = new Node('btn-keep-character'), originalAction = () => 'open original identity panel';
  keep.hidden = false; keep.disabled = false; keep.onclick = originalAction; hud.appendChild(keep);
  const elements = new Map([hud, utilities, nav, keep].map(node => [node.id, node]));
  const scope = vm.createContext({ IS_TOUCH: touch, MOBILE_UI: { bound: true }, GAME: { player: null }, UI: { modal: null },
    $: id => elements.get(id) || null });
  vm.runInContext(mobileSyncSource + '\nglobalThis.sync = mobileSync;', scope);
  return { hud, utilities, keep, originalAction, sync: scope.sync, scope };
}

test('touch moves the existing save CTA out of the world into the first row of every menu section without duplicating it', () => {
  const f = mobileSaveFixture(); f.sync();
  assert.equal(f.hud.children.includes(f.keep), false); assert.equal(f.keep.parentElement, f.utilities);
  assert.equal(f.utilities.children[0], f.keep);
  assert.deepEqual(f.keep.dataset.mobileSection.split(' '), ['world', 'character', 'social', 'options']);
  assert.equal(f.keep.onclick, f.originalAction); assert.equal(f.keep.onclick(), 'open original identity panel');
  assert.equal(f.keep.hidden, false); assert.equal(f.keep.disabled, false);
  f.sync(); assert.deepEqual(f.utilities.children, [f.keep]);
});

test('mobile save CTA preserves native expired or claimed visibility and pending-operation disabled state', () => {
  const f = mobileSaveFixture(); f.keep.hidden = true; f.keep.disabled = true; f.sync(); f.sync();
  assert.equal(f.keep.parentElement, f.utilities); assert.equal(f.keep.hidden, true); assert.equal(f.keep.disabled, true);
  assert.equal(f.keep.onclick, f.originalAction);
});

test('desktop keeps its existing floating save action in the HUD', () => {
  const f = mobileSaveFixture(false); f.sync();
  assert.equal(f.keep.parentElement, f.hud); assert.deepEqual(f.utilities.children, []);
  assert.equal(f.keep.onclick, f.originalAction); assert.equal(f.keep.hidden, false);
});

test('existing mobile tray handoff clears its modal guard before the relocated save action opens identity settings', () => {
  const f = mobileSaveFixture(); f.sync(); const callbacks = [];
  f.scope.UI.modal = 'mobile';
  f.scope.tray = { addEventListener(type, run, capture) { assert.equal(type, 'click'); assert.equal(capture, true); callbacks.push(run); } };
  f.scope.mobileTray = (open, focus) => { assert.equal(open, false); assert.equal(focus, false); f.scope.UI.modal = null; };
  const mobile = read('10q_mobile.js'), start = mobile.indexOf("  tray.addEventListener('click', (e) => {", mobile.indexOf('// Existing buttons retain their listeners'));
  vm.runInContext(mobile.slice(start, mobile.indexOf('  }, true);', start) + '  }, true);'.length), f.scope);
  let opened = false;
  f.keep.onclick = () => { assert.equal(f.scope.UI.modal, null); opened = true; };
  callbacks[0]({ target: f.keep }); f.keep.onclick(); assert.equal(opened, true);
});

function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function event(type, values = {}) {
  return { type, repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }, stopPropagation() {}, ...values };
}
function target() {
  const listeners = new Map();
  return { addEventListener(type, cb) { const list = listeners.get(type) || []; list.push(cb); listeners.set(type, list); },
    dispatch(type, values) { const e = event(type, values); for (const cb of listeners.get(type) || []) { cb(e); if (e.stopped) break; } return e; } };
}
function harness() {
  const window = target(), document = target(), canvas = target(), actions = [], captures = new Set(), removed = [];
  const player = { cls: 'archer', alive: true, power: 30, target: 2, swing: 1, swingAt: 0, cs: { drawFrom: -1 } };
  Object.assign(document, { activeElement: null, hidden: false,
    querySelectorAll: () => [{ classList: { remove: name => removed.push(name) } }] });
  Object.assign(canvas, { hasPointerCapture: id => captures.has(id), setPointerCapture: id => captures.add(id),
    releasePointerCapture(id) { captures.delete(id); canvas.dispatch('lostpointercapture', { pointerId: id }); } });
  const scope = vm.createContext({ window, document, canvas, performance: { now: () => 200 },
    THREE: { Vector3: class {} }, GAME: { started: true, player }, UI: { modal: null }, CLS: { hold: false },
    clamp: (v, min, max) => Math.max(min, Math.min(v, max)), hideJoystick: () => actions.push('hide-stick'),
    audioUnlock() {}, mobileMovementZone: () => false, showJoystick() {}, buildTap: () => false, pickAt: () => actions.push('pick'),
    getEnt: () => ({ alive: true }), isEnemy: () => true, csOf: e => e.cs, nowT: () => 10,
    startDraw: e => { e.cs.drawFrom = 8; }, drawK: () => 1, drawFull: () => 2,
    looseArrow: () => actions.push('shot'), uiError: () => actions.push('error'),
    setBlock: (e, on) => { e.cs.blockOn = on; }, startPrayer: e => { e.cs.praying = true; }, stopPrayer: e => { e.cs.praying = false; },
    onEscape: () => actions.push('escape'), toggleMap: () => actions.push('map'), toggleKit: () => actions.push('kit'),
    playerUseSlot: () => actions.push('ability'), cycleTarget: reverse => actions.push(reverse ? 'target-reverse' : 'target'),
    setPlayerTarget: () => actions.push('target-self'), playerInteract: () => actions.push('interact'), toggleMount: () => actions.push('mount'),
    usePotion: () => actions.push('potion'), toggleLog: () => actions.push('log'), openMenu: () => actions.push('menu'),
    classTechniqueUI: () => actions.push('technique'), cycleArrow: () => actions.push('arrow') });
  vm.runInContext(extract(classes, 'classHold') + '\n' + extract(classes, 'releaseDraw') + '\n' + input, scope);
  vm.runInContext(classUI.slice(classUI.indexOf("window.addEventListener('keydown'"), classUI.indexOf('/* ---- the help')), scope);
  vm.runInContext('globalThis.hooks = { INPUT, CAM, classHold, cancelPlayerInput };', scope);
  return { scope, window, document, canvas, actions, captures, removed, player, ...scope.hooks };
}

function joystickHarness(hand = 'right') {
  const h = harness();
  function classList(...initial) {
    const names = new Set(initial);
    return { add: name => names.add(name), remove: name => names.delete(name), contains: name => names.has(name),
      toggle(name, enabled) { if (enabled) names.add(name); else names.delete(name); } };
  }
  const joy = { classList: classList(), style: {}, firstChild: { style: {} } };
  const hint = { style: { opacity: '' } }, hud = { contains: () => false, inert: false }, tray = { hidden: true };
  const nodes = { joy, joyhint: hint, hud, 'mobile-tray': tray };
  h.document.body = { classList: classList('touch') };
  Object.assign(h.scope, { $: id => nodes[id] || null, view: { w: 390, h: 844 }, MOBILE_PREFS: { hand },
    MOBILE_UI: { focus: null }, queueMicrotask: run => run() });
  const mobile = read('10q_mobile.js'), ui = read('10_ui.js');
  vm.runInContext(['mobileMovementZone', 'mobileStopInput', 'mobileModalChanged'].map(name => extract(mobile, name)).join('\n') +
    '\n' + ['showJoystick', 'hideJoystick'].map(name => extract(ui, name)).join('\n'), h.scope);
  const page = read('page.html');
  const idleOpacity = [...page.matchAll(/body\.touch #joyhint \{([^}]+)\}/g)]
    .map(match => match[1].match(/(?:^|;)\s*opacity:\s*([\d.]+)/)).filter(Boolean).at(-1)?.[1];
  assert.ok(Number(idleOpacity) > 0 && Number(idleOpacity) < 1, 'the idle guide remains faintly visible');
  assert.match(page, /body\.touch\.mobile-modal-open #touch,[\s\S]*?\{\s*visibility: hidden;/);
  assert.match(page, /body\.touch\.mobile-left-handed #joyhint \{ left: auto; right: 14px; \}/);
  return { ...h, joy, hint, hud,
    cueOpacity: () => h.document.body.classList.contains('mobile-modal-open') ? 0 : Number(hint.style.opacity === '' ? idleOpacity : hint.style.opacity),
    modal(value) { h.scope.UI.modal = value; h.scope.mobileModalChanged(value); } };
}

for (const hand of ['right', 'left']) {
  test(`${hand}-handed controls keep a faint idle guide across repeated release, cancellation and lost capture`, () => {
    const h = joystickHarness(hand), x = hand === 'right' ? 60 : 330;
    for (const [i, ending] of ['pointerup', 'pointercancel', 'lostpointercapture'].entries()) {
      assert.ok(h.cueOpacity() > 0 && h.cueOpacity() < 1); assert.equal(h.joy.classList.contains('on'), false);
      h.canvas.dispatch('pointerdown', { pointerId: i + 1, pointerType: 'touch', clientX: x, clientY: 600 });
      assert.equal(h.INPUT.joy.id, i + 1); assert.equal(h.joy.classList.contains('on'), true); assert.equal(h.cueOpacity(), 0);
      assert.equal(h.joy.style.left, x + 'px'); assert.equal(h.joy.style.top, '600px');
      h.canvas.dispatch('pointermove', { pointerId: i + 1, clientX: x + 20, clientY: 625 });
      assert.equal(h.joy.firstChild.style.transform, 'translate(20px, 25px)'); assert.equal(h.cueOpacity(), 0);
      h.canvas.dispatch(ending, { pointerId: i + 1, clientX: x + 20, clientY: 625 });
      assert.equal(h.INPUT.joy, null); assert.equal(h.joy.classList.contains('on'), false);
      assert.ok(h.cueOpacity() > 0 && h.cueOpacity() < 1); assert.ok(!h.actions.includes('pick'));
    }
  });
}

test('releasing a second finger leaves the active movement stick visible and its idle guide hidden', () => {
  const h = joystickHarness();
  h.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 600 });
  h.canvas.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 600 });
  h.canvas.dispatch('pointercancel', { pointerId: 2 });
  assert.equal(h.INPUT.joy.id, 1); assert.equal(h.joy.classList.contains('on'), true); assert.equal(h.cueOpacity(), 0);
  h.canvas.dispatch('pointerup', { pointerId: 1 });
  assert.equal(h.joy.classList.contains('on'), false); assert.ok(h.cueOpacity() > 0);
});

test('opening a modal cancels the stick and hides the guide, then restores an idle guide and a working next drag', () => {
  const h = joystickHarness();
  h.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 600 });
  h.modal('menu');
  assert.equal(h.INPUT.joy, null); assert.equal(h.joy.classList.contains('on'), false);
  assert.equal(h.hud.inert, true); assert.equal(h.cueOpacity(), 0);
  h.canvas.dispatch('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 60, clientY: 600 });
  assert.equal(h.INPUT.joy, null); assert.equal(h.joy.classList.contains('on'), false);
  h.modal(null);
  assert.equal(h.hud.inert, false); assert.ok(h.cueOpacity() > 0 && h.cueOpacity() < 1);
  h.canvas.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 60, clientY: 600 });
  assert.equal(h.INPUT.joy.id, 3); assert.equal(h.joy.classList.contains('on'), true); assert.equal(h.cueOpacity(), 0);
  h.window.dispatch('blur');
  assert.equal(h.INPUT.joy, null); assert.equal(h.joy.classList.contains('on'), false); assert.ok(h.cueOpacity() > 0);
});

test('blur cancels active movement/camera/joystick and bow draw before releasing pointer capture', () => {
  const h = harness();
  h.INPUT.keys.add('KeyW'); h.INPUT.joy = { id: 3, dx: 1, dy: 0 };
  h.INPUT.drag = {}; h.INPUT.look = {}; h.INPUT.wheel = 3;
  h.canvas.dispatch('pointerdown', { pointerId: 4, pointerType: 'mouse', clientX: 0, clientY: 0 });
  h.classHold(true, 'touch');
  h.window.dispatch('blur');
  assert.equal(h.INPUT.keys.size, 0); assert.equal(h.INPUT.pointers.size, 0);
  assert.equal(h.INPUT.joy, null); assert.equal(h.INPUT.drag, null); assert.equal(h.INPUT.look, null); assert.equal(h.INPUT.wheel, 0);
  assert.equal(h.captures.size, 0); assert.equal(h.scope.CLS.hold, false); assert.equal(h.player.cs.drawFrom, -1);
  assert.equal(h.player.power, 30); assert.ok(!h.actions.includes('shot'));
  h.canvas.dispatch('pointermove', { pointerId: 4, clientX: 100, clientY: 100 });
  h.canvas.dispatch('pointerup', { pointerId: 4, clientX: 100, clientY: 100 });
  assert.equal(h.CAM.yaw, 0); assert.ok(!h.actions.includes('pick'));
});

test('hidden tabs cancel input even without blur; making a visible page visible preserves new input', () => {
  const h = harness();
  h.INPUT.keys.add('KeyW'); h.classHold(true);
  h.document.hidden = true; h.document.dispatch('visibilitychange');
  assert.equal(h.INPUT.keys.size, 0); assert.equal(h.scope.CLS.hold, false); assert.ok(!h.actions.includes('shot'));
  h.INPUT.keys.add('KeyD'); h.document.hidden = false; h.document.dispatch('visibilitychange');
  assert.ok(h.INPUT.keys.has('KeyD'));
});

for (const editor of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
  test(`focusing ${editor.tagName}${editor.isContentEditable ? ' editor' : ''} stops prior movement and drawn attack`, () => {
    const h = harness();
    h.window.dispatch('keydown', { code: 'KeyW' }); h.classHold(true);
    h.document.activeElement = editor; h.document.dispatch('focusin');
    h.window.dispatch('keydown', { code: 'KeyX' }); h.window.dispatch('keyup', { code: 'KeyX' });
    assert.equal(h.INPUT.keys.size, 0); assert.equal(h.scope.CLS.hold, false); assert.equal(h.player.power, 30);
    assert.ok(!h.actions.includes('shot'));
  });
}

test('normal X release still shoots exactly once and uses the normal draw cost', () => {
  const h = harness();
  h.window.dispatch('keydown', { code: 'KeyX' }); h.window.dispatch('keyup', { code: 'KeyX' }); h.window.dispatch('blur');
  assert.equal(h.actions.filter(a => a === 'shot').length, 1); assert.equal(h.player.power, 27); assert.equal(h.player.cs.drawFrom, -1);
});

test('touch pointer cancellation drops the drawn arrow, while intentional pointerup releases it', () => {
  const h = harness(), heldButton = { classList: { remove() {} } };
  h.scope.hold = heldButton;
  const line = classUI.split('\n').find(s => s.trimStart().startsWith('const up ='));
  vm.runInContext(line + '\nglobalThis.touchUp = up;', h.scope);
  h.classHold(true, 'touch'); h.scope.touchUp(event('pointercancel'));
  assert.equal(h.player.power, 30); assert.ok(!h.actions.includes('shot'));
  h.classHold(true, 'touch'); h.scope.touchUp(event('lostpointercapture'));
  assert.equal(h.player.power, 30); assert.ok(!h.actions.includes('shot'));
  h.classHold(true, 'touch'); h.scope.touchUp(event('pointerup')); h.scope.touchUp(event('lostpointercapture'));
  assert.equal(h.actions.filter(a => a === 'shot').length, 1); assert.equal(h.player.power, 27);
});

test('cancellation releases shield and prayer and clears held-button visual states', () => {
  const h = harness();
  for (const [cls, property] of [['warrior', 'blockOn'], ['priest', 'praying']]) {
    h.player.cls = cls; h.classHold(true, 'key'); assert.equal(h.player.cs[property], true);
    h.cancelPlayerInput(); assert.equal(h.player.cs[property], false);
  }
  assert.ok(h.removed.includes('on')); assert.ok(h.removed.includes('is-pressed'));
});

test('browser shortcuts and IME never become movement, mount, inventory, or class input', () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    const h = harness();
    for (const code of ['KeyW', 'KeyR', 'KeyL', 'KeyM', 'KeyI', 'KeyX', 'KeyT', 'Digit1', 'Escape']) {
      const e = h.window.dispatch('keydown', { code, ...modifier });
      assert.equal(e.defaultPrevented, false);
    }
    assert.equal(h.INPUT.keys.size, 0); assert.deepEqual(h.actions, []); assert.equal(h.scope.CLS.hold, false);
  }
});

test('ordinary movement, sprint key and Shift+Tab target cycling remain available', () => {
  const h = harness();
  h.window.dispatch('keydown', { code: 'KeyW' }); h.window.dispatch('keydown', { code: 'ShiftLeft', shiftKey: true });
  const e = h.window.dispatch('keydown', { code: 'Tab', shiftKey: true });
  assert.ok(h.INPUT.keys.has('KeyW')); assert.ok(h.INPUT.keys.has('ShiftLeft')); assert.ok(h.actions.includes('target-reverse'));
  assert.equal(e.defaultPrevented, true);
});

test('focused HUD controls retain native activation and Tab navigation without jumping or opening chat', () => {
  const h = harness(), source = read('14o_netui.js');
  Object.assign(h.scope, { addEventListener: h.window.addEventListener.bind(h.window), NETUI: { on: true, chan: 'r' },
    BUILD: { mode: null }, netPeopleCount: () => 1, netChatOpen: () => h.actions.push('chat') });
  vm.runInContext(source.slice(source.indexOf("\naddEventListener('keydown'"), source.indexOf('const netPeopleCount')), h.scope);
  h.document.activeElement = { tagName: 'BUTTON', closest: () => ({}) };
  for (const code of ['Space', 'Enter', 'NumpadEnter', 'Tab']) {
    const e = h.window.dispatch('keydown', { code });
    assert.equal(e.defaultPrevented, false); assert.equal(h.INPUT.keys.size, 0); assert.deepEqual(h.actions, []);
  }
  // Clicking a HUD control must not disable normal WASD controls afterwards.
  h.window.dispatch('keydown', { code: 'KeyW' }); assert.ok(h.INPUT.keys.has('KeyW'));
  h.document.activeElement = { tagName: 'CANVAS', closest: () => null };
  const jump = h.window.dispatch('keydown', { code: 'Space' });
  assert.equal(jump.defaultPrevented, true); assert.ok(h.INPUT.keys.has('Space'));
  const chat = h.window.dispatch('keydown', { code: 'Enter' });
  assert.equal(chat.defaultPrevented, true); assert.ok(h.actions.includes('chat'));
});

test('mobile modal cancellation uses the same input cancellation as desktop focus changes', () => {
  const h = harness();
  vm.runInContext(extract(read('10q_mobile.js'), 'mobileStopInput'), h.scope);
  h.INPUT.keys.add('KeyW'); h.classHold(true, 'touch'); h.scope.mobileStopInput();
  assert.equal(h.INPUT.keys.size, 0); assert.equal(h.scope.CLS.hold, false); assert.equal(h.player.power, 30);
  assert.ok(!h.actions.includes('shot'));
});

test('desktop map, inventory and menu immediately cancel input, even when closed before keyup', () => {
  const h = harness();
  Object.assign(h.scope, { MOBILE_UI: { bound: false }, IS_TOUCH: false,
    $: () => { throw new Error('desktop cancellation must not access touch UI'); } });
  vm.runInContext(extract(read('10q_mobile.js'), 'mobileBind'), h.scope);
  h.scope.mobileBind(); h.scope.mobileBind();
  for (const modal of ['map', 'kit', 'menu']) {
    h.window.dispatch('keydown', { code: 'KeyW' }); h.window.dispatch('keydown', { code: 'KeyX' });
    assert.equal(h.scope.CLS.hold, true);
    h.scope.UI.modal = modal;
    assert.equal(h.INPUT.keys.size, 0); assert.equal(h.scope.CLS.hold, false); assert.equal(h.player.cs.drawFrom, -1);
    h.scope.UI.modal = null;
    h.window.dispatch('keyup', { code: 'KeyX' });
    assert.equal(h.player.power, 30); assert.ok(!h.actions.includes('shot'));
    assert.equal(h.INPUT.keys.size, 0);
  }
});

const extraShortcuts = [
  ['06c_gifts.js', 'Digit9', 'gift'], ['06k_build.js', 'KeyG', 'build'],
  ['07d_dive.js', 'KeyU', 'dive'], ['08h_animals.js', 'KeyK', 'animals'],
  ['09s_survival.js', 'KeyC', 'craft'], ['10c_lore.js', 'KeyJ', 'chronicle'], ['14o_netui.js', 'KeyP', 'players'],
];
for (const [file, code, action] of extraShortcuts) {
  test(`${file}: browser shortcuts stay native while the unmodified shortcut still works`, () => {
    const h = harness(), source = read(file), marker = file === '10c_lore.js' ? source.indexOf('// J opens') : 0;
    const start = file === '14o_netui.js' ? source.indexOf("\naddEventListener('keydown'") + 1 : source.indexOf("window.addEventListener('keydown'", marker);
    const fragment = source.slice(start), end = fragment.match(/\n\s*}, (?:true|false)\);|\n\s*}\);/);
    assert.ok(start >= 0 && end, file);
    Object.assign(h.scope, {
      NETUI: { on: true }, BUILD: { mode: null }, ANIMALS: { dlg: false, marking: false }, LORE: {},
      useRealmGift: () => h.actions.push('gift'), buildToggle: () => h.actions.push('build'),
      diveToggle: () => h.actions.push('dive'), openAnimals: () => h.actions.push('animals'),
      openCraft: () => h.actions.push('craft'), openChronicle: () => h.actions.push('chronicle'),
      netSheetToggle: () => h.actions.push('players'),
    });
    vm.runInContext(fragment.slice(0, end.index + end[0].length).replace(/^(?:window\.)?addEventListener/, 'shortcutWindow.addEventListener'),
      Object.assign(h.scope, { shortcutWindow: target() }));
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      const e = h.scope.shortcutWindow.dispatch('keydown', { code, ...modifier });
      assert.equal(e.defaultPrevented, false); assert.deepEqual(h.actions, []);
    }
    h.scope.shortcutWindow.dispatch('keydown', { code });
    assert.deepEqual(h.actions, [action]);
  });
}
