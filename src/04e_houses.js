/* ================================================================== */
/* houses: hinged doors and shutters, rooms you can walk into, roofs   */
/* that catch fire, fall in and are built again                        */
/* ================================================================== */
// Every town house gets a record in HOUSES when the town is laid out (planHouse, called from buildTown): its walls,
// openings, furniture, colliders and the points its roof burns from. The houses of a town are drawn in three
// batches (buildHouses, called from townModel): the shell with its doors, shutters, ruin and scaffold; the
// furnishings, culled when far; and the window glass. One shader draws them and reads each house's state from
// small uniform arrays: how charred it is, whether the roof has fallen, and how far each door and shutter stands open.
const HOUSES = [];
const HOUSE_MAXH = 8, HOUSE_MAXLEAF = 96;
// part kinds (aPart.y): what a piece of a house is; it decides how the piece is lit and when it is drawn
const HPART = { EXT: 0, ROOF: 1, SHELL: 2, FURN: 3, LEAF: 4, RUIN: 5, SCAF: 6, ROOFIN: 7 };
const HOUSE_STAGE = { whole: 0, burning: 1, ruin: 2, scaffold: 3 };
// seconds: the fire crossing the roof, the roof coming down, the smoking ruin, the scaffold
const HOUSE_TIME = { spread: [24, 32], fall: 1.4, ruin: 110, smoulder: 70, scaffold: 70 };
const HOUSE_DOOR_SWING = 95 * DEG, HOUSE_SHUTTER_SWING = 168 * DEG;

/* ------------------------------------------------------------------ */
/* frames                                                              */
/* ------------------------------------------------------------------ */
// house-local (x across, z toward the door) <-> world, the same yaw convention as siteToWorld
function houseW(H, lx, lz) { return { x: H.x + lx * H.c + lz * H.s, z: H.z - lx * H.s + lz * H.c }; }
function houseL(H, x, z) { const dx = x - H.x, dz = z - H.z; return { x: dx * H.c - dz * H.s, z: dx * H.s + dz * H.c }; }
// a wall's frame in house coordinates: origin on the outer face, u along the wall (left to right seen from
// outside), n out of the house. Box houses number their faces 0 front (the door), 1 right, 2 back, 3 left;
// a round house uses the flat facet that faces out at angle f.
function houseFace(H, f) {
  if (H.round) return { ox: Math.sin(f) * H.r, oz: Math.cos(f) * H.r, ux: Math.cos(f), uz: -Math.sin(f), nx: Math.sin(f), nz: Math.cos(f), yaw: f };
  const w2 = H.w / 2, d2 = H.d / 2;
  if (f === 0) return { ox: 0, oz: d2, ux: 1, uz: 0, nx: 0, nz: 1, yaw: 0 };
  if (f === 1) return { ox: w2, oz: 0, ux: 0, uz: -1, nx: 1, nz: 0, yaw: Math.PI / 2 };
  if (f === 2) return { ox: 0, oz: -d2, ux: -1, uz: 0, nx: 0, nz: -1, yaw: Math.PI };
  return { ox: -w2, oz: 0, ux: 0, uz: 1, nx: -1, nz: 0, yaw: -Math.PI / 2 };
}
const faceP = (F, u, n) => ({ x: F.ox + u * F.ux + n * F.nx, z: F.oz + u * F.uz + n * F.nz });
function houseWorldOnFace(H, F, u, n) { const p = faceP(F, u, n); return houseW(H, p.x, p.z); }

/* ------------------------------------------------------------------ */
/* layout: called from buildTown while the world is being made         */
/* ------------------------------------------------------------------ */
function planHouse(S, R, h, ti) {
  const style = R.style, round = style === 'round', big = h.kind === 'hall';
  const rnd = mulberry(Math.floor(h.seed * 1e6) + 7717);
  const by = heightAt(h.x, h.z);
  const H = {
    num: HOUSES.length, ti, S, realm: R.id, style, round, big, kind: h.kind, src: h, seed: h.seed, keepHall: !!h.keep, // [building] a keep's great hall (04k_hall.js)
    x: h.x, z: h.z, y: by, yaw: h.yaw, c: Math.cos(h.yaw), s: Math.sin(h.yaw),
    state: 'whole', stT: 0, char: 0, ember: 0, fall: 0, burn: null, residents: [], items: [], coll: [], furnColl: [],
  };
  h.rec = H;
  if (!S.houseLeaves) S.houseLeaves = [];
  const leaf = (kind, extra) => { const L = { i: S.houseLeaves.length, H, kind, open: 0, target: 0, ...extra }; S.houseLeaves.push(L); return L; };
  if (round) {
    H.r = roundHouseR(h);
    H.N = big ? 24 : 16;
    H.t = big ? 0.34 : 0.28;
    H.ri = H.r - H.t;
    H.H0 = big ? 4.0 : h.h - 0.2;               // the eave line of the old wall
    H.Rr = H.r * 1.32 + 0.3;                    // the thatch's outer rim
    H.hc = H.Rr * (big ? 0.98 : 1.06);          // and its height
    H.y0 = H.H0 - 0.3;
    H.roofAt = (rad) => H.y0 + H.hc * (1 - rad / H.Rr);   // top of the thatch over a radius (local y)
    H.ceilAt = (rad) => H.roofAt(rad) - 0.42;              // its underside, seen from within
    H.wallH = H.roofAt(H.r) - 0.05;                        // the wall runs up under the thatch
    H.top = H.y0 + H.hc + (big ? 1.4 : 0.2);
    H.foot = H.Rr;                                         // reach of the roof from the centre
    H.ceilLocal = (lx, lz) => H.ceilAt(Math.hypot(lx, lz));
  } else {
    H.w = h.w; H.d = h.d; H.wallH = h.h;
    H.t = style === 'timber' ? 0.34 : 0.26;
    H.iw = H.w / 2 - H.t; H.id = H.d / 2 - H.t;
    H.pitch = h.pitch || (style === 'timber' ? (big ? 0.92 : 0.95) : (big ? 0.82 : 0.86)); // [building] a keep hall sets its own
    H.tn = Math.tan(H.pitch); H.cs = Math.cos(H.pitch); H.sn = Math.sin(H.pitch);
    H.rh = (H.w / 2) * H.tn;
    H.roofTh = style === 'timber' ? 0.2 : big ? 0.22 : 0.38;
    H.ohSide = style === 'timber' ? 0.5 : big ? 0.45 : 0.55;
    H.ohGable = style === 'timber' ? 0.55 : big ? 0.35 : 0.4;
    H.top = H.wallH + H.rh + 0.3;
    H.foot = Math.hypot(H.w / 2 + H.ohSide, H.d / 2 + H.ohGable);
    // the underside of the roof boards over a point inside (local y)
    H.ceilLocal = (lx) => H.wallH + H.rh - Math.abs(lx) * H.tn - H.roofTh / H.cs - 0.05;
  }
  // the door: on the front, hinged on one jamb, swinging in
  const hs = rnd() < 0.5 ? -1 : 1;
  if (round) H.door = { F: houseFace(H, 0), u: 0, w: big ? 1.4 : 1.05, h: big ? 2.3 : 2.0, hs };
  else {
    const dw = big ? (style === 'timber' ? 1.6 : 1.7) : 1.05, dh = big ? (style === 'timber' ? 2.5 : 2.6) : style === 'timber' ? 2.0 : 2.05;
    H.door = { F: houseFace(H, 0), face: 0, u: 0, w: dw, h: dh, hs };
  }
  // windows: real holes through the wall with glass or open, and a pair of shutters outside
  if (round) {
    const fa = TAU / H.N, wa = Math.round(1.25 / fa) * fa;
    const defs = [-1, 1].map((s) => [s * wa]);
    if (big) defs.push([-Math.round(2.4 / fa) * fa], [Math.round(2.4 / fa) * fa]);
    H.wins = defs.map(([a]) => ({ a, F: houseFace(H, a), u: 0, y: big ? 2.0 : 1.75, w: big ? 0.6 : 0.46, h: big ? 0.62 : 0.5, glazed: false, shutters: true }));
  } else if (style === 'timber') {
    const wy = big ? 2.2 : 1.85;
    H.wins = [[0, -H.w * 0.32], [0, H.w * 0.32], [1, 0], [3, 0]].map(([f, u]) => ({ face: f, F: houseFace(H, f), u, y: wy, w: 0.56, h: 0.56, glazed: true, shutters: true }));
  } else {
    // the front windows sit midway between the door frame and the corner, room enough for both shutters to fold back
    const ww = big ? 0.8 : 0.6, wh = big ? 1.5 : 0.78, wy = big ? 2.3 : 1.95;
    const uf = (H.door.w / 2 + 0.3 + H.w / 2 - 0.22) / 2;
    H.wins = [[0, -uf, ww], [0, uf, ww], [1, -H.d * 0.22, 0.72], [1, H.d * 0.22, 0.72], [3, -H.d * 0.22, 0.72], [3, H.d * 0.22, 0.72]]
      .map(([f, u, w]) => ({ face: f, F: houseFace(H, f), u, y: wy, w, h: wh, glazed: true, shutters: !big, arch: big }));
  }
  // hinge lines in the world (the shader turns each leaf about its own)
  {
    const D = H.door, F = D.F;
    D.hingeU = D.hs * (D.w / 2 - 0.02); D.hingeN = -0.12;
    const hp = houseWorldOnFace(H, F, D.hingeU, D.hingeN);
    D.leaf = leaf('door', { hx: hp.x, hz: hp.z, swing: -D.hs * HOUSE_DOOR_SWING, rate: 2.0 });
    D.c = houseWorldOnFace(H, F, 0, -H.t / 2);
    D.out = houseWorldOnFace(H, F, 0, 1.0);
    D.out2 = houseWorldOnFace(H, F, 0, 3.4);
    D.in = houseWorldOnFace(H, F, 0, -H.t - (H.round ? 1.45 : 1.55));  // far enough in that the swinging leaf clears whoever stands here
  }
  const zs = style === 'timber' ? 0.12 : round ? 0.1 : 0.13;
  H.wins.forEach((win, k) => {
    const F = win.F;
    win.k = k;
    win.c = houseWorldOnFace(H, F, win.u, 0);
    win.out = houseWorldOnFace(H, F, win.u, 0.95);
    win.in = houseWorldOnFace(H, F, win.u, -H.t - 0.62);
    win.nW = { x: F.nx * H.c + F.nz * H.s, z: -F.nx * H.s + F.nz * H.c };
    win.target = 0;
    win.leaves = [];
    if (win.shutters) {
      win.zs = zs;
      win.sw = win.w / 2 + 0.07;
      for (const sd of [-1, 1]) {
        const hu = win.u + sd * (win.w / 2 + 0.07);
        const hp = houseWorldOnFace(H, F, hu, zs);
        win.leaves.push(leaf('shutter', { hx: hp.x, hz: hp.z, hu, side: sd, swing: sd * HOUSE_SHUTTER_SWING, rate: 2.2, win }));
      }
    }
  });
  houseLayout(H, rnd);
  houseColliders(H);
  for (const win of H.wins) win.in = houseClearSpot(H, win.F, win.u, -H.t - 0.62);
  houseRoofPoints(H);
  houseClearGround(H);
  HOUSES.push(H);
  return H.coll;
}

