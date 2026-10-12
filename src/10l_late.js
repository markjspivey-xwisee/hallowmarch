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
  w: { t: 0, carried: null, keepRealm: null, campN: null, near: false, rk: null }, // the watcher's memory (not saved)
  stats: { wrath: 0, wrathHits: 0, rallies: 0, risenFell: 0, risenSpawned: 0, camps: 0, named: 0, vetRanks: 0 },
};

/* ------------------------------------------------------------------ */
/* deeds and names                                                     */
/* ------------------------------------------------------------------ */
const LATE2_DEEDS = {
  foes: 'Foes of the realms slain', champ: 'Champions brought down', high: 'Risen champions brought down', lord: 'Keep lords slain',
  keep: 'Keeps taken with you there', hallow: 'Hallows carried home', camp: 'Campaigns won with you there', dragon: 'Cinderwing brought down',
  king: 'The Hollow King laid to rest', mw: 'Named masterworks made', vet: 'Veterancy',
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
];
const LATE2_BY_ID = Object.fromEntries(LATE2_NAMES.map((N) => [N.id, N]));
const late2Count = (deed) => (deed === 'foes' ? (GAME.prog ? GAME.prog.realmKills || 0 : 0) : deed === 'vet' ? LATE2.vet : LATE2.d[deed] || 0);
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
    uiBanner(`The March names you ${N.t}`, P.faction);
    uiLog(`You have earned a name: ${P.name} ${N.t}. ${N.gift}${LATE2.worn === N.id ? '' : ' Wear it on the Chronicle\'s Deeds page.'}`, 'level');
    sfx('fanfare');
    flashScreen([1.0, 0.85, 0.45], 0.25);
    addRP(N.rp);
  }
}
// the player's name as the March says it: with the name it wears
function late2Named(P) { const N = late2Worn(); return N ? `${P.name} ${N.t}` : P.name; }
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
const LATE2_BOONS = [
  { id: 'hide', n: 'Iron hide', x: '1% more health', k: 'hp', v: 0.01 },
  { id: 'edge', n: 'Keen edge', x: 'your blows and spells 1% harder', k: 'dmg', v: 0.01 },
  { id: 'wells', n: 'Deep wells', x: '2% more power', k: 'pow', v: 0.02 },
  { id: 'eye', n: 'Steady eye', x: '1% more critical blows', k: 'crit', v: 0.01 },
  { id: 'skin', n: 'Thick skin', x: 'blows strike you 1% softer', k: 'dr', v: 0.01 },
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
    }
    k *= 1 + late2BoonK('dmg');
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
  for (const c of CAMPS) {
    if (late2RiseK(c) < 0) continue;
    if (!!c.l2on !== on) {
      // not under your eyes: a camp you stand in (a level gained in the middle of its fight) is taken over once you go
      if (P && P.alive && GAME.started && dist2(P.x, P.z, c.x, c.z) < 70 * 70) continue;
      c.l2on = on; late2Retake(c); continue;
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
}
// a risen champion in a fight (thinkMob, 08_ai.js): true while it is busy with its own work
function late2ChampThink(e, t, dt) {
  const ai = e.ai, now = GAME.t;
  let S = ai.l2;
  // a new fight (none for 8 s, or it went home whole): the rally and the fury come again
  if (!S || (now - S.last > 8 && !S.w)) S = ai.l2 = { next: now + 4 + Math.random() * 3, next2: now + 8 + Math.random() * 3, rally: false, enr: false, w: null, last: now };
  S.last = now;
  if (S.w) {
    S.w.t += dt;
    if (S.w.ranged) turnToward(e, S.w.x, S.w.z, dt * 4); else if (t) turnToward(e, t.x, t.z, dt * 2);
    if (S.w.t >= S.w.total) { const W = S.w; S.w = null; late2Wrath(e, W); S.next = now + (S.enr ? 9 : 12) + Math.random() * 3; e.swingAt = Math.max(e.swingAt || 0, now + 0.8); }
    return true;
  }
  if (isStunned(e) || !t) return false;
  if (!S.rally && e.hp < e.maxHp * 0.5) { S.rally = true; late2Rally(e, t); }
  if (!S.enr && e.hp < e.maxHp * 0.25) {
    S.enr = true;
    addBuff(e, 'dmg', 0.2, 120, e.id);
    uiFloatAt(e.x, e.y + 2.4 * (e.scale || 1), e.z, 'Enraged', 'crit');
    if (GAME.player && dist2(e.x, e.z, GAME.player.x, GAME.player.z) < 60 * 60) uiLog(`${capFirst(theName(e))} fights on in a fury!`, 'warn');
  }
  const M = MOBS[e.mobType] || {}, ranged = !!M.ranged, d = dist(e.x, e.z, t.x, t.z);
  if (now > S.next2 && Math.abs((t.y || 0) - (e.y || 0)) < 3 && late2KindMove(e, t, d)) S.next2 = now + 13 + Math.random() * 4; // each kind its own way
  if (now < S.next) return false;
  if (ranged ? d > 26 : d > 5.2) return false;
  if (Math.abs((t.y || 0) - (e.y || 0)) > 3) return false; // not at one up on a wall or a rock
  const total = 1.45, r = ranged ? 4.6 : e.mobType === 'troll' ? 8 : 6.5, x = ranged ? t.x : e.x, z = ranged ? t.z : e.z; // (a troll's breaks the ground farther)
  S.w = { t: 0, total, x, z, r, ranged };
  spellDisc(x, z, r, DISC_KIND.holy, total + 0.1, ranged ? [0.45, 1.3, 1.9] : [1.9, 0.55, 0.16]);
  aoeMarker(x, z, r, total, e.faction); // (the skilled bots step out of it: 07c_balance7.js)
  e.swingAt = Math.max(e.swingAt || 0, now + total + 0.5);
  if (e.kind === 'humanoid') setAct(e, 8, total + 0.15);
  sfx(ranged ? 'cast' : 'roarSmall');
  return true;
}
// the blow that breaks the ground (or, for a wisp, the drowned light bursting up under its foe)
function late2Wrath(e, W) {
  if (!e.alive) return;
  const y = heightAt(W.x, W.z);
  if (W.ranged) {
    for (let n = 0; n < 34; n++) { const a = Math.random() * TAU, r = Math.random() * W.r; fxAdd.emit(W.x + Math.cos(a) * r, y + 0.1, W.z + Math.sin(a) * r, 0, 4 + Math.random() * 5, 0, 0.5, 0.5, 1.4, 2.0, 0.24, 0, 0.5); }
    lightFlash(W.x, y + 2, W.z, 10, [0.6, 1.6, 2.3], 0.5);
    sfx('lance');
  } else {
    spellDisc(W.x, W.z, W.r * 0.8, DISC_KIND.crack, 7);
    spellDisc(W.x, W.z, W.r, DISC_KIND.shock, 0.8, [1.7, 1.05, 0.55]);
    for (let n = 0; n < 16; n++) { const a = n / 16 * TAU; FX.dust(W.x + Math.cos(a) * W.r * 0.7, y, W.z + Math.sin(a) * W.r * 0.7, 3); }
    FX.burst(W.x, y + 0.3, W.z, 24, [1.6, 0.8, 0.3], 4, 0.5, 0.14, 7);
    lightFlash(W.x, y + 1, W.z, 9, [2.2, 1.1, 0.45], 0.35);
    cameraShake(0.32, W.x, W.z);
    sfx('slam');
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
  const way = LATE2_KIND[e.mobType], camp = CAMPS[e.camp], P = GAME.player, near = P && dist2(e.x, e.z, P.x, P.z) < 60 * 60;
  if (way === 'howl') { // the hunt's howl: its foes slowed, its pack's blood up
    if (d > 14) return false;
    sfx('roar'); FX.ring(e.x, e.y + 0.4, e.z, 3.5, [1.2, 1.0, 0.8], 36, 5);
    forNear(e.x, e.z, 14, (o) => { if (o.alive && isEnemy(e, o) && isActor(o)) addBuff(o, 'snare', 0.35, 4, e.id); });
    if (camp) for (const id of camp.members) { const m = getEnt(id); if (m && m.alive && dist2(m.x, m.z, e.x, e.z) < 20 * 20) addBuff(m, 'dmg', 0.15, 8, e.id); }
    if (near) uiLog(`${capFirst(theName(e))} howls, and the pack's blood is up.`, 'warn');
  } else if (way === 'grave') { // the dead call the dead: two rise out of the ground about its foe
    if (d > 22 || !camp || camp.members.size >= camp.count + 4) return false;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * TAU, x = t.x + Math.cos(a) * 3.2, z = t.z + Math.sin(a) * 3.2;
      if (!isWalkable(x, z)) continue;
      const m = spawnMob(camp);
      m.x = m.prevX = x; m.z = m.prevZ = z; m.y = heightAt(x, z);
      m.threat = new Map([[t.id, 1]]); m.target = t.id; m.ai.pulled = true;
      FX.dust(x, m.y, z, 10); lightFlash(x, m.y + 1, z, 6, [0.6, 1.2, 1.5], 0.4);
    }
    sfx('raise');
    if (near) uiLog(`${capFirst(theName(e))} calls the dead up out of the ground!`, 'warn');
  } else if (way === 'hamstring') { // a cut to the back of the leg: slowed, and wounds that mend slowly
    if (d > (e.meleeRange || 2.6) + 0.6) return false;
    setAct(e, 1, 0.5); turnToward(e, t.x, t.z, 9);
    const r = computeDamage(e, t, 1.1);
    dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee' });
    addBuff(t, 'snare', 0.5, 5, e.id); addBuff(t, 'wound', 0.3, 6, e.id);
    uiFloatAt(t.x, t.y + 2.2, t.z, 'Hamstrung', 'hurt'); sfx('hit');
  } else if (way === 'burst') { // it stamps, and the ground bursts under a foe that keeps off
    if (d < 7 || d > 24) return false;
    const x = t.x, z = t.z;
    spellDisc(x, z, 3.2, DISC_KIND.holy, 1.2, [1.6, 0.9, 0.35]); aoeMarker(x, z, 3.2, 1.15, e.faction); sfx('slam');
    later(1.15, () => {
      if (!e.alive) return;
      const y = heightAt(x, z);
      spellDisc(x, z, 2.8, DISC_KIND.crack, 6); FX.burst(x, y + 0.2, z, 26, [0.5, 0.42, 0.33], 6, 0.7, 0.2, 9); FX.dust(x, y, z, 12); cameraShake(0.2, x, z); sfx('crash');
      forNear(x, z, 3.6, (o) => { if (!o.alive || !isEnemy(e, o) || !isActor(o) || dist(o.x, o.z, x, z) > 3.2 || Math.abs((o.y || 0) - y) > 2.5) return; const r = computeDamage(e, o, 1.4); dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee', heavy: true }); addBuff(o, 'stun', 1, 0.6, e.id); });
    });
  } else if (way === 'blink') { // a wisp slips away from a blade at its side
    if (d > 4.5) return false;
    const dx = (e.x - t.x) / Math.max(0.1, d), dz = (e.z - t.z) / Math.max(0.1, d), R = dashReach(e, e.x, e.z, dx, dz, 10);
    if (R.d < 4) return false;
    FX.burst(e.x, e.y + 1, e.z, 20, [0.6, 1.4, 2.0], 3, 0.4, 0.16, 0);
    e.x = e.prevX = R.x; e.z = e.prevZ = R.z;
    FX.burst(e.x, e.y + 1, e.z, 20, [0.6, 1.4, 2.0], 3, 0.4, 0.16, 0); sfx('blink');
  } else return false;
  LATE2.stats.kinds = (LATE2.stats.kinds || 0) + 1;
  return true;
}
// at half its strength: a roar, its pack mended, and two more come at its call
function late2Rally(e, t) {
  const camp = CAMPS[e.camp];
  sfx('roar');
  FX.ring(e.x, e.y + 0.3, e.z, 2.6, [2.0, 1.25, 0.5], 40);
  lightFlash(e.x, e.y + 2, e.z, 10, [2.0, 1.3, 0.6], 0.6);
  e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.06);
  if (!camp) return;
  for (const id of camp.members) { const o = getEnt(id); if (o && o.alive && o !== e && dist2(o.x, o.z, e.x, e.z) < 22 * 22) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.2); FX.heal(o.x, o.y, o.z); } }
  for (let i = 0; i < 2; i++) {
    const m = spawnMob(camp);
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
/* the deeds as they happen                                            */
/* ------------------------------------------------------------------ */
// every foe the player has a share in (grantKillRewards, 07_entities.js)
function late2OnKill(e) {
  const P = GAME.player;
  if (!P || !GAME.prog || !e) return;
  if (e.elite && e.camp != null && e.faction === FACTION_MONSTER) {
    late2Deed('champ');
    if (e.l2risen) { late2Deed('high'); late2RisenSpoils(e); }
  } else if (e.role === 'lord') { late2Deed('lord'); late2Deed('champ'); }
  else if (e.role === 'dungeonBoss') late2Deed('king');
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
  // near a risen camp (the field note's watch)
  W.near = prog.level >= LATE2_RISE_AT && CAMPS.some((c) => late2Risen(c) && dist2(P.x, P.z, c.x, c.z) < 110 * 110);
}

// the risen camps on the world map past 40, before the names are laid out round them (drawWorldMap, 10_ui.js)
function late2MapMarks(ctx, S, MK) {
  if (!GAME.prog || GAME.prog.level < LATE2_RISE_AT) return;
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
  const N = late2NextName();
  if (N) out.push({ t: `Earn a name: ${P.name} ${N.t}`, m: [late2Count(N.deed) / N.n, `${fmtInt(late2Count(N.deed))} / ${fmtInt(N.n)}`], x: `${LATE2_DEEDS[N.deed]}. ${N.gift}` });
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
function chronDeeds() {
  const P = GAME.player, prog = GAME.prog, R = REALMS[P.faction], worn = late2Worn();
  const earned = LATE2_NAMES.filter((N) => LATE2.names.includes(N.id)), left = LATE2_NAMES.filter((N) => !LATE2.names.includes(N.id));
  const meter = (a, b) => `<span class="meter"><i><b style="width:${(clamp(a / Math.max(1, b), 0, 1) * 100).toFixed(1)}%"></b></i>${fmtInt(Math.min(a, b))} / ${fmtInt(b)}</span>`;
  const names = earned.length
    ? `<ul class="gd-aims l2-names">${earned.map((N) => `<li${N === worn ? ' class="on"' : ''}><b>${esc(P.name)} ${esc(N.t)}</b><small>${esc(N.gift)}</small>${N === worn ? '<span class="l2-tag">Worn</span>' : `<button type="button" class="btn l2-btn" data-l2="wear:${N.id}">Wear this name</button>`}</li>`).join('')}</ul>${worn ? '<div class="acts"><button type="button" class="btn l2-btn" data-l2="wear:">Go by your own name</button></div>' : ''}`
    : '<p>No name yet. The first comes soon enough: twenty-five soldiers of the enemy realms, a champion of the borderlands five times over, the Hollow King or Cinderwing.</p>';
  const toEarn = left.map((N) => `<li><b>${esc(N.t)}</b>${meter(late2Count(N.deed), N.n)}<small>${esc(LATE2_DEEDS[N.deed])}. ${esc(N.gift)} Earned: ${fmtInt(N.rp)} realm points.</small></li>`).join('');
  const tally = Object.keys(LATE2_DEEDS).map((k) => `<li><b>${fmtInt(late2Count(k))}</b> ${esc(LATE2_DEEDS[k].toLowerCase())}</li>`).join('');
  const free = late2Free();
  const vet = prog.level >= LEVEL_CAP
    ? `<p class="now">Veterancy <b>${LATE2.vet}</b>: ${late2XpBar()[1].replace(/^Veterancy \d+ · /, '')} experience to the next rank. ${free ? `<b>${free}</b> boon${free === 1 ? '' : 's'} to learn.` : 'Every rank you have is learned.'}</p>
      <ul class="gd-aims l2-boons">${LATE2_BOONS.map((B) => { const s = LATE2.boons[B.id] || 0; return `<li><b>${esc(B.n)} ${s ? RANK_NUMERAL[s] : ''}</b><small>${esc(capFirst(B.x))} a step${s ? `: ${Math.round(B.v * s * 100)}% now` : ''}, to ${LATE2_BOON_MAX} steps.</small>${s >= LATE2_BOON_MAX ? '<span class="l2-tag">Mastered</span>' : `<button type="button" class="btn l2-btn" data-l2="boon:${B.id}"${free ? '' : ' disabled'}>Learn${s ? ' the next step' : ''}</button>`}</li>`; }).join('')}</ul>
      ${late2Spent() ? `<div class="acts"><button type="button" class="btn l2-btn" data-l2="forget"${INV.gold >= LATE2_FORGET_COST ? '' : ' disabled'}>Unlearn every boon (${fmtInt(LATE2_FORGET_COST)} gold)</button></div>` : ''}`
    : `<p>At level 50 your experience does not end: it raises your veterancy, rank by rank, and every rank is a boon to learn here. You are level ${prog.level}.</p>`;
  const risen = CAMPS.filter((c) => late2RiseK(c) >= 0).sort((a, b) => a.realm - b.realm || a.lmin - b.lmin);
  const risenList = risen.map((c) => {
    const e = getEnt(c.eliteId), up = late2Risen(c);
    const st = !up ? `<span class="gd-at">from level ${LATE2_RISE_AT}</span>` : e && e.alive ? `<span class="gd-ok">level ${e.level}</span>` : '<span class="gd-at">fallen: back in a few minutes</span>';
    return `<li><b>${esc(capFirst(late2RisenName(c)))}</b> ${st}<small>The ${esc((MOB_PLURAL[c.type] || c.type).toLowerCase())} of the far borderlands of ${esc(REALMS[c.realm].name)}.</small></li>`;
  }).join('');
  return `<p class="lead">The March remembers what you do in it. Deeds earn you names, and the name you wear gives you something of the deed it was earned by; it shows with your own on your frame. Past level 50 your experience raises your veterancy, and every rank is a boon.</p>
    <h3 data-cf-open>Your names</h3>${names}
    <h3>Names still to earn</h3><ul class="gd-aims">${toEarn || '<li><b>Every name is yours.</b></li>'}</ul>
    <h3>Your deeds</h3><ul class="plain l2-tally">${tally}</ul>
    <h3${prog.level >= LEVEL_CAP && free ? ' data-cf-open' : ''}>Veterancy</h3>${vet}
    <h3>The risen of the borderlands</h3><p>From level ${LATE2_RISE_AT} the three farthest borderland camps of every homeland are held by risen champions who keep pace with you: their camps a few levels round yours, the champion one to three above it. A risen champion breaks the ground about it after a moment's warning (a glowing ring: step out of it; a troll's ring is wider), rallies its pack at half its strength and calls two more to it, and fights on in a fury at a quarter. Each kind has a way of its own besides: a beast howls, slowing its foes and stirring its pack; the dead call the dead up out of the ground about their foe; an outlaw hamstrings, slowing you and keeping your wounds from mending; a troll stamps and the ground bursts under a foe that keeps off (another glowing ring); a wisp slips away from a blade at its side. Each pays a third piece of the best gear, a second trophy, a share of a level in experience and realm points.</p>
    <ul class="gd-aims">${risenList}</ul>${prog.level >= LATE2_RISE_AT ? '<p>On the map an ember diamond marks each risen camp, bright while its champion stands.</p>' : ''}
    <p class="now">Now: ${earned.length ? `${earned.length} name${earned.length === 1 ? '' : 's'} of ${LATE2_NAMES.length}${worn ? `, wearing <b>${esc(worn.t)}</b>` : ''}` : 'no name yet'}${prog.level >= LEVEL_CAP ? `, veterancy ${LATE2.vet}` : ''}, realm rank ${realmRank(prog.rp)} of ${R.name}.</p>
    <div class="acts">${chronLink('goals', 'Aims')}${chronLink('path', 'Your path')}</div>`;
}
chronAdd('deeds', 'Deeds', 'you', chronDeeds, 'goals');
$('menu-body').addEventListener('click', (ev) => {
  const b = ev.target.closest('.chron [data-l2]');
  if (!b || b.disabled) return;
  const [act, id] = b.dataset.l2.split(':');
  let ok = false;
  if (act === 'wear') ok = late2Wear(id || null);
  else if (act === 'boon') ok = late2Learn(id);
  else if (act === 'forget') ok = late2Forget();
  if (ok) { sfx('click'); renderChronicle($('menu-body'), true); }
});
// the Aims page: what opens past 40 and 50
CHRON_EXTRA.goals.push(() => `<div class="gd-tier"><h4>Past 40 and past 50</h4><ul class="plain">
  <li><b>The risen of the borderlands</b>: from level ${LATE2_RISE_AT} the farthest camps of every homeland rise with you, each led by a risen champion with its own name. The best spoils of the wilds.</li>
  <li><b>Veterancy</b>: past level 50 your experience raises your veterancy, and every rank is a boon to learn (five steps each of six).</li>
  <li><b>Names</b>: the March names you for your deeds (${LATE2.names.length} of ${LATE2_NAMES.length} yours). Wear one and it gives you something of the deed. ${chronLink('deeds', 'Deeds')}</li></ul></div>`);

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
for (const [id, note] of Object.entries({
  l2name: { t: 'A name of your own', x: () => `The March has given you a name for your deeds. It shows with your own on your frame, and the name you wear gives you something of the deed. Choose which to wear on the Chronicle's Deeds page (${IS_TOUCH ? 'tap your path' : 'J'}).` },
  l2risen: { t: 'The risen of the borderlands', x: () => 'The farthest borderland camps of every homeland are held now by risen champions who keep pace with you. A risen champion breaks the ground about it after a glowing warning: step out of the ring. At half its strength it calls its pack.' },
  l2vet: { t: 'Veterancy', x: () => `Past level 50 your experience raises your veterancy, and every rank is a boon to learn: health, harm, power, a steady eye, thick skin, realm points. ${IS_TOUCH ? 'Tap your path' : 'J'}, then Deeds.` },
})) if (!FIELD_NOTES[id]) FIELD_NOTES[id] = note;
Object.assign(GUIDE_WATCH, {
  l2name: () => LATE2.names.length > 0,
  l2risen: () => LATE2.w.near,
  l2vet: () => LATE2.vet > 0,
});
GUIDE_HELP.push(() => `<h3>Past 40 and past 50</h3><p>The March names you for your deeds: champions and lords brought down, keeps taken, hallows carried home, campaigns won, Cinderwing and the Hollow King. Wear a name and it gives you something of the deed (the Chronicle's Deeds page). From level 40 risen champions hold the farthest borderland camps of every homeland, and keep pace with you. Past level 50 your experience raises your veterancy: every rank is a boon to learn.</p>`);
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
    return { v: 1, d: { ...LATE2.d }, n: LATE2.names.slice(), w: LATE2.worn, vt: LATE2.vet, vx: Math.round(LATE2.vxp), b: { ...LATE2.boons }, s: LATE2.seeded ? 1 : 0 };
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
  },
  // what counts as a change worth writing: the deeds, names, ranks, boons; the experience in thousands
  key: (o) => (o ? [o.d, o.n, o.w, o.vt, Math.floor((o.vx || 0) / 1000), o.b, o.s] : null),
});

queueMicrotask(() => { if (window.__hm) window.__hm.late = { LATE2, LATE2_NAMES, LATE2_BOONS, LATE2_DEEDS, LATE2_RISE_AT, late2Deed, late2CheckNames, late2Wear, late2Learn, late2Forget, late2VetXP, late2VetNeed, late2Free, late2Spent, late2BoonK, late2K, late2HarmMult, late2RpMult, late2WearMult, late2Named, late2XpBar, late2Band, late2RiseK, late2Risen, late2Rescale, late2RisenName, late2RisenMark, late2Aims, late2NextName, late2ChampThink, late2Wrath, late2Rally, late2OnKill, chronDeeds, updateLate2 }; });
