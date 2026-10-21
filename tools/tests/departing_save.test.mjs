import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHumanPlayGate } from '../../server/human-play.js';
const server = readFileSync(new URL('../../server/server.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../src/12_save.js', import.meta.url), 'utf8');
const between = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)+a.length));
const onMsg = between(server, 'function onMsg(', '/* ------------------------------------------------------------------ */');
const endSession = between(server, 'function endHumanSession(', 'function resumeHumanSession(');
function routing() {
  let now=1000; const sent=[], writes=[];
  const room={clients:new Map()}, owner={acct:{id:'owner'},room,peer:'owner',ws:{close(){}},winT:now,winN:0};
  room.clients.set(owner.peer,owner);
  let context;
  const gate=createHumanPlayGate({clock:()=>now,onSessionEnd:c=>context.endHumanSession(c),setTimer:()=>({unref(){}}),clearTimer(){}});
  context=vm.createContext({
    Date:{now:()=>now}, JSON, Map, console, STATS:{msgs:0,bytesIn:0,badMsgs:0,saves:0},
    CFG:{maxMsg:65536,maxSave:1048576}, HUMAN_PLAY:gate,isHumanPlaying:gate.isPlaying,
    nativePlayersRequired:false,PLAYER_ACCOUNTS:{principalFor:()=>null,isBound:()=>false,status:()=>({enabled:true})},
    WORLD_STATE:null,FIELD:{left(){}},worldAgentTransport:{close(){}},regionsTell(){},
    clearTimeout(){},resumeHumanSession(){},accountsSave(){},onSlow(c,d){c.slow=d;},
    send:(c,m)=>sent.push(m),store:{write:(p,d)=>writes.push({p,d})},path:{join:(...p)=>p.join('/')},
    gamingEnvironment:{},process:{env:{}}
  });
  vm.runInContext(endSession+'\n'+onMsg+'\nglobalThis.H={onMsg,endHumanSession};',context);
  return {owner,room,sent,writes,gate,send:m=>context.H.onMsg(owner,JSON.stringify(m)),advance:ms=>{now+=ms;}};
}
const live=n=>({t:'slow',d:{on:1,humanLive:1,humanActivity:n,r:0}});
test('actual routing accepts one departing save after withdrawal without reopening its human lease',()=>{
  const f=routing();
  f.send({t:'save',final:1,d:{v:1,char:{xp:1}}});
  assert.equal(f.writes.length,0,'cold sockets have no final-save allowance');
  f.send(live(1));assert.equal(f.gate.count(),1);
  f.send({t:'slow',d:{on:0,humanLive:0,humanActivity:1}});assert.equal(f.gate.count(),0);
  f.send({t:'save',final:1,d:{v:1,char:{xp:7}}});
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].d.char.xp,7);assert.equal(f.gate.count(),0);
  f.send({t:'save',final:1,d:{v:1,char:{xp:8}}});
  assert.equal(f.writes.length,1);assert.equal(f.sent.at(-1).error,'human_play_required');
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
    WORLD_STATE:null,SEASON:{RS:{t:10},speed:1,summary:()=>({}),rosterOf:(r,ids)=>{online=ids;return ids;}},
    STATS:{seasonPushes:0},send(){},COMP:{canParticipate:()=>true},PLAYER_ACCOUNTS:{isBound:()=>false,principalFor:()=>null}
  });
  vm.runInContext(between(server,'function seasonTell(', 'function onContrib(')+'\n'+
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
