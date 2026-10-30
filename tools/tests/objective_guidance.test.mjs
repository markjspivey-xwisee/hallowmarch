import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parse } from 'acorn';

test('closing the prologue forwards the original key through the existing trusted-input guards',()=>{
  const source=readFileSync(new URL('../../src/10c_lore.js',import.meta.url),'utf8');
  const start=source.indexOf("window.addEventListener('keydown', (e) => {");
  const end=source.indexOf('\n}, true);',start)+'\n}, true);'.length;
  for(const trusted of [false,true]) {
    let listener;const tasks=[];
    const context=vm.createContext({UI:{modal:'prologue'},LORE:{pro:{}},NET_HUMAN_PLAY:{focused:false,activity:0,pendingAt:null},
      document:{hidden:false,hasFocus:()=>true,activeElement:null},performance:{now:()=>100},
      window:{addEventListener:(type,fn)=>{listener=fn;}},queueMicrotask:fn=>tasks.push(fn),netHumanSuspend(){},
      closePrologue(){context.UI.modal=null;},prologueGo(){},netHumanSync(){assert.equal(context.UI.modal,null);}});
    vm.runInContext(declarations('14m_liveplay.js',['netHumanInput']),context);
    vm.runInContext(source.slice(start,end),context);
    const event={type:'keydown',code:'Escape',isTrusted:trusted,preventDefault(){},stopPropagation(){}};
    listener(event);assert.equal(context.UI.modal,null);
    assert.equal(context.NET_HUMAN_PLAY.activity,trusted?1:0);
    assert.equal(tasks.length,trusted?1:0);tasks.forEach(fn=>fn());
  }
});

function declarations(file, names) {
  const source = readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
  const nodes = parse(source, { ecmaVersion: 'latest' }).body;
  return names.map(name => {
    const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
    assert.ok(node, name);
    return source.slice(node.start, node.end);
  }).join('\n');
}

// A CPU-only view/dispatch fixture for the actual prologue renderer and actions.
// It models only the DOM calls those functions use; it does not start the game.
function prologueActions({ touch = false, replay = false } = {}) {
  const nodes = new Map(), keys = [], effects = { saves: 0, notes: [], sounds: [], input: 0 };
  let c;
  const make = () => ({ hidden: true, listeners: {}, buttons: [], markup: '',
    set innerHTML(value) {
      this.markup = value;
      this.buttons = [...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => {
        const action = /data-pro="([^"]+)"/.exec(match[1])?.[1];
        const button = { dataset: { pro: action }, textContent: match[2].replace(/<[^>]*>/g, ''),
          primary: /class="[^"]*\bprimary\b/.test(match[1]),
          focus() { c.document.activeElement = button; },
          closest(selector) { return selector === 'button[data-pro]' || selector === '#lore-pro button' ? button : null; } };
        return button;
      });
    },
    get innerHTML() { return this.markup; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelector(selector) {
      if (selector === '[data-pro="next"]') return this.buttons.find(button => button.dataset.pro === 'next');
      assert.equal(selector, '.text');
      return { scrollHeight: 100, scrollTop: 0, clientHeight: 100,
        classList: { toggle() {} }, addEventListener() {} };
    } });
  const progress = { level: 1, xp: 0, rp: 0, lore: { done: [], seen: [], pro: 0 } };
  c = vm.createContext({ UI: { modal: null }, LORE: { pro: null }, GAME: { player: { faction: 0, cls: 'warrior' }, prog: progress },
    INPUT: { keys: new Set(), joy: null }, IS_TOUCH: touch,
    $: id => nodes.get(id), hideJoystick() {}, closeMenu() { c.UI.modal = null; },
    prologuePages: () => Array.from({ length: 5 }, (_, i) => ({ k: 'Page ' + (i + 1), t: 'Title ' + (i + 1), art: 'road', p: ['Text'] })),
    loreArt: () => '<svg></svg>', saveSoon: () => { effects.saves++; }, loreNote: id => effects.notes.push(id),
    sfx: id => effects.sounds.push(id), requestAnimationFrame: fn => { fn(); return 1; },
    netHumanInput: () => { effects.input++; },
    document: { activeElement: null, createElement: make, body: { appendChild(node) { nodes.set(node.id, node); } } },
    window: { addEventListener(type, listener) { assert.equal(type, 'keydown'); keys.push(listener); } } });
  vm.runInContext(declarations('10c_lore.js', ['openPrologue', 'renderPrologue', 'prologueGo', 'closePrologue']), c);
  const source = readFileSync(new URL('../../src/10c_lore.js', import.meta.url), 'utf8');
  const start = source.indexOf("window.addEventListener('keydown'", source.indexOf("// the prologue's keys come first"));
  const end = source.indexOf('\n}, true);', start) + '\n}, true);'.length;
  vm.runInContext(source.slice(start, end), c);
  assert.equal(c.openPrologue(replay), true);
  const overlay = () => nodes.get('lore-pro');
  const click = action => {
    const button = overlay().buttons.find(button => button.dataset.pro === action);
    assert.ok(button, 'Visible action ' + action);
    overlay().listeners.click({ target: button });
  };
  return { c, effects, progress, overlay, click,
    key(code, properties = {}) {
      const observed = { prevented: 0, stopped: 0, leaked: 0 };
      keys[0]({ code, ...properties, preventDefault() { observed.prevented++; }, stopPropagation() { observed.stopped++; } });
      if (!observed.stopped) observed.leaked++;
      return observed;
    },
    view(index) { c.LORE.pro.i = index; c.renderPrologue(); return overlay().buttons; } };
}

