/* ================================================================== */
/* game data: classes, abilities, monsters, names, progression         */
/* ================================================================== */
const LEVEL_CAP = 50;
// past 20, the frontier, the barrow and the dragon rise to meet the strongest of you
function warLevel() { return clamp(GAME.prog ? GAME.prog.level : 20, 20, LEVEL_CAP); }
// every ten levels past 20 an ability grows a rank stronger
const abilityRank = (lvl) => 1 + Math.floor(Math.max(0, lvl - 20) / 10);
const rankMult = (lvl) => 1 + 0.12 * (abilityRank(lvl) - 1);
const RANK_NUMERAL = ['', 'I', 'II', 'III', 'IV', 'V'];
const xpToNext = (L) => Math.round(55 * Math.pow(L, 1.55) + 40);
const baseDmg = (L) => 6 + 3.0 * L;
const baseHp = (L) => 70 + 26 * L;
const basePower = (L) => 60 + 7 * L;
const REALM_RANKS = [0, 250, 750, 1750, 3500, 6000, 10000, 15000, 22000, 30000, 40000, 52000, 66000, 82000, 100000];
const RANK_TITLES = ['Recruit', 'Soldier', 'Sergeant', 'Veteran', 'Captain', 'Champion', 'Warden', 'Marshal', 'Lord of the March', 'Hero of the March', 'Shield of the Realm', 'Sword of the Realm', 'Hallowed', 'Paragon', 'Legend of the March'];
function realmRank(rp) { let r = 1; for (let i = 0; i < REALM_RANKS.length; i++) if (rp >= REALM_RANKS[i]) r = i + 1; return r; }

