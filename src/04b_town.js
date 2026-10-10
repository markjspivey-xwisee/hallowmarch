/* ================================================================== */
/* towns: framed houses with thick roofs, chimneys and yards            */
/* ================================================================== */
const CHIMNEYS = [];  // world points that breathe smoke
const LANTERNS = [];  // world points that glow after dark

// a square beam between two points (t across, t2 the other way)
function beam(b, M, p0, p1, t, matId, col, t2 = t, baseY = null) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-4) return;
  const yaw = Math.abs(dx) + Math.abs(dz) < 1e-6 ? 0 : Math.atan2(dx, dz), pitch = -Math.asin(clamp(dy / L, -1, 1));
  b.add(G.box, lm(M, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, yaw, t, t2, L, pitch), matId, col, baseY);
}
// a wall's own frame: +x runs along the wall (left to right seen from outside), +z points out, y up
function faceM(M, face, w, d) {
  if (face === 0) return lm(M, 0, 0, d / 2, 0);
  if (face === 1) return lm(M, w / 2, 0, 0, Math.PI / 2);
  if (face === 2) return lm(M, 0, 0, -d / 2, Math.PI);
  return lm(M, -w / 2, 0, 0, -Math.PI / 2);
}
const worldOf = (M, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);

// a gable roof with its ridge along z: thick slabs, filled gables, bargeboards, a ridge cap
function gableRoof(b, M, w, d, H, pitch, o) {
  const tn = Math.tan(pitch), cs = Math.cos(pitch), sn = Math.sin(pitch);
  const rh = (w / 2) * tn, run = w / 2 + o.ohSide, L = d + 2 * o.ohGable, th = o.thick;
  b.add(G.prism, lm(M, 0, H - 0.02, 0, Math.PI / 2, d, rh + 0.02, w), o.gableMat, o.gableCol, o.baseY, o.aoH ?? 4);
  for (const s of [1, -1]) {
    const cx = s * run / 2 - s * sn * th / 2, cy = H + rh - (run / 2) * tn - cs * th / 2;
    b.add(G.box, lm(M, cx, cy, 0, 0, run / cs + th * sn, th, L, 0, -s * pitch), o.roofMat, o.roofCol);
    // a rolled eave on thatch
    if (o.eaveRoll) b.add(G.cyl8, lm(M, s * run - s * sn * th * 0.4, H + rh - run * tn - cs * th * 0.6, 0, 0, th * 0.62, L, th * 0.62, Math.PI / 2), o.roofMat, darker(o.roofCol, 0.88));
  }
  if (o.ridge === 'round') b.add(G.cyl12, lm(M, 0, H + rh + 0.02, 0, 0, o.ridgeR || 0.22, L + 0.06, (o.ridgeR || 0.22) * 0.8, Math.PI / 2), o.roofMat, darker(o.roofCol, 0.82));
  else b.add(G.box, lm(M, 0, H + rh + th * 0.25, 0, 0, 0.3, 0.2, L + 0.04), MAT.wood, darker(o.trimCol, 0.9));
  if (o.barge !== false) {
    for (const gz of [1, -1]) {
      const z = gz * (L / 2 + 0.035);
      for (const s of [1, -1]) {
        const ex = s * (run + 0.02), ey = H + rh - (run + 0.02) * tn - th * 0.5;
        let ax = 0, ay = H + rh - th * 0.5 + 0.06;
        if (o.horns) { ax = -s * cs * 0.85; ay += sn * 0.85; }
        beam(b, M, [ax, ay, z], [ex, ey, z], 0.07, MAT.wood, o.trimCol, 0.3);
        if (o.horns) b.add(G.box, lm(M, ax - s * cs * 0.08, ay + 0.1, z, 0, 0.09, 0.32, 0.09, 0, s * 0.6), MAT.wood, o.trimCol);
      }
    }
  }
  return rh;
}
// half-timbering on one wall; openings are kept clear
function halfTimber(b, F, fw, H, st, openings, by) {
  const T = darker(st.wood, 0.5), out = 0.035;
  const yS = 0.5, yM = H * 0.5, yT = H - 0.1;
  const clear = (u, y0, y1) => !openings.some((o) => u > o.u0 - 0.14 && u < o.u1 + 0.14 && y1 > o.y0 - 0.05 && y0 < o.y1 + 0.05);
  b.add(G.box, lm(F, 0, yS, out, 0, fw + 0.14, 0.2, 0.12), MAT.wood, T, by);
  b.add(G.box, lm(F, 0, yT, out, 0, fw + 0.14, 0.2, 0.12), MAT.wood, T, by);
  for (const s of [-1, 1]) b.add(G.box, lm(F, s * (fw / 2 - 0.08), H / 2 + 0.25, out + 0.005, 0, 0.2, H - 0.5, 0.13), MAT.wood, T, by);
  // the middle rail, broken around openings
  const cuts = openings.filter((o) => o.y0 < yM && o.y1 > yM).map((o) => [o.u0 - 0.1, o.u1 + 0.1]).sort((a, c) => a[0] - c[0]);
  let u = -fw / 2 + 0.1;
  for (const [c0, c1] of [...cuts, [fw / 2 - 0.1, fw / 2 - 0.1]]) {
    if (c0 - u > 0.15) b.add(G.box, lm(F, (u + c0) / 2, yM, out, 0, c0 - u, 0.17, 0.11), MAT.wood, T, by);
    u = Math.max(u, c1);
  }
  // studs
  const n = Math.max(2, Math.round(fw / 0.85));
  for (let k = 1; k < n; k++) {
    const x = -fw / 2 + (k / n) * fw;
    if (clear(x, yS, yM)) b.add(G.box, lm(F, x, (yS + yM) / 2, out, 0, 0.15, yM - yS, 0.1), MAT.wood, T, by);
    if (clear(x, yM, yT)) b.add(G.box, lm(F, x, (yM + yT) / 2, out, 0, 0.15, yT - yM, 0.1), MAT.wood, T, by);
  }
  // corner braces
  for (const s of [-1, 1]) {
    const x0 = s * (fw / 2 - 0.2), x1 = s * (fw / 2 - 0.95);
    if (clear(x1, yM, yT) && clear(x0, yM, yT)) beam(b, F, [x0, yM + 0.1, out], [x1, yT - 0.1, out], 0.1, MAT.wood, T, 0.14, by);
    if (clear(x1, yS, yM) && clear(x0, yS, yM)) beam(b, F, [x0, yS + 0.1, out], [x1, yM - 0.1, out], 0.1, MAT.wood, T, 0.14, by);
  }
}
function gableTimber(b, F, fw, H, rh, st) {
  const T = darker(st.wood, 0.5), out = 0.035;
  b.add(G.box, lm(F, 0, H + rh * 0.42, out, 0, 0.17, rh * 0.84, 0.11), MAT.wood, T);
  for (const s of [-1, 1]) beam(b, F, [s * fw * 0.36, H + 0.08, out], [s * 0.1, H + rh * 0.62, out], 0.1, MAT.wood, T, 0.14);
  b.add(G.box, lm(F, 0, H + rh * 0.3, out, 0, fw * 0.62, 0.15, 0.1), MAT.wood, T);
}


