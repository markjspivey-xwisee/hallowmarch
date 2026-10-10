/* ================================================================== */
/* castles: raised floors, stairs, wall walks, parapets, gates,        */
/* breaches and their repair                                           */
/* ================================================================== */
// Everything a castle shows works. The wall walks, tower tops, landings and stair treads are floors that bodies
// really stand on (floorAt), reached by stairs from the courtyard; parapets with crenels and arrow slits keep
// people on the walks; gates swing open on their hinges for their own side and shut when enemies come; walls
// crack under siege, fall into a breach you can climb through, and are rebuilt behind scaffolding.

/* ------------------------------------------------------------------ */
/* floors: walkable raised surfaces                                    */
/* ------------------------------------------------------------------ */
// A floor is an oriented box (or a disc) in the world. Its top may slope along its local z (a stair is one ramp
// from its foot to its landing). Solid floors run down to y0; thin ones (timber walks) are th thick and can be
// walked under. floorAt(x, z, y) is the highest surface at or within a step above y, else the ground.
const FLOOR = { list: [], grid: new Map(), cell: 8 };
const FLOOR_STEP = 0.62, FLOOR_BODY = 1.7;
function floorRegister(f, rr) {
  const s = FLOOR.cell;
  for (let cx = Math.floor((f.x - rr) / s); cx <= Math.floor((f.x + rr) / s); cx++) {
    for (let cz = Math.floor((f.z - rr) / s); cz <= Math.floor((f.z + rr) / s); cz++) {
      const k = collKey(cx, cz);
      let l = FLOOR.grid.get(k);
      if (!l) FLOOR.grid.set(k, l = []);
      l.push(f);
    }
  }
  FLOOR.list.push(f);
  return f;
}
function addFloorBox(x, z, hx, hz, yaw, ya, yb, y0, th = 0, tag = 'walk') {
  return floorRegister({ type: 'box', x, z, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), ya, yb, y0, th, tag, active: true }, Math.hypot(hx, hz));
}
function addFloorDisc(x, z, r, y, y0, tag = 'top') {
  return floorRegister({ type: 'disc', x, z, r, ya: y, yb: y, y0, th: 0, tag, active: true }, r);
}
function floorTopOf(f, x, z) {
  const dx = x - f.x, dz = z - f.z;
  if (f.type === 'disc') return dx * dx + dz * dz <= f.r * f.r ? f.ya : null;
  const lx = dx * f.cos - dz * f.sin, lz = dx * f.sin + dz * f.cos;
  if (lx < -f.hx || lx > f.hx || lz < -f.hz || lz > f.hz) return null;
  return f.ya + (f.yb - f.ya) * (lz + f.hz) / (2 * f.hz);
}
function floorAt(x, z, y) {
  let g = heightAt(x, z);
  if (y == null || x > DUN_X0) return g;
  if (SICE.on) { const iy = seasonIceY(x, z); if (iy !== null && iy > g && iy <= y + FLOOR_STEP) g = iy; } // [seasons] a frozen lake carries you (05k_seasons.js)
  const list = FLOOR.grid.get(collKey(Math.floor(x / FLOOR.cell), Math.floor(z / FLOOR.cell)));
  if (!list) return g;
  for (const f of list) {
    if (!f.active) continue;
    const t = floorTopOf(f, x, z);
    if (t !== null && t > g && t <= y + FLOOR_STEP) g = t;
  }
  return g;
}
// is there masonry (or timber) too tall to step onto, and not overhead, at this point?
function floorSolidAt(x, z, y) {
  const list = FLOOR.grid.get(collKey(Math.floor(x / FLOOR.cell), Math.floor(z / FLOOR.cell)));
  if (!list) return false;
  for (const f of list) {
    if (!f.active) continue;
    const t = floorTopOf(f, x, z);
    if (t === null || t <= y + FLOOR_STEP) continue;
    if ((f.th ? t - f.th : f.y0) < y + FLOOR_BODY) return true;
  }
  return false;
}
const elevatedEnt = (e) => e.fixedY !== null || e.y > heightAt(e.x, e.z) + 2.2;
// stepTo asks: may this body move to (x, z)? Not into the side of a stair or a wall top, and the garrison and the
// war never walk off the edge of a wall walk (the player may: they drop)
function castleStepBlocked(e, x, z, y) {
  if (x > DUN_X0 || !FLOOR.list.length) return false;
  const r = e.radius * (e.scale || 1) * 0.65;
  if (floorSolidAt(x, z, y) || floorSolidAt(x + r, z, y) || floorSolidAt(x - r, z, y) || floorSolidAt(x, z + r, y) || floorSolidAt(x, z - r, y)) return true;
  if (e.role !== 'player' && y - floorAt(x, z, y) > 1.1 && y - heightAt(e.x, e.z) > 1.1) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* building helpers in a site's frame                                  */
/* ------------------------------------------------------------------ */
const CASTLES = []; // one per keep and temple: { S, R, kind, routes, posts, gate, sections }
// kept off the sites themselves, so nothing that walks the world's plain data (saves, tests) wades through meshes
const CASTLE_OF = new Map(), CASTLE_KEEP_MESH = new Map();
const castleOf = (S) => CASTLE_OF.get(S) || null;
function castleCtx(S, R, kind) {
  const C = {
    S, R, kind, M: siteMatrix(S), b: new Batch(), st: STYLE[R.style], routes: {}, posts: [], floors: [], colls: [], sections: [], walls: [],
    floor(lx, lz, hx, hz, lyaw, ya, yb = ya, y0 = -1.2, th = 0, tag = 'walk') {
      const p = siteToWorld(S, lx, lz);
      const f = addFloorBox(p.x, p.z, hx, hz, S.yaw + lyaw, S.y + ya, S.y + yb, S.y + y0, th, tag);
      C.floors.push(f);
      return f;
    },
    disc(lx, lz, r, y, tag = 'top') { const p = siteToWorld(S, lx, lz); const f = addFloorDisc(p.x, p.z, r, S.y + y, S.y - 1.2, tag); C.floors.push(f); return f; },
    // a collider that blocks only between y0 and y0 + h (a parapet up on the walk, a post on a tower top)
    coll(lx, lz, hx, hz, lyaw, y0, h, tag = 'parapet') { const c = boxAt(S, lx, lz, hx, hz, tag, h, lyaw); c.vert = true; c.y0 = S.y + y0; C.colls.push(c); return c; },
    post(lx, lz, r, y0, h) { const c = circleAt(S, lx, lz, r, 'parapet', h); c.vert = true; c.y0 = S.y + y0; C.colls.push(c); return c; },
  };
  return C;
}
const ARROW_SLIT = [0.05, 0.05, 0.06];
// a crenellated parapet along the outer edge of a walk: a breastwork with merlons on it, an arrow slit in each merlon
// (x0, z0) -> (x1, z1) is the parapet's centre line; out: which side is outside (+1: the line's local +x)
function castleParapet(C, x0, z0, x1, z1, y, o = {}) {
  const { b, M, st } = C;
  const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
  const th = o.th ?? 0.5, bh = o.bh ?? 1.0, mh = o.mh ?? 0.9, matId = o.mat ?? MAT.stone, col = o.col || st.stone;
  const ox = Math.cos(yaw), oz = -Math.sin(yaw); // the line's local +x in the site frame
  if (o.timber) {
    // a log breastwork with sharpened tops
    b.add(G.box, lm(M, (x0 + x1) / 2, y + bh / 2, (z0 + z1) / 2, yaw, th, bh, len), MAT.logs, st.logs);
    const n = Math.floor(len / 0.5);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; b.add(G.cone8, lm(M, lerp(x0, x1, t), y + bh + 0.22, lerp(z0, z1, t), 0, 0.24, 0.45, 0.24), MAT.wood, st.logs); }
  } else {
    b.add(G.box, lm(M, (x0 + x1) / 2, y + bh / 2, (z0 + z1) / 2, yaw, th, bh, len), matId, col, C.S.y + y, 2);
    // coping along the top of the breastwork
    b.add(G.box, lm(M, (x0 + x1) / 2, y + bh + 0.05, (z0 + z1) / 2, yaw, th + 0.12, 0.1, len), matId, darker(col, 1.08));
    const step = o.step ?? 1.55, n = Math.max(1, Math.floor(len / step));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, cx = lerp(x0, x1, t), cz = lerp(z0, z1, t);
      b.add(G.box, lm(M, cx, y + bh + 0.1 + mh / 2, cz, yaw, th, mh, 0.82), matId, darker(col, 0.95 + 0.1 * hash1(i * 3.3 + x0)));
      if (o.slits !== false) for (const sd of [-1, 1]) b.add(G.box, lm(M, cx + ox * sd * (th / 2 + 0.004), y + bh + 0.1 + mh * 0.5, cz + oz * sd * (th / 2 + 0.004), yaw, 0.012, mh * 0.62, 0.09), MAT.water, ARROW_SLIT);
    }
    // slits through the breastwork between the merlons, for shooting down at the foot of the wall
    if (o.slits !== false) for (let i = 0; i < n; i++) {
      const t = (i + 1) / n; if (i === n - 1) break;
      for (const sd of [-1, 1]) b.add(G.box, lm(M, lerp(x0, x1, t) + ox * sd * (th / 2 + 0.004), y + bh * 0.55, lerp(z0, z1, t) + oz * sd * (th / 2 + 0.004), yaw, 0.012, bh * 0.5, 0.08), MAT.water, ARROW_SLIT);
    }
  }
  if (o.coll !== false) C.coll((x0 + x1) / 2, (z0 + z1) / 2, th / 2 + 0.05, len / 2, yaw, y - 0.1, bh + mh + 0.2);
}
// a straight flight of steps from (x0, z0) at height y0 to (x1, z1) at y1, all in the site frame;
// base: where the masonry under the steps stands; timber: open wooden treads on stringers
function castleFlight(C, x0, z0, y0, x1, z1, y1, w, o = {}) {
  const { b, M, st, S } = C;
  const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round((y1 - y0) / 0.27)), tread = len / n;
  const base = o.base ?? y0;
  const ox = Math.cos(yaw), oz = -Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, top = y0 + (y1 - y0) * (i + 1) / n;
    const cx = lerp(x0, x1, t), cz = lerp(z0, z1, t);
    if (o.timber) {
      b.add(G.box, lm(M, cx, top - 0.05, cz, yaw, w, 0.1, tread + 0.08), MAT.wood, darker(st.wood, 0.9 + 0.2 * hash1(i * 5.7 + x0)));
    } else {
      const bot = base - 0.6;
      b.add(G.box, lm(M, cx, (top + bot) / 2, cz, yaw, w, top - bot, tread + 0.02), MAT.stone, darker(st.stone, 0.76 + 0.14 * hash1(i * 7.1 + x0)), S.y + base, 3);
      // a worn nosing on each tread
      b.add(G.box, lm(M, cx + (x1 - x0) / len * (tread / 2 - 0.04), top + 0.012, cz + (z1 - z0) / len * (tread / 2 - 0.04), yaw, w - 0.04, 0.03, 0.09), MAT.stone, darker(st.stone, 1.12));
    }
  }
  if (o.timber) {
    // stringers under both edges of the treads, and posts to the ground
    const L = Math.hypot(len, y1 - y0), pitch = -Math.atan2(y1 - y0, len);
    for (const sd of [-1, 1]) {
      b.add(G.box, lm(M, (x0 + x1) / 2 + ox * sd * (w / 2 - 0.06), (y0 + y1) / 2 - 0.16, (z0 + z1) / 2 + oz * sd * (w / 2 - 0.06), yaw, 0.12, 0.3, L, pitch), MAT.wood, darker(st.wood, 0.8));
      for (const t of [0.5, 0.95]) b.add(G.box, lm(M, lerp(x0, x1, t) + ox * sd * (w / 2 - 0.06), (lerp(y0, y1, t) - 0.3) / 2, lerp(z0, z1, t) + oz * sd * (w / 2 - 0.06), 0, 0.16, lerp(y0, y1, t) - 0.3, 0.16), MAT.logH, st.logs, S.y, 3);
    }
    // a rail on the open side
    if (o.rail) {
      const sd = o.rail;
      b.add(G.box, lm(M, (x0 + x1) / 2 + ox * sd * (w / 2 - 0.04), (y0 + y1) / 2 + 0.95, (z0 + z1) / 2 + oz * sd * (w / 2 - 0.04), yaw, 0.07, 0.07, L, pitch), MAT.wood, st.wood);
      for (const t of [0.15, 0.5, 0.85]) b.add(G.box, lm(M, lerp(x0, x1, t) + ox * sd * (w / 2 - 0.04), lerp(y0, y1, t) + 0.5, lerp(z0, z1, t) + oz * sd * (w / 2 - 0.04), 0, 0.07, 1.0, 0.07), MAT.wood, st.wood);
      C.coll((x0 + x1) / 2 + ox * sd * (w / 2 - 0.04), (z0 + z1) / 2 + oz * sd * (w / 2 - 0.04), 0.06, len / 2, yaw, y0 + 0.4, (y1 - y0) + 1.0, 'rail');
    }
  }
  // a stepped parapet along the outer side where the flight climbs above the wall's own parapet
  if (o.par) {
    const sd = o.par, m = Math.max(1, Math.ceil(n / 3));
    for (let k = 0; k < m; k++) {
      const ta = k / m, tb = (k + 1) / m, ya = lerp(y0, y1, ta), yb = lerp(y0, y1, tb);
      const cx = lerp(x0, x1, (ta + tb) / 2) + ox * sd * (w / 2 + 0.24), cz = lerp(z0, z1, (ta + tb) / 2) + oz * sd * (w / 2 + 0.24);
      b.add(G.box, lm(M, cx, (base + yb + 1.05) / 2, cz, yaw, 0.48, yb + 1.05 - base, len / m + 0.02), MAT.stone, darker(st.stone, 0.96), S.y + base, 3);
      C.coll(cx, cz, 0.3, len / m / 2, yaw, ya - 0.2, (yb - ya) + 1.2);
    }
  }
  const f = C.floor((x0 + x1) / 2, (z0 + z1) / 2, w / 2, len / 2, yaw, y0, y1, base - 1.2, o.timber ? 0.45 : 0, 'stair');
  f.flight = { x0, z0, y0, x1, z1, y1 };
  return f;
}
// a curved flight around the site centre at radius r, from angle a0 (at y0) to a1 (at y1), in straight pieces
function castleArcFlight(C, r, a0, a1, y0, y1, w, pieces, o = {}) {
  for (let i = 0; i < pieces; i++) {
    const t0 = i / pieces, t1 = (i + 1) / pieces;
    const aa = lerp(a0, a1, t0), ab = lerp(a0, a1, t1);
    castleFlight(C, Math.sin(aa) * r, Math.cos(aa) * r, lerp(y0, y1, t0), Math.sin(ab) * r, Math.cos(ab) * r, lerp(y0, y1, t1), w, o);
  }
}
// a route in site coordinates [lx, lz] -> world points with the height of the floor they stand on
function castleRouteWorld(C, pts) {
  const out = [];
  let y = C.S.y, px = null, pz = null;
  for (const [lx, lz] of pts) {
    const p = siteToWorld(C.S, lx, lz);
    if (px === null) y = floorAt(p.x, p.z, y);
    else {
      const n = Math.max(1, Math.ceil(dist(px, pz, p.x, p.z) / 0.2));
      for (let k = 1; k <= n; k++) y = floorAt(lerp(px, p.x, k / n), lerp(pz, p.z, k / n), y);
    }
    px = p.x; pz = p.z;
    out.push({ x: p.x, z: p.z, y });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Logres: square stone keeps                                          */
/* ------------------------------------------------------------------ */
function castleStone(C) {
  const hs = KEEP_HS, t = KEEP_T, H = WALL_H, { b, M, st, S } = C;
  const wIn = hs - t, wOut = hs - 0.5, wc = (wIn + wOut) / 2; // the walk: from the inner face to the parapet
  const TT = 10.5, TR = 3.4, TC = hs - 1.2; // corner tower tops
  // the tops of the curtain walls are walks
  C.floor(0, -(hs - t / 2), hs, t / 2, 0, H);
  // the side walks come in three pieces: the middle one stands on a stretch of wall that can be breached
  for (const sx of [-1, 1]) {
    for (const [z0, z1] of [[-hs, -11.1], [-11.1, -5.9], [-5.9, hs]]) C.floor(sx * (hs - t / 2), (z0 + z1) / 2, t / 2, (z1 - z0) / 2, 0, H);
    C.sections.push({ lx: sx * (hs - t / 2), lz: -8.5, ax: 0, az: 1, axis: 'z', half: 2.2, across: t / 2 + 0.35, top: H, rubble: 1.1, kind: 'stone' });
  }
  const seg = (hs - GATE_HW) / 2;
  for (const sx of [-1, 1]) C.floor(sx * (GATE_HW + seg), hs - t / 2, seg, t / 2, 0, H);
  // crenellated parapets on the outer edges between the tower stairs (which carry their own stepped parapets)
  const pl = hs - 0.25;
  castleParapet(C, -5.62, -pl, 5.62, -pl, H);
  for (const sx of [-1, 1]) castleParapet(C, sx * pl, -5.62, sx * pl, 5.62, H);
  // the gatehouse over the gate: a raised block that takes the portcullis when it is up
  b.add(G.box, lm(M, 0, H + 1.4, hs - t / 2 + 0.75, 0, 2 * GATE_HW - 0.2, 2.8, 1.2), MAT.stone, darker(st.stone, 0.95), S.y + H, 3);
  castleParapet(C, -2.4, hs + 0.05, 2.4, hs + 0.05, H + 2.8, { coll: false, step: 1.2 });
  // corner towers: open fighting tops with a corbelled ring, crenels, a flagpole; stairs up from both walks
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * TC, z = sz * TC;
    b.add(G.cyl12, lm(M, x, TT - 0.25, z, 0, TR + 0.22, 0.5, TR + 0.22), MAT.stone, darker(st.stone, 0.9));
    b.add(G.cyl12, lm(M, x, TT + 0.02, z, 0, TR - 0.05, 0.06, TR - 0.05), MAT.stone, darker(st.stone, 1.05));
    C.disc(x, z, TR, TT);
    C.post(x, z, 0.16, TT, 4.2);
    // the ring of crenels, open where the two stairs arrive
    const gapA = Math.atan2(-sx, 0), gapB = Math.atan2(0, -sz); // toward the side walls' run and the front/back run
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, am = (a0 + a1) / 2;
      if (Math.abs(angDiff(am, gapA)) < 0.33 || Math.abs(angDiff(am, gapB)) < 0.33) continue;
      const rr = TR + 0.02;
      castleParapet(C, x + Math.sin(a0) * rr, z + Math.cos(a0) * rr, x + Math.sin(a1) * rr, z + Math.cos(a1) * rr, TT, { th: 0.45, bh: 0.95, step: 1.6, slits: i % 2 === 0 });
    }
    // stairs up to the top, one along each adjoining walk, climbing over the walk with a parapet on the outer side
    const end = TC - Math.sqrt(TR * TR - (wc - TC) ** 2) + 0.75;
    const startX = sz === 1 ? 6.95 : 5.6;
    castleFlight(C, sx * startX, sz * wc, H, sx * end, sz * wc, TT, 1.62, { base: H, par: sz * (sx === 1 ? -1 : 1) });
    castleFlight(C, sx * wc, sz * 5.6, H, sx * wc, sz * end, TT, 1.62, { base: H, par: sx * (sz === 1 ? 1 : -1) });
  }
  // two stairs from the courtyard up the inside of the side walls, each with a landing pier at the top
  for (const sx of [-1, 1]) {
    const x = sx * (wIn - 0.8);
    castleFlight(C, x, -6.2, 0, x, 3.4, H, 1.6, { base: 0 });
    b.add(G.box, lm(M, x, (H - 0.6) / 2, 4.05, 0, 1.6, H + 0.6, 1.3), MAT.stone, darker(st.stone, 0.97), S.y, 4);
    C.floor(x, 4.05, 0.86, 0.7, 0, H);
  }
  // posts for the archers: the tops of the two front towers, and the right-hand walk; how they walk up
  const foot = (sx) => [[sx * 10.6, -7.6], [sx * (wIn - 0.8), -6.6], [sx * (wIn - 0.8), 3.4], [sx * (wIn - 0.8), 4.1], [sx * wc, 4.1]];
  C.posts = [
    { pos: [-TC + 0.6, TT, TC + 0.4], route: [...foot(-1), [-wc, 5.6], [-wc, 12.3], [-TC + 0.6, TC + 0.4]] },
    { pos: [TC - 0.6, TT, TC + 0.4], route: [...foot(1), [wc, 5.6], [wc, 12.3], [TC - 0.6, TC + 0.4]] },
    { pos: [wc, H, 0.2], route: [...foot(1), [wc, 0.2]] },
  ];
}

