/* ================================================================== */
/* [land] towers you can go into; [keeps] every tower of every keep    */
/* ================================================================== */
// Every tower of every keep is hollow (version 10 made the stone keeps' corner towers so; [keeps] version 11 the
// rest). A tower is data: its shell (a drum of masonry, or a square shaft of logs on a stone footing), the floors of
// its rooms, the doors and openings in its walls, the ladders between its floors and the hatches they climb through,
// the furniture and torches of each room, and its top (an open fighting top with crenels, a fighting gallery under a
// shingle roof, or a platform under a thatched cone). Built in the site frame of its keep (castleStone, castleRound
// and castleTimber in 04g_castles.js call the builders below); the doors and hatch lids of a keep are one mesh whose
// vertices are moved when one of them swings.
//   Logres: four corner drums (towerStone) and two gate drums (towerGateStone), open fighting tops with crenels.
//   Eriu: two gate drums of stone under thatch (towerGateRath): a store room, a ladder up through a hatch onto the
//     platform under the cone, where the wall walk comes in.
//   Thule: four corner shafts and two gate shafts of logs (towerTimber): a store room, a room at the walk's height
//     with a door onto each walk, a ladder up through a hatch into the fighting gallery under the shingle roof.
// The garrison walks to its posts on the tops through them, climbing the ladders (body action 14) and pushing the
// hatches open as it goes; the player climbs by walking into a ladder or with E (the pad's Use), and opens or shuts
// a hatch with E. Doors swing open for anyone who comes to them. Fighting on a ladder: 04m_ladders.js.

const TOWER = { list: [], ladders: [], hatches: [], doors: [], keeps: [], inner: [], px: null, pz: null, stats: { rebuilt: 0 } };
// the stone keep's corner drum (version 10): its measures, and the ladders' climbing speed
const TW = { RO: 3.4, RI: 2.5, NS: 16, R0: 1.25, R1: 2.3, HW: 0.5, CLIMB: 1.25, FOOT: 1.85, LINE: 1.6, OFF: 0.7 };
// [keeps] the ladder and hatch measures of a room of inner radius (or half-width) ri: the hatch from R0 to R1 out
// from the middle along the ladder, HW either side of its line; the climber on LINE between the rails and the wall,
// a body at its FOOT to start up, stepping off at OFF at the top (the corner drum's are TW's)
function twDims(ri) {
  const big = ri > 2.2, R1 = ri - (big ? 0.2 : 0.15), R0 = R1 - 1.05;
  return { R0, R1, HW: ri > 1.7 ? 0.5 : 0.46, LINE: R0 + (big ? 0.35 : 0.4), FOOT: R0 + (big ? 0.6 : 0.65), OFF: R0 - 0.55 };
}

