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

/* the meadow's look, shared by the ground, the blades and the flowers so they always agree (visual pass):
   patches of dry straw (x), lush dark clover (y) and tall stands (z), and how high the turf grows */
const GLSL_MEADOW = /* glsl */`
// baked once into the meadow map (rgb; its alpha is the canopy, see CANOPY below): one fetch instead of six noises
vec3 meadowPatch(vec2 xz){ return texture(uCanopy, (xz + 512.0) / 1024.0).rgb; }
// turf height in metres before each blade's own share: a short sward, taller stands, long in the fields, trimmed by the roads
float meadowHeight(vec4 A, vec4 B, vec3 mp){
  float h = mix(0.3, 0.64, mp.z) * (1.0 + 0.55 * B.a) * (1.0 - 0.35 * B.b);
  h *= mix(1.0, 0.62, smoothstep(0.04, 0.4, A.r));
  return h * mix(0.42, 1.0, smoothstep(0.1, 0.62, A.g));
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
/* Cover: where something solid stands on the ground, at 1 m           */
/* ------------------------------------------------------------------ */
// Nothing grows up through a floor, a wall, a stair, paving or a woodpile. The 2 m grass mask is too coarse to keep
// blades out of a room or off a stair tread, so every solid footprint in the world (the colliders of walls, houses,
// furniture, props, tents and stones, the rooms of the houses, and the floors near the ground: stairs, the temple
// dais, the rune circles) is drawn into a 1 m map the grass and flowers read: a blade whose root is covered is not drawn.
const COVER = { res: 1024, data: new Uint8Array(1024 * 1024), tex: null, built: false };
COVER.tex = new THREE.DataTexture(COVER.data, COVER.res, COVER.res, THREE.RedFormat, THREE.UnsignedByteType);
COVER.tex.minFilter = THREE.LinearFilter; COVER.tex.magFilter = THREE.LinearFilter; COVER.tex.generateMipmaps = false;
U.uCover = { value: COVER.tex };
const GLSL_COVER = /* glsl */`
uniform sampler2D uCover;
float coverAt(vec2 xz){
  vec2 uv = (xz + 512.0) / 1024.0;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  return texture(uCover, uv).r;
}
`;
const COVER_SKIP = new Set(['tree', 'parapet', 'rail', 'z']);
// mark the texels whose centres lie inside a shape (grown by pad); shape(x, z) says whether a point is inside
function coverMark(cx, cz, rad, inside) {
  const R = COVER.res, i0 = Math.max(0, Math.floor(cx - rad + 512)), i1 = Math.min(R - 1, Math.ceil(cx + rad + 512));
  const j0 = Math.max(0, Math.floor(cz - rad + 512)), j1 = Math.min(R - 1, Math.ceil(cz + rad + 512));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside(i - 512 + 0.5, j - 512 + 0.5)) COVER.data[j * R + i] = 255;
}
function coverBox(x, z, hx, hz, c, s, pad) {
  const ax = hx + pad, az = hz + pad;
  coverMark(x, z, Math.hypot(ax, az), (px, pz) => { const dx = px - x, dz = pz - z; return Math.abs(dx * c - dz * s) <= ax && Math.abs(dx * s + dz * c) <= az; });
}
function coverCircle(x, z, r) { coverMark(x, z, r, (px, pz) => (px - x) * (px - x) + (pz - z) * (pz - z) <= r * r); }
// [building] mark a footprint at runtime (a placed structure, a pen, a plot): the map goes to the GPU again on the next frame
function coverMarkBox(x, z, hx, hz, yaw, pad = 0.3) { coverBox(x, z, hx, hz, Math.cos(yaw), Math.sin(yaw), pad); COVER.tex.needsUpdate = true; }
function buildCoverMask() {
  COVER.data.fill(0);
  const pad = 0.3;
  for (const c of COLL.boxes) {
    if (c.x > DUN_X0 || COVER_SKIP.has(c.tag) || (c.vert && c.y0 != null && c.y0 > c.baseY + 0.6)) continue;
    coverBox(c.x, c.z, c.hx, c.hz, c.cos, c.sin, pad);
  }
  for (const c of COLL.circles) {
    if (c.x > DUN_X0 || COVER_SKIP.has(c.tag) || (c.vert && c.y0 != null && c.y0 > c.baseY + 0.6)) continue;
    coverCircle(c.x, c.z, c.r + pad);
  }
  // the rooms of the houses: the whole floor, not only the walls
  for (const H of HOUSES) {
    if (H.round) coverCircle(H.x, H.z, H.r + pad);
    else coverBox(H.x, H.z, H.w / 2, H.d / 2, H.c, H.s, pad); // houseL's frame: local x = dx c - dz s
  }
  // floors that come down to the ground: stair flights, the dais, the rune circles
  for (const f of FLOOR.list) {
    if (Math.min(f.ya, f.yb) - heightAt(f.x, f.z) > 1.2) continue;
    if (f.type === 'disc') coverCircle(f.x, f.z, f.r + pad);
    else coverBox(f.x, f.z, f.hx, f.hz, f.cos, f.sin, pad);
  }
  COVER.tex.needsUpdate = true;
  COVER.built = true;
}
// the grass and flower masks changed after the land went up (castle stairs, the temple dais): send them again
function refreshGroundCover() {
  const T = U.uWorldA.value;
  if (!T) return;
  const A = T.image.data, N2 = HN * HN;
  for (let k = 0; k < N2; k++) { A[k * 4 + 1] = W.grass[k] * 255; A[k * 4 + 2] = W.flower[k] * 255; }
  T.needsUpdate = true;
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
    ${GLSL_MEADOW}
    ${GLSL_WATER_MAP}
    ${GLSL_WATER_GROUND}
    uniform sampler2D uTrail;
    uniform vec4 uTrailBounds;
    uniform vec3 uGrassBase, uGrassTip, uGlowColor;
    uniform float uWet, uSnowCover;
    varying vec3 vW; varying vec3 vN;
    float ridged(vec2 p){ return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }
    // visual pass: rock takes the light more directly than turf (less wrap), with sky above and shade below, so
    // ridges, gullies and faces read on the mountains instead of one flat grey
    vec3 lightRock(vec3 alb, vec3 n, float ao){
      float dif = clamp(dot(n, uLightDir) * 0.85 + 0.15, 0.0, 1.0);
      vec3 amb = uAmbient * (0.42 + 0.3 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * ao;
      return alb * (amb + uLightColor * 0.82 * dif * mix(0.2, 1.0, gSh) * mix(0.6, 1.0, ao) + gPL * mix(0.6, 1.0, ao));
    }
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
      // visual pass: the same dry, lush and tall patches as the blades, so the far meadow keeps their pattern
      vec3 mp = meadowPatch(vW.xz);
      gCol = mix(gCol, gCol * vec3(1.32, 1.08, 0.5), mp.x * 0.7);
      gCol = mix(gCol, gCol * vec3(0.74, 0.93, 0.84), mp.y * 0.45);
      gCol *= 1.0 - 0.1 * mp.z * smoothstep(20.0, 60.0, d);
      gCol *= 1.0 - 0.12 * A.g * smoothstep(40.0, 110.0, d); // a deep sward reads a little darker from afar
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
      // visual pass: a ragged road edge, and a trodden verge where the turf thins into the road
      float edgeN = (vnoise(vW.xz * 1.6) - 0.5) * 0.3 + (vnoise(vW.xz * 5.3) - 0.5) * 0.12 * fine;
      float verge = smoothstep(0.02, 0.2, A.r) * (1.0 - smoothstep(0.25, 0.55, A.r + edgeN));
      col = mix(col, col * vec3(0.84, 0.8, 0.7) + dirt * 0.12, verge * 0.6);
      col = mix(col, dirt, smoothstep(0.12, 0.55, A.r + edgeN));
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
        rc *= mix(vec3(1.07, 1.0, 0.9), vec3(0.93, 0.98, 1.05), vnoise(vW.xz * 0.012 + 3.3)); // warm and cool stone across a range
        float crack = 1.0 - smoothstep(0.08, 0.3, hR);
        rc *= 1.0 - 0.45 * crack * (0.25 + 0.75 * fine);
        // moss on ledges facing the sky, lichen freckles
        float moss = smoothstep(0.5, 0.9, nr.y) * smoothstep(0.35, 0.7, vnoise(vW.xz * 0.45 + 2.0)) * (0.55 + 0.45 * B.g);
        rc = mix(rc, vec3(0.22, 0.3, 0.12) * tint, moss * (0.4 + 0.35 * fine));
        float lich = smoothstep(0.7, 0.78, vnoise(vW.zy * 3.1) * w.x + vnoise(vW.xz * 3.1) * w.y + vnoise(vW.xy * 3.1) * w.z) * fine * (1.0 - moss);
        rc = mix(rc, mix(vec3(0.62, 0.58, 0.36), vec3(0.62, 0.42, 0.22), B.r), lich * 0.5);
        vec3 rockCol = lightRock(rc, nr, mix(0.55, 1.0, smoothstep(0.05, 0.4, hR)));
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
      col = waterGround(col, vW, n, gSh); // [water] the bed under lakes, ponds and rivers, caustics, the wet band the waves lap (02c_water_map.js)
      // visual pass: the ground under tree crowns lies in soft shade, stays drier in rain and gathers less snow
      float canopy = canopyAt(vW.xz);
      col *= 1.0 - 0.22 * canopy * (0.6 + 0.4 * gSh);
      col *= 1.0 - 0.42 * groundAO(vW.xz); // and in contact shade at the foot of walls and houses
      float wetG = uWet * (1.0 - 0.8 * canopy);
      // weather: rain darkens and glosses the ground and pools on paths; snow settles on open ground
      if (wetG > 0.01) {
        vec3 V = safeNormalize(cameraPosition - vW);
        float flatK = smoothstep(0.7, 0.96, n.y);
        float puddle = smoothstep(0.58, 0.72, vnoise(vW.xz * 0.33) * 0.7 + vnoise(vW.xz * 1.4) * 0.3) * smoothstep(0.15, 0.55, A.r + (1.0 - A.g) * 0.35) * flatK * wetG;
        col *= 1.0 - 0.28 * wetG;
        float fres = 0.02 + 0.98 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 Rv = reflect(-V, n);
        vec3 sk = skyBase(safeNormalize(vec3(Rv.x, max(Rv.y, 0.03), Rv.z)));
        col = mix(col, sk * 0.85 + gPL * 0.4, clamp(fres * 0.45 * wetG * flatK + puddle * 0.8, 0.0, 1.0));
      }
      if (uSnowCover > 0.01) {
        float sn = uSnowCover * (1.0 - 0.7 * canopy) * smoothstep(0.5, 0.85, n.y) * smoothstep(0.3, 0.6, vnoise(vW.xz * 0.6) * 0.55 + 0.25 + uSnowCover * 0.5 - A.r * 0.45);
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
/* Canopy map (visual pass): how much tree crown covers the ground,    */
/* one texel per 2 m. Rain and snow reach less of the ground and grass */
/* under the crowns, and the soil there lies in soft shade. Kept up to */
/* date as trees are felled, burn, lose their leaves and grow back.    */
/* ------------------------------------------------------------------ */
const CANOPY = { res: 512, acc: null, cache: null, rad: null, bytes: null, tex: null, next: 0, ao: null };
// the meadow's patches (dry straw, lush clover, tall stands) baked into the same map's rgb, 2 m texels
function bakeMeadow(b) {
  const R = CANOPY.res, cell = WSIZE / R;
  const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = -HALF + (i + 0.5) * cell, z = -HALF + (j + 0.5) * cell, q = (j * R + i) * 4;
    const a = vnoise(x * 0.019 + 3.1, z * 0.019 + 7.7) * 0.65 + vnoise(x * 0.071 + 1.3, z * 0.071 + 2.9) * 0.35;
    const bb = vnoise(x * 0.043 + 9.2, z * 0.043 + 4.4) * 0.7 + vnoise(x * 0.15 + 6.1, z * 0.15 + 6.1) * 0.3;
    const c = vnoise(x * 0.027 + 5.5, z * 0.027 + 0.7) * 0.6 + vnoise(x * 0.09 + 2, z * 0.09 + 2) * 0.4;
    b[q] = Math.round(ss(0.56, 0.8, a) * 255); b[q + 1] = Math.round(ss(0.5, 0.74, bb) * 255); b[q + 2] = Math.round(ss(0.45, 0.72, c) * 255);
  }
}
function canopyOf(t) {
  if (t.felled || t.gone || t.fallen) return 0;
  return clamp(t.grow ?? 1, 0, 1) * clamp(t.leaf ?? 1, 0, 1) * (1 - 0.7 * clamp(t.char || 0, 0, 1));
}
function stampCanopy(i0, t, k) {
  const R = CANOPY.res, cell = WSIZE / R, acc = CANOPY.acc, b = CANOPY.bytes;
  // each tree keeps the reach it was first stamped with, so taking a stamp away cancels it exactly
  if (!CANOPY.rad[i0]) CANOPY.rad[i0] = (t.kind === 'pine' ? 1.9 : t.kind === 'birch' ? 1.8 : 2.4) * (t.s0 || t.s || 1) + 0.7;
  const r = CANOPY.rad[i0];
  const ci = (t.x + HALF) / cell, cj = (t.z + HALF) / cell, rc = r / cell + 1;
  for (let j = Math.max(0, Math.floor(cj - rc)); j <= Math.min(R - 1, Math.ceil(cj + rc)); j++) {
    for (let i = Math.max(0, Math.floor(ci - rc)); i <= Math.min(R - 1, Math.ceil(ci + rc)); i++) {
      const d = Math.hypot(i + 0.5 - ci, j + 0.5 - cj) * cell;
      if (d >= r) continue;
      const q = j * R + i;
      acc[q] += clamp((r - d) / (r * 0.6), 0, 1) * k; // full under the heart of the crown, thinning to the drip line
      b[q * 4 + 3] = Math.round(clamp(acc[q], 0, 1) * 255);
    }
  }
}
// baked contact shade on the ground round the foot of walls, houses, gates, fences and posts (1 m texels)
function buildGroundAO() {
  const R = 1024, cell = WSIZE / R, b = new Uint8Array(R * R);
  const put = (x0, z0, rr, fn) => {
    const i0 = Math.max(0, Math.floor((x0 - rr + HALF) / cell)), i1 = Math.min(R - 1, Math.ceil((x0 + rr + HALF) / cell));
    const j0 = Math.max(0, Math.floor((z0 - rr + HALF) / cell)), j1 = Math.min(R - 1, Math.ceil((z0 + rr + HALF) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = fn(-HALF + (i + 0.5) * cell, -HALF + (j + 0.5) * cell);
      if (v > 0) { const q = j * R + i; b[q] = Math.max(b[q], Math.round(clamp(v, 0, 1) * 255)); }
    }
  };
  for (const c of COLL.boxes) {
    if (!['wall', 'house', 'gate', 'stone', 'fence', 'prop'].includes(c.tag)) continue;
    const reach = clamp((c.h || 3) * 0.32, 0.7, 2.6), k = clamp((c.h || 3) / 3, 0.35, 1);
    put(c.x, c.z, Math.hypot(c.hx, c.hz) + reach, (x, z) => {
      const dx = x - c.x, dz = z - c.z;
      const lx = Math.abs(dx * c.cos - dz * c.sin) - c.hx, lz = Math.abs(dx * c.sin + dz * c.cos) - c.hz;
      const d = Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
      const f = 1 - d / reach;
      return f > 0 ? k * f * f : 0;
    });
  }
  for (const c of COLL.circles) {
    if (c.tag === 'tree') continue;
    const reach = clamp((c.h || 2) * 0.3, 0.5, 1.6), k = clamp((c.h || 2) / 3, 0.3, 0.8);
    put(c.x, c.z, c.r + reach, (x, z) => { const f = 1 - Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r) / reach; return f > 0 ? k * f * f : 0; });
  }
  const tex = new THREE.DataTexture(b, R, R, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  U.uGroundAO.value = tex;
  CANOPY.ao = b;
}
function updateCanopy() {
  if (!W.trees || !U.uCanopy) return;
  if (!CANOPY.tex) {
    buildGroundAO();
    const R = CANOPY.res;
    CANOPY.acc = new Float32Array(R * R); CANOPY.bytes = new Uint8Array(R * R * 4);
    bakeMeadow(CANOPY.bytes);
    CANOPY.cache = new Float32Array(W.trees.length); CANOPY.rad = new Float32Array(W.trees.length);
    W.trees.forEach((t, i) => { const k = canopyOf(t); CANOPY.cache[i] = k; if (k > 0) stampCanopy(i, t, k); });
    const tex = new THREE.DataTexture(CANOPY.bytes, R, R, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.needsUpdate = true;
    CANOPY.tex = tex; U.uCanopy.value = tex;
    CANOPY.next = renderTime + 1.5;
    // test hooks: what the maps hold at a point (canopy 0..1, ground shade 0..1, meadow patches)
    if (window.__hm) window.__hm.visual = {
      canopy: (x, z) => { const R = CANOPY.res, i = clamp(Math.floor((x + HALF) / (WSIZE / R)), 0, R - 1), j = clamp(Math.floor((z + HALF) / (WSIZE / R)), 0, R - 1); return CANOPY.bytes[(j * R + i) * 4 + 3] / 255; },
      meadow: (x, z) => { const R = CANOPY.res, i = clamp(Math.floor((x + HALF) / (WSIZE / R)), 0, R - 1), j = clamp(Math.floor((z + HALF) / (WSIZE / R)), 0, R - 1), q = (j * R + i) * 4; return [CANOPY.bytes[q] / 255, CANOPY.bytes[q + 1] / 255, CANOPY.bytes[q + 2] / 255]; },
      groundAO: (x, z) => { const i = clamp(Math.floor(x + HALF), 0, 1023), j = clamp(Math.floor(z + HALF), 0, 1023); return CANOPY.ao ? CANOPY.ao[j * 1024 + i] / 255 : 0; },
      refresh: () => { CANOPY.next = 0; updateCanopy(); },
    };
    return;
  }
  if (renderTime < CANOPY.next) return;
  CANOPY.next = renderTime + 1.5;
  const T = W.trees, C = CANOPY.cache;
  let changed = false;
  for (let i = 0; i < T.length && i < C.length; i++) {
    const k = canopyOf(T[i]);
    if (Math.abs(k - C[i]) < 0.04) continue;
    stampCanopy(i, T[i], k - C[i]); C[i] = k; changed = true;
  }
  if (changed) CANOPY.tex.needsUpdate = true;
}

// [water] the water's surface (lakes, ponds and rivers in one mesh) lives in 03b_water.js

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
  ${GLSL_COVER}
  ${GLSL_MEADOW}
  varying vec4 vNat; // nature: cut, burnt, burning (05h_nature.js)
  varying vec4 vPatch; // visual pass: dry, lush, the blade's own hue, the gust bending it
  varying float vCanopy; // visual pass: tree crown overhead (drier in rain, less snow, a little shade)
  uniform float uTile, uFadeNear, uFadeFar, uInner, uWidthMul, uBladeWidth;
  uniform vec2 uCenter, uCam2;
  attribute vec2 aOff;
  attribute vec4 aRnd;
  varying vec3 vWorld; varying vec3 vN; varying vec3 vAcross; varying vec4 vInfo; varying vec4 vLook; varying vec4 vDecal; varying float vSh;
  void main(){
    vSh = 1.0; vNat = vec4(0.0); vPatch = vec4(0.0); vCanopy = 0.0;
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
    if (aRnd.x > A.g * 1.02 - 0.02 || keep > fade || coverAt(base) > 0.3) fade = 0.0; // nothing grows through floors and walls
    else fade = mix(0.82, 1.0, smoothstep(keep, keep + 0.25, fade));
    // visual pass: a varied sward (short turf, tall stands, long in the fields) instead of one even shag of tall blades
    vec3 mp = meadowPatch(base);
    float H = meadowHeight(A, B, mp) * mix(0.6, 1.3, aRnd.y * aRnd.y) * fade;
    H *= 0.86 + 0.28 * vnoise(base * 0.3 + 7.0);
    float sparse = smoothstep(0.1, 0.62, A.g);
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
    W0 *= 0.74 + 0.26 * clamp(H / 0.55, 0.0, 1.0); // visual pass: short turf has finer blades, so it stays slender
    vec3 world = b3 + off + across * (position.x * W0);
    vWorld = world;
    vN = safeNormalize(cross(across, tang));
    vAcross = across;
    float bright = 0.74 + 0.4 * fract(aRnd.w * 3.7) + 0.1 * vnoise(base * 0.55);
    vInfo = vec4(t, position.z, bright, tr.a);
    vPatch = vec4(mp.xy, fract(aRnd.w * 5.93 + aRnd.y * 2.1), gGust * gGust * uWind);
    vCanopy = canopyAt(base);
    vInfo.z *= 1.0 - 0.38 * groundAO(base);
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
  uniform float uWet, uSnowCover, uGrassLow;
  varying vec3 vWorld; varying vec3 vN; varying vec3 vAcross; varying vec4 vInfo; varying vec4 vLook; varying vec4 vDecal; varying float vSh;
  varying vec4 vNat; // nature: cut, burnt, burning (05h_nature.js)
  varying vec4 vPatch; // visual pass: dry, lush, the blade's own hue, the gust bending it
  varying float vCanopy;
  void main(){
    float t = clamp(vInfo.x, 0.0, 1.0);
    float wetB = uWet * (1.0 - 0.8 * vCanopy), snowB = uSnowCover * (1.0 - 0.7 * vCanopy);
    float sh = clamp(vSh, 0.0, 1.0);
    vec3 V = safeNormalize(cameraPosition - vWorld);
    vec3 n = safeNormalize(vN);
    n *= dot(n, V) < 0.0 ? -1.0 : 1.0;
    n = safeNormalize(n + vAcross * clamp(vInfo.y, -1.5, 1.5) * 0.45);
    float camDist = distance(cameraPosition, vWorld);
    vec3 alb = mix(uGrassBase, uGrassTip, smoothstep(0.02, 0.8, t)) * vLook.rgb;
    // visual pass: the meadow's patches (dry straw, lush dark clover), each blade's own hue, sun-bleached tips
    alb = mix(alb, alb * vec3(1.32, 1.08, 0.5), vPatch.x * (0.35 + 0.65 * t) * 0.8);
    alb = mix(alb, alb * vec3(0.74, 0.93, 0.84), vPatch.y * 0.5);
    alb *= mix(vec3(1.07, 1.02, 0.82), vec3(0.93, 1.0, 1.1), vPatch.z);
    alb = mix(alb, alb * vec3(1.2, 1.14, 0.78), smoothstep(0.72, 1.0, t) * 0.65);
    alb = mix(alb, alb * vec3(1.18, 0.82, 0.42) + vec3(0.2, 0.09, 0.01), vLook.a * smoothstep(0.15, 1.0, t));
    alb *= vInfo.z;
    alb = mix(alb * (1.0 - 0.18 * wetB), vec3(0.82, 0.85, 0.9), snowB * 0.65 * smoothstep(0.3, 1.0, t));
    // dark only right at the roots (sparser low-detail grass lets more light down)
    float ao = mix(0.12 + 0.16 * uGrassLow, 1.0, spow(smoothstep(0.0, 0.85, t), 1.15)) * (1.0 - 0.18 * vCanopy);
    // lit as part of the sward as well as a blade: the normal leans toward the sky, so a sunlit meadow is as bright
    // as the turf beyond the blades instead of a band of dark green
    float ndl = clamp(dot(safeNormalize(n + vec3(0.0, 0.7, 0.0)), uLightDir) * 0.5 + 0.5, 0.0, 1.0);
    float bd = clamp(dot(-V, uLightDir), 0.0, 1.0);
    float back = spow(bd, 7.0) * mix(1.0, 0.35, smoothstep(3.5, 12.0, camDist));
    vec3 col = alb * (0.3 + (0.5 * ndl + 0.8 * back + 0.14 * bd * bd) * mix(0.32, 1.0, sh)) * ao;
    col += uGrassTrans * back * t * t * t * 0.55 * clamp(vInfo.z, 0.0, 1.5) * vLook.rgb * sh;
    // a gust bending a swathe of blades shows their paler sides: waves running over the meadow
    col *= 1.0 + 0.24 * vPatch.w * t * (0.5 + 0.5 * sh);
    vec3 H = safeNormalize(uLightDir + V);
    col += uLightColor * spow(dot(n, H), 48.0) * (0.1 + 0.5 * wetB) * t * sh;
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
// visual pass: lower detail spends its vertices on more, simpler blades (fewer bends each) rather than on fewer
// curvier ones, so medium and low read as a lawn instead of a few tall dark sticks
const GRASS_SEGS = { high: [5, 3, 2], medium: [4, 3, 2], low: [3, 2, 2] };
const grassMeshes = [];
function buildGrass() {
  if (!COVER.built) buildCoverMask();
  for (const m of grassMeshes) { scene.remove(m); m.geometry.dispose(); }
  grassMeshes.length = 0;
  const rr = mulberry(4242);
  const segsQ = GRASS_SEGS[quality.level] || GRASS_SEGS.high;
  GRASS_LAYERS.forEach((L, li) => {
    const segs = Math.min(L.segs, segsQ[li] || L.segs);
    const n = Math.max(1000, Math.round(L.count * quality.grass * (2 * L.segs + 1) / (2 * segs + 1)));
    const g = bladeGeometry(segs);
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
        uGrassLow: { value: quality.level === 'low' ? 1 : quality.level === 'medium' ? 0.5 : 0 },
      },
    }));
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.userData.layer = L;
    scene.add(m);
    grassMeshes.push(m);
  });
}
function updateGrassCenters(camX, camZ, fwdX, fwdZ) {
  updateCanopy(); // visual pass: built on the first frame, then refreshed as trees fall and regrow
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
    ${GLSL_COVER}
    ${GLSL_MEADOW}
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
      if (aRnd.x > A.b || coverAt(base) > 0.3) fade = 0.0;
      { vec4 nat = natureAt(base); if (max(nat.r, max(nat.g, nat.b)) > 0.25 + 0.5 * aRnd.y) fade = 0.0; } // nature: cut or burnt
      if (fade < 0.02) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
      int ci = int(aRnd.y * 5.99);
      float u = aRnd.z;
      vec3 c = u < B.r ? uPalL[ci] : (u < B.r + B.g ? uPalE[ci] : uPalT[ci]);
      vCol = c;
      vec3 b3 = vec3(base.x, terrainHeight(base) - 0.03, base.y);
      // heads ride just above the turf they grow in (visual pass: the sward's height varies now)
      float stemH = meadowHeight(A, B, meadowPatch(base)) * (0.92 + 0.32 * fract(aRnd.w * 5.1)) + 0.05;
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
