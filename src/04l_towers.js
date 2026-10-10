/* ================================================================== */
/* [land] towers you can go into                                       */
/* ================================================================== */
// The corner towers of the stone keeps are hollow. A door from the courtyard opens into a store room; a ladder
// climbs from it through a hatch into the guard room at the height of the wall walks, which has a door onto each
// walk; a second ladder climbs through a hatch in its vault onto the fighting top. Arrow slits look out of both
// rooms and a torch burns in each. The garrison walks to its posts on the tops through them, climbing the ladders
// (body action 14) and pushing the hatches open as it goes; the player climbs by walking into a ladder or with
// E (the pad's Use), and opens or shuts a hatch with E. Doors swing open for anyone who comes to them.
// Everything is built in the site frame of its keep (castleStone in 04g_castles.js calls towerStone for each
// corner); the doors and hatch lids of a keep are one mesh whose vertices are moved when one of them swings.

const TOWER = { list: [], ladders: [], hatches: [], doors: [], keeps: [], px: null, pz: null, stats: { rebuilt: 0 } };
const TW = { RO: 3.4, RI: 2.5, NS: 16, R0: 1.25, R1: 2.3, HW: 0.5, CLIMB: 1.25, FOOT: 1.85, LINE: 1.6, OFF: 0.7 };

// one sector of a tower's drum, unit high: from TW.RI to TW.RO, a sixteenth of the circle centred on angle 0 (a point
// at angle a is (sin a, cos a) * r, as in the site frame), each arc in two flat facets; placed with its yaw
const TW_SECTOR = (() => {
  const ri = TW.RI, ro = TW.RO, a0 = -Math.PI / TW.NS, a1 = Math.PI / TW.NS, nf = 2;
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
  return g;
})();

// a point at angle a and radius r from the tower's centre, in the site frame / in the world
const twP = (T, a, r) => ({ x: T.cx + Math.sin(a) * r, z: T.cz + Math.cos(a) * r });
function twW(T, a, r) { const p = twP(T, a, r); return siteToWorld(T.S, p.x, p.z); }
const twIdx = (a) => ((Math.round(a / (TAU / TW.NS)) % TW.NS) + TW.NS) % TW.NS;

