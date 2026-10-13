/* ================================================================== */
/* [balance7] the callings within the aim for skilled and simple play  */
/*   alike, and mastery that pays in every mirror (version 15)         */
/* ================================================================== */
const BAL7 = { stats: { logresHigh: 0, eriuWoods: 0, thuleCold: 0 } };
// the rules' measures in one place (the tests set them between runs to measure a rule against its absence)
const B7T = {
  rushShare: 5, // [warrior] Charge and Leap Strike share one rush from level 30: using either holds the other back this long (RUSH_SHARE 10: the skilled warrior won 29% of its duels at 50, 35% with 5)
  deepFrost: true, // [warrior] a seasoned mage's frost holds Charge (07c_balance3.js deepFrostHeld)
  leapSlow: null, // [warrior] [share, s]: Leap Strike's landing slows what it strikes
  lightFeet: 0.15, // [archer] the share of weapon blows an archer's light feet carry it from
  priestSelf: PRIEST_SELF, // [priest] its own wounds mend at this share of a heal's measure at rank I
  priestPress: true, // [priest bot] a skilled priest presses a bow to its mace before Tumble's level
  priestSnareRenew: true, // [priest bot] a skilled priest renews itself for steadiness when slowed
  sanctWound: false, // [priest] Sanctuary's heal on the priest itself weighs the wound as Mend's does (tried: it cost the careful priest, who uses it at 70%, as much as the careless one)
  plainRank: 0.05, // [archer] a seasoned archer's own shafts: plain arrows strike this much harder for each rank past the first (1.08 and 1.12 from rank II alike were tried: the simple archer of 30 won 47.5 of 48 against the simple priest)
  chargeSlowLate: true, // [warrior] a Charge's landing slows its foe from Leap Strike's level too (as below it)
  warriorFire: true, // [warrior bot] a skilled warrior goes through burning grass after its foe instead of stepping out of it
  priestBait: false, // [priest bot] a skilled priest smites through a blade whose bash is ready, or a foe that has just cut a spell (it stood idle)
  archerVolley: false, // [archer bot] a skilled archer volleys a lone foe that stands where it is (casting, drawing, held, or not moving)
  chargeCdLate: 12, // [warrior] Charge's wait from Leap Strike's level (0: its own 16 s): 12 s at every level now
  npcDevotion: false, // [priest] an NPC priest keeps the devotion it comes to the field with (it fades at the first look: devAt -99). Tried and set aside: the priests won 72% of their duels at 50, skilled and simple (left for a pass that weighs the war's healers too)
  priestRace: 0.15, // [priest bot] in a duel at rank I a skilled priest mends this much lower and smites instead
  volleyDodge: true, // [bots] a skilled bot steps out of a foe's volley before its second wave
};
// botDodge asks: a foe's volley falling on e (its three waves land 0.85, 1.4 and 1.95 s after it is loosed): out of it,
// a drawn bow let go and a spell finished first (a skilled archer drawing in a mirror stood under every wave)
function botVolleyAt(e) {
  const ring = b8RingAt(e); // [balance8] a ring that stuns (a risen champion's wrath): out of it and kept out, a warrior too, or its champion bashed as it rears (07c_balance8.js)
  if (ring !== undefined) return ring;
  if (e.cls === 'warrior') return null; // (a blade after its foe goes on under the arrows, as through the flames)
  for (const m of AOE_MARKS) {
    if (m.faction == null || m.faction === e.faction || m.until < GAME.t + 0.6) continue;
    if (dist(e.x, e.z, m.x, m.z) > m.r + e.radius * (e.scale || 1)) continue;
    if (e.casting) return null;
    if (e.cs && e.cs.drawFrom >= 0) releaseDraw(e, getEnt(e.target)); // (the arrow loosed as it is, then out)
    BAL7.stats.volleyDodges = (BAL7.stats.volleyDodges || 0) + 1;
    return { x: m.x, z: m.z, now: false };
  }
  return null;
}
// a volley's three waves fall over two seconds: worth it at a foe that will still be there (a skilled archer kept it for
// two foes or a raised shield, and a simple archer standing in a mirror took the skilled one's quick shots instead)
const archerVolleyWorth = (t) => !!t && t.alive && (!!t.casting || isRooted(t) || isStunned(t) || (!!t.cs && t.cs.drawFrom >= 0) || (!!t.anim && t.anim.amt < 0.08 && !(t.motion && t.motion.kind)));
// botDodge asks: a skilled warrior after its foe does not step out of burning grass (2% of its health a second)
const botFireThrough = (e, t) => B7T.warriorFire && e.cls === 'warrior' && !!t && t.alive && e.hp > e.maxHp * 0.25;
// Sanctuary on the priest itself: weighed by the wound as Mend is (B7T.sanctWound)
const sanctWound = (e) => (B7T.sanctWound ? mendWound(e) : sanctKneeK(e)); // [balance8] whole from 70% health down (07c_balance8.js)

