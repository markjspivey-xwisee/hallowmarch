/* ================================================================== */
/* [war4] a war whose holds are real (version 18)                      */
/* ================================================================== */
// Version 17 made a keep taken mean something (08k_war3.js), and its soaks still found a keep falling with a median of
// one guard left: whoever came by after the last fight took it. A keep is held now as a garrison holds one:
//   the gate is mended behind a scaffold as the walls are: once the keep has been quiet a while its masons put up a
//   scaffold over the gateway on its court side (look3's putlog scaffold: boards, a rail, braces, a ladder: 04d_look3.js)
//   and come out of the hall to work on it (13v_look3.js's masons), two of the court's guards hang the new leaves below
//   (war3GateWork), the new leaves rise board by board standing open against the passage's sides, and when the work is
//   done the gate is hung at its full strength and shut (the war's old rule set a gate back at a third of its strength
//   40 s after the last foe, nobody at work); the work stops while foes are about and goes on when they are gone;
//   its guards come back as soldiers do: a keep thinned to half its garrison and quiet sends for a column of the rest
//   from the realm's nearest keep (out of its hall) or its muster, which marches the roads, fights what it meets and takes
//   the posts (war3's column, now from the nearest keep or muster, after a fight as after a capture); a guard who comes on
//   his own (the old trickle, one each 14 s of quiet) comes out of the hall's door and walks to his post;
//   a sally goes out only when it pays: with two swords to every foe before the gate and about the engine, and one guard
//   stays behind;
//   a pact keeps faith in the field: while two realms make common cause their bodies do not fall on each other (isEnemy),
//   their foes are not each other's (a keep's alarm, a band held, a sally's count), their bands at each other's keeps are
//   called off, their stones spare each other's walls; and it is cried when it begins and when it ends;
//   the peace hands the keeps back as it begins, and their garrisons march in from the realm's nearest keep or muster (a
//   column still on the road when the new campaign begins takes its posts from where it stands);
//   no claim is won before the twentieth minute of a campaign (a claim full sooner stands until then, and says so).
// Shared files only call in (each marked [war4]): 07_entities.js (isEnemy), 08_ai.js (updateWar: the gate's old rule, the
// alarm's count, the trickle, the step; wbEnemiesNear), 08k_war3.js (the column's source and words, the peace's hand-back,
// a column in the peace, the threat count, the pact's words, the war panel's gate), 08g_campaign.js (planWar's peace,
// the claims' floor), 04h_siege.js (the sally), 04g_castles.js (castleSiegeHit), 13v_look3.js (the masons at the gate),
// 08j_war2.js (down off towers and low walls, out of a tower's room), 04l_towers.js (a door's open leaf gives way).
const W4 = {
  on: true, // (tests: off restores version 17's ways)
  GATE_QUIET: 10, // s of quiet (and since the gate fell) before the masons put up its scaffold
  GATE_T: 70, // s of quiet work to hang a new gate
  GATE_HP: 1, // its strength when it stands (the old rule: 0.35)
  RELIEF_N: 3, // a keep with this many living guards or fewer sends for a column of the rest...
  RELIEF_QUIET: 20, // ...once it has been quiet this long
  RELIEF_GAP: 60, // s: at most one relief column a keep in this long
  SALLY_K: 2, // swords to every foe a sally goes out with
  PEACE_BACK: 8, // s into the peace: the keeps go back to their own realms, their columns march in
  EARLY: 1200, // s: no claim is won before the twentieth minute
  DOWN_H: 0.8, // m: a band's soldier this high on a keep's floors with nothing to fight goes down by its ways (war2's: 2)
  stats: { gatesStarted: 0, gatesHung: 0, gateWorkS: 0, gatePaused: 0, reliefs: 0, colKeep: 0, colMuster: 0, trickleHall: 0, salliesKept: 0, salliesGone: 0, pacts: 0, recalled: 0, handedBack: 0, peaceCols: 0, colsHome: 0, earlyHeld: 0, stonesSpared: 0 },
  look: 0,
  pactKey: '',
};

