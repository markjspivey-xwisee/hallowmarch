/* ================================================================== */
/* siege: rams, mangonels and trebuchets; breaches, plugs and sallies  */
/* ================================================================== */
// Warbands build siege engines in front of the castles they attack. A covered ram is pushed up to the gate by its
// crew and swung into the leaves on its slings; a mangonel's arm is wound back on a windlass and thrown against
// its padded stop; a trebuchet's arm is hauled down, its counterweight dropped, and its sling whips the stone
// round. Stones fly on real arcs and crack wall sections (castleSiegeHit) until they fall into a breach, or batter
// the gate. Engines are real targets: hacked apart in melee, or set alight by fire (they char and fall in). The
// garrison rushes to hold a breach, and sallies out through its own gate when that pays. The player can join a
// crew or take over an abandoned engine. The shared files only call in, each line marked [siege]:
//   04g_castles.js updateCastles -> updateSiege · castleBreach -> siegeOnBreach · castleRepairDone -> siegeOnRepair
//                  updateGate -> a sally holds its own gate open
//   04e_houses.js  fireLandsAt -> siegeFireAt · fireConeAt -> siegeFireCone
//   08_ai.js       onEntityKilled -> siegeEngineKilled · thinkPosted -> siegePostedThink (sallies, breach plugs)
//                  thinkSoldier -> siegeCrewThink, siegeLikePhase, siegeFoeEngine · updateWarband -> siegeBandAfter
//   08g_campaign.js cwChoose / planWar -> siegeDanger · order and phase words
//   09_player.js   currentInteraction -> siegeOffers · 10_ui.js engine names

const SIEGE = { engines: [], stones: [], nextId: 1, parts: new Map(), pool: [], force: null, sallyNext: new Map(),
  stats: { built: 0, rams: 0, mangonels: 0, trebuchets: 0, shots: 0, wallHits: 0, gateHits: 0, ramHits: 0, breaches: 0, burnt: 0, broken: 0, sallies: 0, plugs: 0, breachAssaults: 0, playerCrew: 0 } };
// hp: share of a keep gate's; range: metres from the wall face; reload: seconds with a full crew; mult: wall damage per stone
const SIEGE_SPEC = {
  ram: { label: 'battering ram', crew: 4, speed: 1.35, hp: 0.34, radius: 2.4, build: 11, wheels: true },
  mangonel: { label: 'mangonel', crew: 3, speed: 1.1, hp: 0.26, radius: 2.4, build: 20, range: 44, reload: 7.5, mult: 2.6, stone: 0.3, wheels: true, box: [1.0, 2.5, 0] },
  trebuchet: { label: 'trebuchet', crew: 4, speed: 0, hp: 0.42, radius: 3.4, build: 28, range: 70, reload: 11, mult: 4.4, stone: 0.42, wheels: false, box: [1.35, 3.75, -0.3] },
};
const SIEGE_MAX = () => (quality.level === 'low' ? 3 : quality.level === 'medium' ? 5 : 6);
const RAM_REACH = 3.98, RAM_PIVOT_Y = 2.62, RAM_ROPE = 1.42, RAM_LOG_Z = 0.35;
const MANG_PIVOT = [1.05, -0.3], MANG_REST = 2.2, MANG_COCK = 0.28;
const TREB_AXLE = 4.6, TREB_LONG = 5.6, TREB_SHORT = 1.75, TREB_SLING = 3.3, TREB_COCK = -0.8;
const SG_I = new THREE.Matrix4();
const _sgv = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* the engines' material: the building shader, charred and smouldering */
/* ------------------------------------------------------------------ */
const SIEGE_FS = (() => {
  let fs = buildingMat.fragmentShader;
  const pre = 'void main(){', lit = 'vec3 col = lightSurface(alb, n, vAO);';
  if (!fs.includes(pre) || !fs.includes(lit)) return fs; // the building shader changed: engines lose their char, nothing else
  fs = fs.replace(pre, `uniform float uChar, uEmber; float gEmb = 0.0, gEmbId = 0.0;\n    ${LOOK4_CHAR_GLSL /* [look4] (04d_look4.js) */}\n    ${pre}`);
  fs = fs.replace(lit, /* glsl */`
      if (uChar > 0.002 && m != 6 && m != 9) { // [look6] ash (darkstone) is not charred: the heaps of ash round a wreck were drawn as coal
        // fire eats the timber from the edges in: grain gone to charcoal, split into checks that glow while it burns.
        // [look4] On the face's own coordinates, the checks blocks across and along the grain (look4Char, 04d_look4.js):
        // contour lines of a noise of (x + y, z + y) laid the char and the embers in long diagonal streaks on a gate's leaves
        vec3 ck = look4Char(uv);
        float cg = vnoise(uv * 1.9) * 0.55 + vnoise(uv * 7.0 + 3.1) * 0.45;
        float ch = smoothstep(0.0, 0.3, uChar * 1.45 - cg * 0.62);
        vec3 coal = vec3(0.05, 0.043, 0.037) * (0.6 + 0.6 * ck.y + 0.3 * vnoise(uv * 13.0)) * clamp(dot(alb, vec3(0.3, 0.59, 0.11)) / max(dot(vCol, vec3(0.3, 0.59, 0.11)), 0.05), 0.4, 1.6); // (the planks' seams kept)
        alb = mix(alb, coal, ch);
        alb *= 1.0 - 0.6 * ck.x * ch;
        // [look6] burnt timber lying open to the sky wears a coat of pale ash on what faces up, checked by the char's
        // fissures: from a step back a burh's walk burnt through left one black smear below it (the checks fade to their
        // mean under a pixel, and the mean is charcoal)
        float ashK = ch * smoothstep(0.55, 0.9, n.y) * (0.45 + 0.4 * vnoise(uv * 2.3 + 1.7));
        alb = mix(alb, vec3(0.31, 0.3, 0.29) * (0.75 + 0.5 * ck.y), ashK * (1.0 - 0.8 * ck.x));
        gEmb = ch * (0.04 + 0.95 * ck.x + 0.12 * (1.0 - ck.z)) * (1.0 - 0.7 * ashK); gEmbId = ck.y;
      }
      if (uChar > 0.002 && m == 6) alb *= 1.0 - 0.6 * uChar;
      ${lit}
      if (uEmber > 0.002) col += vec3(2.0, 0.62, 0.13) * uEmber * gEmb * (0.55 + 0.45 * sin(uTime * 5.3 + gEmbId * 37.0)) * smoothstep(0.45, 0.8, vnoise(uv * 1.4 + vec2(uTime * 0.3, 0.0)));`);
  return fs;
})();
const siegeMat = mat({ vertexShader: buildingMat.vertexShader, fragmentShader: SIEGE_FS, uniforms: { uFlash: { value: 0 }, uChar: { value: 0 }, uEmber: { value: 0 } } });

