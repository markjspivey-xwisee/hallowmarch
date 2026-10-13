/* ================================================================== */
/* [loops] the war runs on the land: each realm's stores               */
/* ================================================================== */
// Version 19. Every realm keeps stores in its town (food, timber, stone, iron, hides, wool and horses), filled by its
// townsfolk's work (the fields' harvests, the fishers' catch, the herds, and the woodcutters, quarrymen and smith added
// here) and by the player's deliveries, and drawn on by the war: a band mustered (food and gear for each soldier), an
// engine built (timber, more for a trebuchet), a captain's horse, a house built back (timber and stone). Each keep keeps
// stores of its own (food, timber, stone, iron), drawn on by its garrison (each guard eats; a new guard and a lord need
// food and iron), a column out of it, a gate mended (timber and iron), a breach mended (stone and timber) and the timber
// of a burnt palisade, walk or tower; the keeps are supplied by caravans from the town (a cart, its horse, a carter and
// an escort on the roads: raided, the goods are lost to the realm and half go to whoever took them), and a keep taken is
// taken with its stores. A realm short of something shows it in the field: thinner bands and columns (and hungry ones,
// whose blows land softer), no engine it cannot build, slower mending, captains on foot, keeps whose guards are not
// replaced; and it says so (the news, the war panel's line, the war table and the Chronicle's Stores page). In the
// peace the realms trade at the borders. LOOPS.on false: version 18's war (nothing drawn, nothing short).
// For the future multiplayer (net): the realm's stores are one save part with a plain shape (`world.x.loops`, below):
// `r` [realm][good] in LOOPS_R order, `k` [keep][good] in LOOPS_K order, integers; nothing else of the economy is saved
// but the caravans in flight (`c`) and the counters a player reads (`h`).
const LOOPS_R = ['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses'];
const LOOPS_K = ['food', 'timber', 'stone', 'iron'];
const LOOPS_LABEL = { food: 'food', timber: 'timber', stone: 'stone', iron: 'iron', hides: 'hides', wool: 'wool', horses: 'horses' };
Object.assign(ICONS, { horse: '<path d="M6.5 20.5c-.3-4.2 1.2-7.3 3.8-9.2L8 6.6l3.9 1.9c2-1.1 4.5-1.3 6.5-.3l2 3.1-2.6 1-1.6-1.1-2.4 2.6v6.7"/><circle cx="15.6" cy="8.9" r=".9"/>' });
const LOOPS_ICON = { food: 'grain', timber: 'log', stone: 'stone', iron: 'hammer', hides: 'hide', wool: 'fibre', horses: 'horse' };
const LOOPS = {
  on: true,
  r: [0, 1, 2].map(() => ({ food: 0, timber: 0, stone: 0, iron: 0, hides: 0, wool: 0, horses: 0 })),
  k: [],                       // each keep's own stores, by keep id
  caravans: [], nextCar: 1,
  yards: [],                   // the stores yards behind the quartermasters (one a town)
  workers: [],                 // the woodcutters, quarrymen and smiths of the towns (villagers with ai.lj)
  pend: [{}, {}, {}],          // the town's woods' and quarry's work while you are by: brought in by its woodcutters and quarryman
  fieldK: [1, 1, 1],           // each realm's harvest weighed by its fields' size (Brackenford's fields against the gardens)
  inited: false, seeded: false, campN: null, clock: { prod: 0, look: 0, car: [8, 12, 16], news: 0, trade: 0 },
  short: [0, 1, 2].map(() => ({})), // what each realm is short of now (good: since when), for the news and the panel
  said: [0, 1, 2].map(() => ({})),  // when the news last told it
  // the measures, all in one place (tests set them between runs)
  T: {
    // what the realm's town aims to keep (a good under a fifth of it is short; deliveries pay more the shorter it is)
    target: { food: 400, timber: 160, stone: 120, iron: 50, hides: 40, wool: 30, horses: 12 },
    cap: 4,                    // a store holds up to cap x its target
    keepTarget: { food: 50, timber: 40, stone: 40, iron: 10 },
    keepCap: 2.5,
    start: 0.8,               // a new world's stores, a share of the targets
    // the town's work out of sight, a game minute (what the visible workers do when the town is near: the same rates)
    prod: { food: 16, timber: 5.5, stone: 2, iron: 2.6, hides: 1.2, wool: 0.8, horses: 0.85 },
    // a keep's own land (its fields and woods round its walls), a minute, to whoever holds it
    keepProd: { food: 1.5, timber: 0.6, stone: 0.3 },
    keepLost: 0.2,             // a share of the town's work lost for each of its realm's own keeps in other hands
    keepWon: 0.15,             // and gained for each enemy keep it holds
    // what the war draws
    soldier: { food: 1.5, iron: 0.2, hides: 0.15, wool: 0.1 }, // a soldier mustered (a column's soldier: food only)
    guard: { food: 1.5 },        // a guard who comes to a keep's post
    lord: { food: 2, iron: 3 },
    upkeep: 0.15,              // food a guard eats a minute, from its keep's stores
    engine: { ram: { timber: 10, iron: 1 }, mangonel: { timber: 18, iron: 2, hides: 2 }, trebuchet: { timber: 28, iron: 3, stone: 6 } },
    work: { gate: { timber: 12, iron: 2 }, breach: { stone: 20, timber: 5 }, palisade: { timber: 10 }, deck: { timber: 1.5 }, tower: { timber: 12 }, house: { timber: 10, stone: 5 } },
    slow: 0.3,                 // the pace of work with its goods short
    hungry: 0.88,              // the blows of a hungry body
    hungryT: 240,              // s a band mustered hungry stays so
    thin: 0.55,                // a band mustered with no food at all: this share of its size (at least four)
    // caravans
    carEvery: [70, 110],       // s between a realm's looks at its keeps
    carLoad: 60,               // what one cart carries (units of goods)
    carSpeed: 0.85,            // of a body's own pace
    keepLow: 0.6,              // a keep under this share of its target in anything is sent a cart
    raidShare: 0.5,            // what a realm that takes a cart gets of its goods
    // deliveries
    rp: { food: 0.5, timber: 1, stone: 1, iron: 4, hides: 1.5, wool: 1.2, horses: 60 },
    gold: { food: 0.6, timber: 1.1, stone: 1.1, iron: 5, hides: 2, wool: 1.8, horses: 70 },
    renownPer: 40,             // units delivered for each point of the realm's campaign renown
  },
  stats: { drawn: [{}, {}, {}], made: [{}, {}, {}], shortT: [{}, {}, {}], thin: 0, hungry: 0, noEngine: 0, downgraded: 0, footCaptains: 0, slowWork: 0, noGuard: 0, caravans: 0, arrived: 0, raided: 0, raidedBy: [0, 0, 0], delivered: 0, deliveries: 0, keepsTaken: 0, traded: 0, felled: 0, quarried: 0, smelted: 0 },
  you: { units: 0, n: 0, escorts: 0, raids: 0, rp: 0, gold: 0 }, // the player's record (saved with the character)
};
const LT = LOOPS.T;
// how much of each kind of store a good is worth when delivered (or taken from a cart): [store, units each]
const LOOPS_WORTH = {
  grain: ['food', 1], flour: ['food', 2.2], bread: ['food', 1.4], meat_raw: ['food', 1], meat_cooked: ['food', 1.3], fish_raw: ['food', 0.8], fish_cooked: ['food', 1],
  egg: ['food', 0.4], milk: ['food', 0.5], cheese: ['food', 2], honey: ['food', 0.8], berries: ['food', 0.3], mushrooms: ['food', 0.4], apple: ['food', 0.4], cabbage: ['food', 1], turnip: ['food', 1],
  stew: ['food', 2], ale: ['food', 0.6], pasty: ['food', 1.4], beans: ['food', 0.8], mush_roast: ['food', 0.6],
  log: ['timber', 1], plank: ['timber', 0.4], firewood: ['timber', 0.25], stick: ['timber', 0.08], thatch: ['timber', 0.15],
  stone: ['stone', 1], flint: ['stone', 0.6], clay: ['stone', 0.5],
  iron_ore: ['iron', 0.4], iron: ['iron', 1], grave_iron: ['iron', 2], nails: ['iron', 0.05],
  hide: ['hides', 1], leather: ['hides', 1.3], feather: ['hides', 0.05], bone: ['hides', 0.1],
  wool: ['wool', 1], woollen: ['wool', 2], linen: ['wool', 1.2], flax: ['wool', 0.4], fibre: ['wool', 0.15],
};
const loopsInWar = () => LOOPS.on && typeof CAMPAIGN !== 'undefined' && CAMPAIGN.state === 'war';
const loopsKeep = (K) => LOOPS.k[K.id] || (LOOPS.k[K.id] = { food: LT.keepTarget.food, timber: LT.keepTarget.timber, stone: LT.keepTarget.stone, iron: LT.keepTarget.iron });
const lsBump = (o, k, n) => { o[k] = (o[k] || 0) + n; };

/* ------------------------------------------------------------------ */
/* the stores: what they hold, and what is short                       */
/* ------------------------------------------------------------------ */
// how full a realm's store of a good is, as a share of its target (0 empty, 1 at the target)
function loopsFill(r, g) { return clamp(LOOPS.r[r][g] / LT.target[g], 0, LT.cap); }
function loopsKeepFill(K, g) { return clamp(loopsKeep(K)[g] / LT.keepTarget[g], 0, LT.keepCap); }
// what a delivery of a good is worth to the realm now: twice and a half at an empty store, its own at the target
function loopsNeedK(r, g) { const f = loopsFill(r, g); return f >= 1 ? Math.max(0.6, 1 - (f - 1) * 0.2) : 1 + 1.5 * (1 - f) ** 1.3; }
// put goods into a realm's stores (the town), as far as they hold
function loopsAdd(r, g, n, why) {
  if (!(n > 0) || r == null || r < 0 || r > 2 || !LOOPS.r[r] || !(g in LT.target)) return 0;
  const S = LOOPS.r[r], room = Math.max(0, LT.target[g] * LT.cap - S[g]), k = Math.min(n, room);
  S[g] += k;
  if (why !== false) lsBump(LOOPS.stats.made[r], g, k);
  return k;
}
// take goods from a realm's stores; returns the share it had (1 all of it, 0 none). `part` takes what there is.
function loopsTake(r, need, part = false) {
  const S = LOOPS.r[r];
  let fr = 1;
  for (const g in need) if (need[g] > 0) fr = Math.min(fr, S[g] / need[g]);
  fr = clamp(fr, 0, 1);
  if (!part && fr < 1) return fr;
  for (const g in need) if (need[g] > 0) { const k = need[g] * fr; S[g] = Math.max(0, S[g] - k); lsBump(LOOPS.stats.drawn[r], g, k); }
  return fr;
}
function loopsKeepTake(K, need, part = false) {
  const S = loopsKeep(K);
  let fr = 1;
  for (const g in need) if (need[g] > 0) fr = Math.min(fr, S[g] / need[g]);
  fr = clamp(fr, 0, 1);
  if (!part && fr < 1) return fr;
  for (const g in need) if (need[g] > 0) { const k = need[g] * fr; S[g] = Math.max(0, S[g] - k); lsBump(LOOPS.stats.drawn[K.realm], g, k); }
  return fr;
}
function loopsKeepAdd(K, g, n) { const S = loopsKeep(K), room = Math.max(0, LT.keepTarget[g] * LT.keepCap - S[g]), k = Math.min(Math.max(0, n), room); S[g] += k; return k; }
// a realm is short of a good when its store is under a fifth of its target (and a keep under a sixth of its own)
const loopsShort = (r, g) => LOOPS.on && LOOPS.r[r][g] < LT.target[g] * 0.2;
const loopsKeepShort = (K, g) => LOOPS.on && loopsKeep(K)[g] < LT.keepTarget[g] * 0.17;

