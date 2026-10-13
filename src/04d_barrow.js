/* ================================================================== */
/* the Barrow: a long mound by the Lone Tree, and the halls beneath it */
/* ================================================================== */
// The halls lie far outside the map (x > 1000) on their own floor grid; heightAt and
// isWalkable defer to that grid there, so every other system works unchanged.
const DUN_X0 = 1000;
const DUN = {
  ox: 1400, oz: 0, u0: -10, v0: -18, GW: 230, GH: 48,
  cell: null, room: null, fy: null, cy: null, built: false,
  root: null, gates: {}, chests: [], vents: [], lights: [], torches: [], tombs: [], spots: {},
};
const inDungeonX = (x) => x > DUN_X0;
// rooms on a 1 m grid (u east along the barrow, v across it); fy is the floor (or a ramp along u), h the headroom
const DUN_ROOMS = [
  { id: 'mouth', name: 'The Barrow Mouth', u: [0, 14], v: [-5, 5], fy: 0, h: 6.5 },
  { id: 'bones', name: 'The Passage of Bones', u: [14, 42], v: [-3, 3], fy: [0, -3.5], h: 5 },
  { id: 'ossuary', name: 'The Ossuary', u: [42, 62], v: [-10, 10], fy: -3.5, h: 7 },
  { id: 'sidepass', name: 'The Ossuary', u: [49, 55], v: [10, 15], fy: -3.5, h: 4.6 },
  { id: 'crypt', name: 'The Side Crypt', u: [44, 60], v: [15, 27], fy: -3.5, h: 6 },
  { id: 'c5', name: 'The Hall of Pillars', u: [62, 68], v: [-3, 3], fy: -3.5, h: 5 },
  { id: 'pillars', name: 'The Hall of Pillars', u: [68, 100], v: [-13, 13], fy: -3.5, h: 9 },
  { id: 'vents', name: 'The Burning Gallery', u: [100, 132], v: [-3, 3], fy: [-3.5, -7], h: 5.5 },
  { id: 'well', name: 'The Well of Souls', round: true, cu: 144, cv: 0, r: 12, u: [132, 156], v: [-12, 12], fy: -7, h: 7 },
  { id: 'gate', name: 'The Well of Souls', u: [156, 166], v: [-3, 3], fy: -7, h: 5.5 },
  { id: 'throne', name: "The Hollow King's Hall", u: [166, 198], v: [-15, 15], fy: -7, h: 12 },
  { id: 'vaultpass', name: "The Hollow King's Hall", u: [198, 204], v: [-2, 2], fy: -6.2, h: 4 },
  { id: 'vault', name: 'The Vault', u: [204, 214], v: [-5, 5], fy: -6.2, h: 5 },
];
const DUN_ROOM = Object.fromEntries(DUN_ROOMS.map((R, i) => { R.idx = i; return [R.id, R]; }));
const dunWX = (u) => DUN.ox + u, dunWZ = (v) => DUN.oz + v;
const dunU = (x) => x - DUN.ox, dunV = (z) => z - DUN.oz;
function dunIdx(i, j) { return i < 0 || j < 0 || i >= DUN.GW || j >= DUN.GH ? -1 : j * DUN.GW + i; }
function dunCellAt(x, z) { return dunIdx(Math.floor(dunU(x) - DUN.u0), Math.floor(dunV(z) - DUN.v0)); }
function roomFloor(R, u) { return Array.isArray(R.fy) ? lerp(R.fy[0], R.fy[1], clamp((u - R.u[0]) / (R.u[1] - R.u[0]), 0, 1)) : R.fy; }

function buildDungeonGrid() {
  const N = DUN.GW * DUN.GH;
  const cell = new Uint8Array(N), room = new Int16Array(N).fill(-1), fy = new Float32Array(N), cy = new Float32Array(N);
  for (const R of DUN_ROOMS) {
    for (let u = R.u[0]; u < R.u[1]; u++) for (let v = R.v[0]; v < R.v[1]; v++) {
      if (R.round && dist(u + 0.5, v + 0.5, R.cu, R.cv) > R.r) continue;
      const k = dunIdx(u - DUN.u0, v - DUN.v0);
      if (k < 0) continue;
      const f = roomFloor(R, u + 0.5);
      // where two rooms meet, the bigger space wins the ceiling
      if (cell[k] === 1 && cy[k] >= f + R.h) continue;
      cell[k] = 1; room[k] = R.idx; fy[k] = f; cy[k] = f + R.h;
    }
  }
  // the dais at the head of the hall
  for (let u = 190; u < 198; u++) for (let v = -6; v < 6; v++) { const k = dunIdx(u - DUN.u0, v - DUN.v0); fy[k] = -6.2; }
  // the stair up to the daylight: walkable, but drawn by its own steps (cell type 3)
  for (let u = -8; u < 0; u++) for (let v = -2; v < 2; v++) { const k = dunIdx(u - DUN.u0, v - DUN.v0); cell[k] = 3; room[k] = 0; fy[k] = (-u) * 0.56; cy[k] = fy[k] + 4.2; }
  // rock cells borrow the height of the nearest floor so the bilinear sample never spikes
  const known = new Uint8Array(N);
  for (let k = 0; k < N; k++) known[k] = cell[k] ? 1 : 0;
  for (let pass = 0; pass < 40; pass++) {
    let changed = 0;
    for (let j = 0; j < DUN.GH; j++) for (let i = 0; i < DUN.GW; i++) {
      const k = j * DUN.GW + i;
      if (known[k]) continue;
      let s = 0, c = 0, sc = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = dunIdx(i + di, j + dj); if (q >= 0 && known[q] === 1) { s += fy[q]; sc += cy[q]; c++; } }
      if (c) { fy[k] = s / c; cy[k] = sc / c; known[k] = 2; changed++; }
    }
    for (let k = 0; k < N; k++) if (known[k] === 2) known[k] = 1;
    if (!changed) break;
  }
  Object.assign(DUN, { cell, room, fy, cy });
}
function dunFloorAt(x, z) {
  if (!DUN.fy) return 0;
  const gx = clamp(dunU(x) - DUN.u0 - 0.5, 0, DUN.GW - 1.001), gz = clamp(dunV(z) - DUN.v0 - 0.5, 0, DUN.GH - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * DUN.GW + i, F = DUN.fy;
  const a = F[k], b = F[k + 1], c = F[k + DUN.GW], d = F[k + DUN.GW + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function dunCeilAt(x, z) { const k = dunCellAt(x, z); return k >= 0 && DUN.cy ? DUN.cy[k] : 10; }
const dunOpen = (t) => t === 1 || t === 3;
function dunWalkable(x, z) { const k = dunCellAt(x, z); return k >= 0 && DUN.cell && dunOpen(DUN.cell[k]); }
function dunRoomAt(x, z) { const k = dunCellAt(x, z); return k >= 0 && DUN.room && DUN.room[k] >= 0 ? DUN_ROOMS[DUN.room[k]] : null; }
const dunPoint = (u, v, dy = 0) => ({ x: dunWX(u), z: dunWZ(v), y: dunFloorAt(dunWX(u), dunWZ(v)) + dy });

/* ------------------------------------------------------------------ */
/* the floor: big irregular flags, dark joints, damp patches           */
/* ------------------------------------------------------------------ */
const dunFloorMat = mat({
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
    varying vec3 vW; varying vec3 vN;
    void main(){
      vec3 n = safeNormalize(vN);
      vec2 p = vW.xz / 1.05;
      vec2 c = floor(p), f = fract(p);
      float d1 = 9.0, d2 = 9.0; vec2 best = c;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 r = o + hash22(c + o) * 0.72 + 0.14 - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; best = c + o; } else if (d < d2) d2 = d;
      }
      float edge = sqrt(d2) - sqrt(d1);
      float id = hash12(best);
      float px = length(fwidth(p));
      float jw = 0.055 + px * 0.6;
      float joint = 1.0 - smoothstep(jw, jw + 0.05 + px, edge);
      vec3 stone = mix(vec3(0.36, 0.34, 0.31), vec3(0.48, 0.45, 0.4), id) * (0.82 + 0.3 * vnoise(vW.xz * 3.1 + id * 7.0)) * (0.9 + 0.1 * vnoise(vW.xz * 17.0));
      // worn hollows in the middle of the flags, cracks across a few of them
      stone *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.35, d1)) * step(0.6, fract(id * 9.1));
      float crack = step(0.82, fract(id * 23.7)) * (1.0 - smoothstep(0.0, 0.025 + px, abs(dot(f - 0.5, normalize(vec2(fract(id * 3.3) - 0.5, 0.4))) )));
      vec3 dirt = vec3(0.15, 0.12, 0.1) * (0.8 + 0.4 * vnoise(vW.xz * 9.0));
      vec3 alb = mix(stone, dirt, max(joint, crack * 0.7));
      // damp: darker patches that catch the light
      float damp = smoothstep(0.55, 0.75, fbm3(vW.xz * 0.18 + 3.0));
      alb *= 1.0 - 0.38 * damp;
      gSh = 1.0;
      gPL = pointLights(vW + vec3(0.0, 0.02, 0.0), n);
      vec3 col = lightSurface(alb, n, mix(1.0, 0.55, joint));
      vec3 V = safeNormalize(cameraPosition - vW);
      float fres = 0.04 + 0.96 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      col += gPL * damp * fres * 0.6 * (1.0 - joint);
      col = applyDecal(col, sampleDecal(vW.xz));
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});

