/* ================================================================== */
/* [late4] the late game alive                                          */
/* ================================================================== */
// (version 18) The risen move and look as what they are, the borderlands past 40 have foes that walk, a veteran's
// standard reads as one, and the deep remembers.
//  - Each kind of risen champion winds up as its body tells it: a humanoid's overhead smash (body action 8), a bear rearing
//    onto its hind legs and pawing the air (action 20), a wolf or a boar crouching to spring (action 22), on the beast rig
//    (05c_beasts.js): its feet planted where they stand. A stun as it rears or crouches sends it down at once.
//  - From the rally (half its strength) each kind has a second move on a clock of its own, so the fight changes as it
//    goes: a bear's maul, a wolf's pounce, a boar's gore rush, the dead's grave-hands, an outlaw's fire flask, a troll's
//    hurled boulder, a wisp's lure. Each warned of by a ring on the ground (aoeMarker: the skilled bots step out).
//  - Every risen champion is marked risen to the eye: embers in the veins of its coat or the seams of its mail, ember
//    eyes, scars across a beast's flanks, an outline that glows by day (the shaders: flag 512 for a humanoid, 4 above a
//    beast's second colour's green), a glow and rising embers about it (drawLate4), its name in ember on its plate.
//  - The roaming risen: past 40 a host of the risen walks each homeland's borderlands, from camp to camp along tracks
//    worked out once on the land (localPath), and fights what it meets; bringing its leader down is a deed (the name
//    Roadwarden at three), and it walks again a quarter of an hour later. Saved with the world (`world.x.roam`).
//  - The standard of your name is a veteran's: a long swallow-tailed flag on a taller pole (the banners' cloth, kind 2:
//    it streams, droops, soaks, gathers snow and tears where it is struck: 04_props.js), its device read from 15 m.
//  - The deep remembers: its dead, its slabs, its pitch and its water are saved as they lay (`char.x.deep4`), and it has
//    an air of its own (water in the cistern, embers under the gallery, the lord's hall: placed as audio2's are).

const LATE4 = {
  marked: new Set(), // the risen bodies drawn with their embers and glow (champions and the hosts)
  hosts: [], // the roaming risen, one a homeland
  bolts: [], // boulders in flight
  rushes: [], // gore rushes on their way
  air: null, // the deep's air: its own placed voices
  off: false, // (tests: no host walks: late4Measuring)
  frameSmall: false, // (the frame's name in the smaller letter: late4FrameName)
  stats: { windups: 0, broken: 0, seconds: 0, by: {}, hostSpawned: 0, hostFell: 0, hostFights: 0, routeLegs: 0, routeFails: 0, deepSaved: 0, deepLoaded: 0, tears: 0 },
};
const LATE4_HOST_AT = 40; // the level at which the hosts walk (the risen camps rise at the same)
const LATE4_HOST_BACK = 900; // seconds before a host brought down walks again
const LATE4_HOSTS = [
  { realm: 0, type: 'skeleton', name: 'the Pale Herald of the Roads', host: "the Herald's Host", n: 4 },
  { realm: 1, type: 'wolf', name: 'Grimhowl the Moon-Hunter', host: 'the Hunt of the Hollow Moon', n: 5 },
  { realm: 2, type: 'draugr', name: 'Jarl Ormr Road-Walker', host: 'the Road-Walkers', n: 4 },
];
// the second moves (from the rally), by kind
const LATE4_SECOND = { bear: 'maul', wolf: 'pounce', boar: 'gore', skeleton: 'hands', draugr: 'hands', bandit: 'flask', troll: 'boulder', wisp: 'lure' };
const LATE4_SECOND_NAME = { maul: 'Maul', pounce: 'Pounce', gore: 'Gore rush', hands: 'Grave-hands', flask: 'Fire flask', boulder: 'Hurled boulder', lure: 'Lure' };
const l4Cold = (e) => e.mobType === 'skeleton' || e.mobType === 'draugr';
const l4Col = (e) => (l4Cold(e) ? [0.55, 1.3, 2.4] : e.kind === 'wisp' ? [2.4, 0.9, 0.35] : [2.6, 0.85, 0.22]);

/* ------------------------------------------------------------------ */
/* marked risen to the eye                                             */
/* ------------------------------------------------------------------ */
// (late2OnSpawn, 10l_late.js, for a risen champion; late4HostSpawn for a host's bodies)
function late4MarkRisen(e) {
  const Lk = e.look;
  if (Lk) {
    if (e.kind === 'humanoid') Lk.flags = (Lk.flags || 0) | 512; // the people's shader (05a_rig.js)
    else if (e.kind !== 'wisp' && Lk.colB && Lk.colB[1] < 3.5) Lk.colB = [Lk.colB[0], Lk.colB[1] + 4, Lk.colB[2]]; // the beasts' (05c_beasts.js)
  }
  LATE4.marked.add(e);
}
// the glow and the embers about every risen body near the camera (tick, 13_main.js)
function drawLate4(dt) {
  const cx = camera.position.x, cz = camera.position.z, day = 1 - (U.uNight ? U.uNight.value : 0);
  for (const e of LATE4.marked) {
    if (e.removed || (!e.alive && e.anim.death >= 1)) { LATE4.marked.delete(e); continue; }
    if (!e.alive || inDungeon(e)) continue;
    const d2 = dist2(e.x, e.z, cx, cz);
    if (d2 > 170 * 170) continue;
    const sc = e.scale || 1, c = l4Col(e), champ = !!e.l2risen;
    const h = (e.kind === 'humanoid' ? 1.15 : e.kind === 'bear' ? 0.85 : e.kind === 'wisp' ? 0 : 0.55) * sc;
    const pulse = 0.8 + 0.2 * Math.sin(renderTime * 2.2 + e.id);
    // a glow that reads at every distance and by day (a beast's is lower, about its back)
    const k = (champ ? 1 : 0.55) * pulse * (0.55 + 0.45 * day);
    if (e.kind !== 'wisp') glowPush(e.x, e.y + h, e.z, c[0] * 0.32 * k, c[1] * 0.32 * k, c[2] * 0.32 * k, (champ ? 2.3 : 1.5) * sc);
    // embers rising off it (near the camera only)
    if (d2 < 70 * 70 && Math.random() < dt * (champ ? 26 : 9)) {
      const a = Math.random() * TAU, r = (0.15 + Math.random() * 0.35) * sc;
      fxAdd.emit(e.x + Math.cos(a) * r, e.y + h * (0.4 + Math.random() * 1.2), e.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.6, c[0], c[1], c[2], 0.05 + Math.random() * 0.05, -0.15, 0.6);
    }
  }
  late4DrawBolts(dt);
}

/* ------------------------------------------------------------------ */
/* the wind-ups as bodies                                              */
/* ------------------------------------------------------------------ */
// (late2ChampThink, 10l_late.js): a humanoid raises its weapon overhead (8), a bear rears (20), a wolf or a boar crouches (22)
function late4WindUp(e, total) {
  LATE4.stats.windups++;
  if (e.kind === 'humanoid') setAct(e, 8, total + 0.15);
  else if (e.mobType === 'bear') setAct(e, 20, total + 0.15);
  else if (e.mobType === 'wolf' || e.mobType === 'boar') setAct(e, 22, total + 0.15);
}
// a wind-up broken by a stun: a reared bear comes down, a crouched beast rises, now (not after the action's time)
function late4WindBroken(e) {
  const a = e.anim, k = a.act === 20 ? 0.77 : 0.83;
  if ((a.act !== 20 && a.act !== 22) || !(a.actDur > 0) || a.actT >= a.actDur * k) return;
  LATE4.stats.broken++;
  a.actT = a.actDur * k;
}

