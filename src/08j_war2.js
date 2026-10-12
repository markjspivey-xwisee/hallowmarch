/* ================================================================== */
/* [war2] a war that keeps moving                                      */
/* ================================================================== */
// Measured over whole campaigns (tools/campaign_soak.py looks at every band every 2 s of game time): the bands that stood
// still did so for a few causes, each fixed here at its root so a band always either gets nearer where it is going or
// fights.
//  - A soldier that climbed onto a castle's walk after a foe (castleClimbToward) stayed up there once the foe was gone:
//    a leader on a walk, mounted even, walked against the parapet toward its next waypoint for the rest of the war
//    (several minutes, then the 150 s watchdog gave its order back, and the next order stood there the same way).
//    bandDownStep (from thinkSoldier) takes it down by the castle's ways (castleWaypoint), as the garrison's own go down.
//  - An engine whose crew could not reach their places (a tree, a rock, a crowd) never rolled or rose: its band waited by
//    it for good. An engine that gets no nearer its place, or no further built, for a while is settled where it stands
//    or given up (siegeEngineGuard, from siegeEngineStep).
//  - A band whose engine was at work in the 'siege' phase (a band near the gate first, the engine planned after) was
//    counted as standing still by the watchdog and its order given back, abandoning the engine mid-work: an engine at
//    work is the band's progress (warbandEngineBusy, from updateWarband).
// The shared files only call in, each line marked [war2]: 08_ai.js (thinkSoldier, updateWarband), 04h_siege.js
// (siegeEngineStep).

const WAR2 = { stats: { down: 0, engineSettled: 0, engineGivenUp: 0 } };

/* ------------------------------------------------------------------ */
/* off the walls                                                       */
/* ------------------------------------------------------------------ */
// a band's soldier up on a keep's walk, stair, tower or gate walk with nothing to fight goes down to the court by the
// castle's ways (the posts' routes: stairs, towers' ladders and hatches); true while it does. Not a member keeping its
// place beside a leader on the same floor, nor one storming a breach (the rubble is its floor).
function bandDownStep(e, wb, L, O, dt) {
  if (e.fixedY !== null || e.motion || e.carrying != null) return false;
  if (O && O.phase === 'breach') return false;
  // in a tower's ground room (walked in at its door after a foe, or on the way across the court): out at its door
  const R = TOWER.list.length ? towerRoomOf(e) : null;
  if (R && R.lv === 0 && !(e !== L && L && towerRoomOf(L) && towerRoomOf(L).T === R.T)) return bandOutOfTower(e, R.T, dt);
  if (e.ai.out) { e.ai.out = null; if (e === L) wb.goal = -1; } // out: the leader's way planned again from here (wbPlan)
  let B = e.ai.down;
  const C = castleAt(e.x, e.z);
  if (!C || !C.posts.length || !C.S.keepRef) { if (B) e.ai.down = null; return false; }
  // height over the court (or the ground outside, where it is higher): a keep's court may stand on a terrace
  const h = e.y - Math.max(heightAt(e.x, e.z), C.S.y);
  if (B && (h < 0.7 || GAME.t - B.t > 60)) { e.ai.down = null; if (e === L) wb.goal = -1; return false; } // down (or long enough: the band's own ways from here)
  if (!B && h < 2.0) return false;
  if (e !== L && L && Math.abs(L.y - e.y) < 1.5 && dist2(L.x, L.z, e.x, e.z) < 30 * 30) return false;
  if (!B) { B = e.ai.down = { t: GAME.t, ri: -1 }; WAR2.stats.down++; }
  if (e.mount) dismount(e);
  let wp = castleWaypoint(e, { x: C.S.x, y: C.S.y, z: C.S.z });
  if (wp && e.ai.climb) B.ri = e.ai.climb.ri;
  if (!wp) {
    // the last steps (castleWaypoint has no way within a step or two of the ground, nor out on a walk's outer edge): down
    // the way it was on, point by point, to its foot in the court
    const Rt = B.ri >= 0 ? castleRoute(C.S.keepRef, B.ri) : null;
    if (!Rt) { e.ai.down = null; return false; }
    let j = -1, jd = Infinity;
    Rt.forEach((q, i) => { if (q.ladder || Math.abs(q.y - e.y) > 1.0) return; const d = dist2(q.x, q.z, e.x, e.z); if (d < jd) { jd = d; j = i; } });
    if (j < 0) { e.ai.down = null; return false; }
    if (dist2(e.x, e.z, Rt[j].x, Rt[j].z) < 0.45 * 0.45) j--;
    if (j < 0) { e.ai.down = null; return false; }
    wp = Rt[j];
  }
  if (wp.ladder && wp.ladder.gone) { e.ai.down = null; return false; }
  if (wp.ladder && towerLadderStart(e, wp.ladder, wp.y > e.y + 1 ? 1 : wp.y < e.y - 1 ? -1 : 0)) return true;
  if (wp.ladder && Math.abs(wp.y - e.y) > 1) { const Ld = wp.ladder, up = wp.y > e.y; moveToward(e, up ? Ld.fx : Ld.ox, up ? Ld.fz : Ld.oz, dt, 1.0, 0.05); return true; }
  moveToward(e, wp.x, wp.z, dt, 1.0, 0.05);
  return true;
}
// out of a tower's ground room by its courtyard door: to the door from inside, then a pace out through it
function bandOutOfTower(e, T, dt) {
  const D = T.doors.find((d) => d.y < T.yG + 0.6) || T.doors[0];
  if (!D) return false;
  const inn = twW(T, D.a, T.RI - 0.45, D.off), out = twW(T, D.a, T.RO + 1.2, D.off);
  const B = e.ai.out && e.ai.out.T === T ? e.ai.out : (e.ai.out = { T, past: false, t: GAME.t });
  if (B.t === GAME.t) WAR2.stats.out = (WAR2.stats.out || 0) + 1;
  if (e.mount) dismount(e);
  if (!B.past && dist(e.x, e.z, inn.x, inn.z) < 0.5) B.past = true;
  const q = B.past ? out : inn;
  moveToward(e, q.x, q.z, dt, 1.0, 0.1);
  return true;
}

