// [loops] The realms' own life over a season of weeks (version 19): the strategic state of the March as one plain
// JSON object (RS) and the functions that step it. NO three.js, DOM, canvas, audio or window in this file: it runs
// unchanged in Node (the server, tools/tests/loops.py) and in the page (08n_season.js wires it to the live war).
//
// The shared contract (loops and net):
//   realmSimInit(seed, opts) -> RS           a fresh season (opts: days, keeps (each keep's home realm), names, t0)
//   realmSimStep(RS, dt)                    advance dt seconds (sub-steps of at most 60 s; deterministic for a seed)
//   realmSimContribute(RS, realm, kind, amount, who)   a player's delivery (a good, gold) or work ('work': hours)
//   realmSimOrder(RS, realm, order, who)    a vote or an officer's order: { type: 'project', id } | { type: 'target', keep } | { type: 'muster' }
//   realmSimSummary(RS, realm, since)       what a returning player is told (since: RS.t of their last visit)
//   realmSimSanitize(obj)                   a saved or received RS made safe (or a fresh season)
//   realmSimLive(RS, ev)                    the live war's news: { type: 'keep', keep, holder } | { type: 'battle', winner } | { type: 'hallow', hallow, holder }
//   RS.v                                    the shape's version
// RS.live: while a player is in the page, the page's own war and stores run; RS keeps only the clock, the phases,
// the points, the projects and the offensives' plans (the page copies its stores in before a step and out after).

const RSM_V = 1;
const RSM_GOODS = ['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses', 'gold'];
const RSM_G = { food: 0, timber: 1, stone: 2, iron: 3, hides: 4, wool: 5, horses: 6, gold: 7 };
// the measures, in one place (the page's tests and the server may read them; never write them in play)
const RSM = {
  days: 42,                 // a season's length in real days (a setting)
  muster: 1 / 6,            // the share of the season before the war (no keep can fall)
  reckon: 2 / 42,           // the share at its end: the reckoning (points frozen, the winners named)
  target: [400, 160, 120, 50, 40, 30, 12, 600],  // what a realm aims to keep (as 08m_loops.js LT.target; gold its treasury)
  cap: 4,                   // a store holds cap x its target (a granary raises food's)
  prod: [170, 90, 40, 18, 16, 10, 1.2, 45],     // a realm's town at work an hour while nobody is there
  keepProd: [25, 10, 5, 0, 0, 0, 0, 6],           // a keep's land an hour, to whoever holds it
  keepLost: 0.2, keepWon: 0.15,                   // the town's work for each own keep lost and each enemy keep held (as LT)
  levyEvery: 0.25,          // hours between levies trained
  levyCost: [10, 0, 0, 1.5, 1, 0.5, 0, 2],        // a soldier trained
  levyMax: 60,              // a realm's soldiers under arms at most (besides its garrisons)
  eat: 1.8,                 // food a soldier under arms or on the walls eats an hour
  garrison: 8,              // a keep's full garrison (its guards and lord as strength)
  refillEvery: 1,           // hours between a soldier sent from the levy to a keep short of its garrison
  hours: { decide: 2, raid: 6 },
  lead: 2 / 42,             // an offensive is announced this share of the season ahead (two days in six weeks)
  march: 150,               // metres of road an hour
  siegeHours: 30,           // an army gives up a siege after this many hours
  sp: { own: 0.5, won: 2.5, hallow: 3, project: 20, tier: 12, units: 40, battle: 10, offensive: 15, work: 3 }, // season points
  price: [2, 4, 4, 15, 6, 5, 120, 0], // gold a unit at the border fairs: the treasury buys what the realm's work lacks
  catchUp: 0.35,            // a realm behind gets up to this much more work and its walls stand that much stronger
  maxLog: 80,
  // [season2] (version 20) the season's armies on the field: an army a page has brought onto the live war is its own
  // until it says otherwise or says nothing for `stale` s of the season's time (then folded back where it last stood)
  field: { stale: 180 },
  // [season2] a realm's deliveries earn season points by the day, saturating: P(D) = max (1 - e^(-D / full)) points for
  // D units of worth delivered that day (D: every player of the realm together; work counts as RSM.sp.work points an hour
  // worth): one player's hour (about 800 units) earns about 16, a crowd no more than `max` a day. The goods all go in.
  delivery: { max: 40, full: 1500 },
  // [season2] an offensive's keep, warned two days ahead: the holder may bring its garrison to `room` x a full one, with
  // up to `share` of the attackers' number from its levy (an assault or a retake: 1.5 and 0.35)
  brace: { room: 1.5, share: 0.35, feed: 0 },
  projects: {
    // (days: the quickest it can be done; the realm's stores above a reserve set the pace, so what players deliver speeds it)
    walls: { cost: [0, 1200, 3000, 240, 0, 0, 0, 0], days: 1, max: 3, name: "raise a keep's walls a tier" },
    granary: { cost: [0, 1600, 1200, 0, 0, 0, 0, 0], days: 1, max: 2, name: 'build a granary' },
    yard: { cost: [2000, 1200, 0, 0, 600, 0, 0, 0], days: 1, max: 2, name: 'a horse-breeding yard' },
    smithy: { cost: [0, 800, 1000, 800, 0, 0, 0, 0], days: 1, max: 2, name: 'a smithy to arm the levies' },
    engines: { cost: [0, 600, 120, 80, 60, 0, 0, 0], days: 0.4, max: 4, name: 'siege engines for the offensive' },
  },
};
const RSM_PROJ = ['walls', 'granary', 'yard', 'smithy', 'engines'];