// one sector of a drum, unit high: from ri to ro, 1/ns of the circle centred on angle 0 (a point at angle a is
// (sin a, cos a) * r, as in the site frame), each arc in two flat facets; placed with its yaw
const _twSec = new Map();
function twSector(ri, ro, ns) {
  const key = ri + ',' + ro + ',' + ns;
  if (_twSec.has(key)) return _twSec.get(key);
  const a0 = -Math.PI / ns, a1 = Math.PI / ns, nf = 2;
  const pos = [], nrm = [], idx = [];
  const P = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
  const quad = (p0, p1, p2, p3, n) => { const k = pos.length / 3; pos.push(...p0, ...p1, ...p2, ...p3); for (let q = 0; q < 4; q++) nrm.push(...n); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  for (let f = 0; f < nf; f++) {
    const aa = a0 + ((a1 - a0) * f) / nf, ab = a0 + ((a1 - a0) * (f + 1)) / nf, am = (aa + ab) / 2;
    quad(P(aa, ro, 0), P(ab, ro, 0), P(ab, ro, 1), P(aa, ro, 1), [Math.sin(am), 0, Math.cos(am)]);
    quad(P(ab, ri, 0), P(aa, ri, 0), P(aa, ri, 1), P(ab, ri, 1), [-Math.sin(am), 0, -Math.cos(am)]);
    quad(P(aa, ri, 1), P(aa, ro, 1), P(ab, ro, 1), P(ab, ri, 1), [0, 1, 0]);
    quad(P(aa, ro, 0), P(aa, ri, 0), P(ab, ri, 0), P(ab, ro, 0), [0, -1, 0]);
  }
  quad(P(a0, ri, 0), P(a0, ro, 0), P(a0, ro, 1), P(a0, ri, 1), [-Math.cos(a0), 0, Math.sin(a0)]);
  quad(P(a1, ro, 0), P(a1, ri, 0), P(a1, ri, 1), P(a1, ro, 1), [Math.cos(a1), 0, -Math.sin(a1)]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  _twSec.set(key, g);
  return g;
}

// a point at angle a and radius r from the tower's centre (and off along the wall there), in the site frame / world
const twP = (T, a, r, off = 0) => ({ x: T.cx + Math.sin(a) * r + Math.cos(a) * off, z: T.cz + Math.cos(a) * r - Math.sin(a) * off });
function twW(T, a, r, off = 0) { const p = twP(T, a, r, off); return siteToWorld(T.S, p.x, p.z); }
const twIdx = (a, ns = TW.NS) => ((Math.round(a / (TAU / ns)) % ns) + ns) % ns;
// a square tower's wall facing a (0 +z, 1 +x, 2 -z, 3 -x)
const twSide = (a) => ((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4;
// a body's place in a tower's own frame (site frame, about its centre)
function twLocal(T, x, z) { const l = siteLocal(T.S, x, z); return { x: l.x - T.cx, z: l.z - T.cz }; }
// is the site-frame offset (dx, dz) from the centre inside the rooms (out to the inner face, plus pad)?
function twInside(T, dx, dz, pad = 0) {
  if (T.kind === 'drum') return dx * dx + dz * dz < (T.RI + pad) * (T.RI + pad);
  return Math.abs(dx) < T.HI + pad && Math.abs(dz) < T.HI + pad;
}

/* ------------------------------------------------------------------ */
/* a tower: its frame, measures and the ground room's floor            */
/* ------------------------------------------------------------------ */
function towerNew(C, o) {
  const { S } = C;
  const T = { C, S, kind: o.kind, look: o.look, role: o.role, sx: o.sx, sz: o.sz, cx: o.cx, cz: o.cz, H: o.H, TT: o.TT, doors: [], ladders: [], hatches: [], gaps: {}, sgaps: [[], [], [], []], fires: [], colls: [], props: [], levels: [], thresholds: [] };
  if (o.kind === 'drum') { T.RO = o.RO; T.RI = o.RI; T.NS = o.NS; } else { T.HO = o.HO; T.HI = o.HI; T.RO = o.HO; T.RI = o.HI; }
  T.ld = twDims(T.RI);
  if (T.RI === TW.RI) T.ld = { R0: TW.R0, R1: TW.R1, HW: TW.HW, LINE: TW.LINE, FOOT: TW.FOOT, OFF: TW.OFF };
  // the ground room's floor: a hand above the courtyard, or above the highest ground inside the walls
  let gh = 0;
  for (let k = 0; k < 40; k++) { const a = k * 2.399, r = Math.sqrt((k + 0.5) / 40) * T.RO; const p = siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); gh = Math.max(gh, heightAt(p.x, p.z) - S.y); }
  T.yG = Math.max(0.1, gh + 0.06);
  // the solid tower the world was laid out round stands down: the shell below takes its place
  for (const c of S.colliders) if (c.tag === 'tower' && c.type === 'circle') { const l = siteLocal(S, c.x, c.z); if (Math.abs(l.x - T.cx) < 1.0 && Math.abs(l.z - T.cz) < 1.0) { c.active = false; c.hollow = true; } }
  const wc = siteToWorld(S, T.cx, T.cz);
  T.wx = wc.x; T.wz = wc.z;
  return T;
}
// an opening through the wall at angle a from y0 to y1 (and off along a square tower's wall, w wide)
function towerGap(T, a, y0, y1, off = 0, w = 1.0) {
  if (T.kind === 'drum') { const i = twIdx(a, T.NS); (T.gaps[i] = T.gaps[i] || []).push([y0, y1]); return i; }
  const k = twSide(a);
  T.sgaps[k].push([off - w / 2, off + w / 2, y0, y1]);
  return k;
}
// a door's angle snapped to the middle of the drum's sector it opens in
const twSnap = (T, a) => (T.kind === 'drum' ? twIdx(a, T.NS) * (TAU / T.NS) : twSide(a) * (Math.PI / 2));

/* ------------------------------------------------------------------ */
/* shells                                                              */
/* ------------------------------------------------------------------ */
// a drum: NS sectors of masonry round the rooms (true arcs inside and out, so a doorway's reveals are clean), a
// doorway left where there is a door; one collider a piece, stopping short of a doorway; slits: [[angle, [[y0, y1]...]]]
function towerShellDrum(T, o) {
  const { C, S } = T, { b, M, st } = C, { RO, RI, NS } = T, RM = (RO + RI) / 2, TH = RO - RI;
  const bi = C.bi || (C.bi = new Batch()); // what is only seen from inside: drawn only near the keep (buildTowers)
  const sec = twSector(RI, RO, NS), top = o.top, col = o.col || st.stone, seed = T.sx * 3 + T.sz * 7 + (T.role === 'gate' ? 13 : 0);
  const slitAt = new Map();
  for (const [a, ys] of o.slits || []) slitAt.set(twIdx(a, NS), ys);
  const gapped = (j) => (T.gaps[((j % NS) + NS) % NS] || []).length > 0;
  const ht = RM * Math.sin(Math.PI / NS);
  for (let i = 0; i < NS; i++) {
    const a = (i * TAU) / NS, p = twP(T, a, RM), u = { x: Math.cos(a), z: -Math.sin(a) };
    const g = (T.gaps[i] || []).slice().sort((q, r) => q[0] - r[0]);
    // beside a doorway the collider stops short of the reveal, so a body passes where the doorway shows it can
    const cutL = gapped(i - 1) ? 0.13 : 0, cutR = gapped(i + 1) ? 0.13 : 0, sh = (cutL - cutR) / 2;
    const piece = (y0, y1) => {
      b.add(sec, lm(M, T.cx, y0, T.cz, a, 1, y1 - y0, 1), MAT.stone, darker(col, 0.9 + 0.12 * hash1(i * 5.3 + y0 + seed)), S.y, 5);
      const c = boxAt(S, p.x + u.x * sh, p.z + u.z * sh, ht - (cutL + cutR) / 2, TH / 2, 'wall', y1 - y0, a);
      c.vert = true; c.y0 = S.y + y0; c.tower = T;
      T.colls.push(c);
    };
    let y = -1.4;
    for (const [g0, g1] of g) { if (g0 > y + 0.01) piece(y, g0); y = g1; }
    if (top > y + 0.01) piece(y, top);
    // over each doorway a lintel standing proud of both faces, and a threshold at a door from the ground
    for (const [g0, g1] of g) {
      b.add(G.box, lm(M, p.x, g1 + 0.12, p.z, a, 2 * RI * Math.sin(Math.PI / NS) + 0.25, 0.24, TH + 0.1), MAT.stone, darker(col, 0.8));
      if (g0 < 0) b.add(G.box, lm(M, p.x, T.yG - 0.06, p.z, a, 2 * RI * Math.sin(Math.PI / NS), 0.16, TH + 0.2), MAT.stone, darker(col, 0.72));
    }
    // arrow slits: dark on the face, a splayed embrasure inside
    const ys = slitAt.get(i);
    if (ys) {
      for (const [y0, y1] of ys) {
        (T.slitsAt = T.slitsAt || []).push({ a, off: 0, y0, y1 });
        const ym = (y0 + y1) / 2, h = y1 - y0;
        const qo = twP(T, a, RO + 0.004), qi = twP(T, a, RI - 0.004);
        b.add(G.box, lm(M, qo.x, ym, qo.z, a, 0.09, h, 0.012), MAT.water, ARROW_SLIT);
        bi.add(G.box, lm(M, qi.x, ym, qi.z, a, 0.42, h + 0.2, 0.012), MAT.darkstone, darker(col, 0.42));
        bi.add(G.box, lm(M, qi.x, ym, qi.z, a, 0.09, h, 0.016), MAT.water, ARROW_SLIT);
      }
    }
  }
}
// a square shaft of logs on a stone footing: four walls (those facing +-z run the full width, those facing +-x fit
// between them), a doorway or a window left where one is; corner posts, wall plates at each floor, loopholes
function towerShellSquare(T, o) {
  const { C, S } = T, { b, M, st } = C, { HO, HI } = T, TH = HO - HI, mid = (HO + HI) / 2, top = o.top, foot = o.foot ?? 1.8;
  const bi = C.bi || (C.bi = new Batch());
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, half = k % 2 === 0 ? HO : HI;
    const gaps = T.sgaps[k];
    const cuts = [-half, half];
    for (const g of gaps) cuts.push(clamp(g[0], -half, half), clamp(g[1], -half, half));
    cuts.sort((p, q) => p - q);
    for (let j = 0; j + 1 < cuts.length; j++) {
      const u0 = cuts[j], u1 = cuts[j + 1];
      if (u1 - u0 < 0.02) continue;
      const um = (u0 + u1) / 2;
      const gs = gaps.filter((g) => g[0] < um && g[1] > um).map((g) => [g[2], g[3]]).sort((p, q) => p[0] - q[0]);
      const piece = (y0, y1) => {
        const p = twP(T, a, mid, um), w = u1 - u0;
        // the stone footing up to `foot`, the logs above it
        if (y0 < foot) { const ya = y0, yb = Math.min(y1, foot), q = twP(T, a, mid + 0.04, um); b.add(G.box, lm(M, q.x, (ya + yb) / 2, q.z, a, w + (k % 2 === 0 ? 0.1 : 0), yb - ya, TH + 0.1), MAT.stone, darker(st.stone, 0.88 + 0.14 * hash1(k * 7 + j * 3 + T.sx * 5 + T.sz * 11)), S.y, 2.5); }
        if (y1 > foot) { const ya = Math.max(y0, foot); b.add(G.box, lm(M, p.x, (ya + y1) / 2, p.z, a, w, y1 - ya, TH), MAT.logs, darker(st.logs, 0.92 + 0.12 * hash1(k * 5 + j)), S.y, 6); }
        const c = boxAt(S, p.x, p.z, w / 2, TH / 2, 'wall', y1 - y0, a);
        c.vert = true; c.y0 = S.y + y0; c.tower = T;
        T.colls.push(c);
      };
      let y = -1.4;
      for (const [g0, g1] of gs) { if (g0 > y + 0.01) piece(y, g0); y = Math.max(y, g1); }
      if (top > y + 0.01) piece(y, top);
    }
    // a squared beam over each doorway, a sill at a door from the ground, the frame's posts at its sides
    for (const g of gaps) {
      const um = (g[0] + g[1]) / 2, w = g[1] - g[0], q = twP(T, a, mid, um);
      if (g[3] < top - 0.05) b.add(G.box, lm(M, q.x, g[3] + 0.1, q.z, a, w + 0.36, 0.2, TH + 0.14), MAT.wood, darker(st.wood, 0.72));
      if (g[2] < 0.5) b.add(G.box, lm(M, q.x, T.yG - 0.05, q.z, a, w, 0.14, TH + 0.2), MAT.wood, darker(st.wood, 0.7));
      else b.add(G.box, lm(M, q.x, g[2] - 0.04, q.z, a, w, 0.1, TH + 0.12), MAT.wood, darker(st.wood, 0.75));
      for (const sd of [-1, 1]) { const r = twP(T, a, mid, um + sd * (w / 2 + 0.05)); b.add(G.box, lm(M, r.x, (g[2] + g[3]) / 2, r.z, a, 0.1, g[3] - Math.max(g[2], 0), TH + 0.06), MAT.wood, darker(st.wood, 0.8)); }
    }
  }
  // corner posts of whole logs from the footing to the top, wall plates round the shaft at each floor
  for (const [ux, uz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.add(G.cyl8, lm(M, T.cx + ux * (HO - 0.08), (foot + top + 0.3) / 2, T.cz + uz * (HO - 0.08), 0, 0.2, top + 0.3 - foot, 0.2), MAT.logH, darker(st.logs, 0.85), S.y, 6);
  for (const y of o.plates || []) for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, q = twP(T, a, HO + 0.03);
    b.add(G.box, lm(M, q.x, y, q.z, a, 2 * HO + 0.14, 0.2, 0.12), MAT.wood, darker(st.wood, 0.68));
  }
  // loopholes through the logs, dark on both faces: [angle, off, y0, y1]
  for (const [a, off, y0, y1] of o.slits || []) {
    (T.slitsAt = T.slitsAt || []).push({ a, off, y0, y1 });
    const qo = twP(T, a, HO + 0.004, off), qi = twP(T, a, HI - 0.004, off), ym = (y0 + y1) / 2;
    b.add(G.box, lm(M, qo.x, ym, qo.z, a, 0.11, y1 - y0, 0.012), MAT.water, ARROW_SLIT);
    bi.add(G.box, lm(M, qi.x, ym, qi.z, a, 0.11, y1 - y0, 0.012), MAT.water, ARROW_SLIT);
  }
}

/* ------------------------------------------------------------------ */
/* tops                                                                */
/* ------------------------------------------------------------------ */
// the corbel course, the crenels round an open top, and (for a corner tower) the flagpole's footing
function towerTopCrenels(T, o = {}) {
  const { C } = T, { b, M, st } = C, { RO, NS, TT } = T;
  for (let i = 0; i < NS; i++) {
    const a = (i * TAU) / NS, p = twP(T, a, RO - 0.2 + 0.21);
    b.add(G.box, lm(M, p.x, TT - 0.25, p.z, a, 2 * (RO + 0.22) * Math.sin(Math.PI / NS) + 0.08, 0.5, 0.62), MAT.stone, darker(st.stone, 0.9));
  }
  const n = o.n || 14;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, rr = RO + 0.02;
    const p0 = twP(T, a0, rr), p1 = twP(T, a1, rr);
    castleParapet(C, p0.x, p0.z, p1.x, p1.z, TT, { th: 0.45, bh: 0.95, step: o.step || 1.6, slits: i % 2 === 0 });
  }
  // the floor runs out under the crenels
  const rr = RO - 0.2, hw = 2 * (RO + 0.1) * Math.sin(Math.PI / NS) / 2 + 0.04;
  for (let i = 0; i < NS; i++) { const a = (i * TAU) / NS, p = twP(T, a, rr); C.floor(p.x, p.z, hw, 0.32, a, TT, TT, TT - 0.5, 0.45, 'top'); }
  if (o.pole) C.post(T.cx, T.cz, 0.16, TT, 4.2);
}
// [keeps] Thule: a fighting gallery on the top of the shaft, a breastwork of planks round it, posts at the corners and
// the middles of the sides holding up a shingle roof; the floor runs out over the walls
function towerTopGallery(T, o = {}) {
  const { C, S } = T, { b, M, st } = C, { HO, TT } = T, eave = TT + (o.eave || 2.3), rh = o.rh || 3.6;
  const wood = st.wood;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, q = twP(T, a, HO - 0.07), L = 2 * HO - 0.04;
    // the breastwork: planks on a sill under a rail, open above it to the eaves
    b.add(G.box, lm(M, q.x, TT + 0.55, q.z, a, L, 1.1, 0.1), MAT.wood, darker(wood, 0.92 + 0.08 * hash1(k * 3 + T.sx)));
    b.add(G.box, lm(M, q.x, TT + 1.12, q.z, a, L + 0.06, 0.08, 0.18), MAT.wood, darker(wood, 0.75));
    for (let i = 0; i < 6; i++) { const r = twP(T, a, HO - 0.02, -HO + 0.35 + i * ((2 * HO - 0.7) / 5)); b.add(G.box, lm(M, r.x, TT + 1.0, r.z, a, 0.05, 0.12, 0.02), MAT.water, ARROW_SLIT); }
    C.coll(q.x, q.z, HO, 0.12, a, TT - 0.1, 1.3);
    // the eaves' plate
    const e = twP(T, a, HO - 0.07);
    b.add(G.box, lm(M, e.x, eave - 0.08, e.z, a, 2 * HO + 0.1, 0.16, 0.16), MAT.wood, darker(wood, 0.7));
  }
  // posts: at the corners and the middles of the sides
  for (const [ux, uz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const px = T.cx + ux * (HO - 0.1), pz = T.cz + uz * (HO - 0.1);
    b.add(G.box, lm(M, px, (TT + eave) / 2, pz, 0, 0.18, eave - TT, 0.18), MAT.logH, darker(st.logs, 0.9), S.y + TT, 2);
    C.post(px, pz, 0.12, TT, eave - TT);
  }
  // the roof: a shingled pyramid overhanging the gallery, a ceiling of boards under it, a capping post and the flagpole
  const rr = (HO + 0.5) / Math.SQRT1_2;
  b.add(G.pyr, lm(M, T.cx, eave + rh / 2, T.cz, 0, rr, rh, rr), MAT.shingle, st.roof);
  b.add(G.box, lm(M, T.cx, eave + 0.02, T.cz, 0, 2 * HO + 0.3, 0.06, 2 * HO + 0.3), MAT.wood, darker(wood, 0.62));
  b.add(G.cyl8, lm(M, T.cx, eave + rh + 0.15, T.cz, 0, 0.16, 0.5, 0.16), MAT.wood, darker(wood, 0.8));
  T.eave = eave; T.apex = eave + rh;
}
// [keeps] Eriu: a platform on the drum under a thatched cone on posts, a low breastwork round it, open where the wall
// walk comes in (o.open: [angle, half-width in radians])
function towerTopThatch(T, o = {}) {
  const { C } = T, { b, M, st } = C, { RO, NS, TT } = T, eave = TT + 2.3;
  // a coping of darker stone round the drum's head
  for (let i = 0; i < NS; i++) { const a = (i * TAU) / NS, p = twP(T, a, RO - 0.25); b.add(G.box, lm(M, p.x, TT - 0.15, p.z, a, 2 * RO * Math.sin(Math.PI / NS) + 0.06, 0.3, 0.6), MAT.darkstone, st.stone); }
  const rr0 = RO - 0.25, hw0 = 2 * (RO + 0.1) * Math.sin(Math.PI / NS) / 2 + 0.04;
  for (let i = 0; i < NS; i++) { const a = (i * TAU) / NS, p = twP(T, a, rr0); C.floor(p.x, p.z, hw0, 0.32, a, TT, TT, TT - 0.5, 0.45, 'top'); }
  const open = o.open || [];
  const isOpen = (a) => open.some(([oa, w]) => Math.abs(angDiff(a, oa)) < w);
  const segs = 12;
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * TAU, a1 = ((k + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (isOpen(am)) continue;
    const rr = RO - 0.18, p0 = twP(T, a0, rr), p1 = twP(T, a1, rr);
    castleParapet(C, p0.x, p0.z, p1.x, p1.z, TT, { th: 0.36, bh: 0.95, mh: 0.0001, slits: false });
  }
  const posts = o.posts || [TAU / 8, (3 * TAU) / 8, (5 * TAU) / 8, (7 * TAU) / 8];
  for (const a of posts) {
    const p = twP(T, a, RO - 0.3);
    b.add(G.cyl8, lm(M, p.x, (TT + eave) / 2, p.z, 0, 0.13, eave - TT, 0.13), MAT.logH, st.logs);
    C.post(p.x, p.z, 0.18, TT, eave - TT);
  }
  b.add(G.cone12, lm(M, T.cx, eave + 1.8, T.cz, 0, RO + 0.55, 3.6, RO + 0.55), MAT.thatch, st.thatch);
  b.add(G.cyl12, lm(M, T.cx, eave + 0.02, T.cz, 0, RO - 0.1, 0.12, RO - 0.1), MAT.wood, st.wood);
  T.eave = eave; T.apex = eave + 3.6;
}

/* ------------------------------------------------------------------ */
/* floors, ladders, hatches, doors                                     */
/* ------------------------------------------------------------------ */
// a floor across the tower at height y out to rf (a radius, or a square's half-width), in strips across the line of
// its ladder's hatch (left open): boards on joists, flags on the ground, stone slabs on the top; each strip is also a
// floor people stand on
function towerFloor(T, y, rf, L, look) {
  const { C, S } = T, { M, st } = C, outside = look === 'top' || look === 'gallery', b = outside ? C.b : C.bi;
  const { R0, R1, HW } = T.ld;
  const a = L ? L.a : T.aIn, ux = Math.cos(a), uz = -Math.sin(a), vx = Math.sin(a), vz = Math.cos(a);
  const bounds = [-rf];
  for (let u = Math.ceil((-rf + 0.15) / 0.5) * 0.5; u < rf - 0.15; u += 0.5) bounds.push(u);
  bounds.push(rf);
  for (let k = 0; k + 1 < bounds.length; k++) {
    const u0 = bounds[k], u1 = bounds[k + 1], uc = (u0 + u1) / 2, w = u1 - u0;
    const uin = u0 < 0 && u1 > 0 ? 0 : Math.min(Math.abs(u0), Math.abs(u1));
    const vl = T.kind === 'drum' ? Math.sqrt(Math.max(0, rf * rf - uin * uin)) : rf;
    const hole = L && uc > -HW && uc < HW;
    const pieces = hole ? [[-vl, R0], [R1, vl]] : [[-vl, vl]];
    for (const [v0, v1] of pieces) {
      if (v1 - v0 < 0.05) continue;
      const vc = (v0 + v1) / 2, lx = T.cx + ux * uc + vx * vc, lz = T.cz + uz * uc + vz * vc;
      const shade = 0.86 + 0.2 * hash1(k * 3.7 + v0 + y);
      // [keeps] boards in the plaster branch, tinted as wood: the wood branch draws its planks along world x on a floor,
      // which crossed these strips wherever a keep is turned
      if (look === 'boards' || look === 'gallery') b.add(G.box, lm(M, lx, y - 0.06, lz, a, w - 0.025, 0.12, v1 - v0), MAT.plaster, darker(st.wood, shade * (look === 'gallery' ? 0.95 : 1)));
      else {
        // stone: the strip laid as flags about 0.8 m long, staggered from the strips beside it, each its own shade
        // and a hair lower or higher (no gap to see through)
        const Ln = v1 - v0, n = Math.max(1, Math.round(Ln / 0.8)), off = (k % 2) * 0.5;
        for (let q = 0; q < n + (off ? 1 : 0); q++) {
          const f0 = Math.max(0, (q - off) / n), f1 = Math.min(1, (q + 1 - off) / n);
          if (f1 - f0 < 0.02) continue;
          const va = v0 + Ln * f0, vb = v0 + Ln * f1, vm = (va + vb) / 2, sh2 = shade * (0.9 + 0.2 * hash1(k * 9.1 + q * 3.3 + y));
          const fx = T.cx + ux * uc + vx * vm, fz = T.cz + uz * uc + vz * vm, dy = (hash1(k * 5.3 + q * 7.1) - 0.5) * 0.012;
          if (look === 'flags') b.add(G.box, lm(M, fx, y - 0.2 + dy, fz, a, w, 0.4, vb - va), MAT.stone, darker(st.stone, 0.72 * sh2), S.y, 1);
          else b.add(G.box, lm(M, fx, y - 0.15 + dy, fz, a, w, 0.3, vb - va), MAT.stone, darker(st.stone, 1.02 * sh2));
        }
      }
      // the strips overlap a little, so no body ever finds the crack between two of them
      C.floor(lx, lz, w / 2 + 0.02, (v1 - v0) / 2 + (hole ? 0 : 0.02), a, y, y, y - 1.2, look === 'flags' ? 0 : outside ? 0.45 : 0.3, outside ? 'top' : 'tower');
    }
  }
  if (!T.levels.includes(y)) T.levels.push(y);
}
// joists under a room's boards, clear of its hatch
function towerJoists(T, y, L) {
  const { C } = T, { M, st } = C, b = C.bi, ri = T.RI, off = ri * 0.48;
  for (const o of [-off, off]) {
    const ua = L.a + Math.PI / 2, pc = twP(T, ua, o), Ln = T.kind === 'drum' ? 2 * Math.sqrt(ri * ri - o * o) : 2 * ri;
    b.add(G.box, lm(M, pc.x, y - 0.3, pc.z, ua + Math.PI / 2, 0.22, 0.24, Ln + 0.3), MAT.wood, darker(st.wood, 0.7));
  }
}
// a floor through a doorway at height y, bridging the room's floor and what lies outside (a walk, the courtyard)
function towerThreshold(T, a, y, off = 0) {
  const { C } = T, mid = (T.RO + T.RI) / 2, TH = T.RO - T.RI, p = twP(T, a, mid + 0.15, off);
  const f = C.floor(p.x, p.z, 0.55, TH / 2 + 0.45, a, y, y, y < 0.5 ? -1.2 : y - 1.2, y < 0.5 ? 0 : 0.3, 'tower');
  T.thresholds.push(f);
  return f;
}
// a ladder at angle a from the floor at yb to the floor at yt: its rails stand at the inner edge of the hatch above,
// the climber between them and the wall, facing in; at the top they step off forward onto the floor
function towerLadder(T, a, yb, yt) {
  const { C } = T, { M, st } = C, b = C.bi, D = T.ld;
  const L = { T, a, yb, yt, yaw: a + Math.PI, hatch: null, id: TOWER.ladders.length };
  const u = { x: Math.cos(a), z: -Math.sin(a) };
  const rail = twP(T, a, D.R0 + 0.04), h = yt - yb, wood = T.look === 'timber' ? darker(st.logs, 0.95) : st.wood;
  for (const sd of [-1, 1]) b.add(G.box, lm(M, rail.x + u.x * sd * 0.24, yb + h / 2, rail.z + u.z * sd * 0.24, a, 0.07, h, 0.09), MAT.wood, darker(wood, 0.8));
  for (let y = 0.3; y < h - 0.05; y += 0.3) b.add(G.cyl8, lm(M, rail.x, yb + y, rail.z, a, 0.028, 0.48, 0.028, 0, Math.PI / 2), MAT.wood, darker(wood, 0.95 + 0.1 * hash1(y * 7 + a)));
  // world points: the foot, the line it is climbed on, the step at the top
  const f = twW(T, a, D.FOOT), l = twW(T, a, D.LINE), o = twW(T, a, D.OFF);
  Object.assign(L, { fx: f.x, fz: f.z, lx: l.x, lz: l.z, ox: o.x, oz: o.z, wyb: T.S.y + yb, wyt: T.S.y + yt, yawW: T.S.yaw + a + Math.PI });
  L.foot = twP(T, a, D.FOOT); L.off = twP(T, a, D.OFF);
  T.ladders.push(L);
  TOWER.ladders.push(L);
  return L;
}
// a hatch over the top of a ladder: a lid of boards on two ledges, hinged at the wall side; shut it is a floor
function towerHatch(T, L) {
  const { S } = T, a = L.a, { R0, R1, HW } = T.ld;
  const hinge = twP(T, a, R1), w = siteToWorld(S, hinge.x, hinge.z);
  const c = twP(T, a, (R0 + R1) / 2);
  const Hh = { T, L, a, x: w.x, z: w.z, y: S.y + L.yt, k: 0, held: false, until: 0, part: null, hw: HW, hd: (R1 - R0) / 2, bump: 0 };
  Hh.floor = T.C.floor(c.x, c.z, HW, (R1 - R0) / 2, a, L.yt, L.yt, L.yt - 0.12, 0.12, 'hatch');
  const cw = siteToWorld(S, c.x, c.z);
  Hh.cx = cw.x; Hh.cz = cw.z;
  // the lid in its own frame: hinge along local x, the lid lying toward local -z, its top at y = 0
  const g = new Batch(), I = new THREE.Matrix4(), wood = darker(T.C.st.wood, 0.85), D = R1 - R0 - 0.03, W = 2 * HW, nb = 4, bw = W / nb;
  for (let i = 0; i < nb; i++) g.add(G.box, lm(I, -W / 2 + bw * (i + 0.5), -0.04, -D / 2, 0, bw - 0.01, 0.08, D), MAT.wood, darker(wood, 0.9 + 0.15 * hash1(i * 3.1 + a)));
  for (const z of [-0.2, -D + 0.2]) g.add(G.box, lm(I, 0, -0.1, z, 0, W - 0.08, 0.06, 0.12), MAT.wood, darker(wood, 0.7));
  g.add(G.box, lm(I, 0, 0.005, -D + 0.12, 0, 0.18, 0.02, 0.05), MAT.metal, [0.25, 0.25, 0.27]); // the ring to lift it by
  for (const sd of [-1, 1]) g.add(G.box, lm(I, sd * (HW - 0.18), 0.004, -0.15, 0, 0.06, 0.02, 0.3), MAT.metal, [0.25, 0.25, 0.27]);
  Hh.part = { batch: g, frame: () => lm(siteMatrix(S), hinge.x, L.yt, hinge.z, a, 1, 1, 1, Hh.k * 1.68 + Hh.bump) };
  // open, the lid stands up along its hinge: nobody walks through it
  const lc = twP(T, a, R1 + 0.04);
  Hh.lidColl = boxAt(S, lc.x, lc.z, HW, 0.07, 'prop', 1.05, a);
  Hh.lidColl.vert = true; Hh.lidColl.y0 = S.y + L.yt; Hh.lidColl.active = false;
  L.hatch = Hh;
  T.hatches.push(Hh);
  TOWER.hatches.push(Hh);
  return Hh;
}
// a door in the doorway at angle a (off along a square tower's wall), floor y, height h: boards on ledges, hung on
// the side `hand`, swinging in
function towerDoor(T, a, y, h, hand, off = 0) {
  const { S } = T, w = 0.92;
  const u = { x: Math.cos(a), z: -Math.sin(a) };
  const mid = twP(T, a, T.RI + 0.12, off);
  const hinge = { x: mid.x - u.x * hand * (w / 2), z: mid.z - u.z * hand * (w / 2) };
  const D = { T, a, y, h, hand, off, k: 0, want: 0, scan: 0, part: null };
  const cw = siteToWorld(S, mid.x, mid.z);
  D.x = cw.x; D.z = cw.z; D.wy = S.y + y;
  const cm = twP(T, a, (T.RO + T.RI) / 2, off);
  D.coll = boxAt(S, cm.x, cm.z, 0.6, (T.RO - T.RI) / 2 + 0.05, 'hdoor', h + 0.1, a);
  D.coll.vert = true; D.coll.y0 = S.y + y - 0.05;
  const g = new Batch(), I = new THREE.Matrix4(), wood = darker(T.C.st.wood, 0.78), iron = [0.24, 0.24, 0.26];
  for (let i = 0; i < 5; i++) g.add(G.box, lm(I, (i + 0.5) * (w / 5), h / 2, 0, 0, w / 5 - 0.01, h - 0.04, 0.07), MAT.wood, darker(wood, 0.88 + 0.2 * hash1(i * 7.7 + a)));
  for (const yy of [0.25, h - 0.3]) {
    g.add(G.box, lm(I, w / 2, yy, -0.06, 0, w - 0.08, 0.16, 0.06), MAT.wood, darker(wood, 0.72));
    g.add(G.box, lm(I, w * 0.4, yy, 0.045, 0, w * 0.75, 0.07, 0.02), MAT.metal, iron);
  }
  g.add(G.cyl8, lm(I, w * 0.86, h * 0.47, 0.05, 0, 0.05, 0.02, 0.05, Math.PI / 2), MAT.metal, iron);
  // the leaf's local +x runs from the hinge across the doorway: in the site frame along u for hand = 1, along -u
  // for hand = -1; it swings in (toward -v) as it opens
  const yaw0 = hand > 0 ? a : a + Math.PI, swing = hand * 1.62;
  D.part = { batch: g, frame: () => lm(siteMatrix(S), hinge.x, y, hinge.z, yaw0 + swing * D.k) };
  // open, the leaf stands out into the room: nobody walks through it
  const ph = yaw0 + swing, lx = hinge.x + Math.cos(ph) * (w / 2), lz = hinge.z - Math.sin(ph) * (w / 2);
  D.leafColl = boxAt(S, lx, lz, 0.05, w / 2, 'prop', h, ph + Math.PI / 2);
  D.leafColl.vert = true; D.leafColl.y0 = S.y + y; D.leafColl.active = false;
  T.doors.push(D);
  TOWER.doors.push(D);
  return D;
}
// a door and its doorway: the opening, the leaf, the floor through it
function towerEntry(T, a, y, h, hand, off = 0) {
  towerGap(T, a, y < 0.5 ? -0.02 : y, y + h, off);
  const D = towerDoor(T, a, y, h, hand, off);
  towerThreshold(T, a, y, off);
  return D;
}

/* ------------------------------------------------------------------ */
/* furniture and lights: data for each room                            */
/* ------------------------------------------------------------------ */
// items: { t: 'barrel'|'crate'|'rack'|'table'|'bench'|'arrows'|'wood'|'windlass'|'torch', a, r, y, s, rot }
function towerFurnish(T, items) {
  const { C, S } = T, { M, st } = C, b = C.bi, wood = st.wood;
  for (const it of items) {
    const { a, r, y } = it, s = it.s || 1, off = it.off || 0;
    const frame = (aa, rr, yy) => { const p = twP(T, aa, rr, off); return lm(M, p.x, yy, p.z, aa + Math.PI); }; // +z faces into the room
    const prop = (aa, rr, pr, yy, h) => { const p = twP(T, aa, rr, off); const c = circleAt(S, p.x, p.z, pr, 'prop', h); c.vert = true; c.y0 = S.y + yy; T.props.push(c); };
    if (it.t === 'barrel') { const p = twP(T, a, r, off); roomBarrel(b, lm(M, 0, y, 0), p.x, p.z, s, wood, it.rot || 0); prop(a, r, 0.36 * s, y, 1.0); }
    else if (it.t === 'crate') { const F = frame(a, r, y); roomCrate(b, F, 0, 0, 0, 0.6 * s, wood, 0.2); if (it.two) roomCrate(b, F, 0.05, 0.6 * s, 0.02, 0.5 * s, wood, -0.3); prop(a, r, 0.45 * s, y, 1.2); }
    else if (it.t === 'rack') {
      // a rack of spears: two uprights, a rail, spears leaning in it
      const F = frame(a, r, y), n = it.n || 5, hw = 0.11 * n;
      for (const sx of [-hw, hw]) b.add(G.box, lm(F, sx, 0.75, 0, 0, 0.08, 1.5, 0.08), MAT.wood, darker(wood, 0.75));
      b.add(G.box, lm(F, 0, 1.25, 0.02, 0, 2 * hw + 0.1, 0.07, 0.07), MAT.wood, darker(wood, 0.75));
      for (let i = 0; i < n; i++) {
        const x = -hw + 0.11 + i * 0.22;
        b.add(G.cyl8, lm(F, x, 1.05, 0.1, 0, 0.022, 2.1, 0.022, -0.09), MAT.wood, darker(wood, 0.95));
        b.add(G.cone8, lm(F, x, 2.18, 0.2, 0, 0.04, 0.22, 0.04, -0.09), MAT.metal, [0.5, 0.5, 0.52]);
      }
      prop(a, r, 0.3, y, 1.6);
    } else if (it.t === 'table') {
      // a table and a bench, a jug and a cup on it
      const F = frame(a, r, y), w = it.w || 1.1;
      b.add(G.box, lm(F, 0, 0.74, 0, 0, w, 0.07, 0.62), MAT.wood, darker(wood, 0.95));
      for (const [x, z] of [[-w / 2 + 0.07, -0.24], [w / 2 - 0.07, -0.24], [-w / 2 + 0.07, 0.24], [w / 2 - 0.07, 0.24]]) b.add(G.box, lm(F, x, 0.36, z, 0, 0.07, 0.72, 0.07), MAT.wood, darker(wood, 0.8));
      b.add(G.box, lm(F, 0, 0.42, -0.62, 0, w, 0.06, 0.3), MAT.wood, darker(wood, 0.9));
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) b.add(G.box, lm(F, x, 0.2, -0.62, 0, 0.06, 0.4, 0.26), MAT.wood, darker(wood, 0.8));
      roomPot(b, F, 0.25, 0.775, 0.05, 0.07, 0.18, ROOM.clay);
      b.add(G.cyl12, lm(F, -0.2, 0.79, -0.05, 0, 0.11, 0.025, 0.11), MAT.metal, ROOM.pewter);
      prop(a, r + 0.05, w * 0.68, y, 0.9);
    } else if (it.t === 'bench') {
      const F = frame(a, r, y), w = it.w || 1.0;
      b.add(G.box, lm(F, 0, 0.42, 0, 0, w, 0.06, 0.3), MAT.wood, darker(wood, 0.9));
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) b.add(G.box, lm(F, x, 0.2, 0, 0, 0.06, 0.4, 0.26), MAT.wood, darker(wood, 0.8));
      prop(a, r, w * 0.45, y, 0.5);
    } else if (it.t === 'arrows') {
      // a barrel of arrows for the archers above
      const p = twP(T, a, r, off);
      roomBarrel(b, lm(M, 0, y, 0), p.x, p.z, s, wood, 0.4);
      for (let i = 0; i < 9; i++) { const q = twP(T, a, r + (hash1(i * 5.1) - 0.5) * 0.25 * s, off + (hash1(i * 3.3) - 0.5) * 0.25 * s); b.add(G.cyl8, lm(M, q.x, y + 0.95 * s + 0.1, q.z, hash1(i) * 6, 0.012, 0.75, 0.012, (hash1(i * 7.7) - 0.5) * 0.3), MAT.wood, [0.62, 0.52, 0.36]); }
      prop(a, r, 0.34 * s, y, 1.0);
    } else if (it.t === 'wood') {
      // a stack of firewood against the wall
      const F = frame(a, r, y);
      for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - row; i++) b.add(G.cyl8, lm(F, -0.45 + i * 0.18 + row * 0.09, 0.09 + row * 0.16, 0, 0, 0.08, 0.6, 0.08, Math.PI / 2), MAT.logH, darker(st.logs, 0.8 + 0.3 * hash1(row * 7 + i)));
      prop(a, r, 0.55, y, 0.7);
    } else if (it.t === 'windlass') {
      // the portcullis' windlass: a drum on two posts with a capstan's spokes, the chain going up into the wall
      const F = frame(a, r, y);
      for (const sx of [-0.55, 0.55]) b.add(G.box, lm(F, sx, 0.55, 0, 0, 0.14, 1.1, 0.2), MAT.wood, darker(wood, 0.72));
      b.add(G.cyl12, lm(F, 0, 0.85, 0, 0, 0.2, 1.0, 0.2, 0, Math.PI / 2), MAT.wood, darker(wood, 0.85));
      for (let i = 0; i < 4; i++) b.add(G.box, lm(F, 0.62, 0.85, 0, 0, 0.05, 0.9, 0.05, (i * Math.PI) / 4), MAT.wood, darker(wood, 0.9));
      for (let i = 0; i < 6; i++) b.add(G.box, lm(F, -0.1 + (i % 2) * 0.02, 1.1 + i * 0.25, 0.18, 0, 0.05, 0.22, 0.08), MAT.metal, ROOM.iron);
      prop(a, r, 0.62, y, 1.2);
    } else if (it.t === 'torch') {
      // a torch in an iron bracket: a real fire with a light
      const p = twP(T, a, T.RI - 0.16, off), F = frame(a, T.RI - 0.05, y);
      b.add(G.box, lm(F, 0, -0.08, 0.06, 0, 0.05, 0.05, 0.22), MAT.metal, [0.2, 0.2, 0.21]);
      b.add(G.cyl8, lm(F, 0, -0.16, 0.16, 0, 0.035, 0.42, 0.035, -0.25), MAT.wood, [0.3, 0.2, 0.12]);
      const w = siteToWorld(S, p.x, p.z);
      addFire(w.x, S.y + y + 0.06, w.z, 0.28, false, Infinity, { r: 7, k: 1.15 });
      FIRES[FIRES.length - 1].wall = true; // [v10] a torch on the wall: a brand may be lit from it, nothing cooked over it
      T.fires.push({ x: w.x, y: S.y + y, z: w.z });
    }
  }
}

