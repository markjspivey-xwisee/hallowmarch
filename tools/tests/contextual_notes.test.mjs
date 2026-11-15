import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
const files = Object.fromEntries(['10c_lore.js', '10e_guide.js', '10f_guide2.js', '08m_loops.js', '08h_farming.js', '09_player.js', '10_ui.js']
  .map(file => [file, read(file)]));
const trees = Object.fromEntries(Object.entries(files).map(([file, source]) => [file, parse(source, { ecmaVersion: 'latest' })]));
function nodes(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (predicate(node)) result.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) nodes(child, predicate, result);
    else if (value && typeof value === 'object') nodes(value, predicate, result);
  }
  return result;
}
const text = (file, node) => files[file].slice(node.start, node.end);
function actual(file, names) {
  return names.map(name => {
    const node = trees[file].body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name
      || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
    assert(node, `Actual declaration ${name}`);
    return text(file, node);
  }).join('\n');
}
const storesNotes = nodes(trees['08m_loops.js'], n => n.type === 'CallExpression' && n.callee.object?.name === 'Object'
  && n.callee.property?.name === 'assign' && n.arguments[0]?.name === 'FIELD_NOTES');
assert.equal(storesNotes.length, 1);
const storesWatch = nodes(trees['08m_loops.js'], n => n.type === 'AssignmentExpression'
  && n.left.object?.name === 'GUIDE_WATCH' && n.left.property?.name === 'lstores');
assert.equal(storesWatch.length, 1);
const farmersWatch = nodes(trees['10f_guide2.js'], n => n.type === 'CallExpression' && n.callee.object?.name === 'Object'
  && n.callee.property?.name === 'assign' && n.arguments[0]?.name === 'GUIDE_WATCH')[0]
  .arguments[1].properties.find(p => p.key.name === 'farmers');
assert(farmersWatch, 'Actual requeue watch must exist');
const herbalPart = trees['08h_farming.js'].body.find(n => n.type === 'ExpressionStatement'
  && n.expression.callee?.name === 'registerSavePart' && n.expression.arguments[0]?.value === 'char'
  && n.expression.arguments[1]?.value === 'herbal');
assert(herbalPart);
const want = nodes(trees['10c_lore.js'], n => n.type === 'VariableDeclaration'
  && n.declarations.some(d => d.id.name === 'want'));
assert.equal(want.length, 1);
const hud = trees['10_ui.js'].body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'updateHUD');
const promptStart = hud.body.body.findIndex(n => n.type === 'VariableDeclaration'
  && n.declarations.some(d => d.id.name === 'it' && d.init?.callee?.name === 'currentInteraction'));
assert(promptStart >= 0);
const promptBlock = hud.body.body.slice(promptStart, promptStart + 3).map(n => text('10_ui.js', n)).join('\n');

const code = [
  actual('10_ui.js', ['capFirst']),
  actual('10c_lore.js', ['LORE', 'FIELD_NOTES', 'LK', 'loreLowHpRelevant', 'loreNote', 'loreFinishNote', 'loreUpdateNote',
    'showNextNote', 'loreSanitize', 'loreSaveData', 'loreOnStart', 'updateLore']),
  actual('10e_guide.js', ['guideQuiet', 'guideNotePrompt', 'guideNoteIndex', 'guideWatch']),
  actual('10f_guide2.js', ['G2_NOTES']),
  'Object.assign(FIELD_NOTES, G2_NOTES);',
  text('08m_loops.js', storesNotes[0]) + ';',
  text('08m_loops.js', storesWatch[0]) + ';',
  'Object.assign(GUIDE_WATCH, {' + text('10f_guide2.js', farmersWatch) + '});',
  actual('08h_farming.js', ['farmNum', 'farmKnows', 'farmNotices', 'farmActions', 'farmOffers']),
  text('08h_farming.js', herbalPart),
  actual('08m_loops.js', ['loopsOffers']),
  actual('09_player.js', ['currentInteraction']),
  `function refreshPrompt() { const P = GAME.player; ${promptBlock} }`,
  `function watchNotes() { const seen = GAME.prog.lore.seen; ${text('10c_lore.js', want[0])} guideWatch(want); }`,
  'globalThis.state = LORE; globalThis.notes = FIELD_NOTES;',
].join('\n');

