import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const helper=read('src/08s_logistics.js'),loops=read('src/08m_loops.js'),worldparts=read('src/14z_networldparts.js');
function extract(s,n){const a=s.indexOf('function '+n+'(');assert.ok(a>=0,n);const line=s.indexOf('\n',a);if(s.slice(a,line).trimEnd().endsWith('}'))return s.slice(a,line);const b=s.indexOf('\n}',a);assert.ok(b>a,n);return s.slice(a,b+2);}
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(){
 const state={managed:true,keeper:true,live:true,privateConfirm:true,responses:[],calls:[],spawned:0,removed:0,saves:0,fires:0,rp:0,news:[],errors:[],owned:[],recruiting:false,work:0,houseWork:0};
 const stock=()=>({food:100,timber:100,stone:100,iron:50,hides:10,wool:10,horses:10});
 const view={v:1,scope:{origin:'world',epoch:1},season:1,revision:0,time:100,jobs:[],mounts:[],repairs:[],donations:[]};
 const L={on:true,inited:true,seeded:true,r:[stock(),stock(),stock()],k:[],caravans:[],nextCar:1,pend:[{},{},{}],
  clock:{prod:0,trade:0,car:[1,1,1]},campN:1,stats:{made:[{},{},{}],drawn:[{},{},{}],caravans:0},you:{}};
 const player={id:1,alive:true,faction:0},K={id:0,realm:0,site:{name:'Keep',x:100,z:0}};
 let next=10,nonce=0;
 const context=vm.createContext({
  GAME:{t:100,started:true,ready:true,player,prog:{level:5}},LOOPS:L,LT:{target:stock(),cap:4,keepTarget:{food:50,timber:40,stone:40,iron:10},keepCap:2.5,slow:0.3,work:{gate:{timber:12}}},
  NET:{self:'keeper'},NETWS:{url:'wss://example.test',acct:{id:'account'}},NET_ENTITIES:{authority:'authority',petsAt:0},
  NETS:{s:{n:1,management:{v:1},keeps:[{i:0,r:0,g:4,gate:0}],logistics:view}},WAR:{keeps:[K]},ENT:[],
  REALMS:[0,1,2].map(r=>({id:r,name:'Realm'+r,townName:'Town'+r,rgb:[1,0,0]})),CAMPAIGN:{n:1,state:'war'},
  SAVE:{native:true,ref:{},lastBody:'',pending:null,nativePaused:false},ANIMALS:{uiDirty:false},HOUSE_TIME:{scaffold:100},
  season2CanonicalWar:()=>state.managed,netHumanLive:()=>state.live,netEntityCanSimulateWorld:()=>state.keeper,netWorldPartsCanSimulate:()=>state.keeper,
  netCurrentWorldAdmission:()=>({origin:'world',epoch:1}),netRealmLogisticsView:()=>context.NETS.s.logistics,
  crypto:{randomUUID:()=> 'nonce-'+(++nonce)},netRealmLogisticsCommand:async(args,n)=>{state.calls.push({args:copy(args),nonce:n});const r=state.responses.shift();return typeof r==='function'?r(args):r||{ok:false,pending:true};},
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),lsBump:(o,k,n)=>{o[k]=(o[k]||0)+n;},loopsKeep:()=>({food:50,timber:40,stone:40,iron:10}),
  realmPublicWorksRecruiting:()=>state.recruiting,realmPublicWorksRepairWork:()=>state.work,realmPublicWorksHouseWork:()=>state.houseWork,
  loopsCarRoute:()=>[{x:0,z:0},{x:100,z:0}],loopsCarLoad:()=>null,loopsHorseLook(){},warLevel:()=>5,warUnitLevel:()=>5,pick:(r,a)=>a[0],VILLAGER_NAMES:['Carter'],villagerLook:()=>({}),
  addFire(){state.fires++;},sfxAt(){},news:s=>state.news.push(s),possessive:s=>s+"'s",addRP:n=>state.rp+=n,LOOPS_LABEL:{food:'food',timber:'timber',wool:'wool',hides:'hides'},
  heightAt:()=>0,FACTION_NEUTRAL:4,makeEnt(o){const e={...o,id:next++,alive:true,anim:{amt:0},look:{}};context.ENT.push(e);state.spawned++;return e;},
  spawnRealmUnit(r,cls,level,role,x,z){return context.makeEnt({kind:'humanoid',faction:r,cls,level,role,x,z});},
  getEnt:id=>context.ENT.find(e=>e.id===id),netEntityFind:id=>context.ENT.find(e=>e.netEntityId===id),
  netEntityRegister(e){e.netEntityId=e.netEntityId||'scene:test:'+e.id;},removeEnt(e){e.removed=true;state.removed++;},
  loopsTownSeen:()=>false,loopsLoadText:()=>'',uiLog(){},uiToast(){},uiError:e=>state.errors.push(e),
  loopsCarTurn(c){c.back=true;c.i=1;},loopsCarGone(c){c.state='gone';},loopsCartFollow(){},
  anMine:()=>state.owned.filter(e=>!e.removed&&e.tame.owner==='player'),anAdult:r=>r.age>=900,saveSoon(){state.saves++;},
  saveNow:async()=>{context.SAVE.lastBody=JSON.stringify({char:{x:{animals:{list:state.privateConfirm?state.owned.map(e=>({k:e.tame.k,sc:e.tame.sharedClaim})):[]}}}});},
  SAVE_PARTS:{world:{loops:{save:()=>({v:1,r:[[999]],k:[[999]],c:[[0,10]]})}}},LOOPS_R:['food','timber','stone','iron','hides','wool','horses'],LOOPS_K:['food','timber','stone','iron'],
 });
 const names=['loopsYardIgnite','loopsCanonicalManaged','loopsAdd','loopsTake','loopsKeepTake','loopsKeepAdd','loopsProduce','loopsTradeStep','loopsTrickleOk','loopsLord','loopsWork','loopsHouseWork','loopsHorseOk','loopsCarSend','loopsCarArrive','loopsCarHome','loopsCarLost'];
 const api=names.concat(['realmLogisticsApplyProjection','realmLogisticsRequest','realmLogisticsPump','realmLogisticsFunding','realmLogisticsSettle','realmLogisticsDonateHorse','realmLogisticsOwnerFrame','realmLogisticsHorse','realmLogisticsMountGranted']);
 vm.runInContext(helper+'\n'+names.map(n=>extract(loops,n)).join('\n')+'\n'+['netWorldPartsLoopsSave','netWorldPartsLoopsApply'].map(n=>extract(worldparts,n)).join('\n')
  +'\nthis.api={'+api.join(',')+',netWorldPartsLoopsSave,netWorldPartsLoopsApply,internal:REALM_LOGISTICS};',context);
 return {state,context,api:context.api,view,L,K};
}
const paid=(more={})=>({id:'job',lease:'lease',peer:'keeper',season:1,realm:0,keep:0,cargo:{food:6,timber:6,stone:6},escorts:2,state:'active',at:100,...more});
test('hosted raw pools cannot be minted, debited, traded or restored through worldparts',()=>{
 const f=fixture(),before=JSON.stringify(f.L.r);
 assert.equal(f.api.loopsAdd(0,'food',20),0);assert.equal(f.api.loopsTake(0,{food:10}),0);
 assert.equal(f.api.loopsKeepAdd(f.K,'food',20),0);assert.equal(f.api.loopsKeepTake(f.K,{food:10}),0);
 f.api.loopsProduce(60);f.api.loopsTradeStep();assert.equal(JSON.stringify(f.L.r),before);
 f.api.netWorldPartsLoopsApply({r:[[9999]],k:[[9999]]});assert.equal(JSON.stringify(f.L.r),before);
 const saved=f.api.netWorldPartsLoopsSave();assert.equal(Object.hasOwn(saved,'r'),false);assert.equal(Object.hasOwn(saved,'k'),false);assert.equal(Object.hasOwn(saved,'c'),false);
 f.state.managed=false;assert.equal(f.api.loopsAdd(0,'food',20),20);assert.equal(f.api.loopsTake(0,{food:10}),1);assert.equal(f.L.r[0].food,110);
});
test('realm repairs and garrison births require finite paid projector context',()=>{
 const f=fixture();
 assert.equal(f.api.loopsTrickleOk(f.K),false);assert.equal(f.api.loopsLord(f.K,{}),false);
 f.state.recruiting=true;assert.equal(f.api.loopsTrickleOk(f.K),true);assert.equal(f.api.loopsLord(f.K,{}),true);
 assert.equal(f.api.loopsWork(f.K,'gate',1,100),0);assert.equal(f.api.internal.requests.size,1);
 f.state.work=0.5;assert.equal(f.api.loopsWork(f.K,'gate',1,100),0.5);
 f.state.houseWork=0.25;assert.equal(f.api.loopsHouseWork({num:5},1),0.25);
});
test('unfunded forced carts cannot spawn; confirmed jobs spawn one paid crew without local raw debits',()=>{
 const f=fixture(),before=JSON.stringify(f.L.r);
 assert.equal(f.api.loopsCarSend(0,f.K,true),null);assert.equal(f.state.spawned,0);
 f.view.jobs=[paid()];const c=f.api.loopsCarSend(0,f.K,false,f.view.jobs[0]);
 assert.ok(c);assert.equal(c.logisticsId,'job');assert.equal(c.esc.length,2);assert.equal(f.state.spawned,4);
 assert.equal(f.api.loopsCarSend(0,f.K,false,f.view.jobs[0]),c);assert.equal(f.state.spawned,4);assert.equal(JSON.stringify(f.L.r),before);
});
test('keeper handoff adopts paid job identity instead of minting duplicate cargo and escorts',()=>{
 const f=fixture();f.view.jobs=[paid()];f.api.realmLogisticsApplyProjection();assert.equal(f.state.spawned,4);
 const c=f.L.caravans[0];f.context.NET.self='next';f.api.realmLogisticsApplyProjection();
 assert.equal(f.state.spawned,4);assert.equal(c.logisticsPending,'adopt');assert.ok(f.api.internal.requests.has('adopt:job'));
 f.view.jobs=[paid({peer:'next',lease:'new'})];f.api.realmLogisticsApplyProjection();
 assert.equal(f.state.spawned,4);assert.equal(c.logisticsLease,'new');assert.equal(c.logisticsPending,'');
});
test('confirmed terminal delivery retires prepaid escorts without minting local cargo or loot',()=>{
 const f=fixture();f.view.jobs=[paid()];f.api.realmLogisticsApplyProjection();const c=f.L.caravans[0],before=JSON.stringify(f.L.r);
 f.view.jobs=[paid({state:'arrived'})];f.api.realmLogisticsApplyProjection();
 assert.equal(c.logisticsSettled,true);assert.equal(c.back,true);assert.equal(c.esc.length,0);assert.equal(f.state.removed,2);
 assert.equal(JSON.stringify(c.load),'{}');assert.equal(JSON.stringify(f.L.r),before);
 f.api.realmLogisticsApplyProjection();assert.equal(f.state.removed,2);
});
test('replicas never spawn or adopt logistics and unconfirmed responses retain the exact nonce',async()=>{
 const f=fixture();f.view.jobs=[paid()];f.state.keeper=false;f.api.realmLogisticsApplyProjection();assert.equal(f.state.spawned,0);
 assert.equal(f.api.realmLogisticsRequest('x',{op:'mount.issue',actorId:'scene:test:2'}),false);
 f.state.keeper=true;assert.equal(f.api.realmLogisticsRequest('x',{op:'mount.issue',actorId:'scene:test:2'}),true);
 f.api.realmLogisticsPump();await new Promise(setImmediate);const n=f.state.calls[0].nonce;
 f.context.GAME.t+=6;f.api.realmLogisticsPump();await new Promise(setImmediate);
 assert.equal(f.state.calls.length,2);assert.equal(f.state.calls[1].nonce,n);
});
test('private horse donation requires confirmed private claim and matching native outcome; no gold is invented',async()=>{
 const f=fixture(),e={id:77,alive:true,tame:{owner:'player',k:'horse',age:1000}};f.state.owned=[e];
 f.state.privateConfirm=false;assert.equal(await f.api.realmLogisticsDonateHorse(e),false);assert.equal(f.state.calls.length,0);assert.equal(e.removed,undefined);
 f.state.privateConfirm=true;f.state.responses.push(args=>({ok:true,confirmed:true,data:{actorId:args.actorId,claimId:'wrong'}}));
 assert.equal(await f.api.realmLogisticsDonateHorse(e),false);assert.equal(e.removed,undefined);
 f.state.responses.push(args=>({ok:true,confirmed:true,data:{actorId:args.actorId,claimId:args.claimId}}));
 assert.equal(await f.api.realmLogisticsDonateHorse(e),true);assert.equal(e.tame.owner,'gone');assert.equal(f.state.removed,1);assert.equal(f.state.saves,1);
});
test('confirmed donation cleanup is owner-bound and idempotent after private reload',()=>{
 const f=fixture(),ours={id:80,alive:true,tame:{owner:'player',k:'horse',sharedClaim:'ours'}},other={id:81,alive:true,tame:{owner:'player',k:'horse',sharedClaim:'other'}};
 f.state.owned=[ours,other];f.view.donations=[{ownerAccount:'account',claimId:'ours'},{ownerAccount:'other-account',claimId:'other'}];
 f.api.realmLogisticsOwnerFrame();assert.equal(ours.removed,true);assert.equal(other.removed,undefined);assert.equal(f.state.removed,1);
 f.api.realmLogisticsOwnerFrame();assert.equal(f.state.removed,1);
});