/* ------------------------------------------------------------------ */
/* the pact keeps faith in the field                                   */
/* ------------------------------------------------------------------ */
// both factions realms of a pact in force? (asked by isEnemy for every pair it weighs: cheap when there is none)
function war4Allied(fa, fb) {
  const P = W3.pact;
  if (!P || !W4.on || !W3.on || fa === fb || fa > 2 || fb > 2) return false;
  const m = P.members;
  return (m[0] === fa || m[1] === fa) && (m[0] === fb || m[1] === fb);
}
// a foe of realm r, pacts weighed (the counts of foes about a keep, before a band, before a gate)
const w4Foe = (f, r) => f <= 2 && f !== r && !war4Allied(f, r);
// a pact begun: the bands of each at the other's keeps and temple are called off, and nobody keeps an ally for a target
function w4PactBegins(P) {
  W4.stats.pacts++;
  const [a, b] = P.members;
  for (const wb of WAR.warbands) {
    if (wb.dead || (wb.realm !== a && wb.realm !== b) || !wb.order) continue;
    const ally = wb.realm === a ? b : a, O = wb.order;
    const onAlly = (O.keep && O.keep.realm === ally && (O.type === 'attack' || O.type === 'defend')) || (O.temple && O.temple.realm === ally);
    if (onAlly && !(O.type === 'defend')) { wb.order = null; W4.stats.recalled++; }
  }
  for (const e of ENT) {
    if (!e.alive || e.faction > 2 || !e.target) continue;
    const t = getEnt(e.target);
    if (t && war4Allied(e.faction, t.faction)) { e.target = null; if (e.threat) e.threat.delete(t.id); if (e.ai) e.ai.chase = null; }
  }
}
function w4PactStep() {
  const P = W3.pact, key = P ? P.against + ':' + Math.round(P.t * 10) : '';
  if (key !== W4.pactKey) { W4.pactKey = key; if (P) w4PactBegins(P); }
  if (P) w4PactSweep();
}
// while it holds (every 2 s): an order against an ally (a raid the chance of an open temple gave, a chase after an ally
// carrying a hallow of ours) is given back: its band could only stand before the ally's gate, or steal from a friend
function w4PactSweep() {
  for (const wb of WAR.warbands) {
    const O = wb.order;
    if (wb.dead || !O || O.byPlayer) continue;
    let bad = false;
    if (O.type === 'attack' && O.keep && war4Allied(wb.realm, O.keep.realm)) bad = true;
    else if (O.type === 'raid' && O.temple && war4Allied(wb.realm, O.temple.realm)) bad = true;
    else if (O.type === 'retrieve' && O.relic && O.relic.state === 'carried') { const c = getEnt(O.relic.carrier); if (c && war4Allied(wb.realm, c.faction)) bad = true; }
    if (bad) { wb.order = null; W4.stats.recalled++; }
  }
}
// the commander's choices (from cwChoose, after war3Choose): none against an ally while the pact holds
function war4Choose(r, C) {
  if (!W4.on || !W3.pact) return;
  for (let i = C.length - 1; i >= 0; i--) {
    const o = C[i].o;
    if ((o.type === 'attack' && o.keep && war4Allied(r, o.keep.realm)) || (o.type === 'raid' && o.temple && war4Allied(r, o.temple.realm))) C.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/* a sally only when it pays                                           */
/* ------------------------------------------------------------------ */
// (from siegeSallies, 04h_siege.js) every foe out before the gate and about the engine it would go for: two swords to
// each, and one guard stays behind. A sally at an engine with its band twenty paces off went out into all of them.
function war4SallyPays(K, C, guards, E, gp) {
  if (!W4.on) return true;
  let foes = 0;
  const seen = new Set(), count = (x, z, r) => forNear(x, z, r, (o) => {
    if (!o.alive || !isActor(o) || !w4Foe(o.faction, K.realm) || seen.has(o.id) || castleInside(C, o.x, o.z)) return;
    seen.add(o.id); foes += o.role === 'soldier' || o.role === 'player' ? 1 : 0.6;
  });
  count(gp.x, gp.z, 30);
  if (E) count(E.x, E.z, 32);
  const ok = guards.length - 1 >= Math.max(1, foes * W4.SALLY_K);
  W4.stats[ok ? 'salliesGone' : 'salliesKept']++;
  return ok;
}
// who goes: all but one (the priest first stays, else the last)
function war4SallyParty(guards) {
  if (!W4.on || guards.length < 2) return guards;
  const i = guards.findIndex((g) => g.cls === 'priest');
  const stay = i >= 0 ? i : guards.length - 1;
  return guards.filter((g, j) => j !== stay);
}

/* ------------------------------------------------------------------ */
/* columns from the nearest keep or the muster                         */
/* ------------------------------------------------------------------ */
const w4HallOf = (S) => (typeof HALL !== 'undefined' ? HALL.list.find((q) => q.S === S && houseIntact(q)) : null);
// where a column for keep K of realm r forms: the realm's keep nearest K (out of its hall, or in its court before the
// gate) that is not under siege and has its gate, or the muster (a file along its road). { x, z, name, from, at(i, n) }
function war4ColumnFrom(K, r) {
  const R = REALMS[r], M = R.musterSite;
  let best = null, bd = W4.on ? dist2(M.x, M.z, K.site.x, K.site.z) : -1;
  if (W4.on) for (const Q of WAR.keeps) {
    if (Q === K || Q.realm !== r || !Q.door.alive || GAME.t < Q.underSiegeUntil || w3Fresh(Q, r)) continue;
    const d = dist2(Q.site.x, Q.site.z, K.site.x, K.site.z);
    if (d < bd) { bd = d; best = Q; }
  }
  if (!best) {
    if (W4.on) W4.stats.colMuster++;
    return { x: M.x, z: M.z, name: `the ${M.name}`, from: -1, at: (i, n) => { const a = R.bearing + Math.PI + (i - n / 2) * 0.12, rr = 4 + i * 1.6; return { x: M.x + Math.sin(a) * rr, z: M.z + Math.cos(a) * rr }; } };
  }
  W4.stats.colKeep++;
  const S = best.site, H = w4HallOf(S);
  if (H) {
    // out of the hall's door, one after another (each a pace behind the last along the way out)
    const D = H.door, ux = D.out2.x - D.out.x, uz = D.out2.z - D.out.z, ul = Math.hypot(ux, uz) || 1;
    return { x: S.x, z: S.z, name: S.name, from: best.id, hall: H, at: (i) => ({ x: D.out.x + (ux / ul) * (0.4 + (i % 2) * 0.6) - (uz / ul) * ((i % 3) - 1) * 0.7, z: D.out.z + (uz / ul) * (0.4 + (i % 2) * 0.6) + (ux / ul) * ((i % 3) - 1) * 0.7 }) };
  }
  const gz = S.gateLocal.z - (castleOf(S) && castleOf(S).kind === 'round' ? 5 : 5.5);
  return { x: S.x, z: S.z, name: S.name, from: best.id, at: (i) => siteToWorld(S, (i % 2 ? 1 : -1) * 0.9, gz - Math.floor(i / 2) * 1.5) };
}
// a keep thinned to half its garrison and quiet sends for the rest (from updateWar4, every 2 s in war)
function w4ReliefStep() {
  const now = GAME.t;
  for (const K of WAR.keeps) {
    if (K.w3 && K.w3.col != null) continue;
    if (now - K.lastEnemyNear < W4.RELIEF_QUIET || now < (K.w4relT || 0)) continue;
    if (w3GuardsN(K) > W4.RELIEF_N) continue;
    const miss = w3FreeSlots(K);
    if (miss.length < 2) continue;
    if (!K.w3) K.w3 = { t: -1e9, by: K.realm, from: K.realm, col: null, holder: null }; // (an old hold: not "newly taken")
    K.w4relT = now + W4.RELIEF_GAP;
    war3Column(K, K.realm, miss, { why: 'relief' });
    W4.stats.reliefs++;
  }
}
// a guard who comes on his own (the trickle of quiet hours, 08_ai.js) comes out of the hall's door and walks to his post
function war4Trickle(K) {
  if (!W4.on) { fillGarrison(K, false); return; }
  const had = new Set(K.guards), lord0 = K.lord;
  fillGarrison(K, false);
  const H = w4HallOf(K.site);
  if (!H) return;
  const D = H.door, fresh = [...K.guards].filter((id) => !had.has(id));
  if (K.lord !== lord0 && K.lord != null) fresh.push(K.lord);
  for (const id of fresh) {
    const g = getEnt(id);
    if (!g || !g.alive || g.fixedY !== null) continue;
    g.x = g.prevX = D.out.x; g.z = g.prevZ = D.out.z; g.y = g.prevY = floorAt(g.x, g.z, H.y + 0.3);
    g.yaw = Math.atan2(D.out2.x - D.out.x, D.out2.z - D.out.z);
    if (g.ai.wall && !g.ai.route) { const sl = +String(g.ai.slot).slice(1); const Rt = castleRoute(K, sl); if (Rt) { g.ai.route = Rt; g.ai.ri = 0; } }
    setHouseDoor(H, true, g, true);
    W4.stats.trickleHall++;
  }
}

/* ------------------------------------------------------------------ */
/* the gate mended behind a scaffold                                   */
/* ------------------------------------------------------------------ */
// The scaffold stands in the court over the gateway: a row of standards along the gate wall's inner side, two beside the
// passage and one beyond each (none in the passage: bodies walk under its boards), a lift of boards above the gate's
// height with its rail and braces, putlogs into the wall, and a ladder at one end (look3Scaffold, 04d_look3.js). The
// row stands as near the wall as it may (clear of the gate towers, a stair, a walk's deck over it: look3Clear).
// Returns { geo, infos } in the keep's frame, or null where no row can stand.
function w4GateScaffoldGeo(C, G0) {
  const S = C.S, M = C.M, st = C.st, round = C.kind === 'round';
  const a = (round ? G0.hw : Math.max(G0.hw, GATE_HW)) + 0.45, wing = 1.9;
  const gyF = (x, z) => { const w = siteToWorld(S, x, z); return heightAt(w.x, w.z) - S.y; };
  const clear = (x, z, r = 0.24) => { const w = siteToWorld(S, x, z); return look3Clear(w.x, w.z, r); };
  // the row: from the wall inward, the first place its standards stand clear and its boards leave a mason's head room
  // under anything above them (the walk over a Logres gate is a bridge 0.5 m thick at the walls' height: boards at the
  // gate's height under it put the mason's head in its timbers); the lift as high as the gate and that head room allow
  let zr = null, deep = 0.95, lift = G0.h + 0.5;
  for (let z = G0.gz - 1.3; z > G0.gz - 9; z -= 0.25) {
    if (!(clear(-a, z) && clear(a, z) && (clear(-a - wing, z) || clear(a + wing, z)))) continue;
    // how far the boards reach toward the wall: to its face beside the passage (a shot along the frame's +z), a little short
    let dp = 0.95;
    for (const sx of [-1, 1]) {
      const p = siteToWorld(S, sx * (a - 0.2), z), q = siteToWorld(S, sx * (a - 0.2), z + 4);
      const R = shotHit(p.x, S.y + G0.h + 0.4, p.z, q.x, S.y + G0.h + 0.4, q.z, { ground: false });
      if (R) dp = Math.min(dp, Math.max(0.55, R.t * 4 - 0.12));
    }
    let yl = G0.h + 0.5;
    for (let x = -a - wing; x <= a + wing + 1e-3; x += 0.9) for (let dz = 0; dz <= dp + 1e-3; dz += 0.3) {
      const w = siteToWorld(S, x, z + dz), u = w4Underside(w.x, w.z, S.y + yl);
      if (u - (S.y + yl + 0.16) < 2.05) yl = u - S.y - 2.21;
    }
    if (yl < 2.8) continue; // (too low over the passage for a rider: further in)
    zr = z; deep = dp; lift = yl;
    break;
  }
  if (zr === null) return null;
  const pts = [[-a - wing, zr], [-a, zr], [a, zr], [a + wing, zr]], ins = pts.map(() => [0, 1]);
  const b = new Batch();
  const info = look3Scaffold(b, M, pts, ins, { lifts: [lift], top: lift + 1.35, deep, gy: gyF, clear: (x, z) => clear(x, z), pole: st.logs, wood: st.wood, baseY: S.y, seed: Math.round(Math.abs(S.x * 3 + S.z)) % 97 });
  if (!info || info.bays < 2 || !info.ladders) return null;
  // new timber for the leaves waiting at the scaffold's foot, on the ground beside the passage (not in it)
  const wood = darker(st.wood, 1.18), I = M;
  for (let i = 0; i < 3; i++) {
    const x = -(a + wing * 0.5), z = zr - 1.1 - i * 0.26, g = gyF(x, z);
    if (!clear(x, z, 0.5)) continue;
    b.add(G.box, lm(I, x, g + 0.06 + i * 0.12, z, 0.06 * (i - 1), 0.22, 0.1, Math.min(G0.h, 3.6)), MAT.wood, darker(wood, 0.9 + 0.08 * i), S.y);
  }
  return { geo: b.build(), infos: [info] };
}
// the lowest underside of anything standing over (x, z) above world height y (a floor's solid bottom: a bridge's, a
// deck's); -Infinity when something solid stands there from the ground up through y
function w4Underside(x, z, y) {
  let u = Infinity;
  const list = FLOOR.grid.get(collKey(Math.floor(x / FLOOR.cell), Math.floor(z / FLOOR.cell)));
  if (list) for (const f of list) {
    if (!f.active) continue;
    const t = floorTopOf(f, x, z);
    if (t === null || t <= y + 0.3) continue;
    if (f.y0 < y) return -Infinity;
    u = Math.min(u, f.y0);
  }
  return u;
}
// the gate's mending record (a scaffold job for the masons: look3Masons reads l3, t and masonsFor)
function w4GateOf(K) {
  const C = castleOf(K.site), G0 = C && C.gate;
  if (!G0 || G0.temple) return null;
  return G0.w4 || (G0.w4 = { w4gate: true, K, C, G0, st: 'whole', t: 0, l3: null, scaffold: null, laid: false, masonsFor: null, idle: 0 });
}
function w4GateLay(g) {
  g.laid = true;
  const C = g.C, S = C.S, R = w4GateScaffoldGeo(C, g.G0);
  if (!R) return;
  const m = new THREE.Mesh(R.geo, buildingMat);
  m.renderOrder = 1; m.visible = false;
  scene.add(m);
  shadowCaster(m, BUILDING_DEPTH);
  g.scaffold = m;
  g.scafInfo = R.infos;
  look3ScaffoldWorld(g, S, R.infos); // its boards are floors and its ladder is climbed while it stands
}
function w4GateShow(g, on) {
  if (g.scaffold) g.scaffold.visible = on;
  if (g.l3) look3ScafSync(g, on);
}
// the new leaves, open against the passage's sides, rising with the work (k 0..1); fresh timber, not a burnt gate's char
function w4GateLeaves(g, k) {
  const G0 = g.G0;
  const show = k > 0.02;
  if (show && G0.bz && G0.bz.down) G0.leaves.forEach((m, i) => { m.material = G0.bz.leafMats[i]; });
  for (const m of G0.leaves) { m.visible = show; m.scale.y = Math.max(0.04, k); }
  if (show) { G0.open = 1; setGatePose(G0); }
}
function w4GateStart(g) {
  if (!g.laid) w4GateLay(g);
  g.st = 'mend'; g.t = g.t || 0;
  w4GateShow(g, true);
  W4.stats.gatesStarted++;
  news(`The masons of ${g.K.site.name} put up a scaffold in the gateway to hang a new gate.`, g.K.realm, 'normal');
}
function w4GateDone(g, built) {
  const K = g.K, G0 = g.G0, D = K.door;
  w4GateShow(g, false);
  g.st = 'whole'; g.t = 0; g.idle = 0;
  for (const m of G0.leaves) m.scale.y = 1;
  if (!built) return;
  // hung and shut: the leaves swing to as soon as nobody of its own needs the way (updateGate)
  G0.alive = true; G0.open = 1; G0.want = 1; G0.flashT = 1.6;
  for (const m of G0.leaves) m.visible = true;
  G0.wreck.visible = false;
  setDoorState(D, true, W4.GATE_HP);
  setGatePose(G0);
  FX.dust(D.x, D.y + 1, D.z, 16, wallLit([0.55, 0.48, 0.38]));
  sfxAt('grind', D.x, D.y + 2, D.z);
  W4.stats.gatesHung++;
  news(`${K.site.name} has hung a new gate.`, K.realm, 'normal');
}
// each step for each keep (updateWar4): a broken gate waits for quiet, then is mended behind its scaffold
function w4GateStep(K, dt) {
  const g = w4GateOf(K);
  if (!g) return;
  const D = K.door, now = GAME.t;
  if (D.alive) { if (g.st !== 'whole') w4GateDone(g, false); return; }
  if (g.st === 'whole') { g.st = 'down'; g.t = g.t0 || 0; g.t0 = 0; }
  const quiet = now - K.lastEnemyNear;
  w4GatePlug(K, g, quiet < 6);
  if (g.st === 'down') {
    if (quiet > W4.GATE_QUIET && now - D.deadAt > W4.GATE_QUIET) w4GateStart(g);
    else return;
  }
  // foes about: the work stops (the masons go home: look3MasonThink), and goes on once they are gone
  if (quiet < 3) { if (!g.idle) W4.stats.gatePaused++; g.idle = 1; return; }
  g.idle = 0;
  g.t = Math.min(1, g.t + (dt * loopsWork(K, 'gate', dt, W4.GATE_T)) / W4.GATE_T); // [loops] timber and iron from the keep's stores (08m_loops.js)
  W4.stats.gateWorkS += dt;
  if (g.t > 0.12) G0Wreck(g, false);
  w4GateLeaves(g, clamp((g.t - 0.15) / 0.8, 0, 1));
  if (g.t >= 1) w4GateDone(g, true);
}
const G0Wreck = (g, on) => { if (g.G0.wreck) g.G0.wreck.visible = on; };
// the gateway manned while its gate is down and foes are about: the court's two front guards stand in its mouth, either
// side of the way in, and fight what comes through (as a breach is held: siegePostedThink, ai.plug); let go once quiet
// (war3GateWork has them hang the new leaves then)
function w4GatePlug(K, g, foes) {
  const W = g.plugW || (g.plugW = { state: 'whole', w4gate: true, C: g.C });
  const was = W.state;
  W.state = foes && !K.door.alive ? 'breach' : 'whole';
  if (W.state !== 'breach' || (was === 'breach' && GAME.t < (g.plugT || 0))) return;
  g.plugT = GAME.t + 1;
  const S = g.C.S, gz = S.gateLocal.z - (g.C.kind === 'round' ? 4 : 4.2);
  for (const id of K.guards) {
    const e = getEnt(id);
    if (!e || !e.alive || !e.ai || e.ai.wall || (e.ai.slot !== 'c0' && e.ai.slot !== 'c1') || e.ai.plug || e.ai.fire || e.ai.sally) continue;
    const p = siteToWorld(S, (e.ai.slot === 'c0' ? -1 : 1) * 1.3, gz);
    e.ai.plug = { W, x: p.x, z: p.z };
    W4.stats.gatePlugs = (W4.stats.gatePlugs || 0) + 1;
  }
}
// does war4 mend this keep's gate? (the war's old rule in updateWar stands aside: 08_ai.js)
const war4GateMends = (K) => W4.on && !!w4GateOf(K);
// the war panel's word for a gate down (08k_war3.js's line)
function war4GateWord(K) {
  const g = W4.on ? w4GateOf(K) : null;
  if (!g || g.st !== 'mend') return ' · gate down';
  return ` · new gate ${Math.round(g.t * 100)}%`;
}

/* ------------------------------------------------------------------ */
/* the peace: the keeps handed back as it begins, their garrisons march */
/* ------------------------------------------------------------------ */
// a keep handed back (from w3PeaceStep): its takers go home (as restoreKeep's do), its own lord takes his seat, and a
// column of its own marches in from the realm's nearest keep or muster (not its garrison set at its posts at once)
function war4HandBack(K) {
  for (const id of K.guards) { const g = getEnt(id); if (g) { FX.burst(g.x, g.y + 1.2, g.z, 14, [0.5, 1.1, 1.8], 2.5, 0.8, 0.16, 0.5); removeEnt(g); } }
  K.guards.clear();
  const Lr = getEnt(K.lord);
  if (Lr) { FX.burst(Lr.x, Lr.y + 1.2, Lr.z, 14, [0.5, 1.1, 1.8], 2.5, 0.8, 0.16, 0.5); removeEnt(Lr); }
  K.lord = null;
  K.realm = K.orig;
  setSiteBanners(K.site, K.orig);
  fillGarrison(K, false); // (its lord only)
  K.underSiegeUntil = -99; K.lastOwnerChange = GAME.t;
  if (K.door.alive) { K.door.faction = K.orig; if (K.site.door) K.site.door.owner = K.orig; } else { K.door.faction = K.orig; if (K.site.door) K.site.door.owner = K.orig; }
  K.w3 = { t: -1e9, by: K.orig, from: K.orig, col: null, holder: null };
  W4.stats.handedBack++;
  const S = K.site, col = REALMS[K.orig].rgb.map((v) => v * 2 + 0.4);
  for (let i = 0; i < 4; i++) later(i * 0.3, () => FX.burst(S.x + (Math.random() - 0.5) * 16, S.y + 10 + Math.random() * 5, S.z + (Math.random() - 0.5) * 16, 24, col, 6, 1.0, 0.24, 3));
}
// in the peace, every keep with posts empty and no column on the way sends for one
function w4PeaceColumns() {
  for (const K of WAR.keeps) {
    if (K.realm !== K.orig || (K.w3 && K.w3.col != null)) continue;
    const miss = w3FreeSlots(K);
    if (!miss.length) continue;
    if (!K.w3) K.w3 = { t: -1e9, by: K.realm, from: K.realm, col: null, holder: null };
    war3Column(K, K.realm, miss, { why: 'home', peace: true });
    W4.stats.peaceCols++;
  }
}
// at the reset (war3Reset): a column still on the road takes its posts from where it stands (each walks there)
function war4ColumnsHome() {
  if (!W4.on) return;
  for (const wb of WAR.warbands) {
    if (wb.dead || !wb.w3col) continue;
    const K = WAR.keeps[wb.w3col.keep];
    if (!K || K.realm !== wb.realm) continue;
    for (const e of wbMembers(wb)) {
      const free = w3FreeSlots(K, true), s = e.w3slot && free.includes(e.w3slot) ? e.w3slot : free[0];
      if (s && war3MakeGuard(e, K, s, wb)) W4.stats.colsHome++;
    }
    if (!wbMembers(wb).length) wb.dead = true;
  }
}

/* ------------------------------------------------------------------ */
/* no claim before the twentieth minute                                */
/* ------------------------------------------------------------------ */
// (from updateCampaign) may a full claim win now? Before W4.EARLY it stands full and says so once
function war4MayWin(r, how) {
  if (!W4.on || campaignElapsed() >= W4.EARLY) return true;
  const c = CAMPAIGN.claims[r];
  if (how === 'keeps') c.k = Math.min(c.k, CW.KEEP_HOLD); else c.h = Math.min(c.h, CW.HALLOW_HOLD);
  if (!c.w4early) {
    c.w4early = 1; W4.stats.earlyHeld++;
    news(`${possessive(REALMS[r].name)} claim on the March stands full, but the elders hear no claim before the twentieth minute of a campaign: hold on until then (${fmtClock(W4.EARLY - campaignElapsed())}).`, r, 'big');
  }
  return false;
}
// a claim's time left, never sooner than the twentieth minute
const war4Left = (left) => (W4.on ? Math.max(left, W4.EARLY - campaignElapsed()) : left);

/* ------------------------------------------------------------------ */
/* every step (from updateWar, after updateWar3)                       */
/* ------------------------------------------------------------------ */
function updateWar4(dt) {
  if (!W4.on || !WAR.keeps.length) return;
  for (const K of WAR.keeps) w4GateStep(K, dt);
  if (GAME.t < W4.look) return;
  W4.look = GAME.t + 2;
  w4PactStep();
  if (CAMPAIGN.state === 'war') w4ReliefStep();
  else if (W3.peace && W3.peace.back) w4PeaceColumns();
  if (CAMPAIGN.state === 'war') for (const c of CAMPAIGN.claims) if (c.w4early && campaignElapsed() >= W4.EARLY) c.w4early = 0;
}
// at a new campaign (from war3Reset): every gate's work is over (restoreKeep hangs them whole)
function war4Reset() {
  war4ColumnsHome();
  for (const K of WAR.keeps) { const g = w4GateOf(K); if (g && g.st !== 'whole') { w4GateShow(g, false); g.st = 'whole'; g.t = 0; for (const m of g.G0.leaves) m.scale.y = 1; } }
  for (const c of CAMPAIGN.claims) c.w4early = 0;
}

/* ------------------------------------------------------------------ */
/* what a player is told                                               */
/* ------------------------------------------------------------------ */
function war4ChronHTML() {
  return `<h3>Gates, garrisons and pacts</h3>
    <p>A broken gate is not hung again by itself. Once a keep has been quiet a little while its masons put up a scaffold in the gateway and work from its boards, two of its guards hang the new leaves below, and in a minute or so of quiet the gate stands again at its full strength and shuts. Foes about the keep stop the work; it goes on when they are gone.</p>
    <p>A keep thinned to half its garrison sends for the rest: a column marches from the realm's nearest keep, out of its hall, or from its muster, and takes the posts. A guard who comes alone walks out of the hall's door to his post. A garrison sallies only when it is twice the foes before its gate.</p>
    <p>While two realms are in common cause their soldiers do not fall on each other in the field; when the pact ends they are foes again, and the news says so. No claim on the March is won before the twentieth minute of a campaign: a claim full sooner stands until then.</p>`;
}
queueMicrotask(() => { // (FIELD_NOTES, GUIDE_HELP and LOADING_TIPS are declared by later modules)
  if (typeof FIELD_NOTES !== 'undefined' && !FIELD_NOTES.gatemend) {
    FIELD_NOTES.gatemend = { t: 'A gate being hung', x: () => `Masons work on a scaffold in the gateway and two guards hang the new leaves. In a quiet minute or so the gate stands again at its full strength; foes about the keep stop the work.` };
    GUIDE_WATCH.gatemend = (P) => WAR.keeps.some((K) => { const g = K.site && castleOf(K.site) && castleOf(K.site).gate && castleOf(K.site).gate.w4; return g && g.st === 'mend' && dist2(P.x, P.z, K.site.x, K.site.z) < 60 * 60; });
  }
  if (typeof GUIDE_HELP !== 'undefined') GUIDE_HELP.push(() => `<h3>Gates, garrisons and pacts</h3><p>A broken gate is hung again by the keep's masons behind a scaffold once the keep is quiet. A keep thinned to half its garrison sends for a column from the nearest keep or muster. Realms in common cause do not fight each other while the pact holds. No claim is won before a campaign's twentieth minute.</p>`);
  if (typeof LOADING_TIPS !== 'undefined') LOADING_TIPS.push('A broken gate stands again only once the keep has been quiet long enough for its masons to hang a new one: keep a keep you mean to take busy.', 'A keep thinned to half its garrison sends for a column from its realm\'s nearest keep: catch it on the road.', 'Realms in common cause against a leader do not fight each other in the field while their pact holds.');
});

/* ------------------------------------------------------------------ */
/* saving: the gates being hung                                        */
/* ------------------------------------------------------------------ */
registerSavePart('world', 'war4', {
  save() {
    if (!W4.on) return undefined;
    const g = WAR.keeps.map((K) => { const q = w4GateOf(K); return q && q.st === 'mend' && !K.door.alive ? Math.round(q.t * 100) : 0; });
    return g.some(Boolean) ? { g } : undefined;
  },
  load(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.g)) return;
    WAR.keeps.forEach((K, i) => {
      const v = d.g[i], q = w4GateOf(K);
      if (!q || typeof v !== 'number' || !isFinite(v) || K.door.alive) return;
      q.t0 = clamp(v, 0, 99) / 100; // (taken up when the work begins again: w4GateStep)
    });
  },
  key: (d) => (d ? d.g.map((v) => Math.floor(v / 20)).join(',') : ''),
});

