/* ================================================================== */
/* items: quality, slots, generation, stats, and how gear looks        */
/* ================================================================== */
const QUALITY = [
  { key: 'worn', name: 'Worn', col: '#a8a49c', mult: 0.5, sell: 0.5, beam: 0 },
  { key: 'common', name: 'Common', col: '#ece6d6', mult: 0.78, sell: 1, beam: 0 },
  { key: 'fine', name: 'Fine', col: '#6ed676', mult: 1.0, sell: 2.2, beam: 1 },
  { key: 'rare', name: 'Rare', col: '#5ea6ff', mult: 1.28, sell: 5, beam: 1.4 },
  { key: 'epic', name: 'Epic', col: '#bc7cff', mult: 1.6, sell: 12, beam: 2.1 },
  { key: 'legendary', name: 'Legendary', col: '#ffaa40', mult: 2.0, sell: 30, beam: 3.2 },
];
for (const Q of QUALITY) Q.rgb = hex3(Q.col);
const SLOTS = ['weapon', 'head', 'chest', 'hands', 'legs', 'cloak', 'ring', 'charm'];
const SLOT_NAME = { weapon: 'Weapon', head: 'Head', chest: 'Chest', hands: 'Hands', legs: 'Legs', cloak: 'Cloak', ring: 'Ring', charm: 'Charm' };
const STAT_NAME = { dmg: 'damage', hp: 'health', arm: 'armour', crit: 'critical chance', pow: 'power' };
const STAT_ORDER = ['dmg', 'hp', 'arm', 'crit', 'pow'];
// how much one point of each stat is worth against the others
const STAT_SCALE = { dmg: 1, hp: 1, arm: 0.6, crit: 0.4, pow: 1.2 };
const ARMOUR_CAP = 40;
const BAG_SIZE = 24;
const POTION = { name: 'Healing draught', heal: 0.4, cd: 30, max: 10 };