/* ------------------------------------------------------------------ */
/* models: built in code, in each engine's frame (+z toward the target) */
/* ------------------------------------------------------------------ */
function sgBeam(b, ax, ay, az, bx, by, bz, w, h, matId, col) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  b.add(G.box, lm(SG_I, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, Math.atan2(dx, dz), w, h, L, -Math.atan2(dy, Math.hypot(dx, dz))), matId, col);
}
const sgCylX = (b, x, y, z, r, len, matId, col, seg = G.cyl12) => b.add(seg, lm(SG_I, x, y, z, 0, r, len, r, 0, Math.PI / 2), matId, col);
// a cart wheel turning about x: hub, twelve felloes with an iron tyre, six spokes; or a solid plank wheel
function sgWheelGeo(r, w, wood, solid) {
  const b = new Batch(), iron = [0.24, 0.24, 0.26];
  sgCylX(b, 0, 0, 0, 0.13, w + 0.14, MAT.wood, darker(wood, 0.75));
  sgCylX(b, 0, 0, 0, 0.055, w + 0.32, MAT.metal, iron, G.cyl8);
  if (solid) {
    sgCylX(b, 0, 0, 0, r - 0.03, w, MAT.wood, wood, G.cyl16);
    sgCylX(b, 0, 0, 0, r, w * 0.55, MAT.metal, iron, G.cyl16);
    for (const sd of [-1, 1]) b.add(G.box, lm(SG_I, sd * (w / 2 + 0.02), 0, 0, 0, 0.05, 0.13, r * 1.7), MAT.wood, darker(wood, 0.8));
    return b.build();
  }
  const n = 12, seg = 2 * r * Math.sin(Math.PI / n) + 0.03;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TAU;
    b.add(G.box, lm(SG_I, 0, Math.cos(a) * (r - 0.07), Math.sin(a) * (r - 0.07), 0, w, 0.12, seg, a), MAT.wood, darker(wood, 0.92 + 0.12 * hash1(i * 3.7)));
    b.add(G.box, lm(SG_I, 0, Math.cos(a) * (r - 0.005), Math.sin(a) * (r - 0.005), 0, w * 0.86, 0.03, seg, a), MAT.metal, iron);
  }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; b.add(G.box, lm(SG_I, 0, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0, 0.07, r - 0.14, 0.07, a), MAT.wood, darker(wood, 0.95)); }
  return b.build();
}
// a stone for the engines: a lumpy ball
const SIEGE_STONE_GEO = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = 0.8 + 0.35 * vnoise(v.x * 2.1 + 3.0, v.y * 2.1 + v.z * 1.7); p.setXYZ(i, v.x * d, v.y * d, v.z * d); }
  g.computeVertexNormals();
  const b = new Batch(); b.add(g, SG_I, MAT.stone, [0.6, 0.58, 0.54]); return b.build();
})();
// a rope: a unit cord along +z from the origin, stretched between two points each frame
const SIEGE_ROPE_GEO = (() => { const b = new Batch(); b.add(G.box, lm(SG_I, 0, 0, 0.5, 0, 0.045, 0.045, 1), MAT.cloth, [0.5, 0.43, 0.3]); return b.build(); })();
function sgPennant(b, x, y0, z, rc, wood) {
  b.add(G.cyl8, lm(SG_I, x, y0 + 0.9, z, 0, 0.04, 1.8, 0.04), MAT.wood, darker(wood, 0.8));
  b.add(G.box, lm(SG_I, x, y0 + 1.6, z - 0.42, 0, 0.025, 0.42, 0.8), MAT.cloth, rc);
  b.add(G.box, lm(SG_I, x, y0 + 1.6, z - 0.88, 0, 0.025, 0.24, 0.16), MAT.cloth, darker(rc, 0.8));
}
function siegeParts(kind, realm) {
  const key = kind + realm;
  if (SIEGE.parts.has(key)) return SIEGE.parts.get(key);
  const R = REALMS[realm], st = STYLE[R.style], rc = R.rgb.map((v) => clamp(v * 0.8, 0, 1));
  const wood = darker(st.wood, 0.95), dark = darker(st.wood, 0.72), iron = [0.26, 0.26, 0.28], rope = [0.52, 0.45, 0.32];
  const out = { kind };
  if (kind === 'ram') {
    const base = new Batch(), upper = new Batch(), log = new Batch(), hide = [0.43, 0.31, 0.21];
    for (const sx of [-1, 1]) base.add(G.box, lm(SG_I, sx * 1.05, 0.66, 0, 0, 0.24, 0.26, 5.3), MAT.wood, wood);
    for (const z of [-2.4, -0.8, 0.8, 2.4]) base.add(G.box, lm(SG_I, 0, 0.66, z, 0, 2.34, 0.2, 0.24), MAT.wood, dark);
    for (const z of [-1.65, 1.65]) for (const sx of [-1, 1]) base.add(G.box, lm(SG_I, sx * 1.12, 0.5, z, 0, 0.16, 0.34, 0.36), MAT.wood, dark); // axle blocks
    for (const sx of [-1, 1]) for (const z of [-2.4, 0, 2.4]) upper.add(G.box, lm(SG_I, sx * 1.05, 1.76, z, 0, 0.2, 2.0, 0.2), MAT.wood, wood);
    for (const sx of [-1, 1]) upper.add(G.box, lm(SG_I, sx * 1.05, 2.82, 0, 0, 0.22, 0.22, 5.2), MAT.wood, dark);
    for (const z of [RAM_LOG_Z - 1.25, RAM_LOG_Z + 1.25]) upper.add(G.box, lm(SG_I, 0, 2.76, z, 0, 2.3, 0.2, 0.22), MAT.wood, dark);
    for (const sx of [-1, 1]) for (const [z0, z1] of [[-2.4, 0], [0, 2.4]]) sgBeam(upper, sx * 1.05, 0.8, z0, sx * 1.05, 2.7, z1, 0.12, 0.12, MAT.wood, darker(dark, 1.1));
    upper.add(G.prism, lm(SG_I, 0, 2.93, 0, Math.PI / 2, 5.6, 1.3, 3.0), MAT.cloth, hide);
    // the hides lie in overlapping strips, lashed down over the rafters
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) sgBeam(upper, sx * 1.52, 2.9, -2.6 + i * 1.04, 0, 4.24, -2.6 + i * 1.04, 0.04, 0.05, MAT.cloth, darker(hide, 0.62));
    upper.add(G.box, lm(SG_I, 0, 4.24, 0, 0, 0.16, 0.12, 5.7), MAT.wood, dark);
    sgPennant(upper, 0.95, 2.95, -2.4, rc, wood);
    log.add(G.cyl12, lm(SG_I, 0, 0, 0, 0, 0.27, 5.6, 0.27, Math.PI / 2), MAT.logH, st.logs);
    log.add(G.cyl8, lm(SG_I, 0, 0, 2.86, 0, 0.36, 0.5, 0.36, Math.PI / 2), MAT.metal, iron);
    log.add(G.cone8, lm(SG_I, 0, 0, 3.32, 0, 0.36, 0.42, 0.36, Math.PI / 2), MAT.metal, darker(iron, 0.85));
    for (const z of [-2.0, -0.6, 1.2, 2.3]) log.add(G.cyl12, lm(SG_I, 0, 0, z, 0, 0.295, 0.1, 0.295, Math.PI / 2), MAT.metal, iron);
    for (const z of [-1.25, 1.25]) log.add(G.box, lm(SG_I, 0, 0.27, z, 0, 0.12, 0.1, 0.16), MAT.metal, iron);
    for (const sx of [-1, 1]) for (const z of [-1.7, 0.05]) log.add(G.box, lm(SG_I, sx * 0.36, -0.03, z, 0, 0.4, 0.06, 0.07), MAT.wood, dark);
    out.base = base.build(); out.upper = upper.build(); out.log = log.build();
    out.wheel = sgWheelGeo(0.5, 0.2, wood, true);
    out.wheels = [[-1.33, 0.5, -1.65], [1.33, 0.5, -1.65], [-1.33, 0.5, 1.65], [1.33, 0.5, 1.65]];
    out.crew = [[-0.62, -1.75], [0.62, -1.75], [-0.62, 0.25], [0.62, 0.25]];
    out.burn = [[0, 3.6, -1.6], [0.6, 3.4, 1.2], [-0.8, 1.6, 0.4], [0.9, 1.0, -2.2]];
  } else if (kind === 'mangonel') {
    const base = new Batch(), upper = new Batch(), arm = new Batch(), drum = new Batch();
    const [py, pz] = MANG_PIVOT;
    for (const sx of [-1, 1]) base.add(G.box, lm(SG_I, sx * 0.86, 0.78, 0, 0, 0.26, 0.3, 4.9), MAT.wood, wood);
    for (const z of [-2.3, -1.05, 0.6, 2.3]) base.add(G.box, lm(SG_I, 0, 0.78, z, 0, 1.98, 0.22, 0.24), MAT.wood, dark);
    for (const z of [-1.55, 1.55]) sgCylX(base, 0, 0.5, z, 0.085, 2.45, MAT.metal, iron, G.cyl8);
    // a wicker basket of stones on the rear beam
    base.add(G.cyl8, lm(SG_I, 1.32, 0.98, -1.05, 0, 0.36, 0.42, 0.36), MAT.thatch, [0.52, 0.42, 0.26]);
    for (let i = 0; i < 4; i++) { const a = i * 1.7; base.add(SIEGE_STONE_GEO, lm(SG_I, 1.32 + Math.cos(a) * 0.15, 1.24 + (i % 2) * 0.08, -1.05 + Math.sin(a) * 0.15, a, 0.17, 0.15, 0.17), MAT.stone, darker([0.6, 0.58, 0.54], 0.9 + 0.06 * i)); }
    // the torsion skein between two cheeks, with its iron washers and the bars that wind it
    for (const sx of [-1, 1]) upper.add(G.box, lm(SG_I, sx * 0.86, py, pz, 0, 0.32, 0.75, 0.58), MAT.wood, dark);
    sgCylX(upper, 0, py, pz, 0.3, 1.42, MAT.cloth, rope);
    for (const sx of [-1, 1]) { sgCylX(upper, sx * 1.05, py, pz, 0.36, 0.08, MAT.metal, iron); upper.add(G.box, lm(SG_I, sx * 1.11, py, pz, 0, 0.06, 0.09, 0.95), MAT.wood, wood); }
    // the stop: two leaning uprights, their braces, a crossbar with a straw cushion
    for (const sx of [-1, 1]) { sgBeam(upper, sx * 0.86, 0.9, 0.95, sx * 0.86, 2.62, 0.5, 0.22, 0.22, MAT.wood, wood); sgBeam(upper, sx * 0.86, 0.9, 2.3, sx * 0.86, 2.3, 0.62, 0.16, 0.16, MAT.wood, dark); }
    sgCylX(upper, 0, 2.5, 0.5, 0.13, 1.98, MAT.wood, dark);
    sgCylX(upper, 0, 2.5, 0.36, 0.21, 0.92, MAT.cloth, [0.6, 0.49, 0.31]);
    for (const sx of [-1, 1]) upper.add(G.box, lm(SG_I, sx * 0.86, 1.12, -2.2, 0, 0.2, 0.62, 0.22), MAT.wood, wood);
    sgPennant(upper, -0.86, 2.62, 0.5, rc, wood);
    // the arm, along +y from the skein, with its iron straps and the cup
    arm.add(G.box, lm(SG_I, 0, 1.25, 0, 0, 0.2, 2.6, 0.24), MAT.wood, wood);
    for (const y of [0.35, 1.35, 2.15]) arm.add(G.box, lm(SG_I, 0, y, 0, 0, 0.235, 0.07, 0.275), MAT.metal, iron);
    arm.add(G.cyl12, lm(SG_I, 0, 2.6, 0.15, 0, 0.4, 0.18, 0.4, Math.PI / 2), MAT.wood, dark);
    arm.add(G.cyl12, lm(SG_I, 0, 2.6, 0.25, 0, 0.42, 0.05, 0.42, Math.PI / 2), MAT.metal, iron);
    arm.add(G.cyl12, lm(SG_I, 0, 2.6, 0.245, 0, 0.3, 0.02, 0.3, Math.PI / 2), MAT.wood, darker(dark, 0.6));
    sgCylX(drum, 0, 0, 0, 0.17, 1.52, MAT.wood, wood);
    for (const sx of [-1, 1]) { drum.add(G.box, lm(SG_I, sx * 0.8, 0, 0, 0, 0.06, 1.25, 0.07), MAT.wood, dark); drum.add(G.box, lm(SG_I, sx * 0.8, 0, 0, 0, 0.06, 0.07, 1.25), MAT.wood, dark); }
    out.base = base.build(); out.upper = upper.build(); out.arm = arm.build(); out.drum = drum.build();
    out.drumAt = [0, 1.06, -2.2];
    out.wheel = sgWheelGeo(0.5, 0.16, wood, false);
    out.wheels = [[-1.1, 0.5, -1.55], [1.1, 0.5, -1.55], [-1.1, 0.5, 1.55], [1.1, 0.5, 1.55]];
    out.crew = [[-1.42, -2.2], [1.42, -2.2], [1.55, -1.0]];
    out.burn = [[0, 1.2, -0.3], [0.5, 2.4, 0.5], [-0.6, 0.9, 1.6], [0.6, 0.9, -1.8]];
  } else {
    const base = new Batch(), upper = new Batch(), arm = new Batch(), cw = new Batch(), drum = new Batch(), pouch = new Batch();
    for (const sx of [-1, 1]) base.add(G.box, lm(SG_I, sx * 1.15, 0.2, -0.3, 0, 0.36, 0.38, 7.4), MAT.wood, wood);
    for (const z of [-3.75, -1.6, 1.0, 3.1]) base.add(G.box, lm(SG_I, 0, 0.2, z, 0, 2.66, 0.32, 0.34), MAT.wood, dark);
    for (const sx of [-1, 1]) base.add(G.box, lm(SG_I, sx * 2.05, 0.17, 0, 0, 0.34, 0.32, 1.3), MAT.wood, dark);
    // the trough the sling lies in
    base.add(G.box, lm(SG_I, 0, 0.3, -1.85, 0, 0.66, 0.06, 4.3), MAT.wood, darker(wood, 0.85));
    // a heap of shaped stones by the rear sill, ready for the sling
    for (let i = 0; i < 9; i++) { const a = i * 2.4, rr = 0.2 + 0.45 * hash1(i * 5.3), k = 0.36 + 0.1 * hash1(i * 9.1); base.add(SIEGE_STONE_GEO, lm(SG_I, 2.3 + Math.cos(a) * rr, k * 0.7 + (i > 6 ? 0.45 : 0), -3.0 + Math.sin(a) * rr, a, k, k * 0.9, k), MAT.stone, darker([0.6, 0.58, 0.54], 0.82 + 0.16 * hash1(i * 3.1))); }
    for (const sx of [-1, 1]) base.add(G.box, lm(SG_I, sx * 0.33, 0.39, -1.85, 0, 0.07, 0.2, 4.3), MAT.wood, dark);
    for (const sx of [-1, 1]) {
      for (const z of [-1.9, 1.9]) sgBeam(upper, sx * 1.15, 0.36, z, sx * 1.15, TREB_AXLE + 0.05, 0, 0.3, 0.3, MAT.wood, wood);
      sgBeam(upper, sx * 1.15, 0.36, 0, sx * 1.15, TREB_AXLE - 0.1, 0, 0.26, 0.26, MAT.wood, darker(wood, 0.95));
      upper.add(G.box, lm(SG_I, sx * 1.15, 2.3, 0, 0, 0.2, 0.22, 2.05), MAT.wood, dark);
      sgBeam(upper, sx * 2.05, 0.33, 0, sx * 1.15, 2.7, 0, 0.18, 0.18, MAT.wood, dark);
      upper.add(G.box, lm(SG_I, sx * 1.15, TREB_AXLE + 0.14, 0, 0, 0.44, 0.34, 0.62), MAT.wood, dark);
      upper.add(G.box, lm(SG_I, sx * 1.15, TREB_AXLE + 0.33, 0, 0, 0.46, 0.05, 0.64), MAT.metal, iron);
      upper.add(G.box, lm(SG_I, sx * 1.15, 0.85, -3.75, 0, 0.2, 0.9, 0.22), MAT.wood, wood);
    }
    sgCylX(upper, 0, TREB_AXLE, 0, 0.12, 2.8, MAT.metal, iron);
    sgPennant(upper, 1.15, TREB_AXLE + 0.32, 0, rc, wood);
    // the arm: heavy by the axle, lighter toward the sling; iron bands; the yoke for the counterweight
    arm.add(G.box, lm(SG_I, 0, -0.15, 0, 0, 0.36, 3.3, 0.42), MAT.wood, wood);
    arm.add(G.box, lm(SG_I, 0, 3.55, 0, 0, 0.26, 4.1, 0.3), MAT.wood, wood);
    for (const y of [-1.3, 0.45, 1.4, 2.6, 3.9, 5.2]) arm.add(G.box, lm(SG_I, 0, y, 0, 0, y < 1.5 ? 0.39 : 0.29, 0.07, y < 1.5 ? 0.45 : 0.33), MAT.metal, iron);
    sgCylX(arm, 0, -TREB_SHORT, 0, 0.08, 1.05, MAT.metal, iron, G.cyl8);
    arm.add(G.cone8, lm(SG_I, 0, TREB_LONG + 0.12, 0.05, 0, 0.06, 0.3, 0.06), MAT.metal, iron);
    // the counterweight: an iron-bound crate heaped with stones, hung from the yoke
    for (const sx of [-1, 1]) cw.add(G.box, lm(SG_I, sx * 0.46, -0.24, 0, 0, 0.08, 0.5, 0.1), MAT.metal, iron);
    cw.add(G.box, lm(SG_I, 0, -1.1, 0, 0, 1.36, 1.3, 1.26), MAT.wood, dark);
    for (const y of [-0.5, -1.7]) cw.add(G.box, lm(SG_I, 0, y, 0, 0, 1.4, 0.07, 1.3), MAT.metal, iron);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cw.add(G.box, lm(SG_I, sx * 0.66, -1.1, sz * 0.61, 0, 0.1, 1.32, 0.1), MAT.wood, wood);
    for (let i = 0; i < 7; i++) { const a = i * 2.3, rr = 0.15 + 0.3 * hash1(i * 4.1); cw.add(SIEGE_STONE_GEO, lm(SG_I, Math.cos(a) * rr, -0.42, Math.sin(a) * rr, a, 0.24, 0.2, 0.24), MAT.stone, darker([0.6, 0.58, 0.54], 0.85 + 0.1 * hash1(i))); }
    sgCylX(drum, 0, 0, 0, 0.22, 2.1, MAT.wood, wood);
    for (const sx of [-1, 1]) { drum.add(G.box, lm(SG_I, sx * 1.0, 0, 0, 0, 0.07, 1.5, 0.08), MAT.wood, dark); drum.add(G.box, lm(SG_I, sx * 1.0, 0, 0, 0, 0.07, 0.08, 1.5), MAT.wood, dark); }
    pouch.add(G.box, lm(SG_I, 0, 0, 0, 0, 0.5, 0.1, 0.36), MAT.cloth, [0.36, 0.25, 0.17]);
    out.base = base.build(); out.upper = upper.build(); out.arm = arm.build(); out.cw = cw.build(); out.drum = drum.build(); out.pouch = pouch.build();
    out.drumAt = [0, 0.95, -3.75];
    out.crew = [[-1.85, -3.75], [1.85, -3.75], [-0.62, -4.6], [0.62, -4.6]];
    out.burn = [[0, 2.4, 0], [1.1, 1.4, -1.6], [-1.1, 3.4, 0.8], [0, 0.6, -3.0]];
  }
  SIEGE.parts.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* making and unmaking an engine                                       */
