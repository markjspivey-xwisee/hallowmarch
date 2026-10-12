/* ================================================================== */
/* [look4] a house brought down by stones lies in rubble               */
/* ================================================================== */
// Version 13's stones brought a house down to a ruin that kept its walls whole to the eaves: a roofless shell, as a burnt
// one is. Now its walls are broken off at a ragged line (04d_look4.js look4Stub: each wall to its own height in steps of
// half a metre, between knee and chest height, the corners a little higher), the house shader and its shadow pass
// discarding what is above (04e_houses.js, 04j_rafters.js); here the broken tops are closed (a course of rough stone or a
// broken edge of plaster and timber on each step, the steps' ends filled), the fallen masonry lies heaped along each wall
// where it came down (more where the wall stands lower), the roof's timbers and its slates, thatch or shingles inside, and
// the walls' colliders and the shots' walls (07g_walls.js wallHouse) stand only as high as the broken walls. Built back
// behind its scaffold (houseScaffoldStep), the rubble is cleared and the walls rise course by course (uHD.x, the level:
// houseBatterUniform in 04j_batter.js), the new work pale, until they stand whole and the roof goes on.
// A small mesh a fallen house (houseRubbleSync, once a step from updateHouses: rebuilt when the level steps up), none
// for the others; not saved (it follows H.bat.fell and the house's state, which are).