function fixture({ touch = false } = {}) {
  let now = 100, saves = 0, serial = 0;
  const timers = new Map(), logs = [], calls = [], parts = new Map();
  class Element {
    constructor() { this.hidden = false; this.classes = new Set(); this.children = []; this.parent = null; this.listeners = {}; }
    get classList() { return { contains: x => this.classes.has(x), add: x => this.classes.add(x), remove: x => this.classes.delete(x) }; }
    get isConnected() { return !!(this.root || this.parent); }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0]; }
    setAttribute() {}
    addEventListener(type, fn) { this.listeners[type] = fn; }
    appendChild(child) { child.remove(); this.children.push(child); child.parent = this; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
    remove() { this.parent?.removeChild(this); }
  }
  const host = new Element(); host.root = true;
  const prompt = new Element(), promptText = new Element();
  const elements = new Map([['banners', host], ['prompt', prompt], ['prompt-t', promptText]]);
  const P = { id: 1, x: 0, z: 0, faction: 0, alive: true, hp: 137, maxHp: 137, combatUntil: 0, carrying: null };
  const Q = { id: 2, name: 'Quartermaster Rowan', x: 100, z: 0, alive: true };
  const farmer = { id: 3, name: 'Ailith', x: 100, z: 0, alive: true, ai: { seedSeller: true } };
  const GAME = { t: 1, ready: true, started: true, player: P, prog: { level: 1, xp: 20, rp: 0, bounty: { have: 1, need: 6 },
    lore: { done: ['herald'], seen: ['start'], pro: 1, pv: 3, track: 'cook' } } };
  const c = vm.createContext({ GAME, REALMS: [{ name: 'Ériu', townName: 'Glenrua', town: { x: 1000, z: 0 },
    musterSite: { x: 2000, z: 0 }, quartermaster: Q }],
    IS_TOUCH: touch, MOBILE_PREFS: { hand: 'right' }, UI: { modal: null },
    $: id => elements.get(id), document: { createElement: () => new Element() }, performance: { now: () => now },
    GUIDE: { scanT: 100, made: [], stats: { notesShown: 0, notesHeld: 0 } }, GUIDE_WATCH: {}, HUDL: { k: 1 }, G2: {},
    INV: { gold: 10, potions: 3 }, LOOT: [], WAR: { relics: [] }, BARROW: {}, LOOPS: { on: true, yards: [] },
    FARM: { built: true, job: null, ctx: null, farmers: [farmer.id], plots: [], herbal: { known: {}, tips: 0 } },
    FARM_HERB_IDS: ['herb_woundwort'], FARM_HERBS: { herb_woundwort: {} },
    PATH_VERSION: 3, PATH_BY_ID: { herald: {}, cook: {} }, PATH_STEPS: [],
    getEnt: id => id === farmer.id ? farmer : null,
    dist: (x, z, a, b) => Math.hypot(x - a, z - b), dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)), inDungeon: () => false, goodsHave: () => true,
    farmSeedLots: () => [], farmHerbNear: () => null,
    setT: (el, value) => { el._t = value; }, saveSoon: () => saves++, uiLog: (...args) => logs.push(args),
    reportError: error => { throw error; }, uiToast: () => { throw Error('Notes must use their existing note path'); },
    openFarmer: () => calls.push('farmer'), loopsOpenStores: () => calls.push('stores'),
    registerSavePart: (scope, key, part) => parts.set(scope + ':' + key, part),
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    guideScan: () => { throw Error('No extra world scan'); },
    loreWatch() {}, updateGuide() {}, renderPathHud() {}, placePathHud() {}, deathNote() {},
    buildPathHud() {}, loreConsumeBegin: () => false, openChronicle() {},
    pathComplete: () => { throw Error('Notes cannot complete or pay a path step'); },
  });
  for (const name of ['houseOffers', 'wearOffers', 'natureOffers', 'brandOffers', 'siegeOffers', 'waterOffers', 'hallOffers',
    'buildOffers', 'survivalOffers', 'animalOffers', 'depthOffers', 'towerOffers', 'late2Offers']) c[name] = () => {};
  vm.runInContext(code, c);
  Object.assign(c.state, { fresh: false, watchT: Infinity, hudT: Infinity, placeT: Infinity });
  return { c, P, Q, farmer, prompt, promptText, host, logs, calls, timers,
    get saves() { return saves; },
    queue: id => c.loreNote(id),
    refresh: () => c.refreshPrompt(), watch: () => c.watchNotes(),
    frame: () => { now = Math.max(now + 1, c.state.noteUntil + 1); c.updateLore(0); },
    setPrompt: label => { prompt.hidden = false; prompt.classList.add('on'); promptText._t = label; },
    facts: () => JSON.stringify({ xp: GAME.prog.xp, rp: GAME.prog.rp, bounty: GAME.prog.bounty,
      inventory: c.INV, done: GAME.prog.lore.done, track: GAME.prog.lore.track }),
    reload: () => {
      const lore = JSON.parse(JSON.stringify(c.loreSaveData()));
      const herbal = JSON.parse(JSON.stringify(parts.get('char:herbal').save()));
      GAME.prog = { ...GAME.prog, lore: null };
      c.loreOnStart({ fresh: false, lore }); parts.get('char:herbal').load(herbal);
      Object.assign(c.state, { watchT: Infinity, hudT: Infinity, placeT: Infinity });
      return { lore, herbal };
    },
  };
}

