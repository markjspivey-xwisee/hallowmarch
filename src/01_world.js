/* ================================================================== */
/* world: layout, terrain, masks, navigation, colliders                */
/* ================================================================== */
const WSIZE = 1024, HALF = 512, HN = 513, HS = 2;
const WATER_Y = -3.2;
const R_RING = 250;

const REALMS = [
  { id: 0, key: 'logres', name: 'Logres', bearing: 150 * DEG, color: '#c9483b', light: '#f2c46b', dark: '#4c1915',
    hallow: 'the Grail', hallowName: 'The Grail', townName: 'Brackenford', homeName: 'The Weald of Logres',
    keepNames: ['Dragonmere', 'Kestrel Hold'], templeName: 'Chapel of the Grail', style: 'stone' },
  { id: 1, key: 'eriu', name: 'Ériu', bearing: 270 * DEG, color: '#2f9a6a', light: '#c3e8a8', dark: '#0f3424',
    hallow: 'Lia Fáil', hallowName: 'Lia Fáil', townName: 'Glenrua', homeName: 'The Green Glens of Ériu',
    keepNames: ['Ráth Fiacla', 'Ráth Brannagh'], templeName: 'Circle of the Stone', style: 'round' },
  { id: 2, key: 'thule', name: 'Thule', bearing: 30 * DEG, color: '#4d7fcb', light: '#d3e2f6', dark: '#14263f',
    hallow: 'Draupnir', hallowName: 'Draupnir', townName: 'Skarvik', homeName: 'The Rimewood of Thule',
    keepNames: ['Ulfsborg', 'Hrafnsgarth'], templeName: 'Hall of the Ring', style: 'timber' },
];
for (const R of REALMS) {
  R.dx = Math.sin(R.bearing); R.dz = -Math.cos(R.bearing);
  R.px = Math.cos(R.bearing); R.pz = Math.sin(R.bearing);
  R.yaw = Math.atan2(-R.dx, -R.dz); // structures face the centre of the frontier
  R.rgb = hex3(R.color);
}
const DIVIDERS = [90 * DEG, 210 * DEG, 330 * DEG];
function rp(R, along, lat) { return { x: R.dx * along + R.px * lat, z: R.dz * along + R.pz * lat }; }
const bearingOf = (x, z) => Math.atan2(x, -z);

/* Raw terrain before lakes, sites and roads */
function rawHeight(x, z) {
  const r = Math.hypot(x, z);
  const b = Math.atan2(x, -z);
  let h = (fbm(x * 0.0072 + 11.3, z * 0.0072 - 4.1, 4) - 0.5) * 13 + (fbm(x * 0.023 - 3.7, z * 0.023 + 8.2, 3) - 0.5) * 3.5;
  h *= lerp(0.55, 1, sstep(60, 200, r));
  const ring = sstep(32, 3, Math.abs(r - R_RING));
  let pass = 0;
  for (const R of REALMS) { const ad = Math.abs(angDiff(b, R.bearing)) * r; pass = Math.max(pass, sstep(34, 13, ad)); }
  let mount = ring * (1 - pass);
  if (r > R_RING - 40) {
    for (const db of DIVIDERS) {
      const ad = angDiff(b, db);
      if (Math.abs(ad) < 1.2) {
        const lat = Math.abs(Math.sin(ad)) * r;
        mount = Math.max(mount, sstep(40, 6, lat) * sstep(R_RING - 34, R_RING + 6, r));
      }
    }
  }
  const outer = Math.max(sstep(452, 506, r), sstep(470, 511, Math.max(Math.abs(x), Math.abs(z))));
  mount = Math.max(mount, outer);
  if (mount > 0.001) {
    const jag = 0.55 + 0.75 * ridged(x * 0.018 + 3.3, z * 0.018 - 7.7);
    h += mount * 44 * jag;
  }
  h += ring * pass * 2.0;
  h += 8.5 * Math.exp(-Math.pow(r / 33, 2.2));
  return h;
}

/* ------------------------------------------------------------------ */
/* Layout: sites, lakes, navigation graph                              */
/* ------------------------------------------------------------------ */
const SITES = [];
const LAKES = [];
const NAV = { nodes: [] };
function navNode(tag, p, realm = -1, extra = {}) {
  const n = { id: NAV.nodes.length, tag, x: p.x, z: p.z, realm, adj: [], ...extra };
  NAV.nodes.push(n);
  return n;
}
function navLink(a, b, kind = 'road') { a.adj.push({ to: b.id, kind }); b.adj.push({ to: a.id, kind }); }

