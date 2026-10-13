/* ================================================================== */
/* [keeps] fighting on a ladder and at a hatch                         */
/* ================================================================== */
// A body on the rungs of a tower's ladder (04l_towers.js) keeps one hand on them: it can strike and be struck, but
// its blows are weaker (LADDER.blow; LADDER.ranged for a body that fights with a bow or a staff), it cannot raise a
// shield or parry (canBlock, 07b_classes.js), draw a bow, cast a two-handed spell or leap, charge, tumble or blink
// (ladderAllows, asked by canUse). A heavy blow (a share of its health, a smash, a blunt arrow), any stun (a parry's
// too: addBuff asks ladderOnStun) or a hatch slammed on its head knocks it off: it falls to the floor below and the
// fall harms it by the height (LADDER.fall), and winds it. A foe in reach on the way holds a climber, who fights it
// from the rungs. A shut hatch with a foe standing on it cannot simply be pushed open from below: the climber heaves at
// it, and now and then it gives and throws whoever stood on it aside. A defender at an open hatch can drop the lid on
// a climber coming up through it (E: 'Slam the hatch on them', or an NPC of the garrison by itself), and the
// garrison's archers step onto a shut hatch while foes climb beneath it. Through a shut hatch, a floor or a wall,
// nobody is seen or struck (towerSightBlocked, asked by inSight and autoAttack). The player chooses the way on the
// rungs: W (or the stick up) climbs on, S (or the stick down) goes back; E offers the same; a target in reach is
// struck from the rungs (body action 18: a blow from the ladder, 05a_rig.js).

const LADDER = {
  blow: 0.6, ranged: 0.4, // a blow struck from the rungs, as a share of a full one
  knock: 0.12, // a blow of this share of the climber's health knocks it off
  reach: 1.9, // how far from the ladder's line a climber can strike
  fall: { safe: 1.6, perM: 0.075, max: 0.65, wind: 0.7 }, // fall harm: none below safe, then perM of health a metre, at most max; winded for wind s
  push: { npc: 0.2, player: 0.08 }, // the chance a heave from below throws the lid open against a foe standing on it
  slam: 0.45, // a garrison body at an open hatch drops the lid on a foe coming up, this chance a second
  stats: { blows: 0, knocked: 0, falls: 0, slams: 0, heaves: 0, held: 0, burst: 0, holds: 0 },
};
const onLadder = (e) => !!(e && e.motion && e.motion.kind === 'ladder' && e.motion.st !== 3);
// a blow struck from the rungs is weaker (computeDamage asks)
const ladderWeak = (e) => (onLadder(e) ? (e.rangedKind ? LADDER.ranged : LADDER.blow) : 1);
// what one hand on the rungs leaves you (canUse asks): no bow, no two-handed spell, nothing that moves the body
function ladderAllows(e, A) {
  if (!onLadder(e)) return null;
  if (A.anim === 2 || A.proj === 'arrow' || A.cast > 0 || A.dash || A.leap || A.spin || A.blink || A.dashBack || A.ground || A.line) return 'ladder';
  return null;
}

/* ------------------------------------------------------------------ */
/* who can be struck from where                                        */
/* ------------------------------------------------------------------ */
// can e (on the ladder of motion m) strike t from the rungs?
function ladderCanStrike(e, t, m) {
  if (!t || !t.alive || t.kind === 'door' || t.flying) return false;
  const L = m.L, Hh = L.hatch, dy = t.y - e.y;
  if (dy < -2.3 || dy > 2.5) return false;
  if (dist(e.x, e.z, t.x, t.z) > LADDER.reach + t.radius * (t.scale || 1)) return false;
  // a shut hatch between them: no; a foe on the floor above is reached once head and shoulders are through the hatch
  if (t.y > L.wyt - 0.3 && e.y < L.wyt - 0.3 && ((Hh && Hh.k < 0.5) || e.y < L.wyt - 1.7)) return false;
  return !towerSightBlocked(e, t);
}
// the nearest foe e can strike from the rungs
function ladderFoe(e, m) {
  let best = null, bd = Infinity;
  forNear(e.x, e.z, 3.4, (o) => {
    if (o === e || !o.alive || o.kind === 'door' || o.role === 'critter' || !isEnemy(e, o)) return;
    if (!ladderCanStrike(e, o, m)) return;
    const s = dist(e.x, e.z, o.x, o.z) + Math.abs(o.y - e.y) * 0.5;
    if (s < bd) { bd = s; best = o; }
  });
  return best;
}
// a foe climbing L up through its hatch, its head in the opening (for the player's E and the garrison)
function ladderFoeBelow(e, L) {
  for (const o of LADDER_CLIMBERS) {
    const m = o.motion;
    if (!m || m.L !== L || m.st !== 1 || !o.alive || o.removed || !isEnemy(e, o)) continue;
    if (o.y + 1.85 > L.wyt - 0.6) return o;
  }
  return null;
}
const LADDER_CLIMBERS = new Set();