/* ------------------------------------------------------------------ */
/* house shells: walls in two layers with real openings, doors and     */
/* shutters on hinges, glazing, roofs lined and raftered inside         */
/* ------------------------------------------------------------------ */
// The plan (openings, hinge lines, furniture) comes from planHouse in 04e_houses.js; this builds the shell from it.
// Pieces go into ctx.b (the shell), ctx.f (inside, culled when far) and ctx.g (glass), each tagged with its part.

// a wall panel along frame F from u0 to u1, y0 to y1 and n0 to n1 through the wall (n out); holes are left open
function holedWall(b, F, u0, u1, y0, y1, n0, n1, holes, matId, col, by, aoH = 3) {
  const nc = (n0 + n1) / 2, th = n1 - n0;
  const piece = (a, c, ya, yc) => { if (c - a > 0.004 && yc - ya > 0.004) b.add(G.box, lm(F, (a + c) / 2, (ya + yc) / 2, nc, 0, c - a, yc - ya, th), matId, col, by, aoH); };
  const hs = holes.filter((o) => o.u1 > u0 && o.u0 < u1 && o.y1 > y0 && o.y0 < y1).sort((p, q) => p.u0 - q.u0);
  let u = u0;
  for (const o of hs) {
    const a = Math.max(o.u0, u0), c = Math.min(o.u1, u1);
    piece(u, a, y0, y1);
    piece(a, c, y0, Math.max(y0, o.y0));
    piece(a, c, Math.min(y1, o.y1), y1);
    u = Math.max(u, c);
  }
  piece(u, u1, y0, y1);
}
// the openings in one wall: the door on the front, the windows where the plan put them
function houseHoles(H, f) {
  const out = [];
  const front = H.round ? Math.abs(angDiff(f, 0)) < 1e-3 : f === 0;
  if (front) out.push({ u0: -H.door.w / 2, u1: H.door.w / 2, y0: -1.2, y1: H.door.h, door: true });
  for (const win of H.wins) {
    const on = H.round ? Math.abs(angDiff(win.a, f)) < 1e-3 : win.face === f;
    if (on) out.push({ u0: win.u - win.w / 2, u1: win.u + win.w / 2, y0: win.y - win.h / 2, y1: win.y + win.h / 2, win });
  }
  return out;
}
// the same, grown to keep timbering clear of the frames and of shutters folded back against the wall
function houseClearings(H, f) {
  return houseHoles(H, f).map((o) => {
    const fold = o.win && o.win.leaves.length ? o.win.sw + 0.14 : 0.1;
    return { u0: o.u0 - fold, u1: o.u1 + fold, y0: o.y0 - 0.12, y1: o.y1 + 0.12 };
  });
}
const HOUSE_LIME = [0.87, 0.84, 0.76];
// house-only surfaces (the house shader draws these ids; the building shader leaves them plain)
const HMAT = { boards: 40, lime: 41, rug: 42, fleece: 43, earth: 44 };

/* a doorway: jambs through the wall, a lintel, a step; the leaf hangs on its hinge jamb and swings in */
function houseDoorFrame(ctx, F, o = {}) {
  const { b, H, st } = ctx;
  const D = H.door, dw = D.w, dh = D.h, t = H.t, by = H.y;
  const frame = o.frame || darker(st.wood, 0.55), leafCol = o.leaf || darker(st.wood, 0.75);
  b.kind = HPART.EXT; b.hinge = null;
  for (const s of [-1, 1]) {
    b.add(G.box, lm(F, s * (dw / 2 + 0.05), dh / 2, -t / 2 + 0.01, 0, 0.1, dh, t + 0.04), MAT.wood, frame, by, 2.5);
    b.add(G.box, lm(F, s * (dw / 2 + 0.11), dh / 2, 0.05, 0, 0.14, dh, 0.12), MAT.wood, darker(frame, 0.92), by, 2.5);
  }
  b.add(G.box, lm(F, 0, dh + 0.1, -t / 2 + 0.04, 0, dw + 0.44, 0.2, t + 0.16), MAT.wood, frame);
  if (o.arch) b.add(G.cyl16, lm(F, 0, dh + 0.05, 0.06, 0, dw / 2 + 0.25, 0.22, dw / 2 + 0.25, Math.PI / 2), MAT.stone, darker(st.stone, 0.9));
  b.add(G.box, lm(F, 0, 0.012, -t / 2, 0, dw + 0.02, 0.05, t + 0.02), MAT.stone, [0.5, 0.48, 0.44], by, 1);
  b.add(G.box, lm(F, 0, 0.0, 0.34, 0, dw + 0.55, 0.07, 0.56), MAT.stone, [0.55, 0.54, 0.5], by, 1);
  // the leaf: four planks, ledges and a brace inside, strap hinges and a ring pull outside
  const L = D.leaf, lw = dw - 0.03, lh = dh - 0.025, n0 = D.hingeN, hu = D.hingeU, dir = -D.hs;
  b.kind = HPART.LEAF; b.hinge = [L.hx, L.hz, L.i, L.swing];
  for (let k = 0; k < 4; k++) {
    const pu = hu + dir * (k + 0.5) * lw / 4;
    b.add(G.box, lm(F, pu, lh / 2 + 0.015, n0, 0, lw / 4 - 0.008, lh, 0.05), MAT.wood, darker(leafCol, 0.9 + 0.16 * hash1(H.num * 7 + k)), by, 2.2);
  }
  const cu = hu + dir * lw / 2;
  for (const y of [0.36, lh - 0.36]) {
    b.add(G.box, lm(F, cu, y, n0 - 0.04, 0, lw - 0.08, 0.14, 0.032), MAT.wood, darker(leafCol, 0.82));
    b.add(G.box, lm(F, hu + dir * lw * 0.34, y, n0 + 0.031, 0, lw * 0.64, 0.05, 0.012), MAT.metal, [0.19, 0.19, 0.21]);
    b.add(G.cyl8, lm(F, hu + dir * 0.03, y, n0 + 0.02, 0, 0.022, 0.12, 0.022), MAT.metal, [0.2, 0.2, 0.22]);
  }
  beam(b, F, [hu + dir * 0.1, 0.46, n0 - 0.04], [hu + dir * (lw - 0.1), lh - 0.46, n0 - 0.04], 0.03, MAT.wood, darker(leafCol, 0.82), 0.12);
  b.add(G.cyl12, lm(F, hu + dir * (lw - 0.13), lh * 0.47, n0 + 0.045, 0, 0.055, 0.012, 0.055, Math.PI / 2), MAT.metal, [0.34, 0.3, 0.24]);
  b.add(G.box, lm(F, hu + dir * (lw - 0.13), lh * 0.47 + 0.05, n0 + 0.035, 0, 0.03, 0.05, 0.02), MAT.metal, [0.25, 0.24, 0.24]);
  b.add(G.box, lm(F, hu + dir * (lw - 0.2), lh * 0.5, n0 - 0.045, 0, 0.22, 0.035, 0.02), MAT.metal, [0.22, 0.22, 0.24]);
  b.hinge = null; b.kind = HPART.EXT;
}

