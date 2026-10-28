import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { realmManagementReloadRequired } from '../../server/realm-management.js';
import { realmLogisticsView } from '../../server/realm-logistics.js';
import { createHumanPlayGate } from '../../server/human-play.js';
const server = readFileSync(new URL('../../server/server.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../src/12_save.js', import.meta.url), 'utf8');
const between = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length));
const roomNeedsWarbandOrders = between(server, 'function roomNeedsWarbandOrders(', 'function roomHost(');
const onMsg = between(server, 'function onMsg(', '/* ------------------------------------------------------------------ */');
const endSession = between(server, 'function endHumanSession(', 'function resumeHumanSession(');
function routing({ nativeRequired = false, verified = true } = {}) {
  let now=1000, principalVerified=verified; const sent=[], writes=[], sceneLeaves=[], closes=[];
  const room={clients:new Map()}, owner={acct:{id:'owner'},room,peer:'owner',ws:{close:(code,reason)=>closes.push({code,reason})},winT:now,winN:0};
  room.clients.set(owner.peer,owner);
  let context;
  const gate=createHumanPlayGate({clock:()=>now,onSessionEnd:c=>context.endHumanSession(c),setTimer:()=>({unref(){}}),clearTimer(){}});
  context=vm.createContext({
    Date:{now:()=>now}, JSON, Map, console, STATS:{msgs:0,bytesIn:0,badMsgs:0,saves:0},
    CFG:{maxMsg:65536,maxSave:1048576}, HUMAN_PLAY:gate,isHumanPlaying:gate.isPlaying,
    realmManagementReloadRequired, nativePlayersRequired:nativeRequired,PLAYER_ACCOUNTS:{humanPrincipalFor:()=>principalVerified?'did:example:owner':null,principalFor:()=>null,isBound:()=>false,status:()=>({enabled:true})},
    WORLD_STATE:null,WORLDS:{},SHARED_SCENE:{leave:c=>sceneLeaves.push(c)},FIELD:{left(){}},worldAgentTransport:{close(){}},regionsTell(){},
    clearTimeout(){},resumeHumanSession(){},accountsSave(){},onSlow(c,d){c.slow=d;},
    send:(c,m)=>sent.push(m),store:{write:(p,d)=>writes.push({p,d})},path:{join:(...p)=>p.join('/')},
    gamingEnvironment:{},process:{env:{}}
  });
  vm.runInContext(roomNeedsWarbandOrders+'\n'+endSession+'\n'+onMsg+'\nglobalThis.H={onMsg,endHumanSession};',context);
  return {owner,room,sent,writes,sceneLeaves,closes,gate,send:m=>context.H.onMsg(owner,JSON.stringify(m)),advance:ms=>{now+=ms;},setVerified:value=>{principalVerified=value;}};
}
const live=n=>({t:'slow',d:{on:1,humanLive:1,humanActivity:n,realmManagement:1,seasonField:2,sharedScene:2, sharedCombat: 1, actorDevelopment: 1,r:0}});

test('actual routing acknowledges admitted play and distinguishes menu standby from missing native identity',()=>{
  const f=routing({nativeRequired:true});
  f.send(live(1)); assert.equal(f.gate.count(),1);
  const statuses=()=>f.sent.filter(m=>m.t==='world-status');
  assert.equal(statuses().at(-1)?.admission,'live');
  f.send(live(1)); assert.equal(statuses().length,1,'unchanged admitted profiles do not spam status');
  f.send({t:'slow',d:{on:0,humanLive:0,humanActivity:1}});
  assert.equal(f.gate.count(),0); assert.equal(statuses().at(-1)?.admission,'standby');
  assert.equal(statuses().at(-1)?.code,'human_play_required');
  f.setVerified(false); f.send(live(2));
  assert.equal(f.gate.count(),0); assert.equal(statuses().at(-1)?.admission,'identity-required');
  assert.equal(statuses().at(-1)?.code,'native_signin_required');
  assert.match(statuses().at(-1)?.why,/identity/i);
  assert.equal(f.writes.length,0,'identity refusal cannot write or reopen play');
  f.setVerified(true); f.send(live(2));
  assert.equal(f.gate.count(),1); assert.equal(statuses().at(-1)?.admission,'live');
  assert.equal(f.owner.finalSaveUntil,0,'normal resume retains the original departure fence');
});

