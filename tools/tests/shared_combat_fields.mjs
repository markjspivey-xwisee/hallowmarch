import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/14z_netcombatfields.js', import.meta.url), 'utf8');
function scene(mine = true, peer = 'a') {
  const c = vm.createContext({ console, Math, Number, Map, Set, Object, Array, String, JSON,
    mine, peer, requests: [], sends: [], floorCount: 0, meshCount: 0, damage: 0, heals: 0,
    queueMicrotask: fn => fn(), window: { __hm: {} } });
  vm.runInContext(`
    const GAME={t:100,player:{id:1,role:'player',cls:'mage',level:30,faction:0,x:0,y:0,z:0,alive:true,maxHp:100,hp:100,cs:{dev:100}}};
    const NET={self:peer},NETPARTS={authority:'authority-token',replay:false,applying:false,peer:mine?peer:'a'};
    const ENT=[GAME.player],CLS={arrows:[],stuck:[],snares:[],grounds:[],runes:[],ice:[],steam:[],frozen:new Set()};
    const adapters=new Map(),commands=new Map();
    const NET_BUFFS={root:[1,6],snare:[1,8]},ELEMENTS=['fire','frost','storm'],ARROW_TYPES=['plain','fire'];
    const ARROW_DEF={fire:{good:'arrows_fire'}},ELEM_COL={fire:[1,0,0],frost:[0,0,1],storm:[1,1,1]};
    const DISC_KIND={runecut:1,rune:2,consecrate:3};
    const ABILITIES={snare:{cd:12},consecrate:{cd:16},raise:{cd:20}};
    const getEnt=id=>ENT.find(e=>e.id===id)||null;
    const netEntityFind=id=>id==='peer:'+peer?GAME.player:ENT.find(e=>e.netEntityId===id||'peer:'+e.netPeer===id)||null;
    const netEntityCanSimulateWorld=()=>mine,netEntityOwnPet=()=>false;
    const netWorldPartsActive=()=>true;
    const netWorldPartsRegister=(k,a)=>adapters.set(k,a),netWorldPartsRegisterCommand=(k,s)=>commands.set(k,s);
    function netWorldPartsRequest(op,args){if(mine||NETPARTS.replay)return false;requests.push({op,args});return true}
    const netEntityPlain=x=>x,netEntitySend=(op,args)=>{sends.push({op,...args});return true};
    const dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2,clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),baseDmg=()=>10;
    const csOf=e=>e.cs,devOf=e=>e.cs.dev;
    const clsHas=(e,k)=>k==='snare'?e.cls==='archer'&&e.level>=8:e.cls==='priest'&&e.level>=(k==='raise'?16:5);
    const isWaterAt=()=>true,heightAt=()=>0;
    function addFloorDisc(x,z,r,y){floorCount++;return{x,z,r,y,active:true}}
    function iceSheetMesh(f){meshCount++;f.mesh={}}
    function iceSheetRefresh(){}
    function iceSheetEnd(f){f.dead=true;if(f.floor)f.floor.active=false;CLS.ice=CLS.ice.filter(q=>q!==f)}
    function snareMesh(f){meshCount++;f.mesh={}}
    function snareEnd(f){f.dead=true;CLS.snares=CLS.snares.filter(q=>q!==f)}
    function runeEnd(f){f.dead=true;CLS.runes=CLS.runes.filter(q=>q!==f)}
    function spellDisc(){meshCount++;return {on:true,age:0,dur:30}}
    function steamPuff(){}
    function frostLands(x,z,r,e){freezeWater(x,z,r,e)}
    function freezeWater(x,z,r,e){const f={x,z,r,wy:2,t0:GAME.t,until:GAME.t+26};CLS.ice.push(f);return f}
    function steamAt(x,z,r,e,dur){CLS.steam.push({x,z,r,src:e.id,faction:e.faction,t0:GAME.t,until:GAME.t+dur,tick:0})}
    function fireMeetsIce(x,z,r,e){for(const f of CLS.ice)f.until=GAME.t+2.5}
    function layRune(e,x,z,el){const f={x,z,el,src:e.id,faction:e.faction,level:e.level,t0:GAME.t,armAt:GAME.t+0.8,until:GAME.t+30};CLS.runes.push(f);return f}
    function laySnare(e){CLS.snares.push({x:e.x,y:e.y,z:e.z,owner:e.id,faction:e.faction,level:e.level,yaw:0,t0:GAME.t,armAt:GAME.t+1,until:GAME.t+90,sprung:false})}
    function consecrate(e,A,t,cast,rk){e.cs.dev-=35;CLS.grounds.push({x:e.x,z:e.z,r:6.5,src:e.id,faction:e.faction,realm:e.faction,level:e.level,t0:GAME.t,until:GAME.t+12,tick:0.3,rk,sanct:false})}
    function raiseFallen(){}
    function netOnArrow(){}
    function updateClasses(dt){if(!mine)netCombatFieldsVisual(dt)}
    function npcClassStep(){}
    function dealDamage(src,dst,n){damage+=n;return n}
    function healEnt(src,dst,n){heals+=n}
    function addBuff(e,kind,value,dur,src){e.lastBuff={kind,value,dur,src}}
    function addChill(e,n){e.chill=(e.chill||0)+n}
    function arrowHits(){}
    function stepArrows(){}
    function goodsAdd(){}
  `, c);
  vm.runInContext(source, c);
  return { c, run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)),
    apply(data) { c.input = data; this.run('netCombatFieldsApply(input)'); } };
}

