/* ================================================================== */
/* rooms: what is inside a house, what is left when it burns, and the  */
/* scaffold it is rebuilt in                                           */
/* ================================================================== */
// Furniture goes into ctx.f (drawn only near the town) as FURN; masonry that outlives a fire (hearths, stoves,
// chimney breasts) goes into ctx.b as SHELL. Every item stands on the floor in its own frame: +z faces into the
// room, y = 0 is the floor.
const ROOM = {
  wool: [[0.52, 0.14, 0.12], [0.22, 0.3, 0.48], [0.3, 0.42, 0.22], [0.58, 0.44, 0.2], [0.42, 0.24, 0.36]],
  linen: [0.82, 0.77, 0.64], straw: [0.78, 0.66, 0.42], iron: [0.17, 0.17, 0.18], clay: [0.62, 0.38, 0.26], pewter: [0.5, 0.52, 0.55],
};
function roomFrame(ctx, it) { return lm(ctx.M, it.x, 0, it.z, it.yaw); }
function roomWood(ctx, k = 1) { return darker(ctx.st.wood, k); }

function houseRooms(ctx) {
  const { H } = ctx;
  const rnd = mulberry(Math.floor(H.seed * 1e6) + 991);
  ctx.rnd = rnd;
  ctx.wool = ROOM.wool[Math.floor(rnd() * ROOM.wool.length)];
  for (const it of H.items) {
    const fn = ROOM_ITEMS[it.type];
    if (fn) { ctx.f.kind = HPART.FURN; ctx.f.hinge = null; fn(ctx, it, roomFrame(ctx, it)); }
  }
  ctx.f.kind = HPART.FURN;
  roomLamp(ctx);
  ctx.b.kind = HPART.EXT; ctx.f.kind = HPART.FURN;
}

/* small pieces shared by several items */
function roomBarrel(f, T, x, z, s, wood, rot = 0) {
  const B = lm(T, x, 0, z, rot);
  f.add(G.cyl12, lm(B, 0, 0.42 * s, 0, 0, 0.3 * s, 0.84 * s, 0.3 * s), MAT.wood, darker(wood, 0.95));
  f.add(G.cyl12, lm(B, 0, 0.42 * s, 0, 0, 0.335 * s, 0.4 * s, 0.335 * s), MAT.wood, darker(wood, 1.05));
  for (const y of [0.1, 0.32, 0.52, 0.74]) { const r = (y > 0.2 && y < 0.6 ? 0.34 : 0.315) * s; f.add(G.cyl12, lm(B, 0, y * s, 0, 0, r, 0.04 * s, r), MAT.metal, ROOM.iron); }
  f.add(G.cyl12, lm(B, 0, 0.845 * s, 0, 0, 0.27 * s, 0.02, 0.27 * s), MAT.wood, darker(wood, 0.7));
}
function roomCrate(f, T, x, y, z, s, wood, rot = 0) {
  const C = lm(T, x, y + s / 2, z, rot);
  f.add(G.box, lm(C, 0, 0, 0, 0, s, s, s), MAT.wood, darker(wood, 1.1));
  for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) f.add(G.box, lm(C, ax * s * 0.47, 0, az * s * 0.47, 0, s * 0.1, s * 1.02, s * 0.1), MAT.wood, darker(wood, 0.62));
  for (const sy of [1, -1]) f.add(G.box, lm(C, 0, sy * s * 0.47, 0, 0, s * 1.02, s * 0.08, s * 1.02), MAT.wood, darker(wood, 0.62));
}
function roomPot(f, T, x, y, z, r, h, col, matId = MAT.cloth) {
  f.add(G.cyl12, lm(T, x, y + h * 0.45, z, 0, r, h * 0.9, r), matId, col);
  f.add(G.cyl12, lm(T, x, y + h * 0.93, z, 0, r * 0.7, h * 0.14, r * 0.7), matId, darker(col, 0.85));
}
function roomCandle(ctx, T, x, y, z) {
  const f = ctx.f;
  f.add(G.cyl8, lm(T, x, y + 0.012, z, 0, 0.05, 0.024, 0.05), MAT.metal, [0.36, 0.33, 0.28]);
  f.add(G.cyl8, lm(T, x, y + 0.09, z, 0, 0.02, 0.14, 0.02), MAT.cloth, [0.92, 0.88, 0.76]);
  const p = worldOf(T, x, y + 0.19, z);
  ctx.H.candles = ctx.H.candles || [];
  ctx.H.candles.push(p);
}

