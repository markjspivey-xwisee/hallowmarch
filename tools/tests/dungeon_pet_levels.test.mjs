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
  vm.runInContext(`
    const GAME={t:1,player:{level:50},prog:{level:50}},ENT=[],statsLevels=[],FACTION_MONSTER=3,FACTION_NEUTRAL=4,TAU=Math.PI*2;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t,barrowBoost=()=>30;
    const WB=new Proxy({},{get:()=>1}),OUTFIT={skeleton:1},BARROW_STATE={},DUN={spots:{seat:{x:2,z:3,y:-6.2}},gates:{well:{},vault:{}},tombs:[],chests:[]};
    const DEEP={seat:{x:4,z:5,y:-17.4},chests:[],stats:{spawned:0},adds:new Set(),slabs:[]},LATE2={vet:30},MASON={list:[],stats:{spawned:0}};
    const getEnt=id=>ENT.find(e=>e.id===id),deepPitchOut=()=>{},deepSlabMend=()=>{};
    const MOBS={skeleton:{kind:'humanoid',names:['Bones'],radius:.5},gravehound:{kind:'beast',names:['Gravehound'],radius:.5}};
    const BARROW_NAMES={skeleton:['Bones','Wight','Guard','Huscarl']};
    const makeEnt=o=>{const e={id:ENT.length+1,alive:true,power:100,hp:100,maxHp:100,buffs:[],ai:{},...o};ENT.push(e);return e};
    function setupStats(e){statsLevels.push(e.level);e.maxHp=(70+26*e.level)*(e.tweak?.hp||1);e.hp=e.maxHp;e.dmgMult=e.tweak?.dmg||1}
    const dunPoint=(u,v)=>({x:u,z:v,y:-6}),barrowLook=()=>({scale:1,mask:0}),setGate=()=>{};
    const REALMS=[{id:0,town:{x:0,z:0,yaw:0}}],NAMES=[['Worker']],FEMALE=new Set(),pick=(rng,list)=>list[0];
    const villagerLook=()=>({mask:0}),siteToWorld=(s,x,z)=>({x:s.x+x,z:s.z+z}),heightAt=()=>100,floorAt=(x,z,y)=>y,setHouseDoor=()=>{};
    const FX={levelUp:()=>{}},uiToast=()=>{},saveSoon=()=>{},penById=()=>null,wxPrecipAt=()=>0,waterAt=()=>null,WATER_Y=0;
    const anSharedWorldCanSimulate=()=>true,anLook=()=>{},uiLog=()=>{};
    Math.random=()=>.9;
  ` + read('06_data.js').split('const CLASSES =')[0]
    + '\n' + ['spawnBarrowMob','spawnKing'].map(n => declaration(read('08e_barrow.js'), n)).join('\n')
    + '\n' + ['DEEP_LORD','DEEP_LORD_NAME','deepSpawn','deepSpawnLord','deepLordReset'].map(n => declaration(read('10m_deep.js'), n)).join('\n')
    + '\n' + declaration(read('09c_loot.js'), 'initMerchants')
    + '\n' + declaration(read('13v_look3.js'), 'look3MasonSpawn')
    + '\n' + ['AKIND','anGrowth','anAdult','anStats','anPetXp','anClock'].map(n => declaration(read('08h_animals.js'), n)).join('\n'), c);
  return { run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)) };
}

test('actual dungeon mobs and both kings begin at level1 before any season or rescale update', () => {
  const f = fixture();
  f.run(`const warden=spawnBarrowMob('skeleton',19,1,2,null,{hp:3.6,dmg:1.25});
    const hound=deepSpawn('gravehound',47,3,4,null);spawnKing();const lord=deepSpawnLord()`);
  assert.deepEqual(f.json('ENT.map(e=>e.level)'), [1, 1, 1, 1]);
  assert.ok(f.run('statsLevels.every(level=>level===1)'));
  assert.ok(f.run('ENT.every(e=>e.growth.base===1&&e.growth.xp===0)'));
  assert.equal(f.run('warden.tweak.hp'), 3.6); assert.equal(f.run('warden.tweak.dmg'), 1.25);
  assert.equal(f.run('lord.tweak.hp'), f.run('DEEP_LORD.hp'), 'private player veterancy cannot multiply a new boss health');
  assert.deepEqual(f.json('[lord.x,lord.z,lord.y]'), [4, 5, -17.4]);
});