/* ------------------------------------------------------------------ */
/* Ériu: round stone raths                                             */
/* ------------------------------------------------------------------ */
const RATH_R = 16.5, RATH_WALK = 6.7;
function castleRound(C) {
  const { b, M, st, S } = C, R0 = RATH_R, segs = 20, WT = RATH_WALK;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.2) continue;
    const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.5;
    C.floor(Math.sin(am) * R0, Math.cos(am) * R0, len / 2, (KEEP_T + 0.5) / 2 + 0.3, am, WT); // wide enough to cover the curve at the ends
    // stone crenels where there is no timber hoarding (the hoarding is the parapet on the others), and none
    // inside the lookouts, which have their own breastworks
    const pr = R0 + 0.62, look = i === 4 || i === 5 || i === 14 || i === 15;
    let c0 = a0, c1 = a1;
    if (look) { if (i === 4 || i === 14) c1 = a1 - 0.14; else c0 = a0 + 0.14; }
    const ax = Math.sin(c0) * pr, az = Math.cos(c0) * pr, bx = Math.sin(c1) * pr, bz = Math.cos(c1) * pr;
    if (i % 2 === 1 || look) castleParapet(C, ax, az, bx, bz, WT, { th: 0.42, bh: 0.85, mh: 0.75, step: 1.45, mat: MAT.stone, col: st.stone });
    else C.coll((ax + bx) / 2, (az + bz) / 2, len / 2, 0.3, am, WT - 0.1, 1.4); // along the hoarding, at the outer edge
  }
  for (const sx of [-1, 1]) {
    const am = sx * 7.5 / segs * TAU;
    C.sections.push({ lx: Math.sin(am) * R0, lz: Math.cos(am) * R0, ax: Math.cos(am), az: -Math.sin(am), axis: 'x', half: 2.2, across: KEEP_T / 2 + 0.4, top: WT, rubble: 1.0, kind: 'stone' });
  }
  // the side lookouts: the drum rises flush with the walk, which runs on through under a thatched roof on posts
  for (const sx of [-1, 1]) {
    const x = sx * R0;
    b.add(G.cyl12, lm(M, x, (WT - 1.4) / 2, 0, 0, 2.3, WT + 1.4, 2.3), MAT.stone, st.stone, S.y, 5);
    b.add(G.cyl12, lm(M, x, WT - 0.15, 0, 0, 2.5, 0.3, 2.5), MAT.darkstone, st.stone);
    C.disc(x, 0, 2.45, WT);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + TAU / 8, px = x + Math.sin(a) * 2.05, pz = Math.cos(a) * 2.05;
      b.add(G.cyl8, lm(M, px, WT + 1.15, pz, 0, 0.13, 2.3, 0.13), MAT.logH, st.logs);
      C.post(px, pz, 0.18, WT, 2.4);
    }
    // a low breastwork on the outer half, open where the walk comes through
    for (let k = 0; k < 6; k++) {
      const a0 = sx * (Math.PI / 2) - 0.96 + k * 0.32, a1 = a0 + 0.32, rr = 2.3;
      castleParapet(C, x + Math.sin(a0) * rr, Math.cos(a0) * rr, x + Math.sin(a1) * rr, Math.cos(a1) * rr, WT, { th: 0.36, bh: 0.95, mh: 0.0001, slits: false });
    }
    b.add(G.cone12, lm(M, x, WT + 2.3 + 1.4, 0, 0, 2.95, 2.8, 2.95), MAT.thatch, st.thatch);
    b.add(G.cyl12, lm(M, x, WT + 2.32, 0, 0, 2.5, 0.12, 2.5), MAT.wood, st.wood);
  }
  // two curved stairs up the inside of the wall
  for (const sx of [-1, 1]) castleArcFlight(C, 14.5, sx * 0.62, sx * 1.36, 0, WT, 1.7, 6, { base: 0 });
  for (const sx of [-1, 1]) {
    const a = sx * 1.4, x = Math.sin(a) * 14.5, z = Math.cos(a) * 14.5;
    // the landing's local z runs out from the centre toward the wall walk
    b.add(G.box, lm(M, x, (WT - 0.6) / 2, z, a, 1.4, WT + 0.6, 1.7), MAT.stone, darker(st.stone, 0.97), S.y, 4);
    C.floor(x, z, 0.75, 0.92, a, WT);
  }
  const arc = (sx, aFrom, aTo, r) => { const out = [], n = Math.max(1, Math.ceil(Math.abs(aTo - aFrom) / 0.12)); for (let k = 0; k <= n; k++) { const a = sx * lerp(aFrom, aTo, k / n); out.push([Math.sin(a) * r, Math.cos(a) * r]); } return out; };
  const foot = (sx) => [[sx * 7.6, 9.6], ...arc(sx, 0.58, 1.4, 14.5), [Math.sin(sx * 1.4) * 16.2, Math.cos(sx * 1.4) * 16.2]];
  C.posts = [
    { pos: [Math.sin(-0.5) * 16.2, WT, Math.cos(-0.5) * 16.2], route: [...foot(-1), ...arc(-1, 1.4, 0.5, 16.2)] },
    { pos: [Math.sin(0.5) * 16.2, WT, Math.cos(0.5) * 16.2], route: [...foot(1), ...arc(1, 1.4, 0.5, 16.2)] },
    { pos: [16.0, WT, -0.4], route: [...foot(1), ...arc(1, 1.4, 1.6, 16.2), [16.0, -0.4]] },
  ];
}

