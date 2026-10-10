/* ================================================================== */
/* survival: hunger and thirst, food and drink, skills, and the book   */
/* of recipes for the fires, the workbench, the forge, the tanning     */
/* rack, the loom, the bakehouse and the alchemy table                 */
/* ================================================================== */
// The player's needs fall slowly (an hour or two of play from full to empty; faster sprinting, fighting, in the sun or
// by a fire, in the cold for food; slower at rest). Fed and watered, health, power and endurance come back faster;
// hungry or thirsty, slower. Nothing ever kills you: an empty belly only slows you down. needsEat(h) and needsDrink(t)
// add a share of a full need (0..1); the water branch calls needsDrink when the player drinks from a river.
// The world side (plants, fishing, cooking, hunting, the HUD) is 09s_survival.js; stations, mining and the crafting
// screen are 09t_craft.js.
const SURV = {
  hunger: 0.8, thirst: 0.8,                       // 1 full, 0 empty
  skill: { craft: 0, cook: 0, fish: 0, forage: 0 }, // 0..100, grown by use
  ward: { fire: 0, frost: 0, vigour: 0 },          // GAME.t until which a draught works
  state: 'fed', warned: { hunger: 1, thirst: 1 },  // the last level warned about (1 none, 0.25 hungry, 0.06 starving)
  lx: null, lz: null, alive: true,
  job: null,                                       // the player's work: crafting, cooking, mining, picking, drinking
  fish: null,                                      // a line in the water (09s_survival.js)
  built: false,
};
const NEEDS = { hungerSecs: 7200, thirstSecs: 5400, start: 0.8, speed: 1 }; // speed: tests turn it up
const SKILL_NAMES = { craft: 'Crafting', cook: 'Cooking', fish: 'Fishing', forage: 'Foraging' };
const SKILL_RANKS = [[0, 'Novice'], [20, 'Apprentice'], [45, 'Journeyman'], [70, 'Craftsman'], [90, 'Master']];
const skillRank = (v) => SKILL_RANKS.reduce((a, [at, n]) => (v >= at ? n : a), 'Novice');
function skillGain(key, diff = 1) {
  const s = SURV.skill[key] || 0;
  const g = diff * 1.5 * Math.max(0.04, 1 - s / 105);
  const before = skillRank(s);
  SURV.skill[key] = Math.min(100, s + g);
  const after = skillRank(SURV.skill[key]);
  if (after !== before) { uiToast(`${SKILL_NAMES[key]}: you are now ${/^[AEIOU]/.test(after) ? 'an' : 'a'} ${after.toLowerCase()}.`, 'quest'); sfx('levelup'); }
  saveSoon();
  return g;
}

