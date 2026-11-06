import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL('src/' + file, root), 'utf8');
const loot = read('09c_loot.js'), kitSource = read('10b_kit.js');
function extract(source, name) {
  const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start);
  assert(start >= 0 && end > start, 'actual source function ' + name); return source.slice(start, end + 2);
}

function fixture({ gold = 100, potions = 2, price = 10, contract = false, live = true } = {}) {
  const microtasks = [], trace = [], saved = [], errors = [], rewards = [], records = [], handlers = new Map();
  let activeLive = live;
  const player = { id: 1, faction: 0, alive: true, x: 0, z: 0, hp: 100, maxHp: 100, combatUntil: 0, carrying: null };
  const prog = { level: 5, bounty: null, lore: { done: [], seen: ['loot'], track: 'draught' } };
  const control = { id: '', dataset: { buyp: '1' }, disabled: false, getClientRects: () => [{}] };
  const kit = { addEventListener(type, callback) { handlers.set(type, callback); }, contains: value => value === control };
  const banners = { childNodes: [], appendChild(node) { this.childNodes.push(node); }, removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); } };
  class FixtureEvent {
    constructor({ trusted = true, phase = 3, type = 'click' } = {}) {
      this.type = type; this.isTrusted = trusted; this.eventPhase = phase; this.target = { closest: selector => ['button', '[data-buyp]'].includes(selector) ? control : null };
    }
  }
  const scope = {};
  const ctx = { Event: FixtureEvent, GAME: { ready: true, started: true, player, prog, t: 1 }, REALMS: [{ herald: null }],
    SAVE: { ref: { id: 'native-owner' }, lsKey: 'owner-key', native: true, wiping: false },
    NETWS: { host: 'test-host', acct: { id: 'account-one' }, reload: false }, NATIVE_PLAYER: { profile: { id: 'profile-one' } },
    UI: { modal: 'kit', kitMode: 'shop' }, INV: { gold, potions }, POTION: { max: 10 }, IS_TOUCH: true,
    LORE: { ev: {}, bounty: null, potions, doors: new Map(), elites: new Set(), loot: new Set(), queue: [], carried: null, mwNames: new Set() },
    WAR: { relics: [], keeps: [], temples: [], warbands: [] }, CAMPS: [], LOOT: [], GUIDE: { made: [] }, GIFT: {}, DRAGON: {},
    CAMPAIGN: { history: [], claims: [] }, CWUI: {}, WEATHER: {}, R_RING: -999, RECIPES: [], PATH_STEPS: [], HUDL: {}, LEVEL_CAP: 50,
    document: { hidden: false, hasFocus: () => true, createElement: () => ({ className: '', innerHTML: '', remove() {} }) },
    $: id => id === 'kit' ? kit : id === 'banners' ? banners : null,
    netHumanLive: () => activeLive && !ctx.document.hidden && ctx.document.hasFocus(),
    queueMicrotask: callback => microtasks.push(callback), setTimeout: () => 1,
    potionPrice: () => price, uiError: text => errors.push(text), sfx: name => trace.push({ name }),
    saveSoon: () => saved.push({ gold: ctx.INV.gold, potions: ctx.INV.potions }),
    renderKit: () => trace.push({ render: true }), bgClose: () => {},
    xpToNext: () => 100, addXP: value => rewards.push(value), activityRecord: (...args) => records.push(args),
    fmtInt: String, iconSvg: () => '', uiLog: () => {}, renderPathHud: () => {},
    towerRoomOf: () => null, kitItems: () => [], inDungeon: () => false, cwCanCommand: () => false, guideWatch: () => {},
    dist2: (a, b, c, d) => (a - c) ** 2 + (b - d) ** 2, dist: () => 0 };
  vm.createContext(ctx);
  if (contract) {
    ctx.loreObservationScope = (event, kind) => { trace.push({ phase: 'mint', event, kind, gold: ctx.INV.gold, potions: ctx.INV.potions }); return scope; };
    ctx.loreObserve = observation => trace.push({ phase: 'observe', observation, gold: ctx.INV.gold, potions: ctx.INV.potions });
  } else {
    // No copied helper implementation: scope, ownership, live checks and the
    // normal deferred reward all execute the production 10c functions.
    const lore = read('10c_lore.js');
    const helpers = 'const LORE_OBSERVATIONS = new WeakSet();\n'
      + ['loreObservationScope', 'loreObservationCurrent', 'loreObservationEvidence', 'loreObserve', 'pathDone', 'pathPay', 'pathComplete', 'loreLowHpRelevant', 'loreWatch']
        .map(name => extract(lore, name)).join('\n');
    vm.runInContext(helpers, ctx);
    const step = lore.match(/\{ id: 'draught',[\s\S]*?reward:\s*\{[^}]+\}\s*\}/);
    assert(step, 'actual draught path reward'); ctx.PATH_STEPS.push(vm.runInContext('(' + step[0] + ')', ctx));
  }
  vm.runInContext(extract(loot, 'buyPotions') + '\n' + extract(kitSource, 'bindKit') + '\nbindKit();', ctx);
  return { ctx, control, player, prog, scope, trace, saved, errors, rewards, records,
    event: options => new FixtureEvent(options),
    click(event = new FixtureEvent(), n = '1') { control.dataset.buyp = n; handlers.get('click')(event); return event; },
    flush() { while (microtasks.length) microtasks.shift()(); }, setLive: value => { activeLive = value; },
    watch: () => ctx.loreWatch(), pending: () => microtasks.length };
}