test('prologue module differs from release 1145461 only by the exact held-page-key guard and essential CSS', () => {
  let source = readFileSync(new URL('../../src/10c_lore.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const essentialCss = [
    ['#lore-pro .head { display: flex; align-items: center; gap: 12px; }', '#lore-pro .head { display: flex; align-items: center; gap: 12px; animation: lore-in 0.45s ease both; }'],
    ['#lore-pro h2 { margin: 2px 0 6px; font: 400 clamp(30px, 3.3vw, 42px)/1.04 var(--display); color: #fbf1dc; }', '#lore-pro h2 { margin: 2px 0 6px; font: 400 clamp(30px, 3.3vw, 42px)/1.04 var(--display); color: #fbf1dc; animation: lore-in 0.5s ease 0.05s both; }'],
    ['#lore-pro .text { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; font-size: 16px; line-height: 1.58; color: rgba(239, 230, 211, 0.84); }', '#lore-pro .text { flex: 1; min-height: 0; overflow-y: auto; padding-right: 6px; font-size: 16px; line-height: 1.58; color: rgba(239, 230, 211, 0.84); animation: lore-in 0.55s ease 0.1s both; }'],
  ];
  for (const [current, original] of essentialCss) {
    assert.equal(source.split(current).length, 2, 'Unique essential-only CSS inverse');
    source = source.replace(current, original);
  }
  assert.equal(createHash('sha256').update(source).digest('hex'), 'c4422bc0c9bfeabeead157c035c6d8dac92db8a80bc81e565cdef3fb3dc0b0d6');
  const guard = "  // Holding a page key must not run through the book or dismiss its last page.\n"
    + "  if (e.repeat === true && (k === 'ArrowRight' || k === 'PageDown' || k === 'ArrowLeft' || k === 'PageUp')) {\n"
    + "    e.preventDefault();\n    e.stopPropagation();\n    return;\n  }\n";
  assert.equal(source.split(guard).length, 2, 'Exactly one approved insertion');
  const original = source.replace(guard, '');
  assert.equal(createHash('sha256').update(original).digest('hex'), '2f42286a05f13727a3520019e35b891448f88951c30b64188ec15d3a7596cb23');
  assert.notEqual(createHash('sha256').update(source).digest('hex'), '2f42286a05f13727a3520019e35b891448f88951c30b64188ec15d3a7596cb23');
});

test('actual repeated arrow/page keys cannot turn, rerender or leave any prologue page', () => {
  for (const replay of [false, true]) for (const touch of [false, true]) {
    for (const index of [0, 2, 4]) for (const code of ['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp']) {
      const f = prologueActions({ replay, touch }); f.view(index);
      const buttons = f.overlay().buttons, markup = f.overlay().innerHTML;
      const observed = f.key(code, { repeat: true });
      assert.deepEqual(observed, { prevented: 1, stopped: 1, leaked: 0 }, code);
      assert.equal(f.c.LORE.pro.i, index); assert.equal(f.c.UI.modal, 'prologue');
      assert.equal(f.overlay().buttons, buttons, 'No renderer replacement'); assert.equal(f.overlay().innerHTML, markup);
      assert.equal(f.effects.input, 1, 'The original input hook still sees this event once');
      assert.equal(f.effects.saves, 0); assert.deepEqual(f.effects.notes, []); assert.deepEqual(f.effects.sounds, []);
    }
  }
});

test('nonrepeated and legacy page keys still move once, respect boundaries and explicitly finish', () => {
  for (const properties of [{}, { repeat: false }]) for (const code of ['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp']) {
    const f = prologueActions(); f.view(2);
    assert.deepEqual(f.key(code, properties), { prevented: 1, stopped: 1, leaked: 0 });
    assert.equal(f.c.LORE.pro.i, code === 'ArrowRight' || code === 'PageDown' ? 3 : 1);
    assert.deepEqual(f.effects.sounds, ['click']); assert.equal(f.effects.saves, 0);
  }
  for (const code of ['ArrowLeft', 'PageUp']) {
    const f = prologueActions(), buttons = f.overlay().buttons;
    f.key(code, { repeat: false }); assert.equal(f.c.LORE.pro.i, 0); assert.equal(f.overlay().buttons, buttons);
  }
  for (const replay of [false, true]) for (const code of ['ArrowRight', 'PageDown']) {
    const f = prologueActions({ replay }); f.view(4);
    f.key(code, { repeat: true }); assert.equal(f.c.LORE.pro.i, 4); assert.equal(f.effects.saves, 0);
    assert.deepEqual(f.key(code, { repeat: false }), { prevented: 1, stopped: 1, leaked: 0 });
    assert.equal(f.c.LORE.pro, null); assert.equal(f.c.UI.modal, null); assert.equal(f.effects.saves, 1);
    assert.deepEqual(f.effects.notes, replay ? [] : ['start']);
  }
});

test('suppressed repeats preserve the actual trusted-input gates and microtask forwarding', () => {
  for (const trusted of [false, true]) for (const hidden of [false, true]) for (const focused of [false, true]) {
    const f = prologueActions(); f.view(4);
    const tasks = []; let forwarded = 0, synced = 0;
    f.c.document.hidden = hidden; f.c.document.hasFocus = () => focused;
    f.c.NET_HUMAN_PLAY = { focused: false, activity: 0, pendingAt: null };
    f.c.performance = { now: () => 100 }; f.c.queueMicrotask = fn => tasks.push(fn);
    f.c.netHumanSuspend = () => { throw Error('A valid finite activity counter must not suspend'); };
    f.c.netHumanSync = () => { synced++; assert.equal(f.c.UI.modal, 'prologue'); };
    vm.runInContext(declarations('14m_liveplay.js', ['netHumanInput']), f.c);
    const actualInput = f.c.netHumanInput;
    f.c.netHumanInput = event => { forwarded++; actualInput(event); };
    assert.deepEqual(f.key('PageDown', { type: 'keydown', repeat: true, isTrusted: trusted }), { prevented: 1, stopped: 1, leaked: 0 });
    const eligible = trusted && !hidden && focused;
    assert.equal(forwarded, 1); assert.equal(f.c.NET_HUMAN_PLAY.activity, eligible ? 1 : 0);
    assert.equal(f.c.NET_HUMAN_PLAY.pendingAt, eligible ? 100 : null);
    assert.equal(tasks.length, eligible ? 1 : 0); tasks.forEach(fn => fn()); assert.equal(synced, eligible ? 1 : 0);
    assert.equal(f.c.LORE.pro.i, 4); assert.equal(f.effects.saves, 0);
  }
});

test('repeat suppression stays inside the open prologue and changes no other key route', () => {
  for (const absent of ['modal', 'pro']) {
    const f = prologueActions(); if (absent === 'modal') f.c.UI.modal = null; else f.c.LORE.pro = null;
    assert.deepEqual(f.key('ArrowRight', { repeat: true }), { prevented: 0, stopped: 0, leaked: 1 });
    assert.equal(f.effects.input, 0); assert.equal(f.effects.saves, 0);
  }
  for (const code of ['Enter', 'Space', 'NumpadEnter']) {
    const focused = prologueActions();
    assert.deepEqual(focused.key(code, { repeat: true }), { prevented: 0, stopped: 1, leaked: 0 });
    assert.equal(focused.c.LORE.pro.i, 0, 'Focused button keeps the original native activation route, not modeled by this CPU fixture');
    const unfocused = prologueActions({ touch: true });
    assert.deepEqual(unfocused.key(code, { repeat: true }), { prevented: 1, stopped: 1, leaked: 0 });
    assert.equal(unfocused.c.LORE.pro.i, 1, 'The existing unfocused route is unchanged');
  }
  const escape = prologueActions(); escape.view(4); escape.key('Escape', { repeat: true });
  assert.equal(escape.c.UI.modal, null); assert.equal(escape.effects.saves, 1);
  const unrelated = prologueActions();
  assert.deepEqual(unrelated.key('KeyW', { repeat: true }), { prevented: 0, stopped: 1, leaked: 0 });
  assert.equal(unrelated.c.LORE.pro.i, 0);
});

for (const replay of [false, true]) for (const touch of [false, true]) {
  test(`prologue has one final exit while earlier skipping and navigation remain, replay=${replay}, touch=${touch}`, () => {
    const f = prologueActions({ replay, touch });
    for (const index of [0, 2, 4]) {
      const buttons = f.view(index), last = index === 4;
      const skip = buttons.filter(button => button.dataset.pro === 'skip');
      assert.equal(skip.length, last ? 0 : 1, 'Final page must omit the redundant header exit from its markup');
      if (!last) assert.equal(skip[0].textContent, replay ? 'Close' : 'Skip the prologue');
      assert.equal(buttons.filter(button => button.primary).length, 1);
      const next = buttons.find(button => button.dataset.pro === 'next');
      assert.equal(next.textContent, last ? replay ? 'Return to the march' : 'Begin' : 'Next');
      assert.equal(buttons.filter(button => /^\d$/.test(button.dataset.pro)).length, 5, 'All page destinations remain');
      assert.equal(buttons.filter(button => button.dataset.pro === 'back').length, index > 0 ? 1 : 0);
      assert.match(f.overlay().innerHTML, /role="dialog" aria-modal="true" aria-labelledby="lore-pro-t" aria-describedby="lore-pro-x"/);
      if (!touch) assert.equal(f.c.document.activeElement, next, 'Desktop focus stays on the primary action');
    }
    f.click('back');
    assert.equal(f.c.LORE.pro.i, 3);
    assert.equal(f.overlay().buttons.find(button => button.dataset.pro === 'skip').textContent, replay ? 'Close' : 'Skip the prologue');
    f.click('0');
    assert.equal(f.c.LORE.pro.i, 0);
    assert.equal(f.effects.saves, 0, 'Reading, dots and Back do not dismiss or save');
    assert.deepEqual(f.effects.notes, []);
  });
}

for (const replay of [false, true]) test(`final primary exit preserves earlier Skip/Close and Escape side effects, replay=${replay}`, () => {
  const snapshots = [];
  for (const action of ['earlier-skip', 'final-primary', 'final-escape']) {
    const f = prologueActions({ replay });
    if (action !== 'earlier-skip') f.view(4);
    if (action === 'final-escape') f.key('Escape');
    else f.click(action === 'earlier-skip' ? 'skip' : 'next');
    assert.equal(f.c.UI.modal, null);
    assert.equal(f.c.LORE.pro, null);
    assert.equal(f.overlay().hidden, true);
    assert.equal(f.overlay().innerHTML, '');
    assert.equal(f.effects.saves, 1);
    assert.deepEqual(f.effects.notes, replay ? [] : ['start']);
    assert.deepEqual(f.effects.sounds, [], 'Final advance returns through close before page-turn audio');
    assert.equal(f.effects.input, action === 'final-escape' ? 1 : 0, 'Existing key input forwarding is unchanged');
    snapshots.push(JSON.parse(JSON.stringify(f.progress)));
  }
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[1], snapshots[2]);
  assert.deepEqual(snapshots[0], { level: 1, xp: 0, rp: 0, lore: { done: [], seen: [], pro: 1 } }, 'Only the original prologue-seen fact changes');
});

