import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
const lore = read('10c_lore.js'), guide = read('10e_guide.js');
function actual(source, names) {
  return parse(source, { ecmaVersion: 'latest' }).body.filter(node =>
    node.type === 'FunctionDeclaration' && names.includes(node.id.name)
    || node.type === 'VariableDeclaration' && node.declarations.some(d => names.includes(d.id.name)))
    .map(node => source.slice(node.start, node.end)).join('\n');
}
const extraNotes = parse(guide, { ecmaVersion: 'latest' }).body.find(node =>
  node.type === 'ExpressionStatement' && node.expression.callee?.object?.name === 'Object'
  && node.expression.callee?.property?.name === 'assign' && node.expression.arguments[0]?.name === 'FIELD_NOTES');
const code = actual(lore, ['LORE', 'FIELD_NOTES', 'LK', 'loreNote', 'loreFinishNote', 'loreUpdateNote', 'showNextNote',
  'loreSanitize', 'loreSaveData', 'loreOnStart', 'updateLore']) + '\n'
  + guide.slice(extraNotes.start, extraNotes.end) + '\n' + actual(guide, ['guideQuiet', 'guideNoteIndex'])
  + '\nglobalThis.state=LORE; globalThis.notes=FIELD_NOTES;';

function fixture({ touch = false, fresh = true } = {}) {
  let now = 100, serial = 0, saves = 0;
  const timers = new Map(), logs = [], opened = [];
  class Element {
    constructor() { this.parent = null; this.children = []; this.listeners = new Map(); this.className = ''; this.classes = new Set(); }
    get isConnected() { return !!(this.parent || this.root); }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0]; }
    get classList() { return { contains: name => this.classes.has(name) }; }
    setAttribute() {}
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    appendChild(child) { child.remove(); this.children.push(child); child.parent = this; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
    remove() { this.parent?.removeChild(this); }
    click() { this.listeners.get('click')?.(); }
  }
  const host = new Element(); host.root = true;
  const GAME = { t: 1, player: { faction: 0, combatUntil: 0, alive: true },
    prog: { level: 1, xp: 0, rp: 0, bounty: { type: 'boar', n: 6, done: 0 },
      lore: { done: ['herald'], seen: [], pro: 1, pv: 3, track: 'cook' } } };
  const c = vm.createContext({ GAME, IS_TOUCH: touch, MOBILE_PREFS: { hand: 'right' }, UI: { modal: null },
    performance: { now: () => now }, $: () => host, document: { createElement: () => new Element() },
    REALMS: [{ name: 'Logres', townName: 'Brackenford', templeName: 'Temple' }],
    GUIDE: { stats: { notesShown: 0, notesHeld: 0 }, made: [] }, G2: {}, HUDL: { k: 1 },
    INV: { potions: 3, gold: 20 }, LOOT: [], PATH_VERSION: 3, PATH_BY_ID: { herald: {}, cook: {} }, PATH_STEPS: [],
    saveSoon: () => saves++, uiLog: (...args) => logs.push(args), openChronicle: page => opened.push(page),
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    loreWatch() {}, updateGuide() {}, renderPathHud() {}, placePathHud() {}, deathNote() {},
    buildPathHud() {}, loreConsumeBegin: () => false, pathComplete: () => { throw Error('Presentation must not complete a deed'); },
  });
  vm.runInContext(code, c);
  Object.assign(c.state, { fresh, watchT: Infinity, hudT: Infinity, placeT: Infinity });
  return { c, host, timers, logs, opened, get saves() { return saves; },
    note: id => { c.loreNote(id); c.showNextNote(); },
    frame: () => { now += 1; c.updateLore(0); },
    fight: () => { GAME.player.combatUntil = GAME.t + 10; },
    peace: () => { GAME.t = GAME.player.combatUntil + 1; },
    advance: ms => { now += ms; },
    visible: () => host.children.filter(node => node.className.includes('lore-note')),
    banner: kind => { const element = new Element(); element.className = kind; host.appendChild(element); return element; },
    facts: () => JSON.stringify({ saved: c.loreSaveData(), xp: GAME.prog.xp, rp: GAME.prog.rp,
      bounty: GAME.prog.bounty, ev: c.state.ev, inventory: c.INV }),
  };
}