const RUBBLE = { list: new Map(), stats: { built: 0, removed: 0, rebuilt: 0 }, t: 0 };
const RUB_COURSE = 0.25; // the walls rise a course at a time while they are built back
// the level the walls are built back to: none in the ruin, a course at a time over the first 60% of the scaffold's time
function houseRubbleLevel(H) {
  if (H.state !== 'scaffold') return 0;
  const full = (H.round ? H.wallH : H.wallH + H.rh) + 0.1;
  const k = clamp(H.stT / (HOUSE_TIME.scaffold * 0.6), 0, 1);
  return k >= 1 ? 1e4 : Math.floor((k * full) / RUB_COURSE) * RUB_COURSE;
}
// the wall's faces as runs of segments: for each, its frame, its length and the stub of each segment (the side faces of a
// box house leave the corner squares to the front and back, so no two caps lie on each other)
function houseRubbleRuns(H) {
  const out = [];
  if (H.round) {
    const R = Math.round(H.r * 100) * 0.01, L = TAU * R, n = Math.ceil(L / LOOK4_SEG);
    out.push({ round: true, R, L, n });
    return out;
  }
  const W2 = Math.round((H.w / 2) * 100) * 0.01, D2 = Math.round((H.d / 2) * 100) * 0.01;
  for (let f = 0; f < 4; f++) {
    const len = f % 2 ? 2 * D2 : 2 * W2;
    out.push({ f, F: houseFace(H, f), len, e0: f % 2 ? H.t : 0, e1: f % 2 ? len - H.t : len, n: Math.floor((len - 0.001) / LOOK4_SEG) + 1 });
  }
  return out;
}
// the openings in a run at height y: [u0, u1] spans with no wall (the door below its head, a window between its sill and
// its head), in the run's u (from its left end)
function houseRubbleHoles(H, run, y) {
  const holes = [];
  const add = (uc, w) => holes.push([uc - w / 2, uc + w / 2]);
  if (run.round) {
    const R = run.R;
    if (y < H.door.h) add(Math.PI * R, H.door.w);
    for (const win of H.wins) if (y > win.y - win.h / 2 && y < win.y + win.h / 2) add((win.a + Math.PI) * R, win.w);
    return holes;
  }
  if (run.f === 0 && y < H.door.h) add(run.len / 2 + H.door.u, H.door.w);
  for (const win of H.wins) if (win.face === run.f && y > win.y - win.h / 2 && y < win.y + win.h / 2) add(run.len / 2 + win.u, win.w);
  // a gable end above the eaves stands only under the roof's line
  if (!run.round && y > H.wallH) {
    if (run.f % 2) holes.push([-1, run.len + 1]);
    else { const half = Math.max(0, (H.rh - (y - H.wallH)) / H.tn); holes.push([-1, run.len / 2 - half], [run.len / 2 + half, run.len + 1]); }
  }
  return holes;
}
// the solid parts of [a, b] once the holes are taken out
function houseRubbleSolid(a, b, holes) {
  let parts = [[a, b]];
  for (const [h0, h1] of holes) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (h1 <= p0 || h0 >= p1) { next.push([p0, p1]); continue; }
      if (h0 > p0) next.push([p0, h0]);
      if (h1 < p1) next.push([h1, p1]);
    }
    parts = next;
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.02);
}
// the stub of a run's segment i (asked at the segment's middle on the wall's own middle line, as the shader asks)
function houseRubbleStub(H, run, i) {
  if (run.round) {
    const a = ((i + 0.5) * LOOK4_SEG) / run.R - Math.PI, rr = run.R - H.t / 2;
    return look4StubAt(H, Math.sin(a) * rr - 1e-6, Math.cos(a) * rr);
  }
  const u = Math.min((i + 0.5) * LOOK4_SEG, run.len - 0.01), p = faceP(run.F, u - run.len / 2, -H.t / 2);
  return look4StubAt(H, p.x, p.z);
}
function houseRubbleGeo(H, level) {
  const b = new Batch(), st = STYLE[H.style] || STYLE.stone, r = mulberry(H.num * 977 + 13);
  const M = new THREE.Matrix4().compose(new THREE.Vector3(H.x, H.y, H.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, H.yaw, 0)), new THREE.Vector3(1, 1, 1));
  const t = H.t, ruin = H.state === 'ruin';
  // what the wall is made of: a box house of plaster over stone footings (Logres), logs (Thule), a roundhouse of daub
  const wallMat = H.style === 'timber' ? MAT.logH : H.round ? MAT.plaster : H.keepHall && H.style === 'stone' ? MAT.stone : MAT.plaster;
  const wallCol = H.style === 'timber' ? st.logs : H.round ? [0.62, 0.52, 0.36] : H.keepHall && H.style === 'stone' ? st.stone : st.plaster;
  const coreCol = H.round ? [0.5, 0.42, 0.3] : H.style === 'timber' ? darker(st.logs, 0.8) : darker(st.stone, 0.9);
  const fullH = (H.round ? H.wallH : H.wallH + H.rh) + 0.1;
  const fresh = (c) => [Math.min(1, c[0] * 1.12 + 0.03), Math.min(1, c[1] * 1.1 + 0.03), Math.min(1, c[2] * 1.06 + 0.025)];
  const info = { caps: 0, ends: 0, stones: 0, timbers: 0 };
  // a cap over [u0, u1] of a run at height y (its top at y), and the rough broken stones or the plaster's edge on it
  const cap = (run, u0, u1, y, built) => {
    const um = (u0 + u1) / 2, L = u1 - u0;
    const col = built ? fresh(coreCol) : coreCol;
    if (run.round) {
      const a = um / run.R - Math.PI, rr = run.R - t / 2, x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      b.add(G.box, lm(M, x, y - 0.06, z, a + Math.PI / 2, L * (1 - t / (2 * run.R)) + 0.01, 0.12, t - 0.035), MAT.plaster, col, H.y, 2);
      // the broken edge: a few rough lumps of daub and wattle on it, here and there
      if (!built) for (let k = 0, nk = Math.floor(r() * 3.2 * L / 0.5); k < nk; k++) {
        const aa = (u0 + r() * L) / run.R - Math.PI, s0 = 0.04 + 0.05 * r();
        b.add(G.ico, lm(M, Math.sin(aa) * (rr + (r() - 0.5) * t * 0.4), y + 0.005, Math.cos(aa) * (rr + (r() - 0.5) * t * 0.4), r() * 3, s0 * 1.4, s0 * (0.5 + 0.5 * r()), s0), MAT.plaster, darker(coreCol, 0.55 + 0.25 * r()));
      }
    } else {
      const p = faceP(run.F, um - run.len / 2, -t / 2);
      b.add(G.box, lm(M, p.x, y - 0.06, p.z, run.F.yaw, L, 0.12, t - 0.012), wallMat === MAT.logH ? MAT.wood : MAT.plaster, col, H.y, 2);
      if (!built) {
        // the broken edge: a few rough lumps of the wall's core on it, here and there, darker than its face (a row of them
        // evenly spaced read as battlements)
        for (let k = 0, nk = Math.floor(r() * 3.2 * L / 0.5); k < nk; k++) {
          const q = faceP(run.F, u0 + r() * L - run.len / 2, -t / 2 + (r() - 0.5) * t * 0.4), s0 = 0.04 + 0.05 * r();
          b.add(G.ico, lm(M, q.x, y + 0.005, q.z, r() * 3, s0 * 1.4, s0 * (0.5 + 0.5 * r()), Math.min(s0, t * 0.35)), wallMat === MAT.logH ? MAT.wood : MAT.plaster, darker(H.style === 'timber' ? st.logs : coreCol, 0.55 + 0.25 * r()));
        }
      }
    }
    info.caps++;
  };
  // a step's end: from the lower top up to the higher, at the boundary u (dir: toward the lower side)
  const end = (run, u, y0, y1, dir) => {
    const h = y1 - y0 + 0.04, ym = (y0 + y1) / 2 - 0.02, uc = u - dir * 0.015;
    if (run.round) {
      const a = uc / run.R - Math.PI, rr = run.R - t / 2;
      b.add(G.box, lm(M, Math.sin(a) * rr, ym, Math.cos(a) * rr, a + Math.PI / 2, 0.03, h, t - 0.035), MAT.plaster, coreCol, H.y, 2);
    } else {
      const p = faceP(run.F, uc - run.len / 2, -t / 2);
      b.add(G.box, lm(M, p.x, ym, p.z, run.F.yaw, 0.03, h, t - 0.012), wallMat === MAT.logH ? MAT.wood : MAT.plaster, coreCol, H.y, 2);
    }
    info.ends++;
  };
  for (const run of houseRubbleRuns(H)) {
    const tops = [];
    for (let i = 0; i < run.n; i++) {
      const s = houseRubbleStub(H, run, i);
      tops.push({ y: Math.max(s, level), built: level > s + 0.01 });
    }
    const L = run.round ? run.L : run.len;
    for (let i = 0; i < run.n; i++) {
      const T = tops[i].y;
      if (T >= fullH - 0.02) continue;
      const a = Math.max(i * LOOK4_SEG, run.round ? 0 : run.e0), c = Math.min((i + 1) * LOOK4_SEG, run.round ? L : run.e1);
      if (c - a < 0.02) continue;
      for (const [p0, p1] of houseRubbleSolid(a, c, houseRubbleHoles(H, run, T))) cap(run, p0, p1, T, tops[i].built);
      // the step to the next segment (round: the last meets the first)
      const j = i + 1 < run.n ? i + 1 : run.round ? 0 : -1;
      if (j < 0) continue;
      const T2 = tops[j].y, ub = run.round && j === 0 ? L : (i + 1) * LOOK4_SEG;
      if (Math.abs(T2 - T) < 0.01 || (!run.round && (ub <= run.e0 || ub >= run.e1))) continue;
      const lo = Math.min(T, T2), hi = Math.min(Math.max(T, T2), fullH);
      // only where there is wall between the two tops at the boundary
      if (!houseRubbleSolid(ub - 0.02, ub + 0.02, houseRubbleHoles(H, run, (lo + hi) / 2)).length) continue;
      end(run, ub % L, lo, hi, T > T2 ? 1 : -1);
    }
    if (!ruin) continue;
    // the fallen masonry heaped along the wall, out and in, more where it stands lower: a low mound of broken stuff, broken
    // blocks and lumps on it (dressed stone, the core's rubble, plaster or daub, a log's ends); the doorway kept clear
    for (let i = 0; i < run.n; i++) {
      const fallen = clamp((fullH - tops[i].y) / fullH, 0, 1), nk = Math.round(3 + 9 * fallen);
      const spot = (side, n0) => {
        const u = (i + r()) * LOOK4_SEG, n = side > 0 ? n0 : -t - n0;
        if (run.round ? Math.abs(u - Math.PI * run.R) < H.door.w / 2 + 0.6 : run.f === 0 && Math.abs(u - run.len / 2) < H.door.w / 2 + 0.6) return null;
        if (!run.round && (u < run.e0 || u > run.e1)) return null;
        if (run.round) { const a = u / run.R - Math.PI, rr = run.R + n; return { x: Math.sin(a) * rr, z: Math.cos(a) * rr, yaw: a }; }
        const p = faceP(run.F, u - run.len / 2, n); return { x: p.x, z: p.z, yaw: run.F.yaw };
      };
      // the mound, out and in: low and broken, the dust and grit of the fallen wall (a single big one read as a pillow)
      if (fallen > 0.3) for (const side of [1, -1]) for (let j = 0; j < 2; j++) {
        const q = spot(side, 0.15 + 0.35 * r()); if (!q) continue;
        b.add(G.ico, lm(M, q.x, 0.0, q.z, q.yaw + r() * 1.2, 0.22 + 0.16 * r(), 0.04 + 0.08 * fallen * r(), 0.2 + 0.14 * r()), MAT.plaster, [0.3 + 0.08 * r(), 0.27 + 0.06 * r(), 0.23 + 0.05 * r()], H.y, 1);
      }
      for (let k = 0; k < nk; k++) {
        const side = r() < 0.55 ? 1 : -1, n0 = 0.06 + r() * r() * (0.5 + 0.9 * fallen), q = spot(side, n0);
        if (!q) continue;
        const near = clamp(1 - n0 / 1.2, 0, 1), lift = 0.12 * fallen * near * r(), pick = r();
        const col = darker(pick < 0.5 ? coreCol : pick < 0.8 ? wallCol : H.style === 'stone' ? st.stone : coreCol, 0.72 + 0.38 * r());
        if (H.style === 'timber' && pick < 0.3) {
          // a log's end, broken from the wall
          const L = 0.5 + 0.7 * r();
          b.add(G.cyl8, lm(M, q.x, 0.1 + lift, q.z, q.yaw + (r() - 0.5) * 1.2, 0.1, L, 0.1, Math.PI / 2 + (r() - 0.5) * 0.3), MAT.logH, darker(st.logs, 0.75 + 0.3 * r()), H.y, 1.2);
        } else if (pick < 0.62) {
          // a broken block
          const sx = 0.1 + 0.18 * r(), sy = 0.07 + 0.11 * r(), sz = 0.09 + 0.15 * r();
          b.add(G.box, lm(M, q.x, sy * 0.35 + lift, q.z, r() * TAU, sx, sy, sz, (r() - 0.5) * 0.7, (r() - 0.5) * 0.7), H.style === 'stone' || H.style === 'timber' ? MAT.stone : MAT.plaster, col, H.y, 1.2);
        } else {
          // a lump of rubble, plaster or daub
          const sz = 0.05 + 0.09 * r();
          b.add(G.ico, lm(M, q.x, sz * 0.4 + lift, q.z, r() * 3, sz * (1 + 0.5 * r()), sz * (0.6 + 0.4 * r()), sz), MAT.plaster, col, H.y, 1.2);
        }
        info.stones++;
      }
    }
  }
  if (ruin) {
    // the roof fell in: its timbers across the floor and leaning on the stubs, its covering in heaps among them
    const iw = H.round ? H.ri * 0.75 : H.iw - 0.2, id = H.round ? H.ri * 0.75 : H.id - 0.2;
    const wood = darker(st.wood, 0.75);
    for (let k = 0; k < (H.big ? 9 : 6); k++) {
      const x0 = (r() * 2 - 1) * iw, z0 = (r() * 2 - 1) * id, a = r() * TAU, L = 1.6 + r() * 2.2, rise = r() < 0.4 ? 0.6 + r() * 0.6 : 0.08;
      beam(b, M, [x0, 0.1 + rise, z0], [x0 + Math.sin(a) * L, 0.1, z0 + Math.cos(a) * L], 0.1, MAT.wood, darker(wood, 0.8 + 0.4 * r()), 0.13);
      info.timbers++;
    }
    // the floor under the fallen roof: dust and broken stuff over it, its boards showing between
    for (let k = 0; k < (H.big ? 90 : 55); k++) {
      const x0 = (r() * 2 - 1) * iw, z0 = (r() * 2 - 1) * id, s0 = 0.05 + 0.1 * r(), pick = r();
      if (pick < 0.25) b.add(G.ico, lm(M, x0, 0.0, z0, r() * 3, 0.25 + 0.3 * r(), 0.03 + 0.04 * r(), 0.22 + 0.25 * r()), MAT.plaster, [0.32 + 0.06 * r(), 0.29 + 0.05 * r(), 0.25 + 0.04 * r()], H.y, 1);
      else if (pick < 0.65) b.add(G.box, lm(M, x0, s0 * 0.3, z0, r() * TAU, s0 * 1.6, s0 * 0.7, s0 * 1.2, (r() - 0.5) * 0.8, (r() - 0.5) * 0.8), H.style === 'stone' ? MAT.plaster : MAT.stone, darker(r() < 0.5 ? coreCol : wallCol, 0.6 + 0.35 * r()), H.y, 1);
      else b.add(G.ico, lm(M, x0, s0 * 0.35, z0, r() * 3, s0 * 1.2, s0 * 0.7, s0), MAT.plaster, darker(coreCol, 0.6 + 0.3 * r()), H.y, 1);
      info.stones++;
    }
    const roofCol = H.style === 'timber' ? darker(st.roof, 1.1) : H.round ? st.thatch : st.roof;
    const roofMat = H.round ? MAT.thatch : H.style === 'timber' ? MAT.wood : MAT.slate;
    for (let k = 0; k < (H.big ? 7 : 4); k++) {
      const x0 = (r() * 2 - 1) * iw * 0.8, z0 = (r() * 2 - 1) * id * 0.8, s = 0.6 + r() * 0.8;
      if (H.round) b.add(G.ico, lm(M, x0, 0.12, z0, r() * 3, s, 0.22 + 0.15 * r(), s * 0.8), roofMat, darker(roofCol, 0.75 + 0.3 * r()), H.y, 1);
      else for (let q = 0; q < 6; q++) b.add(G.box, lm(M, x0 + (r() - 0.5) * s, 0.06 + q * 0.03, z0 + (r() - 0.5) * s, r() * 3, 0.3 + 0.2 * r(), 0.025, 0.22 + 0.15 * r(), (r() - 0.5) * 0.5, (r() - 0.5) * 0.5), roofMat, darker(roofCol, 0.75 + 0.35 * r()));
    }
  }
  return { g: b.n ? b.build() : null, info };
}
// the walls' colliders stand as high as the broken walls (and the shots' walls: 07g_walls.js asks look4WallTop)
function houseRubbleColl(H, on, level) {
  for (const c of H.coll) {
    if (c.tag !== 'house') continue;
    if (c.h0 === undefined) c.h0 = c.h;
    c.h = on ? Math.min(c.h0, Math.max(1.6, level + 0.15)) : c.h0;
  }
}
// once a step: a mesh of broken tops and rubble for each fallen house (rebuilt as the walls rise), none for the others
function houseRubbleSync() {
  for (const H of HOUSES) {
    const want = look4Fell(H);
    let R = RUBBLE.list.get(H);
    if (!want) {
      if (H.rub) { houseRubbleColl(H, false, 0); H.rub = null; }
      if (R) { houseRubbleDrop(R); RUBBLE.list.delete(H); RUBBLE.stats.removed++; }
      continue;
    }
    const level = houseRubbleLevel(H), key = H.state + ':' + level;
    if (!H.rub) H.rub = { level: 0 };
    H.rub.level = level;
    if (R && R.key === key) continue;
    if (R) { houseRubbleDrop(R); RUBBLE.stats.rebuilt++; } else RUBBLE.stats.built++;
    houseRubbleColl(H, true, level);
    const { g, info } = houseRubbleGeo(H, level);
    if (!g) { RUBBLE.list.set(H, { key, mesh: null, info }); continue; }
    const mesh = new THREE.Mesh(g, buildingMat);
    mesh.renderOrder = 1;
    scene.add(mesh);
    RUBBLE.list.set(H, { key, mesh, proxy: shadowCaster(mesh, BUILDING_DEPTH), info });
  }
  houseScafSync(); // (after the levels: the roof frame goes on in the step the walls stand whole)
}
function houseRubbleDrop(R) {
  if (!R.mesh) return;
  R.mesh.removeFromParent();
  if (R.proxy) { SHADOW.scene.remove(R.proxy); const k = SHADOW.proxies.indexOf(R.proxy); if (k >= 0) SHADOW.proxies.splice(k, 1); }
  R.mesh.geometry.dispose();
}

