// [season2] The season felt in the field (version 20). The season's armies (RS, 08m_realm.js) are numbers on the
// strategic map: an army marching or laying siege near the player is brought onto the live war as a band of its realm
// (`wb.season`), its number scaled to the live war's bands, its order the season's (an offensive or an assault on its
// keep, a raid on a muster's fields), drawn on the map with the season's pennant and told on the war panel. What becomes
// of it is told back: its soldiers left, how far it has come, its siege laid, the keep taken, beaten off or fallen; out of
// sight and far again it is folded back into RS where it stands. Never two of one army: while it is on the field RS holds
// it (A.onField) and steps it no further.
//   Alone the page takes its armies from its own RS (SEASONP.rs); linked to the March's server, the server hands an army
//   to the page that keeps its region (14p_netws.js: `sarmy`) and the page tells it back (`sarmyrep`); with no keeper
//   there the server's RS resolves it by the numbers as before.
// An offensive's day is a battle a player can join: its army marches from the realm's muster on its day (08m_realm.js
// rsmOffensives), the war panel and the Season page count it down and say where, the herald says it, a field note
// tells a player of the realm attacked or attacking, and its band comes onto the field near you.

const S2 = {
  pendingArmy: null, inventoryBusy: false, inventorySummary: null, inventoryBands: null,
  fieldSeen: [], // recently settled/folded grants; duplicate transport never creates a second cohort
  bands: new Map(), // army id -> { wb, a (the army's description), mode: 'page'|'server', per, said, lost, at }
  t: 0, seen: [], max: 3,
  reach: 260,       // an army within this of the player comes onto the field...
  reachK: 150,      // ...or one marching on (or at) a keep the player stands within this of
  fold: 380,        // folded back once every soldier is this far from the player and the player is not by its keep
  scale: 0.42, minN: 3, maxN: 12, maxOff: 14, // RS's soldiers to the live war's: at least 3, at most 12 (an offensive 14)
  stats: { taken: 0, folded: 0, fallen: 0, won: 0, beaten: 0, raided: 0, reports: 0, declined: 0, reissued: 0, released: 0, applied: 0 },
};
const s2Server = () => typeof NETWS !== 'undefined' && !!NETWS.url;
// Canonical hosted cohorts have already been recruited and paid for in RS.
const season2CanonicalWar = () => s2Server() && (typeof NETS === 'undefined' || !NETS.s || NETS.s.management?.v === 1);
function season2StrategicArmies() {
  if (!season2CanonicalWar() || typeof NETS === 'undefined' || !NETS.s) return [];
  const realm = GAME.player?.faction;
  return (NETS.s.armies || []).filter(a => a.r === realm).map(a => ({ ...a }));
}
function s2View() {
  const p = typeof netRealmViewInterest === 'function' ? netRealmViewInterest() : null;
  return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z, radius: clamp(p.radius || 220, 40, S2.reach) } : null;
}
const s2Keeper = (pendingArmy = null) => {
  const previous = S2.pendingArmy;
  if (Number.isSafeInteger(pendingArmy) && pendingArmy > 0) S2.pendingArmy = pendingArmy;
  try { return !s2Server() || typeof netEntityCanSimulateWorld !== 'function' || netEntityCanSimulateWorld(); }
  finally { S2.pendingArmy = previous; }
};
function s2GrantKey(a) { return a.season + ':' + a.id + ':' + a.fieldLease; }
function s2Remember(a) {
  if (!a.fieldLease) return;
  const key = s2GrantKey(a);
  if (!S2.fieldSeen.includes(key)) S2.fieldSeen.push(key);
  if (S2.fieldSeen.length > 64) S2.fieldSeen.splice(0, S2.fieldSeen.length - 64);
}