test('yard ignition keeps hosted stock canonical and preserves complete solo burn effects',()=>{
 const f=fixture(),yard={r:0,x:0,z:0,yaw:0,burn:0},before=JSON.stringify(f.L.r);
 f.L.you.raids=0;f.api.loopsYardIgnite(yard,f.context.GAME.player);
 assert.equal(JSON.stringify(f.L.r),before);assert.equal(yard.burn,32);assert.equal(f.state.fires,3);
 assert.equal(f.L.you.raids,1);assert.equal(f.state.rp,75);
 assert.match(f.state.news[0],/yard is burning/);assert.equal(f.state.news[0].includes('go up in smoke'),false);
 f.state.managed=false;yard.burn=0;f.api.loopsYardIgnite(yard,f.context.GAME.player);
 assert.equal(f.L.r[0].timber,65);assert.equal(f.L.r[0].food,80);assert.equal(f.L.r[0].wool,7);assert.equal(f.L.r[0].hides,7);
 assert.equal(f.state.fires,6);assert.equal(f.L.you.raids,2);assert.equal(f.state.rp,150);
 assert.match(f.state.news[1],/35 timber, 20 food, 3 wool, 3 hides go up in smoke/);
 f.api.loopsYardIgnite(yard,f.context.GAME.player);assert.equal(f.state.fires,6);
});
test('paid grants reject absent or stale native world scope while owner donation tombstones survive',()=>{
 const f=fixture();f.view.jobs=[paid()];f.view.mounts=[{actorId:'scene:test:80',realm:0}];
 const horse={id:80,netEntityId:'scene:test:80',alive:true,faction:0,tame:{owner:'player',k:'horse',sharedClaim:'donated'}};
 f.context.ENT.push(horse);f.state.owned=[horse];f.view.donations=[{ownerAccount:'account',claimId:'donated'}];
 delete f.view.scope;f.api.realmLogisticsApplyProjection();
 assert.equal(f.state.spawned,0);assert.equal(f.api.realmLogisticsFunding('job'),null);
 assert.equal(f.api.realmLogisticsMountGranted('scene:test:80',0),false);
 assert.equal(f.api.realmLogisticsRequest('mount',{op:'mount.issue',actorId:'scene:test:80'}),false);
 assert.equal(horse.removed,true);assert.equal(f.state.removed,1);
 f.view.scope={origin:'old-world',epoch:1};f.api.realmLogisticsApplyProjection();assert.equal(f.state.spawned,0);
 f.view.scope={origin:'world',epoch:0};f.api.realmLogisticsApplyProjection();assert.equal(f.state.spawned,0);
 f.view.scope={origin:'world',epoch:1};f.api.realmLogisticsApplyProjection();assert.equal(f.state.spawned,4);
 assert.equal(f.api.realmLogisticsMountGranted('scene:test:80',0),true);
});
