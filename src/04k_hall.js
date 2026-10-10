/* ================================================================== */
/* the keep's great hall: a real hall in every keep, with a war table,  */
/* an armourer's bench, a basin, the hearth and the realm's stores     */
/* ================================================================== */
// Each keep's hall is a house of the keep site, planned after every town house (so the towns keep their house
// numbers in old saves) and drawn by the houses machinery (04e_houses.js): a hinged door, windows, a furnished and
// lit room, fire, ruin and rebuilding. Logres builds a tall stone hall under slate, Ériu a great roundhouse under
// thatch, Thule a log longhall under shingles with a long hearth down the middle. What is inside works:
//   the war table opens the campaign map and lets anyone of the realm that holds the keep command its warbands
//   (cwCanCommand asks hallCommandGrant), the armourer's bench mends and cleans gear (repairAll), the basin washes
//   (washGear), the hearth dries and warms you, and the stores sell building goods (06k_build.js).
// Shared-file hooks: 01_world.js planKeepHalls, 04_props.js keepHallPoles, 04e_houses.js keepHallLayout /
// keepHallColliders / keepHallDoorLabel, 09_player.js hallOffers, 13_main.js updateHall / drawHall.
const HALL = { list: [], grant: null, rest: null, seen: new Set() };

/* ------------------------------------------------------------------ */
/* planning: called from the world build, after every town            */
/* ------------------------------------------------------------------ */
function planKeepHalls() {
  for (const R of REALMS) {
    R.keepSites.forEach((S, k) => {
      const round = R.style === 'round', timber = R.style === 'timber';
      // the old hall's footprint: the back of the courtyard, clear of the wall walk and the lord's post in front
      const p = siteToWorld(S, 0, round ? -6.5 : -8.4);
      const rnd = mulberry(5150 + R.id * 17 + k * 5);
      const h = { x: p.x, z: p.z, w: 12.4, d: 9.6, yaw: S.yaw, h: timber ? 3.9 : 6.2, pitch: timber ? 0.74 : undefined, kind: 'hall', keep: true, seed: rnd() };
      S.houses = [h];
      S.colliders.push(...planHouse(S, R, h, 0));
      const H = h.rec;
      // the places things are used from, in the world
      H.hallSpots = {};
      for (const key in H.hallLocal) { const q = H.hallLocal[key], w = houseW(H, q[0], q[1]); H.hallSpots[key] = { x: w.x, z: w.z, y: H.y }; }
      HALL.list.push(H);
    });
  }
  if (window.__hm && window.__hm.fn) Object.assign(window.__hm.fn, { halls: () => HALL.list, HALL, hallOf, hallCommandGrant, hallWarTable, hallArmourer, hallBasin, hallHearth, hallStores, keepHallDoorLabel, cwCanCommand, closeDialog });
}

