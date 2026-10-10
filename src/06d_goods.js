/* ================================================================== */
/* goods: everything you carry that is not gear                        */
/* ================================================================== */
// Materials (wood, stone, hide, fibre, ore), food and drink, seeds, herbs, tools and building parts are goods: kept by
// count in INV.goods, shown in the Goods list of the bags, saved with the character, dropped and picked up in the
// world like loot. Each system registers the goods it brings and moves them with goodsAdd / goodsTake / goodsHave.
//   registerGood('oak_log', { name: 'Oak log', kind: 'material', icon: 'log', value: 2, desc: '...' })
//   kinds: material, food, drink, seed, herb, tool, part, misc. A good may carry its own data for the systems that use
//   it (food: { hunger, thirst }, seed: { crop }, tool: { tier }) and a use(P) action shown as a button in the bags.
const GOODS = {};
Object.assign(ICONS, {
  log: '<path d="M4 15.5l12.5-8.2a2.6 2.6 0 0 1 2.9 4.4L7 19.9a2.6 2.6 0 0 1-3-4.4z"/><circle cx="18" cy="9.5" r="1.1"/>',
  stone: '<path d="M4.5 16.5L7 9l5-3.5 5.5 2.2L20 14l-3 5H7.5z"/><path d="M7 9l4 3 6.5-4.3M11 12l-1 7"/>',
  grain: '<path d="M12 21V8"/><path d="M12 8c-2.4-1-3-3.4-1.6-5 2 .9 2.4 3.2 1.6 5zM12 12c-2.6-.8-3.6-3-2.4-4.8 2.2.7 3 2.9 2.4 4.8zM12 12c2.6-.8 3.6-3 2.4-4.8-2.2.7-3 2.9-2.4 4.8zM12 16c-2.6-.8-3.6-3-2.4-4.8 2.2.7 3 2.9 2.4 4.8zM12 16c2.6-.8 3.6-3 2.4-4.8-2.2.7-3 2.9-2.4 4.8z"/>',
  meat: '<path d="M14.5 4.5c3.4 0 6 2.6 5 6.2-.9 3.4-4.6 6.8-8.6 7.2-1.6.2-2.8 1.3-3.6 2.6L5 18.2l1.7-2.2C7.8 14.6 8.5 13 8.5 11.2c0-3.8 2.6-6.7 6-6.7z"/><circle cx="15" cy="9.5" r="1.3"/>',
  drop: '<path d="M12 3.5c3 4 6 7.2 6 10.6a6 6 0 0 1-12 0c0-3.4 3-6.6 6-10.6z"/>',
  seed: '<path d="M12 20c-4-2-5.5-6-3.8-9.6C9.8 7 12 5.5 12 3.5c0 2 2.2 3.5 3.8 6.9C17.5 14 16 18 12 20z"/><path d="M12 9v8"/>',
  herb: '<path d="M12 21v-9M12 12c-4 0-6.5-2.6-6.5-6.5 4 0 6.5 2.6 6.5 6.5zM12 15c3.4 0 5.6-2.2 5.6-5.6-3.4 0-5.6 2.2-5.6 5.6z"/>',
  hammer: '<path d="M13 10.5l-8 8.5 1.6 1.6 8.5-8"/><path d="M11 6.5l4-3 6 6-3 4z"/>',
  hide: '<path d="M6 5.5c3.2 1.3 8.8 1.3 12 0l-1.2 5.3L19 17c-4.2 2.2-9.8 2.2-14 0l2.2-6.2z"/>',
  fibre: '<path d="M6 20c2-6 2-11 0-16M12 20c1.5-6 1.5-11 0-16M18 20c-2-6-2-11 0-16"/>',
});
const GOOD_KINDS = { material: 'Material', food: 'Food', drink: 'Drink', seed: 'Seed', herb: 'Herb', tool: 'Tool', part: 'Building part', misc: 'Goods' };
function registerGood(id, def) {
  GOODS[id] = { id, name: def.name || id, plural: def.plural || null, kind: def.kind || 'material', icon: def.icon || 'bag', stack: def.stack || 999, value: def.value || 1, desc: def.desc || '', ...def };
  return GOODS[id];
}
const goodName = (id, n = 1) => { const G = GOODS[id]; if (!G) return id; return n === 1 ? G.name : G.plural || G.name + (/s$/.test(G.name) ? '' : 's'); };
function goodsCount(id) { return (INV.goods && INV.goods[id]) || 0; }
function goodsHave(id, n = 1) { return goodsCount(id) >= n; }
// add goods to the player's packs; returns how many were taken (packs hold up to a stack of each)
function goodsAdd(id, n = 1, quiet = false) {
  const G = GOODS[id];
  if (!G || !(n > 0)) return 0;
  if (!INV.goods) INV.goods = {};
  const have = INV.goods[id] || 0, take = Math.min(n, G.stack - have);
  if (take <= 0) { if (!quiet) uiError(`You cannot carry more ${goodName(id, 2).toLowerCase()}`); return 0; }
  INV.goods[id] = have + take;
  if (!quiet) { uiLog(`+${take} ${goodName(id, take)}`, 'loot'); sfx('loot'); }
  GOODS_UI.dirty = true;
  saveSoon();
  return take;
}
function goodsTake(id, n = 1) {
  if (!goodsHave(id, n)) return false;
  INV.goods[id] -= n;
  if (INV.goods[id] <= 0) delete INV.goods[id];
  GOODS_UI.dirty = true;
  saveSoon();
  return true;
}
// take a whole list at once, or nothing: [[id, n], ...]
function goodsTakeAll(list) {
  if (!list.every(([id, n]) => goodsHave(id, n))) return false;
  for (const [id, n] of list) goodsTake(id, n);
  return true;
}
// goods lying in the world: picked up by walking over them, like loot (09c_loot.js routes them here)
function dropGood(id, n, x, z, y) {
  const G = GOODS[id];
  if (!G || !(n > 0)) return null;
  return dropItem({ goods: id, n, name: goodName(id, n), q: 0, slot: 'junk', base: G.name, lvl: 1, st: {}, id: 'g' + Math.random().toString(36).slice(2, 9) }, x, z, y);
}
// the goods part of the bags screen (10b_kit.js), grouped by kind, with each good's own action
const GOODS_UI = { dirty: true };
function goodsHTML() {
  const ids = Object.keys(INV.goods || {}).filter((id) => GOODS[id] && INV.goods[id] > 0);
  if (!ids.length) return '<h3>Goods</h3><p class="fineprint">Wood, stone, food, seeds and the like are kept here.</p>';
  const by = {};
  for (const id of ids) (by[GOODS[id].kind] = by[GOODS[id].kind] || []).push(id);
  let html = '<h3>Goods</h3><div class="goodslist">';
  for (const k of Object.keys(GOOD_KINDS)) {
    if (!by[k]) continue;
    html += `<div class="goodsgrp"><h4>${GOOD_KINDS[k]}</h4>`;
    for (const id of by[k].sort((a, b) => GOODS[a].name.localeCompare(GOODS[b].name))) {
      const G = GOODS[id], n = INV.goods[id];
      const act = G.use ? `<button class="btn" type="button" data-gooduse="${id}">${esc(G.useLabel || 'Use')}</button>` : '';
      html += `<div class="goodrow" title="${esc(G.desc)}"><span class="ic">${iconSvg(G.icon, 18)}</span><span class="nm">${esc(goodName(id, n))}<small>${esc(G.desc)}</small></span><span class="ct">${n}</span>${act}</div>`;
    }
    html += '</div>';
  }
  return html + '</div>';
}
function goodsUse(id) {
  const G = GOODS[id], P = GAME.player;
  if (!G || !G.use || !P || !P.alive || !goodsHave(id)) return;
  G.use(P, id);
  GOODS_UI.dirty = true;
}
// saved with the character: only goods this build knows, as whole counts
function goodsSaveData() {
  const o = {};
  for (const id in INV.goods || {}) if (GOODS[id] && INV.goods[id] > 0) o[id] = Math.min(GOODS[id].stack, Math.round(INV.goods[id]));
  return Object.keys(o).length ? o : null;
}
function goodsApplySave(o) {
  INV.goods = {};
  if (!o || typeof o !== 'object') return;
  for (const id in o) { const n = Math.round(+o[id]); if (GOODS[id] && n > 0) INV.goods[id] = Math.min(GOODS[id].stack, n); }
}