/* ------------------------------------------------------------------ */
/* the second moves                                                    */
/* ------------------------------------------------------------------ */
// (late2ChampThink: from the rally, on its own clock) true when it acted
function late4Second(e, t, d) {
  const way = LATE4_SECOND[e.mobType];
  if (!way || !t || !t.alive) return false;
  const now = GAME.t, y = e.y;
  if (way === 'maul') { // the bear rears and mauls what is before it: a heavy blow, the foe thrown back and torn
    if (d > 4.2) return false;
    turnToward(e, t.x, t.z, 9);
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), sc = e.scale || 1, mx = e.x + fx * 1.7 * sc, mz = e.z + fz * 1.7 * sc;
    aoeMarker(mx, mz, 2.4 * sc, 0.8, e.faction);
    spellDisc(mx, mz, 2.4 * sc, DISC_KIND.holy, 0.85, [1.9, 0.55, 0.16]);
    setAct(e, 1, 1.05); e.swingAt = Math.max(e.swingAt || 0, now + 1.3);
    late2Snd('roarSmall', e, 1.6);
    later(0.8, () => {
      if (!e.alive || isStunned(e)) return;
      forNear(mx, mz, 2.4 * sc + 0.6, (o) => {
        if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, mx, mz) > 2.4 * sc || Math.abs(o.y - y) > 2.5) return;
        const r = computeDamage(e, o, 1.5);
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee', heavy: true });
        addBuff(o, 'wound', 0.3, 8, e.id);
        late4Shove(o, o.x - e.x, o.z - e.z, 3.5);
        FX.blood(o.x, o.y + 1.1, o.z);
      });
      FX.dust(mx, heightAt(mx, mz), mz, 10); late2Snd('slam', e, 0.3);
    });
  } else if (way === 'pounce') { // the wolf crouches and springs at a foe some way off, bearing it down
    if (d < 6 || d > 16) return false;
    const tx = t.x, tz = t.z;
    aoeMarker(tx, tz, 2.0, 0.75, e.faction);
    Object.assign(AOE_MARKS[AOE_MARKS.length - 1], { stun: true, src: e.id });
    spellDisc(tx, tz, 2.0, DISC_KIND.holy, 0.8, [1.9, 0.55, 0.16]);
    turnToward(e, tx, tz, 20);
    setAct(e, 22, 0.75); e.swingAt = Math.max(e.swingAt || 0, now + 1.4);
    late2Snd('roarSmall', e, 0.8);
    later(0.7, () => {
      if (!e.alive || isStunned(e) || e.motion) return;
      const L = leapPlan(e, { x: tx, z: tz, radius: 0.4, scale: 1 });
      if (L.d < 2) return;
      const dur = 0.35 + L.d * 0.035;
      setAct(e, 6, dur);
      e.motion = { kind: 'leap', t: 0, dur, x0: e.x, z0: e.z, y0: e.y, x1: L.x, z1: L.z, y1: heightAt(L.x, L.z), h: 0.6 + L.d * 0.05, yaw: L.yaw, onLand: () => {
        FX.dust(e.x, e.y, e.z, 12);
        late2Snd('slam', e, 0.2);
        forNear(e.x, e.z, 2.6, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, e.x, e.z) > 2.3 || Math.abs(o.y - e.y) > 2) return;
          const r = computeDamage(e, o, 1.15);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee', heavy: true });
          addBuff(o, 'stun', 1, 0.8, e.id);
        });
      } };
    });
  } else if (way === 'gore') { // the boar lowers its tusks and charges down a line, tossing whatever stands in it
    if (d < 5 || d > 18) return false;
    const ux = (t.x - e.x) / Math.max(0.1, d), uz = (t.z - e.z) / Math.max(0.1, d);
    const R = dashReach(e, e.x, e.z, ux, uz, Math.min(20, d + 4));
    if (R.d < 4) return false;
    for (let i = 1; i <= 3; i++) { const s = (R.d * i) / 3.4, x = e.x + ux * s, z = e.z + uz * s; aoeMarker(x, z, 1.9, 0.85, e.faction); Object.assign(AOE_MARKS[AOE_MARKS.length - 1], { stun: true, src: e.id }); spellDisc(x, z, 1.9, DISC_KIND.holy, 0.9, [1.9, 0.55, 0.16]); }
    turnToward(e, t.x, t.z, 20);
    setAct(e, 22, 0.85); e.swingAt = Math.max(e.swingAt || 0, now + 1.6);
    late2Snd('roarSmall', e, 0.7);
    later(0.82, () => {
      if (!e.alive || isStunned(e) || e.motion) return;
      const R2 = dashReach(e, e.x, e.z, ux, uz, R.d);
      if (R2.d < 2) return;
      const dur = R2.d / 15;
      e.motion = { kind: 'leap', t: 0, dur, x0: e.x, z0: e.z, y0: e.y, x1: R2.x, z1: R2.z, y1: heightAt(R2.x, R2.z), h: 0.05, yaw: Math.atan2(ux, uz), onLand: () => { FX.dust(e.x, e.y, e.z, 10); } };
      LATE4.rushes.push({ e, hit: new Set(), until: GAME.t + dur + 0.05 });
      late2Snd('stagger', e, 0.6);
    });
  } else if (way === 'hands') { // the dead's grave-hands: the ground under a foe opens and holds it
    if (d > 20) return false;
    const tx = t.x, tz = t.z;
    aoeMarker(tx, tz, 2.6, 1.3, e.faction);
    spellDisc(tx, tz, 2.6, DISC_KIND.frost, 1.35, [0.45, 1.2, 1.8]);
    setAct(e, 3, 1.3); e.swingAt = Math.max(e.swingAt || 0, now + 1.4);
    late2Snd('cast', e, 1.6);
    later(1.3, () => {
      if (!e.alive || isStunned(e)) return;
      const gy = heightAt(tx, tz);
      spellDisc(tx, tz, 2.4, DISC_KIND.crack, 4);
      for (let i = 0; i < 10; i++) { const a = Math.random() * TAU, r = Math.random() * 2.2; FX.burst(tx + Math.cos(a) * r, gy + 0.1, tz + Math.sin(a) * r, 4, [0.5, 1.2, 1.7], 2.5, 0.6, 0.12, 2); }
      FX.dust(tx, gy, tz, 14, [0.32, 0.3, 0.27]);
      late2SndAt('raise', tx, gy + 0.5, tz);
      forNear(tx, tz, 3.2, (o) => {
        if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, tx, tz) > 2.6 || Math.abs(o.y - gy) > 2.5) return;
        const r = computeDamage(e, o, 0.9);
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'frost' });
        addBuff(o, 'root', 1, 2.2, e.id);
        if (o === GAME.player) uiFloatAt(o.x, o.y + 2.2, o.z, 'Held by the grave', 'hurt');
      });
    });
  } else if (way === 'flask') { // an outlaw's fire flask: it bursts in flames where it lands, and the grass burns
    if (d < 7 || d > 22) return false;
    const tx = t.x, tz = t.z;
    aoeMarker(tx, tz, 3.0, 1.1, e.faction);
    spellDisc(tx, tz, 3.0, DISC_KIND.holy, 1.15, [1.9, 0.75, 0.2]);
    turnToward(e, tx, tz, 20); setAct(e, 1, 0.6); e.swingAt = Math.max(e.swingAt || 0, now + 1.0);
    late4Throw(e, tx, tz, 1.1, 'flask');
    later(1.1, () => {
      const gy = heightAt(tx, tz);
      FX.burst(tx, gy + 0.4, tz, 40, [2.4, 1.0, 0.3], 4.5, 0.7, 0.2, -0.5);
      lightFlash(tx, gy + 1.2, tz, 9, [2.4, 1.1, 0.35], 0.45);
      late2SndAt('fire', tx, gy + 0.4, tz);
      if (!inDungeon(e)) { try { fireLandsAt(tx, gy + 0.3, tz, 2.0, e); } catch (err) { reportError(err); } }
      forNear(tx, tz, 3.6, (o) => {
        if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, tx, tz) > 3.0 || Math.abs(o.y - gy) > 2.5) return;
        const r = computeDamage(e, o, 1.0);
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'fire' });
        addBuff(o, 'burn', o.maxHp * 0.01, 4, e.id);
      });
    });
  } else if (way === 'boulder') { // a troll heaves a boulder at a foe that keeps off: it craters the ground where it lands
    if (d < 9 || d > 30) return false;
    const tx = t.x, tz = t.z;
    aoeMarker(tx, tz, 3.0, 1.6, e.faction);
    Object.assign(AOE_MARKS[AOE_MARKS.length - 1], { stun: true, src: e.id });
    spellDisc(tx, tz, 3.0, DISC_KIND.holy, 1.65, [1.6, 0.9, 0.35]);
    turnToward(e, tx, tz, 20); setAct(e, 8, 1.0); e.swingAt = Math.max(e.swingAt || 0, now + 1.8);
    late2Snd('roarSmall', e, 2);
    let thrown = false; // (a stun before it heaves the boulder breaks the throw off; once thrown it lands)
    later(0.55, () => { if (e.alive && !isStunned(e)) { late4Throw(e, tx, tz, 1.05, 'boulder'); thrown = true; } });
    later(1.6, () => {
      if (!thrown) return;
      const gy = heightAt(tx, tz);
      if (!inDungeon(e)) { try { natureImpact(tx, tz, 'leap', 3); } catch (err) { reportError(err); } }
      spellDisc(tx, tz, 2.8, DISC_KIND.crack, 6);
      FX.burst(tx, gy + 0.3, tz, 30, [0.5, 0.42, 0.33], 6, 0.8, 0.22, 9); FX.dust(tx, gy, tz, 16);
      cameraShake(0.25, tx, tz); late2SndAt('quake', tx, gy, tz);
      forNear(tx, tz, 3.6, (o) => {
        if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, tx, tz) > 3.0 || Math.abs(o.y - gy) > 2.5) return;
        const r = computeDamage(e, o, 1.4);
        dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee', heavy: true });
        addBuff(o, 'stun', 1, 0.8, e.id);
      });
    });
  } else if (way === 'lure') { // the wisp's lure: its light draws a foe to it, then bursts
    if (d < 7 || d > 24) return false;
    const tid = t.id;
    for (let i = 0; i < 12; i++) { const k = i / 11; FX.trail(lerp(e.x, t.x, k), lerp(e.y + 1, t.y + 1.2, k), lerp(e.z, t.z, k), [0.8, 1.6, 2.2], 0.16, 0.9); }
    if (t === GAME.player) uiFloatAt(t.x, t.y + 2.2, t.z, 'Lured', 'hurt');
    late2Snd('cast', e, 0.5);
    later(0.9, () => {
      const o = getEnt(tid);
      if (!e.alive || isStunned(e) || !o || !o.alive) return;
      const dd = dist(o.x, o.z, e.x, e.z);
      if (dd > 3) late4Shove(o, e.x - o.x, e.z - o.z, Math.min(10, dd - 2.5));
      const bx = e.x, bz = e.z, by = heightAt(bx, bz); // (the light bursts where it was when it drew its foe in: its ring warns of that place)
      aoeMarker(bx, bz, 4.2, 1.1, e.faction);
      spellDisc(bx, bz, 4.2, DISC_KIND.frost, 1.15, [0.6, 1.4, 2.1]);
      later(1.1, () => {
        if (!e.alive) return;
        FX.ring(bx, by + 0.6, bz, 4, [0.7, 1.5, 2.2], 36); lightFlash(bx, by + 1.5, bz, 9, [0.6, 1.5, 2.3], 0.45);
        late2SndAt('lance', bx, by + 0.5, bz);
        forNear(bx, bz, 4.8, (q) => {
          if (!q.alive || !isEnemy(e, q) || !isActor(q) || dist(q.x, q.z, bx, bz) > 4.2 || Math.abs(q.y - by) > 3) return;
          const r = computeDamage(e, q, 1.1);
          dealDamage(e, q, r.d, { crit: r.crit, kind: 'frost' });
          addBuff(q, 'snare', 0.4, 3, e.id);
        });
      });
    });
  } else return false;
  LATE4.stats.seconds++;
  LATE4.stats.by[way] = (LATE4.stats.by[way] || 0) + 1;
  const P = GAME.player;
  if (P && dist2(e.x, e.z, P.x, P.z) < 60 * 60) { uiFloatAt(e.x, e.y + 2.5 * (e.scale || 1), e.z, LATE4_SECOND_NAME[way], 'immune'); LATE4.lastSecondNear = GAME.t; }
  return true;
}
// a body thrown or drawn along the ground, no farther than it can go (dashReach)
function late4Shove(o, dx, dz, s) {
  const L = Math.hypot(dx, dz);
  if (L < 0.01 || s <= 0.05 || o.kind === 'door' || o.fixedY != null || o.motion || o.boat) return;
  const R = dashReach(o, o.x, o.z, dx / L, dz / L, s);
  if (R.d < 0.05) return;
  o.x = o.prevX = R.x; o.z = o.prevZ = R.z;
  if (o.role === 'player') { o.vy = Math.max(o.vy || 0, 2.2); o.onGround = false; }
  FX.dust(o.x, o.y, o.z, 6);
}
// something thrown on an arc: a fire flask, a boulder (drawn by particles: a dark lump with dust, a bottle with a flame)
function late4Throw(e, tx, tz, dur, kind) {
  const sc = e.scale || 1;
  LATE4.bolts.push({ kind, x0: e.x, y0: e.y + 1.9 * sc, z0: e.z, x1: tx, y1: heightAt(tx, tz) + 0.3, z1: tz, t: 0, dur: Math.max(0.3, dur - (kind === 'boulder' ? 0.55 : 0)), h: kind === 'boulder' ? 6 : 3.5 });
}
function late4DrawBolts(dt) {
  for (let i = LATE4.bolts.length - 1; i >= 0; i--) {
    const B = LATE4.bolts[i];
    B.t += dt;
    const k = clamp(B.t / B.dur, 0, 1);
    const x = lerp(B.x0, B.x1, k), z = lerp(B.z0, B.z1, k), y = lerp(B.y0, B.y1, k) + 4 * B.h * k * (1 - k);
    if (B.kind === 'boulder') {
      for (let j = 0; j < 4; j++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.5, z + (Math.random() - 0.5) * 0.5, 0, 0, 0, 0.08, 0.28, 0.25, 0.22, 0.55, 0, 0);
      if (Math.random() < 0.5) FX.dust(x, y - 0.3, z, 1, [0.4, 0.36, 0.3]);
    } else {
      fxAdd.emit(x, y, z, 0, 0, 0, 0.12, 2.4, 1.0, 0.3, 0.16, 0, 0);
      FX.trail(x, y, z, [2.2, 0.8, 0.25], 0.1, 0.4);
    }
    if (k >= 1) LATE4.bolts.splice(i, 1);
  }
}
// a gore rush on its way: whatever stands in the boar's line is tossed aside (once each)
function late4RushStep() {
  for (let i = LATE4.rushes.length - 1; i >= 0; i--) {
    const R = LATE4.rushes[i], e = R.e;
    if (!e.alive || GAME.t > R.until) { LATE4.rushes.splice(i, 1); continue; }
    forNear(e.x, e.z, 2.2, (o) => {
      if (R.hit.has(o.id) || !o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, e.x, e.z) > 1.8 * (e.scale || 1) || Math.abs(o.y - e.y) > 2) return;
      R.hit.add(o.id);
      const r = computeDamage(e, o, 1.3);
      dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee', heavy: true });
      addBuff(o, 'stun', 1, 0.6, e.id);
      const side = Math.sign((o.x - e.x) * Math.cos(e.yaw) - (o.z - e.z) * Math.sin(e.yaw)) || 1;
      late4Shove(o, Math.cos(e.yaw) * side, -Math.sin(e.yaw) * side, 2.5);
    });
  }
}

