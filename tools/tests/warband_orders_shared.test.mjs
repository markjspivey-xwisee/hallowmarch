import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { createSharedScene, checkedSharedScene } from '../../server/shared-scene.js';

const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
function extract(text, name) {
  const at = text.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name);
  return text.slice(at, text.indexOf('\n}', at) + 2);
}
const partsSource = read('src/14z_networldparts.js'), entitySource = read('src/14x_netentities.js');
const campaignSource = read('src/08g_campaign.js'), serverSource = read('server/server.js');
function fixture() {
  let clock = 100000, mutable = true, valid = true, writes = 0;
  const admission = { origin: 'https://march.test', epoch: 1 }, state = {}, room = { name: 'march', clients: new Map() };
  const up = [], down = [], peers = new Map(), forwarded = [], accepted = [];
  const hostScope = vm.createContext({ WORLDS: { march: state }, isHumanPlaying: c => c.live });
  vm.runInContext(extract(serverSource, 'roomNeedsWarbandOrders') + '\n' + extract(serverSource, 'roomHost'), hostScope);
  const scene = createSharedScene({ hostFor: () => hostScope.roomHost(room), live: c => c.live, admission: () => admission,
    stateFor: () => state, canMutate: () => mutable, validatePersist: () => valid, now: () => clock,
    changed: () => writes++, send: (c, message) => { const m = clone(message); down.push({ id: c.peer, m }); if (m.op === 'command') forwarded.push(m); } });
  function relayPose(p) {
    for (const q of peers.values()) if (q !== p) q.scope.NET.peers.set(p.id, { slow: clone(p.c.slow),
      fast: { x: p.c.fast.p[0], y: p.c.fast.p[1], z: p.c.fast.p[2], d: p.c.fast.d }, ghost: null });
  }
  function add(id) {
    const c = { peer: id, room, live: true, acct: { id: 'owner-' + id }, since: peers.size + 1,
      slow: { r: 0, on: 1, l: 20, rr: 1, warbandOrders: 1, sharedScene: 2, n: id, dn: id },
      fast: { p: [3, 0, 0], d: 0, a: 0, fl: 0 }, pos: { x: 3, z: 0 }, posT: clock, worldAdmission: admission };
    room.clients.set(id, c);
    const player = { alive: true, faction: 0, name: id, level: 20, x: id === 'a' ? 1000 : 3, y: 0, z: 0 };
    const keeps = Array.from({ length: 6 }, (_, id) => ({ id, realm: id % 3, site: { name: 'Keep ' + id, x: id * 30, z: 20 } }));
    const temples = Array.from({ length: 3 }, (_, id) => ({ id, realm: id, exposed: true, site: { name: 'Temple ' + id, x: id * 35, z: 50 } }));
    const relics = Array.from({ length: 3 }, (_, id) => ({ id, realm: id, state: 'temple', at: id }));
    const nodes = Array.from({ length: 72 }, (_, id) => ({ id, x: id, z: id + 1 }));
    const hall = { num: 7, realm: 0, intact: true, hallSpots: { table: { x: 3, z: 0 } } };
    const tasks = [], errors = [], notices = [], calls = [], publications = [];
    const scope = vm.createContext({ GAME: { started: true, t: 100, player, prog: { level: 20, rp: 1 } },
      CAMPAIGN: { n: 1, state: 'war', story: { you: { orders: 0 } } }, CWUI: { msg: '' }, HALL: { list: [hall], grant: null },
      WAR: { keeps, temples, relics, warbands: [{ id: 1, realm: 0, members: [], order: null }], commanders: [], nextWb: 2, stats: { raidOrders: 0 } }, NAV: { nodes },
      NETWS: { url: 'wss://march.test', state: 'on', acct: { id: c.acct.id } }, NET: { self: id, peers: new Map(), fastKey: '', fastAt: 0 },
      NET_ENTITIES: { authority: '', admission: null, peer: '', sent: new Map(), received: -1, seq: 0, complete: false, waiting: false,
        published: false, orderPatches: new Map(), stats: { refused: 0 }, assembly: null },
      SAVE: { ref: {}, wiping: false }, INV: { goods: {}, gold: 0, bag: [] }, GOODS: {}, GOODS_UI: {}, BAG_SIZE: 40,
      performance: { now: () => clock }, crypto: { randomUUID }, window: {}, queueMicrotask: f => tasks.push(f),
      clamp: (v, lo, hi) => Math.max(lo, Math.min(v, hi)), dist2: (x,z,a,b) => (x-a)**2+(z-b)**2,
      dist: (x,z,a,b) => Math.hypot(x-a,z-b), realmRank: rp => rp, hallHolder: H => H.realm, houseIntact: H => H.intact,
      hallCommandGrant: () => { const g = scope.HALL.grant; return !!g && player.alive && hall.realm === player.faction && hall.intact && Math.hypot(player.x - 3, player.z) < 3.4; },
      netOn: () => true, netHumanLive: () => c.live, netSharedWorldReady: () => true,
      netWorldAdmissionRead: a => a && a.origin === admission.origin && a.epoch === admission.epoch ? a : null,
      netWsSend: m => { up.push({ id, m: clone(m) }); return true; },
      netSendFast: () => { publications.push('pose'); c.fast = { ...c.fast, p: [player.x, player.y, player.z], d: player.alive ? 0 : 1 };
        c.pos = { x: player.x, z: player.z }; c.posT = clock; relayPose(peers.get(id)); },
      netSendSlow: () => { c.slow = { ...c.slow, r: player.faction, l: scope.GAME.prog.level, rr: scope.GAME.prog.rp }; relayPose(peers.get(id)); },
      goodsHave: () => false, goodsTakeAll: () => true, goodsAdd() {}, goodsTake() {}, bagAdd() {}, addGold() {}, loreNote() {}, skillGain() {}, saveSoon() {},
      uiError: s => errors.push(s), uiToast: s => notices.push(s), reportError: e => { throw e; }, sfx() {}, news: s => calls.push(s),
      wbName: () => 'First Warband', orderPhrase: (w,o) => o.type + ' at your command', announceOrder: () => calls.push('order'),
      inDungeon: P => P.x > 2000, R_RING: 500, templeExposed: T => T.exposed,
      wbLeader: () => ({ x: 0, z: 0 }), wbPlan: (w,n) => { w.goal = n.id; }, nearestNavNode: () => nodes[0],
      getEnt: () => null, netEntityFind: () => null, netEntityPlain: clone, netEntityDungeonMeta: () => null, netEntityApplyDungeon() {},
      netEntityR: v => Math.round(v * 100) / 100, netEntityMine: () => scope.NET_ENTITIES.peer === id,
      netEntityReceive: payload => { if (payload.meta) scope.netEntityApplyMeta(payload.meta); scope.NET_ENTITIES.waiting = false; scope.NET_ENTITIES.complete = true; return true; },
      REALMS: Array.from({ length: 3 }, (_, i) => ({ name: 'Realm '+i, hallowName: 'Hallow '+i, templeSite: { x: i*35, z:50 } })),
      ORDER_GLYPH: {}, ORDER_WORD: {}, nodeSiteName: n => n ? 'Node '+n.id : 'the road',
    });
    const prefix = partsSource.slice(0, partsSource.indexOf('\nqueueMicrotask(() => {'));
    const functions = ['netWorldPartsDispatch', 'netWorldPartsSendSettled', 'netWorldPartsConfirmSettled', 'netWorldPartsTakeSettled', 'netWorldPartsPruneReceipts'].map(n=>extract(partsSource,n)).join('\n');
    const gameplay = ['cwCanCommand','cwCommandTable','cwSetOrder','playerOrder','cwPlayerOrder','cwRallyCaller','cwOrderRef','cwOrderView','rallyPoint','cwTarget','orderShort'].map(n=>extract(campaignSource,n)).join('\n');
    const entities = ['netEntityOrderEncode','netEntityOrderDecode','netEntityPrepareWarbands','netEntityApplyBandOrder','netEntityOrderPatch','netEntityMeta','netEntityApplyMeta','netEntityMessage'].map(n=>extract(entitySource,n)).join('\n');
    vm.runInContext('const cwFinitePoint = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.z); const netEntityBandMember = () => false;\n'+prefix+'\n'+functions+'\n'+entities+'\n'+extract(read('src/08_ai.js'),'wbSetOrder')+'\n'+gameplay+'\n'
      +partsSource.slice(partsSource.indexOf('// Warband commands'))
      +'\nglobalThis.hooks={NETPARTS,netWorldPartsMessage,netWorldPartsPublish,netWorldPartsPump,playerOrder,cwPlayerOrder,cwTarget,orderShort,rallyPoint,netEntityMeta,netEntityApplyMeta,netEntityMessage};', scope);
    for (const fn of tasks) fn();
    const p = { id,c,scope,player,hall,errors,notices,calls,publications,...scope.hooks }; peers.set(id,p);
    for (const q of peers.values()) relayPose(q);
    return p;
  }
  const a=add('a'), b=add('b');
  function drain() {
    let count=0;
    while (up.length || down.length) {
      if (++count>1000) throw Error('network loop');
      if (up.length) { const q=up.shift(); accepted.push({...q,ok:scene.handle(peers.get(q.id).c,q.m)}); }
      else { const q=down.shift(),p=peers.get(q.id); if(p) { p.netEntityMessage(q.m); p.netWorldPartsMessage(q.m); } }
    }
  }
  function entities(p, meta=p.netEntityMeta()) {
    const data=JSON.stringify({v:1,full:true,rows:[],remove:[],meta}),seq=++p.scope.NET_ENTITIES.seq,total=Math.ceil(data.length/3500);
    for(let part=0;part<total;part++) up.push({id:p.id,m:{t:'activity',kind:'entities',op:'snapshot',authority:p.NETPARTS.authority,worldAdmission:admission,seq,part,total,data:data.slice(part*3500,(part+1)*3500)}});
    drain();
  }
  const pump=()=>{for(let n=0;n<10;n++){clock+=200;for(const p of peers.values())p.netWorldPartsPump(clock);drain();}};
  scene.sync(room);drain();a.netWorldPartsPublish(clock,true);pump();entities(a);
  const command=(args={})=>({id:'b:'+randomUUID(),op:'warband.order',args:{wb:1,cmd:'attack',target:1,table:-1,campaign:1,version:0,...args},goods:{},capacity:0});
  const direct=(cmd,more={})=>scene.handle(b.c,{t:'activity',kind:'worldparts',op:'command',authority:b.NETPARTS.authority,worldAdmission:admission,command:cmd,...more});
  return {a,b,scene,state,room,peers,up,down,forwarded,accepted,add,drain,pump,entities,command,direct,admission,relayPose,
    tick(ms){clock+=ms;},fresh(){b.c.posT=clock;},valid(v){valid=v;},mutable(v){mutable=v;},writes:()=>writes,
    host(id){room.clients.get(id).since=-100;scene.sync(room);drain();},hostId:()=>hostScope.roomHost(room)?.peer};
}