const ROOM_ITEMS = {
  // Logres: a stone fireplace in the back wall, a chimney breast up to the roof, a mantel with crockery, a pot on a crane
  fireplace(ctx, it, T) {
    const { b, f, H, st } = ctx;
    const stone = darker(st.stone, 0.95), soot = [0.12, 0.1, 0.09];
    b.kind = HPART.SHELL;
    b.add(G.box, lm(T, 0, 0.03, 0.42, 0, 1.95, 0.06, 0.82), MAT.stone, [0.46, 0.44, 0.4], H.y, 1);
    for (const s of [-1, 1]) b.add(G.box, lm(T, s * 0.63, 0.6, 0.31, 0, 0.34, 1.2, 0.62), MAT.stone, stone, H.y, 1.4);
    b.add(G.box, lm(T, 0, 0.6, 0.06, 0, 0.94, 1.2, 0.12), MAT.darkstone, soot, H.y, 1.4);
    b.add(G.box, lm(T, 0, 0.05, 0.32, 0, 0.94, 0.06, 0.52), MAT.darkstone, soot);
    const ceil = H.ceilLocal(0) + 0.2;
    b.add(G.box, lm(T, 0, (1.42 + ceil) / 2, 0.26, 0, 1.6, ceil - 1.42, 0.5), MAT.stone, darker(stone, 0.97), H.y, 3);
    b.add(G.box, lm(T, 0, 1.36, 0.27, 0, 1.7, 0.12, 0.52), MAT.darkstone, [0.2, 0.18, 0.16]);
    b.kind = HPART.EXT;
    f.kind = HPART.FURN;
    // the mantel beam and shelf, andirons and logs, a crane with a pot
    f.add(G.box, lm(T, 0, 1.24, 0.52, 0, 1.78, 0.2, 0.18), MAT.wood, roomWood(ctx, 0.62));
    f.add(G.box, lm(T, 0, 1.47, 0.42, 0, 1.86, 0.05, 0.3), MAT.wood, roomWood(ctx, 0.75));
    roomPot(f, T, -0.62, 1.495, 0.42, 0.07, 0.2, ROOM.clay);
    roomPot(f, T, -0.42, 1.495, 0.4, 0.055, 0.15, [0.72, 0.68, 0.58]);
    f.add(G.cyl12, lm(T, 0.5, 1.6, 0.36, 0, 0.12, 0.012, 0.12, Math.PI / 2 - 0.25), MAT.metal, ROOM.pewter);
    roomCandle(ctx, T, 0.75, 1.495, 0.44);
    for (const s of [-1, 1]) {
      f.add(G.box, lm(T, s * 0.28, 0.12, 0.34, 0, 0.04, 0.18, 0.04), MAT.metal, ROOM.iron);
      f.add(G.box, lm(T, s * 0.28, 0.2, 0.32, 0, 0.04, 0.03, 0.42), MAT.metal, ROOM.iron);
    }
    for (const [x, a] of [[-0.08, 0.25], [0.1, -0.2]]) f.add(G.cyl8, lm(T, x, 0.26, 0.3, a, 0.06, 0.62, 0.06, 0, Math.PI / 2), MAT.logH, [0.3, 0.2, 0.12]);
    f.add(G.box, lm(T, -0.4, 0.75, 0.12, 0, 0.035, 1.1, 0.035), MAT.metal, ROOM.iron);
    f.add(G.box, lm(T, -0.18, 1.08, 0.2, 0.35, 0.5, 0.03, 0.03), MAT.metal, ROOM.iron);
    f.add(G.box, lm(T, 0.02, 0.86, 0.27, 0, 0.012, 0.42, 0.012), MAT.metal, ROOM.iron);
    f.add(G.cyl12, lm(T, 0.02, 0.56, 0.27, 0, 0.16, 0.2, 0.16), MAT.metal, [0.12, 0.12, 0.13]);
    f.add(G.cyl12, lm(T, 0.02, 0.67, 0.27, 0, 0.17, 0.03, 0.17), MAT.metal, [0.16, 0.16, 0.17]);
  },
  // Thule: a stone stove on a plinth with a hood that carries the smoke into the stack
  stove(ctx, it, T) {
    const { b, f, H, st } = ctx;
    const stone = darker(st.stone, 0.9), soot = [0.12, 0.1, 0.09];
    b.kind = HPART.SHELL;
    b.add(G.box, lm(T, 0, 0.21, 0, 0, 1.3, 0.42, 1.3), MAT.stone, stone, H.y, 1);
    b.add(G.box, lm(T, 0, 0.72, -0.5, 0, 1.0, 0.6, 0.18), MAT.stone, stone);
    for (const s of [-1, 1]) b.add(G.box, lm(T, s * 0.45, 0.72, -0.08, 0, 0.16, 0.6, 0.66), MAT.stone, stone);
    b.add(G.box, lm(T, 0, 0.43, -0.1, 0, 0.74, 0.03, 0.66), MAT.darkstone, soot);
    const ceil = H.ceilLocal(it.x) + 0.25;
    b.add(G.box, lm(T, 0, 1.62, -0.05, 0, 1.24, 0.36, 1.2), MAT.stone, darker(stone, 0.95));
    b.add(G.box, lm(T, 0, (1.8 + ceil) / 2, -0.05, 0, 0.86, ceil - 1.8, 0.78), MAT.stone, darker(stone, 0.92), H.y, 3);
    b.kind = HPART.EXT;
    f.kind = HPART.FURN;
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * 0.56, 1.02, 0.52, 0, 0.1, 1.2, 0.1), MAT.wood, roomWood(ctx, 0.6));
    for (const [x, a] of [[-0.1, 0.3], [0.12, -0.25]]) f.add(G.cyl8, lm(T, x, 0.5, -0.12, a, 0.055, 0.55, 0.055, 0, Math.PI / 2), MAT.logH, [0.3, 0.2, 0.12]);
    f.add(G.cyl12, lm(T, 0.38, 0.55, 0.35, 0, 0.16, 0.24, 0.16), MAT.metal, [0.12, 0.12, 0.13]);
    // firewood stacked beside it
    for (let k = 0; k < 7; k++) f.add(G.cyl8, lm(T, 0.95 + (k % 3) * 0.13, 0.07 + Math.floor(k / 3) * 0.12, 0.1, 0, 0.06, 0.6, 0.06, Math.PI / 2), MAT.logH, darker(st.logs, 0.9 + 0.2 * ctx.rnd()));
  },
  // Ériu: an open hearth in a ring of stones, a tripod and a cauldron over it
  ringhearth(ctx, it, T) {
    const { b, f, H } = ctx;
    const r = it.r, n = Math.round(10 + r * 6);
    b.kind = HPART.SHELL;
    b.add(G.cyl16, lm(T, 0, 0.035, 0, 0, r * 0.95, 0.03, r * 0.95), MAT.darkstone, [0.14, 0.12, 0.1]);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      b.add(G.ico, lm(T, Math.sin(a) * r, 0.08, Math.cos(a) * r, a * 3, 0.15 + 0.05 * Math.sin(k * 7), 0.12, 0.17), MAT.stone, [0.47, 0.45, 0.42], H.y, 1);
    }
    b.kind = HPART.EXT;
    f.kind = HPART.FURN;
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; beam(f, T, [Math.sin(a) * r * 0.75, 0.06, Math.cos(a) * r * 0.75], [Math.sin(a) * 0.07, 0.3 + r * 0.1, Math.cos(a) * 0.07], 0.07 + r * 0.03, MAT.logH, [0.3, 0.2, 0.12]); }
    const top = 1.25 + r * 0.4, hr = r + 0.15;
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + 0.5; beam(f, T, [Math.sin(a) * hr, 0, Math.cos(a) * hr], [0, top, 0], 0.035, MAT.metal, ROOM.iron); }
    f.add(G.box, lm(T, 0, top - 0.28, 0, 0, 0.012, 0.5, 0.012), MAT.metal, ROOM.iron);
    const cr = 0.17 + r * 0.08;
    f.add(G.cyl12, lm(T, 0, top - 0.68, 0, 0, cr, 0.3, cr), MAT.metal, [0.12, 0.12, 0.13]);
    f.add(G.cyl12, lm(T, 0, top - 0.53, 0, 0, cr * 1.07, 0.04, cr * 1.07), MAT.metal, [0.16, 0.16, 0.17]);
  },
  bed(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.85);
    for (const [x, z, h] of [[-0.45, -0.93, 0.95], [0.45, -0.93, 0.95], [-0.45, 0.93, 0.62], [0.45, 0.93, 0.62]]) f.add(G.box, lm(T, x, h / 2, z, 0, 0.08, h, 0.08), MAT.wood, wood);
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * 0.45, 0.3, 0, 0, 0.06, 0.14, 1.8), MAT.wood, wood);
    f.add(G.box, lm(T, 0, 0.3, 0.93, 0, 0.84, 0.14, 0.06), MAT.wood, wood);
    f.add(G.box, lm(T, 0, 0.68, -0.93, 0, 0.84, 0.46, 0.05), MAT.wood, darker(wood, 0.92));
    f.add(G.box, lm(T, 0, 0.4, 0, 0, 0.84, 0.16, 1.82), MAT.cloth, ROOM.straw);
    f.add(G.box, lm(T, 0, 0.5, -0.68, 0, 0.56, 0.11, 0.32), MAT.cloth, ROOM.linen);
    const wool = ctx.wool;
    f.add(G.box, lm(T, 0, 0.5, 0.28, 0, 0.9, 0.06, 1.26), MAT.cloth, wool);
    f.add(G.box, lm(T, 0, 0.535, -0.32, 0, 0.9, 0.06, 0.12), MAT.cloth, darker(wool, 1.2));
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * 0.455, 0.36, 0.28, 0, 0.02, 0.3, 1.26), MAT.cloth, darker(wool, 0.9));
  },
  chest(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.9);
    f.add(G.box, lm(T, 0, 0.21, 0, 0, 0.8, 0.42, 0.45), MAT.wood, wood);
    f.add(G.box, lm(T, 0, 0.45, 0, 0, 0.84, 0.07, 0.49), MAT.wood, darker(wood, 0.85));
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * 0.28, 0.25, 0, 0, 0.05, 0.47, 0.5), MAT.metal, ROOM.iron);
    f.add(G.box, lm(T, 0, 0.36, 0.235, 0, 0.1, 0.12, 0.02), MAT.metal, [0.3, 0.27, 0.2]);
  },
  // a trestle table with benches, and supper laid
  table(ctx, it, T) {
    const { f, rnd } = ctx;
    const wood = roomWood(ctx, 0.95), len = it.len;
    f.add(G.box, lm(T, 0, 0.74, 0, 0, 0.82, 0.06, len), MAT.wood, darker(wood, 1.08));
    for (const s of [-1, 1]) {
      f.add(G.box, lm(T, 0, 0.36, s * (len / 2 - 0.2), 0, 0.62, 0.72, 0.07), MAT.wood, wood);
      f.add(G.box, lm(T, 0, 0.03, s * (len / 2 - 0.2), 0, 0.7, 0.06, 0.14), MAT.wood, darker(wood, 0.85));
    }
    f.add(G.box, lm(T, 0, 0.3, 0, 0, 0.07, 0.09, len - 0.36), MAT.wood, darker(wood, 0.85));
    const sides = it.benches === 2 ? [-1, 1] : it.benches === 1 ? [1] : it.benches === -1 ? [-1] : [];
    for (const s of sides) {
      f.add(G.box, lm(T, s * 0.62, 0.44, 0, 0, 0.3, 0.05, len - 0.1), MAT.wood, darker(wood, 1.02));
      for (const e of [-1, 1]) f.add(G.box, lm(T, s * 0.62, 0.21, e * (len / 2 - 0.22), 0, 0.24, 0.42, 0.06), MAT.wood, darker(wood, 0.85));
    }
    // bowls, a loaf, a jug, cups and a candle
    const top = 0.77;
    for (const s of [-1, 1]) {
      const z = s * len * 0.2;
      f.add(G.cyl12, lm(T, 0.18, top + 0.03, z, 0, 0.11, 0.06, 0.11), MAT.wood, darker(wood, 1.25));
      f.add(G.cyl8, lm(T, -0.2, top + 0.05, z + 0.08, 0, 0.04, 0.1, 0.04), MAT.metal, ROOM.pewter);
    }
    f.add(G.ico, lm(T, -0.05, top + 0.06, -len * 0.05, rnd(), 0.13, 0.07, 0.09), MAT.cloth, [0.66, 0.44, 0.22]);
    roomPot(f, T, 0.1, top, len * 0.06, 0.07, 0.22, ROOM.clay);
    roomCandle(ctx, T, -0.12, top, len * 0.32);
  },
  bench(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.95), len = it.len;
    f.add(G.box, lm(T, 0, 0.44, 0, 0, 0.34, 0.06, len), MAT.wood, wood);
    for (const e of [-1, 1]) f.add(G.box, lm(T, 0, 0.21, e * (len / 2 - 0.25), 0, 0.28, 0.42, 0.07), MAT.wood, darker(wood, 0.85));
  },
  shelves(ctx, it, T) {
    const { f, rnd } = ctx;
    const wood = roomWood(ctx, 0.9), len = it.len;
    for (const y of [1.28, 1.7]) {
      f.add(G.box, lm(T, 0, y, 0.15, 0, len, 0.04, 0.28), MAT.wood, wood);
      for (const s of [-1, 1]) f.add(G.box, lm(T, s * (len / 2 - 0.1), y - 0.08, 0.06, 0, 0.04, 0.14, 0.1), MAT.wood, darker(wood, 0.8));
      let x = -len / 2 + 0.1;
      while (x < len / 2 - 0.1) {
        const k = rnd();
        if (k < 0.35) { const r = 0.045 + 0.03 * rnd(), h = 0.12 + 0.12 * rnd(); roomPot(f, T, x + r, y + 0.02, 0.16, r, h, k < 0.17 ? ROOM.clay : [0.7, 0.66, 0.56]); x += r * 2 + 0.05; }
        else if (k < 0.6) { for (let p = 0; p < 4; p++) f.add(G.cyl12, lm(T, x + 0.1, y + 0.03 + p * 0.016, 0.16, 0, 0.1, 0.012, 0.1), MAT.wood, darker(wood, 1.3)); x += 0.24; }
        else if (k < 0.8) { f.add(G.cyl12, lm(T, x + 0.08, y + 0.05, 0.16, 0, 0.08, 0.07, 0.08), MAT.wood, darker(wood, 1.2)); x += 0.2; }
        else x += 0.12;
      }
    }
  },
  rug(ctx, it, T) {
    const { f } = ctx;
    if (it.fur) {
      f.add(G.ico, lm(T, 0, 0.035, 0, 0, it.sx / 2, 0.025, it.sz / 2), HMAT.fleece, [0.8, 0.76, 0.66]);
      return;
    }
    f.add(G.box, lm(T, 0, 0.042, 0, 0, it.sx, 0.016, it.sz), HMAT.rug, darker(ctx.wool, 1.05));
    for (const s of [-1, 1]) for (let k = 0; k < 9; k++) f.add(G.box, lm(T, -it.sx / 2 + (k + 0.5) * it.sx / 9, 0.04, s * (it.sz / 2 + 0.04), 0, 0.03, 0.006, 0.08), MAT.cloth, ROOM.linen);
  },
  barrels(ctx, it, T) {
    const { f, rnd } = ctx;
    const wood = roomWood(ctx, 1.0);
    roomBarrel(f, T, -0.18, -0.12, 0.85, wood, rnd() * TAU);
    roomBarrel(f, T, 0.22, 0.14, 0.78, wood, rnd() * TAU);
    roomCrate(f, T, -0.16, 0.73, -0.1, 0.4, wood, rnd());
  },
  crate(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 1.0);
    roomCrate(f, T, 0, 0, 0, 0.6, wood, 0);
    f.add(G.ico, lm(T, 0.08, 0.64, 0.02, 1, 0.16, 0.07, 0.14), MAT.cloth, [0.7, 0.6, 0.42]);
  },
  stool(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.9);
    f.add(G.cyl12, lm(T, 0, 0.42, 0, 0, 0.17, 0.05, 0.17), MAT.wood, darker(wood, 1.1));
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; beam(f, T, [Math.sin(a) * 0.1, 0.4, Math.cos(a) * 0.1], [Math.sin(a) * 0.17, 0, Math.cos(a) * 0.17], 0.035, MAT.wood, wood); }
  },
  // bunches of herbs drying head down from the beam above
  herbs(ctx, it, T) {
    const { f, H, rnd } = ctx;
    let hang;
    if (H.round) {
      // hang from the nearest rafter
      const nR = H.big ? 16 : 12, a0 = Math.atan2(it.x, it.z), k = Math.round((a0 - 0.13) / (TAU / nR)), a = k * (TAU / nR) + 0.13;
      const rad = Math.hypot(it.x, it.z);
      T = lm(ctx.M, Math.sin(a) * rad, 0, Math.cos(a) * rad, a + Math.PI / 2);
      hang = H.ceilAt(rad) - 0.14;
    } else hang = H.wallH - 0.16;
    const greens = [[0.36, 0.42, 0.2], [0.46, 0.4, 0.24], [0.5, 0.36, 0.3], [0.34, 0.36, 0.22]];
    for (let k = 0; k < it.n; k++) {
      const x = (k - (it.n - 1) / 2) * 0.24, drop = 0.18 + 0.1 * rnd();
      f.add(G.box, lm(T, x, hang - drop / 2, 0, 0, 0.008, drop, 0.008), MAT.cloth, [0.6, 0.55, 0.42]);
      f.add(G.cone8, lm(T, x, hang - drop - 0.15, 0, rnd() * 3, 0.07 + 0.03 * rnd(), 0.3, 0.07 + 0.03 * rnd()), MAT.thatch, greens[k % greens.length]);
    }
  },
  // a peg rail by the door with a cloak and a hood on it
  pegs(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.8), y = it.y;
    f.add(G.box, lm(T, 0, y, 0.02, 0, 0.5, 0.07, 0.035), MAT.wood, wood);
    for (const x of [-0.16, 0, 0.16]) f.add(G.cyl8, lm(T, x, y, 0.07, 0, 0.015, 0.08, 0.015, Math.PI / 2), MAT.wood, darker(wood, 0.9));
    f.add(G.box, lm(T, -0.16, y - 0.42, 0.07, 0, 0.3, 0.82, 0.05, 0.05), MAT.cloth, darker(ctx.wool, 0.75));
    f.add(G.ico, lm(T, 0.16, y - 0.1, 0.08, 0.4, 0.1, 0.13, 0.07), MAT.cloth, [0.44, 0.36, 0.26]);
  },
  // Ériu: a warp-weighted loom against the wall, a length of cloth half woven
  loom(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.85);
    for (const s of [-1, 1]) beam(f, T, [s * 0.6, 0, 0.32], [s * 0.6, 1.75, 0.08], 0.07, MAT.wood, wood);
    f.add(G.cyl8, lm(T, 0, 1.68, 0.1, 0, 0.05, 1.32, 0.05, 0, Math.PI / 2), MAT.wood, darker(wood, 0.9));
    f.add(G.box, lm(T, 0, 1.25, 0.16, 0, 1.08, 0.8, 0.02, -0.14), HMAT.rug, ctx.wool);
    for (let k = 0; k < 16; k++) f.add(G.box, lm(T, -0.52 + k * 0.07, 0.62, 0.27, 0, 0.004, 0.62, 0.004, -0.14), MAT.cloth, ROOM.linen);
    for (let k = 0; k < 8; k++) f.add(G.ico, lm(T, -0.5 + k * 0.143, 0.27, 0.33, k, 0.05, 0.06, 0.05), MAT.stone, [0.5, 0.48, 0.44]);
  },
  dresser(ctx, it, T) {
    const { f, rnd } = ctx;
    const wood = roomWood(ctx, 0.85);
    f.add(G.box, lm(T, 0, 0.42, 0.22, 0, 1.0, 0.84, 0.44), MAT.wood, wood);
    f.add(G.box, lm(T, 0, 0.86, 0.22, 0, 1.06, 0.05, 0.48), MAT.wood, darker(wood, 1.1));
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * 0.25, 0.45, 0.445, 0, 0.44, 0.66, 0.02), MAT.wood, darker(wood, 0.88));
    f.add(G.box, lm(T, 0, 1.4, 0.08, 0, 1.0, 0.04, 0.2), MAT.wood, wood);
    for (const s of [-1, 1]) f.add(G.box, lm(T, s * 0.48, 1.15, 0.06, 0, 0.04, 0.6, 0.16), MAT.wood, darker(wood, 0.9));
    for (let k = 0; k < 4; k++) f.add(G.cyl12, lm(T, -0.36 + k * 0.24, 1.55, 0.06, 0, 0.11, 0.012, 0.11, Math.PI / 2 - 0.2), MAT.cloth, [0.78, 0.72, 0.6]);
    for (let k = 0; k < 3; k++) roomPot(f, T, -0.3 + k * 0.3, 0.885, 0.24, 0.06 + 0.02 * rnd(), 0.18 + 0.1 * rnd(), k === 1 ? ROOM.clay : [0.66, 0.6, 0.48]);
  },
  quern(ctx, it, T) {
    const { f } = ctx;
    f.add(G.cyl16, lm(T, 0, 0.09, 0, 0, 0.28, 0.18, 0.28), MAT.stone, [0.52, 0.5, 0.47]);
    f.add(G.cyl16, lm(T, 0, 0.24, 0, 0.4, 0.26, 0.12, 0.26), MAT.stone, [0.56, 0.54, 0.5]);
    f.add(G.cyl8, lm(T, 0.17, 0.4, 0, 0, 0.022, 0.22, 0.022), MAT.wood, roomWood(ctx, 0.8));
  },
  // the chieftain's high seat
  highseat(ctx, it, T) {
    const { f } = ctx;
    const wood = roomWood(ctx, 0.7);
    f.add(G.box, lm(T, 0, 0.48, 0.1, 0, 0.9, 0.08, 0.7), MAT.wood, wood);
    f.add(G.box, lm(T, 0, 0.24, 0.1, 0, 0.84, 0.48, 0.64), MAT.wood, darker(wood, 0.85));
    f.add(G.box, lm(T, 0, 1.15, -0.22, 0, 0.9, 1.3, 0.08), MAT.wood, wood);
    for (const s of [-1, 1]) {
      f.add(G.box, lm(T, s * 0.43, 0.75, 0.1, 0, 0.08, 0.5, 0.66), MAT.wood, darker(wood, 0.9));
      f.add(G.cone8, lm(T, s * 0.4, 1.88, -0.22, 0, 0.06, 0.18, 0.06), MAT.gold, [0.75, 0.6, 0.3]);
    }
    f.add(G.box, lm(T, 0, 0.53, 0.14, 0.1, 0.8, 0.04, 0.6), HMAT.fleece, [0.82, 0.78, 0.68]);
  },
  // a painted shield hung on the wall
  shield(ctx, it, T) {
    const { f, R } = ctx;
    const y = it.y, c = R.rgb;
    f.add(G.cyl16, lm(T, 0, y, 0.035, 0, 0.36, 0.03, 0.36, Math.PI / 2), MAT.wood, darker(c, 0.85));
    f.add(G.box, lm(T, 0, y, 0.052, 0, 0.7, 0.07, 0.006), MAT.cloth, [0.85, 0.8, 0.66]);
    f.add(G.cyl16, lm(T, 0, y, 0.056, 0, 0.37, 0.02, 0.37, Math.PI / 2), MAT.metal, ROOM.iron);
    f.add(G.ico, lm(T, 0, y, 0.07, 0, 0.07, 0.07, 0.05), MAT.metal, [0.4, 0.38, 0.34]);
  },
};

