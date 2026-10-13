/* ================================================================== */
/* [late3] the Deep Barrow: the halls of the first kings, beneath the  */
/* Hollow King's hall                                                  */
/* ================================================================== */
// (version 17) A veteran's descent. A stair goes down from the south wall of the Hollow King's hall, sealed by the
// first kings' runes until he has fallen to you and you are level 45 (`late3SealReady`). Below lie halls of their own,
// built on the Barrow's grid (they are rooms of `DUN_ROOMS` with `deep` set, 04d_barrow.js hands their cells, walls,
// roofs and floor to this module), older and hotter than the Barrow above, lit by what burns there:
//  - the Long Stair, from the seal down twelve metres to a landing;
//  - the Sunken Cistern: a basin between walkways. Its sluices burst as you cross it and the water rises (real water:
//    `late3WaterAt` answers `waterAt` there, so bodies wade and swim, fire on them goes out, it can be drunk), and the
//    drowned rise with it;
//  - the Hall of Pyres: channels of pitch between the pyres. Fire spreads along them cell by cell (a fire spell, the
//    pyre-keeper's Kindle, the lord's Word), burns whoever stands in it and burns out; the pitch seeps back;
//  - the Breaking Gallery: its floor is slabs over a pit of embers. A slab stood on too long cracks and falls (a heavy
//    blow too), and whoever stood on it falls into the embers and climbs out; the slabs rise again in time. A cracked
//    wall hides a forgotten tomb: break it;
//  - the Ash Throne: Vorlach the Ash-Crowned, the first of the barrow-kings. A fight in phases: a cleave to parry,
//    shield or step out of; the Ember Word, a spell to break (a stun or a bash, a priest's Holy Fire, a mage's storm,
//    a blunt arrow, a mace) or the pitch about his foes catches; from two thirds he stamps and the slabs of his hall
//    crack and fall; at a third he burns with fury. He scales with you to 50 and past (`barrowBoost`, and veterancy).
// His hoard is at the top of the gear curve, his fall a deed with a name (Ashbane), and the descent has its page in the
// Chronicle, its aims, its field notes and the herald's word. Saved with the character (save part `char.x.deep`).

const DEEP_Y = -18, DEEP_PIT = -20.8, DEEP_POOL = -19.9, DEEP_STEP = 0.5, DEEP_LV = 45;
const DEEP_ROOMS = [
  { id: 'dstair', name: 'The Long Stair', u: [191, 195], v: [15, 37], fy: -7, h: 4.6, deep: true },
  { id: 'dland', name: 'The Long Stair', u: [187, 199], v: [37, 43], fy: DEEP_Y, h: 6, deep: true },
  { id: 'cistern', name: 'The Sunken Cistern', u: [150, 187], v: [36, 61], fy: DEEP_Y, h: 8, deep: true },
  { id: 'dpass1', name: 'The Sunken Cistern', u: [142, 150], v: [45, 51], fy: DEEP_Y, h: 5, deep: true },
  { id: 'pyres', name: 'The Hall of Pyres', u: [104, 142], v: [36, 62], fy: DEEP_Y, h: 9, deep: true },
  { id: 'dpass2', name: 'The Hall of Pyres', u: [96, 104], v: [46, 52], fy: DEEP_Y, h: 5, deep: true },
  { id: 'crack', name: 'The Breaking Gallery', u: [64, 96], v: [46, 52], fy: DEEP_Y, h: 6, deep: true },
  { id: 'nichedoor', name: 'The Breaking Gallery', u: [66, 69], v: [52, 53], fy: DEEP_Y, h: 3.4, deep: true },
  { id: 'niche', name: 'The Breaking Gallery', u: [63, 71], v: [53, 58], fy: DEEP_Y, h: 4, deep: true },
  { id: 'dpass3', name: 'The Breaking Gallery', u: [56, 64], v: [46, 52], fy: DEEP_Y, h: 5, deep: true },
  { id: 'ashhall', name: 'The Ash Throne', u: [20, 56], v: [34, 64], fy: DEEP_Y, h: 13, deep: true },
];
for (const R of DEEP_ROOMS) { R.idx = DUN_ROOMS.length; DUN_ROOMS.push(R); DUN_ROOM[R.id] = R; }
const DEEP_POOLR = [154, 183, 42, 55]; // the cistern's basin: u0, u1, v0, v1
const DEEP_SLABS = [];
for (let i = 0; i < 5; i++) DEEP_SLABS.push({ hall: 'crack', u0: 72 + i * 4, u1: 76 + i * 4, v0: 46, v1: 52 });
for (const [v0, v1] of [[35, 41], [57, 63]]) for (let i = 0; i < 6; i++) DEEP_SLABS.push({ hall: 'ash', u0: 30 + i * 4, u1: 34 + i * 4, v0, v1 });
// the lord: his might over a barrow-king's (dungeonBoss), his harm, his clocks
const DEEP_LORD = { base: 24, hp: 3.4, dmg: 1.0, scale: 1.78, speed: 5.0, speedRage: 6.0, wordT: 2.8, wordRage: 2.2, wordCd: [16, 19], wordCdRage: 11, cleaveCd: [7, 9], stampCd: [11, 13], respawn: 900, vetK: 0.01, vetMax: 30 };
const DEEP_SEAL = { u: 193, v: 15.45, w: 4.2, h: 4.5 };
const DEEP = {
  built: false, opened: false, kills: 0, wallBroken: false, seal: null, slabs: [], cells: [], wall: null, rubble: null,
  wy: DEEP_POOL + 0.4, flood: { st: 0, t: 0, next: 0, drowned: [] }, chests: [], lord: null, lordDead: false, lordAt: 0, lordSeen: false,
  packs: [], adds: new Set(), heat: null, heatTex: null, heatDirty: false, water: null, fires: [], marks: [], lastDeep: -99, inDeep: false,
  taken: {}, step: 0, near: { seal: false, slab: false, pitch: false, deep: false },
  stats: { sealOpened: 0, words: 0, wordsBroken: 0, cleaves: 0, stamps: 0, slabsBroken: 0, slabsRisen: 0, falls: 0, lit: 0, burnt: 0, burnHits: 0, floods: 0, lordFell: 0, wallBroken: 0, chests: 0, kindled: 0, kindleBroken: 0, grasps: 0, embers: 0, calls: 0, spawned: 0 },
};
const late3Room = (x, z) => { const R = dunRoomAt(x, z); return R && R.deep ? R : null; };
const late3InDeep = (e) => !!e && inDungeon(e) && !!late3Room(e.x, e.z);
function late3IsDeepCell(k) { return k >= 0 && DUN.room && DUN.room[k] >= 0 && !!DUN_ROOMS[DUN.room[k]].deep; }
const deepCellOf = (u, v) => dunIdx(Math.floor(u) - DUN.u0, Math.floor(v) - DUN.v0);
// the Hollow King laid to rest by you, and level 45: the seal yields
const late3KingFallen = () => (typeof LATE2 === 'object' && LATE2.d.king > 0) || (!!GAME.prog && (GAME.prog.kingKills || 0) > 0);
const late3SealReady = () => !!GAME.prog && GAME.prog.level >= DEEP_LV && late3KingFallen();
function late3SealWhy() {
  const lv = GAME.prog ? GAME.prog.level : 1, k = late3KingFallen();
  if (lv >= DEEP_LV && k) return '';
  if (!k && lv < DEEP_LV) return `The first kings' runes hold it shut. It yields to one who has laid the Hollow King to rest and reached level ${DEEP_LV}.`;
  if (!k) return 'The runes stir at your touch, but hold. Lay the Hollow King to rest first: the seal knows his slayer.';
  return `The runes know you for the Hollow King's slayer, but hold. Come back at level ${DEEP_LV} (you are ${lv}).`;
}

/* ------------------------------------------------------------------ */
/* the grid: the stair's steps, the basin, the slabs, the dais          */
/* ------------------------------------------------------------------ */
// buildDungeonGrid (04d_barrow.js) asks once every room is laid in, before the rock borrows its neighbours' heights
function late3Grid(cell, room, fy, cy) {
  const set = (u, v, f) => { const k = deepCellOf(u, v); if (k >= 0) f(k); };
  // the Long Stair: half a metre down for every metre, drawn by its own steps (cell type 3)
  for (let v = 15; v < 37; v++) for (let u = 191; u < 195; u++) set(u, v, (k) => { cell[k] = 3; fy[k] = -7 - (v - 14) * DEEP_STEP; cy[k] = fy[k] + 4.6; });
  for (let u = DEEP_POOLR[0]; u < DEEP_POOLR[1]; u++) for (let v = DEEP_POOLR[2]; v < DEEP_POOLR[3]; v++) set(u, v, (k) => { fy[k] = DEEP_POOL; });
  // the slabs over the pits: open ground drawn by their own meshes (cell type 4); a fallen one is no ground (0)
  for (const S of DEEP_SLABS) for (let u = S.u0; u < S.u1; u++) for (let v = S.v0; v < S.v1; v++) set(u, v, (k) => { cell[k] = 4; });
  for (let u = 20; u < 27; u++) for (let v = 43; v < 54; v++) set(u, v, (k) => { fy[k] = -17.4; });
}

