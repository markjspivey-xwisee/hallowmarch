import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const code = readFileSync(new URL('../../src/14x_netentities.js', import.meta.url), 'utf8');
const admission = { origin: 'https://march.test', epoch: 2 };
function page(self = 'a', online = true) {
  const c = vm.createContext({ console, Math, Number, JSON, Map, Set, Object, Array, String,
    clock: 1000, packets: [], privateRewards: 0, failAfter: Infinity, window: { __hm: {} }, queueMicrotask: fn => fn() });
  vm.runInContext(`
    let nextId=1;
    const GAME={t:1,built:true,player:null}, ENT=[], ENT_BY_ID=new Map(), FACTION_NEUTRAL=4;
    const NETWS={url:${JSON.stringify(online ? 'wss://march.test' : '')},state:'on'}, NET={self:${JSON.stringify(self)},peers:new Map()};
    const NET_BUFFS={stun:[1,5],shield:[100,20]}, W3={pact:false};
    const performance={now:()=>clock};
    const netOn=()=>true, netHumanLive=()=>true, netSharedWorldReady=()=>true;
    const netCurrentWorldAdmission=()=>(${JSON.stringify(admission)});
    const netWsSend=m=>{if(packets.length>=failAfter)return false;packets.push(JSON.parse(JSON.stringify(m)));return true};
    const dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2;
    const baseDmg=()=>10,war4Allied=()=>false;
    const getEnt=id=>ENT_BY_ID.get(id)||null;
    const animActValue=e=>e.netEntityPose??e.anim.act;
    function setupStats(e){e.maxHp=e.maxHp||100;e.hp=e.hp??100;return e}
    function makeEnt(o={}){
      const e={id:nextId++,kind:'wolf',role:'mob',faction:3,name:'Wolf',level:3,cls:null,mobType:'wolf',
        x:0,y:0,z:0,yaw:0,hp:100,maxHp:100,alive:true,removed:false,scale:1,radius:0.5,speed:4,
        home:{x:0,z:0,r:20},fixedY:null,hover:0,look:{coat:[0.3,0.4,0.5]},ai:{},buffs:[],
        anim:{phase:0,amt:0,act:0,death:0,flash:0},...o};
      ENT.push(e);ENT_BY_ID.set(e.id,e);
      if(typeof netEntityRegister==='function')netEntityRegister(e);return e;
    }
    function removeEnt(e){netEntityForget(e);e.removed=true;ENT_BY_ID.delete(e.id);ENT.splice(ENT.indexOf(e),1)}
    function isEnemy(a,b){return a.faction!==b.faction}
    function dealDamage(src,dst,amount,opts={}){
      if(!dst?.alive)return 0;const diverted=netEntityDamage(src,dst,amount,opts);if(diverted!==null)return diverted;
      dst.hp-=amount;dst.damagers??=new Set();dst.damagers.add(src.id);
      if(dst.hp<=0){dst.hp=0;dst.alive=false;netEntityKilled(dst,src)}return amount;
    }
    function healEnt(src,dst,amount){const diverted=netEntityHeal(src,dst,amount);if(diverted!==null)return diverted;dst.hp=Math.min(dst.maxHp,dst.hp+amount)}
    function addBuff(e,kind,value,dur,src,extra){e.buffs.push({kind,value,until:GAME.t+dur,src,...extra})}
    function grantKillRewards(){privateRewards++}
    GAME.player=makeEnt({role:'player',faction:0,name:'Local',x:0,z:0});
  `, c);
  vm.runInContext(code, c);
  return { c, run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)),
    message: m => { c.input = m; return vm.runInContext('netEntityMessage(input)', c); },
    authority(peer = 'a', token = 'token-one', cached = false) {
      return this.message({ t: 'activity', kind: 'authority', authority: token, peer, worldAdmission: admission, hasEntities: cached });
    } };
}
function snapshot(p, payload, seq = 1, token = 'token-one') {
  const data = JSON.stringify(payload), total = Math.ceil(data.length / 3500);
  for (let part = 0; part < total; part++) assert.equal(p.message({ t: 'activity', kind: 'entities', op: 'snapshot',
    authority: token, peer: 'a', worldAdmission: admission, seq, part, total, data: data.slice(part * 3500, (part + 1) * 3500) }), true);
}
function hostRows(host) { return host.json('window.__hm.entities.rows()'); }

