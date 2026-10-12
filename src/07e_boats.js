/* ================================================================== */
/* [water2] boats: jetties, rowing boats, the oars, fishers            */
/* ================================================================== */
// Each town keeps rowing boats at a jetty on its lake; more lie drawn up on the lake shores and the river banks.
// Step in (E or Use) and row: forward and back pull and back the oars in a real stroke (the body leans into it,
// action 16, and the oars sweep through their arcs and dip their blades), left and right turn her. A boat is a body of
// its own on the water: it glides on between strokes, the keel holds it to its heading, the current carries it, it
// rocks to the waves, the strokes and the wind, throws a bow wave and leaves a wake, runs aground on shores and stops
// at ice, jetties and posts. You can fish from it, a hound can ride in the bow, and you can step out into deep water.
// Boats burn and are rebuilt; the towns' fishers row out in the mornings and back again.
const BOATS = { list: [], jetties: [], built: false, next: 1, geo: {}, dirty: false };
const BOAT_L = 4.3, BOAT_B = 1.36, BOAT_DRAFT = 0.24, BOAT_SEAT_Z = 0.22, BOAT_LOCK_Z = -0.18, BOAT_THWART = 0.06;
const BOAT_GRIP = OAR_GRIP; // [motion4] the oar's grip inboard of its rowlock (05a_rig.js: the rower's hands reach for it)
const BOAT_STROKE = 1.55; // seconds of a full stroke at the oars
const _bW = { y: 0, depth: 0, fx: 0, fz: 0 };

/* ------------------------------------------------------------------ */
/* the boat built in code: a clinker hull of overlapping strakes        */
/* ------------------------------------------------------------------ */
// half-beam, gunwale height and keel depth along the boat (u -1 stern .. 1 bow)
const boatHB = (u) => Math.max(0.025, (BOAT_B / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.3)), 0.85));
const boatSheer = (u) => 0.36 + 0.24 * u * u;
const boatKeel = (u) => -BOAT_DRAFT * (1 - Math.pow(Math.abs(u), 5)) + 0.18 * Math.max(0, Math.abs(u) - 0.8) / 0.2;
function boatHullGeo(cols) {
  const B = new Batch(), I = new THREE.Matrix4();
  const NS = 16, K = 5, SUB = 3;
  // one strip per strake and side: overlapping laps make the plank lines catch the light
  for (const side of [1, -1]) for (let k = 0; k < K; k++) for (const inner of [false, true]) {
    const pos = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const u = -1 + (2 * i) / NS, z = (u * BOAT_L) / 2, hb = boatHB(u), top = boatSheer(u), keel = boatKeel(u);
      for (let j = 0; j <= SUB; j++) {
        const s = (k + j / SUB) / K, frac = j / SUB;
        let x = hb * (1 - Math.pow(1 - s, 2)), y = keel + (top - keel) * Math.pow(s, 1.5);
        const lap = inner ? 0 : 0.016 * (1 - frac) * (0.3 + 0.7 * hb / (BOAT_B / 2));
        if (inner) { x = Math.max(0, x - 0.028); y += 0.012; }
        pos.push(side * (x + lap), y, z * (inner ? 0.985 : 1));
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < SUB; j++) {
      const a = i * (SUB + 1) + j, b = a + 1, c = a + SUB + 1, d = c + 1;
      const flip = (side > 0) !== inner;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const col = inner ? cols.inner : k === K - 1 ? cols.sheer : k === 0 ? cols.bottom : cols.hull;
    B.add(g, I, MAT.wood, col.map((v) => v * (0.94 + 0.12 * ((k * 7 + (side > 0 ? 3 : 0)) % 5) / 4)));
  }
  // the gunwale cap, the stem and stern posts, the thwarts, the floorboards, frames and the thole pins
  for (let i = 0; i < NS; i++) {
    const u0 = -1 + (2 * i) / NS, u1 = u0 + 2 / NS, um = (u0 + u1) / 2;
    const z0 = (u0 * BOAT_L) / 2, z1 = (u1 * BOAT_L) / 2;
    for (const side of [1, -1]) {
      const x0 = side * boatHB(u0), x1 = side * boatHB(u1), y0 = boatSheer(u0), y1 = boatSheer(u1);
      const len = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
      B.add(G.box, lm(I, (x0 + x1) / 2, (y0 + y1) / 2 + 0.012, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0), 0.07, 0.035, len + 0.02, -Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0))), MAT.wood, cols.trim);
    }
    if (i % 3 === 1 && Math.abs(um) < 0.8) B.add(G.box, lm(I, 0, boatKeel(um) + 0.13, (z0 + z1) / 2, 0, boatHB(um) * 1.75, 0.04, 0.06), MAT.wood, cols.inner.map((v) => v * 0.8));
  }
  for (const sgn of [1, -1]) B.add(G.box, lm(I, 0, 0.18, sgn * (BOAT_L / 2 + 0.02), 0, 0.07, 0.95, 0.09, sgn * 0.12), MAT.wood, cols.trim);
  B.add(G.box, lm(I, 0, BOAT_THWART, BOAT_SEAT_Z, 0, boatHB(BOAT_SEAT_Z / (BOAT_L / 2)) * 2 - 0.05, 0.05, 0.26), MAT.wood, cols.seat);
  B.add(G.box, lm(I, 0, BOAT_THWART + 0.05, -1.25, 0, boatHB(-1.25 / (BOAT_L / 2)) * 2 - 0.08, 0.05, 0.42), MAT.wood, cols.seat);
  B.add(G.box, lm(I, 0, BOAT_THWART + 0.03, 1.15, 0, boatHB(1.15 / (BOAT_L / 2)) * 2 - 0.08, 0.05, 0.24), MAT.wood, cols.seat);
  B.add(G.box, lm(I, 0, -0.12, 0, 0, 0.62, 0.025, 2.5), MAT.wood, cols.inner.map((v) => v * 0.85));
  for (const side of [1, -1]) for (const dz of [-0.07, 0.07]) B.add(G.cyl8, lm(I, side * (boatHB(BOAT_LOCK_Z / (BOAT_L / 2)) + 0.005), boatSheer(0) + 0.09, BOAT_LOCK_Z + dz, 0, 0.014, 0.16, 0.014), MAT.wood, cols.trim.map((v) => v * 0.7));
  // a coil of rope in the stern
  B.add(G.cyl12, lm(I, 0.18, -0.07, -1.55, 0, 0.17, 0.05, 0.17), MAT.cloth, [0.5, 0.42, 0.28]);
  return B.build();
}
// one oar along +x from its rowlock: the loom and grip inboard (-x), the shaft and blade outboard
function boatOarGeo(col) {
  const B = new Batch(), I = new THREE.Matrix4();
  B.add(G.cyl8, lm(I, 0.48, 0, 0, 0, 0.022, 1.95, 0.022, 0, Math.PI / 2), MAT.wood, col);
  // [motion4] the loom inboard of the rowlock and the grip: the grip BOAT_GRIP m in, within the rower's reach through the
  // whole stroke (humanVS's oars, 05a_rig.js, reach it by IK: at 0.86 m the grips met over the boat's middle at the
  // catch and the hands rowed 25 to 50 cm off them)
  B.add(G.cyl8, lm(I, -(BOAT_GRIP - 0.08) / 2, 0, 0, 0, 0.027, BOAT_GRIP - 0.08, 0.027, 0, Math.PI / 2), MAT.wood, col.map((v) => v * 0.9));
  B.add(G.cyl8, lm(I, -BOAT_GRIP, 0, 0, 0, 0.02, 0.16, 0.02, 0, Math.PI / 2), MAT.wood, col.map((v) => v * 0.6));
  B.add(G.box, lm(I, 1.6, 0, 0, 0, 0.62, 0.02, 0.14), MAT.wood, col.map((v) => v * 1.05));
  B.add(G.box, lm(I, 0.02, 0, 0, 0, 0.09, 0.05, 0.05), MAT.cloth, [0.38, 0.32, 0.22]);
  return B.build();
}
const BOAT_LOOK = [
  { hull: [0.2, 0.15, 0.11], bottom: [0.1, 0.085, 0.07], sheer: [0.52, 0.16, 0.12], trim: [0.36, 0.26, 0.17], inner: [0.42, 0.32, 0.2], seat: [0.46, 0.35, 0.22], oar: [0.55, 0.42, 0.26] }, // Logres: tarred, a red sheer strake
  { hull: [0.4, 0.31, 0.2], bottom: [0.24, 0.2, 0.14], sheer: [0.22, 0.38, 0.27], trim: [0.44, 0.34, 0.22], inner: [0.46, 0.36, 0.24], seat: [0.5, 0.4, 0.26], oar: [0.58, 0.46, 0.3] }, // Ériu: oak, a green sheer strake
  { hull: [0.47, 0.39, 0.27], bottom: [0.08, 0.075, 0.07], sheer: [0.72, 0.7, 0.62], trim: [0.38, 0.3, 0.21], inner: [0.5, 0.42, 0.29], seat: [0.52, 0.43, 0.3], oar: [0.6, 0.5, 0.34] }, // Thule: pine, a tarred bottom, a white stripe
];