/* ------------------------------------------------------------------ */
/* building one tower                                                  */
/* ------------------------------------------------------------------ */
// sx, sz: which corner; H the walk's height, TT the fighting top's (above the site)
function towerStone(C, sx, sz, H, TT, TC) {
  const { S, b, M, st } = C, { RO, RI, NS } = TW, RM = (RO + RI) / 2, TH = RO - RI;
  const T = { C, S, sx, sz, cx: sx * TC, cz: sz * TC, H, TT, doors: [], ladders: [], hatches: [], gaps: {}, fires: [] };
  T.aIn = Math.atan2(-sx, -sz); // toward the courtyard
  T.aSide = Math.atan2(0, -sz); // onto the walk along the side wall
  T.aFB = Math.atan2(-sx, 0); // onto the walk along the front or back wall
  // the ground room's floor: flags a hand above the courtyard, or above the highest ground inside the ring
  let gh = 0;
  for (let k = 0; k < 40; k++) { const a = k * 2.399, r = Math.sqrt((k + 0.5) / 40) * RO; const p = siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); gh = Math.max(gh, heightAt(p.x, p.z) - S.y); }
  T.yG = Math.max(0.1, gh + 0.06);
  // the solid drum the world was laid out round stands down: the ring of masonry below takes its place
  for (const c of S.colliders) if (c.tag === 'tower' && c.type === 'circle' && c.r > 3) { const l = siteLocal(S, c.x, c.z); if (Math.abs(l.x - T.cx) < 0.5 && Math.abs(l.z - T.cz) < 0.5) { c.active = false; c.hollow = true; } }
  // the openings: the courtyard door, one onto each walk
  const gap = (a, y0, y1) => { const i = twIdx(a); (T.gaps[i] = T.gaps[i] || []).push([y0, y1]); return i; };
  T.iIn = gap(T.aIn, -0.02, T.yG + 2.3);
  T.iSide = gap(T.aSide, H, H + 2.2);
  T.iFB = gap(T.aFB, H, H + 2.2);
  const outward = [T.aIn + Math.PI, T.aIn + Math.PI + 0.785, T.aIn + Math.PI - 0.785, T.aIn + Math.PI + 1.571, T.aIn + Math.PI - 1.571].map(twIdx);
  // the drum: sixteen sectors of masonry round the rooms (true arcs inside and out, so a doorway's reveals are clean),
  // a doorway left in those with a door
  const top = TT - 0.3, ht = RM * Math.sin(Math.PI / NS);
  const gapped = (j) => (T.gaps[((j % NS) + NS) % NS] || []).length > 0;
  T.colls = [];
  for (let i = 0; i < NS; i++) {
    const a = (i * TAU) / NS, p = twP(T, a, RM), u = { x: Math.cos(a), z: -Math.sin(a) };
    const g = (T.gaps[i] || []).slice().sort((q, r) => q[0] - r[0]);
    // beside a doorway the collider stops short of the reveal, so a body passes where the doorway shows it can
    const cutL = gapped(i - 1) ? 0.13 : 0, cutR = gapped(i + 1) ? 0.13 : 0, sh = (cutL - cutR) / 2;
    const piece = (y0, y1) => {
      b.add(TW_SECTOR, lm(M, T.cx, y0, T.cz, a, 1, y1 - y0, 1), MAT.stone, darker(st.stone, 0.9 + 0.12 * hash1(i * 5.3 + y0 + sx * 3 + sz * 7)), S.y, 5);
      const c = boxAt(S, p.x + u.x * sh, p.z + u.z * sh, ht - (cutL + cutR) / 2, TH / 2, 'wall', y1 - y0, a);
      c.vert = true; c.y0 = S.y + y0; c.tower = T;
      T.colls.push(c);
    };
    let y = -1.4;
    for (const [g0, g1] of g) { if (g0 > y + 0.01) piece(y, g0); y = g1; }
    if (top > y + 0.01) piece(y, top);
    // over each doorway a lintel standing proud of both faces, and a threshold at the courtyard door
    for (const [, g1] of g) b.add(G.box, lm(M, p.x, g1 + 0.12, p.z, a, 2 * RI * Math.sin(Math.PI / NS) + 0.25, 0.24, TH + 0.1), MAT.stone, darker(st.stone, 0.8));
    if (i === T.iIn) b.add(G.box, lm(M, p.x, T.yG - 0.06, p.z, a, 2 * RI * Math.sin(Math.PI / NS), 0.16, TH + 0.2), MAT.stone, darker(st.stone, 0.72));
    // arrow slits on the outer side, through both rooms: dark on the face, a splayed embrasure inside
    if (outward.includes(i)) {
      for (const [y0, y1] of [[T.yG + 1.0, T.yG + 2.1], [H + 0.8, H + 1.9]]) {
        const ym = (y0 + y1) / 2, h = y1 - y0;
        const qo = twP(T, a, RO + 0.004), qi = twP(T, a, RI - 0.004);
        b.add(G.box, lm(M, qo.x, ym, qo.z, a, 0.09, h, 0.012), MAT.water, ARROW_SLIT);
        b.add(G.box, lm(M, qi.x, ym, qi.z, a, 0.42, h + 0.2, 0.012), MAT.darkstone, darker(st.stone, 0.42));
        b.add(G.box, lm(M, qi.x, ym, qi.z, a, 0.09, h, 0.016), MAT.water, ARROW_SLIT);
      }
    }
  }
  // the corbel course under the fighting top
  for (let i = 0; i < NS; i++) {
    const a = (i * TAU) / NS, p = twP(T, a, RO - 0.2 + 0.21);
    b.add(G.box, lm(M, p.x, TT - 0.25, p.z, a, 2 * (RO + 0.22) * Math.sin(Math.PI / NS) + 0.08, 0.5, 0.62), MAT.stone, darker(st.stone, 0.9));
  }
  // where people stand: the courtyard doorway and the floors
  const thr = twP(T, T.aIn, RM + 0.15);
  C.floor(thr.x, thr.z, 0.55, TH / 2 + 0.45, T.aIn, T.yG, T.yG, -1.2, 0, 'tower');
  // the ladders and the hatches they climb through: from the store room to the guard room on the outer side,
  // from the guard room to the top on the courtyard side
  const L0 = towerLadder(T, T.aIn + Math.PI, T.yG, H);
  const L1 = towerLadder(T, T.aIn, H, TT);
  T.ladders.push(L0, L1);
  towerFloor(T, T.yG, RI + 0.06, null, 'flags');
  towerFloor(T, H, RI + 0.06, L0, 'boards');
  towerFloor(T, TT, 3.0, L1, 'top');
  // the rim of the top: the floor runs out under the crenels
  for (let i = 0; i < NS; i++) { const a = (i * TAU) / NS, p = twP(T, a, 3.2); C.floor(p.x, p.z, 2 * 3.5 * Math.sin(Math.PI / NS) / 2 + 0.04, 0.32, a, TT, TT, TT - 0.5, 0.45, 'top'); }
  // joists under the guard room's boards, clear of its hatch
  for (const off of [-1.2, 1.2]) {
    const ua = T.aIn + Math.PI / 2, pc = twP(T, ua, off), L = 2 * Math.sqrt(RI * RI - off * off);
    b.add(G.box, lm(M, pc.x, H - 0.3, pc.z, ua + Math.PI / 2, 0.22, 0.24, L + 0.3), MAT.wood, darker(st.wood, 0.7));
  }
  for (const L of T.ladders) towerHatch(T, L);
  // doors: the courtyard's, and one onto each walk
  T.doors.push(towerDoor(T, T.aIn, T.yG, 2.3, 1));
  // the walk doors are hung on the side away from the ladder up, so an open leaf is never in the way to it
  T.doors.push(towerDoor(T, T.aSide, H, 2.2, angDiff(T.aSide, T.aIn) > 0 ? 1 : -1));
  T.doors.push(towerDoor(T, T.aFB, H, 2.2, angDiff(T.aFB, T.aIn) > 0 ? 1 : -1));
  towerFurnish(T);
  // the crenels round the top, the flagpole in the middle
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, rr = RO + 0.02;
    const p0 = twP(T, a0, rr), p1 = twP(T, a1, rr);
    castleParapet(C, p0.x, p0.z, p1.x, p1.z, TT, { th: 0.45, bh: 0.95, step: 1.6, slits: i % 2 === 0 });
  }
  C.post(T.cx, T.cz, 0.16, TT, 4.2);
  // no grass inside; no rain or snow in the rooms (towerRoofOver, towerRoofsForRain)
  const wc = siteToWorld(S, T.cx, T.cz);
  T.wx = wc.x; T.wz = wc.z;
  clearCoverDisc(wc.x, wc.z, RI + 0.2, 0);
  T.rain = { x: wc.x, z: wc.z, c: 1, s: 0, round: true, Rr: RI, y: S.y, y0: TT - 0.31, hc: 0.01 };
  TOWER.list.push(T);
  return T;
}

