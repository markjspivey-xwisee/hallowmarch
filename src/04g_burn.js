/* ================================================================== */
/* [siege2] walls that burn as they are built: a burh's palisade       */
/* ================================================================== */
// The palisades of the Thule burhs are logs (palisadeWall, 04_props.js; keepTimber): a fire spell or a burning arrow
// that lands on them, a brand held to them (E) or the dragon's breath sets a stretch alight (palisadeFireAt, asked by
// fireLandsAt with its caster: the garrison's and its realm's own fire never lights its own walls; the player's always),
// and the fire takes hold and spreads along the wall from stretch to stretch (cells of PAL_CELL m), with real flames
// and smoke, chars the logs black (the castle shader: palisadeCut sets tChar/tGlow/tFresh as a burnt tower's), burns
// whoever stands against it or on the walk behind it, and rain or snow damps it (a young fire in a downpour goes out).
// A stretch that has burnt PAL_T.burn seconds burns through: its logs fall to charred stumps (cut in the shader), the
// wall's colliders open over it, a heap of burnt logs lies in the gap, and the gap is a breach the bands storm and the
// garrison plugs as a fallen curtain (palisadeGaps: siegeOpenBreach, siegeOnBreach, siegeDanger). Once the keep has
// been quiet a while its owners put up scaffolding and build it back, the new logs rising and pale for a time; the
// charred stretches are replaced too. Saved with the world (save part world.x.palisade). Loads before 04g_castles.js:
// its GLSL is part of the castle shader's (PAL_GLSL in CASTLE_CUT_GLSL).

const PAL = { list: [], ready: false, stats: { lit: 0, spread: 0, out: 0, through: 0, rebuilt: 0, spared: 0, harm: 0 }, dirty: new Set() };
const PAL_CELL = 1.5, PZ_MAX = 6;
const PAL_T = { climb: 20, burn: 75, spread: 9, quiet: 20, rebuild: 150, ember: 110, cut: 0.6, harm: 0.03, fresh: 140, npcCatch: 0.3, douse: 0.07, news: 45, reach: 3 };
const PAL_LINE = KEEP_HS - KEEP_T / 2; // the palisades' middle line in the keep's frame (14.9)
const PAL_GLSL = /* glsl */`
    // [siege2] a burh's palisade burning (04g_burn.js): S = the keep (x, z, cos, sin of its yaw), Y = (its height),
    // zones along its walls: A = (wall: 0 back, 1 left, 2 right, 3 front; from; to (metres along it); char),
    // B = (embers, the height it has burnt down to (world), fresh timber, 0)
    uniform vec4 uPS; uniform vec4 uPY; uniform vec4 uPA[${PZ_MAX}]; uniform vec4 uPB[${PZ_MAX}];
    float pOn = 0.0, pAl = 0.0; // a fragment of a burning stretch, and how far along its wall (the char's checks run across the logs)
    bool palisadeCut(vec3 p, float pmat){
      if (uPS.z == 0.0 && uPS.w == 0.0) return false;
      vec2 d = p.xz - uPS.xy, l = vec2(d.x * uPS.z - d.y * uPS.w, d.x * uPS.w + d.y * uPS.z);
      float L = ${PAL_LINE.toFixed(3)}, al = 0.0, sd = -1.0;
      if (abs(l.y + L) < 0.56) { sd = 0.0; al = l.x; } else if (abs(l.y - L) < 0.56) { sd = 3.0; al = l.x; }
      else if (abs(l.x + L) < 0.56) { sd = 1.0; al = l.y; } else if (abs(l.x - L) < 0.56) { sd = 2.0; al = l.y; }
      if (sd < 0.0) return false;
      int pm = int(pmat + 0.5);
      if (!(pm == 5 || pm == 14 || (pm == 1 && p.y > uPY.x + ${(WALL_H - 0.15).toFixed(2)}))) return false; // its logs, their sharpened tops, the loopholes
      bool cut = false;
      for (int i = 0; i < ${PZ_MAX}; i++) {
        vec4 A = uPA[i], B = uPB[i];
        if (A.z <= A.y || abs(A.x - sd) > 0.5) continue;
        float jag = vnoise(vec2(al * 1.9 + float(i) * 3.7, p.y * 0.8)) - 0.5;
        float e0 = A.y + jag * 0.45, e1 = A.z - jag * 0.45;
        if (al < e0 - 0.9 || al > e1 + 0.9) continue;
        float inside = smoothstep(e0 - 0.9, e0 + 0.15, al) * (1.0 - smoothstep(e1 - 0.15, e1 + 0.9, al));
        if (inside > 0.01) { pOn = 1.0; pAl = al; }
        tChar = max(tChar, A.w * inside * (0.72 + 0.28 * vnoise(p.xz * 2.3 + p.y * 1.7)));
        tGlow = max(tGlow, B.x * inside);
        tFresh = max(tFresh, B.z * inside);
        if (al > e0 && al < e1 && p.y > B.y + jag * 0.8 + (vnoise(vec2(al * 6.0, 3.0)) - 0.5) * 0.5) cut = true;
      }
      return cut;
    }
`;