/* ------------------------------------------------------------------ */
/* the archers' realm ways: edges on their own ground                  */
/* ------------------------------------------------------------------ */
// Every realm's way of the archer beat an archer of no realm's way in about four duels of five (duels.py kind=flavour,
// versions 12 to 14), however small its edge was made: between two archers alike in all else a mirror is a race, and an
// edge that is always there (a draw 8% quicker, arrows the wind moves a little less) decides it. Each way is now an edge
// on its own ground, at its full old measure there, and nothing elsewhere:
//   Logres, Longbow drill: from a wall, a tower or any perch (2.2 m over the ground under you) you reach full draw a
//     quarter sooner and your drawn shots strike 20% harder (the keeps' archers on their walks);
//   Eriu, Woodcraft: among trees (two standing within 7 m) you hide in half the time, stay hidden while you walk, and a
//     shot from hiding strikes 80% harder instead of 50% (in long grass you hide as any archer does);
//   Thule, Snow-hunting: in the cold (snow lying under you, or the air at freezing) the wind does not move your arrows and
//     your snares freeze what they catch and hold it 4.5 s; anywhere, you strike chilled and frozen foes 10% harder.
const ARCHER_GROUND = { logresDraw: 0.75, logresHigh: 1.2, eriuHide: 0.75, eriuWalk: 4.2, eriuAmbush: 1.8, eriuTrees: 2, thuleWind: 0, thuleSnare: 4.5, thuleCold: 0.25 };
Object.assign(ARCHER_REALM, { thuleChill: 1.1 }); // version 14: 1.05 (the chill is the foe's state, an edge only when frost has found it)
// standing trees within 7 m of a body (cached a quarter second on its calling's state)
function archerTrees(e) {
  const cs = csOf(e);
  if (cs.treesT != null && GAME.t - cs.treesT < 0.25 && cs.treesX === e.x && cs.treesZ === e.z) return cs.trees;
  let n = 0;
  if (typeof natTreesNear === 'function' && NATURE.built) natTreesNear(e.x, e.z, 7, (t) => { if (!t.felled && t.grow > 0.5) n++; });
  cs.treesT = GAME.t; cs.treesX = e.x; cs.treesZ = e.z; cs.trees = n;
  return n;
}
// the cold: snow lying there, or the air at freezing (the seasons and the weather agree on both)
function archerColdAt(x, z) {
  if (x > DUN_X0) return false;
  const lie = typeof seasonSnowLieAt === 'function' ? seasonSnowLieAt(x, z) : 0;
  if (lie >= ARCHER_GROUND.thuleCold) return true;
  return typeof farmTempAt === 'function' && farmTempAt(x, z) <= 0;
}
// is e an archer of this realm's way on its own ground?
function archerWayHere(e, realm) {
  if (!e || e.cls !== 'archer' || !realmFlavour(e) || e.faction !== realm) return false;
  if (realm === 0) return elevatedEnt(e);
  if (realm === 1) return archerTrees(e) >= ARCHER_GROUND.eriuTrees;
  return archerColdAt(e.x, e.z);
}
// 07b_classes.js asks these
const archerDrawK = (e) => (archerWayHere(e, 0) ? ARCHER_GROUND.logresDraw : 1); // drawFull
const archerHighK = (e) => (archerWayHere(e, 0) ? ARCHER_GROUND.logresHigh : 1); // a drawn shot's measure (looseArrow)
const archerWindK = (e) => (archerWayHere(e, 2) ? ARCHER_GROUND.thuleWind : 1); // looseArrow
function archerAmbushK(e) { // classHarm: a shot from hiding
  if (archerWayHere(e, 1)) { BAL7.stats.eriuWoods++; return ARCHER_GROUND.eriuAmbush; }
  return 1.5;
}
// updateHiding: how fast a body hides, and how fast it may walk hidden
const archerHideT = (e) => (archerWayHere(e, 1) ? ARCHER_GROUND.eriuHide : 1.5);
const archerHideWalk = (e) => (archerWayHere(e, 1) ? ARCHER_GROUND.eriuWalk : 1.2);
// stepSnares: a Thule snare in the cold freezes what it catches and holds it longer
const snareCold = (S) => !!S.thule && archerColdAt(S.x, S.z);
const snareHold = (S) => (snareCold(S) ? (BAL7.stats.thuleCold++, ARCHER_GROUND.thuleSnare) : 3.5);