// the way from the side walk in at a corner tower's door, across the guard room and up its ladder onto the top
// (castleStone's posts): points in the site frame, the ladder's ends with their heights and the ladder
function towerWayUp(T, wc) {
  const L = T.ladders[1], door = twP(T, T.aSide, TW.RO + 0.5), inside = twP(T, T.aSide, TW.RI - 0.6);
  return [[T.sx * wc, door.z], [inside.x, inside.z], [L.foot.x, L.foot.z, T.H, L], [L.off.x, L.off.z, T.TT, L]];
}

// a floor across the tower at height y out to radius rf, in strips across the line of its ladder's hatch (left open):
// boards on joists, flags on the ground, stone slabs on the top; each strip is also a floor people stand on
function towerFloor(T, y, rf, L, look) {
  const { C, S } = T, { b, M, st } = C;
  const a = L ? L.a : T.aIn, ux = Math.cos(a), uz = -Math.sin(a), vx = Math.sin(a), vz = Math.cos(a);
  const bounds = [-rf];
  for (let u = Math.ceil((-rf + 0.15) / 0.5) * 0.5; u < rf - 0.15; u += 0.5) bounds.push(u);
  bounds.push(rf);
  for (let k = 0; k + 1 < bounds.length; k++) {
    const u0 = bounds[k], u1 = bounds[k + 1], uc = (u0 + u1) / 2, w = u1 - u0;
    const uin = u0 < 0 && u1 > 0 ? 0 : Math.min(Math.abs(u0), Math.abs(u1));
    const vl = Math.sqrt(Math.max(0, rf * rf - uin * uin));
    const hole = L && uc > -TW.HW && uc < TW.HW;
    const pieces = hole ? [[-vl, TW.R0], [TW.R1, vl]] : [[-vl, vl]];
    for (const [v0, v1] of pieces) {
      if (v1 - v0 < 0.05) continue;
      const vc = (v0 + v1) / 2, lx = T.cx + ux * uc + vx * vc, lz = T.cz + uz * uc + vz * vc;
      const shade = 0.86 + 0.2 * hash1(k * 3.7 + v0 + y);
      if (look === 'boards') b.add(G.box, lm(M, lx, y - 0.06, lz, a, w - 0.025, 0.12, v1 - v0), MAT.wood, darker(st.wood, shade));
      else if (look === 'flags') b.add(G.box, lm(M, lx, y - 0.2, lz, a, w - 0.03, 0.4, v1 - v0), MAT.stone, darker(st.stone, 0.72 * shade), S.y, 1);
      else b.add(G.box, lm(M, lx, y - 0.15, lz, a, w - 0.03, 0.3, v1 - v0), MAT.stone, darker(st.stone, 1.02 * shade));
      // the strips overlap a little, so no body ever finds the crack between two of them
      C.floor(lx, lz, w / 2 + 0.02, (v1 - v0) / 2 + (hole ? 0 : 0.02), a, y, y, y - 1.2, look === 'flags' ? 0 : look === 'top' ? 0.45 : 0.3, look === 'top' ? 'top' : 'tower');
    }
  }
}

