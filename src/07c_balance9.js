/* ================================================================== */
/* [balance9] the callings within the aim where version 17 left them  */
/*   out, and the late game's foes fair to every calling (version 18) */
/* ================================================================== */
const BAL9 = { stats: { bluntBreak: 0, bluntSetBack: 0, cutSpentBow: 0 } };
// the rules' measures in one place (the tests set them between runs to measure a rule against its absence)
const B9T = {
  bluntHeavy: true, // [archer] a blunt head breaks a spell from an Aimed Shot or Deadeye, from a bow at full draw half the time (bluntDrawn), and from a quick shot, a crippling arrow or a bow not fully drawn never: it sets the spell back, and still knocks the foe back and slows it
  bluntDrawn: 0.5, // [archer] the share of the spells a blunt head from a bow at full draw breaks (the rest it sets back): a warrior's mace breaks half, a mage's storm three in five
  botNoDevotion: true, // [measure] a priest bot (the measures' fighters) comes with no devotion whatever the run's clock (07b_classes.js csOf: 20 to 50 that faded at its first look by 0.8 a second of game time, so one made in a page's first minute kept most of it, and blessed with its first Renewal)
  maceHoldLive: true, // [priest bot] a skilled priest of rank I holds its mace from a warrior's guard as the dazzle fades (it was decided as the bot acted, and a swing begun with the dazzle on landed as it ended: parried 27 to 30 times in 48 duels at 10)
  lordHoly: 1.0, // [the deep] holy light on Vorlach the Ash-Crowned: his ash crown turns it (1.6 on every other body of the dead: the skilled priest brought him down in 44 to 58 s hardly hurt, the others in 75 to 107 s with a third of their health or less at their lowest)
  mendFull: 0.6, // [priest] Mend mends in full from this share of health lost (MEND_WOUND.full 0.5: from half health down)
  priestBowSpent: true, // [priest bot] a skilled priest casts again at once after a bow broke its spell, while the bow has no Aimed Shot or Deadeye coming (it waited 3 s after any broken spell)
};

/* ------------------------------------------------------------------ */
/* the archer: a blunt head breaks a spell from a heavy shot           */
/* ------------------------------------------------------------------ */
// A blunt head broke any spell it struck, from any shot: a drawn arrow (every second or so), Quick Shot (every 3 s) and
// Crippling Arrow carried it, and the skilled archer cut a priest's spells 44 to 81 times in 24 to 48 duels at 10, 30 and
// 50 (version 17): every shot an interrupt, where a warrior's is its Shield Bash (14 s), a priest's its Holy Fire (8 s) and
// a mage's its storm. The priest's harm fell to half the careless priest's against the careless bow (which shoots plain
// arrows): 75 and 123 harm a second at 30 and 50 against 141 and 240. Kept to a full draw (tried first) it changed
// nothing: the skilled archer draws to full, and cut 44 spells in 48 duels at 10. Kept to the heavy shots alone (an Aimed
// Shot or Deadeye, spells of the archer's own that a priest's Holy Fire may flare) it turned the pair over: the priest won
// 18 and 20 of 24 at 30 and 50, where the bow had won 20 and 22. Now a blunt head breaks the spell it strikes from an Aimed
// Shot or Deadeye, half the time from a bow at full draw (as a warrior's mace breaks half and a storm three in five), and
// never from a quick shot, a crippling arrow or a bow loosed before full draw: those set the spell back, as a blade's blow
// does, and still knock the foe back and slow it.
function bluntFullShot(opts) {
  if (!opts) return false;
  if (opts.drawn != null) return opts.drawn >= 0.98 && Math.random() < B9T.bluntDrawn; // a drawn arrow at full draw: half the time
  return opts.ability === 'aimed' || opts.ability === 'deadeye';
}
// arrowEffect (07b_classes.js) asks for a blunt head that struck a body: true when its spell broke
function bluntBreak(src, dst, opts) {
  if (!B9T.bluntHeavy) return breakCast(dst);
  if (!dst || !dst.casting) return false;
  if (bluntFullShot(opts)) { const b = breakCast(dst); if (b) BAL9.stats.bluntBreak++; return b; }
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
  if (!B9T.bluntHeavy || !t || !(t.cls === 'priest' || t.cls === 'mage') || !clsHas(e, 'arrows') || spellGuarded(t)) return false;
  const cs = csOf(e);
  if (e === GAME.player && !goodsHave(ARROW_DEF.blunt.good, 1)) return false;
  const was = cs.arrow;
  cs.arrow = 'blunt';
  if (botUseAny(e, id, t)) { BAL9.stats.heavyBlunt = (BAL9.stats.heavyBlunt || 0) + 1; return true; }
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
/* the deep: Vorlach's ash crown turns holy light                      */
/* ------------------------------------------------------------------ */
// classHarm asks (07b_classes.js): holy light strikes the dead 1.6 times as hard (a smite 1.25 times again), and the deep's
// lord is of the dead: the skilled priest brought him down in 44 to 58 s with 70% of its health at its lowest and its
// three draughts untouched, where the warrior took 75 to 85 s, the mage 94 to 100 and the archer 104 to 107 with a third
// of their health or less (late3.py fight). His crown of ash turns the light: on him it strikes as hard as on the living
const lordHolyK = (dst) => (dst && dst.deepLord ? B9T.lordHoly : 1.6);

/* ------------------------------------------------------------------ */
/* the priest: Mend closes deep wounds                                 */
/* ------------------------------------------------------------------ */
// Mend mends by the depth of the wound (07c_balance4.js): all of its measure from half health down, a sixth of it on a
// scratch. A priest pressing its abilities in turn mends every fourth or fifth press at 60 to 80% of its health and won
// 70 to 83% of its duels at 10 (version 17; 74, 81 and 70% in three tables in a row here), where a careful priest mends
// at need, below 40% at rank I. Now Mend mends in full from 40% health down: a heal by rote at 70% mends 0.58 of its
// measure (0.66), one at 50% 0.86 (all of it)
Object.assign(MEND_WOUND, { full: B9T.mendFull });

/* ---- what a player reads: the tooltips (the Callings page's rows: 10d_classes_ui.js) ---- */
if (B9T.bluntHeavy) ARROW_DEF.blunt.text = `Heavy blunt heads: less harm, but they knock a foe back and shatter bone and ice. From an Aimed Shot or Deadeye one breaks the spell it strikes, from a bow at full draw ${B9T.bluntDrawn >= 1 ? 'too' : 'half the time'}; from a quick shot it only sets the spell back.`;
const mendFullText = () => `${Math.round((1 - MEND_WOUND.full) * 100)}% health`;
ABILITIES.mend.desc = ABILITIES.mend.desc.replace('all of it from half health down', `all of it from ${mendFullText()} down`); // (07c_balance7.js's text)
const bluntRuleText = () => (B9T.bluntHeavy ? ` A blunt head breaks the spell it strikes from an Aimed Shot or Deadeye, from a bow at full draw half the time; from a quick shot it only sets the spell back.` : '');

setTimeout(() => {
  LOADING_TIPS.push(
    'A blunt arrow breaks a spell from an Aimed Shot or Deadeye, from a full draw half the time, from a quick shot never: when an archer begins an Aimed Shot at you, a priest\'s Holy Fire flares it away.',
  );
}, 0);

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal9 = { BAL9, B9T, bluntBreak, bluntFullShot, bluntWorth, archerHeavyBlunt, priestCutSpentBow, priestMaceHold, lordHolyK };
}, 0);