test('follower map attack has no prediction, commits with its receipt, and survives late join plus handoff without another entity publication',()=>{
  const f=fixture();assert.equal(f.a.scope.NET.peers.get('b').ghost,null);
  assert.match(f.b.playerOrder(1,'attack',1),/awaiting/);assert.equal(f.b.scope.WAR.warbands[0].order,null);
  f.drain();f.pump();
  for(const p of [f.a,f.b]) {assert.equal(p.scope.WAR.warbands[0].order.keep.id,1);assert.equal(p.scope.WAR.warbands[0].order.byPlayer,true);}
  assert.equal(f.a.scope.CAMPAIGN.story.you.orders,0);assert.equal(f.b.scope.CAMPAIGN.story.you.orders,1);
  assert.equal(f.b.NETPARTS.pending.size,0);assert.ok(f.state.activity.entities.meta.warbands[0].orderToken);
  const c=f.add('c');f.scene.sync(f.room,c.c);f.drain();assert.equal(c.scope.WAR.warbands[0].order.keep.id,1);
  f.host('b');assert.equal(f.b.scope.WAR.warbands[0].order.keep.id,1);assert.equal(f.b.scope.WAR.warbands[0].order.byPlayer,true);
  assert.ok(checkedSharedScene(f.state.activity));assert.equal(JSON.stringify(f.state).includes('actorState'),false);
});