/* ------------------------------------------------------------------ */
const siegeById = (id) => SIEGE.engines.find((E) => E.id === id) || null;
const siegeActive = (E) => E && !E.gone && E.state !== 'wreck' && E.state !== 'burning';
function siegeMesh(E, geo, parent) {
  const m = new THREE.Mesh(geo, E.mat);
  m.renderOrder = 1;
  (parent || E.root).add(m);
  E.casters.push(shadowCaster(m, BUILDING_DEPTH || (BUILDING_DEPTH = depthFrom(buildingMat))));
  return m;
}
// kind, realm, where it is built, and what it is for: { C, W } (a wall section) or { C, gate: true }
function siegeCreate(kind, realm, x, z, yaw, target, work) {
  const spec = SIEGE_SPEC[kind], parts = siegeParts(kind, realm), R = REALMS[realm];
  const E = { id: SIEGE.nextId++, kind, spec, realm, x, z, y: heightAt(x, z), yaw, pitch: 0, roll: 0, state: 'build', build: 0, target, work: work || { x, z },
    crew: [], wb: null, player: false, casters: [], wheels: [], ph: 'wind', pt: 0, arm: 0, armV: 0, psi: 0, psiV: 0, loaded: false, burn: 0, fires: 0, idleT: 0,
    flash: 0, shake: 0, wreckT: 0, gone: false, coll: null, roll0: 0, born: GAME.t, lastHp: 0, actT: 0, shots: 0, hitsOn: 0 };
  E.mat = shareMat(siegeMat, { uFlash: { value: 0 }, uChar: { value: 0 }, uEmber: { value: 0 } });
  E.root = new THREE.Group();
  E.root.rotation.order = 'YXZ';
  scene.add(E.root);
  E.base = siegeMesh(E, parts.base);
  E.upper = siegeMesh(E, parts.upper);
  if (parts.wheel) for (const [wx, wy, wz] of parts.wheels) { const m = siegeMesh(E, parts.wheel); m.position.set(wx, wy, wz); E.wheels.push(m); }
  if (kind === 'ram') {
    E.log = siegeMesh(E, parts.log);
    E.ropes = [-1.25, 1.25].map(() => siegeMesh(E, SIEGE_ROPE_GEO));
  } else {
    E.armM = siegeMesh(E, parts.arm);
    E.drum = siegeMesh(E, parts.drum); E.drum.position.set(...parts.drumAt);
    E.rope = siegeMesh(E, SIEGE_ROPE_GEO);
    E.stoneM = siegeMesh(E, SIEGE_STONE_GEO, kind === 'mangonel' ? E.armM : E.root);
    E.stoneM.scale.setScalar(spec.stone);
    if (kind === 'mangonel') { E.armM.position.set(0, MANG_PIVOT[0], MANG_PIVOT[1]); E.stoneM.position.set(0, 2.6, 0.25 + spec.stone * 0.7); E.arm = MANG_REST; }
    else {
      E.armM.position.set(0, TREB_AXLE, 0); E.arm = Math.PI / 2;
      E.cwM = siegeMesh(E, parts.cw);
      E.pouch = siegeMesh(E, parts.pouch);
      E.slingR = [0, 1].map(() => siegeMesh(E, SIEGE_ROPE_GEO));
      const tip = trebTip(E.arm);
      E.sl = { x: tip.x, y: tip.y - TREB_SLING, z: tip.z, px: tip.x, py: tip.y - TREB_SLING, pz: tip.z };
    }
  }
  const ent = makeEnt({ kind: 'door', faction: realm, role: 'engine', name: `${R.name} ${spec.label}`, level: warLevel() + 2, x, z, y: E.y, radius: spec.radius });
  ent.maxHp = ent.hp = DOOR_HP.keep * doorHpScale() * spec.hp;
  ent.siegeEngine = E.id;
  E.ent = ent; E.lastHp = ent.hp;
  SIEGE.engines.push(E);
  SIEGE.stats.built++;
  SIEGE.stats[kind + 's']++;
  siegePose(E, 0);
  return E;
}
function siegeRemove(E) {
  E.gone = true;
  for (const id of E.crew) { const c = getEnt(id); if (c) c.siegeCrew = null; }
  E.crew = [];
  if (E.coll) E.coll.active = false;
  E.root.removeFromParent(); // [phones] it sits in the outdoor group after its first frame: scene.remove left wrecks drawn
  for (const q of E.casters) { if (!q) continue; SHADOW.scene.remove(q); const i = SHADOW.proxies.indexOf(q); if (i >= 0) SHADOW.proxies.splice(i, 1); }
  E.mat.dispose();
  if (E.ent && !E.ent.removed) removeEnt(E.ent);
  if (E.player) siegeLeave(E, true);
}

/* ------------------------------------------------------------------ */
/* posing: wheels on the ground, arms, slings, ropes                   */
/* ------------------------------------------------------------------ */
function siegeLocal(E, lx, ly, lz) {
  const c = Math.cos(E.yaw), s = Math.sin(E.yaw);
  return { x: E.x + lx * c + lz * s, y: E.y + ly, z: E.z - lx * s + lz * c };
}
function siegeGround(E) {
  // sit on the terrain: the height under the middle, pitched and rolled to the slope under its feet
  const fw = E.kind === 'trebuchet' ? 3.4 : 2.0, sw = E.kind === 'trebuchet' ? 1.6 : 1.2;
  const f = siegeLocal(E, 0, 0, fw), b = siegeLocal(E, 0, 0, -fw), l = siegeLocal(E, -sw, 0, 0), r = siegeLocal(E, sw, 0, 0);
  const hf = heightAt(f.x, f.z), hb = heightAt(b.x, b.z), hl = heightAt(l.x, l.z), hr = heightAt(r.x, r.z);
  E.y = Math.max((hf + hb + hl + hr) / 4, heightAt(E.x, E.z) - 0.05);
  E.pitch = -Math.atan2(hf - hb, 2 * fw);
  E.roll = Math.atan2(hr - hl, 2 * sw);
}
const trebTip = (a) => ({ x: 0, y: TREB_AXLE + Math.sin(a) * TREB_LONG, z: -Math.cos(a) * TREB_LONG });
function siegeCord(m, ax, ay, az, bx, by, bz, show = true) {
  const L = Math.hypot(bx - ax, by - ay, bz - az);
  m.visible = show && L > 0.05;
  if (!m.visible) return;
  m.position.set(ax, ay, az);
  m.scale.set(1, 1, L);
  m.lookAt(_sgv.set(bx, by, bz).applyMatrix4(m.parent.matrixWorld));
}
function siegePose(E, dt) {
  E.root.position.set(E.x, E.y, E.z);
  // a heavy blow or the throw shakes the frame for a moment
  const sh = E.shake > 0 ? Math.sin(GAME.t * 70) * E.shake * 0.02 : 0;
  E.root.rotation.set(E.pitch + sh, E.yaw, E.roll + E.roll0);
  E.root.updateMatrixWorld(true);
  // while it is built, the parts go up in order: the frame, the uprights, then the arm and its gear
  const b = E.state === 'build' ? E.build : 1;
  E.base.visible = b > 0.02; E.upper.visible = b > 0.35;
  for (const w of E.wheels) w.visible = b > 0.15;
  const armOn = b > 0.65;
  if (E.kind === 'ram') {
    const psi = E.psi;
    E.log.visible = armOn;
    E.log.position.set(0, RAM_PIVOT_Y - RAM_ROPE * Math.cos(psi), RAM_LOG_Z + RAM_ROPE * Math.sin(psi));
    E.ropes.forEach((m, i) => {
      const z = RAM_LOG_Z + (i ? 1.25 : -1.25);
      m.updateMatrixWorld();
      siegeCord(m, 0, RAM_PIVOT_Y + 0.05, z, 0, E.log.position.y + 0.3, z + RAM_ROPE * Math.sin(psi), armOn);
    });
  } else if (E.kind === 'mangonel') {
    E.armM.visible = armOn;
    E.armM.rotation.x = E.arm - Math.PI / 2;
    E.drum.visible = armOn;
    E.drum.rotation.x = -(MANG_REST - E.arm) * 3.2;
    E.stoneM.visible = armOn && E.loaded;
    const th = E.arm - Math.PI / 2, ay = MANG_PIVOT[0] + 2.2 * Math.cos(th), az = MANG_PIVOT[1] + 2.2 * Math.sin(th);
    siegeCord(E.rope, 0, 1.24, -2.2, 0, ay, az, armOn && E.ph !== 'settle' && E.arm < MANG_REST - 0.05);
  } else {
    E.armM.visible = armOn;
    E.armM.rotation.x = E.arm - Math.PI / 2;
    E.drum.visible = armOn;
    E.drum.rotation.x = -(Math.PI / 2 - E.arm) * 2.4;
    const th = E.arm - Math.PI / 2;
    // the counterweight hangs plumb from its pin, swinging a little behind the arm's motion
    E.cwM.visible = armOn;
    E.cwM.position.set(0, TREB_AXLE - TREB_SHORT * Math.cos(th), -TREB_SHORT * Math.sin(th));
    E.cwM.rotation.x = clamp(-E.armV * 0.07, -0.5, 0.5);
    const tip = trebTip(E.arm), sl = E.sl;
    E.pouch.visible = armOn;
    E.pouch.position.set(sl.x, sl.y, sl.z);
    E.pouch.rotation.x = Math.atan2(sl.z - tip.z, -(sl.y - tip.y));
    E.stoneM.visible = armOn && E.loaded;
    E.stoneM.position.set(sl.x, sl.y + E.spec.stone * 0.75, sl.z);
    E.slingR.forEach((m, i) => { m.updateMatrixWorld(); siegeCord(m, (i ? 0.18 : -0.18), tip.y, tip.z, sl.x + (i ? 0.2 : -0.2), sl.y + 0.05, sl.z, armOn); });
    siegeCord(E.rope, 0, 1.17, -3.75, 0, tip.y, tip.z, armOn && (E.ph === 'wind' || E.ph === 'load') && E.arm < Math.PI / 2 - 0.1);
  }
  E.mat.uniforms.uFlash.value = Math.max(0, E.flash);
  E.flash = Math.max(0, E.flash - dt * 3);
  E.shake = Math.max(0, E.shake - dt * 4);
  war3EngineLod(E); // [war3] far from the camera: two or three draws, not a dozen (08k_war3.js)
}

/* ------------------------------------------------------------------ */
/* crews                                                               */
/* ------------------------------------------------------------------ */
function siegeSlot(E, i) {
  const s = siegeParts(E.kind, E.realm).crew[i % E.spec.crew];
  const p = siegeLocal(E, s[0], 0, s[1]);
  return p;
}
function siegeAtSlots(E) {
  let n = 0;
  E.crew.forEach((id) => { const c = getEnt(id); if (!c) return; const s = siegeSlot(E, c.siegeSlot); if (dist(c.x, c.z, s.x, s.z) < 1.3) n++; });
  return n + (E.player ? 1.5 : 0);
}
function siegeAddCrew(E, e, slot) {
  if (e.mount) dismount(e);
  e.siegeCrew = E.id; e.siegeSlot = slot; e.target = null; e.casting = null;
  E.crew.push(e.id);
}
function siegeReleaseCrew(E) {
  for (const id of E.crew) { const c = getEnt(id); if (c) c.siegeCrew = null; }
  E.crew = [];
}
// a crew member's thinking (from thinkSoldier); false lets it fight as a soldier
function siegeCrewThink(e, dt) {
  const E = siegeById(e.siegeCrew);
  if (!siegeActive(E) || !E.crew.includes(e.id)) { e.siegeCrew = null; return false; }
  // struck by a foe in reach: defend yourself, then go back to the engine
  if (GAME.t - e.lastHitAt < 4) { const a = getEnt(e.lastHitBy); if (a && a.alive && isActor(a) && isEnemy(e, a) && dist(a.x, a.z, e.x, e.z) < 9) return false; }
  const s = siegeSlot(E, e.siegeSlot), d = dist(e.x, e.z, s.x, s.z);
  e.target = null;
  // under the ram's hide roof the crew are sheltered from the arrows of the walls
  if (E.kind === 'ram' && d < 0.8) addBuff(e, 'dr', 0.6, 0.6, 'ramshed');
  if (d > 0.3) moveToward(e, s.x, s.z, dt, d > 3 ? 1.1 : 0.75, 0.1);
  else {
    // face the work: the ram's crew face forward, the others face the windlass or the frame
    const f = E.kind === 'ram' ? siegeLocal(E, 0, 0, 30) : siegeLocal(E, 0, 0, E.kind === 'mangonel' ? -1.0 : -2.5);
    turnToward(e, f.x, f.z, dt * 6);
  }
  return true;
}
function siegeCrewAct(E, act, dur, every) {
  if (GAME.t < E.actT) return;
  E.actT = GAME.t + every;
  E.crew.forEach((id, k) => {
    const c = getEnt(id);
    if (!c || !c.alive || c.casting) return;
    const s = siegeSlot(E, c.siegeSlot);
    if (dist(c.x, c.z, s.x, s.z) > 1.4) return;
    later(k * 0.12 * (every > 0.9 ? 1 : 0), () => { if (c.alive && c.siegeCrew === E.id) setAct(c, act, dur); });
  });
  const P = GAME.player;
  if (E.player && P && P.alive) setAct(P, act, dur);
}

