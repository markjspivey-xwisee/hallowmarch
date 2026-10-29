import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

const read=name=>readFileSync(new URL('../../src/'+name,import.meta.url),'utf8');
function pick(file,names){const source=read(file);return parse(source,{ecmaVersion:'latest'}).body
  .filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name)||node.type==='VariableDeclaration'&&node.declarations.some(d=>names.includes(d.id.name)))
  .map(node=>source.slice(node.start,node.end)).join('\n');}
const source=['14n_net.js','14p_netws.js','14z_networldparts.js'].map(read).join('\n')+'\n'
  +pick('12_save.js',['SAVE','withTimeout','validSave','saveLoadOwned','saveLoadTitle','loadSave','applyWorldSave'])+'\n'
  +pick('08g_campaign.js',['applyCampaignSave']);
const admission={origin:'https://game.test',epoch:4};
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function flush(){for(let n=0;n<20;n++)await Promise.resolve();}
function harness(){
  let now=1000,next=0;const timers=new Map(),out=[],state={land:null,custom:null},calls={settings:[],titles:[],results:0,learning:0,rewards:0};
  const context=vm.createContext({console,URL,URLSearchParams,Map,Set,Object,Array,JSON,Math,Date,AbortSignal,
    performance:{now:()=>now},GAME:{built:false,ready:false,started:false,player:null,t:10},
    NET_HUMAN_PLAY:{activity:1},netHumanLive:()=>false,netHumanSuspend(){},netHumanSync(){},netWxTake(){},netWxResume(){},
    netWorldCapture(){},netStr:s=>String(s||''),reportError(error){throw error;},uiError(){},uiLog(){},uiToast(){},
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),location:{search:'?server='+encodeURIComponent('wss://game.test/ws')},
    window:{addEventListener(){}},document:{addEventListener(){}},queueMicrotask(){},
    localStorage:{getItem:()=>null,setItem(){assert.fail('No private fallback/write during hydration');}},
    setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:()=>0,clearInterval(){},WebSocket:class{},CLASSES:{warrior:{}},LEVEL_CAP:50,
    NATIVE_PLAYER:{profile:{},status:{verified:true}},WAR:{keeps:[],relics:[]},HOUSES:[],
    CAMPAIGN:{n:1,claims:[{},{},{}],renown:[0,0,0],history:[]},CW:{CALL:3600,KEEP_HOLD:300,HALLOW_HOLD:300},
    updateRelicBonuses(){},landApply:value=>{state.land=copy(value);},savePartsLoad:(kind,value)=>{state.custom=copy(value?.privateDomain);},
    applySettings:value=>calls.settings.push(copy(value)),setupTitle:value=>calls.titles.push(value),
    coreKey:JSON.stringify,activityRecord(){calls.learning++;},goodsAdd(){calls.rewards++;},addGold(){calls.rewards++;},
  });
  vm.runInContext(source+'\nglobalThis.H={NET,NETWS,SAVE,NETPARTS,message:netSharedSceneMessage,release:netSharedSceneFlushBuilt,reset:netSharedSceneReset,register:netWorldPartsRegister,protect:netWorldPartsProtectPrivateRestore,world:applyWorldSave,load:loadSave,title:saveLoadTitle,core:netWorldPartsCoreApply};',context);
  const H=context.H;Object.assign(H.NETWS,{ws:{readyState:1,send:text=>out.push(JSON.parse(text))},state:'on',url:'wss://game.test/ws',host:'game.test',
    acct:{id:'owner'},generation:1,token:'same-proof',worldAdmission:{...admission},worldAdmissionRequired:true});H.NET.self='follower';
  H.register('land',{save:()=>state.land,apply:value=>{state.land=copy(value);}});H.register('core',{save:()=>null,apply:H.core});
  const authority=(extra={})=>({t:'activity',kind:'authority',authority:'auth',peer:'host',worldAdmission:{...admission},worldpartsReady:true,...extra});
  const image=(parts,seq=1,extra={})=>({t:'activity',kind:'worldparts',op:'snapshot',authority:'auth',worldAdmission:{...admission},seq,part:0,total:1,
    data:JSON.stringify({v:1,full:false,parts,remove:[],...extra})});
  const save=(world={})=>({v:1,char:{name:'Owned late character',realm:0,cls:'warrior',level:1,xp:37},settings:{quality:'low'},
    world:{keeps:[],sharedWorld:{...admission},land:{v:1,marker:'private-land'},x:{privateDomain:'private-progress'},...world}});
  const hydrate=value=>{H.SAVE.loaded=value;const load={settled:true,owner:'owner',host:'game.test'};H.SAVE.loading=load;context.GAME.ready=true;H.title(load);};
  return{H,context,state,calls,out,timers,authority,image,save,hydrate,async advance(ms){now+=ms;for(const[id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await flush();}};
}

test('actual timed-out private read hydrates its character/settings/private domains after queued canonical replay without rewinding canonical land',async()=>{
  const f=harness(),read=deferred(),saved=f.save(),ref={native:true,get:()=>read.promise};
  f.context.initSaveBackend=async initialization=>{f.H.SAVE.native=true;initialization.owner='owner';initialization.host='game.test';return ref;};
  const loading=f.H.load();await flush();f.H.message(f.authority());f.H.message(f.image({land:'canonical-land'}));
  f.context.GAME.built=true;await f.advance(45000);assert.equal(await loading,null);assert.equal(f.H.SAVE.loading.settled,false);
  assert.equal(f.H.release(),true);assert.equal(f.state.land,'canonical-land');
  f.context.GAME.ready=true;read.resolve({exists:true,data:()=>saved});await flush();
  assert.equal(f.H.SAVE.readConfirmed,true);assert.equal(f.H.SAVE.loaded.char.xp,37);assert.equal(f.H.SAVE.ref,ref);
  assert.equal(f.state.land,'canonical-land');assert.equal(f.state.custom,'private-progress');
  assert.deepEqual(f.calls.settings,[{quality:'low'}]);assert.equal(f.calls.titles.length,1);assert.equal(f.calls.titles[0],f.H.SAVE.loaded);
  assert.equal(f.H.NETPARTS.received,1);assert.equal(f.H.NETPARTS.readSeq,1);assert.equal(f.out.length,0);
  f.H.message(f.image({land:'canonical-land'},2));assert.equal(f.state.land,'canonical-land');assert.equal(f.H.NETPARTS.received,2);
});

test('private-first hydration and no-image keeper preserve their normal private world until a future canonical snapshot arrives',()=>{
  for(const freshKeeper of[false,true]){
    const f=harness();f.H.message(f.authority(freshKeeper?{peer:'follower',worldpartsReady:false}:{}));
    f.context.GAME.built=true;f.H.release();assert.equal(f.H.NETPARTS.appliedImageScope,null);
    f.hydrate(f.save());assert.deepEqual(f.state.land,{v:1,marker:'private-land'});assert.equal(f.state.custom,'private-progress');
    if(!freshKeeper){f.H.message(f.image({land:'future-canonical'}));assert.equal(f.state.land,'future-canonical');}
  }
});

test('canonical partial images restore only captured domains, preserving uncaptured private data and personal campaign history',()=>{
  const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());
  const campaign={n:9,el:10,state:'war',peace:0,claims:[{},{},{}],renown:[1,2,3],history:[{n:8,w:0,how:'keeps'}]};
  f.H.message(f.image({core:{campaign}}));
  f.hydrate(f.save({campaign:{n:1,hist:[{n:8,w:0,how:'keeps',you:{r:0,kills:7},reward:{gold:13,xp:37}}]}}));
  assert.deepEqual(f.state.land,{v:1,marker:'private-land'});assert.equal(f.state.custom,'private-progress');assert.equal(f.context.CAMPAIGN.n,9);
  assert.equal(f.context.CAMPAIGN.history[0].you.kills,7);assert.equal(f.context.CAMPAIGN.history[0].reward.gold,13);
  assert.equal(f.calls.rewards,0);assert.equal(f.calls.learning,0);
});

