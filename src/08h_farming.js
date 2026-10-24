/* ================================================================== */
/* farming: the seasons, tilled beds and the town fields, crops that   */
/* grow through their stages with the weather, weeds, tired soil and   */
/* manure, plant breeding (traits, crossing, seed saving, strains) and */
/* herb lore (wild herbs, the herbal). Drawing: 08i_farm_draw.js       */
/* ================================================================== */
// SEASON is the year's clock (spring, summer, autumn, winter: two days each, 2.4 hours a year); seasonNow() is what other
// systems read. A bed (plot) is tilled meadow with furrows; each slot of a bed holds one plant with its own traits, and
// a plant inherits them from its seed lot (a strain) and the pollen it caught while flowering. Saving seed from one ripe
// plant makes a new strain of the next generation; strains are goods of their own (seed_grain_s104).
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON = { t: 0.04 * 8640, yearSec: 8640, idx: 0, name: 'Spring', k: 0, f: 0, day: 1, temp: 10, announced: -1 };
function seasonTempBase(k) { return 10 + 9.5 * Math.cos(TAU * (k - 0.375)); }
function seasonCalc() {
  const S = SEASON;
  S.t = ((S.t % S.yearSec) + S.yearSec) % S.yearSec;
  S.k = S.t / S.yearSec;
  S.idx = Math.min(3, Math.floor(S.k * 4));
  S.f = S.k * 4 - S.idx;
  S.name = SEASON_NAMES[S.idx];
  S.day = Math.min(2, Math.floor(S.f * 2) + 1);
  S.temp = seasonTempBase(S.k);
}
seasonCalc();
function seasonNow() { return { name: SEASON.name, idx: SEASON.idx, k: SEASON.k, f: SEASON.f, temp: SEASON.temp, day: SEASON.day }; }
// a value per season, eased across the turn of the season
function seasonBlend(arr) {
  const S = SEASON, i = S.idx, j = (i + 1) % 4, f = sstep(0.75, 1, S.f), b = (i + 3) % 4, f0 = 1 - sstep(0, 0.25, S.f);
  return lerp(lerp(arr[i], arr[j], f), arr[b], f0 * 0.5 * (1 - f));
}
// winter brings snow south: added to the cold that turns rain to snow (05e_weather.js)
function seasonCold() { return clamp((6 - seasonTempBase(SEASON.k)) / 6, 0, 1) * 0.7; }
// the weather's odds by season: dry summers, wet springs, misty autumns, grey winters (05e_weather.js)
const SEASON_WEATHER = [
  //  clear, cloudy, rain, storm, mist
  [-0.08, 0.0, 0.07, 0.0, 0.01],
  [0.12, -0.04, -0.09, 0.03, -0.02],
  [-0.12, 0.03, 0.04, 0.0, 0.05],
  [-0.06, 0.08, 0.02, -0.04, 0.0],
];
function seasonWeatherOdds(odds) {
  const d = SEASON_WEATHER[SEASON.idx], o = odds.map((v, i) => Math.max(0.01, v + d[i]));
  const s = o.reduce((a, b) => a + b, 0);
  return o.map((v) => v / s);
}
function seasonLabel() { return `${SEASON.name}${SEASON.idx === 3 && SEASON.f > 0.5 ? ', late' : SEASON.f < 0.25 ? ', early' : ''}`; }
// air temperature at a place now (°C): the season, the realm (Thule is cold), height, night, rain and cloud
function farmTempAt(x, z) {
  const rw = realmWeightsAt(x, z), night = U.uNight.value || 0;
  let t = SEASON.temp + rw[0] * 1.2 - rw[2] * 6.5;
  t -= Math.max(0, heightAt(x, z) - 6) * 0.3;
  t -= 7 * night;
  t += wxTempAdj(x, z); // [weather2] the rain and the cloud over this place (12c_weather2.js): -2.5 rain, -1.2 cloud by day, +1.5 by night
  return t;
}

/* ------------------------------------------------------------------ */
/* goods                                                               */
/* ------------------------------------------------------------------ */
Object.assign(ICONS, {
  sprout: '<path d="M12 21v-8"/><path d="M12 13c-1-4-4.5-5.5-7.5-5 0 3.5 2.8 5.6 7.5 5zM12 15c1.2-4.2 4.6-6 8-5.4-.2 3.6-3.2 5.8-8 5.4z"/>',
  hoe: '<path d="M6 20L17 6"/><path d="M14.5 4.5l5 2-2.4 3.2"/>',
});
for (const [id, name, kind, icon, value, desc, extra] of [
  ['beans', 'Beans', 'food', 'seed', 2, 'Broad beans from the pod. Filling in a stew.', { plural: 'Beans', food: { hunger: 0.07 } }],
  ['seed_beans', 'Bean seed', 'seed', 'seed', 1, 'Sow it in a tilled bed. Beans give back to the soil what other crops take.', { plural: 'Bean seed' }],
  ['manure', 'Basket of manure', 'material', 'drop', 1, 'Spread it on a tired bed to make the soil rich again.', { plural: 'Baskets of manure' }],
  ['herb_marsh', 'Marshgold', 'herb', 'herb', 4, 'Golden flowers of the wet margins. Draws out poison and fever.', { plural: 'Marshgold' }],
  ['herb_moon', 'Moonfern', 'herb', 'herb', 5, 'A fern of deep shade that glows faintly at night. Steadies the nerves.', { plural: 'Moonfern' }],
  ['herb_stone', 'Stonebloom', 'herb', 'herb', 4, 'A cushion of tiny flowers on high rock. Toughens the skin.', { plural: 'Stonebloom' }],
  ['root_heal', 'Woundwort root', 'seed', 'sprout', 3, 'Dug up whole. Plant it in a tilled bed to grow your own.'],
  ['root_mana', 'Starflower root', 'seed', 'sprout', 4, 'Dug up whole. Plant it in a tilled bed to grow your own.'],
  ['root_fire', 'Embercap spawn', 'seed', 'sprout', 4, 'A clump of the fungus with its threads. Plant it in a tilled bed.', { plural: 'Embercap spawn' }],
  ['root_frost', 'Rimeleaf root', 'seed', 'sprout', 4, 'Dug up whole. Plant it in a tilled bed to grow your own.'],
  ['root_storm', 'Thunder thistle root', 'seed', 'sprout', 4, 'Dug up whole. Plant it in a tilled bed to grow your own.'],
  ['root_marsh', 'Marshgold root', 'seed', 'sprout', 4, 'Dug up whole. Plant it in a damp bed to grow your own.'],
  ['root_moon', 'Moonfern root', 'seed', 'sprout', 5, 'Dug up whole. Plant it in a tilled bed to grow your own.'],
  ['root_stone', 'Stonebloom root', 'seed', 'sprout', 4, 'Dug up whole. Plant it in a tilled bed to grow your own.'],
]) if (!GOODS[id]) registerGood(id, { name, kind, icon, value, desc, ...(extra || {}) });
if (GOODS.tool_hoe) GOODS.tool_hoe.icon = 'hoe';

/* ------------------------------------------------------------------ */
/* crops and herbs                                                     */
/* ------------------------------------------------------------------ */
// traits, each 0..1: yield, hardiness (frost), drought, speed, colour, height
const FARM_TR = ['y', 'h', 'd', 'sp', 'c', 'ht'];
const FARM_TR_NAME = { y: 'Yield', h: 'Hardiness', d: 'Drought', sp: 'Speed', c: 'Colour', ht: 'Height' };
const FARM_CROPS = {};
// grow: seconds to ripe in the best conditions; tMin / tOpt / tMax: temperatures (°C); frost: the cold it stands at
// hardiness 0; season: how well it grows in spring, summer, autumn, winter; yieldN / seedBack: goods and seed per plant;
// fert: what a harvest takes from the soil (beans give back); base: the common strain's traits
function defCrop(id, o) { FARM_CROPS[id] = { id, plural: o.name, lodge: false, herb: false, ...o }; }
defCrop('grain', { name: 'Grain', seed: 'seed_grain', produce: 'grain', grow: 1000, tMin: 2, tOpt: 15, tMax: 31, frost: -4, season: [1, 1.1, 0.8, 0.15], yieldN: 2.0, seedBack: 1.3, fert: 0.16, base: [0.45, 0.5, 0.4, 0.5, 0.3, 0.5], lodge: true, straw: 0.35, cover: [0.36, 0.52, 0.16], ripeCover: [0.76, 0.62, 0.28], hue: ['pale gold', 'russet'] });
defCrop('flax', { name: 'Flax', seed: 'seed_flax', produce: 'flax', grow: 900, tMin: 5, tOpt: 17, tMax: 29, frost: -1.5, season: [1.05, 1.1, 0.6, 0.05], yieldN: 1.8, seedBack: 1.3, fert: 0.14, base: [0.45, 0.25, 0.45, 0.5, 0.35, 0.5], lodge: true, cover: [0.34, 0.5, 0.3], ripeCover: [0.62, 0.52, 0.3], hue: ['sky blue', 'violet'] });
defCrop('cabbage', { name: 'Cabbage', plural: 'Cabbages', seed: 'seed_cabbage', produce: 'cabbage', grow: 1150, tMin: 3, tOpt: 14, tMax: 26, frost: -6, season: [1, 0.95, 1, 0.3], yieldN: 1.0, seedBack: 1.2, fert: 0.2, base: [0.45, 0.6, 0.35, 0.45, 0.25, 0.5], cover: [0.34, 0.48, 0.38], ripeCover: [0.42, 0.56, 0.4], hue: ['pale green', 'purple'] });
defCrop('turnip', { name: 'Turnips', seed: 'seed_turnip', produce: 'turnip', grow: 750, tMin: 2, tOpt: 13, tMax: 27, frost: -7, season: [1, 0.9, 1, 0.35], yieldN: 1.1, seedBack: 1.3, fert: 0.12, base: [0.45, 0.65, 0.45, 0.55, 0.4, 0.5], cover: [0.3, 0.5, 0.2], ripeCover: [0.36, 0.5, 0.22], hue: ['white', 'purple-topped'] });
defCrop('beans', { name: 'Beans', seed: 'seed_beans', produce: 'beans', grow: 900, tMin: 5, tOpt: 17, tMax: 28, frost: -2, season: [1, 1.1, 0.55, 0.05], yieldN: 1.6, seedBack: 1.4, fert: -0.1, base: [0.45, 0.3, 0.4, 0.5, 0.3, 0.5], cover: [0.24, 0.42, 0.18], ripeCover: [0.4, 0.38, 0.22], hue: ['white', 'purple'] });
// herbs grown in a bed from a dug root; their wild habits are in FARM_HERBS below
defCrop('herb_heal', { herb: true, name: 'Woundwort', seed: 'root_heal', produce: 'herb_heal', grow: 800, tMin: 4, tOpt: 16, tMax: 30, frost: -3, season: [1.05, 1.1, 0.7, 0.1], yieldN: 1.5, seedBack: 0.7, fert: 0.1, base: [0.45, 0.4, 0.45, 0.5, 0.4, 0.5], cover: [0.3, 0.46, 0.2], ripeCover: [0.5, 0.36, 0.42], hue: ['rose', 'deep purple'] });
defCrop('herb_mana', { herb: true, name: 'Starflower', seed: 'root_mana', produce: 'herb_mana', grow: 900, tMin: 3, tOpt: 13, tMax: 25, frost: -4, season: [1.1, 0.9, 0.8, 0.2], yieldN: 1.3, seedBack: 0.6, fert: 0.1, base: [0.45, 0.45, 0.35, 0.5, 0.3, 0.5], cover: [0.22, 0.36, 0.24], ripeCover: [0.5, 0.6, 0.7], hue: ['white', 'pale blue'] });
defCrop('herb_fire', { herb: true, name: 'Embercap', seed: 'root_fire', produce: 'herb_fire', grow: 700, tMin: 6, tOpt: 20, tMax: 34, frost: -1, season: [0.8, 1.1, 1.0, 0.1], yieldN: 1.4, seedBack: 0.7, fert: 0.12, base: [0.45, 0.25, 0.6, 0.5, 0.4, 0.5], cover: [0.5, 0.24, 0.12], ripeCover: [0.7, 0.24, 0.1], hue: ['orange', 'blood red'] });
defCrop('herb_frost', { herb: true, name: 'Rimeleaf', seed: 'root_frost', produce: 'herb_frost', grow: 900, tMin: -4, tOpt: 6, tMax: 20, frost: -16, season: [0.9, 0.6, 1.0, 1.0], yieldN: 1.3, seedBack: 0.6, fert: 0.1, base: [0.45, 0.85, 0.4, 0.5, 0.4, 0.5], cover: [0.5, 0.6, 0.66], ripeCover: [0.7, 0.78, 0.84], hue: ['silver', 'ice blue'] });
defCrop('herb_storm', { herb: true, name: 'Thunder thistle', seed: 'root_storm', produce: 'herb_storm', grow: 850, tMin: 3, tOpt: 14, tMax: 28, frost: -6, season: [0.9, 1.1, 0.9, 0.2], yieldN: 1.3, seedBack: 0.6, fert: 0.12, base: [0.45, 0.6, 0.6, 0.5, 0.4, 0.5], cover: [0.3, 0.4, 0.3], ripeCover: [0.42, 0.34, 0.6], hue: ['violet', 'storm blue'] });
defCrop('herb_marsh', { herb: true, name: 'Marshgold', seed: 'root_marsh', produce: 'herb_marsh', grow: 800, tMin: 5, tOpt: 17, tMax: 29, frost: -3, season: [1, 1.1, 0.7, 0.1], yieldN: 1.4, seedBack: 0.7, fert: 0.1, base: [0.45, 0.4, 0.15, 0.5, 0.35, 0.5], cover: [0.28, 0.44, 0.2], ripeCover: [0.8, 0.66, 0.18], hue: ['lemon', 'deep gold'] });
defCrop('herb_moon', { herb: true, name: 'Moonfern', seed: 'root_moon', produce: 'herb_moon', grow: 950, tMin: 2, tOpt: 12, tMax: 24, frost: -6, season: [1, 0.9, 0.9, 0.3], yieldN: 1.2, seedBack: 0.6, fert: 0.1, base: [0.45, 0.6, 0.3, 0.5, 0.35, 0.5], cover: [0.3, 0.44, 0.36], ripeCover: [0.5, 0.6, 0.56], hue: ['silver-green', 'moon blue'] });
defCrop('herb_stone', { herb: true, name: 'Stonebloom', seed: 'root_stone', produce: 'herb_stone', grow: 900, tMin: 1, tOpt: 12, tMax: 26, frost: -9, season: [1, 1, 0.8, 0.3], yieldN: 1.3, seedBack: 0.6, fert: 0.08, base: [0.45, 0.7, 0.75, 0.5, 0.4, 0.5], cover: [0.4, 0.46, 0.3], ripeCover: [0.62, 0.5, 0.5], hue: ['white', 'rose'] });
const FARM_CROP_IDS = Object.keys(FARM_CROPS);
// the wild herbs: where they grow (place scores a candidate spot), what they do, and how they look through the year
const FARM_HERBS = {
  herb_heal: { habitat: 'Open, sunny meadows and the banks of roads, most of all in the downs of Logres.', uses: 'Staunches bleeding and knits a wound. A healer\'s first herb.', show: [0.8, 0.86, 0.95, 0.3], col: '#c86a9a', n: 70 },
  herb_mana: { habitat: 'The shade at the foot of trees in the green glens of Ériu.', uses: 'Clears and quickens the mind; casters chew it before a long working.', show: [0.82, 0.86, 0.95, 0.35], col: '#c8dcff', n: 60 },
  herb_fire: { habitat: 'Beside warm stones in Logres and the frontier, and on ground that has burned.', uses: 'Smoulders when crushed. Fire-workers and smiths prize it.', show: [0.6, 0.86, 0.95, 0.3], col: '#ff5a2a', n: 55 },
  herb_frost: { habitat: 'Cold high ground in Thule. It is at its best in deep winter.', uses: 'Its leaves frost over even in summer; it cools a fever and a burn.', show: [0.8, 0.7, 0.9, 0.92], col: '#bfe4f4', n: 55 },
  herb_storm: { habitat: 'Bare ridges and high open ground, wherever storms break first.', uses: 'Prickles with static before a storm. Storm-callers carry it.', show: [0.7, 0.86, 0.95, 0.35], col: '#8a6ae0', n: 55 },
  herb_marsh: { habitat: 'The wet margins of lakes and pools, where the ground is soft.', uses: 'Draws out poison and fever.', show: [0.8, 0.86, 0.95, 0.3], col: '#f0c63a', n: 55 },
  herb_moon: { habitat: 'Deep shade among close-grown trees, in Ériu and Thule.', uses: 'Glows faintly at night. Steadies the nerves and sharpens the eyes in the dark.', show: [0.82, 0.86, 0.92, 0.5], col: '#a8e0d8', n: 55 },
  herb_stone: { habitat: 'High rocky ground and the stony shoulders of the passes.', uses: 'Toughens the skin against blows and cold.', show: [0.78, 0.86, 0.92, 0.6], col: '#f0b4c4', n: 55 },
};
const FARM_HERB_IDS = Object.keys(FARM_HERBS);
// the stage of a plant from its growth
const FARM_STAGES = [[0.06, 'Seed in the soil'], [0.2, 'Sprouting'], [0.5, 'In leaf'], [0.72, 'Heading'], [0.84, 'In flower'], [1, 'Ripening'], [9, 'Ripe']];
function farmStage(g) { for (const [e, n] of FARM_STAGES) if (g < e) return n; return 'Ripe'; }
function farmStageIdx(g) { for (let i = 0; i < FARM_STAGES.length; i++) if (g < FARM_STAGES[i][0]) return i; return 6; }

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */
const FARM_SP = 0.6; // a slot every 0.6 m along and across the furrows
const FARM = {
  built: false, speed: 1, plots: [], nextPlot: 1, strains: {}, nextStrain: 101, herbs: [], herbal: { known: {}, tips: 0 },
  granary: {}, job: null, carry: {}, clock: { grow: 0, town: 0, trod: 0, fire: 0, ui: 0, draw: 0 }, ctx: null, drawDirty: true, soilDirty: true,
  lastCraters: 0, farmers: [], fieldsSeen: false,
};
const farmNum = (v, a, b, d) => (Number.isFinite(+v) ? clamp(+v, a, b) : d);
function farmGauss() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

