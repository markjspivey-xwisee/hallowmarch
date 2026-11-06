import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realmLogisticsApply, realmLogisticsView, realmLogisticsRestore, realmLogisticsGateReport } from '../../server/realm-logistics.js';
import { checkedWorldSnapshot } from '../../server/gaming/hallowmarch-world-state.js';
const read=name=>readFileSync(new URL('../../src/'+name,import.meta.url),'utf8');
const realmSource=read('08m_realm.js'),managementSource=read('08p_realm_management.js');
const plain=x=>JSON.parse(JSON.stringify(x));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,'expected '+b+', got '+a);
function fixture(){
  const model=new Function(realmSource+'\n'+managementSource+'\nreturn {realmSimInit,realmSimSanitize,realmManageInit,realmManageView,rsmArmy};')();
  const RS=model.realmSimInit(12345,{days:28});model.realmManageInit(RS);
  RS.keeps[0].g=6;RS.keeps[0].gate=0.5;RS.keeps[1].g=6;RS.keeps[1].gate=0.5;
  const admission={origin:'https://march.test',epoch:1};
  const actor={actualKeeper:true,peer:'keeper',realm:0,authority:'authority',worldAdmission:admission};
  const ctx={actualKeeper:true,peer:'keeper',authority:'authority',worldAdmission:admission,owner:'account-a',
    entities:{v:1,full:true,rows:[],meta:{caravans:[],logistics:{jobs:[]},publicWorks:{houses:[]}}},
    worldparts:{parts:{publicworks:{v:1,scope:{...admission,n:RS.n},spent:[],houseSpent:[]}}}};
  return{RS,model,actor,ctx,apply(args,a=actor,c=ctx){return realmLogisticsApply(RS,a,args,c);},view(owner=''){return realmLogisticsView(RS,owner);}};
}
const raw=f=>plain(f.RS.realms.map(R=>({s:R.s,lev:R.lev})));
function success(result){assert.equal(result.ok,true,result.why||result.message);return result;}
function rejects(f,args,actor=f.actor,ctx=f.ctx){const before=plain(f.RS);assert.equal(f.apply(args,actor,ctx).ok,false);assert.deepEqual(plain(f.RS),before);}
function dispatch(f,keep=0){return success(f.apply({op:'convoy.dispatch',keep})).data;}
function proof(f,j,{where='to',alive=true,escorts=2}={}){
  const job=f.view().jobs.find(row=>row.id===j.jobId),point=where==='from'?job.from:job.to;
  const horse={id:'scene:cart:1',kind:'horse',role:'carthorse',faction:4,alive:alive?1:0,hp:alive?100:0,maxHp:100,p:[point.x,0,point.z]};
  const carter={id:'scene:cart:2',kind:'humanoid',role:'carter',faction:j.realm,alive:1,hp:100,maxHp:100,p:[point.x,0,point.z]};
  const guards=[0,1].map(i=>({id:'scene:cart:'+String(i+3),role:'escort',faction:j.realm,alive:i<escorts?1:0,hp:i<escorts?100:0,maxHp:100,p:[point.x,0,point.z]}));
  f.ctx.entities.rows=[horse,carter,...guards];
  f.ctx.entities.meta.logistics.jobs=[{jobId:j.jobId,lease:j.lease,season:j.season,horseId:horse.id,escortIds:guards.map(e=>e.id)}];
  f.ctx.entities.meta.caravans=[{logisticsId:j.jobId,logisticsLease:j.lease,logisticsSeason:j.season,realm:j.realm,keep:j.keep,horse:horse.id,carter:carter.id,esc:guards.map(e=>e.id)}];
  return{horse,carter,guards,point};
}
function donor(f,claim='owned:12345678',id='scene:petowner:1'){
  const a=150*Math.PI/180,point={x:Math.sin(a)*378,z:-Math.cos(a)*378};
  const actor={nativeOwner:true,owner:'account-a',peer:'owner',realm:0,authority:'authority',worldAdmission:f.ctx.worldAdmission,position:point};
  const ctx={...f.ctx,actualKeeper:false,peer:'owner'};
  ctx.entities={...f.ctx.entities,rows:[{id,kind:'horse',role:'animal',owner:'owner',faction:4,hp:100,maxHp:100,p:[point.x,0,point.z],
    tame:{k:'horse',owner:'player',age:900,sharedClaim:claim}}]};
  return{actor,ctx,args:{op:'horse.donate',actorId:id,claimId:claim}};
}
test('views do not seed legacy state and untrusted or arbitrary-amount operations never charge',()=>{
  const f=fixture(),before=plain(f.RS);f.view();assert.deepEqual(plain(f.RS),before);
  rejects(f,{op:'convoy.dispatch',keep:0},{...f.actor,actualKeeper:false},{...f.ctx,actualKeeper:false});
  rejects(f,{op:'convoy.dispatch',keep:0,realm:2,amount:999});rejects(f,{op:'unknown'});rejects(f,{op:'mount.issue',actorId:'peer:private'});
});
test('dispatch reserves only fixed canonical cargo, horse and two paid escorts with bounded active routes',()=>{
  const f=fixture(),before=raw(f),processed=plain(f.RS.realms[0].management.stock),j=dispatch(f);
  near(f.RS.realms[0].s[0],before[0].s[0]-6);near(f.RS.realms[0].s[1],before[0].s[1]-6);near(f.RS.realms[0].s[2],before[0].s[2]-6);
  near(f.RS.realms[0].s[6],before[0].s[6]-1);assert.equal(f.RS.realms[0].lev,before[0].lev-2);
  assert.deepEqual(j.load,{food:6,timber:6,stone:6});assert.deepEqual(plain(f.RS.realms[0].management.stock),processed);
  rejects(f,{op:'convoy.dispatch',keep:0});dispatch(f,1);f.RS.keeps[2].h=0;f.RS.keeps[2].g=4;
  rejects(f,{op:'convoy.dispatch',keep:2});assert.equal(f.view().jobs.filter(j=>j.state==='active').length,2);
});
test('arrival converts reserved escorts and cargo once while gate repair waits for paid physical work',()=>{
  const f=fixture(),j=dispatch(f);proof(f,j);const stores=raw(f),gate=f.RS.keeps[0].gate;
  const result=success(f.apply({op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'}));
  assert.equal(result.data.guards,2);assert.equal(f.RS.keeps[0].g,8);assert.equal(f.RS.keeps[0].gate,gate);
  assert.deepEqual(raw(f),stores);assert.equal(f.view().repairs.find(r=>r.keep===0&&r.kind==='gate').totalUnits,0.1);
  rejects(f,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'});
});
test('return refunds the original escrow once and loss never mints raid loot or refunds',()=>{
  const returned=fixture(),before=raw(returned),j=dispatch(returned);proof(returned,j,{where:'from'});
  success(returned.apply({op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'returned'}));assert.deepEqual(raw(returned),before);
  rejects(returned,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'returned'});
  const lost=fixture(),k=dispatch(lost);proof(lost,k,{alive:false});const reserved=raw(lost);
  success(lost.apply({op:'convoy.settle',jobId:k.jobId,lease:k.lease,outcome:'lost'}));assert.deepEqual(raw(lost),reserved);assert.equal(lost.RS.keeps[0].g,6);
});
test('ruler dispatch is owner-bound and actual keeper adoption rotates the lease without redebit',()=>{
  const f=fixture(),ruler={...f.actor,peer:'king',actualKeeper:false,ruler:true},rulerCtx={...f.ctx,peer:'king',actualKeeper:false};
  const j=success(f.apply({op:'convoy.dispatch',keep:0},ruler,rulerCtx)).data,stores=raw(f);
  rejects(f,{op:'convoy.dispatch',keep:2},ruler,rulerCtx);
  const adopted=success(f.apply({op:'convoy.adopt',jobId:j.jobId})).data;assert.ok(adopted.lease!==j.lease);assert.deepEqual(raw(f),stores);
  proof(f,adopted);rejects(f,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'});
  rejects(f,{op:'convoy.adopt',jobId:j.jobId},ruler,rulerCtx);
});
test('settlement requires accepted current-lease bodies at the physical destination and cannot count one escort twice',()=>{
  const f=fixture(),j=dispatch(f),p=proof(f,j);p.horse.p=[0,0,0];rejects(f,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'});
  proof(f,j);f.ctx.entities.meta.logistics.jobs[0].escortIds=['scene:cart:3','scene:cart:3'];rejects(f,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'});
  proof(f,j);f.RS.keeps[0].h=1;rejects(f,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'});
});
test('paid NPC mounts use one canonical horse, survive adopted replay and reject owned private bodies',()=>{
  const f=fixture(),id='scene:npc:1';f.ctx.entities.rows=[{id,role:'lord',faction:0,hp:100,maxHp:100,p:[0,0,0]}];
  const before=f.RS.realms[0].s[6];success(f.apply({op:'mount.issue',actorId:id}));near(f.RS.realms[0].s[6],before-1);
  f.ctx.entities.rows[0].mounted=1;success(f.apply({op:'mount.issue',actorId:id}));near(f.RS.realms[0].s[6],before-1);
  f.ctx.entities.rows[0].owner='private-owner';rejects(f,{op:'mount.issue',actorId:id});
});
test('repair invoices spend fixed materials and gate reports consume only confirmed scoped spend highwater',()=>{
  const f=fixture(),before=raw(f);success(f.apply({op:'repair.issue',keep:0,kind:'gate'}));
  near(f.RS.realms[0].s[1],before[0].s[1]-12);near(f.RS.realms[0].s[3],before[0].s[3]-2);assert.equal(f.RS.keeps[0].gate,0.5);
  f.ctx.worldparts.parts.publicworks.spent=[{keep:0,owner:0,kind:'gate',units:1}];
  assert.equal(realmLogisticsGateReport(f.RS,{keep:0,owner:0,gate:1},f.ctx).ok,false);
  f.ctx.confirmedRepairs=plain(f.view().repairs);f.RS.keeps[0].gate=0.8;
  assert.equal(realmLogisticsGateReport(f.RS,{keep:0,owner:0,gate:1},f.ctx).ok,true);
  assert.equal(f.RS.management.logistics.appliedGateSpent[0].units,1);f.RS.keeps[0].gate=0.5;
  assert.equal(realmLogisticsGateReport(f.RS,{keep:0,owner:0,gate:1},f.ctx).ok,false);assert.equal(f.RS.keeps[0].gate,0.5);
});
test('house reconstruction is fixed-cost and requires a damaged accepted native house',()=>{
  const f=fixture();f.ctx.entities.meta.publicWorks.houses=[{id:12,owner:0,state:'ruin',x:0,z:0}];const before=raw(f);
  success(f.apply({op:'repair.issue',house:12,kind:'house'}));near(f.RS.realms[0].s[1],before[0].s[1]-10);near(f.RS.realms[0].s[2],before[0].s[2]-5);
  assert.equal(f.view().houseRepairs[0].totalUnits,1);f.ctx.entities.meta.publicWorks.houses[0].state='whole';rejects(f,{op:'repair.issue',house:12,kind:'house'});
});
test('owned adult horse claims credit the canonical realm exactly once and stay private to their owner',()=>{
  const f=fixture(),d=donor(f),before=f.RS.realms[0].s[6];success(f.apply(d.args,d.actor,d.ctx));near(f.RS.realms[0].s[6],before+1);
  success(f.apply(d.args,d.actor,d.ctx));near(f.RS.realms[0].s[6],before+1);
  assert.equal(f.view('account-a').donations.length,1);assert.equal(f.view('account-b').donations.length,0);assert.equal(f.view().donations.length,0);
  assert.equal(f.view('account-a').donations[0].ownerAccount,'account-a');f.RS.n++;
  assert.equal(f.view('account-a').donations.length,1,'consumed claims remain visible across seasons');
  rejects(f,{...d.args,claimId:'owned:different'},d.actor,d.ctx);
});
test('admission changes cannot redeem old paid jobs, mounts or repair entitlements',()=>{
  const f=fixture(),j=dispatch(f);proof(f,j);success(f.apply({op:'repair.issue',keep:0,kind:'gate'}));
  const old=plain(f.view());f.ctx.worldAdmission={...f.ctx.worldAdmission,epoch:2};f.actor.worldAdmission=f.ctx.worldAdmission;
  f.ctx.confirmedRepairs=old.repairs;f.ctx.worldparts.parts.publicworks.scope={...f.ctx.worldAdmission,n:f.RS.n};
  f.ctx.worldparts.parts.publicworks.spent=[{keep:0,owner:0,kind:'gate',units:1}];
  assert.equal(realmLogisticsGateReport(f.RS,{keep:0,owner:0,gate:1},f.ctx).ok,false);
  rejects(f,{op:'convoy.settle',jobId:j.jobId,lease:j.lease,outcome:'arrived'});
  assert.notDeepEqual(f.view().scope,f.ctx.worldAdmission);
});
test('JSON native restoration preserves the paid ledger, receipts and legacy absence exactly',()=>{
  const f=fixture(),j=dispatch(f);f.RS.managementReceipts=[{owner:'account-a',id:'nonce',digest:'digest',season:f.RS.n,realm:0,revision:f.RS.management.revision,
    result:{ok:true,message:'Reserved',revision:f.RS.management.revision,data:j}}];
  const input=realmLogisticsRestore(f.model.realmSimSanitize(plain(f.RS)),plain(f.RS));
  const snapshot={worlds:{},season:plain(input)},native=checkedWorldSnapshot(snapshot,{keepCount:6,realmModule:{loops:true,realmSimSanitize:o=>realmLogisticsRestore(f.model.realmSimSanitize(o),o)}});
  assert.deepEqual(native,snapshot);
  const restored=realmLogisticsRestore(f.model.realmSimSanitize(native.season),native.season);
  assert.deepEqual(plain(restored.management.logistics),snapshot.season.management.logistics);
  assert.deepEqual(plain(restored.managementReceipts),snapshot.season.managementReceipts);
  const legacy=plain(f.RS);delete legacy.management.logistics;
  const absent=realmLogisticsRestore(f.model.realmSimSanitize(legacy),legacy);assert.equal(Object.hasOwn(absent.management,'logistics'),false);
});

function maximumLedger(f) {
  // A bounded cold-restore fixture exercises every collection limit without adding spendable inventory.
  const L={v:1,season:f.RS.n,scope:plain(f.ctx.worldAdmission),jobs:[],mounts:[],repairs:[],appliedGateSpent:[],houseRepairs:[],donations:[]};
  for(let i=0;i<38;i++)L.jobs.push({id:'job-'+i,lease:'lease-'+i,season:f.RS.n,peer:'keeper',realm:i%3,keep:i%6,
    cargo:{food:6,timber:6,stone:6},escorts:2,state:i<6?'active':'lost',at:i,...(i<6?{}:{endedAt:i+1})});
  for(let i=0;i<256;i++)L.mounts.push({actorId:'scene:npc:'+i,realm:i%3,grantId:'grant-'+i,at:i});
  for(let keep=0;keep<6;keep++)for(let owner=0;owner<3;owner++){
    for(const kind of ['wall','gate','tower'])L.repairs.push({keep,owner,kind,totalUnits:1e6});
    L.appliedGateSpent.push({keep,owner,units:1e6});
  }
  for(let house=0;house<64;house++)for(let owner=0;owner<3;owner++)L.houseRepairs.push({house,owner,totalUnits:1e6});
  for(let i=0;i<128;i++)L.donations.push({claimId:'owned:claim-'+i,actorId:'scene:donor:'+i,ownerAccount:'account-'+i,realm:i%3,at:i,season:f.RS.n});
  return L;
}
test('all bounded ledger collections survive JSON native restoration and overflows fail closed',()=>{
  const f=fixture(),L=maximumLedger(f);f.RS.management.logistics=L;
  const source=plain(f.RS),restored=realmLogisticsRestore(f.model.realmSimSanitize(source),source);
  assert.deepEqual(plain(restored.management.logistics),L);assert.ok(Buffer.byteLength(JSON.stringify(L))<=65536);
  const variants=[
    l=>l.jobs.push({...l.jobs.at(-1),id:'terminal-overflow'}),
    l=>l.mounts.push({...l.mounts[0],actorId:'scene:npc:999'}),
    l=>l.repairs[0].totalUnits=1e6+1,
    l=>l.repairs.push({...l.repairs[0]}),
    l=>l.houseRepairs.push({house:64,owner:0,totalUnits:1}),
    l=>l.donations.push({claimId:'owned:overflow',actorId:'scene:donor:999',ownerAccount:'overflow',realm:0,at:0,season:f.RS.n}),
    l=>delete l.scope,
    l=>l.scope.epoch=0,
    l=>l.donations.forEach((d,i)=>{d.ownerAccount='account-'+i+'x'.repeat(180);d.claimId='owned:'+i+'x'.repeat(145);}),
  ];
  for(const change of variants){
    const bad=plain(source);change(bad.management.logistics);
    const candidate=f.model.realmSimSanitize(bad),before=plain(candidate);
    assert.throws(()=>realmLogisticsRestore(candidate,bad),{code:'INVALID_LOGISTICS_STATE'});
    assert.deepEqual(plain(candidate),before,'rejected native ledger does not partly restore');
  }
  const d=donor(f,'owned:new','scene:donor:999');rejects(f,d.args,d.actor,d.ctx);
  f.ctx.entities.rows=[{id:'scene:npc:999',role:'lord',faction:0,hp:100,maxHp:100,p:[0,0,0]}];
  rejects(f,{op:'mount.issue',actorId:'scene:npc:999'});
});
test('72 buildings, 40 companies, all ledger collections and 32 receipts fit the unchanged native snapshot budget',()=>{
  const f=fixture();f.RS.management.logistics=maximumLedger(f);
  for(let r=0;r<3;r++){
    const plots=f.model.realmManageView(f.RS,r).plots,template=plain(f.RS.realms[r].management.buildings.find(b=>b.kind==='house'));
    f.RS.realms[r].management.buildings=plots.map(p=>({...template,id:'b:'+p.id,plotId:p.id,level:3,targetLevel:3}));
  }
  const first=f.model.rsmArmy(f.RS,0,4,'assault',2);assert.ok(first);
  // Fixed-size saved-army fixture; stock is never filled to finance these boundary checks.
  f.RS.armies=Array.from({length:40},(_,i)=>({...plain(first),id:i+1,r:i%3,k:((i%3+1)%3)*2,
    manual:true,mission:'attack',fx:123.456,fz:-234.567,onField:{peer:'keeper',at:0}}));f.RS.nextArmy=41;
  f.RS.managementReceipts=Array.from({length:32},(_,i)=>({owner:'owner-'+i,id:'nonce-'+i,digest:'digest-'+i,season:f.RS.n,realm:i%3,revision:i,
    result:{ok:true,message:'Confirmed paid realm command',revision:i,data:{jobId:'job-'+i,lease:'lease-'+i,load:{food:6,timber:6,stone:6},note:Array(9).fill('x'.repeat(160))}}}));
  const stocks=raw(f),source=plain(f.RS),input=realmLogisticsRestore(f.model.realmSimSanitize(source),source);
  assert.deepEqual(raw(f),stocks);assert.equal(input.realms.reduce((n,R)=>n+R.management.buildings.length,0),72);
  assert.equal(input.armies.length,40);assert.equal(input.managementReceipts.length,32);
  assert.ok(input.managementReceipts.every(q=>q.result.data),'bounded result data must not be silently discarded');
  const snapshot={worlds:{},season:plain(input)},bytes=Buffer.byteLength(JSON.stringify(snapshot));
  assert.ok(bytes<144*1024,'maximum-count native season remains below 144KiB: '+bytes);
  assert.ok(bytes<480*1024,'the existing native snapshot limit remains unchanged');
  const native=checkedWorldSnapshot(snapshot,{keepCount:6,realmModule:{loops:true,
    realmSimSanitize:o=>realmLogisticsRestore(f.model.realmSimSanitize(o),o)}});
  const again=realmLogisticsRestore(f.model.realmSimSanitize(native.season),native.season);
  assert.deepEqual(native,snapshot);assert.deepEqual(plain(again),snapshot.season);
});