/* ------------------------------------------------------------------ */
/* the look of the deep: dark basalt, ash, ember-lit joints             */
/* ------------------------------------------------------------------ */
const DEEP_STONE = [0.25, 0.235, 0.22], DEEP_STONE2 = [0.19, 0.18, 0.17], DEEP_EMBER = [1.0, 0.38, 0.1], DEEP_COLD = [0.22, 0.55, 0.58];
const deepX = (u) => DUN.ox + u, deepZ = (v) => DUN.oz + v;
const deepFloorMat = mat({
  uniforms: { uHot: { value: new THREE.Vector4(0, 0, 0, 0) }, uWetBox: { value: new THREE.Vector4(0, 0, 0, 0) } },
  vertexShader: /* glsl */`
    varying vec3 vW; varying vec3 vN;
    void main(){ vW = position; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    ${GLSL_DECAL}
    uniform vec4 uHot, uWetBox;
    varying vec3 vW; varying vec3 vN;
    float inBox(vec4 b){ return step(b.x, vW.x) * step(vW.x, b.z) * step(b.y, vW.z) * step(vW.z, b.w); }
    void main(){
      vec3 n = safeNormalize(vN);
      // great flags of basalt, older than the Barrow's, worn smooth, their joints full of ash
      vec2 p = vW.xz / 1.35;
      vec2 c = floor(p), f = fract(p);
      float d1 = 9.0, d2 = 9.0; vec2 best = c;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 r = o + hash22(c + o) * 0.8 + 0.1 - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; best = c + o; } else if (d < d2) d2 = d;
      }
      float edge = sqrt(d2) - sqrt(d1);
      float id = hash12(best);
      float px = length(fwidth(p));
      float jw = 0.05 + px * 0.6;
      float joint = 1.0 - smoothstep(jw, jw + 0.05 + px, edge);
      vec3 stone = mix(vec3(0.16, 0.15, 0.145), vec3(0.27, 0.25, 0.235), id) * (0.84 + 0.28 * vnoise(vW.xz * 2.7 + id * 5.0)) * (0.92 + 0.08 * vnoise(vW.xz * 15.0));
      vec3 ashc = vec3(0.36, 0.35, 0.34) * (0.85 + 0.3 * vnoise(vW.xz * 9.0));
      float ash = smoothstep(0.5, 0.82, fbm3(vW.xz * 0.21 + 7.0));
      vec3 alb = mix(stone, ashc, max(joint * 0.8, ash * 0.5 * (1.0 - joint)));
      float hot = inBox(uHot), wet = inBox(uWetBox);
      // the cistern's floor is damp, darker and catches the light
      float damp = wet * (0.55 + 0.45 * smoothstep(0.4, 0.7, fbm3(vW.xz * 0.3)));
      alb *= 1.0 - 0.45 * damp;
      gSh = 1.0;
      gPL = pointLights(vW + vec3(0.0, 0.02, 0.0), n);
      vec3 col = lightSurface(alb, n, mix(1.0, 0.55, joint));
      vec3 V = safeNormalize(cameraPosition - vW);
      float fres = 0.04 + 0.96 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      col += gPL * damp * fres * 0.7 * (1.0 - joint);
      // in the hot halls the joints glow faintly where embers lie in them
      float ember = hot * joint * smoothstep(0.45, 0.85, vnoise(vW.xz * 0.9 + vec2(uTime * 0.03, 0.0))) * (0.65 + 0.35 * sin(uTime * 1.7 + id * 20.0));
      col += vec3(1.0, 0.32, 0.07) * ember * 0.22;
      col = applyDecal(col, sampleDecal(vW.xz));
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
// the pits under the slabs: a bed of embers breathing in the dark
const deepPitMat = mat({
  vertexShader: /* glsl */`varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    varying vec3 vW;
    void main(){
      vec2 p = vW.xz * 0.85;
      float n = fbm3(p + vec2(uTime * 0.035, -uTime * 0.025));
      float cells = vnoise(p * 3.2 + n * 2.0);
      float glow = smoothstep(0.38, 0.78, n) * (0.62 + 0.38 * sin(uTime * 1.1 + n * 11.0));
      vec3 crust = vec3(0.045, 0.032, 0.026) * (0.6 + 0.7 * cells);
      vec3 col = crust + vec3(2.1, 0.72, 0.16) * glow * (0.45 + 0.55 * cells);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
// the pitch channels: black and glossy, a crust of ash once burnt, flames running along them while they burn
const DEEP_CELLS_MAX = 128;
const deepChannelMat = mat({
  uniforms: { uHeat: { value: null } },
  vertexShader: /* glsl */`
    attribute float aCell; attribute vec2 aCh;
    varying vec3 vW; varying float vCell; varying vec2 vCh;
    void main(){ vW = position; vCell = aCell; vCh = aCh; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    uniform sampler2D uHeat;
    varying vec3 vW; varying float vCell; varying vec2 vCh;
    void main(){
      vec4 s = texture2D(uHeat, vec2((vCell + 0.5) / ${DEEP_CELLS_MAX}.0, 0.5));
      float heat = s.r, ch = s.g;
      float across = vCh.x, along = vCh.y;
      float lip = 1.0 - smoothstep(0.0, 0.2, across) * smoothstep(1.0, 0.8, across);
      vec3 pitch = vec3(0.022, 0.019, 0.017);
      vec3 ashc = vec3(0.3, 0.285, 0.27) * (0.7 + 0.3 * vnoise(vW.xz * 7.0));
      vec3 alb = mix(mix(pitch, ashc, ch * 0.85), vec3(0.17, 0.16, 0.15), lip);
      vec3 n = vec3(0.0, 1.0, 0.0);
      gSh = 1.0;
      gPL = pointLights(vW + vec3(0.0, 0.03, 0.0), n);
      vec3 col = lightSurface(alb, n, 1.0);
      vec3 V = safeNormalize(cameraPosition - vW);
      float fres = 0.04 + 0.96 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      col += gPL * (0.15 + 0.6 * fres) * (1.0 - ch) * (1.0 - lip);
      float fl = vnoise(vec2(along * 1.7 - uTime * 2.3, across * 3.0 + uTime * 0.7));
      float f2 = vnoise(vec2(along * 4.3 + uTime * 1.1, uTime * 3.1 + across));
      col += vec3(2.6, 1.0, 0.24) * heat * (0.45 + 0.65 * fl + 0.35 * f2) * (1.0 - lip * 0.7);
      // a charred channel still smoulders a while
      col += vec3(1.1, 0.3, 0.06) * ch * (1.0 - heat) * smoothstep(0.55, 0.9, vnoise(vec2(along * 2.0, uTime * 0.4))) * 0.25;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
// the cistern's water: dark, still, the torches shining on it, rings where it is stirred
const deepWaterMat = mat({
  vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    varying vec3 vW;
    void main(){
      vec2 p = vW.xz;
      float t = uTime;
      vec2 g = vec2(vnoise(p * 0.7 + vec2(t * 0.16, t * 0.11)) - 0.5, vnoise(p * 0.7 + vec2(-t * 0.13, t * 0.17) + 9.1) - 0.5);
      g += 0.5 * vec2(vnoise(p * 2.3 + vec2(t * 0.4, 0.0)) - 0.5, vnoise(p * 2.3 + vec2(0.0, -t * 0.37) + 3.3) - 0.5);
      vec3 n = safeNormalize(vec3(g.x * 0.22, 1.0, g.y * 0.22));
      vec3 V = safeNormalize(cameraPosition - vW);
      float fres = 0.04 + 0.96 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      gSh = 1.0;
      gPL = pointLights(vW + vec3(0.0, 0.25, 0.0), n);
      vec3 base = vec3(0.01, 0.028, 0.03);
      vec3 col = base * (0.4 + uAmbient * 2.0) + gPL * (0.05 + 0.45 * fres) + vec3(0.02, 0.05, 0.055) * fres;
      // a cold glow in the still water: what lives in the cistern's dark (faint, drifting with the ripples)
      col += vec3(0.006, 0.03, 0.032) * (0.55 + 0.45 * vnoise(p * 0.35 + g * 2.0 + vec2(t * 0.05, 0.0)));
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});

/* ------------------------------------------------------------------ */
/* building the halls                                                  */
/* ------------------------------------------------------------------ */
function deepM(u, y, v, yaw = 0) { return dunM(u, y, v, yaw); }
// walls, headers and roofs of the deep rooms (the Barrow's own builder leaves their cells to this one)
function deepShell(b, rnd) {
  const GW = DUN.GW, GH = DUN.GH, C = DUN.cell, F = DUN.fy, CY = DUN.cy, RM = DUN.room;
  const at = (i, j) => { const k = dunIdx(i, j); return k < 0 ? 0 : C[k]; };
  const runs = new Map();
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    if (!C[k] || !late3IsDeepCell(k)) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (at(i + di, j + dj)) continue;
      const key = di ? `u${di}:${i}` : `v${dj}:${j}`;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key).push(di ? j : i);
    }
  }
  const hotRoom = (rid) => rid >= 0 && ['pyres', 'crack', 'ashhall', 'dpass2', 'dpass3', 'niche', 'nichedoor'].includes(DUN_ROOMS[rid].id);
  const WALLS = [];
  for (const [key, list] of runs) {
    list.sort((a, c) => a - c);
    const [kind, fixed] = key.split(':');
    const axisU = kind[0] === 'u', dir = +kind.slice(1);
    let start = list[0], prev = list[0];
    const flush = (a, z) => {
      let lo = Infinity, hi = -Infinity, fmax = -Infinity, rid = -1;
      for (let t = a; t <= z; t++) {
        const k = axisU ? dunIdx(+fixed, t) : dunIdx(t, +fixed);
        lo = Math.min(lo, F[k]); hi = Math.max(hi, CY[k]); fmax = Math.max(fmax, F[k]); rid = RM[k];
      }
      WALLS.push({ axisU, dir, fixed: +fixed, a, z, lo, hi, flat: fmax - lo < 0.2, room: rid });
    };
    for (let n = 1; n < list.length; n++) { if (list[n] !== prev + 1) { flush(start, prev); start = list[n]; } prev = list[n]; }
    flush(start, prev);
  }
  for (const W of WALLS) {
    const len = W.z - W.a + 1;
    const T = 1.4, y0 = W.lo - 1.2, y1 = W.hi + 0.8, H = y1 - y0;
    let cu, cv, hx, hz;
    if (W.axisU) { const face = W.fixed + DUN.u0 + (W.dir > 0 ? 1 : 0); cu = face + W.dir * T / 2; cv = DUN.v0 + W.a + len / 2; hx = T / 2; hz = len / 2 + 0.06; }
    else { const face = W.fixed + DUN.v0 + (W.dir > 0 ? 1 : 0); cv = face + W.dir * T / 2; cu = DUN.u0 + W.a + len / 2; hx = len / 2 + 0.06; hz = T / 2; }
    b.add(G.box, lm(DM0, dunWX(cu), y0 + H / 2, dunWZ(cv), 0, hx * 2, H, hz * 2), MAT.drystone, darker(DEEP_STONE, 0.8 + rnd() * 0.18), W.lo, 3.5);
    addBox(dunWX(cu), dunWZ(cv), hx, hz, 0, 'wall', H).baseY = y0;
    // great upright slabs of basalt set against the face; in the hot halls, embers in the cracks between them
    const nIn = W.axisU ? [-W.dir, 0] : [0, -W.dir], hot = hotRoom(W.room);
    for (let s = 0.8 + rnd() * 1.0; s < len - 0.7; s += 1.9 + rnd() * 1.6) {
      const t = (W.axisU ? DUN.v0 : DUN.u0) + W.a + s;
      const pu = W.axisU ? (cu - W.dir * T / 2) + nIn[0] * 0.12 : t, pv = W.axisU ? t : (cv - W.dir * T / 2) + nIn[1] * 0.12;
      const k = dunCellAt(dunWX(pu + nIn[0] * 0.6), dunWZ(pv + nIn[1] * 0.6));
      if (k < 0 || C[k] !== 1) continue;
      const fy = F[k], h = (CY[k] - fy) * (0.7 + rnd() * 0.28), w = 1.0 + rnd() * 0.9;
      const yaw = W.axisU ? Math.PI / 2 : 0;
      b.add(G.box, lm(DM0, dunWX(pu), fy + h / 2 - 0.2, dunWZ(pv), yaw + (rnd() - 0.5) * 0.06, w, h + 0.4, 0.38, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.03), MAT.rock, darker(DEEP_STONE, 0.85 + rnd() * 0.25), fy, 3);
      if (hot && rnd() < 0.55) {
        const off = (w / 2 + 0.03) * (rnd() < 0.5 ? -1 : 1);
        // (a thin line in the wall's face beside the slab: a fin as deep as the slab glowed as a bar seen along the wall)
        const ex = W.axisU ? pu - nIn[0] * 0.06 : pu + off, ez = W.axisU ? pv + off : pv - nIn[1] * 0.06;
        b.add(G.box, lm(DM0, dunWX(ex), fy + h * 0.4, dunWZ(ez), yaw, 0.05, h * (0.5 + rnd() * 0.3), 0.1), MAT.rune, darker(DEEP_EMBER, 0.55 + rnd() * 0.35));
      } else if (!hot && W.room >= 0 && DUN_ROOMS[W.room].id === 'cistern' && rnd() < 0.35) {
        // the cistern's walls weep: a green-black stain of water down them
        b.add(G.box, lm(DM0, dunWX(pu + nIn[0] * 0.2), fy + h * 0.45, dunWZ(pv + nIn[1] * 0.2), yaw, w * 0.5, h * 0.9, 0.02), MAT.darkstone, [0.05, 0.08, 0.07]);
      }
    }
  }
  DEEP.walls = WALLS;
  // headers: where a low passage opens into a tall room
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    if (!C[k]) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const q = dunIdx(i + di, j + dj);
      if (q < 0 || !C[q] || !(late3IsDeepCell(k) || late3IsDeepCell(q))) continue;
      const lo = Math.min(CY[k], CY[q]), hi = Math.max(CY[k], CY[q]);
      if (hi - lo < 0.62) continue;
      const u = i + DUN.u0 + (di ? 1 : 0.5), v = j + DUN.v0 + (dj ? 1 : 0.5);
      b.add(G.box, lm(DM0, dunWX(u), (lo + hi) / 2 + 0.3, dunWZ(v), 0, di ? 0.9 : 1.04, hi - lo + 0.6, dj ? 0.9 : 1.04), MAT.drystone, darker(DEEP_STONE, 0.85), lo, 2);
    }
  }
  // roofs: great capstones, the stair's stepping down with it
  for (const R of DEEP_ROOMS) {
    if (R.id === 'dstair') {
      for (let v = 15; v < 37; v++) {
        const k = deepCellOf(193, v);
        b.add(G.box, lm(DM0, dunWX(193), CY[k] + 0.35, dunWZ(v + 0.5), 0, 5.3, 0.7, 1.04, (rnd() - 0.5) * 0.02), MAT.rock, darker(DEEP_STONE2, 0.95 + rnd() * 0.2));
      }
      continue;
    }
    const du = R.u[1] - R.u[0], dv = R.v[1] - R.v[0], acrossV = du >= dv;
    const spanLen = acrossV ? dv : du, runLen = acrossV ? du : dv;
    for (let s = 0; s < runLen - 0.01;) {
      const w = Math.min(runLen - s, 1.8 + rnd() * 1.6), mid = s + w / 2;
      const u = acrossV ? R.u[0] + mid : (R.u[0] + R.u[1]) / 2, v = acrossV ? (R.v[0] + R.v[1]) / 2 : R.v[0] + mid;
      const pieces = Math.max(1, Math.round(spanLen / 6));
      for (let q = 0; q < pieces; q++) {
        const L = (spanLen + 0.9) / pieces, off = -(spanLen + 0.9) / 2 + L * (q + 0.5);
        const pu = acrossV ? u : u + off, pv = acrossV ? v + off : v;
        const y = R.fy + R.h + 0.35 + (rnd() - 0.5) * 0.14;
        b.add(G.box, lm(DM0, dunWX(pu), y, dunWZ(pv), 0, acrossV ? w - 0.05 : L - 0.04, 0.7, acrossV ? L - 0.04 : w - 0.05, (rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012), MAT.rock, darker(DEEP_STONE2, 0.9 + rnd() * 0.3));
      }
      s += w;
    }
    if (R.h >= 7) for (let t = 3.5; t < runLen - 2; t += 5.5) {
      const u = acrossV ? R.u[0] + t : (R.u[0] + R.u[1]) / 2, v = acrossV ? (R.v[0] + R.v[1]) / 2 : R.v[0] + t;
      b.add(G.box, lm(DM0, dunWX(u), R.fy + R.h - 0.35, dunWZ(v), 0, acrossV ? 0.8 : spanLen + 0.4, 0.7, acrossV ? spanLen + 0.4 : 0.8), MAT.rock, darker(DEEP_STONE2, 0.85));
    }
  }
}
// the floor of the deep's open ground (its slabs, steps and the basin's bed drawn as the rest of it)
function deepFloor() {
  const pos = [], nrm = [], idx = [], vmap = new Map(), C = DUN.cell, GW = DUN.GW;
  const vert = (i, j) => {
    const key = j * (GW + 1) + i;
    let id = vmap.get(key);
    if (id !== undefined) return id;
    const x = dunWX(i + DUN.u0), z = dunWZ(j + DUN.v0), y = dunFloorAt(x, z);
    id = pos.length / 3;
    pos.push(x, y, z);
    const e = 0.5, hx = dunFloorAt(x + e, z) - dunFloorAt(x - e, z), hz = dunFloorAt(x, z + e) - dunFloorAt(x, z - e), l = Math.hypot(hx, 2 * e, hz);
    nrm.push(-hx / l, (2 * e) / l, -hz / l);
    vmap.set(key, id);
    return id;
  };
  for (let j = 0; j < DUN.GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    if (C[k] !== 1 || !late3IsDeepCell(k)) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
    idx.push(a, d, c, a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  deepFloorMat.uniforms.uHot.value.set(deepX(20), deepZ(34), deepX(142), deepZ(64));
  deepFloorMat.uniforms.uWetBox.value.set(deepX(150), deepZ(36), deepX(187), deepZ(61));
  return new THREE.Mesh(g, deepFloorMat);
}
// a stone pillar of the deep (drums of basalt, ember veins between them in the hot halls)
function deepPillar(b, u, v, y0, y1, w, rnd, hot) {
  const M = deepM(u, y0, v, (rnd() - 0.5) * 0.2), H = y1 - y0;
  b.add(G.box, lm(M, 0, 0.35, 0, 0, w + 0.55, 0.7, w + 0.55), MAT.rock, DEEP_STONE2, y0, 1);
  const n = Math.max(2, Math.round(H / 1.5));
  for (let k = 0; k < n; k++) {
    const h = (H - 1.2) / n;
    b.add(G.cyl12, lm(M, (rnd() - 0.5) * 0.05, 0.7 + h * (k + 0.5), (rnd() - 0.5) * 0.05, rnd() * 3, w * 0.55, h - 0.05, w * 0.55), MAT.rock, darker(DEEP_STONE, 0.85 + rnd() * 0.2), y0, 4);
    if (hot && k > 0 && rnd() < 0.5) b.add(G.cyl12, lm(M, 0, 0.7 + h * k, 0, 0, w * 0.53, 0.05, w * 0.53), MAT.rune, darker(DEEP_EMBER, 0.6));
  }
  b.add(G.box, lm(M, 0, H - 0.25, 0, 0, w + 0.7, 0.5, w + 0.7), MAT.rock, DEEP_STONE2);
  const p = worldOf(M, 0, 0, 0);
  addCircle(p.x, p.z, w * 0.6 + 0.15, 'pillar', H);
}
function deepTorch(b, u, v, face, cold = false) {
  const fy = dunFloorAt(dunWX(u), dunWZ(v)), M = deepM(u, fy, v, Math.atan2(face[0], face[1]));
  b.add(G.box, lm(M, 0, 2.05, 0.06, 0, 0.22, 0.36, 0.06), MAT.metal, IRON);
  beam(b, M, [0, 2.0, 0.06], [0, 2.3, 0.34], 0.04, MAT.metal, IRON);
  b.add(G.frustum16, lm(M, 0, 2.42, 0.42, 0, 0.16, 0.2, 0.16, Math.PI), MAT.metal, IRON);
  const p = worldOf(M, 0, 2.55, 0.42);
  addFire(p.x, p.y, p.z, 0.45, cold, Infinity, { r: 10, k: cold ? 1.1 : 1.3 });
  DUN.torches.push(p);
}
function deepBones(b, u, v, r, n, rnd) { bonePile(b, deepM(0, dunFloorAt(dunWX(u), dunWZ(v)), 0), dunWX(u), dunWZ(v), r, n, rnd); }
// a pyre: a stone platform, charred logs stacked crosswise, what was laid on it
function deepPyre(b, u, v, rnd, burning) {
  const fy = DEEP_Y, M = deepM(u, fy, v, (rnd() - 0.5) * 0.3);
  b.add(G.box, lm(M, 0, 0.4, 0, 0, 3.2, 0.8, 2.2), MAT.rock, darker(DEEP_STONE, 1.1), fy, 1);
  b.add(G.box, lm(M, 0, 0.82, 0, 0, 3.3, 0.06, 2.3), MAT.darkstone, [0.12, 0.1, 0.09]);
  for (let q = 0; q < 4; q++) for (let s = 0; s < 4; s++) {
    const along = q % 2 === 0;
    b.add(G.cyl8, lm(M, along ? 0 : -1.05 + s * 0.7, 0.98 + q * 0.18, along ? -0.75 + s * 0.5 : 0, 0, 0.09 + rnd() * 0.02, along ? 2.6 : 1.8, 0.09 + rnd() * 0.02, along ? Math.PI / 2 : 0, along ? 0 : Math.PI / 2), MAT.wood, darker([0.1, 0.07, 0.05], 0.8 + rnd() * 0.5));
  }
  skull(b, M, (rnd() - 0.5) * 1.2, 1.7, (rnd() - 0.5) * 0.8, rnd() * TAU, 1);
  const p = worldOf(M, 0, 1.5, 0);
  addBox(p.x, p.z, 1.65, 1.15, 0, 'prop', 1.8);
  if (burning) { addFire(p.x, p.y, p.z, 1.05, false, Infinity, { r: 13, k: 1.35 }); DEEP.pyreFires = (DEEP.pyreFires || 0) + 1; }
}
// The embers in the deep's cracks, the rings of its pillars and its throne's runes glow with their own red light: the
// building shader's rune branch lays a cold blue glyph over whatever colour it is given (the Barrow's runes), and the
// embers read as blue and white stripes on red. A DeepBatch sends what is added as a rune in an ember's colour (red over
// blue) to a batch of its own, drawn with this emissive material (its flicker by the place)
const deepEmberMat = mat({
  vertexShader: /* glsl */`attribute vec3 aCol; varying vec3 vC; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vC = aCol; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    varying vec3 vC; varying vec3 vW;
    void main(){
      float fl = 0.78 + 0.22 * sin(uTime * 2.3 + vW.x * 1.7 + vW.z * 1.3) * sin(uTime * 1.37 + vW.y * 2.1 + vW.x * 0.6);
      gl_FragColor = vec4(safeColor(applyFog(vC * 1.7 * fl, vW)), 1.0);
    }`,
});
class DeepBatch extends Batch {
  constructor() { super(); this.emb = new Batch(); }
  add(geo, m4, matId, color, baseY = null, aoH = 3) {
    if (matId === MAT.rune && color[0] > color[2] * 2) return this.emb.add(geo, m4, matId, color, baseY, aoH);
    return super.add(geo, m4, matId, color, baseY, aoH);
  }
  // the batch's mesh, its embers a mesh of their own within it (so they move with it)
  mesh() {
    const m = new THREE.Mesh(this.build(), buildingMat);
    if (this.emb.n) { const e = new THREE.Mesh(this.emb.build(), deepEmberMat); e.userData.keep = false; m.add(e); }
    return m;
  }
}
// a great stone slab over a pit (its own mesh: it falls, and rises again)
function deepSlabMesh(S, rnd) {
  const b = new DeepBatch(), M0 = new THREE.Matrix4(), w = S.u1 - S.u0, d = S.v1 - S.v0;
  b.add(G.box, lm(M0, 0, -0.22, 0, 0, w - 0.06, 0.44, d - 0.06), MAT.rock, darker(DEEP_STONE, 0.95 + rnd() * 0.12), -0.44, 0.6);
  // its face: a few flags laid in it, cracked across, embers glowing faintly in the cracks
  for (let q = 0; q < 6; q++) {
    const a = rnd() * Math.PI, L = 1.2 + rnd() * 2.2, x = (rnd() - 0.5) * (w - 1.4), z = (rnd() - 0.5) * (d - 1.4);
    b.add(G.box, lm(M0, x, 0.004, z, a, L, 0.012, 0.05), MAT.darkstone, [0.04, 0.035, 0.03]);
    if (q % 2 === 0) b.add(G.box, lm(M0, x, 0.006, z, a, L * 0.7, 0.012, 0.022), MAT.rune, darker(DEEP_EMBER, 0.35 + rnd() * 0.25));
  }
  for (let x = -w / 2 + 1; x < w / 2 - 0.5; x += 1.33) b.add(G.box, lm(M0, x, 0.003, 0, 0, 0.04, 0.008, d - 0.2), MAT.darkstone, [0.08, 0.075, 0.07]);
  const m = b.mesh();
  if (typeof look6SlabMat !== 'undefined') m.material = look6SlabMat; // [look6] the ground's marks on its top (14_look6.js): a cracking slab's ring was drawn under it
  m.position.set(dunWX((S.u0 + S.u1) / 2), DEEP_Y, dunWZ((S.v0 + S.v1) / 2));
  m.matrixAutoUpdate = true;
  return m;
}
// the trench under a band of slabs: its walls and the bed of embers
function deepTrench(b, u0, u1, v0, v1, pits) {
  const M = DM0, y0 = DEEP_PIT, H = DEEP_Y - DEEP_PIT;
  for (const [cu, cv, w, d] of [[(u0 + u1) / 2, v0 + 0.1, u1 - u0, 0.2], [(u0 + u1) / 2, v1 - 0.1, u1 - u0, 0.2], [u0 + 0.1, (v0 + v1) / 2, 0.2, v1 - v0], [u1 - 0.1, (v0 + v1) / 2, 0.2, v1 - v0]]) {
    b.add(G.box, lm(M, dunWX(cu), y0 + H / 2 - 0.05, dunWZ(cv), 0, w, H - 0.1, d), MAT.rock, DEEP_STONE2, y0, 1.5);
  }
  pits.push([u0, u1, v0, v1]);
}
function deepPitMesh(pits) {
  const pos = [], idx = [];
  for (const [u0, u1, v0, v1] of pits) {
    const n = pos.length / 3, y = DEEP_PIT;
    pos.push(dunWX(u0), y, dunWZ(v0), dunWX(u1), y, dunWZ(v0), dunWX(u1), y, dunWZ(v1), dunWX(u0), y, dunWZ(v1));
    idx.push(n, n + 3, n + 2, n, n + 2, n + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return new THREE.Mesh(g, deepPitMat);
}
// the pitch channels: polylines cut in the floor, laid out in cells of 2 m
const DEEP_CHANNELS = [
  // the Hall of Pyres: three runs along it and three across, between the pyres
  ...[42, 49, 56].map((v) => ({ hall: 'pyres', pts: [[107, v], [139, v]] })),
  ...[112, 123, 134].map((u) => ({ hall: 'pyres', pts: [[u, 39.5], [u, 59]] })),
  // the Ash Throne: two runs down the aisle and three across it
  ...[44, 53].map((v) => ({ hall: 'ashhall', pts: [[29, v], [54, v]] })),
  ...[36, 44, 52].map((u) => ({ hall: 'ashhall', pts: [[u, 44], [u, 53]] })),
];
function deepChannels(b) {
  const pos = [], cellA = [], chA = [], idx = [], W = 0.55;
  const cells = DEEP.cells;
  for (const Ch of DEEP_CHANNELS) {
    const [a, c] = Ch.pts, L = Math.hypot(c[0] - a[0], c[1] - a[1]), du = (c[0] - a[0]) / L, dv = (c[1] - a[1]) / L;
    const nCell = Math.max(1, Math.round(L / 2)), cl = L / nCell, first = cells.length;
    for (let q = 0; q < nCell && cells.length < DEEP_CELLS_MAX; q++) {
      const s0 = q * cl, s1 = (q + 1) * cl;
      const u0 = a[0] + du * s0, v0 = a[1] + dv * s0, u1 = a[0] + du * s1, v1 = a[1] + dv * s1;
      const C = { i: cells.length, hall: Ch.hall, ax: dunWX(u0), az: dunWZ(v0), bx: dunWX(u1), bz: dunWZ(v1), x: dunWX((u0 + u1) / 2), z: dunWZ((v0 + v1) / 2), y: DEEP_Y, st: 0, heat: 0, ch: 0, t: 0, catchAt: 0, rearm: 0, nb: [], fire: null, spread: false };
      cells.push(C);
      if (q > 0) { C.nb.push(cells[C.i - 1]); cells[C.i - 1].nb.push(C); }
      // the strip: a quad across the channel's width, its lip of stone
      const n = pos.length / 3, nu = -dv * W / 2, nv = du * W / 2, y = DEEP_Y + 0.012;
      pos.push(dunWX(u0 + nu), y, dunWZ(v0 + nv), dunWX(u0 - nu), y, dunWZ(v0 - nv), dunWX(u1 - nu), y, dunWZ(v1 - nv), dunWX(u1 + nu), y, dunWZ(v1 + nv));
      cellA.push(C.i, C.i, C.i, C.i);
      chA.push(0, s0, 1, s0, 1, s1, 0, s1);
      idx.push(n, n + 2, n + 1, n, n + 3, n + 2); // [look6] facing up: wound the other way they faced down and were culled (the pitch, its flames and its ash were never drawn)
    }
    Ch.first = first; Ch.last = cells.length - 1;
  }
  // where channels cross, their cells catch from each other
  for (const A of cells) for (const B of cells) if (A !== B && !A.nb.includes(B) && dist2(A.x, A.z, B.x, B.z) < 1.6 * 1.6) A.nb.push(B);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCell', new THREE.Float32BufferAttribute(cellA, 1));
  g.setAttribute('aCh', new THREE.Float32BufferAttribute(chA, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  DEEP.heat = new Uint8Array(DEEP_CELLS_MAX * 4);
  DEEP.heatTex = new THREE.DataTexture(DEEP.heat, DEEP_CELLS_MAX, 1, THREE.RGBAFormat);
  DEEP.heatTex.magFilter = THREE.NearestFilter; DEEP.heatTex.minFilter = THREE.NearestFilter;
  DEEP.heatTex.needsUpdate = true;
  deepChannelMat.uniforms.uHeat.value = DEEP.heatTex;
  // the cut edges either side of each run
  for (const Ch of DEEP_CHANNELS) {
    const [a, c] = Ch.pts, L = Math.hypot(c[0] - a[0], c[1] - a[1]), yaw = Math.atan2(c[0] - a[0], c[1] - a[1]);
    const M = deepM((a[0] + c[0]) / 2, DEEP_Y, (a[1] + c[1]) / 2, yaw);
    for (const s of [-1, 1]) b.add(G.box, lm(M, s * (W / 2 + 0.06), 0.015, 0, 0, 0.12, 0.03, L), MAT.darkstone, [0.12, 0.11, 0.1]);
  }
  return new THREE.Mesh(g, deepChannelMat);
}
function deepSealMesh() {
  // [look6] a DeepBatch: its runes glow as embers (the building shader's rune branch drew them as the Barrow's cold blue glyphs)
  const b = new DeepBatch(), M0 = new THREE.Matrix4(), w = DEEP_SEAL.w, h = DEEP_SEAL.h;
  b.add(G.box, lm(M0, 0, h / 2, 0, 0, w, h, 0.62), MAT.rock, darker(DEEP_STONE, 1.05), 0, h);
  // the first kings' seal: a ring of runes about a crowned skull, cut into the face and glowing like a coal
  for (let q = 0; q < 16; q++) {
    const a = (q / 16) * TAU;
    b.add(G.box, lm(M0, Math.cos(a) * 1.15, 2.3 + Math.sin(a) * 1.15, 0.32, 0, 0.32, 0.06, 0.02, 0, a + Math.PI / 2 + (q % 2) * 0.4), MAT.rune, DEEP_EMBER);
  }
  b.add(G.ico, lm(M0, 0, 2.25, 0.3, 0, 0.36, 0.42, 0.1), MAT.rock, darker(DEEP_STONE, 1.3));
  for (const s of [-1, 1]) b.add(G.ico, lm(M0, s * 0.13, 2.3, 0.39, 0, 0.07, 0.08, 0.03), MAT.rune, darker(DEEP_EMBER, 0.8));
  for (let q = 0; q < 5; q++) b.add(G.cone8, lm(M0, -0.3 + q * 0.15, 2.78, 0.3, 0, 0.05, 0.22, 0.04), MAT.gold, [0.6, 0.42, 0.18]);
  for (const s of [-1, 1]) b.add(G.box, lm(M0, s * (w / 2 - 0.25), h / 2, 0.32, 0, 0.06, h - 0.4, 0.02), MAT.rune, darker(DEEP_EMBER, 0.5));
  const m = b.mesh(); // [look6]
  m.position.set(dunWX(DEEP_SEAL.u), -7, dunWZ(DEEP_SEAL.v));
  m.rotation.y = Math.PI; // its carved face toward the Hollow King's hall
  m.matrixAutoUpdate = true;
  return m;
}
function deepWallMesh() {
  const b = new Batch(), M0 = new THREE.Matrix4(), rnd = mulberry(7331);
  // a wall of courses laid in a doorway long ago, cracked across, a draught of cold air through the cracks
  for (let r = 0; r < 6; r++) for (let q = 0; q < 4; q++) {
    const x = -1.2 + q * 0.8 + (r % 2) * 0.4;
    if (x > 1.35) continue;
    b.add(G.box, lm(M0, x, 0.28 + r * 0.56, 0, (rnd() - 0.5) * 0.04, 0.76, 0.52, 0.9), MAT.rock, darker(DEEP_STONE, 0.95 + rnd() * 0.25), 0, 3.4);
  }
  b.add(G.box, lm(M0, 0.1, 1.6, -0.46, 0, 0.05, 2.4, 0.02, 0, 0.5), MAT.darkstone, [0.02, 0.02, 0.02]);
  b.add(G.box, lm(M0, -0.5, 1.1, -0.46, 0, 0.04, 1.4, 0.02, 0, -0.7), MAT.darkstone, [0.02, 0.02, 0.02]);
  const m = new THREE.Mesh(b.build(), buildingMat);
  m.position.set(dunWX(67.5), DEEP_Y, dunWZ(52.5));
  m.matrixAutoUpdate = true;
  return m;
}
function deepRubbleGeo() {
  const b = new Batch(), M0 = new THREE.Matrix4(), rnd = mulberry(7341);
  for (let q = 0; q < 16; q++) {
    const x = (rnd() - 0.5) * 3.0, z = -0.9 + rnd() * 1.6, s = 0.3 + rnd() * 0.35;
    b.add(G.box, lm(M0, x, s * 0.35, z, rnd() * TAU, s * 1.6, s * 0.7, s, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6), MAT.rock, darker(DEEP_STONE, 0.9 + rnd() * 0.25));
  }
  return b.build();
}
function late3BuildDeep() {
  const rnd = mulberry(4417), b = new DeepBatch();
  deepShell(b, rnd);
  // the Long Stair: its steps, a torch now and then on the walls
  for (let v = 15; v < 37; v++) {
    const y = -7 - (v - 14) * DEEP_STEP;
    b.add(G.box, lm(DM0, dunWX(193), y - 1.2, dunWZ(v + 0.5), 0, 4.04, 2.4, 1.02), MAT.rock, darker(DEEP_STONE, 0.95 + (v % 2) * 0.1), y - 2.4, 2);
  }
  for (const v of [19, 26, 33]) { deepTorch(b, 191.2, v, [1, 0]); deepTorch(b, 194.8, v + 3, [-1, 0]); }
  // the landing: a brazier, bones of those who came this far
  { const p = dunPoint(197, 40); brazierAt(b, dunLift(p.y), p.x, p.z, null, false, { r: 12, k: 1.2 }); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
  deepBones(b, 189, 41.5, 0.7, 7, rnd);
  // the Sunken Cistern: a kerb round the basin, pillars standing in it, sluices in its south wall, a cold light
  {
    const [u0, u1, v0, v1] = DEEP_POOLR;
    for (let u = u0; u < u1; u += 1.5) for (const v of [v0, v1]) b.add(G.box, lm(DM0, dunWX(u + 0.75), DEEP_Y + 0.08, dunWZ(v), 0, 1.46, 0.22, 0.42), MAT.stone, darker(DEEP_STONE, 1.15 + rnd() * 0.1));
    for (let v = v0; v < v1; v += 1.5) for (const u of [u0, u1]) b.add(G.box, lm(DM0, dunWX(u), DEEP_Y + 0.08, dunWZ(v + 0.75), 0, 0.42, 0.22, 1.46), MAT.stone, darker(DEEP_STONE, 1.15 + rnd() * 0.1));
    for (const u of [160, 168.5, 177]) for (const v of [45.5, 51.5]) deepPillar(b, u, v, DEEP_POOL, DEEP_Y + 8, 1.2, rnd, false);
    for (const u of [158, 168.5, 179]) {
      const M = deepM(u, DEEP_Y, 60.25, Math.PI);
      b.add(G.box, lm(M, 0, 2.8, 0, 0, 1.6, 1.9, 0.9), MAT.rock, darker(DEEP_STONE, 1.2));
      b.add(G.box, lm(M, 0, 2.55, 0.4, 0, 0.8, 0.7, 0.3), MAT.darkstone, [0.02, 0.025, 0.025]);
      for (let q = -2; q <= 2; q++) b.add(G.box, lm(M, q * 0.15, 2.55, 0.5, 0, 0.04, 0.7, 0.04), MAT.metal, IRON);
      b.add(G.box, lm(M, 0, 1.5, 0.48, 0, 0.9, 2.4, 0.03), MAT.darkstone, [0.05, 0.08, 0.075]);
    }
    for (const [u, v, fu, fv] of [[156, 36.2, 0, 1], [170, 36.2, 0, 1], [182, 36.2, 0, 1], [150.2, 40, 1, 0], [150.2, 57, 1, 0], [164, 60.8, 0, -1], [175, 60.8, 0, -1], [186.8, 57, -1, 0]]) deepTorch(b, u, v, [fu, fv], true);
    DUN.lights.push({ x: deepX(168.5), y: DEEP_Y + 3, z: deepZ(48.5), r: 22, c: DEEP_COLD, pulse: 1 });
    deepBones(b, 184, 58.5, 0.8, 8, rnd);
  }
  // the Hall of Pyres: pyres between the channels, braziers, the pyre-keeper's chest in its corner
  {
    for (const [u, v, burn] of [[117.5, 45.5, true], [128.5, 45.5, false], [117.5, 52.5, false], [128.5, 52.5, true], [108.5, 52.5, false], [137.5, 45.5, false]]) deepPyre(b, u, v, rnd, burn);
    for (const [u, v] of [[107, 39], [139, 39], [107, 59], [139, 59]]) { const p = dunPoint(u, v); brazierAt(b, dunLift(p.y), p.x, p.z, null, false, { r: 12, k: 1.2 }); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
    for (const u of [115, 131]) for (const v of [39, 59]) deepPillar(b, u, v, DEEP_Y, DEEP_Y + 9, 1.4, rnd, true);
    for (let k = 0; k < 7; k++) deepBones(b, 106 + rnd() * 34, 38 + rnd() * 22, 0.6, 6, rnd);
    DUN.lights.push({ x: deepX(123), y: DEEP_Y + 6, z: deepZ(49), r: 26, c: [0.9, 0.35, 0.1], pulse: 1 });
  }
  // the Breaking Gallery: the trench under its slabs, the cracked wall, the forgotten tomb behind it
  const pits = [];
  {
    deepTrench(b, 72, 92, 46, 52, pits);
    for (const [u, s] of [[66, -1], [80, 1], [94, -1]]) deepTorch(b, u, s > 0 ? 51.8 : 46.2, [0, s > 0 ? -1 : 1]);
    DUN.lights.push({ x: deepX(82), y: DEEP_PIT + 0.8, z: deepZ(49), r: 10, c: [1.2, 0.42, 0.1], pulse: 1 });
    sarcophagus(b, 67, 56.2, 0, rnd, true);
    deepBones(b, 69.6, 54.3, 0.5, 6, rnd);
  }
  // the Ash Throne: the dais, the throne, pillars down the aisle, fire-bowls, the pits under its two bands of slabs
  {
    deepTrench(b, 30, 54, 35, 41, pits);
    deepTrench(b, 30, 54, 57, 63, pits);
    const M = deepM(23.5, DEEP_Y, 48.5);
    b.add(G.box, lm(M, 0, 0.3, 0, 0, 7.2, 0.6, 11.2), MAT.stone, darker(DEEP_STONE, 1.05), DEEP_Y, 1);
    b.add(G.box, lm(M, 3.75, 0.15, 0, 0, 0.9, 0.3, 9.6), MAT.stone, darker(DEEP_STONE, 1.0), DEEP_Y, 1);
    // a throne of black stone for a king twice a man's height, embers in its carved runes
    const T2 = deepM(21.6, -17.4, 48.5, Math.PI / 2);
    b.add(G.box, lm(T2, 0, 0.26, -0.2, 0, 2.8, 0.52, 2.0), MAT.rock, DEEP_STONE2, -17.4, 0.5);
    b.add(G.box, lm(T2, 0, 0.72, -0.25, 0, 1.9, 0.4, 1.3), MAT.rock, darker(DEEP_STONE, 1.1));
    b.add(G.box, lm(T2, 0, 2.9, -1.05, 0, 2.4, 4.9, 0.48), MAT.rock, darker(DEEP_STONE, 1.05), -17.4, 4);
    for (const s of [-1, 1]) {
      b.add(G.box, lm(T2, s * 1.12, 1.15, -0.22, 0, 0.3, 0.6, 1.5), MAT.rock, darker(DEEP_STONE, 1.1));
      b.add(G.cone8, lm(T2, s * 0.85, 5.75, -1.05, 0, 0.28, 0.9, 0.28), MAT.rock, darker(DEEP_STONE, 1.1));
    }
    for (let q = 0; q < 12; q++) { const a = (q / 12) * TAU; b.add(G.box, lm(T2, Math.cos(a) * 0.62, 3.8 + Math.sin(a) * 0.62, -0.8, 0, 0.2, 0.05, 0.03, 0, a + Math.PI / 2), MAT.rune, DEEP_EMBER); }
    addBox(deepX(21.2), deepZ(48.5), 1.05, 1.35, 0, 'prop', 5);
    const seat = worldOf(T2, 0, 0.92, -0.35);
    DEEP.seat = { x: seat.x, y: seat.y, z: seat.z };
    DEEP.throne = dunPoint(26.5, 48.5);
    DEEP.hall = dunPoint(42, 48.5);
    for (const v of [44, 53]) { const p = dunPoint(25.5, v); brazierAt(b, dunLift(p.y), p.x, p.z, null, false, { r: 13, k: 1.4 }); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
    for (const u of [32, 40, 48]) for (const v of [42, 55]) deepPillar(b, u, v, DEEP_Y, DEEP_Y + 13, 1.6, rnd, true);
    for (const [u, v, fu, fv] of [[20.2, 37, 1, 0], [20.2, 60, 1, 0], [55.8, 37, -1, 0], [55.8, 60, -1, 0], [36, 34.2, 0, 1], [48, 34.2, 0, 1], [36, 63.8, 0, -1], [48, 63.8, 0, -1]]) deepTorch(b, u, v, [fu, fv]);
    DUN.lights.push({ x: deepX(42), y: DEEP_PIT + 0.9, z: deepZ(38), r: 12, c: [1.2, 0.42, 0.1], pulse: 1 });
    DUN.lights.push({ x: deepX(42), y: DEEP_PIT + 0.9, z: deepZ(60), r: 12, c: [1.2, 0.42, 0.1], pulse: 1 });
    DUN.lights.push({ x: deepX(27), y: DEEP_Y + 6, z: deepZ(48.5), r: 24, c: [1.0, 0.4, 0.12], pulse: 1 }); // [look6] the throne's glow reaching down the aisle (at 14 m it lost its place among four lights at low to the torches by the door, and from the door the throne and its king were black)
    for (let k = 0; k < 5; k++) deepBones(b, 30 + rnd() * 24, 43 + rnd() * 11, 0.5, 5, rnd);
  }
  const root = new THREE.Group();
  const chMesh = deepChannels(b); // (its cut edges go into the batch: before it is built)
  root.add(b.mesh());
  const floor = deepFloor();
  root.add(floor);
  root.add(deepPitMesh(pits));
  root.add(chMesh);
  // the seal and the cracked wall
  const seal = deepSealMesh();
  DEEP.seal = { mesh: seal, open: 0, target: 0, coll: addBox(dunWX(DEEP_SEAL.u), dunWZ(DEEP_SEAL.v), DEEP_SEAL.w / 2, 0.36, 0, 'gate', DEEP_SEAL.h + 1) };
  DEEP.seal.coll.baseY = -7.5;
  root.add(seal);
  const wall = deepWallMesh();
  DEEP.wall = { mesh: wall, coll: addBox(dunWX(67.5), dunWZ(52.5), 1.6, 0.48, 0, 'wall', 3.6), x: dunWX(67.5), z: dunWZ(52.5), hits: 0 };
  DEEP.wall.coll.baseY = DEEP_Y;
  root.add(wall);
  DEEP.rubble = new THREE.Mesh(new THREE.BufferGeometry(), buildingMat);
  DEEP.rubble.position.set(dunWX(67.5), DEEP_Y, dunWZ(52.5));
  DEEP.rubble.visible = false;
  root.add(DEEP.rubble);
  // the slabs
  for (const S0 of DEEP_SLABS) {
    const S = { ...S0, i: DEEP.slabs.length, st: 0, t: 0, load: 0, dur: 1.1, mesh: null, x: dunWX((S0.u0 + S0.u1) / 2), z: dunWZ((S0.v0 + S0.v1) / 2), tilt: [0, 0], down: 0, by: null };
    S.mesh = deepSlabMesh(S, rnd);
    root.add(S.mesh);
    DEEP.slabs.push(S);
  }
  // the cistern's water: one sheet over the whole room, under the walkways' floor until it rises
  const wg = new THREE.PlaneGeometry(37, 25, 1, 1);
  wg.rotateX(-Math.PI / 2);
  DEEP.water = new THREE.Mesh(wg, deepWaterMat);
  DEEP.water.position.set(deepX(168.5), DEEP.wy, deepZ(48.5));
  DEEP.water.matrixAutoUpdate = true;
  root.add(DEEP.water);
  for (const m of [floor]) if (typeof perf2Release === 'function') perf2Release(m.geometry);
  DUN.root.add(root);
  DEEP.root = root;
  DEEP.built = true;
}

/* ------------------------------------------------------------------ */
/* the dead of the deep                                                */
/* ------------------------------------------------------------------ */
Object.assign(MOBS, {
  cinder: { kind: 'humanoid', names: ['cinder-thrall', 'cinder-thrall', 'cinder-thrall', 'cinder-thrall', 'cinder-thrall', 'cinder-thrall', 'ash-warden', 'ash-warden', 'ash-warden'], hp: 1.15, dmg: 1.1, speed: 5.9, swing: 2.4, range: 2.6, aggro: 13, scale: [1.06, 1.12], tabard: [0.16, 0.06, 0.04], armor: [0.25, 0.2, 0.16], mask: WB.axe | WB.helmet | WB.pauldron | WB.belt | WB.skirt, flags: 1 | (1 << 4) | (2 << 7), outfit: 6, bulk: -0.55, radius: 0.45 },
  drowned: { kind: 'humanoid', names: ['drowned thrall', 'drowned thrall', 'drowned thrall', 'drowned thrall', 'drowned thrall', 'drowned thrall', 'drowned jarl', 'drowned jarl', 'drowned jarl'], hp: 1.2, dmg: 1.0, speed: 5.6, swing: 2.5, range: 2.6, aggro: 12, scale: [1.04, 1.12], tabard: [0.07, 0.14, 0.13], armor: [0.24, 0.3, 0.29], mask: WB.sword | WB.belt | WB.skirt | WB.hairLong | WB.beard, flags: 1 | (2 << 4) | (1 << 7), outfit: 7, bulk: -0.3, radius: 0.45 },
  gravehound: { kind: 'wolf', names: ['grave-hound', 'grave-hound', 'grave-hound', 'grave-hound', 'grave-hound', 'grave-hound', 'grave-hound', 'grave-hound', 'grave-hound'], hp: 0.85, dmg: 1.0, speed: 8.0, swing: 1.8, range: 2.2, aggro: 14, scale: [1.08, 1.2], colA: [0.62, 0.58, 0.5], colB: [0.27, 0.24, 0.21], radius: 0.55 },
  pyrekeeper: { kind: 'humanoid', names: ['pyre-keeper', 'pyre-keeper', 'pyre-keeper', 'pyre-keeper', 'pyre-keeper', 'pyre-keeper', 'pyre-keeper', 'pyre-keeper', 'pyre-keeper'], hp: 0.95, dmg: 1.15, speed: 5.6, swing: 2.8, range: 22, aggro: 15, scale: [1.02, 1.06], tabard: [0.3, 0.09, 0.04], armor: [0.3, 0.24, 0.18], mask: WB.staff | WB.robe | WB.hood | WB.belt, flags: 1 | (1 << 4) | (3 << 7), outfit: 6, bulk: -0.8, radius: 0.45, ranged: 'ember' },
});
const DEEP_PACKS = [
  { room: 'cistern', mobs: [['drowned', 21, 160, 39], ['drowned', 21, 177, 39], ['drowned', 21, 170, 58]], wander: 2 },
  { room: 'pyres', mobs: [['cinder', 21, 112, 46], ['cinder', 21, 123, 53], ['cinder', 22, 134, 46], ['pyrekeeper', 22, 128, 59.5]], wander: 2.5 },
  { room: 'crack', mobs: [['gravehound', 21, 66, 48], ['gravehound', 21, 68, 50.5], ['gravehound', 21, 94, 49]], wander: 1.8 },
  { room: 'ashhall', mobs: [['cinder', 22, 30, 45.5], ['cinder', 22, 30, 51.5]], wander: 1.2 },
];
const DEEP_RESPAWN = 420;
function deepSpawn(type, lvl, u, v, pk, extra = {}) {
  const e = spawnBarrowMob(type, lvl, u, v, pk ? { idx: 100 + pk.idx, wander: pk.wander } : null, extra);
  e.deep = true;
  e.deepPack = pk ? pk.idx : -1;
  e.ai.taunted = true;
  e.name = extra.name || MOBS[type].names[0];
  DEEP.stats.spawned++;
  return e;
}
function late3Init() {
  if (!DEEP.built) return;
  DEEP_PACKS.forEach((pk, i) => { pk.idx = i; pk.members = new Set(); pk.respawn = []; for (const m of pk.mobs) pk.members.add(deepSpawn(m[0], m[1], m[2], m[3], pk).id); });
  deepSpawnLord();
  // the deep's chests
  DEEP.chests.length = 0;
  for (const [id, u, v, yaw, label] of [['dcist', 151.6, 58.6, Math.PI / 2, 'Open the drowned coffer'], ['dpyre', 110, 60.6, 0, "Open the pyre-keeper's chest"], ['dniche', 64.8, 55.5, Math.PI / 2, 'Open the forgotten chest'], ['dhoard', 23.4, 45.2, Math.PI / 2, 'Open the hoard of the Ash-Crowned']]) {
    const p = dunPoint(u, v);
    const ch = { id, x: p.x, z: p.z, y: p.y, yaw, label, ready: id !== 'dhoard', opened: false, lid: 0, refillAt: 0, deep: true };
    buildChestMesh(ch);
    ch.mesh.removeFromParent(); DEEP.root.add(ch.mesh);
    DUN.chests.push(ch);
    DEEP.chests.push(ch);
    addBox(ch.x, ch.z, 0.75, 0.5, yaw, 'prop', 1.0);
  }
  late3ApplySaved();
}
// every pack of the deep standing again, whole (the tests' fresh start: a new descent)
function deepPacksFresh() {
  for (const e of ENT.slice()) if (e.deep && !e.deepLord) removeEnt(e);
  DEEP.adds.clear(); DEEP.flood.drowned = [];
  DEEP_PACKS.forEach((pk) => { pk.members = new Set(); pk.respawn = []; for (const m of pk.mobs) pk.members.add(deepSpawn(m[0], m[1], m[2], m[3], pk).id); });
  rescaleWar();
  return DEEP_PACKS.reduce((a, pk) => a + pk.members.size, 0);
}
// a pack's own wake: the first to see you calls the rest
function deepPackAggro(e, t) {
  const pk = DEEP_PACKS[e.deepPack];
  if (!pk) return;
  for (const id of pk.members) {
    const o = getEnt(id);
    if (!o || o === e || !o.alive || dist2(o.x, o.z, e.x, e.z) > 18 * 18) continue;
    o.threat = o.threat || new Map();
    if (!o.threat.has(t.id)) o.threat.set(t.id, 0.5);
  }
}
function late3MobThink(e, dt) {
  const ai = e.ai;
  if (e.l3fall) return; // in a pit, climbing out
  if (e.casting && e.casting.custom) { deepKindleStep(e, dt); return; }
  const had = e.target;
  thinkBarrowMob(e, dt);
  const t = getEnt(e.target);
  if (!t || !t.alive) return;
  if (had == null) deepPackAggro(e, t);
  const d = dist(e.x, e.z, t.x, t.z);
  ai.l3t = (ai.l3t || 0) - dt;
  if (ai.l3t > 0) return;
  if (e.mobType === 'cinder' && d < 3.2) {
    // an ember blow: its axe glows and the blow sets you alight
    ai.l3t = 6 + Math.random() * 3;
    setAct(e, 1, 0.6);
    later(0.3, () => {
      if (!e.alive || !t.alive || dist(e.x, e.z, t.x, t.z) > 3.6) return;
      const r = computeDamage(e, t, 1.15);
      dealDamage(e, t, r.d, { crit: r.crit, kind: 'melee' });
      addBuff(t, 'burn', t.maxHp * 0.012, 3, e.id);
      FX.burst(t.x, t.y + 1.1, t.z, 12, [2.4, 1.0, 0.3], 2.2, 0.4, 0.1, -0.5);
      DEEP.stats.embers++;
    });
  } else if (e.mobType === 'drowned' && d < 2.8 && (t.wd || 0) > 0.25) {
    // in the water a drowned hand drags at you
    ai.l3t = 7 + Math.random() * 3;
    addBuff(t, 'root', 1, 1.3, e.id);
    splashAt(t.x, t.z, 0.9);
    if (t === GAME.player) uiLog('A drowned hand drags at you under the water!', 'hurt');
    DEEP.stats.grasps++;
  } else if (e.mobType === 'pyrekeeper' && d < 24) {
    // the Kindle: a spell to break, or the pitch about its foe catches
    const C = deepCellNear(t.x, t.z, 7, (c) => c.st === 0);
    if (C) {
      ai.l3t = 11 + Math.random() * 4;
      e.casting = { id: 'kindle', custom: true, t: 0, total: 2.0, targetId: t.id, cell: C.i };
      setAct(e, 3, 2.0);
      aoeMarker(C.x, C.z, 2.2, 2.0, e.faction);
      if (t === GAME.player) uiFloatAt(e.x, e.y + 2.4, e.z, 'Kindle', 'immune');
    } else ai.l3t = 3;
  } else ai.l3t = 1;
}
function deepKindleStep(e, dt) {
  const c = e.casting;
  c.t += dt;
  if (Math.random() < dt * 30) FX.trail(e.x + Math.sin(e.yaw) * 0.5, e.y + 1.5, e.z + Math.cos(e.yaw) * 0.5, [2.4, 1.0, 0.3], 0.1, 0.6);
  if (c.t < c.total) return;
  e.casting = null;
  const C = DEEP.cells[c.cell];
  if (C) { deepIgnite(C, e); DEEP.stats.kindled++; }
}
function late3MobDeath(e) {
  if (DEEP.adds.has(e.id)) { DEEP.adds.delete(e.id); return; }
  if (Math.random() < 0.5) dropGood('grave_iron', 1, e.x, e.z, e.y + 0.8);
  const pk = DEEP_PACKS[e.deepPack];
  if (!pk) return;
  pk.members.delete(e.id);
  const m = pk.mobs.find((x) => x[0] === e.mobType) || pk.mobs[0];
  pk.respawn.push({ at: GAME.t + DEEP_RESPAWN, spec: [e.mobType, m[1], dunU(e.home.x), dunV(e.home.z)] });
}

/* ------------------------------------------------------------------ */
/* the pitch: fire that runs along the channels                         */
/* ------------------------------------------------------------------ */
const DEEP_FIRE_SRC = { id: -79, name: 'the burning pitch', faction: FACTION_MONSTER, role: 'trap', level: 45, buffs: [], alive: false, scale: 1, x: 0, z: 0, y: 0 };
const DEEP_FIRE = { climb: 1.2, burn: 12, fall: 3, rearm: 45, harm: 0.045, spreadAt: 0.55, delay: 0.5 };
function deepCellNear(x, z, r, pred) {
  let best = null, bd = r * r;
  for (const C of DEEP.cells) { const d = dist2(C.x, C.z, x, z); if (d < bd && (!pred || pred(C))) { bd = d; best = C; } }
  return best;
}
function deepIgnite(C, by) {
  if (!C || C.st !== 0) return false;
  C.st = 1; C.t = 0; C.spread = false; C.by = by && by.faction != null ? by.faction : FACTION_MONSTER;
  DEEP.stats.lit++;
  sfxAt('fire', C.x, C.y + 0.4, C.z);
  FX.burst(C.x, C.y + 0.2, C.z, 14, [2.4, 1.0, 0.3], 2.4, 0.5, 0.12, -1);
  return true;
}
// fireLandsAt (04e_houses.js) under the Barrow: a fire spell or a burning arrow landing on the pitch lights it
function late3FireAt(x, y, z, r = 1, by = null) {
  let n = 0;
  for (const C of DEEP.cells) if (C.st === 0 && dist2(C.x, C.z, x, z) < (r + 0.9) ** 2 && Math.abs(y - C.y) < 2.5) { if (deepIgnite(C, by)) n++; }
  return n;
}
function deepPitchStep(dt) {
  let dirty = false;
  const now = GAME.t;
  for (const C of DEEP.cells) {
    if (C.st === 0) {
      if (C.catchAt && now >= C.catchAt) { C.catchAt = 0; deepIgnite(C, null); }
      if (C.ch > 0) { C.ch = Math.max(0, C.ch - dt / DEEP_FIRE.rearm); dirty = true; }
      continue;
    }
    if (C.st === 2) { if (now > C.rearm) C.st = 0; continue; }
    C.t += dt;
    const was = C.heat;
    if (C.t < DEEP_FIRE.burn) C.heat = Math.min(1, C.heat + dt / DEEP_FIRE.climb);
    else C.heat = Math.max(0, C.heat - dt / DEEP_FIRE.fall);
    C.ch = Math.min(1, C.ch + dt * 0.12);
    if (C.heat !== was) dirty = true;
    if (!C.spread && C.heat >= DEEP_FIRE.spreadAt) {
      C.spread = true;
      for (const N of C.nb) if (N.st === 0 && !N.catchAt) N.catchAt = now + DEEP_FIRE.delay * (0.8 + Math.random() * 0.5);
    }
    if (C.t >= DEEP_FIRE.burn && C.heat <= 0) { C.st = 2; C.heat = 0; C.ch = 1; C.rearm = now + DEEP_FIRE.rearm; DEEP.stats.burnt++; dirty = true; }
  }
  // the flames: a real fire (light, flames, smoke) on every other burning cell near the camera
  const cx = camera.position.x, cz = camera.position.z;
  for (const C of DEEP.cells) {
    const want = C.st === 1 && C.heat > 0.35 && C.i % 2 === 0 && INDOOR.on && dist2(C.x, C.z, cx, cz) < 50 * 50 && DEEP.fires.length < 24;
    if (want && !C.fire) {
      addFire(C.x, C.y + 0.05, C.z, 0.55, false, Infinity, { r: 6, k: 1.0 });
      C.fire = FIRES[FIRES.length - 1];
      DEEP.fires.push(C.fire);
    } else if (!want && C.fire && !(C.st === 1 && C.heat > 0.2)) deepFireOut(C);
    if (C.fire) C.fire.size = 0.3 + 0.35 * C.heat;
  }
  // whoever stands in the burning pitch burns (the cinder-thralls and their king are of the fire)
  DEEP.harmT = (DEEP.harmT || 0) - dt;
  if (DEEP.harmT <= 0) {
    DEEP.harmT = 0.5;
    for (const C of DEEP.cells) {
      if (C.st !== 1 || C.heat < 0.4) continue;
      forNear(C.x, C.z, 1.8, (o) => {
        if (!o.alive || o.kind === 'door' || o.kind === 'wisp' || o.mobType === 'cinder' || o.deepLord || o.l3fall || Math.abs(o.y - C.y) > 1.2) return;
        if (distToSeg(o.x, o.z, C.ax, C.az, C.bx, C.bz) > 0.55 + (o.radius || 0.4) * 0.5) return;
        if (o._l3burnT === GAME.t) return;
        o._l3burnT = GAME.t;
        DEEP_FIRE_SRC.level = (getEnt(DEEP.lord) || {}).level || 45;
        dealDamage(DEEP_FIRE_SRC, o, o.maxHp * DEEP_FIRE.harm * C.heat, { kind: 'fire', trap: true });
        DEEP.stats.burnHits++;
        if (o === GAME.player) { FX.burst(o.x, o.y + 1, o.z, 6, [2.4, 1.0, 0.3], 2, 0.4, 0.12, -1); }
      });
    }
  }
  if (dirty) deepHeatUpload();
}
function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function deepFireOut(C) {
  if (!C.fire) return;
  const i = FIRES.indexOf(C.fire);
  if (i >= 0) FIRES.splice(i, 1);
  const j = DEEP.fires.indexOf(C.fire);
  if (j >= 0) DEEP.fires.splice(j, 1);
  C.fire = null;
}
function deepHeatUpload() {
  const H = DEEP.heat;
  for (const C of DEEP.cells) { H[C.i * 4] = Math.round(C.heat * 255); H[C.i * 4 + 1] = Math.round(C.ch * 255); }
  DEEP.heatTex.needsUpdate = true;
}
function deepPitchOut(hall) {
  for (const C of DEEP.cells) if (!hall || C.hall === hall) { C.st = 0; C.heat = 0; C.catchAt = 0; C.t = 0; deepFireOut(C); }
  deepHeatUpload();
}

/* ------------------------------------------------------------------ */
/* the slabs: floors that break                                         */
/* ------------------------------------------------------------------ */
const DEEP_SLAB = { load: 1.5, crack: 1.1, fall: 0.8, rise: 2.2, riseAfter: 40, pitHarm: 0.03, climbOut: 1.6, climbT: 1.0 };
const inSlab = (S, x, z, m = 0) => { const u = dunU(x), v = dunV(z); return u > S.u0 - m && u < S.u1 + m && v > S.v0 - m && v < S.v1 + m; };
function deepSlabCells(S, open) {
  for (let u = S.u0; u < S.u1; u++) for (let v = S.v0; v < S.v1; v++) { const k = deepCellOf(u, v); if (k >= 0) DUN.cell[k] = open ? 4 : 0; }
  BARROW_STATE.flowAt = -9;
}
function deepSlabCrack(S, dur, by) {
  if (S.st !== 0) return false;
  S.st = 1; S.t = 0; S.dur = dur; S.by = by ? by.id : null;
  aoeMarker(S.x, S.z, Math.min(S.u1 - S.u0, S.v1 - S.v0) * 0.62, dur, FACTION_MONSTER);
  DEEP.marks.push({ x: S.x, z: S.z, slab: S, until: GAME.t + dur });
  sfxAt('crack', S.x, DEEP_Y + 0.3, S.z);
  return true;
}
function deepSlabFall(S) {
  S.st = 2; S.t = 0;
  S.tilt = [(Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4];
  deepSlabCells(S, false);
  DEEP.stats.slabsBroken++;
  sfxAt('collapse', S.x, DEEP_Y, S.z);
  cameraShake(0.18, S.x, S.z);
  for (let i = 0; i < 4; i++) FX.dust(S.x + (Math.random() - 0.5) * 3, DEEP_Y + 0.2, S.z + (Math.random() - 0.5) * 3, 12, [0.3, 0.28, 0.26]);
  FX.burst(S.x, DEEP_PIT + 0.5, S.z, 30, [2.4, 0.9, 0.25], 4, 0.9, 0.14, -0.4);
  // whoever stood on it falls into the embers
  const by = getEnt(S.by);
  for (const o of ENT) {
    if (!o.alive || o.removed || o.kind === 'door' || o.kind === 'wisp' || o.flying || o.l3fall || !inDungeon(o) || o.deepLord) continue;
    if (!inSlab(S, o.x, o.z, (o.radius || 0.4) * 0.4)) continue;
    deepFall(o, S, by);
  }
}
// the nearest point of firm ground just off the slab's edge, for a body climbing out of its pit
function deepEdgeOut(S, x, z) {
  const u = dunU(x), v = dunV(z);
  const opts = [[S.u0 - 0.6, clamp(v, S.v0 + 0.5, S.v1 - 0.5)], [S.u1 + 0.6, clamp(v, S.v0 + 0.5, S.v1 - 0.5)], [clamp(u, S.u0 + 0.5, S.u1 - 0.5), S.v0 - 0.6], [clamp(u, S.u0 + 0.5, S.u1 - 0.5), S.v1 + 0.6]];
  let best = null, bd = Infinity;
  for (const [pu, pv] of opts) {
    const wx = dunWX(pu), wz = dunWZ(pv);
    if (!dunWalkable(wx, wz)) continue;
    const d = (pu - u) ** 2 + (pv - v) ** 2;
    if (d < bd) { bd = d; best = { x: wx, z: wz }; }
  }
  return best || DEEP.hall || { x: x, z: z };
}
// [look6] the top of a slab at a point, as it falls and lies tilted in its pit (a body standing on it falls with it)
// (from the slab's own state, as deepSlabStep will pose it at the end of this step: a body steps before its slab)
function look6SlabTop(S, x, z, dt = 0) {
  let down = 0;
  if (S.st === 2) { const k = clamp((S.t + dt) / DEEP_SLAB.fall, 0, 1); down = k * k; }
  else if (S.st === 3) down = 1;
  else if (S.st === 4) down = 1 - smooth(clamp((S.t + dt) / DEEP_SLAB.rise, 0, 1));
  const y = lerp(DEEP_Y, DEEP_PIT + 0.35, down), a = S.tilt[0] * down, c = S.tilt[1] * down, lx = x - S.x, lz = z - S.z;
  return y + lx * Math.sin(c) * Math.cos(a) - lz * Math.sin(a);
}
function deepFall(o, S, by) {
  const out = deepEdgeOut(S, o.x, o.z);
  o.l3fall = { t: 0, x: o.x, z: o.z, y0: o.y, y1: DEEP_PIT + 0.05, out, landed: false, burnT: 0, by: by ? by.id : null, S }; // [look6] S: it rides its slab down
  o.casting = null;
  if (o.motion) o.motion = null;
  setAct(o, 6, 0.6);
  DEEP.stats.falls++;
  if (o === GAME.player) uiLog('The floor gives way under you!', 'hurt');
}
function deepFallStep(o, dt) {
  const F = o.l3fall;
  F.t += dt;
  let y;
  if (F.t < 0.5) { const k = F.t / 0.5; y = F.y0 - (F.y0 - F.y1) * k * k; if (F.S) y = Math.max(y, look6SlabTop(F.S, o.x, o.z, dt)); } // [look6] on its slab, not through it
  else if (F.t < DEEP_SLAB.climbOut) {
    y = F.y1;
    if (F.S) y = Math.max(y, look6SlabTop(F.S, o.x, o.z, dt)); // [look6] lying on the fallen slab in the embers (it lay in the pit under it)
    F.yl = y;
    if (!F.landed) {
      F.landed = true;
      const h = F.y0 - F.y1, k = clamp((h - 1.6) * 0.075, 0, 0.65), harm = o.maxHp * k;
      setAct(o, 13, 0.8);
      FX.dust(o.x, F.y1, o.z, 10, [0.3, 0.25, 0.2]);
      sfxAtE('thud', o, null, 0.2);
      if (harm > 0) {
        o.hp -= harm; o.anim.flash = 1; o.combatUntil = GAME.t + 6;
        if (o === GAME.player) { uiFloatAt(o.x, F.y1 + 2.0, o.z, `-${Math.round(harm)}`, 'hurt'); flashScreen([0.55, 0.12, 0.03], 0.25); }
        if (o.hp <= 0) { o.l3fall = null; o.fixedY = null; killEnt(o, getEnt(F.by)); return; }
      }
    }
    F.burnT -= dt;
    if (F.burnT <= 0) { F.burnT = 0.5; if (o.mobType !== 'cinder') { DEEP_FIRE_SRC.level = (getEnt(DEEP.lord) || {}).level || 45; dealDamage(DEEP_FIRE_SRC, o, o.maxHp * DEEP_SLAB.pitHarm, { kind: 'fire', trap: true }); } }
    if (!o.alive) { o.l3fall = null; o.fixedY = null; return; }
  } else if (F.t < DEEP_SLAB.climbOut + DEEP_SLAB.climbT) {
    // scrambling up the pit's side onto firm ground: hand over hand, as on a ladder
    const k = smooth((F.t - DEEP_SLAB.climbOut) / DEEP_SLAB.climbT);
    if (!F.climb) { F.climb = true; setAct(o, 14, DEEP_SLAB.climbT + 0.1); }
    y = lerp(F.yl ?? F.y1, DEEP_Y, k); // [look6] from where it lay
    o.x = lerp(F.x, F.out.x, k * k); o.z = lerp(F.z, F.out.z, k * k);
  } else {
    o.l3fall = null; o.fixedY = null;
    o.x = o.prevX = F.out.x; o.z = o.prevZ = F.out.z; o.y = dunFloorAt(o.x, o.z);
    if (o === GAME.player) { o.onGround = true; o.vy = 0; }
    return;
  }
  if (!F.climb) { o.x = F.x; o.z = F.z; }
  o.prevX = o.x; o.prevZ = o.z;
  o.y = y;
  if (o === GAME.player) { o.onGround = true; o.vy = 0; } else o.fixedY = y;
}
function deepSlabStep(dt) {
  const P = GAME.player;
  for (const S of DEEP.slabs) {
    if (S.st === 0) {
      if (S.hall !== 'crack') continue;
      // a body standing on a gallery slab too long cracks it
      let on = false;
      for (const o of ENT) {
        if (!o.alive || o.removed || o.kind === 'door' || o.kind === 'wisp' || o.flying || o.l3fall || o.x < DUN_X0) continue;
        if (Math.abs(o.y - DEEP_Y) < 0.8 && inSlab(S, o.x, o.z, -0.1)) { on = true; break; }
      }
      S.load = on ? S.load + dt : Math.max(0, S.load - dt * 0.6);
      if (S.load >= DEEP_SLAB.load) { S.load = 0; deepSlabCrack(S, DEEP_SLAB.crack, null); }
    } else if (S.st === 1) {
      S.t += dt;
      const k = S.t / S.dur;
      S.mesh.position.set(S.x + (Math.random() - 0.5) * 0.04 * k, DEEP_Y - 0.03 * k + (Math.random() - 0.5) * 0.02, S.z + (Math.random() - 0.5) * 0.04 * k);
      if (INDOOR.on && Math.random() < dt * 30) { const x = S.x + (Math.random() - 0.5) * (S.u1 - S.u0), z = S.z + (Math.random() - 0.5) * (S.v1 - S.v0); FX.trail(x, DEEP_Y + 0.05, z, [2.4, 0.9, 0.3], 0.08, 0.7); }
      if (INDOOR.on && Math.random() < dt * 6) FX.dust(S.x + (Math.random() - 0.5) * 3, DEEP_Y + 0.05, S.z + (Math.random() - 0.5) * 3, 3, [0.3, 0.28, 0.26]);
      if (S.t >= S.dur) deepSlabFall(S);
    } else if (S.st === 2) {
      S.t += dt;
      const k = clamp(S.t / DEEP_SLAB.fall, 0, 1);
      S.down = k * k;
      S.mesh.position.set(S.x, lerp(DEEP_Y, DEEP_PIT + 0.35, S.down), S.z);
      S.mesh.rotation.set(S.tilt[0] * S.down, 0, S.tilt[1] * S.down);
      if (k >= 1) { S.st = 3; S.t = 0; }
    } else if (S.st === 3) {
      S.t += dt;
      // the barrow mends itself: a gallery slab rises again in time, nobody near
      if (S.hall === 'crack' && S.t > DEEP_SLAB.riseAfter && !(P && dist2(P.x, P.z, S.x, S.z) < 6 * 6) && !ENT.some((o) => o.alive && o.l3fall && inSlab(S, o.x, o.z, 1))) { S.st = 4; S.t = 0; sfxAt('grind', S.x, DEEP_Y, S.z); }
    } else if (S.st === 4) {
      S.t += dt;
      const k = smooth(clamp(S.t / DEEP_SLAB.rise, 0, 1)), d = 1 - k;
      S.mesh.position.set(S.x, lerp(DEEP_Y, DEEP_PIT + 0.35, d), S.z);
      S.mesh.rotation.set(S.tilt[0] * d, 0, S.tilt[1] * d);
      if (INDOOR.on && Math.random() < dt * 20) FX.trail(S.x + (Math.random() - 0.5) * 3, DEEP_Y - 0.5, S.z + (Math.random() - 0.5) * 3, [2.0, 0.8, 0.3], 0.07, 0.8);
      if (k >= 1) { deepSlabMend(S); }
    }
  }
}
function deepSlabMend(S) {
  S.st = 0; S.t = 0; S.load = 0; S.down = 0;
  S.mesh.position.set(S.x, DEEP_Y, S.z); S.mesh.rotation.set(0, 0, 0);
  deepSlabCells(S, true);
  DEEP.stats.slabsRisen++;
}
// a heavy blow under the Barrow (natureImpact, 05h_nature.js: a meteor, a leap strike): a slab under it cracks, the
// cracked wall falls
function late3Impact(x, z, kind, r = 3) {
  if (!DEEP.built) return;
  for (const S of DEEP.slabs) if (S.st === 0 && inSlab(S, x, z, r * 0.3)) deepSlabCrack(S, 0.9, null);
  if (!DEEP.wallBroken && dist(x, z, DEEP.wall.x, DEEP.wall.z) < r + 1.5) deepWallBreak(GAME.player);
}

/* ------------------------------------------------------------------ */
/* the cracked wall, the seal, the chests                               */
/* ------------------------------------------------------------------ */
function deepWallBreak(by) {
  if (DEEP.wallBroken) return;
  DEEP.wallBroken = true;
  deepWallShow();
  DEEP.stats.wallBroken++;
  sfxAt('collapse', DEEP.wall.x, DEEP_Y + 1, DEEP.wall.z);
  cameraShake(0.2, DEEP.wall.x, DEEP.wall.z);
  for (let i = 0; i < 4; i++) FX.dust(DEEP.wall.x + (Math.random() - 0.5) * 3, DEEP_Y + 1 + Math.random(), DEEP.wall.z, 14, [0.32, 0.3, 0.28]);
  if (by === GAME.player) uiLog('The cracked wall falls in. Beyond it lies a tomb the barrow forgot.', 'loot');
  saveSoon();
}
function deepWallShow() {
  const W = DEEP.wall;
  if (!W) return;
  W.mesh.visible = !DEEP.wallBroken;
  W.coll.active = !DEEP.wallBroken;
  if (DEEP.wallBroken && !DEEP.rubble.userData.made) { DEEP.rubble.geometry = deepRubbleGeo(); DEEP.rubble.userData.made = true; }
  DEEP.rubble.visible = DEEP.wallBroken;
  // the forgotten tomb's chest is found once the wall is down: no mark for it on the map before
  const N = DEEP.chests.find((c) => c.id === 'dniche');
  if (N) N.ready = DEEP.wallBroken;
}
// Use beside the cracked wall: a few heavy blows bring it down
function deepWallStrike() {
  const P = GAME.player;
  if (!P || DEEP.wallBroken || P.casting) return;
  setAct(P, 8, 0.9);
  DEEP.wall.hits++;
  later(0.55, () => {
    if (DEEP.wallBroken) return;
    sfxAt('slam', DEEP.wall.x, DEEP_Y + 1.2, DEEP.wall.z);
    FX.dust(DEEP.wall.x, DEEP_Y + 1.2, DEEP.wall.z - 0.5, 10, [0.32, 0.3, 0.28]);
    cameraShake(0.08, DEEP.wall.x, DEEP.wall.z);
    if (DEEP.wall.hits >= 3) deepWallBreak(P);
    else uiFloatAt(DEEP.wall.x, DEEP_Y + 2.2, DEEP.wall.z, 'Cracking', 'immune');
  });
}
function late3SealOpen(quiet = false) {
  if (!DEEP.seal) return;
  DEEP.opened = true;
  DEEP.seal.target = 1;
  if (quiet) { DEEP.seal.open = 1; deepSealPose(); return; }
  DEEP.stats.sealOpened++;
  const p = DEEP.seal.mesh.position;
  sfxAt('grind', p.x, p.y + 2, p.z); sfxAt('boom', p.x, p.y + 2, p.z);
  cameraShake(0.25, p.x, p.z);
  lightFlash(p.x, p.y + 2.3, p.z, 10, [2.6, 1.1, 0.35], 1.2);
  FX.burst(p.x, p.y + 2.3, p.z, 40, [2.4, 1.0, 0.3], 3, 0.9, 0.14, -0.3);
  uiBanner("The first kings' seal yields. A stair goes down into the deep.", -1);
  uiLog('You break the seal beneath the Hollow King\'s hall. The Deep Barrow lies open below.', 'level');
  saveSoon();
}
function deepSealPose() {
  const S = DEEP.seal;
  S.mesh.position.y = -7 - smooth(S.open) * (DEEP_SEAL.h + 0.1);
  S.coll.active = S.open < 0.6;
}
// the offers under the Barrow (currentInteraction, 09_player.js)
function late3Offers(P, offer) {
  if (!DEEP.built) return;
  const sx = dunWX(DEEP_SEAL.u), sz = dunWZ(DEEP_SEAL.v - 0.9);
  if (!DEEP.opened) {
    const d = dist(P.x, P.z, sx, sz);
    if (late3SealReady()) offer(d, 3.2, 'Break the seal beneath the Hollow King\'s hall', () => late3SealOpen(false), 0.2);
    else offer(d, 3.2, 'Read the seal', () => { uiToast(late3SealWhy(), 'hint'); uiLog(late3SealWhy(), 'sys'); }, 0.5);
  }
  if (!DEEP.wallBroken && DEEP.wall) offer(dist(P.x, P.z, DEEP.wall.x, DEEP.wall.z), 2.9, 'Break the cracked wall', () => deepWallStrike(), 0.4);
}
function late3OpenChest(ch) {
  const P = GAME.player;
  if (!ch.ready || ch.opened || !P) return;
  const near = ENT.some((o) => o.alive && o.faction === FACTION_MONSTER && inDungeon(o) && dist2(o.x, o.z, ch.x, ch.z) < 12 * 12 && o.threat && o.threat.has(P.id));
  if (near) { uiError('Not while the dead are on you'); return; }
  ch.opened = true;
  ch.refillAt = GAME.t + (ch.id === 'dhoard' ? DEEP_LORD.respawn : DEEP_RESPAWN * 2);
  DEEP.taken[ch.id] = ch.refillAt;
  DEEP.stats.chests++;
  sfx('chestOpen');
  const hoard = ch.id === 'dhoard';
  later(0.45, () => {
    // the hoard of the first king: the top of the gear curve; the deep's other chests a piece or two above the Barrow's
    const lvl = Math.min(LEVEL_CAP, GAME.prog.level + (hoard ? 2 : 1));
    const n = hoard ? 3 : ch.id === 'dniche' ? 2 : 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const w = hoard ? (i === 0 ? [0, 0, 0, 0, 40, 60] : [0, 0, 0, 0, 70, 30]) : DROP_WEIGHTS.boss;
      dropItem(makeItem({ cls: P.cls, realm: P.faction, lvl, q: rollQuality(w) }), ch.x, ch.z, ch.y + 0.9);
    }
    addGold(hoard ? 700 + Math.random() * 300 : 140 + Math.random() * 120, ch.x, ch.y + 1.5, ch.z);
    dropGood('grave_iron', hoard ? 4 : 1, ch.x, ch.z, ch.y + 0.9);
    FX.burst(ch.x, ch.y + 0.8, ch.z, 30, [2.2, 1.7, 0.7], 2.2, 0.8, 0.12, 2);
    lightFlash(ch.x, ch.y + 1.2, ch.z, 7, [2.6, 2.0, 0.9], 0.8);
  });
  saveSoon();
}

/* ------------------------------------------------------------------ */
/* the Sunken Cistern: water that rises                                 */
/* ------------------------------------------------------------------ */
const DEEP_FLOOD = { base: DEEP_POOL + 0.4, high: DEEP_Y + 0.75, rise: 16, hold: 40, drain: 24, again: 150, trigU: 168 };
const _deepW = { y: 0, depth: 0, fx: 0, fz: 0 };
// waterAt (01b_water.js) under the Barrow: the cistern's water where it stands over the floor
function late3WaterAt(x, z, out = _deepW) {
  if (!DEEP.built) return null;
  const u = dunU(x), v = dunV(z);
  if (u < 150 || u > 187 || v < 36 || v > 61) return null;
  const g = dunFloorAt(x, z), y = DEEP.wy;
  if (y <= g + 0.01) return null;
  out.y = y; out.depth = y - g; out.fx = 0; out.fz = 0;
  if (DEEP.flood.st === 1) { out.fx = -0.15; out.fz = -0.1; } // (the sluices' torrent pushes north as it fills)
  return out;
}
function deepFloodStep(dt) {
  const F = DEEP.flood, P = GAME.player, now = GAME.t;
  if (F.st === 0) {
    DEEP.wy = DEEP_FLOOD.base;
    if (P && P.alive && late3Room(P.x, P.z) === DUN_ROOM.cistern && dunU(P.x) < DEEP_FLOOD.trigU && now > F.next) {
      F.st = 1; F.t = 0; DEEP.stats.floods++;
      uiBanner('The sluices of the cistern burst. The water rises!', -1);
      sfxAt('crash', deepX(168.5), DEEP_Y + 2.5, deepZ(60.5)); sfxAt('splashBig', deepX(168.5), DEEP_Y, deepZ(58));
      cameraShake(0.2, deepX(168.5), deepZ(58));
      if (typeof loreNote === 'function') loreNote('l3flood');
      // the drowned rise with it
      F.drowned = F.drowned.filter((id) => { const o = getEnt(id); return o && o.alive; });
      for (const [u, v] of [[162, 48.5], [175, 48.5]]) if (F.drowned.length < 2) {
        const o = deepSpawn('drowned', 21, u, v, null);
        DEEP.adds.add(o.id); F.drowned.push(o.id);
        if (P) o.threat = new Map([[P.id, 1]]);
        splashAt(o.x, o.z, 1.6, { up: 1.3 });
      }
    }
  } else if (F.st === 1) {
    F.t += dt;
    DEEP.wy = lerp(DEEP_FLOOD.base, DEEP_FLOOD.high, smooth(clamp(F.t / DEEP_FLOOD.rise, 0, 1)));
    if (INDOOR.on) for (const u of [158, 168.5, 179]) if (Math.random() < dt * 20) {
      const x = deepX(u) + (Math.random() - 0.5) * 0.5, z = deepZ(59.7);
      fxAlpha.emit(x, DEEP_Y + 2.5, z, (Math.random() - 0.5) * 0.4, -0.5, -1.8 - Math.random(), 0.9, 0.55, 0.65, 0.68, 0.12, 9, 0);
      if (Math.random() < 0.3) splashAt(x, deepZ(58.5), 0.8);
    }
    if (F.t >= DEEP_FLOOD.rise) { F.st = 2; F.t = 0; }
  } else if (F.st === 2) {
    F.t += dt; DEEP.wy = DEEP_FLOOD.high;
    if (F.t >= DEEP_FLOOD.hold) { F.st = 3; F.t = 0; }
  } else if (F.st === 3) {
    F.t += dt;
    DEEP.wy = lerp(DEEP_FLOOD.high, DEEP_FLOOD.base, smooth(clamp(F.t / DEEP_FLOOD.drain, 0, 1)));
    if (F.t >= DEEP_FLOOD.drain) { F.st = 0; F.next = now + DEEP_FLOOD.again; }
  }
  if (DEEP.water) DEEP.water.position.y = DEEP.wy;
}

/* ------------------------------------------------------------------ */
/* Vorlach the Ash-Crowned                                             */
/* ------------------------------------------------------------------ */
const DEEP_LORD_NAME = 'Vorlach the Ash-Crowned';
const deepVetK = () => 1 + DEEP_LORD.vetK * Math.min(DEEP_LORD.vetMax, typeof LATE2 === 'object' ? LATE2.vet : 0);
function deepSpawnLord() {
  const sp = DEEP.seat;
  const e = makeEnt({
    kind: 'humanoid', faction: FACTION_MONSTER, role: 'dungeonBoss', mobType: 'skeleton', level: DEEP_LORD.base + barrowBoost(), baseLevel: DEEP_LORD.base, name: DEEP_LORD_NAME,
    tweak: { hp: DEEP_LORD.hp * deepVetK(), dmg: DEEP_LORD.dmg, speed: DEEP_LORD.speed, swing: 2.4, meleeRange: 3.2 },
    x: sp.x, z: sp.z, y: -17.4, yaw: Math.PI / 2, scale: DEEP_LORD.scale, radius: 0.55,
    look: { tabard: [0.2, 0.05, 0.035], armor: [0.4, 0.28, 0.15], skin: 0.2, hair: 0.1, mask: WB.axe | WB.cape | WB.circlet | WB.pauldron | WB.tabard | WB.belt | WB.skirt, flags: 1 | (1 << 4) | (3 << 7), scale: DEEP_LORD.scale, outfit: OUTFIT.skeleton, emblem: 3, fem: 0, bulk: 0.15 },
    home: { x: sp.x, z: sp.z, r: 1 }, camp: null,
  });
  e.deepLord = true;
  setupStats(e);
  e.ai.awake = false;
  e.seat = { y: sp.y }; e.fixedY = -17.4;
  DEEP.lord = e.id;
  DEEP.lordDead = false;
  const ch = DEEP.chests.find((c) => c.id === 'dhoard');
  if (ch) { ch.ready = false; ch.opened = false; }
  return e;
}
function deepLordFresh() {
  for (const id of DEEP.adds) { const o = getEnt(id); if (o) removeEnt(o); }
  DEEP.adds.clear();
  const e = getEnt(DEEP.lord);
  if (DEEP.lordDead || !e) return deepSpawnLord().id;
  deepLordReset(e);
  return e.id;
}
function deepLordReset(e) {
  for (const id of DEEP.adds) { const o = getEnt(id); if (o && o.alive && late3Room(o.x, o.z) === DUN_ROOM.ashhall) removeEnt(o); }
  e.hp = e.maxHp; e.threat = null; e.damagers = null; e.target = null; e.casting = null; e.buffs.length = 0;
  e.ai = { think: 0, awake: false };
  e.tweak.hp = DEEP_LORD.hp * deepVetK(); setupStats(e);
  const sp = DEEP.seat;
  e.x = e.prevX = sp.x; e.z = e.prevZ = sp.z; e.y = -17.4; e.seat = { y: sp.y }; e.fixedY = -17.4; e.yaw = Math.PI / 2;
  for (const S of DEEP.slabs) if (S.hall === 'ash' && S.st !== 0) deepSlabMend(S);
  deepPitchOut('ashhall');
}
function deepLordWake(e) {
  const ai = e.ai;
  ai.awake = true;
  e.seat = null; e.fixedY = null;
  const now = GAME.t;
  ai.nextCleave = now + 4; ai.nextWord = now + 7 + Math.random() * 3; ai.nextStamp = now + 9;
  sfxAtE('kingRoar', e, null, 2.6);
  cameraShake(0.3, e.x, e.z);
  uiBanner(`${DEEP_LORD_NAME} rises from the Ash Throne.`, -1);
  setAct(e, 5, 1.2);
  for (let i = 0; i < 40; i++) FX.trail(e.x + (Math.random() - 0.5) * 2, e.y + Math.random() * 3.8, e.z + (Math.random() - 0.5) * 2, [2.4, 1.0, 0.3], 0.16, 1.2);
  DEEP.lordSeen = true;
  if (typeof loreNote === 'function') loreNote('l3lord');
}
function deepLordCall(e, n) {
  // the ash-wardens climb out of the pits about the hall to his call
  uiBanner(`"Up from the ash, my wardens."`, -1);
  sfxAtE('raise', e, null, 2);
  DEEP.stats.calls++;
  const spots = [[28, 41.6], [54.5, 41.6], [28, 56.4], [54.5, 56.4]].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) {
    const [u, v] = spots[i];
    later(0.4 + i * 0.5, () => {
      if (!e.alive) return;
      const o = deepSpawn('cinder', 22, u, v, null, { name: 'ash-warden', hp: 0.7 });
      DEEP.adds.add(o.id);
      const P = GAME.player;
      if (P) o.threat = new Map([[P.id, 1]]);
      // up out of the pit's embers over its edge
      o.l3fall = { t: DEEP_SLAB.climbOut, x: o.x, z: o.z + (v < 48 ? -1.6 : 1.6), y0: DEEP_Y, y1: DEEP_PIT + 0.05, out: { x: o.x, z: o.z }, landed: true, burnT: 9, by: null };
      FX.burst(o.x, DEEP_Y, o.z, 24, [2.4, 1.0, 0.3], 2.4, 0.8, 0.14, -0.5);
    });
  }
}
function deepWord(e) {
  // the Ember Word spoken: the pitch about his foes catches, a ring of fire bursts from him, the embers mend him
  DEEP.stats.words++;
  sfxAtE('ventRoar', e, null, 1.5); sfxAtE('boom', e, null, 1.5);
  cameraShake(0.3, e.x, e.z);
  lightFlash(e.x, e.y + 1.5, e.z, 16, [3.0, 1.2, 0.35], 0.7);
  FX.ring(e.x, e.y + 0.4, e.z, 7, [2.4, 1.0, 0.3], 70, 11);
  FX.burst(e.x, e.y + 1.2, e.z, 50, [2.6, 1.1, 0.3], 6, 0.8, 0.18, 0.5);
  forNear(e.x, e.z, 6.5, (o) => {
    if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
    const r = computeDamage(e, o, 1.0);
    dealDamage(e, o, r.d, { crit: r.crit, kind: 'fire' });
    addBuff(o, 'burn', o.maxHp * 0.015, 4, e.id);
  });
  for (const o of ENT) {
    if (!o.alive || !isEnemy(e, o) || !isActor(o) || late3Room(o.x, o.z) !== DUN_ROOM.ashhall) continue;
    for (const C of DEEP.cells) if (C.hall === 'ashhall' && dist2(C.x, C.z, o.x, o.z) < 5 * 5) deepIgnite(C, e);
  }
  healEnt(e, e, e.maxHp * 0.04, true);
  uiBanner('The Ember Word is spoken: the pitch catches!', -1);
}
function deepWordBroken(e) {
  DEEP.stats.wordsBroken++;
  e.ai.word = null;
  setAct(e, 4, 1.0);
  e.ai.nextWord = GAME.t + (e.ai.enraged ? 9 : 13);
  e.ai.nextCleave = Math.max(e.ai.nextCleave, GAME.t + 1.6);
  uiFloatAt(e.x, e.y + 3.2 * (e.scale || 1), e.z, 'The Word is broken', 'crit');
  FX.burst(e.x, e.y + 2.4, e.z, 26, [1.6, 1.4, 1.2], 3, 0.5, 0.1, -1);
  sfxAtE('stagger', e, null, 2);
  const P = GAME.player;
  if (P && late3InDeep(P)) uiLog(`The Ember Word breaks in ${DEEP_LORD_NAME}'s throat.`, 'dmg');
}
function late3LordThink(e, dt) {
  const ai = e.ai, P = GAME.player, now = GAME.t;
  if (INDOOR.on && Math.random() < dt * (ai.enraged ? 30 : 12)) FX.trail(e.x + (Math.random() - 0.5) * 1.3, e.y + 0.5 + Math.random() * 3, e.z + (Math.random() - 0.5) * 1.3, ai.enraged ? [2.6, 0.9, 0.2] : [2.0, 0.8, 0.25], 0.12, 1.0);
  if (!ai.awake) {
    e.hp = e.maxHp;
    const inHall = (o) => o && o.alive && late3Room(o.x, o.z) === DUN_ROOM.ashhall;
    if ((inHall(P) && dist(P.x, P.z, e.x, e.z) < 34) || (e.threat && e.threat.size)) deepLordWake(e);
    return;
  }
  // a Word cut short: a stun, a flare, a storm, a blunt arrow (from any shot: the dead's spells, [balance9]) or a mace cleared his spell
  if (ai.word && (!e.casting || e.casting.id !== 'word')) deepWordBroken(e);
  let t = topThreat(e);
  if (!t && P && P.alive && late3InDeep(P)) t = P;
  if (!t || !t.alive || late3Room(t.x, t.z) !== DUN_ROOM.ashhall) {
    if (!ai.giveUpAt) ai.giveUpAt = now + 5;
    else if (now > ai.giveUpAt) { ai.giveUpAt = 0; deepLordReset(e); }
    return;
  }
  ai.giveUpAt = 0;
  e.target = t.id;
  const hpF = e.hp / e.maxHp;
  if (hpF < 0.66 && !ai.p2) { ai.p2 = true; ai.nextStamp = now + 2; deepLordCall(e, 2); }
  if (hpF < 0.33 && !ai.enraged) {
    ai.enraged = true; e.speed = DEEP_LORD.speedRage;
    addBuff(e, 'dmg', 0.2, 9999, 'l3rage');
    uiBanner(`${DEEP_LORD_NAME} burns with the fury of the first kings!`, -1);
    sfxAtE('kingRoar', e, null, 2.6);
    deepLordCall(e, 2);
    ai.nextWord = Math.min(ai.nextWord, now + 4);
  }
  if (e.casting && e.casting.custom) {
    const c = e.casting;
    c.t += dt;
    if (c.id === 'word') {
      if (Math.random() < dt * 50) { const a = Math.random() * TAU, r = 1.2 + Math.random() * 3; fxAdd.emit(e.x + Math.cos(a) * r, e.y + 0.3, e.z + Math.sin(a) * r, -Math.cos(a) * 1.2, 1.4, -Math.sin(a) * 1.2, 0.6, 2.2, 0.9, 0.25, 0.14, 0, 1); }
      if (c.t >= c.total) { e.casting = null; ai.word = null; deepWord(e); ai.nextWord = now + (ai.enraged ? DEEP_LORD.wordCdRage : DEEP_LORD.wordCd[0] + Math.random() * (DEEP_LORD.wordCd[1] - DEEP_LORD.wordCd[0])); }
    } else if (c.id === 'cleave') {
      turnToward(e, t.x, t.z, dt * 2.5);
      if (!c.hit && c.t >= 0.9) {
        c.hit = true;
        spawnSlash(e, true);
        sfxAtE('swing', e, { vol: 1.5 }, 1.6); cameraShake(0.25, e.x, e.z);
        forNear(e.x, e.z, 5.6, (o) => {
          if (!o.alive || !isEnemy(e, o) || !isActor(o)) return;
          if (Math.abs(angDiff(e.yaw, Math.atan2(o.x - e.x, o.z - e.z))) > 1.1) return;
          const r = computeDamage(e, o, 1.6);
          dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee' });
          FX.sparks(o.x, o.y + 1.1, o.z);
        });
      }
      if (c.t >= c.total) { e.casting = null; ai.nextCleave = now + (ai.enraged ? 5.5 : DEEP_LORD.cleaveCd[0] + Math.random() * (DEEP_LORD.cleaveCd[1] - DEEP_LORD.cleaveCd[0])); e.swingAt = now + 1.0; }
    } else if (c.id === 'stamp') {
      if (!c.hit && c.t >= 0.85) {
        c.hit = true;
        sfxAtE('quake', e, null, 0.3); cameraShake(0.35, e.x, e.z);
        FX.ring(e.x, e.y + 0.2, e.z, 4, [0.5, 0.42, 0.36], 50, 8);
        for (let i = 0; i < 3; i++) FX.dust(e.x + (Math.random() - 0.5) * 3, e.y, e.z + (Math.random() - 0.5) * 3, 10, [0.32, 0.29, 0.26]);
        forNear(e.x, e.z, 4.2, (o) => { if (!o.alive || !isEnemy(e, o) || !isActor(o)) return; const r = computeDamage(e, o, 0.8); dealDamage(e, o, r.d, { crit: r.crit, kind: 'melee' }); });
        // the slabs nearest his foe crack, and fall
        const cand = DEEP.slabs.filter((S) => S.hall === 'ash' && S.st === 0 && dist(S.x, S.z, e.x, e.z) > 3).sort((a, b) => dist2(a.x, a.z, t.x, t.z) - dist2(b.x, b.z, t.x, t.z));
        for (const S of cand.slice(0, ai.enraged ? 3 : 2)) deepSlabCrack(S, 1.9, e);
        DEEP.stats.stamps++;
      }
      if (c.t >= c.total) { e.casting = null; ai.nextStamp = now + DEEP_LORD.stampCd[0] + Math.random() * (DEEP_LORD.stampCd[1] - DEEP_LORD.stampCd[0]); }
    } else e.casting = null;
    return;
  }
  const d = dist(e.x, e.z, t.x, t.z);
  if (now > ai.nextWord && d < 18) {
    const T = ai.enraged ? DEEP_LORD.wordRage : DEEP_LORD.wordT;
    e.casting = { id: 'word', custom: true, t: 0, total: T, targetId: t.id };
    ai.word = { t0: now };
    setAct(e, 3, T);
    sfxAtE('cast', e, null, 2);
    uiFloatAt(e.x, e.y + 3.4 * (e.scale || 1), e.z, 'The Ember Word', 'immune');
    if (t === GAME.player) uiLog(`${DEEP_LORD_NAME} begins the Ember Word: break it!`, 'warn');
    return;
  }
  if (ai.p2 && now > ai.nextStamp && d < 14) {
    e.casting = { id: 'stamp', custom: true, t: 0, total: 1.3, targetId: t.id };
    setAct(e, 8, 1.1);
    aoeMarker(e.x, e.z, 4.2, 0.85, e.faction);
    DEEP.marks.push({ x: e.x, z: e.z, r: 4.4, until: now + 0.85 });
    return;
  }
  if (now > ai.nextCleave && d < 4.8) {
    e.casting = { id: 'cleave', custom: true, t: 0, total: 1.3, targetId: t.id };
    setAct(e, 8, 1.1);
    const fx = e.x + Math.sin(e.yaw) * 3, fz = e.z + Math.cos(e.yaw) * 3;
    aoeMarker(fx, fz, 3.0, 0.9, e.faction);
    DEEP.marks.push({ x: fx, z: fz, r: 3.2, until: now + 0.9 });
    DEEP.stats.cleaves++;
    return;
  }
  fightTarget(e, t, dt);
}
function late3LordDeath(e, killer) {
  void killer;
  DEEP.lordDead = true; DEEP.lordAt = GAME.t + DEEP_LORD.respawn;
  DEEP.kills++;
  DEEP.stats.lordFell++;
  for (const id of DEEP.adds) { const o = getEnt(id); if (o && o.alive && late3Room(o.x, o.z) === DUN_ROOM.ashhall) killEnt(o, null); }
  sfxAtE('kingDeath', e, null, 2);
  cameraShake(0.5, e.x, e.z);
  flashScreen([1.0, 0.55, 0.25], 0.35);
  FX.burst(e.x, e.y + 1.8, e.z, 100, [2.6, 1.1, 0.3], 5, 1.4, 0.2, -0.5);
  lightFlash(e.x, e.y + 2, e.z, 20, [3.0, 1.4, 0.4], 1.6);
  deepPitchOut('ashhall');
  later(2.0, () => {
    const ch = DEEP.chests.find((c) => c.id === 'dhoard');
    if (ch) { ch.ready = true; ch.opened = false; delete DEEP.taken.dhoard; }
    uiBanner(`${DEEP_LORD_NAME} is ash. The first king's hoard lies open by his throne.`, -1);
    for (const S of DEEP.slabs) if (S.hall === 'ash' && S.st === 3) { S.st = 4; S.t = 0; }
  });
  saveSoon();
}

/* ------------------------------------------------------------------ */
/* the skilled bots: what a veteran knows (botDodge, 07c_balance5.js)  */
/* ------------------------------------------------------------------ */
// a cracking slab under it, the lord's cleave or stamp about to land, the pitch burning under its feet: out of it
// [late3] how near a pressing blade may come before a skilled bow or staff stops drawing and steps away (botMove,
// 07c_balance.js): a man's reach (3.2 m, as before for every body of a man's size), a giant's by its own (the Ash-Crowned
// cleaves from six metres: the archer stood drawing in his reach and died at 50)
function late3KiteReach(p) { const sc = p.scale || 1; return sc > 1.25 ? (p.meleeRange || 2.6) * sc + 1.0 : 3.2; }
// [late3] a skilled bow or staff stepping away from a blade under the Barrow (botMove, 07c_balance.js): the halls have
// pillars, braziers and pits, and a step straight away pressed the archer against a pillar of the Ash Throne, where it
// stood drawing in his reach until it died; the way out turns along what stands there (only under the Barrow: the
// duels' and the pack's arenas are open ground and keep their measure)
const _l3cn = [];
function late3Clear(x, z, r, fire) {
  if (!isWalkable(x, z)) return false;
  if (fire) for (const C of DEEP.cells) if (C.st === 1 && C.heat > 0.2 && distToSeg(x, z, C.ax, C.az, C.bx, C.bz) < 1.0) return false;
  collidersNear(x, z, r + 2, _l3cn);
  for (const c of _l3cn) {
    if (!c.active) continue;
    if (c.type === 'circle') { if (dist2(x, z, c.x, c.z) < (c.r + r) * (c.r + r)) return false; }
    else { const dx = x - c.x, dz = z - c.z, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) return false; }
  }
  return true;
}
function late3KiteWay(e, ax, az, p, H) {
  // the way out of sixteen, clear for 3.5 m (else 1.4): where it ends farthest from the blade, kept off the hall's walls
  // and corners (within 0.7 of the arena's reach of its middle), the way it went before a little preferred, so it circles
  // the hall instead of running into a corner (the arena's rim bent the step back toward its middle, and the lord stood
  // there: the bow walked into his reach; straight away from him, it ran into the corner and stood there)
  const r = (e.radius || 0.45) + 0.1, B = e.bot || {};
  const ok = (dx, dz, len) => { for (let s = 0.7; s <= len + 0.01; s += 0.7) if (!late3Clear(e.x + dx * s, e.z + dz * s, r, true)) return false; return true; };
  const room = late3Room(e.x, e.z);
  for (const len of [3.5, 1.4]) {
    let best = null, bs = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16, dx = Math.sin(a), dz = Math.cos(a);
      if (!ok(dx, dz, len)) continue;
      const ex = e.x + dx * 3.5, ez = e.z + dz * 3.5;
      let sc = dist(ex, ez, p.x, p.z) + 0.3 * (dx * ax + dz * az);
      if (H) sc -= 1.5 * Math.max(0, dist(ex, ez, H.x, H.z) - 0.7 * H.r);
      if (B.l3dir) sc += 0.6 * (dx * B.l3dir[0] + dz * B.l3dir[1]);
      if (late3Room(ex, ez) !== room) sc -= 6; // (out of a lord's hall he goes back to his throne)
      if (sc > bs) { bs = sc; best = [dx, dz]; }
    }
    if (best) { B.l3dir = best; return best; }
  }
  return [ax, az];
}
function late3BotHazard(e, t) {
  if (!DEEP.built || !late3InDeep(e)) return null;
  const now = GAME.t, rr = e.radius * (e.scale || 1);
  for (const S of DEEP.slabs) if (S.st === 1 && inSlab(S, e.x, e.z, rr)) {
    const out = deepEdgeOut(S, e.x, e.z), d = Math.max(0.2, dist(e.x, e.z, out.x, out.z));
    return { x: e.x + (e.x - out.x) / d, z: e.z + (e.z - out.z) / d, now: true, out: d };
  }
  for (const M of DEEP.marks) if (!M.slab && M.until > now && dist(e.x, e.z, M.x, M.z) < M.r + rr) return { x: M.x, z: M.z, now: true, out: M.r + rr - dist(e.x, e.z, M.x, M.z) };
  for (const C of DEEP.cells) if (C.st === 1 && C.heat > 0.3 && distToSeg(e.x, e.z, C.ax, C.az, C.bx, C.bz) < 0.9) {
    // out of the burning pitch by the nearest way that is not burning, away from the foe (straight away from the cell's
    // middle a bow kiting the Ash-Crowned stepped back into his reach, then back into the fire, for seconds on end)
    const d = late3FireWay(e, t && t.alive ? t : null);
    return { x: e.x - d[0], z: e.z - d[1], now: false };
  }
  return null;
}
function late3FireWay(e, foe) {
  const r = (e.radius || 0.45) + 0.1;
  let best = [0, 1], bs = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = i * TAU / 16, dx = Math.sin(a), dz = Math.cos(a);
    let sc = 0;
    for (let s = 0.7; s <= 2.11; s += 0.7) if (!late3Clear(e.x + dx * s, e.z + dz * s, r, s > 1.3)) { sc = -100 + s; break; }
    if (sc > -50 && foe) sc += 0.4 * dist(e.x + dx * 2.1, e.z + dz * 2.1, foe.x, foe.z);
    if (sc > bs) { bs = sc; best = [dx, dz]; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* the light of the deep's halls (applyIndoor, 04d_barrow.js)           */
/* ------------------------------------------------------------------ */
// The Barrow's halls are lit by their torches over a faint cold ambient. The deep's are great halls lit by what burns or
// glows in them (the cistern's cold glow off the water, the pyres', the pits' embers): their ambient takes its colour and
// is stronger, and its fog thinner, so the far side of a hall reads (at low, with four lights, the cistern was black)
const DEEP_AMB = { cistern: [0.12, 0.18, 0.19], dpass1: [0.07, 0.09, 0.1], pyres: [0.19, 0.11, 0.065], dpass2: [0.12, 0.08, 0.055], crack: [0.18, 0.095, 0.055], niche: [0.1, 0.07, 0.05], nichedoor: [0.1, 0.07, 0.05], dpass3: [0.12, 0.08, 0.055], ashhall: [0.2, 0.11, 0.065], dstair: [0.09, 0.07, 0.06], dland: [0.08, 0.09, 0.09] };
function late3IndoorLight(lowQ) {
  if (!DEEP.built) return;
  const R = late3Room(camera.position.x, camera.position.z);
  const a = R && DEEP_AMB[R.id];
  if (!a) return;
  U.uAmbient.value.set(a[0] * lowQ, a[1] * lowQ, a[2] * lowQ);
  U.uFogDensity.value = R.id === 'dstair' || R.id.startsWith('dpass') || R.id.startsWith('niche') ? 0.028 : 0.018;
  U.uZenith.value.set(a[0] * 0.12, a[1] * 0.12, a[2] * 0.12); U.uHorizon.value.copy(U.uZenith.value);
}

/* ------------------------------------------------------------------ */
/* each step (updateBarrow, 08e_barrow.js)                              */
/* ------------------------------------------------------------------ */
function late3Update(dt) {
  late3VetStep(dt); // (the standard of your name falling or rising: 10n_veteran.js)
  if (!DEEP.built) return;
  const P = GAME.player, now = GAME.t;
  // the seal sinking into the floor
  const S = DEEP.seal;
  if (S && S.open !== S.target) {
    const was = S.open;
    S.open = clamp(S.open + Math.sign(S.target - S.open) * dt / 3.4, 0, 1);
    deepSealPose();
    if (INDOOR.on && Math.floor(was * 8) !== Math.floor(S.open * 8)) { sfxAt('grind', S.mesh.position.x, -6, S.mesh.position.z); cameraShake(0.06, S.mesh.position.x, S.mesh.position.z); }
  }
  const inDeep = !!P && P.alive && late3InDeep(P);
  if (inDeep && !DEEP.inDeep) { uiLog('You go down into the Deep Barrow, where the first kings were burned.', 'sys'); if (typeof loreNote === 'function') loreNote('l3deep'); }
  DEEP.inDeep = inDeep;
  if (inDeep) DEEP.lastDeep = now;
  // the deep is drawn only from its own halls, or the Hollow King's hall above its stair (the Barrow's other halls do not
  // pay for it: frustum culling keeps its big merged mesh in nearly every view of the Barrow)
  if (DEEP.root) DEEP.root.visible = inDeep || (!!P && inDungeon(P) && dunU(P.x) > 160);
  DEEP.marks = DEEP.marks.filter((M) => M.until > now);
  for (const o of ENT) if (o.l3fall && o.alive && !o.removed) deepFallStep(o, dt);
  deepSlabStep(dt);
  deepPitchStep(dt);
  deepFloodStep(dt);
  // the deep's dead come back in time, nobody near
  const near = (x, z, r) => P && inDungeon(P) && dist2(P.x, P.z, x, z) < r * r;
  for (const pk of DEEP_PACKS) {
    for (let i = pk.respawn.length - 1; i >= 0; i--) {
      const R = pk.respawn[i];
      if (now < R.at) continue;
      const [type, lvl, u, v] = R.spec;
      if (near(dunWX(u), dunWZ(v), 34)) { R.at = now + 15; continue; }
      pk.respawn.splice(i, 1);
      pk.members.add(deepSpawn(type, lvl, u, v, pk).id);
    }
  }
  if (DEEP.lordDead && now > DEEP.lordAt && !near(DEEP.throne.x, DEEP.throne.z, 60)) deepSpawnLord();
  // the chests fill again
  for (const ch of DEEP.chests) if (ch.opened && ch.id !== 'dhoard' && now > ch.refillAt && !near(ch.x, ch.z, 30)) { ch.opened = false; delete DEEP.taken[ch.id]; }
  // what the field notes watch, four times a second
  DEEP.step -= dt;
  if (DEEP.step <= 0 && P) {
    DEEP.step = 0.25;
    const N = DEEP.near;
    N.seal = inDungeon(P) && dist2(P.x, P.z, dunWX(DEEP_SEAL.u), dunWZ(DEEP_SEAL.v)) < 14 * 14;
    N.deep = inDeep;
    N.slab = inDeep && DEEP.slabs.some((s) => s.hall === 'crack' && dist2(P.x, P.z, s.x, s.z) < 9 * 9);
    N.pitch = inDeep && DEEP.cells.some((c) => dist2(P.x, P.z, c.x, c.z) < 8 * 8);
  }
  // the deep's air: embers drifting up in the hot halls, drips in the cistern
  if (inDeep && INDOOR.on) {
    const R = late3Room(P.x, P.z);
    if (R && R.id !== 'cistern' && R.id !== 'dstair' && R.id !== 'dland' && Math.random() < dt * 10) {
      const a = Math.random() * TAU, r = 2 + Math.random() * 9, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      if (isWalkable(x, z)) fxAdd.emit(x, DEEP_Y + 0.3 + Math.random() * 3, z, (Math.random() - 0.5) * 0.2, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2, 2.5, 2.2, 0.8, 0.22, 0.03, -0.05, 0);
    }
  }
}

/* ------------------------------------------------------------------ */
/* what players are told                                               */
/* ------------------------------------------------------------------ */
// the herald's word (openHerald, 10_ui.js)
function late3HeraldText() {
  const prog = GAME.prog;
  if (!prog || prog.level < 40) return '';
  if (DEEP.opened) return `<p>They say you have gone down beneath the Hollow King's hall, where the first kings were burned${DEEP.kills ? ` and that ${DEEP_LORD_NAME} is ash at your hand` : ''}. The roads above are safer for it.</p>`;
  return `<p>Old stories tell of a stair beneath the Hollow King's hall, sealed by the first kings of the barrow. ${esc(late3SealWhy())}</p>`;
}
LATE2.d.deep = 0;
LATE2_DEEDS.deep = 'The Ash-Crowned brought down';
{
  const N = { id: 'ashbane', t: 'Ashbane', deed: 'deep', n: 1, rp: 1200, k: { dead: 0.05, fireDr: 0.1 }, gift: 'You strike the dead 5% harder, and fire harms you 10% less.' };
  const i = LATE2_NAMES.findIndex((x) => x.deed === 'rr');
  LATE2_NAMES.splice(i < 0 ? LATE2_NAMES.length : i, 0, N);
  LATE2_BY_ID[N.id] = N;
}
// the aims past the path (late2Aims, 10l_late.js)
function late3Aims() {
  const prog = GAME.prog, out = [];
  if (!prog || prog.level < 40 || !DEEP.built) return out;
  if (!DEEP.opened) {
    const why = late3SealReady() ? 'The runes know you: break the seal in the south wall of the Hollow King\'s hall.' : late3SealWhy();
    out.push({ t: 'Open the way beneath the Hollow King\'s hall', x: why });
  } else if (!DEEP.kills) out.push({ t: `Bring down ${DEEP_LORD_NAME}`, x: 'In the last hall of the Deep Barrow, past the Sunken Cistern, the Hall of Pyres and the Breaking Gallery. Break his Ember Word, step off the cracking floor.' });
  return out;
}
function chronDeep() {
  const lv = GAME.prog ? GAME.prog.level : 1, lord = getEnt(DEEP.lord);
  const now = !DEEP.opened ? `The seal is unbroken. ${esc(late3SealWhy() || 'The runes know you: break it.')}` : `The way down is open to you. ${DEEP.kills ? `${DEEP_LORD_NAME} has fallen to you ${DEEP.kills === 1 ? 'once' : DEEP.kills + ' times'}${lord && lord.alive ? ', and sits his throne again' : ''}.` : `${DEEP_LORD_NAME} sits his throne.`}`;
  return `<h2>The Deep Barrow</h2>
  <p class="lead">Beneath the Hollow King's hall a stair goes down to the halls of the first kings of the barrow, who burned their dead and were burned in their turn. It is older than the Barrow, deeper and hotter, lit by what burns there. It opens to a veteran: one who has laid the Hollow King to rest and reached level ${DEEP_LV}.</p>
  <h3>The way down</h3><p>The stair is in the south wall of the Hollow King's hall, behind a seal of the first kings' runes. ${IS_TOUCH ? 'Tap Use' : 'Press E'} at the seal: it yields to the Hollow King's slayer at level ${DEEP_LV}, and stays open to you.</p>
  <h3>The halls and their dangers</h3><ul class="plain">
  <li><b>The Sunken Cistern</b>: its sluices burst as you cross it, and the water rises over the walkways. In deep water you swim: no spell or shot. The drowned rise with it, and their hands drag at you in the water.</li>
  <li><b>The Hall of Pyres</b>: pitch runs in channels across the floor. Fire spreads along it: a fire spell lights it under your foes as surely as the pyre-keeper's Kindle lights it under you. Break the Kindle, and step out of the flames.</li>
  <li><b>The Breaking Gallery</b>: the floor is slabs over a pit of embers. Stand on one too long and it cracks and falls; a meteor or a leap strike breaks one at once. Keep moving. A cracked wall there hides a tomb the barrow forgot.</li>
  <li><b>The Ash Throne</b>: ${esc(DEEP_LORD_NAME)}, first of the barrow-kings.</li></ul>
  <h3>The Ash-Crowned</h3><p>He keeps pace with you to level 50 and past it (a veteran finds him the stronger). Parry, shield or step out of his cleave. When he speaks the Ember Word, break it: a stun or a shield bash, a priest's Holy Fire, a mage's storm, a blunt arrow, a mace; spoken, it lights the pitch about you, burns all near him and mends him.${lordHolyText()} From two thirds of his strength he stamps, and the slabs of his hall crack and fall; he calls his ash-wardens up out of the pits, and at a third he burns with fury.</p>
  <h3>Spoils</h3><p>The deep's chests pay above the Barrow's, and his hoard is at the top of the gear curve (item level 50, epic and legendary). His fall is a deed: the March names you Ashbane.</p>
  <p class="now">${now}${lv < DEEP_LV ? ` You are level ${lv}.` : ''}</p>`;
}
chronAdd('deep', 'The Deep', 'land', chronDeep, 'barrow');
CHRON_EXTRA.goals.push(() => `<div class="gd-tier"><h4>The Deep Barrow</h4><ul class="plain">
  <li><b>Beneath the Hollow King's hall</b>: from level ${DEEP_LV}, his slayer may break the seal of the first kings and go down into the Deep Barrow. ${DEEP.opened ? 'You have.' : ''}</li>
  <li><b>${esc(DEEP_LORD_NAME)}</b>: the first of the barrow-kings, a fight in phases. His hoard is at the top of the gear curve; his fall earns the name Ashbane. ${chronLink('deep', 'The Deep')}</li></ul></div>`);
for (const [id, note] of Object.entries({
  l3seal: { t: 'A sealed stair', x: () => `A stair goes down from the Hollow King's hall behind a seal of the first kings' runes. It yields to his slayer at level ${DEEP_LV}. ${IS_TOUCH ? 'Tap Use' : 'Press E'} at the seal.` },
  l3deep: { t: 'The Deep Barrow', x: () => 'The halls of the first kings: water that rises, pitch that burns, floors that break. The dead here are a little above you, and their king above them. The Chronicle\'s Deep page tells of them.' },
  l3slab: { t: 'A floor that breaks', x: () => 'These slabs lie over a pit of embers. Stand on one too long and it cracks and falls: keep moving. If you fall, you climb out burnt.' },
  l3pitch: { t: 'Pitch', x: () => 'Pitch runs in the channels. Fire spreads along it and burns whoever stands in it: a fire spell lights it under your foes; break a pyre-keeper\'s Kindle before it lights it under you.' },
  l3flood: { t: 'The water rises', x: () => 'In deep water you swim: no spell, no shot. The water puts out a fire on you. Keep to the walkways, or swim for it.' },
  l3lord: { t: 'The Ash-Crowned', x: () => 'Break his Ember Word: a stun or a bash, Holy Fire, a storm, a blunt arrow, a mace. Parry, shield or step out of his cleave, and off the slabs when they crack.' },
})) if (!FIELD_NOTES[id]) FIELD_NOTES[id] = note;
Object.assign(GUIDE_WATCH, {
  l3seal: () => DEEP.near.seal && !DEEP.opened,
  l3slab: () => DEEP.near.slab,
  l3pitch: () => DEEP.near.pitch,
});
GUIDE_HELP.push(() => `<h3>The Deep Barrow</h3><p>From level ${DEEP_LV}, once you have laid the Hollow King to rest, break the seal in the south wall of his hall (${IS_TOUCH ? 'Use' : 'E'}) and go down. The cistern floods as you cross it (you swim in deep water: no spell or shot), pitch burns in channels (step out of it; a fire spell lights it under your foes), the gallery's slabs crack under you (keep moving). Break the Ash-Crowned's Ember Word, and parry or step out of his cleave.</p>`);
LOADING_TIPS.push(
  'Beneath the Hollow King\'s hall a sealed stair goes down. It yields to his slayer at level 45.',
  'In the Deep Barrow a fire spell lights the pitch in the channels under your foes. It lights it under you as well.',
  'The Ash-Crowned\'s Ember Word can be broken: a stun, a bash, Holy Fire, a storm, a blunt arrow, a mace.',
);

/* ------------------------------------------------------------------ */
/* the save: the seal, the lord's falls, the wall, what is taken        */
/* ------------------------------------------------------------------ */
function late3ApplySaved() {
  if (!DEEP.built) return;
  if (DEEP.opened) late3SealOpen(true);
  else { DEEP.seal.target = 0; DEEP.seal.open = 0; deepSealPose(); }
  deepWallShow();
  for (const ch of DEEP.chests) {
    const at = DEEP.taken[ch.id];
    if (ch.id === 'dhoard') continue;
    ch.opened = at != null && at > GAME.t;
    if (ch.opened) ch.refillAt = at;
  }
}
const DEEP_PART = {
  save() {
    const taken = {};
    for (const id in DEEP.taken) { const s = Math.round(DEEP.taken[id] - GAME.t); if (s > 0 && id !== 'dhoard') taken[id] = s; }
    if (!DEEP.opened && !DEEP.kills && !DEEP.wallBroken && !Object.keys(taken).length) return null;
    return { v: 1, o: DEEP.opened ? 1 : 0, k: DEEP.kills, w: DEEP.wallBroken ? 1 : 0, c: taken };
  },
  load(o) {
    o = o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    DEEP.opened = !!(o && o.o);
    DEEP.kills = o && Number.isFinite(+o.k) ? clamp(Math.floor(+o.k), 0, 1e6) : 0;
    DEEP.wallBroken = !!(o && o.w);
    DEEP.taken = {};
    const c = o && o.c && typeof o.c === 'object' && !Array.isArray(o.c) ? o.c : {};
    for (const id of ['dcist', 'dpyre', 'dniche']) { const s = +c[id]; if (Number.isFinite(s) && s > 0) DEEP.taken[id] = GAME.t + Math.min(s, DEEP_RESPAWN * 2); }
    if (DEEP.kills && LATE2.d.deep < DEEP.kills) { LATE2.d.deep = DEEP.kills; late2CheckNames(true); }
    try { late3ApplySaved(); } catch (e) { reportError(e); }
  },
  key: (o) => (o ? [o.o, o.k, o.w, Object.keys(o.c || {}).sort().join()] : null),
};
registerSavePart('char', 'deep', DEEP_PART);

queueMicrotask(() => { if (!window.__hm) return; Object.assign(window.__hm.fn, { dunWX, dunWZ, dunU, dunV, dunIdx, dunCellAt, stepTo, waterAt, fireLandsAt, natureImpact, late3IsDeepCell }); window.__hm.deep = { DEEP_PART, DUN_ROOM, DEEP, DEEP_ROOMS, DEEP_SLABS, DEEP_CHANNELS, DEEP_PACKS, DEEP_LORD, DEEP_FIRE, DEEP_SLAB, DEEP_FLOOD, DEEP_SEAL, DEEP_LV, DEEP_Y, DEEP_PIT, DEEP_POOL, late3SealReady, late3SealWhy, late3SealOpen, late3InDeep, late3Room, late3WaterAt, late3FireAt, late3Impact, late3Offers, late3OpenChest, late3LordThink, late3Aims, late3BotHazard, late3HeraldText, chronDeep, deepIgnite, deepCellNear, deepSlabCrack, deepSlabFall, deepSlabMend, deepFall, deepWallBreak, deepWallShow, deepWallStrike, deepLordFresh, deepLordReset, deepSpawnLord, deepWord, deepPitchOut, deepEdgeOut, deepSpawn, deepPacksFresh }; });
