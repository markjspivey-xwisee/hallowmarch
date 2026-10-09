/* ================================================================== */
/* near trees: bark, branches and leaf-cluster cards close to the camera */
/* (the chunked far trees fade out where these fade in)                 */
/* ================================================================== */
// parts: 0 bark, 1 leaf card, 2 needle card, 3 inner foliage core
function nearTreeGeometry(kind) {
  const P = [], N = [], PART = [], AO = [], UV = [], SEED = [], idx = [];
  const rnd = mulberry(kind === 'oak' ? 11 : kind === 'birch' ? 23 : 37);
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  const push = (p, n, part, ao, u, w, seed) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); PART.push(part); AO.push(ao); UV.push(u, w); SEED.push(seed); return P.length / 3 - 1; };
  const addGeo = (geo, m4, part, aoFn) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m4);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m4);
      nv.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize();
      idx.push(push([v.x, v.y, v.z], [nv.x, nv.y, nv.z], part, aoFn(v), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, 0));
    }
  };
  // a tapered tube along a curve; the bark keeps its seams on the far side
  const limb = (pts, r0, r1, segs = 7, rings = 10) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const geo = new THREE.TubeGeometry(curve, rings, 1, segs, false);
    const pos = geo.attributes.position, nrm = geo.attributes.normal;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, c = curve.getPointAt(t);
      const flare = i === 0 && pts[0][1] < 0.2 ? 1.25 : 1;
      const r = lerp(r0, r1, Math.pow(t, 0.8)) * flare;
      for (let j = 0; j <= segs; j++) { const k = i * (segs + 1) + j; pos.setXYZ(k, c.x + nrm.getX(k) * r, c.y + nrm.getY(k) * r, c.z + nrm.getZ(k) * r); }
    }
    addGeo(geo, new THREE.Matrix4(), 0, (p) => clamp(0.5 + p.y * 0.1, 0.5, 1));
  };
  // a card: centre c, outward normal n, size s; faces roughly along n with some spin
  const card = (c, n, s, part, ao, stretch = 1, spin = null, tilt = null) => {
    let nn = V3.norm(n);
    if (tilt) nn = V3.norm(V3.add(nn, tilt));
    let t = V3.cross(nn, [0, 1, 0]);
    if (V3.len(t) < 0.1) t = [1, 0, 0];
    t = V3.norm(t);
    const b = V3.cross(t, nn);
    const a = spin ?? rnd() * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const ax = V3.add(V3.mul(t, ca), V3.mul(b, sa)), ay = V3.add(V3.mul(t, -sa), V3.mul(b, ca));
    const hx = s * 0.5 * stretch, hy = s * 0.5;
    const seed = rnd();
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => push(V3.add(c, V3.add(V3.mul(ax, x * hx), V3.mul(ay, y * hy))), n, part, ao, (x + 1) / 2, (y + 1) / 2, seed));
    idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  };
  // a needle spray: a quad from the trunk out along a drooping branch, its face turned up
  const spray = (root, tip, Wd, ao) => {
    const along = V3.norm(V3.sub(tip, root));
    let side = V3.cross(along, [0, 1, 0]);
    if (V3.len(side) < 0.1) side = [1, 0, 0];
    side = V3.norm(side);
    const up = V3.norm(V3.cross(side, along));
    const seed = rnd();
    const c = [V3.sub(root, V3.mul(side, Wd * 0.2)), V3.sub(tip, V3.mul(side, Wd * 0.5)), V3.add(tip, V3.mul(side, Wd * 0.5)), V3.add(root, V3.mul(side, Wd * 0.2))];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const q = c.map((p, j) => push(p, V3.norm(V3.add(up, V3.mul(along, 0.3))), 2, ao, uv[j][0], uv[j][1], seed));
    idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  };
  const canopy = (lobes, total, size, centre) => {
    const area = lobes.map((l) => l[3] * l[3]), sum = area.reduce((a, b) => a + b, 0);
    lobes.forEach(([x, y, z, r, sy = 0.86]) => {
      const n = Math.round(total * (r * r) / sum);
      for (let i = 0; i < n; i++) {
        // points on and just inside the lobe, more of them on the outside
        const u = rnd() * 2 - 1, th = rnd() * TAU, s2 = Math.sqrt(1 - u * u);
        const d = [s2 * Math.cos(th), u, s2 * Math.sin(th)];
        const rr = r * (0.62 + 0.38 * Math.sqrt(rnd()));
        const p = [x + d[0] * rr, y + d[1] * rr * sy, z + d[2] * rr];
        const out = V3.norm(V3.add(V3.mul(V3.norm(V3.sub(p, centre)), 0.55), V3.mul(d, 0.45)));
        const ao = clamp(0.45 + 0.55 * ((p[1] - centre[1] + r) / (2.4 * r)) + 0.25 * (rr / r - 0.6), 0.3, 1);
        card(p, out, size * (0.8 + 0.45 * rnd()), 1, ao);
      }
      // a darker core so the canopy never reads hollow
      const core = new THREE.IcosahedronGeometry(1, 1);
      addGeo(core, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(r * 0.56, r * 0.56 * sy, r * 0.56)), 3, (q) => clamp(0.45 + 0.4 * (q.y - centre[1]) / r, 0.3, 0.9));
    });
  };
  if (kind === 'oak') {
    limb([[0, -0.4, 0], [0.04, 1.2, 0.02], [0.1, 2.4, -0.02], [0.18, 3.4, 0.0]], 0.42, 0.2, 9, 10);
    for (const [a, b, c] of [[[0.12, 2.6, 0], [0.9, 3.4, 0.25], [1.55, 4.0, 0.4]], [[0.1, 2.9, 0], [-0.8, 3.5, -0.2], [-1.45, 4.1, -0.3]], [[0.15, 3.2, 0], [0.4, 4.4, -0.5], [0.35, 5.4, -0.7]], [[0.1, 2.7, 0], [-0.3, 3.4, 0.9], [-0.5, 3.9, 1.3]], [[0.14, 3.0, 0], [0.6, 3.5, -0.9], [0.9, 3.9, -1.3]]]) limb([a, b, c], 0.14, 0.05, 6, 6);
    const lobes = [[0, 4.7, 0, 2.2], [1.5, 4.1, 0.4, 1.6], [-1.4, 4.2, -0.3, 1.65], [0.3, 5.6, -0.7, 1.45], [-0.5, 3.8, 1.3, 1.45], [0.9, 3.9, -1.3, 1.35]];
    canopy(lobes, 360, 1.2, [0, 4.4, 0]);
  } else if (kind === 'birch') {
    limb([[0, -0.3, 0], [0.05, 2.0, 0.02], [0.0, 4.2, -0.03], [0.05, 6.2, 0.0]], 0.2, 0.06, 7, 10);
    for (const [a, b] of [[[0.04, 3.6, 0], [0.7, 4.6, 0.3]], [[0.03, 4.0, 0], [-0.6, 4.9, -0.3]], [[0.04, 4.6, 0], [0.2, 5.6, -0.5]]]) limb([a, V3.lerp(a, b, 0.5), b], 0.06, 0.025, 5, 4);
    const lobes = [[0, 5.3, 0, 1.35, 1.3], [0.6, 4.4, 0.3, 1.0, 1.3], [-0.55, 4.6, -0.3, 1.05, 1.3], [0.1, 6.2, 0.1, 0.95, 1.3]];
    canopy(lobes, 230, 0.88, [0, 5.0, 0]);
  } else {
    // pine: a straight trunk, whorls of drooping needle sprays, a dark core cone per tier
    limb([[0, -0.3, 0], [0.0, 2.5, 0.02], [0.02, 5.0, -0.02], [0, 7.4, 0]], 0.27, 0.04, 7, 10);
    const tiers = 13;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const y = lerp(1.5, 6.95, t), R = lerp(2.3, 0.42, Math.pow(t, 0.9));
      const nb = i < 4 ? 12 : i < 9 ? 10 : 7;
      for (let k = 0; k < nb; k++) {
        const a = (k / nb) * TAU + i * 0.9 + rnd() * 0.4;
        const dir = [Math.cos(a), 0, Math.sin(a)];
        const droop = 0.3 + 0.25 * rnd(), L = R * (0.92 + 0.18 * rnd()), Wd = R * 0.72;
        const root = V3.add([0, y, 0], V3.mul(dir, 0.08));
        const tip = V3.add(root, [dir[0] * L, -L * droop, dir[2] * L]);
        spray(root, tip, Wd, clamp(0.4 + 0.6 * t + 0.2 * rnd(), 0.35, 1));
      }
      const cone = new THREE.ConeGeometry(R * 0.5, R * 0.85, 9, 1, true);
      addGeo(cone, new THREE.Matrix4().compose(new THREE.Vector3(0, y + R * 0.2, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i, 0)), new THREE.Vector3(1, 1, 1)), 3, () => 0.4 + 0.4 * t);
    }
    spray([0, 6.9, 0], [0, 7.75, 0.05], 0.5, 1);
    spray([0, 6.9, 0], [0.05, 7.7, 0], 0.5, 1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(AO, 1));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(SEED, 1));
  g.setIndex(idx.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.instanceCount = 0;
  return g;
}
const NEAR_TREE_VS = /* glsl */`
  ${GLSL_COMMON}
  uniform float uTime, uWind;
  uniform vec3 uNearTree;
  attribute float aPart; attribute float aAO; attribute vec2 aUV; attribute float aSeed;
  attribute vec4 iPos; attribute vec2 iRot;
  varying vec3 vW; varying vec3 vN; varying float vPart; varying float vAO; varying float vTint; varying vec3 vLocal; varying vec2 vUV; varying float vSeed; varying float vFade;
  void main(){
    float c = cos(iRot.x), s = sin(iRot.x);
    vec3 p = position * iPos.w;
    float sway = (sin(uTime * 0.9 + iPos.x * 0.21 + iPos.z * 0.13) * 0.06 + sin(uTime * 2.1 + iPos.x) * 0.015) * uWind * smoothstep(1.5, 6.0, position.y);
    p.x += sway * p.y * 0.35; p.z += sway * p.y * 0.18;
    if (aPart > 0.5 && aPart < 2.5) {
      // leaves flutter
      float f = sin(uTime * (3.0 + aSeed * 2.0) + aSeed * 40.0 + position.y) * 0.035 * uWind;
      p += vec3(f, f * 0.6, -f * 0.8) * iPos.w;
    }
    vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
    vec3 n = normal;
    vN = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
    vW = iPos.xyz + r; vPart = aPart; vAO = aAO; vTint = iRot.y; vLocal = position; vUV = aUV; vSeed = aSeed;
    // hand over from the far trees by dithering across a band
    float d = distance(iPos.xz, uNearTree.xy);
    vFade = 1.0 - smoothstep(uNearTree.z - 3.5, uNearTree.z, d);
    gl_Position = vFade <= 0.0 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }`;
