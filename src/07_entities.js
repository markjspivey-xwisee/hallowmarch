/* ================================================================== */
/* entities, stats, combat, abilities, projectiles                     */
/* ================================================================== */
const FACTION_MONSTER = 3, FACTION_NEUTRAL = 4;
const GAME = { t: 0, player: null, prog: null, started: false, paused: false, over: false, dt: 0 };
const ENT = [];
const ENT_BY_ID = new Map();
let ENT_NEXT = 1;

function makeEnt(o) {
  const e = Object.assign({
    id: ENT_NEXT++, kind: 'humanoid', faction: FACTION_MONSTER, role: 'mob', name: '', level: 1, cls: null, mobType: null,
    x: 0, y: 0, z: 0, yaw: 0, vy: 0, onGround: true, fixedY: null,
    radius: 0.45, speed: 6.5, hp: 100, maxHp: 100, power: 100, maxPower: 100,
    alive: true, deadAt: 0, removeAt: 0, removed: false,
    target: null, threat: null, damagers: null, lastHitBy: null, lastHitAt: -99,
    casting: null, swingAt: 0, cds: {}, gcdUntil: 0, buffs: [],
    anim: { phase: Math.random() * TAU, amt: 0, act: 0, actT: 0, actDur: 0, flash: 0, death: 0 },
    look: null, ai: { think: Math.random() * 0.5 }, home: null, warband: null, keep: null, carrying: null,
    combatUntil: -99, dmgMult: 1, drBase: 0, swing: 2.4, meleeRange: 2.6, rangedKind: null, rangedRange: 0,
    prevX: 0, prevZ: 0, scale: 1, hover: 0,
  }, o);
  e.prevX = e.x; e.prevZ = e.z;
  ENT.push(e);
  ENT_BY_ID.set(e.id, e);
  return e;
}
function removeEnt(e) {
  e.removed = true;
  ENT_BY_ID.delete(e.id);
  const i = ENT.indexOf(e);
  if (i >= 0) ENT.splice(i, 1);
}
const getEnt = (id) => (id == null ? null : ENT_BY_ID.get(id) || null);

/* spatial hash, rebuilt every simulation step */
const SGRID = new Map();
const SCELL = 12;
const gkey = (cx, cz) => ((cx + 1024) << 11) | (cz + 1024);
function rebuildGrid() {
  SGRID.clear();
  for (const e of ENT) {
    const k = gkey(Math.floor(e.x / SCELL), Math.floor(e.z / SCELL));
    let l = SGRID.get(k);
    if (!l) SGRID.set(k, l = []);
    l.push(e);
  }
}
function forNear(x, z, r, fn) {
  const r2 = r * r;
  const x0 = Math.floor((x - r) / SCELL), x1 = Math.floor((x + r) / SCELL), z0 = Math.floor((z - r) / SCELL), z1 = Math.floor((z + r) / SCELL);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const l = SGRID.get(gkey(cx, cz));
    if (!l) continue;
    for (const e of l) { const d2 = dist2(x, z, e.x, e.z); if (d2 <= r2) fn(e, d2); }
  }
}
function nearestWhere(x, z, r, pred) {
  let best = null, bd = Infinity;
  forNear(x, z, r, (e, d2) => { if (d2 < bd && pred(e)) { bd = d2; best = e; } });
  return best;
}

function isEnemy(a, b) {
  if (!a || !b || a === b) return false;
  if (a.faction === FACTION_NEUTRAL || b.faction === FACTION_NEUTRAL) return !!((a.game && b.role === 'player') || (b.game && a.role === 'player')); // [survival] the player hunts deer
  if (a.flying || b.flying) return false;
  return a.faction !== b.faction;
}
const isActor = (e) => e.kind !== 'door';

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */
const ROLE_MULT = {
  player: [1.1, 1.25], dungeonBoss: [10, 1.25], soldier: [1, 1], guard: [1.15, 0.95], lord: [3.2, 1.25], guardian: [1.7, 1.05], muster: [7, 3.2], mob: [1, 1], villager: [1, 0], herald: [1, 0],
};
function setupStats(e, keepRatio = false) {
  const ratio = keepRatio && e.maxHp > 0 ? e.hp / e.maxHp : 1;
  const [hm, dm] = ROLE_MULT[e.role] || [1, 1];
  if (e.cls && CLASSES[e.cls]) {
    const C = CLASSES[e.cls];
    e.maxHp = baseHp(e.level) * C.hp * hm;
    e.maxPower = gearPowerBase(e); // [balance2] past 20 a body in gear draws its power from gear, not level (06e_gearcurve.js)
    e.dmgMult = C.dmg * dm;
    e.drBase = C.dr;
    e.swing = C.swing;
    e.meleeRange = C.ranged ? 2.6 : C.range;
    e.rangedKind = C.ranged || null;
    e.rangedRange = C.ranged ? C.range : 0;
    e.speed = 6.6;
  } else if (e.mobType && MOBS[e.mobType]) {
    const M = MOBS[e.mobType];
    e.maxHp = baseHp(e.level) * 0.82 * M.hp * hm;
    e.maxPower = 100;
    e.dmgMult = 0.72 * M.dmg * dm;
    e.drBase = 0;
    e.swing = M.swing;
    e.meleeRange = M.ranged ? 2.4 : M.range;
    e.rangedKind = M.ranged || null;
    e.rangedRange = M.ranged ? M.range : 0;
    e.speed = M.speed;
  }
  // standing adjustments that survive a rescale: archers on the walls, the barrow's elites
  const tw = e.tweak;
  if (tw) {
    if (tw.hp) e.maxHp *= tw.hp;
    if (tw.dmg) e.dmgMult *= tw.dmg;
    if (tw.rangedRange) e.rangedRange = tw.rangedRange;
    if (tw.swing) e.swing = tw.swing;
    if (tw.meleeRange) e.meleeRange = tw.meleeRange;
    if (tw.speed) e.speed = tw.speed;
  }
  if (e.role === 'player') {
    const rr = realmRank(GAME.prog ? GAME.prog.rp : 0);
    e.maxHp *= 1 + 0.015 * (rr - 1);
  }
  {
    // what the player wears and wields (and a bot measuring the callings, 07c_balance.js) [balance]
    const g = e.role === 'player' || e.bot ? e.gear : null;
    if (g) {
      e.maxHp *= 1 + g.hp / 100;
      e.dmgMult *= 1 + g.dmg / 100;
      e.drBase = 1 - (1 - e.drBase) * (1 - g.arm / 100);
      e.maxPower *= 1 + g.pow / 100;
      e.critBonus = g.crit / 100;
    }
  }
  e.hp = e.maxHp * ratio;
  e.power = Math.min(e.power, e.maxPower);
  if (!keepRatio) e.power = e.maxPower;
}

