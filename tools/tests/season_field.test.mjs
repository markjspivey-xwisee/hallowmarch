import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkedWorldSnapshot } from '../../server/gaming/hallowmarch-world-state.js';
import { makeField } from '../../server/fieldarmies.js';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const realmSource = read('08m_realm.js'), managementSource = read('08p_realm_management.js');
const seasonSource = read('08o_season2.js'), aiSource = read('08_ai.js');
const plain = value => JSON.parse(JSON.stringify(value));
function extract(source, name) {
  const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end >= start, name); return source.slice(start, end + 2);
}
function modelFixture() {
  // Match the production server loader's realm, including strict receipt-data prototypes.
  const api = new Function(realmSource + '\n' + managementSource + '\nreturn { RSM,RSM_GEO,RSM_GOODS,rsmProjectCost,rsmProject,realmSimInit,realmSimStep,realmSimSanitize,realmSimFieldTake,realmSimFieldReport,realmSimFieldFold,realmManageInit,realmManageStep,realmManageAction,realmManageView,realmSimOrder,rsmArmy,rsmEconomy,rsmFieldDesc };')();
  const RS = api.realmSimInit(987654, { days: 28 });
  api.realmManageInit(RS);
  return { api, RS,
    action(realm, args) { return api.realmManageAction(RS, realm, { revision: RS.management.revision, ...args }); },
    step(seconds) { let left = seconds; while (left > 1e-8) { const dt = Math.min(60, left); RS.t += dt; api.realmManageStep(RS, dt); left -= dt; } },
  };
}
function bridgeFixture({ initialPhase = 'war', capability = 2, virtual = false } = {}) {
  const model = modelFixture(), { api, RS } = model, GEO = api.RSM_GEO;
  if (initialPhase === 'war') { RS.t = RS.len / 4; RS.phase = 'war'; }
  const world = { keeps: GEO.keep.map(([x,z],id) => ({ id,x,z,home:RS.keeps[id].home })),
    SITES: GEO.muster.map(([x,z],realm) => ({kind:'muster',realm,x,z})).concat(GEO.temple.map(([x,z],realm) => ({kind:'temple',realm,x,z}))) };
  const room = { clients: new Map(), regions: { frontier: 'keeper' } }, rooms = new Map([['march',room]]);
  const state = { keeper: true, fresh:true, view: virtual ? { realm:0,x:GEO.muster[0][0],z:GEO.muster[0][1],radius:220 } : null };
  const keeper = { peer:'keeper',realm:0,region:'frontier',room,slow:{seasonField:capability},ws:{readyState:1},
    pos: virtual ? {x:450,z:450} : {x:GEO.muster[0][0],z:GEO.muster[0][1]} };
  const king = { peer:'king',realm:0,region:'town',room,slow:{seasonField:2},ws:{readyState:1},pos:{x:-450,z:450} };
  room.clients.set(king.peer,king); room.clients.set(keeper.peer,keeper);
  const serverMessages=[], clientMessages=[], entities=new Map(), costs={loops:0,spawns:0,removed:0};
  const season = { RS, M:api, dirty:false, fieldGrantConfirmed: () => true }, stats={};
  const field = makeField(season,rooms,(client,message)=>serverMessages.push({client,message}),()=> 'frontier',world,stats,
    client=>client===king ? state.view : null,client=>client===keeper && state.keeper);
  const realms = GEO.muster.map(([x,z],id)=>({id,name:'Realm '+id,musterSite:{x,z,name:'Muster '+id},
    nav:{muster:{id,x,z}},color:'#ffffff'}));
  const keeps = world.keeps.map((p,id)=>({id,realm:RS.keeps[id].h,orig:RS.keeps[id].home,
    site:{x:p.x,z:p.z,name:'Keep '+id},nav:{gate:{id:id+10,x:p.x,z:p.z},court:{id:id+20,x:p.x,z:p.z}}}));
  const player = {id:10000,role:'player',alive:true,faction:0,x:keeper.pos.x,y:0,z:keeper.pos.z};
  let nextEntity=1;
  const context = vm.createContext({
    NETWS:{url:'wss://march.test'},NETS:{s:{n:RS.n,phase:initialPhase,management:{v:1},armies:[],offs:[]}},
    GAME:{started:true,t:100,player},CAMPAIGN:{n:1,state:'war'},WAR:{warbands:[],nextWb:1,keeps,temples:[]},REALMS:realms,ENT:[],
    NET:{self:'keeper'},SEASONP:{rs:null},TAU:Math.PI*2,WB_CLASSES:['warrior','archer','priest'],WAR_LEVEL_OFF:{soldier:0},
    OUTFIT:{lord:1},WB:{},queueMicrotask(){},netRealmSeasonProjectionFresh:()=>state.fresh,netEntityCanSimulateWorld:()=>state.keeper,netRealmViewInterest:()=>state.view,
    netWsSend:message=>{clientMessages.push(message);return true;},
    clamp:(n,lo,hi)=>Math.max(lo,Math.min(hi,n)),dist:(x,z,a,b)=>Math.hypot(x-a,z-b),
    isWalkable:()=>true,look5InColl:()=>false,inDungeon:()=>false,heightAt:()=>0,floorAt:()=>0,
    randomName:r=>'Unit '+r,classLook:()=>({scale:1,mask:0}),warLevel:()=>1,warUnitLevel:()=>1,
    makeEnt(values){ const entity={id:nextEntity++,alive:true,hp:100,maxHp:100,anim:{},...values};entities.set(entity.id,entity);context.ENT.push(entity);costs.spawns++;return entity; },
    setupStats(entity){entity.hp=entity.maxHp=100;},
    getEnt:id=>entities.get(id)||null,
    wbMembers:band=>band.members.map(id=>entities.get(id)).filter(entity=>entity&&entity.alive&&!entity.removed),
    wbLeader:band=>context.wbMembers(band)[0]||null,wbOrd:()=>1,
    removeEnt(entity){entity.removed=true;entity.alive=false;entities.delete(entity.id);const i=context.ENT.indexOf(entity);if(i>=0)context.ENT.splice(i,1);costs.removed++;},
    cwSetOrder(band,order){band.order={...order,phase:'travel'};},
    loopsMuster(){costs.loops++;throw new Error('canonical cohort cannot pay browser LOOPs recruitment twice');},
    loopsTake(){costs.loops++;throw new Error('canonical cohort cannot debit browser LOOPs');},
    LOOPS:{on:true,r:[{food:100,iron:20},{food:100,iron:20},{food:100,iron:20}]},
    news(){},possessive:s=>s+"'s",siegeGatePoint:site=>({x:site.x,z:site.z,nx:0,nz:1}),
    seasonGiveKeep(keep,realm){keep.realm=realm;},
  });
  vm.runInContext(extract(aiSource,'spawnRealmUnit')+'\n'+seasonSource+'\nthis.api={S2,s2Spawn,s2Report,s2BandStep,s2Remove,s2Read,s2Near,season2ServerMsg,season2Update,season2CanonicalWar,season2StrategicArmies,s2Reconcile,season2InventoryReady};',context);
  return {model,api,RS,field,season,state,keeper,king,room,rooms,serverMessages,clientMessages,context,client:context.api,entities,costs,
    army() { return RS.armies.find(a=>a.state!=='gone'); },
    legacyArmy() { const A=api.rsmArmy(RS,0,8,'assault',2);assert.ok(A);return A; },
    grant() { field.step();const packet=serverMessages.filter(p=>p.message.t==='sarmy').at(-1);assert.ok(packet,'FIELD issues a grant');return packet.message; },
    deliver(message) { context.api.season2ServerMsg(message); },
    report(message) { field.report(keeper,message); },
    folds() { return serverMessages.filter(p=>p.message.t==='sarmyfold').map(p=>p.message); },
  };
}
function success(result) { assert.equal(result.ok,true,result.why||result.message); return result; }
function noModelChange(f,run) { const before=plain(f.RS);run();assert.deepEqual(plain(f.RS),before); }