test('restoring a captured image never replays receipt/results, publishes, or changes canonical sequence/receive facts',()=>{
  const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());
  const receipts=[{id:'already-confirmed',ownerAccount:'owner',ok:true,goods:[['stone',2]]}];
  f.H.message(f.image({land:'canonical'},5,{receipts}));const before=f.H.NETPARTS.receipts;
  f.context.calls=f.calls;vm.runInContext('netWorldPartsResult=()=>calls.results++;netWorldPartsConfirmSettled=()=>calls.results++;',f.context);
  for(let n=0;n<3;n++)f.hydrate(f.save());
  assert.equal(f.state.land,'canonical');assert.equal(f.H.NETPARTS.received,1);assert.equal(f.H.NETPARTS.readSeq,5);
  assert.equal(f.H.NETPARTS.receipts,before);assert.equal(f.calls.results,0);assert.equal(f.calls.rewards,0);assert.equal(f.calls.learning,0);assert.equal(f.out.length,0);
});

test('reset, authority, transport, owner and admission changes cannot replay a captured old canonical image',()=>{
  for(const change of[f=>f.H.reset(),f=>{f.H.NETPARTS.authority='new';},f=>{f.H.NETWS.generation++;},
    f=>{f.H.NETWS.ws={readyState:1};},f=>{f.H.NETWS.acct={id:'other'};},f=>{f.H.NETWS.host='other.test';},
    f=>{f.H.NETWS.worldAdmission={...admission,epoch:5};},f=>{f.H.NETWS.state='off';}]){
    const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());f.H.message(f.image({land:'canonical'}));
    const restore=f.H.protect();assert.equal(typeof restore,'function');change(f);f.state.land='private';assert.equal(restore(),false);assert.equal(f.state.land,'private');
    assert.equal(restore(),false,'restore capability is single use even when stale');
  }
});

