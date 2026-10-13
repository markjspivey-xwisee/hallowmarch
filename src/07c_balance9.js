/* ================================================================== */
/* [balance9] the callings within the aim where version 17 left them  */
/*   out, and the late game's foes fair to every calling (version 18) */
/* ================================================================== */
const BAL9 = { stats: { bluntBreak: 0, bluntSetBack: 0, heavyBlunt: 0, cutSpentBow: 0, stunKept: 0 } };
// the rules' measures in one place (the tests set them between runs to measure a rule against its absence)
const B9T = {
  bluntHeavy: true, // [archer] a blunt head breaks a spell from a bow at full draw, an Aimed Shot or Deadeye; from a quick shot, a crippling arrow or a bow not fully drawn it sets the spell back, and still knocks the foe back and slows it
  bluntDrawn: 1, // [archer] the share of the spells a blunt head from a bow at full draw breaks (the rest it sets back): 0.5 was tried (a warrior's mace breaks half, a mage's storm three in five), and the pairs with the priest came out as with every full draw breaking (18 and 18 of 24 at 30 and 50 the priest's, against 16 and 19)
  woundLate: 0.22, // [archer] from rank II a bow's wound takes this share off the healing on its quarry (B8T.woundLate 0.15; 0.3 before version 17): with the skilled priest casting between the bow's breaking shots, 0.15 gave it 16 to 20 of 24 duels against the bow at 30 and 50, 0.3 7 of 24
  botNoDevotion: true, // [measure] a priest bot (the measures' fighters) comes with no devotion whatever the run's clock (07b_classes.js csOf: 20 to 50 that faded at its first look by 0.8 a second of game time, so one made in a page's first minute kept most of it, and blessed with its first Renewal)
  maceHoldLive: true, // [priest bot] a skilled priest of rank I holds its mace from a warrior's guard as the dazzle fades (it was decided as the bot acted, and a swing begun with the dazzle on landed as it ended: parried 27 to 30 times in 48 duels at 10)
  lordHoly: 1.0, // [the deep] holy light on Vorlach the Ash-Crowned: his ash crown turns it (1.6 on every other body of the dead: the skilled priest brought him down in 44 to 58 s hardly hurt, the others in 75 to 107 s with a third of their health or less at their lowest)
  steadyStun: true, // [priest] until Divine Shield is learned (14), a Renewal's steadiness keeps a priest's spell through a stun: it waits while the priest is stunned and goes on after (a stun broke it, steadfast or not)
  priestFlareMage: true, // [priest bot] a skilled priest of rank I keeps within its Holy Fire's flare of a staff (8 m), as of a bow from Tumble's level, instead of walking after it to its mace (it was in a mage's reach 1% of the fight at 10, slowed by its frost); at every rank it won 16 of 24 against the mage at 30 and 50 (the mage, warded from 11, had stood about even with it), so from rank II it closes as before
  burstRing: true, // [bots] a risen troll's stone-burst under a foe that keeps off (10l_late.js) is a ring that stuns: the skilled bots step out of it as out of the wrath, a caster letting its spell go (they finished their spell and took it: Hrungnir Moss-Crown brought a skilled mage of 50 to 14% with two draughts)
  priestRealm: { logresBless: 0.96, logresGround: 0.96, eriuHot: 0.016 }, // [priest] the realms' ways evened out again (PRIEST_REALM: 0.94, 0.94, 0.012): against a priest of no realm's way the Shield of Logres won 17 to 23 of 24, the Well of Ériu 8.5 to 14, the Hearth of Thule 8 to 18.5 (version 17)
  priestBowSpent: true, // [priest bot] a skilled priest casts again at once after a bow broke its spell, while the bow has no Aimed Shot or Deadeye coming (it waited 3 s after any broken spell)
};

