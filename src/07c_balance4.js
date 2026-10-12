/* ================================================================== */
/* [balance4] the callings within the aim at every level, for skilled  */
/*   and simple play alike (version 12)                                */
/*   Charge rushes: since version 5 Charge had a reach of 28 m while    */
/*     its rush sat in the melee branch of executeAbility, so it never  */
/*     moved the warrior (it spent its power and cooldown, freed the    */
/*     warrior of slows and gave momentum, and nothing else: no rush,   */
/*     no blow, no slow). Now it is a real rush along the ground, the   */
/*     shield forward, homing on the foe, stopped by walls, water,      */
/*     drops and a root in its path, and a blow where it lands          */
/*     (chargeRush, chargeRushStep from updateMotion, chargeLands).     */
/*   Mend weighs the wound (mendWound); a seasoned mage's spells grow   */
/*     with rank (mageRankK); the bots' view of the rush (rushComing,   */
/*     snareOnLine); the rules version 11 set in place of the rush are  */
/*     set aside in their own modules (pursuit, the charge's freedom).  */
/* ================================================================== */
// what the tests hear of a heal that ticks (a renewal, holy ground) rather than lands at once (BAL.tap, healEnt)
const TAP_TICK = { tick: true };

/* ------------------------------------------------------------------ */
/* Charge: a real rush                                                 */
/* ------------------------------------------------------------------ */
// speed in m/s, the longest a rush lasts, and how close it comes (a little inside a blade's reach)
const RUSH = { speed: 18, maxT: 1.9, slow: false, stats: { rushes: 0, arrived: 0, blocked: 0, lost: 0 } };
// until Leap Strike is learned (level 30) Charge is the warrior's only rush, and its landing blow slows the foe as Charge
// always promised (45% for 3 s): a bow walked away from every landing at 10 (the warrior won 3 of 24 against it with
// 30% for 2 s), and a priest or a mage held by it still has the 3 s before Shield Bash to answer
const RUSH_SLOW_EARLY = [0.4, 2.5]; // [balance6] [0.45, 3]: the skilled warrior won 65% of its duels at 10 in arenas far apart, three in four against a bow or a priest
// [balance4] after a Charge no root or slow took hold for 2 s (chargeFree, 07c_balance.js): the answer to kiting while the
// rush never moved the warrior; a real rush is that answer, and a frost nova may meet the warrior where it lands
const CHARGE_FREE = 0;
const rushReach = (e, t) => e.meleeRange * 0.75 * (e.scale || 1) + t.radius * (t.scale || 1);
// canUse asks (07c_balance3.js classCanUse): no rush on a horse, in the water, in a boat, at a foe on another floor, or (for
// a posted guard) at a foe beyond its post's leash
function rushWhy(e, A, t) {
  if (!A.dash) return null;
  if (e.mount) return 'mounted';
  if (e.swim || e.boat || e.dive) return 'swimming';
  if (e.fixedY != null) return 'busy'; // (a body held at its post's height: an archer on a fixed perch)
  if (t && t.alive && Math.abs(t.y - e.y) > 1.6 && (elevatedEnt(e) || elevatedEnt(t))) return 'range';
  // a guard at its post rushes only at a foe within its leash of it: garrison troops hold their posts (a gate's guards
  // rushed 28 m out after anyone who came into sight, once Charge rushed at all)
  const post = e.role !== 'player' && !e.bot && e.ai && e.ai.post;
  if (post && t && dist(t.x, t.z, post.x, post.z) > (post.leash || 0) + 3) return 'post';
  return null;
}
// Charge comes round every 16 s; before Leap Strike is learned (level 30) it is the warrior's only rush, and comes every 12 s
const RUSH_CD_EARLY = 12;
// executeAbility hands a Charge here: the warrior sets off at the foe, shield forward
function chargeRush(e, A, t, rk) {
  if (!t || !t.alive) return;
  if (e.level < ABILITIES.leap.level) e.cds.charge = Math.min(e.cds.charge || 0, GAME.t + RUSH_CD_EARLY);
  faceToward(e, t.x, t.z);
  e.cds.bash = Math.max(e.cds.bash || 0, GAME.t + RUSH_BASH + Math.min(RUSH.maxT, dist(e.x, e.z, t.x, t.z) / RUSH.speed));
  e.motion = { kind: 'leap', rush: true, t: 0, dur: RUSH.maxT, tid: t.id, A, rk, stuck: 0, dust: 0, yaw: e.yaw };
  e.onGround = false; // (the foot lock leaves a rushing body's feet to the run)
  setAct(e, 10, RUSH.maxT); // the shield raised across the body, the legs running (05a_rig.js: the guard over the gait)
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 70 * 70) FX.dust(e.x, e.y, e.z, 10);
  if (e === GAME.player || dist2(e.x, e.z, camera.position.x, camera.position.z) < 40 * 40) sfx('swing');
  RUSH.stats.rushes++; if (RUSH.onEvent) RUSH.onEvent(e, `rush from ${dist(e.x, e.z, t.x, t.z).toFixed(1)} m`);
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
    if (RUSH.onEvent) RUSH.onEvent(e, `rush ${why} at ${t ? dist(e.x, e.z, t.x, t.z).toFixed(1) : '-'} m after ${m.t.toFixed(2)} s`); // tests: a duel's trace
    if (why === 'arrived' && t) chargeLands(e, m.A, t, m.rk);
    if (why === 'blocked') rushHeld(e); // [balance6] a rush that never reached its foe comes round sooner (07c_balance6.js)
    return true;
  };
  if (!e.alive) { e.motion = null; e.onGround = true; return false; }
  if (!t || !t.alive || t.removed || isStunned(e)) return end('lost');
  if (isRooted(e)) return end('blocked'); // a snare in its path, a frost nova as it comes in: the rush is held where it is
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
  // there: a foe walking away is reached on this step, not the next (it had walked on by then, and the rush ran at its
  // heels at reach until it ran out: 1.9 s of a warrior busy and shot at against every bow and staff that kites)
  if (dist(e.x, e.z, t.x, t.z) <= reach + 0.05) return end('arrived');
  // a wall or a tree in the way: the rush stops against it
  const moved = Math.hypot(e.x - ox, e.z - oz);
  m.stuck = moved < step * 0.35 ? m.stuck + dt : 0;
  if (m.stuck > 0.12) return end(d < reach + 1.2 ? 'arrived' : 'blocked');
  // dust kicked up along the way
  m.dust -= dt;
  if (m.dust <= 0) { m.dust = 0.09; if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 60 * 60) FX.dust(e.x, e.y, e.z, 3); }
  return true;
}
// the rush spends the shield arm's weight: Shield Bash waits a moment after a Charge (a rush, a bash and the blows in
// the stun's shadow killed a mage before it could answer at all)
const RUSH_BASH = 3;
// and it leaves the warrior a moment to find its feet: its abilities wait this long after it lands (the foe may answer)
const RUSH_FOOTING = 0.3;
// the rush lands: the blade comes round (the blow it always promised; its slow, RUSH.slow, made a rush, a slow and a bash
// a lock no mage or priest could answer, and stays off)
function chargeLands(e, A, t, rk) {
  faceToward(e, t.x, t.z);
  e.gcdUntil = Math.max(e.gcdUntil || 0, GAME.t + RUSH_FOOTING);
  setAct(e, 1, 0.5);
  later(0.12, () => {
    if (!e.alive || !t.alive || dist(e.x, e.z, t.x, t.z) > e.meleeRange * (e.scale || 1) + t.radius * (t.scale || 1) + 1.2) return;
    spawnSlash(e, false);
    natureSwing(e, 2.2, 0.6, 12);
    const r = computeDamage(e, t, (A.dmg || 0.8) * rk);
    dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee' });
    FX.sparks(t.x, t.y + 1.2 * (t.scale || 1), t.z);
    if (A.snare && RUSH.slow) addBuff(t, 'snare', A.snare[0], A.snare[1], e.id);
    else if (e.level < ABILITIES.leap.level || B7T.chargeSlowLate) addBuff(t, 'snare', RUSH_SLOW_EARLY[0], RUSH_SLOW_EARLY[1], e.id); // [balance7] B7T.chargeSlowLate (07c_balance7.js)
    if (e === GAME.player || t === GAME.player) sfx('hit');
  });
}

