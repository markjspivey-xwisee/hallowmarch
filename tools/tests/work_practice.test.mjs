import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
const cache = new Map();
function source(file) {
  if (!cache.has(file)) { const text = readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8'); cache.set(file, { text, ast: parse(text, { ecmaVersion: 'latest' }) }); }
  return cache.get(file);
}
function select(file, predicate) {
  const { text, ast } = source(file); let found;
  function visit(node) { if (!node || typeof node !== 'object' || found) return; if (predicate(node)) { found = node; return; } for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); }
  visit(ast); assert.ok(found, file); return text.slice(found.start, found.end);
}
const declaration = (file, name) => select(file, n => n.type === 'FunctionDeclaration' && n.id.name === name || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
function fixture() {
  const saves = new Map(), inventory = new Map();
  const c = vm.createContext({ Math: Object.create(Math), Number, Object, Map, Set, Array,
    registerSavePart: (scope, key, value) => saves.set(key, value), clamp: (v,a,b) => Math.max(a,Math.min(b,v)),
    GAME: { t: 10, player: { id: 1, role: 'player', alive: true, x: 0, y: 0, z: 0, yaw: 0 } },
    UI: { modal: null }, NATURE: { job: null, piles: [] }, NETPARTS: { replay: false, skills: [] },
    uiToast() {}, sfx() {}, saveSoon() {}, needsCheck() {}, uiLog() {}, uiError() {}, activityRecord() {},
    goodName: id => id, goodsHave: () => true, goodsAdd: (id,n) => { inventory.set(id,(inventory.get(id)||0)+n); return n; },
    goodsTake: () => true, goodsCount: () => 1, netWorldPartsRequest: () => false,
    setAct() {}, dismount() {}, survSfx() {}, sampleGrid: () => 0, heightAt: () => 0, WB: { axe: 1 },
    W: { rocks: [{ x: 1, z: 0, y: 0, s: 1 }], trees: [] }, CRAFT: { rocks: new Map() },
    FX: { dust() {}, burst() {} }, fxAlpha: { emit() {} }, dist: (x,z,a,b) => Math.hypot(x-a,z-b),
    reportError: e => { throw e; }, renderCraft() {}, slots: {},
  });
  c.Math.random = () => .5;
  vm.runInContext(['SURV','NEEDS','SKILL_NAMES','SKILL_RANKS','skillRank','skillGain','skillWorkRate'].map(n => declaration('06s_survival.js',n)).join('\n'), c);
  vm.runInContext(select('06s_survival.js', n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && n.expression.callee.name === 'registerSavePart'), c);
  return { c, saves, inventory, run: code => vm.runInContext(code,c), install: (file,names) => vm.runInContext(names.map(n=>declaration(file,n)).join('\n'),c) };
}

test('practice improves only the used skill, remains bounded and survives the existing character save', () => {
  const f=fixture(); f.run(`skillGain('mining',1);skillGain('woodcutting',1);skillGain('farming',1)`);
  assert.equal(f.run('SURV.skill.craft'),0); assert.equal(f.run('SURV.skill.mining'),1.5);
  const saved=f.saves.get('surv').save(); f.run('SURV.skill.mining=99'); f.saves.get('surv').load(saved);
  assert.equal(f.run('SURV.skill.mining'),1.5);
  f.saves.get('surv').load({sk:{craft:32,cook:12,fish:7,forage:9,mining:1e9,farming:-8}});
  assert.equal(f.run('SURV.skill.craft'),32); assert.equal(f.run('SURV.skill.mining'),100);
  assert.equal(f.run('SURV.skill.farming'),0); assert.equal(f.run('SURV.skill.woodcutting'),0);
  for(const code of ["skillGain('unknown',1)","skillGain('mining',NaN)","skillGain('mining',-1)","skillGain('mining',Infinity)"]) assert.equal(f.run(code),0);
  assert.equal(f.run('Object.hasOwn(SURV.skill,"unknown")'),false);
});

test('private work rate has a25% maximum and never borrows keeper skill for remote command replay', () => {
  const f=fixture(); assert.equal(f.run('skillWorkRate("mining")'),1);
  f.run('SURV.skill.mining=100'); assert.equal(f.run('skillWorkRate("mining")'),1.25);
  f.run('NETPARTS.replay=true'); assert.equal(f.run('skillWorkRate("mining")'),1);
  f.run('NETPARTS.replay=false;GAME.player.role="remote"'); assert.equal(f.run('skillWorkRate("mining")'),1);
});

test('actual mining speeds up through mining practice and earns nothing for blocked or empty attempts', () => {
  const f=fixture(); f.install('09t_craft.js',['mineStart','mineYield']);
  f.c.survStartJob=job=>{f.c.job=job;};
  f.run('mineStart(0)'); assert.equal(f.c.job.dur,.95);
  assert.equal(f.run('SURV.skill.mining'),0,'starting work is not a completed yield');
  f.run('SURV.skill.mining=100;mineStart(0)'); assert.equal(f.c.job.dur,.95/1.25);
  f.run('SURV.skill.mining=0;mineYield(0,true)'); assert.ok(Math.abs(f.run('SURV.skill.mining')-.45)<1e-10);
  const before=f.run('SURV.skill.mining');
  assert.equal(f.run('SURV.skill.craft'),0);
  f.c.goodsAdd=()=>0; f.run('mineYield(0,true)'); assert.equal(f.run('SURV.skill.mining'),before);
  f.c.netWorldPartsRequest=()=>true; f.run('mineYield(0,true)'); assert.equal(f.run('SURV.skill.mining'),before);
  f.c.netWorldPartsRequest=()=>false; f.c.goodsHave=()=>false;
  assert.equal(f.run('mineYield(0,true)'),false); assert.equal(f.run('SURV.skill.mining'),before);
});

test('actual split rewards teach woodcutting only when useful goods were received', () => {
  const f=fixture();f.install('09s_survival.js',['natSplitGoods']);
  f.run('natSplitGoods({kind:"oak"})'); assert.ok(f.run('SURV.skill.woodcutting')>.89);
  const before=f.run('SURV.skill.woodcutting');f.c.goodsAdd=()=>0;f.run('natSplitGoods({kind:"oak"})');
  assert.equal(f.run('SURV.skill.woodcutting'),before);
});

test('real wood and mining jobs preserve a minimum work time and cancellation grants no practice', () => {
  const f=fixture(); f.install('05h_nature.js',['stepJob','natureStopJob']);
  f.run('SURV.skill.woodcutting=100;NATURE.job={kind:"chop",tree:{felled:false},t:0,next:99,hitAt:0,px:0,pz:0,yaw:0};stepJob(.4)');
  assert.equal(f.run('NATURE.job.t'),.5,'master practice speeds a real wood timer by25%, without completing it');
  f.run('GAME.player.x=1;stepJob(.1)');assert.equal(f.run('NATURE.job'),null);
  assert.equal(f.run('SURV.skill.woodcutting'),100);
  f.run('GAME.player.x=0');f.install('09s_survival.js',['survStartJob','stepSurvJob','survStopJob']);f.install('09t_craft.js',['mineStart','mineYield']);
  f.run('mineStart(0);stepSurvJob(.94)');assert.equal(f.run('SURV.job.i'),0);assert.equal(f.run('SURV.skill.mining'),0);
  f.run('stepSurvJob(.02)');assert.equal(f.run('SURV.job.i'),1);assert.equal(f.run('SURV.skill.mining'),0,'one swing is not a finished mining yield');
  f.run('GAME.player.x=1;stepSurvJob(.1)');assert.equal(f.run('SURV.job'),null);assert.equal(f.run('SURV.skill.mining'),0);
});

test('actual player farming work is faster with practice and no-op or refused work earns nothing', () => {
  const f=fixture();f.install('08h_farming.js',['FARM_JOBS','farmStartJob','farmFinishJob']);
  Object.assign(f.c,{FARM:{job:null,drawDirty:false},natureStopJob(){},farmSow:()=>0,farmStrainOfGood:()=>null,GOODS:{seed:{name:'seed'}},farmTillSpot:()=>({why:'blocked'})});
  f.run('farmStartJob("weed",{plot:{weeds:0}})');assert.equal(f.run('FARM.job.workRate'),1);
  f.run('SURV.skill.farming=100;farmStartJob("weed",{plot:{weeds:0}})');assert.equal(f.run('FARM.job.workRate'),1.25);
  f.run('SURV.skill.farming=0;farmFinishJob("weed",{plot:{weeds:0}});farmFinishJob("sow",{plot:{},gid:"seed"});farmFinishJob("till",{})');
  assert.equal(f.run('SURV.skill.farming'),0);
  f.run('farmFinishJob("weed",{plot:{weeds:.5}})');assert.ok(f.run('SURV.skill.farming')>0);
  const before=f.run('SURV.skill.farming');f.c.netWorldPartsRequest=()=>true;
  f.run('farmFinishJob("weed",{plot:{weeds:.5}})');assert.equal(f.run('SURV.skill.farming'),before);
});

test('actual farming timer finishes useful work faster while retaining all required swings', () => {
  const times=[];
  for(const skill of [0,100]) {
    const f=fixture(); f.install('08h_farming.js',['FARM_JOBS','farmStartJob','stepFarmJob','farmStopJob','farmFinishJob']);
    Object.assign(f.c,{FARM:{job:null,drawDirty:false},natureStopJob(){},farmWorkFx(){},FARM_CROPS:{}});
    f.c.skill=skill;f.run('SURV.skill.farming=skill;farmStartJob("weed",{plot:{weeds:.5}})');
    const needed=f.run('FARM.job.need');let elapsed=0;
    while(f.run('!!FARM.job')&&elapsed<10){f.run('stepFarmJob(.01)');elapsed+=.01;}
    assert.equal(needed,4);assert.equal(f.run('FARM.job'),null);times.push(elapsed);
  }
  assert.ok(times[1]<times[0]*.85&&times[1]>times[0]*.75,JSON.stringify(times));
});

test('an actual NPC farmer learns only on task completion and its own farming practice improves work', () => {
  const f=fixture();
  f.install('06_data.js',['LEVEL_CAP','xpToNext','worldActorGrowthRead','worldActorCanDevelop','worldActorGrowthLevel','worldActorDevelop','worldActorPractice','worldActorWorkRate']);
  f.install('08h_farming.js',['farmLifeStep']);
  Object.assign(f.c,{houseWantsShut:()=>false,farmFront:()=>({x:0,z:0}),plotWorld:()=>({x:0,z:0}),turnToward(){},
    FARM_TASK_ACT:{weed:5},later(){},farmTaskSwings:()=>12,FARM:{drawDirty:false},farmTownDone:p=>{p.stand.task=null;p.weeds=0;},netEntityCanSimulateWorld:()=>true});
  f.run(`const farmer={id:8,kind:'humanoid',role:'villager',alive:true,level:1,x:0,y:0,z:0,yaw:0};
    const plot={weeds:.5,hw:1,hd:1,stand:{worker:8,task:'weed',p:0}},step={P:plot},plan={t:10};let complete=0;
    farmLifeStep(farmer,step,plan,.05,()=>complete++);`);
  assert.equal(f.run('farmer.growth'),undefined,'partial progress is not a completed task');
  f.run('plot.stand.p=.99;plan.t=20;farmLifeStep(farmer,step,plan,.05,()=>complete++)');
  assert.equal(f.run('farmer.growth.skills.farming'),1);assert.equal(f.run('farmer.growth.xp'),0);assert.equal(f.run('farmer.level'),1);
  f.run('farmer.growth.skills.farming=100;plot.stand.task="weed";plot.stand.p=0;plot.weeds=.5;plan.t=30;farmLifeStep(farmer,step,plan,.05,()=>complete++)');
  assert.ok(Math.abs(f.run('plot.stand.p')-1.25/12)<1e-10);
  assert.equal(f.run('SURV.skill.farming'),0,'NPC work never trains the keeper character');
});

test('canonical wood completion returns practice in its receipt; refused and duplicate receipts grant none', () => {
  const f=fixture(); let spec;
  f.c.netWorldPartsRegisterCommand=(key,value)=>{spec=value;};
  f.c.fellTree=t=>{t.felled=true;};f.c.W.trees.push({id:0,x:0,z:0,felled:false});
  const call=select('14z_networldparts.js',n=>n.type==='CallExpression'&&n.callee.name==='netWorldPartsRegisterCommand'&&n.arguments[0]?.value==='nature.job');
  vm.runInContext('const rawSkill=skillGain;'+select('14z_networldparts.js',n=>n.type==='AssignmentExpression'&&n.left.name==='skillGain')+';'+call,f.c);
  f.run('NETPARTS.replay=true');assert.equal(spec.run({kind:'chop',id:0}).ok,true);
  assert.equal(f.run('SURV.skill.woodcutting'),0);assert.equal(f.run('NETPARTS.skills.length'),1);
  assert.equal(spec.run({kind:'chop',id:0}),false);assert.equal(f.run('NETPARTS.skills.length'),1);
  const skills=JSON.parse(f.run('JSON.stringify(NETPARTS.skills)'));
  Object.assign(f.c,{netWorldPartsOwnerScope:()=>true,netWorldPartsOutcomeFits:()=>true,netWorldPartsBindOwner:x=>x,
    netWorldPartsSendSettled(){},GOODS:{},GOODS_UI:{},NETPART_RESULTS:new Map(),NETPART_FAILURES:new Map(),addGold(){},bagAdd(){},loreNote(){}});
  f.run('NETPARTS.replay=false;NETPARTS.pending=new Map();NETPARTS.settled=new Map()');f.install('14z_networldparts.js',['netWorldPartsResult']);
  for(const ok of [false,true]) {
    const id=String(ok);f.c.receipt={id,ownerAccount:'owner',ok,skills};
    f.run('NETPARTS.pending.set(receipt.id,{ownerAccount:"owner",cost:[],durable:false});netWorldPartsResult(receipt)');
    assert.equal(f.run('SURV.skill.woodcutting'),ok?.75:0);
    f.run('netWorldPartsResult(receipt)');assert.equal(f.run('SURV.skill.woodcutting'),ok?.75:0);
  }
});