test('defend, raid, rally, and release preserve their targets and observer display metadata',()=>{
  for(const [cmd,target] of [['defend',0],['raid',1],['rally',-1]]) {
    const f=fixture();f.b.playerOrder(1,cmd,target);f.drain();f.pump();
    const w=f.b.scope.WAR.warbands[0];assert.equal(w.order.type,cmd);assert.doesNotThrow(()=>f.b.orderShort(w));assert.ok(f.b.cwTarget(w));
    if(cmd==='raid')assert.equal(w.order.temple,f.b.scope.WAR.temples[1]);
    if(cmd==='rally') {assert.equal(w.order.rallyPeer,'b');const hostOrder=f.a.scope.WAR.warbands[0].order;
      f.b.player.x=40;f.b.scope.netSendFast();assert.equal(f.a.rallyPoint(f.a.scope.WAR.warbands[0],hostOrder,{x:0,z:0}),true);assert.equal(f.a.cwTarget(f.a.scope.WAR.warbands[0]).x,40);
      assert.equal(f.a.cwTarget(f.a.scope.WAR.warbands[0]).x,40);
      f.b.c.fast.d=1;f.relayPose(f.b);assert.equal(f.a.rallyPoint(f.a.scope.WAR.warbands[0],hostOrder,{x:0,z:0}),false);
      f.a.scope.NET.peers.delete('b');assert.equal(f.a.rallyPoint(f.a.scope.WAR.warbands[0],hostOrder,{x:0,z:0}),false);
    }
    f.b.playerOrder(1,'release',-1);f.drain();f.pump();assert.equal(f.a.scope.WAR.warbands[0].order,null);assert.equal(f.b.scope.WAR.warbands[0].order,null);
  }
});

