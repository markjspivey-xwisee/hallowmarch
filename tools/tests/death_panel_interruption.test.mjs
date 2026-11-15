// Actual death, panel, input and recovery functions; no browser, renderer or live game bootstrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
const sources = Object.fromEntries(['10_ui.js', '10b_kit.js', '10q_mobile.js', '14o_netui.js',
  '09_player.js', '07_entities.js', '08_ai.js', '04k_hall.js', '10q_throne_rts.js'].map(file => [file, read(file)]));
const trees = Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, parse(source, {ecmaVersion: 'latest'})]));
function declaration(file, name) {
  const matches = trees[file].body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name
    || node.type === 'VariableDeclaration' && node.declarations.some(row => row.id.name === name));
  assert.equal(matches.length, 1, 'One actual declaration: ' + file + ':' + name);
  return sources[file].slice(matches[0].start, matches[0].end);
}
function releaseAssignment() {
  const matches = trees['10_ui.js'].body.filter(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'AssignmentExpression' && node.expression.left.type === 'MemberExpression'
    && node.expression.left.property.name === 'onclick' && node.expression.left.object.type === 'CallExpression'
    && node.expression.left.object.callee.name === '$' && node.expression.left.object.arguments[0]?.value === 'btn-release');
  assert.equal(matches.length, 1, 'Actual Release callback');
  return sources['10_ui.js'].slice(matches[0].start, matches[0].end);
}
function modalInstaller() {
  const bind = trees['10q_mobile.js'].body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'mobileBind');
  assert(bind);
  const local = bind.body.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(row => row.id.name === 'modal'));
  const setter = bind.body.body.filter(node => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression'
    && node.expression.callee.type === 'MemberExpression' && node.expression.callee.object.name === 'Object'
    && node.expression.callee.property.name === 'defineProperty' && node.expression.arguments[0]?.name === 'UI'
    && node.expression.arguments[1]?.value === 'modal');
  assert.equal(local.length, 1); assert.equal(setter.length, 1);
  // Keep the actual setter and its lexical owner; omit unrelated event registration and touch setup.
  return [local[0], setter[0]].map(node => sources['10q_mobile.js'].slice(node.start, node.end)).join('\n');
}