/* a window: a hole lined through the wall, a sill, glass in a light casement or left open, and shutters outside */
function houseWindow(ctx, F, win, o = {}) {
  const { b, g, H, st } = ctx;
  const t = H.t, u = win.u, y = win.y, ww = win.w, wh = win.h;
  const frame = o.frame || darker(st.wood, 0.6);
  const y0 = y - wh / 2, y1 = y + wh / 2;
  b.kind = HPART.EXT; b.hinge = null;
  for (const s of [-1, 1]) b.add(G.box, lm(F, u + s * (ww / 2 + 0.03), y, -t / 2, 0, 0.06, wh + 0.14, t + 0.03), MAT.wood, frame);
  b.add(G.box, lm(F, u, y1 + 0.04, -t / 2, 0, ww + 0.12, 0.08, t + 0.03), MAT.wood, frame);
  b.add(G.box, lm(F, u, y0 - 0.035, -t / 2 + 0.03, 0, ww + 0.22, 0.07, t + 0.15), MAT.wood, darker(frame, 1.12));
  if (o.trim) b.add(G.box, lm(F, u, y1 + 0.13, 0.035, 0, ww + 0.34, 0.12, 0.08), MAT.wood, frame);
  if (o.arch) b.add(G.box, lm(F, u, y1 + 0.06, 0.02, 0, ww * 0.62, ww * 0.62, 0.1, 0, Math.PI / 4), MAT.stone, darker(st.stone, 0.85));
  if (win.glazed) {
    // the casement: a light frame, the panes, and lead cames or wooden glazing bars
    b.kind = HPART.LEAF;
    const zc = -t * 0.42;
    for (const s of [-1, 1]) b.add(G.box, lm(F, u + s * (ww / 2 - 0.022), y, zc, 0, 0.045, wh, 0.05), MAT.wood, frame);
    for (const s of [-1, 1]) b.add(G.box, lm(F, u, y + s * (wh / 2 - 0.022), zc, 0, ww, 0.045, 0.05), MAT.wood, frame);
    if (o.lead) houseLattice(b, F, u, y, ww - 0.08, wh - 0.08, zc, o.diamond || 0.13);
    else {
      b.add(G.box, lm(F, u, y, zc, 0, 0.032, wh - 0.06, 0.042), MAT.wood, frame);
      b.add(G.box, lm(F, u, y, zc, 0, ww - 0.06, 0.032, 0.042), MAT.wood, frame);
    }
    g.kind = HPART.LEAF; g.hinge = null;
    g.add(HG.plane, lm(F, u, y, zc - 0.004, 0, ww - 0.05, wh - 0.05, 1), MAT.window, [1, 1, 1]);
  }
  if (win.leaves.length) {
    const sc = o.shutterCol || darker(st.wood, 0.8);
    b.kind = HPART.LEAF;
    for (const L of win.leaves) {
      b.hinge = [L.hx, L.hz, L.i, L.swing];
      const sw = win.sw, zs = win.zs, d = -L.side, cu = L.hu + d * sw / 2;
      for (let k = 0; k < 2; k++) b.add(G.box, lm(F, L.hu + d * (k + 0.5) * sw / 2, y, zs, 0, sw / 2 - 0.007, wh, 0.04), MAT.wood, darker(sc, 0.93 + 0.12 * k));
      for (const yy of [y0 + 0.11, y1 - 0.11]) {
        b.add(G.box, lm(F, cu, yy, zs - 0.03, 0, sw - 0.05, 0.07, 0.022), MAT.wood, darker(sc, 0.78));
        b.add(G.box, lm(F, L.hu + d * sw * 0.32, yy, zs + 0.024, 0, sw * 0.6, 0.038, 0.01), MAT.metal, [0.19, 0.19, 0.21]);
      }
      if (o.cut) b.add(G.box, lm(F, cu, y + wh * 0.18, zs + 0.021, 0, sw * 0.22, wh * 0.16, 0.004), MAT.darkstone, [0.05, 0.04, 0.035]);
    }
    b.hinge = null; b.kind = HPART.EXT;
  }
  // the board inside the window
  b.kind = HPART.SHELL;
  b.add(G.box, lm(F, u, y0 - 0.05, -t - 0.05, 0, ww + 0.24, 0.045, 0.13), MAT.wood, darker(frame, 1.25));
  b.kind = HPART.EXT;
  if (o.box) {
    // a flower box under the sill
    b.add(G.box, lm(F, u, y0 - 0.2, 0.19, 0, ww + 0.1, 0.18, 0.2), MAT.wood, frame);
    for (let k = 0; k < 5; k++) b.add(G.ico, lm(F, u + (k - 2) * ww * 0.21, y0 - 0.06, 0.2, k, 0.09, 0.07, 0.08), MAT.cloth, k % 2 ? [0.75, 0.2, 0.25] : [0.25, 0.5, 0.2]);
  }
}
// lead cames in a diamond lattice, clipped to the pane
function houseLattice(b, F, u, y, w, h, z, dx) {
  const slope = 1.55, lead = [0.16, 0.16, 0.17];
  for (const sg of [-1, 1]) {
    const reach = w / 2 + h / (2 * slope) + dx;
    for (let pk = -reach; pk <= reach + 1e-6; pk += dx) {
      // q = sg * slope * (p - pk), kept inside |p| <= w/2, |q| <= h/2
      let pa = pk - h / (2 * slope), pb = pk + h / (2 * slope);
      pa = Math.max(pa, -w / 2); pb = Math.min(pb, w / 2);
      if (pb - pa < 0.02) continue;
      const qa = sg * slope * (pa - pk), qb = sg * slope * (pb - pk);
      beam(b, F, [u + pa, y + qa, z], [u + pb, y + qb, z], 0.011, MAT.metal, lead, 0.016);
    }
  }
}