// where a band's way starts (wbPlan): inside a keep's or a temple's walls, at its court, so the way goes out by its gate.
// The nearest node in sight was taken before, and from inside the walls that was often one outside them, seen over a
// low stretch or through a gap the colliders leave: the leader walked into the wall toward it for good.
function bandStartNode(L) {
  if (!L || L.x > DUN_X0) return null;
  for (const K of WAR.keeps) { const C = castleOf(K.site); if (C && dist2(L.x, L.z, K.site.x, K.site.z) < 26 * 26 && castleInside(C, L.x, L.z)) return K.nav.court; }
  for (const T of WAR.temples) { const C = castleOf(T.site); if (C && dist2(L.x, L.z, T.site.x, T.site.z) < 20 * 20 && castleInside(C, L.x, L.z)) return T.nav.tc; }
  return null;
}

/* ------------------------------------------------------------------ */
/* engines that cannot get on                                          */
/* ------------------------------------------------------------------ */
// from siegeEngineStep while an engine is being built or rolled to its place: one that gets no nearer its place for 25 s
// (its crew cannot reach their places to push, or a tree stands in its way) is settled where it stands, if its mark is
// within a long shot from there (a stone's lob is aimed to land wherever its mark is), else given up; one that rises no
// further for 45 s while it has a crew is given up (its band goes on to the gate)
function siegeEngineGuard(E, dt) {
  const g = E.w2 || (E.w2 = { st: E.state, best: Infinity, t: GAME.t });
  if (g.st !== E.state) { g.st = E.state; g.best = Infinity; g.t = GAME.t; }
  if (E.state === 'build') {
    if (!E.crew.length && !E.player) { g.t = GAME.t; return false; } // (nobody to build it: the engine's own idle rule)
    if (E.build > g.best + 0.01 || g.best === Infinity) { g.best = E.build; g.t = GAME.t; return false; }
    if (GAME.t - g.t > 45 && !E.player) { WAR2.stats.engineGivenUp++; siegeReleaseCrew(E); siegeDismantle(E); return true; }
    return false;
  }
  if (E.state !== 'move') return false;
  const d = dist(E.x, E.z, E.work.x, E.work.z);
  if (d < g.best - 0.5) { g.best = d; g.t = GAME.t; return false; }
  if (GAME.t - g.t < 25 || E.player) return false;
  const aim = E.target && E.target.W ? siegeFace(E.target.W) : E.target && E.target.C ? siegeGatePoint(E.target.C.S) : null;
  const reach = (E.spec.range || 0) * 1.6 + 12;
  if (aim && E.kind !== 'ram' && dist(E.x, E.z, aim.x, aim.z) < reach) { E.work = { x: E.x, z: E.z }; WAR2.stats.engineSettled++; return false; }
  WAR2.stats.engineGivenUp++; siegeReleaseCrew(E); siegeDismantle(E);
  return true;
}
// is this band's own engine at work, rolling on or rising? (the watchdog counts it as the band's progress)
function warbandEngineBusy(wb, O) {
  if (!O || !O.siegeE) return false;
  const E = siegeById(O.siegeE);
  if (!E || !siegeActive(E) || E.wb !== wb) return false;
  if (E.state === 'work') return E.crew.length > 0 || !!E.player;
  const g = E.w2;
  return (E.state === 'build' || E.state === 'move') && !!g && GAME.t - g.t < 20;
}