/* ------------------------------------------------------------------ */
/* jetties                                                              */
/* ------------------------------------------------------------------ */
function jettyClear(x0, z0, dx, dz, len) {
  for (let t = -2; t <= len + 1; t += 0.8) {
    const x = x0 + dx * t, z = z0 + dz * t;
    for (const s of [-1.3, 0, 1.3]) {
      const px = x - dz * s, pz = z + dx * s;
      if (nearRiver(px, pz, 2)) return false;
      const near = [];
      collidersNear(px, pz, 1.6, near);
      if (near.some((c) => c.active)) return false;
    }
  }
  return !HOUSES.some((H) => dist2(H.x, H.z, x0 + dx * len / 2, z0 + dz * len / 2) < (H.foot + len / 2 + 3) ** 2);
}
function buildJetty(R) {
  const L = LAKES.find((l) => l.realm === R.id), T = R.town;
  if (!L || !T) return null;
  const base = Math.atan2(T.x - L.x, T.z - L.z);
  for (const off of [0, 0.18, -0.18, 0.36, -0.36, 0.55, -0.55, 0.75, -0.75]) {
    const a = base + off, ux = Math.sin(a), uz = Math.cos(a);
    // walk out from the middle of the lake to the shore
    let shore = null;
    for (let r = 3; r < L.r * 2.2; r += 0.25) { if (!waterAt(L.x + ux * r, L.z + uz * r, _bW)) { shore = r; break; } }
    if (!shore) continue;
    const sx = L.x + ux * shore, sz = L.z + uz * shore, w0 = waterAt(L.x + ux * (shore - 1), L.z + uz * (shore - 1), _bW);
    if (!w0) continue;
    const wy = w0.y;
    // out over the water until it is deep enough to float a boat alongside
    let len = 0;
    for (let t = 1; t < 16; t += 0.5) { const w = waterAt(sx - ux * t, sz - uz * t, _bW); if (w && w.depth > 1.15) { len = t + 2.2; break; } }
    if (!len || len > 13) continue;
    const dx = -ux, dz = -uz; // pointing out over the lake
    const x0 = sx - dx * 1.6, z0 = sz - dz * 1.6; // the land end, a little way up the shore
    if (Math.abs(heightAt(x0, z0) - wy) > 1.2 || !jettyClear(x0, z0, dx, dz, len + 1.6)) continue;
    return jettyMake(R, x0, z0, dx, dz, len + 1.6, wy);
  }
  return null;
}
function jettyMake(R, x0, z0, dx, dz, len, wy) {
  const yaw = Math.atan2(dx, dz), deck = wy + 0.55, hw = 1.05;
  const J = { realm: R.id, x0, z0, dx, dz, len, yaw, deck, wy, hw, boats: [], fisher: null };
  J.cx = x0 + dx * len / 2; J.cz = z0 + dz * len / 2;
  J.end = { x: x0 + dx * (len - 0.6), z: z0 + dz * (len - 0.6) };
  J.land = { x: x0 - dx * 1.4, z: z0 - dz * 1.4 };
  // the berth: alongside the outer end, on the side away from the town's road
  const sx = -dz, sz = dx;
  J.berths = [-1, 1].map((sd) => ({ x: x0 + dx * (len - 2.3) + sx * sd * (hw + 0.95), z: z0 + dz * (len - 2.3) + sz * sd * (hw + 0.95), yaw: yaw + (sd > 0 ? 0 : Math.PI), side: sd }));
  J.steps = [-1, 1].map((sd) => ({ x: x0 + dx * (len - 2.3) + sx * sd * (hw - 0.35), z: z0 + dz * (len - 2.3) + sz * sd * (hw - 0.35) }));
  // the deck: a floor to walk on (a ramp up from the shore), posts that stand in the bed
  const g0 = heightAt(x0, z0);
  addFloorBox(x0 + dx * 0.9, z0 + dz * 0.9, hw, 0.9, yaw, Math.min(deck - 0.05, Math.max(g0, deck - 0.6)), deck, Math.min(g0, deck) - 0.6, 0, 'walk');
  addFloorBox(x0 + dx * (len + 1.8) / 2, z0 + dz * (len + 1.8) / 2, hw, (len - 1.8) / 2, yaw, deck, deck, deck - 0.35, 0.3, 'walk');
  const Bt = new Batch(), I = new THREE.Matrix4(), M0 = lm(I, x0, 0, z0, yaw);
  const wood = R.id === 2 ? [0.42, 0.36, 0.28] : R.id === 1 ? [0.44, 0.34, 0.22] : [0.38, 0.29, 0.2];
  for (let t = 0.15; t < len; t += 0.3) {
    const k = 0.92 + 0.16 * hash2(Math.round(t * 10), R.id);
    const y = t < 1.8 ? lerp(Math.min(deck - 0.05, Math.max(g0, deck - 0.6)), deck, t / 1.8) : deck;
    Bt.add(G.box, M0.clone().multiply(lm(I, 0, y - 0.035, t, (hash2(Math.round(t * 10), 9) - 0.5) * 0.03, hw * 2 - 0.04 * hash2(t * 10, 3), 0.06, 0.27)), MAT.wood, wood.map((v) => v * k));
  }
  for (const s of [-1, 1]) Bt.add(G.box, M0.clone().multiply(lm(I, s * (hw - 0.2), deck - 0.15, (len + 1.6) / 2, 0, 0.12, 0.16, len - 1.6)), MAT.wood, wood.map((v) => v * 0.7));
  for (let t = 1.8; t <= len + 0.01; t += 2.2) for (const s of [-1, 1]) {
    const px = x0 + dx * t + -dz * s * (hw - 0.1), pz = z0 + dz * t + dx * s * (hw - 0.1), bed = heightAt(px, pz), h = deck + 0.25 - bed + 0.3;
    Bt.add(G.cyl8, M0.clone().multiply(lm(I, s * (hw - 0.1), bed - 0.3 + h / 2, t, 0, 0.11, h, 0.11)), MAT.wood, wood.map((v) => v * 0.6));
    addCircle(px, pz, 0.16, 'post', deck + 0.3 - bed).jetty = 1; // [v10] (the land's checks tell the jetties' posts from the world's own)
  }
  // a mooring bollard at the outer corners, and a short rope
  for (const s of [-1, 1]) Bt.add(G.cyl8, M0.clone().multiply(lm(I, s * (hw - 0.25), deck + 0.2, len - 0.3, 0, 0.09, 0.4, 0.09)), MAT.wood, wood.map((v) => v * 0.55));
  const g = Bt.build();
  const m = new THREE.Mesh(g, buildingMat);
  m.renderOrder = 1;
  scene.add(m);
  shadowCaster(m, depthFrom(buildingMat));
  J.mesh = m;
  BOATS.jetties.push(J);
  return J;
}
// buildCoverMask (03_terrain.js) asks: the ground under a boat drawn up on the shore grows no grass through her hull; one
// that comes to rest aground later marks its own (boatsUpdate)
function boatsCover() {
  for (const B of BOATS.list) if (B.st === 'beached' || B.grounded > 0.5) boatCoverMark(B, false);
}
function boatCoverMark(B, live = true) {
  B.coverAt = { x: B.x, z: B.z };
  coverBox(B.x, B.z, BOAT_B / 2 + 0.1, BOAT_L / 2 + 0.1, Math.cos(B.yaw), Math.sin(B.yaw), 0.1);
  if (live && COVER.tex) COVER.tex.needsUpdate = true;
}
// stepTo asks when a raised edge would hold a body back: one that may swim (a chaser, a companion) goes off a jetty's deck
// into water deep enough to swim in, as it would wade in from the shore
function jettyJumpIn(e, x, z) {
  if (!e.swimOK || !BOATS.jetties.length || !jettyAt(e.x, e.z, 0.4) || jettyAt(x, z)) return false;
  const w = waterAt(x, z, _bW);
  return !!w && w.depth > 0.8;
}
// is (x, z) on a jetty's footprint (posts and deck: boats keep off)
function jettyAt(x, z, pad = 0) {
  for (const J of BOATS.jetties) {
    const lx = (x - J.x0) * J.dz - (z - J.z0) * J.dx, lz = (x - J.x0) * J.dx + (z - J.z0) * J.dz;
    if (Math.abs(lx) < J.hw + pad && lz > -1 && lz < J.len + pad) return J;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* making the boats                                                     */
/* ------------------------------------------------------------------ */
function boatMake(realm, x, z, yaw, st, home = null) {
  const look = BOAT_LOOK[clamp(realm, 0, 2)];
  if (!BOATS.geo[realm]) BOATS.geo[realm] = { hull: boatHullGeo(look), oar: boatOarGeo(look.oar) };
  const Gx = BOATS.geo[realm];
  const B = { id: BOATS.next++, realm, x, z, yaw, vx: 0, vz: 0, wr: 0, st, char: 0, home, rider: null, pass: null, ph: 0, eff: 0, grounded: st === 'beached' ? 1 : 0, sway: { r: 0, p: 0, rv: 0, pv: 0, h: 0 }, splT: 0, wakeT: 0, phPrev: 0, fire: null, burnT: 0, rebuildAt: 0, seed: Math.random() * 100 };
  B.mat = shareMat(B_MAT, { uRise: { value: 99 }, uPc: { value: new THREE.Vector4() } });
  B.root = new THREE.Object3D();
  B.mesh = new THREE.Mesh(Gx.hull, B.mat);
  B.mesh.renderOrder = 1;
  B.root.add(B.mesh);
  B.oars = [1, -1].map((side) => {
    const piv = new THREE.Object3D();
    piv.position.set(side * (boatHB(BOAT_LOCK_Z / (BOAT_L / 2)) + 0.02), boatSheer(0) + 0.06, BOAT_LOCK_Z);
    const om = new THREE.Mesh(Gx.oar, B.mat);
    om.scale.x = side;
    om.renderOrder = 1;
    piv.add(om);
    B.root.add(piv);
    piv.userData.side = side; piv.userData.mesh = om;
    return piv;
  });
  scene.add(B.root);
  B.proxy = shadowCaster(B.mesh, depthFrom(B.mat));
  B.oarProxies = B.oars.map((o) => shadowCaster(o.userData.mesh, depthFrom(B.mat)));
  BOATS.list.push(B);
  boatPose(B, 0);
  return B;
}
// a spot on a lake shore (or a river bank) where a boat can be drawn up, its bow on the land
function boatShoreSpot(cx, cz, rmax, rnd, avoid) {
  for (let k = 0; k < 40; k++) {
    const a = rnd() * TAU, ux = Math.sin(a), uz = Math.cos(a);
    let shore = null;
    for (let r = 2; r < rmax; r += 0.25) { if (!waterAt(cx + ux * r, cz + uz * r, _bW)) { shore = r; break; } }
    if (!shore) continue;
    const sx = cx + ux * shore, sz = cz + uz * shore;
    if (avoid.some((p) => dist2(p.x, p.z, sx, sz) < 15 * 15) || jettyAt(sx, sz, 6)) continue;
    const wIn = waterAt(sx - ux * 2.6, sz - uz * 2.6, _bW);
    if (!wIn || wIn.depth < 0.25 || Math.abs(heightAt(sx + ux * 1.5, sz + uz * 1.5) - wIn.y) > 0.9) continue;
    const near = [];
    collidersNear(sx, sz, 3.5, near);
    if (near.some((c) => c.active)) continue;
    const x = sx - ux * (BOAT_L / 2 - 0.7), z = sz - uz * (BOAT_L / 2 - 0.7);
    return { x, z, yaw: a };
  }
  return null;
}
function buildBoats() {
  if (BOATS.built) return;
  BOATS.built = true;
  const rnd = mulberry(8123), avoid = [];
  for (const R of REALMS) {
    const J = buildJetty(R);
    if (J) {
      avoid.push(J.end);
      for (const b of J.berths) { const B = boatMake(R.id, b.x, b.z, b.yaw, 'moored', { j: BOATS.jetties.indexOf(J), b: J.berths.indexOf(b) }); J.boats.push(B); }
    }
  }
  // a few drawn up on the lake shores, one on each river's lower bank
  for (const L of LAKES) for (let i = 0; i < 2; i++) {
    const s = boatShoreSpot(L.x, L.z, L.r * 2.2, rnd, avoid);
    if (s) { avoid.push(s); boatMake(L.realm, s.x, s.z, s.yaw, 'beached'); }
  }
  for (const Rv of RIVERS) {
    const p = Rv.pts[Math.floor(Rv.pts.length * 0.7)];
    if (!p) continue;
    const s = boatShoreSpot(p.x, p.z, 9, rnd, avoid);
    if (s) { avoid.push(s); boatMake(Rv.realm, s.x, s.z, s.yaw, 'beached'); }
  }
  buildTracks(); // footprints and the drifts against the walls (07f_tracks.js), now that the walls stand
}

/* ------------------------------------------------------------------ */
/* on the water: the boat's own body                                    */
/* ------------------------------------------------------------------ */
// points round the hull that must float (local x, z, and the keel's depth there)
const BOAT_PTS = [[0, 1.95, 0.1], [0, -1.95, 0.12], [0.62, 0, 0.2], [-0.62, 0, 0.2], [0.48, 1.1, 0.17], [-0.48, 1.1, 0.17], [0.5, -1.1, 0.18], [-0.5, -1.1, 0.18]];
// where the hull would touch something: land, shallows, ice, a jetty or a post; null when it floats free
function boatHit(B, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const p of BOAT_PTS) {
    const wx = x + p[0] * c + p[1] * s, wz = z - p[0] * s + p[1] * c;
    const w = waterAt(wx, wz, _bW);
    if (!w || w.depth < p[2] + 0.06) return { x: wx, z: wz, why: 'shore', lp: p };
    if (SICE.on && seasonIceAt(wx, wz) > 0.15) return { x: wx, z: wz, why: 'ice', lp: p };
    if (jettyAt(wx, wz, 0.12)) return { x: wx, z: wz, why: 'jetty', lp: p };
  }
  // posts and anything else standing in the water
  const near = [];
  collidersNear(x, z, 2.6, near);
  for (const cl of near) {
    if (!cl.active || cl.type !== 'circle') continue;
    const dx = cl.x - x, dz = cl.z - z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lz) < BOAT_L / 2 + cl.r && Math.abs(lx) < boatHB(clamp(lz / (BOAT_L / 2), -1, 1)) + cl.r) return { x: cl.x, z: cl.z, why: 'post', lp: null };
  }
  for (const Bo of BOATS.list) {
    if (Bo === B || dist2(Bo.x, Bo.z, x, z) > 25) continue;
    const dx = Bo.x - x, dz = Bo.z - z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < 1.25 && Math.abs(lz) < BOAT_L * 0.85) return { x: Bo.x, z: Bo.z, why: 'boat', lp: null };
  }
  return null;
}
// which way is open water from a point (the depth's slope; ice and jetties count as shallow)
function boatDeepDir(x, z, cx, cz) {
  const d = (px, pz) => { const w = waterAt(px, pz, _bW); let v = w ? w.depth : -Math.max(0, heightAt(px, pz) - (_bW.y || 0)) - 0.2; if (SICE.on) v -= seasonIceAt(px, pz) * 2; if (jettyAt(px, pz)) v -= 1; return v; };
  let gx = d(x + 0.7, z) - d(x - 0.7, z), gz = d(x, z + 0.7) - d(x, z - 0.7);
  let l = Math.hypot(gx, gz);
  if (l < 1e-3) { gx = cx - x; gz = cz - z; l = Math.hypot(gx, gz) || 1; }
  return { x: gx / l, z: gz / l };
}
// one step of the boat: thrust (-1 back water .. 1 pull) and turn (+ to port, raising the yaw) from whoever rows
function boatPhys(B, dt, thrust, turn) {
  const rowing = Math.abs(thrust) > 0.05 || Math.abs(turn) > 0.05;
  B.eff = lerp(B.eff, rowing ? Math.max(Math.abs(thrust), Math.abs(turn) * 0.8) : 0, 1 - Math.exp(-dt * 4));
  B.phPrev = B.ph;
  if (rowing) B.ph = (B.ph + dt / BOAT_STROKE * (0.75 + 0.35 * B.eff)) % 1;
  else if (B.ph < 0.5) B.ph = Math.min(0.5, B.ph + dt * 0.8); // the oars come out of the water and rest
  if (rowing && B.eff > 0.05 && ((B.phPrev < 0.03 && B.ph >= 0.03) || (B.ph < B.phPrev && B.ph >= 0.03))) sfxAt('oar', B.x, B.y ?? null, B.z); // [audio2] each stroke's dip and the thole's creak, placed (11c_sound.js)
  const drive = rowing && B.ph > 0.02 && B.ph < 0.47 ? Math.sin(Math.PI * (B.ph - 0.02) / 0.45) : 0;
  const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
  const acc = 3.0 * drive * (thrust >= 0 ? thrust : thrust * 0.65);
  B.vx += fx * acc * dt; B.vz += fz * acc * dt;
  B.wr += turn * (0.35 + 1.1 * drive) * 1.5 * dt;
  // the water: drag relative to the stream, light along the keel, heavy across it
  const w = waterAt(B.x, B.z, _bW);
  const flx = w ? w.fx : 0, flz = w ? w.fz : 0;
  let rvx = B.vx - flx, rvz = B.vz - flz;
  let along = rvx * fx + rvz * fz, side = rvx * fz - rvz * fx;
  along -= along * Math.min(1, (0.2 + 0.16 * Math.abs(along)) * dt);
  side -= side * Math.min(1, 2.6 * dt);
  // the wind leans on a boat a little
  const wnd = (U.uWind.value || 1) * (0.06 + 0.12 * (WEATHER.storm || 0));
  rvx = fx * along + fz * side; rvz = fz * along - fx * side;
  B.vx = flx + rvx + U.uWindDir.value.x * wnd * dt; B.vz = flz + rvz + U.uWindDir.value.y * wnd * dt;
  B.wr -= B.wr * Math.min(1, 2.0 * dt);
  // a boat lying in a stream swings to it a little
  const fl = Math.hypot(flx, flz);
  if (fl > 0.2) B.wr += Math.sin(angDiff(B.yaw, Math.atan2(flx, flz))) * 0.12 * fl * dt;
  const nyaw = B.yaw + B.wr * dt, nx = B.x + B.vx * dt, nz = B.z + B.vz * dt;
  const hit = boatHit(B, nx, nz, nyaw);
  if (!hit) { B.x = nx; B.z = nz; B.yaw = nyaw; B.grounded = Math.max(0, B.grounded - dt * 1.5); return null; }
  // touched: no further into it, a little back off it, and slide along
  const g = hit.why === 'post' || hit.why === 'boat' ? (() => { const dx = B.x - hit.x, dz = B.z - hit.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; })() : boatDeepDir(hit.x, hit.z, B.x, B.z);
  const vn = B.vx * g.x + B.vz * g.z, sp = Math.hypot(B.vx, B.vz);
  // [polish] a hard knock bounces her off; a slow touch (drifting in, pushed in) only stops her going further into it, so
  // she comes to rest against it instead of shuddering on and off it every step
  const hard = sp > 0.45 || thrust !== 0;
  if (vn < 0) { const k = hard ? 1.25 : 1.0; B.vx -= vn * g.x * k; B.vz -= vn * g.z * k; }
  B.vx *= hard ? 0.7 : 0.85; B.vz *= hard ? 0.7 : 0.85; B.wr *= 0.5;
  if (!boatHit(B, B.x, B.z, nyaw)) B.yaw = nyaw;
  const back = hard ? 0.03 : boatHit(B, B.x, B.z, B.yaw) ? 0.01 : 0; // (out of it only if she is in it)
  const px = B.x + g.x * back + B.vx * dt, pz = B.z + g.z * back + B.vz * dt;
  if (!boatHit(B, px, pz, B.yaw)) { B.x = px; B.z = pz; }
  // [polish] nobody at the oars and barely moving against it: she lies there until something moves her (boatsUpdate)
  if (!B.rider && Math.hypot(B.vx, B.vz) < 0.12 && Math.abs(B.wr) < 0.15) { B.restN = (B.restN || 0) + 1; if (B.restN > 12) { B.still = true; B.vx = B.vz = B.wr = 0; } } else B.restN = 0;
  if (hit.why === 'shore' && sp > 0.25 && B.grounded < 0.5) { boatThud(B, sp, hit); }
  else if (sp > 0.6 && GAME.t - (B.thudAt || 0) > 0.8) boatThud(B, sp, hit);
  B.grounded = hit.why === 'shore' ? 1 : B.grounded;
  return hit;
}
function boatThud(B, sp, hit) {
  B.thudAt = GAME.t;
  B.sway.rv += (Math.random() - 0.5) * 0.4 * sp; B.sway.pv -= 0.25 * sp;
  if (dist2(B.x, B.z, camera.position.x, camera.position.z) < 40 * 40) {
    if (hit.why === 'shore') { FX.dust(hit.x, heightAt(hit.x, hit.z), hit.z, 6, [0.42, 0.38, 0.3]); boatSfx('grind', B); } // [audio2] placed at the boat (11c_sound.js)
    else boatSfx('knock', B);
    splashAt(hit.x, hit.z, 0.4 + Math.min(0.6, sp * 0.3));
  }
}
// the visual: riding on the water, rocking to waves, strokes, turns and knocks (a spring of its own)
function boatPose(B, dt) {
  const w = waterAt(B.x, B.z, _bW);
  const wy = w ? w.y : heightAt(B.x, B.z) + BOAT_DRAFT * 0.7;
  const S = B.sway, t = GAME.t + B.seed, rv = Math.hypot(w ? w.fx : 0, w ? w.fz : 0);
  const wave = (0.012 + 0.02 * (U.uWind.value || 1) * (0.5 + (WEATHER.storm || 0)) + 0.01 * rv) * (B.grounded > 0.5 ? 0.15 : 1);
  const drive = B.ph > 0.02 && B.ph < 0.47 ? Math.sin(Math.PI * (B.ph - 0.02) / 0.45) * B.eff : 0;
  const wantR = Math.sin(t * 1.1) * wave + Math.sin(t * 2.3 + 1) * wave * 0.4 - B.wr * 0.1 + (B.rider ? 0.015 : 0);
  const wantP = Math.sin(t * 0.9 + 2) * wave * 0.6 - drive * 0.025;
  S.rv += ((wantR - S.r) * 18 - S.rv * 3.2) * dt; S.pv += ((wantP - S.p) * 14 - S.pv * 3) * dt;
  S.r += S.rv * dt; S.p += S.pv * dt;
  S.h = Math.sin(t * 1.3) * wave * 1.6;
  let y = wy + S.h, roll = S.r, pitch = S.p;
  if (B.grounded > 0.5 && w) { const bow = heightAt(B.x + Math.sin(B.yaw) * 1.8, B.z + Math.cos(B.yaw) * 1.8); if (bow > wy - 0.05) { pitch -= clamp((bow - wy + 0.15) * 0.25, 0, 0.12); y += clamp((bow - wy) * 0.35, 0, 0.12); roll += 0.06; } }
  if (!w) { y = heightAt(B.x, B.z) + 0.18; roll += 0.12; pitch -= 0.04; }
  if (B.st === 'burnt') { y -= 0.26; roll += 0.22; }
  B.y = y;
  B.root.position.set(B.x, y, B.z);
  B.root.rotation.set(pitch, B.yaw, roll, 'YXZ');
  B.root.updateMatrixWorld(true);
}
// where a seated body rides: the rowing thwart or the bow
function boatSeatPos(B, where = 'row') {
  const z = where === 'row' ? BOAT_SEAT_Z + 0.08 : where === 'bow' ? 1.25 : -1.25;
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
  return { x: B.x + z * s, z: B.z + z * c, y: (B.y ?? waterAt(B.x, B.z, _bW)?.y ?? heightAt(B.x, B.z)) + BOAT_THWART + 0.03 };
}
// waterFloorY asks: a body in a boat sits on its thwart
function boatSeatY(e, g) {
  const B = e.boat;
  if (!B) return g;
  return boatSeatPos(B, e === GAME.player || e.ai?.fisher ? 'row' : 'bow').y;
}