// Exercise the production reward chain, including its actual physical drops.
// Rendering, item definitions and unrelated quest UI remain fixture services.
const rewardSources = new Map();
function realRewards(p) {
  const functions = {
    '07_entities.js': ['killEnt', 'grantKillRewards', 'addXP', 'addRP'],
    '09c_loot.js': ['rollLoot', 'dropItem', 'addGold', 'makeJunk'],
    '06d_goods.js': ['dropGood'],
    '09s_survival.js': ['huntOnKill'],
    '09u_depth.js': ['depthOnKill'],
    '10l_late.js': ['late2OnKill', 'late2RisenSpoils'],
  };
  p.run(`
    const INV={gold:0}, LOOT=[], LOOT_MAX=40, FACTION_MONSTER=3, LEVEL_CAP=50, TAU=Math.PI*2;
    const CON=[{xp:0},{xp:1}], DROP_WEIGHTS={mob:[],soldier:[],elite:[],boss:[],dragon:[]};
    const MOBS={skeleton:{kind:'humanoid'},wolf:{kind:'wolf'}}, JUNK={skeleton:['Grave dust'],wolf:['Wolf pelt']};
    const HUNT_DROPS={deer:[['meat_raw',2,2],['hide',1,1]]}, DP_BIRD={};
    const GOODS={meat_raw:{name:'Meat'},hide:{name:'Hide'},trophy:{name:'Trophy'}}, DEPTH={stats:{}}, LATE2={stats:{risenFell:0}};
    let ITEM_SEQ=1;
    Math=Object.create(Math); Math.random=()=>0.1;
    GAME.prog={level:3,xp:0,rp:0,kills:0,realmKills:0}; GAME.player.level=3; GAME.player.cls='warrior';
    const conIndex=()=>1, rollQuality=()=>0, dropIlvl=n=>n, pick=(random,a)=>a[0];
    const makeItem=o=>({id:'gear-'+ITEM_SEQ++,slot:'weapon',q:0,...o}), goodName=id=>GOODS[id]?.name||id;
    const heightAt=()=>0, inDungeon=()=>false, goodsHave=()=>false, dpKnife=()=>false;
    const activityEntityEvent=()=>{}, deathEffects=()=>{}, onEntityKilled=()=>{}, dropRelic=()=>{};
    const late2Deed=()=>{}, bountyOnKill=()=>{}, late2VetXP=()=>{}, late2RpMult=()=>1;
    const xpToNext=()=>1e9, realmRank=()=>1, fmtInt=String, capFirst=String;
    const uiLog=()=>{}, uiToast=()=>{}, uiFloatAt=()=>{}, sfx=()=>{};
  `);
  for (const [file, names] of Object.entries(functions)) {
    if (!rewardSources.has(file)) {
      const source = readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
      const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
      rewardSources.set(file, names.map(name => {
        const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
        assert.ok(node, `production ${file} must declare ${name}`);
        return source.slice(node.start, node.end);
      }).join('\n'));
    }
    p.run(rewardSources.get(file));
  }
}

function killedByRemote(a, b, spec = {}, localParticipant = false) {
  a.c.spec = spec;
  a.run(`makeEnt({x:2,kind:'humanoid',mobType:'skeleton',...spec});
    const remote=makeEnt({role:'remote',faction:0,netPeer:'b',level:3,cls:'mage'});
    NET.peers.set('b',{ghost:remote,slow:{on:1}});
    ENT[1].damagers=new Set([remote.id]);`);
  if (localParticipant) a.run('ENT[1].damagers.add(GAME.player.id)');
  snapshot(b, { v: 1, full: true, rows: hostRows(a), remove: [] });
  a.run('killEnt(ENT[1],remote)');
  const result = a.json('packets.find(p=>p.op==="result"&&p.result.kind==="reward")');
  assert.ok(result, 'the keeper must send the participating follower its reward');
  return result;
}