/* ------------------------------------------------------------------ */
/* townsfolk fight their houses' fires                                 */
/* ------------------------------------------------------------------ */
// A house afire used to burn down while its people stood and watched. Now its people, and their neighbours within call,
// run to it (five at most), each to a place under the eaves nearest the fire's front, and beat the flames down there
// (body action 21, as the garrisons beat out their walls): every beater pushes the burning front back, the flames beyond
// it go out, and a fire beaten back to nothing is out (houseQuench): the house stands, blackened under its eaves for a
// few minutes. A fire that has taken the whole roof (its fall begun) is past saving: they stand back and watch it come
// down, then build again as before. Rain helps them. Calls in: 04e_houses.js (houseBurnStep), 08f_townlife.js
// (houseLife, houseFlee, lifeRun's 'beat' step).
const HCREW = { max: 5, k: 0.12, call: 45, scan: 1.2 };
WAR2.stats.houseCrews = 0; WAR2.stats.houseBeats = 0; WAR2.stats.housesSaved = 0; WAR2.stats.housesLost = 0;
// a villager near a burning house that wants hands (its crew not full) goes to it: from houseLife, once a while
function houseCrewCall(e) {
  const ai = e.ai;
  if (GAME.t < (ai.crewScan || 0)) return;
  ai.crewScan = GAME.t + HCREW.scan + Math.random() * 0.6;
  if (ai.fisher || (ai.plan && ai.plan.flee)) return;
  let F = null, bd = HCREW.call * HCREW.call;
  for (const H of HOUSES) {
    if (H.state !== 'burning' || !H.burn || H.burn.fallAt || H.keepHall) continue;
    const d = dist2(e.x, e.z, H.x, H.z);
    if (d < bd && (!H.w2crew || H.w2crew.size < HCREW.max)) { bd = d; F = H; }
  }
  if (!F) return;
  e.seat = null;
  const steps = [];
  if (ai.house && houseHas(ai.house, e.x, e.z, -0.6) && houseIntact(ai.house)) { const H = ai.house, D = H.door; steps.push(houseGo(D.in.x, D.in.z, { run: true, room: H, exact: true }), lifeStep('door', { open: true }), houseGo(D.c.x, D.c.z, { run: true, loose: true, via: H }), houseGo(D.out2.x, D.out2.z, { run: true, loose: true, via: H })); }
  steps.push(lifeStep('beat', { H: F }));
  lifePlan(e, steps, { flee: F });
  ai.lifeWait = 0;
}
// places to beat from: round the house 1.3 m outside its walls, the nearest the fire's front first, each one free
function houseCrewSpots(H) {
  const B = H.burn, out = [];
  if (H.round) {
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU, r = H.r + 1.3; out.push(houseW(H, Math.sin(a) * r, Math.cos(a) * r)); }
  } else {
    const hw = H.w / 2 + 1.3, hd = H.d / 2 + 1.3;
    for (const u of [-0.75, -0.25, 0.25, 0.75]) out.push(houseW(H, u * hw, hd), houseW(H, u * hw, -hd));
    for (const v of [-0.6, 0, 0.6]) { out.push(houseW(H, hw, v * hd), houseW(H, -hw, v * hd)); }
  }
  const ok = out.filter((p) => isWalkable(p.x, p.z) && !houseAt(p.x, p.z, 0.4) && !deepWaterAt(p.x, p.z));
  ok.sort((a, b) => dist2(a.x, a.z, B.x, B.z) - dist2(b.x, b.z, B.x, B.z));
  return ok;
}
// a villager's 'beat' step (lifeRun): to its place by the fire, then beat until the fire is out or past saving
function houseBeatStep(e, st, plan, dt, next) {
  const H = st.H, ai = e.ai, B = H.burn;
  const crew = H.w2crew || (H.w2crew = new Map());
  if (H.state !== 'burning' || !B || B.fallAt) {
    // out, or past saving: stand back from it and watch, then on with the day
    crew.delete(e.id);
    if (e.anim.act === 21) e.anim.actT = e.anim.actDur;
    const d = dist(e.x, e.z, H.x, H.z);
    if (H.state === 'burning' && d < H.foot + 6) moveToward(e, H.x + ((e.x - H.x) / (d || 1)) * (H.foot + 9), H.z + ((e.z - H.z) / (d || 1)) * (H.foot + 9), dt, 1.4, 0.5);
    else turnToward(e, H.x, H.z, dt * 3);
    st.endT = st.endT ?? plan.t;
    if (H.state !== 'burning' && plan.t - st.endT > 4) { ai.plan = null; ai.lifeWait = GAME.t + 2 + Math.random() * 5; ai.lifeIdle = false; }
    return true;
  }
  if (!crew.has(e.id)) {
    if (crew.size >= HCREW.max) { turnToward(e, H.x, H.z, dt * 3); return true; } // enough hands: it watches
    crew.set(e.id, { beat: -1, seen: GAME.t, k: crew.size });
    WAR2.stats.houseCrews++;
  }
  const c = crew.get(e.id);
  c.seen = GAME.t;
  if (!st.spot || plan.t > (st.spotT || 0)) {
    const spots = houseCrewSpots(H);
    st.spot = spots.length ? spots[Math.min(spots.length - 1, c.k)] : { x: H.door.out2.x, z: H.door.out2.z };
    st.spotT = plan.t + 6;
    st.best = Infinity; st.bestT = plan.t;
  }
  const d = dist(e.x, e.z, st.spot.x, st.spot.z);
  if (d > 0.8) {
    c.beat = -1;
    if (d < st.best - 0.3) { st.best = d; st.bestT = plan.t; }
    else if (plan.t - st.bestT > 2.5) { c.k = (c.k + 1) % 8; st.spotT = 0; } // something in the way: the next place round
    moveToward(e, st.spot.x, st.spot.z, dt, 1.6, 0.5);
    return true;
  }
  // at it: beat the flames (the fire's front over its start, under the eaves)
  const l = houseL(H, B.x, B.z), q = houseW(H, clamp(l.x, -H.w / 2, H.w / 2) || 0, clamp(l.z, -H.d / 2, H.d / 2) || 0);
  turnToward(e, H.round ? H.x : q.x, H.round ? H.z : q.z, dt * 8);
  if (e.anim.act !== 21 || e.anim.actT >= e.anim.actDur * 0.95) setAct(e, 21, 1.1);
  c.beat = GAME.t;
  return true;
}
// each step of a house's fire (houseBurnStep, once it has grown): its beaters push the front back; true when it is out
function houseCrewDouse(H, B, dt) {
  const crew = H.w2crew;
  if (!crew || !crew.size || B.fallAt) return false;
  let n = 0;
  for (const [id, c] of crew) {
    const e = getEnt(id);
    if (!e || !e.alive || GAME.t - c.seen > 2) { crew.delete(id); continue; }
    if (c.beat > 0 && GAME.t - c.beat < 0.5) n++;
  }
  if (!n) return false;
  B.R = Math.max(0, B.R - n * HCREW.k * dt * (1 + 0.5 * clamp(WEATHER.raining || 0, 0, 1)));
  WAR2.stats.houseBeats += n * dt;
  for (const p of B.pts) if (p.fire && dist(p.x, p.z, B.x, B.z) > B.R + 0.35) { houseFireOut(p.fire); p.fire = null; }
  if (B.R < 0.3) { houseQuench(H); return true; }
  return false;
}
// beaten out: the house stands, its walls black under the eaves for a while (updateWar2 fades it)
function houseQuench(H) {
  const B = H.burn;
  if (B) for (const p of B.pts) if (p.fire) { houseFireOut(p.fire); p.fire = null; }
  H.state = 'whole'; H.stT = 0; H.fall = 0; H.burn = null; H.ember = 0;
  H.char = Math.min(0.5, H.char + 0.08); H.w2scorch = true;
  H.w2crew = null;
  WAR2.stats.housesSaved++;
  const P = GAME.player;
  if (P && dist2(P.x, P.z, H.x, H.z) < 90 * 90) uiLog(`The people of ${H.S.name} have beaten out the fire.`, 'sys');
}