test('a queued stores note waits on the wolf route, then uses the actual selected quartermaster offer once', () => {
  const f = fixture(), facts = f.facts();
  f.Q.x = 10; f.watch();
  assert.deepEqual([...f.c.state.queue], ['lstores'], 'Original proximity can still queue a note');
  f.refresh(); f.frame();
  assert.equal(f.c.state.noteActive, null); assert.equal(f.saves, 0); assert.equal(f.logs.length, 0);
  f.Q.x = 2; f.refresh();
  assert.equal(f.promptText._t, `Speak with ${f.Q.name}: the realm's stores`);
  f.frame();
  assert.equal(f.c.state.noteActive?.id, 'lstores'); assert.equal(f.saves, 1); assert.equal(f.logs.length, 1);
  assert.deepEqual([...f.c.GAME.prog.lore.seen], ['start', 'lstores']);
  f.watch(); f.frame(); assert.equal(f.saves, 1); assert.equal(f.logs.length, 1);
  assert.equal(f.facts(), facts); assert.deepEqual(f.calls, []);
});

test('actual competing interaction wins over a nearby quartermaster and seed seller', () => {
  const f = fixture(); f.Q.x = 2; f.farmer.x = 2;
  f.c.REALMS[0].merchant = { name: 'Merchant', x: 0.1, z: 0 };
  f.queue('lstores'); f.queue('farmers'); f.refresh();
  assert.equal(f.promptText._t, 'Trade with Merchant');
  f.frame(); assert.equal(f.c.state.noteActive, null); assert.equal(f.saves, 0);
  assert.deepEqual([...f.c.state.queue], ['lstores', 'farmers']);
});

test('hidden or stale cached labels and removed/replaced/dead quartermasters cannot show stores help', () => {
  for (const change of [f => f.prompt.classList.remove('on'), f => { f.prompt.hidden = true; },
    f => { f.Q.alive = false; }, f => { f.c.REALMS[0].quartermaster = null; },
    f => { f.c.REALMS[0].quartermaster = { ...f.Q, name: 'Another quartermaster' }; }]) {
    const f = fixture(); f.Q.x = 2; f.refresh(); f.queue('lstores'); change(f); f.frame();
    assert.equal(f.c.state.noteActive, null); assert.equal(f.saves, 0); assert.equal(f.logs.length, 0);
  }
  const f = fixture(); f.farmer.x = 2; f.refresh(); f.queue('farmers'); f.farmer.x = 100; f.refresh();
  assert.match(f.promptText._t, /the farmer$/, 'Old text is retained by the actual HUD');
  assert.equal(f.prompt.classList.contains('on'), false);
  f.frame(); assert.equal(f.c.state.noteActive, null); assert.equal(f.saves, 0);
});

test('farmers means the selected seed seller, not a plot, herb, till spot or building stores', () => {
  const f = fixture(); f.queue('farmers');
  for (const ctx of [{ type: 'plot', s: 0, P: { plants: [{ g: 1, dead: false }], weeds: 0 } },
    { type: 'till', T: { why: null } }, { type: 'strip' }]) {
    f.c.FARM.ctx = ctx; f.refresh(); f.frame(); assert.equal(f.c.state.noteActive, null);
  }
  for (const label of ['Examine the plant', 'Buy building stores', 'Speak with Ailith',
    'Buy seed and tools from Ailith the farmer later']) {
    f.setPrompt(label); f.frame(); assert.equal(f.c.state.noteActive, null);
  }
  f.c.FARM.ctx = null; f.farmer.x = 2; f.refresh(); f.watch(); f.frame();
  assert.equal(f.c.state.noteActive?.id, 'farmers'); assert.equal(f.saves, 1);
  assert.deepEqual([...f.c.GAME.prog.lore.seen], ['start', 'farmers']);
});

