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