/* ------------------------------------------------------------------ */
/* the roaming risen of the borderlands                                */
/* ------------------------------------------------------------------ */
// one host a homeland: { D (its def), route [{x, z}], ri (the point it walks to), px, pz (where the host is: its leader's
// place in the march), home (the bodies' home, moved with it), ids, lead, down (seconds till it walks again), fight }
function late4HostInit() {
  if (LATE4.hosts.length) return;
  for (const D of LATE4_HOSTS) LATE4.hosts.push({ D, route: null, ri: 0, px: null, pz: null, home: { x: 0, z: 0, r: 10 }, ids: [], lead: null, down: 0, hpK: 1, fight: 0, stuck: 0, lastD: 1e9, up: false });
}
// the borderland camps of a homeland in a ring about its town, and a track between each pair worked out once on the land
function late4Route(H) {
  if (H.route) return H.route;
  const R = REALMS[H.D.realm], T = R.town;
  const camps = W.camps.filter((c) => c.elite && c.realm === H.D.realm).map((c) => ({ c, a: Math.atan2(c.x - T.x, c.z - T.z) })).sort((a, b) => a.a - b.a);
  const pts = [];
  for (const { c } of camps) {
    // a point beside the camp, toward its town: the host passes by its fire, not through it
    const d = Math.hypot(T.x - c.x, T.z - c.z) || 1;
    let x = c.x + ((T.x - c.x) / d) * 17, z = c.z + ((T.z - c.z) / d) * 17;
    if (!isWalkable(x, z)) { x = c.x + ((T.x - c.x) / d) * 12; z = c.z + ((T.z - c.z) / d) * 12; }
    if (isWalkable(x, z)) pts.push({ x, z });
  }
  // from each camp's point on to the next a way can be found to (by localPath on 2 m cells; failing that, by a point
  // between them drawn in toward the town; a camp no way reaches is passed by)
  const route = [], leg = (a, b) => { try { return localPath(a.x, a.z, b.x, b.z, 0.7, 260, false, 2) || localPath(a.x, a.z, b.x, b.z, 0.7, 640, false, 4); } catch (err) { reportError(err); return null; } }; // (2 m cells, then 4 m cells for a long way round)
  const n = pts.length;
  let i = 0, guard = 0;
  while (guard++ < n * 2 && pts.length >= 2) {
    const a = pts[i];
    let done = false;
    for (let k = 1; k <= 3 && !done; k++) {
      const j = (i + k) % n, b = pts[j];
      LATE4.stats.routeLegs++;
      let way = leg(a, b);
      if (!way) {
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, d = Math.hypot(T.x - mx, T.z - mz) || 1, m = { x: mx + ((T.x - mx) / d) * 40, z: mz + ((T.z - mz) / d) * 40 };
        const w1 = isWalkable(m.x, m.z) ? leg(a, m) : null, w2 = w1 ? leg(m, b) : null;
        if (w1 && w2) way = w1.concat(w2);
      }
      if (!way || !way.length) { LATE4.stats.routeFails++; continue; }
      route.push({ x: a.x, z: a.z, camp: 1 });
      for (const p of way) route.push({ x: p.x, z: p.z }); // (its corners: localPath smooths the way to them)
      done = true;
      if (j <= i) { i = n; break; } // (round to the start: the loop is closed)
      i = j;
    }
    if (!done || i >= n) break;
  }
  H.route = route.length >= 6 ? route : []; // (no track found: the host does not walk)
  if (H.px == null && H.route.length) { H.px = H.route[0].x; H.pz = H.route[0].z; H.ri = 1; }
  return H.route;
}
// the hosts keep off the measures (the callings' balance: classes.py, duels.py, balance8.py): while the player is played by
// a bot, or any body of the measures (`e.balance`) stands, or a test has set `LATE4.off`, no host walks (a host walks the
// homelands' ring where the duels' arenas lie, and passes the risen camps where the risen are measured)
const L4_MEASURE = { t0: -1e9, on: false };
function late4Measuring() {
  if (LATE4.off) return true;
  const P = GAME.player;
  if (P && P.bot) return true;
  if (Math.abs(GAME.t - L4_MEASURE.t0) >= 2) { L4_MEASURE.t0 = GAME.t; L4_MEASURE.on = ENT.some((e) => e.balance && e.alive); }
  return L4_MEASURE.on;
}
const late4HostOn = () => GAME.started && !!GAME.prog && warLevel() >= LATE4_HOST_AT && GAME.prog.level >= LATE4_HOST_AT && !late4Measuring();
function late4HostSpawn(H) {
  late4Route(H);
  if (!H.route.length || H.px == null) return false;
  const D = H.D, w = warLevel();
  if (netEntityLivePlayers().some(p => dist2(p.x, p.z, H.px, H.pz) < 55 * 55)) return false; // not under anyone's eyes
  // a stand-in camp for spawnMob (08_ai.js) and the risen's band: the host stands one step up the risen's ladder
  const camp = { id: D.realm, realm: D.realm, type: D.type, x: H.px, z: H.pz, r: 3, count: D.n, members: new Set(), respawnAt: [], eliteAt: 0, eliteId: null, l2k: 1, l2on: true, l4host: H };
  H.camp = camp; H.ids = [];
  for (let i = 0; i < D.n; i++) {
    const e = spawnMob(camp, i === 0);
    e.camp = null; e.home = H.home; e.l4host = H; e.properName = i === 0;
    if (i === 0) { e.name = D.name; H.lead = e.id; if (H.hpK < 1) e.hp = Math.max(1, e.maxHp * H.hpK); }
    else e.l4slot = i;
    late4MarkRisen(e);
    H.ids.push(e.id);
  }
  H.home.x = H.px; H.home.z = H.pz;
  H.up = true; H.fight = 0; H.stuck = 0; H.lastD = 1e9;
  LATE4.stats.hostSpawned++;
  void w;
  return true;
}
// a body's camp for the risen's own moves (late2KindMove, late2Rally): a roaming host's stand-in camp, else its camp
function late4CampOf(e) { return e.l4host ? e.l4host.camp || null : CAMPS[e.camp]; }
// one called up for a host (the dead called by its leader, the pack at its rally) walks with the host, not a camp
function late4Adopt(camp, m) {
  const H = camp && camp.l4host;
  if (!H || !m) return;
  m.camp = null; m.home = H.home; m.l4host = H; m.l4slot = H.ids.length;
  late4MarkRisen(m);
  H.ids.push(m.id);
}
// the host's bodies out of a fight (thinkMob's idle, 08_ai.js): each walks to its place in the march behind its leader
function late4HostIdle(e, dt) {
  const H = e.l4host;
  if (!H || !H.up) return false;
  // what it meets: any body of the realms within its sight (it is no camp waiting to be found)
  if (GAME.t > (e.ai.l4scan || 0)) {
    e.ai.l4scan = GAME.t + 0.5 + Math.random() * 0.3;
    const t = nearestWhere(e.x, e.z, 16, (o) => o.alive && o.faction <= 2 && isActor(o) && o.kind !== 'door' && classSeen(e, o, dist2(e.x, e.z, o.x, o.z)));
    if (t) { late4HostAggro(H, t); return true; }
  }
  const slot = late4Slot(H, e);
  if (dist2(e.x, e.z, slot.x, slot.z) < 0.6 * 0.6) { turnToward(e, slot.yawX, slot.yawZ, dt * 3); return true; }
  moveToward(e, slot.x, slot.z, dt, slot.far ? 0.95 : 0.42, 0.35);
  return true;
}
function late4HostAggro(H, t) {
  if (!H.fight) LATE4.stats.hostFights++;
  H.fight = GAME.t;
  for (const id of H.ids) { const o = getEnt(id); if (o && o.alive) { o.threat = o.threat || new Map(); if (!o.threat.has(t.id)) o.threat.set(t.id, 1); o.ai.pulled = true; } }
}
// a body's place in the march: the leader at the host's point, the rest two by two behind it
function late4Slot(H, e) {
  const r = H.route, nx = r[H.ri % r.length], dx = nx.x - H.px, dz = nx.z - H.pz, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const k = e.l4slot || 0, row = Math.ceil(k / 2), side = k === 0 ? 0 : k % 2 ? 1 : -1;
  let x = H.px - ux * 2.6 * row + uz * 1.5 * side, z = H.pz - uz * 2.6 * row - ux * 1.5 * side;
  if (k && !isWalkable(x, z)) { x = H.px - ux * 1.2 * row; z = H.pz - uz * 1.2 * row; if (!isWalkable(x, z)) { x = H.px; z = H.pz; } } // (on the track itself where the ground beside it is not walkable)
  return { x, z, far: dist2(e.x, e.z, x, z) > 10 * 10, yawX: x + ux * 5, yawZ: z + uz * 5 };
}
// each step: the host's point goes on along its track while it is not fighting and its bodies keep up
function late4HostStep(dt) {
  if (!LATE4.hosts.length) late4HostInit();
  const on = late4HostOn();
  let routed = false; // (one host's track worked out a step at most: each is a few dozen ways found on the land)
  for (const H of LATE4.hosts) {
    const alive = H.ids.map(getEnt).filter((o) => o && o.alive);
    if (H.up && !alive.length) { // brought down: it walks again in a quarter of an hour
      H.up = false; H.down = LATE4_HOST_BACK; H.ids = []; H.lead = null; H.hpK = 1;
      continue;
    }
    if (!H.up) {
      if (H.down > 0) H.down = Math.max(0, H.down - dt);
      if (on && H.down <= 0 && (H.spawnT = (H.spawnT || 0) - dt) <= 0) {
        if (!H.route) { if (routed) { H.spawnT = 0; continue; } routed = true; const t0 = performance.now(); late4Route(H); LATE4.stats.routeMs = Math.round((LATE4.stats.routeMs || 0) + performance.now() - t0); }
        H.spawnT = 2; late4HostSpawn(H);
      }
      continue;
    }
    if (!on) { for (const o of alive) { o.alive = false; removeEnt(o); } H.up = false; H.ids = []; continue; } // (the March falls back below 40)
    const lead = getEnt(H.lead);
    if (lead && lead.alive) H.hpK = lead.hp / Math.max(1, lead.maxHp);
    const fighting = alive.some((o) => { const t = getEnt(o.target); return (t && t.alive) || GAME.t < (o.combatUntil || 0) || o.ai.evade; });
    if (fighting) { H.fight = GAME.t; continue; } // (the bodies' home stands where the fight began: the leash holds them)
    if (GAME.t - H.fight < 3) continue;
    const r = H.route, nx = r[H.ri % r.length], d = Math.hypot(nx.x - H.px, nx.z - H.pz);
    // far from you its bodies rest (updateNPCs: no mob thinks 170 m off), so they go on with it out of sight
    if (netEntityLivePlayers().every(p => dist2(p.x, p.z, H.px, H.pz) > 160 * 160 && alive.every(o => dist2(p.x, p.z, o.x, o.z) > 165 * 165))) {
      if (d < 0.6) { H.ri = (H.ri + 1) % r.length; continue; }
      const sp = Math.min(d, 2.4 * dt);
      H.px += ((nx.x - H.px) / d) * sp; H.pz += ((nx.z - H.pz) / d) * sp; H.home.x = H.px; H.home.z = H.pz;
      for (const o of alive) { const s = late4Slot(H, o); if (isWalkable(s.x, s.z)) { o.x = o.prevX = s.x; o.z = o.prevZ = s.z; o.y = groundY(o); o.yaw = Math.atan2(s.yawX - s.x, s.yawZ - s.z); } }
      H.stuck = 0;
      continue;
    }
    // the slowest body keeps the pace: the point waits for those behind
    let lag = 0;
    for (const o of alive) { const s = late4Slot(H, o); lag = Math.max(lag, Math.hypot(o.x - s.x, o.z - s.z)); }
    if (lag > 9) { H.stuck += dt; if (H.stuck > 25) { for (const o of alive) { const s = late4Slot(H, o); if (Math.hypot(o.x - s.x, o.z - s.z) > 9 && isWalkable(s.x, s.z)) { o.x = o.prevX = s.x; o.z = o.prevZ = s.z; o.y = groundY(o); } } H.stuck = 0; } continue; }
    H.stuck = 0;
    if (d < 0.6) { H.ri = (H.ri + 1) % r.length; continue; }
    const sp = Math.min(d, 2.4 * dt);
    H.px += ((nx.x - H.px) / d) * sp; H.pz += ((nx.z - H.pz) / d) * sp;
    H.home.x = H.px; H.home.z = H.pz;
  }
}
// every host taken away and back at the start of its track, ready to walk (the tests' fresh start)
function late4HostsFresh() {
  late4HostInit();
  for (const H of LATE4.hosts) {
    for (const id of H.ids) { const e = getEnt(id); if (e) { e.alive = false; e.damagers = null; removeEnt(e); } }
    H.ids = []; H.lead = null; H.up = false; H.down = 0; H.fight = 0; H.hpK = 1; H.spawnT = 0;
    if (H.route) { H.ri = 1; H.px = H.route[0].x; H.pz = H.route[0].z; }
  }
  return LATE4.hosts.length;
}
// its leader brought down by you (late2OnKill, 10l_late.js): a deed, the spoils of a risen champion
function late4HostKill(e) {
  late2Deed('roam'); late2Deed('high');
  late2RisenSpoils(e);
  LATE4.stats.hostFell++;
  const H = e.l4host;
  news(`${capFirst(e.name)} has fallen in the borderlands of ${REALMS[H ? H.D.realm : 0].name}, and ${H ? H.D.host : 'its host'} with it.`, GAME.player ? GAME.player.faction : -1);
}
// the hosts on the world map past 40 (late2MapMarks, 10l_late.js): an ember ring about a flame, where each walks now
function late4MapMarks(ctx, S, MK) {
  if (!late4HostOn()) return;
  for (const H of LATE4.hosts) {
    if (!H.up || H.px == null) continue;
    const [x, y] = w2m(H.px, H.pz, S), r = S * 0.011;
    ctx.save();
    ctx.strokeStyle = '#140a05'; ctx.lineWidth = Math.max(2.5, S * 0.0034); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ff8a3a'; ctx.lineWidth = Math.max(1.5, S * 0.002); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ffb060'; ctx.beginPath(); ctx.moveTo(x, y - r * 0.7); ctx.quadraticCurveTo(x + r * 0.55, y + r * 0.1, x, y + r * 0.55); ctx.quadraticCurveTo(x - r * 0.55, y + r * 0.1, x, y - r * 0.7); ctx.fill();
    ctx.restore();
    MK.push([x, y, r * 1.2]);
  }
}
// the leader of the host walking in your homeland, alive (late2RisenMark: the gem may mark it)
function late4HostLead(P) {
  if (!P || !late4HostOn()) return null;
  const H = LATE4.hosts.find((h) => h.up && h.D.realm === P.faction), e = H ? getEnt(H.lead) : null;
  return e && e.alive ? e : null;
}
// the nearest host walking in your homeland (the gem's place for the late levels: late2RisenMark)
function late4HostMark(P) {
  if (!late4HostOn() || !P) return null;
  const H = LATE4.hosts.find((h) => h.up && h.D.realm === P.faction);
  return H ? { x: H.px, z: H.pz, what: H.D.name } : null;
}