test('both display predicates use only the existing cached prompt, without rescanning interactions', () => {
  const f = fixture(); f.Q.x = 2; f.refresh();
  f.c.currentInteraction = f.c.getEnt = f.c.dist = f.c.dist2 = () => { throw Error('No interaction or world query'); };
  assert.equal(f.c.notes.lstores.ok(), true);
  f.setPrompt('Buy seed and tools from Ailith the farmer'); assert.equal(f.c.notes.farmers.ok(), true);
  f.prompt.classList.remove('on'); assert.equal(f.c.notes.farmers.ok(), false);
});

test('a persisted old farmer tip bit cannot permanently lose an uncollected held note on reload', () => {
  const f = fixture(), facts = f.facts();
  f.c.FARM.plots = [{ own: 't', x: 0, z: 0 }]; f.c.farmNotices(0);
  assert.equal(f.c.FARM.herbal.tips & 1, 1);
  assert.deepEqual([...f.c.state.queue], ['farmers']);
  f.refresh(); f.frame(); assert.equal(f.c.GAME.prog.lore.seen.includes('farmers'), false);
  const saved = f.reload(); assert.equal(saved.herbal.t & 1, 1);
  assert.deepEqual([...f.c.state.queue], [], 'The original reload intentionally discards the transient queue');
  f.farmer.x = 2; f.refresh(); f.watch(); f.watch();
  assert.deepEqual([...f.c.state.queue], ['farmers'], 'Actual guideWatch requeues the unseen note despite the unchanged old bit');
  f.frame(); assert.equal(f.c.state.noteActive?.id, 'farmers');
  assert.equal(f.c.FARM.herbal.tips, saved.herbal.t); assert.equal(f.facts(), facts);
});

test('already collected notes and saved herbal knowledge stay collected across reload without extra saves', () => {
  const f = fixture(); f.c.GAME.prog.lore.seen.push('lstores', 'farmers');
  f.c.FARM.herbal = { known: { herb_woundwort: { at: 123 } }, tips: 5 };
  const facts = f.facts(), saved = f.reload(), saves = f.saves;
  assert.deepEqual(JSON.parse(JSON.stringify(f.c.loreSaveData())), saved.lore);
  assert.equal(f.c.FARM.herbal.tips, 5); assert.equal(f.c.farmKnows('herb_woundwort'), true);
  f.Q.x = 2; f.refresh(); f.watch(); f.frame();
  f.Q.x = 100; f.farmer.x = 2; f.refresh(); f.watch(); f.frame();
  assert.deepEqual([...f.c.state.queue], []); assert.equal(f.c.state.noteActive, null);
  assert.equal(f.saves, saves); assert.equal(f.logs.length, 0); assert.equal(f.facts(), facts);
});

test('owner replacement drops the old pending note and touch keeps its ordinary quiet collection', () => {
  const f = fixture(); f.queue('farmers');
  f.c.GAME.prog = { ...f.c.GAME.prog, lore: { done: [], seen: ['start'], pro: 1, pv: 3 } };
  f.c.loreOnStart({ fresh: false, lore: f.c.GAME.prog.lore });
  assert.deepEqual([...f.c.state.queue], []); assert.equal(f.c.state.noteActive, null); assert.equal(f.saves, 0);
  const t = fixture({ touch: true }); t.farmer.x = 2; t.refresh(); t.watch(); t.frame();
  assert.equal(t.c.state.noteActive, null); assert.equal(t.host.children.length, 0); assert.equal(t.logs.length, 0);
  assert.deepEqual([...t.c.GAME.prog.lore.seen], ['start', 'farmers']); assert.equal(t.saves, 1);
});

test('the real frame computes the selected HUD prompt before checking note relevance', () => {
  const source = read('13_main.js');
  assert(source.indexOf('updateHUD(dt);') < source.indexOf('updateLore(dt);'));
});