/* ------------------------------------------------------------------ */
/* building the halls                                                  */
/* ------------------------------------------------------------------ */
const DSTONE = [0.44, 0.42, 0.38], DSTONE2 = [0.36, 0.35, 0.33], BONE = [0.82, 0.78, 0.66], IRON = [0.2, 0.19, 0.2];
function dunM(u, y, v, yaw = 0) { return new THREE.Matrix4().compose(new THREE.Vector3(dunWX(u), y, dunWZ(v)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)); }
const DM0 = new THREE.Matrix4();
const dunLift = (y) => new THREE.Matrix4().makeTranslation(0, y, 0);
function dunTorch(b, u, v, face) {
  // face: the direction the wall faces (into the room) as [du, dv]
  const fy = dunFloorAt(dunWX(u), dunWZ(v));
  const yaw = Math.atan2(face[0], face[1]);
  const M = dunM(u, fy, v, yaw);
  b.add(G.box, lm(M, 0, 2.05, 0.06, 0, 0.22, 0.36, 0.06), MAT.metal, IRON);
  beam(b, M, [0, 2.0, 0.06], [0, 2.3, 0.34], 0.04, MAT.metal, IRON);
  beam(b, M, [0, 2.22, 0.3], [0, 2.62, 0.42], 0.06, MAT.wood, [0.3, 0.2, 0.12]);
  b.add(G.cyl8, lm(M, 0, 2.6, 0.415, 0, 0.055, 0.1, 0.055), MAT.cloth, [0.2, 0.14, 0.1]);
  const p = worldOf(M, 0, 2.62, 0.42);
  addFire(p.x, p.y, p.z, 0.42, false, Infinity, { r: 10, k: 1.25 });
  DUN.torches.push(p);
}
function skull(b, M, x, y, z, yaw = 0, s = 1) {
  b.add(G.ico, lm(M, x, y + 0.09 * s, z, yaw, 0.095 * s, 0.1 * s, 0.11 * s), MAT.cloth, BONE);
  b.add(G.box, lm(M, x, y + 0.03 * s, z + 0.05 * s, yaw, 0.1 * s, 0.05 * s, 0.07 * s), MAT.cloth, darker(BONE, 0.9));
  for (const sx of [-1, 1]) b.add(G.ico, lm(M, x + Math.cos(yaw) * sx * 0.035 * s + Math.sin(yaw) * 0.085 * s, y + 0.1 * s, z - Math.sin(yaw) * sx * 0.035 * s + Math.cos(yaw) * 0.085 * s, 0, 0.025 * s, 0.028 * s, 0.02 * s), MAT.darkstone, [0.05, 0.04, 0.04]);
}
function bonePile(b, M, x, z, r, n, rnd) {
  for (let k = 0; k < n; k++) {
    const a = rnd() * TAU, d = rnd() * r;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, len = 0.25 + rnd() * 0.25;
    beam(b, M, [px, 0.04, pz], [px + Math.cos(a + 1.3) * len, 0.04 + rnd() * 0.06, pz + Math.sin(a + 1.3) * len], 0.035, MAT.cloth, darker(BONE, 0.8 + rnd() * 0.25));
  }
  for (let k = 0; k < Math.max(1, n / 5); k++) skull(b, M, x + (rnd() - 0.5) * r, 0.0, z + (rnd() - 0.5) * r, rnd() * TAU, 1);
}
function sarcophagus(b, u, v, yaw, rnd, open = false, dyn = false) {
  const fy = dunFloorAt(dunWX(u), dunWZ(v));
  const M = dunM(u, fy, v, yaw);
  b.add(G.box, lm(M, 0, 0.12, 0, 0, 1.25, 0.24, 2.5), MAT.rock, DSTONE2, fy, 1);
  b.add(G.box, lm(M, 0, 0.55, 0, 0, 1.05, 0.7, 2.25), MAT.rock, darker(DSTONE, 0.95), fy, 1.2);
  // inside: dark, and whatever was laid there
  b.add(G.box, lm(M, 0, 0.88, 0, 0, 0.85, 0.02, 2.0), MAT.darkstone, [0.06, 0.05, 0.05]);
  // the lid, a carved figure lying on it; a lid that can move is its own mesh
  const lb = dyn ? new Batch() : b, LM = dyn ? new THREE.Matrix4() : M;
  const lidX = open ? 0.35 : 0, lidYaw = open ? 0.25 : 0;
  lb.add(G.box, lm(LM, lidX, 0.98, 0, lidYaw, 1.2, 0.16, 2.42), MAT.rock, darker(DSTONE, 1.05));
  if (!open) {
    lb.add(G.box, lm(LM, 0, 1.13, -0.15, 0, 0.42, 0.14, 1.5), MAT.rock, darker(DSTONE, 1.12));
    lb.add(G.ico, lm(LM, 0, 1.18, 0.78, 0, 0.17, 0.12, 0.17), MAT.rock, darker(DSTONE, 1.12));
    beam(lb, LM, [0, 1.24, -0.6], [0, 1.24, 0.55], 0.05, MAT.metal, [0.3, 0.29, 0.28]);
  }
  for (const s of [-1, 1]) b.add(G.box, lm(M, s * 0.53, 0.6, 0, 0, 0.02, 0.06, 1.7), MAT.rune, [0.2, 0.45, 0.42]);
  const p = worldOf(M, 0, 0, 0);
  addBox(p.x, p.z, 0.68, 1.3, yaw, 'prop', 1.3);
  if (open) skull(b, M, 0.1, 0.9, 0.5, rnd() * TAU, 1);
  if (!dyn) return null;
  const lid = new THREE.Mesh(lb.build(), buildingMat);
  lid.position.set(p.x, fy, p.z);
  lid.rotation.y = yaw;
  const tomb = { x: p.x, z: p.z, y: fy, yaw, lid, open: 0, target: 0 };
  DUN.tombs.push(tomb);
  return tomb;
}
function stonePillar(b, u, v, y0, y1, w, rnd) {
  const M = dunM(u, y0, v, (rnd() - 0.5) * 0.2);
  const H = y1 - y0;
  b.add(G.box, lm(M, 0, 0.35, 0, 0, w + 0.5, 0.7, w + 0.5), MAT.rock, DSTONE2, y0, 1);
  // stacked drums of rough stone, each a little off true
  const n = Math.max(2, Math.round(H / 1.6));
  for (let k = 0; k < n; k++) {
    const h = (H - 1.2) / n;
    b.add(G.box, lm(M, (rnd() - 0.5) * 0.06, 0.7 + h * (k + 0.5), (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.12, w + (rnd() - 0.5) * 0.08, h - 0.04, w + (rnd() - 0.5) * 0.08), MAT.rock, darker(DSTONE, 0.88 + rnd() * 0.2), y0, 4);
  }
  b.add(G.box, lm(M, 0, H - 0.25, 0, 0, w + 0.7, 0.5, w + 0.7), MAT.rock, DSTONE2);
  const p = worldOf(M, 0, 0, 0);
  addCircle(p.x, p.z, w * 0.72 + 0.15, 'pillar', H);
}
function buildDungeon() {
  buildDungeonGrid();
  const rnd = mulberry(9133);
  const b = new Batch();
  const GW = DUN.GW, GH = DUN.GH, C = DUN.cell, F = DUN.fy, CY = DUN.cy, RM = DUN.room;
  const at = (i, j) => { const k = dunIdx(i, j); return k < 0 ? 0 : C[k]; };
  const isRound = (k) => k >= 0 && RM[k] >= 0 && DUN_ROOMS[RM[k]].round;
  // ---- walls: every boundary between open cells and rock, merged into runs ----
  const segs = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    if (!C[k] || isRound(k)) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (at(i + di, j + dj)) continue;
      segs.push({ i, j, di, dj });
    }
  }
  const runs = new Map();
  for (const s of segs) {
    // walls facing ±u run along v, walls facing ±v run along u
    const key = s.di ? `u${s.di}:${s.i}` : `v${s.dj}:${s.j}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(s.di ? s.j : s.i);
  }
  const WALLS = [];
  for (const [key, list] of runs) {
    list.sort((a, b2) => a - b2);
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
    // grid index -> local coordinates of the face
    const len = W.z - W.a + 1;
    const T = 1.4, y0 = W.lo - 0.8, y1 = W.hi + 0.8, H = y1 - y0;
    let cu, cv, hx, hz;
    if (W.axisU) {
      const face = W.fixed + DUN.u0 + (W.dir > 0 ? 1 : 0);
      cu = face + W.dir * T / 2; cv = DUN.v0 + W.a + len / 2; hx = T / 2; hz = len / 2 + 0.06;
    } else {
      const face = W.fixed + DUN.v0 + (W.dir > 0 ? 1 : 0);
      cv = face + W.dir * T / 2; cu = DUN.u0 + W.a + len / 2; hx = len / 2 + 0.06; hz = T / 2;
    }
    const col = darker(DSTONE, 0.86 + rnd() * 0.16);
    b.add(G.box, lm(DM0, dunWX(cu), y0 + H / 2, dunWZ(cv), 0, hx * 2, H, hz * 2), MAT.drystone, col, W.lo, 3.5);
    addBox(dunWX(cu), dunWZ(cv), hx, hz, 0, 'wall', H).baseY = y0;
    // upright slabs set against the face, a ledge of corbels near the roof
    const along = len, nIn = W.axisU ? [-W.dir, 0] : [0, -W.dir];
    for (let s = 0.9 + rnd() * 1.2; s < along - 0.8; s += 2.2 + rnd() * 1.8) {
      const t = (W.axisU ? DUN.v0 : DUN.u0) + W.a + s;
      const pu = W.axisU ? (cu - W.dir * T / 2) + nIn[0] * 0.1 : t, pv = W.axisU ? t : (cv - W.dir * T / 2) + nIn[1] * 0.1;
      const k = dunCellAt(dunWX(pu + nIn[0] * 0.6), dunWZ(pv + nIn[1] * 0.6));
      if (k < 0 || C[k] !== 1 || RM[k] === DUN_ROOM.bones.idx) continue;
      const fy = F[k], h = (CY[k] - fy) * (0.62 + rnd() * 0.3), w = 0.9 + rnd() * 0.8;
      const yaw = W.axisU ? Math.PI / 2 : 0;
      b.add(G.box, lm(DM0, dunWX(pu), fy + h / 2 - 0.2, dunWZ(pv), yaw + (rnd() - 0.5) * 0.08, w, h + 0.4, 0.34, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.04), MAT.rock, darker(DSTONE, 0.95 + rnd() * 0.22), fy, 3);
    }
    if (W.flat && W.hi - W.lo > 5.5) {
      const k = W.axisU ? dunIdx(W.fixed, Math.round((W.a + W.z) / 2)) : dunIdx(Math.round((W.a + W.z) / 2), W.fixed);
      const yy = CY[k] - 0.35;
      const pu = W.axisU ? cu - W.dir * (T / 2 + 0.2) : cu, pv = W.axisU ? cv : cv - W.dir * (T / 2 + 0.2);
      b.add(G.box, lm(DM0, dunWX(pu), yy, dunWZ(pv), 0, W.axisU ? 0.4 : len, 0.32, W.axisU ? len : 0.4), MAT.rock, DSTONE2);
    }
    W.cu = cu; W.cv = cv; W.len = len;
  }
  DUN.walls = WALLS;
  // ---- headers: where a low passage opens into a tall room, fill the wall above it ----
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const k = j * GW + i;
    if (!C[k]) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const q = dunIdx(i + di, j + dj);
      if (q < 0 || !C[q]) continue;
      const lo = Math.min(CY[k], CY[q]), hi = Math.max(CY[k], CY[q]);
      if (hi - lo < 0.62 || (isRound(k) && isRound(q))) continue;
      const u = i + DUN.u0 + (di ? 1 : 0.5), v = j + DUN.v0 + (dj ? 1 : 0.5);
      b.add(G.box, lm(DM0, dunWX(u), (lo + hi) / 2 + 0.3, dunWZ(v), 0, di ? 0.9 : 1.04, hi - lo + 0.6, dj ? 0.9 : 1.04), MAT.drystone, darker(DSTONE, 0.9), lo, 2);
    }
  }
  // lintels over the passages into each room
  for (const [u, v0, v1, y] of [[14, -3, 3, 5.0], [42, -3, 3, 1.5], [62, -3, 3, 1.5], [68, -3, 3, 1.5], [100, -3, 3, 2.0], [166, -3, 3, -1.5], [204, -2, 2, -2.2], [198, -2, 2, -2.2]]) {
    b.add(G.box, lm(DM0, dunWX(u), y + 0.35, dunWZ((v0 + v1) / 2), 0, 1.3, 0.75, v1 - v0 + 1.6), MAT.rock, darker(DSTONE, 1.05));
  }
  for (const [v, u0, u1, y] of [[10, 49, 55, 1.1], [15, 49, 55, 1.1]]) {
    b.add(G.box, lm(DM0, dunWX((u0 + u1) / 2), y + 0.35, dunWZ(v), 0, u1 - u0 + 1.6, 0.75, 1.3), MAT.rock, darker(DSTONE, 1.05));
  }
  // ---- roofs: great capstones across each room, stepped down the ramps ----
  for (const R of DUN_ROOMS) {
    if (R.round) continue;
    const du = R.u[1] - R.u[0], dv = R.v[1] - R.v[0];
    const acrossV = du >= dv; // slabs span the narrow way
    const spanLen = acrossV ? dv : du, runLen = acrossV ? du : dv;
    let s = 0;
    while (s < runLen - 0.01) {
      const w = Math.min(runLen - s, 1.8 + rnd() * 1.6);
      const mid = s + w / 2;
      const u = acrossV ? R.u[0] + mid : (R.u[0] + R.u[1]) / 2, v = acrossV ? (R.v[0] + R.v[1]) / 2 : R.v[0] + mid;
      const fy = roomFloor(R, u);
      const pieces = Math.max(1, Math.round(spanLen / 6));
      for (let q = 0; q < pieces; q++) {
        const L = (spanLen + 0.9) / pieces, off = -(spanLen + 0.9) / 2 + L * (q + 0.5);
        const pu = acrossV ? u : u + off, pv = acrossV ? v + off : v;
        const y = fy + R.h + 0.35 + (rnd() - 0.5) * 0.14;
        b.add(G.box, lm(DM0, dunWX(pu), y, dunWZ(pv), 0, acrossV ? w - 0.05 : L - 0.04, 0.7, acrossV ? L - 0.04 : w - 0.05, (rnd() - 0.5) * 0.012, (rnd() - 0.5) * 0.012), MAT.rock, darker(DSTONE, 0.95 + rnd() * 0.25));
      }
      s += w;
    }
    // tall rooms get stone beams under the slabs
    if (R.h >= 7) {
      for (let t = 3.5; t < runLen - 2; t += 5.5) {
        const u = acrossV ? R.u[0] + t : (R.u[0] + R.u[1]) / 2, v = acrossV ? (R.v[0] + R.v[1]) / 2 : R.v[0] + t;
        const y = roomFloor(R, u) + R.h - 0.35;
        b.add(G.box, lm(DM0, dunWX(u), y, dunWZ(v), 0, acrossV ? 0.75 : spanLen + 0.4, 0.7, acrossV ? spanLen + 0.4 : 0.75), MAT.rock, darker(DSTONE, 0.92));
      }
    }
  }
  // ---- the Well of Souls: a round chamber under a corbelled dome ----
  {
    const R = DUN_ROOM.well, cu = R.cu, cv = R.cv, fy = R.fy, n = 40;
    for (let s = 0; s < n; s++) {
      const a = ((s + 0.5) / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const wu = cu + ca * (R.r + 0.7), wv = cv + sa * (R.r + 0.7);
      if (Math.abs(sa * R.r) < 3.3 && Math.abs(ca) > 0.85) continue; // the two passages
      const len = TAU * (R.r + 0.7) / n + 0.25, yaw = Math.atan2(ca, sa) + Math.PI / 2;
      b.add(G.box, lm(DM0, dunWX(wu), fy + R.h / 2 - 0.4, dunWZ(wv), yaw, len, R.h + 1.6, 1.4), MAT.drystone, darker(DSTONE, 0.85 + rnd() * 0.18), fy, 3.5);
      addBox(dunWX(wu), dunWZ(wv), len / 2, 0.7, yaw, 'wall', R.h + 2).baseY = fy - 1;
      if (s % 3 === 0) b.add(G.box, lm(DM0, dunWX(cu + ca * (R.r - 0.05)), fy + R.h * 0.42, dunWZ(cv + sa * (R.r - 0.05)), yaw, 1.2, R.h * 0.84, 0.32), MAT.rock, darker(DSTONE, 1.0 + rnd() * 0.15), fy, 3);
    }
    // corbelled courses closing in toward a single capstone
    for (let c = 0; c < 7; c++) {
      const rr = R.r + 0.6 - c * 1.45, y = fy + R.h + c * 0.95 + 0.45, m = Math.max(10, Math.round(TAU * rr / 1.7));
      for (let s = 0; s < m; s++) {
        const a = ((s + 0.5 + c * 0.5) / m) * TAU;
        const len = TAU * rr / m + 0.2, yaw = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2;
        b.add(G.box, lm(DM0, dunWX(cu + Math.cos(a) * rr), y, dunWZ(cv + Math.sin(a) * rr), yaw, len, 0.95, 1.8), MAT.rock, darker(DSTONE, 0.9 + rnd() * 0.2));
      }
    }
    b.add(G.cyl12, lm(DM0, dunWX(cu), fy + R.h + 6 * 0.95 + 0.9, dunWZ(cv), 0, 3.6, 0.9, 3.6), MAT.rock, DSTONE);
    // the well itself: a ring of dressed stone round a cold blue light
    const M = dunM(cu, fy, cv);
    b.add(G.cyl16, lm(M, 0, 0.45, 0, 0, 3.3, 0.9, 3.3), MAT.stone, darker(DSTONE, 1.05), fy, 1);
    b.add(G.cyl16, lm(M, 0, 0.93, 0, 0, 3.45, 0.12, 3.45), MAT.darkstone, DSTONE2);
    b.add(G.cyl16, lm(M, 0, 0.89, 0, 0, 2.8, 0.06, 2.8), MAT.rune, [0.25, 0.6, 0.65]);
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * TAU;
      b.add(G.box, lm(M, Math.cos(a) * 7.6, 1.4, Math.sin(a) * 7.6, -a, 0.55, 2.8, 0.85, 0, 0.05 * Math.sin(s * 3)), MAT.rock, darker(DSTONE, 1.0), fy, 2.5);
      b.add(G.box, lm(M, Math.cos(a) * 7.32, 1.6, Math.sin(a) * 7.32, -a, 0.06, 1.6, 0.12), MAT.rune, [0.2, 0.5, 0.55]);
      const p = worldOf(M, Math.cos(a) * 7.6, 0, Math.sin(a) * 7.6);
      addCircle(p.x, p.z, 0.55, 'stone', 3);
    }
    addCircle(dunWX(cu), dunWZ(cv), 3.4, 'well', 1.2);
    DUN.lights.push({ x: dunWX(cu), y: fy + 2.2, z: dunWZ(cv), r: 16, c: [0.45, 1.25, 1.35], pulse: 1 });
    DUN.spots.well = { x: dunWX(cu), y: fy + 0.9, z: dunWZ(cv) };
  }
  // ---- the stair up into the daylight ----
  {
    for (let s = 0; s < 8; s++) {
      const u = -0.5 - s, y = (s + 1) * 0.56;
      b.add(G.box, lm(DM0, dunWX(u), y / 2 - 0.3, dunWZ(0), 0, 1.02, y + 0.6, 4.2), MAT.rock, darker(DSTONE, 0.95 + (s % 2) * 0.08), 0, 2);
    }
    for (let s = 0; s < 8; s++) b.add(G.box, lm(DM0, dunWX(-0.5 - s), (s + 1) * 0.56 + 4.2 + 0.35, dunWZ(0), 0, 1.04, 0.7, 5.2), MAT.rock, darker(DSTONE, 1.0));
    DUN.lights.push({ x: dunWX(-3.5), y: 4.5, z: dunWZ(0), r: 13, c: [0.75, 0.88, 1.05], pulse: 0 });
    DUN.spots.exit = dunPoint(1.6, 0);
    DUN.spots.arrive = dunPoint(2.2, 0);
    DUN.spots.daylight = { x: dunWX(-8.2), y: 4.6, z: dunWZ(0) };
  }
  // ---- rooms: furniture of the dead ----
  {
    const ossM = dunM(0, 0, 0);
    // the passage of bones: niches of skulls along both walls
    for (let u = 16; u < 41; u += 2.4) {
      for (const s of [-1, 1]) {
        const v = s * 2.75, fy = roomFloor(DUN_ROOM.bones, u);
        const M = dunM(u, fy, v, s > 0 ? Math.PI : 0);
        b.add(G.box, lm(M, 0, 1.15, 0.0, 0, 1.6, 0.12, 0.42), MAT.darkstone, DSTONE2);
        b.add(G.box, lm(M, 0, 1.95, 0.0, 0, 1.6, 0.12, 0.42), MAT.darkstone, DSTONE2);
        for (let q = 0; q < 3; q++) if (rnd() < 0.8) skull(b, M, -0.5 + q * 0.5, 1.21, 0.0, (rnd() - 0.5) * 0.6 + Math.PI, 0.95);
        for (let q = 0; q < 2; q++) if (rnd() < 0.6) skull(b, M, -0.3 + q * 0.6, 2.01, 0.0, (rnd() - 0.5) * 0.6 + Math.PI, 0.9);
      }
      if (rnd() < 0.5) bonePile(b, ossM, dunWX(u + 1), dunWZ((rnd() - 0.5) * 3), 0.6, 5, rnd);
    }
    for (const [u, s] of [[19.6, -1], [26.8, 1], [34.0, -1], [38.8, 1]]) dunTorch(b, u, s * 2.82, [0, -s]);
    // the mouth: torches and a pair of guardian stones
    for (const [u, v] of [[6, -4.8], [6, 4.8], [12, -4.8], [12, 4.8]]) dunTorch(b, u, v, [0, v > 0 ? -1 : 1]);
    for (const s of [-1, 1]) {
      const M = dunM(10, 0, s * 3.4, 0);
      b.add(G.box, lm(M, 0, 1.3, 0, 0, 0.8, 2.6, 0.55, 0.03 * s, 0.04), MAT.rock, darker(DSTONE, 1.08), 0, 2.5);
      b.add(G.box, lm(M, 0, 1.45, s * -0.285, 0, 0.07, 1.2, 0.02), MAT.rune, [0.2, 0.5, 0.45]);
      const p = worldOf(M, 0, 0, 0);
      addCircle(p.x, p.z, 0.5, 'stone', 2.6);
    }
    // the ossuary: sarcophagi in rows, bones heaped in the corners
    for (const [u, v, yaw, open] of [[47, -5, 0, false], [47, 5, 0, true], [57, -5, 0, false], [57, 5, 0, false]]) sarcophagus(b, u, v, yaw, rnd, open);
    for (const [u, v] of [[43.5, -8.5], [60.5, 8.5], [60.5, -8.5], [43.5, 8.5]]) bonePile(b, ossM, dunWX(u), dunWZ(v), 0.9, 12, rnd);
    for (const [u, v, fu, fv] of [[45, -9.8, 0, 1], [59, -9.8, 0, 1], [45, 9.8, 0, -1], [59, 9.8, 0, -1], [61.8, -6, -1, 0], [61.8, 6, -1, 0]]) dunTorch(b, u, v, [fu, fv]);
    // the side crypt: a long tomb and the chest of whoever was laid in it
    sarcophagus(b, 52, 23.5, Math.PI / 2, rnd, false);
    for (const [u, v] of [[45.5, 16.5], [58.5, 16.5], [45.5, 25.5], [58.5, 25.5]]) bonePile(b, ossM, dunWX(u), dunWZ(v), 0.8, 8, rnd);
    for (const [u, v, fu, fv] of [[44.2, 20, 1, 0], [59.8, 20, -1, 0], [48, 26.8, 0, -1], [56, 26.8, 0, -1]]) dunTorch(b, u, v, [fu, fv]);
    DUN.spots.cryptChest = dunPoint(52, 19.3);
    // the hall of pillars
    for (const u of [74, 81, 88, 95]) for (const v of [-6.5, 6.5]) stonePillar(b, u, v, -3.5, -3.5 + 9, 1.5, rnd);
    for (const [u, v] of [[71, -10], [71, 10], [97, -10], [97, 10]]) { const p = dunPoint(u, v); brazierAt(b, dunLift(p.y), p.x, p.z, null, true, { r: 13, k: 1.15 }); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
    for (const [u, v, fu, fv] of [[78, -12.8, 0, 1], [90, -12.8, 0, 1], [78, 12.8, 0, -1], [90, 12.8, 0, -1], [84, -12.8, 0, 1], [84, 12.8, 0, -1], [68.2, -8, 1, 0], [68.2, 8, 1, 0], [99.8, -8, -1, 0], [99.8, 8, -1, 0]]) dunTorch(b, u, v, [fu, fv]);
    for (let k = 0; k < 6; k++) bonePile(b, ossM, dunWX(70 + rnd() * 28), dunWZ((rnd() - 0.5) * 22), 0.6, 6, rnd);
    // chains hanging from the beams
    for (const u of [77.5, 84.5, 91.5]) for (const v of [-3, 3]) {
      const fy = -3.5, top = fy + 9 - 0.7, len = 2 + rnd() * 2.5;
      for (let q = 0; q < len / 0.16; q++) b.add(G.box, lm(DM0, dunWX(u), top - q * 0.16, dunWZ(v), q * 1.5708, 0.05, 0.14, 0.02), MAT.metal, IRON);
    }
    // the burning gallery: iron grates over the vents, scorched walls
    for (const u of [105, 111, 117, 123, 129]) {
      const fy = roomFloor(DUN_ROOM.vents, u);
      const M = dunM(u, fy, 0);
      b.add(G.box, lm(M, 0, 0.03, 0, 0, 1.8, 0.06, 1.8), MAT.darkstone, [0.1, 0.09, 0.08]);
      for (let q = -3; q <= 3; q++) b.add(G.box, lm(M, q * 0.24, 0.07, 0, 0, 0.06, 0.06, 1.7), MAT.metal, [0.16, 0.12, 0.1]);
      DUN.vents.push({ u, x: dunWX(u), z: dunWZ(0), y: fy, phase: (u - 105) / 6 * 0.55 });
    }
    for (const [u, s] of [[103, -1], [114, 1], [120, -1], [131, 1]]) dunTorch(b, u, s * 2.82, [0, -s]);
    // the well of souls: braziers of cold fire between the standing stones
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * TAU + TAU / 8, p = dunPoint(144 + Math.cos(a) * 9.6, Math.sin(a) * 9.6);
      brazierAt(b, dunLift(p.y), p.x, p.z, null, true, { r: 13, k: 1.15 });
      addCircle(p.x, p.z, 0.45, 'brazier', 1.4);
    }
    // the gate: a portcullis, raised when the warden of the well falls
    DUN.gates.well = buildGate(156 + 4.5, 0, 6.2, 5.6, -7, 'bars');
    for (const [u, s] of [[158, -1], [164, 1]]) dunTorch(b, u, s * 2.82, [0, -s]);
    // the hall of the Hollow King
    const TR = DUN_ROOM.throne;
    for (const u of [172, 179, 186]) for (const v of [-9.5, 9.5]) stonePillar(b, u, v, -7, -7 + 12, 1.7, rnd);
    for (const u of [172, 180, 188]) for (const v of [-13.2, 13.2]) sarcophagus(b, u, v, Math.PI / 2, rnd, false, true);
    // the dais and the throne
    {
      const M = dunM(194, -7, 0);
      b.add(G.box, lm(M, 0, 0.4, 0, 0, 8.2, 0.8, 12), MAT.stone, darker(DSTONE, 1.05), -7, 1);
      b.add(G.box, lm(M, -4.55, 0.2, 0, 0, 1.0, 0.4, 10), MAT.stone, darker(DSTONE, 1.0), -7, 1);
      // a throne cut for something taller than a man: the seat sits at the king's knee
      const T2 = dunM(196.5, -6.2, 0, -Math.PI / 2);
      b.add(G.box, lm(T2, 0, 0.22, -0.2, 0, 2.5, 0.44, 1.75), MAT.rock, DSTONE2, -6.2, 0.5);
      b.add(G.box, lm(T2, 0, 0.6, -0.25, 0, 1.75, 0.34, 1.15), MAT.rock, darker(DSTONE, 1.1));
      b.add(G.box, lm(T2, 0, 2.45, -0.97, 0, 2.2, 4.1, 0.42), MAT.rock, darker(DSTONE, 1.1), -6.2, 4);
      b.add(G.box, lm(T2, 0, 4.78, -0.97, 0, 1.1, 0.7, 0.42), MAT.rock, darker(DSTONE, 1.1));
      for (const s of [-1, 1]) {
        b.add(G.box, lm(T2, s * 1.0, 1.0, -0.22, 0, 0.26, 0.5, 1.32), MAT.rock, darker(DSTONE, 1.1));
        b.add(G.ico, lm(T2, s * 1.0, 1.28, 0.42, 0, 0.16, 0.13, 0.16), MAT.rock, darker(DSTONE, 1.15));
        b.add(G.box, lm(T2, s * 0.75, 4.4, -0.95, 0, 0.5, 1.2, 0.46), MAT.rock, darker(DSTONE, 1.0));
      }
      for (let q = 0; q < 10; q++) { const a = (q / 10) * TAU; b.add(G.box, lm(T2, Math.cos(a) * 0.55, 3.3 + Math.sin(a) * 0.55, -0.74, 0, 0.18, 0.05, 0.03, 0, a + Math.PI / 2), MAT.rune, [0.25, 0.55, 0.6]); }
      addBox(dunWX(196.75), dunWZ(0), 0.95, 1.25, 0, 'prop', 4);
      const seat = worldOf(T2, 0, 0.77, -0.32);
      DUN.spots.seat = { x: seat.x, y: seat.y, z: seat.z };
      for (const v of [-3.3, 3.3]) { const p = dunPoint(193.6, v); brazierAt(b, dunLift(p.y), p.x, p.z, null, true, { r: 11, k: 1.35 }); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
      DUN.lights.push({ x: dunWX(194.5), y: -2.0, z: dunWZ(0), r: 12, c: [0.3, 0.7, 0.85], pulse: 1 });
    }
    for (const [u, v] of [[183, -5.5], [183, 5.5], [170, -5.5], [170, 5.5]]) { const p = dunPoint(u, v); brazierAt(b, dunLift(p.y), p.x, p.z, null, true, { r: 13, k: 1.15 }); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
    for (const [u, v, fu, fv] of [[175, -14.8, 0, 1], [184, -14.8, 0, 1], [175, 14.8, 0, -1], [184, 14.8, 0, -1], [166.2, -9, 1, 0], [166.2, 9, 1, 0], [197.8, -11, -1, 0], [197.8, 11, -1, 0]]) dunTorch(b, u, v, [fu, fv]);
    // tattered banners on the walls behind the throne
    for (const v of [-8.5, 8.5]) {
      const M = dunM(197.6, -7, v, -Math.PI / 2);
      beam(b, M, [-1.0, 9.6, 0.1], [1.0, 9.6, 0.1], 0.08, MAT.wood, [0.25, 0.17, 0.1]);
      for (let q = 0; q < 6; q++) b.add(G.box, lm(M, -0.85 + q * 0.34, 7.0 - (q % 2) * 0.3, 0.14, 0, 0.32, 5.0 - (q % 3) * 0.5, 0.02), MAT.cloth, [0.26, 0.08, 0.08]);
    }
    DUN.spots.throne = dunPoint(193, 0);
    DUN.spots.hall = dunPoint(180, 0);
    // the vault: a stone door that grinds open once the king is dead, and his hoard
    DUN.gates.vault = buildGate(199.5, 0, 4.6, 4.2, -6.2, 'slab');
    for (const [u, v, fu, fv] of [[206, -4.8, 0, 1], [212, 4.8, 0, -1], [213.8, 0, -1, 0]]) dunTorch(b, u, v, [fu, fv]);
    {
      const M = dunM(209, -6.2, 0);
      for (let k = 0; k < 28; k++) {
        const a = rnd() * TAU, d = 0.8 + rnd() * 2.6;
        b.add(G.cyl8, lm(M, Math.cos(a) * d, 0.02 + rnd() * 0.04, Math.sin(a) * d, rnd() * 3, 0.06, 0.012, 0.06, rnd() * 0.3), MAT.gold, [0.95, 0.72, 0.3]);
      }
      for (const [x, z] of [[-1.6, -2.2], [1.8, 2.4], [2.6, -1.8]]) { b.add(G.box, lm(M, x, 0.35, z, rnd(), 0.7, 0.7, 0.7), MAT.wood, [0.32, 0.22, 0.13]); b.add(G.box, lm(M, x, 0.72, z, rnd(), 0.55, 0.05, 0.55), MAT.metal, IRON); }
    }
    DUN.spots.vaultChest = dunPoint(210.5, 0);
  }
  // ---- meshes ----
  DUN.root = new THREE.Group();
  DUN.root.userData.keep = true;
  DUN.root.visible = false;
  const m = new THREE.Mesh(b.build(), buildingMat);
  DUN.root.add(m);
  DUN.root.add(buildDungeonFloor());
  // the way out: daylight at the head of the stair, and a shaft of it falling down the steps
  const day = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.3), new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){
        vec2 q = vUv - 0.5;
        float edge = smoothstep(0.5, 0.3, abs(q.x)) * smoothstep(0.5, 0.25, abs(q.y));
        vec3 c = mix(vec3(1.05, 1.15, 1.25), vec3(1.8, 1.95, 2.15), vUv.y) * (0.45 + 0.55 * edge);
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  day.position.set(dunWX(-7.96), 4.48 + 2.15, dunWZ(0));
  day.rotation.y = Math.PI / 2;
  DUN.root.add(day);
  DUN.root.add(buildLightShaft(new THREE.Vector3(dunWX(-7.6), 6.7, dunWZ(0)), new THREE.Vector3(dunWX(4.2), 0.05, dunWZ(0)), 3.4, 5.2, [0.085, 0.095, 0.11]));
  for (const k in DUN.gates) DUN.root.add(DUN.gates[k].mesh);
  for (const t of DUN.tombs) DUN.root.add(t.lid);
  scene.add(DUN.root);
  DUN.built = true;
}
function buildDungeonFloor() {
  const pos = [], nrm = [], idx = [];
  const C = DUN.cell, GW = DUN.GW;
  const vmap = new Map();
  const vert = (i, j) => {
    const key = j * (GW + 1) + i;
    let id = vmap.get(key);
    if (id !== undefined) return id;
    const x = dunWX(i + DUN.u0), z = dunWZ(j + DUN.v0), y = dunFloorAt(x, z);
    id = pos.length / 3;
    pos.push(x, y, z);
    const e = 0.5, hx = dunFloorAt(x + e, z) - dunFloorAt(x - e, z), hz = dunFloorAt(x, z + e) - dunFloorAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    nrm.push(-hx / l, (2 * e) / l, -hz / l);
    vmap.set(key, id);
    return id;
  };
  for (let j = 0; j < DUN.GH; j++) for (let i = 0; i < GW; i++) {
    if (C[j * GW + i] !== 1) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
    idx.push(a, d, c, a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, dunFloorMat);
  m.renderOrder = 0;
  return m;
}
/* a shaft of light: three soft planes crossing on the beam's axis, fading where seen edge-on */
function buildLightShaft(A, B, w0, w1, col) {
  const ax = B.clone().sub(A).normalize();
  const perp = new THREE.Vector3(0, 1, 0).cross(ax).normalize();
  const pos = [], uv = [], nrm = [], idx = [];
  for (let k = 0; k < 3; k++) {
    const side = perp.clone().applyAxisAngle(ax, (k / 3) * Math.PI);
    const n = side.clone().cross(ax).normalize();
    const base = pos.length / 3;
    for (const [t, s] of [[0, -1], [0, 1], [1, 1], [1, -1]]) {
      const p = A.clone().lerp(B, t).addScaledVector(side, s * (t ? w1 : w0) / 2);
      pos.push(p.x, p.y, p.z); uv.push((s + 1) / 2, t); nrm.push(n.x, n.y, n.z);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uCol: { value: new THREE.Vector3(...col) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying float vFace;
      void main(){ vUv = uv; vec3 V = normalize(cameraPosition - position); vFace = abs(dot(normal, V)); gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uCol; uniform float uTime; varying vec2 vUv; varying float vFace;
      void main(){
        float x = abs(vUv.x - 0.5) * 2.0;
        float k = (1.0 - x * x) * (1.0 - x * x) * smoothstep(0.0, 0.1, vUv.y) * pow(1.0 - vUv.y, 0.8) * smoothstep(0.05, 0.5, vFace);
        float motes = 0.8 + 0.2 * sin(vUv.y * 37.0 - uTime * 0.6 + vUv.x * 11.0) * sin(vUv.y * 13.0 + uTime * 0.4);
        gl_FragColor = vec4(uCol * k * motes, 1.0);
      }`,
  }));
  m.frustumCulled = false;
  m.renderOrder = 9;
  return m;
}
/* gates: an iron portcullis or a stone slab that rises out of the way */
function buildGate(u, v, w, h, fy, kind) {
  const b = new Batch();
  const M0 = new THREE.Matrix4();
  if (kind === 'bars') {
    for (let x = -w / 2 + 0.15; x <= w / 2 - 0.1; x += 0.32) b.add(G.box, lm(M0, 0, h / 2, x, 0, 0.09, h, 0.09), MAT.metal, [0.17, 0.16, 0.16]);
    for (let y = 0.5; y < h; y += 0.65) b.add(G.box, lm(M0, 0, y, 0, 0, 0.1, 0.08, w), MAT.metal, [0.15, 0.14, 0.14]);
    for (let x = -w / 2 + 0.15; x <= w / 2 - 0.1; x += 0.32) b.add(G.cone8, lm(M0, 0, -0.1, x, 0, 0.07, 0.25, 0.07, Math.PI), MAT.metal, [0.17, 0.16, 0.16]);
  } else {
    b.add(G.box, lm(M0, 0, h / 2, 0, 0, 0.6, h, w), MAT.stone, darker(DSTONE, 1.05), 0, h);
    b.add(G.box, lm(M0, -0.31, h * 0.55, 0, 0, 0.02, h * 0.6, w * 0.5), MAT.rune, [0.25, 0.55, 0.6]);
  }
  const mesh = new THREE.Mesh(b.build(), buildingMat);
  mesh.position.set(dunWX(u), fy, dunWZ(v));
  mesh.matrixAutoUpdate = true;
  const coll = addBox(dunWX(u), dunWZ(v), 0.4, w / 2 + 0.3, 0, 'gate', h + 2);
  coll.baseY = fy;
  return { mesh, coll, fy, h, open: 0, target: 0, kind };
}
function setGate(gate, open) { if (gate) gate.target = open ? 1 : 0; }
function updateGates(dt) {
  for (const k in DUN.gates) {
    const g = DUN.gates[k];
    if (g.open === g.target) continue;
    const was = g.open;
    g.open = clamp(g.open + Math.sign(g.target - g.open) * dt / (g.kind === 'bars' ? 2.6 : 3.4), 0, 1);
    g.mesh.position.y = g.fy + smooth(g.open) * (g.h + 0.2) * (g.kind === 'bars' ? 1 : -1);
    g.coll.active = g.open < 0.55;
    if (INDOOR.on && Math.floor(was * 8) !== Math.floor(g.open * 8)) { sfxAt(g.kind === 'bars' ? 'chain' : 'grind', g.mesh.position.x, g.mesh.position.y + 1.5, g.mesh.position.z); const P = GAME.player; if (P) cameraShake(0.08, g.mesh.position.x, g.mesh.position.z); } // [audio2] the gate grinds where it stands (11c_sound.js)
  }
}