const CLASSES = {
  warrior: {
    name: 'Warrior', role: 'Front-line fighter', hp: 1.4, dmg: 1.1, dr: 0.15, range: 2.7, swing: 2.4, ranged: false, // [classes] balance
    blurb: 'Heavy armour, a blade and a shield. Holds the gate, parries the blow and finishes what it starts.', // [classes]
    abilities: ['slash', 'bash', 'cleave', 'charge', 'rally', 'bulwark', 'whirl', 'leap'], icon: 'sword',
  },
  archer: {
    name: 'Archer', role: 'Ranged damage', hp: 1.12, dmg: 1.0, dr: 0.12, range: 30, swing: 2.2, ranged: 'arrow', // [balance] 1.25: archers live by keeping away, not by taking blows
    blurb: 'A longbow and light leathers. Draws from the long grass and the treeline, and snares what comes close.', // [classes]
    abilities: ['quickshot', 'aimed', 'cripple', 'volley', 'tumble', 'pierce', 'firearrow', 'deadeye'], icon: 'bow',
  },
  mage: {
    name: 'Mage', role: 'Spells and control', hp: 1.0, dmg: 1.0, dr: 0.0, range: 28, swing: 2.6, ranged: 'arcane', // [balance] less fragile
    blurb: 'Fire, frost and storm, and what each does to the others. Fragile, but freezes a charge before it lands.', // [classes]
    abilities: ['firebolt', 'frost', 'nova', 'blink', 'ward', 'meteor', 'chain', 'blizzard'], icon: 'flame',
  },
  priest: {
    name: 'Priest', role: 'Healer and support', hp: 1.05, dmg: 1.3, dr: 0.08, range: 2.7, swing: 2.5, ranged: false, // [balance] 1.2
    blurb: 'Mends wounds, hallows the ground and raises the fallen. Every warband wants one.', // [classes]
    abilities: ['smite', 'mend', 'renew', 'holyfire', 'sanctuary', 'divine', 'massrenew', 'pillar'], icon: 'sun',
  },
};
const ABILITIES = {
  slash: { name: 'Slash', icon: 'sword', level: 1, cost: 8, cd: 4, range: 'melee', dmg: 1.6, anim: 1, desc: 'A fast, heavy cut. 160% weapon damage.' },
  bash: { name: 'Shield Bash', icon: 'shield', level: 2, cost: 12, cd: 14, range: 'melee', dmg: 0.7, stun: 2.0, anim: 1, desc: 'Stuns the target for 2 seconds.' }, // [balance] 2.5 s
  cleave: { name: 'Cleave', icon: 'arc', level: 4, cost: 15, cd: 8, range: 'melee', arc: 4.5, dmg: 1.2, anim: 8, desc: 'Strikes every enemy in front of you.' },
  charge: { name: 'Charge', icon: 'chevrons', level: 7, cost: 10, cd: 16, range: 28, minRange: 5, dash: true, dmg: 0.8, snare: [0.45, 3], anim: 1, desc: 'Rush to a target 5–28 m away and slow it.' },
  rally: { name: 'Rallying Cry', icon: 'horn', level: 11, cost: 20, cd: 40, self: true, healPct: 0.25, buff: { kind: 'dmg', value: 0.15, dur: 10 }, desc: 'Heal 25% and deal 15% more damage for 10 s.' },
  bulwark: { name: 'Bulwark', icon: 'tower', level: 15, cost: 15, cd: 45, self: true, buff: { kind: 'dr', value: 0.6, dur: 6 }, anim: 5, desc: 'Take 60% less damage for 6 seconds.' },

  quickshot: { name: 'Quick Shot', icon: 'arrow', level: 1, cost: 6, cd: 3, range: 32, proj: 'arrow', dmg: 1.15, anim: 2, desc: 'An instant shot. 115% damage.' },
  aimed: { name: 'Aimed Shot', icon: 'target', level: 2, cost: 12, cd: 7, range: 40, cast: 1.6, proj: 'arrow', dmg: 2.5, anim: 2, desc: 'A slow, careful shot. 250% damage, 40 m.' },
  cripple: { name: 'Crippling Arrow', icon: 'chain', level: 4, cost: 10, cd: 9, range: 32, proj: 'arrow', dmg: 0.8, snare: [0.6, 5], anim: 2, desc: 'Slows the target by 60% for 5 seconds.' }, // [balance] 50%, 12 s
  volley: { name: 'Volley', icon: 'rain', level: 7, cost: 22, cd: 16, range: 36, ground: true, radius: 5, waves: 3, dmg: 0.8, anim: 2, desc: 'Three waves of arrows around the target.' },
  tumble: { name: 'Tumble', icon: 'leap', level: 11, cost: 10, cd: 11, /* [balance] 15 */ self: true, dashBack: 10, buff: { kind: 'free', value: 1, dur: 2 }, desc: 'Leap 10 m back and shake off slows.' },
  pierce: { name: 'Piercing Shot', icon: 'pierce', level: 15, cost: 24, cd: 20, range: 40, cast: 1.2, line: true, dmg: 2.0, anim: 2, desc: 'An arrow that passes through every enemy in a line.' },

  firebolt: { name: 'Firebolt', icon: 'flame', level: 1, cost: 10, cd: 0, range: 34, cast: 1.5, proj: 'fire', dmg: 2.0, anim: 3, desc: 'Hurls fire. 200% damage.' },
  frost: { name: 'Frost Lance', icon: 'snow', level: 2, cost: 9, cd: 6, range: 32, proj: 'frost', dmg: 1.0, snare: [0.4, 4], anim: 3, desc: 'Instant. Slows the target by 40% for 4 seconds.' },
  nova: { name: 'Flame Nova', icon: 'burst', level: 4, cost: 18, cd: 12, /* [balance] 16 */ self: true, pbaoe: 7, dmg: 1.3, root: 2.5, anim: 3, desc: 'Burns and roots every enemy within 7 m.' },
  blink: { name: 'Blink', icon: 'spark', level: 7, cost: 12, cd: 11, /* [balance] 14 */ self: true, blink: 12, desc: 'Teleport 12 m in the direction you face.' },
  ward: { name: 'Arcane Ward', icon: 'ward', level: 11, cost: 20, cd: 24, self: true, shieldPct: 0.4, dur: 12, desc: 'Absorbs damage equal to 40% of your health.' }, // [balance] 30%, 30 s
  meteor: { name: 'Meteor', icon: 'meteor', level: 15, cost: 30, cd: 28, range: 36, ground: true, cast: 2.4, radius: 6, dmg: 3.0, anim: 3, desc: 'Calls down a meteor. 300% damage in 6 m.' },

  smite: { name: 'Smite', icon: 'sun', level: 1, cost: 8, cd: 0, range: 30, cast: 1.3, proj: 'holy', dmg: 1.8, anim: 3, desc: 'Holy light. 180% damage.' }, // [balance] 160%
  mend: { name: 'Mend', icon: 'heart', level: 1, cost: 18, /* [balance] 14 */ cd: 0, range: 30, cast: 1.5, heal: 0.36, friendly: true, anim: 3, desc: 'Heals a friend (or you) for 36% of health.' },
  renew: { name: 'Renewal', icon: 'leaf', level: 3, cost: 12, cd: 6, range: 30, hot: [0.32, 9], friendly: true, anim: 3, desc: 'Heals 32% over 9 seconds.' },
  holyfire: { name: 'Holy Fire', icon: 'candle', level: 5, cost: 12, cd: 8, range: 30, dot: [2.1, 8], anim: 3, desc: 'Burns an enemy for 210% over 8 seconds.' }, // [balance] 180%
  sanctuary: { name: 'Sanctuary', icon: 'circle', level: 9, cost: 26, cd: 20, self: true, groupHeal: 0.25, radius: 14, anim: 3, desc: 'Heals you and all allies within 14 m for 25%.' },
  divine: { name: 'Divine Shield', icon: 'ward', level: 14, cost: 20, cd: 40, range: 30, friendly: true, shieldPct: 0.35, dur: 8, anim: 3, desc: 'Shields a friend for 35% of their health.' },

  // learned at 20 and 30
  whirl: { name: 'Whirlwind', icon: 'whirl', level: 20, cost: 22, cd: 12, self: true, spin: 4.4, dmg: 1.4, desc: 'Spin with your weapon out. 140% damage to every enemy within 4 m.' },
  leap: { name: 'Leap Strike', icon: 'leapdown', level: 30, cost: 20, cd: 18, range: 24, minRange: 6, leap: true, radius: 4, dmg: 1.6, stun: 1.0, desc: 'Leap onto a foe 6–24 m away. 160% damage and a 1 s stun to all within 4 m.' }, // [balance] 1.5 s
  firearrow: { name: 'Fire Arrow', icon: 'firearrow', level: 20, cost: 14, cd: 8, range: 34, proj: 'firearrow', dmg: 1.6, burn: [0.9, 6], anim: 2, desc: 'A burning arrow. 160% damage, and 90% more as fire over 6 s.' },
  deadeye: { name: 'Deadeye', icon: 'eye', level: 30, cost: 26, cd: 24, range: 50, cast: 2.4, proj: 'deadeye', dmg: 4.2, anim: 2, desc: 'A long, steady shot. 420% damage at up to 50 m; armour does not stop it.' },
  chain: { name: 'Chain Lightning', icon: 'bolt', level: 20, cost: 20, cd: 9, range: 32, cast: 1.2, chain: 3, dmg: 1.6, anim: 3, desc: 'Lightning that leaps on to 3 more foes. 160%, a fifth less at each leap.' },
  blizzard: { name: 'Blizzard', icon: 'snow2', level: 30, cost: 32, cd: 26, range: 34, ground: true, cast: 1.8, radius: 7, ticks: 6, dmg: 0.5, snare: [0.4, 2], anim: 3, desc: 'Ice falls for 6 s in a 7 m circle: 50% damage a second and a 40% slow.' },
  massrenew: { name: 'Mass Renewal', icon: 'leaves', level: 20, cost: 30, cd: 24, self: true, groupHot: [0.3, 9], radius: 16, anim: 3, desc: 'Heals you and every ally within 16 m for 30% over 9 s.' },
  pillar: { name: 'Pillar of Dawn', icon: 'pillar', level: 30, cost: 34, cd: 22, range: 30, ground: true, cast: 1.6, radius: 4.5, dmg: 2.2, healPct: 0.3, anim: 3, desc: 'A column of light: 220% damage to enemies inside it, 30% healing to allies.' },
};
for (const k in ABILITIES) ABILITIES[k].id = k;

