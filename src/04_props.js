/* ================================================================== */
/* props: buildings, doors, banners, relics, trees, rocks, hero tree   */
/* ================================================================== */
const MAT = { stone: 0, wood: 1, plaster: 2, slate: 3, thatch: 4, logs: 5, metal: 6, rune: 7, cloth: 8, darkstone: 9, shingle: 10, window: 11, gold: 12, logH: 13, water: 14, rock: 15, drystone: 16 };
const STYLE = {
  stone: { stone: [0.66, 0.63, 0.57], roof: [0.32, 0.35, 0.42], roofMat: MAT.slate, wood: [0.42, 0.29, 0.18], plaster: [0.88, 0.84, 0.74], thatch: [0.7, 0.58, 0.34], logs: [0.42, 0.3, 0.2] },
  round: { stone: [0.56, 0.6, 0.52], roof: [0.66, 0.55, 0.32], roofMat: MAT.thatch, wood: [0.4, 0.29, 0.18], plaster: [0.8, 0.76, 0.64], thatch: [0.66, 0.55, 0.32], logs: [0.4, 0.3, 0.2] },
  timber: { stone: [0.52, 0.52, 0.52], roof: [0.33, 0.24, 0.17], roofMat: MAT.shingle, wood: [0.47, 0.34, 0.21], plaster: [0.8, 0.76, 0.64], thatch: [0.6, 0.5, 0.3], logs: [0.43, 0.31, 0.2] },
};

