import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../src/08r_public_works.js',import.meta.url),'utf8');
const season=readFileSync(new URL('../../src/08n_season.js',import.meta.url),'utf8');
const siege=readFileSync(new URL('../../src/04h_siege.js',import.meta.url),'utf8');
const actualFunction=(text,name)=>{const at=text.indexOf('function '+name+'(');assert.ok(at>=0,name+' exists');const end=text.indexOf('\n}',at);assert.ok(end>at);return text.slice(at,end+2);};
function fixture(){
  const entities=new Map(), publicBodies=new Map(), reports=[], removed=[];
  let next=1,keeper=true,visible=true,adapter,reportMode='ok';
  const keeps=Array.from({length:6},(_,id)=>{
    const K={id,realm:id%3,orig:id%3,guards:new Set(),lord:next++,door:{alive:true,hp:100,maxHp:100,lastHitAt:-99,deadAt:0},nextGuardAt:0,lastEnemyNear:-99,site:{x:id*30,z:0,y:0,yaw:0,gateLocal:{z:8}}};
    entities.set(K.lord,{id:K.lord,alive:true,faction:K.realm,role:'lord'});
    for(let j=0;j<6;j++){const id=next++;K.guards.add(id);entities.set(id,{id,alive:true,faction:K.realm,role:'guard'});}
    K.site.keepRef=K;K.door.keepRef=K;return K;
  });
  const packet={n:1,t:10,phase:'war',management:{logistics:{scope:{origin:'https://world.example',epoch:1},repairs:[],houseRepairs:[]}},armyIds:[9],armyIdsComplete:true,
    works:Array.from({length:3},(_,r)=>({r,walls:0,granary:0,yard:0,smithy:0,engines:0,hungry:0})),
    keeps:keeps.map(K=>({i:K.id,r:K.realm,g:8,gate:1,tier:0}))};
  const castle={S:keeps[1].site,sections:[{k:0,state:'whole'}]};
  const ctx={
    NETS:{s:packet},NETWS:{url:'native'},NET_ENTITIES:{authority:'keeper-a',received:1,published:true},NETPARTS:{key:''},NET:{applyingWorld:false},
    GAME:{started:true,t:100,player:{role:'player',faction:0,x:5,y:6,z:7}},CAMPAIGN:{n:1},WAR:{keeps,temples:[],warbands:[]},
    WB:{hood:1,helmet:2,pauldron:4},SIEGE:{engines:[],force:'ram',stats:{}},SIEGE_MAX:()=>8,SIEGE2:{stats:{}},
    netCurrentWorldAdmission:()=>({origin:'https://world.example',epoch:ctx.epoch||1}),
    netEntityCanSimulateWorld:()=>keeper,netWorldPartsCanSimulate:()=>keeper,
    getEnt:id=>entities.get(id),netEntityFind:id=>publicBodies.get(id),netEntityVisible:()=>visible,
    registerSavePart:(kind,id,value)=>{adapter={kind,id,...value};},
    setDoorState:(D,alive,f)=>{D.alive=alive;D.hp=alive?D.maxHp*f:0;},
    war4Trickle:K=>{assert.equal(api.recruiting(K),true);const id=next++;entities.set(id,{id,alive:true,faction:K.realm,role:'guard'});K.guards.add(id);},
    captureKeep:(K,r)=>{K.realm=r;},
    netRealmBattleReport:body=>{reports.push({...body});return Promise.resolve(reportMode==='fail'?{ok:false,why:'retry'}:{ok:true,...body,t:packet.t});},
    castleOf:()=>castle,siegeCountOf:()=>ctx.SIEGE.engines.filter(E=>!E.gone).length,
    siegeCreate:(kind,realm,x,z,yaw,target,work)=>{
      const temporary={id:next++,alive:true,role:'engine',faction:realm,hp:100,maxHp:100};
      entities.set(temporary.id,temporary);
      const E={id:ctx.SIEGE.engines.length+1,kind,realm,x,y:0,z,yaw,target,work,ent:temporary,crew:[],build:0,state:'build',burn:0};
      ctx.SIEGE.engines.push(E);return E;
    },
    removeEnt:e=>{removed.push(e);e.removed=true;entities.delete(e.id);if(publicBodies.get(e.netEntityId)===e)publicBodies.delete(e.netEntityId);},
    siegeAddCrew:(E,e)=>{E.crew.push(e.id);e.siegeCrew=E.id;},siegeBandOn:()=>true,siegeSettle:E=>{E.settled=true;},siegePose:()=>{},
    HOUSES:[{num:4,realm:0,x:11,z:12,state:'scaffold',keepHall:false},{num:16,realm:0,keepHall:true}],
  };
  const names=Object.keys(ctx), values=Object.values(ctx);
  const api=Function(...names,source+'\nreturn {apply:realmPublicWorksApply,tick:realmPublicWorksKeepTick,repair:realmPublicWorksRepairWork,house:realmPublicWorksHouseWork,meta:realmPublicWorksMeta,save:realmPublicWorksSave,load:realmPublicWorksLoad,attack:realmPublicWorksAttackK,armor:realmPublicWorksArmorK,hunger:realmPublicWorksHungerK,gate:realmPublicWorksGateK,army:realmPublicWorksArmy,engineKind:realmPublicWorksEngineKind,engineBuilt:realmPublicWorksEngineBuilt,restore:realmPublicWorksRestoreEngines,afterReset:realmPublicWorksAfterReset,readEngines:realmPublicWorksReadEngines,frame:realmPublicWorksFrame,state:REALM_PUBLIC_WORKS,recruiting:realmPublicWorksRecruiting,report:realmPublicWorksBattleReport,record:realmPublicWorksRecord};')(...values);
  assert.equal(api.apply(packet),true);
  return {api,ctx,packet,keeps,entities,publicBodies,reports,removed,setKeeper:v=>{keeper=v;},setVisible:v=>{visible=v;},setReportMode:v=>{reportMode=v;},adapter:()=>adapter,
    change(fn){fn(packet);packet.t++;assert.equal(api.apply(packet),true);},evaluate(text,extra={}){return Function(...names,...Object.keys(extra),text)(...values,...Object.values(extra));}};
}