const MOBS = {
  wolf: { kind: 'wolf', names: ['young wolf', 'grey wolf', 'timber wolf', 'dire wolf', 'frost wolf', 'shadow wolf', 'ancient wolf', 'wolf-lord', 'wolf-lord'], hp: 0.9, dmg: 0.95, speed: 7.6, swing: 2.0, range: 2.2, aggro: 0, scale: [0.9, 1.25], colA: [0.45, 0.43, 0.4], colB: [0.3, 0.28, 0.26], radius: 0.55 },
  boar: { kind: 'boar', names: ['wild boar', 'tusked boar', 'bristleback', 'great boar', 'ironhide boar', 'old tusker', 'deepwood boar', 'boar-king', 'boar-king'], hp: 1.1, dmg: 0.9, speed: 6.6, swing: 2.2, range: 2.2, aggro: 0, scale: [0.85, 1.2], colA: [0.36, 0.27, 0.2], colB: [0.22, 0.16, 0.12], radius: 0.6 },
  bear: { kind: 'bear', names: ['brown bear', 'black bear', 'cave bear', 'old bruin', 'great bear', 'grizzled bruin', 'ancient bear', 'bear-king', 'bear-king'], hp: 1.65, dmg: 1.2, speed: 6.8, swing: 2.6, range: 2.8, aggro: 7, scale: [0.9, 1.15], colA: [0.32, 0.22, 0.15], colB: [0.2, 0.14, 0.1], radius: 0.95 },
  bandit: { kind: 'humanoid', names: ['bandit cutpurse', 'bandit thug', 'bandit raider', 'bandit captain', 'outlaw veteran', 'outlaw reaver', 'outlaw warlord', 'outlaw king', 'outlaw king'], hp: 1.0, dmg: 1.0, speed: 6.6, swing: 2.4, range: 2.6, aggro: 11, scale: [0.95, 1.05], tabard: [0.38, 0.32, 0.26], armor: [0.32, 0.27, 0.22], mask: WB.axe | WB.hood | WB.skirt | WB.belt, outfit: 5, radius: 0.45 },
  skeleton: { kind: 'humanoid', names: ['barrow bones', 'barrow wight', 'barrow warden', 'grave knight', 'bone champion', 'deathless guard', 'tomb-thrall', 'tomb lord', 'tomb lord'], hp: 0.95, dmg: 1.05, speed: 6.0, swing: 2.4, range: 2.6, aggro: 12, scale: [1.0, 1.05], tabard: [0.2, 0.2, 0.22], armor: [0.42, 0.4, 0.36], mask: WB.sword | WB.shieldRound | WB.belt, flags: 1, outfit: 6, bulk: -1, radius: 0.45 },
  draugr: { kind: 'humanoid', names: ['draugr', 'draugr thrall', 'draugr huscarl', 'draugr jarl', 'draugr berserker', 'grave-jarl', 'draugr chieftain', 'draugr king', 'draugr king'], hp: 1.1, dmg: 1.05, speed: 5.8, swing: 2.5, range: 2.6, aggro: 12, scale: [1.0, 1.12], tabard: [0.18, 0.2, 0.24], armor: [0.35, 0.38, 0.4], mask: WB.axe | WB.helmet | WB.shieldRound | WB.beard | WB.skirt | WB.belt, flags: 1, outfit: 7, bulk: -0.25, radius: 0.45 },
  troll: { kind: 'humanoid', names: ['hill troll', 'stone troll', 'moss troll', 'old troll', 'cave troll', 'mountain troll', 'troll elder', 'troll king', 'troll king'], hp: 1.9, dmg: 1.35, speed: 6.2, swing: 2.9, range: 3.4, aggro: 10, scale: [1.55, 1.8], tabard: [0.32, 0.28, 0.22], armor: [0.4, 0.36, 0.3], mask: WB.mace | WB.skirt | WB.belt | WB.hairLong, flags: 2 | 4, outfit: 8, bulk: 1, radius: 0.85 },
  wisp: { kind: 'wisp', names: ["will-o'-wisp", 'bog light', 'marsh lantern', 'pale wisp', 'grave light', 'storm wisp', 'ghost-fire', 'wisp-mother', 'wisp-mother'], hp: 0.75, dmg: 1.1, speed: 6.2, swing: 2.6, range: 20, aggro: 14, scale: [1, 1], radius: 0.4, ranged: 'wisp' },
};
// how the creatures of the deep wilds look past level 20, tier by tier: [fur or glow, shade]
const MOB_LATE = {
  wolf: [[[0.72, 0.75, 0.8], [0.48, 0.52, 0.58]], [[0.17, 0.16, 0.18], [0.08, 0.08, 0.09]], [[0.84, 0.83, 0.8], [0.58, 0.57, 0.55]], [[0.3, 0.3, 0.33], [0.13, 0.13, 0.15]]],
  boar: [[[0.42, 0.4, 0.38], [0.25, 0.24, 0.23]], [[0.26, 0.2, 0.16], [0.14, 0.11, 0.09]], [[0.3, 0.32, 0.21], [0.17, 0.18, 0.12]], [[0.24, 0.13, 0.1], [0.11, 0.06, 0.05]]],
  bear: [[[0.26, 0.18, 0.12], [0.15, 0.1, 0.07]], [[0.46, 0.41, 0.34], [0.3, 0.26, 0.21]], [[0.64, 0.62, 0.58], [0.42, 0.4, 0.37]], [[0.12, 0.1, 0.09], [0.06, 0.05, 0.05]]],
  wisp: [[[1.4, 1.5, 1.7], [0.7, 0.75, 0.9]], [[0.9, 1.2, 2.5], [0.45, 0.6, 1.3]], [[0.6, 2.0, 0.8], [0.3, 1.0, 0.4]], [[1.7, 0.8, 2.3], [0.85, 0.4, 1.15]]],
};
// the champions who lead the camps of the borderlands
const ELITE_NAMES = {
  wolf: ['Grimfang', 'Ashmaw', 'Frostjaw', 'Nightrunner', 'Old Greymuzzle'],
  boar: ['Ironbristle', 'Rootgore', 'Old Tusk', 'Thornhide'],
  bear: ['Stonepaw', 'Gristlemaw', 'Mossback', 'Old Heavyfoot'],
  bandit: ['Black Wenna', 'Red Osric', 'Hadwin Cutthroat', 'One-Eyed Peran'],
  skeleton: ['the Nameless Knight', 'Sir Hollowmail', 'the Bone Herald'],
  draugr: ['Hrolf Grave-Born', 'Jarl Coldbreath', 'Ulf the Unburied'],
  troll: ['Gnarlbelly', 'Old Rockjaw', 'Mossgut the Elder'],
  wisp: ['the Drowned Lantern', 'the Will of the Mere', 'the Pale Mother'],
};
const mobTier = (M, lvl) => Math.min(M.names.length - 1, Math.floor(lvl / 5.5));
const CON = [
  { name: 'grey', col: '#9b9b9b', xp: 0 },
  { name: 'green', col: '#55c45a', xp: 0.55 },
  { name: 'blue', col: '#5596e6', xp: 0.8 },
  { name: 'yellow', col: '#e9d44c', xp: 1.0 },
  { name: 'orange', col: '#f08c37', xp: 1.2 },
  { name: 'red', col: '#e5483a', xp: 1.45 },
];
function conIndex(targetL, viewerL) {
  const d = targetL - viewerL;
  const g = viewerL < 10 ? 4 : 5;
  if (d <= -g) return 0;
  if (d <= -2) return 1;
  if (d === -1) return 2;
  if (d === 0) return 3;
  if (d <= 2) return 4;
  return 5;
}