/* ------------------------------------------------------------------ */
/* what the war draws, and what it does without                        */
/* ------------------------------------------------------------------ */
// a band at the muster (planWar, 08g_campaign.js): each soldier eats and is armed from the realm's stores. Short of food
// the band musters thinner and hungry; short of iron, hides or wool it is ill-armed (its soldiers lighter in the field:
// harm taken a little higher, below). Returns the size it musters at.
function loopsMuster(r, size) {
  if (!loopsInWar()) return size;
  const n = size, need = {};
  for (const g in LT.soldier) need[g] = LT.soldier[g] * n;
  const food = Math.min(1, LOOPS.r[r].food / need.food);
  let k = size;
  if (food < 1) { k = Math.max(4, Math.round(size * Math.max(LT.thin, food))); LOOPS.stats.thin++; }
  const want = {};
  for (const g in LT.soldier) want[g] = LT.soldier[g] * k;
  const got = loopsTake(r, want, true);
  LOOPS.lastMuster = { r, size, k, food, gear: got, hungry: food < 0.7, ill: LOOPS.r[r].iron < 1 };
  return k;
}
// after the band is made: hungry or ill-armed soldiers carry it with them
function loopsMustered(wb) {
  const m = LOOPS.lastMuster;
  LOOPS.lastMuster = null;
  if (!m || !wb || m.r !== wb.realm) return;
  if (m.hungry) { LOOPS.stats.hungry++; for (const e of wbMembers(wb)) e.lHungry = GAME.t + LT.hungryT; }
  if (m.ill) for (const e of wbMembers(wb)) e.lIll = GAME.t + LT.hungryT;
  if (m.k < m.size) loopsSay(wb.realm, 'thin', `${REALMS[wb.realm].name}'s granaries run low: its bands muster ${m.k} strong where ${m.size} should march${m.hungry ? ', hungry' : ''}.`);
}
// a column out of a keep or the muster (war3Column, 08k_war3.js): the soldiers it can feed (at least two)
function loopsColumn(K, realm, slots, src) {
  if (!loopsInWar() || !slots.length) return slots;
  const fromKeep = src && src.from != null && WAR.keeps[src.from] && src.hall ? WAR.keeps[src.from] : null;
  const per = LT.soldier.food, S = fromKeep ? loopsKeep(fromKeep) : LOOPS.r[realm];
  const can = Math.max(2, Math.floor(S.food / per));
  const n = Math.min(slots.length, can);
  if (fromKeep) loopsKeepTake(fromKeep, { food: per * n }, true); else loopsTake(realm, { food: per * n }, true);
  if (n < slots.length) { LOOPS.stats.thin++; loopsSay(realm, 'thin', `${REALMS[realm].name} can feed only ${n} for the column to ${K.site.name}.`); }
  return slots.slice(0, n);
}
// a guard who would come to a keep's post on the quiet hours (updateWar, 08_ai.js): fed from the keep's own stores, or
// not at all (the garrison thins until a cart comes)
function loopsTrickleOk(K) {
  if (!loopsInWar()) return true;
  if (loopsKeepTake(K, LT.guard) >= 1) return true;
  LOOPS.stats.noGuard++;
  loopsSay(K.realm, 'k' + K.id, `${K.site.name} has no bread for new guards: its garrison thins until a cart comes.`);
  return false;
}
// a keep's new lord (fillGarrison): fed and armed from the keep's stores; ill-armed without iron (a level less, softer)
function loopsLord(K, L) {
  if (!loopsInWar() || !L) return;
  const fr = loopsKeepTake(K, LT.lord, true);
  if (fr < 0.6) { L.lIll = GAME.t + 1e6; L.level = Math.max(1, L.level - 2); setupStats(L, true); }
}
// the engine a band would build (siegePlanFor, 04h_siege.js): the kind its realm's stores can raise, a cheaper one, or
// none (the band goes for the gate as it can)
function loopsEngineKind(r, kind) {
  if (!loopsInWar()) return kind;
  const order = kind === 'trebuchet' ? ['trebuchet', 'mangonel', 'ram'] : kind === 'mangonel' ? ['mangonel', 'ram'] : ['ram'];
  for (const k of order) {
    if (loopsTake(r, LT.engine[k]) >= 1) {
      if (k !== kind) { LOOPS.stats.downgraded++; loopsSay(r, 'eng', `${REALMS[r].name} has not the timber for a ${SIEGE_SPEC[kind].label}: its band builds a ${SIEGE_SPEC[k].label}.`); }
      return k;
    }
  }
  LOOPS.stats.noEngine++;
  loopsSay(r, 'eng', `${REALMS[r].name}'s timber yards are bare: its bands go to the walls without engines.`);
  return null;
}
// a captain mounting up (thinkSoldier): a horse from the realm's stables, once; none, and it walks
function loopsHorseOk(e) {
  if (!LOOPS.on || e.lHorse) return true;
  if (!loopsInWar()) { e.lHorse = 1; return true; }
  if (GAME.t < (e.lNoHorse || 0)) return false;
  if (LOOPS.r[e.faction] && LOOPS.r[e.faction].horses >= 1) { LOOPS.r[e.faction].horses -= 1; lsBump(LOOPS.stats.drawn[e.faction], 'horses', 1); e.lHorse = 1; return true; }
  e.lNoHorse = GAME.t + 60;
  LOOPS.stats.footCaptains++;
  loopsSay(e.faction, 'horse', `${REALMS[e.faction].name}'s stables are empty: its captains march on foot.`);
  return false;
}
// the pace of a keep's work (a gate, a breach, a burnt palisade, walk or tower), drawing its goods as it goes: the
// whole of a job's goods over its whole time (dt / T of them each step). Short of them, the work goes at LT.slow.
function loopsWork(K, kind, dt, T) {
  if (!LOOPS.on || !K || !(dt > 0)) return 1;
  const need = LT.work[kind];
  if (!need) return 1;
  const share = dt / Math.max(1, T), want = {};
  for (const g in need) want[g] = need[g] * share;
  const fr = loopsKeepTake(K, want, true);
  if (fr >= 0.999) return 1;
  // what the keep lacks, the realm's stores send on the next cart; meanwhile the work drags
  LOOPS.stats.slowWork += dt;
  if (fr < 0.5) loopsSay(K.realm, 'w' + K.id, `${K.site.name} has not the ${Object.keys(need).join(' and ')} to mend its walls: the work drags until a cart comes.`);
  return LT.slow + (1 - LT.slow) * fr;
}
// a house built back (houseScaffoldStep, 04e_houses.js): its town's realm's timber and stone
function loopsHouseWork(H, dt) {
  if (!LOOPS.on || !(dt > 0) || H.keepHall) return H.keepHall && H.S && H.S.keepRef ? loopsWork(H.S.keepRef, 'house', dt, HOUSE_TIME.scaffold) : 1;
  const r = H.S && H.S.realmId != null ? H.S.realmId : realmAt(H.x, H.z);
  if (r == null || r < 0 || r > 2) return 1;
  const share = dt / HOUSE_TIME.scaffold, want = {};
  for (const g in LT.work.house) want[g] = LT.work.house[g] * share;
  const fr = loopsTake(r, want, true);
  if (fr >= 0.999) return 1;
  LOOPS.stats.slowWork += dt;
  return LT.slow + (1 - LT.slow) * fr;
}
// harm: a hungry body's blows land softer, an ill-armed body takes a little more (dealDamage, 07_entities.js). The
// war's soldiers, guards and lords only: never the player, a bot or a beast.
function loopsHarmMult(src, dst) {
  if (!LOOPS.on) return 1;
  let k = 1;
  if (src && src.lHungry > GAME.t) k *= LT.hungry;
  if (dst && dst.lIll > GAME.t) k *= 1.08;
  return k;
}
// the war table's word (04k_hall.js) and the news: what a realm lacks, said once in a while
function loopsSay(r, key, text) {
  const S = LOOPS.said[r], now = GAME.t;
  if (now - (S[key] ?? -1e9) < 180) return;
  S[key] = now;
  news(text, r, 'normal');
}

/* ------------------------------------------------------------------ */
/* what the land gives                                                 */
/* ------------------------------------------------------------------ */
// a town field's harvest (farmTownDone, 08h_farming.js): into the realm's stores as food (flax as wool's cloth)
function loopsHarvest(r, produce, amount) {
  if (!LOOPS.on || !(amount > 0)) return;
  const w = LOOPS_WORTH[produce];
  const k = LOOPS.fieldK[r] || 1;
  if (w) loopsAdd(r, w[0], amount * w[1] * 0.5 * k);
  else loopsAdd(r, 'food', amount * 0.4 * k);
}
// a fisher's catch (07e_boats.js)
function loopsCatch(r, n) { if (LOOPS.on && n > 0) loopsAdd(r, 'food', n * 0.8); }
// the town's work out of sight: each realm's rate a minute, the town's own workers doing it in sight
// the land a realm's keeps guard: each of its own keeps in other hands costs it a share of its town's work (its
// borderland farms and woods unsafe), each enemy keep it holds brings in a share of that keep's realm's (forage and
// tribute from the lands round it)
function loopsLandK(r) {
  let k = 1;
  for (const K of WAR.keeps) { if (K.orig === r && K.realm !== r) k -= LT.keepLost; else if (K.realm === r && K.orig !== r) k += LT.keepWon; }
  return clamp(k, 0.4, 1.6);
}
// a woodcutter's log or a quarryman's stone brought in: the town's woods' (or quarry's) work since the last
function loopsBring(r, g) { const P0 = LOOPS.pend[r]; if (P0 && P0[g] > 0) { loopsAdd(r, g, P0[g]); P0[g] = 0; } }
function loopsProduce(dt) {
  const m = dt / 60;
  for (let r = 0; r < 3; r++) {
    const vis = loopsTownSeen(r), lk = loopsLandK(r);
    for (const g of LOOPS_R) {
      let k = LT.prod[g];
      // a realm whose fields were burnt or trampled harvests less (the town fields' state: farming)
      if (g === 'food') k *= loopsFieldsK(r);
      if (g !== 'horses') k *= lk;
      // the woods' and the quarry's work while you are by is brought in by the woodcutters and the quarryman as they
      // fell and break (loopsBring): the same in all, seen or not; what waits more than four minutes comes in anyway
      if (g === 'timber' || g === 'stone' || g === 'iron') {
        const P0 = LOOPS.pend[r];
        if (vis) { P0[g] = (P0[g] || 0) + k * m; const over = P0[g] - k * 4; if (over > 0) { P0[g] -= over; loopsAdd(r, g, over); } continue; }
        if (P0[g] > 0) { loopsAdd(r, g, P0[g]); P0[g] = 0; }
      }
      loopsAdd(r, g, k * m);
    }
  }
  // each keep's own land, to its holder; and its garrison eats from its stores
  for (const K of WAR.keeps) {
    const S = loopsKeep(K);
    for (const g in LT.keepProd) loopsKeepAdd(K, g, LT.keepProd[g] * m);
    if (CAMPAIGN.state === 'war') {
      let n = 0;
      for (const id of K.guards) { const q = getEnt(id); if (q && q.alive) n++; }
      if (K.lord != null) n++;
      const eat = n * LT.upkeep * m;
      const fr = S.food >= eat ? 1 : S.food / Math.max(1e-6, eat);
      S.food = Math.max(0, S.food - eat);
      lsBump(LOOPS.stats.drawn[K.realm], 'food', Math.min(eat, eat * fr));
      // a garrison that has eaten its stores goes hungry until a cart comes
      if (fr < 1) {
        for (const id of K.guards) { const q = getEnt(id); if (q && q.alive) q.lHungry = GAME.t + 30; }
        const L = getEnt(K.lord); if (L && L.alive) L.lHungry = GAME.t + 30;
        loopsSay(K.realm, 'h' + K.id, `The garrison of ${K.site.name} has eaten its stores: it fights hungry until a cart comes.`);
      }
    }
  }
}
// the town fields' worth now: strips burnt, trampled or dead harvest nothing (1 whole)
function loopsFieldsK(r) {
  if (typeof FARM === 'undefined' || !FARM.plots) return 1;
  const C = LOOPS.fieldsC || (LOOPS.fieldsC = { t: -1e9, k: [1, 1, 1] });
  if (GAME.t - C.t > 20) {
    C.t = GAME.t;
    for (let q = 0; q < 3; q++) {
      let n = 0, ok = 0;
      for (const P of FARM.plots) { if (P.own !== 't' || (P.stand.town || 0) !== q) continue; n++; if (!(P.stand.dead || (P.stand.phase === 'sown' && P.stand.hp <= 0.2)) && (P.char || 0) < 0.5) ok++; }
      C.k[q] = n ? 0.55 + 0.45 * (ok / n) : 1;
    }
  }
  return C.k[r];
}
// is a realm's town near enough the player for its workers to be at work in sight?
function loopsTownSeen(r) {
  const P = GAME.player, T = REALMS[r].town;
  return !!P && dist2(P.x, P.z, T.x, T.z) < 165 * 165;
}

/* ------------------------------------------------------------------ */
/* keeps taken with their stores; the peace's trade                    */
/* ------------------------------------------------------------------ */
// captureKeep (08_ai.js): the keep's stores are the taker's now; what its garrison ate is gone
function loopsOnCapture(K, realm, old) {
  if (!LOOPS.on) return;
  LOOPS.stats.keepsTaken++;
  const S = loopsKeep(K), got = [];
  for (const g of LOOPS_K) if (S[g] >= 5) got.push(`${Math.round(S[g])} ${LOOPS_LABEL[g]}`);
  // the caravans on the way to it turn back
  for (const c of LOOPS.caravans) if (c.keep === K.id && c.realm === old && c.state === 'road') loopsCarTurn(c);
  if (got.length && GAME.player && (GAME.player.faction === realm || GAME.player.faction === old)) uiLog(`${K.site.name}'s stores fall to ${REALMS[realm].name}: ${got.join(', ')}.`, 'realm');
}
// in the peace the realms trade at the border fairs: what one has over its target goes for what it lacks
function loopsTradeStep() {
  if (!LOOPS.on || CAMPAIGN.state !== 'peace') return;
  const deals = [];
  for (const g of LOOPS_R) {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (a === b) continue;
      const ha = LOOPS.r[a][g] - LT.target[g], nb = LT.target[g] * 0.7 - LOOPS.r[b][g];
      if (ha <= LT.target[g] * 0.15 || nb <= 0) continue;
      const k = Math.min(ha * 0.35, nb);
      if (k < 1) continue;
      LOOPS.r[a][g] -= k; LOOPS.r[b][g] += k;
      LOOPS.stats.traded += k;
      deals.push([a, b, g, k]);
    }
  }
  if (deals.length) {
    const d = deals.sort((x, y) => y[3] - x[3])[0];
    news(`At the border fairs ${REALMS[d[0]].name} trades ${Math.round(d[3])} ${LOOPS_LABEL[d[2]]} to ${REALMS[d[1]].name}${deals.length > 1 ? `, and ${deals.length - 1} more bargains are struck` : ''}.`, d[1], 'normal');
  }
}

