import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createRealmManagementProtocol, realmManagementReloadRequired } from '../../server/realm-management.js';
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
    confirm:async(r,o)=>{confirmations++;await options.confirm?.(r,o);},send:(c,m)=>sent.push(m),delegates:options.delegates||{},canMutate:()=>options.mutable!==false});
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
  assert.equal(realmManagementReloadRequired({on:1,realmManagement:1},true),false);
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
  return new Function('WORLD_STATE','fileStore','gamingStore','isDeepStrictEqual','realmConfirmationWaiters',
    source.slice(start,end)+';return confirmRealmOutcome;')(world,{},store,isDeepStrictEqual,new Map());
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
