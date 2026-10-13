/* ================================================================== */
/* [war3] campaigns won in the field (version 17)                      */
/* ================================================================== */
// Why keeps changed hands 36 to 44 times an hour on version 15's builds (33 at medium on version 16) and no realm held
// four for more than two minutes: a keep taken was left with its new lord alone and a gate set back on its hinges at half
// its strength the moment it fell (captureKeep); the band that took it held its court 35 s and marched off to the next
// keep; a guard came every 14 s while nobody was near; and the realm it was taken from marched straight back (`retake`,
// +20). (campaign_soak.py's capture log, added with this work: a keep falls with a median of one guard left.)
// Now a keep taken means something, as the March would have it:
//   the band that took it holds its court until the keep is garrisoned and its gate stands (at most W3.HOLD_MAX s), and
//   leaves up to three of its soldiers as the court's guards at once; a column of the rest marches from the realm's
//   muster along the roads, fights what it meets, and takes the posts (the wall archers up by the castle's ways); a gate
//   broken when the keep fell stays broken until the new owners mend it (two of the court's guards at work in the
//   gateway with mallets while the keep is quiet; the war's own rule hangs it again after 40 s of quiet);
//   a realm that has just taken a keep holds it before it reaches further (its other attacks weigh less while a keep of
//   its is newly taken and not yet whole, and it sends a band to secure one that is threatened);
//   a realm one keep from a claim presses for it: it names one keep, turns a marching band to it and sends every free
//   band there; the keep's owners see the blow coming and send a band to hold it (both cried in the war's news);
//   a realm that leads (a claim on the March, or three keeps with a claim not yet faded) finds the two behind it in
//   common cause: neither marches on the other's keeps or temple while the pact holds, and both press the leader;
//   a realm down to its last keep calls every band to win back one of its own (all on one keep);
//   the peace: the crews break up their engines, the walls' breaches are mended behind their scaffolds, and the keeps
//   are handed back to their own realms half a minute before the new campaign, their garrisons marching in.
// Shared files only call in (each marked [war3]): 08_ai.js (captureKeep, updateWarband's garrison order and hold,
// thinkPosted's gate work, updateWar), 08g_campaign.js (cwChoose, orders' words, the war panel, map, herald, Chronicle,
// cwTrack, resetMarch), 08j_war2.js (bandRemnant, cwBandsCounted).
const W3 = {
  on: true, // (tests: off restores version 16's ways)
  HOLD_MAX: 150, // s: the band that took a keep holds its court at most this long
  GIVE: 3, // soldiers the band leaves as the court's guards at once (it keeps three of its own at least)
  FRESH: 240, // s: a keep taken this recently and not yet whole is held before the realm reaches further
  PRESS_RE: 90, // s: a realm one keep from a claim looks again at which keep to press for
  PACT_END: 45, // s: a pact outlasts the leader's lead by this long
  COL_IN: 50, // s: a column's stragglers take their posts this long after its captain is in
  CLAIM3: 0.4, // the pace of a claim built on three keeps held, more than any other realm (of four's)
  LEVY: 1, // bands more a realm with three keeps or more musters
  stats: { captures: 0, holds: 0, given: 0, columns: 0, columnsIn: 0, columnsLost: 0, garrisoned: 0, gateWork: 0, presses: 0, braces: 0, secures: 0, pacts: 0, rallies: 0, peaceEngines: 0, peaceMended: 0, handedBack: 0 },
  pact: null, // { against, members: [a, b], t, lostAt }
  press: [null, null, null], // per realm, while it holds three keeps: { keep, t }
  rally: [null, null, null], // per realm, while it holds one keep or none: { keep, t }
  peace: null, // { t0, eng: [], back: false }
  look: 0,
  log: [], // the keeps' changes of hands (tests: campaign_soak.py)
};
const W3_SLOTS = ['c0', 'c1', 'c2', 'w0', 'w1', 'w2'];
const w3KeepsOf = (r) => { let n = 0; for (const K of WAR.keeps) if (K.realm === r) n++; return n; };
// the keep's living garrison (the lord not counted)
function w3GuardsN(K) { let n = 0; for (const id of K.guards) { const g = getEnt(id); if (g && g.alive) n++; } return n; }
function w3SlotSpec(K, slot) {
  const i = +slot[1], wall = slot[0] === 'w';
  const pos = wall ? K.slots.walls[i] : K.slots.court[i];
  return pos ? { pos, cls: wall ? 'archer' : i === 2 ? 'priest' : 'warrior', post: i, wall: pos[1] > 0.5 } : null;
}
// the posts no living guard holds (nor a column's soldier on its way to)
function w3FreeSlots(K, skipCol = false) {
  const have = new Set();
  for (const id of K.guards) { const g = getEnt(id); if (g && g.alive && g.ai) have.add(g.ai.slot); }
  if (!skipCol && K.w3 && K.w3.col != null) { const wb = WAR.warbands.find((w) => w.id === K.w3.col && !w.dead); if (wb) for (const e of wbMembers(wb)) if (e.w3slot) have.add(e.w3slot); }
  return W3_SLOTS.filter((s) => !have.has(s) && w3SlotSpec(K, s));
}
// is this keep newly taken by r and not yet whole (its garrison short or its gate down)?
const w3Fresh = (K, r) => !!K.w3 && K.realm === r && K.w3.by === r && GAME.t - K.w3.t < W3.FRESH && (w3GuardsN(K) < 5 || !K.door.alive);
// foes coming for a keep: bands with orders on it, and foes within 40 m of it
function w3Threat(K) {
  let n = 0;
  for (const wb of WAR.warbands) if (!wb.dead && wb.realm !== K.realm && wb.order && wb.order.keep === K && wb.order.type === 'attack') n++;
  forNear(K.site.x, K.site.z, 40, (o) => { if (o.alive && isActor(o) && o.faction <= 2 && o.faction !== K.realm) n += 0.2; });
  return n;
}

