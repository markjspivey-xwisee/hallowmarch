import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedScene, confirmOwnedSceneCheckpoint, activityBoat, activityNpc, checkedSharedScene } from './shared-scene.js';

const boat = (id = 1) => ({ id, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, wr: 0, st: 'free', ph: 0, eff: 0, grounded: 0.3, char: 0, rider: null, still: false, home: { j: 0, b: 0 }, launch: null });
const npc = () => ({ id: 'town:0:villager:0', role: 'villager', n: 'Field worker', r: 0, c: null, l: 1, p: [0, 2, 0], y: 0, a: 21, ph: 2, am: 0, h: 10, m: 10, d: 0, g: 0, lk: [1,1,1,1,1,1,0,0,65536,0,1,0,0,0,0.2], st: null, fm: [0,1,0], hm: 0, bt: 1 });
function fixture(saved, options = {}) {
  let time = 100000, mutable = true, epoch = 1, host = 'a', changes = 0;
  const room = { clients: new Map(), name: 'march' }, state = saved || {}, out = new Map();
  const admission = () => ({ origin: 'https://game.test', epoch });
  const add = peer => {
    const c = { peer, room, live: true, slow: { r: 0 }, acct: { id: 'account-' + peer }, pos: { x: 0, z: 0 }, posT: time, worldAdmission: admission() };
    room.clients.set(peer, c); out.set(peer, []); return c;
  };
  const a = add('a'), b = add('b');
  const scene = createSharedScene({ hostFor: () => room.clients.get(host), live: c => c.live,
    admission, stateFor: () => state, canMutate: () => mutable, validatePersist: options.validatePersist, confirm: options.confirm, changed: () => changes++, now: () => time,
    send: (c, m) => out.get(c.peer).push(structuredClone(m)) });
  scene.sync(room);
  const authority = c => [...out.get(c.peer)].reverse().find(m => m.kind === 'authority');
  const send = (c, m) => scene.handle(c, { t: 'activity', authority: authority(c).authority, worldAdmission: admission(), ...m });
  const publish = (c, kind, payload, seq = 1, backwards = false) => {
    const text = JSON.stringify(payload), total = Math.ceil(text.length / 3500), indices = [...Array(total)].map((_, i) => i);
    if (backwards) indices.reverse(); let result;
    for (const part of indices) result = send(c, { kind, op: 'snapshot', seq, part, total, data: text.slice(part * 3500, (part + 1) * 3500) });
    return result;
  };
  return { room, state, out, a, b, add, scene, send, publish, authority, get changes() { return changes; },
    tick: ms => { time += ms; for (const c of room.clients.values()) c.posT = time; },
    mutable: v => { mutable = v; }, epoch: v => { epoch = v; }, host: v => { host = v; } };
}
const reconstruct = packets => JSON.parse(packets.sort((a,b) => a.part-b.part).map(p => p.data).join(''));

test('boat and town rows preserve shared numeric pose, tools and boat attachment', () => {
  assert.equal(activityBoat(boat()).grounded, 0.3);
  assert.equal(activityNpc(npc()).lk[8], 65536);
  const carrying = npc(); carrying.lk[8] = 1 << 24; assert.equal(activityNpc(carrying).lk[8], 1 << 24);
  assert.equal(activityNpc(npc()).bt, 1);
  assert.equal(activityBoat({ ...boat(), id: 0 }), null);
  assert.equal(activityNpc({ ...npc(), id: 'town:1:villager:0' }), null);
  assert.equal(activityNpc({ ...npc(), p: [Infinity, 0, 0] }), null);
});

test('one admitted live host publishes the same complete town to every viewer', () => {
  const f = fixture();
  assert.equal(f.send(f.b, { kind: 'npcs', op: 'snapshot', seq: 1, npcs: [npc()] }), false);
  assert.equal(f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 1, npcs: [npc()] }), true);
  const m = f.out.get('b').at(-1);
  assert.equal(m.peer, 'a'); assert.deepEqual(m.npcs, [activityNpc(npc())]);
  assert.equal(f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 1, npcs: [] }), false);
  const before = f.out.get('a').length;
  f.scene.sync(f.room, f.a); f.scene.sync(f.room, f.a);
  assert.equal(f.out.get('a').length, before, 'slow frames do not resend the whole authority cache');
});

test('exclusive boat occupancy, rider-only motion and atomic mooring', () => {
  const f = fixture();
  f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 1, boats: [boat()] });
  assert.equal(f.send(f.b, { kind: 'boats', op: 'board', id: 1 }), true);
  assert.equal(f.send(f.a, { kind: 'boats', op: 'board', id: 1 }), false);
  assert.equal(f.send(f.a, { kind: 'boats', op: 'state', seq: 2, boats: [{ ...boat(), x: 1 }] }), false);
  f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 2, boats: [{ ...boat(), x: 400 }] });
  assert.equal(f.out.get('b').at(-1).boats[0].x, 0, 'host cannot overwrite a granted rider');
  f.tick(200);
  assert.equal(f.send(f.b, { kind: 'boats', op: 'state', seq: 3, boats: [{ ...boat(), x: 3, vx: 3 }] }), true);
  assert.equal(f.send(f.b, { kind: 'boats', op: 'state', seq: 3, boats: [{ ...boat(), x: 4 }] }), false);
  assert.equal(f.send(f.b, { kind: 'boats', op: 'state', seq: 4, boats: [{ ...boat(), x: 500 }] }), false);
  assert.equal(f.send(f.b, { kind: 'boats', op: 'moor', seq: 4, boats: [{ ...boat(), x: 4, st: 'moored' }] }), true);
  assert.equal(f.out.get('a').at(-1).boats[0].rider, null);
  assert.equal(f.state.activity.boats[0].rider, null, 'connection occupancy never enters the owned checkpoint');
});