test('cold native refusal reports the missing admission before closing without granting a human lease',()=>{
  const f=routing({nativeRequired:true,verified:false}); f.send(live(1));
  assert.equal(f.gate.count(),0); assert.equal(f.sent.at(-1)?.admission,'identity-required');
  assert.equal(f.sent.at(-1)?.code,'native_signin_required'); assert.equal(f.closes[0]?.code,4000);
  assert.equal(f.writes.length,0); assert.equal(f.owner.hasPlayedLive,undefined);
});

test('an expired live lease reports standby and requires fresh input before reporting admission again',()=>{
  const f=routing({nativeRequired:true}); f.send(live(1)); f.advance(90001); f.send(live(1));
  assert.equal(f.gate.count(),0); assert.equal(f.sent.at(-1)?.admission,'standby');
  assert.equal(f.sent.at(-1)?.code,'human_play_required');
  f.send(live(2)); assert.equal(f.gate.count(),1); assert.equal(f.sent.at(-1)?.admission,'live');
  assert.equal(f.writes.length,0);
});
test('actual routing accepts one departing save after withdrawal without reopening its human lease',()=>{
  const f=routing();
  f.send({t:'save',final:1,d:{v:1,char:{xp:1}}});
  assert.equal(f.writes.length,0,'cold sockets have no final-save allowance');
  f.send(live(1));assert.equal(f.gate.count(),1);
  f.owner.sceneAuthority='owner-lease';
  f.send({t:'slow',d:{on:0,humanLive:0,humanActivity:1}});assert.equal(f.gate.count(),0);
  assert.equal(f.sceneLeaves.length,1);assert.equal(f.sceneLeaves[0],f.owner);assert.equal(f.owner.sceneAuthority,'');
  f.send({t:'save',final:1,d:{v:1,char:{xp:7}}});
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].d.char.xp,7);assert.equal(f.gate.count(),0);
  f.send({t:'save',final:1,d:{v:1,char:{xp:8}}});
  assert.equal(f.writes.length,1);assert.equal(f.sent.at(-1).error,'human_play_required');
  assert.equal(f.sceneLeaves.length,1,'final saves must not repeat scene departure');assert.equal(f.gate.count(),0);
});
test('departing save allowance expires and invalid attempts consume it',()=>{
  for(const invalid of [false,true]){
    const f=routing();f.send(live(1));f.send({t:'slow',d:{on:0}});
    if(invalid)f.send({t:'save',final:1,d:{invalid:true}});else f.advance(10000);
    f.send({t:'save',final:1,d:{v:1,char:{xp:9}}});
    assert.equal(f.writes.length,0);assert.equal(f.gate.count(),0);
  }
});
function saving({blocked=false,fail=false}={}){
  let now=1000,release;const calls=[],local=[];
  const chain=blocked?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  const s={v:1,char:{xp:8}},body=JSON.stringify({...s,savedAt:0});
  const SAVE={timer:0,wiping:false,native:false,server:true,chain,lastBody:body,lastCore:'same',
    ref:{set:async(value,options)=>{calls.push({value,options});if(fail)throw {code:'unavailable'};}}};
  const context=vm.createContext({SAVE,GAME:{ready:true,player:{}},CAPTURE:{on:false},Date:{now:()=>now},
    Promise,JSON,Math,clearTimeout(){},buildSave:()=>s,coreKey:()=> 'same',netHumanLive:()=>false,
    setTimeout(){throw Error('an idle final save must never schedule a retry');},
    localStorage:{setItem:(key,value)=>local.push(value)}});
  vm.runInContext(between(client,'function saveNow(', '// a slow heartbeat:')+'\nglobalThis.save=saveNow;',context);
  return {calls,local,save:()=>context.save({final:true}),advance:ms=>{now+=ms;},release:()=>release()};
}
test('final legacy save dispatches behind its chain even when an earlier pending body already matched',async()=>{
  const f=saving();await f.save();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.final,true);
});
test('failed final save retains local progress without retry; expired queue never dispatches from standby',async()=>{
  const failed=saving({fail:true});await failed.save();assert.equal(failed.calls.length,1);assert.equal(failed.local.length,1);
  const late=saving({blocked:true});const pending=late.save();late.advance(10001);late.release();await pending;
  assert.equal(late.calls.length,0);assert.equal(late.local.length,1);
});
test('actual realm and company online rosters exclude authenticated dormant and agent sockets',()=>{
  const liveOwner={acct:{id:'live'},realm:0,live:true};
  const dormant={acct:{id:'idle'},realm:0,live:false},agent={acct:{id:'agent'},realm:0,live:false};
  const room={clients:new Map([['live',liveOwner],['idle',dormant]])};
  liveOwner.room=room;const other={clients:new Map([['agent',agent]])};
  let online;
  const context=vm.createContext({
    ROOMS:new Map([['main',room],['other',other]]),isHumanPlaying:c=>c.live===true,
    WORLD_STATE:null,realmLogisticsView,SEASON:{RS:{t:10},speed:1,summary:()=>({}),rosterOf:(r,ids)=>{online=ids;return ids;}},
    STATS:{seasonPushes:0},send(){},COMP:{canParticipate:()=>true},PLAYER_ACCOUNTS:{isBound:()=>false,principalFor:()=>null}
  });
  vm.runInContext(between(server,'function realmConfirmedLogisticsView(', 'const realmConfirmationWaiters=')+'\n'+
    between(server,'function seasonTell(', 'function onContrib(')+'\n'+
    between(server,'const coClients =', '// a player told its company')+'\nglobalThis.H={seasonTell,coOnline};',context);
  context.H.seasonTell(liveOwner,-1,false);
  assert.deepEqual([...online],['live']);assert.deepEqual([...context.H.coOnline()],['live']);
});