/* ------------------------------------------------------------------ */
/* strains: seed lots with their traits, kept as goods of their own    */
/* ------------------------------------------------------------------ */
const FARM_WORDS = {
  y: ['Thin', 'Heavy'], h: ['Tender', 'Frost-proof'], d: ['Thirsty', 'Dryland'], sp: ['Slow', 'Early'], ht: ['Short', 'Tall'],
};
function strainName(crop, tr, gen) {
  const C = FARM_CROPS[crop];
  // name it by its two most marked traits
  const marks = ['y', 'h', 'd', 'sp', 'ht'].map((k) => [k, tr[k] - (C.base[FARM_TR.indexOf(k)] ?? 0.5)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2).filter((m) => Math.abs(m[1]) > 0.08);
  const words = marks.map(([k, d]) => FARM_WORDS[k][d > 0 ? 1 : 0]);
  const hue = Math.abs(tr.c - C.base[4]) > 0.25 ? (tr.c > C.base[4] ? C.hue[1] : C.hue[0]) : null;
  if (hue && words.length < 2) words.push(hue);
  const ord = gen === 1 ? '1st' : gen === 2 ? '2nd' : gen === 3 ? '3rd' : gen + 'th';
  return `${words.length ? words.join(' ') + ' ' : 'Kept '}${C.herb ? C.name.toLowerCase() : C.name.toLowerCase()} (${ord} sowing)`.replace(/^./, (s) => s.toUpperCase());
}
function farmStrainGood(S) { return S.common ? FARM_CROPS[S.crop].seed : `${FARM_CROPS[S.crop].seed}_${S.id}`; }
function farmRegisterStrainGood(S) {
  const C = FARM_CROPS[S.crop], id = farmStrainGood(S);
  if (S.common) { GOODS[id].farmStrain = S.id; return id; }
  registerGood(id, { name: `${S.name} ${C.herb ? 'root' : 'seed'}`, plural: `${S.name} ${C.herb ? 'roots' : 'seed'}`, kind: 'seed', icon: C.herb ? 'sprout' : 'seed', value: 2, desc: `Seed you kept from your own ${C.name.toLowerCase()}: ${farmTraitWords(S.tr)}. Sow it in a tilled bed.`, farmStrain: S.id });
  return id;
}
function farmTraitWords(tr) {
  return ['y', 'h', 'd', 'sp', 'ht'].map((k) => `${FARM_TR_NAME[k].toLowerCase()} ${Math.round(tr[k] * 100)}`).join(', ');
}
function farmNewStrain(crop, tr, o = {}) {
  const id = o.id || 's' + FARM.nextStrain++;
  const S = { id, crop, tr: { ...tr }, gen: o.gen ?? 1, sd: o.sd ?? 0.08, pa: o.pa || null, pb: o.pb || null, common: !!o.common, name: o.name || null };
  if (!S.name) S.name = strainName(crop, S.tr, S.gen);
  FARM.strains[id] = S;
  farmRegisterStrainGood(S);
  return S;
}
for (const id of FARM_CROP_IDS) {
  const C = FARM_CROPS[id], tr = {};
  FARM_TR.forEach((k, i) => { tr[k] = C.base[i]; });
  farmNewStrain(id, tr, { id: 'c_' + id, common: true, gen: 0, sd: 0.09, name: C.herb ? `Wild ${C.name.toLowerCase()}` : `Common ${C.name.toLowerCase()}` });
}
function farmStrainOfGood(gid) { const G = GOODS[gid]; return G && G.farmStrain ? FARM.strains[G.farmStrain] || null : null; }
// a plant from a seed lot: the lot's traits, scattered by how mixed the lot is, now and then a sport
function farmInherit(S) {
  const tr = {};
  for (const k of FARM_TR) {
    let v = S.tr[k] + farmGauss() * S.sd;
    if (Math.random() < 0.03) v += (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.12);
    tr[k] = clamp(v, 0, 1);
  }
  return tr;
}
// what the traits do
const trYield = (tr) => (0.55 + 0.9 * tr.y) * (1.08 - 0.16 * tr.sp) * (1.05 - 0.1 * tr.h) * (0.92 + 0.16 * tr.ht);
const trSpeed = (tr) => 0.75 + 0.5 * tr.sp;
const trFrost = (C, tr) => C.frost - 5 * tr.h;
const trHeight = (tr) => 0.78 + 0.44 * tr.ht;

/* ------------------------------------------------------------------ */
/* plots                                                               */
/* ------------------------------------------------------------------ */
// own: 'p' a bed of the player's, 't' a strip of a town field. ang: the furrows' bearing (yaw); u across, v along.
function farmPlotNew(o) {
  const P = {
    id: o.id || FARM.nextPlot++, own: o.own || 'p', x: o.x, z: o.z, ang: o.ang || 0, cols: o.cols || 4, rows: o.rows || 6,
    fert: o.fert ?? 0.8, moist: o.moist ?? 0.45, weeds: o.weeds ?? 0, char: 0, manure: 0, till: o.till ?? 1, temp: 10, frost: 0,
    plants: null, stand: null, dmg: null, valid: null, born: GAME.t, ripeNoted: false, idx: 0,
  };
  P.ax = Math.sin(P.ang); P.az = Math.cos(P.ang); P.bx = Math.cos(P.ang); P.bz = -Math.sin(P.ang);
  P.hw = (P.cols * FARM_SP) / 2; P.hd = (P.rows * FARM_SP) / 2;
  P.rad = Math.hypot(P.hw, P.hd);
  P.y = heightAt(P.x, P.z);
  P.realm = realmAt(P.x, P.z);
  if (P.own === 'p') P.plants = new Array(P.cols * P.rows).fill(null);
  else { P.dmg = new Uint8Array(P.cols * P.rows); P.valid = o.valid || new Uint8Array(P.cols * P.rows).fill(1); P.stand = { crop: 'grain', g: 0, hp: 1, ripeT: 0, phase: 'fallow', task: null, p: 0, worker: null, workT: 0, rot: o.rot || 0, town: o.town || 0 }; }
  return P;
}
const plotLocal = (P, x, z) => { const dx = x - P.x, dz = z - P.z; return { u: dx * P.bx + dz * P.bz, v: dx * P.ax + dz * P.az }; };
const plotWorld = (P, u, v) => ({ x: P.x + u * P.bx + v * P.ax, z: P.z + u * P.bz + v * P.az });
function slotUV(P, s) { const i = s % P.cols, j = (s / P.cols) | 0; return [(i + 0.5) * FARM_SP - P.hw, (j + 0.5) * FARM_SP - P.hd]; }
// where a plant stands: its slot, nudged a little so the rows do not look ruled
function slotPos(P, s) {
  const [u, v] = slotUV(P, s), h1 = hash2(P.id * 977 + s, 31), h2 = hash2(P.id * 613 + s, 57);
  return plotWorld(P, u + (h1 - 0.5) * 0.1, v + (h2 - 0.5) * 0.16);
}
function plotAt(x, z, pad = 0) {
  for (const P of FARM.plots) {
    if (Math.abs(x - P.x) > P.rad + pad + 1 || Math.abs(z - P.z) > P.rad + pad + 1) continue;
    const l = plotLocal(P, x, z);
    if (Math.abs(l.u) <= P.hw + pad && Math.abs(l.v) <= P.hd + pad) return P;
  }
  return null;
}
function plotSlotAt(P, x, z) {
  const l = plotLocal(P, x, z);
  const i = clamp(Math.floor((l.u + P.hw) / FARM_SP), 0, P.cols - 1), j = clamp(Math.floor((l.v + P.hd) / FARM_SP), 0, P.rows - 1);
  return j * P.cols + i;
}
// can a bed be tilled here? returns null when it can, or the reason it cannot
const _farmC = [];
function farmGroundWhy(x, z, strict = true) {
  if (x > DUN_X0 - 50 || Math.abs(x) > HALF - 12 || Math.abs(z) > HALF - 12) return 'Nothing grows here';
  if (!isWalkable(x, z)) return 'Too steep or too wet to till';
  const h = heightAt(x, z);
  if (h < WATER_Y + 0.35 || waterAt(x, z)) return 'Too wet: this is the water\'s edge'; // lakes, ponds and rivers (01b_water.js)
  if (sampleGrid(W.road, x, z) > 0.12) return 'That is a road';
  if (sampleGrid(W.rock, x, z) > 0.42) return 'Too stony to till';
  if (strict && sampleGrid(W.grass, x, z) < 0.22 && sampleGrid(W.field, x, z) < 0.3) return 'Only meadow can be tilled';
  for (const S of SITES) if (dist2(x, z, S.x, S.z) < (S.r + (S.kind === 'town' ? 2 : 6)) ** 2) return S.kind === 'town' ? 'Too close to the houses' : 'This is no place for a garden';
  if (BARROW.door && dist2(x, z, BARROW.door.x, BARROW.door.z) < 22 * 22) return 'The barrow ground will not take a spade';
  if (houseAt(x, z, 2.2)) return 'Too close to a house';
  const ci = Math.floor(x + 512), cj = Math.floor(z + 512);
  if (ci >= 0 && cj >= 0 && ci < 1024 && cj < 1024 && COVER.data[cj * 1024 + ci] > 100 && !plotAt(x, z, 0.4)) return 'Something stands here';
  collidersNear(x, z, 3, _farmC);
  for (const c of _farmC) {
    if (!c.active || c.natLog) continue;
    if (c.tag === 'tree') { if (collCovers(c, x, z, 0.9)) return 'Too close to a tree'; continue; }
    if (collCovers(c, x, z, 0.6)) return 'Something stands in the way';
  }
  return null;
}
// a bed in front of the player: 4 furrows across, 6 slots along the way they face
function farmTillSpot(P) {
  const ang = Math.round(P.yaw / (Math.PI / 8)) * (Math.PI / 8);
  const fx = Math.sin(ang), fz = Math.cos(ang), cols = 4, rows = 6, hd = (rows * FARM_SP) / 2, hw = (cols * FARM_SP) / 2;
  const x = P.x + fx * (hd + 0.8), z = P.z + fz * (hd + 0.8);
  let why = null;
  const ax = fx, az = fz, bx = Math.cos(ang), bz = -Math.sin(ang);
  for (let a = -1; a <= 1 && !why; a += 0.5) for (let b = -1; b <= 1 && !why; b += 0.5) {
    const px = x + bx * hw * a + ax * hd * b, pz = z + bz * hw * a + az * hd * b;
    why = farmGroundWhy(px, pz);
  }
  if (!why) {
    const h0 = heightAt(x - ax * hd, z - az * hd), h1 = heightAt(x + ax * hd, z + az * hd), h2 = heightAt(x - bx * hw, z - bz * hw), h3 = heightAt(x + bx * hw, z + bz * hw);
    if (Math.abs(h1 - h0) > 1.6 || Math.abs(h3 - h2) > 1.2) why = 'Too steep to till';
  }
  if (!why) for (const Q of FARM.plots) if (dist(x, z, Q.x, Q.z) < Math.hypot(hw, hd) + Q.rad + 0.3 && farmRectsOverlap(x, z, ang, hw + 0.3, hd + 0.3, Q)) { why = 'Another bed is in the way'; break; }
  if (!why && FARM.plots.filter((Q) => Q.own === 'p').length >= 40) why = 'You have as many beds as you can keep';
  return { x, z, ang, cols, rows, hw, hd, why };
}
// separating axes for two rectangles
function farmRectsOverlap(x, z, ang, hw, hd, Q) {
  const A = { x, z, ax: Math.sin(ang), az: Math.cos(ang), bx: Math.cos(ang), bz: -Math.sin(ang), hw, hd };
  const proj = (R, nx, nz) => { const c = R.x * nx + R.z * nz, r = Math.abs(R.hw * (R.bx * nx + R.bz * nz)) + Math.abs(R.hd * (R.ax * nx + R.az * nz)); return [c - r, c + r]; };
  for (const [nx, nz] of [[A.ax, A.az], [A.bx, A.bz], [Q.ax, Q.az], [Q.bx, Q.bz]]) {
    const p = proj(A, nx, nz), q = proj(Q, nx, nz);
    if (p[1] < q[0] || q[1] < p[0]) return false;
  }
  return true;
}
function farmAddPlot(o) {
  const P = farmPlotNew(o);
  P.idx = FARM.plots.length;
  FARM.plots.push(P);
  farmCoverPlot(P, true);
  FARM.soilDirty = true; FARM.drawDirty = true;
  return P;
}
function farmRemovePlot(P) {
  const i = FARM.plots.indexOf(P);
  if (i < 0) return;
  FARM.plots.splice(i, 1);
  FARM.plots.forEach((Q, k) => { Q.idx = k; });
  // the cover map is drawn again from scratch, without this bed (03_terrain.js calls farmCoverAll)
  buildCoverMask();
  FARM.soilDirty = true; FARM.drawDirty = true;
}
// nothing grows up through a bed: its ground goes into the cover map the grass and flowers read (03_terrain.js)
function farmCoverPlot(P, upload) {
  const c = Math.cos(P.ang), s = Math.sin(P.ang);
  const inside = (px, pz) => {
    const dx = px - P.x, dz = pz - P.z, u = dx * c - dz * s, v = dx * s + dz * c;
    const pad = P.own === 't' ? 0.1 : 0.25;
    if (Math.abs(u) > P.hw + pad || Math.abs(v) > P.hd + pad) return false;
    if (P.valid) { const sl = plotSlotAt(P, px, pz); return P.valid[sl] === 1; }
    return true;
  };
  coverMark(P.x, P.z, P.rad + 0.6, inside);
  if (upload) {
    const i0 = Math.max(0, Math.floor(P.x - P.rad - 1 + 512)), j0 = Math.max(0, Math.floor(P.z - P.rad - 1 + 512));
    const i1 = Math.min(1023, Math.ceil(P.x + P.rad + 1 + 512)), j1 = Math.min(1023, Math.ceil(P.z + P.rad + 1 + 512));
    texSubUpload(COVER.tex, i0, j0, i1 - i0 + 1, j1 - j0 + 1, 1024, gl.RED, gl.UNSIGNED_BYTE, COVER.data, 1);
  }
}
// low herbs keep a little clearing of their own, so the turf does not swallow them
const FARM_LOW_HERBS = new Set(['herb_mana', 'herb_fire', 'herb_frost', 'herb_stone']);
function farmCoverHerbs() { for (const H of FARM.herbs) if (FARM_LOW_HERBS.has(H.k)) coverCircle(H.x, H.z, 0.55 + 0.2 * H.s); }
function farmCoverAll() { for (const P of FARM.plots) farmCoverPlot(P, false); farmCoverHerbs(); }

/* ------------------------------------------------------------------ */
/* plants                                                              */
/* ------------------------------------------------------------------ */
function farmNewPlant(crop, S) {
  return { crop, st: S.id, tr: farmInherit(S), g: 0, hp: 1, trod: 0, char: 0, ripeT: 0, wilt: 0, pol: null, dead: false, nz: Math.random() * 1000 | 0, bite: 0 };
}
// sow every empty slot of a bed from one seed lot; returns how many went in
function farmSow(P, gid, max = Infinity) {
  const S = farmStrainOfGood(gid);
  if (!S || !P.plants) return 0;
  let n = 0;
  for (let s = 0; s < P.plants.length && n < max; s++) {
    if (P.plants[s]) continue;
    if (!goodsTake(gid, 1)) break;
    P.plants[s] = farmNewPlant(S.crop, S);
    n++;
  }
  if (n) { P.till = 1; FARM.drawDirty = true; P.ripeNoted = false; }
  return n;
}
// how fast a crop grows here now: the season, warmth, water, light, weeds and the soil (0 when it cannot)
function farmGrowRate(C, P, tr, temp) {
  const sK = seasonBlend(C.season);
  let tK = clamp((temp - C.tMin) / (C.tOpt - C.tMin), 0, 1);
  tK = Math.pow(tK, 0.6) * (1 - sstep(C.tMax, C.tMax + 8, temp));
  const wK = sstep(0.03, 0.3, P.moist) * (1 - 0.25 * sstep(0.93, 1, P.moist));
  const lK = 0.6 + 0.4 * (typeof sunStrength === 'function' ? sunStrength() : 0.5);
  return (sK * tK * wK * lK * (1 - 0.5 * P.weeds) * (0.6 + 0.5 * P.fert) * trSpeed(tr)) / C.grow;
}
// a plant in flower catches pollen from a neighbour of its kind in flower (or its own)
function farmPollinate(P, s, pl) {
  const cand = [];
  const me = slotPos(P, s);
  for (const Q of FARM.plots) {
    if (!Q.plants || dist2(Q.x, Q.z, me.x, me.z) > (Q.rad + 3.2) ** 2) continue;
    for (let k = 0; k < Q.plants.length; k++) {
      const o = Q.plants[k];
      if (!o || o === pl || o.crop !== pl.crop || o.dead || o.g < 0.66 || o.g > 0.9) continue;
      const p = slotPos(Q, k);
      if (dist2(p.x, p.z, me.x, me.z) < 3.2 * 3.2) cand.push(o);
    }
  }
  // the nearer and the more of them, the likelier a cross; otherwise it sets its own seed
  if (cand.length && Math.random() < cand.length / (cand.length + 1.2)) { const o = cand[Math.floor(Math.random() * cand.length)]; pl.pol = { st: o.st, tr: { ...o.tr } }; }
  else pl.pol = { st: pl.st, tr: { ...pl.tr }, self: true };
}
const FARM_WEEDS = [1.15, 1.0, 0.6, 0.07];
// one slow step of every bed: water, weeds, rest, and every plant's growth, frost, drought and ripeness
const _farmWx = {};
function farmStepPlots(dt) {
  const rainNow0 = Math.max(0, (WEATHER.raining || 0) - (WEATHER.snowing || 0));
  const sun = typeof sunStrength === 'function' ? sunStrength() : 0.5;
  const snow0 = WEATHER.snow || 0;
  const storm0 = WEATHER.storm || 0;
  const live = wxLive();
  for (const P of FARM.plots) {
    // [weather2] the rain, the snow lying and the storm over this bed (12c_weather2.js)
    const lw = live ? weatherAt(P.x, P.z, _farmWx) : null;
    const rainNow = lw ? lw.rain : rainNow0, snow = lw ? lw.snow : snow0, storm = lw ? lw.storm : storm0;
    const temp = farmTempAt(P.x, P.z) + 3 * snow * (P.own === 'p' ? 1 : 1); // snow lying on a bed keeps the frost off it
    P.temp = temp;
    const evap = (0.0003 + 0.0016 * clamp((temp - 4) / 22, 0, 1) * (0.35 + 0.65 * sun)) * (1 - 0.6 * rainNow);
    const melt = snow > 0.15 && temp > 1 ? 0.004 : 0;
    P.moist = clamp(P.moist + dt * (rainNow * 0.03 + melt - evap), 0, 1);
    P.frost = clamp((0.5 - temp) / 4, 0, 1);
    P.char = Math.max(0, P.char - dt / 600);
    P.manure = Math.max(0, P.manure - dt / 900);
    let living = 0;
    if (P.plants) {
      for (let s = 0; s < P.plants.length; s++) {
        const pl = P.plants[s];
        if (!pl) continue;
        if (pl.dead) { pl.ripeT += dt; continue; }
        living++;
        farmStepPlant(P, pl, dt, temp, storm, s);
      }
    } else if (P.stand && P.stand.phase === 'sown') { living = 1; farmStepPlant(P, P.stand, dt, temp, storm, -1); }
    // weeds come up in bare and sown ground alike; a bed left alone rests and grows rich again
    const wr = 0.0011 * FARM_WEEDS[SEASON.idx] * (0.4 + 0.8 * P.moist) * (living ? 1 : 1.2);
    P.weeds = clamp(P.weeds + dt * wr * FARM.speed, 0, 1);
    if (!living) P.fert = Math.min(1, P.fert + dt / 1500);
    if (P.own === 'p' && P.till > 0 && !living) P.till = Math.max(0.35, P.till - dt / 3000);
  }
}
function farmStepPlant(P, pl, dt, temp, storm, slot) {
  const C = FARM_CROPS[pl.crop];
  if (!C) return;
  const tr = pl.tr || FARM.strains['c_' + pl.crop].tr;
  const sown = pl.g >= 0.05;
  // frost: below what the crop and its hardiness can stand, it is bitten; a hard frost kills
  const lim = trFrost(C, tr);
  pl.bite = Math.max(0, (pl.bite || 0) - dt / 300);
  if (sown && temp < lim) {
    const d = lim - temp;
    pl.hp -= dt * (0.004 * d + (d > 4 ? 0.03 : 0));
    pl.bite = 1;
  }
  // drought: a bed dry for long wilts and then dies, less so for dryland strains
  pl.wilt = sown ? (1 - sstep(0.02, 0.18, P.moist)) * (1 - 0.5 * tr.d) : 0;
  if (sown && P.moist < 0.06) pl.hp -= dt * 0.0011 * (1 - 0.75 * tr.d);
  if (sown && temp > lim + 1 && P.moist > 0.1 && pl.hp < 1) pl.hp = Math.min(1, pl.hp + dt * 0.0005);
  // a storm lays tall crops flat
  if (C.lodge && storm > 0.55 && pl.g > 0.6 && tr.ht > 0.5 && Math.random() < dt * 0.02 * (tr.ht - 0.45) * storm) pl.trod = Math.min(1, (pl.trod || 0) + 0.5);
  if (pl.trod > 0 && pl.g < 0.5) pl.trod = Math.max(0, pl.trod - dt * 0.004);
  if (pl.hp <= 0) { pl.hp = 0; pl.dead = true; FARM.drawDirty = true; return; }
  if (pl.g < 1) {
    const before = pl.g;
    pl.g = Math.min(1, pl.g + dt * farmGrowRate(C, P, tr, temp) * FARM.speed * (0.4 + 0.6 * pl.hp));
    if (slot >= 0 && before < 0.72 && pl.g >= 0.72 && !pl.pol) farmPollinate(P, slot, pl);
    if (farmStageIdx(before) !== farmStageIdx(pl.g)) FARM.drawDirty = true;
  } else {
    // ripe: left standing too long it sheds, splits and at last rots
    pl.ripeT += dt * FARM.speed;
    if (pl.ripeT > 1800) { pl.dead = true; FARM.drawDirty = true; }
  }
}
// what one plant gives: produce and seed (fractions; the harvest rounds them)
function farmPlantYield(P, pl) {
  const C = FARM_CROPS[pl.crop];
  if (!C || pl.dead || pl.g < 1) return { prod: 0, seed: 0 };
  const tr = pl.tr || FARM.strains['c_' + pl.crop].tr;
  const over = 1 - 0.5 * sstep(700, 1500, pl.ripeT);
  const k = trYield(tr) * pl.hp * (1 - 0.6 * (pl.trod || 0)) * (0.5 + 0.65 * P.fert) * (1 - 0.4 * P.weeds) * over;
  return { prod: C.yieldN * k, seed: C.seedBack * (0.55 + 0.45 * pl.hp) * Math.sqrt(trYield(tr)) * over };
}
// whole goods from fractions: the remainder is carried over to the next harvest
function farmGive(id, amount, quiet) {
  const c = (FARM.carry[id] || 0) + amount, n = Math.floor(c + 1e-6);
  FARM.carry[id] = c - n;
  if (n > 0) goodsAdd(id, n, quiet);
  return n;
}
// harvest every ripe plant of a bed
function farmHarvest(P, quiet = false) {
  if (!P.plants) return null;
  const out = { prod: {}, seed: {}, n: 0 };
  let used = 0;
  for (let s = 0; s < P.plants.length; s++) {
    const pl = P.plants[s];
    if (!pl || pl.dead || pl.g < 1) continue;
    const C = FARM_CROPS[pl.crop], y = farmPlantYield(P, pl), S = FARM.strains[pl.st] || FARM.strains['c_' + pl.crop];
    out.prod[C.produce] = (out.prod[C.produce] || 0) + y.prod;
    const sg = farmStrainGood(S);
    out.seed[sg] = (out.seed[sg] || 0) + y.seed;
    if (C.straw) out.prod.thatch = (out.prod.thatch || 0) + C.straw * y.prod * 0.5;
    used += C.fert;
    P.plants[s] = null;
    out.n++;
  }
  if (!out.n) return null;
  P.fert = clamp(P.fert - used / P.plants.length, 0, 1);
  const got = {};
  for (const id in out.prod) got[id] = farmGive(id, out.prod[id], true);
  for (const id in out.seed) got[id] = (got[id] || 0) + farmGive(id, out.seed[id], true);
  if (!quiet) {
    const words = Object.keys(got).filter((id) => got[id] > 0).map((id) => `${got[id]} ${goodName(id, got[id]).toLowerCase()}`);
    uiLog(`You harvest the bed: ${words.join(', ') || 'nothing worth keeping'}.`, 'loot');
    sfx('loot');
  }
  out.got = got;
  activityRecord('resource.harvested', 'ripe-bed', out.n, { success: true });
  FARM.drawDirty = true;
  saveSoon();
  return out;
}
// keep the seed of one ripe plant: a new strain from it and its pollen parent, a generation on
function farmSaveSeed(P, s, quiet = false) {
  const pl = P.plants && P.plants[s];
  if (!pl || pl.dead || pl.g < 1) return null;
  const C = FARM_CROPS[pl.crop];
  const S0 = FARM.strains[pl.st] || FARM.strains['c_' + pl.crop];
  const pol = pl.pol || { st: pl.st, tr: pl.tr, self: true };
  const S1 = FARM.strains[pol.st] || S0;
  const cross = S1.id !== S0.id;
  const tr = {};
  for (const k of FARM_TR) tr[k] = clamp((pl.tr[k] + pol.tr[k]) / 2, 0, 1);
  if (cross) tr.y = clamp(tr.y + 0.04, 0, 1); // a first cross between two strains grows with a little extra vigour
  const gen = Math.max(S0.gen, S1.gen) + 1;
  const sd = cross ? 0.085 : Math.max(0.025, S0.sd * 0.8);
  // the same kept line again: add to it rather than starting another
  let S = Object.values(FARM.strains).find((o) => !o.common && o.crop === pl.crop && o.gen === gen && o.pa === S0.id && o.pb === S1.id && FARM_TR.every((k) => Math.abs(o.tr[k] - tr[k]) < 0.03));
  if (!S) S = farmNewStrain(pl.crop, tr, { gen, sd, pa: S0.id, pb: S1.id });
  const y = farmPlantYield(P, pl);
  const n = Math.max(2, Math.round(3 + 4 * trYield(pl.tr) * pl.hp));
  goodsAdd(farmStrainGood(S), n, true);
  farmGive(C.produce, y.prod, true);
  P.plants[s] = null;
  P.fert = clamp(P.fert - C.fert / P.plants.length, 0, 1);
  if (!quiet) { uiLog(`You keep ${n} ${C.herb ? 'roots' : 'seeds'} of this plant as a strain of its own: ${S.name}.`, 'loot'); sfx('loot'); }
  farmStrainsTidy();
  FARM.drawDirty = true;
  saveSoon();
  return S;
}
// strains nobody holds or grows any more are forgotten (but the commons and the parents of what is grown stay)
function farmStrainsTidy() {
  const ids = Object.keys(FARM.strains).filter((id) => !FARM.strains[id].common);
  if (ids.length <= 48) return;
  const used = new Set();
  for (const P of FARM.plots) if (P.plants) for (const pl of P.plants) if (pl) { used.add(pl.st); if (pl.pol) used.add(pl.pol.st); }
  for (const id of ids) if (goodsCount(farmStrainGood(FARM.strains[id])) > 0) used.add(id);
  for (const id of [...used]) { const S = FARM.strains[id]; if (S) { if (S.pa) used.add(S.pa); if (S.pb) used.add(S.pb); } }
  for (const id of ids) if (!used.has(id)) delete FARM.strains[id];
}

/* ------------------------------------------------------------------ */
/* the town fields: strips sown, weeded and harvested by the townsfolk */
/* ------------------------------------------------------------------ */
// sowing windows (k through the year) for the townsfolk's own planning; the player can sow whenever they dare
const FARM_SOW = { grain: [[0.0, 0.2], [0.52, 0.66]], flax: [[0.02, 0.2]], beans: [[0.03, 0.24]], turnip: [[0.0, 0.45]], cabbage: [[0.0, 0.3], [0.5, 0.58]], herb_heal: [[0.02, 0.3]], herb_mana: [[0.0, 0.28]], herb_marsh: [[0.04, 0.32]] }; // [seasons] the gardens' herbs
const FARM_ROT = ['grain', 'beans', 'grain', 'turnip', 'flax', 'grain', 'cabbage'];
// [seasons] the gardens of the other towns (01_world.js W.fieldRects with a realm): Ériu grows herbs, beans and greens,
// Thule hardy turnips and cabbages
const FARM_GARDEN_ROT = { 1: ['beans', 'herb_heal', 'cabbage', 'herb_mana', 'turnip', 'herb_marsh'], 2: ['turnip', 'cabbage', 'turnip', 'cabbage'] };
const farmRotOf = (P) => P.rotList || FARM_ROT;
const farmInWindow = (crop, k = SEASON.k) => (FARM_SOW[crop] || []).some(([a, b]) => k >= a && k <= b);
const FARM_TASK_ACT = { till: 8, sow: 5, weed: 5, harvest: 1 };
function farmBuildTownFields() {
  const rects = W.fieldRects || [];
  rects.forEach((F, fi) => {
    const c = Math.cos(F.ang), s = Math.sin(F.ang);
    // the field's long axis in the world: furrows run along it
    const longX = F.hw >= F.hd;
    const half = longX ? F.hw : F.hd, across = longX ? F.hd : F.hw;
    const lx = longX ? { x: c, z: -s } : { x: s, z: c }, lz = longX ? { x: s, z: c } : { x: c, z: -s };
    const ang = Math.atan2(lx.x, lx.z);
    // strips with grassy balks between them to walk on
    const stripW = F.stripW || 4.8, gap = F.gap || 1.7, n = Math.max(1, Math.floor((2 * across - 1) / (stripW + gap))); // [seasons] narrower beds in the gardens
    const used = n * (stripW + gap) - gap, rows = Math.floor((2 * half - 3) / FARM_SP), cols = Math.floor(stripW / FARM_SP);
    for (let k = 0; k < n; k++) {
      const off = -used / 2 + k * (stripW + gap) + stripW / 2;
      const x = F.x + lz.x * off, z = F.z + lz.z * off;
      const tmp = farmPlotNew({ own: 't', x, z, ang, cols, rows, id: -1 });
      // slots that sit on a road, under a tree or against anything built are left alone
      const valid = new Uint8Array(cols * rows);
      let good = 0;
      for (let q = 0; q < valid.length; q++) {
        const p = slotPos(tmp, q);
        const ok = !farmGroundWhy(p.x, p.z, false) && sampleGrid(W.field, p.x, p.z) > 0.35;
        valid[q] = ok ? 1 : 0;
        if (ok) good++;
      }
      if (good < valid.length * 0.4) continue;
      const P = farmAddPlot({ own: 't', x, z, ang, cols, rows, valid, rot: fi * 2 + k, town: F.realm || 0, fert: 0.85 }); // [seasons] the town it belongs to
      P.field = fi;
      if (F.realm) { P.rotList = FARM_GARDEN_ROT[F.realm]; P.garden = true; } // [seasons]
      // the year starts with the fields part sown already
      const T = P.stand;
      const crop = farmRotOf(P)[T.rot % farmRotOf(P).length];
      if (farmInWindow(crop) && Math.random() < 0.7) { T.crop = crop; T.phase = 'sown'; T.g = 0.05 + Math.random() * 0.25; }
      else { T.phase = 'fallow'; }
    }
  });
}
// the next job a strip wants, if any
function farmStripWants(P) {
  const T = P.stand;
  if (T.phase === 'sown' && (T.g >= 1 || T.hp <= 0 || T.dead)) return 'harvest';
  if (T.phase === 'sown' && P.weeds > 0.45 && T.g < 0.9) return 'weed';
  if (T.phase === 'tilled') return farmNextTownCrop(P) ? 'sow' : null;
  if ((T.phase === 'fallow' || T.phase === 'stubble') && farmNextTownCrop(P)) return 'till';
  return null;
}
function farmNextTownCrop(P) {
  const T = P.stand;
  const rot = farmRotOf(P); // [seasons]
  for (let k = 0; k < rot.length; k++) { const c = rot[(T.rot + k) % rot.length]; if (farmInWindow(c)) return c; }
  return null;
}
function farmTaskSwings(P) { return Math.max(12, Math.round((P.cols * P.rows) / 45)); }
// a strip's job done: by the townsfolk at work, or by the town when nobody is near enough to watch
function farmTownDone(P) {
  const T = P.stand, task = T.task;
  T.task = null; T.p = 0; T.worker = null;
  if (task === 'till') { T.phase = 'tilled'; P.till = 1; P.weeds = 0; P.char = 0; P.dmg.fill(0); }
  else if (task === 'sow') { const c = farmNextTownCrop(P) || 'grain'; T.crop = c; T.phase = 'sown'; T.g = 0; T.hp = 1; T.ripeT = 0; T.dead = false; T.rot = (farmRotOf(P).indexOf(c) + 1) % farmRotOf(P).length; P.dmg.fill(0); } // [seasons] each town its own rotation
  else if (task === 'weed') { P.weeds = 0; }
  else if (task === 'harvest') {
    const C = FARM_CROPS[T.crop];
    if (C && !T.dead && T.hp > 0) {
      let n = 0;
      for (let q = 0; q < P.valid.length; q++) if (P.valid[q] && P.dmg[q] < 2) n++;
      const amount = n * C.yieldN * T.hp * (0.5 + 0.65 * P.fert) * (1 - 0.4 * P.weeds) * 0.9;
      FARM.granary[C.produce] = Math.round((FARM.granary[C.produce] || 0) + amount);
      loopsHarvest(T.town || 0, C.produce, amount); // [loops] into the realm's stores (08m_loops.js)
      P.fert = clamp(P.fert - C.fert, 0, 1);
    }
    T.phase = 'stubble'; P.till = 0.2; T.g = 0; T.dead = false;
  }
  FARM.drawDirty = true;
}
// the townsfolk's own planning, and the work done out of sight
function farmStepTown(dt) {
  const PL = GAME.player;
  for (const P of FARM.plots) {
    if (P.own !== 't') continue;
    const T = P.stand;
    if (T.phase === 'sown' && T.hp <= 0) T.dead = true;
    if (!T.task) { const w = farmStripWants(P); if (w) { T.task = w; T.p = 0; T.worker = null; T.workT = GAME.t; } continue; }
    // a worker that has gone quiet (sent home, frozen far from the player, fallen) gives the job back
    const Wk = T.worker != null ? getEnt(T.worker) : null;
    if (T.worker != null && (!Wk || !Wk.alive || GAME.t - T.workT > 90)) T.worker = null;
    const far = !PL || dist2(PL.x, PL.z, P.x, P.z) > 150 * 150;
    const idle = T.worker == null && GAME.t - T.workT > 60;
    if (T.worker == null && (far || idle) && !houseWantsShut()) {
      T.p += (dt * FARM.speed) / 200;
      if (T.p >= 1) farmTownDone(P);
      else FARM.drawDirty = true;
    }
  }
}
// townsfolk who farm: the first two of Brackenford's, one in each other town who sells seed (08f_townlife.js asks)
function farmAssignFarmers() {
  FARM.farmers = [];
  for (const R of REALMS) {
    const vs = ENT.filter((e) => e.role === 'villager' && e.alive && !e.removed && !e.netNpcMissing
      && e.home && dist2(e.home.x, e.home.z, R.town.x, R.town.z) < 10);
    const tends = R.id === 0 || FARM.plots.some((P) => P.own === 't' && P.stand.town === R.id); // [seasons] the gardens of Ériu and Thule are tended too
    vs.slice(0, tends ? 2 : 1).forEach((e, i) => { e.ai.farmer = true; e.ai.fieldHand = tends; e.farmTown = R.id; if (i === 0) e.ai.seedSeller = true; FARM.farmers.push(e.id); });
  }
}
// called by houseLife for a villager out by day: a farmer with a job to do goes to it
function farmLife(e) {
  const ai = e.ai;
  if (!ai.farmer || !ai.fieldHand || GAME.t < (ai.farmNext || 0)) return false;
  ai.farmNext = GAME.t + 4 + Math.random() * 3;
  // a ripe crop first, then the weeding, the sowing and the tilling; the nearest of each
  const urgency = { harvest: 0, weed: 900, sow: 1600, till: 2500 };
  let best = null, bd = Infinity;
  for (const P of FARM.plots) {
    if (P.own !== 't' || !P.stand.task || P.stand.worker != null) continue;
    const d = dist2(P.x, P.z, e.x, e.z);
    if (d > 160 * 160) continue;
    const sc = d + (urgency[P.stand.task] || 0);
    if (sc < bd) { bd = sc; best = P; }
  }
  if (!best) return false;
  best.stand.worker = e.id; best.stand.workT = GAME.t;
  lifePlan(e, [lifeStep('farm', { P: best })]);
  return true;
}
// where the work has got to along a strip, and a place in the furrow beside it
function farmFront(P, frac, side) {
  const v = -P.hd + clamp(frac, 0, 1) * 2 * P.hd, u = side * (P.hw * 0.5);
  return plotWorld(P, u, v);
}
// the 'farm' step of a villager's plan (lifeRun in 08f_townlife.js): walk out, then work along the strip
function farmLifeStep(e, st, plan, dt, next) {
  const P = st.P, T = P && P.stand;
  if (!T || !T.task || T.worker !== e.id || houseWantsShut()) { if (T && T.worker === e.id) T.worker = null; next(); return true; }
  const side = (e.id % 2) ? 1 : -1;
  const fr = farmFront(P, T.p, side);
  const d = dist(e.x, e.z, fr.x, fr.z);
  if (d > 1.4) {
    // [seasons] out of town by way of the plaza when the way straight out is blocked (the houses face the plaza; the
    // gardens of Ériu and Thule lie close behind them)
    if (!st.viaDone) {
      const TT = REALMS[T.town || 0] && REALMS[T.town || 0].town;
      if (!st.via && TT && dist(e.x, e.z, TT.x, TT.z) < 36 && !segmentClear(e.x, e.z, fr.x, fr.z, 0.5)) { const a = Math.atan2(fr.x - TT.x, fr.z - TT.z); st.via = { x: TT.x + Math.sin(a) * 9, z: TT.z + Math.cos(a) * 9, until: plan.t + 40 }; }
      if (!st.via) st.viaDone = true;
      else { if (moveToward(e, st.via.x, st.via.z, dt, 1.0, 0.6) || dist(e.x, e.z, st.via.x, st.via.z) < 1.3 || plan.t > st.via.until) { st.via = null; st.viaDone = true; } return true; }
    }
    // on the way out of town: a house or a fence in the way is walked round
    const tr = st.track || (st.track = { x: e.x, z: e.z, t: plan.t, d });
    if (plan.t - tr.t > 2.5 && d > 2.5) { // (the last steps up to the work need no headway check)
      // headway is how much nearer the work is now, not how far the feet went: sliding along a wall is no headway
      const gained = (tr.d ?? d) - d;
      st.track = { x: e.x, z: e.z, t: plan.t, d };
      if (gained > 0.8) T.workT = GAME.t; // still getting there
      else if (!st.detour && !st.path) {
        // [v10] the way round whatever is in the way (a house, a fence: 08f_townlife.js localPath), else a sidestep
        const way = localPath(e.x, e.z, fr.x, fr.z);
        if (way && way.length) { st.path = way; st.pathUntil = plan.t + 40; }
        else {
          const dx = fr.x - e.x, dz = fr.z - e.z, l = Math.hypot(dx, dz) || 1, sd = (st.turn = -(st.turn || (Math.random() < 0.5 ? 1 : -1)));
          st.detour = { x: e.x + (-dz / l) * sd * (4 + Math.random() * 3) - (dx / l) * 1.2, z: e.z + (dx / l) * sd * (4 + Math.random() * 3) - (dz / l) * 1.2, until: plan.t + 4 };
        }
      }
    }
    if (st.path) { // [v10]
      const w = st.path[0];
      if (!w || plan.t > st.pathUntil) st.path = null;
      else if (dist(e.x, e.z, w.x, w.z) < 0.8 || moveToward(e, w.x, w.z, dt, 1.0, 0.5)) { st.path.shift(); if (!st.path.length) st.path = null; }
      if (st.path) return true;
    }
    if (st.detour) { if (moveToward(e, st.detour.x, st.detour.z, dt, 1.0, 0.5) || plan.t > st.detour.until) st.detour = null; return true; }
    moveToward(e, fr.x, fr.z, dt, d > 6 ? 1.0 : 0.6, 0.4);
    st.walkT = (st.walkT || 0) + dt;
    if (st.walkT > 200) { T.worker = null; next(); }
    return true;
  }
  T.workT = GAME.t;
  st.track = null; st.detour = null; st.path = null; // [v10] at the work: the headway is measured afresh when the work moves on
  // face along the furrow, the work just in front and a little toward the middle of the strip
  const ah = plotWorld(P, side * (P.hw * 0.2), -P.hd + clamp(T.p, 0, 1) * 2 * P.hd + 0.7);
  turnToward(e, ah.x, ah.z, dt * 4);
  st.next = st.next ?? plan.t + 0.4;
  if (plan.t >= st.next) {
    st.next = plan.t + 1.05 + Math.random() * 0.45;
    setAct(e, FARM_TASK_ACT[T.task] || 5, T.task === 'till' ? 0.95 : 0.75);
    const task = T.task;
    later(0.35, () => { if (e.alive) farmWorkFx(task, e.x + Math.sin(e.yaw) * 0.8, e.z + Math.cos(e.yaw) * 0.8, task === 'harvest' ? (FARM_CROPS[T.crop] || FARM_CROPS.grain) : null); });
    T.p += 1 / farmTaskSwings(P);
    FARM.drawDirty = true;
    if (T.p >= 1) { farmTownDone(P); next(); }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* wild herbs                                                          */
/* ------------------------------------------------------------------ */
function farmPlaceHerbs() {
  const r = mulberry(31337);
  // trees and rocks by 8 m cell, to judge shade and warm stones quickly
  const cell = 8, tg = new Map(), rg = new Map();
  const key = (x, z) => Math.floor(x / cell) * 4096 + Math.floor(z / cell);
  for (const t of W.trees) { const k = key(t.x, t.z); if (!tg.has(k)) tg.set(k, []); tg.get(k).push(t); }
  for (const o of W.rocks) { const k = key(o.x, o.z); if (!rg.has(k)) rg.set(k, []); rg.get(k).push(o); }
  const near = (g, x, z, rad, fn) => { let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = g.get(key(x + a * cell, z + b * cell)); if (l) for (const o of l) { const d = dist(o.x, o.z, x, z); if (d < rad && fn(o, d)) n++; } } return n; };
  const ok = (x, z) => {
    if (!isWalkable(x, z) || heightAt(x, z) < WATER_Y + 0.25) return false;
    if (sampleGrid(W.road, x, z) > 0.08 || sampleGrid(W.field, x, z) > 0.1) return false;
    const ci = Math.floor(x + 512), cj = Math.floor(z + 512);
    if (COVER.data[cj * 1024 + ci] > 100) return false;
    for (const S of SITES) if (dist2(x, z, S.x, S.z) < (S.r + 4) ** 2) return false;
    if (near(tg, x, z, 1.1, () => true)) return false;
    return true;
  };
  const test = {
    herb_heal: (x, z, rw, h) => sampleGrid(W.grass, x, z) > 0.55 && rw[0] + 0.5 * rw[1] > 0.55 && h < 16 && !near(tg, x, z, 6, () => true),
    herb_mana: (x, z, rw) => rw[1] > 0.45 && near(tg, x, z, 3.4, (o, d) => d > 1.4) > 0,
    herb_fire: (x, z, rw) => (rw[0] > 0.4 || Math.hypot(x, z) < R_RING) && near(rg, x, z, 2.8, (o, d) => o.s > 0.5 && d > o.s * 0.8) > 0,
    herb_frost: (x, z, rw, h) => rw[2] > 0.5 && (h > 9 || sampleGrid(W.rock, x, z) > 0.2) && sampleGrid(W.rock, x, z) < 0.6,
    herb_storm: (x, z, rw, h) => h > 13 && sampleGrid(W.rock, x, z) < 0.55 && sampleGrid(W.grass, x, z) > 0.2,
    herb_marsh: (x, z, rw, h) => h < WATER_Y + 1.7 && sampleGrid(W.grass, x, z) > 0.15,
    herb_moon: (x, z, rw) => rw[1] + rw[2] > 0.55 && near(tg, x, z, 4.6, (o, d) => d > 1.3) >= 2,
    herb_stone: (x, z, rw, h) => h > 7 && sampleGrid(W.rock, x, z) > 0.28 && sampleGrid(W.rock, x, z) < 0.62,
  };
  FARM.herbs = [];
  for (const k of FARM_HERB_IDS) {
    const want = FARM_HERBS[k].n;
    let got = 0;
    for (let tries = 0; tries < 9000 && got < want; tries++) {
      let x, z;
      // shore herbs search round the lakes, the rest anywhere
      if (k === 'herb_marsh' && r() < 0.85) { const L = LAKES[Math.floor(r() * LAKES.length)]; const a = r() * TAU, d = L.r * (0.75 + r() * 0.6); x = L.x + Math.cos(a) * d; z = L.z + Math.sin(a) * d; }
      else { x = (r() * 2 - 1) * 455; z = (r() * 2 - 1) * 455; }
      const h = heightAt(x, z), rw = realmWeightsAt(x, z);
      if (!ok(x, z) || !test[k](x, z, rw, h)) continue;
      // a few together, as herbs grow
      const n = 1 + Math.floor(r() * 3);
      for (let m = 0; m < n && got < want; m++) {
        const px = x + (r() - 0.5) * 2.4, pz = z + (r() - 0.5) * 2.4;
        if (m && (!ok(px, pz) || !test[k](px, pz, realmWeightsAt(px, pz), heightAt(px, pz)))) continue;
        FARM.herbs.push({ k, x: px, z: pz, y: heightAt(px, pz), seed: r(), s: 0.8 + r() * 0.45, regrow: 0, gone: 0, i: FARM.herbs.length });
        got++;
      }
    }
  }
}
// how a wild herb shows now: its season, and how far it has grown back after picking
function farmHerbGrowth(H) {
  const F = FARM_HERBS[H.k];
  const base = seasonBlend(F.show);
  if (H.gone > 0) return 0;
  return H.regrow > 0 ? Math.max(0.1, base * (1 - H.regrow / 480)) : base;
}
function farmStepHerbs(dt) {
  for (const H of FARM.herbs) {
    if (H.gone > 0) { H.gone = Math.max(0, H.gone - dt * FARM.speed); if (!H.gone) { H.regrow = 480; FARM.drawDirty = true; } }
    else if (H.regrow > 0) { H.regrow = Math.max(0, H.regrow - dt * FARM.speed * (H.k === 'herb_fire' && natGet(H.x, H.z, 1) > 0.1 ? 3 : 1)); }
  }
}
function farmHerbNear(x, z, r) {
  let best = null, bd = r * r;
  for (const H of FARM.herbs) { if (H.gone > 0) continue; const d = dist2(x, z, H.x, H.z); if (d < bd) { bd = d; best = H; } }
  return best;
}
function farmKnows(k) { return !!FARM.herbal.known[k]; }
function farmLearn(k, quiet = false) {
  if (!FARM_HERBS[k] || farmKnows(k)) return false;
  FARM.herbal.known[k] = { at: Math.round(GAME.prog ? GAME.prog.played : 0) };
  if (!quiet) {
    uiToast(`New in your herbal: ${GOODS[k].name}. ${FARM_HERBS[k].uses}`, 'quest');
    uiLog(`You learn ${GOODS[k].name}: ${FARM_HERBS[k].uses} It grows in ${FARM_HERBS[k].habitat.charAt(0).toLowerCase() + FARM_HERBS[k].habitat.slice(1)}`, 'sys');
    sfx('lootRare');
  }
  saveSoon();
  return true;
}
function farmGatherHerb(H, quiet = false) {
  if (!H || H.gone > 0 || farmHerbGrowth(H) < 0.25) return 0;
  const n = farmHerbGrowth(H) > 0.7 && Math.random() < 0.5 * H.s ? 2 : 1;
  const gathered = goodsAdd(H.k, n, quiet);
  if (gathered > 0) activityRecord('resource.gathered', H.k, gathered, { success: true });
  H.regrow = 480;
  FARM.drawDirty = true;
  return n;
}
function farmDigHerb(H, quiet = false) {
  if (!H || H.gone > 0) return null;
  const knife = goodsHave('tool_knife');
  const whole = knife || Math.random() < 0.55;
  const root = FARM_CROPS[H.k].seed;
  if (whole) goodsAdd(root, 1, quiet); else goodsAdd(H.k, 1, quiet);
  if (!quiet) uiLog(whole ? `You dig up the ${GOODS[H.k].name.toLowerCase()}, root and all. Plant it in a tilled bed.` : `The root snaps as you pull. You keep the leaves${knife ? '' : '; a knife would have lifted it whole'}.`, 'sys');
  H.gone = 900;
  FARM.drawDirty = true;
  return whole ? root : H.k;
}

/* ------------------------------------------------------------------ */
/* the land answers: fire, feet, craters, magic and grazing             */
/* ------------------------------------------------------------------ */
// fire in the grass burns what stands in a bed or a strip; the ash feeds the soil a little
function farmStepFire() {
  if (!NATURE.fire || !NATURE.fire.size) return;
  for (const P of FARM.plots) {
    let burnt = 0;
    const r = P.rad + 1;
    for (const c of NATURE.fireList) {
      const x = c.i - 511.5, z = c.j - 511.5;
      if (Math.abs(x - P.x) > r || Math.abs(z - P.z) > r) continue;
      const l = plotLocal(P, x, z);
      if (Math.abs(l.u) > P.hw + 0.5 || Math.abs(l.v) > P.hd + 0.5) continue;
      const s0 = plotSlotAt(P, x, z), i0 = s0 % P.cols, j0 = (s0 / P.cols) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= P.cols || j >= P.rows) continue;
        const s = j * P.cols + i;
        if (P.plants) { const pl = P.plants[s]; if (pl && !pl.char) { pl.char = 1; pl.dead = true; pl.hp = 0; burnt++; } }
        else if (P.dmg[s] < 2) { P.dmg[s] = 2; burnt++; }
      }
    }
    if (burnt) {
      P.char = 1; P.fert = Math.min(1, P.fert + 0.01 * burnt / Math.max(1, P.cols * P.rows / 24));
      if (P.stand && P.stand.phase === 'sown') { let left = 0; for (let q = 0; q < P.dmg.length; q++) if (P.valid[q] && P.dmg[q] < 2) left++; if (left < P.dmg.length * 0.15) { P.stand.dead = true; P.stand.hp = 0; } }
      FARM.drawDirty = true;
    }
  }
  for (const H of FARM.herbs) if (H.gone <= 0 && natGet(H.x, H.z, 2) > 0.3) { H.gone = 600; FARM.drawDirty = true; }
}
// feet in the crops: people, beasts and horses flatten what they walk through (not the farmers at their work)
function farmStepTrample() {
  const PL = GAME.player;
  if (!PL) return;
  for (const P of FARM.plots) {
    if (dist2(P.x, P.z, PL.x, PL.z) > 110 * 110) continue;
    forNear(P.x, P.z, P.rad + 1, (e) => {
      if (!e.alive || e.kind === 'door' || e.kind === 'dragon' || e.kind === 'wisp' || e.flying || e.role === 'critter') return;
      if (e.ai && e.ai.plan && e.ai.plan.steps && e.ai.plan.steps[e.ai.plan.i] && e.ai.plan.steps[e.ai.plan.i].k === 'farm') return;
      if (e === PL && FARM.job) return;
      const moved = Math.abs(e.x - (e._fx ?? e.x)) + Math.abs(e.z - (e._fz ?? e.z));
      e._fx = e.x; e._fz = e.z;
      if (moved < 0.05) return;
      const l = plotLocal(P, e.x, e.z);
      if (Math.abs(l.u) > P.hw || Math.abs(l.v) > P.hd) return;
      // between the rows a careful foot does little; across them, a lot
      const s = plotSlotAt(P, e.x, e.z);
      const heavy = e.mount || e.kind === 'bear' || e.kind === 'horse' ? 0.55 : 0.28;
      const [su] = slotUV(P, s);
      const onRow = 1 - clamp(Math.abs(l.u - su) / (FARM_SP * 0.5), 0, 1);
      const k = heavy * (0.35 + 0.65 * onRow);
      if (P.plants) {
        const pl = P.plants[s];
        if (pl && !pl.dead && pl.g > 0.06) { pl.trod = Math.min(1, (pl.trod || 0) + k); if (pl.g > 0.5 && pl.trod > 0.7) pl.hp = Math.max(0, pl.hp - 0.05); FARM.drawDirty = true; if (e === PL && !FARM.trodWarned) { FARM.trodWarned = true; uiToast('You are trampling the crop. Walk between the beds.', 'hint'); } }
      } else if (P.stand.phase === 'sown' && P.valid[s] && P.dmg[s] === 0 && k > 0.25) { P.dmg[s] = 1; FARM.drawDirty = true; }
    });
  }
}
// craters churn a bed: what stood there is lost and the soil is laid again
function farmStepCraters() {
  const C = NATURE.craters || [];
  if (C.length === FARM.lastCraters) return;
  for (let i = Math.min(FARM.lastCraters, C.length); i < C.length; i++) {
    const cr = C[i];
    for (const P of FARM.plots) {
      if (dist(cr.x, cr.z, P.x, P.z) > P.rad + cr.r * 1.75) continue;
      if (P.plants) P.plants.forEach((pl, s) => { if (!pl) return; const p = slotPos(P, s); if (dist(p.x, p.z, cr.x, cr.z) < cr.r * 1.3) P.plants[s] = null; });
      else for (let s = 0; s < P.dmg.length; s++) { const p = slotPos(P, s); if (dist(p.x, p.z, cr.x, cr.z) < cr.r * 1.3) P.dmg[s] = 2; }
      FARM.soilDirty = true; FARM.drawDirty = true;
    }
  }
  FARM.lastCraters = C.length;
}
// for other systems: growth magic quickens the plants in reach; grazing beasts eat them (returns how much they ate)
function farmGrowAt(x, z, r, amount = 0.1) {
  let n = 0;
  for (const P of FARM.plots) {
    if (dist(x, z, P.x, P.z) > P.rad + r) continue;
    if (P.plants) P.plants.forEach((pl, s) => { if (!pl || pl.dead) return; const p = slotPos(P, s); if (dist(p.x, p.z, x, z) < r) { pl.g = Math.min(1, pl.g + amount); pl.hp = Math.min(1, pl.hp + amount); n++; } });
    else if (P.stand.phase === 'sown') { P.stand.g = Math.min(1, P.stand.g + amount * 0.5); n++; }
  }
  for (const H of FARM.herbs) if (H.regrow > 0 && dist(x, z, H.x, H.z) < r) { H.regrow = Math.max(0, H.regrow - 480 * amount * 2); n++; }
  if (n) FARM.drawDirty = true;
  return n;
}
function farmEatAt(x, z, r = 0.8, bites = 1) {
  let food = 0;
  for (const P of FARM.plots) {
    if (dist(x, z, P.x, P.z) > P.rad + r) continue;
    if (P.plants) P.plants.forEach((pl, s) => { if (!pl || pl.dead || pl.g < 0.15 || bites <= 0) return; const p = slotPos(P, s); if (dist(p.x, p.z, x, z) < r) { const k = Math.min(pl.g, 0.3); pl.g -= k; food += k; bites--; if (pl.g < 0.06) P.plants[s] = null; } });
    else if (P.stand.phase === 'sown' && P.stand.g > 0.15) { const s = plotSlotAt(P, x, z); if (P.valid[s] && P.dmg[s] === 0) { P.dmg[s] = 1; food += 0.3; } }
  }
  if (food) FARM.drawDirty = true;
  return food;
}

