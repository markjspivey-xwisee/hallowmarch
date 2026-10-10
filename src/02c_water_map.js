/* ================================================================== */
/* water map: the water standing over the land, for every shader; and  */
/* the ripple simulation around the player                              */
/* ================================================================== */
// uWaterMap holds, for every 2 m texel, the height of the water surface (carried a texel or two onto the shore so the
// shore can be cut per pixel; -1000 where there is none), its flow (m/s) and how white it runs. The ground reads it for
// the wet band the waves lap, the bed under the water and the caustics on it; the water surface reads the ripples.
U.uWaterMap = { value: ZERO_TEX };
U.uRipple = { value: ZERO_TEX };
U.uRippleB = { value: new THREE.Vector4(-24, -24, 48, 0) }; // window min x, min z, size, on (0 off)

const GLSL_WATER_MAP = /* glsl */`
uniform highp sampler2D uWaterMap;
uniform sampler2D uRipple;
uniform vec4 uRippleB;
// surface height (or -1000), flow x, flow z, white water: bilinear over the texels that have water
vec4 waterMapAt(vec2 xz){
  vec2 g = clamp((xz + 512.0) * 0.5, vec2(0.0), vec2(511.999));
  ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  vec4 a = texelFetch(uWaterMap, i, 0), b = texelFetch(uWaterMap, i + ivec2(1, 0), 0);
  vec4 c = texelFetch(uWaterMap, i + ivec2(0, 1), 0), d = texelFetch(uWaterMap, i + ivec2(1, 1), 0);
  float m = max(max(a.r, b.r), max(c.r, d.r));
  if (m < -500.0) return vec4(-1000.0, 0.0, 0.0, 0.0);
  if (a.r < -500.0) a = vec4(m, 0.0, 0.0, 0.0);
  if (b.r < -500.0) b = vec4(m, 0.0, 0.0, 0.0);
  if (c.r < -500.0) c = vec4(m, 0.0, 0.0, 0.0);
  if (d.r < -500.0) d = vec4(m, 0.0, 0.0, 0.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// the ripple field round the player (height in metres; 0 outside the window or when it is off)
float rippleAt(vec2 xz){
  if (uRippleB.w < 0.5) return 0.0;
  vec2 uv = (xz - uRippleB.xy) / uRippleB.z;
  if (uv.x <= 0.002 || uv.y <= 0.002 || uv.x >= 0.998 || uv.y >= 0.998) return 0.0;
  vec2 e = smoothstep(0.0, 0.12, uv) * smoothstep(0.0, 0.12, 1.0 - uv);
  return texture(uRipple, uv).r * e.x * e.y;
}
// light focused by the moving surface onto the bed: a bright net that drifts with the flow
float causticNet(vec2 q, float t){
  vec2 p = q + vec2(vnoise(q * 0.7 + t * 0.21), vnoise(q * 0.7 - t * 0.17 + 3.1)) * 1.6;
  float a = 1.0 - abs(vnoise(p + vec2(t * 0.31, -t * 0.23)) * 2.0 - 1.0);
  float b = 1.0 - abs(vnoise(p * 1.43 + vec2(-t * 0.27, t * 0.35) + 7.7) * 2.0 - 1.0);
  return spow(a * b, 4.0) * 2.4 + spow(max(a, b), 9.0) * 0.5;
}
`;
// the ground under and beside the water (terrain fragment shader; needs GLSL_LIGHT, GLSL_WORLD and the map above)
const GLSL_WATER_GROUND = /* glsl */`
vec3 waterGround(vec3 col, vec3 wp, vec3 n, float sh){
  vec4 wm = waterMapAt(wp.xz);
  if (wm.r < -500.0) return col;
  float d = wm.r - wp.y; // how deep this ground lies under the surface (negative: above it)
  if (d < -0.9) return col;
  float t = uTime;
  vec2 flow = wm.gb;
  float fl = length(flow);
  // the swash: the edge of the water runs up the shore and back, more on a lake than in a fast river
  float swash = (0.05 * sin(t * 0.9 + vnoise(wp.xz * 0.25) * 6.3) + 0.025 * sin(t * 2.1 + wp.x * 0.6 + wp.z * 0.4)) * (1.0 - smoothstep(0.4, 1.6, fl));
  float dd = d + swash;
  // the wet band: dark, soaked ground the waves reach, with a ragged top edge
  float edgeN = vnoise(wp.xz * 1.7) * 0.2 + vnoise(wp.xz * 6.0) * 0.08;
  float wetB = smoothstep(-0.5 - edgeN, -0.04, dd);
  // a refraction-like wobble of what lies on the bed, stronger the deeper it lies
  float wk = clamp(d, 0.0, 1.6) * 0.09;
  vec2 wob = (vec2(vnoise(wp.xz * 0.9 + vec2(t * 0.7, t * 0.4)), vnoise(wp.xz * 0.9 - vec2(t * 0.5, -t * 0.6) + 5.3)) - 0.5) * wk;
  wob += (vec2(rippleAt(wp.xz + vec2(0.3, 0.0)) - rippleAt(wp.xz - vec2(0.3, 0.0)), rippleAt(wp.xz + vec2(0.0, 0.3)) - rippleAt(wp.xz - vec2(0.0, 0.3)))) * 1.5 * clamp(d, 0.0, 1.0);
  vec2 q = wp.xz + wob - flow * 0.0;
  // the bed: clean gravel where the river runs, sand and dark silt where the water is still
  float under = smoothstep(-0.03, 0.12, d);
  float px = length(fwidth(wp.xz));
  float fine = 1.0 - smoothstep(0.04, 0.12, px);
  float pc = vnoise(q * 3.4) * 0.6 + vnoise(q * 9.0) * 0.4 * fine;
  float pebble = smoothstep(0.55, 0.72, pc) * fine;
  float runK = smoothstep(0.25, 1.1, fl);
  vec3 sand = vec3(0.52, 0.46, 0.34) * (0.86 + 0.22 * vnoise(q * 1.1));
  vec3 silt = vec3(0.24, 0.23, 0.16) * (0.85 + 0.3 * vnoise(q * 0.6));
  vec3 gravel = mix(vec3(0.42, 0.4, 0.36), vec3(0.6, 0.55, 0.47), vnoise(q * 4.7)) * (0.7 + 0.45 * pc);
  vec3 bedA = mix(sand, silt, smoothstep(0.6, 2.4, d) * (1.0 - runK));
  bedA = mix(bedA, gravel, max(runK, pebble * 0.65));
  bedA += pebble * vec3(0.1, 0.09, 0.07) * (1.0 - runK);
  // weed in the deeper still water
  float weed = smoothstep(0.62, 0.8, vnoise(q * 0.45 + 3.0)) * smoothstep(0.8, 1.6, d) * (1.0 - runK);
  bedA = mix(bedA, vec3(0.12, 0.2, 0.08), weed * 0.7);
  vec3 bed = lightSurface(bedA, n, 1.0);
  // a strip of beach above still water, of stones above running water
  float beach = smoothstep(-0.85 - edgeN, -0.25, d) * (1.0 - under);
  col = mix(col, lightSurface(mix(sand * 1.06, gravel, runK), n, 1.0), beach * 0.7);
  col = mix(col, bed, under * 0.92);
  // wet ground and wet bed are darker
  col *= 1.0 - 0.36 * wetB;
  // a glossy film on the band above the water, catching the sky
  float film = wetB * (1.0 - under);
  if (film > 0.01) {
    vec3 V = safeNormalize(cameraPosition - wp);
    vec3 Rr = reflect(-V, n);
    float fres = 0.03 + 0.97 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
    col = mix(col, skyBase(safeNormalize(vec3(Rr.x, max(Rr.y, 0.03), Rr.z))) * 0.8, film * fres * 0.6);
  }
  // caustics where the sun reaches the bed through the waves; they fade with depth and drift with the stream
  if (under > 0.0 && uNight < 0.95) {
    float c = causticNet(q * 1.35 - flow * t * 0.6, t * (1.0 + 0.6 * fl));
    float depthK = smoothstep(0.0, 0.25, d) * exp(-max(d - 0.25, 0.0) * 0.75);
    col += uLightColor * bedA * c * sh * depthK * under * 0.55 * (1.0 - uNight);
  }
  return col;
}
`;