test('a remote-only kill creates one canonical ground drop and rewards only its participant', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority(); realRewards(a); realRewards(b);
  const result = killedByRemote(a, b);
  const ground = a.json('LOOT');
  assert.ok(ground.length > 0, 'the actual keeper roll creates physical spoils');
  assert.equal(a.run('INV.gold'), 0, 'an uninvolved keeper cannot receive the follower\'s gold');
  assert.equal(a.run('GAME.prog.xp'), 0);
  b.message(result);
  assert.ok(b.run('INV.gold') > 0, 'the real reward chain preserves the participant\'s gold');
  assert.ok(b.run('GAME.prog.xp') > 0, 'the real reward chain preserves experience');
  assert.equal(b.run('LOOT.length'), 0, 'the participant does not roll a second private ground scene');
  const rewards = b.json('({gold:INV.gold,xp:GAME.prog.xp,kills:GAME.prog.kills})');
  b.message(result);
  assert.deepEqual(b.json('({gold:INV.gold,xp:GAME.prog.xp,kills:GAME.prog.kills})'), rewards);
  assert.deepEqual(a.json('LOOT'), ground);
});

test('joint kill participation retains both private rewards with only the keeper\'s ground spoils', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority(); realRewards(a); realRewards(b);
  const result = killedByRemote(a, b, {}, true);
  const ground = a.json('LOOT');
  assert.ok(ground.length > 0); assert.ok(a.run('INV.gold') > 0); assert.ok(a.run('GAME.prog.xp') > 0);
  b.message(result); b.message(result);
  assert.ok(b.run('INV.gold') > 0); assert.ok(b.run('GAME.prog.xp') > 0);
  assert.equal(b.run('GAME.prog.kills'), 1); assert.equal(b.run('LOOT.length'), 0);
  a.run('killEnt(ENT[1],remote)');
  assert.deepEqual(a.json('LOOT'), ground, 'a repeated death callback cannot roll the physical loot twice');
});

test('remote hunting and risen champions keep their material spoils in the canonical scene', () => {
  for (const spec of [{ kind: 'deer', role: 'critter', faction: 4, mobType: null },
    { elite: true, camp: 0, l2risen: true }]) {
    const a = page('a'), b = page('b'); a.authority(); b.authority(); realRewards(a); realRewards(b);
    const result = killedByRemote(a, b, spec);
    assert.ok(a.json('LOOT').some(L => L.item.goods === (spec.kind === 'deer' ? 'meat_raw' : 'trophy')));
    assert.equal(a.run('INV.gold'), 0); assert.equal(a.run('GAME.prog.xp'), 0); assert.equal(a.run('GAME.prog.rp'), 0);
    b.message(result); b.message(result);
    assert.equal(b.run('LOOT.length'), 0, 'hunt, depth and late reward hooks cannot create follower-only spoils');
    if (spec.elite) {
      assert.equal(b.run('GAME.prog.rp'), 250, 'the champion participant keeps its personal realm points');
      assert.equal(b.run('GAME.prog.xp'), 420, 'the participant keeps both ordinary and risen experience');
    }
  }
});

test('standalone kills still produce their ordinary personal gold, experience and physical spoils', () => {
  const p = page('solo', false); realRewards(p);
  p.run('makeEnt({kind:"humanoid",mobType:"skeleton"});ENT[1].damagers=new Set([GAME.player.id]);killEnt(ENT[1],GAME.player)');
  assert.ok(p.run('INV.gold') > 0); assert.ok(p.run('GAME.prog.xp') > 0); assert.ok(p.run('LOOT.length') > 0);
});

test('standalone simulation is preserved, connected scene waits for authority and owns no private character', () => {
  const local = page('solo', false);
  assert.equal(local.run('netEntityCanSimulateWorld()'), true);
  const shared = page('b');
  shared.run('makeEnt()');
  assert.equal(shared.run('netEntityCanSimulateWorld()'), false);
  assert.equal(shared.run('netEntityStep(ENT[1],0.1)'), true);
  assert.equal(shared.run('netEntityStep(GAME.player,0.1)'), false);
  assert.equal(shared.run('netEntityVisible(ENT[1])'), false);
  assert.equal(shared.json('packets').length, 0);
});

