/* ================================================================== */
/* [late2] the late game (version 16): what a veteran is known by, what  */
/* it grows into past the cap, and foes that keep pace with it past 40   */
/* ================================================================== */
// Three things, each saved with the character (save part `char.x.late`), each told of on the Chronicle's Deeds page,
// the Aims page, the path tracker once the path is walked and the field notes:
//  - Deeds and the names they earn. The March tallies what you do (champions and keep lords brought down, keeps taken
//    and hallows carried home with you there, campaigns won, Cinderwing, the Hollow King, masterworks made, foes of the
//    realms slain, veterancy). A deed done often enough earns a name (`LATE2_NAMES`): the March calls you by it, it
//    shows with your name on your frame, and the name you wear gives you something of the deed (one at a time: what
//    you wear is a choice). A name is paid for in realm points when it is earned.
//  - Veterancy past the cap. At level 50 experience no longer ends (`addXP` returned at the cap): it raises your
//    veterancy, rank by rank (`late2VetNeed`), shown in the experience bar. Each rank is a boon to learn
//    (`LATE2_BOONS`, five steps each): health, harm, power, a steady eye, thick skin, an old campaigner's realm points.
//    Boons can be unlearned for gold (the only thing a level 50 buys with it).
//  - The risen of the borderlands. Past level 40 the three farthest borderland camps of every homeland (the bands from
//    30 to 40) are taken by risen champions who keep pace with you (`late2Band`: the camp a few levels round yours, its
//    champion one to three above it), each with its own name. A risen champion breaks the ground about it after a
//    moment's warning (a glowing ring: step out of it), rallies its pack at half its strength and calls two more, and
//    fights on enraged at a quarter. It pays a third piece of the best gear, a second trophy, a share of a level in
//    experience and realm points, and counts toward its own deed.
// Everything here touches the player alone: the realm war, the armies and the measures of the callings are as they were
// for a character that has no name, no boons and is under 40.

const LATE2_RISE_AT = 40; // the level at which the borderlands' farthest camps rise with you
const LATE2_BOON_MAX = 5; // steps of each boon
const LATE2_RISEN_HP = 20, LATE2_RISEN_DMG = 1.6; // a risen champion's might over a mob of its kind and level (by the square root of its kind's health)
const LATE2 = {
  d: { champ: 0, high: 0, lord: 0, keep: 0, hallow: 0, camp: 0, dragon: 0, king: 0, mw: 0 }, // the tally of deeds
  names: [], worn: null, // names earned, the one worn
  vet: 0, vxp: 0, // veterancy past the cap, and the experience toward its next rank
  boons: {}, // boon id -> steps learned
  seeded: false, // an older character's deeds taken from its path once
  std: { made: false, at: null }, // the standard of your name: made, and where it stands planted ({ x, z }) or null
  w: { t: 0, carried: null, keepRealm: null, campN: null, near: false, rk: null }, // the watcher's memory (not saved)
  stats: { wrath: 0, wrathHits: 0, rallies: 0, risenFell: 0, risenSpawned: 0, camps: 0, named: 0, vetRanks: 0 },
};

/* ------------------------------------------------------------------ */
/* deeds and names                                                     */
/* ------------------------------------------------------------------ */
const LATE2_DEEDS = {
  foes: 'Foes of the realms slain', champ: 'Champions brought down', high: 'Risen champions brought down', lord: 'Keep lords slain',
  keep: 'Keeps taken with you there', hallow: 'Hallows carried home', camp: 'Campaigns won with you there', dragon: 'Cinderwing brought down',
  king: 'The Hollow King laid to rest', mw: 'Named masterworks made', vet: 'Veterancy', rr: 'Realm rank',
};
// t: the name, as it follows yours ("Aldric Kingsbane", "Aldric the Victor"); k: what wearing it gives
const LATE2_NAMES = [
  { id: 'blooded', t: 'the Blooded', deed: 'foes', n: 25, rp: 150, k: { realm: 0.02 }, gift: 'You strike soldiers of the enemy realms 2% harder.' },
  { id: 'reaver', t: 'the Reaver', deed: 'foes', n: 250, rp: 600, k: { realm: 0.04 }, gift: 'You strike soldiers of the enemy realms 4% harder.' },
  { id: 'scourge', t: 'the Scourge', deed: 'foes', n: 1000, rp: 2000, k: { realm: 0.06, rp: 0.05 }, gift: 'You strike soldiers of the enemy realms 6% harder and win 5% more realm points.' },
  { id: 'champbane', t: 'Championsbane', deed: 'champ', n: 5, rp: 400, k: { champ: 0.06 }, gift: 'You strike champions 6% harder: borderland and risen champions, keep lords, Cinderwing and the Hollow King.' },
  { id: 'lordslayer', t: 'Lordslayer', deed: 'lord', n: 3, rp: 500, k: { lordDr: 0.08 }, gift: 'Keep lords, the wardens of hallows and of musters strike you 8% softer.' },
  { id: 'wastebane', t: 'Wastebane', deed: 'high', n: 3, rp: 800, k: { wildDr: 0.08 }, gift: 'Creatures of the wilds and the dead strike you 8% softer.' },
  { id: 'gatebreaker', t: 'Gatebreaker', deed: 'keep', n: 3, rp: 600, k: { gate: 0.15 }, gift: 'You strike gates and siege engines 15% harder.' },
  { id: 'bearer', t: 'the Hallow-bearer', deed: 'hallow', n: 1, rp: 500, k: { bearDr: 0.12 }, gift: 'While you bear a hallow, blows strike you 12% softer.' },
  { id: 'victor', t: 'the Victor', deed: 'camp', n: 1, rp: 1000, k: { rp: 0.1 }, gift: 'You win 10% more realm points.' },
  { id: 'dragonfoe', t: 'Dragonfoe', deed: 'dragon', n: 1, rp: 800, k: { fireDr: 0.15 }, gift: 'Fire harms you 15% less: a dragon\'s breath, fire spells, burning.' },
  { id: 'kingsbane', t: 'Kingsbane', deed: 'king', n: 1, rp: 400, k: { dead: 0.08 }, gift: 'You strike the dead 8% harder: barrow bones, draugr and everything that walks in the Barrow.' },
  { id: 'masterwright', t: 'Masterwright', deed: 'mw', n: 1, rp: 500, k: { wear: 0.3 }, gift: 'Your gear wears 30% slower.' },
  { id: 'unbowed', t: 'the Unbowed', deed: 'vet', n: 10, rp: 1500, k: { hp: 0.03 }, gift: 'You have 3% more health.' },
  // realm ranks past the great gift: the realm's own names for those who serve it longest (said after a comma)
  { id: 'rr6', t: 'Champion of {realm}', sep: ', ', deed: 'rr', n: 6, rp: 0, k: { giftCd: 0.15 }, gift: 'Your realm\'s great gift comes round 15% sooner.' },
  { id: 'rr8', t: 'Marshal of {realm}', sep: ', ', deed: 'rr', n: 8, rp: 0, k: { aura: 0.03 }, gift: 'Soldiers of your realm within 20 m of you strike 3% harder.' },
  { id: 'rr10', t: 'Hero of the March', sep: ', ', deed: 'rr', n: 10, rp: 0, k: { hp: 0.04 }, gift: 'You have 4% more health.' },
  { id: 'rr12', t: 'Sword of {realm}', sep: ', ', deed: 'rr', n: 12, rp: 0, k: { all: 0.03 }, gift: 'Everything you strike, you strike 3% harder.' },
  { id: 'rr15', t: 'Legend of the March', sep: ', ', deed: 'rr', n: 15, rp: 0, k: { hp: 0.02, all: 0.02 }, gift: 'You have 2% more health, and strike everything 2% harder.' }, // [balance8] 3% and 3%: worn with the thirty boons it won a priests' mirror at 50 21 of 24 (balance8.py vet)
];
// a name as it is said after yours: "Aldric Kingsbane", "Aldric, Marshal of Logres"
const late2T = (N) => (N ? N.t.replace('{realm}', GAME.player ? REALMS[GAME.player.faction].name : 'the Realm') : '');
const late2Say = (P, N) => (N ? `${P.name}${N.sep || ' '}${late2T(N)}` : P.name);
const LATE2_BY_ID = Object.fromEntries(LATE2_NAMES.map((N) => [N.id, N]));
const late2Count = (deed) => (deed === 'foes' ? (GAME.prog ? GAME.prog.realmKills || 0 : 0) : deed === 'vet' ? LATE2.vet : deed === 'rr' ? (GAME.prog ? realmRank(GAME.prog.rp) : 1) : LATE2.d[deed] || 0);
const late2Worn = () => (LATE2.worn && LATE2_BY_ID[LATE2.worn]) || null;
const late2K = (k) => { const N = late2Worn(); return (N && N.k[k]) || 0; };
function late2Deed(deed, n = 1) {
  if (!(deed in LATE2.d) || !GAME.prog) return;
  LATE2.d[deed] += n;
  late2CheckNames(false);
  saveSoon();
}
function late2CheckNames(quiet) {
  const P = GAME.player;
  if (!P || !GAME.prog) return;
  for (const N of LATE2_NAMES) {
    if (LATE2.names.includes(N.id) || late2Count(N.deed) < N.n) continue;
    LATE2.names.push(N.id);
    LATE2.stats.named++;
    if (!LATE2.worn) { LATE2.worn = N.id; setupStats(P, true); }
    if (quiet) continue;
    uiBanner(N.deed === 'rr' ? `${REALMS[P.faction].name} names you ${late2T(N)}` : `The March names you ${late2T(N)}`, P.faction);
    uiLog(`You have earned a name: ${late2Say(P, N)}. ${N.gift}${LATE2.worn === N.id ? '' : ' Wear it on the Chronicle\'s Deeds page.'}`, 'level');
    sfx('fanfare');
    flashScreen([1.0, 0.85, 0.45], 0.25);
    if (N.rp) addRP(N.rp);
  }
}
// the player's name as the March says it: with the name it wears
function late2Named(P) { return late2Say(P, late2Worn()); }
function late2Wear(id) {
  const P = GAME.player;
  if (id && !LATE2.names.includes(id)) return false;
  LATE2.worn = id || null;
  if (P) setupStats(P, true);
  saveSoon();
  return true;
}