/* ------------------------------------------------------------------ */
/* per step                                                            */
/* ------------------------------------------------------------------ */
function updateFarming(dt) {
  if (!FARM.built) return;
  if (typeof netWorldPartsCanSimulate === 'function' && !netWorldPartsCanSimulate()) {
    stepFarmJob(dt); farmNotices(dt); return;
  }
  const before = SEASON.idx;
  SEASON.t += dt * FARM.speed;
  seasonCalc();
  if (SEASON.idx !== before) farmSeasonTurns();
  const C = FARM.clock;
  // the farmers among the townsfolk (again if they fell)
  C.farmers = (C.farmers || 0) - dt;
  if (C.farmers <= 0) { C.farmers = 20; if (FARM.farmers.map(getEnt).filter((e) => e && e.alive).length < 4) farmAssignFarmers(); }
  C.grow += dt;
  if (C.grow >= 0.5) { farmStepPlots(C.grow); farmStepHerbs(C.grow); C.grow = 0; }
  C.town += dt;
  if (C.town >= 1) { farmStepTown(C.town); C.town = 0; }
  C.trod -= dt;
  if (C.trod <= 0) { C.trod = 0.25; farmStepTrample(); farmStepFire(); farmStepCraters(); }
  stepFarmJob(dt);
  farmNotices(dt);
}
const SEASON_ADVICE = [
  'The ground warms: time to till and sow. Late frosts can still bite tender crops at night.',
  'Long warm days. Crops grow fastest now, and so do the weeds; a dry spell will parch the beds.',
  'Harvest what is ripe before it sheds. Hardy crops and winter grain can still go in.',
  'Hard frosts kill tender crops and little grows. Let the soil rest, or spread manure for spring.',
];
function farmSeasonTurns() {
  if (SEASON.announced === SEASON.idx) return;
  SEASON.announced = SEASON.idx;
  if (!GAME.started) return;
  uiBanner(`${SEASON.name} comes to the March`);
  uiLog(`${SEASON.name}. ${SEASON_ADVICE[SEASON.idx]}`, 'sys');
  saveSoon();
}
// a word to the player the first time something matters
function farmNotices(dt) {
  const P = GAME.player;
  if (!P || !GAME.started || UI.modal || guideQuiet()) return; // [guide] not over a new character's first steps
  const tips = FARM.herbal;
  const tip = (bit, text, note) => { if (tips.tips & bit) return; tips.tips |= bit; if (note && FIELD_NOTES[note]) loreNote(note); else uiToast(text, 'hint'); saveSoon(); }; // [guide2] a field note where there is one (10f_guide2.js): it was a toast
  if (!(tips.tips & 1)) {
    const fieldNear = FARM.plots.some((Q) => Q.own === 't' && dist2(Q.x, Q.z, P.x, P.z) < 30 * 30);
    const farmer = FARM.farmers.map(getEnt).find((e) => e && e.alive && e.ai.seedSeller && dist2(e.x, e.z, P.x, P.z) < 14 * 14);
    if (fieldNear || farmer) tip(1, `The farmers ${farmer ? 'here' : 'of the town'} sell seed and hoes. Till a bed of meadow (E), sow it, keep it weeded and watered by the rain, and harvest it when it is ripe. The Chronicle's Fields page tells more.`, 'farmers');
  }
  for (const Q of FARM.plots) {
    if (Q.own !== 'p' || Q.ripeNoted) continue;
    if (Q.plants.some((pl) => pl && !pl.dead && pl.g >= 1)) { Q.ripeNoted = true; if (dist2(Q.x, Q.z, P.x, P.z) < 120 * 120) uiLog('A bed of yours is ripe. Harvest it before it sheds, or keep the seed of its best plant.', 'sys'); tip(2, 'A bed is ripe. Look at the plants: the plant card shows each one\'s traits. Keep the seed of the best, and your strain grows better each year.', 'ripe'); }
  }
  if (!(tips.tips & 4)) { const H = farmHerbNear(P.x, P.z, 6); if (H && !farmKnows(H.k)) tip(4, 'An unfamiliar plant grows nearby. Examine it (E) to learn it for your herbal.', 'herb'); }
}

