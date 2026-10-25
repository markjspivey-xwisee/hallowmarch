/* ================================================================== */
/* animals: taming, pets, livestock, paddocks, breeding                 */
/* ================================================================== */
// [animals] Wild wolves, boars, horses and deer can be won over: walk up calmly, hold out the food each kind likes,
// and trust grows feeding by feeding (it falls if you rush them or hurt them). A tamed wolf becomes a hound, a boar a
// pig, a wild horse your own mount, a deer a companion. Companions follow you along your own trail (round walls,
// through doorways, never stopping in one), and can be told to stay, follow, guard or attack; hounds fight beside you
// and grow in bond level. Sheep, cattle and hens live in the town pastures and in paddocks you fence yourself; they
// graze, drink, shelter from snow and storm, and give wool, milk, eggs and manure. A male and a female of a kind, fed
// and content, have young that grow up, with traits (coat, pattern, size, temperament, yield, speed, strength)
// inherited with variation; an animal card shows them and the parentage. Everything is saved with the character.
const AKIND = {
  hound: { label: 'hound', young: 'pup', m: 'hound', f: 'hound', likes: ['meat_raw', 'meat_cooked', 'fish_raw'], grow: 600, gest: 300, litter: [2, 3], scale: 0.95, radius: 0.5, speed: 7.6, crowd: 'hound', mob: 'wolf', fights: true, pet: true, need: 4, from: 'wolf', hp: 1, food: 0.0011, voice: 'bark' },
  pig: { label: 'pig', young: 'piglet', m: 'boar', f: 'sow', likes: ['apple', 'grain', 'turnip', 'cabbage', 'berries', 'mushrooms'], grow: 480, gest: 300, litter: [2, 4], scale: 1.0, radius: 0.55, speed: 5.4, crowd: 'pig', pet: true, need: 3, from: 'boar', food: 0.0012, voice: 'grunt' },
  horse: { label: 'horse', young: 'foal', m: 'stallion', f: 'mare', likes: ['apple', 'grain', 'turnip'], grow: 900, gest: 480, litter: [1, 1], scale: 1.0, radius: 0.8, speed: 8.5, crowd: 'horseTack', wildCrowd: 'horseWild', pet: true, mount: true, need: 4, from: 'horse', food: 0.001, voice: 'whinny' },
  deer: { label: 'deer', young: 'fawn', m: 'stag', f: 'hind', likes: ['apple', 'berries', 'grain'], grow: 600, gest: 420, litter: [1, 1], scale: 0.9, radius: 0.4, speed: 8.5, crowd: 'deer', pet: true, need: 3, from: 'deer', food: 0.001, voice: null },
  sheep: { label: 'sheep', young: 'lamb', m: 'ram', f: 'ewe', likes: ['grain', 'apple', 'turnip', 'cabbage'], grow: 600, gest: 360, litter: [1, 2], scale: 1.0, radius: 0.45, speed: 4.6, crowd: 'sheep', live: true, product: 'wool', price: [30, 25], food: 0.0016, voice: 'bleat' },
  cattle: { label: 'cattle', young: 'calf', m: 'bull', f: 'cow', likes: ['grain', 'turnip', 'cabbage', 'apple'], grow: 900, gest: 480, litter: [1, 1], scale: 1.0, radius: 0.75, speed: 4.2, crowd: 'cattle', live: true, product: 'milk', price: [55, 45], food: 0.0016, voice: 'moo' },
  hen: { label: 'hen', young: 'chick', m: 'cockerel', f: 'hen', likes: ['grain', 'berries', 'seed_grain'], grow: 360, gest: 240, litter: [2, 4], scale: 1.0, radius: 0.2, speed: 3.4, crowd: 'hen', live: true, product: 'egg', price: [8, 6], food: 0.002, voice: 'cluck' },
};
const ACOATS = {
  sheep: [[[0.9, 0.88, 0.82], [0.13, 0.11, 0.1]], [[0.86, 0.8, 0.68], [0.86, 0.82, 0.74]], [[0.58, 0.56, 0.53], [0.15, 0.13, 0.12]], [[0.16, 0.14, 0.13], [0.2, 0.17, 0.15]], [[0.47, 0.35, 0.25], [0.3, 0.22, 0.16]]],
  cattle: [[[0.46, 0.21, 0.1], [0.9, 0.88, 0.83]], [[0.08, 0.075, 0.075], [0.9, 0.88, 0.84]], [[0.7, 0.55, 0.36], [0.92, 0.88, 0.8]], [[0.88, 0.86, 0.8], [0.35, 0.18, 0.1]], [[0.3, 0.2, 0.14], [0.85, 0.82, 0.75]]],
  hen: [[[0.62, 0.34, 0.15], [0.12, 0.1, 0.09]], [[0.92, 0.9, 0.85], [0.75, 0.72, 0.66]], [[0.12, 0.11, 0.13], [0.82, 0.8, 0.78]], [[0.78, 0.6, 0.34], [0.5, 0.32, 0.15]], [[0.5, 0.48, 0.47], [0.1, 0.1, 0.1]]],
  hound: [[[0.45, 0.31, 0.18], [0.16, 0.12, 0.09]], [[0.13, 0.11, 0.1], [0.55, 0.4, 0.25]], [[0.82, 0.77, 0.67], [0.5, 0.42, 0.32]], [[0.5, 0.48, 0.46], [0.25, 0.24, 0.23]]],
  pig: [[[0.86, 0.62, 0.56], [0.16, 0.13, 0.13]], [[0.16, 0.13, 0.13], [0.86, 0.62, 0.56]], [[0.72, 0.43, 0.26], [0.2, 0.12, 0.08]]],
  horse: null, // HORSE_COATS (09b_mount.js) is read at boot: initAnimals
  deer: DEER_COLS.map((c) => [c, [c[0] * 0.55, c[1] * 0.5, c[2] * 0.45]]),
};
// each realm's own breeds on its common: Logres keeps cream sheep and red cattle, Ériu black-faced sheep and black
// cattle, Thule grey and brown sheep and dun cattle (indexes into ACOATS)
const REALM_BREEDS = [{ sheep: [1, 1, 0], cattle: [0, 0, 3] }, { sheep: [0, 0, 3], cattle: [1, 1, 4] }, { sheep: [2, 4, 3], cattle: [2, 2, 4] }];
const PET_NAMES = ['Brindle', 'Ash', 'Moss', 'Fennick', 'Sorrel', 'Tansy', 'Bracken', 'Wren', 'Hollin', 'Rook', 'Thistle', 'Burdock', 'Nettle', 'Clover', 'Sloe', 'Juniper', 'Fern', 'Hazel', 'Rowan', 'Pip', 'Dun', 'Blossom', 'Corrie', 'Tarn', 'Gorse', 'Heather', 'Oatcake', 'Bramble', 'Dapple', 'Smudge', 'Kestrel', 'Merry', 'Biddy', 'Tuppence', 'Grizzle', 'Hob'];
const PAT_NAMES = ['plain', 'patched', 'dappled', 'belted'];
registerGood('manure', { name: 'Basket of manure', plural: 'Baskets of manure', kind: 'material', icon: 'seed', value: 1, desc: 'Mucked out of a paddock. It feeds the fields.' });
registerGood('feed', { name: 'Sack of feed', plural: 'Sacks of feed', kind: 'material', icon: 'grain', value: 3, desc: 'Oats, beans and chopped hay for stock. Fills a paddock\'s rack for days.' });
registerGood('fence_kit', { name: 'Fence kit', kind: 'part', icon: 'hammer', value: 30, desc: 'Posts, rails, a gate, a trough and boards for a shed: everything for one paddock.' });
const ANIMALS_SHARED = { ready: false, trust: new Map(), claims: new Set(), consumed: new Map(), received: new Set() };
const ANIMALS = { list: [], pens: [], trust: new Map(), trail: [], nextAid: 1, nextPen: 1, marking: null, sel: null, uiT: 0, lastSave: '', down: [], hearts: [], lastFeedMsg: 0, inited: false, doors: [] };