/* ------------------------------------------------------------------ */
/* veterancy past the cap, and its boons                               */
/* ------------------------------------------------------------------ */
// [balance8] the fighting boons at half their first measure (1% health, harm, critical blows and softer, 2% power a step):
// all thirty steps made a veteran's skilled bot win its mirror duels at 50 23 of 24 as a priest (7 of 24 without), and a worn
// name with them 20.5 of 24 as an archer (15 without): a veteran felt them, and they decided a duel between equals
// (tools/tests/balance8.py vet; Balance of the callings, version 17)
const LATE2_BOONS = [
  { id: 'hide', n: 'Iron hide', x: '½% more health', k: 'hp', v: 0.005 },
  { id: 'edge', n: 'Keen edge', x: 'your blows and spells ½% harder', k: 'dmg', v: 0.005 },
  { id: 'wells', n: 'Deep wells', x: '1% more power', k: 'pow', v: 0.01 },
  { id: 'eye', n: 'Steady eye', x: '½% more critical blows', k: 'crit', v: 0.005 },
  { id: 'skin', n: 'Thick skin', x: 'blows strike you ½% softer', k: 'dr', v: 0.005 },
  { id: 'campaigner', n: 'Old campaigner', x: '4% more realm points', k: 'rp', v: 0.04 },
];
const LATE2_BOON_BY_ID = Object.fromEntries(LATE2_BOONS.map((B) => [B.id, B]));
// the experience a rank of veterancy takes: a level's worth at 49, a little more with every rank
const late2VetNeed = (v) => Math.round(xpToNext(LEVEL_CAP - 1) * (1 + 0.06 * v));
const late2Spent = () => LATE2_BOONS.reduce((a, B) => a + (LATE2.boons[B.id] || 0), 0);
const late2Free = () => Math.max(0, Math.min(LATE2.vet, LATE2_BOONS.length * LATE2_BOON_MAX) - late2Spent());
const late2BoonK = (k) => LATE2_BOONS.reduce((a, B) => a + (B.k === k ? B.v * (LATE2.boons[B.id] || 0) : 0), 0);
const LATE2_FORGET_COST = 1500; // gold, to unlearn every boon
// experience at the cap (addXP hands it over, 07_entities.js)
function late2VetXP(n) {
  const prog = GAME.prog;
  if (!prog || !(n > 0)) return;
  LATE2.vxp += n;
  uiLog(`You gain ${fmtInt(n)} experience toward veterancy.`, 'xp');
  let up = 0;
  while (LATE2.vxp >= late2VetNeed(LATE2.vet) && LATE2.vet < 999) { LATE2.vxp -= late2VetNeed(LATE2.vet); LATE2.vet++; up++; }
  if (!up) return;
  LATE2.stats.vetRanks += up;
  const P = GAME.player;
  FX.levelUp(P.x, P.y, P.z);
  sfx('levelup');
  const free = late2Free();
  uiToast(`Veterancy ${LATE2.vet}.${free ? ` A boon to learn: ${IS_TOUCH ? 'tap your path' : 'J'}, then Deeds.` : ''}`, 'level');
  uiLog(`Your veterancy reaches rank ${LATE2.vet}.${free ? ' Learn a boon on the Chronicle\'s Deeds page.' : ''}`, 'level');
  late2CheckNames(false);
  saveSoon();
}
function late2Learn(id) {
  const B = LATE2_BOON_BY_ID[id];
  if (!B || late2Free() < 1 || (LATE2.boons[id] || 0) >= LATE2_BOON_MAX) return false;
  LATE2.boons[id] = (LATE2.boons[id] || 0) + 1;
  if (GAME.player) setupStats(GAME.player, true);
  sfx('levelup');
  saveSoon();
  return true;
}
function late2Forget() {
  if (!late2Spent() || INV.gold < LATE2_FORGET_COST) return false;
  INV.gold -= LATE2_FORGET_COST;
  LATE2.boons = {};
  if (GAME.player) setupStats(GAME.player, true);
  sfx('coins');
  saveSoon();
  return true;
}
// the Character page's figures (10_ui.js renderMenu)
function late2CharStats() {
  const prog = GAME.prog;
  if (!prog) return '';
  return `<div class="stat"><small>Names</small><b>${LATE2.names.length} of ${LATE2_NAMES.length}</b></div>` + (prog.level >= LEVEL_CAP ? `<div class="stat"><small>Veterancy</small><b>${LATE2.vet}</b></div>` : '');
}
// the experience bar at the cap (10_ui.js updateHUD)
function late2XpBar() { const need = late2VetNeed(LATE2.vet); return [clamp(LATE2.vxp / need, 0, 1), `Veterancy ${LATE2.vet} · ${fmtInt(LATE2.vxp)} / ${fmtInt(need)}`]; }

/* ------------------------------------------------------------------ */
/* what a name and the boons give (only ever the player's)             */
/* ------------------------------------------------------------------ */
// setupStats, after the gear (07_entities.js)
function late2Stats(e) {
  if (e !== GAME.player || !GAME.prog) return;
  const hp = late2BoonK('hp') + late2K('hp'), pow = late2BoonK('pow'), crit = late2BoonK('crit');
  if (hp) e.maxHp *= 1 + hp;
  if (pow) e.maxPower *= 1 + pow;
  if (crit) e.critBonus = (e.critBonus || 0) + crit;
}
const late2IsDead = (e) => e.mobType === 'skeleton' || e.mobType === 'draugr' || inDungeon(e);
const late2IsChampion = (e) => !!e.elite || e.role === 'lord' || e.role === 'dungeonBoss' || e.role === 'boss' || e.kind === 'dragon';
// dealDamage, beside the realm gifts' (07_entities.js)
function late2HarmMult(src, dst, opts) {
  const P = GAME.player;
  if (!P || !GAME.prog || (src !== P && dst !== P) || src === dst) return 1;
  let k = 1;
  if (src === P) {
    if (dst.kind === 'door') k *= 1 + late2K('gate');
    else {
      if (dst.faction <= 2 && dst.faction !== P.faction) k *= 1 + late2K('realm');
      if (late2IsChampion(dst)) k *= 1 + late2K('champ');
      if (late2IsDead(dst)) k *= 1 + late2K('dead');
      if (dst.l2risen) k *= 1 + late2K('risen'); // [late4] the Roadwarden's: the risen struck harder (10o_late4.js)
    }
    k *= 1 + late2BoonK('dmg') + late2K('all');
  } else {
    if (src) {
      if (src.faction === FACTION_MONSTER) k *= 1 - late2K('wildDr');
      if (src.role === 'lord' || src.role === 'guardian' || src.role === 'muster') k *= 1 - late2K('lordDr');
    }
    if (opts && opts.kind === 'fire') k *= 1 - late2K('fireDr');
    if (P.carrying != null) k *= 1 - late2K('bearDr');
    k *= 1 - late2BoonK('dr');
  }
  return k;
}
// the realm's great gift's clock (06c_gifts.js)
const late2GiftCdK = () => 1 - late2K('giftCd');
// addRP (07_entities.js)
const late2RpMult = () => 1 + late2K('rp') + late2BoonK('rp');
// wearItem (05h_wear.js): only the player's own gear wears
const late2WearMult = () => 1 - late2K('wear');