for (const R of REALMS) {
  const site = (kind, along, lat, extra) => {
    const p = rp(R, along, lat);
    const o = { kind, realm: R.id, along, lat, x: p.x, z: p.z, yaw: R.yaw, ...extra };
    SITES.push(o);
    return o;
  };
  R.town = site('town', 378, 0, { r: 40, f: 22, name: R.townName });
  R.musterSite = site('muster', 214, 0, { r: 22, f: 14, name: R.name + ' Muster' });
  R.templeSite = site('temple', 170, 0, { r: 20, f: 14, name: R.templeName });
  R.keepSites = [
    site('keep', 118, 64, { r: 25, f: 16, name: R.keepNames[0], idx: 0 }),
    site('keep', 118, -64, { r: 25, f: 16, name: R.keepNames[1], idx: 1 }),
  ];
  const lp = rp(R, 318, R.id === 1 ? -96 : 96);
  LAKES.push({ x: lp.x, z: lp.z, r: 27, realm: R.id });

  const N = R.nav = {};
  N.town = navNode('town', rp(R, 378, 0), R.id);
  N.h1 = navNode('road', rp(R, 336, 12), R.id);
  N.p1 = navNode('road', rp(R, 292, -4), R.id);
  N.pass = navNode('pass', rp(R, 250, 0), R.id);
  N.muster = navNode('muster', rp(R, 214, 0), R.id);
  N.mf = navNode('road', rp(R, 194, 0), R.id);
  N.ja = navNode('road', rp(R, 190, 33), R.id);
  N.jb = navNode('road', rp(R, 190, -33), R.id);
  N.ta = navNode('road', rp(R, 146, 26), R.id);
  N.tb = navNode('road', rp(R, 146, -26), R.id);
  N.tg = navNode('templeGate', rp(R, 146, 0), R.id);
  N.tc = navNode('templeIn', rp(R, 168, 0), R.id);
  navLink(N.town, N.h1); navLink(N.h1, N.p1); navLink(N.p1, N.pass); navLink(N.pass, N.muster);
  navLink(N.muster, N.mf); navLink(N.mf, N.ja); navLink(N.mf, N.jb);
  navLink(N.ja, N.ta); navLink(N.jb, N.tb); navLink(N.ta, N.tg); navLink(N.tb, N.tg);
  navLink(N.tg, N.tc, 'door');
  N.k = [];
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1;
    const K = {
      side: navNode('road', rp(R, 118, 40 * s), R.id),
      front: navNode('road', rp(R, 90, 40 * s), R.id),
      gate: navNode('keepGate', rp(R, 90, 64 * s), R.id),
      court: navNode('keepIn', rp(R, 112, 64 * s), R.id),
    };
    N.k.push(K);
    navLink(k ? N.jb : N.ja, K.side);
    navLink(k ? N.tb : N.ta, K.side);
    navLink(K.side, K.front);
    navLink(K.front, K.gate);
    navLink(K.gate, K.court, 'door');
  }
  navLink(N.k[0].front, N.k[1].front);
}
// ring road around the lone-tree hill
const RING_NODES = [];
for (let k = 0; k < 12; k++) {
  const b = k * 30 * DEG + 15 * DEG;
  RING_NODES.push(navNode('ring', { x: Math.sin(b) * 72, z: -Math.cos(b) * 72 }));
}
for (let k = 0; k < 12; k++) navLink(RING_NODES[k], RING_NODES[(k + 1) % 12]);
function nearestRing(x, z, n = 1, exclude = -1) {
  return RING_NODES.filter((r) => r.id !== exclude).sort((a, b) => dist2(a.x, a.z, x, z) - dist2(b.x, b.z, x, z)).slice(0, n);
}
for (const R of REALMS) {
  for (const K of R.nav.k) {
    for (const rn of nearestRing(K.gate.x, K.gate.z, 2)) navLink(K.gate, rn);
    navLink(K.front, nearestRing(K.front.x, K.front.z, 1)[0]);
  }
}

/* ------------------------------------------------------------------ */
/* Structures: colliders                                               */
/* ------------------------------------------------------------------ */
const COLL = { boxes: [], circles: [], cell: 16, grid: new Map() };
function collKey(cx, cz) { return cx * 4096 + cz; }
function collRegister(c, minx, minz, maxx, maxz) {
  const s = COLL.cell;
  for (let cx = Math.floor(minx / s); cx <= Math.floor(maxx / s); cx++) {
    for (let cz = Math.floor(minz / s); cz <= Math.floor(maxz / s); cz++) {
      const k = collKey(cx, cz);
      let list = COLL.grid.get(k);
      if (!list) COLL.grid.set(k, list = []);
      list.push(c);
    }
  }
}
// Oriented box: centre, half extents in the local frame, yaw with three.js convention (local +Z -> (sin, cos))
function addBox(x, z, hx, hz, yaw, tag = 'wall', h = 8) {
  const c = { type: 'box', x, z, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), yaw, tag, active: true, h, baseY: W.H ? heightAt(x, z) : 0 };
  COLL.boxes.push(c);
  const rr = Math.hypot(hx, hz);
  collRegister(c, x - rr, z - rr, x + rr, z + rr);
  return c;
}
function addCircle(x, z, r, tag = 'post', h = 8) {
  const c = { type: 'circle', x, z, r, tag, active: true, h, baseY: W.H ? heightAt(x, z) : 0 };
  COLL.circles.push(c);
  collRegister(c, x - r, z - r, x + r, z + r);
  return c;
}
// local (lx, lz) relative to a site frame -> world
function siteToWorld(S, lx, lz) {
  const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  return { x: S.x + lx * c + lz * s, z: S.z - lx * s + lz * c };
}
function boxAt(S, lx, lz, hx, hz, tag, h, yawOff = 0) {
  const p = siteToWorld(S, lx, lz);
  return addBox(p.x, p.z, hx, hz, S.yaw + yawOff, tag, h);
}
function circleAt(S, lx, lz, r, tag, h) { const p = siteToWorld(S, lx, lz); return addCircle(p.x, p.z, r, tag, h); }