/* ------------------------------------------------------------------ */
/* the mound above: a long barrow with a forecourt of standing stones   */
/* ------------------------------------------------------------------ */
const BARROW = { kind: 'barrow', realm: -1, x: 50, z: 0, r: 13, f: 9, yaw: -Math.PI / 2, name: 'The Hollow Barrow' };
SITES.push(BARROW);
// site frame: +Z looks back to the Lone Tree; the facade stands at z = 8, the mound runs back to z = -16
const BARROW_PW = 1.15; // half the width of the passage into the mound
function barrowMoundH(lx, lz) {
  const t = clamp((-8 - lz) / 9, 0, 1);
  const halfW = 6.4 * lerp(1, 0.55, t);
  const across = 1 - sstep(halfW * 0.3, halfW, Math.abs(lx));
  const along = sstep(-18, -9, lz) * sstep(6.6, 4.4, lz);
  // the passage runs into the mound between stone walls, open to the sky until its roof slabs
  const cut = (1 - sstep(BARROW_PW + 0.4, BARROW_PW + 1.6, Math.abs(lx))) * sstep(-0.8, 1.2, lz);
  return 3.7 * across * along * (1 - cut);
}
// no meadow grows on the passage floor; a worn path leads up to it
function clearBarrowGround(W2, forTexels) {
  const S = BARROW, c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  forTexels(S.x, S.z, 20, (k, x, z) => {
    const dx = x - S.x, dz = z - S.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    const inPassage = (1 - sstep(BARROW_PW + 0.2, BARROW_PW + 1.4, Math.abs(lx))) * sstep(1.0, 2.4, lz) * (1 - sstep(9.0, 10.5, lz));
    const path = (1 - sstep(0.9, 2.4, Math.abs(lx))) * sstep(8.5, 10, lz) * (1 - sstep(15, 19, lz));
    W2.grass[k] *= (1 - inPassage) * (1 - 0.75 * path);
    W2.flower[k] *= (1 - inPassage) * (1 - path);
    W2.road[k] = Math.max(W2.road[k], path * 0.55, inPassage * 0.8);
  });
}
function applyBarrowMound(H, forTexels) {
  const S = BARROW, c = Math.cos(S.yaw), s = Math.sin(S.yaw);
  forTexels(S.x, S.z, 22, (k, x, z) => {
    const dx = x - S.x, dz = z - S.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    H[k] += barrowMoundH(lx, lz);
  });
}
// where a point lies in the barrow's own frame
function barrowLocal(x, z) {
  const S = BARROW, c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = x - S.x, dz = z - S.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
function buildBarrowSurface() {
  const S = BARROW, b = new Batch(), M = siteMatrix(S), st = [0.6, 0.6, 0.56];
  const rnd = mulberry(5150);
  const fz = 8.2, pw = BARROW_PW, back = 2.3;
  // a drystone revetment across the end of the mound hides its slope; the passage opens through it
  for (const s of [-1, 1]) b.add(G.box, lm(M, s * (pw + 2.45), 1.7, fz - 0.6, 0, 4.9, 3.8, 1.2), MAT.drystone, darker(st, 0.82), S.y, 3.5);
  b.add(G.box, lm(M, 0, 3.35, fz - 0.6, 0, 2 * pw + 0.6, 0.9, 1.2), MAT.drystone, darker(st, 0.82));
  // the passage: drystone walls, a floor of flags, great capstones for a roof
  for (const s of [-1, 1]) b.add(G.box, lm(M, s * (pw + 0.35), 1.4, (fz + back) / 2 - 0.3, 0, 0.7, 3.0, fz - back + 0.6), MAT.drystone, darker(st, 0.74), S.y, 3);
  for (let z = fz - 0.2, k = 0; z > back + 0.2; z -= 1.9, k++) b.add(G.box, lm(M, (rnd() - 0.5) * 0.06, 3.02, z - 0.95, (rnd() - 0.5) * 0.04, 2 * pw + 1.5, 0.55, 1.86, 0, (rnd() - 0.5) * 0.03), MAT.rock, darker(st, 0.86 + rnd() * 0.12));
  for (let z = fz + 0.3; z > back; z -= 0.92) b.add(G.box, lm(M, (rnd() - 0.5) * 0.05, 0.02, z - 0.46, (rnd() - 0.5) * 0.05, 2 * pw - 0.05 - rnd() * 0.08, 0.1, 0.88), MAT.rock, darker(st, 0.66 + rnd() * 0.12));
  // at its end, steps go down into a dark that the eye cannot follow
  for (let k = 0; k < 4; k++) b.add(G.box, lm(M, 0, -0.06 - k * 0.2, back + 1.25 - k * 0.32, 0, 2 * pw, 0.2, 0.34), MAT.rock, darker(st, 0.5 - k * 0.09));
  b.add(G.box, lm(M, 0, 1.3, back - 0.05, 0, 2 * pw + 0.2, 2.9, 0.1), MAT.water, [0.006, 0.006, 0.008]);
  b.add(G.box, lm(M, 0, -0.55, back + 0.6, 0, 2 * pw, 0.06, 1.1), MAT.water, [0.006, 0.006, 0.008]);
  // the two tallest stones frame the mouth of the passage, a lintel across them
  b.add(G.box, lm(M, 0, 2.86, fz - 0.05, 0, 2 * pw + 2.0, 0.6, 0.95, 0.02), MAT.rock, darker(st, 1.02), S.y, 3);
  // the forecourt: a crescent of uprights opening toward the tree
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = ((i / (N - 1)) - 0.5) * 2.2;
    if (Math.abs(a) < 0.05) continue;
    const door = Math.abs(a) < 0.3;
    const lx = door ? Math.sign(a) * (pw + 0.55) : Math.sin(a) * 7.2, lz = door ? fz : fz + 0.2 + (1 - Math.cos(a)) * 7.2 * 0.62;
    const tall = door ? 3.4 : lerp(3.0, 1.7, Math.abs(a) / 1.1);
    const wide = door ? 0.95 : 0.85 + rnd() * 0.4;
    b.add(G.box, lm(M, lx, tall / 2 - 0.3, lz, door ? 0 : -a * 0.9, wide, tall + 0.6, 0.6, (rnd() - 0.5) * 0.06, door ? 0 : (rnd() - 0.5) * 0.06), MAT.rock, darker(st, 0.88 + rnd() * 0.22), S.y, 3);
    const p = siteToWorld(S, lx, lz);
    addCircle(p.x, p.z, door ? 0.45 : 0.55, 'stone', tall);
  }
  // a carved kerbstone and two braziers of cold fire before the door
  b.add(G.box, lm(M, 0, 0.3, fz + 2.6, 0, 2.6, 0.6, 0.7), MAT.rock, darker(st, 0.95), S.y, 1);
  b.add(G.box, lm(M, 0, 0.36, fz + 2.96, 0, 2.2, 0.36, 0.02), MAT.rune, [0.2, 0.5, 0.45]);
  for (const s of [-1, 1]) { brazierAt(b, M, s * 2.5, fz + 1.4, st, true); const p = siteToWorld(S, s * 2.5, fz + 1.4); addCircle(p.x, p.z, 0.45, 'brazier', 1.4); }
  const kp = siteToWorld(S, 0, fz + 2.6);
  addBox(kp.x, kp.z, 1.3, 0.35, S.yaw, 'stone', 0.8);
  // colliders: the revetment either side, the passage walls, the dark at its end
  for (const s of [-1, 1]) { const p = siteToWorld(S, s * (pw + 2.45), fz - 0.6); addBox(p.x, p.z, 2.45, 0.6, S.yaw, 'wall', 4); }
  for (const s of [-1, 1]) { const p = siteToWorld(S, s * (pw + 0.35), (fz + back) / 2 - 0.3); addBox(p.x, p.z, 0.35, (fz - back + 0.6) / 2, S.yaw, 'wall', 3.2); }
  { const p = siteToWorld(S, 0, back - 0.3); addBox(p.x, p.z, pw + 0.4, 0.3, S.yaw, 'wall', 3.2); }
  const mesh = new THREE.Mesh(b.build(), buildingMat);
  mesh.renderOrder = 1;
  scene.add(mesh);
  SITE_MESHES.push(mesh);
  shadowCaster(mesh, BUILDING_DEPTH || (BUILDING_DEPTH = depthFrom(buildingMat)));
  BARROW.door = siteWorld(S, 0, 0, fz + 0.6);
  BARROW.out = siteWorld(S, 0, 0, fz + 4.2);
}
// walking into the passage takes you down into the barrow
function checkBarrowDoor() {
  const P = GAME.player;
  if (!P || !P.alive || INDOOR.on || UI.travelling || !BARROW.out) return;
  if (dist2(P.x, P.z, BARROW.x, BARROW.z) > 30 * 30) return;
  const { lx, lz } = barrowLocal(P.x, P.z);
  if (Math.abs(lx) < BARROW_PW && lz < 4.9 && lz > 1.5) enterBarrow();
}

