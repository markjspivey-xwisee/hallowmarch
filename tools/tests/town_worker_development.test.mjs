import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { activityNpc } from '../../server/shared-scene.js';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
function declaration(source, name) {
  const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n =>
    n.type === 'FunctionDeclaration' && n.id.name === name
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  assert.ok(node, name); return source.slice(node.start, node.end);
}
function fixture() {
  const c = vm.createContext({ Math, Map, Set });
  vm.runInContext(`
    const GAME={t:1},CLASSES={},jobs=[],deliveries=[],LOOPS={stats:{felled:0,quarried:0},workers:[]},W={rocks:[{x:0,z:0,y:0,s:1}]},CRAFT={rocks:new Map()};
    const REALMS=[{id:0,town:{x:0,z:0}}],created=[],VILLAGER_NAMES=['Worker'],WB={robe:1,belt:2},TAU=Math.PI*2,FACTION_NEUTRAL=4;
    const pick=(rng,list)=>list[0],isWalkable=()=>true,villagerLook=()=>({mask:0}),makeEnt=o=>{const e={id:created.length+2,alive:true,ai:{},...o};created.push(e);return e};
    const TREE_DIM={pine:{r:.3,trunk:4,cut:1}},NET={self:'keeper'};let keeper=true;
    const netEntityCanSimulateWorld=()=>keeper,netNpcMine=()=>keeper,netNpcBoat=()=>{},clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const worker={id:1,kind:'humanoid',role:'villager',level:1,faction:4,alive:true,name:'Worker',netNpcRealm:0,
      x:0,y:0,z:0,yaw:0,hp:300,maxHp:300,ai:{lj:{realm:0,job:'wood'}},anim:{act:0,phase:0,amt:0},
      look:{tabard:[.3,.3,.3],armor:[.2,.2,.2],skin:0,hair:0,mask:0,flags:0,scale:1,outfit:4,emblem:3,fem:0,bulk:0}};
    const dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2,natS=()=>1,heightAt=()=>0,loopsTool=()=>{},turnToward=()=>{},setAct=()=>{},natChips=()=>{},natSfx=()=>{};
    const natStanding=t=>!t.felled,natTake=()=>{},loopsStartHaul=()=>{},FX={dust:()=>{}},survSfx=()=>{},animActValue=()=>0;
    const later=(dt,run)=>jobs.push(run),loopsBring=(realm,good)=>deliveries.push({realm,good});
    function natRemoveLog(tree){tree.log=null}
  ` + read('06_data.js').split('const CLASSES =')[0]
    + '\n' + ['loopsLifeStep','loopsSpawnWorkers'].map(n => declaration(read('08m_loops.js'), n)).join('\n')
    + '\n' + ['NET_NPCS','NET_NPC_MAX','NET_NPC_OUTFITS','netNpcId','netNpcFinite','netNpcBit','netNpcClean','netNpcRowRead','netNpcLook','netNpcMask','netNpcApply','netNpcSnapshot']
      .map(n => declaration(read('14y_netnpcs.js'), n)).join('\n')
    + '\nworldActorDevelop(worker);NET_NPCS.entities.set("town:0:villager:6",worker);', c);
  return { c, run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)) };
}

test('the actual town worker spawner gives every fresh trade worker level1 and individual empty experience', () => {
  const f = fixture(); f.run('loopsSpawnWorkers()');
  assert.deepEqual(f.json('created.map(e=>e.level)'), [1, 1, 1]);
  assert.ok(f.run('created.every(e=>e.growth.base===1&&e.growth.xp===0&&e.growth.kills===0)'));
});