/* ------------------------------------------------------------------ */
/* members that cannot follow the leader's footsteps                   */
/* ------------------------------------------------------------------ */
// thinkSoldier walks a member whose line to its leader is blocked along the leader's footsteps (followTrail), which
// always went on, even when the footstep it chose could not be reached from where it stood: pressed against a fallen
// gate tower's rubble it stood there while its band went in by the gate (siege2.py's stormall, 57 s). One that gets no
// nearer along them for 3 s leaves them for 6 s, so its own way round (bandUnstick) can act.
function bandTrailStep(e, wb, dt) {
  const ai = e.ai;
  if (GAME.t < (ai.trailBan || 0)) return false;
  const p = ai.trailProg || (ai.trailProg = { x: e.x, z: e.z, t: GAME.t });
  if (dist2(e.x, e.z, p.x, p.z) > 0.6 * 0.6) { p.x = e.x; p.z = e.z; p.t = GAME.t; }
  else if (GAME.t - p.t > 3) { ai.trailBan = GAME.t + 6; ai.trailAbs = undefined; p.t = GAME.t; WAR2.stats.trailBans = (WAR2.stats.trailBans || 0) + 1; return false; }
  return followTrail(e, wb, dt);
}
// a firefighter (or a guard) on its way back down to its post's floor that gets no lower and no nearer for 4 s (part way
// down a burh's stair, its way point on the far side of a landing) forgets the way it chose, so the next look takes
// another (castleWaypoint keeps to a way for 12 s); from blazeBackStep
function backStepUnstick(e, B) {
  const q = e.y + Math.hypot(e.x - (B.wp ? B.wp.x : e.x), e.z - (B.wp ? B.wp.z : e.z)) * 0.3;
  if (B.w2best === undefined || q < B.w2best - 0.25) { B.w2best = q; B.w2t = GAME.t; return; }
  if (GAME.t - B.w2t > 4) { e.ai.climb = null; B.w2best = undefined; B.w2n = (B.w2n || 0) + 1; WAR2.stats.backResets = (WAR2.stats.backResets || 0) + 1; }
}