/* ------------------------------------------------------------------ */
/* the standard of your name: a veteran's                              */
/* ------------------------------------------------------------------ */
// the flag's kind for the banners' shader: 2 + how torn it is (04_props.js); its rents are mended once it is taken up
function late4StdKind() { return 2 + clamp(L3V.std.tear || 0, 0, 1) * 0.98; }
function late4StdFlag() {
  if (!L2STD.mesh || L2STD.slot < 0) return;
  const B = bannerGeo.attributes;
  B.aB1.array[L2STD.slot * 4 + 3] = late4StdKind() + (L4STD.lie ? 1 : 0);
  B.aB1.needsUpdate = true;
}
// struck down (late3StdFall, late3StdPose: 10n_veteran.js): the pole falls the way that is clear and lies along the ground,
// its head on it, and the flag itself lies spread beside its head (kind 3 in the banners' shader: its device, its rents,
// the rain and the snow on it, the ground's height under every point), no blade growing up through either
const L4STD = { lie: false, key: null, marks: [] };
// the side it falls to (-1 or 1): the one whose pole and flag would lie through less (houses, walls, fences, trees, bushes,
// water), either when both are clear
function late4StdFallSide(at) {
  const out = [], bad = (x, z) => {
    let n = 0;
    if (!isWalkable(x, z)) n += 1;
    if (houseAt(x, z, 0.25)) n += 3;
    out.length = 0; collidersNear(x, z, 1.2, out);
    if (out.some((c) => c.active && c !== L2STD.coll && collCovers(c, x, z, 0.15))) n += 2;
    const w = waterAt(x, z); if (w && w.depth > 0.05) n += 1;
    return n;
  };
  const score = (sd) => {
    let n = 0;
    for (let t = 0.8; t <= LATE2_STD.poleH + 0.1; t += 0.75) n += bad(at.x - sd * t, at.z);
    for (let a = 3.4; a <= LATE2_STD.flagTop; a += 0.5) for (let q = 0.4; q <= 2.4; q += 0.5) n += bad(at.x - sd * a, at.z - sd * q);
    return n;
  };
  const a = score(-1), b = score(1);
  return a === b ? (Math.random() < 0.5 ? -1 : 1) : a < b ? -1 : 1;
}
// how far the pole turns as it falls: its head down on the ground where it lands (a slope away or toward it)
function late4StdFallA(at, side) {
  if (!at) return 1.5;
  const y0 = heightAt(at.x, at.z) - 0.08, L = LATE2_STD.poleH, hg = heightAt(at.x - side * L * 0.98, at.z);
  return clamp(Math.acos(clamp((hg + 0.07 - y0) / L, -0.6, 0.6)), 1.2, 1.9);
}
// the flag lying by the fallen pole's head (late3StdPose once it is down): true when it lies
function late4StdLie(at, side, slot) {
  if (!at || slot < 0) { late4StdUncover(); return false; }
  const B = bannerGeo.attributes, d = LATE2_STD.flagTop * Math.sin(late4StdFallA(at, side)), x = at.x - side * d;
  B.aB0.array.set([x, heightAt(x, at.z), at.z, side * Math.PI / 2], slot * 4);
  L4STD.lie = true;
  late4StdCover(at, side);
  return true;
}
// the texels under the fallen pole and its flag made bare (a blade grew up through the cloth), and given back after
function late4StdCover(at, side) {
  const key = `${at.x.toFixed(2)},${at.z.toFixed(2)},${side}`;
  if (L4STD.key === key && (!L4STD.marks.length || COVER.data[L4STD.marks[0][0]] === 255)) return; // (the map rebuilt since: again)
  late4StdUncover();
  L4STD.key = key;
  // every texel centre within half a texel of the pole or the flag: the map is read between centres, so a point under the
  // cloth then reads at least half bare (no blade from 0.3), and the grass comes back within a metre of its edge
  const g = 0.5, R = COVER.res, L = LATE2_STD.poleH + 0.3, a0 = LATE2_STD.flagTop - LATE2_STD.flagH - g, a1 = LATE2_STD.flagTop + g, q1 = 0.15 + LATE2_STD.flagW * 0.84 + g;
  const inside = (px, pz) => {
    const al = (at.x - px) * side, ac = (at.z - pz) * side; // along the pole from its foot, across toward the fly
    if (al >= 0.3 && al <= L && Math.abs(pz - at.z) <= 0.06 + g) return true; // the pole
    return al >= a0 && al <= a1 && ac >= -g && ac <= q1; // the flag
  };
  const i0 = Math.max(0, Math.floor(Math.min(at.x, at.x - side * L) - 1 + 512)), i1 = Math.min(R - 1, Math.ceil(Math.max(at.x, at.x - side * L) + 1 + 512));
  const j0 = Math.max(0, Math.floor(Math.min(at.z, at.z - side * q1) - 1 + 512)), j1 = Math.min(R - 1, Math.ceil(Math.max(at.z, at.z - side * q1) + 1 + 512));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const n = j * R + i, v = COVER.data[n];
    if (v === 255 || !inside(i - 512 + 0.5, j - 512 + 0.5)) continue;
    L4STD.marks.push([n, v]); COVER.data[n] = 255;
  }
  if (L4STD.marks.length) COVER.tex.needsUpdate = true;
}
function late4StdUncover() {
  L4STD.lie = false;
  if (!L4STD.key) return;
  for (const [n, v] of L4STD.marks) if (COVER.data[n] === 255) COVER.data[n] = v;
  if (L4STD.marks.length) COVER.tex.needsUpdate = true;
  L4STD.marks.length = 0; L4STD.key = null;
}
// a blow on it (late3StdStep, 10n_veteran.js): the cloth is rent by what strikes it
function late4StdTear(dmg) {
  const S = L3V.std, was = S.tear || 0;
  S.tear = Math.min(1, was + dmg * 0.6);
  if (Math.floor(S.tear * 10) !== Math.floor(was * 10)) { LATE4.stats.tears++; late4StdFlag(); }
}