/* ------------------------------------------------------------------ */
/* caravans: carts from the town to the keeps                           */
/* ------------------------------------------------------------------ */
// A cart drawn by a horse, led by a carter, two of the realm's soldiers walking beside it, along the roads from the
// town (its road node) by the pass and the muster to the keep's gate, where the keep's people carry the goods in; then
// home again. Bands of the other realms meet it on the roads and fall on it (the carter and the escort are of the realm;
// the horse is no fighter); the carter killed or the horse, the cart is lost: its goods spill (a share to whoever took
// it, the rest lost; the player who takes it finds them on the ground) and the cart burns.
function loopsCarRoute(r, K) {
  const N = REALMS[r].nav, KN = K.nav;
  const path = navPath(N.town.id, KN.gate.id, () => false);
  if (!path) return null;
  const pts = path.map((id) => ({ x: NAV.nodes[id].x, z: NAV.nodes[id].z }));
  // out of the town's square (its portal stones, its well): the cart is loaded on the road out, past the houses' green
  const a = pts[0], b = pts[1], d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  for (let k = 24; k < Math.min(60, d - 4); k += 2) {
    const x = a.x + ((b.x - a.x) / d) * k, z = a.z + ((b.z - a.z) / d) * k;
    if (isWalkable(x, z) && !look5InColl(x, z, 2.4) && !(typeof houseAt === 'function' && houseAt(x, z, 3))) { pts[0] = { x, z }; break; }
  }
  return pts;
}
function loopsCaravanStep(dt) {
  if (!LOOPS.on) return;
  const now = GAME.t;
  for (let r = 0; r < 3; r++) {
    if (CAMPAIGN.state !== 'war') continue;
    LOOPS.clock.car[r] -= dt;
    if (LOOPS.clock.car[r] > 0) continue;
    LOOPS.clock.car[r] = LT.carEvery[0] + Math.random() * (LT.carEvery[1] - LT.carEvery[0]);
    if (LOOPS.caravans.filter((c) => c.realm === r && (c.state === 'road' || c.state === 'wreck')).length >= 2) continue;
    // the neediest keep of the realm's, not under attack, with no cart on its way
    let best = null, bs = LT.keepLow;
    for (const K of WAR.keeps) {
      if (K.realm !== r || now - K.lastEnemyNear < 20) continue;
      if (LOOPS.caravans.some((c) => c.keep === K.id && c.state === 'road')) continue;
      let f = 9;
      for (const g of LOOPS_K) f = Math.min(f, loopsKeepFill(K, g));
      if (f < bs) { bs = f; best = K; }
    }
    if (best) loopsCarSend(r, best);
  }
  for (const c of LOOPS.caravans) loopsCarStep(c, dt);
  for (let i = LOOPS.caravans.length - 1; i >= 0; i--) if (LOOPS.caravans[i].state === 'gone') LOOPS.caravans.splice(i, 1);
}
// load a cart for a keep with what it lacks most, as far as the town has it
function loopsCarLoad(r, K) {
  const S = LOOPS.r[r], ks = loopsKeep(K), want = {};
  let tot = 0;
  for (const g of LOOPS_K) { const w = Math.max(0, LT.keepTarget[g] * 1.3 - ks[g]); want[g] = w; tot += w; }
  const load = {};
  const k = tot > LT.carLoad ? LT.carLoad / tot : 1;
  let n = 0;
  for (const g of LOOPS_K) { const q = Math.min(S[g] * 0.6, want[g] * k); if (q >= 1) { load[g] = Math.floor(q); n += load[g]; } }
  if (n < 6) return null;
  for (const g in load) { S[g] -= load[g]; }
  return load;
}
function loopsCarSend(r, K, force = false) {
  const route = loopsCarRoute(r, K);
  if (!route || route.length < 2) return null;
  const load = loopsCarLoad(r, K);
  if (!load && !force) return null;
  const R = REALMS[r], p0 = route[0], p1 = route[1];
  const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
  const c = { id: LOOPS.nextCar++, realm: r, keep: K.id, route, i: 1, state: 'road', load: load || { food: 10 }, t0: GAME.t, back: false, ents: [], esc: [], cart: null, wreckT: 0, near: 0, nearT: 0, by: null, stuckT: 0, lastD: 1e9 };
  const at = (k) => ({ x: p0.x - Math.sin(yaw) * k + (Math.random() - 0.5) * 0.4, z: p0.z - Math.cos(yaw) * k + (Math.random() - 0.5) * 0.4 });
  // the horse ahead, the cart behind it, the carter at its head, the escort either side
  const hp = at(0);
  const horse = makeEnt({ kind: 'horse', faction: FACTION_NEUTRAL, role: 'carthorse', name: `${R.name} cart horse`, level: 5, x: hp.x, z: hp.z, y: heightAt(hp.x, hp.z), yaw, radius: 0.8, speed: 6 });
  horse.maxHp = horse.hp = 520;
  loopsHorseLook(horse, r);
  const cp = { x: hp.x + Math.cos(yaw) * 1.2, z: hp.z - Math.sin(yaw) * 1.2 };
  const carter = makeEnt({ kind: 'humanoid', faction: r, role: 'carter', level: Math.max(1, warLevel() - 4), name: `${pick(Math.random, VILLAGER_NAMES)} the carter`, x: cp.x, z: cp.z, y: heightAt(cp.x, cp.z), yaw, look: villagerLook(r), speed: 2.6, radius: 0.45 });
  carter.maxHp = carter.hp = 260 + warLevel() * 24;
  carter.lCar = c; horse.lCar = c;
  c.horse = horse.id; c.carter = carter.id;
  for (let i = 0; i < 2; i++) {
    const ep = at(3.5 + i * 1.5);
    const e = spawnRealmUnit(r, i ? 'archer' : 'warrior', warUnitLevel('soldier'), 'escort', ep.x + (i ? 1.3 : -1.3) * Math.cos(yaw), ep.z - (i ? 1.3 : -1.3) * Math.sin(yaw));
    e.lCar = c; e.lSide = i ? 1 : -1;
    c.esc.push(e.id);
  }
  // the cart itself (drawn and posed in loopsDraw): behind the horse
  c.ax = hp.x - Math.sin(yaw) * 3.1; c.az = hp.z - Math.cos(yaw) * 3.1; c.yaw = yaw; c.roll = 0; c.pitch = 0; c.wheel = 0; c.y = heightAt(c.ax, c.az);
  LOOPS.caravans.push(c);
  LOOPS.stats.caravans++;
  if (GAME.player && GAME.player.faction === r && loopsTownSeen(r)) uiLog(`A cart leaves ${R.townName} for ${K.site.name} with ${loopsLoadText(c.load)}.`, 'realm');
  return c;
}
const loopsLoadText = (load) => Object.keys(load).filter((g) => load[g] >= 1).map((g) => `${Math.round(load[g])} ${LOOPS_LABEL[g]}`).join(', ') || 'little';
function loopsHorseLook(e, r) {
  try {
    const rec = anRecord('horse', { owner: 'caravan', sex: 'f' });
    rec.age = AKIND.horse.grow * 2;
    e.tame = rec;
    anLook(e);
    e.look.colB = REALMS[r].rgb.map((v) => v * 0.82); // a saddle cloth in its realm's colours
    e.tame = null;
    e.lRec = rec;
  } catch (err) { reportError(err); }
}
// turn a cart back home (its keep lost on the way): it carries its goods home
function loopsCarTurn(c) {
  if (c.back) return;
  c.back = true;
  c.route = c.route.slice(0, c.i + 1).reverse();
  c.i = 1;
}
const loopsEnt = (id) => { const e = getEnt(id); return e && e.alive && !e.removed ? e : null; };
function loopsCarStep(c, dt) {
  const horse = loopsEnt(c.horse), carter = loopsEnt(c.carter);
  if (c.state === 'wreck') {
    c.wreckT += dt;
    if ((c.wreckT > 75 && !loopsSeenBy(c.ax, c.az)) || c.wreckT > 900) loopsCarGone(c); // (nothing vanishes in sight)
    return;
  }
  if (c.state === 'gone') return;
  if (c.state === 'parked') {
    // unharnessed and taken in once nobody is by to see it (or, in a busy town, a while later with you not close)
    c.parkT = (c.parkT || 0) + dt;
    if (!loopsSeenBy(c.ax, c.az) || (c.parkT > 120 && !loopsSeenBy(c.ax, c.az, 35))) loopsCarGone(c); else if (horse) loopsCartFollow(c, horse, dt);
    return;
  }
  if (!horse || !carter) { loopsCarLost(c); return; }
  const K = WAR.keeps[c.keep];
  if (!c.back && K && K.realm !== c.realm) loopsCarTurn(c);
  // the war over: the cart goes home
  if (!c.back && CAMPAIGN.state !== 'war') loopsCarTurn(c);
  const pt = c.route[Math.min(c.i, c.route.length - 1)], last = c.i >= c.route.length - 1;
  // foes about: the carter hurries on, the escort fights (their own think)
  const danger = loopsFoesNear(horse.x, horse.z, 16, c.realm);
  const pace = LT.carSpeed * (danger ? 1.25 : 1);
  const arrived = moveToward(horse, pt.x, pt.z, dt, pace * (horse.speed > 0 ? 2.8 / horse.speed : 1), last ? 1.5 : 2.5);
  // stuck (a band in the road, a wall): a step round it, as the townsfolk do
  const dGoal = Math.hypot(pt.x - horse.x, pt.z - horse.z);
  c.stuckT = dGoal < c.lastD - 0.05 ? 0 : c.stuckT + dt; c.lastD = dGoal;
  if (c.stuckT > 4) { c.stuckT = 0; const a = Math.atan2(pt.x - horse.x, pt.z - horse.z) + (Math.random() < 0.5 ? 1 : -1) * 1.2; stepTo(horse, horse.x + Math.sin(a) * 1.5, horse.z + Math.cos(a) * 1.5); }
  if (arrived) {
    if (!last) c.i++;
    else if (!c.back && K && K.realm === c.realm) loopsCarArrive(c, K);
    else loopsCarHome(c);
  }
  // the carter at the horse's head, on its left
  const hy = horse.yaw, lx = horse.x + Math.cos(hy) * 1.0 + Math.sin(hy) * 0.9, lz = horse.z - Math.sin(hy) * 1.0 + Math.cos(hy) * 0.9;
  const ct = carter.target != null ? getEnt(carter.target) : null;
  if (ct && (!ct.alive || dist2(ct.x, ct.z, carter.x, carter.z) > 3.5 * 3.5)) carter.target = null; // (he swings back at whoever strikes him, and goes on)
  if (carter.target == null) moveToward(carter, lx, lz, dt, 1.25, 0.3);
  // the player escorting: near it on most of the way
  const P = GAME.player;
  if (P && P.alive && P.faction === c.realm && !c.back) { c.nearT += dt; if (dist2(P.x, P.z, horse.x, horse.z) < 30 * 30) c.near += dt; }
  // the cart behind the horse (a trailer's pull), pushing bodies out of its bed
  loopsCartFollow(c, horse, dt);
}
function loopsFoesNear(x, z, r, realm) {
  let n = 0;
  forNear(x, z, r, (o) => { if (!n && o.alive && isActor(o) && o.faction <= 2 && o.faction !== realm && !war4Allied(o.faction, realm)) n++; });
  return n;
}
// at the keep's gate: the goods carried in
function loopsCarArrive(c, K) {
  const got = [];
  for (const g in c.load) { const k = loopsKeepAdd(K, g, c.load[g]); if (k >= 1) got.push(`${Math.round(k)} ${LOOPS_LABEL[g]}`); const left = c.load[g] - k; if (left > 0) loopsAdd(c.realm, g, left, false); }
  c.load = {};
  LOOPS.stats.arrived++;
  const P = GAME.player;
  if (P && P.faction === c.realm && dist2(P.x, P.z, K.site.x, K.site.z) < 120 * 120) uiLog(`The cart from ${REALMS[c.realm].townName} unloads at ${K.site.name}: ${got.join(', ') || 'little'}.`, 'realm');
  // the player who walked with it most of the way
  if (P && P.alive && P.faction === c.realm && c.nearT > 30 && c.near > c.nearT * 0.6 && dist2(P.x, P.z, K.site.x, K.site.z) < 60 * 60) loopsEscorted(c, K);
  loopsCarTurn(c);
}
function loopsEscorted(c, K) {
  const prog = GAME.prog, L = prog.level;
  LOOPS.you.escorts++;
  const rp = Math.round(40 + L * 3), gold = Math.round(15 + L * 4);
  addRP(rp); addGold(gold);
  LOOPS.you.rp += rp; LOOPS.you.gold += gold;
  uiToast(`You saw the cart safe to ${K.site.name}: ${rp} realm points and ${gold} gold.`, 'quest');
  if (typeof GUIDE !== 'undefined') GUIDE.made.push('caravan');
  saveSoon();
}
// home again: whatever it still carries back into the stores, and its people go in
function loopsCarHome(c) {
  for (const g in c.load) loopsAdd(c.realm, g, c.load[g], false);
  c.load = {};
  // it stands on the road out of town until nobody is by to see it unharnessed and taken in
  c.state = 'parked';
  for (const id of c.esc) { const e = getEnt(id); if (e && e.alive) e.lCar = null; }
}
// is a place in sight of the player (near enough that a body there should not simply be gone)?
function loopsSeenBy(x, z, r = 95) { const P = GAME.player; return !!P && dist2(P.x, P.z, x, z) < r * r; }
function loopsCarGone(c) {
  c.state = 'gone';
  for (const id of [c.horse, c.carter, ...c.esc]) { const e = getEnt(id); if (e && !e.removed) { if (e.alive) { e.alive = false; e.removeAt = GAME.t; } e.lCar = null; } }
  if (c.cart) { loopsCartFree(c); }
}
// the carter or the horse killed: the cart is lost, its goods spill and it burns
function loopsCarLost(c) {
  c.state = 'wreck'; c.wreckT = 0;
  LOOPS.stats.raided++;
  const carter = getEnt(c.carter), horse = getEnt(c.horse);
  const killer = (carter && !carter.alive && carter.lastHitBy != null ? getEnt(carter.lastHitBy) : null) || (horse && !horse.alive && horse.lastHitBy != null ? getEnt(horse.lastHitBy) : null);
  const by = killer && killer.faction <= 2 && killer.faction !== c.realm ? killer.faction : null;
  const P = GAME.player, byPlayer = killer && P && killer === P;
  const took = [];
  for (const g in c.load) {
    const n = c.load[g];
    if (by != null && !byPlayer) { const k = loopsAdd(by, g, n * LT.raidShare, false); if (k >= 1) took.push(`${Math.round(k)} ${LOOPS_LABEL[g]}`); }
  }
  if (by != null) LOOPS.stats.raidedBy[by]++;
  // the player who takes it finds a share on the ground (goods, by what the cart carried)
  if (byPlayer) {
    const spill = { food: 'bread', timber: 'plank', stone: 'stone', iron: 'iron' };
    let k = 0;
    for (const g in c.load) {
      const id = spill[g]; if (!id || !GOODS[id]) continue;
      const W = LOOPS_WORTH[id] ? LOOPS_WORTH[id][1] : 1, n = Math.max(1, Math.round((c.load[g] * 0.35) / W));
      dropGood(id, Math.min(30, n), c.ax + Math.cos(c.yaw) * (k * 0.9 - 1.2) * 1.6, c.az - Math.sin(c.yaw) * (k * 0.9 - 1.2) * 1.6);
      k++;
    }
    LOOPS.you.raids++;
  }
  c.load = {};
  // its people run (the escort fight on), the horse bolts
  if (carter && carter.alive) { carter.lCar = null; carter.lFlee = c.realm; }
  if (horse && horse.alive) { horse.lCar = null; horse.lBolt = { x: horse.x + (Math.random() - 0.5) * 40, z: horse.z + (Math.random() - 0.5) * 40, until: GAME.t + 20 }; }
  for (const id of c.esc) { const e = getEnt(id); if (e && e.alive) e.lCar = null; }
  // the cart set alight
  if (c.cart) c.cart.burn = 0.05;
  const R = REALMS[c.realm], K = WAR.keeps[c.keep];
  const txt = `${byPlayer ? 'You fall' : by != null ? REALMS[by].name + ' falls' : 'Raiders fall'} on ${possessive(R.name)} cart for ${K ? K.site.name : 'its keep'}${took.length ? `: ${took.join(', ')} taken` : ''}.`;
  news(txt, by != null ? by : c.realm, P && P.faction === c.realm ? 'alarm' : 'normal');
}
// the escort's and the carter's thinking (from updateNPCs, 08_ai.js)
function loopsEscortThink(e, dt) {
  const c = e.lCar;
  if (!c || c.state !== 'road') { loopsStrayThink(e, dt); return; }
  const horse = loopsEnt(c.horse);
  if (!horse) { loopsStrayThink(e, dt); return; }
  // a foe near the cart: fight it (not far from the cart)
  const t0 = getEnt(e.target);
  if (!(t0 && t0.alive && isEnemy(e, t0) && dist2(t0.x, t0.z, horse.x, horse.z) < 26 * 26)) e.target = null;
  if (!e.target) { const t = pickTarget(e, 16); if (t && dist2(t.x, t.z, horse.x, horse.z) < 22 * 22) e.target = t.id; }
  const t = getEnt(e.target);
  if (t && t.alive) { fightTarget(e, t, dt); return; }
  // beside the cart, a step back from its wheels
  const hy = c.yaw, ox = Math.cos(hy) * 1.9 * e.lSide, oz = -Math.sin(hy) * 1.9 * e.lSide;
  const cx = (c.ax != null ? c.ax : horse.x) + ox, cz = (c.az != null ? c.az : horse.z) + oz;
  moveToward(e, cx, cz, dt, 1.0, 0.6);
}
function loopsCarterThink(e, dt) {
  const c = e.lCar;
  if (c && c.state === 'road') return; // led by the cart's step (loopsCarStep)
  loopsStrayThink(e, dt);
}
// a carter whose cart is lost, an escort with none: home to the town, and gone when out of sight
function loopsStrayThink(e, dt) {
  const R = REALMS[e.faction] || REALMS[0], T = R.town;
  if (e.role === 'escort') { const t = pickTarget(e, 14); if (t) { e.target = t.id; fightTarget(e, t, dt); return; } }
  // gone once nobody is by to see it; in sight, home through the door of a house of its town
  e.lStrayT = (e.lStrayT || 0) + dt;
  if (!loopsSeenBy(e.x, e.z) || (e.lStrayT > 150 && !loopsSeenBy(e.x, e.z, 35))) { e.alive = false; e.removeAt = GAME.t; return; }
  let H = e.lHome != null ? HOUSES[e.lHome] : null;
  if (!H || !houseIntact(H)) {
    H = null; let bd = 260 * 260;
    for (const h of HOUSES) { if (h.keepHall || h.realm !== e.faction || !houseIntact(h)) continue; const d = dist2(h.door.c.x, h.door.c.z, e.x, e.z); if (d < bd && dist2(h.door.c.x, h.door.c.z, T.x, T.z) < 200 * 200) { bd = d; H = h; } }
    e.lHome = H ? H.num : null;
  }
  if (!H) { moveToward(e, T.x, T.z, dt, e.lFlee != null ? 1.6 : 1.0, 6); return; }
  const D = H.door.c;
  if (e.lIn) { if (GAME.t > e.lIn) { e.alive = false; e.removeAt = GAME.t; setHouseDoor(H, false, null, true); } return; }
  if (dist2(e.x, e.z, D.x, D.z) < 1.3 * 1.3) { setHouseDoor(H, true, e); e.lIn = GAME.t + 0.8; moveToward(e, D.x, D.z, dt, 0.6, 0); return; }
  moveToward(e, D.x, D.z, dt, e.lFlee != null ? 1.6 : 1.0, 0.4);
}
function loopsHorseThink(e, dt) {
  if (e.lCar && e.lCar.state === 'road') return; // walked by its cart
  const b = e.lBolt;
  if (b && GAME.t < b.until) { moveToward(e, b.x, b.z, dt, 1.4, 2); return; }
  // loose: it wanders off and is gone out of sight
  if (!loopsSeenBy(e.x, e.z)) { e.alive = false; e.removeAt = GAME.t; }
}