/* ------------------------------------------------------------------ */
/* a seasoned mage                                                     */
/* ------------------------------------------------------------------ */
// the elements answer a seasoned mage more strongly: 7% more for each rank past the first (on top of every ability's rank).
// A mage has no armour, no heal and no rush: past 30 the warrior's Rallying Cry and Bulwark, the priest's Divine Shield
// and Mass Renewal and the archer's Deadeye left its spells behind (it won about a third of its duels at 30 and 50)
const MAGE_RANK_K = 0.07;
const mageRankK = (e) => mageRankOf(abilityRank(e.level)); // [balance6] 1 + MAGE_RANK_K a rank past the first: a step at rank II, then a little each rank (07c_balance6.js)

/* ------------------------------------------------------------------ */
/* Mend closes wounds                                                  */
/* ------------------------------------------------------------------ */
// the deeper the wound, the more Mend mends: all of its measure from half health down, under half of it on a scratch.
// A heal cast at need does its full work; one cast by habit, every other breath, does little (a priest pressing every
// key in turn healed as much as one who mends at need, and out-lasted every foe who did not break its spells)
const MEND_WOUND = { floor: 0.3, full: 0.5 };
function mendWound(f) {
  if (!f || !(f.maxHp > 0)) return 1;
  const miss = clamp(1 - f.hp / f.maxHp, 0, 1);
  return clamp(MEND_WOUND.floor + (1 - MEND_WOUND.floor) * miss / MEND_WOUND.full, MEND_WOUND.floor, 1);
}