/* ------------------------------------------------------------------ */
/* the player's work                                                   */
/* ------------------------------------------------------------------ */
const FARM_JOBS = {
  till: { label: 'Tilling', act: 8, dur: 0.95, gap: 1.0 },
  tillHand: { label: 'Turning the soil by hand', act: 5, dur: 0.7, gap: 0.8 },
  sow: { label: 'Sowing', act: 5, dur: 0.6, gap: 0.75 },
  weed: { label: 'Pulling the weeds', act: 5, dur: 0.6, gap: 0.7 },
  harvest: { label: 'Harvesting', act: 1, dur: 0.62, gap: 0.8 },
  saveseed: { label: 'Keeping the seed', act: 5, dur: 0.6, gap: 0.75 },
  clear: { label: 'Clearing the dead plants', act: 5, dur: 0.6, gap: 0.7 },
  manure: { label: 'Spreading manure', act: 5, dur: 0.6, gap: 0.75 },
  study: { label: 'Examining the plant', act: 5, dur: 0.9, gap: 1.2 },
  gather: { label: 'Gathering', act: 5, dur: 0.6, gap: 0.7 },
  dig: { label: 'Digging up the root', act: 5, dur: 0.6, gap: 0.75 },
};
function farmStartJob(kind, o = {}) {
  const P = GAME.player;
  if (!P || !P.alive) return;
  if (P.mount) dismount(P);
  if (NATURE.job) natureStopJob(null);
  const J = FARM_JOBS[kind];
  let tx = o.x ?? P.x + Math.sin(P.yaw), tz = o.z ?? P.z + Math.cos(P.yaw);
  const yaw = Math.abs(tx - P.x) + Math.abs(tz - P.z) > 0.2 ? Math.atan2(tx - P.x, tz - P.z) : P.yaw;
  const need = o.need || { till: 6, tillHand: 14, sow: 3, weed: 4, harvest: 5, saveseed: 2, clear: 3, manure: 3, study: 2, gather: 2, dig: goodsHave('tool_knife') ? 3 : 6 }[kind] || 3;
  FARM.job = { kind, ...o, px: P.x, pz: P.z, yaw, t: 0, next: 0.12, hitAt: 0, swings: 0, need, label: o.label || J.label };
  P.yaw = yaw; P.target = null;
}
function farmStopJob(msg) { FARM.job = null; if (msg) uiLog(msg, 'sys'); }
function stepFarmJob(dt) {
  const J = FARM.job;
  if (!J) return;
  const P = GAME.player;
  if (!P || !P.alive || P.casting || P.mount || P.motion || dist(P.x, P.z, J.px, J.pz) > 0.3) { farmStopJob(P && P.alive ? 'You stop working.' : null); return; }
  const D = FARM_JOBS[J.kind];
  J.t += dt;
  P.yaw = J.yaw;
  if (J.t >= J.next && !J.hitAt) { J.next = J.t + D.gap; setAct(P, D.act, D.dur); J.hitAt = J.t + D.dur * 0.55; if (D.act !== 5) sfx('swing'); }
  if (J.hitAt && J.t >= J.hitAt) {
    J.hitAt = 0;
    J.swings++;
    const fx = P.x + Math.sin(J.yaw) * 1.1, fz = P.z + Math.cos(J.yaw) * 1.1;
    farmWorkFx(J.kind, fx, fz, J.plot && J.plot.plants ? FARM_CROPS[(J.plot.plants.find((q) => q) || {}).crop] : null);
    if (J.swings >= J.need) { const k = J.kind; FARM.job = null; farmFinishJob(k, J); }
  }
}
function farmFinishJob(kind, J) {
  if (kind !== 'study' && typeof netWorldPartsRequest === 'function') {
    const cost = kind === 'sow' && J.gid ? [[J.gid, goodsCount(J.gid)]] : kind === 'manure' ? [['manure', 1]] : [];
    if (netWorldPartsRequest('farm.job', { kind, plot: J.plot ? { x: J.plot.x, z: J.plot.z } : null,
      slot: J.slot, gid: J.gid, herb: J.herb && J.herb.i }, cost)) return;
  }
  const P = J.plot;
  if (kind === 'till' || kind === 'tillHand') {
    const spot = farmTillSpot(GAME.player);
    if (spot.why) { uiError(spot.why); return; }
    const Q = farmAddPlot({ own: 'p', x: spot.x, z: spot.z, ang: spot.ang, cols: spot.cols, rows: spot.rows, fert: 0.8, moist: 0.4 + 0.3 * (WEATHER.wet || 0) });
    natureCut(Q.x, Q.z, Q.rad + 0.4, 1, true);
    uiLog('You till a bed. Sow it from your seed (E), or plant a herb root in it.', 'sys');
    saveSoon();
  } else if (kind === 'sow') {
    const n = farmSow(P, J.gid);
    const S = farmStrainOfGood(J.gid);
    uiLog(n ? `You sow ${n} ${S && FARM_CROPS[S.crop].herb ? 'roots' : 'plants\' worth'} of ${GOODS[J.gid].name.toLowerCase()}.` : 'You have no seed of that kind left.', 'sys');
    saveSoon();
  } else if (kind === 'weed') {
    const w = P.weeds;
    P.weeds = 0;
    if (w > 0.5 && Math.random() < 0.7) goodsAdd('fibre', 1, true);
    uiLog('You pull the weeds and throw them on the path.', 'sys');
    FARM.drawDirty = true;
  } else if (kind === 'harvest') farmHarvest(P);
  else if (kind === 'saveseed') farmSaveSeed(P, J.slot);
  else if (kind === 'clear') { P.plants.forEach((pl, s) => { if (pl && pl.dead) P.plants[s] = null; }); FARM.drawDirty = true; uiLog('You clear the dead plants from the bed.', 'sys'); }
  else if (kind === 'manure') { if (goodsTake('manure', 1)) { P.fert = Math.min(1, P.fert + 0.35); P.manure = 1; uiLog('You spread manure on the bed. The soil will be rich again.', 'sys'); FARM.drawDirty = true; } }
  else if (kind === 'study') { const H = J.herb; if (H) { farmLearn(H.k); FARM.cardOpen = true; } }
  else if (kind === 'gather') { const n = farmGatherHerb(J.herb); if (!n) uiError('There is nothing left on it to gather.'); }
  else if (kind === 'dig') farmDigHerb(J.herb);
  FARM.drawDirty = true;
}
// earth, seed and leaves fly as the work is done
function farmWorkFx(kind, x, z, C) {
  if (dist2(x, z, camera.position.x, camera.position.z) > 60 * 60) return;
  const y = heightAt(x, z) + 0.12;
  const soil = [0.26, 0.19, 0.13], green = [0.3, 0.42, 0.14], gold = C && C.ripeCover ? C.ripeCover : [0.78, 0.64, 0.3];
  const col = kind === 'till' || kind === 'tillHand' || kind === 'dig' || kind === 'manure' ? soil : kind === 'harvest' || kind === 'saveseed' ? gold : kind === 'sow' ? [0.82, 0.74, 0.5] : green;
  const n = kind === 'till' ? 14 : kind === 'sow' ? 10 : 8;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = kind === 'sow' ? 1.8 : 1.2;
    fxAlpha.emit(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, Math.cos(a) * sp * Math.random(), 1.2 + Math.random() * 1.6, Math.sin(a) * sp * Math.random(), 0.7 + Math.random() * 0.4, col[0], col[1], col[2], kind === 'sow' ? 0.025 : 0.05 + Math.random() * 0.04, 9, 1.2);
  }
  if (kind === 'till') FX.dust(x, y - 0.1, z, 4, [0.4, 0.33, 0.24]);
  if (kind === 'till' || kind === 'harvest' || kind === 'dig') natSfx(kind === 'harvest' ? 'split' : 'chop', x, z);
}