// a ladder at angle a from the floor at yb to the floor at yt: its rails stand at the inner edge of the hatch above,
// the climber between them and the wall, facing in; at the top they step off forward onto the floor
function towerLadder(T, a, yb, yt) {
  const { C } = T, { b, M, st } = C;
  const L = { T, a, yb, yt, yaw: a + Math.PI, hatch: null };
  const u = { x: Math.cos(a), z: -Math.sin(a) };
  const rail = twP(T, a, TW.R0 + 0.04), h = yt - yb;
  for (const sd of [-1, 1]) b.add(G.box, lm(M, rail.x + u.x * sd * 0.24, yb + h / 2, rail.z + u.z * sd * 0.24, a, 0.07, h, 0.09), MAT.wood, darker(st.wood, 0.8));
  for (let y = 0.3; y < h - 0.05; y += 0.3) b.add(G.cyl8, lm(M, rail.x, yb + y, rail.z, a, 0.028, 0.48, 0.028, 0, Math.PI / 2), MAT.wood, darker(st.wood, 0.95 + 0.1 * hash1(y * 7 + a)));
  // world points: the foot, the line it is climbed on, the step at the top
  const f = twW(T, a, TW.FOOT), l = twW(T, a, TW.LINE), o = twW(T, a, TW.OFF);
  Object.assign(L, { fx: f.x, fz: f.z, lx: l.x, lz: l.z, ox: o.x, oz: o.z, wyb: T.S.y + yb, wyt: T.S.y + yt, yawW: T.S.yaw + a + Math.PI });
  L.foot = twP(T, a, TW.FOOT); L.off = twP(T, a, TW.OFF);
  TOWER.ladders.push(L);
  return L;
}