/* ------------------------------------------------------------------ */
/* the cart drawn: a two-wheeled wain behind its horse                  */
/* ------------------------------------------------------------------ */
const LOOPS_CART = { geo: null, wheel: null, load: {}, shaftL: 2.3, axleBack: 1.15, wheelR: 0.58, track: 0.82 };
function loopsCartGeo() {
  if (LOOPS_CART.geo) return;
  const C = LOOPS_CART, wood = [0.45, 0.32, 0.2], dark = [0.32, 0.23, 0.15];
  const box = (b, w, h, d, x, y, z, m, col, ry = 0, rx = 0) => b.add(new THREE.BoxGeometry(w, h, d), new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1)), m, col);
  // the bed (frame at the axle, z forward), its boards, side rails and stakes, and the shafts forward to the horse
  const b = new Batch(), bedY = 0.78;
  for (let i = 0; i < 5; i++) box(b, 1.42, 0.06, 0.4, 0, bedY, -0.9 + i * 0.42, MAT.wood, i % 2 ? wood : [0.48, 0.35, 0.22]);
  box(b, 0.1, 0.12, 2.3, -0.66, bedY - 0.09, 0, MAT.wood, dark); box(b, 0.1, 0.12, 2.3, 0.66, bedY - 0.09, 0, MAT.wood, dark);
  for (const s of [-1, 1]) {
    box(b, 0.06, 0.32, 2.2, s * 0.72, bedY + 0.2, 0, MAT.wood, wood);
    for (const z of [-1.0, -0.33, 0.33, 1.0]) box(b, 0.07, 0.5, 0.07, s * 0.74, bedY + 0.2, z, MAT.wood, dark);
  }
  box(b, 1.42, 0.3, 0.06, 0, bedY + 0.18, -1.12, MAT.wood, wood);
  // the shafts: from under the bed's front corners forward to the horse's flanks (a little up: the horse's collar)
  const sh = C.shaftL;
  for (const s of [-1, 1]) {
    const x0 = s * 0.6, z0 = 0.9, x1 = s * 0.5, z1 = 0.9 + sh, y0 = bedY - 0.1, y1 = 0.95;
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1), new THREE.Vector3(0, 1, 0));
    m.multiply(new THREE.Matrix4().makeScale(1, 1, 1));
    const g = new THREE.BoxGeometry(0.08, 0.08, L);
    const M = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), new THREE.Quaternion().setFromRotationMatrix(m), new THREE.Vector3(1, 1, 1));
    b.add(g, M, MAT.wood, dark);
  }
  // the axle under the bed
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, C.wheelR, 0), MAT.wood, dark);
  C.geo = b.build();
  // a wheel: a rim of eight felloes, an iron tyre, a hub and spokes (turned about x)
  const w = new Batch();
  const tyre = new THREE.TorusGeometry(C.wheelR - 0.02, 0.045, 6, 18);
  w.add(tyre, new THREE.Matrix4().makeRotationY(Math.PI / 2), MAT.metal, [0.3, 0.3, 0.32]);
  w.add(new THREE.TorusGeometry(C.wheelR - 0.09, 0.05, 5, 16), new THREE.Matrix4().makeRotationY(Math.PI / 2), MAT.wood, wood);
  w.add(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 10), new THREE.Matrix4().makeRotationZ(Math.PI / 2), MAT.wood, dark);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; w.add(new THREE.BoxGeometry(0.05, C.wheelR - 0.12, 0.06), new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(0, (C.wheelR - 0.12) / 2 + 0.06, 0)), MAT.wood, wood); }
  C.wheel = w.build();
  // the loads: sacks of grain and bread, logs, dressed stone, iron bars under a cloth
  for (const g of LOOPS_K) { const lb = new Batch(); loopsLoadInto(lb, g, null); LOOPS_CART.load[g] = lb.build(); }
}
// a load's pieces into a batch, through M (null: as it lies on the cart's bed)
const _llQ = new THREE.Quaternion(), _llE = new THREE.Euler(), _llV = new THREE.Vector3(), _llS = new THREE.Vector3();
function loopsLoadInto(b, g, M) {
  const bedY = 0.78;
  const put = (geo, m4, mat, col) => { if (M) m4.premultiply(M); b.add(geo, m4, mat, col); };
  const mk = (x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(_llV.set(x, y, z), _llQ.setFromEuler(_llE.set(rx, ry, rz)), _llS.set(sx, sy, sz));
  if (g === 'food') {
    for (const [x, z, k] of [[-0.35, -0.6, 1], [0.32, -0.55, 0.95], [-0.3, 0.05, 1.05], [0.34, 0.1, 0.9], [0, 0.65, 1], [0.02, -0.25, 0.85]]) put(new THREE.SphereGeometry(0.3, 9, 7), mk(x, bedY + 0.26 * k + (x === 0.02 ? 0.3 : 0), z, 0, x * 3, 0.2 * x, 0.95 * k, 0.75 * k, 1.15 * k), MAT.cloth, [0.72, 0.64, 0.48]);
  } else if (g === 'timber') {
    for (const [x, y] of [[-0.42, 0], [0, 0], [0.42, 0], [-0.21, 0.36], [0.21, 0.36], [0, 0.7]]) put(new THREE.CylinderGeometry(0.19, 0.2, 2.3, 9), mk(x, bedY + 0.22 + y, 0, Math.PI / 2, 0, 0), MAT.logH, [0.46, 0.34, 0.22]);
  } else if (g === 'stone') {
    for (let i = 0; i < 9; i++) { const x = ((i % 3) - 1) * 0.42, z = (Math.floor(i / 3) - 1) * 0.6, y = bedY + 0.2 + (i === 4 ? 0.36 : 0); put(new THREE.BoxGeometry(0.38, 0.34, 0.5), mk(x, y, z, 0, (i * 0.37) % 0.3, 0), MAT.stone, [0.62, 0.6, 0.55]); }
  } else if (g === 'iron') {
    for (let i = 0; i < 6; i++) put(new THREE.BoxGeometry(0.12, 0.08, 0.9), mk(-0.3 + i * 0.12, bedY + 0.08, 0.6, 0, 0, 0), MAT.metal, [0.36, 0.36, 0.38]);
    put(new THREE.BoxGeometry(0.9, 0.24, 0.7), mk(0, bedY + 0.14, -0.5, 0, 0, 0), MAT.cloth, [0.5, 0.42, 0.3]);
  }
}
function loopsCartMake(c) {
  loopsCartGeo();
  const K = { root: new THREE.Group(), meshes: [], wheels: [], loads: {}, casters: [], burn: 0, tipped: 0, tip: 0, ax: c.ax, az: c.az };
  K.mat = shareMat(siegeMat, { uFlash: { value: 0 }, uChar: { value: 0 }, uEmber: { value: 0 } });
  K.root.rotation.order = 'YXZ';
  const add = (geo, parent) => { const m = new THREE.Mesh(geo, K.mat); m.renderOrder = 1; (parent || K.root).add(m); K.casters.push(shadowCaster(m, BUILDING_DEPTH || (BUILDING_DEPTH = depthFrom(buildingMat)))); K.meshes.push(m); return m; };
  K.bed = add(LOOPS_CART.geo);
  for (const s of [-1, 1]) { const w = add(LOOPS_CART.wheel); w.position.set(s * LOOPS_CART.track, LOOPS_CART.wheelR, 0); K.wheels.push(w); }
  for (const g of LOOPS_K) { K.loads[g] = add(LOOPS_CART.load[g]); K.loads[g].visible = false; }
  scene.add(K.root);
  c.cart = K;
}
function loopsCartFree(c) {
  const K = c.cart;
  if (!K) return;
  for (const m of K.meshes) shadowDrop(m);
  K.root.removeFromParent();
  c.cart = null;
}
// the trailer's pull: the axle follows the hitch at the shafts' length; bodies are put out of the bed's footprint
function loopsCartFollow(c, horse, dt) {
  const hx = horse.x - Math.sin(horse.yaw) * 0.25, hz = horse.z - Math.cos(horse.yaw) * 0.25;
  const L = LOOPS_CART.shaftL + 0.9 - 0.25;
  let dx = hx - c.ax, dz = hz - c.az;
  const d = Math.hypot(dx, dz) || 1;
  const nax = hx - (dx / d) * L, naz = hz - (dz / d) * L;
  const moved = Math.hypot(nax - c.ax, naz - c.az);
  c.ax = nax; c.az = naz; c.yaw = Math.atan2(dx, dz);
  c.wheel -= moved / LOOPS_CART.wheelR;
  // keep bodies out of the cart's bed (not its own people: they walk beside it)
  forNear(c.ax, c.az, 2.6, (o) => {
    if (!o.alive || o.kind === 'door' || o.flying || o.id === c.horse || o.fixedY != null) return;
    const ox = o.x - c.ax, oz = o.z - c.az, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = ox * cs - oz * sn, lz = ox * sn + oz * cs, r = o.radius * (o.scale || 1);
    const hx2 = 0.8 + r, hz2 = 1.2 + r;
    if (Math.abs(lx) < hx2 && lz > -hz2 && lz < hz2) {
      const px = hx2 - Math.abs(lx), pz = hz2 - Math.abs(lz);
      let nx = lx, nz = lz;
      if (px < pz) nx = Math.sign(lx || 1) * hx2; else nz = Math.sign(lz || 1) * hz2;
      const wx = c.ax + nx * cs + nz * sn, wz = c.az - nx * sn + nz * cs;
      stepTo(o, wx, wz);
    }
  });
}
// every frame: carts near the camera made, posed on the ground, loaded as they carry; far ones let go
function loopsDraw(dt) {
  loopsYardDraw();
  if (!LOOPS.caravans.length) return;
  const cx = camera.position.x, cz = camera.position.z, R2 = (quality.level === 'low' ? 110 : quality.level === 'medium' ? 150 : 190) ** 2;
  for (const c of LOOPS.caravans) {
    if (c.state === 'gone') continue;
    const near = dist2(c.ax, c.az, cx, cz) < R2;
    if (!near) { if (c.cart) loopsCartFree(c); continue; }
    if (!c.cart) loopsCartMake(c);
    const K = c.cart, C = LOOPS_CART, sn = Math.sin(c.yaw), cs = Math.cos(c.yaw);
    // the wheels on the ground, the shafts' tips at the horse's flanks: roll from the wheels, pitch from the hitch
    const yl = heightAt(c.ax - cs * C.track, c.az + sn * C.track), yr = heightAt(c.ax + cs * C.track, c.az - sn * C.track);
    const horse = getEnt(c.horse);
    const ay = (yl + yr) / 2;
    let pitch = 0;
    if (horse && horse.alive && c.state === 'road') {
      const hx = horse.x - sn * 0.25, hz = horse.z - cs * 0.25, hitchY = heightAt(hx, hz) + 1.02;
      const run = Math.hypot(hx - c.ax, hz - c.az) || 1, rise = hitchY - (ay + 0.95);
      pitch = -Math.atan2(rise, run);
    }
    K.tip = c.state === 'wreck' ? Math.min(1, K.tip + dt * 1.8) : 0;
    K.root.position.set(c.ax, ay + (C.wheelR - C.wheelR) - K.tip * 0.25, c.az);
    K.root.rotation.set(clamp(pitch, -0.35, 0.35) + K.tip * 0.18, c.yaw, Math.atan2(yr - yl, C.track * 2) + K.tip * 0.5);
    for (const w of K.wheels) w.rotation.x = c.wheel;
    // the load: what it carries most of, shown
    let top = null, tq = 0;
    for (const g of LOOPS_K) if ((c.load[g] || 0) > tq) { tq = c.load[g]; top = g; }
    for (const g of LOOPS_K) K.loads[g].visible = g === top && tq >= 1;
    // burnt
    if (c.state === 'wreck') {
      K.burn = Math.min(1, K.burn + dt / 30);
      if (!K.fired) { K.fired = 1; addFire(c.ax, ay + 0.9, c.az, 1.1, false, GAME.t + 40, { r: 9, k: 1.2 }); }
    }
    K.mat.uniforms.uChar.value = K.burn;
    K.mat.uniforms.uEmber.value = c.state === 'wreck' ? Math.max(0, 1 - c.wreckT / 50) * 0.8 : 0;
  }
}

/* ------------------------------------------------------------------ */
/* the town's woodcutters, quarrymen and smith                          */
/* ------------------------------------------------------------------ */
// Two woodcutters and a quarryman in every town (villagers with ai.lj): by day they walk out to a grown tree or a rock
// near the town, fell the tree with an axe in hand (it comes down and lies as a felled tree does, and grows again from
// a sapling in its time) or break stone from the rock, and the timber or stone goes into the realm's stores. Out of the
// player's sight the town's rate does the same work (loopsProduce).
function loopsSpawnWorkers() {
  for (const R of REALMS) {
    const S = R.town;
    for (const job of ['wood', 'wood', 'stone']) {
      const a = Math.random() * TAU, rr = 8 + Math.random() * 10;
      const x = S.x + Math.cos(a) * rr, z = S.z + Math.sin(a) * rr;
      if (!isWalkable(x, z)) continue;
      const look = villagerLook(R.id);
      look.fem = 0; look.mask = (look.mask & ~WB.robe) | WB.belt;
      const v = makeEnt({ kind: 'humanoid', faction: FACTION_NEUTRAL, role: 'villager', level: 5, name: `${pick(Math.random, VILLAGER_NAMES)} the ${job === 'wood' ? 'woodcutter' : 'quarryman'}`, x, z, y: heightAt(x, z), look, home: { x: S.x, z: S.z, r: 20 }, speed: 2.2 });
      v.maxHp = v.hp = 300;
      v.ai.lj = { job, realm: R.id, look: look.mask, next: GAME.t + 20 + Math.random() * 40 };
      LOOPS.workers.push(v.id);
    }
  }
}
// from houseLife (08f_townlife.js), by day once out of doors: true while a worker is at its trade
function loopsLife(e, dt) {
  const J = e.ai.lj;
  if (!J || !LOOPS.on) return false;
  if (GAME.t < J.next) return false;
  const T = REALMS[J.realm].town;
  if (J.job === 'wood') {
    const t = loopsTreeFor(T, e);
    if (!t) { J.next = GAME.t + 60; return false; }
    t.lClaim = e.id;
    lifePlan(e, [loopsApproach(t.x, t.z, TREE_DIM[t.kind].r * natS(t) + 0.75, e), lifeStep('lchop', { tree: t })]);
  } else {
    const ri = loopsRockFor(T, e);
    if (ri == null) { J.next = GAME.t + 60; return false; }
    const r = W.rocks[ri];
    lifePlan(e, [loopsApproach(r.x, r.z, r.s * 0.8 + 0.7, e), lifeStep('lquarry', { rock: ri })]);
  }
  J.next = GAME.t + 50 + Math.random() * 40;
  return lifeRun(e, dt);
}
// a 'go' step to the near side of a trunk or a rock
function loopsApproach(x, z, r, e) {
  const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz) || 1;
  return houseGo(x + (dx / d) * r, z + (dz / d) * r, { T: 70, loose: true });
}
// a grown standing tree 30 to 95 m out of the town, not in a field or a camp, not claimed by another
function loopsTreeFor(T, e) {
  let best = null, bd = Infinity;
  natTreesNear(T.x, T.z, 95, (t, d) => {
    if (d < 30 || !natStanding(t) || t.fall || (t.grow ?? 1) < 0.95 || t.lClaim != null || t.burning) return;
    if (typeof plotAt === 'function' && plotAt(t.x, t.z, 2)) return;
    const k = d + Math.random() * 25;
    if (k < bd) { bd = k; best = t; }
  });
  return best;
}
function loopsRockFor(T, e) {
  let best = null, bd = Infinity;
  for (let i = 0; i < W.rocks.length; i++) {
    const r = W.rocks[i];
    if (r.s < 0.55) continue;
    const d = Math.hypot(r.x - T.x, r.z - T.z);
    if (d < 25 || d > 130) continue;
    const Rk = CRAFT.rocks.get(i);
    if (Rk && Rk.n <= 0) continue;
    const k = d + Math.random() * 30;
    if (k < bd) { bd = k; best = i; }
  }
  return best;
}
// the steps of a worker's plan (lifeRun, 08f_townlife.js)
function loopsLifeStep(e, st, plan, dt, next) {
  const J = e.ai.lj;
  if (st.k === 'lchop') {
    const t = st.tree;
    const done = () => { if (t) t.lClaim = null; loopsTool(e, false); next(); return true; };
    if (!t) return done();
    // the tree down and lying still: to the log, cut it up and carry it off (the stump grows again in its time)
    if (st.ph === 'split') {
      if (!t.log) { loopsBring(J.realm, 'timber'); LOOPS.stats.felled++; return done(); }
      if (!st.at2) {
        const len = TREE_DIM[t.kind].trunk * natS(t), along = Math.min(len * 0.5, 2.4), side = (e.id % 2 ? 1 : -1) * (TREE_DIM[t.kind].r * natS(t) + 0.8);
        st.lx = t.x + t.fall.ux * along + t.fall.uz * side; st.lz = t.z + t.fall.uz * along - t.fall.ux * side;
        st.mx = t.x + t.fall.ux * along; st.mz = t.z + t.fall.uz * along;
        st.at2 = plan.t + 25; st.n2 = 0; st.next2 = 0;
      }
      if (dist2(e.x, e.z, st.lx, st.lz) > 0.6 * 0.6 && plan.t < st.at2) { loopsTool(e, false); moveToward(e, st.lx, st.lz, dt, 0.9, 0.3); return true; }
      turnToward(e, st.mx, st.mz, dt * 8);
      loopsTool(e, true);
      if (plan.t >= st.next2) {
        st.next2 = plan.t + 1.15;
        setAct(e, 1, 0.62);
        later(0.3, () => { if (!e.alive || !t.log) return; st.n2++; natChips(st.mx, heightAt(st.mx, st.mz) + 0.4, st.mz, Math.sin(e.yaw), Math.cos(e.yaw), 8); natSfx('split', st.mx, st.mz); if (st.n2 >= 4) { natRemoveLog(t); t.leaf = 0; } });
      }
      if (plan.t > st.at2 + 30) { if (t.log) { natRemoveLog(t); t.leaf = 0; } }
      return true;
    }
    if (t.felled) {
      if (!t.chopped || !t.fall) return done();
      if (!t.fall.done) { if (plan.t > 90) return done(); return true; } // it is coming down
      st.ph = 'split'; st.timber = 2.5 + natS(t) * 2.5;
      return true;
    }
    if (t.fall || !natStanding(t)) return done();
    if (dist2(e.x, e.z, t.x, t.z) > (TREE_DIM[t.kind].r * natS(t) + 1.6) ** 2) return done();
    turnToward(e, t.x, t.z, dt * 8);
    loopsTool(e, true);
    if (!st.need) { st.need = 4 + Math.round(natS(t) * 2) + (t.kind === 'oak' ? 1 : 0); st.n = 0; st.at = plan.t + 0.4; natTake(t); t.notchYaw = Math.atan2(t.x - e.x, t.z - e.z) + Math.PI; }
    if (plan.t >= st.at) {
      st.at = plan.t + 1.15;
      setAct(e, 1, 0.62);
      later(0.3, () => {
        if (!e.alive || t.felled) return;
        st.n++;
        const D = TREE_DIM[t.kind], ux = Math.sin(e.yaw), uz = Math.cos(e.yaw);
        t.notch = st.n / st.need; t.shake = Math.min(1, t.shake + 0.4);
        natChips(t.x - ux * D.r * natS(t), t.y + D.cut * natS(t) + 0.15, t.z - uz * D.r * natS(t), -ux, -uz, 10);
        natSfx('chop', t.x, t.z);
        if (st.n >= st.need) { t.notch = 1; fellTree(t, t.x - e.x, t.z - e.z, 30, true); }
      });
    }
    if (plan.t > 70 && !t.felled) return done();
    return true;
  }
  if (st.k === 'lquarry') {
    const r = W.rocks[st.rock];
    if (!r) { loopsTool(e, false); next(); return true; }
    turnToward(e, r.x, r.z, dt * 8);
    loopsTool(e, true);
    if (st.n == null) { st.n = 0; st.at = plan.t + 0.4; }
    if (plan.t >= st.at && st.n < 6) {
      st.at = plan.t + 1.2;
      setAct(e, 1, 0.62);
      later(0.3, () => {
        if (!e.alive) return;
        st.n++;
        const ux = Math.sin(e.yaw), uz = Math.cos(e.yaw), hx = r.x - ux * r.s * 0.7, hz = r.z - uz * r.s * 0.7, hy = Math.max(heightAt(hx, hz) + 0.4, r.y + r.s * 0.35);
        FX.dust(hx, hy - 0.3, hz, 3, [0.55, 0.53, 0.5]);
        if (typeof survSfx === 'function') survSfx('mine', r.x, r.z);
      });
    }
    if (st.n >= 6) {
      loopsBring(J.realm, 'stone');
      if (Math.random() < 0.35) loopsBring(J.realm, 'iron');
      LOOPS.stats.quarried++;
      const R = CRAFT.rocks.get(st.rock) || { n: 3, until: 0 };
      R.n--; if (R.n <= 0) R.until = GAME.t + 900;
      CRAFT.rocks.set(st.rock, R);
      loopsTool(e, false); next();
    }
    if (plan.t > 40) { loopsTool(e, false); next(); }
    return true;
  }
  return false;
}
// the axe (or the pick: the axe's bit) in hand while at work, and put away after
function loopsTool(e, on) {
  const J = e.ai.lj, L = e.look;
  if (!J || !L) return;
  if (on) L.mask = (L.mask & ~WEAPON_BITS) | WB.axe;
  else L.mask = J.look;
}