/* ------------------------------------------------------------------ */
/* buffs                                                               */
/* ------------------------------------------------------------------ */
function addBuff(e, kind, value, dur, src = null, extra = null) {
  const now = GAME.t;
  if (kind === 'stun' || kind === 'snare' || kind === 'root') { const g = giftBuffAdjust(e, kind, value, dur); value = g.value; dur = g.dur; } // [gifts] Unbroken, Cold-blooded (06c_gifts.js)
  if ((kind === 'stun' || kind === 'snare' || kind === 'root') && src !== 'frozen') { dur = ccAdjust(e, kind, dur, src, !!(extra && extra.ccAll)); if (!(dur > 0)) return _ccImmune; } // [balance] diminishing returns on control for players and champions (07c_balance.js)
  let b = e.buffs.find((x) => x.kind === kind && x.src === src);
  if (b) { b.value = kind === 'shield' ? value : Math.max(b.value, value); b.until = now + dur; if (extra) Object.assign(b, extra); }
  else { b = { kind, value, until: now + dur, src, tick: now, ...(extra || {}) }; e.buffs.push(b); }
  if (kind === 'stun') ladderOnStun(e, src); // [keeps] a stun knocks a climber off its ladder (04m_ladders.js)
  return b;
}
const hasBuff = (e, kind) => e.buffs.some((b) => b.kind === kind && b.until > GAME.t);
function buffMax(e, kind) { let v = 0; for (const b of e.buffs) if (b.kind === kind && b.until > GAME.t && b.value > v) v = b.value; return v; }
function buffSum(e, kind) { let v = 0; for (const b of e.buffs) if (b.kind === kind && b.until > GAME.t) v += b.value; return v; }
const isStunned = (e) => hasBuff(e, 'stun');
const isRooted = (e) => hasBuff(e, 'root') || isStunned(e);
function effectiveSpeed(e) {
  if (!e.alive || isRooted(e)) return 0;
  let s = e.speed;
  if (!hasBuff(e, 'free')) s *= 1 - buffMax(e, 'snare');
  if (e.carrying) s *= 0.72;
  s *= giftSpeedMult(e); // [gifts] Wood-wise (06c_gifts.js)
  s *= waterSpeedMult(e); // [water] wading and swimming are slow (07b_swim.js)
  s *= classSpeedMult(e); // [classes] chills, a raised shield, a drawn bow, prayer (07b_classes.js)
  return s;
}
function tickBuffs(e, dt) {
  const now = GAME.t;
  for (let i = e.buffs.length - 1; i >= 0; i--) {
    const b = e.buffs[i];
    if (!b) continue; // a dot can kill, which clears the list
    if (b.kind === 'burn' && e.alive && Math.random() < 0.8) burnFlames(e);
    if (b.kind === 'hot' || b.kind === 'dot' || b.kind === 'burn' || b.kind === 'bleed') { // [classes] bleeding wounds tick too
      while (b.tick + 1 <= now && b.tick + 1 <= b.until + 0.01) {
        b.tick += 1;
        const src = getEnt(b.src) || e;
        if (b.kind === 'hot') healEnt(src, e, b.value, true);
        else if (e.alive) dealDamage(src, e, b.value, { dot: true });
        if (!e.alive) return;
      }
    }
    if (b.until <= now || (b.kind === 'shield' && b.value <= 0)) e.buffs.splice(i, 1);
  }
}

function burnFlames(e) {
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) > 55 * 55) return;
  const sc = e.scale || 1;
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * TAU, r = Math.random() * 0.32 * sc;
    fxAdd.emit(e.x + Math.cos(a) * r, e.y + (0.25 + Math.random() * 1.35) * sc, e.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.4, 1.1 + Math.random() * 1.1, (Math.random() - 0.5) * 0.4, 0.38 + Math.random() * 0.2, 2.4, 0.95 + Math.random() * 0.35, 0.28, 0.13 + Math.random() * 0.08, -1.8, 0.6);
  }
  if (Math.random() < 0.25) fxAlpha.emit(e.x, e.y + 1.6 * sc, e.z, (Math.random() - 0.5) * 0.3, 0.9, (Math.random() - 0.5) * 0.3, 1.4, 0.15, 0.13, 0.12, -0.45, -0.1, 0.3);
}

/* ------------------------------------------------------------------ */
/* relic bonus (set by the war system)                                 */
/* ------------------------------------------------------------------ */
const REALM_BONUS = [1, 1, 1];
function computeDamage(src, dst, mult) {
  let d = baseDmg(src.level) * src.dmgMult * mult;
  d *= 0.9 + Math.random() * 0.2;
  d *= clamp(1 + 0.07 * (src.level - dst.level), 0.45, 1.7);
  if (src.faction <= 2) d *= REALM_BONUS[src.faction];
  if (src.role === 'player' && GAME.prog) d *= 1 + 0.015 * (realmRank(GAME.prog.rp) - 1);
  d *= 1 + buffSum(src, 'dmg');
  const crit = Math.random() < 0.08 + (src.critBonus || 0);
  if (crit) d *= 1.5;
  if (src.motion) d *= ladderWeak(src); // [keeps] one hand on the rungs: a weaker blow (04m_ladders.js)
  return { d, crit };
}
function dealDamage(src, dst, amount, opts = {}) {
  if (!dst || !dst.alive || !(amount > 0)) return 0;
  if (dst.kind === 'door') {
    if (!doorVulnerable(dst)) { if (src.role === 'player') uiFloatAt(dst.x, dst.y + 3, dst.z, 'Immune', 'immune'); return 0; }
    amount *= opts.siege ? 1 : 0.5;
  }
  if (!opts.dot && src && src !== dst && src.x !== undefined && towerSightBlocked(src, dst)) return 0; // [keeps] no blow through a tower's floor, a shut hatch or its wall (04m_ladders.js)
  amount *= giftHarmMult(src, dst, opts); // [gifts] Steadfast Lines, Cold-blooded, Wound-fury (06c_gifts.js)
  amount *= gearLateHarm(src, dst); // [balance2] a late foe is as tough as the gear of its level (06e_gearcurve.js)
  amount = classHarm(src, dst, amount, opts); // [classes] stances, the shield and the parry, elements and combos, ambush (07b_classes.js)
  amount *= survivalHarmMult(dst, opts); // [survival] fireward and frostward draughts (06s_survival.js)
  if (!(amount > 0)) return 0;
  let dmg = amount * (1 - (opts.pierce === true ? 0 : dst.drBase * (1 - (+opts.pierce || 0)))) * (1 - buffMax(dst, 'dr')); // [balance3] a number pierces that share of the armour (bodkins: half)
  let absorbed = 0;
  for (const b of dst.buffs) {
    if (b.kind === 'shield' && b.value > 0 && dmg > 0) { const a = Math.min(b.value, dmg); b.value -= a; dmg -= a; absorbed += a; }
  }
  dst.hp -= dmg;
  if (dst.mount && dmg > 0 && !opts.dot) dismount(dst, 'You are thrown from the saddle!');
  const now = GAME.t;
  dst.combatUntil = now + 6;
  if (src) src.combatUntil = now + 6;
  if (src && src !== dst) {
    if (!dst.threat) dst.threat = new Map();
    dst.threat.set(src.id, (dst.threat.get(src.id) || 0) + dmg + absorbed + 1);
    if (!dst.damagers) dst.damagers = new Set();
    dst.damagers.add(src.id);
    dst.lastHitBy = src.id;
    dst.lastHitAt = now;
  }
  if (dst.kind !== 'door') {
    dst.anim.flash = 1;
    if (!opts.dot && Math.random() < 0.3 && !dst.casting && dst.alive && dst.anim.act === 0) setAct(dst, 4, 0.35);
  }
  onDamageFeedback(src, dst, dmg, absorbed, opts);
  if (BAL.tap) BAL.tap(src, dst, dmg, absorbed, opts); // [balance3] tests read every blow (07c_balance.js)
  onImpact(src, dst, dmg, opts);
  wearOnHit(src, dst, dmg, opts); // feature/weather: blood, battle damage and gear durability (05h_wear.js)
  brandOnHit(src, dst, opts); // a blow struck with a burning brand can set the foe alight (09d_brand.js)
  classOnHit(src, dst, dmg, opts); // [classes] momentum, weapon styles, finishers, devotion, arrow heads (07b_classes.js)
  if (dst.motion && dst.hp > 0) ladderOnHit(src, dst, dmg, opts); // [keeps] a heavy blow knocks a climber off (04m_ladders.js)
  if (dst.hp <= 0) killEnt(dst, src);
  return dmg;
}
function healEnt(src, dst, amount, quiet = false) {
  if (!dst || !dst.alive || dst.kind === 'door') return 0;
  const before = dst.hp;
  amount *= healWound(dst); // [balance2] a broadhead's wound mends slowly (07c_balance.js)
  dst.hp = Math.min(dst.maxHp, dst.hp + amount);
  const h = dst.hp - before;
  if (BAL.tap && h > 0) BAL.tap(src, dst, -h, 0, null); // [balance3] and every heal
  classOnHeal(src, dst, h); // [classes] healing builds a priest's devotion (07b_classes.js)
  if (h > 0.5) {
    onHealFeedback(src, dst, h, quiet);
    // healers draw the attention of whoever is fighting the healed unit
    if (src && src !== dst) {
      forNear(dst.x, dst.z, 25, (o) => { if (o.alive && o.threat && o.threat.has(dst.id) && isEnemy(o, src)) o.threat.set(src.id, (o.threat.get(src.id) || 0) + h * 0.5); });
    }
  }
  return h;
}
function killEnt(e, killer) {
  if (!e.alive) return;
  e.alive = false;
  e.hp = 0;
  e.deadAt = GAME.t;
  e.casting = null;
  e.target = null;
  e.buffs.length = 0;
  if (e.mount && e.mount.rec) animalsDismounted(e, e.mount); // [animals] your own horse is not lost with you (08h_animals.js)
  e.mount = null;
  if (e.kind !== 'door') e.removeAt = e.role === 'player' ? Infinity : GAME.t + 10;
  if (e.carrying != null) dropRelic(e);
  deathEffects(e);
  const P = GAME.player;
  if (P && e !== P && e.damagers && e.damagers.has(P.id)) grantKillRewards(e);
  onEntityKilled(e, killer);
}