/* ------------------------------------------------------------------ */
/* the towers of each keep                                             */
/* ------------------------------------------------------------------ */
// the wall colliders that ran through a tower's rooms are cut back into its masonry (01_world.js laid the keep's
// walls out whole; the curtains' meshes end there too: keepStone, keepRound, keepTimber in 04_props.js)
function towerCutWalls(T) {
  const S = T.S, mid = (T.RI + T.RO) / 2;
  for (const c of S.colliders.slice()) {
    if (c.tag !== 'wall' || c.type !== 'box' || !c.active || c.tower) continue;
    const alongX = c.hx >= c.hz, ext = alongX ? c.hx : c.hz, wd = alongX ? c.hz : c.hx;
    const ax = alongX ? c.cos : c.sin, az = alongX ? -c.sin : c.cos;
    const dx = T.wx - c.x, dz = T.wz - c.z, u = dx * ax + dz * az, v = -dx * az + dz * ax;
    if (Math.abs(v) > wd + T.RI) continue;
    const half = T.kind === 'drum' ? Math.sqrt(Math.max(0, mid * mid - v * v)) : mid;
    if (half <= 0 || u + half < -ext || u - half > ext) continue;
    c.active = false; c.cut = true;
    const piece = (p0, p1) => {
      if (p1 - p0 < 0.05) return;
      const m = (p0 + p1) / 2, h = (p1 - p0) / 2;
      const n = addBox(c.x + ax * m, c.z + az * m, alongX ? h : c.hx, alongX ? c.hz : h, c.yaw, c.tag, c.h);
      n.vert = c.vert; n.y0 = c.y0; n.baseY = c.baseY;
      S.colliders.push(n);
    };
    piece(-ext, Math.min(ext, u - half)); piece(Math.max(-ext, u + half), ext);
  }
}
// what every tower does last: no grass in it, the rain and snow kept out of its rooms, on the list
function towerFinish(T, shelterY) {
  const { S } = T;
  towerCutWalls(T);
  if (T.kind === 'drum') clearCoverDisc(T.wx, T.wz, T.RI + 0.2, 0.6);
  else clearCoverBox(T.wx, T.wz, T.HI + 0.2, T.HI + 0.2, S.yaw, 0.6);
  T.shelterY = shelterY;
  T.rain = T.kind === 'drum' ? { x: T.wx, z: T.wz, c: 1, s: 0, round: true, Rr: T.RI, y: S.y, y0: shelterY, hc: 0.01 }
    : { x: T.wx, z: T.wz, c: Math.cos(S.yaw), s: Math.sin(S.yaw), w: 2 * T.HI, d: 2 * T.HI, ohSide: 0, ohGable: 0, y: S.y, wallH: shelterY, rh: 0.01, tn: 0 };
  T.levels.sort((p, q) => p - q);
  TOWER.list.push(T);
  return T;
}

