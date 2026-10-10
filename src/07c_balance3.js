/* ================================================================== */
/* [balance3] the callings within the aim at every level, by skill     */
/*   Pursuit: an arrow that strikes a warrior takes a second off its    */
/*     Charge (pursuitOnHit, from classOnHit): the warrior's answer to  */
/*     a bow that keeps away, at every level, and nothing for Leap      */
/*     Strike; Charge itself comes every 12 s again.                    */
/*   Frost holds: a body held by a mage's frost (a frost nova's root,   */
/*     a frost rune's) cannot Charge or Leap Strike out of it           */
/*     (classCanUse, asked by canUse): the mage's answer to a blade     */
/*     that closes twice.                                               */
/*   Bodkins pierce half the armour, not all of it (BODKIN_PIERCE, in   */
/*     dealDamage): in full gear at 50 armour stops two fifths of a     */
/*     blow, and a needle point that ignored it all struck nearly twice */
/*     as hard as anything else.                                        */
/*   Holy light dazzles: Smite and the Pillar of Dawn leave the foe     */
/*     missing one weapon blow in four for 2 s (dazzleOnHit, classHarm  */
/*     asks dazzleMiss): the priest's answer to a blade at the throat.  */
/* ================================================================== */
const BODKIN_PIERCE = 0.5; // the share of the armour a bodkin (or Deadeye) goes through
const PURSUIT_CD = 1; // seconds off Charge for each arrow, bolt or spell that strikes a warrior
const SHIELD_WALL_PACE = 1; // guarded, a warrior walks at full pace behind a raised shield (0.55 otherwise)
const RUSH_SHARE = 10; // Charge and Leap Strike share one rush: using either holds the other back this long
// the share of weapon blows a dazzled foe misses, by the priest's rank: a twentieth at rank I, one in six at rank II,
// nearly one in three at rank IV (the priest's own healing falls with rank while every blade's harm grows with it)
const DAZZLE = { miss: [0, 0.05, 0.17, 0.23, 0.29, 0.29], dur: 3 };
const dazzleMissOf = (lvl) => DAZZLE.miss[clamp(abilityRank(lvl), 1, DAZZLE.miss.length - 1)];

// an arrow, a bolt or a spell from afar lands on a warrior: Charge comes a second sooner
function pursuitOnHit(src, dst, dmg, opts) {
  if (dst.cls !== 'warrior' || opts.dot || opts.reflect || opts.kind === 'melee' || dst.level < ABILITIES.charge.level) return;
  const t = GAME.t, cd = dst.cds && dst.cds.charge;
  if (!(cd > t)) return;
  dst.cds.charge = Math.max(t, cd - PURSUIT_CD);
  BAL3.stats.pursuit++;
  if (dst === GAME.player && dst.cds.charge <= t) classCue('pursuit');
}

// Charge and Leap Strike are one rush: a warrior who has learned both cannot use the one a moment after the other (the
// mage's escapes and a bow's distance are not undone twice in a breath)
function rushShare(e, A) {
  if (A.id !== 'charge' && A.id !== 'leap' || e.level < ABILITIES.leap.level) return;
  const other = A.id === 'charge' ? 'leap' : 'charge', t = GAME.t;
  e.cds[other] = Math.max(e.cds[other] || 0, t + RUSH_SHARE);
}
// held by frost: a frost nova's root or a frost rune's (no Leap Strike out of it); a seasoned mage's frost (rank II, level
// 30) holds against a Charge too, which tears free of any other root
const frostHeld = (e) => e.buffs.some((b) => b.kind === 'root' && b.frost && b.until > GAME.t);
const deepFrostHeld = (e) => e.buffs.some((b) => b.kind === 'root' && b.frost && b.deep && b.until > GAME.t);
const frostRootExtra = (src) => (src && abilityRank(src.level || 1) >= 2 ? { frost: true, deep: true } : { frost: true });
// in a mage's blizzard: neither Charge nor Leap Strike out of it, only a walk through the ice
const blizzardHeld = (e) => e.buffs.some((b) => b.kind === 'snare' && b.blizzard && b.until > GAME.t);
// canUse asks: what the calling forbids right now (null: nothing)
function classCanUse(e, A) {
  if ((A.leap && frostHeld(e)) || (A.dash && deepFrostHeld(e)) || ((A.leap || A.dash) && blizzardHeld(e))) { BAL3.stats.held++; return 'held'; }
  return null;
}