test('keeper uses caller progression and canonical table access rather than its own rank or table grant',()=>{
  for(const mode of ['rank','level','table']) {
    const f=fixture();f.b.player.level=mode==='level'?20:1;f.b.scope.GAME.prog.level=f.b.player.level;f.b.scope.GAME.prog.rp=mode==='rank'?3:1;
    if(mode==='table')f.b.scope.HALL.grant={H:f.b.hall};
    f.b.playerOrder(1,'attack',1);f.drain();f.pump();assert.equal(f.a.scope.WAR.warbands[0].order?.type,'attack',mode);
  }
  for(const change of [f=>f.a.hall.realm=1,f=>f.a.hall.intact=false,f=>{f.b.c.pos={x:30,z:0};}]) {
    const f=fixture();f.b.c.slow.l=1;f.b.c.slow.rr=1;f.a.scope.GAME.prog.rp=20;change(f);
    assert.equal(f.direct(f.command({table:7}),{actorState:{alive:true,level:60,rank:20,y:0}}),true);f.drain();f.pump();assert.equal(f.a.scope.WAR.warbands[0].order,null);
  }
});

test('server and keeper reject hostile targets, forged context, malformed arguments, dead callers, stale leases and retired scopes',()=>{
  for(const change of [f=>f.b.c.fast.d=1,f=>f.b.c.fast=null,f=>f.tick(6000),f=>f.b.c.live=false,f=>f.mutable(false)]) {
    const f=fixture();change(f);assert.equal(f.direct(f.command(),{actorState:{alive:true,level:60,rank:20,y:0}}),false);assert.equal(f.forwarded.length,0);
  }
  const f=fixture();
  for(const args of [{wb:-1},{wb:'1'},{cmd:'teleport'},{target:6},{cmd:'rally',target:0},{table:4096},{rank:20},{campaign:0},{version:-1},{version:'0'}])assert.equal(f.direct(f.command(args)),false);
  assert.equal(f.direct(f.command(),{authority:'old'}),false);assert.equal(f.direct(f.command(),{worldAdmission:{...f.admission,epoch:2}}),false);
  for(const args of [{target:0},{cmd:'defend',target:1},{cmd:'raid',target:0},{campaign:2}]) {
    const q=fixture();assert.equal(q.direct(q.command(args)),true);q.drain();q.pump();assert.equal(q.a.scope.WAR.warbands[0].order,null);
  }
  const enemy=fixture();enemy.b.c.slow.r=1;assert.equal(enemy.direct(enemy.command()),true);enemy.drain();enemy.pump();assert.equal(enemy.a.scope.WAR.warbands[0].order,null);
});