class Batch {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.mat = []; this.ao = []; this.idx = []; this.n = 0; }
  add(geo, m4, matId, color, baseY = null, aoH = 3) {
    const p = geo.attributes.position, nr = geo.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m4);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    const base = this.n, flip = m4.determinant() < 0;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4);
      nv.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(nv.x, nv.y, nv.z);
      this.col.push(color[0], color[1], color[2]);
      this.mat.push(matId);
      this.ao.push(baseY === null ? 1 : clamp(0.45 + 0.55 * (v.y - baseY) / aoH, 0.45, 1));
    }
    const n = geo.index ? geo.index.count : p.count, at = (i) => base + (geo.index ? geo.index.getX(i) : i);
    for (let i = 0; i < n; i += 3) {
      if (flip) this.idx.push(at(i), at(i + 2), at(i + 1));
      else this.idx.push(at(i), at(i + 1), at(i + 2));
    }
    this.n += p.count;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12, 1),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
  cone8: new THREE.ConeGeometry(1, 1, 8, 1),
  cone12: new THREE.ConeGeometry(1, 1, 12, 1),
  cone16: new THREE.ConeGeometry(1, 1, 16, 1),
  pyr: (() => { const g = new THREE.ConeGeometry(1, 1, 4, 1); g.rotateY(Math.PI / 4); return g; })(),
  prism: (() => {
    // unit gable roof: ridge along X, base 1 x 1 at y=0, apex at y=1
    const g = new THREE.BufferGeometry();
    const P = [
      -0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0, // back slope
      -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, // front slope
      -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, // left gable
      0.5, 0, -0.5, 0.5, 1, 0, 0.5, 0, 0.5, // right gable
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.computeVertexNormals();
    return g;
  })(),
  ico: new THREE.IcosahedronGeometry(1, 1),
  frustum16: new THREE.CylinderGeometry(0.88, 1, 1, 16, 1),
};
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function siteMatrix(S) { return new THREE.Matrix4().compose(new THREE.Vector3(S.x, S.y, S.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, S.yaw, 0)), new THREE.Vector3(1, 1, 1)); }
function lm(base, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  return base.clone().multiply(new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
}
const darker = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const buildingMat = mat({
  vertexShader: /* glsl */`
    attribute vec3 aCol; attribute float aMat; attribute float aAO;
    varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vMat; varying float vAO;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz; vN = mat3(modelMatrix) * normal; vCol = aCol; vMat = aMat; vAO = aAO;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    uniform float uFlash, uWet, uSnowCover;
    varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying float vMat; varying float vAO;
    vec2 planarUV(vec3 p, vec3 n){ vec3 a = abs(n); if (a.y > 0.7) return p.xz; return a.x > a.z ? vec2(p.z, p.y) : vec2(p.x, p.y); }
    void main(){
      vec3 n = safeNormalize(vN);
      int m = int(vMat + 0.5);
      gSh = shadowAt(vW, n);
      gPL = pointLights(vW, n);
      vec3 alb = vCol;
      vec2 uv = planarUV(vW, n);
      if (m == 0 || m == 9) {
        vec2 s = vec2(1.15, 0.58);
        float row = floor(uv.y / s.y);
        float x = uv.x / s.x + mod(row, 2.0) * 0.5;
        vec2 cell = vec2(floor(x), row);
        vec2 f = vec2(fract(x), fract(uv.y / s.y));
        float id = hash12(cell);
        float edge = min(min(f.x, 1.0 - f.x) * s.x, min(f.y, 1.0 - f.y) * s.y);
        alb *= (0.8 + 0.28 * id) * mix(0.58, 1.0, smoothstep(0.015, 0.06, edge)) * (0.88 + 0.22 * vnoise(vW.xz * 1.7 + vW.y));
        alb = mix(alb, alb * vec3(0.72, 0.88, 0.62), smoothstep(0.55, 0.9, vnoise(vW.xz * 0.4 + vW.y * 0.3)) * 0.5 * (1.0 - smoothstep(1.5, 4.0, vAO * 4.0)));
        // weathering: rain streaks down the faces, damp and moss near the ground
        float streak = vnoise(vec2(uv.x * 2.7, vW.y * 0.22)) * vnoise(vec2(uv.x * 9.0, vW.y * 0.6));
        alb *= 1.0 - 0.28 * smoothstep(0.25, 0.6, streak) * step(abs(n.y), 0.5);
        float damp = 1.0 - smoothstep(0.5, 0.75, vAO);
        alb = mix(alb, alb * vec3(0.62, 0.7, 0.5), damp * smoothstep(0.3, 0.7, vnoise(vW.xz * 1.1 + vW.y)) * 0.7);
        // mortar joints catch the light a little differently
        float joint = 1.0 - smoothstep(0.015, 0.05, edge);
        n = safeNormalize(n + (abs(n.y) < 0.5 ? vec3(0.0, (f.y - 0.5) * 0.35, 0.0) : vec3(0.0)) * (1.0 - joint));
        if (m == 9) alb *= 0.7;
      } else if (m == 1) {
        float u = abs(n.y) > 0.7 ? vW.x : uv.x;
        float pl = fract(u / 0.32);
        alb *= (0.84 + 0.18 * hash12(vec2(floor(u / 0.32), 3.0))) * mix(0.6, 1.0, smoothstep(0.0, 0.07, min(pl, 1.0 - pl)));
        alb *= 0.9 + 0.2 * vnoise(vec2(u * 9.0, vW.y * 0.7));
      } else if (m == 2) {
        alb *= 0.9 + 0.12 * vnoise(vW.xz * 2.7 + vW.y * 2.3);
      } else if (m == 3 || m == 10) {
        float rowH = 0.3;
        float row = floor(vW.y / rowH);
        float u = (abs(n.x) > abs(n.z) ? vW.z : vW.x) / 0.42 + mod(row, 2.0) * 0.5;
        float fy = fract(vW.y / rowH), fu = fract(u);
        alb *= (0.8 + 0.25 * hash12(vec2(floor(u), row))) * mix(0.62, 1.0, smoothstep(0.0, 0.18, fy)) * mix(0.75, 1.0, smoothstep(0.0, 0.06, min(fu, 1.0 - fu)));
      } else if (m == 4) {
        // thatch: straw combed down the slope, laid in courses
        float st = vnoise(vec2(vW.x * 9.0, vW.y * 1.6)) * 0.5 + vnoise(vec2(vW.z * 9.0, vW.y * 1.6 + 17.0)) * 0.5;
        float fine = vnoise(vec2(vW.x * 31.0 + vW.z * 3.0, vW.y * 4.0)) * 0.5 + vnoise(vec2(vW.z * 31.0 + vW.x * 3.0, vW.y * 4.0 + 5.0)) * 0.5;
        float course = fract(vW.y / 0.42 + vnoise(vW.xz * 1.3) * 0.35);
        alb *= (0.66 + 0.5 * st) * (0.88 + 0.22 * fine) * mix(0.7, 1.0, smoothstep(0.0, 0.3, course));
        alb = mix(alb, alb * vec3(0.78, 0.86, 0.66), smoothstep(0.6, 0.85, vnoise(vW.xz * 0.6 + vW.y * 0.4)) * 0.45);
      } else if (m == 5) {
        float u = (abs(n.x) > abs(n.z) ? vW.z : vW.x) / 0.48;
        float s = fract(u);
        alb *= (0.55 + 0.5 * sin(s * 3.1416)) * (0.85 + 0.25 * hash12(vec2(floor(u), 7.0))) * (0.85 + 0.2 * vnoise(vec2(u * 3.0, vW.y * 2.0)));
      } else if (m == 13) {
        // bark along the log, knots, a darker underside
        float along = abs(n.x) > abs(n.z) ? vW.z : vW.x;
        float bark = vnoise(vec2(along * 1.3, vW.y * 34.0)) * 0.6 + vnoise(vec2(along * 5.0, vW.y * 60.0)) * 0.4;
        alb *= (0.68 + 0.45 * bark) * (0.85 + 0.15 * smoothstep(-0.6, 0.6, n.y));
        alb *= 1.0 - 0.35 * smoothstep(0.72, 0.9, vnoise(vec2(along * 2.2 + 7.0, vW.y * 9.0)));
      } else if (m == 15) {
        // a raw monolith: weathered grain, darker seams, pale crusts of lichen
        float g1 = vnoise(vW.xz * 1.3 + vW.y * 1.1) * 0.6 + vnoise(vec2(vW.x + vW.z, vW.y) * 3.7) * 0.4;
        float seam = smoothstep(0.64, 0.8, vnoise(vec2((vW.x - vW.z) * 2.2, vW.y * 0.8)));
        alb *= (0.72 + 0.42 * g1) * (1.0 - 0.38 * seam) * (0.9 + 0.2 * vnoise(vW.xz * 9.0 + vW.y * 7.0));
        float lich = smoothstep(0.63, 0.8, vnoise(vW.xz * 2.4 + vW.y * 1.7 + 11.0)) * (0.35 + 0.65 * smoothstep(-0.2, 0.8, n.y));
        alb = mix(alb, vec3(0.6, 0.62, 0.5) * (0.85 + 0.3 * g1), lich * 0.5);
        n = safeNormalize(n + vec3(vnoise(vW.yz * 3.0) - 0.5, (vnoise(vW.xz * 3.0) - 0.5) * 0.5, vnoise(vW.xy * 3.0) - 0.5) * 0.4);
      } else if (m == 16) {
        // drystone: rough stones of every size fitted without mortar, the gaps deep and dark
        vec2 q = vec2(uv.x / 0.6, vW.y / 0.3);
        vec2 qc = floor(q), qf = fract(q);
        float d1 = 9.0, d2 = 9.0; vec2 bc = qc, br = vec2(0.0);
        for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
          vec2 o = vec2(float(xx), float(yy));
          vec2 r = o + hash22(qc + o) * vec2(0.8, 0.55) + vec2(0.1, 0.22) - qf;
          float d = dot(r * vec2(1.0, 1.25), r * vec2(1.0, 1.25));
          if (d < d1) { d2 = d1; d1 = d; bc = qc + o; br = r; } else if (d < d2) d2 = d;
        }
        float edge = sqrt(d2) - sqrt(d1);
        float id = hash12(bc);
        float face = smoothstep(0.05, 0.24, edge);
        alb *= (0.58 + 0.55 * id) * mix(0.12, 1.0, face) * (0.8 + 0.3 * vnoise(vW.xz * 4.3 + vW.y * 5.1 + id * 9.0));
        // each stone bulges a little out of the wall
        if (abs(n.y) < 0.5) {
          vec3 tu = abs(n.x) > abs(n.z) ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
          n = safeNormalize(n - (tu * br.x + vec3(0.0, br.y, 0.0)) * 0.55 * face);
        }
        float damp = 1.0 - smoothstep(0.5, 0.75, vAO);
        alb = mix(alb, alb * vec3(0.62, 0.68, 0.55), damp * 0.5);
        alb = mix(alb, vec3(0.3, 0.36, 0.2), smoothstep(0.66, 0.82, vnoise(vW.xz * 1.6 + vW.y * 2.2 + 31.0)) * (1.0 - face * 0.6) * 0.5);
      } else if (m == 14) {
        alb = vec3(0.04, 0.07, 0.09);
      } else if (m == 8) {
        alb *= 0.88 + 0.16 * sin(vW.y * 3.0 + vW.x * 1.3);
      } else if (m == 12) {
        alb *= 0.9 + 0.1 * vnoise(vW.xz * 4.0);
      }
      // rain darkens stone and wood; snow settles on roofs and ledges
      alb *= 1.0 - 0.22 * uWet;
      alb = mix(alb, vec3(0.86, 0.88, 0.93), uSnowCover * smoothstep(0.35, 0.75, n.y) * smoothstep(0.3, 0.55, vnoise(vW.xz * 1.7) * 0.5 + 0.3 + uSnowCover * 0.4));
      vec3 col = lightSurface(alb, n, vAO);
      if (uWet > 0.01) {
        vec3 Vw = safeNormalize(cameraPosition - vW);
        float fres = 0.03 + 0.97 * spow(1.0 - max(dot(n, Vw), 0.0), 5.0);
        vec3 Rw = reflect(-Vw, n);
        col += skyBase(safeNormalize(vec3(Rw.x, max(Rw.y, 0.03), Rw.z))) * fres * uWet * 0.35 * vAO;
      }
      if (m == 6 || m == 12) {
        vec3 V = safeNormalize(cameraPosition - vW);
        vec3 H = safeNormalize(uLightDir + V);
        col += uLightColor * spow(dot(n, H), 40.0) * (m == 12 ? 0.9 : 0.4) * alb * gSh;
      }
      if (m == 7) {
        // carved glyphs: short strokes and gaps rather than a solid bar of light
        vec2 gq = vec2(vW.y * 5.5, (vW.x + vW.z) * 5.5);
        vec2 gc = floor(gq), gf = fract(gq);
        float hh = hash12(gc);
        float stroke = hh > 0.5 ? 1.0 - smoothstep(0.12, 0.2, abs(gf.x - 0.5)) : 1.0 - smoothstep(0.12, 0.2, abs(gf.y - 0.5));
        float glyph = max(stroke * step(0.25, hash12(gc + 3.1)), 0.18);
        col = mix(col, col * 0.5, 0.6) + vec3(0.35, 0.85, 1.0) * (0.45 + 0.75 * uNight) * (0.75 + 0.25 * sin(uTime * 2.0 + vW.y * 1.5)) * glyph;
      }
      if (m == 11) col = mix(col * 0.4, vec3(1.0, 0.66, 0.28) * 1.5, smoothstep(0.2, 0.8, uNight));
      col += vec3(1.0, 0.85, 0.6) * uFlash * 0.6;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
  uniforms: { uFlash: { value: 0 } },
});

/* --- realm-specific keep builders (site frame: +Z faces the centre) --- */
function keepStone(b, S, st, R) {
  const M = siteMatrix(S), hs = KEEP_HS, t = KEEP_T, H = WALL_H, by = S.y;
  const wall = (x, z, sx, sz) => b.add(G.box, lm(M, x, H / 2 - 0.7, z, 0, sx, H + 1.4, sz), MAT.stone, st.stone, by, 4);
  wall(0, -hs + t / 2, 2 * hs, t);
  wall(-hs + t / 2, 0, t, 2 * hs);
  wall(hs - t / 2, 0, t, 2 * hs);
  const seg = (hs - GATE_HW) / 2;
  wall(-(GATE_HW + seg), hs - t / 2, 2 * seg, t);
  wall(GATE_HW + seg, hs - t / 2, 2 * seg, t);
  b.add(G.box, lm(M, 0, H - 1.0, hs - t / 2, 0, 2 * GATE_HW + 0.6, 2.2, t + 0.5), MAT.stone, darker(st.stone, 0.92), by, 4);
  // castles: the crenellated parapets, the open fighting tops of the corner towers and their stairs are in 04g_castles.js
  const banners = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hs - 1.2), z = sz * (hs - 1.2);
    b.add(G.cyl12, lm(M, x, 10.5 / 2 - 0.7, z, 0, 3.4, 10.5 + 1.4, 3.4), MAT.stone, st.stone, by, 5);
    b.add(G.cyl8, lm(M, x, 10.5 + 2.1, z, 0, 0.08, 4.2, 0.08), MAT.wood, st.wood);
    banners.push({ local: [x, 14.5, z], yaw: 0, w: 1.6, h: 0.9, kind: 1 });
  }
  for (const sx of [-1, 1]) {
    const x = sx * (GATE_HW + 1.9), z = hs - 0.8;
    b.add(G.cyl12, lm(M, x, 4.5 - 0.7, z, 0, 2.3, 9 + 1.4, 2.3), MAT.stone, st.stone, by, 5);
    b.add(G.cone12, lm(M, x, 8.3 + 1.7, z, 0, 2.75, 3.4, 2.75), st.roofMat, st.roof);
  }
  b.add(G.box, lm(M, 0, 6.5 - 0.7, -hs + t + 5.2, 0, 12.4, 13 + 1.4, 10.4), MAT.stone, darker(st.stone, 0.95), by, 5);
  b.add(G.prism, lm(M, 0, 12.3, -hs + t + 5.2, 0, 13.2, 4.6, 11.2), st.roofMat, st.roof);
  b.add(G.box, lm(M, 0, 2.2, -hs + t + 10.45, 0, 2.4, 3.6, 0.3), MAT.wood, st.wood);
  // hung clear of the masonry, above the gate rather than across it
  banners.push({ local: [0, H + 0.05, hs - t / 2 + (t + 0.5) / 2 + 0.14], yaw: 0, w: 2.2, h: 2.0, kind: 0 });
  banners.push({ local: [0, 12.2, -hs + t + 10.4 + 0.14], yaw: 0, w: 2.2, h: 4.0, kind: 0 });
  return banners;
}
function keepRound(b, S, st, R) {
  const M = siteMatrix(S), R0 = 16.5, H = 6.2, by = S.y, segs = 20;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.2) continue;
    const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.5;
    b.add(G.box, lm(M, Math.sin(am) * R0, H / 2 - 0.7, Math.cos(am) * R0, am, len, H + 1.4, KEEP_T), MAT.stone, st.stone, by, 4);
    b.add(G.box, lm(M, Math.sin(am) * (R0 + 0.15), H + 0.25, Math.cos(am) * (R0 + 0.15), am, len, 0.5, KEEP_T + 0.5), MAT.darkstone, st.stone);
    // a timber hoarding every other segment
    if (i % 2 === 0 && i !== 4 && i !== 14) b.add(G.box, lm(M, Math.sin(am) * (R0 + 0.4), H + 1.1, Math.cos(am) * (R0 + 0.4), am, len * 0.8, 1.2, 0.25), MAT.wood, st.wood); // castles: not where the lookouts stand
  }
  b.add(G.box, lm(M, 0, H - 0.6, R0, 0, 2 * GATE_HW + 0.6, 1.8, KEEP_T + 0.5), MAT.darkstone, st.stone, by, 4);
  const banners = [];
  for (const sx of [-1, 1]) {
    const x = sx * 3.9, z = R0 - 0.6;
    b.add(G.cyl12, lm(M, x, 4.25 - 0.7, z, 0, 2.6, 8.5 + 1.4, 2.6), MAT.stone, st.stone, by, 5);
    b.add(G.cone12, lm(M, x, 7.8 + 2.0, z, 0, 3.1, 4.0, 3.1), MAT.thatch, st.thatch);
    b.add(G.cyl8, lm(M, x, 11.8 + 1.0, z, 0, 0.07, 2.0, 0.07), MAT.wood, st.wood);
    banners.push({ local: [x, 13.6, z], yaw: 0, w: 1.5, h: 0.85, kind: 1 });
  }
  // castles: the two side towers are open lookouts the wall walk runs through (04g_castles.js)
  b.add(G.cyl16, lm(M, 0, 2.1 - 0.5, -6.5, 0, 6.2, 4.2 + 1.0, 6.2), MAT.stone, st.stone, by, 4);
  b.add(G.cone16, lm(M, 0, 3.6 + 3.25, -6.5, 0, 7.4, 6.5, 7.4), MAT.thatch, st.thatch);
  b.add(G.box, lm(M, 0, 1.4, -0.35, 0, 1.6, 2.6, 0.3), MAT.wood, st.wood);
  banners.push({ local: [0, H + 0.25, R0 + (KEEP_T + 0.5) / 2 + 0.14], yaw: 0, w: 2.2, h: 1.6, kind: 0 });
  b.add(G.cyl8, lm(M, 0, 10.4 + 1.4, -6.5, 0, 0.08, 2.8, 0.08), MAT.wood, st.wood);
  banners.push({ local: [0, 13.0, -6.5], yaw: 0, w: 2.0, h: 1.1, kind: 1 });
  return banners;
}
function palisadeWall(b, M, x0, z0, x1, z1, H, st, by) {
  const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
  b.add(G.box, lm(M, (x0 + x1) / 2, H / 2 - 0.7, (z0 + z1) / 2, yaw, 1.0, H + 1.4, len), MAT.logs, st.logs, by, 4);
  const n = Math.floor(len / 0.52);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    b.add(G.cone8, lm(M, lerp(x0, x1, t), H + 0.45, lerp(z0, z1, t), 0, 0.27, 0.9, 0.27), MAT.wood, st.logs);
  }
}
function keepTimber(b, S, st, R) {
  const M = siteMatrix(S), hs = KEEP_HS, t = KEEP_T, H = WALL_H, by = S.y;
  palisadeWall(b, M, -hs + 1, -hs + t / 2, hs - 1, -hs + t / 2, H, st, by);
  palisadeWall(b, M, -hs + t / 2, -hs + 1, -hs + t / 2, hs - 1, H, st, by);
  palisadeWall(b, M, hs - t / 2, -hs + 1, hs - t / 2, hs - 1, H, st, by);
  palisadeWall(b, M, -hs + 1, hs - t / 2, -GATE_HW, hs - t / 2, H, st, by);
  palisadeWall(b, M, GATE_HW, hs - t / 2, hs - 1, hs - t / 2, H, st, by);
  b.add(G.box, lm(M, 0, H - 0.8, hs - t / 2, 0, 2 * GATE_HW + 1.2, 1.4, 1.4), MAT.wood, st.wood);
  // castles: the walkway behind the palisade, its stairs and loopholes are in 04g_castles.js
  const banners = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hs - 1.2), z = sz * (hs - 1.2);
    b.add(G.box, lm(M, x, 5 - 0.7, z, 0, 5.4, 10 + 1.4, 5.4), MAT.wood, st.wood, by, 5);
    b.add(G.box, lm(M, x, 0.6, z, 0, 5.8, 2.4, 5.8), MAT.stone, st.stone, by, 3);
    b.add(G.pyr, lm(M, x, 9.6 + 2.2, z, 0, 4.5, 4.4, 4.5), MAT.shingle, st.roof);
    b.add(G.cyl8, lm(M, x, 14 + 1.1, z, 0, 0.07, 2.2, 0.07), MAT.wood, st.wood);
    banners.push({ local: [x, 16.0, z], yaw: 0, w: 1.6, h: 0.9, kind: 1 });
  }
  for (const sx of [-1, 1]) {
    const x = sx * (GATE_HW + 1.9), z = hs - 0.8;
    b.add(G.box, lm(M, x, 4.3 - 0.7, z, 0, 3.8, 8.6 + 1.4, 3.8), MAT.wood, st.wood, by, 5);
    b.add(G.pyr, lm(M, x, 7.9 + 1.7, z, 0, 3.2, 3.4, 3.2), MAT.shingle, st.roof);
  }
  // longhouse
  const lz = -hs + t + 5.2;
  b.add(G.box, lm(M, 0, 2.6 - 0.6, lz, 0, 12.4, 5.2 + 1.2, 10.4), MAT.wood, st.wood, by, 4);
  b.add(G.prism, lm(M, 0, 4.8, lz, 0, 13.4, 6.2, 11.6), MAT.shingle, st.roof);
  b.add(G.box, lm(M, 0, 1.6, lz + 5.25, 0, 2.2, 3.2, 0.3), MAT.wood, darker(st.wood, 0.7));
  for (const sx of [-1, 1]) b.add(G.box, lm(M, sx * 6.9, 11.2, lz, sx * 0.4, 0.3, 1.6, 0.3), MAT.wood, st.wood);
  banners.push({ local: [0, H - 0.1, hs - t / 2 + 0.7 + 0.14], yaw: 0, w: 2.2, h: 1.25, kind: 0 });
  b.add(G.cyl8, lm(M, 0, 11.2 + 1.4, lz, 0, 0.08, 2.8, 0.08), MAT.wood, st.wood);
  banners.push({ local: [0, 13.8, lz], yaw: 0, w: 2.0, h: 1.1, kind: 1 });
  return banners;
}
function templeModel(b, S, st, R) {
  const M = siteMatrix(S), R0 = 16, by = S.y, segs = 18;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.2) continue;
    const len = 2 * R0 * Math.sin((a1 - a0) / 2) + 0.3;
    const mt = R.style === 'timber' ? MAT.logs : MAT.stone;
    b.add(G.box, lm(M, Math.sin(am) * R0, 1.5 - 0.6, Math.cos(am) * R0, am, len, 3.0 + 1.2, 1.4), mt, R.style === 'timber' ? st.logs : st.stone, by, 3);
  }
  for (const sx of [-1, 1]) {
    b.add(G.cyl12, lm(M, sx * 4.25, 2.3 - 0.5, R0, 0, 1.45, 4.6 + 1.0, 1.45), MAT.stone, st.stone, by, 3);
    b.add(G.box, lm(M, sx * 4.25, 4.7, R0, 0, 2.4, 0.5, 2.4), MAT.darkstone, st.stone);
  }
  b.add(G.cyl16, lm(M, 0, 0.25, 0, 0, 7.6, 0.8, 7.6), MAT.stone, darker(st.stone, 1.08), by, 1);
  b.add(G.cyl16, lm(M, 0, 0.55, 0, 0, 6.4, 0.5, 6.4), MAT.stone, darker(st.stone, 1.12));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    const x = Math.sin(a) * 10.5, z = Math.cos(a) * 10.5;
    if (R.style === 'round') {
      b.add(G.box, lm(M, x, 2.6, z, a, 1.5, 6.2, 0.95, (hash1(i * 7) - 0.5) * 0.12, (hash1(i * 3) - 0.5) * 0.1), MAT.stone, darker(st.stone, 0.95), by, 6);
    } else if (R.style === 'timber') {
      b.add(G.cyl8, lm(M, x, 3.2, z, 0, 0.62, 7.4, 0.62), MAT.logs, st.logs, by, 6);
      b.add(G.box, lm(M, x, 7.2, z, a, 1.2, 0.8, 1.2), MAT.wood, st.wood);
    } else {
      b.add(G.cyl12, lm(M, x, 3.3, z, 0, 0.72, 7.2, 0.72), MAT.stone, darker(st.stone, 1.12), by, 6);
      b.add(G.box, lm(M, x, 7.1, z, a, 1.6, 0.5, 1.6), MAT.stone, darker(st.stone, 1.12));
    }
  }
  if (R.style === 'stone') {
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU + TAU / 16, a1 = ((i + 1) / 8) * TAU + TAU / 16, am = (a0 + a1) / 2;
      const len = 2 * 10.5 * Math.sin((a1 - a0) / 2);
      b.add(G.box, lm(M, Math.sin(am) * 10.3, 7.6, Math.cos(am) * 10.3, am, len + 0.6, 0.6, 0.9), MAT.stone, darker(st.stone, 1.1));
    }
  }
  b.add(G.box, lm(M, 0, 1.25, -1, 0, 2.6, 1.3, 1.4), MAT.stone, darker(st.stone, 1.15));
  for (const sx of [-1, 1]) b.add(G.cyl12, lm(M, sx * 4.5, 1.25, -1, 0, 0.55, 1.3, 0.55), MAT.stone, darker(st.stone, 1.15));
  // on the outer faces of the gate pillars, clear of the stone (they used to hang inside it)
  return [{ local: [-4.25, 4.45, R0 + 1.45 + 0.12], yaw: 0, w: 1.3, h: 2.6, kind: 0 }, { local: [4.25, 4.45, R0 + 1.45 + 0.12], yaw: 0, w: 1.3, h: 2.6, kind: 0 }];
}
function musterModel(b, S, st, R) {
  const M = siteMatrix(S), R0 = 18, by = S.y, segs = 22;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, am = (a0 + a1) / 2;
    if (Math.abs(angDiff(am, 0)) < 0.42 || Math.abs(angDiff(am, Math.PI)) < 0.42) continue;
    const x0 = Math.sin(a0) * R0, z0 = Math.cos(a0) * R0, x1 = Math.sin(a1) * R0, z1 = Math.cos(a1) * R0;
    palisadeWall(b, M, x0, z0, x1, z1, 4.4, st, by);
  }
  const cloth = R.rgb;
  for (const [lx, lz] of [[-11, -4], [11, -4], [-10, 8], [10, 8]]) {
    b.add(G.cone8, lm(M, lx, 1.6, lz, 0.3, 2.5, 3.4, 2.5), MAT.cloth, darker(cloth, 0.85), by, 3);
    b.add(G.cyl8, lm(M, lx, 3.6, lz, 0, 0.06, 1.0, 0.06), MAT.wood, st.wood);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + TAU / 12;
    const x = Math.sin(a) * 5.4, z = Math.cos(a) * 5.4;
    b.add(G.box, lm(M, x, 1.3, z, a, 1.0, 3.4, 0.7), MAT.stone, [0.5, 0.52, 0.55], by, 3);
    b.add(G.box, lm(M, x - Math.sin(a) * 0.36, 1.5, z - Math.cos(a) * 0.36, a, 0.24, 2.4, 0.04), MAT.rune, [0.3, 0.6, 0.7]);
  }
  b.add(G.cyl8, lm(M, 0, 0.1, 0, 0, 2.6, 0.3, 2.6), MAT.rune, [0.25, 0.5, 0.6]);
  b.add(G.cyl8, lm(M, -8, 4.5, 12, 0, 0.1, 9, 0.1), MAT.wood, st.wood);
  return [{ local: [-8, 8.8, 12], yaw: 0, w: 2.6, h: 1.5, kind: 1 }];
}
function townModel(b, S, st, R) {
  const banners = [];
  buildHouses(S, st, R); // houses have their own meshes and shader (04e_houses.js)
  for (const h of S.houses) {
    if (h.kind === 'hall') {
      // castles: the hall's banners hang from crossbars on their own poles out in front, clear of the eaves,
      // the door and the shutters, free to stream with the wind (they used to hang in the air)
      const fd = (R.style === 'round' ? roundHouseR(h) : h.d / 2) + 2.3;
      for (const sd of [-1, 1]) {
        const x = h.x + Math.sin(h.yaw) * fd + Math.cos(h.yaw) * 2.2 * sd, z = h.z + Math.cos(h.yaw) * fd - Math.sin(h.yaw) * 2.2 * sd;
        const gy = heightAt(x, z), Mp = new THREE.Matrix4().compose(new THREE.Vector3(x, gy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h.yaw, 0)), new THREE.Vector3(1, 1, 1));
        b.add(G.cyl8, lm(Mp, 0, 2.3, 0, 0, 0.09, 4.8, 0.09), MAT.wood, st.wood, gy, 2);
        b.add(G.cyl8, lm(Mp, 0, 4.42, 0.1, 0, 0.05, 1.5, 0.05, 0, Math.PI / 2), MAT.wood, darker(st.wood, 0.85));
        b.add(G.cone8, lm(Mp, 0, 4.86, 0, 0, 0.12, 0.25, 0.12), MAT.gold, [0.75, 0.6, 0.3]);
        S.colliders.push(addCircle(x, z, 0.16, 'post', 4.8));
        // the cloth hangs in front of the pole and only ever billows away from it
        banners.push({ world: true, x: x + Math.sin(h.yaw) * 0.17, y: gy + 4.38, z: z + Math.cos(h.yaw) * 0.17, yaw: h.yaw, w: 1.3, h: 2.4, kind: 0 });
      }
    }
  }
  for (const p of S.props || []) propModel(b, p, st, R);
  const M = siteMatrix(S);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + TAU / 12;
    const x = Math.sin(a) * 5.6, z = Math.cos(a) * 5.6;
    b.add(G.box, lm(M, x, 1.3, z, a, 1.0, 3.4, 0.7), MAT.stone, [0.5, 0.52, 0.55], S.y, 3);
    b.add(G.box, lm(M, x - Math.sin(a) * 0.36, 1.5, z - Math.cos(a) * 0.36, a, 0.24, 2.4, 0.04), MAT.rune, [0.3, 0.6, 0.7]);
  }
  b.add(G.cyl8, lm(M, 0, 0.1, 0, 0, 2.6, 0.3, 2.6), MAT.rune, [0.25, 0.5, 0.6]);
  return banners;
}

/* banners: instanced cloth with realm emblems */
const BANNER_MAX = 160;
const bannerGeo = (() => {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1, 6, 8);
  base.translate(0.5, -0.5, 0);
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.setIndex(base.index);
  g.setAttribute('aB0', new THREE.InstancedBufferAttribute(new Float32Array(BANNER_MAX * 4), 4));
  g.setAttribute('aB1', new THREE.InstancedBufferAttribute(new Float32Array(BANNER_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  return g;
})();
const bannerMat = mat({
  side: THREE.DoubleSide,
  uniforms: {
    uRealmCol: { value: [...REALMS.map((R) => new THREE.Vector3(...R.rgb)), new THREE.Vector3(0.55, 0.52, 0.46)] },
    uRealmLight: { value: [...REALMS.map((R) => new THREE.Vector3(...hex3(R.light))), new THREE.Vector3(0.85, 0.82, 0.74)] },
  },
  vertexShader: /* glsl */`
    uniform float uTime, uWind;
    uniform vec2 uWindDir;
    attribute vec4 aB0; attribute vec4 aB1;
    varying vec2 vUv; varying vec3 vW; varying float vRealm; varying float vShade;
    void main(){
      vUv = uv; vRealm = aB1.z;
      float w = aB1.x, h = aB1.y, kind = aB1.w;
      float u = position.x, v = -position.y;
      vec3 p;
      float seed = aB0.w * 3.7 + aB0.x * 0.1;
      float gust = 0.45 + 0.55 * uWind;
      float yaw = aB0.w;
      if (kind < 0.5) {
        // castles: a banner hung against a wall (or in front of its pole) billows only away from it, never into it
        float wave = (0.55 + 0.45 * sin(uTime * 1.6 + v * 3.0 + seed)) * 0.09 * v * h * gust + (0.5 + 0.5 * sin(uTime * 2.3 + u * 4.0 + seed)) * 0.03 * v;
        p = vec3((u - 0.5) * w, -v * h, wave);
        vShade = 0.85 + 0.3 * cos(uTime * 1.6 + v * 3.0 + seed) * v;
      } else {
        // a flag on a pole streams downwind from the pole (the poles stand clear of everything a flag's length around)
        yaw = atan(-uWindDir.y, uWindDir.x) + sin(uTime * 0.37 + seed) * 0.22;
        float wave = sin(uTime * (2.2 + 1.6 * uWind) - u * 5.0 + seed) * 0.16 * u * w * 0.4 * gust;
        p = vec3(u * w, -v * h * mix(1.0, 0.92, uWind) - u * (1.0 - uWind) * 0.25 * h, wave);
        vShade = 0.85 + 0.3 * cos(uTime * 3.2 - u * 5.0 + seed) * u;
      }
      float c = cos(yaw), s = sin(yaw);
      vec3 wp = aB0.xyz + vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
      vW = wp;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform vec3 uRealmCol[4], uRealmLight[4];
    varying vec2 vUv; varying vec3 vW; varying float vRealm; varying float vShade;
    float emblem(vec2 p, int r){
      if (r == 0) {
        float tri = 1.0 - abs(fract((p.x + 0.45) / 0.3) * 2.0 - 1.0);
        float crown = step(abs(p.x), 0.45) * step(-0.32, p.y) * step(p.y, -0.06 + 0.36 * tri);
        float jewel = 1.0 - step(0.06, length(p - vec2(0.0, -0.2)));
        return clamp(crown - jewel * 0.8, 0.0, 1.0);
      } else if (r == 1) {
        float ring = step(abs(length(p) - 0.36), 0.055);
        float dots = 0.0;
        for (int i = 0; i < 3; i++) { float a = float(i) * 2.094 + 1.571; dots += 1.0 - step(0.085, length(p - 0.17 * vec2(cos(a), sin(a)))); }
        return clamp(ring + dots, 0.0, 1.0);
      } else if (r == 2) {
        float a = satan(p.y, p.x);
        float rr = 0.13 + 0.32 * spow(abs(cos(a * 4.0)), 6.0);
        return 1.0 - step(rr, length(p));
      }
      return 0.0;
    }
    void main(){
      int r = int(vRealm + 0.5);
      vec3 base = uRealmCol[r], light = uRealmLight[r];
      vec2 p = vec2(vUv.x * 2.0 - 1.0, vUv.y * 2.0 - 1.0) * vec2(1.0, 1.25);
      float trim = step(0.9, abs(vUv.x * 2.0 - 1.0)) + step(0.94, abs(vUv.y * 2.0 - 1.0));
      vec3 c = mix(base, light, max(emblem(p * vec2(1.0, 1.0) - vec2(0.0, 0.0), r) * 0.92, clamp(trim, 0.0, 1.0) * 0.7));
      vec3 col = c * (uAmbient * 0.6 + uLightColor * 0.6) * vShade;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
bannerMesh.frustumCulled = false;
bannerMesh.renderOrder = 5;
const BANNERS = []; // {site, realmIndex}
function addBanner(S, spec, realm) {
  const k = BANNERS.length;
  if (k >= BANNER_MAX) return;
  let x, y, z, yaw;
  if (spec.world) { x = spec.x; y = spec.y; z = spec.z; yaw = spec.yaw; }
  else {
    const p = siteToWorld(S, spec.local[0], spec.local[2]);
    x = p.x; z = p.z; y = S.y + spec.local[1]; yaw = S.yaw + spec.yaw;
  }
  bannerGeo.attributes.aB0.array.set([x, y, z, yaw], k * 4);
  bannerGeo.attributes.aB1.array.set([spec.w, spec.h, realm, spec.kind], k * 4);
  BANNERS.push({ site: S, k });
  bannerGeo.instanceCount = BANNERS.length;
  bannerGeo.attributes.aB0.needsUpdate = true;
  bannerGeo.attributes.aB1.needsUpdate = true;
}
function setSiteBanners(S, realm) {
  for (const B of BANNERS) if (B.site === S) bannerGeo.attributes.aB1.array[B.k * 4 + 2] = realm;
  bannerGeo.attributes.aB1.needsUpdate = true;
}

/* relic objects */
const relicMat = mat({
  uniforms: { uTint: { value: new THREE.Vector3(1, 0.8, 0.35) }, uGlowAmt: { value: 1 } },
  vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN; varying vec3 vL; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vL = position; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform vec3 uTint; uniform float uGlowAmt;
    varying vec3 vW; varying vec3 vN; varying vec3 vL;
    void main(){
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      float fres = spow(1.0 - abs(dot(n, V)), 2.0);
      vec3 H = safeNormalize(uLightDir + V);
      vec3 col = uTint * (0.35 + 0.6 * clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0)) + uLightColor * spow(dot(n, H), 30.0) * 0.8;
      float runes = step(0.82, fract(vL.y * 5.0 + sin(vL.x * 9.0) * 0.2)) * step(0.5, fract(atan(vL.z, vL.x) * 2.0));
      col += uTint * (fres * 1.2 + runes * 1.4) * uGlowAmt * (0.8 + 0.2 * sin(uTime * 3.0));
      gl_FragColor = vec4(safeColor(col), 1.0);
    }`,
});
function relicMesh(kind) {
  let g;
  if (kind === 0) {
    const pts = [[0, 0], [0.32, 0], [0.32, 0.05], [0.09, 0.12], [0.06, 0.42], [0.1, 0.48], [0.3, 0.6], [0.36, 0.92], [0.33, 0.95], [0.25, 0.64], [0, 0.6]].map(([x, y]) => new THREE.Vector2(x, y));
    g = new THREE.LatheGeometry(pts, 20);
    g.translate(0, -0.45, 0);
  } else if (kind === 1) {
    g = new THREE.CapsuleGeometry(0.26, 0.7, 4, 10);
  } else {
    g = new THREE.TorusGeometry(0.38, 0.09, 10, 28);
  }
  const m = new THREE.Mesh(g, shareMat(relicMat, { uTint: { value: new THREE.Vector3(...(kind === 1 ? [0.55, 0.85, 0.95] : [1.0, 0.78, 0.32])) }, uGlowAmt: { value: 1 } }));
  m.renderOrder = 6;
  return m;
}

/* ------------------------------------------------------------------ */
/* Trees and rocks (instanced, chunked)                                */
/* ------------------------------------------------------------------ */
function treeGeometry(kind) {
  const P = [], N = [], PART = [], AO = [], idx = [];
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  const add = (geo, m4, part, aoFn, centre = null, radialMix = 0) => {
    const p = geo.attributes.position, n = geo.attributes.normal, base = P.length / 3;
    const nm = new THREE.Matrix3().getNormalMatrix(m4);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4);
      nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      if (centre) {
        const rx = v.x - centre.x, ry = v.y - centre.y, rz = v.z - centre.z, rl = Math.hypot(rx, ry, rz) || 1;
        nv.set(lerp(nv.x, rx / rl, radialMix), lerp(nv.y, ry / rl, radialMix), lerp(nv.z, rz / rl, radialMix)).normalize();
      }
      P.push(v.x, v.y, v.z); N.push(nv.x, nv.y, nv.z); PART.push(part); AO.push(aoFn(v));
    }
    const ix = geo.index;
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  };
  const M = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const trunkAO = (p) => clamp(0.55 + p.y * 0.12, 0.55, 1);
  const lobeGeo = (seed) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const d = 1 + (vnoise(v.x * 2.1 + seed, v.y * 2.1 + v.z * 1.3 - seed) - 0.5) * 0.45;
      p.setXYZ(i, v.x * d, v.y * d, v.z * d);
    }
    g.computeVertexNormals();
    return g;
  };
  if (kind === 'oak') {
    const t = new THREE.CylinderGeometry(0.2, 0.36, 3.4, 7);
    add(t, M(0, 1.6, 0, 1, 1, 1), 0, trunkAO);
    const br = new THREE.CylinderGeometry(0.06, 0.13, 2.0, 5);
    add(br, M(0.6, 3.2, 0.1, 1, 1, 1, 0.1, 0, -0.9), 0, trunkAO);
    add(br, M(-0.55, 3.3, -0.2, 1, 1, 1, -0.2, 0, 0.85), 0, trunkAO);
    const centre = new THREE.Vector3(0, 4.4, 0);
    const lobes = [[0, 4.7, 0, 2.2], [1.5, 4.1, 0.4, 1.6], [-1.4, 4.2, -0.3, 1.65], [0.3, 5.6, -0.7, 1.45], [-0.5, 3.8, 1.3, 1.45], [0.9, 3.9, -1.3, 1.35]];
    lobes.forEach(([x, y, z, r], i) => add(lobeGeo(i * 3.7), M(x, y, z, r, r * 0.86, r), 1, (p) => clamp(0.35 + 0.65 * ((p.y - 2.4) / 4.2) + 0.25 * (Math.hypot(p.x - centre.x, p.z - centre.z) / 3.2), 0.3, 1), centre, 0.55));
  } else if (kind === 'birch') {
    const t = new THREE.CylinderGeometry(0.11, 0.19, 4.6, 6);
    add(t, M(0, 2.2, 0, 1, 1, 1), 0, trunkAO);
    const centre = new THREE.Vector3(0, 5.0, 0);
    const lobes = [[0, 5.3, 0, 1.35], [0.6, 4.4, 0.3, 1.0], [-0.55, 4.6, -0.3, 1.05], [0.1, 6.2, 0.1, 0.95]];
    lobes.forEach(([x, y, z, r], i) => add(lobeGeo(i * 5.1 + 2), M(x, y, z, r, r * 1.35, r), 1, (p) => clamp(0.4 + 0.6 * ((p.y - 3.4) / 3.6), 0.35, 1), centre, 0.5));
  } else {
    const t = new THREE.CylinderGeometry(0.14, 0.26, 2.2, 6);
    add(t, M(0, 1.0, 0, 1, 1, 1), 0, trunkAO);
    const tiers = [[1.4, 2.3, 3.2], [2.75, 1.85, 2.9], [4.0, 1.4, 2.5], [5.15, 0.85, 2.1]];
    tiers.forEach(([y, r, h], i) => {
      const g = new THREE.ConeGeometry(1, 1, 10, 1, false);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        if (v.y < 0) { const a = Math.atan2(v.z, v.x); const f = 1 + 0.18 * Math.sin(a * 5 + i); p.setXYZ(k, v.x * f, v.y, v.z * f); }
      }
      g.computeVertexNormals();
      add(g, M(0, y + h / 2, 0, r, h, r, 0, i * 0.7, 0), 1, (pp) => clamp(0.35 + 0.65 * ((pp.y - 1.0) / 6.0) + 0.2 * Math.hypot(pp.x, pp.z) / r, 0.3, 1), new THREE.Vector3(0, y + h * 0.35, 0), 0.35);
    });
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(AO, 1));
  g.setIndex(idx);
  return g;
}
const treeMat = mat({
  uniforms: { uKindTint: { value: new THREE.Vector3(1, 1, 1) }, uBarkTint: { value: new THREE.Vector3(1, 1, 1) }, uBirch: { value: 0 } },
  vertexShader: /* glsl */`
    uniform float uTime, uWind;
    uniform vec3 uNearTree;
    attribute float aPart; attribute float aAO;
    attribute vec4 iPos; attribute vec2 iRot;
    varying vec3 vW; varying vec3 vN; varying float vPart; varying float vAO; varying float vTint; varying vec3 vLocal; varying float vFadeFar;
    void main(){
      vFadeFar = smoothstep(uNearTree.z - 3.5, uNearTree.z, distance(iPos.xz, uNearTree.xy));
      if (vFadeFar <= 0.0) { vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vPart = 0.0; vAO = 1.0; vTint = 0.0; vLocal = vec3(0.0); gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
      float c = cos(iRot.x), s = sin(iRot.x);
      vec3 p = position * iPos.w;
      vec3 n = normal;
      float sway = (sin(uTime * 0.9 + iPos.x * 0.21 + iPos.z * 0.13) * 0.06 + sin(uTime * 2.1 + iPos.x) * 0.015) * uWind * smoothstep(1.5, 6.0, position.y);
      p.x += sway * p.y * 0.35; p.z += sway * p.y * 0.18;
      vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
      vec3 rn = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
      vec3 w = iPos.xyz + r;
      vW = w; vN = rn; vPart = aPart; vAO = aAO; vTint = iRot.y; vLocal = position;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_CLEARVIEW}
    ${GLSL_PLIGHT}
    uniform float uSnowCover;
    uniform vec3 uLeaf, uBark, uKindTint, uBarkTint;
    uniform float uBirch;
    varying vec3 vW; varying vec3 vN; varying float vPart; varying float vAO; varying float vTint; varying vec3 vLocal; varying float vFadeFar;
    void main(){
      if (bayer4(gl_FragCoord.xy) < 1.0 - vFadeFar) discard;
      if (bayer4(gl_FragCoord.xy + vec2(1.0, 2.0)) < viewBlock(vW)) discard;
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      vec3 col;
      float sh = shadowAt(vW, n);
      if (vPart < 0.5) {
        vec3 alb = uBark * uBarkTint * (0.8 + 0.3 * vnoise(vec2(vLocal.y * 6.0, atan(vLocal.z, vLocal.x + 1e-4) * 2.0)));
        if (uBirch > 0.5) alb *= mix(1.0, 0.25, step(0.78, vnoise(vec2(vLocal.y * 7.0, atan(vLocal.z, vLocal.x + 1e-4) * 3.0))));
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        col = alb * (0.45 + 0.75 * ndl * mix(0.35, 1.0, sh)) * vAO;
      } else {
        float leafy = fbm3(vW.xz * 1.6 + vW.y * 1.1);
        float edge = spow(1.0 - abs(dot(n, V)), 1.6);
        if (leafy < edge * 0.85 - 0.18) discard;
        // leaf clumps: relief from a little noise so the crowns are not smooth balls
        float clump = vnoise(vLocal.xz * 2.6 + vLocal.y * 1.9) * 0.6 + vnoise(vLocal.xz * 6.1 - vLocal.y * 3.3) * 0.4;
        vec3 dpx = dFdx(vW), dpy = dFdy(vW);
        float dhx = dFdx(clump), dhy = dFdy(clump);
        vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
        float det = dot(dpx, r1);
        n = safeNormalize(abs(det) * n - 0.9 * sign(det) * (dhx * r1 + dhy * r2));
        vec3 alb = uLeaf * uKindTint * (0.78 + 0.5 * vTint) * (0.72 + 0.55 * leafy) * (0.72 + 0.45 * clump);
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        float back = spow(clamp(dot(-V, uLightDir), 0.0, 1.0), 4.0);
        col = alb * (0.3 + 0.55 * vAO * mix(0.62, 1.0, sh) + 0.55 * ndl * vAO * mix(0.25, 1.0, sh)) + alb * back * 0.45 * vAO * sh;
      }
      col = mix(col, vec3(0.8, 0.83, 0.88) * (uAmbient * 0.75 + uLightColor * 0.45 * sh), uSnowCover * 0.7 * smoothstep(0.35, 0.85, n.y) * step(0.5, vPart));
      col += (vPart < 0.5 ? vec3(0.3, 0.22, 0.15) * uBarkTint : vec3(0.2, 0.3, 0.1) * uKindTint) * pointLights(vW, n) * vAO;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
const TREE_KINDS = {
  oak: { tint: [1.0, 1.0, 1.0], bark: [1, 1, 1], birch: 0 },
  birch: { tint: [1.22, 1.18, 0.82], bark: [2.6, 2.55, 2.4], birch: 1 },
  pine: { tint: [0.62, 0.86, 0.82], bark: [0.9, 0.85, 0.8], birch: 0 },
};
const treeChunks = [];
// canopies cast dappled shade: the depth pass punches holes where the foliage noise is thin
const TREE_DEPTH = depthFrom(treeMat, /* glsl */`
  ${GLSL_COMMON}
  varying vec3 vW; varying float vPart; varying float vFadeFar;
  void main(){
    if (bayer4(gl_FragCoord.xy) < 1.0 - vFadeFar) discard;
    if (vPart > 0.5 && fbm3(vW.xz * 1.6 + vW.y * 1.1) < 0.34) discard;
    gl_FragColor = vec4(1.0);
  }`);
function buildTrees() {
  const CH = 8, size = WSIZE / CH;
  const bases = {};
  for (const k of Object.keys(TREE_KINDS)) bases[k] = treeGeometry(k);
  const buckets = new Map();
  for (const t of W.trees) {
    const ci = clamp(Math.floor((t.x + HALF) / size), 0, CH - 1), cj = clamp(Math.floor((t.z + HALF) / size), 0, CH - 1);
    const key = t.kind + ':' + ci + ':' + cj;
    if (!buckets.has(key)) buckets.set(key, { kind: t.kind, ci, cj, list: [] });
    buckets.get(key).list.push(t);
  }
  for (const B of buckets.values()) {
    const base = bases[B.kind];
    const g = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'aPart', 'aAO']) g.setAttribute(name, base.attributes[name]);
    g.setIndex(base.index);
    const n = B.list.length;
    const ip = new Float32Array(n * 4), ir = new Float32Array(n * 2);
    let minY = 1e9, maxY = -1e9;
    B.list.forEach((t, i) => { ip.set([t.x, t.y - 0.15, t.z, t.s], i * 4); ir.set([t.rot, t.tint], i * 2); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y); });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(ir, 2));
    g.instanceCount = n;
    const cx = -HALF + (B.ci + 0.5) * size, cz = -HALF + (B.cj + 0.5) * size;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2 + 4, cz), size * 0.75 + 10);
    const K = TREE_KINDS[B.kind];
    const m = new THREE.Mesh(g, shareMat(treeMat, { uKindTint: { value: new THREE.Vector3(...K.tint) }, uBarkTint: { value: new THREE.Vector3(...K.bark) }, uBirch: { value: K.birch } }));
    m.userData.center = new THREE.Vector2(cx, cz);
    m.renderOrder = 2;
    scene.add(m);
    treeChunks.push(m);
    shadowCaster(m, TREE_DEPTH);
  }
}
function updateTreeVisibility(camX, camZ) {
  const lim = quality.treeDist + 64;
  for (const m of treeChunks) m.visible = m.userData.center.distanceTo(new THREE.Vector2(camX, camZ)) < lim;
}
const rockMat = mat({
  vertexShader: /* glsl */`
    attribute vec4 iPos; attribute vec4 iRot;
    varying vec3 vW; varying vec3 vN; varying float vSeed;
    void main(){
      float c = cos(iRot.x), s = sin(iRot.x);
      vec3 p = position * vec3(1.0, iRot.y, 1.0) * iPos.w;
      vec3 n = normalize(normal / vec3(1.0, max(iRot.y, 0.2), 1.0));
      vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
      vN = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
      vW = iPos.xyz + r; vSeed = iRot.z;
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    varying vec3 vW; varying vec3 vN; varying float vSeed;
    void main(){
      vec3 n = safeNormalize(vN);
      gSh = shadowAt(vW, n);
      gPL = pointLights(vW, n);
      vec3 alb = vec3(0.47, 0.46, 0.44) * (0.75 + 0.4 * fbm3(vW.xz * 0.9 + vW.y * 0.7 + vSeed * 10.0));
      float moss = smoothstep(0.45, 0.85, n.y) * smoothstep(0.35, 0.65, vnoise(vW.xz * 0.8 + vSeed));
      alb = mix(alb, vec3(0.25, 0.34, 0.12), moss * 0.7);
      gl_FragColor = vec4(safeColor(applyFog(lightSurface(alb, n, 0.85 + 0.15 * n.y), vW)), 1.0);
    }`,
});
let ROCK_DEPTH = null, BUILDING_DEPTH = null;
function buildRocks() {
  ROCK_DEPTH = ROCK_DEPTH || depthFrom(rockMat);
  BUILDING_DEPTH = BUILDING_DEPTH || depthFrom(buildingMat);
  const variants = [0, 1, 2].map((seed) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const d = 0.75 + 0.5 * vnoise(v.x * 1.7 + seed * 9, v.y * 1.7 + v.z * 1.3 + seed * 4);
      p.setXYZ(i, v.x * d, Math.max(v.y * d, -0.35), v.z * d);
    }
    g.computeVertexNormals();
    return g;
  });
  const lists = [[], [], []];
  W.rocks.forEach((r, i) => lists[i % 3].push(r));
  lists.forEach((list, vi) => {
    const base = variants[vi];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setIndex(base.index);
    const ip = new Float32Array(list.length * 4), ir = new Float32Array(list.length * 4);
    list.forEach((r, i) => { ip.set([r.x, r.y - r.s * 0.2, r.z, r.s], i * 4); ir.set([r.rot, 0.55 + r.tilt * 0.4, r.seed, 0], i * 4); });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 4));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(ir, 4));
    g.instanceCount = list.length;
    const m = new THREE.Mesh(g, rockMat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    scene.add(m);
    shadowCaster(m, ROCK_DEPTH);
  });
  // standing stones share the building shader
  const b = new Batch();
  for (const s of W.stones) {
    const M = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(s.tilt, s.rot, s.tilt * 0.5)), new THREE.Vector3(1, 1, 1));
    b.add(G.box, lm(M, 0, 1.4 * s.s, 0, 0, 1.1 * s.s, 3.6 * s.s, 0.7 * s.s), MAT.stone, [0.56, 0.57, 0.53], s.y, 3);
  }
  if (b.n) { const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); shadowCaster(m, BUILDING_DEPTH); }
}

