/* ================================================================== */
/* [walls] stone towers breach under siege and are mended              */
/* ================================================================== */
// The drums of masonry (the Logres corner and gate towers, the Eriu gate towers and side lookouts) are sections of
// their castle as the curtains' breachable stretches are (C.sections, after the walls', so saved walls keep their
// numbers): kind 'tower', centred on the drum, `across` its outer radius, `half` along its face. A stone from an engine
// or a meteor that lands on or by one (castleSiegeHit) wears it: cracks spread over its stones (the castle shader's
// cWear inside the drum), and at the end its upper works fall (castleBreach): everything above the guard room's floor
// comes down, and the face toward the field falls in a ragged V to a mound of rubble that spills into the store room
// (towerBreachCut in the castle shader: uKA/uKB/uKC; the rubble and the scaffold are meshes of their own). The rooms
// above are lost: their floors, the hatches, the doors at the walks' height, the furniture and the torches stand down,
// the ladders are gone (no body climbs them, no route leads up them), the ring of masonry is open in the V (a body
// climbs the rubble ramps in from the field) and no higher than the stump elsewhere, and whoever stood up there falls
// (the fall's harm by its height). The garrison's archer posted on its top falls with it. It can be stormed (towerBreachRoute:
// in over the rubble, through the store room and out at its courtyard door), and the garrison runs to hold the court
// before that door (siegeOnBreach, towerPlugAt); the bands keep to the gate and the curtains' breaches (siegeOpenBreach
// leaves the towers out: a way that narrow held a band of ten up for minutes). Once the keep has been quiet a while its owners put up scaffolding and
// build it back course by course (updateBreaches), the new stone pale for a time, and the rooms, ladders, doors,
// hatches, torches, banners and the archer's post come back (castleRepairDone). Saved with the walls (world.land).
// Engines take no tower for their mark (siegePlanFor): a tower falls to the stones that strike it in passing (wallsStoneStep,
// castleSiegeHit at that point) and to meteors.

const TB_MAX = 6; // stone towers per castle the shader knows (Logres 6, Eriu 4)
const TBREACH = { stats: { hits: 0, breached: 0, mended: 0, fell: 0 }, list: [] };
const TBREACH_GLSL = /* glsl */`
    // [walls] a breached stone tower (04g_breach.js): A = (x, z, outer radius, the height above which nothing stands),
    // B = (the breach's outward direction, the V's foot, its half-angle there), Q = (inner radius, the rubble's top
    // inside (0: none), wear, fresh stone)
    uniform vec4 uKA[${TB_MAX}]; uniform vec4 uKB[${TB_MAX}]; uniform vec4 uKC[${TB_MAX}];
    bool towerBreachCut(vec3 p){
      bool cut = false;
      for (int i = 0; i < ${TB_MAX}; i++) {
        vec4 A = uKA[i], B = uKB[i], Q = uKC[i];
        if (A.z <= 0.0) break; // (packed from the first: a castle's towers, then none)
        vec2 d = p.xz - A.xy;
        float r = length(d);
        if (r > A.z) continue;
        vec2 u = d / max(r, 1e-3);
        float co = clamp(dot(u, B.xy), -1.0, 1.0);
        float jag = vnoise(vec2((u.x * 1.7 + u.y * 2.9) * 3.0 + float(i) * 5.3, p.y * 1.6)) - 0.5;
        float rim = 1.0 - smoothstep(A.z - 0.7, A.z, r);
        cWear = max(cWear, Q.z * rim * (0.55 + 0.45 * max(co, 0.0)));
        cFresh = max(cFresh, Q.w * rim);
        if (p.y > A.w + jag * 1.1) { cut = true; continue; }
        float hw = B.w + max(0.0, p.y - B.z) * 0.12 + jag * 0.22;
        if (acos(co) < hw && p.y > B.z + jag * 0.45) cut = true;
        if (Q.y > 0.0 && r < Q.x && p.y > Q.y + jag * 0.35) cut = true;
      }
      return cut;
    }
`;