/* ------------------------------------------------------------------ */
/* save parts: other systems keep their own records in the save        */
/* ------------------------------------------------------------------ */
// registerSavePart('char' or 'world', key, { save() -> data or null, load(data or undefined), key(data) -> what counts
// as a change worth writing (defaults to the data) }). Char parts are saved with the character (s.char.x[key]) and
// loaded when it enters the world; world parts with the world (s.world.x[key]) and loaded after the war is restored.
// A part must cope with its data missing (an older save) or malformed (sanitise everything it reads).
const SAVE_PARTS = { char: {}, world: {} };
function registerSavePart(where, key, part) { SAVE_PARTS[where][key] = part; }
function savePartsData(where) {
  const o = {};
  for (const k in SAVE_PARTS[where]) { try { const d = SAVE_PARTS[where][k].save(); if (d != null) o[k] = d; } catch (e) { reportError(e); } }
  return Object.keys(o).length ? o : null;
}
function savePartsLoad(where, x) {
  for (const k in SAVE_PARTS[where]) { try { SAVE_PARTS[where][k].load(x && typeof x === 'object' ? x[k] : undefined); } catch (e) { reportError(e); } }
}
function savePartsKey(x, where) {
  if (!x) return null;
  const o = {};
  for (const k in x) { const P = SAVE_PARTS[where][k]; o[k] = P && P.key ? P.key(x[k]) : x[k]; }
  return o;
}
registerSavePart('char', 'goods', { save: goodsSaveData, load: goodsApplySave });