/* ------------------------------------------------------------------ */
/* animation helpers                                                   */
/* ------------------------------------------------------------------ */
function setAct(e, type, dur, from = 0) { e.anim.act = type; e.anim.actT = dur * from; e.anim.actDur = dur; }
const spinning = (e) => e.motion != null && e.motion.kind === 'spin';
function faceToward(e, x, z) { if (!spinning(e) && Math.abs(x - e.x) + Math.abs(z - e.z) > 1e-3) e.yaw = Math.atan2(x - e.x, z - e.z); }
function turnToward(e, x, z, rate) {
  if (spinning(e) || Math.abs(x - e.x) + Math.abs(z - e.z) < 1e-3) return;
  const want = Math.atan2(x - e.x, z - e.z);
  const d = angDiff(e.yaw, want);
  e.yaw += clamp(d, -rate, rate);
}
// one step (half a gait cycle) of a person moving at v m/s in their own size: the walk shader's humanStep (05a_rig.js)
// [motion] below about 1 m/s the steps shorten rather than slow (at least 1.6 steps a second): no slow-motion legs
const humanStep = (v) => clamp(Math.min(0.40 + 0.20 * v + 0.006 * v * v, v / 1.6), 0.03, 2.2);
function updateAnim(e, dt) {
  const sp = Math.hypot(e.x - e.prevX, e.z - e.prevZ) / Math.max(dt, 1e-4);
  // [polish] going sideways against the facing (shoved, sliding along a wall), the steps come quicker and shorter, so a
  // planted foot is lifted before the body has moved too far over it (13s_footlock.js holds it till then)
  const side = sp > 0.05 ? Math.abs((e.x - e.prevX) * Math.cos(e.yaw) - (e.z - e.prevZ) * Math.sin(e.yaw)) / Math.max(sp * dt, 1e-6) : 0;
  e.prevX = e.x; e.prevZ = e.z;
  const want = clamp(sp / 4.3, 0, 2.2);
  // [motion] stopping, the gait settles twice as fast: a raised foot comes down instead of hanging in the air
  e.anim.amt = lerp(e.anim.amt, want, 1 - Math.exp(-dt * (sp < 0.05 && e.anim.amt > want ? 20 : 10)));
  // the phase turns half a cycle per step, so a planted foot keeps pace with the ground (the shader plants it)
  const sc = e.scale || 1;
  const stride = e.kind === 'humanoid' ? humanStep(e.anim.amt * 4.3 / sc) * sc : beastStride(e.kind, e.anim.amt, sc); // [motion] the beast's own scale sets its pace
  e.anim.phase = (e.anim.phase + dt * sp * (TAU / 2) / (stride * (1 - 0.5 * clamp(side, 0, 1)))) % (TAU * 64);
  // [motion] a body leans into a turn as far as the turn's pull asks (a person up to about 14 degrees, a beast or a horse
  // with its rider 11; 13r_motion.js packs it for the shaders)
  const yrs = angDiff(e._ayaw ?? e.yaw, e.yaw) / Math.max(dt, 1e-4), yr = Math.abs(yrs);
  e._ayaw = e.yaw;
  const lmax = e.kind === 'humanoid' && !e.mount ? 0.25 : 0.2;
  e.anim.lean = lerp(e.anim.lean || 0, sp > 1.5 && !e.seat && e.fixedY == null ? clamp(-yrs * sp / 9.8 * 0.7, -lmax, lmax) : 0, 1 - Math.exp(-dt * 5));
  // [motion] turning on the spot: a person steps round (the feet lift and come down again) instead of pivoting on frozen feet
  if (e.kind === 'humanoid') {
    e.anim.turn = lerp(e.anim.turn || 0, sp < 0.6 && !e.mount && !e.seat ? clamp((yr - 0.6) / 3, 0, 1) : 0, 1 - Math.exp(-dt * 8));
    if (e.anim.turn > 0.02 && sp < 0.6) e.anim.phase = (e.anim.phase + dt * TAU * 0.9 * e.anim.turn) % (TAU * 64);
  }
  if (e.mount) updateMountAnim(e, dt, sp);
  if (e.anim.actDur > 0) {
    e.anim.actT += dt;
    if (e.anim.actT >= e.anim.actDur) { e.anim.act = 0; e.anim.actDur = 0; }
  }
  e.anim.flash = Math.max(0, e.anim.flash - dt * 5);
  e.anim.death = e.alive ? 0 : clamp((GAME.t - e.deadAt) / 0.7, 0, 1);
  footLockStep(e, dt); // [polish] each planted foot keeps its place on the ground (13s_footlock.js)
}
function animActValue(e) {
  const wa = water2ActValue(e); if (wa) return wa; // [water2] the stroke under the water, the oars (07d_dive.js)
  const ca = classActValue(e); if (ca) return ca; // [classes] a raised shield, a drawn bow, prayer (07b_classes.js)
  if (e.casting) {
    if (e.casting.id === 'summon') return 0;
    const A = ABILITIES[e.casting.id];
    // archers raise the bow and draw to the cheek, then hold until the shot goes
    if (A && A.anim === 2) return 2 + clamp(e.casting.t / e.casting.total, 0, 1) * 0.8;
    return 3 + clamp(e.casting.t / e.casting.total, 0, 0.999);
  }
  // the whirlwind and the leap own the whole body, even in the air
  if (e.anim.act >= 7 && e.anim.actDur > 0) return e.anim.act + clamp(e.anim.actT / e.anim.actDur, 0, 0.999);
  if (!e.onGround && e.role === 'player') return 6.5;
  if (e.anim.act && e.anim.actDur > 0) return e.anim.act + clamp(e.anim.actT / e.anim.actDur, 0, 0.999);
  return 0;
}