CLASS_REALM.archer[0].text = `From a wall, a tower or any perch you reach full draw ${Math.round((1 - ARCHER_GROUND.logresDraw) * 100)}% sooner and your drawn shots strike ${Math.round((ARCHER_GROUND.logresHigh - 1) * 100)}% harder.`;
CLASS_REALM.archer[1].text = `Among trees you hide in half the time, stay hidden while you walk, and a shot from hiding strikes ${Math.round((ARCHER_GROUND.eriuAmbush - 1) * 100)}% harder instead of 50%.`;
CLASS_REALM.archer[2].text = `In the cold (snow under you, or a freezing air) the wind does not move your arrows and your snares freeze what they catch and hold it ${ARCHER_GROUND.thuleSnare} s; anywhere, you strike chilled and frozen foes ${Math.round((ARCHER_REALM.thuleChill - 1) * 100)}% harder.`;

/* ---- what a player reads: the tooltips (the Callings page's rows: 10d_classes_ui.js) ---- */
ABILITIES.charge.desc = `Rush at a foe 5–28 m away, shield first, and strike it as you land: 80% weapon damage, and the blow slows it by ${Math.round(RUSH_SLOW_EARLY[0] * 100)}% for ${RUSH_SLOW_EARLY[1]} s. The rush tears you free of any slow or root but a seasoned mage's frost; a snare or a root that catches you on the way holds you there, and Charge is then ready in half its wait. Landing, you take ${RUSH_FOOTING} s to find your feet, and Shield Bash waits ${RUSH_BASH} s. Charge comes round every ${RUSH_CD_EARLY} s; from Leap Strike's level it and Leap Strike are one rush (either holds the other back ${B7T.rushShare} s).`;
ABILITIES.leap.desc = ABILITIES.leap.desc.replace('holds the other back 10 s', `holds the other back ${B7T.rushShare} s`); // (07c_balance3.js's text)
ABILITIES.mend.desc = `Heals a friend for 36% of health, or you for ${Math.round(36 * PRIEST_SELF)}%. The deeper the wound, the more it mends: all of it from half health down, barely a sixth of it on a scratch.`;
ARROW_DEF.plain.text = `Ordinary shafts. You never run out, and a seasoned archer's own shafts strike ${Math.round(B7T.plainRank * 100)}% harder for each rank past the first.`;
// classHarm asks for an arrow with no special head: a seasoned archer's own shafts strike harder rank by rank (from rank II: 5, 10, 15%)
const plainArrowK = (e) => 1 + B7T.plainRank * Math.max(0, abilityRank(e.level || 1) - 1);

setTimeout(() => {
  LOADING_TIPS.push(
    'An archer of Logres draws quicker and strikes harder from a wall or a tower; one of Ériu hides and walks hidden among trees; one of Thule hunts best in the snow and the frost.',
    B7T.chargeCdLate ? `A warrior's Charge comes round every ${B7T.chargeCdLate} s at every level, and its landing blow slows the foe.` : `A warrior's Charge comes round every ${RUSH_CD_EARLY} s and its landing blow slows the foe until Leap Strike is learned; then Charge waits longer and the two are one rush.`, // [balance8] (07c_balance8.js sets the late rules back before this runs)
    'Mend a scratch and Mend does little: keep it for the deep wound.',
  );
}, 0);

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal7 = { BAL7, B7T, plainArrowK, ARCHER_GROUND, archerTrees, archerColdAt, archerWayHere, archerDrawK, archerHighK, archerWindK, archerAmbushK, archerHideT, archerHideWalk, snareCold, snareHold };
}, 0);
