/* ================================================================== */
/* [balance4] the callings within the aim at every level, for skilled  */
/*   and simple play alike (version 12)                                */
/*   Charge rushes: since version 5 Charge had a reach of 28 m while    */
/*     its rush sat in the melee branch of executeAbility, so it never  */
/*     moved the warrior (it spent its power and cooldown, freed the    */
/*     warrior of slows and gave momentum, and nothing else: no rush,   */
/*     no blow, no slow). Now it is a real rush along the ground, the   */
/*     shield forward, homing on the foe, stopped by walls, water and   */
/*     drops, and a blow and a slow where it lands (chargeRush,         */
/*     chargeRushStep from updateMotion).                               */
/* ================================================================== */
// what the tests hear of a heal that ticks (a renewal, holy ground) rather than lands at once (BAL.tap, healEnt)
const TAP_TICK = { tick: true };

/* ------------------------------------------------------------------ */
/* Charge: a real rush                                                 */
/* ------------------------------------------------------------------ */
// speed in m/s, the longest a rush lasts, and how close it comes (a little inside a blade's reach)
const RUSH = { speed: 18, maxT: 1.9, stats: { rushes: 0, arrived: 0, blocked: 0, lost: 0 } };
const rushReach = (e, t) => e.meleeRange * 0.75 * (e.scale || 1) + t.radius * (t.scale || 1);
// canUse asks (07c_balance3.js classCanUse): no rush on a horse, in the water, in a boat, or at a foe on another floor
function rushWhy(e, A, t) {
  if (!A.dash) return null;
  if (e.mount) return 'mounted';
  if (e.swim || e.boat || e.dive) return 'swimming';
  if (e.fixedY != null) return 'busy'; // (a body held at its post's height: an archer on a fixed perch)
  if (t && t.alive && Math.abs(t.y - e.y) > 1.6 && (elevatedEnt(e) || elevatedEnt(t))) return 'range';
  return null;
}
// executeAbility hands a Charge here: the warrior sets off at the foe, shield forward
function chargeRush(e, A, t, rk) {
  if (!t || !t.alive) return;
  faceToward(e, t.x, t.z);
  e.motion = { kind: 'leap', rush: true, t: 0, dur: RUSH.maxT, tid: t.id, A, rk, stuck: 0, dust: 0, yaw: e.yaw };
  e.onGround = false; // (the foot lock leaves a rushing body's feet to the run)
  setAct(e, 10, RUSH.maxT); // the shield raised across the body, the legs running (05a_rig.js: the guard over the gait)
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 70 * 70) FX.dust(e.x, e.y, e.z, 10);
  if (e === GAME.player || dist2(e.x, e.z, camera.position.x, camera.position.z) < 40 * 40) sfx('swing');
  RUSH.stats.rushes++;
}
// each step of a rush (updateMotion): on toward the foe along the ground; true while it carries the body
function chargeRushStep(e, m, dt) {
  m.t += dt;
  const t = getEnt(m.tid);
  const end = (why) => {
    e.motion = null; e.onGround = true; e.vy = 0;
    e.y = groundY(e);
    if (e.anim.act === 10) { e.anim.act = 0; e.anim.actDur = 0; }
    RUSH.stats[why]++;
    if (why === 'arrived' && t) chargeLands(e, m.A, t, m.rk);
    return true;
  };
  if (!e.alive) { e.motion = null; e.onGround = true; return false; }
  if (!t || !t.alive || t.removed || isStunned(e)) return end('lost');
  const reach = rushReach(e, t);
  const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz);
  if (d <= reach + 0.05) return end('arrived');
  if (m.t > m.dur) return end(d < reach + 1.2 ? 'arrived' : 'blocked');
  const step = Math.min(RUSH.speed * dt, d - reach);
  const nx = e.x + (dx / d) * step, nz = e.z + (dz / d) * step;
  // no rush into deep water, off a drop or up a wall
  const y0 = e.y;
  if (!isWalkable(nx, nz)) return end(d < reach + 1.2 ? 'arrived' : 'blocked');
  const ox = e.x, oz = e.z;
  if (!stepTo(e, nx, nz)) return end(d < reach + 1.2 ? 'arrived' : 'blocked');
  const gy = groundY(e);
  if (Math.abs(gy - y0) > 0.9) { e.x = ox; e.z = oz; return end(d < reach + 1.2 ? 'arrived' : 'blocked'); }
  e.y = gy;
  e.yaw = Math.atan2(dx, dz);
  // a wall or a tree in the way: the rush stops against it
  const moved = Math.hypot(e.x - ox, e.z - oz);
  m.stuck = moved < step * 0.35 ? m.stuck + dt : 0;
  if (m.stuck > 0.12) return end(d < reach + 1.2 ? 'arrived' : 'blocked');
  // dust kicked up along the way
  m.dust -= dt;
  if (m.dust <= 0) { m.dust = 0.09; if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 60 * 60) FX.dust(e.x, e.y, e.z, 3); }
  return true;
}
// the rush lands: the blade comes round and the foe is slowed (the blow it always promised)
function chargeLands(e, A, t, rk) {
  faceToward(e, t.x, t.z);
  setAct(e, 1, 0.5);
  later(0.12, () => {
    if (!e.alive || !t.alive || dist(e.x, e.z, t.x, t.z) > e.meleeRange * (e.scale || 1) + t.radius * (t.scale || 1) + 1.2) return;
    spawnSlash(e, false);
    natureSwing(e, 2.2, 0.6, 12);
    const r = computeDamage(e, t, (A.dmg || 0.8) * rk);
    dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee' });
    FX.sparks(t.x, t.y + 1.2 * (t.scale || 1), t.z);
    if (A.snare) addBuff(t, 'snare', A.snare[0], A.snare[1], e.id);
    if (e === GAME.player || t === GAME.player) sfx('hit');
  });
}

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal4 = { RUSH, rushReach, rushWhy, chargeRush };
}, 0);