test('paid reserves muster through FIELD into one live cohort with no browser LOOPs charge', () => {
  const f=bridgeFixture({initialPhase:'muster'}), R=f.RS.realms[0];
  const raw=[...R.s], reserves=R.lev;
  success(f.model.action(0,{type:'muster'}));
  const A=f.army(); assert.ok(A);assert.equal(A.kind,'company');assert.equal(A.manual,true);assert.equal(A.mission,'defend');
  assert.equal(A.n,reserves-4);assert.equal(R.lev,4);
  for(let i=0;i<8;i++)assert.equal(R.s[i],raw[i]-(i===0?A.n*1.5:0),'mobilization cost '+i);
  const afterMuster=plain(f.RS.realms.map(r=>r.s)), loops=plain(f.context.LOOPS);
  const grant=f.grant();f.deliver(grant);
  const band=f.client.S2.bands.get(A.id);assert.ok(band);assert.equal(band.wb.order.type,'defend');
  assert.equal(f.context.WAR.warbands.length,1);assert.equal(f.costs.spawns,Math.round(A.n*0.42));
  f.deliver(grant);assert.equal(f.costs.spawns,Math.round(A.n*0.42));assert.equal(f.client.S2.bands.size,1);
  assert.deepEqual(plain(f.RS.realms.map(r=>r.s)),afterMuster);assert.deepEqual(plain(f.context.LOOPS),loops);assert.equal(f.costs.loops,0);
  f.client.s2BandStep(band);assert.equal(f.client.S2.bands.has(A.id),true,'defending an owned keep is not a completed capture');
});
test('terminal report returns remaining soldiers once and removes the live band', () => {
  const f=bridgeFixture();f.legacyArmy();const grant=f.grant();f.deliver(grant);
  const B=f.client.S2.bands.get(grant.a.id), reserves=f.RS.realms[0].lev, count=f.context.wbMembers(B.wb).length;
  f.client.s2Report(B,{n:grant.a.n,done:'home'});
  const report=f.clientMessages.at(-1);f.report(report);
  assert.equal(f.RS.armies.length,0);assert.equal(f.RS.realms[0].lev,reserves+grant.a.n);
  const fold=f.folds().at(-1);assert.ok(fold);f.deliver(fold);
  assert.equal(f.client.S2.bands.size,0);assert.equal(B.wb.dead,true);assert.equal(f.costs.removed,count);
  noModelChange(f,()=>f.report(report));
  f.deliver(grant);assert.equal(f.costs.spawns,count,'settled grant cannot create another cohort');
});
test('stale lease, wrong season, wrong socket and lost keeper authority cannot report', () => {
  for(const change of [
    (f,m)=>{m.fieldLease='old-lease-0001';},
    (f,m)=>{m.season++;},
    (f,m)=>{f.RS.n++;},
    (f,m)=>{f.state.keeper=false;},
    (f,m)=>{f.keeper.slow.seasonField=1;},
  ]){
    const f=bridgeFixture();f.legacyArmy();const grant=f.grant();
    const message={t:'sarmyrep',id:grant.a.id,season:grant.a.season,fieldLease:grant.a.fieldLease,rep:{n:1,p:0.5}};
    change(f,message);noModelChange(f,()=>f.report(message));assert.equal(f.field.stats.reports,0);
  }
  const f=bridgeFixture();f.legacyArmy();const grant=f.grant(), clone={...f.keeper};
  noModelChange(f,()=>f.field.report(clone,{id:grant.a.id,season:grant.a.season,fieldLease:grant.a.fieldLease,rep:{n:1}}));
});
test('capability version two is required before FIELD grants any cohort', () => {
  for(const capability of [undefined,0,1]){
    const f=bridgeFixture({capability});f.legacyArmy();if(capability===undefined)delete f.keeper.slow.seasonField;
    f.field.step();assert.equal(f.field.held.size,0);assert.equal(f.serverMessages.length,0);assert.equal(f.army().onField,undefined);
  }
  const f=bridgeFixture({capability:2});f.legacyArmy();assert.equal(f.grant().t,'sarmy');
});
test('promoted keeper adopts replicated survivors and HP without spawning replacements', () => {
  const f=bridgeFixture();f.legacyArmy();const first=f.grant();f.deliver(first);
  const old=f.client.S2.bands.get(first.a.id), members=f.context.wbMembers(old.wb), originalSpawns=f.costs.spawns;
  members[0].hp=27;members.at(-1).alive=false;
  const survivors=f.context.wbMembers(old.wb), remaining=survivors.length*old.per;
  f.report({id:first.a.id,season:first.a.season,fieldLease:first.a.fieldLease,rep:{n:remaining}});
  f.field.left(f.keeper);f.client.S2.bands.clear();
  const next=f.grant();assert.ok(next.a.fieldLease!==first.a.fieldLease);f.deliver(next);
  const adopted=f.client.S2.bands.get(next.a.id);
  assert.equal(adopted.wb,old.wb);assert.equal(f.costs.spawns,originalSpawns);
  assert.equal(f.context.wbMembers(adopted.wb).length,survivors.length);assert.equal(survivors[0].hp,27);
  assert.ok(adopted.per*survivors.length<=next.a.n+1e-8,'adoption never inflates strategic numbers');
  f.deliver({t:'sarmyfold',id:first.a.id,season:first.a.season,fieldLease:first.a.fieldLease});
  assert.equal(f.client.S2.bands.get(next.a.id),adopted,'stale fold cannot remove the newer lease');
  noModelChange(f,()=>f.report({id:first.a.id,season:first.a.season,fieldLease:first.a.fieldLease,rep:{n:0,done:'fallen'}}));
});
test('campaign end and reset fold surviving cohorts instead of reporting false deaths', () => {
  for(const reset of [false,true]){
    const f=bridgeFixture();f.legacyArmy();const grant=f.grant();f.deliver(grant);
    const B=f.client.S2.bands.get(grant.a.id);
    if(reset){f.context.CAMPAIGN.n++;for(const e of f.context.wbMembers(B.wb))f.context.removeEnt(e);B.wb.members=[];}
    else f.context.CAMPAIGN.state='peace';
    f.client.s2BandStep(B);
    const report=f.clientMessages.at(-1);assert.equal(report.rep.fold,1);assert.equal(report.rep.done,undefined);
    assert.equal(report.rep.n,grant.a.n);assert.equal(f.client.S2.bands.size,0);
    f.report(report);assert.equal(f.army().n,grant.a.n);assert.equal(f.army().onField,null);
  }
});
test('verified ruler focus extends an existing keeper reach but never grants keeper authority', () => {
  const f=bridgeFixture({virtual:true});f.legacyArmy();const pos=plain(f.keeper.pos), grant=f.grant();
  assert.equal(f.serverMessages.find(p=>p.message===grant).client,f.keeper);assert.equal(f.field.held.get(grant.a.id).c,f.keeper);
  assert.deepEqual(f.keeper.pos,pos);assert.equal(f.field.held.get(grant.a.id).c===f.king,false);
  f.state.view=null;f.field.step();assert.equal(f.field.held.size,0);assert.equal(f.army().onField,null);
  assert.equal(f.folds().at(-1).fieldLease,grant.a.fieldLease);
  const noKeeper=bridgeFixture({virtual:true});noKeeper.state.keeper=false;noKeeper.legacyArmy();noKeeper.field.step();
  assert.equal(noKeeper.field.held.size,0);assert.equal(noKeeper.serverMessages.length,0);
});
test('view expiry does not reject a legitimate final loss-and-fold report from the current keeper', () => {
  const f=bridgeFixture({virtual:true});f.legacyArmy();const grant=f.grant();f.state.view=null;
  f.report({id:grant.a.id,season:grant.a.season,fieldLease:grant.a.fieldLease,rep:{n:grant.a.n/2,fold:true}});
  assert.equal(f.army().n,grant.a.n/2);assert.equal(f.army().onField,null);assert.equal(f.field.held.size,0);
});
test('manual companies cold-restore mission and position while automatic armies remain phase gated', () => {
  const f=bridgeFixture({initialPhase:'muster'});success(f.model.action(0,{type:'muster'}));
  const A=f.army();Object.assign(A,{mission:'attack',k:2,fx:11.25,fz:-42.5});
  const restored=f.api.realmSimSanitize(plain(f.RS)), next=restored.armies.find(a=>a.id===A.id);
  for(const key of ['id','kind','manual','mission','k','fx','fz','n'])assert.equal(next[key],A[key],key);
  const descriptor=f.api.realmSimFieldTake(restored,next.id,'cold-keeper');
  assert.equal(descriptor.manual,true);assert.equal(descriptor.mission,'attack');assert.equal(descriptor.fx,11.25);assert.equal(descriptor.fz,-42.5);
  const auto=bridgeFixture({initialPhase:'muster'});assert.equal(auto.api.realmSimOrder(auto.RS,0,{type:'muster'},{rank:5}),false);
  auto.api.rsmArmy(auto.RS,0,8,'assault',2);auto.field.step();assert.equal(auto.field.held.size,0);
});
test('paid recruits use the quoted resources, two workers, real training time and total levy capacity', () => {
  const f=modelFixture(), R=f.RS.realms[0];
  for(const b of R.management.buildings)success(f.action(0,{type:'pause',buildingId:b.id,paused:true}));
  const military=f.api.realmManageView(f.RS,0).military, raw=[...R.s], lev=R.lev;
  assert.equal(military.secondsPerUnit,45);assert.equal(military.musterCostPerTroop,1.5);assert.equal(military.musterReserve,4);
  success(f.action(0,{type:'recruit',units:4}));
  for(let i=0;i<8;i++)assert.equal(R.s[i],raw[i]-4*f.api.RSM.levyCost[i],'recruit cost '+i);
  assert.equal(R.management.training.remaining,180);assert.equal(R.lev,lev);
  const before=plain(f.RS);assert.equal(f.action(0,{type:'recruit',units:1}).ok,false);assert.deepEqual(plain(f.RS),before);
  R.management.population=0;f.step(60);assert.equal(R.management.training.remaining,180);assert.equal(R.management.training.blocked,'workforce');
  R.management.population=32;f.step(179);assert.ok(R.management.training);assert.ok(R.management.training.remaining>0);
  f.step(1);assert.equal(R.management.training,null);assert.equal(R.lev,lev+4);
  R.lev=f.api.RSM.levyMax-1;
  const capped=plain(f.RS);assert.equal(f.action(0,{type:'recruit',units:2}).ok,false);assert.deepEqual(plain(f.RS),capped);
  R.lev=4;R.s[0]=0;
  const hungry=plain(f.RS);assert.equal(f.action(0,{type:'muster'}).ok,false);assert.deepEqual(plain(f.RS),hungry);
});