/* ------------------------------------------------------------------ */
/* on the rungs (towerLadderStep asks each step): 1 to climb on, 0 to  */
/* hold                                                                */
/* ------------------------------------------------------------------ */
function ladderRungs(e, m, dt) {
  const P = GAME.player;
  LADDER_CLIMBERS.add(e);
  // the pose: climbing (14), held at its middle while the climb lasts, or a blow from the ladder (18); a standing blow
  // started on the rungs (an ability's) is drawn as one from the ladder
  if (e.anim.act === 1 || e.anim.act === 8 || e.anim.act === 9) setAct(e, 18, 0.6);
  else if (e.anim.act !== 14 && e.anim.act !== 18) setAct(e, 14, 2, 0.5);
  if (e.anim.act === 14 && e.anim.actT > e.anim.actDur * 0.9) e.anim.actT = e.anim.actDur * 0.5;
  if (e.anim.act === 18 && e.anim.actT > e.anim.actDur * 0.92) setAct(e, 14, 2, 0.5);
  // the player chooses the way: a fresh press of W or the stick up climbs on, S or the stick down goes back
  if (e === P) {
    let f = 0;
    if (!UI.modal) {
      if (keyDown('KeyW', 'ArrowUp')) f += 1;
      if (keyDown('KeyS', 'ArrowDown')) f -= 1;
      if (INPUT.joy) f += -INPUT.joy.dy;
    }
    if (Math.abs(f) < 0.3) m.lock = false;
    else if (!m.lock && m.st === 1 && Math.sign(f) !== m.dir) { m.dir = Math.sign(f); m.lock = true; }
  }
  // a foe in reach on the way holds the climber, who fights it from the rungs
  const foe = ladderFoe(e, m);
  m.foe = foe ? foe.id : null;
  let go = 1;
  if (foe) {
    const ahead = m.dir > 0 ? foe.y > e.y - 0.4 : foe.y < e.y + 0.4;
    if (ahead) { go = 0; m.held = (m.held || 0) + dt; ladderHeldTurn(e, m); } // [war2] held 25 s: back the way it came (08j_war2.js)
    if (e !== P && !isStunned(e) && GAME.t >= (e.swingAt || 0)) { e.target = foe.id; ladderStrike(e, foe); }
  } else m.held = 0;
  // the player's target in reach is struck from the rungs, at the pace of the auto-attack
  if (e === P && P.target != null && !isStunned(P) && GAME.t >= (P.swingAt || 0)) {
    const t = getEnt(P.target);
    if (t && isEnemy(P, t) && ladderCanStrike(P, t, m)) ladderStrike(P, t);
  }
  if (isStunned(e)) go = 0;
  return go;
}
// a blow from the rungs: one hand on the ladder, the other striking
function ladderStrike(e, t) {
  e.swingAt = GAME.t + (e.swing || 2.4) * (0.95 + Math.random() * 0.1);
  setAct(e, 18, 0.6);
  later(0.26, () => {
    if (!e.alive || !t.alive || !onLadder(e) || !ladderCanStrike(e, t, e.motion)) return;
    const r = computeDamage(e, t, 1); // (weaker from the rungs: ladderWeak)
    spawnSlash(e, false);
    dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee', auto: true, ladder: true });
    FX.sparks(t.x, t.y + 1.1 * (t.scale || 1), t.z);
    sfxAtE('hit', t); // [audio2] placed (11c_sound.js)
    LADDER.stats.blows++;
  });
}
// turn back on the rungs
function ladderTurn(e, dir) {
  const m = e.motion;
  if (!m || m.kind !== 'ladder' || m.st !== 1) return false;
  m.dir = dir; m.lock = true;
  return true;
}