/* ------------------------------------------------------------------ */
/* broken gates are kept with the world                                */
/* ------------------------------------------------------------------ */
// A broken gate (rammed, battered or burnt down) came back whole on loading. The world now keeps each broken gate of a
// keep or a temple with the seconds until its owners may hang a new one, and whether it burnt (its charred wreck).
registerSavePart('world', 'gates', {
  save() {
    const out = [];
    const one = (D, kind, i) => {
      if (!D || D.alive) return;
      const G0 = castleOf(D.keepRef ? D.keepRef.site : D.templeRef.site)?.gate;
      out.push([kind, i, G0 && G0.bz && G0.bz.down ? 1 : 0, Math.round(clamp(GAME.t - (D.deadAt ?? GAME.t), 0, 600))]);
    };
    WAR.keeps.forEach((K, i) => one(K.door, 0, i));
    WAR.temples.forEach((T, i) => one(T.door, 1, i));
    return out.length ? out : undefined;
  },
  load(d) {
    if (!Array.isArray(d)) return;
    for (const q of d.slice(0, 9)) {
      if (!Array.isArray(q)) continue;
      const ref = (q[0] | 0) === 1 ? WAR.temples[q[1] | 0] : WAR.keeps[q[1] | 0];
      if (!ref || !ref.door) continue;
      const age = clamp(+q[3] || 0, 0, 600), D = ref.door;
      setDoorState(D, false);
      D.deadAt = GAME.t - age;
      const S = ref.site;
      if (S.door) S.door.active = false;
      const C = castleOf(S), G0 = C && C.gate;
      if (q[2] && G0) {
        // burnt down: its wreck lies charred, its embers out
        if (typeof blazeInit === 'function') blazeInit();
        if (G0.bz) {
          const Z = G0.bz;
          Z.down = true; Z.char = 1;
          if (!Z.wmat) Z.wmat = shareMat(siegeMat, { uFlash: buildingMat.uniforms.uFlash, uChar: { value: 1 }, uEmber: { value: 0 } });
          Z.wmat.uniforms.uEmber.value = 0;
          G0.wreck.material = Z.wmat;
        }
      }
    }
  },
  key(d) { return d ? d.map((q) => q.slice(0, 3).join(':')).join(',') : ''; },
});

/* ------------------------------------------------------------------ */
/* every step                                                          */
/* ------------------------------------------------------------------ */
function updateWar2(dt) {
  // a house saved from the fire: its scorch is scrubbed off over a few minutes
  for (const H of HOUSES) if (H.w2scorch) { if (H.state !== 'whole') H.w2scorch = false; else { H.char = Math.max(0, H.char - dt / 240); if (H.char <= 0) H.w2scorch = false; } }
}

queueMicrotask(() => { if (window.__hm) window.__hm.war2 = { WAR2, HCREW, bandDownStep, siegeEngineGuard, warbandEngineBusy, houseCrewCall, houseCrewSpots, houseQuench }; });