// where an army stands in the world: on the road from its muster to its mark, or before its keep's gate at a siege
function s2Target(a) {
  if (a.k >= 0 && WAR.keeps[a.k]) return WAR.keeps[a.k].site;
  if (a.q >= 0 && REALMS[a.q]) return a.kind === 'hallow' && WAR.temples[a.q] ? WAR.temples[a.q].site : REALMS[a.q].musterSite;
  return REALMS[a.r].musterSite;
}
function s2Pos(a) {
  if (a.manual && Number.isFinite(a.fx) && Number.isFinite(a.fz)) return { x: a.fx, z: a.fz };
  const M = REALMS[a.r].musterSite, T = s2Target(a);
  if (a.state === 'siege' && a.k >= 0) {
    const g = siegeGatePoint(T);
    return { x: g.x + g.nx * 30, z: g.z + g.nz * 30 };
  }
  const p = clamp(a.p || 0, 0, 1);
  return { x: M.x + (T.x - M.x) * p, z: M.z + (T.z - M.z) * p };
}
// a place a body may stand near (x, z): walkable, out of colliders
function s2Spot(x, z) {
  for (let r = 0; r <= 36; r += 3) {
    for (let i = 0; i < (r ? 10 : 1); i++) {
      const a = (i / 10) * TAU + r * 0.37, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (isWalkable(px, pz) && !look5InColl(px, pz, 0.6)) return { x: px, z: pz };
    }
  }
  return null;
}
function s2Near(a, P) {
  if (!P || !P.alive || inDungeon(P)) return false;
  const q = s2Pos(a), view = s2View();
  if (view && (dist(view.x, view.z, q.x, q.z) <= view.radius || (a.k >= 0 && WAR.keeps[a.k] && dist(view.x, view.z, WAR.keeps[a.k].site.x, WAR.keeps[a.k].site.z) < S2.reachK))) return true;
  if (dist(P.x, P.z, q.x, q.z) < S2.reach) return true;
  if (a.k >= 0 && WAR.keeps[a.k]) { const s = WAR.keeps[a.k].site; if (dist(P.x, P.z, s.x, s.z) < S2.reachK) return true; }
  return false;
}
// the live war's size for an army of n
const s2Size = (a) => clamp(Math.round(a.n * S2.scale), S2.minN, a.off ? S2.maxOff : S2.maxN);
// may this army come onto the field now?
function s2Fits(a) {
  if (CAMPAIGN.state !== 'war' || a.n < 1) return false;
  if (a.kind === 'hallow') return false; // (a hallow raid stays by the numbers: the hallows are the live war's own)
  if ((a.kind === 'assault' || a.kind === 'offensive') && !(a.k >= 0 && WAR.keeps[a.k])) return false;
  if (a.kind === 'raid' && !(a.q >= 0 && REALMS[a.q])) return false;
  return true;
}
// the season's order for its band
function s2Order(B) {
  const a = B.a;
  if (a.kind === 'raid') return { type: 'patrol', node: REALMS[a.q].nav.muster, until: GAME.t + 1e6, why: 'season' };
  const K = WAR.keeps[a.k];
  if (a.manual && a.mission !== 'attack') return K && K.realm === a.r ? { type: 'defend', keep: K, since: GAME.t, why: 'ruler' } : { type: 'patrol', node: REALMS[a.r].nav.muster, until: GAME.t + 1e6, why: 'ruler' };
  return { type: 'attack', keep: K, why: a.off ? 'offensive' : K.orig === a.r ? 'retake' : 'season' };
}
// an army onto the field: a band of its realm where the army stands
function s2Spawn(a, mode) {
  if (S2.bands.has(a.id)) return S2.bands.get(a.id);
  if (mode === 'server' && !s2Keeper(a.id)) return null;
  if (mode === 'server') s2Reconcile(a.id);
  // A promoted keeper adopts the replicated cohort; it never mints another set of the same soldiers.
  const existing = mode === 'server' && WAR.warbands.find(w => !w.dead && w.realm === a.r && w.season?.id === a.id
    && (!w.season.season || w.season.season === a.season) && wbMembers(w).length);
  if (existing) {
    const count = wbMembers(existing).length, old = existing.season;
    const per = Math.min(Number.isFinite(old.per) && old.per > 0 ? old.per : a.n / count, a.n / count);
    existing.season = { ...old, arm: a.arm || 1, eng: a.eng || 0, season: a.season, fieldLease: a.fieldLease, per };
    const B = { wb: existing, a, mode, per, said: false, lost: 0, at: GAME.t, n0: old.renderN || count, campaign: CAMPAIGN.n, rep: 0 };
    S2.bands.set(a.id, B);
    if (typeof realmPublicWorksArmy === 'function') realmPublicWorksArmy(existing, a);
    return B;
  }
  const q = s2Pos(a), c = s2Spot(q.x, q.z);
  if (!c) return null;
  const n = s2Size(a);
  const wb = { id: WAR.nextWb++, realm: a.r, members: [], order: null, path: null, pathIdx: 0, created: GAME.t, engagedUntil: -99, lastProgress: GAME.t, progX: c.x, progZ: c.z, season: { id: a.id, kind: a.kind, n0: a.n, manual: a.manual === true, arm: a.arm || 1, eng: a.eng || 0, per: a.n / n, renderN: n, season: a.season || 0, fieldLease: a.fieldLease || '' } };
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU, rr = 2 + (i % 3) * 1.6;
    const s = s2Spot(c.x + Math.cos(ang) * rr, c.z + Math.sin(ang) * rr) || c;
    const e = spawnRealmUnit(a.r, WB_CLASSES[i % WB_CLASSES.length], warUnitLevel('soldier'), 'soldier', s.x, s.z);
    e.warband = wb;
    if (a.hungry) e.lHungry = GAME.t + 1e6; // [loops] the army came hungry (08m_loops.js: its blows softer)
    wb.members.push(e.id);
  }
  WAR.warbands.push(wb);
  wbOrd(wb);
  const B = { wb, a, mode, per: a.n / n, said: false, lost: 0, at: GAME.t, n0: n, campaign: CAMPAIGN.n, rep: 0 };
  S2.bands.set(a.id, B);
  if (typeof realmPublicWorksArmy === 'function') realmPublicWorksArmy(wb, a);
  cwSetOrder(wb, s2Order(B), s2Order(B).why);
  S2.stats.taken++;
  const P = GAME.player;
  if (P) {
    const where = a.kind === 'raid' ? `the fields of ${REALMS[a.q].name}` : WAR.keeps[a.k]?.site.name || REALMS[a.r].musterSite.name;
    const txt = `${s2Name(wb, true)} comes into sight: ${Math.round(a.n)} soldiers ${a.state === 'siege' ? 'before' : 'marching on'} ${where}.`;
    news(txt, a.r, a.off && (a.r === P.faction || (a.k >= 0 && WAR.keeps[a.k].realm === P.faction)) ? 'big' : 'normal');
  }
  return B;
}
// a band's name: "Thule's army of the season", "Ériu's offensive on Kestrel Hold", "Logres's raiders"
function s2Name(wb, withRealm) {
  const S = wb.season, R = REALMS[wb.realm];
  const who = withRealm ? possessive(R.name) + ' ' : 'the ';
  if (S.kind === 'raid') return `${who}season's raiders`;
  if (S.kind === 'offensive') return `${who}offensive`;
  return `${who}army of the season`;
}
// what is told back: the army's soldiers left (RS's measure), how far it has come, a siege laid; done or folded
function s2Report(B, rep) {
  B.rep++; S2.stats.reports++;
  if (B.mode === 'server') { if (typeof netWsSend === 'function') netWsSend({ t: 'sarmyrep', id: B.a.id, season: B.a.season, fieldLease: B.a.fieldLease, rep }); return; }
  const RS = SEASONP.rs;
  if (RS) realmSimFieldReport(RS, B.a.id, rep, 'page');
}
function s2Remove(B) {
  if (B.mode === 'server' && !s2Keeper()) return;
  for (const e of wbMembers(B.wb)) { if (e.siegeCrew) e.siegeCrew = null; removeEnt(e); }
  B.wb.members = []; B.wb.dead = true; B.wb.order = null;
}
// Hosted soldiers return to canonical reserves/garrison; a solo band stays to hold its ground.
function s2Release(B) {
  s2Remember(B.a);
  if (B.mode === 'server') s2Remove(B);
  else { B.wb.season = null; B.wb.order = null; }
  S2.stats.released++;
}
function s2BandStep(B) {
  const wb = B.wb, a = B.a, P = GAME.player, m = wbMembers(wb);
  const n = m.length * B.per;
  const end = (rep, how) => { s2Report(B, rep); s2Remember(a); S2.bands.delete(a.id); S2.stats[how]++; };
  if (CAMPAIGN.state !== 'war' || (B.campaign != null && B.campaign !== CAMPAIGN.n)
    || (B.mode === 'server' && typeof NETS !== 'undefined' && NETS.s && a.season !== NETS.s.n)) {
    end({ n: m.length ? n : a.n, p: a.p || 0, fold: 1 }, 'folded'); s2Remove(B); return;
  }
  if (!m.length || wb.dead) { end({ n: 0, done: 'fallen' }, 'fallen'); s2Remove(B); return; }
  if (a.manual && wb.order?.keep && ['attack', 'defend'].includes(wb.order.type)) {
    if (a.k !== wb.order.keep.id || a.mission !== wb.order.type) { a.state = 'march'; a.p = 0; }
    a.k = wb.order.keep.id; a.mission = wb.order.type;
  }
  const L = wbLeader(wb), T = s2Target(a);
  // its keep taken (by this band or another of its realm): the army goes home into the garrison, the band holds it
  if ((!a.manual || a.mission === 'attack') && a.k >= 0 && WAR.keeps[a.k] && WAR.keeps[a.k].realm === a.r) { end({ n, done: 'taken' }, 'won'); s2Release(B); return; }
  if (a.kind === 'raid' && dist(L.x, L.z, T.x, T.z) < 40) {
    end({ n, done: 'raided' }, 'raided');
    news(`${s2Name(wb, true)} burn and carry off what they can from ${possessive(REALMS[a.q].name)} fields by ${T.name}.`, a.r, 'normal');
    s2Release(B);
    return;
  }
  // beaten: under a third of what came onto the field, and not at its siege's work
  if (m.length < Math.max(2, B.n0 / 3)) { end({ n, done: 'beaten' }, 'beaten'); s2Release(B); return; }
  // its order: the season's, again if the stall guards gave it back (twice: it goes back to the season, out of sight)
  if (!a.manual && CAMPAIGN.state === 'war' && (!wb.order || (wb.order.type !== s2Order(B).type) || (wb.order.keep && a.k >= 0 && wb.order.keep !== WAR.keeps[a.k]))) {
    B.lost++;
    if (B.lost <= 2) { cwSetOrder(wb, s2Order(B), s2Order(B).why); S2.stats.reissued++; }
  }
  // how far it has come, and a siege laid
  const M = REALMS[a.r].musterSite, d0 = dist(M.x, M.z, T.x, T.z), d = dist(L.x, L.z, T.x, T.z);
  const rep = { n, p: clamp(1 - d / Math.max(1, d0), a.p || 0, 1), ...(a.manual ? { x: L.x, z: L.z,
    order: wb.order?.keep && ['attack', 'defend'].includes(wb.order.type) ? { type: wb.order.type, keep: wb.order.keep.id } : undefined } : {}) };
  const ph = wb.order && wb.order.phase;
  if (a.k >= 0 && a.state !== 'siege' && d < 70 && ph && ph !== 'travel') { rep.state = 'siege'; a.state = 'siege'; }
  // far from the player and out of sight (every soldier), or the live war at peace, or given up: folded back where it stands
  const view = s2View();
  const viewed = !!view && (m.some(e => dist(e.x, e.z, view.x, view.z) <= view.radius) || dist(T.x, T.z, view.x, view.z) < S2.reachK);
  const away = B.mode !== 'server' && !viewed && (!P || m.every((e) => dist(e.x, e.z, P.x, P.z) > S2.fold) && !(a.k >= 0 && WAR.keeps[a.k] && dist(P.x, P.z, T.x, T.z) < S2.reachK));
  const hidden = !P || m.every((e) => dist(e.x, e.z, P.x, P.z) > 110);
  if ((away || (hidden && (CAMPAIGN.state !== 'war' || B.lost > 2)))) {
    rep.fold = 1;
    s2Report(B, rep); s2Remember(a); S2.bands.delete(a.id); S2.stats.folded++;
    s2Remove(B);
    return;
  }
  if (Math.abs(rep.n - (B.lastN ?? -1)) > 0.01 || GAME.t - (B.lastRep || 0) > 3 || rep.state) { B.lastN = rep.n; B.lastRep = GAME.t; s2Report(B, rep); }
  a.n = n; a.p = rep.p;
}
// alone: the page's own RS armies near the player brought on; keeps the season's armies took by the numbers given
function s2PageStep() {
  const RS = SEASONP.rs, P = GAME.player;
  if (!RS || !P) return;
  // a keep the season's armies took out of sight (RS by the numbers): given in the field (the live war's own captures
  // are told to RS as they happen, so only RS's own changes show here)
  if (RS.phase === 'war') {
    RS.keeps.forEach((Q, i) => {
      const was = S2.seen[i];
      S2.seen[i] = Q.h;
      const K = WAR.keeps[i];
      if (was != null && was !== Q.h && K && K.realm !== Q.h) { seasonGiveKeep(K, Q.h); S2.stats.applied++; }
    });
  } else S2.seen = RS.keeps.map((Q) => Q.h);
  if (S2.bands.size >= S2.max) return;
  const cands = RS.armies.filter((A) => A.state !== 'gone' && !A.onField && !S2.bands.has(A.id));
  for (const A of cands) {
    if (S2.bands.size >= S2.max) break;
    const d = rsmFieldDesc(RS, A);
    if (!s2Fits(d) || !s2Near(d, P)) continue;
    const a = realmSimFieldTake(RS, A.id, 'page');
    if (!a) continue;
    if (!s2Spawn(a, 'page')) { realmSimFieldFold(RS, 'page'); S2.stats.declined++; }
  }
}
// linked: the server hands an army to this page (it keeps the army's region and its player is near), or takes it back
function season2ServerMsg(m) {
  if (m.t === 'sarmy' && m.a && typeof m.a === 'object') {
    const a = s2Read(m.a);
    if (!a || !a.fieldLease || !a.season || (typeof NETS !== 'undefined' && NETS.s && a.season !== NETS.s.n)) return;
    if (S2.fieldSeen.includes(s2GrantKey(a))) return;
    const previous = S2.bands.get(a.id);
    if (previous) {
      if (previous.a.fieldLease === a.fieldLease && previous.a.season === a.season) return;
      s2Remember(previous.a);
      if (previous.a.season !== a.season) s2Remove(previous);
      S2.bands.delete(a.id); // same-season lease replacement adopts the existing injured cohort below
    }
    if (!GAME.started || !s2Keeper(a.id) || S2.bands.size >= S2.max || !s2Fits(a) || !s2Spawn(a, 'server')) {
      s2Remember(a); S2.stats.declined++;
      netWsSend({ t: 'sarmyrep', id: a.id, season: a.season, fieldLease: a.fieldLease, rep: { n: a.n, p: a.p, fold: 1 } });
    }
  } else if (m.t === 'sarmyfold') {
    const B = S2.bands.get(m.id | 0);
    if (B && B.a.fieldLease === m.fieldLease && B.a.season === m.season) { S2.bands.delete(B.a.id); s2Remember(B.a); s2Remove(B); S2.stats.folded++; }
  }
}
function s2Read(o) {
  const n = (v, a, b, d) => (Number.isFinite(+v) ? clamp(+v, a, b) : d);
  const KINDS = ['raid', 'hallow', 'assault', 'offensive', 'company'];
  if (!KINDS.includes(o.kind)) return null;
  const a = { id: n(o.id, 1, 1e9, 0) | 0, r: n(o.r, 0, 2, 0) | 0, n: n(o.n, 0, 200, 0), n0: n(o.n0, 1, 200, 1), kind: o.kind, season: Number.isSafeInteger(o.season) && o.season > 0 ? o.season : 0, fieldLease: typeof o.fieldLease === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(o.fieldLease) ? o.fieldLease : '', arm: n(o.arm, 1, 1.5, 1), manual: o.manual === true && o.kind === 'company', mission: o.mission === 'attack' ? 'attack' : 'defend', fx: n(o.fx, -500, 500, NaN), fz: n(o.fz, -500, 500, NaN), k: n(o.k, -1, WAR.keeps.length - 1, -1) | 0, q: n(o.q, -1, 2, -1) | 0, eng: n(o.eng, 0, 4, 0) | 0, state: o.state === 'siege' ? 'siege' : 'march', p: n(o.p, 0, 1, 0), hungry: o.hungry ? 1 : 0, off: o.off ? 1 : 0 };
  return a.id ? a : null;
}
function season2InventoryReady() {
  if (!season2CanonicalWar()) return true;
  if (typeof netRealmSeasonProjectionFresh === 'function' && !netRealmSeasonProjectionFresh()) return false;
  if (typeof NETS === 'undefined' || !NETS.s?.armyIdsComplete) return false;
  if (S2.inventoryBusy) return true;
  if (S2.inventorySummary !== NETS.s || S2.inventoryBands !== WAR.warbands) {
    S2.inventoryBusy = true;
    try { s2Reconcile(); S2.inventorySummary = NETS.s; S2.inventoryBands = WAR.warbands; }
    finally { S2.inventoryBusy = false; }
  }
  return true;
}
function s2Reconcile(pendingArmy = S2.pendingArmy) {
  if (typeof netRealmSeasonProjectionFresh === 'function' && !netRealmSeasonProjectionFresh()) return;
  if (!s2Server() || !s2Keeper() || typeof NETS === 'undefined' || !NETS.s?.armyIdsComplete || !Array.isArray(NETS.s.armyIds)) return;
  const ids = new Set(NETS.s.armyIds);
  for (const wb of WAR.warbands) {
    const stamp = wb.season;
    if (!stamp || S2.bands.has(stamp.id) || stamp.id === pendingArmy) continue;
    if ((stamp.season && stamp.season !== NETS.s.n) || !ids.has(stamp.id)) s2Remove({ wb, mode: 'server' });
  }
}
function season2Update(dt) {
  S2.t += dt;
  if (S2.t < 1) return;
  S2.t = 0;
  if (!GAME.started || !GAME.player) return;
  s2Reconcile();
  for (const B of [...S2.bands.values()]) {
    if (B.mode === 'server' && !s2Keeper()) { s2Remember(B.a); S2.bands.delete(B.a.id); continue; }
    s2BandStep(B);
  }
  if (!s2Server()) s2PageStep();
  s2Note();
}
// a band the stall guards or a commander may not take from the season (08_ai.js retask)
const season2Held = (wb) => !!(wb && wb.season);

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
// the armies and offensives a player of `me` should know of: [{ r, k, n, st, near, field, off, inS, d }]
function s2Armies() {
  const P = GAME.player, me = P ? P.faction : 0, out = [];
  if (s2Server()) {
    if (typeof NETS === 'undefined' || !NETS.s) return out;
    for (const A of NETS.s.armies) if (A.to >= 0 && WAR.keeps[A.to] && (A.r === me || WAR.keeps[A.to].realm === me)) out.push({ r: A.r, k: A.to, n: A.n, st: A.st, field: !!A.f, d: P ? dist(P.x, P.z, A.x, A.z) : 1e9, off: !!A.off });
    for (const O of NETS.s.offs || []) if (O.state === 'planned' && (O.r === me || (WAR.keeps[O.k] && WAR.keeps[O.k].realm === me))) out.push({ r: O.r, k: O.k, n: 0, st: 'planned', inS: O.inS, off: true, d: 1e9 });
  } else {
    const RS = SEASONP.rs;
    if (!RS) return out;
    for (const A of RS.armies) {
      if (A.state === 'gone' || A.k < 0 || !WAR.keeps[A.k] || !(A.r === me || WAR.keeps[A.k].realm === me)) continue;
      const B = S2.bands.get(A.id), L = B && wbLeader(B.wb), q = L || s2Pos(rsmFieldDesc(RS, A));
      out.push({ r: A.r, k: A.k, n: B ? B.a.n : A.n, st: A.state, field: !!B, d: P ? dist(P.x, P.z, q.x, q.z) : 1e9, off: RS.offs.some((O) => O.army === A.id && O.state === 'siege') });
    }
    for (const O of RS.offs) if (O.state === 'planned' && (O.r === me || RS.keeps[O.k].h === me)) out.push({ r: O.r, k: O.k, n: 0, st: 'planned', inS: Math.max(0, O.at - RS.t), off: true, d: 1e9 });
  }
  return out;
}
const s2Ago = (s) => (typeof rsmDur === 'function' ? rsmDur(s) : `${Math.round(s / 60)}m`);
function s2LineText(x) {
  const R = REALMS[x.r], K = WAR.keeps[x.k];
  if (x.st === 'planned') return `${R.name}'s offensive on ${K.site.name} marches in ${s2Ago(x.inS)}`;
  const what = x.off ? `${R.name}'s offensive` : `${R.name}'s army`;
  return `${what} (${Math.round(x.n)}) ${x.st === 'siege' ? 'besieges' : 'marches on'} ${K.site.name}${x.field ? ` · here, ${Math.round(x.d)} m` : ''}`;
}
// the war panel's line (08n_season.js seasonHudLine, 14q_netseason.js netSeasonHudHTML): the army nearest you, else
// the offensive soonest
function season2HudLine() {
  if (!GAME.player) return '';
  const L = s2Armies();
  if (!L.length) return '';
  const live = L.filter((x) => x.st !== 'planned').sort((a, b) => b.field - a.field || a.d - b.d)[0];
  const x = live || L.sort((a, b) => a.inS - b.inS)[0];
  const me = GAME.player.faction, foe = x.r !== me;
  return `<div class="s2-line${x.field ? ' s2-here' : ''}" style="--rc:${REALMS[x.r].color}">${foe ? '⚔ ' : '⚑ '}${esc(s2LineText(x))}${x.field ? '' : x.st === 'planned' ? '' : ' · join it'}</div>`;
}
// the herald's and the war table's word (seasonWarText)
function season2WarText() {
  const L = s2Armies().filter((x) => x.st !== 'planned');
  if (!L.length) return '';
  return ' In the field: ' + L.slice(0, 3).map((x) => s2LineText(x).replace(/ · here.*$/, '')).join('; ') + '.';
}
// the Season page's section: the armies of the season and the battles to join
function season2ChronHTML() {
  const L = s2Armies();
  const me = GAME.player ? GAME.player.faction : 0;
  const li = L.map((x) => `<li style="--rc:${REALMS[x.r].color}">${x.r === me ? '⚑' : '⚔'} ${esc(s2LineText(x))}${x.st === 'planned' ? '' : x.field ? ' <b>(on the field near you)</b>' : ''}</li>`).join('');
  return `<h3 data-cf-open>The armies of the season</h3><p>An army of the season marching or laying siege near you comes onto the field: its soldiers are real, and what becomes of them is the season's. An offensive marches on its day from its realm's muster to the keep it named: be at that keep, or march with it.</p><ul class="plain s2-list">${li || '<li>No army of the season marches on a keep of ours or with our banners now.</li>'}</ul><div class="acts"><button type="button" class="btn season-btn s2-map" data-s2="map">Show the armies on the map</button></div>`;
}
// the map: a pennant of the season over each band brought from it, and (alone) the season's armies still on the road
function season2MapMarks(ctx, toPx, u, sc) {
  const P = GAME.player;
  if (!P) return;
  ctx.save();
  const flag = (x, y, col, n, field) => {
    const h = sc * 4.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = Math.max(1.5, sc * 0.45);
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.4); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.95, y - h * 0.82); ctx.lineTo(x + h * 0.55, y - h * 0.66); ctx.lineTo(x + h * 0.95, y - h * 0.5); ctx.lineTo(x, y - h * 0.42); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (field) { ctx.strokeStyle = '#ffe7a8'; ctx.lineWidth = Math.max(1, sc * 0.3); ctx.stroke(); }
    if (n) { ctx.font = `700 ${10 * u}px "Alegreya Sans", sans-serif`; ctx.textAlign = 'left'; const t = String(Math.round(n)); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(t, x + h * 1.05, y - h * 0.6); ctx.fillStyle = '#f4ead8'; ctx.fillText(t, x + h * 1.05, y - h * 0.6); }
  };
  for (const B of S2.bands.values()) {
    const L = wbLeader(B.wb);
    if (!L || (B.wb.realm !== P.faction && !cwSpotted(B.wb, P))) continue;
    const [x, y] = toPx(L.x, L.z);
    flag(x - sc * 5.5, y - sc * 3, REALMS[B.wb.realm].color, B.a.n, true);
  }
  if (!s2Server() && SEASONP.rs) for (const A of SEASONP.rs.armies) {
    if (A.state === 'gone' || A.onField || S2.bands.has(A.id)) continue;
    if (A.r !== P.faction && !(A.state === 'siege' || (A.k >= 0 && WAR.keeps[A.k] && WAR.keeps[A.k].realm === P.faction))) continue;
    const q = s2Pos(rsmFieldDesc(SEASONP.rs, A)), [x, y] = toPx(q.x, q.z);
    flag(x, y, REALMS[A.r].color, A.n, false);
    if (A.state === 'siege') { ctx.strokeStyle = REALMS[A.r].color; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, sc * 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  }
  ctx.restore();
}
// a field note: an offensive by or against your realm on the field, or about to march
function s2Note() {
  const L = s2Armies(), P = GAME.player;
  if (!P || !L.length) return;
  if (L.some((x) => x.off && (x.st !== 'planned' || x.inS < 3600))) S2.offNear = true;
  if (L.some((x) => x.field)) S2.fieldNear = true;
}
queueMicrotask(() => {
  Object.assign(FIELD_NOTES, {
    s2field: { t: 'An army of the season', x: (R) => `A season's army has come onto the field near you: its soldiers are real, and what becomes of them counts in the season (its losses, the siege, the keep). Its pennant flies over it on the map${IS_TOUCH ? '' : ' (M)'}.` },
    s2battle: { t: 'An offensive to join', x: (R) => `An offensive of the season marches now, or within the hour: the war panel says on which keep. Go there to hold it or to take it: the battle counts in the season.` },
  });
  GUIDE_WATCH.s2field = () => !!S2.fieldNear;
  GUIDE_WATCH.s2battle = () => !!S2.offNear;
  GUIDE_HELP.push(() => `<h3>The armies of the season</h3><p>The season's armies march for days on the strategic map. When one marches or lays siege near you it comes onto the field as a band of its realm, under the season's pennant: fight it or march with it, and what becomes of it (its soldiers lost, its siege, the keep taken or held) is the season's. An offensive marches on its announced day from its realm's muster: the war panel and the Season page say where and when.</p>`);
  LOADING_TIPS.push('A season\'s army near you is a real band under the season\'s pennant: what you do to it counts in the season.', 'An offensive marches on its announced day: be at the keep it names to hold it, or march with it.');
  if (typeof $ === 'function' && $('menu-body')) $('menu-body').addEventListener('click', (ev) => { const b = ev.target.closest('.chron [data-s2]'); if (b && b.dataset.s2 === 'map') { sfx('click'); closeMenu(); toggleMap(true); } });
});
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.season2 = { S2, season2CanonicalWar, season2StrategicArmies, season2InventoryReady, s2Reconcile, s2Pos, s2Spawn, s2Spot, s2Near, s2Size, s2Armies, season2HudLine, season2WarText, season2ChronHTML, season2ServerMsg, season2Update, s2Read, s2Name, step: () => { S2.t = 1; season2Update(0); } };
});