test('transaction forwards the exact kit event, mints before debit and observes only the committed amounts', () => {
  const f = fixture({ contract: true }), event = f.event(); f.click(event, '5');
  const phases = f.trace.filter(row => row.phase); assert.equal(phases[0].event, event); assert.equal(phases[0].kind, 'draught');
  assert.deepEqual({ gold: phases[0].gold, potions: phases[0].potions }, { gold: 100, potions: 2 });
  assert.equal(phases[1].observation, f.scope); assert.deepEqual({ gold: phases[1].gold, potions: phases[1].potions }, { gold: 50, potions: 7 });
  assert.deepEqual(f.saved, [{ gold: 50, potions: 7 }]); assert.equal(f.trace.filter(row => row.render).length, 1);
});

for (const [label, options, n, expected] of [
  ['one', {}, 1, { gold: 90, potions: 3 }], ['five', {}, 5, { gold: 50, potions: 7 }],
  ['carry limit', { potions: 9 }, 5, { gold: 90, potions: 10 }], ['funds limit', { gold: 25 }, 5, { gold: 5, potions: 4 }],
]) test('transaction preserves existing exact positive purchase math: ' + label, () => {
  const f = fixture({ contract: true, ...options }); f.ctx.buyPotions(n, f.event());
  assert.deepEqual(f.ctx.INV, expected); assert.equal(f.trace.filter(row => row.phase === 'observe').length, 1); assert.equal(f.saved.length, 1);
});

for (const [label, options, n] of [['unaffordable', { gold: 0 }, 1], ['full', { potions: 10 }, 1], ['zero', {}, 0], ['negative', {}, -1]]) {
  test('transaction refusal never mints or observes a deed: ' + label, () => {
    const f = fixture({ contract: true, ...options }), before = { ...f.ctx.INV }; f.ctx.buyPotions(n, f.event());
    assert.deepEqual(f.ctx.INV, before); assert.equal(f.trace.filter(row => row.phase).length, 0); assert.equal(f.saved.length, 0); assert.equal(f.errors.length, 1);
  });
}

test('a committed purchase survives fast close before the watcher and pays its normal reward once', () => {
  const f = fixture(); f.click(); assert.equal(f.pending(), 1); assert.deepEqual(f.rewards, []);
  f.flush(); assert.equal(f.ctx.LORE.ev.draught, true); f.watch(); assert.deepEqual(f.prog.lore.done, []); assert.deepEqual(f.rewards, []);
  f.ctx.UI.modal = null; f.watch(); f.watch();
  assert.deepEqual(f.prog.lore.done, ['draught']); assert.deepEqual(f.rewards, [25]); assert.equal(f.ctx.INV.gold, 90); assert.equal(f.ctx.INV.potions, 3);
  assert.equal(f.records.filter(row => row[0] === 'path.completed').length, 1);
});

