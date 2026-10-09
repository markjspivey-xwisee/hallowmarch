/* ================================================================== */
/* weather: rain, storms with lightning, snow in the north, mist          */
/* ================================================================== */
// kinds: clear, cloudy, rain, storm, mist; precipitation turns to snow in Thule and on high ground
const WEATHER = {
  mode: 'auto', kind: 'clear', w: 0, target: 0, next: 90, wet: 0, snow: 0, snowing: 0, raining: 0,
  overcast: 0, fog: 0, storm: 0, flash: 0, nextBolt: 8, bolts: [], label: 'Clear',
};
const WEATHER_ODDS = [
  // clear, cloudy, rain, storm, mist
  [0.46, 0.24, 0.17, 0.07, 0.06],
  [0.3, 0.24, 0.2, 0.1, 0.16],
  [0.36, 0.26, 0.26, 0.08, 0.04],
];
const WEATHER_LOOK = {
  //        overcast  fog   rain  storm  mist
  clear: [0.0, 0.0, 0.0, 0.0, 0.0],
  cloudy: [0.75, 0.25, 0.0, 0.0, 0.0],
  rain: [0.95, 0.7, 1.0, 0.0, 0.0],
  storm: [1.0, 1.0, 1.0, 1.0, 0.0],
  mist: [0.45, 1.0, 0.0, 0.0, 1.0],
};
function setWeatherMode(m) {
  WEATHER.mode = m === 'clear' ? 'clear' : 'auto';
  if (WEATHER.mode === 'clear') { WEATHER.kind = 'clear'; }
  else WEATHER.next = Math.min(WEATHER.next, 20);
}
function chooseWeather(camX, camZ) {
  const realm = realmAt(camX, camZ);
  const odds = WEATHER_ODDS[realm];
  let r = Math.random(), i = 0;
  for (; i < odds.length - 1; i++) { if (r < odds[i]) break; r -= odds[i]; }
  return ['clear', 'cloudy', 'rain', 'storm', 'mist'][i];
}

/* ---- precipitation: drops and flakes live in a box that wraps around the camera ---- */
let rainMesh = null, snowMesh = null;
const RAIN_MAX = 9000, SNOW_MAX = 6500;
function precipGeometry(max, seed) {
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1, 1, 1);
  q.translate(0, 0.5, 0);
  g.setAttribute('position', q.attributes.position);
  g.setAttribute('uv', q.attributes.uv);
  g.setIndex(q.index);
  const r = mulberry(seed), a = new Float32Array(max * 4);
  for (let i = 0; i < max * 4; i++) a[i] = r();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = 0;
  return g;
}
const PRECIP_COMMON = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_WORLD}
  ${GLSL_ROOFS}
  uniform float uTime, uWind;
  uniform vec2 uWindDir;
  uniform vec3 uBox;
  attribute vec4 aSeed;
  // a point fixed in falling world space, wrapped into a box around the camera
  vec3 wrapPoint(vec3 seed, vec3 drift){
    vec3 p = seed * uBox + drift;
    return cameraPosition + mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  }
