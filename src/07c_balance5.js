/* ================================================================== */
/* [balance5] the callings within the aim at every level, for skilled  */
/*   and simple play alike, and mastery that pays (version 13)          */
/*   The priest's shield comes sooner: Divine Shield is learned at 9    */
/*     and Sanctuary at 14 (they changed places): a priest of 10 had no  */
/*     answer to a warrior's rush, its bash and its parries.             */
/*   Holy Fire flares in a caster's face: struck in the middle of a     */
/*     spell, the foe loses it (not a steadfast priest): the priest's    */
/*     interrupt, so a healer who times it punishes a careless one, and  */
/*     a careful one guards its own spells with Renewal first.           */
/*   The press of foes: Whirlwind gives a warrior back a little of its  */
/*     health for each foe its blade cuts (a warrior thrives where the  */
/*     foes are thickest; one foe gives little).                         */
/* ================================================================== */
const BAL5 = { stats: { flares: 0, flareTries: 0, whirlHeal: 0 } };

/* ------------------------------------------------------------------ */
/* the priest: Divine Shield sooner, Sanctuary later                   */
/* ------------------------------------------------------------------ */
// a priest of 10 lost 20 of 24 duels to a warrior of 10: the rush, the bash and the parries cut half its spells and it
// had nothing to meet them with until 14. Divine Shield (a shield, a ward against harm and against every stun, root and
// slow for 8 s) is the answer to that, so it comes at 9; Sanctuary, a heal for a group, comes at 14
ABILITIES.divine.level = 9;
ABILITIES.sanctuary.level = 14;
CLASSES.priest.abilities = ['smite', 'mend', 'renew', 'holyfire', 'divine', 'sanctuary', 'massrenew', 'pillar']; // the hotbar in the order they are learned

/* ------------------------------------------------------------------ */
/* Holy Fire flares in a caster's face                                 */
/* ------------------------------------------------------------------ */
// priestView asks as Holy Fire is cast: a foe in the middle of a spell loses it, unless it stands steadfast (a priest's
// own Renewal) or is a lord of the dead (bosses keep their spells)
function holyFlare(e, t) {
  if (!t || !t.alive || !t.casting || t === e || t.kind === 'door' || t.role === 'boss' || t.role === 'dungeonBoss') return false;
  BAL5.stats.flareTries++;
  if (!breakCast(t)) return false;
  BAL5.stats.flares++;
  const y = t.y + 1.7 * (t.scale || 1);
  if (dist2(t.x, t.z, camera.position.x, camera.position.z) < 60 * 60) { FX.burst(t.x, y, t.z, 22, [2.4, 1.9, 0.9], 3.5, 0.4, 0.1, -1); lightFlash(t.x, y, t.z, 8, [2.6, 2.1, 1.0], 0.25); }
  if (t === GAME.player) uiLog('Holy fire flares in your face: your spell is lost.', 'warn');
  if (e === GAME.player || t === GAME.player) uiFloatAt(t.x, t.y + 2.4 * (t.scale || 1), t.z, 'Flared', 'crit');
  return true;
}
// [balance5] the bots: a spell worth breaking (time left on it, and no steadfast caster)
const castBreakable = (t, left = 0.3) => !!t && !!t.casting && t.casting.total - t.casting.t > left && !hasBuff(t, 'steadfast') && t.role !== 'boss' && t.role !== 'dungeonBoss';
// a foe who could flare e's next spell: a priest of Holy Fire's level with it ready, in its reach
function flareThreat(e) {
  return !!nearestWhere(e.x, e.z, 32, (o) => o.alive && o.cls === 'priest' && isEnemy(o, e) && o.level >= ABILITIES.holyfire.level && (o.cds.holyfire || 0) <= GAME.t + 0.3 && o.target === e.id);
}

// [balance5] what a skilled hand flares: a priest's heal (a smite is worth less than the Holy Fire's own burn), or any
// long spell of a mage or a bow (a meteor, a firebolt, an aimed shot)
function flareWorth(t) {
  if (!castBreakable(t, 0.3)) return false;
  if (t.cls === 'priest') return t.casting.id === 'mend' || t.casting.id === 'pillar' || t.casting.id === 'raise';
  return true;
}

/* ------------------------------------------------------------------ */
/* a fresh Renewal steadies the priest                                 */
/* ------------------------------------------------------------------ */
// Renewal on yourself loosens roots, and a fresh one (none of your own Renewals still mending you) steadies you for 4 s:
// nothing but a stun breaks your spells. A priest renewing on every breath stood steadfast all the time, so nothing a
// bow, a storm or a mace did broke its spells; one who lets a Renewal run its course and renews again is steadfast when
// it chose to be
const RENEW_FRESH = 1; // a Renewal with less than this left is spent
const renewFresh = (e) => !e.cs || !(GAME.t < (e.cs.renewUntil || -99) - RENEW_FRESH);
function renewMark(e) { if (e.cs) e.cs.renewUntil = GAME.t + ABILITIES.renew.hot[1]; }

/* ------------------------------------------------------------------ */
/* the archer: a crippling arrow's wound                               */
/* ------------------------------------------------------------------ */
// Crippling Arrow opens a wound that mends slowly for as long as it slows: healing on it takes 30% less (45% from an
// archer of rank II), as a broadhead's does. A bow's answer to a healer that needs no special arrows (an archer who
// pressed its abilities in turn lost all 24 of its duels against a priest at 10 and 50)
function crippleWound(src, t, sn) {
  if (!src || src.cls !== 'archer' || !t.alive || t.kind === 'door') return;
  addBuff(t, 'wound', woundOf(src), sn ? sn[1] : 5, 'wound');
}

/* ------------------------------------------------------------------ */
/* the press of foes: Whirlwind                                        */
/* ------------------------------------------------------------------ */
// each foe a Whirlwind's cut strikes gives the warrior back this share of its health (two cuts a spin): in a pack of five
// a spin heals a fifth; against one foe a twenty-fifth
const WHIRL_HEAL = 0.02;
function whirlHeal(e, n) {
  if (!(n > 0) || !e.alive) return;
  const h = healEnt(e, e, e.maxHp * WHIRL_HEAL * Math.min(5, n));
  BAL5.stats.whirlHeal += h;
}

/* ---- what a player reads ---- */
ABILITIES.holyfire.desc = 'Burns an enemy for 240% over 8 seconds. It flares in the face of a foe in the middle of a spell: the spell is lost, unless the caster stands steadfast.';
ABILITIES.whirl.desc = `Spin with your weapon out. 140% damage to every enemy within 4 m, and each foe your blade cuts gives you back ${Math.round(WHIRL_HEAL * 100)}% of your health.`;
ABILITIES.renew.desc = 'Heals 32% over 9 seconds. On yourself it also loosens roots, and a fresh one (none of your Renewals still mending you) steadies you for 4 s: nothing but a stun breaks your spells. With 20 devotion it also blesses the target.';
ABILITIES.cripple.desc = 'Slows the target by 50% for 5 seconds, and its wound mends slowly: healing on it takes 30% less while it lasts (45% from rank II). From level 12 it marks the foe: you strike it 10% harder for 30 s.';

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal5 = { BAL5, holyFlare, castBreakable, flareThreat, flareWorth, WHIRL_HEAL, whirlHeal, renewFresh, RENEW_FRESH, crippleWound };
}, 0);