/* ------------------------------------------------------------------ */
/* the risen of the borderlands                                        */
/* ------------------------------------------------------------------ */
const LATE2_RISEN_NAMES = {
  bandit: ['Morcant the Gallows-Cheat', 'Hesk Red-Hand', 'Wenlock the Unhanged'],
  bear: ['Old Scarback', 'the Grey Sow of Carrow', 'Grimbold Bonebreaker'],
  skeleton: ['the Crowned Bones of Hen Dinas', 'Sir Ancel the Unshriven', 'the Herald of the Last Hill'],
  wisp: ['the Lantern of the Drowned King', 'the Mere-Mother\'s Eye', 'the Weeping Fire'],
  wolf: ['Hollowhowl', 'the White Hunger', 'Ashfang the Old'],
  boar: ['Gorebristle the Elder', 'the Barrow-Rooter'],
  draugr: ['Jarl Hrafnkel Grave-Crown', 'Saeunn of the Cold Howe', 'Kolbein Frost-Beard'],
  troll: ['Grumhild the Mountain\'s Daughter', 'Old Stoneskin', 'Hrungnir Moss-Crown'],
};
// which camps rise: per homeland, its borderland camps from the bands of 30 up (the three farthest), 0 the lowest
function late2RiseK(camp) {
  if (camp.l2k !== undefined) return camp.l2k;
  for (const c of CAMPS) c.l2k = -1;
  for (let r = 0; r < 3; r++) {
    const list = CAMPS.filter((c) => c.elite && c.realm === r && c.lmin >= 30).sort((a, b) => a.lmin - b.lmin);
    list.forEach((c, i) => { c.l2k = Math.min(2, i); });
  }
  return camp.l2k;
}
// risen now (`l2on`: set when the camp is taken over, which waits while you stand in it: late2Rescale)
const late2Risen = (camp) => late2RiseK(camp) >= 0 && !!camp.l2on;
// a camp's band of levels: [lowest, highest, the champion's step above the highest] (spawnMob, 08_ai.js)
function late2Band(camp) {
  if (!late2Risen(camp)) return [camp.lmin, camp.lmax, 1];
  const w = warLevel(), k = late2RiseK(camp);
  return [w - 4 + k, w - 1 + k, 2];
}
function late2RisenName(camp) { const L = LATE2_RISEN_NAMES[camp.type] || ['the Risen']; return L[camp.id % L.length]; }
// every body a camp spawns (spawnMob, 08_ai.js): its place in the band, and a risen champion's name and might
function late2OnSpawn(e, camp, elite) {
  if (!late2Risen(camp)) return;
  if (!elite) { e.l2off = e.level - late2Band(camp)[0]; return; }
  e.l2risen = true;
  e.name = late2RisenName(camp);
  // a risen champion looks the part: a little greater, a humanoid's weapon alight (the dead's with their own cold
  // fire), a beast's coat darker, a wisp burning ember-red
  e.scale *= 1.08;
  const Lk = e.look;
  if (Lk) {
    if (Lk.scale) Lk.scale = e.scale;
    if (e.kind === 'humanoid') Lk.flags = ((Lk.flags || 0) & 15) | ((camp.type === 'skeleton' || camp.type === 'draugr' ? 2 : 1) << 4) | (3 << 7);
    else if (e.kind === 'wisp' && Lk.colA) { Lk.colA = [1.9, 0.7, 0.32]; Lk.colB = [0.95, 0.32, 0.12]; }
    else if (Lk.colA) { Lk.colA = Lk.colA.map((v) => v * 0.62); if (Lk.colB) Lk.colB = Lk.colB.map((v) => v * 0.62); }
  }
  e.tweak = { hp: LATE2_RISEN_HP / Math.sqrt((MOBS[camp.type] || {}).hp || 1), dmg: LATE2_RISEN_DMG }; // (a champion's is 2.8 and 1.3: a risen one is a fight of half a minute and more)
  e.ai.l2 = null;
  late4MarkRisen(e); // [late4] embers in its coat or mail, scars, a glow by day, its name in ember (10o_late4.js)
  LATE2.stats.risenSpawned++;
}
// a camp risen or fallen back is taken over: its bodies go and new ones come (rescaleWar, 08_ai.js)
function late2Retake(c) {
  for (const id of [...c.members]) {
    const e = getEnt(id);
    c.members.delete(id);
    if (e) { e.alive = false; e.damagers = null; removeEnt(e); }
  }
  c.respawnAt.length = 0; c.eliteId = null; c.eliteAt = 0;
  for (let i = 0; i < c.count; i++) spawnMob(c, c.elite && i === 0);
  LATE2.stats.camps++;
}
function late2Rescale() {
  const on = warLevel() >= LATE2_RISE_AT, P = GAME.player;
  let rose = 0;
  for (const c of CAMPS) {
    if (late2RiseK(c) < 0) continue;
    if (!!c.l2on !== on) {
      // not under your eyes: a camp you stand in (a level gained in the middle of its fight) is taken over once you go
      if (P && P.alive && GAME.started && dist2(P.x, P.z, c.x, c.z) < 70 * 70) continue;
      c.l2on = on; late2Retake(c); if (on) rose++; continue;
    }
    if (!on) continue;
    const B = late2Band(c);
    for (const id of c.members) {
      const e = getEnt(id);
      if (!e || !e.alive) continue;
      const lv = e.elite ? B[1] + B[2] : clamp(B[0] + (e.l2off || 0), B[0], B[1]);
      if (lv !== e.level) { e.level = lv; setupStats(e, true); }
    }
  }
  // told once, as it happens (a level gained, not a character loaded at 40 and more)
  if (rose && P && GAME.started && GAME.prog && GAME.prog.level === LATE2_RISE_AT && !LATE2.toldRise) {
    LATE2.toldRise = true;
    uiToast('The farthest borderland camps have risen to meet you.', 'quest');
    uiLog(`Risen champions now hold the three farthest borderland camps of every homeland, and keep pace with you: the best spoils of the wilds. The Chronicle's Deeds page names them.`, 'level');
  }
}
// a sound from where it happens: audio2's placed sound (11c_sound.js: it fades, pans and muffles by itself; `alt`, the
// plain sound the work used before the branches met, is kept in the calls for reading)
function late2Snd(name, e, h = null, o = null, alt = null) { void alt; sfxAtE(name, e, o, h ?? 1.1); }
function late2SndAt(name, x, y, z, alt = null) { void alt; sfxAt(name, x, y, z); }
// a risen champion in a fight (thinkMob, 08_ai.js): true while it is busy with its own work
function late2ChampThink(e, t, dt) {
  const ai = e.ai, now = GAME.t;
  let S = ai.l2;
  const gap = S ? now - S.last : 0;
  // a new fight (none for 8 s, or it went home whole): the rally and the fury come again
  if (!S || (gap > 8 && !S.w)) S = ai.l2 = { next: now + 4 + Math.random() * 3, next2: now + 8 + Math.random() * 3, rally: false, enr: false, w: null, last: now };
  S.last = now;
  if (S.w && (isStunned(e) || gap > 0.3)) {
    // a stun as it rears breaks its blow (a stunned body does not think: updateNPCs, so the gap tells it): the ring dies
    // away and it is a while gathering itself again
    const W = S.w; S.w = null; S.next = now + 6 + Math.random() * 2;
    if (W.disc && W.disc.on) W.disc.age = Math.max(W.disc.age, W.disc.dur - 0.25);
    for (const m of AOE_MARKS) if (m.x === W.x && m.z === W.z && m.until > now) m.until = now;
    uiFloatAt(e.x, e.y + 2.4 * (e.scale || 1), e.z, 'Broken off', 'immune');
    late4WindBroken(e); // [late4] a reared bear comes down, a crouched beast rises, at once (10o_late4.js)
    late2Snd('stagger', e, 1.4, null, 'hit');
    LATE2.stats.broken = (LATE2.stats.broken || 0) + 1;
    return false;
  }
  if (S.w) {
    S.w.t += dt;
    if (S.w.ranged) turnToward(e, S.w.x, S.w.z, dt * 4); else if (t) turnToward(e, t.x, t.z, dt * 2);
    if (S.w.t >= S.w.total) { const W = S.w; S.w = null; late2Wrath(e, W); S.next = now + (S.enr ? 9 : 12) + Math.random() * 3; e.swingAt = Math.max(e.swingAt || 0, now + 0.8); }
    return true;
  }
  if (isStunned(e) || !t) return false;
  if (!S.rally && e.hp < e.maxHp * 0.5) { S.rally = true; late2Rally(e, t); S.next3 = now + 2.5; } // [late4] from the rally its second way (10o_late4.js)
  if (!S.enr && e.hp < e.maxHp * 0.25) {
    S.enr = true;
    addBuff(e, 'dmg', 0.2, 120, e.id);
    uiFloatAt(e.x, e.y + 2.4 * (e.scale || 1), e.z, 'Enraged', 'crit');
    late2Snd('roar', e, 1.5);
    if (GAME.player && dist2(e.x, e.z, GAME.player.x, GAME.player.z) < 60 * 60) uiLog(`${capFirst(theName(e))} fights on in a fury!`, 'warn');
  }
  const M = MOBS[e.mobType] || {}, ranged = !!M.ranged, d = dist(e.x, e.z, t.x, t.z);
  if (now > S.next2 && Math.abs((t.y || 0) - (e.y || 0)) < 3 && late2KindMove(e, t, d)) S.next2 = now + 13 + Math.random() * 4; // each kind its own way
  if (S.next3 && now > S.next3 && now > S.next2 - 11 && Math.abs((t.y || 0) - (e.y || 0)) < 3 && !e.motion && late4Second(e, t, d)) { S.next3 = now + (S.enr ? 9 : 12) + Math.random() * 3; S.next = Math.max(S.next, now + 3); } // [late4] and from the rally a second way of its kind, on a clock of its own (10o_late4.js)
  if (now < S.next) return false;
  if (ranged ? d > 26 : d > 5.2) return false;
  if (Math.abs((t.y || 0) - (e.y || 0)) > 3) return false; // not at one up on a wall or a rock
  const total = 1.45, r = ranged ? 4.6 : e.mobType === 'troll' ? 8 : 6.5, x = ranged ? t.x : e.x, z = ranged ? t.z : e.z; // (a troll's breaks the ground farther)
  S.w = { t: 0, total, x, z, r, ranged };
  S.w.disc = spellDisc(x, z, r, DISC_KIND.holy, total + 0.1, ranged ? [0.45, 1.3, 1.9] : [1.9, 0.55, 0.16]);
  aoeMarker(x, z, r, total, e.faction); // (the skilled bots step out of it: 07c_balance7.js)
  Object.assign(AOE_MARKS[AOE_MARKS.length - 1], { stun: !ranged, src: e.id }); // [balance8] a blow that stuns: a skilled warrior steps out of it too, or bashes its champion as it rears (b8StunMark, 07c_balance8.js)
  e.swingAt = Math.max(e.swingAt || 0, now + total + 0.5);
  late4WindUp(e, total); // [late4] a humanoid's overhead smash (8), a bear rearing (20), a wolf or a boar crouching to spring (22): 10o_late4.js
  late2Snd(ranged ? 'cast' : 'roarSmall', e, 2);
  return true;
}
// the blow that breaks the ground (or, for a wisp, the drowned light bursting up under its foe)
function late2Wrath(e, W) {
  if (!e.alive) return;
  const y = heightAt(W.x, W.z);
  if (W.ranged) {
    for (let n = 0; n < 34; n++) { const a = Math.random() * TAU, r = Math.random() * W.r; fxAdd.emit(W.x + Math.cos(a) * r, y + 0.1, W.z + Math.sin(a) * r, 0, 4 + Math.random() * 5, 0, 0.5, 0.5, 1.4, 2.0, 0.24, 0, 0.5); }
    lightFlash(W.x, y + 2, W.z, 10, [0.6, 1.6, 2.3], 0.5);
    late2SndAt('lance', W.x, y + 0.5, W.z);
  } else {
    spellDisc(W.x, W.z, W.r * 0.8, DISC_KIND.crack, 7);
    natureCut(W.x, W.z, W.r * 0.6, 0.85, false); // [look5] the grass pounded to stubble where the ground broke: in a meadow the cracks lay under the blades (05h_nature.js; it grows back)
    spellDisc(W.x, W.z, W.r, DISC_KIND.shock, 0.8, [1.7, 1.05, 0.55]);
    for (let n = 0; n < 16; n++) { const a = n / 16 * TAU; FX.dust(W.x + Math.cos(a) * W.r * 0.7, y, W.z + Math.sin(a) * W.r * 0.7, 3); }
    FX.burst(W.x, y + 0.3, W.z, 24, [1.6, 0.8, 0.3], 4, 0.5, 0.14, 7);
    lightFlash(W.x, y + 1, W.z, 9, [2.2, 1.1, 0.45], 0.35);
    cameraShake(0.32, W.x, W.z);
    late2Snd('slam', e, 0.2);
  }
  LATE2.stats.wrath++;
  forNear(W.x, W.z, W.r + 0.5, (o) => {
    if (!o.alive || o === e || !isEnemy(e, o) || !isActor(o)) return;
    if (dist(o.x, o.z, W.x, W.z) > W.r || Math.abs((o.y || 0) - y) > 3) return;
    const r = computeDamage(e, o, W.ranged ? 1.3 : 1.6);
    dealDamage(e, o, r.d, { crit: r.crit, kind: W.ranged ? 'frost' : 'melee', heavy: true });
    if (W.ranged) addBuff(o, 'snare', 0.4, 3, e.id); else addBuff(o, 'stun', 1, 0.9, e.id);
    LATE2.stats.wrathHits++;
  });
}
// each kind of risen its own way, on a clock of its own (late2ChampThink): true when it acted
const LATE2_KIND = { wolf: 'howl', boar: 'howl', bear: 'howl', skeleton: 'grave', draugr: 'grave', bandit: 'hamstring', troll: 'burst', wisp: 'blink' };
function late2KindMove(e, t, d) {
  const way = LATE2_KIND[e.mobType], camp = late4CampOf(e), P = GAME.player, near = P && dist2(e.x, e.z, P.x, P.z) < 60 * 60; // [late4] (a roaming host's own stand-in camp: 10o_late4.js)
  if (way === 'howl') { // the hunt's howl: its foes slowed, its pack's blood up
    if (d > 14) return false;
    late2Snd('roar', e, 1.2); FX.ring(e.x, e.y + 0.4, e.z, 3.5, [1.2, 1.0, 0.8], 36, 5);
    forNear(e.x, e.z, 14, (o) => { if (o.alive && isEnemy(e, o) && isActor(o)) addBuff(o, 'snare', 0.35, 4, e.id); });
    if (camp) for (const id of camp.members) { const m = getEnt(id); if (m && m.alive && dist2(m.x, m.z, e.x, e.z) < 20 * 20) addBuff(m, 'dmg', 0.15, 8, e.id); }
    if (near) uiLog(`${capFirst(theName(e))} howls, and the pack's blood is up.`, 'warn');
  } else if (way === 'grave') { // the dead call the dead: two rise out of the ground about its foe
    if (d > 22 || !camp || camp.members.size >= camp.count + 4) return false;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * TAU, x = t.x + Math.cos(a) * 3.2, z = t.z + Math.sin(a) * 3.2;
      if (!isWalkable(x, z)) continue;
      const m = spawnMob(camp);
      late4Adopt(camp, m); // [late4] one called up by a roaming host walks with it (10o_late4.js)
      m.x = m.prevX = x; m.z = m.prevZ = z; m.y = heightAt(x, z);
      m.threat = new Map([[t.id, 1]]); m.target = t.id; m.ai.pulled = true;
      FX.dust(x, m.y, z, 10); lightFlash(x, m.y + 1, z, 6, [0.6, 1.2, 1.5], 0.4);
    }
    late2Snd('raise', e);
    if (near) uiLog(`${capFirst(theName(e))} calls the dead up out of the ground!`, 'warn');
  } else if (way === 'hamstring') { // a cut to the back of the leg: slowed, and wounds that mend slowly
    if (d > (e.meleeRange || 2.6) + 0.6) return false;
    setAct(e, 1, 0.5); turnToward(e, t.x, t.z, 9);
    const r = computeDamage(e, t, 1.1);
    dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee' });
    addBuff(t, 'snare', 0.5, 5, e.id); addBuff(t, 'wound', 0.3, 6, e.id);
    uiFloatAt(t.x, t.y + 2.2, t.z, 'Hamstrung', 'hurt'); late2Snd('hit', t);
  } else if (way === 'burst') { // it stamps, and the ground bursts under a foe that keeps off
    if (d < 7 || d > 24) return false;
    const x = t.x, z = t.z;
    spellDisc(x, z, 3.2, DISC_KIND.holy, 1.2, [1.6, 0.9, 0.35]); aoeMarker(x, z, 3.2, 1.15, e.faction); late2Snd('slam', e, 0.2);
    if (B9T.burstRing) Object.assign(AOE_MARKS[AOE_MARKS.length - 1], { stun: true, src: e.id }); // [balance9] it stuns: the skilled hands step out of its ring as out of the wrath's (b8RingAt), casters too (07c_balance9.js)
    later(1.15, () => {
      if (!e.alive) return;
      const y = heightAt(x, z);
      spellDisc(x, z, 2.8, DISC_KIND.crack, 6); natureCut(x, z, 2.0, 0.85, false); /* [look5] the grass pounded where the ground burst */ FX.burst(x, y + 0.2, z, 26, [0.5, 0.42, 0.33], 6, 0.7, 0.2, 9); FX.dust(x, y, z, 12); cameraShake(0.2, x, z); late2SndAt('quake', x, null, z, 'crash');
      forNear(x, z, 3.6, (o) => { if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, x, z) > 3.2 || Math.abs((o.y || 0) - y) > 2.5) return; const r = computeDamage(e, o, 1.4); dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee', heavy: true }); addBuff(o, 'stun', 1, 0.6, e.id); });
    });
  } else if (way === 'blink') { // a wisp slips away from a blade at its side
    if (d > 4.5) return false;
    const dx = (e.x - t.x) / Math.max(0.1, d), dz = (e.z - t.z) / Math.max(0.1, d), R = dashReach(e, e.x, e.z, dx, dz, 10);
    if (R.d < 4) return false;
    FX.burst(e.x, e.y + 1, e.z, 20, [0.6, 1.4, 2.0], 3, 0.4, 0.16, 0);
    e.x = e.prevX = R.x; e.z = e.prevZ = R.z;
    FX.burst(e.x, e.y + 1, e.z, 20, [0.6, 1.4, 2.0], 3, 0.4, 0.16, 0); late2Snd('blink', e);
  } else return false;
  LATE2.stats.kinds = (LATE2.stats.kinds || 0) + 1;
  return true;
}
// at half its strength: a roar, its pack mended, and two more come at its call
function late2Rally(e, t) {
  const camp = late4CampOf(e); // [late4] (a roaming host's own: 10o_late4.js)
  late2Snd('roar', e, 1.5);
  FX.ring(e.x, e.y + 0.3, e.z, 2.6, [2.0, 1.25, 0.5], 40);
  lightFlash(e.x, e.y + 2, e.z, 10, [2.0, 1.3, 0.6], 0.6);
  e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.06);
  if (!camp) return;
  for (const id of camp.members) { const o = getEnt(id); if (o && o.alive && o !== e && dist2(o.x, o.z, e.x, e.z) < 22 * 22) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.2); FX.heal(o.x, o.y, o.z); } }
  for (let i = 0; i < 2; i++) {
    const m = spawnMob(camp);
    late4Adopt(camp, m); // [late4]
    if (t) { m.threat = new Map([[t.id, 1]]); m.target = t.id; m.ai.pulled = true; }
    FX.dust(m.x, m.y, m.z, 8);
  }
  LATE2.stats.rallies++;
  if (GAME.player && dist2(e.x, e.z, GAME.player.x, GAME.player.z) < 60 * 60) uiLog(`${capFirst(theName(e))} calls its pack to it!`, 'warn');
}
// a risen champion's spoils, beyond a champion's (late2OnKill)
function late2RisenSpoils(e) {
  const P = GAME.player, prog = GAME.prog, L = prog.level;
  const it = makeItem({ cls: P.cls, realm: P.faction, lvl: dropIlvl(Math.max(e.level - 2, L)), q: rollQuality(DROP_WEIGHTS.boss) });
  dropItem(it, e.x, e.z, e.y + 1.0 * (e.scale || 1));
  dropGood('trophy', 1, e.x, e.z, e.y + 0.8);
  addXP(Math.round(20 * e.level * Math.max(0.5, CON[conIndex(e.level, L)].xp) * 6), e);
  addRP(250);
  uiToast(`${capFirst(e.name)} has fallen. The borderlands will tell of it.`, 'quest');
  LATE2.stats.risenFell++;
}