`;
function buildWeather() {
  const common = { transparent: true, depthWrite: false, side: THREE.DoubleSide };
  rainMesh = new THREE.Mesh(precipGeometry(RAIN_MAX, 11), mat({
    ...common,
    uniforms: { uBox: { value: new THREE.Vector3(38, 24, 38) }, uAmount: { value: 0 } },
    vertexShader: /* glsl */`
      ${PRECIP_COMMON}
      uniform float uAmount;
      varying float vA; varying vec2 vUv;
      void main(){
        vA = 0.0; vUv = uv;
        float fall = 12.0 + aSeed.w * 5.0;
        vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y) * uWind * 3.2;
        vec3 wp = wrapPoint(aSeed.xyz, vec3(wind.x * uTime, -fall * uTime, wind.z * uTime));
        vec3 rel = wp - cameraPosition;
        float hd = length(rel.xz);
        if (wp.y < terrainHeight(wp.xz) || hd > uBox.x * 0.5 || underRoof(wp)) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        vec3 dir = safeNormalize(vec3(wind.x, -fall, wind.z));
        vec3 side = safeNormalize(cross(dir, safeNormalize(rel)));
        vec3 p = wp - dir * position.y * (0.55 + 0.35 * aSeed.w) + side * position.x * 0.016 * (1.0 + hd * 0.03);
        vA = (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, hd)) * smoothstep(0.6, 2.5, length(rel)) * uAmount;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying float vA; varying vec2 vUv;
      void main(){
        float a = vA * (1.0 - abs(vUv.x * 2.0 - 1.0)) * smoothstep(0.0, 0.25, vUv.y) * 0.32;
        if (a < 0.004) discard;
        vec3 c = uAmbient * 0.9 + uLightColor * 0.25 + 0.05;
        gl_FragColor = vec4(safeColor(c), a);
      }`,
  }));
  rainMesh.frustumCulled = false; rainMesh.renderOrder = 7;
  scene.add(rainMesh);
  snowMesh = new THREE.Mesh(precipGeometry(SNOW_MAX, 23), mat({
    ...common,
    uniforms: { uBox: { value: new THREE.Vector3(30, 20, 30) }, uAmount: { value: 0 } },
    vertexShader: /* glsl */`
      ${PRECIP_COMMON}
      uniform float uAmount;
      varying float vA; varying vec2 vUv;
      void main(){
        vA = 0.0; vUv = uv;
        float fall = 0.9 + aSeed.w * 0.7;
        vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y) * uWind * 1.4;
        vec3 sway = vec3(sin(uTime * 1.1 + aSeed.w * 40.0), 0.0, cos(uTime * 0.9 + aSeed.x * 31.0)) * 0.45;
        vec3 wp = wrapPoint(aSeed.xyz, vec3(wind.x * uTime, -fall * uTime, wind.z * uTime) + sway);
        vec3 rel = wp - cameraPosition;
        float hd = length(rel.xz);
        if (wp.y < terrainHeight(wp.xz) || hd > uBox.x * 0.5 || underRoof(wp)) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        float s = 0.035 + 0.04 * fract(aSeed.w * 7.3);
        mv.xy += (position.xy - vec2(0.0, 0.5)) * s;
        vA = (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, hd)) * smoothstep(0.4, 1.5, length(rel)) * uAmount;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying float vA; varying vec2 vUv;
      void main(){
        float r = length(vUv * 2.0 - 1.0);
        float a = vA * (1.0 - smoothstep(0.35, 1.0, r)) * 0.85;
        if (a < 0.01) discard;
        vec3 c = uAmbient * 1.05 + uLightColor * 0.35 + 0.08;
        gl_FragColor = vec4(safeColor(c), a);
      }`,
  }));
  snowMesh.frustumCulled = false; snowMesh.renderOrder = 7;
  scene.add(snowMesh);
}

/* ---- the state of the sky, advanced every frame ---- */
function updateWeather(dt) {
  const W2 = WEATHER;
  const camX = camera.position.x, camZ = camera.position.z, camY = camera.position.y;
  if (W2.mode === 'clear') W2.kind = 'clear';
  else {
    W2.next -= dt;
    if (W2.next <= 0) {
      W2.kind = chooseWeather(camX, camZ);
      W2.next = W2.kind === 'clear' ? 200 + Math.random() * 220 : W2.kind === 'storm' ? 110 + Math.random() * 90 : 150 + Math.random() * 180;
    }
  }
  const look = WEATHER_LOOK[W2.kind];
  // ease the sky toward the new weather over half a minute
  const k = 1 - Math.exp(-dt / 9);
  W2.overcast += (look[0] - W2.overcast) * k;
  W2.fog += (look[1] - W2.fog) * k;
  W2.raining += (look[2] - W2.raining) * k;
  W2.storm += (look[3] - W2.storm) * k;
  W2.mist = (W2.mist || 0) + (look[4] - (W2.mist || 0)) * k;
  // rain falls as snow in the north and up high
  const cold = clamp(realmWeightsAt(camX, camZ)[2] * 1.3 - 0.15, 0, 1) * 0.85 + clamp((camY - 16) / 10, 0, 1) * 0.6;
  const coldK = clamp(cold, 0, 1);
  const precip = W2.raining;
  W2.snowing = precip * coldK;
  const rain = precip * (1 - coldK);
  // surfaces soak up the rain and dry out after it, faster in sun and wind; snow builds while it falls and melts
  // in sun and rain, slowly in the cold north (rates: 05h_wear.js)
  W2.wet = clamp(W2.wet + (rain > 0.2 ? dt * rain / 50 : -dt * weatherDryRate() / 140), 0, 1);
  W2.snow = clamp(W2.snow + (W2.snowing > 0.2 ? dt * W2.snowing / 70 : -dt * weatherMeltRate(coldK) / 200), 0, 1);
  U.uWet.value = W2.wet;
  U.uSnowCover.value = W2.snow;
  U.uRain.value = INDOOR.on ? 0 : rain;
  if (rainMesh) {
    rainMesh.material.uniforms.uAmount.value = rain;
    rainMesh.geometry.instanceCount = rain > 0.01 ? Math.round(RAIN_MAX * (quality.level === 'high' ? 1 : quality.level === 'medium' ? 0.6 : 0.32) * clamp(rain * 1.2, 0, 1)) : 0;
    snowMesh.material.uniforms.uAmount.value = W2.snowing;
    snowMesh.geometry.instanceCount = W2.snowing > 0.01 ? Math.round(SNOW_MAX * (quality.level === 'high' ? 1 : quality.level === 'medium' ? 0.6 : 0.35) * clamp(W2.snowing * 1.2, 0, 1)) : 0;
  }
  // splashes around the player
  if (rain > 0.25 && GAME.player && !INDOOR.on) {
    const P = GAME.player;
    W2.splash = (W2.splash || 0) + dt * 70 * rain;
    while (W2.splash >= 1) {
      W2.splash -= 1;
      const a = Math.random() * TAU, r = 1.5 + Math.random() * 11;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r, y = heightAt(x, z) + 0.03;
      if (houseRoofOver(x, z)) continue; // no splashes on a floor
      const A = U.uAmbient.value;
      fxAlpha.emit(x, y, z, (Math.random() - 0.5) * 0.6, 0.9 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6, 0.22, A.x * 0.9 + 0.1, A.y * 0.9 + 0.1, A.z * 0.9 + 0.12, 0.05, 9, 0);
    }
  }
  // lightning
  W2.flash = Math.max(0, W2.flash - dt * 4.5);
  if (W2.storm > 0.5 && !INDOOR.on) {
    W2.nextBolt -= dt;
    if (W2.nextBolt <= 0) { W2.nextBolt = 5 + Math.random() * 16; strikeLightning(camX, camZ); }
  }
  for (let i = W2.bolts.length - 1; i >= 0; i--) {
    const b = W2.bolts[i];
    b.t += dt;
    if (b.t > 0.45) { W2.bolts.splice(i, 1); continue; }
    // the bolt flickers: on, off, on again
    const on = b.t < 0.09 || (b.t > 0.16 && b.t < 0.26) || (b.t > 0.32 && b.t < 0.36);
    if (!on) continue;
    for (const p of b.path) glowPush(p[0], p[1], p[2], 2.4, 2.6, 3.2, p[3]);
  }
  W2.label = W2.kind === 'clear' ? 'Clear' : W2.kind === 'cloudy' ? 'Overcast' : W2.kind === 'mist' ? 'Mist' : W2.snowing > 0.3 ? (W2.kind === 'storm' ? 'Blizzard' : 'Snow') : W2.kind === 'storm' ? 'Storm' : 'Rain';
}
function strikeLightning(camX, camZ) {
  const a = Math.random() * TAU, d = 70 + Math.random() * 200;
  const x = camX + Math.cos(a) * d, z = camZ + Math.sin(a) * d, gy = heightAt(x, z);
  const path = [];
  let px = x + (Math.random() - 0.5) * 30, pz = z + (Math.random() - 0.5) * 30, py = gy + 140;
  while (py > gy) {
    const ny = Math.max(gy, py - 4 - Math.random() * 6);
    const nx = px + (Math.random() - 0.5) * 7 + (x - px) * 0.08, nz = pz + (Math.random() - 0.5) * 7 + (z - pz) * 0.08;
    const n = 3;
    for (let i = 1; i <= n; i++) path.push([lerp(px, nx, i / n), lerp(py, ny, i / n), lerp(pz, nz, i / n), 2.2 + Math.random() * 1.2]);
    px = nx; py = ny; pz = nz;
  }
  WEATHER.bolts.push({ path, t: 0 });
  WEATHER.flash = 1;
  lightFlash(x, gy + 20, z, 170, [3.0, 3.3, 4.2], 0.5);
  setTimeout(() => sfx(d < 120 ? 'thunderNear' : 'thunder'), (d / 343) * 1000 * 0.6);
}

/* ---- weather tints the time-of-day light; called right after applyTimeOfDay ---- */
function applyWeather() {
  const W2 = WEATHER;
  const oc = W2.overcast, fog = W2.fog, st = W2.storm, mist = W2.mist || 0;
  U.uWind.value = (REDUCE_MOTION ? 0.35 : 1) * (1 + 0.6 * oc * W2.raining + 1.1 * st);
  if (oc + fog + st + W2.flash < 0.002) { RAYS_BOOST.value = 1; return; }
  const L = U.uLightColor.value, A = U.uAmbient.value;
  const dim = 1 - 0.52 * oc - 0.25 * st;
  const grey = (v) => { const m = (v.x + v.y + v.z) / 3; v.set(lerp(v.x, m, oc * 0.55), lerp(v.y, m, oc * 0.55), lerp(v.z, m * 1.04, oc * 0.55)); };
  grey(L); grey(A);
  L.multiplyScalar(dim);
  A.multiplyScalar(1 - 0.12 * oc - 0.2 * st);
  // clouds close in; the sun's disc and shadows fade behind them
  skyU.uCloudCover.value = lerp(skyU.uCloudCover.value, 0.95, oc * 0.85);
  skyU.uSunVis.value *= 1 - 0.85 * oc;
  skyU.uMoonVis.value *= 1 - 0.85 * oc;
  skyU.uStars.value *= 1 - oc;
  for (const v of [skyU.uCloudLit.value, skyU.uCloudShade.value]) { grey(v); v.multiplyScalar(1 - 0.3 * oc - 0.35 * st); }
  for (const v of [U.uZenith.value, U.uHorizon.value]) { grey(v); v.multiplyScalar(1 - 0.22 * oc - 0.3 * st); }
  U.uSunGlow.value.multiplyScalar(1 - 0.8 * oc);
  U.uFogDensity.value *= 1 + 1.4 * fog + 2.2 * mist;
  RAYS_BOOST.value = (1 - 0.85 * oc) + mist * 1.4;
  // a lightning flash lights everything for a moment
  if (W2.flash > 0) {
    const f = W2.flash * W2.flash;
    A.addScalar(f * 0.9); A.z += f * 0.25;
    U.uZenith.value.addScalar(f * 0.6); U.uHorizon.value.addScalar(f * 0.5);
    skyU.uCloudLit.value.addScalar(f * 1.2); skyU.uCloudShade.value.addScalar(f * 0.8);
  }
}
