/* ================================================================== */
/* [siege2] the siege that uses everything the walls can do            */
/* ================================================================== */
// The commanders' engines may take a tower for their mark when it is the weaker way in (siegeMarkScore: what is left
// of it, how far its face is from the band, a tower's narrow way in weighed against it), and a band storms a fallen
// tower: each member walks the way in itself (siegeStormStep, from thinkSoldier), over the rubble, through the store
// room and out at its courtyard door, one or two at a time through the narrow part (the rest wait their turn on the
// field before it: siegeStormTurn), fighting only what meets it there on its own level and leaving the foes up on the
// walls for later; through the door it holds the court by it until the band is in. The garrison plugs the court before
// the door as it plugs a fallen curtain (towerPlugAt). The shared files only call in, each line marked [siege2]:
//   04h_siege.js   siegePlanFor, siegeRetarget -> siegeMarkScore · siegeOpenBreach takes towers · siegeBandAfter -> siegeStormBand
//   08_ai.js       thinkSoldier -> siegeStormStep

const SIEGE2 = { stats: { towerMarks: 0, curtainMarks: 0, storms: 0, through: 0, stormFails: 0, waits: 0, sidesteps: 0 } };
// a tower's way in is one body wide at its courtyard door: it is chosen over a curtain only when cracked or much nearer
const SIEGE2_TOWER_K = 1.3;
// how many of a band go through the narrow part at once, and how close behind one another
const STORM_IN = 2, STORM_GAP = 1.3;
// how near each point of the way in a body must come (the field before it, the rubble's foot, the store room, inside
// the door, outside it, the court)
const STORM_R = [2.2, 0.9, 0.85, 0.7, 1.1, 2.6];

/* ------------------------------------------------------------------ */
/* the engines' mark                                                   */
/* ------------------------------------------------------------------ */
// can a band storm this tower once it falls? the field before its fallen face must be walkable and open
function siegeTowerWayOk(W) {
  if (W.wayOk !== undefined) return W.wayOk;
  const Rt = siegeStormRoute(W);
  let ok = isWalkable(Rt[0].x, Rt[0].z) && isWalkable(Rt[1].x, Rt[1].z) && Math.abs(Rt[0].y - Rt[1].y) < 2.2;
  // nothing but the tower's own masonry between the field and the rubble's foot
  if (ok) {
    const own = new Set(W.T.colls);
    collidersNear((Rt[0].x + Rt[1].x) / 2, (Rt[0].z + Rt[1].z) / 2, dist(Rt[0].x, Rt[0].z, Rt[1].x, Rt[1].z) / 2 + 1, _s2c);
    for (const c of _s2c) {
      if (!c.active || own.has(c) || c.tag === 'tree' || (c.vert && c.y0 > Rt[1].y + 1.8)) continue;
      if (siegeSegHits(c, Rt[0].x, Rt[0].z, Rt[1].x, Rt[1].z, 0.35)) { ok = false; break; }
    }
  }
  W.wayOk = ok;
  return ok;
}
const _s2c = [];
function siegeSegHits(c, ax, az, bx, bz, pad) {
  const n = Math.max(2, Math.ceil(dist(ax, az, bx, bz) / 0.5));
  for (let k = 0; k <= n; k++) {
    const x = lerp(ax, bx, k / n), z = lerp(az, bz, k / n);
    if (c.type === 'circle') { if (dist2(x, z, c.x, c.z) < (c.r + pad) ** 2) return true; continue; }
    const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad) return true;
  }
  return false;
}
// how weak a way in a whole section is from (x, z): what is left of it in curtains (a tower stands a quarter longer),
// its narrow way in (a tower), and how far its face lies; lower is weaker
function siegeMarkScore(W, x, z, jitter = 0) {
  if (W.state !== 'whole') return Infinity;
  if (W.kind === 'tower' && !siegeTowerWayOk(W)) return Infinity;
  const left = (W.maxHp ? clamp(W.hp / W.maxHp, 0, 1) : 1) * (W.hpK || 1);
  const f = siegeFace(W);
  return left * (W.kind === 'tower' ? SIEGE2_TOWER_K : 1) + dist(x, z, f.x, f.z) / 45 + jitter * Math.random();
}
// the sections of a castle by how weak a way in each is from (x, z), weakest first
function siegeMarks(C, x, z, jitter = 0.25) {
  return (C.sections || []).map((W) => ({ W, s: siegeMarkScore(W, x, z, jitter) })).filter((q) => q.s < Infinity).sort((a, b) => a.s - b.s).map((q) => q.W);
}