/* ------------------------------------------------------------------ */
/* The lone tree (from the meadow demo)                                */
/* ------------------------------------------------------------------ */
function buildHeroTree() {
  const T = W.heroTree;
  const group = new THREE.Group();
  group.position.set(T.x, T.y - 0.2, T.z);
  group.scale.setScalar(1.35);
  const barkMat = mat({
    vertexShader: /* glsl */`varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = mat3(modelMatrix) * normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      ${GLSL_SHADOW}
      varying vec3 vW; varying vec3 vN;
      uniform vec3 uBark;
      void main(){ vec3 n = safeNormalize(vN); float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0) * mix(0.3, 1.0, shadowAt(vW, n)); gl_FragColor = vec4(safeColor(applyFog(uBark * (0.6 + 0.6 * ndl), vW)), 1.0); }`,
  });
  const branch = (points, r0, r1) => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, 16, 1, 7, false);
    const pos = geo.attributes.position, nrm = geo.attributes.normal;
    for (let i = 0; i < 17; i++) {
      const c = curve.getPointAt(i / 16), r = lerp(r0, r1, i / 16);
      for (let j = 0; j < 8; j++) { const k = i * 8 + j; pos.setXYZ(k, c.x + nrm.getX(k) * r, c.y + nrm.getY(k) * r, c.z + nrm.getZ(k) * r); }
    }
    return geo;
  };
  for (const g of [
    branch([[0, -0.4, 0], [0.05, 1.0, 0.02], [0.12, 2.0, 0.0], [0.3, 2.9, -0.05]], 0.27, 0.15),
    branch([[0.12, 1.7, 0], [0.8, 2.3, 0.15], [1.6, 2.95, 0.2], [2.2, 3.4, 0.1]], 0.1, 0.035),
    branch([[0.08, 2.2, 0], [-0.7, 2.7, 0.2], [-1.7, 3.2, 0.25], [-2.5, 3.6, 0.2]], 0.09, 0.03),
    branch([[0.25, 2.7, 0], [0.4, 3.6, -0.1], [0.7, 4.6, -0.2], [0.9, 5.4, -0.2]], 0.1, 0.03),
    branch([[0.2, 2.5, 0], [-0.3, 3.4, -0.2], [-0.9, 4.2, -0.3]], 0.07, 0.025),
  ]) group.add(new THREE.Mesh(g, barkMat));
  const barkDepth = depthFrom(barkMat);
  for (const c of group.children) shadowCaster(c, barkDepth);
  const LOBES = [[-2.7, 3.35, 0.3, 1.95, 1.35, 1.6], [-1.7, 3.95, -0.2, 1.35, 1.25, 1.3], [1.35, 3.85, 0.0, 2.75, 2.45, 2.3], [0.55, 5.35, -0.2, 1.55, 1.15, 1.4], [2.45, 5.0, -0.1, 1.45, 1.25, 1.3], [2.75, 2.5, 0.3, 1.5, 1.3, 1.35], [-0.4, 3.0, 0.7, 1.2, 1.0, 1.1]];
  const R = mulberry(321), N = 5200;
  const aLeaf = new Float32Array(N * 4), aLeaf2 = new Float32Array(N * 4), aAO = new Float32Array(N);
  const vol = LOBES.map((l) => l[3] * l[4] * l[5]), vsum = vol.reduce((a, b) => a + b, 0);
  for (let i = 0; i < N; i++) {
    let u = R() * vsum, li = 0;
    while (u > vol[li]) { u -= vol[li]; li++; }
    const [cx, cy, cz, rx, ry, rz] = LOBES[li];
    let x, y, z, l2;
    do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; l2 = x * x + y * y + z * z; } while (l2 > 1 || l2 < 0.0001);
    const l = Math.sqrt(l2), rr = Math.pow(l, 0.35), nx = x / l, ny = y / l, nz = z / l;
    aLeaf.set([cx + nx * rr * rx, cy + ny * rr * ry, cz + nz * rr * rz, 0.34 + 0.22 * R()], i * 4);
    aLeaf2.set([nx, ny * 0.8 + 0.25, nz, R()], i * 4);
    aAO[i] = clamp(0.25 + 0.75 * rr * (0.65 + 0.35 * (ny * 0.5 + 0.5)), 0, 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  g.setIndex(quad.index);
  g.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(aLeaf, 4));
  g.setAttribute('aLeaf2', new THREE.InstancedBufferAttribute(aLeaf2, 4));
  g.setAttribute('aAO', new THREE.InstancedBufferAttribute(aAO, 1));
  g.instanceCount = N;
  const leafMat = mat({
    side: THREE.DoubleSide,
    uniforms: { uTreeMat: { value: new THREE.Matrix4() } },
    vertexShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uTime, uWind;
      attribute vec4 aLeaf; attribute vec4 aLeaf2; attribute float aAO;
      varying vec2 vUv; varying vec3 vW; varying vec3 vNrm; varying float vAO; varying float vSeed;
      void main(){
        float seed = aLeaf2.w;
        float a1 = seed * 6.2831, a2 = fract(seed * 7.31) * 3.1416;
        vec3 rn = vec3(cos(a1) * sin(a2), cos(a2), sin(a1) * sin(a2));
        vec3 nn = safeNormalize(aLeaf2.xyz * 0.7 + rn);
        vec3 tx = safeNormalize(cross(nn, vec3(0.001, 1.0, 0.0)));
        vec3 ty = cross(tx, nn);
        float rot = fract(seed * 3.7) * 6.2831;
        vec3 ax = tx * cos(rot) + ty * sin(rot), ay = -tx * sin(rot) + ty * cos(rot);
        vec3 p = aLeaf.xyz;
        float sway = sin(uTime * 0.9 + p.x * 0.3) * 0.05 * (p.y / 6.0) + sin(uTime * 2.7 + seed * 40.0) * 0.012;
        p.x += sway * uWind; p.z += sway * 0.4 * uWind;
        vec3 local = p + (ax * position.x + ay * position.y) * aLeaf.w;
        vec4 w = modelMatrix * vec4(local, 1.0);
        vUv = uv; vW = w.xyz; vNrm = mat3(modelMatrix) * (aLeaf2.xyz * 0.8 + nn * 0.2); vAO = aAO; vSeed = seed;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      ${GLSL_SHADOW}
      uniform vec3 uLeaf;
      varying vec2 vUv; varying vec3 vW; varying vec3 vNrm; varying float vAO; varying float vSeed;
      void main(){
        vec2 q = vUv * 2.0 - 1.0;
        if (abs(q.x) > 0.66 * (1.0 - q.y * q.y)) discard;
        vec3 n = safeNormalize(vNrm);
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 alb = uLeaf * (0.78 + 0.44 * fract(vSeed * 91.7));
        float sh = shadowAt(vW, n);
        vec3 col = alb * (0.32 + 0.45 * vAO * mix(0.65, 1.0, sh) + 0.5 * ndl * vAO * mix(0.25, 1.0, sh));
        vec3 V = safeNormalize(cameraPosition - vW);
        col += alb * spow(dot(-V, uLightDir), 4.0) * 0.4 * vAO * sh;
        gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
      }`,
  });
  const leaves = new THREE.Mesh(g, leafMat);
  leaves.frustumCulled = false;
  group.add(leaves);
  scene.add(group);
  group.updateMatrixWorld(true);
  shadowCaster(leaves, depthFrom(leafMat, /* glsl */`
    varying vec2 vUv;
    void main(){ vec2 q = vUv * 2.0 - 1.0; if (abs(q.x) > 0.66 * (1.0 - q.y * q.y)) discard; gl_FragColor = vec4(1.0); }`));
}

/* ------------------------------------------------------------------ */
/* Assemble all structures                                             */
/* ------------------------------------------------------------------ */
const SITE_MESHES = [];
function buildStructures() {
  scene.add(bannerMesh);
  for (const R of REALMS) {
    const st = STYLE[R.style];
    for (const S of R.keepSites) {
      const b = new Batch();
      const banners = R.style === 'round' ? keepRound(b, S, st, R) : R.style === 'timber' ? keepTimber(b, S, st, R) : keepStone(b, S, st, R);
      const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); SITE_MESHES.push(m); CASTLE_KEEP_MESH.set(S, m); // castles: breaches cut this mesh (04g_castles.js)
      for (const sp of banners) addBanner(S, sp, R.id);
    }
    {
      const S = R.templeSite, b = new Batch();
      const banners = templeModel(b, S, st, R);
      const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); SITE_MESHES.push(m);
      for (const sp of banners) addBanner(S, sp, R.id);
    }
    {
      const S = R.musterSite, b = new Batch();
      const banners = musterModel(b, S, st, R);
      const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); SITE_MESHES.push(m);
      for (const sp of banners) addBanner(S, sp, R.id);
    }
    {
      const S = R.town, b = new Batch();
      const banners = townModel(b, S, st, R);
      const m = new THREE.Mesh(b.build(), buildingMat); m.renderOrder = 1; scene.add(m); SITE_MESHES.push(m);
      for (const sp of banners) addBanner(S, sp, R.id);
    }
  }
  BUILDING_DEPTH = BUILDING_DEPTH || depthFrom(buildingMat);
  for (const m of SITE_MESHES) shadowCaster(m, BUILDING_DEPTH);
  buildCastles(); // castles: hinged gates, stairs, wall walks, parapets, breaches (04g_castles.js)
  buildFireProps();
}