/* ------------------------------------------------------------------ */
/* movement                                                            */
/* ------------------------------------------------------------------ */
const _mv = { x: 0, z: 0 };
function stepTo(e, nx, nz) {
  if (!isFiniteNum(nx) || !isFiniteNum(nz)) return false;
  const ok = e.swimOK ? swimPassable : isWalkable; // [water] a swimmer may go into deep water (07b_swim.js)
  if (!ok(nx, nz)) {
    if (ok(nx, e.z)) nz = e.z;
    else if (ok(e.x, nz)) nx = e.x;
    else return false;
  }
  _mv.x = nx; _mv.z = nz;
  const by = e.y - (e.hover || 0); // castles: colliders and raised floors know how high the body stands (04g_castles.js)
  resolveCollisions(_mv, e.radius * (e.scale || 1) * 0.9, by, e.faction);
  boatShove(_mv, e.radius * (e.scale || 1) * 0.9, by, e); // [water2] round a boat's hull, not through it (07e_boats.js)
  if (!e.swim && castleStepBlocked(e, _mv.x, _mv.z, by) && !jettyJumpIn(e, _mv.x, _mv.z)) return false; // [water] a swimmer floats over the drop of the bed; [water2] a body that may swim goes off a jetty into deep water (07e_boats.js)
  const Dg = DRAGON.e;
  if (Dg && Dg !== e && !Dg.removed && !Dg.flying) {
    const ddx = _mv.x - Dg.x, ddz = _mv.z - Dg.z, dd = Math.hypot(ddx, ddz), rr = 2.7 + e.radius;
    if (dd < rr && dd > 1e-4) { _mv.x = Dg.x + ddx / dd * rr; _mv.z = Dg.z + ddz / dd * rr; }
  }
  if (!ok(_mv.x, _mv.z)) return false;
  e.x = _mv.x; e.z = _mv.z;
  return true;
}
function moveToward(e, tx, tz, dt, speedMul = 1, stopDist = 0.3) {
  const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
  if (d <= stopDist) return true;
  const sp = effectiveSpeed(e) * speedMul;
  if (sp <= 0) return false;
  const step = Math.min(d - stopDist * 0.5, sp * dt);
  stepTo(e, e.x + (dx / d) * step, e.z + (dz / d) * step);
  turnToward(e, tx, tz, dt * 9);
  return false;
}
function groundY(e) { return e.fixedY !== null ? e.fixedY : waterFloorY(e, floorAt(e.x, e.z, e.y - (e.hover || 0))); } // floorAt: stairs and wall walks (04g_castles.js); [water] a swimmer floats (07b_swim.js)
// returns true while the body is in flight and nothing else should move it
function updateMotion(e, dt) {
  const m = e.motion;
  if (!m) return false;
  if (m.kind === 'ladder') return towerLadderStep(e, m, dt); // [land] up or down a tower's ladder (04l_towers.js)
  m.t += dt;
  const k = clamp(m.t / m.dur, 0, 1);
  if (m.kind === 'spin') {
    e.yaw += m.rate * dt;
    if (k >= 1) e.motion = null;
    return false;
  }
  // a leap: along the line to the landing spot, up and over in a parabola
  const u = k * (1.15 - 0.15 * k);
  e.x = lerp(m.x0, m.x1, u); e.z = lerp(m.z0, m.z1, u);
  const g1 = m.y1;
  e.y = lerp(m.y0, g1, u) + 4 * m.h * u * (1 - u);
  e.onGround = false;
  e.yaw = m.yaw;
  if (k < 1) return true;
  e.motion = null;
  e.x = m.x1; e.z = m.z1; e.y = groundY(e);
  e.onGround = true; e.vy = 0;
  if (m.onLand) m.onLand();
  return true;
}
function leapPlan(e, t) {
  const d = Math.max(0.01, dist(e.x, e.z, t.x, t.z));
  const ux = (t.x - e.x) / d, uz = (t.z - e.z) / d;
  const want = Math.max(0, d - (t.radius * (t.scale || 1) + 0.9));
  let land = 0;
  for (let s = 0.5; s <= want + 1e-6; s += 0.5) {
    const x = e.x + ux * s, z = e.z + uz * s;
    if (!isWalkable(x, z) || Math.abs(heightAt(x, z) - e.y) > 6) break;
    land = s;
  }
  while (land > 0 && !segmentClear(e.x, e.z, e.x + ux * land, e.z + uz * land, 0.3)) land -= 0.5;
  return { x: e.x + ux * land, z: e.z + uz * land, d: land, yaw: Math.atan2(ux, uz) };
}

