/* ================================================================== */
/* [siege3] nobody is stuck in the ruins                               */
/* ================================================================== */
// A band's members keep their places behind the leader (thinkSoldier's formation), and a place that falls on a heap of
// rubble, in a fallen tower's broken drum or against a burnt gap's stumps cannot be stood in: a member pressed against
// it stood there for the rest of the siege (siege2.py's stormall: one of ten stood 57 s 3 m from a fallen gate tower
// while the band went in by the broken gate). Now a member that gets no nearer its place for a moment takes its own way
// (bandUnstick, from thinkSoldier): first along the leader's footsteps (the way the leader really walked), then a step
// aside, and its place is moved off whatever cannot be stood on (bandSlotFree). A storm through a fallen tower's door
// (04i_siege2.js) gathers before it goes out: the first through wait inside the door while foes hold the court before
// it, until three are in (siegeStormHold: one at a time out of the door into a garrison's plug was death each time),
// and the bows and staffs among them shoot out through the open door meanwhile. The shared files only call in, each
// line marked [siege3]: 08_ai.js (thinkSoldier), 04i_siege2.js (siegeStormStep, siegeStormTurn).

const SIEGE3 = { stats: { unstuck: 0, trails: 0, sidesteps: 0, slotsMoved: 0, holds: 0, bursts: 0 } };
const STORM_HOLD_N = 3, STORM_HOLD_T = 9;

// may a body stand at (x, z) at about height y? (no collider there, no masonry or rubble too tall to step onto)
function bandSlotFree(x, z, y) {
  if (!isWalkable(x, z)) return false;
  if (floorSolidAt(x, z, y)) return false;
  collidersNear(x, z, 0.8, _s3c);
  for (const c of _s3c) {
    if (!c.active || c.tag === 'tree') continue;
    if (c.vert && c.y0 > y + 1.8) continue;
    if (c.type === 'circle') { if (dist2(x, z, c.x, c.z) < (c.r + 0.35) ** 2) return false; continue; }
    const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) < c.hx + 0.35 && Math.abs(lz) < c.hz + 0.35) return false;
  }
  return true;
}
const _s3c = [];
// a member's place behind its leader, moved in toward the leader when it falls where nobody can stand (thinkSoldier)
function bandSlot(e, L, fx, fz) {
  const s = e.ai.slot3 || (e.ai.slot3 = { t: -1, x: fx, z: fz, ok: true });
  if (GAME.t - s.t > 0.8 || dist2(s.fx || 0, s.fz || 0, fx, fz) > 1.5 * 1.5) {
    s.t = GAME.t; s.fx = fx; s.fz = fz;
    s.ok = bandSlotFree(fx, fz, L.y);
    if (s.ok) { s.x = fx; s.z = fz; }
    else {
      // along the line to the leader, the first place one can stand
      s.x = L.x; s.z = L.z;
      for (const k of [0.75, 0.5, 0.3]) { const x = lerp(L.x, fx, k), z = lerp(L.z, fz, k); if (bandSlotFree(x, z, L.y)) { s.x = x; s.z = z; break; } }
      SIEGE3.stats.slotsMoved++;
    }
  }
  return s;
}
// a member pressed against something on the way to its place: true while it takes its own way round
function bandUnstick(e, wb, L, fx, fz, dt) {
  const u = e.ai.unstick || (e.ai.unstick = { x: e.x, z: e.z, t: GAME.t, mode: 0, until: 0, side: 1 });
  const d = dist(e.x, e.z, fx, fz);
  if (Math.hypot(e.x - u.x, e.z - u.z) > 0.4 || d < 1.4) { u.x = e.x; u.z = e.z; u.t = GAME.t; if (u.mode && GAME.t > u.until) u.mode = 0; }
  if (!u.mode && GAME.t - u.t > 2.2) {
    // no nearer for a moment: along the leader's footsteps (the way it really went), then a step aside
    u.mode = wb.trail && wb.trail.length > 1 ? 1 : 2; u.until = GAME.t + (u.mode === 1 ? 5 : 1.0); u.side = Math.random() < 0.5 ? -1 : 1;
    e.ai.trailAbs = undefined;
    SIEGE3.stats.unstuck++;
    if (u.mode === 1) SIEGE3.stats.trails++; else SIEGE3.stats.sidesteps++;
  }
  if (u.mode === 1 && GAME.t - u.t > 7.5) { u.mode = 2; u.until = GAME.t + 1.0; u.side = -u.side; SIEGE3.stats.sidesteps++; }
  if (!u.mode) return false;
  if (GAME.t > u.until) { u.mode = 0; u.t = GAME.t; u.x = e.x; u.z = e.z; return false; }
  if (u.mode === 1 && followTrail(e, wb, dt)) return true;
  const ux = (fx - e.x) / (d || 1), uz = (fz - e.z) / (d || 1);
  moveToward(e, e.x - ux * 0.5 - uz * u.side * 1.4, e.z - uz * 0.5 + ux * u.side * 1.4, dt, 1.0, 0.05);
  return true;
}

