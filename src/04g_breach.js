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
// (the fall's harm by its height). The garrison's archer posted on its top falls with it. Bands storm it as a breach
// (siegeOpenBreach, siegeBreachRoute: in over the rubble, through the store room and out at its courtyard door); the
// garrison runs to hold it (siegeOnBreach). Once the keep has been quiet a while its owners put up scaffolding and
// build it back course by course (updateBreaches), the new stone pale for a time, and the rooms, ladders, doors,
// hatches, torches, banners and the archer's post come back (castleRepairDone). Saved with the walls (world.land).
// Engines: trebuchets may take a tower for their mark (siegePlanFor); mangonels keep to the curtains.

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
        if (A.z <= 0.0) continue;
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
      for (const c of T.colls) {
        const l = siteLocal(S, c.x, c.z), a = Math.atan2(l.x - T.cx, l.z - T.cz), top = c.y0 + c.h;
        if (Math.abs(angDiff(a, aOut)) < gapA + sec * 0.55 && top > S.y + W.rubble) W.colls.push(c);
        else if (c.y0 >= S.y + cutY - 0.05) W.colls.push(c);
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
      W.wreck = new THREE.Mesh(towerRubbleGeo(W), buildingMat); W.wreck.visible = false; W.wreck.renderOrder = 1; scene.add(W.wreck);
      W.scaffold = new THREE.Mesh(towerScaffoldGeo(W), buildingMat); W.scaffold.visible = false; W.scaffold.renderOrder = 1; scene.add(W.scaffold);
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
    const [x, z] = at(u, v), s = 0.25 + 0.42 * r();
    b.add(G.ico, lm(M, x, T.yG + h * (0.55 + 0.3 * r()), z, r() * TAU, s * 1.3, s * 0.75, s, r() * 0.6, r() * 0.6), MAT.stone, darker(st.stone, 0.66 + 0.3 * r()), C.S.y, 1.5);
  }
  // squared blocks of the face, tumbled
  for (let i = 0; i < 14; i++) {
    const u = T.RO - 1.2 + r() * 3.6, v = (r() - 0.5) * 3.2, [x, z] = at(u, v);
    b.add(G.box, lm(M, x, T.yG + 0.3 + r() * 0.5, z, r() * TAU, 0.55 + 0.35 * r(), 0.4 + 0.2 * r(), 0.45 + 0.3 * r(), (r() - 0.5) * 0.8, (r() - 0.5) * 0.8), MAT.stone, darker(st.stone, 0.72 + 0.25 * r()));
  }
  // the guard room's beams and boards, broken, in the heap inside
  for (let i = 0; i < 6; i++) {
    const u = (r() - 0.3) * T.RI, v = (r() - 0.5) * T.RI, [x, z] = at(u, v);
    b.add(G.box, lm(M, x, T.yG + 0.5 + r() * 0.7, z, r() * TAU, 0.18, 0.16, 1.2 + r() * 1.4, (r() - 0.5) * 0.9, (r() - 0.5) * 0.4), MAT.wood, darker(st.wood, 0.55 + 0.25 * r()));
  }
  // the broken ends of the drum either side of the V: ragged courses stepping down into the gap
  for (const sd of [-1, 1]) for (let k = 0; k < 6; k++) {
    const t = k / 5, a = W.aOut + sd * (W.vHalf + 0.05 + t * 0.35), rr = (T.RI + T.RO) / 2;
    const x = T.cx + Math.sin(a) * rr, z = T.cz + Math.cos(a) * rr, y = lerp(W.rubble + 0.15, W.cutY - 0.6, t);
    b.add(G.box, lm(M, x, y, z, a, 0.7 + 0.3 * r(), 0.45 + 0.25 * r(), T.RO - T.RI + 0.1, (r() - 0.5) * 0.2, (r() - 0.5) * 0.25), MAT.stone, darker(st.stone, 0.74 + 0.22 * r()));
  }
  return b.build();
}
// poles round the drum's face, two lifts of boards, a hoist and new-cut stone at its foot
function towerScaffoldGeo(W) {
  const T = W.T, C = W.C, b = new Batch(), M = C.M, st = C.st, Hh = W.top + 1.2, R = T.RO + 0.5;
  const ring = [-1.1, -0.55, 0, 0.55, 1.1];
  for (const da of ring) { const a = W.aOut + da, x = T.cx + Math.sin(a) * R, z = T.cz + Math.cos(a) * R; b.add(G.cyl8, lm(M, x, Hh / 2, z, 0, 0.09, Hh, 0.09), MAT.logH, st.logs, C.S.y, 3); }
  for (const y of [W.top * 0.36, W.top * 0.72]) for (let i = 0; i + 1 < ring.length; i++) {
    const a0 = W.aOut + ring[i], a1 = W.aOut + ring[i + 1], am = (a0 + a1) / 2, L = 2 * R * Math.sin((a1 - a0) / 2);
    const x = T.cx + Math.sin(am) * R * Math.cos((a1 - a0) / 2), z = T.cz + Math.cos(am) * R * Math.cos((a1 - a0) / 2);
    b.add(G.cyl8, lm(M, x, y, z, am + Math.PI / 2, 0.06, L + 0.2, 0.06, Math.PI / 2), MAT.logH, st.logs);
    const xi = T.cx + Math.sin(am) * (R - 0.32), zi = T.cz + Math.cos(am) * (R - 0.32);
    b.add(G.box, lm(M, xi, y + 0.08, zi, am, L + 0.1, 0.06, 0.62), MAT.wood, darker(st.wood, 1.1));
  }
  // a hoist's mast and boom, and fresh stone waiting
  const a = W.aOut + 1.5, x = T.cx + Math.sin(a) * (R + 0.9), z = T.cz + Math.cos(a) * (R + 0.9);
  b.add(G.cyl8, lm(M, x, (W.top + 2) / 2, z, 0, 0.11, W.top + 2, 0.11), MAT.logH, st.logs, C.S.y, 3);
  b.add(G.cyl8, lm(M, x - Math.sin(a) * 1.0, W.top + 1.6, z - Math.cos(a) * 1.0, a, 0.07, 2.4, 0.07, Math.PI / 2 - 0.3), MAT.logH, st.logs);
  for (let i = 0; i < 4; i++) { const aa = W.aOut - 1.6 + i * 0.22, xx = T.cx + Math.sin(aa) * (R + 1.3), zz = T.cz + Math.cos(aa) * (R + 1.3); b.add(G.box, lm(M, xx, T.yG + 0.25 + (i % 2) * 0.5, zz, aa, 0.6, 0.48, 0.9), MAT.stone, darker(st.stone, 1.18)); }
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
  for (const K of TOWER.keeps) if (K.C === T.C) K.dirty = true;
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
  for (let i = 0; i < 8; i++) later(i * 0.1, () => FX.dust(T.wx + W.ox * T.RO * (0.5 + Math.random()), S.y + W.rubble + Math.random() * (T.TT - W.rubble), T.wz + W.oz * T.RO * (0.5 + Math.random()), 18, [0.44, 0.41, 0.37]));
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
// hits from castleSiegeHit on a tower are counted (the shared damage is the section's)
queueMicrotask(() => { if (window.__hm) window.__hm.breach = { TBREACH, list: () => TBREACH.list, sync: towerBreachSync, upload: towerBreachUpload }; });