function guidance() {
  const c = vm.createContext({
    CAMPS: [], REALMS: [{ id: 0 }], MOB_PLURAL: { wolf: 'wolves', bandit: 'outlaws' },
    entities: new Map(), getEnt: id => c.entities.get(id),
    dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
  });
  vm.runInContext(declarations('10e_guide.js', ['guideNearest', 'GUIDE_BEASTS', 'guideCampResidents', 'guideCampFor']), c);
  return {
    c,
    camp(id, x, levels, extra = {}) {
      const members = new Set();
      for (const [i, level] of levels.entries()) { const key = `${id}:${i}`; members.add(key); c.entities.set(key, { id: key, level, alive: true }); }
      c.CAMPS.push({ id, realm: 0, type: 'wolf', x, z: 0, lmin: 1, lmax: 3, members, ...extra });
      return c.CAMPS.at(-1);
    },
    mark(level = 1, beasts = false) { return c.guideCampFor({ faction: 0, x: 0, z: 0 }, { level }, beasts); },
  };
}

test('new recruits are guided by living residents, not a camp’s obsolete authored tier', () => {
  const f = guidance();
  f.camp('veterans', 10, [12], { lmin: 1, lmax: 3 });
  f.camp('recruits', 50, [1], { lmin: 40, lmax: 50 });
  assert.equal(f.mark().x, 50);
  assert.match(f.mark().what, /level 1 wolves/);
  assert.equal(f.c.entities.get('veterans:0').level, 12, 'guidance never changes earned NPC development');
});