/* ------------------------------------------------------------------ */
/* traits and inheritance                                              */
/* ------------------------------------------------------------------ */
const anGauss = (r = Math.random) => { const u = Math.max(1e-6, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
// pattern alleles: patched (1) and belted (3) are dominant, dappled (2) shows only from both parents
function anExpress(al) { if (al.includes(3)) return 3; if (al.includes(1)) return 1; if (al[0] === 2 && al[1] === 2) return 2; return 0; }
function anWildTraits(k, r = Math.random, base = null) {
  const coats = ACOATS[k] || ACOATS.sheep, c = base ? [base.colA, base.colB] : coats[Math.floor(r() * coats.length)];
  const pp = { cattle: 0.45, hen: 0.4, pig: 0.3, horse: 0.25 }[k] ?? 0.12;
  const al = [r() < pp ? 1 + Math.floor(r() * 3) : 0, r() < pp ? 1 + Math.floor(r() * 3) : 0];
  if (k === 'deer' || k === 'hound') al[0] = al[1] = 0;
  return {
    coat: c[0].map((v) => clamp(v * (0.92 + r() * 0.16), 0, 1)), coat2: c[1].map((v) => clamp(v * (0.92 + r() * 0.16), 0, 1)),
    al, seed: Math.floor(r() * 32),
    size: clamp(1 + anGauss(r) * 0.06, 0.82, 1.2), calm: clamp(0.5 + anGauss(r) * 0.15, 0.05, 1), yield: clamp(1 + anGauss(r) * 0.1, 0.6, 1.6),
    speed: clamp(1 + anGauss(r) * 0.06, 0.8, 1.3), strength: clamp(1 + anGauss(r) * 0.08, 0.7, 1.5),
  };
}
// the young take after both parents, with a little of their own
function anInherit(A, B, r = Math.random) {
  const mixc = (a, b) => { const t = r(); return a.map((v, i) => clamp(lerp(v, b[i], t) * (0.96 + r() * 0.08), 0, 1)); };
  const al = [A.al[Math.floor(r() * 2)], B.al[Math.floor(r() * 2)]];
  if (r() < 0.03) al[Math.floor(r() * 2)] = Math.floor(r() * 4);
  const num = (k, lo, hi, sd) => clamp((A[k] + B[k]) / 2 + anGauss(r) * sd, lo, hi);
  return {
    coat: mixc(A.coat, B.coat), coat2: mixc(A.coat2, B.coat2), al, seed: Math.floor(r() * 32),
    size: num('size', 0.75, 1.3, 0.035), calm: num('calm', 0, 1, 0.07), yield: num('yield', 0.5, 2.0, 0.06),
    speed: num('speed', 0.75, 1.45, 0.035), strength: num('strength', 0.6, 1.7, 0.045),
  };
}
function anCleanTraits(t, k) {
  const W0 = anWildTraits(k);
  if (!t || typeof t !== 'object') return W0;
  const col = (c, d) => (Array.isArray(c) && c.length === 3 && c.every((v) => isFiniteNum(+v)) ? c.map((v) => clamp(+v, 0, 1)) : d);
  const num = (v, lo, hi, d) => (isFiniteNum(+v) ? clamp(+v, lo, hi) : d);
  const al = Array.isArray(t.al) && t.al.length === 2 ? t.al.map((v) => clamp(Math.round(+v) || 0, 0, 3)) : W0.al;
  return { coat: col(t.coat, W0.coat), coat2: col(t.coat2, W0.coat2), al, seed: clamp(Math.round(+t.seed) || 0, 0, 31), size: num(t.size, 0.75, 1.3, 1), calm: num(t.calm, 0, 1, 0.5), yield: num(t.yield, 0.5, 2, 1), speed: num(t.speed, 0.75, 1.45, 1), strength: num(t.strength, 0.6, 1.7, 1) };
}
const anGrowth = (rec) => clamp(rec.age / AKIND[rec.k].grow, 0, 1);
const anAdult = (rec) => rec.age >= AKIND[rec.k].grow;
function anStage(rec) { const K = AKIND[rec.k]; if (!anAdult(rec)) return K.young; return rec.sex === 'm' ? K.m : K.f; }
function anScale(rec) { const g = anGrowth(rec), K = AKIND[rec.k]; return K.scale * rec.tr.size * (0.36 + 0.64 * Math.sqrt(g)) * (rec.k === 'cattle' && rec.sex === 'm' && g >= 1 ? 1.08 : 1) * (rec.k === 'hen' && rec.sex === 'm' ? 1.12 : 1); }
function anCrowdOf(rec) {
  const K = AKIND[rec.k];
  if (rec.k === 'sheep') return rec.prod.wool < 0.45 && anAdult(rec) ? 'sheepShorn' : 'sheep';
  if (rec.k === 'cattle') return rec.sex === 'm' && anAdult(rec) ? 'bull' : 'cattle';
  if (rec.k === 'horse') return rec.owner === 'wild' || !anAdult(rec) ? 'horseWild' : 'horseTack';
  if (rec.k === 'deer') return rec.sex === 'm' && anAdult(rec) ? 'stag' : 'deer';
  return K.crowd;
}
// what the patched beast shaders read from iColA.w: scale + 4 * pattern + 16 * seed (05j_farmbeasts.js)
function anLook(e) {
  const rec = e.tame, tr = rec.tr;
  e.scale = anScale(rec);
  e.crowd = anCrowdOf(rec);
  const patched = e.crowd !== 'deer' && e.crowd !== 'stag';
  e.visCode = patched ? 4 * anExpress(tr.al) + 16 * tr.seed : 0;
  const P = GAME.player;
  // a horse of yours wears a saddle cloth in your realm's colours (the beast shader's cloth and its light dapples)
  e.look = { colA: tr.coat.slice(), colB: rec.k === 'horse' && rec.owner === 'player' ? REALMS[P ? P.faction : 0].rgb.map((v) => v * 0.82) : tr.coat2.slice() };
  e.radius = AKIND[rec.k].radius;
}

/* ------------------------------------------------------------------ */
/* spawning animals                                                    */
/* ------------------------------------------------------------------ */
function anRecord(k, o = {}) {
  const sex = o.sex || (Math.random() < 0.5 ? 'm' : 'f');
  return {
    aid: ANIMALS.nextAid++, k, owner: o.owner || 'player', name: o.name || pick(Math.random, PET_NAMES), sex, gen: o.gen || 0,
    age: o.age ?? AKIND[k].grow * (1.2 + Math.random()), tr: o.tr || anWildTraits(k), ma: o.ma || null, pa: o.pa || null,
    cmd: o.cmd || (AKIND[k].live ? 'pen' : 'follow'), pen: o.pen ?? null, hunger: o.hunger ?? 0.9, thirst: o.thirst ?? 0.9, mood: 0.8,
    lvl: o.lvl || 1, xp: o.xp || 0, preg: null, breedAt: 0, prod: { wool: o.wool ?? Math.random(), milk: Math.random() * 0.6, egg: Math.random() * 0.6 },
    stay: null, down: 0, born: GAME.t,
  };
}
function anSpawn(rec, x, z, yaw = Math.random() * TAU) {
  const K = AKIND[rec.k], P = GAME.player;
  if (!isFiniteNum(x) || !isFiniteNum(z) || !isWalkable(x, z)) { const p = P ? { x: P.x, z: P.z } : { x: 0, z: 0 }; x = p.x + (Math.random() - 0.5) * 3; z = p.z + (Math.random() - 0.5) * 3; }
  const fights = K.fights && rec.owner === 'player';
  const e = makeEnt({
    kind: rec.k === 'deer' ? (rec.sex === 'm' && anAdult(rec) ? 'stag' : 'deer') : rec.k, faction: fights && P ? P.faction : FACTION_NEUTRAL, role: 'animal', name: rec.name, level: 1,
    x, z, y: heightAt(x, z), yaw, radius: K.radius, speed: K.speed, mobType: fights ? K.mob : null,
  });
  e.tame = rec;
  anLook(e);
  anStats(e);
  e.ai.mode = 'idle'; e.ai.until = GAME.t + Math.random() * 3;
  ANIMALS.list.push(e);
  if (rec.owner === 'player') ANIMALS.uiDirty = true; // [v9] a new companion shows on the bar at once
  return e;
}
function anStats(e) {
  const rec = e.tame, K = AKIND[rec.k], P = GAME.player;
  const g = anGrowth(rec);
  if (e.mobType) {
    e.level = clamp((P ? P.level : 1) - 2 + Math.min(4, Math.floor((rec.lvl - 1) / 2)), 1, LEVEL_CAP);
    // a hungry hound fights weaker
    e.tweak = { hp: (0.85 + 0.06 * (rec.lvl - 1)) * rec.tr.size * (0.4 + 0.6 * g), dmg: (0.8 + 0.05 * (rec.lvl - 1)) * rec.tr.strength * (0.3 + 0.7 * g) * (rec.hunger < 0.15 ? 0.7 : 1) };
    setupStats(e, true);
  } else {
    const hp = { pig: 220, horse: 400, deer: 160, sheep: 140, cattle: 380, hen: 30 }[rec.k] || 150;
    const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    e.maxHp = hp * rec.tr.size * (0.4 + 0.6 * g); e.hp = e.maxHp * clamp(ratio, 0.05, 1);
  }
  e.speed = K.speed * (rec.k === 'horse' ? rec.tr.speed : 1) * (0.75 + 0.25 * g);
}
const anOwned = (e) => e && e.tame && e.tame.owner === 'player' && !e.removed;
const anMine = () => ANIMALS.list.filter((e) => anOwned(e));
const anCompanions = () => anMine().filter((e) => e.alive && !AKIND[e.tame.k].live && e.tame.cmd !== 'pen');

/* ------------------------------------------------------------------ */
/* pens: the town pastures and the paddocks you fence yourself         */
/* ------------------------------------------------------------------ */
// a pen is a rectangle in its own frame (x across, z along), the gate in the middle of its front (+z) side, a water
// trough and a hay rack inside, and a lean-to shed across the back corner for shelter
function penWorld(pen, lx, lz) { const c = Math.cos(pen.yaw), s = Math.sin(pen.yaw); return { x: pen.x + lx * c + lz * s, z: pen.z - lx * s + lz * c }; }
function penLocal(pen, x, z) { const dx = x - pen.x, dz = z - pen.z, c = Math.cos(pen.yaw), s = Math.sin(pen.yaw); return { x: dx * c - dz * s, z: dx * s + dz * c }; }
function penHas(pen, x, z, m = 0) { const l = penLocal(pen, x, z); return Math.abs(l.x) < pen.hw - m && Math.abs(l.z) < pen.hd - m; }
const penById = (id) => ANIMALS.pens.find((p) => p.id === id) || null;
function penSpots(pen) {
  // the trough by the right-hand side, the hay rack on the left, the shed across the back left corner
  pen.trough = penWorld(pen, pen.hw - 1.0, pen.hd * 0.15);
  pen.rack = penWorld(pen, -pen.hw + 0.9, pen.hd * 0.2);
  pen.shedL = { x: -pen.hw + 2.0, z: -pen.hd + 1.6, hw: 1.9, hd: 1.45 };
  pen.shed = penWorld(pen, pen.shedL.x, pen.shedL.z);
  pen.gate = penWorld(pen, 0, pen.hd);
  pen.gateOut = penWorld(pen, 0, pen.hd + 1.6);
  pen.gateIn = penWorld(pen, 0, pen.hd - 1.6);
}
// is the ground here fit for a paddock? flat enough, walkable, clear of walls, houses, roads and trees
function penSiteOk(x, z, yaw, hw, hd) {
  const pen = { x, z, yaw, hw, hd };
  const h0 = heightAt(x, z);
  if (h0 < WATER_Y + 0.6 || inDungeonX(x)) return 'Not here';
  for (let i = -1; i <= 1; i += 0.25) for (let j = -1; j <= 1; j += 0.25) {
    const p = penWorld(pen, i * (hw + 0.6), j * (hd + 0.6));
    if (!isWalkable(p.x, p.z)) return 'The ground is too rough or wet here';
    if (Math.abs(heightAt(p.x, p.z) - h0) > 2.6) return 'The ground is too steep here';
    if (houseAt(p.x, p.z, 1)) return 'Too close to a house';
    if (sampleGrid(W.road, p.x, p.z) > 0.35) return 'Do not fence across a road';
    if (waterAt(p.x, p.z)) return 'Not in the water'; // [water] ponds and rivers (01b_water.js)
    if (plotAt(p.x, p.z, 0.8)) return 'Not over a tilled bed'; // [farming] beds and the town strips (08h_farming.js)
  }
  const near = [];
  collidersNear(x, z, Math.hypot(hw, hd) + 2, near);
  for (const c of near) {
    if (!c.active) continue;
    const l = penLocal(pen, c.x, c.z), r = c.type === 'circle' ? c.r : Math.max(c.hx, c.hz);
    if (Math.abs(l.x) < hw + r + 0.4 && Math.abs(l.z) < hd + r + 0.4) return c.tag === 'tree' ? 'A tree stands in the way' : 'Something stands in the way';
  }
  if (ANIMALS.pens.some((p) => dist(p.x, p.z, x, z) < Math.hypot(p.hw, p.hd) + Math.hypot(hw, hd) + 1)) return 'Too close to another paddock';
  if (SITES.some((S) => S.kind !== 'town' && dist2(S.x, S.z, x, z) < (S.r + 14) ** 2)) return 'Too close to a stronghold';
  return null;
}
const PEN_WOOD = [0.42, 0.31, 0.2];
function penBuild(pen) {
  penSpots(pen);
  const b = new Batch(), M = new THREE.Matrix4().compose(new THREE.Vector3(pen.x, 0, pen.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pen.yaw, 0)), new THREE.Vector3(1, 1, 1));
  const R = mulberry(pen.seed || 7);
  const wood = PEN_WOOD, dark = darker(wood, 0.72);
  const gy = (lx, lz) => { const p = penWorld(pen, lx, lz); return heightAt(p.x, p.z); };
  const gateHW = 1.3;
  pen.colliders = [];
  // the four sides: posts every two metres or so, three rails following the ground
  const sides = [[[-pen.hw, -pen.hd], [pen.hw, -pen.hd]], [[pen.hw, -pen.hd], [pen.hw, pen.hd]], [[pen.hw, pen.hd], [gateHW, pen.hd]], [[-gateHW, pen.hd], [-pen.hw, pen.hd]], [[-pen.hw, pen.hd], [-pen.hw, -pen.hd]]];
  for (const [A, B] of sides) {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]), n = Math.max(1, Math.round(len / 2.1));
    const yaw = Math.atan2(B[0] - A[0], B[1] - A[1]);
    for (let i = 0; i <= n; i++) {
      const lx = lerp(A[0], B[0], i / n), lz = lerp(A[1], B[1], i / n), y = gy(lx, lz);
      b.add(G.box, lm(M, lx, y + 0.6, lz, R() * 0.3, 0.13, 1.3, 0.13, (R() - 0.5) * 0.05, (R() - 0.5) * 0.05), MAT.wood, darker(wood, 0.7 + R() * 0.2), y, 1.2);
      if (i < n) {
        const lx1 = lerp(A[0], B[0], (i + 1) / n), lz1 = lerp(A[1], B[1], (i + 1) / n), y1 = gy(lx1, lz1);
        for (const ry of [0.32, 0.7, 1.05]) {
          const seg = Math.hypot(lx1 - lx, lz1 - lz), pitch = Math.atan2(y1 - y, seg);
          b.add(G.box, lm(M, (lx + lx1) / 2, (y + y1) / 2 + ry, (lz + lz1) / 2, yaw, 0.06, 0.1, Math.hypot(seg, y1 - y) + 0.12, -pitch), MAT.wood, darker(wood, 0.82 + R() * 0.12));
        }
      }
    }
    const mid = penWorld(pen, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
    pen.colliders.push(addBox(mid.x, mid.z, 0.12, len / 2 + 0.06, pen.yaw + yaw, 'fence', 1.25));
  }
  // gate posts, taller, with a cross bar
  for (const sx of [-1, 1]) { const y = gy(sx * gateHW, pen.hd); b.add(G.box, lm(M, sx * gateHW, y + 0.8, pen.hd, 0, 0.18, 1.7, 0.18), MAT.wood, dark, y, 1.6); }
  // the water trough
  { const l = { x: pen.hw - 1.0, z: pen.hd * 0.15 }, y = gy(l.x, l.z); b.add(G.box, lm(M, l.x, y + 0.28, l.z, 0, 0.62, 0.56, 1.7), MAT.wood, darker(wood, 0.8), y, 0.6); b.add(G.box, lm(M, l.x, y + 0.51, l.z, 0, 0.48, 0.04, 1.56), MAT.water, [0.1, 0.16, 0.2]); const tp = penWorld(pen, l.x, l.z); pen.colliders.push(addBox(tp.x, tp.z, 0.34, 0.88, pen.yaw, 'prop', 0.6)); }
  // the hay rack: a slatted manger on legs
  {
    const l = { x: -pen.hw + 0.9, z: pen.hd * 0.2 }, y = gy(l.x, l.z);
    for (const sz of [-0.8, 0.8]) for (const sx of [-0.25, 0.25]) b.add(G.box, lm(M, l.x + sx, y + 0.55, l.z + sz, 0, 0.08, 1.1, 0.08), MAT.wood, dark, y, 1);
    b.add(G.box, lm(M, l.x, y + 0.45, l.z, 0, 0.6, 0.06, 1.7), MAT.wood, darker(wood, 0.85));
    for (let i = 0; i < 7; i++) b.add(G.box, lm(M, l.x + 0.22, y + 0.8, l.z - 0.75 + i * 0.25, 0, 0.04, 0.6, 0.04, 0, -0.35), MAT.wood, darker(wood, 0.9));
    pen.hay = b.n; // the hay itself is drawn while there is feed (penDrawFeed)
    const rp = penWorld(pen, l.x, l.z); pen.colliders.push(addBox(rp.x, rp.z, 0.36, 0.92, pen.yaw, 'prop', 1.1));
  }
  // the lean-to: four posts, a back wall of boards and a sloping roof of boards
  {
    const S = pen.shedL, y = gy(S.x, S.z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const ph = sz < 0 ? 2.3 : 1.8; b.add(G.box, lm(M, S.x + sx * S.hw, y + ph / 2, S.z + sz * S.hd, 0, 0.15, ph, 0.15), MAT.wood, dark, y, ph); }
    for (let i = 0; i < 6; i++) b.add(G.box, lm(M, S.x, y + 0.3 + i * 0.32, S.z - S.hd - 0.02, 0, S.hw * 2 + 0.2, 0.3, 0.05), MAT.wood, darker(wood, 0.78 + R() * 0.15), y, 2.2);
    const slope = Math.atan2(0.5, S.hd * 2);
    for (let i = 0; i < 9; i++) b.add(G.box, lm(M, S.x - S.hw - 0.15 + (i + 0.5) * ((S.hw * 2 + 0.3) / 9), y + 2.08, S.z, 0, (S.hw * 2 + 0.3) / 9 + 0.01, 0.05, S.hd * 2 + 0.5, slope), MAT.shingle, darker([0.36, 0.27, 0.19], 0.85 + R() * 0.2));
    const bw = penWorld(pen, S.x, S.z - S.hd);
    pen.colliders.push(addBox(bw.x, bw.z, S.hw + 0.1, 0.1, pen.yaw, 'fence', 2.3));
  }
  const m = new THREE.Mesh(b.build(), buildingMat);
  m.renderOrder = 1; scene.add(m);
  if (typeof BUILDING_DEPTH !== 'undefined' && BUILDING_DEPTH) shadowCaster(m, BUILDING_DEPTH);
  pen.mesh = m;
  // the gate: a hinged leaf of rails on the left post that swings in when someone walks up to it
  {
    const gb = new Batch(), G0 = new THREE.Matrix4();
    const yh = gy(-gateHW, pen.hd), yr = gy(gateHW, pen.hd);
    for (const ry of [0.35, 0.72, 1.08]) gb.add(G.box, lm(G0, gateHW, ry + (yr - yh) / 2, 0, 0, gateHW * 2 - 0.1, 0.1, 0.06), MAT.wood, darker(wood, 0.9));
    for (const x of [0.12, gateHW, gateHW * 2 - 0.12]) gb.add(G.box, lm(G0, x, 0.72, 0, 0, 0.09, 0.9, 0.07), MAT.wood, dark);
    gb.add(G.box, lm(G0, gateHW, 0.72, 0.035, 0, Math.hypot(gateHW * 2 - 0.24, 0.72), 0.07, 0.05, 0, Math.atan2(0.72, gateHW * 2 - 0.24)), MAT.wood, darker(wood, 0.8));
    const gm = new THREE.Mesh(gb.build(), buildingMat);
    const hp = penWorld(pen, -gateHW, pen.hd);
    gm.position.set(hp.x, yh, hp.z); gm.rotation.y = pen.yaw; gm.renderOrder = 1;
    scene.add(gm);
    if (typeof BUILDING_DEPTH !== 'undefined' && BUILDING_DEPTH) shadowCaster(gm, BUILDING_DEPTH);
    pen.gateMesh = gm; pen.gateOpen = 0; pen.gateWant = 0;
    const gc = penWorld(pen, 0, pen.hd);
    pen.gateColl = addBox(gc.x, gc.z, 0.12, gateHW, pen.yaw + Math.PI / 2, 'fence', 1.25);
    pen.colliders.push(pen.gateColl);
  }
  // no blades up through the posts, the trough, the rack or the shed floor (the 1 m cover map)
  if (typeof coverBox === 'function' && COVER.built) {
    for (const c of pen.colliders) if (c !== pen.gateColl) coverBox(c.x, c.z, c.hx, c.hz, c.cos, c.sin, 0.25);
    COVER.tex.needsUpdate = true;
  }
  pen.hayMesh = null;
}
function penRemove(pen) {
  for (const c of pen.colliders || []) { c.active = false; }
  for (const m of [pen.mesh, pen.gateMesh]) if (m) { m.removeFromParent(); m.geometry.dispose(); } // [phones] out of the outdoor group too
  ANIMALS.pens.splice(ANIMALS.pens.indexOf(pen), 1);
}
function penMake(o) {
  const pen = { id: o.id ?? ANIMALS.nextPen++, owner: o.owner || 'player', realm: o.realm ?? -1, x: o.x, z: o.z, yaw: o.yaw || 0, hw: o.hw || 6, hd: o.hd || 4.5, feed: o.feed ?? 6, water: o.water ?? 10, manure: o.manure ?? 0, seed: o.seed || Math.floor(Math.random() * 1e6), name: o.name || 'Paddock', sharedOwner: typeof o.sharedOwner === 'string' ? o.sharedOwner.slice(0, 160) : null };
  ANIMALS.pens.push(pen);
  penBuild(pen);
  return pen;
}
// each town's pasture lies in the fields outside the houses, its gate toward the town
function townPastureSpot(R) {
  const T = R.town, rnd = mulberry(5150 + R.id * 17);
  for (let tries = 0; tries < 260; tries++) {
    const a = T.yaw + Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 1.4, d = 50 + rnd() * 26;
    const x = T.x + Math.sin(a) * d, z = T.z + Math.cos(a) * d;
    const yaw = Math.atan2(T.x - x, T.z - z); // the front (+z, the gate) faces the town
    if (!penSiteOk(x, z, yaw, 11, 8)) return { x, z, yaw };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
function initAnimals() {
  ACOATS.horse = HORSE_COATS.map((c) => [c, [0.86, 0.84, 0.8]]);
  buildFarmCrowds();
  Object.assign(SHADOW_R, { sheep: 0.62, cattle: 1.0, hen: 0.22, pig: 0.66, hound: 0.66 });
  Object.assign(STAMP_R, { sheep: 0.5, cattle: 0.75, hen: 0.15, pig: 0.55, hound: 0.5 });
  for (const H of HOUSES) if (H.door && H.door.F) {
    const F = H.door.F, lx = F.ox + (H.door.u || 0) * F.ux, lz = F.oz + (H.door.u || 0) * F.uz;
    const c = Math.cos(H.yaw ?? 0), s = Math.sin(H.yaw ?? 0);
    ANIMALS.doors.push({ x: H.x + lx * c + lz * s, z: H.z - lx * s + lz * c });
  }
  // the town pastures with their flocks and herds, and hens scratching about
  for (const R of REALMS) {
    const sp = townPastureSpot(R);
    if (!sp) continue;
    const pen = penMake({ owner: 'town', realm: R.id, x: sp.x, z: sp.z, yaw: sp.yaw, hw: 11, hd: 8, feed: 40, water: 40, seed: 900 + R.id, name: `${R.townName} common` });
    R.pasture = pen;
    const r = mulberry(7100 + R.id * 3);
    const flock = [['sheep', 'm'], ['sheep', 'f'], ['sheep', 'f'], ['sheep', 'f'], ['sheep', 'f'], ['sheep', 'f'], ['cattle', 'm'], ['cattle', 'f'], ['cattle', 'f'], ['hen', 'm'], ['hen', 'f'], ['hen', 'f'], ['hen', 'f'], ['hen', 'f']];
    for (const [k, sex] of flock) {
      const br = REALM_BREEDS[R.id][k], ci = br ? br[Math.floor(r() * br.length)] : -1;
      const rec = anRecord(k, { owner: 'town', sex, tr: anWildTraits(k, r, ci >= 0 ? { colA: ACOATS[k][ci][0], colB: ACOATS[k][ci][1] } : null), name: pick(r, PET_NAMES), cmd: 'pen', pen: pen.id, wool: 0.3 + r() * 0.7 });
      rec.breedAt = GAME.t + 200 + r() * 400;
      const p = penWorld(pen, (r() - 0.5) * (pen.hw * 2 - 3), (r() - 0.5) * (pen.hd * 2 - 3));
      anSpawn(rec, p.x, p.z);
    }
    // a lamb and a calf with their mothers
    const ewe = ANIMALS.list.find((e) => e.tame.pen === pen.id && e.tame.k === 'sheep' && e.tame.sex === 'f');
    if (ewe) { const L = anRecord('sheep', { owner: 'town', sex: 'f', age: 120, tr: anInherit(ewe.tame.tr, ewe.tame.tr, r), cmd: 'pen', pen: pen.id, ma: { aid: ewe.tame.aid, name: ewe.tame.name } }); anSpawn(L, ewe.x + 0.8, ewe.z); }
  }
  initWildHorses();
  anBuildUI();
  window.addEventListener('keydown', (ev) => {
    if (!GAME.started || typing() || gameplayKeyIgnored(ev) || ev.repeat) return;
    if (ev.code === 'KeyK') { if (UI.modal === 'dialog' && ANIMALS.dlg) anCloseDialog(); else if (!UI.modal) openAnimals(); }
    // Esc while marking out a paddock stops marking (and nothing else)
    if (ev.code === 'Escape' && ANIMALS.marking && !UI.modal) { ANIMALS.marking = null; ANIMALS.uiDirty = true; uiLog('You stop marking out the paddock.', 'sys'); ev.stopImmediatePropagation(); }
  }, true);
  registerSavePart('char', 'animals', { save: animalsSave, load: animalsLoad, key: animalsKey });
  animalsNotes();
  window.__hm.animals = ANIMALS_DEBUG;
  ANIMALS.inited = true;
}
// wild horses on the open downs of each homeland: a stallion, his mares and sometimes a foal
function initWildHorses() {
  const r = mulberry(6600);
  for (const R of REALMS) {
    let made = 0;
    for (let tries = 0; tries < 900 && made < 2; tries++) {
      const a = R.bearing + (r() - 0.5) * 1.5, d = R_RING + 60 + r() * 150;
      const x = Math.sin(a) * d, z = -Math.cos(a) * d;
      if (Math.hypot(x, z) > 450 || !isWalkable(x, z)) continue;
      const h = heightAt(x, z);
      if (h < WATER_Y + 1 || h > 18) continue;
      if (sampleGrid(W.grass, x, z) < 0.55 || sampleGrid(W.road, x, z) > 0.05) continue;
      if (CAMPS.some((c) => dist2(c.x, c.z, x, z) < 60 * 60)) continue;
      if (SITES.some((S) => dist2(S.x, S.z, x, z) < (S.r + 40) ** 2)) continue;
      let ok = true;
      for (let s = 0; s < 8 && ok; s++) { const aa = (s / 8) * TAU; if (!isWalkable(x + Math.sin(aa) * 16, z + Math.cos(aa) * 16)) ok = false; }
      if (!ok) continue;
      const herd = { x, z, r: 20, id: 'h' + R.id + made };
      const n = 4 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const rec = anRecord('horse', { owner: 'wild', sex: i === 0 ? 'm' : 'f', tr: anWildTraits('horse', r), cmd: 'wild', name: 'wild horse' });
        rec.herd = herd;
        if (i === n - 1 && r() < 0.6) { rec.age = 200 + r() * 300; rec.sex = r() < 0.5 ? 'm' : 'f'; }
        anSpawn(rec, x + (r() - 0.5) * 10, z + (r() - 0.5) * 10);
      }
      made++;
    }
  }
}

/* ------------------------------------------------------------------ */
/* taming                                                              */
/* ------------------------------------------------------------------ */
// which wild creature this is, for taming: a camp wolf or boar, a wild horse, a deer
function anWildKind(e) {
  if (!e || !e.alive || e.removed) return null;
  if (e.role === 'mob' && e.camp != null && !e.elite && (e.mobType === 'wolf' || e.mobType === 'boar')) return e.mobType === 'wolf' ? 'hound' : 'pig';
  if (e.role === 'animal' && e.tame && e.tame.owner === 'wild') return 'horse';
  if (e.role === 'critter' && (e.kind === 'deer' || e.kind === 'stag')) return 'deer';
  return null;
}
const anFoodFor = (k) => AKIND[k].likes.find((id) => goodsHave(id)) || null;
// the player is calm: on foot, not sprinting, not fighting
function anPlayerCalm(P) { return P && P.alive && !P.mount && GAME.t > P.combatUntil && (P._anSp || 0) < 7.4; }
function anTrust(e) {
  let T = ANIMALS.trust.get(e.id);
  if (!T) { const k = anWildKind(e); T = { n: 0, need: AKIND[k].need + (k === 'horse' && e.tame && e.tame.tr.calm < 0.4 ? 1 : 0), last: -99, settle: 0, hitAt: e.lastHitAt, k }; ANIMALS.trust.set(e.id, T); }
  return T;
}
// every step for wild creatures near the player: they settle while you are calm and close, take fright if you rush
function anTamingStep(dt) {
  const P = GAME.player;
  if (!P || !P.alive) return;
  const step = Math.hypot(P.x - (P._anX ?? P.x), P.z - (P._anZ ?? P.z));
  P._anX = P.x; P._anZ = P.z;
  // a portal or a teleport is not a sprint
  if (step < 3) P._anSp = lerp(P._anSp || 0, step / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 6));
  const rushing = P.mount || P._anSp > 7.6;
  forNear(P.x, P.z, 16, (e, d2) => {
    const k = anWildKind(e);
    if (!k) return;
    const T = anTrust(e);
    // hurt by you: all trust is gone
    if (e.lastHitAt > T.hitAt) { T.hitAt = e.lastHitAt; if (e.lastHitBy === P.id && T.n > 0) { T.n = 0; T.settle = 0; uiLog(`The ${anWildName(e)} no longer trusts you.`, 'warn'); } }
    if (rushing && d2 < 14 * 14) {
      if (T.settle > 0.2 || (T.n > 0 && GAME.t - (T.rushAt || -99) > 4)) {
        if (T.n > 0 && GAME.t - (T.rushAt || -99) > 4) { T.n = Math.max(0, T.n - 1); uiLog(`You startle the ${anWildName(e)}. Approach calmly, on foot.`, 'warn'); }
        T.rushAt = GAME.t;
      }
      T.settle = 0;
      if (e.role === 'animal' && anSharedWorldCanSimulate()) anStartle(e, P.x, P.z);
    } else if (d2 < 9 * 9 && anPlayerCalm(P)) {
      T.settle = Math.min(1, T.settle + dt / (P._anSp < 1.5 ? 2.2 : 5));
      // it stops to watch you come
      if (anSharedWorldCanSimulate() && !(e.ai.flee && GAME.t < e.ai.flee.until) && GAME.t > P.combatUntil && !e.target) { e.ai.tameHold = Math.max(e.ai.tameHold || 0, GAME.t + 0.6); turnToward(e, P.x, P.z, dt * 2.5); if (T.settle > 0.6 && !e.anim.act && Math.random() < dt * 0.3) setAct(e, 5, 1.5); }
    }
    else T.settle = Math.max(0, T.settle - dt / 8);
  });
}
const anWildName = (e) => (e.role === 'mob' ? e.name : e.kind === 'stag' ? 'stag' : e.kind === 'deer' ? 'hind' : 'wild horse');
function anOffer(e) {
  const P = GAME.player, k = anWildKind(e);
  if (!P || !k) return;
  const T = anTrust(e), food = anFoodFor(k);
  if (dist(P.x, P.z, e.x, e.z) > 5.5) { uiError('Get closer'); return; }
  if (!anPlayerCalm(P)) { uiError('Calm down first: on foot, out of the fight, walking'); return; }
  if (!food) { uiError(`It wants ${AKIND[k].likes.slice(0, 2).map((id) => goodName(id, 2).toLowerCase()).join(' or ')}`); return; }
  if (T.settle < 1) { uiError('It is still wary of you. Stand still a moment.'); return; }
  if (GAME.t - T.last < 5) { uiError('It is still eating'); return; }
  if (typeof netWorldPartsActive === 'function' && netWorldPartsActive() && !anSharedWorldCanSimulate() && !e.netEntityId) { uiError('Waiting for the shared animal.'); return; }
  if (typeof netWorldPartsRequest === 'function' && e.netEntityId && netWorldPartsRequest('animal.offer', { id: e.netEntityId, food }, [[food, 1]])) return;
  goodsTake(food, 1);
  T.n++; T.last = GAME.t;
  faceToward(e, P.x, P.z);
  setAct(e, 7, 3.2);
  e.ai.tameHold = GAME.t + 6;
  anHearts(e, T.n >= T.need ? 10 : 4);
  anVoice(e.tame ? e.tame.k : k, e);
  if (T.n >= T.need) { anTame(e, k); return; }
  uiLog(`The ${anWildName(e)} takes the ${goodName(food).toLowerCase()} from your hand. Trust ${T.n} of ${T.need}.`, 'loot');
  loreNote('tame');
}
function anTame(e, k) {
  if (!anSharedWorldCanSimulate()) return;
  if (e.netEntityId) ANIMALS_SHARED.claims.add(e.netEntityId);
  ANIMALS.trust.delete(e.id);
  let rec;
  if (e.role === 'animal' && e.tame) {
    // a wild horse: it is yours now, saddle and all
    rec = e.tame; rec.owner = 'player'; rec.cmd = 'follow'; rec.name = pick(Math.random, PET_NAMES); rec.herd = null;
    e.name = rec.name;
    anLook(e); anStats(e);
  } else {
    const sex = e.kind === 'stag' ? 'm' : e.kind === 'deer' ? 'f' : Math.random() < 0.5 ? 'm' : 'f';
    rec = anRecord(k, { owner: 'player', sex, tr: anWildTraits(k, Math.random, e.look && e.look.colA ? { colA: e.look.colA, colB: e.look.colB || e.look.colA.map((v) => v * 0.55) } : null), cmd: 'follow' });
    if (k === 'hound') rec.tr.coat = rec.tr.coat.map((v) => clamp(v * 1.05, 0, 1));
    const x = e.x, z = e.z, yaw = e.yaw;
    if (e.camp != null && CAMPS[e.camp]) { CAMPS[e.camp].members.delete(e.id); CAMPS[e.camp].respawnAt.push(GAME.t + 90 + Math.random() * 60); }
    if (e.herd != null && e.role === 'critter') e.herd = -1;
    removeEnt(e);
    const ne = anSpawn(rec, x, z, yaw);
    ne.hp = ne.maxHp;
  }
  FX.levelUp(e.x, e.y, e.z);
  sfx('fanfare');
  uiToast(`${rec.name} the ${anStage(rec)} is yours. ${IS_TOUCH ? 'Tap Animals to see them all' : 'Press K for your animals'}.`, 'quest'); // [guide] a phone has no K
  uiLog(`You have tamed a ${AKIND[k].label}. You name it ${rec.name}; rename it on its card.`, 'loot');
  ANIMALS.tamedCount = (ANIMALS.tamedCount || 0) + 1;
  loreNote('pets');
  saveSoon();
}