/* ------------------------------------------------------------------ */
/* what the player can do here: the plant card and the E prompt        */
/* ------------------------------------------------------------------ */
function farmSeedLots(herbOnly = null) {
  const out = [];
  for (const id in INV.goods || {}) {
    if (!(INV.goods[id] > 0)) continue;
    const S = farmStrainOfGood(id);
    if (!S) continue;
    const C = FARM_CROPS[S.crop];
    if (herbOnly !== null && C.herb !== herbOnly) continue;
    out.push({ id, S, n: INV.goods[id] });
  }
  // the last lot sown first, then the kept strains before the common ones
  out.sort((a, b) => (b.id === FARM.lastSeed) - (a.id === FARM.lastSeed) || (a.S.common - b.S.common) || a.S.crop.localeCompare(b.S.crop) || b.S.gen - a.S.gen);
  return out;
}
const farmHasTools = () => goodsHave('tool_hoe') || farmSeedLots().length > 0;
// what the player stands at or looks at
function farmContext(PL) {
  if (!FARM.built || !PL || !PL.alive || inDungeon(PL) || PL.carrying != null || PL.mount) return null;
  const fx = Math.sin(PL.yaw), fz = Math.cos(PL.yaw);
  const lx = PL.x + fx * 1.1, lz = PL.z + fz * 1.1;
  const H = farmHerbNear(PL.x + fx * 0.6, PL.z + fz * 0.6, 1.9);
  if (H && dist(PL.x, PL.z, H.x, H.z) < 2.2) return { type: 'herb', H };
  const P = plotAt(lx, lz, 0.3) || plotAt(PL.x, PL.z, 0.2);
  if (P) {
    const pp = plotLocal(P, lx, lz);
    const s = plotSlotAt(P, lx, lz);
    return { type: P.own === 't' ? 'strip' : 'plot', P, s, inside: Math.abs(pp.u) <= P.hw && Math.abs(pp.v) <= P.hd };
  }
  const nearOwn = FARM.plots.some((Q) => Q.own === 'p' && dist2(Q.x, Q.z, PL.x, PL.z) < 9 * 9);
  if (!(farmHasTools() || nearOwn)) return null;
  const T = farmTillSpot(PL);
  return { type: 'till', T };
}
// the actions for the card, the first is the one E does
function farmActions(ctx) {
  const A = [];
  if (!ctx) return A;
  if (ctx.type === 'herb') {
    const H = ctx.H, G = GOODS[H.k], g = farmHerbGrowth(H);
    if (!farmKnows(H.k)) A.push(['study', 'Examine the plant']);
    else {
      if (g >= 0.25 && H.regrow <= 0) A.push(['gather', `Gather ${G.name.toLowerCase()}`]);
      A.push(['dig', goodsHave('tool_knife') ? 'Dig up the root (knife)' : 'Dig up the root by hand']);
    }
  } else if (ctx.type === 'plot') {
    const P = ctx.P, pl = P.plants[ctx.s];
    const ripe = P.plants.some((q) => q && !q.dead && q.g >= 1), dead = P.plants.some((q) => q && q.dead), empty = P.plants.some((q) => !q);
    if (ripe) A.push(['harvest', 'Harvest the bed']);
    if (pl && !pl.dead && pl.g >= 1) A.push(['saveseed', 'Keep the seed of this plant']);
    if (P.weeds > 0.22) A.push(['weed', 'Pull the weeds']);
    if (dead) A.push(['clear', 'Clear the dead plants']);
    if (empty && !ripe) {
      const lots = farmSeedLots();
      for (const L of lots.slice(0, 4)) A.push(['sow:' + L.id, `Sow ${goodName(L.id, 2).toLowerCase()} (${L.n})`]);
      if (!lots.length) A.push(['noseed', 'You have no seed to sow']);
    }
    if (P.fert < 0.85 && goodsHave('manure')) A.push(['manure', 'Spread manure']);
    if (!P.plants.some((q) => q && !q.dead)) A.push(['flatten', 'Let the bed go back to grass']);
  } else if (ctx.type === 'till') {
    if (!ctx.T.why) A.push(['till', goodsHave('tool_hoe') ? 'Till a bed here' : 'Till a bed here by hand']);
  }
  return A;
}
function farmDo(act) {
  const PL = GAME.player, ctx = FARM.ctx;
  if (!PL || !ctx) return;
  const [kind, arg] = act.split(':');
  const P = ctx.P;
  const at = P ? slotPos(P, ctx.s || 0) : ctx.H ? { x: ctx.H.x, z: ctx.H.z } : null;
  if (kind === 'till') { const T = farmTillSpot(PL); if (T.why) { uiError(T.why); return; } farmStartJob(goodsHave('tool_hoe') ? 'till' : 'tillHand', { x: T.x, z: T.z }); }
  else if (kind === 'sow') { if (!goodsHave(arg)) { uiError('You have none of that seed left'); return; } FARM.lastSeed = arg; farmStartJob('sow', { plot: P, gid: arg, x: P.x, z: P.z }); }
  else if (kind === 'noseed') uiError('Buy seed from a farmer, or dig up a wild herb to plant');
  else if (kind === 'flatten') { farmRemovePlot(P); uiLog('You let the bed go back to grass.', 'sys'); FARM.ctx = null; saveSoon(); }
  else if (kind === 'saveseed') farmStartJob('saveseed', { plot: P, slot: ctx.s, x: at.x, z: at.z });
  else if (['harvest', 'weed', 'clear', 'manure'].includes(kind)) farmStartJob(kind, { plot: P, x: at.x, z: at.z });
  else if (['study', 'gather', 'dig'].includes(kind)) farmStartJob(kind, { herb: ctx.H, x: at.x, z: at.z });
}
// the E prompt (09_player.js asks every frame)
function farmOffers(PL, offer) {
  if (!FARM.built) return;
  for (const id of FARM.farmers) {
    const e = getEnt(id);
    if (e && e.alive && e.ai.seedSeller) offer(dist(PL.x, PL.z, e.x, e.z), 3.2, `Buy seed and tools from ${e.name} the farmer`, () => openFarmer(e), 0.2);
  }
  if (FARM.job) return;
  const ctx = FARM.ctx, A = farmActions(ctx);
  if (!A.length || A[0][0] === 'noseed') return;
  const d = ctx.type === 'herb' ? dist(PL.x, PL.z, ctx.H.x, ctx.H.z) : ctx.type === 'till' ? 1.6 : 1.0;
  offer(Math.max(0.1, d), ctx.type === 'herb' ? 2.4 : 3, A[0][1], () => farmDo(A[0][0]), ctx.type === 'till' ? -0.4 : 0);
}
// the cast bar while working (10_ui.js)
function farmCastBar() {
  const J = FARM.job;
  if (!J) return false;
  $('castbar').classList.add('on');
  setT($('cast-n'), J.label); setT($('cast-t'), `${J.swings} / ${J.need}`); setW($('cast-b'), J.swings / J.need);
  return true;
}