const NAMES = {
  0: ['Aldric', 'Bertrand', 'Cadoc', 'Edwyn', 'Elowen', 'Gawen', 'Hadwin', 'Isolt', 'Leofric', 'Mabyn', 'Osric', 'Rowena', 'Tamsin', 'Wenna', 'Yestin', 'Aelfric', 'Cedric', 'Gwenna', 'Morwen', 'Peran', 'Sibyl', 'Tristram', 'Eluned', 'Bevis'],
  1: ['Áed', 'Bláthnat', 'Cormac', 'Dervla', 'Eithne', 'Fiachra', 'Lorcan', 'Muirne', 'Niamh', 'Odhrán', 'Ruairí', 'Sadb', 'Tadhg', 'Úna', 'Conall', 'Clodagh', 'Ailbhe', 'Senan', 'Ríona', 'Dáire', 'Fíona', 'Cathal', 'Emer', 'Oisín'],
  2: ['Asgeir', 'Bera', 'Dagny', 'Eirik', 'Freydis', 'Gunnar', 'Hallveig', 'Ingrid', 'Jorunn', 'Ketil', 'Leif', 'Ragna', 'Sigrun', 'Sten', 'Thora', 'Ulf', 'Vigdis', 'Yngvar', 'Hrolf', 'Solveig', 'Torvald', 'Astrid', 'Hakon', 'Gudrun'],
};
const VILLAGER_NAMES = ['Villager', 'Farmhand', 'Cooper', 'Weaver', 'Herder', 'Smith', 'Miller', 'Potter'];
function randomName(realm, r = Math.random) { return pick(r, NAMES[realm]); }