/* ------------------------------------------------------------------ */
/* the hatch: pushed from below, held from above, slammed              */
/* ------------------------------------------------------------------ */
// the world axes of a hatch's lid: along its ladder (out from the tower's middle) and across it
function ladderLidAxes(Hh) { const a = Hh.T.S.yaw + Hh.a; return { vx: Math.sin(a), vz: Math.cos(a), ux: Math.cos(a), uz: -Math.sin(a) }; }
// who stands on a shut lid (foes of `of` only, when given)
function ladderLidStanders(Hh, of = null) {
  const out = [], A = ladderLidAxes(Hh);
  forNear(Hh.cx, Hh.cz, 1.8, (o) => {
    if (!o.alive || o.kind === 'door' || o.role === 'critter' || o.motion || Math.abs(o.y - Hh.y) > 0.35) return;
    if (of && !isEnemy(of, o)) return;
    const dx = o.x - Hh.cx, dz = o.z - Hh.cz, u = dx * A.ux + dz * A.uz, v = dx * A.vx + dz * A.vz, r = o.radius * (o.scale || 1) * 0.6;
    if (Math.abs(u) < Hh.hw + r && Math.abs(v) < Hh.hd + r) out.push(o);
  });
  return out;
}
// a body standing on a lid that is thrown or swung open steps (or staggers) off it, toward the middle of the room
function ladderShoveOff(o, Hh, stagger) {
  const A = ladderLidAxes(Hh), side = o.x - Hh.cx, sz = o.z - Hh.cz, u = side * A.ux + sz * A.uz;
  for (const d of [1.3, 1.0, 1.7]) {
    // off the inner end of the lid (toward the tower's middle), or to its side
    for (const [mv, mu] of [[-(Hh.hd + d * 0.6), 0], [0, Math.sign(u || 1) * (Hh.hw + d * 0.6)], [0, -Math.sign(u || 1) * (Hh.hw + d * 0.6)]]) {
      const x = Hh.cx + A.vx * mv + A.ux * mu, z = Hh.cz + A.vz * mv + A.uz * mu;
      if (Math.abs(floorAt(x, z, Hh.y + 0.1) - Hh.y) > 0.2) continue;
      o.x = x; o.z = z; o.y = Hh.y;
      if (o.prevX !== undefined) { o.prevX = x; o.prevZ = z; }
      if (stagger) { setAct(o, 4, 0.45); FX.dust(x, Hh.y, z, 6); }
      return true;
    }
  }
  return false;
}
// a climber below a shut hatch pushes it open, unless a foe stands on it; then it heaves at it every so often, and
// now and then the lid gives and throws whoever stood on it aside
function ladderPush(e, Hh) {
  if (Hh.k > 0.05) { Hh.until = Math.max(Hh.until, GAME.t + 1.2); return; }
  const foes = ladderLidStanders(Hh, e);
  if (!foes.length) {
    // friends (and anyone neutral) standing on it step off before it opens under them
    for (const o of ladderLidStanders(Hh)) if (o !== GAME.player) ladderShoveOff(o, Hh, false);
    if (!ladderLidStanders(Hh).length) Hh.until = Math.max(Hh.until, GAME.t + 1.2);
    return;
  }
  if (GAME.t < (Hh.heaveAt || 0)) return;
  Hh.heaveAt = GAME.t + 1.3 + Math.random() * 0.5;
  Hh.bump = 0.14;
  LADDER.stats.heaves++;
  const P = GAME.player;
  sfxAt('thud', Hh.x, Hh.y, Hh.z); // [audio2] placed (11c_sound.js)
  if (Math.random() < (foes.includes(P) ? LADDER.push.player : LADDER.push.npc)) {
    for (const o of foes) ladderShoveOff(o, Hh, true);
    Hh.until = GAME.t + 2.2; Hh.k = 0.35;
    LADDER.stats.burst++;
    if (foes.includes(P)) uiLog('The hatch heaves up under your feet and throws you aside!', 'warn');
  } else {
    LADDER.stats.held++;
    if (foes.includes(P) && GAME.t > (Hh.toldAt || 0)) { Hh.toldAt = GAME.t + 6; uiLog('Someone is heaving at the hatch beneath you. Stand on it to hold it shut.', 'warn'); }
  }
}
// drop the lid on a foe coming up through the hatch: a heavy blow that knocks it off the ladder
function ladderSlam(e, Hh) {
  const foe = ladderFoeBelow(e, Hh.L);
  Hh.held = false; Hh.until = 0; Hh.slam = GAME.t + 0.5;
  setAct(e, 5, 0.4);
  LADDER.stats.slams++;
  const P = GAME.player;
  sfxAt('thud', Hh.x, Hh.y, Hh.z); // [audio2] placed (11c_sound.js)
  if (foe) {
    const r = computeDamage(e, foe, 1.2);
    dealDamage(e, foe, Math.max(r.d, foe.maxHp * 0.1), { kind: 'slam', heavy: true, crit: r.crit });
    FX.dust(Hh.cx, Hh.y, Hh.cz, 10, [0.5, 0.42, 0.32]);
    if (e === P) uiLog(`You slam the hatch down on ${theName(foe)}!`, 'dmg');
    else if (foe === P) uiLog('The hatch slams down on your head!', 'hurt');
  }
  return foe;
}