/* ------------------------------------------------------------------ */
/* Thule: timber burhs                                                 */
/* ------------------------------------------------------------------ */
const BURH_WALK = 5.5;
function castleTimber(C) {
  const hs = KEEP_HS, t = KEEP_T, { b, M, st, S } = C, WT = BURH_WALK;
  const wIn = hs - t / 2 - 0.5 - 1.6, wOut = hs - t / 2 - 0.5, wc = (wIn + wOut) / 2; // 12.8 .. 14.4
  const deck = (cx, cz, hx, hz) => {
    b.add(G.box, lm(M, cx, WT - 0.11, cz, 0, hx * 2, 0.22, hz * 2), MAT.wood, darker(st.wood, 1.05));
    C.floor(cx, cz, hx + 0.06, hz + 0.06, 0, WT, WT, 0, 0.4);
    // joists under the boards and posts down to the ground along the inner edge
    const along = hx > hz, L = along ? hx * 2 : hz * 2, n = Math.max(2, Math.round(L / 2.6));
    for (let i = 0; i <= n; i++) {
      const u = -L / 2 + (L * i) / n;
      const px = along ? cx + u : cx + (cx > 0 ? -hx + 0.12 : hx - 0.12), pz = along ? cz + (cz > 0 ? -hz + 0.12 : hz - 0.12) : cz + u;
      b.add(G.box, lm(M, px, (WT - 0.25) / 2 - 0.3, pz, 0, 0.2, WT - 0.25 + 0.6, 0.2), MAT.logH, st.logs, S.y, 3);
      b.add(G.box, lm(M, along ? cx + u : cx, WT - 0.3, along ? cz : cz + u, 0, along ? 0.16 : hx * 2, 0.18, along ? hz * 2 : 0.16), MAT.wood, darker(st.wood, 0.75));
      C.post(px, pz, 0.14, -0.5, WT - 0.3);
    }
  };
  // side walks between the corner towers, front walks between the gate towers and the corner towers
  for (const sx of [-1, 1]) deck(sx * wc, 0, 0.8, 12.1);
  for (const sx of [-1, 1]) deck(sx * 9.3, wc, 2.8, 0.8);
  // corner decks join the side walks to the front ones in front of the towers
  for (const sx of [-1, 1]) deck(sx * 11.9, 11.75, 0.9, 1.35);
  // loopholes cut through the palisade along the walks
  for (const sx of [-1, 1]) for (let i = -4; i <= 4; i++) {
    for (const sd of [-1, 1]) b.add(G.box, lm(M, sx * (hs - t / 2) + sd * 0.505, WT + 1.05, i * 2.6, 0, 0.012, 0.42, 0.11), MAT.water, ARROW_SLIT);
  }
  for (const sx of [-1, 1]) for (const x of [7.6, 9.6, 11.4]) for (const sd of [-1, 1]) b.add(G.box, lm(M, sx * x, WT + 1.05, hs - t / 2 + sd * 0.505, 0, 0.11, 0.42, 0.012), MAT.water, ARROW_SLIT);
  for (const sx of [-1, 1]) C.sections.push({ lx: sx * (hs - t / 2), lz: -7.5, ax: 0, az: 1, axis: 'z', half: 2.0, across: 0.62, top: WALL_H + 0.9, rubble: 0.7, kind: 'timber' });
  // the stairs: timber flights with a rail on the open side, up the inside of the side walls
  for (const sx of [-1, 1]) {
    castleFlight(C, sx * 12.0, -3.2, 0, sx * 12.0, 4.3, WT, 1.55, { timber: true, base: 0, rail: -sx });
    // a landing at the head of the stair, joined to the walk
    b.add(G.box, lm(M, sx * 12.0, WT - 0.11, 4.75, 0, 1.55, 0.22, 0.9), MAT.wood, darker(st.wood, 1.02));
    b.add(G.box, lm(M, sx * 11.3, (WT - 0.3) / 2, 5.15, 0, 0.2, WT - 0.3, 0.2), MAT.logH, st.logs, S.y, 3);
    C.floor(sx * 12.0, 4.75, 0.8, 0.5, 0, WT, WT, 0, 0.4);
  }
  const foot = (sx) => [[sx * 10.2, -4.6], [sx * 12.0, -3.6], [sx * 12.0, 4.4], [sx * wc, 4.5]];
  C.posts = [
    { pos: [-9.0, WT, wc + 0.1], route: [...foot(-1), [-wc, 10.6], [-11.9, 11.9], [-11.0, wc], [-9.0, wc + 0.1]] },
    { pos: [9.0, WT, wc + 0.1], route: [...foot(1), [wc, 10.6], [11.9, 11.9], [11.0, wc], [9.0, wc + 0.1]] },
    { pos: [wc, WT, 0.5], route: [...foot(1), [wc, 0.5]] },
  ];
}