/* a gable roof for a house: the slabs and gables outside, boards, rafters and tie beams inside */
function houseGableRoof(ctx, o) {
  const { b, f: fb, H, M } = ctx;
  const w = H.w, d = H.d, Hh = H.wallH, tn = H.tn, cs = H.cs, sn = H.sn, pitch = H.pitch;
  const rh = H.rh, run = w / 2 + H.ohSide, L = d + 2 * H.ohGable, th = H.roofTh, by = H.y;
  b.kind = HPART.ROOF; b.hinge = null;
  // the gables fall with the roof: an outer skin over each end wall
  for (const gz of [1, -1]) b.add(G.prism, lm(M, 0, Hh - 0.02, gz * (d / 2 - H.t * 0.3), Math.PI / 2, H.t * 0.6, rh - 0.07, w), o.gableMat, o.gableCol, by, 4);
  for (const s of [1, -1]) {
    const cx = s * run / 2 - s * sn * th / 2, cy = Hh + rh - (run / 2) * tn - cs * th / 2;
    b.add(G.box, lm(M, cx, cy, 0, 0, run / cs + th * sn, th, L, 0, -s * pitch), o.roofMat, o.roofCol);
    if (o.eaveRoll) b.add(G.cyl8, lm(M, s * run - s * sn * th * 0.4, Hh + rh - run * tn - cs * th * 0.6, 0, 0, th * 0.62, L, th * 0.62, Math.PI / 2), o.roofMat, darker(o.roofCol, 0.88));
  }
  if (o.ridge === 'round') b.add(G.cyl12, lm(M, 0, Hh + rh + 0.02, 0, 0, o.ridgeR || 0.22, L + 0.06, (o.ridgeR || 0.22) * 0.8, Math.PI / 2), o.roofMat, darker(o.roofCol, 0.82));
  else b.add(G.box, lm(M, 0, Hh + rh + th * 0.25, 0, 0, 0.3, 0.2, L + 0.04), MAT.wood, darker(o.trimCol, 0.9));
  for (const gz of [1, -1]) {
    const z = gz * (L / 2 + 0.035);
    for (const s of [1, -1]) {
      const ex = s * (run + 0.02), ey = Hh + rh - (run + 0.02) * tn - th * 0.5;
      let ax = 0, ay = Hh + rh - th * 0.5 + 0.06;
      if (o.horns) { ax = -s * cs * 0.85; ay += sn * 0.85; }
      beam(b, M, [ax, ay, z], [ex, ey, z], 0.07, MAT.wood, o.trimCol, 0.3);
      if (o.horns) b.add(G.box, lm(M, ax - s * cs * 0.08, ay + 0.1, z, 0, 0.09, 0.32, 0.09, 0, s * 0.6), MAT.wood, o.trimCol);
    }
  }
  // inside: boards under the covering, rafters, a ridge beam, wall plates, tie beams and the inner gables
  fb.kind = HPART.ROOFIN; fb.hinge = null;
  const iw = H.iw, id = H.id, timber = darker(o.trimCol, 1.15);
  const yU = (x) => Hh + rh - Math.abs(x) * tn - th / cs;
  for (const s of [1, -1]) {
    const x0 = s * 0.02, x1 = s * (iw + 0.06);
    const xm = (x0 + x1) / 2, ym = (yU(x0) + yU(x1)) / 2 - 0.026 / cs;
    fb.add(G.box, lm(M, xm, ym, 0, 0, Math.abs(x1 - x0) / cs, 0.04, 2 * id + 0.12, 0, -s * pitch), o.liningMat, o.liningCol, by, 4);
    const nR = Math.max(4, Math.round((2 * id) / 0.78));
    for (let k = 0; k <= nR; k++) {
      const z = -id + 0.1 + (k / nR) * (2 * id - 0.2);
      beam(fb, M, [s * (iw - 0.02), yU(iw) - 0.11, z], [s * 0.07, yU(0.07) - 0.11, z], 0.075, MAT.wood, timber, 0.12);
    }
    // a purlin halfway up each slope
    fb.add(G.box, lm(M, s * iw * 0.5, yU(iw * 0.5) - 0.2, 0, 0, 0.12, 0.14, 2 * id), MAT.wood, darker(timber, 0.95));
  }
  fb.add(G.box, lm(M, 0, yU(0) - 0.12, 0, 0, 0.15, 0.17, 2 * id + 0.1), MAT.wood, darker(timber, 0.95));
  for (const s of [-1, 1]) fb.add(G.box, lm(M, s * (iw - 0.05), Hh - 0.08, 0, 0, 0.13, 0.15, 2 * id), MAT.wood, timber);
  for (const z of [-id * 0.48, id * 0.48]) fb.add(G.box, lm(M, 0, Hh - 0.08, z, 0, 2 * iw + 0.06, 0.16, 0.14), MAT.wood, timber);
  for (const gz of [1, -1]) fb.add(G.prism, lm(M, 0, Hh - 0.02, gz * (id + 0.03), Math.PI / 2, 0.06, (iw + 0.06) * tn + 0.05, 2 * iw + 0.12), o.innerGableMat, o.innerGableCol, by, 5);
  b.kind = HPART.EXT;
}
// a stone chimney stack with a cap and a pot; its smoke comes from the hearth below
function houseStack(ctx, lx, lz, y0, top, w = 0.86, d = 0.7) {
  const { b, H, M, st } = ctx;
  b.kind = HPART.EXT; b.hinge = null;
  b.add(G.box, lm(M, lx, (y0 + top) / 2, lz, 0, w, top - y0, d), MAT.stone, darker(st.stone, 0.88), H.y, 5);
  b.add(G.box, lm(M, lx, top + 0.07, lz, 0, w + 0.14, 0.14, d + 0.14), MAT.stone, darker(st.stone, 0.75));
  b.add(G.cyl8, lm(M, lx, top + 0.32, lz, 0, 0.13, 0.36, 0.13), MAT.stone, [0.48, 0.33, 0.26]);
  H.smoke = worldOf(M, lx, top + 0.55, lz);
  CHIMNEYS.push(H.smoke);
}
// the floor: boards laid along the house (or packed earth)
function houseFloor(ctx, matId, col) {
  const { b, H, M } = ctx;
  b.kind = HPART.SHELL; b.hinge = null;
  if (H.round) b.add(G.cyl16, lm(M, 0, -0.03, 0, Math.PI / 16, H.ri + 0.06, 0.12, H.ri + 0.06), matId, col, H.y, 1);
  else b.add(G.box, lm(M, 0, -0.03, 0, 0, 2 * H.iw + 0.06, 0.12, 2 * H.id + 0.06), matId, col, H.y, 1);
}

function houseShell(ctx) {
  if (ctx.H.round) shellEriu(ctx);
  else if (ctx.H.style === 'timber') shellThule(ctx);
  else shellLogres(ctx);
}

