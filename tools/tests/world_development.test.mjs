import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { loadRealmModule } from '../../server/season.js';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const declarations = (file, names) => {
  const source = read(file), ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  return names.map(name => { const node = ast.find(n => n.type === 'FunctionDeclaration' && n.id.name === name
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name)); assert.ok(node, name); return source.slice(node.start, node.end); }).join('\n');
};
function realms() {
  const c = vm.createContext({ module: { exports: {} } });
  vm.runInContext(read('08m_realm.js') + '\n' + read('08p_realm_management.js') + '\nthis.api={realmSimInit,realmSimStep,realmSimSanitize,realmDevelopmentView,realmDevelopmentEarn,realmManageStep,realmManageAction,rsmNewSeason,realmSimLive,RSM};', c);
  const a = c.api, state = a.realmSimInit(42); state.live = true;
  for (const r of state.realms) for (const b of r.management.buildings) b.paused = true;
  return { a, state, step: dt => a.realmManageStep(state, dt) };
}
function actors() {
  const c = vm.createContext({ Math, Number, Object, Array, Map, Set, JSON, String, console, window: {}, queueMicrotask: () => {} });
  vm.runInContext(`const GAME={t:1,player:{role:'player',level:50},prog:{level:50}},ENT=[];
    const NET={self:'a',peers:new Map()},NETWS={url:'wss://march',state:'on'},NETS={s:{development:{v:1,realms:[0,1,2].map(realm=>({realm,level:50,xp:1e9,sources:{training:1e9,work:0,combat:0}}))}}};
    const netRealmSeasonProjectionFresh=()=>true,netOn=()=>true,netHumanLive=()=>true,netSharedWorldReady=()=>true;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),animActValue=e=>e.anim.act;
    const getEnt=id=>ENT.find(e=>e.id===id)||null;
    function setupStats(e,keep){const ratio=keep&&e.maxHp?e.hp/e.maxHp:1;e.maxHp=70+26*e.level;e.hp=e.maxHp*ratio}
    function actor(role='soldier',faction=0){const e={id:ENT.length+1,role,kind:'humanoid',faction,level:1,name:'Soldier',alive:true,hp:96,maxHp:96,
      x:0,y:0,z:0,yaw:0,cls:'warrior',mobType:null,look:{},home:{x:0,z:0,r:1},buffs:[],anim:{act:0,phase:0,amt:0},ai:{}};ENT.push(e);return e}
  ` + read('06_data.js').split('const CLASSES =')[0] + '\n' + read('14x_netentities.js'), c);
  vm.runInContext(`NET_ENTITIES.authority='keeper';NET_ENTITIES.peer='a';NET_ENTITIES.complete=true;`, c);
  return { c, run: source => vm.runInContext(source, c), json: source => plain(vm.runInContext(source, c)) };
}

test('shared development starts at one and private player level never enters it', () => {
  const f = realms(); assert.deepEqual(plain(f.a.realmDevelopmentView(f.state).realms.map(r => r.level)), [1, 1, 1]);
  const p = actors(); assert.equal(p.run('warLevel()'), 50);
  p.run('const recruit=actor();worldActorDevelop(recruit)');
  assert.equal(p.run('recruit.level'), 1, 'world development unlocks do not level a recruit');
  p.run('NETS.s.development.realms.forEach(r=>r.level=1);GAME.prog.level=50;GAME.player.level=50');
  assert.equal(p.run('warLevel()'), 1);
  p.run('NETS.s.development.realms.forEach(r=>r.level=50);worldActorDevelop(recruit)');
  assert.equal(p.run('recruit.level'), 1);
});

test('development fifty cannot raise new troop levels or structural health', () => {
  const p = actors();
  p.run(declarations('08_ai.js', ['DOOR_HP', 'doorHpScale', 'warUnitLevel', 'scaleDoor']));
  p.run('const door={faction:0,level:1,keepRef:{},maxHp:3600,hp:1800,alive:true};scaleDoor(door)');
  assert.equal(p.run('warUnitLevel("muster",0)'), 1);
  assert.equal(p.run('door.level'), 1); assert.equal(p.run('door.maxHp'), 3600); assert.equal(p.run('door.hp'), 1800);
});

test('blocked, paused, full and unfed work earns no development experience', () => {
  for (const reason of ['paused', 'inputs', 'capacity', 'unfed']) {
    const f = realms(), r = f.state.realms[0], m = r.management;
    if (reason === 'inputs') { m.buildings[0].kind = 'mill'; m.buildings[0].paused = false; m.stock.grain = 0; }
    if (reason === 'capacity') { m.buildings[0].paused = false; m.stock.grain = 400; }
    if (reason === 'unfed') { m.buildings[0].paused = false; r.hungry = 3; m.needs.bread = 0; m.stock.bread = 0; }
    f.step(30);
    assert.equal(f.a.realmDevelopmentView(f.state).realms[0].xp, 0, reason);
  }
});