const tbSections = (C) => (C.sections || []).filter((W) => W.kind === 'tower');
// the towers of each keep become breachable sections (from buildTowers, once the towers and their floors exist)
function towerBreachInit() {
  for (const C of CASTLES) {
    if (C.kind === 'temple' || !C.sections || !C.cutU) continue;
    const S = C.S, cs = Math.cos(S.yaw), sn = Math.sin(S.yaw);
    let n = 0;
    for (const T of TOWER.list) {
      if (T.C !== C || T.kind !== 'drum' || T.look === 'timber' || n >= TB_MAX) continue;
      n++;
      const aOut = Math.atan2(T.cx, T.cz), ox = Math.sin(aOut), oz = Math.cos(aOut);
      // the stump: the guard room's floor (or the platform's) goes, and everything above it
      const lv = T.levels.filter((y) => y > T.yG + 1), cutY = (lv.length ? lv[0] : T.TT) - 0.45;
      const W = { kind: 'tower', T, lx: T.cx, lz: T.cz, ax: oz, az: -ox, axis: 'x', half: T.RO * 0.55, across: T.RO, top: T.TT, rubble: T.yG + 0.95, aOut, cutY, hpK: 1.25 };
      W.k = C.sections.length; W.C = C;
      W.wx = T.wx; W.wz = T.wz; W.wax = W.ax * cs + W.az * sn; W.waz = -W.ax * sn + W.az * cs;
      W.ox = ox * cs + oz * sn; W.oz = -ox * sn + oz * cs;
      W.hp = W.maxHp = 0; W.state = 'whole'; W.t = 0; W.fresh = 0; W.quiet = 0; W.wear = 0;
      // the V's foot: as wide as the gap in the ring of masonry (about two metres at the middle of the wall)
      const RM = (T.RI + T.RO) / 2, sec = TAU / T.NS, gapA = 1.05 / RM;
      W.vHalf = gapA + sec * 0.5;
      // what falls: the floors at the stump and above (the rooms, the top, the doorways' thresholds there)
      const near = (x, z, pad) => dist2(x, z, T.wx, T.wz) < (T.RO + pad) ** 2;
      W.floors = C.floors.filter((f) => f.active && f.tag !== 'hatch' && near(f.x, f.z, 0.7) && Math.max(f.ya, f.yb) > S.y + cutY + 0.1);
      // the ring of masonry: open in the V, no higher than the stump elsewhere; the top's crenels and pole; the furniture
      W.colls = [];
      W.lower = [];
      W.ring = []; // the ring's pieces that fall: in the V (gap) or above the stump; walled up again as the work rises
      for (const c of T.colls) {
        const l = siteLocal(S, c.x, c.z), a = Math.atan2(l.x - T.cx, l.z - T.cz), top = c.y0 + c.h;
        if (Math.abs(angDiff(a, aOut)) < gapA + sec * 0.55 && top > S.y + W.rubble) { W.colls.push(c); W.ring.push({ c, gap: true }); }
        else if (c.y0 >= S.y + cutY - 0.05) { W.colls.push(c); W.ring.push({ c, gap: false }); }
        else if (top > S.y + cutY) W.lower.push({ c, h: c.h });
      }
      for (const c of C.colls) if (c.y0 != null && c.y0 >= S.y + cutY - 0.3 && near(c.x, c.z, 0.6) && !T.colls.includes(c)) W.colls.push(c);
      for (const c of T.props) W.colls.push(c);
      W.coll = null;
      // the rubble: a ramp up from the field over the fallen face, and down into the store room
      W.rubbleFloors = [];
      const r1 = T.RO + 2.8, r0 = T.RO - 0.35, rc = 0.25;
      const pOut = siteToWorld(S, T.cx + ox * r1, T.cz + oz * r1), gOut = heightAt(pOut.x, pOut.z) - S.y;
      const f1 = C.floor(T.cx + ox * (r0 + r1) / 2, T.cz + oz * (r0 + r1) / 2, 1.05, (r1 - r0) / 2, aOut + Math.PI, Math.min(gOut, W.rubble - 0.6), W.rubble, Math.min(gOut, 0) - 1.2, 0, 'rubble');
      const f2 = C.floor(T.cx + ox * (rc + r0) / 2, T.cz + oz * (rc + r0) / 2, 1.05, (r0 - rc) / 2, aOut + Math.PI, W.rubble, T.yG + 0.32, T.yG - 1.2, 0, 'rubble');
      for (const f of [f1, f2]) { f.active = false; W.rubbleFloors.push(f); }
      W.wreck = perf2LazyMesh(() => towerRubbleGeo(W), buildingMat); W.wreck.renderOrder = 1; scene.add(W.wreck); // [perf2] its rubble is made the first time it shows (13x_perf2.js)
      W.scaffold = new THREE.Mesh(look3EmptyGeo(), buildingMat); W.scaffold.visible = false; W.scaffold.renderOrder = 1; scene.add(W.scaffold); // [look3] laid out when first put up (look3Lay, 04d_look3.js)
      shadowCaster(W.wreck, BUILDING_DEPTH); shadowCaster(W.scaffold, BUILDING_DEPTH);
      // the banners on its top
      W.banners = [];
      for (const B of BANNERS) {
        if (B.site !== S) continue;
        const a0 = bannerGeo.attributes.aB0.array, a1 = bannerGeo.attributes.aB1.array, k = B.k;
        if (dist2(a0[k * 4], a0[k * 4 + 2], T.wx, T.wz) < 1.5 * 1.5 && a0[k * 4 + 1] > S.y + cutY) W.banners.push({ k, w: a1[k * 4], h: a1[k * 4 + 1] });
      }
      C.sections.push(W);
      TBREACH.list.push(W);
    }
    castleCutUpload(C);
  }
}
// the fallen masonry: a mound in the gap spilling out onto the field and into the store room, broken blocks, a few
// of the floor's beams
function towerRubbleGeo(W) {
  const T = W.T, C = W.C, b = new Batch(), M = C.M, st = C.st, r = mulberry(Math.round(Math.abs(T.wx * 31 + T.wz * 17)) + 3);
  const ox = Math.sin(W.aOut), oz = Math.cos(W.aOut), px = oz, pz = -ox;
  const at = (u, v) => [T.cx + ox * u + px * v, T.cz + oz * u + pz * v];
  for (let i = 0; i < 64; i++) {
    const u = -0.4 + r() * (T.RO + 3.4), v = (r() - 0.5) * (2.4 + Math.min(u, T.RO) * 0.6);
    // the mound's height over the line out from the middle: highest over the fallen face
    const dd = Math.abs(u - (T.RO - 0.3));
    const h = Math.max(0.05, (W.rubble - T.yG + 0.2) * (1 - Math.min(1, dd / 3.2)) * (1 - 0.4 * Math.min(1, Math.abs(v) / 2.2)));
    const [x, z] = at(u, v), s = 0.25 + 0.42 * r(), y = rubbleSinkY(W, x, T.yG + h * (0.55 + 0.3 * r()), z, 0.26); // [motion5] (sunk in the mound over the way a body walks: 13y_motion5.js)
    // [look3] most of the heap is the drum's own dressed stones, tumbled and broken (it read as a pile of round
    // boulders), with smaller broken pieces between them
    if (i % 3) b.add(G.box, lm(M, x, y, z, r() * TAU, 0.45 + 0.5 * r(), 0.28 + 0.2 * r(), 0.32 + 0.3 * r(), (r() - 0.5) * 1.2, (r() - 0.5) * 1.2), MAT.stone, darker(st.stone, 0.66 + 0.3 * r()), C.S.y, 1.5);
    else b.add(G.ico, lm(M, x, y - s * 0.2, z, r() * TAU, s * 0.9, s * 0.5, s * 0.7, r() * 0.6, r() * 0.6), MAT.stone, darker(st.stone, 0.62 + 0.3 * r()), C.S.y, 1.5);
  }
  // squared blocks of the face, tumbled
  for (let i = 0; i < 14; i++) {
    const u = T.RO - 1.2 + r() * 3.6, v = (r() - 0.5) * 3.2, [x, z] = at(u, v);
    b.add(G.box, lm(M, x, rubbleSinkY(W, x, T.yG + 0.3 + r() * 0.5, z, 0.32), z, r() * TAU, 0.55 + 0.35 * r(), 0.4 + 0.2 * r(), 0.45 + 0.3 * r(), (r() - 0.5) * 0.8, (r() - 0.5) * 0.8), MAT.stone, darker(st.stone, 0.72 + 0.25 * r())); // [motion5]
  }
  // the guard room's beams and boards, broken, in the heap inside
  for (let i = 0; i < 6; i++) {
    const u = (r() - 0.3) * T.RI, v = (r() - 0.5) * T.RI, [x, z] = at(u, v);
    b.add(G.box, lm(M, x, rubbleSinkY(W, x, T.yG + 0.5 + r() * 0.7, z, 0.2), z, r() * TAU, 0.18, 0.16, 1.2 + r() * 1.4, (r() - 0.5) * 0.9, (r() - 0.5) * 0.4), MAT.wood, darker(st.wood, 0.55 + 0.25 * r())); // [motion5]
  }
  // the broken ends of the drum either side of the V: ragged courses stepping down into the gap
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) {
    const t = k / 5, a = W.aOut + sd * (W.vHalf + 0.05 + t * 0.35), rr = (T.RI + T.RO) / 2;
    const x = T.cx + Math.sin(a) * rr, z = T.cz + Math.cos(a) * rr, y = lerp(W.rubble + 0.15, W.cutY - 0.6, t);
    b.add(G.box, lm(M, x, y, z, a, 0.7 + 0.3 * r(), 0.45 + 0.25 * r(), T.RO - T.RI + 0.1, (r() - 0.5) * 0.2, (r() - 0.5) * 0.25), MAT.stone, darker(st.stone, 0.74 + 0.22 * r()));
  }
  rubbleMound(b, W); // [motion5] the mound the stones lie on, over the ramps a body walks (13y_motion5.js)
  return b.build();
}
// [look3] a putlog scaffold round the drum's face (look3Scaffold, 04d_look3.js): standards, ledgers, putlogs into the
// wall, a floor of boards at each lift with its rail, braces and ladders; a hoist and new-cut stone at its foot and on its
// top lift. Version 13's were poles and two rings of ledgers, the boards on edge to the eye
function towerScaffoldGeo(W) {
  const T = W.T, C = W.C, b = new Batch(), M = C.M, st = C.st, S = C.S, rnd = mulberry(Math.round(Math.abs(T.wx * 13 + T.wz * 7)) + 5);
  const deep = 0.95, R = T.RO + deep + 0.08, span = 1.15;
  const lifts = [];
  for (let y = T.yG + 1.9; y < W.top - 0.5; y += 1.9) lifts.push(y);
  const nSt = Math.max(3, Math.round((2 * span * R) / 2.0) + 1), pts = [], ins = [];
  for (let i = 0; i < nSt; i++) { const a = W.aOut - span + (2 * span * i) / (nSt - 1); pts.push([T.cx + Math.sin(a) * R, T.cz + Math.cos(a) * R]); ins.push([-Math.sin(a), -Math.cos(a)]); }
  const skip = new Set(T.colls);
  const gy = (x, z) => { const w = siteToWorld(S, x, z); return heightAt(w.x, w.z) - S.y; };
  const clear = (x, z, r = 0.2) => { const w = siteToWorld(S, x, z); return look3Clear(w.x, w.z, r, skip); };
  const top = (lifts.length ? lifts[lifts.length - 1] : W.top) + 1.35;
  W.scafInfo = look3Scaffold(b, M, pts, ins, { lifts, top, deep, gy, clear, pole: st.logs, wood: st.wood, baseY: S.y, seed: Math.round(Math.abs(T.wx * 7 + T.wz * 3)), curve: true });
  look3ScaffoldWorld(W, S, [W.scafInfo]); // its boards are floors and its ladders are climbed while it stands
  // new-cut stone waiting on the top lift, by the wall
  if (lifts.length) for (let i = 0; i < 2; i++) {
    const a = W.aOut + (i ? 0.35 : -0.42), rr = T.RO + 0.42, y = lifts[Math.min(lifts.length, LOOK4.lifts) - 1] + 0.37; // [look4] on the highest lift that is up (04d_look4.js)
    b.add(G.box, lm(M, T.cx + Math.sin(a) * rr, y, T.cz + Math.cos(a) * rr, a, 0.55, 0.42, 0.4), MAT.stone, darker(st.stone, 1.18 + 0.06 * rnd()));
  }
  // a hoist's mast and boom, its rope and a stone in the sling, and new-cut stone waiting at the foot
  const a = W.aOut + span + 0.38, x = T.cx + Math.sin(a) * (R + 0.6), z = T.cz + Math.cos(a) * (R + 0.6);
  if (clear(x, z, 0.3)) {
    const g = gy(x, z) - 0.3, mt = top + 0.6, bx = x - Math.sin(a) * 0.4 + Math.cos(a) * 1.3, bz = z - Math.cos(a) * 0.4 - Math.sin(a) * 1.3;
    look3Pole(b, M, [x, g, z], [x, mt, z], 0.1, st.logs, MAT.logH, S.y);
    look3Pole(b, M, [x, mt - 0.5, z], [bx, mt + 0.25, bz], 0.07, st.logs);
    look3Pole(b, M, [bx, mt + 0.2, bz], [bx, mt - 2.6, bz], 0.012, [0.5, 0.42, 0.3], MAT.cloth);
    b.add(G.box, lm(M, bx, mt - 2.85, bz, a, 0.5, 0.36, 0.36), MAT.stone, darker(st.stone, 1.2));
  }
  // (three on the ground, the fourth on the first: version 13 set every other one 0.5 m up in the air)
  for (let i = 0; i < 4; i++) {
    const j = i % 3, aa = W.aOut - span - 0.32 - j * 0.2, xx = T.cx + Math.sin(aa) * (R + 1.1), zz = T.cz + Math.cos(aa) * (R + 1.1);
    if (!clear(xx, zz, 0.4)) continue;
    b.add(G.box, lm(M, xx, gy(xx, zz) + 0.23 + (i === 3 ? 0.46 : 0), zz, aa + (i === 3 ? 0.25 : (rnd() - 0.5) * 0.3), 0.6, 0.46, 0.9), MAT.stone, darker(st.stone, 1.16 + 0.06 * rnd()));
  }
  return b.build();
}