/* ------------------------------------------------------------------ */
/* the standard of your name                                           */
/* ------------------------------------------------------------------ */
// From level 40, with a name of your own, a veteran may have a standard made (gold: what a level 50 has and cannot
// spend) and plant it on open ground: a pole of ash with a gilt finial and its realm's flag streaming downwind from it
// (the banners' own cloth and shader, 04_props.js: one instance kept for it). While it stands, every soldier of your
// realm, every companion of yours and you within its reach strike harder. Taken up again with Use beside it; planted
// anew it is brought to you. Saved with the character.
const LATE2_STD = { cost: 1000, lv: 40, reach: 18, harm: 0.05, poleH: 5.2, flagW: 2.7, flagH: 1.55, flagTop: 4.95 }; // [late4] a veteran's: a long swallow-tailed flag lashed down the head of a taller pole, its device read from 15 m (it was 1.35 by 0.8 at the top of 3.7 m)
const L2STD = { mesh: null, slot: -1, coll: null, tick: 0 };
function late2StdBuild() {
  if (L2STD.mesh) return;
  // drawn with the building shader (its plaster branch tinted as ash, as a tower's hatch lids are; the gilt finial its gold):
  // no program of its own, lit by the sun, the shadows and the fires, wet in rain and white in snow as the rest of the world
  const b = new Batch(), h = LATE2_STD.poleH, T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z), ash = [0.42, 0.31, 0.2], gilt = [0.86, 0.66, 0.3];
  b.add(new THREE.CylinderGeometry(0.042, 0.06, h, 10, 1), T(0, h / 2, 0), MAT.plaster, ash, 0, 2.2); // the pole, thicker at its foot
  b.add(new THREE.CylinderGeometry(0.066, 0.066, 0.55, 10, 1), T(0, 1.25, 0), MAT.cloth, [0.2, 0.13, 0.08]); // a leather grip
  // [late4] the flag is lashed down the head of the pole between two gilt bands (it turns about the pole with the wind,
  // so no cross-bar): a third band under them, the shoe at the foot, and a gilt spear-point for a finial
  const top = LATE2_STD.flagTop, bot = top - LATE2_STD.flagH;
  for (const y of [top + 0.03, bot - 0.03, bot - 0.42]) b.add(new THREE.CylinderGeometry(0.058, 0.058, 0.07, 10, 1), T(0, y, 0), MAT.gold, gilt);
  b.add(new THREE.CylinderGeometry(0.068, 0.06, 0.16, 10, 1), T(0, 0.08, 0), MAT.gold, [0.5, 0.42, 0.3]); // the shoe
  b.add(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 8, 1), T(0, h + 0.06, 0), MAT.gold, gilt); // the socket
  b.add(new THREE.ConeGeometry(0.07, 0.42, 4, 1), T(0, h + 0.33, 0), MAT.gold, gilt); // the spear-point
  b.add(new THREE.SphereGeometry(0.06, 8, 6), T(0, h + 0.13, 0), MAT.gold, gilt); // the knop under it
  const m = new THREE.Mesh(b.build(), buildingMat);
  m.position.set(0, -999, 0); // (in the scene from the start, out of sight until it is planted)
  m.userData.keep = false;
  scene.add(m);
  shadowCaster(m, BUILDING_DEPTH || (BUILDING_DEPTH = depthFrom(buildingMat)));
  L2STD.mesh = m;
  L2STD.slot = BANNERS.length;
  addBanner(null, { world: true, x: 0, y: -999, z: 0, yaw: 0, w: 0.001, h: 0.001, kind: 1 }, 0);
}
// open ground before you for it: the land itself (no floor, no water, no house, nothing standing within a flag's length,
// no tree whose crown it would stream into), not under the Barrow
function late2StdSpot(P) {
  if (inDungeon(P) || P.swim || P.y - heightAt(P.x, P.z) > 0.4) return null; // (from the land, not a wall or a boat)
  const a0 = P.yaw, out = [];
  for (const [d, da] of [[1.6, 0], [1.6, 0.6], [1.6, -0.6], [2.4, 0], [2.4, 1.2], [2.4, -1.2], [1.4, 2.4], [1.4, -2.4], [3.2, 0.3], [3.2, -0.3]]) {
    const x = P.x + Math.sin(a0 + da) * d, z = P.z + Math.cos(a0 + da) * d;
    if (!isWalkable(x, z) || houseAt(x, z, 3.0)) continue; // [late4] (a flag of 2.7 m: 1.8 before)
    const w = waterAt(x, z); if (w && w.depth > 0.05) continue;
    const g = heightAt(x, z); if (floorAt(x, z, g + 4.6) - g > 0.25) continue; // (no floor there, nor a walk or a stair over it)
    collidersNear(x, z, 3.6, out);
    if (out.some((c) => c.active && c !== L2STD.coll && (collCovers(c, x, z, 1.5) || ((c.h || 0) > 3.2 && collCovers(c, x, z, 2.9))))) continue; // [late4] nothing standing as high as the flag within its length
    if (W.trees.some((t) => !t.gone && !t.felled && !t.fallen && dist2(t.x, t.z, x, z) < (2.9 + 1.6 * (t.s || 1)) ** 2)) continue; // [late4] (2.2 m before)
    return { x, z };
  }
  return null;
}
function late2StdShow() {
  late2StdBuild();
  const at = LATE2.std.at, B = bannerGeo.attributes;
  if (L2STD.coll) { L2STD.coll.active = false; L2STD.coll = null; }
  if (!at) {
    L2STD.mesh.position.set(0, -999, 0);
    B.aB0.array.set([0, -999, 0, 0], L2STD.slot * 4); B.aB1.array.set([0.001, 0.001, 0, 1], L2STD.slot * 4);
  } else {
    const y = heightAt(at.x, at.z) - 0.08, realm = GAME.player ? GAME.player.faction : 0;
    L2STD.mesh.position.set(at.x, y, at.z);
    B.aB0.array.set([at.x, y + LATE2_STD.flagTop, at.z, 0], L2STD.slot * 4); // [late4] the flag's hoist down the pole's head
    B.aB1.array.set([LATE2_STD.flagW, LATE2_STD.flagH, realm + late3StdCode(), late4StdKind()], L2STD.slot * 4); // [late3] the device of your name on its flag (10n_veteran.js); [late4] kind 2, a veteran's standard, and how torn it is (10o_late4.js)
    L2STD.coll = addCircle(at.x, at.z, 0.12, 'prop', LATE2_STD.poleH);
  }
  L2STD.mesh.updateMatrixWorld(); // (its shadow's proxy copies it this frame)
  B.aB0.needsUpdate = true; B.aB1.needsUpdate = true;
  late3StdPose(); // [late3] struck down, it lies fallen (10n_veteran.js)
}
try { late2StdBuild(); } catch (e) { console.error(e); } // (at load, so the boot's compile makes its program with the rest)
const late2StdOk = () => !!GAME.prog && GAME.prog.level >= LATE2_STD.lv && LATE2.names.length > 0;
function late2StdMake() {
  if (!late2StdOk() || LATE2.std.made || INV.gold < LATE2_STD.cost) return false;
  INV.gold -= LATE2_STD.cost;
  LATE2.std.made = true;
  sfx('coins');
  uiLog(`The banner-makers of ${REALMS[GAME.player.faction].townName} sew the standard of ${late2Named(GAME.player)}. Plant it from the Chronicle's Deeds page.`, 'loot');
  saveSoon();
  return true;
}
function late2StdPlant() {
  const P = GAME.player;
  if (!P || !LATE2.std.made || !P.alive) return false;
  const sp = late2StdSpot(P);
  if (!sp) { uiError('No open ground here for your standard'); return false; }
  LATE2.std.at = { x: Math.round(sp.x * 100) / 100, z: Math.round(sp.z * 100) / 100 };
  late2StdShow();
  setAct(P, 5, 0.8); // (a reach: the body drives the pole in)
  late2Snd('thud', P, 0.2); FX.dust(sp.x, heightAt(sp.x, sp.z), sp.z, 8);
  uiLog(`You plant the standard of ${late2Named(P)}. ${REALMS[P.faction].name} fights the harder about it.`, 'level');
  saveSoon();
  return true;
}
function late2StdTake() {
  if (!LATE2.std.at) return false;
  LATE2.std.at = null;
  if (L3V.std.tear) { L3V.std.tear = 0; uiLog('Furled, its rents are mended.', 'sys'); } // [late4] the torn cloth mended while it is carried (10o_late4.js)
  late2StdShow();
  if (GAME.player && GAME.player.alive) setAct(GAME.player, 5, 0.7); // (a reach: the pole pulled up)
  sfx('equip');
  uiLog('You take up your standard.', 'sys');
  saveSoon();
  return true;
}
// Use beside it (09_player.js currentInteraction)
function late2Offers(P, offer) {
  const at = LATE2.std.at;
  if (at && !inDungeon(P) && !late3StdDown()) offer(dist(P.x, P.z, at.x, at.z), 2.6, 'Take up your standard', () => late2StdTake(), 0.4); // [late3] fallen, it is raised first (10n_veteran.js)
  late3StdOffers(P, offer); // [late3] a fallen standard raised again (10n_veteran.js)
}
// while it stands: your realm's soldiers, your companions and you within its reach strike harder (once a second)
function late2StdStep() {
  const at = LATE2.std.at, P = GAME.player;
  // a Marshal's presence: your realm's soldiers about you strike harder
  const aura = P && P.alive ? late2K('aura') : 0;
  if (aura) forNear(P.x, P.z, 20, (o) => { if (o.alive && o !== P && o.faction === P.faction && isActor(o) && o.kind !== 'door' && o.role !== 'villager') addBuff(o, 'dmg', aura, 1.6, 'l2aura'); });
  late3StdStep(); // [late3] foes hew at it, and strike it down (10n_veteran.js)
  if (!at || !P || late3StdDown()) return;
  if (Math.random() < 0.5) sfxAt('flap', at.x, heightAt(at.x, at.z) + 3.4, at.z); // (its cloth in the wind: audio2's)
  forNear(at.x, at.z, LATE2_STD.reach, (o) => {
    if (!o.alive || o.kind === 'door' || o.faction !== P.faction || !isActor(o)) return;
    if (o !== P && o.role === 'villager') return;
    addBuff(o, 'dmg', LATE2_STD.harm, 1.6, 'l2std');
  });
}

