/* ================================================================== */
/* terrain, water, grass, flowers, trail (parting + night glow), decals */
/* ================================================================== */
const GLSL_LIGHT = /* glsl */`
float gSh = 1.0;          // how much of the sun reaches this fragment (from the shadow map)
vec3 gPL = vec3(0.0);     // fires, lanterns and spells nearby (from pointLights)
vec3 lightSurface(vec3 albedo, vec3 n, float ao){
  float ndl = dot(n, uLightDir);
  float wrap = clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
  return albedo * (uAmbient * 0.62 * ao + uLightColor * 0.72 * wrap * mix(0.55, 1.0, ao) * mix(0.2, 1.0, gSh) + gPL * mix(0.6, 1.0, ao));
}
`;

function uploadWorldTextures() {
  const hTex = new THREE.DataTexture(W.H, HN, HN, THREE.RedFormat, THREE.FloatType);
  hTex.internalFormat = 'R32F';
  hTex.minFilter = THREE.NearestFilter; hTex.magFilter = THREE.NearestFilter;
  hTex.needsUpdate = true;
  U.uHeightTex.value = hTex;
  const N2 = HN * HN;
  const A = new Uint8Array(N2 * 4), B = new Uint8Array(N2 * 4);
  for (let k = 0; k < N2; k++) {
    A[k * 4] = W.road[k] * 255; A[k * 4 + 1] = W.grass[k] * 255; A[k * 4 + 2] = W.flower[k] * 255; A[k * 4 + 3] = W.rock[k] * 255;
    B[k * 4] = W.realmW[k * 3] * 255; B[k * 4 + 1] = W.realmW[k * 3 + 1] * 255; B[k * 4 + 2] = W.realmW[k * 3 + 2] * 255; B[k * 4 + 3] = W.field[k] * 255;
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, HN, HN, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  U.uWorldA.value = mk(A);
  U.uWorldB.value = mk(B);
}

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */
const terrainMat = mat({
  vertexShader: /* glsl */`
    varying vec3 vW; varying vec3 vN;
    void main(){ vW = position; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_WORLD}
    ${GLSL_DECAL}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_LIGHT}
    ${GLSL_NATURE}
    uniform sampler2D uTrail;
    uniform vec4 uTrailBounds;
    uniform vec3 uGrassBase, uGrassTip, uGlowColor;
    uniform float uWet, uSnowCover;
    varying vec3 vW; varying vec3 vN;
    float ridged(vec2 p){ return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }
    // rock relief on one projection plane: broad slabs, cracks, grit (fine terms fade with distance)
    float rockRelief(vec2 p, float fine){
      float h = ridged(p * 0.32) * 0.46 + vnoise(p * 0.9 + 3.1) * 0.22;
      h += ridged(p * 2.3 + 7.7) * 0.2 * fine;
      h += vnoise(p * 8.0) * 0.12 * fine;
      return h;
    }
    // perturb a normal by the screen-space slope of a height field
    vec3 bumpN(vec3 n, vec3 p, float h, float k){
      vec3 dpx = dFdx(p), dpy = dFdy(p);
      float dhx = dFdx(h), dhy = dFdy(h);
      vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
      float det = dot(dpx, r1);
      vec3 g = sign(det) * (dhx * r1 + dhy * r2);
      return safeNormalize(abs(det) * n - k * g);
    }
    void main(){
      vec3 n = safeNormalize(vN);
      gSh = shadowAt(vW, n);
      gPL = pointLights(vW, n);
      vec2 uv = worldUV(vW.xz);
      vec4 A = texture(uWorldA, uv);
      vec4 B = texture(uWorldB, uv);
      float d = distance(vW, cameraPosition);
      float fine = 1.0 - smoothstep(35.0, 110.0, d);
      vec3 tint = realmTint(B.rgb);
      float wrap = clamp(dot(n, uLightDir) * 0.6 + 0.4, 0.0, 1.0);
      float nz = vnoise(vW.xz * 0.35);
      vec3 gCol = mix(uGrassBase, uGrassTip, 0.5 + 0.12 * smoothstep(25.0, 90.0, d)) * tint;
      gCol *= (0.82 + 0.3 * nz) * (0.78 + 0.32 * wrap) * mix(0.58, 1.0, gSh);
      gCol = mix(gCol, mix(uGrassBase, uGrassTip, 0.22) * tint, A.g * (1.0 - smoothstep(25.0, 60.0, d)) * 0.55);
      gCol += vec3(0.15, 0.27, 0.07) * tint * gPL * 0.9;
      vec3 col = gCol;
      // wheat
      vec3 wheat = lightSurface(vec3(0.78, 0.62, 0.27) * (0.85 + 0.3 * nz), n, 1.0);
      col = mix(col, wheat, B.a * 0.85);
      // bare earth and roads: pebbles and ruts with a little relief
      // fine detail fades out before it is smaller than a pixel
      float px = length(fwidth(vW.xz));
      float pebF = 1.0 - smoothstep(0.03, 0.09, px), gritF = 1.0 - smoothstep(0.05, 0.14, px);
      float peb = smoothstep(0.62, 0.8, vnoise(vW.xz * 6.5)) * pebF;
      float grit = vnoise(vW.xz * 2.2) * 0.6 + mix(0.2, vnoise(vW.xz * 9.0) * 0.4, gritF);
      vec3 ne = bumpN(n, vW, grit * 0.5 + peb * 0.6, 0.35 * fine);
      vec3 earth = lightSurface(vec3(0.33, 0.27, 0.19) * (0.78 + 0.4 * grit) + peb * vec3(0.12, 0.11, 0.1), ne, 1.0);
      col = mix(col, earth, (1.0 - A.g) * (1.0 - A.r) * (1.0 - A.a) * 0.75);
      float rut = vnoise(vW.xz * vec2(2.4, 0.7)) * 0.25;
      vec3 dirt = lightSurface(vec3(0.46, 0.37, 0.26) * (0.8 + 0.3 * grit - rut) + peb * vec3(0.1, 0.09, 0.08), ne, 1.0);
      col = mix(col, dirt, smoothstep(0.05, 0.6, A.r));
      // rock: projected on the axes the face looks along, with strata on steep faces and cracks
      float rk = smoothstep(0.15, 0.6, A.a);
      if (rk > 0.001) {
        vec3 w = n * n; w *= w; w /= (w.x + w.y + w.z);
        float hR = rockRelief(vW.zy, fine) * w.x + rockRelief(vW.xz, fine) * w.y + rockRelief(vW.xy, fine) * w.z;
        float steep = 1.0 - smoothstep(0.55, 0.85, n.y);
        // bedding planes: warped, broken up, and quieter with distance so far slopes do not stripe
        float warp = vnoise(vW.xz * 0.045) * 9.0 + vnoise(vW.xz * 0.17 + 4.0) * 2.5;
        float strata = 0.5 + 0.5 * sin((vW.y + warp) * 1.3);
        strata *= 0.55 + 0.45 * vnoise(vec2(vW.x + vW.z, vW.y * 0.5) * 0.21);
        hR = mix(hR, hR * 0.72 + strata * 0.28, steep * (0.25 + 0.75 * fine));
        vec3 nr = bumpN(n, vW, hR, 0.55 * (0.35 + 0.65 * fine));
        vec3 rc = mix(vec3(0.38, 0.37, 0.35), vec3(0.56, 0.54, 0.5), mix(0.5, smoothstep(0.2, 0.75, hR), 0.45 + 0.55 * fine));
        rc *= tint * vec3(1.02, 1.0, 0.97) * (0.86 + 0.24 * fbm3(vW.xz * 0.05 + vW.y * 0.03));
        float crack = 1.0 - smoothstep(0.08, 0.3, hR);
        rc *= 1.0 - 0.45 * crack * (0.25 + 0.75 * fine);
        // moss on ledges facing the sky, lichen freckles
        float moss = smoothstep(0.5, 0.9, nr.y) * smoothstep(0.35, 0.7, vnoise(vW.xz * 0.45 + 2.0)) * (0.55 + 0.45 * B.g);
        rc = mix(rc, vec3(0.22, 0.3, 0.12) * tint, moss * (0.4 + 0.35 * fine));
        float lich = smoothstep(0.7, 0.78, vnoise(vW.zy * 3.1) * w.x + vnoise(vW.xz * 3.1) * w.y + vnoise(vW.xy * 3.1) * w.z) * fine * (1.0 - moss);
        rc = mix(rc, mix(vec3(0.62, 0.58, 0.36), vec3(0.62, 0.42, 0.22), B.r), lich * 0.5);
        vec3 rockCol = lightSurface(rc, nr, mix(0.55, 1.0, smoothstep(0.05, 0.4, hR)));
        // cool sky light on faces turned up, a warm bounce from below
        rockCol += rc * uAmbient * 0.12 * nr.y;
        col = mix(col, rockCol, rk);
      }
      // snow, shore
      float snow = smoothstep(26.0, 34.0, vW.y + nz * 4.0) * smoothstep(0.55, 0.8, n.y) * (0.35 + 0.65 * B.b);
      if (snow > 0.001) {
        float sh2 = vnoise(vW.xz * 1.7) * 0.5 + vnoise(vW.xz * 6.0) * 0.5 * fine;
        vec3 ns = bumpN(n, vW, sh2, 0.15 * fine);
        vec3 sc = lightSurface(vec3(0.9, 0.92, 0.96), ns, 1.0);
        vec3 V = safeNormalize(cameraPosition - vW);
        sc += uLightColor * 0.5 * step(0.985, vnoise(vW.xz * 40.0)) * fine * gSh * max(dot(ns, safeNormalize(uLightDir + V)), 0.0);
        col = mix(col, sc, snow);
      }
      float shore = 1.0 - smoothstep(-3.25, -2.6, vW.y);
      col = mix(col, lightSurface(vec3(0.56, 0.5, 0.38) * (0.85 + 0.3 * grit), ne, 1.0), shore * 0.8);
      // weather: rain darkens and glosses the ground and pools on paths; snow settles on open ground
      if (uWet > 0.01) {
        vec3 V = safeNormalize(cameraPosition - vW);
        float flatK = smoothstep(0.7, 0.96, n.y);
        float puddle = smoothstep(0.58, 0.72, vnoise(vW.xz * 0.33) * 0.7 + vnoise(vW.xz * 1.4) * 0.3) * smoothstep(0.15, 0.55, A.r + (1.0 - A.g) * 0.35) * flatK * uWet;
        col *= 1.0 - 0.28 * uWet;
        float fres = 0.02 + 0.98 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 Rv = reflect(-V, n);
        vec3 sk = skyBase(safeNormalize(vec3(Rv.x, max(Rv.y, 0.03), Rv.z)));
        col = mix(col, sk * 0.85 + gPL * 0.4, clamp(fres * 0.45 * uWet * flatK + puddle * 0.8, 0.0, 1.0));
      }
      if (uSnowCover > 0.01) {
        float sn = uSnowCover * smoothstep(0.5, 0.85, n.y) * smoothstep(0.3, 0.6, vnoise(vW.xz * 0.6) * 0.55 + 0.25 + uSnowCover * 0.5 - A.r * 0.45);
        sn *= 1.0 - smoothstep(0.1, 0.5, dot(gPL, vec3(0.33))); // feature/weather: melted round fires and torches
        col = mix(col, lightSurface(vec3(0.88, 0.9, 0.95), n, 1.0), clamp(sn, 0.0, 1.0));
      }
      /* nature (05h_nature.js): clippings on cut turf, thrown earth round craters, ash and embers where fire passed */
      vec4 nat = natureAt(vW.xz);
      if (nat.r + nat.g + nat.b + nat.a > 0.004) {
        vec2 cq = vW.xz * 6.0, cc = floor(cq), cf = fract(cq) - 0.5;
        float ca = hash12(cc) * 6.2831;
        vec2 cd = vec2(cos(ca), sin(ca));
        float stroke = (1.0 - smoothstep(0.035, 0.085, abs(dot(cf, vec2(-cd.y, cd.x))))) * (1.0 - smoothstep(0.22, 0.4, abs(dot(cf, cd)))) * step(0.4, hash12(cc + 7.3));
        vec3 clip = mix(vec3(0.42, 0.52, 0.17), vec3(0.66, 0.62, 0.3), hash12(cc + 3.1)) * tint;
        col = mix(col, col * vec3(1.08, 1.05, 0.84), nat.r * 0.3 * A.g);
        col = mix(col, lightSurface(clip, n, 1.0), stroke * nat.r * A.g * (0.35 + 0.6 * fine));
        float clod = vnoise(vW.xz * 2.6) * 0.6 + vnoise(vW.xz * 8.0) * 0.4 * fine;
        vec3 soil = lightSurface(vec3(0.21, 0.16, 0.11) * (0.62 + 0.7 * clod), bumpN(n, vW, clod, 0.6 * fine), mix(0.7, 1.0, clod));
        col = mix(col, soil, smoothstep(0.04, 0.55, nat.a));
        float ash = vnoise(vW.xz * 1.3) * 0.55 + vnoise(vW.xz * 5.0) * 0.45;
        vec3 burnt = lightSurface(mix(vec3(0.028, 0.025, 0.022), vec3(0.24, 0.23, 0.22), smoothstep(0.58, 0.86, ash) * (1.0 - nat.b)), n, 1.0);
        col = mix(col, burnt, smoothstep(0.02, 0.6, nat.g) * 0.94);
        float emb = smoothstep(0.42, 0.82, vnoise(vW.xz * 3.4 + vec2(uTime * 0.6, -uTime * 0.4)) * 0.7 + vnoise(vW.xz * 11.0) * 0.3);
        col += vec3(2.1, 0.62, 0.12) * nat.b * (0.06 + 1.0 * emb * emb);
      }
      /* nature: end */
      // decals and the night glow of trampled paths
      col = applyDecal(col, sampleDecal(vW.xz));
      vec2 tuv = (vW.xz - uTrailBounds.xy) / uTrailBounds.zw;
      if (tuv.x > 0.0 && tuv.y > 0.0 && tuv.x < 1.0 && tuv.y < 1.0) {
        float g = clamp(texture(uTrail, tuv).a, 0.0, 1.0) * uNight;
        col = mix(col, uGlowColor * 0.32, g * 0.6);
      }
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
const terrainChunks = [];
function buildTerrain() {
  const CH = 8, CELLS = 64; // 8x8 chunks of 64 cells (2 m)
  for (let cj = 0; cj < CH; cj++) {
    for (let ci = 0; ci < CH; ci++) {
      const n = CELLS + 1;
      const pos = new Float32Array(n * n * 3), nrm = new Float32Array(n * n * 3);
      let minY = 1e9, maxY = -1e9;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const gi = ci * CELLS + i, gj = cj * CELLS + j;
          const x = -HALF + gi * HS, z = -HALF + gj * HS;
          const y = W.H[gj * HN + gi];
          const k = (j * n + i) * 3;
          pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
          const hl = W.H[gj * HN + Math.max(0, gi - 1)], hr = W.H[gj * HN + Math.min(HN - 1, gi + 1)];
          const hd = W.H[Math.max(0, gj - 1) * HN + gi], hu = W.H[Math.min(HN - 1, gj + 1) * HN + gi];
          const nx = (hl - hr) / (2 * HS), nz = (hd - hu) / (2 * HS);
          const l = Math.hypot(nx, 1, nz);
          nrm[k] = nx / l; nrm[k + 1] = 1 / l; nrm[k + 2] = nz / l;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      const idx = new Uint32Array(CELLS * CELLS * 6);
      let t = 0;
      for (let j = 0; j < CELLS; j++) {
        for (let i = 0; i < CELLS; i++) {
          const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
          // alternate the diagonal to reduce directional artefacts
          if ((i + j) & 1) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
          else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const cx = -HALF + (ci + 0.5) * CELLS * HS, cz = -HALF + (cj + 0.5) * CELLS * HS;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(CELLS, CELLS, (maxY - minY) / 2));
      const m = new THREE.Mesh(g, terrainMat);
      m.renderOrder = 1;
      scene.add(m);
      terrainChunks.push(m);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */
const waterMat = mat({
  vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_WORLD}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    uniform vec3 uLeaf;
    uniform float uRain; // feature/weather
    varying vec3 vW;
    vec2 waveGrad(vec2 q, float t){
      vec2 g = vec2(vnoise(q + vec2(t * 0.3, t * 0.2)) - 0.5, vnoise(q * 1.7 - vec2(t * 0.25, -t * 0.31)) - 0.5);
      g += vec2(vnoise(q * 4.1 + t * 0.6) - 0.5, vnoise(q * 3.7 - t * 0.5) - 0.5) * 0.45;
      g += vec2(vnoise(q * 11.0 - t * 0.9) - 0.5, vnoise(q * 9.3 + t * 1.1) - 0.5) * 0.18;
      return g;
    }
    void main(){
      float depth = ${WATER_Y.toFixed(2)} - terrainHeight(vW.xz);
      if (depth < -0.08) discard;
      vec3 V = safeNormalize(cameraPosition - vW);
      float dist = length(cameraPosition - vW);
      float t = uTime;
      vec2 g = waveGrad(vW.xz * 0.45, t) * mix(1.0, 0.4, smoothstep(30.0, 140.0, dist));
      /* ---- weather (feature/weather): rain rings spreading over the water from the drops ---- */
      if (uRain > 0.02 && dist < 70.0) {
        vec2 rg = vec2(0.0);
        for (int k = 0; k < 2; k++) {
          vec2 q = vW.xz * (k == 0 ? 1.6 : 2.7) + float(k) * 7.3;
          vec2 cell = floor(q), f = fract(q) - 0.5;
          vec2 h2 = hash22(cell + float(k) * 13.0);
          float rate = 0.8 + 0.5 * h2.x, cyc = t * rate + h2.y;
          float ph = fract(cyc), r = ph * 0.48;
          vec2 d = f - (h2 - 0.5) * 0.5;
          float l = length(d);
          float live = step(hash12(cell * 1.7 + floor(cyc) * 3.1 + float(k)), uRain);
          rg += (l > 1e-4 ? d / l : vec2(0.0)) * sin((l - r) * 42.0) * exp(-abs(l - r) * 20.0) * (1.0 - ph) * live;
        }
        g += rg * 0.8 * uRain * (1.0 - smoothstep(30.0, 70.0, dist));
      }
      vec3 n = safeNormalize(vec3(g.x * 0.17, 1.0, g.y * 0.17));
      float sh = shadowAt(vW, vec3(0.0, 1.0, 0.0));
      float fres = 0.03 + 0.97 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      vec3 R = reflect(-V, n);
      vec3 refl = skyBase(safeNormalize(vec3(R.x, max(R.y, 0.02), R.z)));
      // low reflections catch the wooded shore rather than the sky
      vec3 land = mix(uLeaf * 0.42, uHorizon * 0.5, 0.35) * (uAmbient * 0.7 + uLightColor * 0.3);
      refl = mix(refl, land, (1.0 - smoothstep(0.03, 0.2, R.y)) * 0.85);
      vec3 lit = uAmbient * 0.6 + uLightColor * 0.5 * mix(0.45, 1.0, sh);
      vec3 deep = vec3(0.02, 0.085, 0.1) * lit;
      vec3 shallow = vec3(0.17, 0.25, 0.19) * lit;
      vec3 body = mix(shallow, deep, smoothstep(0.0, 2.4, depth));
      vec3 col = mix(body, refl, clamp(fres * 0.9, 0.0, 1.0));
      // the sun's glitter path and a broad sheen
      vec3 H = safeNormalize(uLightDir + V);
      float nh = max(dot(n, H), 0.0);
      col += uLightColor * (spow(nh, 420.0) * 2.2 + spow(nh, 60.0) * 0.18) * sh;
      // foam along the shore
      float shore = 1.0 - smoothstep(0.0, 0.35, depth);
      float foam = shore * smoothstep(0.45, 0.75, vnoise(vW.xz * 2.2 + vec2(t * 0.35, -t * 0.27)) + 0.35 * sin(depth * 18.0 - t * 1.6));
      col = mix(col, shallow * 1.3, shore * 0.45);
      col = mix(col, vec3(0.85, 0.88, 0.86) * (uAmbient * 0.7 + uLightColor * 0.5), clamp(foam, 0.0, 1.0) * 0.6);
      col += (body * 1.5 + 0.06) * pointLights(vW, n) + pointLights(vW + vec3(0.0, 0.6, 0.0), reflect(-V, n)) * fres * 0.6;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
function buildWater() {
  for (const L of LAKES) {
    const g = new THREE.PlaneGeometry(L.r * 3.2, L.r * 3.2, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, waterMat);
    m.position.set(L.x, WATER_Y, L.z);
    m.renderOrder = 3;
    scene.add(m);
  }
  // natural ponds: find low basins and cover them with small water quads
  const seen = new Set();
  const cell = 32;
  for (let j = 0; j < HN; j += 4) {
    for (let i = 0; i < HN; i += 4) {
      if (W.H[j * HN + i] >= WATER_Y - 0.05) continue;
      const x = -HALF + i * HS, z = -HALF + j * HS;
      if (LAKES.some((L) => dist2(x, z, L.x, L.z) < (L.r * 1.5) ** 2)) continue;
      const key = Math.floor(x / cell) + ':' + Math.floor(z / cell);
      if (seen.has(key)) continue;
      seen.add(key);
      const g = new THREE.PlaneGeometry(cell * 1.6, cell * 1.6, 1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, waterMat);
      m.position.set(Math.floor(x / cell) * cell + cell / 2, WATER_Y, Math.floor(z / cell) * cell + cell / 2);
      m.renderOrder = 3;
      scene.add(m);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Trail: R,G push direction, B press, A glow memory (moving window)   */
/* ------------------------------------------------------------------ */
const TRAIL = { size: 64, res: 512, minX: -32, minZ: -32, prevMinX: -32, prevMinZ: -32, maxSegs: 24 };
const trailOpts = { type: RT_TYPE, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
let trailA = new THREE.WebGLRenderTarget(TRAIL.res, TRAIL.res, trailOpts);
let trailB = new THREE.WebGLRenderTarget(TRAIL.res, TRAIL.res, trailOpts);
const trailClearMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: 'void main(){ gl_FragColor = vec4(0.5, 0.5, 0.0, 0.0); }' });
const trailMat = new THREE.ShaderMaterial({
  uniforms: {
    uPrev: { value: null }, uPrevB: { value: new THREE.Vector4() }, uB: { value: new THREE.Vector4() },
    uSegs: { value: Array.from({ length: TRAIL.maxSegs }, () => new THREE.Vector4()) },
    uRads: { value: new Float32Array(TRAIL.maxSegs) }, uCount: { value: 0 },
    uDecay: { value: 0.95 }, uGlowDecay: { value: 0.9998 },
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D uPrev; uniform vec4 uPrevB, uB;
    uniform vec4 uSegs[${TRAIL.maxSegs}]; uniform float uRads[${TRAIL.maxSegs}]; uniform int uCount;
    uniform float uDecay, uGlowDecay;
    varying vec2 vUv;
    vec4 finite4(vec4 v){ return mix(v, vec4(0.0), equal(floatBitsToUint(v) & uvec4(0x7f800000u), uvec4(0x7f800000u))); }
    void main(){
      vec2 wp = uB.xy + vUv * uB.zw;
      vec2 puv = (wp - uPrevB.xy) / uPrevB.zw;
      vec4 prev = vec4(0.5, 0.5, 0.0, 0.0);
      if (puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) prev = clamp(finite4(texture2D(uPrev, puv)), 0.0, 1.0);
      vec2 push = (prev.rg * 2.0 - 1.0) * uDecay;
      float press = max(prev.b * uDecay - 0.004, 0.0);
      float glow = max(prev.a * uGlowDecay - 0.00002, 0.0);
      for (int i = 0; i < ${TRAIL.maxSegs}; i++) {
        if (i >= uCount) break;
        vec4 s = uSegs[i];
        float rad = max(uRads[i], 0.05);
        vec2 a = s.xy, b = s.zw, seg = b - a;
        float h = clamp(dot(wp - a, seg) / max(dot(seg, seg), 1e-6), 0.0, 1.0);
        vec2 diff = wp - (a + seg * h);
        float d = length(diff);
        float fall = 1.0 - smoothstep(rad * 0.2, rad, d);
        if (fall <= 0.0) continue;
        vec2 stamp = d > 1e-4 ? diff / d * fall : vec2(0.0);
        if (dot(stamp, stamp) > dot(push, push)) push = mix(push, stamp, 0.85);
        press = max(press, fall);
        glow = max(glow, smoothstep(0.0, 0.8, fall));
      }
      gl_FragColor = clamp(finite4(vec4(push * 0.5 + 0.5, press, glow)), 0.0, 1.0);
    }`,
});
pass(trailClearMat, trailA); pass(trailClearMat, trailB);
const trailSegs = [];
function trailStamp(x0, z0, x1, z1, r) {
  if (trailSegs.length >= TRAIL.maxSegs) return;
  trailSegs.push([x0, z0, x1, z1, r]);
}
function stepTrail(dt, cx, cz) {
  // re-centre the window in 4 m steps so texels stay put
  const step = 4;
  const nx = Math.round((cx - TRAIL.size / 2) / step) * step, nz = Math.round((cz - TRAIL.size / 2) / step) * step;
  const m = trailMat.uniforms;
  m.uPrevB.value.set(TRAIL.minX, TRAIL.minZ, TRAIL.size, TRAIL.size);
  TRAIL.minX = nx; TRAIL.minZ = nz;
  m.uB.value.set(nx, nz, TRAIL.size, TRAIL.size);
  m.uCount.value = trailSegs.length;
  for (let i = 0; i < trailSegs.length; i++) {
    const s = trailSegs[i];
    m.uSegs.value[i].set(s[0], s[1], s[2], s[3]);
    m.uRads.value[i] = s[4];
  }
  trailSegs.length = 0;
  m.uDecay.value = Math.exp(-dt / 0.45);
  m.uGlowDecay.value = Math.exp(-dt / 70);
  m.uPrev.value = trailA.texture;
  pass(trailMat, trailB);
  [trailA, trailB] = [trailB, trailA];
  U.uTrail.value = trailA.texture;
  U.uTrailBounds.value.set(nx, nz, TRAIL.size, TRAIL.size);
}

/* ------------------------------------------------------------------ */
/* Ground decals: blob shadows (R), target ring (G), AoE (B), ally (A) */
/* ------------------------------------------------------------------ */
const DECAL = { size: 96, res: 384, max: 220 };
const decalRT = new THREE.WebGLRenderTarget(DECAL.res, DECAL.res, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
U.uDecal.value = decalRT.texture;
const decalGeo = new THREE.InstancedBufferGeometry();
decalGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
decalGeo.setIndex([0, 1, 2, 0, 2, 3]);
const decalAttr = new THREE.InstancedBufferAttribute(new Float32Array(DECAL.max * 4), 4).setUsage(THREE.DynamicDrawUsage);
decalGeo.setAttribute('aD', decalAttr);
decalGeo.instanceCount = 0;
const decalMat = new THREE.ShaderMaterial({
  uniforms: { uB: { value: U.uDecalBounds.value }, uTime: U.uTime },
  vertexShader: /* glsl */`
    uniform vec4 uB; attribute vec4 aD; varying vec2 vL; varying float vKind;
    void main(){
      vL = position.xy; vKind = aD.w;
      vec2 wp = aD.xy + position.xy * aD.z;
      vec2 c = (wp - uB.xy) / uB.zw * 2.0 - 1.0;
      gl_Position = vec4(c, 0.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec2 vL; varying float vKind;
    void main(){
      float r = length(vL);
      if (r > 1.0) discard;
      vec4 o = vec4(0.0);
      if (vKind < 0.5) { o.r = (1.0 - smoothstep(0.25, 1.0, r)) * 0.9; }
      else {
        float ring = smoothstep(0.74, 0.86, r) * (1.0 - smoothstep(0.9, 1.0, r));
        float inner = (1.0 - smoothstep(0.0, 0.86, r)) * 0.18;
        float v = ring + inner;
        if (vKind < 1.5) o.g = v * (0.85 + 0.15 * sin(uTime * 4.0));
        else if (vKind < 2.5) o.b = v + (1.0 - smoothstep(0.0, 0.9, r)) * 0.25;
        else o.a = ring;
      }
      gl_FragColor = o;
    }`,
  blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  depthTest: false, depthWrite: false, transparent: true,
});
const decalMesh = new THREE.Mesh(decalGeo, decalMat);
decalMesh.frustumCulled = false;
const decalScene = new THREE.Scene();
decalScene.add(decalMesh);
let decalCount = 0;
function decalAdd(x, z, r, kind) {
  if (decalCount >= DECAL.max) return;
  decalAttr.array.set([x, z, r, kind], decalCount * 4);
  decalCount++;
}
function renderDecals(cx, cz) {
  const s = DECAL.size;
  const minX = Math.round((cx - s / 2) / 2) * 2, minZ = Math.round((cz - s / 2) / 2) * 2;
  U.uDecalBounds.value.set(minX, minZ, s, s);
  decalGeo.instanceCount = decalCount;
  decalAttr.needsUpdate = true;
  renderer.setRenderTarget(decalRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);
  renderer.setClearColor(0x000000, 1);
  if (decalCount) renderer.render(decalScene, fsCam);
  decalCount = 0;
}

/* ------------------------------------------------------------------ */
/* Grass: three wrapped lattices of blades that follow the camera      */
/* ------------------------------------------------------------------ */
function bladeGeometry(segments) {
  const pos = [], idx = [];
  for (let i = 0; i < segments; i++) {
    const t = Math.pow(i / segments, 0.9);
    const w = (1 - Math.pow(t, 1.5)) * (0.96 + 0.1 * Math.sin(t * Math.PI));
    pos.push(-0.5 * w, t, -1, 0.5 * w, t, 1);
  }
  pos.push(0, 1, 0);
  for (let i = 0; i < segments - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const l = (segments - 1) * 2;
  idx.push(l, l + 1, segments * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
const GRASS_VERT = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_WORLD}
  ${GLSL_BEND}
  ${GLSL_DECAL}
  ${GLSL_SHADOW_V}
  ${GLSL_NATURE}
  varying vec4 vNat; // nature: cut, burnt, burning (05h_nature.js)
  uniform float uTile, uFadeNear, uFadeFar, uInner, uWidthMul, uBladeWidth;
  uniform vec2 uCenter, uCam2;
  attribute vec2 aOff;
  attribute vec4 aRnd;
  varying vec3 vWorld; varying vec3 vN; varying vec3 vAcross; varying vec4 vInfo; varying vec4 vLook; varying vec4 vDecal; varying float vSh;
  void main(){
    vSh = 1.0; vNat = vec4(0.0);
    vWorld = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vAcross = vec3(1.0, 0.0, 0.0); vInfo = vec4(0.0); vLook = vec4(0.0); vDecal = vec4(0.0);
    vec2 base = aOff + uTile * floor((uCenter - aOff) / uTile + 0.5);
    float dcam = length(base - uCam2);
    vec2 rel = abs(base - uCenter) / (0.5 * uTile);
    // layers hand over by thinning out, not by shrinking, so no band of short grass follows the camera
    float fade = (1.0 - smoothstep(uFadeNear, uFadeFar, dcam)) * smoothstep(uInner - 4.0, uInner + 2.0, dcam);
    fade *= 1.0 - smoothstep(0.84, 0.99, max(rel.x, rel.y));
    vec2 uv = worldUV(base);
    vec4 A = texture(uWorldA, uv);
    vec4 B = texture(uWorldB, uv);
    float keep = fract(aRnd.w * 17.31 + aRnd.x * 3.7);
    if (aRnd.x > A.g * 1.02 - 0.02 || keep > fade) fade = 0.0;
    else fade = mix(0.82, 1.0, smoothstep(keep, keep + 0.25, fade));
    float H = mix(0.4, 0.92, aRnd.y) * (1.0 + 0.45 * B.a) * (1.0 - 0.45 * B.b) * fade;
    H *= 0.85 + 0.3 * vnoise(base * 0.3 + 7.0);
    float sparse = smoothstep(0.1, 0.62, A.g);
    H *= mix(0.38, 1.0, sparse); // sparse grass grows short
    /* nature (05h_nature.js): cut to stubble, licked down by flames, burnt to stubs */
    vec4 nat = natureAt(base);
    float flick = 0.55 + 0.45 * sin(uTime * (9.0 + aRnd.z * 7.0) + aRnd.w * 40.0);
    H *= mix(1.0, 0.12 + 0.12 * aRnd.y, nat.r);
    H *= mix(1.0, 0.4 + 0.35 * flick, nat.b * (1.0 - nat.g));
    H *= mix(1.0, 0.05, smoothstep(0.0, 0.5, nat.g));
    vNat = vec4(nat.r, nat.g, nat.b * flick, nat.a);
    /* nature: end */
    if (uWidthMul > 1.5 && (A.a > 0.35 || sparse < 0.2)) H = 0.0; // the wide far blades stay off thin turf and rock
    if (H < 0.03) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    float t = position.y;
    vec3 b3 = vec3(base.x, terrainHeight(base) - 0.03, base.y);
    vec2 toCam = safeNormalize2(uCam2 - base);
    float yaw = satan(toCam.y, toCam.x) + (aRnd.z - 0.5) * 2.0;
    vec2 face = vec2(cos(yaw), sin(yaw));
    vec4 tr = sampleTrail(base);
    vec2 lean = bladeLean(b3, face, aRnd.w, 1.0, tr);
    vec3 tang;
    vec3 off = bladeBend(lean, H, t, tang);
    vec3 across = vec3(-face.y, 0.0, face.x);
    float W0 = (0.05 + 0.04 * fract(aRnd.w * 7.3)) * uWidthMul * (1.0 + dcam * 0.028) * mix(1.0, uBladeWidth, 0.6) * (uWidthMul > 1.5 ? mix(0.35, 1.0, sparse) : 1.0);
    vec3 world = b3 + off + across * (position.x * W0);
    vWorld = world;
    vN = safeNormalize(cross(across, tang));
    vAcross = across;
    float bright = 0.55 + 0.6 * fract(aRnd.w * 3.7) + 0.1 * vnoise(base * 0.55);
    vInfo = vec4(t, position.z, bright, tr.a);
    vLook = vec4(realmTint(B.rgb), clamp(B.a + smoothstep(0.55, 0.85, vnoise(base * 0.07 + 3.0)) * 0.35 * B.r, 0.0, 1.0));
    vDecal = sampleDecal(base);
    vSh = dcam < uFadeFar + 4.0 ? shadowAtV(world, vec2(aRnd.z, aRnd.y) * 2.0 - 1.0) : 1.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;
const GRASS_FRAG = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_PLIGHT}
  uniform vec3 uGrassBase, uGrassTip, uGrassTrans, uGlowColor, uTargetColor, uAoeColor;
  uniform float uWet, uSnowCover;
  varying vec3 vWorld; varying vec3 vN; varying vec3 vAcross; varying vec4 vInfo; varying vec4 vLook; varying vec4 vDecal; varying float vSh;
  varying vec4 vNat; // nature: cut, burnt, burning (05h_nature.js)
  void main(){
    float t = clamp(vInfo.x, 0.0, 1.0);
    float sh = clamp(vSh, 0.0, 1.0);
    vec3 V = safeNormalize(cameraPosition - vWorld);
    vec3 n = safeNormalize(vN);
    n *= dot(n, V) < 0.0 ? -1.0 : 1.0;
    n = safeNormalize(n + vAcross * clamp(vInfo.y, -1.5, 1.5) * 0.45);
    float camDist = distance(cameraPosition, vWorld);
    vec3 alb = mix(uGrassBase, uGrassTip, smoothstep(0.02, 0.8, t)) * vLook.rgb;
    alb = mix(alb, alb * vec3(1.18, 0.82, 0.42) + vec3(0.2, 0.09, 0.01), vLook.a * smoothstep(0.15, 1.0, t));
    alb *= vInfo.z;
    alb = mix(alb * (1.0 - 0.18 * uWet), vec3(0.82, 0.85, 0.9), uSnowCover * 0.65 * smoothstep(0.3, 1.0, t));
    float ao = mix(0.08, 1.0, spow(smoothstep(0.0, 0.97, t), 1.3));
    float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
    float bd = clamp(dot(-V, uLightDir), 0.0, 1.0);
    float back = spow(bd, 7.0) * mix(1.0, 0.35, smoothstep(3.5, 12.0, camDist));
    vec3 col = alb * (0.28 + (0.4 * ndl + 0.8 * back + 0.14 * bd * bd) * mix(0.32, 1.0, sh)) * ao;
    col += uGrassTrans * back * t * t * t * 0.5 * clamp(vInfo.z, 0.0, 1.5) * vLook.rgb * sh;
    vec3 H = safeNormalize(uLightDir + V);
    col += uLightColor * spow(dot(n, H), 48.0) * (0.1 + 0.5 * uWet) * t * sh;
    col += vec3(0.17, 0.3, 0.08) * vLook.rgb * vInfo.z * pointLights(vWorld, n) * (0.35 + 0.65 * t) * ao;
    col *= 1.0 - 0.5 * vDecal.r * (1.0 - t * 0.5);
    /* nature (05h_nature.js): pale cut ends, black singed stubs, blades glowing in the fire */
    col = mix(col, col * vec3(1.3, 1.15, 0.55) + vec3(0.03, 0.03, 0.0), vNat.r * smoothstep(0.55, 1.0, t) * 0.6);
    col = mix(col, vec3(0.03, 0.026, 0.022) * (0.6 + t), clamp(vNat.g * 1.6, 0.0, 1.0));
    col += vec3(2.4, 0.8, 0.18) * vNat.b * (0.12 + 0.85 * t * t);
    /* nature: end */
    // target rings and spell areas tint the blades so they show through tall grass
    col = mix(col, uTargetColor * 1.5, clamp(vDecal.g, 0.0, 1.0) * (0.45 + 0.4 * t));
    col = mix(col, uAoeColor * 1.4, clamp(vDecal.b, 0.0, 1.0) * (0.35 + 0.4 * t));
    col = mix(col, vec3(0.5, 1.0, 0.6) * 1.3, clamp(vDecal.a, 0.0, 1.0) * (0.35 + 0.4 * t));
    float g = clamp(vInfo.w * uNight, 0.0, 1.0);
    vec3 glow = uGlowColor * (0.1 + 0.9 * spow(t, 1.25)) * (0.62 + 0.38 * ndl) * (0.8 + 0.35 * (vInfo.z - 0.8));
    col = mix(col, glow, g * 0.9);
    col += uGlowColor * g * spow(t, 4.0) * 0.18;
    gl_FragColor = vec4(safeColor(applyFog(col, vWorld)), 1.0);
  }`;
// blades per square metre fall by about 3.5x per layer, so blade width rises to keep the same coverage
const GRASS_LAYERS = [
  { tile: 34, count: 46000, segs: 5, fadeNear: 12, fadeFar: 18, inner: -10, widthMul: 1.0, ahead: 6 },
  { tile: 72, count: 62000, segs: 3, fadeNear: 29, fadeFar: 37, inner: 14, widthMul: 2.7, ahead: 20 },
  { tile: 150, count: 60000, segs: 2, fadeNear: 56, fadeFar: 72, inner: 32, widthMul: 7.5, ahead: 42 },
];
const grassMeshes = [];
function buildGrass() {
  for (const m of grassMeshes) { scene.remove(m); m.geometry.dispose(); }
  grassMeshes.length = 0;
  const rr = mulberry(4242);
  for (const L of GRASS_LAYERS) {
    const n = Math.max(1000, Math.round(L.count * quality.grass));
    const g = bladeGeometry(L.segs);
    const off = new Float32Array(n * 2), rnd = new Float32Array(n * 4);
    // stratified jitter keeps the density even
    const side = Math.ceil(Math.sqrt(n));
    for (let k = 0; k < n; k++) {
      const gx = k % side, gz = Math.floor(k / side);
      off[k * 2] = ((gx + rr()) / side) * L.tile;
      off[k * 2 + 1] = ((gz + rr()) / side) * L.tile;
      rnd[k * 4] = rr(); rnd[k * 4 + 1] = rr(); rnd[k * 4 + 2] = rr(); rnd[k * 4 + 3] = rr();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
    g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
    g.instanceCount = n;
    const m = new THREE.Mesh(g, mat({
      vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide,
      uniforms: {
        uTile: { value: L.tile }, uFadeNear: { value: L.fadeNear }, uFadeFar: { value: L.fadeFar }, uInner: { value: L.inner },
        uWidthMul: { value: L.widthMul }, uCenter: { value: new THREE.Vector2() }, uCam2: { value: new THREE.Vector2() },
      },
    }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.userData.layer = L;
    scene.add(m);
    grassMeshes.push(m);
  }
}
function updateGrassCenters(camX, camZ, fwdX, fwdZ) {
  const l = Math.hypot(fwdX, fwdZ) || 1;
  fwdX /= l; fwdZ /= l;
  for (const m of grassMeshes) {
    const L = m.userData.layer;
    m.material.uniforms.uCenter.value.set(camX + fwdX * L.ahead, camZ + fwdZ * L.ahead);
    m.material.uniforms.uCam2.value.set(camX, camZ);
  }
  for (const m of flowerMeshes) {
    m.material.uniforms.uCenter.value.set(camX + fwdX * 14, camZ + fwdZ * 14);
    m.material.uniforms.uCam2.value.set(camX, camZ);
  }
}

/* ------------------------------------------------------------------ */
/* Flowers                                                             */
/* ------------------------------------------------------------------ */
const FLOWER_PAL = {
  logres: ['#f4c63c', '#f29a3a', '#f3a0b4', '#f6f1e6', '#e9646a', '#b9a6e6'],
  eriu: ['#f6f1e6', '#f4d84c', '#b9a6e6', '#7f93dc', '#f3a0b4', '#9ad1f2'],
  thule: ['#f6f1e6', '#c9b6f2', '#8fb2ea', '#f4e27a', '#e8c4d8', '#ffffff'],
};
const flowerMeshes = [];
const flowerMat = mat({
  alphaToCoverage: true,
  uniforms: {
    uAlphaCut: { value: 0.01 },
    uPalL: { value: FLOWER_PAL.logres.map((h) => new THREE.Vector3(...hex3(h))) },
    uPalE: { value: FLOWER_PAL.eriu.map((h) => new THREE.Vector3(...hex3(h))) },
    uPalT: { value: FLOWER_PAL.thule.map((h) => new THREE.Vector3(...hex3(h))) },
    uTile: { value: 44 }, uCenter: { value: new THREE.Vector2() }, uCam2: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_WORLD}
    ${GLSL_BEND}
    ${GLSL_SHADOW_V}
    ${GLSL_NATURE}
    uniform vec3 uPalL[6], uPalE[6], uPalT[6];
    uniform float uTile, uPetals;
    uniform vec2 uCenter, uCam2;
    attribute vec2 aOff; attribute vec4 aRnd;
    varying vec2 vUv; varying vec3 vCol; varying float vGlow; varying vec3 vWorld; varying float vSeed; varying float vSh;
    void main(){
      vUv = uv; vCol = vec3(1.0); vGlow = 0.0; vWorld = vec3(0.0); vSeed = aRnd.w; vSh = 1.0;
      vec2 base = aOff + uTile * floor((uCenter - aOff) / uTile + 0.5);
      float dcam = length(base - uCam2);
      vec2 rel = abs(base - uCenter) / (0.5 * uTile);
      float fade = (1.0 - smoothstep(26.0, 33.0, dcam)) * (1.0 - smoothstep(0.86, 0.99, max(rel.x, rel.y)));
      vec4 A = texture(uWorldA, worldUV(base));
      vec4 B = texture(uWorldB, worldUV(base));
      if (aRnd.x > A.b) fade = 0.0;
      { vec4 nat = natureAt(base); if (max(nat.r, max(nat.g, nat.b)) > 0.25 + 0.5 * aRnd.y) fade = 0.0; } // nature: cut or burnt
      if (fade < 0.02) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
      int ci = int(aRnd.y * 5.99);
      float u = aRnd.z;
      vec3 c = u < B.r ? uPalL[ci] : (u < B.r + B.g ? uPalE[ci] : uPalT[ci]);
      vCol = c;
      vec3 b3 = vec3(base.x, terrainHeight(base) - 0.03, base.y);
      float stemH = (0.5 + 0.35 * fract(aRnd.w * 5.1)) * (1.0 + 0.4 * B.a);
      vec2 face = vec2(cos(aRnd.w * 6.28), sin(aRnd.w * 6.28));
      vec4 tr = sampleTrail(base);
      vec2 lean = bladeLean(b3, face, aRnd.w, 0.75, tr);
      vec3 tang;
      vec3 head = b3 + bladeBend(lean, stemH, 1.0, tang);
      vec4 mv = viewMatrix * vec4(head, 1.0);
      float size = (0.05 + 0.03 * fract(aRnd.w * 9.7)) * (1.0 + dcam * 0.02) * fade * mix(0.62, 1.0, uPetals);
      mv.xy += position.xy * size;
      vGlow = tr.a; vWorld = head;
      vSh = shadowAtV(head, vec2(0.0));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
      uniform float uAlphaCut;
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    varying vec2 vUv; varying vec3 vCol; varying float vGlow; varying vec3 vWorld; varying float vSeed; varying float vSh;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      float a = satan(p.y, p.x) + vSeed * 6.2831;
      float R = 0.6 + 0.4 * spow(abs(cos(a * 2.5)), 0.7);
      float aa = max(fwidth(r), 0.02);
      float alpha = 1.0 - smoothstep(R - aa * 1.5, R, r);
      if (!(alpha >= uAlphaCut)) discard;
      vec3 c = mix(vCol, vec3(1.0, 0.78, 0.25), (1.0 - smoothstep(0.2, 0.34, r)) * 0.9);
      vec3 col = c * (uAmbient * 0.48 + uLightColor * 0.42 * clamp(vSh, 0.0, 1.0));
      vec3 nightC = mix(vec3(0.42, 0.42, 0.56), c, 0.25) * 0.42;
      col = mix(col, nightC, uNight);
      float g = clamp(vGlow * smoothstep(0.15, 0.7, uNight), 0.0, 1.0);
      col = applyFog(col, vWorld);
      col = mix(col, vec3(2.3, 2.35, 2.25) * mix(vec3(1.0), c, 0.15), g);
      gl_FragColor = vec4(safeColor(col), clamp(alpha, 0.0, 1.0));
    }`,
});
function buildFlowers() {
  for (const m of flowerMeshes) { scene.remove(m); m.geometry.dispose(); }
  flowerMeshes.length = 0;
  const n = Math.round(11000 * quality.flowers);
  const rr = mulberry(99);
  const g = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  g.setAttribute('position', quad.attributes.position);
  g.setAttribute('uv', quad.attributes.uv);
  g.setIndex(quad.index);
  const off = new Float32Array(n * 2), rnd = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    off[k * 2] = rr() * 44; off[k * 2 + 1] = rr() * 44;
    rnd[k * 4] = rr(); rnd[k * 4 + 1] = rr(); rnd[k * 4 + 2] = rr(); rnd[k * 4 + 3] = rr();
  }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
  g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, flowerMat);
  m.frustumCulled = false;
  m.renderOrder = 4;
  scene.add(m);
  flowerMeshes.push(m);
}