test('an empty or mixed dangerous camp is not advertised as suitable quarry', () => {
  const f = guidance();
  f.camp('empty', 1, []);
  f.camp('mixed', 5, [1, 9]);
  const dead = f.camp('dead', 3, [1]);
  f.c.entities.get([...dead.members][0]).alive = false;
  assert.equal(f.mark(), null);
  f.camp('safe', 50, [1, 2]);
  assert.equal(f.mark().x, 50);
  assert.match(f.mark().what, /level 1–2 wolves/);
});

test('experienced players get a matching living encounter before a nearer weak one', () => {
  const f = guidance();
  f.camp('weak', 10, [1]);
  f.camp('matching', 70, [9, 10], { lmin: 1, lmax: 3 });
  assert.equal(f.mark(10).x, 70);
  f.c.entities.get('matching:0').removed = true;
  f.c.entities.get('matching:1').alive = false;
  assert.equal(f.mark(10).x, 10, 'a weaker fallback states its true level rather than claiming to match');
  assert.match(f.mark(10).what, /level 1 wolves/);
});

test('cooking guidance filters to living beasts in the player’s homeland', () => {
  const f = guidance();
  f.camp('outlaws', 1, [1], { type: 'bandit' });
  f.camp('foreign', 2, [1], { realm: 1 });
  f.camp('champion', 3, [1], { elite: true });
  f.camp('food', 30, [1]);
  assert.equal(f.mark(1, true).x, 30);
});