/* ------------------------------------------------------------------ */
/* the player in a boat                                                 */
/* ------------------------------------------------------------------ */
function boatSeat(e, B, where) {
  const p = boatSeatPos(B, where);
  e.x = e.prevX = p.x; e.z = e.prevZ = p.z;
  e.seat = { y: p.y };
  e.y = e.kind === 'humanoid' ? p.y - 0.86 * (e.scale || 1) : (B.y ?? p.y) - 0.12;
  if (e.role !== 'player') e.fixedY = e.y;
}
function boatSteer(P, dt, f, s, mag) {
  const B = P.boat;
  if (!B || B.st === 'burnt' || B.st === 'burning') { boatLeave(P, null, B && B.st === 'burning' ? 'The boat is alight! You throw yourself into the water.' : null); return; }
  if (P.casting) P.casting = null; // no casting at the oars (and no horse in a boat)
  if (P.mount) dismount(P);
  const fishing = typeof SURV !== 'undefined' && SURV.fish;
  let thrust = 0, turn = 0;
  if (!UI.modal && !isStunned(P) && !isRooted(P) && !fishing) { thrust = clamp(f, -1, 1); turn = clamp(-s, -1, 1); }
  B.st = 'free';
  if (fishing) { B.vx = B.vz = B.wr = 0; B.eff = 0; } // a stone over the side while the line is out
  else boatPhys(B, dt, thrust, turn);
  boatPose(B, dt);
  boatSeat(P, B, 'row');
  P.yaw = fishing ? fishing.yaw ?? P.yaw : B.yaw + Math.PI;
  P.rowK = B.eff > 0.05 ? B.eff : undefined;
  P.rowPh = B.ph;
  P.onGround = true; P.vy = 0;
  // the camera swings round behind the boat as she gets under way
  if (Math.abs(thrust) > 0.1 && !INPUT.pointers.size) CAM.yaw += clamp(angDiff(CAM.yaw, B.yaw), -dt * 1.2, dt * 1.2);
  // resting at the oars mends you as on land
  const resting = GAME.t > P.combatUntil + 3, nk = needsMult();
  P.endurance = Math.min(100, P.endurance + dt * 7 * nk.en);
  P.power = Math.min(P.maxPower, P.power + P.maxPower * dt * (resting ? 0.09 : 0.025) * nk.pw);
  if (resting) P.hp = Math.min(P.maxHp, P.hp + P.maxHp * dt * 0.05 * nk.hp);
  const z = zoneAt(P.x, P.z);
  if (z.name !== lastZone) { lastZone = z.name; uiZone(z); }
  if (Math.abs(thrust) > 0.1 && typeof loreNote === 'function') loreNote('boat');
}
function boatBoard(B, e) {
  if (!B || B.rider || B.st === 'burnt' || B.st === 'burning') return false;
  if (e.mount) dismount(e);
  if (e === GAME.player) {
    if (e.dive) diveEnd(e, 'boat');
    if (e.fishing && typeof fishStop === 'function') fishStop(null);
    if (e.casting) e.casting = null;
    e.target = null;
    // a hound at heel jumps in too
    const pet = typeof ANIMALS !== 'undefined' ? ANIMALS.list.find((a) => a.alive && a.tame && a.tame.owner === 'player' && a.tame.cmd === 'follow' && (a.tame.k === 'hound' || a.tame.k === 'wolf') && dist2(a.x, a.z, e.x, e.z) < 12 * 12) : null;
    if (pet && !B.pass) { B.pass = pet.id; pet.boat = B; boatSeat(pet, B, 'bow'); setAct(pet, 9, 9999); }
    CAM.yaw = B.yaw;
  }
  if (B.st === 'moored' && B.home) { B.st = 'free'; }
  B.rider = e.id; e.boat = B;
  B.grounded = Math.min(B.grounded, 0.6);
  boatSeat(e, B, 'row');
  B.sway.rv += 0.35; B.sway.pv -= 0.1;
  if (e.swim) { splashAt(e.x, e.z, 0.7); e.swim = false; }
  if (dist2(e.x, e.z, camera.position.x, camera.position.z) < 40 * 40) boatSfx('knock');
  return true;
}
// out of the boat: onto a spot of land, a jetty, or into the water
function boatLeave(e, spot, msg = null) {
  const B = e.boat;
  if (!B) return;
  e.boat = null; e.seat = null; e.rowK = undefined; e.fixedY = null;
  if (B.rider === e.id) B.rider = null;
  if (!spot) {
    // over the side into the water
    const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
    spot = { x: B.x + c * 1.3, z: B.z - s * 1.3 };
    const w = waterAt(spot.x, spot.z, _bW);
    e.x = e.prevX = spot.x; e.z = e.prevZ = spot.z; e.y = w ? w.y - 1.3 : heightAt(spot.x, spot.z);
    splashAt(spot.x, spot.z, 0.9);
  } else {
    e.x = e.prevX = spot.x; e.z = e.prevZ = spot.z; e.y = spot.y ?? floorAt(spot.x, spot.z, heightAt(spot.x, spot.z) + 2);
  }
  e.onGround = true; e.vy = 0;
  B.sway.rv -= 0.3;
  if (msg && e === GAME.player) uiLog(msg, 'warn');
  // the hound comes too
  const pet = B.pass != null ? getEnt(B.pass) : null;
  if (pet && e === GAME.player) {
    B.pass = null; pet.boat = null; pet.fixedY = null; pet.seat = null; pet.anim.act = 0; pet.anim.actDur = 0;
    pet.x = pet.prevX = e.x + Math.sin(e.yaw + 2) * 0.9; pet.z = pet.prevZ = e.z + Math.cos(e.yaw + 2) * 0.9;
    pet.y = floorAt(pet.x, pet.z, e.y + 0.5);
  }
  if (B.st !== 'burnt' && B.st !== 'burning') B.st = 'free';
  saveSoon();
}
// a dry place to step out to, beside the boat
function boatLanding(B) {
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
  let best = null;
  for (const lz of [1.9, 2.4, 1.2, 0.3, -0.6, -1.4, -2.2]) for (const lx of [0, 1.15, -1.15, 1.7, -1.7]) {
    if (lx === 0 && Math.abs(lz) < 1.8) continue;
    const x = B.x + lx * c + lz * s, z = B.z - lx * s + lz * c;
    const w = waterAt(x, z, _bW);
    const J = jettyAt(x, z);
    if (J) { const y = J.deck; if (!best || best.j === null) best = { x, z, y, j: J }; continue; }
    if (w && w.depth > 0.45) continue;
    if (!swimPassable(x, z) || !isWalkable(x, z) && !(w && w.depth < 0.45)) continue;
    if (!best) best = { x, z, y: floorAt(x, z, heightAt(x, z) + 1), j: null };
  }
  return best;
}
function boatMoor(B, J) {
  const P = GAME.player;
  const free = J.berths.find((b) => !BOATS.list.some((o) => o !== B && dist2(o.x, o.z, b.x, b.z) < 4)) || J.berths[0];
  B.x = free.x; B.z = free.z; B.yaw = free.yaw; B.vx = B.vz = B.wr = 0; B.grounded = 0;
  boatPose(B, 0);
  const step = J.steps[J.berths.indexOf(free)] || J.end;
  if (P && P.boat === B) boatLeave(P, { x: step.x, z: step.z, y: J.deck });
  B.st = 'moored';
  B.home = { j: BOATS.jetties.indexOf(J), b: J.berths.indexOf(free) };
  boatSfx('knock');
  uiLog('You make the boat fast to the jetty.', 'sys');
  saveSoon();
}
// fishing from a boat: out over whichever side has the deeper water
function boatFishSpot(P) {
  const B = P.boat;
  if (!B) return null;
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
  let best = null;
  for (const sd of [1, -1]) for (const d of [4.5, 3.5, 2.6]) {
    const x = B.x + sd * d * c, z = B.z - sd * d * s, w = waterAt(x, z, _bW);
    if (w && w.depth > 0.6 && (!best || w.depth > best.dep)) { best = { x, z, dep: w.depth }; break; }
  }
  return best ? { x: best.x, z: best.z } : null;
}
function boatOffers(P, offer) {
  if (!BOATS.built || P.carrying != null) return;
  if (P.boat) {
    const B = P.boat;
    const J = BOATS.jetties.find((j) => j.berths.some((b) => dist2(b.x, b.z, B.x, B.z) < 4.5 * 4.5));
    if (J) offer(0.2, 1, 'Tie the boat up at the jetty', () => boatMoor(B, J), 0.4);
    const L = boatLanding(B);
    if (L) offer(0.3, 1, L.j ? 'Step out onto the jetty' : 'Step ashore', () => boatLeave(P, L), 0.3);
    offer(0.9, 1, 'Step out into the water', () => boatLeave(P, null), -0.2);
    return;
  }
  if (P.mount || P.dive) return;
  for (const B of BOATS.list) {
    const d = Math.hypot(B.x - P.x, B.z - P.z) - 0.9;
    if (d > 2.6) continue;
    if (B.st === 'burnt') { offer(Math.max(0, d), 2.6, `Rebuild the burnt boat (6 planks${goodsHave('tool_hammer') ? '' : ', a hammer'})`, () => boatRebuild(B), 0.02); continue; }
    if (B.st === 'burning') continue;
    if (P.brand) offer(Math.max(0, d) + 0.4, 2.6, 'Set the boat alight', () => boatIgnite(B, P), -0.1);
    if (B.rider) continue;
    // [polish] a boat lying on the shore or aground in the shallows: at the end of her that lies up the shore, put your
    // shoulder to her and shove her off (beside her, you step in)
    if ((B.st === 'beached' || B.grounded > 0.5) && !B.launch && !P.swim) {
      const E = boatShoveEnd(B), dEnd = Math.hypot(E.x - P.x, E.z - P.z);
      offer(Math.max(0, dEnd - 0.4), 2.2, 'Shove the boat into the water', () => boatShoveOff(B, P), 0.4);
    }
    const label = P.swim ? 'Climb into the boat' : B.st === 'moored' ? 'Untie the boat and step in' : B.grounded > 0.5 ? 'Push the boat off and step in' : 'Step into the boat';
    offer(Math.max(0, d), 2.6, label, () => { if (boatBoard(B, P) && B.grounded > 0.5) { const g = boatDeepDir(B.x + Math.sin(B.yaw) * 1.9, B.z + Math.cos(B.yaw) * 1.9, B.x, B.z); B.vx += g.x * 0.6; B.vz += g.z * 0.6; } }, 0.12);
  }
  // swimming by a jetty: climb up onto it
  if (P.swim) for (const J of BOATS.jetties) {
    const lx = (P.x - J.x0) * J.dz - (P.z - J.z0) * J.dx, lz = (P.x - J.x0) * J.dx + (P.z - J.z0) * J.dz;
    if (Math.abs(lx) < J.hw + 1.4 && lz > 1.5 && lz < J.len + 1.2) {
      const ly = clamp(lz, 2, J.len - 0.4), x = J.x0 + J.dx * ly, z = J.z0 + J.dz * ly;
      offer(0.5, 1, 'Climb up onto the jetty', () => { P.x = P.prevX = x; P.z = P.prevZ = z; P.y = J.deck; P.swim = false; splashAt(P.x, P.z, 0.5); }, 0.05);
    }
  }
}