/* ------------------------------------------------------------------ */
/* the player's deliveries                                              */
/* ------------------------------------------------------------------ */
// what the player carries that the stores take, by store: [[goodId, n, units], ...]
function loopsCarried() {
  const by = {};
  for (const id in INV.goods || {}) {
    const n = INV.goods[id], w = LOOPS_WORTH[id];
    if (!w || !(n > 0)) continue;
    (by[w[0]] = by[w[0]] || []).push([id, n, n * w[1]]);
  }
  return by;
}
// the pay for so many units of a store's good to a realm now: realm points and gold, by need and your level
// `floor`: what a merchant would give for the same goods: the realm never pays less gold than that (firewood and sticks,
// worth little to the stores, sell for a gold piece each), and a tenth more for each step of its need
function loopsPay(r, g, units, floor = 0) {
  const L = GAME.prog ? GAME.prog.level : 1, need = loopsNeedK(r, g), lk = 1 + L / 25;
  return { rp: Math.round(units * LT.rp[g] * need * lk), gold: Math.round(Math.max(units * LT.gold[g] * need * lk, floor * (1 + 0.1 * need))), need };
}
// what a merchant gives for a list of [goodId, n, units]
const loopsSellOf = (list) => list.reduce((a, [id, n]) => a + Math.max(1, Math.floor((GOODS[id] ? GOODS[id].value : 1) * 0.5)) * n, 0);
// hand over every good of a store's kind: into the town's stores (where = realm) or a keep's (where = keep)
function loopsDeliver(g, K = null) {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !prog) return null;
  const r = K ? K.realm : P.faction;
  if (r !== P.faction) return null;
  const list = (loopsCarried()[g] || []);
  if (!list.length) return null;
  let units = 0;
  const floor = loopsSellOf(list);
  for (const [id, n, u] of list) { if (goodsTake(id, n)) units += u; }
  if (!(units > 0)) return null;
  // a keep's stores take what they hold; the rest goes on to the town
  let into = units;
  if (K && LOOPS_K.includes(g)) { into = loopsKeepAdd(K, g, units); if (units - into > 0) loopsAdd(r, g, units - into, false); }
  else loopsAdd(r, g, units, false);
  // a keep in want pays as the realm would for what it lacks most
  const pay = loopsPay(r, g, units, floor);
  if (K && LOOPS_K.includes(g)) { const kn = 1 + 1.5 * clamp(1 - loopsKeepFill(K, g), 0, 1); pay.rp = Math.round(pay.rp * Math.max(1, kn / pay.need)); pay.gold = Math.round(pay.gold * Math.max(1, kn / pay.need)); }
  addRP(pay.rp); addGold(pay.gold);
  LOOPS.you.units += units; LOOPS.you.n++; LOOPS.you.rp += pay.rp; LOOPS.you.gold += pay.gold;
  LOOPS.stats.delivered += units; LOOPS.stats.deliveries++;
  // the campaign remembers who fed the war
  if (typeof CAMPAIGN !== 'undefined' && CAMPAIGN.state === 'war') { LOOPS.renownAcc = (LOOPS.renownAcc || 0) + units; const pts = Math.floor(LOOPS.renownAcc / LT.renownPer); if (pts > 0) { LOOPS.renownAcc -= pts * LT.renownPer; CAMPAIGN.renown[r] += pts; } }
  uiLog(`You give ${Math.round(units)} ${LOOPS_LABEL[g]} to ${K ? K.site.name + "'s" : possessive(REALMS[r].name)} stores: ${fmtInt(pay.rp)} realm points and ${fmtInt(pay.gold)} gold.`, 'rp');
  if (typeof GUIDE !== 'undefined') GUIDE.made.push('deliver');
  saveSoon();
  return { units, ...pay };
}
// a horse of your own given to the realm's stables
function loopsGiveHorse(e) {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !e || !e.tame || e.tame.owner !== 'player' || e.tame.k !== 'horse' || !e.alive) return false;
  const rec = e.tame, L = prog.level, need = loopsNeedK(P.faction, 'horses');
  const q = clamp((rec.tr.speed || 1) * (rec.tr.size || 1), 0.7, 1.5);
  const rp = Math.round(LT.rp.horses * need * q * (1 + L / 25)), gold = Math.round(LT.gold.horses * need * q * (1 + L / 25));
  loopsAdd(P.faction, 'horses', 1, false);
  addRP(rp); addGold(gold);
  LOOPS.you.units += 1; LOOPS.you.n++; LOOPS.you.rp += rp; LOOPS.you.gold += gold;
  uiLog(`You give ${rec.name} to ${possessive(REALMS[P.faction].name)} stables: ${fmtInt(rp)} realm points and ${fmtInt(gold)} gold.`, 'rp');
  rec.owner = 'gone'; removeEnt(e); ANIMALS.uiDirty = true;
  if (typeof GUIDE !== 'undefined') GUIDE.made.push('deliver');
  saveSoon();
  return true;
}
// the stores' dialog: the town's quartermaster, or a keep hall's stores (K)
function loopsOpenStores(K = null) {
  const P = GAME.player;
  if (!P) return;
  const r = K ? K.realm : P.faction, R = REALMS[r];
  if (r !== P.faction) { uiError(`These stores are kept for ${R.name}`); return; }
  UI.modal = 'dialog';
  $('dialog').hidden = false;
  $('dlg-title').textContent = K ? `The stores of ${K.site.name}` : `${possessive(R.name)} stores`;
  const S = K ? loopsKeep(K) : LOOPS.r[r], tg = K ? LT.keepTarget : LT.target, goods = K ? LOOPS_K : LOOPS_R;
  const bar = (g) => { const f = clamp(S[g] / tg[g], 0, 1.6); const short = f < 0.2; return `<li class="ls-row${short ? ' short' : ''}"><span class="ls-g">${iconSvg(LOOPS_ICON[g] || 'bag', 16)}${LOOPS_LABEL[g]}</span><span class="ls-bar"><i style="width:${Math.round(Math.min(1, f / 1.6) * 100)}%"></i><b style="left:${Math.round(100 / 1.6)}%"></b></span><span class="ls-n">${fmtInt(S[g])}</span></li>`; };
  const carried = loopsCarried();
  const offers = goods.filter((g) => carried[g] && g !== 'horses').map((g) => { const u = carried[g].reduce((a, q) => a + q[2], 0), p = loopsPay(r, g, u, loopsSellOf(carried[g])); return [g, u, p]; });
  const horses = !K && typeof anMine === 'function' ? anMine().filter((e) => e.alive && e.tame.k === 'horse' && anAdult(e.tame) && dist2(e.x, e.z, P.x, P.z) < 22 * 22) : [];
  const wants = goods.filter((g) => S[g] < tg[g] * 0.5).map((g) => LOOPS_LABEL[g]);
  $('dlg-body').innerHTML = `<p>${K ? `The keep's stewards keep its garrison fed and its walls mended from these stores; carts from ${R.townName} fill them.` : `The quartermaster keeps what the realm's fields, woods, quarries and herds bring in: the war draws on it for every band, engine, gate and wall.`} ${wants.length ? `<b>${R.name} wants ${wants.join(', ')}</b>: it pays more for what it lacks.` : 'The stores are well stocked.'}</p><ul class="loops-stores">${goods.map(bar).join('')}</ul>${offers.length || horses.length ? '' : '<p class="fineprint">You carry nothing the stores take. Food, timber, stone, iron, hides and wool all count (and a horse of your own, at the town).</p>'}`;
  const box = $('dlg-actions');
  box.innerHTML = '';
  const btn = (txt, fn, primary) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (primary ? ' primary' : ''); b.textContent = txt; b.onclick = fn; box.appendChild(b); return b; };
  for (const [g, u, p] of offers) btn(`Give ${u < 10 ? Math.round(u * 10) / 10 : Math.round(u)} ${LOOPS_LABEL[g]} (${fmtInt(p.rp)} rp, ${fmtInt(p.gold)} gold)`, () => { loopsDeliver(g, K); sfx('coins'); loopsOpenStores(K); }).dataset.lgive = g;
  for (const e of horses) btn(`Give ${e.tame.name} to the stables`, () => { loopsGiveHorse(e); loopsOpenStores(K); }).dataset.lhorse = e.id;
  btn('Done', closeDialog, true);
}