test('queued First steps waits during combat, while an actual fight:true note may pass', () => {
  const f = fixture(); f.fight();
  assert.equal(f.c.loreNote('start'), true); f.c.showNextNote();
  assert.equal(f.visible().length, 0); assert.equal(f.saves, 0);
  assert.deepEqual([...f.c.GAME.prog.lore.seen], []);
  assert.equal(f.c.loreNote('walls'), true); f.c.showNextNote();
  assert.equal(f.visible().length, 1); assert.equal(f.c.state.noteActive.id, 'walls');
  assert.deepEqual([...f.c.state.queue], ['start']);
  f.frame(); assert.equal(f.c.state.noteActive.id, 'walls');
});

test('active noncombat help is deferred once and returns without duplicate saved facts or notices', () => {
  const f = fixture(); f.note('start');
  const original = f.c.state.noteActive, facts = f.facts(), logs = f.logs.length, saves = f.saves;
  const bounty = f.banner('banner bounty'), complete = f.banner('banner lore-step');
  assert.equal(f.timers.size, 1); f.fight(); f.frame();
  assert.equal(original.element.isConnected, false); assert.equal(f.timers.size, 0);
  assert.equal(f.visible().length, 0); assert.equal(f.c.state.noteActive, null);
  assert.deepEqual([...f.c.state.queue], ['start']); assert.deepEqual([...f.c.state.noteReplay], ['start']);
  assert.equal(f.c.guideQuiet(), true);
  for (let i = 0; i < 3; i++) f.frame();
  assert.deepEqual([...f.c.state.queue], ['start']);
  assert.equal(f.host.children.includes(bounty), true); assert.equal(f.host.children.includes(complete), true);
  assert.equal(f.facts(), facts); assert.equal(f.logs.length, logs); assert.equal(f.saves, saves);
  f.peace(); f.frame();
  assert.equal(f.visible().length, 1); assert.equal(f.c.state.noteActive.id, 'start');
  assert.equal(f.c.state.noteReplay.size, 0); assert.equal(f.c.state.queue.length, 0);
  assert.equal(f.facts(), facts); assert.equal(f.logs.length, logs); assert.equal(f.saves, saves);
});

test('a second fight defers the replay again, with only one active note and one queued ID', () => {
  const f = fixture(); f.note('start'); const facts = f.facts();
  for (let i = 0; i < 3; i++) {
    f.fight(); f.frame(); assert.equal(f.visible().length, 0);
    assert.deepEqual([...f.c.state.queue], ['start']); assert.equal(f.c.state.noteReplay.size, 1);
    f.peace(); f.frame(); assert.equal(f.visible().length, 1);
    assert.equal(f.timers.size, 1); assert.equal(f.facts(), facts);
  }
  assert.equal(f.logs.length, 1); assert.equal(f.saves, 1);
});

test('an ordinary collected note also returns after interruption, independently of fresh onboarding', () => {
  const f = fixture({ fresh: false }); f.note('news'); const facts = f.facts();
  f.fight(); f.frame(); assert.equal(f.visible().length, 0);
  f.peace(); f.frame(); assert.equal(f.c.state.noteActive.id, 'news');
  assert.equal(f.facts(), facts); assert.equal(f.logs.length, 1); assert.equal(f.saves, 1);
});

for (const compact of [false, true]) test(`explicit dismissal is final, including compact-note Chronicle navigation: ${compact}`, () => {
  const f = fixture(); f.note('start');
  if (compact) f.host.classes.add('hl-compact');
  const active = f.c.state.noteActive; active.element.click();
  assert.equal(f.visible().length, 0); assert.equal(f.timers.size, 0);
  f.fight(); f.frame(); f.peace(); f.advance(12000); f.frame();
  assert.equal(f.visible().length, 0); assert.equal(f.c.state.noteReplay.size, 0);
  assert.deepEqual(f.opened, compact ? ['notes'] : []);
  if (compact) assert.equal(f.c.G2.noteFocus, 'start');
});