/* ------------------------------------------------------------------ */
/* abilities                                                           */
/* ------------------------------------------------------------------ */
function abilityRange(e, A, target) {
  if (A.range === 'melee') return e.meleeRange + (target ? target.radius * (target.scale || 1) : 0) + 0.3;
  return (A.range || 0) + (target ? target.radius * (target.scale || 1) : 0);
}
function resolveTarget(e, A, target) {
  if (A.self) return e;
  if (A.friendly) return target && target.alive && !isEnemy(e, target) && isActor(target) && target.faction === e.faction ? target : e;
  return target;
}
function canUse(e, id, target, ignoreCd = false) {
  const A = ABILITIES[id];
  if (!A) return 'unknown';
  if (!e.alive) return 'dead';
  if (e.carrying != null) return 'carrying';
  if (isStunned(e)) return 'stunned';
  if (e.casting || (e.motion && e.motion.kind === 'leap')) return 'busy';
  { const cw = classCanUse(e, A); if (cw) return cw; } // [balance3] a body held by frost cannot Charge or Leap out of it (07c_balance3.js)
  if (e.swim && (A.cast > 0 || A.proj || A.anim === 2 || A.ground)) return 'swimming'; // [water] no casting or shooting while swimming
  if (e.role === 'player' && GAME.prog && A.level > GAME.prog.level) return 'level';
  if (e.motion && ladderAllows(e, A)) return 'ladder'; // [keeps] one hand on the rungs (04m_ladders.js)
  if (!ignoreCd && ((e.cds[id] || 0) > GAME.t || e.gcdUntil > GAME.t)) return 'cooldown';
  if (e.power < A.cost && !classOvercast(e, A)) return 'power'; // [classes] a mage may overcast (07b_classes.js)
  const t = resolveTarget(e, A, target);
  if (A.self) return null;
  if (A.friendly) { if (t !== e && dist(e.x, e.z, t.x, t.z) > abilityRange(e, A, t)) return 'range'; return null; }
  if (!t || !t.alive || !isEnemy(e, t)) return 'target';
  const d = dist(e.x, e.z, t.x, t.z);
  if (d > abilityRange(e, A, t)) return 'range';
  if (A.minRange && d < A.minRange) return 'close';
  if (A.range === 'melee' && t.kind !== 'door' && Math.abs(t.y - e.y) > 2.6 && (elevatedEnt(e) || elevatedEnt(t))) return 'range'; // [keeps] not from the foot of a wall to its walk
  if (towerSightBlocked(e, t)) return 'target'; // [keeps] nor through a tower's floor or wall (04m_ladders.js)
  return null;
}
function useAbility(e, id, target) {
  const why = canUse(e, id, target);
  if (why) return why;
  const A = ABILITIES[id];
  const t = resolveTarget(e, A, target);
  if (t && t !== e) faceToward(e, t.x, t.z);
  if (A.cast > 0) {
    e.casting = { id, t: 0, total: A.cast, targetId: t ? t.id : null, gx: t ? t.x : e.x, gz: t ? t.z : e.z };
    if (e.role === 'player') sfx('cast');
    return true;
  }
  executeAbility(e, A, t);
  return true;
}
function finishCast(e) {
  const c = e.casting;
  e.casting = null;
  if (c.id === 'summon') { mountUp(e); return; }
  const A = ABILITIES[c.id];
  if (c.aim) { houseCastFinish(e, A, c); return; } // aimed at a house
  let t = getEnt(c.targetId);
  if (!A.ground && !A.self) {
    if (A.friendly) { if (!t || !t.alive) t = e; }
    else if (!t || !t.alive || !isEnemy(e, t)) return;
    if (t !== e && dist(e.x, e.z, t.x, t.z) > abilityRange(e, A, t) + 4) { if (e.role === 'player') uiError('Your target is out of range'); return; }
  }
  if (e.power < A.cost && !classOvercast(e, A)) return; // [classes]
  executeAbility(e, A, t, c);
}
function executeAbility(e, A, t, cast = null) {
  const now = GAME.t;
  A = classAbility(e, A, t, cast); // [classes] this cast's view: stance, finisher, focus, attunement, devotion, arrows (07b_classes.js)
  // every ten levels past 20 an ability hits (and heals) a rank harder
  const rk = rankMult(e.level);
  e.power -= A.cost;
  e.cds[A.id] = now + A.cd;
  if (e.role === 'player') e.gcdUntil = now + 0.6;
  e.combatUntil = Math.max(e.combatUntil, A.friendly || A.self ? e.combatUntil : now + 6);
  if (A.anim) setAct(e, A.anim, A.anim === 2 ? 0.55 : A.anim === 8 ? 0.7 : 0.5, cast && A.anim === 2 ? 0.8 : 0);
  const chest = (u) => u.y + 1.2 * (u.scale || 1);
  if (A.custom) { A.custom(e, A, t, cast, rk); return; } // [classes] frost nova, thunderclap, element wards and blinks, the storm chain, snares, holy ground, raising
  // self abilities
  if (A.self) {
    if (A.healPct) healEnt(e, e, e.maxHp * A.healPct * rk);
    if (A.buff) addBuff(e, A.buff.kind, A.buff.value, A.buff.dur, e.id);
    if (A.shieldPct) { addBuff(e, 'shield', e.maxHp * A.shieldPct * rk, A.dur, e.id); FX.ring(e.x, e.y + 1, e.z, 1.2, [0.6, 0.9, 1.6], 24, 1.5); }
    if (A.id === 'rally') { FX.ring(e.x, e.y + 0.3, e.z, 2, [2.0, 1.4, 0.5], 36); sfx('horn'); }
    if (A.id === 'bulwark') FX.ring(e.x, e.y + 1, e.z, 1.0, [1.4, 1.4, 1.6], 20, 1.2);
    if (A.blink) {
      const dx = Math.sin(e.yaw), dz = Math.cos(e.yaw);
      FX.burst(e.x, e.y + 1, e.z, 20, [0.8, 0.6, 2.0], 2, 0.5, 0.2, 0);
      for (let s = A.blink; s > 0; s -= 1) {
        const nx = e.x + dx * s, nz = e.z + dz * s;
        if (isWalkable(nx, nz) && segmentClear(e.x, e.z, nx, nz, 0.3)) { e.x = nx; e.z = nz; e.prevX = nx; e.prevZ = nz; break; }
      }
      e.buffs = e.buffs.filter((b) => b.kind !== 'snare' && b.kind !== 'root');
      FX.burst(e.x, e.y + 1, e.z, 20, [0.8, 0.6, 2.0], 2, 0.5, 0.2, 0);
      sfx('blink');
    }
    if (A.dashBack) {
      const dx = -Math.sin(e.yaw), dz = -Math.cos(e.yaw);
      for (let s = A.dashBack; s > 0; s -= 1) {
        const nx = e.x + dx * s, nz = e.z + dz * s;
        if (isWalkable(nx, nz) && segmentClear(e.x, e.z, nx, nz, 0.3)) { e.x = nx; e.z = nz; break; }
      }
      e.buffs = e.buffs.filter((b) => b.kind !== 'snare' && b.kind !== 'root');
      FX.dust(e.x, e.y, e.z, 10);
    }
    if (A.pbaoe) {
      FX.ring(e.x, e.y + 0.6, e.z, A.pbaoe, [2.2, 0.9, 0.3], 60, A.pbaoe * 1.3);
      FX.burst(e.x, e.y + 0.8, e.z, 40, [2.0, 0.8, 0.25], 6, 0.6, 0.3, 1);
      spellDisc(e.x, e.z, A.pbaoe, DISC_KIND.shock, 0.55, [2.2, 0.9, 0.3]);
      spellDisc(e.x, e.z, A.pbaoe * 0.8, DISC_KIND.scorch, 7, [1, 1, 1]);
      fireLandsAt(e.x, e.y, e.z, A.pbaoe, e); // [depth] the caster
      forNear(e.x, e.z, A.pbaoe, (o) => {
        if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
        const r = computeDamage(e, o, A.dmg * rk);
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'fire' });
        if (A.root) addBuff(o, 'root', 1, A.root, e.id);
      });
      sfx('fire');
    }
    if (A.groupHeal) {
      forNear(e.x, e.z, A.radius, (o) => { if (o.alive && o.faction === e.faction && isActor(o)) { healEnt(e, o, o.maxHp * A.groupHeal * rk); FX.heal(o.x, o.y, o.z); } });
      FX.ring(e.x, e.y + 0.3, e.z, A.radius * 0.3, [1.0, 1.6, 0.7], 50, A.radius);
      sfx('heal');
    }
    if (A.spin) {
      // whirlwind: two full turns with the blade held out, cutting everything in reach
      const dur = 0.8;
      e.motion = { kind: 'spin', t: 0, dur, rate: (2 * TAU) / dur };
      setAct(e, 7, dur);
      const cut = (part) => {
        if (!e.alive) return;
        forNear(e.x, e.z, A.spin + 1.5, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
          if (dist(e.x, e.z, o.x, o.z) > A.spin + o.radius * (o.scale || 1)) return;
          const r = computeDamage(e, o, A.dmg * rk * part);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee' });
          FX.sparks(o.x, chest(o), o.z);
        });
        natureSwing(e, A.spin + 0.4, Math.PI, 30); // nature: the blade cuts the grass round about and bites into trees
        sfx('hit');
      };
      for (let i = 0; i < 6; i++) later(0.05 + i * 0.12, () => { if (e.alive) { spawnSlash(e, false, 0.22, (Math.random() - 0.5) * 0.25); if (i % 2 === 0) sfx('swing'); FX.dust(e.x, e.y, e.z, 3); } });
      later(0.32, () => cut(0.5));
      later(0.66, () => cut(0.5));
      spellDisc(e.x, e.z, A.spin + 0.8, DISC_KIND.shock, 0.75, [1.25, 1.1, 0.85]);
      sfx('whirl');
    }
    if (A.groupHot) {
      // mass renewal: a slow green light settles over everyone close by
      forNear(e.x, e.z, A.radius, (o) => {
        if (!o.alive || o.faction !== e.faction || !isActor(o)) return;
        addBuff(o, 'hot', (o.maxHp * A.groupHot[0] * rk) / A.groupHot[1], A.groupHot[1], e.id);
        FX.heal(o.x, o.y, o.z);
      });
      spellDisc(e.x, e.z, A.radius, DISC_KIND.renew, 1.8, [0.8, 1.55, 0.55]);
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * A.radius;
        const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
        fxAdd.emit(x, heightAt(x, z) + 0.1, z, (Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3, 1.4 + Math.random(), 0.9, 1.6, 0.55, 0.14, -0.2, 0.4);
      }
      sfx('renew');
    }
    return;
  }
  // friendly single target
  if (A.friendly) {
    const f = t || e;
    if (A.heal) { healEnt(e, f, f.maxHp * A.heal * rk); FX.heal(f.x, f.y, f.z); sfx('heal'); }
    if (A.hot) { addBuff(f, 'hot', (f.maxHp * A.hot[0] * rk) / A.hot[1], A.hot[1], e.id); FX.heal(f.x, f.y, f.z); }
    if (A.shieldPct) { addBuff(f, 'shield', f.maxHp * A.shieldPct * rk, A.dur, e.id); addBuff(f, 'dr', 0.3, A.dur, e.id); FX.ring(f.x, f.y + 1, f.z, 1.1, [1.6, 1.5, 0.8], 24, 1.2); sfx('heal'); }
    return;
  }
  // ground-targeted
  if (A.ground) {
    const gx = t ? t.x : cast ? cast.gx : e.x, gz = t ? t.z : cast ? cast.gz : e.z;
    if (A.id === 'volley') {
      for (let w = 0; w < A.waves; w++) {
        later(0.35 + w * 0.55, () => {
          for (let k = 0; k < 7; k++) {
            const a = Math.random() * TAU, r = Math.random() * A.radius;
            spawnProjectile(e, null, 'arrow', null, { x: gx + Math.cos(a) * r, y: heightAt(gx, gz) + 0.2, z: gz + Math.sin(a) * r }, true);
          }
          later(0.5, () => areaDamage(e, gx, gz, A.radius, A.dmg * rk, null));
        });
      }
      aoeMarker(gx, gz, A.radius, 2.2);
    } else if (A.id === 'meteor') {
      const gy = heightAt(gx, gz);
      spawnProjectile(e, null, 'meteor', null, { x: gx, y: gy, z: gz }, true, { x: gx - 8, y: gy + 26, z: gz - 6 });
      aoeMarker(gx, gz, A.radius, 1.2);
      later(0.95, () => {
        FX.burst(gx, gy + 0.5, gz, 70, [2.4, 1.0, 0.3], 9, 0.8, 0.35, 6);
        FX.ring(gx, gy + 0.3, gz, A.radius, [2.0, 0.8, 0.3], 60, 9);
        FX.dust(gx, gy, gz, 24, [0.3, 0.26, 0.22]);
        spellDisc(gx, gz, A.radius * 1.2, DISC_KIND.shock, 0.7, [2.4, 1.0, 0.35]);
        spellDisc(gx, gz, A.radius * 0.9, DISC_KIND.scorch, 14, [1, 1, 1]);
        spellDisc(gx, gz, A.radius * 0.55, DISC_KIND.crack, 14, [1, 1, 1], 0.07);
        lightFlash(gx, gy + 1.5, gz, 22, [3.4, 1.6, 0.5], 0.9);
        natureImpact(gx, gz, 'meteor', A.radius); // nature: a crater, trees thrown down and set alight
        areaDamage(e, gx, gz, A.radius, A.dmg * rk, { kind: 'fire' }); // [classes] the meteor's fire meets frost, wet and ice
        fireLandsAt(gx, gy, gz, A.radius, e); // [depth] the caster
        castleSiegeHit(e, gx, gz, A.radius, A.dmg * rk); // castles: meteors batter walls (04g_castles.js)
        sfx('boom');
        cameraShake(0.4, gx, gz);
      });
    } else if (A.id === 'blizzard') {
      // ice falls slanting on a bitter wind; the ground in the circle frosts over
      spellDisc(gx, gz, A.radius, DISC_KIND.frost, A.ticks + 1.2, [0.5, 0.75, 1.1]);
      spellEmitter({ kind: 'blizzard', x: gx, z: gz, r: A.radius, until: GAME.t + A.ticks + 0.3, src: e });
      aoeMarker(gx, gz, A.radius, A.ticks + 0.4);
      for (let i = 0; i < A.ticks; i++) {
        later(0.5 + i, () => {
          if (!e.alive && e.role !== 'player') return;
          forNear(gx, gz, A.radius, (o) => {
            if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
            const r = computeDamage(e, o, A.dmg * rk);
            dealDamage(e, o, r.d, { crit: r.crit, kind: 'frost' });
            addBuff(o, 'snare', A.snare[0], A.snare[1], e.id, { blizzard: true }); // [balance3] no Charge or Leap out of a blizzard (07c_balance3.js)
          });
        });
      }
      sfx('blizzard');
    } else if (A.id === 'pillar') {
      // a column of dawn-light comes down: the foe inside burns, friends inside are mended
      const gy = heightAt(gx, gz);
      spellPillar(gx, gy, gz, A.radius * 0.72, 30, 1.6, [1.9, 1.5, 0.7]);
      spellDisc(gx, gz, A.radius, DISC_KIND.holy, 2.0, [1.7, 1.3, 0.55]);
      lightFlash(gx, gy + 3, gz, 18, [2.9, 2.4, 1.2], 1.0);
      later(0.2, () => {
        FX.burst(gx, gy + 0.4, gz, 46, [2.4, 2.0, 1.0], 5, 0.7, 0.18, -1);
        forNear(gx, gz, A.radius + 0.6, (o) => {
          if (!o.alive || !isActor(o) || dist(gx, gz, o.x, o.z) > A.radius + o.radius) return;
          if (isEnemy(e, o)) {
            const r = computeDamage(e, o, A.dmg * rk);
            dealDamage(e, o, r.d, { crit: r.crit, kind: 'holy' });
          } else if (o.faction === e.faction) { healEnt(e, o, o.maxHp * A.healPct * rk); FX.heal(o.x, o.y, o.z); }
        });
      });
      sfx('pillar');
    }
    return;
  }
  if (!t) return;
  if (A.leap) {
    // leap strike: up and over, landing on the foe with the blade coming down
    const L = leapPlan(e, t);
    const dur = clamp(L.d / 15, 0.42, 0.85);
    e.motion = { kind: 'leap', t: 0, dur, x0: e.x, z0: e.z, y0: e.y, x1: L.x, z1: L.z, y1: heightAt(L.x, L.z), h: 1.4 + L.d * 0.11, yaw: L.yaw, onLand: () => leapLand(e, A, rk) };
    e.yaw = L.yaw;
    setAct(e, 9, dur / 0.65);
    FX.dust(e.x, e.y, e.z, 12);
    sfx('swing');
    return;
  }
  if (A.chain) {
    // chain lightning: from the hand to the foe, then on to the nearest foes in turn
    const hits = [t];
    let cur = t;
    for (let j = 0; j < A.chain; j++) {
      const n = nearestWhere(cur.x, cur.z, 11, (o) => o.alive && isEnemy(e, o) && isActor(o) && !hits.includes(o));
      if (!n) break;
      hits.push(n); cur = n;
    }
    hits.forEach((o, j) => {
      later(j * 0.12, () => {
        if (!o.alive) return;
        const p = j === 0 ? null : hits[j - 1];
        const from = p ? [p.x, chest(p), p.z] : [e.x + Math.sin(e.yaw) * 0.5, e.y + 1.45 * (e.scale || 1), e.z + Math.cos(e.yaw) * 0.5];
        const to = [o.x, chest(o), o.z];
        spellRibbon(from, to, 'bolt', [1.0, 1.35, 2.6], 0.5, 0.34);
        const r = computeDamage(e, o, A.dmg * rk * Math.pow(0.8, j));
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'shock' });
        FX.burst(to[0], to[1], to[2], 16, [1.2, 1.5, 2.8], 4.5, 0.32, 0.1, 7);
        lightFlash(to[0], to[1], to[2], 9, [1.5, 1.9, 3.4], 0.28);
        sfx('shock');
      });
    });
    return;
  }
  if (A.range === 'melee') {
    if (A.dash) {
      const d = dist(e.x, e.z, t.x, t.z);
      const dx = (t.x - e.x) / d, dz = (t.z - e.z) / d;
      const stop = d - (e.meleeRange * 0.7 + t.radius);
      for (let s = stop; s > 0; s -= 0.5) { const nx = e.x + dx * s, nz = e.z + dz * s; if (isWalkable(nx, nz) && segmentClear(e.x, e.z, nx, nz, 0.4)) { FX.dust(e.x, e.y, e.z, 8); e.x = nx; e.z = nz; break; } }
      faceToward(e, t.x, t.z);
    }
    later(0.22, () => {
      if (!e.alive) return;
      if (A.arc) {
        spawnSlash(e, false);
        natureSwing(e, A.arc + 0.3, 1.1, 40); // nature: the cleave cuts the grass in its arc and bites into trees
        forNear(e.x, e.z, A.arc + 1, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
          const ang = Math.abs(angDiff(e.yaw, Math.atan2(o.x - e.x, o.z - e.z)));
          if (ang > 1.1) return;
          const r = computeDamage(e, o, A.dmg * rk);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee' });
          FX.sparks(o.x, chest(o), o.z);
        });
        sfx('swing');
        return;
      }
      if (!t.alive || dist(e.x, e.z, t.x, t.z) > abilityRange(e, A, t) + 1.5) return;
      spawnSlash(e, A.anim === 8);
      natureSwing(e, 2.2, 0.6, 12); // nature: a low swing cuts the grass in front
      const r = computeDamage(e, t, A.dmg * rk);
      dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee' });
      FX.sparks(t.x, chest(t), t.z);
      if (A.stun) { addBuff(t, 'stun', 1, A.stun, e.id); t.casting = null; FX.ring(t.x, chest(t) + 0.6, t.z, 0.4, [1.8, 1.8, 0.8], 12, 0.6); }
      if (A.snare) addBuff(t, 'snare', A.snare[0], A.snare[1], e.id);
      sfx('hit');
    });
    return;
  }
  if (A.proj) {
    spawnProjectile(e, t, A.proj, { mult: A.dmg * rk, snare: A.snare, ability: A.id, burn: A.burn ? [A.burn[0] * rk, A.burn[1]] : null, pierce: A.id === 'deadeye', arrow: A.arrow }); // [classes] arrow: the head chosen (07b_classes.js)
    sfx(A.proj === 'arrow' || A.proj === 'firearrow' ? 'bow' : A.proj === 'deadeye' ? 'deadeye' : A.proj === 'fire' ? 'fire' : A.proj === 'frost' ? 'frost' : 'holy');
    if (A.proj === 'firearrow') sfx('ignite');
    return;
  }
  if (A.dot) {
    const r = computeDamage(e, t, A.dot[0] * rk);
    addBuff(t, 'dot', r.d / A.dot[1], A.dot[1], e.id);
    FX.burst(t.x, chest(t), t.z, 16, [2.0, 1.6, 0.6], 2, 0.6, 0.18, -1);
    sfx('holy');
    return;
  }
  if (A.line) {
    const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d, L = 40;
    spawnProjectile(e, null, 'arrow', null, { x: e.x + ux * L, y: heightAt(e.x + ux * L, e.z + uz * L) + 1.2, z: e.z + uz * L }, true);
    later(0.2, () => {
      forNear(e.x + ux * L / 2, e.z + uz * L / 2, L / 2 + 2, (o) => {
        if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
        const px = o.x - e.x, pz = o.z - e.z, along = px * ux + pz * uz;
        if (along < 0 || along > L) return;
        if (Math.abs(px * uz - pz * ux) > 1.3 + o.radius) return;
        const r = computeDamage(e, o, A.dmg * rk);
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'arrow' });
      });
    });
    sfx('bow');
  }
}
// the leap comes down: everything close is struck and staggered, and the ground takes the mark
function leapLand(e, A, rk) {
  if (!e.alive) return;
  const chest = (u) => u.y + 1.2 * (u.scale || 1);
  spawnSlash(e, true, 0.26);
  forNear(e.x, e.z, A.radius + 1.5, (o) => {
    if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(e.x, e.z, o.x, o.z) > A.radius + o.radius * (o.scale || 1)) return;
    const r = computeDamage(e, o, A.dmg * rk);
    dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee' });
    if (o.kind !== 'door' && o.role !== 'boss') { addBuff(o, 'stun', 1, A.stun, e.id); o.casting = null; FX.ring(o.x, chest(o) + 0.6, o.z, 0.4, [1.8, 1.8, 0.8], 12, 0.6); }
  });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU;
    fxAlpha.emit(e.x + Math.cos(a) * 0.6, e.y + 0.1, e.z + Math.sin(a) * 0.6, Math.cos(a) * (3 + Math.random() * 2), 0.6 + Math.random() * 0.8, Math.sin(a) * (3 + Math.random() * 2), 1.1, 0.42, 0.37, 0.3, 0.42, -0.1, 2.4);
  }
  FX.burst(e.x, e.y + 0.3, e.z, 18, [1.6, 1.3, 0.9], 5, 0.35, 0.1, 9);
  spellDisc(e.x, e.z, A.radius * 1.35, DISC_KIND.shock, 0.6, [1.4, 1.2, 0.9]);
  spellDisc(e.x, e.z, A.radius * 0.85, DISC_KIND.crack, 9, [1, 1, 1], 0.07);
  natureSwing(e, A.radius * 0.9, Math.PI, 0); natureImpact(e.x, e.z, 'leap', A.radius); // nature: grass cut, a dent in the ground, trees knocked
  cameraShake(0.32, e.x, e.z);
  sfx('slam');
}
function areaDamage(src, x, z, radius, mult, extra) {
  if (!src.alive && src.role !== 'player') return;
  forNear(x, z, radius, (o) => {
    if (!o.alive || !isEnemy(src, o) || !isActor(o)) return;
    const r = computeDamage(src, o, mult);
    dealDamage(src, o, r.d, { crit: r.crit, kind: (extra && extra.kind) || 'aoe' }); // [classes] an element can ride on an area blow
  });
}
/* delayed actions */
const LATER = [];
function later(dt, fn) { LATER.push({ t: GAME.t + dt, fn }); }
function runLater() {
  for (let i = LATER.length - 1; i >= 0; i--) {
    if (LATER[i].t <= GAME.t) { const f = LATER[i].fn; LATER.splice(i, 1); try { f(); } catch (err) { console.warn(err); } }
  }
}
const AOE_MARKS = [];
function aoeMarker(x, z, r, dur) { AOE_MARKS.push({ x, z, r, until: GAME.t + dur }); }

