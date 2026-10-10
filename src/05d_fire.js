/* ================================================================== */
/* fire and light: point lights, campfires, braziers, light flashes      */
/* ================================================================== */
const FIRES = [];   // { x, y, z, size, ghost, acc, smokeAcc, seed }
const FLASHES = []; // brief lights: { x, y, z, r, c, t0, life }
function addFire(x, y, z, size = 1, ghost = false, until = Infinity, light = null) {
  if (until < Infinity && FIRES.filter((f) => f.until < Infinity).length > 40) return;
  FIRES.push({ x, y, z, size, ghost, acc: 0, smokeAcc: 0, emberAcc: 0, seed: Math.random() * 100, until, born: renderTime, lightR: light ? light.r : 0, lightK: light ? light.k : 1 });
}
function lightFlash(x, y, z, r, c, life = 0.35) {
  if (!isFiniteNum(x + y + z)) return;
  if (FLASHES.length > 48) FLASHES.shift();
  FLASHES.push({ x, y, z, r, c, t0: renderTime, life });
}
const FIRE_COL = [2.3, 0.95, 0.28], GHOST_COL = [0.45, 1.7, 1.45];

/* ---- the nearest, strongest lights go to the shaders each frame ---- */
const _plc = [];
function gatherLights(camX, camY, camZ) {
  _plc.length = 0;
  const night = U.uNight.value, t = renderTime;
  const add = (x, y, z, r, cr, cg, cb) => {
    const d = Math.sqrt((x - camX) ** 2 + (y - camY) ** 2 + (z - camZ) ** 2);
    if (d > r + 85 || cr + cg + cb < 0.02) return;
    _plc.push({ x, y, z, r, cr, cg, cb, s: Math.max(0, d - r) - (cr + cg + cb) * 2 });
  };
  for (const f of FIRES) {
    if (f.until < GAME.t) continue;
    const fl = 0.82 + 0.1 * Math.sin(t * 13.1 + f.seed) + 0.08 * Math.sin(t * 7.3 + f.seed * 2.1);
    const k = (0.5 + 0.9 * night) * fl * (0.7 + 0.3 * f.size) * f.lightK;
    const c = f.ghost ? GHOST_COL : FIRE_COL;
    add(f.x, f.y + 0.7 * f.size, f.z, f.lightR || (8 + 2.5 * night) * f.size, c[0] * k, c[1] * k, c[2] * k);
  }
  if (night > 0.04) for (const l of LANTERNS) add(l.x, l.y, l.z, 8.5, 2.3 * night, 1.45 * night, 0.55 * night);
  for (const R of REALMS) for (const S of [R.town, R.musterSite]) {
    const k = 0.55 + 0.75 * night;
    add(S.x, S.y + 1.3, S.z, 9, 0.4 * k, 1.05 * k, 1.6 * k);
  }
  for (const rel of WAR.relics) {
    const p = rel.mesh.position, c = REALMS[rel.realm].rgb;
    add(p.x, p.y, p.z, 7, c[0] * 1.5 + 0.4, c[1] * 1.5 + 0.4, c[2] * 1.5 + 0.4);
  }
  for (const p of PROJ) {
    const c = PROJ_COL[p.kind];
    if (!c) continue;
    const r = p.kind === 'meteor' ? 16 : p.kind === 'fire' ? 7 : 5.5;
    const k = p.kind === 'meteor' ? 1.6 : 1.1;
    add(p.x, p.y, p.z, r, c[0] * k, c[1] * k, c[2] * k);
  }
  for (let i = FLASHES.length - 1; i >= 0; i--) {
    const f = FLASHES[i], a = (t - f.t0) / f.life;
    if (a >= 1 || a < 0) { FLASHES.splice(i, 1); continue; }
    const k = (1 - a) * (1 - a);
    add(f.x, f.y, f.z, f.r, f.c[0] * k, f.c[1] * k, f.c[2] * k);
  }
  for (const e of ENT) {
    if (e.removed || !e.alive) continue;
    if (e.kind === 'wisp') { add(e.x, e.y, e.z, 7, 0.6, 1.7, 1.4); continue; }
    if (e.casting && e.kind === 'humanoid' && e.casting.id !== 'summon') {
      const c = e.cls === 'mage' ? [2.2, 1.0, 0.35] : e.cls === 'priest' ? [2.0, 1.8, 1.0] : [1.0, 1.2, 1.8];
      const k = 0.4 + 0.6 * clamp(e.casting.t / e.casting.total, 0, 1);
      add(e.x + Math.sin(e.yaw) * 0.42, e.y + 1.5 * (e.scale || 1), e.z + Math.cos(e.yaw) * 0.42, 4, c[0] * k, c[1] * k, c[2] * k);
    }
  }
  // under the barrow: the well's cold glow, daylight down the stair, and a little light of the player's own
  const Pl = GAME.player;
  // a brand in the player's hand (09d_brand.js)
  if (Pl && Pl.alive && Pl.brand) {
    const fl = 0.8 + 0.12 * Math.sin(t * 15.3) + 0.08 * Math.sin(t * 8.9), k = (0.55 + 0.9 * night) * fl;
    add(Pl.brand.x, Pl.brand.y + 0.12, Pl.brand.z, 8 + 2 * night, 2.3 * k, 1.0 * k, 0.3 * k);
  }
  if (INDOOR.on) {
    for (const L of DUN.lights) {
      const k = L.pulse ? 0.82 + 0.18 * Math.sin(t * 1.3) * Math.sin(t * 0.71 + 1.0) : 1;
      add(L.x, L.y, L.z, L.r, L.c[0] * k, L.c[1] * k, L.c[2] * k);
    }
    if (Pl && Pl.alive) add(Pl.x, Pl.y + 2.4, Pl.z, 7.5, 0.34, 0.27, 0.19);
  }
  // an enchanted weapon lights the ground around its bearer
  if (Pl && Pl.alive && Pl.look && Pl.look.flags >= 16) {
    const gk = (Pl.look.flags >> 4) & 7, gs = (Pl.look.flags >> 7) & 3, c = GLOW_RGB[gk];
    if (c) { const k = (0.16 + 0.12 * gs) * (0.9 + 0.1 * Math.sin(t * 5)); add(Pl.x + Math.sin(Pl.yaw - 1.2) * 0.45, Pl.y + 1.0, Pl.z + Math.cos(Pl.yaw - 1.2) * 0.45, 3 + gs, c[0] * k, c[1] * k, c[2] * k); }
  }
  const max = quality.level === 'high' ? PL_MAX : quality.level === 'medium' ? 8 : 4;
  _plc.sort((a, b) => a.s - b.s);
  const n = Math.min(max, _plc.length);
  const P = U.uPLPos.value, C = U.uPLCol.value;
  for (let i = 0; i < n; i++) { const L = _plc[i]; P[i].set(L.x, L.y, L.z, L.r); C[i].set(L.cr, L.cg, L.cb, 0); }
  U.uPLN.value = n;
}