function fixture({touch = false, dungeon = false, bed = null, network = true} = {}) {
  const trace = [], microtasks = [], nodes = new Map(), pointerCaptures = new Set();
  const document = {activeElement: null, querySelectorAll: () => [], body: null};
  class Element {
    constructor(id, tagName = 'BUTTON') {
      this.id = id; this.tagName = tagName; this.hidden = false; this.inert = false; this.disabled = false;
      this.isConnected = true; this.tabIndex = 0; this.parentElement = null; this.children = []; this.attributes = {};
      this.textContent = ''; this.innerHTML = ''; this.onclick = null;
      const classes = new Set();
      this.classList = {add: value => classes.add(value), remove: value => classes.delete(value),
        toggle(value, force) {const on = force === undefined ? !classes.has(value) : !!force;
          if (on) classes.add(value); else classes.delete(value); return on;}, contains: value => classes.has(value)};
      nodes.set(id, this);
    }
    appendChild(child) {child.parentElement = this; this.children.push(child); return child;}
    contains(node) {for (; node; node = node.parentElement) if (node === this) return true; return false;}
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector.includes('[hidden]') && node.hidden || selector.includes('[inert]') && node.inert) return node;
      }
      return null;
    }
    getClientRects() {return this.closest('[hidden]') ? [] : [{}];}
    setAttribute(name, value) {this.attributes[name] = String(value);}
    focus() {if (!this.closest('[hidden], [inert]')) {document.activeElement = this; trace.push('focus:' + this.id);}}
    blur() {if (document.activeElement === this) document.activeElement = document.body;}
  }
  document.body = new Element('body', 'BODY');
  let dynamicId = 0;
  document.createElement = tag => new Element('dynamic-' + (++dynamicId), tag.toUpperCase());
  const child = (parent, id, tag) => parent.appendChild(new Element(id, tag));
  const hud = child(document.body, 'hud', 'DIV');
  for (const id of ['btn-menu', 'btn-kit', 'btn-map', 'btn-net', 'mobile-inventory', 'mobile-map', 'mobile-menu-toggle']) child(hud, id);
  for (const [id, controls] of [['mapov', ['btn-mapclose']], ['kit', ['kit-close']],
    ['death', ['btn-release', 'death-by']], ['dialog', ['dlg-title', 'dlg-body', 'dlg-actions']],
    ['netsheet', ['netsheet-close']], ['netchat', ['netchat-in']], ['mobile-tray', []], ['rts-root', []]]) {
    const panel = child(document.body, id, 'DIV'); panel.hidden = true;
    for (const control of controls) child(panel, control, control === 'netchat-in' ? 'INPUT' : 'BUTTON');
  }
  document.activeElement = nodes.get('btn-menu');
  const player = {id: 1, name: 'Recruit', role: 'player', kind: 'humanoid', cls: 'warrior', faction: 0, level: 1,
    alive: true, hp: 100, maxHp: 100, power: 30, maxPower: 60, endurance: 20,
    x: 1000, y: 3, z: 0, prevX: 999, prevZ: 0, target: 2, casting: {remaining: 1}, buffs: [], anim: {death: 0}};
  const input = {keys: new Set(), pointers: new Map(), joy: null, look: null, drag: null, wheel: 0};
  const state = {saves: 0, randomCalls: 0, rewardCalls: 0, chatRemembers: 0, releaseCalls: 0};
  const math = Object.create(Math);
  math.random = () => {state.randomCalls++; return .25;};
  const c = vm.createContext({document, Math: math, GAME: {t: 20, started: true, player, prog: {deaths: 0, level: 1, bounty: null}},
    UI: {modal: null}, INPUT: input, CLS: {hold: null}, IS_TOUCH: touch, R_RING: 500, LEVEL_CAP: 1,
    REALMS: [{name: 'Logres', townName: 'Caer', town: {x: 1000, z: 0, yaw: .2}, musterSite: {x: 10, z: 0, yaw: .5}},
      {name: 'Eriu'}, {name: 'Thule'}], CAM: {yaw: 0}, HALL: {sit: null}, THRONE_RTS: {active: false},
    THRONE_RTS_UI: {root: nodes.get('rts-root'), markers: ['old'], markerKey: 'old', focusBefore: null},
    MOBILE_UI: {focus: nodes.get('btn-menu')}, NETUI: {open: false, chatOpen: false, returnFocus: null, chatReturnFocus: null},
    $: id => {assert(nodes.has(id), 'Declared DOM node: ' + id); return nodes.get(id);},
    queueMicrotask: fn => microtasks.push(fn), canvas: {hasPointerCapture: id => pointerCaptures.has(id),
      releasePointerCapture: id => {pointerCaptures.delete(id); trace.push('capture-release:' + id);}},
    hideJoystick: () => trace.push('joystick-hidden'), classHold: (...args) => {trace.push('hold:' + args.join(':')); c.CLS.hold = null;},
    renderKit: () => trace.push('render-kit'), nearMerchant: () => null, drawWorldMap: () => trace.push('draw-map'),
    netSheetRender: () => trace.push('render-net'), netChatRemember: () => {state.chatRemembers++;},
    throneRtsStopCamera: () => trace.push('rts-camera-stop'), netThroneSend: (...args) => trace.push('throne:' + args.join(':')),
    inDungeon: () => dungeon, buildBedSpot: () => bed, siteWorld: (site, dx, dy, dz) => ({x: site.x + dx, z: site.z + dz}),
    heightAt: () => 7, leaveBarrow: force => trace.push('barrow:' + force), FX: {burst: () => trace.push('burst')},
    saveSoon: () => {state.saves++;}, activityRecord: (...args) => trace.push('activity:' + args[0] + ':' + args[1]),
    activityEntityEvent: () => {}, deathEffects: () => trace.push('death-effects'), sfx: name => trace.push('sound:' + name),
    flashScreen: () => {}, late2HeraldBounty: () => null, late3HeraldText: () => '', seasonWarText: () => '',
    addXP: () => {state.rewardCalls++;}, addGold: () => {state.rewardCalls++;}, addRP: () => {state.rewardCalls++;},
  });
  const selected = [
    ['09_player.js', ['typing', 'cancelPlayerInput', 'onPlayerDeath', 'releasePlayer']],
    ['10b_kit.js', ['esc', 'kitReturnFocus', 'kitFocusable', 'openKit', 'closeKit']],
    ['10_ui.js', ['mapReturnFocus', 'toggleMap', 'dialogReturnFocus', 'dialogFocusStart', 'closeDialog', 'openHerald', 'uiDeathDamage', 'uiDeath']],
    ['10q_mobile.js', ['mobileModalChanged', 'mobileStopInput']],
    ['14o_netui.js', ['netUiFocusable', 'netSheetToggle', 'netChatClose']],
    ['04k_hall.js', ['hallLeave']], ['10q_throne_rts.js', ['closeThroneRTS']],
    ['07_entities.js', ['killEnt']], ['08_ai.js', ['onEntityKilled']],
  ].flatMap(([file, names]) => names.map(name => declaration(file, name))).join('\n');
  vm.runInContext(selected + '\n' + modalInstaller() + '\n' + releaseAssignment(), c);
  const descriptor = Object.getOwnPropertyDescriptor(c.UI, 'modal');
  Object.defineProperty(c.UI, 'modal', {configurable: true, enumerable: true, get: descriptor.get,
    set(value) {trace.push('modal:' + value); descriptor.set.call(this, value);}});
  for (const name of ['netSheetToggle', 'netChatClose', 'closeKit', 'toggleMap', 'closeDialog']) {
    const original = c[name];
    c[name] = (...args) => {trace.push('call:' + name + (args.length ? ':' + args[0] : '')); return original(...args);};
  }
  const actualRelease = c.releasePlayer;
  c.releasePlayer = () => {state.releaseCalls++; return actualRelease();};
  if (!network) {c.netSheetToggle = undefined; c.netChatClose = undefined;}
  const drain = () => {let count = 0; while (microtasks.length) {assert(++count < 100, 'Finite queued focus'); microtasks.shift()();}};
  const arm = () => {pointerCaptures.add(41); pointerCaptures.add(42); input.keys.add('KeyW'); input.pointers.set(41, {}); input.joy = {id: 42};
    input.look = {}; input.drag = {}; input.wheel = 2; c.CLS.hold = 'draw';};
  function open(panel) {
    arm();
    if (panel === 'kit') c.openKit();
    else if (panel === 'map') c.toggleMap(true);
    else if (panel === 'dialog') c.openHerald();
    else if (panel === 'net') c.netSheetToggle(true);
    else assert.equal(panel, null);
    return panel;
  }
  const attacker = {id: 2, name: 'Aldric', level: 20, faction: 2, role: 'guard'};
  const die = () => {trace.length = 0; c.killEnt(player, attacker);};
  return {c, nodes, player, input, state, trace, microtasks, pointerCaptures, open, die, drain, arm};
}
const countCall = (f, name) => f.trace.filter(row => row === 'call:' + name || row.startsWith('call:' + name + ':')).length;
function assertDeathOwns(f) {
  assert.equal(f.player.alive, false); assert.equal(f.player.hp, 0); assert.equal(f.c.GAME.prog.deaths, 1);
  assert.equal(f.c.UI.modal, 'death'); assert.equal(f.nodes.get('death').hidden, false);
  for (const id of ['kit', 'mapov', 'dialog', 'netsheet', 'netchat']) assert.equal(f.nodes.get(id).hidden, true, id + ' hidden');
  assert.equal(f.c.document.activeElement, f.nodes.get('btn-release'));
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule.');
  assert.equal(f.state.saves, 0); assert.equal(f.state.rewardCalls, 0); assert.equal(f.state.randomCalls, 0);
}

