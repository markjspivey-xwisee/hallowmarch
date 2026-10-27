import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSharedScene } from '../../server/shared-scene.js';
import { isDeepStrictEqual } from 'node:util';
import { createRealmManagementProtocol, realmManagementReloadRequired } from '../../server/realm-management.js';
import { realmLogisticsApply, realmLogisticsGateReport } from '../../server/realm-logistics.js';
const client=()=>({realm:0,acct:{id:'account-one'},room:{diagnostic:false},seated:true});
const request=(nonce='nonce-one',revision=0,args={type:'build',cost:10})=>({q:1,o:{kind:'manage',nonce,season:1,revision,hall:15,args}});
function fixture(options={}){
  const sent=[],state=options.state||{n:1,management:{v:1,revision:0},realms:[{s:[100]},{s:[100]},{s:[100]}],managementReceipts:[]};
  let confirmations=0,applied=0,saves=0;
  const season={RS:state,M:{
    realmManageAction(RS,realm,args){applied++;if(args.fail){RS.realms[realm].s[0]-=5;return{ok:false,why:'No plot'};}
      RS.realms[realm].s[0]-=args.cost||10;RS.management.revision++;return{ok:true,message:'Built',revision:RS.management.revision};},
    realmManageView:RS=>({v:1,revision:RS.management.revision})},save(){saves++;}};
  const protocol=createRealmManagementProtocol({season,commanderFor:c=>c.seated?{realm:c.realm}:null,
    confirm:async(r,o)=>{confirmations++;await options.confirm?.(r,o);},send:(c,m)=>sent.push(m),delegates:options.delegates||{},canMutate:()=>options.mutable!==false,viewFor:options.viewFor});
  return{season,protocol,sent,get confirmations(){return confirmations;},get applied(){return applied;},get saves(){return saves;}};
}
test('realm management requires the actual live seat; payload realm cannot supply authority',async()=>{
  const f=fixture(),c=client();c.seated=false;
  await f.protocol.handle(c,request('no-seat-a',0,{type:'build',cost:10,realm:2,rank:20}));
  assert.equal(f.applied,0);assert.equal(f.season.RS.realms[0].s[0],100);assert.equal(f.sent.at(-1).code,'throne_required');
});
test('malformed season, revision, nonce and oversized command never charge resources',async()=>{
  const f=fixture(),c=client();
  for(const change of [{season:-1},{revision:NaN},{nonce:'short'},{args:{type:'build',x:'x'.repeat(2100)}}]){
    const m=request();Object.assign(m.o,change);await f.protocol.handle(c,m);
  }
  assert.equal(f.applied,0);assert.equal(f.saves,0);assert.equal(f.sent.length,4);
});
test('stale season or revision is rejected before spending',async()=>{
  const f=fixture(),c=client(),a=request();a.o.season=2;await f.protocol.handle(c,a);
  await f.protocol.handle(c,request('stale-revision',5));
  assert.equal(f.applied,0);assert.equal(f.sent[0].code,'stale_season');assert.equal(f.sent[1].code,'stale_revision');
});
test('exact retry after JSON restart confirms the stored receipt without another charge',async()=>{
  const c=client(),f=fixture();await f.protocol.handle(c,request());
  assert.equal(f.sent.at(-1).confirmed,true);assert.equal(f.season.RS.realms[0].s[0],90);
  const restarted=fixture({state:JSON.parse(JSON.stringify(f.season.RS))});await restarted.protocol.handle(c,request());
  assert.equal(restarted.applied,0);assert.equal(restarted.saves,0);assert.equal(restarted.confirmations,1);
  assert.equal(restarted.season.RS.realms[0].s[0],90);assert.equal(restarted.sent.at(-1).confirmed,true);
});
test('same nonce cannot be reused with a different payload or another character realm',async()=>{
  const f=fixture(),c=client();await f.protocol.handle(c,request());
  await f.protocol.handle(c,request('nonce-one',0,{type:'build',cost:20}));
  assert.equal(f.sent.at(-1).code,'nonce_conflict');
  c.realm=1;await f.protocol.handle(c,request());assert.equal(f.sent.at(-1).code,'nonce_conflict');
  assert.equal(f.applied,1);assert.equal(f.season.RS.realms[1].s[0],100);
});
test('a failed action cannot leave partial mutations in canonical realm state',async()=>{
  const f=fixture();await f.protocol.handle(client(),request('failed-action',0,{type:'build',fail:true}));
  assert.equal(f.season.RS.realms[0].s[0],100);assert.equal(f.season.RS.management.revision,0);assert.equal(f.saves,0);
});
test('native failure remains pending; retry does not reserve the price twice',async()=>{
  let fail=true;const f=fixture({confirm:()=>{if(fail)throw Error('native unavailable');}}),c=client();
  await f.protocol.handle(c,request());assert.equal(f.sent.at(-1).ok,false);assert.equal(f.sent.at(-1).pending,true);
  assert.equal(f.sent.at(-1).confirmed,false);assert.equal(f.season.RS.realms[0].s[0],90);
  fail=false;await f.protocol.handle(c,request());assert.equal(f.applied,1);assert.equal(f.sent.at(-1).confirmed,true);
});
test('acceptance serializes competing revisions without holding the lane for native IO',async()=>{
  let release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const f=fixture({confirm:async()=>{entered();await waiting;}}),c=client();
  const first=f.protocol.handle(c,request());await started;
  await f.protocol.handle(c,request('second-order',0));
  assert.equal(f.sent.at(-1).code,'stale_revision');assert.equal(f.applied,1);release();await first;
});
test('grant is rechecked when a queued command executes',async()=>{
  const f=fixture(),c=client();const action=f.protocol.handle(c,request());c.seated=false;await action;
  assert.equal(f.applied,0);assert.equal(f.sent.at(-1).code,'throne_required');
});
test('logistics uses the same resource lane but defers confirmation without a throne grant',async()=>{
  let release;const waiting=new Promise(r=>release=r);let mode;
  const f=fixture({confirm:async(_,o)=>{mode=o;await waiting;},delegates:{logistics:{deferred:true,
    actorFor:c=>c.keeper?{realm:c.realm}:null,apply(RS,actor,args){RS.realms[actor.realm].s[0]-=20;RS.management.revision++;
      return{ok:true,message:'Convoy reserved',data:{jobId:'job-one',lease:'lease-one'}};}}}});
  const c=client();c.seated=false;c.keeper=true;const m=request('logistics-one');m.o.kind='logistics';delete m.o.hall;
  const result=f.protocol.handle(c,m);await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(f.season.RS.realms[0].s[0],80);assert.equal(f.protocol.status().queued,0);
  release();await result;assert.equal(mode.deferred,true);assert.equal(f.sent.at(-1).data.jobId,'job-one');
});
test('old native live clients require reload, while compatible and standby clients do not',()=>{
  assert.equal(realmManagementReloadRequired({on:1,sharedScene:2},true),true);
  assert.equal(realmManagementReloadRequired({on:1,realmManagement:'1'},true),true);
  assert.equal(realmManagementReloadRequired({on:1,realmManagement:1,seasonField:2},true),false);
  assert.equal(realmManagementReloadRequired({on:1,realmManagement:1,seasonField:1},true),true);
  assert.equal(realmManagementReloadRequired({on:0},true),false);assert.equal(realmManagementReloadRequired({on:1},false),false);
});
function confirmationFixture(receipt,change={}){
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8');
  const start=source.indexOf('async function confirmRealmOutcome('),end=source.indexOf('function checkRealmConfirmations',start);
  assert(start>=0&&end>start);
  const status={confirmedLiveVersion:9,confirmedVersion:2};
  const envelope={schema:'urn:bridge:owned-state-checkpoint:v1',owner:'owner-one',liveVersion:10,value:{season:{managementReceipts:[receipt]}}};
  Object.assign(envelope,change);
  const world={assertMutable(){},capture:()=>({liveVersion:10}),status:()=>status,canMutate:()=>true,checkpoint:async()=>{status.confirmedLiveVersion=10;}};
  const store={owner:'owner-one',load:async()=>({version:2,state:envelope})};
  return new Function('WORLD_STATE','fileStore','gamingStore','isDeepStrictEqual','realmConfirmationWaiters','rememberRealmCheckpoint',
    source.slice(start,end)+';return confirmRealmOutcome;')(world,{},store,isDeepStrictEqual,new Map(),()=>{});
}
test('actual native confirmation checks the exact owned receipt, not an older in-flight save',async()=>{
  const receipt={owner:'account-one',id:'nonce-one',digest:'digest',revision:1};
  await confirmationFixture(receipt)(receipt);
  await assert.rejects(confirmationFixture(receipt,{owner:'another-owner'})(receipt));
  await assert.rejects(confirmationFixture(receipt,{value:{season:{managementReceipts:[{...receipt,digest:'different'}]}}})(receipt));
  await assert.rejects(confirmationFixture(receipt,{liveVersion:9})(receipt));
});
test('management view parser preserves canonical diplomatic time and all-realm pairs',()=>{
  const source=fs.readFileSync(new URL('../../src/14q_netseason.js',import.meta.url),'utf8');
  const start=source.indexOf('function netRealmManagementRead('),end=source.indexOf('function netRealmManagementView(',start);
  const read=new Function(source.slice(start,end)+';return netRealmManagementRead;')();
  const view={v:1,realm:0,revision:2,time:50,stocks:[],plots:[],buildings:[],publicPlots:[],publicBuildings:[],catalog:[],recipes:[],offers:[],relations:[],log:[],
    allRelations:[{a:1,b:2,score:0,treaty:'trade',expires:150}]};
  assert.deepEqual(read(view).allRelations,view.allRelations);assert.equal(read(view).time,50);
  assert.equal(read({...view,publicBuildings:Array(73).fill({})}),null);
});