test('normal expiry is final and a stale cleared timer cannot remove a replay', () => {
  const f = fixture(); f.note('start');
  const oldTimer = [...f.timers.values()][0].fn;
  f.fight(); f.frame(); f.peace(); f.frame();
  const replay = f.c.state.noteActive;
  oldTimer(); assert.equal(f.c.state.noteActive, replay); assert.equal(replay.element.isConnected, true);
  [...f.timers.values()][0].fn(); assert.equal(f.c.state.noteActive, null);
  f.fight(); f.frame(); f.peace(); f.advance(12000); f.frame();
  assert.equal(f.visible().length, 0); assert.equal(f.c.state.noteReplay.size, 0);
});

test('touch still collects quietly with no active element or replay work', () => {
  const f = fixture({ touch: true }); f.note('start');
  assert.deepEqual([...f.c.GAME.prog.lore.seen], ['start']); assert.equal(f.saves, 1);
  assert.equal(f.logs.length, 0); assert.equal(f.visible().length, 0); assert.equal(f.timers.size, 0);
  f.fight(); f.frame(); f.peace(); f.frame();
  assert.equal(f.c.state.noteReplay.size, 0); assert.equal(f.c.state.queue.length, 0);
});

test('detached banners are not revived, and stale character-owned callbacks cannot dismiss a new note', () => {
  const f = fixture(); f.note('start'); const old = f.c.state.noteActive, stale = [...f.timers.values()][0].fn;
  old.element.remove(); f.fight(); f.frame();
  assert.equal(f.c.state.noteReplay.size, 0); assert.equal(f.c.state.noteActive, null);
  f.peace(); f.c.GAME.prog = { level: 1, xp: 0, rp: 0, lore: { done: [], seen: [], pro: 1, pv: 3 } };
  f.note('start'); const current = f.c.state.noteActive; stale();
  f.host.classes.add('hl-compact'); old.element.click();
  assert.equal(f.c.state.noteActive, current); assert.equal(current.element.isConnected, true);
  assert.equal(f.c.state.noteReplay.size, 0); assert.deepEqual(f.opened, []);
});

test('an attached old-owner click cannot navigate before the next frame cleans up its note', () => {
  const f = fixture(); f.note('start'); const old = f.c.state.noteActive;
  f.host.classes.add('hl-brief');
  f.c.GAME.prog = { level: 1, lore: { done: [], seen: ['start'], pro: 1, pv: 3 } };
  old.element.click(); assert.deepEqual(f.opened, []);
  f.frame(); assert.equal(f.visible().length, 0); assert.equal(f.c.state.noteActive, null);
});

test('normal character start clears deferred presentation but preserves its saved Chronicle entry', () => {
  const f = fixture(); f.note('start'); f.fight(); f.frame();
  const saved = JSON.parse(f.facts()).saved;
  assert.equal(f.c.state.noteReplay.size, 1);
  f.c.GAME.prog = { level: 1, xp: 0, rp: 0, bounty: null };
  f.c.loreOnStart({ fresh: false, lore: saved });
  assert.equal(f.c.state.noteActive, null); assert.equal(f.c.state.noteReplay.size, 0);
  assert.equal(f.c.state.queue.length, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual([...f.c.GAME.prog.lore.seen], ['start']);
  assert.deepEqual([...f.c.GAME.prog.lore.done], ['herald']); assert.equal(f.c.GAME.prog.lore.track, 'cook');
});

test('a deferred replay cannot move to a replacement progress owner before normal start cleanup', () => {
  const f = fixture(); f.note('start'); f.fight(); f.frame();
  f.c.GAME.prog = { level: 1, lore: { done: [], seen: ['start'], pro: 1, pv: 3 } };
  f.peace(); f.advance(12000); f.frame();
  assert.equal(f.c.state.noteReplay.size, 0); assert.equal(f.c.state.queue.length, 0);
  assert.equal(f.visible().length, 0); assert.equal(f.saves, 1); assert.equal(f.logs.length, 1);
});

test('a modal holds deferred help until the player returns to the world', () => {
  const f = fixture(); f.note('start'); f.fight(); f.frame(); f.peace();
  f.c.UI.modal = 'menu'; f.frame();
  assert.equal(f.visible().length, 0); assert.deepEqual([...f.c.state.queue], ['start']);
  f.c.UI.modal = null; f.frame(); assert.equal(f.visible().length, 1);
});
