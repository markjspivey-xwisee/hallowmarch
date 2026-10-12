/* ================================================================== */
/* [balance3] the callings within the aim at every level, by skill     */
/*   Pursuit: an arrow, bolt or spell from afar that strikes a warrior  */
/*     takes a second off its Charge (pursuitOnHit, from classOnHit):   */
/*     the warrior's answer to a bow or a staff that keeps away, at     */
/*     every level, and nothing for Leap Strike.                        */
/*   One rush: from Leap Strike's level, using Charge or Leap Strike    */
/*     holds the other back 10 s (rushShare).                           */
/*   The shield wall: guarded, a warrior walks at full pace behind a    */
/*     raised shield (SHIELD_WALL_PACE, in classSpeedMult); bots and    */
/*     NPCs raise it against a bow out of reach.                        */
/*   Frost holds: a frost nova's or rune's root holds against Leap      */
/*     Strike, a seasoned mage's (rank II) against Charge too, and a    */
/*     blizzard against both (classCanUse, asked by canUse).            */
/*   Bodkins pierce half the armour, not all of it (BODKIN_PIERCE, in   */
/*     dealDamage).                                                     */
/*   Holy light dazzles: Smite and the Pillar of Dawn leave the foe     */
/*     missing a share of its weapon blows for 3 s, more with the       */
/*     priest's rank, and from rank II a dazzled warrior cannot parry   */
/*     (dazzleOnHit, classHarm asks dazzleMiss): the priest's answer to */
/*     a blade at the throat.                                           */
/*   (A priest's own healing from rank II and a broadhead's wound by    */
/*     rank are in 07c_balance.js: priestSelf, woundOf.)                */
/* ================================================================== */
const BODKIN_PIERCE = 0.5; // the share of the armour a bodkin (or Deadeye) goes through
const PURSUIT_CD = 0; // seconds off Charge for each arrow, bolt or spell that strikes a warrior [balance4] 1, set for a Charge that never rushed (07c_balance4.js)
const SHIELD_WALL_PACE = 1; // guarded, a warrior walks at full pace behind a raised shield (0.55 otherwise) [balance4] (0.75 left the wall behind a bow that kites; a volley falls over it now)
const RUSH_SHARE = 10; // Charge and Leap Strike share one rush: using either holds the other back this long
// the share of weapon blows a dazzled foe misses, by the priest's rank: a twentieth at rank I, one in six at rank II,
// a little over one in three at rank IV (the priest's own healing falls with rank while every blade's harm grows with it)
const DAZZLE = { miss: [0, 0.15, 0.18, 0.21, 0.24, 0.24], dur: 3 }; // [balance4] 0.05, 0.17, 0.26, 0.35: a warrior's rush reaches a priest at every level now, and at rank IV a third of its blows went wide
const dazzleMissOf = (lvl) => DAZZLE.miss[clamp(abilityRank(lvl), 1, DAZZLE.miss.length - 1)];

// an arrow, a bolt or a spell from afar lands on a warrior: Charge comes a second sooner
function pursuitOnHit(src, dst, dmg, opts) {
  if (!(PURSUIT_CD > 0) || dst.cls !== 'warrior' || opts.dot || opts.reflect || opts.kind === 'melee' || dst.level < ABILITIES.charge.level) return;
  const t = GAME.t, cd = dst.cds && dst.cds.charge;
  if (!(cd > t)) return;
  dst.cds.charge = Math.max(t, cd - PURSUIT_CD);
  BAL3.stats.pursuit++;
  if (dst === GAME.player && dst.cds.charge <= t) classCue('pursuit');
}