test('woodcutting skill grows only when the actual worker finishes splitting its log', () => {
  const f = fixture();
  f.run(`const tree={kind:'pine',x:0,y:0,z:0,log:{},fall:{ux:1,uz:0}},plan={t:1},st={k:'lchop',tree,ph:'split',at2:100,lx:0,lz:0,mx:0,mz:0,n2:0,next2:0,timber:5};
    for(let i=0;i<3;i++){plan.t=1+i*2;loopsLifeStep(worker,st,plan,.05,()=>{});jobs.shift()()}`);
  assert.equal(f.run('worker.growth.skills?.woodcutting||0'), 0);
  f.run('plan.t=7;loopsLifeStep(worker,st,plan,.05,()=>{});jobs.shift()();plan.t=8;loopsLifeStep(worker,st,plan,.05,()=>{})');
  assert.equal(f.run('worker.growth.skills.woodcutting'), 5);
  assert.equal(f.run('worker.level'), 1); assert.equal(f.run('worker.growth.xp'), 0);
});

test('completed quarry work earns mining once and failed or unfinished work earns none', () => {
  const f = fixture();
  f.run(`const st={k:'lquarry',rock:0,n:0,at:0},plan={t:1};
    for(let i=0;i<5;i++){plan.t=1+i*2;loopsLifeStep(worker,st,plan,.05,()=>{});jobs.shift()()}`);
  assert.equal(f.run('worker.growth.skills?.mining||0'), 0);
  f.run('plan.t=11;loopsLifeStep(worker,st,plan,.05,()=>{});jobs.shift()();plan.t=12;loopsLifeStep(worker,st,plan,.05,()=>{});loopsLifeStep(worker,st,plan,.05,()=>{})');
  assert.equal(f.run('worker.growth.skills.mining'), 1);
  const dead = fixture();
  dead.run(`const st={k:'lquarry',rock:0,n:0,at:0},plan={t:1};loopsLifeStep(worker,st,plan,.05,()=>{});worker.alive=false;jobs.shift()()`);
  assert.equal(dead.run('worker.growth.skills?.mining||0'), 0);
});

test('learned work speed stays bounded and neither idle time nor replica simulation awards practice', () => {
  const f = fixture();
  f.run(`worker.growth.skills={mining:1000};const st={k:'lquarry',rock:0,n:0,at:0},plan={t:10};loopsLifeStep(worker,st,plan,.05,()=>{})`);
  assert.ok(Math.abs(f.run('st.at') - 10.96) < 1e-8);
  assert.equal(f.run('worker.growth.skills.mining'), 1000);
  f.run('keeper=false;st.n=6;loopsLifeStep(worker,st,plan,.05,()=>{})');
  assert.equal(f.run('worker.growth.skills.mining'), 1000);
  assert.equal(f.run('worker.level'), 1); assert.equal(f.run('worker.growth.xp'), 0);
});

test('actual town snapshot, server schema and receiving keeper preserve separate worker skills', () => {
  const f = fixture();
  f.run('worldActorPractice(worker,"woodcutting",25);worldActorPractice(worker,"mining",12)');
  const packed = f.json('netNpcSnapshot()[0]'), canonical = activityNpc(packed);
  assert.ok(canonical); assert.deepEqual(canonical.growth, packed.growth);
  f.c.received = canonical;
  f.run('const row=netNpcRowRead(received);worker.growth={v:1,base:1,xp:0,kills:0,skills:{farming:999}};netNpcApply(worker,row,true)');
  assert.deepEqual(f.json('worker.growth'), packed.growth);
  assert.equal(f.run('worker.level'), 1);
});

test('malformed or unbounded town growth is rejected by the actual client and server parsers', () => {
  const f = fixture(), packed = f.json('netNpcSnapshot()[0]');
  for (const growth of [
    {v:1,base:2,xp:0,kills:0},{v:1,base:1,xp:-1,kills:0},{v:1,base:1,xp:0,kills:1.5},
    {v:1,base:1,xp:0,kills:0,skills:{woodcutting:1e7}},{v:1,base:1,xp:0,kills:0,skills:{forged:2}},
    {v:1,base:1,xp:0,kills:0,extra:1},
  ]) {
    const row = {...packed,growth}; f.c.received = row;
    assert.equal(f.run('netNpcRowRead(received)'), null);
    assert.equal(activityNpc(row), null);
  }
});