test('independently generated worlds reuse bootstrap actors and take the same complete scene', () => {
  const a = page('a'), b = page('b');
  a.run('makeEnt({x:5,name:"Shared wolf",hp:72})');
  b.run('makeEnt({x:21,name:"Different wolf",look:{coat:[1,0,0]}});makeEnt({role:"critter",name:"Unconfirmed"})');
  a.authority(); b.authority();
  snapshot(b, { v: 1, full: true, rows: hostRows(a), remove: [] });
  assert.equal(b.run('ENT.length'), 3);
  assert.equal(b.run('ENT[1].name'), 'Shared wolf');
  assert.equal(b.run('ENT[1].x'), 5);
  assert.equal(b.run('ENT[1].hp'), 72);
  assert.equal(b.run('netEntityVisible(ENT[2])'), false);
  snapshot(b, { v: 1, full: true, rows: hostRows(a), remove: [] }, 2);
  assert.equal(b.run('ENT.length'), 3, 'replay must not create duplicate bodies');
});

test('delta updates, removals, and bounded interpolation buffers keep the latest complete roster', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('makeEnt({x:5});makeEnt({x:8,role:"guard",faction:1})');
  const rows = hostRows(a); snapshot(b, { v: 1, full: true, rows, remove: [] });
  for (let i = 2; i <= 9; i++) {
    rows[0].p[0] = i;
    snapshot(b, { v: 1, full: false, rows: [rows[0]], remove: [] }, i);
  }
  assert.equal(b.run('NET_ENTITIES.rows.size'), 2);
  assert.equal(b.run('Math.max(...[...NET_ENTITIES.buffers.values()].map(b=>b.length))'), 4);
  snapshot(b, { v: 1, full: false, rows: [], remove: [rows[0].id] }, 10);
  assert.equal(b.run('NET_ENTITIES.rows.size'), 1);
  assert.equal(b.run('ENT.length'), 2, 'departed world bodies must not accumulate');
});

test('stale tokens, stale worlds, out of order frames and incomplete chunks cannot change a scene', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority(); a.run('makeEnt({x:5})');
  const rows = hostRows(a); snapshot(b, { v: 1, full: true, rows, remove: [] }, 3);
  const packet = { t: 'activity', kind: 'entities', op: 'snapshot', authority: 'old-token', peer: 'a',
    worldAdmission: admission, seq: 4, part: 0, total: 1, data: JSON.stringify({ v: 1, full: true, rows: [], remove: [] }) };
  assert.equal(b.message(packet), false);
  assert.equal(b.message({ ...packet, authority: 'token-one', worldAdmission: { ...admission, epoch: 1 } }), false);
  assert.equal(b.message({ ...packet, authority: 'token-one', seq: 2 }), false);
  assert.equal(b.message({ ...packet, authority: 'token-one', total: 2 }), true);
  assert.equal(b.run('NET_ENTITIES.rows.size'), 1, 'partial frames must not partially replace the scene');
});

test('keeper takeover waits for canonical replay and preserves IDs before simulating', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority(); a.run('makeEnt({x:5,hp:40})');
  const rows = hostRows(a); snapshot(b, { v: 1, full: true, rows, remove: [] });
  b.authority('b', 'token-two', true);
  assert.equal(b.run('netEntityCanSimulateWorld()'), false);
  snapshot(b, { v: 1, full: true, rows, remove: [], replay: true }, 0, 'token-two');
  assert.equal(b.run('netEntityCanSimulateWorld()'), true);
  assert.equal(b.run('ENT[1].hp'), 40);
  assert.equal(b.run('ENT[1].netEntityId'), rows[0].id);
  assert.equal(b.run('netEntityStep(ENT[1],0.1)'), false);
});