// the burnable stretches of each burh's palisade, in cells along its walls (clear of the towers' log walls)
function palisadeInit() {
  if (PAL.ready || !CASTLES.some((C) => C.cutU)) return; // (not before the castles are built)
  PAL.ready = true;
  const ce = KEEP_HS - 1.2 - 2.7 - 0.05, ge = GATE_TW.timber.x + GATE_TW.timber.HO + 0.05;
  for (const C of CASTLES) {
    if (C.kind !== 'timber' || !C.S.keepRef || !C.cutU) continue;
    const S = C.S, P = { C, S, cells: [], gaps: [] };
    const runs = [[0, -ce, ce], [1, -ce, ce], [2, -ce, ce], [3, -ce, -ge], [3, ge, ce]];
    for (const [side, a0, a1] of runs) {
      const n = Math.max(1, Math.round((a1 - a0) / PAL_CELL)), w = (a1 - a0) / n;
      for (let k = 0; k < n; k++) {
        const ca = a0 + (k + 0.5) * w, l = palisadeLocal(side, ca, 0), p = siteToWorld(S, l.x, l.z);
        P.cells.push({ P, side, a: ca, a0: a0 + k * w, a1: a0 + (k + 1) * w, x: p.x, z: p.z, st: 0, heat: 0, char: 0, t: 0, ember: 0, fresh: 0, fires: [], tick: 0, nb: [] });
      }
    }
    // neighbours along the same wall (the fire spreads to them)
    P.cells.forEach((c, i) => { for (const o of P.cells) if (o !== c && o.side === c.side && Math.abs(o.a - c.a) < PAL_CELL * 1.2) c.nb.push(o); void i; });
    C.pal = P;
    PAL.list.push(P);
    palisadeUpload(P);
  }
}
// a point on wall `side` at `along` metres along it and `out` metres out from its middle line, in the keep's frame
function palisadeLocal(side, along, out) {
  return side === 0 ? { x: along, z: -PAL_LINE - out } : side === 3 ? { x: along, z: PAL_LINE + out } : side === 1 ? { x: -PAL_LINE - out, z: along } : { x: PAL_LINE + out, z: along };
}
// the cell of a burh's palisade nearest (x, y, z), within reach r of its logs, or null
function palisadeCellAt(x, y, z, r) {
  palisadeInit();
  let best = null, bd = Infinity;
  for (const P of PAL.list) {
    if (dist2(x, z, P.S.x, P.S.z) > (KEEP_HS + 6 + r) ** 2) continue;
    if (y < P.S.y - 1 || y > P.S.y + WALL_H + 1.4) continue;
    const l = siteLocal(P.S, x, z);
    for (const c of P.cells) {
      const q = palisadeLocal(c.side, c.a, 0), along = c.side === 0 || c.side === 3 ? l.x - q.x : l.z - q.z, across = c.side === 0 || c.side === 3 ? l.z - q.z : l.x - q.x;
      const ex = Math.max(0, Math.abs(along) - (c.a1 - c.a0) / 2), ey = Math.max(0, Math.abs(across) - 0.5), d = Math.hypot(ex, ey);
      if (d <= r + 0.35 && d < bd) { bd = d; best = c; }
    }
  }
  return best;
}
// may the fire of `by` light this keep's palisade? (the garrison's and its realm's own fire never does; the player's always)
function palisadeSpared(P, by) {
  if (!by || by === GAME.player || by.role === 'player') return false;
  const K = P.S.keepRef;
  return !!(K && by.faction === K.realm);
}
// fire lands at (x, y, z) with reach r, cast by `by` (fireLandsAt)
function palisadeFireAt(x, y, z, r, by) {
  const c = palisadeCellAt(x, y, z, Math.max(0.6, r * 0.6));
  if (!c) return 0;
  if (palisadeSpared(c.P, by)) { PAL.stats.spared++; return 0; }
  // a spark (embers from the wall, a tower or the grass: no caster) does not take again in logs already burnt and put out,
  // and the wall's own sparks do not light the wall (its fire goes along it from stretch to stretch: palisadeBurnStep)
  if (!by && (c.st === 2 || PAL.sparking)) return 0;
  // thick logs, often wet with the dew: a soldier's bolt or burning arrow takes hold only now and then (the player's,
  // a brand's and the dragon's always do)
  if (by && by.faction !== undefined && by !== GAME.player && by.role !== 'player' && Math.random() > PAL_T.npcCatch) return 0;
  return palisadeIgnite(c) ? 1 : 0;
}
// the dragon's breath along (dx, dz) from (x, z)
function palisadeFireCone(x, z, dx, dz, range, half) {
  palisadeInit();
  let n = 0;
  for (const P of PAL.list) {
    if (dist2(x, z, P.S.x, P.S.z) > (range + KEEP_HS + 4) ** 2) continue;
    for (const c of P.cells) {
      const ox = c.x - x, oz = c.z - z, d = Math.hypot(ox, oz);
      if (d > range || (d > 1.5 && (ox * dx + oz * dz) / d < Math.cos(half + 0.1))) continue;
      if (palisadeIgnite(c)) { n++; if (n >= 2) return n; }
    }
  }
  return n;
}
function palisadeIgnite(c, heat = 0.12, gen = 0) {
  if (c.st === 1 || c.st === 3 || c.st === 4) return false;
  c.st = 1; c.heat = Math.max(c.heat, heat); c.t = 0; c.tick = 0; c.gen = gen;
  PAL.stats.lit++;
  PAL.dirty.add(c.P);
  const P = GAME.player;
  sfxAt('ignite', c.x, null, c.z); // [audio2] placed, wherever it catches (11c_sound.js)
  if (P && dist2(P.x, P.z, c.x, c.z) < 70 * 70 && GAME.t > (c.P.told || 0)) { c.P.told = GAME.t + 20; uiLog(`The palisade of ${c.P.S.name} has caught fire!`, 'warn'); }
  return true;
}
// where flames show on a burning cell: against its outer and inner faces, low and high, and along its top
function palisadeSpots(c) {
  if (c.spots) return c.spots;
  const S = c.P.S, out = [];
  // [v13] low, high and the top first: a stretch burns with three flames at most (PAL_FLAMES), climbing as it heats
  for (const [o, y] of [[0.55, 1.6], [-0.55, 4.2], [0, WALL_H + 0.3], [-0.55, 2.4], [0.55, 5.4]]) {
    const l = palisadeLocal(c.side, c.a + (Math.random() - 0.5) * 0.5, o), p = siteToWorld(S, l.x, l.z);
    out.push({ x: p.x, z: p.z, y, s: o === 0 ? 0.9 : 0.75 });
  }
  return (c.spots = out);
}
// the cells burnt through, gathered into gaps a band can storm: each a breach as a fallen curtain's (siegeOpenBreach)
function palisadeGaps(C) { return C && C.pal ? C.pal.gaps : []; }
function palisadeGapOpen(P, cells, quiet = false) {
  const S = P.S, side = cells[0].side, a0 = Math.min(...cells.map((c) => c.a0)), a1 = Math.max(...cells.map((c) => c.a1)), am = (a0 + a1) / 2;
  const l = palisadeLocal(side, am, 0), w = siteToWorld(S, l.x, l.z);
  const along = side === 0 || side === 3 ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const cs = Math.cos(S.yaw), sn = Math.sin(S.yaw);
  const W = { kind: 'burnt', pal: true, C: P.C, P, side, a0, a1, cells, lx: l.x, lz: l.z, wx: w.x, wz: w.z, ax: along.x, az: along.z, wax: along.x * cs + along.z * sn, waz: -along.x * sn + along.z * cs, half: (a1 - a0) / 2, across: 0.6, top: WALL_H, rubble: PAL_T.cut, state: 'breach', t: 0, quiet: 0, hp: 0, maxHp: 1, wear: 1, colls: [] };
  // the wall's colliders open over the gap: each box of the palisade that runs through it is cut there (castleSplitColl:
  // its two ends stay, the middle stands down until the gap is built back)
  for (const c of palisadeWallColls(P, side, a0, a1)) {
    const lc = siteLocal(S, c.x, c.z), cA = side === 0 || side === 3 ? lc.x : lc.z, ext = side === 1 || side === 2 ? c.hz : c.hx;
    const axis = side === 0 || side === 3 ? 'x' : 'z', u0 = clamp(a0 - cA, -ext, ext), u1 = clamp(a1 - cA, -ext, ext);
    if (u1 - u0 < 0.05) continue;
    const mid = castleSplitColl(c, axis, u0, u1);
    mid.active = false;
    W.colls.push({ old: c, mid });
  }
  // the burnt logs in the engines' charring shader (04h_siege.js): charcoal with embers glowing in their checks while they
  // are hot, and no snow on them until they have cooled
  W.wmat = shareMat(siegeMat, { uFlash: buildingMat.uniforms.uFlash, uChar: { value: 1 }, uEmber: { value: 1 }, uSnowCover: { value: 0 } });
  W.wreck = new THREE.Mesh(palisadeWreckGeo(W), W.wmat); W.wreck.renderOrder = 1; scene.add(W.wreck); shadowCaster(W.wreck, BUILDING_DEPTH);
  P.gaps.push(W);
  PAL.stats.through++;
  if (PAL.loading || quiet) { siegeOnBreach(W); return W; } // put back from a save, or an old gap grown wider: no dust, no crash, no news
  for (let i = 0; i < 6; i++) later(i * 0.12, () => FX.dust(W.wx + W.wax * (Math.random() - 0.5) * W.half * 2, S.y + Math.random() * WALL_H, W.wz + W.waz * (Math.random() - 0.5) * W.half * 2, 14, wallLit([0.2, 0.18, 0.16])));
  const Pl = GAME.player;
  sfxAt('timberfall', W.wx, null, W.wz); // [audio2] the burnt logs fall (11c_sound.js)
  if (Pl && dist2(Pl.x, Pl.z, W.wx, W.wz) < 90 * 90) cameraShake(0.3, W.wx, W.wz);
  const K = S.keepRef;
  if (K && GAME.t > (P.newsAt || -1e9)) { P.newsAt = GAME.t + PAL_T.news; news(`The palisade of ${S.name} has burnt through!`, K.realm, K.realm === (Pl && Pl.faction) ? 'alarm' : 'normal'); }
  siegeOnBreach(W); // the garrison runs to hold the gap (04h_siege.js)
  return W;
}
// the palisade's own boxes (tag wall, on its middle line) standing over [a0, a1] along wall `side`: the first ones of
// the keep's colliders, or the pieces a breach or an earlier gap cut them into
function palisadeWallColls(P, side, a0, a1) {
  const S = P.S, out = new Set();
  for (let a = a0 + 0.2; a <= a1 - 0.2 + 1e-6; a += 0.5) {
    const l = palisadeLocal(side, a, 0), w = siteToWorld(S, l.x, l.z);
    collidersNear(w.x, w.z, 1.5, _palC);
    for (const c of _palC) {
      if (!c.active || c.tag !== 'wall' || c.type !== 'box' || out.has(c)) continue;
      const lc = siteLocal(S, c.x, c.z), off = side === 0 || side === 3 ? lc.z - l.z : lc.x - l.x;
      if (Math.abs(off) > 0.7) continue;
      const cA = side === 0 || side === 3 ? lc.x : lc.z, ext = side === 1 || side === 2 ? c.hz : c.hx;
      if (Math.abs(a - cA) <= ext) out.add(c);
    }
  }
  return [...out];
}
const _palC = [];
// the burnt logs: charred stumps standing in the gap, logs fallen across it and out on both sides, ash
function palisadeWreckGeo(W) {
  const C = W.C, b = new Batch(), M = C.M, r = mulberry(Math.round(Math.abs(W.wx * 37 + W.wz * 13)) + 11);
  const at = (u, v) => palisadeLocal(W.side, (W.a0 + W.a1) / 2 + u, v);
  const coal = () => [0.05 + r() * 0.04, 0.045 + r() * 0.03, 0.04 + r() * 0.025];
  const n = Math.max(3, Math.round((W.a1 - W.a0) / 0.5));
  for (let i = 0; i < n; i++) {
    const u = -W.half + (i + 0.5) * (2 * W.half / n), p = at(u + (r() - 0.5) * 0.12, (r() - 0.5) * 0.12), h = PAL_T.cut * (0.5 + 0.9 * r());
    b.add(G.cyl8, lm(M, p.x, h / 2 - 0.1, p.z, r() * TAU, 0.24, h + 0.2, 0.24, (r() - 0.5) * 0.15, (r() - 0.5) * 0.15), MAT.logH, coal(), C.S.y, 1.2);
  }
  for (let i = 0; i < Math.round(n * 0.8); i++) {
    const v = (r() < 0.5 ? -1 : 1) * (0.6 + r() * 2.2), u = (r() - 0.5) * W.half * 2, p = at(u, v), L = 1.4 + r() * 2.6;
    b.add(G.cyl8, lm(M, p.x, 0.16 + r() * 0.2, p.z, r() * TAU, 0.2, L, 0.2, Math.PI / 2 + (r() - 0.5) * 0.3), MAT.logH, coal(), C.S.y, 1.2);
  }
  for (let i = 0; i < 10; i++) { const p = at((r() - 0.5) * W.half * 2.2, (r() - 0.5) * 2.4); b.add(G.ico, lm(M, p.x, 0.02, p.z, r() * 3, 0.5 + r() * 0.6, 0.05 + r() * 0.06, 0.4 + r() * 0.5), MAT.darkstone, [0.2 + r() * 0.06, 0.19 + r() * 0.05, 0.18 + r() * 0.05]); }
  return b.build();
}
// [look3] a putlog scaffold along the outside of the gap (look3Scaffold, 04d_look3.js: standards, ledgers, putlogs, a
// floor of boards at each lift with its rail, braces, ladders) and fresh logs waiting at its foot. Version 13's were six
// poles and two boards on edge to the eye, and every other log lay 0.4 m up in the air
function palisadeScaffoldGeo(W) {
  const C = W.C, b = new Batch(), M = C.M, st = C.st, S = C.S;
  const at = (u, v) => palisadeLocal(W.side, (W.a0 + W.a1) / 2 + u, v), yaw = W.side === 0 || W.side === 3 ? Math.PI / 2 : 0;
  const deep = 0.9, off = 0.5 + deep + 0.08, len = 2 * W.half + 1.2, n = Math.max(2, Math.ceil(len / 2.1)) + 1;
  const q0 = at(0, 0), q1 = at(0, 1), inx = q0.x - q1.x, inz = q0.z - q1.z, pts = [], ins = [];
  for (let i = 0; i < n; i++) { const p = at(-len / 2 + (len * i) / (n - 1), off); pts.push([p.x, p.z]); ins.push([inx, inz]); }
  const gy = (x, z) => { const w = siteToWorld(S, x, z); return heightAt(w.x, w.z) - S.y; };
  const clear = (x, z, r = 0.2) => { const w = siteToWorld(S, x, z); return look3Clear(w.x, w.z, r); };
  W.scafInfo = look3Scaffold(b, M, pts, ins, { lifts: [2.0, 4.0, 6.0], top: 7.35, deep, gy, clear, pole: st.logs, wood: st.wood, baseY: S.y, seed: Math.round(Math.abs(W.wx * 11 + W.wz * 5)) });
  look3ScaffoldDrop(W); look3ScaffoldWorld(W, S, [W.scafInfo]); // its boards are floors and its ladders are climbed while it stands
  // the new logs, peeled pale, lying side by side on the ground beyond the scaffold (and one across two of them)
  for (let i = 0; i < 4; i++) {
    const p = at(0.2 * (i % 2), off + 1.3 + (i < 3 ? i * 0.46 : 0.23));
    if (!clear(p.x, p.z, 0.3)) continue;
    b.add(G.cyl8, lm(M, p.x, gy(p.x, p.z) + 0.22 + (i === 3 ? 0.38 : 0), p.z, yaw + (i === 3 ? 0.06 : 0), 0.22, 3.2, 0.22, Math.PI / 2), MAT.logH, darker(st.logs, 1.25));
  }
  return b.build();
}
// a gap built back: the colliders close again, the scaffold comes down
function palisadeGapClose(P, W) {
  for (const q of W.colls) { q.mid.active = true; }
  if (W.wreck) { W.wreck.removeFromParent(); W.wreck.geometry.dispose(); shadowDrop(W.wreck); } // [perf2] and its shadow (02_render.js)
  if (W.scaffold) { W.scaffold.removeFromParent(); W.scaffold.geometry.dispose(); shadowDrop(W.scaffold); }
  look3ScaffoldDrop(W); // [look3] its floors and ladders go with it (04d_look3.js)
  W.state = 'whole';
  P.gaps.splice(P.gaps.indexOf(W), 1);
  siegeOnRepair(W);
  PAL.stats.rebuilt++;
}

