/* ================================================================== */
/* [balance8] the callings within the aim for simple play and mastery  */
/*   alike, and the late game's fights weighed (version 17)            */
/* ================================================================== */
const BAL8 = { stats: { flareThrough: 0, sanctKnee: 0, spentFlare: 0, spentBash: 0, healHeld: 0, npcBless: 0, npcDevHeals: 0, npcDevSum: 0 } };
// the rules' measures in one place (the tests set them between runs to measure a rule against its absence)
const B8T = {
  flareThrough: true, // [priest] Holy Fire's flare breaks a spell a Renewal steadied (light in the face is no blow): only a mage's ward keeps its spell from it
  sanctKnee: 0.3, // [priest] Sanctuary mends the priest's own wounds by their depth: all of it from 70% health down (0: as before)
  priestSpent: true, // [priest bot] a skilled priest casts again once the foe's interrupt is spent (it waited 3 s after any broken spell)
  priestFlareWait: true, // [priest bot] a skilled priest does not begin a heal into a foe priest's ready flare (it baits it with a smite)
};

/* ------------------------------------------------------------------ */
/* the priest: Holy Fire's flare through a Renewal's steadiness         */
/* ------------------------------------------------------------------ */
// A Renewal on yourself makes a priest steadfast for 4 s: nothing but a stun breaks its spells. A priest pressing its
// abilities in turn renews on every turn of its rotation and stood steadfast most of the time, so a careful priest's Holy
// Fire met a steadfast spell two times in three and the careless priest won the mirror (the skilled priest beat its simple
// self 8 of 24 at 30 and 15 of 24 at 50, made first and second by turns). Now the flare, a flash of light in the face,
// breaks a spell a Renewal steadied: the steadiness still keeps a priest's spells from blows, blunt arrows, storms and
// maces. Only a mage's ward keeps its spell from the flare (wardTakesBreak, as before). A careful priest casts its heals
// when the foe's Holy Fire is spent, and baits it with a smite.
function flareBreak(t) {
  if (!B8T.flareThrough) return breakCast(t);
  if (!t || !t.casting) return false;
  if (wardTakesBreak(t)) return false; // a mage behind its ward keeps its spell (07c_balance6.js)
  if (castSteady(t)) BAL8.stats.flareThrough++;
  t.casting = null;
  return true;
}
// the bots' view of a spell the flare would break (07c_balance5.js flareWorth): any spell with time left, unless a mage's
// ward holds it or a lord of the dead casts it
function flareBreakable(t, left = 0.3) {
  if (!B8T.flareThrough) return castBreakable(t, left);
  if (!t || !t.casting || t.casting.total - t.casting.t <= left || t.role === 'boss' || t.role === 'dungeonBoss') return false;
  return !(WARD_GUARD.on && t.cls === 'mage' && hasBuff(t, 'eward') && t.buffs.some((q) => q.kind === 'shield' && q.src === t.id && q.until > GAME.t && q.value > 1));
}

/* ------------------------------------------------------------------ */
/* the priest: Sanctuary mends your own wounds by their depth           */
/* ------------------------------------------------------------------ */
// Sanctuary heals every ally within 14 m for 25%, and the priest itself for a share of that. A priest pressing it as it
// comes round (every 20 s) poured it into a scratch; weighed as Mend is (all of it only from half health down, tried in
// version 15) it cost the careful priest, who calls it at 70%, as much. Now the priest's own share is whole from 70% health
// down and falls to a sixth of it at full health; allies are healed as before
function sanctKneeK(e) {
  const K = B8T.sanctKnee;
  if (!K || !e || !(e.maxHp > 0)) return 1;
  const miss = clamp(1 - e.hp / e.maxHp, 0, 1);
  const k = clamp(MEND_WOUND.floor + (1 - MEND_WOUND.floor) * miss / K, MEND_WOUND.floor, 1);
  if (k < 1) BAL8.stats.sanctKnee++;
  return k;
}

/* ------------------------------------------------------------------ */
/* the war's healers keep the devotion they come with                  */
/* ------------------------------------------------------------------ */
// An NPC priest comes to the field with 20 to 50 devotion, but its clock of devotion began at -99 s, so the first look
// faded it all away: the war's priests never blessed a soldier with a Renewal (20 devotion) or healed the stronger for it,
// unless a fight gave them devotion. They keep it now from the moment they come (it fades after 18 s at rest, as anyone's
// does). Version 15 tried it for every NPC priest and set it aside: the bots that measure the callings are NPCs too, and a
// priest bot that came with devotion won 72% of its duels at 50; the bots keep coming with none
B7T.npcDevotion = true;

/* ------------------------------------------------------------------ */
/* the skilled priest: a spent interrupt, and a flare held ready        */
/* ------------------------------------------------------------------ */
// botPriest asks: the foe that broke e's spell cannot break the next one soon (a priest's Holy Fire, a warrior's Shield
// Bash on their waits): a careful hand casts again at once (it waited 3 s after any broken spell, and a priest's flare
// came round every 8 s: in a mirror at 30 the skilled priest stood idle a third of the fight)
function priestCutSpent(e, t) {
  if (!B8T.priestSpent || !t || !t.alive) return false;
  const now = GAME.t;
  if (t.cls === 'priest') { if (t.level >= ABILITIES.holyfire.level && (t.cds.holyfire || 0) <= now + 1) return false; BAL8.stats.spentFlare++; return true; }
  if (t.cls === 'warrior') {
    const leap = t.level >= ABILITIES.leap.level && (t.cds.leap || 0) <= now + 1 && dist(e.x, e.z, t.x, t.z) >= ABILITIES.leap.minRange;
    if ((t.cds.bash || 0) <= now + 1.5 || leap) return false;
    BAL8.stats.spentBash++; return true;
  }
  return false;
}
// botPriest asks: a foe priest's flare is ready and in reach (flareThreat, 07c_balance5.js): a heal begun now would be
// lost to it (B8T.flareThrough: a Renewal no longer guards it), so the heal waits, unless the need is dire
const priestFlareWait = (e, hpF) => !!(B8T.flareThrough && B8T.priestFlareWait && hpF > 0.3 && flareThreat(e) && (BAL8.stats.healHeld++, true));

/* ---- what a player reads: the tooltips (the Callings page's rows: 10d_classes_ui.js) ---- */
ABILITIES.holyfire.desc = `Burns an enemy for 240% over 8 seconds. Cast at a foe within ${FLARE_REACH} m in the middle of a spell, it flares the spell away${B8T.flareThrough ? ': a Renewal\'s steadiness does not keep it, only a mage\'s ward does' : ''}.`;
ABILITIES.sanctuary.desc = `Heals all allies within 14 m for 25%, and you for ${Math.round(25 * PRIEST_SELF)}%: all of your own share from ${Math.round((1 - B8T.sanctKnee) * 100)}% health down, a sixth of it at full health.`;

setTimeout(() => {
  LOADING_TIPS.push(
    'A Renewal steadies a priest\'s spells against blows, arrows and storms, but not against another priest\'s Holy Fire: cast your heals when its flare is spent.',
    'Sanctuary mends its priest by the depth of the wound: call it when you are hurt, not as it comes round.',
  );
}, 0);

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal8 = { BAL8, B8T, flareBreak, flareBreakable, sanctKneeK, priestCutSpent, priestFlareWait };
}, 0);
ABILITIES.renew.desc = ABILITIES.renew.desc.replace('nothing but a stun breaks your spells', 'nothing but a stun or a foe\'s Holy Fire breaks your spells'); // (07c_balance6.js's text)