/* ------------------------------------------------------------------ */
/* the deep remembers                                                  */
/* ------------------------------------------------------------------ */
// what is saved of the deep as it lies: the dead not yet back (their pack, kind and the seconds left), the slabs down
// (and how long since they fell), the pitch burning or charred, the cistern's water
function late4DeepSave() {
  if (typeof DEEP !== 'object' || !DEEP.built) return null;
  const now = GAME.t, o = {};
  const dead = [];
  DEEP_PACKS.forEach((pk, i) => { for (const R of pk.respawn || []) { const s = Math.round(R.at - now); if (s > 0) dead.push([i, R.spec[0], Math.min(s, 3600), +R.spec[2].toFixed(1), +R.spec[3].toFixed(1)]); } });
  if (dead.length) o.d = dead.slice(0, 40);
  const slabs = [];
  DEEP.slabs.forEach((S, i) => { if (S.st >= 1) slabs.push([i, S.st === 4 ? 3 : Math.max(2, S.st), Math.round(S.st >= 3 ? S.t : 0)]); });
  if (slabs.length) o.s = slabs;
  const pitch = [];
  for (const C of DEEP.cells) {
    if (C.st === 1) pitch.push([C.i, 1, +C.t.toFixed(1), Math.round(C.ch * 100)]);
    else if (C.st === 2) pitch.push([C.i, 2, Math.max(1, Math.round(C.rearm - now)), 100]);
    else if (C.ch > 0.02) pitch.push([C.i, 0, 0, Math.round(C.ch * 100)]);
  }
  if (pitch.length) o.p = pitch.slice(0, DEEP_CELLS_MAX);
  const F = DEEP.flood;
  if (F.st !== 0 || F.next > now) o.f = [F.st, +F.t.toFixed(1), Math.max(0, Math.round(F.next - now))];
  if (!Object.keys(o).length) return null;
  LATE4.stats.deepSaved++;
  return Object.assign({ v: 1 }, o);
}
const late4N = (v, a, b, d = a) => { v = +v; return Number.isFinite(v) ? clamp(v, a, b) : d; };
function late4DeepLoad(o) {
  if (typeof DEEP !== 'object' || !DEEP.built) return;
  o = o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  const now = GAME.t;
  // the dead: those saved as not yet back are taken out of their pack and come back in their time
  if (o && Array.isArray(o.d)) {
    for (const r of o.d.slice(0, 40)) {
      if (!Array.isArray(r)) continue;
      const pk = DEEP_PACKS[late4N(r[0], 0, DEEP_PACKS.length - 1, -1) | 0], type = String(r[1]);
      if (!pk || !MOBS[type]) continue;
      const secs = late4N(r[2], 1, 3600, 60), u = late4N(r[3], 0, 400, 0), v = late4N(r[4], 0, 200, 0);
      let best = null, bd = Infinity;
      for (const id of pk.members) { const e = getEnt(id); if (!e || !e.alive || e.mobType !== type) continue; const dd = (dunU(e.home.x) - u) ** 2 + (dunV(e.home.z) - v) ** 2; if (dd < bd) { bd = dd; best = e; } }
      if (!best) continue;
      pk.members.delete(best.id); best.alive = false; removeEnt(best);
      const m = pk.mobs.find((x) => x[0] === type) || pk.mobs[0];
      pk.respawn.push({ at: now + secs, spec: [type, m[1], u, v] });
    }
  }
  // the slabs that lie in their pits
  if (o && Array.isArray(o.s)) {
    for (const r of o.s) {
      if (!Array.isArray(r)) continue;
      const S = DEEP.slabs[late4N(r[0], 0, DEEP.slabs.length - 1, -1) | 0];
      if (!S || S.st !== 0) continue;
      S.st = 3; S.t = late4N(r[2], 0, 3600, 0); S.down = 1; S.load = 0;
      S.tilt = S.tilt || [(Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4];
      S.mesh.position.set(S.x, DEEP_PIT + 0.35, S.z); S.mesh.rotation.set(S.tilt[0], 0, S.tilt[1]);
      deepSlabCells(S, false);
    }
  }
  // the pitch: burning, charred or seeping as it was
  if (o && Array.isArray(o.p)) {
    for (const r of o.p) {
      if (!Array.isArray(r)) continue;
      const C = DEEP.cells[late4N(r[0], 0, DEEP.cells.length - 1, -1) | 0];
      if (!C) continue;
      const st = late4N(r[1], 0, 2, 0) | 0;
      C.ch = late4N(r[3], 0, 100, 0) / 100;
      if (st === 1) { C.st = 1; C.t = late4N(r[2], 0, DEEP_FIRE.burn + DEEP_FIRE.fall, 0); C.heat = C.t < DEEP_FIRE.burn ? Math.min(1, C.t / DEEP_FIRE.climb) : Math.max(0, 1 - (C.t - DEEP_FIRE.burn) / DEEP_FIRE.fall); C.spread = C.heat >= DEEP_FIRE.spreadAt; C.by = FACTION_MONSTER; }
      else if (st === 2) { C.st = 2; C.heat = 0; C.ch = 1; C.rearm = now + late4N(r[2], 1, DEEP_FIRE.rearm * 2, DEEP_FIRE.rearm); }
      else { C.st = 0; C.heat = 0; }
    }
    deepHeatUpload();
  }
  // the cistern's water
  if (o && Array.isArray(o.f)) {
    const F = DEEP.flood, st = late4N(o.f[0], 0, 3, 0) | 0, t = late4N(o.f[1], 0, 120, 0);
    F.st = st; F.t = t; F.next = now + late4N(o.f[2], 0, DEEP_FLOOD.again * 2, 0);
    DEEP.wy = st === 0 ? DEEP_FLOOD.base : st === 1 ? lerp(DEEP_FLOOD.base, DEEP_FLOOD.high, smooth(clamp(t / DEEP_FLOOD.rise, 0, 1))) : st === 2 ? DEEP_FLOOD.high : lerp(DEEP_FLOOD.high, DEEP_FLOOD.base, smooth(clamp(t / DEEP_FLOOD.drain, 0, 1)));
    if (DEEP.water) DEEP.water.position.y = DEEP.wy;
  }
  if (o) LATE4.stats.deepLoaded++;
}
registerSavePart('char', 'deep4', {
  save: late4DeepSave,
  load(o) { try { late4DeepLoad(o); } catch (err) { reportError(err); } },
  key: (o) => (o ? [(o.d || []).length, (o.s || []).map((r) => r[0]).join(), (o.p || []).filter((r) => r[1] !== 0).length, o.f ? o.f[0] : 0] : null),
});

/* ------------------------------------------------------------------ */
/* the deep's own air                                                  */
/* ------------------------------------------------------------------ */
// three placed voices of its own (as audio2's loops are: 11c_sound.js), on buffers made here from noise and arithmetic:
// water dripping and running in the cistern (at the sluices and the basin), embers ticking and sighing under the
// gallery's slabs, and the low breath of the Ash Throne's hall. The pitch's own flames are fires (their loops are audio2's).
const LATE4_AIR = {
  drip: { ref: 6, max: 45, lvl: 0.35, at: [[168.5, 52], [158, 45], [178, 45]], room: 'cistern', g: 0.32 },
  embers: { ref: 5, max: 40, lvl: 0.3, at: [[72, 49], [86, 49], [100, 49]], room: 'crack', g: 0.3 },
  hall: { ref: 12, max: 70, lvl: 0.4, at: [[34, 48], [24, 48]], room: 'ashhall', g: 0.26 },
};
function late4AirBuf(name) {
  const key = 'l4' + name;
  if (SND.bufs[key]) return SND.bufs[key];
  const sr = 22050, sec = 4.2, n = Math.floor(sr * sec), d = new Float32Array(n);
  let s = 7771 + name.length * 131;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const noise = () => rnd() * 2 - 1;
  if (name === 'drip') {
    // drops into still water in a stone hall: a plink and its ring, now and then a trickle; a soft wash under them
    let lp = 0;
    for (let i = 0; i < n; i++) { lp += (noise() - lp) * 0.02; d[i] = lp * 0.12; }
    for (let k = 0; k < sec * 5; k++) {
      const at = Math.floor(rnd() * (n - sr * 0.5)), f = 700 + rnd() * 1300, amp = 0.12 + rnd() * 0.22, len = Math.floor(sr * (0.12 + rnd() * 0.18));
      for (let j = 0; j < len; j++) { const tt = j / sr, fq = f * (1 + 0.35 * Math.exp(-tt * 40)); d[at + j] += Math.sin(2 * Math.PI * fq * tt) * amp * Math.exp(-tt * 18) * Math.min(1, j / 30); }
    }
  } else if (name === 'embers') {
    // coals breathing: a low hush that swells and falls, and ticks and small pops of cooling stone
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) { lp += (noise() - lp) * 0.05; lp2 += (lp - lp2) * 0.3; d[i] = lp2 * (0.55 + 0.45 * Math.sin((i / sr) * 1.7)) * 0.9; }
    for (let k = 0; k < sec * 18; k++) {
      const at = Math.floor(rnd() * (n - 300)), amp = Math.pow(rnd(), 2) * 0.5, len = 30 + Math.floor(rnd() * 120);
      let hp = 0, prev = 0;
      for (let j = 0; j < len; j++) { const x = noise(); hp = 0.8 * (hp + x - prev); prev = x; d[at + j] += hp * amp * Math.exp(-j / (len * 0.3)) * Math.min(1, j / 6); }
    }
  } else {
    // a great hall's breath: a low drone with a slow beat and a rumble, and its upper partials (a phone speaker hears them)
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / sr;
      lp += (noise() - lp) * 0.01;
      d[i] = (Math.sin(2 * Math.PI * 55 * tt) * 0.18 + Math.sin(2 * Math.PI * 82.5 * tt + 0.7) * 0.12 + Math.sin(2 * Math.PI * 330 * tt) * 0.05 + Math.sin(2 * Math.PI * 495 * tt + 1.3) * 0.03) * (0.7 + 0.3 * Math.sin(2 * Math.PI * tt / sec * 2)) + lp * 0.6;
    }
  }
  const xf = Math.floor(sr * 0.25);
  for (let j = 0; j < xf; j++) { const a = j / xf; d[j] = d[j] * a + d[n - xf + j] * (1 - a); }
  let pk = 0; for (let i = 0; i < n - xf; i++) pk = Math.max(pk, Math.abs(d[i]));
  const out = AUDIO.ctx ? AUDIO.ctx.createBuffer(1, n - xf, sr) : new AudioBuffer({ numberOfChannels: 1, length: n - xf, sampleRate: sr });
  const ch = out.getChannelData(0);
  for (let i = 0; i < n - xf; i++) ch[i] = d[i] * (0.8 / Math.max(0.05, pk));
  SND.bufs[key] = out;
  return out;
}
function late4AirStep(dt) {
  if (typeof SND !== 'object' || !SND.air || !AUDIO.ctx || !SND.L || !SND.L.ok) return;
  const P = GAME.player, deep = !!P && typeof DEEP === 'object' && DEEP.built && DEEP.inDeep;
  if (!deep && !LATE4.air) return;
  const ctx = AUDIO.ctx, now = ctx.currentTime;
  if (!LATE4.air) {
    LATE4.air = {};
    for (const k in LATE4_AIR) {
      const V = sndLoopVoice(ctx, SND.air.duck);
      const s = ctx.createBufferSource(); s.buffer = late4AirBuf(k); s.loop = true; s.playbackRate.value = R_(0.95, 1.05); s.connect(V.g); s.start(now, Math.random() * 2);
      V.src = s; V.buf = k;
      LATE4.air[k] = V;
    }
  }
  const mix = _sndMix;
  for (const k in LATE4_AIR) {
    const A = LATE4_AIR[k], V = LATE4.air[k];
    let g = 0;
    if (deep) {
      // placed at the nearest of its sources to the listener
      let bx = 0, bz = 0, bd = Infinity;
      for (const [u, v] of A.at) { const x = dunWX(u), z = dunWZ(v), dd = dist2(x, z, SND.L.x, SND.L.z); if (dd < bd) { bd = dd; bx = x; bz = z; } }
      const y = k === 'embers' ? DEEP_PIT + 0.5 : DEEP_Y + 1;
      sndMixAt(A, bx, y, bz, null, mix);
      g = mix.g * A.g * (k === 'embers' ? 0.6 + 0.4 * (DEEP.slabs.some((S) => S.st >= 2 && S.hall === 'crack') ? 1.4 : 1) : 1) * (k === 'drip' && DEEP.flood.st === 1 ? 1.6 : 1);
      sndSet(V.f.frequency, mix.fc, now, 0.3);
      if (V.p) sndSet(V.p.pan, mix.pan, now, 0.3);
    }
    sndSet(V.g.gain, g, now, 0.4);
    V.on = g;
  }
}