/* the furnishing, in house coordinates (x across, z toward the door), called from houseLayout */
function keepHallLayout(H, put, spots) {
  const L = H.hallLocal = {};
  H.torchL = [];
  const torch = (x, z, yaw, y) => { put('torch', x, z, yaw, { y }); };
  if (H.round) {
    const ri = H.ri;
    const polar = (a, rad) => [Math.sin(a) * rad, Math.cos(a) * rad];
    const at = (type, a, rad, o = {}) => { const [x, z] = polar(a, rad); return put(type, x, z, a + Math.PI, o); };
    put('ringhearth', 0, 0, 0, { r: 1.0, coll: { r: 1.1 } });
    H.hearth = { lx: 0, lz: 0, y: 0.14, size: 0.9 };
    at('highseat', Math.PI, ri - 0.55, { coll: { hx: 0.55, hz: 0.45 } });
    put('wartable', 0, -2.95, 0, { coll: { hx: 1.02, hz: 0.7 } });
    for (const s of [-1, 1]) put('table', s * 3.5, 0.6, 0, { len: 3.2, benches: 2, coll: { hx: 0.8, hz: 1.6 } });
    // things against the wall stand square to one of its flat facets
    const fa = TAU / H.N, fac = (a) => Math.round(a / fa) * fa;
    at('armourer', fac(-0.75), ri - 0.42, { coll: { hx: 0.82, hz: 0.42 } });
    at('weaponrack', fac(0.75), ri - 0.26, { len: 1.5, coll: { hx: 0.78, hz: 0.26 } });
    at('basin', fac(1.9), ri - 0.45, { coll: { r: 0.42 } });
    at('stores', fac(-1.9), ri - 0.62, { coll: { hx: 0.7, hz: 0.55 } });
    for (const a of [2.62, -2.62]) at('hanging', fac(a), ri + 0.02, { top: 3.3, len: 2.1, w: 0.95 });
    for (const a of [1.05, -1.05, 2.09, -2.09]) { const [x, z] = polar(fac(a), ri - 0.04); torch(x, z, fac(a) + Math.PI, 2.35); }
    at('rug', 0, 2.75, { sx: 2.2, sz: 1.3 });
    H.lamp = { lx: 0, lz: -3.2, y: H.ceilAt(3.2) - 0.9 };
    L.table = [0, -2.95]; L.hearth = [0, 1.6]; L.seat = polar(Math.PI, ri - 0.55);
    L.armourer = polar(fac(-0.75), ri - 0.42); L.basin = polar(fac(1.9), ri - 0.45); L.stores = polar(fac(-1.9), ri - 0.62);
    spots.hearth = { x: 0, z: 1.7 }; spots.mid = { x: 0, z: 3.4 };
  } else {
    const iw = H.iw, id = H.id, stone = H.style !== 'timber', s1 = 1.3;
    if (stone) {
      // a great fireplace in the back wall, its chimney breast running up into the roof
      put('fireplace', 0, -id, 0, { s: s1, coll: { hx: 0.86 * s1, hz: 0.36 * s1, oz: 0.34 * s1 } });
      H.hearth = { lx: 0, lz: -id + 0.3 * s1, y: 0.16 * s1, size: 0.75 };
      put('highseat', -2.65, -id + 0.62, 0, { coll: { hx: 0.55, hz: 0.45 } });
      put('wartable', 0, -0.25, 0, { coll: { hx: 1.02, hz: 0.7 } });
      put('chandelier', 0, -id * 0.48, 0, { y: H.wallH - 2.0 });
      for (const x of [-2.65, 2.65]) put('hanging', x, -id, 0, { top: 4.9, len: 2.6, w: 1.1 });
      L.table = [0, -0.25]; L.hearth = [0, -id + 1.75]; L.seat = [-2.65, -id + 0.62];
      spots.hearth = { x: 0.6, z: -id + 1.7 };
    } else {
      // a long hearth down the middle of the longhall; the smoke goes out at the ridge
      put('longhearth', 0, 0.75, 0, { len: 2.6, coll: { hx: 0.72, hz: 1.4 } });
      H.hearth = { lx: 0, lz: 0.75, y: 0.16, size: 0.85 };
      put('highseat', 0, -id + 0.6, 0, { coll: { hx: 0.55, hz: 0.45 } });
      put('wartable', 0, -id + 2.25, 0, { coll: { hx: 1.02, hz: 0.7 } });
      for (const x of [-1.75, 1.75]) put('hanging', x, -id, 0, { top: H.wallH - 0.35, len: 2.0, w: 0.9 });
      L.table = [0, -id + 2.25]; L.hearth = [1.3, 0.75]; L.seat = [0, -id + 0.6];
      spots.hearth = { x: 1.3, z: 0.75 };
    }
    for (const s of [-1, 1]) put('table', s * (iw - 1.7), 0.1, 0, { len: 4.4, benches: 2, coll: { hx: 0.8, hz: 2.2 } });
    put('armourer', -(iw - 0.42), id - 1.3, Math.PI / 2, { coll: { hx: 0.82, hz: 0.42 } });
    put('weaponrack', iw - 0.26, id - 1.3, -Math.PI / 2, { len: 1.5, coll: { hx: 0.78, hz: 0.26 } });
    put('basin', iw - 0.48, -id + 0.55, 0, { coll: { r: 0.42 } });
    put('stores', -(iw - 0.68), -id + 0.62, 0, { coll: { hx: 0.7, hz: 0.55 } });
    put('rug', 0, id - 1.6, 0, { sx: 2.2, sz: 1.3 });
    // torches between the windows down both long walls; shields above the benches
    const tz = stone ? [0, -3.2] : [-2.2, 2.2];
    for (const s of [-1, 1]) for (const z of tz) torch(s * (iw - 0.03), z, -s * Math.PI / 2, stone ? 2.6 : 2.2);
    for (const s of [-1, 1]) for (const z of stone ? [1.15, -1.15] : [-1.2, 1.2]) put('shield', s * iw, z, -s * Math.PI / 2, { y: stone ? 2.75 : 2.4 });
    H.lamp = { lx: 0, lz: stone ? id * 0.48 : -id * 0.48, y: H.wallH - (stone ? 1.5 : 0.8) };
    L.armourer = [-(iw - 0.42), id - 1.3]; L.basin = [iw - 0.48, -id + 0.55]; L.stores = [-(iw - 0.68), -id + 0.62];
    spots.mid = { x: 0.4, z: id - 1.4 };
  }
}
// the porch posts in front of the door stand in the way of anyone walking past them
function keepHallColliders(H, out) {
  const pts = H.round ? [[-0.85, H.r + 1.05], [0.85, H.r + 1.05]] : H.style === 'timber' ? [[-1.3, H.d / 2 + 1.1], [1.3, H.d / 2 + 1.1]] : [];
  for (const [lx, lz] of pts) { const w = houseW(H, lx, lz); out.push(addCircle(w.x, w.z, 0.16, 'post', 2.9)); }
}
// the realm's banners on two poles in front of the hall, either side of where the lord stands (recoloured with the keep)
function keepHallPoles(b, S, st, R, banners) {
  const H = S.houses[0].rec, fd = (H.round ? H.r : H.d / 2) + 2.3;
  for (const sd of [-1, 1]) {
    const w = houseW(H, sd * 2.2, fd), gy = heightAt(w.x, w.z);
    const Mp = new THREE.Matrix4().compose(new THREE.Vector3(w.x, gy, w.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, H.yaw, 0)), new THREE.Vector3(1, 1, 1));
    b.add(G.box, lm(Mp, 0, 0.12, 0, 0, 0.5, 0.3, 0.5), MAT.stone, darker(st.stone, 0.9), gy, 1);
    b.add(G.cyl8, lm(Mp, 0, 2.6, 0, 0, 0.09, 5.2, 0.09), MAT.wood, st.wood, gy, 2);
    b.add(G.cyl8, lm(Mp, 0, 4.82, 0.1, 0, 0.05, 1.5, 0.05, 0, Math.PI / 2), MAT.wood, darker(st.wood, 0.85));
    b.add(G.cone8, lm(Mp, 0, 5.26, 0, 0, 0.12, 0.25, 0.12), MAT.gold, [0.75, 0.6, 0.3]);
    S.colliders.push(addCircle(w.x, w.z, 0.2, 'post', 5.2));
    banners.push({ world: true, x: w.x + Math.sin(H.yaw) * 0.17, y: gy + 4.78, z: w.z + Math.cos(H.yaw) * 0.17, yaw: H.yaw, w: 1.3, h: 2.6, kind: 0 });
  }
}

