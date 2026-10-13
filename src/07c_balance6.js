/* ================================================================== */
/* [balance6] the callings within the aim at every level, measured in  */
/*   arenas far apart (version 14)                                     */
/* ================================================================== */
const BAL6 = { stats: { firesBroken: 0 } };

/* ------------------------------------------------------------------ */
/* the measures: a firebreak round each arena                          */
/* ------------------------------------------------------------------ */
// tests (tools/tests/classes.py CB.breakFires, duels.py): grass burning farther than r from every arena's middle is put
// out each second. A grass fire lit by a fire arrow or a firebolt spread up to 37 m from where it was lit in still air
// and twice that downwind, into the next arena, where the skilled bots stepped out of it (688 steps in one run of mastery
// duels at 30) and the simple ones stood in it
function balBreakFires(centres, r = 34) {
  if (typeof NATURE === 'undefined' || !NATURE.fire || !NATURE.fire.size || !centres || !centres.length) return 0;
  let n = 0;
  const r2 = r * r;
  for (const [k, c] of NATURE.fire) {
    const x = c.i - 511.5, z = c.j - 511.5;
    let near = false;
    for (const s of centres) if ((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < r2) { near = true; break; }
    if (near) continue;
    NAT.data[k * 4 + 2] = 0; natMark(c.i, c.j, c.i, c.j); NATURE.fire.delete(k); n++;
  }
  BAL6.stats.firesBroken += n;
  return n;
}

// tests (duels.py): one arena made whole as its duel ends, so the next duel there begins at once while the others fight
// on (a phase waited on its slowest duel, up to a minute, while most arenas stood empty): what its two fighters left
// (snares, runes, holy ground, steam, arrows and bolts in flight), and within r of its middle the ice, a blizzard, the
// craters and the burning grass
function balCleanArena(x, z, r, gone) {
  const t = GAME.t, r2 = r * r, near = (q) => q && (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z) < r2;
  for (const L of [CLS.snares, CLS.runes, CLS.grounds, CLS.steam]) for (const q of L) if (gone.has(q.owner) || gone.has(q.src) || near(q)) q.until = Math.min(q.until, t - 1);
  // a rune waits for a foe before it looks at its clock: one left by the last mage burst under the next fighters
  for (const R of CLS.runes.slice()) if (gone.has(R.src) || near(R)) runeEnd(R);
  for (const q of CLS.ice) if (q.until > t && near(q)) q.until = t - 1;
  for (let i = CLS.arrows.length - 1; i >= 0; i--) if (gone.has(CLS.arrows[i].src)) CLS.arrows.splice(i, 1);
  for (let i = PROJ.length - 1; i >= 0; i--) if (gone.has(PROJ[i].src)) PROJ.splice(i, 1);
  if (typeof SPELL !== 'undefined') for (const S of SPELL.emitters) if (near(S) || (S.src && gone.has(S.src.id))) S.until = Math.min(S.until, t - 0.01);
  let n = 0;
  if (typeof NATURE !== 'undefined' && NATURE.craters) {
    for (let q = NATURE.craters.length - 1; q >= 0; q--) {
      const K = NATURE.craters[q];
      // [balance8] the crater's own middle (natureCrater keeps it): it was taken as a nature-map cell's (i - 511.5), but a crater's
      // i and j are the 2 m height map's, so no crater was ever found within an arena and none was undone as its duel ended:
      // a level's queue of duels was fought in arenas cratered ever deeper (183 craters and the ground 3 to 7 m from where it
      // lay within 20 m of the middles after 144 duels at 50, 8 to 12 m after 432), where a Charge stopped at every bowl's rim
      const cx = K.x ?? -HALF + (K.i0 + K.i1) / 2 * HS, cz = K.z ?? -HALF + (K.j0 + K.j1) / 2 * HS;
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > r2) continue;
      for (let j = K.j0; j <= K.j1; j++) for (let i = K.i0; i <= K.i1; i++) { const v = K.d[(j - K.j0) * K.w + (i - K.i0)]; if (v) W.H[j * HN + i] -= v * K.k; }
      natTerrainUpdate(K.i0, K.j0, K.i1, K.j1);
      NATURE.craters.splice(q, 1); n++;
    }
    if (NATURE.fire && NATURE.fire.size) for (const [k, c] of NATURE.fire) { const fx = c.i - 511.5, fz = c.j - 511.5; if ((fx - x) * (fx - x) + (fz - z) * (fz - z) < r2) { NAT.data[k * 4 + 2] = 0; natMark(c.i, c.j, c.i, c.j); NATURE.fire.delete(k); } }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* the priest: a Renewal on yourself steadies the next spell           */
/* ------------------------------------------------------------------ */
// A Renewal on yourself made a priest steadfast for 4 s: nothing but a stun broke its spells and no blow set them back.
// A priest that renewed itself on every turn of its rotation (the simple bot, a player pressing 1-8) stood steadfast two
// thirds of the time, so a careful priest's Holy Fire, a storm or a blunt arrow broke little of what it cast (in a mirror
// two flares in three met a steadfast spell): renewing by rote cost nothing. Now the 4 s keep blows from setting your
// spells back, as before, but only the next spell you begin in them is proof against breaking: a careful priest renews
// for the spell that matters (a Mend under a foe's flare) and keeps it; a careless one spends it on whatever comes next
// in its turn (a Smite) and mends unguarded. Tried in two forms and set aside (STEADY_NEXT): only the next spell steadied
// in every way (the skilled priest lost 44 of 48 duels to a warrior at 10: the blows set back every spell after the
// first), and the next spell proof against breaking (the skilled priest of 10 fell from 35% of its duels to 21%: a bow's
// blunt heads broke every spell after the first, and the mirror at 30 went no better). The fresh Renewal's rule of
// version 13 took the steadiness from the careful priest too, since it keeps its Renewals rolling: set aside. What rote
// renewing costs now is power (renewRoteCost, below).
const STEADY_NEXT = false; // [balance6] tried and set aside (below: the rote's cost is its power now)
const steadfastBuff = (e) => e.buffs.find((q) => q.kind === 'steadfast' && q.until > GAME.t);
// useAbility asks as a spell with a cast time begins: the guard against breaking goes to this spell
function steadyCast(e) {
  if (!STEADY_NEXT || !e.casting || e.casting.custom) return;
  const b = steadfastBuff(e);
  if (!b || b.spent) return;
  b.spent = true;
  e.casting.steady = true;
  BAL6.stats.steadied = (BAL6.stats.steadied || 0) + 1;
}
// the spell e is casting cannot be broken (breakCast): steadied, or (version 13) any spell while steadfast
const castSteady = (e) => (STEADY_NEXT ? !!(e.casting && e.casting.steady) : hasBuff(e, 'steadfast'));
// the next spell e begins will be steadied (the bots: Renewal not yet spent)
const steadyNext = (e) => { const b = steadfastBuff(e); return !!b && (!STEADY_NEXT || !b.spent); };

// the skilled priest keeps its Holy Fire for a flare at most this long after it comes ready, then burns the foe with it
const HF_HOLD = 3;

/* ------------------------------------------------------------------ */
/* the priest: renewing by rote costs power                            */
/* ------------------------------------------------------------------ */
// A Renewal on yourself while your last one still has more than RENEW_ROTE_LEFT s to mend costs RENEW_ROTE_K times the
// power: it only takes the old one's place (a buff of the same kind and source is refreshed, the heal left in it lost),
// and a priest that renews on every turn of its rotation, for the steadiness it gives, drains itself. A careful priest
// renews when the last has run out, or pays for the steadiness when it needs it (priestView asks)
const RENEW_ROTE_K = 2, RENEW_ROTE_LEFT = 2; // (three times, with the skilled priest paying it only rooted or with power to spare, was tried: the skilled priest of 10 fell from 50% of its duels to 38% and the simple one stayed at 77%)
// the next Renewal on yourself would cost more (the bots: a careful priest pays for steadiness only when it must)
const renewRote = (e) => e.buffs.some((q) => q.kind === 'hot' && q.src === e.id && q.until > GAME.t + RENEW_ROTE_LEFT);
function renewRoteCost(e, A) {
  if (!renewRote(e)) return A.cost;
  BAL6.stats.rote = (BAL6.stats.rote || 0) + 1;
  return Math.max(A.cost, Math.min(e.power, A.cost * RENEW_ROTE_K));
}

/* ------------------------------------------------------------------ */
/* the skilled archer against a priest                                 */
/* ------------------------------------------------------------------ */
// a foe that presses an archer (botArcher, botMove): a blade free to follow within r, but a priest only within reach of
// its mace. A skilled priest keeps 8 m off a bow from Tumble's level, inside its Holy Fire's flare, and the archer took it
// for a blade at its throat: it kited and loosed only instant arrows, never drew, and won 1 of 48 duels at 30 in arenas
// far apart. A drawn arrow is no spell: no flare breaks it
// (before Tumble a skilled priest presses a bow to its mace, and the archer keeps away from 9 m as from any blade: drawing
// while it closed, it won 46 of 48 at 10)
const ARCHER_PRIEST_REACH = 2.4;
function archerPresser(e, r) {
  const early = e.level < ABILITIES.tumble.level;
  return nearestWhere(e.x, e.z, r, (o) => botEnemy(e, o) && !o.rangedKind && o.target === e.id && !isRooted(o) && (o.cls !== 'priest' || early || dist(e.x, e.z, o.x, o.z) < (o.meleeRange || 2.7) * (o.scale || 1) + ARCHER_PRIEST_REACH));
}

/* ------------------------------------------------------------------ */
/* the mage: the ward keeps the spell                                  */
/* ------------------------------------------------------------------ */
// While a mage's Arcane Ward holds, a blow that would break its spell (a blunt arrow, a storm, a mace, a flare of holy
// fire) breaks on the ward instead: the spell holds and the ward loses a quarter of what it has left. A stun still breaks
// it (the ward takes the stun itself, at half its strength, but a bash breaks the spell). The mage's own steadiness, as a
// priest's Renewal is its: a seasoned bow loosed a blunt head at every spell a mage began and broke 84 in 48 duels at 30,
// and the mage won a quarter of them
const WARD_GUARD = { on: true, cost: 0.25 };
function wardTakesBreak(e) {
  if (!WARD_GUARD.on || !e || e.cls !== 'mage' || !hasBuff(e, 'eward')) return false;
  const b = e.buffs.find((q) => q.kind === 'shield' && q.src === e.id && q.until > GAME.t && q.value > 1);
  if (!b) return false;
  b.value *= 1 - WARD_GUARD.cost;
  BAL6.stats.wardKept = (BAL6.stats.wardKept || 0) + 1;
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 50 * 50) FX.ring(e.x, e.y + 1.1, e.z, 1.0, [0.7, 1.0, 1.9], 16, 1.3);
  if (e === GAME.player) uiFloatAt(e.x, e.y + 2.3 * (e.scale || 1), e.z, 'Warded', 'immune');
  return true;
}

// a spell no breaking blow can break: a priest steadfast, a mage behind its ward (the bots' view: a blunt head, a storm or
// a flare spent on it is wasted)
const spellGuarded = (t) => !!t && ((t.casting ? castSteady(t) : steadyNext(t)) || (WARD_GUARD.on && t.cls === 'mage' && hasBuff(t, 'eward') && t.buffs.some((q) => q.kind === 'shield' && q.src === t.id && q.until > GAME.t && q.value > 1)));

/* ------------------------------------------------------------------ */
/* the skilled mage: a staff at its elbow                              */
/* ------------------------------------------------------------------ */
// a mage that has blinked in beside a skilled mage (the simple bot blinks the way it faces, at its foe, then novas: a fire
// nova burns and roots for 2.5 s) is met with the nova first, then a blink away; in a mirror at 10 the simple mage's blink
// and nova made the race a coin toss (12.5 of 24)
function botMageElbow(e, t, focus, use) {
  const o = nearestWhere(e.x, e.z, 7.2, (q) => botEnemy(e, q) && q.cls === 'mage' && q.target === e.id && !frozenOf(q));
  if (!o) return false;
  focus(isRooted(o) ? 'storm' : 'frost');
  if (use(e, 'nova', e)) return true;
  if (e.level >= ABILITIES.blink.level && !canUse(e, 'blink', null) && (o.cds.nova || 0) <= GAME.t + 1) { focus('frost'); e.yaw = botAwayYaw(e, o, ABILITIES.blink.blink || 12); if (use(e, 'blink', e)) return true; }
  return false;
}

// [balance6] a meteor (2.4 s to cast, then a second to fall) or a blizzard at one foe only when it cannot step out of it:
// held (rooted, stunned, frozen) or with no leap ready to carry it clear (a bow's Tumble, a staff's Blink). A skilled bow
// or staff leaps from under a falling meteor and walks out of the ice (botDodge), and a mage that called them down at
// one anyway spent a third of its casting on nothing: its meteors did 14 harm a second against a bow at 30
function mageAoeWorth(e, t, id) {
  if (!t || !t.alive) return false;
  if (isRooted(t) || frozenOf(t) || botFoes(e, 40, (o) => dist(o.x, o.z, t.x, t.z) < (ABILITIES[id].radius || 6)) >= 2) return true;
  if (!(t.bot && t.bot.kind === 'skilled') && t !== GAME.player) return true; // (a body that does not look up stands in it)
  const leap = t.cls === 'archer' ? 'tumble' : t.cls === 'mage' ? 'blink' : null;
  if (id === 'blizzard') return false; // anyone walks out of the ice
  return !leap || t.level < ABILITIES[leap].level || (t.cds[leap] || 0) > GAME.t + ABILITIES[id].cast + 0.8;
}

/* ------------------------------------------------------------------ */
/* the warrior: a rush held on its way                                 */
/* ------------------------------------------------------------------ */
// A Charge held on its way (a snare or a frost nova in its path, a wall, the water) comes round again in half its wait:
// the warrior's answer to the bow's and the staff's answers to the rush. From Leap Strike's level a third of the skilled
// warrior's rushes were held (85 of 268 at 50) and it won a third of its duels, a quarter against a bow
const RUSH_HELD_K = 0.5;
function rushHeld(e) {
  const now = GAME.t;
  if ((e.cds.charge || 0) > now) e.cds.charge = now + (e.cds.charge - now) * RUSH_HELD_K;
  BAL6.stats.rushHeld = (BAL6.stats.rushHeld || 0) + 1;
}

/* ------------------------------------------------------------------ */
/* the seasoned mage: a step at rank II                                */
/* ------------------------------------------------------------------ */
// a seasoned mage's spells grew 7% for each rank past the first (version 12): the mage won 31% of its skilled duels at 30
// (rank II, 7%) and 60% at 50 (rank IV, 21%) in arenas far apart. Now the elements answer it 12% more strongly from rank
// II and 2% more for each rank after (12, 14, 16%)
const MAGE_RANK = [1, 1, 1.12, 1.14, 1.16, 1.18];
const mageRankOf = (rk) => MAGE_RANK[clamp(rk, 1, MAGE_RANK.length - 1)];

/* ------------------------------------------------------------------ */
/* the Well of Eriu: a heal of its own                                 */
/* ------------------------------------------------------------------ */
// An Eriu priest's blessing comes with its Renewal, and its heal over time was laid with the priest as its source, the
// Renewal's own: a buff of the same kind and source is refreshed, not added (addBuff), so the Well's heal merged into the
// Renewal's (the greater of the two each second, for 15 s instead of 9) and gave little: the Well of Eriu won 3 of 12
// duels against a priest of no realm's way at 10. It is a heal of its own now, smaller each second, and runs beside the
// Renewal's
const WELL_SRC = 'well';
Object.assign(PRIEST_REALM, { eriuHot: 0.012 }); // version 13: 0.025 (merged into the Renewal's)
CLASS_REALM.priest[1].text = `Your blessing heals ${+(PRIEST_REALM.eriuHot * 100).toFixed(1)}% a second for 15 s beside your Renewal, and frees allies from snares and roots; your holy ground heals half again as much.`;

// a skilled archer casts its long shots (an aimed shot, a piercing shot, Deadeye) with a priest close by when the priest is
// off its mace and its Holy Fire will not be ready to flare the shot away before it flies; it held them for any foe on
// foot within 13 m, and a priest keeping 8 m off it out-healed its instant arrows (85 harm a second at 30, against 186 at a
// mage)
function archerCastsBy(e, o) {
  if (o.cls !== 'priest' || e.level < ABILITIES.tumble.level) return false;
  const d = dist(e.x, e.z, o.x, o.z);
  if (d < (o.meleeRange || 2.7) * (o.scale || 1) + ARCHER_PRIEST_REACH) return false;
  return d > FLARE_REACH + 1.5 || o.level < ABILITIES.holyfire.level || (o.cds.holyfire || 0) > GAME.t + ABILITIES.deadeye.cast + 0.4;
}

/* ------------------------------------------------------------------ */
/* the archers' realm ways, evened out again                           */
/* ------------------------------------------------------------------ */
// each realm's way of the archer still beat an archer of no realm's way in 71-81% of their duels at 10 and 30 in arenas far
// apart (duels.py kind=flavour, 24 a realm): a mirror is a race that any edge decides. Each keeps its character at about
// half its measure: Logres draws 8% sooner (15%), Eriu's shot from hiding strikes 55% harder (65%; a plain archer's 50%),
// Thule's arrows drift three quarters as much in the wind (half), its snares hold 3.75 s (4) and it strikes chilled foes 5%
// harder (10%)
Object.assign(ARCHER_REALM, { logresDraw: 0.92, eriuAmbush: 1.55, thuleWind: 0.75, thuleSnare: 3.75, thuleChill: 1.05 });
CLASS_REALM.archer[0].text = `You reach full draw ${Math.round((1 - ARCHER_REALM.logresDraw) * 100)}% sooner, and drawn shots from a wall or a tower strike 20% harder.`;
CLASS_REALM.archer[1].text = `You hide in half the time and stay hidden while you walk; a shot from hiding strikes ${Math.round((ARCHER_REALM.eriuAmbush - 1) * 100)}% harder instead of 50%.`;
CLASS_REALM.archer[2].text = `The wind moves your arrows only ${ARCHER_REALM.thuleWind === 0.75 ? 'three quarters' : Math.round(ARCHER_REALM.thuleWind * 100) + '%'} as much, your snares freeze what they catch and hold it ${ARCHER_REALM.thuleSnare} s, and you strike chilled and frozen foes ${Math.round((ARCHER_REALM.thuleChill - 1) * 100)}% harder.`;

/* ---- what a player reads ---- */
ABILITIES.charge.desc += ` A rush held on its way (a snare, a frost, a wall) comes round again in half its wait.`;
ABILITIES.ward.desc = 'Absorbs damage equal to 35% of your health, and bites back at anyone who strikes you in your focus: burning, chilling or shocking them. While it holds, a stun that strikes you breaks on it instead, at half its strength, and so does a blow that would break your spell (it costs the ward a quarter of what it has left).';
ABILITIES.renew.desc = `Heals 32% over 9 seconds. On yourself it also loosens roots, and for 4 s nothing but a stun breaks your spells; cast on yourself while your last Renewal still has more than ${RENEW_ROTE_LEFT} s to mend, it costs ${['', 'once', 'twice', 'three times', 'four times'][RENEW_ROTE_K] || RENEW_ROTE_K + ' times'} the power. With 20 devotion it also blesses the target.`;

// the loading screen's word on the callings (10d_classes_ui.js keeps the rest; LOADING_TIPS is declared in 10c_lore.js,
// which loads after this module, so the push waits for every module to load)
setTimeout(() => {
  LOADING_TIPS.push(
    'A mage behind its Arcane Ward keeps its spell: a blunt arrow, a storm or a flare that would break it breaks on the ward instead.',
    'A warrior whose Charge is held on its way, by a snare, a frost or a wall, has it back in half the time.',
    'A priest who renews itself before its last Renewal has run out pays twice the power for it: renew at need.',
  );
}, 0);

setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.bal6 = { BAL6, breakFires: balBreakFires, cleanArena: balCleanArena, STEADY_NEXT, steadyCast, castSteady, steadyNext, RENEW_ROTE_K, RENEW_ROTE_LEFT, renewRote, renewRoteCost, archerPresser, archerCastsBy, WARD_GUARD, wardTakesBreak, spellGuarded, botMageElbow, mageAoeWorth, RUSH_HELD_K, rushHeld, MAGE_RANK, mageRankOf };
}, 0);
