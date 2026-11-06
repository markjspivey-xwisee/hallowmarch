/* Canonical paid logistics projected into the existing world simulation.
 * No timer renews human play; requests run only from live input or keeper steps. */
const REALM_LOGISTICS = { requests:new Map(), cooldown:new Map(), scope:'', view:null, migrated:false, clock:0,
  carClock:[0,0,0], donations:new Map(), lastOwnerView:null };
function realmLogisticsView() {
  try { const v=typeof netRealmLogisticsView==='function'?netRealmLogisticsView():NETS.s?.logistics;
    return v?.v===1 && Number.isSafeInteger(v.season) && Array.isArray(v.jobs) ? v : null;
  } catch(err) { return null; }
}
function realmLogisticsGrantView() {
  const view=realmLogisticsView();
  try {
    const admission=netCurrentWorldAdmission(),scope=view?.scope;
    return scope && typeof scope.origin==='string' && scope.origin.length>0
      && Number.isSafeInteger(scope.epoch) && scope.epoch>=0
      && scope.origin===admission?.origin && scope.epoch===admission?.epoch ? view : null;
  } catch(err) { return null; }
}
function realmLogisticsRequestView() {
  const view=realmLogisticsView();
  try {
    const admission=netCurrentWorldAdmission();
    // The first accepted mutation creates the ledger's scope. Its absence (or
    // a retired scope) cannot prevent the current keeper from requesting it.
    return view && view.season===NETS.s?.n && typeof admission?.origin==='string' && admission.origin.length>0
      && Number.isSafeInteger(admission.epoch) && admission.epoch>=1
      && typeof NET_ENTITIES.authority==='string' && NET_ENTITIES.authority.length>0 ? view : null;
  } catch(err) { return null; }
}
function realmLogisticsKeeper() {
  return loopsCanonicalManaged() && (typeof netHumanLive!=='function'||netHumanLive())
    && typeof netEntityCanSimulateWorld==='function' && netEntityCanSimulateWorld()
    && (typeof netWorldPartsCanSimulate!=='function'||netWorldPartsCanSimulate());
}
function realmLogisticsScope() {
  try { const a=netCurrentWorldAdmission(),v=realmLogisticsView();
    return JSON.stringify([NET.self,NET_ENTITIES.authority,a?.origin,a?.epoch,v?.season]); } catch(err) { return ''; }
}
function realmLogisticsNow() { return typeof GAME==='undefined'?0:GAME.t; }
function realmLogisticsRequest(key,args,priority=2,done=null) {
  const state=REALM_LOGISTICS,now=realmLogisticsNow();
  if(!realmLogisticsKeeper()||!realmLogisticsRequestView()||typeof netRealmLogisticsCommand!=='function')return false;
  const scope=realmLogisticsScope();
  if(state.scope!==scope){state.requests.clear();state.cooldown.clear();state.scope=scope;}
  if(state.requests.has(key))return true;
  if(state.requests.size>=16||(state.cooldown.get(key)||0)>now)return false;
  state.requests.set(key,{key,args:JSON.parse(JSON.stringify(args)),nonce:crypto.randomUUID(),scope:realmLogisticsScope(),priority,done,pending:false,retryAt:0});
  return true;
}
function realmLogisticsPump() {
  const state=REALM_LOGISTICS,now=realmLogisticsNow();
  if(!realmLogisticsKeeper()||!realmLogisticsRequestView())return;
  const current=realmLogisticsScope();
  if(state.scope!==current){state.requests.clear();state.cooldown.clear();state.scope=current;}
  let active=[...state.requests.values()].filter(r=>r.pending).length;
  for(const request of [...state.requests.values()].sort((a,b)=>a.priority-b.priority)) {
    if(active>=4)break;
    if(request.pending||request.retryAt>now)continue;
    request.pending=true;active++;
    Promise.resolve(netRealmLogisticsCommand(request.args,request.nonce)).then(result=>{
      if(state.requests.get(request.key)!==request)return;
      request.pending=false;
      if(request.scope!==realmLogisticsScope()||!realmLogisticsKeeper()||!realmLogisticsRequestView()){state.requests.delete(request.key);return;}
      if(result?.pending||result?.uncertain||result?.ok&&result.confirmed!==true){request.retryAt=realmLogisticsNow()+5;return;}
      state.requests.delete(request.key);state.cooldown.set(request.key,realmLogisticsNow()+(result?.ok?2:10));
      if(result?.ok&&result.confirmed===true&&request.done)request.done(result);
    },()=>{if(state.requests.get(request.key)===request){request.pending=false;request.retryAt=realmLogisticsNow()+5;}});
  }
  for(const [key,until]of state.cooldown)if(until+60<now)state.cooldown.delete(key);
}
function realmLogisticsFunding(value) {
  if(!realmLogisticsKeeper())return null;
  const id=typeof value==='string'?value:value?.id,view=realmLogisticsGrantView();
  return view?.jobs.find(j=>j.id===id&&j.state==='active'&&j.peer===NET.self&&j.season===view.season)||null;
}
function realmLogisticsDispatch(K) {
  if(!K||!realmLogisticsKeeper())return false;
  return realmLogisticsRequest('dispatch:'+K.id,{op:'convoy.dispatch',keep:K.id},3);
}
function realmLogisticsSettle(c,outcome) {
  if(!c?.logisticsId||c.logisticsSettled||!realmLogisticsKeeper())return false;
  const job=realmLogisticsFunding(c.logisticsId);
  if(!job||job.lease!==c.logisticsLease)return false;
  c.logisticsPending=outcome;
  const key='settle:'+job.id+':'+job.lease+':'+outcome;
  const queued=realmLogisticsRequest(key,{op:'convoy.settle',jobId:job.id,lease:job.lease,outcome},0,()=>realmLogisticsApplyProjection());
  if(!queued&&!REALM_LOGISTICS.requests.has(key))c.logisticsPending='';
  return queued;
}
function realmLogisticsRetireEscorts(c) {
  for(const id of c.esc||[]){const e=getEnt(id);if(e){e.lCar=null;if(!e.removed)removeEnt(e);}}
  c.esc=[];
}
function realmLogisticsApplyProjection() {
  const state=REALM_LOGISTICS,view=realmLogisticsGrantView();state.view=view;
  realmLogisticsOwnerFrame();
  if(!view||!realmLogisticsKeeper()||typeof LOOPS==='undefined')return;
  if(!state.migrated){
    // The canonical realm ledger replaces the old raw mirrors and cart refunds.
    LOOPS.k=[];LOOPS.pend=[{},{},{}];
    for(const c of LOOPS.caravans)if(!c.logisticsId){c.load={};if(c.state==='road'&&!c.back)loopsCarTurn(c);}
    state.migrated=true;
  }
  const jobs=new Map(view.jobs.map(j=>[j.id,j]));
  for(const c of LOOPS.caravans) {
    if(!c.logisticsId)continue;
    const job=jobs.get(c.logisticsId);
    if(!job||job.season!==view.season){c.load={};c.logisticsSettled=true;loopsCarGone(c);continue;}
    if(job.state==='active'){
      c.logisticsSettled=false;
      if(job.peer!==NET.self){c.logisticsPending='adopt';continue;}
      if(c.logisticsLease!==job.lease){c.logisticsLease=job.lease;c.logisticsPending='';}
      c.logisticsSeason=job.season;
    } else {
      c.logisticsPending='';c.logisticsSettled=true;c.load={};realmLogisticsRetireEscorts(c);
      if(job.state==='arrived'){if(c.state==='road'&&!c.back)loopsCarTurn(c);}
      else if(job.state==='returned')loopsCarGone(c);
      else if(job.state==='lost'){c.state='wreck';if(!Number.isFinite(c.wreckT))c.wreckT=0;}
    }
  }
  for(const job of view.jobs) {
    if(job.state!=='active'||job.season!==view.season)continue;
    if(job.peer!==NET.self){
      realmLogisticsRequest('adopt:'+job.id,{op:'convoy.adopt',jobId:job.id},0,()=>realmLogisticsApplyProjection());
      continue;
    }
    const existing=LOOPS.caravans.find(c=>c.logisticsId===job.id);
    if(!existing){const K=WAR.keeps[job.keep];if(K)loopsCarSend(job.realm,K,false,job);}
  }
  for(const mount of view.mounts||[]){
    const e=typeof netEntityFind==='function'?netEntityFind(mount.actorId):null;
    if(e&&e.alive&&e.faction===mount.realm)e.lHorse=1;
  }
}
function realmLogisticsMountGranted(id,realm) { return !!realmLogisticsGrantView()?.mounts?.some(m=>m.actorId===id&&m.realm===realm); }
function realmLogisticsHorse(e) {
  if(!e||!e.alive||!realmLogisticsKeeper()||!realmLogisticsRequestView())return false;
  const id=e.netEntityId;
  if(!id){if(typeof netEntityRegister==='function')netEntityRegister(e);return false;}
  const grant=realmLogisticsGrantView()?.mounts?.find(m=>m.actorId===id&&m.realm===e.faction);
  if(grant){e.lHorse=1;return true;}
  realmLogisticsRequest('mount:'+id,{op:'mount.issue',actorId:id},2,result=>{
    if(e.alive&&!e.removed&&e.netEntityId===id&&result.data?.actorId===id)e.lHorse=1;
  });
  return false;
}
function realmLogisticsRepair(K,kind) {
  if(!K||!realmLogisticsKeeper())return false;
  const type=kind==='gate'?'gate':kind==='tower'?'tower':'wall';
  return realmLogisticsRequest('repair:'+K.id+':'+type,{op:'repair.issue',keep:K.id,kind:type},1);
}
function realmLogisticsHouseWork(H,dt) {
  return typeof realmPublicWorksHouseWork==='function'?realmPublicWorksHouseWork(H,dt,HOUSE_TIME.scaffold):0;
}
function realmLogisticsHouseRepair(H) {
  if(!H||!realmLogisticsKeeper())return false;
  return realmLogisticsRequest('house:'+H.num,{op:'repair.issue',house:H.num,kind:'house'},1);
}
function realmLogisticsStep(dt) {
  if(!realmLogisticsKeeper())return;
  const state=REALM_LOGISTICS,view=realmLogisticsRequestView();if(!view)return;
  const grants=realmLogisticsGrantView(),jobs=grants?.jobs||[];
  realmLogisticsApplyProjection();
  const step=Number.isFinite(dt)?Math.max(0,Math.min(dt,0.1)):0;
  for(let r=0;r<3;r++){
    state.carClock[r]-=step;if(state.carClock[r]>0)continue;state.carClock[r]=70+Math.random()*40;
    if(jobs.filter(j=>j.state==='active'&&j.realm===r).length>=2)continue;
    const keeps=(typeof NETS!=='undefined'?NETS.s?.keeps:[])||[];
    const targets=keeps.filter(k=>k.r===r&&(k.g<8||!k.gate)&&!jobs.some(j=>j.state==='active'&&j.keep===k.i))
      .sort((a,b)=>a.g-b.g);
    if(targets[0]&&WAR.keeps[targets[0].i])realmLogisticsDispatch(WAR.keeps[targets[0].i]);
  }
  for(const c of grants?LOOPS.caravans:[]){
    if(c.logisticsId&&!c.logisticsSettled&&c.logisticsPending&&c.logisticsPending!=='adopt')
      realmLogisticsSettle(c,c.logisticsPending);
    loopsCarStep(c,step);
  }
  for(let i=LOOPS.caravans.length-1;i>=0;i--)if(LOOPS.caravans[i].state==='gone')LOOPS.caravans.splice(i,1);
  realmLogisticsPump();
}
function realmLogisticsAccount() {try{return NETWS.acct?.id||'';}catch(err){return '';}}
function realmLogisticsOwnerFrame() {
  const view=realmLogisticsView(),account=realmLogisticsAccount();
  if(!view||!account||typeof GAME==='undefined'||!GAME.started||!GAME.player
    ||typeof netHumanLive==='function'&&!netHumanLive()||typeof anMine!=='function')return;
  const consumed=new Set((view.donations||[]).filter(d=>d.ownerAccount===account).map(d=>d.claimId));
  let changed=false;
  for(const e of anMine()){
    const claim=e.tame?.sharedClaim;
    if(claim&&consumed.has(claim)){e.tame.owner='gone';removeEnt(e);changed=true;REALM_LOGISTICS.donations.delete(claim);}
  }
  if(changed){ANIMALS.uiDirty=true;saveSoon();}
}
async function realmLogisticsDonateHorse(e) {
  if(!loopsCanonicalManaged()||!e?.alive||e.removed||e.tame?.owner!=='player'||e.tame.k!=='horse'
    ||typeof anAdult==='function'&&!anAdult(e.tame)||typeof netRealmLogisticsCommand!=='function')return false;
  const player=GAME.player,account=realmLogisticsAccount();if(!player||!account)return false;
  const claim=e.tame.sharedClaim||(e.tame.sharedClaim='owned:'+crypto.randomUUID());
  let request=REALM_LOGISTICS.donations.get(claim);
  if(request?.pending)return true;
  if(!request){if(REALM_LOGISTICS.donations.size>=4)return false;request={nonce:crypto.randomUUID(),pending:false};REALM_LOGISTICS.donations.set(claim,request);}
  request.pending=true;
  try{
    await saveNow();
    let confirmed=null;try{confirmed=JSON.parse(SAVE.lastBody||'null');}catch(err){}
    if(!e.alive||e.removed||e.tame.owner!=='player'||!SAVE.native||!SAVE.ref||GAME.player!==player||realmLogisticsAccount()!==account||SAVE.nativePaused||SAVE.pending
      ||!confirmed?.char?.x?.animals?.list?.some(a=>a.sc===claim&&a.k==='horse'))return false;
    if(typeof netEntityRegister==='function')netEntityRegister(e);
    if(!e.netEntityId)return false;
    if(typeof NET_ENTITIES!=='undefined')NET_ENTITIES.petsAt=-Infinity;
    const actorId=e.netEntityId;
    const result=await netRealmLogisticsCommand({op:'horse.donate',actorId,claimId:claim},request.nonce);
    if(result?.pending||result?.uncertain||result?.ok&&result.confirmed!==true)return true;
    if(result?.ok&&result.confirmed===true&&result.data?.claimId===claim&&result.data?.actorId===actorId
      &&GAME.player===player&&realmLogisticsAccount()===account){
      e.tame.owner='gone';if(!e.removed)removeEnt(e);ANIMALS.uiDirty=true;saveSoon();
      REALM_LOGISTICS.donations.delete(claim);
      if(typeof uiToast==='function')uiToast('One horse is confirmed in your realm’s stables.');
      return true;
    }
    REALM_LOGISTICS.donations.delete(claim);
    if(typeof uiError==='function')uiError(result?.why||result?.message||'The horse donation is waiting for its accepted ownership snapshot.');
    return false;
  }finally{request.pending=false;}
}
