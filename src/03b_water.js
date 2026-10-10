/* ================================================================== */
/* water: the surface of the lakes, ponds and rivers                    */
/* ================================================================== */
// One mesh over every texel the water stands on (01b_water.js WATERGRID), with each vertex at the water's own height,
// so a river falls down its valley and runs into its lake as one surface (nothing overlaps, nothing flickers). The
// shore is cut per pixel where the ground rises out of the water. The water is see-through: the eye looks down
// through it to the bed (drawn by the ground shader with its caustics and wobble), the light it takes on the way
// (more the deeper it is and the flatter one looks) tints and hides the bed, and the sky, the clouds and the far shore
// are mirrored on top. Rivers carry their ripples downstream (two flow-mapped layers cross-faded), run white where they
// fall steeply, and the ripple simulation (02c_water_map.js) adds the rings bodies, fish, rain and spells make.
const waterMat = mat({
  uniforms: { uCloudLit: skyU.uCloudLit, uCloudShade: skyU.uCloudShade, uCloudCover: skyU.uCloudCover, // visual pass: clouds in the mirror
    uIceHoles: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) } }, // [water2] holes cut in the winter ice: x, z, radius, on (07d_dive.js)
  vertexShader: /* glsl */`
    attribute vec4 aW; // flow x, flow z (m/s), white water, [seasons] lake ice (0 open water .. 1 thick; 05k_seasons.js)
    varying vec3 vW; varying vec4 vF;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); w.y += smoothstep(0.1, 0.4, aW.w) * 0.05; vW = w.xyz; vF = aW; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_WORLD}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_WATER_MAP}
    ${GLSL_WEATHER}
    ${GLSL_SEASON} // [seasons] 02d_season.js
    uniform float uSnowCover;
    uniform vec3 uLeaf;
    uniform float uRain; // feature/weather
    uniform vec3 uCloudLit, uCloudShade;
    uniform float uCloudCover;
    uniform vec4 uIceHoles[4]; // [water2]
    varying vec3 vW; varying vec4 vF;
    // [water2] 1 inside a hole cut in the ice (07d_dive.js)
    float iceHole(vec2 xz){
      float h = 0.0;
      for (int i = 0; i < 4; i++) { vec4 q = uIceHoles[i]; if (q.w > 0.5) h = max(h, 1.0 - smoothstep(q.z * 0.82, q.z, length(xz - q.xy) + (vnoise(xz * 9.0) - 0.5) * 0.08)); }
      return h;
    }
    vec2 waveGrad(vec2 q, float t){
      vec2 g = vec2(vnoise(q + vec2(t * 0.3, t * 0.2)) - 0.5, vnoise(q * 1.7 - vec2(t * 0.25, -t * 0.31)) - 0.5);
      g += vec2(vnoise(q * 4.1 + t * 0.6) - 0.5, vnoise(q * 3.7 - t * 0.5) - 0.5) * 0.45;
      g += vec2(vnoise(q * 11.0 - t * 0.9) - 0.5, vnoise(q * 9.3 + t * 1.1) - 0.5) * 0.18;
      return g;
    }
    void main(){
      float bedY = terrainHeight(vW.xz);
      float depth = vW.y - bedY;
      if (depth < -0.02) discard; // the shore cuts the water
      /* ---- [water2] the surface seen from under the water (07d_dive.js): inside the window the sky and the shore show
         (the light bends up through it, and the sun blazes in it); outside it the surface is a silver mirror of the
         depths; ripples break both up; winter ice is a dim, milky ceiling with light only at the holes ---- */
      if (!gl_FrontFacing) {
        if (uUnder.x < 0.5) discard;
        float tU = uTime;
        vec2 gU = waveGrad(vW.xz * 0.45, tU) * 1.3;
        if (length(vF.xy) > 0.04) gU += waveGrad(vW.xz * 0.62 - vF.xy * tU * 0.5, tU * 0.45) * 0.8;
        if (uRippleB.w > 0.5) { float e = uRippleB.z / 256.0; gU -= vec2(rippleAt(vW.xz + vec2(e, 0.0)) - rippleAt(vW.xz - vec2(e, 0.0)), rippleAt(vW.xz + vec2(0.0, e)) - rippleAt(vW.xz - vec2(0.0, e))) / (2.0 * e) / 0.17 * 0.9; }
        vec3 nU = safeNormalize(vec3(gU.x * 0.2, -1.0, gU.y * 0.2));
        vec3 I = safeNormalize(vW - cameraPosition);
        vec3 T = refract(I, nU, 1.33);
        float inWin = dot(T, T) > 0.01 ? 1.0 : 0.0;
        float cosT = abs(T.y);
        float R = inWin > 0.5 ? 0.02 + 0.98 * spow(1.0 - cosT, 5.0) : 1.0;
        float tr = (1.0 - R) * inWin;
        float iceU = smoothstep(0.05, 0.14, vF.w) * (1.0 - iceHole(vW.xz));
        float thick = smoothstep(0.1, 0.6, vF.w);
        float dayU = 1.0 - uNight * 0.85;
        // the mirror of the depths: silvery, lit by the light scattered in the water, rippled with brighter crests
        float crest = smoothstep(0.25, 0.9, length(gU) * 1.6) * 0.6 + vnoise(vW.xz * 0.8 + tU * 0.2) * 0.4;
        vec3 mirror = uUnderCol * (1.3 + 0.9 * crest) + uLightColor * 0.045 * crest * dayU;
        vec3 glare = uLightColor * (spow(max(dot(T, uLightDir), 0.0), 90.0) * 3.0 + spow(max(dot(T, uLightDir), 0.0), 8.0) * 0.25) * dayU * inWin;
        vec3 rim = uLightColor * 0.12 * smoothstep(0.82, 1.0, 1.0 - cosT) * inWin * dayU;
        vec3 iceC = vec3(0.5, 0.64, 0.74) * (uAmbient * 0.5 + uLightColor * 0.32 * dayU) * mix(0.85, 0.32, thick) * (0.8 + 0.4 * vnoise(vW.xz * 0.7));
        vec2 qI = vW.xz * 0.32; float crk = 1.0 - smoothstep(0.0, 0.06, abs(vnoise(qI * 3.0) - 0.5));
        iceC *= 1.0 - 0.4 * crk;
        float trE = tr * (1.0 - iceU);
        vec3 surfC = mix(mirror * (1.0 - tr) + rim, iceC, iceU) + glare * (1.0 - iceU);
        float dU = length(cameraPosition - vW);
        float fU = 1.0 - exp(-dU * uUnder.z * 1.3);
        vec3 premul = surfC * (1.0 - fU) + uUnderCol * 1.25 * fU;
        float aU = 1.0 - trE * (1.0 - fU);
        gl_FragColor = vec4(safeColor(premul), clamp(aU, 0.0, 1.0));
        return;
      }
      vec3 V = safeNormalize(cameraPosition - vW);
      float dist = length(cameraPosition - vW);
      float t = uTime;
      vec2 flow = vF.xy;
      float fl = length(flow), white = vF.z;
      float far = smoothstep(30.0, 140.0, dist);
      // waves: still water has its own; running water carries two layers downstream and cross-fades them
      vec2 g = waveGrad(vW.xz * 0.45, t);
      if (fl > 0.04) {
        float p0 = fract(t * 0.32), p1 = fract(t * 0.32 + 0.5);
        float wgt = abs(p0 - 0.5) * 2.0;
        vec2 q = vW.xz * 0.62;
        vec2 g0 = waveGrad(q - flow * p0 * 1.5, t * 0.45), g1 = waveGrad(q - flow * p1 * 1.5 + 0.37, t * 0.45 + 3.0);
        vec2 gr = mix(g0, g1, wgt) * (1.0 + 0.45 * fl);
        g = mix(g, gr, smoothstep(0.04, 0.35, fl));
      }
      g *= mix(1.0, 0.4, far);
      float iceK = smoothstep(0.05, 0.14, vF.w + (vnoise(vW.xz * 1.3) - 0.5) * 0.06); // [seasons] the ice stills the water under it
      iceK *= 1.0 - iceHole(vW.xz); // [water2] a hole cut in it
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
      // the rings and wakes of the ripple simulation round the player
      vec2 rs = vec2(0.0);
      if (uRippleB.w > 0.5 && dist < 40.0) {
        float e = uRippleB.z / 256.0;
        rs = vec2(rippleAt(vW.xz + vec2(e, 0.0)) - rippleAt(vW.xz - vec2(e, 0.0)), rippleAt(vW.xz + vec2(0.0, e)) - rippleAt(vW.xz - vec2(0.0, e))) / (2.0 * e);
        g -= rs / 0.17 * 0.9;
      }
      g *= 1.0 - iceK; rs *= 1.0 - iceK; // [seasons]
      vec3 n = safeNormalize(vec3(g.x * 0.17, 1.0, g.y * 0.17));
      float sh = shadowAt(vW, vec3(0.0, 1.0, 0.0));
      float fres = 0.025 + 0.975 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      vec3 R = reflect(-V, n);
      vec3 refl = skyBase(safeNormalize(vec3(R.x, max(R.y, 0.02), R.z)));
      // visual pass: the clouds drift across the mirror too
      if (R.y > 0.0) {
        vec2 cp = R.xz / (R.y + 0.09) * 0.3 + vec2(uTime * 0.008, uTime * 0.002) + vec2(3.7, 1.2);
        float cn = fbm(cp * 1.15 + 0.4);
        float ccov = smoothstep(uCloudCover, uCloudCover + 0.22, cn);
        refl = mix(refl, mix(uCloudLit, uCloudShade, smoothstep(uCloudCover + 0.05, uCloudCover + 0.36, cn) * 0.9), ccov * smoothstep(0.0, 0.1, R.y) * 0.85);
      }
      // low reflections catch the wooded shore rather than the sky: a ragged line of crowns, not a flat band
      float az = satan(R.z, R.x);
      float crowns = 0.07 + 0.13 * fbm3(vec2(az * 7.0, 1.7)) + 0.04 * vnoise(vec2(az * 31.0, 4.2));
      vec3 land = mix(uLeaf * 0.42, uHorizon * 0.5, 0.35) * (uAmbient * 0.7 + uLightColor * 0.3);
      land *= 0.8 + 0.3 * vnoise(vec2(az * 23.0, R.y * 30.0));
      refl = mix(refl, land, (1.0 - smoothstep(crowns - 0.035, crowns + 0.015, R.y)) * 0.88);
      // looking down through the water: the light it takes on the way (red goes first) tints and then hides the bed
      vec3 lit = uAmbient * 0.6 + uLightColor * 0.5 * mix(0.45, 1.0, sh);
      float run = smoothstep(0.2, 1.2, fl);
      float path = max(depth, 0.0) / max(V.y, 0.07);
      float murk = mix(0.62, 0.42, run);           // still water is darker and greener than running water
      float T = exp(-path * murk);                   // how much of the bed shows
      vec3 deep = mix(vec3(0.04, 0.11, 0.12), vec3(0.055, 0.13, 0.13), run) * lit + uZenith * 0.05;
      vec3 shallowTint = vec3(0.1, 0.19, 0.15) * lit;
      vec3 body = mix(shallowTint, deep, smoothstep(0.0, 2.2, path));
      // light scattered up from just under a sunlit surface, a little green-gold in the shallows
      body += uLightColor * vec3(0.03, 0.05, 0.035) * sh * smoothstep(3.0, 0.3, depth) * (1.0 - uNight);
      vec3 pm = refl * fres + (1.0 - fres) * (1.0 - T) * body;
      float a = 1.0 - (1.0 - fres) * T;
      // the sun's glitter path and a broad sheen
      vec3 Hh = safeNormalize(uLightDir + V);
      float nh = max(dot(n, Hh), 0.0);
      pm += uLightColor * (spow(nh, 420.0) * 2.2 + spow(nh, 60.0) * 0.18) * sh;
      // fires and torches on and in the water
      pm += ((body * 1.5 + 0.06) * pointLights(vW, n) * (1.0 - T * 0.7) + pointLights(vW + vec3(0.0, 0.6, 0.0), R) * fres * 0.6);
      // foam: a line lapping at the shore, streaks where the river runs white, froth in the wakes
      float swash = (0.05 * sin(t * 0.9 + vnoise(vW.xz * 0.25) * 6.3) + 0.025 * sin(t * 2.1 + vW.x * 0.6 + vW.z * 0.4)) * (1.0 - smoothstep(0.4, 1.6, fl));
      float lapD = 0.05 + max(-swash, 0.0) * 1.4;
      float edgeFoam = (1.0 - smoothstep(0.0, 0.07, abs(depth - lapD))) * smoothstep(0.3, 0.62, vnoise(vW.xz * 3.3 + vec2(t * 0.2, -t * 0.16)));
      float shoreFoam = (1.0 - smoothstep(0.0, 0.3, depth)) * smoothstep(0.5, 0.8, vnoise(vW.xz * 2.2 + vec2(t * 0.35, -t * 0.27)) + 0.3 * sin(depth * 18.0 - t * 1.6));
      vec2 fd = fl > 1e-3 ? flow / fl : vec2(1.0, 0.0);
      vec2 fq = vec2(dot(vW.xz, fd), dot(vW.xz, vec2(-fd.y, fd.x)));
      float streak = smoothstep(0.42, 0.78, vnoise(vec2(fq.x * 0.55 - t * fl * 0.9, fq.y * 2.6)) * 0.65 + vnoise(vec2(fq.x * 1.7 - t * fl * 1.3, fq.y * 5.0)) * 0.35);
      float whiteFoam = white * smoothstep(0.22, 0.72, streak * 0.8 + white * 0.38) * (1.0 - far * 0.4);
      // thin lines of froth drawn out along running water, so the eye reads which way it goes
      float lines = smoothstep(0.64, 0.82, vnoise(vec2(fq.x * 0.33 - t * fl * 0.75, fq.y * 3.6))) * smoothstep(0.5, 1.6, fl) * 0.4 * (1.0 - far);
      whiteFoam = max(whiteFoam, lines);
      float wake = smoothstep(0.3, 0.7, length(rs)) * 0.3;
      float foam = clamp(max(max(edgeFoam, shoreFoam * 0.75), max(whiteFoam, wake)), 0.0, 1.0);
      vec3 foamC = vec3(0.86, 0.9, 0.9) * (uAmbient * 0.7 + uLightColor * 0.55 * mix(0.5, 1.0, sh));
      foam *= 1.0 - iceK; // [seasons]
      pm = mix(pm, foamC, foam * 0.85);
      a = mix(a, 1.0, foam * 0.85);
      /* ---- [seasons] lake ice (05k_seasons.js): dark and clear where it is thin, white where thick, cracked into
         plates with fine cracks between, dusted with snow; it thaws from the shallows ---- */
      if (iceK > 0.001) {
        float thick = smoothstep(0.1, 0.5, vF.w);
        // plates: the distance to the nearest edge of a cell pattern a few metres across, and a finer one
        vec2 q = vW.xz * 0.32, ci = floor(q), cf = fract(q);
        float d1 = 8.0, d2 = 8.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j)), r = o + hash22(ci + o) - cf;
          float dd = dot(r, r);
          if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
        }
        float edgeD = sqrt(d2) - sqrt(d1);
        float fineC = 1.0 - smoothstep(0.0, 0.05, abs(vnoise(vW.xz * 1.7) - 0.5)) ;
        float crack = (1.0 - smoothstep(0.015, 0.06, edgeD)) * (0.6 + 0.4 * thick) + fineC * 0.35 * (1.0 - far);
        vec3 iceA = mix(vec3(0.07, 0.11, 0.13), vec3(0.42, 0.55, 0.62), thick) * (0.86 + 0.24 * vnoise(vW.xz * 0.6));
        iceA = mix(iceA, vec3(0.78, 0.84, 0.88), smoothstep(0.55, 0.8, vnoise(vW.xz * 2.2 + 4.0)) * 0.35 * thick); // white streaks of trapped air
        iceA *= 1.0 - 0.55 * clamp(crack, 0.0, 1.0);
        // the wind sweeps the ice: snow lies on it in drifts, with bare ice between
        float sCovI = clamp(uSnowCover * snowHere(vW), 0.0, 1.0);
        float snI = sCovI * smoothstep(0.48, 0.8, vnoise(vW.xz * vec2(0.35, 0.8)) * 0.6 + vnoise(vW.xz * 2.6) * 0.4 + sCovI * 0.18) * thick;
        iceA = mix(iceA, snowAlbedo(vW), snI);
        vec3 nI = safeNormalize(vec3((vnoise(vW.xz * 0.9) - 0.5) * 0.06, 1.0, (vnoise(vW.xz * 0.9 + 7.0) - 0.5) * 0.06));
        vec3 RI = reflect(-V, nI);
        float fresI = 0.03 + 0.97 * spow(1.0 - max(dot(nI, V), 0.0), 5.0);
        vec3 iceC = iceA * (uAmbient * 0.72 + uLightColor * 0.7 * mix(0.35, 1.0, sh) * clamp(dot(nI, uLightDir) * 0.5 + 0.5, 0.0, 1.0));
        iceC += skyBase(safeNormalize(vec3(RI.x, max(RI.y, 0.03), RI.z))) * fresI * 0.5 * (1.0 - snI);
        iceC += uLightColor * spow(max(dot(nI, safeNormalize(uLightDir + V)), 0.0), 90.0) * 0.6 * sh * (1.0 - snI);
        iceC += snowSparkle(vW, V, sh) * snI;
        float iceAl = mix(0.62, 1.0, thick);
        pm = mix(pm, iceC * iceAl + pm * (1.0 - iceAl), iceK);
        a = mix(a, a + (1.0 - a) * iceAl, iceK);
      }
      a = clamp(a, 0.0, 1.0);
      vec3 c = pm / max(a, 1e-3);
      gl_FragColor = vec4(safeColor(applyFog(c, vW)) * a, a);
    }`,
  transparent: true, depthWrite: true, side: THREE.DoubleSide, // [water2] seen from below too
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
});
const WATER_MESHES = [];
function buildWater() {
  uploadWaterMap();
  const G = WATERGRID, ext = G.ext, S = G.surf;
  const CH = 8, CELLS = 64;
  for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CH; ci++) {
    const vid = new Map(), pos = [], aw = [], idx = [];
    let minY = Infinity, maxY = -Infinity;
    const vert = (gi, gj) => {
      const k = gj * HN + gi;
      let v = vid.get(k);
      if (v !== undefined) return v;
      v = pos.length / 3;
      const y = ext[k];
      pos.push(-HALF + gi * HS, y, -HALF + gj * HS);
      aw.push(G.fx[k], G.fz[k], G.white[k], 0);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      vid.set(k, v);
      return v;
    };
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      const gi = ci * CELLS + i, gj = cj * CELLS + j;
      if (gi >= HN - 1 || gj >= HN - 1) continue;
      const k = gj * HN + gi, ks = [k, k + 1, k + HN, k + HN + 1];
      if (!ks.some((q) => !isNaN(S[q])) || ks.some((q) => isNaN(ext[q]))) continue;
      const a = vert(gi, gj), b = vert(gi + 1, gj), c = vert(gi, gj + 1), d = vert(gi + 1, gj + 1);
      if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMat);
    m.renderOrder = 3;
    m.userData.water = true;
    m.userData.ks = Int32Array.from(vid.keys()); // [seasons] each vertex's texel, for the lake ice (05k_seasons.js)
    scene.add(m);
    WATER_MESHES.push(m);
  }
  WATERGRID.cells = WATER_MESHES.reduce((s, m) => s + m.geometry.index.count / 6, 0);
  buildDive(); // [water2] the bed's finds, the fish, the shafts of light (07d_dive.js)
}