/* ------------------------------------------------------------------ */
/* the stores yard: the realm's stores shown, and set alight by a raid   */
/* ------------------------------------------------------------------ */
// Behind each town's quartermaster a yard of the realm's stores: stacks of logs, dressed stone, sacks of grain and iron
// under a cloth, as many as its stores hold (a stack for each third of the target, at most three), made again when a
// level changes. A raider with a burning brand sets an enemy's yard alight (Use beside it): it burns with real flames
// for half a minute, chars, and a share of the realm's timber, food, wool and hides goes up with it.
// [stack, good, x along the yard, z across it]: every stack turned a quarter so its long side runs along the yard
// (logs 2.3 m, 1.24 m wide; stone 1.7 by 1.22; sacks 2 by 1.3; the iron bars and their bale 1.9 by 0.9), apart
const YARD_CELL = [[0, 'timber', -2.0, 0], [1, 'timber', -2.0, -1.45], [2, 'timber', -2.0, 1.45], [0, 'stone', 0.4, 0], [1, 'stone', 0.4, -1.3], [2, 'stone', 0.4, 1.3], [0, 'food', 2.45, 0], [1, 'food', 2.45, -1.4], [2, 'food', 2.45, 1.4], [0, 'iron', 0.4, 2.55]];
const YARD_BOX = { x: 0.15, z: 0.45, hx: 3.4, hz: 2.65 }; // what the stacks cover, the yard's own frame
function loopsYardSpot(R) {
  const S = R.town, want = siteToWorld(S, 16, 14), Q = R.quartermaster;
  const d = U.uGroundAO.value && U.uGroundAO.value.image && U.uGroundAO.value.image.data;
  const onPath = (x, z) => { if (!d || d.length < 1024 * 1024 * 2) return false; const i = clamp(Math.floor(x + 512), 0, 1023), j = clamp(Math.floor(z + 512), 0, 1023); return d[(j * 1024 + i) * 2 + 1] > 40; };
  for (let k = 0; k < 80; k++) {
    const a = k * 2.399, r = k * 0.45, x = want.x + Math.cos(a) * r, z = want.z + Math.sin(a) * r;
    let ok = isWalkable(x, z) && !look5InColl(x, z, 4.5) && !(typeof houseAt === 'function' && houseAt(x, z, 5));
    if (ok) for (let q = 0; q < 16 && ok; q++) { const b = (q / 16) * TAU, px = x + Math.cos(b) * 4.2, pz = z + Math.sin(b) * 4.2; if (!isWalkable(px, pz) || onPath(px, pz) || Math.abs(heightAt(px, pz) - heightAt(x, z)) > 0.5) ok = false; }
    if (ok && onPath(x, z)) ok = false;
    if (ok && Q && dist2(x, z, Q.x, Q.z) < 5.8 * 5.8) ok = false; // the quartermaster stands before it, not in it
    if (ok) { let t = 0; natTreesNear(x, z, 5.5, () => t++); if (t) ok = false; }
    if (ok) return { x, z, yaw: S.yaw };
  }
  return null;
}
function loopsYardInit() {
  loopsCartGeo();
  for (const R of REALMS) {
    const sp = loopsYardSpot(R);
    if (!sp) continue;
    const Y = { r: R.id, x: sp.x, z: sp.z, yaw: sp.yaw, key: '', burn: 0, char: 0, mesh: null, mat: shareMat(siegeMat, { uFlash: { value: 0 }, uChar: { value: 0 }, uEmber: { value: 0 } }) };
    const c = Math.cos(sp.yaw), sn = Math.sin(sp.yaw), bx = sp.x + YARD_BOX.x * c + YARD_BOX.z * sn, bz = sp.z - YARD_BOX.x * sn + YARD_BOX.z * c;
    Y.coll = addBox(bx, bz, YARD_BOX.hx, YARD_BOX.hz, sp.yaw, 'prop', 1.6);
    if (COVER.tex) coverMarkBox(bx, bz, YARD_BOX.hx, YARD_BOX.hz, sp.yaw, 0.4);
    R.lyard = Y;
    LOOPS.yards.push(Y);
  }
}
// the stacks a store shows: none under a tenth of its target, then one for each third, three at most
const loopsYardN = (r, g) => { const f = LOOPS.r[r][g] / LT.target[g]; return f < 0.1 ? 0 : Math.min(3, Math.ceil(f * 3 - 0.0001)); };
function loopsYardDraw() {
  if (!LOOPS.yards.length) return;
  for (const Y of LOOPS.yards) {
    const key = ['timber', 'stone', 'food', 'iron'].map((g) => loopsYardN(Y.r, g)).join('');
    if (key === Y.key && Y.mesh) { Y.mat.uniforms.uChar.value = Y.char; Y.mat.uniforms.uEmber.value = Y.burn > 0 ? 0.8 : 0; continue; }
    Y.key = key;
    const b = new Batch(), c = Math.cos(Y.yaw), sn = Math.sin(Y.yaw);
    const M = new THREE.Matrix4();
    for (const [i, g, lx, lz] of YARD_CELL) {
      if (i >= loopsYardN(Y.r, g)) continue;
      const wx = Y.x + lx * c + lz * sn, wz = Y.z - lx * sn + lz * c, gy = heightAt(wx, wz);
      // a stack lies across the yard (logs along its length), on the ground: the cart's bed height taken off
      M.makeRotationY(Y.yaw + Math.PI / 2 + (g === 'timber' ? 0 : (i - 1) * 0.05)).setPosition(wx, gy - 0.76, wz);
      loopsLoadInto(b, g, M);
    }
    if (Y.mesh) { Y.mesh.geometry.dispose(); Y.mesh.geometry = b.n ? b.build() : new THREE.BufferGeometry(); for (const q of Y.casters || []) q.geometry = Y.mesh.geometry; }
    else if (b.n) {
      Y.mesh = new THREE.Mesh(b.build(), Y.mat); Y.mesh.renderOrder = 1; scene.add(Y.mesh);
      Y.casters = [shadowCaster(Y.mesh, BUILDING_DEPTH || (BUILDING_DEPTH = depthFrom(buildingMat)))];
    }
    Y.mat.uniforms.uChar.value = Y.char;
  }
}
// a raid: an enemy's yard set alight with a brand
function loopsYardIgnite(Y, by) {
  if (Y.burn > 0) return;
  Y.burn = 32;
  const S = LOOPS.r[Y.r], lost = [];
  for (const [g, k] of [['timber', 0.35], ['food', 0.2], ['wool', 0.3], ['hides', 0.3]]) { const n = S[g] * k; S[g] -= n; if (n >= 1) lost.push(`${Math.round(n)} ${LOOPS_LABEL[g]}`); }
  const c = Math.cos(Y.yaw), sn = Math.sin(Y.yaw);
  for (const [lx, lz, sz] of [[-2, 0, 1.3], [0.4, 0, 0.9], [2.45, 0, 1.1]]) addFire(Y.x + lx * c + lz * sn, heightAt(Y.x, Y.z) + 0.8, Y.z - lx * sn + lz * c, sz, false, GAME.t + 32, { r: 10, k: 1.3 });
  sfxAt('crackle', Y.x, heightAt(Y.x, Y.z) + 1, Y.z);
  if (by === GAME.player) { LOOPS.you.raids++; addRP(Math.round(60 + GAME.prog.level * 3)); }
  news(`${by === GAME.player ? 'You set' : 'Raiders set'} ${possessive(REALMS[Y.r].name)} stores yard in ${REALMS[Y.r].townName} alight${lost.length ? `: ${lost.join(', ')} go up in smoke` : ''}!`, by && by.faction <= 2 ? by.faction : Y.r, 'normal');
}
function loopsYardStep(dt) {
  for (const Y of LOOPS.yards) {
    if (Y.burn > 0) { Y.burn -= dt; Y.char = Math.min(1, Y.char + dt / 20); }
    else if (Y.char > 0) Y.char = Math.max(0, Y.char - dt / 300);
  }
}