test('resuming clears the old final allowance before the next accepted live session',()=>{
  const f=routing();f.send(live(1));f.send({t:'slow',d:{on:0}});
  assert.ok(f.owner.finalSaveUntil>0);
  f.send(live(2));assert.equal(f.owner.finalSaveUntil,0);
});
test('ordinary queued legacy saves skip idle dispatch before the final capture',async()=>{
  const f=saving({blocked:true});
  // The actual default path must preserve local fallback without using a legacy request.
  const ordinarySource=between(client,'function saveNow(', '// a slow heartbeat:');
  let writes=0,local=0,release;
  const SAVE={timer:0,wiping:false,native:false,server:true,chain:new Promise(r=>{release=r;}),lastBody:'',lastCore:'',
    ref:{set:async()=>{writes++;}}};
  const c=vm.createContext({SAVE,GAME:{ready:true,player:{}},CAPTURE:{on:false},Date,Promise,JSON,Math,
    clearTimeout(){},buildSave:()=>({v:1,char:{xp:7}}),coreKey:()=> 'core',netHumanLive:()=>false,
    localStorage:{setItem(){local++;}},setTimeout(){throw Error('No idle retry');}});
  vm.runInContext(ordinarySource+'\nglobalThis.save=saveNow;',c);
  const pending=c.save();release();await pending;
  assert.equal(writes,0);assert.equal(local,1);
});