/* ------------------------------------------------------------------ */
/* the player's trail, and finding a way to the player                 */
/* ------------------------------------------------------------------ */
function anTrailStep() {
  const P = GAME.player, T = ANIMALS.trail;
  if (!P) return;
  const last = T[T.length - 1];
  if (!last || dist2(last.x, last.z, P.x, P.z) > 0.8 * 0.8) {
    if (last && dist2(last.x, last.z, P.x, P.z) > 30 * 30) T.length = 0; // a portal or a teleport: start again
    T.push({ x: P.x, z: P.z });
    if (T.length > 90) T.shift();
  }
}
const anDoorNear = (x, z, r = 1.8) => ANIMALS.doors.some((d) => dist2(d.x, d.z, x, z) < r * r) || WAR.keeps.some((K) => K.door && K.door.alive && dist2(K.door.x, K.door.z, x, z) < 4 * 4) || ANIMALS.pens.some((p) => p.gate && dist2(p.gate.x, p.gate.z, x, z) < 2.0 * 2.0);
// where a companion waits by the player: behind and to the side, never in a doorway
function anSlot(e, i) {
  const P = GAME.player;
  const offs = [[-1.7, -1.5], [1.7, -1.5], [-2.4, 0.2], [2.4, 0.2], [0, -2.6], [-3, -2.4], [3, -2.4]];
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  for (let k = 0; k < offs.length; k++) {
    const [ox, oz] = offs[(i + k) % offs.length];
    const sc = 1 + (e.tame.k === 'horse' ? 0.6 : 0);
    const x = P.x + (ox * c + oz * s) * sc, z = P.z + (-ox * s + oz * c) * sc;
    if (!isWalkable(x, z) || anDoorNear(x, z) || houseAt(x, z, 0.4) && !houseAt(P.x, P.z)) continue;
    if (!segmentClear(P.x, P.z, x, z, 0.3)) continue; // [v9] never on the far side of a wall from you
    return { x, z };
  }
  return { x: P.x - Math.sin(P.yaw) * 2, z: P.z - Math.cos(P.yaw) * 2 };
}
// [v10] where a companion that cannot find its way comes back in: on your trail a few metres behind you, or, when the
// trail is far behind (after a ride, a fall or a jump), at its waiting spot beside you
function anCatchUpSpot(e) {
  const P = GAME.player, T = ANIMALS.trail;
  for (let i = T.length - 1; i >= 0; i--) {
    const p = T[i], dd = dist(p.x, p.z, P.x, P.z);
    if (dd > 12) break;
    if (dd >= 2.5 && isWalkable(p.x, p.z) && segmentClear(P.x, P.z, p.x, p.z, 0.3)) return p;
  }
  return anSlot(e, Math.max(0, anCompanions().indexOf(e)));
}
// whether a body is on the screen now (and near enough to be made out)
function anOnScreen(e) {
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) > 80 * 80) return false;
  const s = screenOf(e.x, e.y + 0.6, e.z);
  return !!s && s.x > -30 && s.x < view.w + 30 && s.y > -30 && s.y < view.h + 30;
}
// a straight way that crosses no paddock fence (except through a gate) and no wall: segmentClear samples every
// metre and a half and can step over a thin fence, so the pens are clipped exactly (Liang-Barsky in each pen's frame)
function anClip(A, B, hw, hd) {
  const dx = B.x - A.x, dz = B.z - A.z;
  let t0 = 0, t1 = 1;
  for (const [pp, q] of [[-dx, A.x + hw], [dx, hw - A.x], [-dz, A.z + hd], [dz, hd - A.z]]) {
    if (Math.abs(pp) < 1e-9) { if (q < 0) return null; continue; }
    const t = q / pp;
    if (pp < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0, t1];
}
function anSegClear(ax, az, bx, bz, swim) {
  ANIMALS.blockPen = null;
  for (const pn of ANIMALS.pens) {
    const r = Math.hypot(pn.hw, pn.hd) + 1;
    if (Math.min(ax, bx) > pn.x + r || Math.max(ax, bx) < pn.x - r || Math.min(az, bz) > pn.z + r || Math.max(az, bz) < pn.z - r) continue;
    const A = penLocal(pn, ax, az), B = penLocal(pn, bx, bz);
    const iA = Math.abs(A.x) < pn.hw && Math.abs(A.z) < pn.hd, iB = Math.abs(B.x) < pn.hw && Math.abs(B.z) < pn.hd;
    if (iA && iB) continue; // within the one pen
    if (iA !== iB) {
      // in or out once: only through the gate, in the middle of the front side
      const c = anClip(A, B, pn.hw, pn.hd);
      if (!c) continue;
      const t = iA ? c[1] : c[0], cx = A.x + (B.x - A.x) * t, cz = A.z + (B.z - A.z) * t;
      if (!(Math.abs(cx) < 1.0 && cz > pn.hd - 0.05)) { ANIMALS.blockPen = pn; return false; }
      continue;
    }
    // both outside: not across it (a little short of each corner, so the way round a corner counts as clear)
    if (anClip(A, B, pn.hw, pn.hd)) { ANIMALS.blockPen = pn; return false; }
  }
  // [v10] and over no ground a body cannot walk on (a steep bank, the foot of a crag; deep water, unless it swims):
  // a companion pressing straight at you across one never got anywhere
  const L = dist(ax, az, bx, bz), n = Math.ceil(L / 0.9), ok = swim ? swimPassable : isWalkable;
  for (let i = 1; i < n; i++) { const t = i / n; if (!ok(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
  return segmentClear(ax, az, bx, bz, 0.3, false);
}
// walk toward (tx, tz): straight when the way is clear, otherwise along the player's trail
function anGoTo(e, tx, tz, dt, mul, stop, useTrail) {
  const ai = e.ai;
  // a detour once chosen is kept until it is reached (or a few seconds pass), so the way round does not flicker
  if (GAME.t > (ai.wpT || 0) && !(ai.wp && ai.wp.side && GAME.t < ai.wp.until)) {
    ai.wpT = GAME.t + 0.35 + Math.random() * 0.2;
    ai.wp = null;
    if (!anSegClear(e.x, e.z, tx, tz, e.swimOK)) {
      const block = ANIMALS.blockPen;
      if (useTrail) {
        const T = ANIMALS.trail;
        for (let i = T.length - 1; i >= Math.max(0, T.length - 60); i--) {
          const p = T[i];
          if (dist2(p.x, p.z, e.x, e.z) > 40 * 40) continue;
          if (anSegClear(e.x, e.z, p.x, p.z, e.swimOK)) { ai.wp = p; break; }
        }
      }
      // [v10] a companion finds its way round houses, walls and fences on a small grid (08f_townlife.js localPath)
      if (!ai.wp && useTrail && !block) {
        const way = localPath(e.x, e.z, tx, tz, 0.45);
        if (way && way.length > 1) { const w0 = way[0]; ai.wp = { x: w0.x, z: w0.z, side: true, until: GAME.t + 2 + dist(e.x, e.z, w0.x, w0.z) / Math.max(1, effectiveSpeed(e) * mul) }; ai.lastWp = w0; }
      }
      if (!ai.wp) {
        // round the obstacle: steps to either side, and the corners of any paddock in the way; the reachable one that
        // leaves the shortest way on wins
        const a = Math.atan2(tx - e.x, tz - e.z), cands = [];
        // a paddock in the way: round it by its corners; anything else: a step to either side
        if (block) { for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const c = penWorld(block, sx * (block.hw + 1.6), sz * (block.hd + 1.6)); if (dist2(c.x, c.z, e.x, e.z) > 1.2) cands.push(c); } }
        else for (const da of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) for (const r of [3, 7]) cands.push({ x: e.x + Math.sin(a + da) * r, z: e.z + Math.cos(a + da) * r });
        let best = null, bs = Infinity;
        for (const c of cands) {
          const sc = dist(e.x, e.z, c.x, c.z) + dist(c.x, c.z, tx, tz) + (ai.lastWp && dist2(c.x, c.z, ai.lastWp.x, ai.lastWp.z) < 1 ? 6 : 0);
          if (sc >= bs || !isWalkable(c.x, c.z) || !useTrail && ANIMALS.pens.some((pn) => penHas(pn, c.x, c.z, -0.6) && !penHas(pn, tx, tz, -0.6)) || !anSegClear(e.x, e.z, c.x, c.z, e.swimOK)) continue;
          bs = sc; best = c;
        }
        if (!best && block) {
          // pressed against the paddock: first a step straight out from its nearest side
          const l = penLocal(block, e.x, e.z), byX = Math.abs(l.x) / block.hw > Math.abs(l.z) / block.hd;
          best = penWorld(block, byX ? l.x + Math.sign(l.x) * 2 : l.x, byX ? l.z : l.z + Math.sign(l.z) * 2);
        }
        if (best) { ai.wp = { x: best.x, z: best.z, side: true, until: GAME.t + 3 + dist(e.x, e.z, best.x, best.z) / Math.max(1, effectiveSpeed(e) * mul) }; ai.lastWp = best; }
      }
    }
  }
  const g = ai.wp || { x: tx, z: tz };
  const bx = e.x, bz = e.z;
  const done = moveToward(e, g.x, g.z, dt, mul, ai.wp ? 0.3 : stop);
  if (ai.wp && done) { ai.wp = null; ai.wpT = 0; }
  // stuck: no progress for a while
  const moved = Math.abs(e.x - bx) + Math.abs(e.z - bz);
  ai.stuck = moved < effectiveSpeed(e) * mul * dt * 0.15 && !done ? (ai.stuck || 0) + dt : 0;
  return !ai.wp && done;
}

/* ------------------------------------------------------------------ */
/* the mind of an animal                                               */
/* ------------------------------------------------------------------ */
function thinkAnimal(e, dt) {
  const rec = e.tame;
  if (!rec) return;
  if (rec.cmd === 'herd' && depthHerdThink(e, dt)) return; // [depth] a hound herding the sheep home (09u_depth.js)
  const P = GAME.player;
  const far = P ? dist2(e.x, e.z, P.x, P.z) : 0;
  // the young keep close to their mothers until they are grown
  if (rec.owner === 'wild') { anWildThink(e, dt, far); return; }
  if (rec.owner === 'player' && rec.cmd !== 'pen' && !AKIND[rec.k].live || rec.cmd === 'follow' || rec.cmd === 'stay' || rec.cmd === 'guard' || rec.cmd === 'attack') { if (anPetThink(e, dt)) return; }
  if (rec.cmd === 'pen' || rec.owner === 'town') {
    if (far > 160 * 160 && rec.owner === 'town') { e.prevX = e.x; e.prevZ = e.z; return; }
    anPenThink(e, dt);
  }
}
function anMother(e) {
  const rec = e.tame;
  if (!rec.ma || anAdult(rec)) return null;
  const m = ANIMALS.list.find((o) => o.tame && o.tame.aid === rec.ma.aid && o.tame.owner === rec.owner && (!e.netEntityOwner || o.netEntityOwner === e.netEntityOwner) && o.alive && !o.removed);
  return m || null;
}
function anStartle(e, x, z) {
  const ai = e.ai;
  if (GAME.t < (ai.calmAt || 0)) return;
  const a = Math.atan2(e.x - x, e.z - z) + (Math.random() - 0.5) * 0.8;
  ai.flee = { x: e.x + Math.sin(a) * 14, z: e.z + Math.cos(a) * 14, until: GAME.t + 2.5 + Math.random() * 1.5 };
  const pen = e.tame && e.tame.cmd === 'pen' && penById(e.tame.pen);
  if (pen) { const l = penLocal(pen, ai.flee.x, ai.flee.z), q = penWorld(pen, clamp(l.x, -pen.hw + 1.2, pen.hw - 1.2), clamp(l.z, -pen.hd + 1.2, pen.hd - 1.2)); ai.flee.x = q.x; ai.flee.z = q.z; }
  ai.calmAt = GAME.t + 1.2;
  setAct(e, 5, 1.0);
  if (e.tame && Math.random() < 0.5) anVoice(e.tame.k, e);
}
// wild horses: graze, wander with the herd, shy away from riders and runners
function anWildThink(e, dt, far) {
  const ai = e.ai, rec = e.tame, H = rec.herd;
  if (far > 170 * 170) { e.prevX = e.x; e.prevZ = e.z; return; }
  if (ai.tameHold > GAME.t) return; // eating from your hand
  if (ai.flee && GAME.t < ai.flee.until) { moveToward(e, ai.flee.x, ai.flee.z, dt, 1.05, 0.5); return; }
  ai.flee = null;
  // anything with teeth or a weapon close by sends the herd off
  if (GAME.t > (ai.scanAt || 0)) {
    ai.scanAt = GAME.t + 0.4 + Math.random() * 0.3;
    const th = nearestWhere(e.x, e.z, 12, (o) => o.alive && o !== e && (o.faction === FACTION_MONSTER || (o.faction <= 2 && o.role !== 'player' && GAME.t < o.combatUntil)) && o.kind !== 'door');
    if (th) { for (const o of ANIMALS.list) if (o.tame && o.tame.herd === H && o.alive) anStartle(o, th.x, th.z); return; }
  }
  anGrazeAbout(e, dt, H.x, H.z, H.r, null);
}
// the everyday round: graze, wander a few steps, look about, lie down to rest
function anGrazeAbout(e, dt, hx, hz, hr, pen) {
  const ai = e.ai, t = GAME.t;
  const night = U.uNight.value > 0.6;
  if (t > (ai.until || 0)) {
    const roll = Math.random(), K = e.tame ? e.tame.k : 'sheep';
    const inside = pen ? penHas(pen, e.x, e.z, 0.8) : dist(e.x, e.z, hx, hz) < hr * 1.4;
    if (!inside || roll < (K === 'hen' ? 0.4 : 0.26)) {
      let gx, gz;
      if (pen) { const l = { x: (Math.random() - 0.5) * (pen.hw * 2 - 2.2), z: (Math.random() - 0.5) * (pen.hd * 2 - 2.2) }; const p = penWorld(pen, l.x, l.z); gx = p.x; gz = p.z; }
      else { const a = Math.random() * TAU, rr = Math.random() * hr; gx = hx + Math.cos(a) * rr; gz = hz + Math.sin(a) * rr; }
      ai.mode = 'walk'; ai.goal = { x: gx, z: gz }; ai.until = t + 14;
    } else if (roll < (night ? 0.45 : 0.78)) {
      const dur = (K === 'hen' ? 3 : 6) + Math.random() * 8;
      ai.mode = 'graze'; ai.until = t + dur; setAct(e, 7, dur);
    } else if (roll < (night ? 0.95 : 0.88) && K !== 'hen') {
      const dur = 14 + Math.random() * (night ? 40 : 18);
      ai.mode = 'rest'; ai.until = t + dur; setAct(e, 9, dur);
    } else {
      const dur = 1.5 + Math.random() * 2;
      ai.mode = 'alert'; ai.until = t + dur; setAct(e, 5, dur);
    }
  }
  if (ai.mode === 'walk' && ai.goal) {
    if (pen ? anGoTo(e, ai.goal.x, ai.goal.z, dt, e.tame && e.tame.k === 'hen' ? 0.17 : 0.22, 0.5, false) : moveToward(e, ai.goal.x, ai.goal.z, dt, 0.16, 0.6)) ai.until = 0;
    if (ai.stuck > 2.5) { ai.stuck = 0; ai.until = 0; }
  }
}
// an animal inside a pen it should leave (sent elsewhere, or following you) goes out by the gate, which opens for it
function anLeavePen(e, dt, mul, keep = null) {
  const ai = e.ai;
  // still on the way out until clear of the gate
  const pen = ANIMALS.pens.find((p) => p !== keep && (penHas(p, e.x, e.z, -0.2) || ai.leaving === p.id && penHas(p, e.x, e.z, -1.4)));
  if (!pen) { ai.leaving = null; return false; }
  ai.leaving = pen.id;
  const l = penLocal(pen, e.x, e.z);
  anSharedGate(pen, 2.5);
  if (Math.abs(l.x) < 1.2 && l.z > pen.hd - 2.2) { if (moveToward(e, pen.gateOut.x, pen.gateOut.z, dt, mul, 0.35)) { ai.leaving = null; return false; } }
  else anGoTo(e, pen.gateIn.x, pen.gateIn.z, dt, mul, 0.5, false);
  return true;
}
// livestock in a pen: food and water at the trough and the rack, shelter in the shed when it storms or snows
function anPenThink(e, dt) {
  const rec = e.tame, ai = e.ai, pen = penById(rec.pen);
  if (ai.flee && GAME.t < ai.flee.until) { if (pen && !penHas(pen, ai.flee.x, ai.flee.z, 0.5)) ai.flee = null; else { moveToward(e, ai.flee.x, ai.flee.z, dt, 0.7, 0.5); return; } }
  if (!pen) { rec.cmd = 'stay'; rec.stay = { x: e.x, z: e.z }; return; }
  const mom = anMother(e);
  // outside the pen (just bought, led in, or pushed out): back in through the gate
  if (!penHas(pen, e.x, e.z, 0.3)) {
    if (anLeavePen(e, dt, 0.6, pen)) return;
    ai.mode = 'home';
    const l = penLocal(pen, e.x, e.z);
    if (l.z > pen.hd - 0.5 && Math.abs(l.x) < 1.4) { anGoTo(e, pen.gateIn.x, pen.gateIn.z, dt, 0.6, 0.4, false); anSharedGate(pen, 2); }
    else if (anGoTo(e, pen.gateOut.x, pen.gateOut.z, dt, 0.6, 0.6, false)) anSharedGate(pen, 2);
    else if (dist(e.x, e.z, pen.gateOut.x, pen.gateOut.z) < 3.5) anSharedGate(pen, 2);
    if (ai.stuck > 8) { const p = penWorld(pen, 0, pen.hd - 2); e.x = e.prevX = p.x; e.z = e.prevZ = p.z; ai.stuck = 0; }
    return;
  }
  if (mom && penHas(pen, mom.x, mom.z)) {
    // stay at the mother's side; graze and rest when she does
    const d = dist(e.x, e.z, mom.x, mom.z);
    if (d > 2.4) { moveToward(e, mom.x + Math.sin(mom.yaw + 2.2) * 1.2, mom.z + Math.cos(mom.yaw + 2.2) * 1.2, dt, d > 6 ? 0.9 : 0.45, 0.6); return; }
    if (GAME.t > (ai.until || 0)) { const dur = 4 + Math.random() * 6; const act = mom.ai.mode === 'rest' ? 9 : Math.random() < 0.6 ? 7 : 5; setAct(e, act, dur); ai.until = GAME.t + dur; }
    return;
  }
  // shelter from snow and hard rain
  const wq = weatherAt(e.x, e.z, _anWx); // [weather2] the snow and the rain over the pen (12c_weather2.js)
  const storm = wq.snowing > 0.3 || wq.raining > 0.65 || (typeof SEASON !== 'undefined' && SEASON && /winter/i.test(SEASON.name || '') && U.uNight.value > 0.5);
  if (storm && rec.k !== 'hen' || storm && wq.raining > 0.3 && rec.k === 'hen') {
    const S = pen.shedL, sp = penWorld(pen, S.x + ((rec.aid % 3) - 1) * 1.1, S.z + ((rec.aid % 2) - 0.5) * 0.9);
    if (dist(e.x, e.z, sp.x, sp.z) > 1.2) { ai.mode = 'shelter'; anGoTo(e, sp.x, sp.z, dt, 0.5, 0.6, false); ai.until = 0; return; }
    if (ai.mode !== 'rest') { ai.mode = 'rest'; ai.until = GAME.t + 20; setAct(e, rec.k === 'hen' ? 7 : 9, 20); }
    return;
  }
  // hungry or thirsty: to the rack or the trough
  if (GAME.t > (ai.needT || 0)) {
    ai.needT = GAME.t + 3 + Math.random() * 3;
    const grass = anPenGrass(pen);
    if (rec.thirst < 0.45 && pen.water > 0.2) { ai.mode = 'drink'; ai.goal = pen.trough; ai.until = GAME.t + 20; }
    else if (rec.hunger < 0.45 && grass < 0.3 && pen.feed > 0.2) { ai.mode = 'feed'; ai.goal = pen.rack; ai.until = GAME.t + 20; }
  }
  if ((ai.mode === 'drink' || ai.mode === 'feed') && ai.goal) {
    const g = ai.goal, d = dist(e.x, e.z, g.x, g.z);
    if (d > 1.6 + e.radius) { anGoTo(e, g.x, g.z, dt, 0.4, 1.2 + e.radius, false); if (ai.stuck > 4) { ai.mode = 'idle'; ai.until = 0; } return; }
    if (!ai.atTrough) { ai.atTrough = GAME.t; faceToward(e, g.x, g.z); setAct(e, 7, 5); }
    if (GAME.t - ai.atTrough > 5) {
      if (anSharedPenConsume(e, pen, ai.mode)) { ai.atTrough = 0; ai.mode = 'idle'; ai.until = 0; return; }
      if (ai.mode === 'drink') { const w = Math.min(pen.water, 0.4); pen.water -= w * 0.25; rec.thirst = Math.min(1, rec.thirst + w * 2.2); }
      else { const f = Math.min(pen.feed, 0.4); pen.feed -= f * 0.5; rec.hunger = Math.min(1, rec.hunger + f * 2.2); }
      ai.atTrough = 0; ai.mode = 'idle'; ai.until = 0;
    }
    return;
  }
  anGrazeAbout(e, dt, pen.x, pen.z, 0, pen);
  // grazing on good grass feeds them
  if (ai.mode === 'graze') rec.hunger = Math.min(1, rec.hunger + dt * 0.012 * anPenGrass(pen));
}
const _anWx = {};
// how much grazing a pen gives: none under snow or in winter, less in a dry spell
function anPenGrass(pen) {
  if (pen._gT && GAME.t - pen._gT < 5) return pen._g;
  let g = sampleGrid(W.grass, pen.x, pen.z);
  if (wxSnowingAt(pen.x, pen.z) > 0.2 || (typeof seasonSnowLieAt === 'function' ? seasonSnowLieAt(pen.x, pen.z) : U.uSnowCover.value) > 0.35) g *= 0.1; // [weather2] the snow on this pen
  if (typeof SEASON !== 'undefined' && SEASON && /winter/i.test(SEASON.name || '')) g *= 0.15;
  pen._gT = GAME.t; pen._g = clamp(g, 0, 1);
  return pen._g;
}
// companions: follow, stay, guard, attack
function anPetThink(e, dt) {
  const rec = e.tame, ai = e.ai, P = GAME.player;
  if (!P) return true;
  if (water2PetWait(e, dt)) return true; // [water2] riding in your boat, or waiting at the surface while you dive (07e_boats.js)
  if (!P.alive && rec.cmd !== 'stay') { e.target = null; return true; }
  const K = AKIND[rec.k];
  const d = dist(e.x, e.z, P.x, P.z);
  // fights first: a hound bites whatever threatens you, or what you set it on
  if (K.fights && e.faction <= 2) {
    let t = getEnt(e.target);
    if (t && (!t.alive || !isEnemy(e, t))) {
      if (t && !t.alive && t.lastHitBy === e.id && !t._anXp) { t._anXp = true; anPetXp(e, 6 + 4 * (t.level || 1)); }
      t = null; e.target = null;
      if (rec.cmd === 'attack') rec.cmd = rec.prevCmd || 'follow';
    }
    if (!t && GAME.t > (ai.scanAt || 0)) {
      ai.scanAt = GAME.t + 0.4;
      const pt = getEnt(P.target);
      if (rec.cmd === 'attack' && pt && pt.alive && isEnemy(e, pt) && pt.kind !== 'door') t = pt;
      else if (rec.cmd !== 'stay' || rec.cmd === 'guard') {
        const cx = rec.cmd === 'guard' && rec.stay ? rec.stay.x : P.x, cz = rec.cmd === 'guard' && rec.stay ? rec.stay.z : P.z;
        // whoever is fighting the player, or the player's own foe in the fight
        if (pt && pt.alive && isEnemy(e, pt) && GAME.t < P.combatUntil && pt.kind !== 'door' && dist(pt.x, pt.z, P.x, P.z) < 25) t = pt;
        else t = nearestWhere(cx, cz, rec.cmd === 'guard' ? 14 : 12, (o) => o.alive && isEnemy(e, o) && isActor(o) && o.kind !== 'door' && (o.target === P.id || o.target === e.id || (rec.cmd === 'guard' && o.faction !== FACTION_MONSTER) || GAME.t < o.combatUntil && o.threat && (o.threat.has(P.id) || o.threat.has(e.id))));
      }
      if (t) e.target = t.id;
    }
    if (!t && e.lastHitBy != null && GAME.t - e.lastHitAt < 3) { const a = getEnt(e.lastHitBy); if (a && a.alive && isEnemy(e, a)) { t = a; e.target = a.id; } }
    if (t) {
      const leash = rec.cmd === 'stay' || rec.cmd === 'guard' ? 22 : 40;
      const home = (rec.cmd === 'stay' || rec.cmd === 'guard') && rec.stay ? rec.stay : P;
      if (dist(t.x, t.z, home.x, home.z) > leash) { e.target = null; }
      else { fightTarget(e, t, dt); return true; }
    }
  }
  if (rec.cmd === 'stay' || rec.cmd === 'guard') {
    const s = rec.stay || (rec.stay = { x: e.x, z: e.z });
    if (dist(e.x, e.z, s.x, s.z) > 2.5) { anGoTo(e, s.x, s.z, dt, 0.6, 0.8, false); return true; }
    if (GAME.t > (ai.until || 0)) { const dur = 6 + Math.random() * 10; const r = Math.random(); setAct(e, r < 0.5 ? 9 : r < 0.8 ? 7 : 5, dur); ai.until = GAME.t + dur; }
    return true;
  }
  // in the barrow the animals wait at its mouth
  if (inDungeon(P)) { if (GAME.t > (ai.until || 0)) { const dur = 8; setAct(e, 9, dur); ai.until = GAME.t + dur; } return true; }
  // follow: run to catch up, walk when close, wait in a free spot by the player
  const pets = anCompanions(), idx = Math.max(0, pets.indexOf(e));
  if (d > 70) { const p = anCatchUpSpot(e); anPlace(e, p.x, p.z); return true; }
  const slot = anSlot(e, idx);
  const ds = dist(e.x, e.z, slot.x, slot.z);
  const inPen = ANIMALS.pens.find((p) => penHas(p, e.x, e.z, -0.2));
  if (inPen && !penHas(inPen, P.x, P.z, -0.5) && anLeavePen(e, dt, 0.8)) return true;
  if (ds > 1.0) {
    const mul = d > 14 ? 1.35 : d > 6 ? 1.05 : 0.6;
    if (e.anim.act === 9 || e.anim.act === 7) { e.anim.act = 0; e.anim.actDur = 0; }
    anGoTo(e, slot.x, slot.z, dt, P.mount ? Math.max(mul, 1.5) : mul, 0.5, true);
    if (ai.stuck > 5 && d > 10) { const p = anCatchUpSpot(e); anPlace(e, p.x, p.z); ai.stuck = 0; ai.fol = null; }
    // [v10] headway, not only motion: a companion that runs about (along a wall, up and down a bank) without getting
    // any nearer comes on by your trail: soon when you cannot see it, after a while when you can
    let fol = ai.fol;
    if (!fol || GAME.t - fol.at > 1) fol = ai.fol = { d, t: GAME.t, at: GAME.t };
    fol.at = GAME.t;
    if (d < 12 || fol.d - d >= 1.5) { fol.d = d; fol.t = GAME.t; }
    else if (GAME.t - fol.t > (anOnScreen(e) ? 8 : 3.5)) { const p = anCatchUpSpot(e); anPlace(e, p.x, p.z); ai.fol = null; }
    ai.until = GAME.t + 1.5 + Math.random();
  } else {
    turnToward(e, P.x, P.z, dt * 2);
    if (GAME.t > (ai.until || 0)) { const dur = 4 + Math.random() * 6; const r = Math.random(); setAct(e, r < 0.35 ? 9 : r < 0.7 && K.label !== 'hound' ? 7 : 5, dur); ai.until = GAME.t + dur + 2; }
  }
  return true;
}
function anPlace(e, x, z) {
  if (!isWalkable(x, z)) return;
  e.x = e.prevX = x; e.z = e.prevZ = z; e.y = heightAt(x, z);
  e.ai.wp = null; e.ai.stuck = 0;
  FX.dust(x, e.y, z, 6);
}
function anPetXp(e, n) {
  const rec = e.tame;
  rec.xp += n;
  const lvl = Math.min(10, 1 + Math.floor(Math.sqrt(rec.xp / 40)));
  if (lvl > rec.lvl) {
    rec.lvl = lvl; anStats(e); e.hp = e.maxHp;
    FX.levelUp(e.x, e.y, e.z);
    uiToast(`${rec.name} grows bolder: bond level ${lvl}.`, 'quest');
    saveSoon();
  }
}

/* ------------------------------------------------------------------ */
/* the slow clocks: hunger, mood, growth, production, breeding          */
/* ------------------------------------------------------------------ */
function anClock(e, dt) {
  const rec = e.tame, K = AKIND[rec.k];
  if (rec.reservedOwnerAccount) { const was = anAdult(rec); rec.age += dt; if (!was) { anLook(e); anStats(e); } return; }
  if (rec.owner === 'wild') { rec.age += dt; return; }
  const was = anAdult(rec);
  rec.age += dt;
  // hunger and thirst fall; grazing, the rack and the trough fill them (anPenThink); companions eat what you give them
  rec.hunger = Math.max(0, rec.hunger - dt * K.food * (anAdult(rec) ? 1 : 0.7));
  rec.thirst = Math.max(0, rec.thirst - dt * K.food * 1.2);
  if (rec.cmd !== 'pen' || rec.owner === 'player' && !penById(rec.pen)) {
    // away from a pen they drink at any water and nibble as they go
    if (heightAt(e.x, e.z) < WATER_Y + 0.6 || wxPrecipAt(e.x, e.z) > 0.4 || (typeof waterAt === 'function' && waterAt(e.x, e.z))) rec.thirst = Math.min(1, rec.thirst + dt * 0.05);
    else rec.thirst = Math.max(rec.thirst, 0.5);
    if (!K.fights && rec.k !== 'hound' && sampleGrid(W.grass, e.x, e.z) > 0.4) rec.hunger = Math.min(1, rec.hunger + dt * 0.004);
  }
  if (rec.owner === 'town') { rec.hunger = Math.max(rec.hunger, 0.55); rec.thirst = Math.max(rec.thirst, 0.55); }
  // a hound keeps pace with you as you level
  if (K.fights && e.mobType && GAME.player && e.level !== clamp(GAME.player.level - 2 + Math.min(4, Math.floor((rec.lvl - 1) / 2)), 1, LEVEL_CAP)) anStats(e);
  const hungry = rec.hunger < 0.15;
  if (hungry !== !!rec._hungry) {
    rec._hungry = hungry;
    if (K.fights) anStats(e);
    if (hungry && rec.owner === 'player' && !K.live) uiLog(`${rec.name} is hungry. Feed it from its card (E beside it).`, 'warn');
  }
  // contentment: fed, watered, dry and warm, healthy, not crowded
  const pen = penById(rec.pen);
  let crowd = 0;
  if (pen && rec.cmd === 'pen') { const n = ANIMALS.list.filter((o) => o.tame && o.tame.pen === pen.id && o.alive).length; crowd = clamp((n - (pen.hw * pen.hd * 4) / 14) / 6, 0, 1); }
  const cold = (e.snow || 0) > 0.4 || (e.wet || 0) > 0.8 ? 0.25 : 0;
  const want = clamp(0.25 + 0.4 * Math.min(rec.hunger, 1) + 0.25 * rec.thirst + 0.15 * (e.hp / e.maxHp) - cold - crowd * 0.3 + 0.1 * rec.tr.calm, 0, 1);
  rec.mood = lerp(rec.mood, want, 1 - Math.exp(-dt / 30));
  // the young grow
  if (!was || rec.age < K.grow + 2) { const sc = anScale(rec); if (Math.abs(sc - e.scale) > 0.01 || anAdult(rec) !== was) { anLook(e); anStats(e); } }
  if (!was && anAdult(rec) && rec.owner === 'player') uiLog(`${rec.name} is grown: a ${anStage(rec)} now.`, 'sys');
  // production, for content grown animals
  if (anAdult(rec) && rec.sex === 'f' || rec.k === 'sheep' && anAdult(rec)) {
    const k = rec.mood > 0.45 ? rec.mood * rec.tr.yield : 0;
    if (rec.k === 'sheep') { const before = rec.prod.wool; rec.prod.wool = Math.min(1.2, rec.prod.wool + dt * k / 420); if (before < 0.45 !== rec.prod.wool < 0.45) anLook(e); }
    else if (rec.k === 'cattle' && rec.sex === 'f') rec.prod.milk = Math.min(1, rec.prod.milk + dt * k / 300);
    else if (rec.k === 'hen' && rec.sex === 'f') {
      rec.prod.egg += dt * k / 240;
      if (rec.prod.egg >= 1) { rec.prod.egg = 0; if (rec.owner === 'player') anLay(e); }
    }
  }
  // a pig at your heels roots out mushrooms under the trees
  if (rec.k === 'pig' && rec.owner === 'player' && rec.cmd === 'follow' && anAdult(rec) && window.__hm.visual && window.__hm.visual.canopy && Math.random() < dt * 0.006 * rec.tr.yield && window.__hm.visual.canopy(e.x, e.z) > 0.3) {
    dropGood('mushrooms', 1 + (Math.random() < 0.3 ? 1 : 0), e.x, e.z);
    setAct(e, 7, 2.5);
    if (Math.random() < 0.5) uiLog(`${rec.name} roots out mushrooms.`, 'loot');
  }
  // manure in the pen
  if (anSharedWorldCanSimulate() && pen && rec.cmd === 'pen' && penHas(pen, e.x, e.z)) pen.manure = Math.min(20, pen.manure + dt * (rec.k === 'cattle' ? 1 / 150 : rec.k === 'hen' ? 1 / 900 : 1 / 300));
  // breeding: the mother carries; at term the young are born
  if (rec.preg) {
    rec.preg.left -= dt;
    if (rec.preg.left <= 0) anBirth(e);
  } else if (rec.sex === 'f' && anAdult(rec) && GAME.t > rec.breedAt && rec.mood > 0.6 && rec.hunger > 0.5 && e.alive) {
    rec.breedAt = GAME.t + 20 + Math.random() * 10;
    const mate = ANIMALS.list.find((o) => o !== e && o.alive && !o.removed && o.tame && o.tame.k === rec.k && o.tame.sex === 'm' && anAdult(o.tame) && o.tame.mood > 0.5 && o.tame.owner === rec.owner && dist2(o.x, o.z, e.x, e.z) < 12 * 12 && (o.tame.pen === rec.pen || o.tame.cmd !== 'pen' && rec.cmd !== 'pen'));
    if (mate) {
      rec.preg = { left: K.gest * (1.1 - 0.2 * rec.tr.calm), sire: { aid: mate.tame.aid, name: mate.tame.name, gen: mate.tame.gen, tr: JSON.parse(JSON.stringify(mate.tame.tr)) } };
      rec.breedAt = GAME.t + K.gest * 2;
      anHearts(e, 6); anHearts(mate, 4);
      if (rec.owner === 'player') { uiLog(`${rec.name} and ${mate.tame.name} have paired. ${rec.k === 'hen' ? 'Eggs will hatch' : 'Young will be born'} in about ${Math.round(rec.preg.left / 60)} minutes.`, 'sys'); loreNote('breed'); }
    }
  }
}
function anBirth(e) {
  const rec = e.tame, K = AKIND[rec.k], S = rec.preg.sire;
  rec.preg = null;
  if (rec.k === 'hen') { if (!anSharedProduction(e, 'animal.clutch', { sire: S })) depthClutch(e, S); return; } // [depth] a hen lays a clutch in the nest, and it hatches if left (09u_depth.js)
  const n = K.litter[0] + Math.floor(Math.random() * (K.litter[1] - K.litter[0] + 1));
  const names = [];
  for (let i = 0; i < n; i++) {
    if (rec.owner === 'town' && ANIMALS.list.filter((o) => o.tame && o.tame.pen === rec.pen && o.alive).length > 22) break;
    const young = anRecord(rec.k, { owner: rec.owner, age: 0, tr: anInherit(rec.tr, S.tr), gen: Math.max(rec.gen, S.gen || 0) + 1, ma: { aid: rec.aid, name: rec.name }, pa: { aid: S.aid, name: S.name }, cmd: rec.cmd === 'pen' ? 'pen' : 'follow', pen: rec.pen, hunger: 0.9 });
    young.breedAt = GAME.t + K.grow * 1.2;
    const a = Math.random() * TAU;
    const y = anSpawn(young, e.x + Math.sin(a) * 0.9, e.z + Math.cos(a) * 0.9);
    anHearts(y, 3);
    names.push(young.name);
  }
  if (rec.owner === 'player' && names.length) {
    uiToast(`${rec.name} has ${names.length > 1 ? `${names.length} ${anPlural(K.young)}` : `a ${K.young}`}: ${names.join(', ')}.`, 'quest');
    sfx('heal'); saveSoon();
  }
}
const anPlural = (w) => (w === 'calf' ? 'calves' : w === 'pup' ? 'pups' : w + 's');
function anLay(e, ownerAccount = null) {
  if (anSharedProduction(e, 'animal.lay')) return;
  // eggs lie where the hen laid them (in the shed if she is in a pen); walk over them to pick them up
  const n = 1 + (Math.random() < (e.tame.tr.yield - 0.9) ? 1 : 0);
  const near = LOOT.filter((L) => L.item && L.item.goods === 'egg' && dist2(L.x, L.z, e.x, e.z) < 12 * 12).length;
  if (near >= 8) return;
  ANIMALS.eggsLaid = (ANIMALS.eggsLaid || 0) + n;
  depthLaid(e, dropGood('egg', n, e.x + (Math.random() - 0.5) * 0.3, e.z + (Math.random() - 0.5) * 0.3), ownerAccount); // [depth] with a cockerel in the flock, an egg left lying hatches (09u_depth.js)
}
function anHearts(e, n) {
  if (!e || dist2(e.x, e.z, camera.position.x, camera.position.z) > 70 * 70) return;
  const h = (e.scale || 1) * (e.kind === 'hen' ? 0.5 : e.kind === 'cattle' || e.kind === 'horse' ? 1.9 : 1.1);
  for (let i = 0; i < n; i++) fxAdd.emit(e.x + (Math.random() - 0.5) * 0.5, e.y + h, e.z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3, 1.3, 2.2, 0.7, 0.9, 0.16, -0.3, 0.6);
}

/* ------------------------------------------------------------------ */
/* the simulation step                                                 */
/* ------------------------------------------------------------------ */
function updateAnimals(dt) {
  if (!ANIMALS.inited) return;
  const P = GAME.player;
  if (P && GAME.started) { anTrailStep(); anTamingStep(dt); }
  // the clocks run once a second per animal, staggered
  ANIMALS.clk = (ANIMALS.clk || 0) + dt;
  const L = ANIMALS.list;
  for (let i = L.length - 1; i >= 0; i--) {
    const e = L[i];
    if (e.removed) { L.splice(i, 1); continue; }
    if (!anSharedOwnAnimal(e) && !anSharedWorldCanSimulate()) continue;
    if (e.netEntityOwner && !anSharedOwnAnimal(e)) continue;
    if (!e.alive) { anDied(e); L.splice(i, 1); continue; }
    e._anClk = (e._anClk ?? Math.random()) + dt;
    if (e._anClk >= 1) { anClock(e, e._anClk); e._anClk = 0; }
  }
  if ((ANIMALS.trustT = (ANIMALS.trustT || 0) + dt) > 10) { ANIMALS.trustT = 0; for (const id of [...ANIMALS.trust.keys()]) { const e = getEnt(id); if (!e || !e.alive || !anWildKind(e)) ANIMALS.trust.delete(id); } }
  // pets that were hurt come back after a while
  for (let i = ANIMALS.down.length - 1; i >= 0; i--) {
    const rec = ANIMALS.down[i];
    rec.down -= dt;
    if (rec.down > 0 || !P || !P.alive || inDungeon(P)) continue;
    ANIMALS.down.splice(i, 1);
    const pen = penById(rec.pen);
    const at = rec.cmd === 'pen' && pen ? penWorld(pen, 0, 0) : anSlot({ tame: rec }, 0);
    const e = anSpawn(rec, at.x, at.z);
    e.hp = e.maxHp * 0.6;
    uiLog(`${rec.name} is back on its feet.`, 'sys');
  }
  // pens: the gate swings for whoever comes to it; rain fills the troughs; a pond or a well nearby keeps them full
  for (const pen of ANIMALS.pens) {
    if (!anSharedWorldCanSimulate()) { pen.gateColl.active = GAME.t >= pen.gateWant && pen.gateOpen < 0.2; continue; }
    const bodies = [P, ...(typeof NET !== 'undefined' ? [...NET.peers.values()].filter(p => p.slow?.on).map(p => p.ghost) : []), ...ANIMALS.list.filter(e => e.alive)];
    if (bodies.some(e => e && dist2(e.x, e.z, pen.gate.x, pen.gate.z) < 3.2 * 3.2)) pen.gateWant = GAME.t + 1.5;
    for (const e of ANIMALS.list) if (e.netEntityOwner && !anSharedOwnAnimal(e) && e.alive && e.tame?.cmd === 'pen' && e.tame.pen === pen.id && penHas(pen, e.x, e.z))
      pen.manure = Math.min(20, pen.manure + dt * (e.tame.k === 'cattle' ? 1 / 150 : e.tame.k === 'hen' ? 1 / 900 : 1 / 300));
    const open = GAME.t < pen.gateWant;
    pen.gateColl.active = !open && pen.gateOpen < 0.2;
    if (pen.owner === 'town') { pen.feed = Math.max(pen.feed, 20); pen.water = Math.max(pen.water, 20); }
    else {
      const pr = wxPrecipAt(pen.x, pen.z); // [weather2] the rain over the pen fills its trough
      if (pr > 0.2) pen.water = Math.min(12, pen.water + dt * pr * 0.03);
      if (pen._wNear === undefined) pen._wNear = anWaterNear(pen.x, pen.z, 22);
      if (pen._wNear) pen.water = Math.min(12, pen.water + dt * 0.05);
    }
  }
}
function anWaterNear(x, z, r) {
  for (let a = 0; a < TAU; a += TAU / 16) for (let d = 2; d <= r; d += 3) if (heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d) < WATER_Y - 0.1) return true;
  return (typeof waterAt === 'function') && !!waterAt(x, z);
}
function anDied(e) {
  if (!anSharedOwnAnimal(e) && (!anSharedWorldCanSimulate() || e.netEntityOwner)) return;
  const rec = e.tame;
  if (!rec) return;
  if (rec.owner === 'player' && !AKIND[rec.k].live && !rec.slaughtered) {
    // a companion is not lost: badly hurt, it limps away and comes back
    rec.down = 90;
    ANIMALS.down.push(rec);
    uiLog(`${rec.name} is badly hurt and limps away. It will find you again in a minute and a half.`, 'warn');
    return;
  }
  // livestock killed leave meat and hide (and wool or feathers)
  if (!rec.slaughtered) anCarcass(e, false);
  if (rec.owner === 'player') saveSoon();
}
function anCarcass(e, toPacks) {
  const rec = e.tame, g = anGrowth(rec), sz = rec.tr.size * (0.3 + 0.7 * g);
  const meat = Math.max(1, Math.round({ sheep: 3, cattle: 6, hen: 1, pig: 4, horse: 6, deer: 4, hound: 2 }[rec.k] * sz));
  const out = [['meat_raw', meat]];
  if (rec.k !== 'hen') out.push(['hide', Math.max(1, Math.round((rec.k === 'cattle' || rec.k === 'horse' ? 2 : 1) * sz))]);
  if (rec.k === 'hen') out.push(['feather', 3 + Math.floor(Math.random() * 4)]);
  if (rec.k === 'sheep' && rec.prod.wool > 0.5) out.push(['wool', Math.max(1, Math.round(2 * rec.prod.wool * rec.tr.yield))]);
  out.push(['bone', 1 + Math.floor(sz * 2)]);
  for (const [id, n] of out) { if (toPacks) goodsAdd(id, n); else dropGood(id, n, e.x + (Math.random() - 0.5), e.z + (Math.random() - 0.5)); }
}

/* ------------------------------------------------------------------ */
/* interactions (E): taming, the animal card, pens and the herder       */
/* ------------------------------------------------------------------ */
function animalOffers(P, offer) {
  if (!ANIMALS.inited || P.mount) { if (ANIMALS.marking) offer(0, 1, 'Fence the paddock here', () => anMarkConfirm(), 9); return; }
  if (ANIMALS.marking) { offer(0, 1, 'Fence the paddock here', () => anMarkConfirm(), 9); return; }
  forNear(P.x, P.z, 5, (e, d2) => {
    const d = Math.sqrt(d2);
    const k = anWildKind(e);
    // [v9] the beast you face comes first: a companion at your heel does not stand in for the wolf in front of you
    const face = d > 0.3 ? Math.abs(angDiff(P.yaw, Math.atan2(e.x - P.x, e.z - P.z))) / Math.PI * 0.5 : 0;
    if (k) {
      const T = anTrust(e), food = anFoodFor(k);
      const what = food ? goodName(food).toLowerCase() : AKIND[k].likes[0].replace('_', ' ');
      offer(d, 4.2, `Offer ${what} to the ${anWildName(e)} (trust ${T.n}/${T.need}${T.settle < 1 ? ', wary' : ''})`, () => anOffer(e), 0.1 - face);
      return;
    }
    if (e.tame && e.alive && (e.tame.owner === 'player' || e.tame.owner === 'town')) {
      const rec = e.tame;
      const lab = rec.owner === 'town' ? `Look at the ${anStage(rec)} (${rec.name})` : `${rec.name} the ${anStage(rec)}`;
      offer(d, 3.0 + e.radius, lab, () => openAnimalCard(e), 0.05 - face);
    }
  });
  for (const pen of ANIMALS.pens) {
    const d = dist(P.x, P.z, pen.gateOut.x, pen.gateOut.z);
    if (pen.owner === 'town') { if (pen.realm === P.faction) offer(d, 3.6, `The herder's board at ${pen.name}`, () => openHerder(pen)); continue; }
    offer(d, 3.4, `Your paddock (feed ${Math.round(pen.feed)}, water ${Math.round(pen.water)}, manure ${Math.floor(pen.manure)})`, () => openPen(pen));
    const dr = dist(P.x, P.z, pen.rack.x, pen.rack.z), dt2 = dist(P.x, P.z, pen.trough.x, pen.trough.z);
    if (dr < 3 || dt2 < 3) offer(Math.min(dr, dt2), 3, 'Tend the paddock', () => openPen(pen));
  }
}

/* ------------------------------------------------------------------ */
/* dialogs                                                             */
/* ------------------------------------------------------------------ */
function anDialog(title, body, acts) {
  UI.modal = 'dialog';
  ANIMALS.dlg = true;
  $('dialog').hidden = false;
  $('dlg-title').textContent = title;
  $('dlg-body').innerHTML = body;
  const box = $('dlg-actions');
  box.innerHTML = '';
  acts.forEach(([l, fn, cls], i) => { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn' + (cls ? ' ' + cls : ''); btn.textContent = l; btn.onclick = () => { fn(); }; box.appendChild(btn); });
  const close = $('dialog').querySelector('.sheet');
  if (close) close.classList.add('an-sheet');
}
function anCloseDialog() { ANIMALS.dlg = false; ANIMALS.sel = null; closeDialog(); }
const anPct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;
function anBar(label, v, max, txt, hue = '') { return `<div class="an-tr"><span>${label}</span><i class="an-bar ${hue}"><b style="width:${(clamp(v / max, 0, 1) * 100).toFixed(0)}%"></b></i><em>${txt}</em></div>`; }
const anCss = (c) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 1) * 255)).join(',')})`;
function anTraitHTML(rec) {
  const t = rec.tr, pat = anExpress(t.al);
  const temper = t.calm > 0.75 ? 'placid' : t.calm > 0.5 ? 'steady' : t.calm > 0.25 ? 'skittish' : 'wild-hearted';
  let h = `<div class="an-coat"><i style="background:${anCss(t.coat)}"></i><i style="background:${anCss(t.coat2)}"></i><span>${PAT_NAMES[pat]} coat${pat !== anExpress([t.al[0], t.al[0]]) || pat !== anExpress([t.al[1], t.al[1]]) ? ' <small>(carries ' + PAT_NAMES[t.al.find((a) => a !== pat) ?? 0] + ')</small>' : ''}</span></div>`;
  h += anBar('Size', t.size - 0.7, 0.6, `${Math.round(t.size * 100)}`);
  h += anBar('Temper', t.calm, 1, temper);
  if (AKIND[rec.k].live) h += anBar('Yield', t.yield - 0.5, 1.5, `${Math.round(t.yield * 100)}`, 'gold');
  if (rec.k === 'horse') h += anBar('Speed', t.speed - 0.75, 0.7, `${Math.round(t.speed * 100)}`, 'gold');
  if (rec.k === 'hound') h += anBar('Strength', t.strength - 0.6, 1.1, `${Math.round(t.strength * 100)}`, 'gold');
  return h;
}
function openAnimalCard(e) {
  const rec = e.tame, K = AKIND[rec.k];
  ANIMALS.sel = e.id;
  const mine = rec.owner === 'player';
  const ageMin = rec.age / 60;
  const stage = anStage(rec);
  let body = `<div class="an-card"><p class="an-sub">${rec.sex === 'm' ? 'Male' : 'Female'} ${K.label === stage ? K.label : `${K.label}, ${stage}`} · ${anAdult(rec) ? `grown` : `${Math.round(anGrowth(rec) * 100)}% grown`} · ${ageMin < 2 ? 'newborn' : `${Math.floor(ageMin)} min old`}${mine ? '' : ' · belongs to the town'}</p>`;
  body += `<p class="an-sub">Generation ${rec.gen}${rec.ma ? ` · dam <b>${esc(rec.ma.name)}</b>` : ''}${rec.pa ? ` · sire <b>${esc(rec.pa.name)}</b>` : ''}${!rec.ma && !rec.pa ? ' · wild-born' : ''}</p>`;
  body += `<h4>Traits</h4>${anTraitHTML(rec)}<h4>Now</h4>`;
  body += anBar('Health', e.hp, e.maxHp, `${Math.round(e.hp)} / ${Math.round(e.maxHp)}`, 'red');
  body += anBar('Fed', rec.hunger, 1, anPct(rec.hunger));
  body += anBar('Water', rec.thirst, 1, anPct(rec.thirst), 'blue');
  body += anBar('Content', rec.mood, 1, rec.mood > 0.7 ? 'content' : rec.mood > 0.45 ? 'unsettled' : 'unhappy');
  if (K.pet && !K.live) body += anBar('Bond', rec.lvl, 10, `level ${rec.lvl}`, 'gold');
  if (anAdult(rec)) {
    if (rec.k === 'sheep') body += anBar('Fleece', rec.prod.wool, 1, rec.prod.wool >= 1 ? 'ready to shear' : anPct(rec.prod.wool));
    if (rec.k === 'cattle' && rec.sex === 'f') body += anBar('Milk', rec.prod.milk, 1, rec.prod.milk >= 1 ? 'ready to milk' : anPct(rec.prod.milk));
    if (rec.k === 'hen' && rec.sex === 'f') body += anBar('Laying', rec.prod.egg, 1, anPct(rec.prod.egg));
  }
  if (rec.preg) body += `<p class="an-note">${rec.k === 'hen' ? 'Sitting on eggs' : 'In young'} by ${esc(rec.preg.sire.name)}: about ${Math.max(1, Math.round(rec.preg.left / 60))} min to go.</p>`;
  else if (rec.sex === 'f' && anAdult(rec) && mine) body += `<p class="an-note">${rec.mood > 0.6 && rec.hunger > 0.5 ? `Ready to breed with a grown ${K.m} close by.` : 'Too hungry or unsettled to breed.'}</p>`;
  if (mine) body += `<div class="an-name"><label>Name <input id="an-rename" maxlength="16" value="${esc(rec.name)}" autocomplete="off" spellcheck="false"></label></div>`;
  body += '</div>';
  const acts = [];
  if (mine) {
    const food = K.likes.find((id) => goodsHave(id));
    if (food) acts.push([`Feed (${goodName(food).toLowerCase()})`, () => { anFeed(e, food); openAnimalCard(e); }, 'primary']);
    if (rec.k === 'sheep' && anAdult(rec) && rec.prod.wool >= 1) acts.push(['Shear', () => { anShear(e); openAnimalCard(e); }, 'primary']);
    if (rec.k === 'cattle' && rec.sex === 'f' && anAdult(rec) && rec.prod.milk >= 1) acts.push(['Milk', () => { anMilk(e); openAnimalCard(e); }, 'primary']);
    if (rec.cmd !== 'follow') acts.push(['Follow me', () => { anCommand(e, 'follow'); anCloseDialog(); }]);
    if (rec.cmd !== 'stay') acts.push(['Stay here', () => { anCommand(e, 'stay'); anCloseDialog(); }]);
    if (K.fights && rec.cmd !== 'guard') acts.push(['Guard here', () => { anCommand(e, 'guard'); anCloseDialog(); }]);
    if (rec.k === 'hound' && rec.cmd !== 'herd' && depthHerdable(e)) acts.push(['Herd the sheep in', () => { depthHerdStart(e); anCloseDialog(); }]); // [depth] (09u_depth.js)
    const pen = anNearestPen(e);
    if (pen && (rec.cmd !== 'pen' || rec.pen !== pen.id)) acts.push([`Into ${pen.owner === 'town' ? 'the common' : 'the paddock'}`, () => { anCommand(e, 'pen', pen); anCloseDialog(); }]);
    acts.push([K.live ? 'Slaughter' : 'Set free', () => anConfirmPart(e)]);
  }
  acts.push(['Close', anCloseDialog]);
  anDialog(`${rec.name}`, body, acts);
  const inp = $('an-rename');
  if (inp) inp.addEventListener('change', () => { const v = inp.value.replace(/[<>&"]/g, '').trim().slice(0, 16); if (v) { rec.name = v; e.name = v; saveSoon(); } });
}
function anConfirmPart(e) {
  const rec = e.tame, K = AKIND[rec.k];
  anDialog(K.live ? `Slaughter ${rec.name}?` : `Set ${rec.name} free?`, `<p>${K.live ? `You will get meat, a hide and bones. ${rec.name} is gone for good.` : `${rec.name} goes back to the wild and is no longer yours.`}</p>`, [
    [K.live ? 'Slaughter' : 'Set free', () => { anPart(e); anCloseDialog(); }, 'primary'], ['Keep', () => openAnimalCard(e)],
  ]);
}
function anPart(e) {
  const rec = e.tame;
  if (AKIND[rec.k].live) { rec.slaughtered = true; anCarcass(e, true); FX.blood(e.x, e.y + 0.5, e.z); killEnt(e, null); e.removeAt = GAME.t + 3; }
  else { rec.owner = 'gone'; FX.dust(e.x, e.y, e.z, 10); removeEnt(e); uiLog(`${rec.name} lopes away into the wild.`, 'sys'); }
  saveSoon();
}
function anNearestPen(e) {
  let best = null, bd = 60 * 60;
  for (const p of ANIMALS.pens) { if (p.owner === 'town' && p.realm !== (GAME.player && GAME.player.faction)) continue; const d = dist2(p.x, p.z, e.x, e.z); if (d < bd) { bd = d; best = p; } }
  return best;
}
function anCommand(e, cmd, pen = null) {
  const rec = e.tame, P = GAME.player;
  if (cmd === 'attack') { rec.prevCmd = rec.cmd === 'attack' ? rec.prevCmd : rec.cmd; rec.cmd = 'attack'; const t = getEnt(P.target); if (t && isEnemy(e, t) && e.faction <= 2) e.target = t.id; }
  else if (cmd === 'call') { rec.cmd = AKIND[rec.k].live ? 'follow' : 'follow'; rec.stay = null; e.target = null; if (dist(e.x, e.z, P.x, P.z) > 30) { const s = anSlot(e, 0); anPlace(e, s.x, s.z); } }
  else if (cmd === 'pen' && pen) { rec.cmd = 'pen'; rec.pen = pen.id; e.target = null; e.ai.mode = 'home'; }
  else { rec.cmd = cmd; rec.stay = cmd === 'stay' || cmd === 'guard' ? { x: e.x, z: e.z } : null; if (cmd !== 'attack') e.target = null; }
  if (e.anim.act === 9) { e.anim.act = 0; e.anim.actDur = 0; }
  ANIMALS.uiDirty = true;
  saveSoon();
}
function anFeed(e, food) {
  const rec = e.tame;
  if (!goodsTake(food, 1)) return;
  const G = GOODS[food], f = (G.food && G.food.hunger) || 0.1;
  rec.hunger = Math.min(1, rec.hunger + 0.25 + f);
  healEnt(GAME.player, e, e.maxHp * 0.2, true);
  setAct(e, 7, 2.5);
  anHearts(e, 4);
  anVoice(rec.k, e);
  uiLog(`${rec.name} eats the ${goodName(food).toLowerCase()}.`, 'sys');
}
function anShear(e) {
  const rec = e.tame;
  if (!goodsHave('tool_shears')) { uiError('You need shears. The herder sells them.'); return; }
  const n = Math.max(1, Math.round((2 + rec.prod.wool) * rec.tr.yield * rec.tr.size));
  rec.prod.wool = 0; anLook(e);
  goodsAdd('wool', n);
  FX.dust(e.x, e.y + 0.6, e.z, 8, [0.85, 0.83, 0.78]);
  anVoice('sheep', e);
}
function anMilk(e) {
  const rec = e.tame, n = Math.max(1, Math.round(1.5 * rec.tr.yield + Math.random()));
  rec.prod.milk = 0;
  goodsAdd('milk', n);
  anVoice('cattle', e);
}
// the herder's board at the town common: buy stock, shears and feed
function openHerder(pen) {
  const stock = [['sheep', 'f'], ['sheep', 'm'], ['cattle', 'f'], ['cattle', 'm'], ['hen', 'f'], ['hen', 'm']];
  let body = `<p>The common of ${esc(REALMS[pen.realm].townName)}. A board by the gate lists what the herder will sell, and you may keep your own beasts here among the town's.</p><div class="an-shop">`;
  const acts = [];
  for (const [k, sex] of stock) {
    const price = AKIND[k].price[sex === 'm' ? 0 : 1];
    body += `<div class="an-row"><span>A grown ${AKIND[k][sex]}</span><em>${price} gold</em></div>`;
    acts.push([`Buy a ${AKIND[k][sex]} (${price})`, () => { if (anBuy(k, sex, pen, price)) openHerder(pen); }]);
  }
  for (const [id, n, price] of [['tool_shears', 1, 8], ['feed', 3, 6], ['fence_kit', 1, 30]]) {
    body += `<div class="an-row"><span>${n > 1 ? n + ' ' : ''}${goodName(id, n)}</span><em>${price} gold</em></div>`;
    acts.push([`Buy ${goodName(id, n).toLowerCase()} (${price})`, () => { if (spendGold(price)) { goodsAdd(id, n); openHerder(pen); } else uiError('Not enough gold'); }]);
  }
  body += `</div><p class="fineprint">You have ${fmtInt(INV.gold)} gold. Feed fills a paddock's rack when there is no grazing; shears take the fleece; a fence kit builds a paddock anywhere you like.</p>`;
  acts.push(['Close', anCloseDialog]);
  anDialog('The herder\'s board', body, acts);
}
function spendGold(n) { if ((INV.gold || 0) < n) return false; INV.gold -= n; sfx('coins'); saveSoon(); return true; }
function anBuy(k, sex, pen, price) {
  if (!spendGold(price)) { uiError('Not enough gold'); return false; }
  const br = REALM_BREEDS[pen.realm] && REALM_BREEDS[pen.realm][k], ci = br ? br[Math.floor(Math.random() * br.length)] : -1;
  const rec = anRecord(k, { owner: 'player', sex, cmd: 'pen', pen: pen.id, tr: anWildTraits(k, Math.random, ci >= 0 ? { colA: ACOATS[k][ci][0], colB: ACOATS[k][ci][1] } : null) });
  const p = penWorld(pen, (Math.random() - 0.5) * 4, pen.hd - 2.5);
  anSpawn(rec, p.x, p.z);
  uiLog(`You buy ${rec.name}, a ${AKIND[k][sex]}. It waits in the common; open its card to lead it away.`, 'loot');
  loreNote('stock');
  return true;
}
function openPen(pen) {
  const mine = ANIMALS.list.filter((e) => e.tame && e.tame.pen === pen.id && e.tame.cmd === 'pen' && e.alive);
  const counts = {};
  for (const e of mine) { const s = anStage(e.tame); counts[s] = (counts[s] || 0) + 1; }
  let body = `<p>${mine.length ? Object.entries(counts).map(([s, n]) => `${n} ${n > 1 ? anPlural(s) : s}`).join(', ') : 'No animals yet. Lead some here, or open an animal\'s card and choose the paddock.'}.</p>`;
  body += anBar('Feed', pen.feed, 12, `${Math.round(pen.feed)}`) + anBar('Water', pen.water, 12, `${Math.round(pen.water)}`, 'blue') + anBar('Manure', pen.manure, 20, `${Math.floor(pen.manure)}`);
  body += `<p class="fineprint">${anPenGrass(pen) > 0.3 ? 'There is grazing here.' : 'There is little grazing: fill the rack.'} ${pen._wNear ? 'Water comes from the pond nearby.' : 'Rain and your waterskins fill the trough.'} The shed at the back gives shelter from snow and storm.</p>`;
  const acts = [];
  const feedIds = ['feed', 'grain', 'turnip', 'cabbage', 'apple'].filter((id) => goodsHave(id));
  if (feedIds.length) acts.push([`Fill the rack (${goodName(feedIds[0], 2).toLowerCase()})`, () => { const id = feedIds[0], n = Math.min(goodsCount(id), id === 'feed' ? 3 : 5); anPenFill(pen, 'feed', id, n); openPen(pen); }, 'primary']);
  if (goodsHave('water')) acts.push(['Fill the trough', () => { const n = Math.min(goodsCount('water'), 4); anPenFill(pen, 'water', 'water', n); openPen(pen); }]); // [depth] the skins come back empty
  if (pen.manure >= 1) acts.push([`Muck out (+${Math.floor(pen.manure)} manure)`, () => { anPenMuck(pen); openPen(pen); }]);
  acts.push(['Close', anCloseDialog]);
  anDialog(pen.name, body, acts);
}
// the animals list (K): companions, livestock and paddocks, and fencing a new paddock
function openAnimals() {
  const mine = anMine();
  let body = '';
  if (!mine.length && !ANIMALS.down.length) body += `<p>You keep no animals yet. Wolves, boars, wild horses and deer can be tamed: walk up to one calmly and offer it the food it likes, again and again until it trusts you. Sheep, cattle and hens can be bought at the herder's board by your town's common.</p>`;
  body += '<div class="an-list">';
  for (const e of mine) {
    const rec = e.tame;
    const where = rec.cmd === 'pen' ? (penById(rec.pen) ? penById(rec.pen).name : 'a paddock') : rec.cmd === 'follow' ? 'with you' : rec.cmd === 'attack' ? 'fighting' : rec.cmd === 'guard' ? 'on guard' : 'waiting';
    body += `<button type="button" class="an-item" data-aid="${e.id}"><i style="background:${anCss(rec.tr.coat)}"></i><b>${esc(rec.name)}</b><span>${anStage(rec)} · ${where}${rec.preg ? ' · in young' : ''}</span><em style="--v:${anPct(e.hp / e.maxHp)}"></em></button>`;
  }
  for (const rec of ANIMALS.down) body += `<div class="an-item down"><i style="background:${anCss(rec.tr.coat)}"></i><b>${esc(rec.name)}</b><span>hurt, back in ${Math.ceil(rec.down)} s</span></div>`;
  body += '</div>';
  const own = ANIMALS.pens.filter((p) => p.owner === 'player');
  body += `<p class="fineprint">${own.length ? `${own.length} paddock${own.length > 1 ? 's' : ''} of your own. ` : ''}A paddock needs a fence kit or 8 logs or planks. Mark it out and fence it where the ground is clear and fairly flat.</p>`;
  const acts = [['Mark out a paddock', () => { anCloseDialog(); anMarkStart(); }], ['Call companions', () => { for (const e of anCompanions()) anCommand(e, 'call'); anCloseDialog(); }], ['Close', anCloseDialog]];
  anDialog('Your animals', body, acts);
  $('dlg-body').querySelectorAll('.an-item[data-aid]').forEach((b) => b.addEventListener('click', () => { const e = getEnt(+b.dataset.aid); if (e) openAnimalCard(e); }));
}
// marking out a paddock: a frame of light follows you; E (or the button) fences it
function anMarkStart() {
  if (!goodsHave('fence_kit') && goodsCount('log') + goodsCount('plank') < 8) { uiError('You need a fence kit, or 8 logs or planks'); return; }
  ANIMALS.marking = { t: GAME.t };
  uiToast(`Walk to where the paddock should be, then ${IS_TOUCH ? 'tap Fence here' : 'press E'} to build it. ${IS_TOUCH ? 'Stop' : 'Esc'} to stop.`, 'hint');
  ANIMALS.uiDirty = true;
}
function anMarkSpot() {
  const P = GAME.player, hw = 6, hd = 4.5, d = hd + 2.2;
  const x = P.x + Math.sin(P.yaw) * d, z = P.z + Math.cos(P.yaw) * d;
  return { x, z, yaw: P.yaw + Math.PI, hw, hd }; // the gate faces you
}
function anMarkConfirm(sharedSpot = null, sharedOwner = null) {
  const S = sharedSpot || anMarkSpot();
  const why = penSiteOk(S.x, S.z, S.yaw, S.hw, S.hd);
  if (why) { uiError(why); return false; }
  const cost = goodsHave('fence_kit') ? [['fence_kit', 1]] : [['plank', Math.min(8, goodsCount('plank'))], ['log', Math.max(0, 8 - goodsCount('plank'))]].filter(([, n]) => n > 0);
  if (typeof netWorldPartsRequest === 'function' && netWorldPartsRequest('animal.pen.create', S, cost)) return false;
  if (goodsHave('fence_kit')) goodsTake('fence_kit', 1);
  else { let n = 8; const pl = Math.min(n, goodsCount('plank')); goodsTake('plank', pl); n -= pl; if (n > 0 && !goodsTake('log', n)) { uiError('You need a fence kit, or 8 logs or planks'); return false; } }
  if (!sharedOwner) ANIMALS.marking = null;
  const pen = penMake({ owner: 'player', sharedOwner: sharedOwner || anSharedAccount(), realm: GAME.player?.faction ?? -1, x: S.x, z: S.z, yaw: S.yaw, hw: S.hw, hd: S.hd, feed: 4, water: 6, name: `Paddock ${ANIMALS.pens.filter((p) => p.owner === 'player').length + 1}` });
  FX.dust(pen.x, heightAt(pen.x, pen.z), pen.z, 30, [0.5, 0.42, 0.3]);
  sfx('thud');
  uiLog('You drive the posts and nail the rails: a paddock with a trough, a rack and a shed. Lead animals in, or send them from their cards.', 'loot');
  loreNote('pen');
  ANIMALS.uiDirty = true;
  saveSoon();
  return pen;
}