// a stormer through a fallen tower's store room, inside its courtyard door: true while it holds there for the others
// (siegeStormStep, before it steps out). It holds while foes are on the court before the door and fewer than three of
// its band are in the tower with it, for STORM_HOLD_T seconds at most; bows and staffs shoot out meanwhile
function siegeStormHold(e, s, Rt, dt) {
  if (s.i !== 4 || s.out) return false;
  const W = s.W, T = W.T, door = Rt[4];
  if (!s.holdT) {
    // foes before the door? (else straight out)
    let foes = 0;
    forNear(door.x, door.z, 7, (o) => { if (o.alive && isActor(o) && isEnemy(e, o) && Math.abs(o.y - e.y) < 1.8 && !towerRoomOf(o)) foes++; });
    if (!foes) { s.out = true; return false; }
    s.holdT = GAME.t;
    SIEGE3.stats.holds++;
  }
  // how many of the band are in the tower (in the store room or the doorway) and not yet out
  let inside = 0;
  for (const id of e.warband.members) {
    const o = getEnt(id);
    if (!o || !o.alive || !o.ai || !o.ai.storm || o.ai.storm.W !== W || o.ai.storm.done) continue;
    if (o.ai.storm.i >= 2 && o.ai.storm.i <= 4 && dist2(o.x, o.z, T.wx, T.wz) < (T.RO + 0.2) ** 2) inside++;
  }
  W.holding = GAME.t + 0.5; // (siegeStormTurn lets a third into the narrow part while they gather)
  if (inside >= STORM_HOLD_N || GAME.t - s.holdT > STORM_HOLD_T) {
    // out together
    for (const id of e.warband.members) { const o = getEnt(id); if (o && o.ai && o.ai.storm && o.ai.storm.W === W && o.ai.storm.i === 4) o.ai.storm.out = true; }
    SIEGE3.stats.bursts++;
    return false;
  }
  // inside the door, out of the doorway's line (each to its own side), facing out
  const Pin = Rt[3], k = (e.warband.members.indexOf(e.id) % 2) ? 1 : -1, ox = door.x - Pin.x, oz = door.z - Pin.z, dd = Math.hypot(ox, oz) || 1;
  moveToward(e, Pin.x - oz / dd * k * 0.55 - ox / dd * 0.25, Pin.z + ox / dd * k * 0.55 - oz / dd * 0.25, dt, 0.7, 0.15);
  turnToward(e, door.x, door.z, dt * 6);
  s.bestT = GAME.t;
  return true;
}
queueMicrotask(() => { if (window.__hm) window.__hm.siege3 = { SIEGE3, bandSlotFree, bandSlot, bandUnstick, siegeStormHold, siegeOnBreach, STORM_HOLD_N, STORM_HOLD_T }; });
