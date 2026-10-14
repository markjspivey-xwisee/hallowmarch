/* ================================================================== */
/* [net] a stand-in for loops's src/08m_realm.js (the shared contract) */
/* ================================================================== */
// The season's strategic state of the three realms as one plain JSON object RS, stepped by the server while nobody is
// logged in (and by nothing else). It is the SHAPE and the FUNCTIONS of the contract between loops and net (CLAUDE.md,
// Multiplayer, the season), written by net so the server runs before loops's real module lands: when src/08m_realm.js
// exists the server loads that instead (server/season.js), and this file is not used. No three.js, DOM, window or audio:
// plain functions, loaded in Node by `new Function(code + 'return {...}')`.
//   realmSimInit(seed, opts) -> RS            a fresh season (opts.keeps: [{home, x, z}], opts.len seconds)
//   realmSimStep(RS, dt)                      stores, production, projects, levies, armies on the road, sieges by numbers
//   realmSimContribute(RS, realm, kind, n, who) -> units taken (a player's delivery or work)
//   realmSimOrder(RS, realm, order, who) -> { ok, why }   a vote ({kind:'project'|'target'|'muster', ...}, order.w its weight)
//   realmSimSummary(RS, realm, sinceT) -> what a returning player is told
//   realmSimSanitize(obj) -> RS or null       a saved or received RS made safe
//   realmSimCapture(RS, keep, realm, who)     a keep taken in the live war (net's extension: the live war writes back)
// RS.v the shape's version. Every number in RS is finite and bounded; every list capped.
const RSIM_GOODS = ['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses'];
const RSIM_V = 1;
const RSIM_T = {
  start: { food: 300, timber: 120, stone: 90, iron: 30, hides: 30, wool: 20, horses: 8 },
  cap: { food: 4000, timber: 1600, stone: 1200, iron: 500, hides: 400, wool: 300, horses: 120 },
  prod: { food: 18, timber: 6, stone: 2, iron: 2.5, hides: 1.2, wool: 0.7, horses: 0.25 }, // a minute, at home
  keepProd: { food: 1.5, timber: 0.6, stone: 0.3, iron: 0.1 },                               // a minute, each keep held
  soldier: { food: 6, iron: 1, hides: 0.4 },                                                 // an army's soldier mustered
  upkeep: 0.04,          // food a soldier in the field eats a minute
  levyEvery: 3600,       // s between a realm's musters (seasons last weeks)
  armyMax: 40, armyMin: 8,
  pace: 1.6,             // m/s an army goes on the roads, all told
  garrisonMax: 12, garrisonRegrow: 900, // a keep's garrison grows one in this many s while quiet (food permitting)
  siegeTick: 600,        // s of a siege resolved at a time
  pointsKeep: 1 / 60,    // season points a second for each keep held (doubled in the final week)
  pointsHome: 0.5,       // ...a keep of one's own counts half
  phases: [['build', 0.15], ['war', 0.85], ['final', 1.0]], // shares of the season's length
  projects: {
    walls: { need: { stone: 600, timber: 200 }, label: 'Raise the walls', did: 'gates and walls a third stronger' },
    forge: { need: { iron: 150, timber: 250 }, label: 'Build a forge', did: 'armies strike a fifth harder' },
    granary: { need: { timber: 300, stone: 200 }, label: 'Build a granary', did: 'food a third more' },
    engines: { need: { timber: 500, iron: 80, hides: 60 }, label: 'Build siege engines', did: 'sieges a third quicker' },
    stables: { need: { food: 400, horses: 30, timber: 150 }, label: 'Build stables', did: 'armies march a third faster' },
  },
};
function rsimRng(RS) { RS.rng = (Math.imul(RS.rng ^ (RS.rng >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return RS.rng / 4294967296; }
const rsimNum = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
function realmSimInit(seed, opts) {
  opts = opts || {};
  const keeps = Array.isArray(opts.keeps) && opts.keeps.length ? opts.keeps : [0, 0, 1, 1, 2, 2].map((home, i) => ({ home, x: Math.cos(i) * 300, z: Math.sin(i) * 300 }));
  return {
    v: RSIM_V, stub: 1, seed: seed >>> 0, rng: (seed >>> 0) || 1, t: 0, n: rsimNum(opts.season, 1, 1e6, 1), len: rsimNum(opts.len, 600, 365 * 86400, 28 * 86400),
    phase: 'build', over: 0, winner: -1,
    realms: [0, 1, 2].map(() => ({ st: { ...RSIM_T.start }, pts: 0, built: {}, proj: { walls: {}, forge: {}, granary: {}, engines: {}, stables: {} }, votes: { project: {}, target: {} }, levyAt: RSIM_T.levyEvery * 0.5, given: {}, made: 0 })),
    keeps: keeps.map((k, i) => ({ i, name: typeof k.name === 'string' ? k.name.slice(0, 40) : 'keep ' + (i + 1), home: k.home | 0, x: rsimNum(k.x, -5000, 5000, 0), z: rsimNum(k.z, -5000, 5000, 0), r: k.home | 0, g: 8, gate: 1, quiet: 0, siege: 0 })),
    armies: [], nextArmy: 1, log: [],
  };
}
function rsimLog(RS, realm, text) { RS.log.push([Math.round(RS.t), realm, String(text).slice(0, 160)]); if (RS.log.length > 120) RS.log.splice(0, RS.log.length - 120); }
const RSIM_REALM = ['Logres', 'Ériu', 'Thule'];
function rsimPhase(RS) { const f = RS.t / RS.len; for (const [p, e] of RSIM_T.phases) if (f < e) return p; return 'over'; }
function rsimTarget(RS, realm) {
  // the most votes among the enemy keeps, else the nearest enemy keep to the realm's own
  const v = RS.realms[realm].votes.target; let best = -1, bw = 0;
  for (const k in v) { const K = RS.keeps[k | 0]; if (K && K.r !== realm && v[k] > bw) { bw = v[k]; best = K.i; } }
  if (best >= 0) return best;
  const own = RS.keeps.filter((K) => K.home === realm);
  let d0 = Infinity;
  for (const K of RS.keeps) { if (K.r === realm) continue; const d = Math.min(...own.map((O) => Math.hypot(O.x - K.x, O.z - K.z))) + (K.home === realm ? -400 : 0) + K.g * 20; if (d < d0) { d0 = d; best = K.i; } }
  return best;
}
function rsimMuster(RS, realm, why) {
  const R = RS.realms[realm], T = RSIM_T.soldier;
  let n = RSIM_T.armyMax;
  for (const g in T) n = Math.min(n, Math.floor(R.st[g] / T[g]));
  if (n < RSIM_T.armyMin) return false;
  for (const g in T) R.st[g] -= n * T[g];
  const tgt = rsimTarget(RS, realm);
  if (tgt < 0) return false;
  const from = RS.keeps.filter((K) => K.r === realm).sort((a, b) => Math.hypot(a.x - RS.keeps[tgt].x, a.z - RS.keeps[tgt].z) - Math.hypot(b.x - RS.keeps[tgt].x, b.z - RS.keeps[tgt].z))[0] || RS.keeps.find((K) => K.home === realm);
  const A = { id: RS.nextArmy++, r: realm, n, x: from.x, z: from.z, to: tgt, st: 'march', t: 0 };
  RS.armies.push(A);
  rsimLog(RS, realm, `${RSIM_REALM[realm]} musters ${n} and marches on ${RS.keeps[tgt].name}${why ? ' (' + why + ')' : ''}`);
  return true;
}
function realmSimStep(RS, dt) {
  if (!RS || !(dt > 0)) return;
  let left = Math.min(dt, 30 * 86400);
  while (left > 0) {
    const h = Math.min(60, left); left -= h;
    RS.t += h;
    const ph = rsimPhase(RS);
    if (ph !== RS.phase) {
      if (ph === 'over' && !RS.over) {
        RS.over = 1; let w = 0; RS.realms.forEach((R, i) => { if (R.pts > RS.realms[w].pts) w = i; }); RS.winner = w;
        rsimLog(RS, w, `The season is over: ${RSIM_REALM[w]} holds the March`);
      } else if (ph !== 'over') rsimLog(RS, -1, ph === 'war' ? 'The building is done: the war of the season begins' : 'The final week: every keep held counts twice');
      RS.phase = ph;
    }
    if (RS.over) continue;
    const m = h / 60;
    // stores: home production, the keeps held, upkeep of the armies in the field
    RS.realms.forEach((R, r) => {
      const held = RS.keeps.filter((K) => K.r === r).length;
      for (const g of RSIM_GOODS) {
        let p = RSIM_T.prod[g] * (1 + 0.12 * (held - 2)) + (RSIM_T.keepProd[g] || 0) * held;
        if (g === 'food' && R.built.granary) p *= 1.33;
        R.st[g] = Math.min(RSIM_T.cap[g], Math.max(0, R.st[g] + p * m));
      }
      const field = RS.armies.filter((A) => A.r === r).reduce((s, A) => s + A.n, 0);
      R.st.food = Math.max(0, R.st.food - field * RSIM_T.upkeep * m);
      // projects: built from the stores as their goods come, the voted one first
      const want = Object.entries(R.votes.project).sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => RSIM_T.projects[k] && !R.built[k]);
      const pk = want[0];
      if (pk && RS.phase !== 'over') {
        const P = RSIM_T.projects[pk], have = R.proj[pk];
        let done = true;
        for (const g in P.need) { const n = Math.min(P.need[g] - (have[g] || 0), R.st[g] * 0.05 * m, 30 * m); if (n > 0) { have[g] = (have[g] || 0) + n; R.st[g] -= n; } if ((have[g] || 0) < P.need[g] - 1e-6) done = false; }
        if (done) { R.built[pk] = 1; delete R.votes.project[pk]; rsimLog(RS, r, `${RSIM_REALM[r]} has finished: ${P.label.toLowerCase()} (${P.did})`); }
      }
      // the levy
      if (RS.phase !== 'build') { R.levyAt -= h; if (R.levyAt <= 0) { R.levyAt = RSIM_T.levyEvery * (0.8 + 0.4 * rsimRng(RS)); rsimMuster(RS, r, 'the levy'); } }
      // season points
      for (const K of RS.keeps) if (K.r === r) R.pts += h * RSIM_T.pointsKeep * (K.home === r ? RSIM_T.pointsHome : 1) * (RS.phase === 'final' ? 2 : 1);
    });
    // armies on the roads and at their sieges
    for (const A of RS.armies) {
      const K = RS.keeps[A.to];
      if (!K || K.r === A.r) { A.to = rsimTarget(RS, A.r); A.st = 'march'; if (A.to < 0) A.n = 0; continue; }
      const pace = RSIM_T.pace * (RS.realms[A.r].built.stables ? 1.33 : 1);
      const d = Math.hypot(K.x - A.x, K.z - A.z);
      if (A.st === 'march') {
        if (d > 30) { const s = Math.min(d, pace * h); A.x += (K.x - A.x) / d * s; A.z += (K.z - A.z) / d * s; }
        else { A.st = 'siege'; A.t = 0; K.siege = 1; rsimLog(RS, A.r, `${RSIM_REALM[A.r]}'s army of ${A.n} lays siege to ${K.name}`); }
      } else {
        A.t += h * (RS.realms[A.r].built.engines ? 1.33 : 1);
        if (A.t >= RSIM_T.siegeTick) {
          A.t = 0;
          // a siege resolved by the numbers: the attackers against the garrison behind its gate
          const att = A.n * (RS.realms[A.r].built.forge ? 1.2 : 1) * (0.8 + 0.4 * rsimRng(RS));
          const def = (K.g + 1) * 2.2 * (K.gate ? 1.6 : 1) * (RS.realms[K.r].built.walls && K.home === K.r ? 1.33 : 1) * (0.8 + 0.4 * rsimRng(RS));
          const lossA = Math.max(1, Math.round(def / 6)), lossD = Math.max(1, Math.round(att / 7));
          A.n = Math.max(0, A.n - lossA); K.g = Math.max(0, K.g - lossD);
          if (K.gate && att > def * 0.6) K.gate = 0;
          if (K.g <= 0 && A.n > 0) {
            const was = K.r; K.r = A.r; K.g = Math.min(RSIM_T.garrisonMax, Math.ceil(A.n / 2)); K.gate = 0; K.quiet = 0; K.siege = 0;
            A.n -= K.g;
            rsimLog(RS, A.r, `${RSIM_REALM[A.r]} takes ${K.name} from ${RSIM_REALM[was]}`);
          }
        }
      }
    }
    RS.armies = RS.armies.filter((A) => A.n > 0).slice(-24);
    for (const K of RS.keeps) {
      if (RS.armies.some((A) => A.to === K.i && A.st === 'siege')) { K.quiet = 0; continue; }
      K.siege = 0; K.quiet += h;
      if (K.quiet > 120 && !K.gate) K.gate = 1;
      if (K.quiet >= RSIM_T.garrisonRegrow && K.g < RSIM_T.garrisonMax && RS.realms[K.r].st.food >= 4) { K.quiet -= RSIM_T.garrisonRegrow * 0.5; K.g++; RS.realms[K.r].st.food -= 4; }
    }
  }
}
function realmSimContribute(RS, realm, kind, amount, who) {
  if (!RS || RS.over || !(realm >= 0 && realm <= 2) || !RSIM_GOODS.includes(kind)) return 0;
  const R = RS.realms[realm];
  const n = Math.max(0, Math.min(rsimNum(amount, 0, 1e6, 0), RSIM_T.cap[kind] - R.st[kind]));
  R.st[kind] += n;
  if (typeof who === 'string' && who) { R.given[who] = rsimNum((R.given[who] || 0) + n, 0, 1e9, 0); const ks = Object.keys(R.given); if (ks.length > 400) delete R.given[ks[0]]; }
  R.made += n;
  return n;
}
function realmSimOrder(RS, realm, order, who) {
  if (!RS || RS.over || !(realm >= 0 && realm <= 2) || !order || typeof order !== 'object') return { ok: false, why: 'No such order' };
  const R = RS.realms[realm], w = rsimNum(order.w, 0, 10, 1);
  if (order.kind === 'project') {
    if (!RSIM_T.projects[order.id]) return { ok: false, why: 'No such work' };
    if (R.built[order.id]) return { ok: false, why: 'Already built' };
    R.votes.project[order.id] = rsimNum((R.votes.project[order.id] || 0) + w, 0, 1e6, 0);
    return { ok: true };
  }
  if (order.kind === 'target') {
    const K = RS.keeps[order.keep | 0];
    if (!K || K.r === realm) return { ok: false, why: 'Not a keep of a foe' };
    R.votes.target[K.i] = rsimNum((R.votes.target[K.i] || 0) + w, 0, 1e6, 0);
    return { ok: true };
  }
  if (order.kind === 'muster') {
    if (w < 3) return { ok: false, why: 'Only an officer of the realm (rank 5) calls a muster' };
    if (RS.phase === 'build') return { ok: false, why: 'No muster while the realm builds' };
    if (RS.armies.filter((A) => A.r === realm).length >= 4) return { ok: false, why: 'Four armies are in the field already' };
    return rsimMuster(RS, realm, 'called by ' + String(order.by || 'an officer').slice(0, 20)) ? { ok: true } : { ok: false, why: 'The stores cannot raise an army' };
  }
  return { ok: false, why: 'No such order' };
}
function realmSimCapture(RS, keep, realm, who) {
  const K = RS && RS.keeps[keep | 0];
  if (!K || !(realm >= 0 && realm <= 2) || K.r === realm) return false;
  const was = K.r; K.r = realm; K.g = Math.max(3, Math.min(K.g, 6)); K.gate = 0; K.quiet = 0;
  for (const A of RS.armies) if (A.to === K.i && A.r === realm) A.st = 'march';
  rsimLog(RS, realm, `${RSIM_REALM[realm]} takes ${K.name} from ${RSIM_REALM[was]} in the field${who ? ' (' + String(who).slice(0, 20) + ')' : ''}`);
  return true;
}
function realmSimSummary(RS, realm, sinceT) {
  if (!RS) return null;
  const r = realm >= 0 && realm <= 2 ? realm : -1, R = r >= 0 ? RS.realms[r] : null;
  const since = rsimNum(sinceT, -1, 1e12, -1);
  const day = Math.floor(RS.t / 86400) + 1, days = Math.ceil(RS.len / 86400);
  return {
    v: RS.v, n: RS.n, t: Math.round(RS.t), len: RS.len, day, days, phase: RS.phase, over: RS.over, winner: RS.winner,
    pts: RS.realms.map((X) => Math.round(X.pts)),
    keeps: RS.keeps.map((K) => ({ i: K.i, name: K.name, home: K.home, r: K.r, g: K.g, gate: K.gate, siege: K.siege })),
    armies: RS.armies.map((A) => ({ id: A.id, r: A.r, n: A.n, to: A.to, st: A.st, x: Math.round(A.x), z: Math.round(A.z) })),
    st: R ? Object.fromEntries(RSIM_GOODS.map((g) => [g, Math.floor(R.st[g])])) : null,
    built: R ? Object.keys(R.built) : [],
    proj: R ? Object.entries(RSIM_T.projects).map(([id, P]) => ({ id, label: P.label, did: P.did, built: !!R.built[id], votes: Math.round(R.votes.project[id] || 0), need: P.need, have: Object.fromEntries(Object.keys(P.need).map((g) => [g, Math.floor(R.proj[id][g] || 0)])) })) : [],
    target: r >= 0 ? rsimTarget(RS, r) : -1,
    levyIn: R ? Math.max(0, Math.round(R.levyAt)) : 0,
    news: RS.log.filter((L) => L[0] > since && (L[1] === r || L[1] < 0 || r < 0 || / takes /.test(L[2]))).slice(-12),
  };
}
function realmSimSanitize(o) {
  if (!o || typeof o !== 'object' || o.v !== RSIM_V || !Array.isArray(o.realms) || o.realms.length !== 3 || !Array.isArray(o.keeps)) return null;
  const RS = realmSimInit(rsimNum(o.seed, 0, 4294967295, 1), { keeps: o.keeps.slice(0, 32).map((K) => ({ name: K && K.name, home: K && K.home >= 0 && K.home <= 2 ? K.home : 0, x: K && K.x, z: K && K.z })), len: o.len, season: o.n });
  RS.rng = rsimNum(o.rng, 0, 4294967295, 1) >>> 0 || 1;
  RS.t = rsimNum(o.t, 0, RS.len * 2, 0); RS.phase = rsimPhase(RS); RS.over = o.over ? 1 : 0; RS.winner = o.winner >= 0 && o.winner <= 2 ? o.winner : -1;
  RS.realms.forEach((R, i) => {
    const S = o.realms[i] || {};
    for (const g of RSIM_GOODS) R.st[g] = rsimNum(S.st && S.st[g], 0, RSIM_T.cap[g], R.st[g]);
    R.pts = rsimNum(S.pts, 0, 1e9, 0); R.levyAt = rsimNum(S.levyAt, 0, 1e6, R.levyAt); R.made = rsimNum(S.made, 0, 1e12, 0);
    for (const k in RSIM_T.projects) { if (S.built && S.built[k]) R.built[k] = 1; const P = S.proj && S.proj[k]; if (P) for (const g in RSIM_T.projects[k].need) R.proj[k][g] = rsimNum(P[g], 0, 1e6, 0); }
    for (const kind of ['project', 'target']) { const V = S.votes && S.votes[kind]; if (V && typeof V === 'object') for (const k of Object.keys(V).slice(0, 40)) R.votes[kind][k] = rsimNum(V[k], 0, 1e6, 0); }
    if (S.given && typeof S.given === 'object') for (const k of Object.keys(S.given).slice(0, 400)) if (/^[A-Za-z0-9_-]{1,40}$/.test(k)) R.given[k] = rsimNum(S.given[k], 0, 1e9, 0);
  });
  RS.keeps.forEach((K, i) => { const S = o.keeps[i] || {}; K.r = S.r >= 0 && S.r <= 2 ? S.r : K.home; K.g = rsimNum(S.g, 0, RSIM_T.garrisonMax, 8) | 0; K.gate = S.gate ? 1 : 0; K.quiet = rsimNum(S.quiet, 0, 1e7, 0); K.siege = S.siege ? 1 : 0; });
  if (Array.isArray(o.armies)) RS.armies = o.armies.slice(0, 24).filter((A) => A && A.r >= 0 && A.r <= 2 && RS.keeps[A.to | 0]).map((A) => ({ id: rsimNum(A.id, 0, 1e9, 0) | 0, r: A.r, n: rsimNum(A.n, 0, 500, 0) | 0, x: rsimNum(A.x, -5000, 5000, 0), z: rsimNum(A.z, -5000, 5000, 0), to: A.to | 0, st: A.st === 'siege' ? 'siege' : 'march', t: rsimNum(A.t, 0, 1e5, 0) })).filter((A) => A.n > 0);
  RS.nextArmy = rsimNum(o.nextArmy, 1, 1e9, RS.armies.reduce((m, A) => Math.max(m, A.id + 1), 1)) | 0;
  if (Array.isArray(o.log)) RS.log = o.log.slice(-120).filter((L) => Array.isArray(L) && L.length === 3).map((L) => [rsimNum(L[0], 0, 1e12, 0), L[1] >= -1 && L[1] <= 2 ? L[1] | 0 : -1, String(L[2]).slice(0, 160)]);
  return RS;
}