/* ------------------------------------------------------------------ */
/* the furniture only a great hall has (drawn by houseRooms)           */
/* ------------------------------------------------------------------ */
Object.assign(ROOM_ITEMS, {
  // the war table: a heavy board on trestles with the March painted on a hide, and markers for keeps and bands
  wartable(ctx, it, T) {
    const { f, rnd } = ctx, wood = roomWood(ctx, 0.72);
    const Lt = 2.0, D = 1.32, top = 0.9;
    f.add(G.box, lm(T, 0, top - 0.05, 0, 0, Lt, 0.1, D), MAT.wood, darker(wood, 1.12));
    for (const s of [-1, 1]) {
      f.add(G.box, lm(T, 0, top + 0.025, s * (D / 2 - 0.03), 0, Lt, 0.05, 0.06), MAT.wood, darker(wood, 0.8));
      f.add(G.box, lm(T, s * (Lt / 2 - 0.03), top + 0.025, 0, 0, 0.06, 0.05, D - 0.12), MAT.wood, darker(wood, 0.8));
      for (const k of [-1, 1]) beam(f, T, [s * (Lt / 2 - 0.32), top - 0.1, k * 0.16], [s * (Lt / 2 - 0.32), 0, k * (D / 2 - 0.1)], 0.065, MAT.wood, wood);
      f.add(G.box, lm(T, s * (Lt / 2 - 0.32), top - 0.15, 0, 0, 0.13, 0.09, D - 0.18), MAT.wood, darker(wood, 0.9));
    }
    f.add(G.box, lm(T, 0, 0.32, 0, 0, Lt - 0.6, 0.09, 0.09), MAT.wood, darker(wood, 0.85));
    // the map: a hide, the green March inside its ring of mountains, the realms' lands, the hill and the lone tree
    const y0 = top + 0.004, sc = 0.58 / 470;
    f.add(G.box, lm(T, 0, y0, 0, 0, Lt - 0.14, 0.012, D - 0.14), MAT.cloth, [0.8, 0.72, 0.55]);
    f.add(G.cyl16, lm(T, 0, y0 + 0.008, 0, 0, 0.6, 0.008, 0.6), MAT.cloth, [0.58, 0.6, 0.42]);
    f.add(G.cyl16, lm(T, 0, y0 + 0.012, 0, 0, R_RING * sc, 0.008, R_RING * sc), MAT.cloth, [0.5, 0.56, 0.36]);
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * TAU, r = R_RING * sc + 0.012 * Math.sin(k * 3.1);
      f.add(G.cone8, lm(T, Math.sin(a) * r, y0 + 0.03, Math.cos(a) * r, a, 0.03, 0.05, 0.03), MAT.stone, [0.42, 0.4, 0.38]);
    }
    for (const R of REALMS) {
      const col = R.rgb;
      f.add(G.cyl12, lm(T, R.town.x * sc, y0 + 0.014, R.town.z * sc, 0, 0.13, 0.008, 0.13), MAT.cloth, darker(col, 1.1));
      f.add(G.box, lm(T, R.town.x * sc, y0 + 0.03, R.town.z * sc, 0, 0.025, 0.025, 0.025), MAT.wood, [0.7, 0.6, 0.45]);
      // each keep a little tower with a pennant pin in its first colours, the temple a white stone
      for (const S of R.keepSites) {
        f.add(G.box, lm(T, S.x * sc, y0 + 0.03, S.z * sc, S.yaw, 0.03, 0.045, 0.03), MAT.stone, [0.6, 0.58, 0.54]);
        f.add(G.cyl8, lm(T, S.x * sc, y0 + 0.08, S.z * sc, 0, 0.003, 0.08, 0.003), MAT.metal, ROOM.iron);
        f.add(G.box, lm(T, S.x * sc + 0.012, y0 + 0.105, S.z * sc, 0, 0.024, 0.018, 0.002), MAT.cloth, col);
      }
      const Tp = R.templeSite;
      f.add(G.cyl8, lm(T, Tp.x * sc, y0 + 0.024, Tp.z * sc, 0, 0.018, 0.03, 0.018), MAT.stone, [0.9, 0.88, 0.82]);
      // carved tokens for the realm's warbands, moved about the board
      for (let j = 0; j < 2; j++) {
        const a = Math.atan2(R.town.x, R.town.z) + (rnd() - 0.5) * 0.9, r = (0.2 + rnd() * 0.25);
        f.add(G.cyl8, lm(T, Math.sin(a) * r, y0 + 0.03, Math.cos(a) * r, 0, 0.02, 0.05, 0.02), MAT.wood, darker(col, 0.8));
        f.add(G.ico, lm(T, Math.sin(a) * r, y0 + 0.062, Math.cos(a) * r, 0, 0.018, 0.018, 0.018), MAT.cloth, col);
      }
    }
    f.add(G.cone8, lm(T, 0, y0 + 0.022, 0, 0, 0.05, 0.03, 0.05), MAT.cloth, [0.46, 0.52, 0.32]);
    f.add(G.cyl8, lm(T, 0, y0 + 0.05, 0, 0, 0.004, 0.04, 0.004), MAT.wood, [0.35, 0.25, 0.15]);
    f.add(G.ico, lm(T, 0, y0 + 0.075, 0, 0, 0.022, 0.018, 0.022), MAT.cloth, [0.3, 0.45, 0.22]);
    // weights on the corners of the hide, a pair of dividers, and candles to read it by
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) f.add(G.cyl8, lm(T, sx * (Lt / 2 - 0.16), y0 + 0.02, sz * (D / 2 - 0.14), 0, 0.04, 0.035, 0.04), MAT.metal, ROOM.pewter);
    beam(f, T, [0.55, y0 + 0.02, 0.32], [0.72, y0 + 0.02, 0.2], 0.006, MAT.metal, ROOM.iron);
    beam(f, T, [0.55, y0 + 0.02, 0.32], [0.74, y0 + 0.02, 0.34], 0.006, MAT.metal, ROOM.iron);
    for (const s of [-1, 1]) roomCandle(ctx, T, s * (Lt / 2 - 0.16), y0 + 0.04, 0);
  },
  // the armourer's bench: a scarred bench, an anvil on its block, a grindstone, tools on a board, a mail shirt on a stand
  armourer(ctx, it, T) {
    const { f, b, H } = ctx, wood = roomWood(ctx, 0.8), iron = ROOM.iron;
    f.add(G.box, lm(T, 0, 0.84, 0.02, 0, 1.6, 0.09, 0.62), MAT.wood, darker(wood, 1.05));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.add(G.box, lm(T, sx * 0.72, 0.4, 0.02 + sz * 0.24, 0, 0.1, 0.8, 0.1), MAT.wood, wood);
    f.add(G.box, lm(T, 0, 0.18, 0.02, 0, 1.44, 0.05, 0.5), MAT.wood, darker(wood, 0.9));
    // a tool board on the wall: hammers, tongs, a file, a rasp
    f.add(G.box, lm(T, 0, 1.55, -0.3, 0, 1.4, 0.9, 0.04), MAT.wood, darker(wood, 0.9));
    for (const [x, len] of [[-0.5, 0.32], [-0.3, 0.38], [-0.1, 0.3], [0.12, 0.42], [0.32, 0.36]]) {
      f.add(G.box, lm(T, x, 1.62 - len / 2, -0.26, 0, 0.025, len, 0.025), MAT.wood, darker(wood, 0.7));
      f.add(G.box, lm(T, x, 1.64, -0.25, 0, 0.1, 0.045, 0.05), MAT.metal, iron);
    }
    beam(f, T, [0.5, 1.8, -0.25], [0.56, 1.3, -0.25], 0.012, MAT.metal, iron);
    beam(f, T, [0.6, 1.8, -0.25], [0.54, 1.3, -0.25], 0.012, MAT.metal, iron);
    // the anvil stands on a block of oak at the end of the bench
    b.kind = HPART.SHELL;
    b.add(G.cyl12, lm(T, 1.12, 0.28, 0.12, 0, 0.26, 0.56, 0.26), MAT.logH, [0.36, 0.26, 0.16], H.y, 1);
    b.kind = HPART.EXT;
    f.add(G.box, lm(T, 1.12, 0.62, 0.12, 0, 0.4, 0.12, 0.16), MAT.metal, [0.2, 0.2, 0.22]);
    f.add(G.box, lm(T, 1.12, 0.7, 0.12, 0, 0.5, 0.06, 0.18), MAT.metal, [0.26, 0.26, 0.28]);
    f.add(G.cone8, lm(T, 1.42, 0.7, 0.12, 0, 0.05, 0.16, 0.05, 0, -Math.PI / 2), MAT.metal, [0.26, 0.26, 0.28]);
    // a grindstone in its frame at the other end
    f.add(G.cyl16, lm(T, -1.12, 0.62, 0.15, 0, 0.3, 0.09, 0.3, 0, Math.PI / 2), MAT.stone, [0.62, 0.58, 0.52]);
    for (const s of [-1, 1]) f.add(G.box, lm(T, -1.12 + s * 0.08, 0.34, 0.15, 0, 0.05, 0.68, 0.08), MAT.wood, wood);
    f.add(G.cyl8, lm(T, -1.12, 0.62, 0.15, 0, 0.02, 0.3, 0.02, 0, Math.PI / 2), MAT.metal, iron);
    // on the bench: a helm, a gauntlet, a whetstone and a pot of oil
    f.add(G.ico, lm(T, -0.35, 0.98, 0.08, 0.5, 0.15, 0.13, 0.16), MAT.metal, [0.5, 0.5, 0.52]);
    f.add(G.box, lm(T, 0.2, 0.92, 0.1, 0.3, 0.2, 0.06, 0.1), MAT.metal, [0.42, 0.42, 0.44]);
    f.add(G.box, lm(T, 0.5, 0.91, 0.18, -0.2, 0.18, 0.04, 0.05), MAT.stone, [0.4, 0.42, 0.45]);
    roomPot(f, T, 0.62, 0.885, -0.05, 0.05, 0.12, ROOM.clay);
  },
  // spears, swords and axes standing in a rack against the wall, shields leaning at its foot
  weaponrack(ctx, it, T) {
    const { f, R } = ctx, wood = roomWood(ctx, 0.75), len = it.len;
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * len / 2, 0.95, 0.12, 0, 0.09, 1.9, 0.09), MAT.wood, wood);
    for (const y of [0.25, 1.35]) f.add(G.box, lm(T, 0, y, 0.12, 0, len, 0.08, 0.1), MAT.wood, darker(wood, 0.9));
    const n = Math.floor(len / 0.24);
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + 0.2 + k * ((len - 0.4) / (n - 1)), kind = k % 3;
      if (kind === 0) { f.add(G.cyl8, lm(T, x, 1.15, 0.14, 0, 0.02, 2.2, 0.02, -0.06), MAT.wood, darker(wood, 1.1)); f.add(G.cone8, lm(T, x, 2.32, 0.07, 0, 0.035, 0.24, 0.02, -0.06), MAT.metal, [0.62, 0.62, 0.64]); }
      else if (kind === 1) { f.add(G.box, lm(T, x, 0.95, 0.15, 0, 0.05, 0.9, 0.012, -0.05), MAT.metal, [0.66, 0.66, 0.68]); f.add(G.box, lm(T, x, 1.43, 0.13, 0, 0.2, 0.035, 0.035, -0.05), MAT.metal, [0.36, 0.32, 0.26]); f.add(G.cyl8, lm(T, x, 1.56, 0.13, 0, 0.018, 0.22, 0.018, -0.05), MAT.cloth, [0.3, 0.2, 0.12]); }
      else { f.add(G.cyl8, lm(T, x, 0.62, 0.15, 0, 0.022, 1.24, 0.022, -0.05), MAT.wood, darker(wood, 1.15)); f.add(G.box, lm(T, x + 0.06, 1.2, 0.13, 0, 0.14, 0.18, 0.02, -0.05), MAT.metal, [0.58, 0.58, 0.6]); }
    }
    for (const s of [-1, 1]) {
      f.add(G.cyl16, lm(T, s * 0.42, 0.36, 0.4, 0, 0.34, 0.03, 0.34, Math.PI / 2 - 0.25), MAT.wood, darker(R.rgb, 0.8));
      f.add(G.cyl16, lm(T, s * 0.42, 0.36, 0.415, 0, 0.35, 0.02, 0.35, Math.PI / 2 - 0.25), MAT.metal, ROOM.iron);
    }
  },
  // a stone basin on a pillar, a ewer and a towel
  basin(ctx, it, T) {
    const { b, f, H, st } = ctx;
    b.kind = HPART.SHELL;
    b.add(G.cyl12, lm(T, 0, 0.36, 0, 0, 0.16, 0.72, 0.16), MAT.stone, darker(st.stone, 1.0), H.y, 1);
    b.add(G.cyl16, lm(T, 0, 0.78, 0, 0, 0.36, 0.16, 0.36), MAT.stone, darker(st.stone, 1.05));
    b.kind = HPART.EXT;
    f.add(G.cyl16, lm(T, 0, 0.85, 0, 0, 0.3, 0.012, 0.3), MAT.water, [0.1, 0.16, 0.2]);
    roomPot(f, T, 0.22, 0.86, -0.18, 0.06, 0.2, [0.7, 0.66, 0.56]);
    f.add(G.box, lm(T, -0.3, 0.98, -0.12, 0.6, 0.05, 0.36, 0.22), MAT.cloth, ROOM.linen);
  },
  // a long cloth hung on the wall in the realm's colours, an emblem band and a fringe
  hanging(ctx, it, T) {
    const { f, R } = ctx, w = it.w, top = it.top, len = it.len, c = R.rgb, light = hex3(R.light);
    f.add(G.cyl8, lm(T, 0, top + 0.04, 0.07, 0, 0.025, w + 0.24, 0.025, 0, Math.PI / 2), MAT.wood, roomWood(ctx, 0.6));
    for (const s of [-1, 1]) f.add(G.ico, lm(T, s * (w / 2 + 0.13), top + 0.04, 0.07, 0, 0.04, 0.04, 0.04), MAT.gold, [0.75, 0.6, 0.3]);
    f.add(G.box, lm(T, 0, top - len / 2, 0.055, 0, w, len, 0.015), MAT.cloth, darker(c, 0.95));
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * (w / 2 - 0.06), top - len / 2, 0.064, 0, 0.05, len - 0.08, 0.004), MAT.cloth, light);
    f.add(G.box, lm(T, 0, top - len * 0.42, 0.064, Math.PI / 4, w * 0.36, w * 0.36, 0.004), MAT.cloth, light);
    f.add(G.box, lm(T, 0, top - len * 0.42, 0.067, Math.PI / 4, w * 0.2, w * 0.2, 0.004), MAT.cloth, darker(c, 0.8));
    // a swallowtail point
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * w * 0.25, top - len - 0.12, 0.055, s * 0.5, w * 0.36, 0.3, 0.012), MAT.cloth, darker(c, 0.9));
  },
  // a torch in an iron bracket on the wall; its flame is drawn as a glow (drawHall)
  torch(ctx, it, T) {
    const { f, H } = ctx, y = it.y;
    f.add(G.box, lm(T, 0, y, 0.05, 0, 0.12, 0.2, 0.04), MAT.metal, ROOM.iron);
    beam(f, T, [0, y - 0.04, 0.05], [0, y + 0.06, 0.26], 0.018, MAT.metal, ROOM.iron);
    f.add(G.cyl8, lm(T, 0, y + 0.13, 0.27, 0, 0.05, 0.08, 0.05), MAT.metal, ROOM.iron);
    f.add(G.cyl8, lm(T, 0, y + 0.08, 0.27, 0, 0.032, 0.42, 0.032, 0.18), MAT.wood, [0.32, 0.22, 0.13]);
    f.add(G.cyl8, lm(T, 0, y + 0.3, 0.3, 0, 0.045, 0.1, 0.045, 0.18), MAT.cloth, [0.12, 0.09, 0.07]);
    const p = worldOf(T, 0, y + 0.42, 0.31);
    H.torches = H.torches || [];
    H.torches.push(p);
  },
  // Thule's long hearth: a kerb of stones round a bed of embers, logs, andirons and a spit with a cauldron
  longhearth(ctx, it, T) {
    const { b, f, H } = ctx, len = it.len, hw = 0.55;
    b.kind = HPART.SHELL;
    b.add(G.box, lm(T, 0, 0.03, 0, 0, hw * 2, 0.04, len), MAT.darkstone, [0.13, 0.11, 0.1]);
    const n = Math.round(len / 0.3);
    for (let k = 0; k <= n; k++) for (const s of [-1, 1]) {
      const z = -len / 2 + (k / n) * len;
      b.add(G.box, lm(T, s * (hw + 0.08), 0.1, z, k * 0.7, 0.2, 0.2, 0.26), MAT.stone, darker([0.5, 0.48, 0.45], 0.85 + 0.25 * fhash(k * 3 + s)), H.y, 1);
    }
    for (const e of [-1, 1]) for (let k = 0; k < 4; k++) b.add(G.box, lm(T, -hw + 0.14 + k * (hw * 2 - 0.28) / 3, 0.1, e * (len / 2 + 0.08), k, 0.24, 0.2, 0.2), MAT.stone, [0.45, 0.43, 0.4], H.y, 1);
    b.kind = HPART.EXT;
    for (const [x, z, a] of [[-0.1, -0.5, 0.3], [0.12, -0.2, -0.25], [0, 0.35, 0.1], [-0.15, 0.6, -0.4]]) f.add(G.cyl8, lm(T, x, 0.12, z, a, 0.07, 0.62, 0.07, 0, Math.PI / 2), MAT.logH, [0.3, 0.2, 0.12]);
    for (const e of [-1, 1]) { f.add(G.box, lm(T, 0, 0.6, e * 0.9, 0, 0.04, 1.2, 0.04), MAT.metal, ROOM.iron); }
    f.add(G.cyl8, lm(T, 0, 1.18, 0, 0, 0.02, 1.84, 0.02, Math.PI / 2), MAT.metal, ROOM.iron);
    f.add(G.box, lm(T, 0, 0.98, -0.45, 0, 0.012, 0.4, 0.012), MAT.metal, ROOM.iron);
    f.add(G.cyl12, lm(T, 0, 0.66, -0.45, 0, 0.2, 0.3, 0.2), MAT.metal, [0.12, 0.12, 0.13]);
    f.add(G.cyl12, lm(T, 0, 0.82, -0.45, 0, 0.21, 0.04, 0.21), MAT.metal, [0.16, 0.16, 0.17]);
  },
  // the realm's stores: planks, stone, thatch, sacks and crates of nails and glass
  stores(ctx, it, T) {
    const { f, rnd, st } = ctx, wood = roomWood(ctx, 1.0);
    for (let k = 0; k < 6; k++) f.add(G.box, lm(T, -0.3, 0.05 + k * 0.07, 0.05, (rnd() - 0.5) * 0.06, 0.24, 0.06, 1.0), MAT.wood, darker([0.66, 0.52, 0.34], 0.9 + 0.2 * rnd()));
    for (let k = 0; k < 5; k++) f.add(G.box, lm(T, 0.18 + (k % 2) * 0.24, 0.12 + Math.floor(k / 2) * 0.24, -0.25, rnd() * 0.3, 0.22, 0.22, 0.26), MAT.stone, darker(st.stone, 0.85 + 0.25 * rnd()));
    for (let k = 0; k < 3; k++) f.add(G.cyl8, lm(T, 0.35, 0.16 + k * 0.3, 0.32, 0, 0.15, 0.9, 0.15, 0, Math.PI / 2), MAT.thatch, [0.74, 0.62, 0.36]);
    roomCrate(f, T, -0.5, 0, -0.32, 0.5, wood, 0.2);
    f.add(G.ico, lm(T, -0.48, 0.66, -0.3, 0.3, 0.2, 0.18, 0.2), MAT.cloth, [0.62, 0.55, 0.42]);
    f.add(G.ico, lm(T, 0.62, 0.22, -0.05, 0.9, 0.22, 0.24, 0.2), MAT.cloth, [0.6, 0.54, 0.4]);
  },
  // an iron ring of candles hung on chains from the tie beam
  chandelier(ctx, it, T) {
    const { f, H } = ctx, y = it.y, top = H.wallH - 0.16, r = 0.62;
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; beam(f, T, [Math.sin(a) * r, y + 0.02, Math.cos(a) * r], [0, top, 0], 0.008, MAT.metal, ROOM.iron); }
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * TAU, a1 = ((k + 1) / 12) * TAU;
      beam(f, T, [Math.sin(a0) * r, y, Math.cos(a0) * r], [Math.sin(a1) * r, y, Math.cos(a1) * r], 0.025, MAT.metal, ROOM.iron);
    }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.26; roomCandle(ctx, T, Math.sin(a) * r, y + 0.02, Math.cos(a) * r); }
  },
});