/* a lantern hung from the beam over the room; it is lit at night */
function roomLamp(ctx) {
  const { f, H, M } = ctx;
  const L = H.lamp, T = lm(M, L.lx, 0, L.lz, 0);
  const top = H.round ? H.ceilAt(Math.hypot(L.lx, L.lz)) - 0.1 : H.wallH - 0.16;
  f.add(G.box, lm(T, 0, (top + L.y + 0.2) / 2, 0, 0, 0.012, top - L.y - 0.2, 0.012), MAT.metal, ROOM.iron);
  f.add(G.box, lm(T, 0, L.y, 0, 0, 0.2, 0.26, 0.2), MAT.metal, [0.2, 0.19, 0.18]);
  f.add(G.box, lm(T, 0, L.y, 0, 0, 0.16, 0.2, 0.22), MAT.window, [0.2, 0.15, 0.1]);
  f.add(G.box, lm(T, 0, L.y, 0, 0, 0.22, 0.2, 0.16), MAT.window, [0.2, 0.15, 0.1]);
  f.add(G.pyr, lm(T, 0, L.y + 0.2, 0, 0, 0.16, 0.14, 0.16), MAT.metal, [0.2, 0.19, 0.18]);
}

/* ------------------------------------------------------------------ */
/* the ruin: charred rafters fallen in, a heap of ash, stubs of posts  */
/* ------------------------------------------------------------------ */
function houseRuin(ctx) {
  const { b, H, M } = ctx;
  const rnd = mulberry(Math.floor(H.seed * 1e6) + 3301);
  const charW = [0.16, 0.12, 0.09];
  b.kind = HPART.RUIN; b.hinge = null;
  const heap = (x, z, s) => {
    for (let k = 0; k < 7; k++) b.add(G.ico, lm(M, x + (rnd() - 0.5) * s, 0.05, z + (rnd() - 0.5) * s, rnd() * 3, s * (0.35 + 0.3 * rnd()), 0.12 + 0.18 * rnd(), s * (0.35 + 0.3 * rnd())), MAT.darkstone, [0.2, 0.19, 0.18]);
  };
  if (H.round) {
    const top = H.wallH - 0.4;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + rnd() * 0.4, r0 = H.ri - 0.1, r1 = 0.4 + rnd() * 0.9;
      beam(b, M, [Math.sin(a) * r0, top - rnd() * 1.2, Math.cos(a) * r0], [Math.sin(a + 0.3) * r1, 0.1 + rnd() * 0.5, Math.cos(a + 0.3) * r1], 0.09, MAT.logH, darker(charW, 0.8 + 0.4 * rnd()), 0.12);
    }
    heap(0, 0, H.ri * 0.9);
    heap(H.ri * 0.4, -H.ri * 0.3, H.ri * 0.5);
    for (let k = 0; k < 5; k++) { const a = rnd() * TAU, rad = H.ri - 0.4; b.add(G.box, lm(M, Math.sin(a) * rad, 0.16, Math.cos(a) * rad, a, 0.5 + rnd() * 0.6, 0.12, 0.3), MAT.wood, charW); }
  } else {
    const iw = H.iw, id = H.id, Hh = H.wallH;
    // rafters still leaning from the wall plates, others fallen across the floor
    for (let k = 0; k < 6; k++) {
      const s = k % 2 ? 1 : -1, z = -id + 0.4 + (k / 5) * (2 * id - 0.8) + (rnd() - 0.5) * 0.4;
      if (k < 3) beam(b, M, [s * (iw - 0.05), Hh - 0.15, z], [s * (iw * 0.15), 0.12 + rnd() * 0.3, z + (rnd() - 0.5) * 1.2], 0.09, MAT.wood, darker(charW, 0.8 + 0.4 * rnd()), 0.13);
      else beam(b, M, [s * (iw - 0.3) * rnd(), 0.08, z], [-s * iw * 0.6 * rnd(), 0.18, z + (rnd() - 0.5) * 1.8], 0.1, MAT.wood, darker(charW, 0.8 + 0.4 * rnd()), 0.14);
    }
    beam(b, M, [-iw + 0.1, Hh - 0.2, -id * 0.48], [iw * 0.6, 0.15, -id * 0.1], 0.13, MAT.wood, charW, 0.16);
    // broken post stubs standing up from the wall tops
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const hgt = 0.3 + rnd() * 0.7;
      b.add(G.box, lm(M, sx * (H.w / 2 - 0.12), Hh + hgt / 2 - 0.05, sz * (H.d / 2 - 0.12), 0, 0.18, hgt, 0.18, 0.1 * (rnd() - 0.5), 0.1 * (rnd() - 0.5)), MAT.wood, charW);
    }
    heap(0, 0, Math.min(iw, id) * 1.1);
    heap(-iw * 0.4, id * 0.35, 0.9);
    heap(iw * 0.35, -id * 0.45, 0.8);
  }
  b.kind = HPART.EXT;
}

