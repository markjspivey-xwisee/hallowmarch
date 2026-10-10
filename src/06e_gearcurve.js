/* ================================================================== */
/* [balance2] gear that keeps up to level 50                            */
/*   Item levels follow the level to 50: drops at about the foe's level */
/*   (champions, the Hollow King's hoard and Cinderwing's a little      */
/*   above), merchants at yours, fair gear (07c_balance.js) at the      */
/*   level. Past item level 24 an item grows more gently (itemScale in  */
/*   06b_items.js: 0.4 a level to 24, then 0.25), so a level 50 set is  */
/*   about a quarter again of a level 24 one and armour stays under its */
/*   cap for an epic set. Crafting keeps its edge through masterworks   */
/*   and the master's bonus stat (09u_depth.js), not item level.        */
/* The late game stays as hard as it was: a foe past level 24 meets a   */
/*   body in gear (the player, or a bot measuring the callings) with    */
/*   the toughness that the gear of its level brings. gearLateHarm      */
/*   (asked by dealDamage) raises a foe's blows on someone in gear by   */
/*   the effective health such gear adds (health and armour) over gear  */
/*   of item level 24 of the same grade, and lowers blows from someone  */
/*   in gear on a foe by the damage it adds. Bodies without gear (the   */
/*   armies, beasts, the dead) fight each other exactly as before, and  */
/*   a duel between two bodies in gear is untouched.                    */
/* ================================================================== */
const GEAR_OLD_CAP = 24; // the item level drops stopped at before
// the grade a soldier of a level usually wears: fine below 20, rare to 40, epic above (fairGear, 07c_balance.js)
const fairGrade = (L) => (L < 20 ? 2 : L < 40 ? 3 : 4);
// what one piece of a slot, grade and item level gives on average (makeItem in 06b_items.js, in expectation): fair
// gear (07c_balance.js) is made of these, so every calling measured wears the same totals
function gearSlotExpect(slot, ilvl, q) {
  const S = itemScale(ilvl) * QUALITY[q].mult, D = SLOT_DEF[slot], t = {};
  const add = (k, v) => { t[k] = (t[k] || 0) + v; };
  const nsec = [0, 0, 1, 1, 2, 2][q], w2 = q >= 5 ? 0.42 : 0.3;
  if (D.prim) for (const [k, w] of D.prim) add(k, S * w * STAT_SCALE[k]);
  if (D.pick) for (const k of D.pick) add(k, (S * D.primW * STAT_SCALE[k]) / D.pick.length);
  for (const k of D.sec) add(k, (S * w2 * STAT_SCALE[k] * nsec) / D.sec.length);
  for (const k in t) t[k] = Math.round(t[k] * 10) / 10;
  return t;
}
// the stats a whole set of one grade and item level gives, on average
function gearExpect(ilvl, q) {
  const t = { dmg: 0, hp: 0, arm: 0, crit: 0, pow: 0 };
  for (const s of SLOTS) { const st = gearSlotExpect(s, ilvl, q); for (const k in st) t[k] += st[k]; }
  t.arm = Math.min(ARMOUR_CAP, t.arm);
  return t;
}
// per level: d, how much harder a body in gear of that item level strikes than in gear of item level 24 (same grade);
// h, how much longer it lasts (health and armour together)
const GEAR_K = [];
for (let L = 0; L <= LEVEL_CAP + 30; L++) {
  const l = Math.min(L, LEVEL_CAP), q = fairGrade(l);
  const nw = gearExpect(l, q), od = gearExpect(Math.min(l, GEAR_OLD_CAP), q);
  const d = (1 + nw.dmg / 100) / (1 + od.dmg / 100);
  const h = ((1 + nw.hp / 100) / (1 + od.hp / 100)) * ((1 - od.arm / 100) / (1 - nw.arm / 100));
  GEAR_K.push({ d, h });
}
const gearK = (L) => GEAR_K[clamp(Math.round(+L || 1), 0, GEAR_K.length - 1)];
// who wears gear that counts: the player, and the bots that stand in for players (setupStats, 07_entities.js)
const gearedBody = (e) => !!e && (e.role === 'player' || !!e.bot);
// a foe's toughness against a body in gear (dealDamage asks it for every blow); tests turn it off to measure the old curve
const GEAR_LATE = { on: true };
function gearLateHarm(src, dst) {
  if (!GEAR_LATE.on || !src || !dst || src === dst) return 1;
  const gs = gearedBody(src), gd = gearedBody(dst);
  if (gs === gd) return 1;
  // a foe strikes someone in gear: as hard as the gear of its level would make it
  if (gd) return gearK(src.level).h;
  // someone in gear strikes a foe: it stands up to the damage the gear of its level adds
  return 1 / gearK(dst.level).d;
}
// the item level of a piece that falls from a foe of this level: about its level, to 50
const dropIlvl = (lvl) => clamp(Math.round(lvl) + Math.round((Math.random() - 0.5) * 2), 1, LEVEL_CAP);

/* ---- test hooks ---- */
setTimeout(() => {
  if (!window.__hm) return;
  window.__hm.gear = { GEAR_K, GEAR_LATE, GEAR_OLD_CAP, gearK, gearExpect, gearSlotExpect, gearLateHarm, gearedBody, fairGrade, dropIlvl, itemScale, itemScore, itemReq, sanitizeItem, sanitizeJunk, makeItem, rollLoot, openChest, merchantStock, computeDamage, startGame, LOOT, INV, DROP_WEIGHTS, QUALITY };
}, 0);