/* ------------------------------------------------------------------ */
/* the water map texture                                                */
/* ------------------------------------------------------------------ */
function uploadWaterMap() {
  const N2 = HN * HN, A = new Float32Array(N2 * 4), G = WATERGRID;
  for (let k = 0; k < N2; k++) {
    const s = G.ext[k];
    A[k * 4] = isNaN(s) ? -1000 : s;
    A[k * 4 + 1] = G.fx[k]; A[k * 4 + 2] = G.fz[k]; A[k * 4 + 3] = G.white[k];
  }
  const T = new THREE.DataTexture(A, HN, HN, THREE.RGBAFormat, THREE.FloatType);
  T.internalFormat = 'RGBA32F';
  T.minFilter = THREE.NearestFilter; T.magFilter = THREE.NearestFilter; T.generateMipmaps = false;
  T.needsUpdate = true;
  G.tex = T;
  U.uWaterMap.value = T;
}

/* ------------------------------------------------------------------ */
/* ripples: a wave equation on a small window round the player          */
/* ------------------------------------------------------------------ */
// Two half-float targets ping-pong the surface height now and a step ago. Each step every texel moves toward the mean
// of its neighbours (the waves travel about a metre a second), loses a little height (they die out), and is held at
// zero where there is no water, so the rings stop at the shore and bounce back off it. Bodies wading and swimming, splashes,
// leaping fish, rain and spells drop disturbances in. Medium quality runs it at half the detail; low does not run it.
const RIPPLE = { size: 48, res: 0, minX: -24, minZ: -24, rtA: null, rtB: null, drops: [], maxDrops: 24, acc: 0, steps: 0, on: false };
const rippleSimMat = new THREE.ShaderMaterial({
  uniforms: {
    uPrev: { value: null }, uB: { value: new THREE.Vector4() }, uPrevB: { value: new THREE.Vector4() }, uTexel: { value: 1 / 256 },
    uDrops: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) }, uN: { value: 0 }, uC2: { value: 0.18 }, uDamp: { value: 0.992 },
    uWaterMap: U.uWaterMap, uHeightTex: U.uHeightTex,
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D uPrev; uniform vec4 uB, uPrevB; uniform float uTexel, uC2, uDamp;
    uniform vec4 uDrops[24]; uniform int uN;
    uniform highp sampler2D uWaterMap, uHeightTex;
    varying vec2 vUv;
    float fin(float v){ return ((floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u) ? 0.0 : v; }
    vec2 tap(vec2 wp){
      vec2 uv = (wp - uPrevB.xy) / uPrevB.z;
      if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec2(0.0);
      vec2 v = texture2D(uPrev, uv).rg;
      return vec2(fin(v.x), fin(v.y));
    }
    float hgt(vec2 xz){
      vec2 g = clamp((xz + 512.0) * 0.5, vec2(0.0), vec2(511.999));
      ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
      return mix(mix(texelFetch(uHeightTex, i, 0).r, texelFetch(uHeightTex, i + ivec2(1, 0), 0).r, f.x), mix(texelFetch(uHeightTex, i + ivec2(0, 1), 0).r, texelFetch(uHeightTex, i + ivec2(1, 1), 0).r, f.x), f.y);
    }
    float surf(vec2 xz){
      vec2 g = clamp((xz + 512.0) * 0.5, vec2(0.0), vec2(511.999));
      ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
      vec4 s = vec4(texelFetch(uWaterMap, i, 0).r, texelFetch(uWaterMap, i + ivec2(1, 0), 0).r, texelFetch(uWaterMap, i + ivec2(0, 1), 0).r, texelFetch(uWaterMap, i + ivec2(1, 1), 0).r);
      float m = max(max(s.x, s.y), max(s.z, s.w));
      s = mix(s, vec4(m), step(s, vec4(-500.0)));
      return mix(mix(s.x, s.y, f.x), mix(s.z, s.w, f.x), f.y);
    }
    void main(){
      vec2 wp = uB.xy + vUv * uB.z;
      float e = uB.z * uTexel;
      vec2 c = tap(wp);
      float lap = tap(wp + vec2(e, 0.0)).x + tap(wp - vec2(e, 0.0)).x + tap(wp + vec2(0.0, e)).x + tap(wp - vec2(0.0, e)).x - 4.0 * c.x;
      float h = (2.0 * c.x - c.y + uC2 * lap) * uDamp;
      for (int k = 0; k < 24; k++) {
        if (k >= uN) break;
        vec4 D = uDrops[k];
        float d = length(wp - D.xy);
        if (d < D.z) { float f = d / D.z; h -= D.w * (1.0 - f * f) * (1.0 - f * f); }
      }
      // the shore: no water, no wave (a wave meeting the bank is thrown back)
      float s = surf(wp);
      if (s < -500.0 || s - hgt(wp) < 0.03) h = 0.0;
      h = clamp(h, -0.2, 0.2);
      gl_FragColor = vec4(h, c.x, 0.0, 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const rippleClearMat = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }', depthTest: false, depthWrite: false });
// make or drop the targets for the current quality (high 256, medium 128, low none)
function rippleSetup() {
  const want = !FLOAT_RT || REDUCE_MOTION ? 0 : quality.level === 'high' ? 256 : quality.level === 'medium' ? 128 : 0;
  if (want === RIPPLE.res) return;
  if (RIPPLE.rtA) { RIPPLE.rtA.dispose(); RIPPLE.rtB.dispose(); RIPPLE.rtA = RIPPLE.rtB = null; }
  RIPPLE.res = want;
  RIPPLE.on = want > 0;
  if (!want) { U.uRipple.value = ZERO_TEX; U.uRippleB.value.w = 0; return; }
  const o = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
  RIPPLE.rtA = new THREE.WebGLRenderTarget(want, want, o);
  RIPPLE.rtB = new THREE.WebGLRenderTarget(want, want, o);
  pass(rippleClearMat, RIPPLE.rtA); pass(rippleClearMat, RIPPLE.rtB);
  renderer.setRenderTarget(null);
}
// a disturbance: a dip of the given depth (m) over a disc of radius r; drops past the cap this step are dropped
function rippleDrop(x, z, r, depth) {
  if (!RIPPLE.on || RIPPLE.drops.length >= RIPPLE.maxDrops) return;
  if (Math.abs(x - (RIPPLE.minX + RIPPLE.size / 2)) > RIPPLE.size / 2 + r || Math.abs(z - (RIPPLE.minZ + RIPPLE.size / 2)) > RIPPLE.size / 2 + r) return;
  RIPPLE.drops.push([x, z, Math.max(r, RIPPLE.size / RIPPLE.res * 1.6), depth]);
}
// called every frame (it is only drawn): fixed steps at 60 a second, at most three a frame
function stepRipples(dt, cx, cz) {
  rippleSetup();
  if (!RIPPLE.on || INDOOR.on) { U.uRippleB.value.w = 0; RIPPLE.drops.length = 0; return; }
  RIPPLE.acc = Math.min(RIPPLE.acc + dt, 3 / 60);
  const m = rippleSimMat.uniforms, texel = RIPPLE.size / RIPPLE.res;
  // waves at about 1.1 m/s at full detail; the coarser grid keeps the same speed in metres
  m.uC2.value = Math.min(0.45, Math.pow(1.1 / 60 / texel, 2) * 2.2);
  m.uTexel.value = 1 / RIPPLE.res;
  m.uDamp.value = 0.993;
  let first = true;
  while (RIPPLE.acc >= 1 / 60) {
    RIPPLE.acc -= 1 / 60;
    // keep the window on the player, moving in whole texels so the waves stay put on the water
    const nx = Math.round((cx - RIPPLE.size / 2) / texel) * texel, nz = Math.round((cz - RIPPLE.size / 2) / texel) * texel;
    m.uPrevB.value.set(RIPPLE.minX, RIPPLE.minZ, RIPPLE.size, RIPPLE.size);
    RIPPLE.minX = nx; RIPPLE.minZ = nz;
    m.uB.value.set(nx, nz, RIPPLE.size, RIPPLE.size);
    const n = first ? Math.min(RIPPLE.drops.length, 24) : 0;
    for (let i = 0; i < n; i++) { const d = RIPPLE.drops[i]; m.uDrops.value[i].set(d[0], d[1], d[2], d[3]); }
    m.uN.value = n;
    if (first) RIPPLE.drops.length = 0;
    first = false;
    m.uPrev.value = RIPPLE.rtA.texture;
    pass(rippleSimMat, RIPPLE.rtB);
    [RIPPLE.rtA, RIPPLE.rtB] = [RIPPLE.rtB, RIPPLE.rtA];
    RIPPLE.steps++;
  }
  U.uRipple.value = RIPPLE.rtA.texture;
  U.uRippleB.value.set(RIPPLE.minX, RIPPLE.minZ, RIPPLE.size, 1);
}