// a hatch over the top of a ladder: a lid of boards on two ledges, hinged at the wall side; shut it is a floor
function towerHatch(T, L) {
  const { S } = T, a = L.a;
  const hinge = twP(T, a, TW.R1), w = siteToWorld(S, hinge.x, hinge.z);
  const c = twP(T, a, (TW.R0 + TW.R1) / 2);
  const Hh = { T, L, a, x: w.x, z: w.z, y: S.y + L.yt, k: 0, held: false, until: 0, part: null };
  Hh.floor = T.C.floor(c.x, c.z, TW.HW, (TW.R1 - TW.R0) / 2, a, L.yt, L.yt, L.yt - 0.12, 0.12, 'hatch');
  const cw = siteToWorld(S, c.x, c.z);
  Hh.cx = cw.x; Hh.cz = cw.z;
  // the lid in its own frame: hinge along local x, the lid lying toward local -z, its top at y = 0
  const g = new Batch(), I = new THREE.Matrix4(), wood = darker(T.C.st.wood, 0.85), D = TW.R1 - TW.R0 - 0.03;
  for (let i = 0; i < 4; i++) g.add(G.box, lm(I, -0.375 + i * 0.25, -0.04, -D / 2, 0, 0.24, 0.08, D), MAT.wood, darker(wood, 0.9 + 0.15 * hash1(i * 3.1 + a)));
  for (const z of [-0.2, -D + 0.2]) g.add(G.box, lm(I, 0, -0.1, z, 0, 0.92, 0.06, 0.12), MAT.wood, darker(wood, 0.7));
  g.add(G.box, lm(I, 0, 0.005, -D + 0.12, 0, 0.18, 0.02, 0.05), MAT.metal, [0.25, 0.25, 0.27]); // the ring to lift it by
  for (const sd of [-1, 1]) g.add(G.box, lm(I, sd * 0.32, 0.004, -0.15, 0, 0.06, 0.02, 0.3), MAT.metal, [0.25, 0.25, 0.27]);
  Hh.part = { batch: g, frame: () => lm(siteMatrix(S), hinge.x, L.yt, hinge.z, a, 1, 1, 1, Hh.k * 1.68) };
  L.hatch = Hh;
  T.hatches.push(Hh);
  TOWER.hatches.push(Hh);
  return Hh;
}

// a door in the doorway at angle a, floor y, height h: boards on ledges, hung on the side `hand`, swinging in
function towerDoor(T, a, y, h, hand) {
  const { S } = T, w = 0.92;
  const u = { x: Math.cos(a), z: -Math.sin(a) };
  const mid = twP(T, a, TW.RI + 0.12);
  const hinge = { x: mid.x - u.x * hand * (w / 2), z: mid.z - u.z * hand * (w / 2) };
  const D = { T, a, y, h, hand, k: 0, want: 0, scan: 0, part: null };
  const cw = siteToWorld(S, mid.x, mid.z);
  D.x = cw.x; D.z = cw.z; D.wy = S.y + y;
  const cm = twP(T, a, (TW.RO + TW.RI) / 2);
  D.coll = boxAt(S, cm.x, cm.z, 0.6, (TW.RO - TW.RI) / 2 + 0.05, 'hdoor', h + 0.1, a);
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
  TOWER.doors.push(D);
  return D;
}