// [balance4] the bots: a warrior's rush is on its way to e (its Charge ready, e its foe, in the rush's reach)
function rushComing(e, o) {
  if (!o || !o.alive || o.cls !== 'warrior' || o.target !== e.id) return false;
  if (rushing(o)) return true;
  return o.level >= ABILITIES.charge.level && (o.cds.charge || 0) <= GAME.t + 0.5 && !deepFrostHeld(o) && dist(e.x, e.z, o.x, o.z) > 5 && dist(e.x, e.z, o.x, o.z) < 29;
}
const rushing = (o) => !!(o && o.motion && o.motion.rush);
// an armed snare of e's foes lying on the rush's way from e to t: the rush stops at reach, short of the foe, and a snare
// springs on a body within 0.55 m of its edge (stepSnares), so a snare laid at a bow's feet does not lie on a rush's way
// until the bow has walked on past it (it did, as a snare anywhere near the line: the warrior strafed and never rushed)
// A snare still arming is one too if it will be armed by the time the rush passes it (a snare laid as the warrior pressed
// Charge armed under it on the way)
function snareOnLine(e, t) {
  const lx = t.x - e.x, lz = t.z - e.z, L = Math.hypot(lx, lz) || 1;
  const stop = Math.max(0, L - rushReach(e, t)) / L, r = 0.55 + e.radius * (e.scale || 1) + 0.45;
  for (const S of CLS.snares) {
    if (S.sprung || S.faction === e.faction || GAME.t + 1.15 * dist(e.x, e.z, S.x, S.z) / RUSH.speed + 0.2 < S.armAt) continue;
    const u = ((S.x - e.x) * lx + (S.z - e.z) * lz) / (L * L);
    if (u <= 0.02) continue;
    const v = Math.min(u, stop);
    if (Math.hypot(e.x + lx * v - S.x, e.z + lz * v - S.z) < r) return S;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* the priests' realm ways, evened out                                 */
/* ------------------------------------------------------------------ */
// measured against a priest of no realm's way (duels.py kind=flavour, 12 duels a realm at 10, 30 and 50): the Shield of
// Logres won 8, 10 and 9, the Well of Ériu 7, 6 and 5, the Hearth of Thule 6.5, 7 and 5. Less harm on yourself is worth
// more in a duel than a heal over time or harder blows, so Logres gives a little less and the other two a little more
// (version 11: 12% and 10% less harm, 1.5% a second, 12% harder)
const PRIEST_REALM = { logresBless: 0.92, logresGround: 0.92, eriuHot: 0.02, thuleBless: 1.15 };
CLASS_REALM.priest[0].text = `Your blessing makes allies take ${Math.round((1 - PRIEST_REALM.logresBless) * 100)}% less harm, and allies on your holy ground take ${Math.round((1 - PRIEST_REALM.logresGround) * 100)}% less.`;
CLASS_REALM.priest[1].text = `Your blessing heals ${+(PRIEST_REALM.eriuHot * 100).toFixed(1)}% a second and frees allies from snares and roots; your holy ground heals half again as much.`;
CLASS_REALM.priest[2].text = `Your blessing makes allies strike ${Math.round((PRIEST_REALM.thuleBless - 1) * 100)}% harder, and your holy ground burns every foe on it, not only the dead.`;

/* ---- what a player reads: the tooltips say what these rules do ---- */
ABILITIES.charge.desc = `Rush at a foe 5–28 m away, shield first, and strike it as you land: 80% weapon damage. The rush tears you free of any slow or root but a seasoned mage's frost; a snare or a root that catches you on the way holds you there. Landing, you take ${RUSH_FOOTING} s to find your feet before your next ability, and Shield Bash waits ${RUSH_BASH} s. Charge and Leap Strike are one rush; until you learn Leap Strike, Charge comes round every ${RUSH_CD_EARLY} s and its blow slows the foe by ${Math.round(RUSH_SLOW_EARLY[0] * 100)}% for ${RUSH_SLOW_EARLY[1]} s.`;
ABILITIES.mend.desc = 'Heals a friend for 36% of health, or you for 27%. The deeper the wound, the more it mends: all of it from half health down, a third of it on a scratch.';
ABILITIES.rally.desc += ' Its heal is your own: it does not grow with your rank.';
ABILITIES.volley.desc += ' The arrows fall from above: a raised shield does not turn them.';
ABILITIES.pillar.desc += ' Standing in it yourself, your own wounds mend as they do from your other heals.';

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal4 = { RUSH, RUSH_BASH, RUSH_FOOTING, RUSH_CD_EARLY, rushReach, rushWhy, chargeRush, rushComing, snareOnLine, MEND_WOUND, mendWound, CHARGE_FREE, MAGE_RANK_K, mageRankK, RUSH_SLOW_EARLY, PRIEST_REALM };
}, 0);