// burnt-out fires let go before new ones are added (drawFires does it each frame, but a long simulate piles them up
// against addFire's cap of 40 timed fires): the palisades' and the towers' flames (04n_towerfire.js)
const PAL_FLAMES = 3; // [v13] the flames a burning stretch keeps
function fireLetGo() {
  if (FIRES.length > 30) for (let i = FIRES.length - 1; i >= 0; i--) if (FIRES[i].until < GAME.t) FIRES.splice(i, 1);
}
// each step (updateSiege asks)
function updatePalisades(dt) {
  if (!PAL.ready) { palisadeInit(); if (!PAL.ready) return; }
  const wet = clamp(U.uWet.value, 0, 1) * (0.4 + 0.6 * clamp(WEATHER.raining || 0, 0, 1)) + clamp(U.uSnowCover.value, 0, 1) * 0.3;
  for (const P of PAL.list) {
    let busy = false;
    for (const c of P.cells) {
      if (c.fresh > 0) { const was = c.fresh; c.fresh = Math.max(0, c.fresh - dt / PAL_T.fresh); if (Math.floor(was * 30) !== Math.floor(c.fresh * 30)) PAL.dirty.add(P); }
      if (c.st === 1) { busy = true; palisadeBurnStep(c, dt, wet); }
      else if (c.st === 3 && c.ember > 0) { const was = c.ember; c.ember = Math.max(0, c.ember - dt / PAL_T.ember * (1 + 2 * clamp(WEATHER.raining || 0, 0, 1))); if (Math.floor(was * 30) !== Math.floor(c.ember * 30)) PAL.dirty.add(P); }
    }
    // cells burnt through: gather them into gaps (neighbours on the same wall in one gap)
    const loose = P.cells.filter((c) => c.st === 3 && !c.gap);
    for (const c of loose) {
      if (c.gap) continue;
      const run = [c];
      for (let k = 0; k < run.length; k++) for (const o of run[k].nb) if (o.st === 3 && !o.gap && !run.includes(o)) run.push(o);
      // a gap that already lies next to it takes it in: closed and opened again, wider
      const old = P.gaps.find((W) => W.side === c.side && W.state === 'breach' && run.some((q) => q.nb.some((o) => W.cells.includes(o))));
      if (old) { for (const q of old.cells) q.gap = null; run.push(...old.cells); palisadeGapClose(P, old); PAL.stats.rebuilt--; }
      const W = palisadeGapOpen(P, run, !!old);
      for (const q of run) q.gap = W;
      PAL.dirty.add(P);
    }
    for (const W of P.gaps) if (W.wmat) { const em = Math.max(...W.cells.map((c) => c.ember)); W.wmat.uniforms.uEmber.value = em * 0.8; W.wmat.uniforms.uSnowCover.value = U.uSnowCover.value * clamp(1 - em * 1.6, 0, 1); }
    // in peace its owners build it back: gaps behind scaffolding, charred logs replaced
    const K = P.S.keepRef, calm = !!K && GAME.t - K.lastEnemyNear > PAL_T.quiet, quiet = !busy && calm;
    for (const W of P.gaps.slice()) {
      // a gap is built back while no foe is near and no fire burns along its wall within a few strides of it
      if (!calm || (busy && P.cells.some((c) => c.st === 1 && c.side === W.side && c.a1 > W.a0 - 6 && c.a0 < W.a1 + 6))) { W.quiet = 0; continue; }
      W.quiet += dt;
      if (W.state === 'breach' && W.quiet > 2) { W.state = 'repair'; W.t = 0; W.scaffold = new THREE.Mesh(palisadeScaffoldGeo(W), buildingMat); W.scaffold.renderOrder = 1; scene.add(W.scaffold); shadowCaster(W.scaffold, BUILDING_DEPTH); siegeOnRepair(W); }
      if (W.state === 'repair') {
        const was = W.t;
        W.t = Math.min(1, W.t + dt / PAL_T.rebuild);
        if (W.t > 0.12 && W.wreck && W.wreck.visible) W.wreck.visible = false;
        for (const c of W.cells) { c.fresh = Math.min(1, W.t * 3); c.char = Math.max(0, 1 - W.t * 2.5); c.ember = 0; }
        if (Math.floor(was * 60) !== Math.floor(W.t * 60)) PAL.dirty.add(P);
        if (W.t >= 1) { for (const c of W.cells) { c.st = 0; c.gap = null; c.heat = 0; c.char = 0; c.fresh = 1; } palisadeGapClose(P, W); const K2 = P.S.keepRef; if (K2) news(`${P.S.name} has rebuilt its palisade.`, K2.realm, 'normal'); PAL.dirty.add(P); }
      }
    }
    if (quiet) for (const c of P.cells) if (c.st === 2 && !c.gap) {
      // a stretch that burnt and stood: its charred logs are taken down and new ones set in their place
      c.mend = (c.mend || 0) + dt;
      if (c.mend > 8) { c.st = 0; c.char = 0; c.heat = 0; c.fresh = 1; c.mend = 0; PAL.dirty.add(P); }
    }
  }
  if (PAL.dirty.size) { for (const P of PAL.dirty) palisadeUpload(P); PAL.dirty.clear(); }
}
function palisadeBurnStep(c, dt, wet) {
  c.t += dt;
  // rain damps it: a young fire goes out in a downpour, a grown one only burns slower
  c.heat = clamp(c.heat + dt * (1 / PAL_T.climb) * (1 - 1.5 * wet), 0, 1);
  c.char = Math.max(c.char, clamp(c.t / PAL_T.burn, 0, 1) * 0.9 + c.heat * 0.1);
  const P = c.P, S = P.S;
  if (c.heat <= 0) { for (const f of c.fires) f.until = GAME.t; c.fires = []; c.st = c.char > 0.15 ? 2 : 0; PAL.stats.out++; PAL.dirty.add(P); return; }
  if (GAME.t > c.tick) {
    c.tick = GAME.t + 1.0;
    c.fires = c.fires.filter((f) => f.until > GAME.t);
    // [v13] three flames a stretch at most: seven stretches alight at five each filled addFire's cap of timed fires,
    // and a stretch that let its flames go could not light them again (siege2.py's catch found it with 0 flames)
    const spots = palisadeSpots(c), want = Math.round(1 + c.heat * (Math.min(PAL_FLAMES, spots.length) - 1)), top = 1 + c.heat * (WALL_H + 0.5);
    let lit = c.fires.length;
    // (the burnt-out fires are let go first: drawFires does it each frame, but a long simulate (tests) piles them up
    // against addFire's cap of timed fires; and a fire addFire did not add is no fire of this cell's)
    fireLetGo();
    for (const s of spots) {
      if (lit >= want) break;
      if (s.y > top || s.lit > GAME.t) continue;
      s.lit = GAME.t + 4;
      const n0 = FIRES.length;
      addFire(s.x, S.y + s.y, s.z, s.s * (0.7 + 0.5 * c.heat), false, GAME.t + 4.2, c.fires.length ? null : { r: 8, k: 1.2 });
      if (FIRES.length > n0) c.fires.push(FIRES[FIRES.length - 1]);
      lit++;
    }
    // it spreads along the wall to the logs either side
    // (a few stretches either way from where it took hold: further on the logs are wetter, the gaps between them wider)
    if (c.heat > 0.45 && (c.gen || 0) < PAL_T.reach) for (const o of c.nb) if (o.st === 0 && Math.random() < (1 / PAL_T.spread) * c.heat * (1 - wet)) { palisadeIgnite(o, 0.1, (c.gen || 0) + 1); PAL.stats.spread++; }
    // the keep's own people beat out the flames within reach (their faces to it, buckets and wet hides)
    const K = S.keepRef;
    let dousers = 0;
    if (K) forNear(c.x, c.z, 3.5, (o) => { if (dousers < 3 && o.alive && o.faction === K.realm && isActor(o) && o.role !== 'player' && !o.flying && o.y < S.y + WALL_H) dousers++; });
    if (dousers) { c.heat = Math.max(0, c.heat - PAL_T.douse * dousers); PAL.stats.doused = (PAL.stats.doused || 0) + 1; if (c.heat <= 0) { for (const f of c.fires) f.until = GAME.t; c.fires = []; c.st = c.char > 0.15 ? 2 : 0; PAL.stats.out++; PAL.dirty.add(P); return; } }
    // whoever stands against it, or on the walk behind it, is burnt
    forNear(c.x, c.z, 2.2, (o) => {
      if (!o.alive || o.kind === 'door' || o.flying || o.y > S.y + WALL_H + 1) return;
      const l = siteLocal(S, o.x, o.z), q = palisadeLocal(c.side, c.a, 0);
      const along = c.side === 0 || c.side === 3 ? l.x - q.x : l.z - q.z, across = c.side === 0 || c.side === 3 ? l.z - q.z : l.x - q.x;
      if (Math.abs(along) > (c.a1 - c.a0) / 2 + 0.3 || Math.abs(across) > 1.4 + (o.y > S.y + 3 ? 0.6 : 0)) return;
      addBuff(o, 'burn', o.maxHp * PAL_T.harm * c.heat, 2, null);
      PAL.stats.harm++;
    });
    if (Math.random() < 0.3 * c.heat) { PAL.sparking = true; fireLandsAt(c.x + (Math.random() - 0.5) * 5, S.y + 0.4, c.z + (Math.random() - 0.5) * 5, 1.0, null); PAL.sparking = false; } // embers set the grass alight
    // at the end of a wall, where its logs meet a tower's, the fire takes the tower too (and a burning tower's embers the wall)
    if (c.heat > 0.6 && c.nb.length < 2 && Math.random() < 0.12 * c.heat) {
      const end = c.nb.length && c.nb[0].a < c.a ? c.a1 + 0.5 : c.a0 - 0.5, l = palisadeLocal(c.side, end, 0), p = siteToWorld(S, l.x, l.z);
      towerFireAt(p.x, S.y + 3, p.z, 1.0, null);
    }
    PAL.dirty.add(P);
  }
  if (c.t >= PAL_T.burn) {
    // burnt through: its logs fall in
    for (const f of c.fires) f.until = GAME.t;
    c.fires = []; c.st = 3; c.ember = 1; c.char = 1; c.heat = 0;
    PAL.dirty.add(P);
  }
}

