import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = readFileSync(new URL('../../src/14z_netcombatfields.js', import.meta.url), 'utf8');
const entitySource = readFileSync(new URL('../../src/14x_netentities.js', import.meta.url), 'utf8');
const entityDeclarations = parse(entitySource, { ecmaVersion: 'latest', sourceType: 'module' }).body;
const effectHelpers = ['netEntityAreaAccept', 'netEntitySourceStamp', 'netEntitySourceRead', 'netEntityResult'].map(name => {
  const node = entityDeclarations.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name); return entitySource.slice(node.start, node.end);
}).join('\n');
const combatSource = readFileSync(new URL('../../src/07_entities.js', import.meta.url), 'utf8');
const markerNode = parse(combatSource, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'aoeMarker');
assert.ok(markerNode, 'actual ground warning marker');
function scene(mine = true, peer = 'a') {
  const c = vm.createContext({ console, Math, Number, Map, Set, Object, Array, String, JSON,
    mine, peer, requests: [], sends: [], floorCount: 0, meshCount: 0, damage: 0, heals: 0, floors: [], arrowSources: [], damageSources: [], stepVisits: [],
    queueMicrotask: fn => fn(), window: { __hm: {} } });
  vm.runInContext(`
    const GAME={t:100,player:{id:1,role:'player',cls:'mage',level:30,faction:0,x:0,y:0,z:0,alive:true,maxHp:100,hp:100,cs:{dev:100}}};
    const NET={self:peer,peers:new Map()},NETPARTS={authority:'authority-token',replay:false,applying:false,peer:mine?peer:'a'};
    const NET_ENTITIES={rewards:new Set(),applying:false},netEntityFallResult=()=>false;
    const ENT=[GAME.player],AOE_MARKS=[],CLS={arrows:[],stuck:[],snares:[],grounds:[],runes:[],ice:[],steam:[],frozen:new Set()};
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
    function dealDamage(src,dst,n){damage+=n;damageSources.push(src);return n}
    function healEnt(src,dst,n){heals+=n}
    function addBuff(e,kind,value,dur,src,extra){e.lastBuff={kind,value,dur,src,extra}}
    function addChill(e,n){e.chill=(e.chill||0)+n}
    function arrowHits(A,target,src){arrowSources.push(src)}
    function stepArrows(){stepVisits.push(CLS.arrows.map(a=>({id:a.netFieldId,vis:a.vis}))) }
    function goodsAdd(){}
  `, c);
  vm.runInContext(effectHelpers + '\n' + combatSource.slice(markerNode.start, markerNode.end) + '\n' + source, c);
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

function fieldEffect(kind = 'grounds', effect = 'damage') {
  const a = scene();
  a.c.fieldKind = kind; a.c.effectKind = effect;
  a.run(`const caster={id:10,name:'Realm soldier',kind:'humanoid',role:'soldier',cls:'priest',level:20,faction:2,alive:true};
    const remote={id:2,role:'remote',netPeer:'b',level:1,faction:0,x:0,z:0};ENT.push(caster,remote);
    const field={x:0,z:0,r:6,src:caster.id,level:20,faction:2,realm:2,el:'fire',t0:GAME.t,until:GAME.t+5};
    CLS[fieldKind].push(field);NET_COMBAT_FIELDS.ticking=true;
    netCombatFieldAreaRun(fieldKind,field,fieldKind==='runes'?5:6,()=>{
      if(effectKind==='damage')dealDamage(caster,remote,12,{kind:'aoe',dot:true});
      else if(effectKind==='heal')healEnt(caster,remote,12);
      else if(effectKind==='buff')addBuff(remote,'snare',0.3,2,caster.id,{ground:true});
      else addChill(remote,1,caster);
    });NET_COMBAT_FIELDS.ticking=false;`);
  return { a, frame: a.json('netCombatFieldsSave()'), result: a.json('sends.find(m=>m.result.kind==="class-effect").result') };
}

function activeRemote(a, known = true) {
  a.run('const remote={id:2,role:"remote",netPeer:"b",level:1,faction:1,x:0,z:0,alive:true,maxHp:100};ENT.push(remote)');
  if (known) a.run('NET.peers.set("b",{slow:{on:1},ghost:remote})');
}
function receive(b, result) { b.c.effect = result; b.run('netEntityResult(effect)'); }
function actualRuneBurst(a) {
  const classes = readFileSync(new URL('../../src/07b_classes.js', import.meta.url), 'utf8');
  const ast = parse(classes, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  const functions = ['classFieldAreaRun', 'runeBurst'].map(name => {
    const node = ast.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); assert.ok(node, name);
    return classes.slice(node.start, node.end);
  }).join('\n');
  a.run(`const FACTION_NEUTRAL=4,rankMult=()=>1,isActor=()=>true,computeDamage=()=>({d:12,crit:false}),frostRootExtra=()=>({});
    const FX={burst(){}},lightFlash=()=>{},fireLandsAt=()=>{},classSfx=()=>{};
    const forNear=(x,z,r,fn)=>{for(const e of ENT)if(dist2(e.x,e.z,x,z)<=r*r)fn(e)};` + functions);
}

test('an actual rune burst at 0.8 seconds lands damage and frost control before its first 1.5 second projection', () => {
  for (const outside of [false, true]) {
    const a = scene(), b = scene(false, 'b'), empty = a.json('netCombatFieldsSave()'); activeRemote(a); actualRuneBurst(a);
    a.run('layRune(GAME.player,0,0,"frost")');
    const creation = a.json('sends[0].result'), stale = a.json('netCombatFieldsSave()');
    assert.equal(creation.kind, 'class-field'); assert.equal(creation.op, 'create');
    receive(b, creation); b.apply(empty);
    assert.equal(b.run('CLS.runes.length'), 1, 'an older projection absence cannot erase the announced warning');
    assert.equal(b.run('!!CLS.runes[0].disc'), true);
    assert.equal(b.run('CLS.runes[0].mark.r'), 5, 'the outer warning covers the entire burst footprint');
    assert.equal(b.run('CLS.runes[0].mark.until'), b.run('CLS.runes[0].until'));
    assert.equal(b.run('CLS.runes[0].mark.faction'), creation.field.faction);
    b.run('GAME.t+=0.8'); if (outside) b.run('GAME.player.x=20');
    a.run('GAME.t+=0.8;NET_COMBAT_FIELDS.ticking=true;runeBurst(CLS.runes[0]);NET_COMBAT_FIELDS.ticking=false');
    assert.equal(a.run('CLS.runes.length'), 0, 'the rune has already been consumed before periodic publication');
    const results = a.json('sends.slice(1).map(m=>m.result)');
    assert.deepEqual(results.map(r => r.kind === 'class-effect' ? r.effect : r.op), ['damage', 'buff', 'retire']);
    for (const result of results) { receive(b, result); receive(b, result); }
    assert.equal(b.run('damage'), outside ? 0 : 12); assert.equal(b.run('!!GAME.player.lastBuff'), !outside);
    assert.equal(b.run('CLS.runes.length'), 0);
    assert.equal(b.run('AOE_MARKS[0].until'), b.run('GAME.t'), 'retirement expires the outer warning');
    b.apply(stale); receive(b, creation);
    assert.equal(b.run('CLS.runes.length'), 0, 'late snapshots and duplicate creation cannot resurrect a spent rune');
  }
});

test('early ground and steam ticks have an announced current footprint before any periodic projection', () => {
  for (const kind of ['grounds', 'steam']) {
    const a = scene(), b = scene(false, 'b'), empty = a.json('netCombatFieldsSave()'); activeRemote(a);
    a.run(kind === 'grounds' ? 'consecrate(GAME.player,null,null,null,1)' : 'steamAt(0,0,6,GAME.player,5)');
    const creation = a.json('sends[0].result'); receive(b, creation); b.apply(empty);
    a.c.kind = kind; a.run('GAME.t+=0.3;NET_COMBAT_FIELDS.ticking=true;netCombatFieldAreaRun(kind,CLS[kind][0],CLS[kind][0].r,()=>dealDamage(GAME.player,remote,12,{kind:"aoe",dot:true}));NET_COMBAT_FIELDS.ticking=false');
    const results = a.json('sends.filter(m=>m.result.kind==="class-effect").map(m=>m.result)');
    assert.equal(results.length, 1); receive(b, results[0]); assert.equal(b.run('damage'), 12);
    b.run('GAME.player.x=40'); receive(b, { ...results[0], id: results[0].id + ':escaped' });
    assert.equal(b.run('damage'), 12);
    b.run('GAME.player.x=0;GAME.t+=20'); receive(b, { ...results[0], id: results[0].id + ':expired' });
    assert.equal(b.run('damage'), 12);
  }
});

test('duplicate creation and delayed positive projections cannot extend lifetime or rearm a rune', () => {
  const a = scene(), b = scene(false, 'b'); activeRemote(a); a.run('layRune(GAME.player,0,0,"fire")');
  const creation = a.json('sends[0].result'), stale = a.json('netCombatFieldsSave()'); receive(b, creation);
  const until = b.run('CLS.runes[0].until'), arm = b.run('CLS.runes[0].armAt');
  b.run('GAME.t+=3'); receive(b, { ...creation, id: creation.id + ':duplicate' }); b.apply(stale);
  assert.equal(b.run('CLS.runes[0].until'), until); assert.equal(b.run('CLS.runes[0].armAt'), arm);
  const empty = scene().json('netCombatFieldsSave()'); b.apply(empty);
  assert.equal(b.run('CLS.runes.length'), 0, 'absence after a positive canonical projection retires it normally');
});

test('raw canonical commands announce inside replay and a newly seen target receives creation before its first effect', () => {
  const a = scene(); activeRemote(a); a.run('NETPARTS.replay=true');
  assert.equal(a.run('commands.get("combat.rune").run({x:0,z:0,el:"fire"}).ok'), true);
  assert.equal(a.run('sends.filter(m=>m.result.kind==="class-field"&&m.result.op==="create").length'), 1);
  const late = scene(); activeRemote(late, false); late.run('layRune(GAME.player,0,0,"fire")');
  assert.equal(late.run('sends.length'), 0);
  late.run('GAME.t+=0.8;NET_COMBAT_FIELDS.ticking=true;netCombatFieldAreaRun("runes",CLS.runes[0],5,()=>dealDamage(GAME.player,remote,12,{kind:"fire"}));NET_COMBAT_FIELDS.ticking=false');
  assert.deepEqual(late.json('sends.map(m=>m.result.kind)'), ['class-field', 'class-effect']);
  assert.ok(late.run('sends[0].result.field.life<30'));
  const changed = scene(); activeRemote(changed); changed.run('layRune(GAME.player,0,0,"fire");sends.length=0;NETPARTS.authority="replacement-authority";NET_COMBAT_FIELDS.ticking=true;netCombatFieldAreaRun("runes",CLS.runes[0],5,()=>dealDamage(GAME.player,remote,12,{kind:"fire"}));NET_COMBAT_FIELDS.ticking=false');
  assert.deepEqual(changed.json('sends.map(m=>m.result.kind)'), ['class-field', 'class-effect'], 'a retained field must be announced again after authority changes');
  const resumed = scene(), follower = scene(false, 'b'); activeRemote(resumed); resumed.run('layRune(GAME.player,0,0,"fire")');
  const first = resumed.json('sends[0].result'); receive(follower, first); follower.run('netCombatFieldsReset()');
  resumed.run('sends.length=0;const replacement={...remote,id:99};ENT.splice(ENT.indexOf(remote),1);ENT.push(replacement);NET.peers.set("b",{slow:{on:1},ghost:replacement});GAME.t+=0.2;NET_COMBAT_FIELDS.ticking=true;netCombatFieldAreaRun("runes",CLS.runes[0],5,()=>dealDamage(GAME.player,replacement,12,{kind:"fire"}));NET_COMBAT_FIELDS.ticking=false');
  const replay = resumed.json('sends.map(m=>m.result)');
  assert.deepEqual(replay.map(result => result.kind), ['class-field', 'class-effect']);
  assert.notEqual(replay[0].id, first.id, 'resuming the same peer must not deduplicate its fresh warning away');
  for (const result of replay) receive(follower, result);
  assert.equal(follower.run('CLS.runes.length'), 1); assert.equal(follower.run('damage'), 12);
});

test('malformed announcements are atomic and fast fields, peer sets and retired history stay bounded', () => {
  const a = scene(), b = scene(false, 'b'); activeRemote(a); a.run('steamAt(0,0,6,GAME.player,5)');
  const creation = a.json('sends[0].result'); receive(b, creation);
  for (const [i, change] of [row => { row.r = 0; }, row => { row.x = null; }, row => { row.life = 1000; }, row => { row.prototype = {}; }].entries()) {
    const bad = structuredClone(creation); bad.id += ':bad:' + i; change(bad.field);
    const before = b.run('JSON.stringify(netCombatFieldsSave())'); receive(b, bad);
    assert.equal(b.run('JSON.stringify(netCombatFieldsSave())'), before);
  }
  for (let i = 0; i < 12; i++) {
    const next = structuredClone(creation); next.id += ':' + i; next.fieldId = next.field.id = 'steam:' + i; receive(b, next);
  }
  assert.equal(b.run('CLS.steam.length'), 8); assert.equal(b.run('NET_COMBAT_FIELDS.fast.size'), 8);
  for (let i = 0; i < 600; i++) receive(b, { kind: 'class-field', op: 'retire', id: 'retire:' + i, fieldKind: 'runes', fieldId: 'rune:' + i });
  assert.equal(b.run('NET_COMBAT_FIELDS.retired.size'), 512);
  b.run('NETPARTS.authority="new-authority";netCombatFieldScope()');
  assert.equal(b.run('NET_COMBAT_FIELDS.fast.size+NET_COMBAT_FIELDS.retired.size+CLS.steam.length'), 0);
  const many = scene(); many.run('for(let i=0;i<80;i++){const e={id:10+i,role:"remote",netPeer:"p"+i,alive:true,x:0,z:0};ENT.push(e);NET.peers.set(e.netPeer,{slow:{on:1},ghost:e})}steamAt(0,0,6,GAME.player,5)');
  assert.equal(many.run('CLS.steam[0].netFieldPeers.size'), 64); assert.equal(many.run('sends.length'), 64);
});

test('retiring a rune removes exactly that field and an over-cap ground retires its old warning first', () => {
  const a = scene(), b = scene(false, 'b'); activeRemote(a);
  a.run('layRune(GAME.player,0,0,"fire");layRune(GAME.player,2,0,"frost")');
  for (const result of a.json('sends.map(m=>m.result)')) receive(b, result);
  const remaining = b.run('CLS.runes[1].netFieldId'); a.run('runeEnd(CLS.runes[0])');
  receive(b, a.json('sends.at(-1).result'));
  assert.equal(b.run('CLS.runes.length'), 1); assert.equal(b.run('CLS.runes[0].netFieldId'), remaining);
  const grounds = scene(); activeRemote(grounds);
  grounds.run('for(let i=0;i<7;i++)netCombatFieldCreate("grounds",()=>{if(CLS.grounds.length>=6)CLS.grounds.shift();CLS.grounds.push({x:i,z:0,r:6,src:GAME.player.id,realm:0,level:30,faction:0,until:GAME.t+12})})');
  assert.deepEqual(grounds.json('sends.slice(-2).map(m=>m.result.op)'), ['retire', 'create']);
  const replica = scene(false, 'b'); for (const result of grounds.json('sends.map(m=>m.result)')) receive(replica, result);
  assert.equal(replica.run('CLS.grounds.length'), 6); assert.equal(replica.run('CLS.grounds.some(f=>f.x===0)'), false);
});

test('delayed keeper ground receipts use the current player footprint and active projected field', () => {
  for (const kind of ['grounds', 'steam', 'runes']) {
    const { frame, result } = fieldEffect(kind);
    assert.equal(result.area.kind, kind); assert.equal(result.opts.dot, true);
    for (const state of ['inside', 'outside', 'expired', 'removed', 'flying']) {
      const b = scene(false, 'b'); b.apply(frame); b.c.effect = result; b.c.fieldKind = kind;
      b.run('GAME.player.level=1');
      if (state === 'outside') b.run('GAME.player.x=20;GAME.player.z=20');
      if (state === 'expired') b.run('GAME.t=CLS[fieldKind][0].until');
      if (state === 'removed') b.run('CLS[fieldKind]=[]');
      if (state === 'flying') b.run('GAME.player.flying=true');
      b.run('netEntityResult(effect);netEntityResult(effect)');
      const accepted = state === 'inside' || state === 'flying' && kind === 'steam';
      assert.equal(b.run('damage'), accepted ? 12 : 0, kind + ': ' + state);
      if (accepted) {
        assert.equal(b.run('damageSources[0]===GAME.player'), false);
        assert.equal(b.run('damageSources[0].role'), 'soldier');
        assert.equal(b.run('damageSources[0].level'), 20);
      }
    }
  }
});

test('persistent area healing, buffs and chill share footprint and lifetime rejection', () => {
  for (const effect of ['heal', 'buff', 'chill']) {
    const { frame, result } = fieldEffect('grounds', effect);
    for (const outside of [false, true]) {
      const b = scene(false, 'b'); b.apply(frame); b.c.effect = result;
      if (outside) b.run('GAME.player.x=50');
      b.run('netEntityResult(effect)');
      assert.equal(b.run('heals'), !outside && effect === 'heal' ? 12 : 0);
      assert.equal(b.run('GAME.player.chill||0'), !outside && effect === 'chill' ? 1 : 0);
      assert.equal(b.run('!!GAME.player.lastBuff'), !outside && effect === 'buff');
      if (!outside && effect === 'buff') assert.equal(b.run('GAME.player.lastBuff.extra.ground'), true);
    }
  }
});

test('persistent receipts reject malformed, wrong-kind and changed-radius provenance', () => {
  const { frame, result } = fieldEffect();
  for (const patch of [{ area: null }, { area: { ...result.area, kind: 'ice' } },
    { area: { ...result.area, id: 'missing-field' } }, { area: { ...result.area, r: 7 } },
    { area: { ...result.area, x: 1 } }, { area: { ...result.area, r: -1 } }]) {
    const b = scene(false, 'b'); b.apply(frame); b.c.effect = { ...result, ...patch }; b.run('netEntityResult(effect)');
    assert.equal(b.run('damage'), 0); assert.equal(b.run('NET_COMBAT_FIELDS.stats.refusedEffects'), 1);
  }
});

test('instant class impacts and their crowd control reject a departed footprint without gating direct effects', () => {
  for (const effect of ['damage', 'buff']) {
    const { result } = fieldEffect('grounds', effect); delete result.area;
    const carrier = effect === 'buff' ? 'extra' : 'opts';
    result[carrier] = { ...result[carrier], area: { v: 1, shape: 'disc', x: 0, z: 0, r: 6 } };
    for (const state of ['inside', 'outside', 'malformed', 'direct']) {
      const b = scene(false, 'b'); const input = structuredClone(result);
      if (state === 'outside' || state === 'direct') b.run('GAME.player.x=40');
      if (state === 'malformed') input[carrier].area = { ...input[carrier].area, r: null };
      if (state === 'direct') delete input[carrier].area;
      b.c.effect = input; b.run('netEntityResult(effect)');
      const accepted = state === 'inside' || state === 'direct';
      assert.equal(b.run('damage'), effect === 'damage' && accepted ? 12 : 0);
      assert.equal(b.run('!!GAME.player.lastBuff'), effect === 'buff' && accepted);
    }
  }
});

test('field handoff preserves removed caster identity instead of assigning damage to the keeper', () => {
  const { a, frame } = fieldEffect(); const b = scene(false, 'b'); b.apply(frame);
  assert.equal(frame.grounds[0].actor.role, 'soldier');
  b.run('mine=true;NETPARTS.peer=peer;NETPARTS.authority="next-keeper";const remote={id:2,role:"remote",netPeer:"c",faction:0};ENT.push(remote);NET_COMBAT_FIELDS.ticking=true;netCombatFieldAreaRun("grounds",CLS.grounds[0],6,()=>dealDamage({level:20,faction:2,role:"none"},remote,12,{kind:"holy"}));NET_COMBAT_FIELDS.ticking=false');
  const next = b.json('sends.find(m=>m.result.kind==="class-effect").result'); assert.equal(next.sourceActor.role, 'soldier');
  assert.equal(b.json('netCombatFieldsSave()').grounds[0].actor.role, 'soldier');
  const c = scene(false, 'c'); c.apply(b.json('netCombatFieldsSave()')); c.c.effect = next;
  c.run('GAME.player.level=1;netEntityResult(effect)');
  assert.equal(c.run('damage'), 12); assert.equal(c.run('damageSources[0].name'), 'Realm soldier');
  assert.equal(c.run('damageSources[0].role'), 'soldier'); assert.equal(c.run('damageSources[0]===GAME.player'), false);
  a.run('ENT.splice(ENT.findIndex(e=>e.id===10),1)');
  assert.equal(a.json('netCombatFieldsSave()').grounds[0].actor.role, 'soldier');
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

test('admitted arrows replace forged caster identity before an immediate source removal', () => {
  const b = scene(false, 'b');
  b.run('GAME.player.cls="archer";const A={x:0,y:1,z:0,vx:0,vy:0,vz:40,age:0,k:1,type:"plain",src:GAME.player.id,faction:0,mult:1,crit:0,wind:1};CLS.arrows.push(A);netOnArrow(A)');
  const request = b.json('requests[0]');
  request.args.row.actor = { name: 'Forged soldier', kind: 'humanoid', role: 'soldier', cls: 'priest', faction: 2, level: 50 };
  const a = scene(); a.c.args = request.args;
  a.run('GAME.player.name="Actual archer";GAME.player.role="remote";GAME.player.netPeer="b";GAME.player.cls="archer";GAME.player.level=17;GAME.player.dmgMult=1.25');
  assert.equal(a.run('commands.get("combat.arrow").run(args).ok'), true);
  a.run('ENT.splice(0,ENT.length);arrowHits(CLS.arrows[0],{},null)');
  assert.equal(a.run('arrowSources[0].role'), 'remote');
  assert.equal(a.run('arrowSources[0].name'), 'Actual archer');
  assert.equal(a.run('arrowSources[0].cls'), 'archer');
  assert.equal(a.run('arrowSources[0].level'), 17);
  assert.equal(a.run('arrowSources[0].dmgMult'), 1.25);
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