const KEEP_HS = 16, KEEP_T = 2.2, GATE_HW = 2.7, WALL_H = 7;
function buildKeepColliders(S, style) {
  const hs = KEEP_HS, t = KEEP_T;
  S.colliders = [];
  if (style === 'round') {
    const R0 = 16.5, segs = 20;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
      const mx = Math.sin(am), mz = Math.cos(am);
      if (Math.abs(angDiff(am, 0)) < 0.2) continue; // gate gap at local +Z
      const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.4;
      S.colliders.push(boxAt(S, mx * R0, mz * R0, len / 2, t / 2, 'wall', WALL_H, am));
    }
    for (const [lx, lz] of [[-3.9, R0 - 0.6], [3.9, R0 - 0.6]]) S.colliders.push(circleAt(S, lx, lz, 2.6, 'tower', 11));
    S.colliders.push(circleAt(S, 0, -6.5, 6.2, 'hall', 9));
  } else {
    S.colliders.push(boxAt(S, 0, -hs + t / 2, hs, t / 2, 'wall', WALL_H));
    S.colliders.push(boxAt(S, -hs + t / 2, 0, t / 2, hs, 'wall', WALL_H));
    S.colliders.push(boxAt(S, hs - t / 2, 0, t / 2, hs, 'wall', WALL_H));
    const seg = (hs - GATE_HW) / 2;
    S.colliders.push(boxAt(S, -(GATE_HW + seg), hs - t / 2, seg, t / 2, 'wall', WALL_H));
    S.colliders.push(boxAt(S, GATE_HW + seg, hs - t / 2, seg, t / 2, 'wall', WALL_H));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.colliders.push(circleAt(S, sx * (hs - 1.2), sz * (hs - 1.2), 3.4, 'tower', 12));
    for (const sx of [-1, 1]) S.colliders.push(circleAt(S, sx * (GATE_HW + 1.9), hs - 0.8, 2.3, 'tower', 10));
    S.colliders.push(boxAt(S, 0, -hs + t + 5.2, 6.2, 5.2, 'hall', 13));
  }
  // the door spans the gate gap
  const dz = style === 'round' ? 16.5 : hs - t / 2;
  S.door = boxAt(S, 0, dz, GATE_HW + 0.2, 0.6, 'door', 6);
  S.gateLocal = { x: 0, z: dz };
}
function buildTempleColliders(S) {
  S.colliders = [];
  const R0 = 16, segs = 18;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.2) continue;
    const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.3;
    S.colliders.push(boxAt(S, Math.sin(am) * R0, Math.cos(am) * R0, len / 2, 0.7, 'wall', 3.2, am));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    S.colliders.push(circleAt(S, Math.sin(a) * 10.5, Math.cos(a) * 10.5, 0.75, 'pillar', 7));
  }
  S.colliders.push(circleAt(S, 0, -1, 1.3, 'altar', 1.2));
  for (const sx of [-1, 1]) S.colliders.push(circleAt(S, sx * 4.25, R0, 1.45, 'pillar', 5));
  S.door = boxAt(S, 0, R0, 2.9, 0.6, 'door', 4);
  S.gateLocal = { x: 0, z: R0 };
}
function buildMusterColliders(S) {
  S.colliders = [];
  const R0 = 18, segs = 22;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.42 || Math.abs(angDiff(am, Math.PI)) < 0.42) continue;
    const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.3;
    S.colliders.push(boxAt(S, Math.sin(am) * R0, Math.cos(am) * R0, len / 2, 0.5, 'palisade', 5, am));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + TAU / 12; // stones sit either side of the road axis
    S.colliders.push(circleAt(S, Math.sin(a) * 5.4, Math.cos(a) * 5.4, 0.7, 'stone', 3));
  }
  for (const [lx, lz] of [[-11, -4], [11, -4], [-10, 8], [10, 8]]) S.colliders.push(circleAt(S, lx, lz, 2.4, 'tent', 3));
}
// Towns: houses around a plaza with a portal circle; layout stored for rendering too
function buildTown(S, R, rnd) {
  S.houses = [];
  S.colliders = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.35 + (rnd() - 0.5) * 0.25;
    if (Math.abs(angDiff(a, 0)) < 0.45 || Math.abs(angDiff(a, Math.PI)) < 0.45) continue; // keep the road through town clear
    const rr = 24 + rnd() * 6;
    const lx = Math.sin(a) * rr, lz = Math.cos(a) * rr;
    const w = 4.6 + rnd() * 1.6, d = 6 + rnd() * 2.4;
    const yawLocal = a + Math.PI; // door faces the plaza
    const p = siteToWorld(S, lx, lz);
    const house = { x: p.x, z: p.z, w, d, yaw: S.yaw + yawLocal, h: 3.2 + rnd() * 0.8, kind: i === 4 ? 'hall' : 'house', seed: rnd() };
    if (house.kind === 'hall') { house.w = 8.5; house.d = 13; house.h = 4.6; }
    S.houses.push(house);
    S.colliders.push(...planHouse(S, R, house, S.houses.length - 1)); // walls with a doorway, the door, the furniture
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + TAU / 12;
    S.colliders.push(circleAt(S, Math.sin(a) * 5.6, Math.cos(a) * 5.6, 0.7, 'stone', 3));
  }
  buildTownProps(S, R);
}
const roundHouseR = (h) => (h.kind === 'hall' ? 6.2 : Math.min(h.w, h.d) * 0.62);
// yards and street furniture, from their own seeded stream so the rest of the world keeps its layout
function buildTownProps(S, R) {
  const pr = mulberry(4100 + R.id * 131);
  S.props = [];
  const put = (type, x, z, yaw, o = {}) => { const q = { type, x, z, yaw, seed: pr(), ...o }; S.props.push(q); return q; };
  const ring = (x, z, r, h = 2) => S.colliders.push(addCircle(x, z, r, 'prop', h));
  const atSite = (type, lx, lz, lyaw, o, r, h) => { const p = siteToWorld(S, lx, lz); put(type, p.x, p.z, S.yaw + lyaw, o); if (r) ring(p.x, p.z, r, h); };
  // the plaza: a well, two market stalls facing the portal stones, lanterns along the road
  atSite('well', -10.5, -6.5, 0.4, {}, 1.25, 2.5);
  for (const [lx, lz] of [[11.5, -7.5], [-11, 8.5]]) atSite('stall', lx, lz, Math.atan2(-lx, -lz), {}, 1.35, 2.5);
  for (const [lx, lz] of [[4.3, 12], [-4.3, -12], [4.3, -27], [-4.3, 27], [4.3, 38], [-4.3, -38]]) atSite('lantern', lx, lz, lx > 0 ? -Math.PI / 2 : Math.PI / 2, {}, 0.18, 3);
  if (R.style !== 'timber') atSite('trough', 9.5, 9.5, -0.6, {}, 0.8, 1);
  // each house: barrels by the door, a woodpile along a wall, a bench, a fenced garden behind some
  S.houses.forEach((h, i) => {
    const c = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    const hp = (lx, lz) => ({ x: h.x + lx * c + lz * sn, z: h.z - lx * sn + lz * c });
    const round = R.style === 'round';
    const W2 = round ? roundHouseR(h) : h.w / 2, D2 = round ? roundHouseR(h) : h.d / 2;
    const side = pr() < 0.5 ? 1 : -1;
    { const p = hp(side * (W2 + 0.8), round ? D2 * 0.45 : D2 - 0.7); put('barrels', p.x, p.z, h.yaw + pr() * TAU, { n: 2 + Math.floor(pr() * 2.99) }); ring(p.x, p.z, 0.85, 1.2); }
    {
      const len = round ? 2.2 : Math.min(2.8, h.d * 0.45);
      const p = hp(-side * (W2 + 0.55), round ? -0.4 : -D2 * 0.25);
      put('woodpile', p.x, p.z, h.yaw, { len });
      S.colliders.push(addBox(p.x, p.z, 0.5, len / 2 + 0.1, h.yaw, 'prop', 1.2));
    }
    if (h.kind === 'hall') {
      const p = hp(-side * (W2 + 2.2), D2 + 1.6); put('cart', p.x, p.z, h.yaw + side * 0.5); ring(p.x, p.z, 1.4, 1.6);
    } else if (pr() < 0.6 && !round) {
      const p = hp(-side * h.w * 0.3, D2 + 0.42); put('bench', p.x, p.z, h.yaw); ring(p.x, p.z, 0.45, 0.6);
    }
    if (h.kind !== 'hall' && i % 2 === 0) {
      // a garden behind the house, fenced on three sides
      const x0 = -(W2 + 0.4), x1 = W2 + 0.4, z0 = -D2 - 0.7, z1 = -D2 - 4.6;
      const corners = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]].map(([a, b]) => hp(a, b));
      for (let k = 0; k < 3; k++) {
        const A = corners[k], B = corners[k + 1];
        put('fence', (A.x + B.x) / 2, (A.z + B.z) / 2, Math.atan2(B.x - A.x, B.z - A.z), { len: Math.hypot(B.x - A.x, B.z - A.z) });
        S.colliders.push(addBox((A.x + B.x) / 2, (A.z + B.z) / 2, 0.08, Math.hypot(B.x - A.x, B.z - A.z) / 2, Math.atan2(B.x - A.x, B.z - A.z), 'fence', 1.1));
      }
      const g = hp(0, (z0 + z1) / 2);
      put('garden', g.x, g.z, h.yaw, { w: x1 - x0 - 0.8, d: Math.abs(z1 - z0) - 0.8 });
    } else if (R.style !== 'timber' && h.kind !== 'hall' && pr() < 0.8) {
      const p = hp(side * (W2 * 0.3), -D2 - 3.2); put('hay', p.x, p.z, pr() * TAU); ring(p.x, p.z, 1.2, 2.2);
    }
  });
}