/* ------------------------------------------------------------------ */
/* the herald's bounty on a risen champion, and the March hailing you  */
/* ------------------------------------------------------------------ */
// past 40 the herald asks for one of your homeland's risen champions (openHerald, 10_ui.js): one of them, brought down
// by you (bountyOnKill hands it here, 09_player.js), for more than a bounty of six pays; saved with the bounty (`risen`)
function late2HeraldBounty() {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !prog || prog.level < LATE2_RISE_AT || prog.bounty) return null;
  const camps = CAMPS.filter((c) => late2Risen(c) && c.realm === P.faction);
  if (!camps.length) return null;
  const c = camps[(prog.realmKills + prog.kills) % camps.length], rn = late2RisenName(c), nm = capFirst(rn);
  const nb = { type: c.type, camp: c.id, need: 1, have: 0, name: rn, reward: Math.round(xpToNext(Math.min(prog.level, LEVEL_CAP - 1)) * 0.6), risen: 1 };
  const xp = prog.level >= LEVEL_CAP ? `${fmtInt(nb.reward)} experience toward your veterancy` : `${fmtInt(nb.reward)} experience`;
  return {
    b: nb,
    text: `<p>${esc(nm)} has risen in the far borderlands of ${esc(REALMS[P.faction].homeName)}, and the roads there are empty for fear of it. Bring it down and ${esc(REALMS[P.faction].name)} will reward you with ${xp}, ${fmtInt(Math.round(nb.reward * 0.1))} realm points and ${10 + prog.level * 5} gold. Its camp is circled on your map.</p>`,
    accept: () => { prog.bounty = nb; closeDialog(); uiToast(`Bounty accepted: bring down ${rn}`, 'quest'); saveSoon(); },
  };
}
function late2BountyKill(e, b) {
  if (!e.l2risen || e.camp !== b.camp || b.done) return;
  b.have = b.need; b.done = true;
  activityRecord('bounty.completed', e.mobType || e.role || 'risen-bounty', 1, { success: true });
  uiToast('Bounty complete. Return to the herald.', 'quest'); sfx('fanfare');
}
// a soldier, a guard or a townsman of your realm you pass hails you by the name you wear, now and then
const LATE2_HAILS = [
  (n) => `Hail, ${n}!`, (n) => `${n}! The March remembers.`, (n) => `Make way for ${n}!`, (n) => `Well met, ${n}.`,
];
function late2Hail(P) {
  const N = late2Worn(), W = LATE2.w;
  if (!N || !P.alive || GAME.t < P.combatUntil + 6 || GAME.t < (W.hailT || 0) || inDungeon(P)) return;
  let who = null;
  forNear(P.x, P.z, 7, (o) => {
    if (who || !o.alive || o === P || o.faction !== P.faction && o.faction !== FACTION_NEUTRAL) return;
    if (!(o.role === 'soldier' || o.role === 'guard' || o.role === 'villager' || o.role === 'muster') || o.target) return;
    if (o.faction === FACTION_NEUTRAL && zoneAt(o.x, o.z).realm !== P.faction) return;
    if (GAME.t < (o.l2hailT || 0)) return;
    who = o;
  });
  if (!who) return;
  W.hailT = GAME.t + 40 + Math.random() * 40;
  who.l2hailT = GAME.t + 600;
  const line = LATE2_HAILS[Math.floor(Math.random() * LATE2_HAILS.length)](late2Named(P));
  uiFloatAt(who.x, who.y + 2.25 * (who.scale || 1), who.z, line, 'xp');
  late2Snd('shout', who, 1.6, { vol: 0.7 }, 'none');
  uiLog(`${who.name}: "${line}"`, 'sys');
  LATE2.stats.hails = (LATE2.stats.hails || 0) + 1;
}