function fullGuidance(f, level = 1) {
  Object.assign(f.c, {
    GAME: { player: { faction: 0, x: 0, z: 0 }, prog: { level } }, R_RING: 100,
    inDungeon: () => false, g2MarkOf: () => undefined, capFirst: text => text, goodsHave: () => false,
  });
  Object.assign(f.c.REALMS[0], { town: { x: 800, z: 0 }, musterSite: { x: 40, z: 20 }, townName: 'Home' });
  vm.runInContext(declarations('10e_guide.js', ['guideOnFrontier', 'guideTown', 'guideMarkOf']), f.c);
}

test('hunting objectives on the frontier guide a recruit to the actual portal home', () => {
  const f = guidance(); fullGuidance(f);
  for (const id of ['lv5', 'lv20', 'cook', 'muster']) {
    const mark = f.c.guideMarkOf({ id });
    assert.equal(mark.x, 40, id);
    assert.equal(mark.z, 20, id);
    assert.equal(mark.what, 'the portal stones home', id);
  }
});

test('champion recommendations also respect actual development instead of authored tiers', () => {
  const f = guidance(); fullGuidance(f, 1);
  const veteran = f.camp('veteran', 5, [], { elite: true, lmin: 1, eliteId: 'old' });
  f.c.entities.set(veteran.eliteId, { alive: true, level: 40, x: 5, z: 0, name: 'Veteran' });
  const fresh = f.camp('new', 50, [], { elite: true, lmin: 40, eliteId: 'new' });
  f.c.entities.set(fresh.eliteId, { alive: true, level: 1, x: 50, z: 0, name: 'New champion' });
  assert.equal(f.c.guideMarkOf({ id: 'champion' }).what, 'New champion');
  f.c.entities.get(fresh.eliteId).removed = true;
  assert.equal(f.c.guideMarkOf({ id: 'champion' }), null);
});

function bounties() {
  const f = guidance(); fullGuidance(f);
  Object.assign(f.c, {
    MOBS: { wolf: { names: ['young wolf', 'wolf-lord'] } },
    xpToNext: () => 100, Math: Object.create(Math), LEVEL_CAP: 50, LATE2_RISE_AT: 40, late2Risen: c => c.risen === true,
  });
  f.c.Math.random = () => 0;
  vm.runInContext(declarations('09_player.js', ['bountyCampInfo', 'bountyAvailable', 'chooseBounty']) + '\n' + declarations('10e_guide.js', ['pluralName']), f.c);
  return f;
}

test('bounty offers use suitable actual residents and their observed names, preserving accepted progress', () => {
  const f = bounties();
  f.camp('danger', 10, [15], { lmin: 1, lmax: 2 });
  const safe = f.camp(1, 50, [1], { lmin: 40, lmax: 50 });
  f.c.entities.get('1:0').name = 'young wolf';
  const existing = { type: 'wolf', name: 'old saved quarry', camp: 0, have: 4, need: 6, reward: 35 };
  f.c.GAME.prog.bounty = existing;
  const offer = f.c.chooseBounty();
  assert.equal(offer.camp, safe.id);
  assert.equal(offer.name, 'young wolf');
  assert.equal(offer.minLevel, 1); assert.equal(offer.maxLevel, 1);
  assert.equal(offer.reward, 35);
  assert.equal(f.c.GAME.prog.bounty, existing, 'opening an offer never rerolls an existing accepted bounty');
  assert.equal(existing.have, 4);
  f.c.entities.get('1:0').name = '<img src=x onerror=alert(1)>';
  assert.equal(f.c.chooseBounty().name, 'wolves', 'an unrecognized resident name cannot become markup in the existing bounty UI');
});