/* looks per class and realm */
const FEMALE = new Set(['Elowen', 'Isolt', 'Mabyn', 'Rowena', 'Tamsin', 'Wenna', 'Gwenna', 'Morwen', 'Sibyl', 'Eluned',
  'Bláthnat', 'Dervla', 'Eithne', 'Muirne', 'Niamh', 'Sadb', 'Úna', 'Clodagh', 'Ailbhe', 'Ríona', 'Fíona', 'Emer',
  'Bera', 'Dagny', 'Freydis', 'Hallveig', 'Ingrid', 'Jorunn', 'Ragna', 'Sigrun', 'Thora', 'Vigdis', 'Solveig', 'Astrid', 'Gudrun']);
const ARMOR_COL = {
  warrior: [[0.66, 0.67, 0.7], [0.6, 0.63, 0.6], [0.57, 0.6, 0.66]],
  archer: [[0.44, 0.31, 0.19], [0.32, 0.36, 0.21], [0.45, 0.37, 0.28]],
  mage: [[0.5, 0.17, 0.16], [0.16, 0.38, 0.3], [0.22, 0.31, 0.52]],
  priest: [[0.88, 0.84, 0.74], [0.82, 0.86, 0.76], [0.8, 0.82, 0.88]],
};
function hairAndBeard(r, fem, realm) {
  let m = fem ? (r() < 0.8 ? WB.hairLong : WB.hairShort) : (r() < 0.82 ? WB.hairShort : r() < 0.6 ? WB.hairLong : 0);
  if (!fem && r() < (realm === 2 ? 0.75 : 0.4)) m |= WB.beard;
  return m;
}
function classLook(cls, realm, r = Math.random, name = '') {
  const R = REALMS[realm];
  const tab = R.rgb.map((v) => v * (0.85 + r() * 0.15));
  const fem = FEMALE.has(name) ? 1 : 0;
  const hb = hairAndBeard(r, fem, realm), beard = hb & WB.beard, hair = hb & ~WB.beard;
  let mask = WB.belt;
  if (cls === 'warrior') {
    mask |= WB.tabard | WB.pauldron | (realm === 2 ? WB.axe : WB.sword) | (realm === 0 ? WB.shield : WB.shieldRound) | (r() < 0.5 ? WB.cape : 0) | beard;
    mask |= realm === 0 || r() < 0.45 ? WB.helmet : hair;
  }
  if (cls === 'archer') mask |= WB.bow | WB.quiver | WB.skirt | beard | (r() < 0.55 ? WB.hood : hair);
  if (cls === 'mage') mask |= WB.staff | WB.robe | WB.cape | beard | (r() < 0.6 ? WB.hood : hair);
  if (cls === 'priest') mask |= WB.mace | WB.robe | WB.tabard | WB.cape | hair | beard | (realm === 0 ? WB.shield : 0);
  return { tabard: tab, armor: ARMOR_COL[cls][realm], skin: r() * 0.8, hair: r(), mask, flags: 0, scale: (fem ? 0.93 : 0.97) + r() * 0.07, outfit: OUTFIT[cls], emblem: realm, fem, bulk: 0 };
}