/* ------------------------------------------------------------------ */
/* the archer: a blunt head breaks a spell from a full draw            */
/* ------------------------------------------------------------------ */
// A blunt head broke any spell it struck, from any shot: a drawn arrow (every second or so), Quick Shot (every 3 s) and
// Crippling Arrow carried it, and the skilled archer cut a priest's spells 44 to 81 times in 24 to 48 duels at 10, 30 and
// 50 (version 17): every shot an interrupt, where a warrior's is its Shield Bash (14 s), a priest's its Holy Fire (8 s) and
// a mage's its storm. The priest's harm fell to half the careless priest's against the careless bow (which shoots plain
// arrows): 75 and 123 harm a second at 30 and 50 against 141 and 240. Kept to a full draw (tried first) it changed
// nothing at 10 (the skilled archer draws to full, and cut 44 spells in 48 duels). Kept to the heavy shots alone (an Aimed
// Shot or Deadeye, spells of the archer's own that a priest's Holy Fire may flare) it turned the pair over: the priest won
// 18 and 20 of 24 at 30 and 50, where the bow had won 20 and 22; half the full draws breaking, or all of them, the same (a
// skilled priest that casts between the bow's breaking shots outlasts it: woundLate). Now a blunt head breaks the spell it
// strikes from a bow at full draw, an Aimed Shot or Deadeye, and never from a quick shot, a crippling arrow or a bow loosed
// before full draw: those set the spell back, as a blade's blow does, and still knock the foe back and slow it.
function bluntFullShot(opts) {
  if (!opts) return false;
  if (opts.drawn != null) return opts.drawn >= 0.98 && (B9T.bluntDrawn >= 1 || Math.random() < B9T.bluntDrawn); // a drawn arrow at full draw
  return opts.ability === 'aimed' || opts.ability === 'deadeye';
}
// arrowEffect (07b_classes.js) asks for a blunt head that struck a body: true when its spell broke
function bluntBreak(src, dst, opts) {
  if (!B9T.bluntHeavy) return breakCast(dst);
  if (!dst || !dst.casting) return false;
  if (bluntFullShot(opts)) { const b = breakCast(dst); if (b) BAL9.stats.bluntBreak++; return b; } // (not a steadfast priest's, nor a warded mage's)
  castPushback(dst); // (07c_balance.js: not a steadfast priest's, twice at most for one spell)
  BAL9.stats.bluntSetBack++;
  return false;
}
// the skilled archer bot (botArcherArrow, 07c_balance.js): a blunt head only for a shot that can break the spell: the
// arrow on the string (the bot holds to full draw), or the Aimed Shot or Deadeye that botArcher looses at a caster
// (archerHeavyBlunt)
const bluntWorth = (e) => !B9T.bluntHeavy || (B9T.bluntDrawn > 0 && !!e.cs && e.cs.drawFrom >= 0);
// botArcher asks before its Aimed Shot or Deadeye: at a priest or a mage, whose spells are most of its fight, a blunt head
// (a careful archer keeps its heavy shot for the spell: the arrow is chosen as the shot is begun, and it lands as the
// caster is likely in the middle of another); restored after (the next look chooses the arrow again)
function archerHeavyBlunt(e, t, id) {
  if (!B9T.bluntHeavy || !t || !clsHas(e, 'arrows') || spellGuarded(t)) return false;
  // at a priest or a mage, or at any foe in the middle of a long spell the shot can still break (the Ash-Crowned's Ember
  // Word: 2.8 s, an Aimed Shot's 1.6 and its flight)
  if (!(t.cls === 'priest' || t.cls === 'mage') && !(t.casting && castBreakable(t, (ABILITIES[id].cast || 0) + 0.4))) return false;
  const cs = csOf(e);
  if (e === GAME.player && !goodsHave(ARROW_DEF.blunt.good, 1)) return false;
  const was = cs.arrow;
  cs.arrow = 'blunt';
  if (botUseAny(e, id, t)) { BAL9.stats.heavyBlunt++; return true; }
  cs.arrow = was;
  return false;
}

