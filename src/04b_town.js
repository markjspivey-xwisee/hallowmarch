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

function windowAt(b, F, u, y, ww, wh, st, o = {}) {
  const frame = o.frame || darker(st.wood, 0.6), dep = 0.08;
  b.add(G.box, lm(F, u, y, 0.0, 0, ww, wh, 0.05), MAT.window, [0.2, 0.15, 0.1]);
  b.add(G.box, lm(F, u, y + wh / 2 + 0.06, dep / 2, 0, ww + 0.24, 0.12, dep + 0.04), MAT.wood, frame);
  b.add(G.box, lm(F, u, y - wh / 2 - 0.05, dep / 2 + 0.05, 0, ww + 0.3, 0.09, dep + 0.14), MAT.wood, frame);
  for (const s of [-1, 1]) b.add(G.box, lm(F, u + s * (ww / 2 + 0.045), y, dep / 2, 0, 0.09, wh, dep), MAT.wood, frame);
  b.add(G.box, lm(F, u, y, 0.035, 0, 0.045, wh, 0.03), MAT.wood, frame);
  b.add(G.box, lm(F, u, y + wh * 0.12, 0.035, 0, ww, 0.045, 0.03), MAT.wood, frame);
  if (o.arch) b.add(G.box, lm(F, u, y + wh / 2 + 0.06, 0.02, 0, ww * 0.62, ww * 0.62, 0.1, 0, Math.PI / 4), o.archMat ?? MAT.stone, o.archCol || darker(st.stone, 0.85));
  if (o.shutters) {
    const sw = ww / 2 + 0.03, phi = 0.38 + 0.25 * (o.seed || 0);
    for (const s of [-1, 1]) {
      const hx = u + s * (ww / 2 + 0.1);
      const cx = hx + s * Math.cos(phi) * sw / 2, cz = 0.05 + Math.sin(phi) * sw / 2;
      b.add(G.box, lm(F, cx, y, cz, -s * phi, sw, wh + 0.04, 0.045), MAT.wood, o.shutters);
      b.add(G.box, lm(F, cx, y + wh * 0.28, cz + 0.02, -s * phi, sw * 0.9, 0.05, 0.02), MAT.metal, [0.2, 0.2, 0.22]);
      b.add(G.box, lm(F, cx, y - wh * 0.28, cz + 0.02, -s * phi, sw * 0.9, 0.05, 0.02), MAT.metal, [0.2, 0.2, 0.22]);
    }
  }
  if (o.box && o.seed > 0.4) {
    // a flower box under the sill
    b.add(G.box, lm(F, u, y - wh / 2 - 0.2, 0.17, 0, ww + 0.1, 0.18, 0.2), MAT.wood, frame);
    for (let k = 0; k < 5; k++) b.add(G.ico, lm(F, u + (k - 2) * ww * 0.21, y - wh / 2 - 0.06, 0.18, k, 0.09, 0.07, 0.08), MAT.cloth, k % 2 ? [0.75, 0.2, 0.25] : [0.25, 0.5, 0.2]);
  }
}
function doorAt(b, F, u, dw, dh, st, o = {}) {
  const frame = o.frame || darker(st.wood, 0.55);
  b.add(G.box, lm(F, u, dh / 2, 0.015, 0, dw, dh, 0.06), MAT.wood, o.leaf || darker(st.wood, 0.75));
  b.add(G.box, lm(F, u, dh + 0.1, 0.08, 0, dw + 0.44, 0.2, 0.18), MAT.wood, frame);
  for (const s of [-1, 1]) b.add(G.box, lm(F, u + s * (dw / 2 + 0.08), dh / 2, 0.07, 0, 0.16, dh, 0.16), MAT.wood, frame);
  for (const y of [0.32, dh - 0.38]) b.add(G.box, lm(F, u - dw * 0.12, y, 0.055, 0, dw * 0.72, 0.065, 0.025), MAT.metal, [0.2, 0.2, 0.22]);
  b.add(G.cyl8, lm(F, u + dw * 0.33, dh * 0.5, 0.07, 0, 0.04, 0.025, 0.04, Math.PI / 2), MAT.metal, [0.32, 0.29, 0.24]);
  if (o.arch) b.add(G.cyl16, lm(F, u, dh + 0.05, 0.05, 0, dw / 2 + 0.25, 0.22, dw / 2 + 0.25, Math.PI / 2), MAT.stone, darker(st.stone, 0.9));
  b.add(G.box, lm(F, u, 0.08, 0.3, 0, dw + 0.6, 0.2, 0.55), MAT.stone, [0.55, 0.54, 0.5]);
}
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
function chimneyAt(b, M, x, z, top, st, by) {
  b.add(G.box, lm(M, x, top / 2 - 0.5, z, 0, 0.78, top + 1.0, 0.66), MAT.stone, darker(st.stone, 0.88), by, 5);
  b.add(G.box, lm(M, x, top + 0.07, z, 0, 0.92, 0.14, 0.8), MAT.stone, darker(st.stone, 0.75));
  b.add(G.cyl8, lm(M, x, top + 0.32, z, 0, 0.13, 0.36, 0.13), MAT.stone, [0.48, 0.33, 0.26]);
  CHIMNEYS.push(worldOf(M, x, top + 0.55, z));
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

/* --- one house per realm style --- */
function houseLogres(b, M, h, st, R, by) {
  const big = h.kind === 'hall', w = h.w, d = h.d, H = h.h;
  const shutter = darker(R.rgb, 0.62);
  b.add(G.box, lm(M, 0, -0.3, 0, 0, w + 0.34, 1.6, d + 0.34), MAT.stone, darker(st.stone, 0.9), by, 2);
  b.add(G.box, lm(M, 0, (H + 0.5) / 2, 0, 0, w, H - 0.5, d), big ? MAT.stone : MAT.plaster, big ? st.stone : st.plaster, by, 3);
  const pitch = big ? 0.82 : 0.86;
  const rh = gableRoof(b, M, w, d, H, pitch, big
    ? { ohSide: 0.45, ohGable: 0.35, thick: 0.22, roofMat: MAT.slate, roofCol: st.roof, gableMat: MAT.stone, gableCol: st.stone, trimCol: darker(st.wood, 0.6), baseY: by }
    : { ohSide: 0.55, ohGable: 0.4, thick: 0.38, roofMat: MAT.thatch, roofCol: st.thatch, gableMat: MAT.plaster, gableCol: st.plaster, trimCol: darker(st.wood, 0.6), ridge: 'round', ridgeR: 0.24, eaveRoll: true, baseY: by });
  // front: door and two windows; sides: windows; back: a chimney through the roof
  const faces = [0, 1, 2, 3].map((f) => faceM(M, f, w, d));
  const dw = big ? 1.7 : 1.05, dh = big ? 2.6 : 2.05;
  doorAt(b, faces[0], 0, dw, dh, st, { arch: big });
  const ww = big ? 0.8 : 0.72, wh = big ? 1.5 : 0.78, wy = big ? 2.3 : 1.95;
  const open = [[{ u0: -dw / 2 - 0.1, u1: dw / 2 + 0.1, y0: 0, y1: dh + 0.2 }], [], [], []];
  const wins = [[-w * 0.3, w * 0.3], [-d * 0.22, d * 0.22], [], [-d * 0.22, d * 0.22]];
  wins.forEach((us, f) => us.forEach((u, k) => {
    windowAt(b, faces[f], u, wy, ww, wh, st, { shutters: big ? null : shutter, seed: fhash(h.seed * 31 + f * 7 + k), box: !big, arch: big });
    open[f].push({ u0: u - ww / 2 - 0.1, u1: u + ww / 2 + 0.1, y0: wy - wh / 2 - 0.15, y1: wy + wh / 2 + 0.15 });
  }));
  if (!big) {
    for (let f = 0; f < 4; f++) halfTimber(b, faces[f], f % 2 ? d : w, H, st, open[f], by);
    gableTimber(b, faces[0], w, H, rh, st);
    gableTimber(b, faces[2], w, H, rh, st);
  } else {
    // buttresses along the long walls
    for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) {
      const z = k * d * 0.33;
      b.add(G.box, lm(M, s * (w / 2 + 0.3), H * 0.42, z, 0, 0.6, H * 0.84 + 0.6, 0.7), MAT.stone, darker(st.stone, 0.95), by, 4);
      b.add(G.box, lm(M, s * (w / 2 + 0.16), H * 0.86, z, 0, 0.4, 0.7, 0.66, 0, s * 0.5), MAT.stone, darker(st.stone, 0.9));
    }
    b.add(G.box, lm(M, 0, H + rh * 0.55, d / 2 + 0.04, 0, 0.9, 0.9, 0.1, 0, Math.PI / 4), MAT.window, [0.2, 0.15, 0.1]);
  }
  chimneyAt(b, M, w * 0.22, -d * 0.24, H + rh + 0.55, st, by);
}
function houseThule(b, M, h, st, R, by) {
  const big = h.kind === 'hall', w = h.w, d = h.d, H = h.h;
  const logCol = st.logs, endCol = [0.62, 0.5, 0.34];
  b.add(G.box, lm(M, 0, -0.35, 0, 0, w + 0.5, 1.5, d + 0.5), MAT.stone, darker(st.stone, 0.85), by, 2);
  b.add(G.box, lm(M, 0, (H + 0.4) / 2, 0, 0, w - 0.22, H - 0.4, d - 0.22), MAT.wood, darker(st.wood, 0.7), by, 3);
  // stacked logs, notched at the corners
  const r = big ? 0.2 : 0.17, step = r * 1.86;
  let k = 0;
  for (let y = 0.4 + r; y < H - r * 0.3; y += step * 0.5, k++) {
    const alongX = k % 2 === 0;
    const len = (alongX ? w : d) + 0.6;
    for (const s of [1, -1]) {
      const m4 = alongX ? lm(M, 0, y, s * (d / 2 - r * 0.6), 0, r, len, r * 0.94, 0, Math.PI / 2) : lm(M, s * (w / 2 - r * 0.6), y, 0, 0, r * 0.94, len, r, Math.PI / 2);
      b.add(G.cyl8, m4, MAT.logH, darker(logCol, 0.92 + 0.16 * fhash(k * 7 + s)), by, 4);
      for (const e of [1, -1]) {
        const em = alongX ? lm(M, e * len / 2, y, s * (d / 2 - r * 0.6), 0, r * 0.86, 0.03, r * 0.82, 0, Math.PI / 2) : lm(M, s * (w / 2 - r * 0.6), y, e * len / 2, 0, r * 0.82, 0.03, r * 0.86, Math.PI / 2);
        b.add(G.cyl8, em, MAT.wood, endCol);
      }
    }
  }
  const pitch = big ? 0.92 : 0.95;
  gableRoof(b, M, w, d, H, pitch, { ohSide: 0.5, ohGable: 0.55, thick: 0.2, roofMat: MAT.shingle, roofCol: st.roof, gableMat: MAT.wood, gableCol: darker(st.wood, 0.85), trimCol: darker(st.wood, 0.75), horns: true, baseY: by });
  const faces = [0, 1, 2, 3].map((f) => faceM(M, f, w, d));
  const dw = big ? 1.6 : 1.05, dh = big ? 2.5 : 2.0;
  doorAt(b, faces[0], 0, dw, dh, st, { frame: darker(st.wood, 0.5), leaf: darker(st.wood, 0.6) });
  if (big) {
    // a carved porch over the door
    for (const s of [-1, 1]) b.add(G.cyl8, lm(M, s * 1.3, 1.45, d / 2 + 1.1, 0, 0.13, 2.9, 0.13), MAT.logH, logCol, by, 3);
    gableRoof(b, lm(M, 0, 0, d / 2 + 0.75), 3.1, 1.4, 2.9, 0.85, { ohSide: 0.15, ohGable: 0.1, thick: 0.14, roofMat: MAT.shingle, roofCol: st.roof, gableMat: MAT.wood, gableCol: darker(st.wood, 0.85), trimCol: darker(st.wood, 0.75), horns: true });
  }
  const shutter = darker([0.32, 0.38, 0.46], 0.9);
  for (const [f, u] of [[0, -w * 0.32], [0, w * 0.32], [1, 0], [3, 0]]) windowAt(b, faces[f], u, big ? 2.2 : 1.85, 0.56, 0.56, st, { shutters: shutter, seed: fhash(h.seed * 17 + f + u) });
  chimneyAt(b, M, -w * 0.2, -d * 0.18, H + (w / 2) * Math.tan(pitch) + 0.5, st, by);
}
function houseEriu(b, M, h, st, R, by) {
  const big = h.kind === 'hall', r = roundHouseR(h), H = big ? 4.0 : h.h - 0.2;
  const rot = Math.PI / 16; // a flat facet faces the door
  b.add(G.cyl16, lm(M, 0, -0.35, 0, rot, r + 0.18, 1.5, r + 0.18), MAT.stone, darker(st.stone, 0.92), by, 2);
  b.add(G.cyl16, lm(M, 0, (H + 0.4) / 2, 0, rot, r, H - 0.4, r), MAT.plaster, st.plaster, by, 3);
  // wall posts and a woven band under the eaves
  const posts = big ? 16 : 10;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * TAU + 0.2;
    if (Math.abs(angDiff(a, 0)) < 0.3) continue;
    b.add(G.cyl8, lm(M, Math.sin(a) * (r + 0.05), H / 2 + 0.2, Math.cos(a) * (r + 0.05), 0, 0.09, H - 0.4, 0.09), MAT.wood, darker(st.wood, 0.65), by, 3);
  }
  b.add(G.cyl16, lm(M, 0, H - 0.18, 0, rot, r + 0.07, 0.3, r + 0.07), MAT.wood, darker(st.wood, 0.8));
  // the thatch: a steep cone with a thick lip and a stepped course
  const Rr = r * 1.32 + 0.3, hc = Rr * (big ? 0.98 : 1.06), y0 = H - 0.3;
  b.add(G.frustum16, lm(M, 0, y0 - 0.17, 0, 0, Rr, 0.36, Rr), MAT.thatch, darker(st.thatch, 0.85));
  b.add(G.cone16, lm(M, 0, y0 + hc / 2, 0, 0.1, Rr * 0.985, hc, Rr * 0.985), MAT.thatch, st.thatch);
  for (const t of [0.34, 0.62]) {
    const rr = Rr * (1 - t) + 0.07;
    b.add(G.frustum16, lm(M, 0, y0 + hc * t - 0.1, 0, t * 3, rr, 0.24, rr), MAT.thatch, darker(st.thatch, 0.9));
  }
  if (big) {
    // a second tier for the hall
    b.add(G.cyl16, lm(M, 0, y0 + hc * 0.55 + 0.6, 0, 0, Rr * 0.38, 1.2, Rr * 0.38), MAT.plaster, darker(st.plaster, 0.9));
    b.add(G.cone16, lm(M, 0, y0 + hc * 0.55 + 1.2 + Rr * 0.3, 0, 0.3, Rr * 0.55, Rr * 0.6, Rr * 0.55), MAT.thatch, st.thatch);
  }
  const apex = y0 + hc + (big ? 0.6 : 0);
  b.add(G.cone8, lm(M, 0, apex - 0.2, 0, 0, 0.3, 0.55, 0.3), MAT.thatch, darker(st.thatch, 0.7));
  b.add(G.cyl8, lm(M, 0, apex + 0.25, 0, 0, 0.05, 0.7, 0.05), MAT.wood, darker(st.wood, 0.6));
  CHIMNEYS.push(worldOf(M, 0, apex - 0.1, 0));
  // a gabled porch at the door
  const fz = r * Math.cos(Math.PI / 16);
  const F = lm(M, 0, 0, fz, 0);
  doorAt(b, F, 0, 1.05, 2.0, st, { leaf: darker([0.36, 0.42, 0.26], 1.0) });
  for (const s of [-1, 1]) b.add(G.cyl8, lm(M, s * 0.85, 1.25, fz + 1.05, 0, 0.09, 2.5, 0.09), MAT.wood, darker(st.wood, 0.7), by, 3);
  gableRoof(b, lm(M, 0, 0, fz + 0.55), 2.2, 1.35, 2.45, 0.8, { ohSide: 0.18, ohGable: 0.12, thick: 0.26, roofMat: MAT.thatch, roofCol: st.thatch, gableMat: MAT.plaster, gableCol: st.plaster, trimCol: darker(st.wood, 0.6), ridge: 'round', ridgeR: 0.13 });
  // a small window to each side
  for (const s of [-1, 1]) {
    const a = s * 1.25;
    const W = lm(M, Math.sin(a) * r * 0.985, 0, Math.cos(a) * r * 0.985, a);
    windowAt(b, W, 0, 1.75, 0.5, 0.5, st, { shutters: darker([0.3, 0.42, 0.26], 0.9), seed: fhash(h.seed * 13 + s) });
  }
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
          b.add(G.cyl8, lm(M, x, y, (rnd() - 0.5) * 0.1, rnd() * 3, 0.09, len * (0.94 + rnd() * 0.06), 0.09, Math.PI / 2), MAT.logH, darker(st.logs, 0.85 + rnd() * 0.3), by, 1.2);
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