/* ------------------------------------------------------------------ */
/* out of a tower's room round its furniture                           */
/* ------------------------------------------------------------------ */
// A band's captain stood in a corner drum's store room at Dragonmere for six minutes of an hour's soak (campaign_soak.py
// `room=lv0`, order after order): making straight for its door (bandOutOfTower, 08j_war2.js) it got no nearer in 5 s,
// gave up for 15, and so on. Once it gets no nearer, it takes a way round what stands in the room (barrels, crates, a
// rack, its fellows) on a quarter-metre grid to the door's inner side, walls and gates standing (localPath); none, it
// gives up as before. B: bandOutOfTower's record
function war4RoomWayFind(e, B, inn) {
  B.w4tried = true;
  if (!W4.on) return false;
  const pts = localPath(e.x, e.z, inn.x, inn.z, 0.32, 12, true, 0.25);
  if (pts && pts.length) { B.w4p = { pts, i: 0 }; W4.stats.roomWays = (W4.stats.roomWays || 0) + 1; return true; }
  // none: penned behind its door's open leaf (it swings into the room and stands open while anyone is within 2.2 m of
  // the door, so the body it pens holds it open: an Ériu captain stood so in Ráth Brannagh's gate drum for twenty
  // minutes of a soak at medium, order after order); it puts its shoulder to the leaf and squeezes past (the leaf's
  // collider gives way a few seconds: 04l_towers.js)
  const T = B.T, D = T && (T.doors.find((d) => d.y < T.yG + 0.6) || T.doors[0]);
  if (D && D.k > 0.5 && dist2(e.x, e.z, D.x, D.z) < 3 * 3) { D.w4give = GAME.t + 4; W4.stats.leafGives = (W4.stats.leafGives || 0) + 1; return true; }
  W4.stats.roomWaysNone = (W4.stats.roomWaysNone || 0) + 1;
  return false;
}
function war4RoomWay(e, B) {
  const W = B.w4p;
  if (!W) return null;
  while (W.i < W.pts.length && dist2(e.x, e.z, W.pts[W.i].x, W.pts[W.i].z) < 0.35 * 0.35) { W.i++; B.bd = Infinity; }
  if (W.i >= W.pts.length) { B.w4p = null; return null; }
  return W.pts[W.i];
}