/* ------------------------------------------------------------------ */
/* the farmer: seed, tools and a fair price for produce                */
/* ------------------------------------------------------------------ */
const FARM_SHOP = [['seed_grain', 12, 2], ['seed_flax', 12, 2], ['seed_beans', 12, 2], ['seed_cabbage', 12, 3], ['seed_turnip', 12, 2], ['manure', 3, 2], ['tool_hoe', 1, 8], ['tool_knife', 1, 6]];
const FARM_SELL = { grain: 1, flax: 1, cabbage: 2, turnip: 1, beans: 1, thatch: 1 };
function openFarmer(e) {
  const PL = GAME.player, R = REALMS[e.farmTown ?? 0];
  UI.modal = 'dialog';
  $('dialog').hidden = false;
  $('dlg-title').textContent = `${e.name}, farmer of ${R.townName}`;
  const sellable = Object.keys(FARM_SELL).filter((id) => goodsCount(id) > 0);
  const worth = sellable.reduce((a, id) => a + goodsCount(id) * FARM_SELL[id], 0);
  const gran = Object.keys(FARM.granary).filter((k) => FARM.granary[k] > 0).map((k) => `${fmtInt(FARM.granary[k])} ${goodName(k, 2).toLowerCase()}`).join(', ');
  $('dlg-body').innerHTML = `<p>${SEASON.idx === 3 ? 'Nothing much grows in the cold, friend.' : SEASON.idx === 0 ? 'Good sowing weather.' : SEASON.idx === 1 ? 'Keep your beds weeded and pray for rain.' : 'Harvest time. Mind the first frosts.'} Till a bed of meadow with a hoe, sow it, and keep it weeded. Rain waters it; a dry spell parches it and a hard frost kills the tender crops. A bed that gives harvest after harvest grows tired: rest it, sow beans in it, or spread manure.</p>
    <p>If you want better seed, keep the seed of your best plant when it is ripe and sow that. Plants in flower side by side cross, so a strong strain sown beside a hardy one may give you both.</p>
    <p class="fineprint">You have ${fmtInt(INV.gold)} gold.${gran ? ` ${R.townName}'s granary holds ${gran}.` : ''}</p>`;
  const box = $('dlg-actions');
  box.innerHTML = '';
  const add = (label, fn, primary) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = fn; box.appendChild(b); };
  for (const [id, n, price] of FARM_SHOP) {
    add(`${n > 1 ? n + ' ' : ''}${goodName(id, n)} · ${price} gold`, () => {
      if (INV.gold < price) { uiError('You cannot afford that'); return; }
      INV.gold -= price; goodsAdd(id, n); sfx('coins'); saveSoon(); openFarmer(e);
    });
  }
  if (worth > 0) add(`Sell your produce · ${worth} gold`, () => { for (const id of sellable) goodsTake(id, goodsCount(id)); addGold(worth); uiLog(`${e.name} buys your produce for ${worth} gold.`, 'loot'); openFarmer(e); });
  add('Farewell', closeDialog, true);
  if (PL) turnToward(e, PL.x, PL.z, 3);
}