// the castle shader's view of the palisade: zones of burning, charred, burnt-through and rebuilding stretches
function palisadeUpload(P) {
  const U3 = P.C.cutU;
  if (!U3 || !U3.uPA) return;
  const S = P.S;
  U3.uPS.value.set(S.x, S.z, Math.cos(S.yaw), Math.sin(S.yaw));
  U3.uPY.value.set(S.y, 0, 0, 0);
  // runs of cells on the same wall in the same kind of state
  const zones = [];
  let cur = null;
  const cls = (c) => (c.st === 3 ? (c.gap && c.gap.state === 'repair' ? 'r' : 'g') : c.st === 1 || c.st === 2 || c.char > 0.02 ? 'b' : c.fresh > 0.02 ? 'f' : null);
  for (const c of P.cells) {
    const k = cls(c);
    if (!k) { cur = null; continue; }
    if (cur && cur.k === k && cur.side === c.side && Math.abs(cur.a1 - c.a0) < 0.05) { cur.a1 = c.a1; cur.cells.push(c); continue; }
    cur = { k, side: c.side, a0: c.a0, a1: c.a1, cells: [c] };
    zones.push(cur);
  }
  const pri = { g: 0, r: 0, b: 1, f: 2 };
  zones.sort((a, b) => pri[a.k] - pri[b.k]);
  for (let i = 0; i < PZ_MAX; i++) {
    const z = zones[i];
    if (!z) { U3.uPA.value[i].set(0, 0, 0, 0); U3.uPB.value[i].set(0, 1e5, 0, 0); continue; }
    const ch = Math.max(...z.cells.map((c) => c.char)), gl = Math.max(...z.cells.map((c) => (c.st === 1 ? c.heat : c.ember * 0.85))), fr = Math.max(...z.cells.map((c) => c.fresh));
    let cut = 1e5;
    if (z.k === 'g') cut = S.y + PAL_T.cut;
    else if (z.k === 'r') { const W = z.cells[0].gap; cut = S.y + lerp(PAL_T.cut, WALL_H + 1.5, smooth(W ? W.t : 1)); }
    U3.uPA.value[i].set(z.side, z.a0, z.a1, clamp(ch, 0, 1));
    U3.uPB.value[i].set(clamp(gl, 0, 1), cut, clamp(fr, 0, 1), 0);
  }
}
// E with a burning brand by the palisade of a burh
function palisadeFireOffers(P, offer) {
  if (!P.brand || P.motion) return;
  const c = palisadeCellAt(P.x, P.y + 1.2, P.z, 1.4);
  if (!c || c.st !== 0 && c.st !== 2) return;
  offer(0.3, 1.8, 'Set the palisade alight', () => { palisadeIgnite(c); }, 0.12);
}

