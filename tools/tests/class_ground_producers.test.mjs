import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const entities = readFileSync(new URL('../../src/07_entities.js', import.meta.url), 'utf8');
const classes = readFileSync(new URL('../../src/07b_classes.js', import.meta.url), 'utf8');
const fields = readFileSync(new URL('../../src/14z_netcombatfields.js', import.meta.url), 'utf8');
const networkEntities = readFileSync(new URL('../../src/14x_netentities.js', import.meta.url), 'utf8');
const data = readFileSync(new URL('../../src/06_data.js', import.meta.url), 'utf8');
function declaration(source, name) {
  const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n =>
    n.type === 'FunctionDeclaration' && n.id.name === name
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}
function fixture(network = true, realDamage = false) {
  const c = vm.createContext({ console, Math: Object.create(Math), Map, Set });
  vm.runInContext(`
    const GAME={t:1,player:null},ENT=[],CLS={grounds:[],runes:[],steam:[],ice:[],frozen:new Set(),raiseScanT:Infinity,stats:{consecrated:0,runes:0,steam:0}};
    const NETPARTS={authority:'first-keeper'},FACTION_NEUTRAL=4,DISC_KIND={shock:3},ELEM_COL={fire:[1,0,0],frost:[0,0,1]};
    const camera={position:{x:1000,z:1000}},effects=[],followups=[],queue=[];
    const dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2;
    const getEnt=id=>ENT.find(e=>e.id===id)||null,isActor=e=>e.kind!=='door',isUndead=e=>!!e.undead,lordTurnsLight=()=>false;
    let computeDamage=(src,dst,m)=>({d:10*m,crit:false});
    function record(effect,dst,extra={}){effects.push({effect,id:dst.id,...extra,area:NET_COMBAT_FIELDS.area?{...NET_COMBAT_FIELDS.area}:null})}
    function dealDamage(src,dst,d){record('damage',dst,{d,source:{id:src.id,role:src.role,kind:src.kind,level:src.level,dmgMult:src.dmgMult,x:src.x}})}
    function healEnt(src,dst,d){record('heal',dst,{d})}
    function addBuff(dst,kind){record('buff',dst,{kind})}
    const hallowDazzle=()=>{},raiseOfferStep=()=>{},stepDazzle=()=>{},stepArrows=()=>{},stepSnares=()=>{},heightAt=()=>0;
    const FX={burst:()=>{}},spellDisc=()=>null,lightFlash=()=>{},rankMult=()=>1,fireLandsAt=()=>{},classSfx=()=>{},steamPuff=()=>{},wxLive=()=>false,WEATHER={snowing:0},sunStrength=()=>1;
    const netWorldPartsActive=()=>true,netEntityCanSimulateWorld=()=>true,frostRootExtra=()=>null;
    const clsHas=()=>true,attOf=()=>0,mageRankK=()=>1,realmFlavour=()=>true,attune=()=>{};
    const csOf=e=>e.cs||{},devOf=()=>100,sanctified=()=>false,setAct=()=>{},sfxAtE=()=>{},spellPillar=()=>{};
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),REALM_BONUS=[1,1,1],buffSum=()=>0,ladderWeak=()=>1;
    const ELEM_OF={blizzard:'frost',frost:'frost',meteor:'fire',firebolt:'fire'};
    function later(dt,run){queue.push({dt,run})}
    function frostLands(x,z,r){followups.push({kind:'frost',x,z,r})}
    function layRune(e,x,z,el){followups.push({kind:'rune',x,z,el})}
    function fireMeetsIce(x,z,r){followups.push({kind:'fire',x,z,r})}
  ` + ['netEntitySourceStamp', 'netEntitySourceRead'].map(n => declaration(networkEntities, n)).join('\n')
    + '\n' + declaration(fields, 'NET_COMBAT_FIELDS') + '\nNET_COMBAT_FIELDS.ticking=true;\n'
    + (network ? ['netCombatFieldsActive', 'netCombatFieldId', 'netCombatFieldAreaRun'].map(n => declaration(fields, n)).join('\n') : '')
    + '\n' + entities.slice(entities.indexOf('const SGRID ='), entities.indexOf('\nfunction isEnemy('))
    + '\n' + declaration(entities, 'abilityGroundPoint')
    + '\n' + ['classFieldAreaRun', 'classFieldSource', 'stepGrounds', 'runeEnd', 'runeBurst', 'updateClasses', 'mageView'].map(n => declaration(classes, n)).join('\n')
    + (realDamage ? '\n' + declaration(data, 'baseDmg')
      + '\ncomputeDamage=' + declaration(entities, 'computeDamage') + ';\nMath.random=()=>.5;\n'
      + ['consecrate', 'layRune', 'steamAt'].map(n => declaration(classes, n)).join('\n') : ''), c);
  return { run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)) };
}
const actors = `ENT.push({id:1,faction:0,level:30,alive:true,x:100,z:100},
  {id:2,kind:'humanoid',faction:1,alive:true,x:6.4,z:0,maxHp:100,undead:true},
  {id:3,kind:'humanoid',faction:0,alive:true,x:1,z:0,maxHp:100});rebuildGrid();`;