/* ------------------------------------------------------------------ */
/* the skilled priest: a bow's spell-breaker spent                      */
/* ------------------------------------------------------------------ */
// botPriest asks (as balance8's priestCutSpent for a priest's flare and a warrior's bash): the bow that broke e's spell
// cannot break the next one soon: it is not drawing, nor casting an Aimed Shot or Deadeye, and its Aimed Shot is not
// ready (a skilled priest waited 3 s after any broken spell and smote 18 harm a second against a bow at 30, where the
// careless priest, casting through, smote 63)
function priestCutSpentBow(e, t) {
  if (!B9T.priestBowSpent || !B9T.bluntHeavy || !t || !t.alive || t.cls !== 'archer') return false;
  if (B9T.bluntDrawn > 0 && t.cs && t.cs.drawFrom >= 0) return false;
  if (t.casting && (t.casting.id === 'aimed' || t.casting.id === 'deadeye')) return false;
  if ((t.cds.aimed || 0) <= GAME.t + 1.4) return false;
  BAL9.stats.cutSpentBow++;
  return true;
}

/* ------------------------------------------------------------------ */
/* the skilled priest: the mace held as the dazzle fades               */
/* ------------------------------------------------------------------ */
// classNoAuto asks (07b_classes.js): a skilled priest of rank I does not swing its mace into a warrior's guard: a shield
// raised in time parries the blow and stuns the priest, breaking its spell, and staggers it (balance4's holdMace). It was
// decided as the bot acted (every 0.6 s at most, never while casting), so a swing begun while the warrior stood dazzled
// landed as the dazzle ended and was parried: 27 to 30 parries in 48 duels at 10. Now it is asked at each swing, with the
// dazzle's last half second counted as gone
function priestMaceHold(e) {
  const B = e.bot;
  if (!B) return false;
  if (!B9T.maceHoldLive) return !!B.holdMace;
  if (B.kind !== 'skilled' || e.cls !== 'priest' || abilityRank(e.level) > 1) return false;
  const t = getEnt(e.target);
  if (!t || !t.alive || t.cls !== 'warrior' || !clsHas(t, 'block') || !hasShield(t) || isStunned(t)) return false;
  return !t.buffs.some((b) => b.kind === 'dazzle' && b.value >= DAZZLE_NOPARRY && b.until > GAME.t + 0.5);
}