test('summary replay cannot heal damage or grant historical wall renovation',()=>{
  const f=fixture(),K=f.keeps[0];K.door.hp=35;f.packet.keeps[0].tier=3;f.api.apply(f.packet);
  f.api.tick(K,.1);f.api.apply(f.packet);f.api.tick(K,.1);
  assert.equal(K.door.hp,35);assert.equal(f.api.repair(K,'wall',1,1),0);
});
test('smithy strength changes actual military multipliers, excludes players and is idempotent',()=>{
  const f=fixture(),guard=f.entities.get([...f.keeps[0].guards][0]);
  f.change(p=>{p.works[0].smithy=2;});
  assert.ok(Math.abs(f.api.attack(guard)**2-1.24)<1e-9);assert.ok(Math.abs(f.api.armor(guard)*f.api.attack(guard)-1)<1e-9);
  assert.equal(f.api.attack({...guard,role:'player'}),1);assert.equal(f.api.armor({...guard,netEntityOwner:'someone'}),1);
  const hp=guard.hp;f.api.apply(f.packet);assert.equal(guard.hp,hp);
});
test('canonical hunger reaches guards without double counting a field cohort',()=>{
  const f=fixture(),guard=f.entities.get([...f.keeps[0].guards][0]);f.change(p=>{p.works[0].hungry=4;});
  assert.equal(f.api.hunger(guard),.88);guard.warband={season:{hungry:false}};guard.lHungry=1e6;
  assert.equal(f.api.hunger(guard),1);guard.warband.season.hungry=true;assert.equal(f.api.hunger(guard),.88);
});
test('old clocks, seasons, capture owners and world epochs are fenced',()=>{
  const f=fixture(),K=f.keeps[0];f.change(p=>{p.keeps[0].tier=3;});
  assert.ok(f.api.gate(K.door)<1);assert.equal(f.api.apply({...f.packet,t:0}),false);
  K.realm=1;assert.equal(f.api.gate(K.door),1);K.realm=0;f.ctx.epoch=2;assert.equal(f.api.gate(K.door),1);
});
test('finite wall work survives save/load without replaying an invoice',()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,.1);f.change(p=>{p.management.logistics.repairs=[{keep:0,owner:0,kind:'wall',totalUnits:1}];});
  assert.equal(f.api.repair(K,'breach',.4,1),1);f.api.load(JSON.parse(JSON.stringify(f.api.save())));
  assert.ok(Math.abs(f.api.repair(K,'wall',.7,1)-.6/.7)<1e-9);
  f.api.apply(f.packet);assert.equal(f.api.repair(K,'wall',1,1),0);assert.ok(Math.abs(f.api.save().spent[0].units-1)<1e-9);
});
test('paid gate progress is not repeatedly capped to an unchanged old snapshot',()=>{
  const f=fixture(),K=f.keeps[0];f.change(p=>{p.keeps[0].gate=.5;p.management.logistics.repairs=[{keep:0,owner:0,kind:'gate',totalUnits:1}];});
  f.api.tick(K,.1);const hp=K.door.hp;f.api.apply(f.packet);f.api.tick(K,.1);assert.ok(K.door.hp>hp);
});
test('native houses consume separate paid reconstruction units and exclude keep halls from proof',()=>{
  const f=fixture();f.api.tick(f.keeps[0],.1);f.change(p=>{p.management.logistics.houseRepairs=[{house:4,owner:0,totalUnits:1}];});
  assert.equal(f.api.house(f.ctx.HOUSES[0],.25,1),1);const saved=f.api.save();assert.equal(saved.houseSpent[0].units,.25);
  assert.deepEqual(JSON.parse(JSON.stringify(f.api.meta())).houses.map(h=>h.id),[4]);
  f.api.load(JSON.parse(JSON.stringify(saved)));assert.equal(f.api.house(f.ctx.HOUSES[0],1,1),.75);
});
test('deaths do not spawn replacement guards until canonical paid strength grows',()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,.1);f.entities.get([...K.guards][0]).alive=false;f.api.tick(K,.1);
  assert.equal(f.api.save().keeps[0].birth,0);assert.ok(f.api.save().keeps[0].loss>0);
  const alive=()=>[...K.guards].map(id=>f.entities.get(id)).filter(e=>e.alive).length;
  assert.equal(alive(),5);f.change(p=>{p.keeps[0].g=10;});f.api.tick(K,.1);assert.equal(alive(),6);
  f.api.tick(K,.1);assert.equal(alive(),6);
});
test('replicas cannot repair, recruit or mutate the repair ledger',()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,.1);const saved=JSON.stringify(f.api.save());f.setKeeper(false);K.door.hp=10;
  assert.equal(f.api.tick(K,1),true);assert.equal(K.door.hp,10);assert.equal(f.api.repair(K,'wall',1,1),0);assert.equal(JSON.stringify(f.api.save()),saved);
});
test('engine entitlement is spent once across lease changes and short campaigns',()=>{
  const f=fixture();f.api.tick(f.keeps[0],.1);const wb={id:10,realm:0,season:{id:9}},desc={id:9,arm:1.24,eng:1,hungry:false};
  f.ctx.WAR.warbands.push(wb);f.api.army(wb,desc);assert.equal(f.api.engineBuilt(wb,{kind:'ram',realm:0}),true);
  f.api.army(wb,{...desc,fieldLease:'another'});assert.equal(f.api.engineKind(wb,'ram'),false);
  f.ctx.CAMPAIGN.n++;f.api.army(wb,desc);assert.equal(f.api.engineKind(wb,'ram'),false);
  assert.equal(f.api.save().armies[0].spent,1);
});
test('only a complete canonical army list retires old engine entitlement records',()=>{
  const f=fixture();f.api.tick(f.keeps[0],.1);const wb={id:10,realm:0,season:{id:9}};f.api.army(wb,{id:9,arm:1,eng:1});
  f.ctx.WAR.warbands=[];f.change(p=>{p.armyIds=[];p.armyIdsComplete=false;});f.api.record(f.keeps[0]);assert.equal(f.api.save().armies.length,1);
  f.change(p=>{p.armyIdsComplete=true;});f.api.record(f.keeps[0]);assert.equal(f.api.save().armies.length,0);
});
test('native paid engine recovery reuses damaged accepted bodies and never revives missing/dead ones',()=>{
  const f=fixture();f.api.tick(f.keeps[0],.1);
  const row={id:'scene:test:999',kind:'ram',realm:0,army:'9',wb:10,keep:1,temple:null,wall:null,gate:true,x:12,z:24,yaw:0,build:1,state:'work',burn:0,workX:12,workZ:24,crew:[]};
  const actor={id:999,netEntityId:row.id,alive:true,role:'engine',faction:0,x:12,y:3,z:24,hp:17,maxHp:100};
  f.entities.set(actor.id,actor);f.publicBodies.set(row.id,actor);f.api.state.engineRows=f.api.readEngines([row]);
  const pose=JSON.stringify(f.ctx.GAME.player);f.api.restore();assert.equal(f.ctx.SIEGE.engines.length,1);
  const E=f.ctx.SIEGE.engines[0];assert.equal(E.ent,actor);assert.equal(actor.hp,17);assert.equal(actor.maxHp,100);
  f.api.restore();assert.equal(f.ctx.SIEGE.engines.length,1);assert.equal(JSON.stringify(f.ctx.GAME.player),pose);
  const newer={...actor,id:1000,hp:11};f.entities.set(newer.id,newer);f.publicBodies.set(row.id,newer);f.api.restore();
  assert.equal(E.ent,newer);assert.equal(newer.hp,11);newer.alive=false;newer.hp=0;f.ctx.SIEGE.engines=[];f.api.restore();assert.equal(f.ctx.SIEGE.engines.length,0);assert.equal(newer.hp,0);
});
test('reports use monotonic sequences across short campaigns',async()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,.1);const p=f.api.record(K);p.loss=1;
  f.api.report(K,p,f.api.state.source.keeps[0]);await Promise.resolve();assert.equal(f.reports.length,1);assert.equal(p.loss,0);
  f.ctx.CAMPAIGN.n++;f.api.record(K);const next=f.api.record(K);next.loss=1;f.api.report(K,next,f.api.state.source.keeps[0]);await Promise.resolve();
  assert.ok(f.reports[1].seq>f.reports[0].seq);
});
test('actual season hooks preserve hosted ownership and use physical wall tiers',()=>{
  const functions=['seasonGateK','seasonKeepStays','seasonAfterReset','seasonKeepsHeld'].map(n=>actualFunction(season,n)).join('\n');
  const K={id:0,realm:1,orig:0},stats={reset:0};
  const api=Function('SEASONP','realmPublicWorksHosted','realmPublicWorksGateK','realmPublicWorksKeepStays','realmPublicWorksKeepsHeld','realmPublicWorksAfterReset','seasonApplyKeeps',
    functions+'\nreturn {gate:seasonGateK,stays:seasonKeepStays,held:seasonKeepsHeld,reset:seasonAfterReset};')
    ({rs:null},()=>true,()=>.5,()=>true,()=>true,()=>stats.reset++,()=>{throw Error('solo reset used');});
  assert.equal(api.gate({keepRef:K}),.5);assert.equal(api.stays(K),true);assert.equal(api.held(),true);api.reset();assert.equal(stats.reset,1);
});
test('actual forced engine planning cannot bypass a zero canonical engine budget',()=>{
  const body=actualFunction(siege,'siegePlanFor');let creates=0,legacyCosts=0;
  const C={S:{}},D={alive:true},env={SIEGE:{force:'ram',engines:[]},SIEGE_MAX:()=>8,wbMembers:()=>Array.from({length:6},()=>({})),wbLeader:()=>({x:0,z:0}),castleOf:()=>C,
    siegeCountOf:()=>0,siegeDoorOf:()=>D,realmPublicWorksHosted:()=>true,realmPublicWorksEngineKind:()=>false,
    loopsEngineKind:()=>{legacyCosts++;return'ram';},siegeGatePoint:()=>({x:0,z:0,nx:0,nz:1}),RAM_REACH:5,isWalkable:()=>true,segmentClear:()=>true,
    siegeCreate:()=>{creates++;return{};},siegeCrewUp:()=>1};
  const plan=Function(...Object.keys(env),body+'\nreturn siegePlanFor;')(...Object.values(env));
  assert.equal(plan({realm:0},{keep:{site:{}}}),null);assert.equal(creates,0);assert.equal(legacyCosts,0);
});
test('actual crew assignment discards an engine that cannot commit its prepaid entitlement',()=>{
  const body=actualFunction(siege,'siegeCrewUp');let removed=0;
  const run=Function('realmPublicWorksEngineBuilt','siegeRemove',body+'\nreturn siegeCrewUp;')(()=>false,()=>removed++);
  assert.equal(run({}, {realm:0},[],null),null);assert.equal(removed,1);
});