/* ------------------------------------------------------------------ */
/* the shared catalogue                                                */
/* ------------------------------------------------------------------ */
// One name for each thing, so every system that makes or uses it agrees. A system adds what it needs (a use, a food
// value, a recipe, a source) with registerGood(id, { ...GOODS[id], ... }) or by setting fields on GOODS[id]; new goods
// get their own ids. food: { hunger, thirst } restore that much of a need (0..1 of a full need); kinds as GOOD_KINDS.
for (const [id, name, kind, icon, value, desc, extra] of [
  // from trees, stone and the ground
  ['firewood', 'Bundle of firewood', 'material', 'log', 1, 'Split wood. Burns well and builds a campfire.', { plural: 'Bundles of firewood' }],
  ['log', 'Log', 'material', 'log', 2, 'A length of trunk from a felled tree. Saw it into planks at a workbench.'],
  ['plank', 'Plank', 'material', 'log', 3, 'Sawn timber for building and making things.'],
  ['stick', 'Stick', 'material', 'log', 1, 'Straight wood for hafts, arrows and kindling.'],
  ['stone', 'Stone', 'material', 'stone', 2, 'Rough stone broken from a rock. Builds walls and hearths.'],
  ['flint', 'Flint', 'material', 'stone', 3, 'Strikes sparks; knaps into blades and arrowheads.'],
  ['clay', 'Clay', 'material', 'stone', 2, 'Dug from river banks. Fires into bricks and pots.'],
  ['iron_ore', 'Iron ore', 'material', 'stone', 5, 'Rust-red rock. Smelt it into iron at a forge.', { plural: 'Iron ore' }],
  ['iron', 'Iron bar', 'material', 'hammer', 12, 'Smelted iron for tools, weapons and fittings.'],
  ['thatch', 'Bundle of thatch', 'material', 'fibre', 2, 'Dried reeds or straw for roofs.', { plural: 'Bundles of thatch' }],
  ['fibre', 'Plant fibre', 'material', 'fibre', 1, 'Nettle or flax fibre. Spin it into thread.', { plural: 'Plant fibre' }],
  ['flax', 'Flax', 'material', 'fibre', 2, 'Harvested flax stems; their fibre makes linen.', { plural: 'Flax' }],
  ['linen', 'Linen cloth', 'material', 'fibre', 6, 'Woven linen for clothing, bandages and sails.', { plural: 'Linen cloth' }],
  ['wool', 'Wool', 'material', 'fibre', 3, 'Shorn fleece. Spin and weave it into warm cloth.', { plural: 'Wool' }],
  ['woollen', 'Woollen cloth', 'material', 'fibre', 8, 'Thick woollen cloth for cloaks and blankets.', { plural: 'Woollen cloth' }],
  // from animals
  ['hide', 'Hide', 'material', 'hide', 4, 'A raw hide from a hunt. Tan it into leather.'],
  ['leather', 'Leather', 'material', 'hide', 8, 'Tanned leather for armour, straps and bags.', { plural: 'Leather' }],
  ['bone', 'Bone', 'material', 'stone', 1, 'Carves into needles, hooks and handles.'],
  ['feather', 'Feather', 'material', 'fibre', 1, 'Fletching for arrows.'],
  ['meat_raw', 'Raw meat', 'food', 'meat', 2, 'Cook it on a fire before eating.', { plural: 'Raw meat', food: { hunger: 0.08 } }],
  ['meat_cooked', 'Roast meat', 'food', 'meat', 4, 'Hot from the fire. Filling.', { plural: 'Roast meat', food: { hunger: 0.35 } }],
  ['fish_raw', 'Raw fish', 'food', 'meat', 2, 'Cook it before eating.', { plural: 'Raw fish', food: { hunger: 0.06 } }],
  ['fish_cooked', 'Grilled fish', 'food', 'meat', 4, 'Flaky and good.', { plural: 'Grilled fish', food: { hunger: 0.28 } }],
  ['egg', 'Egg', 'food', 'seed', 2, 'Boil or fry it.', { food: { hunger: 0.06 } }],
  ['milk', 'Jug of milk', 'drink', 'drop', 3, 'Fresh milk.', { plural: 'Jugs of milk', food: { hunger: 0.08, thirst: 0.3 } }],
  ['cheese', 'Cheese', 'food', 'grain', 6, 'Keeps for a long time.', { plural: 'Cheese', food: { hunger: 0.3 } }],
  ['honey', 'Honeycomb', 'food', 'drop', 5, 'Sweet, and good for healing salves.', { food: { hunger: 0.12 } }],
  // from fields, woods and gardens
  ['grain', 'Sheaf of grain', 'food', 'grain', 2, 'Threshed and milled it makes flour.', { plural: 'Sheaves of grain', food: { hunger: 0.03 } }],
  ['flour', 'Sack of flour', 'material', 'grain', 4, 'Bakes into bread.', { plural: 'Sacks of flour' }],
  ['bread', 'Loaf of bread', 'food', 'grain', 5, 'Fresh bread. A good meal.', { plural: 'Loaves of bread', food: { hunger: 0.4 } }],
  ['berries', 'Handful of berries', 'food', 'seed', 1, 'Picked from the hedges and woods.', { plural: 'Handfuls of berries', food: { hunger: 0.06, thirst: 0.03 } }],
  ['mushrooms', 'Mushrooms', 'food', 'herb', 2, 'Edible woodland mushrooms. Better cooked.', { plural: 'Mushrooms', food: { hunger: 0.05 } }],
  ['apple', 'Apple', 'food', 'seed', 2, 'Crisp and sweet.', { food: { hunger: 0.08, thirst: 0.04 } }],
  ['cabbage', 'Cabbage', 'food', 'herb', 2, 'Good in a stew.', { food: { hunger: 0.08 } }],
  ['turnip', 'Turnip', 'food', 'seed', 2, 'Hardy and filling once cooked.', { food: { hunger: 0.07 } }],
  ['stew', 'Bowl of stew', 'food', 'drop', 8, 'Meat and roots, hot from the pot. The best of meals.', { plural: 'Bowls of stew', food: { hunger: 0.6, thirst: 0.15 } }],
  ['water', 'Waterskin of water', 'drink', 'drop', 1, 'Fresh water to drink on the road.', { plural: 'Waterskins of water', food: { thirst: 0.45 } }],
  ['ale', 'Mug of ale', 'drink', 'drop', 4, 'Brewed from grain. Cheering.', { plural: 'Mugs of ale', food: { hunger: 0.05, thirst: 0.35 } }],
  // herbs (herb lore names their powers)
  ['herb_heal', 'Woundwort', 'herb', 'herb', 3, 'A healer\'s herb: staunches bleeding.', { plural: 'Woundwort' }],
  ['herb_mana', 'Starflower', 'herb', 'herb', 4, 'Pale flowers that clear and quicken the mind.', { plural: 'Starflower' }],
  ['herb_fire', 'Embercap', 'herb', 'herb', 4, 'A red fungus that smoulders when crushed.', { plural: 'Embercap' }],
  ['herb_frost', 'Rimeleaf', 'herb', 'herb', 4, 'Leaves that frost over even in summer.', { plural: 'Rimeleaf' }],
  ['herb_storm', 'Thunder thistle', 'herb', 'herb', 4, 'Prickles with static before a storm.', { plural: 'Thunder thistle' }],
  // seeds (farming gives each its crop)
  ['seed_grain', 'Seed grain', 'seed', 'seed', 1, 'Sow it in a tilled plot.', { plural: 'Seed grain' }],
  ['seed_flax', 'Flax seed', 'seed', 'seed', 1, 'Sow it in a tilled plot.', { plural: 'Flax seed' }],
  ['seed_cabbage', 'Cabbage seed', 'seed', 'seed', 1, 'Sow it in a tilled plot.', { plural: 'Cabbage seed' }],
  ['seed_turnip', 'Turnip seed', 'seed', 'seed', 1, 'Sow it in a tilled plot.', { plural: 'Turnip seed' }],
  // tools (crafting makes them; other systems ask for them)
  ['tool_axe', 'Woodsman\'s axe', 'tool', 'axe', 10, 'Fells trees and splits logs faster.'],
  ['tool_pick', 'Pick', 'tool', 'hammer', 10, 'Breaks stone and ore from rocks.'],
  ['tool_hoe', 'Hoe', 'tool', 'hammer', 8, 'Tills ground for planting.'],
  ['tool_hammer', 'Hammer', 'tool', 'hammer', 8, 'Builds and repairs.'],
  ['tool_knife', 'Knife', 'tool', 'sword', 6, 'Skins game and cuts herbs.'],
  ['tool_rod', 'Fishing rod', 'tool', 'log', 6, 'Catches fish in lakes and rivers.'],
  ['tool_shears', 'Shears', 'tool', 'hammer', 8, 'Shears sheep.', { plural: 'Shears' }],
]) registerGood(id, { name, kind, icon, value, desc, ...(extra || {}) });
