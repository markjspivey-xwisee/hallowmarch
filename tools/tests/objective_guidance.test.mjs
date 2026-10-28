import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

function declarations(file, names) {
  const source = readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
  const nodes = parse(source, { ecmaVersion: 'latest' }).body;
  return names.map(name => {
    const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
    assert.ok(node, name);
    return source.slice(node.start, node.end);
  }).join('\n');
}

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
    xpToNext: () => 100, Math: Object.create(Math),
  });
  f.c.Math.random = () => 0;
  vm.runInContext(declarations('09_player.js', ['chooseBounty']) + '\n' + declarations('10e_guide.js', ['pluralName']), f.c);
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