/* ---- needs ---- */
function needsEat(h) { if (!(h > 0)) return 0; const b = SURV.hunger; SURV.hunger = Math.min(1, b + h); needsCheck(); return SURV.hunger - b; }
function needsDrink(t) { if (!(t > 0)) return 0; const b = SURV.thirst; SURV.thirst = Math.min(1, b + t); needsCheck(); return SURV.thirst - b; }
// how the body is doing, and what that does to health, power and endurance coming back
function needsState() {
  const h = SURV.hunger, t = SURV.thirst, m = Math.min(h, t);
  if (h >= 0.5 && t >= 0.5) return { key: 'fed', label: 'Well fed', hp: 1.35, pw: 1.15, en: 1.25 };
  if (m >= 0.25) return { key: 'ok', label: h < t ? 'Peckish' : 'Dry', hp: 1, pw: 1, en: 1 };
  const word = h < 0.25 && t < 0.25 ? 'Hungry and thirsty' : h < 0.25 ? 'Hungry' : 'Thirsty';
  if (m >= 0.06) return { key: 'low', label: word, hp: 0.6, pw: 0.85, en: 0.7 };
  return { key: 'empty', label: h < 0.06 && t < 0.06 ? 'Starving and parched' : h < 0.06 ? 'Starving' : 'Parched', hp: 0.3, pw: 0.7, en: 0.5 };
}
const _needsOne = { hp: 1, pw: 1, en: 1 };
function needsMult() {
  if (!GAME.started || !GAME.player) return _needsOne;
  const S = needsState();
  if (SURV.ward.vigour > GAME.t) return { hp: S.hp, pw: S.pw, en: Math.max(S.en, 1) * 1.6 };
  return S;
}
// gentle warnings when a need crosses a line, once each time
function needsCheck() {
  for (const k of ['hunger', 'thirst']) {
    const v = SURV[k];
    if (v > 0.32) SURV.warned[k] = 1;
    else if (v > 0.1 && SURV.warned[k] < 0.25) SURV.warned[k] = 0.25;
  }
}
function needsWarn() {
  for (const k of ['hunger', 'thirst']) {
    const v = SURV[k], w = SURV.warned[k];
    const quick = IS_TOUCH ? 'tap the food and water bars' : 'press V';
    if (v < 0.06 && w > 0.06) {
      SURV.warned[k] = 0.06;
      uiToast(k === 'hunger' ? `You are starving. You heal and tire badly until you eat (${quick}).` : `You are parched. Drink at a well, a trough or a lake, or from a waterskin (${quick}).`, 'hint');
      uiLog(k === 'hunger' ? 'You are starving: health and endurance come back slowly.' : 'You are parched: health and endurance come back slowly.', 'warn');
    } else if (v < 0.25 && w > 0.25) {
      SURV.warned[k] = 0.25;
      uiToast(k === 'hunger' ? `You are getting hungry. Eat something from your packs (${quick}).` : `You are getting thirsty. Drink something (${quick}), or at a well or a lake.`, 'hint');
      uiLog(k === 'hunger' ? 'You are getting hungry.' : 'You are getting thirsty.', 'warn');
    }
  }
}
// the clocks: called every step from updateSurvival (09s_survival.js)
function updateNeeds(dt) {
  const P = GAME.player;
  if (!P || !GAME.started) return;
  if (!P.alive) { SURV.alive = false; return; }
  if (!SURV.alive) {
    // risen again: the healers saw you fed
    SURV.alive = true;
    SURV.hunger = Math.max(SURV.hunger, 0.4); SURV.thirst = Math.max(SURV.thirst, 0.4);
    needsCheck();
  }
  const sp = SURV.lx === null ? 0 : Math.hypot(P.x - SURV.lx, P.z - SURV.lz) / Math.max(dt, 1e-3);
  SURV.lx = P.x; SURV.lz = P.z;
  const fighting = GAME.t < (P.combatUntil || 0);
  let act = 1;
  if (sp > 30) act = 1; // a teleport, not a run
  else if (sp > PLAYER_SPEED * 1.18 && !P.mount) act = 2.2;
  else if (fighting) act = 1.6;
  else if (sp < 0.3) act = 0.55;
  if (P.mount) act *= 0.8;
  const heat = P._heat || 0, sun = typeof sunStrength === 'function' ? sunStrength() : 0;
  const cold = clamp((WEATHER.snowing || 0) + 0.5 * (U.uSnowCover.value || 0) + (P.snow || 0) * 0.5, 0, 1);
  const hr = act * (1 + 0.3 * cold + 0.12 * (P.wet || 0)) / NEEDS.hungerSecs;
  const tr = act * (1 + 0.5 * sun * (inDungeon(P) || INDOOR.on ? 0 : 1) + 0.9 * heat) / NEEDS.thirstSecs;
  SURV.hunger = Math.max(0, SURV.hunger - dt * hr * NEEDS.speed);
  SURV.thirst = Math.max(0, SURV.thirst - dt * tr * NEEDS.speed);
  needsWarn();
}
// ward draughts take the sting out of fire and frost (dealDamage asks)
function survivalHarmMult(dst, opts) {
  if (!dst || dst !== GAME.player || !opts) return 1;
  if ((opts.kind === 'fire') && SURV.ward.fire > GAME.t) return 0.5;
  if ((opts.kind === 'frost' || opts.kind === 'ice') && SURV.ward.frost > GAME.t) return 0.5;
  return 1;
}