/* ------------------------------------------------------------------ */
/* temples: a walk on the ring wall, two stairs, a crenellated parapet */
/* ------------------------------------------------------------------ */
function castleTemple(C) {
  const { b, M, st, S, R } = C, R0 = 16, segs = 18, WT = 3.0, timber = R.style === 'timber';
  // the dais is two broad steps of stone that the wardens and pilgrims stand on (they used to sink into it)
  C.disc(0, 0, TEMPLE_DAIS_R[0], TEMPLE_DAIS[0], 'dais');
  C.disc(0, 0, TEMPLE_DAIS_R[1], TEMPLE_DAIS[1], 'dais');
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.2) continue;
    const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.3;
    C.floor(Math.sin(am) * R0, Math.cos(am) * R0, len / 2, 0.7 + 0.3, am, WT); // wide enough to cover the curve at the ends
    const pr = R0 + 0.48;
    castleParapet(C, Math.sin(a0) * pr, Math.cos(a0) * pr, Math.sin(a1) * pr, Math.cos(a1) * pr, WT, timber ? { th: 0.42, bh: 0.95, timber: true } : { th: 0.42, bh: 0.8, mh: 0.65, step: 1.45 });
  }
  for (const sx of [-1, 1]) castleArcFlight(C, 14.55, sx * 1.05, sx * 1.38, 0, WT, 1.25, 2, timber ? { timber: true, base: 0, rail: -sx } : { base: 0 });
  for (const sx of [-1, 1]) {
    const a = sx * 1.415, x = Math.sin(a) * 14.75, z = Math.cos(a) * 14.75;
    if (timber) b.add(G.box, lm(M, x, WT - 0.1, z, a, 1.3, 0.2, 1.2), MAT.wood, st.wood);
    else b.add(G.box, lm(M, x, (WT - 0.6) / 2, z, a, 1.3, WT + 0.6, 1.2), MAT.stone, darker(st.stone, 0.97), S.y, 3);
    C.floor(x, z, 0.68, 0.66, a, WT, WT, timber ? 0 : -1.2, timber ? 0.3 : 0);
  }
}