/* ------------------------------------------------------------------ */
/* a keep taken: held, garrisoned, its gate mended                     */
/* ------------------------------------------------------------------ */
// a soldier (a band's, or a column's) takes a post of the keep's garrison: a guard of it from now on
function war3MakeGuard(e, K, slot, wb) {
  const sp = w3SlotSpec(K, slot);
  if (!sp || !e.alive) return false;
  if (wb) { const i = wb.members.indexOf(e.id); if (i >= 0) wb.members.splice(i, 1); }
  if (e.mount) dismount(e);
  e.warband = null; e.target = null; e.casting = null; e.siegeCrew = null; e.hallowRun = null; e.w3slot = null;
  if (e.ai) { e.ai.storm = null; e.ai.down = null; e.ai.chase = null; e.ai.trailAbs = undefined; e.ai.fire = null; e.ai.fireBack = null; }
  e.role = 'guard';
  e.level = warUnitLevel('guard'); e.wlOff = e.level - warLevel();
  const S = K.site, p = siteWorld(S, sp.pos[0], sp.pos[1], sp.pos[2]);
  if (sp.wall) {
    e.tweak = { ...(e.tweak || {}), rangedRange: 36, dmg: 0.55, swing: 3.0 }; e.ai.wall = true;
    const route = castleRoute(K, sp.post);
    if (route) { e.ai.route = route; e.ai.ri = 0; }
  }
  setupStats(e, true);
  e.ai.post = { x: p.x, z: p.z, y: p.y, leash: sp.wall ? 0 : 11 };
  e.ai.slot = slot;
  e.keep = K;
  K.guards.add(e.id);
  W3.stats.garrisoned++;
  return true;
}
// from captureKeep, once the keep is the taker's (its lord spawned by fillGarrison); gateDown: the gate lay broken
function war3OnCapture(K, realm, old, gateDown) {
  const now = GAME.t;
  W3.stats.captures++;
  W3.log.push({ t: Math.round(now), k: K.id, from: old, to: realm, gate: gateDown ? 0 : 1, el: Math.round(campaignElapsed()) });
  if (W3.log.length > 240) W3.log.shift();
  K.w3 = { t: now, by: realm, from: old, col: null, holder: null };
  if (!W3.on || CAMPAIGN.state !== 'war') return;
  const Cm = WAR.commanders[realm];
  if (Cm) Cm.nextSpawn = Math.min(Cm.nextSpawn, now + 10); // momentum: men flock to a banner that wins
  // the band that took it: the nearest of the taker's bands sent against it
  let hb = null, hd = 80 * 80;
  for (const wb of WAR.warbands) {
    if (wb.dead || wb.realm !== realm || !wb.order || wb.order.type !== 'attack' || wb.order.keep !== K) continue;
    const L = wbLeader(wb);
    if (!L) continue;
    const d = dist2(L.x, L.z, K.site.x, K.site.z);
    if (d < hd) { hd = d; hb = wb; }
  }
  let given = 0;
  if (hb) {
    K.w3.holder = hb.id;
    W3.stats.holds++;
    // up to three of its soldiers inside the walls stay as the court's guards; the band keeps three of its own at least
    const L = wbLeader(hb), C = castleOf(K.site), all = wbMembers(hb);
    const inside = all.filter((e) => e !== L && e.carrying == null && !e.siegeCrew && !e.motion && C && castleInside(C, e.x, e.z) && Math.abs(e.y - K.site.y) < 1.4);
    const free = w3FreeSlots(K).filter((s) => s[0] === 'c');
    const n = Math.max(0, Math.min(W3.GIVE, all.length - 3, free.length, inside.length));
    for (let i = 0; i < n; i++) if (war3MakeGuard(inside[i], K, free[i], hb)) given++;
    W3.stats.given += given;
  }
  // the rest come from the muster
  const miss = w3FreeSlots(K);
  if (miss.length) war3Column(K, realm, miss);
  const R = REALMS[realm];
  const what = [hb && given ? `${wbName(hb)} leaves ${['', 'one', 'two', 'three'][given] || given} of its soldiers to hold the court` : hb ? `${wbName(hb)} holds its court` : '', miss.length ? `a column marches from the ${R.musterSite.name} to garrison it` : ''].filter(Boolean);
  if (what.length) news(`${K.site.name} is ${possessive(R.name)}: ${what.join(', and ')}${gateDown ? '; its broken gate must be mended' : ''}.`, realm, 'normal');
}
// a column of soldiers for the posts still empty, marching from the muster (a band whose order is the keep's garrison)
function war3Column(K, realm, slots) {
  const R = REALMS[realm], M = R.musterSite;
  const wb = { id: WAR.nextWb++, realm, members: [], order: null, path: null, pathIdx: 0, created: GAME.t, engagedUntil: -99, lastProgress: GAME.t, progX: M.x, progZ: M.z, w3col: { keep: K.id } };
  slots.forEach((s, i) => {
    const sp = w3SlotSpec(K, s);
    // in a file along the muster's road: the captain first, the archers last
    const a = R.bearing + Math.PI + (i - slots.length / 2) * 0.12, r = 4 + i * 1.6;
    const e = spawnRealmUnit(realm, sp.cls, warUnitLevel('guard'), 'soldier', M.x + Math.sin(a) * r, M.z + Math.cos(a) * r);
    e.warband = wb; e.w3slot = s;
    wb.members.push(e.id);
  });
  WAR.warbands.push(wb);
  K.w3.col = wb.id;
  W3.stats.columns++;
  wbSetOrder(wb, { type: 'garrison', keep: K, why: 'garrison' });
  return wb;
}
// a column's way (from updateWarband): to the keep's court, then each soldier to its post. Returns its goal, or null
// when the order is over (the keep lost on the way, or every soldier at a post): updateWarband then stops for this step
function war3ColumnGoal(wb, O, L, members) {
  const K = O.keep, now = GAME.t;
  if (K.realm !== wb.realm || CAMPAIGN.state !== 'war') {
    // the keep lost on the way, or the war over: a band like any other from here (the commander gives it an order)
    if (K.w3 && K.w3.col === wb.id) K.w3.col = null;
    wb.w3col = null; wb.order = null;
    for (const e of members) e.w3slot = null;
    W3.stats.columnsLost++;
    return null;
  }
  K.nextGuardAt = Math.max(K.nextGuardAt, now + 6); // no guard trickles in while the column brings them
  const C = castleOf(K.site), court = K.nav.court;
  const inCourt = (e) => (C ? castleInside(C, e.x, e.z) && Math.abs(e.y - K.site.y) < 1.5 : dist2(e.x, e.z, court.x, court.z) < 64);
  if (O.w3in === undefined && (inCourt(L) || dist2(L.x, L.z, court.x, court.z) < 36)) O.w3in = now;
  if (O.w3in !== undefined) {
    const late = now - O.w3in > W3.COL_IN;
    for (const e of members) {
      if (e === L && members.length > 1 && !late) continue; // (the captain last: the rest follow it in)
      if (!inCourt(e) && !late) continue;
      const free = w3FreeSlots(K, true);
      const s = e.w3slot && free.includes(e.w3slot) ? e.w3slot : free[0];
      if (s) war3MakeGuard(e, K, s, wb);
    }
    if (!wbMembers(wb).length) {
      wb.dead = true; wb.order = null; wb.w3col = null;
      if (K.w3 && K.w3.col === wb.id) K.w3.col = null;
      W3.stats.columnsIn++;
      news(`The column from the ${REALMS[wb.realm].musterSite.name} has taken its posts in ${K.site.name}.`, wb.realm, 'normal');
      return null;
    }
    if (late) { // posts all taken by others: the rest are a band like any other
      wb.w3col = null; wb.order = null;
      if (K.w3 && K.w3.col === wb.id) K.w3.col = null;
      return null;
    }
  }
  return court;
}
// a column's name in the news and on the map: "Ériu's column for Kestrel Hold"
function war3ColName(wb, withRealm) {
  const K = WAR.keeps[wb.w3col.keep];
  return `${withRealm ? possessive(REALMS[wb.realm].name) + ' ' : ''}column for ${K ? K.site.name : 'its keep'}`;
}
// a column given another order (the player's, the watchdog's) is a band like any other: its posts are free again
function w3ColumnSanity() {
  for (const K of WAR.keeps) {
    if (!K.w3 || K.w3.col == null) continue;
    const wb = WAR.warbands.find((w) => w.id === K.w3.col);
    if (wb && !wb.dead && wb.order && wb.order.type === 'garrison' && wb.order.keep === K) continue;
    K.w3.col = null;
    if (wb) { wb.w3col = null; for (const e of wbMembers(wb)) e.w3slot = null; }
  }
  for (const wb of WAR.warbands) if (wb.w3col && !wb.dead && (!wb.order || wb.order.type !== 'garrison')) { wb.w3col = null; for (const e of wbMembers(wb)) e.w3slot = null; }
}
// the band that took a keep holds its court while the keep is newly taken and not yet whole (from updateWarband's hold)
function war3HoldOn(wb, O, K) {
  return W3.on && CAMPAIGN.state === 'war' && !!K.w3 && K.w3.holder === wb.id && GAME.t - K.w3.t < W3.HOLD_MAX && (!K.door.alive || w3GuardsN(K) < 5);
}
// two of the court's guards mend a broken gate while the keep is quiet: at the posts of its leaves, mallets in hand
// (body action 23, the masons' blow). From thinkPosted; true while it works there or walks to the work
function war3GateWork(e, dt) {
  const K = e.keep, ai = e.ai;
  if (!W3.on || !K || !ai || K.door.alive || e.fixedY !== null || ai.wall || (ai.slot !== 'c0' && ai.slot !== 'c1') || GAME.t - K.lastEnemyNear < 6 || getEnt(e.target)) { if (ai && ai.w3g) ai.w3g = null; return false; }
  const C = castleOf(K.site);
  if (!C || !C.gate || K.realm !== e.faction) return false;
  const G0 = C.gate, S = K.site, side = ai.slot === 'c0' ? -1 : 1;
  let g = ai.w3g;
  if (!g) {
    // stand inside the leaves' line, a mallet's reach from the post they hang on (found as the masons find their wall)
    const y = floorAt(siteToWorld(S, 0, G0.gz - 0.8).x, siteToWorld(S, 0, G0.gz - 0.8).z, S.y + 0.5);
    const a = siteToWorld(S, 0, G0.gz - 0.8), b = siteToWorld(S, side * (G0.hw + 2.5), G0.gz - 0.8);
    const R = shotHit(a.x, y + 1.2, a.z, b.x, y + 1.2, b.z, { ground: false });
    const lx = R ? side * Math.max(0.2, R.t * (G0.hw + 2.5) - HAMMER_REACH) : side * Math.max(0.2, G0.hw - HAMMER_REACH);
    g = ai.w3g = { p: siteToWorld(S, lx, G0.gz - 0.8), face: b, next: GAME.t + 0.6, t: GAME.t };
  }
  if (dist2(e.x, e.z, g.p.x, g.p.z) > 0.45 * 0.45) {
    if (GAME.t - g.t > 30) return false; // (no way there: back to its post)
    moveToward(e, g.p.x, g.p.z, dt, 0.8, 0.25);
    return true;
  }
  turnToward(e, g.face.x, g.face.z, dt * 4);
  e._hamUntil = GAME.t + 0.4; // a mallet in the hand (13_main.js)
  if (GAME.t >= g.next) {
    g.next = GAME.t + 1.1 + Math.random() * 0.5;
    setAct(e, 23, 1.05);
    W3.stats.gateWork++;
    later(0.68, () => { if (e.alive && !e.removed) sfxAtE('mallet', e, null, 1.3); });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* the commanders: hold, press, common cause, win it back              */
/* ------------------------------------------------------------------ */
// does realm r lead the March? (a claim on it running: four keeps, or both enemy hallows; or three keeps held alone with
// its claim past three fifths. At three keeps with a quarter of a claim the pact came too soon: the realms behind
// stopped every lead before it was one, ten pacts an hour, and the war went to the elders)
function w3Leads(r) {
  const n = w3KeepsOf(r);
  return n >= CW.KEEPS || foreignHallows(r) >= 2 || (war3ClaimSlow(r, n) > 0 && CAMPAIGN.claims[r].k / CW.KEEP_HOLD > 0.6);
}
// [war3] momentum: a realm with three keeps, more than any other realm, builds its claim on the keeps at W3.CLAIM3 of the
// pace of four (it fades no more while it holds three at all): returns the share of the pace, -1 to hold it, 0 to fade
function war3ClaimSlow(r, n) {
  if (!W3.on || n !== CW.KEEPS - 1) return 0;
  for (let q = 0; q < 3; q++) if (q !== r && w3KeepsOf(q) >= n) return -1;
  return W3.CLAIM3;
}
// and musters one band more: the March's levies follow the winning banners (from planWar's muster)
const war3Levy = (r) => (W3.on && w3KeepsOf(r) >= CW.KEEPS - 1 ? W3.LEVY : 0);
// the pact against the leader, from war3Update
function w3PactStep() {
  const now = GAME.t, P = W3.pact;
  const leaders = [0, 1, 2].filter(w3Leads);
  const lead = leaders.length === 1 ? leaders[0] : -1;
  if (P) {
    if (P.against === lead) { P.lostAt = null; return; }
    if (P.lostAt == null) P.lostAt = now;
    if (now - P.lostAt < W3.PACT_END && lead < 0) return;
    news(`The pact against ${REALMS[P.against].name} is ended: ${REALMS[P.members[0]].name} and ${REALMS[P.members[1]].name} are rivals again.`, -1, 'normal');
    W3.pact = null;
  }
  if (lead < 0 || W3.pact) return;
  const m = [0, 1, 2].filter((q) => q !== lead);
  W3.pact = { against: lead, members: m, t: now, lostAt: null };
  W3.stats.pacts++;
  news(`${REALMS[m[0]].name} and ${REALMS[m[1]].name} make common cause against ${REALMS[lead].name}: neither will march on the other while ${REALMS[lead].name} leads the March.`, -1, 'big');
}
// the keep a realm should go for: its own first, then the weakest and nearest of the rest
function w3BestTarget(r, ownFirst) {
  const home = REALMS[r].musterSite;
  let best = null, bs = -1e9;
  for (const K of WAR.keeps) {
    if (K.realm === r) continue;
    if (W3.pact && W3.pact.members.includes(r) && W3.pact.members.includes(K.realm)) continue; // (the ally's)
    let s = 50 - liveGuards(K) * 2 - (K.door.alive ? (K.door.hp / K.door.maxHp) * 12 : 0) + siegeDanger(K) * 8;
    if (K.orig === r) s += ownFirst ? 40 : 10;
    if (W3.pact && W3.pact.against === K.realm) s += 12;
    let d = dist(home.x, home.z, K.site.x, K.site.z);
    for (const Q of WAR.keeps) if (Q.realm === r) d = Math.min(d, dist(Q.site.x, Q.site.z, K.site.x, K.site.z));
    s -= d / 12;
    if (s > bs) { bs = s; best = K; }
  }
  return best;
}
// a realm one keep from a claim presses for it; a realm down to one keep calls every band to win one back
function w3AimStep() {
  const now = GAME.t;
  for (let r = 0; r < 3; r++) {
    const n = w3KeepsOf(r), R = REALMS[r];
    const mine = WAR.warbands.filter((w) => !w.dead && w.realm === r);
    // pressing for the fourth keep
    let P = W3.press[r];
    if (n === CW.KEEPS - 1) {
      if (!P || WAR.keeps[P.keep].realm === r || now - P.t > W3.PRESS_RE) {
        const K = w3BestTarget(r, false);
        if (K && (!P || P.keep !== K.id)) {
          W3.press[r] = P = { keep: K.id, t: now };
          W3.stats.presses++;
          news(`${R.name} holds three keeps and presses for a fourth: its warbands march on ${K.site.name}.${war3ClaimSlow(r, n) > 0 ? ` While it holds more keeps than any other realm its claim on the March grows.` : ''}`, r, 'big');
          news(`${REALMS[K.realm].name} sees the blow coming and makes ready to hold ${K.site.name}.`, K.realm, 'normal');
          retask(mine, K.site.x, K.site.z, { type: 'attack', keep: K, why: 'claim' });
        } else if (P) P.t = now;
      }
    } else if (P) W3.press[r] = null;
    // down to its last keep: every band to win one of its own back
    let Q = W3.rally[r];
    if (n <= 1) {
      if (!Q || WAR.keeps[Q.keep].realm === r || now - Q.t > W3.PRESS_RE * 1.5) {
        const K = w3BestTarget(r, true);
        if (K && (!Q || Q.keep !== K.id)) {
          W3.rally[r] = Q = { keep: K.id, t: now };
          W3.stats.rallies++;
          news(`${R.name} is down to ${n ? 'its last keep' : 'no keep at all'} and calls every sword to win ${K.site.name} ${K.orig === r ? 'back' : 'for it'}.`, r, 'normal');
          retask(mine, K.site.x, K.site.z, { type: 'attack', keep: K, why: 'regain' });
        } else if (Q) Q.t = now;
      }
    } else if (Q) W3.rally[r] = null;
  }
}
// the commander's choice, weighed (from cwChoose, before its sort): C is its list of { s, o, why }
function war3Choose(wb, r, C, L) {
  if (!W3.on || CAMPAIGN.state !== 'war' || !L) return;
  const now = GAME.t, pact = W3.pact;
  const inPact = !!pact && pact.members.includes(r);
  const ally = inPact ? pact.members.find((q) => q !== r) : -1, foe = inPact ? pact.against : -1;
  const press = W3.press[r], rally = W3.rally[r];
  const fresh = WAR.keeps.filter((K) => w3Fresh(K, r));
  for (const c of C) {
    const o = c.o;
    if (o.type === 'attack') {
      const K = o.keep;
      if (K.realm === ally) c.s -= 45; // the pact: not the ally's keeps
      else if (K.realm === foe) { c.s += 14; if (c.why === 'gate' || c.why === 'breach' || c.why === 'wall') c.why = 'pact'; }
      if (press && press.keep === K.id) { c.s += 26; c.why = 'claim'; }
      else if (press) c.s -= 10; // all on the one keep
      if (rally && rally.keep === K.id) { c.s += 22; c.why = 'regain'; }
      else if (rally && K.orig !== r) c.s -= 8;
      if (fresh.length && !press && !rally && c.why !== 'claim') c.s -= 12; // hold what it took before it reaches further
    } else if (o.type === 'raid') {
      if (o.temple.realm === ally) c.s -= 45;
      if (press && c.why !== 'reclaim') c.s -= 12; // (pressing: the keep first, a hallow of its own excepted)
    }
  }
  const busy = (K, f) => WAR.warbands.some((w) => !w.dead && w.realm === r && w.order && w.order.keep === K && f(w.order));
  // a newly taken keep with foes coming: secure it
  for (const K of fresh) {
    if (busy(K, (O) => O.type === 'defend' || O.phase === 'hold' || O.type === 'garrison')) continue;
    const th = w3Threat(K);
    if (th < 1) continue;
    C.push({ s: 64 + Math.min(3, th) * 4 - dist(L.x, L.z, K.site.x, K.site.z) / 14, o: { type: 'defend', keep: K, since: now + 60 }, why: 'secure' });
  }
  // a foe presses for a keep of ours: hold it against the blow
  for (let q = 0; q < 3; q++) {
    const P = W3.press[q];
    if (q === r || !P) continue;
    const K = WAR.keeps[P.keep];
    if (!K || K.realm !== r || busy(K, (O) => O.type === 'defend')) continue;
    C.push({ s: 92 - dist(L.x, L.z, K.site.x, K.site.z) / 16, o: { type: 'defend', keep: K, since: now + 90, foe: q }, why: 'brace' }); // (the keep that would give the foe its claim: one band, before anything else)
  }
}
// the commanders' orders that need words of their own
function war3OrderPhrase(wb, O) {
  const R = REALMS[wb.realm];
  if (O.type === 'garrison') return `marches from the ${R.musterSite.name} to garrison ${O.keep.site.name}`;
  if (O.type === 'defend' && O.why === 'brace') return `marches to hold ${O.keep.site.name} against ${possessive(REALMS[O.foe] ? REALMS[O.foe].name : 'the enemy')} push`;
  if (O.type === 'defend' && O.why === 'secure') return `marches to secure ${O.keep.site.name}, newly taken`;
  return null;
}

/* ------------------------------------------------------------------ */
/* the peace: the field cleared, the walls mended, the keeps given back */
/* ------------------------------------------------------------------ */
function w3PeaceStep(dt) {
  const now = GAME.t;
  let Pz = W3.peace;
  if (!Pz) {
    Pz = W3.peace = { t0: now, eng: SIEGE.engines.filter((E) => !E.gone).map((E) => E.id), back: false };
    news('The truce holds: the crews break up their engines, the masons mend the walls, and the keeps go back to their own realms before the next campaign.', -1, 'normal');
    W3.pact = null; W3.press = [null, null, null]; W3.rally = [null, null, null];
  }
  // one engine every second and a half, broken up where it stands (its crew go home with their band)
  if (Pz.eng.length && now - Pz.t0 > 3) {
    if (!(Pz.engT > now)) {
      Pz.engT = now + 1.5;
      const E = siegeById(Pz.eng.shift());
      if (E && !E.gone) { siegeReleaseCrew(E); siegeDismantle(E); W3.stats.peaceEngines++; }
    }
  }
  // the breaches mended behind their scaffolds, in time for the new campaign
  const left = Math.max(4, CAMPAIGN.peaceUntil - now - 6);
  for (const C of CASTLES) {
    if (!C.sections) continue;
    let dirty = false;
    for (const W of C.sections) {
      if (W.state === 'whole') continue;
      if (W.state === 'breach') {
        W.state = 'repair'; W.t = 0; W.scaffold.visible = true;
        for (const f of W.rubbleFloors) f.active = false;
        if (W.coll) { W.coll.fullH = W.coll.fullH || W.coll.h; W.coll.active = true; W.coll.h = 0.3; }
      }
      if (W.state === 'repair') {
        W.t = Math.min(1, W.t + dt * Math.max(1 / BREACH_REPAIR, (1 - W.t) / left));
        if (W.t > 0.12) W.wreck.visible = false;
        if (W.coll) W.coll.h = Math.max(0.3, (W.coll.fullH || 7) * W.t);
        W.fresh = Math.min(1, W.t * 3);
        if (W.t >= 1) { castleRepairDone(W); W3.stats.peaceMended++; }
      }
      dirty = true;
    }
    if (dirty) castleCutUpload(C);
  }
  // half a minute before the new campaign the keeps go back to their own realms: their garrisons march in
  if (!Pz.back && CAMPAIGN.peaceUntil - now < 30) {
    Pz.back = true;
    for (const K of WAR.keeps) if (K.realm !== K.orig) { restoreKeep(K); W3.stats.handedBack++; }
  }
}
// from resetMarch: whatever the peace left undone is done
function war3Reset() {
  for (const E of SIEGE.engines) if (!E.gone) { siegeReleaseCrew(E); siegeRemove(E); }
  for (const C of CASTLES) {
    if (!C.sections) continue;
    let dirty = false;
    for (const W of C.sections) if (W.state !== 'whole') { if (W.wreck) W.wreck.visible = false; castleRepairDone(W); dirty = true; }
    if (dirty) castleCutUpload(C);
  }
  for (const K of WAR.keeps) K.w3 = null;
  for (const wb of WAR.warbands) if (wb.w3col) { wb.w3col = null; if (wb.order && wb.order.type === 'garrison') wb.order = null; }
  W3.peace = null; W3.pact = null; W3.press = [null, null, null]; W3.rally = [null, null, null];
}

/* ------------------------------------------------------------------ */
/* the war's last stalls, and its thinking at its worst                 */
/* ------------------------------------------------------------------ */
// a band held in place by foes none of it fights (a foe behind a wall the sight test missed, one on a ledge nobody
// climbs: up to 76 s in an hour of version 15, campaign_soak.py's `eng=1 fighting=0`): after 20 s held with no member
// in a fight (striking or struck), the band goes on for 20 s (from updateWarband, before it reads its engagement)
function war3EngageGuard(wb, members) {
  const now = GAME.t;
  if (!W3.on) return;
  if (now < (wb.w3free || 0)) { wb.engagedUntil = -99; return; }
  if (now >= wb.engagedUntil) { wb.w3held = null; return; }
  for (const e of members) if (now < e.combatUntil) { wb.w3held = null; return; }
  if (wb.w3held == null) wb.w3held = now;
  if (now - wb.w3held > 20) { wb.w3free = now + 20; wb.engagedUntil = -99; wb.w3held = null; W3.stats.unheld = (W3.stats.unheld || 0) + 1; }
}
// a band in its own keep's or temple's court with its way out by the gate, the gate shut against foes before it (it
// opens for its own only while no foe stands within 19 m), and nobody of the band fighting through the walls: after
// 20 s the gate opens for it as for the garrison's sally, and it goes out at them (38 to 66 s at Ráth Brannagh in
// version 15's soaks, `heldAt`, `eng=0 fighting=0`; from updateWar3's look)
function w3SallyStep() {
  const now = GAME.t;
  for (const wb of WAR.warbands) {
    const L = wb.L;
    if (wb.dead || !wb.order || !L || !L.alive || !wb.leaderGoal) { wb.w3gw = null; continue; }
    const W = walledAt(L.x, L.z);
    if (!W || W.ref.realm !== wb.realm || !W.ref.door.alive || !W.C.gate || L.y - W.C.S.y > 1.2 || castleInside(W.C, wb.leaderGoal.x, wb.leaderGoal.z) || dist2(wb.leaderGoal.x, wb.leaderGoal.z, W.C.S.x, W.C.S.z) < 15 * 15) { wb.w3gw = null; continue; }
    const G0 = W.C.gate;
    if (G0.open > 0.9) { wb.w3gw = null; continue; }
    if (wb.w3gw == null) { wb.w3gw = now; continue; }
    if (now - wb.w3gw < 20) continue;
    G0.sallyUntil = now + 14; G0.sallyOpen = true;
    wb.w3gw = now + 10;
    W3.stats.sallies = (W3.stats.sallies || 0) + 1;
    news(`The gate of ${W.C.S.name} opens: ${wbName(wb)} sallies out at the foes before it.`, wb.realm, 'normal');
  }
}
// one band leader's way round (localPath, up to the quarter-metre grid) in a step at most: two or three in one step
// made the war's worst steps (bandLeaderDetour, 08j_war2.js); the others look again next step
function war3PathToken() {
  if (!W3.on) return true;
  if (W3.lpT !== GAME.t) { W3.lpT = GAME.t; W3.lpN = 0; }
  if (W3.lpN >= 1) { W3.stats.lpDeferred = (W3.stats.lpDeferred || 0) + 1; return false; }
  W3.lpN++;
  return true;
}
// a leader in an enemy keep's gate passage with its gate standing (the walk over the gate makes a room of it, so the
// castle counts it inside: version 16's soak had a Logres captain mounted there 200 s and more, through the keep's
// change of hands and two orders): its way starts at the node before the gate, not at the court behind the shut leaves
// (from bandStartNode, 08j_war2.js)
function war3StartNode(L) {
  if (!W3.on) return null;
  for (const K of WAR.keeps) {
    if (dist2(L.x, L.z, K.site.x, K.site.z) > 26 * 26) continue;
    if (K.realm === L.faction || !K.door.alive) return null;
    const S = K.site, lt = siteLocal(S, L.x, L.z), g = S.gateLocal;
    if (Math.abs(lt.x - g.x) < GATE_HW + 1 && Math.abs(lt.z - g.z) < KEEP_T + 2.6) { W3.stats.gateStarts = (W3.stats.gateStarts || 0) + 1; return K.nav.gate; }
    return null;
  }
  return null;
}

// an engine far from the camera is drawn as two or three meshes, not nine to twelve (its frame, uprights, wheels and
// drum merged at rest; its arm, counterweight or log as they move; its ropes, slings and stones, a few pixels at that
// distance, left out): each engine's parts were a draw and a shadow's draw each, and a war fifteen minutes on with
// engines and their wrecks before the keeps put the busiest views at medium over the call budget (perf.py budget).
// From siegePose, every step an engine is posed
const W3_ENG_FAR = { low: 36, medium: 55, high: 85 };
function w3Merge(parts) {
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), M = new Float32Array(nv), A = new Float32Array(nv);
  const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0;
  for (const [g, x, y, z] of parts) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.aCol, m = g.attributes.aMat, a = g.attributes.aAO, cnt = g.attributes.position.count;
    for (let i = 0; i < cnt; i++) { const k = (v0 + i) * 3, q = i * 3; P[k] = p[q] + x; P[k + 1] = p[q + 1] + y; P[k + 2] = p[q + 2] + z; N[k] = n[q]; N[k + 1] = n[q + 1]; N[k + 2] = n[q + 2]; }
    if (c) C.set(c.array.subarray(0, cnt * 3), v0 * 3);
    if (m) M.set(m.array.subarray(0, cnt), v0);
    if (a) A.set(a.array.subarray(0, cnt), v0); else A.fill(1, v0, v0 + cnt);
    if (g.index) { const ix = g.index.array; for (let i = 0; i < g.index.count; i++) I[i0 + i] = ix[i] + v0; i0 += g.index.count; }
    else { for (let i = 0; i < cnt; i++) I[i0 + i] = v0 + i; i0 += cnt; }
    v0 += cnt;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(C, 3)); g.setAttribute('aMat', new THREE.BufferAttribute(M, 1)); g.setAttribute('aAO', new THREE.BufferAttribute(A, 1));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  return g;
}
function war3EngineLod(E) {
  if (!W3.on || E.gone) return;
  const built = siegeActive(E) && (E.state !== 'build' || E.build >= 1); // (a wreck, a burning engine: its own pose, near model)
  const d2 = dist2(E.x, E.z, camera.position.x, camera.position.z), D = W3_ENG_FAR[quality.level] || 55;
  const far = built && d2 > D * D;
  if (!far && !E.w3far) return;
  if (far && !E.w3far) {
    const P = siegeParts(E.kind, E.realm);
    if (!P.w3far) {
      const parts = [[P.base, 0, 0, 0], [P.upper, 0, 0, 0]];
      if (P.wheel) for (const [x, y, z] of P.wheels) parts.push([P.wheel, x, y, z]);
      if (P.drum && P.drumAt) parts.push([P.drum, P.drumAt[0], P.drumAt[1], P.drumAt[2]]);
      P.w3far = w3Merge(parts);
    }
    E.w3far = siegeMesh(E, P.w3far);
    W3.stats.engFar = (W3.stats.engFar || 0) + 1;
  }
  const f = E.w3far;
  f.visible = far;
  if (!far) return;
  // the near model's parts the far one stands for, and the small moving ones, hidden while it shows
  E.base.visible = false; E.upper.visible = false;
  for (const w of E.wheels) w.visible = false;
  for (const m of [E.drum, E.rope, E.stoneM, E.pouch]) if (m) m.visible = false;
  for (const m of E.ropes || []) m.visible = false;
  for (const m of E.slingR || []) m.visible = false;
}