/* ------------------------------------------------------------------ */
/* each step                                                           */
/* ------------------------------------------------------------------ */
function updateLate4(dt) {
  if (!GAME.started) return;
  late4RushStep();
  // a risen beast stunned as it rears or crouches comes down (its blow is broken off when it next thinks: late2ChampThink)
  for (const e of LATE4.marked) if (e.alive && (e.anim.act === 20 || e.anim.act === 22) && isStunned(e)) late4WindBroken(e);
  LATE4.hostT = (LATE4.hostT || 0) - dt;
  if (LATE4.hostT <= 0) { const s = 0.25 - LATE4.hostT; LATE4.hostT = 0.25; try { late4HostStep(Math.min(s, 1)); } catch (err) { reportError(err); } }
  LATE4.airT = (LATE4.airT || 0) - dt;
  if (LATE4.airT <= 0) { LATE4.airT = 0.2; try { late4AirStep(0.2); } catch (err) { reportError(err); } }
  // the field notes' watches
  const P = GAME.player;
  if (P && (LATE4.noteT = (LATE4.noteT || 0) - dt) <= 0) {
    LATE4.noteT = 0.5;
    LATE4.near = LATE4.hosts.some((H) => H.up && dist2(P.x, P.z, H.px, H.pz) < 90 * 90);
  }
}