test('mixed resident names use the true species, and unavailable quarry produces no fabricated offer', () => {
  const f = bounties();
  f.camp(0, 10, [1, 2]);
  f.c.entities.get('0:0').name = 'young wolf'; f.c.entities.get('0:1').name = 'grey wolf';
  const offer = f.c.chooseBounty();
  assert.equal(offer.name, 'wolves');
  assert.equal(f.c.pluralName(offer.name), 'wolves');
  assert.equal(offer.minLevel, 1); assert.equal(offer.maxLevel, 2);
  f.c.entities.get('0:1').level = 20;
  assert.equal(f.c.chooseBounty(), null);
  f.c.entities.get('0:0').alive = false; f.c.entities.get('0:1').alive = false;
  assert.equal(f.c.chooseBounty(), null);
});

test('the real herald dialog explains unavailable quarry and cannot accept a nonexistent bounty', () => {
  const f = bounties(), nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { children: [], appendChild(child) { this.children.push(child); } }); return nodes.get(id); };
  Object.assign(f.c, {
    $: node, UI: {}, LEVEL_CAP: 50, late2HeraldBounty: () => null,
    closeDialog() {}, late3HeraldText: () => '', seasonWarText: () => '', esc: text => text,
    document: { createElement: () => ({}) },
  });
  vm.runInContext(declarations('10_ui.js', ['openHerald']), f.c);
  f.c.openHerald();
  assert.match(node('dlg-body').innerHTML, /no suitable bounty/);
  assert.deepEqual(node('dlg-actions').children.map(b => b.textContent), ['Farewell']);
  assert.equal(f.c.GAME.prog.bounty, undefined);
});

function bountyGuidance() {
  const f=bounties();
  Object.assign(f.c.GAME.player,{x:800,z:0});
  Object.assign(f.c.REALMS[0],{name:'Logres',herald:{x:805,z:2}});
  Object.assign(f.c.GAME.prog,{xp:7,rp:3,lore:{done:['herald']}});
  f.c.LK=()=>({map:'M'});
  vm.runInContext(declarations('10c_lore.js',['PATH_STEPS'])+'\nglobalThis.bountyStep=PATH_STEPS.find(step=>step.id===\'bounty\');',f.c);
  f.hint=()=>f.c.bountyStep.hint(f.c.REALMS[0],f.c.GAME.prog);
  f.mark=()=>f.c.guideMarkOf({id:'bounty'});
  return f;
}

test('unavailable bounty guidance offers another activity and never loops a recruit back to a herald with no offer',()=>{
  const f=bountyGuidance(),before=JSON.stringify(f.c.GAME.prog);
  f.c.Math.random=()=>{throw Error('Reading objective availability must not generate an offer or consume randomness');};
  assert.equal(f.c.bountyAvailable(),false);assert.equal(f.c.chooseBounty(),null);
  assert.match(f.hint(),/No suitable bounty.*Gather or explore.*track another objective/);
  assert.equal(f.mark(),null);
  f.camp('foreign',5,[1],{realm:1});f.camp('elite',6,[1],{elite:true});
  f.camp('unknown',7,[1],{type:'unknown'});f.camp('veterans',8,[12]);f.camp('mixed',9,[1,9]);
  const dead=f.camp('dead',10,[1]);f.c.entities.get([...dead.members][0]).alive=false;
  assert.equal(f.c.bountyAvailable(),false);assert.equal(f.mark(),null);
  assert.equal(JSON.stringify(f.c.GAME.prog),before,'Guidance cannot complete a step or award progress.');
  assert.equal(f.c.entities.get('veterans:0').level,12);
});

test('the same pure eligibility rule restores normal herald guidance when living suitable quarry returns',()=>{
  const f=bountyGuidance();
  const safe=f.camp(0,20,[1,2],{lmin:40,lmax:50});
  f.c.Math.random=()=>{throw Error('Availability and navigation must not roll a bounty');};
  assert.equal(f.c.bountyAvailable(),true);assert.match(f.hint(),/^Take a bounty from the Logres Herald/);
  assert.equal(f.mark().x,805);assert.equal(f.mark().z,2);
  f.c.Math.random=()=>0;const offer=f.c.chooseBounty();
  assert.equal(offer.camp,safe.id);assert.equal(offer.minLevel,1);assert.equal(offer.maxLevel,2);
  f.c.entities.get('0:1').level=12;
  assert.equal(f.c.bountyAvailable(),false);assert.equal(f.mark(),null);assert.match(f.hint(),/No suitable bounty/);
  f.c.entities.get('0:1').removed=true;
  assert.equal(f.c.bountyAvailable(),true,'Removing the dangerous resident exposes the actual suitable survivor.');
});

test('accepted and completed bounty guidance keeps its existing destination and rewards without reevaluating new offers',()=>{
  const f=bountyGuidance();f.camp(0,55,[]);
  const bounty={camp:0,name:'young wolf',need:6,have:2,reward:35};f.c.GAME.prog.bounty=bounty;
  const before=JSON.stringify(f.c.GAME.prog);
  assert.match(f.hint(),/Slay 6.*circled on your map/);assert.equal(f.mark().x,55);
  assert.equal(JSON.stringify(f.c.GAME.prog),before);
  bounty.done=true;const completed=JSON.stringify(f.c.GAME.prog);
  assert.match(f.hint(),/Done.*Herald for your pay/);assert.equal(f.mark().x,805);
  assert.equal(JSON.stringify(f.c.GAME.prog),completed);
});