/* ------------------------------------------------------------------ */
/* auto attack                                                         */
/* ------------------------------------------------------------------ */
function autoAttack(e) {
  if (e.target == null || e.casting || e.carrying != null || e.mount || isStunned(e) || classNoAuto(e)) return; // [classes] not with the shield up, the bow drawn or at prayer
  if (e.rangedKind && e.swim) return; // [water] no shooting while swimming
  const t = getEnt(e.target);
  if (!t || !t.alive || !isEnemy(e, t)) return;
  const now = GAME.t;
  if (now < e.swingAt) return;
  const d = dist(e.x, e.z, t.x, t.z);
  const tr = t.radius * (t.scale || 1);
  const reach = e.rangedKind ? e.rangedRange + tr : e.meleeRange * (e.scale || 1) + tr;
  if (d > reach) return;
  if (!e.rangedKind && t.kind !== 'door' && Math.abs(t.y - e.y) > 2.6 && (elevatedEnt(e) || elevatedEnt(t))) return; // [keeps] no blow from the foot of a wall to its walk
  if (towerSightBlocked(e, t)) return; // [keeps] nor through a tower's floor, a shut hatch or its wall (04m_ladders.js)
  if (e.role === 'player' && Math.abs(angDiff(e.yaw, Math.atan2(t.x - e.x, t.z - e.z))) > 1.4 && d > 2.5) return;
  e.swingAt = now + e.swing * (0.95 + Math.random() * 0.1);
  faceToward(e, t.x, t.z);
  if (e.rangedKind) {
    setAct(e, e.rangedKind === 'arrow' ? 2 : 3, e.rangedKind === 'arrow' ? 0.6 : 0.45);
    const pk = classAutoKind(e); // [classes] a mage's bolt takes the element of the focus (07b_classes.js)
    later(e.rangedKind === 'arrow' ? 0.45 : 0.3, () => { if (e.alive && t.alive) spawnProjectile(e, t, pk, { mult: e.rangedKind === 'arcane' ? 0.9 : 1.0, auto: true }); });
    if (e.role === 'player') sfx(e.rangedKind === 'arrow' ? 'bow' : 'zap');
  } else {
    setAct(e, e.mobType === 'troll' ? 8 : 1, e.kind === 'humanoid' ? 0.6 : 0.45);
    later(0.26, () => {
      if (!e.alive || !t.alive) return;
      if (dist(e.x, e.z, t.x, t.z) > reach + 1.2) return;
      const r = computeDamage(e, t, 1);
      spawnSlash(e, e.mobType === 'troll');
      dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee', auto: true }); // [classes] auto: a plain blow (momentum, weapon styles)
      if (t.kind !== 'door') FX.sparks(t.x, t.y + 1.1 * (t.scale || 1), t.z);
      else FX.dust(t.x, t.y + 1, t.z, 4, [0.4, 0.3, 0.2]);
      if (e.role === 'player' || t.role === 'player') sfx(t.kind === 'door' ? 'thud' : 'hit');
    });
  }
}