test('retries retain the first admitted actor, execute once, and remain deduplicated after keeper handoff',()=>{
  const f=fixture();f.b.playerOrder(1,'attack',1);const cmd=clone(f.up[0].m.command);f.drain();f.pump();const original=clone(f.forwarded[0]);
  f.tick(3100);f.b.c.pos={x:300,z:300};f.b.c.fast={p:[300,400,300],d:1};f.b.c.slow={...f.b.c.slow,r:2,l:1,rr:0};f.fresh();
  assert.equal(f.direct(cmd,{actorState:{alive:true,rank:20,level:60,y:0}}),true);f.drain();f.pump();
  assert.deepEqual(f.forwarded.at(-1).actorState,original.actorState);assert.deepEqual(f.forwarded.at(-1).position,original.position);assert.equal(f.a.calls.length,1);
  f.host('b');f.b.c.fast.d=0;f.b.c.slow.r=0;f.fresh();assert.equal(f.direct(cmd),true);f.drain();f.pump();assert.equal(f.b.calls.length,0);assert.equal(f.b.scope.CAMPAIGN.story.you.orders,1);
});

test('older entity snapshots cannot resurrect a released order; matching tokens allow completion and campaign reset',()=>{
  const f=fixture(),before=clone(f.a.netEntityMeta());f.b.playerOrder(1,'attack',1);f.drain();f.pump();const attack=clone(f.a.netEntityMeta());
  f.entities(f.a,before);assert.equal(f.state.activity.entities.meta.warbands[0].order.type,'attack');
  f.b.playerOrder(1,'release',-1);f.drain();f.pump();const releaseToken=f.a.scope.WAR.warbands[0].orderToken;
  f.entities(f.a,attack);assert.equal(f.state.activity.entities.meta.warbands[0].order,null);assert.equal(f.b.scope.WAR.warbands[0].order,null);
  f.b.netEntityApplyMeta(attack);assert.equal(f.b.scope.WAR.warbands[0].order,null,'reverse arrival cannot resurrect attack');
  const done=clone(f.a.netEntityMeta());done.warbands[0].order={...attack.warbands[0].order,byPlayer:false};done.warbands[0].orderToken=releaseToken;
  f.entities(f.a,done);assert.equal(f.state.activity.entities.meta.warbands[0].order.byPlayer,false,'matching token accepts commander transition');
  const next=clone(done);next.warbands[0].orderCampaign=2;next.warbands[0].orderToken='';next.warbands[0].orderVersion=0;next.warbands[0].order=null;
  f.entities(f.a,next);assert.equal(f.state.activity.entities.meta.warbands[0].orderToken,'');
});

test('unchanged canonical metadata preserves living navigation and a newer accepted command resets its route',()=>{
  const f=fixture();f.b.playerOrder(1,'attack',1);f.drain();f.pump();
  const band=f.a.scope.WAR.warbands[0],path=[0,1],trail=[{x:0,z:0},{x:1,z:1}],leaderGoal={x:1,z:1};
  Object.assign(band,{path,pathIdx:1,goal:1,trail,trailBase:4,leaderGoal});
  for(let n=0;n<3;n++) {
    f.a.scope.GAME.t+=1;
    f.a.netEntityApplyMeta(clone(f.a.netEntityMeta()));
    assert.equal(band.path,path);assert.equal(band.pathIdx,1);assert.equal(band.goal,1);
    assert.equal(band.trail,trail);assert.equal(band.trailBase,4);assert.equal(band.leaderGoal,leaderGoal);
  }
  f.b.playerOrder(1,'defend',0);f.drain();f.pump();
  assert.equal(band.order.type,'defend');assert.equal(band.orderVersion,2);
  assert.equal(band.path,null);assert.equal(band.pathIdx,0);assert.equal(band.goal,null);
  assert.equal(band.trail,trail,'physical follower history remains valid through retasking');
});