test('veteran risen offers retain their normal herald route without advertising capped ordinary quarry',()=>{
  const f=bountyGuidance();f.c.GAME.prog.level=50;f.camp(0,10,[1]);
  assert.equal(f.c.bountyAvailable(),false);
  f.camp(1,20,[],{risen:true});
  assert.equal(f.c.bountyAvailable(),true);assert.match(f.hint(),/^Take a bounty/);assert.equal(f.mark().x,805);
  f.c.CAMPS[1].realm=1;assert.equal(f.c.bountyAvailable(),false);
});

function objectives() {
  const c = vm.createContext({
    GAME: { prog: { level: 1, xp: 0, rp: 0, lore: { done: ['herald'], seen: ['start'], pro: 1, pv: 3 } } },
    GUIDE: { mark: { x: 9 }, markT: 1 }, G2: { pointT: 1 }, LORE: {}, FIELD_NOTES: { start: {} },
    updates: 0, saves: 0, guideUpdateMark() { c.updates++; }, g2UpdatePointer() {}, renderPathHud() {}, saveSoon() { c.saves++; },
  });
  vm.runInContext(declarations('10c_lore.js', ['PATH_STEPS', 'PATH_BY_ID', 'PATH_VERSION', 'pathDone', 'pathSuggested', 'pathNext', 'pathTrack', 'loreSanitize', 'loreSaveData']), c);
  return c;
}

test('tracking a later objective changes navigation without awarding progress or losing the earlier path', () => {
  const c = objectives(), earned = JSON.stringify(c.GAME.prog);
  assert.equal(c.pathNext().id, 'bounty');
  assert.equal(c.pathTrack('cook'), true);
  assert.equal(c.pathNext().id, 'cook');
  assert.equal(c.pathSuggested().id, 'bounty', 'canonical progress order stays distinct from a selected navigation target');
  assert.equal(c.GUIDE.mark, null, 'old objective position is cleared immediately');
  const after = structuredClone(c.GAME.prog); delete after.lore.track;
  assert.equal(JSON.stringify(after), earned, 'XP, level, realm points and completed history are unchanged');
  assert.equal(c.saves, 1);
  c.GAME.prog.lore.done.push('cook');
  assert.equal(c.pathNext().id, 'bounty', 'completion resumes the first unfinished step');
});

test('selected objectives survive a save round trip and invalid or completed selections are discarded', () => {
  const c = objectives();
  c.pathTrack('cook');
  const kept = c.loreSanitize(c.loreSaveData());
  assert.equal(kept.track, 'cook');
  assert.deepEqual(Array.from(kept.done), ['herald']);
  for (const track of ['herald', 'missing', 'toString', '__proto__', 7]) {
    assert.equal(c.loreSanitize({ ...kept, track }).track, undefined);
    assert.equal(c.pathTrack(track), false);
  }
  c.GAME.prog.lore.track = 'toString';
  assert.equal(c.pathNext().id, 'bounty');
  const damaged = c.loreSanitize({ done: ['herald', 'toString', '__proto__'], seen: ['start', 'toString'], track: 'cook' });
  assert.deepEqual(Array.from(damaged.done), ['herald']);
  assert.deepEqual(Array.from(damaged.seen), ['start']);
  assert.equal(damaged.track, 'cook');
});

function beginIntent() {
  const c = vm.createContext({
    LORE: { begin: null }, GAME: { started: false }, UI: { realm: 0, cls: 'warrior', titleSave: null },
    NETWS: { host: 'fixture.example', acct: { id: 'fixture-owner' } },
    $: () => ({ value: 'Fixture recruit' }), performance: { now: () => 0 },
  });
  vm.runInContext(declarations('10c_lore.js', ['loreCancelBegin', 'loreRequestBegin', 'loreConsumeBegin']), c);
  return { c, save: { fresh: true, realm: 0, cls: 'warrior', name: 'Fixture recruit' } };
}

test('a real Begin intent survives slow startup and is consumed exactly once for that character', () => {
  const { c, save } = beginIntent();
  c.loreRequestBegin(save);
  c.performance.now = () => 600000;
  assert.equal(c.loreConsumeBegin(save), true, 'a ten-minute graphics or native read delay must not discard the requested prologue');
  assert.equal(c.loreConsumeBegin(save), false, 'the intent cannot replay on another start');
});