/* ------------------------------------------------------------------ */
/* targets and aim                                                     */
/* ------------------------------------------------------------------ */
// a wall section's outward normal and its outer face, in the world
function siegeFace(W) {
  const C = W.C;
  let nx = -W.waz, nz = W.wax;
  if (nx * (W.wx - C.S.x) + nz * (W.wz - C.S.z) < 0) { nx = -nx; nz = -nz; }
  return { nx, nz, x: W.wx + nx * (W.across + 0.05), z: W.wz + nz * (W.across + 0.05) };
}
function siegeGatePoint(S) {
  // the face a ram strikes: the leaves, or the portcullis in front of them where there is one
  const C = castleOf(S), front = C && C.gate && C.gate.port ? 0.72 : 0.12;
  const p = siteToWorld(S, 0, S.gateLocal.z + front), q = siteToWorld(S, 0, S.gateLocal.z + 10);
  const d = Math.hypot(q.x - p.x, q.z - p.z);
  return { x: p.x, z: p.z, nx: (q.x - p.x) / d, nz: (q.z - p.z) / d };
}
const siegeDoorOf = (S) => (S.keepRef ? S.keepRef.door : S.templeRef ? S.templeRef.door : null);
// where a stone should land: on a wall face, short of it, over it into the court, or on the gate
function siegeAim(E) {
  const T = E.target, C = T.C, S = C.S, acc = E.player ? 0.8 : 0.7;
  if (T.W && T.W.state === 'whole') {
    const W = T.W, f = siegeFace(W), u = (Math.random() - 0.5) * W.half * 1.3, r = Math.random();
    const top = W.top;
    if (r < acc) return { kind: 'wall', x: f.x + W.wax * u, z: f.z + W.waz * u, y: S.y + 1.4 + Math.random() * (top - 2.2), W };
    if (r < acc + (1 - acc) / 2) { const k = 3 + Math.random() * 6, x = f.x + f.nx * k + W.wax * u, z = f.z + f.nz * k + W.waz * u; return { kind: 'ground', x, z, y: heightAt(x, z) }; }
    const k = 8 + Math.random() * 5, x = f.x - f.nx * (k + W.across * 2) + W.wax * u, z = f.z - f.nz * (k + W.across * 2) + W.waz * u;
    return { kind: 'ground', x, z, y: floorAt(x, z, S.y + 0.5) };
  }
  const D = siegeDoorOf(S);
  if (D && D.alive) {
    const g = siegeGatePoint(S), u = (Math.random() - 0.5) * 2.0;
    if (Math.random() < acc) return { kind: 'gate', x: g.x - g.nz * u, z: g.z + g.nx * u, y: S.y + 1.2 + Math.random() * 2.2, D };
    const k = 2 + Math.random() * 6; return { kind: 'ground', x: g.x + g.nx * k, z: g.z + g.nz * k, y: heightAt(g.x + g.nx * k, g.z + g.nz * k) };
  }
  return null;
}
// the next thing in reach to batter, once the first has fallen: another whole section, else the gate
function siegeRetarget(E) {
  const C = E.target.C, D = siegeDoorOf(C.S), range = (E.spec.range || 0) + 10;
  if (E.kind === 'ram') return !!(D && D.alive);
  let best = null;
  for (const W of siegeMarks(C, E.x, E.z, 0)) { const f = siegeFace(W); if (dist(E.x, E.z, f.x, f.z) < range) { best = W; break; } } // [siege2] the weakest way in within reach, a tower too (04i_siege2.js)
  if (best) { E.target = { C, W: best }; return true; }
  if (D && D.alive && doorVulnerable(D)) { const g = siegeGatePoint(C.S); if (dist(E.x, E.z, g.x, g.z) < range) { E.target = { C, gate: true }; return true; } }
  return false;
}
function siegeTargetOk(E) {
  const T = E.target;
  if (!T || !T.C) return false;
  const K = T.C.S.keepRef;
  if (K && K.realm === E.realm) return false;
  const tm = T.C.S.templeRef;
  if (tm && tm.realm === E.realm) return false;
  if (T.W) return T.W.state === 'whole';
  const D = siegeDoorOf(T.C.S);
  return !!(D && D.alive && doorVulnerable(D));
}

/* ------------------------------------------------------------------ */
/* stones in flight                                                    */
/* ------------------------------------------------------------------ */
const SIEGE_G = 9.8;
function siegeLaunch(E, from) {
  const aim = siegeAim(E);
  if (!aim) return false;
  const R = dist(from.x, from.z, aim.x, aim.z);
  // a lob near forty-five degrees: the flight time for that range, then the velocity that lands it on the mark
  const tf = clamp(Math.sqrt((2 * R) / SIEGE_G) * (E.kind === 'trebuchet' ? 1.05 : 0.92), 1.2, 5.5);
  const st = { x: from.x, y: from.y, z: from.z, x0: from.x, y0: from.y, z0: from.z, vx: (aim.x - from.x) / tf, vz: (aim.z - from.z) / tf, vy: (aim.y - from.y + 0.5 * SIEGE_G * tf * tf) / tf, t: 0, tf, aim, E, src: E.ent, r: E.spec.stone, spin: (Math.random() - 0.5) * 8, mesh: null, trail: 0, heavy: E.kind === 'trebuchet' };
  let m = SIEGE.pool.pop();
  if (!m) { m = new THREE.Mesh(SIEGE_STONE_GEO, buildingMat); m.renderOrder = 1; scene.add(m); shadowCaster(m, BUILDING_DEPTH || (BUILDING_DEPTH = depthFrom(buildingMat))); }
  m.visible = true; m.scale.setScalar(st.r); m.position.set(st.x, st.y, st.z);
  st.mesh = m;
  SIEGE.stones.push(st);
  SIEGE.stats.shots++;
  E.shots++;
  return true;
}
function siegeStonesStep(dt) {
  for (let i = SIEGE.stones.length - 1; i >= 0; i--) {
    const s = SIEGE.stones[i];
    s.t += dt;
    const t = Math.min(s.t, s.tf);
    const qx = s.x, qy = s.y, qz = s.z; // [walls]
    s.x = s.x0 + s.vx * t; s.z = s.z0 + s.vz * t; s.y = s.y0 + s.vy * t - 0.5 * SIEGE_G * t * t;
    if (s.t < s.tf && wallsStoneStep(s, qx, qy, qz)) { s.x = s.aim.x; s.y = s.aim.y; s.z = s.aim.z; siegeImpact(s); s.mesh.visible = false; SIEGE.pool.push(s.mesh); SIEGE.stones.splice(i, 1); continue; } // [walls] it strikes the first thing in its way (07g_walls.js)
    s.mesh.position.set(s.x, s.y, s.z);
    s.mesh.rotation.x += s.spin * dt; s.mesh.rotation.z += s.spin * 0.7 * dt;
    // a thin trail of dust and grit behind it
    s.trail += dt;
    if (s.trail > 0.06 && fxAlpha) { s.trail = 0; fxAlpha.emit(s.x, s.y, s.z, 0, 0.2, 0, 0.55, 0.5, 0.47, 0.42, s.r * 1.1, -0.1, 1.5); }
    if (s.t >= s.tf) { siegeImpact(s); s.mesh.visible = false; SIEGE.pool.push(s.mesh); SIEGE.stones.splice(i, 1); }
  }
}
function siegeDebris(x, y, z, n, col, up = 5, spread = 4) {
  if (!fxAlpha) return;
  for (let i = 0; i < n; i++) fxAlpha.emit(x, y, z, (Math.random() - 0.5) * spread, Math.random() * up, (Math.random() - 0.5) * spread, 0.9 + Math.random() * 0.6, col[0] * (0.8 + Math.random() * 0.4), col[1] * (0.8 + Math.random() * 0.4), col[2] * (0.8 + Math.random() * 0.4), 0.09 + Math.random() * 0.12, 9.8, 0.4);
}
// a stone's splash: whoever stands where it lands (a lord is never killed by a stone: keeps fall to swords)
function siegeSplash(src, x, z, r, mult) {
  if (!src.alive) return;
  forNear(x, z, r, (o) => {
    if (!o.alive || !isEnemy(src, o) || !isActor(o) || o.role === 'lord' || o.flying) return;
    const k = computeDamage(src, o, mult);
    dealDamage(src, o, k.d, { kind: 'aoe' });
  });
}
function siegeImpact(s) {
  const a = s.aim, E = s.E, src = s.src, mult = E.spec.mult, P = GAME.player;
  const near = P && dist2(P.x, P.z, a.x, a.z) < 90 * 90;
  if (a.kind === 'wall') {
    castleSiegeHit(src, a.x, a.z, 2.0, mult);
    SIEGE.stats.wallHits++; E.hitsOn++;
    // a puff of mortar and stone chips off the face, the rest of the dust rolls down it
    FX.dust(a.x, a.y, a.z, 26, [0.5, 0.47, 0.42]);
    for (let k = 0; k < 4; k++) later(k * 0.1, () => FX.dust(a.x, a.y - 1 - k * 1.2, a.z, 10, [0.46, 0.43, 0.38]));
    siegeDebris(a.x, a.y, a.z, 22, [0.55, 0.52, 0.47]);
    siegeSplash(src, a.x, a.z, 2.6, 0.9);
  } else if (a.kind === 'gate') {
    if (a.D && a.D.alive && doorVulnerable(a.D)) dealDamage(src, a.D, baseDmg(src.level) * mult * 2.4, { siege: true });
    SIEGE.stats.gateHits++; E.hitsOn++;
    FX.splinters(a.x, a.y - 1, a.z);
    siegeSplash(src, a.x, a.z, 2.4, 0.9);
  } else if (a.H) {
    houseStoneHit(a.H, a.x, a.y, a.z, mult, src); // [siege2] a house in its way: its walls crack, its roof is holed, it falls in (04j_batter.js)
    siegeSplash(src, a.x, a.z, 2.4, 0.9);
  } else {
    FX.dust(a.x, a.y + 0.2, a.z, 22, [0.44, 0.39, 0.31]);
    siegeDebris(a.x, a.y + 0.2, a.z, 14, [0.4, 0.34, 0.26]);
    siegeSplash(src, a.x, a.z, 2.6, 1.1);
    houseBlowAt(src, a.x, a.z, 1.8, mult * 0.6); // [war2] a stone that lands beside a house (a keep's hall in the court, a wall short) shakes it: its walls crack (04j_batter.js)
  }
  sfxAt(s.heavy ? 'boom' : 'crash', a.x, a.y, a.z); // [audio2] placed (11c_sound.js)
  if (near) cameraShake(s.heavy ? 0.4 : 0.25, a.x, a.z);
}