// [polish] shoving a boat off the shore: you lean into her (body action 19) and she grinds down the beach into the water,
// stern first or bow first as she lies, gathering way as she goes; afloat she drifts on (boatPhys), free for anyone to
// step into, push about or row. Posts, jetties and other boats still stop her.
// which way she goes when shoved (along her keel, away from the end that lies higher up the shore, unless she lies across
// the slope: then straight down it), and the end you shove from
function boatShoveDir(B) {
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
  const hb = heightAt(B.x + s * 1.9, B.z + c * 1.9), hs = heightAt(B.x - s * 1.9, B.z - c * 1.9);
  let gx = hb > hs ? -s : s, gz = hb > hs ? -c : c;
  const deep = boatDeepDir(B.x, B.z, B.x - gx, B.z - gz);
  if (deep.x * gx + deep.z * gz < -0.2) { gx = deep.x; gz = deep.z; }
  return { x: gx, z: gz };
}
function boatShoveEnd(B) { const g = boatShoveDir(B); return { x: B.x - g.x * (BOAT_L / 2 + 0.45), z: B.z - g.z * (BOAT_L / 2 + 0.45) }; }
function boatShoveOff(B, P) {
  if (!B || B.rider != null || B.launch || B.st === 'burning' || B.st === 'burnt') return false;
  const g0 = boatShoveDir(B), gx = g0.x, gz = g0.z;
  B.launch = { t: 0, dx: gx, dz: gz };
  B.st = 'free'; B.still = false;
  if (P) {
    setAct(P, 19, 1.3);
    P.yaw = Math.atan2(gx, gz);
    // round to the end she is shoved from, if you are not there already
    const ex = B.x - gx * (BOAT_L / 2 + 0.45), ez = B.z - gz * (BOAT_L / 2 + 0.45);
    if (Math.hypot(P.x - ex, P.z - ez) < 3.2 && isWalkable(ex, ez)) { P.x = P.prevX = ex; P.z = P.prevZ = ez; P.y = floorAt(ex, ez, heightAt(ex, ez) + 1); }
  }
  boatSfx('grind');
  FX.dust(B.x - gx * 1.6, heightAt(B.x - gx * 1.6, B.z - gz * 1.6), B.z - gz * 1.6, 5, [0.42, 0.38, 0.3]);
  saveSoon();
  return true;
}
function boatLaunchStep(B, dt) {
  const L = B.launch;
  L.t += dt;
  const sp = 1.1 * clamp((L.t - 0.25) / 0.5, 0, 1); // (the shove comes as the legs drive)
  const nx = B.x + L.dx * sp * dt, nz = B.z + L.dz * sp * dt;
  const hit = sp > 0 ? boatHit(B, nx, nz, B.yaw) : null;
  if (hit && hit.why !== 'shore') { B.launch = null; B.grounded = 1; boatSfx('knock'); return; } // (a post, a jetty, a boat)
  if (sp > 0) { B.x = nx; B.z = nz; if (Math.random() < dt * 6) FX.dust(B.x - L.dx * 1.8, heightAt(B.x, B.z), B.z - L.dz * 1.8, 2, [0.42, 0.38, 0.3]); }
  B.grounded = 1; B.st = 'free';
  if (sp > 0 && !boatHit(B, B.x, B.z, B.yaw)) {
    // afloat: she slides on out with the way the shove gave her
    B.launch = null; B.grounded = 0; B.vx = L.dx * sp * 0.9; B.vz = L.dz * sp * 0.9; B.wr = 0; B.restN = 0;
    splashAt(B.x + L.dx * 1.9, B.z + L.dz * 1.9, 0.8); B.sway.pv += 0.2;
    B.moved = true;
    if (typeof loreNote === 'function' && dist2(B.x, B.z, GAME.player.x, GAME.player.z) < 100) loreNote('boat');
  } else if (L.t > 5) B.launch = null; // (stuck fast)
}