/* ---- the goods this system brings (the shared catalogue has the rest) ---- */
Object.assign(ICONS, {
  loaf: '<path d="M4 15c0-5 3.6-8 8-8s8 3 8 8v2.5H4z"/><path d="M8.5 9.5l-1 3M12 8.6v3.6M15.5 9.5l1 3"/>',
  flask: '<path d="M9.5 3h5M10.2 3v5.5L5.5 17a2.8 2.8 0 0 0 2.5 4h8a2.8 2.8 0 0 0 2.5-4l-4.7-8.5V3"/><path d="M7.6 14.5h8.8"/>',
  pot: '<path d="M4 9h16l-1.5 9a3 3 0 0 1-3 2.5h-7a3 3 0 0 1-3-2.5z"/><path d="M3 9h18M8 9V6.5M16 9V6.5"/>',
  anvil: '<path d="M3 8h13c0 2.5 2 4 5 4v1c-4 0-6 1-7 3H9c-1-2-3-3-6-3z"/><path d="M8 16l-1.5 4h11L16 16"/>',
  fish: '<path d="M3 12c3-4.5 9-6 14-2l4-3v10l-4-3c-5 4-11 2.5-14-2z"/><circle cx="8" cy="11" r="0.8"/>',
  pick: '<path d="M4 8c4-4 12-4 16 0"/><path d="M12 5.4V21"/>',
  arrows: '<path d="M5 19L17 7M8 21L20 9M17 7h-3.5M17 7v3.5M20 9h-3.5M20 9v3.5"/>',
});
for (const [id, name, kind, icon, value, desc, extra] of [
  ['mush_roast', 'Roast mushrooms', 'food', 'herb', 4, 'Mushrooms browned on a stick over the fire.', { plural: 'Roast mushrooms', food: { hunger: 0.16 } }],
  ['pasty', 'Apple pasty', 'food', 'loaf', 7, 'Apples and berries baked in a crust.', { plural: 'Apple pasties', food: { hunger: 0.42, thirst: 0.05 } }],
  ['tool_pot', 'Cooking pot', 'tool', 'pot', 14, 'An iron pot: cook stews over any fire, not only a hearth.'],
  ['potion_mana', 'Starflower tonic', 'drink', 'flask', 12, 'Restores half your power at once.', { useLabel: 'Drink' }],
  ['potion_fireward', 'Fireward draught', 'drink', 'flask', 14, 'For five minutes fire hurts you half as much.', { useLabel: 'Drink' }],
  ['potion_frostward', 'Frostward draught', 'drink', 'flask', 14, 'For five minutes frost hurts you half as much.', { useLabel: 'Drink' }],
  ['potion_vigour', 'Draught of vigour', 'drink', 'flask', 10, 'Fills your endurance; for three minutes it comes back much faster.', { plural: 'Draughts of vigour', useLabel: 'Drink' }],
]) registerGood(id, { name, kind, icon, value, desc, ...(extra || {}) });
// the four arrows the classes branch shoots: registered here too if it has not (same ids)
for (const [id, name, desc] of [
  ['arrows_broadhead', 'Broadhead arrows', 'Wide flint heads that cut deep: more damage against the unarmoured.'],
  ['arrows_bodkin', 'Bodkin arrows', 'Narrow iron points that punch through mail and plate.'],
  ['arrows_fire', 'Fire arrows', 'Pitch-soaked heads that set what they strike alight.'],
  ['arrows_blunt', 'Blunt arrows', 'Heavy heads that knock the wind out of a foe.'],
]) if (!GOODS[id]) registerGood(id, { name, plural: name, kind: 'misc', icon: 'arrows', value: 1, desc });
// potions: what drinking each one does
GOODS.potion_mana.use = (P, id) => { if (!goodsTake(id, 1)) return; P.power = Math.min(P.maxPower, P.power + P.maxPower * 0.5); FX.burst(P.x, P.y + 1.2, P.z, 14, [0.5, 0.9, 2.2], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('The tonic clears your mind.', 'heal'); };
GOODS.potion_fireward.use = (P, id) => { if (!goodsTake(id, 1)) return; SURV.ward.fire = GAME.t + 300; FX.burst(P.x, P.y + 1.2, P.z, 14, [2.2, 0.9, 0.3], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('A cool calm settles on your skin: fire will hurt you half as much for five minutes.', 'heal'); };
GOODS.potion_frostward.use = (P, id) => { if (!goodsTake(id, 1)) return; SURV.ward.frost = GAME.t + 300; FX.burst(P.x, P.y + 1.2, P.z, 14, [0.5, 1.3, 2.2], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('A glow spreads through you: frost will hurt you half as much for five minutes.', 'heal'); };
GOODS.potion_vigour.use = (P, id) => { if (!goodsTake(id, 1)) return; P.endurance = 100; SURV.ward.vigour = GAME.t + 180; FX.burst(P.x, P.y + 1.2, P.z, 14, [2.0, 1.8, 0.6], 1.2, 0.5, 0.1, -0.6); sfx('potion'); uiLog('You feel you could run all day.', 'heal'); };

/* ------------------------------------------------------------------ */
/* the stations and the book of recipes                                */
/* ------------------------------------------------------------------ */
// st: where it is made. hand (anywhere), fire (any fire: campfires, hearths, braziers, the forge), or a station placed in
// the towns and keeps (09t_craft.js). make: [good, n]; gear: a piece of kit for the player's calling, graded by skill;
// act: something done in the world. need: what it uses up. cls: only for those callings. min: crafting skill needed.
// waste: the material a skilled hand sometimes saves. pot: needs a cooking pot (yours, or a hearth's).
const STATIONS = {
  hand: { name: 'By hand', short: 'By hand', icon: 'leaf', blurb: 'Things you can make anywhere, with what you carry.' },
  fire: { name: 'At the fire', short: 'Fire', icon: 'flame', blurb: 'Cook over any fire: a campfire, a hearth, a brazier or the forge. Stews need a pot: a hearth has one, or carry your own.' },
  workbench: { name: 'Workbench', short: 'Workbench', icon: 'hammer', blurb: 'Saw logs into planks, whittle sticks, make rods, bows, staves and arrows.' },
  forge: { name: 'Forge and anvil', short: 'Forge', icon: 'anvil', blurb: 'Smelt ore into iron, then hammer out tools, blades and armour, and mend worn gear.' },
  tanning: { name: 'Tanning rack', short: 'Tanning', icon: 'hide', blurb: 'Cure hides into leather and cut leather armour.' },
  loom: { name: 'Loom', short: 'Loom', icon: 'fibre', blurb: 'Weave fibre, flax and wool into cloth, and cloth into cloaks, robes and hoods.' },
  oven: { name: 'Bakehouse', short: 'Bakehouse', icon: 'loaf', blurb: 'Grind grain at the quern, bake bread and pasties in the oven, brew ale in the tub.' },
  alchemy: { name: 'Alchemy table', short: 'Alchemy', icon: 'flask', blurb: 'Steep herbs into draughts: healing, the starflower tonic, wards against fire and frost, vigour.' },
};
const RECIPES = [
  // by hand
  { id: 'campfire', st: 'hand', name: 'Lay a campfire', act: 'campfire', need: [['firewood', 2]], time: 2, diff: 0.4, icon: 'flame', desc: 'Stack firewood at your feet. Light it with E, then cook on it.' },
  { id: 'sticks_wood', st: 'hand', name: 'Sticks from firewood', make: ['stick', 3], need: [['firewood', 1]], time: 1.5, diff: 0.3, desc: 'Split a bundle of firewood into straight sticks.' },
  { id: 'knife_flint', st: 'hand', name: 'Flint knife', make: ['tool_knife', 1], need: [['flint', 1], ['stick', 1], ['fibre', 1]], time: 3, diff: 1, desc: 'Knap a blade and bind it to a haft. Skins game and cuts herbs: more from every hunt and every plant.' },
  // at a fire
  { id: 'roast_meat', st: 'fire', name: 'Roast meat', make: ['meat_cooked', 1], need: [['meat_raw', 1]], time: 2.6, diff: 0.5, skill: 'cook', desc: 'On a spit over the flames. Four times as filling as raw.' },
  { id: 'grill_fish', st: 'fire', name: 'Grill fish', make: ['fish_cooked', 1], need: [['fish_raw', 1]], time: 2.2, diff: 0.5, skill: 'cook', desc: 'Flaky and good.' },
  { id: 'roast_mush', st: 'fire', name: 'Roast mushrooms', make: ['mush_roast', 1], need: [['mushrooms', 2], ['stick', 1]], time: 2, diff: 0.5, skill: 'cook', desc: 'Browned on a stick.' },
  { id: 'stew_hunter', st: 'fire', pot: true, name: "Hunter's stew", make: ['stew', 2], need: [['meat_raw', 1], ['mushrooms', 2], ['water', 1]], time: 5, diff: 1.4, skill: 'cook', desc: 'Meat and mushrooms simmered in a pot. The best of meals.' },
  { id: 'stew_fish', st: 'fire', pot: true, name: 'Fish stew', make: ['stew', 2], need: [['fish_raw', 2], ['water', 1]], time: 5, diff: 1.4, skill: 'cook', desc: 'Fish and water and whatever herbs are about.' },
  { id: 'stew_garden', st: 'fire', pot: true, name: 'Garden stew', make: ['stew', 2], need: [['cabbage', 1], ['turnip', 1], ['water', 1]], time: 5, diff: 1.2, skill: 'cook', desc: 'Roots and greens from the garden.' },
  // the bakehouse: quern, oven and brewing tub
  { id: 'flour', st: 'oven', name: 'Grind flour', make: ['flour', 1], need: [['grain', 2]], time: 3, diff: 0.6, skill: 'cook', waste: 'grain', desc: 'Turn the quern stone until the grain is fine.' },
  { id: 'bread', st: 'oven', name: 'Bake bread', make: ['bread', 2], need: [['flour', 1], ['water', 1]], time: 4, diff: 1, skill: 'cook', desc: 'Two loaves from the oven.' },
  { id: 'pasty', st: 'oven', name: 'Apple pasties', make: ['pasty', 2], need: [['flour', 1], ['apple', 2], ['berries', 1]], time: 4.5, diff: 1.5, skill: 'cook', desc: 'Apples and berries in a crust.' },
  { id: 'ale', st: 'oven', name: 'Brew ale', make: ['ale', 3], need: [['grain', 2], ['water', 2]], time: 4.5, diff: 1.2, skill: 'cook', desc: 'Malt and water in the tub. Three mugs.' },
  // the workbench
  { id: 'planks', st: 'workbench', name: 'Saw planks', make: ['plank', 3], need: [['log', 1]], time: 3, diff: 0.6, waste: 'log', desc: 'Saw a log into three planks.' },
  { id: 'sticks', st: 'workbench', name: 'Whittle sticks', make: ['stick', 4], need: [['plank', 1]], time: 1.6, diff: 0.3, desc: 'Four straight sticks from a plank.' },
  { id: 'rod', st: 'workbench', name: 'Fishing rod', make: ['tool_rod', 1], need: [['stick', 2], ['fibre', 3], ['bone', 1]], time: 4, diff: 1.4, desc: 'A springy rod, a fibre line and a bone hook. Fish at any lake or river.' },
  { id: 'arrows_blunt', st: 'workbench', name: 'Blunt arrows', make: ['arrows_blunt', 10], need: [['stick', 2], ['feather', 2]], time: 3, diff: 0.8, cls: ['archer'], desc: 'Ten arrows with heavy wooden heads.' },
  { id: 'arrows_broadhead', st: 'workbench', name: 'Broadhead arrows', make: ['arrows_broadhead', 10], need: [['stick', 2], ['feather', 2], ['flint', 1]], time: 3, diff: 1, cls: ['archer'], desc: 'Ten arrows with wide flint heads.' },
  { id: 'arrows_bodkin', st: 'workbench', name: 'Bodkin arrows', make: ['arrows_bodkin', 10], need: [['stick', 2], ['feather', 2], ['iron', 1]], time: 3.5, diff: 1.3, cls: ['archer'], min: 15, desc: 'Ten arrows with narrow iron points that punch through armour.' },
  { id: 'arrows_fire', st: 'workbench', name: 'Fire arrows', make: ['arrows_fire', 10], need: [['stick', 2], ['feather', 2], ['fibre', 1], ['herb_fire', 1]], time: 3.5, diff: 1.5, cls: ['archer'], min: 25, desc: 'Ten arrows wrapped in fibre soaked with embercap.' },
  { id: 'bow', st: 'workbench', name: 'Yew bow', gear: { slot: 'weapon', base: 'Yew Bow', vis: 'bow' }, need: [['plank', 2], ['fibre', 4], ['leather', 1]], time: 6, diff: 3, cls: ['archer'], min: 10, desc: 'A bow for your calling, as good as your hands can make it.' },
  { id: 'staff', st: 'workbench', name: 'Carved staff', gear: { slot: 'weapon', base: { mage: 'Rowan Staff', priest: 'Hawthorn Staff' }, vis: 'staff' }, need: [['log', 1], ['leather', 1], ['herb_mana', 2]], time: 6, diff: 3, cls: ['mage', 'priest'], min: 10, desc: 'A staff carved with runes and bound with leather.' },
  // the forge and anvil
  { id: 'smelt', st: 'forge', name: 'Smelt iron', make: ['iron', 1], need: [['iron_ore', 2], ['firewood', 1]], time: 4, diff: 1, waste: 'iron_ore', desc: 'Two lumps of ore in the fire make one bar of iron.' },
  { id: 'tool_axe', st: 'forge', name: "Woodsman's axe", make: ['tool_axe', 1], need: [['iron', 1], ['stick', 1]], time: 4, diff: 1.2, desc: 'Fells trees and splits logs in fewer blows.' },
  { id: 'tool_pick', st: 'forge', name: 'Pick', make: ['tool_pick', 1], need: [['iron', 2], ['stick', 1]], time: 4.5, diff: 1.4, desc: 'Breaks flint and iron ore out of rock, and more stone.' },
  { id: 'tool_knife', st: 'forge', name: 'Iron knife', make: ['tool_knife', 1], need: [['iron', 1], ['bone', 1]], time: 3.5, diff: 1, desc: 'Skins game and cuts herbs.' },
  { id: 'tool_hammer', st: 'forge', name: 'Hammer', make: ['tool_hammer', 1], need: [['iron', 1], ['stick', 1]], time: 3.5, diff: 1, desc: 'With your own hammer, mending at the anvil restores everything.' },
  { id: 'tool_hoe', st: 'forge', name: 'Hoe', make: ['tool_hoe', 1], need: [['iron', 1], ['stick', 2]], time: 3.5, diff: 1, desc: 'Tills ground for planting.' },
  { id: 'tool_shears', st: 'forge', name: 'Shears', make: ['tool_shears', 1], need: [['iron', 1]], time: 3, diff: 1, desc: 'Shears sheep.' },
  { id: 'tool_pot', st: 'forge', name: 'Cooking pot', make: ['tool_pot', 1], need: [['iron', 2]], time: 4, diff: 1.2, desc: 'Carry it and cook stews over any fire.' },
  { id: 'mend', st: 'forge', name: 'Mend your gear', act: 'mend', need: [['iron', 1], ['leather', 1]], time: 4, diff: 1, desc: 'Beat out the dents and restitch the straps of everything you wear and carry: half its wear, or all of it with your own hammer.' },
  { id: 'blade', st: 'forge', name: 'Forge a blade', gear: { slot: 'weapon', base: { warrior: 'Arming Sword' }, vis: 'sword' }, need: [['iron', 3], ['plank', 1], ['leather', 1]], time: 6, diff: 3, cls: ['warrior'], min: 10, desc: 'A sword for your hand, as good as your skill.' },
  { id: 'axe_war', st: 'forge', name: 'Forge a war axe', gear: { slot: 'weapon', base: { warrior: 'War Axe' }, vis: 'axe' }, need: [['iron', 2], ['plank', 2], ['leather', 1]], time: 6, diff: 3, cls: ['warrior'], min: 10, desc: 'A long-hafted axe.' },
  { id: 'mace', st: 'forge', name: 'Forge a mace', gear: { slot: 'weapon', base: { priest: 'Flanged Mace', warrior: 'Flanged Mace' }, vis: 'mace' }, need: [['iron', 3], ['plank', 1]], time: 6, diff: 3, cls: ['priest', 'warrior'], min: 10, desc: 'A flanged iron head on an oak haft.' },
  { id: 'helm', st: 'forge', name: 'Forge a helm', gear: { slot: 'head', base: { warrior: 'Nasal Helm' }, vis: 'helmet' }, need: [['iron', 2], ['leather', 1]], time: 5, diff: 2.5, cls: ['warrior'], min: 5, desc: 'A helm with a nasal guard.' },
  { id: 'hauberk', st: 'forge', name: 'Forge a hauberk', gear: { slot: 'chest', base: { warrior: 'Hauberk' } }, need: [['iron', 5], ['leather', 2]], time: 8, diff: 4, cls: ['warrior'], min: 20, desc: 'A long coat of riveted mail.' },
  { id: 'gauntlets', st: 'forge', name: 'Forge gauntlets', gear: { slot: 'hands', base: { warrior: 'Gauntlets' } }, need: [['iron', 2], ['leather', 1]], time: 5, diff: 2.5, cls: ['warrior'], min: 5, desc: 'Plated gloves.' },
  { id: 'greaves', st: 'forge', name: 'Forge greaves', gear: { slot: 'legs', base: { warrior: 'Greaves' } }, need: [['iron', 3], ['leather', 1]], time: 6, diff: 3, cls: ['warrior'], min: 10, desc: 'Plates for the shins.' },
  // the tanning rack
  { id: 'leather', st: 'tanning', name: 'Tan a hide', make: ['leather', 1], need: [['hide', 1]], time: 4, diff: 0.8, desc: 'Scrape, soak and stretch a hide into leather.' },
  { id: 'coat', st: 'tanning', name: 'Leather coat', gear: { slot: 'chest', base: { archer: 'Leather Coat' } }, need: [['leather', 4], ['fibre', 2]], time: 7, diff: 3, cls: ['archer'], min: 10, desc: 'A hunter\'s coat of thick leather.' },
  { id: 'leggings', st: 'tanning', name: 'Leather leggings', gear: { slot: 'legs', base: { archer: 'Leggings' } }, need: [['leather', 3]], time: 5, diff: 2.5, cls: ['archer'], min: 5, desc: 'Soft leather leggings.' },
  { id: 'bracers', st: 'tanning', name: 'Bracers', gear: { slot: 'hands', base: { archer: 'Bracers' } }, need: [['leather', 2]], time: 4, diff: 2, cls: ['archer'], desc: 'Guards for the bow arm.' },
  { id: 'hood', st: 'tanning', name: 'Ranger hood', gear: { slot: 'head', base: { archer: 'Ranger Hood' }, vis: 'hood' }, need: [['leather', 1], ['linen', 1]], time: 4, diff: 2, cls: ['archer'], desc: 'A deep hood that keeps the rain off.' },
  // the loom
  { id: 'linen', st: 'loom', name: 'Weave linen', make: ['linen', 1], need: [['flax', 2]], time: 4, diff: 0.8, desc: 'Flax stems beaten, spun and woven.' },
  { id: 'nettle_cloth', st: 'loom', name: 'Weave nettle cloth', make: ['linen', 1], need: [['fibre', 4]], time: 4, diff: 0.8, waste: 'fibre', desc: 'Coarse cloth from nettle fibre. As good as linen for most things.' },
  { id: 'woollen', st: 'loom', name: 'Weave woollen cloth', make: ['woollen', 1], need: [['wool', 2]], time: 4, diff: 0.8, desc: 'Thick, warm cloth.' },
  { id: 'cloak', st: 'loom', name: 'Weave a cloak', gear: { slot: 'cloak', base: 'Travelling Cloak', vis: 'cape' }, need: [['woollen', 2], ['leather', 1]], time: 6, diff: 2.5, desc: 'A cloak for any calling.' },
  { id: 'cloak_linen', st: 'loom', name: 'Weave a light cloak', gear: { slot: 'cloak', base: 'Mantle', vis: 'cape' }, need: [['linen', 3]], time: 5, diff: 2, desc: 'A light mantle of linen.' },
  { id: 'robe', st: 'loom', name: 'Weave a robe', gear: { slot: 'chest', base: { mage: 'Long Robe', priest: 'Vestments' } }, need: [['linen', 4], ['woollen', 1]], time: 7, diff: 3, cls: ['mage', 'priest'], min: 10, desc: 'Robes for your calling.' },
  { id: 'cowl', st: 'loom', name: 'Weave a hood', gear: { slot: 'head', base: { mage: 'Deep Hood', priest: 'Hood' }, vis: 'hood' }, need: [['linen', 2]], time: 4, diff: 2, cls: ['mage', 'priest'], desc: 'A deep hood.' },
  { id: 'wraps', st: 'loom', name: 'Weave hand wraps', gear: { slot: 'hands', base: { mage: 'Wraps', priest: 'Wraps' } }, need: [['linen', 1], ['leather', 1]], time: 4, diff: 2, cls: ['mage', 'priest'], desc: 'Linen wraps with leather palms.' },
  { id: 'hose', st: 'loom', name: 'Weave hose', gear: { slot: 'legs', base: { mage: 'Hose', priest: 'Hose' } }, need: [['linen', 2], ['woollen', 1]], time: 5, diff: 2.5, cls: ['mage', 'priest'], min: 5, desc: 'Warm hose.' },
  // the alchemy table
  { id: 'draught', st: 'alchemy', name: 'Healing draught', act: 'draught', need: [['herb_heal', 2], ['water', 1]], time: 4, diff: 1.2, desc: 'Woundwort steeped and strained. Restores 40% of your health (Q).' },
  { id: 'tonic', st: 'alchemy', name: 'Starflower tonic', make: ['potion_mana', 1], need: [['herb_mana', 2], ['water', 1]], time: 4, diff: 1.2, desc: 'Restores half your power.' },
  { id: 'fireward', st: 'alchemy', name: 'Fireward draught', make: ['potion_fireward', 1], need: [['herb_frost', 2], ['water', 1]], time: 4.5, diff: 1.5, min: 10, desc: 'Rimeleaf cools the blood: fire hurts you half as much for five minutes.' },
  { id: 'frostward', st: 'alchemy', name: 'Frostward draught', make: ['potion_frostward', 1], need: [['herb_fire', 2], ['water', 1]], time: 4.5, diff: 1.5, min: 10, desc: 'Embercap warms the blood: frost hurts you half as much for five minutes.' },
  { id: 'vigour', st: 'alchemy', name: 'Draught of vigour', make: ['potion_vigour', 1], need: [['herb_storm', 1], ['berries', 2], ['water', 1]], time: 4, diff: 1.3, min: 5, desc: 'Thunder thistle and berries: full endurance, and it comes back much faster for three minutes.' },
];
const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
const recipeFor = (r, P) => !r.cls || (P && r.cls.includes(P.cls));
const recipeSkill = (r) => r.skill || 'craft';
const recipeHas = (r, k = 1) => r.need.every(([id, n]) => goodsHave(id, n * k));
function recipeCanMake(r, k = 1) { return Math.max(0, Math.min(...r.need.map(([id, n]) => Math.floor(goodsCount(id) / n)))) >= k; }
// how good a crafted piece of kit turns out: the odds of each grade at this skill (worn ... legendary)
function craftOdds(skill) {
  const s = clamp(skill / 100, 0, 1);
  return [lerp(12, 0, s), lerp(60, 4, s), lerp(25, 42, s), lerp(3, 40, s), lerp(0, 14, s), 0];
}

/* ---- the save: needs and skills with the character ---- */
registerSavePart('char', 'surv', {
  save() {
    const r2 = (v) => Math.round(v * 1000) / 1000;
    const left = (t) => Math.max(0, Math.round(t - GAME.t));
    const w = { fire: left(SURV.ward.fire), frost: left(SURV.ward.frost), vigour: left(SURV.ward.vigour) };
    return { h: r2(SURV.hunger), t: r2(SURV.thirst), sk: Object.fromEntries(Object.keys(SKILL_NAMES).map((k) => [k, Math.round((SURV.skill[k] || 0) * 10) / 10])), w };
  },
  load(d) {
    const num = (v, a, b, def) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, a, b) : def);
    const o = d && typeof d === 'object' ? d : {};
    SURV.hunger = num(o.h, 0, 1, NEEDS.start);
    SURV.thirst = num(o.t, 0, 1, NEEDS.start);
    const sk = o.sk && typeof o.sk === 'object' ? o.sk : {};
    for (const k of Object.keys(SKILL_NAMES)) SURV.skill[k] = num(sk[k], 0, 100, 0);
    const w = o.w && typeof o.w === 'object' ? o.w : {};
    for (const k of ['fire', 'frost', 'vigour']) SURV.ward[k] = GAME.t + num(w[k], 0, 600, 0);
    SURV.warned = { hunger: 1, thirst: 1 }; needsCheck();
    SURV.job = null; SURV.fish = null; SURV.lx = null; SURV.alive = true;
  },
  // what counts as a change worth writing: needs in tenths, skills in whole points
  key: (d) => (d ? [Math.round((d.h || 0) * 10), Math.round((d.t || 0) * 10), Object.values(d.sk || {}).map((v) => Math.floor(v))] : null),
});