/* ---- flames, embers and smoke for every fire near the camera ---- */
function drawFires(dt) {
  const camX = camera.position.x, camZ = camera.position.z;
  const A = U.uAmbient.value, Lc = U.uLightColor.value;
  for (let i = FIRES.length - 1; i >= 0; i--) if (FIRES[i].until < GAME.t) FIRES.splice(i, 1);
  for (const f of FIRES) {
    const d2 = (f.x - camX) ** 2 + (f.z - camZ) ** 2;
    if (d2 > 95 * 95) continue;
    const s = f.size, c = f.ghost ? GHOST_COL : FIRE_COL;
    const fl = 0.85 + 0.15 * Math.sin(renderTime * 11 + f.seed);
    glowPush(f.x, f.y + 0.45 * s, f.z, c[0] * fl, c[1] * fl, c[2] * fl, 1.3 * s);
    glowPush(f.x, f.y + 0.6 * s, f.z, c[0] * 0.25, c[1] * 0.25, c[2] * 0.25, 4.5 * s);
    f.acc += dt * 34 * s;
    while (f.acc >= 1) {
      f.acc -= 1;
      const a = Math.random() * TAU, r = Math.random() * 0.28 * s;
      const k = 0.75 + Math.random() * 0.5;
      fxAdd.emit(f.x + Math.cos(a) * r, f.y + 0.12, f.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.3, (0.9 + Math.random() * 0.9) * s, (Math.random() - 0.5) * 0.3,
        0.42 + Math.random() * 0.3, c[0] * k, c[1] * k, c[2] * k, (0.26 + Math.random() * 0.2) * s, -1.2, 0.6);
    }
    f.emberAcc += dt * 4 * s;
    if (f.indoor) f.emberAcc = 0; // a hearth: its sparks and smoke go up the chimney
    while (f.emberAcc >= 1) {
      f.emberAcc -= 1;
      fxAdd.emit(f.x + (Math.random() - 0.5) * 0.4 * s, f.y + 0.4 * s, f.z + (Math.random() - 0.5) * 0.4 * s,
        (Math.random() - 0.5) * 0.9, 1.6 + Math.random() * 1.6, (Math.random() - 0.5) * 0.9,
        1.2 + Math.random() * 0.8, c[0] * 1.2, c[1] * 1.1, c[2], 0.05, -0.4, 0.3);
    }
    if (!f.ghost && !f.indoor) {
      f.smokeAcc += dt * 2.2 * s;
      while (f.smokeAcc >= 1) {
        f.smokeAcc -= 1;
        const g = 0.32 + Math.random() * 0.1;
        fxAlpha.emit(f.x + (Math.random() - 0.5) * 0.3, f.y + 1.1 * s, f.z + (Math.random() - 0.5) * 0.3,
          U.uWindDir.value.x * 0.4, 0.7 + Math.random() * 0.3, U.uWindDir.value.y * 0.4,
          4 + Math.random() * 2, (A.x * 0.7 + Lc.x * 0.2) * g, (A.y * 0.7 + Lc.y * 0.2) * g, (A.z * 0.7 + Lc.z * 0.2) * g, -(0.7 + Math.random() * 0.4) * s, -0.05, 0.1);
      }
    }
  }
}