/* what each slot gives and what it is called for each calling */
const SLOT_DEF = {
  weapon: { prim: [['dmg', 1.35]], sec: ['crit', 'pow', 'hp'], vMult: 1.6 },
  head: { prim: [['arm', 0.42], ['hp', 0.55]], sec: ['crit', 'pow', 'dmg'], vMult: 1.0 },
  chest: { prim: [['arm', 0.75], ['hp', 0.8]], sec: ['pow', 'dmg', 'crit'], vMult: 1.3 },
  hands: { prim: [['arm', 0.3], ['dmg', 0.42]], sec: ['crit', 'hp', 'pow'], vMult: 0.9 },
  legs: { prim: [['arm', 0.5], ['hp', 0.6]], sec: ['dmg', 'crit', 'pow'], vMult: 1.1 },
  cloak: { prim: [['hp', 0.55]], sec: ['arm', 'pow', 'crit'], vMult: 0.9 },
  ring: { pick: ['crit', 'dmg', 'pow'], primW: 0.6, sec: ['hp', 'crit', 'dmg', 'pow'], vMult: 1.2 },
  charm: { pick: ['hp', 'pow', 'crit'], primW: 0.7, sec: ['dmg', 'arm', 'hp'], vMult: 1.2 },
};
const ITEM_BASES = {
  weapon: {
    warrior: [['Longsword', 'sword'], ['Arming Sword', 'sword'], ['Broadsword', 'sword'], ['Bearded Axe', 'axe'], ['War Axe', 'axe'], ['Flanged Mace', 'mace']],
    archer: [['Longbow', 'bow'], ['Yew Bow', 'bow'], ['Hunting Bow', 'bow'], ['Horn Bow', 'bow']],
    mage: [['Staff', 'staff'], ['Rowan Staff', 'staff'], ['Runed Staff', 'staff'], ['Blackthorn Staff', 'staff']],
    priest: [['Mace', 'mace'], ['Morning Star', 'mace'], ['Crook', 'staff'], ['Hawthorn Staff', 'staff']],
  },
  head: {
    warrior: [['Nasal Helm', 'helmet'], ['Bascinet', 'helmet'], ['Spangenhelm', 'helmet']],
    archer: [['Hood', 'hood'], ['Cowl', 'hood'], ['Ranger Hood', 'hood']],
    mage: [['Hood', 'hood'], ['Cowl', 'hood'], ['Deep Hood', 'hood']],
    priest: [['Circlet', 'circlet'], ['Diadem', 'circlet'], ['Hood', 'hood']],
  },
  chest: {
    warrior: [['Hauberk', ''], ['Byrnie', ''], ['Brigandine', ''], ['Coat of Plates', '']],
    archer: [['Jerkin', ''], ['Gambeson', ''], ['Leather Coat', '']],
    mage: [['Robe', ''], ['Mantle', ''], ['Long Robe', '']],
    priest: [['Vestments', ''], ['Robe', ''], ['Habit', '']],
  },
  hands: {
    warrior: [['Gauntlets', ''], ['Mail Mitts', '']], archer: [['Bracers', ''], ['Gloves', '']],
    mage: [['Gloves', ''], ['Wraps', '']], priest: [['Gloves', ''], ['Wraps', '']],
  },
  legs: {
    warrior: [['Chausses', ''], ['Greaves', '']], archer: [['Leggings', ''], ['Breeches', '']],
    mage: [['Leggings', ''], ['Hose', '']], priest: [['Leggings', ''], ['Hose', '']],
  },
  cloak: { all: [['Cloak', 'cape'], ['Mantle', 'cape'], ['Travelling Cloak', 'cape']] },
  ring: { all: [['Ring', ''], ['Band', ''], ['Signet', '']] },
  charm: { all: [['Amulet', ''], ['Torc', ''], ['Pendant', ''], ['Talisman', '']] },
};
const VIS_BIT = { sword: WB.sword, axe: WB.axe, mace: WB.mace, staff: WB.staff, bow: WB.bow, helmet: WB.helmet, hood: WB.hood, circlet: WB.circlet, cape: WB.cape };
const WEAPON_BITS = WB.sword | WB.axe | WB.mace | WB.staff | WB.bow;
const HEAD_BITS = WB.helmet | WB.hood | WB.circlet;
// what chest armour looks like, by calling and quality (worn ... legendary)
const ARMOUR_TINT = {
  warrior: [[0.46, 0.45, 0.44], null, [0.8, 0.82, 0.86], [0.46, 0.55, 0.74], [0.24, 0.25, 0.3], [0.94, 0.76, 0.38]],
  archer: [[0.38, 0.31, 0.22], null, [0.3, 0.37, 0.2], [0.22, 0.3, 0.36], [0.16, 0.14, 0.13], [0.55, 0.3, 0.16]],
  mage: [[0.42, 0.38, 0.33], null, [0.2, 0.24, 0.52], [0.1, 0.32, 0.44], [0.34, 0.12, 0.44], [0.07, 0.07, 0.09]],
  priest: [[0.66, 0.63, 0.57], null, [0.93, 0.9, 0.82], [0.78, 0.85, 0.97], [0.62, 0.52, 0.78], [0.99, 0.93, 0.74]],
};
// enchanted weapons glow: 1 fire, 2 frost, 3 holy, 4 arcane, 5 venom, 6 storm
const GLOW_KIND = [null, 'fire', 'frost', 'holy', 'arcane', 'venom', 'storm'];
const GLOW_RGB = [null, [2.4, 0.95, 0.3], [0.55, 1.35, 2.4], [2.2, 1.85, 0.9], [1.45, 0.65, 2.4], [0.7, 2.1, 0.55], [1.0, 1.5, 2.6]];
const GLOW_WORD = [null, 'Ember', 'Rime', 'Dawn', 'Star', 'Venom', 'Storm'];

const PREFIX = {
  worn: ['Worn', 'Battered', 'Weathered', 'Old'],
  fine: ['Fine', 'Sturdy', 'Well-made', 'Tempered'],
  dmg: ['Keen', 'Fierce', 'Biting'], hp: ['Stalwart', 'Hale', 'Hearty'], arm: ['Warded', 'Ironbound', 'Steadfast'],
  crit: ['Deadly', 'Hawkeyed', 'Cruel'], pow: ['Runed', 'Wise', 'Whispering'],
};
const SUFFIX = {
  dmg: ['of the Wolf', 'of Striking', 'of the Boar'], hp: ['of the Bear', 'of Vigour', 'of the Oak'],
  arm: ['of Warding', 'of the Wall', 'of the Tortoise'], crit: ['of the Hawk', 'of Precision', 'of the Adder'],
  pow: ['of the Owl', 'of Insight', 'of the Moon'],
};
// legendary finds have names of their own; armour takes a maker's mark before its kind
const LEGEND = {
  weapon: ['Emberfang', 'Gravesong', 'Thornbrand', 'Wyrmtooth', 'Stormhowl', 'Hollowlight', 'Kingsorrow', 'Nightglass', 'The Long Mercy'],
  head: ['Crown of Ash', 'The Raven Crest', 'Helm of the Long Watch', 'Moonveil'],
  cloak: ['Ravenmantle', 'Embermantle', 'Frostveil', 'Mantle of the Last Ford'],
  ring: ['Stargrip', 'Ring of the Nine Wells', 'Bonecaller', 'The Ember Eye'],
  charm: ['Heartwood Torc', 'The Drowned Pearl', 'Eye of the White Stag', 'Lantern of Bones'],
  mark: ['Ironheart', 'Starward', 'Greywatch', 'Oathward', 'Thornwoven', 'Wyrmscale'],
};