/* ------------------------------------------------------------------ */
/* the engines at work                                                 */
/* ------------------------------------------------------------------ */
function siegeEngineStep(E, dt) {
  E.crew = E.crew.filter((id) => { const c = getEnt(id); return c && c.alive && c.siegeCrew === E.id; });
  const ent = E.ent;
  // hits from swords and axes: a flash and a shudder of the frame
  if (ent.alive && ent.hp < E.lastHp - 1) { E.flash = 0.5; E.shake = Math.max(E.shake, 0.4); }
  E.lastHp = ent.hp;
  if (E.state === 'burning') { siegeBurnStep(E, dt); siegePose(E, dt); return; }
  if (E.state === 'wreck') { siegeWreckStep(E, dt); return; }
  const hands = siegeAtSlots(E);
  // nobody to work it: it stands abandoned, until its own side comes back for it or it is broken up
  if (!E.crew.length && !E.player) { E.idleT += dt; if (E.idleT > 200) { siegeDismantle(E); return; } } else E.idleT = 0;
  if (E.wb && (E.wb.dead || !siegeBandOn(E.wb, E))) { E.wb = null; siegeReleaseCrew(E); }
  const work = Math.min(hands, E.spec.crew) / E.spec.crew;
  if (siegeEngineGuard(E, dt)) return; // [war2] an engine that cannot get on is settled where it stands or given up (08j_war2.js)
  if (E.state === 'build') {
    if (hands > 0) {
      E.build = Math.min(1, E.build + (dt * (0.35 + 0.65 * work)) / E.spec.build);
      siegeCrewAct(E, Math.random() < 0.5 ? 8 : 1, 0.7, 0.85);
      if (Math.random() < dt * 1.6) sfxAt(Math.random() < 0.2 ? 'saw' : 'mallet', E.x + (Math.random() - 0.5) * 3, null, E.z + (Math.random() - 0.5) * 3); // [audio2] its crew at work on it (11c_sound.js)
      if (Math.random() < dt * 1.2) { const p = siegeLocal(E, (Math.random() - 0.5) * 2, 0.6 + Math.random() * 2, (Math.random() - 0.5) * 3); FX.dust(p.x, p.y, p.z, 3, [0.5, 0.42, 0.3]); }
    }
    if (E.build >= 1) { E.state = dist(E.x, E.z, E.work.x, E.work.z) > 0.6 && E.spec.speed > 0 ? 'move' : 'work'; E.ph = E.kind === 'ram' ? 'pull' : 'wind'; E.arm = E.kind === 'mangonel' ? MANG_REST : E.kind === 'trebuchet' ? Math.PI / 2 : 0; if (E.state === 'work') siegeSettle(E); }
  } else if (E.state === 'move') {
    const d = dist(E.x, E.z, E.work.x, E.work.z);
    // it rolls only while its crew push: at most its own pace, slower with fewer hands
    if (hands >= Math.min(2, E.spec.crew) && d > 0.05) {
      const step = Math.min(d, E.spec.speed * (0.45 + 0.55 * work) * dt), nx = E.x + ((E.work.x - E.x) / d) * step, nz = E.z + ((E.work.z - E.z) / d) * step;
      if (isWalkable(nx, nz)) {
        E.x = nx; E.z = nz;
        for (const w of E.wheels) w.rotation.x += step / 0.5;
        E.sndRoll = (E.sndRoll || 0) + step; if (E.sndRoll > 1.4) { E.sndRoll = 0; sfxAt('creak', E.x, null, E.z, { vol: 1.5 }); } // [audio2] its wheels and frame groan as it rolls (11c_sound.js)
        siegeCrewAct(E, 5, 0.75, 0.8);
        siegeGround(E);
      } else { E.work = { x: E.x, z: E.z }; }
    }
    if (d <= 0.06) { E.state = 'work'; siegeSettle(E); }
  } else if (E.state === 'work') {
    if (!siegeTargetOk(E) && !siegeRetarget(E)) { E.state = 'idle'; siegeReleaseCrew(E); }
    else if (E.kind === 'ram') siegeRamStep(E, dt, hands, work);
    else if (E.kind === 'mangonel') siegeMangonelStep(E, dt, hands, work);
    else siegeTrebStep(E, dt, hands, work);
  } else if (E.state === 'idle') {
    // a fresh target in reach puts it back to work (a rebuilt gate, a section the player points it at)
    if ((E.crew.length || E.player) && siegeRetarget(E) && siegeTargetOk(E)) E.state = 'work';
    if (E.kind === 'trebuchet') siegeTrebSwing(E, dt);
  }
  ent.x = E.x; ent.z = E.z; ent.y = E.y;
  siegePose(E, dt);
}
// a mangonel or trebuchet that has arrived: a collider round its frame so nobody walks through the timbers
function siegeSettle(E) {
  siegeGround(E);
  const b = E.spec.box;
  if (b && !E.coll) { const c = siegeLocal(E, 0, 0, b[2]); E.coll = addBox(c.x, c.z, b[0], b[1], E.yaw, 'engine', 3.2); }
}
function siegeRamStep(E, dt, hands, work) {
  const D = siegeDoorOf(E.target.C.S);
  const g = (SIEGE_G / RAM_ROPE);
  if (E.ph === 'pull') {
    // the crew haul the log back on its slings
    if (hands > 0) { E.psi = Math.max(-0.58, E.psi - dt * (0.32 + 0.4 * work)); siegeCrewAct(E, 5, 1.3, 1.6); }
    if (E.psi <= -0.57) { E.ph = 'swing'; E.psiV = 0; }
  } else if (E.ph === 'swing') {
    // let go and drive it forward: a pendulum with the crew's shove behind it
    E.psiV += (-g * Math.sin(E.psi) + (E.psi < 0.05 ? 3.2 * (0.5 + work) : 0)) * dt;
    E.psi += E.psiV * dt;
    if (E.psi >= 0.22) {
      E.psi = 0.22;
      const hit = D && D.alive && doorVulnerable(D);
      if (hit) {
        dealDamage(E.ent, D, baseDmg(E.ent.level) * 7.5 * (0.7 + 0.5 * work), { siege: true });
        SIEGE.stats.ramHits++; E.hitsOn++;
        const C = E.target.C, G0 = C.gate;
        if (G0 && G0.alive) { G0.leaves.forEach((m, i) => { m.rotation.y += (i ? -1 : 1) * 0.045; m.material.uniforms.uFlash.value = 0.25; }); later(0.15, () => { setGatePose(G0); G0.leaves.forEach((m) => { m.material.uniforms.uFlash.value = 0; }); }); }
        const h = siegeLocal(E, 0, 1.2, RAM_REACH);
        FX.dust(h.x, h.y, h.z, 14, [0.5, 0.44, 0.36]);
        siegeDebris(h.x, h.y + 0.6, h.z, 10, [0.42, 0.3, 0.18], 3, 3);
        const P = GAME.player;
        sfxAt('thud', h.x, h.y, h.z, { vol: 1.3 }); if (Math.random() < 0.35) sfxAt('crash', h.x, h.y, h.z); // [audio2] placed (11c_sound.js)
        if (P && dist2(P.x, P.z, h.x, h.z) < 70 * 70) cameraShake(0.22, h.x, h.z);
      }
      E.psiV = -Math.abs(E.psiV) * 0.22; E.ph = 'settle'; E.pt = 0; E.shake = 0.6;
    }
  } else {
    E.pt += dt;
    E.psiV += -g * Math.sin(E.psi) * dt - E.psiV * 2.5 * dt;
    E.psi += E.psiV * dt;
    if (E.pt > 0.8) E.ph = 'pull';
  }
}
function siegeMangonelStep(E, dt, hands, work) {
  const reload = E.spec.reload / Math.max(0.25, work);
  if (E.ph === 'wind') {
    // round goes the windlass, and the arm comes down against the twist of the skein
    if (hands > 0) { E.arm = Math.max(MANG_COCK, E.arm - (dt * (MANG_REST - MANG_COCK)) / (reload * 0.75)); siegeCrewAct(E, 8, 1.0, 1.05); }
    if (E.arm <= MANG_COCK + 1e-3) { E.ph = 'load'; E.pt = 0; }
  } else if (E.ph === 'load') {
    E.pt += dt;
    if (E.pt > 0.8 && !E.loaded && hands > 0) { E.loaded = true; siegeCrewAct(E, 5, 0.7, 0.1); }
    if (E.pt > 1.8 && E.loaded) { E.ph = 'throw'; E.armV = 0; }
  } else if (E.ph === 'throw') {
    // the skein lets go: the arm whips up and slams into the cushioned stop
    E.armV += 75 * dt; E.arm += E.armV * dt;
    if (E.loaded && E.arm >= 1.72) {
      E.armM.updateMatrixWorld(true);
      const p = E.stoneM.getWorldPosition(_sgv);
      E.loaded = false;
      siegeLaunch(E, { x: p.x, y: p.y, z: p.z });
    }
    if (E.arm >= MANG_REST) {
      E.arm = MANG_REST; E.armV = -E.armV * 0.16; E.ph = 'settle'; E.pt = 0; E.shake = 1;
      const q = siegeLocal(E, 0, 2.5, 0.5);
      FX.dust(q.x, q.y, q.z, 6, [0.55, 0.5, 0.4]);
      sfxAt('thud', E.x, null, E.z); // [audio2] placed (11c_sound.js)
    }
  } else {
    E.pt += dt;
    E.armV += 30 * dt; E.arm = Math.min(MANG_REST, E.arm + E.armV * dt);
    if (E.arm >= MANG_REST) E.armV = -E.armV * 0.2;
    if (E.pt > 1.2) { E.ph = 'wind'; E.arm = MANG_REST; E.armV = 0; }
  }
}
// the trebuchet's sling: a point on a rope from the tip of the arm, falling, held taut, lying in its trough
function siegeSlingStep(E, h) {
  const sl = E.sl, tip = trebTip(E.arm);
  const vx = (sl.x - sl.px) * 0.995, vy = (sl.y - sl.py) * 0.995, vz = (sl.z - sl.pz) * 0.995;
  sl.px = sl.x; sl.py = sl.y; sl.pz = sl.z;
  sl.x += vx; sl.y += vy - SIEGE_G * h * h; sl.z += vz;
  const dx = sl.x - tip.x, dy = sl.y - tip.y, dz = sl.z - tip.z, d = Math.hypot(dx, dy, dz);
  if (d > TREB_SLING) { const k = TREB_SLING / d; sl.x = tip.x + dx * k; sl.y = tip.y + dy * k; sl.z = tip.z + dz * k; }
  const floor = Math.abs(sl.x) < 0.4 && sl.z < 0.3 && sl.z > -4.0 ? 0.42 : 0.12;
  if (sl.y < floor) { sl.y = floor; sl.pz = lerp(sl.pz, sl.z, 0.4); sl.px = lerp(sl.px, sl.x, 0.4); }
}
function siegeTrebSwing(E, dt) {
  const n = 6, h = dt / n;
  for (let i = 0; i < n; i++) {
    // the counterweight falls and swings: a heavy pendulum about the axle, the arm riding it
    E.armV += (16 * Math.cos(E.arm) - 1.1 * E.armV) * h;
    E.arm += E.armV * h;
    siegeSlingStep(E, h);
    if (E.loaded && E.ph === 'throw') {
      const sl = E.sl, vx = (sl.x - sl.px) / h, vy = (sl.y - sl.py) / h, vz = (sl.z - sl.pz) / h, sp = Math.hypot(vx, vy, vz);
      if ((E.arm > 1.25 && vz > 0 && sp > 1 && vy / sp > 0.3 && vy / sp < 0.85) || E.arm > 2.3) {
        E.loaded = false;
        E.root.updateMatrixWorld(true);
        const p = _sgv.set(sl.x, sl.y + E.spec.stone * 0.75, sl.z).applyMatrix4(E.root.matrixWorld);
        siegeLaunch(E, { x: p.x, y: p.y, z: p.z });
      }
    }
  }
}
function siegeTrebStep(E, dt, hands, work) {
  const reload = E.spec.reload / Math.max(0.25, work);
  if (E.ph === 'wind') {
    // the crew wind the windlass and the arm comes down, lifting the counterweight high in front
    E.armV = 0;
    if (hands > 0) { E.arm = Math.max(TREB_COCK, E.arm - (dt * (Math.PI / 2 - TREB_COCK)) / (reload * 0.7)); siegeCrewAct(E, 8, 1.1, 1.15); }
    const n = 3; for (let i = 0; i < n; i++) siegeSlingStep(E, dt / n);
    if (E.arm <= TREB_COCK + 1e-3) { E.ph = 'load'; E.pt = 0; }
  } else if (E.ph === 'load') {
    // the sling is laid out along its trough and the stone put in the pouch
    E.pt += dt;
    const tip = trebTip(E.arm), k = Math.min(1, dt * 3), sl = E.sl;
    sl.x = lerp(sl.x, 0, k); sl.y = lerp(sl.y, 0.42, k); sl.z = lerp(sl.z, tip.z + TREB_SLING - 0.05, k);
    sl.px = sl.x; sl.py = sl.y; sl.pz = sl.z;
    if (E.pt > 1.0 && !E.loaded && hands > 0) { E.loaded = true; siegeCrewAct(E, 5, 0.7, 0.1); }
    if (E.pt > 2.2 && E.loaded) { E.ph = 'throw'; E.pt = 0; E.armV = 0; sfxAt('grind', E.x, null, E.z); } // [audio2] placed (11c_sound.js)
  } else if (E.ph === 'throw') {
    E.pt += dt;
    siegeTrebSwing(E, dt);
    if (E.pt > 0.5 && E.pt < 0.6) E.shake = 0.8;
    if (E.pt > 4.5) { E.ph = 'wind'; E.loaded = false; }
  }
}