/* ------------------------------------------------------------------ */
/* fire                                                                 */
/* ------------------------------------------------------------------ */
function boatIgnite(B, by = null) {
  if (!B || B.st === 'burning' || B.st === 'burnt') return false;
  if (B.realm === (GAME.player && GAME.player.faction) && by && by !== GAME.player && by.faction === B.realm) return false; // a realm's own fire spares its own boats
  B.st = 'burning'; B.burnT = 0;
  const P = GAME.player;
  if (P && P.boat === B) boatLeave(P, null, 'The boat is alight! You throw yourself into the water.');
  const r = B.rider != null ? getEnt(B.rider) : null;
  if (r && r !== P) boatLeave(r, null);
  if (P && dist2(P.x, P.z, B.x, B.z) < 50 * 50) uiLog('A boat goes up in flames.', 'warn');
  return true;
}
// fireLandsAt and fireConeAt (04e_houses.js) light boats too
function boatFireAt(x, y, z, r = 1, by = null) {
  let n = 0;
  for (const B of BOATS.list) if (dist2(B.x, B.z, x, z) < (r + 1.8) ** 2 && Math.abs((B.y || y) - y) < 3 && boatIgnite(B, by)) n++;
  return n;
}
function boatFireCone(x, z, dx, dz, range, half) {
  let n = 0;
  for (const B of BOATS.list) {
    const ox = B.x - x, oz = B.z - z, d = Math.hypot(ox, oz);
    if (d > range + 1.5 || (d > 1.5 && (ox * dx + oz * dz) / d < Math.cos(half))) continue;
    if (boatIgnite(B, null)) n++;
  }
  return n;
}
function boatBurnStep(B, dt) {
  B.burnT += dt;
  B.char = Math.min(1, B.char + dt / 42 * (WEATHER.raining > 0.3 ? 0.55 : 1));
  B.vx *= Math.exp(-dt * 2); B.vz *= Math.exp(-dt * 2);
  B.fireT = (B.fireT || 0) - dt;
  if (B.fireT <= 0) {
    B.fireT = 2.5;
    const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
    for (const lz of [-1.2, 0, 1.1]) addFire(B.x + lz * s, (B.y || 0) + 0.45, B.z + lz * c, 0.9 + B.char * 0.5, false, GAME.t + 2.7, lz === 0 ? { r: 9, k: 1 } : null);
  }
  if (B.char >= 1) {
    B.st = 'burnt';
    B.rebuildAt = B.home ? GAME.t + 300 : 0;
    waterSteam(B.x, (B.y || 0) + 0.2, B.z, 20);
  }
}
function boatRebuild(B) {
  if (!goodsHave('tool_hammer')) { uiError('You need a hammer to rebuild a boat'); return; }
  if (!goodsHave('plank', 6)) { uiError('You need 6 planks'); return; }
  const P = GAME.player;
  survStartJob({ label: 'Rebuilding the boat', dur: 6, yaw: Math.atan2(B.x - P.x, B.z - P.z), tick: (J) => { J.k = (J.k || 0) - GAME.dt; if (J.k < 0) { J.k = 0.6; setAct(P, 1, 0.5); boatSfx('knock'); } }, done: () => {
    if (!goodsHave('plank', 6) || B.st !== 'burnt') return false;
    goodsTake('plank', 6);
    boatRestore(B);
    uiLog('The boat is sound again: new strakes where the old ones burnt.', 'sys');
    return false;
  } });
}
function boatRestore(B) {
  B.st = B.home ? 'moored' : 'free'; B.char = 0; B.burnT = 0; B.rebuildAt = 0;
  if (B.home) { const J = BOATS.jetties[B.home.j], b = J && J.berths[B.home.b]; if (b) { B.x = b.x; B.z = b.z; B.yaw = b.yaw; B.vx = B.vz = B.wr = 0; } }
  saveSoon();
}