/* ------------------------------------------------------------------ */
/* the plant card                                                      */
/* ------------------------------------------------------------------ */
function farmPips(v, n = 5) { const k = Math.round(clamp(v, 0, 1) * n); return '<span class="pips">' + '●'.repeat(k) + '<i>' + '●'.repeat(n - k) + '</i></span>'; }
// what an eye can judge of a plant's traits: near the truth, never exact
function farmSeen(pl, k) { return clamp(pl.tr[k] + (hash2(pl.nz, FARM_TR.indexOf(k) * 7 + 3) - 0.5) * 0.16, 0, 1); }
function farmSoilWords(P) {
  const f = P.fert < 0.3 ? 'worn out: rest it, sow beans or spread manure' : P.fert < 0.55 ? 'tiring' : P.fert < 0.8 ? 'good' : 'rich';
  const m = P.moist < 0.06 ? 'parched' : P.moist < 0.2 ? 'dry' : P.moist < 0.75 ? 'damp' : 'soaked';
  const w = P.weeds > 0.6 ? 'choked with weeds' : P.weeds > 0.22 ? 'weedy' : 'clean';
  return `Soil ${f} · ${m} · ${w}`;
}
function farmCardHTML(ctx) {
  if (!ctx) return '';
  const A = farmActions(ctx);
  const btns = A.map(([a, l], i) => `<button type="button" class="btn${i === 0 ? ' primary' : ''}" data-farm="${esc(a)}"${a === 'noseed' ? ' disabled' : ''}>${i === 0 && !IS_TOUCH ? '<kbd>E</kbd>' : ''}${esc(l)}</button>`).join('');
  let h = '';
  if (ctx.type === 'herb') {
    const H = ctx.H, known = farmKnows(H.k), F = FARM_HERBS[H.k], G = GOODS[H.k], g = farmHerbGrowth(H);
    if (!known) h = `<b class="fc-t">An unfamiliar plant</b><p>You do not know this one. Examine it to learn its name and uses for your herbal.</p>`;
    else h = `<b class="fc-t" style="--hc:${F.col}">${esc(G.name)}</b><p>${esc(F.uses)}</p><p class="fc-dim">${H.regrow > 0 ? 'Picked; growing back' : g < 0.45 ? 'Dormant for the season' : g > 0.9 ? 'Gone to seed' : 'In good leaf'}. ${esc(F.habitat)}</p>`;
  } else if (ctx.type === 'till') {
    const T = ctx.T;
    h = `<b class="fc-t">Meadow</b><p>${T.why ? esc(T.why) + '.' : `Room for a bed of ${T.cols * T.rows} plants.${goodsHave('tool_hoe') ? '' : ' Without a hoe it is slow work; farmers sell them.'}`}</p>`;
  } else if (ctx.type === 'strip') {
    const P = ctx.P, T = P.stand, C = FARM_CROPS[T.crop];
    const R = REALMS[0];
    const state = T.phase === 'sown' ? (T.dead ? 'lost' : farmStage(T.g).toLowerCase()) : T.phase === 'tilled' ? 'tilled, waiting for seed' : T.phase === 'stubble' ? 'stubble after the harvest' : 'resting';
    const task = T.task ? ` · being ${T.task === 'till' ? 'tilled' : T.task === 'sow' ? 'sown' : T.task === 'weed' ? 'weeded' : 'harvested'} (${Math.round(T.p * 100)}%)` : '';
    h = `<b class="fc-t">${esc(R.townName)}'s ${T.phase === 'sown' ? esc(C.name.toLowerCase()) : 'field'}</b><p>${esc(state.charAt(0).toUpperCase() + state.slice(1))}${task}.</p><p class="fc-dim">${esc(farmSoilWords(P))}. The townsfolk tend it; walk on the balks between the strips.</p>`;
  } else if (ctx.type === 'plot') {
    const P = ctx.P, pl = P.plants[ctx.s];
    if (!pl) h = `<b class="fc-t">${P.plants.some((q) => q) ? 'An empty slot' : 'A tilled bed'}</b><p>${esc(farmSoilWords(P))}.</p>`;
    else {
      const C = FARM_CROPS[pl.crop], S = FARM.strains[pl.st] || FARM.strains['c_' + pl.crop];
      const state = pl.dead ? (pl.char ? 'Burnt' : pl.hp <= 0 && P.moist < 0.08 ? 'Dead of drought' : pl.ripeT > 1700 ? 'Rotted where it stood' : 'Dead') : pl.g >= 1 ? (pl.ripeT > 700 ? 'Over-ripe: shedding' : 'Ripe') : farmStage(pl.g);
      const pol = pl.pol ? (pl.pol.self ? 'set its own seed' : `pollen from ${esc((FARM.strains[pl.pol.st] || { name: 'a neighbour' }).name.toLowerCase())}`) : pl.g < 0.72 ? 'not yet in flower' : '';
      const hue = C.hue[farmSeen(pl, 'c') > 0.5 ? 1 : 0];
      h = `<b class="fc-t">${esc(S.name)}</b><p>${esc(state)}${pl.dead ? '' : ` · ${Math.round(Math.min(1, pl.g) * 100)}% grown · health ${Math.round(pl.hp * 100)}%`}${pl.trod > 0.4 ? ' · trampled' : ''}${pl.bite > 0.5 ? ' · frost-bitten' : ''}${pl.wilt > 0.4 ? ' · wilting' : ''}</p>
        <div class="fc-tr">${['y', 'h', 'd', 'sp', 'ht'].map((k) => `<span>${FARM_TR_NAME[k]}</span>${farmPips(farmSeen(pl, k))}`).join('')}<span>Colour</span><span class="fc-hue">${esc(hue)}</span></div>
        <p class="fc-dim">Seed of ${esc(S.common ? S.name.toLowerCase() : S.name)}${S.gen ? `, generation ${S.gen}` : ''}${pol ? '; ' + pol : ''}. ${esc(farmSoilWords(P))}.</p>`;
    }
  }
  return `<div class="fc-body">${h}</div>${btns ? `<div class="fc-acts">${btns}</div>` : ''}`;
}
function farmUpdateCard(dt) {
  const el = FARM.cardEl;
  if (!el) return;
  const C = FARM.clock;
  C.ui -= dt;
  if (C.ui > 0) return;
  C.ui = 0.2;
  const PL = GAME.player;
  // (cardForce: a test hook that keeps the card up while the world is paused for a picture)
  const open = GAME.started && (!UI.modal || FARM.cardForce);
  FARM.ctx = open && !FARM.job ? farmContext(PL) : FARM.job ? FARM.ctx : null;
  const nearOwn = PL && FARM.plots.some((Q) => Q.own === 'p' && dist2(Q.x, Q.z, PL.x, PL.z) < 9 * 9);
  const show = FARM.ctx && open && !(FARM.ctx.type === 'till' && FARM.ctx.T.why && !nearOwn);
  const html = show ? farmCardHTML(FARM.ctx) : '';
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
  el.classList.toggle('on', !!html);
}