/* furniture and the places people stand, in house coordinates */
function houseLayout(H, rnd) {
  const L = H.items;
  const put = (type, x, z, yaw = 0, o = {}) => { const it = { type, x, z, yaw, ...o }; L.push(it); return it; };
  const hs = H.door.hs, cs = -hs;  // cs: the front corner the door does not swing into
  const spots = H.spots = {};
  if (H.keepHall) keepHallLayout(H, put, spots); // [building] the great hall's own furnishing (04k_hall.js)
  else if (H.round) {
    const ri = H.ri, big = H.big;
    const polar = (a, rad) => ({ x: Math.sin(a) * rad, z: Math.cos(a) * rad });
    const at = (type, a, rad, yaw, o) => { const p = polar(a, rad); return put(type, p.x, p.z, yaw, o); };
    if (!big) {
      // a small roundhouse has room for one bed and a stool; a larger one for two beds and a bench
      const small = ri < 3.0;
      put('ringhearth', 0, 0, 0, { r: small ? 0.45 : 0.56, coll: { r: small ? 0.55 : 0.66 } });
      for (const s of small ? [-hs] : [-1, 1]) at('bed', s * 2.25, ri - 0.5, s * 2.25 + Math.PI / 2, { coll: { hx: 0.5, hz: 1.0 } });
      const ta = -hs * 0.95, tr = ri - (small ? 0.5 : 0.74);
      at('table', ta, tr, ta + Math.PI / 2, { len: small ? 1.0 : 1.2, benches: small ? 0 : 1, coll: small ? { hx: 0.42, hz: 0.54 } : { hx: 0.6, hz: 0.64, ox: 0.18 } });
      if (small) at('stool', ta, tr - 0.72, 0, {});
      at('loom', hs * 1.6, ri - 0.3, hs * 1.6 + Math.PI, { coll: { hx: 0.66, hz: 0.24 } });
      at('dresser', Math.PI, ri - 0.26, 0, { coll: { hx: 0.56, hz: 0.26 } });
      at('barrels', hs * 1.08, ri - 0.44, 0, { coll: { r: 0.44 } });
      at('rug', -hs * 0.35, 1.2, -hs * 0.35, { sx: 1.1, sz: 0.75, fur: true });
      at('herbs', 2.6, ri - 0.9, 0, { n: 5 });
      if (!small) at('quern', -hs * 1.45, ri - 0.45, 0, { coll: { r: 0.32 } });
      H.hearth = { lx: 0, lz: 0, y: 0.12, size: small ? 0.42 : 0.5 };
      H.lamp = { lx: Math.sin(Math.PI) * 1.4, lz: Math.cos(Math.PI) * 1.4, y: H.ceilAt(1.4) - 0.75 };
      const sp = polar(ta, tr - (small ? 0.72 : 0.62));
      spots.seat = { x: sp.x, z: sp.z, yaw: ta, h: 0.46, stool: small };
      spots.hearth = { x: Math.sin(hs * 2.4) * (small ? 1.12 : 1.25), z: Math.cos(hs * 2.4) * (small ? 1.12 : 1.25) };
      spots.mid = { x: hs * 0.9, z: 1.25 };
    } else {
      // the hall: a great hearth, benches round it, box beds at the walls, the chieftain's seat at the back
      put('ringhearth', 0, 0, 0, { r: 1.0, coll: { r: 1.1 } });
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; at('bench', a, 2.5, a + Math.PI / 2, { len: 2.2, coll: { hx: 0.22, hz: 1.1 } }); }
      for (const a of [1.95, -1.95, 2.75, -2.75]) at('bed', a, ri - 0.5, a + Math.PI / 2, { coll: { hx: 0.5, hz: 1.0 } });
      at('highseat', Math.PI, ri - 0.55, 0, { coll: { hx: 0.55, hz: 0.45 } });
      for (const s of [-1, 1]) at('table', s * 1.05, ri - 0.85, s * 1.05 + Math.PI / 2, { len: 1.6, benches: 1, coll: { hx: 0.6, hz: 0.82, ox: 0.18 } });
      at('barrels', hs * 0.55, ri - 0.5, 0, { coll: { r: 0.44 } });
      at('barrels', hs * 0.75, ri - 0.5, 0, { coll: { r: 0.44 } });
      at('dresser', -hs * 0.6, ri - 0.26, -hs * 0.6 + Math.PI, { coll: { hx: 0.56, hz: 0.26 } });
      at('rug', 0, 2.0, 0, { sx: 1.8, sz: 1.1 });
      at('herbs', 2.2, ri - 1.2, 0, { n: 6 });
      at('herbs', -2.2, ri - 1.2, 0, { n: 6 });
      for (const a of [1.6, -1.6, 2.4, -2.4]) at('shield', a, ri, a + Math.PI, { y: 2.3 });
      H.hearth = { lx: 0, lz: 0, y: 0.14, size: 0.85 };
      H.lamp = { lx: 0, lz: -3.2, y: H.ceilAt(3.2) - 0.8 };
      const sp = polar(Math.PI / 4, 2.5);
      spots.seat = { x: sp.x, z: sp.z, yaw: Math.PI / 4 + Math.PI, h: 0.46 };
      spots.hearth = { x: 0, z: 1.7 };
      spots.mid = { x: 0, z: 3.2 };
    }
  } else if (H.style === 'timber') {
    const iw = H.iw, id = H.id;
    const sx = -H.w * 0.2, sz = -H.d * 0.18;
    put('stove', sx, sz, 0, { coll: { r: 0.74 } });
    put('bed', iw - 1.0, -id + 0.5, Math.PI / 2, { coll: { hx: 0.5, hz: 1.0 } });
    put('table', iw - 0.62, 0.5, 0, { len: 1.4, benches: -1, coll: { hx: 0.6, hz: 0.74, ox: -0.18 } });
    put('shelves', iw - 2.45, -id, 0, { len: 0.9 });
    put('chest', iw - 0.32, -id + 1.32, Math.PI / 2, { coll: { hx: 0.42, hz: 0.25 } });
    put('barrels', cs * (iw - 0.42), id - 0.46, 0, { coll: { r: 0.44 } });
    put('crate', cs * (iw - 0.38), id - 1.32, 0.3, { coll: { r: 0.38 } });
    put('rug', sx + 0.35, sz + 1.25, 0.15, { sx: 1.3, sz: 0.85, fur: true });
    put('shield', iw - 1.0, -id, 0, { y: 1.95 });
    put('herbs', sx + 0.7, -id * 0.48, 0, { n: 4 });
    put('pegs', hs * (H.door.w / 2 + 0.42), id, Math.PI, { y: 1.42 });
    H.hearth = { lx: sx, lz: sz, y: 0.44, size: 0.45 };
    H.lamp = { lx: 0.45, lz: H.id * 0.48, y: H.wallH - 0.7 };
    spots.seat = { x: iw - 1.3, z: 0.5, yaw: Math.PI / 2, h: 0.46 };
    spots.hearth = { x: sx + 0.9, z: sz + 0.9, face: { x: sx, z: sz } };
    spots.mid = { x: -0.15, z: 0.9 };
  } else {
    const iw = H.iw, id = H.id;
    put('fireplace', 0, -id, 0, { coll: { hx: 0.86, hz: 0.36, oz: 0.34 } });
    put('bed', iw - 0.5, -id + 1.05, 0, { coll: { hx: 0.5, hz: 1.0 } });
    put('chest', iw - 0.5, -id + 2.33, 0, { coll: { hx: 0.42, hz: 0.25 } });
    put('table', -iw + 0.92, 0.05, 0, { len: 1.4, benches: 2, coll: { hx: 0.82, hz: 0.74 } });
    put('shelves', -iw, 0.0, Math.PI / 2, { len: 1.1 });
    put('rug', 0, -id + 1.45, 0, { sx: 1.6, sz: 1.0 });
    put('barrels', cs * (iw - 0.42), id - 0.46, 0, { coll: { r: 0.44 } });
    put('crate', cs * (iw - 0.38), id - 1.32, 0.2, { coll: { r: 0.38 } });
    put('stool', 0.78, -id + 1.15, 0.4, {});
    put('herbs', 0.1, -id * 0.48, 0, { n: 5 });
    put('pegs', hs * (H.door.w / 2 + 0.42), id, Math.PI, { y: 1.42 });
    H.hearth = { lx: 0, lz: -id + 0.3, y: 0.16, size: 0.5 };
    H.lamp = { lx: 0.45, lz: H.id * 0.48, y: H.wallH - 0.7 };
    spots.seat = { x: -iw + 0.92 + 0.62, z: 0.05, yaw: -Math.PI / 2, h: 0.46 };
    spots.hearth = { x: -0.45, z: -id + 1.3, face: { x: 0, z: -id } };
    spots.mid = { x: 0.35, z: 0.4 };
  }
  // world positions for the fire, the lamp and the places people go
  const hp = houseW(H, H.hearth.lx, H.hearth.lz);
  H.hearth.x = hp.x; H.hearth.z = hp.z; H.hearth.wy = H.y + H.hearth.y;
  const lp = houseW(H, H.lamp.lx, H.lamp.lz);
  H.lamp.x = lp.x; H.lamp.z = lp.z; H.lamp.wy = H.y + H.lamp.y;
  // a bench is sat on from behind it; a stool from where it stands
  if (spots.seat) { const s = spots.seat, k = s.stool ? 0 : 0.68; s.ax0 = s.x - Math.sin(s.yaw) * k; s.az0 = s.z - Math.cos(s.yaw) * k; }
  for (const k in spots) {
    const s = spots[k], w = houseW(H, s.x, s.z);
    if (s.ax0 !== undefined) { const a = houseW(H, s.ax0, s.az0); s.ax = a.x; s.az = a.z; }
    s.wx = w.x; s.wz = w.z;
    if (s.face) { const f = houseW(H, s.face.x, s.face.z); s.fx = f.x; s.fz = f.z; }
    if (s.yaw !== undefined) s.wyaw = H.yaw + s.yaw;
  }
}

/* walls with a gap for the door, the door itself, and the furniture */
function houseColliders(H) {
  const top = H.top - H.y + 0.5, out = H.coll;
  const D = H.door;
  const wallBox = (F, u0, u1, n0, n1, tag = 'house') => {
    if (u1 - u0 < 0.02) return null;
    const p = houseWorldOnFace(H, F, (u0 + u1) / 2, (n0 + n1) / 2);
    const c = addBox(p.x, p.z, (u1 - u0) / 2, (n1 - n0) / 2, H.yaw + F.yaw, tag, top);
    out.push(c);
    return c;
  };
  const gap = D.w / 2 - 0.01;
  if (H.round) {
    const N = H.N, fa = TAU / N, half = H.r * Math.tan(fa / 2) + 0.02;
    for (let i = 0; i < N; i++) {
      const a = i * fa, F = houseFace(H, a);
      if (Math.abs(angDiff(a, 0)) < 1e-3) { wallBox(F, -half, -gap, -H.t, 0); wallBox(F, gap, half, -H.t, 0); }
      else wallBox(F, -half, half, -H.t, 0);
    }
  } else {
    const w2 = H.w / 2, d2 = H.d / 2;
    wallBox(houseFace(H, 0), -w2, -gap, -H.t, 0); wallBox(houseFace(H, 0), gap, w2, -H.t, 0);
    wallBox(houseFace(H, 2), -w2, w2, -H.t, 0);
    wallBox(houseFace(H, 1), -d2, d2, -H.t, 0); wallBox(houseFace(H, 3), -d2, d2, -H.t, 0);
  }
  // the closed door fills the gap; the open leaf stands out from its hinge into the room
  {
    const F = D.F, p = houseWorldOnFace(H, F, 0, -H.t / 2);
    D.coll = addBox(p.x, p.z, D.w / 2 + 0.04, H.t / 2 + 0.04, H.yaw + F.yaw, 'hdoor', D.h + 0.2);
    out.push(D.coll);
    const a = D.leaf.swing, dirU = -D.hs, ca = Math.cos(a), sa = Math.sin(a);
    // the leaf's direction from the hinge, turned by the swing (u along the wall, n out)
    const du = dirU * ca, dn = -dirU * sa;
    const mid = houseWorldOnFace(H, F, D.hingeU + du * D.w / 2, D.hingeN + dn * D.w / 2);
    const wx = (F.ux * du + F.nx * dn), wz = (F.uz * du + F.nz * dn);
    const gx = wx * H.c + wz * H.s, gz = -wx * H.s + wz * H.c;
    D.collLeaf = addBox(mid.x, mid.z, D.w / 2, 0.05, Math.atan2(-gz, gx), 'hdoor', D.h + 0.2);
    D.collLeaf.active = false;
    out.push(D.collLeaf);
  }
  for (const it of H.items) {
    if (!it.coll) continue;
    const c = it.coll;
    let col;
    const cy = Math.cos(it.yaw), sy = Math.sin(it.yaw);
    const ox = c.ox || 0, oz = c.oz || 0;
    const lp = { x: it.x + ox * cy + oz * sy, z: it.z - ox * sy + oz * cy };
    const wp = houseW(H, lp.x, lp.z);
    if (c.r) col = addCircle(wp.x, wp.z, c.r, 'furn', 1.2);
    else col = addBox(wp.x, wp.z, c.hx, c.hz, H.yaw + it.yaw, 'furn', 1.2);
    H.furnColl.push(col);
    out.push(col);
  }
  if (H.keepHall) keepHallColliders(H, out); // [building] the porch posts of a keep's hall (04k_hall.js)
}

