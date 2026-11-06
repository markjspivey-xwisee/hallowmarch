/* Hosted public works projected into combat, paid repairs and field equipment.
 * Trusted season summaries enter through netsApply; only the admitted scene keeper changes bodies. */
const REALM_PUBLIC_WORKS = {
  source: null, ledger: null, pending: new Map(), retry: new Map(), recruiting: -1,
  visuals: new Map(), group: null, engineRows: [], engineViews: new Map(), reportClock: 0,
};
const realmPublicWorksClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : lo));
function realmPublicWorksAdmission() {
  try {
    const a = netCurrentWorldAdmission();
    return a && typeof a.origin === 'string' && a.origin.length <= 200 && Number.isSafeInteger(a.epoch) && a.epoch >= 0
      ? { origin: a.origin, epoch: a.epoch } : null;
  } catch (err) { return null; }
}
function realmPublicWorksSame(a, b) { return !!a && !!b && a.origin === b.origin && a.epoch === b.epoch && a.n === b.n; }
function realmPublicWorksHosted() {
  try { return !!NETWS.url && !!NETS.s?.management; } catch (err) { return false; }
}
function realmPublicWorksCurrent() {
  const s = REALM_PUBLIC_WORKS.source, a = realmPublicWorksAdmission();
  try { return s && a && s.scope.origin === a.origin && s.scope.epoch === a.epoch && NETS.s?.n === s.n ? s : null; }
  catch (err) { return null; }
}
function realmPublicWorksKeeper() {
  try { return GAME.started && realmPublicWorksCurrent() && netEntityCanSimulateWorld() && netWorldPartsCanSimulate(); }
  catch (err) { return false; }
}
function realmPublicWorksApply(value) {
  const a = realmPublicWorksAdmission();
  if (!a || !value || !Number.isSafeInteger(value.n) || value.n < 1 || !Number.isFinite(value.t) || value.t<0 || value.t>1e10
    || !Array.isArray(value.works) || value.works.length !== 3 || !Array.isArray(value.keeps) || value.keeps.length !== 6) return false;
  const scope = { ...a, n: value.n }, old = REALM_PUBLIC_WORKS.source;
  if (old && old.scope.origin === a.origin && old.scope.epoch === a.epoch
    && (value.n < old.n || value.n === old.n && value.t < old.t)) return false;
  const same = old && realmPublicWorksSame(old.scope, scope);
  const works = value.works.map((w, r) => Object.fromEntries([['r', r], ['hungry',realmPublicWorksClamp(w?.hungry,0,48)], ...['walls','granary','yard','smithy','engines'].map(k => {
    const max = k === 'walls' ? 3 : k === 'engines' ? 4 : 2;
    const next = Math.floor(realmPublicWorksClamp(w?.[k], 0, max));
    return [k, same && k !== 'engines' ? Math.max(next, old.works[r][k]) : next];
  })]));
  const keeps = value.keeps.map((k, i) => ({
    i, r: Number.isInteger(k?.r) && k.r >= 0 && k.r <= 2 ? k.r : -1,
    g: realmPublicWorksClamp(k?.g, 0, 40), gate: realmPublicWorksClamp(k?.gate, 0, 1), siege: !!k?.siege,
    defenseSupport: k?.defenseSupport === 0.1 ? 0.1 : 0,
    tier: Math.max(Math.floor(realmPublicWorksClamp(k?.tier, 0, 3)), same ? old.keeps[i].tier : 0),
  }));
  const funding=value.logistics||value.management?.logistics;
  const funded=funding?.scope?.origin===a.origin&&funding?.scope?.epoch===a.epoch;
  const repairs = (funded?(Array.isArray(value.repairs) ? value.repairs : funding?.repairs || []):[]).slice(0, 54)
    .filter(q => q && Number.isInteger(q.keep) && q.keep >= 0 && q.keep < 6 && Number.isInteger(q.owner) && q.owner >= 0 && q.owner < 3
      && ['wall','gate','tower'].includes(q.kind) && Number.isFinite(q.totalUnits) && q.totalUnits >= 0)
    .map(q => ({ keep:q.keep, owner:q.owner, kind:q.kind, totalUnits:Math.min(1e6,q.totalUnits) }));
  const houseRepairs=(funded?(Array.isArray(value.houseRepairs)?value.houseRepairs:funding?.houseRepairs||[]):[]).slice(0,64)
    .filter(q=>q&&Number.isInteger(q.house)&&q.house>=0&&q.house<256&&Number.isInteger(q.owner)&&q.owner>=0&&q.owner<3&&Number.isFinite(q.totalUnits)&&q.totalUnits>=0)
    .map(q=>({house:q.house,owner:q.owner,totalUnits:Math.min(1e6,q.totalUnits)}));
  REALM_PUBLIC_WORKS.source = { scope, n:value.n, t:value.t, phase:value.phase, works, keeps, repairs, houseRepairs,
    armyIds:Array.isArray(value.armyIds)?value.armyIds.filter(Number.isSafeInteger).slice(0,40):[],armyIdsComplete:value.armyIdsComplete===true };
  return true;
}
function realmPublicWorksLiving(K) {
  const ids = new Set([K.lord, ...K.guards]);
  return [...ids].map(getEnt).filter(e => e?.alive && !e.removed && e.faction === K.realm).length;
}
function realmPublicWorksAuthority() { try { return NET_ENTITIES.authority || ''; } catch (err) { return ''; } }
function realmPublicWorksLedger() {
  const s = realmPublicWorksCurrent();
  if (!s) return null;
  let l = REALM_PUBLIC_WORKS.ledger;
  if (!l || !realmPublicWorksSame(l.scope, s.scope)) {
    l = REALM_PUBLIC_WORKS.ledger = { v:1, scope:{...s.scope}, campaign:CAMPAIGN.n, keeps:[], spent:[], houseSpent:[], armies:[], seqs:[0,0,0,0,0,0] };
    REALM_PUBLIC_WORKS.pending.clear(); REALM_PUBLIC_WORKS.retry.clear(); REALM_PUBLIC_WORKS.engineRows=[];
  }
  if (l.campaign !== CAMPAIGN.n) {
    // A short battle is not a new native economy. Keep every paid highwater and unused credit.
    l.campaign = CAMPAIGN.n;
    for (const p of l.keeps) { const K=WAR.keeps[p.keep]; if(K&&K.realm===p.owner)p.observed=realmPublicWorksLiving(K); p.last=0; }
    REALM_PUBLIC_WORKS.engineRows=[];
  }
  if(s.armyIdsComplete && NETS.s?.armyIdsComplete===true){const live=new Set(s.armyIds.map(String));for(const wb of WAR.warbands)if(wb.season)live.add(String(wb.season.id));l.armies=l.armies.filter(p=>live.has(String(p.id)));}
  return l;
}
function realmPublicWorksRecord(K) {
  const s = realmPublicWorksCurrent(), l = realmPublicWorksLedger(), row = s?.keeps[K.id];
  if (!l || !row || row.r !== K.realm) return null;
  let p = l.keeps.find(q => q.keep === K.id);
  const alive = realmPublicWorksLiving(K);
  if (!p || p.owner !== K.realm) {
    const changed = !!p, fresh = (() => { try { return NET_ENTITIES.received < 0 && !NET_ENTITIES.published; } catch (err) { return false; } })();
    p = { keep:K.id, owner:K.realm, g:row.g, gate:row.gate, tier:row.tier, birth:changed || fresh ? Math.max(0,Math.min(7,Math.floor(row.g*7/8))-alive) : 0,
      gateWork:0, tierWork:0, observed:alive, loss:0, seq:l.seqs[K.id]||0, last:0, appliedGate:-1, pendingGate:row.gate, gatePaid:0, skipRise:0 };
    l.keeps = l.keeps.filter(q => q.keep !== K.id); l.keeps.push(p);
  }
  p.birth = Math.min(Math.max(0,7-alive), p.birth + Math.max(0,row.g-p.g)*7/8);
  const rise=Math.max(0,row.gate-p.gate), skip=Math.min(rise,p.skipRise||0);
  p.skipRise=Math.max(0,(p.skipRise||0)-skip); p.gateWork=Math.min(1,p.gateWork+rise-skip);
  if (p.appliedGate<0 || row.gate<p.appliedGate-1e-6) p.pendingGate=row.gate;
  p.appliedGate=row.gate;
  p.tierWork = Math.min(6,p.tierWork + Math.max(0,row.tier-p.tier));
  p.g = row.g; p.gate = row.gate; p.tier = row.tier;
  if (alive < p.observed) p.loss += (p.observed-alive)*8/7;
  p.observed = alive;
  return p;
}
function realmPublicWorksRecruiting(K) { return REALM_PUBLIC_WORKS.recruiting === K?.id && !!realmPublicWorksKeeper(); }
function realmPublicWorksRepairKind(kind) { return kind === 'gate' ? 'gate' : kind === 'tower' ? 'tower' : 'wall'; }
function realmPublicWorksRepairAvailable(K, kind) {
  if (!realmPublicWorksKeeper()) return 0;
  const s = realmPublicWorksCurrent(), l = realmPublicWorksLedger(), p = realmPublicWorksRecord(K);
  if (!s || !l || !p) return 0;
  const k = realmPublicWorksRepairKind(kind);
  const grant = s.repairs.filter(q => q.keep === K.id && q.owner === K.realm && q.kind === k).reduce((n,q)=>Math.max(n,q.totalUnits),0);
  const spent = l.spent.find(q => q.keep === K.id && q.owner === K.realm && q.kind === k)?.units || 0;
  return Math.max(0,grant-spent) + (k === 'gate' ? p.gateWork : p.tierWork);
}
function realmPublicWorksRepairWork(K, kind, dt, total) {
  if (!realmPublicWorksHosted()) return null;
  if (!realmPublicWorksKeeper() || !K || !Number.isFinite(dt) || !Number.isFinite(total) || !(dt > 0) || !(total > 0)) return 0;
  const l = realmPublicWorksLedger(), p = realmPublicWorksRecord(K), s = realmPublicWorksCurrent();
  if (!l || !p || !s || s.keeps[K.id]?.r !== K.realm) return 0;
  const k = realmPublicWorksRepairKind(kind), want = dt/total;
  const grant = s.repairs.filter(q => q.keep === K.id && q.owner === K.realm && q.kind === k).reduce((n,q)=>Math.max(n,q.totalUnits),0);
  let spent = l.spent.find(q => q.keep === K.id && q.owner === K.realm && q.kind === k);
  if (!spent) { spent={keep:K.id,owner:K.realm,kind:k,units:0}; l.spent.push(spent); }
  const paid = Math.min(want,Math.max(0,grant-spent.units)); spent.units += paid;
  if (k==='gate') p.gatePaid=(p.gatePaid||0)+paid;
  const field = k === 'gate' ? 'gateWork' : 'tierWork', extra = Math.min(want-paid,p[field]);
  p[field] -= extra;
  return Math.max(0,Math.min(1,(paid+extra)/want));
}
function realmPublicWorksMeta() {
  try { return {houses:HOUSES.filter(H=>!H.keepHall).slice(0,64).map(H=>({id:H.num,owner:H.realm,x:H.x,z:H.z,state:H.state}))}; }
  catch(err){return {houses:[]};}
}
function realmPublicWorksHouseWork(H,dt,total) {
  if(!realmPublicWorksHosted())return null;
  if(!realmPublicWorksKeeper()||!H||!Number.isFinite(dt)||!Number.isFinite(total)||dt<=0||total<=0)return 0;
  if(H.keepHall)return H.S?.keepRef?realmPublicWorksRepairWork(H.S.keepRef,'wall',dt,total):0;
  const source=realmPublicWorksCurrent(),ledger=realmPublicWorksLedger(),owner=H.realm;
  if(!Number.isInteger(H.num)||!Number.isInteger(owner)||owner<0||owner>2)return 0;
  const grant=source.houseRepairs.filter(p=>p.house===H.num&&p.owner===owner).reduce((v,p)=>Math.max(v,p.totalUnits),0);
  let spent=ledger.houseSpent.find(p=>p.house===H.num&&p.owner===owner);
  if(!spent){spent={house:H.num,owner,units:0};ledger.houseSpent.push(spent);}
  const want=dt/total,used=Math.min(want,Math.max(0,grant-spent.units));spent.units+=used;
  return Math.max(0,Math.min(1,used/want));
}
function realmPublicWorksKeepTick(K, dt) {
  if (!realmPublicWorksHosted()) return false;
  if (!realmPublicWorksKeeper()) return true;
  const s = realmPublicWorksCurrent(), row = s?.keeps[K.id], p = realmPublicWorksRecord(K);
  if (!p || !row || row.r !== K.realm) return true;
  const D = K.door, now = GAME.t;
  // A summary can lower damage state; only newly funded repair work may raise it.
  if (p.pendingGate!=null) {
    const limit=p.pendingGate; delete p.pendingGate;
    if (D.alive && D.maxHp>0 && D.hp/D.maxHp>limit+1e-6) {
      if (limit<=0) setDoorState(D,false,0); else D.hp=Math.min(D.hp,D.maxHp*limit);
    }
  }
  if (!REALM_PUBLIC_WORKS.pending.has(K.id) && now-K.lastEnemyNear > 40 && now-(D.lastHitAt || 0) > 25) {
    if (!D.alive && now-D.deadAt > 40 && realmPublicWorksRepairAvailable(K,'gate') >= 0.35-1e-8) {
      if (realmPublicWorksRepairWork(K,'gate',0.35,1) >= 1-1e-8) setDoorState(D,true,0.35);
    } else if (D.alive && D.hp < D.maxHp) {
      const gain=Math.min(Math.max(0,dt)*0.015,1-D.hp/D.maxHp);
      if (gain>0) D.hp=Math.min(D.maxHp,D.hp+D.maxHp*gain*realmPublicWorksRepairWork(K,'gate',gain,1));
    }
  }
  if (now>K.nextGuardAt && now-K.lastEnemyNear>12 && p.birth>=1 && realmPublicWorksLiving(K)<7) {
    K.nextGuardAt=now+14;
    const before=realmPublicWorksLiving(K); REALM_PUBLIC_WORKS.recruiting=K.id;
    try { war4Trickle(K); } finally { REALM_PUBLIC_WORKS.recruiting=-1; }
    const added=Math.max(0,realmPublicWorksLiving(K)-before);
    p.birth=Math.max(0,p.birth-added); p.observed=realmPublicWorksLiving(K);
  }
  p.last += Math.max(0,dt);
  if (p.last>=2) { p.last=0; realmPublicWorksBattleReport(K,p,row); }
  return true;
}
function realmPublicWorksConfirmedSpent(K,kind) {
  try {
    const serial=NETPARTS.key;
    if(!serial)return 0;
    const frame=JSON.parse(serial), part=frame.parts?.publicworks, scope=realmPublicWorksCurrent()?.scope;
    if(!part||!realmPublicWorksSame(part.scope,scope))return 0;
    return (part.spent||[]).filter(p=>p.keep===K.id&&p.owner===K.realm&&p.kind===kind)
      .reduce((n,p)=>Math.max(n,realmPublicWorksClamp(p.units,0,1e6)),0);
  } catch(err){return 0;}
}
function realmPublicWorksBattleReport(K,p,row) {
  if (typeof netRealmBattleReport !== 'function' || !realmPublicWorksKeeper()) return;
  const state=REALM_PUBLIC_WORKS, authority=realmPublicWorksAuthority(), now=GAME.t;
  let existing=state.pending.get(K.id);
  if(existing && (existing.authority!==authority || existing.body.owner!==K.realm || !realmPublicWorksSame(existing.scope,realmPublicWorksCurrent()?.scope))){
    state.pending.delete(K.id);if(existing.authority!==authority)p.loss=0;existing=null;
  }
  if (existing?.flight || now<(state.retry.get(K.id)||0)) return;
  const gate=K.door.alive && K.door.maxHp>0 ? realmPublicWorksClamp(K.door.hp/K.door.maxHp,0,1) : 0;
  const confirmed=realmPublicWorksConfirmedSpent(K,'gate');
  const paidRise=Math.min(Math.max(0,gate-row.gate),Math.max(0,confirmed-(p.gateSpendAck||0)));
  if (!existing && p.loss<=1e-8 && gate>=row.gate-1e-6 && paidRise<=1e-6) return;
  const s=realmPublicWorksCurrent(), l=realmPublicWorksLedger();
  if(!existing){l.seqs[K.id]=(l.seqs[K.id]||0)+1;p.seq=l.seqs[K.id];}
  const item=existing || { authority, scope:{...s.scope}, p, loss:p.loss, gateSpent:confirmed, rise:paidRise,
    body:{n:s.n,keep:K.id,owner:K.realm,g:Math.max(0,row.g-p.loss),gate:gate<row.gate?gate:row.gate+paidRise,seq:p.seq} };
  if(!existing)p.skipRise=(p.skipRise||0)+paidRise;
  state.pending.set(K.id,item); item.flight=true; state.retry.set(K.id,now+5);
  Promise.resolve(netRealmBattleReport(item.body)).then(ack=>{
    item.flight=false;
    if (state.pending.get(K.id)!==item || authority!==realmPublicWorksAuthority()
      || !realmPublicWorksSame(item.scope,realmPublicWorksCurrent()?.scope) || item.body.owner!==K.realm) return;
    if (ack?.ok) {
      p.loss=Math.max(0,p.loss-item.loss); p.gateSpendAck=Math.max(p.gateSpendAck||0,item.gateSpent||0);
      const current=realmPublicWorksCurrent(), live=current?.keeps[K.id];
      if(live?.r===K.realm && Number.isFinite(ack.t) && ack.t>=current.t){if(Number.isFinite(ack.g))live.g=realmPublicWorksClamp(ack.g,0,40);if(Number.isFinite(ack.gate))live.gate=realmPublicWorksClamp(ack.gate,0,1);}
      state.pending.delete(K.id); state.retry.delete(K.id);
    }
  }).catch(()=>{item.flight=false;});
}
function realmPublicWorksUnitQuality(e) {
  if (!e || !['soldier','guard','lord','muster'].includes(e.role) || e.bot || e.netCompanion || e.netEntityOwner
    || !Number.isInteger(e.faction) || e.faction<0 || e.faction>2) return 1;
  const s=realmPublicWorksCurrent(); if (!s) return 1;
  const band=e.warband?.season;
  if (band && Number.isFinite(band.arm) && (band.publicWorksSeason===s.n || band.season===s.n)) return realmPublicWorksClamp(band.arm,1,1.24);
  return 1+0.12*s.works[e.faction].smithy;
}
function realmPublicWorksHungerK(e) {
  const s=realmPublicWorksCurrent();if(!realmPublicWorksHosted()||!s)return null;
  if(!e||!['soldier','guard','lord','muster'].includes(e.role)||e.bot||e.netCompanion||e.netEntityOwner||!Number.isInteger(e.faction)||e.faction<0||e.faction>2)return 1;
  const band=e.warband?.season;
  return (band ? band.hungry===true || band.hungry===1 || band.hungry==null&&e.lHungry>GAME.t : s.works[e.faction].hungry>2) ? 0.88 : 1;
}
function realmPublicWorksAttackK(e) {
  let support = 0;
  const K = e?.keep;
  if (K && ['guard', 'lord'].includes(e.role) && !e.bot && !e.netCompanion && !e.netEntityOwner && e.faction === K.realm) {
    if (realmPublicWorksHosted()) {
      const row = realmPublicWorksCurrent()?.keeps[K.id];
      if (row?.r === K.realm) support = row.defenseSupport === 0.1 ? 0.1 : 0;
    } else if (typeof seasonKeepDefenseSupport === 'function') support = seasonKeepDefenseSupport(K);
  }
  return Math.sqrt(realmPublicWorksUnitQuality(e)) * (1 + support);
}
function realmPublicWorksArmorK(e) { return 1/Math.sqrt(realmPublicWorksUnitQuality(e)); }
function realmPublicWorksVisual(e, mask, armor) {
  const q=realmPublicWorksUnitQuality(e), tier=Math.round((q-1)/0.12);
  if (!tier) return;
  if (e.role!=='lord') mask[1]=(mask[1]&~(WB.hood||0))|WB.helmet;
  if (tier>=2) mask[1]|=WB.pauldron;
  const c=tier>=2?0.6:0.48; armor[0]=Math.max(armor[0],c*0.96); armor[1]=Math.max(armor[1],c); armor[2]=Math.max(armor[2],c*1.05);
}
function realmPublicWorksGateK(door) {
  const s=realmPublicWorksCurrent(), K=door?.keepRef, q=K&&s?.keeps[K.id];
  return q && q.r===K.realm ? 1/(1+0.25*q.tier) : 1;
}
function realmPublicWorksKeepsHeld() { return realmPublicWorksHosted() && !!realmPublicWorksCurrent(); }
function realmPublicWorksKeepStays(K) {
  const s=realmPublicWorksCurrent(); return !!s && s.keeps[K.id]?.r===K.realm && K.realm!==K.orig;
}
function realmPublicWorksAfterReset() {
  if (!realmPublicWorksKeeper()) return;
  // Normal netsApply owns changed canonical holders. A cached telling must not undo a newer live conquest.
  realmPublicWorksLedger();
}
function realmPublicWorksArmy(wb,a) {
  if (!realmPublicWorksKeeper() || !wb?.season || !a || !Number.isInteger(wb.realm)) return;
  const s=realmPublicWorksCurrent(), stamp=String(a.id);
  const data=wb.season, same=data.publicWorksArmy===stamp && data.publicWorksSeason===s.n && data.publicWorksCampaign===CAMPAIGN.n;
  data.publicWorksArmy=stamp; data.publicWorksSeason=s.n; data.publicWorksCampaign=CAMPAIGN.n;
  data.arm=realmPublicWorksClamp(a.arm,1,1.24); data.hungry=!!a.hungry; data.eng=Math.floor(realmPublicWorksClamp(a.eng,0,4));
  const ledger=realmPublicWorksLedger();let paid=ledger.armies.find(p=>String(p.id)===stamp);
  if(!paid&&ledger.armies.length<128){paid={id:stamp,spent:0};ledger.armies.push(paid);}
  const prior=same?Math.floor(realmPublicWorksClamp(data.publicWorksEngSpent,0,4)):0;
  data.publicWorksEngSpent=Math.max(prior,paid?.spent||0);if(paid)paid.spent=data.publicWorksEngSpent;
  if(!paid)data.publicWorksEngSpent=data.eng;
}
function realmPublicWorksEngineKind(wb,kind) {
  if (!realmPublicWorksHosted()) return null;
  if (!realmPublicWorksKeeper() || !wb?.season || !['ram','mangonel','trebuchet'].includes(kind)) return false;
  const s=realmPublicWorksCurrent(), p=wb.season;
  if (p.publicWorksSeason!==s.n || p.publicWorksCampaign!==CAMPAIGN.n || Math.floor(realmPublicWorksClamp(p.publicWorksEngSpent,0,4))>=Math.floor(realmPublicWorksClamp(p.eng,0,4))) return false;
  return kind;
}
function realmPublicWorksEngineBuilt(wb,E) {
  if (!realmPublicWorksHosted()) return true;
  if (!E || E.realm!==wb?.realm || !realmPublicWorksEngineKind(wb,E.kind)) return false;
  wb.season.publicWorksEngSpent=Math.floor(realmPublicWorksClamp(wb.season.publicWorksEngSpent,0,4))+1;
  const paid=realmPublicWorksLedger().armies.find(p=>String(p.id)===wb.season.publicWorksArmy);if(paid)paid.spent=wb.season.publicWorksEngSpent;
  E.publicWorks={scope:{...realmPublicWorksCurrent().scope},army:wb.season.publicWorksArmy};
  return true;
}
function realmPublicWorksFrame() {
  if (!realmPublicWorksCurrent()) { realmPublicWorksClearVisuals(); return; }
  if (realmPublicWorksKeeper()) {
    realmPublicWorksRestoreEngines();
    for (const wb of WAR.warbands) if (wb.season && (!wb.season.publicWorksArmy || wb.season.publicWorksCampaign!==CAMPAIGN.n)) realmPublicWorksArmy(wb,wb.season);
  }
  realmPublicWorksDraw(); realmPublicWorksEngineViews();
}
function realmPublicWorksSave() {
  const l=REALM_PUBLIC_WORKS.ledger;
  return l ? {v:1,scope:{...l.scope},campaign:l.campaign,keeps:l.keeps.map(p=>({...p})),spent:l.spent.map(p=>({...p})),houseSpent:l.houseSpent.map(p=>({...p})),armies:l.armies.map(p=>({...p})),seqs:[...l.seqs],engines:realmPublicWorksSaveEngines()} : null;
}
function realmPublicWorksLoad(value) {
  if (!value || value.v!==1 || !value.scope || typeof value.scope.origin!=='string' || !Number.isSafeInteger(value.scope.epoch)
    || !Number.isSafeInteger(value.scope.n)) { REALM_PUBLIC_WORKS.ledger=null; return; }
  const keeps=(Array.isArray(value.keeps)?value.keeps:[]).slice(0,6).filter(p=>Number.isInteger(p?.keep)&&p.keep>=0&&p.keep<6&&Number.isInteger(p.owner)&&p.owner>=0&&p.owner<3).map(p=>({
    keep:p.keep,owner:p.owner,g:realmPublicWorksClamp(p.g,0,40),gate:realmPublicWorksClamp(p.gate,0,1),tier:Math.floor(realmPublicWorksClamp(p.tier,0,3)),
    birth:realmPublicWorksClamp(p.birth,0,7),gateWork:realmPublicWorksClamp(p.gateWork,0,1),tierWork:realmPublicWorksClamp(p.tierWork,0,6),
    observed:Math.floor(realmPublicWorksClamp(p.observed,0,7)),loss:realmPublicWorksClamp(p.loss,0,40),seq:Math.floor(realmPublicWorksClamp(p.seq,0,1e9)),last:0,
    appliedGate:realmPublicWorksClamp(p.appliedGate??p.gate,0,1),...(p.pendingGate!=null?{pendingGate:realmPublicWorksClamp(p.pendingGate,0,1)}:{}),
    gatePaid:realmPublicWorksClamp(p.gatePaid,0,1e6),skipRise:realmPublicWorksClamp(p.skipRise,0,1),gateSpendAck:realmPublicWorksClamp(p.gateSpendAck,0,1e6),
  }));
  const spent=(Array.isArray(value.spent)?value.spent:[]).slice(0,54).filter(p=>Number.isInteger(p?.keep)&&p.keep>=0&&p.keep<6&&Number.isInteger(p.owner)&&p.owner>=0&&p.owner<3&&['wall','gate','tower'].includes(p.kind))
    .map(p=>({keep:p.keep,owner:p.owner,kind:p.kind,units:realmPublicWorksClamp(p.units,0,1e6)}));
  const houseSpent=(Array.isArray(value.houseSpent)?value.houseSpent:[]).slice(0,64).filter(p=>Number.isInteger(p?.house)&&p.house>=0&&p.house<256&&Number.isInteger(p.owner)&&p.owner>=0&&p.owner<3)
    .map(p=>({house:p.house,owner:p.owner,units:realmPublicWorksClamp(p.units,0,1e6)}));
  REALM_PUBLIC_WORKS.ledger={v:1,scope:{origin:value.scope.origin.slice(0,200),epoch:value.scope.epoch,n:value.scope.n},campaign:Math.floor(realmPublicWorksClamp(value.campaign,1,1e9)),keeps,spent,houseSpent,armies:(Array.isArray(value.armies)?value.armies:[]).slice(0,128).filter(p=>p&&/^\d{1,12}$/.test(String(p.id))).map(p=>({id:String(p.id),spent:Math.floor(realmPublicWorksClamp(p.spent,0,4))})),
    seqs:Array.from({length:6},(_,i)=>Math.max(Math.floor(realmPublicWorksClamp(value.seqs?.[i],0,1e9)),keeps.find(p=>p.keep===i)?.seq||0))};
  REALM_PUBLIC_WORKS.engineRows=realmPublicWorksReadEngines(value.engines);
  REALM_PUBLIC_WORKS.pending.clear(); REALM_PUBLIC_WORKS.retry.clear();
}
registerSavePart('world','publicworks',{save:realmPublicWorksSave,load:realmPublicWorksLoad,key:d=>d});
function realmPublicWorksReadEngines(value) {
  return (Array.isArray(value)?value:[]).slice(0,8).filter(p=>p&&typeof p.id==='string'&&p.id.length<=80&&['ram','mangonel','trebuchet'].includes(p.kind)
    &&Number.isInteger(p.realm)&&p.realm>=0&&p.realm<3&&[p.x,p.z,p.yaw,p.build,p.workX,p.workZ].every(Number.isFinite)
    &&Math.abs(p.x)<1024&&Math.abs(p.z)<1024&&Math.abs(p.workX)<1024&&Math.abs(p.workZ)<1024)
    .map(p=>({id:p.id,kind:p.kind,realm:p.realm,army:String(p.army||'').slice(0,32),wb:Number.isSafeInteger(p.wb)?p.wb:null,
      keep:Number.isInteger(p.keep)&&p.keep>=0&&p.keep<6?p.keep:null,temple:Number.isInteger(p.temple)&&p.temple>=0&&p.temple<3?p.temple:null,
      wall:Number.isInteger(p.wall)&&p.wall>=0&&p.wall<32?p.wall:null,gate:!!p.gate,x:p.x,z:p.z,yaw:p.yaw,
      build:realmPublicWorksClamp(p.build,0,1),state:['build','move','work','idle','burning'].includes(p.state)?p.state:'build',
      burn:realmPublicWorksClamp(p.burn,0,1),workX:p.workX,workZ:p.workZ,
      crew:(Array.isArray(p.crew)?p.crew:[]).filter(id=>typeof id==='string'&&id.length<=80).slice(0,6)}));
}
function realmPublicWorksSaveEngines() {
  if(!realmPublicWorksKeeper()||typeof SIEGE==='undefined')return REALM_PUBLIC_WORKS.engineRows.map(p=>({...p,crew:[...p.crew]}));
  const scope=realmPublicWorksCurrent().scope;
  const rows=SIEGE.engines.filter(E=>!E.gone&&E.ent?.alive&&E.ent.netEntityId&&realmPublicWorksSame(E.publicWorks?.scope,scope)).slice(0,8).map(E=>({
    id:E.ent.netEntityId,kind:E.kind,realm:E.realm,army:E.publicWorks.army,wb:E.wb?.id??null,
    keep:E.target?.C?.S?.keepRef?.id??null,temple:E.target?.C?.S?.templeRef?.id??null,
    wall:E.target?.W?.k??null,gate:!!E.target?.gate,x:E.x,z:E.z,yaw:E.yaw,build:E.build,state:E.state,burn:E.burn,
    workX:E.work.x,workZ:E.work.z,crew:E.crew.map(getEnt).map(e=>e?.netEntityId).filter(Boolean),
  }));
  // A promoted keeper can serialize before its first frame restores the accepted engines.
  const ids=new Set(rows.map(p=>p.id));
  for(const row of REALM_PUBLIC_WORKS.engineRows)if(!ids.has(row.id)&&rows.length<8){const e=netEntityFind(row.id);if(e?.alive&&!e.removed)rows.push({...row,crew:[...row.crew]});}
  return rows;
}
function realmPublicWorksRestoreEngines() {
  if(!realmPublicWorksKeeper()||typeof siegeCreate!=='function')return;
  const scope=realmPublicWorksCurrent().scope,ledger=REALM_PUBLIC_WORKS.ledger;
  if(!ledger||!realmPublicWorksSame(ledger.scope,scope)||ledger.campaign!==CAMPAIGN.n)return;
  for(const row of REALM_PUBLIC_WORKS.engineRows){
    const actor=netEntityFind(row.id);
    if(!actor?.alive||actor.removed||actor.role!=='engine'||actor.faction!==row.realm||actor.netEntityOwner)continue;
    const existing=SIEGE.engines.find(E=>!E.gone&&E.ent?.netEntityId===row.id);
    if(existing){if(existing.ent!==actor){removeEnt(existing.ent);existing.ent=actor;actor.siegeEngine=existing.id;existing.lastHp=actor.hp;}continue;}
    if(siegeCountOf()>=SIEGE_MAX())continue;
    const site=row.keep!=null?WAR.keeps[row.keep]?.site:row.temple!=null?WAR.temples[row.temple]?.site:null,C=site&&castleOf(site);
    if(!C)continue;
    const W=row.wall!=null?C.sections?.find(w=>w.k===row.wall):null,target=W?{C,W}:{C,gate:true};
    const E=siegeCreate(row.kind,row.realm,actor.x,actor.z,row.yaw,target,{x:row.workX,z:row.workZ});
    const temporary=E.ent;E.ent=actor;removeEnt(temporary);actor.siegeEngine=E.id;E.lastHp=actor.hp;
    E.build=row.build;E.burn=row.burn;E.state=row.state;E.ph=E.kind==='ram'?'pull':'wind';E.pt=0;E.loaded=false;
    E.publicWorks={scope:{...scope},army:row.army};E.wb=WAR.warbands.find(w=>w.id===row.wb&&w.realm===row.realm)||null;
    for(const id of row.crew){const e=netEntityFind(id);if(e?.alive&&!e.removed&&e.faction===row.realm&&!e.netEntityOwner&&!e.siegeCrew)siegeAddCrew(E,e,E.crew.length);}
    if(E.wb?.order&&siegeBandOn(E.wb,E))E.wb.order.siegeE=E.id;
    if(E.build>=1&&E.state!=='move'&&E.state!=='burning')siegeSettle(E);
    siegePose(E,0);
  }
}
function realmPublicWorksEngineViews() {
  if(!GAME.started)return;
  const state=REALM_PUBLIC_WORKS,keeper=realmPublicWorksKeeper(),seen=new Set();
  for(const row of state.engineRows){
    const actor=typeof netEntityFind==='function'?netEntityFind(row.id):null;
    if(keeper||!actor?.alive||actor.removed||actor.faction!==row.realm
      || typeof netEntityVisible==='function'&&!netEntityVisible(actor))continue;
    const wb=WAR.warbands.find(w=>w.id===row.wb);
    if(typeof THRONE_RTS!=='undefined'&&THRONE_RTS.active&&row.realm!==GAME.player?.faction
      &&(wb?!cwSpotted(wb,GAME.player):Math.hypot(actor.x-GAME.player.x,actor.z-GAME.player.z)>100))continue;
    seen.add(row.id);let view=state.engineViews.get(row.id);
    if(!view){
      const parts=siegeParts(row.kind,row.realm),root=new THREE.Group(),meshes=[];
      for(const [kind,g] of [['base',parts.base],['upper',parts.upper],['arm',row.kind==='ram'?parts.log:parts.arm]]){
        if(!g)continue;const mesh=new THREE.Mesh(g,buildingMat);mesh.renderOrder=1;root.add(mesh);meshes.push({kind,mesh});
      }
      if(row.kind==='mangonel'){const arm=meshes.find(m=>m.kind==='arm');if(arm)arm.mesh.rotation.x=MANG_REST-Math.PI/2;}
      if(row.kind==='ram'){const arm=meshes.find(m=>m.kind==='arm');if(arm)arm.mesh.position.set(0,RAM_PIVOT_Y-RAM_ROPE,RAM_LOG_Z);}
      scene.add(root);view={root,meshes};state.engineViews.set(row.id,view);
    }
    view.root.position.set(actor.x,actor.y,actor.z);view.root.rotation.y=row.yaw;
    for(const part of view.meshes)part.mesh.visible=row.state!=='build'||row.build>(part.kind==='base'?.02:part.kind==='upper'?.35:.65);
  }
  for(const [id,view]of state.engineViews)if(!seen.has(id)){view.root.removeFromParent();view.root.clear();state.engineViews.delete(id);}
}
function realmPublicWorksDraw() {
  const state=REALM_PUBLIC_WORKS, s=realmPublicWorksCurrent();
  if (!s || !GAME.started || typeof Batch!=='function') return;
  if (!state.group) {state.group=new THREE.Group();state.group.name='canonical-public-works';scene.add(state.group);}
  const put=(id,key,b)=>{
    const old=state.visuals.get(id); if(old?.key===key)return;
    if(old){old.mesh.removeFromParent();old.mesh.geometry.dispose();state.visuals.delete(id);}
    const batch=b();if(!batch?.n)return;
    const mesh=new THREE.Mesh(batch.build(),buildingMat);mesh.name=id;mesh.renderOrder=1;state.group.add(mesh);state.visuals.set(id,{key,mesh});
  };
  for(const K of WAR.keeps){
    const row=s.keeps[K.id], C=castleOf(K.site), tier=row?.r===K.realm?row.tier:0;
    const key=[tier,K.realm,!!K.door.alive,...(C?.sections||[]).map(W=>W.state)].join(':');
    put('public-walls-'+K.id,key,()=>{
      const b=new Batch();if(!tier||!C)return b;
      const stone=STYLE[REALMS[K.orig].style].stone, metal=[0.53,0.57,0.61];
      for(const W of C.sections||[]){if(W.state!=='whole')continue;
        const yaw=Math.atan2(W.ax,W.az), x=W.lx+W.az*Math.max(0,W.across-0.2), z=W.lz-W.ax*Math.max(0,W.across-0.2);
        b.add(G.box,lm(C.M,x,W.top+0.12,z,yaw,0.28+0.06*tier,0.24,2*W.half),MAT.stone,stone,K.site.y);
        const n=Math.min(8,Math.max(2,Math.floor(2*W.half/2.2)));
        for(let i=0;i<n;i++){const at=-W.half+(i+0.5)*2*W.half/n;b.add(G.box,lm(C.M,x+W.ax*at,W.top+0.28+0.13*tier,z+W.az*at,yaw,0.46,0.3+0.2*tier,0.65),MAT.stone,stone,K.site.y);}
      }
      if(K.door.alive)for(let j=0;j<tier;j++)b.add(G.box,lm(siteMatrix(K.site),0,1.3+j*0.95,K.site.gateLocal.z+0.12,0,4,0.17,0.14),MAT.metal,metal,K.site.y);
      return b;
    });
  }
  for(let r=0;r<3;r++){
    const w=s.works[r], Y=REALMS[r].lyard;
    put('public-yard-'+r,JSON.stringify([w,Y?.x,Y?.z]),()=>{
      const b=new Batch();if(!Y)return b;
      const M=siteMatrix({x:Y.x,y:heightAt(Y.x,Y.z),z:Y.z,yaw:Y.yaw}), wood=STYLE[REALMS[r].style].wood, iron=[0.45,0.5,0.54], cloth=[0.7,0.61,0.39];
      if(w.granary){const h=2.8+w.granary*0.5;for(const x of[1.2,3.6])for(const z of[-2,2])b.add(G.box,lm(M,x,h/2,z,0,0.13,h,0.13),MAT.wood,wood);
        b.add(G.prism,lm(M,2.4,h,0,Math.PI/2,4.5,0.7,3),MAT.thatch,cloth);}
      if(w.yard){for(let i=0;i<w.yard+1;i++){b.add(G.cyl8,lm(M,-3.2,0.75,-1.8+i*1.3,0,0.12,1.5,0.12),MAT.wood,wood);b.add(G.box,lm(M,-3.2,0.9,-1.2+i*1.3,0,0.12,0.12,1.4),MAT.wood,wood);}}
      if(w.smithy){b.add(G.box,lm(M,0.4,1.05,2.55,0,0.55,0.7,0.55),MAT.stone,[0.5,0.5,0.48]);b.add(G.box,lm(M,0.4,1.5,2.55,0,1.4,0.25,0.6),MAT.metal,iron);}
      for(let i=0;i<w.engines;i++){const z=-2.1+i*1.3;b.add(G.cyl12,lm(M,-1.1,1.3,z,0,0.65,0.15,0.65,Math.PI/2),MAT.wood,wood);b.add(G.box,lm(M,-1.6,1.6,z,0,1.9,0.17,0.2),MAT.wood,wood);}
      return b;
    });
  }
}
function realmPublicWorksClearVisuals() {
  const s=REALM_PUBLIC_WORKS;
  for(const {mesh} of s.visuals.values()){mesh.removeFromParent();mesh.geometry.dispose();}
  s.visuals.clear();for(const v of s.engineViews.values()){v.root.removeFromParent();v.root.clear();}s.engineViews.clear();if(s.group){s.group.removeFromParent();s.group.clear();s.group=null;}
}
function realmPublicWorksReset(){realmPublicWorksClearVisuals();REALM_PUBLIC_WORKS.source=null;REALM_PUBLIC_WORKS.ledger=null;REALM_PUBLIC_WORKS.pending.clear();REALM_PUBLIC_WORKS.retry.clear();REALM_PUBLIC_WORKS.recruiting=-1;REALM_PUBLIC_WORKS.engineRows=[];}