/* ------------------------------------------------------------------ */
/* fire, wreck and ruin                                                */
/* ------------------------------------------------------------------ */
function siegeIgnite(E, by = null) {
  if (!siegeActive(E) || E.state === 'build' && E.build < 0.1) return false;
  E.state = 'burning'; E.burn = 0.02; E.fires = 0; E.burnBy = by ? by.id : null;
  siegeReleaseCrew(E);
  if (E.player) siegeLeave(E);
  if (E.coll) E.coll.active = false;
  const R = REALMS[E.realm], S = E.target && E.target.C ? E.target.C.S : null;
  news(`The ${R.name} ${E.spec.label}${S ? ` before ${S.name}` : ''} is on fire!`, E.realm, 'normal');
  sfxAt('ignite', E.x, null, E.z); // [audio2] placed (11c_sound.js)
  if (typeof igniteGrass === 'function') igniteGrass(E.x, E.z, 2.2, 3, 0.8);
  return true;
}
function siegeBurnStep(E, dt) {
  // the fire takes the timbers one after another; rain slows it but cannot save the engine
  const wet = clamp(WEATHER.raining || 0, 0, 1);
  E.burn = Math.min(1, E.burn + (dt / 24) / (1 + 0.8 * wet));
  const pts = siegeParts(E.kind, E.realm).burn;
  while (E.fires < pts.length && E.burn > E.fires * 0.2) {
    const [lx, ly, lz] = pts[E.fires], p = siegeLocal(E, lx, ly, lz);
    addFire(p.x, p.y, p.z, E.fires === 0 ? 1.3 : 1.0 + Math.random() * 0.4, false, GAME.t + 30 * (1 - E.burn) + 14 + Math.random() * 8, E.fires < 2 ? { r: 10, k: 1.1 } : null);
    E.fires++;
  }
  E.mat.uniforms.uChar.value = clamp(E.burn * 1.25, 0, 1);
  E.mat.uniforms.uEmber.value = 0.35 + 0.65 * Math.min(1, E.burn * 2);
  if (E.kind === 'trebuchet' || E.kind === 'mangonel') { E.armV *= 0.98; }
  const ent = E.ent;
  if (ent.alive) {
    ent.hp = Math.min(ent.hp, ent.maxHp * (1 - E.burn));
    if (E.burn >= 1 || ent.hp <= 1) killEnt(ent, getEnt(E.burnBy));
  }
}
function siegeWreck(E, how) {
  if (E.state === 'wreck') return;
  const burnt = how === 'burnt' || E.state === 'burning';
  E.state = 'wreck'; E.wreckT = 0; E.loaded = false;
  if (E.coll) E.coll.active = false;
  siegeReleaseCrew(E);
  if (E.player) siegeLeave(E);
  SIEGE.stats[burnt ? 'burnt' : 'broken']++;
  E.mat.uniforms.uChar.value = burnt ? 1 : 0.25;
  // the frame gives way: the arm drops, the uprights lean, the whole thing settles in a heap
  E.fall = { roll: (Math.random() < 0.5 ? -1 : 1) * (0.14 + Math.random() * 0.12), sink: E.kind === 'ram' ? 0.35 : 0.25, arm: E.kind === 'mangonel' ? 0.6 : E.kind === 'trebuchet' ? 0.25 : 0, t: 0 };
  const p = siegeLocal(E, 0, 1.5, 0);
  FX.splinters(p.x, p.y, p.z);
  FX.dust(p.x, E.y + 0.3, p.z, 24, burnt ? [0.25, 0.23, 0.21] : [0.5, 0.45, 0.38]);
  const P = GAME.player;
  sfxAt('crash', E.x, null, E.z); // [audio2] placed (11c_sound.js)
  if (P && dist2(P.x, P.z, E.x, E.z) < 80 * 80) cameraShake(0.25, E.x, E.z);
  const R = REALMS[E.realm], S = E.target && E.target.C ? E.target.C.S : null;
  news(`The ${R.name} ${E.spec.label}${S ? ` before ${S.name}` : ''} has been ${burnt ? 'burnt to the ground' : 'hacked apart'}.`, S && S.keepRef ? S.keepRef.realm : E.realm, 'normal');
}
function siegeWreckStep(E, dt) {
  const f = E.fall;
  E.wreckT += dt;
  f.t = Math.min(1, f.t + dt / 1.3);
  const k = f.t * f.t;
  E.roll0 = f.roll * k;
  E.upper.position.y = -f.sink * k;
  E.upper.rotation.z = f.roll * 0.6 * k;
  if (E.armM) { E.arm = lerp(E.arm, f.arm, Math.min(1, dt * 3)); E.armM.position.y = (E.kind === 'mangonel' ? MANG_PIVOT[0] : TREB_AXLE) - (E.kind === 'trebuchet' ? 2.6 : 0.25) * k; }
  if (E.log) { E.psi = lerp(E.psi, 0, Math.min(1, dt * 2)); }
  E.wheels.forEach((w, i) => { w.rotation.z = (i % 2 ? 1 : -1) * 0.5 * k; });
  // charred timbers smoulder a while, then the wreck is cleared away
  if (E.mat.uniforms.uChar.value > 0.9) { E.mat.uniforms.uEmber.value = Math.max(0, 0.6 - E.wreckT / 50); if (Math.random() < dt * 3 && fxAlpha) { const p = siegeLocal(E, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 3); fxAlpha.emit(p.x, p.y, p.z, 0, 0.8, 0, 3, 0.16, 0.15, 0.14, 0.8, -0.25, 0.3); } }
  if (E.wreckT > 80) E.y -= dt * 0.25;
  if (E.wreckT > 92) { siegeRemove(E); return; }
  siegePose(E, dt);
}
function siegeDismantle(E) {
  const p = siegeLocal(E, 0, 1, 0);
  FX.dust(p.x, E.y + 0.3, p.z, 16, [0.5, 0.45, 0.38]);
  siegeRemove(E);
}
// the engine's entity was destroyed (from onEntityKilled)
function siegeEngineKilled(ent, killer) {
  const E = siegeById(ent.siegeEngine);
  if (!E) return;
  siegeWreck(E, E.state === 'burning' ? 'burnt' : 'broken');
  if (killer && GAME.player && killer === GAME.player) { addRP(60); uiToast(`You destroyed the ${REALMS[E.realm].name} ${E.spec.label}.`); }
}
// fire lands (from fireLandsAt and fireConeAt): the timbers it lands on take heat, and catch once they have had
// enough of it (a single burning arrow seldom does it; a fireball or two will; wet hides on a ram hold out longer)
function siegeHeat(E, k) {
  const now = GAME.t;
  E.heat = Math.max(0, (E.heat || 0) - (now - (E.heatT || now)) * 0.03) + k * (E.kind === 'ram' ? 0.55 : 1) / (1 + 0.8 * clamp(WEATHER.raining || 0, 0, 1));
  E.heatT = now;
  if (E.heat >= 1) siegeIgnite(E);
  else if (E.heat > 0.2) { const p = siegeLocal(E, (Math.random() - 0.5) * 1.6, 1 + Math.random(), (Math.random() - 0.5) * 2); FX.burst(p.x, p.y, p.z, 6, [2.2, 1.0, 0.3], 1.5, 0.5, 0.12, -1); }
}
function siegeFireAt(x, y, z, r = 1) {
  for (const E of SIEGE.engines) {
    if (!siegeActive(E) || Math.abs(y - E.y) > 7) continue;
    if (dist2(x, z, E.x, E.z) > (E.spec.radius * 0.8 + r * 0.6) ** 2) continue;
    siegeHeat(E, r <= 1.2 ? 0.3 : 0.55 + r * 0.25);
  }
}
function siegeFireCone(x, z, dx, dz, range, half) {
  for (const E of SIEGE.engines) {
    if (!siegeActive(E)) continue;
    const ox = E.x - x, oz = E.z - z, d = Math.hypot(ox, oz);
    if (d > range + E.spec.radius || (d > 2 && (ox * dx + oz * dz) / d < Math.cos(half))) continue;
    siegeHeat(E, 0.45);
  }
}