// a store below and a guard room above, each with a torch on the wall
function towerFurnish(T) {
  const { C, S, yG, H } = T, { b, M, st } = C, wood = st.wood;
  const at = (a, r) => { const p = twP(T, a, r); return p; };
  const frame = (a, r, y) => { const p = at(a, r); return lm(M, p.x, y, p.z, a + Math.PI); }; // +z faces into the room
  const prop = (a, r, rr, y, h) => { const p = at(a, r); const c = circleAt(S, p.x, p.z, rr, 'prop', h); c.vert = true; c.y0 = S.y + y; };
  // the store: barrels and crates against the wall either side of the ladder, a rack of spears by the door
  for (const [da, s] of [[1.05, 1], [1.45, 0.92], [-1.1, 1.05]]) {
    const a = T.aIn + Math.PI + da, p = at(a, 1.85);
    roomBarrel(b, lm(M, 0, yG, 0), p.x, p.z, s, wood, da * 3);
    prop(a, 1.85, 0.36 * s, yG, 1.0);
  }
  { const a = T.aIn + Math.PI - 1.55, F = frame(a, 1.9, yG); roomCrate(b, F, 0, 0, 0, 0.6, wood, 0.2); roomCrate(b, F, 0.05, 0.6, 0.02, 0.5, wood, -0.3); prop(a, 1.9, 0.45, yG, 1.2); }
  { // the spear rack: two uprights, a rail, spears leaning in it
    const a = T.aIn + 0.85, F = frame(a, 2.15, yG);
    for (const sx of [-0.55, 0.55]) b.add(G.box, lm(F, sx, 0.75, 0, 0, 0.08, 1.5, 0.08), MAT.wood, darker(wood, 0.75));
    b.add(G.box, lm(F, 0, 1.25, 0.02, 0, 1.2, 0.07, 0.07), MAT.wood, darker(wood, 0.75));
    for (let i = 0; i < 5; i++) {
      const x = -0.44 + i * 0.22;
      b.add(G.cyl8, lm(F, x, 1.05, 0.1, 0, 0.022, 2.1, 0.022, -0.09), MAT.wood, darker(wood, 0.95));
      b.add(G.cone8, lm(F, x, 2.18, 0.2, 0, 0.04, 0.22, 0.04, -0.09), MAT.metal, [0.5, 0.5, 0.52]);
    }
    prop(a, 2.15, 0.3, yG, 1.6);
  }
  // the guard room: a bench and a table on the outer side, a barrel of arrows, a cot by the wall
  { const a = T.aIn + Math.PI + 1.05, F = frame(a, 1.55, H);
    b.add(G.box, lm(F, 0, 0.74, 0, 0, 1.1, 0.07, 0.62), MAT.wood, darker(wood, 0.95));
    for (const [x, z] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) b.add(G.box, lm(F, x, 0.36, z, 0, 0.07, 0.72, 0.07), MAT.wood, darker(wood, 0.8));
    b.add(G.box, lm(F, 0, 0.42, -0.62, 0, 1.1, 0.06, 0.3), MAT.wood, darker(wood, 0.9));
    for (const x of [-0.45, 0.45]) b.add(G.box, lm(F, x, 0.2, -0.62, 0, 0.06, 0.4, 0.26), MAT.wood, darker(wood, 0.8));
    roomPot(b, F, 0.25, 0.775, 0.05, 0.07, 0.18, ROOM.clay);
    b.add(G.cyl12, lm(F, -0.2, 0.79, -0.05, 0, 0.11, 0.025, 0.11), MAT.metal, ROOM.pewter);
    prop(a, 1.6, 0.75, H, 0.9);
  }
  { const a = T.aIn + Math.PI - 1.15, p = at(a, 1.9);
    roomBarrel(b, lm(M, 0, H, 0), p.x, p.z, 0.85, wood, 0.4);
    for (let i = 0; i < 9; i++) { const q = at(a + (hash1(i * 3.3) - 0.5) * 0.12, 1.9 + (hash1(i * 5.1) - 0.5) * 0.25); b.add(G.cyl8, lm(M, q.x, H + 0.95, q.z, hash1(i) * 6, 0.012, 0.75, 0.012, (hash1(i * 7.7) - 0.5) * 0.3), MAT.wood, [0.62, 0.52, 0.36]); }
    prop(a, 1.9, 0.32, H, 1.0);
  }
  // torches in iron brackets: a real fire with a light
  for (const [a, y] of [[T.aIn + 1.6, yG + 1.95], [T.aIn - 1.6, H + 1.95]]) {
    const p = at(a, TW.RI - 0.16), F = frame(a, TW.RI - 0.05, y);
    b.add(G.box, lm(F, 0, -0.08, 0.06, 0, 0.05, 0.05, 0.22), MAT.metal, [0.2, 0.2, 0.21]);
    b.add(G.cyl8, lm(F, 0, -0.16, 0.16, 0, 0.035, 0.42, 0.035, -0.25), MAT.wood, [0.3, 0.2, 0.12]);
    const w = siteToWorld(S, p.x, p.z);
    addFire(w.x, S.y + y + 0.06, w.z, 0.28, false, Infinity, { r: 7, k: 1.15 });
    T.fires.push({ x: w.x, y: S.y + y, z: w.z });
  }
}