// does a collider take in a circle of radius r at (x, z)
function collCovers(c, x, z, r) {
  if (c.type === 'circle') return dist2(x, z, c.x, c.z) < (c.r + r) ** 2;
  const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
  return Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r;
}
// a place to stand inside, in front of a wall at u, clear of the furniture: as near the wall as it can be
function houseClearSpot(H, F, u, n0) {
  for (const n of [n0, n0 - 0.3, n0 - 0.6, n0 - 0.9, n0 - 1.25]) {
    const p = houseWorldOnFace(H, F, u, n);
    if (!H.furnColl.some((c) => collCovers(c, p.x, p.z, 0.44))) return p;
  }
  return houseWorldOnFace(H, F, u, n0 - 1.25);
}
/* points on the roof where the flames stand as the fire spreads */
function houseRoofPoints(H) {
  const pts = H.roofPts = [];
  const add = (lx, ly, lz) => { const w = houseW(H, lx, lz); pts.push({ x: w.x, y: H.y + ly, z: w.z, lx, lz }); };
  if (H.round) {
    // rings from the rim up toward the apex, fewer as they shrink
    for (const f of [0.18, 0.5, 0.8]) {
      const n = f < 0.3 ? 9 : f < 0.6 ? 6 : 3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + f * 2.1, rad = (H.Rr - 0.3) * (1 - f) + 0.25;
        add(Math.sin(a) * rad, H.roofAt(rad) + 0.05, Math.cos(a) * rad);
      }
    }
  } else {
    const L = H.d + 2 * H.ohGable - 0.6, run = H.w / 2 + H.ohSide - 0.25;
    for (const s of [-1, 1]) for (const f of [0.18, 0.55, 0.88]) for (let k = 0; k < 4; k++) {
      const x = s * run * f, z = -L / 2 + ((k + 0.5) / 4) * L;
      add(x, H.wallH + H.rh - Math.abs(x) * H.tn + 0.04, z);
    }
  }
}

/* no grass or flowers grow on a floor: clear the masks under the house and a trodden yard around it */
function houseClearGround(H) {
  const pad = 0.9, reach = (H.round ? H.r : Math.hypot(H.w, H.d) / 2) + pad + HS;
  const i0 = Math.max(0, Math.floor((H.x - reach + HALF) / HS)), i1 = Math.min(HN - 1, Math.ceil((H.x + reach + HALF) / HS));
  const j0 = Math.max(0, Math.floor((H.z - reach + HALF) / HS)), j1 = Math.min(HN - 1, Math.ceil((H.z + reach + HALF) / HS));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -HALF + i * HS, z = -HALF + j * HS, l = houseL(H, x, z);
    const inside = H.round ? Math.hypot(l.x, l.z) < H.r + pad : Math.abs(l.x) < H.w / 2 + pad && Math.abs(l.z) < H.d / 2 + pad;
    if (!inside) continue;
    const k = j * HN + i;
    W.grass[k] = 0; W.flower[k] = 0;
  }
}

/* ------------------------------------------------------------------ */
/* queries: which house is here, and is a point inside it              */
/* ------------------------------------------------------------------ */
// the house whose walls (grown by pad) stand around (x, z), or null
function houseAt(x, z, pad = 0) {
  for (const H of HOUSES) {
    const rr = (H.round ? H.r : Math.hypot(H.w, H.d) / 2) + pad + 0.5;
    if (dist2(x, z, H.x, H.z) > rr * rr) continue;
    const l = houseL(H, x, z);
    if (H.round ? Math.hypot(l.x, l.z) <= H.r + pad : Math.abs(l.x) <= H.w / 2 + pad && Math.abs(l.z) <= H.d / 2 + pad) return H;
  }
  return null;
}
// is (x, z) on the floor inside H's walls (the doorway counts as outside)
function houseHas(H, x, z, margin = 0) {
  const l = houseL(H, x, z);
  if (H.round) return Math.hypot(l.x, l.z) < H.ri - margin;
  return Math.abs(l.x) < H.iw - margin && Math.abs(l.z) < H.id - margin;
}
function houseInside(x, z, margin = 0) {
  const H = houseAt(x, z);
  return H && houseHas(H, x, z, margin) ? H : null;
}
const houseStageNum = (H) => HOUSE_STAGE[H.state] ?? 0;

/* ------------------------------------------------------------------ */
/* drawing: a batch that also records each vertex's house, part and hinge */
/* ------------------------------------------------------------------ */
class HouseBatch extends Batch {
  constructor() { super(); this.hp = []; this.hg = []; this.hi = -1; this.kind = HPART.EXT; this.hinge = null; }
  add(geo, m4, matId, color, baseY = null, aoH = 3) {
    const n0 = this.n;
    super.add(geo, m4, matId, color, baseY, aoH);
    const h = this.hinge;
    for (let i = n0; i < this.n; i++) {
      this.hp.push(this.hi, this.kind);
      if (h) this.hg.push(h[0], h[1], h[2], h[3]); else this.hg.push(0, 0, -1, 0);
    }
  }
  build() {
    const g = super.build();
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.hp, 2));
    g.setAttribute('aHinge', new THREE.Float32BufferAttribute(this.hg, 4));
    return g;
  }
}
// a flat pane (glass) and a gable wedge
const HG = {
  plane: new THREE.PlaneGeometry(1, 1),
  // a square frustum: 1 across at the base, 0.62 at the top, 1 high
  hood: (() => { const g = new THREE.CylinderGeometry(0.62 * Math.SQRT1_2, Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4); const f = g.toNonIndexed(); f.computeVertexNormals(); return f; })(),
};