/* ------------------------------------------------------------------ */
/* knocked off, and the fall                                           */
/* ------------------------------------------------------------------ */
// dealDamage asks: a heavy blow, a smash or a blunt arrow knocks a climber off its ladder
function ladderOnHit(src, dst, dmg, opts) {
  if (!onLadder(dst) || !dst.alive || opts.dot) return;
  const smash = opts.kind === 'melee' && src && src.anim && (src.anim.act === 8 || src.anim.act === 9);
  if (opts.heavy || opts.arrow === 'blunt' || smash || dmg >= LADDER.knock * dst.maxHp) ladderKnockOff(dst, src);
}
// addBuff asks: any stun (a parry's, a bash, a freeze) knocks a climber off
function ladderOnStun(e, src) {
  if (onLadder(e) && e.alive) ladderKnockOff(e, typeof src === 'number' ? getEnt(src) : src && src.id != null ? src : null);
}
function ladderKnockOff(e, by) {
  const m = e.motion;
  if (!m || m.kind !== 'ladder' || m.st === 3) return false;
  const L = m.L, side = Math.random() < 0.5 ? -1 : 1, a = L.T.S.yaw + L.a;
  // off the rungs, a little to one side of the ladder, and down
  m.st = 3; m.t = 0; m.vy = 0.6; m.y0 = e.y; m.by = by ? by.id : null;
  m.dx = Math.cos(a) * side * 1.1; m.dz = -Math.sin(a) * side * 1.1;
  e.casting = null;
  setAct(e, 6, 3);
  LADDER.stats.knocked++;
  const P = GAME.player;
  if (e === P) uiLog('You are knocked off the ladder!', 'hurt');
  else if (by === P) uiLog(`You knock ${theName(e)} off the ladder!`, 'dmg');
  sfxAtE('hit', e); // [audio2] placed (11c_sound.js)
  return true;
}
// a body knocked off a ladder falls to the floor below (towerLadderStep hands it here)
function ladderFallStep(e, m, dt) {
  m.t += dt;
  m.vy -= 18 * dt;
  const ny = e.y + m.vy * dt;
  if (m.t < 0.45) {
    // sideways off the rungs, unless a wall is there
    const nx = e.x + m.dx * dt, nz = e.z + m.dz * dt;
    _lfM.x = nx; _lfM.z = nz;
    resolveCollisions(_lfM, e.radius * (e.scale || 1) * 0.9, ny, e.faction);
    e.x = _lfM.x; e.z = _lfM.z;
  }
  e.onGround = false;
  const gy = floorAt(e.x, e.z, Math.max(ny, e.y - 0.6));
  if (ny > gy) {
    e.y = ny;
    // [motion5] the last of a fall from more than a step: the legs reach down for the ground and take it bent at the knees
    // (the crouch, action 13: its feet set on the ground by IK), and the body rises from it (it came down with its legs
    // tucked up under it and stood up straight in the same frame, the feet flicking down 30 cm)
    if (ny - gy < 0.5 && m.y0 - gy > 0.9 && e.anim.act !== 13) setAct(e, 13, 0.8);
    return true;
  }
  // landed
  e.y = gy; e.motion = null; e.onGround = true; e.vy = 0;
  if (e.prevX !== undefined) { e.prevX = e.x; e.prevZ = e.z; }
  LADDER_CLIMBERS.delete(e);
  const h = m.y0 - gy, k = clamp((h - LADDER.fall.safe) * LADDER.fall.perM, 0, LADDER.fall.max);
  FX.dust(e.x, gy, e.z, 10);
  if (!(e.anim.act === 13 && e.anim.actDur > 0)) setAct(e, 4, 0.5); // [motion5] (a fall from more than a step lands in the crouch)
  LADDER.stats.falls++;
  const P = GAME.player;
  sfxAtE('thud', e, null, 0.2); // [audio2] placed (11c_sound.js)
  if (k > 0) {
    // the fall harms by the height: no armour stops it
    const harm = e.maxHp * k, by = m.by != null ? getEnt(m.by) : null;
    e.hp -= harm; e.anim.flash = 1; e.combatUntil = GAME.t + 6;
    if (e === P) { uiFloatAt(P.x, P.y + 2.0, P.z, `-${Math.round(harm)}`, 'hurt'); uiLog(`You fall ${h.toFixed(1)} m and take ${Math.round(harm)} damage.`, 'hurt'); flashScreen([0.55, 0.05, 0.03], 0.25); }
    else if (by === P) uiFloatAt(e.x, e.y + 2.1, e.z, `${Math.round(harm)}`, '');
    if (e.hp <= 0) { killEnt(e, by); return true; }
    if (k > 0.05) addBuff(e, 'stun', 1, LADDER.fall.wind, 'fall');
  }
  return true;
}
const _lfM = { x: 0, z: 0 };

