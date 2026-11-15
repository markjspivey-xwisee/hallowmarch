import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
function selected(file,names) {
  const source=read(file),nodes=parse(source,{ecmaVersion:'latest'}).body;
  return names.map(name=>{const node=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));assert.ok(node,name);return source.slice(node.start,node.end);}).join('\n');
}
function fixture(cls) {
  const c=vm.createContext({Math:Object.create(Math),Number,Object,Array,
    GAME:{prog:{level:50,rp:0},player:null},NETWS:{url:'wss://march'},NETS:{s:{development:{realms:[{level:50},{level:50},{level:50}]}}},
    netRealmSeasonProjectionFresh:()=>true,netEntityCanSimulateWorld:()=>true,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),gearPowerBase:()=>67,late2Stats(){},buffSum:()=>0,REALM_BONUS:[1,1,1],
    randomName:()=> 'Soldier',classLook:()=>({scale:1}),floorAt:()=>0,heightAt:()=>0,TAU:Math.PI*2,
    makeEnt:o=>({...o,hp:100,maxHp:100,power:100}),MOBS:{},ladderWeak:()=>1});
  vm.runInContext(read('06_data.js').split('const MOBS =')[0]+'\n'+selected('07_entities.js',['ROLE_MULT','setupStats','computeDamage'])+'\n'+selected('08_ai.js',['WAR_LEVEL_OFF','spawnRealmUnit'])+'\nthis.data={CLASSES,ABILITIES};',c);
  c.cls=cls;
  vm.runInContext(`const recruit={role:'player',kind:'humanoid',faction:0,level:1,cls,power:100};GAME.player=recruit;setupStats(recruit);
    const guard=spawnRealmUnit(2,'priest',50,'guard',0,0);this.recruit=recruit;this.guard=guard;`,c);
  function worstHit(){let n=0;c.Math.random=()=>n++%2?0:1;return c.computeDamage(c.guard,c.recruit,c.data.ABILITIES.smite.dmg).d*(1-c.recruit.drBase);}
  return {c,worstHit,run:code=>vm.runInContext(code,c)};
}

for(const cls of ['warrior','archer','mage','priest']) test(`actual fresh guard Smite is survivable for a level1 ${cls}, and genuine practice still strengthens it`,()=>{
  const f=fixture(cls);
  assert.equal(f.c.guard.level,1,'worlddevelopment50 and keeperlevel50 cannot raise a new guard');
  assert.equal(f.c.guard.growth.base,1);assert.equal(f.c.guard.growth.xp,0);
  const initial=f.worstHit();
  assert.ok(initial>10&&initial<f.c.recruit.maxHp,`${initial} critical damage against ${f.c.recruit.maxHp} health`);
  assert.ok(Math.abs(initial-9*1.3*.95*1.9*1.1*1.5*(1-f.c.recruit.drBase))<1e-8,'original class, role, variation, critical and armour multipliers remain intact');
  f.run('guard.alive=true;worldActorPractice(guard,"combat",100)');
  assert.equal(f.c.guard.level,2);assert.equal(f.c.guard.growth.xp,100);
  assert.ok(f.worstHit()>initial,'actual individual experience raises damage without a victim-level cap');
  assert.equal(f.c.recruit.level,1);assert.equal(f.c.GAME.prog.level,50,'the existing private career is not rewritten');
});