// A band's soldier a little up on a keep's floors (the foot of a burh's stair, a landing: 0.8 to 2.6 m) where the castle's
// ways have nothing (castleWaypoint looks only past 1.1 m, and only along the posts' routes) steps off the edge nearest
// its way (toward its leader or its band's next point, then the court, then all round): to 0.4 m short of the first place
// within 4 m that stands 0.6 m lower with nothing solid between, and down (the ladder fall's motion, unhurt so low).
// war4.py's walls scene: two captains set on Thule walks came down their stairs to a metre over the ground and stood
// there against the stair's side. From bandWallsDown (08j_war2.js), where it would give up
const _w4lj = { x: 0, z: 0 };
function war4LowJump(e, wb, L, B, C, h, dt) {
  if (!W4.on || h > 2.6) return false;
  if (!B.w4edge) {
    const g = e === L ? wb && wb.leaderGoal : L, dirs = [];
    if (g) dirs.push(Math.atan2(g.z - e.z, g.x - e.x));
    dirs.push(Math.atan2(C.S.z - e.z, C.S.x - e.x));
    for (let k = 0; k < 8; k++) dirs.push((k / 8) * TAU);
    const r = e.radius * (e.scale || 1) * 0.9;
    let E = null;
    for (const a of dirs) {
      const ux = Math.cos(a), uz = Math.sin(a);
      for (let s = 0.25; s <= 4; s += 0.25) {
        const px = e.x + ux * s, pz = e.z + uz * s;
        if (floorAt(px, pz, e.y - 0.3) < e.y - 0.6) { const k = Math.max(0, s - 0.4); E = { x: e.x + ux * k, z: e.z + uz * k, ux, uz, t: GAME.t }; break; }
        _w4lj.x = px; _w4lj.z = pz; resolveCollisions(_w4lj, r, e.y, e.faction);
        if (Math.abs(_w4lj.x - px) > 0.02 || Math.abs(_w4lj.z - pz) > 0.02) break;
      }
      if (E) break;
    }
    B.w4edge = E || { none: true };
  }
  const E = B.w4edge;
  if (E.none) return false;
  if (dist2(e.x, e.z, E.x, E.z) > 0.3 * 0.3 && GAME.t - E.t < 5) { moveToward(e, E.x, E.z, dt, 1.0, 0.05); return true; }
  B.w4edge = null;
  e.motion = { kind: 'ladder', L: BZ_FALL_L, st: 3, t: 0, vy: 1.4, y0: e.y, by: null, dx: E.ux * 2.6, dz: E.uz * 2.6, dir: 1 };
  setAct(e, 6, 1.0);
  W4.stats.lowJumps = (W4.stats.lowJumps || 0) + 1;
  return true;
}
// A band's soldier up in a tower (a room above the store, a gallery, an open top) with nothing to fight: down that tower's
// own ladders, floor by floor (the hatches open as it comes down through them), to the store room and out at its door
// (bandOutOfTower). The castle's ways (castleWaypoint) know only the posts' routes, and a top no post's route ends on (a
// back corner's) held a captain there: war4.py's walls scene found eleven of 48 raised floors such tops, 9 to 10.5 m up.
// From bandDownStep (08j_war2.js); not a member beside its leader on the same floor
function war4TowerDown(e, wb, L, R, dt) {
  if (!W4.on || e.motion || e.fixedY !== null) return false;
  if (e !== L && L && Math.abs(L.y - e.y) < 1.5 && dist2(L.x, L.z, e.x, e.z) < 30 * 30) return false;
  let Ld = null, bd = 1.0;
  for (const q of R.T.ladders) { if (q.gone) continue; const d = Math.abs(q.wyt - e.y); if (d < bd) { bd = d; Ld = q; } }
  if (!Ld) return false;
  if (e.mount) dismount(e);
  if (towerLadderStart(e, Ld, -1)) { W4.stats.towerDowns = (W4.stats.towerDowns || 0) + 1; return true; }
  moveToward(e, Ld.ox, Ld.oz, dt, 0.9, 0.25);
  return true;
}