// Logres: a corner tower of the stone keep (version 10). sx, sz: which corner; H the walk's height, TT the fighting
// top's (above the site), TC the corner's distance out. A door from the courtyard into a store room; a ladder up through
// a hatch into the guard room at the walks' height, which has a door onto each walk; a ladder up through a hatch onto
// the fighting top. Arrow slits look out of both rooms and a torch burns in each.
function towerStone(C, sx, sz, H, TT, TC) {
  const T = towerNew(C, { kind: 'drum', look: 'stone', role: 'corner', sx, sz, cx: sx * TC, cz: sz * TC, H, TT, RO: TW.RO, RI: TW.RI, NS: TW.NS });
  T.aIn = Math.atan2(-sx, -sz); // toward the courtyard
  T.aSide = Math.atan2(0, -sz); // onto the walk along the side wall
  T.aFB = Math.atan2(-sx, 0); // onto the walk along the front or back wall
  T.iIn = towerGap(T, T.aIn, -0.02, T.yG + 2.3);
  T.iSide = towerGap(T, T.aSide, H, H + 2.2);
  T.iFB = towerGap(T, T.aFB, H, H + 2.2);
  const out = T.aIn + Math.PI;
  towerShellDrum(T, { top: TT - 0.3, slits: [out, out + 0.785, out - 0.785, out + 1.571, out - 1.571].map((a) => [a, [[T.yG + 1.0, T.yG + 2.1], [H + 0.8, H + 1.9]]]) });
  // where people stand: the courtyard doorway and the floors
  const TH = TW.RO - TW.RI, thr = twP(T, T.aIn, (TW.RO + TW.RI) / 2 + 0.15);
  T.thresholds.push(C.floor(thr.x, thr.z, 0.55, TH / 2 + 0.45, T.aIn, T.yG, T.yG, -1.2, 0, 'tower'));
  // the ladders and the hatches they climb through: from the store room to the guard room on the outer side, from the
  // guard room to the top on the courtyard side
  const L0 = towerLadder(T, T.aIn + Math.PI, T.yG, H);
  const L1 = towerLadder(T, T.aIn, H, TT);
  towerFloor(T, T.yG, TW.RI + 0.06, null, 'flags');
  towerFloor(T, H, TW.RI + 0.06, L0, 'boards');
  towerFloor(T, TT, 3.0, L1, 'top');
  towerJoists(T, H, L0);
  for (const L of T.ladders) towerHatch(T, L);
  // doors: the courtyard's, and one onto each walk, hung on the side away from the ladder up, so an open leaf is
  // never in the way to it
  towerDoor(T, T.aIn, T.yG, 2.3, 1);
  towerDoor(T, T.aSide, H, 2.2, angDiff(T.aSide, T.aIn) > 0 ? 1 : -1);
  towerDoor(T, T.aFB, H, 2.2, angDiff(T.aFB, T.aIn) > 0 ? 1 : -1);
  // a store below (barrels and crates either side of the ladder, a rack of spears by the door) and a guard room above
  // (a table and a bench on the outer side, a barrel of arrows), each with a torch on the wall
  const A = T.aIn, yG = T.yG;
  towerFurnish(T, [
    { t: 'barrel', a: A + Math.PI + 1.05, r: 1.85, y: yG, s: 1, rot: 3.15 }, { t: 'barrel', a: A + Math.PI + 1.45, r: 1.85, y: yG, s: 0.92, rot: 4.35 }, { t: 'barrel', a: A + Math.PI - 1.1, r: 1.85, y: yG, s: 1.05, rot: -3.3 },
    { t: 'crate', a: A + Math.PI - 1.55, r: 1.9, y: yG, two: true }, { t: 'rack', a: A + 0.85, r: 2.15, y: yG },
    { t: 'table', a: A + Math.PI + 1.05, r: 1.55, y: H }, { t: 'arrows', a: A + Math.PI - 1.15, r: 1.9, y: H, s: 0.85 },
    { t: 'torch', a: A + 1.6, y: yG + 1.95 }, { t: 'torch', a: A - 1.6, y: H + 1.95 },
  ]);
  towerTopCrenels(T, { pole: true });
  return towerFinish(T, TT - 0.31);
}