test('boarding out of reach and stale or cross-world write authority are rejected', () => {
  const f = fixture();
  f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 1, boats: [boat()] });
  f.b.pos.x = 200;
  assert.equal(f.send(f.b, { kind: 'boats', op: 'board', id: 1 }), false);
  assert.equal(f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 2, authority: 'old', boats: [] }), false);
  assert.equal(f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 2, worldAdmission: { origin: 'https://other.test', epoch: 1 }, boats: [] }), false);
  f.mutable(false);
  const before = structuredClone(f.state);
  assert.equal(f.send(f.a, { kind: 'boats', op: 'board', id: 1 }), false);
  assert.deepEqual(f.state, before);
  f.mutable(true); f.a.live = false;
  assert.equal(f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 3, npcs: [] }), false);
});

test('partial chunks never publish; deltas are cached as a full late-join snapshot', () => {
  const f = fixture();
  const full = { v: 1, full: true, rows: [{ id: 'wolf:1', x: 1, meta: 'x'.repeat(4000) }, { id: 'wolf:2', x: 2 }], remove: [] };
  const text = JSON.stringify(full), total = Math.ceil(text.length / 3500), before = f.out.get('b').length;
  assert.equal(f.send(f.a, { kind: 'entities', op: 'snapshot', seq: 1, part: 1, total, data: text.slice(3500) }), true);
  assert.equal(f.out.get('b').length, before);
  assert.equal(f.send(f.a, { kind: 'entities', op: 'snapshot', seq: 1, part: 0, total, data: text.slice(0,3500) }), true);
  assert.equal(f.publish(f.a, 'entities', { v: 1, full: false, rows: [{ id: 'wolf:1', x: 9 }], remove: ['wolf:2'] }, 2), true);
  const c = f.add('c'); f.scene.sync(f.room, c);
  const value = reconstruct(f.out.get('c').filter(m => m.kind === 'entities'));
  assert.equal(value.full, true); assert.equal(value.rows.length,1); assert.equal(value.rows[0].x,9); assert.equal(value.rows[0].meta,'x'.repeat(4000));
  assert.equal(f.authority(c).hasEntities, true);
  assert.equal(f.send(f.a, { kind: 'entities', op: 'snapshot', seq: 1, part: 0, total: 1, data: '{}' }), false);
});

test('world parts retain receipts across deltas and replay once after authority handoff', () => {
  const f = fixture();
  const receipt = { id: 'b:1', to: 'b', ok: true, goods: [['timber', -2]], result: { pieceId: 1 } };
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: { build: { pieces: [1] }, farm: { stage: 1 } }, remove: [], receipts: [receipt] });
  f.publish(f.a, 'worldparts', { v: 1, full: false, parts: { farm: { stage: 2 } }, remove: [] }, 2);
  assert.deepEqual(f.state.activity.worldparts.receipts, [receipt]);
  const token = f.authority(f.a).authority;
  f.host('b'); f.a.live = false; f.scene.leave(f.a);
  assert.notEqual(f.authority(f.b).authority, token);
  const packets = f.out.get('b').filter(m => m.kind === 'worldparts' && m.authority === f.authority(f.b).authority);
  const value = reconstruct(packets);
  assert.deepEqual(value.parts.build, { pieces: [1] }); assert.equal(value.parts.farm.stage, 2);
  assert.deepEqual(value.receipts, [receipt]);
  assert.equal(f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 9, authority: token, npcs: [] }), false);
});

test('disconnect releases occupied boat at its last public position and resume replays it', () => {
  const f = fixture();
  f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 1, boats: [boat()] });
  f.send(f.b, { kind: 'boats', op: 'board', id: 1 }); f.tick(200);
  f.send(f.b, { kind: 'boats', op: 'state', seq: 3, boats: [{ ...boat(), x: 3 }] });
  f.b.live = false; f.scene.leave(f.b);
  assert.equal(f.state.activity.boats[0].x, 3);
  assert.equal(f.state.activity.boats[0].rider, null);
  const restored = fixture(structuredClone(f.state));
  assert.equal(restored.authority(restored.a).boats[0].x, 3);
  assert.equal(restored.authority(restored.a).boats[0].rider, null);
});

test('commands are stamped, bounded and deduplicated; only host targets results', () => {
  const f = fixture(), command = { id: 'b:5', op: 'build', args: [1] };
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command, from: 'spoof', position: { x: 9000 } }), true);
  const seen = f.out.get('a').at(-1);
  assert.equal(seen.from, 'b'); assert.deepEqual(seen.position, { x: 0, z: 0 });
  assert.equal(seen.realm, 0);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command }), false);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'result', to: 'a', id: 'b:5', ok: true }), false);
  const receipt = { id: 'b:5', ownerAccount: 'account-b', ok: true, goods: [['timber', -2]], result: { pieceId: 1 } };
  assert.equal(f.send(f.a, { kind: 'worldparts', op: 'result', to: 'b', ...receipt }), false, 'unpublished receipts are unavailable');
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: {}, remove: [], receipts: [receipt] });
  assert.equal(f.send(f.a, { kind: 'worldparts', op: 'result', to: 'b', ...receipt, goods: [['gold', 999]] }), true);
  assert.deepEqual(f.out.get('b').at(-1).goods, [['timber', -2]], 'only the canonical outcome is sent');
  assert.equal(f.out.get('b').at(-1).id, 'b:5');
  assert.deepEqual(f.out.get('b').at(-1).result, { pieceId: 1 });
  assert.equal(f.send(f.a, { kind: 'entities', op: 'result', to: 'b', result: { id: 1, kind: 'reward', gold: 3 } }), true);
  assert.equal(f.out.get('b').at(-1).result.gold, 3);
});