/* ------------------------------------------------------------------ */
/* projectiles                                                         */
/* ------------------------------------------------------------------ */
const PROJ = [];
const PROJ_COL = { arrow: null, fire: [2.4, 1.0, 0.3], frost: [0.7, 1.4, 2.4], holy: [2.2, 1.9, 0.9], arcane: [1.1, 0.7, 2.2], wisp: [0.7, 1.9, 1.6], meteor: [2.6, 1.1, 0.35], firearrow: [2.4, 1.05, 0.3], deadeye: [2.2, 2.0, 1.5], ice: [0.8, 1.3, 2.2] };
const ARROWLIKE = { arrow: true, firearrow: true, deadeye: true };
const PROJ_SPEED = { arrow: 46, firearrow: 44, deadeye: 95, meteor: 32, ice: 30 };
function spawnProjectile(src, target, kind, payload, point = null, visualOnly = false, from = null) {
  const sc = src.scale || 1;
  const sx = from ? from.x : src.x + Math.sin(src.yaw) * 0.4, sz = from ? from.z : src.z + Math.cos(src.yaw) * 0.4;
  const sy = from ? from.y : src.y + 1.45 * sc;
  PROJ.push({
    kind, src: src.id, srcFaction: src.faction, tgt: target ? target.id : null, point,
    x: sx, y: sy, z: sz, ox: sx, oy: sy, oz: sz,
    speed: PROJ_SPEED[kind] || 24, payload, visualOnly, age: 0, life: 3.5,
    dx: 0, dy: 0, dz: 1,
  });
}
function updateProjectiles(dt) {
  for (let i = PROJ.length - 1; i >= 0; i--) {
    const p = PROJ[i];
    p.age += dt;
    const t = getEnt(p.tgt);
    let tx, ty, tz;
    if (p.point) { tx = p.point.x; ty = p.point.y; tz = p.point.z; }
    else if (t) { tx = t.x; ty = t.kind === 'door' ? t.y + 2.5 : t.kind === 'dragon' ? t.y + 2.8 : t.y + 1.15 * (t.scale || 1); tz = t.z; }
    else { PROJ.splice(i, 1); continue; }
    const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z, d = Math.hypot(dx, dy, dz);
    const step = p.speed * dt;
    if (d <= step + 0.3 || p.age > p.life) {
      PROJ.splice(i, 1);
      if (!p.visualOnly && t && t.alive) {
        const src = getEnt(p.src) || { level: 1, dmgMult: 1, faction: p.srcFaction, buffs: [], role: 'none', scale: 1, alive: false };
        const pl = p.payload || {};
        const r = computeDamage(src, t, pl.mult || 1);
        dealDamage(src, t, r.d, { crit: r.crit, kind: ARROWLIKE[p.kind] ? 'arrow' : p.kind, pierce: pl.pierce || pl.arrow === 'bodkin' ? BODKIN_PIERCE : false /* [balance3] Deadeye and bodkins go through half the armour */, arrow: pl.arrow, elem: pl.arrow === 'fire' || p.kind === 'firearrow' ? 'fire' : undefined, auto: !!pl.auto }); // [classes] arrow heads and elements
        if (pl.snare) addBuff(t, 'snare', pl.snare[0], pl.snare[1], p.src);
        if (pl.burn && t.alive) { const b = computeDamage(src, t, pl.burn[0]); addBuff(t, 'burn', b.d / pl.burn[1], pl.burn[1], p.src); }
      }
      if (p.kind === 'deadeye') spellRibbon([p.ox, p.oy, p.oz], [tx, ty, tz], 'tracer', [1.8, 1.6, 1.1], 0.16, 0.45);
      const c = PROJ_COL[p.kind];
      if (c && p.kind !== 'meteor') spellImpact(p.kind, tx, ty, tz);
      if (p.kind === 'fire' || p.kind === 'firearrow') {
        fireLandsAt(tx, ty, tz, 1, getEnt(p.src) || { faction: p.srcFaction }); // [depth] the caster
        // aimed at a tree or a patch of grass (09d_brand.js natureFireAim): what was aimed at catches for certain
        if (p.point && p.point.tree) igniteTree(p.point.tree, 0.9);
        if (p.point && p.point.grass) igniteGrass(p.point.x, p.point.z, 1.0, 4, 1);
      }
      else if (c) FX.burst(tx, ty, tz, 4, c, 3, 0.4, 0.16, 2);
      else if (!p.visualOnly && t) FX.sparks(tx, ty, tz);
      continue;
    }
    p.dx = dx / d; p.dy = dy / d; p.dz = dz / d;
    p.x += p.dx * step; p.y += p.dy * step; p.z += p.dz * step;
    // a gentle arc for arrows (the deadeye shot flies flat)
    if (p.kind === 'arrow' || p.kind === 'firearrow') {
      const tot = Math.hypot(tx - p.ox, tz - p.oz) || 1, done = Math.hypot(p.x - p.ox, p.z - p.oz);
      p.vis = Math.sin(clamp(done / tot, 0, 1) * Math.PI) * tot * 0.06;
    } else p.vis = 0;
    const c = PROJ_COL[p.kind];
    if (c) {
      if (p.kind === 'ice') FX.trail(p.x, p.y, p.z, c, 0.12, 0.16);
      else if (p.kind === 'deadeye') FX.trail(p.x, p.y, p.z, c, 0.1, 0.22);
      else if (p.kind === 'firearrow') { FX.trail(p.x, p.y, p.z, c, 0.2, 0.32); if (Math.random() < 0.3) fxAlpha.emit(p.x, p.y, p.z, 0, 0.5, 0, 0.9, 0.16, 0.14, 0.13, -0.25, -0.1, 0.4); }
      else FX.trail(p.x, p.y, p.z, c, p.kind === 'meteor' ? 0.9 : 0.24, p.kind === 'meteor' ? 0.5 : 0.3);
    }
  }
}
function drawProjectiles() {
  for (const p of PROJ) {
    const c = PROJ_COL[p.kind];
    if (ARROWLIKE[p.kind]) arrowPush(p.x, p.y + (p.vis || 0), p.z, p.dx, p.dy + (p.vis ? 0.06 : 0), p.dz);
    if (c && ARROWLIKE[p.kind]) glowPush(p.x + p.dx * 0.38, p.y + (p.vis || 0) + p.dy * 0.38, p.z + p.dz * 0.38, c[0], c[1], c[2], p.kind === 'deadeye' ? 0.5 : 0.42);
    else if (p.kind === 'ice') glowPush(p.x, p.y, p.z, c[0], c[1], c[2], 0.32);
    else if (c) { glowPush(p.x, p.y, p.z, c[0], c[1], c[2], p.kind === 'meteor' ? 2.4 : 0.7); glowPush(p.x, p.y, p.z, c[0] * 0.3, c[1] * 0.3, c[2] * 0.3, p.kind === 'meteor' ? 6 : 1.8); }
  }
}