for (const panel of ['kit', 'map', 'dialog']) test(`fatal player death closes the actual active ${panel} before recovery`, () => {
  const f = fixture(); f.open(panel); f.die(); assertDeathOwns(f);
  const closer = {kit: 'closeKit', map: 'toggleMap', dialog: 'closeDialog'}[panel];
  assert.equal(countCall(f, closer), 1);
  for (const other of ['closeKit', 'toggleMap', 'closeDialog'].filter(name => name !== closer)) assert.equal(countCall(f, other), 0);
  assert(f.trace.indexOf('call:netSheetToggle:false') < f.trace.indexOf('call:netChatClose'));
  assert(f.trace.indexOf('call:netChatClose') < f.trace.findIndex(row => row.startsWith('call:' + closer)));
  assert(f.trace.findIndex(row => row.startsWith('call:' + closer)) < f.trace.indexOf('modal:death'));
  f.nodes.get('btn-release').onclick(); f.drain();
  assert.equal(f.c.UI.modal, null); assert.equal(f.player.alive, true); assert.equal(f.nodes.get('death').hidden, true);
  for (const id of ['kit', 'mapov', 'dialog']) assert.equal(f.nodes.get(id).hidden, true, 'No orphan after Release: ' + id);
  assert.equal(f.state.releaseCalls, 1); assert.equal(f.state.saves, 1); assert.equal(f.state.randomCalls, 1);
});

for (const touch of [false, true]) test(`${touch ? 'touch' : 'desktop'} queued panel focus cannot reclaim the death screen or held input`, () => {
  const f = fixture({touch}); f.open('dialog');
  // Leave actual dialog entry focus queued, then seed stale held state to exercise death cancellation itself.
  f.arm(); f.die(); f.drain(); assertDeathOwns(f);
  assert.equal(f.input.keys.size, 0); assert.equal(f.input.pointers.size, 0);
  for (const key of ['joy', 'look', 'drag']) assert.equal(f.input[key], null);
  assert.equal(f.input.wheel, 0); assert.equal(f.c.CLS.hold, null); assert.equal(f.pointerCaptures.size, 0);
  assert.equal(f.trace.at(-1), 'focus:btn-release');
  if (touch) assert.equal(f.nodes.get('hud').inert, true);
});