const ground = `{x:0,z:0,r:6.5,src:1,faction:0,realm:0,level:30,rk:1,until:12,tick:0,netFieldId:'ground:stable'}`;

test('actual holy-ground producer stamps damage, healing and buffs with one precise field and restores context', () => {
  const f = fixture();
  f.run(actors + `CLS.grounds.push(${ground});stepGrounds(.05)`);
  assert.deepEqual(f.json('effects.map(e=>e.effect).sort()'), ['buff', 'buff', 'damage', 'heal']);
  assert.deepEqual(f.json('effects.filter(e=>e.effect==="buff").map(e=>e.kind).sort()'), ['hallowed', 'snare']);
  const area = { v: 1, kind: 'grounds', id: 'ground:stable', x: 0, z: 0, r: 6.5 };
  for (const effect of f.json('effects')) assert.deepEqual(effect.area, area);
  assert.equal(f.run('NET_COMBAT_FIELDS.area'), null);
  f.run(`NETPARTS.authority='next-keeper';CLS.grounds[0].tick=0;stepGrounds(.05);dealDamage(ENT[0],ENT[1],1)`);
  assert.deepEqual(f.json('effects[4].area'), area, 'a keeper change preserves the existing field identity');
  assert.equal(f.run('effects.at(-1).area'), null, 'ordinary damage outside the producer does not inherit a ground shape');
});

test('holy ground checks current positions and expiry, and a delayed step never catches up repeated ticks', () => {
  const f = fixture();
  f.run(actors + `CLS.grounds.push(${ground});stepGrounds(.05)`);
  assert.equal(f.run('effects.filter(e=>e.effect==="damage").length'), 1);
  f.run('ENT[1].x=6.6;CLS.grounds[0].tick=0;stepGrounds(.05)');
  assert.equal(f.run('effects.filter(e=>e.effect==="damage").length'), 1, 'moving outside is safe even before the grid is rebuilt');
  f.run('ENT[1].x=0;CLS.grounds[0].tick=-20;stepGrounds(5)');
  assert.equal(f.run('effects.filter(e=>e.effect==="damage").length'), 2, 'only one tick occurs during a delayed update');
  f.run('GAME.t=12.01;stepGrounds(20)');
  assert.equal(f.run('effects.filter(e=>e.effect==="damage").length'), 2);
  assert.equal(f.run('CLS.grounds.length'), 0);
});

test('actual steam producer stamps its scald and blind, and stops after escape or expiry', () => {
  const f = fixture();
  f.run(actors + `CLS.steam.push({x:0,z:0,r:4,src:1,faction:0,until:5,tick:0,netFieldId:'steam:stable'});ENT[1].x=3.9;updateClasses(.05)`);
  assert.deepEqual(f.json('effects.map(e=>e.effect)'), ['buff', 'damage']);
  for (const effect of f.json('effects')) assert.deepEqual(effect.area,
    { v: 1, kind: 'steam', id: 'steam:stable', x: 0, z: 0, r: 4 });
  f.run('ENT[1].x=4.1;CLS.steam[0].tick=0;updateClasses(.05)');
  assert.equal(f.run('effects.length'), 2);
  f.run('ENT[1].x=0;GAME.t=5.01;updateClasses(20)');
  assert.equal(f.run('effects.length'), 2);
  assert.equal(f.run('CLS.steam.length'), 0);
  assert.equal(f.run('NET_COMBAT_FIELDS.area'), null);
});

test('actual rune burst stamps the blast radius and root while excluding escaped and expired targets', () => {
  const f = fixture();
  f.run(actors + `ENT[1].x=4.99;const R={x:0,z:0,src:1,faction:0,level:30,el:'frost',armAt:0,until:30,netFieldId:'rune:stable'};CLS.runes.push(R);runeBurst(R)`);
  assert.deepEqual(f.json('effects.map(e=>e.effect)'), ['damage', 'buff']);
  for (const effect of f.json('effects')) assert.deepEqual(effect.area,
    { v: 1, kind: 'runes', id: 'rune:stable', x: 0, z: 0, r: 5 });
  f.run(`effects.length=0;ENT[1].x=5.01;const outside={...R,dead:false};CLS.runes.push(outside);runeBurst(outside)`);
  assert.equal(f.run('effects.length'), 0);
  f.run(`ENT[1].x=0;GAME.t=31;CLS.runes.push({...R,dead:false});updateClasses(.05)`);
  assert.equal(f.run('effects.length'), 0);
  assert.equal(f.run('CLS.runes.length'), 0);
});