/* ------------------------------------------------------------------ */
/* the companion bar (HUD) and the frame                               */
/* ------------------------------------------------------------------ */
function anBuildUI() {
  const bar = document.createElement('div');
  bar.id = 'petbar'; bar.className = 'panel'; bar.hidden = true;
  bar.innerHTML = '<div class="pb-pets" id="pb-pets"></div><div class="pb-cmds" role="group" aria-label="Commands for your companions"><button type="button" data-cmd="follow">Follow</button><button type="button" data-cmd="stay">Stay</button><button type="button" data-cmd="guard">Guard</button><button type="button" data-cmd="attack">Attack</button><button type="button" data-cmd="call">Call</button><button type="button" data-cmd="list" aria-label="Your animals (K)">Animals</button></div>';
  $('hud').appendChild(bar);
  bar.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b || !GAME.player) return;
    ev.stopPropagation();
    sfx('click');
    const cmd = b.dataset.cmd;
    if (cmd === 'list') { if (!UI.modal) openAnimals(); return; }
    if (cmd === 'fence') { anMarkConfirm(); return; }
    if (cmd === 'stopmark') { ANIMALS.marking = null; ANIMALS.uiDirty = true; return; }
    if (b.dataset.aid) { ANIMALS.pick = ANIMALS.pick === +b.dataset.aid ? null : +b.dataset.aid; ANIMALS.uiDirty = true; return; }
    const sel = ANIMALS.pick ? anCompanions().filter((e) => e.id === ANIMALS.pick) : anCompanions();
    if (cmd === 'attack' && !getEnt(GAME.player.target)) { uiError('Target a foe first'); return; }
    for (const e of sel) anCommand(e, cmd);
    if (cmd === 'call') sfx('whistle');
  });
  bar.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  // a lone button to open the animals list when you have none following
  const btn = document.createElement('button');
  btn.id = 'btn-animals'; btn.type = 'button'; btn.className = 'iconbtn panel'; btn.setAttribute('aria-label', 'Your animals (K)');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M7 10c-1.6 0-2.6-1.4-2.4-2.8.2-1.4 1.5-2.2 2.8-1.8 1.3.4 1.9 1.8 1.5 3-.3.9-1 1.6-1.9 1.6zM17 10c1.6 0 2.6-1.4 2.4-2.8-.2-1.4-1.5-2.2-2.8-1.8-1.3.4-1.9 1.8-1.5 3 .3.9 1 1.6 1.9 1.6zM10 7.2c-1.4 0-2.2-1.4-2-2.6.2-1.2 1.3-1.9 2.4-1.5 1 .3 1.5 1.5 1.2 2.6-.2.8-.9 1.5-1.6 1.5zM14 7.2c1.4 0 2.2-1.4 2-2.6-.2-1.2-1.3-1.9-2.4-1.5-1 .3-1.5 1.5-1.2 2.6.2.8.9 1.5 1.6 1.5zM12 11c-3 0-5.5 3.5-5.5 6 0 2 1.6 3 3 2.6 1-.3 1.6-.8 2.5-.8s1.5.5 2.5.8c1.4.4 3-.6 3-2.6 0-2.5-2.5-6-5.5-6z"/></svg>';
  btn.addEventListener('click', () => { if (!UI.modal) { sfx('click'); openAnimals(); } });
  const tr = $('btn-map') && $('btn-map').parentElement;
  if (tr) tr.insertBefore(btn, $('btn-log'));
}
function anUpdateUI(dt) {
  const bar = $('petbar');
  if (!bar || !GAME.player) return;
  ANIMALS.uiT -= dt;
  if (ANIMALS.uiT > 0 && !ANIMALS.uiDirty) return;
  ANIMALS.uiT = 0.25; ANIMALS.uiDirty = false;
  const pets = anCompanions();
  const marking = !!ANIMALS.marking;
  // on a phone the bar always shows, at least its Animals button (the icon row has no room for another)
  const phone = IS_TOUCH || innerWidth <= 760, solo = !pets.length && !marking;
  bar.hidden = solo && !phone;
  bar.classList.toggle('solo', solo);
  if (bar.hidden) return;
  // a phone held upright has no room beside the health frame: the bar goes under it (and under the path tracker)
  const tall = innerWidth <= 760 && innerHeight > innerWidth;
  bar.classList.toggle('tall', tall);
  const cls = $('cls');
  if (tall && !HUDL.on) { // [phones] the HUD's layout pass (10p_hud.js) stacks the column now
    const clsLeft = cls && cls.offsetParent && IS_TOUCH && !cls.hidden && cls.childElementCount > 0; // [perf2] asked only here (reading offsetParent laid the page out four times a second)
    let top = $('pf').getBoundingClientRect().bottom;
    const lp = $('lore-path');
    if (lp && !lp.hidden && lp.offsetParent) top = Math.max(top, lp.getBoundingClientRect().bottom);
    // the calling's panel (10d_classes_ui.js) shares the column under the frames: it comes first, the companions under it
    if (clsLeft) {
      const cw = Math.round(top + 6) + 'px';
      if (cls.style.top !== cw) cls.style.top = cw;
      top = cls.getBoundingClientRect().bottom;
    }
    const want = Math.round(top + 6) + 'px';
    if (bar.style.top !== want) bar.style.top = want;
  } else if (!HUDL.on) {
    if (bar.style.top) bar.style.top = '';
    if (cls && cls.style.top) cls.style.top = '';
  }
  const host = $('pb-pets');
  const key = pets.map((e) => `${e.id}:${e.tame.name}:${e.tame.cmd}:${Math.round(e.hp / e.maxHp * 20)}:${Math.round(e.tame.hunger * 10)}:${e.tame.lvl}:${ANIMALS.pick === e.id}`).join('|') + marking + solo;
  if (key === ANIMALS.uiKey) return;
  ANIMALS.uiKey = key;
  host.innerHTML = pets.slice(0, 4).map((e) => {
    const r = e.tame;
    return `<button type="button" class="pb-pet${ANIMALS.pick === e.id ? ' on' : ''}" data-aid="${e.id}" title="${esc(r.name)}: ${r.cmd}"><b>${esc(r.name)}</b><small>${anStage(r)}${AKIND[r.k].fights ? ' ' + r.lvl : ''} · ${r.cmd}</small><i class="pb-hp"><s style="width:${anPct(e.hp / e.maxHp)}"></s></i><i class="pb-fd"><s style="width:${anPct(r.hunger)}"></s></i></button>`;
  }).join('') + (marking ? '<div class="pb-mark"><button type="button" class="pb-fence" data-cmd="fence">Fence here</button><button type="button" class="pb-fence pb-stop" data-cmd="stopmark">Stop</button></div>' : '');
  bar.querySelector('.pb-cmds').hidden = !pets.length && !solo;
}
function drawAnimals(dt) {
  if (!ANIMALS.inited) return;
  if (UI.modal !== 'dialog') ANIMALS.dlg = false;
  // gates swing open for whoever walks up and close behind them
  for (const pen of ANIMALS.pens) {
    const want = GAME.t < pen.gateWant ? 1 : 0;
    pen.gateOpen = clamp(pen.gateOpen + (want ? dt : -dt) * 1.6, 0, 1);
    if (pen.gateMesh) pen.gateMesh.rotation.y = pen.yaw + 1.45 * smooth(pen.gateOpen);
    // hay in the rack while there is feed: a few golden tufts
    if (pen.feed > 0.5 && dist2(pen.rack.x, pen.rack.z, camera.position.x, camera.position.z) < 50 * 50 && Math.random() < 0.02) fxAlpha.emit(pen.rack.x + (Math.random() - 0.5) * 0.4, heightAt(pen.rack.x, pen.rack.z) + 0.9, pen.rack.z + (Math.random() - 0.5) * 0.4, 0, -0.2, 0, 1.2, 0.62, 0.52, 0.28, 0.05, 2, 0.5);
  }
  // marking out: the frame of the paddock-to-be, green where it can go and red where it cannot
  if (ANIMALS.marking && GAME.player) {
    const S = anMarkSpot(), ok = !penSiteOk(S.x, S.z, S.yaw, S.hw, S.hd);
    const pen = { x: S.x, z: S.z, yaw: S.yaw };
    const col = ok ? [0.5, 1.6, 0.6] : [1.8, 0.5, 0.4];
    const per = 2 * (S.hw * 2 + S.hd * 2), n = 26;
    for (let i = 0; i < n; i++) {
      let u = (i / n) * per, lx, lz;
      if (u < S.hw * 2) { lx = -S.hw + u; lz = -S.hd; } else if ((u -= S.hw * 2) < S.hd * 2) { lx = S.hw; lz = -S.hd + u; } else if ((u -= S.hd * 2) < S.hw * 2) { lx = S.hw - u; lz = S.hd; } else { u -= S.hw * 2; lx = -S.hw; lz = S.hd - u; }
      const p = penWorld(pen, lx, lz);
      glowPush(p.x, heightAt(p.x, p.z) + 0.5, p.z, col[0], col[1], col[2], 0.35);
    }
  }
  if (WEATHER.flash > 0.9 && !ANIMALS.flashSeen) {
    ANIMALS.flashSeen = true;
    const cx = camera.position.x, cz = camera.position.z;
    for (const e of ANIMALS.list) if (e.alive && e.tame && e.tame.k !== 'hound' && dist2(e.x, e.z, cx, cz) < 70 * 70 && Math.random() < 0.8 - 0.5 * e.tame.tr.calm) later(Math.random() * 0.8, () => { if (e.alive) anStartle(e, e.x + (Math.random() - 0.5) * 6, e.z + (Math.random() - 0.5) * 6); });
  } else if (WEATHER.flash < 0.5) ANIMALS.flashSeen = false;
  ANIMALS.voiceT = (ANIMALS.voiceT ?? 3) - dt;
  if (ANIMALS.voiceT < 0 && GAME.started) {
    ANIMALS.voiceT = 3 + Math.random() * 7;
    const cx = camera.position.x, cz = camera.position.z, near = ANIMALS.list.filter((e) => e.alive && e.tame && dist2(e.x, e.z, cx, cz) < 30 * 30);
    if (near.length) { const e = near[Math.floor(Math.random() * near.length)]; if (e.tame.k !== 'horse' || Math.random() < 0.2) anVoice(e.tame.k, e); }
  }
  anUpdateUI(dt);
}
// a few voices of their own, quieter with distance
function anVoice(k, e) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const d = e ? dist(e.x, e.z, camera.position.x, camera.position.z) : 0;
  if (d > 45) return;
  const v = clamp(1 - d / 45, 0.1, 1), t = AUDIO.ctx.currentTime + 0.01;
  const voice = AKIND[k] ? AKIND[k].voice : null;
  try {
    if (voice === 'bleat') { for (let i = 0; i < 4; i++) tone('sawtooth', 420 + i * 6, 400, t + i * 0.09, 0.09, 0.035 * v, 0.01); }
    else if (voice === 'moo') { tone('sawtooth', 120, 105, t, 0.9, 0.06 * v, 0.15); tone('sine', 240, 205, t, 0.9, 0.04 * v, 0.15); }
    else if (voice === 'cluck') { for (let i = 0; i < 3; i++) { tone('square', 620 - i * 30, 480, t + i * 0.13, 0.05, 0.02 * v, 0.003); } }
    else if (voice === 'bark') { tone('sawtooth', 300, 170, t, 0.12, 0.06 * v, 0.005); noiseBurst(t, 0.1, 0.05 * v, 'bandpass', 900, 500, 1.5, 0.005); }
    else if (voice === 'grunt') { tone('sawtooth', 110, 80, t, 0.22, 0.05 * v, 0.02); noiseBurst(t, 0.2, 0.04 * v, 'lowpass', 500, 200, 1, 0.02); }
    else if (voice === 'whinny') sfx('whinny');
  } catch (err) { /* audio is best effort */ }
}