test('accepted owned receipt can finish readback after seat loss without accepting another action',async()=>{
  const f=fixture(),c=client();await f.protocol.handle(c,request());c.seated=false;
  await f.protocol.handle(c,request());assert.equal(f.sent.at(-1).confirmed,true);assert.equal(f.applied,1);
  await f.protocol.handle(c,request('after-seat-loss',1));assert.equal(f.sent.at(-1).code,'throne_required');assert.equal(f.applied,1);
});
test('actual directed player hit relay respects manual treaties without swallowing unrelated NPC visuals',()=>{
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8'),start=source.indexOf('function evFor('),end=source.indexOf('/* ------------------------------------------------------------------ */',start);
  const evFor=new Function('SEASON',source.slice(start,end)+';return evFor;')({RS:{},M:{realmManageAllied:(_,a,b)=>a===0&&b===1}});
  const a={peer:'a',realm:0},b={peer:'b',realm:1},foe={peer:'foe',realm:2};
  assert.equal(evFor(a,b,[1,'hit','b',{}]),false);assert.equal(evFor(a,foe,[1,'hit','foe',{}]),true);
  assert.equal(evFor(a,b,[1,'hit','',{}]),true);
});

test('actual WORLD keeper election refuses older economy or FIELD capabilities',()=>{
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8'),start=source.indexOf('function roomHost('),end=source.indexOf('const send =',start);
  const elect=new Function('isHumanPlaying','roomNeedsWarbandOrders',source.slice(start,end)+';return roomHost;')(()=>true,()=>false);
  const old={peer:'old',since:1,slow:{on:1,sharedScene:2,realmManagement:1,seasonField:1}},
    modern={peer:'new',since:2,slow:{on:1,sharedScene:2,realmManagement:1,seasonField:2}};
  const room={clients:new Map([['old',old],['new',modern]])};
  assert.equal(elect(room),modern);modern.slow.realmManagement=0;assert.equal(elect(room),null);
});
test('multiple stable-ID logistics jobs can share one native checkpoint without weakening human revisions',async()=>{
  let release;const wait=new Promise(r=>{release=r;});
  const delegate={deferred:true,actorFor:c=>({realm:c.realm}),apply(RS){RS.realms[0].s[0]-=1;RS.management.revision++;return{ok:true,revision:RS.management.revision,data:{jobId:'paid'}};}};
  const f=fixture({confirm:()=>wait,delegates:{logistics:delegate}}),c=client();
  const requests=[1,2,3,4].map(n=>({q:n,o:{kind:'logistics',nonce:'logistics-'+n,season:1,revision:0,args:{op:'mount.issue',actorId:'scene:actor:'+n}}}));
  const runs=requests.map(m=>f.protocol.handle(c,m));
  for(let i=0;i<64&&f.season.RS.management.revision<4;i++)await Promise.resolve();
  assert.equal(f.season.RS.management.revision,4);assert.equal(f.season.RS.realms[0].s[0],96);
  await f.protocol.handle(c,request('human-stale-a',0));assert.equal(f.sent.at(-1).code,'stale_revision');
  release();await Promise.all(runs);assert.equal(f.sent.filter(m=>m.confirmed===true).length,4);
});

test('live throne proof rejects stale pose, casting, changed realm and world admission',()=>{
  let time=100000;const admission={origin:'https://game.test',epoch:1},state={},out=[],room={name:'march',clients:new Map()};
  const c={peer:'king',room,live:true,acct:{id:'account-king'},slow:{r:0},fast:{p:[0,0,0],d:0,cs:null,st:1},pos:{x:0,z:0},posT:time,worldAdmission:{...admission}};
  room.clients.set(c.peer,c);
  const scene=createSharedScene({hostFor:()=>c,live:p=>p.live,admission:()=>admission,stateFor:()=>state,now:()=>time,send:(_,m)=>out.push(m)});
  scene.sync(room);const authority=out.findLast(m=>m.kind==='authority').authority;
  const data=JSON.stringify({v:1,full:true,rows:[],remove:[],meta:{thrones:[{id:15,realm:0,x:0,y:0,z:0,ready:true}]}});
  assert.equal(scene.handle(c,{t:'activity',kind:'entities',op:'snapshot',seq:1,part:0,total:1,data,authority,worldAdmission:admission}),true);
  let seq=0;
  const claim=()=>scene.handle(c,{t:'activity',kind:'thrones',op:'claim',id:15,seq:++seq,authority,worldAdmission:admission});
  assert.equal(claim(),true);assert.equal(scene.commander(c,15).realm,0);
  c.fast.cs={};assert.equal(scene.commander(c,15),null);c.fast.cs=null;assert.equal(claim(),true);
  time+=5001;assert.equal(scene.commander(c,15),null);c.posT=time;assert.equal(claim(),true);
  c.slow.r=1;assert.equal(scene.commander(c,15),null);c.slow.r=0;assert.equal(claim(),true);
  c.worldAdmission={...admission,epoch:2};assert.equal(scene.commander(c,15),null);assert.equal(scene.proofFor(c),null);
});

test('battle loss reports are keeper fenced, replay safe across refill, and gate raises need paid proof',()=>{
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8'),start=source.indexOf('function onRealmBattle('),end=source.indexOf('function sendWorldInit(',start);
  const sent=[],season={RS:{n:1,t:20,keeps:[{h:0,g:8,gate:0.5}]}},admission={origin:'https://game.test',epoch:1};
  let keeper=true,paid=false;
  const scene={acceptsChunk:()=>keeper,proofFor:()=>({worldparts:{}})};
  const gateReport=(RS,o)=>paid?(RS.keeps[o.keep].gate=o.gate,{ok:true}):{ok:false,why:'Wait for paid proof'};
  const report=new Function('SEASON','SHARED_SCENE','send','sameWorldAdmission','worldAdmission','realmLogisticsGateReport','realmConfirmedSource','WORLD_STATE','fileStore',source.slice(start,end)+';return onRealmBattle;')
    (season,scene,(_,m)=>sent.push(m),(a,b)=>a?.origin===b?.origin&&a?.epoch===b?.epoch,()=>admission,gateReport,null,{},null);
  const c={room:{diagnostic:false},sceneAuthority:'lease',worldAdmission:admission},message=(seq,g,gate)=>({q:seq,o:{n:1,keep:0,owner:0,g,gate,seq,authority:'lease',worldAdmission:admission}});
  keeper=false;report(c,message(1,2,0.2));assert.equal(season.RS.keeps[0].g,8);
  keeper=true;report(c,message(1,2,0.2));assert.equal(season.RS.keeps[0].g,2);assert.equal(sent.at(-1).g,2);
  season.RS.keeps[0].g=5;report(c,message(1,2,0.2));assert.equal(season.RS.keeps[0].g,5);assert.equal(sent.at(-1).duplicate,true);
  report(c,message(2,5,0.8));assert.equal(sent.at(-1).pending,true);assert.equal(season.RS.keeps[0].gate,0.2);
  paid=true;report(c,message(2,5,0.8));assert.equal(sent.at(-1).ok,true);assert.equal(season.RS.keeps[0].gate,0.8);
});

test('file-backed gate reports read newly saved credit and refuse volatile or failed-save credit',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hallowmarch-gate-proof-'));
  t.after(()=>{fs.rmSync(path.join(directory,'season.json'),{force:true});fs.rmdirSync(directory);});
  const file=path.join(directory,'season.json'),read=name=>fs.readFileSync(new URL('../../src/'+name,import.meta.url),'utf8');
  const model=new Function(read('08m_realm.js')+'\n'+read('08p_realm_management.js')+'\nreturn {realmSimInit,realmManageInit};')();
  const RS=model.realmSimInit(12345,{days:28,season:2});model.realmManageInit(RS);RS.keeps[0].h=0;RS.keeps[0].g=6;RS.keeps[0].gate=0.5;
  const startup=structuredClone(RS);fs.writeFileSync(file,JSON.stringify(startup));
  const admission={origin:'https://game.test',epoch:1},worldparts={parts:{publicworks:{v:1,scope:{...admission,n:RS.n},spent:[{keep:0,owner:0,kind:'gate',units:1}]}}};
  const actor={realm:0,actualKeeper:true,peer:'keeper',authority:'lease',worldAdmission:admission};
  const funded=realmLogisticsApply(RS,actor,{op:'repair.issue',keep:0,kind:'gate'},
    {actualKeeper:true,peer:'keeper',authority:'lease',worldAdmission:admission,owner:'account-one'});
  assert.equal(funded.ok,true,funded.why);assert.equal(RS.management.logistics.repairs[0].totalUnits,1);
  const fundedState=structuredClone(RS);
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8'),start=source.indexOf('function onRealmBattle('),end=source.indexOf('function sendWorldInit(',start);
  const create=new Function('SEASON','SHARED_SCENE','send','sameWorldAdmission','worldAdmission','realmLogisticsGateReport','realmConfirmedSource','WORLD_STATE','fileStore',source.slice(start,end)+';return onRealmBattle;');
  const sent=[],season={RS},scene={acceptsChunk:()=>true,proofFor:()=>({worldparts})},same=(a,b)=>a?.origin===b?.origin&&a?.epoch===b?.epoch;
  const report=create(season,scene,(_,m)=>sent.push(m),same,()=>admission,realmLogisticsGateReport,startup,null,
    {read:()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}});
  const commander={room:{diagnostic:false},sceneAuthority:'lease',worldAdmission:admission};
  const message={q:1,o:{n:RS.n,keep:0,owner:0,g:6,gate:1,seq:1,authority:'lease',worldAdmission:admission}};
  report(commander,message);assert.equal(sent.at(-1).pending,true);assert.equal(RS.keeps[0].gate,0.5);
  assert.throws(()=>fs.writeFileSync(path.join(directory,'missing','season.json'),JSON.stringify(RS)));
  report(commander,message);assert.equal(sent.at(-1).pending,true);assert.equal(RS.keeps[0].gate,0.5);
  assert.deepEqual(RS.management.logistics.appliedGateSpent,[],'unconfirmed funding cannot consume physical repair credit');
  const retired=structuredClone(RS);retired.management.logistics.season=RS.n-1;fs.writeFileSync(file,JSON.stringify(retired));
  report(commander,message);assert.equal(sent.at(-1).pending,true);assert.equal(RS.keeps[0].gate,0.5,'retained earlier-season ledger cannot confirm current funding');
  const wrongScope=structuredClone(RS);wrongScope.management.logistics.scope.epoch++;fs.writeFileSync(file,JSON.stringify(wrongScope));
  report(commander,message);assert.equal(sent.at(-1).pending,true);assert.equal(RS.keeps[0].gate,0.5,'saved credit from another admission cannot confirm current funding');
  fs.writeFileSync(file,JSON.stringify(RS));
  report(commander,message);assert.equal(sent.at(-1).ok,true);assert.equal(RS.keeps[0].gate,1);
  assert.equal(RS.management.logistics.appliedGateSpent[0].units,1);
  for(const [name,confirmed,ok] of [['current native checkpoint',fundedState,true],['unconfirmed native credit',startup,false],
    ['old native ledger season',retired,false],['old native admission scope',wrongScope,false]]) {
    const nativeSeason={RS:structuredClone(fundedState)};
    const native=create(nativeSeason,scene,(_,m)=>sent.push(m),same,()=>admission,realmLogisticsGateReport,confirmed,{},
      {read:()=>assert.fail('native repair proof must not consult legacy files')});
    native({...commander,realmBattleHeads:new Map()},message);
    assert.equal(sent.at(-1).ok,ok,name);assert.equal(nativeSeason.RS.keeps[0].gate,ok?1:0.5,name);
    if(!ok)assert.equal(sent.at(-1).pending,true,name);
  }
});

test('paid public logistics and FIELD handouts remain hidden until exact native readback',()=>{
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8'),start=source.indexOf('let realmConfirmedSource='),end=source.indexOf('const realmConfirmationWaiters=',start);
  const season={RS:{n:1,management:{revision:0,logistics:{jobs:[]}},armies:[]}},world={status:()=>({confirmedVersion:1})};
  const view=(RS,owner)=>({v:1,season:RS.n,jobs:RS.management.logistics.jobs,owner});
  const api=new Function('SEASON','WORLD_STATE','gamingStore','realmLogisticsView',source.slice(start,end)+';return{view:realmConfirmedLogisticsView,remember:rememberRealmCheckpoint};')
    (season,world,{owner:'native-owner'},view);
  const army={id:1,r:0,n:10,k:0,q:-1,kind:'company',manual:true,mission:'defend',arm:1,eng:1};
  season.RS.management.logistics.jobs.push({id:'paid'});season.RS.armies.push(army);
  assert.equal(api.view(season.RS,'account-a').jobs.length,0);assert.equal(season.fieldGrantConfirmed(army),false);
  assert.equal(api.remember({version:2,state:{schema:'wrong',owner:'native-owner',liveVersion:2,value:{season:season.RS}}}),false);
  const checkpoint=JSON.parse(JSON.stringify(season.RS));
  assert.equal(api.remember({version:2,state:{schema:'urn:bridge:owned-state-checkpoint:v1',owner:'native-owner',liveVersion:2,value:{season:checkpoint}}}),true);
  assert.equal(api.view(season.RS,'account-a').jobs.length,1);assert.equal(season.fieldGrantConfirmed(army),true);
  army.n=11;assert.equal(season.fieldGrantConfirmed(army),false);army.n=10;army.k=1;assert.equal(season.fieldGrantConfirmed(army),false);
});

test('confirmed receipt replies use the confirmed projection while later accepted work is pending',async()=>{
  let releaseOne,releaseTwo,revision=0;
  const one=new Promise(r=>{releaseOne=r;}),two=new Promise(r=>{releaseTwo=r;});
  const delegate={deferred:true,actorFor:c=>({realm:c.realm}),apply(RS){RS.management.revision++;return{ok:true,revision:RS.management.revision};}};
  const f=fixture({delegates:{logistics:delegate},viewFor:()=>({v:1,revision}),
    confirm:r=>r.id==='first-paid'?one:two}),c=client();
  const message=nonce=>({q:1,o:{kind:'logistics',nonce,season:1,revision:0,args:{op:'mount.issue',actorId:'scene:actor:'+nonce}}});
  const first=f.protocol.handle(c,message('first-paid')),second=f.protocol.handle(c,message('second-paid'));
  for(let i=0;i<64&&f.season.RS.management.revision<2;i++)await Promise.resolve();
  assert.equal(f.season.RS.management.revision,2);
  revision=1;releaseOne();await first;assert.equal(f.sent.at(-1).confirmed,true);assert.equal(f.sent.at(-1).management.revision,1);
  revision=2;releaseTwo();await second;assert.equal(f.sent.at(-1).management.revision,2);
});

for(const op of ['convoy.dispatch','repair.issue'])test(op+' lost-ACK retry cannot spend again after its receipt is pruned',async()=>{
  const delegate={deferred:true,actorFor:c=>({realm:c.realm}),apply(RS){RS.realms[0].s[0]-=1;RS.management.revision++;return{ok:true,revision:RS.management.revision};}};
  let f=fixture({delegates:{logistics:delegate}});const c=client();
  const message=(nonce,revision,args)=>({q:1,o:{kind:'logistics',nonce,season:1,revision,args}});
  const old=message('old-lost-ack',0,{op,keep:0,...(op==='repair.issue'?{kind:'gate'}:{})});
  await f.protocol.handle(c,old);
  for(let i=0;i<3;i++)await f.protocol.handle(c,message('stable-id-'+i,0,{op:'mount.issue',actorId:'scene:actor:'+i}));
  await f.protocol.handle(c,old);assert.equal(f.sent.at(-1).confirmed,true);assert.equal(f.season.RS.realms[0].s[0],96);
  for(let i=3;i<33;i++)await f.protocol.handle(c,message('stable-id-'+i,0,{op:'mount.issue',actorId:'scene:actor:'+i}));
  assert.equal(f.season.RS.managementReceipts.length,32);assert.equal(f.season.RS.managementReceipts.some(r=>r.id===old.o.nonce),false);
  f=fixture({state:JSON.parse(JSON.stringify(f.season.RS)),delegates:{logistics:delegate}});
  const balance=f.season.RS.realms[0].s[0],revision=f.season.RS.management.revision;
  await f.protocol.handle(c,old);assert.equal(f.sent.at(-1).code,'stale_revision');assert.equal(f.applied,0);
  assert.equal(f.season.RS.realms[0].s[0],balance);assert.equal(f.season.RS.management.revision,revision);
  await f.protocol.handle(c,message('fresh-current-a',revision,old.o.args));assert.equal(f.sent.at(-1).confirmed,true);
  await f.protocol.handle(c,message('fresh-stale-b',revision,old.o.args));assert.equal(f.sent.at(-1).code,'stale_revision');
  const current=f.sent.at(-1).management.revision;
  await f.protocol.handle(c,message('fresh-requeued-b',current,old.o.args));assert.equal(f.sent.at(-1).confirmed,true);
  assert.equal(f.season.RS.realms[0].s[0],balance-2);
});

test('FIELD delivers the confirmed complete inventory before each physical army grant',()=>{
  const source=fs.readFileSync(new URL('../../server/server.js',import.meta.url),'utf8'),start=source.indexOf('function sendSeasonField('),end=source.indexOf('const FIELD =',start);
  const out=[],c={peer:'keeper'};
  const deliver=new Function('seasonTell','send',source.slice(start,end)+';return sendSeasonField;')
    ((target,away,first)=>{assert.equal(target,c);assert.equal(away,-1);assert.equal(first,false);out.push({t:'season',armyIds:[7],armyIdsComplete:true});},
      (target,message)=>{assert.equal(target,c);out.push(message);});
  const grant={t:'sarmy',a:{id:7,season:1,fieldLease:'paid-lease'}};
  deliver(c,grant);assert.deepEqual(out.map(m=>m.t),['season','sarmy']);assert.equal(out[0].armyIds.includes(out[1].a.id),true);
  const fold={t:'sarmyfold',id:7,season:1,fieldLease:'paid-lease'};deliver(c,fold);assert.equal(out.length,3);assert.equal(out.at(-1),fold);
});