/* ------------------------------------------------------------------ */
/* the deed, what players are told, the save                           */
/* ------------------------------------------------------------------ */
LATE2.d.roam = 0;
LATE2_DEEDS.roam = 'Roaming hosts of the risen brought down';
{
  const N = { id: 'roadwarden', t: 'Roadwarden', deed: 'roam', n: 3, rp: 1200, k: { risen: 0.04, wear: 0.05 }, gift: 'You strike the risen 4% harder, and your gear wears 5% slower.' };
  const i = LATE2_NAMES.findIndex((x) => x.deed === 'rr');
  LATE2_NAMES.splice(i < 0 ? LATE2_NAMES.length : i, 0, N);
  LATE2_BY_ID[N.id] = N;
  if (typeof L3_DEVICE_OF === 'object' && L3_DEVICE_OF.roam == null) L3_DEVICE_OF.roam = 2; // (a tower: the roads kept)
}
function late4HostsHTML() {
  if (!GAME.prog || GAME.prog.level < LATE4_HOST_AT) return `<p>From level ${LATE4_HOST_AT} the risen walk the borderlands too: a host in each homeland, going from camp to camp along the tracks, and fighting what it meets.</p>`;
  const P = GAME.player, rows = LATE4.hosts.map((H) => `<li><b>${esc(capFirst(H.D.name))}</b> and ${esc(H.D.host)} (${esc(REALMS[H.D.realm].homeName)}): ${H.up ? 'walking the borderlands' : H.down > 0 ? `brought down; walks again in about ${Math.max(1, Math.round(H.down / 60))} minutes` : 'gathering'}${P && H.up && H.D.realm === P.faction ? ', circled on your map' : ''}.</li>`).join('');
  return `<p>A host of the risen walks the borderlands of each homeland, from camp to camp, and falls on whatever it meets. Its leader is a risen champion: bringing it down is a deed (three earn the name Roadwarden), and pays as a risen champion does. It walks again a quarter of an hour later.</p><ul class="plain">${rows}</ul>`;
}
// the Deeds page's section (chronDeeds, 10l_late.js): the wind-ups, the second ways, the hosts
function late4DeedsHTML() {
  return `<p>Each kind winds up its blow as it would: an outlaw, a troll or the dead raise their weapons overhead, a bear rears onto its hind legs, a wolf crouches to spring. Past half its strength a risen champion fights another way besides, warned of by a ring on the ground: a bear's maul, a wolf's pounce, the dead's grave-hands, an outlaw's fire flask, a troll's hurled boulder, a wisp's lure. A risen champion is known at a glance: embers in its coat or its mail, ember eyes, its name in ember.</p><h3>The roaming risen</h3>${late4HostsHTML()}`;
}
if (!FIELD_NOTES.l4host) FIELD_NOTES.l4host = { t: 'A host on the road', x: () => 'A host of the risen walks these borderlands from camp to camp and falls on whatever it meets. Its leader is a risen champion: bring it down, and the March tells of it.' };
if (!FIELD_NOTES.l4second) FIELD_NOTES.l4second = { t: 'A risen champion at bay', x: () => 'Past half its strength a risen champion fights another way besides: a maul, a pounce, a charge, the grave\'s hands, a fire flask, a boulder, a lure. A ring on the ground warns of each: step out of it.', fight: true };
GUIDE_WATCH.l4host = () => !!LATE4.near;
GUIDE_WATCH.l4second = () => LATE4.stats.seconds > 0 && !!GAME.player && GAME.t < (GAME.player.combatUntil || 0) + 2 && LATE4.lastSecondNear > GAME.t - 3;
GUIDE_HELP.push(() => `<h3>The roaming risen</h3><p>From level ${LATE4_HOST_AT} a host of the risen walks the borderlands of each homeland, from camp to camp, and fights what it meets. Its leader is a deed to bring down (the map shows where it walks: an ember ring). A risen champion past half its strength fights another way besides: a ring on the ground warns of it.</p>`);
LOADING_TIPS.push(
  'A risen bear rears onto its hind legs before it breaks the ground; a risen wolf crouches to spring. Step out of the ring, or stun it as it winds up.',
  'Past half its strength a risen champion fights another way besides: a maul, a pounce, a gore rush, the grave\'s hands, a fire flask, a hurled boulder, a lure.',
  'From level 40 a host of the risen walks the borderlands of each homeland, from camp to camp. Its leader is a deed to bring down.',
);
CHRON_EXTRA.goals.push(() => (GAME.prog && GAME.prog.level >= 30 ? `<div class="gd-tier"><h4>The roaming risen</h4>${late4HostsHTML()}</div>` : ''));
// the mantle on the March's other veterans (drawActors, 13_main.js; the people's shader draws a device on a cape as on
// yours: 05a_rig.js): a risen champion of the living (an outlaw, a troll) the crowned skull of the risen, a keep lord the
// tower of the keeps once the March has risen with you (40); the dead wear none (their shader draws no device)
function late4MantleCode(e) {
  if (!e.alive || e.kind !== 'humanoid') return 0;
  if (e.l2risen && !l4Cold(e)) return 8 * (6 + 1);
  if (e.role === 'lord' && warLevel() >= LATE4_HOST_AT && GAME.prog && GAME.prog.level >= LATE4_HOST_AT) return 8 * (2 + 1);
  return 0;
}
// the name on your frame (updateHUD, 10_ui.js): on a touch screen a long one would be cut short at the deed ("Aldric,
// Marshal of Lo..."): the deed's name is kept whole and your own shortened before it ("Ald., Marshal of Logres"); the
// Character page says it whole
const LATE4_FRAME_CH = 22, LATE4_FRAME_CH_SMALL = 25; // (what an upright phone's frame shows of a name at its size, and in the smaller letter)
function late4FrameName(P) {
  const full = late2Named(P), N = late2Worn();
  LATE4.frameSmall = false;
  if (!N || !IS_TOUCH || full.length <= LATE4_FRAME_CH) return full;
  LATE4.frameSmall = true; // (a smaller letter: "Aldric, Marshal of Logres" whole)
  if (full.length <= LATE4_FRAME_CH_SMALL) return full;
  const t = late2T(N), sep = N.sep || ' ', room = LATE4_FRAME_CH_SMALL - t.length - sep.length - 1;
  if (room < 2) return t; // (a deed's name too long for both: the deed alone)
  return (P.name.length <= room ? P.name : P.name.slice(0, room).trimEnd() + '.') + sep + t;
}
// the aims past the path (late2Aims, 10l_late.js): a host walking in your homeland
function late4Aims() {
  const P = GAME.player, H = P ? LATE4.hosts.find((h) => h.up && h.D.realm === P.faction) : null;
  if (!H || !late4HostOn()) return [];
  return [{ t: `Bring down ${capFirst(H.D.name)}`, x: `${capFirst(H.D.host)} walks the borderlands of ${REALMS[H.D.realm].homeName} from camp to camp (an ember ring on your map). ${LATE2.d.roam ? `${LATE2.d.roam} of 3 for the name Roadwarden.` : 'Three earn the name Roadwarden.'}` }];
}
// the hosts saved with the world: where each walks on its track, how hurt its leader is, how long until one brought down walks again
registerSavePart('world', 'roam', {
  save() {
    if (!LATE4.hosts.length) return null;
    const o = LATE4.hosts.map((H) => (H.px == null ? null : [Math.round(H.px * 10) / 10, Math.round(H.pz * 10) / 10, H.ri, Math.round(H.down), Math.round(H.hpK * 100)]));
    return o.some(Boolean) ? { v: 1, h: o } : null;
  },
  load(o) {
    late4HostInit();
    o = o && typeof o === 'object' && Array.isArray(o.h) ? o : null;
    LATE4.hosts.forEach((H, i) => {
      for (const id of H.ids) { const e = getEnt(id); if (e) { e.alive = false; removeEnt(e); } }
      H.ids = []; H.lead = null; H.up = false; H.fight = 0;
      const r = o && Array.isArray(o.h[i]) ? o.h[i] : null;
      if (!r) { H.px = null; H.pz = null; H.ri = 0; H.down = 0; H.hpK = 1; return; }
      const x = late4N(r[0], -HALF, HALF, NaN), z = late4N(r[1], -HALF, HALF, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(z) || !isWalkable(x, z)) { H.px = null; H.pz = null; H.ri = 0; } else { H.px = x; H.pz = z; H.ri = late4N(r[2], 0, 4096, 1) | 0; }
      H.down = late4N(r[3], 0, LATE4_HOST_BACK, 0); H.hpK = late4N(r[4], 5, 100, 100) / 100;
    });
  },
  key: (o) => (o && o.h ? o.h.map((r) => (r ? [Math.round(r[0] / 8), Math.round(r[1] / 8), r[3] > 0 ? 1 : 0] : 0)) : null),
});
// the tear of the standard, saved with the character (mended when it is taken up)
registerSavePart('char', 'late4', {
  save: () => ((L3V.std.tear || 0) > 0.01 ? { t: Math.round(L3V.std.tear * 100) } : null),
  load(o) { L3V.std.tear = o && typeof o === 'object' ? late4N(o.t, 0, 100, 0) / 100 : 0; late4StdFlag(); },
  key: (o) => (o ? [Math.round(o.t / 10)] : null),
});
queueMicrotask(() => { if (window.__hm) window.__hm.late4 = { LATE4, LATE4_HOSTS, LATE4_SECOND, LATE4_AIR, late4MarkRisen, late4WindUp, late4WindBroken, late4Second, late4Shove, late4HostInit, late4HostsFresh, late4Route, late4HostSpawn, late4HostStep, late4HostOn, late4HostMark, late4StdKind, late4StdFlag, late4StdTear, late4DeepSave, late4DeepLoad, late4AirStep, late4AirBuf, late4FrameName, late4MantleCode, late4StdFallSide, late4StdFallA, late4StdLie, L4STD, COVER, updateLate4, drawLate4, bannerGeo, setAct, dashReach }; });