/* ------------------------------------------------------------------ */
/* World build: heights, masks, scatter, camps                         */
/* ------------------------------------------------------------------ */
const W = {
  H: null, road: null, grass: null, flower: null, rock: null, realmW: null, field: null, walk: null,
  trees: [], rocks: [], stones: [], camps: [], ready: false,
};
function hIndex(i, j) { return j * HN + i; }
function heightAt(x, z) {
  if (x > DUN_X0) return dunFloorAt(x, z);
  const gx = clamp((x + HALF) / HS, 0, HN - 1.0001), gz = clamp((z + HALF) / HS, 0, HN - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const H = W.H, k = j * HN + i;
  const a = H[k], b = H[k + 1], c = H[k + HN], d = H[k + HN + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function sampleGrid(arr, x, z) {
  const gx = clamp((x + HALF) / HS, 0, HN - 1.0001), gz = clamp((z + HALF) / HS, 0, HN - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const k = j * HN + i;
  const a = arr[k], b = arr[k + 1], c = arr[k + HN], d = arr[k + HN + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 1.0;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e);
  const l = Math.hypot(nx, 1, nz);
  out.x = nx / l; out.y = 1 / l; out.z = nz / l;
  return out;
}
function isWalkable(x, z) {
  if (x > DUN_X0) return dunWalkable(x, z);
  if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) return false;
  const i = Math.round((x + HALF) / HS), j = Math.round((z + HALF) / HS);
  return W.walk[j * HN + i] === 0;
}
function realmWeightsAt(x, z) {
  const b = bearingOf(x, z), r = Math.hypot(x, z);
  const w = REALMS.map((R) => Math.pow(Math.max(0, Math.cos(angDiff(b, R.bearing) * 0.75)), 6));
  const blend = sstep(10, 60, r);
  let s = 0;
  for (let k = 0; k < 3; k++) { w[k] = lerp(1 / 3, w[k], blend); s += w[k]; }
  for (let k = 0; k < 3; k++) w[k] /= s || 1;
  return w;
}
function realmAt(x, z) {
  const w = realmWeightsAt(x, z);
  return w[0] > w[1] ? (w[0] > w[2] ? 0 : 2) : (w[1] > w[2] ? 1 : 2);
}

function buildWorld(seed = 7) {
  const rnd = mulberry(seed);
  const N2 = HN * HN;
  const H = new Float32Array(N2);
  for (let j = 0; j < HN; j++) {
    const z = -HALF + j * HS;
    for (let i = 0; i < HN; i++) H[j * HN + i] = rawHeight(-HALF + i * HS, z);
  }
  W.H = H;
  const forTexels = (cx, cz, rad, fn) => {
    const i0 = Math.max(0, Math.floor((cx - rad + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((cx + rad + HALF) / HS));
    const j0 = Math.max(0, Math.floor((cz - rad + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((cz + rad + HALF) / HS));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * HN + i, -HALF + i * HS, -HALF + j * HS);
  };
  // lakes
  for (const L of LAKES) {
    forTexels(L.x, L.z, L.r * 1.35, (k, x, z) => {
      const d = dist(x, z, L.x, L.z);
      const w = sstep(L.r * 1.3, L.r * 0.4, d);
      H[k] = lerp(H[k], Math.min(H[k], WATER_Y - 3.2), w);
    });
  }
  // flatten sites
  for (const S of SITES) {
    let t = 0;
    for (const [ox, oz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) t += heightAt(S.x + ox, S.z + oz);
    t = Math.max(t / 5, WATER_Y + 1.5);
    S.y = t;
    forTexels(S.x, S.z, S.r + S.f, (k, x, z) => {
      const d = dist(x, z, S.x, S.z);
      H[k] = lerp(H[k], t, sstep(S.r + S.f, S.r, d));
    });
  }
  // roads follow the navigation edges
  const ROADS = [];
  const seen = new Set();
  for (const n of NAV.nodes) {
    for (const e of n.adj) {
      const key = Math.min(n.id, e.to) + ':' + Math.max(n.id, e.to);
      if (seen.has(key) || e.kind === 'door') continue;
      seen.add(key);
      const m = NAV.nodes[e.to];
      const main = (n.tag === 'town' || m.tag === 'town' || n.tag === 'pass' || m.tag === 'pass' || n.tag === 'muster' || m.tag === 'muster');
      ROADS.push({ ax: n.x, az: n.z, bx: m.x, bz: m.z, w: main ? 2.7 : 2.1, ring: n.tag === 'ring' && m.tag === 'ring' });
    }
  }
  W.roads = ROADS;
  const road = new Float32Array(N2);
  for (const S of ROADS) {
    const minx = Math.min(S.ax, S.bx) - S.w - 4, maxx = Math.max(S.ax, S.bx) + S.w + 4;
    const minz = Math.min(S.az, S.bz) - S.w - 4, maxz = Math.max(S.az, S.bz) + S.w + 4;
    forTexels((minx + maxx) / 2, (minz + maxz) / 2, Math.max(maxx - minx, maxz - minz) / 2 + 2, (k, x, z) => {
      // wobble the road edge a little so it does not look ruled
      const wob = (vnoise(x * 0.11, z * 0.11) - 0.5) * 1.6;
      const d = Math.sqrt(segDist2(x, z, S.ax, S.az, S.bx, S.bz)) + wob;
      const v = sstep(S.w + 1.6, S.w - 0.6, d);
      if (v > road[k]) road[k] = v;
    });
  }
  // plazas and courtyards read as packed earth
  for (const S of SITES) {
    const inner = S.kind === 'town' ? 15 : S.kind === 'keep' ? 13 : S.kind === 'muster' ? 15 : S.kind === 'temple' ? 0 : 0;
    if (!inner) continue;
    forTexels(S.x, S.z, inner + 4, (k, x, z) => {
      const d = dist(x, z, S.x, S.z) + (vnoise(x * 0.2, z * 0.2) - 0.5) * 3;
      road[k] = Math.max(road[k], sstep(inner + 2, inner - 2, d) * 0.92);
    });
  }
  W.road = road;
  // smooth terrain under roads
  {
    const B = new Float32Array(N2);
    const rad = 4;
    // separable box blur
    const tmp = new Float32Array(N2);
    for (let j = 0; j < HN; j++) {
      let acc = 0, cnt = 0;
      for (let i = -rad; i < HN + rad; i++) {
        const add = i + rad, rem = i - rad - 1;
        if (add >= 0 && add < HN) { acc += H[j * HN + add]; cnt++; }
        if (rem >= 0 && rem < HN) { acc -= H[j * HN + rem]; cnt--; }
        if (i >= 0 && i < HN) tmp[j * HN + i] = acc / cnt;
      }
    }
    for (let i = 0; i < HN; i++) {
      let acc = 0, cnt = 0;
      for (let j = -rad; j < HN + rad; j++) {
        const add = j + rad, rem = j - rad - 1;
        if (add >= 0 && add < HN) { acc += tmp[add * HN + i]; cnt++; }
        if (rem >= 0 && rem < HN) { acc -= tmp[rem * HN + i]; cnt--; }
        if (j >= 0 && j < HN) B[j * HN + i] = acc / cnt;
      }
    }
    for (let k = 0; k < N2; k++) if (road[k] > 0) H[k] = lerp(H[k], B[k], road[k] * 0.75);
  }
  // re-level sites after road smoothing so buildings sit flat
  for (const S of SITES) {
    forTexels(S.x, S.z, S.r + 4, (k, x, z) => {
      const d = dist(x, z, S.x, S.z);
      H[k] = lerp(H[k], S.y, sstep(S.r + 4, S.r - 2, d));
    });
  }
  // the long barrow by the Lone Tree rises from its levelled ground
  applyBarrowMound(H, forTexels);
  // slope, walkability, masks
  const walk = new Uint8Array(N2), grass = new Float32Array(N2), flower = new Float32Array(N2), rock = new Float32Array(N2);
  const realmW = new Float32Array(N2 * 3), field = new Float32Array(N2);
  for (let j = 0; j < HN; j++) {
    for (let i = 0; i < HN; i++) {
      const k = j * HN + i, x = -HALF + i * HS, z = -HALF + j * HS;
      const hx = H[j * HN + Math.min(HN - 1, i + 1)] - H[j * HN + Math.max(0, i - 1)];
      const hz = H[Math.min(HN - 1, j + 1) * HN + i] - H[Math.max(0, j - 1) * HN + i];
      const slope = Math.hypot(hx, hz) / (2 * HS);
      const h = H[k];
      const deep = h < WATER_Y - 1.0;
      walk[k] = (slope > 0.95 || deep || Math.abs(x) > HALF - 6 || Math.abs(z) > HALF - 6) ? 1 : 0;
      const rw = realmWeightsAt(x, z);
      realmW[k * 3] = rw[0]; realmW[k * 3 + 1] = rw[1]; realmW[k * 3 + 2] = rw[2];
      const rk = sstep(0.42, 0.85, slope) + sstep(18, 34, h) * 0.5 + (h > 12 ? 0.25 * vnoise(x * 0.1, z * 0.1) : 0);
      rock[k] = clamp(rk, 0, 1);
      const wet = h < WATER_Y + 0.35 ? 0 : 1;
      const clearing = 0.72 + 0.28 * sstep(0.3, 0.55, fbm(x * 0.03 + 50, z * 0.03 - 20, 3));
      grass[k] = clamp((1 - road[k]) * (1 - rock[k] * 0.95) * wet * clearing, 0, 1);
      const fl = sstep(0.52, 0.78, fbm(x * 0.045 - 31, z * 0.045 + 7, 3));
      const realmFl = rw[0] * 0.65 + rw[1] * 1.0 + rw[2] * 0.4;
      flower[k] = clamp(fl * realmFl * grass[k] * (Math.hypot(x, z) < R_RING ? 0.8 : 1), 0, 1);
    }
  }
  // Logres farmland: golden fields around the town
  {
    const R = REALMS[0];
    const fr = mulberry(77);
    for (let f = 0; f < 6; f++) {
      const a = (f / 6) * TAU + fr() * 0.4;
      if (Math.abs(angDiff(a, 0)) < 0.5 || Math.abs(angDiff(a, Math.PI)) < 0.5) continue;
      const cx = R.town.x + Math.sin(a + R.yaw) * 62, cz = R.town.z + Math.cos(a + R.yaw) * 62;
      const hw = 14 + fr() * 8, hd = 9 + fr() * 6, ang = fr() * Math.PI;
      const c = Math.cos(ang), s = Math.sin(ang);
      forTexels(cx, cz, Math.max(hw, hd) + 4, (k, x, z) => {
        const lx = (x - cx) * c - (z - cz) * s, lz = (x - cx) * s + (z - cz) * c;
        const v = sstep(2, -1, Math.max(Math.abs(lx) - hw, Math.abs(lz) - hd));
        field[k] = Math.max(field[k], v * (1 - road[k]));
      });
    }
  }
  Object.assign(W, { walk, grass, flower, rock, realmW, field });
  clearBarrowGround(W, forTexels);

  // structure colliders
  for (const R of REALMS) {
    for (const S of R.keepSites) buildKeepColliders(S, R.style);
    buildTempleColliders(R.templeSite);
    buildMusterColliders(R.musterSite);
    buildTown(R.town, R, rnd);
  }
  // the lone tree on the hill
  W.heroTree = { x: 0.6, z: -0.4, y: 0 };
  W.heroTree.y = heightAt(W.heroTree.x, W.heroTree.z);
  addCircle(W.heroTree.x, W.heroTree.z, 0.9, 'tree', 6);

  // clear zones: sites and the navigation corridors
  const blocked = (x, z, pad) => {
    for (const S of SITES) if (dist2(x, z, S.x, S.z) < (S.r + pad) * (S.r + pad)) return true;
    for (const L of LAKES) if (dist2(x, z, L.x, L.z) < (L.r * 1.1 + pad) ** 2) return true;
    if (dist2(x, z, 0, 0) < (24 + pad) * (24 + pad)) return true;
    return false;
  };
  const nearRoad = (x, z, pad) => sampleGrid(road, x, z) > 0.02 || ROADS.some((S) => segDist2(x, z, S.ax, S.az, S.bx, S.bz) < pad * pad);

  // trees
  const trees = [];
  for (let gz = -HALF + 4; gz < HALF - 4; gz += 5.5) {
    for (let gx = -HALF + 4; gx < HALF - 4; gx += 5.5) {
      const x = gx + (hash2(gx * 7 | 0, gz * 3 | 0) - 0.5) * 5, z = gz + (hash2(gx * 5 | 0, gz * 11 | 0) - 0.5) * 5;
      const r = Math.hypot(x, z);
      if (r > 468) continue;
      const f = fbm(x * 0.011 + 3.1, z * 0.011 - 8.4, 4);
      const rw = realmWeightsAt(x, z);
      const frontier = r < R_RING - 20;
      const th = frontier ? 0.62 : (rw[2] > 0.5 ? 0.47 : rw[1] > 0.5 ? 0.555 : 0.57);
      let p = sstep(th, th + 0.08, f) * 0.8 + 0.006;
      if (frontier) p *= 0.7;
      const hh = hash2(gx * 13 | 0, gz * 17 | 0);
      if (hh > p) continue;
      const h = heightAt(x, z);
      if (h < WATER_Y + 0.6) continue;
      const k = hIndex(Math.round((x + HALF) / HS), Math.round((z + HALF) / HS));
      if (W.rock[k] > 0.55 || W.walk[k]) continue;
      if (blocked(x, z, 10) || nearRoad(x, z, 6)) continue;
      // tree kind by realm
      const u = hash2(gx * 29 | 0, gz * 31 | 0);
      let kind;
      const realm = rw[0] > rw[1] ? (rw[0] > rw[2] ? 0 : 2) : (rw[1] > rw[2] ? 1 : 2);
      if (realm === 2) kind = u < 0.72 ? 'pine' : 'birch';
      else if (realm === 1) kind = u < 0.5 ? 'birch' : u < 0.9 ? 'oak' : 'pine';
      else kind = u < 0.7 ? 'oak' : u < 0.9 ? 'birch' : 'pine';
      if (h > 16) kind = 'pine';
      const s = 0.8 + 0.5 * hash2(gx * 41 | 0, gz * 43 | 0);
      trees.push({ kind, x, z, y: h, s, rot: hash2(gx * 3 | 0, gz * 61 | 0) * TAU, tint: hash2(gx * 71 | 0, gz * 73 | 0) });
      addCircle(x, z, 0.45 * s + 0.15, 'tree', 8);
    }
  }
  W.trees = trees;
  // rocks: on slopes and scattered in meadows
  const rocks = [];
  for (let n = 0; n < 9000 && rocks.length < 900; n++) {
    const x = (rnd() * 2 - 1) * 470, z = (rnd() * 2 - 1) * 470;
    const k = hIndex(Math.round((x + HALF) / HS), Math.round((z + HALF) / HS));
    const rk = W.rock[k];
    const want = rk > 0.25 ? 0.35 : 0.02;
    if (rnd() > want) continue;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.4) continue;
    if (blocked(x, z, 5) || nearRoad(x, z, 4)) continue;
    const s = rk > 0.25 ? 0.8 + rnd() * 2.2 : 0.35 + rnd() * 0.8;
    rocks.push({ x, z, y: h, s, rot: rnd() * TAU, tilt: rnd(), seed: rnd() });
    if (s > 0.7 && W.walk[k] === 0) addCircle(x, z, s * 0.75, 'rock', s * 1.2);
  }
  W.rocks = rocks;
  // standing stones: circles in the green glens and along the frontier
  const stones = [];
  const RE = REALMS[1];
  for (const [al, la] of [[300, 40], [420, -60], [350, -150], [138, 0]]) {
    const c = rp(RE, al, la);
    if (blocked(c.x, c.z, -10) && al !== 138) continue;
    const n = al === 138 ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = al === 138 ? 4 : 7;
      const x = c.x + Math.sin(a) * rr, z = c.z + Math.cos(a) * rr;
      if (al === 138) continue;
      stones.push({ x, z, y: heightAt(x, z), s: 0.9 + rnd() * 0.5, rot: a, tilt: (rnd() - 0.5) * 0.15 });
      addCircle(x, z, 0.6, 'stone', 3);
    }
  }
  W.stones = stones;

  // PvE camps in each home realm
  const MOBS_BY_REALM = [
    [['boar', 1, 3], ['wolf', 2, 4], ['boar', 4, 6], ['bandit', 5, 8], ['wolf', 7, 9], ['bandit', 9, 12], ['skeleton', 11, 14], ['bear', 12, 15], ['skeleton', 14, 17], ['bandit', 16, 18], ['bear', 17, 19], ['skeleton', 19, 20]],
    [['wolf', 1, 3], ['boar', 2, 4], ['wisp', 4, 6], ['wolf', 5, 8], ['bandit', 7, 9], ['wisp', 9, 12], ['boar', 11, 13], ['bear', 12, 15], ['wisp', 14, 17], ['bandit', 16, 18], ['bear', 17, 19], ['wisp', 19, 20]],
    [['wolf', 1, 3], ['boar', 2, 4], ['wolf', 4, 6], ['draugr', 5, 8], ['bear', 7, 9], ['troll', 9, 12], ['draugr', 11, 13], ['wolf', 12, 15], ['troll', 14, 17], ['draugr', 16, 18], ['bear', 17, 19], ['troll', 19, 20]],
  ];
  const camps = [];
  for (const R of REALMS) {
    const list = MOBS_BY_REALM[R.id];
    for (let ci = 0; ci < list.length; ci++) {
      const [type, lmin, lmax] = list[ci];
      const want = 46 + ci * 13; // distance from town grows with level
      let best = null;
      for (let tries = 0; tries < 400; tries++) {
        const a = rnd() * TAU, d = want + (rnd() - 0.5) * 24;
        const x = R.town.x + Math.sin(a) * d, z = R.town.z - Math.cos(a) * d;
        const r = Math.hypot(x, z);
        if (r < R_RING + 38 || r > 452) continue;
        if (Math.abs(angDiff(bearingOf(x, z), R.bearing)) > 52 * DEG) continue;
        if (!isWalkable(x, z)) continue;
        const h = heightAt(x, z);
        if (h < WATER_Y + 1 || h > 22) continue;
        if (blocked(x, z, 12) || nearRoad(x, z, 12)) continue;
        if (camps.some((c) => dist2(c.x, c.z, x, z) < 48 * 48)) continue;
        let ok = true;
        for (let s = 0; s < 8 && ok; s++) { const aa = (s / 8) * TAU; if (!isWalkable(x + Math.sin(aa) * 10, z + Math.cos(aa) * 10)) ok = false; }
        if (!ok) continue;
        best = { x, z };
        break;
      }
      if (!best) continue;
      camps.push({ id: camps.length, realm: R.id, type, lmin, lmax, x: best.x, z: best.z, r: 9, count: type === 'bear' || type === 'troll' ? 3 : 4 });
    }
  }
  // the wild borderlands: harder camps for levels 20 to 40, out toward the edges of each realm,
  // every one led by a named champion
  const LATE_BY_REALM = [
    [['bear', 20, 23], ['bandit', 22, 25], ['skeleton', 24, 27], ['wolf', 26, 29], ['bandit', 28, 31], ['bear', 30, 33], ['skeleton', 32, 36], ['bandit', 35, 40]],
    [['wisp', 20, 23], ['boar', 22, 25], ['bandit', 24, 27], ['wisp', 26, 29], ['bear', 28, 31], ['wolf', 30, 33], ['wisp', 32, 36], ['bear', 35, 40]],
    [['wolf', 20, 23], ['draugr', 22, 25], ['troll', 24, 27], ['bear', 26, 29], ['draugr', 28, 31], ['troll', 30, 33], ['wolf', 32, 36], ['troll', 35, 40]],
  ];
  for (const R of REALMS) {
    const list = LATE_BY_REALM[R.id];
    for (let ci = 0; ci < list.length; ci++) {
      const [type, lmin, lmax] = list[ci];
      const want = 150 + ci * 15;
      let best = null;
      for (let tries = 0; tries < 900; tries++) {
        const a = rnd() * TAU, d = want + (rnd() - 0.5) * 34;
        const x = R.town.x + Math.sin(a) * d, z = R.town.z - Math.cos(a) * d;
        const r = Math.hypot(x, z);
        if (r < R_RING + 30 || r > 488 || Math.abs(x) > HALF - 26 || Math.abs(z) > HALF - 26) continue;
        if (Math.abs(angDiff(bearingOf(x, z), R.bearing)) > 58 * DEG) continue;
        if (!isWalkable(x, z)) continue;
        const h = heightAt(x, z);
        if (h < WATER_Y + 1 || h > 27) continue;
        if (blocked(x, z, 12) || nearRoad(x, z, 12)) continue;
        if (camps.some((c) => dist2(c.x, c.z, x, z) < 44 * 44)) continue;
        if (SITES.some((S) => dist2(S.x, S.z, x, z) < (S.r + 30) ** 2)) continue;
        let ok = true;
        for (let s = 0; s < 8 && ok; s++) { const aa = (s / 8) * TAU; if (!isWalkable(x + Math.sin(aa) * 11, z + Math.cos(aa) * 11)) ok = false; }
        if (!ok) continue;
        best = { x, z };
        break;
      }
      if (!best) continue;
      camps.push({ id: camps.length, realm: R.id, type, lmin, lmax, x: best.x, z: best.z, r: 10, count: type === 'bear' || type === 'troll' ? 3 : 4, elite: true });
    }
  }
  W.camps = camps;
  W.ready = true;
  return W;
}

/* zone names for the HUD */
function zoneAt(x, z) {
  if (x > DUN_X0) { const R = dunRoomAt(x, z); return { name: R ? R.name : 'The Hollow Barrow', kind: 'dungeon', realm: -1, frontier: true, dungeon: true }; }
  const r = Math.hypot(x, z);
  for (const S of SITES) {
    if (dist2(x, z, S.x, S.z) < (S.r + 6) ** 2) return { name: S.name, kind: S.kind, realm: S.realm, frontier: S.kind !== 'town' };
  }
  if (r < 40) return { name: 'The Lone Tree', kind: 'frontier', realm: -1, frontier: true };
  const realm = realmAt(x, z);
  if (r < R_RING) return { name: REALMS[realm].name + ' March', kind: 'frontier', realm, frontier: true };
  return { name: REALMS[realm].homeName, kind: 'home', realm, frontier: false };
}

/* ------------------------------------------------------------------ */
/* Collision queries                                                   */
/* ------------------------------------------------------------------ */
const _collSeen = new Set();
function collidersNear(x, z, rad, out) {
  out.length = 0;
  _collSeen.clear();
  const s = COLL.cell;
  for (let cx = Math.floor((x - rad) / s); cx <= Math.floor((x + rad) / s); cx++) {
    for (let cz = Math.floor((z - rad) / s); cz <= Math.floor((z + rad) / s); cz++) {
      const list = COLL.grid.get(collKey(cx, cz));
      if (!list) continue;
      for (const c of list) if (!_collSeen.has(c)) { _collSeen.add(c); out.push(c); }
    }
  }
  return out;
}
const _cn = [];
// pushes a circle (x, z, r) out of colliders; returns adjusted position
function resolveCollisions(p, r, y = null, faction = -1) {
  collidersNear(p.x, p.z, r + 12, _cn);
  for (let iter = 0; iter < 2; iter++) {
    for (const c of _cn) {
      if (!c.active) continue;
      if (c.tag === 'door' && c.owner === faction) continue; // a realm's own gates open for its people
      if (y !== null && !c.vert && y > c.baseY + c.h + 0.5) continue;
      // castles (04g_castles.js): walls you can stand on and parapets up on the wall walks block only at their own height
      if (y !== null && c.vert) { const bot = c.y0 != null ? c.y0 : c.baseY; if (y > bot + c.h - 0.55 || y + 1.7 < bot) continue; }
      if (c.type === 'circle') {
        const dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz, rr = c.r + r;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1e-4;
          p.x = c.x + (dx / d) * rr; p.z = c.z + (dz / d) * rr;
        }
      } else {
        // to local: local +Z -> (sin, cos), local +X -> (cos, -sin)
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        let ex = lx - qx, ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 < r * r) {
          let nx, nz, push;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; push = r - d; }
          else {
            // centre inside the box: push out along the shallowest axis
            const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
          }
          const wx = nx * c.cos + nz * c.sin, wz = -nx * c.sin + nz * c.cos;
          p.x += wx * push; p.z += wz * push;
        }
      }
    }
  }
  return p;
}
// is the straight segment clear of active colliders (used for line of sight and pathing)
function segmentClear(ax, az, bx, bz, pad = 0.4, ignoreDoors = false) {
  const len = dist(ax, az, bx, bz);
  const steps = Math.max(1, Math.ceil(len / 1.5));
  const tmp = { x: 0, z: 0 };
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    tmp.x = ax + (bx - ax) * t; tmp.z = az + (bz - az) * t;
    collidersNear(tmp.x, tmp.z, pad + 6, _cn);
    for (const c of _cn) {
      if (!c.active || c.tag === 'tree' || c.tag === 'rock' || c.tag === 'post') continue;
      if (ignoreDoors && c.tag === 'door') continue;
      if (c.type === 'circle') { if (dist2(tmp.x, tmp.z, c.x, c.z) < (c.r + pad) ** 2) return false; }
      else {
        const dx = tmp.x - c.x, dz = tmp.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad) return false;
      }
    }
  }
  return true;
}