/* ------------------------------------------------------------------ */
/* warbands bring engines to their sieges                              */
/* ------------------------------------------------------------------ */
const siegeLikePhase = (O) => !!O && (O.phase === 'siege' || O.phase === 'assault' || O.phase === 'breach' || O.phase === 'bombard' || O.phase === 'gap'); // [war2] 'gap'
function siegeBandOn(wb, E) {
  const O = wb.order;
  if (!O || !E.target) return false;
  const S = E.target.C.S;
  return (O.type === 'attack' && O.keep && O.keep.site === S && O.keep.realm !== wb.realm) || (O.type === 'raid' && O.temple && O.temple.site === S);
}
const siegeCountOf = (r) => SIEGE.engines.filter((E) => !E.gone && E.state !== 'wreck' && (r === undefined || E.realm === r)).length;
// a firing spot at range r from a face point along its normal: walkable, not too steep, out of other castles
function siegeSpotOk(x, z, C) {
  if (!isWalkable(x, z) || x > DUN_X0 - 50) return false;
  const h = heightAt(x, z);
  for (const [ox, oz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) { if (!isWalkable(x + ox, z + oz) || Math.abs(heightAt(x + ox, z + oz) - h) > 1.8) return false; }
  for (const D of CASTLES) if (dist2(x, z, D.S.x, D.S.z) < 24 * 24) return false;
  return true;
}
function siegeFindSpot(fx, fz, nx, nz, R, C) {
  for (const dr of [0, -5, 6, -10, 12, -15]) {
    for (const da of [0, 0.18, -0.18, 0.36, -0.36]) {
      const c = Math.cos(da), s = Math.sin(da), ux = nx * c - nz * s, uz = nx * s + nz * c, x = fx + ux * (R + dr), z = fz + uz * (R + dr);
      if (siegeSpotOk(x, z, C)) return { x, z };
    }
  }
  return null;
}
// the commander's choice at the walls: break the gate with a ram, or breach a wall with a mangonel or trebuchet
function siegePlanFor(wb, O) {
  const K = O.keep || null, T = O.temple || null, S = K ? K.site : T.site, C = castleOf(S);
  const members = wbMembers(wb), L = wbLeader(wb);
  if (!C || !L || members.length < 6) return null;
  if (siegeCountOf() >= SIEGE_MAX() || siegeCountOf(wb.realm) >= 2) return null;
  const D = siegeDoorOf(S);
  if (!D || !D.alive) return null;
  if (SIEGE.engines.some((E) => !E.gone && E.state !== 'wreck' && E.realm === wb.realm && E.target && E.target.C === C)) return null;
  let kind = SIEGE.force;
  if (!kind) {
    if (T) { if (!doorVulnerable(D)) return null; kind = 'ram'; }
    else {
      const whole = (C.sections || []).filter((W) => W.state === 'whole').length;
      const hurt = 1 - D.hp / D.maxHp, r = Math.random();
      if (!whole || hurt > 0.45) kind = 'ram';
      else kind = r < 0.34 ? 'ram' : r < 0.68 ? 'mangonel' : 'trebuchet';
      if (C.kind === 'timber' && kind === 'trebuchet') kind = 'mangonel'; // a palisade falls to less
    }
  }
  let target, spot, work;
  if (kind === 'ram') {
    const g = siegeGatePoint(S);
    work = { x: g.x + g.nx * RAM_REACH, z: g.z + g.nz * RAM_REACH };
    for (const k of [22, 17, 12]) {
      const x = g.x + g.nx * k, z = g.z + g.nz * k;
      if (isWalkable(x, z) && segmentClear(x, z, work.x, work.z, 1.2, true)) { spot = { x, z }; break; }
    }
    if (!spot) return null;
    target = { C, gate: true };
    const E = siegeCreate('ram', wb.realm, spot.x, spot.z, Math.atan2(-g.nx, -g.nz), target, work);
    return siegeCrewUp(E, wb, members, L);
  }
  // a wall section on the side the band comes from, or the gate when the walls are down
  const range = SIEGE_SPEC[kind].range;
  const cands = siegeMarks(C, L.x, L.z).map((W) => ({ W, f: siegeFace(W) })); // [siege2] the weakest way in first: a cracked or nearer tower too (04i_siege2.js)
  for (const { W, f } of cands) { spot = siegeFindSpot(f.x, f.z, f.nx, f.nz, range, C); if (spot) { target = { C, W }; work = spot; break; } }
  if (target) SIEGE2.stats[target.W.kind === 'tower' ? 'towerMarks' : 'curtainMarks']++; // [siege2]
  if (!spot) {
    const g = siegeGatePoint(S);
    spot = siegeFindSpot(g.x, g.z, g.nx, g.nz, range, C);
    if (!spot || !doorVulnerable(D)) return null;
    target = { C, gate: true }; work = spot;
  }
  const aimP = target.W ? siegeFace(target.W) : siegeGatePoint(S);
  // the mangonel is put together a little way back and rolled up; the trebuchet is raised where it will stand
  let build = work;
  if (kind === 'mangonel') { const dx = work.x - aimP.x, dz = work.z - aimP.z, d = Math.hypot(dx, dz), bx = work.x + (dx / d) * 10, bz = work.z + (dz / d) * 10; if (siegeSpotOk(bx, bz, C) && segmentClear(bx, bz, work.x, work.z, 1.2)) build = { x: bx, z: bz }; }
  const E = siegeCreate(kind, wb.realm, build.x, build.z, Math.atan2(aimP.x - work.x, aimP.z - work.z), target, work);
  return siegeCrewUp(E, wb, members, L);
}
function siegeCrewUp(E, wb, members, L) {
  E.wb = wb;
  const pool = members.filter((m) => m !== L && m.carrying == null && m.cls !== 'priest' && !m.siegeCrew).sort((a, b) => dist2(a.x, a.z, E.x, E.z) - dist2(b.x, b.z, E.x, E.z));
  pool.slice(0, E.spec.crew).forEach((m, i) => siegeAddCrew(E, m, i));
  siegeGround(E);
  const S = E.target.C.S;
  news(`${typeof wbName === 'function' ? wbName(wb) : REALMS[wb.realm].name} builds a ${E.spec.label} before ${S.name} ${E.kind === 'ram' ? 'to break its gate' : E.target.W ? (E.target.W.kind === 'tower' ? 'to bring down a tower' : 'to breach its wall') : 'to batter its gate'}.`, wb.realm, 'order'); // [siege2] a tower
  return E.id;
}
// the band's breach route: up to the gap, over the rubble, into the court
function siegeBreachRoute(W) {
  if (W.kind === 'tower') return towerBreachRoute(W); // [walls] in over the rubble, out at the store room's door (04g_breach.js)
  const f = siegeFace(W), C = W.C;
  return [{ x: f.x + f.nx * 7, z: f.z + f.nz * 7 }, { x: W.wx + f.nx * 1.2, z: W.wz + f.nz * 1.2 }, { x: W.wx - f.nx * 3, z: W.wz - f.nz * 3 }, { x: lerp(W.wx - f.nx * 6, C.S.x, 0.3), z: lerp(W.wz - f.nz * 6, C.S.z, 0.3) }];
}
function siegeOpenBreach(C, x, z) {
  let best = null, bd = Infinity;
  for (const W of [...(C.sections || []), ...palisadeGaps(C)]) { if (W.state !== 'breach' || (W.kind === 'tower' && !siegeTowerWayOk(W))) continue; const d = dist2(W.wx, W.wz, x, z) * (W.kind === 'tower' ? 1.5 : 1); if (d < bd) { bd = d; best = W; } } // [siege2] a fallen tower too: the band goes through it one or two at a time (siegeStormBand, 04i_siege2.js)
  return best;
}
// [campaign tuning] a raid that has broken into a temple: its boldest fighter runs for the hallow and takes it,
// instead of the whole band brawling round the altar until the wardens and the defenders wear it down
function siegeRaidGrab(wb, O) {
  const rel = O.relic;
  if (!rel || rel.state !== 'temple') return;
  const rp = relicPosition(rel);
  const m = wbMembers(wb).filter((e) => e.cls !== 'priest' && e.carrying == null && !e.siegeCrew).sort((a, b) => dist2(a.x, a.z, rp.x, rp.z) - dist2(b.x, b.z, rp.x, rp.z))[0];
  if (m && dist(m.x, m.z, rp.x, rp.z) < 26) { m.hallowRun = { rel, until: GAME.t + 1.5 }; }
}
// a soldier running for a hallow (from thinkSoldier): true while it does
function siegeHallowRun(e, dt) {
  const h = e.hallowRun;
  if (!h || GAME.t > h.until || h.rel.state !== 'temple' || e.carrying != null) { e.hallowRun = null; return false; }
  const rp = relicPosition(h.rel);
  e.target = null; e.casting = null;
  if (e.mount) dismount(e);
  moveToward(e, rp.x, rp.z, dt, 1.15, 1.2);
  return true;
}
// called at the end of updateWarband: engines, breaches, and where the leader goes while they work
function siegeBandAfter(wb, L, O) {
  if (O && O.type === 'raid' && O.phase === 'assault') siegeRaidGrab(wb, O);
  if (!O || !L || (O.type !== 'attack' && O.type !== 'raid')) return;
  const K = O.keep || null, T = O.temple || null;
  if (K && K.realm === wb.realm) return;
  const S = K ? K.site : T.site, C = castleOf(S);
  if (!C) return;
  const dS = dist(L.x, L.z, S.x, S.z);
  if (K) {
    // the gate broke while the engines worked: storm the court the usual way
    if ((O.phase === 'bombard' || O.phase === 'breach') && !K.door.alive) { O.phase = 'assault'; wbPlan(wb, K.nav.court); return; }
    // a breach: the commander sends the band through it while the gate still stands
    // ([v12] once the band is near the walls, not from 110 m off: the way to a breach is walked straight, and from far
    // off it ran into hills, water and the curtain itself; and not again for two minutes after one it could not reach)
    if (O.phase !== 'breach' && O.phase !== 'assault' && K.door.alive && dS < (O.phase === 'bombard' ? 95 : 60) && GAME.t > (O.breachBan || 0)) { // [siege2] a band guarding its engine goes for the breach it made (the engine batters on at the next weakest way in, often the next tower)
      const W = siegeOpenBreach(C, L.x, L.z);
      if (W && siegeStormReady(wb, O, W, L)) { O.phase = 'breach'; O.breach = W; O.bi = 0; O.bprog = null; SIEGE.stats.breachAssaults++; news(`${typeof wbName === 'function' ? wbName(wb) : REALMS[wb.realm].name} storms ${W.kind === 'tower' ? 'the fallen tower' : 'the breach in the wall'} of ${S.name}!`, wb.realm, 'order'); } // [siege2] // [war2] a fallen tower only with enough to get through its door (08j_war2.js)
    }
    if (O.phase === 'breach') {
      const W = O.breach;
      if (!W || W.state !== 'breach') { O.phase = 'siege'; O.breach = null; wbPlan(wb, K.nav.gate); return; }
      if (W.kind === 'tower') siegeStormBand(wb, L, O, W); // [siege2] each member walks the way in, one or two at a time through the store room (04i_siege2.js)
      const Rt = siegeBreachRoute(W);
      if (O.bi < Rt.length && dist(L.x, L.z, Rt[O.bi].x, Rt[O.bi].z) < 2.4) O.bi++;
      const q = O.bi < Rt.length ? Rt[O.bi] : K.nav.court;
      wb.leaderGoal = { x: q.x, z: q.z };
      // [v12] no nearer to the next point of the way in for 20 s: give the breach up for the gate
      const dq = dist(L.x, L.z, q.x, q.z), bp = O.bprog || (O.bprog = { d: dq, t: GAME.t, i: O.bi });
      if (bp.i !== O.bi || bp.d - dq > 1.5) { O.bprog = { d: dq, t: GAME.t, i: O.bi }; }
      else if (GAME.t - bp.t > 20 && !wb.engaged) { O.phase = 'siege'; O.breach = null; O.bprog = null; O.breachBan = GAME.t + 120; wbPlan(wb, K.nav.gate); SIEGE.stats.breachGiveUps = (SIEGE.stats.breachGiveUps || 0) + 1; }
      return;
    }
  }
  if (T && raidGapStep(wb, L, O, T)) return; // [war2] a raid goes in by a gap burnt in the timber hallow's ring (08j_war2.js)
  // the engine plan: once, when the band first comes within reach of the walls
  if (O.siegeE === undefined && dS < 105 && (O.phase === 'travel' || O.phase === 'siege')) O.siegeE = siegePlanFor(wb, O);
  const E = O.siegeE ? siegeById(O.siegeE) : null;
  if (E && !siegeActive(E)) { O.siegeE = null; if (O.phase === 'bombard') { O.phase = 'travel'; wbPlan(wb, K ? K.nav.gate : T.nav.tg); } return; }
  if (!E) return;
  // [depth] a band of the usual size stands guard by its catapult while it batters the wall, so no sally takes it
  // and the whole band is there to storm the breach when the wall falls; only a big band (eight or more besides
  // the crew) goes on to the gate as well, leaving the crew to their work. A wall that will not fall in four
  // minutes is given up on, and the band goes to the gate.
  if (E.state === 'work' && O.bombSince === undefined) O.bombSince = GAME.t;
  // [v12] and an engine that has not begun to work two and a half minutes after it was planned (stuck on its way to
  // its place, or never built) is given up too: the band waited by it for the rest of the war
  if (O.bombFirst === undefined) O.bombFirst = GAME.t;
  const idleEngine = E.state !== 'work' && O.bombSince === undefined && GAME.t - O.bombFirst > 150;
  if (E.kind !== 'ram' && E.target.W && O.phase !== 'assault' && O.phase !== 'siege' && wbMembers(wb).length - E.crew.length < 8 && !(GAME.t - (O.bombSince ?? GAME.t) > 240) && !idleEngine) {
    if (O.phase !== 'bombard') O.phase = 'bombard';
    wb.leaderGoal = { x: lerp(E.work.x, E.target.C.S.x, 0.16), z: lerp(E.work.z, E.target.C.S.z, 0.16) };
  } else if (O.phase === 'bombard') { O.phase = 'travel'; wbPlan(wb, K ? K.nav.gate : T.nav.tg); }
}
// a band defending a keep, with nobody better to fight: the enemy's engines before its walls
function siegeFoeEngine(e, O) {
  if (!O || O.type !== 'defend' || !O.keep) return null;
  const S = O.keep.site;
  let best = null, bd = Infinity;
  for (const E of SIEGE.engines) {
    if (!siegeActive(E) || E.realm === e.faction || !E.ent.alive) continue;
    if (dist2(E.x, E.z, S.x, S.z) > 100 * 100) continue;
    const d = dist2(E.x, E.z, e.x, e.z);
    if (d < bd) { bd = d; best = E.ent; }
  }
  return best;
}
// how much danger the engines and breaches put a keep in, for the commanders (0..1)
function siegeDanger(K) {
  const C = castleOf(K.site);
  let d = 0;
  if (C && C.sections) for (const W of C.sections) d = Math.max(d, W.state === 'breach' ? 0.9 : W.wear * 0.6);
  for (const W of palisadeGaps(C)) if (W.state === 'breach') d = Math.max(d, 0.9); // [siege2] a palisade burnt through (04g_burn.js)
  for (const E of SIEGE.engines) if (siegeActive(E) && E.realm !== K.realm && E.target && E.target.C === C) d = Math.max(d, E.state === 'work' ? 0.7 : 0.5);
  return d;
}

/* ------------------------------------------------------------------ */
/* the garrison: plugging a breach, sallying out                       */
/* ------------------------------------------------------------------ */
function siegeOnBreach(W) {
  SIEGE.stats.breaches++;
  const K = W.C.S.keepRef;
  if (!K) return;
  const f = siegeFace(W);
  let n = 0;
  for (const id of K.guards) {
    const g = getEnt(id);
    if (!g || !g.alive || g.ai.wall) continue;
    if (W.kind === 'burnt' && g.ai.plug && g.ai.plug.W !== W && g.ai.plug.W.state === 'breach') continue; // [siege2] a palisade's burnt gap takes those not already holding another (04g_burn.js)
    g.ai.plug = W.kind === 'tower' ? { W, ...towerPlugAt(W, n) } : { W, x: W.wx - f.nx * 3.2 + W.wax * (n - 1) * 1.1, z: W.wz - f.nz * 3.2 + W.waz * (n - 1) * 1.1 }; // [walls] a tower's: before its courtyard door (04g_breach.js)
    g.ai.sally = null;
    n++;
  }
  const Lr = getEnt(K.lord);
  if (Lr && Lr.alive) Lr.ai.plug = { W, x: W.wx - f.nx * 6, z: W.wz - f.nz * 6 };
  if (n) { SIEGE.stats.plugs++; if (GAME.t > (W.C.plugNewsAt || 0)) { W.C.plugNewsAt = GAME.t + 30; news(`The garrison of ${W.C.S.name} runs to hold the breach.`, K.realm, 'normal'); } } // [siege2] told once in a while (a palisade burns through stretch by stretch)
}
function siegeOnRepair(W) {
  const K = W.C.S.keepRef;
  if (!K) return;
  for (const id of [...K.guards, K.lord]) { const g = getEnt(id); if (g && g.ai.plug && g.ai.plug.W === W) g.ai.plug = null; }
}
// garrison thinking (from thinkPosted): true when a plug or a sally has the body
function siegePostedThink(e, dt) {
  const pl = e.ai.plug;
  if (pl) {
    if (pl.W.state !== 'breach' || !e.keep || e.keep.realm !== e.faction) { e.ai.plug = null; return false; }
    // hold the gap: fight whoever comes through it, else stand in it
    let t = getEnt(e.target);
    if (!t || !t.alive || !isEnemy(e, t) || dist(t.x, t.z, pl.x, pl.z) > 16) { t = GAME.t > (e.ai.nextScan || 0) ? pickTarget(e, 16) : null; e.ai.nextScan = GAME.t + 0.5; }
    if (t && dist(t.x, t.z, pl.x, pl.z) < 16) { if (e.cls === 'priest' || t) npcAbilities(e, t); fightTarget(e, t, dt); return true; }
    e.target = null;
    moveToward(e, pl.x, pl.z, dt, 1.1, 0.4);
    return true;
  }
  const s = e.ai.sally;
  if (!s) return false;
  const K = s.K, S = K.site;
  if (K.realm !== e.faction || !K.door.alive) { e.ai.sally = null; return false; }
  const gi = siteToWorld(S, 0, S.gateLocal.z - 4.5), go = siteToWorld(S, 0, S.gateLocal.z + 5.5);
  const inside = castleInside(castleOf(S), e.x, e.z);
  if (s.phase === 'out') {
    if (inside) { if (dist(e.x, e.z, gi.x, gi.z) > 1.2 && !s.through) moveToward(e, gi.x, gi.z, dt, 1.1, 0.3); else { s.through = true; moveToward(e, go.x, go.z, dt, 1.1, 0.3); } return true; }
    s.through = true;
    // out on the field: the engine first, then whoever stands near it
    const E = s.E ? siegeById(s.E) : null;
    let t = E && siegeActive(E) && E.ent.alive ? E.ent : null;
    if (!t || dist(e.x, e.z, t.x, t.z) > 6) { const o = GAME.t > (e.ai.nextScan || 0) ? pickTarget(e, 14) : null; e.ai.nextScan = GAME.t + 0.5; if (o) t = o; }
    if (!t) t = getEnt(e.target);
    if (t && t.alive && isEnemy(e, t)) { npcAbilities(e, t.kind === 'door' ? null : t); fightTarget(e, t, dt); }
    else s.phase = 'back';
    return true;
  }
  // back home through the gate
  e.target = null;
  if (!inside) { if (dist(e.x, e.z, go.x, go.z) > 1.5 && !s.home) moveToward(e, go.x, go.z, dt, 1.15, 0.4); else { s.home = true; moveToward(e, gi.x, gi.z, dt, 1.0, 0.3); } return true; }
  e.ai.sally = null;
  return false;
}
function siegeSallies(dt) {
  const now = GAME.t;
  for (const K of WAR.keeps) {
    const C = castleOf(K.site);
    if (!C || !C.gate) continue;
    const G0 = C.gate, S = K.site;
    const party = [...K.guards].map(getEnt).filter((g) => g && g.alive && g.ai.sally && g.ai.sally.K === K);
    if (party.length) {
      // the gate stands open while the party passes through it, and shuts behind them
      const gp = siegeGatePoint(S);
      const passing = party.some((g) => dist(g.x, g.z, gp.x, gp.z) < 7.5 && ((g.ai.sally.phase === 'out' && !g.ai.sally.leftGate) || g.ai.sally.phase === 'back'));
      for (const g of party) if (g.ai.sally.phase === 'out' && g.ai.sally.through && dist(g.x, g.z, gp.x, gp.z) > 8) g.ai.sally.leftGate = true;
      G0.sallyOpen = passing; G0.sallyUntil = now + 0.5;
      // called back when the work is done, the party is cut down, or it has been out too long
      const s0 = party[0].ai.sally, E = s0.E ? siegeById(s0.E) : null;
      if (now > s0.until || (s0.E && !siegeActive(E)) || party.length < 2) for (const g of party) if (g.ai.sally.phase === 'out') g.ai.sally.phase = 'back';
      continue;
    }
    if (now < (SIEGE.sallyNext.get(K) || 0) || !K.door.alive || CAMPAIGN.state !== 'war') continue;
    SIEGE.sallyNext.set(K, now + 2 + Math.random());
    const guards = [...K.guards].map(getEnt).filter((g) => g && g.alive && !g.ai.wall && !g.ai.plug && !g.ai.route && castleInside(C, g.x, g.z));
    if (guards.length < 2) continue;
    // who stands outside the gate: a sally never goes out into more foes than it has swords
    const gp = siegeGatePoint(S);
    let atGate = 0;
    forNear(gp.x, gp.z, 26, (o) => { if (o.alive && isActor(o) && o.faction <= 2 && o.faction !== K.realm && !castleInside(C, o.x, o.z)) atGate++; });
    if (atGate > guards.length) continue;
    // an engine before the walls, left lightly guarded: go out and break it
    let E = null;
    for (const Q of SIEGE.engines) {
      if (!siegeActive(Q) || Q.realm === K.realm || !Q.target || Q.target.C !== C || Q.build < 0.3 || dist2(Q.x, Q.z, gp.x, gp.z) > 75 * 75) continue;
      let n = 0;
      forNear(Q.x, Q.z, 16, (o) => { if (o.alive && isActor(o) && o.faction <= 2 && o.faction !== K.realm) n++; });
      if (n < guards.length) { E = Q; break; }
    }
    // or the last of a besieging warband at the gate, too few to hold it if the garrison comes out at them
    // (a lone wanderer or a single raider at the gate does not draw the garrison out: the gate stays shut)
    let band = 0;
    if (!E && now < K.underSiegeUntil) forNear(gp.x, gp.z, 26, (o) => { if (o.alive && o.role === 'soldier' && o.warband && o.faction !== K.realm && !castleInside(C, o.x, o.z)) band++; });
    const few = !E && band > 0 && band === atGate && atGate <= 2 && guards.length >= atGate + 2;
    if (!E && !few) continue;
    for (const g of guards) g.ai.sally = { K, E: E ? E.id : null, phase: 'out', until: now + (E ? 50 : 30), through: false };
    SIEGE.stats.sallies++;
    SIEGE.sallyNext.set(K, now + 75 + Math.random() * 30); // a garrison does not throw its gate open every minute
    news(`The gate of ${S.name} opens: its garrison sallies out ${E ? `against the ${REALMS[E.realm].name} ${E.spec.label}` : 'at the attackers'}!`, K.realm, 'normal');
  }
}

/* ------------------------------------------------------------------ */
/* the player at an engine                                             */
/* ------------------------------------------------------------------ */
function siegeOffers(P, offer) {
  if (P.carrying != null || P.mount) return;
  for (const E of SIEGE.engines) {
    if (!siegeActive(E) || E.state === 'build') continue;
    const d = dist(P.x, P.z, E.x, E.z);
    if (d > E.spec.radius + 2.5) continue;
    const name = E.spec.label;
    if (E.player) { offer(0.1, 1, `Leave the ${name}`, () => siegeLeave(E), 0.6); continue; }
    if (E.realm === P.faction) offer(d, E.spec.radius + 2.5, `Join the crew of the ${name}`, () => siegeJoin(E), 0.2);
    else if (!E.crew.length) offer(d, E.spec.radius + 2.5, `Take over the abandoned ${name}`, () => siegeJoin(E), 0.2);
  }
}
function siegeJoin(E) {
  const P = GAME.player;
  if (!P || !siegeActive(E)) return;
  for (const Q of SIEGE.engines) if (Q.player && Q !== E) siegeLeave(Q, true);
  if (E.realm !== P.faction) {
    // taken over: it is ours now, and turns on the nearest enemy wall in reach
    const was = REALMS[E.realm].name;
    E.realm = P.faction; E.ent.faction = P.faction; E.ent.name = `${REALMS[P.faction].name} ${E.spec.label}`; E.wb = null;
    E.target = null;
    news(`${P.name} has taken over the ${was} ${E.spec.label}!`, P.faction, 'normal');
  }
  E.player = true;
  E.pslot = E.kind === 'ram' ? 1 : 0;
  // its last orders may be done: the nearest enemy wall or gate in reach
  if (!siegeTargetOk(E)) siegePlayerTarget(E);
  SIEGE.stats.playerCrew++;
  const p = siegeSlot(E, E.pslot);
  P.x = P.prevX = p.x; P.z = P.prevZ = p.z;
  uiToast(E.target && siegeTargetOk(E) ? `You take your place at the ${E.spec.label}. Walk away to leave it.` : `You take your place at the ${E.spec.label}, but nothing of the enemy's is in its reach.`);
}
function siegePlayerTarget(E) {
  const P = GAME.player;
  let best = null, bd = Infinity;
  for (const C of CASTLES) {
    const K = C.S.keepRef, T = C.S.templeRef;
    if ((K && K.realm === P.faction) || (T && T.realm === P.faction)) continue;
    if (E.kind === 'ram') {
      const D = siegeDoorOf(C.S);
      if (!D || !D.alive || !doorVulnerable(D)) continue;
      const g = siegeGatePoint(C.S), d = dist(E.x, E.z, g.x, g.z);
      if (d < 80 && d < bd) { bd = d; best = { C, gate: true, g }; }
      continue;
    }
    const range = E.spec.range + 12;
    for (const W of C.sections || []) { if (W.state !== 'whole' || W.kind === 'tower') continue; const f = siegeFace(W), d = dist(E.x, E.z, f.x, f.z); if (d < range && d < bd) { bd = d; best = { C, W }; } } // [walls] the engines keep to the curtains (04g_breach.js)
    const D = siegeDoorOf(C.S);
    if (D && D.alive && doorVulnerable(D)) { const g = siegeGatePoint(C.S), d = dist(E.x, E.z, g.x, g.z); if (d < range && d < bd) { bd = d; best = { C, gate: true }; } }
  }
  if (!best) { E.target = E.target || null; if (E.state === 'work') E.state = 'idle'; return false; }
  if (E.kind === 'ram') {
    const g = best.g;
    E.target = { C: best.C, gate: true };
    E.work = { x: g.x + g.nx * RAM_REACH, z: g.z + g.nz * RAM_REACH };
    E.yaw = Math.atan2(E.work.x - E.x, E.work.z - E.z);
    if (dist(E.x, E.z, E.work.x, E.work.z) > 0.6) E.state = 'move';
    return true;
  }
  E.target = { C: best.C, W: best.W, gate: best.gate };
  const aimP = best.W ? siegeFace(best.W) : siegeGatePoint(best.C.S);
  E.yaw = Math.atan2(aimP.x - E.x, aimP.z - E.z);
  if (E.coll) { E.coll.active = false; E.coll = null; siegeSettle(E); }
  E.state = 'work';
  return true;
}
function siegeLeave(E, quiet = false) {
  if (!E.player) return;
  E.player = false;
  if (!quiet) uiToast(`You leave the ${E.spec.label}.`);
}
// the player stays at the slot while they crew it, and works with the others; walking away leaves it
function siegePlayerStep() {
  const P = GAME.player;
  for (const E of SIEGE.engines) {
    if (!E.player) continue;
    if (!P || !P.alive || !siegeActive(E)) { siegeLeave(E, true); continue; }
    // the player's own steps (they are put back on the slot every step) mean they are walking away
    const s = siegeSlot(E, E.pslot), d = dist(P.x, P.z, s.x, s.z);
    if (d > (E.state === 'move' ? 0.3 : 0.15)) { siegeLeave(E); continue; }
    if (E.state === 'move') { P.x = lerp(P.x, s.x, 0.5); P.z = lerp(P.z, s.z, 0.5); }
    else if (d > 0.05) { P.x = s.x; P.z = s.z; }
    P.prevX = P.x; P.prevZ = P.z;
  }
}

/* ------------------------------------------------------------------ */
/* the tick                                                            */
/* ------------------------------------------------------------------ */
function updateSiege(dt) {
  if (!WAR.keeps.length) return;
  // engines at work and bands at a breach keep their castle from feeling quiet: nobody rebuilds under fire
  const now = GAME.t;
  for (const E of SIEGE.engines) if (siegeActive(E) && (E.crew.length || E.player) && E.target) { const K = E.target.C.S.keepRef; if (K && K.realm !== E.realm) K.lastEnemyNear = now; }
  for (const wb of WAR.warbands) { const O = wb.order; if (!wb.dead && O && O.keep && (O.phase === 'breach' || O.phase === 'bombard') && O.keep.realm !== wb.realm) O.keep.lastEnemyNear = now; }
  for (const E of SIEGE.engines.slice()) if (!E.gone) siegeEngineStep(E, dt);
  for (let i = SIEGE.engines.length - 1; i >= 0; i--) if (SIEGE.engines[i].gone) SIEGE.engines.splice(i, 1);
  siegeStonesStep(dt);
  updatePalisades(dt); // [siege2] the burhs' palisades burn, burn through and are built back (04g_burn.js)
  siegeSallies(dt);
  siegePlayerStep();
}

/* ------------------------------------------------------------------ */
/* test hooks: window.__hm.SIEGE                                       */
/* ------------------------------------------------------------------ */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.SIEGE = {
    SIEGE, SIEGE_SPEC, siegeCreate, siegePlanFor, siegeIgnite, siegeJoin, siegeLeave, siegeById, siegeFace, siegeGatePoint, siegeDanger, siegeOpenBreach, siegeBreachRoute, siegeRemove, siegeOffers,
    stats() { return { ...SIEGE.stats, active: siegeCountOf(), stones: SIEGE.stones.length }; },
    // a warband of realm r mustered some way out in front of a keep's gate, ordered to attack it
    band(r, keepId, d = 95, size = 10, side = 0) {
      const K = WAR.keeps[keepId], g = siegeGatePoint(K.site), wb = spawnWarband(r, size);
      const x0 = g.x + g.nx * d - g.nz * side, z0 = g.z + g.nz * d + g.nx * side;
      wbMembers(wb).forEach((e, i) => { e.x = e.prevX = x0 + (i % 4) * 1.6 - 2.4; e.z = e.prevZ = z0 + Math.floor(i / 4) * 1.6; e.y = heightAt(e.x, e.z); });
      wbSetOrder(wb, { type: 'attack', keep: K, why: 'test' });
      return wb.id;
    },
    interaction() { const it = currentInteraction(); return it ? it.label : null; },
    wb(id) { const wb = WAR.warbands.find((w) => w.id === id); if (!wb) return null; const L = wbLeader(wb), O = wb.order; return { id, dead: !!wb.dead, n: wbMembers(wb).length, order: O ? O.type : null, phase: O ? O.phase : null, siegeE: O ? O.siegeE : null, L: L ? { x: +L.x.toFixed(1), z: +L.z.toFixed(1) } : null, crew: wbMembers(wb).filter((e) => e.siegeCrew).length }; },
    engines() { return SIEGE.engines.filter((E) => !E.gone).map((E) => ({ id: E.id, kind: E.kind, realm: E.realm, state: E.state, ph: E.ph, build: +E.build.toFixed(2), x: +E.x.toFixed(1), z: +E.z.toFixed(1), y: +E.y.toFixed(2), crew: E.crew.length, player: E.player, hp: Math.round(E.ent.hp), maxHp: Math.round(E.ent.maxHp), alive: E.ent.alive, burn: +E.burn.toFixed(2), arm: +E.arm.toFixed(2), psi: +E.psi.toFixed(2), loaded: E.loaded, shots: E.shots, hits: E.hitsOn, target: E.target ? { site: E.target.C.S.name, W: E.target.W ? E.target.W.k : null, gate: !!E.target.gate } : null, work: { x: +E.work.x.toFixed(1), z: +E.work.z.toFixed(1) } })); },
  };
});