test('actual completed production and paid training earn only their realm experience once', () => {
  const f = realms(), r = f.state.realms[0]; r.management.buildings[0].paused = false;
  f.step(60); assert.ok(f.state.development.realms[0].sources.work > 0);
  assert.equal(f.state.development.realms[1].xp, 0);
  r.management.buildings[0].paused = true;
  const before = f.state.development.realms[0].sources.training;
  assert.equal(f.a.realmManageAction(f.state, 0, { type: 'recruit', units: 2, revision: f.state.management.revision }).ok, true);
  f.step(90); assert.equal(r.management.training, null);
  assert.equal(f.state.development.realms[0].sources.training - before, 16);
  f.step(1); assert.equal(f.state.development.realms[0].sources.training - before, 16);
});

test('stale positive need flags cannot award unfed construction or recruit completion', () => {
  for (const type of ['recruit', 'build']) {
    const f = realms(), r = f.state.realms[0], m = r.management;
    const args = type === 'recruit' ? { type, units: 1 } : { type, kind: 'house', plotId: 'town:0:10' };
    assert.equal(f.a.realmManageAction(f.state, 0, { ...args, revision: f.state.management.revision }).ok, true);
    const job = type === 'recruit' ? m.training : m.buildings.at(-1); job.remaining = 0.01;
    m.stock.bread = 0; m.needs.bread = 1; r.hungry = 0;
    f.step(0.1);
    assert.equal(f.a.realmDevelopmentView(f.state).realms[0].xp, 0, type);
  }
});

test('capture credit is deduplicated by the actual ownership transition', () => {
  const f = realms(); f.state.phase = 'war'; const keep = f.state.keeps.findIndex(k => k.h !== 0);
  f.a.realmSimLive(f.state, { type: 'keep', keep, holder: 0 });
  const xp = f.state.development.realms[0].xp; assert.equal(xp, 100);
  f.a.realmSimLive(f.state, { type: 'keep', keep, holder: 0 });
  assert.equal(f.state.development.realms[0].xp, xp);
});

test('development survives sanitizer, server summary and season rollover without clock experience', () => {
  const f = realms(); f.a.realmDevelopmentEarn(f.state, 1, 'training', 100);
  const saved = plain(f.state.development), restored = f.a.realmSimSanitize(plain(f.state));
  assert.deepEqual(plain(restored.development), saved);
  f.a.rsmNewSeason(restored); assert.deepEqual(plain(restored.development), saved);
  const server = loadRealmModule(fileURLToPath(new URL('../../src', import.meta.url)), fileURLToPath(new URL('../../server', import.meta.url)));
  assert.ok(server.realmDevelopmentView); assert.equal(server.realmSimSummary(restored, 1).development.realms[1].level, 2);
  const legacy = plain(f.state); delete legacy.development;
  const upgraded = f.a.realmSimSanitize(legacy);
  assert.equal(Object.hasOwn(upgraded, 'development'), false, 'readback must retain the legacy checkpoint exactly');
  assert.equal(f.a.realmDevelopmentView(upgraded).realms[1].level, 1);
  assert.equal(Object.hasOwn(upgraded, 'development'), false, 'a public view cannot migrate retained state');
});

test('long fractional development survives exact readback and continues deterministically', () => {
  const f = realms(), sources = ['training', 'work', 'combat'];
  for (let i = 1; i <= 20000; i++) f.a.realmDevelopmentEarn(f.state, i % 3, sources[Math.floor(i / 3) % 3], (i % 101 + 1) / 7);
  const kept = plain(f.state), round = f.a.realmSimSanitize(kept);
  assert.deepEqual(plain(round.development), kept.development);
  for (let i = 1; i <= 2000; i++) {
    f.a.realmDevelopmentEarn(f.state, i % 3, sources[Math.floor(i / 5) % 3], (i % 67 + 1) / 11);
    f.a.realmDevelopmentEarn(round, i % 3, sources[Math.floor(i / 5) % 3], (i % 67 + 1) / 11);
  }
  assert.deepEqual(plain(round.development), plain(f.state.development));
  const earlier = plain(f.state); earlier.development.realms[0].xp += 1e-9;
  const retained = f.a.realmSimSanitize(earlier);
  assert.deepEqual(plain(retained.development), earlier.development, 'roundoff in an already-retained total must not rewrite its checkpoint');
  const corrupt = plain(f.state); corrupt.development.realms[0].xp += 10;
  const repaired = f.a.realmSimSanitize(corrupt);
  assert.equal(repaired.development.realms[0].xp, f.state.development.realms[0].xp, 'a mismatched unearned total is not trusted');
});