// the leaf-cluster and needle patterns on the cards
const GLSL_FOLIAGE = /* glsl */`
  float leafCluster(vec2 uv, float seed){
    vec2 c = uv * 2.0 - 1.0;
    float r = length(c);
    vec2 g = uv * 4.2 + seed * 17.0;
    vec2 cell = floor(g), f = fract(g);
    float a = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = hash22(cell + o);
      vec2 q = o + h * 0.7 + 0.15 - f;
      float ang = hash12(cell + o + 9.1) * 6.2831;
      q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * q;
      float L = 0.42 + 0.18 * h.x, Wd = 0.2 + 0.06 * h.y;
      float e = (q.x * q.x) / (L * L) + (q.y * q.y) / (Wd * Wd) * (1.0 + 0.9 * clamp(q.x / L, -1.0, 1.0));
      a = max(a, 1.0 - smoothstep(0.7, 1.0, e));
    }
    return a * (1.0 - smoothstep(0.62, 1.0, r));
  }
  float needleSpray(vec2 uv){
    float y = uv.y - 0.5;
    float w = 0.5 * (1.0 - uv.x * 0.55) * smoothstep(0.0, 0.1, uv.x) * (1.0 - smoothstep(0.9, 1.0, uv.x));
    float edge = 1.0 - smoothstep(w * 0.7, w, abs(y));
    float s = fract(uv.x * 22.0 - abs(y) * 9.0);
    float strokes = 1.0 - smoothstep(0.18, 0.42, abs(s - 0.5));
    float stem = 1.0 - smoothstep(0.015, 0.04, abs(y));
    return max(edge * mix(strokes, 1.0, smoothstep(0.35, 0.0, abs(y) / max(w, 1e-3)) * 0.5), stem * step(0.04, uv.x));
  }
`;
const nearTreeMat = mat({
  alphaToCoverage: true, side: THREE.DoubleSide,
  uniforms: { uKindTint: { value: new THREE.Vector3(1, 1, 1) }, uBarkTint: { value: new THREE.Vector3(1, 1, 1) }, uBirch: { value: 0 }, uNeedle: { value: 0 } },
  vertexShader: NEAR_TREE_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_FOLIAGE}
    ${GLSL_CLEARVIEW}
    ${GLSL_PLIGHT}
    ${GLSL_WEATHER}
    uniform vec3 uLeaf, uBark, uKindTint, uBarkTint;
    uniform float uBirch, uFoliageCut, uNeedle, uSnowCover;
    uniform float uWet; // feature/weather
    varying vec3 vW; varying vec3 vN; varying float vPart; varying float vAO; varying float vTint; varying vec3 vLocal; varying vec2 vUV; varying float vSeed; varying float vFade;
    void main(){
      if (bayer4(gl_FragCoord.xy) > vFade) discard;
      if (bayer4(gl_FragCoord.xy + vec2(1.0, 2.0)) < viewBlock(vW)) discard;
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      if (!gl_FrontFacing) n = -n;
      float sh = shadowAt(vW, n);
      vec3 col; float alpha = 1.0;
      if (vPart < 0.5) {
        // bark: fissures running up the trunk
        float ang = atan(vLocal.z, vLocal.x + 1e-4);
        float fis = vnoise(vec2(ang * 5.0, vLocal.y * 1.4)) * 0.6 + vnoise(vec2(ang * 13.0, vLocal.y * 4.0)) * 0.4;
        vec3 alb = uBark * uBarkTint * (0.7 + 0.45 * fis);
        if (uBirch > 0.5) {
          alb = vec3(0.82, 0.8, 0.74) * (0.85 + 0.2 * fis);
          float mark = step(0.72, vnoise(vec2(ang * 3.0, vLocal.y * 9.0))) * step(0.3, fract(vLocal.y * 2.3 + ang));
          alb = mix(alb, vec3(0.08, 0.07, 0.07), mark);
        }
        alb *= mix(0.55, 1.0, smoothstep(0.3, 0.6, fis));
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        col = alb * (0.4 + 0.75 * ndl * mix(0.3, 1.0, sh)) * vAO;
      } else if (vPart > 2.5) {
        // the shaded heart of the crown: clumps for broadleaves, combed needles for pines
        float pat = uNeedle > 0.5 ? vnoise(vec2(atan(vLocal.z, vLocal.x + 1e-4) * 9.0, vLocal.y * 2.2)) * 0.7 + vnoise(vec2(atan(vLocal.z, vLocal.x + 1e-4) * 31.0, vLocal.y * 6.0)) * 0.3 : vnoise(vW.xz * 3.0 + vW.y * 2.0);
        vec3 alb = uLeaf * uKindTint * (0.8 + 0.3 * vTint) * (0.62 + 0.62 * pat);
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        col = alb * (0.3 + 0.35 * vAO + 0.35 * ndl * vAO * mix(0.3, 1.0, sh));
      } else {
        float a = vPart < 1.5 ? leafCluster(vUV, vSeed) : needleSpray(vUV);
        // cards seen edge-on thin out instead of streaking
        vec3 fn = safeNormalize(cross(dFdx(vW), dFdy(vW)));
        a *= smoothstep(0.08, 0.3, abs(dot(fn, V)));
        alpha = a;
        if (a < uFoliageCut * 0.5) discard;
        float vary = hash12(floor(vUV * 3.6 + vSeed * 17.0) + 3.0);
        vec3 alb = uLeaf * uKindTint * (0.72 + 0.5 * vTint) * (0.78 + 0.4 * vary);
        if (vPart > 1.5) alb *= 0.85;
        float ndl = clamp(dot(n, uLightDir) * 0.55 + 0.45, 0.0, 1.0);
        float back = spow(clamp(dot(-V, uLightDir), 0.0, 1.0), 3.0);
        col = alb * (0.26 + 0.42 * vAO + 0.6 * ndl * vAO * mix(0.22, 1.0, sh));
        col += alb * vec3(1.15, 1.25, 0.6) * back * 0.55 * vAO * sh;
        vec3 H = safeNormalize(uLightDir + V);
        col += uLightColor * spow(dot(n, H), 24.0) * 0.08 * sh;
      }
      /* ---- weather (feature/weather): wet bark darkens, wet leaves shine, snow lies along the boughs too ---- */
      if (uWet > 0.01) { col *= 1.0 - uWet * (vPart < 0.5 ? 0.4 : 0.15); col += wetSheen(vW, n, V, uWet * (vPart < 0.5 ? 0.45 : 0.75), vPart < 0.5 ? 0.8 : 0.3, sh) * vAO; }
      if (vPart < 0.5) col = mix(col, snowAlbedo(vW) * (uAmbient * 0.75 + uLightColor * 0.45 * sh), snowAmount(vW, n, uSnowCover, vec3(0.0)) * 0.9);
      /* ---- end weather ---- */
      col = mix(col, vec3(0.8, 0.83, 0.88) * (uAmbient * 0.75 + uLightColor * 0.45 * sh), uSnowCover * 0.65 * smoothstep(0.35, 0.85, n.y) * step(0.5, vPart));
      col += (vPart < 0.5 ? vec3(0.3, 0.22, 0.15) * uBarkTint : vec3(0.2, 0.3, 0.1) * uKindTint) * pointLights(vW, n) * vAO;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), uFoliageCut < 0.1 ? clamp((alpha - 0.3) / max(fwidth(alpha), 0.05) + 0.5, 0.0, 1.0) : 1.0);
      if (uFoliageCut >= 0.1 && alpha < uFoliageCut) discard;
    }`,
});
const NEAR_TREE_DEPTH_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_FOLIAGE}
  varying float vPart; varying vec2 vUV; varying float vSeed; varying float vFade;
  void main(){
    if (bayer4(gl_FragCoord.xy) > vFade) discard;
    if (vPart > 0.5 && vPart < 2.5 && (vPart < 1.5 ? leafCluster(vUV, vSeed) : needleSpray(vUV)) < 0.5) discard;
    gl_FragColor = vec4(1.0);
  }`;