test('manual player orders and actual live positions report back without being overwritten', () => {
  const f=bridgeFixture({initialPhase:'muster'});success(f.model.action(0,{type:'muster'}));
  const grant=f.grant();f.deliver(grant);const B=f.client.S2.bands.get(grant.a.id), target=f.context.WAR.keeps[2];
  B.wb.order={type:'attack',keep:target,byPlayer:true,phase:'travel'};
  const leader=f.context.wbLeader(B.wb);leader.x=11.25;leader.z=-22.5;
  f.client.s2BandStep(B);assert.equal(B.wb.order.byPlayer,true);assert.equal(B.wb.order.keep,target);
  const report=f.clientMessages.at(-1);assert.deepEqual(plain(report.rep.order),{type:'attack',keep:2});f.report(report);
  assert.equal(f.army().k,2);assert.equal(f.army().mission,'attack');assert.equal(f.army().fx,11.25);assert.equal(f.army().fz,-22.5);
});
test('pending hosted snapshots block free legacy spawns and expose an empty strategic army list', () => {
  const f=bridgeFixture();f.context.NETS.s=null;
  assert.equal(f.client.season2CanonicalWar(),true);
  assert.deepEqual(plain(f.client.season2StrategicArmies()),[]);
});
test('training queues cold-restore exactly and finish once without paying twice', () => {
  const f=modelFixture(), R=f.RS.realms[0];
  for(const b of R.management.buildings)success(f.action(0,{type:'pause',buildingId:b.id,paused:true}));
  success(f.action(0,{type:'recruit',units:2}));f.step(30);
  const input=plain(f.RS), next=f.api.realmSimSanitize(input);
  assert.deepEqual(plain(next.realms[0].management.training),input.realms[0].management.training);
  assert.deepEqual(plain(next.realms[0].s),input.realms[0].s);
  const reserves=next.realms[0].lev;
  f.api.realmManageStep(next,60);assert.equal(next.realms[0].lev,reserves+2);assert.equal(next.realms[0].management.training,null);
  f.api.realmManageStep(next,60);assert.equal(next.realms[0].lev,reserves+2);
  const legacy=plain(f.RS);for(const realm of legacy.realms)delete realm.management.training;
  const legacyRestore=f.api.realmSimSanitize(legacy);
  for(const realm of legacyRestore.realms)assert.equal(Object.hasOwn(realm.management,'training'),false,'legacy optional training field stays absent at native admission');
});
test('manual companies consume an existing siege project asset while legacy army DTOs keep their shape', () => {
  const f=bridgeFixture({initialPhase:'muster'});f.RS.realms[0].proj.engines=2;success(f.model.action(0,{type:'muster'}));
  assert.equal(f.army().eng,1);assert.equal(f.RS.realms[0].proj.engines,1);
  const restored=f.api.realmSimSanitize(plain(f.RS));assert.equal(restored.armies[0].eng,1);
  const legacy=bridgeFixture();legacy.legacyArmy();
  const old=legacy.api.realmSimSanitize(plain(legacy.RS)).armies[0];
  for(const key of ['manual','mission','fx','fz'])assert.equal(Object.hasOwn(old,key),false,'legacy army omits '+key);
});