/* ------------------------------------------------------------------ */
/* the towns' fishers: out in the mornings, back by midday              */
/* ------------------------------------------------------------------ */
function fisherMorning() { const p = tod.p; return (p > 2.62 || p < 0.42) && (WEATHER.storm || 0) < 0.3; }
// [v12] to the jetty's foot: out of the house by its door first, then the walk with the time it takes
function boatWalkPlan(e, J) {
  const H = e.ai.house, inside = H && houseIntact(H) && houseHas(H, e.x, e.z, -0.1);
  const far = Math.hypot(J.land.x - e.x, J.land.z - e.z);
  return [...(inside ? houseLeavePlan(e, H) : []), houseGo(J.land.x, J.land.z, { T: 16 + far / 1.2 })];
}
// 08f_townlife.js asks for every villager before its own day: true while the boat has it
function boatLife(e, dt) {
  const ai = e.ai;
  let F = ai.fisher;
  if (!F) {
    if (!BOATS.built || !fisherMorning() || e.role !== 'villager' || (ai.fishWait || 0) > GAME.t) return false;
    ai.fishWait = GAME.t + 4 + Math.random() * 4;
    // [v12] a villager within a walk of the jetty's foot (one across the town gave up on the way), out of the house by
    // its door first (straight from the room the walk met the wall), with the time the walk takes
    const J = BOATS.jetties.find((j) => dist2(j.land.x, j.land.z, e.x, e.z) < 110 * 110 && realmAt(j.cx, j.cz) === realmAt(e.x, e.z));
    if (!J || J.fisher != null || Math.random() > 0.35) return false;
    const B = J.boats.find((b) => b.st === 'moored' && !b.rider);
    if (!B) return false;
    J.fisher = e.id;
    F = ai.fisher = { st: 'walk', J, B, t: 0, until: GAME.t + 200 + Math.random() * 120 };
    lifePlan(e, boatWalkPlan(e, J));
    return true;
  }
  const J = F.J, B = F.B;
  F.t += dt;
  const done = () => { if (e.boat) { e.boat = null; e.seat = null; e.rowK = undefined; } if (B.rider === e.id) B.rider = null; e.fixedY = null; e.fishing = false; J.fisher = null; ai.fisher = null; ai.fishWait = GAME.t + 600; };
  // the boat burnt, or someone else took it: give it up
  if ((B.rider != null && B.rider !== e.id) || B.st === 'burning' || B.st === 'burnt') {
    if (e.boat) { const w = waterAt(e.x, e.z, _bW); e.boat = null; e.seat = null; e.fixedY = null; if (w) { const L = boatLanding(B) || J.land; e.x = e.prevX = L.x; e.z = e.prevZ = L.z; e.y = heightAt(L.x, L.z); } }
    done(); return false;
  }
  if (F.st === 'walk') {
    // along the jetty's deck to the boat (the plan brought us to its foot; if it did not, try again, then give up)
    if (!jettyAt(e.x, e.z, 0.5) && dist2(e.x, e.z, J.land.x, J.land.z) > 5 * 5) {
      F.tries = (F.tries || 0) + 1;
      if (F.tries > 3) { done(); return false; }
      lifePlan(e, boatWalkPlan(e, J));
      return true;
    }
    const step = J.steps[J.boats.indexOf(B)] || J.end;
    const dx = step.x - e.x, dz = step.z - e.z, d = Math.hypot(dx, dz);
    if (F.t > 60) { done(); return false; }
    if (d > 0.4) { const sp = Math.min(d, 1.5 * dt); e.x += dx / d * sp; e.z += dz / d * sp; e.yaw = Math.atan2(dx, dz); e.y = floorAt(e.x, e.z, J.deck + 0.3); e.fixedY = jettyAt(e.x, e.z) ? J.deck : null; return true; }
    boatBoard(B, e); B.st = 'free';
    F.st = 'out'; F.t = 0;
    // a spot out on the lake, deep and clear
    const L = LAKES.find((l) => l.realm === J.realm) || { x: J.cx, z: J.cz, r: 20 };
    for (let k = 0; k < 20; k++) { const a = Math.random() * TAU, r = Math.random() * L.r * 0.6, x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r, w = waterAt(x, z, _bW); if (w && w.depth > 2) { F.tx = x; F.tz = z; break; } }
    if (F.tx === undefined) { F.tx = J.end.x + J.dx * 14; F.tz = J.end.z + J.dz * 14; }
    return true;
  }
  if (F.st === 'out' || F.st === 'back') {
    const berth = J.berths[J.boats.indexOf(B)] || J.berths[0];
    const tx = F.st === 'out' ? F.tx : berth.x - Math.sin(berth.yaw) * 2.5, tz = F.st === 'out' ? F.tz : berth.z - Math.cos(berth.yaw) * 2.5;
    const dx = tx - B.x, dz = tz - B.z, d = Math.hypot(dx, dz);
    const err = angDiff(B.yaw, Math.atan2(dx, dz));
    const thrust = Math.abs(err) < 0.7 ? clamp(d / 5, 0.35, 1) : 0.12, turn = clamp(err * 1.8, -1, 1);
    const hit = boatPhys(B, dt, thrust, turn);
    if (hit && F.t > 3 && Math.random() < dt * 0.5) B.wr += (Math.random() - 0.5) * 0.8;
    boatPose(B, dt);
    boatSeat(e, B, 'row');
    e.yaw = B.yaw + Math.PI; e.rowK = B.eff > 0.05 ? B.eff : undefined; e.rowPh = B.ph;
    if (F.st === 'out' && (d < 2.5 || F.t > 70)) { F.st = 'fish'; F.t = 0; F.dur = 70 + Math.random() * 70; }
    if (F.st === 'back' && (d < 2.2 || F.t > 90)) {
      B.x = berth.x; B.z = berth.z; B.yaw = berth.yaw; B.vx = B.vz = B.wr = 0; B.st = 'moored';
      e.boat = null; e.seat = null; e.rowK = undefined; B.rider = null;
      const step = J.steps[J.boats.indexOf(B)] || J.end;
      e.x = e.prevX = step.x; e.z = e.prevZ = step.z; e.y = J.deck; e.fixedY = J.deck;
      F.st = 'ashore'; F.t = 0;
      // the catch goes to the town's stores with the fields' harvest (the farmers' dialog tells what they hold)
      if (typeof FARM !== 'undefined' && GOODS.fish_raw) { const n = 2 + Math.floor(Math.random() * 5); FARM.granary.fish_raw = (FARM.granary.fish_raw || 0) + n; BOATS.caught = (BOATS.caught || 0) + n; }
    }
    return true;
  }
  if (F.st === 'fish') {
    boatPhys(B, dt, 0, 0);
    B.vx *= Math.exp(-dt * 2); B.vz *= Math.exp(-dt * 2);
    boatPose(B, dt);
    boatSeat(e, B, 'row');
    e.rowK = undefined; e.fishing = true;
    e.yaw = B.yaw + Math.PI / 2;
    if (Math.random() < dt * 0.06) { const fx = e.x + Math.sin(e.yaw) * 4, fz = e.z + Math.cos(e.yaw) * 4; splashAt(fx, fz, 0.5); setAct(e, 1, 0.6); }
    if (F.t > F.dur || !fisherMorning() && F.t > 30) { F.st = 'back'; F.t = 0; e.fishing = false; }
    return true;
  }
  if (F.st === 'ashore') {
    const dx = J.land.x - e.x, dz = J.land.z - e.z, d = Math.hypot(dx, dz);
    if (d > 0.5 && F.t < 40) { const sp = Math.min(d, 1.4 * dt); e.x += dx / d * sp; e.z += dz / d * sp; e.yaw = Math.atan2(dx, dz); const y = floorAt(e.x, e.z, J.deck + 0.3); e.fixedY = jettyAt(e.x, e.z) ? y : null; e.y = y; return true; }
    done();
    return false;
  }
  done();
  return false;
}