test('existing Players and chat cleanup runs before death and preserves their draft boundary', () => {
  const f = fixture(); f.open('net');
  f.c.NETUI.chatOpen = true; f.nodes.get('netchat').hidden = false;
  f.c.NETUI.chatReturnFocus = f.nodes.get('btn-menu');
  f.die(); f.drain(); assertDeathOwns(f);
  assert.equal(f.c.NETUI.open, false); assert.equal(f.c.NETUI.chatOpen, false); assert.equal(f.state.chatRemembers, 1);
  assert.equal(f.trace.includes('render-net'), false, 'Death must not render Players after setup');
  for (const name of ['closeKit', 'toggleMap', 'closeDialog']) assert.equal(countCall(f, name), 0);
  assert(f.trace.indexOf('call:netSheetToggle:false') < f.trace.indexOf('call:netChatClose'));
  assert(f.trace.indexOf('call:netChatClose') < f.trace.indexOf('modal:death'));
});

test('a dead seated map owner uses existing hall and RTS teardown without moving the corpse', () => {
  const f = fixture();
  f.c.HALL.sit = {H: {num: 8}, front: {x: 55, z: 66}}; f.player.seat = {y: 1};
  f.c.THRONE_RTS_UI.root.hidden = false; f.c.THRONE_RTS_UI.focusBefore = f.nodes.get('btn-map');
  f.open('map'); const position = [f.player.x, f.player.z, f.player.prevX, f.player.prevZ];
  f.die(); f.drain(); assertDeathOwns(f);
  assert.equal(f.c.HALL.sit, null); assert.equal(f.player.seat, null); assert.equal(f.c.THRONE_RTS_UI.root.hidden, true);
  assert.equal(f.c.THRONE_RTS_UI.markerKey, ''); assert.equal(f.c.THRONE_RTS_UI.markers.length, 0);
  assert.deepEqual([f.player.x, f.player.z, f.player.prevX, f.player.prevZ], position);
  assert.equal(countCall(f, 'toggleMap'), 2, 'Existing finite nested map close is retained');
  assert.equal(f.trace.filter(row => row === 'throne:release:8').length, 1);
  assert.equal(f.trace.filter(row => row === 'draw-map').length, 0, 'Force-close must not redraw the map');
});

test('ordinary, bed and barrow release retain actual recovery, save and RNG behavior', () => {
  for (const mode of ['ordinary', 'bed', 'barrow']) {
    const f = fixture({dungeon: mode === 'barrow', bed: mode === 'bed' ? {x: 70, y: 8, z: 90} : null});
    f.open('kit'); f.die(); assertDeathOwns(f);
    assert.equal(f.nodes.get('btn-release').textContent,
      mode === 'barrow' ? 'Release to the barrow mouth' : mode === 'bed' ? 'Release to your bed' : 'Release to Caer');
    f.nodes.get('btn-release').onclick(); f.drain();
    assert.equal(f.player.hp, f.player.maxHp); assert.equal(f.player.power, f.player.maxPower); assert.equal(f.player.endurance, 100);
    assert.equal(f.player.alive, true); assert.equal(f.player.casting, null); assert.equal(f.player.buffs.length, 0);
    assert.equal(f.state.releaseCalls, 1); assert.equal(f.state.saves, mode === 'barrow' ? 0 : 1);
    assert.equal(f.state.randomCalls, mode === 'barrow' ? 0 : 1);
    assert.equal(f.nodes.get('kit').hidden, true); assert.equal(f.nodes.get('death').hidden, true); assert.equal(f.c.UI.modal, null);
    if (mode === 'bed') assert.deepEqual([f.player.x, f.player.y, f.player.z], [70, 8, 90]);
    if (mode === 'barrow') assert(f.trace.includes('barrow:true'));
  }
});

test('death without a legacy panel and without optional network APIs retains its original path', () => {
  const f = fixture({network: false}); f.die(); f.drain(); assertDeathOwns(f);
  for (const name of ['closeKit', 'toggleMap', 'closeDialog']) assert.equal(countCall(f, name), 0);
  assert.equal(f.trace.some(row => row.startsWith('call:net')), false);
  f.nodes.get('btn-release').onclick(); assert.equal(f.player.alive, true); assert.equal(f.state.releaseCalls, 1);
});