/* ------------------------------------------------------------------ */
/* storming a fallen tower                                             */
/* ------------------------------------------------------------------ */
// the way in (towerBreachRoute) with the height of the floor at each point
function siegeStormRoute(W) {
  if (W.stormRt) return W.stormRt;
  const Rt = towerBreachRoute(W), S = W.T.S;
  W.stormRt = Rt.map((p) => ({ x: p.x, z: p.z, y: heightAt(p.x, p.z) }));
  // the court point lies inside the walls, in the open: nudged off any collider it stands in
  const q = W.stormRt[W.stormRt.length - 1];
  q.y = S.y;
  return W.stormRt;
}
// each warband update while a band storms a fallen tower (siegeBandAfter): every member walks the way in itself
function siegeStormBand(wb, L, O, W) {
  const ms = wbMembers(wb);
  let moved = false;
  for (const m of ms) {
    if (m.siegeCrew || m.carrying != null) continue;
    const s = m.ai.storm;
    if (!s || s.W !== W) { m.ai.storm = { W, i: 0, best: Infinity, bestT: GAME.t, go: false, done: false, lead: m === L }; if (!O.stormed) { O.stormed = true; SIEGE2.stats.storms++; } continue; }
    s.lead = m === L;
    if (GAME.t - s.bestT < 3 || s.done) moved = true;
  }
  // the band is getting somewhere while any of it is: the give-up (20 s without coming nearer) watches them all
  if (moved && O.bprog) O.bprog.t = GAME.t;
}
// may this member go on into the narrow part now? (one or two at a time, a pace behind one another; the leader first)
function siegeStormTurn(e, s, Rt) {
  if (s.go) return true;
  const wb = e.warband, p1 = Rt[1];
  let inside = 0, ahead = 0, close = false;
  const myD = dist(e.x, e.z, p1.x, p1.z);
  for (const id of wb.members) {
    const o = getEnt(id);
    if (!o || o === e || !o.alive || !o.ai) continue;
    const q = o.ai.storm;
    if (!q || q.W !== s.W || q.done) continue;
    // in the narrow part: on its way onto the rubble, on it, in the store room or in the doorway (one already out in the
    // court before the door, fighting there, is no longer in the way)
    if ((q.i === 1 && q.go && (o.target == null || dist2(o.x, o.z, p1.x, p1.z) < 3.5 * 3.5)) || q.i === 2 || q.i === 3 || (q.i === 4 && dist2(o.x, o.z, s.W.T.wx, s.W.T.wz) < (s.W.T.RO + 0.4) ** 2)) { // [siege3] one let go but fighting out on the field is not in the narrow part (it held the rest back for good)
      inside++;
      if (dist2(o.x, o.z, p1.x, p1.z) < STORM_GAP * STORM_GAP) close = true;
    } else if (q.i <= 1 && !q.go) {
      // waiting too: the leader goes first, then whoever is nearest the rubble's foot
      const od = dist(o.x, o.z, p1.x, p1.z);
      if ((q.lead && q.i === 1) || (!s.lead && od < myD - 0.05)) ahead++; // [siege3] a leader still on its way (or fighting off the field) holds nobody back (04i_siege3.js)
    }
  }
  // [siege3] nobody let go for 12 s while this one waits (a body the count still holds inside is dead to the storm: stuck,
  // or fighting where the count cannot see): the nearest goes anyway (04i_siege3.js)
  s.waitT = s.waitT || GAME.t;
  const stale = GAME.t - Math.max(s.W.lastGo || 0, s.waitT) > 12 && !close && !ahead;
  if (!stale && (inside >= STORM_IN + (s.W.holding > GAME.t ? 1 : 0) || close || (ahead > 0 && !s.lead))) return false; // [siege3] a third while the first gather inside the door (04i_siege3.js)
  s.go = true; s.W.lastGo = GAME.t; // [siege3]
  return true;
}
// where a member waits its turn: on the field before the rubble, in rows of three behind the way in
function siegeStormWaitSpot(e, s, Rt) {
  const wb = e.warband, p0 = Rt[0], p1 = Rt[1];
  let rank = 0;
  const myD = dist(e.x, e.z, p1.x, p1.z);
  for (const id of wb.members) {
    const o = getEnt(id);
    if (!o || o === e || !o.alive || !o.ai || !o.ai.storm || o.ai.storm.W !== s.W || o.ai.storm.done || o.ai.storm.go || o.ai.storm.i > 1) continue;
    if (dist(o.x, o.z, p1.x, p1.z) < myD) rank++;
  }
  const ox = p0.x - p1.x, oz = p0.z - p1.z, d = Math.hypot(ox, oz) || 1, ux = ox / d, uz = oz / d;
  const col = (rank % 3) - 1, row = Math.floor(rank / 3);
  return { x: p0.x - uz * col * 1.7 + ux * row * 1.7, z: p0.z + ux * col * 1.7 + uz * row * 1.7 };
}
// fight what meets it on its own level, close by (the garrison before the door, a guard in the store room); never the
// foes up on the walls above it: those are for later. True if it fought
function siegeStormFight(e, s, dt) {
  const R = e.rangedKind ? (s.i >= 2 ? 16 : 22) : s.i >= 2 ? 3.6 : 6;
  const ok = (o) => o && o.alive && o.kind !== 'door' && isActor(o) && isEnemy(e, o) && o.fixedY === null && Math.abs(o.y - e.y) < 1.8 && dist2(o.x, o.z, e.x, e.z) < R * R && inSight(e, o);
  let t = getEnt(e.target);
  if (!ok(t)) {
    t = null; e.target = null;
    if (GAME.t > (s.scan || 0)) {
      s.scan = GAME.t + 0.35 + Math.random() * 0.2;
      let bd = Infinity;
      forNear(e.x, e.z, R, (o, d2) => { if (d2 < bd && ok(o) && canReach(e, o)) { bd = d2; t = o; } });
      if (t && e.rangedKind && !wallsShotClear(e, t, e.rangedKind === 'arrow', false)) t = null;
    }
  }
  if (e.cls === 'priest' || t) npcAbilities(e, t && t.alive ? t : null);
  if (!t) return false;
  if (e.mount) dismount(e);
  fightTarget(e, t, dt);
  return true;
}
// a storming member's step (thinkSoldier): true while the storm has the body
function siegeStormStep(e, dt) {
  const s = e.ai.storm, wb = e.warband, O = wb && wb.order;
  if (!O || O.phase !== 'breach' || O.breach !== s.W || s.W.state !== 'breach' || e.carrying != null || e.siegeCrew) { e.ai.storm = null; return false; }
  const W = s.W, Rt = siegeStormRoute(W);
  if (e.mount) dismount(e);
  if (s.done) {
    // through: it fights as the band fights; with nobody to fight it holds the court before the door while the rest
    // come through (rather than going back out to its place in the band's ranks)
    const t = getEnt(e.target);
    if (t && t.alive && isEnemy(e, t)) return false;
    if (GAME.t > (s.scan || 0)) { s.scan = GAME.t + 0.4; const o = pickTarget(e, e.rangedKind ? 26 : 18); if (o) { e.target = o.id; return false; } }
    if (e.cls === 'priest') npcAbilities(e, null);
    const q = Rt[Rt.length - 1], k = (wb.members.indexOf(e.id) % 6) - 2.5;
    moveToward(e, q.x + k * 1.2, q.z - k * 0.6, dt, 0.8, 0.8);
    return true;
  }
  if (siegeStormFight(e, s, dt)) return true;
  // waiting for its turn at the narrow part
  if (s.i <= 1 && !(s.i === 1 && siegeStormTurn(e, s, Rt))) {
    if (s.i === 0) {
      const p0 = Rt[0], d0 = dist(e.x, e.z, p0.x, p0.z);
      if (d0 < STORM_R[0] + 3) s.i = 1;
      else {
        // still on its way to the field before the tower: along the leader's footsteps when a wall is in the way
        if (GAME.t > (s.los || 0)) { s.los = GAME.t + 0.6; s.blocked = !segmentClear(e.x, e.z, p0.x, p0.z, 0.3, false); }
        if (s.blocked && wb.trail && wb.trail.length > 1 && followTrail(e, wb, dt)) return true;
        moveToward(e, p0.x, p0.z, dt, 1.05, 0.5);
        return true;
      }
    }
    if (!s.go) {
      const w = siegeStormWaitSpot(e, s, Rt);
      SIEGE2.stats.waits += dt;
      moveToward(e, w.x, w.z, dt, 0.8, 0.45);
      if (dist(e.x, e.z, w.x, w.z) < 0.6) turnToward(e, Rt[1].x, Rt[1].z, dt * 4);
      s.bestT = GAME.t;
      return true;
    }
  }
  if (siegeStormHold(e, s, Rt, dt)) return true; // [siege3] inside the door, waiting for the others before going out (04i_siege3.js)
  const p = Rt[s.i], d = dist(e.x, e.z, p.x, p.z);
  if (d < STORM_R[s.i]) {
    s.i++; s.best = Infinity; s.bestT = GAME.t; s.side = 0;
    if (s.i >= Rt.length) { s.done = true; SIEGE2.stats.through++; }
    return true;
  }
  if (d < s.best - 0.2) { s.best = d; s.bestT = GAME.t; }
  // no nearer for a while (a body in the doorway, a corner): a step aside, then on
  if (GAME.t - s.bestT > 2.5 && !s.side) { s.side = Math.random() < 0.5 ? -1 : 1; s.sideUntil = GAME.t + 0.7; SIEGE2.stats.sidesteps++; }
  if (s.side && GAME.t < s.sideUntil) {
    const ux = (p.x - e.x) / (d || 1), uz = (p.z - e.z) / (d || 1);
    moveToward(e, e.x + ux * 0.6 - uz * s.side * 1.2, e.z + uz * 0.6 + ux * s.side * 1.2, dt, 0.9, 0.05);
    return true;
  }
  if (s.side && GAME.t >= s.sideUntil) { s.side = 0; s.bestT = GAME.t - 1.0; }
  // held fast too long: it gives the way up and goes with the band
  if (GAME.t - s.bestT > 16) { SIEGE2.stats.stormFails++; s.done = true; s.failed = true; return false; }
  moveToward(e, p.x, p.z, dt, s.i >= 2 ? 0.85 : 1.0, 0.1);
  return true;
}

queueMicrotask(() => { if (window.__hm) window.__hm.siege2 = { SIEGE2, siegeMarkScore, siegeMarks, siegeTowerWayOk, siegeStormRoute, siegeStormBand, siegeStormStep, castleInside }; });