/* ------------------------------------------------------------------ */
/* a hull is solid: bodies go round it, not through it                  */
/* ------------------------------------------------------------------ */
// stepTo (07_entities.js) asks after the colliders: a body moving to p (radius r, feet at by) is pushed out of any hull
// it would stand in (beached on the shore, alongside a jetty, out on the water), unless it is in that boat, or it swims
// under the keel, or it stands above the gunwale. The hull's plan is taken as an ellipse round its strakes.
function boatShove(p, r, by, e, react = 1) {
  if (!BOATS.built || (e && (e.boat || e.kind === 'door' || e.flying || e.hover))) return;
  const top = by + (e && e.kind === 'humanoid' ? 1.7 : 1.0) * ((e && e.scale) || 1);
  for (const B of BOATS.list) {
    const dx = p.x - B.x, dz = p.z - B.z;
    if (dx * dx + dz * dz > (BOAT_L / 2 + r + 0.2) ** 2) continue;
    const by0 = boatFloatY(B);
    if (top < by0 - BOAT_DRAFT - 0.12 || by > by0 + boatSheer(0) + 0.15) continue; // under the keel, or over the side
    const x0 = p.x, z0 = p.z;
    if (boatShoveOut(p, B, r) && e && react > 0) boatPushed(B, e, x0 - p.x, z0 - p.z, p.x, p.z, react);
  }
}
// [polish] a body in the water that walks or swims into a boat lying free pushes her: she takes the push by the body's
// weight against hers, turns about her middle as far as it was off her middle, and drifts on through the water's drag
// (boatPhys: never through the shore, a post, a jetty or another boat; boatShoveBodies sends bodies in her way aside).
// Moored, beached, burning or rowed boats do not give.
const BOAT_MASS = 2.2; // (a person is 1)
function boatBodyMass(e) {
  if (e.kind === 'humanoid') return (e.scale || 1) ** 2 * (e.mount ? 5 : 1);
  return { horse: 5, horseWild: 5, horseTack: 5, cattle: 5, bull: 6, bear: 3.5, deer: 0.8, stag: 1, boar: 1, pig: 1, wolf: 0.45, hound: 0.4, sheep: 0.6, sheepShorn: 0.5 }[e.crowd || e.kind] ?? 0.5;
}
function boatPushed(B, e, px, pz, cx, cz, react) {
  const pen = Math.hypot(px, pz), dt = GAME.dt || 1 / 60;
  if (pen < 1e-4 || B.rider != null || B.launch || ['moored', 'beached', 'burning', 'burnt'].includes(B.st)) return;
  const inWater = e.swim || (e.wd || 0) > 0.25 || !!waterAt(e.x, e.z, _bW);
  if (!inWater) return;
  const m = boatBodyMass(e), mu = m / (m + BOAT_MASS) * react;
  const nx = px / pen, nz = pz / pen, push = Math.min(pen / dt, 4) * mu * 0.2; // (she gathers way over a few steps)
  // no faster than the body itself goes into her
  const along = B.vx * nx + B.vz * nz, add = Math.max(0, Math.min(push, pen / dt) - Math.max(0, along));
  if (add <= 0) return;
  B.vx += nx * add; B.vz += nz * add;
  // the turn: the push's lever about her middle (her own frame: lx across, lz along the keel)
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw), rx = cx - B.x, rz = cz - B.z;
  const lx = rx * c - rz * s, lz = rx * s + rz * c, fx = nx * c - nz * s, fz = nx * s + nz * c;
  B.wr = clamp(B.wr + (lz * fx - lx * fz) * add / (BOAT_L * BOAT_L / 12) * 0.6, -1.2, 1.2);
  B.still = false; B.restN = 0;
  if (B.grounded > 0.5) B.grounded = 0.45; // off the bottom she can go (boatPhys grounds her again on the shore)
  if (B.st === 'free' || !B.st) B.st = 'free';
  B.moved = true;
  B.pushedAt = GAME.t;
  if (pen > 0.02 && GAME.t - (B.knockAt || 0) > 0.6 && dist2(B.x, B.z, camera.position.x, camera.position.z) < 30 * 30) { B.knockAt = GAME.t; boatSfx('knock'); B.sway.rv += (lx >= 0 ? -1 : 1) * 0.15 * add; rippleDrop(cx, cz, 0.5, 0.006); }
}
const _bsv = { x: 0, z: 0 }, _bfW = { y: 0, depth: 0, fx: 0, fz: 0 };
// where she floats now (her drawn height lags for a boat out of sight)
function boatFloatY(B) { const w = waterAt(B.x, B.z, _bfW); return w ? w.y : B.y ?? heightAt(B.x, B.z) + BOAT_DRAFT * 0.7; }
// the keel's depth over (x, z) when a hull floats there (a diver under it comes up against it), else null
function boatKeelOver(x, z, r = 0) {
  if (!BOATS.built) return null;
  let y = null;
  for (const B of BOATS.list) {
    const dx = x - B.x, dz = z - B.z;
    if (dx * dx + dz * dz > (BOAT_L / 2 + r) ** 2) continue;
    const c = Math.cos(B.yaw), s = Math.sin(B.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c, a = BOAT_B / 2 + r, b = BOAT_L / 2 + r;
    if ((lx * lx) / (a * a) + (lz * lz) / (b * b) >= 1) continue;
    const k = boatFloatY(B) + boatKeel(clamp(lz / (BOAT_L / 2), -1, 1));
    y = y === null ? k : Math.min(y, k);
  }
  return y;
}
function boatShoveOut(p, B, r) {
  const c = Math.cos(B.yaw), s = Math.sin(B.yaw), dx = p.x - B.x, dz = p.z - B.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c, a = BOAT_B / 2 + r, b = BOAT_L / 2 + r;
  const q = (lx * lx) / (a * a) + (lz * lz) / (b * b);
  if (q >= 1) return false;
  let nx, nz;
  if (q < 1e-6) { nx = a * (lx >= 0 ? 1 : -1); nz = 0; }
  else { const k = 1 / Math.sqrt(q); nx = lx * k; nz = lz * k; }
  // out across the beam where the side is near, along the keel at the stem and the stern
  if (Math.abs(lz) < b * 0.7) { nx = (lx >= 0 ? 1 : -1) * a * Math.sqrt(Math.max(0, 1 - (lz * lz) / (b * b))); nz = lz; }
  p.x = B.x + nx * c + nz * s; p.z = B.z - nx * s + nz * c;
  return true;
}
// a boat under way shoulders aside the bodies in her path (swimmers, waders, a body on the shore she runs up on)
function boatShoveBodies(B) {
  const sp = Math.hypot(B.vx, B.vz) + Math.abs(B.wr) * 2;
  if (sp < 0.04) return;
  for (const e of ENT) {
    if (!e.alive || e.removed || e.boat || e.kind === 'door' || e.kind === 'dragon' || e.flying || e.fixedY !== null || e.dive) continue;
    const dx = e.x - B.x, dz = e.z - B.z, r = (e.radius || 0.4) * (e.scale || 1) * 0.9;
    if (dx * dx + dz * dz > (BOAT_L / 2 + r + 0.2) ** 2) continue;
    _bsv.x = e.x; _bsv.z = e.z;
    boatShove(_bsv, r, e.y, e, 0.25); // [polish] a body in her way slows her a little
    if ((_bsv.x !== e.x || _bsv.z !== e.z) && (e.swimOK ? swimPassable : isWalkable)(_bsv.x, _bsv.z)) { e.x = _bsv.x; e.z = _bsv.z; }
  }
}

/* ------------------------------------------------------------------ */
/* every step and every frame                                           */
/* ------------------------------------------------------------------ */
function boatsUpdate(dt) {
  if (!BOATS.built) return;
  const P = GAME.player;
  for (const B of BOATS.list) {
    boatShoveBodies(B);
    if (B.st === 'burning') boatBurnStep(B, dt);
    else if (B.st === 'burnt' && B.rebuildAt && GAME.t > B.rebuildAt && (!P || dist2(P.x, P.z, B.x, B.z) > 30 * 30)) boatRestore(B);
    const rider = B.rider != null ? getEnt(B.rider) : null;
    if (B.rider != null && (!rider || !rider.alive || rider.boat !== B)) { if (rider && rider.boat === B) boatLeave(rider, null); B.rider = null; }
    // a boat nobody rows drifts with the stream until it grounds (moored and beached ones stay put)
    if (B.launch) boatLaunchStep(B, dt); // [polish] shoved off the shore (boatShoveOff)
    else if (!B.rider && B.st !== 'moored' && B.st !== 'beached' && B.grounded < 0.5 && !B.still) { boatPhys(B, dt, 0, 0); }
    // at rest on a shore: no grass grows up through her
    if (B.grounded > 0.5 && !B.rider && Math.hypot(B.vx, B.vz) < 0.05 && (!B.coverAt || dist2(B.coverAt.x, B.coverAt.z, B.x, B.z) > 1) && heightAt(B.x + Math.sin(B.yaw) * 1.6, B.z + Math.cos(B.yaw) * 1.6) > (waterAt(B.x, B.z, _bW)?.y ?? -1e9) - 0.1) boatCoverMark(B);
    // the hound in the bow rides along
    const pet = B.pass != null ? getEnt(B.pass) : null;
    if (pet) { if (!pet.alive || pet.boat !== B) { B.pass = null; pet.boat = null; pet.fixedY = null; } else { boatSeat(pet, B, 'bow'); pet.yaw = B.yaw; if (!pet.anim.act) setAct(pet, 9, 9999); } }
  }
}
// 08h_animals.js asks for each companion: in a boat it rides; while you are under the water it waits at the surface
function water2PetWait(e, dt) {
  if (e.boat) return true;
  const P = GAME.player;
  if (P && P.dive && dist2(e.x, e.z, P.x, P.z) < 40 * 40) {
    if (!e.ai.diveWait) e.ai.diveWait = { x: e.x, z: e.z };
    if (dist2(e.x, e.z, e.ai.diveWait.x, e.ai.diveWait.z) > 4) moveToward(e, e.ai.diveWait.x, e.ai.diveWait.z, dt, 0.6, 1);
    else turnToward(e, P.x, P.z, dt * 2);
    return true;
  }
  if (e.ai.diveWait) e.ai.diveWait = null;
  return false;
}
function boatsDraw(dt) {
  if (!BOATS.built) return;
  const cam = camera.position, ql = quality.level, far = ql === 'low' ? 75 : ql === 'medium' ? 115 : 160, oarR = ql === 'low' ? 45 : ql === 'medium' ? 70 : 90;
  for (const B of BOATS.list) {
    const d2 = dist2(B.x, B.z, cam.x, cam.z), vis = d2 < far * far;
    B.root.visible = vis;
    if (!vis) continue;
    if (!B.rider) boatPose(B, dt);
    // the oars: in the rowlocks while rowed (sweep and dip with the stroke), shipped along the thwarts otherwise
    const rowed = B.rider != null && B.st === 'free';
    const ph = B.ph, drv = ph < 0.47 ? clamp((ph - 0.02) / 0.45, 0, 1) : 0, rec = ph >= 0.47 ? (ph - 0.47) / 0.53 : 0;
    const sweep = ph < 0.47 ? lerp(0.62, -0.5, smooth(drv)) : lerp(-0.5, 0.62, smooth(rec));
    const dip = ph < 0.47 ? 0.3 : ph < 0.55 ? lerp(0.3, 0.12, (ph - 0.47) / 0.08) : ph > 0.94 ? lerp(0.12, 0.3, (ph - 0.94) / 0.06) : 0.12;
    const k = B.oarK = lerp(B.oarK ?? 0, rowed ? 1 : 0, 1 - Math.exp(-dt * 3));
    for (const o of B.oars) {
      const sd = o.userData.side;
      o.rotation.set(0, 0, 0);
      o.rotation.order = 'YZX';
      o.rotation.y = lerp(sd * 1.5, -sd * sweep, k);
      o.rotation.z = lerp(0.05, -dip, k) * sd;
      o.visible = d2 < oarR * oarR;
    }
    // char and the glow of the fire, and no snow or rain on the inside of a hull that is rowed
    B.mat.uniforms.uPc.value.set(0, B.char, B.st === 'burning' ? 0.4 + B.char * 0.6 : 0, 0);
    if (d2 > 50 * 50) continue;
    // the bow wave, the wake and the oars' splashes
    const w = waterAt(B.x, B.z, _bW);
    if (!w) continue;
    const sp = Math.hypot(B.vx - w.fx, B.vz - w.fz), fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
    B.wakeT -= dt;
    if (sp > 0.2 && B.wakeT < 0) {
      B.wakeT = 0.09;
      rippleDrop(B.x + fx * 2, B.z + fz * 2, 0.5 + sp * 0.2, 0.004 + sp * 0.006);
      rippleDrop(B.x - fx * 1.9, B.z - fz * 1.9, 0.6, 0.003 + sp * 0.004);
      if (sp > 0.7) for (const s of [-1, 1]) fxAlpha.emit(B.x + fx * 1.95 + fz * s * 0.15, w.y + 0.05, B.z + fz * 1.95 - fx * s * 0.15, fz * s * 0.7 * sp + fx * sp * 0.4, 0.3 + sp * 0.3, -fx * s * 0.7 * sp + fz * sp * 0.4, 0.5, 0.82, 0.86, 0.86, 0.05 + 0.02 * sp, 6, 0.4);
      if (sp > 0.4) fxAlpha.emit(B.x - fx * 2.1 + (Math.random() - 0.5) * 0.6, w.y + 0.03, B.z - fz * 2.1 + (Math.random() - 0.5) * 0.6, -fx * 0.1, 0.02, -fz * 0.1, 1.6, 0.78, 0.82, 0.82, 0.09 + 0.04 * sp, 0, 1.5);
    }
    if (rowed && B.eff > 0.05) {
      const crossed = (a) => (B.phPrev < a && B.ph >= a) || (B.phPrev > B.ph && (B.phPrev < a || B.ph >= a));
      const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
      for (const sd of [1, -1]) {
        const lx = sd * (0.7 + 1.55 * Math.cos(sweep)), lz = BOAT_LOCK_Z + 1.55 * Math.sin(sweep);
        const bx = B.x + lx * c + lz * s, bz = B.z - lx * s + lz * c;
        if (crossed(0.03)) splashAt(bx, bz, 0.35, { up: 0.6 }); // [audio2] (its sound with the stroke: boatPhys)
        else if (crossed(0.47)) splashAt(bx, bz, 0.25, { up: 0.9 });
        else if (B.ph < 0.47) rippleDrop(bx, bz, 0.35, 0.006);
        else if (Math.random() < dt * 8) fxAlpha.emit(bx, w.y + 0.25, bz, 0, -0.5, 0, 0.4, 0.75, 0.8, 0.82, 0.02, 9, 0);
      }
    }
  }
  boatRodsDraw();
}
// the fishers' rods, lines and floats (the player's own are survival's)
const BOAT_RODS = [];
const _brA = new THREE.Vector3(), _brB = new THREE.Vector3(), _brU = new THREE.Vector3(0, 1, 0);
function boatRodMake() {
  const I = new THREE.Matrix4(), mk = (fn) => { const Bt = new Batch(); fn(Bt); return new THREE.Mesh(Bt.build(), buildingMat); };
  const rod = mk((Bt) => { Bt.add(G.cyl8, lm(I, 0, 0.5, 0, 0, 0.012, 1, 0.012), MAT.wood, [0.5, 0.4, 0.26]); Bt.add(G.cyl8, lm(I, 0, 0.06, 0, 0, 0.02, 0.12, 0.02), MAT.cloth, [0.3, 0.22, 0.14]); });
  const line = mk((Bt) => Bt.add(G.cyl8, lm(I, 0, 0.5, 0, 0, 0.0035, 1, 0.0035), MAT.metal, [0.75, 0.75, 0.7]));
  const bob = mk((Bt) => { Bt.add(G.ico, lm(I, 0, 0.02, 0, 0, 0.045, 0.06, 0.045), MAT.cloth, [0.8, 0.15, 0.1]); Bt.add(G.ico, lm(I, 0, 0.065, 0, 0, 0.03, 0.035, 0.03), MAT.cloth, [0.9, 0.9, 0.85]); });
  const R = { rod, line, bob };
  for (const m of [rod, line, bob]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 1; scene.add(m); }
  return R;
}
function boatRodsDraw() {
  let n = 0;
  for (const J of BOATS.jetties) {
    const e = J.fisher != null ? getEnt(J.fisher) : null;
    const F = e && e.ai && e.ai.fisher;
    if (!F || F.st !== 'fish' || !e.seat || dist2(e.x, e.z, camera.position.x, camera.position.z) > 70 * 70) continue;
    const R = BOAT_RODS[n] || (BOAT_RODS[n] = boatRodMake());
    n++;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), lx = Math.cos(e.yaw), lz = -Math.sin(e.yaw);
    _brA.set(e.x + fx * 0.32 + lx * 0.2, e.seat.y + 0.62, e.z + fz * 0.32 + lz * 0.2);
    _brB.set(fx * 0.72, 0.68, fz * 0.72).normalize();
    R.rod.position.copy(_brA); R.rod.quaternion.setFromUnitVectors(_brU, _brB); R.rod.scale.set(1, 2.4, 1);
    const tip = _brA.clone().addScaledVector(_brB, 2.4);
    const w = waterAt(e.x + fx * 4.4, e.z + fz * 4.4, _bW);
    const by = (w ? w.y : tip.y - 2) + Math.sin(GAME.t * 2.1 + e.id) * 0.015;
    R.bob.position.set(e.x + fx * 4.4, by, e.z + fz * 4.4);
    const d = new THREE.Vector3().subVectors(R.bob.position, tip);
    R.line.position.copy(tip); R.line.quaternion.setFromUnitVectors(_brU, d.clone().normalize()); R.line.scale.set(1, d.length(), 1);
    for (const m of [R.rod, R.line, R.bob]) m.visible = true;
  }
  for (let i = n; i < BOAT_RODS.length; i++) for (const m of [BOAT_RODS[i].rod, BOAT_RODS[i].line, BOAT_RODS[i].bob]) m.visible = false;
}
function boatSfx(name) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const t = AUDIO.ctx.currentTime + 0.005;
  try {
    if (name === 'knock') { tone('sine', 180, 110, t, 0.12, 0.12); noiseBurst(t, 0.08, 0.08, 'bandpass', 500, 300, 1.4); }
    else if (name === 'grind') noiseBurst(t, 0.6, 0.16, 'lowpass', 900, 200, 0.7, 0.02);
    else if (name === 'dip') { noiseBurst(t, 0.22, 0.07, 'bandpass', 1300, 700, 1.1, 0.01); tone('sine', 420, 260, t + 0.02, 0.06, 0.02); }
  } catch (e) { /* audio is optional */ }
}