test('cancelled, changed-host, changed-character and recovered-old-character starts cannot reuse a Begin intent', () => {
  for (const [change, value] of [['realm', 1], ['cls', 'mage'], ['name', 'Another recruit'], ['fresh', false]]) {
    const { c, save } = beginIntent(); c.loreRequestBegin(save);
    save[change] = value;
    assert.equal(c.loreConsumeBegin(save), false, change);
    assert.equal(c.loreConsumeBegin(save), false, 'a rejected or recovered character consumes the old intent');
  }
  for (const change of [c => { c.NETWS.host = 'other.example'; }, c => c.loreCancelBegin()]) {
    const { c, save } = beginIntent(); c.loreRequestBegin(save); change(c);
    assert.equal(c.loreConsumeBegin(save), false);
  }
  const { c, save } = beginIntent(); c.UI.titleSave = { char: save }; c.loreRequestBegin(save);
  assert.equal(c.loreConsumeBegin(save), false, 'a returning character button never requests a fresh-character prologue');
});

test('first native bootstraps from null or placeholder transport accounts keep the exact accepted fresh request', () => {
  for (const initialAccount of [null, { id: 'placeholder-transport' }]) {
    const { c, save } = beginIntent();
    c.NETWS.acct = initialAccount;
    c.loreRequestBegin(save);
    c.NETWS.acct = { id: 'new-temporary-owner', nativeBound: true };
    assert.equal(c.loreConsumeBegin(save), true, 'public prologue eligibility does not replace the existing guarded native start');
    c.loreRequestBegin(save);
    assert.equal(c.loreConsumeBegin({ ...save }), false, 'an unrelated fresh request cannot reuse the intent');
  }
});

test('the actual native Begin bootstrap hands the accepted request to the existing guarded start', async () => {
  for (const initialAccount of [null, { id: 'placeholder-transport' }]) {
    const { c, save } = beginIntent(), profile = {}, starts = [];
    c.NETWS.acct = initialAccount;
    Object.assign(c, {
      SAVE: {}, NATIVE_PLAYER: { status: { bound: false, verified: false }, profile: null },
      nativePlayerTask: async run => run(), nativePlayerCanPlayNow: () => true, nativePlayerRender() {},
      nativePlayerProvisionalSession: async () => ({
        peek: async () => null,
        bootstrap: async () => { c.NETWS.acct = { id: 'new-temporary-owner', nativeBound: true }; c.NATIVE_PLAYER.status = { verified: true }; },
        profile: () => profile,
      }),
      nativePlayerProvisionalRef: () => ({ get: async () => ({ exists: true, data: () => ({ v: 1, char: null }) }) }),
      validSave: value => value,
      startGame: (request, mayStart) => { if (mayStart()) starts.push({ same: request === save, prologue: c.loreConsumeBegin(request) }); },
    });
    vm.runInContext(declarations('14v_nativeidentity.js', ['nativePlayerBegin']), c);
    c.loreRequestBegin(save);
    await c.nativePlayerBegin(save);
    assert.deepEqual(starts, [{ same: true, prologue: true }]);
    assert.equal(c.SAVE.readConfirmed, true);
    assert.equal(c.NATIVE_PLAYER.profile, profile);
    assert.equal(c.NATIVE_PLAYER.playFlight, null);
  }
});

test('the actual native Begin preserves a recovered character and its owner guard rejects a late account swap', async () => {
  for (const recover of [true, false]) {
    const { c, save } = beginIntent(), profile = {}, starts = [];
    const old = { ...save, fresh: false, level: 8, xp: 19, name: 'Existing earned character' };
    Object.assign(c, {
      SAVE: {}, NATIVE_PLAYER: { status: { bound: false, verified: false }, profile: null },
      nativePlayerTask: async run => run(), nativePlayerCanPlayNow: () => true, nativePlayerRender() {},
      nativePlayerProvisionalSession: async () => ({ peek: async () => null,
        bootstrap: async () => { c.NETWS.acct = { id: 'confirmed-owner' }; c.NATIVE_PLAYER.status = { verified: true }; }, profile: () => profile }),
      nativePlayerProvisionalRef: () => ({ get: async () => ({ exists: true, data: () => ({ v: 1, char: recover ? old : null }) }) }),
      validSave: value => value, applySettings() {}, applyWorldSave() {}, coreKey: () => '',
      startGame: (request, mayStart) => {
        if (!recover) c.NETWS.acct = { id: 'different-owner' };
        if (mayStart()) starts.push({ name: request.name, level: request.level, xp: request.xp, prologue: c.loreConsumeBegin(request) });
      },
    });
    vm.runInContext(declarations('14v_nativeidentity.js', ['nativePlayerBegin']), c);
    c.loreRequestBegin(save); await c.nativePlayerBegin(save);
    assert.deepEqual(starts, recover ? [{ name: old.name, level: 8, xp: 19, prologue: false }] : []);
  }
});
