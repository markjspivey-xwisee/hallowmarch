/* ================================================================== */
/* the night sky's own lights: the aurora and shooting stars            */
/* ================================================================== */
// Its own sky layer, drawn after the sky (renderOrder -100) and before the world, adding light to it and leaving
// the scene's alpha alone (alpha 0 marks open sky for the light shafts). It reads only shared uniforms: the
// inverse view-projection and cloud cover of the sky, time and night, so it does not depend on how the sky shader
// draws itself.
// The aurora: curtains of light, long east-west sheets standing to the north whose foot is a sharp bright edge and
// whose rays reach up and fade; the lines they stand on wander, fold and drift, rays roll along them, and they
// burn brightest where a fold turns toward the eye. Green below, violet in the tall rays, a pink fringe when they
// flare. Over Thule they hang overhead and to the north; elsewhere they lie faint and low on the northern sky.
// Clouds, rain, snow, storm and mist hide them, and they fade at dawn. Quality: high draws three curtains with
// depth, medium three thin ones, low two and skips the per-pixel cloud mask (the weather fade still applies).
// Shooting stars: now and then on clear nights, a streak of light that flares and burns out.
// Hooks elsewhere: tick in 13_main.js calls updateNightSky(dt) (marked [aurora]).

const AUR_GLSL_CLOUD = /* glsl */`
${GLSL_CLOUDS}
// the cloud layer of the sky, so the lights pass behind the same clouds (this mirrors the cloud field of the sky
// shader in 02_render.js; if that changes, change this with it: the weather fade hides the lights regardless)
float aurCloud(vec3 dir){
  if (uCloudDomeOn.x > 0.5) return 1.0 - cloudScreen(dir, gl_FragCoord.xy).a; // [weather2] the clouds that are there, the view's own (12c_weather2.js)
  vec2 cp = dir.xz / (dir.y + 0.09);
  cp = cp * 0.3 + vec2(uTime * 0.008, uTime * 0.002) + vec2(3.7, 1.2);
  vec2 warp = vec2(fbm(cp * 0.55 + 4.1), fbm(cp * 0.55 - 7.3));
  float n = fbm(cp + warp * 0.9 - 0.45);
  float cc0 = uCloudCover - 0.05 * smoothstep(0.08, 0.35, dir.y);
  return smoothstep(cc0, cc0 + 0.2, n) * smoothstep(-0.01, 0.06, dir.y) * 0.92;
}
`;
const AURORA = {
  mesh: null, star: null, on: false, str: 0, lat: 0, clear: 0, force: null,
  next: 6 + Math.random() * 12, shots: 0,
};
const AUR_STAR = { on: false, t: 0, dur: 0.8, hold: -1, bright: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), col: [1, 1, 1.1] };
const aurU = {
  uInvVP: skyU.uInvVP, uCloudCover: skyU.uCloudCover,
  uAur: { value: 0 }, uLat: { value: 0 }, uQ: { value: 2 }, uActivity: { value: 0.6 },
};
// additive light; the destination alpha (the open-sky mark) is kept
const AUR_BLEND = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
// the curtains: light added, and the sky behind them deepened by the source alpha; the destination alpha is kept
const AUR_BLEND_CURTAIN = { ...AUR_BLEND, blendDst: THREE.OneMinusSrcAlphaFactor };
AURORA.mesh = new THREE.Mesh(fsTriGeo, mat({
  uniforms: aurU, depthWrite: false, depthTest: false, transparent: false, ...AUR_BLEND_CURTAIN,
  vertexShader: /* glsl */`
    uniform mat4 uInvVP;
    varying vec3 vDir;
    void main(){
      vec4 p = uInvVP * vec4(position.xy, 1.0, 1.0);
      vDir = p.xyz / (abs(p.w) > 1e-6 ? p.w : 1e-6) - cameraPosition;
      gl_Position = vec4(position.xy, 1.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    uniform float uTime, uCloudCover, uAur, uLat, uQ, uActivity;
    varying vec3 vDir;
    ${AUR_GLSL_CLOUD}
    // the line a curtain stands on: it wanders, folds and drifts
    float aurLine(float x, float s){
      float t = uTime;
      return 0.6 * sin(x * 0.38 + t * 0.041 + s) + 0.3 * sin(x * 0.93 - t * 0.067 + s * 1.7) + 0.75 * (vnoise(vec2(x * 0.3 + s * 3.1, t * 0.018 + s)) - 0.5);
    }
    // one curtain: a sheet standing at distance zc north (negative) or south of the eye, its foot at height 1 and
    // its rays reaching up to 2.7 (sky units); px is the angular size of a pixel, for filtering the fine rays
    vec3 aurCurtain(vec3 d, float zc, float s, float w, float px){
      float dz = abs(d.z) < 1e-3 ? (d.z < 0.0 ? -1e-3 : 1e-3) : d.z;
      // where the ray meets the sheet: two fixed-point steps along its wandering line
      float s0 = zc / dz;
      float s1 = (zc + aurLine(d.x * s0, s)) / dz;
      float sh = (zc + aurLine(d.x * s1, s)) / dz;
      float xh = d.x * sh;
      // the foot ripples: it is not a ruled line
      float foot = 1.0 + 0.1 * sin(xh * 1.3 + uTime * 0.09 + s) + 0.12 * (vnoise(vec2(xh * 0.8 - uTime * 0.05, s + 2.0)) - 0.5);
      float hy = (d.y * sh - foot) / 1.7;
      float inside = step(0.0, sh) * step(-0.05, hy) * step(hy, 1.05);
      // vertical rays, filtered where a pixel spans many of them, and brightness rolling along the curtain
      float span = px * max(sh, 0.0);
      float r1 = mix(vnoise(vec2(xh * 5.0 + uTime * 0.11, s * 7.0)), 0.5, clamp(span * 3.5, 0.0, 1.0));
      float r2 = mix(vnoise(vec2(xh * 17.0 - uTime * 0.23, s * 3.0 + 9.0)), 0.5, clamp(span * 12.0, 0.0, 1.0));
      float rays = 0.12 + 0.88 * r1 * r1 * (0.45 + 1.1 * r2);
      float roll = 0.5 + 0.5 * sin(xh * 0.9 - uTime * 0.32 + s * 2.0);
      roll = 0.3 + 0.7 * roll * roll;
      // a sharp bright foot; rays fade upward, each reaching its own height
      float top = 0.45 + 0.55 * vnoise(vec2(xh * 1.7 + s, 3.0));
      float prof = smoothstep(0.0, 0.025, hy) * (0.22 + 0.5 * exp(-hy * 3.2) + 0.55 * exp(-hy * 22.0)) * (1.0 - smoothstep(top - 0.35, top, hy));
      // brighter where the sheet turns toward the eye and the ray runs along it
      float slope = (aurLine(xh + 0.06, s) - aurLine(xh - 0.06, s)) / 0.12;
      vec2 nrm = safeNormalize2(vec2(-slope, 1.0));
      float edge = clamp(0.32 / max(abs(nrm.x * d.x + nrm.y * d.z), 0.07), 0.4, 3.2);
      // green below, violet in the tall rays, a pink fringe at the foot when the display flares
      float shift = 0.5 + 0.5 * sin(uTime * 0.031 + xh * 0.21 + s);
      vec3 violet = mix(vec3(0.5, 0.2, 1.0), vec3(0.85, 0.2, 0.8), shift);
      float tall = smoothstep(0.26 - 0.12 * shift, 0.85 - 0.15 * shift, hy);
      vec3 col = mix(vec3(0.1, 1.0, 0.3), violet * (1.0 + 1.2 * tall), tall); // the thin violet tops glow brighter than their light falls off
      col = mix(col, vec3(1.0, 0.3, 0.6), (1.0 - smoothstep(0.0, 0.07, hy)) * 0.45 * uActivity);
      return col * rays * roll * prof * edge * w * inside;
    }
    void main(){
      vec3 d = safeNormalize(vDir);
      float px = length(fwidth(d));
      vec3 col = vec3(0.0);
      float up = smoothstep(0.0, 0.07, d.y);
      if (uAur > 0.0005 && up > 0.0) {
        // far round to the east and west the sheets run edge-on to the horizon: fade them there (not overhead)
        float side = mix(1.0 - smoothstep(2.0, 3.6, abs(d.x) / max(abs(d.z), 1e-3)), 1.0, smoothstep(0.45, 0.85, d.y));
        vec3 a = vec3(0.0);
        float z1 = mix(-6.0, -0.45, uLat), z2 = mix(-9.0, -2.1, uLat), z3 = mix(-13.0, 0.8, uLat);
        if (uQ > 1.5) {
          // high: each curtain has depth (two sheets a little apart)
          a += 0.55 * (aurCurtain(d, z1 - 0.1, 0.0, 1.0, px) + aurCurtain(d, z1 + 0.1, 0.0, 1.0, px));
          a += 0.55 * (aurCurtain(d, z2 - 0.12, 3.7, 0.75, px) + aurCurtain(d, z2 + 0.12, 3.7, 0.75, px));
          a += aurCurtain(d, z3, 7.9, 0.55, px);
        } else {
          a += aurCurtain(d, z1, 0.0, 1.0, px);
          a += aurCurtain(d, z2, 3.7, 0.75, px);
          if (uQ > 0.5) a += aurCurtain(d, z3, 7.9, 0.55, px);
        }
        a *= side;
        // the faint glow of the whole oval behind the curtains
        float el = asin(clamp(d.y, -1.0, 1.0));
        float ge = (el - mix(0.12, 0.62, uLat)) / 0.24;
        a += vec3(0.08, 0.5, 0.26) * exp(-ge * ge) * (1.0 - smoothstep(-0.6, 0.15, d.z)) * 0.2;
        // thick air near the horizon, and the sky's clouds in front
        a *= 0.35 + 0.65 * smoothstep(0.03, 0.35, d.y);
        float cloud = uQ > 0.5 ? aurCloud(d) : 0.0;
        col = a * uAur * up * (1.0 - cloud);
      }
      // the sky behind a curtain is deepened a little so the green reads as green (the blend uses this alpha as the
      // factor on the sky; the scene's alpha channel is left as it was)
      float deepen = clamp(dot(col, vec3(0.3, 0.55, 0.15)) * 0.9, 0.0, 0.32);
      gl_FragColor = vec4(min(safeColor(col), vec3(1.8)), deepen);
    }`,
}));
// Dormant night overlays must not submit/link shaders while their state is off.
AURORA.mesh.name = AURORA.mesh.material.name = 'Aurora curtains';
AURORA.mesh.visible = false;
AURORA.mesh.frustumCulled = false;
AURORA.mesh.renderOrder = -99;
scene.add(AURORA.mesh);