function nativeSaving({ provisional = false, queued = false } = {}) {
  let now = 1000, live = true, release, releaseQueue, version = 1;
  const calls = [], timers = new Map(); let nextTimer = 0;
  const ref = { set(value) {
    calls.push(structuredClone(value));
    if (calls.length === 1) return new Promise(resolve => { release = resolve; });
    return Promise.resolve();
  } };
  const SAVE = { timer: 0, wiping: false, native: true, nativePaused: false, nativeFlight: null,
    pending: null, lastBody: '', lastCore: '', guestWriteAt: 0, guestTimer: 0, ref,
    chain: queued ? new Promise(resolve => { releaseQueue = resolve; }) : Promise.resolve() };
  const context = vm.createContext({ SAVE, GAME: { ready: true, player: {} }, CAPTURE: { on: false },
    Date: { now: () => now }, performance: { now: () => now }, Promise, JSON, Math,
    netHumanLive: () => live, nativePlayerIsProvisional: () => provisional,
    buildSave: () => ({ v: 1, char: { name: 'Same native owner', xp: version } }),
    coreKey: value => JSON.stringify(value), NATIVE_PLAYER: {}, nativePlayerRender() {},
    nativePlayerError: code => Object.assign(Error(code), { code }),
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(between(client, 'function nativeSavePending(', '// a slow heartbeat:')
    + '\nglobalThis.H={saveNow,nativeSavePending};', context);
  return { SAVE, calls, timers, ref, save: options => context.H.saveNow(options),
    async started() { for (let n = 0; n < 8; n++) await Promise.resolve(); },
    pause() { live = false; }, resume() { live = true; },
    next() { version++; }, advance(ms) { now += ms; },
    release() { release(); }, releaseQueue() { releaseQueue(); } };
}

test('a final native snapshot queued during another write is confirmed after pause, including paced guests', async () => {
  for (const provisional of [false, true]) {
    const f = nativeSaving({ provisional });
    const active = f.save(); await f.started();
    assert.equal(f.calls.length, 1);
    f.next(); f.pause(); const final = f.save({ final: true });
    assert.equal(active, final, 'one native publication flight owns the final capture too');
    f.release(); await final; await f.started();
    assert.deepEqual(f.calls.map(value => value.char.xp), [1, 2]);
    assert.equal(f.SAVE.pending, null);
    assert.equal(f.SAVE.nativeFlight, null);
    assert.equal(JSON.parse(f.SAVE.lastBody).char.xp, 2);
    assert.equal(f.SAVE.ref, f.ref, 'the original character reference is retained');
    assert.equal(f.timers.size, 0, 'a final guest capture bypasses pacing without an idle retry');
  }
});

test('a departing native request cannot authorize a different later idle snapshot', async () => {
  const f = nativeSaving(); const active = f.save(); await f.started();
  f.next(); f.pause(); f.save({ final: true });
  f.next(); f.save(); // A later callback dirties another body without a new final request.
  f.release(); await active; await f.started();
  assert.deepEqual(f.calls.map(value => value.char.xp), [1]);
  assert.equal(f.SAVE.pending.char.xp, 3);
  assert.equal(f.timers.size, 0);
  f.resume(); await f.save();
  assert.deepEqual(f.calls.map(value => value.char.xp), [1, 3]);
});

test('a final native capture expires while waiting behind an active write', async () => {
  const f = nativeSaving(); const active = f.save(); await f.started();
  f.next(); f.pause(); f.save({ final: true });
  f.advance(10001); f.release(); await active; await f.started();
  assert.deepEqual(f.calls.map(value => value.char.xp), [1]);
  assert.equal(f.SAVE.pending.char.xp, 2);
  assert.equal(f.timers.size, 0, 'standby cannot schedule the expired final capture');
});

test('a queued native final capture cannot start from standby after its request window', async () => {
  const f = nativeSaving({ queued: true }); f.pause();
  const final = f.save({ final: true }); f.advance(10001); f.releaseQueue();
  await final; await f.started();
  assert.equal(f.calls.length, 0);
  assert.equal(f.SAVE.pending.char.xp, 1);
  assert.equal(f.timers.size, 0);
});

test('a final native request gets its own bounded window behind an older queued save', async () => {
  const f = nativeSaving({ queued: true }); const active = f.save();
  f.advance(9000); f.next(); f.pause(); f.save({ final: true });
  f.advance(2000); f.releaseQueue(); await f.started();
  assert.deepEqual(f.calls.map(value => value.char.xp), [2], 'the final request is fresh despite the older queue deadline');
  f.release(); await active; await f.started();
  assert.equal(f.SAVE.pending, null);
  assert.equal(f.timers.size, 0);
});

test('a departing native capture does not carry its idle authorization to a changed character reference', async () => {
  const f = nativeSaving(); const active = f.save(); await f.started();
  f.next(); f.pause(); f.save({ final: true });
  let foreignWrites = 0;
  f.SAVE.ref = { async set() { foreignWrites++; } };
  f.release(); await active; await f.started();
  assert.equal(foreignWrites, 0);
  assert.equal(f.SAVE.pending.char.xp, 2);
});

test('a native final capture queued before first dispatch cannot follow a changed character reference', async () => {
  const f = nativeSaving({ queued: true }); f.pause();
  const pending = f.save({ final: true });
  let foreignWrites = 0;
  f.SAVE.ref = { async set() { foreignWrites++; } };
  f.releaseQueue(); await pending; await f.started();
  assert.equal(foreignWrites, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.SAVE.pending.char.xp, 1);
  assert.equal(f.timers.size, 0);
});

test('a queued native final request cannot authorize a later idle body before first dispatch', async () => {
  const f = nativeSaving({ queued: true }); const pending = f.save();
  f.next(); f.pause(); f.save({ final: true });
  f.next(); f.save();
  f.releaseQueue(); await f.started();
  if (f.calls.length) f.release(); // Fail promptly if a regression started an unauthorized publication.
  await pending; await f.started();
  assert.deepEqual(f.calls, []);
  assert.equal(f.SAVE.pending.char.xp, 3);
  assert.equal(f.timers.size, 0);
  f.resume(); const resumed = f.save(); await f.started(); f.release(); await resumed;
  assert.deepEqual(f.calls.map(value => value.char.xp), [3]);
});

test('an unchanged initial native capture may dispatch from its bounded idle window', async () => {
  const f = nativeSaving({ queued: true }); const pending = f.save();
  f.pause(); f.advance(9000); f.releaseQueue(); await f.started();
  assert.deepEqual(f.calls.map(value => value.char.xp), [1]);
  assert.equal(f.SAVE.ref, f.ref);
  f.release(); await pending; await f.started();
  assert.equal(f.SAVE.pending, null);
  assert.equal(f.timers.size, 0);
});