test('follower attacks do not mutate health; the keeper settles damage from a nearby verified character', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('makeEnt({x:2});const remote=makeEnt({role:"remote",faction:0,x:0,netPeer:"b"});NET.peers.set("b",{ghost:remote,slow:{on:1}})');
  const rows = hostRows(a); snapshot(b, { v: 1, full: true, rows, remove: [] });
  b.run(`window.__hm.entities.attack(${JSON.stringify(rows[0].id)},10)`);
  assert.equal(b.run('ENT[1].hp'), 100);
  const command = b.json('packets.at(-1)');
  assert.equal(command.op, 'command');
  a.message({ ...command, from: 'b', position: { x: 0, z: 0 } });
  assert.equal(a.run('ENT[1].hp'), 90);
  a.message({ ...command, from: 'b', position: { x: 100, z: 0 } });
  assert.equal(a.run('ENT[1].hp'), 90, 'out of reach claims cannot damage an actor');
});

test('keeper world enemies recognize other players, forward damage, and private rewards are deduplicated', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('makeEnt({x:2});const remote=makeEnt({role:"remote",faction:0,x:0,netPeer:"b"});NET.peers.set("b",{ghost:remote,slow:{on:1}})');
  const rows = hostRows(a); snapshot(b, { v: 1, full: true, rows, remove: [] });
  assert.equal(a.run('netEntityRemoteEnemy(ENT[1],ENT[2])'), true);
  a.run('dealDamage(ENT[1],ENT[2],12,{kind:"melee"})');
  const hit = a.json('packets.at(-1)'); assert.equal(hit.to, 'b');
  b.message(hit); b.message(hit);
  assert.equal(b.run('GAME.player.hp'), 88);
  b.message({ ...hit, result: { id: 'reward-unique', kind: 'reward', row: rows[0] } });
  b.message({ ...hit, result: { id: 'reward-unique', kind: 'reward', row: rows[0] } });
  assert.equal(b.run('privateRewards'), 1);
});

test('motion traffic is bounded to changed rows and stops without a live owner', () => {
  const a = page('a'); a.authority(); a.run('makeEnt({x:2});netEntityPump(clock)');
  const sent = a.json('packets').length;
  a.run('clock+=600;netEntityPump(clock)');
  assert.equal(a.json('packets').length, sent);
  a.run('NETWS.state="off";ENT[1].x=4;clock+=600;netEntityPump(clock)');
  assert.equal(a.json('packets').length, sent);
});

test('owned animal bodies are authored by their owner and appear in the shared scene without copying ownership', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('const remote=makeEnt({role:"remote",faction:0,netPeer:"b"});NET.peers.set("b",{ghost:remote,slow:{on:1}})');
  b.run('makeEnt({role:"animal",kind:"horse",tame:{owner:"player",id:7,k:"horse"},x:5});netEntityPump(clock)');
  const request = b.json('packets.at(-1)');
  assert.equal(request.command.kind, 'pet-state');
  a.message({ ...request, from: 'b', position: { x: 0, z: 0 } });
  assert.equal(a.run('ENT.at(-1).x'), 5);
  assert.equal(a.run('ENT.at(-1).tame.owner'), 'remote');
  assert.equal(a.run('netEntityStep(ENT.at(-1),0.1)'), true, 'keeper mirrors an owned animal instead of taking over its AI');
  const rows = hostRows(a);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner, 'b');
  snapshot(b, { v: 1, full: true, rows, remove: [] });
  assert.equal(b.run('ENT[1].tame.owner'), 'player');
  assert.equal(b.run('netEntityStep(ENT[1],0.1)'), false, 'owner continues its own companion AI');
  assert.equal(b.run('ENT.length'), 2, 'canonical echoes must not duplicate the owner’s animal');
});

test('failed publication retries every unchanged initial actor and successful motion deltas omit appearance', () => {
  const a = page('a'); a.authority(); a.run('for(let i=0;i<20;i++)makeEnt({x:2+i})');
  a.run('failAfter=1;netEntityPump(clock)');
  assert.equal(a.run('NET_ENTITIES.sent.size'), 0, 'partially sent frames must not consume unchanged actors');
  assert.equal(a.run('NET_ENTITIES.published'), false);
  a.run('packets.length=0;failAfter=Infinity;clock+=600;netEntityPump(clock)');
  const first = a.json('packets').filter(p => p.op === 'snapshot');
  const payload = JSON.parse(first.map(p => p.data).join(''));
  assert.equal(payload.full, true); assert.equal(payload.rows.length, 20);
  a.run('packets.length=0;ENT[1].x=4;clock+=600;netEntityPump(clock)');
  const second = JSON.parse(a.json('packets').filter(p => p.op === 'snapshot').map(p => p.data).join(''));
  assert.equal(second.full, false); assert.equal(second.rows.length, 1);
  assert.equal(second.rows[0].p[0], 4);
  assert.equal('look' in second.rows[0], false, 'pose updates must not repeat the static appearance catalog');
});