// holy light lands: the foe is dazzled (Smite and the Pillar, not holy ground or Holy Fire's burning)
function dazzleOnHit(src, dst, dmg, opts) {
  if (src.cls !== 'priest' || opts.kind !== 'holy' || opts.holy || opts.dot || !dst.alive || dst.kind === 'door' || dst.role === 'boss') return;
  const fresh = !hasBuff(dst, 'dazzle');
  addBuff(dst, 'dazzle', dazzleMissOf(src.level), DAZZLE.dur, 'dazzle');
  if (fresh && dist2(dst.x, dst.z, camera.position.x, camera.position.z) < 50 * 50) FX.burst(dst.x, dst.y + 1.7 * (dst.scale || 1), dst.z, 10, [2.2, 2.0, 1.2], 1.6, 0.35, 0.08, 0);
}
// a warrior dazzled by a priest of rank II or more does not see the glint of a blow coming: no parry (the raised shield
// still blocks)
const DAZZLE_NOPARRY = 0.15;
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


const BAL3 = { stats: { pursuit: 0, dazzled: 0, held: 0 } };

setTimeout(() => {
  if (typeof BUFF_ICON !== 'undefined') BUFF_ICON.dazzle = ['sun', '#fff0b8'];
  if (!window.__hm) return;
  window.__hm.bal3 = { BAL3, BODKIN_PIERCE, PURSUIT_CD, RUSH_SHARE, rushShare, DAZZLE, dazzleMissOf, frostHeld, deepFrostHeld, blizzardHeld, classCanUse, dazzled, pursuitOnHit, dazzleOnHit, dazzleMiss };
}, 0);

/* ---- what a player reads: the tooltips and the stances say what these rules do ---- */
ABILITIES.charge.desc = 'Rush to a target 5–28 m away and slow it, breaking free of any slow or root but a seasoned mage\'s frost; for 2 s none takes hold of you. Every arrow, bolt or spell that strikes you takes a second off its cooldown.';
ABILITIES.leap.desc = 'Leap onto a foe 6–24 m away. 160% damage and a 0.6 s stun to all within 4 m. Not out of a mage\'s frost or blizzard, and Charge and Leap Strike are one rush: using either holds the other back 10 s.';
ABILITIES.deadeye.desc = 'A long, steady shot. 420% damage at up to 50 m; armour stops only half of it.';
ABILITIES.blizzard.desc = 'Ice falls for 6 s in a 7 m circle: 50% damage a second and a 40% slow, and a foe in it cannot Charge or Leap Strike out.';
ABILITIES.pillar.desc = 'A column of light: 220% damage to enemies inside it, 30% healing to allies. Its light dazzles the foes it strikes.';
ABILITIES.smite.desc += ' Its light dazzles: for 3 s the foe misses some of its weapon blows (one in twenty at rank I, one in six at rank II, nearly one in three at rank IV), and a warrior dazzled by a priest of rank II or more cannot parry.';
ABILITIES.nova.desc = 'Your focus bursts out to 7 m. Fire: burns and roots. Frost: chills and roots (no Leap Strike out of it, and from rank II no Charge either) and freezes water. Storm: a thunderclap that throws foes back.';
ABILITIES.ward.desc = 'Absorbs damage equal to 35% of your health, and bites back at anyone who strikes you in your focus: burning, chilling or shocking them. A stun that strikes you while it holds breaks on it instead, at half its strength.';
ARROW_DEF.bodkin.text = 'Needle points that go through mail: armour stops only half of them, and they strike warriors harder.';
ARROW_DEF.broadhead.text = 'Wide hunting heads: a fifth more harm to beasts and the unarmoured, and they open a bleeding wound that mends slowly: healing on it takes 30% less for 6 s (45% from rank II).';
STANCES[0].text += ' A raised shield costs you no pace: a shield wall against arrows.';
if (GOODS.arrows_bodkin) GOODS.arrows_bodkin.desc = ARROW_DEF.bodkin.text;
if (GOODS.arrows_broadhead) GOODS.arrows_broadhead.desc = ARROW_DEF.broadhead.text;