/* ------------------------------------------------------------------ */
/* shelter: the rooms keep the rain and snow out                       */
/* ------------------------------------------------------------------ */
// is (x, z) inside a tower's drum, below its top (y: the body's feet; leave it out for the ground)
function towerRoofOver(x, z, y = -Infinity) {
  for (const T of TOWER.list) {
    if (Math.abs(x - T.wx) > TW.RI || Math.abs(z - T.wz) > TW.RI) continue;
    if (dist2(x, z, T.wx, T.wz) < TW.RI * TW.RI && y < T.S.y + T.TT - 0.5) return true;
  }
  return false;
}
// the drums near the camera join the houses' roofs in the rain and snow shaders (houseRoofsForRain, 04e_houses.js):
// round, flat, under the fighting top
function towerRoofsForRain(list, cx, cz) {
  for (const T of TOWER.list) {
    const d = dist2(cx, cz, T.wx, T.wz);
    if (d < 60 * 60) list.push([d, T.rain]);
  }
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
  const m = new THREE.Mesh(geo, buildingMat);
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
  if (window.__hm) window.__hm.towers = { TOWER, TW, towerClimb, towerLadderStart, towerOffers, updateTowers, list: () => TOWER.list, ladder: (i) => TOWER.ladders[i], seen: (e) => { e._losT = -1; return npSeen(e, dist(camera.position.x, camera.position.z, e.x, e.z)); } };
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
  e.motion = m;
  e.casting = null;
  setAct(e, 14, m.dur + 0.6);
  if (L.hatch) L.hatch.until = Math.max(L.hatch.until, GAME.t + m.dur + 2);
  return true;
}
// a body at the start of a ladder (its foot to go up, the step beside its hatch to go down) begins to climb
function towerLadderStart(e, L, dir) {
  if (!dir || e.motion) return false;
  const up = dir > 0, sx = up ? L.fx : L.ox, sz = up ? L.fz : L.oz, sy = up ? L.wyb : L.wyt;
  if (Math.abs(e.y - sy) > 0.9 || dist(e.x, e.z, sx, sz) > 0.85) return false;
  return towerClimb(e, L, dir);
}
// updateMotion (07_entities.js) hands a ladder motion here; true while the body is on its way
function towerLadderStep(e, m, dt) {
  const L = m.L, up = m.dir > 0, Hh = L.hatch;
  if (!e.alive) { e.motion = null; return false; }
  m.t += dt;
  e.onGround = true; e.vy = 0;
  if (Hh) Hh.until = Math.max(Hh.until, GAME.t + 1.5);
  if (m.st === 0) {
    // onto the ladder: from where the body stood to the line it climbs on, turning to face the rungs
    const k = smooth(clamp(m.t / m.t0, 0, 1));
    e.x = lerp(m.sx, L.lx, k); e.z = lerp(m.sz, L.lz, k);
    e.yaw = m.syaw + angDiff(m.syaw, L.yawW) * k;
    if (m.t >= m.t0) { m.st = 1; m.t = 0; }
    return true;
  }
  if (m.st === 1) {
    // a hatch over the head must be open before the climber comes up through it (it is pushed open)
    const yEnd = up ? L.wyt : L.wyb;
    let ny = m.y + (up ? 1 : -1) * TW.CLIMB * dt;
    if (up && Hh && Hh.k < 0.85 && ny + 1.85 > L.wyt - 0.1) ny = Math.max(m.y, L.wyt - 1.95);
    if (!up && Hh && Hh.k < 0.85) ny = m.y; // going down through it: wait while it swings open
    m.y = up ? Math.min(yEnd, ny) : Math.max(yEnd, ny);
    e.x = L.lx; e.z = L.lz; e.y = m.y; e.yaw = L.yawW;
    if (m.y === yEnd) { m.st = 2; m.t = 0; m.sx = e.x; m.sz = e.z; }
    return true;
  }
  // off the ladder: forward onto the floor at the top, or back onto the floor at the foot
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
      if (Math.abs(e.y - L.wyb) < 0.7) { const d = dist(e.x, e.z, L.fx, L.fz); if (d < bd) { bd = d; best = { L, dir: 1, d }; } }
      if (Math.abs(e.y - L.wyt) < 0.7) { const d = dist(e.x, e.z, L.ox, L.oz); if (d < bd) { bd = d; best = { L, dir: -1, d }; } }
    }
  }
  return best;
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
  }
  for (const Hh of TOWER.hatches) {
    const want = Hh.held || GAME.t < Hh.until;
    const was = Hh.k;
    Hh.k = clamp(Hh.k + (want ? 1 : -1) * dt * (want ? 2.2 : 1.6), 0, 1);
    if (was !== Hh.k) {
      Hh.part.K.dirty = true;
      if (P && (Hh.k === 0) && dist2(P.x, P.z, Hh.x, Hh.z) < 15 * 15) sfx('thud');
    }
    Hh.floor.active = Hh.k < 0.25;
  }
  // the player walks into the foot of a ladder, or into the open hatch beside the top of one: they climb
  if (P && P.alive && !P.motion && TOWER.px !== null) {
    const mx = P.x - TOWER.px, mz = P.z - TOWER.pz, mv = Math.hypot(mx, mz);
    if (mv > 0.004 && P.onGround) {
      const n = towerLadderNear(P, 0.55);
      if (n) {
        const L = n.L, tx = n.dir > 0 ? L.lx - L.fx : L.lx - L.ox, tz = n.dir > 0 ? L.lz - L.fz : L.lz - L.oz, tl = Math.hypot(tx, tz) || 1;
        const open = n.dir > 0 || !L.hatch || L.hatch.k > 0.6;
        if (open && (mx * tx + mz * tz) / (mv * tl) > 0.6) towerClimb(P, L, n.dir);
      }
    }
  }
  if (P) { TOWER.px = P.x; TOWER.pz = P.z; }
  for (const K of TOWER.keeps) if (K.dirty) towerPose(K);
}