/* ------------------------------------------------------------------ */
/* the save: where each boat lies and what state it is in               */
/* ------------------------------------------------------------------ */
registerSavePart('world', 'boats', {
  save: () => {
    const out = [];
    for (const B of BOATS.list) {
      const home = B.home && BOATS.jetties[B.home.j] && BOATS.jetties[B.home.j].berths[B.home.b];
      const athome = B.st === 'moored' && home && dist2(home.x, home.z, B.x, B.z) < 1;
      if (athome && !B.char && !B.moved) continue;
      out.push([B.id, Math.round(B.x * 10) / 10, Math.round(B.z * 10) / 10, Math.round(B.yaw * 100) / 100, B.st === 'burning' ? 'burnt' : B.st, Math.round(B.char * 100) / 100]);
    }
    return out.length ? { b: out } : null;
  },
  load: (d) => {
    const rows = d && Array.isArray(d.b) ? d.b : [];
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const B = BOATS.list.find((q) => q.id === r[0]);
      if (!B || !isFiniteNum(r[1]) || !isFiniteNum(r[2]) || !isFiniteNum(r[3])) continue;
      if (Math.hypot(r[1], r[2]) > HALF || !waterAt(r[1], r[2], _bW) && !['beached', 'burnt'].includes(r[4])) continue;
      B.x = r[1]; B.z = r[2]; B.yaw = r[3];
      B.st = ['moored', 'free', 'beached', 'burnt'].includes(r[4]) ? r[4] : 'free';
      B.char = B.st === 'burnt' ? 1 : clamp(+r[5] || 0, 0, 1);
      if (B.st === 'burnt' && B.home) B.rebuildAt = GAME.t + 300;
      B.grounded = B.st === 'beached' || boatHit(B, B.x, B.z, B.yaw) ? 1 : 0;
      boatPose(B, 0);
    }
  },
  key: (d) => (d && d.b ? d.b.map((r) => `${r[0]}:${r[4]}:${Math.round(r[1] / 8)}:${Math.round(r[2] / 8)}`).join() : ''), // a boat rowed about is not written every metre
});

// one line under the path tracker's step (10c_lore.js) while the water is at hand: how to dive, row, step in
function water2PathLine() {
  const P = GAME.player;
  if (!P || !P.alive) return '';
  const t = IS_TOUCH;
  let s = '';
  if (P.boat) s = `At the oars: ${t ? 'the stick rows and turns her' : 'W and S row, A and D turn'}; ${t ? 'Use' : 'E'} to step out or tie up.`;
  else if (P.dive) s = `Under the water: ${t ? 'Up' : 'Space'} rises; mind your breath. ${t ? 'Use' : 'E'} takes what lies on the bed.`;
  else if (P.swim && !diveWhyNot(P)) s = `Deep water: ${t ? 'Dive' : 'U'} to go under. Lost things lie on the lake beds.`;
  else if (BOATS.built && BOATS.list.some((B) => B.st !== 'burnt' && !B.rider && dist2(B.x, B.z, P.x, P.z) < 36)) s = `A boat: ${t ? 'Use' : 'E'} beside her to step in and row.`;
  return s ? `<span class="w2-path">${s}</span>` : '';
}
/* test hooks (window.__hm.water.boats) */
const BOATS_DEBUG = {
  BOATS, board: (i) => boatBoard(BOATS.list[i], GAME.player), leave: (spot) => boatLeave(GAME.player, spot || null), moor: (i, j) => boatMoor(BOATS.list[i], BOATS.jetties[j ?? 0]), ignite: (i) => boatIgnite(BOATS.list[i], GAME.player), restore: (i) => boatRestore(BOATS.list[i]),
  hit: (i, x, z, yaw) => { const B = BOATS.list[i]; const h = boatHit(B, x ?? B.x, z ?? B.z, yaw ?? B.yaw); return h ? { x: h.x, z: h.z, why: h.why } : null; },
  phys: (i, dt, thrust, turn) => { const B = BOATS.list[i]; const h = boatPhys(B, dt, thrust, turn); boatPose(B, dt); return h ? h.why : null; },
  state: (i) => { const B = BOATS.list[i]; if (!B) return null; return { id: B.id, realm: B.realm, x: B.x, z: B.z, y: B.y, yaw: B.yaw, vx: B.vx, vz: B.vz, sp: Math.hypot(B.vx, B.vz), st: B.st, char: B.char, rider: B.rider, pass: B.pass, grounded: B.grounded, ph: B.ph, eff: B.eff, home: B.home, still: !!B.still, launch: !!B.launch, wr: B.wr }; },
  list: () => BOATS.list.map((B, i) => ({ i, id: B.id, realm: B.realm, x: B.x, z: B.z, st: B.st, home: !!B.home })),
  jetties: () => BOATS.jetties.map((J) => ({ realm: J.realm, x0: J.x0, z0: J.z0, dx: J.dx, dz: J.dz, len: J.len, deck: J.deck, end: J.end, land: J.land, berths: J.berths, steps: J.steps, fisher: J.fisher })),
  landing: (i) => boatLanding(BOATS.list[i]), offers: () => { const L = []; boatOffers(GAME.player, (d, r, label) => { if (d < r) L.push(label); }); return L; },
  life: boatLife, fisherMorning,
  shoveOff: (i) => boatShoveOff(BOATS.list[i], GAME.player), pushed: boatPushed, shoveEnd: (i) => boatShoveEnd(BOATS.list[i]), // [polish]
};
WATER_DEBUG.boats = BOATS_DEBUG; // window.__hm.water.boats