const NEAR_TREES = { kinds: {}, grid: null, cell: 24, lastX: 1e9, lastZ: 1e9, t: 0, cap: 260 };
function buildNearTrees() {
  // a coarse grid of the forest for quick neighbourhood queries
  const grid = new Map();
  W.trees.forEach((t, i) => {
    const key = Math.floor(t.x / NEAR_TREES.cell) + ',' + Math.floor(t.z / NEAR_TREES.cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  NEAR_TREES.grid = grid;
  for (const kind of Object.keys(TREE_KINDS)) {
    const K = TREE_KINDS[kind];
    const g = nearTreeGeometry(kind);
    const cap = NEAR_TREES.cap;
    const ip = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const ir = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', ip); g.setAttribute('iRot', ir);
    const m = new THREE.Mesh(g, shareMat(nearTreeMat, { uKindTint: { value: new THREE.Vector3(...K.tint) }, uBarkTint: { value: new THREE.Vector3(...K.bark) }, uBirch: { value: K.birch }, uNeedle: { value: kind === 'pine' ? 1 : 0 } }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    scene.add(m);
    shadowCaster(m, depthFrom(m.material, NEAR_TREE_DEPTH_FS));
    NEAR_TREES.kinds[kind] = { mesh: m, ip, ir, list: [] };
  }
}
// pick the trees near the camera; both tree sets read the same centre and radius so the hand-over is seamless
function updateNearTrees(dt, camX, camZ) {
  const R = quality.nearTrees || 0;
  NEAR_TREES.t -= dt;
  if (!NEAR_TREES.grid) return;
  if (R <= 0) {
    U.uNearTree.value.set(camX, camZ, -100);
    for (const k in NEAR_TREES.kinds) NEAR_TREES.kinds[k].mesh.geometry.instanceCount = 0;
    return;
  }
  const moved = Math.abs(camX - NEAR_TREES.lastX) + Math.abs(camZ - NEAR_TREES.lastZ);
  if (NEAR_TREES.t > 0 && moved < 2.5) return;
  NEAR_TREES.t = 0.35; NEAR_TREES.lastX = camX; NEAR_TREES.lastZ = camZ;
  const c = NEAR_TREES.cell, r = Math.ceil(R / c) + 1;
  const ci = Math.floor(camX / c), cj = Math.floor(camZ / c);
  for (const k in NEAR_TREES.kinds) NEAR_TREES.kinds[k].list.length = 0;
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    const cellList = NEAR_TREES.grid.get(i + ',' + j);
    if (!cellList) continue;
    for (const ti of cellList) {
      const t = W.trees[ti];
      const d = Math.hypot(t.x - camX, t.z - camZ);
      if (d < R) NEAR_TREES.kinds[t.kind].list.push([d, t]);
    }
  }
  // if a kind overflows, shrink the radius so nothing falls between the two sets
  let Reff = R;
  for (const k in NEAR_TREES.kinds) {
    const L = NEAR_TREES.kinds[k].list;
    if (L.length > NEAR_TREES.cap) { L.sort((a, b) => a[0] - b[0]); Reff = Math.min(Reff, (L[NEAR_TREES.cap - 1][0] + L[NEAR_TREES.cap][0]) / 2); }
  }
  for (const k in NEAR_TREES.kinds) {
    const K = NEAR_TREES.kinds[k];
    let n = 0;
    for (const [d, t] of K.list) {
      if (d >= Reff || n >= NEAR_TREES.cap) continue;
      K.ip.array.set([t.x, t.y - 0.15, t.z, t.s], n * 4);
      K.ir.array.set([t.rot, t.tint], n * 2);
      n++;
    }
    K.mesh.geometry.instanceCount = n;
    K.ip.needsUpdate = true; K.ir.needsUpdate = true;
  }
  U.uNearTree.value.set(camX, camZ, Reff);
}