// a deterministic random number (mulberry32 on RS.rs)
function rsmRand(RS) {
  let t = (RS.rs = (RS.rs + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rsmClamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rsmNum = (v, d, a, b) => (Number.isFinite(+v) ? rsmClamp(+v, a, b) : d);
const rsmDay = 86400;

// the March's places on the strategic map (the game's own layout, 01_world.js: realms on bearings 150, 270, 30;
// two keeps at 118 along +-64 across, the temple at 170, the muster at 214)
function rsmGeo() {
  const brg = [150, 270, 30], P = { keep: [], temple: [], muster: [] };
  for (let r = 0; r < 3; r++) {
    const a = (brg[r] * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a), px = -dz, pz = dx;
    const at = (al, lat) => [dx * al + px * lat, dz * al + pz * lat];
    P.keep.push(at(118, -64), at(118, 64));
    P.temple.push(at(170, 0));
    P.muster.push(at(214, 0));
  }
  return P;
}
const RSM_GEO = rsmGeo();
const rsmDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function realmSimInit(seed, opts = {}) {
  const days = rsmNum(opts.days, RSM.days, 0.01, 400);
  const homes = Array.isArray(opts.keeps) && opts.keeps.length ? opts.keeps.map((h) => rsmClamp(h | 0, 0, 2)) : [0, 0, 1, 1, 2, 2];
  const RS = {
    v: RSM_V, seed: seed >>> 0, rs: (seed >>> 0) || 1, n: rsmNum(opts.n, 1, 1, 1e6) | 0,
    t: 0, len: days * rsmDay, nextLen: 0, phase: 'muster', winner: null, t0: rsmNum(opts.t0, 0, 0, 1e14), live: false,
    names: { realms: ['Logres', 'Ériu', 'Thule'], keeps: homes.map((h, i) => `the ${['Logres', 'Ériu', 'Thule'][h]} keep ${i % 2 ? 'east' : 'west'}`) },
    realms: [0, 1, 2].map((r) => ({
      s: RSM.target.map((v) => Math.round(v * 0.8)), bank: [0, 0, 0, 0, 0, 0, 0, 0], lev: 12, sp: 0, del: 0, work: 0, proj: { walls: 0, granary: 0, yard: 0, smithy: 0, engines: 0 },
      act: 'granary', prog: 0, votes: {}, aim: -1, short: [], hungry: 0, by: {}, raidAt: 0, decideAt: 0, levyAt: 0, refillAt: 0, dDay: -1, dWorth: 0, // [season2] the day's deliveries
      stats: { trained: 0, lost: 0, taken: 0, raids: 0, made: 0, ate: 0, offensives: 0, won: 0, hungryH: 0, poured: 0, bought: 0 },
    })),
    keeps: homes.map((h) => ({ h, home: h, g: RSM.garrison, tier: 0, gate: 1, siege: null })),
    hallows: [0, 1, 2],     // where each realm's hallow stands (in whose temple)
    hallowAt: [0, 0, 0],    // RS.t each was taken (it goes home after two days)
    armies: [], nextArmy: 1,
    offs: [],               // offensives: { r, k, at, ann, state: 'planned'|'march'|'siege'|'done', army, res }
    log: [], past: [],
    stats: { captures: 0, sieges: 0, relief: 0, raids: 0, battles: 0 },
  };
  if (opts.names && Array.isArray(opts.names.realms)) RS.names.realms = opts.names.realms.slice(0, 3).map(String);
  if (opts.names && Array.isArray(opts.names.keeps)) RS.names.keeps = opts.names.keeps.slice(0, homes.length).map(String);
  RS.names.realms = RS.names.realms.map((s) => s.slice(0, 40));
  RS.names.keeps = RS.names.keeps.map((s) => s.slice(0, 60));
  rsmLog(RS, -1, `The ${rsmOrd(RS.n)} season of the March begins: ${Math.round(days)} days, the muster first (${rsmDur(RS.len * RSM.muster)}). Raise your stores, build and train: no keep can fall until the war.`);
  return RS;
}
const RSM_ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const rsmOrd = (n) => RSM_ORD[n] || `${n}th`;
function rsmDur(s) {
  s = Math.max(0, s);
  const d = Math.floor(s / rsmDay), h = Math.floor((s % rsmDay) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function rsmLog(RS, r, text, kind = 'news') {
  RS.ln = (RS.ln || 0) + 1; // (how many lines ever: a reader keeps its place in a log trimmed at its head)
  RS.log.push({ t: Math.round(RS.t), r, k: kind, x: String(text).slice(0, 300) });
  if (RS.log.length > RSM.maxLog) RS.log.splice(0, RS.log.length - RSM.maxLog);
}
const rsmRN = (RS, r) => RS.names.realms[r] || `Realm ${r}`;
const rsmKN = (RS, k) => RS.names.keeps[k] || `keep ${k}`;
const rsmWarAt = (RS) => RS.len * RSM.muster;
const rsmReckonAt = (RS) => RS.len * (1 - RSM.reckon);
function rsmPhaseOf(RS) { return RS.t < rsmWarAt(RS) ? 'muster' : RS.t < rsmReckonAt(RS) ? 'war' : 'reckon'; }
function rsmCap(R, g) { return RSM.target[g] * RSM.cap * (g === 0 ? 1 + 0.5 * R.proj.granary : 1) * (g === 6 ? 1 + 0.5 * R.proj.yard : 1); }
function rsmAdd(R, g, n) { R.s[g] = rsmClamp(R.s[g] + n, 0, rsmCap(R, g)); }
// a realm's place in the standing: 0 leads; how far behind the leader (0..1)
function rsmBehind(RS, r) {
  const top = Math.max(...RS.realms.map((q) => q.sp)), me = RS.realms[r].sp;
  return top <= 0 ? 0 : rsmClamp((top - me) / Math.max(30, top), 0, 1);
}
function rsmKeepsOf(RS, r) { return RS.keeps.reduce((a, K) => a + (K.h === r ? 1 : 0), 0); }
function rsmLandK(RS, r) {
  let k = 1;
  RS.keeps.forEach((K) => { if (K.home === r && K.h !== r) k -= RSM.keepLost; if (K.home !== r && K.h === r) k += RSM.keepWon; });
  return rsmClamp(k, 0.4, 1.6);
}

/* ------------------------------------------------------------------ */
/* a step                                                              */
/* ------------------------------------------------------------------ */
function realmSimStep(RS, dt) {
  if (!RS || !(dt > 0)) return RS;
  let left = Math.min(dt, 400 * rsmDay);
  while (left > 1e-6) { const h = Math.min(60, left); rsmSub(RS, h); left -= h; }
  return RS;
}
function rsmSub(RS, dt) {
  const hr = dt / 3600;
  RS.t += dt;
  const ph = rsmPhaseOf(RS);
  if (ph !== RS.phase) rsmPhase(RS, RS.phase, ph);
  if (RS.t >= RS.len) { rsmNewSeason(RS); return; }
  for (let r = 0; r < 3; r++) {
    const R = RS.realms[r];
    if (!RS.live) rsmEconomy(RS, r, R, hr);
    rsmProject(RS, r, R, hr);
    if (RS.phase !== 'reckon') rsmPoints(RS, r, R, hr);
    if (RS.phase !== 'reckon' && RS.t >= R.decideAt) { R.decideAt = RS.t + RSM.hours.decide * 3600 * (0.8 + 0.4 * rsmRand(RS)); rsmDecide(RS, r, R); }
  }
  rsmArmies(RS, hr); // [season2] while a player is in the page too: the armies on the field are the page's, the rest by the numbers
  if (!RS.live) rsmHallowsHome(RS);
  rsmOffensives(RS);
}
function rsmPhase(RS, from, to) {
  RS.phase = to;
  if (to === 'war') rsmLog(RS, -1, `The muster is over: the ${rsmOrd(RS.n)} season's war begins. Keeps and hallows can change hands; each hour a keep or a hallow held counts for its realm.`, 'big');
  if (to === 'reckon') {
    const order = [0, 1, 2].sort((a, b) => RS.realms[b].sp - RS.realms[a].sp);
    RS.winner = order[0];
    for (const A of RS.armies) rsmArmyHome(RS, A, 'the reckoning');
    rsmLog(RS, -1, `The reckoning: the war of the ${rsmOrd(RS.n)} season is over. ${rsmRN(RS, order[0])} has won it with ${Math.round(RS.realms[order[0]].sp)} points, ${rsmRN(RS, order[1])} ${Math.round(RS.realms[order[1]].sp)}, ${rsmRN(RS, order[2])} ${Math.round(RS.realms[order[2]].sp)}.`, 'big');
  }
}
function rsmNewSeason(RS) {
  const rec = { n: RS.n, w: RS.winner != null ? RS.winner : [0, 1, 2].sort((a, b) => RS.realms[b].sp - RS.realms[a].sp)[0], sp: RS.realms.map((R) => Math.round(R.sp)), keeps: RS.keeps.map((K) => K.h), end: Math.round(RS.t0 / 1000 + RS.t) };
  RS.past.push(rec);
  while (RS.past.length > 12) RS.past.shift();
  RS.n++; RS.t = 0; RS.phase = 'muster'; RS.winner = null; RS.armies = []; RS.offs = [];
  RS.t0 += RS.len * 1000;
  if (RS.nextLen) { RS.len = RS.nextLen; RS.nextLen = 0; } // (a length chosen for the next season)
  for (const K of RS.keeps) Object.assign(K, { h: K.home, g: RSM.garrison, tier: Math.min(K.tier, 1), gate: 1, siege: null });
  RS.hallows = [0, 1, 2];
  for (const R of RS.realms) {
    R.sp = 0; R.del = 0; R.work = 0; R.votes = {}; R.aim = -1; R.by = {}; R.lev = Math.max(12, Math.round(R.lev * 0.5)); R.hungry = 0;
    R.proj.engines = 0; R.proj.smithy = Math.min(R.proj.smithy, 1); R.proj.granary = Math.min(R.proj.granary, 1); R.proj.yard = Math.min(R.proj.yard, 1);
    for (let g = 0; g < RSM_GOODS.length; g++) R.s[g] = Math.max(R.s[g] * 0.5, RSM.target[g] * 0.8);
  }
  rsmLog(RS, -1, `${rsmRN(RS, rec.w)} won the ${rsmOrd(rec.n)} season. The ${rsmOrd(RS.n)} season begins: every keep and hallow back with its own realm, the muster first.`, 'big');
}

// stores: the town and the keeps' land at work, the soldiers eating, the levies trained, the garrisons filled
function rsmEconomy(RS, r, R, hr) {
  const land = rsmLandK(RS, r), up = 1 + RSM.catchUp * rsmBehind(RS, r);
  for (let g = 0; g < 8; g++) {
    let p = RSM.prod[g] * (g === 6 ? 1 + 0.6 * R.proj.yard : land * up) * (R.pk ? R.pk[g] : 1); // (R.pk: a test's or a server's knob on a realm's work)
    for (const K of RS.keeps) if (K.h === r) p += RSM.keepProd[g];
    rsmAdd(R, g, p * hr);
  }
  // the soldiers eat (the levy, the garrisons of the keeps it holds, the armies in the field)
  let mouths = R.lev;
  for (const K of RS.keeps) if (K.h === r) mouths += K.g;
  for (const A of RS.armies) if (A.r === r) mouths += A.n;
  const want = mouths * RSM.eat * hr;
  R.stats.ate += Math.min(want, R.s[0]);
  if (R.s[0] >= want) { R.s[0] -= want; R.hungry = Math.max(0, R.hungry - hr); }
  else { R.s[0] = 0; R.hungry = Math.min(48, R.hungry + hr); R.stats.hungryH += hr; }
  // levies trained from the town (food and gear a soldier) up to the realm's strength
  if (RS.t >= R.levyAt) {
    R.levyAt = RS.t + RSM.levyEvery * 3600;
    const fieldN = RS.armies.filter((A) => A.r === r).reduce((a, A) => a + A.n, 0);
    if (R.lev + fieldN < RSM.levyMax * (1 + 0.15 * R.proj.smithy) && rsmPay(R, RSM.levyCost)) { R.lev++; R.stats.trained++; }
  }
  // a keep short of its garrison is sent a soldier from the levy
  if (RS.t >= R.refillAt) {
    R.refillAt = RS.t + RSM.refillEvery * 3600;
    const K = RS.keeps.filter((q) => q.h === r && !q.siege && q.g < RSM.garrison).sort((a, b) => a.g - b.g)[0];
    if (K && R.lev > 4) { R.lev--; K.g++; }
  }
  // the gates and walls mended in quiet (timber and stone)
  for (const K of RS.keeps) if (K.h === r && !K.siege && K.gate < 1) { const n = 0.08 * hr; if (R.s[1] >= 6 * n * 10 && R.s[2] >= 6 * n * 10) { R.s[1] -= 60 * n; R.s[2] -= 60 * n; K.gate = Math.min(1, K.gate + n); } }
  R.short = [];
  for (let g = 0; g < 7; g++) if (R.s[g] < RSM.target[g] * 0.2) R.short.push(RSM_GOODS[g]);
}
function rsmPay(R, cost) {
  for (let g = 0; g < 8; g++) if (cost[g] > R.s[g]) return false;
  for (let g = 0; g < 8; g++) R.s[g] -= cost[g];
  return true;
}

// the realm's project: its goods drawn over its days (faster with the players' work), done once all are in
function rsmProject(RS, r, R, hr) {
  const id = R.act, P = RSM.projects[id];
  if (!P) return;
  if (R.proj[id] >= P.max) { rsmNextProject(RS, r, R); return; }
  const banked = P.cost.reduce((a, c, g) => (c > 0 ? Math.min(a, R.bank[g] / c) : a), 1);
  const pace = hr / (P.days * 24) * (1 + Math.min(3, R.work / 20) + 4 * banked); // the players' work (hours given) and goods brought quicken it
  let got = 1;
  // (it draws only above a reserve of half the target: the war's own needs come first)
  // the treasury buys at the border fairs what the work lacks this step (above the reserve the war keeps)
  for (let g = 0; g < 7; g++) {
    if (!(P.cost[g] > 0)) continue;
    const want = P.cost[g] * pace - (Math.max(0, R.s[g] - RSM.target[g] * 0.5) + R.bank[g]);
    if (want <= 0) continue;
    const n = Math.min(want * 0.3, Math.max(0, R.s[7] - RSM.target[7] * 0.25) / RSM.price[g]); // (a fair sells a little at a time)
    if (n > 0) { R.s[7] -= n * RSM.price[g]; R.bank[g] += n; R.stats.bought += n; }
  }
  // (the goods the players brought for the works, R.bank, first)
  for (let g = 0; g < 8; g++) if (P.cost[g] > 0) got = Math.min(got, (Math.max(0, R.s[g] - RSM.target[g] * 0.5) + R.bank[g]) / (P.cost[g] * pace + 1e-9));
  got = rsmClamp(got, 0, 1);
  if (got <= 0) return;
  for (let g = 0; g < 8; g++) { const n = P.cost[g] * pace * got, b = Math.min(R.bank[g], n); R.bank[g] -= b; R.s[g] = Math.max(0, R.s[g] - (n - b)); R.stats.poured += n; }
  R.prog += pace * got;
  R.work = Math.max(0, R.work - hr * 4);
  if (R.prog >= 1) {
    R.prog = 0; R.proj[id]++; R.stats.made++;
    R.sp += id === 'walls' ? RSM.sp.tier : id === 'engines' ? RSM.sp.project / 4 : RSM.sp.project;
    let what = P.name;
    if (id === 'walls') {
      const K = rsmWallsKeep(RS, r);
      if (K >= 0) { RS.keeps[K].tier = Math.min(3, RS.keeps[K].tier + 1); what = `the walls of ${rsmKN(RS, K)} raised to tier ${RS.keeps[K].tier}`; R.proj.walls = Math.max(...RS.keeps.filter((q) => q.h === r).map((q) => q.tier), 0); }
    } else if (id === 'granary') what = `a granary (food stored up to ${Math.round(rsmCap(R, 0))})`;
    else if (id === 'yard') what = 'a horse-breeding yard (more horses for the captains)';
    else if (id === 'smithy') what = 'a smithy (the levies better armed)';
    else if (id === 'engines') what = `a siege engine for the offensive (${R.proj.engines} ready)`;
    rsmLog(RS, r, `${rsmRN(RS, r)} has finished its project: ${what}.`, 'proj');
    rsmNextProject(RS, r, R);
  }
}
function rsmWallsKeep(RS, r) {
  let best = -1, bs = -1e9;
  RS.keeps.forEach((K, i) => {
    if (K.h !== r || K.tier >= 3) return;
    let s = -K.tier * 2 + (K.home === r ? 1 : 0);
    if (RS.offs.some((O) => O.k === i && O.r !== r && O.state !== 'done')) s += 5; // a keep an offensive is announced against
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}
// the next project: the players' votes first, else what the realm lacks most
function rsmNextProject(RS, r, R) {
  const can = RSM_PROJ.filter((id) => (id === 'walls' ? rsmWallsKeep(RS, r) >= 0 : R.proj[id] < RSM.projects[id].max));
  if (!can.length) { R.act = ''; return; }
  let best = can[0], bs = -1e9;
  for (const id of can) {
    let s = (R.votes[id] || 0) * 3 - R.proj[id] * 2;
    if (id === 'engines') s += RS.offs.some((O) => O.r === r && O.state === 'planned') ? 6 : RS.phase === 'muster' ? 2 : 0;
    if (id === 'walls') s += RS.offs.some((O) => O.r !== r && O.state !== 'done' && RS.keeps[O.k].h === r) ? 7 : 1;
    if (id === 'granary' && R.s[0] > rsmCap(R, 0) * 0.85) s += 3;
    if (id === 'smithy') s += 1.5;
    s += rsmRand(RS);
    if (s > bs) { bs = s; best = id; }
  }
  R.act = best; R.votes = {};
}

// season points by the hour: keeps and hallows held
function rsmPoints(RS, r, R, hr) {
  if (RS.phase === 'muster') return; // (in the muster the points come from building and delivering)
  let p = 0;
  RS.keeps.forEach((K) => { if (K.h === r) p += K.home === r ? RSM.sp.own : RSM.sp.won; });
  RS.hallows.forEach((at, i) => { if (at === r && i !== r) p += RSM.sp.hallow; });
  R.sp += p * hr;
}

/* ------------------------------------------------------------------ */
/* the strategic war: offensives announced days ahead, raids, sieges   */
/* ------------------------------------------------------------------ */
function rsmDecide(RS, r, R) {
  if (RS.phase === 'reckon') return;
  const planned = RS.offs.find((O) => O.r === r && O.state !== 'done');
  // an offensive announced days ahead, to land in the war (in the muster: to land once it begins)
  if (!planned && (RS.phase === 'war' || RS.t > rsmWarAt(RS) - RSM.lead * RS.len)) {
    const k = rsmTarget(RS, r);
    const lead = RSM.lead * RS.len;
    const at = Math.max(RS.t + lead, rsmWarAt(RS) + 3600 * (2 + 8 * rsmRand(RS)));
    if (k >= 0 && at < rsmReckonAt(RS) - 12 * 3600) {
      RS.offs.push({ r, k, at: Math.round(at), ann: Math.round(RS.t), state: 'planned', army: 0, res: '', liveUntil: 0 });
      R.stats.offensives++;
      rsmLog(RS, r, `${rsmRN(RS, r)} announces its offensive: it will march on ${rsmKN(RS, k)} (held by ${rsmRN(RS, RS.keeps[k].h)}) in ${rsmDur(at - RS.t)}. Both realms prepare.`, 'big');
    }
  }
  if (RS.phase !== 'war') return; // [season2] (while a player is in the page too: its armies near the player are bands of the live war)
  // a raid on an enemy's fields and yards, now and then
  if (RS.t >= R.raidAt && R.lev >= 16 && !RS.armies.some((A) => A.r === r && A.kind === 'raid')) {
    R.raidAt = RS.t + RSM.hours.raid * 3600 * (0.7 + 0.6 * rsmRand(RS));
    const foes = [0, 1, 2].filter((q) => q !== r);
    const q = rsmRand(RS) < 0.6 ? foes.sort((a, b) => RS.realms[b].sp - RS.realms[a].sp)[0] : foes[rsmRand(RS) < 0.5 ? 0 : 1];
    rsmArmy(RS, r, 8, 'raid', -1, q);
  }
  // a hallow raid: a realm holding three keeps or more on an enemy temple whose realm has lost a keep
  if (!RS.live && rsmKeepsOf(RS, r) >= 3 && R.lev >= 24 && !RS.armies.some((A) => A.r === r && A.kind === 'hallow')) {
    const q = [0, 1, 2].find((t) => t !== r && RS.hallows[t] === t && rsmKeepsOf(RS, t) < 2);
    if (q != null && rsmRand(RS) < 0.35) rsmArmy(RS, r, 14, 'hallow', -1, q);
  }
  // a keep of its own in other hands with no offensive for it: take it back
  const lostK = RS.keeps.findIndex((K) => K.home === r && K.h !== r && !RS.armies.some((A) => A.r === r && A.k === RS.keeps.indexOf(K)));
  if (lostK >= 0 && R.lev >= 26 && !planned) rsmArmy(RS, r, Math.min(R.lev - 6, 30), 'assault', lostK);
}
// what an offensive goes for: the keep it can take that weighs most (the leader's first, a keep of its own back)
function rsmTarget(RS, r) {
  const R = RS.realms[r];
  if (R.aim >= 0 && RS.keeps[R.aim] && RS.keeps[R.aim].h !== r) return R.aim;
  const lead = [0, 1, 2].sort((a, b) => RS.realms[b].sp - RS.realms[a].sp)[0];
  let best = -1, bs = -1e9;
  RS.keeps.forEach((K, i) => {
    if (K.h === r) return;
    if (RS.offs.some((O) => O.k === i && O.state !== 'done')) return;
    let s = -K.g * 1.5 - K.tier * 4 + (K.home === r ? 12 : 0) + (K.h === lead && lead !== r ? 10 : 0);
    s -= rsmDist(RSM_GEO.muster[r], RSM_GEO.keep[i]) / 60;
    s += rsmRand(RS) * 3;
    if (s > bs) { bs = s; best = i; }
  });
  return best;
}
function rsmArmy(RS, r, n, kind, k, q = -1) {
  const R = RS.realms[r];
  n = Math.min(n | 0, R.lev);
  if (n < 4) return null;
  R.lev -= n;
  const from = RSM_GEO.muster[r], to = k >= 0 ? RSM_GEO.keep[k] : q >= 0 ? (kind === 'hallow' ? RSM_GEO.temple[q] : RSM_GEO.muster[q]) : from;
  const eng = kind === 'assault' || kind === 'offensive' ? Math.min(R.proj.engines, kind === 'offensive' ? 4 : 1) : 0;
  R.proj.engines -= eng;
  const A = { id: RS.nextArmy++, r, n, n0: n, kind, k, q, eng, p: 0, len: Math.max(60, rsmDist(from, to)), state: 'march', t0: Math.round(RS.t), siegeH: 0, hungry: R.hungry > 2 ? 1 : 0, arm: 1 + 0.12 * R.proj.smithy };
  RS.armies.push(A);
  if (kind === 'raid') rsmLog(RS, r, `${rsmRN(RS, r)} sends ${n} raiders against the fields and yards of ${rsmRN(RS, q)}.`);
  else if (kind === 'hallow') rsmLog(RS, r, `${rsmRN(RS, r)} sends ${n} riders to steal ${rsmRN(RS, q)}'s hallow while its temple stands open.`, 'big');
  else rsmLog(RS, r, `${rsmRN(RS, r)} marches ${n} soldiers${eng ? ` and ${eng} engine${eng > 1 ? 's' : ''}` : ''} on ${rsmKN(RS, k)}.`, kind === 'offensive' ? 'big' : 'news');
  return A;
}
function rsmArmyHome(RS, A, why) {
  const R = RS.realms[A.r];
  R.lev = Math.min(RSM.levyMax * 2, R.lev + A.n);
  A.state = 'gone';
  if (A.k >= 0 && RS.keeps[A.k].siege && RS.keeps[A.k].siege.a === A.id) RS.keeps[A.k].siege = null;
  if (why) rsmLog(RS, A.r, `${rsmRN(RS, A.r)}'s army of ${Math.round(A.n)} goes home from ${A.k >= 0 ? rsmKN(RS, A.k) : 'the field'}: ${why}.`);
}
function rsmArmies(RS, hr) {
  for (const A of RS.armies) {
    if (A.state === 'gone') continue;
    if (A.onField) { if (RS.t - A.onField.at <= RSM.field.stale) continue; A.onField = null; A.s2fold = (A.s2fold || 0) + 1; } // [season2] the page's, or folded back unheard
    const R = RS.realms[A.r];
    if (A.state === 'march') {
      A.p += (RSM.march * hr) / A.len;
      if (A.p < 1) continue;
      if (A.kind === 'raid') { rsmRaid(RS, A); continue; }
      if (A.kind === 'hallow') { rsmHallowRaid(RS, A); continue; }
      const K = RS.keeps[A.k];
      if (K.h === A.r) { const n = Math.max(0, Math.min(A.n, RSM.garrison * 1.5 - K.g)); K.g += n; A.n -= n; rsmArmyHome(RS, A, ''); continue; }
      if (RS.phase !== 'war') { rsmArmyHome(RS, A, 'the keeps cannot fall in the muster'); continue; }
      A.state = 'siege';
      K.siege = { a: A.id, t: Math.round(RS.t) };
      RS.stats.sieges++;
      rsmLog(RS, A.r, `${rsmRN(RS, A.r)} lays siege to ${rsmKN(RS, A.k)} (${A.n} against ${Math.round(K.g)} on its walls).`, 'big');
      // the holder sends what it can spare to relieve it
      const D = RS.realms[K.h];
      // [season2] an offensive was announced days ahead: the holder has had time to bring more to its walls
      const warned = A.kind === 'offensive', room = Math.max(0, Math.round(RSM.garrison * (warned ? RSM.brace.room : 1.5) - K.g));
      if (D.lev >= 8 && room > 0) { const n = Math.min(D.lev - 4, Math.round(A.n * (warned ? RSM.brace.share : 0.35)), room); D.lev -= n; K.g += n; RS.stats.relief++; rsmLog(RS, K.h, `${rsmRN(RS, K.h)} sends ${n} soldiers to relieve ${rsmKN(RS, A.k)}.`); }
      continue;
    }
    if (A.state === 'siege') rsmSiege(RS, A, R, hr);
  }
  RS.armies = RS.armies.filter((A) => A.state !== 'gone');
}
// a siege resolved by the numbers, an hour at a time
function rsmSiege(RS, A, R, hr) {
  const K = RS.keeps[A.k], D = RS.realms[K.h];
  A.siegeH += hr;
  if (K.h === A.r) { rsmArmyHome(RS, A, ''); return; }
  const hungryA = R.hungry > 2 ? 0.85 : 1, hungryD = D.hungry > 2 ? 0.85 : 1;
  // [season2] an offensive's keep, warned: the holder keeps feeding its walls from the levy while the siege lasts
  if (A.kind === 'offensive' && D.lev > 6) { const n = Math.min(D.lev - 6, RSM.brace.feed * hr, Math.max(0, RSM.garrison * RSM.brace.room - K.g)); D.lev -= n; K.g += n; }
  const att = A.n * A.arm * hungryA * (1 + 0.3 * A.eng) * (1 + 0.4 * rsmBehind(RS, A.r));
  const def = (K.g + 3) * (1 + 0.12 * D.proj.smithy) * hungryD * (1 + 0.3 * K.tier) * (K.gate > 0 ? 1.5 : 1) * (1 + RSM.catchUp * rsmBehind(RS, K.h));
  // the gate gives way to the engines and the rams
  K.gate = Math.max(0, K.gate - hr * (0.03 + 0.07 * A.eng) * (1 - 0.15 * K.tier));
  const lossA = def * 0.07 * hr * (0.8 + 0.4 * rsmRand(RS)), lossD = att * 0.05 * hr * (K.gate > 0 ? 0.5 : 1) * (0.8 + 0.4 * rsmRand(RS));
  A.n = Math.max(0, A.n - lossA); K.g = Math.max(0, K.g - lossD);
  R.stats.lost += lossA; D.stats.lost += lossD;
  if (K.g < 0.5) {
    const old = K.h;
    K.h = A.r; K.g = Math.min(RSM.garrison, A.n); A.n -= K.g; K.gate = Math.max(K.gate, 0.3); K.siege = null;
    // the keep's stores go with it: a share of the loser's
    for (const g of [0, 1, 2, 3]) { const take = Math.min(RS.realms[old].s[g] * 0.08, RSM.target[g] * 0.5); RS.realms[old].s[g] -= take; rsmAdd(R, g, take); }
    RS.stats.captures++; R.stats.taken++;
    const O = RS.offs.find((q) => q.r === A.r && q.k === A.k && q.state === 'siege');
    if (O) { O.state = 'done'; O.res = 'taken'; R.sp += RSM.sp.offensive; R.stats.won++; }
    rsmLog(RS, A.r, `${rsmKN(RS, A.k)} has fallen to ${rsmRN(RS, A.r)}${O ? ' in its offensive' : ''}, taken from ${rsmRN(RS, old)}.`, 'big');
    rsmArmyHome(RS, A, '');
    return;
  }
  if (A.n < A.n0 * 0.3 || A.siegeH > RSM.siegeHours || RS.phase !== 'war') {
    const O = RS.offs.find((q) => q.r === A.r && q.k === A.k && q.state === 'siege');
    if (O) { O.state = 'done'; O.res = 'held'; D.sp += RSM.sp.offensive * 0.6; }
    K.siege = null;
    rsmArmyHome(RS, A, A.n < A.n0 * 0.3 ? `beaten back by ${rsmRN(RS, K.h)}` : 'the siege given up');
  }
}
function rsmRaid(RS, A, field) {
  const V = RS.realms[A.q], R = RS.realms[A.r];
  // the victim's own levy may catch them: the raid's worth by the numbers ([season2] or as the field decided)
  const caught = field ? field === 'caught' : rsmRand(RS) < rsmClamp(V.lev / (V.lev + A.n * 3), 0.1, 0.7);
  if (caught) { const lost = Math.ceil(A.n * 0.5); A.n -= lost; R.stats.lost += lost; rsmLog(RS, A.q, `${rsmRN(RS, A.q)} caught ${rsmRN(RS, A.r)}'s raiders in its fields: ${lost} fell.`); }
  else {
    const loot = [];
    for (const g of [0, 1, 4]) { const take = Math.min(V.s[g] * 0.12, RSM.target[g] * 0.6); V.s[g] -= take; rsmAdd(R, g, take * 0.6); if (take >= 1) loot.push(`${Math.round(take)} ${RSM_GOODS[g]}`); }
    RS.stats.raids++; R.stats.raids++;
    rsmLog(RS, A.r, `${rsmRN(RS, A.r)}'s raiders burnt and carried off ${loot.join(', ') || 'little'} from ${rsmRN(RS, A.q)}'s fields and yards.`);
  }
  rsmArmyHome(RS, A, '');
}
function rsmHallowRaid(RS, A) {
  const q = A.q, def = RS.realms[q].lev * 0.5 + 6;
  if (RS.hallows[q] === q && rsmKeepsOf(RS, q) < 2 && rsmRand(RS) < A.n / (A.n + def)) {
    RS.hallows[q] = A.r; RS.hallowAt[q] = Math.round(RS.t);
    rsmLog(RS, A.r, `${rsmRN(RS, A.r)} has carried ${rsmRN(RS, q)}'s hallow home to its temple!`, 'big');
  } else rsmLog(RS, q, `${rsmRN(RS, q)} turned back ${rsmRN(RS, A.r)}'s riders at its temple.`);
  rsmArmyHome(RS, A, '');
}
function rsmHallowsHome(RS) {
  RS.hallows.forEach((at, i) => {
    if (at !== i && RS.t - RS.hallowAt[i] > 2 * rsmDay) { RS.hallows[i] = i; rsmLog(RS, i, `${rsmRN(RS, i)}'s hallow is home again.`); }
  });
}
// an offensive's day: its army marches with every engine stockpiled
function rsmOffensives(RS) {
  for (const O of RS.offs) {
    if (O.state !== 'planned' || RS.t < O.at) continue;
    if (RS.phase !== 'war') { O.state = 'done'; O.res = 'called off'; continue; }
    if (RS.keeps[O.k].h === O.r) { O.state = 'done'; O.res = 'taken'; continue; }
    const R = RS.realms[O.r];
    const A = rsmArmy(RS, O.r, Math.max(12, R.lev - 4), 'offensive', O.k);
    if (!A) { O.state = 'done'; O.res = 'too few'; rsmLog(RS, O.r, `${rsmRN(RS, O.r)}'s offensive on ${rsmKN(RS, O.k)} is called off: too few soldiers under arms.`); continue; }
    O.state = 'siege'; O.army = A.id;
  }
  for (const O of RS.offs) if (O.state === 'live' && (RS.t > O.liveUntil || !RS.live)) { O.state = 'done'; O.res = RS.keeps[O.k].h === O.r ? 'taken' : 'held'; }
  if (RS.offs.length > 30) RS.offs = RS.offs.slice(-30);
}

/* ------------------------------------------------------------------ */
/* the players                                                         */
/* ------------------------------------------------------------------ */
// [season2] a realm's deliveries by the day: the points a delivery of `worth` units earns on top of what its players
// gave today (the day of the season's clock), saturating at RSM.delivery.max a day
function rsmDeliverPts(RS, R, worth) {
  const day = Math.floor(RS.t / rsmDay), D = RSM.delivery;
  if (R.dDay !== day) { R.dDay = day; R.dWorth = 0; }
  const P = (x) => D.max * (1 - Math.exp(-x / D.full));
  const a = R.dWorth || 0;
  R.dWorth = a + worth;
  return P(a + worth) - P(a);
}
// a player's delivery or work. kind: a good of RSM_GOODS (amount: units), or 'work' (hours given to the project).
// Returns the season points it earned the realm.
function realmSimContribute(RS, realm, kind, amount, who) {
  const R = RS && RS.realms[realm | 0];
  amount = rsmNum(amount, 0, 0, 1e6);
  if (!R || !(amount > 0)) return 0;
  let pts = 0;
  if (kind === 'work') { R.work = Math.min(200, R.work + amount); pts = rsmDeliverPts(RS, R, amount * RSM.sp.work * RSM.sp.units); } // [season2]
  else if (RSM_G[kind] != null) {
    const g = RSM_G[kind];
    // into the stores up to their cap; the rest is kept for the realm's works (up to twice what its project wants)
    const room = Math.max(0, rsmCap(R, g) - R.s[g]), into = Math.min(room, amount);
    rsmAdd(R, g, into);
    const P = RSM.projects[R.act];
    R.bank[g] = Math.min(R.bank[g] + amount - into, Math.max(2 * (P ? P.cost[g] : 0), RSM.target[g]));
    const worth = g === 7 ? amount / 4 : g === 6 ? amount * 40 : g === 3 ? amount * 4 : amount;
    R.del += worth;
    pts = rsmDeliverPts(RS, R, worth); // [season2] by the day, saturating (was worth / RSM.sp.units)
  } else return 0;
  if (RS.phase === 'reckon') pts = 0;
  R.sp += pts;
  const w = String(who || 'someone').slice(0, 40);
  R.by[w] = Math.round(((R.by[w] || 0) + pts) * 100) / 100;
  const keys = Object.keys(R.by);
  if (keys.length > 40) { keys.sort((a, b) => R.by[a] - R.by[b]); delete R.by[keys[0]]; }
  return pts;
}
// a vote (weight by realm rank) or an officer's order (rank 5 and up decides at once).
// order: { type: 'project', id } | { type: 'target', keep } | { type: 'muster' }; who: { name, rank }
function realmSimOrder(RS, realm, order, who) {
  const R = RS && RS.realms[realm | 0];
  if (!R || !order || typeof order !== 'object') return false;
  const rank = rsmNum(who && who.rank, 1, 0, 20), name = String((who && who.name) || 'someone').slice(0, 40), officer = rank >= 5;
  if (order.type === 'project' && RSM.projects[order.id]) {
    if (order.id !== 'walls' && R.proj[order.id] >= RSM.projects[order.id].max) return false;
    if (officer || R.act === '' || R.prog < 0.02) { if (R.act !== order.id) { R.act = order.id; R.prog = 0; rsmLog(RS, realm, `${name} sets ${rsmRN(RS, realm)}'s work: ${RSM.projects[order.id].name}.`, 'proj'); } }
    else R.votes[order.id] = (R.votes[order.id] || 0) + 1 + rank / 5;
    return true;
  }
  if (order.type === 'target') {
    const k = order.keep | 0;
    if (!RS.keeps[k] || RS.keeps[k].h === realm) return false;
    if (!officer) return false;
    R.aim = k;
    rsmLog(RS, realm, `${name} names ${rsmKN(RS, k)} for ${rsmRN(RS, realm)}'s next offensive.`);
    return true;
  }
  if (order.type === 'muster') {
    if (!officer) return false; // [season2] (while a player is in the page too: its army comes onto the field near the player)
    const k = R.aim >= 0 ? R.aim : rsmTarget(RS, realm);
    return k >= 0 && RS.phase === 'war' && !!rsmArmy(RS, realm, Math.min(R.lev - 4, 30), 'assault', k);
  }
  return false;
}
// the live war's news into RS (the page: a keep taken in the field, a battle won, a hallow carried)
function realmSimLive(RS, ev) {
  if (!RS || !ev) return;
  if (ev.type === 'keep' && RS.keeps[ev.keep] && ev.holder >= 0 && ev.holder < 3) {
    if (RS.phase !== 'war') return; // the muster's skirmishes: the keeps go back at the battle's end
    const K = RS.keeps[ev.keep];
    if (K.h === ev.holder) return;
    const old = K.h;
    K.h = ev.holder; K.siege = null; K.g = Math.max(K.g * 0.5, 3);
    const O = RS.offs.find((q) => q.r === ev.holder && q.k === ev.keep && (q.state === 'live' || q.state === 'siege')); // [season2] (an offensive's army in the field: 'siege')
    if (O) { O.state = 'done'; O.res = 'taken'; RS.realms[ev.holder].sp += RSM.sp.offensive; RS.realms[ev.holder].stats.won++; }
    // [season2] the taker's armies marching on it or at its walls (but those on a page's field, which says so itself) go home,
    // their soldiers into its garrison first
    for (const A of RS.armies) if (A.state !== 'gone' && A.r === ev.holder && A.k === ev.keep && !A.onField) { const n = Math.max(0, Math.min(A.n, RSM.garrison * 1.5 - K.g)); K.g += n; A.n -= n; rsmArmyHome(RS, A, ''); }
    RS.armies = RS.armies.filter((A) => A.state !== 'gone');
    RS.stats.captures++;
    rsmLog(RS, ev.holder, `${rsmKN(RS, ev.keep)} has fallen to ${rsmRN(RS, ev.holder)} in the field, taken from ${rsmRN(RS, old)}.`, 'big');
  } else if (ev.type === 'battle' && ev.winner >= 0 && ev.winner < 3) {
    if (RS.phase === 'reckon') return;
    RS.realms[ev.winner].sp += RSM.sp.battle * (RS.phase === 'muster' ? 0.5 : 1);
    RS.stats.battles++;
    rsmLog(RS, ev.winner, `${rsmRN(RS, ev.winner)} won a battle for the March${RS.phase === 'muster' ? ' in the muster\'s skirmishes' : ''}.`);
  } else if (ev.type === 'hallow' && ev.hallow >= 0 && ev.hallow < 3 && ev.holder >= 0 && ev.holder < 3) {
    if (RS.phase !== 'war') return;
    RS.hallows[ev.hallow] = ev.holder; RS.hallowAt[ev.hallow] = Math.round(RS.t);
  }
}
// what a returning player is told: the season's clock and standing, the realm's stores, project and needs, the
// offensives announced, and the news since `since` (RS.t of the last visit)
function realmSimSummary(RS, realm, since = -1) {
  const R = RS.realms[realm | 0], P = RSM.projects[R.act];
  const order = [0, 1, 2].sort((a, b) => RS.realms[b].sp - RS.realms[a].sp);
  const toWar = rsmWarAt(RS) - RS.t, toReckon = rsmReckonAt(RS) - RS.t;
  const offs = RS.offs.filter((O) => O.state === 'planned' || O.state === 'live' || O.state === 'siege').map((O) => ({ r: O.r, k: O.k, keep: rsmKN(RS, O.k), holder: RS.keeps[O.k].h, inS: Math.max(0, Math.round(O.at - RS.t)), state: O.state, ours: O.r === realm, against: RS.keeps[O.k].h === realm }));
  const news = RS.log.filter((L) => L.t > since && (L.r === realm || L.r === -1 || L.k === 'big'));
  const lines = [];
  if (since >= 0 && RS.t > since) lines.push(`While you were away (${rsmDur(RS.t - since)}):`);
  for (const L of news.slice(-8)) lines.push(L.x);
  return {
    n: RS.n, phase: RS.phase, day: Math.floor(RS.t / rsmDay) + 1, days: Math.round(RS.len / rsmDay),
    clock: RS.phase === 'muster' ? `war in ${rsmDur(toWar)}` : RS.phase === 'war' ? `reckoning in ${rsmDur(toReckon)}` : `next season in ${rsmDur(RS.len - RS.t)}`,
    sp: RS.realms.map((q) => Math.round(q.sp)), place: order.indexOf(realm | 0) + 1, lead: order[0],
    stores: RSM_GOODS.map((g, i) => ({ g, v: Math.round(R.s[i]), fill: R.s[i] / RSM.target[i] })),
    short: R.short.slice(), hungry: R.hungry > 2,
    project: P ? { id: R.act, name: P.name, prog: Math.round(R.prog * 100), votes: Object.assign({}, R.votes) } : null,
    built: Object.assign({}, R.proj), keeps: RS.keeps.map((K, i) => ({ k: i, name: rsmKN(RS, i), h: K.h, home: K.home, g: Math.round(K.g), tier: K.tier, siege: !!K.siege })),
    lev: Math.round(R.lev), offs, lines, past: RS.past.slice(-3),
  };
}
// a saved or received RS made safe; anything not one: a fresh season
function realmSimSanitize(o, opts = {}) {
  const fresh = () => realmSimInit(rsmNum(opts.seed, 1, 0, 4294967295) >>> 0, opts);
  if (!o || typeof o !== 'object' || o.v !== RSM_V || !Array.isArray(o.realms) || o.realms.length !== 3 || !Array.isArray(o.keeps) || !o.keeps.length || o.keeps.length > 12) return fresh();
  const base = realmSimInit(rsmNum(o.seed, 1, 0, 4294967295) >>> 0, { days: rsmNum(o.len, RSM.days * rsmDay, 864, 400 * rsmDay) / rsmDay, keeps: o.keeps.map((K) => (K && K.home) | 0), names: o.names || opts.names });
  base.log = [];
  const RS = base;
  RS.rs = (o.rs | 0) || 1; RS.n = rsmNum(o.n, 1, 1, 1e6) | 0; RS.t = rsmNum(o.t, 0, 0, RS.len); RS.t0 = rsmNum(o.t0, 0, 0, 1e14);
  RS.phase = rsmPhaseOf(RS); RS.winner = Number.isInteger(o.winner) && o.winner >= 0 && o.winner < 3 ? o.winner : null;
  o.realms.forEach((q, r) => {
    if (!q || typeof q !== 'object') return;
    const R = RS.realms[r];
    if (Array.isArray(q.s)) for (let g = 0; g < 8; g++) R.s[g] = rsmNum(q.s[g], R.s[g], 0, rsmCap({ proj: { granary: 2, yard: 2 } }, g));
    if (Array.isArray(q.bank)) for (let g = 0; g < 8; g++) R.bank[g] = rsmNum(q.bank[g], 0, 0, 1e5);
    R.lev = rsmNum(q.lev, R.lev, 0, RSM.levyMax * 2); R.sp = rsmNum(q.sp, 0, 0, 1e7); R.del = rsmNum(q.del, 0, 0, 1e9); R.work = rsmNum(q.work, 0, 0, 200);
    if (q.proj && typeof q.proj === 'object') for (const id of RSM_PROJ) R.proj[id] = rsmNum(q.proj[id], 0, 0, RSM.projects[id].max) | 0;
    R.act = RSM.projects[q.act] ? q.act : q.act === '' ? '' : 'granary'; R.prog = rsmNum(q.prog, 0, 0, 1);
    if (q.votes && typeof q.votes === 'object') for (const id of RSM_PROJ) if (q.votes[id]) R.votes[id] = rsmNum(q.votes[id], 0, 0, 1e4);
    R.aim = rsmNum(q.aim, -1, -1, RS.keeps.length - 1) | 0; R.hungry = rsmNum(q.hungry, 0, 0, 48);
    R.dDay = rsmNum(q.dDay, -1, -1, 1e5) | 0; R.dWorth = rsmNum(q.dWorth, 0, 0, 1e9); // [season2]
    for (const f of ['raidAt', 'decideAt', 'levyAt', 'refillAt']) R[f] = rsmNum(q[f], 0, 0, RS.len + rsmDay);
    if (Array.isArray(q.short)) R.short = q.short.filter((g) => RSM_G[g] != null).slice(0, 8);
    if (q.by && typeof q.by === 'object') for (const w of Object.keys(q.by).slice(0, 40)) R.by[String(w).slice(0, 40)] = rsmNum(q.by[w], 0, 0, 1e6);
    if (q.stats && typeof q.stats === 'object') for (const f in R.stats) R.stats[f] = rsmNum(q.stats[f], 0, 0, 1e9);
  });
  o.keeps.forEach((q, i) => {
    if (!q || typeof q !== 'object') return;
    const K = RS.keeps[i];
    K.h = rsmClamp(q.h | 0, 0, 2); K.g = rsmNum(q.g, RSM.garrison, 0, 40); K.tier = rsmNum(q.tier, 0, 0, 3) | 0; K.gate = rsmNum(q.gate, 1, 0, 1);
    K.siege = q.siege && typeof q.siege === 'object' ? { a: q.siege.a | 0, t: rsmNum(q.siege.t, 0, 0, RS.len) } : null;
  });
  if (Array.isArray(o.hallows)) o.hallows.slice(0, 3).forEach((h, i) => { RS.hallows[i] = rsmClamp(h | 0, 0, 2); });
  if (Array.isArray(o.hallowAt)) o.hallowAt.slice(0, 3).forEach((h, i) => { RS.hallowAt[i] = rsmNum(h, 0, 0, RS.len); });
  RS.nextArmy = rsmNum(o.nextArmy, 1, 1, 1e9) | 0;
  RS.ln = rsmNum(o.ln, 0, 0, 1e12);
  RS.nextLen = rsmNum(o.nextLen, 0, 0, 400 * rsmDay);
  const KINDS = ['raid', 'hallow', 'assault', 'offensive'];
  if (Array.isArray(o.armies)) for (const A of o.armies.slice(0, 40)) {
    if (!A || typeof A !== 'object' || !KINDS.includes(A.kind)) continue;
    const r = rsmClamp(A.r | 0, 0, 2), k = rsmNum(A.k, -1, -1, RS.keeps.length - 1) | 0;
    if ((A.kind === 'assault' || A.kind === 'offensive') && k < 0) continue;
    const q = rsmNum(A.q, -1, -1, 2) | 0;
    if ((A.kind === 'raid' || A.kind === 'hallow') && (q < 0 || q === r)) continue;
    RS.armies.push({ id: A.id | 0, r, n: rsmNum(A.n, 0, 0, 200), n0: rsmNum(A.n0, 1, 1, 200), kind: A.kind, k, q, eng: rsmNum(A.eng, 0, 0, 4) | 0, p: rsmNum(A.p, 0, 0, 2), len: rsmNum(A.len, 100, 60, 2000), state: A.state === 'siege' ? 'siege' : 'march', t0: rsmNum(A.t0, 0, 0, RS.len), siegeH: rsmNum(A.siegeH, 0, 0, 1000), hungry: A.hungry ? 1 : 0, arm: rsmNum(A.arm, 1, 1, 1.5) });
  }
  const ST = ['planned', 'march', 'siege', 'live', 'done'];
  if (Array.isArray(o.offs)) for (const O of o.offs.slice(-30)) {
    if (!O || typeof O !== 'object' || !ST.includes(O.state)) continue;
    const k = rsmNum(O.k, -1, -1, RS.keeps.length - 1) | 0;
    if (k < 0) continue;
    RS.offs.push({ r: rsmClamp(O.r | 0, 0, 2), k, at: rsmNum(O.at, 0, 0, RS.len * 2), ann: rsmNum(O.ann, 0, 0, RS.len), state: O.state, army: O.army | 0, res: String(O.res || '').slice(0, 20), liveUntil: rsmNum(O.liveUntil, 0, 0, RS.len * 2) });
  }
  if (Array.isArray(o.log)) for (const L of o.log.slice(-RSM.maxLog)) if (L && typeof L === 'object') RS.log.push({ t: rsmNum(L.t, 0, 0, RS.len), r: rsmNum(L.r, -1, -1, 2) | 0, k: ['news', 'big', 'proj'].includes(L.k) ? L.k : 'news', x: String(L.x || '').slice(0, 300) });
  if (Array.isArray(o.past)) for (const p of o.past.slice(-12)) if (p && typeof p === 'object') RS.past.push({ n: p.n | 0, w: rsmClamp(p.w | 0, 0, 2), sp: Array.isArray(p.sp) ? p.sp.slice(0, 3).map((v) => rsmNum(v, 0, 0, 1e7)) : [0, 0, 0], keeps: Array.isArray(p.keeps) ? p.keeps.slice(0, 12).map((h) => rsmClamp(h | 0, 0, 2)) : [], end: rsmNum(p.end, 0, 0, 1e12) });
  if (o.stats && typeof o.stats === 'object') for (const f in RS.stats) RS.stats[f] = rsmNum(o.stats[f], 0, 0, 1e9);
  RS.live = false;
  return RS;
}

/* ------------------------------------------------------------------ */
/* [season2] the season's armies as bands of the live war (version 20) */
/* ------------------------------------------------------------------ */
// A page (alone: the player's own; on the server: the region's keeper) brings an army near its player onto its live war
// as a band, and tells RS what became of it; while it is on a field RS leaves it alone (never two of one army).
//   realmSimFieldTake(RS, id, who)   -> the army's plain description, or null (gone, or on another's field)
//   realmSimFieldReport(RS, id, rep, who) -> true if heard. rep: { n (the army's soldiers left, RS's measure), p (0..1 along
//     its road), state ('march'|'siege'), done ('' | 'fallen' | 'beaten' | 'taken' | 'home' | 'raided' | 'caught'), fold }
//   realmSimFieldFold(RS, who)       every army on `who`'s field folded back where it last stood (a page gone)
function rsmFieldDesc(RS, A) {
  return { id: A.id, r: A.r, n: Math.round(A.n * 10) / 10, n0: A.n0, kind: A.kind, k: A.k, q: A.q, eng: A.eng, state: A.state, p: Math.round(A.p * 1000) / 1000, arm: A.arm, hungry: A.hungry, off: RS.offs.some((O) => O.army === A.id && O.state === 'siege') ? 1 : 0 };
}
function realmSimFieldTake(RS, id, who) {
  const A = RS && RS.armies.find((q) => q.id === (id | 0) && q.state !== 'gone');
  who = String(who || 'page').slice(0, 40);
  if (!A || (A.onField && A.onField.who !== who)) return null;
  A.onField = { who, at: RS.t };
  return rsmFieldDesc(RS, A);
}
function realmSimFieldFold(RS, who) {
  let n = 0;
  if (RS) for (const A of RS.armies) if (A.onField && (who == null || A.onField.who === String(who))) { A.onField = null; n++; }
  return n;
}
function realmSimFieldReport(RS, id, rep, who) {
  const A = RS && RS.armies.find((q) => q.id === (id | 0) && q.state !== 'gone');
  if (!A || !A.onField || !rep || typeof rep !== 'object' || (who != null && A.onField.who !== String(who))) return false;
  const R = RS.realms[A.r];
  A.onField.at = RS.t;
  const n = rsmNum(rep.n, A.n, 0, A.n); // (an army never grows on the field)
  if (n < A.n) { R.stats.lost += A.n - n; A.flost = (A.flost || 0) + A.n - n; A.n = n; }
  if (A.state === 'march' && rep.p != null) A.p = rsmNum(rep.p, A.p, 0, 1);
  const K = A.k >= 0 ? RS.keeps[A.k] : null;
  if (rep.state === 'siege' && K && K.h !== A.r && RS.phase === 'war' && A.state === 'march') { A.state = 'siege'; K.siege = { a: A.id, t: Math.round(RS.t) }; RS.stats.sieges++; }
  const done = typeof rep.done === 'string' ? rep.done : '';
  const O = RS.offs.find((q) => q.army === A.id && q.state === 'siege');
  if (done === 'taken' && K) {
    if (K.h !== A.r) realmSimLive(RS, { type: 'keep', keep: A.k, holder: A.r });
    if (K.h === A.r) { const m = Math.max(0, Math.min(A.n, RSM.garrison * 1.5 - K.g)); K.g += m; A.n -= m; }
    if (O && O.state === 'siege') { O.state = 'done'; O.res = 'taken'; R.sp += RSM.sp.offensive; R.stats.won++; }
    rsmArmyHome(RS, A, '');
  } else if (done === 'fallen' || done === 'beaten' || A.n < 0.5) {
    if (O) { O.state = 'done'; O.res = 'held'; if (K) RS.realms[K.h].sp += RSM.sp.offensive * 0.6; }
    if (K && K.siege && K.siege.a === A.id) K.siege = null;
    rsmLog(RS, A.r, A.n < 0.5 ? `${rsmRN(RS, A.r)}'s army ${A.k >= 0 ? `on ${rsmKN(RS, A.k)}` : 'in the field'} has fallen to the last soldier.` : `${rsmRN(RS, A.r)}'s army is beaten back from ${A.k >= 0 ? rsmKN(RS, A.k) : 'the field'} with ${Math.round(A.n)} left.`, O ? 'big' : 'news');
    rsmArmyHome(RS, A, '');
  } else if ((done === 'raided' || done === 'caught') && A.kind === 'raid') rsmRaid(RS, A, done);
  else if (done === 'home') rsmArmyHome(RS, A, typeof rep.why === 'string' ? rep.why.slice(0, 60) : 'called home');
  if (A.state === 'gone') { RS.armies = RS.armies.filter((q) => q !== A); return true; }
  if (rep.fold) A.onField = null;
  return true;
}

/* global module */
// Node: export the contract (the page concatenates this file into one module; there `module` is undefined)
if (typeof module !== 'undefined' && module && module.exports) module.exports = { RSM, RSM_V, RSM_GOODS, RSM_PROJ, RSM_GEO, realmSimFieldTake, realmSimFieldReport, realmSimFieldFold, realmSimInit, realmSimStep, realmSimContribute, realmSimOrder, realmSimSummary, realmSimSanitize, realmSimLive };