/* ------------------------------------------------------------------ */
/* indoors: the world above is hidden, the sun goes out, torches rule  */
/* ------------------------------------------------------------------ */
const INDOOR = { on: false, k: 0, outdoor: null };
function groupOutdoors() {
  const g = new THREE.Group();
  for (const o of scene.children.slice()) if (!o.userData.keep) g.add(o);
  scene.add(g);
  INDOOR.outdoor = g;
}
function regroupOutdoors() {
  const g = INDOOR.outdoor;
  if (!g) return;
  for (let i = scene.children.length - 1; i >= 0; i--) { const o = scene.children[i]; if (o !== g && !o.userData.keep) g.add(o); }
}
function setIndoor(on) {
  INDOOR.on = on;
  if (INDOOR.outdoor) INDOOR.outdoor.visible = !on;
  if (DUN.root) DUN.root.visible = on;
}
function applyIndoor() {
  if (!INDOOR.on) return;
  U.uLightColor.value.set(0, 0, 0);
  const lowQ = quality.level === 'low' ? 1.5 : 1;
  U.uAmbient.value.set(0.075 * lowQ, 0.08 * lowQ, 0.1 * lowQ);
  U.uZenith.value.set(0.008, 0.009, 0.013);
  U.uHorizon.value.set(0.008, 0.009, 0.013);
  U.uSunGlow.value.set(0, 0, 0);
  U.uFogDensity.value = 0.03;
  U.uNight.value = 1;
  U.uWet.value = 0; U.uSnowCover.value = 0; U.uFlashLight.value = 0;
  U.uShadowOn.value = 0;
  composite.uniforms.uBloom.value = 0.55;
}
function inDungeon(e) { return !!e && inDungeonX(e.x); }
/* a short fade to black while the world changes */
function travel(fn) {
  const f = $('fade');
  if (!f || UI.travelling) return;
  UI.travelling = true;
  f.classList.add('on');
  setTimeout(() => {
    try { fn(); } catch (err) { reportError(err); }
    setTimeout(() => { f.classList.remove('on'); UI.travelling = false; }, 120);
  }, 480);
}
function enterBarrow() {
  const P = GAME.player;
  if (!P || !P.alive) return;
  if (P.carrying != null) { uiError('You cannot carry a hallow into the barrow'); return; }
  sfx('descend');
  travel(() => {
    dismount(P);
    const p = DUN.spots.arrive;
    P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = dunFloorAt(p.x, p.z);
    P.yaw = Math.PI / 2; CAM.yaw = P.yaw; CAM.pitch = Math.min(CAM.pitch, 0.32);
    P.target = null;
    setIndoor(true);
    onEnterBarrow();
    saveSoon();
  });
}
function leaveBarrow(dead = false) {
  const P = GAME.player;
  if (!P) return;
  sfx('ascend');
  travel(() => {
    const p = BARROW.out;
    const a = Math.random() * TAU;
    const x = p.x + Math.cos(a) * 1.5, z = p.z + Math.sin(a) * 1.5;
    P.x = P.prevX = x; P.z = P.prevZ = z; P.y = heightAt(x, z);
    P.yaw = BARROW.yaw; CAM.yaw = P.yaw;
    P.target = null;
    setIndoor(false);
    onLeaveBarrow(dead);
    saveSoon();
  });
}