test('a failed battle report retries the exact proposal without charging new casualties twice',async()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,.1);const p=f.api.record(K);p.loss=1;f.setReportMode('fail');
  f.api.report(K,p,f.api.state.source.keeps[0]);await Promise.resolve();p.loss+=.5;f.ctx.GAME.t+=6;f.setReportMode('ok');
  f.api.report(K,p,f.api.state.source.keeps[0]);await Promise.resolve();
  assert.deepEqual(f.reports[1],f.reports[0]);assert.equal(p.loss,.5);assert.equal(f.api.state.pending.size,0);
});

test('replica engine meshes obey the same admission visibility as shared actors',()=>{
  const f=fixture();f.api.tick(f.keeps[0],.1);f.setKeeper(false);f.setVisible(false);
  const actor={id:999,netEntityId:'scene:test:999',alive:true,role:'engine',faction:0,x:12,y:3,z:24,hp:17,maxHp:100};
  f.publicBodies.set(actor.netEntityId,actor);f.api.state.engineRows=[{id:actor.netEntityId,kind:'ram',realm:0,wb:10}];
  f.api.frame();assert.equal(f.api.state.engineViews.size,0);assert.equal(actor.hp,17);
});

test('paid grants from a different native epoch cannot be replayed after a world reset',()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,.1);
  f.change(p=>{p.management.logistics.repairs=[{keep:0,owner:0,kind:'wall',totalUnits:1}];});
  f.ctx.epoch=2;f.packet.t++;assert.equal(f.api.apply(f.packet),true);
  assert.equal(f.api.repair(K,'wall',1,1),0);
  f.change(p=>{p.management.logistics.scope={origin:'https://world.example',epoch:2};});
  assert.equal(f.api.repair(K,'wall',1,1),1);
});