// [keeps] Logres: a gate tower of the stone keep, a drum either side of the gate (the portcullis rises into the
// gatehouse between them). A door from the courtyard into the gate-ward's room, a ladder up through a hatch into a
// room at the walks' height with a door onto the front walk and one onto the walk over the gate, a ladder up through
// a hatch onto an open fighting top with crenels over the gate
const GATE_TW = { stone: { x: GATE_HW + 1.9, z: KEEP_HS - 0.8, RO: 2.3, RI: 1.55, NS: 10 }, round: { x: 3.9, z: 15.9, RO: 2.6, RI: 1.85, NS: 12 }, timber: { x: GATE_HW + 2.1, z: 14.7, HO: 2.1, HI: 1.68 } };
function towerGateStone(C, sx, H, TT) {
  const g = GATE_TW.stone;
  const T = towerNew(C, { kind: 'drum', look: 'stone', role: 'gate', sx, sz: 1, cx: sx * g.x, cz: g.z, H, TT, RO: g.RO, RI: g.RI, NS: g.NS });
  T.aIn = Math.PI; // the courtyard door looks in, away from the gate's outer face
  T.aWalk = twSnap(T, sx * 1.7); // onto the front walk
  T.aOver = twSnap(T, -sx * 1.94); // onto the walk over the gate
  towerEntry(T, T.aIn, T.yG, 2.2, sx);
  towerEntry(T, T.aWalk, H, 2.15, sx); // (the leaves are hung on the side away from the ladder up)
  towerEntry(T, T.aOver, H, 2.15, -sx);
  const slitA = [0, TAU / 10, -TAU / 10, (2 * TAU) / 10, (-2 * TAU) / 10];
  towerShellDrum(T, { top: TT - 0.3, slits: slitA.map((a) => [a, [[T.yG + 1.1, T.yG + 2.1], [H + 0.8, H + 1.8]]]) });
  const L0 = towerLadder(T, 0, T.yG, H); // the outer side
  const L1 = towerLadder(T, Math.PI, H, TT); // the courtyard side
  towerFloor(T, T.yG, g.RI + 0.06, null, 'flags');
  towerFloor(T, H, g.RI + 0.06, L0, 'boards');
  towerFloor(T, TT, g.RO - 0.4, L1, 'top');
  towerJoists(T, H, L0);
  for (const L of T.ladders) towerHatch(T, L);
  const yG = T.yG;
  // below: a barrel, a crate and a rack of spears clear of the way from the door to the ladder; above: a bench and a
  // barrel of arrows either side of the hatch; a torch in each room
  towerFurnish(T, [
    { t: 'barrel', a: sx * 1.25, r: 1.05, y: yG, s: 0.8, rot: 1.1 }, { t: 'rack', a: -sx * 0.95, r: 1.25, y: yG, n: 3 }, { t: 'crate', a: sx * 1.9, r: 1.05, y: yG, s: 0.85 },
    { t: 'bench', a: -sx * 0.9, r: 1.1, y: H, w: 0.8 }, { t: 'arrows', a: sx * 0.95, r: 1.15, y: H, s: 0.72 },
    { t: 'torch', a: -sx * 2.2, y: yG + 1.95 }, { t: 'torch', a: sx * 2.6, y: H + 1.9 },
  ]);
  towerTopCrenels(T, { n: 10, step: 1.3 });
  return towerFinish(T, TT - 0.31);
}
// the way from the side walk in at a corner tower's door, across the guard room and up its ladder onto the top
// (castleStone's posts): points in the site frame, the ladder's ends with their heights and the ladder
function towerWayUp(T, wc) {
  const L = T.ladders[1], door = twP(T, T.aSide, TW.RO + 0.5), inside = twP(T, T.aSide, TW.RI - 0.6);
  return [[T.sx * wc, door.z], [inside.x, inside.z], [L.foot.x, L.foot.z, T.H, L], [L.off.x, L.off.z, T.TT, L]];
}
// [keeps] the way in at a tower's courtyard door, up its ladders onto the top: points in the site frame, a ladder's ends with
// their heights and the ladder (castleRoute's posts); from: [lx, lz] in the courtyard before the door
function towerWayIn(T, from) {
  const D = T.doors[0], out = twP(T, D.a, T.RO + 0.6, D.off), inn = twP(T, D.a, T.RI - 0.5, D.off);
  const pts = [from, [out.x, out.z], [inn.x, inn.z]];
  for (const L of T.ladders) pts.push([L.foot.x, L.foot.z, L.yb, L], [L.off.x, L.off.z, L.yt, L]);
  return pts;
}