// Charge and Leap Strike are one rush: a warrior who has learned both cannot use the one a moment after the other (the
// mage's escapes and a bow's distance are not undone twice in a breath)
function rushShare(e, A) {
  if (A.id === 'leap') e.cds.bash = Math.max(e.cds.bash || 0, GAME.t + RUSH_BASH + 0.8); // [balance4] a rush spends the shield arm: Shield Bash waits after a Leap Strike as after a Charge (07c_balance4.js)
  if (A.id !== 'charge' && A.id !== 'leap' || e.level < ABILITIES.leap.level) return;
  const other = A.id === 'charge' ? 'leap' : 'charge', t = GAME.t;
  e.cds[other] = Math.max(e.cds[other] || 0, t + RUSH_SHARE);
}
// [balance3] an NPC warrior's shield wall: a bow shooting from out of reach, and no rush ready to close on it
function npcWallWanted(e, t) {
  if (!t || !t.alive || t.rangedKind !== 'arrow' || !clsHas(e, 'stances') || !hasShield(e) || !isEnemy(e, t)) return false;
  const d = dist(e.x, e.z, t.x, t.z);
  if (d <= e.meleeRange + t.radius * (t.scale || 1) + 1.2 || d > 40) return false;
  return !(e.level >= ABILITIES.charge.level && (e.cds.charge || 0) <= GAME.t) && !(e.level >= ABILITIES.leap.level && (e.cds.leap || 0) <= GAME.t);
}
// held by frost: a frost nova's root or a frost rune's (no Leap Strike out of it); a seasoned mage's frost (rank II, level
// 30) holds against a Charge too, which tears free of any other root
const frostHeld = (e) => e.buffs.some((b) => b.kind === 'root' && b.frost && b.until > GAME.t);
const deepFrostHeld = (e) => e.buffs.some((b) => b.kind === 'root' && b.frost && b.deep && b.until > GAME.t);
const frostRootExtra = (src) => (src && abilityRank(src.level || 1) >= 2 ? { frost: true, deep: true } : { frost: true });
// in a mage's blizzard: neither Charge nor Leap Strike out of it, only a walk through the ice
const blizzardHeld = (e) => e.buffs.some((b) => b.kind === 'snare' && b.blizzard && b.until > GAME.t);
// canUse asks: what the calling forbids right now (null: nothing)
function classCanUse(e, A, target) {
  if ((A.leap && frostHeld(e)) || (A.dash && deepFrostHeld(e)) || ((A.leap || A.dash) && blizzardHeld(e))) { BAL3.stats.held++; return 'held'; }
  return rushWhy(e, A, target); // [balance4] no rush on a horse, in the water or at a foe on another floor (07c_balance4.js)
}

// holy light lands: the foe is dazzled (Smite and the Pillar, not holy ground or Holy Fire's burning)
function dazzleOnHit(src, dst, dmg, opts) {
  if (src.cls !== 'priest' || opts.kind !== 'holy' || opts.holy || opts.dot || !dst.alive || dst.kind === 'door' || dst.role === 'boss') return;
  const fresh = !hasBuff(dst, 'dazzle');
  addBuff(dst, 'dazzle', dazzleMissOf(src.level), DAZZLE.dur, 'dazzle');
  BAL3.dazzledIds.add(dst.id);
  if (fresh && dist2(dst.x, dst.z, camera.position.x, camera.position.z) < 50 * 50) FX.burst(dst.x, dst.y + 1.7 * (dst.scale || 1), dst.z, 14, [2.4, 2.2, 1.4], 1.8, 0.4, 0.09, 0);
}
// the dazzled who are no longer (each step, from updateClasses)
function stepDazzle() {
  for (const id of BAL3.dazzledIds) { const e = getEnt(id); if (!e || !e.alive || !hasBuff(e, 'dazzle')) BAL3.dazzledIds.delete(id); }
}
// each frame (drawClasses): three motes of light circle a dazzled head while it lasts, brighter with the priest's rank
// and fading as it wears off, so a player sees whose blows will go wide
function drawDazzle() {
  if (!BAL3.dazzledIds.size) return;
  const cx = camera.position.x, cz = camera.position.z, t = U.uTime.value;
  let n = 0;
  for (const id of BAL3.dazzledIds) {
    const e = getEnt(id);
    if (!e || !e.alive || dist2(e.x, e.z, cx, cz) > 45 * 45) continue;
    const b = e.buffs.find((q) => q.kind === 'dazzle');
    if (!b) continue;
    const sc = e.scale || 1, y = e.y + (e.kind === 'humanoid' ? 1.74 + (e.mount ? 0.8 : 0) : e.kind === 'bear' ? 1.3 : 0.85) * sc;
    // [look4] the motes a size a player reads at any distance (at least about 1/40 of the way to the camera: they were a
    // few pixels at 640x360), wider round the head, with a faint trail behind each
    const k = clamp((b.until - GAME.t) / 0.6, 0, 1) * (0.7 + b.value * 1.2), r = 0.4 * sc, dc = Math.sqrt(dist2(e.x, e.z, cx, cz) + (y - camera.position.y) ** 2), s0 = Math.max(0.3 * sc, dc * 0.04);
    for (let i = 0; i < 3; i++) {
      const a = t * 4.2 + i * 2.094 + id, tw = 0.75 + 0.25 * Math.sin(t * 13 + i * 1.7 + id);
      glowPush(e.x + Math.cos(a) * r, y + Math.sin(a * 2 + i) * 0.05 * sc, e.z + Math.sin(a) * r, 2.8 * k, 2.5 * k, 1.5 * k, s0 * tw);
      glowPush(e.x + Math.cos(a - 0.35) * r, y + Math.sin((a - 0.35) * 2 + i) * 0.05 * sc, e.z + Math.sin(a - 0.35) * r, 1.4 * k, 1.2 * k, 0.6 * k, s0 * 0.6 * tw);
    }
    if (++n >= 8) break;
  }
}
// a warrior dazzled by a priest of rank II or more does not see the glint of a blow coming: no parry (the raised shield
// still blocks)
const DAZZLE_NOPARRY = 0.01; // [balance4] 0.15 (rank II): a warrior's rush now reaches a priest at every level, and its parries cut every spell
const dazzled = (e) => !!e && e.buffs.length > 0 && buffMax(e, 'dazzle') >= DAZZLE_NOPARRY;
// a dazzled body's weapon blow goes wide (classHarm asks before anything else)
function dazzleMiss(src, dst, opts) {
  if (!src || opts.kind !== 'melee' || opts.dot || opts.reflect || src === dst) return false;
  const v = buffMax(src, 'dazzle');
  if (!(v > 0) || Math.random() >= v) return false;
  BAL3.stats.dazzled++;
  if (src === GAME.player || dst === GAME.player) uiFloatAt(dst.x, dst.y + 2.2 * (dst.scale || 1), dst.z, 'Miss', 'miss');
  return true;
}