/* ------------------------------------------------------------------ */
/* gates: hinged leaves, a portcullis, and the wreck of a broken gate  */
/* ------------------------------------------------------------------ */
const GATE_OPEN = 1.45; // radians each leaf swings in (short of square, so a leaf never meets the masonry)
function gateLeafGeo(st, w, h, timber) {
  const b = new Batch(), I = new THREE.Matrix4();
  const wood = darker(st.wood, timber ? 0.92 : 0.82), iron = [0.27, 0.28, 0.3];
  // vertical boards, each a little different, behind a frame of ledges and a brace
  const nb = Math.max(4, Math.round(w / 0.36));
  for (let i = 0; i < nb; i++) {
    const x = (i + 0.5) * (w / nb), bh = timber ? h - 0.12 * hash1(i * 3.1) : h;
    b.add(G.box, lm(I, x, bh / 2, 0, 0, w / nb - 0.012, bh, 0.2), MAT.wood, darker(wood, 0.9 + 0.18 * hash1(i * 7.7 + w)));
    if (timber) b.add(G.cone8, lm(I, x, bh + 0.14, 0, 0, w / nb * 0.48, 0.3, 0.1), MAT.wood, wood);
  }
  for (const y of [0.16, 0.5, 0.84]) {
    b.add(G.box, lm(I, w / 2, h * y, -0.17, 0, w - 0.08, 0.24, 0.14), MAT.wood, darker(wood, 0.78));
    b.add(G.box, lm(I, w / 2 - 0.1, h * y, 0.115, 0, w - 0.25, 0.13, 0.03), MAT.metal, iron);
    // the strap ends in a knuckle round the hinge pin
    b.add(G.cyl8, lm(I, 0.02, h * y, 0, 0, 0.07, 0.2, 0.07), MAT.metal, iron);
  }
  for (let k = 0; k < 2; k++) {
    const ya = h * (k ? 0.5 : 0.16), yb = h * (k ? 0.84 : 0.5), L = Math.hypot(w - 0.3, yb - ya);
    b.add(G.box, lm(I, w / 2, (ya + yb) / 2, -0.17, 0, L, 0.2, 0.12, 0, Math.atan2(yb - ya, w - 0.3)), MAT.wood, darker(wood, 0.74));
  }
  // nail heads in rows along the straps
  for (const y of [0.16, 0.5, 0.84]) for (let i = 1; i < 6; i++) b.add(G.box, lm(I, (i / 6) * w, h * y, 0.135, 0, 0.05, 0.05, 0.03), MAT.metal, [0.2, 0.2, 0.21]);
  b.add(G.cyl8, lm(I, w * 0.82, h * 0.42, 0.14, 0, 0.09, 0.03, 0.09, Math.PI / 2), MAT.metal, iron);
  return b.build();
}
function portcullisGeo(w, h) {
  const b = new Batch(), I = new THREE.Matrix4(), iron = [0.22, 0.22, 0.24];
  const nx = Math.round(w / 0.42);
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx;
    b.add(G.box, lm(I, x, h / 2, 0, 0, 0.09, h, 0.09), MAT.metal, iron);
    b.add(G.cone8, lm(I, x, -0.12, 0, Math.PI, 0.07, 0.26, 0.07, Math.PI), MAT.metal, iron);
  }
  for (let y = 0.35; y < h; y += 0.62) b.add(G.box, lm(I, 0, y, 0.02, 0, w + 0.08, 0.08, 0.11), MAT.metal, iron);
  return b.build();
}
function gateWreckGeo(S, st, hw, h, timber) {
  const b = new Batch(), M = siteMatrix(S), gz = S.gateLocal.z, wood = darker(st.wood, 0.7), r = mulberry(Math.round(Math.abs(S.x * 13 + S.z * 7)));
  // one leaf hangs from its lowest hinge, smashed off above; the other lies broken across the threshold inside
  const nb = Math.round(hw / 0.36);
  for (let i = 0; i < nb; i++) {
    const x = -hw + (i + 0.5) * (hw / nb), bh = h * (0.25 + 0.45 * r());
    b.add(G.box, lm(M, x, bh / 2, gz - 0.2 + (i / nb) * 0.9, 0.55, hw / nb - 0.02, bh, 0.2, 0, 0.08 * (r() - 0.5)), MAT.wood, darker(wood, 0.8 + 0.3 * r()));
  }
  for (let i = 0; i < nb + 2; i++) {
    const x = r() * hw * 1.4 - 0.2, z = gz - 0.6 - r() * 3.2, L = 0.6 + r() * (h * 0.55);
    b.add(G.box, lm(M, x, 0.06 + 0.05 * (i % 3), z, r() * TAU, hw / nb - 0.02, 0.1, L, 0.04 * (r() - 0.5)), MAT.wood, darker(wood, 0.75 + 0.35 * r()));
  }
  // splinters still in the hinges
  for (const sx of [-1, 1]) for (const y of [0.16, 0.5, 0.84]) b.add(G.box, lm(M, sx * (hw - 0.12), h * y, gz, 0, 0.26, 0.16 + 0.1 * r(), 0.18, 0, sx * 0.3), MAT.wood, wood);
  if (timber) for (let i = 0; i < 3; i++) b.add(G.cone8, lm(M, -hw + 0.4 + i * 0.9, 0.12, gz - 1.2 - i * 0.7, r() * TAU, 0.12, 0.6, 0.1, Math.PI / 2), MAT.wood, wood);
  return b.build();
}
function buildCastleGate(C, temple) {
  const { S, R, st } = C;
  const gz = S.gateLocal.z, timber = R.style === 'timber';
  // the opening between the gate towers (or pillars) at the gate line
  const hw = temple ? 2.75 : R.style === 'round' ? 1.33 : R.style === 'stone' ? 2.28 : GATE_HW - 0.02;
  const h = temple ? 3.0 : R.style === 'round' ? 4.55 : timber ? 5.0 : 4.8;
  const geo = gateLeafGeo(st, hw, h, timber);
  const G0 = { C, S, temple, hw, h, gz, swing: R.style === 'round' && !temple ? 1.4 : GATE_OPEN, open: 0, want: 0, leaves: [], port: null, portH: 0, wreck: null, scan: 0, alive: true, flashT: 0, door: null };
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(geo, shareMat(buildingMat, { uFlash: { value: 0 } }));
    const p = siteToWorld(S, sx * hw, gz);
    m.position.set(p.x, S.y, p.z);
    m.scale.x = sx < 0 ? 1 : -1;
    m.rotation.y = S.yaw;
    m.renderOrder = 1;
    scene.add(m);
    shadowCaster(m, BUILDING_DEPTH);
    G0.leaves.push(m);
  }
  if (R.style === 'stone' && !temple) {
    const m = new THREE.Mesh(portcullisGeo(2 * hw + 0.1, h + 0.1), buildingMat);
    const p = siteToWorld(S, 0, gz + 0.62);
    m.position.set(p.x, S.y, p.z);
    m.rotation.y = S.yaw;
    m.renderOrder = 1;
    scene.add(m);
    shadowCaster(m, BUILDING_DEPTH);
    G0.port = m; G0.portH = h - 0.05;
  }
  const wreck = new THREE.Mesh(gateWreckGeo(S, st, hw, h, timber), buildingMat);
  wreck.visible = false;
  wreck.renderOrder = 1;
  scene.add(wreck);
  G0.wreck = wreck;
  S.doorMesh = new THREE.Object3D(); // the old single slab is gone; the war code may still toggle this
  return G0;
}
function setGatePose(G0) {
  const k = smooth(clamp(G0.open, 0, 1)), S = G0.S;
  G0.leaves[0].rotation.y = S.yaw + k * G0.swing;
  G0.leaves[1].rotation.y = S.yaw - k * G0.swing;
  if (G0.port) G0.port.position.y = S.y + smooth(clamp(G0.open * 1.25, 0, 1)) * G0.portH;
}
function updateGate(G0, dt) {
  const D = G0.door || (G0.door = G0.S.keepRef ? G0.S.keepRef.door : G0.S.templeRef ? G0.S.templeRef.door : null);
  if (!D) return;
  const coll = G0.S.door;
  if (!D.alive) {
    if (G0.alive) { G0.alive = false; for (const m of G0.leaves) m.visible = false; G0.wreck.visible = true; G0.open = 1; if (G0.port) G0.port.position.y = G0.S.y + G0.portH; }
    coll.active = false;
    return;
  }
  if (!G0.alive) {
    // rebuilt: the new leaves go up with a flash of fresh timber
    G0.alive = true; G0.open = 0; G0.want = 0; G0.flashT = 1.6;
    for (const m of G0.leaves) m.visible = true;
    G0.wreck.visible = false;
    FX.dust(D.x, D.y + 1, D.z, 16, [0.55, 0.48, 0.38]);
  }
  if (GAME.t > G0.scan) {
    G0.scan = GAME.t + 0.25;
    let friend = false, foe = false;
    const owner = D.faction;
    forNear(D.x, D.z, 19, (o, d2) => {
      if (!o.alive || !isActor(o) || o.faction === FACTION_NEUTRAL || o.role === 'critter') return;
      // archers up on the walls do not need the gate; anyone of another side does shut it
      if (o.faction === owner) { if (d2 < 9.5 * 9.5 && !elevatedEnt(o)) friend = true; } else foe = true;
    });
    G0.want = friend && !foe ? 1 : 0;
  }
  if (G0.sallyUntil > GAME.t && G0.sallyOpen) G0.want = 1; // [siege] the gate opens for a sally, foes or no (04h_siege.js)
  const was = G0.open;
  G0.open = clamp(G0.open + (G0.want ? 1 : -1) * dt / (G0.want ? 1.9 : 1.3), 0, 1);
  if (was !== G0.open) {
    setGatePose(G0);
    const P = GAME.player;
    if (P && dist2(P.x, P.z, D.x, D.z) < 40 * 40 && ((was === 0) || (G0.open === 0 && was > 0))) sfx(G0.port ? 'chain' : 'grind');
  }
  // the gate blocks unless it stands open; while it swings only its own side may squeeze through
  coll.active = G0.open < 0.97 || !G0.want;
  coll.owner = G0.open > 0.35 ? D.faction : -1;
  if (G0.flashT > 0) { G0.flashT = Math.max(0, G0.flashT - dt); for (const m of G0.leaves) m.material.uniforms.uFlash.value = G0.flashT * 0.9; }
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */
function buildCastles() {
  BUILDING_DEPTH = BUILDING_DEPTH || depthFrom(buildingMat);
  for (const R of REALMS) {
    for (const S of [...R.keepSites, R.templeSite]) {
      const temple = S === R.templeSite;
      const C = castleCtx(S, R, temple ? 'temple' : R.style);
      if (temple) castleTemple(C);
      else if (R.style === 'round') castleRound(C);
      else if (R.style === 'timber') castleTimber(C);
      else castleStone(C);
      // the walls themselves can be stood on: they block a body only below their tops
      for (const c of S.colliders) {
        if (c.tag === 'wall') {
          c.vert = true;
          if (R.style === 'timber' && !temple && c.type === 'box') {
            // a palisade is a metre of logs, not the 2.2 m of a stone curtain: the walk behind it stays clear
            c.active = false;
            const n = addBox(c.x, c.z, c.hx < c.hz ? 0.5 : c.hx, c.hx < c.hz ? c.hz : 0.5, c.yaw, 'wall', c.h);
            n.vert = true;
            C.walls.push(n);
          } else C.walls.push(c);
        }
        if (c.tag === 'tower' && R.style === 'stone' && !temple && c.r > 3) { c.vert = true; c.h = 9.6; } // low enough that the last steps of the tower stairs clear it
      }
      const m = new THREE.Mesh(C.b.build(), buildingMat);
      C.b = null; // the vertex lists are in the geometry now
      m.renderOrder = 1;
      scene.add(m);
      SITE_MESHES.push(m);
      shadowCaster(m, BUILDING_DEPTH);
      C.mesh = m;
      castleSections(C);
      C.gate = buildCastleGate(C, temple);
      setGatePose(C.gate);
      CASTLE_OF.set(S, C);
      CASTLES.push(C);
    }
  }
  // the rune circles of the towns and musters are a hand of stone above the ground: people stand on them
  for (const R of REALMS) for (const S of [R.town, R.musterSite]) addFloorDisc(S.x, S.z, 2.6, S.y + 0.25, S.y - 1.2, 'dais');
  // stair treads and the temple dais come down to the ground: no blades grow up through them
  for (const C of CASTLES) for (const f of C.floors) {
    if (Math.min(f.ya, f.yb) - heightAt(f.x, f.z) > 1.2) continue; // walks, landings, tower tops and decks stand clear
    if (f.type === 'disc') clearCoverDisc(f.x, f.z, f.r);
    else clearCoverBox(f.x, f.z, f.hx, f.hz, Math.atan2(f.sin, f.cos));
  }
  refreshGroundCover();
  if (window.__hm) Object.assign(window.__hm.fn, { castleOf, floorAt, floorSolidAt, castleRoute, castleWaypoint, elevatedEnt, setGatePose, fillGarrison, siteWorld, siteToWorld, stepTo, castleSiegeHit, castleBreach, castleRepairDone, updateBreaches, CASTLE_PATCHED });
  // behind a function, so a test that hands __hm back to Playwright does not try to serialise every castle
  if (window.__hm) window.__hm.fn.castles = () => CASTLES;
}
// world route for a keep's wall post (computed when first asked, once the floors exist)
function castleRoute(K, i) {
  const C = castleOf(K.site);
  if (!C || !C.posts[i]) return null;
  const P = C.posts[i];
  if (!P.world) P.world = castleRouteWorld(C, P.route);
  return P.world;
}
function castlePostSlots(K) {
  const C = castleOf(K.site);
  return C ? C.posts.map((p) => p.pos) : null;
}
function updateCastles(dt) {
  for (const C of CASTLES) { if (C.gate) updateGate(C.gate, dt); updateBreaches(C, dt); }
  updateSiege(dt); // [siege] engines, stones, sallies (04h_siege.js)
}

/* ------------------------------------------------------------------ */
/* the garrison on the walls, and those who climb up after them        */
/* ------------------------------------------------------------------ */
// walk a route of waypoints (stairs, landings, walks); true while still on the way
function castleFollow(e, dt, speed = 0.85) {
  const Rt = e.ai.route;
  if (!Rt) return false;
  let i = e.ai.ri || 0;
  while (i < Rt.length && dist(e.x, e.z, Rt[i].x, Rt[i].z) < 0.42 && Math.abs(e.y - Rt[i].y) < 1.2) i++;
  e.ai.ri = i;
  if (i >= Rt.length) { e.ai.route = null; e.ai.ri = 0; return false; }
  const px = e.x, pz = e.z;
  moveToward(e, Rt[i].x, Rt[i].z, dt, speed, 0.05);
  // a body pushed off its line steps back toward the waypoint before
  if (Math.abs(e.x - px) + Math.abs(e.z - pz) < 1e-4) { e.ai.stuck = (e.ai.stuck || 0) + dt; if (e.ai.stuck > 2.5 && i > 0) { e.ai.ri = i - 1; e.ai.stuck = 0; } } else e.ai.stuck = 0;
  return true;
}
function castleAt(x, z) {
  for (const C of CASTLES) if (C.kind !== 'temple' && dist2(x, z, C.S.x, C.S.z) < 21 * 21) return C;
  return null;
}
function castleInside(C, x, z) {
  const dx = x - C.S.x, dz = z - C.S.z, c = Math.cos(C.S.yaw), s = Math.sin(C.S.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return C.kind === 'round' ? lx * lx + lz * lz < 15.2 * 15.2 : Math.abs(lx) < 13.7 && Math.abs(lz) < 13.7;
}
// the next waypoint for e to reach t at another height in the same castle (up or down the stairs), or null
function castleWaypoint(e, t) {
  const C = castleAt(t.x, t.z);
  if (!C || !C.posts.length) return null;
  // heights above the ground, so a foe up a hillside is not mistaken for one up on a wall
  const dy = (t.y - heightAt(t.x, t.z)) - (e.y - heightAt(e.x, e.z));
  const up = dy > 1.1, down = dy < -1.1;
  if (!up && !down) return null;
  if (!elevatedEnt(e) && !castleInside(C, e.x, e.z)) return null;
  const K = C.S.keepRef;
  // the route that ends nearest to whoever is higher up; once on a route, keep to it for a while
  const hi = up ? t : e;
  let best = null, bd = Infinity, bi = 0;
  const keep = e.ai.climb && GAME.t < e.ai.climb.until ? e.ai.climb.ri : -1;
  C.posts.forEach((P, i) => {
    const Rt = castleRoute(K, i), end = Rt[Rt.length - 1];
    let d = Infinity;
    for (const q of Rt) if (Math.abs(q.y - hi.y) < 1.6) d = Math.min(d, dist2(q.x, q.z, hi.x, hi.z));
    d = Math.min(d, dist2(end.x, end.z, hi.x, hi.z) + 4);
    if (i === keep) d = -1;
    if (d < bd) { bd = d; best = Rt; bi = i; }
  });
  if (!best) return null;
  // where e is along it now: the nearest waypoint at about e's height, and never one behind on the way
  const cl = e.ai.climb && e.ai.climb.ri === bi && e.ai.climb.dir === (up ? 1 : -1) ? e.ai.climb : (e.ai.climb = { ri: bi, i: -1, dir: up ? 1 : -1, until: GAME.t + 12 });
  if (cl.i < 0) {
    let k = 0, kd = Infinity;
    best.forEach((q, j) => { const d = dist2(q.x, q.z, e.x, e.z) + (Math.abs(q.y - e.y) > 2.6 ? 900 : 0); if (d < kd) { kd = d; k = j; } });
    cl.i = k;
  }
  const dir = up ? 1 : -1;
  const q = best[cl.i];
  if (q && dist(e.x, e.z, q.x, q.z) < 0.5 && Math.abs(q.y - e.y) < 1.3) cl.i += dir;
  if (cl.i < 0 || cl.i >= best.length) { e.ai.climb = null; return null; }
  return best[cl.i];
}
// melee fighters climb to reach a foe on the walls, or come down after one in the courtyard
function castleClimbToward(e, t, dt) {
  if (e.rangedKind || t.kind === 'door') return false;
  const wp = castleWaypoint(e, t);
  if (!wp) return false;
  moveToward(e, wp.x, wp.z, dt, 1, 0.05);
  return true;
}
function castleCanReach(e, t) {
  if (e.rangedKind || t.kind === 'door') return true;
  const dy = (t.y - heightAt(t.x, t.z)) - (e.y - heightAt(e.x, e.z));
  if (Math.abs(dy) < 2.2) return true;
  const C = castleAt(t.x, t.z);
  return !!(C && C.posts.length && (elevatedEnt(e) || castleInside(C, e.x, e.z)));
}

/* ------------------------------------------------------------------ */
/* breaches: wall sections crack under siege, fall, and are rebuilt    */
/* ------------------------------------------------------------------ */
// A section of curtain wall takes the blows of meteors (castleSiegeHit). Cracks spread across its stones as it
// weakens; at the end it falls into a jagged V down to a mound of rubble that can be climbed through, and the walk
// on top is gone. When the castle has been quiet for a while its owners put up scaffolding and build it back course
// by course, and the new stone stays pale for a time. The cut and the cracks are drawn by the castle shader (the
// building shader with a breach test patched in), the rubble, the broken ends and the scaffold are their own meshes.
const CUT_MAX = 4, BREACH_QUIET = 20, BREACH_REPAIR = 150, BREACH_FRESH = 140;
const CASTLE_PATCHED = [];
function castlePatch(src, anchor, fn) {
  if (!src.includes(anchor)) return src; // the building shader changed: castles lose their cracks, nothing else
  CASTLE_PATCHED.push(anchor);
  return src.replace(anchor, fn(anchor));
}
const CASTLE_CUT_GLSL = /* glsl */`
    uniform vec4 uCA[${CUT_MAX}]; uniform vec4 uCB[${CUT_MAX}]; uniform vec4 uCC[${CUT_MAX}];
    float cWear = 0.0, cFresh = 0.0;
    // inside a section's band and above the line the wall fell to (a ragged V), the stone is gone
    bool castleCut(vec3 p){
      bool cut = false;
      for (int i = 0; i < ${CUT_MAX}; i++) {
        vec4 A = uCA[i], B = uCB[i], Q = uCC[i];
        if (B.x <= 0.0) continue;
        vec2 d = p.xz - A.xy;
        float al = dot(d, A.zw), ac = dot(d, vec2(-A.w, A.z));
        if (abs(ac) > Q.x + 0.6) continue;
        float band = 1.0 - smoothstep(Q.x, Q.x + 0.6, abs(ac));
        cWear = max(cWear, B.z * band * (1.0 - smoothstep(B.x * 0.7, B.x * 2.2, abs(al))));
        cFresh = max(cFresh, Q.y * band * (1.0 - smoothstep(B.x * 0.95, B.x * 1.25, abs(al))) * step(Q.z, p.y));
        if (abs(ac) > Q.x) continue;
        float jag = (vnoise(vec2(al * 2.3 + float(i) * 7.0, p.y * 2.1)) - 0.5) * 0.8;
        float hw = B.x * (0.45 + 0.55 * clamp((p.y - B.y) / 4.5, 0.0, 1.0)) + jag;
        if (abs(al) < hw && p.y > B.y + jag * 0.6) cut = true;
      }
      return cut;
    }
`;
const CASTLE_FS = (() => {
  let fs = buildingMat.fragmentShader;
  fs = castlePatch(fs, 'void main(){', (a) => /* glsl */`
    ${CASTLE_CUT_GLSL}
    ${a}
    if (castleCut(vW)) discard;
  `);
  fs = castlePatch(fs, 'vec3 col = lightSurface(alb, n, vAO);', (a) => /* glsl */`
    if (cWear > 0.002) {
      // cracks: long jagged lines that branch as the wall weakens, dust and scorch from the strikes
      float c1 = 1.0 - smoothstep(0.0, 0.045, abs(vnoise(vW.xz * 0.9 + vec2(vW.y * 1.3, -vW.y * 0.7)) - 0.5) * (0.6 + 1.6 * vnoise(vW.xz * 3.7 - vW.y)));
      float c2 = 1.0 - smoothstep(0.0, 0.03, abs(vnoise(vec2(vW.x + vW.z, vW.y) * 2.6 + 5.0) - 0.5));
      float cr = clamp(c1 * smoothstep(0.1, 0.5, cWear) + c2 * smoothstep(0.4, 0.9, cWear), 0.0, 1.0);
      alb *= 1.0 - 0.82 * cr;
      alb = mix(alb, alb * vec3(0.74, 0.7, 0.66), smoothstep(0.2, 1.0, cWear) * 0.45 * vnoise(vW.xz * 0.7 + vW.y * 0.5));
    }
    if (cFresh > 0.002) alb = mix(alb, alb * vec3(1.18, 1.15, 1.08) + vec3(0.04, 0.035, 0.03), cFresh * 0.85);
    ${a}
  `);
  return fs;
})();
const CASTLE_DEPTH_FS = /* glsl */`
  ${GLSL_COMMON}
  varying vec3 vW;
  ${CASTLE_CUT_GLSL}
  void main(){ if (castleCut(vW)) discard; gl_FragColor = vec4(1.0); }`;
const castleMat = mat({ vertexShader: buildingMat.vertexShader, fragmentShader: CASTLE_FS, uniforms: { uFlash: buildingMat.uniforms.uFlash, uCA: { value: [] }, uCB: { value: [] }, uCC: { value: [] } } });
function castleCutUniforms() {
  const v = () => ({ value: Array.from({ length: CUT_MAX }, () => new THREE.Vector4()) });
  return { uCA: v(), uCB: v(), uCC: v() };
}
// split a box collider along one of its local axes: the ends stay, the middle (returned) can fall
function castleSplitColl(c, axis, u0, u1) {
  c.active = false;
  const ext = axis === 'z' ? c.hz : c.hx;
  const dx = axis === 'z' ? c.sin : c.cos, dz = axis === 'z' ? c.cos : -c.sin;
  const piece = (a, b) => {
    const m = (a + b) / 2, h = (b - a) / 2;
    const n = addBox(c.x + dx * m, c.z + dz * m, axis === 'z' ? c.hx : h, axis === 'z' ? h : c.hz, c.yaw, c.tag, c.h);
    n.vert = c.vert; n.y0 = c.y0; n.baseY = c.baseY;
    return n;
  };
  piece(-ext, u0); piece(u1, ext);
  return piece(u0, u1);
}
function breachGeo(C, W) {
  const b = new Batch(), M = C.M, st = C.st, r = mulberry(Math.round(C.S.x * 7 + C.S.z * 3 + W.k * 101));
  const px = -W.az, pz = W.ax; // across, in the site frame
  const at = (u, v) => [W.lx + W.ax * u + px * v, W.lz + W.az * u + pz * v];
  const timber = W.kind === 'timber';
  // the mound: fallen stones (or logs) piled in the gap and spilling out on both sides
  for (let i = 0; i < 34; i++) {
    const u = (r() - 0.5) * W.half * 1.7, v = (r() - 0.5) * 5.6, h = W.rubble * Math.max(0, 1 - Math.abs(v) / 3.0) * (1 - 0.35 * Math.abs(u) / W.half);
    const [x, z] = at(u, v);
    if (timber) b.add(G.cyl8, lm(M, x, 0.15 + h * 0.6 * r(), z, r() * TAU, 0.17 + 0.06 * r(), 1.6 + 1.6 * r(), 0.17 + 0.06 * r(), Math.PI / 2 + (r() - 0.5) * 0.5), MAT.logH, darker(st.logs, 0.7 + 0.3 * r()), C.S.y, 1.5);
    else { const s = 0.35 + 0.45 * r(); b.add(G.ico, lm(M, x, h * 0.75, z, r() * TAU, s * 1.3, s * 0.8, s, r() * 0.6, r() * 0.6), MAT.stone, darker(st.stone, 0.72 + 0.3 * r()), C.S.y, 1.5); }
  }
  // the broken ends: ragged courses stepping down into the gap
  if (!timber) for (const sd of [-1, 1]) for (let k = 0; k < 7; k++) {
    const t = k / 6, u = sd * lerp(W.half * 0.48, W.half * 1.02, t) + sd * (r() - 0.5) * 0.3, y = lerp(W.rubble + 0.2, W.top - 0.4, t);
    const [x, z] = at(u, (r() - 0.5) * 0.4);
    b.add(G.box, lm(M, x, y, z, Math.atan2(W.ax, W.az) + (r() - 0.5) * 0.3, 0.6 + 0.4 * r(), 0.55 + 0.3 * r(), W.across * 2 - 0.1, (r() - 0.5) * 0.2, (r() - 0.5) * 0.3), MAT.stone, darker(st.stone, 0.75 + 0.25 * r()));
  }
  else for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {
    // snapped palisade logs leaning at the edges of the gap
    const [x, z] = at(sd * (W.half * 0.5 + k * 0.4), 0), L = W.top * (0.35 + 0.15 * k);
    b.add(G.cyl8, lm(M, x, L / 2, z, 0, 0.24, L, 0.24, 0, sd * (0.15 + 0.1 * r())), MAT.logH, st.logs, C.S.y, 3);
  }
  return b.build();
}
function scaffoldGeo(C, W) {
  const b = new Batch(), M = C.M, st = C.st;
  const px = -W.az, pz = W.ax, yaw = Math.atan2(W.ax, W.az);
  const at = (u, v) => [W.lx + W.ax * u + px * v, W.lz + W.az * u + pz * v];
  const H = W.top + 1.2, off = W.across + 0.45;
  for (const sd of [-1, 1]) {
    for (const u of [-W.half - 0.4, 0, W.half + 0.4]) { const [x, z] = at(u, sd * off); b.add(G.cyl8, lm(M, x, H / 2, z, 0, 0.09, H, 0.09), MAT.logH, st.logs, C.S.y, 3); }
    for (const y of [W.top * 0.38, W.top * 0.78]) {
      const [x, z] = at(0, sd * off);
      b.add(G.cyl8, lm(M, x, y, z, yaw, 0.06, W.half * 2 + 1.0, 0.06, Math.PI / 2), MAT.logH, st.logs);
      const [x2, z2] = at(0, sd * (off - 0.35));
      b.add(G.box, lm(M, x2, y + 0.08, z2, yaw, 0.7, 0.06, W.half * 2 + 0.8), MAT.wood, darker(st.wood, 1.1));
    }
    // a brace across each bay
    const [x, z] = at(-W.half / 2 - 0.2, sd * off);
    b.add(G.cyl8, lm(M, x, W.top * 0.4, z, yaw, 0.05, Math.hypot(W.half + 0.4, W.top * 0.75), 0.05, Math.atan2(W.half + 0.4, W.top * 0.75)), MAT.logH, st.logs);
  }
  // a hoist of fresh-cut stone waiting at the foot
  for (let i = 0; i < 3; i++) { const [x, z] = at(-W.half - 1.2 + i * 0.7, -(W.across + 1.6)); b.add(G.box, lm(M, x, 0.25 + (i % 2) * 0.5, z, yaw, 0.6, 0.48, 0.9), MAT.stone, darker(st.stone, 1.18)); }
  return b.build();
}
function castleSections(C) {
  const { S } = C;
  if (!C.sections || !C.sections.length) return;
  C.cutU = castleCutUniforms();
  const m = shareMat(castleMat, { uFlash: buildingMat.uniforms.uFlash, ...C.cutU });
  C.mesh.material = m;
  const km = CASTLE_KEEP_MESH.get(S);
  if (km) km.material = m;
  // the shadow of a breached wall has the same gap in it
  const dm = depthFrom(m, CASTLE_DEPTH_FS);
  for (const q of SHADOW.proxies) if (q.userData.src === C.mesh || (km && q.userData.src === km)) q.material = dm;
  const cs = Math.cos(S.yaw), sn = Math.sin(S.yaw);
  C.sections.forEach((W, k) => {
    W.k = k; W.C = C;
    const c = siteToWorld(S, W.lx, W.lz);
    W.wx = c.x; W.wz = c.z; W.wax = W.ax * cs + W.az * sn; W.waz = -W.ax * sn + W.az * cs;
    W.hp = W.maxHp = 0; W.state = 'whole'; W.t = 0; W.fresh = 0; W.quiet = 0; W.wear = 0;
    // what stands on this stretch of wall falls with it: the walk, a stair, their parapets
    const ys = S.y + W.rubble + 1.2;
    W.floors = C.floors.filter((f) => [-0.5, 0, 0.5].some((u) => { const t = floorTopOf(f, c.x + W.wax * u * W.half, c.z + W.waz * u * W.half); return t !== null && t > ys; }));
    W.colls = C.colls.filter((q) => { const dx = q.x - c.x, dz = q.z - c.z, al = dx * W.wax + dz * W.waz, ac = -dx * W.waz + dz * W.wax; return Math.abs(al) < W.half + 0.8 && Math.abs(ac) < W.across + 0.9; });
    // the wall's collider: the gap through the rubble is as wide as the bottom of the V
    const gap = W.half * 0.5;
    let best = null, bd = Infinity;
    for (const q of C.walls) {
      if (!q.active || q.type !== 'box') continue;
      const dx = q.axis === 'z' ? q.sin : q.cos, dz = q.axis === 'z' ? q.cos : -q.sin;
      // the collider must run along the section and contain its middle
      const ux = W.axis === 'z' ? q.sin : q.cos, uz = W.axis === 'z' ? q.cos : -q.sin;
      if (Math.abs(ux * W.wax + uz * W.waz) < 0.95) continue;
      const u = (c.x - q.x) * ux + (c.z - q.z) * uz, v = Math.hypot(c.x - q.x - ux * u, c.z - q.z - uz * u);
      const ext = W.axis === 'z' ? q.hz : q.hx;
      if (Math.abs(u) > ext - gap || v > 1.5) continue;
      const d = v + Math.abs(u) * 0.01;
      if (d < bd) { bd = d; best = { q, u }; }
      void dx; void dz;
    }
    if (best) W.coll = castleSplitColl(best.q, W.axis, best.u - gap, best.u + gap);
    // the rubble is climbed over from either side
    W.rubbleFloors = [];
    for (const sd of [-1, 1]) {
      const px = -W.az * sd, pz = W.ax * sd;
      const f = C.floor(W.lx + px * 1.35, W.lz + pz * 1.35, gap + 0.3, 1.4, Math.atan2(-px, -pz), 0, W.rubble * 0.85, -1.2);
      f.active = false;
      W.rubbleFloors.push(f);
    }
    W.wreck = new THREE.Mesh(breachGeo(C, W), buildingMat); W.wreck.visible = false; W.wreck.renderOrder = 1; scene.add(W.wreck);
    W.scaffold = new THREE.Mesh(scaffoldGeo(C, W), buildingMat); W.scaffold.visible = false; W.scaffold.renderOrder = 1; scene.add(W.scaffold);
    shadowCaster(W.wreck, BUILDING_DEPTH); shadowCaster(W.scaffold, BUILDING_DEPTH);
  });
  castleCutUpload(C);
}
function castleCutUpload(C) {
  const U3 = C.cutU, S = C.S;
  C.sections.forEach((W, k) => {
    const cutY = W.state === 'breach' ? S.y + W.rubble : W.state === 'repair' ? S.y + W.rubble + (W.top + 3.5 - W.rubble) * W.t : 1e5;
    U3.uCA.value[k].set(W.wx, W.wz, W.wax, W.waz);
    U3.uCB.value[k].set(W.half, cutY, W.state === 'whole' ? W.wear : W.state === 'breach' ? 1 : 1 - W.t, 0);
    U3.uCC.value[k].set(W.across, W.fresh, S.y + W.rubble, 0);
  });
}
const sectionMaxHp = () => 16 * baseDmg(warLevel());
function castleBreach(W) {
  const C = W.C, S = C.S;
  W.state = 'breach'; W.hp = 0; W.quiet = 0; W.t = 0;
  for (const f of W.floors) f.active = false;
  for (const q of W.colls) q.active = false;
  if (W.coll) W.coll.active = false;
  for (const f of W.rubbleFloors) f.active = true;
  W.wreck.visible = true;
  for (let i = 0; i < 6; i++) later(i * 0.12, () => FX.dust(W.wx + W.wax * (Math.random() - 0.5) * W.half * 2, S.y + W.rubble + Math.random() * W.top, W.wz + W.waz * (Math.random() - 0.5) * W.half * 2, 18, [0.42, 0.39, 0.35]));
  sfx('crash');
  const P = GAME.player;
  if (P) cameraShake(0.5, W.wx, W.wz);
  const K = S.keepRef;
  if (K) news(`The wall of ${S.name} has been breached!`, K.realm, K.realm === (P && P.faction) ? 'alarm' : 'normal');
  castleCutUpload(C);
  siegeOnBreach(W); // [siege] the garrison runs to hold the gap (04h_siege.js)
}
function castleRepairDone(W) {
  W.state = 'whole'; W.t = 1; W.fresh = 1; W.hp = W.maxHp = sectionMaxHp(); W.wear = 0;
  for (const f of W.floors) f.active = true;
  for (const q of W.colls) q.active = true;
  if (W.coll) { W.coll.active = true; W.coll.h = W.coll.fullH || W.coll.h; }
  W.scaffold.visible = false;
  siegeOnRepair(W); // [siege] (04h_siege.js)
  const K = W.C.S.keepRef;
  if (K) news(`${W.C.S.name} has rebuilt its wall.`, K.realm, 'normal');
}
// a heavy blow lands at (x, z): walls of other realms' castles within reach take it
function castleSiegeHit(src, x, z, r, mult) {
  if (!CASTLES.length || x > DUN_X0) return;
  for (const C of CASTLES) {
    if (!C.sections || !C.sections.length || dist2(x, z, C.S.x, C.S.z) > 50 * 50) continue;
    const K = C.S.keepRef;
    if (src && K && src.faction === K.realm) continue;
    for (const W of C.sections) {
      if (W.state !== 'whole') continue;
      const dx = x - W.wx, dz = z - W.wz, al = clamp(dx * W.wax + dz * W.waz, -W.half, W.half);
      const d = Math.hypot(dx - W.wax * al, dz - W.waz * al);
      if (d > r + W.across) continue;
      if (!W.maxHp) W.hp = W.maxHp = sectionMaxHp();
      const dmg = baseDmg(src ? src.level : warLevel()) * (src ? src.dmgMult || 1 : 1) * mult * (W.kind === 'timber' ? 1.25 : 0.85) * (1 - 0.5 * clamp(d / (r + W.across), 0, 1));
      W.hp -= dmg; W.lastHit = GAME.t;
      W.wear = clamp(1 - W.hp / W.maxHp, 0, 1);
      FX.dust(W.wx + W.wax * al, C.S.y + 1 + Math.random() * W.top * 0.6, W.wz + W.waz * al, 10, [0.45, 0.42, 0.38]);
      if (W.hp <= 0) castleBreach(W);
      castleCutUpload(C);
    }
  }
}
function updateBreaches(C, dt) {
  if (!C.sections || !C.sections.length) return;
  const K = C.S.keepRef;
  let dirty = false;
  for (const W of C.sections) {
    if (W.state === 'whole') { if (W.fresh > 0) { W.fresh = Math.max(0, W.fresh - dt / BREACH_FRESH); dirty = true; } continue; }
    // the owners wait for quiet before they build
    if (K && GAME.t - K.lastEnemyNear < BREACH_QUIET) { W.quiet = 0; continue; }
    W.quiet += dt;
    if (W.state === 'breach' && W.quiet > 2) {
      W.state = 'repair'; W.t = 0; W.scaffold.visible = true;
      for (const f of W.rubbleFloors) f.active = false;
      if (W.coll) { W.coll.fullH = W.coll.fullH || W.coll.h; W.coll.active = true; W.coll.h = 0.3; }
      dirty = true;
    }
    if (W.state === 'repair') {
      W.t = Math.min(1, W.t + dt / BREACH_REPAIR);
      if (W.t > 0.12) W.wreck.visible = false;
      if (W.coll) W.coll.h = Math.max(0.3, (W.coll.fullH || 7) * W.t);
      W.fresh = Math.min(1, W.t * 3);
      if (W.t >= 1) castleRepairDone(W);
      dirty = true;
    }
  }
  if (dirty) castleCutUpload(C);
}