// a shooting star: a thin streak from its tail to its head, drawn far out along two sky directions
const aurStarGeo = new THREE.BufferGeometry();
aurStarGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1.12, -1, 0, 1.12, 1, 0, 0, 1, 0], 3));
aurStarGeo.setIndex([0, 1, 2, 0, 2, 3]);
const aurStarU = { uCloudCover: skyU.uCloudCover, uHead: { value: new THREE.Vector3(0, 1, 0) }, uTail: { value: new THREE.Vector3(0, 1, 0) }, uWidth: { value: 0.006 }, uAlpha: { value: 0 }, uCol: { value: new THREE.Vector3(1, 1, 1) } };
AURORA.star = new THREE.Mesh(aurStarGeo, mat({
  uniforms: aurStarU, depthWrite: false, depthTest: false, transparent: false, ...AUR_BLEND,
  vertexShader: /* glsl */`
    uniform vec3 uHead, uTail;
    uniform float uWidth;
    varying vec2 vC;
    varying vec3 vDir;
    void main(){
      vec3 h = normalize(uHead), tl = normalize(uTail);
      vec3 d = normalize(mix(tl, h, position.x));
      vec3 along = h - tl;
      vec3 side = normalize(cross(dot(along, along) > 1e-10 ? along : vec3(1.0, 0.0, 0.0), d));
      vec3 p = cameraPosition + (d + side * position.y * uWidth) * 500.0;
      vC = position.xy; vDir = d;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    uniform float uTime, uCloudCover, uAlpha;
    uniform vec3 uCol;
    varying vec2 vC;
    varying vec3 vDir;
    ${AUR_GLSL_CLOUD}
    void main(){
      float along = vC.x, across = vC.y;
      float core = exp(-across * across * 5.0), halo = exp(-across * across * 1.5) * 0.3;
      float trail = pow(clamp(along, 0.0, 1.0), 2.4) * (1.0 - smoothstep(1.0, 1.08, along));
      float hd = (along - 1.0) * 11.0;
      float head = exp(-hd * hd) * exp(-across * across * 2.0);
      float k = (trail * (core + halo) + head * 1.5) * uAlpha * (1.0 - aurCloud(safeNormalize(vDir)));
      gl_FragColor = vec4(safeColor(uCol * k), 0.0);
    }`,
}));
AURORA.star.name = AURORA.star.material.name = 'Shooting star';
AURORA.star.visible = false;
AURORA.star.frustumCulled = false;
AURORA.star.renderOrder = -98;
scene.add(AURORA.star);