test('restored individual dungeon experience survives development without inheriting a visitor level', () => {
  const f = fixture();
  f.run(`const mob=spawnBarrowMob('skeleton',18,1,2,null);const xp=Array.from({length:6},(_,i)=>xpToNext(i+1)).reduce((a,b)=>a+b,0);
    mob.growth={v:1,base:1,xp,kills:20};worldActorDevelop(mob);GAME.player.level=1;GAME.prog.level=1;worldActorDevelop(mob)`);
  assert.equal(f.run('mob.level'), 7);
  assert.equal(f.run('mob.growth.kills'), 20);
});

test('an existing Deep Lord resets with fixed boss stats while preserving its own earned level and experience', () => {
  const f = fixture();
  f.run(`const lord=deepSpawnLord();lord.growth.xp=Array.from({length:6},(_,i)=>xpToNext(i+1)).reduce((a,b)=>a+b,0);lord.growth.kills=20;
    worldActorDevelop(lord);const earned=JSON.stringify(lord.growth);lord.hp=1;lord.x=100;lord.tweak.hp=99;lord.buffs.push({kind:'burn'});deepLordReset(lord)`);
  assert.equal(f.run('lord.level'), 7);
  assert.equal(f.run('JSON.stringify(lord.growth)'), f.run('earned'));
  assert.equal(f.run('lord.tweak.hp'), f.run('DEEP_LORD.hp'));
  assert.equal(f.run('lord.maxHp'), (70 + 26 * 7) * 3.4);
  assert.equal(f.run('lord.hp'), f.run('lord.maxHp'));
  assert.deepEqual(f.json('[lord.x,lord.z,lord.y]'), [4, 5, -17.4]);
  assert.equal(f.run('lord.buffs.length'), 0);
});

test('actual merchant and scaffold mason spawners also start with individual level1', () => {
  const f = fixture();
  f.run(`initMerchants();const mason=look3MasonSpawn({S:{yaw:0,keepRef:{realm:0}}},{},{y:0,door:{out:{x:0,z:0},out2:{x:0,z:1}}},{ox:1,oz:0,lx:0,lz:0,yawW:0,fx:1,fz:1},0)`);
  assert.deepEqual(f.json('ENT.map(e=>e.level)'), [1, 1]);
  assert.ok(f.run('ENT.every(e=>e.growth.base===1&&e.growth.xp===0)'));
});

const pet = `const rec={k:'hound',name:'Ash',owner:'player',lvl:1,xp:0,age:1000,hunger:.8,thirst:.8,mood:.8,cmd:'follow',sex:'m',tr:{size:1,strength:1,calm:.5,yield:1}},
  hound={id:10,kind:'beast',role:'animal',mobType:'wolf',level:1,alive:true,x:0,y:0,z:0,hp:100,maxHp:100,tame:rec};`;
test('combat pet health and level are independent of its owner level and stay tied to saved bond progress', () => {
  const f = fixture();
  f.run(pet + 'anStats(hound);const high={level:hound.level,hp:hound.maxHp,dmg:hound.dmgMult};GAME.player.level=1;anStats(hound);const low={level:hound.level,hp:hound.maxHp,dmg:hound.dmgMult}');
  assert.deepEqual(f.json('low'), f.json('high'));
  assert.equal(f.run('hound.level'), 1);
  f.run('anPetXp(hound,160);const saved={lvl:rec.lvl,xp:rec.xp};GAME.player.level=50;anClock(hound,.1)');
  assert.equal(f.run('hound.level'), 3);
  assert.deepEqual(f.json('saved'), { lvl: 3, xp: 160 });
  assert.equal(f.run('rec.xp'), 160);
});