/* ------------------------------------------------------------------ */
/* every step (from updateWar)                                         */
/* ------------------------------------------------------------------ */
function updateWar3(dt) {
  if (!W3.on || !WAR.keeps.length) return;
  if (CAMPAIGN.state === 'peace') { w3PeaceStep(dt); return; }
  if (W3.peace) W3.peace = null;
  if (GAME.t < W3.look) return;
  W3.look = GAME.t + 2;
  w3ColumnSanity();
  w3SallyStep();
  const ow = W3.stats.orders || (W3.stats.orders = {});
  for (const wb of WAR.warbands) { const O = wb.order; if (!wb.dead && O && !O.w3c) { O.w3c = 1; const k = O.type + (O.why ? '/' + O.why : ''); ow[k] = (ow[k] || 0) + 1; } }
  w3PactStep();
  w3AimStep();
}

/* ------------------------------------------------------------------ */
/* what the player is told                                             */
/* ------------------------------------------------------------------ */
// one line under the claims on the war panel: who is close to a claim and why, the pact, a keep of yours being held
function war3HudLine() {
  if (!W3.on || CAMPAIGN.state !== 'war') return '';
  const P = GAME.player;
  const me = P ? P.faction : -1;
  const line = (col, html) => `<div class="cw-w3" style="--rc:${col}">${html}</div>`;
  const pact = W3.pact;
  if (pact && (pact.against === me || pact.members.includes(me))) return line(REALMS[pact.against].color, `<b>${REALMS[pact.members[0]].name}</b> and <b>${REALMS[pact.members[1]].name}</b> in common cause against <b>${REALMS[pact.against].name}</b>`);
  for (let q = 0; q < 3; q++) { const Pr = W3.press[q]; if (Pr) return line(REALMS[q].color, `<b>${REALMS[q].name}</b> presses for a fourth keep: ${WAR.keeps[Pr.keep].site.name}`); }
  const K = WAR.keeps.filter((Q) => w3Fresh(Q, me)).sort((a, b) => b.w3.t - a.w3.t)[0];
  if (K) return line(REALMS[me].color, `${K.site.name}: garrison ${w3GuardsN(K)}/6${K.w3.col != null ? ' · column on the march' : ''}${K.door.alive ? '' : ' · gate down'}`);
  if (pact) return line(REALMS[pact.against].color, `<b>${REALMS[pact.members[0]].name}</b> and <b>${REALMS[pact.members[1]].name}</b> against <b>${REALMS[pact.against].name}</b>`);
  return '';
}
// the map: a pressed keep ringed in the presser's colour, a keep being garrisoned marked with how many hold it
function war3MapMarks(ctx, toPx, u, sc) {
  if (!W3.on || CAMPAIGN.state !== 'war') return;
  for (let q = 0; q < 3; q++) {
    const Pr = W3.press[q] || W3.rally[q];
    if (!Pr) continue;
    const K = WAR.keeps[Pr.keep], [x, y] = toPx(K.site.x, K.site.z), R = REALMS[q];
    ctx.save();
    ctx.lineWidth = sc * 0.7; ctx.strokeStyle = R.light; ctx.setLineDash([sc * 1.6, sc * 1.1]); ctx.lineDashOffset = -renderTime * sc * 3;
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(renderTime * 4);
    ctx.beginPath(); ctx.arc(x, y, sc * 8.5, 0, TAU); ctx.stroke();
    ctx.restore();
    cwBadge(ctx, x - sc * 5.6, y - sc * 5, sc * 3.2, 'sword', R.color);
  }
}
// the herald's word on the war as it stands
function war3HeraldText() {
  if (!W3.on || CAMPAIGN.state !== 'war') return '';
  const P = GAME.player, me = P ? P.faction : 0, bits = [];
  for (let q = 0; q < 3; q++) { const Pr = W3.press[q]; if (Pr) bits.push(`${REALMS[q].name} holds three keeps and presses for ${WAR.keeps[Pr.keep].site.name}: take it and ${REALMS[q].name} has its claim.`); }
  if (W3.pact) bits.push(`${REALMS[W3.pact.members[0]].name} and ${REALMS[W3.pact.members[1]].name} have made common cause against ${REALMS[W3.pact.against].name}.`);
  const top = cwTopClaims()[0];
  if (top && top.on) bits.push(`${REALMS[top.r].name} wins the March in ${fmtClock(top.left)} unless its hold is broken.`);
  else if (top && top.slow) bits.push(`${REALMS[top.r].name} holds more keeps than any other realm, and its claim grows: at this pace it wins the March in ${fmtClock(top.left)}.`);
  const fresh = WAR.keeps.filter((K) => w3Fresh(K, me));
  for (const K of fresh) bits.push(`${K.site.name} is newly ours: ${w3GuardsN(K)} of its six guards are at their posts${K.w3.col != null ? ', and a column marches from the muster with the rest' : ''}${K.door.alive ? '' : '; its gate is still being mended'}.`);
  if (!bits.length) return '';
  return `<p><b>The war now.</b> ${bits.join(' ')}</p>`;
}
function war3ChronHTML() {
  return `<h3>Holding what you take</h3>
    <p>A keep taken is held before the next is sought. The band that took it holds its court and leaves up to three of its soldiers as the new guards; a column of the rest marches from the realm's muster along the roads, fights whatever meets it, and takes the posts, the archers climbing to the walls. A gate broken when the keep fell stays broken until two of its new guards have mended it in a quiet hour, mallets in hand. Cut off the column, or strike before the gate stands, and the keep may be won back cheaply; leave them a few minutes and it holds.</p>
    <p>A realm with three keeps presses for a fourth: it names the keep and sends every free band there, and the keep's owners send a band to meet the blow. A realm that leads the March finds the two behind it in common cause: they leave each other's keeps alone and both march on the leader until its lead is gone. A realm down to its last keep calls every band to win one of its own back. All of it is cried in the war's news, ringed on the map and told on the war panel.</p>
    <p>When a campaign is won the truce holds: the crews break up their engines, the walls are mended behind their scaffolds, and half a minute before the next campaign the keeps go back to their own realms, their garrisons marching in.</p>`;
}