/* ------------------------------------------------------------------ */
/* the deeds as they happen                                            */
/* ------------------------------------------------------------------ */
// every foe the player has a share in (grantKillRewards, 07_entities.js)
function late2OnKill(e) {
  const P = GAME.player;
  if (!P || !GAME.prog || !e) return;
  if (e.l4host && e.properName) { late4HostKill(e); return; } // [late4] the leader of a roaming host (10o_late4.js)
  if (e.elite && e.camp != null && e.faction === FACTION_MONSTER) {
    late2Deed('champ');
    if (e.l2risen) { late2Deed('high'); late2RisenSpoils(e); }
  } else if (e.role === 'lord') { late2Deed('lord'); late2Deed('champ'); }
  else if (e.role === 'dungeonBoss') late2Deed(e.deepLord ? 'deep' : 'king'); // [late3] the Ash-Crowned is a deed of his own (10m_deep.js)
  else if (e.kind === 'dragon') {
    // your share of what it took (its threat holds every blow), as the path counts it (10c_lore.js), or the last blow
    const th = (e.threat && e.threat.get(P.id)) || 0;
    if (th / Math.max(1, e.maxHp) >= 0.05 || e.lastHitBy === P.id) late2Deed('dragon');
  }
}
// a named masterwork made (guideMade, 10e_guide.js)
function late2Made(rec) { if (rec && rec.mw) late2Deed('mw'); }
// once an older character's deeds are taken from its path; then four looks a second for the deeds done with you there
function updateLate2(dt) {
  const P = GAME.player, prog = GAME.prog;
  if (!P || !prog || !GAME.started) return;
  const W = LATE2.w;
  W.t -= dt;
  if (W.t > 0) return;
  W.t = 0.25;
  if (!LATE2.seeded && prog.lore) {
    const d = LATE2.d, was = (id) => (pathDone(id) ? 1 : 0);
    d.champ = Math.max(d.champ, was('champion'));
    d.keep = Math.max(d.keep, was('keep'));
    d.hallow = Math.max(d.hallow, was('hallow'));
    d.king = Math.max(d.king, was('king'), prog.kingKills || 0);
    d.dragon = Math.max(d.dragon, was('dragon'));
    d.mw = Math.max(d.mw, was('master'));
    d.camp = Math.max(d.camp, CAMPAIGN.history.filter((h) => h.w === P.faction && h.you).length);
    LATE2.seeded = true;
    const before = LATE2.names.length;
    late2CheckNames(true);
    if (LATE2.names.length > before) uiLog(`The March remembers your deeds: ${LATE2.names.length - before} name${LATE2.names.length - before === 1 ? ' is' : 's are'} yours. The Chronicle's Deeds page lists them.`, 'level');
  }
  // soldiers of the enemy realms slain (prog.realmKills, counted after this kill's share: grantKillRewards)
  if (prog.realmKills !== W.rk) { W.rk = prog.realmKills; late2CheckNames(false); }
  const rr = realmRank(prog.rp); if (rr !== W.rr) { const was = W.rr; W.rr = rr; late2CheckNames(was == null); } // (a realm rank's name: told when it is won, not on loading)
  // a hallow carried all the way home
  if (P.carrying != null) W.carried = WAR.relics[P.carrying] || null;
  else if (W.carried) { const rel = W.carried; W.carried = null; if (rel.state === 'temple' && rel.at === P.faction) late2Deed('hallow'); }
  // a keep taken by your realm with you there
  const kr = WAR.keeps.map((K) => K.realm);
  if (W.keepRealm) WAR.keeps.forEach((K, i) => { if (K.realm === P.faction && W.keepRealm[i] !== P.faction && dist2(P.x, P.z, K.site.x, K.site.z) < 90 * 90) late2Deed('keep'); });
  W.keepRealm = kr;
  // a campaign won with you there
  const H = CAMPAIGN.history, hl = H.length ? H[H.length - 1] : null;
  if (W.campN != null && hl && hl.n !== W.campN && hl.w === P.faction && hl.you) late2Deed('camp');
  W.campN = hl ? hl.n : 0;
  if ((W.camps = (W.camps || 0) - 0.25) <= 0) { W.camps = 5; if (CAMPS.some((c) => late2RiseK(c) >= 0 && !!c.l2on !== (warLevel() >= LATE2_RISE_AT))) late2Rescale(); }
  if ((L2STD.tick = (L2STD.tick || 0) - 0.25) <= 0) { L2STD.tick = 1; late2StdStep(); late2Hail(P); }
  // near a risen camp (the field note's watch)
  W.near = prog.level >= LATE2_RISE_AT && CAMPS.some((c) => late2Risen(c) && dist2(P.x, P.z, c.x, c.z) < 110 * 110);
}

// the risen camps on the world map past 40, before the names are laid out round them (drawWorldMap, 10_ui.js)
function late2MapMarks(ctx, S, MK) {
  const at = LATE2.std.at, P = GAME.player;
  if (at && P) { // your standard: a little flag in your realm's colour
    const [x, y] = w2m(at.x, at.z, S), h = S * 0.022;
    ctx.strokeStyle = '#140a05'; ctx.lineWidth = Math.max(1.5, S * 0.0022); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    ctx.fillStyle = REALMS[P.faction].color; ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * 0.75, y - h * 0.78); ctx.lineTo(x, y - h * 0.56); ctx.closePath(); ctx.fill(); ctx.stroke();
    MK.push([x + h * 0.3, y - h * 0.6, h * 0.7]);
  }
  if (!GAME.prog || GAME.prog.level < LATE2_RISE_AT) return;
  late4MapMarks(ctx, S, MK); // [late4] the roaming hosts where they walk (10o_late4.js)
  for (const c of CAMPS) {
    if (!late2Risen(c)) continue;
    const e = getEnt(c.eliteId), up = !!(e && e.alive), [x, y] = w2m(c.x, c.z, S), r = S * 0.0085;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = up ? '#e0582a' : 'rgba(150, 128, 110, 0.55)'; ctx.strokeStyle = '#140a05'; ctx.lineWidth = Math.max(1.5, S * 0.0022);
    ctx.fillRect(-r, -r, 2 * r, 2 * r); ctx.strokeRect(-r, -r, 2 * r, 2 * r);
    if (up) { ctx.fillStyle = '#ffd9a0'; ctx.fillRect(-r * 0.32, -r * 0.32, r * 0.64, r * 0.64); }
    ctx.restore();
    MK.push([x, y, r * 1.6]);
  }
}