test('partial entity frames preserve the existing descriptor and health remains canonical', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority(); a.run('makeEnt({x:2})');
  const rows = hostRows(a); snapshot(b, { v: 1, full: true, rows, remove: [] });
  snapshot(b, { v: 1, full: false, rows: [{ id: rows[0].id, hp: 20, p: [3, 0, 0] }], remove: [] }, 2);
  assert.equal(b.run('ENT[1].hp'), 20);
  assert.equal(b.run('ENT[1].name'), 'Wolf');
  assert.equal(b.run('ENT.length'), 2);
});

test('independent owned companions with the same bootstrap key retain both private owners', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('const mine=makeEnt({role:"animal",kind:"horse",tame:{owner:"player",id:1,k:"horse"},x:5,name:"My horse"}); const remote=makeEnt({role:"remote",faction:0,netPeer:"b"}); NET.peers.set("b",{ghost:remote,slow:{on:1}})');
  b.run('makeEnt({role:"animal",kind:"horse",tame:{owner:"player",id:2,k:"horse"},x:5,name:"Other horse"}); netEntityPump(clock)');
  const request = b.json('packets.at(-1)');
  a.message({ ...request, from: 'b', position: { x: 0, z: 0 } });
  assert.equal(a.run('ENT.filter(e=>e.role==="animal").length'), 2);
  assert.equal(a.run('mine.name'), 'My horse');
  assert.equal(a.run('mine.tame.owner'), 'player');
  assert.equal(a.run('mine.netEntityOwner'), 'a');
  assert.equal(a.run('ENT.at(-1).name'), 'Other horse');
  assert.equal(a.run('ENT.at(-1).netEntityOwner'), 'b');
  snapshot(b, { v: 1, full: true, rows: hostRows(a), remove: [] });
  assert.equal(b.run('ENT.filter(e=>e.role==="animal").length'), 2);
  assert.equal(b.run('ENT[1].tame.owner'), 'player');
  assert.equal(b.run('ENT[1].name'), 'Other horse');
  assert.equal(b.run('ENT[1].netEntityOwner'), 'b');
});

test('a canonical public animal cannot reuse or overwrite a same-kind private companion', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('makeEnt({role:"animal",kind:"horse",name:"Public horse",x:5})');
  b.run('const mine=makeEnt({role:"animal",kind:"horse",name:"Private horse",x:5,tame:{owner:"player",id:8,k:"horse"}})');
  snapshot(b, { v: 1, full: true, rows: hostRows(a), remove: [] });
  assert.equal(b.run('ENT.filter(e=>e.role==="animal").length'), 2);
  assert.equal(b.run('mine.name'), 'Private horse');
  assert.equal(b.run('mine.tame.owner'), 'player');
  assert.equal(b.run('netEntityOwnPet(mine)'), true);
  assert.equal(b.run('ENT.at(-1).name'), 'Public horse');
  assert.equal(b.run('ENT.at(-1).netEntityOwner'), null);
});
test('dead inherited actors retire within the normal ten seconds after keeper handoff', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('makeEnt({x:5,alive:false,hp:0});makeEnt({kind:"door",role:"door",x:10,alive:false,hp:0})');
  const rows = hostRows(a);
  snapshot(b, { v: 1, full: true, rows, remove: [] });
  assert.equal(b.run('ENT[1].removeAt'), 11);
  assert.equal(b.run('ENT[2].removeAt'), Infinity, 'persistent doors never use corpse cleanup');
  b.run('GAME.t=5');
  snapshot(b, { v: 1, full: true, rows, remove: [] }, 2);
  assert.equal(b.run('ENT[1].removeAt'), 11, 'repeated replica frames cannot renew the corpse lifetime');
  assert.equal(b.run('ENT[1].deadAt'), 1, 'the first death pose keeps its animation clock');
  b.authority('b', 'token-two', true);
  snapshot(b, { v: 1, full: true, rows, remove: [], replay: true }, 0, 'token-two');
  const ai = readFileSync(new URL('../../src/08_ai.js', import.meta.url), 'utf8');
  const start = ai.indexOf('function updateNPCs('); assert.ok(start >= 0);
  b.c.actorUpdate = ai.slice(start);
  b.run('GAME.t=12;function updateAnim(){};eval(actorUpdate);updateNPCs(.1)');
  assert.equal(b.run('ENT.some(e=>e.kind!=="door"&&e.role!=="player")'), false);
  assert.equal(b.run('ENT.some(e=>e.kind==="door")'), true);
});