// save part world.x.palisade: each burh's cells that burn, stand charred, lie burnt through or are being rebuilt
queueMicrotask(() => registerSavePart('world', 'palisade', {
  save() {
    if (!PAL.ready) return undefined;
    const out = [];
    PAL.list.forEach((P, pi) => P.cells.forEach((c, ci) => {
      if (c.st === 0 && c.fresh <= 0.02) return;
      const st = c.st === 3 && c.gap && c.gap.state === 'repair' ? 4 : c.st;
      out.push([pi, ci, st, Math.round(c.char * 100), Math.round((st === 1 ? c.t : st === 4 ? c.gap.t : c.fresh) * 100)]);
    }));
    return out.length ? out : undefined;
  },
  load(d) {
    if (!Array.isArray(d)) return;
    palisadeInit();
    const rep = new Map();
    for (const q of d.slice(0, 400)) {
      if (!Array.isArray(q)) continue;
      const P = PAL.list[q[0] | 0], c = P && P.cells[q[1] | 0], st = q[2] | 0, v = +q[4] / 100;
      if (!c || !isFinite(v) || st < 0 || st > 4) continue;
      c.char = clamp(+q[3] / 100 || 0, 0, 1);
      if (st === 0) c.fresh = clamp(v, 0, 1);
      else if (st === 1) { palisadeIgnite(c, 0.3); c.t = clamp(v, 0, PAL_T.burn - 1); c.heat = clamp(c.t / PAL_T.climb, 0.15, 1); }
      else if (st === 2) c.st = 2;
      else { c.st = 3; c.ember = 0; if (st === 4) rep.set(c, clamp(v, 0, 0.99)); }
    }
    // the gaps open again as they were (updatePalisades gathers them), and those being rebuilt go on from where they were
    PAL.loading = true;
    try { updatePalisades(0); } finally { PAL.loading = false; }
    for (const [c, t] of rep) if (c.gap && c.gap.state === 'breach') { const W = c.gap; W.state = 'repair'; W.t = t; W.scaffold = new THREE.Mesh(palisadeScaffoldGeo(W), buildingMat); W.scaffold.renderOrder = 1; scene.add(W.scaffold); }
    for (const P of PAL.list) palisadeUpload(P);
  },
  key(d) { return d ? d.map((q) => q[0] * 1000 + q[1] * 10 + q[2]).join(',') : ''; },
}));
queueMicrotask(() => { if (window.__hm) window.__hm.palisade = { PAL, PAL_T, palisadeInit, palisadeCellAt, palisadeFireAt, palisadeFireCone, palisadeIgnite, palisadeGaps, updatePalisades, palisadeUpload, palisadeFireOffers }; });