let ITEM_SEQ = 1;
const itemScale = (ilvl) => 1 + 0.4 * ilvl;
function itemValue(it) { return Math.max(1, Math.round((4 + it.lvl * 2.5) * QUALITY[it.q].sell * SLOT_DEF[it.slot].vMult)); }
function itemReq(it) { return Math.max(1, it.lvl - 3); }

function rollQuality(weights, r = Math.random) {
  let s = 0;
  for (const w of weights) s += w;
  let x = r() * s;
  for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
  return 1;
}
// the commonest drops are grey and white, but a lucky kill can drop anything
const DROP_WEIGHTS = { mob: [24, 40, 25, 9, 1.8, 0.15], elite: [0, 10, 40, 36, 13, 1], boss: [0, 0, 8, 42, 44, 6], dragon: [0, 0, 0, 36, 52, 12], chest: [0, 6, 40, 38, 14, 2], shop: [0, 0, 62, 38, 0, 0], soldier: [8, 52, 34, 6, 0, 0] };

function makeItem(o) {
  const r = o.rnd || Math.random;
  const cls = o.cls || 'warrior', realm = o.realm ?? 0;
  const slot = o.slot || pick(r, ['weapon', 'weapon', 'head', 'chest', 'chest', 'hands', 'legs', 'cloak', 'ring', 'charm']);
  const q = clamp(o.q ?? 1, 0, 5), lvl = clamp(Math.round(o.lvl || 1), 1, 24);
  const D = SLOT_DEF[slot];
  const bases = ITEM_BASES[slot][cls] || ITEM_BASES[slot].all;
  const [base, vis] = pick(r, bases);
  const S = itemScale(lvl) * QUALITY[q].mult;
  const st = {};
  const add = (k, w) => { st[k] = (st[k] || 0) + S * w * STAT_SCALE[k] * (0.9 + 0.2 * r()); };
  if (D.prim) for (const [k, w] of D.prim) add(k, w);
  if (D.pick) add(pick(r, D.pick), D.primW);
  const nsec = [0, 0, 1, 1, 2, 2][q];
  const secs = shuffle(r, D.sec.slice());
  for (let i = 0; i < nsec; i++) add(secs[i % secs.length], q >= 5 ? 0.42 : 0.3);
  for (const k in st) st[k] = k === 'crit' ? Math.max(0.5, Math.round(st[k] * 2) / 2) : Math.max(1, Math.round(st[k]));
  const top = STAT_ORDER.reduce((a, k) => (st[k] && (!a || st[k] / STAT_SCALE[k] > st[a] / STAT_SCALE[a]) ? k : a), null) || 'hp';
  const it = { id: `i${Date.now().toString(36)}${(ITEM_SEQ++).toString(36)}${Math.floor(r() * 1296).toString(36)}`, slot, base, vis, q, lvl, st, cls: ITEM_BASES[slot].all ? null : cls };
  // looks: chest armour carries a colour, enchanted weapons a glow
  if (slot === 'chest') {
    const T = ARMOUR_TINT[cls][q] || ARMOR_COL[cls][realm];
    it.tint = T.map((v) => clamp(v * (0.94 + 0.12 * r()), 0, 1));
  }
  if (slot === 'weapon' && q >= 3) {
    it.glow = 1 + Math.floor(r() * 6);
    if (cls === 'priest' && r() < 0.6) it.glow = 3;
    if (cls === 'mage' && r() < 0.4) it.glow = r() < 0.5 ? 1 : 2;
  }
  // names
  if (q === 5) it.name = LEGEND[slot] && (slot !== 'head' || r() < 0.6) ? pick(r, LEGEND[slot]) : `${pick(r, LEGEND.mark)} ${base}`;
  else if (q === 4) it.name = `${randomName(realm, r)}'s ${base}`;
  else if (q === 3) it.name = it.glow ? `${GLOW_WORD[it.glow]}-touched ${base}` : `${pick(r, PREFIX[top])} ${base} ${pick(r, SUFFIX[top])}`;
  else if (q === 2) it.name = `${pick(r, PREFIX.fine)} ${base}`;
  else if (q === 0) it.name = `${pick(r, PREFIX.worn)} ${base}`;
  else it.name = base;
  return it;
}
function itemLine(it) {
  const Q = QUALITY[it.q];
  return `${Q.name} ${it.slot === 'weapon' || it.slot === 'head' || it.slot === 'chest' ? it.base.toLowerCase() : SLOT_NAME[it.slot].toLowerCase()}`;
}
function statText(k, v) { return `+${k === 'crit' ? v.toFixed(v % 1 ? 1 : 0) : Math.round(v)}% ${STAT_NAME[k]}`; }
// a rough single number to compare two items for the same slot
function itemScore(it) {
  if (!it) return 0;
  let s = 0;
  for (const k in it.st) s += it.st[k] / STAT_SCALE[k];
  return s;
}