/* Logres: a stone footing, plaster on a timber frame, a thatched gable roof; a fireplace and stack on the back gable */
function shellLogres(ctx) {
  const { b, H, M, st, R } = ctx;
  const big = H.big, w = H.w, d = H.d, Hh = H.wallH, t = H.t, by = H.y;
  const faces = [0, 1, 2, 3].map((f) => faceM(M, f, w, d));
  const holes = [0, 1, 2, 3].map((f) => houseHoles(H, f));
  const skinMat = big ? MAT.stone : MAT.plaster, skinCol = big ? st.stone : st.plaster;
  for (let f = 0; f < 4; f++) {
    const side = f % 2 === 1, Lw = side ? d : w;
    b.kind = HPART.EXT;
    const fe = side ? Lw / 2 - t * 0.6 : Lw / 2 + 0.17;
    holedWall(b, faces[f], -fe, fe, -0.9, 0.5, -t * 0.6, 0.17, holes[f], MAT.stone, darker(st.stone, 0.9), by, 2);
    const se = side ? Lw / 2 - t * 0.6 : Lw / 2;
    holedWall(b, faces[f], -se, se, 0.5, Hh, -t * 0.6, 0, holes[f], skinMat, skinCol, by, 3);
    b.kind = HPART.SHELL;
    const le = side ? H.id : Lw / 2 - t * 0.6;
    holedWall(b, faces[f], -le, le, 0, side ? Hh + 0.18 : Hh, -t, -t * 0.6, holes[f], HMAT.lime, HOUSE_LIME, by, 3);
  }
  houseFloor(ctx, HMAT.boards, darker(st.wood, 1.25));
  houseGableRoof(ctx, big
    ? { roofMat: MAT.slate, roofCol: st.roof, gableMat: MAT.stone, gableCol: st.stone, trimCol: darker(st.wood, 0.6), liningMat: HMAT.boards, liningCol: darker(st.wood, 1.1), innerGableMat: HMAT.lime, innerGableCol: HOUSE_LIME }
    : { roofMat: MAT.thatch, roofCol: st.thatch, gableMat: MAT.plaster, gableCol: st.plaster, trimCol: darker(st.wood, 0.6), ridge: 'round', ridgeR: 0.24, eaveRoll: true, liningMat: MAT.thatch, liningCol: darker(st.thatch, 0.62), innerGableMat: HMAT.lime, innerGableCol: HOUSE_LIME });
  houseDoorFrame(ctx, faces[0], { arch: big });
  const shutter = darker(R.rgb, 0.62);
  for (const win of H.wins) houseWindow(ctx, faces[win.face], win, { shutterCol: shutter, box: !big && fhash(H.seed * 31 + win.k * 7) > 0.4, arch: big, lead: true, trim: !big, cut: true });
  if (!big) {
    b.kind = HPART.EXT;
    for (let f = 0; f < 4; f++) halfTimber(b, faces[f], f % 2 ? d : w, Hh, st, houseClearings(H, f), by);
    b.kind = HPART.ROOF;
    gableTimber(b, faces[0], w, Hh, H.rh, st);
    gableTimber(b, faces[2], w, Hh, H.rh, st);
  } else {
    b.kind = HPART.EXT;
    for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) {
      const z = k * d * 0.33;
      b.add(G.box, lm(M, s * (w / 2 + 0.3), Hh * 0.42, z, 0, 0.6, Hh * 0.84 + 0.6, 0.7), MAT.stone, darker(st.stone, 0.95), by, 4);
      b.add(G.box, lm(M, s * (w / 2 + 0.16), Hh * 0.86, z, 0, 0.4, 0.7, 0.66, 0, s * 0.5), MAT.stone, darker(st.stone, 0.9));
    }
  }
  // the chimney stack rises through the back gable from the fireplace inside
  houseStack(ctx, 0, -d / 2 + 0.24, Hh - 0.4, Hh + H.rh + 0.85, 0.92, 0.72);
  b.kind = HPART.EXT;
}

/* Thule: a log house on a stone footing, the logs notched at the corners and cut round the openings */
function shellThule(ctx) {
  const { b, H, M, st } = ctx;
  const big = H.big, w = H.w, d = H.d, Hh = H.wallH, t = H.t, by = H.y;
  const faces = [0, 1, 2, 3].map((f) => faceM(M, f, w, d));
  const holes = [0, 1, 2, 3].map((f) => houseHoles(H, f));
  const logCol = st.logs, endCol = [0.62, 0.5, 0.34];
  b.kind = HPART.EXT;
  for (let f = 0; f < 4; f++) {
    const side = f % 2 === 1, Lw = side ? d : w;
    const fe = side ? Lw / 2 - t * 0.7 : Lw / 2 + 0.25;
    holedWall(b, faces[f], -fe, fe, -0.95, 0.4, -t * 0.7, 0.25, holes[f], MAT.stone, darker(st.stone, 0.85), by, 2);
  }
  const r = big ? 0.2 : 0.17, step = r * 1.86;
  let k = 0;
  for (let y = 0.4 + r; y < Hh - r * 0.3; y += step * 0.5, k++) {
    const alongX = k % 2 === 0;
    for (const s of [1, -1]) {
      const f = alongX ? (s > 0 ? 0 : 2) : (s > 0 ? 1 : 3);
      const Lh = ((alongX ? w : d) + 0.6) / 2;
      const cuts = holes[f].filter((o) => o.y0 < y + r * 0.8 && o.y1 > y - r * 0.8).sort((p, q) => p.u0 - q.u0);
      const segs = [];
      let u = -Lh;
      for (const o of cuts) { if (o.u0 > u) segs.push([u, o.u0]); u = Math.max(u, o.u1); }
      if (u < Lh) segs.push([u, Lh]);
      const col = darker(logCol, 0.92 + 0.16 * fhash(k * 7 + s));
      for (const [a, c] of segs) {
        if (c - a < 0.05) continue;
        b.add(G.cyl8, lm(faces[f], (a + c) / 2, y, -r * 0.6, 0, r, c - a, r * 0.94, 0, Math.PI / 2), MAT.logH, col, by, 4);
        for (const e of [a, c]) b.add(G.cyl8, lm(faces[f], e, y, -r * 0.6, 0, r * 0.86, 0.03, r * 0.82, 0, Math.PI / 2), MAT.wood, endCol);
      }
    }
  }
  for (let f = 0; f < 4; f++) {
    const side = f % 2 === 1, Lw = side ? d : w;
    b.kind = HPART.SHELL;
    const le = side ? H.id : Lw / 2 - t * 0.6;
    holedWall(b, faces[f], -le, le, 0, side ? Hh + 0.2 : Hh, -t, -t + 0.07, holes[f], HMAT.boards, darker(st.wood, 1.3), by, 3);
  }
  houseFloor(ctx, HMAT.boards, darker(st.wood, 1.18));
  houseGableRoof(ctx, { roofMat: MAT.shingle, roofCol: st.roof, gableMat: MAT.wood, gableCol: darker(st.wood, 0.85), trimCol: darker(st.wood, 0.75), horns: true, liningMat: HMAT.boards, liningCol: darker(st.wood, 1.05), innerGableMat: HMAT.boards, innerGableCol: darker(st.wood, 1.25) });
  houseDoorFrame(ctx, faces[0], { frame: darker(st.wood, 0.5), leaf: darker(st.wood, 0.6) });
  if (big) {
    // a carved porch over the door
    b.kind = HPART.EXT;
    for (const s of [-1, 1]) b.add(G.cyl8, lm(M, s * 1.3, 1.45, d / 2 + 1.1, 0, 0.13, 2.9, 0.13), MAT.logH, logCol, by, 3);
    b.kind = HPART.ROOF;
    gableRoof(b, lm(M, 0, 0, d / 2 + 0.75), 3.1, 1.4, 2.9, 0.85, { ohSide: 0.15, ohGable: 0.1, thick: 0.14, roofMat: MAT.shingle, roofCol: st.roof, gableMat: MAT.wood, gableCol: darker(st.wood, 0.85), trimCol: darker(st.wood, 0.75), horns: true });
  }
  const shutter = darker([0.32, 0.38, 0.46], 0.9);
  for (const win of H.wins) houseWindow(ctx, faces[win.face], win, { shutterCol: shutter, frame: darker(st.wood, 0.55) });
  // the stove's stack comes up through the roof
  const sx = -w * 0.2, sz = -d * 0.18;
  houseStack(ctx, sx, sz, Hh + H.rh - Math.abs(sx) * H.tn - 0.8, Hh + H.rh + 0.5, 0.74, 0.66);
  b.kind = HPART.EXT;
}

