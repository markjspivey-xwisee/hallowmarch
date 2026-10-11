/* ================================================================== */
/* [siege2] shooters look for a line instead of waiting                */
/* ================================================================== */
// A bow, a wand or a staff whose shot would only strike a wall (wallsShotClear, 07g_walls.js) does not stand and look
// again every half second: it takes another foe it can strike from where it stands (wallsHeldShot, from autoAttack),
// and if there is none it goes to a place with a line to its foe (wallsSeekLine): a wall archer along its floor to the
// crenel, the slit or the breastwork's edge that shows the foe (within its reach of its post), a body on the ground back
// from the wall to where the walk shows over the breastwork, or aside round what stands between; meanwhile it holds its
// fire at that foe without looking again (wallsHeld). LINE.stats counts what it did. The shared files only call in,
// each line marked [siege2]:
//   07_entities.js autoAttack -> wallsHeld, wallsHeldShot · 08_ai.js thinkPosted, fightTarget -> wallsSeekLine;
//                  npcAbilities -> wallsHeld

const LINE = { on: true, stats: { held: 0, switched: 0, searches: 0, found: 0, arrived: 0, waits: 0 } };
const LINE_HOLD = 1.0; // seconds a held shooter waits on that foe without looking again (unless it moves or finds a line)

// the shot from a given eye point (x, y, z) to t: as wallsShotClear, from somewhere the shooter might stand
function wallsShotClearFrom(sx0, sy, sz0, e, t, arc) {
  const yaw = Math.atan2(t.x - sx0, t.z - sz0);
  const sx = sx0 + Math.sin(yaw) * 0.4, sz = sz0 + Math.cos(yaw) * 0.4;
  const tx = t.x, tz = t.z, ty = wallsAimY(t, sy);
  const tot = Math.hypot(tx - sx, tz - sz) || 1, o = { ox: sx, oy: sy, oz: sz, tgt: t };
  const n = arc ? 3 : 1;
  let px = sx, py = sy, pz = sz;
  for (let k = 1; k <= n; k++) {
    const u = k / n, x = lerp(sx, tx, u), z = lerp(sz, tz, u), y = lerp(sy, ty, u) + (arc ? Math.sin(u * Math.PI) * tot * 0.06 : 0);
    if (shotHit(px, py, pz, x, y, z, o)) return false;
    px = x; py = y; pz = z;
  }
  return true;
}
// is e holding its fire at t a moment (a held shot, no line found yet)? Then it does not look again
function wallsHeld(e, t) {
  const ai = e.ai;
  if (!LINE.on || !ai || !t || ai.heldFoe !== t.id || GAME.t >= ai.heldUntil) return false;
  // moved since (walking back from the wall, round a corner): the line may be open now, so it looks again
  if (ai.heldAt && dist2(e.x, e.z, ai.heldAt.x, ai.heldAt.z) > 0.6 * 0.6) { ai.heldUntil = 0; return false; }
  if (dist2(t.x, t.z, ai.heldAt ? ai.heldAt.tx : t.x, ai.heldAt ? ai.heldAt.tz : t.z) > 0.8 * 0.8) { ai.heldUntil = 0; return false; } // nor if the foe has moved
  return true;
}
// a shot at t was held (autoAttack): another foe it can strike from here, else hold on t a moment. True if it switched
function wallsHeldShot(e, t) {
  const ai = e.ai;
  if (!LINE.on || !ai) return false;
  LINE.stats.held++;
  // what kind of shot it was (for the measures): from a wall or tower at a foe below, from below at a foe up on one,
  // or both on the ground (a house, a wall or the ground between)
  const k = elevatedEnt(e) ? (elevatedEnt(t) ? 'heldUpUp' : 'heldDown') : elevatedEnt(t) ? 'heldUp' : 'heldFlat';
  LINE.stats[k] = (LINE.stats[k] || 0) + 1;
  if (e.ai.wall || e.role === 'guard') LINE.stats.heldGarrison = (LINE.stats.heldGarrison || 0) + 1;
  if (LINE.why) { // (tests) what stood in the way, along the straight line
    const R = shotHit(e.x, e.y + 1.45, e.z, t.x, wallsAimY(t, e.y + 1.45), t.z, { ox: e.x, oy: e.y + 1.45, oz: e.z, tgt: t });
    const w = (e.role === 'guard' ? 'g:' : e.warband ? 'b:' : 'o:') + k.slice(4) + ':' + (R ? (R.what === 'house' || R.what === 'roof' ? (R.H && R.H.keepHall ? 'hall' : 'house') : R.what) : 'arc');
    LINE.why[w] = (LINE.why[w] || 0) + 1;
  }
  // another foe in reach it can strike now (not the one it was told to hold the court before, a plug: any foe)
  if (GAME.t > (ai.altScan || 0)) {
    ai.altScan = GAME.t + 0.8;
    const o = wallsOtherFoe(e, t);
    if (o) { e.target = o.id; ai.heldFoe = null; ai.lineSpot = null; LINE.stats.switched++; return true; }
  }
  ai.heldFoe = t.id; ai.heldUntil = GAME.t + LINE_HOLD; ai.heldAt = { x: e.x, z: e.z, tx: t.x, tz: t.z };
  return false;
}
const _lcand = [];
function wallsOtherFoe(e, t) {
  _lcand.length = 0;
  const R = Math.max(8, (e.rangedRange || 20) - 3); // well within its reach (one at the edge of it walks out of it)
  forNear(e.x, e.z, R, (o, d2) => {
    if (o === t || !o.alive || o.kind === 'door' || !isActor(o) || !isEnemy(e, o)) return;
    if (o.role === 'villager' || o.role === 'merchant' || o.role === 'herald' || o.role === 'critter' || o.role === 'dummy') return; // a fighter, not the townsfolk (nor a test's straw man)
    if (o.role === 'mob' && o.target == null) return; // nor a beast of the wild that is fighting nobody
    if (o.flying || o.kind === 'dragon' || o.role === 'boss' || Math.abs(o.y - e.y) > 12) return; // nor the dragon passing over
    if (!canReach(e, o) || !classSeen(e, o, d2)) return;
    if (e.warband && o.fixedY === null && Math.abs(o.y - e.y) > 2.2 && e.ai.storm && !e.ai.storm.done) return; // [siege2] a stormer leaves the walls for later
    _lcand.push([d2, o]);
  });
  _lcand.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(4, _lcand.length); i++) {
    const o = _lcand[i][1];
    if (!inSight(e, o)) continue;
    if (wallsShotClear(e, o, e.rangedKind === 'arrow', false)) return o;
  }
  return null;
}
// a place near e with a line to t: for a body up on a floor (a walk, a tower top, a room with slits), along that floor
// within `reach` of its post; for a body on the ground, back from the wall or aside. Null when there is none
function wallsFindLine(e, t, post) {
  LINE.stats.searches++;
  const arc = e.rangedKind === 'arrow', eye = 1.45 * (e.scale || 1), sc = e.radius * (e.scale || 1);
  const up = elevatedEnt(e) || (post && Math.abs(floorAt(e.x, e.z, e.y + 0.3) - heightAt(e.x, e.z)) > 1.5);
  const bx = post ? post.x : e.x, bz = post ? post.z : e.z, dx = t.x - bx, dz = t.z - bz, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const cands = [];
  if (up) {
    // along its own floor: toward the foe's side first, then the rest of the round, nearest first
    for (const r of [0.8, 1.6, 2.4, 3.2]) for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
      const a = Math.atan2(ux, uz) + da;
      cands.push([bx + Math.sin(a) * r, bz + Math.cos(a) * r, r + Math.abs(da) * 0.8]);
    }
  } else {
    const R = (e.rangedRange || 20) - 2;
    // back from the foe (the walk shows over the breastwork from farther off), then aside
    for (const back of [4, 8, 12]) for (const side of [0, 5, -5]) {
      const x = e.x - ux * back + uz * side, z = e.z - uz * back - ux * side;
      if (dist(x, z, t.x, t.z) > R) continue;
      cands.push([x, z, back + Math.abs(side) * 0.8]);
    }
    for (const side of [4, -4, 8, -8]) cands.push([e.x + uz * side, e.z - ux * side, Math.abs(side) * 1.1]);
  }
  cands.sort((a, b) => a[2] - b[2]);
  let tested = 0;
  for (const [x, z] of cands) {
    if (tested >= 10) break;
    if (up) {
      // on the same floor all the way, and not into anything at its height
      let ok = true;
      for (const f of [0.34, 0.67, 1]) { const px = lerp(e.x, x, f), pz = lerp(e.z, z, f); if (Math.abs(floorAt(px, pz, e.y + 0.3) - e.y) > 0.25 || castleStepBlocked(e, px, pz, e.y)) { ok = false; break; } }
      if (!ok || _lineSolid(x, z, e.y, sc)) continue;
    } else {
      if (!isWalkable(x, z) || !segmentClear(e.x, e.z, x, z, sc, false)) continue;
    }
    tested++;
    const y = up ? e.y : floorAt(x, z, e.y + 0.6);
    if (wallsShotClearFrom(x, y + eye, z, e, t, arc)) { LINE.stats.found++; return { x, z }; }
  }
  return null;
}
// is a body of radius r at (x, z) standing at height y inside something solid there (a parapet, a post, a wall)?
const _lsc = [];
function _lineSolid(x, z, y, r) {
  collidersNear(x, z, r + 1, _lsc);
  for (const c of _lsc) {
    if (!c.active || c.tag === 'tree' || c.tag === 'fire' || c.tag === 'bush') continue;
    const y0 = c.y0 != null ? c.y0 : c.baseY - 0.5;
    if (y + 1.6 < y0 || y > y0 + c.h) continue;
    if (c.type === 'circle') { if (dist2(x, z, c.x, c.z) < (c.r + r) ** 2) return true; continue; }
    const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) return true;
  }
  return false;
}
// a held shooter goes to a place with a line to its foe (thinkPosted for the garrison, fightTarget for the rest):
// true while it walks there
function wallsSeekLine(e, t, post, dt) {
  const ai = e.ai;
  if (!LINE.on || !ai || !e.rangedKind || e.fixedY !== null || e.motion || !t || t.kind === 'door') return false;
  const L = ai.lineSpot;
  if (L && L.id === t.id && GAME.t < L.until) {
    if (dist2(e.x, e.z, L.x, L.z) < 0.25 * 0.25) {
      if (!L.at) { L.at = true; LINE.stats.arrived++; ai.heldUntil = 0; }
      // there: it keeps the place and shoots from it (nothing else moves it off, a wall archer's step to its crenel
      // neither) until the line is lost again, when it looks anew
      if (wallsHeld(e, t)) { ai.lineSpot = null; return false; }
      turnToward(e, t.x, t.z, dt * 10);
      return true;
    }
    moveToward(e, L.x, L.z, dt, 0.85, 0.12);
    return true;
  }
  if (!wallsHeld(e, t) || GAME.t < (ai.lineScan || 0)) return false;
  ai.lineScan = GAME.t + 1.0;
  const s = wallsFindLine(e, t, post);
  if (!s) { LINE.stats.waits++; return false; }
  ai.lineSpot = { id: t.id, x: s.x, z: s.z, until: GAME.t + 6, at: false };
  moveToward(e, s.x, s.z, dt, 0.85, 0.12);
  return true;
}
queueMicrotask(() => { if (window.__hm) window.__hm.lines = { LINE, wallsShotClearFrom, wallsHeld, wallsHeldShot, wallsFindLine, wallsSeekLine, wallsOtherFoe }; });
