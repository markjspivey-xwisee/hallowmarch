import { randomUUID } from 'node:crypto';

const RAW = { food: 0, timber: 1, stone: 2, iron: 3, hides: 4, wool: 5, horses: 6, gold: 7 };
const TARGET = [400, 160, 120, 50, 40, 30, 12, 600];
const CARGO = { food: 6, timber: 6, stone: 6 };
const HOUSE_COST = { timber:10, stone:5 };
const REPAIR = { wall: { timber: 12, stone: 20 }, gate: { timber: 12, iron: 2 }, tower: { timber: 18, stone: 10, iron: 2 } };
const STATES = ['active', 'arrived', 'lost', 'returned'];
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const plain = x => !!x && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
const integer = (x, lo, hi) => Number.isSafeInteger(x) && x >= lo && x <= hi;
const finite = (x, lo = 0, hi = 1e12) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const clone = x => JSON.parse(JSON.stringify(x));
const same = (a,b) => a?.origin === b?.origin && a?.epoch === b?.epoch && integer(a?.epoch,1,Number.MAX_SAFE_INTEGER);
const text = (x,max=160) => typeof x === 'string' && x.length > 0 && x.length <= max;
const entityId = x => typeof x === 'string' && /^scene:[a-zA-Z0-9_-]{1,32}:\d{1,8}$/.test(x);
const keys = (x, allowed) => plain(x) && Object.keys(x).every(k => !BAD_KEYS.has(k) && allowed.includes(k));
const exactCargo = c => keys(c,Object.keys(CARGO)) && Object.keys(c).length === 3 && Object.entries(CARGO).every(([k,n]) => c[k] === n);
function invalid() { const e = new Error('The realm logistics ledger is invalid.'); e.code = 'INVALID_LOGISTICS_STATE'; throw e; }
function validBase(RS) {
  return RS && integer(RS.n,1,1e6) && finite(RS.t) && Array.isArray(RS.realms) && RS.realms.length === 3
    && RS.realms.every(R => Array.isArray(R.s) && R.s.length === 8 && R.s.every(n => finite(n,0,1e8)))
    && Array.isArray(RS.keeps) && RS.keeps.length > 0 && RS.keeps.length <= 12
    && RS.keeps.every(K=>K && integer(K.h,0,2) && integer(K.home,0,2) && finite(K.g,0,40) && finite(K.gate,0,1))
    && RS.management?.v === 1 && integer(RS.management.revision,0,Number.MAX_SAFE_INTEGER-1);
}
function fresh(RS,previous,scope) { return { v:1,season:RS.n,scope:clone(scope),jobs:[],mounts:[],repairs:[],appliedGateSpent:[],houseRepairs:[],donations:clone(previous?.donations||[]) }; }
function validateLedger(L,RS) {
  if (!keys(L,['v','season','scope','jobs','mounts','repairs','appliedGateSpent','houseRepairs','donations']) || !['v','season','scope','jobs','mounts','repairs','appliedGateSpent'].every(k=>Object.hasOwn(L,k))
    || L.v !== 1 || !keys(L.scope,['origin','epoch']) || Object.keys(L.scope).length!==2 || !text(L.scope.origin,512) || !integer(L.scope.epoch,1,Number.MAX_SAFE_INTEGER) || !integer(L.season,1,RS.n) || !Array.isArray(L.jobs) || L.jobs.length > 38
    || !Array.isArray(L.mounts) || L.mounts.length > 256 || !Array.isArray(L.repairs) || L.repairs.length > 108
    || !Array.isArray(L.appliedGateSpent) || L.appliedGateSpent.length > 36) invalid();
  const ids = new Set(), count=[0,0,0];
  for (const j of L.jobs) {
    if (!keys(j,['id','lease','season','peer','realm','keep','cargo','escorts','state','at','endedAt'])
      || !text(j.id,80) || !text(j.lease,80) || ids.has(j.id) || j.season !== L.season || !text(j.peer,128)
      || !integer(j.realm,0,2) || !integer(j.keep,0,RS.keeps.length-1) || !exactCargo(j.cargo) || j.escorts !== 2
      || !STATES.includes(j.state) || !finite(j.at) || (j.endedAt !== undefined && !finite(j.endedAt))) invalid();
    ids.add(j.id); if (j.state === 'active' && ++count[j.realm] > 2) invalid();
  }
  if (L.jobs.filter(j => j.state !== 'active').length > 32) invalid();
  ids.clear();
  for (const m of L.mounts) {
    if (!keys(m,['actorId','realm','grantId','at']) || !entityId(m.actorId) || ids.has(m.actorId)
      || !integer(m.realm,0,2) || !text(m.grantId,80) || !finite(m.at)) invalid();
    ids.add(m.actorId);
  }
  ids.clear();
  for (const r of L.repairs) {
    const id = r.keep+':'+r.owner+':'+r.kind;
    if (!keys(r,['keep','owner','kind','totalUnits']) || !integer(r.keep,0,RS.keeps.length-1) || !integer(r.owner,0,2)
      || !Object.hasOwn(REPAIR,r.kind) || !finite(r.totalUnits,0,1e6) || ids.has(id)) invalid();
    ids.add(id);
  }
  ids.clear();
  for (const r of L.appliedGateSpent) {
    const id = r.keep+':'+r.owner;
    if (!keys(r,['keep','owner','units']) || !integer(r.keep,0,RS.keeps.length-1) || !integer(r.owner,0,2)
      || !finite(r.units,0,1e6) || ids.has(id)) invalid();
    ids.add(id);
  }
  ids.clear();
  if (L.houseRepairs!==undefined) {
    if (!Array.isArray(L.houseRepairs)||L.houseRepairs.length>192) invalid();
    for(const r of L.houseRepairs) {
      const key=r.house+':'+r.owner;
      if(!keys(r,['house','owner','totalUnits'])||!integer(r.house,0,255)||!integer(r.owner,0,2)||!finite(r.totalUnits,0,1e6)||ids.has(key)) invalid();
      ids.add(key);
    }
  }
  const claims=new Set(),bodies=new Set();
  if(L.donations!==undefined) {
    if(!Array.isArray(L.donations)||L.donations.length>128) invalid();
    for(const d of L.donations) {
      const claim=d.ownerAccount+':'+d.claimId,body=d.ownerAccount+':'+d.actorId;
      if(!keys(d,['claimId','actorId','ownerAccount','realm','at','season'])||!text(d.claimId,160)||!/^[a-zA-Z0-9:_-]+$/.test(d.claimId)
        ||!entityId(d.actorId)||!text(d.ownerAccount,200)||!integer(d.realm,0,2)||!finite(d.at)||!integer(d.season,1,L.season)
        ||claims.has(claim)||bodies.has(body)) invalid();
      claims.add(claim);bodies.add(body);
    }
  }
  if (encodeURIComponent(JSON.stringify(L)).replace(/%[0-9A-F]{2}/g,'x').length > 65536) invalid();
  return L;
}
export function realmLogisticsRestore(candidate,source) {
  const input = source?.management;
  if (!input || !Object.hasOwn(input,'logistics')) {
    if (candidate?.management) delete candidate.management.logistics;
    return candidate;
  }
  if (!validBase(candidate)) invalid();
  candidate.management.logistics = clone(validateLedger(input.logistics,candidate));
  return candidate;
}
function ledger(RS,scope) {
  const L=RS.management.logistics;
  if(L) validateLedger(L,RS);
  return L && L.season === RS.n && same(L.scope,scope) ? clone(L) : fresh(RS,L,scope);
}
function worldPoint(realm,along,lat=0) {
  const a=[150,270,30][realm]*Math.PI/180, dx=Math.sin(a), dz=-Math.cos(a);
  return {x:dx*along-dz*lat,z:dz*along+dx*lat};
}
function anchors(RS,keep,realm) {
  const home=RS.keeps[keep]?.home;
  if (!integer(home,0,2) || keep>=6) return null;
  const lat=keep%2===0?64:-64; // canonical physical WAR.keeps and RSM_GEO order
  return {town:worldPoint(realm,378),keep:worldPoint(home,118,lat),gate:worldPoint(home,90,lat)};
}
function cap(R,id) {
  const g=RAW[id];
  return TARGET[g]*4*(id==='food'?1+0.5*(R.proj?.granary||0):id==='horses'?1+0.5*(R.proj?.yard||0):1);
}
const canPay = (R,cost) => Object.entries(cost).every(([id,n]) => R.s[RAW[id]]+1e-9>=n);
const pay = (R,cost) => { for (const [id,n] of Object.entries(cost)) R.s[RAW[id]]=Math.max(0,R.s[RAW[id]]-n); };
const canReturn = (R,cost) => Object.entries(cost).every(([id,n]) => R.s[RAW[id]]+n<=cap(R,id)+1e-9);
const refund = (R,cost) => { for (const [id,n] of Object.entries(cost)) R.s[RAW[id]]+=n; };
const actorScope = (actor,ctx) => text(actor?.peer,128) && actor.peer===ctx.peer && same(actor.worldAdmission,ctx.worldAdmission) && actor.authority===ctx.authority;
const keeper = (actor,ctx) => actorScope(actor,ctx) && actor.actualKeeper===true && ctx.actualKeeper===true;
function rowMap(ctx) {
  const rows=ctx.entities?.rows;
  if (!Array.isArray(rows) || rows.length>2048) return null;
  const map=new Map();
  for (const r of rows) {
    if (!plain(r) || !entityId(r.id) || map.has(r.id)) return null;
    map.set(r.id,r);
  }
  return map;
}
function actorPoint(r) {
  return Array.isArray(r?.p) && r.p.length===3 && r.p.every(n=>finite(n,-4000,4000)) ? {x:r.p[0],z:r.p[2]} : null;
}
function live(r) {
  return !!r && r.alive!==false && r.alive!==0 && finite(r.hp===undefined?r.maxHp:r.hp,0,1e8)
    && (r.hp===undefined?r.maxHp:r.hp)>0;
}
function alive(r) { return live(r)&&!r.owner;
}
const distance = (a,b) => a&&b ? Math.hypot(a.x-b.x,a.z-b.z) : Infinity;
function convoyProof(ctx,j) {
  const rows=rowMap(ctx), jobs=ctx.entities?.meta?.logistics?.jobs, cars=ctx.entities?.meta?.caravans;
  if (!rows || !Array.isArray(jobs) || jobs.length>6 || !Array.isArray(cars) || cars.length>64) return null;
  const p=jobs.find(p=>p?.jobId===j.id && p.lease===j.lease && p.season===j.season);
  const c=cars.find(c=>c?.logisticsId===j.id && c.logisticsLease===j.lease && c.logisticsSeason===j.season);
  if (!p || !c || !Array.isArray(p.escortIds) || p.escortIds.length>2 || new Set(p.escortIds).size!==p.escortIds.length
    || !p.escortIds.every(entityId) || c.horse!==p.horseId || c.realm!==j.realm || c.keep!==j.keep) return null;
  const horse=rows.get(p.horseId), carter=rows.get(c.carter);
  if (horse && (horse.kind!=='horse' || horse.role!=='carthorse' || horse.owner)) return null;
  if (carter && (carter.kind!==undefined && carter.kind!=='humanoid' || carter.role!=='carter' || carter.faction!==j.realm || carter.owner)) return null;
  const escorts=p.escortIds.map(id=>rows.get(id));
  if (escorts.some(e=>e && ((e.kind!==undefined && e.kind!=='humanoid') || e.role!=='escort' || e.faction!==j.realm || e.owner))) return null;
  return {horse,carter,point:actorPoint(horse),survivors:escorts.filter(alive).length};
}
function spentGate(RS,keep,owner,ctx) {
  const p=ctx.worldparts?.parts?.publicworks;
  if (!p || p.v!==1 || p.scope?.n!==RS.n || !same(p.scope,ctx.worldAdmission) || !Array.isArray(p.spent) || p.spent.length>108) return 0;
  return p.spent.filter(r=>r?.keep===keep && r.owner===owner && r.kind==='gate' && finite(r.units,0,1e6))
    .reduce((n,r)=>Math.max(n,r.units),0);
}
function spentRepair(RS,keep,owner,kind,ctx) {
  const p=ctx.worldparts?.parts?.publicworks;
  if (!p || p.v!==1 || p.scope?.n!==RS.n || !same(p.scope,ctx.worldAdmission) || !Array.isArray(p.spent) || p.spent.length>108) return 0;
  return p.spent.filter(r=>r?.keep===keep && r.owner===owner && r.kind===kind && finite(r.units,0,1e6)).reduce((n,r)=>Math.max(n,r.units),0);
}
function addRepair(L,keep,owner,kind,units) {
  let r=L.repairs.find(r=>r.keep===keep && r.owner===owner && r.kind===kind);
  if (!r) {r={keep,owner,kind,totalUnits:0};L.repairs.push(r);}
  r.totalUnits+=units;return r;
}
function trim(L) {
  const terminal=L.jobs.filter(j=>j.state!=='active');
  if (terminal.length>32) {const remove=new Set(terminal.slice(0,terminal.length-32).map(j=>j.id));L.jobs=L.jobs.filter(j=>!remove.has(j.id));}
}
function commit(RS,L,message,data) {
  trim(L);validateLedger(L,RS);RS.management.logistics=L;RS.management.revision++;
  return {ok:true,message,revision:RS.management.revision,data};
}
function jobData(j) { return {jobId:j.id,lease:j.lease,season:j.season,realm:j.realm,keep:j.keep,load:{...j.cargo},escorts:j.escorts,state:j.state}; }
function applyLogistics(RS,actor,args,ctx={}) {
  const no=why=>({ok:false,why,revision:RS?.management?.revision||0});
  if (!validBase(RS) || RS.management.revision>=Number.MAX_SAFE_INTEGER-1 || !plain(args)) return no('The logistics command is invalid.');
  const op=args.op;
  const fields={
    'convoy.dispatch':['op','keep'],'convoy.adopt':['op','jobId'],'convoy.settle':['op','jobId','lease','outcome'],
    'mount.issue':['op','actorId'],'repair.issue':['op','keep','house','kind'],'horse.donate':['op','actorId','claimId'],
  };
  if (!Object.hasOwn(fields,op) || !keys(args,fields[op])) return no('Choose an available logistics command.');
  const isKeeper=keeper(actor,ctx);
  const isRuler=actorScope(actor,ctx)&&actor?.ruler===true;
  const isDonor=actorScope(actor,ctx)&&actor?.nativeOwner===true&&text(actor.owner,200)&&actor.owner===ctx.owner;
  if (!isKeeper && !(isRuler&&['repair.issue','convoy.dispatch'].includes(op)) && !(isDonor&&op==='horse.donate')) return no('This actor is not authorized for the logistics command.');
  const L=ledger(RS,ctx.worldAdmission);
  if (op==='convoy.dispatch') {
    if (!integer(args.keep,0,RS.keeps.length-1)) return no('Choose a current keep.');
    const K=RS.keeps[args.keep], realm=K.h, R=RS.realms[realm], points=anchors(RS,args.keep,realm);
    if(!isKeeper&&actor.realm!==realm) return no('The high seat may dispatch only to a keep held by its realm.');
    if (!integer(realm,0,2) || !points || L.jobs.filter(j=>j.state==='active'&&j.realm===realm).length>=2
      || L.jobs.some(j=>j.state==='active'&&j.keep===args.keep)) return no('That realm already has enough supply carts on this route.');
    if (K.g>=8 && K.gate>=1) return no('That keep does not need a supply cart.');
    if (R.lev<6 || !canPay(R,{...CARGO,horses:1})) return no('The realm needs cargo, a horse and two paid escorts with four reserves remaining.');
    const id=randomUUID(),lease=randomUUID();
    const j={id,lease,season:RS.n,peer:actor.peer,realm,keep:args.keep,cargo:{...CARGO},escorts:2,state:'active',at:RS.t};
    pay(R,{...CARGO,horses:1});R.lev-=2;L.jobs.push(j);
    return commit(RS,L,'A paid supply cart is reserved.',jobData(j));
  }
  if (op==='convoy.adopt' || op==='convoy.settle') {
    const j=L.jobs.find(j=>j.id===args.jobId);
    if (!j || j.season!==RS.n || j.state!=='active') return no('That supply cart is no longer active.');
    if (op==='convoy.adopt') {
      j.peer=actor.peer;j.lease=randomUUID();
      return commit(RS,L,'The current keeper has adopted the existing paid cart.',jobData(j));
    }
    if (j.peer!==actor.peer || args.lease!==j.lease || !['arrived','lost','returned'].includes(args.outcome)) return no('That cart lease is no longer current.');
    const proof=convoyProof(ctx,j), R=RS.realms[j.realm], K=RS.keeps[j.keep], points=anchors(RS,j.keep,j.realm);
    if (!proof || !points) return no('Waiting for an accepted cart and escort snapshot.');
    let returned=0,guards=0;
    if (args.outcome==='lost') {
      if (alive(proof.horse)&&alive(proof.carter)) return no('The accepted cart is still alive.');
    } else {
      if (!alive(proof.horse)||!alive(proof.carter)) return no('A lost cart cannot deliver or refund its cargo.');
      if (args.outcome==='arrived') {
        if (K.h!==j.realm || Math.min(distance(proof.point,points.keep),distance(proof.point,points.gate))>24) return no('The accepted cart has not reached a friendly keep.');
        guards=Math.min(proof.survivors,Math.max(0,8-K.g));returned=proof.survivors-guards;
        if (R.lev+returned>120) return no('The returning escorts need reserve capacity.');
        K.g+=guards;R.lev+=returned;
        // Delivery purchases finite physical repair entitlement; actual paid work raises the canonical gate later.
        addRepair(L,j.keep,j.realm,'gate',0.1);
      } else {
        if (distance(proof.point,points.town)>64 || !canReturn(R,{...j.cargo,horses:1}) || R.lev+proof.survivors>120) return no('The returned cargo needs its town and enough storage.');
        refund(R,{...j.cargo,horses:1});returned=proof.survivors;R.lev+=returned;
      }
    }
    j.state=args.outcome;j.endedAt=RS.t;
    return commit(RS,L,'The paid cart outcome is confirmed.',{...jobData(j),guards,returnedEscorts:returned});
  }
  if (op==='mount.issue') {
    const rows=rowMap(ctx), row=rows?.get(args.actorId);
    if (!entityId(args.actorId)||!row||!alive(row)||(row.kind!==undefined&&row.kind!=='humanoid')
      || !['soldier','guard','lord','muster','escort','carter'].includes(row.role)||!integer(row.faction,0,2)) return no('Choose an accepted living realm NPC.');
    const prior=L.mounts.find(m=>m.actorId===args.actorId);
    if (prior) return commit(RS,L,'The existing paid mount grant is confirmed.',{actorId:prior.actorId,grantId:prior.grantId,realm:prior.realm});
    if (row.mount || row.mounted===1) return no('That accepted NPC already has a mount.');
    const R=RS.realms[row.faction];
    if (L.mounts.length>=256||R.s[RAW.horses]<1) return no('The realm has no available horse grant.');
    const m={actorId:args.actorId,realm:row.faction,grantId:randomUUID(),at:RS.t};pay(R,{horses:1});L.mounts.push(m);
    return commit(RS,L,'One existing realm horse is issued.',{actorId:m.actorId,grantId:m.grantId,realm:m.realm});
  }
  if(op==='horse.donate') {
    if(!isDonor||!integer(actor.realm,0,2)||!entityId(args.actorId)||!text(args.claimId,160)||!/^[a-zA-Z0-9:_-]+$/.test(args.claimId)) return no('The owned horse claim is invalid.');
    const donations=L.donations||(L.donations=[]), prior=donations.find(d=>d.ownerAccount===actor.owner&&d.claimId===args.claimId);
    if(prior) return commit(RS,L,'This owned horse claim has already been consumed.',{claimId:args.claimId,actorId:args.actorId,consumed:true,realm:prior.realm});
    if(donations.some(d=>d.ownerAccount===actor.owner&&d.actorId===args.actorId)) return no('That accepted horse was already donated under another claim.');
    const row=rowMap(ctx)?.get(args.actorId), ownerPoint=actor.position;
    if(!row||!live(row)||row.owner!==actor.peer||row.kind!=='horse'||row.role!=='animal'||row.tame?.k!=='horse'
      ||row.tame.owner!=='player'||row.tame.sharedClaim!==args.claimId||!finite(row.tame.age,900,1e12)||!ownerPoint||!finite(ownerPoint.x,-500,500)||!finite(ownerPoint.z,-500,500)
      ||distance(actorPoint(row),ownerPoint)>12) return no('Bring the accepted adult horse beside its admitted owner.');
    const town=worldPoint(actor.realm,378);
    const byKeep=RS.keeps.some((K,k)=>K.h===actor.realm&&distance(ownerPoint,anchors(RS,k,actor.realm)?.keep)<=40);
    if(distance(ownerPoint,town)>64&&!byKeep) return no('Give the horse near your realm quartermaster or a held keep.');
    const R=RS.realms[actor.realm];
    if(donations.length>=128||R.s[RAW.horses]+1>cap(R,'horses')+1e-9) return no('The claim ledger or realm stables need capacity.');
    donations.push({claimId:args.claimId,actorId:args.actorId,ownerAccount:actor.owner,realm:actor.realm,at:RS.t,season:RS.n});
    R.s[RAW.horses]+=1;
    return commit(RS,L,'The owned horse is credited once; consume its private claim.',{claimId:args.claimId,actorId:args.actorId,consumed:true,realm:actor.realm});
  }
  if(op==='repair.issue'&&args.kind==='house') {
    if(!integer(args.house,0,255)||Object.hasOwn(args,'keep')) return no('Choose a damaged native house.');
    const houses=ctx.entities?.meta?.publicWorks?.houses;
    const H=Array.isArray(houses)&&houses.length<=64?houses.find(H=>H?.id===args.house):null;
    if(!H||!integer(H.owner,0,2)||!['ruin','scaffold'].includes(H.state)||!(isKeeper||isRuler&&actor.realm===H.owner)) return no('The accepted house is not available for this realm to rebuild.');
    const grants=L.houseRepairs||(L.houseRepairs=[]), current=grants.find(r=>r.house===H.id&&r.owner===H.owner);
    const p=ctx.worldparts?.parts?.publicworks;
    const spent=p?.v===1&&p.scope?.n===RS.n&&same(p.scope,ctx.worldAdmission)&&Array.isArray(p.houseSpent)&&p.houseSpent.length<=192
      ?p.houseSpent.filter(r=>r?.house===H.id&&r.owner===H.owner&&finite(r.units,0,1e6)).reduce((n,r)=>Math.max(n,r.units),0):0;
    const total=current?.totalUnits||0;
    if(total>=1e6||total-Math.min(total,spent)>=2-1e-8||!canPay(RS.realms[H.owner],HOUSE_COST)) return no('Use funded house work or supply the reconstruction materials first.');
    let grant=current;if(!grant){grant={house:H.id,owner:H.owner,totalUnits:0};grants.push(grant);}
    grant.totalUnits++;pay(RS.realms[H.owner],HOUSE_COST);
    return commit(RS,L,'Finite native house reconstruction is funded.',{house:H.id,owner:H.owner,kind:'house',totalUnits:grant.totalUnits,units:1});
  }
  if(Object.hasOwn(args,'house')) return no('Choose one keep repair target.');
  const K=RS.keeps[args.keep], owner=K?.h;
  if (!integer(args.keep,0,RS.keeps.length-1)||!integer(owner,0,2)||!Object.hasOwn(REPAIR,args.kind)
    || !(isKeeper || isRuler&&actor.realm===owner)) return no('Choose a keep held by your realm and an available repair.');
  const total=L.repairs.find(r=>r.keep===args.keep&&r.owner===owner&&r.kind===args.kind)?.totalUnits||0;
  const used=Math.min(total,spentRepair(RS,args.keep,owner,args.kind,ctx));
  if (total>=1e6||total-used>=2-1e-8||!canPay(RS.realms[owner],REPAIR[args.kind])) return no('Use the funded repair credit or supply the quoted materials first.');
  pay(RS.realms[owner],REPAIR[args.kind]);const grant=addRepair(L,args.keep,owner,args.kind,1);
  return commit(RS,L,'Finite repair work is funded.',{keep:args.keep,owner,kind:args.kind,totalUnits:grant.totalUnits,units:1});
}
export function realmLogisticsApply(RS,actor,args,ctx={}) {
  const no=why=>({ok:false,why,revision:RS?.management?.revision||0});
  if(!validBase(RS)) return no('The logistics state is unavailable.');
  let candidate;
  try { if(RS.management.logistics) validateLedger(RS.management.logistics,RS); candidate=clone(RS); }
  catch { return no('The logistics state is invalid.'); }
  let result;
  try { result=applyLogistics(candidate,actor,args,ctx); }
  catch { return no('The bounded logistics command could not be applied.'); }
  if(result.ok) Object.assign(RS,candidate);
  return result;
}
export function realmLogisticsGateReport(RS,report,ctx={}) {
  const no=why=>({ok:false,gate:RS?.keeps?.[report?.keep]?.gate,why});
  if (!validBase(RS)||RS.management.revision>=Number.MAX_SAFE_INTEGER-1||ctx.actualKeeper!==true||!integer(report?.keep,0,RS.keeps.length-1)||!finite(report.gate,0,1)) return no('The gate proof is invalid.');
  const K=RS.keeps[report.keep];
  if (report.owner!==K.h||report.gate<=K.gate) return no('Only an actual increase for the current holder uses repair credit.');
  const source=RS.management.logistics;
  if (!source||source.season!==RS.n||!same(source.scope,ctx.worldAdmission)) return no('No confirmed gate repair credit is available.');
  const L=clone(source);
  validateLedger(L,RS);
  const funded=L.repairs.find(r=>r.keep===report.keep&&r.owner===K.h&&r.kind==='gate')?.totalUnits||0;
  const confirmed=Array.isArray(ctx.confirmedRepairs)&&ctx.confirmedRepairs.length<=108?ctx.confirmedRepairs.find(r=>r.keep===report.keep&&r.owner===K.h&&r.kind==='gate')?.totalUnits:0;
  const total=Math.min(funded,finite(confirmed,0,1e6)?confirmed:0);
  let applied=L.appliedGateSpent.find(r=>r.keep===report.keep&&r.owner===K.h);
  const spent=Math.min(total,spentGate(RS,report.keep,K.h,ctx)),available=spent-(applied?.units||0);
  const delta=Math.min(report.gate-K.gate,available);
  if (!(delta>1e-9)) return no('Waiting for accepted paid physical repair progress.');
  if (!applied) {applied={keep:report.keep,owner:K.h,units:0};L.appliedGateSpent.push(applied);}
  applied.units=spent;validateLedger(L,RS);RS.management.logistics=L;K.gate=Math.min(1,K.gate+delta);RS.management.revision++;
  return {ok:true,gate:K.gate};
}
export function realmLogisticsView(RS,ownerAccountId='') {
  const base={v:1,season:RS?.n||0,scope:null,revision:RS?.management?.revision||0,time:RS?.t||0,jobs:[],mounts:[],repairs:[],houseRepairs:[],donations:[]};
  if (!validBase(RS)) return base;
  const L=RS.management.logistics;
  if (!L) return {...base,quotes:{cargo:{...CARGO},escorts:2,horse:1,repairs:{...clone(REPAIR),house:{...HOUSE_COST}}}};
  validateLedger(L,RS);
  if(L.season!==RS.n) return {...base,scope:clone(L.scope),donations:clone((L.donations||[]).filter(d=>d.ownerAccount===ownerAccountId)),quotes:{cargo:{...CARGO},escorts:2,horse:1,repairs:{...clone(REPAIR),house:{...HOUSE_COST}}}};
  validateLedger(L,RS);
  return {...base,scope:clone(L.scope),jobs:L.jobs.map(j=>({...clone(j),from:anchors(RS,j.keep,j.realm)?.town,to:anchors(RS,j.keep,j.realm)?.gate})),
    mounts:clone(L.mounts),repairs:clone(L.repairs),houseRepairs:clone(L.houseRepairs||[]),
    donations:clone((L.donations||[]).filter(d=>d.ownerAccount===ownerAccountId)),quotes:{cargo:{...CARGO},escorts:2,horse:1,repairs:{...clone(REPAIR),house:{...HOUSE_COST}}}};
}