/* ------------------------------------------------------------------ */
/* the priest of rank I: a steadied spell waits through a stun         */
/* ------------------------------------------------------------------ */
// Below 14 a priest has no answer to a stun: Divine Shield (which wards it off) comes at 14, and a Renewal's steadiness
// keeps its spells from blows, arrows and storms but not from a Shield Bash, a parry's stun or a freeze. The skilled
// warrior bashed and parried the skilled priest's spells 59 to 77 times in 48 duels at 10 and won 35 to 45 of them (the
// priest 17 to 24% of all its duels at 10). Now, until Divine Shield is learned, a spell begun while steadfast (or held
// steadfast through) waits while its priest is stunned and goes on after: the stun still costs the priest its time.
// Every place a stun clears a spell asks (bash, leap, parry, a mace finisher, the casting step of the bodies and the player)
function stunKeepsCast(e) {
  if (!B9T.steadyStun || !e || e.cls !== 'priest' || !e.casting || e.casting.custom) return false;
  if (e.level >= ABILITIES.divine.level || !castSteady(e)) return false;
  BAL9.stats.stunKept++;
  return true;
}
// a stun that would clear e's spell: cleared unless it waits through (stunKeepsCast)
function stunBreak(e) { if (e && e.casting && !stunKeepsCast(e)) e.casting = null; }
// botPriest asks at rank I: a warrior's Shield Bash ready and the warrior in reach: a Renewal first, so the spell that
// follows waits through the bash instead of being lost
function priestSteadyFirst(e, t) {
  if (!B9T.steadyStun || !t || !t.alive || t.cls !== 'warrior' || e.level >= ABILITIES.divine.level || hasBuff(e, 'steadfast')) return false;
  if ((t.cds.bash || 0) > GAME.t + 1.2 || dist(e.x, e.z, t.x, t.z) > (t.meleeRange || 2.7) * (t.scale || 1) + e.radius + 2.5) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* the deep: Vorlach's ash crown turns holy light                      */
/* ------------------------------------------------------------------ */
// classHarm asks (07b_classes.js): holy light strikes the dead 1.6 times as hard (a smite 1.25 times again), and the deep's
// lord is of the dead: the skilled priest brought him down in 44 to 58 s with 70% of its health at its lowest and its
// three draughts untouched, where the warrior took 75 to 85 s, the mage 94 to 100 and the archer 104 to 107 with a third
// of their health or less (late3.py fight). His crown of ash turns the light: on him it strikes as hard as on the living
const lordHolyK = (dst) => (dst && dst.deepLord ? B9T.lordHoly : 1.6);
// dazzleOnHit asks (07c_balance3.js): his crown turns the dazzle too (a smite at rank IV made a quarter of his blows go wide,
// and the skilled priest was down to 70 to 76% of its health at its lowest, its three draughts untouched)
const lordNoDazzle = (dst) => !!dst && !!dst.deepLord && B9T.lordHoly < 1.6;
// the Deep's page (10m_deep.js) says it
const lordHolyText = () => (B9T.lordHoly < 1.6 ? ' His crown of ash turns holy light: a priest\'s light strikes him little harder than the living, and does not dazzle him.' : '');

// the priests' realm ways (07c_balance4.js's PRIEST_REALM, read where they act: classHarm, blessing, stepGrounds), and
// their texts in CLASS_REALM from them, as balance5 and balance6 wrote them
Object.assign(PRIEST_REALM, B9T.priestRealm);
CLASS_REALM.priest[0].text = `Your blessing makes allies take ${Math.round((1 - PRIEST_REALM.logresBless) * 100)}% less harm, and allies on your holy ground take ${Math.round((1 - PRIEST_REALM.logresGround) * 100)}% less.`;
CLASS_REALM.priest[1].text = `Your blessing heals ${+(PRIEST_REALM.eriuHot * 100).toFixed(1)}% a second for 15 s beside your Renewal, and frees allies from snares and roots; your holy ground heals half again as much.`;

// the wound of a bow of rank II and more (B8T, 07c_balance8.js: woundOf asks it)
B8T.woundLate = B9T.woundLate;
const woundText = () => `${Math.round(WOUND_HEAL * 100)}% less, ${Math.round(B9T.woundLate * 100)}% from a bow of rank II`;
ARROW_DEF.broadhead.text = `Wide hunting heads: a fifth more harm to beasts and the unarmoured, and they open a bleeding wound that mends slowly: healing on it takes ${woundText()}, for 6 s.`;
ABILITIES.cripple.desc = ABILITIES.cripple.desc.replace('healing on it takes 30% less', `healing on it takes ${woundText()}`);

/* ---- what a player reads: the tooltips (the Callings page's rows: 10d_classes_ui.js) ---- */
if (B9T.bluntHeavy) ARROW_DEF.blunt.text = 'Heavy blunt heads: less harm, but they knock a foe back and shatter bone and ice. From a bow at full draw, an Aimed Shot or Deadeye one breaks the spell it strikes; from a quick shot it only sets the spell back.';
const steadyStunText = () => (B9T.steadyStun ? ` Until you learn Divine Shield, a spell begun steadfast waits through a stun and goes on after.` : '');
ABILITIES.renew.desc = ABILITIES.renew.desc.replace("nothing but a stun or a foe's Holy Fire breaks your spells", "nothing but a stun or a foe's Holy Fire breaks your spells (until you learn Divine Shield, a spell begun so waits through a stun and goes on after)"); // (07c_balance8.js's text)
const bluntRuleText = () => (B9T.bluntHeavy ? ' A blunt head breaks the spell it strikes from a full draw, an Aimed Shot or Deadeye; from a quick shot it only sets the spell back.' : '');

setTimeout(() => {
  LOADING_TIPS.push(
    'A young priest\'s Renewal on itself keeps its spell through a stun: renew before a long cast when a warrior\'s Shield Bash is ready (Divine Shield, from level 14, wards the stun off).',
    'A blunt arrow breaks a spell from a full draw, an Aimed Shot or Deadeye, never from a quick shot: cast while the archer is not drawing, and a priest\'s Holy Fire flares an Aimed Shot away.',
  );
}, 0);

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal9 = { BAL9, B9T, bluntBreak, bluntFullShot, bluntWorth, archerHeavyBlunt, priestCutSpentBow, priestMaceHold, lordHolyK, lordNoDazzle, stunKeepsCast, stunBreak, priestSteadyFirst };
}, 0);