test('a representative 523-actor scene leaves room for the rest of the bounded world checkpoint', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run(`for(let i=0;i<523;i++){
    const human=i%3===0;
    makeEnt({kind:human?'humanoid':i%3===1?'wolf':'deer',role:human?'guard':i%3===1?'mob':'critter',
      faction:human?i%3:3,cls:human?'warrior':null,mobType:human?null:'wolf',level:20,
      x:i%31,y:0,z:Math.floor(i/31),home:{x:i%31,z:Math.floor(i/31),r:12},
      hp:i===522?0:800,maxHp:800,alive:i!==522,
      look:human?{tabard:[0.4,0.3,0.2],armor:[0.5,0.5,0.5],skin:0.35,hair:0.4,mask:32,
        flags:0,scale:1,outfit:0,emblem:3,fem:0,bulk:0}:{colA:[0.4,0.5,0.6],colB:[0.2,0.3,0.4]}});
  }`);
  const wire = a.json('window.__hm.entities.wireRows()'), rich = a.json('window.__hm.entities.rows()');
  const bytes = Buffer.byteLength(JSON.stringify({ v: 1, full: true, rows: wire, remove: [] }));
  assert.equal(wire.length, 523);
  assert.ok(bytes < 240 * 1024, `actor snapshot uses ${bytes} bytes`);
  assert.ok(bytes + 128 * 1024 < 400 * 1024, 'reserve at least 128 KiB for NPCs, boats and mutable world parts');
  snapshot(b, { v: 1, full: true, rows: wire, remove: [] });
  const roundTrip = b.json('window.__hm.entities.rows()');
  assert.equal(roundTrip.length, rich.length);
  for (let i = 0; i < rich.length; i++) for (const key of ['id','kind','role','faction','name','cls','mobType','p','hp','maxHp','alive','look','home'])
    assert.deepEqual(roundTrip[i][key], rich[i][key], `actor ${i} preserves ${key}`);
  assert.equal(roundTrip[522].alive, 0); assert.equal(roundTrip[522].hp, 0, 'compaction must preserve a dead actor');
});

test('compact deltas explicitly clear optional state and restore full health and default animation', () => {
  const a = page('a'), b = page('b'); a.authority(); b.authority();
  a.run('makeEnt({hp:20,alive:false,game:true,buffs:[{kind:"root",value:1,until:5}],anim:{phase:0,amt:1,act:4,death:0,flash:0}});netEntityPump(clock)');
  const first = JSON.parse(a.json('packets').map(p => p.data).join(''));
  snapshot(b, first);
  a.run('packets.length=0;ENT[1].hp=100;ENT[1].alive=true;ENT[1].game=false;ENT[1].buffs=[];ENT[1].anim.amt=0;ENT[1].anim.act=0;clock+=600;netEntityPump(clock)');
  const delta = JSON.parse(a.json('packets').map(p => p.data).join(''));
  assert.equal(delta.rows[0].hp, null); assert.equal(delta.rows[0].alive, null);
  assert.equal(delta.rows[0].buffs, null); assert.equal(delta.rows[0].game, null);
  snapshot(b, delta, 2);
  assert.equal(b.run('ENT[1].hp'), 100); assert.equal(b.run('ENT[1].alive'), true);
  assert.equal(b.run('ENT[1].game'), false); assert.equal(b.run('ENT[1].buffs.length'), 0);
  assert.equal(b.run('ENT[1].netEntityPose'), 0);
});