/* Ériu: a roundhouse of wattle and daub on a stone ring, under a steep thatch that comes down low */
function shellEriu(ctx) {
  const { b, f: fb, H, M, st } = ctx;
  const big = H.big, r = H.r, N = H.N, fa = TAU / N, t = H.t, by = H.y;
  const skinTop = H.wallH, liningTop = H.ceilAt(H.ri) + 0.1;
  const facet = (a, rad) => lm(M, Math.sin(a) * rad, 0, Math.cos(a) * rad, a);
  const blocked = new Set();
  for (let i = 0; i < N; i++) {
    const a = i * fa, F = facet(a, r);
    const holes = houseHoles(H, a);
    if (holes.length) { blocked.add(i); blocked.add((i + 1) % N); }
    const half = r * Math.tan(fa / 2) + 0.012, ih = (r - t) * Math.tan(fa / 2) + 0.012;
    b.kind = HPART.EXT;
    holedWall(b, F, -half - 0.05, half + 0.05, -0.9, 0.35, -t * 0.6, 0.16, holes, MAT.stone, darker(st.stone, 0.92), by, 2);
    holedWall(b, F, -half, half, 0.35, skinTop, -t * 0.6, 0, holes, MAT.plaster, st.plaster, by, 3);
    // a woven band under the eaves
    b.add(G.box, lm(F, 0, H.H0 - 0.18, 0.035, 0, half * 2 + 0.03, 0.3, 0.07), MAT.wood, darker(st.wood, 0.8));
    b.kind = HPART.SHELL;
    holedWall(b, F, -ih, ih, 0, liningTop, -t, -t * 0.6, holes, HMAT.lime, [0.84, 0.79, 0.68], by, 3);
  }
  // posts at the corners of the facets, clear of the door and the windows' shutters
  b.kind = HPART.EXT;
  for (let i = 0; i < N; i++) {
    if (blocked.has(i)) continue;
    const a = (i - 0.5) * fa, rr = r / Math.cos(fa / 2) + 0.03;
    b.add(G.cyl8, lm(M, Math.sin(a) * rr, H.H0 / 2 + 0.1, Math.cos(a) * rr, 0, 0.09, H.H0 - 0.2, 0.09), MAT.wood, darker(st.wood, 0.65), by, 3);
  }
  houseFloor(ctx, HMAT.earth, [0.44, 0.36, 0.27]);
  // the thatch: a steep cone with a thick lip and stepped courses
  b.kind = HPART.ROOF;
  const Rr = H.Rr, hc = H.hc, y0 = H.y0;
  b.add(G.frustum16, lm(M, 0, y0 - 0.17, 0, 0, Rr, 0.36, Rr), MAT.thatch, darker(st.thatch, 0.85));
  b.add(G.cone16, lm(M, 0, y0 + hc / 2, 0, 0.1, Rr * 0.985, hc, Rr * 0.985), MAT.thatch, st.thatch);
  for (const tt of [0.34, 0.62]) {
    const rr = Rr * (1 - tt) + 0.07;
    b.add(G.frustum16, lm(M, 0, y0 + hc * tt - 0.1, 0, tt * 3, rr, 0.24, rr), MAT.thatch, darker(st.thatch, 0.9));
  }
  if (big) {
    b.add(G.cyl16, lm(M, 0, y0 + hc * 0.55 + 0.6, 0, 0, Rr * 0.38, 1.2, Rr * 0.38), MAT.plaster, darker(st.plaster, 0.9));
    b.add(G.cone16, lm(M, 0, y0 + hc * 0.55 + 1.2 + Rr * 0.3, 0, 0.3, Rr * 0.55, Rr * 0.6, Rr * 0.55), MAT.thatch, st.thatch);
  }
  const apex = y0 + hc + (big ? 0.6 : 0);
  b.add(G.cone8, lm(M, 0, apex - 0.2, 0, 0, 0.3, 0.55, 0.3), MAT.thatch, darker(st.thatch, 0.7));
  b.add(G.cyl8, lm(M, 0, apex + 0.25, 0, 0, 0.05, 0.7, 0.05), MAT.wood, darker(st.wood, 0.6));
  H.smoke = worldOf(M, 0, apex - 0.1, 0);
  CHIMNEYS.push(H.smoke);
  // inside: the underside of the thatch, rafters running up to the crown, and a wall plate round the top
  fb.kind = HPART.ROOFIN; fb.hinge = null;
  houseConeIn(fb, M, H.ri + 0.04, H.ceilAt(H.ri + 0.04), 0.22, H.ceilAt(0.22), MAT.thatch, darker(st.thatch, 0.55), by);
  const nR = big ? 16 : 12;
  for (let k = 0; k < nR; k++) {
    const a = (k / nR) * TAU + 0.13, r0 = H.ri - 0.03, r1 = 0.3;
    beam(fb, M, [Math.sin(a) * r0, H.ceilAt(r0) - 0.1, Math.cos(a) * r0], [Math.sin(a) * r1, H.ceilAt(r1) - 0.1, Math.cos(a) * r1], 0.11, MAT.wood, darker(st.wood, 1.05), 0.14);
  }
  for (let i = 0; i < N; i++) {
    const F = facet(i * fa, r);
    fb.add(G.box, lm(F, 0, liningTop - 0.16, -t - 0.06, 0, (r - t) * Math.tan(fa / 2) * 2 + 0.04, 0.14, 0.12), MAT.wood, darker(st.wood, 0.85));
  }
  for (const rr of [H.ri * 0.62, H.ri * 0.3]) {
    for (let k = 0; k < nR; k++) {
      const a0 = (k / nR) * TAU + 0.13, a1 = ((k + 1) / nR) * TAU + 0.13, y = H.ceilAt(rr) - 0.2;
      beam(fb, M, [Math.sin(a0) * rr, y, Math.cos(a0) * rr], [Math.sin(a1) * rr, y, Math.cos(a1) * rr], 0.07, MAT.wood, darker(st.wood, 0.95), 0.09);
    }
  }
  // the door in the front facet, under a little gabled porch
  const F0 = facet(0, r);
  houseDoorFrame(ctx, F0, { leaf: darker([0.36, 0.42, 0.26], 1.0) });
  b.kind = HPART.EXT;
  for (const s of [-1, 1]) b.add(G.cyl8, lm(M, s * 0.85, 1.25, r + 1.05, 0, 0.09, 2.5, 0.09), MAT.wood, darker(st.wood, 0.7), by, 3);
  b.kind = HPART.ROOF;
  gableRoof(b, lm(M, 0, 0, r + 0.55), 2.2, 1.35, 2.45, 0.8, { ohSide: 0.18, ohGable: 0.12, thick: 0.26, roofMat: MAT.thatch, roofCol: st.thatch, gableMat: MAT.plaster, gableCol: st.plaster, trimCol: darker(st.wood, 0.6), ridge: 'round', ridgeR: 0.13 });
  for (const win of H.wins) houseWindow(ctx, facet(win.a, r), win, { shutterCol: darker([0.3, 0.42, 0.26], 0.9), frame: darker(st.wood, 0.6) });
  b.kind = HPART.EXT;
}
// the inside of a cone (normals in, faces turned to be seen from below)
const _coneIn = new Map();
function houseConeIn(b, M, r0, y0, r1, y1, matId, col, by) {
  const key = 'c';
  let g = _coneIn.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    g = g.toNonIndexed();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i += 3) {
      for (const a of ['X', 'Y', 'Z']) { const v = p['get' + a](i + 1); p['set' + a](i + 1, p['get' + a](i + 2)); p['set' + a](i + 2, v); const m = n['get' + a](i + 1); n['set' + a](i + 1, n['get' + a](i + 2)); n['set' + a](i + 2, m); }
    }
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    _coneIn.set(key, g);
  }
  // a unit open cylinder (radius 1 at both ends, height 1) bent into the frustum by moving its rings
  const gg = g.clone(), p = gg.attributes.position, n = gg.attributes.normal;
  const slope = (r0 - r1) / Math.max(1e-3, y1 - y0);
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0, rad = top ? r1 : r0, y = top ? y1 : y0;
    const len = Math.hypot(p.getX(i), p.getZ(i)) || 1, ux = p.getX(i) / len, uz = p.getZ(i) / len;
    p.setXYZ(i, ux * rad, y, uz * rad);
    // inward and downward
    const nl = Math.hypot(1, slope);
    n.setXYZ(i, -ux / nl, -slope / nl, -uz / nl);
  }
  b.add(gg, M, matId, col, by, 6);
}