function shootStar(o = {}) {
  const az = o.az ?? Math.random() * 360, el = o.el ?? 26 + Math.random() * 38;
  const daz = o.daz ?? (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 14), del = o.del ?? 6 + Math.random() * 12;
  compassDir(az, el, AUR_STAR.a);
  compassDir(az + daz, el - del, AUR_STAR.b);
  AUR_STAR.on = true; AUR_STAR.t = 0;
  AUR_STAR.dur = o.dur ?? 0.5 + Math.random() * 0.6;
  AUR_STAR.hold = o.hold ?? -1;
  AUR_STAR.bright = o.bright ?? 0.9 + Math.random() * 0.7;
  AUR_STAR.col = o.col || pick(Math.random, [[1.0, 1.0, 1.15], [0.85, 1.05, 1.25], [0.8, 1.25, 0.9], [1.25, 1.0, 0.75]]);
  AURORA.shots++;
}
// called every frame from tick, after the weather and time of day are applied
function updateNightSky(dt) {
  const W = WEATHER, out = !INDOOR.on;
  // how clear the sky is: cloud, rain or snow, storm and mist all hide the lights
  const clear = Math.pow(clamp(1 - W.overcast * 1.15, 0, 1), 2) * (1 - W.storm) * (1 - clamp(W.raining * 1.2, 0, 1)) * (1 - 0.7 * (W.mist || 0)) * (1 - 0.5 * W.fog);
  const dark = sstep(0.62, 0.9, U.uNight.value); // fades at dawn and dusk
  // over Thule (the north) the lights hang overhead; elsewhere they are faint and low in the north
  const cx = camera.position.x, cz = camera.position.z;
  const thule = inDungeonX(cx) ? 0 : realmWeightsAt(cx, cz)[2];
  const F = AURORA.force || {};
  const lat = F.lat ?? sstep(0.3, 0.88, thule);
  const target = (F.str ?? lerp(0.34, 1.0, lat)) * (F.clear ?? clear) * (F.dark ?? dark) * (out ? 1 : 0);
  const k = 1 - Math.exp(-dt / (F.str !== undefined ? 0.01 : 2.5));
  AURORA.str += (target - AURORA.str) * k;
  AURORA.lat += (lat - AURORA.lat) * (F.lat !== undefined ? 1 : 1 - Math.exp(-dt / 2.5));
  AURORA.clear = clear;
  aurU.uAur.value = AURORA.str * 1.05;
  aurU.uLat.value = AURORA.lat;
  aurU.uQ.value = quality.level === 'high' ? 2 : quality.level === 'medium' ? 1 : 0;
  aurU.uActivity.value = 0.6 + 0.4 * Math.sin(U.uTime.value * 0.013) * Math.sin(U.uTime.value * 0.0071 + 1);
  // These optional procedural/cloud shaders triggered a native link failure even
  // with zero effect uniforms. Recovery keeps the simple sky, sun and moon and
  // never submits either overlay; ordinary quality presets retain their effects.
  AURORA.on = AURORA.mesh.visible = !BOOT_SAFE && AURORA.str > 0.004;
  // shooting stars on clear dark nights
  if (out && clear > 0.7 && dark > 0.8 && !REDUCE_MOTION) {
    AURORA.next -= dt;
    if (AURORA.next <= 0) { AURORA.next = 7 + Math.random() * 22; if (!AUR_STAR.on) shootStar(); }
  }
  const S = AUR_STAR;
  if (S.on) {
    if (S.hold >= 0) S.t = S.hold * S.dur; else S.t += dt;
    const u = S.t / S.dur;
    if (u >= 1 || !out) S.on = false;
    else {
      const e = 1 - Math.pow(1 - u, 1.6);
      aurStarU.uHead.value.copy(S.a).lerp(S.b, e).normalize();
      aurStarU.uTail.value.copy(S.a).lerp(S.b, Math.max(0, e - 0.42)).normalize();
      aurStarU.uAlpha.value = S.bright * sstep(0, 0.1, u) * (1 - sstep(0.72, 1, u)) * (1 + 0.6 * Math.exp(-Math.pow((u - 0.62) / 0.08, 2))) * (0.4 + 0.6 * dark);
      aurStarU.uCol.value.set(S.col[0], S.col[1], S.col[2]);
    }
  }
  AURORA.star.visible = !BOOT_SAFE && S.on;
}

/* test hooks: window.__hm.aurora */
queueMicrotask(() => {
  if (!window.__hm) return;
  window.__hm.aurora = {
    A: AURORA, S: AUR_STAR, U: aurU, shootStar, updateNightSky,
    force(o) { AURORA.force = o || null; },
    state() { return { on: AURORA.on, str: +AURORA.str.toFixed(3), lat: +AURORA.lat.toFixed(3), clear: +AURORA.clear.toFixed(3), q: aurU.uQ.value, star: AUR_STAR.on, shots: AURORA.shots, visible: AURORA.mesh.visible }; },
  };
});