/* ------------------------------------------------------------------ */
/* progression                                                         */
/* ------------------------------------------------------------------ */
function grantKillRewards(e) {
  const prog = GAME.prog, P = GAME.player;
  if (!prog || !P) return;
  if (e.kind === 'door') return;
  const ci = conIndex(e.level, prog.level);
  rollLoot(e);
  huntOnKill(e); // [survival] meat, hides and bone from a hunt (09s_survival.js)
  depthOnKill(e); // [depth] feathers and game birds, grave-iron, dragon scales and champions' trophies (09u_depth.js)
  if (e.role === 'dungeonBoss') {
    addXP(Math.round(20 * e.level * Math.max(0.5, CON[ci].xp) * 10), e);
    addRP(150);
    prog.kills++;
    uiToast(`You have laid ${e.name} to rest.`, 'quest');
    return;
  }
  if (e.role === 'boss') {
    addXP(Math.round(20 * e.level * Math.max(0.5, CON[ci].xp) * 14), e);
    addRP(300);
    prog.kills++;
    uiToast(`You helped bring down ${e.name}!`, 'quest');
    return;
  }
  if (e.faction === FACTION_MONSTER) {
    const xp = Math.round(20 * e.level * CON[ci].xp * (e.mobType === 'troll' || e.mobType === 'bear' ? 1.2 : 1));
    if (xp > 0) addXP(xp, e);
    prog.kills++;
    bountyOnKill(e);
  } else if (e.faction <= 2 && e.faction !== P.faction) {
    const mult = e.role === 'lord' ? 5 : e.role === 'guardian' ? 3 : e.role === 'guard' ? 1.3 : 1;
    addRP(Math.round((10 + 2 * e.level) * mult));
    const xp = Math.round(14 * e.level * Math.max(0.3, CON[ci].xp));
    addXP(xp, e);
    prog.realmKills++;
  }
}
function addXP(n, src = null) {
  const prog = GAME.prog;
  if (prog.level >= LEVEL_CAP) return;
  prog.xp += n;
  uiLog(`You gain ${fmtInt(n)} experience.`, 'xp');
  while (prog.level < LEVEL_CAP && prog.xp >= xpToNext(prog.level)) {
    prog.xp -= xpToNext(prog.level);
    prog.level++;
    onLevelUp();
  }
  if (prog.level >= LEVEL_CAP) prog.xp = 0;
}
function addRP(n) {
  const prog = GAME.prog;
  const before = realmRank(prog.rp);
  prog.rp += n;
  uiLog(`You gain ${fmtInt(n)} realm points.`, 'rp');
  const after = realmRank(prog.rp);
  if (after > before) {
    setupStats(GAME.player, true);
    uiToast(`Realm rank ${after}: ${RANK_TITLES[after - 1]}`, 'rank');
    sfx('levelup');
  }
}
function onLevelUp() {
  const P = GAME.player, prog = GAME.prog;
  P.level = prog.level;
  setupStats(P, false);
  FX.levelUp(P.x, P.y, P.z);
  lightFlash(P.x, P.y + 1.5, P.z, 10, [2.6, 2.1, 1.0], 1.2);
  sfx('levelup');
  flashScreen([1.0, 0.85, 0.4], 0.35);
  const newAb = CLASSES[P.cls].abilities.map((k) => ABILITIES[k]).filter((A) => A.level === prog.level);
  const rankUp = prog.level > 20 && (prog.level - 20) % 10 === 0;
  uiToast(`Level ${prog.level}` + (newAb.length ? `. New ability: ${newAb.map((a) => a.name).join(', ')}` : '') + (rankUp ? `. Your abilities reach rank ${RANK_NUMERAL[abilityRank(prog.level)]}` : ''), 'level');
  uiLog(`You have reached level ${prog.level}.`, 'level');
  if (rankUp) uiLog(`Every ability you know grows stronger: rank ${RANK_NUMERAL[abilityRank(prog.level)]}.`, 'level');
  buildHotbar();
  if (prog.level > 20) rescaleWar();
  saveSoon();
}