test('refused checkpoint leaves previous canonical order and public receipts intact',()=>{
  const f=fixture(),before=clone(f.state.activity);f.valid(false);f.b.playerOrder(1,'attack',1);f.drain();f.pump();
  assert.deepEqual(clone(f.state.activity),before);assert.equal(f.b.scope.WAR.warbands[0].order,null);assert.equal(f.b.scope.CAMPAIGN.story.you.orders,0);
  assert.equal(f.a.scope.WAR.warbands[0].order,null,'the keeper cannot simulate an uncommitted order');
  assert.equal(f.a.scope.WAR.warbands[0].orderVersion || 0,0);
  assert.equal(f.a.calls.length,0,'refused commands produce no accepted-order announcement');
});

test('same-version burst commands conflict clearly and become live only after the retained checkpoint commits',()=>{
  const f=fixture();
  f.a.playerOrder(1,'raid',1);f.a.playerOrder(1,'release',-1);f.a.playerOrder(1,'attack',1);
  f.drain();
  assert.equal(f.a.scope.WAR.warbands[0].order,null);
  assert.equal(f.b.scope.WAR.warbands[0].order,null);
  assert.equal(f.a.scope.WAR.stats.raidOrders,0);
  assert.equal(f.a.calls.length,0);
  assert.deepEqual(clone(f.a.NETPARTS.receipts.filter(r=>r.ok).map(r=>r.result.orderVersion)),[1]);
  assert.equal(f.a.NETPARTS.receipts.filter(r=>!r.ok && /newer orders/.test(r.reason)).length,2);
  f.pump();
  for(const p of [f.a,f.b]) {
    assert.equal(p.scope.WAR.warbands[0].order.type,'raid');
    assert.equal(p.scope.WAR.warbands[0].orderVersion,1);
  }
  assert.equal(f.a.scope.WAR.stats.raidOrders,1);
  assert.equal(f.a.scope.CAMPAIGN.story.you.orders,1);
  assert.equal(f.b.scope.CAMPAIGN.story.you.orders,0);
});

test('monotonic order versions reject snapshots and missing-band patches older than the pruned receipt window',()=>{
  const f=fixture();f.b.playerOrder(1,'attack',1);f.drain();f.pump();
  const attack=clone(f.a.netEntityMeta()),oldReceipt=clone(f.a.NETPARTS.receipts.find(r=>r.ok));
  for(let n=0;n<12;n++) {f.b.playerOrder(1,n%2?'attack':'release',n%2?1:-1);f.drain();f.pump();}
  f.b.playerOrder(1,'release',-1);f.drain();f.pump();
  const current=clone(f.a.netEntityMeta()).warbands[0];
  assert.ok(current.orderVersion>8);assert.equal(current.order,null);
  assert.equal(f.a.NETPARTS.receipts.some(r=>r.id===oldReceipt.id),false,'old receipt was actually pruned');
  f.entities(f.a,attack);f.b.netEntityApplyMeta(attack);
  assert.equal(f.state.activity.entities.meta.warbands[0].order,null);
  assert.equal(f.b.scope.WAR.warbands[0].order,null);
  const packet=row=>({t:'activity',kind:'entities',op:'warband-order',authority:f.b.scope.NET_ENTITIES.authority,
    worldAdmission:f.admission,campaign:row.orderCampaign,orderVersion:row.orderVersion,orderToken:row.orderToken,
    warband:{id:row.id,order:row.order}});
  assert.equal(f.b.netEntityMessage(packet(attack.warbands[0])),false);
  f.b.scope.WAR.warbands=[];
  assert.equal(f.b.netEntityMessage(packet(current)),true);
  assert.equal(f.b.netEntityMessage(packet(attack.warbands[0])),false,'pending patches retain the highest version');
  f.b.netEntityApplyMeta(attack);
  assert.equal(f.b.scope.WAR.warbands[0].order,null);
  assert.equal(f.b.scope.WAR.warbands[0].orderVersion,current.orderVersion);
  f.a.scope.CAMPAIGN.n=2;
  const reset=f.a.netEntityMeta().warbands[0];
  assert.equal(reset.orderVersion,0);assert.equal(reset.orderToken,'');assert.equal(reset.orderCampaign,2);
});