/* ------------------------------------------------------------------ */
/* the war's thinking at its worst, measured in a running war (tests)  */
/* ------------------------------------------------------------------ */
// war4Prof(true) wraps the war's thinking (each wrapped once; a module's own binding, as perfTimers does): for each, the
// calls, the time, how many took over 5, 20 and 50 ms, and the worst call with what it was about
const W4P = { on: false, wrapped: false, f: {} };
function w4ProfWhat(name, a) {
  const e = a[0];
  if (name === 'localPath') return { from: [Math.round(a[0]), Math.round(a[1])], to: [Math.round(a[2]), Math.round(a[3])], pad: a[4], span: a[5], gates: !!a[6], cs: a[7] || 1, t: Math.round(GAME.t) };
  if (e && typeof e === 'object' && e.id !== undefined) {
    const t = getEnt(e.target), C = castleAt(e.x, e.z);
    return { role: e.role, cls: e.cls, keep: e.keep ? e.keep.site.name : C ? C.S.name : '', wall: !!(e.ai && e.ai.wall), up: +(e.y - heightAt(e.x, e.z)).toFixed(1), tgt: t ? Math.round(dist(e.x, e.z, t.x, t.z)) : null, ai: e.ai ? Object.keys(e.ai).filter((k) => e.ai[k] && typeof e.ai[k] === 'object').slice(0, 8).join(',') : '', t: Math.round(GAME.t) };
  }
  if (e && e.members) { const L = wbLeader(e); return { band: e.id, order: e.order ? e.order.type + '/' + e.order.phase : '', L: L ? [Math.round(L.x), Math.round(L.z)] : null, t: Math.round(GAME.t) }; }
  return null;
}
function war4Prof(on = true) {
  W4P.on = on;
  if (W4P.wrapped || !on) return;
  W4P.wrapped = true;
  const w = (name, f) => function (...a) {
    if (!W4P.on) return f.apply(this, a);
    const t0 = performance.now();
    try { return f.apply(this, a); } finally {
      const ms = performance.now() - t0, r = W4P.f[name] || (W4P.f[name] = { n: 0, ms: 0, max: 0, over: [0, 0, 0], worst: null });
      r.n++; r.ms += ms;
      if (ms > 5) r.over[0]++;
      if (ms > 20) r.over[1]++;
      if (ms > 50) r.over[2]++;
      if (ms > r.max) { r.max = ms; r.worst = w4ProfWhat(name, a); }
    }
  };
  thinkPosted = w('thinkPosted', thinkPosted); thinkSoldier = w('thinkSoldier', thinkSoldier); localPath = w('localPath', localPath);
  pickTarget = w('pickTarget', pickTarget); wallsSeekLine = w('wallsSeekLine', wallsSeekLine); wallsStepToCrenel = w('wallsStepToCrenel', wallsStepToCrenel);
  castleFollow = w('castleFollow', castleFollow); blazeFightStep = w('blazeFightStep', blazeFightStep); siegePostedThink = w('siegePostedThink', siegePostedThink);
  npcAbilities = w('npcAbilities', npcAbilities); wallsShotClear = w('wallsShotClear', wallsShotClear); bandLeaderDetour = w('bandLeaderDetour', bandLeaderDetour);
  fightTarget = w('fightTarget', fightTarget); updateWarband = w('updateWarband', updateWarband); autoAttack = w('autoAttack', autoAttack);
  updateWar = w('updateWar', updateWar); updateNPCs = w('updateNPCs', updateNPCs); updateCastles = w('updateCastles', updateCastles);
  simStep = w('simStep', simStep);
}
function war4ProfOut(reset) {
  const out = Object.entries(W4P.f).map(([k, r]) => ({ k, n: r.n, ms: +r.ms.toFixed(1), each: +(r.ms / Math.max(1, r.n)).toFixed(3), max: +r.max.toFixed(1), over5: r.over[0], over20: r.over[1], over50: r.over[2], worst: r.worst })).sort((a, b) => b.max - a.max);
  if (reset) W4P.f = {};
  return out;
}