// [keeps] Eriu: a gate tower of the rath, a drum of stone either side of the gate under a thatched cone. A door from
// the courtyard into a store room; a ladder up through a hatch onto the platform under the thatch at the walks'
// height, where the wall walk comes in, with a breastwork round it
function towerGateRath(C, sx, WT) {
  const g = GATE_TW.round;
  const T = towerNew(C, { kind: 'drum', look: 'rath', role: 'gate', sx, sz: 1, cx: sx * g.x, cz: g.z, H: WT, TT: WT, RO: g.RO, RI: g.RI, NS: g.NS });
  T.aIn = Math.PI;
  towerEntry(T, T.aIn, T.yG, 2.2, -sx);
  towerShellDrum(T, { top: WT - 0.3, slits: [0, TAU / 12, -TAU / 12, (2 * TAU) / 12].map((a) => [a, [[T.yG + 1.0, T.yG + 2.0], [T.yG + 3.6, T.yG + 4.6]]]) });
  const L0 = towerLadder(T, -sx * (Math.PI / 2), T.yG, WT); // toward the gate
  towerFloor(T, T.yG, g.RI + 0.06, null, 'flags');
  towerFloor(T, WT, g.RO - 0.55, L0, 'top');
  towerHatch(T, L0);
  const yG = T.yG;
  towerFurnish(T, [
    { t: 'barrel', a: sx * 0.55, r: 1.25, y: yG, s: 0.9, rot: 2.1 }, { t: 'barrel', a: sx * 1.05, r: 1.32, y: yG, s: 0.8, rot: 0.7 }, { t: 'crate', a: sx * 2.35, r: 1.25, y: yG, two: true, s: 0.9 },
    { t: 'wood', a: sx * 1.75, r: 1.45, y: yG }, { t: 'torch', a: -sx * 2.3, y: yG + 1.95 },
  ]);
  // the walk comes in on the far side from the gate
  T.aWalk = sx * 1.84;
  towerTopThatch(T, { open: [[T.aWalk, 0.52]], posts: [sx * 0.6, sx * 2.55, -sx * 0.9, -sx * 2.4] });
  return towerFinish(T, T.eave);
}

// [keeps] Eriu: a side lookout of the rath, a drum in the ring wall under a thatched cone, the walk running on through
// its platform. A door from the courtyard into a store room; a ladder up through a hatch onto the platform
function towerLookout(C, sx, WT) {
  const T = towerNew(C, { kind: 'drum', look: 'rath', role: 'lookout', sx, sz: 0, cx: sx * RATH_R, cz: 0, H: WT, TT: WT, RO: 2.3, RI: 1.6, NS: 10 });
  T.aIn = -sx * (Math.PI / 2); // toward the courtyard's middle
  towerEntry(T, T.aIn, T.yG, 2.2, 1);
  const out = sx * (Math.PI / 2);
  towerShellDrum(T, { top: WT - 0.3, slits: [out, out + TAU / 10, out - TAU / 10].map((a) => [a, [[T.yG + 1.0, T.yG + 2.0], [T.yG + 3.6, T.yG + 4.6]]]) });
  const L0 = towerLadder(T, out, T.yG, WT); // the outer side
  towerFloor(T, T.yG, T.RI + 0.06, null, 'flags');
  towerFloor(T, WT, T.RO - 0.55, L0, 'top');
  towerHatch(T, L0);
  const yG = T.yG;
  towerFurnish(T, [
    { t: 'barrel', a: out + 1.25, r: 1.0, y: yG, s: 0.85, rot: 0.4 }, { t: 'barrel', a: out - 1.3, r: 1.0, y: yG, s: 0.8, rot: 2.2 },
    { t: 'crate', a: T.aIn + 1.0, r: 1.0, y: yG, s: 0.8 }, { t: 'torch', a: T.aIn - 1.0, y: yG + 1.95 },
  ]);
  // the walk comes through along the wall, and the side toward the courtyard is open; the breastwork on the outer half
  towerTopThatch(T, { open: [[0, 0.62], [Math.PI, 0.62], [T.aIn, 1.0]], posts: [TAU / 8, (3 * TAU) / 8, (5 * TAU) / 8, (7 * TAU) / 8] });
  return towerFinish(T, T.eave);
}