/* A* over the road graph. doorOpen(node pair) decides whether a door edge is passable. */
function navPath(fromId, toId, doorOpen) {
  const N = NAV.nodes;
  const open = new Map([[fromId, 0]]);
  const g = new Map([[fromId, 0]]);
  const came = new Map();
  const hcost = (a) => dist(N[a].x, N[a].z, N[toId].x, N[toId].z);
  const f = new Map([[fromId, hcost(fromId)]]);
  let guard = 0;
  while (open.size && guard++ < 4000) {
    let cur = -1, best = Infinity;
    for (const [id] of open) { const fv = f.get(id); if (fv < best) { best = fv; cur = id; } }
    if (cur === toId) {
      const path = [cur];
      while (came.has(cur)) { cur = came.get(cur); path.push(cur); }
      return path.reverse();
    }
    open.delete(cur);
    for (const e of N[cur].adj) {
      if (e.kind === 'door' && !(doorOpen && doorOpen(cur, e.to))) continue;
      const ng = g.get(cur) + dist(N[cur].x, N[cur].z, N[e.to].x, N[e.to].z);
      if (ng < (g.get(e.to) ?? Infinity)) {
        came.set(e.to, cur); g.set(e.to, ng); f.set(e.to, ng + hcost(e.to)); open.set(e.to, 1);
      }
    }
  }
  return null;
}
function nearestNavNode(x, z, filter = null, needClear = true) {
  let best = null, bd = Infinity;
  for (const n of NAV.nodes) {
    if (filter && !filter(n)) continue;
    const d = dist2(x, z, n.x, n.z);
    if (d < bd) { bd = d; best = n; }
  }
  if (!needClear || !best) return best;
  // prefer the nearest node with a clear line
  const cands = NAV.nodes.filter((n) => !filter || filter(n)).sort((a, b) => dist2(x, z, a.x, a.z) - dist2(x, z, b.x, b.z)).slice(0, 6);
  for (const n of cands) if (segmentClear(x, z, n.x, n.z, 0.3, false)) return n;
  return best;
}
