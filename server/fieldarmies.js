import { randomUUID } from 'node:crypto';

// [season2] The season's armies on the pages' fields (version 20; CLAUDE.md, Multiplayer, the season): an army of RS
// marching or laying siege near a player is handed to the page that keeps its region (the regions' keepers, server.js),
// which brings it onto its live war as a band and tells back what became of it (src/08o_season2.js). While a page has it,
// RS leaves it alone (08m_realm.js A.onField: never two of one army); a page that leaves, stops being the region's keeper
// or says nothing for a while gives it back where it last stood; with no keeper near, RS resolves it by the numbers.
const REACH = 260, REACH_K = 150; // as the page's own (08o_season2.js S2.reach, S2.reachK)

export function makeField(SEASON, ROOMS, send, regionOf, WORLD, STATS, realmViewFor = () => null, canKeepField = null) {
  const F = { held: new Map(), cooldown: new Map(), stats: { handed: 0, reports: 0, folded: 0, refused: 0 } }; // army id -> { c, who }
  const sites = (kind) => (WORLD.SITES || []).filter((s) => s.kind === kind);
  const musters = [0, 1, 2].map((r) => sites('muster').find((s) => s.realm === r) || { x: 0, z: 0 });
  const temples = [0, 1, 2].map((r) => sites('temple').find((s) => s.realm === r) || musters[r]);
  const keeps = WORLD.keeps || [];
  const target = (A) => (A.k >= 0 && keeps[A.k] ? keeps[A.k] : A.q >= 0 ? (A.kind === 'hallow' ? temples[A.q] : musters[A.q]) : musters[A.r]);
  F.pos = (A) => { if (A.manual && Number.isFinite(A.fx) && Number.isFinite(A.fz)) return { x: A.fx, z: A.fz }; const M = musters[A.r], T = target(A), p = A.state === 'siege' ? 1 : Math.max(0, Math.min(1, A.p || 0)); return { x: M.x + (T.x - M.x) * p, z: M.z + (T.z - M.z) * p }; };
  const whoOf = (c) => 'peer:' + c.peer;
  const ok = () => SEASON.RS && SEASON.M && typeof SEASON.M.realmSimFieldTake === 'function';
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const view = c => {
    let p; try { p = realmViewFor(c); } catch { return null; }
    return p && Number.isInteger(p.realm) && p.realm >= 0 && p.realm < 3 && Number.isFinite(p.x) && Number.isFinite(p.z)
      && Math.abs(p.x) <= 500 && Math.abs(p.z) <= 500 ? { x: p.x, z: p.z, radius: Math.max(40, Math.min(REACH, Number.isFinite(p.radius) ? p.radius : 220)) } : null;
  };
  // An authenticated ruler can look elsewhere without moving its character or acquiring a keeper lease.
  // The existing keeper simulates the visible cohort for all clients, including a ruler who is observing it.
  const viewed = A => {
    const q = F.pos(A);
    for (const R of ROOMS.values()) for (const c of R.clients.values()) {
      const p = view(c);
      if (p && (d(p, q) <= p.radius || (A.k >= 0 && keeps[A.k] && d(p, keeps[A.k]) < REACH_K))) return true;
    }
    return false;
  };
  const fold = (h, id, season = SEASON.RS?.n) => send(h.c, { t: 'sarmyfold', id, season, fieldLease: h.lease });
  // is this page the keeper of the army's region (or of its keep's), with its player near the army or its keep?
  const fits = (c, A, q) => {
    if (!c || c.room?.diagnostic || !c.pos || !(c.realm >= 0) || c.ws.readyState !== 1 || c.slow?.seasonField !== 2) return false;
    const H = (c.room && c.room.regions) || {}, rg = regionOf(q.x, q.z), kr = A.k >= 0 && keeps[A.k] ? regionOf(keeps[A.k].x, keeps[A.k].z) : '';
    if (typeof canKeepField === 'function' ? !canKeepField(c) : H[rg] !== c.peer && H[kr] !== c.peer) return false;
    return d(c.pos, q) < REACH || (A.k >= 0 && keeps[A.k] && d(c.pos, keeps[A.k]) < REACH_K) || viewed(A);
  };
  F.step = () => {
    if (!ok()) return;
    const RS = SEASON.RS;
    for (const [id, until] of F.cooldown) if (until <= Date.now() || !RS.armies.some(A => A.id === id)) F.cooldown.delete(id);
    // the armies held: still with a page that may have them?
    for (const [id, h] of [...F.held]) {
      const A = RS.armies.find((x) => x.id === id && x.state !== 'gone');
      if (!A || !A.onField || A.onField.who !== h.who || h.season !== RS.n) { F.held.delete(id); if (h.c.ws.readyState === 1) fold(h, id, h.season); continue; }
      const live = [...ROOMS.values()].some((R) => R.clients.get(h.c.peer) === h.c);
      if (!live || !h.c.region || !fits(h.c, A, F.pos(A))) {
        A.onField = null; F.held.delete(id); F.stats.folded++;
        if (live) fold(h, id, h.season);
      }
    }
    if (RS.phase === 'reckon') return;
    for (const A of RS.armies) {
      if ((RS.phase !== 'war' && !A.manual) || (F.cooldown.get(A.id) || 0) > Date.now() || A.state === 'gone' || A.onField || A.kind === 'hallow' || A.n < 1 || F.held.size >= 24) continue;
      if (typeof SEASON.fieldGrantConfirmed === 'function' && SEASON.fieldGrantConfirmed(A) !== true) continue;
      const q = F.pos(A);
      let to = null;
      for (const R of ROOMS.values()) { for (const c of R.clients.values()) if (fits(c, A, q)) { to = c; break; } if (to) break; }
      if (!to || [...F.held.values()].filter(h => h.c === to).length >= 3) continue;
      const who = whoOf(to), a = SEASON.M.realmSimFieldTake(RS, A.id, who);
      if (!a) continue;
      const lease = randomUUID();
      F.held.set(A.id, { c: to, who, lease, season: RS.n });
      send(to, { t: 'sarmy', a: { ...a, season: RS.n, fieldLease: lease } });
      F.stats.handed++; SEASON.dirty = true;
    }
  };
  // what a page tells of an army it holds
  F.report = (c, m) => {
    if (c?.room?.diagnostic || c?.slow?.seasonField !== 2 || !ok() || !m || !Number.isInteger(m.id) || !m.rep || typeof m.rep !== 'object') return;
    const h = F.held.get(m.id);
    if (!h || h.c !== c || m.fieldLease !== h.lease || m.season !== h.season || h.season !== SEASON.RS.n) { F.stats.refused++; return; }
    const Aheld = SEASON.RS.armies.find(A => A.id === m.id && A.state !== 'gone');
    const regionOwner = Aheld && ((c.room?.regions || {})[regionOf(F.pos(Aheld).x, F.pos(Aheld).z)] === c.peer
      || (Aheld.k >= 0 && keeps[Aheld.k] && (c.room?.regions || {})[regionOf(keeps[Aheld.k].x, keeps[Aheld.k].z)] === c.peer));
    if (!Aheld || (typeof canKeepField === 'function' ? !canKeepField(c) : !regionOwner)) { F.stats.refused++; return; }
    const rep = { n: Number.isFinite(m.rep.n) ? m.rep.n : undefined, p: Number.isFinite(m.rep.p) ? m.rep.p : undefined, state: m.rep.state === 'siege' ? 'siege' : undefined, done: ['taken', 'fallen', 'beaten', 'raided', 'caught', 'home'].includes(m.rep.done) ? m.rep.done : '', fold: !!m.rep.fold,
      ...(Aheld.manual ? { x: Number.isFinite(m.rep.x) ? m.rep.x : undefined, z: Number.isFinite(m.rep.z) ? m.rep.z : undefined,
        order: m.rep.order && ['attack', 'defend'].includes(m.rep.order.type) && Number.isSafeInteger(m.rep.order.keep)
          ? { type: m.rep.order.type, keep: m.rep.order.keep } : undefined } : {}) };
    if (!SEASON.M.realmSimFieldReport(SEASON.RS, m.id, rep, h.who)) { F.stats.refused++; return; }
    if (rep.fold) F.cooldown.set(m.id, Date.now() + 10000);
    const A = SEASON.RS.armies.find((x) => x.id === m.id);
    if (!A || !A.onField || A.onField.who !== h.who) { F.held.delete(m.id); fold(h, m.id, h.season); }
    F.stats.reports++; SEASON.dirty = true;
  };
  // a page gone: its armies folded back where they last stood
  F.left = (c) => {
    if (!ok()) return;
    for (const [id, h] of [...F.held]) if (h.c === c) { const A = SEASON.RS.armies.find((x) => x.id === id); if (A) A.onField = null; F.held.delete(id); F.stats.folded++; }
  };
  STATS.field = F.stats;
  return F;
}