for (const mode of ['synthetic', 'stale event', 'idle', 'hidden', 'unfocused', 'wrong mode', 'foreign button', 'disabled button']) {
  test('actual purchase observer does not award without current eligible input: ' + mode, () => {
    const f = fixture(), event = f.event({ trusted: mode !== 'synthetic', phase: mode === 'stale event' ? 0 : 3 });
    if (mode === 'idle') f.setLive(false);
    if (mode === 'hidden') f.ctx.document.hidden = true;
    if (mode === 'unfocused') f.ctx.document.hasFocus = () => false;
    if (mode === 'wrong mode') f.ctx.UI.kitMode = 'kit';
    if (mode === 'foreign button') f.ctx.$ = () => ({ contains: () => false });
    if (mode === 'disabled button') f.control.disabled = true;
    f.ctx.buyPotions(1, event); f.flush(); assert(!f.ctx.LORE.ev.draught);
    f.ctx.UI.modal = null; f.watch(); assert.deepEqual(f.rewards, []); assert.deepEqual(f.prog.lore.done, []);
  });
}

for (const owner of ['player', 'progress', 'realm', 'save ref', 'save key', 'save mode', 'host', 'account', 'profile', 'wipe', 'reload']) {
  test('committed purchase cannot observe after its owner changes: ' + owner, () => {
    const f = fixture(); f.click();
    if (owner === 'player') f.ctx.GAME.player = { ...f.player };
    if (owner === 'progress') f.ctx.GAME.prog = { ...f.prog };
    if (owner === 'realm') f.player.faction = 1;
    if (owner === 'save ref') f.ctx.SAVE.ref = { id: 'different' };
    if (owner === 'save key') f.ctx.SAVE.lsKey = 'different';
    if (owner === 'save mode') f.ctx.SAVE.native = false;
    if (owner === 'host') f.ctx.NETWS.host = 'different';
    if (owner === 'account') f.ctx.NETWS.acct = { id: 'different' };
    if (owner === 'profile') f.ctx.NATIVE_PLAYER.profile = { id: 'different' };
    if (owner === 'wipe') f.ctx.SAVE.wiping = true;
    if (owner === 'reload') f.ctx.NETWS.reload = true;
    f.flush(); assert(!f.ctx.LORE.ev.draught); assert.deepEqual(f.rewards, []);
  });
}

test('opening shop, generic potion gains, consumption and forged success receipts award no purchase deed', () => {
  const f = fixture(); f.watch(); f.ctx.INV.potions++; f.watch(); f.ctx.INV.potions--; f.watch();
  assert.equal(f.ctx.loreObserve({ event: f.event(), kind: 'draught' }), false);
  f.ctx.UI.modal = null; f.watch(); assert(!f.ctx.LORE.ev.draught); assert.deepEqual(f.prog.lore.done, []); assert.deepEqual(f.rewards, []);
});

test('failed and zero purchases never progress through the real observer either', () => {
  for (const options of [{ gold: 0 }, { potions: 10 }, {}]) {
    const f = fixture(options); f.ctx.buyPotions(options.gold === undefined && options.potions === undefined ? 0 : 1, f.event());
    f.flush(); f.ctx.UI.modal = null; f.watch(); assert(!f.ctx.LORE.ev.draught); assert.deepEqual(f.rewards, []);
  }
});

test('completed draught objective cannot pay again on later legitimate purchases', () => {
  const f = fixture(); f.click(); f.flush(); f.ctx.UI.modal = null; f.watch();
  f.ctx.UI.modal = 'kit'; f.click(); f.flush(); f.ctx.UI.modal = null; f.watch();
  assert.deepEqual(f.rewards, [25]); assert.deepEqual(f.prog.lore.done, ['draught']); assert.equal(f.ctx.INV.potions, 4); assert.equal(f.ctx.INV.gold, 80);
});