/* ------------------------------------------------------------------ */
/* what a player is told the first time                                */
/* ------------------------------------------------------------------ */
queueMicrotask(() => { // (FIELD_NOTES, GUIDE_WATCH, GUIDE_HELP and LOADING_TIPS are declared by later modules)
Object.assign(FIELD_NOTES, {
  keepheld: { t: 'A keep must be held', x: () => `The band that took it holds its court while a column marches from the muster to garrison it, and its new guards mend the broken gate. Help them hold it a few minutes and it stands; leave it bare and it is soon lost again.` },
  presses: { t: 'One keep from the March', x: () => `A realm with three keeps presses for a fourth, and the keep is ringed on the map. Four keeps held long enough win the campaign; the realms behind may make common cause against it. The war panel says who is close.` },
});
GUIDE_WATCH.keepheld = (P) => WAR.keeps.some((K) => K.w3 && K.realm === P.faction && GAME.t - K.w3.t < 60 && dist2(P.x, P.z, K.site.x, K.site.z) < 120 * 120);
GUIDE_WATCH.presses = () => W3.press.some((q) => !!q) || !!W3.pact;
GUIDE_HELP.push(() => `<h3>Holding keeps and pressing for the March</h3><p>A keep taken is held by the band that took it until a column from the muster has garrisoned it and its gate is mended. A realm with three keeps presses for a fourth (ringed on the map); the realms behind a leader make common cause against it. The war panel and the herald say who is close to a claim.</p>`);
LOADING_TIPS.push('A keep you take is held while a column marches from your muster to garrison it: cut off an enemy column and the keep it was marching to is easier to win back.', 'A realm with three keeps presses for a fourth, ringed on the map: the realms behind it often make common cause against it.');
});