test('ice and rune snapshots produce matching visible geometry and walkable floors without duplicate nodes', () => {
  const a = scene(), b = scene(false, 'b');
  a.run('freezeWater(4,6,5,GAME.player);layRune(GAME.player,1,2,"frost")');
  const snapshot = a.json('netCombatFieldsSave()'); b.apply(snapshot);
  assert.equal(b.run('CLS.ice.length'), 1); assert.equal(b.run('CLS.runes.length'), 1);
  assert.equal(b.run('CLS.ice[0].floor.active'), true);
  assert.equal(b.run('CLS.ice[0].floor.y'), 2.07);
  assert.equal(b.run('CLS.runes[0].el'), 'frost');
  const nodes = b.run('meshCount'); b.apply(snapshot);
  assert.equal(b.run('meshCount'), nodes, 'replayed projections reuse existing scene nodes');
  assert.equal(b.run('floorCount'), 1);
});

test('private caster resources and cooldowns do not enter shared field snapshots', () => {
  const a = scene(); a.run('GAME.player.power=42;GAME.player.cds={meteor:999};GAME.player.cs.dev=88;freezeWater(0,0,4,GAME.player)');
  const serial = a.run('JSON.stringify(netCombatFieldsSave())');
  assert.equal(serial.includes('power'), false); assert.equal(serial.includes('meteor'), false); assert.equal(serial.includes('dev'), false);
});

test('follower field creation goes to the keeper and does not make a private ice sheet', () => {
  const b = scene(false, 'b');
  b.run('freezeWater(4,6,5,GAME.player);layRune(GAME.player,0,0,"fire")');
  assert.equal(b.run('CLS.ice.length'), 0); assert.equal(b.run('CLS.runes.length'), 0);
  assert.deepEqual(b.json('requests.map(r=>r.op)'), ['combat.ice', 'combat.rune']);
});

test('the keeper validates class, reach and per-caster primary cooldown before creating a field', () => {
  const a = scene();
  assert.equal(a.run('commands.get("combat.ice").run({x:0,z:0,r:5}).ok'), true);
  assert.equal(a.run('commands.get("combat.ice").run({x:100,z:0,r:5})'), false);
  a.run('GAME.t+=1;GAME.player.cls="priest"');
  assert.equal(a.run('commands.get("combat.consecrate").run({x:0,z:0,rk:1}).ok'), true);
  assert.equal(a.run('commands.get("combat.consecrate").run({x:0,z:0,rk:1})'), false);
  assert.equal(a.run('CLS.grounds.length'), 1);
  a.run('GAME.t+=1'); assert.equal(a.run('commands.get("combat.rune").run({x:0,z:0,el:"fire"})'), false);
});

test('canonical removal and expiry deactivate ice collision on the other device', () => {
  const a = scene(), b = scene(false, 'b'); a.run('freezeWater(0,0,5,GAME.player)');
  b.apply(a.json('netCombatFieldsSave()')); b.run('const oldFloor=CLS.ice[0].floor;GAME.t+=27;netCombatFieldsVisual(0.1)');
  assert.equal(b.run('oldFloor.active'), false); assert.equal(b.run('CLS.ice.length'), 0);
  b.apply(a.json('netCombatFieldsSave()')); a.run('CLS.ice=[]'); b.apply(a.json('netCombatFieldsSave()'));
  assert.equal(b.run('CLS.ice.length'), 0);
});

test('an oversized or malformed snapshot cannot partially change existing fields', () => {
  const a = scene(), b = scene(false, 'b'); a.run('freezeWater(0,0,5,GAME.player)');
  const valid = a.json('netCombatFieldsSave()'); b.apply(valid);
  const bad = { ...valid, ice: [{ id: 'bad', x: null, z: 0 }] };
  b.apply(bad); assert.equal(b.run('CLS.ice[0].r'), 5);
  b.apply({ ...valid, steam: Array.from({ length: 9 }, (_, i) => ({ id: 's'+i, x: 0, z: 0 })) });
  assert.equal(b.run('CLS.ice.length'), 1);
});

test('arrows become visual previews on the follower while canonical physics is created once by its keeper', () => {
  const b = scene(false, 'b'); b.run('GAME.player.cls="archer";const A={x:0,y:1,z:0,vx:1,vy:0,vz:40,age:0,type:"plain",src:GAME.player.id,faction:0,mult:1,crit:0,wind:1};CLS.arrows.push(A);netOnArrow(A)');
  assert.equal(b.run('A.vis'), true); assert.equal(b.run('A.netFieldPending'), true);
  const request = b.json('requests[0]'); assert.equal(request.op, 'combat.arrow');
  const a = scene(); a.c.args = request.args; a.run('GAME.player.role="remote";GAME.player.netPeer="b";GAME.player.cls="archer"');
  assert.equal(a.run('commands.get("combat.arrow").run(args).ok'), true);
  assert.equal(a.run('CLS.arrows[0].vis'), false); assert.equal(a.run('CLS.arrows[0].src'), 1);
  a.run('GAME.t+=1'); assert.equal(a.run('commands.get("combat.arrow").run(args).ok'), true);
  assert.equal(a.run('CLS.arrows.length'), 1, 'duplicate accepted arrow IDs cannot create a second projectile');
});

test('public hazard effects go to the remote character owner and cosmetic mirrors do not damage it again', () => {
  const a = scene(); a.run('const remote={id:2,role:"remote",netPeer:"b",faction:1};ENT.push(remote);NET_COMBAT_FIELDS.ticking=true;dealDamage(GAME.player,remote,12,{kind:"holy"});NET_COMBAT_FIELDS.ticking=false');
  assert.equal(a.run('damage'), 0); assert.equal(a.run('sends.length'), 1);
  const effect = a.json('sends[0].result'); assert.equal(effect.kind, 'class-effect'); assert.equal(effect.effect, 'damage');
  const b = scene(false, 'b'); b.c.effect = effect; b.run('netCombatFieldResult(effect)');
  assert.equal(b.run('damage'), 12);
});