/* ------------------------------------------------------------------ */
/* using the hall                                                      */
/* ------------------------------------------------------------------ */
const hallOf = (P) => { for (const H of HALL.list) if (dist2(P.x, P.z, H.x, H.z) < 100 && houseHas(H, P.x, P.z, -0.1)) return H; return null; };
const hallHolder = (H) => (H.S.keepRef ? H.S.keepRef.realm : H.realm);
function keepHallDoorLabel(H, P) {
  if (houseDoorOpen(H)) return houseHas(H, P.x, P.z) ? 'Close the door of the great hall' : `Close the door of the great hall of ${H.S.name}`;
  return `Open the great hall of ${H.S.name}: war table, armourer, hearth`;
}
// the E key inside a hall: the nearest of the war table, the bench, the basin, the hearth and the stores
function hallOffers(P, offer) {
  const H = hallOf(P);
  if (!H || !houseIntact(H) || H.state === 'burning') return;
  if (!HALL.seen.has(H.num)) {
    HALL.seen.add(H.num);
    uiToast(`The great hall of ${H.S.name}: command your realm's warbands at the war table, mend and clean your gear at the armourer's bench, wash at the basin, dry off by the hearth.`, 'hint');
  }
  const sp = H.hallSpots, mine = hallHolder(H) === P.faction, d = (q) => dist(P.x, P.z, q.x, q.z);
  offer(d(sp.table), 2.5, mine ? `Command the warbands at the war table of ${H.S.name}` : `Study the war table (it answers to ${REALMS[hallHolder(H)].name})`, () => hallWarTable(H), 0.1);
  const cost = repairAllCost(), dirty = kitDirt() > 0.02 || (P.batter || 0) > 0.05;
  offer(d(sp.armourer), 2.3, cost > 0 ? `Mend${dirty ? ' and clean' : ''} your gear at the armourer's bench (${fmtInt(cost)} gold)` : dirty ? 'Clean your gear at the armourer\'s bench' : 'The armourer\'s bench (your gear is sound)', () => hallArmourer(H));
  offer(d(sp.basin), 1.9, 'Wash at the basin', () => hallBasin(H));
  offer(d(sp.hearth), 2.4, (P.wet || 0) > 0.05 || (P.snow || 0) > 0.05 ? 'Dry off and warm yourself by the hearth' : 'Rest by the hearth', () => hallHearth(H), 0.3);
  offer(d(sp.stores), 2.3, mine ? 'Buy building stores' : 'The stores (they belong to the holders of the keep)', () => hallStores(H));
}
// may the player command from here: standing at the war table of a keep their realm holds
function hallCommandGrant() {
  const P = GAME.player, g = HALL.grant;
  if (!P || !g || !P.alive) return false;
  if (hallHolder(g.H) !== P.faction || !houseIntact(g.H)) return false;
  return dist2(P.x, P.z, g.x, g.z) < 3.4 * 3.4;
}
function hallWarTable(H) {
  const P = GAME.player, sp = H.hallSpots.table, holder = hallHolder(H);
  HALL.grant = { H, x: sp.x, z: sp.z };
  faceToward(P, sp.x, sp.z);
  setAct(P, 5, 0.55);
  if (holder === P.faction) uiToast(`The war table of ${H.S.name} answers to you: choose one of ${REALMS[P.faction].name}'s warbands on the map, then a keep to attack or defend, a temple to raid, or tell it to rally to you.`, 'hint');
  else uiToast(`This war table answers to ${REALMS[holder].name} now. Take ${H.S.name} back to command from it.`, 'hint');
  toggleMap(true);
}
function hallArmourer(H) {
  const P = GAME.player, sp = H.hallSpots.armourer;
  faceToward(P, sp.x, sp.z);
  setAct(P, 5, 0.55);
  let did = false;
  if (repairAllCost() > 0) { if (!repairAll(`The armourer of ${H.S.name}`)) return; did = true; }
  if (kitDirt() > 0.02 || (P.batter || 0) > 0.05) {
    for (const it of kitItems()) { delete it.dirt; delete it.blood; }
    P.dirt = 0; P.blood = 0; P.batter = 0;
    uiLog('You scrub the mud and blood from your gear and beat the dents out of it at the armourer\'s bench.', 'sys');
    sfx('grind');
    did = true;
  }
  if (!did) uiLog('Your gear is sound and clean.', 'sys');
  if (UI.modal === 'kit') renderKit();
  saveSoon();
}
function hallBasin(H) {
  const P = GAME.player, sp = H.hallSpots.basin;
  faceToward(P, sp.x, sp.z);
  setAct(P, 5, 0.55);
  washGear({ x: sp.x, z: sp.z, y: H.y + 0.2, kind: 'basin' });
}
function hallHearth(H) {
  const P = GAME.player;
  let foe = null;
  forNear(P.x, P.z, 18, (e) => { if (!foe && e.alive && e.kind !== 'door' && isEnemy(P, e)) foe = e; });
  if (foe) { uiError('You cannot rest with enemies near'); return; }
  HALL.rest = { H, x: P.x, z: P.z, t: 0 };
  faceToward(P, H.hearth.x, H.hearth.z);
  setAct(P, 5, 0.55);
  uiLog('You sit by the hearth to warm yourself.', 'sys');
}
// the realm's stores: building goods for gold (only the holders of the keep may buy)
const HALL_STORES = [['plank', 10, 18], ['stone', 10, 14], ['thatch', 10, 12], ['nails', 20, 16], ['glass', 4, 18], ['iron', 2, 22], ['tool_hammer', 1, 12]];
function hallStores(H) {
  const P = GAME.player;
  if (hallHolder(H) !== P.faction) { uiError(`The stores of ${H.S.name} are kept for ${REALMS[hallHolder(H)].name}`); return; }
  UI.modal = 'dialog';
  $('dialog').hidden = false;
  $('dlg-title').textContent = `The stores of ${H.S.name}`;
  const rows = HALL_STORES.filter(([id]) => GOODS[id]).map(([id, n, price]) => `<li><b>${n} ${esc(goodName(id, n).toLowerCase())}</b> for ${price} gold <small>(you have ${goodsCount(id)})</small></li>`).join('');
  $('dlg-body').innerHTML = `<p>The steward keeps timber, stone, thatch, nails and glass for the realm's builders. Everything you build is made from these goods, and a hammer to work them. You have ${fmtInt(INV.gold)} gold.</p><ul class="hall-stores">${rows}</ul>`;
  const box = $('dlg-actions');
  box.innerHTML = '';
  for (const [id, n, price] of HALL_STORES) {
    if (!GOODS[id]) continue;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn'; btn.textContent = `${n} ${goodName(id, n).toLowerCase()}, ${price} gold`;
    btn.onclick = () => {
      if (INV.gold < price) { uiError('You cannot afford that'); return; }
      if (goodsAdd(id, n) > 0) { INV.gold -= price; sfx('coins'); hallStores(H); }
    };
    box.appendChild(btn);
  }
  const done = document.createElement('button');
  done.type = 'button'; done.className = 'btn primary'; done.textContent = 'Done';
  done.onclick = closeDialog;
  box.appendChild(done);
}