// the castle shader's view of its towers (from castleCutUpload), and what a breach takes with it (idempotent)
function towerBreachUpload(C) {
  const U3 = C.cutU;
  if (!U3 || !U3.uKA) return;
  const Ws = tbSections(C), S = C.S;
  for (let i = 0; i < TB_MAX; i++) {
    const W = Ws[i];
    if (!W) { U3.uKA.value[i].set(0, 0, 0, 0); U3.uKB.value[i].set(0, 1, 1e5, 0); U3.uKC.value[i].set(0, 0, 0, 0); continue; }
    const T = W.T, down = W.state !== 'whole', t = W.state === 'repair' ? W.t : 0;
    const cut = W.state === 'breach' ? S.y + W.cutY : W.state === 'repair' ? S.y + lerp(W.cutY, T.TT + 6, smooth(t)) : 1e5;
    const foot = W.state === 'breach' ? S.y + W.rubble : W.state === 'repair' ? S.y + lerp(W.rubble, T.TT + 6, smooth(t)) : 1e5;
    const heap = W.state === 'breach' || (W.state === 'repair' && t < 0.9) ? S.y + T.yG + 1.45 : 0;
    U3.uKA.value[i].set(T.wx, T.wz, T.RO + 0.45, cut);
    U3.uKB.value[i].set(W.ox, W.oz, foot, W.vHalf);
    U3.uKC.value[i].set(T.RI - 0.08, heap, W.state === 'whole' ? W.wear : W.state === 'breach' ? 1 : 1 - t, W.fresh || 0);
    towerBreachSync(W, down);
    // rebuilding: the rubble is cleared away first, then the scaffold goes up (its poles never stand in the heap)
    if (W.scaffold && W.wreck) { W.scaffold.visible = W.state === 'repair' && t >= 0.12; W.wreck.visible = W.state === 'breach' || (W.state === 'repair' && t < 0.12); }
    // and the masonry stands again as high as the work has come (the V's foot, the stump's line)
    if (W.state === 'repair') {
      for (const q of W.ring) q.c.active = (q.gap ? foot : cut) > Math.max(q.c.y0, S.y + T.yG) + 1.0;
      for (const q of W.lower) q.c.h = Math.min(q.h, Math.max(0.3, cut - q.c.y0));
    }
  }
}
// the tower's own state follows its section's: rooms, ladders, doors, hatches, torches and banners
function towerBreachSync(W, down) {
  const T = W.T;
  if (!!T.breached === down) return;
  T.breached = down;
  const S = T.S, yCut = S.y + W.cutY;
  for (const L of T.ladders) { if (down) { if (!L.gone) { L.gone = true; L.brGone = true; } } else if (L.brGone) { L.gone = false; L.brGone = false; } }
  for (const Hh of T.hatches) { Hh.gone = down; if (down) { Hh.held = false; Hh.until = 0; Hh.floor.active = false; Hh.lidColl.active = false; } }
  for (const D of T.doors) { const gone = down && D.wy > yCut - 0.2; D.gone = gone; if (gone) { D.coll.active = false; D.leafColl.active = false; } }
  for (const q of W.lower) q.c.h = down ? Math.max(0.3, yCut - q.c.y0) : q.h;
  // the torches go out with the rooms (and are lit again)
  if (down) { W.fires = []; for (const f of FIRES) if (f.wall && T.fires.some((p) => Math.abs(p.x - f.x) < 0.01 && Math.abs(p.z - f.z) < 0.01)) { W.fires.push([f, f.size]); f.size = 0; f.lightR = 0; } }
  else if (W.fires) { for (const [f, s] of W.fires) { f.size = s; f.lightR = 7; } W.fires = null; }
  const a1 = bannerGeo.attributes.aB1.array;
  for (const B of W.banners) { a1[B.k * 4] = down ? 0 : B.w; a1[B.k * 4 + 1] = down ? 0 : B.h; }
  if (W.banners.length) bannerGeo.attributes.aB1.needsUpdate = true;
  // the parts mesh (doors and lids) is posed again
  for (const K of TOWER.keeps) if (K.C === T.C) { K.dirty = true; for (const q of K.parts) q.dirty = true; } // [perf2] (each part posed again: 04l_towers.js poses only those marked)
}
// the upper works fall (from castleBreach): whoever stood up there falls into the rubble
function towerBreachFall(W) {
  const T = W.T, S = T.S, yCut = S.y + W.cutY;
  TBREACH.stats.breached++;
  forNear(T.wx, T.wz, T.RO + 1.2, (o) => {
    if (!o.alive || o.kind === 'door' || o.flying || o.y < yCut - 0.2) return;
    if (dist2(o.x, o.z, T.wx, T.wz) > (T.RO + 0.4) ** 2) return;
    if (o.motion && o.motion.kind === 'ladder') { ladderKnockOff(o, null); return; }
    o.fixedY = null;
    o.motion = { kind: 'ladder', L: T.ladders[0], st: 3, t: 0, vy: 0.6, y0: o.y, by: null, dx: (o.x - T.wx) * 0.3, dz: (o.z - T.wz) * 0.3, dir: 1 };
    TBREACH.stats.fell++;
  });
  // the climbers on its ladders fall too
  for (const e of LADDER_CLIMBERS) if (e.motion && e.motion.L && e.motion.L.T === T && e.motion.st !== 3) ladderKnockOff(e, null);
  for (let i = 0; i < 8; i++) later(i * 0.1, () => FX.dust(T.wx + W.ox * T.RO * (0.5 + Math.random()), S.y + W.rubble + Math.random() * (T.TT - W.rubble), T.wz + W.oz * T.RO * (0.5 + Math.random()), 18, wallLit([0.44, 0.41, 0.37])));
  const P = GAME.player;
  if (P && dist2(P.x, P.z, T.wx, T.wz) < 90 * 90) { wallSfx('stone', T.wx, T.wz); uiLog(`A tower of ${S.name} falls in!`, 'warn'); }
}
// built back (from castleRepairDone): the archer whose post was on its top walks up again
function towerBreachMended(W) {
  TBREACH.stats.mended++;
  const T = W.T, K = T.S.keepRef;
  if (!K) return;
  for (const id of K.guards) {
    const g = getEnt(id);
    if (!g || !g.alive || !g.ai.wall || !g.ai.slot || g.ai.route) continue;
    const i = +g.ai.slot.slice(1), Rt = castleRoute(K, i);
    if (!Rt || !Rt.length) continue;
    const end = Rt[Rt.length - 1];
    if (dist2(end.x, end.z, T.wx, T.wz) > (T.RO + 1) ** 2 || Math.abs(g.y - end.y) < 0.8) continue;
    // back to the courtyard door, then up through the tower as a new archer would
    g.ai.route = Rt; g.ai.ri = 0;
  }
}
// the way a band storms a fallen tower (siegeBreachRoute): up the rubble from the field, across the store room, out
// at its courtyard door (it swings open for anyone) and on into the court
function towerBreachRoute(W) {
  const T = W.T, S = T.S, D = T.doors.find((d) => d.y < T.yG + 0.6), a1 = D ? D.a : T.aIn;
  const at = (r, a) => siteToWorld(S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r);
  const court = siteToWorld(S, T.cx * 0.45, T.cz * 0.45);
  return [at(T.RO + 7, W.aOut), at(T.RO + 0.8, W.aOut), at(0.4, W.aOut), at(T.RI - 0.45, a1), at(T.RO + 1.6, a1), court];
}
// where the garrison stands to hold it (siegeOnBreach): before its courtyard door, either side of the door's line and a
// few paces out, so the doorway stays open and the fight is in the court
function towerPlugAt(W, n) {
  const T = W.T, D = T.doors.find((d) => d.y < T.yG + 0.6), a1 = D ? D.a : T.aIn, k = (n >> 1) + 1, a = a1 + (n % 2 ? -1 : 1) * 0.42 * k, r = T.RO + 2.4 + (k > 1 ? 0.9 : 0);
  const p = siteToWorld(T.S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r);
  return { x: p.x, z: p.z };
}
// hits from castleSiegeHit on a tower are counted (the shared damage is the section's)
queueMicrotask(() => { if (window.__hm) window.__hm.breach = { TBREACH, list: () => TBREACH.list, sync: towerBreachSync, upload: towerBreachUpload, route: towerBreachRoute, plugAt: towerPlugAt }; });