/* ------------------------------------------------------------------ */
/* each step: the garrison at the hatches                              */
/* ------------------------------------------------------------------ */
function updateLadders(dt) {
  for (const e of LADDER_CLIMBERS) if (!e.alive || e.removed || !e.motion || e.motion.kind !== 'ladder') LADDER_CLIMBERS.delete(e);
  for (const Hh of TOWER.hatches) {
    const L = Hh.L;
    let below = null;
    for (const o of LADDER_CLIMBERS) { const m = o.motion; if (m && m.L === L && m.st === 1 && m.dir > 0) { below = o; break; } }
    // a foe coming up through an open hatch: a garrison body beside it drops the lid on its head
    if (below && Hh.k > 0.5 && below.y + 1.85 > L.wyt - 0.6 && Math.random() < LADDER.slam * dt) {
      let d0 = null;
      forNear(Hh.cx, Hh.cz, 2.6, (o) => { if (!d0 && o !== GAME.player && o.alive && !o.motion && o.kind === 'humanoid' && isEnemy(o, below) && Math.abs(o.y - Hh.y) < 0.5 && !isStunned(o) && !o.casting) d0 = o; });
      if (d0) ladderSlam(d0, Hh);
    }
    // an archer of the garrison steps onto a shut hatch while foes climb beneath it, and goes back to its post after
    const hold = Hh.holder != null ? getEnt(Hh.holder) : null;
    if (Hh.holder != null && !(hold && hold.alive && hold.ai.hatch)) Hh.holder = null;
    if (below && Hh.k < 0.3 && Hh.holder == null) {
      let pick = null;
      forNear(Hh.cx, Hh.cz, 7, (o) => { if (!pick && o.ai && o.ai.wall && !o.ai.hatch && o.alive && !o.motion && Math.abs(o.y - Hh.y) < 0.6 && isEnemy(o, below)) pick = o; });
      if (pick) {
        pick.ai.hatch = { Hh, post: pick.ai.post, until: GAME.t + 4 };
        pick.ai.post = { x: Hh.cx, z: Hh.cz, leash: 0 };
        Hh.holder = pick.id;
        LADDER.stats.holds++;
      }
    }
  }
  // garrison bodies holding a hatch go back to their posts once nobody has climbed beneath it for a while
  for (const e of ENT) {
    const h = e.ai && e.ai.hatch;
    if (!h) continue;
    const busy = [...LADDER_CLIMBERS].some((o) => o.motion && o.motion.L === h.Hh.L && isEnemy(e, o));
    if (busy) h.until = GAME.t + 4;
    if (!e.alive || GAME.t > h.until) { e.ai.post = h.post; e.ai.hatch = null; }
  }
}