test('an NPC earns its own combat levels and duplicate corpses or follower claims grant nothing', () => {
  const p = actors(); p.run('const soldier=actor(),victim=actor("mob",3);victim.alive=false;victim.level=1');
  assert.equal(p.run('worldActorExperience(soldier,victim)'), true);
  assert.equal(p.run('worldActorExperience(soldier,victim)'), false);
  assert.equal(p.run('soldier.growth.xp'), 14);
  p.run('for(let i=0;i<6;i++){const foe=actor("mob",3);foe.alive=false;worldActorExperience(soldier,foe)}');
  assert.equal(p.run('soldier.level'), 2);
  p.run('NET_ENTITIES.peer="other";const foe=actor("mob",3);foe.alive=false');
  assert.equal(p.run('worldActorExperience(soldier,foe)'), false);
  assert.equal(p.run('soldier.growth.xp'), 98);
});

test('work practice improves only that work skill without raising combat level', () => {
  const p = actors(); p.run('const worker=actor("villager",4);worldActorPractice(worker,"woodcutting",100)');
  assert.equal(p.run('worker.level'), 1); assert.equal(p.run('worker.growth.xp'), 0);
  assert.equal(p.run('worldActorWorkRate(worker,"woodcutting")'), 1.25);
  assert.equal(p.run('worldActorWorkRate(worker,"mining")'), 1);
  p.run('worldActorPractice(worker,"woodcutting",10000)');
  assert.equal(p.run('worldActorWorkRate(worker,"woodcutting")'), 1.25);
});

test('measurement bots retain their explicit level before their bot object is attached', () => {
  const p = actors(); p.run('const bot=actor("bot");bot.level=50');
  assert.equal(p.run('worldActorDevelop(bot)'), false);
  assert.equal(p.run('bot.level'), 50);
  assert.equal(p.run('worldActorPractice(bot,"combat",100)'), false);
});

test('legacy actor checkpoints normalize unearned level before the new keeper can simulate', () => {
  const p = actors(); p.run('const soldier=actor();soldier.level=20;soldier.maxHp=590;soldier.hp=295;const old=netEntityRow(soldier);NET_ENTITIES.waiting=true;netEntityApply(soldier,netEntityReadRow(old),true)');
  assert.equal(p.run('soldier.level'), 1); assert.equal(p.run('soldier.hp/soldier.maxHp'), 0.5);
  p.run('NET_ENTITIES.waiting=false;worldActorPractice(soldier,"combat",100);const saved=netEntityRow(soldier);const replacement=actor();NET_ENTITIES.waiting=true;netEntityApply(replacement,netEntityReadRow(saved),true)');
  assert.equal(p.run('replacement.level'), 2); assert.equal(p.run('replacement.growth.xp'), 100);
  assert.equal(p.run('GAME.prog.level'), 50, 'migration never rewrites the private career');
});

test('growth validation rejects forged base levels and unbounded practice before replay', () => {
  const p = actors();
  for (const growth of [{ v: 1, base: 20, xp: 0, kills: 0 }, { v: 1, base: 1, xp: Infinity, kills: 0 },
    { v: 1, base: 1, xp: 0, kills: 0, skills: { magic: 100 } }, { v: 1, base: 1, xp: 0, kills: 0, skills: { mining: 1e10 } }]) {
    p.c.growth = growth; assert.equal(p.run('worldActorGrowthRead(growth)'), null);
  }
});

test('accepted DOT identity survives the actual compact actor wire and keeper replay', () => {
  const p = actors(); p.run(`const bearer=actor(),next=actor();bearer.buffs.push({kind:'burn',value:2,until:GAME.t+8,
    sourceFaction:2,sourceActor:{name:'Removed caster',kind:'humanoid',cls:'mage',role:'soldier',level:4,faction:2}});
    const wire=netEntityRow(bearer);netEntityApply(next,netEntityReadRow(wire),true)`);
  assert.equal(p.run('next.buffs[0].sourceActor.name'), 'Removed caster');
  assert.equal(p.run('next.buffs[0].sourceActor.role'), 'soldier');
  assert.equal(p.run('next.buffs[0].sourceFaction'), 2);
  assert.equal(p.run('next.buffs[0].src'), null);
});