/* ------------------------------------------------------------------ */
/* the scaffold: poles, ledgers and planks round the walls, a ladder,  */
/* and the new roof frame going up                                     */
/* ------------------------------------------------------------------ */
function houseScaffold(ctx) {
  const { b, H, M } = ctx;
  const fresh = [0.66, 0.52, 0.34], pole = [0.56, 0.44, 0.3];
  b.kind = HPART.SCAF; b.hinge = null;
  H.scafColl = [];
  const poleAt = (lx, lz, hgt) => {
    b.add(G.cyl8, lm(M, lx, hgt / 2 - 0.1, lz, 0, 0.06, hgt + 0.2, 0.06), MAT.logH, pole, H.y, 4);
    const w = houseW(H, lx, lz);
    const c = addCircle(w.x, w.z, 0.12, 'scaffold', hgt);
    c.active = false;
    H.scafColl.push(c);
  };
  if (H.round) {
    const R = H.r + 0.75, n = H.big ? 14 : 9, hgt = H.wallH + 0.6;
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + TAU / (2 * n);
      if (Math.abs(angDiff(a, 0)) < 0.45) continue;
      pts.push([Math.sin(a) * R, Math.cos(a) * R]);
      poleAt(Math.sin(a) * R, Math.cos(a) * R, hgt);
    }
    for (let k = 0; k + 1 < pts.length; k++) for (const y of [1.4, 2.8]) beam(b, M, [pts[k][0], y, pts[k][1]], [pts[k + 1][0], y, pts[k + 1][1]], 0.05, MAT.wood, pole);
    // new rafters climbing to the crown, battens round them
    const nR = H.big ? 16 : 12, top = H.y0 + H.hc;
    for (let k = 0; k < nR; k++) {
      const a = (k / nR) * TAU + 0.13;
      beam(b, M, [Math.sin(a) * (H.Rr - 0.4), H.roofAt(H.Rr - 0.4) - 0.2, Math.cos(a) * (H.Rr - 0.4)], [0, top - 0.5, 0], 0.08, MAT.wood, fresh, 0.1);
    }
    for (const f of [0.25, 0.5]) {
      const rad = (H.Rr - 0.4) * (1 - f) + 0.2, y = H.roofAt(rad) - 0.16;
      for (let k = 0; k < nR; k++) {
        const a0 = (k / nR) * TAU + 0.13, a1 = ((k + 1) / nR) * TAU + 0.13;
        beam(b, M, [Math.sin(a0) * rad, y, Math.cos(a0) * rad], [Math.sin(a1) * rad, y, Math.cos(a1) * rad], 0.04, MAT.wood, fresh);
      }
    }
  } else {
    const w2 = H.w / 2 + 0.8, d2 = H.d / 2 + 0.8, hgt = H.wallH + 0.9;
    const xs = [-w2, -w2 / 3, w2 / 3, w2], zs = [-d2, -d2 / 3, d2 / 3, d2];
    for (const x of xs) for (const z of zs) {
      const edge = Math.abs(Math.abs(x) - w2) < 1e-3 || Math.abs(Math.abs(z) - d2) < 1e-3;
      if (!edge) continue;
      if (z > 0 && Math.abs(x) < 1.0 && Math.abs(z - d2) < 1e-3) continue; // the door stays clear
      poleAt(x, z, hgt);
    }
    for (const s of [-1, 1]) for (const y of [1.5, H.wallH - 0.1]) {
      beam(b, M, [s * w2, y, -d2], [s * w2, y, d2], 0.05, MAT.wood, pole);
      b.add(G.box, lm(M, s * (w2 - 0.3), y + 0.06, 0, 0, 0.5, 0.05, 2 * d2 - 0.2), MAT.wood, fresh);
    }
    beam(b, M, [-w2, H.wallH - 0.1, -d2], [w2, H.wallH - 0.1, -d2], 0.05, MAT.wood, pole);
    for (const s of [-1, 1]) beam(b, M, [s * w2, 0.1, -d2], [s * w2, H.wallH - 0.2, -d2 / 3], 0.04, MAT.wood, pole);
    // a ladder against the side
    for (const e of [-0.22, 0.22]) beam(b, M, [w2 + 0.5, 0, e + d2 / 3], [w2 - 0.1, H.wallH + 0.3, e + d2 / 3], 0.05, MAT.wood, fresh);
    for (let k = 1; k < 9; k++) { const t = k / 9; b.add(G.box, lm(M, w2 + 0.5 - 0.6 * t, (H.wallH + 0.3) * t, d2 / 3, 0, 0.04, 0.04, 0.44), MAT.wood, fresh); }
    // the new roof frame: rafters, ridge and battens of fresh timber
    const yTop = H.wallH + H.rh - 0.15, n = Math.max(4, Math.round(H.d / 0.75));
    for (let k = 0; k <= n; k++) {
      const z = -H.d / 2 - 0.2 + (k / n) * (H.d + 0.4);
      for (const s of [-1, 1]) beam(b, M, [s * (H.w / 2 + 0.3), H.wallH - 0.3 * H.tn, z], [0, yTop, z], 0.07, MAT.wood, fresh, 0.12);
    }
    b.add(G.box, lm(M, 0, yTop + 0.05, 0, 0, 0.14, 0.16, H.d + 0.5), MAT.wood, fresh);
    for (const s of [-1, 1]) for (const f of [0.3, 0.65]) {
      const x = s * (H.w / 2) * (1 - f), y = H.wallH + H.rh * f - 0.06;
      b.add(G.box, lm(M, x, y, 0, 0, 0.06, 0.05, H.d + 0.5), MAT.wood, fresh);
    }
    // a stack of fresh thatch bundles or shingles waiting by the wall
    for (let k = 0; k < 4; k++) b.add(G.cyl8, lm(M, -w2 - 0.6, 0.18 + (k % 2) * 0.3, -d2 / 2 + k * 0.4, 0, 0.17, 1.2, 0.17, Math.PI / 2), H.style === 'timber' ? MAT.wood : MAT.thatch, H.style === 'timber' ? fresh : [0.74, 0.62, 0.36]);
  }
  b.kind = HPART.EXT;
}