/* SVG icons for the hotbar and class picker (simple line glyphs) */
const ICONS = {
  sword: '<path d="M5 19l10-10M15 9l4-4v-1h-1l-4 4M7 15l2 2M4 20l2-2"/>',
  shield: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/>',
  arc: '<path d="M4 15a10 10 0 0 1 16 0M7 18l-3-3 3-3M17 18l3-3-3-3"/>',
  chevrons: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  horn: '<path d="M4 9c6 0 10-3 15-5v14c-5-2-9-5-15-5zM7 13l1 6"/>',
  tower: '<path d="M6 21V8h12v13M6 8V4h2v2h3V4h2v2h3V4h2v4M10 21v-5h4v5"/>',
  arrow: '<path d="M4 20L18 6M18 6h-5M18 6v5M6 18l-2 2M8 20H5v-3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6"/>',
  chain: '<path d="M9 15l6-6M8 11l-2 2a3 3 0 0 0 4 4l2-2M16 13l2-2a3 3 0 0 0-4-4l-2 2"/>',
  rain: '<path d="M6 4l-2 6M11 4l-2 6M16 4l-2 6M8 13l-2 7M13 13l-2 7M18 13l-2 7"/>',
  leap: '<path d="M4 18c3-9 9-12 16-12M16 3l4 3-3 4M4 21h6"/>',
  pierce: '<path d="M3 12h18M17 8l4 4-4 4M8 8v8M12 9v6"/>',
  flame: '<path d="M12 21c-4 0-6-3-6-6 0-4 4-6 3-11 3 2 5 5 5 8 1-1 1.5-2.5 1.5-3.5 2 2 2.5 4 2.5 6.5 0 3-2 6-6 6z"/>',
  snow: '<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  burst: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19"/><circle cx="12" cy="12" r="2"/>',
  spark: '<path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/>',
  ward: '<circle cx="12" cy="12" r="8"/><path d="M12 6l5 3v4c0 3-2.5 4.5-5 6-2.5-1.5-5-3-5-6V9z"/>',
  meteor: '<circle cx="15" cy="15" r="4"/><path d="M3 3l9 9M6 2l8 8M2 6l8 8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  leaf: '<path d="M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zM5 19l8-8"/>',
  candle: '<path d="M9 21h6V11H9zM12 11V8M12 3c1.5 2 1.5 3.5 0 5-1.5-1.5-1.5-3 0-5z"/>',
  circle: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
  bow: '<path d="M6 3c9 3 12 9 12 18M6 3v18M3 12h16M16 9l3 3-3 3"/>',
  whirl: '<path d="M12 4a8 8 0 1 1-7.4 5M12 8a4 4 0 1 1-3.7 2.5"/><path d="M4.6 9L3 5.5M4.6 9l3.6-1.2"/>',
  leapdown: '<path d="M4 6c5-3 10-1 12 5l1 6"/><path d="M14 16l3 3 3-3M6 21h12"/>',
  firearrow: '<path d="M4 20L16 8M16 8h-4M16 8v4"/><path d="M18 3c1.6 1.4 1.8 3 .2 4.6-1-.6-1.6-1.6-1.2-2.8M6 18l-2 2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 8-12h-6z"/>',
  snow2: '<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17"/><path d="M9.5 3.5L12 5l2.5-1.5M9.5 20.5L12 19l2.5 1.5"/><circle cx="12" cy="12" r="2.2"/>',
  leaves: '<path d="M4 20C4 12 9 7 17 6c-1 8-6 13-13 14zM4 20l7-7"/><path d="M14 4c3 0 5 1 6 3-2 1-4 1-6 0"/>',
  pillar: '<path d="M9 2h6v20H9z"/><path d="M5 22h14M7 2h10"/><path d="M12 6v12"/>',
};
function iconSvg(name, size = 22) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.circle}</svg>`;
}
const REALM_EMBLEM = [
  '<path d="M5 17h14l1-9-4 4-4-6-4 6-4-4z"/><path d="M5 20h14"/>',
  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="8" r="1.6"/><circle cx="8.6" cy="14" r="1.6"/><circle cx="15.4" cy="14" r="1.6"/>',
  '<path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/><circle cx="12" cy="12" r="2.5"/>',
];
function emblemSvg(realm, size = 28) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${REALM_EMBLEM[realm]}</svg>`;
}
