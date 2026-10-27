import { randomUUID } from 'node:crypto';

const RAW = { food: 0, timber: 1, stone: 2, iron: 3, hides: 4, wool: 5, horses: 6, gold: 7 };
const TARGET = [400, 160, 120, 50, 40, 30, 12, 600];
const CARGO = { food: 6, timber: 6, stone: 6 };
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
    && RS.management?.v === 1 && integer(RS.management.revision,0,Number.MAX_SAFE_INTEGER-2);
}
function fresh(RS) { return { v:1,season:RS.n,jobs:[],mounts:[],repairs:[],appliedGateSpent:[] }; }
function validateLedger(L,RS) {
  if (!keys(L,['v','season','jobs','mounts','repairs','appliedGateSpent']) || Object.keys(L).length !== 6
    || L.v !== 1 || !integer(L.season,1,RS.n) || !Array.isArray(L.jobs) || L.jobs.length > 38
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
  if (JSON.stringify(L).length > 65536) invalid();
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
function ledger(RS) {
  const L=RS.management.logistics;
  return L && L.season === RS.n ? validateLedger(L,RS) : fresh(RS);
}
function worldPoint(realm,along,lat=0) {
  const a=[150,270,30][realm]*Math.PI/180, dx=Math.sin(a), dz=-Math.cos(a);
  return {x:dx*along-dz*lat,z:dz*along+dx*lat};
}
function anchors(RS,keep,realm) {
  const home=RS.keeps[keep]?.home;
  if (!integer(home,0,2) || keep>=6) return null;
  const lat=keep%2===0?64:-64; // physical WAR.keeps order; the old RSM geometry lists each pair in reverse
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
const keeper = (actor,ctx) => actor?.actualKeeper === true && ctx.actualKeeper === true && text(actor.peer,128)
  && actor.peer===ctx.peer && same(actor.worldAdmission,ctx.worldAdmission) && actor.authority===ctx.authority;
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
function alive(r) {
  return !!r && r.alive!==false && r.alive!==0 && finite(r.hp===undefined?r.maxHp:r.hp,0,1e8)
    && (r.hp===undefined?r.maxHp:r.hp)>0 && !r.owner;
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
  trim(L);RS.management.logistics=L;RS.management.revision++;
  return {ok:true,message,revision:RS.management.revision,data};
}
function jobData(j) { return {jobId:j.id,lease:j.lease,season:j.season,realm:j.realm,keep:j.keep,load:{...j.cargo},escorts:j.escorts,state:j.state}; }
export function realmLogisticsApply(RS,actor,args,ctx={}) {
  const no=why=>({ok:false,why,revision:RS?.management?.revision||0});
  if (!validBase(RS) || !plain(args)) return no('The logistics command is invalid.');
  const op=args.op;
  const fields={
    'convoy.dispatch':['op','keep'],'convoy.adopt':['op','jobId'],'convoy.settle':['op','jobId','lease','outcome'],
    'mount.issue':['op','actorId'],'repair.issue':['op','keep','kind'],
  };
  if (!Object.hasOwn(fields,op) || !keys(args,fields[op])) return no('Choose an available logistics command.');
  const isKeeper=keeper(actor,ctx);
  if (op!=='repair.issue' && !isKeeper) return no('Only the current world keeper may settle NPC logistics.');
  const L=ledger(RS);
  if (op==='convoy.dispatch') {
    if (!integer(args.keep,0,RS.keeps.length-1)) return no('Choose a current keep.');
    const K=RS.keeps[args.keep], realm=K.h, R=RS.realms[realm], points=anchors(RS,args.keep,realm);
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
    if (row.mount) return no('That accepted NPC already has a mount.');
    const R=RS.realms[row.faction];
    if (L.mounts.length>=256||R.s[RAW.horses]<1) return no('The realm has no available horse grant.');
    const m={actorId:args.actorId,realm:row.faction,grantId:randomUUID(),at:RS.t};pay(R,{horses:1});L.mounts.push(m);
    return commit(RS,L,'One existing realm horse is issued.',{actorId:m.actorId,grantId:m.grantId,realm:m.realm});
  }
  const K=RS.keeps[args.keep], owner=K?.h;
  if (!integer(args.keep,0,RS.keeps.length-1)||!integer(owner,0,2)||!Object.hasOwn(REPAIR,args.kind)
    || !(isKeeper || actor?.ruler===true&&actor.realm===owner)) return no('Choose a keep held by your realm and an available repair.');
  const total=L.repairs.find(r=>r.keep===args.keep&&r.owner===owner&&r.kind===args.kind)?.totalUnits||0;
  const used=Math.min(total,spentRepair(RS,args.keep,owner,args.kind,ctx));
  if (total>=1e6||total-used>=2-1e-8||!canPay(RS.realms[owner],REPAIR[args.kind])) return no('Use the funded repair credit or supply the quoted materials first.');
  pay(RS.realms[owner],REPAIR[args.kind]);const grant=addRepair(L,args.keep,owner,args.kind,1);
  return commit(RS,L,'Finite repair work is funded.',{keep:args.keep,owner,kind:args.kind,totalUnits:grant.totalUnits,units:1});
}
export function realmLogisticsGateReport(RS,report,ctx={}) {
  const no=why=>({ok:false,gate:RS?.keeps?.[report?.keep]?.gate,why});
  if (!validBase(RS)||ctx.actualKeeper!==true||!integer(report?.keep,0,RS.keeps.length-1)||!finite(report.gate,0,1)) return no('The gate proof is invalid.');
  const K=RS.keeps[report.keep];
  if (report.owner!==K.h||report.gate<=K.gate) return no('Only an actual increase for the current holder uses repair credit.');
  const L=RS.management.logistics;
  if (!L||L.season!==RS.n) return no('No confirmed gate repair credit is available.');
  validateLedger(L,RS);
  const total=L.repairs.find(r=>r.keep===report.keep&&r.owner===K.h&&r.kind==='gate')?.totalUnits||0;
  let applied=L.appliedGateSpent.find(r=>r.keep===report.keep&&r.owner===K.h);
  const spent=Math.min(total,spentGate(RS,report.keep,K.h,ctx)),available=spent-(applied?.units||0);
  const delta=Math.min(report.gate-K.gate,available);
  if (!(delta>1e-9)) return no('Waiting for accepted paid physical repair progress.');
  if (!applied) {applied={keep:report.keep,owner:K.h,units:0};L.appliedGateSpent.push(applied);}
  applied.units+=delta;K.gate=Math.min(1,K.gate+delta);RS.management.revision++;
  return {ok:true,gate:K.gate};
}
export function realmLogisticsView(RS) {
  const base={v:1,season:RS?.n||0,revision:RS?.management?.revision||0,time:RS?.t||0,jobs:[],mounts:[],repairs:[]};
  if (!validBase(RS)) return base;
  const L=RS.management.logistics;
  if (!L||L.season!==RS.n) return {...base,quotes:{cargo:{...CARGO},escorts:2,horse:1,repairs:clone(REPAIR)}};
  validateLedger(L,RS);
  return {...base,jobs:L.jobs.map(j=>({...clone(j),from:anchors(RS,j.keep,j.realm)?.town,to:anchors(RS,j.keep,j.realm)?.gate})),
    mounts:clone(L.mounts),repairs:clone(L.repairs),quotes:{cargo:{...CARGO},escorts:2,horse:1,repairs:clone(REPAIR)}};
}