/* ------------------------------------------------------------------ */
/* the Chronicle: the fields and the herbal                            */
/* ------------------------------------------------------------------ */
function farmHerbSketch(k, known) {
  const F = FARM_HERBS[k], c = known ? F.col : '#6a6458', g = known ? '#5f8a3a' : '#4a4a40';
  const shapes = {
    herb_heal: `<path d="M24 46V12" stroke="${g}" stroke-width="2"/><path d="M24 34c-6-1-10-4-11-8 5 0 9 3 11 8zM24 34c6-1 10-4 11-8-5 0-9 3-11 8zM24 25c-5-1-8-3-9-7 4 0 7 3 9 7zM24 25c5-1 8-3 9-7-4 0-7 3-9 7z" fill="${g}"/><g fill="${c}"><circle cx="24" cy="9" r="2.6"/><circle cx="21" cy="13" r="2.2"/><circle cx="27" cy="13" r="2.2"/><circle cx="24" cy="16" r="2"/></g>`,
    herb_mana: `<path d="M10 44c4-6 10-8 14-8s10 2 14 8" fill="${g}"/><path d="M24 40V22M16 40l-3-12M32 40l3-12" stroke="${g}" stroke-width="1.6"/><g fill="${c}"><path d="M24 14l2 5 5 .4-4 3 1.4 5-4.4-3-4.4 3 1.4-5-4-3 5-.4z"/><circle cx="13" cy="27" r="3"/><circle cx="35" cy="27" r="3"/></g>`,
    herb_fire: `<g fill="#d8c8a8"><rect x="14" y="30" width="4" height="14" rx="2"/><rect x="26" y="26" width="5" height="18" rx="2"/><rect x="35" y="34" width="3" height="10" rx="1.5"/></g><g fill="${c}"><path d="M8 31a8 6 0 0 1 16 0z"/><path d="M19 27a10 8 0 0 1 19 0z"/><path d="M31 35a6 5 0 0 1 11 0z"/></g><g fill="#ffd27a"><circle cx="26" cy="22" r="1.2"/><circle cx="31" cy="24" r="1"/><circle cx="14" cy="28" r="1"/></g>`,
    herb_frost: `<g fill="${known ? '#9fc4d4' : '#5a5a52'}"><path d="M24 44c-2-10-1-20 0-30 1 10 2 20 0 30z"/><path d="M24 44c-8-6-12-14-14-22 6 5 11 12 14 22z"/><path d="M24 44c8-6 12-14 14-22-6 5-11 12-14 22z"/><path d="M24 44c-10-2-16-8-19-14 7 2 13 7 19 14z"/><path d="M24 44c10-2 16-8 19-14-7 2-13 7-19 14z"/></g><g stroke="${c}" stroke-width="1.2"><path d="M24 10v6M21 13h6M12 20l3 3M36 20l-3 3"/></g>`,
    herb_storm: `<path d="M24 46V18" stroke="${g}" stroke-width="2.2"/><path d="M24 38l-9-5 4-1-5-4 6 1M24 30l9-5-4-1 5-4-6 1" stroke="${g}" stroke-width="1.6" fill="none"/><circle cx="24" cy="13" r="6" fill="${c}"/><path d="M24 4v3M17 7l2 2M31 7l-2 2M15 13h2M31 13h2" stroke="${c}" stroke-width="1.4"/>`,
    herb_marsh: `<g fill="${g}"><path d="M20 46c-2-12-1-24 2-34 1 12 0 24-2 34z"/><path d="M26 46c0-12 3-22 8-30-2 12-4 22-8 30z"/><path d="M16 46c-3-8-6-14-10-20 5 4 8 10 10 20z"/></g><g fill="${c}"><circle cx="30" cy="12" r="2.8"/><circle cx="34" cy="15" r="2.4"/><circle cx="27" cy="16" r="2.4"/><circle cx="31" cy="19" r="2"/></g>`,
    herb_moon: `<g stroke="${known ? '#8fc4b8' : '#5a5a52'}" stroke-width="1.4" fill="none"><path d="M24 46c-2-12-8-22-16-28"/><path d="M24 46c2-12 8-22 16-28"/><path d="M24 46V10"/></g><g stroke="${c}" stroke-width="1.2"><path d="M21 38l-4-2M19 32l-5-2M15 26l-4-1M27 38l4-2M29 32l5-2M33 26l4-1M24 34l-4-2M24 28l4-2M24 22l-4-2M24 16l4-2"/></g>`,
    herb_stone: `<path d="M6 44c0-10 8-16 18-16s18 6 18 16z" fill="${known ? '#6e7f52' : '#4a4a40'}"/><g fill="${c}"><circle cx="14" cy="36" r="1.8"/><circle cx="20" cy="32" r="1.8"/><circle cx="27" cy="31" r="1.8"/><circle cx="33" cy="35" r="1.8"/><circle cx="24" cy="38" r="1.8"/><circle cx="17" cy="41" r="1.6"/><circle cx="31" cy="41" r="1.6"/></g>`,
  };
  return `<svg viewBox="0 0 48 48" aria-hidden="true">${shapes[k]}</svg>`;
}
// a grain plant at each stage on its ridge, for the Fields page
function farmStagesSketch() {
  const names = ['Sprouting', 'In leaf', 'Heading', 'In flower', 'Ripening', 'Ripe'];
  let g = '<svg viewBox="0 0 372 112" role="img" aria-label="A grain plant at each stage, from sprouting to ripe"><rect width="372" height="112" rx="6" fill="#171a16"/>';
  let ridge = 'M0,84';
  for (let x = 0; x <= 372; x += 31) ridge += ` Q${x + 15.5},${x % 62 ? 90 : 76} ${x + 31},84`;
  g += `<path d="${ridge} L372,112 L0,112Z" fill="#4b3826"/><path d="${ridge}" fill="none" stroke="#6a5038" stroke-width="2"/>`;
  [0.14, 0.35, 0.6, 0.78, 0.92, 1].forEach((st, k) => {
    const x = 31 + k * 62, y = 82, ripe = sstep(0.84, 1, st), H = 6 + 58 * sstep(0, 0.7, st);
    const leaf = ripe > 0.5 ? '#b89a50' : '#4f8a2c', stalk = ripe > 0.5 ? '#c8a858' : '#5f9a34', ear = ripe > 0.5 ? '#e0bc5c' : '#8fae44';
    const L = 8 + 16 * sstep(0, 0.4, st);
    g += `<path d="M${x},${y} q-${L * 0.6},-${L * 0.5} -${L},-${L * 0.2}M${x},${y} q${L * 0.6},-${L * 0.6} ${L},-${L * 0.15}M${x},${y} q-${L * 0.2},-${L * 0.8} -${L * 0.4},-${L}" stroke="${leaf}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    if (st > 0.45) for (const dx of [-5, 0, 5]) {
      const tx = x + dx * 1.4, ty = y - H + Math.abs(dx) * 1.5;
      g += `<path d="M${x},${y} L${tx},${ty}" stroke="${stalk}" stroke-width="1.6"/>`;
      if (st > 0.55) g += `<ellipse cx="${tx + ripe * dx * 0.3}" cy="${ty - 6 + ripe * 2}" rx="2.6" ry="7" fill="${ear}" transform="rotate(${dx * 2 + ripe * dx * 3} ${tx} ${ty})"/>`;
      if (st > 0.7 && st < 0.86) g += `<circle cx="${tx + 3}" cy="${ty - 7}" r="1.2" fill="#f4f0d0"/><circle cx="${tx - 3}" cy="${ty - 3}" r="1.2" fill="#f4f0d0"/>`;
    }
    g += `<text x="${x}" y="106" text-anchor="middle" font-size="10" fill="#d8cdb4" font-family="Alegreya Sans, sans-serif">${names[k]}</text>`;
  });
  return g + '</svg>';
}
function chronFields() {
  const P = GAME.player, t = P ? farmTempAt(P.x, P.z) : SEASON.temp;
  const left = Math.round(((1 - SEASON.f) * SEASON.yearSec) / 4 / 60);
  const own = FARM.plots.filter((Q) => Q.own === 'p');
  const kept = Object.values(FARM.strains).filter((S) => !S.common).sort((a, b) => a.crop.localeCompare(b.crop) || b.gen - a.gen);
  const gran = Object.keys(FARM.granary).filter((k) => FARM.granary[k] > 0).map((k) => `${fmtInt(FARM.granary[k])} ${goodName(k, 2).toLowerCase()}`).join(', ');
  const strainRows = kept.slice(0, 14).map((S) => `<tr><td>${esc(S.name)}</td><td>${S.gen}</td>${['y', 'h', 'd', 'sp', 'ht'].map((k) => `<td>${Math.round(S.tr[k] * 100)}</td>`).join('')}<td>${goodsCount(farmStrainGood(S))}</td></tr>`).join('');
  return `<p class="lead">The March turns through its seasons: spring, summer, autumn and winter, two days each. ${SEASON_ADVICE[SEASON.idx]}</p>
    <p class="now">Now: <b>${esc(seasonLabel().toLowerCase())}</b>, about ${Math.round(t)}°C where you stand. ${SEASON_NAMES[(SEASON.idx + 1) % 4]} comes in about ${left} minutes.</p>
    <figure class="figure fc-fig">${farmStagesSketch()}</figure>
    ${seasonsChronicleHTML() /* [seasons] the year on the land (05k_seasons.js) */}
    <h3>Your own beds</h3>
    <p>Buy seed and a hoe from a farmer (one waits in each town; Brackenford's work the fields round the town). Face open meadow and press <b>E</b> to till a bed: four furrows of six plants. Then sow it from the seed you carry, or plant a herb root you dug up. Without a hoe you can turn the soil by hand, slowly.</p>
    <p>A crop grows through its stages: <b>sprouting</b>, <b>in leaf</b>, <b>heading</b>, <b>in flower</b>, <b>ripening</b> and <b>ripe</b>. Rain waters a bed and sun and warmth speed it on; a dry spell parches it and the plants wilt and die. Each crop has the cold it can stand: a hard frost kills tender flax and beans, while turnips and cabbages shrug off a light one, and snow lying on a bed keeps the frost off. Weeds come up in every bed and slow it down; pull them. Harvest a ripe bed with <b>E</b> for the crop and seed to sow again. Left too long, ripe plants shed and rot.</p>
    <p>Every harvest tires the soil. A tired bed grows less: let it rest unsown, sow beans in it (they give back), or spread manure from the byre. Fire running through the grass burns a bed too, though the ash feeds it a little; feet and hooves trample it, and storms lay tall crops flat.</p>
    <h3>Breeding better plants</h3>
    <p>No two plants are quite alike. Each carries its own <b>yield</b>, <b>hardiness</b> against frost, tolerance of <b>drought</b>, <b>speed</b> of growth, <b>height</b> and <b>colour</b>, from the seed it grew from and the pollen it caught when it flowered. Look at a plant to see its card: your eye can judge its traits roughly, never exactly.</p>
    <p>When a plant is ripe you can <b>keep its seed</b>. That seed is a strain of its own, a generation on, with the plant's traits blended with those of its pollen parent, and less scattered each time you keep seed from your own line. Sow it, keep the seed of the best again, and your strain improves year by year. Plants of a kind that flower side by side <b>cross</b>: sow a heavy-yielding strain beside a hardy one and keep seed from the crossed plants to bring both together. A first cross grows with a little extra vigour. But strength has its price: fast growers and frost-proof strains yield a little less, and tall ones fall in storms.</p>
    ${strainRows ? `<table class="fc-strains"><thead><tr><th>Your strains</th><th>Gen</th><th>Yld</th><th>Hrd</th><th>Dry</th><th>Spd</th><th>Ht</th><th>Seed</th></tr></thead><tbody>${strainRows}</tbody></table>` : '<p class="fineprint">You have not kept seed of your own yet.</p>'}
    <h3>The town fields</h3>
    <p>The strips round Brackenford belong to its townsfolk. They till, sow, weed and harvest them through the year: grain, beans, turnips, flax and cabbages in turn, with a fallow when the season is wrong. Walk on the grassy balks between the strips, not through the crop.</p>
    <p class="fineprint">You keep ${own.length} bed${own.length === 1 ? '' : 's'}.${gran ? ` Brackenford's granary holds ${gran}.` : ''}</p>`;
}
// the farming part of How to play (10_ui.js)
function farmHelpHTML() {
  return `<h3>Fields and herbs</h3><p>The year turns through spring, summer, autumn and winter, two days each; the season shows under the war panel. Buy seed and a hoe from a farmer in town, face open meadow and press ${IS_TOUCH ? '<b>Use</b>' : '<b>E</b>'} to till a bed, then sow it. Rain waters it, sun and warmth grow it, drought and hard frost kill it; pull the weeds and harvest it when ripe. Tired soil wants rest, beans or manure. Keep the seed of your best plants to breed better strains, and examine wild herbs to learn them for your herbal. The plant card shows what you are looking at and what you can do; the Chronicle's Fields and Herbal pages tell the rest.</p>`;
}
function chronHerbal() {
  const known = FARM_HERB_IDS.filter(farmKnows).length;
  const cards = FARM_HERB_IDS.map((k) => {
    const kn = farmKnows(k), F = FARM_HERBS[k], G = GOODS[k];
    return `<div class="fc-herb${kn ? '' : ' unknown'}">${farmHerbSketch(k, kn)}<div><b>${kn ? esc(G.name) : 'Unknown herb'}</b><p>${kn ? esc(F.uses) : 'You have not examined this one yet.'}</p><p class="fc-dim">${esc(F.habitat)}</p></div></div>`;
  }).join('');
  return `<p class="lead">Herb lore is learned plant by plant. Examine a wild plant you do not know (<b>E</b>) to write it into your herbal. Known herbs can be gathered, and they grow back, or dug up whole to plant in your own beds, where they are bred like any crop. A knife lifts a root whole; by hand it often snaps.</p>
    <p class="now">You know <b>${known}</b> of the ${FARM_HERB_IDS.length} herbs of the March.</p>
    <div class="fc-herbs">${cards}</div>`;
}

/* ------------------------------------------------------------------ */
/* saving: the fields with the world, the herbal with the character    */
/* ------------------------------------------------------------------ */
const FARM_ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const farmTrEnc = (tr) => FARM_TR.map((k) => FARM_ALPH[clamp(Math.round((tr[k] ?? 0.5) * 63), 0, 63)]).join('');
function farmTrDec(s) {
  const tr = {};
  FARM_TR.forEach((k, i) => { const v = typeof s === 'string' ? FARM_ALPH.indexOf(s[i]) : -1; tr[k] = v >= 0 ? v / 63 : 0.5; });
  return tr;
}
const FARM_PHASES = ['fallow', 'tilled', 'sown', 'stubble'], FARM_TASKS = [null, 'till', 'sow', 'weed', 'harvest'];
function farmSaveData() {
  const st = Object.values(FARM.strains).filter((S) => !S.common).map((S) => [S.id, S.crop, S.gen, Math.round(S.sd * 1000), farmTrEnc(S.tr), S.pa || '', S.pb || '', S.name]);
  const pl = FARM.plots.filter((P) => P.own === 'p').map((P) => [Math.round(P.x * 10), Math.round(P.z * 10), Math.round(P.ang * 1000), P.cols, P.rows, Math.round(P.fert * 100), Math.round(P.moist * 100), Math.round(P.weeds * 100), Math.round(P.till * 100),
    P.plants.map((q, s) => (q ? [s, Math.round(q.g * 1000), Math.round(q.hp * 100), Math.round((q.trod || 0) * 100), q.crop, q.st, farmTrEnc(q.tr), q.pol ? q.pol.st : '', q.pol ? farmTrEnc(q.pol.tr) : '', Math.round(q.ripeT), q.dead ? 1 : 0, q.nz, q.pol && q.pol.self ? 1 : 0].join('|') : '')).filter((x) => x).join(';')]);
  const tw = FARM.plots.filter((P) => P.own === 't').map((P) => { const T = P.stand; return [FARM_PHASES.indexOf(T.phase), FARM_CROP_IDS.indexOf(T.crop), Math.round(T.g * 1000), Math.round(T.hp * 100), FARM_TASKS.indexOf(T.task), Math.round(T.p * 100), Math.round(P.weeds * 100), Math.round(P.fert * 100), T.rot, T.dead ? 1 : 0]; });
  const hb = [];
  for (const H of FARM.herbs) if (H.gone > 0 || H.regrow > 0) hb.push([H.i, Math.round(H.gone), Math.round(H.regrow)]);
  return { v: 1, t: Math.round(SEASON.t * 10) / 10, n: FARM.nextStrain, st, pl, tw, hb, gr: { ...FARM.granary } };
}
function farmLoadData(d) {
  if (!d || typeof d !== 'object' || d.v !== 1) return;
  SEASON.t = farmNum(d.t, 0, SEASON.yearSec, SEASON.t); seasonCalc(); SEASON.announced = SEASON.idx;
  FARM.nextStrain = Math.max(FARM.nextStrain, Math.round(farmNum(d.n, 101, 1e7, 101)));
  if (Array.isArray(d.st)) for (const a of d.st.slice(0, 60)) {
    if (!Array.isArray(a) || typeof a[0] !== 'string' || !/^s\d{1,7}$/.test(a[0]) || !FARM_CROPS[a[1]]) continue;
    farmNewStrain(a[1], farmTrDec(a[4]), { id: a[0], gen: Math.round(farmNum(a[2], 1, 999, 1)), sd: farmNum(a[3], 10, 200, 80) / 1000, pa: typeof a[5] === 'string' && a[5] ? a[5] : null, pb: typeof a[6] === 'string' && a[6] ? a[6] : null, name: typeof a[7] === 'string' ? a[7].slice(0, 80) : null });
    FARM.nextStrain = Math.max(FARM.nextStrain, parseInt(a[0].slice(1), 10) + 1);
  }
  // the player's beds
  for (const P of FARM.plots.filter((Q) => Q.own === 'p')) FARM.plots.splice(FARM.plots.indexOf(P), 1);
  if (Array.isArray(d.pl)) for (const a of d.pl.slice(0, 40)) {
    if (!Array.isArray(a)) continue;
    const x = farmNum(a[0], -5000, 5000, NaN) / 10, z = farmNum(a[1], -5000, 5000, NaN) / 10;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const cols = Math.round(farmNum(a[3], 1, 12, 4)), rows = Math.round(farmNum(a[4], 1, 16, 6));
    const P = farmPlotNew({ own: 'p', x, z, ang: farmNum(a[2], -7000, 7000, 0) / 1000, cols, rows, fert: farmNum(a[5], 0, 100, 80) / 100, moist: farmNum(a[6], 0, 100, 45) / 100, weeds: farmNum(a[7], 0, 100, 0) / 100, till: farmNum(a[8], 0, 100, 100) / 100 });
    if (typeof a[9] === 'string' && a[9]) for (const rec of a[9].split(';')) {
      const f = rec.split('|');
      const s = parseInt(f[0], 10), crop = f[4];
      if (!(s >= 0 && s < P.plants.length) || !FARM_CROPS[crop]) continue;
      const st = FARM.strains[f[5]] ? f[5] : 'c_' + crop;
      const q = { crop, st, tr: farmTrDec(f[6]), g: farmNum(f[1], 0, 1000, 0) / 1000, hp: farmNum(f[2], 0, 100, 100) / 100, trod: farmNum(f[3], 0, 100, 0) / 100, char: 0, ripeT: farmNum(f[9], 0, 1e5, 0), wilt: 0, pol: null, dead: f[10] === '1', nz: Math.round(farmNum(f[11], 0, 1e6, 0)), bite: 0 };
      if (f[7] && (FARM.strains[f[7]])) q.pol = { st: f[7], tr: farmTrDec(f[8]), self: f[12] === '1' };
      P.plants[s] = q;
    }
    P.idx = FARM.plots.length;
    FARM.plots.push(P);
  }
  // the town strips, in the order they were laid out
  const strips = FARM.plots.filter((Q) => Q.own === 't');
  if (Array.isArray(d.tw)) d.tw.slice(0, strips.length).forEach((a, i) => {
    if (!Array.isArray(a)) return;
    const P = strips[i], T = P.stand;
    T.phase = FARM_PHASES[Math.round(farmNum(a[0], 0, 3, 0))] || 'fallow';
    T.crop = FARM_CROP_IDS[Math.round(farmNum(a[1], 0, FARM_CROP_IDS.length - 1, 0))] || 'grain';
    if (FARM_CROPS[T.crop].herb && !farmRotOf(P).includes(T.crop)) T.crop = 'grain'; // [seasons] a garden's herbs stay herbs
    T.g = farmNum(a[2], 0, 1000, 0) / 1000; T.hp = farmNum(a[3], 0, 100, 100) / 100;
    T.task = FARM_TASKS[Math.round(farmNum(a[4], 0, 4, 0))] || null; T.p = farmNum(a[5], 0, 100, 0) / 100; T.worker = null; T.workT = GAME.t;
    P.weeds = farmNum(a[6], 0, 100, 0) / 100; P.fert = farmNum(a[7], 0, 100, 80) / 100; T.rot = Math.round(farmNum(a[8], 0, 99, 0)); T.dead = a[9] === 1;
    P.till = T.phase === 'stubble' || T.phase === 'fallow' ? 0.2 : 1;
  });
  if (Array.isArray(d.hb)) for (const a of d.hb.slice(0, 600)) { if (!Array.isArray(a)) continue; const H = FARM.herbs[Math.round(farmNum(a[0], 0, 1e5, -1))]; if (H) { H.gone = farmNum(a[1], 0, 2000, 0); H.regrow = farmNum(a[2], 0, 480, 0); } }
  FARM.granary = {};
  if (d.gr && typeof d.gr === 'object') for (const k in d.gr) if (GOODS[k]) FARM.granary[k] = Math.round(farmNum(d.gr[k], 0, 1e7, 0));
  FARM.plots.forEach((Q, k) => { Q.idx = k; });
  buildCoverMask();
  FARM.soilDirty = true; FARM.drawDirty = true;
}
// what counts as a change worth writing: beds, strains and stages, never the clocks
function farmSaveKey(d) {
  if (!d) return null;
  return [SEASON_NAMES[Math.min(3, Math.floor((d.t / SEASON.yearSec) * 4))], (d.st || []).length, (d.pl || []).map((a) => [a[0], a[1], Math.round(a[7] / 25), String(a[9]).split(';').map((r) => { const f = r.split('|'); return f[0] + ':' + farmStageIdx((+f[1] || 0) / 1000) + f[10]; }).join(',')]), (d.tw || []).map((a) => a[0] + ':' + a[4]), (d.hb || []).length];
}
registerSavePart('world', 'farm', { save: farmSaveData, load: farmLoadData, key: farmSaveKey });
registerSavePart('char', 'herbal', {
  save: () => { const k = FARM_HERB_IDS.filter(farmKnows).map((id) => id.slice(5)); return k.length || FARM.herbal.tips ? { k: k.join(','), t: FARM.herbal.tips } : null; },
  load: (d) => {
    FARM.herbal = { known: {}, tips: 0 };
    if (!d || typeof d !== 'object') return;
    if (typeof d.k === 'string') for (const s of d.k.split(',').slice(0, 20)) { const id = 'herb_' + s; if (FARM_HERBS[id]) FARM.herbal.known[id] = { at: 0 }; }
    FARM.herbal.tips = Math.round(farmNum(d.t, 0, 1 << 20, 0));
  },
});

/* ------------------------------------------------------------------ */
/* building it all (boot), and the test hooks                          */
/* ------------------------------------------------------------------ */
function buildFarming() {
  farmPlaceHerbs();
  farmCoverHerbs();
  COVER.tex.needsUpdate = true;
  farmBuildTownFields();
  farmBuildDraw();
  FARM.built = true;
  FARM.lastCraters = (NATURE.craters || []).length;
  const card = document.createElement('div');
  card.id = 'farmcard'; card.className = 'panel';
  card.addEventListener('click', (e) => { const b = e.target.closest('[data-farm]'); if (!b || b.disabled) return; e.preventDefault(); farmDo(b.dataset.farm); sfx('click'); FARM.clock.ui = 0; });
  $('hud').appendChild(card);
  FARM.cardEl = card;
  if (window.__hm) {
    window.__hm.farm = {
      FARM, SEASON, FARM_CROPS, FARM_HERBS, seasonNow, seasonCalc, farmTempAt, seasonCold, seasonWeatherOdds,
      setSeason(k) { SEASON.t = clamp(k, 0, 0.9999) * SEASON.yearSec; seasonCalc(); SEASON.announced = SEASON.idx; },
      till(x, z, ang = 0, cols = 4, rows = 6) { return farmAddPlot({ own: 'p', x, z, ang, cols, rows }).id; },
      tillWhy: (x, z) => farmGroundWhy(x, z),
      tillSpot: () => { const T = farmTillSpot(GAME.player); return { x: T.x, z: T.z, why: T.why }; },
      plot: (id) => FARM.plots.find((P) => P.id === id) || null,
      sow(id, gid, max) { const P = FARM.plots.find((Q) => Q.id === id); return P ? farmSow(P, gid, max) : 0; },
      harvest(id) { const P = FARM.plots.find((Q) => Q.id === id); const o = P && farmHarvest(P, true); return o ? o.got : null; },
      saveSeed(id, s) { const P = FARM.plots.find((Q) => Q.id === id); const S = P && farmSaveSeed(P, s, true); return S ? { id: S.id, good: farmStrainGood(S), gen: S.gen, tr: { ...S.tr }, pa: S.pa, pb: S.pb, name: S.name } : null; },
      newStrain(crop, tr, gen = 1, sd = 0.04) { const S = farmNewStrain(crop, { ...FARM.strains['c_' + crop].tr, ...tr }, { gen, sd }); return farmStrainGood(S); },
      step: (dt) => farmStepPlots(dt), stepTown: (dt) => farmStepTown(dt), stepFire: () => farmStepFire(),
      plants(id) { const P = FARM.plots.find((Q) => Q.id === id); return P && P.plants ? P.plants.map((q) => (q ? { g: q.g, hp: q.hp, st: q.st, tr: { ...q.tr }, pol: q.pol ? q.pol.st : null, dead: q.dead, trod: q.trod, char: q.char, wilt: q.wilt, bite: q.bite } : null)) : null; },
      strips: () => FARM.plots.filter((P) => P.own === 't').map((P) => ({ id: P.id, x: P.x, z: P.z, phase: P.stand.phase, crop: P.stand.crop, g: P.stand.g, task: P.stand.task, p: P.stand.p, worker: P.stand.worker })),
      herbs: () => FARM.herbs.map((H) => ({ k: H.k, x: H.x, z: H.z, gone: H.gone, regrow: H.regrow })),
      learn: (k) => farmLearn(k, true), knows: farmKnows, gather: (i) => farmGatherHerb(FARM.herbs[i], true), dig: (i) => farmDigHerb(FARM.herbs[i], true),
      ctx: () => { const c = farmContext(GAME.player); return c ? { type: c.type, why: c.T ? c.T.why : null, actions: farmActions(c).map((a) => a[0]) } : null; },
      act: (a) => { FARM.ctx = farmContext(GAME.player); farmDo(a); return !!FARM.job; },
      job: () => (FARM.job ? { kind: FARM.job.kind, swings: FARM.job.swings, need: FARM.job.need } : null),
      save: farmSaveData, load: farmLoadData, key: farmSaveKey, chronFields, chronHerbal, farmGrowAt, farmEatAt, openFarmer,
      farmers: () => FARM.farmers.slice(), grow: farmGrowRate, trYield,
    };
  }
}


function farmSharedSave() { return farmSaveData(); }
function farmSharedApply(d) {
  if (!d) return;
  const job = FARM.job, plot = job && job.plot, herbal = FARM.herbal;
  for (const herb of FARM.herbs) { herb.gone = 0; herb.regrow = 0; }
  farmLoadData(d);
  FARM.herbal = herbal;
  if (job && plot) {
    const replacement = FARM.plots.find(p => Math.hypot(p.x - plot.x, p.z - plot.z) < 0.2);
    FARM.job = replacement ? { ...job, plot: replacement } : null;
  } else FARM.job = job;
}
queueMicrotask(() => {
  if (typeof netWorldPartsRegisterCommand !== 'function') return;
  netWorldPartsRegisterCommand('farm.job', {
    point: a => {
      const herb = Number.isInteger(a.herb) && FARM.herbs[a.herb];
      return a.plot || (herb ? { x: herb.x, z: herb.z } : null);
    },
    range: 7,
    run: a => {
      const allowed = ['till', 'tillHand', 'sow', 'weed', 'harvest', 'saveseed', 'clear', 'manure', 'gather', 'dig'];
      if (!allowed.includes(a.kind)) return false;
      const plot = a.plot && FARM.plots.find(p => Math.hypot(p.x - a.plot.x, p.z - a.plot.z) < 0.2);
      const herb = Number.isInteger(a.herb) ? FARM.herbs[a.herb] : null;
      if (!['till', 'tillHand', 'gather', 'dig'].includes(a.kind) && (!plot || plot.own !== 'p')) return false;
      if (['gather', 'dig'].includes(a.kind) && !herb) return false;
      if (a.kind === 'sow' && (!GOODS[a.gid] || !goodsCount(a.gid))) return false;
      if (a.kind === 'manure' && !goodsHave('manure')) return false;
      farmFinishJob(a.kind, { plot, herb, slot: a.slot, gid: a.gid });
      return { ok: true };
    },
  });
});