// E (and the pad's Use) by a ladder or a hatch
function towerOffers(P, offer) {
  if (!TOWER.list.length || P.motion) return;
  for (const T of TOWER.list) {
    if (Math.abs(P.x - T.S.x) > 30 || Math.abs(P.z - T.S.z) > 30) continue;
    for (const L of T.ladders) {
      const Hh = L.hatch, open = !Hh || Hh.k > 0.6;
      if (Math.abs(P.y - L.wyb) < 0.7) {
        const d = dist(P.x, P.z, L.fx, L.fz);
        if (open || Hh.held) offer(d, 1.5, 'Climb the ladder', () => towerClimb(P, L, 1), 0.35);
        else offer(d, 1.5, 'Push the hatch open', () => { Hh.held = true; }, 0.35);
      }
      if (Math.abs(P.y - L.wyt) < 0.7 && Hh) {
        const d = dist(P.x, P.z, L.ox, L.oz), dh = dist(P.x, P.z, Hh.cx, Hh.cz);
        if (Hh.k > 0.6) {
          offer(d, 1.0, 'Climb down the ladder', () => towerClimb(P, L, -1), 0.35);
          offer(dh, 2.0, 'Shut the hatch', () => { Hh.held = false; Hh.until = 0; }, 0.05);
        } else offer(Math.min(d, dh), 2.0, 'Open the hatch', () => { Hh.held = true; }, 0.3);
      }
    }
  }
}