/* ---- camps get fires, tents and stones; keeps and temples get braziers at the gate ---- */
function brazierAt(b, M, lx, lz, st, ghost = false, light = null) {
  const iron = [0.2, 0.19, 0.2];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    beam(b, M, [lx + Math.sin(a) * 0.32, 0, lz + Math.cos(a) * 0.32], [lx + Math.sin(a) * 0.12, 1.0, lz + Math.cos(a) * 0.12], 0.05, MAT.metal, iron);
  }
  b.add(G.frustum16, lm(M, lx, 1.12, lz, 0, 0.42, 0.28, 0.42, Math.PI), MAT.metal, iron);
  b.add(G.cyl12, lm(M, lx, 1.27, lz, 0, 0.46, 0.05, 0.46), MAT.metal, darker(iron, 1.3));
  b.add(G.cyl8, lm(M, lx, 1.24, lz, 0, 0.36, 0.06, 0.36), MAT.darkstone, [0.15, 0.12, 0.1]);
  const p = worldOf(M, lx, 1.26, lz);
  addFire(p.x, p.y, p.z, 0.62, ghost, Infinity, light);
}
function firePit(b, M, big, st) {
  for (let k = 0; k < (big ? 10 : 8); k++) {
    const a = (k / (big ? 10 : 8)) * TAU, r = big ? 1.15 : 0.72;
    b.add(G.ico, lm(M, Math.sin(a) * r, 0.08, Math.cos(a) * r, a * 3, 0.2 + 0.08 * Math.sin(k * 7), 0.15, 0.22), MAT.stone, [0.45, 0.44, 0.42]);
  }
  b.add(G.cyl12, lm(M, 0, 0.02, 0, 0, big ? 1.0 : 0.62, 0.05, big ? 1.0 : 0.62), MAT.darkstone, [0.12, 0.1, 0.09]);
  const n = big ? 6 : 4;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.3;
    beam(b, M, [Math.sin(a) * (big ? 0.9 : 0.55), 0.06, Math.cos(a) * (big ? 0.9 : 0.55)], [Math.sin(a) * 0.08, big ? 1.0 : 0.55, Math.cos(a) * 0.08], big ? 0.16 : 0.11, MAT.logH, [0.3, 0.2, 0.13]);
  }
}
function buildFireProps() {
  BUILDING_DEPTH = BUILDING_DEPTH || depthFrom(buildingMat);
  const b = new Batch();
  for (const c of W.camps) {
    if (!['bandit', 'skeleton', 'draugr', 'troll'].includes(c.type)) continue;
    const y = heightAt(c.x, c.z), R = REALMS[c.realm], st = STYLE[R.style];
    const M = new THREE.Matrix4().compose(new THREE.Vector3(c.x, y, c.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.id * 1.7, 0)), new THREE.Vector3(1, 1, 1));
    if (c.type === 'bandit' || c.type === 'troll') {
      const big = c.type === 'troll';
      firePit(b, M, big, st);
      addFire(c.x, y + 0.1, c.z, big ? 1.5 : 1.0, false);
      addCircle(c.x, c.z, big ? 1.3 : 0.9, 'fire', 1.2);
      if (c.type === 'bandit') {
        // two lean tents, bedrolls, a log to sit on, a weapon rack
        for (const [lx, lz, a] of [[4.6, 1.2, -1.3], [-3.6, 3.8, 2.4]]) {
          const T = lm(M, lx, 0, lz, a);
          gableRoof(b, T, 2.4, 2.8, 0.0, 0.95, { ohSide: 0, ohGable: 0.1, thick: 0.05, roofMat: MAT.cloth, roofCol: [0.48, 0.4, 0.3], gableMat: MAT.cloth, gableCol: [0.36, 0.3, 0.22], trimCol: [0.3, 0.22, 0.14], ridge: 'round', ridgeR: 0.05, barge: false });
          b.add(G.box, lm(T, 0, 0.05, 0.2, 0, 0.8, 0.1, 1.9), MAT.cloth, [0.42, 0.32, 0.26]);
          const p = worldOf(T, 0, 0, 0);
          addCircle(p.x, p.z, 1.3, 'tent', 1.6);
        }
        beam(b, M, [-1.2, 0.25, -2.4], [1.6, 0.25, -2.1], 0.32, MAT.logH, [0.36, 0.26, 0.16]);
        b.add(G.box, lm(M, -4.2, 0.9, -2.2, 0.8, 1.6, 0.08, 0.12), MAT.wood, [0.32, 0.22, 0.13]);
        for (const s2 of [-1, 1]) b.add(G.box, lm(M, -4.2 + Math.cos(0.8) * 0.7 * s2, 0.6, -2.2 - Math.sin(0.8) * 0.7 * s2, 0.8, 0.08, 1.2, 0.08), MAT.wood, [0.32, 0.22, 0.13]);
        for (let k = 0; k < 3; k++) beam(b, M, [-4.6 + k * 0.35, 0.05, -2.0 + k * 0.1], [-4.4 + k * 0.35, 1.35, -2.55 + k * 0.1], 0.04, MAT.metal, [0.45, 0.45, 0.48]);
      } else {
        // a troll's leavings: bones and boulders
        for (let k = 0; k < 7; k++) {
          const a = k * 2.1, r = 2.6 + (k % 3);
          beam(b, M, [Math.sin(a) * r, 0.06, Math.cos(a) * r], [Math.sin(a) * r + Math.cos(a) * 0.7, 0.1, Math.cos(a) * r - Math.sin(a) * 0.7], 0.07, MAT.cloth, [0.82, 0.78, 0.66]);
        }
        for (let k = 0; k < 4; k++) {
          const a = k * 1.6 + 0.5, r = 6 + k * 0.5;
          b.add(G.ico, lm(M, Math.sin(a) * r, 0.4, Math.cos(a) * r, k, 1.0, 0.8, 0.9), MAT.stone, [0.46, 0.45, 0.42], y, 2);
          const p = worldOf(M, Math.sin(a) * r, 0, Math.cos(a) * r);
          addCircle(p.x, p.z, 0.9, 'rock', 1.5);
        }
      }
    } else {
      // barrow wights and draugr keep cold fires in a ring of old stones
      brazierAt(b, M, 0, 0, st, true);
      addCircle(c.x, c.z, 0.45, 'brazier', 1.4);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + 0.4, r = 6.2;
        b.add(G.box, lm(M, Math.sin(a) * r, 0.9, Math.cos(a) * r, a, 0.7, 2.2, 0.45, 0.08 * Math.sin(k * 3), 0.06 * Math.cos(k * 5)), MAT.stone, [0.5, 0.52, 0.5], y, 2.4);
        b.add(G.box, lm(M, Math.sin(a) * (r - 0.24), 1.1, Math.cos(a) * (r - 0.24), a, 0.14, 1.3, 0.02), MAT.rune, [0.2, 0.5, 0.45]);
        const p = worldOf(M, Math.sin(a) * r, 0, Math.cos(a) * r);
        addCircle(p.x, p.z, 0.5, 'stone', 2.2);
      }
    }
  }
  for (const R of REALMS) {
    const st = STYLE[R.style];
    for (const S of [...R.keepSites, R.templeSite]) {
      const M = siteMatrix(S), gz = S.gateLocal.z;
      const temple = S === R.templeSite;
      const off = temple ? 3.2 : R.style === 'round' ? 4.6 : 4.4;
      const sx = temple ? 4.25 : 4.2;
      for (const s of [-1, 1]) {
        brazierAt(b, M, s * sx, gz + off, st, false);
        const p = siteToWorld(S, s * sx, gz + off);
        addCircle(p.x, p.z, 0.4, 'brazier', 1.4);
      }
    }
  }
  if (b.n) { const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); SITE_MESHES.push(m); shadowCaster(m, BUILDING_DEPTH); }
}