/* ------------------------------------------------------------------ */
/* a house built back behind a working scaffold                         */
/* ------------------------------------------------------------------ */
// Version 6's scaffold was poles, a plank a lift and a ladder no one could climb, and the townsfolk hammered at the air
// beside it. Now it is a putlog scaffold as the castles' are (look3Scaffold, 04d_look3.js): a row of standards round the
// house a metre out from its walls (the doorway kept clear), a lift of boards at working height with its rail and
// braces, a ladder up to it that anyone climbs (its boards are floors, its ladder a ladder record: look3ScaffoldWorld),
// the standards solid; the new roof frame goes up on the walls once they stand (at once for a burnt house, whose walls
// stood through the fire). Built the first time the house is put back (houseScafSync), kept for the next time, its
// floors, ladder and colliders on only while it stands. The townsfolk at work stand inside it at the wall
// (houseScafWorkSpot, from houseWorkPlan in 08f_townlife.js).
const HSCAF = { list: new Map(), stats: { laid: 0, shown: 0 } };
const HSCAF_OUT = 1.0, HSCAF_OUT_ROUND = 1.25, HSCAF_GAP = 1.7;
function houseScafLifts(H) {
  const out = [Math.max(1.9, Math.min(H.wallH - 1.25, 2.6))];
  while (out.length < 3 && out[out.length - 1] + 1.85 <= H.wallH - 0.9) out.push(out[out.length - 1] + 1.85);
  return out.map((y) => Math.round(y * 100) / 100);
}
// the standards' places round the house (frame coordinates), in order from the right of the door round to its left, and
// the way to the wall at each
function houseScafPts(H) {
  const pts = [], ins = [];
  const push = (x, z, nx, nz) => { const l = Math.hypot(nx, nz) || 1; pts.push([x, z]); ins.push([nx / l, nz / l]); };
  if (H.round) {
    const R = H.r + HSCAF_OUT_ROUND, gapA = (H.door.w / 2 + 1.0) / R, n = Math.max(6, Math.round((TAU - 2 * gapA) * R / HSCAF_GAP));
    for (let k = 0; k <= n; k++) { const a = gapA + (k / n) * (TAU - 2 * gapA); push(Math.sin(a) * R, Math.cos(a) * R, -Math.sin(a), -Math.cos(a)); }
    return { pts, ins };
  }
  const X = H.w / 2 + HSCAF_OUT, Z = H.d / 2 + HSCAF_OUT, dx0 = H.door.w / 2 + 0.9;
  const run = (ax, az, bx, bz, nx, nz, first) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / HSCAF_GAP));
    for (let k = first ? 0 : 1; k <= n; k++) push(lerp(ax, bx, k / n), lerp(az, bz, k / n), nx, nz);
  };
  // front (right of the door) -> right corner -> back -> left corner -> front (left of the door); corners face in diagonally
  run(dx0, Z, X, Z, 0, -1, true); ins[ins.length - 1] = [-Math.SQRT1_2, -Math.SQRT1_2];
  run(X, Z, X, -Z, -1, 0, false); ins[ins.length - 1] = [-Math.SQRT1_2, Math.SQRT1_2];
  run(X, -Z, -X, -Z, 0, 1, false); ins[ins.length - 1] = [Math.SQRT1_2, Math.SQRT1_2];
  run(-X, -Z, -X, Z, 1, 0, false); ins[ins.length - 1] = [Math.SQRT1_2, -Math.SQRT1_2];
  run(-X, Z, -dx0, Z, 0, -1, false);
  return { pts, ins };
}
function houseScafFrame(H) { return { x: H.x, z: H.z, y: H.y, yaw: H.yaw }; }
// the scaffold's mesh: the putlog scaffold, and (roof: the walls stand) the new roof frame of fresh timber
function houseScafGeo(H, Q, roof) {
  const b = new Batch(), M = new THREE.Matrix4().compose(new THREE.Vector3(H.x, H.y, H.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, H.yaw, 0)), new THREE.Vector3(1, 1, 1));
  const fresh = [0.66, 0.52, 0.34], pole = [0.56, 0.44, 0.3];
  const info = look3Scaffold(b, M, Q.pts, Q.ins, { lifts: Q.lifts, top: Q.lifts[Q.lifts.length - 1] + 1.3, deep: (H.round ? HSCAF_OUT_ROUND : HSCAF_OUT) - 0.16, gy: (x, z) => { const w = houseW(H, x, z); return heightAt(w.x, w.z) - H.y; }, clear: (x, z) => Q.ok.get(x.toFixed(2) + ',' + z.toFixed(2)) !== false, pole, wood: [0.6, 0.47, 0.31], baseY: H.y, seed: H.num * 31 + 5, curve: H.round });
  if (roof) {
    if (H.round) {
      const nR = H.big ? 16 : 12, top = H.y0 + H.hc;
      for (let k = 0; k < nR; k++) { const a = (k / nR) * TAU + 0.13; beam(b, M, [Math.sin(a) * (H.Rr - 0.4), H.roofAt(H.Rr - 0.4) - 0.2, Math.cos(a) * (H.Rr - 0.4)], [0, top - 0.5, 0], 0.08, MAT.wood, fresh, 0.1); }
      for (const f of [0.25, 0.5]) {
        const rad = (H.Rr - 0.4) * (1 - f) + 0.2, y = H.roofAt(rad) - 0.16;
        for (let k = 0; k < nR; k++) { const a0 = (k / nR) * TAU + 0.13, a1 = ((k + 1) / nR) * TAU + 0.13; beam(b, M, [Math.sin(a0) * rad, y, Math.cos(a0) * rad], [Math.sin(a1) * rad, y, Math.cos(a1) * rad], 0.04, MAT.wood, fresh); }
      }
    } else {
      const yTop = H.wallH + H.rh - 0.15, n = Math.max(4, Math.round(H.d / 0.75));
      for (let k = 0; k <= n; k++) { const z = -H.d / 2 - 0.2 + (k / n) * (H.d + 0.4); for (const sd of [-1, 1]) beam(b, M, [sd * (H.w / 2 + 0.3), H.wallH - 0.3 * H.tn, z], [0, yTop, z], 0.07, MAT.wood, fresh, 0.12); }
      b.add(G.box, lm(M, 0, yTop + 0.05, 0, 0, 0.14, 0.16, H.d + 0.5), MAT.wood, fresh);
      for (const sd of [-1, 1]) for (const f of [0.3, 0.65]) b.add(G.box, lm(M, sd * (H.w / 2) * (1 - f), H.wallH + H.rh * f - 0.06, 0, 0, 0.06, 0.05, H.d + 0.5), MAT.wood, fresh);
    }
  }
  // the new covering waiting by the wall: bundles of thatch or shingles, on the ground and on each other
  const q = H.round ? { x: Math.sin(2.6) * (H.r + HSCAF_OUT_ROUND + 0.9), z: Math.cos(2.6) * (H.r + HSCAF_OUT_ROUND + 0.9) } : { x: -H.w / 2 - HSCAF_OUT - 0.85, z: -H.d / 4 };
  const g0 = (() => { const w = houseW(H, q.x, q.z); return heightAt(w.x, w.z) - H.y; })();
  for (let k = 0; k < 4; k++) b.add(G.cyl8, lm(M, q.x + (k % 2 ? 0.17 : -0.17), g0 + 0.17 + (k >> 1) * 0.32, q.z + (k >> 1) * 0.05, H.round ? 2.6 : 0, 0.17, 1.2, 0.17, Math.PI / 2), H.style === 'timber' ? MAT.wood : MAT.thatch, H.style === 'timber' ? fresh : [0.74, 0.62, 0.36]);
  return { g: b.build(), info };
}
// laid out the first time the house is put back: the standards' places (each clear of what stands there now), their
// colliders, the boards' floors and the ladder (kept, off, for the next time)
function houseScafLay(H) {
  const { pts, ins } = houseScafPts(H), ok = new Map(), colls = [];
  const lifts = houseScafLifts(H), top = lifts[lifts.length - 1] + 1.3, skip = new Set(H.coll);
  for (const [x, z] of pts) {
    const w = houseW(H, x, z), clear = look3Clear(w.x, w.z, 0.18, skip) && isWalkable(w.x, w.z) && !waterAt(w.x, w.z);
    ok.set(x.toFixed(2) + ',' + z.toFixed(2), clear);
  }
  const Q = { pts, ins, lifts, ok, colls, on: false, mesh: null, key: '', H };
  // what look3Scaffold keeps of the standards (a lone one is left out): their colliders
  const probe = look3Scaffold(new Batch(), new THREE.Matrix4(), pts, ins, { lifts, top, deep: (H.round ? HSCAF_OUT_ROUND : HSCAF_OUT) - 0.16, gy: () => 0, clear: (x, z) => ok.get(x.toFixed(2) + ',' + z.toFixed(2)) !== false, pole: [0, 0, 0], wood: [0, 0, 0], seed: H.num * 31 + 5 });
  for (const [x, z] of pts) {
    if (ok.get(x.toFixed(2) + ',' + z.toFixed(2)) === false) continue;
    const w = houseW(H, x, z), c = addCircle(w.x, w.z, 0.1, 'scaffold', H.y + top - heightAt(w.x, w.z) + 0.3);
    c.active = false; c.hscaf = H; colls.push(c);
  }
  H.scafColl = colls; // (updateHouses keeps them on while the house is being built back, as it did version 6's poles)
  look3ScaffoldWorld(Q, houseScafFrame(H), [probe]);
  Q.info = { standards: probe.standards, bays: probe.bays, boards: probe.boards, ladders: probe.ladders };
  HSCAF.list.set(H, Q); HSCAF.stats.laid++;
  return Q;
}
// once a step (from houseRubbleSync): the scaffold of each house being built back stands, the others' do not
function houseScafSync() {
  for (const H of HOUSES) {
    const want = H.state === 'scaffold';
    let Q = HSCAF.list.get(H);
    if (!want && !Q) continue;
    if (want && !Q) Q = houseScafLay(H);
    const roof = want && (!look4Fell(H) || look4Level(H) > 1e3), key = want ? (roof ? 'roof' : 'up') : '';
    if (Q.key !== key) {
      Q.key = key;
      if (Q.mesh) { houseRubbleDrop(Q); Q.mesh = null; }
      if (want) {
        const { g } = houseScafGeo(H, Q, roof);
        Q.mesh = new THREE.Mesh(g, buildingMat); Q.mesh.renderOrder = 1; scene.add(Q.mesh);
        Q.proxy = shadowCaster(Q.mesh, BUILDING_DEPTH);
        HSCAF.stats.shown++;
      }
      for (const c of Q.colls) c.active = want;
    }
    look3ScafSync(Q, want);
  }
}
// no active collider (but those in skip) within r of (x, z): a place a body can stand (look3Clear also refuses the place
// under a raised floor, and the work is under the scaffold's boards)
const _hsC = [];
function houseSpotClear(x, z, r, skip) {
  collidersNear(x, z, r + 4, _hsC);
  for (const c of _hsC) {
    if (c.active === false || c.hollow || (skip && skip.has(c))) continue;
    if (c.type === 'circle') { if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false; continue; }
    const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) return false;
  }
  return isWalkable(x, z);
}
// where a townsman works on a house being built back: inside its scaffold at the wall, under the boards (side: which
// side of the house), facing the wall
function houseScafWorkSpot(H, side) {
  const Q = HSCAF.list.get(H);
  if (!Q) return null;
  // the first of a few places along the walls (its side first, then the back, then the other side) clear of what stands
  // by the house (a bench, barrels: a yard's things) and of the standards
  const skip = new Set(H.coll), cands = [];
  if (H.round) for (const a of [1.65, 2.2, 1.1, 2.75]) for (const sd of [side, -side]) cands.push([Math.sin(sd * a), Math.cos(sd * a), H.r]);
  else {
    for (const sd of [side, -side]) for (const z of [-0.15, 0.1, -0.35, 0.3]) cands.push([sd, 0, H.w / 2, z * H.d]);
    for (const x of [0, 0.25, -0.25]) cands.push([0, -1, H.d / 2, x * H.w]);
  }
  for (const c of cands) {
    let l, f;
    if (H.round) { l = { x: c[0] * (c[2] + 0.5), z: c[1] * (c[2] + 0.5) }; f = { x: c[0] * (c[2] - 0.2), z: c[1] * (c[2] - 0.2) }; }
    else if (c[0]) { l = { x: c[0] * (c[2] + 0.5), z: c[3] }; f = { x: c[0] * (c[2] - 0.2), z: c[3] }; }
    else { l = { x: c[3], z: c[1] * (c[2] + 0.5) }; f = { x: c[3], z: c[1] * (c[2] - 0.2) }; }
    const p = houseW(H, l.x, l.z);
    if (!houseSpotClear(p.x, p.z, 0.32, skip)) continue;
    const q = houseW(H, f.x, f.z);
    return { x: p.x, z: p.z, fx: q.x, fz: q.z };
  }
  return null;
}
queueMicrotask(() => { if (window.__hm) window.__hm.rubble = { RUBBLE, HSCAF, houseScafSync, houseScafLay, houseScafPts, houseScafLifts, houseScafWorkSpot, houseRubbleSync, houseRubbleGeo, houseRubbleLevel, houseRubbleRuns, houseRubbleStub, stubAt: look4StubAt, wallTop: look4WallTop, fell: look4Fell, dims: look4Dims }; });