/* ------------------------------------------------------------------ */
/* test hooks                                                          */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.war4 = { W4, W4P, war4Prof, war4ProfOut, setDoorState, war4Allied, w4Foe, war4SallyPays, war4SallyParty, war4ColumnFrom, w4ReliefStep, war4Trickle, w4GateOf, w4GateStep, w4GateScaffoldGeo, war4GateMends, war4HandBack, w4PeaceColumns, war4ColumnsHome, war4MayWin, war4Left, updateWar4, war4Reset, w4PactStep, w4GatePlug, w4Underside, war4RoomWayFind, war4RoomWay, war4LowJump, war4TowerDown,
    collNear: (x, z, r) => { const a = []; collidersNear(x, z, r, a); return a; },
    floorsAt: (x, z) => { const l = FLOOR.grid.get(collKey(Math.floor(x / FLOOR.cell), Math.floor(z / FLOOR.cell))) || []; return l.filter((f) => f.active).map((f) => ({ tag: f.tag, type: f.type, top: floorTopOf(f, x, z), y0: f.y0 })); },
    gate: (ki) => { const K = WAR.keeps[ki], g = w4GateOf(K); return g ? { st: g.st, t: +g.t.toFixed(3), laid: g.laid, scaf: !!g.scaffold, on: !!(g.l3 && g.l3.on), ladders: g.l3 ? g.l3.ladders.length : 0, floors: g.l3 ? g.l3.floors.length : 0, info: g.scafInfo ? g.scafInfo.map((q) => ({ standards: q.standards, bays: q.bays, boards: q.boards, ladders: q.ladders })) : null, door: K.door.alive, hp: +(K.door.hp / K.door.maxHp).toFixed(2), leafY: +g.G0.leaves[0].scale.y.toFixed(2), leafVis: g.G0.leaves[0].visible, open: +g.G0.open.toFixed(2), masons: (g.masonsFor || []).length } : null; } };
});
