import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture() {
  const nodes = new Map(['death', 'death-by', 'btn-release'].map(id => [id, { hidden: true, textContent: '', focus() { this.focused = true; } }]));
  const player = { id: 1, name: 'Recruit', role: 'player', faction: 0, level: 1, alive: true, hp: 100, maxHp: 100,
    x: 1000, y: 0, z: 0, drBase: .2, buffs: [], anim: { act: 1 }, target: 2 };
  const logs = [], calls = [];
  const c = vm.createContext({ GAME: { t: 20, player, prog: { deaths: 0 } }, UI: {}, INPUT: { keys: new Set(['KeyW']) },
    REALMS: [{ name: 'Logres', townName: 'Caer' }, { name: 'Eriu' }, { name: 'Thule' }], R_RING: 500,
    $: id => nodes.get(id), inDungeon: () => false, buildBedSpot: () => null,
    uiFloatAt() {}, uiLog: text => logs.push(text), capFirst: s => s.charAt(0).toUpperCase() + s.slice(1), flashScreen() {},
    sfx() {}, activityRecord: (...args) => calls.push(args), netSheetToggle: value => calls.push(['sheet', value]), netChatClose: () => calls.push(['chat']),
    buffMax: () => 0, giftHarmMult: () => 1, gearLateHarm: () => 1, late2HarmMult: () => 1, loopsHarmMult: () => 1,
    classHarm: (src, dst, amount) => amount, survivalHarmMult: () => 1, realmManualCeasefire: () => false, towerSightBlocked: () => false,
    sndShieldBroke() {}, setAct() {}, onImpact() {}, wearOnHit() {}, brandOnHit() {}, classOnHit() {}, ladderOnHit() {},
    activityEntityEvent() {}, deathEffects() {}, BAL: {},
  });
  const ui = read('10_ui.js'), p = read('09_player.js'), combat = read('07_entities.js');
  vm.runInContext([extract(ui, 'theName'), extract(ui, 'onDamageFeedback'), extract(ui, 'uiDeathDamage'), extract(ui, 'uiDeath'),
    extract(p, 'onPlayerDeath'), extract(combat, 'dealDamage'), extract(combat, 'killEnt'), extract(read('08_ai.js'), 'onEntityKilled')].join('\n'), c);
  const attacker = { id: 2, name: 'Aldric', level: 20, faction: 2, role: 'guard', cls: 'priest', x: 1001, z: 0 };
  return { c, player, attacker, nodes, logs, calls };
}

test('actual fatal damage flow explains attacker level, realm, post-armour damage and type', () => {
  const f = fixture();
  f.c.dealDamage(f.attacker, f.player, 180, { kind: 'holy', crit: true });
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule. Final hit: 144 holy damage (critical).');
  assert.equal(f.nodes.get('death').hidden, false);
  assert.equal(f.nodes.get('btn-release').focused, true);
  assert.equal(f.nodes.get('btn-release').textContent, 'Release to Caer');
  assert.equal(f.player.alive, false);
  assert.equal(f.c.GAME.prog.deaths, 1);
  assert.equal(f.c.INPUT.keys.size, 0);
  assert.equal(f.c.UI.deathHit, null);
  assert.ok(f.calls.some(x => x[0] === 'sheet' && x[1] === false));
  assert.ok(f.calls.some(x => x[0] === 'chat'));
});

test('fatal receipt uses damage after shields, including otherwise quiet ongoing damage', () => {
  const f = fixture();
  f.player.buffs.push({ kind: 'shield', value: 20 });
  f.c.dealDamage(f.attacker, f.player, 160, { dot: true });
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule. Final hit: 108 damage over time.');
  assert.equal(f.logs.length, 0, 'ongoing combat ticks keep their existing quiet log behavior');
});

test('self-attributed environmental damage still records the fatal hit', () => {
  const f = fixture();
  f.c.dealDamage(f.player, f.player, 150, { kind: 'crush', dot: true });
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Recruit (level 1). Final hit: 120 crushing damage over time.');
  assert.equal(f.logs.length, 0);
});

test('old, nonfatal, other-killer and other-player hits cannot become a death explanation', () => {
  for (const mismatch of ['time', 'nonfatal', 'killer', 'player']) {
    const f = fixture();
    f.player.hp = mismatch === 'nonfatal' ? 50 : -10;
    f.c.onDamageFeedback(f.attacker, f.player, 110, 0, { kind: 'fire' });
    f.player.hp = 0;
    if (mismatch === 'time') f.c.GAME.t++;
    if (mismatch === 'killer') f.attacker = { ...f.attacker, id: 3 };
    if (mismatch === 'player') f.c.GAME.player = { ...f.player, id: 4 };
    f.c.onPlayerDeath(f.attacker);
    assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule.', mismatch);
    assert.equal(f.c.UI.deathHit, null, mismatch);
  }
});

test('receipt is consumed once and absence of an attacker retains the environment fallback', () => {
  const f = fixture();
  f.c.dealDamage(null, f.player, 150, { kind: 'fire' });
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by the wilds. Final hit: 120 fire damage.');
  f.c.onPlayerDeath(null);
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by the wilds.');
});

test('absorbed or invalid hits cannot replace a real fatal receipt and unknown types remain plain text', () => {
  for (const kind of ['<img src=x onerror=alert(1)>', 'toString']) {
    const f = fixture();
    f.player.hp = -10;
    f.c.onDamageFeedback(f.attacker, f.player, 110, 0, { kind });
    f.c.onDamageFeedback(f.attacker, f.player, 0, 40, {});
    f.c.onPlayerDeath(f.attacker);
    assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule. Final hit: 110 damage.');
  }
});