test('a short campaign preserves same-native paid work, credits, reports and engine highwaters',async()=>{
  const f=fixture(),K=f.keeps[0];f.change(p=>{p.keeps[0].gate=.5;});f.api.tick(K,0);
  f.entities.get([...K.guards][0]).alive=false;f.api.tick(K,0);
  f.change(p=>{p.keeps[0].g=9;p.keeps[0].gate=.6;p.keeps[0].tier=1;
    p.management.logistics.repairs=[{keep:0,owner:0,kind:'wall',totalUnits:1}];
    p.management.logistics.houseRepairs=[{house:4,owner:0,totalUnits:1}];});
  const record=f.api.record(K);assert.ok(record.birth>0);assert.ok(record.gateWork>0);assert.equal(record.tierWork,1);
  assert.equal(f.api.repair(K,'wall',.4,1),1);assert.equal(f.api.house(f.ctx.HOUSES[0],.25,1),1);
  const wb={id:10,realm:0,season:{id:9}},desc={id:9,arm:1,eng:1};f.ctx.WAR.warbands.push(wb);
  f.api.army(wb,desc);assert.equal(f.api.engineBuilt(wb,{kind:'ram',realm:0}),true);
  f.setReportMode('fail');f.api.report(K,record,f.api.state.source.keeps[0]);await Promise.resolve();
  const proposal=JSON.stringify(f.api.state.pending.get(0).body),before=f.api.save();
  f.ctx.CAMPAIGN.n++;f.api.record(K);f.api.army(wb,desc);const after=f.api.save();
  assert.deepEqual(after.scope,before.scope);assert.deepEqual(after.spent,before.spent);assert.deepEqual(after.houseSpent,before.houseSpent);
  assert.deepEqual(after.seqs,before.seqs);assert.deepEqual(after.armies,before.armies);
  assert.equal(after.keeps[0].birth,before.keeps[0].birth);assert.equal(after.keeps[0].gateWork,before.keeps[0].gateWork);
  assert.equal(after.keeps[0].tierWork,before.keeps[0].tierWork);assert.equal(after.keeps[0].g,before.keeps[0].g);
  assert.equal(JSON.stringify(f.api.state.pending.get(0).body),proposal);assert.equal(f.api.engineKind(wb,'ram'),false);
  assert.ok(Math.abs(f.api.repair(K,'wall',3,1)-1.6/3)<1e-9);assert.equal(f.api.repair(K,'wall',1,1),0);
  assert.equal(f.api.house(f.ctx.HOUSES[0],1,1),.75);
});
test('old short-campaign engine blueprints cannot recreate removed campaign bodies',()=>{
  const f=fixture();f.api.tick(f.keeps[0],0);
  const actor={id:999,netEntityId:'scene:test:999',alive:true,role:'engine',faction:0,x:12,y:3,z:24,hp:17,maxHp:100};
  f.publicBodies.set(actor.netEntityId,actor);
  f.api.state.engineRows=f.api.readEngines([{id:actor.netEntityId,kind:'ram',realm:0,army:'9',keep:1,x:12,z:24,yaw:0,build:1,state:'work',workX:12,workZ:24,crew:[]}]);
  f.ctx.CAMPAIGN.n++;f.api.restore();assert.equal(f.ctx.SIEGE.engines.length,0);
  f.api.record(f.keeps[0]);f.api.restore();assert.equal(f.ctx.SIEGE.engines.length,0);assert.equal(f.api.state.engineRows.length,0);assert.equal(actor.hp,17);
});
test('short reset reconciliation never rewinds a live conquest to an older cached holder',()=>{
  const f=fixture(),K=f.keeps[0];f.api.tick(K,0);K.realm=1;K.door.hp=15;f.ctx.CAMPAIGN.n++;
  f.api.afterReset();assert.equal(K.realm,1);assert.equal(K.door.hp,15);
});