/* ------------------------------------------------------------------ */
/* heavy packs: a horse carries them                                    */
/* ------------------------------------------------------------------ */
// Logs, stone, ore and iron are heavy: on foot you carry LADEN.free of them (a log or a stone each, a plank a third,
// firewood a quarter, ore one, a bar half) at your own pace; past that you walk slower, down to 0.7 of your pace. Ride a
// horse, or have your own horse at your heels, and it carries LADEN.horse more. So a horse you tamed or bred earns its
// keep hauling what you fell and quarry to the quartermaster.
const LADEN = { free: 60, horse: 160, min: 0.7, span: 140, w: { log: 1, plank: 0.3, firewood: 0.25, stick: 0.05, stone: 1, flint: 0.4, clay: 0.6, iron_ore: 1, iron: 0.5, grave_iron: 0.5, thatch: 0.15 }, t: -1, k: 1, u: 0, said: -1e9 };
function loopsHeavy() { let u = 0; for (const id in LADEN.w) u += (INV.goods && INV.goods[id] || 0) * LADEN.w[id]; return u; }
function loopsHorseNear(P) { return typeof anMine === 'function' && anMine().some((e) => e.alive && e.tame.k === 'horse' && anAdult(e.tame) && e.tame.cmd === 'follow' && dist2(e.x, e.z, P.x, P.z) < 20 * 20); }
function loopsLadenK(P) {
  if (!LOOPS.on || P.mount || !GAME.player || P !== GAME.player) return 1;
  if (GAME.t - LADEN.t > 0.5 || GAME.t < LADEN.t) {
    LADEN.t = GAME.t;
    LADEN.u = loopsHeavy();
    const free = LADEN.free + (loopsHorseNear(P) ? LADEN.horse : 0);
    LADEN.k = LADEN.u <= free ? 1 : Math.max(LADEN.min, 1 - (LADEN.u - free) / LADEN.span * (1 - LADEN.min));
    if (LADEN.k < 0.97 && GAME.t - LADEN.said > 120) { LADEN.said = GAME.t; uiToast(`Your packs are heavy: you walk slower. Ride a horse or have yours at your heels to carry them, or give the goods to the quartermaster.`, 'hint'); }
  }
  return LADEN.k;
}
function loopsLadenHTML() {
  const P = GAME.player;
  if (!P || !LOOPS.on) return '';
  const u = loopsHeavy();
  if (u < 1) return '';
  const horse = loopsHorseNear(P) || !!P.mount, free = LADEN.free + (horse ? LADEN.horse : 0);
  return `<p class="fineprint loops-laden${u > free ? ' over' : ''}">Heavy goods: ${fmtInt(u)} of ${fmtInt(free)} you carry at your own pace${horse ? ' with your horse' : ` on foot (a horse carries ${LADEN.horse} more)`}.</p>`;
}

/* ------------------------------------------------------------------ */
/* the quartermasters: one in each town, by its stores yard             */
/* ------------------------------------------------------------------ */
function loopsSpawnQuartermasters() {
  for (const R of REALMS) {
    const S = R.town, lx = 11, lz = 8.5;
    const c = siteToWorld(S, lx, lz), yaw = S.yaw + Math.atan2(-lx, -lz);
    let x = c.x - Math.sin(yaw) * 1.05, z = c.z - Math.cos(yaw) * 1.05;
    // clear of the workstations, wells and props placed at boot, and of the houses
    for (let k = 0, x0 = x, z0 = z; k < 60; k++) {
      if (isWalkable(x, z) && !look5InColl(x, z, 0.7) && !(typeof houseAt === 'function' && houseAt(x, z, 1.0))) break;
      const a = k * 2.399, r = 0.5 + k * 0.25; x = x0 + Math.cos(a) * r; z = z0 + Math.sin(a) * r;
    }
    const look = villagerLook(R.id);
    look.mask = (look.mask & ~WB.robe) | WB.belt | WB.tabard;
    look.tabard = R.rgb.map((v) => v * 0.8 + 0.1);
    const m = makeEnt({ kind: 'humanoid', faction: FACTION_NEUTRAL, role: 'merchant', level: 20, name: `Quartermaster ${pick(Math.random, NAMES[R.id])}`, x, z, y: heightAt(x, z), yaw, look, radius: 0.45 });
    m.fixedY = heightAt(x, z);
    m.maxHp = m.hp = 500;
    m.ai.post = { x, z, yaw };
    R.quartermaster = m;
  }
}
// E beside the quartermaster: the realm's stores; and a cart of yours: walk with it
function loopsOffers(P, offer) {
  if (!LOOPS.on || P.carrying != null) return;
  const R = REALMS[P.faction], Q = R.quartermaster;
  if (Q && Q.alive) offer(dist(P.x, P.z, Q.x, Q.z), 4.4, `Speak with ${Q.name}: the realm's stores`, () => loopsOpenStores(null));
  for (const Y of LOOPS.yards) {
    if (Y.r === P.faction || Y.burn > 0 || !P.brand) continue;
    const d = dist(P.x, P.z, Y.x, Y.z);
    if (d < 6) offer(Math.max(0.1, d - 2.5), 3.5, `Set ${possessive(REALMS[Y.r].name)} stores yard alight`, () => { setAct(P, 5, 0.5); loopsYardIgnite(Y, P); }, 0.05);
  }
}

/* ------------------------------------------------------------------ */
/* the war panel's line and the war table's word                        */
/* ------------------------------------------------------------------ */
// what each realm lacks now, one line (the war panel, 08g_campaign.js): yours first
function loopsHudLine() {
  if (!LOOPS.on || !GAME.player) return '';
  const me = GAME.player.faction, parts = [];
  for (const r of [me, ...[0, 1, 2].filter((q) => q !== me)]) {
    const s = LOOPS_R.filter((g) => loopsShort(r, g) && g !== 'wool' && g !== 'hides');
    if (!s.length && r !== me) continue;
    if (!s.length) { const low = LOOPS_R.filter((g) => loopsFill(r, g) < 0.5 && g !== 'wool' && g !== 'hides'); if (low.length) parts.push(`<span style="--rc:${REALMS[r].color}">${REALMS[r].name} low on ${low.slice(0, 2).join(', ')}</span>`); continue; }
    parts.push(`<span class="short" style="--rc:${REALMS[r].color}">${REALMS[r].name} short of ${s.slice(0, 2).join(', ')}</span>`);
  }
  return parts.length ? `<div class="loops-hud">${parts.slice(0, 2).join(' · ')}</div>` : '';
}
// a sentence for the war table (04k_hall.js) and the herald: what the realm's stores lack
function loopsWarText(r) {
  const s = LOOPS_R.filter((g) => loopsFill(r, g) < 0.35);
  return s.length ? `${REALMS[r].name}'s stores run low on ${s.join(', ')}: the quartermaster in ${REALMS[r].townName} pays well for them.` : `${REALMS[r].name}'s stores are well stocked.`;
}

/* ------------------------------------------------------------------ */
/* every step                                                          */
/* ------------------------------------------------------------------ */
function loopsInit() {
  if (LOOPS.inited || !WAR.keeps.length || !REALMS[0].town) return;
  LOOPS.inited = true;
  for (const K of WAR.keeps) loopsKeep(K);
  // the realms' fields against each other: Brackenford's broad fields, the gardens of Ériu and Thule
  const area = [0, 0, 0];
  for (const F of W.fieldRects || []) { const r = F.realm != null ? F.realm : 0; if (r >= 0 && r < 3) area[r] += 4 * F.hw * F.hd; }
  const used = area.filter((a) => a > 0), mean = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 1;
  LOOPS.fieldK = area.map((a) => (a > 0 ? clamp(mean / a, 0.4, 3) : 1));
  if (!LOOPS.seeded) { for (let r = 0; r < 3; r++) for (const g of LOOPS_R) LOOPS.r[r][g] = Math.round(LT.target[g] * LT.start); LOOPS.seeded = true; }
  loopsSpawnWorkers();
  loopsSpawnQuartermasters();
  try { loopsYardInit(); } catch (err) { reportError(err); }
}
function updateLoops(dt) {
  loopsInit();
  if (!LOOPS.inited) return;
  if (!LOOPS.on) return;
  const C = LOOPS.clock;
  C.prod += dt;
  if (C.prod >= 2) { loopsProduce(C.prod); C.prod = 0; }
  loopsCaravanStep(dt);
  loopsYardStep(dt);
  C.trade -= dt;
  if (C.trade <= 0) { C.trade = 40; loopsTradeStep(); }
  // a new campaign: the keeps go back to their realms' stores at their targets
  if (LOOPS.campN !== CAMPAIGN.n) {
    if (LOOPS.campN != null) for (const K of WAR.keeps) { const S = loopsKeep(K); for (const g of LOOPS_K) S[g] = Math.max(S[g], LT.keepTarget[g]); }
    LOOPS.campN = CAMPAIGN.n;
  }
  // the time each realm spends short of each thing (the measures)
  for (let r = 0; r < 3; r++) for (const g of LOOPS_R) if (loopsShort(r, g)) lsBump(LOOPS.stats.shortT[r], g, dt);
}

/* ------------------------------------------------------------------ */
/* the save: the realms' and keeps' stores (one plain shape), carts     */
/* ------------------------------------------------------------------ */
registerSavePart('world', 'loops', {
  save() {
    if (!LOOPS.inited && !LOOPS.seeded) return null;
    return {
      v: 1,
      r: LOOPS.r.map((S) => LOOPS_R.map((g) => Math.round(S[g]))),
      k: WAR.keeps.map((K) => LOOPS_K.map((g) => Math.round(loopsKeep(K)[g]))),
      // a cart in flight is unloaded back into its town's stores on loading (its people are not saved)
      c: LOOPS.caravans.filter((c) => c.state === 'road').map((c) => [c.realm, ...LOOPS_K.map((g) => Math.round(c.load[g] || 0))]).slice(0, 8),
    };
  },
  load(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.r)) return;
    const num = (v, cap) => (Number.isFinite(+v) && v !== null ? clamp(Math.round(+v), 0, cap) : null);
    for (let r = 0; r < 3; r++) {
      const row = Array.isArray(d.r[r]) ? d.r[r] : [];
      LOOPS_R.forEach((g, i) => { const v = num(row[i], LT.target[g] * LT.cap); if (v != null) LOOPS.r[r][g] = v; });
    }
    if (Array.isArray(d.k)) d.k.slice(0, 12).forEach((row, i) => {
      if (!Array.isArray(row)) return;
      const S = LOOPS.k[i] || (LOOPS.k[i] = { food: LT.keepTarget.food, timber: LT.keepTarget.timber, stone: LT.keepTarget.stone, iron: LT.keepTarget.iron });
      LOOPS_K.forEach((g, j) => { const v = num(row[j], LT.keepTarget[g] * LT.keepCap); if (v != null) S[g] = v; });
    });
    if (Array.isArray(d.c)) for (const row of d.c.slice(0, 8)) {
      if (!Array.isArray(row)) continue;
      const r = row[0] | 0;
      if (r < 0 || r > 2) continue;
      LOOPS_K.forEach((g, j) => { const v = num(row[j + 1], 200); if (v) loopsAdd(r, g, v, false); });
    }
    LOOPS.seeded = true;
  },
  // what counts as a change worth writing: the stores in tens
  key: (d) => (d ? [d.r.map((row) => row.map((v) => Math.round(v / 10))), (d.k || []).map((row) => row.map((v) => Math.round(v / 5)))] : null),
});
registerSavePart('char', 'loops', {
  save() { const y = LOOPS.you; return y.n || y.escorts || y.raids ? { u: Math.round(y.units), n: y.n, e: y.escorts, x: y.raids, rp: Math.round(y.rp), g: Math.round(y.gold) } : null; },
  load(d) {
    const o = d && typeof d === 'object' ? d : {}, n = (v, c) => (Number.isFinite(+v) ? clamp(Math.round(+v), 0, c) : 0);
    LOOPS.you = { units: n(o.u, 1e8), n: n(o.n, 1e7), escorts: n(o.e, 1e6), raids: n(o.x, 1e6), rp: n(o.rp, 1e9), gold: n(o.g, 1e9) };
  },
  key: (d) => (d ? [d.n, d.e, d.x] : null),
});

queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.loops = { LOOPS, LT, LOOPS_R, LOOPS_K, LOOPS_WORTH, LOOPS_CART, loopsFill, loopsKeepFill, loopsNeedK, loopsAdd, loopsTake, loopsKeepTake, loopsKeepAdd, loopsShort, loopsKeepShort, loopsMuster, loopsColumn, loopsTrickleOk, loopsLord, loopsEngineKind, loopsHorseOk, loopsWork, loopsHouseWork, loopsHarmMult, loopsHarvest, loopsCatch, loopsProduce, loopsFieldsK, loopsLandK, loopsOnCapture, loopsTradeStep, loopsCarSend, loopsCarStep, loopsCarLost, loopsCarTurn, loopsCaravanStep, loopsDeliver, loopsGiveHorse, loopsOpenStores, loopsCarried, loopsPay, loopsSellOf, loopsHudLine, loopsWarText, loopsTreeFor, loopsRockFor, loopsLife, updateLoops, keep: (i) => loopsKeep(WAR.keeps[i]),
    // for the measures: the player's own jobs
    natureStartJob: (t) => natureStartJob('chop', t), splitJob: (t) => natureStartJob('split', t), nearestTree, natStanding, mineStart, rockNear, natSplitGoods, houses: () => HOUSES, loopsYardIgnite, loopsYardN, LADEN, loopsLadenK, loopsHeavy,
    get RECIPES() { return RECIPES; }, get PRICE_LISTS() { return { prov: PROVISIONS, hall: HALL_STORES, farm: FARM_SHOP }; } };
});

/* ------------------------------------------------------------------ */
/* what players are told: the Stores page, notes, help, tips, the path  */
/* ------------------------------------------------------------------ */
// the next step's place on the map (g2MarkOf, 10f_guide2.js): the quartermaster, or a cart of your realm's on the road
function loopsMarkOf(S, P) {
  const R = REALMS[P.faction], Q = R.quartermaster;
  if (S.id === 'deliver') return Q ? guideTown(P, R, Q.x, Q.z, Q.name) : null;
  if (S.id === 'caravan') {
    let best = null, bd = Infinity;
    for (const c of LOOPS.caravans) { if (c.realm !== P.faction || c.state !== 'road' || c.back) continue; const h = getEnt(c.horse); if (!h) continue; const d = dist2(h.x, h.z, P.x, P.z); if (d < bd) { bd = d; best = { x: h.x, z: h.z, what: `the cart for ${WAR.keeps[c.keep].site.name}` }; } }
    return best || (Q ? guideTown(P, R, Q.x, Q.z, `${Q.name} (carts leave ${R.townName} for the keeps)`) : null);
  }
  return undefined;
}
// the Chronicle's page: each realm's stores, what the war draws, the carts, your part
function chronStores() {
  const P = GAME.player, me = P ? P.faction : 0;
  const row = (r) => {
    const cells = LOOPS_R.map((g) => { const f = loopsFill(r, g), sh = loopsShort(r, g); return `<span class="ls-c${sh ? ' short' : f < 0.5 ? ' low' : ''}" title="${LOOPS_LABEL[g]}: ${fmtInt(LOOPS.r[r][g])} of ${fmtInt(LT.target[g])}">${iconSvg(LOOPS_ICON[g] || 'bag', 14)}<i style="height:${Math.round(clamp(f, 0, 1.5) / 1.5 * 100)}%"></i></span>`; }).join('');
    return `<div class="ls-realm" style="--rc:${REALMS[r].color}"><b>${REALMS[r].name}</b><span class="ls-cells">${cells}</span></div>`;
  };
  const keeps = WAR.keeps.filter((K) => K.realm === me).map((K) => { const S = loopsKeep(K); return `<li><b>${K.site.name}</b>: ${LOOPS_K.map((g) => `${fmtInt(S[g])} ${LOOPS_LABEL[g]}`).join(', ')}</li>`; }).join('');
  const y = LOOPS.you;
  return `<p class="lead">Every band that marches, every engine raised, every gate and wall mended is paid for out of a realm's stores: food, timber, stone, iron, hides, wool and horses. Its townsfolk fill them (the fields, the fishers, the herds, the woodcutters and the quarry) and so do you; the war empties them. A realm short of something fights the worse for it, and says so.</p>
    <div class="ls-table now">${[0, 1, 2].map(row).join('')}<p class="fineprint">${LOOPS_R.map((g) => LOOPS_LABEL[g]).join(', ')}: each bar is the store against what the realm aims to keep. Red is short.</p></div>
    <h3>What the war draws</h3>
    <ul class="plain"><li><b>A band at the muster</b>: food for each soldier, and iron, hides and wool to arm it. Short of food the band musters thin and hungry (its blows land softer); short of iron it marches ill-armed.</li><li><b>An engine</b>: timber and iron, a trebuchet most (and stone for its weight), a ram least. A realm without the timber builds a lesser engine, or none.</li><li><b>A captain's horse</b> from the stables: none, and the captain marches on foot.</li><li><b>A keep</b>: its garrison eats from the keep's own stores; a new guard or lord is fed and armed from them, a column out of it too. Its broken gate wants timber and iron, a breach stone and timber, a burnt palisade, walk or tower timber: without them the work drags.</li><li><b>A house</b> built back in town: timber and stone.</li></ul>
    <p>The keeps guard the roads to a realm's borderland farms and woods: each of its own keeps in other hands costs its town a fifth of its work, and each enemy keep it holds brings in tribute from the lands round it.</p>
    <h3>Carts on the roads</h3>
    <p>The keeps are supplied by carts from the town: a cart, its horse, a carter and two soldiers walk the roads by the pass and the muster to the keep's gate. Bands of the other realms fall on them; a cart taken is lost to its realm, and half of what it carried goes to the realm that took it. Walk beside a cart of yours most of the way and see it safe, and the realm pays you for it. A keep taken is taken with its stores.</p>
    <h3>Your part</h3>
    <p>Bring what you fell, quarry, mine, grow, breed, catch and hunt to the quartermaster in ${REALMS[me].townName} (by the square) or to the stores of a keep's great hall: logs, planks and firewood count as timber, stone and flint as stone, ore and bars as iron, grain, bread, meat, fish, roots, cheese and milk as food, hides and leather, wool and cloth. The realm pays in realm points and gold, more for what it lacks and more the higher your level, and the campaign remembers it in renown. A grown horse of your own bred or tamed can go to the stables. ${y.n ? `You have given ${fmtInt(y.units)} in ${fmtInt(y.n)} deliveries (${fmtInt(y.rp)} realm points, ${fmtInt(y.gold)} gold)${y.escorts ? `, and seen ${y.escorts} cart${y.escorts === 1 ? '' : 's'} safe` : ''}.` : ''}</p>
    <h3>In the peace</h3><p>Between campaigns the realms trade at the border fairs: what one has over its needs goes to the realms that lack it.</p>
    ${keeps ? `<div class="now"><p><b>Your keeps' stores</b></p><ul class="plain">${keeps}</ul></div>` : ''}`;
}
// [loops] no shop sells what a recipe makes for less than the cheapest making of it costs (its inputs at the merchant's
// price): a good's worth is raised to it, and the halls', the farmers' and the herders' lists with it. Version 18 sold an
// axe, a pick, a hammer, a hoe and shears for less than their iron at the forge, and the halls' stores iron at 11 a bar
// where two lumps of ore and a bundle of firewood cost 27.5.
function loopsFairPrices() {
  const buy = (id) => Math.max(1, Math.round((GOODS[id] ? GOODS[id].value : 1) * 2.5));
  const cheapest = (id) => { let best = Infinity; for (const r of RECIPES) if (r.make && r.make[0] === id) best = Math.min(best, r.need.reduce((a, [q, n]) => a + buy(q) * n, 0) / r.make[1]); return best; };
  const raised = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const id of PROVISIONS) {
      const G = GOODS[id], c = cheapest(id);
      if (!G || !Number.isFinite(c) || buy(id) >= c - 0.01) continue;
      G.value = Math.ceil((c / 2.5) * 10) / 10;
      while (buy(id) < c - 0.01) G.value += 0.1;
      G.value = Math.round(G.value * 10) / 10;
      raised.push(id);
    }
  }
  for (const L of [HALL_STORES, FARM_SHOP]) for (const row of L) {
    const [id, n] = row, c = cheapest(id);
    if (Number.isFinite(c) && row[2] / n < c - 0.01) { row[2] = Math.ceil(c * n); raised.push(id); }
  }
  LOOPS.raised = [...new Set(raised)];
}
queueMicrotask(() => { // (CHRON, FIELD_NOTES, GUIDE_WATCH, GUIDE_HELP, LOADING_TIPS and PATH_STEPS are declared by later modules)
  loopsFairPrices();
  chronAdd('stores', 'Stores', 'war', chronStores, 'orders');
  Object.assign(FIELD_NOTES, {
    lstores: { t: 'The realm\'s stores', x: (R) => `Every band, engine, gate and wall of ${R.name}'s is paid for from its stores. Bring wood, stone, ore, food, hides and wool to the quartermaster in ${R.townName} or a keep's hall: the realm pays in realm points and gold, more for what it lacks. The Chronicle's Stores page shows them.` },
    lcart: { t: 'A cart on the road', x: () => 'Carts carry food, timber, stone and iron from the town to the keeps. The other realms fall on them. Walk beside one of yours to its keep and see it safe; one of theirs taken is lost to them.', fight: false },
    lshort: { t: 'Your realm runs short', x: (R) => `${R.name}'s stores are running out: its bands muster thinner and hungrier, its engines fewer, its walls mend slower. What you bring to the quartermaster turns it round, and pays more now.` },
  });
  GUIDE_WATCH.lstores = (P) => { const Q = REALMS[P.faction].quartermaster; return !!Q && dist2(P.x, P.z, Q.x, Q.z) < 14 * 14; };
  GUIDE_WATCH.lcart = (P) => LOOPS.caravans.some((c) => c.state === 'road' && c.realm === P.faction && (() => { const h = getEnt(c.horse); return h && dist2(h.x, h.z, P.x, P.z) < 40 * 40; })());
  GUIDE_WATCH.lshort = (P) => LOOPS.on && GAME.prog.level >= 8 && ['food', 'timber', 'stone', 'iron'].some((g) => loopsShort(P.faction, g));
  GUIDE_HELP.push(() => `<h3>The realm's stores</h3><p>The war runs on what the land gives: food, timber, stone, iron, hides, wool and horses. Bring what you fell, quarry, grow, breed, catch and hunt to the quartermaster in your town or to a keep hall's stores (${IS_TOUCH ? 'Use' : 'E'} beside them): the realm pays in realm points and gold, more for what it lacks. Carts carry the goods to the keeps: escort yours, fall on theirs. The war panel says when a realm is short, and the Chronicle's Stores page shows every store.</p>`);
  LOADING_TIPS.push('Every band, engine and mended gate is paid for from a realm\'s stores: the quartermaster in your town pays more for what it lacks.', 'Carts carry food, timber and stone from the towns to the keeps. Take an enemy\'s cart and its keep goes hungry; see your own safe and the realm pays you.', 'A keep taken is taken with its stores, and a garrison that has eaten them fights hungry until a cart comes.');
  // the path: a delivery to the realm's stores, a cart seen safe (pv 3)
  const steps = [
    { id: 'deliver', lv: 6, old: 12, pv: 3, title: 'Supply the realm', short: 'Supply the realm',
      hint: (R) => `Fell a tree, break stone from a rock, or bring in a harvest, a catch or a hunt, and give it to ${R.quartermaster ? R.quartermaster.name : 'the quartermaster'} in ${R.townName} (${LK().use} beside them). The realm pays more for what it lacks.`,
      reward: { gold: (L) => 30 + L * 4 } },
    { id: 'caravan', lv: 16, old: 25, pv: 3, title: 'See a cart safe to a keep', short: 'Escort a cart',
      hint: (R) => `Carts leave ${R.townName} for ${R.name}'s keeps along the roads by the pass and the muster. Walk beside one most of the way and see it unload at the keep's gate; keep the other realms' bands off it.`,
      reward: { item: { slot: 'hands', q: 3 } } },
  ];
  for (const S of steps) {
    if (PATH_BY_ID[S.id]) continue;
    const i = PATH_STEPS.findIndex((q) => q.lv > S.lv);
    PATH_STEPS.splice(i < 0 ? PATH_STEPS.length : i, 0, S);
    PATH_BY_ID[S.id] = S;
  }
  PATH_STEPS.forEach((S, i) => { S.idx = i; });
});