test('chunk count, malformed JSON, prototype keys, duplicate ids and merged size are bounded', () => {
  const f = fixture();
  assert.equal(f.send(f.a, { kind: 'entities', op: 'snapshot', seq: 1, part: 0, total: 129, data: '{}' }), false);
  assert.equal(f.send(f.a, { kind: 'entities', op: 'snapshot', seq: 1, part: 0, total: 1, data: 'not-json' }), false);
  assert.equal(f.publish(f.a, 'entities', { v: 1, full: true, rows: [{id:'same'}, {id:'same'}], remove: [] }), false);
  assert.equal(f.publish(f.a, 'worldparts', JSON.parse('{"v":1,"full":true,"parts":{"__proto__":{"bad":1}},"remove":[]}'), 2), false);
  assert.equal(f.state.activity, undefined);
});

test('latest-state persistence coalesces live frames and flushes final state with no idle timer', () => {
  const f = fixture();
  f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 1, npcs: [npc()] });
  for (let i=2;i<=10;i++) { f.tick(250); f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: i, npcs: [{ ...npc(), p: [i,2,0] }] }); }
  assert.equal(f.changes, 1);
  assert.equal(f.state.activity.npcs[0].p[0], 10);
  f.a.live = false; f.b.live = false; f.scene.leave(f.a);
  assert.equal(f.changes, 2);
  assert.equal(f.send(f.b, {kind:'npcs',op:'snapshot',seq:11,npcs:[]}), false);
});

test('ignition ejects a granted occupant; only nearby burnt boats can be restored', () => {
  const f = fixture();
  f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 1, boats: [boat()] });
  f.send(f.b, { kind: 'boats', op: 'board', id: 1 });
  assert.equal(f.send(f.a, { kind: 'boats', op: 'ignite', id: 1 }), true);
  assert.equal(f.out.get('b').at(-1).boats[0].rider, null);
  assert.equal(f.out.get('b').at(-1).boats[0].st, 'burning');
  assert.equal(f.send(f.a, { kind: 'boats', op: 'restore', id: 1, boats: [boat()] }), false);
  f.send(f.a, { kind: 'boats', op: 'snapshot', seq: 2, boats: [{ ...boat(), st: 'burnt' }] });
  assert.equal(f.send(f.b, { kind: 'boats', op: 'restore', id: 1, boats: [boat()] }), true);
  assert.equal(f.out.get('a').at(-1).boats[0].st, 'free');
});

test('canonical metadata and bounded receipts are retained in owned snapshots', () => {
  const f = fixture();
  const meta = { warbands: [{ id: 1, actors: ['guard:1'] }], caravans: [] };
  f.publish(f.a, 'entities', { v: 1, full: true, rows: [{ id: 'guard:1', x: 0 }], remove: [], meta });
  f.publish(f.a, 'entities', { v: 1, full: false, rows: [{ id: 'guard:1', x: 1 }], remove: [] }, 2);
  assert.deepEqual(f.state.activity.entities.meta, meta);
  assert.ok(checkedSharedScene(f.state.activity));
  assert.equal(checkedSharedScene({ ...f.state.activity, alien: true }), null);
  assert.equal(checkedSharedScene({ ...f.state.activity, boats: [{ ...boat(), rider: 'b' }] }), null);
});

test('global owned-snapshot budget refuses a candidate before any public change', () => {
  let fits = true;
  const f = fixture(null, { validatePersist: () => fits });
  f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 1, npcs: [npc()] });
  const kept = structuredClone(f.state.activity), bMessages = f.out.get('b').length;
  fits = false;
  assert.equal(f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 2, npcs: [{ ...npc(), p: [88,2,0] }] }), false);
  assert.deepEqual(f.state.activity, kept); assert.equal(f.out.get('b').length, bMessages);
  fits = true;
  assert.equal(f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 2, npcs: [{ ...npc(), p: [88,2,0] }] }), true);
  assert.equal(f.state.activity.npcs[0].p[0], 88);
});

test('combined scene budget rejects oversized streams and leaves last confirmed world intact', () => {
  const f = fixture();
  const rows = [...Array(8)].map((_, i) => ({ id: 'wolf:'+i, text: 'w'.repeat(24000) }));
  assert.equal(f.publish(f.a, 'entities', {v:1,full:true,rows,remove:[]}), true);
  const old = structuredClone(f.state.activity);
  const parts = Object.fromEntries([...Array(10)].map((_,i) => ['field'+i, 'c'.repeat(24000)]));
  assert.equal(f.publish(f.a, 'worldparts', {v:1,full:true,parts,remove:[]}), false);
  assert.deepEqual(f.state.activity, old);
});

test('actual ingress accepts a complete 27-worker roster above the ordinary 8KiB limit', async () => {
  const f = fixture(), { onMsg, stats } = await ingress(f);
  const workers = [...Array(27)].map((_, i) => ({ ...npc(), id: 'town:'+Math.floor(i/9)+':villager:'+(i%9),
    r:Math.floor(i/9), n:'A field worker with a persistent shared identity '+i,
    lk:[1.123456789,1.123456789,1.123456789,1.123456789,1.123456789,1.123456789,0.123456789,0.123456789,65536,0,1.0123456789,0,0,0,0.23456789] }));
  const msg = { t:'activity', kind:'npcs',op:'snapshot',seq:1,authority:f.authority(f.a).authority,worldAdmission:f.a.worldAdmission,npcs:workers };
  const raw = JSON.stringify(msg); assert.ok(raw.length > 8192);
  onMsg(f.a, raw);
  assert.equal(stats.badMsgs, 0); assert.equal(f.state.activity.npcs.length, 27);
  assert.equal(f.out.get('b').at(-1).npcs.length, 27);
  const before = f.out.get('a').length;
  onMsg(f.b, raw);
  assert.equal(stats.badMsgs, 1, 'a nonhost cannot use the larger ingress envelope');
  assert.equal(f.out.get('a').length, before);
});