// [keeps] Thule: a tower of the burh, a square shaft of logs on a stone footing. A door from the courtyard into a store
// room; a ladder up through a hatch into a room at the walks' height, with a door onto each walk that meets it; a
// ladder up through a hatch into the fighting gallery under the shingle roof. role: 'corner' (sx, sz) or 'gate' (sx)
function towerTimber(C, role, sx, sz, WT, TT) {
  const corner = role === 'corner', g = GATE_TW.timber;
  const cx = corner ? sx * (KEEP_HS - 1.2) : sx * g.x, cz = corner ? sz * (KEEP_HS - 1.2) : g.z;
  const HO = corner ? 2.7 : g.HO, HI = corner ? 2.25 : g.HI;
  const T = towerNew(C, { kind: 'square', look: 'timber', role, sx, sz: corner ? sz : 1, cx, cz, H: WT, TT, HO, HI });
  const offAt = (a, lx, lz) => (lx - cx) * Math.cos(a) - (lz - cz) * Math.sin(a); // along the wall facing a, to a site point
  const wc = (KEEP_HS - KEEP_T / 2 - 0.5 - 1.6 + KEEP_HS - KEEP_T / 2 - 0.5) / 2; // the walks' middle line (castleTimber)
  // a door off the middle of its wall is hung on the side toward the corner: open, its leaf lies along the wall there
  const entry = (a, y, h, off) => towerEntry(T, a, y, h, off > 0.05 ? -1 : 1, off);
  if (corner) {
    T.aIn = Math.atan2(0, -sz); // the wall facing the side walk and the courtyard
    T.aFB = Math.atan2(-sx, 0); // the wall facing the front walk
    entry(T.aIn, T.yG, 2.2, offAt(T.aIn, sx * 13.3, cz));
    entry(T.aIn, WT, 2.15, offAt(T.aIn, sx * wc, cz));
    if (sz > 0) entry(T.aFB, WT, 2.15, offAt(T.aFB, cx, sz * wc));
  } else {
    T.aIn = Math.PI;
    T.aFB = Math.atan2(sx, 0); // onto the front walk
    entry(T.aIn, T.yG, 2.2, 0);
    entry(T.aFB, WT, 2.15, offAt(T.aFB, cx, wc));
  }
  // the ladders against the walls with no doors: the outer ones of a corner tower, the gate's side of a gate tower
  const a0 = corner ? Math.atan2(sx, 0) : 0, a1 = corner ? Math.atan2(0, sz) : Math.atan2(-sx, 0);
  const slits = [];
  for (const [a, y0] of [[a0, T.yG + 1.0], [a0, WT + 0.8], [a1, T.yG + 1.0], [a1, WT + 0.8]]) for (const off of [-0.9, 0.9]) slits.push([a, off, y0, y0 + 0.5]);
  towerShellSquare(T, { top: TT - 0.12, foot: 1.8, plates: [WT - 0.15, TT - 0.18], slits });
  const L0 = towerLadder(T, a0, T.yG, WT), L1 = towerLadder(T, a1, WT, TT);
  towerFloor(T, T.yG, HI + 0.06, null, 'boards');
  towerFloor(T, WT, HI + 0.06, L0, 'boards');
  const f0 = C.floors.length;
  towerFloor(T, TT, HO, L1, 'gallery');
  T.topFloors = C.floors.slice(f0); // [keeps] what falls in when it burns (04n_towerfire.js)
  towerJoists(T, WT, L0);
  for (const L of T.ladders) towerHatch(T, L);
  // furniture against the walls (a: the wall, off: along it, r: out from the middle), clear of the doors, the
  // ladders' feet and the hatches; the walls' tangents: aIn and aFB face in, a0 and a1 out
  const yG = T.yG, rw = HI - 0.4, ox = (a, lx, lz) => offAt(a, lx, lz);
  towerFurnish(T, corner ? [
    { t: 'barrel', a: a1, off: ox(a1, cx - sx * 0.9, cz), r: rw, y: yG, s: 0.95 }, { t: 'barrel', a: a1, off: ox(a1, cx - sx * 0.2, cz), r: rw, y: yG, s: 0.85, rot: 1.2 },
    { t: 'crate', a: a1, off: ox(a1, cx + sx * 1.2, cz), r: rw - 0.05, y: yG, two: true }, { t: 'wood', a: T.aFB, off: ox(T.aFB, cx, cz + sz * 0.4), r: HI - 0.35, y: yG },
    { t: 'rack', a: a0, off: ox(a0, cx, cz - sz * 1.3), r: HI - 0.25, y: yG, n: 3 },
    { t: 'table', a: a0, off: ox(a0, cx, cz - sz * 1.3), r: HI - 0.8, y: WT, w: 0.9 }, { t: 'arrows', a: a1, off: ox(a1, cx + sx * 1.3, cz), r: rw, y: WT, s: 0.85 },
    { t: 'torch', a: T.aFB, off: ox(T.aFB, cx, cz - sz * 0.6), y: yG + 1.95 }, { t: 'torch', a: a1, off: ox(a1, cx - sx * 1.3, cz), y: WT + 1.9 },
  ] : [
    { t: 'barrel', a: T.aFB, off: ox(T.aFB, cx, cz + 0.7), r: HI - 0.43, y: yG, s: 0.85 }, { t: 'crate', a: a1, off: ox(a1, cx, cz - 0.6), r: HI - 0.48, y: yG, s: 0.9 },
    { t: 'rack', a: T.aFB, off: ox(T.aFB, cx, cz - 0.8), r: HI - 0.28, y: yG, n: 3 },
    { t: 'bench', a: T.aFB, off: ox(T.aFB, cx, cz + 0.8), r: HI - 0.48, y: WT, w: 0.8 }, { t: 'arrows', a: a1, off: ox(a1, cx, cz + 1.0), r: HI - 0.43, y: WT, s: 0.75 },
    { t: 'torch', a: a1, off: ox(a1, cx, cz + 0.6), y: yG + 1.95 }, { t: 'torch', a: a0, off: ox(a0, cx - sx * 1.0, cz), y: WT + 1.9 },
  ]);
  const c0 = C.colls.length;
  towerTopGallery(T, corner ? { eave: 2.3, rh: 3.6 } : { eave: 2.2, rh: 3.0 });
  T.topColls = C.colls.slice(c0);
  return towerFinish(T, T.eave);
}

