import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../../src/14x_netentities.js', import.meta.url), 'utf8');
const admission = { origin: 'https://march.test', epoch: 2 };
function page(self = 'a', online = true) {
  const c = vm.createContext({ console, Math, Number, JSON, Map, Set, Object, Array, String,
    clock: 1000, packets: [], privateRewards: 0, window: { __hm: {} }, queueMicrotask: fn => fn() });
  vm.runInContext(`
    let nextId=1;
    const GAME={t:1,built:true,player:null}, ENT=[], ENT_BY_ID=new Map(), FACTION_NEUTRAL=4;
    const NETWS={url:${JSON.stringify(online ? 'wss://march.test' : '')},state:'on'}, NET={self:${JSON.stringify(self)},peers:new Map()};
    const NET_BUFFS={stun:[1,5],shield:[100,20]}, W3={pact:false};
    const performance={now:()=>clock};
    const netOn=()=>true, netHumanLive=()=>true, netSharedWorldReady=()=>true;
    const netCurrentWorldAdmission=()=>(${JSON.stringify(admission)});
    const netWsSend=m=>{packets.push(JSON.parse(JSON.stringify(m)));return true};
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
  assert.equal(b.run('ENT.length'), 2, 'canonical echoes must not duplicate the owner's animal');
});

test('failed publication retries every unchanged initial actor and successful motion deltas omit appearance', () => {
  const a = page('a'); a.authority(); a.run('makeEnt({x:2});makeEnt({x:3})');
  a.run('NETWS.state="off";netEntityPump(clock);NETWS.state="on";clock+=600;netEntityPump(clock)');
  const first = a.json('packets').filter(p => p.op === 'snapshot');
  const payload = JSON.parse(first.map(p => p.data).join(''));
  assert.equal(payload.full, true); assert.equal(payload.rows.length, 2);
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
