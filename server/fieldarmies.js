// [season2] The season's armies on the pages' fields (version 20; CLAUDE.md, Multiplayer, the season): an army of RS
// marching or laying siege near a player is handed to the page that keeps its region (the regions' keepers, server.js),
// which brings it onto its live war as a band and tells back what became of it (src/08o_season2.js). While a page has it,
// RS leaves it alone (08m_realm.js A.onField: never two of one army); a page that leaves, stops being the region's keeper
// or says nothing for a while gives it back where it last stood; with no keeper near, RS resolves it by the numbers.
const REACH = 260, REACH_K = 150; // as the page's own (08o_season2.js S2.reach, S2.reachK)

export function makeField(SEASON, ROOMS, send, regionOf, WORLD, STATS) {
  const F = { held: new Map(), stats: { handed: 0, reports: 0, folded: 0, refused: 0 } }; // army id -> { c, who }
  const sites = (kind) => (WORLD.SITES || []).filter((s) => s.kind === kind);
  const musters = [0, 1, 2].map((r) => sites('muster').find((s) => s.realm === r) || { x: 0, z: 0 });
  const temples = [0, 1, 2].map((r) => sites('temple').find((s) => s.realm === r) || musters[r]);
  const keeps = WORLD.keeps || [];
  const target = (A) => (A.k >= 0 && keeps[A.k] ? keeps[A.k] : A.q >= 0 ? (A.kind === 'hallow' ? temples[A.q] : musters[A.q]) : musters[A.r]);
  F.pos = (A) => { const M = musters[A.r], T = target(A), p = A.state === 'siege' ? 1 : Math.max(0, Math.min(1, A.p || 0)); return { x: M.x + (T.x - M.x) * p, z: M.z + (T.z - M.z) * p }; };
  const whoOf = (c) => 'peer:' + c.peer;
  const ok = () => SEASON.RS && SEASON.M && typeof SEASON.M.realmSimFieldTake === 'function';
  const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // is this page the keeper of the army's region (or of its keep's), with its player near the army or its keep?
  const fits = (c, A, q) => {
    if (!c || !c.pos || !(c.realm >= 0) || c.ws.readyState !== 1) return false;
    const H = (c.room && c.room.regions) || {}, rg = regionOf(q.x, q.z), kr = A.k >= 0 && keeps[A.k] ? regionOf(keeps[A.k].x, keeps[A.k].z) : '';
    if (H[rg] !== c.peer && H[kr] !== c.peer) return false;
    return d(c.pos, q) < REACH || (A.k >= 0 && keeps[A.k] && d(c.pos, keeps[A.k]) < REACH_K);
  };
  F.step = () => {
    if (!ok()) return;
    const RS = SEASON.RS;
    // the armies held: still with a page that may have them?
    for (const [id, h] of [...F.held]) {
      const A = RS.armies.find((x) => x.id === id && x.state !== 'gone');
      if (!A || !A.onField || A.onField.who !== h.who) { F.held.delete(id); continue; }
      const live = [...ROOMS.values()].some((R) => R.clients.get(h.c.peer) === h.c);
      if (!live || !h.c.region || !fits(h.c, A, F.pos(A))) {
        A.onField = null; F.held.delete(id); F.stats.folded++;
        if (live) send(h.c, { t: 'sarmyfold', id });
      }
    }
    if (RS.phase !== 'war') return;
    for (const A of RS.armies) {
      if (A.state === 'gone' || A.onField || A.kind === 'hallow' || A.n < 1 || F.held.size >= 24) continue;
      const q = F.pos(A);
      let to = null;
      for (const R of ROOMS.values()) { for (const c of R.clients.values()) if (fits(c, A, q)) { to = c; break; } if (to) break; }
      if (!to) continue;
      const who = whoOf(to), a = SEASON.M.realmSimFieldTake(RS, A.id, who);
      if (!a) continue;
      F.held.set(A.id, { c: to, who });
      send(to, { t: 'sarmy', a });
      F.stats.handed++; SEASON.dirty = true;
    }
  };
  // what a page tells of an army it holds
  F.report = (c, m) => {
    if (!ok() || !m || !Number.isInteger(m.id) || !m.rep || typeof m.rep !== 'object') return;
    const h = F.held.get(m.id);
    if (!h || h.c !== c) { F.stats.refused++; return; }
    const rep = { n: Number.isFinite(m.rep.n) ? m.rep.n : undefined, p: Number.isFinite(m.rep.p) ? m.rep.p : undefined, state: m.rep.state === 'siege' ? 'siege' : undefined, done: ['taken', 'fallen', 'beaten', 'raided', 'caught', 'home'].includes(m.rep.done) ? m.rep.done : '', fold: !!m.rep.fold };
    if (!SEASON.M.realmSimFieldReport(SEASON.RS, m.id, rep, h.who)) { F.stats.refused++; return; }
    const A = SEASON.RS.armies.find((x) => x.id === m.id);
    if (!A || !A.onField || A.onField.who !== h.who) F.held.delete(m.id);
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