test('actual ingress accepts more than 60 bounded snapshot fragments interleaved with player motion', async () => {
  const f = fixture(), { onMsg, stats, fast } = await ingress(f);
  const payload = {v:1,full:true,rows:[...Array(100)].map((_,i)=>({id:'world:'+i,info:'x'.repeat(2500)})),remove:[]};
  const text = JSON.stringify(payload), total=Math.ceil(text.length/3500);
  assert.ok(total>60);
  for(let part=0;part<total;part++) {
    onMsg(f.a, JSON.stringify({t:'activity',kind:'entities',op:'snapshot',seq:1,part,total,data:text.slice(part*3500,(part+1)*3500),authority:f.authority(f.a).authority,worldAdmission:f.a.worldAdmission}));
    if(part%10===0) onMsg(f.a, JSON.stringify({t:'fast',d:{p:[0,0,0]}}));
  }
  assert.equal(stats.rateDropped, 0); assert.equal(f.state.activity.entities.rows.length,100);
  assert.ok(fast()>=7);
});
async function ingress(f, extra = {}) {
  const fs = await import('node:fs'), vm = await import('node:vm');
  const source = fs.readFileSync(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function onMsg(c, raw) {'), end=source.indexOf('\n/* ------------------------------------------------------------------ */\n/* HTTP:',start);
  assert.ok(start>=0 && end>start);
  const stats={msgs:0,bytesIn:0,badMsgs:0,rateDropped:0,kicked:0};let fastCount=0;
  const context={STATS:stats,CFG:{maxMsg:8192,maxSave:768*1024},SHARED_SCENE:f.scene,Date,Buffer,console,
    nativePlayersRequired:false,WORLD_STATE:null,isHumanPlaying:c=>c.live,onFast:()=>fastCount++, ...extra};
  f.a.winT=Date.now();f.a.winN=0;f.a.ws={close:()=>{throw Error('unexpected transport close')}};
  f.b.winT=Date.now();f.b.winN=0;f.b.ws=f.a.ws;
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.onMsg=onMsg;',context);
  return {onMsg:context.onMsg,stats,fast:()=>fastCount};
}

test('compact entity deltas retain appearance while updating public pose and health', () => {
  const f=fixture();
  f.publish(f.a,'entities',{v:1,full:true,rows:[{id:'guard:1',look:{hat:'red'},kind:'humanoid',hp:50,x:0}],remove:[]});
  f.publish(f.a,'entities',{v:1,full:false,rows:[{id:'guard:1',hp:25,x:4}],remove:[]},2);
  assert.deepEqual(f.state.activity.entities.rows,[{id:'guard:1',look:{hat:'red'},kind:'humanoid',hp:25,x:4}]);
});

test('restoring the same world epoch invalidates unconfirmed scene authority and replays the restored cache', () => {
  const f=fixture();
  f.send(f.a,{kind:'boats',op:'snapshot',seq:1,boats:[boat()]});
  f.publish(f.a,'worldparts',{v:1,full:true,parts:{farm:{stage:1}},remove:[]});
  const confirmed=structuredClone(f.state.activity), oldToken=f.authority(f.a).authority;
  f.send(f.a,{kind:'boats',op:'snapshot',seq:2,boats:[{...boat(),x:100}]});
  f.publish(f.a,'worldparts',{v:1,full:false,parts:{farm:{stage:9}},remove:[]},2);
  f.state.activity=structuredClone(confirmed); // same operation as owned-world recover() replacement
  assert.equal(f.scene.acceptsChunk(f.a,{authority:oldToken,worldAdmission:f.a.worldAdmission}),false);
  assert.equal(f.send(f.a,{kind:'boats',op:'snapshot',seq:3,authority:oldToken,boats:[{...boat(),x:200}]}),false);
  assert.notEqual(f.authority(f.a).authority,oldToken);
  assert.equal(f.authority(f.b).boats[0].x,0);
  assert.equal(f.state.activity.worldparts.parts.farm.stage,1);
  const restoredToken=f.authority(f.a).authority;
  const restored=reconstruct(f.out.get('b').filter(m=>m.kind==='worldparts'&&m.authority===restoredToken));
  assert.equal(restored.parts.farm.stage,1);
});

test('ordinary shallow world merges keep authority; a rollback removing scene data cannot resurrect it', () => {
  const f=fixture();f.send(f.a,{kind:'boats',op:'snapshot',seq:1,boats:[boat()]});
  const token=f.authority(f.a).authority;
  f.scene.sync(f.room,f.a);
  assert.equal(f.authority(f.a).authority,token);
  delete f.state.activity; f.scene.sync(f.room);
  assert.notEqual(f.authority(f.a).authority,token);
  assert.deepEqual(f.authority(f.b).boats,[]);
  assert.equal(f.state.activity,undefined);
});

test('actual owned bridge recovery cannot republish unconfirmed shared scene within the same season', async t => {
  const { openHallowmarchWorldState } = await import('./gaming/hallowmarch-world-state.js');
  const { loadRealmModule } = await import('./season.js');
  const { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), path = await import('node:path');
  const dir=mkdtempSync(path.join(tmpdir(),'shared-scene-recovery-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let saved={version:0,state:null};
  const store={owner:'urn:hallowmarch:recovery-proof',async load(){return structuredClone(saved)},
    async commit(id,input){assert.equal(input.expectedVersion,saved.version);saved={version:saved.version+1,state:structuredClone(input.state)};return structuredClone(saved)}};
  const { fileURLToPath } = await import('node:url');
  const realmModule=loadRealmModule(fileURLToPath(new URL('../src',import.meta.url)),fileURLToPath(new URL('.',import.meta.url)));
  assert.ok(realmModule);
  const bridge=await openHallowmarchWorldState({nativeStore:store,dataDir:dir,files:{read:(n,d)=>d,write(){}},
    keepCount:6,realmModule,active:false});
  const worlds={}, room={name:'march',clients:new Map()}, strategic={RS:realmModule.realmSimInit(19,{season:1}),M:realmModule,lastStep:Date.now(),step(){},capture(){},contribute(){},order(){}};
  const field={held:new Map(),step(){},report(){},left(){}};
  bridge.attach({worlds,season:strategic,field,rooms:new Map([['march',room]])});
  const admission={origin:'https://game.test',epoch:1}, messages=[];
  const a={peer:'a',room,live:true,pos:{x:0,z:0},posT:Date.now(),worldAdmission:admission};
  room.clients.set('a',a);
  const scene=createSharedScene({hostFor:()=>a,live:c=>c.live,admission:()=>admission,
    stateFor:()=>worlds.march||=( {} ),canMutate:()=>bridge.canMutate(),changed:()=>bridge.capture(),
    send:(c,m)=>messages.push(structuredClone(m))});
  scene.sync(room);bridge.setActive(true);let token=messages.find(m=>m.kind==='authority').authority;
  const send=(seq,x)=>scene.handle(a,{t:'activity',kind:'boats',op:'snapshot',authority:token,worldAdmission:admission,seq,boats:[{...boat(),x}]});
  assert.equal(send(1,0),true);await bridge.checkpoint();
  const version=saved.version;
  assert.equal(send(2,100),true);
  assert.equal(worlds.march.activity.boats[0].x,100);assert.equal(saved.version,version,'later motion remains unconfirmed');
  await bridge.recover();
  assert.equal(worlds.march.activity.boats[0].x,0);
  assert.equal(send(3,200),false,'old page authority cannot overwrite recovered state');
  assert.notEqual(messages.filter(m=>m.kind==='authority').at(-1).authority,token);
  assert.equal(worlds.march.activity.boats[0].x,0);
  await bridge.shutdown({checkpoint:false});
});

test('owned animal bodies are live replicas, released on owner departure and never restored as orphan pets', () => {
  const f=fixture();
  f.publish(f.a,'entities',{v:1,full:true,rows:[{id:'wolf:1',hp:10},{id:'scene:petb:0',owner:'b',hp:20}],remove:[]});
  assert.deepEqual(f.state.activity.entities.rows,[{id:'wolf:1',hp:10}],'character-owned bodies do not enter game-owned durable state');
  const c=f.add('c');f.scene.sync(f.room,c);
  assert.equal(reconstruct(f.out.get('c').filter(m=>m.kind==='entities')).rows.length,2,'live late-join still sees the owner pet');
  f.b.live=false;f.scene.leave(f.b);
  const departed=f.out.get('a').find(m=>m.op==='owner-left');
  assert.equal(departed.owner,'b');assert.deepEqual(departed.ids,['scene:petb:0']);
  const d=f.add('d');f.scene.sync(f.room,d);
  assert.deepEqual(reconstruct(f.out.get('d').filter(m=>m.kind==='entities')).rows,[{id:'wolf:1',hp:10}]);
});

test('actual keep reporting follows the shared host even when another player stands in its region', async () => {
  const fs=await import('node:fs'),vm=await import('node:vm');
  const source=fs.readFileSync(new URL('./server.js',import.meta.url),'utf8');
  const cut=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i);return source.slice(i,j)};
  const room={name:'march',clients:new Map(),rep:[]}, calls=[], worlds={march:{k:[0],g:[1],td:0,tm:0,cn:1,cl:[[0,0],[0,0],[0,0]]}};
  const admission={origin:'https://game.test',epoch:1};
  const a={peer:'a',room,live:true,since:1,region:'f0',slow:{on:1},acct:{name:'A'},worldAdmission:admission};
  const b={peer:'b',room,live:true,since:2,region:'f1',slow:{on:1},acct:{name:'B'},worldAdmission:admission};
  room.clients.set('a',a);room.clients.set('b',b);
  let seasonal=[0];
  const context={isHumanPlaying:c=>c.live,Date,WORLD_STATE:null,WORLD:{keepCount:1},KEEP_REGION:['f1'],WORLDS:worlds,
    worldCheck:w=>w,worldAdmission:()=>admission,sameWorldAdmission:(x,y)=>x?.origin===y?.origin&&x?.epoch===y?.epoch,
    SEASON:{keepsOf:()=>seasonal,capture:(id,r,who)=>{calls.push({id,r,who});seasonal=[r]}},
    coCaptured(){},worldsSave(){},STATS:{worldTold:0},send(){}};
  vm.createContext(context);vm.runInContext(
    cut('function roomHost(R) {','const send =')+
    cut('function regionHosts(R) {','function regionsTell(')+
    cut('function worldReport(c, raw, admission) {','// [perf3] the host'),context);
  room.regions=context.regionHosts(room);
  assert.equal(room.regions.f1,'a');assert.equal(room.regions.h1,'a');
  const report=r=>({k:[r],g:[1],td:0,tm:0,cn:1,cl:[[0,0],[0,0],[0,0]]});
  assert.equal(context.worldReport(b,report(2),admission),true);
  assert.equal(worlds.march.k[0],0);assert.equal(calls.length,0,'regional follower cannot overwrite mirrored ownership');
  assert.equal(context.worldReport(a,report(1),admission),true);
  assert.equal(worlds.march.k[0],1);assert.equal(calls[0].r,1);
  a.live=false;room.regions=context.regionHosts(room);
  assert.equal(room.regions.f1,'b');
  assert.equal(context.worldReport(b,report(2),admission),true);
  assert.equal(worlds.march.k[0],2);assert.equal(calls[1].who,'B');
});

test('authenticated private settlement is account-bound and cannot be downgraded by a stale host frame', () => {
  const f=fixture(), receipt={id:'b:done',to:'b',ownerAccount:'account-b',digest:'opaque-outcome-token',ok:true,goods:[['timber',-2]],result:{pieceId:1}};
  f.publish(f.a,'worldparts',{v:1,full:true,parts:{build:{pieces:[1]}},remove:[],receipts:[receipt]});
  assert.equal(f.send(f.a,{kind:'worldparts',op:'settled',id:receipt.id,digest:receipt.digest,ownerAccount:'account-b'}),false,'another account cannot acknowledge the owner outcome');
  assert.equal(f.send(f.b,{kind:'worldparts',op:'settled',id:receipt.id,digest:'wrong'}),false);
  assert.equal(f.send(f.b,{kind:'worldparts',op:'settled',id:receipt.id,digest:receipt.digest,ownerAccount:'spoofed'}),true);
  assert.equal(f.state.activity.worldparts.receipts[0].settled,true);
  assert.equal(f.out.get('a').at(-1).ownerAccount,'account-b');
  assert.equal(f.out.get('a').at(-1).op,'settled');
  assert.equal(f.out.get('b').at(-1).op,'settled'); assert.equal(f.out.get('b').at(-1).digest,receipt.digest);
  f.publish(f.a,'worldparts',{v:1,full:false,parts:{},remove:[],receipts:[receipt]},2);
  assert.equal(f.state.activity.worldparts.receipts[0].settled,true,'a delayed old frame cannot reopen settled outcomes');
});

test('canonical receipts retain all unsettled outcomes and apply backpressure at 24', () => {
  const f=fixture(), receipts=[...Array(24)].map((_,i)=>({id:'b:'+i,to:'b',ownerAccount:'account-b',digest:'result-'+i,ok:true,goods:[],result:null}));
  assert.equal(f.publish(f.a,'worldparts',{v:1,full:true,parts:{farm:{stage:1}},remove:[],receipts}),true);
  assert.equal(f.publish(f.a,'worldparts',{v:1,full:false,parts:{farm:{stage:2}},remove:[],receipts:[]},2),true);
  assert.equal(f.state.activity.worldparts.receipts.length,24,'a publisher cannot silently evict unacknowledged outcomes');
  const next={id:'b:24',to:'b',ownerAccount:'account-b',digest:'result-24',ok:true,goods:[],result:null};
  assert.equal(f.publish(f.a,'worldparts',{v:1,full:false,parts:{farm:{stage:3}},remove:[],receipts:[next]},3),false);
  assert.equal(f.state.activity.worldparts.parts.farm.stage,2);
  assert.equal(f.send(f.b,{kind:'worldparts',op:'settled',id:'b:0',digest:'result-0'}),true);
  assert.equal(f.publish(f.a,'worldparts',{v:1,full:false,parts:{farm:{stage:3}},remove:[],receipts:[next]},3),true);
  assert.equal(f.state.activity.worldparts.receipts.filter(r=>!r.settled).length,24);
});

test('verified old production pages receive a reload notice without acquiring a human lease', async () => {
  const f=fixture(), sent=[],closed=[];let leases=0;
  const {onMsg}=await ingress(f,{nativePlayersRequired:true,PLAYER_ACCOUNTS:{humanPrincipalFor:()=>({subject:'owner'})},
    HUMAN_PLAY:{update(){leases++;return true}},send:(c,m)=>sent.push(m)});
  f.a.ws.close=(code,reason)=>closed.push({code,reason});
  onMsg(f.a,JSON.stringify({t:'slow',d:{on:1,humanLive:1,humanActivity:1}}));
  assert.equal(leases,0);assert.equal(closed[0].code,4006);
  assert.equal(sent[0].code,'shared_scene_upgrade_required');assert.match(sent[0].why,/saved character is preserved/);
});

test('unauthenticated legacy identity refusal is preserved before a protocol-upgrade notice', async () => {
  const f=fixture(), sent=[],closed=[];let profile='not-called';
  const {onMsg}=await ingress(f,{nativePlayersRequired:true,PLAYER_ACCOUNTS:{humanPrincipalFor:()=>null},
    HUMAN_PLAY:{update(c,p){profile=p;return false}},send:(c,m)=>sent.push(m)});
  f.a.ws.close=(code,reason)=>closed.push({code,reason});
  onMsg(f.a,JSON.stringify({t:'slow',d:{on:1,humanLive:1,humanActivity:1}}));
  assert.equal(profile,null);assert.equal(closed[0].code,4000);
  assert.equal(sent.some(m=>m.t==='reload-required'),false);
});

test('capable room hosts are preferred over older legacy pages without breaking all-legacy fixtures', async () => {
  const fs=await import('node:fs'),vm=await import('node:vm'),source=fs.readFileSync(new URL('./server.js',import.meta.url),'utf8');
  const start=source.indexOf('function roomHost(R) {'),end=source.indexOf('const send =',start);
  const context={isHumanPlaying:c=>c.live};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const old={peer:'old',live:true,since:1,slow:{on:1}}, fresh={peer:'new',live:true,since:2,slow:{on:1}};
  const room={clients:new Map([['old',old],['new',fresh]])};
  assert.equal(context.roomHost(room).peer,'old','legacy-only protocol fixtures retain the previous host rule');
  fresh.slow.sharedScene=1;
  assert.equal(context.roomHost(room).peer,'new','updated actor authority is never held by an earlier old page');
  fresh.live=false;assert.equal(context.roomHost(room).peer,'old');
});

test('only identical worldpart retries reach the keeper after the bounded retry delay', () => {
  const f = fixture(), command = { id: 'b:retry', op: 'resource.take', args: { node: 3 } };
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command }), true);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command }), false);
  f.tick(3000);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command }), true);
  assert.equal(f.out.get('a').filter(m => m.op === 'command').length, 2);
  f.tick(3000);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command: { ...command, args: { node: 4 } } }), false);
  const hit = { id: 'b:hit', op: 'hit', id2: 'wolf' };
  assert.equal(f.send(f.b, { kind: 'entities', op: 'command', command: hit }), true);
  f.tick(3000);
  assert.equal(f.send(f.b, { kind: 'entities', op: 'command', command: hit }), false);
});

test('private settlement reaches only the keeper after an exact canonical owner and receipt match', () => {
  const f = fixture();
  const receipt = { id: 'b:1', ownerAccount: 'account-b', digest: 'receipt-proof', ok: true, goods: [['stone', 2]] };
  assert.equal(f.publish(f.a, 'worldparts', { v: 1, full: true, parts: {}, remove: [], receipts: [receipt] }), true);
  const packet = { kind: 'worldparts', op: 'settled', id: receipt.id, digest: receipt.digest };
  assert.equal(f.send(f.a, { ...packet, ownerAccount: 'account-b', from: 'b' }), false);
  assert.equal(f.send(f.b, { ...packet, digest: 'wrong' }), false);
  assert.equal(f.send(f.b, { ...packet, id: 'unknown' }), false);
  assert.equal(f.send(f.b, { ...packet, kind: 'entities' }), false);
  const before = f.out.get('b').length;
  assert.equal(f.send(f.b, { ...packet, from: 'spoof', ownerAccount: 'account-a' }), true);
  const seen = f.out.get('a').at(-1);
  assert.equal(seen.op, 'settled'); assert.equal(seen.from, 'b'); assert.equal(seen.ownerAccount, 'account-b');
  assert.equal(seen.id, receipt.id); assert.equal(seen.digest, receipt.digest);
  assert.equal(f.out.get('b').length, before + 1);
  assert.equal(f.out.get('b').at(-1).op, 'settled');
  assert.equal(f.state.activity.worldparts.receipts[0].settled, true, 'authenticated private readback survives keeper departure');
});

const turn = () => new Promise(resolve => setImmediate(resolve));
const economicReceipt = () => ({ id: 'b:economic', ownerAccount: 'account-b', digest: 'native-proof', ok: true, goods: [['stone', 2]] });
test('native confirmation gates economic echoes, late joins, results and authority handoff', async () => {
  let release;
  const f = fixture(undefined, { confirm: () => new Promise(resolve => { release = resolve; }) });
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: { resource: { available: true } }, remove: [], receipts: [] });
  const before = f.out.get('b').length, receipt = economicReceipt();
  assert.equal(f.publish(f.a, 'worldparts', { v: 1, full: false, parts: { resource: { available: false } }, remove: [], receipts: [receipt] }, 2), true);
  assert.equal(f.state.activity.worldparts.parts.resource.available, false, 'the staged native snapshot contains the consumption');
  assert.equal(f.out.get('b').length, before, 'no unconfirmed public echo');
  assert.equal(f.scene.publicActivity(f.room).worldparts.parts.resource.available, true);
  assert.equal(f.send(f.a, { kind: 'worldparts', op: 'result', to: 'b', ...receipt }), false);
  f.send(f.a, { kind: 'npcs', op: 'snapshot', seq: 1, npcs: [npc()] });
  assert.equal(f.state.activity.worldparts.parts.resource.available, false, 'other persisted motion retains the staged economic mutation');
  const c = f.add('late'); f.scene.sync(f.room, c);
  assert.equal(f.authority(c).worldpartsReady, true);
  assert.equal(reconstruct(f.out.get('late').filter(m => m.kind === 'worldparts')).receipts.length, 0);
  const oldAuthority = f.authority(f.b).authority;
  f.a.live = false; f.host('b'); f.scene.leave(f.a);
  assert.equal(f.authority(f.b).authority, oldAuthority, 'new keeper cannot replay the old resource while the commit is pending');
  await Promise.resolve(); release(); await turn();
  assert.notEqual(f.authority(f.b).authority, oldAuthority);
  const canonical = reconstruct(f.out.get('b').filter(m => m.kind === 'worldparts' && m.authority === f.authority(f.b).authority));
  assert.equal(canonical.parts.resource.available, false);
  assert.equal(canonical.receipts[0].digest, receipt.digest);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'result', to: 'b', ...receipt, goods: [['stone', 999]] }), true);
  assert.deepEqual(f.out.get('b').at(-1).goods, [['stone', 2]]);
});

test('failed native confirmation fences economic changes without revealing a receipt', async () => {
  const f = fixture(undefined, { confirm: async () => { throw Error('native storage unavailable'); } });
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: {}, remove: [], receipts: [economicReceipt()] });
  await turn();
  const packets = f.out.get('b').filter(m => m.kind === 'worldparts');
  assert.equal(packets.length, 1); assert.equal(packets[0].ok, false);
  assert.equal(packets[0].reason, 'world_checkpoint_unconfirmed');
  assert.equal(f.scene.publicActivity(f.room).worldparts, null);
  assert.equal(f.send(f.a, { kind: 'worldparts', op: 'result', to: 'b', ...economicReceipt() }), false);
  const c = f.add('late'); f.scene.sync(f.room, c);
  assert.equal(f.authority(c).worldpartsReady, true);
  assert.equal(f.out.get('late').some(m => m.kind === 'worldparts'), false);
});

test('late native completion cannot revive a recovered scene in the same world epoch', async () => {
  let release;
  const f = fixture(undefined, { confirm: () => new Promise(resolve => { release = resolve; }) });
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: { resource: { available: false } }, remove: [], receipts: [economicReceipt()] });
  await Promise.resolve();
  f.state.activity = undefined;
  f.scene.sync(f.room);
  const authority = f.authority(f.b).authority, before = f.out.get('b').length;
  release(); await turn();
  assert.equal(f.authority(f.b).authority, authority);
  assert.equal(f.out.get('b').length, before);
  assert.equal(f.state.activity, undefined);
});

test('owned confirmation drains an older in-flight checkpoint and proves the captured version', async () => {
  let confirmed = 1, calls = 0;
  const world = { capture: () => ({ liveVersion: 3 }), status: () => ({ confirmedLiveVersion: confirmed }),
    checkpoint: async options => { assert.equal(options.allowInactive, true); confirmed = ++calls === 1 ? 2 : 3; } };
  await confirmOwnedSceneCheckpoint(world);
  assert.equal(calls, 2);
  confirmed = 0; calls = 0; world.checkpoint = async () => { calls++; };
  await assert.rejects(confirmOwnedSceneCheckpoint(world), /not confirmed/);
  assert.equal(calls, 3);
  world.status = () => ({ confirmedLiveVersion: 3, error: 'CHECKPOINT_UNCONFIRMED' });
  await assert.rejects(confirmOwnedSceneCheckpoint(world), /fenced/);
});

test('an authenticated settlement stays settled across another native commit and keeper departure', async () => {
  let hold = false, release;
  const f = fixture(undefined, { confirm: () => hold ? new Promise(resolve => { release = resolve; }) : Promise.resolve() });
  const first = economicReceipt(), second = { ...economicReceipt(), id: 'b:second', digest: 'second-proof' };
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: {}, remove: [], receipts: [first] });
  await turn(); hold = true;
  f.publish(f.a, 'worldparts', { v: 1, full: false, parts: { resource: false }, remove: [], receipts: [first, second] }, 2);
  await Promise.resolve();
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'settled', id: first.id, digest: first.digest }), true);
  assert.equal(f.state.activity.worldparts.receipts.find(r => r.id === first.id).settled, true);
  const late = f.add('late'); f.scene.sync(f.room, late);
  f.a.live = false; f.b.live = false; f.host('late'); f.scene.leave(f.a); f.scene.leave(f.b);
  release(); await turn();
  const authority = f.authority(late).authority;
  const value = reconstruct(f.out.get('late').filter(m => m.kind === 'worldparts' && m.authority === authority));
  assert.equal(value.receipts.find(r => r.id === first.id).settled, true);
  assert.equal(value.receipts.find(r => r.id === second.id).digest, second.digest);
});

test('ordinary public work does not force an economic native checkpoint', () => {
  let confirmations = 0;
  const f = fixture(undefined, { confirm: () => { confirmations++; } });
  f.publish(f.a, 'worldparts', { v: 1, full: true, parts: { hammer: 1 }, remove: [],
    receipts: [{ id: 'b:work', ownerAccount: 'account-b', digest: 'public-work', durable: false, ok: true }] });
  assert.equal(confirmations, 0);
  const value = reconstruct(f.out.get('b').filter(m => m.kind === 'worldparts'));
  assert.equal(value.parts.hammer, 1);
});

test('cold discovery and withdrawal do not allocate or persist a world before a live keeper exists', () => {
  let reads = 0, writes = 0, active = false;
  const worlds = {}, room = { name: 'cold', clients: new Map() }, client = { peer: 'cold', room };
  room.clients.set(client.peer, client);
  const scene = createSharedScene({ hostFor: () => active ? client : null, live: () => active,
    admission: () => ({ origin: 'https://game.test', epoch: 1 }),
    stateFor: () => { reads++; return worlds.cold ||= {}; }, send() {}, changed() { writes++; } });
  scene.sync(room, client); scene.leave(client);
  assert.deepEqual(worlds, {}); assert.equal(reads, 0); assert.equal(writes, 0);
  active = true; scene.sync(room, client);
  assert.ok(reads > 0); assert.equal(writes, 0);
});

test('live scene discovery reads are pure until a validated scene is actually published', () => {
  const worlds = {}, room = { name: 'march', clients: new Map() }, client = { peer: 'owner', room, worldAdmission: { origin: 'https://game.test', epoch: 1 } };
  room.clients.set(client.peer, client);
  let writes = 0;
  const scene = createSharedScene({ hostFor: () => client, live: () => true,
    admission: () => ({ origin: 'https://game.test', epoch: 1 }),
    stateFor: () => worlds.march || {}, writeState: (_, value) => { worlds.march = { activity: value }; writes++; },
    send() {} });
  const current = scene.sync(room, client);
  assert.deepEqual(worlds, {}); assert.equal(writes, 0);
  assert.equal(scene.handle(client, { t: 'activity', kind: 'boats', op: 'snapshot', seq: 1,
    authority: current.authority, worldAdmission: current.worldAdmission, boats: [boat()] }), true);
  assert.equal(writes, 1); assert.equal(worlds.march.activity.boats[0].id, 1);
});