test('an original command replay after receipt pruning and keeper handoff cannot become a new order',()=>{
  const f=fixture();f.b.playerOrder(1,'attack',1);const original=clone(f.up[0].m.command);f.drain();f.pump();
  for(let n=0;n<12;n++) {f.b.playerOrder(1,n%2?'attack':'release',n%2?1:-1);f.drain();f.pump();}
  f.b.playerOrder(1,'release',-1);f.drain();f.pump();
  assert.equal(f.a.NETPARTS.receipts.some(r=>r.id===original.id),false);
  const version=f.state.activity.entities.meta.warbands[0].orderVersion;
  f.host('b');f.tick(3100);f.fresh();
  assert.equal(f.direct(original),true);f.drain();f.pump();
  for(const p of [f.a,f.b]) {assert.equal(p.scope.WAR.warbands[0].order,null);assert.equal(p.scope.WAR.warbands[0].orderVersion,version);}
  assert.equal(f.state.activity.entities.meta.warbands[0].order,null);
  assert.equal(f.state.activity.entities.meta.warbands[0].orderVersion,version);
  const refused=f.b.NETPARTS.receipts.find(r=>r.id===original.id);
  assert.equal(refused.ok,false);assert.match(refused.reason,/newer orders/);
});

test('a command for a newly spawned band absent from retained metadata settles as a failure without local prediction',()=>{
  const f=fixture();
  const band={id:2,realm:0,members:[],order:null};f.a.scope.WAR.warbands.push(band);
  assert.match(f.a.playerOrder(2,'attack',1),/awaiting/);f.drain();f.pump();
  assert.equal(band.order,null);assert.equal(f.a.NETPARTS.pending.size,0);
  const result=f.a.NETPARTS.receipts.find(r=>r.result?.warband?.id===2 || !r.ok);
  assert.equal(result.ok,false);assert.ok(f.a.errors.length);
  assert.equal(f.state.activity.entities.meta.warbands.some(w=>w.id===2),false);
});

test('capability handoff fences legacy keepers, native keeper orders share receipts, standalone remains immediate, and idle makes no writes',()=>{
  const f=fixture();f.a.c.slow.warbandOrders=0;f.a.scope.NET.peers.get('b').slow.warbandOrders=0;f.b.scope.NET.peers.get('a').slow.warbandOrders=0;
  assert.match(f.b.playerOrder(1,'attack',1),/updated game/);assert.equal(f.up.length,0);
  f.a.c.slow.warbandOrders=1;f.b.scope.NET.peers.get('a').slow.warbandOrders=1;f.b.playerOrder(1,'attack',1);f.drain();f.pump();
  f.a.c.slow.warbandOrders=0;assert.equal(f.hostId(),'b');f.b.c.slow.warbandOrders=0;assert.equal(f.hostId(),undefined);
  const direct=fixture();assert.match(direct.a.playerOrder(1,'attack',1),/awaiting/);assert.equal(direct.a.scope.WAR.warbands[0].order,null);assert.equal(direct.up.length,1);direct.drain();direct.pump();assert.equal(direct.a.scope.WAR.warbands[0].order.type,'attack');assert.equal(direct.a.scope.WAR.warbands[0].orderVersion,1);assert.equal(direct.a.scope.CAMPAIGN.story.you.orders,1);
  const solo=fixture();solo.b.scope.NETWS.url='';solo.b.playerOrder(1,'attack',1);assert.equal(solo.b.scope.WAR.warbands[0].order.type,'attack');assert.equal(solo.up.length,0);
  const idle=fixture(),writes=idle.writes();idle.tick(60000);assert.equal(idle.writes(),writes);
});