/* ------------------------------------------------------------------ */
/* your own horse                                                      */
/* ------------------------------------------------------------------ */
// the horse you tamed is the one you ride: R mounts it when it is near (or whistles it up), with its own coat and pace
function animalsRideLook(P) {
  if (P !== GAME.player) return null;
  const horse = anMine().find((e) => e.alive && e.tame.k === 'horse' && anAdult(e.tame) && e.tame.cmd !== 'pen');
  if (!horse) return null;
  const rec = horse.tame;
  const base = REALMS[P.faction].rgb;
  removeEnt(horse);
  return { coat: rec.tr.coat.slice(), cloth: base.map((v) => v * 0.82), crowd: 'horseTack', visCode: 4 * anExpress(rec.tr.al) + 16 * rec.tr.seed, speed: rec.tr.speed, rec };
}
// stepping down leaves your horse standing beside you
function animalsDismounted(P, M) {
  if (!M || !M.rec) return;
  const rec = M.rec;
  const x = P.x + Math.cos(P.yaw) * 1.6, z = P.z - Math.sin(P.yaw) * 1.6;
  const e = anSpawn(rec, isWalkable(x, z) ? x : P.x, isWalkable(x, z) ? z : P.z, P.yaw);
  rec.cmd = 'follow';
  e.hp = e.maxHp;
}
// R with your own horse close by: straight into the saddle, no whistle needed
function animalsQuickMount(P) {
  const h = anMine().find((e) => e.alive && e.tame.k === 'horse' && anAdult(e.tame) && e.tame.cmd !== 'pen' && dist2(e.x, e.z, P.x, P.z) < 9 * 9);
  if (!h) return false;
  P.x = P.prevX = h.x; P.z = P.prevZ = h.z; P.yaw = h.yaw;
  mountUp(P);
  return true;
}
const animalsMountSpeed = (P) => (P.mount && P.mount.speed ? clamp(P.mount.speed, 0.8, 1.4) : 1);
// wild deer that see you coming calmly with food do not bolt (08b_wildlife.js asks)
function animalsSparesDeer(e, o) { return o.role === 'player' && anPlayerCalm(o) && AKIND.deer.likes.some((id) => goodsHave(id)) && (ANIMALS.trust.has(e.id) || dist2(o.x, o.z, e.x, e.z) < 15 * 15); }