const LEGACY_ARMY_NATIVE_FIXTURE = "{\"worlds\":{},\"season\":{\"v\":1,\"seed\":20261028,\"rs\":20261028,\"n\":1,\"t\":604800,\"len\":2419200,\"nextLen\":0,\"phase\":\"war\",\"winner\":null,\"t0\":0,\"live\":false,\"names\":{\"realms\":[\"Logres\",\"Ériu\",\"Thule\"],\"keeps\":[\"the Logres keep west\",\"the Logres keep east\",\"the Ériu keep west\",\"the Ériu keep east\",\"the Thule keep west\",\"the Thule keep east\"]},\"realms\":[{\"s\":[320,128,96,40,32,24,10,480],\"bank\":[0,0,0,0,0,0,0,0],\"lev\":4,\"sp\":0,\"del\":0,\"work\":0,\"proj\":{\"walls\":0,\"granary\":0,\"yard\":0,\"smithy\":0,\"engines\":0},\"act\":\"granary\",\"prog\":0,\"votes\":{},\"aim\":-1,\"short\":[],\"hungry\":0,\"by\":{},\"raidAt\":0,\"decideAt\":0,\"levyAt\":0,\"refillAt\":0,\"dDay\":-1,\"dWorth\":0,\"stats\":{\"trained\":0,\"lost\":0,\"taken\":0,\"raids\":0,\"made\":0,\"ate\":0,\"offensives\":0,\"won\":0,\"hungryH\":0,\"poured\":0,\"bought\":0}},{\"s\":[320,128,96,40,32,24,10,480],\"bank\":[0,0,0,0,0,0,0,0],\"lev\":12,\"sp\":0,\"del\":0,\"work\":0,\"proj\":{\"walls\":0,\"granary\":0,\"yard\":0,\"smithy\":0,\"engines\":0},\"act\":\"granary\",\"prog\":0,\"votes\":{},\"aim\":-1,\"short\":[],\"hungry\":0,\"by\":{},\"raidAt\":0,\"decideAt\":0,\"levyAt\":0,\"refillAt\":0,\"dDay\":-1,\"dWorth\":0,\"stats\":{\"trained\":0,\"lost\":0,\"taken\":0,\"raids\":0,\"made\":0,\"ate\":0,\"offensives\":0,\"won\":0,\"hungryH\":0,\"poured\":0,\"bought\":0}},{\"s\":[320,128,96,40,32,24,10,480],\"bank\":[0,0,0,0,0,0,0,0],\"lev\":12,\"sp\":0,\"del\":0,\"work\":0,\"proj\":{\"walls\":0,\"granary\":0,\"yard\":0,\"smithy\":0,\"engines\":0},\"act\":\"granary\",\"prog\":0,\"votes\":{},\"aim\":-1,\"short\":[],\"hungry\":0,\"by\":{},\"raidAt\":0,\"decideAt\":0,\"levyAt\":0,\"refillAt\":0,\"dDay\":-1,\"dWorth\":0,\"stats\":{\"trained\":0,\"lost\":0,\"taken\":0,\"raids\":0,\"made\":0,\"ate\":0,\"offensives\":0,\"won\":0,\"hungryH\":0,\"poured\":0,\"bought\":0}}],\"keeps\":[{\"h\":0,\"home\":0,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":0,\"home\":0,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":1,\"home\":1,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":{\"a\":1,\"t\":604800}},{\"h\":1,\"home\":1,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":2,\"home\":2,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":2,\"home\":2,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null}],\"hallows\":[0,1,2],\"hallowAt\":[0,0,0],\"armies\":[{\"id\":1,\"r\":0,\"n\":8,\"n0\":8,\"kind\":\"assault\",\"k\":2,\"q\":-1,\"eng\":1,\"p\":1,\"len\":255.62830856447928,\"state\":\"siege\",\"t0\":604800,\"siegeH\":2.75,\"hungry\":0,\"arm\":1}],\"nextArmy\":2,\"offs\":[],\"log\":[{\"t\":0,\"r\":-1,\"k\":\"news\",\"x\":\"The first season of the March begins: 28 days, the muster first (4d 16h). Raise your stores, build and train: no keep can fall until the war.\"},{\"t\":604800,\"r\":0,\"k\":\"news\",\"x\":\"Logres marches 8 soldiers and 1 engine on the Ériu keep west.\"}],\"past\":[],\"stats\":{\"captures\":0,\"sieges\":0,\"relief\":0,\"raids\":0,\"battles\":0},\"ln\":2}}";
const LEGACY_ARMY_NATIVE_SHA256 = "2aab1efb291b26a033e3a80464f1dc28de017ce0657aa0991333aa695000a0e5";

test('an old confirmed native army without manual fields restores byte-exactly', () => {
  const f=modelFixture(), input=JSON.parse(LEGACY_ARMY_NATIVE_FIXTURE);
  const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(digest(input),LEGACY_ARMY_NATIVE_SHA256);
  assert.equal(input.season.armies.length,1);
  const restored=f.api.realmSimSanitize(input.season);
  for(const key of ['management','managementReceipts'])assert.equal(Object.hasOwn(restored,key),false,key+' stays absent');
  for(const key of ['manual','mission','fx','fz'])assert.equal(Object.hasOwn(restored.armies[0],key),false,key+' stays absent');
  assert.deepEqual(plain(restored.armies),input.season.armies);
  const native=checkedWorldSnapshot({worlds:input.worlds,season:plain(restored)},{keepCount:6,
    realmModule:{loops:true,realmSimSanitize:f.api.realmSimSanitize}});
  assert.deepEqual(native,input);assert.equal(digest(native),LEGACY_ARMY_NATIVE_SHA256);
});

test('retargeting a besieging manual company releases only its old siege without charging troops or goods', () => {
  for(const order of [{type:'attack',keep:3},{type:'defend',keep:0}]){
    const f=bridgeFixture({initialPhase:'muster'});success(f.model.action(0,{type:'muster'}));const A=f.army(),grant=f.grant();
    f.deliver(grant);const B=f.client.S2.bands.get(A.id);
    Object.assign(A,{k:2,mission:'attack',state:'siege',siegeH:3.5});f.RS.keeps[2].siege={a:A.id,t:f.RS.t};
    Object.assign(B.a,{k:2,mission:'attack',state:'siege',p:0.9});
    B.wb.order={type:order.type,keep:f.context.WAR.keeps[order.keep],phase:'travel',byPlayer:true};
    const stores=plain(f.RS.realms.map(r=>r.s)),reserves=plain(f.RS.realms.map(r=>r.lev)),soldiers=A.n;
    f.client.s2BandStep(B);assert.equal(B.a.state,'march');assert.ok(B.a.p<0.5,'new objective starts a fresh travel phase');
    const report=f.clientMessages.at(-1);assert.deepEqual(plain(report.rep.order),order);f.report(report);
    assert.equal(f.RS.keeps[2].siege,null);assert.equal(A.k,order.keep);assert.equal(A.mission,order.type);
    assert.equal(A.state,'march');assert.equal(A.siegeH,0);assert.equal(A.n,soldiers);
    assert.deepEqual(plain(f.RS.realms.map(r=>r.s)),stores);assert.deepEqual(plain(f.RS.realms.map(r=>r.lev)),reserves);
  }
});

test('a replacement lease on the same page preserves the injured cohort and rejects its stale fold', () => {
  const f=bridgeFixture();f.legacyArmy();const first=f.grant();f.deliver(first);
  const before=f.client.S2.bands.get(first.a.id), members=f.context.wbMembers(before.wb), spawned=f.costs.spawns;
  members[0].hp=19;members.at(-1).alive=false;
  const survivors=f.context.wbMembers(before.wb);
  f.report({id:first.a.id,season:first.a.season,fieldLease:first.a.fieldLease,rep:{n:survivors.length*before.per}});
  f.field.left(f.keeper);const next=f.grant();f.deliver(next);
  const adopted=f.client.S2.bands.get(next.a.id);assert.equal(adopted.wb,before.wb);
  assert.equal(f.costs.spawns,spawned);assert.equal(f.context.wbMembers(adopted.wb).length,survivors.length);
  assert.equal(survivors[0].hp,19);assert.equal(f.costs.removed,0);
  f.deliver({t:'sarmyfold',id:first.a.id,season:first.a.season,fieldLease:first.a.fieldLease});
  assert.equal(f.client.S2.bands.get(next.a.id),adopted);
});
test('native management receipts preserve bounded logistics grant data exactly', () => {
  const f=modelFixture(), data={jobId:'job-12345678',lease:'lease-12345678',load:{food:6,timber:6,stone:6}};
  f.RS.managementReceipts=[{owner:'owner',id:'nonce',digest:'digest',season:f.RS.n,realm:0,revision:0,result:{ok:true,message:'Granted',revision:0,data}}];
  const normalized=f.api.realmSimSanitize(plain(f.RS));
  assert.deepEqual(plain(normalized.managementReceipts),plain(f.RS.managementReceipts));
  const input={worlds:{},season:plain(normalized)};
  const native=checkedWorldSnapshot(input,{keepCount:6,realmModule:{loops:true,realmSimSanitize:f.api.realmSimSanitize}});
  assert.deepEqual(native,input);
  assert.deepEqual(plain(f.api.realmSimSanitize(native.season).managementReceipts),plain(normalized.managementReceipts));
});
test('invalid or oversized receipt data is omitted without widening the native result schema', () => {
  const f=modelFixture();let deep={};for(let i=0;i<8;i++)deep={next:deep};
  const cycle={};cycle.self=cycle;
  const bad=[NaN,{value:Infinity},'x'.repeat(161),Array(33).fill(1),Object.fromEntries(Array.from({length:33},(_,i)=>['k'+i,1])),
    JSON.parse('{"__proto__":{"polluted":true}}'),new Date(0),deep,cycle,Array(20).fill('x'.repeat(160))];
  for(const data of bad){
    f.RS.managementReceipts=[{owner:'owner',id:'nonce',digest:'digest',season:f.RS.n,realm:0,revision:0,result:{ok:true,message:'Granted',revision:0,data}}];
    const restored=f.api.realmSimSanitize(f.RS);
    assert.equal(restored.managementReceipts.length,1);assert.equal(Object.hasOwn(restored.managementReceipts[0].result,'data'),false);
  }
});
test('conquered housing cannot grow residents beyond the sanitizer population bound', () => {
  const f=modelFixture(), M=f.RS.realms[0].management, house=plain(M.buildings.find(b=>b.kind==='house'));
  M.buildings=Array.from({length:16},(_,i)=>({...house,id:'b:town:0:'+i,plotId:'town:0:'+i,level:3,targetLevel:3}));
  M.population=499.99;M.happiness=100;M.stock.bread=200;M.stock.cloth=200;M.stock.tools=120;
  assert.ok(f.api.realmManageView(f.RS,0).population.capacity>500);
  f.step(60);assert.equal(M.population,500);
  const input=f.api.realmSimSanitize(plain(f.RS)), restored=f.api.realmSimSanitize(plain(input));
  assert.deepEqual(plain(restored.realms[0].management),plain(input.realms[0].management));
  const snapshot={worlds:{},season:plain(input)};
  assert.deepEqual(checkedWorldSnapshot(snapshot,{keepCount:6,realmModule:{loops:true,realmSimSanitize:f.api.realmSimSanitize}}),snapshot);
});

test('cold cohort inventory blocks simulation until fresh and retires orphans before readiness', () => {
  const f=bridgeFixture();f.legacyArmy();const grant=f.grant();f.deliver(grant);
  const tracked=f.client.S2.bands.get(grant.a.id);
  const make=(id,canonical)=>{const e=f.context.makeEnt({kind:'humanoid',role:'soldier',faction:0,x:0,y:0,z:0});const wb={id,members:[e.id],realm:0,dead:false,order:null,season:{id:canonical,season:f.RS.n}};f.context.WAR.warbands.push(wb);return{wb,e};};
  const stale=make(900,900),extant=make(901,901);
  f.context.NETS.s={...f.context.NETS.s,armyIds:[901],armyIdsComplete:false};
  assert.equal(f.client.season2InventoryReady(),false);assert.equal(stale.e.alive,true);
  f.context.NETS.s.armyIdsComplete=true;f.state.fresh=false;
  assert.equal(f.client.season2InventoryReady(),false);assert.equal(stale.e.alive,true);
  f.state.fresh=true;assert.equal(f.client.season2InventoryReady(),true);
  assert.equal(stale.wb.dead,true);assert.equal(stale.e.alive,false);
  assert.equal(extant.e.alive,true);assert.equal(tracked.wb.dead,undefined);assert.equal(f.context.wbMembers(tracked.wb).length,Math.round(grant.a.n*0.42));
  const observer=make(902,902);f.state.keeper=false;f.client.s2Reconcile();assert.equal(observer.e.alive,true);assert.equal(observer.wb.dead,false);
});
test('the forty-first canonical army cannot muster or debit any resources', () => {
  const f=modelFixture();f.RS.t=f.RS.len/4;f.RS.phase='war';for(const R of f.RS.realms)R.lev=60;
  for(let i=0;i<40;i++)assert.ok(f.api.rsmArmy(f.RS,i%3,4,'assault',((i%3+1)%3)*2));
  assert.equal(f.RS.armies.length,40);const before=plain(f.RS);
  assert.equal(f.action(1,{type:'muster'}).ok,false);assert.deepEqual(plain(f.RS),before);
  assert.equal(f.api.rsmArmy(f.RS,1,4,'assault',0),null);assert.deepEqual(plain(f.RS),before);
});
test('convoy escort reservations count against levy capacity and eat canonical provisions', () => {
  const make=old=>{const f=modelFixture();f.RS.n=2;const R=f.RS.realms[0];R.lev=58;R.levyAt=R.refillAt=1e8;for(const K of f.RS.keeps)K.g=0;
    f.RS.management.logistics={v:1,season:old?1:2,jobs:[{id:'job-12345678',lease:'lease-12345678',season:old?1:2,peer:'keeper',realm:0,keep:0,cargo:{food:6,timber:6,stone:6},escorts:2,state:'active',at:0}],mounts:[],repairs:[],appliedGateSpent:[]};return f;};
  const active=make(false),old=make(true);
  assert.equal(active.api.realmManageView(active.RS,0).military.field,2);assert.equal(old.api.realmManageView(old.RS,0).military.field,0);
  active.api.rsmEconomy(active.RS,0,active.RS.realms[0],1/60);old.api.rsmEconomy(old.RS,0,old.RS.realms[0],1/60);
  assert.ok(Math.abs(old.RS.realms[0].s[0]-active.RS.realms[0].s[0]-2*active.api.RSM.eat/60)<1e-7);
  const before=plain(active.RS);assert.equal(active.action(0,{type:'recruit',units:1}).ok,false);assert.deepEqual(plain(active.RS),before);
  assert.equal(old.action(0,{type:'recruit',units:1}).ok,true,'expired season reservations cannot block new recruitment');
});
test('all six keep centers and owned plots use the physical world index order', () => {
  const f=modelFixture();
  for(let k=0;k<6;k++){
    const home=Math.floor(k/2),a=[150,270,30][home]*Math.PI/180,lat=k%2===0?64:-64;
    const x=Math.sin(a)*118+Math.cos(a)*lat,z=-Math.cos(a)*118+Math.sin(a)*lat;
    assert.ok(Math.abs(f.api.RSM_GEO.keep[k][0]-x)<1e-9);assert.ok(Math.abs(f.api.RSM_GEO.keep[k][1]-z)<1e-9);
    const owner=(home+1)%3;f.RS.keeps[k].h=owner;
    const plots=f.api.realmManageView(f.RS,owner).plots.filter(p=>p.site==='keep:'+k);assert.equal(plots.length,4);
    assert.ok(plots.every(p=>p.owner===owner));assert.ok(Math.abs(plots.reduce((n,p)=>n+p.x,0)/4-x)<0.011);assert.ok(Math.abs(plots.reduce((n,p)=>n+p.z,0)/4-z)<0.011);
  }
});
test('public works quotes and actual project spending share one canonical cost helper', () => {
  const f=modelFixture(),R=f.RS.realms[0],cost=[0,24,48,12,0,0,0,0];
  f.api.RSM.projects.smithy.cost=cost;R.act='smithy';R.work=0;R.prog=0;R.bank=Array(8).fill(0);R.s=f.api.RSM.target.map(n=>n*2);
  const quote=f.api.realmManageView(f.RS,0).publicWorks.find(p=>p.id==='smithy');
  const expected=Object.fromEntries(cost.map((n,i)=>[f.api.RSM_GOODS[i],n]).filter(([,n])=>n>0));
  assert.deepEqual(plain(quote.cost),expected);assert.deepEqual(plain(quote.nextCost),expected);
  const before=[...R.s];f.api.rsmProject(f.RS,0,R,f.api.RSM.projects.smithy.days*24);
  assert.equal(R.proj.smithy,1);for(let i=0;i<8;i++)assert.ok(Math.abs(R.s[i]-(before[i]-cost[i]))<1e-7,'project charge '+i);
});


test('native cohort handout waits for a literal confirmed grant while reports can still settle', () => {
  for (const pending of [false, undefined, Promise.resolve(true)]) {
    const f = bridgeFixture({initialPhase:'muster'}); success(f.model.action(0,{type:'muster'}));
    f.season.fieldGrantConfirmed = () => pending;
    const before = plain(f.RS); f.field.step();
    assert.deepEqual(plain(f.RS), before);
    assert.equal(f.field.held.size, 0);
    assert.equal(f.serverMessages.some(row => row.message.t === 'sarmy'), false);
    f.season.fieldGrantConfirmed = () => true;
    const grant = f.grant();
    assert.equal(f.field.held.size, 1);
    f.season.fieldGrantConfirmed = () => false;
    f.report({t:'sarmyrep', id:grant.a.id, season:grant.a.season, fieldLease:grant.a.fieldLease,
      rep:{n:grant.a.n - 1, fold:1}});
    assert.equal(f.field.held.size, 0);
    assert.equal(f.army().n, grant.a.n - 1);
    assert.equal(f.army().onField, null);
  }
});