/* ------------------------------------------------------------------ */
/* shelter: the rooms keep the rain and snow out                       */
/* ------------------------------------------------------------------ */
// is (x, z) inside a tower's walls, below its shelter (a roof, or the floor of an open top)? y: the body's feet;
// leave it out for the ground
function towerRoofOver(x, z, y = -Infinity) {
  for (const T of TOWER.list) {
    if (Math.abs(x - T.wx) > T.RO || Math.abs(z - T.wz) > T.RO) continue;
    if (y >= T.S.y + T.shelterY - 0.2) continue;
    const l = twLocal(T, x, z);
    if (twInside(T, l.x, l.z)) return true;
  }
  return false;
}
// the towers near the camera join the houses' roofs in the rain and snow shaders (houseRoofsForRain, 04e_houses.js)
function towerRoofsForRain(list, cx, cz) {
  for (const T of TOWER.list) {
    const d = dist2(cx, cz, T.wx, T.wz);
    if (d < 60 * 60) list.push([d, T.rain]);
  }
}
// [keeps] the tower whose rooms (not its open top) hold a body: { T, lv } with lv the index of its floor, or null
function towerRoomOf(e) {
  if (!TOWER.list.length || e.x > DUN_X0) return null;
  for (const T of TOWER.list) {
    if (Math.abs(e.x - T.wx) > T.RO + 0.5 || Math.abs(e.z - T.wz) > T.RO + 0.5) continue;
    const l = twLocal(T, e.x, e.z);
    if (!twInside(T, l.x, l.z, 0.1)) continue;
    const y = e.y - T.S.y;
    if (y < T.yG - 1.5 || y > T.TT + 0.6) continue;
    let lv = 0;
    for (let i = 0; i < T.levels.length; i++) if (y > T.levels[i] - 0.6) lv = i;
    return { T, lv, top: lv === T.levels.length - 1 };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* the moving parts: one mesh a keep for its doors and hatch lids      */
/* ------------------------------------------------------------------ */
function towerParts(C) {
  const Ts = TOWER.list.filter((T) => T.C === C);
  const parts = [];
  for (const T of Ts) { for (const D of T.doors) parts.push(D.part); for (const Hh of T.hatches) parts.push(Hh.part); }
  if (!parts.length) return;
  let n = 0;
  const pos = [], nrm = [], col = [], matA = [], ao = [], idx = [];
  for (const p of parts) {
    const g = p.batch;
    p.v0 = n; p.n = g.n; p.lp = Float32Array.from(g.pos); p.ln = Float32Array.from(g.nrm);
    for (let i = 0; i < g.idx.length; i++) idx.push(g.idx[i] + n);
    for (let i = 0; i < g.pos.length; i++) { pos.push(0); nrm.push(0); col.push(g.col[i]); }
    for (let i = 0; i < g.n; i++) { matA.push(g.mat[i]); ao.push(g.ao[i]); }
    n += g.n;
    p.batch = null;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aMat', new THREE.Float32BufferAttribute(matA, 1));
  geo.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  const K = { C, parts, geo, dirty: true };
  for (const p of parts) p.K = K;
  towerPose(K);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += 3;
  const m = new THREE.Mesh(geo, C.mesh ? C.mesh.material : buildingMat); // [keeps] the castle's material: a burnt tower's char and cut (04n_towerfire.js)
  m.renderOrder = 1;
  scene.add(m);
  shadowCaster(m, BUILDING_DEPTH);
  K.mesh = m;
  TOWER.keeps.push(K);
}
const _twV = new THREE.Vector3(), _twN = new THREE.Matrix3();
function towerPose(K) {
  const P = K.geo.attributes.position.array, N = K.geo.attributes.normal.array;
  for (const p of K.parts) {
    const Mw = p.frame();
    _twN.getNormalMatrix(Mw);
    for (let i = 0; i < p.n; i++) {
      const j = i * 3, o = (p.v0 + i) * 3;
      _twV.set(p.lp[j], p.lp[j + 1], p.lp[j + 2]).applyMatrix4(Mw);
      P[o] = _twV.x; P[o + 1] = _twV.y; P[o + 2] = _twV.z;
      _twV.set(p.ln[j], p.ln[j + 1], p.ln[j + 2]).applyMatrix3(_twN).normalize();
      N[o] = _twV.x; N[o + 1] = _twV.y; N[o + 2] = _twV.z;
    }
  }
  K.geo.attributes.position.needsUpdate = true;
  K.geo.attributes.normal.needsUpdate = true;
  K.dirty = false;
  TOWER.stats.rebuilt++;
}
function buildTowers() {
  for (const C of CASTLES) towerParts(C);
  for (const C of CASTLES) {
    if (!C.bi) continue;
    const m = new THREE.Mesh(C.bi.build(), C.mesh ? C.mesh.material : buildingMat); // [keeps] (as the moving parts)
    C.bi = null;
    m.renderOrder = 1;
    m.visible = false;
    scene.add(m);
    TOWER.inner.push({ m, x: C.S.x, z: C.S.z });
  }
  towerHeaps(); // [keeps] the charred timbers of a fallen gallery, hidden (04n_towerfire.js)
  for (const C of CASTLES) castleTowerUpload(C);
  if (window.__hm) window.__hm.towers = { TOWER, TW, GATE_TW, towerClimb, towerLadderStart, towerOffers, updateTowers, towerRoomOf, twDims, list: () => TOWER.list, ladder: (i) => TOWER.ladders[i], seen: (e) => { e._losT = -1; return npSeen(e, dist(camera.position.x, camera.position.z, e.x, e.z)); } };
}

/* ------------------------------------------------------------------ */
/* climbing                                                            */
/* ------------------------------------------------------------------ */
// e climbs L up (dir 1) or down (-1): to the ladder, along it, off it; a shut hatch on the way is pushed open
function towerClimb(e, L, dir) {
  if (e.motion || !e.alive) return false;
  if (e.mount) dismount(e);
  const up = dir > 0, h = L.wyt - L.wyb;
  const m = { kind: 'ladder', L, dir, t: 0, st: 0, y: up ? L.wyb : L.wyt, t0: up ? 0.35 : 0.45, t2: up ? 0.45 : 0.35 };
  m.dur = m.t0 + h / TW.CLIMB + m.t2;
  m.sx = e.x; m.sz = e.z; m.syaw = e.yaw;
  m.lock = true; // [keeps] the keys that started the climb do not turn it back (ladderRungs)
  e.motion = m;
  e.casting = null;
  setAct(e, 14, m.dur + 0.6);
  return true;
}
// a body at the start of a ladder (its foot to go up, the step beside its hatch to go down) begins to climb
function towerLadderStart(e, L, dir) {
  if (!dir || e.motion || L.gone) return false;
  const up = dir > 0, sx = up ? L.fx : L.ox, sz = up ? L.fz : L.oz, sy = up ? L.wyb : L.wyt;
  if (Math.abs(e.y - sy) > 0.9 || dist(e.x, e.z, sx, sz) > 0.85) return false;
  return towerClimb(e, L, dir);
}
// updateMotion (07_entities.js) hands a ladder motion here; true while the body is on its way
function towerLadderStep(e, m, dt) {
  const L = m.L, Hh = L.hatch;
  if (!e.alive) { e.motion = null; return false; }
  if (m.st === 3) return ladderFallStep(e, m, dt); // [keeps] knocked off (04m_ladders.js)
  m.t += dt;
  e.onGround = true; e.vy = 0;
  if (m.st === 0) {
    // onto the ladder: from where the body stood to the line it climbs on, turning to face the rungs
    const k = smooth(clamp(m.t / m.t0, 0, 1));
    e.x = lerp(m.sx, L.lx, k); e.z = lerp(m.sz, L.lz, k);
    e.yaw = m.syaw + angDiff(m.syaw, L.yawW) * k;
    if (m.t >= m.t0) { m.st = 1; m.t = 0; }
    return true;
  }
  if (m.st === 1) {
    // [keeps] on the rungs: a fight on the ladder holds the climber, the player chooses the way (04m_ladders.js)
    const go = ladderRungs(e, m, dt);
    const up = m.dir > 0, yEnd = up ? L.wyt : L.wyb;
    let ny = m.y + (up ? 1 : -1) * TW.CLIMB * dt * go;
    // a hatch over the head must be open before the climber comes up through it: it is pushed open, unless a foe
    // stands on it (ladderPush)
    if (up && Hh && Hh.k < 0.85 && ny + 1.85 > L.wyt - 0.1) { ny = Math.max(Math.min(m.y, L.wyt - 1.95), Math.min(ny, L.wyt - 1.95)); if (go > 0) ladderPush(e, Hh); }
    if (!up && Hh && Hh.k < 0.85 && m.y > L.wyt - 1.2) { ny = m.y; if (go > 0) Hh.until = Math.max(Hh.until, GAME.t + 1.5); } // going down through it: wait while it swings open
    if (up && Hh && go > 0 && ny + 1.85 > L.wyt - 0.1) Hh.until = Math.max(Hh.until, GAME.t + 1.2);
    m.y = up ? Math.min(yEnd, ny) : Math.max(yEnd, ny);
    e.x = L.lx; e.z = L.lz; e.y = m.y; e.yaw = L.yawW;
    if (m.y === yEnd) { m.st = 2; m.t = 0; m.sx = e.x; m.sz = e.z; setAct(e, 14, m.t2 / 0.06, 0.94); LADDER_CLIMBERS.delete(e); } // the pose eases out as the body steps off
    return true;
  }
  // off the ladder: forward onto the floor at the top, or back onto the floor at the foot
  const up = m.dir > 0;
  const k = smooth(clamp(m.t / m.t2, 0, 1)), ex = up ? L.ox : L.fx, ez = up ? L.oz : L.fz;
  e.x = lerp(m.sx, ex, k); e.z = lerp(m.sz, ez, k); e.y = up ? L.wyt : L.wyb; e.yaw = L.yawW;
  if (m.t >= m.t2) {
    e.motion = null;
    e.x = ex; e.z = ez; e.y = up ? L.wyt : L.wyb;
    if (e.prevX !== undefined) { e.prevX = e.x; e.prevZ = e.z; }
    e.anim.act = 0; e.anim.actDur = 0;
    e.onGround = true; e.vy = 0;
  }
  return true;
}
// the nearest ladder start within reach of e at its own height (for the player's E and walking into one)
function towerLadderNear(e, reach) {
  let best = null, bd = reach;
  for (const T of TOWER.list) {
    if (Math.abs(e.x - T.S.x) > 40 || Math.abs(e.z - T.S.z) > 40) continue;
    for (const L of T.ladders) {
      if (L.gone) continue;
      if (Math.abs(e.y - L.wyb) < 0.7) { const d = dist(e.x, e.z, L.fx, L.fz); if (d < bd) { bd = d; best = { L, dir: 1, d }; } }
      if (Math.abs(e.y - L.wyt) < 0.7) { const d = dist(e.x, e.z, L.ox, L.oz); if (d < bd) { bd = d; best = { L, dir: -1, d }; } }
    }
  }
  return best;
}

// each frame (updateMountains calls it): a keep's tower rooms are drawn only when the camera is within 70 m
function towerInnerVis() {
  for (const I of TOWER.inner) I.m.visible = !INDOOR.on && dist2(camera.position.x, camera.position.z, I.x, I.z) < 70 * 70;
}

/* ------------------------------------------------------------------ */
/* each step: doors, hatches, the player walking into a ladder         */
/* ------------------------------------------------------------------ */
function updateTowers(dt) {
  if (!TOWER.list.length) return;
  const P = GAME.player;
  for (const D of TOWER.doors) {
    if (GAME.t > D.scan) {
      D.scan = GAME.t + 0.2 + Math.random() * 0.05;
      let near = false;
      forNear(D.x, D.z, 2.2, (o) => { if (!near && o.alive && isActor(o) && o.role !== 'critter' && Math.abs(o.y - D.wy) < 1.6) near = true; });
      D.want = near ? 1 : 0;
    }
    const was = D.k;
    D.k = clamp(D.k + (D.want ? 1 : -1) * dt * (D.want ? 2.6 : 1.4), 0, 1);
    if (was !== D.k) {
      D.part.K.dirty = true;
      if (P && (was === 0 || D.k === 0) && dist2(P.x, P.z, D.x, D.z) < 15 * 15) sfx(D.k === 0 ? 'thud' : 'click');
    }
    D.coll.active = D.k < 0.55;
    D.leafColl.active = D.k > 0.85;
  }
  for (const Hh of TOWER.hatches) {
    const want = Hh.held || GAME.t < Hh.until;
    const was = Hh.k, wasB = Hh.bump;
    Hh.k = clamp(Hh.k + (want ? 1 : -1) * dt * (want ? 2.2 : Hh.slam > GAME.t ? 9 : 1.6), 0, 1);
    Hh.bump = Math.max(0, Hh.bump - dt * 0.9);
    if (was !== Hh.k || wasB !== Hh.bump) {
      Hh.part.K.dirty = true;
      if (P && (Hh.k === 0 && was > 0) && dist2(P.x, P.z, Hh.x, Hh.z) < 15 * 15) sfx('thud');
    }
    Hh.floor.active = Hh.k < 0.25;
    Hh.lidColl.active = Hh.k > 0.8;
  }
  // the player walks into the foot of a ladder, or into the open hatch beside the top of one: they climb
  if (P && P.alive && !P.motion && TOWER.px !== null) {
    const mx = P.x - TOWER.px, mz = P.z - TOWER.pz, mv = Math.hypot(mx, mz);
    // walking, not set down there (a teleport, a return to life) nor shoved there by a body going by ([keeps] the
    // player must mean to move: a key or the stick)
    const meant = !UI.modal && (INPUT.joy || keyDown('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight'));
    if (mv > 0.004 && mv < 0.4 && P.onGround && meant) {
      const n = towerLadderNear(P, 0.55);
      if (n) {
        const L = n.L, tx = n.dir > 0 ? L.lx - L.fx : L.lx - L.ox, tz = n.dir > 0 ? L.lz - L.fz : L.lz - L.oz, tl = Math.hypot(tx, tz) || 1;
        const open = n.dir > 0 || !L.hatch || L.hatch.k > 0.6;
        if (open && (mx * tx + mz * tz) / (mv * tl) > 0.6) towerClimb(P, L, n.dir);
      }
    }
  }
  if (P) { TOWER.px = P.x; TOWER.pz = P.z; }
  updateLadders(dt); // [keeps] the fights on the ladders and at the hatches (04m_ladders.js)
  updateTowerFires(dt); // [keeps] a timber tower burning, fallen in or built again (04n_towerfire.js)
  for (const K of TOWER.keeps) if (K.dirty) towerPose(K);
}

// E (and the pad's Use) by a ladder or a hatch
function towerOffers(P, offer) {
  if (!TOWER.list.length) return;
  if (P.motion) { ladderOffers(P, offer); return; } // [keeps] on a ladder: climb on, climb down (04m_ladders.js)
  towerFireOffers(P, offer); // [keeps] a brand held to a timber tower's logs (04n_towerfire.js)
  for (const T of TOWER.list) {
    if (Math.abs(P.x - T.S.x) > 30 || Math.abs(P.z - T.S.z) > 30) continue;
    for (const L of T.ladders) {
      if (L.gone) continue;
      const Hh = L.hatch, open = !Hh || Hh.k > 0.6;
      if (Math.abs(P.y - L.wyb) < 0.7) {
        const d = dist(P.x, P.z, L.fx, L.fz);
        if (open || Hh.held) offer(d, 1.5, 'Climb the ladder', () => towerClimb(P, L, 1), 0.35);
        else offer(d, 1.5, 'Push the hatch open', () => { Hh.held = true; }, 0.35);
      }
      if (Math.abs(P.y - L.wyt) < 0.7 && Hh) {
        const d = dist(P.x, P.z, L.ox, L.oz), dh = dist(P.x, P.z, Hh.cx, Hh.cz);
        const foe = ladderFoeBelow(P, L); // [keeps] a foe coming up through it: drop the lid on them (04m_ladders.js)
        if (Hh.k > 0.6 && foe) offer(Math.min(d, dh) * 0.5, 2.4, 'Slam the hatch on them', () => ladderSlam(P, Hh), 0.6);
        else if (Hh.k > 0.6) {
          offer(d, 1.0, 'Climb down the ladder', () => towerClimb(P, L, -1), 0.35);
          offer(dh, 2.0, 'Shut the hatch', () => { Hh.held = false; Hh.until = 0; }, 0.05);
        } else offer(Math.min(d, dh), 2.0, 'Open the hatch', () => { Hh.held = true; }, 0.3);
      }
    }
  }
}