const BAL3 = { stats: { pursuit: 0, dazzled: 0, held: 0 }, dazzledIds: new Set() };

setTimeout(() => {
  if (typeof BUFF_ICON !== 'undefined') BUFF_ICON.dazzle = ['sun', '#fff0b8'];
  if (!window.__hm) return;
  window.__hm.bal3 = { BAL3, BODKIN_PIERCE, PURSUIT_CD, RUSH_SHARE, rushShare, DAZZLE, dazzleMissOf, frostHeld, deepFrostHeld, blizzardHeld, classCanUse, dazzled, npcWallWanted, canUse, effectiveSpeed, pursuitOnHit, dazzleOnHit, dazzleMiss };
}, 0);

/* ---- what a player reads: the tooltips and the stances say what these rules do ---- */
// [balance4] Charge's own text is in 07c_balance4.js (it rushes now; pursuit and the moment free of slows are set aside)
ABILITIES.leap.desc = 'Leap onto a foe 6–24 m away. 160% damage and a 0.6 s stun to all within 4 m. Not out of a mage\'s frost or blizzard, and Charge and Leap Strike are one rush: using either holds the other back 10 s, and Shield Bash 3 s.'; // [balance4] the shield arm
ABILITIES.deadeye.desc = 'A long, steady shot. 420% damage at up to 50 m; armour stops only half of it.';
ABILITIES.blizzard.desc = 'Ice falls for 6 s in a 7 m circle: 50% damage a second and a 40% slow, and a foe in it cannot Charge or Leap Strike out.';
ABILITIES.pillar.desc = 'A column of light: 220% damage to enemies inside it, 30% healing to allies. Its light dazzles the foes it strikes.';
ABILITIES.smite.desc += ` Its light dazzles: for 3 s the foe misses some of its weapon blows (${Math.round(DAZZLE.miss[1] * 100)}% at rank I, ${Math.round(DAZZLE.miss[4] * 100)}% at rank IV), and a dazzled warrior cannot parry.`; // [balance4] the numbers from DAZZLE; no parry at every rank
ABILITIES.nova.desc = 'Your focus bursts out to 7 m. Fire: burns and roots. Frost: chills and roots (no Leap Strike out of it, and from rank II no Charge either) and freezes water. Storm: a thunderclap that throws foes back.';
ABILITIES.ward.desc = 'Absorbs damage equal to 35% of your health, and bites back at anyone who strikes you in your focus: burning, chilling or shocking them. A stun that strikes you while it holds breaks on it instead, at half its strength.';
ARROW_DEF.bodkin.text = 'Needle points that go through mail: armour stops only half of them, and they strike warriors harder.';
ARROW_DEF.broadhead.text = 'Wide hunting heads: a fifth more harm to beasts and the unarmoured, and they open a bleeding wound that mends slowly: healing on it takes 30% less for 6 s.'; // [balance5] (45% from rank II)
STANCES[0].text += ` ${SHIELD_WALL_PACE >= 0.99 ? 'You walk at your full pace behind a raised shield' : 'A raised shield costs you only a quarter of your pace'}: a shield wall against arrows, though a volley falls over it.`; // [balance4] the pace from SHIELD_WALL_PACE
if (GOODS.arrows_bodkin) GOODS.arrows_bodkin.desc = ARROW_DEF.bodkin.text;
if (GOODS.arrows_broadhead) GOODS.arrows_broadhead.desc = ARROW_DEF.broadhead.text;