test('producer scope restores after a failed effect and standalone local play needs no network helper', () => {
  const f = fixture();
  f.run(`const prior={kind:'outer'};NET_COMBAT_FIELDS.area=prior`);
  assert.throws(() => f.run(`classFieldAreaRun('grounds',${ground},6.5,()=>{throw Error('effect failed')})`), /effect failed/);
  assert.equal(f.run('NET_COMBAT_FIELDS.area===prior'), true);
  const local = fixture(false);
  local.run(actors + `CLS.grounds.push(${ground});stepGrounds(.05)`);
  assert.equal(local.run('effects.filter(e=>e.effect==="damage").length'), 1);
  assert.equal(local.run('effects.every(e=>e.area===null)'), true);
});

for (const kind of ['grounds', 'runes']) test(`${kind} remembers an ordinary soldier at creation and retains its actual damage scaling after removal`, () => {
  const f = fixture(true, true);
  f.run(`const soldier={id:1,name:'March soldier',kind:'humanoid',role:'soldier',cls:${kind === 'grounds' ? "'priest'" : "'mage'"},level:50,faction:2,alive:true,x:0,z:0,dmgMult:1};
    const recruit={id:2,kind:'humanoid',role:'remote',level:1,faction:0,alive:true,x:0,z:0,maxHp:137};
    ENT.push(soldier,recruit);rebuildGrid();
    ${kind === 'grounds' ? 'consecrate(soldier,null,null,null,1)' : "layRune(soldier,0,0,'fire')"}`);
  assert.equal(f.run(`CLS.${kind}[0].netFieldActor.role`), 'soldier', 'identity is captured before the first tick or snapshot');
  f.run(`const field=CLS.${kind}[0];ENT.splice(ENT.indexOf(soldier),1);rebuildGrid();
    ${kind === 'grounds' ? 'field.tick=0;stepGrounds(.05)' : 'runeBurst(field)'}`);
  const hit = f.json('effects.find(e=>e.effect==="damage")');
  const multiplier = kind === 'grounds' ? .85 * .3 : 1.3;
  assert.ok(Math.abs(hit.d - 156 * 1.7 * multiplier) < 1e-8, `removed soldier damage ${hit.d} must retain its actual level50`);
  assert.equal(hit.source.role, 'soldier'); assert.equal(hit.source.kind, 'humanoid');
  assert.equal(hit.source.level, 50, 'the remembered actual level remains unchanged');
  assert.equal(hit.source.id, 1);
  assert.equal(hit.source.dmgMult, kind === 'grounds' ? .85 : 1, 'the original removed-caster multiplier is preserved');
  assert.equal(hit.source.x, kind === 'grounds' ? undefined : 0, 'remembered network defaults cannot change the original source position');
});

test('malformed remembered identity cannot replace the original local fallback source', () => {
  const f = fixture();
  assert.equal(f.run(`classFieldSource({netFieldActor:{name:'bad',kind:'humanoid',role:'soldier',level:50,faction:99}}, {role:'none'}).role`), 'none');
});

test('steam remembers its creator before immediate removal while blind persists and scald stops', () => {
  const f = fixture(true, true);
  f.run(`const soldier={id:1,name:'March soldier',kind:'humanoid',role:'soldier',cls:'mage',level:30,faction:2,alive:true,x:100,z:100};
    ENT.push(soldier,{id:2,kind:'humanoid',role:'remote',level:1,faction:0,alive:true,x:0,z:0});
    steamAt(0,0,4,soldier);const identity=CLS.steam[0].netFieldActor;ENT.shift();rebuildGrid();updateClasses(.05)`);
  assert.equal(f.run('identity.role'), 'soldier');
  assert.equal(f.run('identity.level'), 30);
  assert.equal(f.run('CLS.steam[0].netFieldActor===identity'), true);
  assert.deepEqual(f.json('effects.map(e=>[e.effect,e.kind])'), [['buff', 'blind']]);
});

for (const [id, expected] of [
  ['blizzard', [{ kind: 'frost', x: 2, z: 3, r: 8 }, { kind: 'rune', x: 2, z: 3, el: 'frost' }]],
  ['meteor', [{ kind: 'fire', x: 2, z: 3, r: 7 }]],
  ['frost', [{ kind: 'frost', x: 20, z: 30, r: 3.5 }]],
  ['firebolt', [{ kind: 'fire', x: 20, z: 30, r: 1.5 }]],
]) test(`${id} followups use the committed ground point only for ground abilities`, () => {
  const f = fixture();
  f.run(`const caster={id:1,faction:2,power:100},target={x:20,z:30},cs={focus:'fire',att:{fire:0,frost:0}};
    mageView(caster,cs,{id:${JSON.stringify(id)},ground:${id === 'blizzard' || id === 'meteor'},cost:1,dmg:1,radius:7,ticks:6},target,{gx:2,gz:3});
    target.x=100;target.z=100;for(const q of queue)q.run()`);
  assert.deepEqual(f.json('followups'), expected);
});
