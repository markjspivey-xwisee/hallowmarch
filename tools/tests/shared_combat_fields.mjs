import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = readFileSync(new URL('../../src/14z_netcombatfields.js', import.meta.url), 'utf8');
function scene(mine = true, peer = 'a') {
  const c = vm.createContext({ console, Math, Number, Map, Set, Object, Array, String, JSON,
    mine, peer, requests: [], sends: [], floorCount: 0, meshCount: 0, damage: 0, heals: 0, floors: [], arrowSources: [], stepVisits: [],
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
    function addFloorDisc(x,z,r,y){floorCount++;const f={x,z,r,y,ya:y,active:true};floors.push(f);return f}
    function bFloorRemove(f){f.active=false;const i=floors.indexOf(f);if(i>=0)floors.splice(i,1)}
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
    function arrowHits(A,target,src){arrowSources.push(src)}
    function stepArrows(){stepVisits.push(CLS.arrows.map(a=>({id:a.netFieldId,vis:a.vis}))) }
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

test('ephemeral follower fields dispatch through the actual world transport without a private save', () => {
  const b = scene(false, 'b');
  const world = readFileSync(new URL('../../src/14z_networldparts.js', import.meta.url), 'utf8');
  const ast = parse(world, { ecmaVersion: 'latest', sourceType: 'module' });
  const clone = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'netPartsClone'));
  assert.ok(clone, 'netPartsClone');
  const names = ['netWorldPartsOwnerScope', 'netWorldPartsBindOwner', 'netWorldPartsRequest', 'netWorldPartsDispatch'];
  const actual = names.map(name => {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
    assert.ok(node, name); return world.slice(node.start, node.end);
  }).join('\n');
  vm.runInContext(`
    const NETPART_COMMANDS=commands,NETWS={acct:{id:'owner-b'}},SAVE={ref:{},wiping:false};
    const INV={bag:[]},GOODS={},dispatches=[];let privateWrites=0;
    const netWorldPartsCanSimulate=()=>false,netWorldPartsConnected=()=>true;
    const goodsHave=()=>false,goodsTakeAll=cost=>cost.length===0;
    const crypto={randomUUID:()=>String(NETPARTS.next)},performance={now:()=>1000};
    const netWsSend=packet=>{dispatches.push(packet);return true};
    const netWorldPartsFlushJournal=()=>{privateWrites++;return Promise.resolve(true)};
    const uiError=message=>{throw Error(message)};
    Object.assign(NETPARTS,{ready:true,pending:new Map(),receipts:[],next:0,admission:{origin:'world',epoch:1}});
  ` + world.slice(clone.start, clone.end) + '\n' + actual, b.c);
  b.run('GAME.player.power=42;GAME.player.cds={rune:123};layRune(GAME.player,1,2,"frost");GAME.player.cls="priest";consecrate(GAME.player,null,null,null,1)');
  assert.deepEqual(b.json('dispatches.map(m=>m.command.op)'), ['combat.rune', 'combat.consecrate']);
  assert.equal(b.run('privateWrites'), 0);
  assert.equal(b.run('[...NETPARTS.pending.values()].every(p=>p.durable===false&&p.privateConfirmed)'), true);
  assert.equal(b.run('GAME.player.cs.dev'), 65, 'the owner pays devotion once locally');
  assert.equal(b.run('GAME.player.power'), 42); assert.equal(b.run('GAME.player.cds.rune'), 123);
  assert.equal(b.run('CLS.runes.length+CLS.grounds.length'), 0, 'the follower waits for the canonical field');
  assert.equal(b.run('commands.get("combat.arrow").durable'), false);
  assert.equal(b.run('commands.get("combat.arrow-recover").durable!==false'), true, 'recovering an inventory arrow keeps its durable receipt');
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

test('canonical ice growth replaces its spatial floor once and removes it on expiry', () => {
  const a = scene(), b = scene(false, 'b');
  a.run('freezeWater(4,6,3,GAME.player)');
  b.apply(a.json('netCombatFieldsSave()'));
  b.run('const firstFloor=CLS.ice[0].floor');
  a.run('CLS.ice[0].r=8;CLS.ice[0].wy=4');
  const grown = a.json('netCombatFieldsSave()'); b.apply(grown);
  assert.equal(b.run('firstFloor.active'), false);
  assert.equal(b.run('floors.length'), 1);
  assert.equal(b.run('CLS.ice[0].floor.r'), 8);
  assert.equal(b.run('CLS.ice[0].floor.ya'), 4.07);
  b.apply(grown);
  assert.equal(b.run('floorCount'), 2, 'unchanged canonical replay reuses its physical floor');
  b.run('GAME.t+=27;netCombatFieldsVisual(0.1)');
  assert.equal(b.run('floors.length'), 0);
  assert.equal(b.run('CLS.ice.length'), 0);
});

test('missing lifetimes and malformed effect geometry cannot alter any projected field', () => {
  const a = scene(), b = scene(false, 'b');
  a.run('freezeWater(0,0,5,GAME.player);layRune(GAME.player,0,0,"frost")');
  const valid = a.json('netCombatFieldsSave()'); b.apply(valid);
  for (const change of [
    f => { delete f.ice[0].life; },
    f => { f.ice[0].r=0; },
    f => { f.ice[0].r=26; },
    f => { delete f.ice[0].wy; },
    f => { f.runes[0].el='unsupported'; },
    f => { f.runes[0].el={bad:true}; },
    f => { f.ice[0].r={bad:true}; },
  ]) {
    const bad = JSON.parse(JSON.stringify(valid)); change(bad);
    const before = b.run('JSON.stringify(netCombatFieldsSave())'), floors = b.run('floorCount');
    b.apply(bad);
    assert.equal(b.run('JSON.stringify(netCombatFieldsSave())'), before);
    assert.equal(b.run('floorCount'), floors);
  }
});

test('arrow scaling and full draw survive a departed caster without using the keeper character', () => {
  const a = scene(), b = scene(false, 'b');
  a.run('GAME.player.cls="archer";GAME.player.level=12;GAME.player.dmgMult=1.4;const A={x:0,y:1,z:0,vx:1,vy:0,vz:40,age:0,k:1,type:"plain",src:GAME.player.id,faction:0,mult:1,crit:0,wind:1};CLS.arrows.push(A)');
  const frame = a.json('netCombatFieldsSave()');
  assert.equal(frame.arrows[0].level, 12); assert.equal(frame.arrows[0].dmgMult, 1.4); assert.equal(frame.arrows[0].k, 1);
  b.apply(frame);
  b.run('arrowHits(CLS.arrows[0],{},null)');
  assert.equal(b.run('arrowSources[0].level'), 12);
  assert.equal(b.run('arrowSources[0].dmgMult'), 1.4);
  assert.equal(b.run('GAME.player.level'), 30);
  assert.equal(b.run('GAME.player.cs.dev'), 100);
});

test('an admitted arrow takes scaling from the actual remote actor rather than its packet', () => {
  const b = scene(false, 'b');
  b.run('GAME.player.cls="archer";const A={x:0,y:1,z:0,vx:0,vy:0,vz:40,age:0,k:1,type:"plain",src:GAME.player.id,faction:0,mult:1,crit:0,wind:1};CLS.arrows.push(A);netOnArrow(A)');
  const request = b.json('requests[0]'); request.args.row.level=9999; request.args.row.dmgMult=9999;
  const a = scene(); a.c.args = request.args;
  a.run('GAME.player.role="remote";GAME.player.netPeer="b";GAME.player.cls="archer";GAME.player.level=17;GAME.player.dmgMult=1.25');
  assert.equal(a.run('commands.get("combat.arrow").run(args).ok'), true);
  assert.equal(a.run('CLS.arrows[0].level'), 17);
  assert.equal(a.run('CLS.arrows[0].dmgMult'), 1.25);
});

test('arrow physics follows shared keeper authority and local pending arrows remain cosmetic', () => {
  const a = scene(), b = scene(false, 'b');
  a.run('const A={x:0,y:1,z:0,vx:0,vy:0,vz:40,age:0,type:"plain",src:GAME.player.id,faction:0,mult:1,crit:0,wind:1};CLS.arrows.push(A)');
  const frame = a.json('netCombatFieldsSave()');
  b.apply(frame); b.run('stepArrows(0.1)');
  assert.equal(b.run('stepVisits.at(-1)[0].vis'), true);
  b.run('NETPARTS.peer=peer'); b.apply(frame);
  assert.equal(b.run('CLS.arrows[0].vis'), false, 'the new keeper replay is not mistaken for another viewer');
  b.run('mine=true;stepArrows(0.1)');
  assert.equal(b.run('stepVisits.at(-1)[0].vis'), false);
  b.run('CLS.arrows[0].netFieldPending=true;stepArrows(0.1)');
  assert.equal(b.run('stepVisits.at(-1)[0].vis'), true);
});

test('follower fields dispatch through the real request path while inventory recovery waits for its private checkpoint', () => {
  const b = scene(false, 'b');
  const parts = readFileSync(new URL('../../src/14z_networldparts.js', import.meta.url), 'utf8');
  const section = (from, to) => {
    const a = parts.indexOf(from), z = parts.indexOf(to, a + from.length);
    assert.ok(a >= 0 && z > a); return parts.slice(a, z);
  };
  Object.assign(b.c, { crypto: { randomUUID: (() => { let n = 0; return () => 'field-request-' + (++n); })() },
    performance: { now: () => 1000 } });
  b.run(
    "const NETPART_COMMANDS=commands,NETWS={acct:{id:'account-b'}};" +
    "const SAVE={ref:null,wiping:false},INV={bag:[]},GOODS={};let privateFlushes=0;" +
    "Object.assign(NETPARTS,{pending:new Map(),receipts:[],ready:true,next:0});" +
    "const netWorldPartsCanSimulate=()=>false,netWorldPartsConnected=()=>true;" +
    "const goodsHave=()=>false,goodsTakeAll=()=>true;" +
    "const netWorldPartsFlushJournal=()=>{privateFlushes++;return Promise.resolve(false)};" +
    "const netWsSend=message=>{sends.push(message);return true};const uiError=()=>{};"
  );
  b.run(section('const netPartsClone =', 'const netPartsEqualAdmission =') +
    section('function netWorldPartsOwnerScope(', 'function netWorldPartsReset(') +
    section('function netWorldPartsRequest(', 'function netWorldPartsMessage(') +
    section('function netWorldPartsDispatch(', 'function netWorldPartsSendSettled('));
  b.run('freezeWater(4,6,5,GAME.player);layRune(GAME.player,0,0,"frost")');
  assert.deepEqual(b.json('sends.map(m=>m.command.op)'), ['combat.ice', 'combat.rune']);
  assert.equal(b.run('privateFlushes'), 0, 'transient fields must not write a private economic journal');
  assert.equal(b.run('CLS.ice.length + CLS.runes.length'), 0, 'the follower still waits for canonical visible fields');
  assert.ok(b.run('[...NETPARTS.pending.values()].every(p=>p.durable===false&&p.privateConfirmed)'));
  b.run('netWorldPartsRequest("combat.arrow", {x:0,z:0,row:{}})');
  assert.equal(b.run('sends.at(-1).command.op'), 'combat.arrow');
  assert.equal(b.run('privateFlushes'), 0, 'projectile replication never saves a character for each arrow');
  b.run('netWorldPartsRequest("combat.arrow-recover", {id:"stuck-arrow"})');
  assert.equal(b.run('sends.length'), 3, 'inventory recovery cannot dispatch before private confirmation');
  assert.equal(b.run('privateFlushes'), 1);
  assert.equal(b.run('[...NETPARTS.pending.values()].at(-1).durable'), true);
});