/* ------------------------------------------------------------------ */
/* where to go, what to aim for                                        */
/* ------------------------------------------------------------------ */
// the nearest risen champion standing, your own homeland's first
function late2RisenMark(P) {
  if (!GAME.prog || GAME.prog.level < LATE2_RISE_AT) return null;
  const R = REALMS[P.faction];
  const list = CAMPS.filter((c) => late2Risen(c)).map((c) => getEnt(c.eliteId)).filter((e) => e && e.alive);
  const own = list.filter((e) => CAMPS[e.camp] && CAMPS[e.camp].realm === P.faction);
  const hl = late4HostLead(P); if (hl) own.push(hl); // [late4] the roaming host of your homeland, where it walks (10o_late4.js)
  const e = guideNearest(own.length ? own : list, P);
  return e ? guideTown(P, R, e.x, e.z, capFirst(e.name)) : null;
}
// the aims of the late game, for the Aims page and the tracker (guideAims, 10e_guide.js)
function late2Aims() {
  const P = GAME.player, prog = GAME.prog, out = [];
  if (!P || !prog) return out;
  const k = IS_TOUCH ? 'tap your path' : 'J';
  const free = late2Free();
  if (free) out.push({ t: `Learn ${free === 1 ? 'a boon' : free + ' boons'} of veterancy`, x: `Veterancy ${LATE2.vet}: the Chronicle's Deeds page (${k}) teaches them.` });
  if (prog.level >= LEVEL_CAP) { const [f, s] = late2XpBar(); out.push({ t: `Veterancy ${LATE2.vet + 1}`, m: [f, s.replace(/^Veterancy \d+ · /, '') + ' XP'], x: 'Past level 50 your experience raises your veterancy, and every rank is a boon to learn.' }); }
  if (prog.level >= LATE2_RISE_AT) {
    const up = CAMPS.filter((c) => late2Risen(c)).map((c) => getEnt(c.eliteId)).filter((e) => e && e.alive);
    const mine = up.filter((e) => CAMPS[e.camp] && CAMPS[e.camp].realm === P.faction);
    if (up.length) out.push({ t: `Bring down a risen champion`, x: `${mine.length ? capFirst(mine[0].name) + ' and ' + (up.length - 1) + ' more' : up.length + ' of them'} hold the farthest borderland camps, a few levels above you. Risen brought down: ${LATE2.d.high}.` });
  }
  out.push(...late3Aims()); // [late3] the Deep Barrow (10m_deep.js)
  out.push(...late4Aims()); // [late4] a roaming host of the risen (10o_late4.js)
  const N = late2NextName();
  if (N) out.push({ t: `Earn a name: ${late2Say(P, N)}`, m: [late2Count(N.deed) / N.n, `${fmtInt(late2Count(N.deed))} / ${fmtInt(N.n)}`], x: `${LATE2_DEEDS[N.deed]}. ${N.gift}` });
  return out;
}
// the name nearest to being earned (by the share of its deed done), of those a character of this level can earn now
function late2NextName() {
  const prog = GAME.prog;
  let best = null, bf = -1;
  for (const N of LATE2_NAMES) {
    if (LATE2.names.includes(N.id)) continue;
    if (N.deed === 'vet' && prog.level < LEVEL_CAP) continue;
    if (N.deed === 'high' && prog.level < LATE2_RISE_AT) continue;
    if (N.deed === 'mw' && prog.level < 40) continue;
    if ((N.deed === 'dragon' || N.deed === 'camp') && prog.level < 30) continue;
    const f = late2Count(N.deed) / N.n;
    if (f > bf) { bf = f; best = N; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* the Chronicle: deeds, names, veterancy, the risen                   */
/* ------------------------------------------------------------------ */
function late2StdHTML() {
  const P = GAME.player, S = LATE2.std, R = REALMS[P.faction];
  let say = `<p>From level ${LATE2_STD.lv}, with a name of your own, the banner-makers of ${esc(R.townName)} will sew you a standard: a pole of ash with a gilt finial and ${esc(R.name)}'s colours streaming from it. Plant it on open ground and every soldier of ${esc(R.name)}, every companion of yours and you within ${LATE2_STD.reach} m of it strike ${Math.round(LATE2_STD.harm * 100)}% harder. ${IS_TOUCH ? 'Use' : 'E'} beside it takes it up again.</p>`;
  say += late3StdHTML(); // [late3] its device, and foes that strike it down (10n_veteran.js)
  if (!S.made) return say + (late2StdOk() ? `<div class="acts"><button type="button" class="btn l2-btn" data-l2="std:make"${INV.gold >= LATE2_STD.cost ? '' : ' disabled'}>Have it made (${fmtInt(LATE2_STD.cost)} gold)</button></div>` : `<p class="now">${P.level < LATE2_STD.lv ? `At level ${LATE2_STD.lv}.` : 'Once the March has given you a name.'}</p>`);
  const at = S.at, where = at ? `It stands in ${esc(zoneAt(at.x, at.z).name)}, ${Math.round(dist(P.x, P.z, at.x, at.z))} m from you.` : 'You carry it furled.';
  return say + `<p class="now">${where}</p><div class="acts"><button type="button" class="btn l2-btn" data-l2="std:plant">${at ? 'Bring it here and plant it' : 'Plant it here'}</button>${at ? '<button type="button" class="btn l2-btn" data-l2="std:take">Take it up</button>' : ''}</div>`;
}
function chronDeeds() {
  const P = GAME.player, prog = GAME.prog, R = REALMS[P.faction], worn = late2Worn();
  const earned = LATE2_NAMES.filter((N) => LATE2.names.includes(N.id)), left = LATE2_NAMES.filter((N) => !LATE2.names.includes(N.id));
  const meter = (a, b) => `<span class="meter"><i><b style="width:${(clamp(a / Math.max(1, b), 0, 1) * 100).toFixed(1)}%"></b></i>${fmtInt(Math.min(a, b))} / ${fmtInt(b)}</span>`;
  const names = earned.length
    ? `<ul class="gd-aims l2-names">${earned.map((N) => `<li${N === worn ? ' class="on"' : ''}><b>${esc(late2Say(P, N))}</b><small>${esc(N.gift)}</small>${N === worn ? '<span class="l2-tag">Worn</span>' : `<button type="button" class="btn l2-btn" data-l2="wear:${N.id}">Wear this name</button>`}</li>`).join('')}</ul>${worn ? '<div class="acts"><button type="button" class="btn l2-btn" data-l2="wear:">Go by your own name</button></div>' : ''}`
    : '<p>No name yet. The first comes soon enough: twenty-five soldiers of the enemy realms, a champion of the borderlands five times over, the Hollow King or Cinderwing.</p>';
  const toEarn = left.map((N) => `<li><b>${esc(late2T(N))}</b>${meter(late2Count(N.deed), N.n)}<small>${esc(LATE2_DEEDS[N.deed])}. ${esc(N.gift)}${N.rp ? ` Earned: ${fmtInt(N.rp)} realm points.` : ''}</small></li>`).join('');
  const tally = Object.keys(LATE2_DEEDS).map((k) => `<li><b>${fmtInt(late2Count(k))}</b> ${esc(LATE2_DEEDS[k].toLowerCase())}</li>`).join('');
  const free = late2Free();
  const vet = prog.level >= LEVEL_CAP
    ? `<p class="now">Veterancy <b>${LATE2.vet}</b>: ${late2XpBar()[1].replace(/^Veterancy \d+ · /, '')} experience to the next rank. ${free ? `<b>${free}</b> boon${free === 1 ? '' : 's'} to learn.` : 'Every rank you have is learned.'}</p>
      <ul class="gd-aims l2-boons">${LATE2_BOONS.map((B) => { const s = LATE2.boons[B.id] || 0; return `<li><b>${esc(B.n)} ${s ? RANK_NUMERAL[s] : ''}</b><small>${esc(capFirst(B.x))} a step${s ? `: ${+(B.v * s * 100).toFixed(1)}% now` : ''}, to ${LATE2_BOON_MAX} steps.</small>${s >= LATE2_BOON_MAX ? '<span class="l2-tag">Mastered</span>' : `<button type="button" class="btn l2-btn" data-l2="boon:${B.id}"${free ? '' : ' disabled'}>Learn${s ? ' the next step' : ''}</button>`}</li>`; }).join('')}</ul>
      ${late2Spent() ? `<div class="acts"><button type="button" class="btn l2-btn" data-l2="forget"${INV.gold >= LATE2_FORGET_COST ? '' : ' disabled'}>Unlearn every boon (${fmtInt(LATE2_FORGET_COST)} gold)</button></div>` : ''}`
    : `<p>At level 50 your experience does not end: it raises your veterancy, rank by rank, and every rank is a boon to learn here. You are level ${prog.level}.</p>`;
  const risen = CAMPS.filter((c) => late2RiseK(c) >= 0).sort((a, b) => a.realm - b.realm || a.lmin - b.lmin);
  const risenList = risen.map((c) => {
    const e = getEnt(c.eliteId), up = late2Risen(c);
    const st = !up ? `<span class="gd-at">from level ${LATE2_RISE_AT}</span>` : e && e.alive ? `<span class="gd-ok">level ${e.level}</span>` : '<span class="gd-at">fallen: back in a few minutes</span>';
    return `<li><b>${esc(capFirst(late2RisenName(c)))}</b> ${st}<small>The ${esc((MOB_PLURAL[c.type] || c.type).toLowerCase())} of the far borderlands of ${esc(REALMS[c.realm].name)}.</small></li>`;
  }).join('');
  const stdUp = late2StdOk(); // (one you can have made, plant or take up comes up under your names, open: what you can do first)
  return `<p class="lead">The March remembers what you do in it. Deeds earn you names, and the name you wear gives you something of the deed it was earned by; it shows with your own on your frame. Past level 50 your experience raises your veterancy, and every rank is a boon.</p>
    <h3${earned.length <= 4 ? ' data-cf-open' : ''}>Your names</h3>${names}${late3MantleHTML() /* [late3] the mantle of your name (10n_veteran.js) */}
    ${stdUp ? `<h3 data-cf-open>The standard of your name</h3>${late2StdHTML()}` : ''}
    <h3>Names still to earn</h3><ul class="gd-aims">${toEarn || '<li><b>Every name is yours.</b></li>'}</ul>
    <h3>Your deeds</h3><ul class="plain l2-tally">${tally}</ul>
    <h3${prog.level >= LEVEL_CAP && free ? ' data-cf-open' : ''}>Veterancy</h3>${vet}
    ${stdUp ? '' : `<h3>The standard of your name</h3>${late2StdHTML()}`}
    <h3>The risen of the borderlands</h3><p>From level ${LATE2_RISE_AT} the three farthest borderland camps of every homeland are held by risen champions who keep pace with you: their camps a few levels round yours, the champion one to three above it. A risen champion breaks the ground about it after a moment's warning (a glowing ring: step out of it, or stun it as it rears and the blow is broken off; a troll's ring is wider), rallies its pack at half its strength and calls two more to it, and fights on in a fury at a quarter. Each kind has a way of its own besides: a beast howls, slowing its foes and stirring its pack; the dead call the dead up out of the ground about their foe; an outlaw hamstrings, slowing you and keeping your wounds from mending; a troll stamps and the ground bursts under a foe that keeps off (another glowing ring); a wisp slips away from a blade at its side. Each pays a third piece of the best gear, a second trophy, a share of a level in experience and realm points.</p>
    <ul class="gd-aims">${risenList}</ul>${prog.level >= LATE2_RISE_AT ? '<p>On the map an ember diamond marks each risen camp, bright while its champion stands.</p>' : ''}
    ${late4DeedsHTML() /* [late4] how the risen wind up, their second way, and the roaming hosts (10o_late4.js) */}
    <p class="now">Now: ${earned.length ? `${earned.length} name${earned.length === 1 ? '' : 's'} of ${LATE2_NAMES.length}${worn ? `, wearing <b>${esc(late2T(worn))}</b>` : ''}` : 'no name yet'}${prog.level >= LEVEL_CAP ? `, veterancy ${LATE2.vet}` : ''}, realm rank ${realmRank(prog.rp)} of ${R.name}.</p>
    <div class="acts">${chronLink('goals', 'Aims')}${chronLink('path', 'Your path')}</div>`;
}
chronAdd('deeds', 'Deeds', 'you', chronDeeds, 'gear'); // (at the end of its row: a page before Gear put Gear off an upright phone's row, guide.py)
G2_SEE.deeds = ['goals', 'wilds']; // [guide2] the pages a reader goes on to (10f_guide2.js)
$('menu-body').addEventListener('click', (ev) => {
  const b = ev.target.closest('.chron [data-l2]');
  if (!b || b.disabled) return;
  const [act, id] = b.dataset.l2.split(':');
  let ok = false;
  if (act === 'wear') ok = late2Wear(id || null);
  else if (act === 'boon') ok = late2Learn(id);
  else if (act === 'forget') ok = late2Forget();
  else if (act === 'std') {
    if (id === 'make') ok = late2StdMake();
    else if (id === 'take') ok = late2StdTake();
    else if (id === 'plant') { if (late2StdPlant()) { closeMenu(); return; } }
  }
  if (ok) { sfx('click'); renderChronicle($('menu-body'), true); }
});
// the Aims page: what opens past 40 and 50
CHRON_EXTRA.goals.push(() => `<div class="gd-tier"><h4>Past 40 and past 50</h4><ul class="plain">
  <li><b>The risen of the borderlands</b>: from level ${LATE2_RISE_AT} the farthest camps of every homeland rise with you, each led by a risen champion with its own name. The best spoils of the wilds.</li>
  <li><b>Veterancy</b>: past level 50 your experience raises your veterancy, and every rank is a boon to learn (five steps each of six).</li>
  <li><b>Names</b>: the March names you for your deeds (${LATE2.names.length} of ${LATE2_NAMES.length} yours). Wear one and it gives you something of the deed.</li>
  <li><b>The standard of your name</b>: from level ${LATE2_STD.lv}, with a name, have one made and plant it where you fight: your realm strikes harder about it. ${chronLink('deeds', 'Deeds')}</li></ul></div>`);

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
for (const [id, note] of Object.entries({
  l2name: { t: 'A name of your own', x: () => `The March has named you for your deeds. The name shows with yours on your frame, and the one you wear gives you something of its deed: choose it on the Chronicle's Deeds page (${IS_TOUCH ? 'tap your path' : 'J'}).` },
  l2risen: { t: 'The risen of the borderlands', x: () => 'Risen champions who keep pace with you hold the farthest borderland camps now. When the ground about one glows, step out of the ring, or stun it as it rears. At half its strength it calls its pack.' },
  l2std: { t: 'The standard of your name', x: () => `A veteran with a name may have a standard made (the Chronicle's Deeds page) and plant it where it fights: your realm's soldiers, your companions and you strike harder about it. ${IS_TOUCH ? 'Use' : 'E'} beside it takes it up.` },
  l2vet: { t: 'Veterancy', x: () => `Past level 50 your experience raises your veterancy, and every rank is a boon to learn: health, harm, power, a steady eye, thick skin, realm points. ${IS_TOUCH ? 'Tap your path' : 'J'}, then Deeds.` },
})) if (!FIELD_NOTES[id]) FIELD_NOTES[id] = note;
Object.assign(GUIDE_WATCH, {
  l2name: () => LATE2.names.length > 0,
  l2risen: () => LATE2.w.near,
  l2vet: () => LATE2.vet > 0 || (GAME.prog && GAME.prog.level >= LEVEL_CAP),
  l2std: () => late2StdOk() && !LATE2.std.made,
});
GUIDE_HELP.push(() => `<h3>Past 40 and past 50</h3><p>The March names you for your deeds: champions and lords brought down, keeps taken, hallows carried home, campaigns won, Cinderwing and the Hollow King. Wear a name and it gives you something of the deed (the Chronicle's Deeds page). From level 40 risen champions hold the farthest borderland camps of every homeland, and keep pace with you. Past level 50 your experience raises your veterancy: every rank is a boon to learn. From level 40, with a name, you may have a standard made and plant it where you fight (${IS_TOUCH ? 'Use' : 'E'} beside it takes it up).</p>`);
LOADING_TIPS.push(
  'The March names you for your deeds. Wear a name and it gives you something of the deed: the Chronicle\'s Deeds page.',
  'From level 40, risen champions hold the farthest borderland camps of every homeland. When the ground about one glows, step out of the ring.',
  'Past level 50 your experience raises your veterancy. Every rank is a boon to learn.',
);

/* ------------------------------------------------------------------ */
/* the save: deeds, names, veterancy and boons, with the character     */
/* ------------------------------------------------------------------ */
registerSavePart('char', 'late', {
  save() {
    return { v: 1, d: { ...LATE2.d }, n: LATE2.names.slice(), w: LATE2.worn, vt: LATE2.vet, vx: Math.round(LATE2.vxp), b: { ...LATE2.boons }, s: LATE2.seeded ? 1 : 0, sm: LATE2.std.made ? 1 : 0, sp: LATE2.std.at ? [LATE2.std.at.x, LATE2.std.at.z] : null };
  },
  load(o) {
    const int = (v, a, b) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(Math.floor(+v), a, b) : a);
    o = o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    const d = o && o.d && typeof o.d === 'object' ? o.d : {};
    for (const k in LATE2.d) LATE2.d[k] = int(d[k], 0, 1e7);
    LATE2.names = o && Array.isArray(o.n) ? [...new Set(o.n.filter((id) => typeof id === 'string' && LATE2_BY_ID[id]))] : [];
    LATE2.worn = o && typeof o.w === 'string' && LATE2.names.includes(o.w) ? o.w : null;
    LATE2.vet = o ? int(o.vt, 0, 999) : 0;
    LATE2.vxp = o ? Math.min(int(o.vx, 0, 1e9), late2VetNeed(LATE2.vet) - 1) : 0;
    LATE2.boons = {};
    const b = o && o.b && typeof o.b === 'object' ? o.b : {};
    let room = LATE2.vet;
    for (const B of LATE2_BOONS) { const s = Math.min(int(b[B.id], 0, LATE2_BOON_MAX), room); if (s > 0) { LATE2.boons[B.id] = s; room -= s; } }
    LATE2.seeded = !!(o && o.s);
    LATE2.w = { t: 0, carried: null, keepRealm: null, campN: null, near: false, rk: null };
    LATE2.std = { made: !!(o && o.sm), at: null };
    const sp = o && Array.isArray(o.sp) && o.sp.length === 2 && o.sp.every((v) => Number.isFinite(+v) && Math.abs(+v) < HALF) ? { x: +o.sp[0], z: +o.sp[1] } : null;
    if (LATE2.std.made && sp && isWalkable(sp.x, sp.z)) LATE2.std.at = sp;
    try { late2StdShow(); } catch (e) { reportError(e); }
  },
  // what counts as a change worth writing: the deeds, names, ranks, boons; the experience in thousands
  key: (o) => (o ? [o.d, o.n, o.w, o.vt, Math.floor((o.vx || 0) / 1000), o.b, o.s, o.sm, o.sp] : null),
});

queueMicrotask(() => { if (window.__hm) window.__hm.late = { LATE2, LATE2_NAMES, LATE2_BOONS, LATE2_DEEDS, LATE2_RISE_AT, late2Deed, late2CheckNames, late2Wear, late2Learn, late2Forget, late2VetXP, late2VetNeed, late2Free, late2Spent, late2BoonK, late2K, late2HarmMult, late2RpMult, late2WearMult, late2GiftCdK, late2Named, late2XpBar, late2Band, late2RiseK, late2Risen, late2Rescale, late2RisenName, late2RisenMark, late2Aims, late2NextName, late2ChampThink, late2Wrath, late2Rally, late2OnKill, chronDeeds, updateLate2, late2KindMove, LATE2_STD, L2STD, late2StdMake, late2StdPlant, late2StdTake, late2StdSpot, late2StdShow, late2StdStep, late2Offers, late2HeraldBounty, late2BountyKill, late2Hail }; });