// The house shader is the building shader with four additions, patched in at named lines (and checked, so a change
// to the building shader that moves one of them stops the boot instead of quietly breaking the houses):
// parts hide or fall with the house's stage, doors and shutters turn on their hinges, rooms are lit by their own
// hearth and lamp rather than the sky, and fire chars and lights what it burns.
function houseShaderPatch(src, anchor, fn) {
  if (!src.includes(anchor)) throw new Error('house shader: the building shader no longer has "' + anchor + '"');
  return src.replace(anchor, fn(anchor));
}
const HOUSE_VS = /* glsl */`
  uniform vec4 uHA[${HOUSE_MAXH}];
  uniform vec4 uHC[${HOUSE_MAXH}];
  uniform vec4 uLeaf[${HOUSE_MAXLEAF / 4}];
  attribute vec3 aCol; attribute float aMat; attribute float aAO;
  attribute vec2 aPart; attribute vec4 aHinge;
  varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vMat; varying float vAO; varying vec2 vHP;
  void main(){
    vHP = aPart; vCol = aCol; vMat = aMat; vAO = aAO;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 nrm = normal;
    if (aPart.x > -0.5) {
      int hi = int(aPart.x + 0.5), kind = int(aPart.y + 0.5);
      vec4 A = uHA[hi];
      bool gone = A.y > 1.5, scaf = A.y > 2.5;
      // a ruin has no roof, furniture, doors or glass; the debris shows only in the ruin, the scaffold only while building
      bool hide = (gone && (kind == 1 || kind == 3 || kind == 4 || kind == 7)) || (kind == 5 && (!gone || scaf)) || (kind == 6 && !scaf);
      if (hide) { vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
      // the roof falls in: it drops down inside the walls and sags toward the middle
      if (A.z > 0.0 && (kind == 1 || kind == 7)) {
        vec4 C = uHC[hi];
        float k = A.z * A.z;
        w.y -= k * max(w.y - C.z + 1.3, 0.0) * 0.86;
        w.xz = mix(w.xz, C.xy, k * 0.16);
      }
    }
    if (aHinge.z > -0.5) {
      // a door or shutter leaf: turn about its hinge line
      int li = int(aHinge.z + 0.5);
      float a = uLeaf[li / 4][li % 4] * aHinge.w;
      float c = cos(a), s = sin(a);
      vec2 d = w.xz - aHinge.xy;
      w.xz = aHinge.xy + vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
      nrm = vec3(nrm.x * c + nrm.z * s, nrm.y, -nrm.x * s + nrm.z * c);
    }
    vW = w.xyz; vN = mat3(modelMatrix) * nrm;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const HOUSE_FS = (() => {
  let fs = buildingMat.fragmentShader;
  // weather stays outside: rooms are neither wet nor snowed on
  fs = houseShaderPatch(fs, 'uniform float uFlash, uWet, uSnowCover;', (a) => a + /* glsl */`
    uniform vec4 uHA[${HOUSE_MAXH}]; uniform vec4 uHB[${HOUSE_MAXH}]; uniform vec4 uHL[${HOUSE_MAXH}]; uniform vec4 uHM[${HOUSE_MAXH}]; uniform vec4 uHC[${HOUSE_MAXH}]; uniform vec4 uHY[${HOUSE_MAXH}];
    uniform vec4 uHD[${HOUSE_MAXH}]; // [siege2] battered by stones: the roof's hole (x, z, radius), how battered (+2: fell to stones) (04j_batter.js)
    varying vec2 vHP;
    float houseWetU(){ return uWet; }
    float houseSnowU(){ return uSnowCover; }
    float hWet = 0.0, hSnow = 0.0;
    #define uWet hWet
    #define uSnowCover hSnow
  `);
  fs = houseShaderPatch(fs, 'void main(){', (a) => /* glsl */`
    // sunlight reaches a room only where the shadow map lets it in (through the windows and the door)
    float houseShadow(vec3 wp, vec3 n){
      if (uShadowOn < 0.001) return 0.0;
      vec3 s = shadowCoord(wp + n * uShadowParams.z);
      if (shadowOut(s)) return 0.0;
      float r = 1.6 * uShadowParams.x, sum = 0.0;
      for (int i = 0; i < 5; i++) sum += step(s.z - uShadowParams.y, texture(uShadowMap, s.xy + SH_TAPS[i] * r).r);
      return sum / 5.0;
    }
    // a room: dim daylight from the openings, sun patches, the hearth's flicker and the lamp, a little bounce
    vec3 houseIndoor(vec3 alb, vec3 n, float ao, int hi){
      float sun = houseShadow(vW, n) * clamp(dot(n, uLightDir), 0.0, 1.0);
      vec3 amb = uAmbient * (0.17 + 0.23 * ao) + uZenith * 0.06;
      vec4 F = uHL[hi], M = uHM[hi];
      vec3 lf = F.xyz - vW; float df = max(length(lf), 0.05);
      float fl = 0.86 + 0.1 * sin(uTime * 11.3 + float(hi) * 1.7) + 0.05 * sin(uTime * 23.1 + float(hi));
      vec3 fire = vec3(1.0, 0.5, 0.2) * F.w * fl * clamp(dot(n, lf / df) * 0.65 + 0.35, 0.0, 1.0) / (1.0 + df * df * 0.5);
      vec3 lm = M.xyz - vW; float dm = max(length(lm), 0.05);
      vec3 lamp = vec3(1.0, 0.7, 0.38) * M.w * clamp(dot(n, lm / dm) * 0.6 + 0.4, 0.0, 1.0) / (1.0 + dm * dm * 0.8);
      vec3 bounce = vec3(0.42, 0.24, 0.11) * F.w * fl * 0.16 + vec3(0.4, 0.3, 0.18) * M.w * 0.07;
      return alb * (amb * ao + uLightColor * 0.85 * sun + (fire + lamp + bounce) * mix(0.6, 1.0, ao) + gPL * 0.75);
    }
    // the surfaces only houses have: floorboards, limewash, a woven rug, a fleece, an earth floor strewn with rushes
    vec3 houseAlbedo(int m, vec3 n, int hi, vec3 alb){
      vec4 Y = uHY[hi];
      vec2 d = vW.xz - uHC[hi].xy;
      vec2 q = vec2(dot(d, vec2(Y.x, -Y.y)), dot(d, vec2(Y.y, Y.x)));
      if (m == 40) {
        float u, v;
        if (abs(n.y) > 0.55) { u = q.x; v = q.y; } else { u = dot(vW.xz, vec2(n.z, -n.x)); v = vW.y; }
        float pw = 0.2, pi = floor(u / pw), pf = fract(u / pw);
        float id = hash12(vec2(pi, 3.7));
        float bj = fract(v / (1.4 + 1.6 * id) + id * 3.1);
        float seam = smoothstep(0.0, 0.05, pf) * (1.0 - smoothstep(0.95, 1.0, pf)) * smoothstep(0.0, 0.012, bj) * (1.0 - smoothstep(0.988, 1.0, bj));
        float grain = vnoise(vec2(pf * 5.0 + pi * 3.1, v * 1.2)) * 0.5 + vnoise(vec2(pf * 21.0 + pi, v * 6.5)) * 0.5;
        float knot = smoothstep(0.84, 0.95, vnoise(vec2(pi * 5.3 + pf * 2.5, v * 1.9)));
        if (abs(n.y) > 0.55) alb *= (0.8 + 0.32 * id) * (0.8 + 0.32 * grain) * mix(0.42, 1.0, seam) * (1.0 - 0.38 * knot);
        else alb *= (0.86 + 0.2 * id) * (0.88 + 0.18 * grain) * mix(0.62, 1.0, seam) * (1.0 - 0.2 * smoothstep(0.9, 0.98, vnoise(vec2(pi * 5.3 + pf * 2.5, v * 1.9))));
        if (n.y > 0.9) alb *= 1.0 + 0.12 * (1.0 - smoothstep(0.4, 1.4, abs(q.x)));
      } else if (m == 41) {
        float t = dot(vW.xz, vec2(n.z, -n.x));
        float brush = vnoise(vec2(t * 2.3 + vW.y * 0.7, vW.y * 6.0)) * 0.6 + vnoise(vec2(t * 9.0, vW.y * 13.0)) * 0.4;
        alb *= 0.9 + 0.12 * brush;
        alb = mix(alb, alb * vec3(0.84, 0.8, 0.72), smoothstep(0.55, 0.85, vnoise(vec2(t, vW.y) * 1.3)) * 0.5);
        alb *= 1.0 - 0.3 * smoothstep(uHC[hi].z - 1.3, uHC[hi].z + 0.8, vW.y);
        alb *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.45, vW.y - Y.z));
      } else if (m == 42) {
        float band = step(0.5, fract(q.y * 2.4));
        vec2 dq = abs(fract(q * 3.2) - 0.5);
        float loz = 1.0 - smoothstep(0.26, 0.3, dq.x + dq.y);
        alb = mix(alb, alb * 0.6, band * 0.55);
        alb = mix(alb, vec3(0.85, 0.78, 0.6), loz * 0.55);
        alb *= 0.86 + 0.14 * vnoise(q * 60.0);
      } else if (m == 43) {
        alb *= 0.72 + 0.4 * (vnoise(vW.xz * 26.0) * 0.6 + vnoise(vW.xz * 61.0) * 0.4);
      } else if (m == 44) {
        alb *= 0.8 + 0.3 * (vnoise(vW.xz * 2.1) * 0.6 + vnoise(vW.xz * 8.3) * 0.4);
        vec2 rd = vec2(dot(vW.xz, vec2(0.8, 0.6)), dot(vW.xz, vec2(-0.6, 0.8)));
        float rush = smoothstep(0.86, 0.97, vnoise(vec2(rd.x * 34.0, rd.y * 2.2))) + smoothstep(0.88, 0.98, vnoise(vec2(rd.y * 30.0 + 5.0, rd.x * 1.8)));
        alb = mix(alb, vec3(0.62, 0.54, 0.32), clamp(rush, 0.0, 1.0) * 0.75);
      }
      return alb;
    }
    // fire: charring creeps down from the eaves, the roof burns behind a glowing front, embers glow in the ruin
    vec3 hGlow = vec3(0.0);
    void houseFire(inout vec3 alb, int hi, int kind, int m){
      vec4 A = uHA[hi], B = uHB[hi], C = uHC[hi];
      bool ruin = A.y > 1.5 && A.y < 2.5 && uHD[hi].w < 1.5; // [siege2] a house brought down by stones is rubble, not soot (04j_batter.js)
      if (kind == 5 && uHD[hi].w > 1.5) { alb = alb * 3.0 + vec3(0.1, 0.07, 0.04); return; } // [siege2] its fallen timbers and stones as they were
      if (A.x < 0.001 && !ruin && kind != 5) return;
      float nz = vnoise(vW.xz * 1.9 + vW.y * 2.3) * 0.6 + vnoise(vW.xz * 5.3 - vW.y * 4.1 + 7.0) * 0.4;
      // charred wood splits into a crazing of thin cracks that glow while it is hot
      float crack = smoothstep(0.86, 0.97, 1.0 - abs(vnoise(vW.xz * 5.0 + vW.y * 3.3) * 2.0 - 1.0));
      bool stone = m == 0 || m == 9 || m == 15 || m == 16;
      bool wood = m == 1 || m == 3 || m == 4 || m == 5 || m == 10 || m == 13 || m == 40;
      float burnt = 0.0, glow = 0.0;
      if (kind == 5) {
        burnt = 1.0;
        glow = (crack * 1.4 + smoothstep(0.62, 0.84, nz) * 0.5) * A.w;
      } else if (kind != 6) {
        float fromTop = (C.z - vW.y) / 3.2;
        burnt = smoothstep(0.0, 0.35, A.x * 1.7 - fromTop * 1.1 + (wood ? 0.25 : 0.0) + (nz - 0.5) * 0.35);
        if (kind == 1 && B.w > 0.5) {
          float d = distance(vW.xz, B.xy) + (nz - 0.5) * 1.3;
          float behind = 1.0 - smoothstep(B.z - 0.7, B.z + 0.25, d);
          burnt = max(burnt, behind);
          float flick = 0.65 + 0.35 * sin(uTime * 9.0 + vW.x * 3.1 + vW.z * 2.3);
          glow = exp(-pow((d - B.z) * 1.5, 2.0)) * flick * 1.4 + behind * crack * (0.7 + 0.3 * sin(uTime * 3.0 + vW.x * 2.0 + vW.z));
        }
        if (ruin) {
          // a burnt-out shell: timber black and glowing in its cracks, plaster sooted in streaks from the top, stone blackened
          float streak = vnoise(vec2((vW.x + vW.z) * 3.0, vW.y * 0.35));
          float soot = wood ? 0.95 : stone ? 0.55 + 0.25 * streak : 0.5 + 0.3 * (1.0 - clamp(fromTop, 0.0, 1.0)) + 0.25 * streak;
          burnt = max(burnt, soot * (0.85 + 0.15 * nz));
          if (wood) glow = max(glow, crack * A.w * 0.9);
        }
        if (stone) { burnt *= 0.65; glow = 0.0; }
      }
      alb = mix(alb, vec3(0.05, 0.043, 0.037) * (0.75 + 0.5 * nz), clamp(burnt, 0.0, 1.0));
      hGlow = vec3(2.6, 0.72, 0.15) * glow;
    }
    ${LOOK3_CRACK_GLSL} // [look3] (04d_look3.js)
    ${LOOK3_CRAZE_GLSL}
    // [siege2] battered by stones (04j_batter.js): long jagged cracks over the walls that branch as it weakens, grit and
    // dust ground into it; round the hole in the roof the broken ends of the covering and its timbers
    void houseBatter(inout vec3 alb, int hi, int kind, int m){
      vec4 D = uHD[hi];
      float k = D.w > 1.5 ? 1.0 : D.w;
      if (k < 0.002 || kind == 3 || kind == 4 || kind == 6) return;
      if (kind != 1 && kind != 7) {
        // [look3] stone cracks along its joints (look3Crack), plaster, daub and timber in jagged runs that meet at angles
        // (look3Craze, 04d_look3.js), on the upright faces: they were the iso-lines of a smooth noise, dark vines
        vec3 hn = safeNormalize(vN);
        vec2 huv = planarUV(vW, hn);
        float cr = (m == 0 || m == 9 ? look3Crack(huv, k).x : look3Craze(huv, k)) * (1.0 - smoothstep(0.55, 0.8, abs(hn.y)));
        alb *= 1.0 - 0.78 * cr;
        alb = mix(alb, alb * vec3(0.8, 0.76, 0.7), smoothstep(0.15, 1.0, k) * 0.45 * vnoise(vW.xz * 0.7 + vW.y * 0.5));
        // plaster and daub knocked off in patches, the laths and wattle under them showing; stone faces chipped dark
        // [look3] smaller patches with broken, jagged edges (a finer noise in the threshold), the step down to the laths
        // shaded just inside the edge and the broken plaster round it pale: they were big soft blots, like stains
        float spn = vnoise(vW.xz * 1.5 + vec2(vW.y * 1.9, -vW.y * 1.1) + 3.7) * 0.78 + vnoise(vW.xz * 7.3 + vec2(vW.y * 6.1, vW.y * 2.3)) * 0.22;
        float spT = 0.735 - 0.11 * k, spOn = step(0.12, k) * step(abs(vN.y), 0.6);
        float sp = smoothstep(spT, spT + 0.008, spn) * spOn, spLip = smoothstep(spT - 0.03, spT, spn) * (1.0 - sp) * spOn, spIn = sp * (1.0 - smoothstep(spT + 0.008, spT + 0.04, spn));
        if (m == 2) { alb = mix(alb, vec3(0.34, 0.26, 0.17) * (0.7 + 0.55 * vnoise(vec2(dot(vW.xz, vec2(0.7, 0.7)) * 9.0, vW.y * 30.0))), sp); alb *= (1.0 - 0.45 * spIn) * (1.0 + 0.22 * spLip); }
        else alb *= 1.0 - 0.5 * sp;
      }
      if ((kind == 1 || kind == 7) && D.z > 0.01) { float d = distance(vW.xz, D.xy) - D.z; alb *= 0.35 + 0.65 * smoothstep(0.05, 0.55, d); }
    }
    ${a}
    int hHi = -1, hKind = 0; float hIn = 0.0;
    if (vHP.x > -0.5) {
      hHi = int(vHP.x + 0.5); hKind = int(vHP.y + 0.5);
      // nothing of a house may fill the lens: whatever the camera is about to touch fades out
      if (bayer4(gl_FragCoord.xy) < 1.0 - smoothstep(0.12, 0.4, distance(vW, cameraPosition))) discard;
      hIn = ((hKind == 2 || hKind == 3 || hKind == 7) && uHA[hHi].y < 1.5) ? 1.0 : 0.0;
      // [siege2] a hole a stone knocked in the roof: the covering gone round it, ragged (04j_batter.js)
      if ((hKind == 1 || hKind == 7) && uHD[hHi].z > 0.01 && uHA[hHi].y < 1.5 && distance(vW.xz, uHD[hHi].xy) < uHD[hHi].z * (0.82 + 0.36 * vnoise(vW.xz * 3.1 + float(hHi) * 1.7))) discard;
    }
    hWet = houseWetU() * (1.0 - hIn); hSnow = houseSnowU() * (1.0 - hIn);
    if (hHi >= 0 && hIn > 0.5 && uHD[hHi].z > 0.01) { float hu = 1.0 - smoothstep(uHD[hHi].z * 0.8, uHD[hHi].z + 0.7, distance(vW.xz, uHD[hHi].xy)); hWet = max(hWet, houseWetU() * hu); hSnow = max(hSnow, houseSnowU() * hu * step(0.5, vN.y)); } // [siege2] the rain falls in through it
  `);
  fs = houseShaderPatch(fs, 'alb *= 1.0 - 0.22 * uWet;', (x) => 'if (hHi >= 0 && m >= 40) alb = houseAlbedo(m, n, hHi, alb);\n    ' + x);
  fs = houseShaderPatch(fs, 'vec3 col = lightSurface(alb, n, vAO);', () => /* glsl */`
    if (hHi >= 0) houseFire(alb, hHi, hKind, m);
    if (hHi >= 0) houseBatter(alb, hHi, hKind, m); // [siege2] (04j_batter.js)
    vec3 col = hIn > 0.5 ? houseIndoor(alb, n, vAO, hHi) : lightSurface(alb, n, vAO);
    col += hGlow;
  `);
  return fs;
})();
function houseTownUniforms() {
  const v = (n) => ({ value: Array.from({ length: n }, () => new THREE.Vector4()) });
  return { uHA: v(HOUSE_MAXH), uHB: v(HOUSE_MAXH), uHL: v(HOUSE_MAXH), uHM: v(HOUSE_MAXH), uHC: v(HOUSE_MAXH), uHY: v(HOUSE_MAXH), uHD: v(HOUSE_MAXH), uLeaf: v(HOUSE_MAXLEAF / 4) }; // [siege2] uHD (04j_batter.js)
}
const houseMat = mat({ vertexShader: HOUSE_VS, fragmentShader: HOUSE_FS, uniforms: { uFlash: buildingMat.uniforms.uFlash, ...houseTownUniforms() } });
// window glass: thin and old, a little uneven; it mirrors the sky and glints in the sun, and glows with the fire at night
const houseGlassMat = mat({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uHA: houseMat.uniforms.uHA, uHL: houseMat.uniforms.uHL },
  vertexShader: /* glsl */`
    uniform vec4 uHA[${HOUSE_MAXH}];
    attribute vec2 aPart;
    varying vec3 vW; varying vec3 vN; varying float vHi;
    void main(){
      vHi = aPart.x;
      int hi = int(aPart.x + 0.5);
      if (uHA[hi].y > 1.5) { vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz; vN = mat3(modelMatrix) * normal;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform vec4 uHL[${HOUSE_MAXH}];
    varying vec3 vW; varying vec3 vN; varying float vHi;
    void main(){
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      float facing = dot(n, V);
      if (facing < 0.0) n = -n;
      float fres = 0.04 + 0.96 * spow(1.0 - abs(facing), 5.0);
      float wob = vnoise(vW.xy * 11.0 + vW.zy * 9.0) - 0.5;
      vec3 R = reflect(-V, safeNormalize(n + vec3(wob * 0.07, wob * 0.05, -wob * 0.07)));
      vec3 sky = skyBase(safeNormalize(vec3(R.x, max(R.y, 0.03), R.z)));
      vec3 Hh = safeNormalize(uLightDir + V);
      vec3 col = sky * (0.3 + 0.9 * fres) + uLightColor * spow(max(dot(n, Hh), 0.0), 160.0) * 2.4;
      col = mix(col, vec3(0.55, 0.68, 0.6) * (uAmbient + uLightColor * 0.3), 0.2);
      int hi = int(vHi + 0.5);
      col += vec3(1.0, 0.55, 0.22) * uHL[hi].w * 0.35 * uNight;
      float a = clamp(0.1 + 0.8 * fres + abs(wob) * 0.07, 0.0, 0.92);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), a);
    }`,
});

/* the meshes for one town: called from townModel */
const HOUSE_DEPTHS = [];
function buildHouses(S, st, R) {
  const recs = S.houses.map((h) => h.rec).filter(Boolean);
  if (!recs.length) return;
  const TU = houseTownUniforms();
  const ext = new HouseBatch(), furn = new HouseBatch(), glass = new HouseBatch();
  recs.forEach((H, i) => {
    H.slot = i;
    const M = new THREE.Matrix4().compose(new THREE.Vector3(H.x, H.y, H.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, H.yaw, 0)), new THREE.Vector3(1, 1, 1));
    for (const B of [ext, furn, glass]) { B.hi = i; B.kind = HPART.EXT; B.hinge = null; }
    const ctx = { b: ext, f: furn, g: glass, H, M, st, R, by: H.y };
    houseShell(ctx);
    for (const B of [ext, furn, glass]) { B.kind = HPART.FURN; B.hinge = null; }
    houseRooms(ctx);
    ext.kind = HPART.RUIN; houseRuin(ctx);
    ext.kind = HPART.SCAF; houseScaffold(ctx);
  });
  const mat1 = shareMat(houseMat, TU);
  const mExt = new THREE.Mesh(ext.build(), mat1); mExt.renderOrder = 1; scene.add(mExt);
  const mIn = new THREE.Mesh(furn.build(), mat1); mIn.renderOrder = 1; scene.add(mIn);
  let mGl = null;
  if (glass.n) { mGl = new THREE.Mesh(glass.build(), shareMat(houseGlassMat, { uHA: TU.uHA, uHL: TU.uHL })); mGl.renderOrder = 6; scene.add(mGl); }
  const dm = depthFrom(mat1, HOUSE_DEPTH_FS); // [siege3] the hole a stone knocked in a roof lets the sun in (04j_rafters.js)
  HOUSE_DEPTHS.push(dm);
  shadowCaster(mExt, dm); shadowCaster(mIn, dm);
  S.houseSet = { recs, TU, mExt, mIn, mGl, mat: mat1 };
  for (const H of recs) houseUniformsFor(H);
  initHouses();
}
// the parts of the uniforms that never change: where the house is, its eaves, its hearth and lamp
function houseUniformsFor(H) {
  const T = H.S.houseSet.TU, i = H.slot;
  T.uHC.value[i].set(H.x, H.z, H.y + (H.round ? H.H0 : H.wallH), H.y + H.top - 0.3);
  T.uHY.value[i].set(H.c, H.s, H.y, 0);
  T.uHL.value[i].set(H.hearth.x, H.hearth.wy + 0.4, H.hearth.z, 0);
  T.uHM.value[i].set(H.lamp.x, H.lamp.wy, H.lamp.z, 0);
}
const houseTowns = () => REALMS.flatMap((R) => [R.town, ...R.keepSites]).filter((S) => S.houseSet); // [building] the keeps' great halls too

/* ------------------------------------------------------------------ */
/* fires of a house's own: the hearth, the burning roof, the smoulder  */
/* ------------------------------------------------------------------ */
function houseFireAdd(x, y, z, size, light = null, indoor = false) {
  const n = FIRES.length;
  addFire(x, y, z, size, false, Infinity, light);
  if (FIRES.length === n) return null;
  const f = FIRES[FIRES.length - 1];
  if (indoor) f.indoor = true;
  return f;
}
function houseFireOut(f) {
  if (!f) return;
  f.until = -1;
  const i = FIRES.indexOf(f);
  if (i >= 0) FIRES.splice(i, 1);
}
// a hearth fire burns in every lived-in house; its light reaches people only while someone is in the room
function houseHearthOn(H) {
  if (!H.hearth.fire) H.hearth.fire = houseFireAdd(H.hearth.x, H.hearth.wy, H.hearth.z, H.hearth.size, { r: 4.6, k: 0 }, true);
  if (H.smoke && !CHIMNEYS.includes(H.smoke)) CHIMNEYS.push(H.smoke);
}
function houseHearthOut(H) {
  houseFireOut(H.hearth.fire);
  H.hearth.fire = null;
  const i = CHIMNEYS.indexOf(H.smoke);
  if (i >= 0) CHIMNEYS.splice(i, 1);
}

/* ------------------------------------------------------------------ */
/* doors and shutters                                                  */
/* ------------------------------------------------------------------ */
const houseIntact = (H) => H.state === 'whole' || H.state === 'burning';
const houseDoorOpen = (H) => H.door.leaf.target === 1;
// is anyone standing in the doorway, or where the leaf sweeps as it swings (the quarter circle inside)
function houseDoorBlocked(H, ignore = null) {
  const D = H.door, F = D.F;
  let hit = null;
  forNear(D.c.x, D.c.z, D.w + 2.5, (e) => {
    if (hit || e === ignore || !e.alive || e.kind === 'door' || e.flying) return;
    const l = houseL(H, e.x, e.z);
    const u = (l.x - F.ox) * F.ux + (l.z - F.oz) * F.uz, n = (l.x - F.ox) * F.nx + (l.z - F.oz) * F.nz;
    const r = e.radius * (e.scale || 1) * 0.9;
    if (Math.abs(u) < D.w / 2 + r && n > -H.t - r && n < r) { hit = e; return; }
    const du = (u - D.hingeU) * D.hs, dn = n - D.hingeN;   // du < 0 is the side the leaf swings over
    if (dn < r && du < r && dn > -(D.w + r) && Math.hypot(du, dn) < D.w + r) hit = e;
  });
  return hit;
}
// open or close a house's door; who did it (an entity) or null; quiet skips the sound. Closing waits for a clear doorway.
function setHouseDoor(H, open, who = null, quiet = false) {
  if (!H || !houseIntact(H)) return false;
  const L = H.door.leaf, want = open ? 1 : 0;
  if (L.target === want) return true;
  if (!open && houseDoorBlocked(H)) return false;
  L.target = want;
  houseNote(H, open ? 'door open' : 'door close', who);
  if (!quiet) houseSfx(open ? 'doorOpen' : 'doorClose', H.door.c.x, H.y + 1.2, H.door.c.z);
  return true;
}
// the last few things done to doors and shutters, and by whom (for tests and the curious)
const HOUSE_EVENTS = [];
function houseNote(H, what, who) {
  HOUSE_EVENTS.push({ t: +GAME.t.toFixed(2), house: H.num, what, by: who ? (who.role === 'player' ? 'player' : who.role + ' ' + who.id) : 'nobody' });
  if (HOUSE_EVENTS.length > 80) HOUSE_EVENTS.shift();
}
function setHouseShutters(H, win, open, who = null, quiet = false) {
  if (!H || !houseIntact(H) || !win || !win.leaves.length) return false;
  const want = open ? 1 : 0;
  if (win.target === want) return true;
  win.target = want;
  for (const L of win.leaves) L.target = want;
  if (who) houseNote(H, open ? 'shutters open' : 'shutters close', who);
  if (!quiet) houseSfx(open ? 'shutterOpen' : 'shutterClose', win.c.x, H.y + win.y, win.c.z);
  return true;
}
// what the E key offers near a house: the door, or the shutters of the window in reach
function houseOffers(P, offer) {
  for (const H of HOUSES) {
    if (dist2(P.x, P.z, H.x, H.z) > (H.foot + 3) ** 2 || !houseIntact(H) || H.state === 'burning') continue;
    const D = H.door;
    offer(dist(P.x, P.z, D.c.x, D.c.z), 2.1, H.keepHall ? keepHallDoorLabel(H, P) : houseDoorOpen(H) ? 'Close the door' : 'Open the door', () => { // [building] a keep hall says what is inside
      if (!setHouseDoor(H, !houseDoorOpen(H), P)) uiError('Someone is in the way');
      else setAct(P, 5, 0.55);
    }, 0.05);
    for (const win of H.wins) {
      if (!win.leaves.length) continue;
      offer(dist(P.x, P.z, win.c.x, win.c.z), 1.55, win.target ? 'Close the shutters' : 'Open the shutters', () => { setHouseShutters(H, win, !win.target, P); setAct(P, 5, 0.55); });
    }
  }
}

/* ------------------------------------------------------------------ */
/* the hours: shutters open by day, closed at night and in storms       */
/* ------------------------------------------------------------------ */
const HOUSE_CLOCK = { night: 0, harm: 0 };
const houseWantsShut = () => HOUSE_CLOCK.night > 0.42 || WEATHER.storm > 0.5;
// somebody who lives here is about and will see to the shutters and the door
function houseTended(H) {
  const P = GAME.player;
  for (const id of H.residents) {
    const e = getEnt(id);
    if (e && e.alive && P && dist2(e.x, e.z, P.x, P.z) < 160 * 160) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* every simulation step                                               */
/* ------------------------------------------------------------------ */
function updateHouses(dt) {
  if (!HOUSES.length) return;
  HOUSE_CLOCK.night = todSample('night', tod.p)[0];
  const P = GAME.player;
  for (const S of houseTowns()) {
    for (const L of S.houseLeaves) {
      if (L.open === L.target) continue;
      const s = dt * L.rate;
      L.open = L.target > L.open ? Math.min(L.target, L.open + s) : Math.max(L.target, L.open - s);
      if (L.open === L.target) {
        if (L.kind === 'door' && L.target === 0) houseSfx('doorShut', L.H.door.c.x, L.H.y + 1.2, L.H.door.c.z);
        if (L.kind === 'shutter' && L.target === 1 && L.side < 0) houseSfx('shutterRest', L.win.c.x, L.H.y + L.win.y, L.win.c.z);
      }
    }
  }
  for (const H of HOUSES) {
    const D = H.door, o = D.leaf.open, intact = houseIntact(H);
    D.coll.active = intact && o < 0.35;
    D.collLeaf.active = intact && o > 0.7;
    for (const c of H.furnColl) c.active = intact;
    if (H.scafColl) for (const c of H.scafColl) c.active = H.state === 'scaffold';
    // houses whose people are away (or far from anyone who could see) keep the hours by themselves
    if (H.state === 'whole' && (!P || dist2(P.x, P.z, H.x, H.z) > 45 * 45) && !houseTended(H)) {
      const open = !houseWantsShut();
      for (const win of H.wins) if (win.target !== (open ? 1 : 0)) { setHouseShutters(H, win, open, null, true); for (const L of win.leaves) L.open = L.target; }
      if (D.leaf.target) { D.leaf.target = 0; D.leaf.open = 0; }
    }
    if (H.state === 'burning') houseBurnStep(H, dt);
    else if (H.state === 'ruin') houseRuinStep(H, dt);
    else if (H.state === 'scaffold') houseScaffoldStep(H, dt);
  }
  houseHarm(dt);
}

/* ------------------------------------------------------------------ */
/* fire                                                                */
/* ------------------------------------------------------------------ */
// set a house's roof alight at (x, z) (the nearest point of its roof); false if it cannot burn now
function igniteHouse(H, x, z) {
  if (!H || H.state !== 'whole') return false;
  const pts = H.roofPts;
  if (x === undefined) { const p = pts[Math.floor(Math.random() * pts.length)]; x = p.x; z = p.z; }
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = dist2(p.x, p.z, x, z); if (d < bd) { bd = d; best = p; } }
  let maxR = 0;
  for (const p of pts) maxR = Math.max(maxR, dist(p.x, p.z, best.x, best.z));
  const dur = HOUSE_TIME.spread[0] + Math.random() * (HOUSE_TIME.spread[1] - HOUSE_TIME.spread[0]);
  H.state = 'burning'; H.stT = 0; H.fall = 0; H.char = 0;
  H.burn = { x: best.x, z: best.z, R: 0.4, maxR: maxR + 0.6, dur, speed: (maxR + 0.6) / dur, fallAt: 0, smoulder: [], pts: pts.map((p) => ({ x: p.x, y: p.y, z: p.z, fire: null, t0: 0, max: 0.85 + Math.random() * 0.5 })) };
  houseSfx('ignite', best.x, best.y, best.z);
  const P = GAME.player;
  if (P && dist2(P.x, P.z, H.x, H.z) < 90 * 90) uiLog(H.keepHall ? `The great hall of ${H.S.name} has caught fire!` : `A house in ${H.S.name} has caught fire!`, 'warn'); // [building]
  return true;
}
// a fire spell lands at (x, y, z) with reach r: any house it falls on or beside catches
function fireLandsAt(x, y, z, r = 1, by = null) {
  const own = depthSparesGround(x, z, by); // [depth] by: who cast it; the garrison's own fire never lights its own town or keep (09u_depth.js)
  if (!own) natureFireAt(x, y, z, r); // nature (05h_nature.js): grass and trees catch too
  if (!own) depthFireAt(x, y, z, r); // [depth] berry bushes and apple trees catch (09u_depth.js)
  siegeFireAt(x, y, z, r); // [siege] siege engines catch (04h_siege.js)
  boatFireAt(x, y, z, r, by); // [water2] boats catch (07e_boats.js)
  let n = depthSparesBuilt(by) ? 0 : buildFireAt(x, y, z, r); // [building] placed structures catch (06k_build.js); [depth] not from your own side's spells
  n += towerFireAt(x, y, z, r, by); // [keeps] the timber towers of the burhs catch (04n_towerfire.js)
  n += palisadeFireAt(x, y, z, r, by); // [siege2] and the burhs' palisades (04g_burn.js)
  n += deckFireAt(x, y, z, r, by); // [siege3] and their wall walks and gates of planks (04g_blaze.js)
  for (const H of HOUSES) {
    if (H.state !== 'whole') continue;
    if (dist2(x, z, H.x, H.z) > (H.foot + r + 2) ** 2) continue;
    if (y > H.y + H.top + 1.5) continue;
    if (by != null && depthSparesHouse(H, by)) continue; // [depth] only the player sets their own realm's roofs alight
    const l = houseL(H, x, z), pad = Math.max(0.9, r * 0.6);
    const hit = H.round ? Math.hypot(l.x, l.z) < H.Rr + pad : Math.abs(l.x) < H.w / 2 + H.ohSide + pad && Math.abs(l.z) < H.d / 2 + H.ohGable + pad;
    if (hit && igniteHouse(H, x, z)) n++;
  }
  return n;
}
// a cone of fire (a dragon's breath) from (x, z) along (dx, dz)
function fireConeAt(x, z, dx, dz, range, half) {
  natureFireCone(x, z, dx, dz, range, half); // nature (05h_nature.js): the breath sets the grass and trees alight
  depthFireCone(x, z, dx, dz, range, half); // [depth] and the bushes and apple trees (09u_depth.js)
  siegeFireCone(x, z, dx, dz, range, half); // [siege] and siege engines (04h_siege.js)
  boatFireCone(x, z, dx, dz, range, half); // [water2] and boats (07e_boats.js)
  let n = buildFireCone(x, z, dx, dz, range, half); // [building] and placed structures (06k_build.js)
  n += towerFireCone(x, z, dx, dz, range, half); // [keeps] and the timber towers (04n_towerfire.js)
  n += palisadeFireCone(x, z, dx, dz, range, half); // [siege2] and the burhs' palisades (04g_burn.js)
  n += deckFireCone(x, z, dx, dz, range, half); // [siege3] and their wall walks and gates (04g_blaze.js)
  for (const H of HOUSES) {
    if (H.state !== 'whole' || dist2(x, z, H.x, H.z) > (range + H.foot) ** 2) continue;
    for (const p of H.roofPts) {
      const ox = p.x - x, oz = p.z - z, d = Math.hypot(ox, oz);
      if (d > range || (d > 1.2 && (ox * dx + oz * dz) / d < Math.cos(half))) continue;
      if (igniteHouse(H, p.x, p.z)) n++;
      break;
    }
  }
  return n;
}
function houseBurnStep(H, dt) {
  const B = H.burn;
  H.stT += dt;
  // rain slows the fire but does not put it out
  const damp = 1 / (1 + 0.7 * clamp(WEATHER.raining, 0, 1));
  B.R = Math.min(B.maxR, B.R + B.speed * dt * damp);
  if (houseCrewDouse(H, B, dt)) return; // [war2] its people beat the front back, and a fire beaten to nothing is out (08j_war2.js)
  for (const p of B.pts) {
    if (!p.fire && dist(p.x, p.z, B.x, B.z) <= B.R) { p.fire = houseFireAdd(p.x, p.y, p.z, 0.3); p.t0 = H.stT; }
    if (p.fire) p.fire.size = Math.min(p.max, 0.3 + (H.stT - p.t0) * 0.12) * (1 - 0.3 * H.fall);
  }
  H.char = clamp((H.stT - 2) / (B.dur + 3), 0, 1);
  if (B.R >= B.maxR && !B.fallAt) B.fallAt = H.stT + 4.5;
  if (B.fallAt && H.stT >= B.fallAt) {
    if (H.fall === 0) houseSfx('groan', H.x, H.y + H.wallH, H.z);
    H.fall = Math.min(1, H.fall + dt / HOUSE_TIME.fall);
    if (H.fall >= 1) houseCollapse(H);
  }
}
// the roof falls in: the fires drop into the shell and smoulder, the hearth goes out
function houseCollapse(H) {
  const B = H.burn;
  for (const p of B.pts) if (p.fire) { houseFireOut(p.fire); p.fire = null; }
  H.state = 'ruin'; H.stT = 0; H.fall = 0; H.char = 1; H.ember = 1;
  houseHearthOut(H);
  for (const L of houseLeavesOf(H)) { L.open = 0; L.target = 0; }
  for (const win of H.wins) win.target = 0;
  B.smoulder = [];
  const n = H.big ? 7 : 5, rnd = Math.random;
  for (let k = 0; k < n; k++) {
    let lx, lz;
    if (H.round) { const a = rnd() * TAU, rr = Math.sqrt(rnd()) * H.ri * 0.75; lx = Math.sin(a) * rr; lz = Math.cos(a) * rr; }
    else { lx = (rnd() * 2 - 1) * H.iw * 0.75; lz = (rnd() * 2 - 1) * H.id * 0.75; }
    const w = houseW(H, lx, lz), s0 = 0.6 + rnd() * 0.45;
    B.smoulder.push({ f: houseFireAdd(w.x, H.y + 0.12, w.z, s0), s0 });
  }
  const cy = H.y + H.wallH * 0.7;
  if (dist2(H.x, H.z, camera.position.x, camera.position.z) < 120 * 120) {
    FX.burst(H.x, cy + 1, H.z, 90, [2.6, 1.1, 0.35], 7, 1.1, 0.16, 3, 1.6);
    for (let k = 0; k < 34; k++) {
      const a = rnd() * TAU, rr = rnd() * (H.round ? H.r : H.w / 2);
      const g = 0.1 + rnd() * 0.08;
      fxAlpha.emit(H.x + Math.cos(a) * rr, cy, H.z + Math.sin(a) * rr, Math.cos(a) * 1.5, 1.5 + rnd() * 2.5, Math.sin(a) * 1.5, 3.5 + rnd() * 2.5, g, g * 0.92, g * 0.85, -(1.6 + rnd() * 1.6), -0.3, 0.6);
    }
    FX.dust(H.x, H.y, H.z, 30, [0.3, 0.27, 0.24]);
    lightFlash(H.x, cy, H.z, 18, [3.0, 1.4, 0.4], 0.8);
    cameraShake(0.32, H.x, H.z);
  }
  houseSfx('collapse', H.x, cy, H.z);
}
function houseRuinStep(H, dt) {
  H.stT += dt;
  H.ember = clamp(1 - H.stT / 60, 0, 1);
  for (const s of H.burn.smoulder) {
    if (!s.f) continue;
    s.f.size = s.s0 * clamp(1 - H.stT / HOUSE_TIME.smoulder, 0, 1);
    if (s.f.size < 0.1) { houseFireOut(s.f); s.f = null; }
  }
  if (H.stT >= HOUSE_TIME.ruin) {
    for (const s of H.burn.smoulder) { houseFireOut(s.f); s.f = null; }
    H.state = 'scaffold'; H.stT = 0; H.ember = 0;
  }
}
function houseScaffoldStep(H, dt) {
  H.stT += dt;
  // the charred walls are cleaned and made good as the work goes on
  H.char = (H.bat && H.bat.fell ? 0.1 : 1) * (1 - smooth(clamp(H.stT / (HOUSE_TIME.scaffold * 0.8), 0, 1))); // [siege2] a house brought down by stones was never burnt (04j_batter.js)
  if (H.stT >= HOUSE_TIME.scaffold) houseRestore(H);
}
// whole again: a new roof, the door hung, the hearth lit
function houseRestore(H) {
  if (H.burn) { for (const p of H.burn.pts) houseFireOut(p.fire); for (const s of H.burn.smoulder) houseFireOut(s.f); }
  H.state = 'whole'; H.stT = 0; H.char = 0; H.ember = 0; H.fall = 0; H.burn = null;
  H.bat = null; // [siege2] built back sound: no cracks, no hole (04j_batter.js)
  for (const L of houseLeavesOf(H)) { L.open = 0; L.target = 0; }
  for (const win of H.wins) win.target = 0;
  houseHearthOn(H);
}
const houseLeavesOf = (H) => [H.door.leaf, ...H.wins.flatMap((w) => w.leaves)];
// standing in a burning house hurts
function houseHarm(dt) {
  HOUSE_CLOCK.harm -= dt;
  if (HOUSE_CLOCK.harm > 0) return;
  HOUSE_CLOCK.harm = 0.5;
  for (const H of HOUSES) {
    if (H.state !== 'burning' || H.char < 0.25) continue;
    forNear(H.x, H.z, H.foot, (e) => {
      if (!e.alive || e.kind === 'door' || e.flying || !houseHas(H, e.x, e.z, -0.25)) return;
      addBuff(e, 'burn', e.maxHp * 0.025, 1.2, null);
    });
  }
}
const houseBurning = (H) => H.state === 'burning';
function houseBurningNear(x, z, r) {
  let best = null, bd = r * r;
  for (const H of HOUSES) { if (!houseBurning(H)) continue; const d = dist2(x, z, H.x, H.z); if (d < bd) { bd = d; best = H; } }
  return best;
}

/* ------------------------------------------------------------------ */
/* the camera stays in the space the player is in                      */
/* ------------------------------------------------------------------ */
// solid for the camera: walls, the roof's thickness, and a house's inside when seen from out (and the reverse);
// the doorway joins the two
function houseSolid(H, x, y, z) {
  const ly = y - H.y;
  if (ly > H.top + 0.4 || ly < -0.5) return false;
  const l = houseL(H, x, z), m = 0.28, roofOn = houseIntact(H);
  const D = H.door;
  if (H.round) {
    const rad = Math.hypot(l.x, l.z);
    if (rad > (roofOn ? H.Rr : H.r) + m) return false;
    const inside = rad < H.ri - m;
    if (roofOn) {
      const top = H.roofAt(rad) + 0.3;
      if (ly > top) return false;
      if (inside && ly < H.ceilAt(rad) - 0.25) return false;
      if (rad > H.r + m && ly < H.roofAt(rad) - 0.55) return false;
    } else {
      if (ly > H.wallH + 0.3) return false;
      if (inside || rad > H.r + m) return false;
    }
    if (l.z > 0 && Math.abs(l.x) < D.w / 2 - 0.1 && ly < D.h - 0.15 && rad > H.ri - m - 0.4) return false;
    return true;
  }
  const ax = Math.abs(l.x), az = Math.abs(l.z);
  const ox = roofOn ? H.w / 2 + H.ohSide : H.w / 2, oz = roofOn ? H.d / 2 + H.ohGable : H.d / 2;
  if (ax > ox + m || az > oz + m) return false;
  const inside = ax < H.iw - m && az < H.id - m;
  if (roofOn) {
    const top = H.wallH + H.rh - ax * H.tn + 0.3;
    if (ly > top) return false;
    if (inside && ly < H.ceilLocal(l.x) - 0.2) return false;
    const outside = ax > H.w / 2 + m || az > H.d / 2 + m;
    if (outside && ly < top - 0.3 - H.roofTh / H.cs - 0.3) return false;
  } else {
    if (ly > H.wallH + 0.3) return false;
    if (inside || ax > H.w / 2 + m || az > H.d / 2 + m) return false;
  }
  if (l.z > 0 && Math.abs(l.x - D.u) < D.w / 2 - 0.1 && ly < D.h - 0.15) return false;
  return true;
}
const HCAM = { d: Infinity };
// pull the camera in along the line from the player's head until it is clear of every house; null if no house is near
function houseCamera(fx, fy, fz, cx, cy, cz, dt = 1 / 60) {
  const dx = cx - fx, dy = cy - fy, dz = cz - fz, L = Math.hypot(dx, dy, dz);
  if (L < 1e-3) return null;
  const near = [];
  for (const H of HOUSES) if (dist2(fx, fz, H.x, H.z) < (L + H.foot + 2) ** 2) near.push(H);
  const bnear = buildCamNear(fx, fz, L); // [building] walls and roofs the player built hold the camera too (06k_build.js)
  if (!near.length && !bnear) { HCAM.d = Infinity; return null; }
  const step = 0.08;
  let t = 0, last = 0;
  // start from where the head is clear (it may be in a doorway)
  for (t = step; t <= L; t += step) {
    const x = fx + dx * t / L, y = fy + dy * t / L, z = fz + dz * t / L;
    if (near.some((H) => houseSolid(H, x, y, z)) || (bnear && buildCamSolid(x, y, z))) break;
    last = t;
  }
  if (t > L) last = L;
  HCAM.d = last < HCAM.d || !isFinite(HCAM.d) ? last : lerp(HCAM.d, last, 1 - Math.exp(-dt * 3));
  const d = Math.min(L, HCAM.d);
  if (d >= L - 1e-3) return null;
  return { x: fx + dx * d / L, y: fy + dy * d / L, z: fz + dz * d / L };
}

/* ------------------------------------------------------------------ */
/* aiming a fire spell at a house when there is no foe to aim at        */
/* ------------------------------------------------------------------ */
const HOUSE_FIRE_SPELLS = { firebolt: 'fire', firearrow: 'firearrow', meteor: 'meteor' };
// the house in front of the camera within the spell's range, and a point on its roof to aim for
function houseFireAim(P, id) {
  const A = ABILITIES[id];
  if (!A || !HOUSE_FIRE_SPELLS[id]) return null;
  let best = null, bs = Infinity;
  for (const H of HOUSES) {
    if (H.state !== 'whole') continue;
    const d = dist(P.x, P.z, H.x, H.z);
    if (d > (A.range || 30) + H.foot * 0.5 || d < 1.5) continue;
    const ang = Math.abs(angDiff(CAM.yaw, Math.atan2(H.x - P.x, H.z - P.z)));
    if (ang > 0.6) continue;
    const s = ang * 10 + d * 0.05;
    if (s < bs) { bs = s; best = H; }
  }
  if (!best) return null;
  let pt = best.roofPts[0], pd = Infinity;
  for (const p of best.roofPts) { const d = dist2(p.x, p.z, P.x, P.z) - (p.y - best.y) * 0.8; if (d < pd) { pd = d; pt = p; } }
  return { H: best, x: pt.x, y: pt.y, z: pt.z };
}
// the player casts a fire spell at a house: a cast that finishes in houseCastFinish, or an instant shot
function castAtHouse(P, id, aim) {
  const A = ABILITIES[id];
  let why = null;
  if (!P.alive) why = 'dead';
  else if (P.carrying != null) why = 'carrying';
  else if (isStunned(P)) why = 'stunned';
  else if (P.casting || (P.motion && P.motion.kind === 'leap')) why = 'busy';
  else if (P.swim) why = 'swimming'; // [water] no casting while swimming
  else if (GAME.prog && A.level > GAME.prog.level) why = 'level';
  else if ((P.cds[id] || 0) > GAME.t || P.gcdUntil > GAME.t) why = 'cooldown';
  else if (P.power < A.cost) why = 'power';
  if (why) return why;
  faceToward(P, aim.x, aim.z);
  if (A.cast > 0) {
    P.casting = { id, t: 0, total: A.cast, targetId: null, gx: aim.x, gz: aim.z, aim };
    sfx('cast');
    return true;
  }
  houseCastFinish(P, A, { aim });
  return true;
}
function houseCastFinish(e, A, c) {
  if (e.power < A.cost) return;
  const aim = c.aim;
  faceToward(e, aim.x, aim.z);
  // a meteor falls on the house itself; bolts and arrows fly to the roof
  if (A.id === 'meteor') { executeAbility(e, A, null, aim.H ? { gx: aim.H.x, gz: aim.H.z } : { gx: aim.x, gz: aim.z }); return; }
  e.power -= A.cost;
  e.cds[A.id] = GAME.t + A.cd;
  if (e.role === 'player') e.gcdUntil = GAME.t + 0.6;
  if (A.anim) setAct(e, A.anim, A.anim === 2 ? 0.55 : 0.5);
  spawnProjectile(e, null, HOUSE_FIRE_SPELLS[A.id], null, { x: aim.x, y: aim.y, z: aim.z, tree: aim.tree || null, grass: !!aim.grass });
  sfx(A.proj === 'firearrow' ? 'bow' : 'fire');
  if (A.proj === 'firearrow') sfx('ignite');
}

/* ------------------------------------------------------------------ */
/* each frame: uniforms, the rooms near the camera, lamps, sound       */
/* ------------------------------------------------------------------ */
function drawHouses(dt) {
  if (!HOUSES.length) return;
  const cx = camera.position.x, cz = camera.position.z, night = U.uNight.value;
  const P = GAME.player;
  const pin = P ? houseInside(P.x, P.z) : null, cin = houseInside(cx, cz);
  for (const S of houseTowns()) {
    const set = S.houseSet, T = set.TU;
    const near = dist2(cx, cz, S.x, S.z) < (S.r + (quality.level === 'low' ? 35 : quality.level === 'medium' ? 55 : 75)) ** 2; // [phones] rooms seen through windows: nearer on low and medium
    set.mIn.visible = near;
    for (const L of S.houseLeaves) T.uLeaf.value[L.i >> 2].setComponent(L.i & 3, smooth(L.open));
    for (const H of set.recs) {
      const i = H.slot, B = H.burn, whole = houseIntact(H);
      T.uHA.value[i].set(H.char, houseStageNum(H), H.fall, H.ember);
      T.uHB.value[i].set(B ? B.x : 0, B ? B.z : 0, B ? B.R : 0, H.state === 'burning' ? 1 : 0);
      houseBatterUniform(H, T.uHD.value[i]); // [siege2] cracks and a hole in the roof (04j_batter.js)
      // a cooking fire by day, banked up at night; a house afire is lit red within
      let fire = whole ? 0.6 + 0.9 * night : 0;
      if (H.state === 'burning') fire += H.char * 2.4;
      T.uHL.value[i].w = fire;
      const lamp = whole ? (H.keepHall ? 0.75 + 0.6 * night : 1.25 * smooth(clamp((night - 0.3) / 0.35, 0, 1))) : 0; // [building] a great hall's torches burn all day
      T.uHM.value[i].w = lamp;
      // the hearth's real light falls on people only while they (or the camera) are in the room
      const f = H.hearth.fire;
      if (f) { const want = pin === H || cin === H ? 0.8 : 0; f.lightK += (want - f.lightK) * (1 - Math.exp(-dt * 5)); if (f.lightK < 0.005) f.lightK = 0; }
      if (near && lamp > 0.02 && dist2(cx, cz, H.x, H.z) < 70 * 70) {
        const fl = lamp * (0.92 + 0.08 * Math.sin(renderTime * 9.1 + H.num * 2.3));
        glowPush(H.lamp.x, H.lamp.wy, H.lamp.z, 1.9 * fl, 1.2 * fl, 0.5 * fl, 0.32);
        glowPush(H.lamp.x, H.lamp.wy, H.lamp.z, 0.5 * fl, 0.3 * fl, 0.12 * fl, 1.3);
        if (H.candles) for (const c of H.candles) { const k = lamp * (0.85 + 0.15 * Math.sin(renderTime * 13 + c.x * 7)); glowPush(c.x, c.y, c.z, 1.8 * k, 1.1 * k, 0.45 * k, 0.07); glowPush(c.x, c.y, c.z, 0.35 * k, 0.2 * k, 0.07 * k, 0.45); }
      }
    }
  }
  houseSmoke(dt, cx, cz);
  houseRoofsForRain(cx, cz);
  houseSound(dt);
}
// a burning house sends up a thick column of dark smoke; a ruin smokes thinner as it cools
function houseSmoke(dt, cx, cz) {
  const A = U.uAmbient.value, Lc = U.uLightColor.value, wx = U.uWindDir.value.x * U.uWind.value, wz = U.uWindDir.value.y * U.uWind.value;
  for (const H of HOUSES) {
    const burning = H.state === 'burning', ruin = H.state === 'ruin' && H.stT < 85;
    if ((!burning && !ruin) || dist2(cx, cz, H.x, H.z) > 220 * 220) continue;
    const k = burning ? 0.35 + H.char : (1 - H.stT / 85) * 0.55;
    H.smokeAcc = (H.smokeAcc || 0) + dt * 16 * k;
    while (H.smokeAcc >= 1) {
      H.smokeAcc -= 1;
      let x = H.x, y = H.y + H.wallH, z = H.z;
      const lit = burning ? H.burn.pts.filter((q) => q.fire) : H.burn.smoulder.filter((q) => q.f);
      if (lit.length) { const q = lit[Math.floor(Math.random() * lit.length)]; x = burning ? q.x : q.f.x; y = burning ? q.y + 0.6 : q.f.y + 0.8; z = burning ? q.z : q.f.z; }
      const g = (burning ? 0.32 : 0.55) + Math.random() * 0.15;
      fxAlpha.emit(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, wx * 0.9 + (Math.random() - 0.5) * 0.4, (burning ? 1.8 : 1.0) + Math.random() * 1.2, wz * 0.9 + (Math.random() - 0.5) * 0.4,
        6 + Math.random() * 4, (A.x * 0.7 + Lc.x * 0.2) * g, (A.y * 0.7 + Lc.y * 0.2) * g * 0.97, (A.z * 0.7 + Lc.z * 0.2) * g * 0.94, -(burning ? 2.4 : 1.6) - Math.random() * 1.6, -0.06, 0.12);
    }
  }
}

/* rain and snow do not fall indoors: the precipitation shaders skip drops under the nearest roofs */
U.uRoofA = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }; // centre x, z; cos, sin of the yaw
U.uRoofB = { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0)) }; // half extents (or radius, -1); ground y; top y (below ground: unused)
U.uRoofC = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }; // height of the roof at its outer edge; its slope
U.uRoofD = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }; // [siege2] a hole in it: x, z, radius (04j_batter.js)
const GLSL_ROOFS = /* glsl */`
  uniform vec4 uRoofA[8]; uniform vec4 uRoofB[8]; uniform vec4 uRoofC[8]; uniform vec4 uRoofD[8];
  bool underRoof(vec3 p){
    for (int i = 0; i < 8; i++) {
      vec4 A = uRoofA[i], B = uRoofB[i], C = uRoofC[i];
      if (B.w < B.z || p.y > B.w || p.y < B.z - 1.0) continue;
      if (uRoofD[i].z > 0.0 && distance(p.xz, uRoofD[i].xy) < uRoofD[i].z) continue; // [siege2] the hole a stone knocked in it (04j_batter.js)
      vec2 d = p.xz - A.xy;
      vec2 l = vec2(d.x * A.z - d.y * A.w, d.x * A.w + d.y * A.z);
      float ext, at;
      if (B.y < 0.0) { ext = B.x; at = length(l); if (at > ext) continue; }
      else { if (abs(l.x) > B.x || abs(l.y) > B.y) continue; ext = B.x; at = abs(l.x); }
      if (p.y < min(B.w, C.x + (ext - at) * C.y)) return true;
    }
    return false;
  }`;
const _roofList = [];
function houseRoofsForRain(cx, cz) {
  _roofList.length = 0;
  for (const H of HOUSES) { if (!houseIntact(H)) continue; const d = dist2(cx, cz, H.x, H.z); if (d < 60 * 60) _roofList.push([d, H]); }
  buildRoofsForRain(_roofList, cx, cz); // [building] placed roofs keep the rain out too (06k_build.js)
  towerRoofsForRain(_roofList, cx, cz); // [land] and the rooms of the keeps' towers (04l_towers.js)
  _roofList.sort((a, b) => a[0] - b[0]);
  const A = U.uRoofA.value, B = U.uRoofB.value, C = U.uRoofC.value, D = U.uRoofD.value;
  for (let i = 0; i < 8; i++) {
    const H = _roofList[i] && _roofList[i][1];
    if (!H) { B[i].set(0, 0, 1, 0); D[i].set(0, 0, 0, 0); continue; }
    A[i].set(H.x, H.z, H.c, H.s);
    D[i].set(H.bat ? H.bat.hx : 0, H.bat ? H.bat.hz : 0, H.bat && houseIntact(H) ? H.bat.hr : 0, 0); // [siege2] a hole in its roof lets the rain in (04j_batter.js)
    if (H.round) { B[i].set(H.Rr, -1, H.y, H.y + H.y0 + H.hc); C[i].set(H.y + H.y0, H.hc / H.Rr, 0, 0); }
    else {
      const hw = H.w / 2 + H.ohSide;
      B[i].set(hw, H.d / 2 + H.ohGable, H.y, H.y + H.wallH + H.rh);
      C[i].set(H.y + H.wallH + H.rh - hw * H.tn, H.tn, 0, 0);
    }
  }
}
// is (x, z) under a standing roof (rain does not splash there)
function houseRoofOver(x, z) {
  const H = houseAt(x, z, 0.6);
  return (!!H && houseIntact(H) && !houseHoled(H, x, z)) || buildRoofOver(x, z); // [building] or a roof the player built (06k_build.js); [siege2] not under a hole a stone knocked in it (04j_batter.js)
}

/* ------------------------------------------------------------------ */
/* sound: hinges, latches, a roaring fire, the roof coming down        */
/* ------------------------------------------------------------------ */
const HOUSE_AUDIO = { bed: null, gain: null, crack: 0 };
function houseSfx(kind, x, y, z) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  const vol = Math.pow(clamp(1 - d / (kind === 'collapse' ? 90 : 34), 0, 1), 1.5);
  if (vol < 0.02) return;
  const ctx = AUDIO.ctx, t = ctx.currentTime + 0.005;
  const out = ctx.createGain();
  out.gain.value = vol;
  out.connect(AUDIO.sfxBus);
  // a hinge: the wood sticks and slips, a stutter of little rasps that rises in pitch
  const creak = (t0, n, f0, f1, v) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 2.5; bp.connect(out);
    for (let i = 0; i < n; i++) { const f = f0 + (f1 - f0) * (i / n) + (Math.random() - 0.5) * 20; tone('sawtooth', f, f * 0.97, t0 + i * (0.028 + Math.random() * 0.012), 0.024, v, 0.002, bp); }
  };
  try {
    switch (kind) {
      case 'doorOpen': tone('triangle', 1700, 1500, t, 0.03, 0.05, 0.001, out); noiseBurst(t, 0.04, 0.08, 'bandpass', 2400, 1800, 3, 0.001, out); creak(t + 0.06, 13, 170, 260, 0.03); break;
      case 'doorClose': creak(t, 9, 250, 180, 0.026); break;
      case 'doorShut': tone('sine', 120, 52, t, 0.22, 0.4, 0.002, out); noiseBurst(t, 0.12, 0.2, 'lowpass', 900, 250, 0.8, 0.002, out); tone('triangle', 1500, 1350, t + 0.05, 0.03, 0.04, 0.001, out); break;
      case 'shutterOpen': creak(t, 7, 260, 340, 0.018); break;
      case 'shutterClose': creak(t, 6, 330, 260, 0.018); tone('sine', 260, 120, t + 0.42, 0.08, 0.22, 0.002, out); noiseBurst(t + 0.42, 0.06, 0.12, 'bandpass', 1400, 700, 1.5, 0.002, out); break;
      case 'shutterRest': tone('sine', 220, 110, t, 0.07, 0.16, 0.002, out); noiseBurst(t, 0.05, 0.08, 'bandpass', 1200, 600, 1.5, 0.002, out); break;
      case 'ignite': noiseBurst(t, 0.8, 0.3, 'lowpass', 300, 1800, 0.9, 0.05, out); tone('sine', 110, 60, t, 0.5, 0.12, 0.05, out); break;
      case 'groan': tone('sawtooth', 70, 46, t, 1.4, 0.05, 0.2, out); noiseBurst(t + 0.3, 0.9, 0.12, 'bandpass', 500, 220, 2, 0.1, out); break;
      case 'collapse': noiseBurst(t, 1.6, 0.5, 'lowpass', 1800, 120, 0.8, 0.005, out); tone('sine', 72, 30, t, 1.2, 0.5, 0.01, out); for (let i = 0; i < 6; i++) noiseBurst(t + 0.15 + i * 0.13 + Math.random() * 0.05, 0.12, 0.18, 'bandpass', 900 + Math.random() * 700, 400, 1.5, 0.003, out); break;
      case 'hammer': tone('sine', 330, 160, t, 0.06, 0.25, 0.001, out); noiseBurst(t, 0.04, 0.12, 'bandpass', 2200, 1400, 2, 0.001, out); break;
      default: break;
    }
  } catch (err) { /* sound is optional */ }
}
// a fire's roar and crackle while a house burns near the camera; a soft crackle by a hearth
function houseSound(dt) {
  if (!AUDIO.ctx || !AUDIO.amb || AUDIO.ctx.state !== 'running') return;
  const ctx = AUDIO.ctx, t = ctx.currentTime;
  if (!HOUSE_AUDIO.bed) {
    const src = ctx.createBufferSource();
    src.buffer = AUDIO.noise; src.loop = true; src.playbackRate.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(AUDIO.sfxBus);
    src.start();
    HOUSE_AUDIO.bed = src; HOUSE_AUDIO.gain = g;
  }
  const cx = camera.position.x, cz = camera.position.z;
  let roar = 0;
  for (const H of HOUSES) {
    let k = 0;
    if (H.state === 'burning') k = 0.35 + 1.2 * H.char;
    else if (H.state === 'ruin') k = H.ember * 0.4;
    if (k <= 0) continue;
    roar += k * Math.pow(clamp(1 - dist(cx, cz, H.x, H.z) / 70, 0, 1), 1.5);
  }
  const cin = houseInside(cx, cz);
  const hearth = cin && cin.hearth.fire ? 0.06 * clamp(1 - dist(cx, cz, cin.hearth.x, cin.hearth.z) / 6, 0, 1) : 0;
  HOUSE_AUDIO.gain.gain.setTargetAtTime(Math.min(0.45, roar * 0.3), t, 0.5);
  HOUSE_AUDIO.crack -= dt;
  const k = roar + hearth;
  if (HOUSE_AUDIO.crack <= 0 && k > 0.015) {
    HOUSE_AUDIO.crack = 0.04 + Math.random() * 0.35 / (k * 3 + 0.2);
    try { noiseBurst(t + 0.01, 0.02 + Math.random() * 0.04, Math.min(0.3, 0.05 + 0.25 * k), 'highpass', 1800 + Math.random() * 3500, 1400, 0.7, 0.002); } catch (err) { /* optional */ }
  }
}

/* boot: light the hearths and offer the house functions to tests */
function initHouses() {
  for (const H of HOUSES) if (H.state === 'whole' && H.S.houseSet) houseHearthOn(H);
  if (window.__hm && window.__hm.fn) {
    Object.assign(window.__hm.fn, { houseAt, houseInside, houseHas, igniteHouse, fireLandsAt, fireConeAt, setHouseDoor, setHouseShutters, houseRestore, houseCamera, houseFireAim, castAtHouse, houseRoofOver, houseDoorBlocked, currentInteraction, houseL, houseW, houseRoute, stepTo, isRooted });
    window.__hm.HOUSES = HOUSES;
    window.__hm.HOUSE_EVENTS = HOUSE_EVENTS;
    window.__hm.fn.HOUSES = HOUSES;
  }
}