/* ------------------------------------------------------------------ */
/* saving: the pact, the presses and the keeps newly taken             */
/* ------------------------------------------------------------------ */
registerSavePart('world', 'war3', {
  save() {
    if (!W3.on || CAMPAIGN.state !== 'war') return undefined;
    const now = GAME.t, kw = WAR.keeps.map((K) => (K.w3 && now - K.w3.t < W3.FRESH ? [Math.round(now - K.w3.t), K.w3.by] : 0));
    const o = { p: W3.pact ? [W3.pact.against, Math.round(now - W3.pact.t)] : 0, pr: W3.press.map((q) => (q ? q.keep : -1)), ra: W3.rally.map((q) => (q ? q.keep : -1)), kw };
    return o.p || o.pr.some((v) => v >= 0) || o.ra.some((v) => v >= 0) || kw.some(Boolean) ? o : undefined;
  },
  load(d) {
    W3.pact = null; W3.press = [null, null, null]; W3.rally = [null, null, null];
    if (!d || typeof d !== 'object') return;
    const now = GAME.t, kn = WAR.keeps.length;
    const int = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? clamp(Math.round(v), lo, hi) : null);
    if (Array.isArray(d.p)) { const a = int(d.p[0], 0, 2), age = int(d.p[1], 0, 3600); if (a !== null) W3.pact = { against: a, members: [0, 1, 2].filter((q) => q !== a), t: now - (age || 0), lostAt: null }; }
    for (let r = 0; r < 3; r++) {
      const p = Array.isArray(d.pr) ? int(d.pr[r], -1, kn - 1) : null, q = Array.isArray(d.ra) ? int(d.ra[r], -1, kn - 1) : null;
      if (p !== null && p >= 0) W3.press[r] = { keep: p, t: now };
      if (q !== null && q >= 0) W3.rally[r] = { keep: q, t: now };
    }
    if (Array.isArray(d.kw)) WAR.keeps.forEach((K, i) => { const v = d.kw[i]; if (!Array.isArray(v)) return; const age = int(v[0], 0, W3.FRESH), by = int(v[1], 0, 2); if (age !== null && by !== null && by === K.realm) K.w3 = { t: now - age, by, from: -1, col: null, holder: null }; });
  },
  key: (d) => (d ? JSON.stringify([d.p ? d.p[0] : -1, d.pr, d.ra, (d.kw || []).map((v) => (v ? v[1] : -1))]) : ''),
});

/* ------------------------------------------------------------------ */
/* styles and test hooks                                               */
/* ------------------------------------------------------------------ */
(function war3Style() {
  const st = document.createElement('style');
  st.id = 'w3-css';
  st.textContent = `
#war .cw-w3 { font-size: 11.5px; line-height: 1.25; color: var(--ink-dim); border-left: 3px solid var(--rc); padding-left: 5px; }
#war .cw-w3 b { color: var(--ink); font-weight: 700; }
@media (max-width: 760px), (pointer: coarse) { #war .cw-w3 { font-size: 10.5px; } }
`;
  (document.body || document.documentElement).appendChild(st);
})();
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.fn.localPathT = localPath; window.__hm.lp = LP; // (tests: the way-finder and its measure)
  window.__hm.war3 = { W3, w3KeepsOf, w3GuardsN, w3FreeSlots, w3Fresh, w3Threat, w3Leads, w3BestTarget, war3MakeGuard, war3OnCapture, war3Column, war3HoldOn, war3GateWork, war3Choose, war3HudLine, war3HeraldText, w3PeaceStep, war3Reset, updateWar3, war3EngineLod, war3ClaimSlow, war3Levy, war3EngageGuard, war3PathToken, war3StartNode };
});