/* ------------------------------------------------------------------ */
/* every step and every frame                                          */
/* ------------------------------------------------------------------ */
function updateHall(dt) {
  const P = GAME.player;
  if (!P) return;
  if (HALL.grant && !hallCommandGrant() && UI.modal !== 'map') HALL.grant = null;
  const R = HALL.rest;
  if (R) {
    const moved = dist2(P.x, P.z, R.x, R.z) > 0.09 || !P.alive || P.casting || !houseIntact(R.H);
    if (moved) { HALL.rest = null; return; }
    R.t += dt;
    P.wet = Math.max(0, (P.wet || 0) - dt * 0.22);
    P.snow = Math.max(0, (P.snow || 0) - dt * 0.4);
    P.hp = Math.min(P.maxHp, P.hp + P.maxHp * 0.07 * dt);
    if ((P.wet || 0) > 0.05 && Math.random() < dt * 6) fxAlpha.emit(P.x + (Math.random() - 0.5) * 0.5, P.y + 0.8 + Math.random() * 0.8, P.z + (Math.random() - 0.5) * 0.5, 0, 0.6 + Math.random() * 0.4, 0, 1.2, 0.7, 0.7, 0.72, -0.4, -0.05, 0.08);
    if (P.wet <= 0 && P.snow <= 0 && P.hp >= P.maxHp && R.t > 1.5) {
      uiLog('You are warm and dry again.', 'sys');
      HALL.rest = null;
    }
  }
}
function drawHall(dt) {
  void dt;
  const cx = camera.position.x, cz = camera.position.z, night = U.uNight.value;
  for (const H of HALL.list) {
    if (!H.torches || !houseIntact(H) || dist2(cx, cz, H.x, H.z) > 70 * 70) continue;
    for (const p of H.torches) {
      const k = (0.8 + 0.25 * night) * (0.85 + 0.15 * Math.sin(renderTime * 11 + p.x * 3.7) * Math.sin(renderTime * 7.3 + p.z));
      glowPush(p.x, p.y, p.z, 2.2 * k, 1.1 * k, 0.35 * k, 0.22);
      glowPush(p.x, p.y + 0.05, p.z, 0.6 * k, 0.32 * k, 0.1 * k, 1.1);
    }
  }
}