/* ---- the player's gear: stat totals and the look it gives ---- */
function gearTotals(eq) {
  const t = { dmg: 0, hp: 0, arm: 0, crit: 0, pow: 0 };
  if (!eq) return t;
  for (const s of SLOTS) { const it = eq[s]; if (it && !itemBroken(it)) for (const k in it.st) t[k] += it.st[k]; } // broken gear gives nothing (05h_wear.js)
  t.arm = Math.min(ARMOUR_CAP, t.arm);
  return t;
}
function gearLook(base, eq, cls) {
  const L = { ...base, tabard: base.tabard.slice(), armor: base.armor.slice() };
  if (!eq) return L;
  const w = eq.weapon, h = eq.head, c = eq.chest;
  if (w && VIS_BIT[w.vis]) {
    L.mask = (L.mask & ~WEAPON_BITS) | VIS_BIT[w.vis];
    if (w.vis === 'bow') L.mask |= WB.quiver;
  }
  if (h && VIS_BIT[h.vis]) {
    L.mask &= ~HEAD_BITS;
    L.mask |= VIS_BIT[h.vis];
    // a helm or hood covers the hair; a circlet sits on it
    if (h.vis !== 'circlet') L.mask &= ~(WB.hairShort | WB.hairLong);
    else if (!(L.mask & (WB.hairShort | WB.hairLong))) L.mask |= WB.hairShort;
  }
  if (c && c.tint) L.armor = c.tint.slice();
  if (eq.cloak) L.mask |= WB.cape;
  // weapon enchantments: glow colour in bits 4-6, strength in bits 7-8
  let flags = (L.flags || 0) & 15;
  if (w && w.glow) flags |= (w.glow << 4) | ((w.q >= 5 ? 3 : w.q >= 4 ? 2 : 1) << 7);
  L.flags = flags;
  return L;
}
function sanitizeItem(o) {
  if (!o || typeof o !== 'object' || !SLOT_DEF[o.slot] || typeof o.name !== 'string' || typeof o.base !== 'string') return null;
  const q = clamp(Math.round(+o.q || 0), 0, 5), lvl = clamp(Math.round(+o.lvl || 1), 1, 24);
  const st = {};
  if (o.st && typeof o.st === 'object') for (const k of STAT_ORDER) { const v = +o.st[k]; if (Number.isFinite(v) && v > 0) st[k] = Math.min(v, 200); }
  const it = { id: typeof o.id === 'string' ? o.id.slice(0, 40) : `i${(ITEM_SEQ++).toString(36)}r`, slot: o.slot, base: o.base.slice(0, 40), vis: typeof o.vis === 'string' ? o.vis : '', q, lvl, st, cls: CLASSES[o.cls] ? o.cls : null, name: o.name.slice(0, 60) };
  if (Array.isArray(o.tint) && o.tint.length === 3 && o.tint.every((v) => Number.isFinite(+v))) it.tint = o.tint.map((v) => clamp(+v, 0, 1));
  if (o.glow >= 1 && o.glow <= 6) it.glow = Math.round(o.glow);
  // feature/weather: wear (old saves have none, so their gear is whole and clean)
  if (Number.isFinite(+o.dur) && o.dur !== null && o.dur !== '') it.dur = clamp(+o.dur, 0, 100);
  if (+o.dirt > 0) it.dirt = clamp(+o.dirt, 0, 1);
  if (+o.blood > 0) it.blood = clamp(+o.blood, 0, 1);
  return it;
}
