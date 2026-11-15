import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
function declaration(source, name) {
  const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n =>
    n.type === 'FunctionDeclaration' && n.id.name === name
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  assert.ok(node, name); return source.slice(node.start, node.end);
}
function fixture() {
  const c = vm.createContext({ Math: Object.create(Math), Map, Set });
  const dragon = read('08d_dragon_ai.js'), entities = read('07_entities.js'), data = read('06_data.js');
  vm.runInContext(`
    const GAME={t:1,started:true,player:null,prog:{level:1,rp:0}},NETWS={url:'world'},NETS={s:{development:{realms:[{level:50},{level:50},{level:50}]}}};
    const netRealmSeasonProjectionFresh=()=>true,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),hex3=()=>[0,0,0],TAU=Math.PI*2;
    const DRAGON_NAME='Cinderwing',FACTION_MONSTER=3,MOBS={},REALM_BONUS=[1,1,1],ENT=[],CAMPS=[];
    const DRAGON={perches:[{x:0,z:0}],circ:{r:100},strafeNext:true},LATE2={toldRise:true};
    const makeEnt=o=>{const e={id:ENT.length+1,power:100,hp:100,maxHp:100,buffs:[],...o};ENT.push(e);return e};
    const getEnt=id=>ENT.find(e=>e.id===id)||null,heightAt=()=>0,dragonPoseZero=()=>({}),gearPowerBase=e=>60+7*e.level,late2Stats=()=>{},buffSum=()=>0,ladderWeak=()=>1;
    const late2RiseK=()=>0,late4Measuring=()=>false;
  ` + data.split('const MOBS =')[0] + '\n' + declaration(entities, 'ROLE_MULT')
    + '\nROLE_MULT.boss=[20,1.6];\n' + dragon.split('\n').find(line => line.startsWith('MOBS.dragon ='))
    + '\n' + ['DRAGON_LEVEL', 'DRAGON_SKILLS', 'spawnDragon'].map(n => declaration(dragon, n)).join('\n')
    + '\n' + ['setupStats', 'computeDamage'].map(n => declaration(entities, n)).join('\n')
    + '\n' + ['LATE2_RISE_AT', 'late2Band', 'late2Rescale'].map(n => declaration(read('10l_late.js'), n)).join('\n')
    + '\n' + ['LATE4_HOST_AT', 'late4HostOn'].map(n => declaration(read('10o_late4.js'), n)).join('\n'), c);
  return { run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)) };
}

test('a fresh dragon begins at level1 regardless of visitor or world development, with its own empty experience', () => {
  const f = fixture();
  f.run('GAME.prog.level=50;spawnDragon()');
  assert.equal(f.run('DRAGON.e.level'), 1);
  assert.deepEqual(f.json('DRAGON.e.growth'), { v: 1, base: 1, xp: 0, kills: 0 });
  assert.equal(f.run('DRAGON.strafeNext'), false);
  assert.equal(f.run('DRAGON.e.maxHp'), 96 * .82 * 20, 'the boss retains its real health multiplier');
});

test('a fresh dragon bite including a critical cannot one-shot any fresh player calling', () => {
  const f = fixture();
  f.run('spawnDragon();let calls=0;Math.random=()=>calls++%2?0:.5');
  for (const cls of ['warrior', 'archer', 'mage', 'priest']) {
    const result = f.json(`(()=>{const p={role:'player',kind:'humanoid',cls:${JSON.stringify(cls)},level:1,faction:0,power:100,buffs:[]};GAME.player=p;setupStats(p);const hit=computeDamage(DRAGON.e,p,1.6);return {damage:hit.d*(1-p.drBase),health:p.maxHp,crit:hit.crit}})()`);
    assert.equal(result.crit, true);
    assert.ok(result.damage > 10 && result.damage < result.health, `${cls}: ${result.damage} vs ${result.health}`);
  }
});

test('world unlocks never rewrite a risen actor own earned experience or raise a fresh encounter level', () => {
  const f = fixture();
  f.run(`const xp=Array.from({length:6},(_,i)=>xpToNext(i+1)).reduce((a,b)=>a+b,0);
    const veteran=makeEnt({kind:'humanoid',role:'mob',cls:'warrior',level:7,faction:3,alive:true,growth:{v:1,base:1,xp,kills:20}});
    const camp={l2on:true,members:new Set([veteran.id])};CAMPS.push(camp);late2Rescale()`);
  assert.equal(f.run('veteran.level'), 7);
  assert.equal(f.run('veteran.growth.kills'), 20);
  assert.deepEqual(f.json('late2Band({lmin:30,lmax:40,l2on:true})'), [1, 1, 0]);
});

test('risen availability follows shared development rather than the current visitor level', () => {
  const f = fixture();
  assert.equal(f.run('late4HostOn()'), true, 'a recruit can see the already-developed shared world');
  f.run('GAME.prog.level=50;NETS.s.development.realms.forEach(r=>r.level=1)');
  assert.equal(f.run('late4HostOn()'), false, 'a veteran does not unlock shared encounters by arriving');
});