// E (the pad's Use) on a ladder: turn back
function ladderOffers(P, offer) {
  const m = P.motion;
  if (!m || m.kind !== 'ladder' || m.st !== 1) return;
  offer(0.05, 1, m.dir > 0 ? 'Climb back down' : 'Climb back up', () => ladderTurn(P, -m.dir), 0.2);
}

/* ------------------------------------------------------------------ */
/* sight in the towers: a floor, a shut hatch or a wall between       */
/* ------------------------------------------------------------------ */
// can a body in a tower's room see past its walls to b, through an open door or a slit, at about the same height?
function towerOpeningSees(T, a, b) {
  const la = twLocal(T, a.x, a.z), lb = twLocal(T, b.x, b.z);
  const mid = (T.RI + T.RO) / 2;
  let t = null;
  // where the line from a to b crosses the middle of the wall
  const dx = lb.x - la.x, dz = lb.z - la.z;
  if (T.kind === 'drum') {
    const A = dx * dx + dz * dz, B = 2 * (la.x * dx + la.z * dz), Cc = la.x * la.x + la.z * la.z - mid * mid, disc = B * B - 4 * A * Cc;
    if (A < 1e-6 || disc < 0) return false;
    t = (-B + Math.sqrt(disc)) / (2 * A);
  } else {
    for (const [p, d] of [[la.x, dx], [la.z, dz]]) for (const s of [-1, 1]) { if (Math.abs(d) < 1e-6) continue; const q = (s * mid - p) / d; if (q > 0 && (t === null || q < t)) { const ox = la.x + dx * q, oz = la.z + dz * q; if (Math.max(Math.abs(ox), Math.abs(oz)) <= mid + 1e-3) t = q; } }
  }
  if (t === null || t < 0 || t > 1) return t !== null && t > 1; // b inside the walls too
  const cx = la.x + dx * t, cz = la.z + dz * t, eye = a.y + 1.5 - T.S.y;
  for (const D of T.doors) {
    if (D.k < 0.5 || eye < D.y || eye > D.y + D.h + 0.3) continue;
    const p = twP(T, D.a, mid, D.off || 0);
    if (Math.hypot(cx + T.cx - p.x, cz + T.cz - p.z) < 0.55) return true;
  }
  for (const s of T.slitsAt || []) {
    if (eye < s.y0 - 0.3 || eye > s.y1 + 0.3) continue;
    const p = twP(T, s.a, mid, s.off || 0);
    if (Math.hypot(cx + T.cx - p.x, cz + T.cz - p.z) < 0.2) return true;
  }
  return false;
}
// two bodies at different floors of a tower see each other only through an open hatch, near it
function towerHatchSees(T, a, b) {
  for (const L of T.ladders) {
    const Hh = L.hatch;
    if (!Hh || Hh.k < 0.5) continue;
    const lo = a.y < b.y ? a : b, hi = lo === a ? b : a;
    if (hi.y < L.wyt - 0.6 || lo.y > L.wyt - 0.3 || lo.y < L.wyb - 0.3) continue;
    const onIt = (o) => o.motion && o.motion.L === L;
    const nearLo = onIt(lo) || dist(lo.x, lo.z, Hh.cx, Hh.cz) < 2.2, nearHi = onIt(hi) || dist(hi.x, hi.z, Hh.cx, Hh.cz) < 3.0;
    if (nearLo && nearHi) return true;
  }
  return false;
}
// inSight and autoAttack ask: is there a floor, a shut hatch or a tower's wall between e and o?
function towerSightBlocked(e, o) {
  if (!TOWER.list.length || !e || !o) return false;
  const re = towerRoomOf(e), ro = towerRoomOf(o);
  if (!re && !ro) return false;
  if (re && ro && re.T === ro.T) return re.lv !== ro.lv && !towerHatchSees(re.T, e, o);
  if (re && ro) return !(re.top && ro.top);
  const A = re || ro, a = re ? e : o, b = re ? o : e;
  if (A.top) return false; // an open top, a gallery, a platform: seen like anyone on the walls
  if (towerHatchSees(A.T, a, b)) return false;
  if (Math.abs(a.y - b.y) > 2.4) return true;
  return !towerOpeningSees(A.T, a, b);
}
// the Chronicle's war page: the towers, their ladders and hatches, and fighting in them (chronWar, 10c_lore.js)
function towersChronHTML() {
  const k = LK(), touch = IS_TOUCH; // [walls] and what walls do to what flies, and breached towers (07g_walls.js, 04g_breach.js)
  return `<h3>Towers and ladders</h3>
    <p>Every tower of every keep can be entered. A door from the courtyard opens into a store room; ladders climb through hatches to the rooms above and onto the top: the open fighting tops of Logres, the platforms under thatch over the gates of \u00c9riu, the fighting galleries under the shingles of Thule. The rooms at the walls' height have doors onto the walks. The archers of a keep stand on its gate towers' tops, and walk up to them through the towers.</p>
    <ul class="how">
      <li><b>Climbing.</b> Walk into the foot of a ladder, or ${k.use} beside it. A shut hatch above is pushed open as you come up to it; ${k.use} by a hatch opens or shuts it. On the rungs, ${touch ? 'drag the stick up to climb on, down to go back' : 'W climbs on and S goes back'}.</li>
      <li><b>One hand on the rungs.</b> A climber strikes a foe in reach at about three fifths of a blow, and cannot raise a shield, parry, draw a bow, cast a two-handed spell or leap. A heavy blow, a stun, a parried blow or a blunt arrow knocks a climber off, and the fall hurts by its height.</li>
      <li><b>Holding a hatch.</b> Stand on a shut hatch and a foe below cannot simply push it open: they heave at it, and now and then it throws you aside. When a foe comes up through an open hatch, ${k.use} to slam the lid down on them. The garrison does both.</li>
      <li><b>Walls stop what flies.</b> Arrows, bolts and spells strike the first thing in their way: an arrow sticks in timber, thatch and daub and glances off stone, and a fire spell sets thatch and timber alight. Shots go out through a crenel, an arrow slit, an open window or door; an archer up on the walls shows at its crenel when it shoots, and can be struck there.</li>
      <li><b>Breaches.</b> The stone towers crack under siege stones and meteors and at last fall in: their upper rooms, ladders and hatches are lost, and the rubble is a way into the keep through the tower's store room. Once the keep is quiet its owners rebuild them behind scaffolding.</li>
      <li><b>Fire.</b> The log towers of Thule burn. A foe's fire spell, a burning arrow, the dragon's breath or a brand held to the logs (${k.use}) sets one alight; get out of it before its gallery and roof fall in. Rain damps a young fire. A burnt tower is built again once its keep has been quiet for a while.</li>
    </ul>`;
}
queueMicrotask(() => { if (window.__hm) window.__hm.ladders = { LADDER, LADDER_CLIMBERS, computeDamage, onLadder, ladderAllows, ladderCanStrike, ladderFoe, ladderFoeBelow, ladderPush, ladderSlam, ladderKnockOff, ladderTurn, ladderLidStanders, towerSightBlocked, towerOpeningSees, towerHatchSees }; });
