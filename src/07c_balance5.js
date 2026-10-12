/* ================================================================== */
/* [balance5] the callings within the aim at every level, for skilled  */
/*   and simple play alike, and mastery that pays (version 13)          */
/*   Holy Fire flares in a caster's face: struck in the middle of a     */
/*     spell, the foe loses it (not a steadfast priest): the priest's    */
/*     interrupt, so a healer who times it punishes a careless one, and  */
/*     a careful one guards its own spells with Renewal first.           */
/*   The press of foes: Whirlwind gives a warrior back a little of its  */
/*     health for each foe its blade cuts (a warrior thrives where the  */
/*     foes are thickest; one foe gives little).                         */
/* ================================================================== */
const BAL5 = { stats: { flares: 0, flareTries: 0, whirlHeal: 0, dodges: 0 } };

/* ------------------------------------------------------------------ */
/* Holy Fire flares in a caster's face                                 */
/* ------------------------------------------------------------------ */
// priestView asks as Holy Fire is cast: a foe in the middle of a spell loses it, unless it stands steadfast (a priest's
// own Renewal) or is a lord of the dead (bosses keep their spells)
// [balance5] only a foe close by: the flare is a flash in the face, not a bolt across the field (from casting range it
// broke every mage's firebolt, and a priest of 10 won 16 of 24 duels against a mage)
const FLARE_REACH = 10;
function holyFlare(e, t) {
  if (!t || !t.alive || !t.casting || t === e || t.kind === 'door' || t.role === 'boss' || t.role === 'dungeonBoss') return false;
  if (dist(e.x, e.z, t.x, t.z) > FLARE_REACH + t.radius * (t.scale || 1)) return false;
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
const castBreakable = (t, left = 0.3) => !!t && !!t.casting && t.casting.total - t.casting.t > left && !spellGuarded(t) && t.role !== 'boss' && t.role !== 'dungeonBoss'; // [balance6] nor a warded mage's (07c_balance6.js)
// a foe who could flare e's next spell: a priest of Holy Fire's level with it ready, in its reach
function flareThreat(e) {
  return !!nearestWhere(e.x, e.z, FLARE_REACH + 1, (o) => o.alive && o.cls === 'priest' && isEnemy(o, e) && o.level >= ABILITIES.holyfire.level && (o.cds.holyfire || 0) <= GAME.t + 0.3 && o.target === e.id);
}

// [balance5] what a skilled hand flares: a priest's heal (a smite is worth less than the Holy Fire's own burn), or any
// long spell of a mage or a bow (a meteor, a firebolt, an aimed shot)
function flareWorth(t, e) {
  if (!castBreakable(t, 0.3) || (e && dist(e.x, e.z, t.x, t.z) > FLARE_REACH + t.radius * (t.scale || 1))) return false;
  if (t.cls === 'priest') return t.casting.id === 'mend' || t.casting.id === 'pillar' || t.casting.id === 'raise';
  return true;
}

// [balance5] holy ground dazzles the foes who stand on it (stepGrounds asks every second): a blade fighting a priest on
// its hallowed ground misses some of its blows and cannot parry (a priest's own craft, which pressing 1-8 never uses)
function hallowDazzle(G, o) {
  if (!o.alive || o.kind === 'door' || o.role === 'boss' || o.role === 'dungeonBoss') return;
  const fresh = !hasBuff(o, 'dazzle');
  addBuff(o, 'dazzle', dazzleMissOf(G.level || 1), 1.3, 'hallow');
  BAL3.dazzledIds.add(o.id);
  if (fresh && dist2(o.x, o.z, camera.position.x, camera.position.z) < 50 * 50) FX.burst(o.x, o.y + 1.7 * (o.scale || 1), o.z, 10, [2.4, 2.2, 1.4], 1.6, 0.4, 0.09, 0);
}

/* ------------------------------------------------------------------ */
/* a fresh Renewal steadies the priest (tried, and set aside)          */
/* ------------------------------------------------------------------ */
// tried: Renewal on yourself steadying you only when none of your own Renewals still mended you (a priest renewing on
// every breath stood steadfast all the time). It cost the skilled priest more than the careless one: a seasoned mage's
// storm and a bow's blunt heads broke its spells four times as often, and it won a third of its duels at 30
const RENEW_FRESH = 1; // a Renewal with less than this left is spent
const RENEW_FRESH_ON = false; // [balance5] measured and set aside: the priest stood steadfast so seldom that a mage's storm broke 150 of its spells in 48 duels at 30 (37 without), and it won a third of its duels
const renewFresh = (e) => !RENEW_FRESH_ON || !e.cs || !(GAME.t < (e.cs.renewUntil || -99) - RENEW_FRESH);
function renewMark(e) { if (e.cs) e.cs.renewUntil = GAME.t + ABILITIES.renew.hot[1]; }

/* ------------------------------------------------------------------ */
/* the archer: a crippling arrow's wound                               */
/* ------------------------------------------------------------------ */
// Crippling Arrow opens a wound that mends slowly for as long as it slows: healing on it takes 30% less, as a broadhead's
// does. A bow's answer to a healer that needs no special arrows: an archer pressing its abilities in turn shoots plain
// arrows, and won 1 and 1.5 of 24 duels against a priest at 10 and 50 (a skilled archer's broadheads keep the wound open
// anyway)
function crippleWound(src, t, sn) {
  if (!src || src.cls !== 'archer' || !t.alive || t.kind === 'door') return;
  addBuff(t, 'wound', woundOf(src), sn ? sn[1] : 5, 'wound');
}

/* ------------------------------------------------------------------ */
/* the skilled bots: out from under a meteor, out of a blizzard        */
/* ------------------------------------------------------------------ */
// a skilled hand does not stand where a foe's meteor is about to land, in its blizzard or in burning grass: a mage blinks
// and an archer tumbles from under a falling meteor (letting its own spell go), anyone walks out of the ice and the
// fire. A mirror of mages at 30 and 50 was won by whose meteor landed first; the simple bot stands where it is
function botDodge(e, t, dt) {
  if (e.motion || isRooted(e) || e.fixedY != null || e.swim || e.boat) return false;
  let best = null;
  for (const p of PROJ) {
    if (p.kind !== 'meteor' || p.srcFaction === e.faction || !p.point) continue;
    const R = ABILITIES.meteor.radius + e.radius * (e.scale || 1) + 0.3, d = dist(e.x, e.z, p.point.x, p.point.z);
    if (d < R) { best = { x: p.point.x, z: p.point.z, now: true, out: R - d }; break; }
  }
  // burning grass under its feet (2% of health a second): out of it
  if (!best && typeof NATURE !== 'undefined' && NATURE.fire && NATURE.fire.size && natGet(e.x, e.z, 2) > 0.45) {
    let bx = 0, bz = 0, nb = 0;
    for (let a = 0; a < 8; a++) { const x = e.x + Math.sin(a * 0.785) * 2.5, z = e.z + Math.cos(a * 0.785) * 2.5; if (natGet(x, z, 2) > 0.3) { bx += x; bz += z; nb++; } }
    if (nb < 8) best = nb ? { x: bx / nb, z: bz / nb, now: false, fire: true } : { x: e.x, z: e.z, now: false, fire: true };
  }
  if (!best && typeof SPELL !== 'undefined') for (const S of SPELL.emitters) {
    if (S.kind !== 'blizzard' || !S.src || S.src.faction === e.faction || S.until < GAME.t + 0.8) continue;
    if (dist(e.x, e.z, S.x, S.z) < S.r + e.radius * (e.scale || 1) + 0.4) { best = { x: S.x, z: S.z, now: false }; break; }
  }
  if (!best) return false;
  let ax = e.x - best.x, az = e.z - best.z;
  const L = Math.hypot(ax, az);
  if (L < 0.3) { const a = t ? Math.atan2(t.x - e.x, t.z - e.z) + Math.PI / 2 : Math.random() * TAU; ax = Math.sin(a); az = Math.cos(a); } else { ax /= L; az /= L; }
  BAL5.stats.dodges++; // (steps spent getting clear, not dodges)
  if (best.now) {
    // a blink or a tumble carries a mage or an archer clear (the spell let go: it would not outlast the fall); on foot a
    // body gets clear only from near the edge in the time the meteor takes to fall, else it finishes its spell
    const ready = (id) => e.level >= ABILITIES[id].level && (e.cds[id] || 0) <= GAME.t && e.power >= ABILITIES[id].cost;
    const leap = (e.cls === 'mage' && ready('blink')) || (e.cls === 'archer' && ready('tumble'));
    if (!leap && best.out > effectiveSpeed(e) * 0.7) return false;
    if (e.casting) e.casting = null;
    if (e.cls === 'mage' && leap) { e.yaw = Math.atan2(ax, az); if (botUseAny(e, 'blink', e)) return true; }
    if (e.cls === 'archer' && leap) { e.yaw = Math.atan2(-ax, -az); if (botUseAny(e, 'tumble', e)) return true; }
  } else if (e.casting) return false; // a blizzard or burning grass, a slow harm: the spell finished first, then out
  moveToward(e, e.x + ax * 4, e.z + az * 4, dt, 1, 0);
  return true;
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

/* ------------------------------------------------------------------ */
/* the realm's ways, evened out                                        */
/* ------------------------------------------------------------------ */
// every realm's way of the archer beat the plain archer in 75-96% of their duels (duels.py kind=flavour, version 12): a
// mirror is a race, and a quicker draw, an opening shot from hiding at 80% more, or arrows the wind never moves (a plain
// archer's drawn arrows drift off a body at range) each decided it. Each keeps its character at a smaller measure
const ARCHER_REALM = { logresDraw: 0.85, eriuAmbush: 1.65, thuleWind: 0.5, thuleSnare: 4, thuleChill: 1.1 }; // version 12: 0.75, 1.8, 0, 4.5, 1.15
CLASS_REALM.archer[0].text = `You reach full draw ${Math.round((1 - ARCHER_REALM.logresDraw) * 100)}% sooner, and drawn shots from a wall or a tower strike 20% harder.`;
CLASS_REALM.archer[1].text = `You hide in half the time and stay hidden while you walk; a shot from hiding strikes ${Math.round((ARCHER_REALM.eriuAmbush - 1) * 100)}% harder instead of 50%.`;
CLASS_REALM.archer[2].text = `The wind moves your arrows only half as much, your snares freeze what they catch and hold it ${ARCHER_REALM.thuleSnare} s, and you strike chilled and frozen foes ${Math.round((ARCHER_REALM.thuleChill - 1) * 100)}% harder.`;
// the priests: the Shield of Logres still led (it won 9, 6 and 10 of 12 against a priest of no realm's way at 10, 30 and
// 50; the Well of Ériu 3, 5 and 7, the Hearth of Thule 5, 6 and 7)
Object.assign(PRIEST_REALM, { logresBless: 0.94, logresGround: 0.94, eriuHot: 0.025, thuleBless: 1.17 }); // version 12: 0.92, 0.92, 0.02, 1.15
CLASS_REALM.priest[0].text = `Your blessing makes allies take ${Math.round((1 - PRIEST_REALM.logresBless) * 100)}% less harm, and allies on your holy ground take ${Math.round((1 - PRIEST_REALM.logresGround) * 100)}% less.`;
CLASS_REALM.priest[1].text = `Your blessing heals ${+(PRIEST_REALM.eriuHot * 100).toFixed(1)}% a second and frees allies from snares and roots; your holy ground heals half again as much.`;
CLASS_REALM.priest[2].text = `Your blessing makes allies strike ${Math.round((PRIEST_REALM.thuleBless - 1) * 100)}% harder, and your holy ground burns every foe on it, not only the dead.`;

/* ------------------------------------------------------------------ */
/* the measures: the arenas' ground made whole between phases          */
/* ------------------------------------------------------------------ */
// tests (tools/tests/classes.py CB.wipe, duels.py): every crater undone. A meteor leaves a bowl 2 m deep with a rim of
// thrown earth, a Leap Strike a dent: a run's later duels were fought in pocked arenas where a bow or a staff in a bowl
// shot into its rim, while holy fire (no flight) did not care (a skilled archer won 23 of 24 duels against a priest at 50
// in a fresh arena and none in the full table)
function balFlattenCraters() {
  if (typeof NATURE === 'undefined' || !NATURE.craters) return 0;
  let n = 0;
  for (const K of NATURE.craters) {
    for (let j = K.j0; j <= K.j1; j++) for (let i = K.i0; i <= K.i1; i++) { const v = K.d[(j - K.j0) * K.w + (i - K.i0)]; if (v) W.H[j * HN + i] -= v * K.k; }
    natTerrainUpdate(K.i0, K.j0, K.i1, K.j1);
    n++;
  }
  NATURE.craters.length = 0;
  // and the grass fires out (the last fighters' fire arrows and firebolts lit them, and the next fighters stood in them)
  if (NATURE.fire && NATURE.fire.size) { for (const [k, c] of NATURE.fire) { NAT.data[k * 4 + 2] = 0; natMark(c.i, c.j, c.i, c.j); } NATURE.fire.clear(); }
  return n;
}

/* ---- what a player reads ---- */
ABILITIES.holyfire.desc = `Burns an enemy for 240% over 8 seconds. Cast at a foe within ${FLARE_REACH} m in the middle of a spell, it flares in its face: the spell is lost, unless the caster stands steadfast (a priest's own Renewal).`;
ABILITIES.whirl.desc = `Spin with your weapon out. 140% damage to every enemy within 4 m, and each foe your blade cuts gives you back ${Math.round(WHIRL_HEAL * 100)}% of your health.`;

ABILITIES.cripple.desc = 'Slows the target by 50% for 5 seconds, and its wound mends slowly: healing on it takes 30% less while it lasts. From level 12 it marks the foe: you strike it 10% harder for 30 s.';

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal5 = { BAL5, flattenCraters: balFlattenCraters, botDodge, FLARE_REACH, hallowDazzle, CLASSES, ABILITIES, healEnt, ARCHER_REALM, PRIEST_REALM, holyFlare, castBreakable, flareThreat, flareWorth, WHIRL_HEAL, whirlHeal, renewFresh, RENEW_FRESH, crippleWound };
}, 0);