/* ------------------------------------------------------------------ */
/* saved with the character                                            */
/* ------------------------------------------------------------------ */
const r3 = (v) => Math.round(v * 1000) / 1000;
function anSaveTr(t) { return { coat: t.coat.map(r3), coat2: t.coat2.map(r3), al: t.al.slice(), seed: t.seed, size: r3(t.size), calm: r3(t.calm), yield: r3(t.yield), speed: r3(t.speed), strength: r3(t.strength) }; }
function anSaveRec(rec, e) {
  const o = { a: rec.aid, k: rec.k, n: rec.name, s: rec.sex, g: rec.gen, age: Math.round(rec.age), tr: anSaveTr(rec.tr), c: rec.cmd, h: r3(rec.hunger), w: r3(rec.thirst), l: rec.lvl, xp: Math.round(rec.xp), pr: { wool: r3(rec.prod.wool), milk: r3(rec.prod.milk), egg: r3(rec.prod.egg) } };
  if (rec.moult) o.mt = Math.round(rec.moult);
  if (rec.sharedClaim) o.sc = rec.sharedClaim;
  if (rec.publicCycles) o.pc = { lay: rec.publicCycles.lay || 0, clutch: rec.publicCycles.clutch || 0, moult: rec.publicCycles.moult || 0 };
  if (rec.publicPending) o.pp = { lay: rec.publicPending.lay || 0, clutch: rec.publicPending.clutch || 0, moult: rec.publicPending.moult || 0 };
  if (rec.ma) o.ma = [rec.ma.aid, rec.ma.name];
  if (rec.pa) o.pa = [rec.pa.aid, rec.pa.name];
  if (rec.pen != null) o.p = rec.pen;
  if (rec.stay) o.st = [Math.round(rec.stay.x * 10) / 10, Math.round(rec.stay.z * 10) / 10];
  if (rec.preg) o.pg = { l: Math.round(rec.preg.left), a: rec.preg.sire.aid, n: rec.preg.sire.name, g: rec.preg.sire.gen || 0, tr: anSaveTr(rec.preg.sire.tr) };
  if (e) { o.x = Math.round(e.x * 10) / 10; o.z = Math.round(e.z * 10) / 10; o.hp = r3(e.hp / e.maxHp); }
  if (rec.down > 0) o.dn = Math.round(rec.down);
  return o;
}
function animalsSave() {
  if (!ANIMALS.inited) return null;
  const P = GAME.player;
  const list = anMine().filter((e) => e.alive).map((e) => anSaveRec(e.tame, e));
  for (const rec of ANIMALS.down) list.push(anSaveRec(rec, null));
  if (P && P.mount && P.mount.rec) list.push({ ...anSaveRec(P.mount.rec, null), ridden: 1 });
  const pens = ANIMALS.pens.filter((p) => p.owner === 'player' && anSharedPenMine(p)).map((p) => ({ id: p.id, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, yaw: r3(p.yaw), hw: p.hw, hd: p.hd, f: Math.round(p.feed * 10) / 10, w: Math.round(p.water * 10) / 10, m: Math.round(p.manure * 10) / 10, n: p.name, sd: p.seed }));
  if (!list.length && !pens.length) return null;
  return { v: 1, next: ANIMALS.nextAid, np: ANIMALS.nextPen, list, pens, receipts: [...ANIMALS_SHARED.received].slice(-128) };
}
// what counts as a change worth writing: who you keep and how, not their clocks
function animalsKey(d) {
  if (!d) return null;
  return { list: (d.list || []).map((o) => [o.a, o.n, o.c, o.p, o.g, o.pg ? 1 : 0, Math.round((o.age || 0) / 120), o.l]), pens: (d.pens || []).map((p) => [p.id, p.x, p.z]) };
}
function animalsLoad(d) {
  if (!ANIMALS.inited) return;
  // the last character's animals go away first
  for (const e of anMine()) removeEnt(e);
  ANIMALS.list = ANIMALS.list.filter((e) => !e.removed);
  ANIMALS.down.length = 0; ANIMALS_SHARED.received.clear();
  if (!ANIMALS_SHARED.ready) for (const p of ANIMALS.pens.filter((q) => q.owner === 'player')) penRemove(p);
  ANIMALS.trust.clear(); ANIMALS.trail.length = 0; ANIMALS.marking = null; ANIMALS.pick = null;
  if (!d || typeof d !== 'object') return;
  ANIMALS_SHARED.received = new Set((Array.isArray(d.receipts) ? d.receipts : []).filter(id => typeof id === 'string').slice(-128));
  const P = GAME.player;
  const num = (v, lo, hi, def) => (isFiniteNum(+v) ? clamp(+v, lo, hi) : def);
  ANIMALS.nextAid = Math.max(ANIMALS.nextAid, Math.round(num(d.next, 1, 1e9, 1)));
  ANIMALS.nextPen = Math.max(ANIMALS.nextPen, Math.round(num(d.np, 1, 1e9, 1)));
  const penMap = new Map();
  for (const q of (!ANIMALS_SHARED.ready && Array.isArray(d.pens) ? d.pens : []).slice(0, 12)) {
    if (!q || !isFiniteNum(+q.x) || !isFiniteNum(+q.z)) continue;
    const hw = num(q.hw, 3, 12, 6), hd = num(q.hd, 3, 10, 4.5);
    const pen = penMake({ id: ANIMALS.nextPen++, owner: 'player', x: +q.x, z: +q.z, yaw: num(q.yaw, -10, 10, 0), hw, hd, feed: num(q.f, 0, 30, 4), water: num(q.w, 0, 30, 6), manure: num(q.m, 0, 20, 0), name: typeof q.n === 'string' ? q.n.slice(0, 24).replace(/[<>&"]/g, '') : 'Paddock', seed: Math.round(num(q.sd, 0, 1e7, 7)) });
    penMap.set(q.id, pen.id);
  }
  for (const o of (Array.isArray(d.list) ? d.list : []).slice(0, 80)) {
    if (!o || !AKIND[o.k]) continue;
    const rec = anRecord(o.k, { owner: 'player', sex: o.s === 'm' ? 'm' : 'f', tr: anCleanTraits(o.tr, o.k), name: typeof o.n === 'string' && o.n.trim() ? o.n.slice(0, 16).replace(/[<>&"]/g, '') : pick(Math.random, PET_NAMES), gen: Math.round(num(o.g, 0, 999, 0)), age: num(o.age, 0, 1e8, AKIND[o.k].grow * 2) });
    rec.moult = num(o.mt, 0, 1000, 0);
    if (typeof o.sc === 'string') rec.sharedClaim = o.sc.slice(0, 160);
    if (o.pc && typeof o.pc === 'object') rec.publicCycles = { lay: Math.floor(num(o.pc.lay, 0, 1e9, 0)), clutch: Math.floor(num(o.pc.clutch, 0, 1e9, 0)), moult: Math.floor(num(o.pc.moult, 0, 1e9, 0)) };
    if (o.pp && typeof o.pp === 'object') rec.publicPending = { lay: Math.floor(num(o.pp.lay, 0, 1e9, 0)), clutch: Math.floor(num(o.pp.clutch, 0, 1e9, 0)), moult: Math.floor(num(o.pp.moult, 0, 1e9, 0)) };
    rec.aid = Math.round(num(o.a, 1, 1e9, ANIMALS.nextAid++));
    ANIMALS.nextAid = Math.max(ANIMALS.nextAid, rec.aid + 1);
    rec.cmd = ['follow', 'stay', 'guard', 'pen'].includes(o.c) ? o.c : (AKIND[o.k].live ? 'pen' : 'follow');
    rec.hunger = num(o.h, 0, 1, 0.8); rec.thirst = num(o.w, 0, 1, 0.8); rec.lvl = Math.round(num(o.l, 1, 10, 1)); rec.xp = num(o.xp, 0, 1e6, 0);
    if (o.pr && typeof o.pr === 'object') rec.prod = { wool: num(o.pr.wool, 0, 1.2, 0.5), milk: num(o.pr.milk, 0, 1, 0), egg: num(o.pr.egg, 0, 1, 0) };
    if (Array.isArray(o.ma)) rec.ma = { aid: Math.round(num(o.ma[0], 0, 1e9, 0)), name: String(o.ma[1] || '').slice(0, 16).replace(/[<>&"]/g, '') };
    if (Array.isArray(o.pa)) rec.pa = { aid: Math.round(num(o.pa[0], 0, 1e9, 0)), name: String(o.pa[1] || '').slice(0, 16).replace(/[<>&"]/g, '') };
    if (o.p != null) rec.pen = penMap.has(o.p) ? penMap.get(o.p) : (penById(o.p) ? o.p : null);
    if (rec.cmd === 'pen' && !penById(rec.pen)) { const R = P && REALMS[P.faction]; rec.pen = R && R.pasture ? R.pasture.id : null; if (rec.pen == null) rec.cmd = 'follow'; }
    if (Array.isArray(o.st) && isFiniteNum(+o.st[0]) && isFiniteNum(+o.st[1])) rec.stay = { x: +o.st[0], z: +o.st[1] };
    if ((rec.cmd === 'stay' || rec.cmd === 'guard') && !rec.stay) rec.cmd = 'follow';
    if (o.pg && typeof o.pg === 'object' && rec.sex === 'f') rec.preg = { left: num(o.pg.l, 1, 1e5, 60), sire: { aid: Math.round(num(o.pg.a, 0, 1e9, 0)), name: String(o.pg.n || 'a sire').slice(0, 16).replace(/[<>&"]/g, ''), gen: Math.round(num(o.pg.g, 0, 999, 0)), tr: anCleanTraits(o.pg.tr, o.k) } };
    rec.breedAt = GAME.t + 30;
    if (o.dn > 0) { rec.down = num(o.dn, 1, 300, 60); ANIMALS.down.push(rec); continue; }
    let x = +o.x, z = +o.z;
    if (o.ridden || !isFiniteNum(x) || !isFiniteNum(z) || rec.cmd === 'follow') { const s = P ? { x: P.x + (Math.random() - 0.5) * 4, z: P.z + (Math.random() - 0.5) * 4 } : { x: 0, z: 0 }; x = s.x; z = s.z; }
    if (rec.cmd === 'pen' && penById(rec.pen) && !penHas(penById(rec.pen), x, z)) { const pp = penWorld(penById(rec.pen), 0, 0); x = pp.x; z = pp.z; }
    const e = anSpawn(rec, x, z);
    e.hp = e.maxHp * num(o.hp, 0.05, 1, 1);
  }
}

/* ------------------------------------------------------------------ */
/* the Chronicle, the help, field notes                                */
/* ------------------------------------------------------------------ */
function chronAnimals() {
  const mine = GAME.player ? anMine() : [];
  return `<p class="lead">The wild things of the March can be won over, and the folk of every town keep sheep, cattle and hens on the common.</p>
    <h3>Taming</h3><p>Walk up to a wolf, a boar, a wild horse or a deer calmly, on foot and out of any fight, and stand still a moment until it settles. Then offer it the food it likes with E: <b>meat</b> for wolves; <b>grain, apples or roots</b> for boars, horses and deer. Each feeding builds its trust; a wolf needs four, a boar three, a horse four (more if it is wild-hearted). Sprint or ride at it and it takes fright and trusts you less; strike it and its trust is gone.</p>
    <p>A tamed wolf becomes a <b>hound</b> that fights beside you and grows bolder (its bond level) with every foe it brings down. A boar becomes a <b>pig</b> that roots out mushrooms when you walk it through the woods, a deer a gentle companion, and a wild horse <b>your own mount</b>: R swings you up when it is near, or whistles it to you, and it keeps its own coat and pace.</p>
    <h3>Companions</h3><p>The bar under your health shows who follows you. <b>Follow</b>, <b>Stay</b>, <b>Guard</b> (fight anything that comes near the spot), <b>Attack</b> (your target) and <b>Call</b> (come at once) go to all of them, or to the one you tap. They find their way round walls and through doors along the path you took, and wait beside you, never in a doorway. They get hungry: open a companion's card (E beside it, or K for the list) to feed it, rename it, or send it to a paddock. A companion that falls limps away and finds you again later.</p>
    <h3>Livestock</h3><p>Buy sheep, cattle and hens at the herder's board by your town's common, or breed your own. They graze when there is grass, eat from the rack and drink from the trough, and crowd into the shed when it snows or storms. Content animals give: <b>wool</b> (shear a full fleece with shears), <b>milk</b>, <b>eggs</b> (walk over them to pick them up) and <b>manure</b> for the fields (muck out the paddock). In winter or under snow there is no grazing: fill the rack with feed (the herder sells it), grain or roots. Thunder frightens them; a placid animal minds it less.</p>
    <p>To keep your own, mark out a <b>paddock</b> from the animals list (a fence kit, or eight logs or planks) on clear, fairly flat ground. Its gate opens as you walk up to it.</p>
    <h3>Breeding</h3><p>A grown male and female of a kind, fed and content and close together, will pair; the young are born some minutes later (hens sit on their eggs) and grow up over the next ten minutes or so. Each of the young takes after both parents: coat colour, size, temper, yield (wool, milk, eggs), speed in horses and strength in hounds, each a little better or worse than the parents' middle. Coat patterns pass on as hidden traits too: patched and belted show if either parent gives them, dappled only from both. Keep the best of each generation and breed them, and over the generations your stock grows better. Every animal's card shows its traits and its dam and sire.</p>
    ${depthChronAnimals() /* [depth] hatching eggs, herding with a hound, feathers (09u_depth.js) */}
    ${mine.length ? `<p class="now">You keep ${mine.length} animal${mine.length > 1 ? 's' : ''}.</p>` : ''}`;
}
function animalsHelpHTML() {
  return `<h3>Animals</h3><p>Tame wolves, boars, wild horses and deer by walking up calmly and offering the food each likes (E), feeding by feeding. Companions follow you and take orders from the bar under your health; K lists your animals. Buy sheep, cattle and hens at your town's common, fence a paddock of your own, collect wool, milk, eggs and manure, and breed the best of them. The Chronicle tells more.</p>`;
}
function animalsNotes() {
  if (typeof FIELD_NOTES === 'undefined') return;
  Object.assign(FIELD_NOTES, {
    tame: { t: 'Winning trust', x: () => 'Keep coming back calmly with food. Stand still while it settles; never sprint or ride at it, and never strike it.' },
    pets: { t: 'A companion', x: () => 'It follows you now. The bar under your health gives orders: follow, stay, guard, attack, call. Feed it from its card (E beside it, K for the list).' },
    stock: { t: 'Your own stock', x: () => 'Open its card to lead it away, or keep it in the common. Fed, watered and content animals give wool, milk and eggs, and breed.' },
    pen: { t: 'A paddock', x: () => 'Fill the rack with grain when there is no grazing, keep the trough full, and muck it out for manure. The shed shelters them from snow and storm.' },
    breed: { t: 'Young on the way', x: () => 'The young take after both parents, a little better or worse in each trait. Breed the best to raise better stock.' },
  });
}

/* ------------------------------------------------------------------ */
/* test hooks                                                          */
/* ------------------------------------------------------------------ */
const ANIMALS_DEBUG = {
  A: ANIMALS, AKIND, anRecord, anSpawn, anTame, anOffer, anTrust, anWildKind, anCommand, anInherit, anExpress, anWildTraits, anStage, anAdult, anScale,
  openAnimalCard, openAnimals, openHerder, openPen, anMarkStart, anMarkConfirm, anMarkSpot, penSiteOk, penMake, penHas, penById, anBuy, anFeed, anShear, anMilk, anBirth, anClock,
  animalsSave, animalsLoad, animalsKey, anMine, anCompanions, animalsRideLook,
  // a short summary that is safe to return from page.evaluate
  sum(e) { if (!e || !e.tame) return null; const r = e.tame; return { id: e.id, aid: r.aid, k: r.k, name: r.name, sex: r.sex, owner: r.owner, cmd: r.cmd, age: Math.round(r.age), adult: anAdult(r), gen: r.gen, scale: Math.round(e.scale * 1000) / 1000, crowd: e.crowd, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp), x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, hunger: Math.round(r.hunger * 100) / 100, mood: Math.round(r.mood * 100) / 100, lvl: r.lvl, preg: !!r.preg, prod: { ...r.prod }, tr: anSaveTr(r.tr), ma: r.ma, pa: r.pa, faction: e.faction, alive: e.alive, pen: r.pen }; },
};


/* Public pens and exclusive wild-animal claims. Owned herd records remain in
 * the owning character; only fresh claim receipts cross the shared authority. */
function anSharedWorldCanSimulate() {
  return typeof netWorldPartsCanSimulate !== 'function' || netWorldPartsCanSimulate();
}
function anSharedOwnAnimal(e) {
  return typeof netEntityOwnPet === 'function' ? netEntityOwnPet(e)
    : !!e?.tame && e.tame.owner === 'player' && !e.netEntityOwner;
}
function anSharedAccount() {
  return typeof NETWS !== 'undefined' && NETWS.acct?.id || 'player';
}
function anSharedPenMine(pen) {
  return !pen.sharedOwner || pen.sharedOwner === 'player' || pen.sharedOwner === anSharedAccount();
}
function anSharedGate(pen, seconds) {
  if (anSharedWorldCanSimulate()) pen.gateWant = GAME.t + seconds;
}
function anPenFill(pen, kind, id, amount) {
  const n = Math.max(0, Math.min(kind === 'water' ? 4 : id === 'feed' ? 3 : 5, Math.floor(amount)));
  if (!n || !['feed', 'water'].includes(kind) || kind === 'water' && id !== 'water'
    || kind === 'feed' && !['feed', 'grain', 'turnip', 'cabbage', 'apple'].includes(id)) return false;
  if (typeof netWorldPartsRequest === 'function' && netWorldPartsRequest('animal.pen.fill', { id: pen.id, kind, good: id, n }, [[id, n]])) return true;
  if (!goodsTake(id, n)) return false;
  if (kind === 'water') { pen.water = Math.min(30, pen.water + n * 3); goodsAdd('waterskin_empty', n, true); }
  else pen.feed = Math.min(30, pen.feed + n * (id === 'feed' ? 8 : 2.5));
  saveSoon(); return true;
}
function anPenMuck(pen) {
  if (typeof netWorldPartsRequest === 'function' && netWorldPartsRequest('animal.pen.muck', { id: pen.id })) return true;
  const n = Math.floor(pen.manure);
  if (n < 1 || !goodsAdd('manure', n)) return false;
  pen.manure -= n; saveSoon(); return true;
}
function anSharedProductionRestore(rec, op, args) {
  if (op === 'animal.lay') rec.prod.egg = Math.max(1, rec.prod.egg);
  else if (op === 'animal.moult') rec.moult = Math.max(240, rec.moult || 0);
  else rec.preg = { left: 1, sire: args.sire };
}
function anSharedProduction(e, op, args = {}) {
  if (typeof netWorldPartsActive !== 'function' || !netWorldPartsActive()
    || typeof NETPARTS !== 'undefined' && NETPARTS.replay || !anSharedOwnAnimal(e)) return false;
  const rec = e.tame, key = op.slice(7);
  rec.publicCycles ||= {}; rec.publicPending ||= {};
  if (rec.publicPending[key] || !e.netEntityId
    || typeof netWorldPartsConnected === 'function' && !netWorldPartsConnected()
    || typeof NETPARTS !== 'undefined' && !NETPARTS.ready) {
    anSharedProductionRestore(rec, op, args); return true;
  }
  const cycle = (rec.publicCycles[key] || 0) + 1;
  // Set the serial before the reservation asks for its private checkpoint.
  // That checkpoint contains the reset egg/pregnancy timer and this command.
  rec.publicCycles[key] = cycle; rec.publicPending[key] = cycle;
  const before = typeof NETPARTS !== 'undefined' ? NETPARTS.next : null;
  const deferred = netWorldPartsRequest(op, { id: e.netEntityId, aid: rec.aid, cycle, ...args }, [], true);
  const reserved = deferred && (before === null || NETPARTS.next > before);
  if (!reserved) {
    rec.publicCycles[key] = cycle - 1; delete rec.publicPending[key];
    anSharedProductionRestore(rec, op, args);
  }
  return true;
}
function anSharedProductionRecord(pending) {
  if (!pending?.args || !Number.isSafeInteger(pending.args.aid)) return null;
  return anMine().find(e => e.tame.aid === pending.args.aid)?.tame
    || ANIMALS.down.find(rec => rec.aid === pending.args.aid) || null;
}
function anSharedProductionDone(result, receipt, pending) {
  const rec = anSharedProductionRecord(pending);
  if (!rec) return;
  const key = pending.op.slice(7);
  if (rec.publicPending?.[key] === pending.args.cycle) delete rec.publicPending[key];
}
function anSharedProductionFailed(receipt, pending) {
  const rec = anSharedProductionRecord(pending);
  if (!rec) return;
  const key = pending.op.slice(7);
  if (rec.publicPending?.[key] !== pending.args.cycle) return;
  delete rec.publicPending[key];
  if (rec.publicCycles?.[key] === pending.args.cycle) rec.publicCycles[key]--;
  anSharedProductionRestore(rec, pending.op, pending.args);
}
function anSharedPenConsume(e, pen, mode) {
  if (typeof netWorldPartsActive !== 'function' || !netWorldPartsActive() || anSharedWorldCanSimulate()) return false;
  if (e.netEntityId) netWorldPartsRequest('animal.consume', { id: e.netEntityId, pen: pen.id, mode });
  return true;
}
function anSharedOffer(args, context) {
  const e = typeof netEntityFind === 'function' && netEntityFind(args.id), k = anWildKind(e);
  if (!k || ANIMALS_SHARED.claims.has(args.id) || !AKIND[k].likes.includes(args.food) || !goodsHave(args.food)) return false;
  const key = context.ownerAccount + ':' + args.id;
  let trust = ANIMALS_SHARED.trust.get(key);
  if (!trust) {
    trust = { id: args.id, n: 0, need: AKIND[k].need + (k === 'horse' && e.tame?.tr.calm < 0.4 ? 1 : 0), last: -99 };
    ANIMALS_SHARED.trust.set(key, trust);
    if (ANIMALS_SHARED.trust.size > 256) ANIMALS_SHARED.trust.delete(ANIMALS_SHARED.trust.keys().next().value);
  }
  if (GAME.t - trust.last < 5 || !anPlayerCalm(GAME.player)) return false;
  if (!goodsTake(args.food, 1)) return false;
  trust.n++; trust.last = GAME.t;
  faceToward(e, GAME.player.x, GAME.player.z); setAct(e, 7, 3.2); e.ai.tameHold = GAME.t + 6;
  const result = { trust: { id: args.id, n: trust.n, need: trust.need } };
  if (trust.n >= trust.need) {
    const wild = e.tame;
    const sex = wild?.sex || (e.kind === 'stag' ? 'm' : e.kind === 'deer' ? 'f' : Math.random() < 0.5 ? 'm' : 'f');
    const rec = anRecord(k, { owner: 'player', sex, tr: wild ? anCleanTraits(wild.tr, k)
      : anWildTraits(k, Math.random, e.look?.colA ? { colA: e.look.colA, colB: e.look.colB || e.look.colA } : null),
      age: wild?.age, cmd: 'follow' });
    result.animal = anSaveRec(rec, e); result.source = args.id;
    ANIMALS_SHARED.claims.add(args.id);
    if (ANIMALS_SHARED.claims.size > 256) ANIMALS_SHARED.claims.delete(ANIMALS_SHARED.claims.values().next().value);
    if (e.camp != null && CAMPS[e.camp]) {
      CAMPS[e.camp].members.delete(e.id); CAMPS[e.camp].respawnAt.push(GAME.t + 90 + Math.random() * 60);
    }
    // Never add this animal to the authority player's private herd.
    ANIMALS.trust.delete(e.id); removeEnt(e);
    loreNote('pets');
  }
  return { ok: true, result };
}
function anSharedReceive(result, receipt) {
  if (!result || !GAME.player) return;
  if (result.trust) {
    const e = typeof netEntityFind === 'function' && netEntityFind(result.trust.id);
    if (e && anWildKind(e)) { const t = anTrust(e); t.n = result.trust.n; t.need = result.trust.need; t.last = GAME.t; }
  }
  if (result.consume) {
    const e = typeof netEntityFind === 'function' && netEntityFind(result.consume.id);
    if (e && anSharedOwnAnimal(e)) {
      const key = result.consume.mode === 'drink' ? 'thirst' : 'hunger';
      e.tame[key] = Math.min(1, e.tame[key] + clamp(result.consume.amount, 0, 1));
    }
  }
  const o = result.animal, claimKey = typeof result.claimId === 'string' ? result.claimId : receipt.id;
  if (ANIMALS_SHARED.received.has(claimKey)) return;
  if (!o || !AKIND[o.k] || anMine().some(e => e.tame.sharedClaim === claimKey)) return;
  const rec = anRecord(o.k, { owner: 'player', sex: o.s === 'm' ? 'm' : 'f', tr: anCleanTraits(o.tr, o.k),
    name: typeof o.n === 'string' ? o.n.slice(0, 16).replace(/[<>&"]/g, '') : undefined,
    age: Number.isFinite(o.age) ? o.age : AKIND[o.k].grow,
    gen: Number.isSafeInteger(o.g) ? clamp(o.g, 0, 999) : 0,
    ma: Array.isArray(o.ma) ? { aid: Math.max(0, Math.floor(+o.ma[0] || 0)), name: String(o.ma[1] || '').slice(0, 16).replace(/[<>&"]/g, '') } : null,
    pa: Array.isArray(o.pa) ? { aid: Math.max(0, Math.floor(+o.pa[0] || 0)), name: String(o.pa[1] || '').slice(0, 16).replace(/[<>&"]/g, '') } : null,
    pen: penById(o.p) ? o.p : null, cmd: o.c === 'pen' && penById(o.p) ? 'pen' : 'follow' });
  rec.sharedClaim = claimKey; ANIMALS_SHARED.received.add(claimKey);
  if (ANIMALS_SHARED.received.size > 256) ANIMALS_SHARED.received.delete(ANIMALS_SHARED.received.values().next().value);
  const P = GAME.player, x = Number.isFinite(o.x) ? o.x : P.x, z = Number.isFinite(o.z) ? o.z : P.z;
  anSpawn(rec, x, z); ANIMALS.tamedCount = (ANIMALS.tamedCount || 0) + 1;
  uiToast(rec.name + ' is yours.'); loreNote('pets'); saveSoon();
}
function anSharedSave() {
  const pens = ANIMALS.pens.slice(0, 96).map(p => {
    if (p.owner === 'player' && (!p.sharedOwner || p.sharedOwner === 'player')) p.sharedOwner = anSharedAccount();
    return { id: p.id, owner: p.owner, account: p.sharedOwner, realm: p.realm, x: p.x, z: p.z, yaw: p.yaw,
      hw: p.hw, hd: p.hd, feed: r3(p.feed), water: r3(p.water), manure: r3(p.manure), seed: p.seed, name: p.name,
      gate: Math.max(0, Math.min(3, p.gateWant - GAME.t)), open: r3(p.gateOpen) };
  });
  return { v: 1, next: ANIMALS.nextPen, pens,
    trust: [...ANIMALS_SHARED.trust].slice(-128).map(([key, t]) => [key, { id: t.id, n: t.n, need: t.need, wait: clamp(t.last + 5 - GAME.t, 0, 5) }]),
    claims: [...ANIMALS_SHARED.claims].slice(-128) };
}
function anSharedApply(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.pens)) return;
  ANIMALS_SHARED.ready = true;
  const keep = new Set();
  for (const row of data.pens.slice(0, 96)) {
    if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || row.id > 1e9
      || !['x', 'z', 'yaw', 'hw', 'hd', 'feed', 'water', 'manure'].every(k => Number.isFinite(row[k]))
      || Math.hypot(row.x, row.z) > HALF || !['player', 'town'].includes(row.owner)) continue;
    keep.add(row.id);
    let pen = penById(row.id);
    if (pen && (Math.hypot(pen.x - row.x, pen.z - row.z) > 0.1 || Math.abs(pen.yaw - row.yaw) > 0.01)) { penRemove(pen); pen = null; }
    if (!pen) pen = penMake({ ...row, sharedOwner: row.account, hw: clamp(row.hw, 3, 12), hd: clamp(row.hd, 3, 10) });
    pen.sharedOwner = typeof row.account === 'string' ? row.account.slice(0, 160) : null;
    pen.feed = clamp(row.feed, 0, 30); pen.water = clamp(row.water, 0, 30); pen.manure = clamp(row.manure, 0, 20);
    pen.gateWant = GAME.t + clamp(row.gate || 0, 0, 3); pen.gateOpen = clamp(row.open || 0, 0, 1);
    if (pen.gateColl) pen.gateColl.active = row.gate <= 0 && pen.gateOpen < 0.2;
  }
  for (const pen of [...ANIMALS.pens]) if (pen.owner === 'player' && !keep.has(pen.id)) penRemove(pen);
  ANIMALS.nextPen = Math.max(ANIMALS.nextPen, ...data.pens.map(p => Number.isSafeInteger(p.id) ? p.id + 1 : 1));
  ANIMALS_SHARED.claims = new Set((Array.isArray(data.claims) ? data.claims : []).filter(id => typeof id === 'string').slice(-128));
  ANIMALS_SHARED.trust.clear();
  for (const pair of (Array.isArray(data.trust) ? data.trust : []).slice(-128)) if (Array.isArray(pair) && typeof pair[0] === 'string' && pair[1] && typeof pair[1].id === 'string') {
    const t = pair[1]; ANIMALS_SHARED.trust.set(pair[0], { id: t.id, n: clamp(+t.n || 0, 0, 10), need: clamp(+t.need || 1, 1, 10), last: GAME.t - 5 + clamp(+t.wait || 0, 0, 5) });
  }
}
queueMicrotask(() => {
  if (typeof netWorldPartsRegister !== 'function') return;
  netWorldPartsRegister('animals', { save: anSharedSave, apply: anSharedApply });
  netWorldPartsRegisterResult('animal.offer', anSharedReceive);
  netWorldPartsRegisterResult('animal.consume', anSharedReceive);
  for (const op of ['animal.lay', 'animal.clutch', 'animal.moult']) {
    netWorldPartsRegisterResult(op, anSharedProductionDone);
    netWorldPartsRegisterFailure(op, anSharedProductionFailed);
  }
  const animalPoint = a => { const e = netEntityFind(a.id); return e ? { x: e.x, z: e.z } : null; };
  const penPoint = a => { const p = penById(a.id); return p ? { x: p.x, z: p.z } : null; };
  netWorldPartsRegisterCommand('animal.offer', { point: animalPoint, range: 6, run: anSharedOffer });
  netWorldPartsRegisterCommand('animal.pen.create', { point: a => a, range: 14, run: (a, context) => {
    if (!a || !['x', 'z', 'yaw'].every(k => Number.isFinite(a[k])) || a.hw !== 6 || a.hd !== 4.5) return false;
    const pen = anMarkConfirm(a, context.ownerAccount); return pen ? { ok: true, result: { penId: pen.id } } : false;
  } });
  netWorldPartsRegisterCommand('animal.pen.fill', { point: penPoint, range: 18,
    run: a => { const p = penById(a.id); return !!p && anPenFill(p, a.kind, a.good, a.n); } });
  netWorldPartsRegisterCommand('animal.pen.muck', { point: penPoint, range: 18,
    run: a => { const p = penById(a.id); return !!p && anPenMuck(p); } });
  netWorldPartsRegisterCommand('animal.consume', { point: animalPoint, range: 8000, run: (a, context) => {
    const e = netEntityFind(a.id), pen = penById(a.pen);
    if (!e?.alive || e.netEntityOwner !== context.from || !e.tame || !pen || e.tame.pen !== pen.id || e.tame.cmd !== 'pen'
      || !['feed', 'drink'].includes(a.mode)) return false;
    const point = a.mode === 'drink' ? pen.trough : pen.rack;
    if (Math.hypot(e.x - point.x, e.z - point.z) > 3) return false;
    const key = context.from + ':' + a.id + ':' + a.mode, last = ANIMALS_SHARED.consumed.get(key) ?? -99;
    if (GAME.t - last < 4) return false;
    const field = a.mode === 'drink' ? 'water' : 'feed', n = Math.min(pen[field], 0.4);
    if (!(n > 0)) return false;
    ANIMALS_SHARED.consumed.set(key, GAME.t);
    if (ANIMALS_SHARED.consumed.size > 256) ANIMALS_SHARED.consumed.delete(ANIMALS_SHARED.consumed.keys().next().value);
    pen[field] -= n * (a.mode === 'drink' ? 0.25 : 0.5);
    return { ok: true, result: { consume: { id: a.id, mode: a.mode, amount: n * 2.2 } } };
  } });
});