/* --- yards and street furniture --- */
function propModel(b, p, st, R) {
  const by = heightAt(p.x, p.z);
  const M = new THREE.Matrix4().compose(new THREE.Vector3(p.x, by, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0)), new THREE.Vector3(1, 1, 1));
  const wood = st.wood, dark = darker(st.wood, 0.6), iron = [0.22, 0.22, 0.24], rnd = mulberry(Math.floor(p.seed * 1e6));
  const barrel = (x, z, s = 1, tilt = 0) => {
    const B = lm(M, x, 0, z, rnd() * TAU, 1, 1, 1, tilt);
    b.add(G.cyl12, lm(B, 0, 0.42 * s, 0, 0, 0.3 * s, 0.84 * s, 0.3 * s), MAT.wood, darker(wood, 0.95), by, 1);
    b.add(G.cyl12, lm(B, 0, 0.42 * s, 0, 0, 0.335 * s, 0.4 * s, 0.335 * s), MAT.wood, darker(wood, 1.05), by, 1);
    for (const y of [0.1, 0.32, 0.52, 0.74]) b.add(G.cyl12, lm(B, 0, y * s, 0, 0, (y > 0.2 && y < 0.6 ? 0.34 : 0.315) * s, 0.04 * s, (y > 0.2 && y < 0.6 ? 0.34 : 0.315) * s), MAT.metal, iron);
    b.add(G.cyl12, lm(B, 0, 0.845 * s, 0, 0, 0.27 * s, 0.02, 0.27 * s), MAT.wood, darker(wood, 0.7));
  };
  const crate = (x, y, z, s = 0.7) => {
    const C = lm(M, x, y + s / 2, z, rnd() * 0.6 - 0.3);
    b.add(G.box, lm(C, 0, 0, 0, 0, s, s, s), MAT.wood, darker(wood, 1.1), by, 1);
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.add(G.box, lm(C, ax * s * 0.47, 0, az * s * 0.47, 0, s * 0.1, s * 1.02, s * 0.1), MAT.wood, dark);
    for (const sy of [1, -1]) b.add(G.box, lm(C, 0, sy * s * 0.47, 0, 0, s * 1.02, s * 0.08, s * 1.02), MAT.wood, dark);
  };
  switch (p.type) {
    case 'barrels': {
      const n = p.n || 2;
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rnd(); barrel(Math.cos(a) * 0.4, Math.sin(a) * 0.4); }
      crate(0.55, 0, -0.55, 0.62);
      if (rnd() < 0.5) crate(0.5, 0.62, -0.5, 0.48);
      break;
    }
    case 'woodpile': {
      const len = p.len || 2.2;
      b.add(G.box, lm(M, 0, 0.06, 0, 0, 0.9, 0.12, len + 0.2), MAT.wood, dark, by, 1);
      for (let row = 0; row < 4; row++) {
        const n = 5 - row;
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * 0.19, y = 0.2 + row * 0.165;
          // every log lies along the pile (a random yaw here once turned some of them through the house wall)
          b.add(G.cyl8, lm(M, x, y, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.05, 0.09, len * (0.94 + rnd() * 0.06), 0.09, Math.PI / 2), MAT.logH, darker(st.logs, 0.85 + rnd() * 0.3), by, 1.2);
          for (const e of [1, -1]) b.add(G.cyl8, lm(M, x, y, e * len * 0.47, 0, 0.08, 0.02, 0.08, Math.PI / 2), MAT.wood, [0.66, 0.53, 0.36]);
        }
      }
      for (const e of [1, -1]) b.add(G.box, lm(M, 0, 0.45, e * (len / 2 + 0.08), 0, 1.0, 0.9, 0.1), MAT.wood, dark);
      break;
    }
    case 'well': {
      b.add(G.cyl16, lm(M, 0, 0.35, 0, 0, 1.0, 0.9, 1.0), MAT.stone, darker(st.stone, 0.95), by, 1.2);
      b.add(G.cyl16, lm(M, 0, 0.83, 0, 0, 1.06, 0.12, 1.06), MAT.stone, darker(st.stone, 1.08));
      b.add(G.cyl16, lm(M, 0, 0.6, 0, 0, 0.78, 0.5, 0.78), MAT.water, [0.1, 0.16, 0.2]);
      for (const s of [-1, 1]) b.add(G.box, lm(M, s * 0.92, 1.4, 0, 0, 0.16, 2.0, 0.16), MAT.wood, dark, by, 2);
      b.add(G.cyl8, lm(M, 0, 1.95, 0, 0, 0.07, 1.9, 0.07, 0, Math.PI / 2), MAT.wood, dark);
      b.add(G.cyl8, lm(M, 0, 1.45, 0, 0, 0.015, 0.95, 0.015), MAT.cloth, [0.6, 0.52, 0.38]);
      b.add(G.cyl8, lm(M, 0, 0.92, 0, 0, 0.13, 0.2, 0.11), MAT.wood, wood);
      gableRoof(b, M, 2.1, 1.5, 2.35, 0.75, { ohSide: 0.1, ohGable: 0.05, thick: 0.1, roofMat: R.style === 'stone' ? MAT.slate : MAT.shingle, roofCol: st.roof, gableMat: MAT.wood, gableCol: dark, trimCol: dark, barge: false });
      break;
    }
    case 'stall': {
      const awn = darker(R.rgb, 0.9), awn2 = [0.9, 0.86, 0.76];
      for (const [x, z] of [[-1.15, 0.6], [1.15, 0.6], [-1.15, -0.6], [1.15, -0.6]]) b.add(G.box, lm(M, x, z > 0 ? 1.05 : 1.25, z, 0, 0.1, z > 0 ? 2.1 : 2.5, 0.1), MAT.wood, dark, by, 2);
      b.add(G.box, lm(M, 0, 0.82, 0.25, 0, 2.4, 0.1, 0.9), MAT.wood, wood, by, 1);
      b.add(G.box, lm(M, 0, 0.45, 0.62, 0, 2.3, 0.74, 0.06), MAT.wood, darker(wood, 0.85), by, 1);
      for (let i = 0; i < 6; i++) b.add(G.box, lm(M, -1.04 + i * 0.416 + 0.104, 2.32, 0.05, 0, 0.416, 0.04, 1.65, -0.18), MAT.cloth, i % 2 ? awn : awn2);
      // goods
      for (let i = 0; i < 4; i++) {
        const gx = -0.85 + i * 0.57, kind = Math.floor(rnd() * 3);
        b.add(G.box, lm(M, gx, 0.92, 0.25, rnd() * 0.3, 0.46, 0.1, 0.5), MAT.wood, darker(wood, 0.8));
        const col = kind === 0 ? [0.7, 0.16, 0.12] : kind === 1 ? [0.36, 0.55, 0.2] : [0.78, 0.6, 0.32];
        for (let j = 0; j < 5; j++) b.add(G.ico, lm(M, gx + (rnd() - 0.5) * 0.3, 1.02, 0.25 + (rnd() - 0.5) * 0.3, rnd() * 3, 0.07, 0.065, 0.07), MAT.cloth, darker(col, 0.85 + rnd() * 0.3));
      }
      barrel(1.6, -0.2, 0.85);
      crate(-1.65, 0, -0.1, 0.6);
      break;
    }
    case 'lantern': {
      b.add(G.box, lm(M, 0, 0.12, 0, 0, 0.36, 0.24, 0.36), MAT.stone, [0.5, 0.5, 0.48], by, 1);
      b.add(G.box, lm(M, 0, 1.45, 0, 0, 0.13, 2.9, 0.13), MAT.wood, dark, by, 3);
      b.add(G.box, lm(M, 0, 2.8, 0.3, 0, 0.08, 0.08, 0.7), MAT.wood, dark);
      b.add(G.box, lm(M, 0, 2.62, 0.55, 0, 0.26, 0.32, 0.26), MAT.metal, iron);
      b.add(G.box, lm(M, 0, 2.62, 0.55, 0, 0.2, 0.26, 0.28), MAT.window, [0.2, 0.15, 0.1]);
      b.add(G.box, lm(M, 0, 2.62, 0.55, 0, 0.28, 0.26, 0.2), MAT.window, [0.2, 0.15, 0.1]);
      b.add(G.pyr, lm(M, 0, 2.86, 0.55, 0, 0.22, 0.16, 0.22), MAT.metal, iron);
      LANTERNS.push(worldOf(M, 0, 2.6, 0.55));
      break;
    }
    case 'trough': {
      b.add(G.box, lm(M, 0, 0.3, 0, 0, 1.8, 0.6, 0.62), MAT.wood, darker(wood, 0.85), by, 1);
      b.add(G.box, lm(M, 0, 0.56, 0, 0, 1.62, 0.04, 0.46), MAT.water, [0.1, 0.16, 0.2]);
      break;
    }
    case 'bench': {
      b.add(G.box, lm(M, 0, 0.45, 0, 0, 1.5, 0.07, 0.36), MAT.wood, wood, by, 1);
      for (const s of [-1, 1]) b.add(G.box, lm(M, s * 0.58, 0.21, 0, 0, 0.08, 0.42, 0.3), MAT.wood, dark, by, 1);
      break;
    }
    case 'cart': {
      b.add(G.box, lm(M, 0, 0.82, 0, 0, 1.3, 0.12, 2.2), MAT.wood, wood, by, 1.2);
      for (const s of [-1, 1]) {
        b.add(G.box, lm(M, s * 0.63, 1.05, 0, 0, 0.06, 0.4, 2.2), MAT.wood, darker(wood, 0.9));
        b.add(G.cyl16, lm(M, s * 0.78, 0.58, -0.25, 0, 0.58, 0.09, 0.58, 0, Math.PI / 2), MAT.wood, dark);
        b.add(G.cyl8, lm(M, s * 0.84, 0.58, -0.25, 0, 0.12, 0.16, 0.12, 0, Math.PI / 2), MAT.metal, iron);
        beam(b, M, [s * 0.45, 0.8, 1.05], [s * 0.4, 0.08, 2.5], 0.07, MAT.wood, dark);
      }
      b.add(G.cyl8, lm(M, 0, 0.58, -0.25, 0, 0.05, 1.7, 0.05, 0, Math.PI / 2), MAT.wood, dark);
      for (let i = 0; i < 3; i++) b.add(G.ico, lm(M, (i - 1) * 0.36, 1.08, -0.35 + rnd() * 0.5, rnd() * 3, 0.24, 0.3, 0.26), MAT.cloth, [0.7, 0.6, 0.42]);
      break;
    }
    case 'hay': {
      b.add(G.cyl12, lm(M, 0, 0.75, 0, 0, 1.05, 1.5, 1.05), MAT.thatch, darker(st.thatch, 1.05), by, 1.5);
      b.add(G.cone12, lm(M, 0, 2.05, 0, 0.3, 1.12, 1.15, 1.12), MAT.thatch, darker(st.thatch, 1.1));
      b.add(G.cyl8, lm(M, 0, 2.2, 0, 0, 0.04, 1.6, 0.04), MAT.wood, dark);
      break;
    }
    case 'fence': {
      const len = p.len, n = Math.max(1, Math.round(len / 1.5));
      for (let i = 0; i <= n; i++) b.add(G.box, lm(M, 0, 0.55, -len / 2 + (i / n) * len, rnd() * 0.2, 0.1, 1.1, 0.1, (rnd() - 0.5) * 0.06), MAT.wood, darker(wood, 0.75 + rnd() * 0.15), by, 1);
      for (const y of [0.45, 0.85]) b.add(G.box, lm(M, 0.06, y, 0, 0, 0.05, 0.09, len), MAT.wood, darker(wood, 0.85));
      break;
    }
    case 'garden': {
      b.add(G.box, lm(M, 0, 0.02, 0, 0, p.w, 0.1, p.d), MAT.thatch, [0.3, 0.22, 0.14], by, 0.4);
      const rows = Math.max(2, Math.floor(p.d / 0.7));
      for (let i = 0; i < rows; i++) {
        const z = -p.d / 2 + (i + 0.5) * (p.d / rows);
        const crop = Math.floor(rnd() * 3);
        for (let x = -p.w / 2 + 0.3; x < p.w / 2 - 0.2; x += 0.42) {
          if (crop === 0) b.add(G.ico, lm(M, x, 0.14, z, rnd() * 3, 0.17, 0.12, 0.17), MAT.cloth, [0.34, 0.52, 0.24]);
          else if (crop === 1) b.add(G.cone8, lm(M, x, 0.25, z, rnd() * 3, 0.07, 0.4, 0.07), MAT.cloth, [0.3, 0.48, 0.2]);
          else b.add(G.ico, lm(M, x, 0.12, z, rnd() * 3, 0.12, 0.1, 0.12), MAT.cloth, [0.62, 0.32, 0.12]);
        }
      }
      break;
    }
    default: break;
  }
}