test('new authority without an applied image and duplicate/stale/invalid frames cannot fabricate a replay capability',()=>{
  const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());
  f.H.message({...f.image({land:'bad'}),data:'{'});assert.equal(f.H.protect(),null);
  f.H.message(f.image({land:'canonical'},3));
  f.H.message(f.image({land:'stale'},2));f.H.message({...f.image({land:'wrong-scope'},4),authority:'other'});
  f.hydrate(f.save());assert.equal(f.state.land,'canonical');
  f.H.message(f.authority({authority:'new',peer:'follower',worldpartsReady:false}));
  assert.equal(f.H.NETPARTS.ready,true);assert.equal(f.H.protect(),null);
  f.hydrate(f.save());assert.deepEqual(f.state.land,{v:1,marker:'private-land'});
});

test('a later canonical image invalidates an older restore capability even within the same owner connection',()=>{
  const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());f.H.message(f.image({land:'first'},1));
  const restore=f.H.protect();f.H.message(f.image({land:'newer'},2));
  assert.equal(restore(),false);assert.equal(f.state.land,'newer');assert.equal(f.H.NETPARTS.readSeq,2);
});

test('a partial frame in a new authority cannot bless untouched keys retained from the previous authority',()=>{
  const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());f.H.message(f.image({land:'old-authority'}));
  f.H.message(f.authority({authority:'new'}));
  f.H.message({...f.image({core:{}},1),authority:'new'});
  f.hydrate(f.save());assert.deepEqual(f.state.land,{v:1,marker:'private-land'});
});

test('late title hydration retains its existing owner/host/started fences',()=>{
  for(const change of[f=>{f.H.NETWS.acct={id:'other'};},f=>{f.H.NETWS.host='other.test';},f=>{f.context.GAME.started=true;}]){
    const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());f.H.message(f.image({land:'canonical'}));
    const load={settled:true,owner:'owner',host:'game.test'};f.H.SAVE.loading=load;f.H.SAVE.loaded=f.save();f.context.GAME.ready=true;
    change(f);f.H.title(load);assert.equal(f.state.land,'canonical');assert.equal(f.calls.settings.length,0);assert.equal(f.calls.titles.length,0);
  }
});

test('a private adapter failure still restores the captured canonical domains before propagating',()=>{
  const f=harness();f.context.GAME.built=true;f.H.release();f.H.message(f.authority());f.H.message(f.image({land:'canonical'}));
  f.context.savePartsLoad=()=>{throw Error('private fixture failed');};
  assert.throws(()=>f.H.world(f.save().world),/private fixture failed/);assert.equal(f.state.land,'canonical');
  assert.equal(f.H.NETPARTS.received,1);assert.equal(f.out.length,0);
});

test('the actual additive private-land loader and canonical reconciliation remain idempotent, including a canonical empty image',()=>{
  for(const canonical of[{v:1,cr:[[0,0,10,2,2,1,1,0,-200]]},null]){
    const f=harness(),HN=8,heights=new Float32Array(HN*HN).fill(10);
    Object.assign(f.context,{HN,W:{H:heights,trees:[]},Float32Array,LAND_CAP:{craters:40},LAND:{},LAND_HOUSE:{},CASTLES:[],FIRES:[],
      NATURE:{built:true,speed:1,craters:[],dyn:[],felled:[],growing:[],tileKeys:[],tiles:new Map(),fire:new Map(),fireList:[],piles:[]},
      natTerrainUpdate(){},natTreesNear(){},forNear(){},landMap(){},landTrees(){},landPiles(){},landTree(){},landHouses(){},landWalls(){}});
    vm.runInContext(pick('12b_worldstate.js',['landApply','landCraters','landSharedApply','landInt','landNum']),f.context);
    f.H.register('land',{save:()=>null,apply:f.context.landSharedApply});
    f.context.GAME.built=true;f.H.release();f.H.message(f.authority());f.H.message(f.image({land:canonical}));
    const expected=canonical?8:10;assert.equal(heights[2*HN+2],expected);
    for(let n=0;n<3;n++){
      f.hydrate(f.save({land:{v:1,cr:[[0,0,10,2,2,1,1,0,-500]]}}));
      assert.equal(heights[2*HN+2],expected);assert.equal(f.context.NATURE.craters.length,canonical?1:0);
    }
    assert.equal(f.H.NETPARTS.received,1);assert.equal(f.calls.learning,0);assert.equal(f.calls.rewards,0);assert.equal(f.out.length,0);
  }
});
