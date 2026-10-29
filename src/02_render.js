/* ================================================================== */
/* render core: renderer, shared uniforms, GLSL chunks, sky, post      */
/* ================================================================== */
const canvas = document.getElementById('scene');
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const MOTION_QUERY = matchMedia('(prefers-reduced-motion: reduce)');
const MOTION_PREF_KEY = 'hallowmarch.motion.v1';
let MOTION_MODE = 'system';
try { if (localStorage.getItem(MOTION_PREF_KEY) === 'reduced') MOTION_MODE = 'reduced'; } catch (e) { /* a device preference must not block play */ }
let REDUCE_MOTION = MOTION_MODE === 'reduced' || MOTION_QUERY.matches;
function syncMotionPreference() {
  REDUCE_MOTION = MOTION_MODE === 'reduced' || MOTION_QUERY.matches;
  document.documentElement?.setAttribute('data-reduced-motion', String(REDUCE_MOTION));
}
function setMotionMode(mode) {
  if (mode !== 'system' && mode !== 'reduced') return;
  MOTION_MODE = mode; syncMotionPreference();
  try { localStorage.setItem(MOTION_PREF_KEY, mode); } catch (e) { /* private browsing can refuse preferences */ }
}
syncMotionPreference();
MOTION_QUERY.addEventListener?.('change', syncMotionPreference);

const GRAPHICS_TRACE_KEY = 'hallowmarch.graphics.trace.v1';
const GRAPHICS_RECOVERY_KEY = 'hallowmarch.graphics.recovery.v1';
let GRAPHICS_CONTEXT_LOST = false;
let graphicsPrevious = null;
try { graphicsPrevious = JSON.parse(sessionStorage.getItem(GRAPHICS_TRACE_KEY) || 'null'); } catch (e) { /* diagnostics never gate startup */ }
function graphicsRememberRecovery() {
  try { localStorage.setItem(GRAPHICS_RECOVERY_KEY, JSON.stringify({ v: 1, enabled: true })); } catch (e) { /* browser storage may be unavailable */ }
}
let GRAPHICS_RECOVERY_SOURCE = 'standard';
function graphicsRecoverySelection() {
  const choice = new URLSearchParams(location.search).get('safe');
  if (choice === '0') {
    try { localStorage.removeItem(GRAPHICS_RECOVERY_KEY); } catch (e) { /* explicit override still works */ }
    return false;
  }
  if (choice === '1') { GRAPHICS_RECOVERY_SOURCE = 'explicit'; graphicsRememberRecovery(); return true; }
  try {
    const saved = JSON.parse(localStorage.getItem(GRAPHICS_RECOVERY_KEY) || 'null');
    if (saved && saved.v === 1 && saved.enabled === true) { GRAPHICS_RECOVERY_SOURCE = 'remembered'; return true; }
  } catch (e) { /* invalid or blocked storage never prevents startup */ }
  // Migrate this browser tab's previous failure/reduced launch. This preference
  // stays on this device/browser origin; it never enters an owned character save.
  if (graphicsPrevious && (graphicsPrevious.recovery === true || graphicsPrevious.lost > 0 || graphicsPrevious.stopped === true)) {
    GRAPHICS_RECOVERY_SOURCE = 'previous-session'; graphicsRememberRecovery(); return true;
  }
  return false;
}
const BOOT_SAFE = graphicsRecoverySelection();
function graphicsRecoveryURL(reduced) {
  const target = new URL(location.href);
  target.searchParams.set('safe', reduced ? '1' : '0');
  target.searchParams.delete('gpuDiag');
  return target.href;
}
function graphicsRecoveryNotice() {
  if (!BOOT_SAFE) return;
  const title = document.getElementById('title');
  const host = title && title.querySelector('.card-foot');
  if (!host || document.getElementById('graphics-recovery')) return;
  const notice = document.createElement('p'); notice.id = 'graphics-recovery'; notice.className = 'fineprint';
  notice.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'Reduced graphics are active for this browser. Your saved graphics preferences are unchanged.';
  const retry = document.createElement('a'); retry.href = graphicsRecoveryURL(false);
  retry.textContent = 'Try standard graphics';
  notice.appendChild(text); notice.appendChild(retry); host.appendChild(notice);
}
const GRAPHICS_STARTUP = window.__hmStartup = { recovery: BOOT_SAFE, recoverySource: GRAPHICS_RECOVERY_SOURCE, titleSubmitted: 0, titleCompleted: 0, phase: 'Creating graphics context', events: [], lost: 0, restored: 0, stopped: false, previous: graphicsPrevious };
function graphicsCheckpoint(phase, message = '') {
  GRAPHICS_STARTUP.phase = phase;
  GRAPHICS_STARTUP.events.push({ phase, message: String(message).slice(0, 500), at: Math.round(performance.now()) });
  if (GRAPHICS_STARTUP.events.length > 32) GRAPHICS_STARTUP.events.shift();
  try {
    const { recovery, phase: stage, events, lost, restored, stopped } = GRAPHICS_STARTUP;
    sessionStorage.setItem(GRAPHICS_TRACE_KEY, JSON.stringify({ recovery, phase: stage, events, lost, restored, stopped }));
  } catch (e) { /* private storage may be unavailable */ }
  console.info('[Hallowmarch graphics]', phase, message);
}
graphicsCheckpoint(GRAPHICS_STARTUP.phase);
let GRAPHICS_START_MESSAGE = '';
canvas.addEventListener('webglcontextcreationerror', (event) => {
  GRAPHICS_START_MESSAGE = String(event.statusMessage || '').slice(0, 500);
  graphicsCheckpoint('Graphics context creation failed', GRAPHICS_START_MESSAGE);
});
// Register before gameplay capture handlers; takeover activates this delegate.
window.addEventListener('keydown', (event) => {
  const notice = document.getElementById('nogl');
  if (!notice || notice.hidden || !notice._graphicsFailureKeys) return;
  notice._graphicsFailureKeys(event);
}, true);
function graphicsFailureTakeover(notice) {
  // A failed game cannot retain a sheet's focus trap or accept world shortcuts.
  // Use exported state only: renderer creation can fail before UI is initialized.
  for (const panel of document.querySelectorAll('#title, #hud, .overlay, #lore-pro, #netchat')) {
    panel.hidden = true; panel.inert = true;
  }
  for (const surface of document.body.children) if (surface !== notice) surface.inert = true;
  const state = window.__hm;
  if (state && state.UI) state.UI.modal = null;
  notice.inert = false;
  notice.hidden = false;
  if (notice._graphicsFailureKeys) return;
  notice._graphicsFailureKeys = (event) => {
    if (notice.hidden) return;
    // Leave native link/disclosure activation intact while blocking game handlers.
    event.stopImmediatePropagation();
    if (event.key !== 'Tab') return;
    const controls = [...notice.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden], [inert]') && node.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (!controls.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
}
function graphicsStartFailure(error, title = 'Graphics could not start') {
  const loading = document.getElementById('loading'), notice = document.getElementById('nogl');
  if (loading) { loading.hidden = true; loading.style.display = 'none'; }
  if (!notice) return;
  graphicsFailureTakeover(notice);
  notice.setAttribute('role', 'alert');
  const diagnostic = GRAPHICS_START_MESSAGE || String(error && error.message || error);
  const unavailable = /(?:GL_VENDOR|GL_RENDERER|VENDOR|RENDERER)\s*[:=]\s*["']?Disabled\b|BindToCurrentSequence/i.test(diagnostic);
  const unsupported = !unavailable && String(error && error.message || error) === 'WebGL 2 is not available in this browser.';
  const heading = document.createElement('strong');
  heading.id = 'graphics-failure-title';
  heading.textContent = unavailable ? 'Browser graphics are unavailable' : unsupported ? 'Graphics are not supported' : title;
  notice.setAttribute('aria-labelledby', heading.id);
  const detail = document.createElement('span');
  detail.textContent = unavailable ? 'This browser could not provide a working graphics connection.'
    : unsupported ? 'This browser does not provide the graphics features Hallowmarch needs.'
      : GRAPHICS_CONTEXT_LOST ? 'The browser stopped the game\'s graphics.'
        : title === 'Graphics stopped' ? 'The game could not finish preparing graphics.' : 'The game could not start graphics in this browser.';
  const help = document.createElement('span');
  help.textContent = unavailable ? 'Reduced graphics cannot restore a disabled browser graphics connection. Close this game tab and restart the browser, then retry. Your saved character is kept.'
    : unsupported ? 'Use a browser with WebGL 2 support, or restart this browser before retrying. Your saved character is kept.'
      : BOOT_SAFE ? 'Reduced graphics were already active. Close this game tab and restart the browser before trying again. Your saved character is kept.'
        : GRAPHICS_CONTEXT_LOST ? 'Close this game tab and restart the browser before trying reduced graphics. Your saved character is kept.'
          : 'Try reduced graphics. If the problem continues, close this game tab and restart the browser before trying again. Your saved character is kept.';
  const retry = document.createElement('a');
  retry.href = graphicsRecoveryURL(unavailable || unsupported ? BOOT_SAFE : true);
  retry.className = 'btn primary graphics-retry';
  retry.textContent = unavailable || unsupported ? 'Retry loading' : BOOT_SAFE ? 'Retry reduced graphics' : 'Try reduced graphics';
  const technical = document.createElement('details');
  technical.className = 'graphics-technical';
  const summary = document.createElement('summary'); summary.textContent = 'Technical details';
  const log = document.createElement('pre'); log.textContent = diagnostic;
  technical.appendChild(summary); technical.appendChild(log);
  notice.replaceChildren(heading, detail, help, retry, technical);
  retry.focus?.({ preventScroll: true });
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  if (GRAPHICS_CONTEXT_LOST) return;
  const stage = GRAPHICS_STARTUP.phase;
  GRAPHICS_CONTEXT_LOST = true;
  GRAPHICS_STARTUP.lost++;
  GRAPHICS_STARTUP.stopped = true;
  graphicsRememberRecovery();
  GRAPHICS_START_MESSAGE = 'Graphics stopped during ' + stage + (event.statusMessage ? ': ' + event.statusMessage : '.');
  graphicsCheckpoint(stage, GRAPHICS_START_MESSAGE);
  const state = window.__hm;
  if (state) {
    // Capture progress while saveNow still sees a ready game; no GPU access is needed.
    try { state.fn.saveNow(); } catch (e) { console.error(e); }
    state.ready = false;
    state.GAME.ready = false;
  }
  for (const id of ['title', 'hud', 'menu']) { const panel = document.getElementById(id); if (panel) panel.hidden = true; }
  graphicsStartFailure(new Error(GRAPHICS_START_MESSAGE), 'Graphics stopped');
  console.error('[Hallowmarch graphics]', GRAPHICS_START_MESSAGE);
});
canvas.addEventListener('webglcontextrestored', () => {
  GRAPHICS_STARTUP.restored++;
  graphicsCheckpoint(GRAPHICS_STARTUP.phase, 'Graphics context restored; waiting for a manual reload.');
  // The scene may have released its CPU buffers. Do not restart this GPU workload automatically.
});
function graphicsAssertActive() {
  if (GRAPHICS_CONTEXT_LOST) throw new Error('Graphics stopped during ' + GRAPHICS_STARTUP.phase);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: BOOT_SAFE ? 'default' : 'high-performance' });
} catch (e) {
  graphicsStartFailure(e);
  throw e;
}
if (!renderer.capabilities.isWebGL2) {
  const error = new Error('WebGL 2 is not available in this browser.');
  graphicsStartFailure(error);
  renderer.dispose();
  throw error;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.autoClear = false;
renderer.setClearColor(0x000000, 1);
const gl = renderer.getContext();
const FLOAT_RT = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
const RT_TYPE = !BOOT_SAFE && FLOAT_RT ? THREE.HalfFloatType : THREE.UnsignedByteType;
const MAX_POINT = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;

const QUALITY_PRESETS = {
  high: { dpr: 1.6, msaa: 4, grass: 1.0, flowers: 1.0, treeDist: 380, nearTrees: 42, bloom: 5, label: 'High' },
  medium: { dpr: 1.25, msaa: 2, grass: 0.62, flowers: 0.7, treeDist: 300, nearTrees: 28, bloom: 5, label: 'Medium' },
  low: { dpr: 1.0, msaa: 0, grass: 0.36, flowers: 0.45, treeDist: 200, nearTrees: 0, bloom: 4, label: 'Low' }, // [motion] treeDist 230 -> 200: the farthest chunks are lost in the fog at low
};
// An unknown desktop GPU must draw its first view before adaptive detail has
// any frame timings. Saved and manual quality choices still apply normally.
const GRAPHICS_BOOT_LEVEL = BOOT_SAFE ? 'low' : 'medium';
const quality = { level: GRAPHICS_BOOT_LEVEL, ...QUALITY_PRESETS[GRAPHICS_BOOT_LEVEL] };
graphicsCheckpoint('Preparing graphics data');

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
camera.rotation.order = 'YXZ';
const scene = new THREE.Scene();

// a black texel for world maps that are not built yet (visual pass: meadow, canopy and ground shade)
const ZERO_TEX = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
ZERO_TEX.needsUpdate = true;
/* Shared uniforms (live objects; materials reference them directly) */
const U = {
  uTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uLightColor: { value: new THREE.Vector3(1, 1, 1) },
  uAmbient: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
  uZenith: { value: new THREE.Vector3() },
  uHorizon: { value: new THREE.Vector3() },
  uSunGlow: { value: new THREE.Vector3() },
  uGlowDir: { value: new THREE.Vector3(0, 0, -1) },
  uFogDensity: { value: 0.004 },
  uNight: { value: 0 },
  uPetals: { value: 1 },
  uBladeWidth: { value: 1 },
  uGrassBase: { value: new THREE.Vector3() },
  uGrassTip: { value: new THREE.Vector3() },
  uGrassTrans: { value: new THREE.Vector3() },
  uLeaf: { value: new THREE.Vector3() },
  uBark: { value: new THREE.Vector3() },
  uGlowColor: { value: new THREE.Vector3(0.24, 0.7, 0.54) },
  uWindDir: { value: new THREE.Vector2(0.92, 0.38).normalize() },
  uWind: { value: REDUCE_MOTION ? 0.35 : 1 },
  uHeightTex: { value: null },
  uWorldA: { value: null },
  uWorldB: { value: null },
  uCanopy: { value: ZERO_TEX }, // visual pass: meadow patches (rgb) and tree crown cover (a), one texel per 2 m (03_terrain.js)
  uGroundAO: { value: ZERO_TEX }, // visual pass: contact shade round the foot of walls and houses, 1 m texels (03_terrain.js)
  uTrail: { value: null },
  uTrailBounds: { value: new THREE.Vector4(-32, -32, 64, 64) },
  uDecal: { value: null },
  uDecalBounds: { value: new THREE.Vector4(-48, -48, 96, 96) },
  uTargetColor: { value: new THREE.Vector3(1, 0.85, 0.3) },
  uAoeColor: { value: new THREE.Vector3(1, 0.5, 0.2) },
  // sun/moon shadow map (filled by the shadow pass in the main loop)
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uNearTree: { value: new THREE.Vector3(0, 0, -100) },
  uCamFocus: { value: new THREE.Vector3(0, -1000, 0) },
  uFoliageCut: { value: 0.5 },
  uShadowParams: { value: new THREE.Vector4(1 / 2048, 0.0006, 0.05, 5) },
  // nearby point lights: fires, lanterns, spells, lightning (filled each frame)
  uPLPos: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, -1000, 0, 0.001)) },
  uPLCol: { value: Array.from({ length: 12 }, () => new THREE.Vector4()) },
  uPLN: { value: 0 },
  // weather: wetness of surfaces, flash of lightning
  uWet: { value: 0 },
  uSnowCover: { value: 0 },
  uRain: { value: 0 }, // feature/weather: how hard it is raining right now (rings on the water)
  uFlashLight: { value: 0 },
  // [water2] under the water (07d_dive.js): x the eye is under, y the surface over it, z the water's murk per metre, w its depth; and the water's own colour
  uUnder: { value: new THREE.Vector4(0, -1000, 0.1, 0) },
  uUnderCol: { value: new THREE.Vector3(0.04, 0.1, 0.1) },
  // [weather2] the clouds (12c_weather2.js): the cloud field over the land round the camera (r density, g how tall, b rain,
  // a storm; warped so it reaches the horizon), where it lies (camera x, z, the warp's radius, the cloud base's y), the
  // sun's or moon's way through it to the ground (x, z per metre up, strength); the dome of the sky ray-marched through
  // it (rgb the cloud's light, a what it lets through) and whether it is drawn; a flash in the cloud; mist in the valleys
  uCloudMap: { value: ZERO_TEX },
  uCloudMapP: { value: new THREE.Vector4(0, 0, 1500, 230) },
  uCloudSh: { value: new THREE.Vector4(0, 0, 0, 0) },
  uCloudDome: { value: ZERO_TEX },
  uCloudDomeOn: { value: new THREE.Vector4(0, 0, 0, 0) },
  uCloudScr: { value: ZERO_TEX }, // [weather2] the main view's own clouds (x, y one over the view's size, z on)
  uCloudScrP: { value: new THREE.Vector4(1, 1, 0, 0) },
  uWxFlash: { value: new THREE.Vector4(0, 1, 0, 0) },
  uMist: { value: new THREE.Vector4(0, 0, 0.12, 0) },
};
const PL_MAX = 12;

const GLSL_COMMON = /* glsl */`
vec3 finite3(vec3 v){ return mix(v, vec3(0.0), equal(floatBitsToUint(v) & uvec3(0x7f800000u), uvec3(0x7f800000u))); }
float finite1(float v){ return ((floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u) ? 0.0 : v; }
vec3 safeColor(vec3 c){ return clamp(finite3(c), 0.0, 8.0); }
vec3 safeNormalize(vec3 v){ return v * inversesqrt(max(1e-12, dot(v, v))); }
vec2 safeNormalize2(vec2 v){ return v * inversesqrt(max(1e-12, dot(v, v))); }
float spow(float x, float y){ return pow(max(0.0, x), y); }
float satan(float y, float x){ return (abs(x) + abs(y) < 1e-7) ? 0.0 : atan(y, x); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.02 + vec2(13.7, 7.1); a *= 0.5; } return s; }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(5.3, 1.7); a *= 0.5; } return s / 0.875; }
// ordered dither threshold for screen-door fades (two fades using it stay complementary)
float bayer4(vec2 p){ ivec2 q = ivec2(mod(floor(p), 4.0)); const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0); return (B[q.x + q.y * 4] + 0.5) / 16.0; }
`;

const GLSL_ATMOS = /* glsl */`
uniform float uTime;
uniform vec3 uLightDir, uLightColor, uAmbient;
uniform vec3 uZenith, uHorizon, uSunGlow, uGlowDir;
uniform float uFogDensity, uNight;
uniform vec4 uUnder; uniform vec3 uUnderCol; // [water2] (07d_dive.js)
uniform vec4 uMist; // [weather2] mist in the valleys: density, its floor's y, 1 / its depth (12c_weather2.js)
vec3 skyBase(vec3 dir){
  float e = clamp(dir.y, -0.2, 1.0);
  float k = smoothstep(-0.03, 0.52, e);
  vec3 c = mix(uHorizon, uZenith, spow(k, 0.8));
  float g = max(0.0, dot(dir, uGlowDir));
  c += uSunGlow * (spow(g, 8.0) * 0.07 + spow(g, 900.0) * 0.22);
  // visual pass: a broad warm band along the horizon on the sun's side (the glow colour is near black at midday)
  c += uSunGlow * spow(g, 3.0) * 0.16 * (1.0 - 0.8 * k);
  return c;
}
vec3 fogColor(vec3 dir){ return skyBase(safeNormalize(vec3(dir.x, 0.012 + max(dir.y, 0.0) * 0.5, dir.z))); }
// visual pass: the haze thins with height (exponential height fog integrated along the view ray), so valleys and the
// foot of a slope sink into it while ridges and peaks stand out; at the camera's own height it is as thick as before
// [water2] under the water (07d_dive.js): the water between the eye and what it sees takes the red first, then everything,
// toward its own colour (d metres of water, looking up by 'up')
vec3 underFogD(vec3 col, float d, float up){
  vec3 ab = exp(-d * uUnder.z * vec3(2.4, 0.95, 0.8));
  // the water's own glow is brighter looking up toward the light, darker looking down into the deep
  vec3 fc = uUnderCol * (0.62 + 0.75 * smoothstep(-0.7, 0.85, up));
  return mix(col * ab, fc, 1.0 - exp(-d * uUnder.z * 1.3));
}
vec3 underFog(vec3 col, vec3 wpos){
  vec3 v = wpos - cameraPosition;
  float d = length(v);
  return underFogD(col, d, v.y / max(d, 1e-3));
}
vec3 applyFog(vec3 col, vec3 wpos){
  if (uUnder.x > 0.5 && wpos.y < uUnder.y + 0.05) return underFog(col, wpos); // [water2]
  vec3 v = wpos - cameraPosition;
  float d = length(v);
  const float FK = 0.02;
  float c0 = exp(-FK * clamp(cameraPosition.y - 2.0, -6.0, 400.0));
  float dy = v.y * FK;
  float hk = abs(dy) > 1e-3 ? (1.0 - exp(-dy)) / dy : 1.0 - 0.5 * dy;
  float f = 1.0 - exp(-d * uFogDensity * clamp(c0 * hk, 0.0, 2.5));
  // [weather2] mist lying in the valleys: a thin dense layer over its floor (uMist.y), thinning fast with height (12c_weather2.js)
  if (uMist.x > 0.0) {
    float c2 = exp(-uMist.z * clamp(cameraPosition.y - uMist.y, -30.0, 300.0));
    float dy2 = v.y * uMist.z;
    float hk2 = abs(dy2) > 1e-3 ? (1.0 - exp(-dy2)) / dy2 : 1.0 - 0.5 * dy2;
    f = 1.0 - (1.0 - f) * exp(-d * uMist.x * clamp(c2 * hk2, 0.0, 8.0));
  }
  // [water2] above the surface, seen from under it: the air's haze, then the water up to where the ray leaves it (through
  // the surface's window; a seam at a shore or a river's step shows nothing but water, so far off is it)
  if (uUnder.x > 0.5) { vec3 a = mix(col, fogColor(v / max(d, 1e-4)), clamp(f, 0.0, 1.0)); return underFogD(a, clamp((uUnder.y - cameraPosition.y) / max(v.y, 1e-4), 0.0, 1.0) * d, v.y / max(d, 1e-3)); }
  return mix(col, fogColor(v / max(d, 1e-4)), clamp(f, 0.0, 1.0));
}
`;

/* point lights: smooth windowed falloff, a little wrap so faces turned half away still glow */
const GLSL_PLIGHT = /* glsl */`
uniform vec4 uPLPos[${PL_MAX}];
uniform vec4 uPLCol[${PL_MAX}];
uniform int uPLN;
vec3 pointLights(vec3 wp, vec3 n){
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${PL_MAX}; i++) {
    if (i >= uPLN) break;
    vec3 d = uPLPos[i].xyz - wp;
    float r = uPLPos[i].w;
    float dd = dot(d, d);
    if (dd >= r * r) continue;
    float x = sqrt(dd) / r;
    float att = 1.0 - x * x; att *= att;
    att /= 1.0 + dd * 0.06;
    float ndl = clamp(dot(n, d * inversesqrt(max(dd, 1e-4))) * 0.75 + 0.25, 0.0, 1.0);
    sum += uPLCol[i].rgb * (att * ndl);
  }
  return sum;
}
`;
/* ---- weather on surfaces (amounts come from 05e_weather.js and 05h_wear.js); needs GLSL_COMMON and GLSL_ATMOS ----
   Rain darkens what soaks it up and glosses everything, runs down steep faces in trickles; snow settles on what faces
   the sky, builds up as it falls and melts by fires and torches. Every material calls these with its own amounts, so
   a sheltered surface simply passes a smaller wetness. */
const GLSL_WEATHER = /* glsl */`
// porosity: 0 metal or glass, 0.3 skin or dressed stone, 0.6 wood and rough stone, 1 cloth, thatch and earth
vec3 wetAlbedo(vec3 alb, float wet, float por){ return alb * (1.0 - clamp(wet, 0.0, 1.0) * mix(0.06, 0.5, por)); }
// a film of water: the sky mirrored in it and a hard glint of the sun
vec3 wetSheen(vec3 wp, vec3 n, vec3 V, float wet, float por, float sh){
  if (wet < 0.01) return vec3(0.0);
  vec3 R = reflect(-V, n);
  float fres = 0.02 + 0.98 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 sky = skyBase(safeNormalize(vec3(R.x, max(R.y, 0.03), R.z)));
  vec3 H = safeNormalize(uLightDir + V);
  float glint = spow(max(dot(n, H), 0.0), mix(260.0, 70.0, por)) * mix(1.4, 0.5, por);
  return (sky * fres * 0.5 + uLightColor * glint * sh) * clamp(wet, 0.0, 1.0) * (1.0 - 0.5 * por);
}
// water running down a steep face: thin bright trickles sliding down
float rivulets(vec3 wp, vec3 n, float wet){
  float steep = 1.0 - smoothstep(0.35, 0.7, abs(n.y));
  if (wet < 0.05 || steep < 0.01) return 0.0;
  float u = dot(wp.xz, safeNormalize2(vec2(-n.z, n.x) + vec2(1e-4))) * 6.0;
  float lane = smoothstep(0.8, 0.96, vnoise(vec2(u, 3.7)));
  float flow = smoothstep(0.5, 0.9, vnoise(vec2(u * 1.3, wp.y * 1.6 + uTime * 2.4)));
  return lane * flow * steep * smoothstep(0.3, 0.9, wet);
}
// how much snow lies here: on what faces up, drifted by the wind, thicker as it builds, gone where fire or torchlight warms it
float snowAmount(vec3 wp, vec3 n, float cover, vec3 heat){
  if (cover < 0.01) return 0.0;
  float drift = vnoise(wp.xz * 1.9 + wp.y * 0.7) * 0.6 + vnoise(wp.xz * 7.3 + wp.y * 3.1) * 0.4;
  float up = smoothstep(0.3, 0.72, n.y + (drift - 0.5) * 0.3 + cover * 0.12);
  float lay = smoothstep(0.1, 0.45, cover * 1.3 + (drift - 0.5) * 0.6 - 0.15);
  float melt = smoothstep(0.1, 0.5, dot(heat, vec3(0.33)));
  return clamp(up * lay * (1.0 - melt), 0.0, 1.0);
}
vec3 snowAlbedo(vec3 wp){ return vec3(0.86, 0.89, 0.95) * (0.93 + 0.09 * vnoise(wp.xz * 13.0 + wp.y * 5.0)); }
// a crystal catching the sun here and there
float snowSparkle(vec3 wp, vec3 V, float sh){ return step(0.988, hash12(floor(wp.xz * 38.0 + wp.y * 9.0))) * sh * (0.5 + 0.5 * max(dot(V, uLightDir), 0.0)); }
`;
/* soft shadows from the sun or moon; need GLSL_COMMON first */
const GLSL_SHADOW_BASE = /* glsl */`
uniform highp sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec4 uShadowParams; // texel, depth bias, normal offset (m), taps
vec3 shadowCoord(vec3 wp){ vec4 sp = uShadowMatrix * vec4(wp, 1.0); return sp.xyz / sp.w; }
float shadowEdge(vec3 s){ vec2 e = smoothstep(0.0, 0.07, s.xy) * smoothstep(0.0, 0.07, 1.0 - s.xy); return e.x * e.y; }
bool shadowOut(vec3 s){ return s.x <= 0.001 || s.y <= 0.001 || s.x >= 0.999 || s.y >= 0.999 || s.z >= 1.0; }
// [weather2] the clouds' shadows: the cloud field read where the light's way from here meets the cloud base (12c_weather2.js)
uniform sampler2D uCloudMap;
uniform vec4 uCloudMapP, uCloudSh;
vec4 cloudMapAt(vec2 xz){ vec2 d = xz - uCloudMapP.xy; vec2 q = d / (uCloudMapP.z + length(d)); return texture(uCloudMap, q * 0.5 + 0.5); }
float cloudShade(vec3 wp){
  if (uCloudSh.w < 0.001) return 1.0;
  vec4 c = cloudMapAt(wp.xz + uCloudSh.xy * max(uCloudMapP.w + 60.0 - wp.y, 0.0));
  return 1.0 - uCloudSh.w * smoothstep(0.08, 0.75, c.r) * (0.75 + 0.25 * c.g);
}
`;
// fragment stage: rotated Poisson PCF
const GLSL_SHADOW = GLSL_SHADOW_BASE + /* glsl */`
const vec2 SH_TAPS[9] = vec2[9](vec2(0.0, 0.0), vec2(-0.94, -0.34), vec2(0.94, 0.34), vec2(-0.34, 0.94), vec2(0.34, -0.94), vec2(-0.66, 0.66), vec2(0.66, -0.66), vec2(0.0, -0.55), vec2(0.0, 0.55));
float shadowAt(vec3 wp, vec3 n){
  float cs = cloudShade(wp); // [weather2]
  if (uShadowOn < 0.01) return cs;
  vec3 s = shadowCoord(wp + n * uShadowParams.z);
  if (shadowOut(s)) return cs;
  int taps = int(uShadowParams.w + 0.5);
  float ang = hash12(floor(gl_FragCoord.xy)) * 6.2831853;
  mat2 rm = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  float r = 1.7 * uShadowParams.x, sum = 0.0;
  for (int i = 0; i < 9; i++) {
    if (i >= taps) break;
    sum += step(s.z - uShadowParams.y, texture(uShadowMap, s.xy + rm * SH_TAPS[i] * r).r);
  }
  return cs * mix(1.0, sum / float(max(taps, 1)), shadowEdge(s) * uShadowOn);
}
`;
// vertex stage: one tap (grass blades, flowers)
const GLSL_SHADOW_V = GLSL_SHADOW_BASE + /* glsl */`
float shadowAtV(vec3 wp, vec2 jit){
  float cs = cloudShade(wp); // [weather2]
  if (uShadowOn < 0.01) return cs;
  vec3 s = shadowCoord(wp + vec3(0.0, 0.06, 0.0));
  if (shadowOut(s)) return cs;
  float v = step(s.z - uShadowParams.y * 2.0, textureLod(uShadowMap, s.xy + jit * uShadowParams.x * 1.6, 0.0).r);
  return cs * mix(1.0, v, shadowEdge(s) * uShadowOn);
}
`;

/* the sun's shadow map: one orthographic view that follows the camera, snapped to its texels */
const SHADOW = { rt: null, size: 0, half: 44, near: 1, far: 420, cam: new THREE.OrthographicCamera(-44, 44, 44, -44, 1, 420), scene: new THREE.Scene(), proxies: [] };
SHADOW.scene.matrixWorldAutoUpdate = false;
const SHADOW_LEVELS = { high: { size: 2048, half: 46, taps: 7 }, medium: { size: IS_TOUCH ? 1024 : 1536, half: 38, taps: 5 }, low: null };
function setupShadows(level) {
  const L = SHADOW_LEVELS[BOOT_SAFE ? 'low' : level];
  if (!L) {
    if (SHADOW.rt) { SHADOW.rt.dispose(); SHADOW.rt = null; }
    SHADOW.size = 0; U.uShadowOn.value = 0; U.uShadowMap.value = null;
    return;
  }
  if (!SHADOW.rt || SHADOW.size !== L.size) {
    if (SHADOW.rt) SHADOW.rt.dispose();
    const dt = new THREE.DepthTexture(L.size, L.size, THREE.UnsignedIntType);
    dt.minFilter = THREE.NearestFilter; dt.magFilter = THREE.NearestFilter;
    SHADOW.rt = new THREE.WebGLRenderTarget(L.size, L.size, { depthBuffer: true, stencilBuffer: false, depthTexture: dt, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    SHADOW.size = L.size;
  }
  SHADOW.half = L.half;
  const C = SHADOW.cam;
  C.left = -L.half; C.right = L.half; C.top = L.half; C.bottom = -L.half; C.near = SHADOW.near; C.far = SHADOW.far;
  C.updateProjectionMatrix();
  U.uShadowMap.value = SHADOW.rt.depthTexture;
  // texel size, depth bias (4 cm over the depth range), normal offset in metres, PCF taps
  U.uShadowParams.value.set(1 / L.size, 0.045 / (SHADOW.far - SHADOW.near), 1.5 * (2 * L.half / L.size), L.taps);
}
const _shBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _shR = new THREE.Vector3(), _shU = new THREE.Vector3(), _shO = new THREE.Vector3();
function updateShadowCamera(cx, cy, cz) {
  const C = SHADOW.cam, Ld = U.uLightDir.value;
  C.position.set(cx + Ld.x * 230, cy + Ld.y * 230, cz + Ld.z * 230);
  C.up.set(0, 1, 0);
  if (Math.abs(Ld.y) > 0.995) C.up.set(0, 0, 1);
  C.lookAt(cx, cy, cz);
  C.updateMatrixWorld(true);
  // slide the camera in its own plane so world points land on the same texels from frame to frame
  const texel = (2 * SHADOW.half) / SHADOW.size;
  _shO.set(0, 0, 0).applyMatrix4(C.matrixWorldInverse);
  const dx = _shO.x - Math.round(_shO.x / texel) * texel, dy = _shO.y - Math.round(_shO.y / texel) * texel;
  _shR.setFromMatrixColumn(C.matrixWorld, 0); _shU.setFromMatrixColumn(C.matrixWorld, 1);
  C.position.addScaledVector(_shR, dx).addScaledVector(_shU, dy);
  C.updateMatrixWorld(true);
  U.uShadowMatrix.value.copy(_shBias).multiply(C.projectionMatrix).multiply(C.matrixWorldInverse);
}
// a stand-in for a mesh in the shadow pass: same geometry, a depth-only material, the source's transform
const DEPTH_FS = /* glsl */`void main(){ gl_FragColor = vec4(1.0); }`;
function shadowCaster(src, material) {
  if (!src) return null;
  const m = new THREE.Mesh(src.geometry, material);
  m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false;
  m.frustumCulled = src.frustumCulled;
  m.userData.src = src;
  SHADOW.scene.add(m);
  SHADOW.proxies.push(m);
  return m;
}
// [perf2] a mesh taken away for good takes its shadow's proxies with it (they stayed in the shadow scene, holding it)
function shadowDrop(src) {
  for (let i = SHADOW.proxies.length - 1; i >= 0; i--) { const q = SHADOW.proxies[i]; if (q.userData.src === src) { SHADOW.scene.remove(q); SHADOW.proxies.splice(i, 1); } }
}
// a depth material from a colour material: same vertex stage and uniforms (live), only depth comes out
function depthFrom(src, fs = DEPTH_FS, vs = null) {
  return new THREE.ShaderMaterial({ uniforms: src.uniforms, vertexShader: vs || src.vertexShader, fragmentShader: fs, side: THREE.DoubleSide, colorWrite: false });
}
function liveIn(o) { for (let q = o; q; q = q.parent) { if (!q.visible) return false; if (q === scene) return true; } return false; }
function renderShadowPass(cx, cy, cz) {
  if (!SHADOW.rt) return;
  updateShadowCamera(cx, cy, cz);
  for (const m of SHADOW.proxies) {
    const s = m.userData.src;
    m.visible = liveIn(s);
    if (m.visible) m.matrixWorld.copy(s.matrixWorld);
  }
  renderer.setRenderTarget(SHADOW.rt);
  renderer.clear(false, true, false);
  renderer.render(SHADOW.scene, SHADOW.cam);
}

// foliage close to the camera, or between the camera and the player, thins out so the view stays clear
const GLSL_CLEARVIEW = /* glsl */`
uniform vec3 uCamFocus;
float viewBlock(vec3 wp){
  vec3 cf = uCamFocus - cameraPosition;
  float L = length(cf);
  vec3 dc = cf / max(L, 1e-3);
  vec3 rel = wp - cameraPosition;
  float along = dot(rel, dc);
  float perp = length(rel - dc * along);
  float block = (along > 0.0 && along < L - 0.8) ? (1.0 - smoothstep(0.9, 2.4, perp)) * smoothstep(0.0, 1.5, along) : 0.0;
  float nearCam = 1.0 - smoothstep(1.4, 3.6, length(rel));
  return max(block * 0.9, nearCam);
}
`;
const GLSL_WORLD = /* glsl */`
uniform highp sampler2D uHeightTex;
uniform sampler2D uWorldA, uWorldB;
uniform sampler2D uCanopy, uGroundAO;
vec2 worldUV(vec2 xz){ return ((xz + 512.0) * 0.5 + 0.5) / 513.0; }
// how much tree crown is overhead (visual pass: the canopy map in 03_terrain.js; 0 before it is built)
float canopyAt(vec2 xz){ return texture(uCanopy, (xz + 512.0) / 1024.0).a; }
float groundAO(vec2 xz){ return texture(uGroundAO, (xz + 512.0) / 1024.0).r; }
float groundPath(vec2 xz){ return texture(uGroundAO, (xz + 512.0) / 1024.0).g; } // [look2] the towns' footpaths, 1 m (13u_look2.js)
float terrainHeight(vec2 xz){
  vec2 g = clamp((xz + 512.0) * 0.5, vec2(0.0), vec2(511.999));
  ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  float h00 = texelFetch(uHeightTex, i, 0).r;
  float h10 = texelFetch(uHeightTex, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uHeightTex, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uHeightTex, i + ivec2(1, 1), 0).r;
  return finite1(mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y));
}
// realm tints applied to the shared meadow palette: Logres, Eriu, Thule
vec3 realmTint(vec3 w){ return w.r * vec3(1.0) + w.g * vec3(0.8, 1.06, 0.84) + w.b * vec3(0.76, 0.9, 1.06) * 0.94; }
`;

const GLSL_DECAL = /* glsl */`
uniform sampler2D uDecal;
uniform vec4 uDecalBounds;
uniform vec3 uTargetColor, uAoeColor;
vec4 sampleDecal(vec2 xz){
  vec2 uv = (xz - uDecalBounds.xy) / uDecalBounds.zw;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);
  return texture(uDecal, uv);
}
vec3 applyDecal(vec3 col, vec4 d){
  col *= 1.0 - 0.55 * d.r;
  col = mix(col, uTargetColor * 1.6, d.g * 0.85);
  col = mix(col, uAoeColor * 1.4, d.b * 0.7);
  col = mix(col, vec3(0.5, 1.0, 0.6) * 1.4, d.a * 0.6);
  return col;
}
`;

const GLSL_BEND = /* glsl */`
uniform sampler2D uTrail;
uniform vec4 uTrailBounds;
uniform vec2 uWindDir;
uniform float uWind;
vec4 sampleTrail(vec2 xz){
  vec2 uv = (xz - uTrailBounds.xy) / uTrailBounds.zw;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec4(0.0);
  vec4 t = clamp(texture(uTrail, uv), 0.0, 1.0);
  t.rg = t.rg * 2.0 - 1.0;
  return t;
}
float gGust = 0.0; // the last gust bladeLean met (visual pass: the grass shows the waves running over it)
vec2 bladeLean(vec3 base, vec2 face, float seed, float stiff, vec4 tr){
  vec2 across = vec2(-face.y, face.x);
  float gust = vnoise(base.xz * 0.05 - uWindDir * uTime * 0.42);
  gGust = gust;
  float gust2 = vnoise(base.xz * 0.21 + vec2(5.2, 1.3) - uWindDir * uTime * 1.2);
  float w = uWind * (0.05 + 0.42 * gust * gust + 0.14 * gust2 * gust2);
  float flutter = sin(uTime * (1.5 + seed * 1.6) + seed * 31.0 + base.x * 0.45) * 0.05;
  vec2 lean = (uWindDir * w + across * flutter * uWind) * stiff;
  float ra = seed * 61.3;
  lean += vec2(cos(ra), sin(ra)) * (0.03 + 0.34 * fract(seed * 13.7) * fract(seed * 13.7)) * stiff;
  float pl = length(tr.rg);
  vec2 pdir = pl > 0.05 ? tr.rg / pl : face;
  lean = mix(lean, pdir * 1.28, smoothstep(0.0, 0.85, tr.b));
  return lean;
}
vec3 bladeBend(vec2 lean, float H, float t, out vec3 tangent){
  float L = length(lean);
  float ang = clamp(L, 1e-4, 1.5);
  vec2 ld = L > 1e-5 ? lean / L : vec2(0.0);
  float a = ang * t;
  float hx = H * (1.0 - cos(a)) / ang;
  float hy = H * sin(a) / ang;
  tangent = vec3(ld.x * sin(a), cos(a), ld.y * sin(a));
  return vec3(ld.x * hx, hy, ld.y * hx);
}
`;

function mat(opts) {
  const m = new THREE.ShaderMaterial({ ...opts, uniforms: { ...U, ...(opts.uniforms || {}) } });
  return m;
}
// a copy of a material that keeps the live shared uniforms (and skips copying render-target textures)
function shareMat(base, extra = {}) {
  const saved = [];
  for (const k in base.uniforms) { const u = base.uniforms[k]; if (u.value && u.value.isRenderTargetTexture) { saved.push([u, u.value]); u.value = null; } }
  const m = base.clone();
  for (const [u, v] of saved) u.value = v;
  m.uniforms = { ...base.uniforms, ...extra };
  return m;
}

/* ------------------------------------------------------------------ */
/* Time of day: p in [0,3): 0 morning, 1 golden hour, 2 night          */
/* sun/moon/ldir are compass [azimuth, elevation] in degrees           */
/* ------------------------------------------------------------------ */
const TOD_KEYS = [
  { p: 0, zen: '#86afe2', hor: '#d5e2ec', glow: '#16120c', cLit: '#ffffff', cShade: '#d6dee9', cover: 0.46,
    light: '#fff4e0', amb: '#a3b5c2', gBase: '#14380a', gTip: '#88d43e', gTrans: '#3c6a12', leaf: '#5d7a32', trunk: '#4a4036',
    fog: 0.0042, stars: 0, night: 0, petals: 0.55, width: 0.85, ldir: [118, 34], sun: [118, 30], sunVis: 1, moon: [235, -10], moonVis: 0, bloom: 0.25,
    gSat: 1.12, gCon: 1.07, gWarm: 0.0 },
  { p: 0.5, petals: 0.95 },
  { p: 1, zen: '#bb9ea8', hor: '#efcfaa', glow: '#b8743a', cLit: '#f1dcc4', cShade: '#bea0a4', cover: 0.52,
    light: '#ffd58f', amb: '#b9a58e', gBase: '#1e3206', gTip: '#bce42c', gTrans: '#d8f23a', leaf: '#5d6224', trunk: '#3e2a1c',
    fog: 0.0030, stars: 0, night: 0, petals: 1, width: 1, ldir: [255, 10], sun: [255, 5], sunVis: 1, moon: [95, -8], moonVis: 0, bloom: 0.32,
    gSat: 1.14, gCon: 1.08, gWarm: 0.045 },
  { p: 1.13, sun: [255, 3.2] },
  { p: 1.22, sun: [255, 1.8] },
  { p: 1.3, zen: '#c4969c', hor: '#ebb49d', glow: '#bb6436', cLit: '#e9b8a4', cShade: '#a98086', light: '#ffb27c', amb: '#a8848a',
    gBase: '#2a2c06', gTip: '#879a1e', gTrans: '#c09030', leaf: '#6c4e1e', sun: [255, -0.4], sunVis: 1, moonVis: 0 },
  { p: 1.4, sun: [255, -3], sunVis: 0 },
  { p: 1.55, zen: '#865d8c', hor: '#ea8872', glow: '#9a3826', cLit: '#d6847a', cShade: '#93506a', light: '#ff7a48', amb: '#8a5462',
    gBase: '#1e1604', gTip: '#6a5c10', gTrans: '#8a4a14', leaf: '#7a3e12', trunk: '#3a1e14', fog: 0.0036, night: 0.22, bloom: 0.4, moonVis: 1, ldir: [250, 6], sun: [262, -6],
    gSat: 1.1, gCon: 1.06, gWarm: 0.03 },
  { p: 1.65, moon: [95, -2.2] },
  { p: 1.7, moon: [97, 1.0] },
  { p: 1.75, zen: '#5e4274', hor: '#c2626c', glow: '#4e1a2a', cLit: '#ad6a72', cShade: '#682b55', light: '#c0607a', amb: '#5e3352',
    gBase: '#0c1606', gTip: '#3c4612', gTrans: '#3a2410', leaf: '#5a2a1c', trunk: '#2a1418', night: 0.5, moon: [100, 4] },
  { p: 1.84, moon: [108, 11] },
  { p: 1.9, zen: '#432d65', hor: '#5a4179', glow: '#120a18', cLit: '#54466e', cShade: '#2a1b4c', light: '#6c5ea2', amb: '#2e2a52',
    gBase: '#02120c', gTip: '#0e3a24', gTrans: '#0c2a28', leaf: '#1e1a2e', trunk: '#120e22', stars: 0.4, night: 0.85, moon: [118, 20], ldir: [150, 30], sun: [280, -14] },
  { p: 2, zen: '#163165', hor: '#22396a', glow: '#000000', cLit: '#34487a', cShade: '#253a6c', cover: 0.56,
    light: '#7b93cf', amb: '#24395a', gBase: '#01140f', gTip: '#0f4c35', gTrans: '#0c3236', leaf: '#08202c', trunk: '#0a1428',
    fog: 0.0042, stars: 1, night: 1, petals: 1, width: 1, ldir: [160, 36], sun: [300, -24], sunVis: 0, moon: [160, 32], moonVis: 1, bloom: 0.55,
    gSat: 0.9, gCon: 1.05, gWarm: -0.05 },
  { p: 2.25, zen: '#564467', hor: '#7f6387', glow: '#140c18', cLit: '#6c5878', cShade: '#3a2850', light: '#7a6a9e', amb: '#36304f',
    gBase: '#03140c', gTip: '#11402a', gTrans: '#102a24', leaf: '#3a2430', trunk: '#1e1420', stars: 0.5, night: 0.9, moon: [205, 20] },
  { p: 2.3, petals: 1 },
  { p: 2.45, moon: [228, 3] },
  { p: 2.2, sun: [395, -12] },
  { p: 2.47, sun: [432, -4], petals: 0.15 },
  { p: 2.47, zen: '#7e5a70', hor: '#c08893', glow: '#4a2830', cLit: '#a37a84', cShade: '#6c4c6c', light: '#e2a0a4', amb: '#5c4a5c',
    gBase: '#081a06', gTip: '#264a1a', gTrans: '#3a3018', leaf: '#5c3a2c', trunk: '#2e1c1c', stars: 0.1, night: 0.6, ldir: [80, 8] },
  { p: 2.55, petals: 0 },
  { p: 2.56, moon: [232, -3], moonVis: 1 },
  { p: 2.6, moonVis: 0 },
  { p: 2.7, zen: '#a67788', hor: '#e8a498', glow: '#6a3e2c', cLit: '#d49c8e', cShade: '#9a7090', light: '#ffc6a2', amb: '#7e6a78',
    gBase: '#101e04', gTip: '#465c18', gTrans: '#6a6a1a', leaf: '#7c5a38', trunk: '#3a2a22', stars: 0, night: 0.28, sun: [434, 0.5], sunVis: 1,
    gSat: 1.08, gCon: 1.05, gWarm: 0.035 },
  { p: 2.87, zen: '#bab0ba', hor: '#ead2cc', glow: '#2a2016', cLit: '#f1e5e0', cShade: '#c6bac4', light: '#fde6d6', amb: '#9a98a2',
    gBase: '#0e2604', gTip: '#4f8224', gTrans: '#3a4a10', leaf: '#6e6c4c', trunk: '#4a4036', night: 0.06, sun: [445, 9], ldir: [90, 14] },
];
TOD_KEYS.push({ ...TOD_KEYS[0], p: 3, sun: [478, 30] });
const TOD_COLOR = ['zen', 'hor', 'glow', 'cLit', 'cShade', 'light', 'amb', 'gBase', 'gTip', 'gTrans', 'leaf', 'trunk'];
const TOD_SCALAR = ['cover', 'fog', 'stars', 'night', 'sunVis', 'moonVis', 'bloom', 'petals', 'width', 'gSat', 'gCon', 'gWarm'];
const TOD_ANGLE = ['ldir', 'sun', 'moon'];
const todTracks = {};
for (const f of [...TOD_COLOR, ...TOD_SCALAR, ...TOD_ANGLE]) {
  todTracks[f] = TOD_KEYS.filter((k) => k[f] !== undefined)
    .map((k) => ({ p: k.p, v: TOD_COLOR.includes(f) ? hex3(k[f]) : (Array.isArray(k[f]) ? k[f] : [k[f]]) }))
    .sort((a, b) => a.p - b.p);
}
function todSample(f, p) {
  const tr = todTracks[f];
  if (p <= tr[0].p) return tr[0].v;
  for (let i = 1; i < tr.length; i++) {
    if (p <= tr[i].p) {
      const a = tr[i - 1], b = tr[i];
      const t = b.p > a.p ? smooth((p - a.p) / (b.p - a.p)) : 1;
      return a.v.map((x, j) => lerp(x, b.v[j], t));
    }
  }
  return tr[tr.length - 1].v;
}
function compassDir(az, el, out = new THREE.Vector3()) {
  const a = az * DEG, e = el * DEG;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/* [weather2] the clouds as the sky shows them: the dome of the sky (12c_weather2.js ray-marches it through the cloud field
   each frame from the camera), read by direction; rgb the clouds' own light, a how much of what lies behind them shows */
const GLSL_CLOUDS = /* glsl */`
uniform sampler2D uCloudDome, uCloudScr;
uniform vec4 uCloudDomeOn, uWxFlash, uCloudScrP;
vec2 cloudDomeUV(vec3 dir){
  float e = asin(clamp(dir.y, 0.0, 1.0));
  float r = 1.0 - pow(e / 1.5707963, 0.625);
  float hl = length(dir.xz);
  return (hl > 1e-5 ? dir.xz / hl * r : vec2(0.0)) * 0.5 + 0.5;
}
vec4 cloudLitDir(vec3 dir, vec4 c){
  float fade = smoothstep(-0.03, 0.02, dir.y);
  c.a = clamp(c.a, 0.0, 1.0);
  // a flash in the cloud: the lightning lights the cloud about it from within
  vec3 fd = uWxFlash.xyz;
  float fk = uWxFlash.w * (1.0 - c.a) * (spow(max(dot(dir, fd), 0.0), 18.0) * 2.2 + spow(max(dot(dir, fd), 0.0), 3.0) * 0.35);
  return vec4((c.rgb + vec3(0.75, 0.8, 1.0) * fk) * fade, mix(1.0, c.a, fade));
}
vec4 cloudDome(vec3 dir){
  if (uCloudDomeOn.x < 0.5 || dir.y < -0.03) return vec4(0.0, 0.0, 0.0, 1.0);
  return cloudLitDir(dir, texture(uCloudDome, cloudDomeUV(dir)));
}
// The cloud render targets have no mipmaps. Select the sample first, then light
// it once: duplicating this call through cloudDome also failed on native D3D11.
// The main view uses its own screen clouds (wxCloudsScreen), else the dome.
vec4 cloudScreen(vec3 dir, vec2 fc){
  if (uCloudDomeOn.x < 0.5 || dir.y < -0.03) return vec4(0.0, 0.0, 0.0, 1.0);
  vec4 c;
  if (uCloudScrP.z < 0.5) {
    c = texture(uCloudDome, cloudDomeUV(dir));
  } else {
    // Same four taps and averaging as the original screen path.
    vec2 o = 0.5 * uCloudScrP.w * uCloudScrP.xy, uv = fc * uCloudScrP.xy;
    c = texture(uCloudScr, uv + vec2(-o.x, -o.y)) + texture(uCloudScr, uv + vec2(o.x, -o.y)) + texture(uCloudScr, uv + vec2(-o.x, o.y)) + texture(uCloudScr, uv + o);
    c *= 0.25;
  }
  return cloudLitDir(dir, c);
}
`;
/* ------------------------------------------------------------------ */
/* Sky                                                                 */
/* ------------------------------------------------------------------ */
const skyU = {
  uInvVP: { value: new THREE.Matrix4() },
  uCloudLit: { value: new THREE.Vector3() }, uCloudShade: { value: new THREE.Vector3() }, uCloudCover: { value: 0.5 },
  uSunDir: { value: new THREE.Vector3() }, uSunVis: { value: 1 },
  uMoonDir: { value: new THREE.Vector3() }, uMoonVis: { value: 0 },
  uStars: { value: 0 },
};
const fsTriGeo = new THREE.BufferGeometry();
fsTriGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fsTriGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
// The affected native GPU completed the cube and composite batches, then failed
// linking this fullscreen sky material. A runtime false cloud branch still
// supplied every procedural helper to the compiler. Recovery supplies a separate
// small fragment; the normal fragment below is kept unchanged.
const RECOVERY_SKY_FRAGMENT = /* glsl */`
  uniform vec3 uZenith, uHorizon, uSunGlow, uGlowDir;
  uniform vec3 uSunDir, uMoonDir;
  uniform float uSunVis, uMoonVis;
  uniform vec4 uUnder;
  uniform vec3 uUnderCol;
  varying vec3 vDir;
  void main(){
    vec3 dir = vDir * inversesqrt(max(dot(vDir, vDir), 1e-8));
    float height = smoothstep(-0.03, 0.52, clamp(dir.y, -0.2, 1.0));
    vec3 col = mix(uHorizon, uZenith, height);
    float warmHorizon = smoothstep(0.1, 0.95, dot(dir, uGlowDir)) * (1.0 - height);
    col += uSunGlow * warmHorizon * 0.12;
    float sun = smoothstep(0.99960, 0.99983, dot(dir, uSunDir)) * clamp(uSunVis, 0.0, 1.0);
    float moon = smoothstep(0.99952, 0.99976, dot(dir, uMoonDir)) * clamp(uMoonVis, 0.0, 1.0);
    col = mix(col, vec3(1.65, 1.6, 1.5), sun);
    col = mix(col, vec3(0.80, 0.83, 0.90), moon);
    if (uUnder.x > 0.5) col = mix(col, uUnderCol, 0.7);
    gl_FragColor = vec4(clamp(col, 0.0, 8.0), 0.0);
  }`;
const skyMesh = new THREE.Mesh(fsTriGeo, mat({
  uniforms: skyU, depthWrite: false, depthTest: false,
  vertexShader: /* glsl */`
    uniform mat4 uInvVP;
    varying vec3 vDir;
    void main(){
      vec4 p = uInvVP * vec4(position.xy, 1.0, 1.0);
      vDir = p.xyz / (abs(p.w) > 1e-6 ? p.w : 1e-6) - cameraPosition;
      gl_Position = vec4(position.xy, 1.0, 1.0);
    }`,
  fragmentShader: BOOT_SAFE ? RECOVERY_SKY_FRAGMENT : /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_CLOUDS}
    uniform vec3 uCloudLit, uCloudShade, uSunDir, uMoonDir;
    uniform float uCloudCover, uSunVis, uMoonVis, uStars;
    varying vec3 vDir;
    void main(){
      vec3 dir = safeNormalize(vDir);
      vec3 col = skyBase(dir);
      float px = max(1e-5, length(fwidth(dir)));
      if (uStars > 0.001 && dir.y > 0.0) {
        vec2 sp = vec2(satan(dir.x, -dir.z), dir.y) * 150.0;
        vec2 cell = floor(sp);
        float h = hash12(cell + 11.0);
        if (h > 0.991) {
          vec2 o = hash22(cell) * 0.6 + 0.2;
          float r = length(fract(sp) - o) / (px * 150.0 + 1e-5);
          float tw = 0.55 + 0.45 * sin(uTime * (1.2 + h * 3.0) + h * 70.0);
          col += vec3(0.8, 0.86, 1.0) * (1.0 - smoothstep(0.2, 1.2, r)) * tw * uStars * smoothstep(0.0, 0.1, dir.y) * (0.25 + 0.45 * fract(h * 97.0));
        }
      }
      float mc = dot(dir, uMoonDir);
      float mg = max(mc, 0.0);
      col += vec3(0.42, 0.5, 0.8) * (spow(mg, 900.0) * 0.55 + spow(mg, 90.0) * 0.16 + spow(mg, 12.0) * 0.05) * uMoonVis;
      float aw = max(px * 0.8, 1e-4);
      float mr = 0.0255;
      float mdisk = (1.0 - smoothstep(mr - aw, mr + aw, length(cross(dir, uMoonDir)))) * step(0.0, mc);
      if (mdisk > 0.0) {
        vec3 mx = safeNormalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
        vec3 my = cross(mx, uMoonDir);
        vec2 mp = vec2(dot(dir, mx), dot(dir, my)) / mr;
        float tex = 0.9 + 0.1 * fbm(mp * 2.2 + 3.0) - 0.07 * smoothstep(0.1, 0.9, length(mp - vec2(0.25, -0.3)));
        col = mix(col, vec3(1.9, 1.86, 1.75) * tex, mdisk * uMoonVis);
      }
      // visual pass: a faint band of the galaxy across the night sky, dust lanes and all
      if (uStars > 0.001 && dir.y > -0.02) {
        vec3 bandN = normalize(vec3(0.42, 0.55, -0.72));
        float bd = dot(dir, bandN);
        float band = exp(-bd * bd / 0.022);
        vec2 bp = vec2(satan(dir.z, dir.x) * 3.0, bd * 9.0);
        float dust = fbm3(bp * 1.7 + 4.0);
        col += vec3(0.5, 0.52, 0.66) * band * (0.35 + 0.65 * smoothstep(0.35, 0.75, dust)) * (1.0 - 0.6 * smoothstep(0.55, 0.8, fbm3(bp * 3.1 - 2.0))) * uStars * 0.075 * smoothstep(-0.02, 0.2, dir.y);
      }
      float sc = dot(dir, uSunDir);
      float sr = 0.0225;
      float sdisk = (1.0 - smoothstep(sr - aw, sr + aw, length(cross(dir, uSunDir)))) * step(0.0, sc);
      col = mix(col, vec3(1.65, 1.6, 1.5), sdisk * uSunVis);
      col += vec3(0.5, 0.42, 0.3) * spow(sc, 2500.0) * uSunVis;
      float hz = smoothstep(-0.01, 0.06, dir.y);
      // [weather2] the clouds that are there: the dome ray-marched through the systems' cloud field (12c_weather2.js); the
      // sun, the moon and the stars show only where no cloud stands in front of them
      if (uCloudDomeOn.x > 0.5) { vec4 cd = cloudScreen(dir, gl_FragCoord.xy); col = col * cd.a + cd.rgb; hz = 0.0; }
      if (${BOOT_SAFE ? 'false' : 'hz > 0.0'}) {
        vec2 cp = dir.xz / (dir.y + 0.09);
        cp = cp * 0.3 + vec2(uTime * 0.008, uTime * 0.002) + vec2(3.7, 1.2);
        vec2 warp = vec2(fbm(cp * 0.55 + 4.1), fbm(cp * 0.55 - 7.3));
        float n = fbm(cp + warp * 0.9 - 0.45);
        float cc0 = uCloudCover - 0.05 * smoothstep(0.08, 0.35, dir.y);
        float cov = smoothstep(cc0, cc0 + 0.2, n);
        float thick = smoothstep(cc0 + 0.05, cc0 + 0.36, n);
        vec3 cc = mix(uCloudLit, uCloudShade, thick * 0.9);
        cc += uSunGlow * spow(dot(dir, uGlowDir), 7.0) * 0.12;
        // visual pass: thin edges near the sun light up (a silver lining), thick hearts darken underneath
        float gl = spow(max(dot(dir, uGlowDir), 0.0), 5.0);
        float rim = cov * (1.0 - thick);
        cc += (uSunGlow * 0.9 + uCloudLit * 0.25) * rim * gl * 0.9 * uSunVis;
        cc *= 1.0 - 0.14 * thick * smoothstep(0.1, 0.6, n - cc0);
        col = mix(col, cc, cov * hz * 0.92);
      }
      if (uUnder.x > 0.5) col = underFogD(col, dir.y > 0.002 ? (uUnder.y - cameraPosition.y) / dir.y : 1e4, dir.y); // [water2] seen from under the water
      gl_FragColor = vec4(safeColor(col), 0.0);
    }`,
}));
if (BOOT_SAFE) skyMesh.material.name = 'Recovery sky';
skyMesh.frustumCulled = false;
skyMesh.renderOrder = -100;
scene.add(skyMesh);

/* ------------------------------------------------------------------ */
/* Post-processing: bloom + composite                                  */
/* ------------------------------------------------------------------ */
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsMesh = new THREE.Mesh(fsTriGeo);
fsMesh.frustumCulled = false;
const fsScene = new THREE.Scene();
fsScene.add(fsMesh);
function pass(material, target) {
  if (GRAPHICS_CONTEXT_LOST) return;
  fsMesh.material = material;
  renderer.setRenderTarget(target);
  renderer.render(fsScene, fsCam);
}
const FS_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FIN3 = 'vec3 finite3(vec3 v){ return mix(v, vec3(0.0), equal(floatBitsToUint(v) & uvec3(0x7f800000u), uvec3(0x7f800000u))); }';
const bloomDown = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPrefilter: { value: 0 }, uThreshold: { value: 1.22 } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPrefilter, uThreshold;
    varying vec2 vUv;
    ${FIN3}
    vec3 tap(vec2 uv){ return clamp(finite3(texture2D(tSrc, uv).rgb), 0.0, 8.0); }
    void main(){
      vec3 s = tap(vUv) * 4.0;
      s += tap(vUv - uTexel); s += tap(vUv + uTexel);
      s += tap(vUv + vec2(uTexel.x, -uTexel.y)); s += tap(vUv - vec2(uTexel.x, -uTexel.y));
      s /= 8.0;
      if (uPrefilter > 0.5) {
        float br = max(s.r, max(s.g, s.b));
        float knee = 0.18;
        float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee + 1e-4);
        s *= max(soft, br - uThreshold) / max(br, 1e-4);
      }
      gl_FragColor = vec4(clamp(finite3(s), 0.0, 8.0), 1.0);
    }`,
});
const bloomUp = new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: FS_VERT, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  fragmentShader: /* glsl */`
    uniform sampler2D tSrc; uniform vec2 uTexel;
    varying vec2 vUv;
    ${FIN3}
    void main(){
      vec2 t = uTexel;
      vec3 s = texture2D(tSrc, vUv + vec2(-t.x * 2.0, 0.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(0.0, t.y * 2.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(t.x * 2.0, 0.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(0.0, -t.y * 2.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb * 2.0;
      gl_FragColor = vec4(clamp(finite3(s / 12.0), 0.0, 8.0), 1.0);
    }`,
});
const composite = new THREE.ShaderMaterial({
  uniforms: {
    tScene: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uBloom: { value: 0.35 }, uTime: { value: 0 }, uVignette: { value: 0.34 }, uFlash: { value: new THREE.Vector4(0, 0, 0, 0) },
    tRays: { value: null }, uRays: { value: 0 },
    uGrade: { value: new THREE.Vector4(1, 1, 0, 0) }, // visual pass: vibrance, contrast, warm (+) or cool (-) by time of day
  },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tScene, tBloom, tRays; uniform vec2 uRes; uniform float uBloom, uTime, uVignette, uRays; uniform vec4 uFlash, uGrade;
    varying vec2 vUv;
    ${FIN3}
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 col = clamp(finite3(texture2D(tScene, vUv).rgb), 0.0, 8.0);
      col += clamp(finite3(texture2D(tBloom, vUv).rgb), 0.0, 8.0) * uBloom;
      if (uRays > 0.5) col += clamp(finite3(texture2D(tRays, vUv).rgb), 0.0, 4.0);
      // visual pass: a grade that follows the time of day: vibrance (lifts dull colours more than vivid ones),
      // a contrast curve pivoting on the mid tones (blacks stay put) and a warm or cool balance
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float mxc = max(col.r, max(col.g, col.b)), mnc = min(col.r, min(col.g, col.b));
      float satNow = (mxc - mnc) / max(mxc, 1e-4);
      col = max(mix(vec3(luma), col, 1.0 + (uGrade.x - 1.0) * (1.0 - satNow)), 0.0);
      col *= vec3(1.0 + uGrade.z, 1.0 + uGrade.z * 0.2, 1.0 - uGrade.z);
      col = 0.42 * pow(col / 0.42, vec3(uGrade.y));
      vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
      float vig = 1.0 - uVignette * smoothstep(0.35, 1.05, length(q * vec2(0.9, 1.0)));
      col *= vig;
      // damage / level-up flash at the screen edges
      float edge = smoothstep(0.25, 0.85, length(q));
      col = mix(col, uFlash.rgb, uFlash.a * edge);
      vec3 over = max(col - 0.78, 0.0);
      col = min(col, 0.78) + 0.22 * (1.0 - exp(-over / 0.22));
      col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) / 160.0;
      gl_FragColor = vec4(clamp(finite3(col), 0.0, 1.0), 1.0);
    }`,
});
/* light shafts: march from each pixel toward the sun through the sky mask (scene alpha 0 = open sky) */
const raysMat = new THREE.ShaderMaterial({
  uniforms: { tScene: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uCol: { value: new THREE.Vector3() }, uDecay: { value: 0.972 } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tScene; uniform vec2 uSun; uniform float uAspect, uDecay; uniform vec3 uCol;
    varying vec2 vUv;
    ${FIN3}
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      const int N = 40;
      vec2 delta = (uSun - vUv) / float(N);
      vec2 uv = vUv + delta * hash(gl_FragCoord.xy);
      float illum = 1.0, sum = 0.0;
      for (int i = 0; i < N; i++) {
        uv += delta;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { illum *= uDecay; continue; }
        vec4 s = texture2D(tScene, uv);
        float sky = 1.0 - clamp(s.a, 0.0, 1.0);
        float b = max(dot(clamp(finite3(s.rgb), 0.0, 6.0), vec3(0.3, 0.5, 0.2)) - 0.55, 0.0);
        float near = exp(-length((uv - uSun) * vec2(uAspect, 1.0)) * 4.2);
        sum += sky * b * near * illum;
        illum *= uDecay;
      }
      gl_FragColor = vec4(uCol * (sum / float(N)), 1.0);
    }`,
});
let raysRT = null;
const _sunNdc = new THREE.Vector3(), _camDir = new THREE.Vector3();
// how strong the shafts are and where the light sits on screen; 0 when the light is behind the camera
function updateRays() {
  const C = composite.uniforms;
  C.uRays.value = 0;
  if (!raysRT || quality.level === 'low' || INDOOR.on) return false;
  const sunUp = skyU.uSunVis.value > 0.05 && skyU.uSunDir.value.y > -0.03;
  const dir = sunUp ? skyU.uSunDir.value : skyU.uMoonDir.value;
  if (!sunUp && (skyU.uMoonVis.value < 0.05 || dir.y < 0.0)) return false;
  camera.getWorldDirection(_camDir);
  const facing = _camDir.dot(dir);
  if (facing < 0.05) return false;
  _sunNdc.copy(camera.position).addScaledVector(dir, 800).project(camera);
  const sx = _sunNdc.x * 0.5 + 0.5, sy = _sunNdc.y * 0.5 + 0.5;
  const off = Math.max(0, Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) - 0.5);
  const k = smooth(clamp((facing - 0.05) / 0.35, 0, 1)) * (1 - smooth(clamp(off / 0.6, 0, 1)));
  if (k <= 0.01) return false;
  const golden = sunUp ? 1 - smooth(clamp((dir.y - 0.05) / 0.45, 0, 1)) : 0;
  const strength = (sunUp ? 1.1 + 1.6 * golden : 0.8) * k * (RAYS_BOOST.value);
  const L = U.uLightColor.value;
  raysMat.uniforms.uSun.value.set(sx, sy);
  raysMat.uniforms.uAspect.value = raysRT.width / raysRT.height;
  raysMat.uniforms.uCol.value.set(L.x * 0.75 + 0.25, L.y * 0.72 + 0.22, L.z * 0.62 + 0.18).multiplyScalar(strength);
  C.uRays.value = 1;
  return true;
}
const RAYS_BOOST = { value: 1 };
let sceneRT = null;
const bloomRTs = [];
const view = { w: 1, h: 1 };
function makeTargets() {
  const w = Math.max(1, Math.floor(view.w * quality.dprActual)), h = Math.max(1, Math.floor(view.h * quality.dprActual));
  if (sceneRT) sceneRT.dispose();
  sceneRT = new THREE.WebGLRenderTarget(w, h, {
    type: RT_TYPE, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, samples: quality.msaa,
  });
  for (const rt of bloomRTs) rt.dispose();
  bloomRTs.length = 0;
  let bw = w, bh = h;
  for (let i = 0; i < (BOOT_SAFE ? 0 : quality.bloom); i++) {
    bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    bloomRTs.push(new THREE.WebGLRenderTarget(bw, bh, { type: RT_TYPE, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }));
  }
  composite.uniforms.uRes.value.set(w, h);
  if (raysRT) raysRT.dispose();
  raysRT = null;
  if (!BOOT_SAFE) {
    const rs = quality.level === 'high' ? 2 : 3;
    raysRT = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w / rs)), Math.max(1, Math.floor(h / rs)), { type: RT_TYPE, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  }
}
function renderPost() {
  let src = sceneRT;
  for (let i = 0; i < bloomRTs.length; i++) {
    bloomDown.uniforms.tSrc.value = src.texture;
    bloomDown.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
    bloomDown.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
    pass(bloomDown, bloomRTs[i]);
    src = bloomRTs[i];
  }
  for (let i = bloomRTs.length - 1; i > 0; i--) {
    bloomUp.uniforms.tSrc.value = bloomRTs[i].texture;
    bloomUp.uniforms.uTexel.value.set(0.5 / bloomRTs[i].width, 0.5 / bloomRTs[i].height);
    pass(bloomUp, bloomRTs[i - 1]);
  }
  if (updateRays()) { raysMat.uniforms.tScene.value = sceneRT.texture; pass(raysMat, raysRT); composite.uniforms.tRays.value = raysRT.texture; }
  composite.uniforms.tScene.value = sceneRT.texture;
  composite.uniforms.tBloom.value = bloomRTs.length ? bloomRTs[0].texture : ZERO_TEX;
  if (BOOT_SAFE) { composite.uniforms.uBloom.value = 0; composite.uniforms.uRays.value = 0; composite.uniforms.tRays.value = ZERO_TEX; }
  pass(composite, null);
  if (DBG.shadowView && SHADOW.rt) { dbgShadowMat.uniforms.t.value = SHADOW.rt.depthTexture; pass(dbgShadowMat, null); }
}
const DBG = { shadowView: false };
const dbgShadowMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: null } }, vertexShader: FS_VERT,
  fragmentShader: 'uniform highp sampler2D t; varying vec2 vUv; void main(){ vec2 uv = vec2(vUv.x * 1.7777, vUv.y); if (uv.x > 1.0) discard; float d = texture(t, uv).r; gl_FragColor = vec4(d < 0.9999 ? vec3(0.2 + 0.8 * fract(d * 40.0)) : vec3(0.0, 0.0, 0.3), 1.0); }',
});

/* applies a time-of-day phase to every shared uniform */
const tod = { p: 1, from: 1, to: 1, t: 1, dur: 1, mode: 'cycle', cycleSec: 1080 };
function applyTimeOfDay(p) {
  p = ((p % 3) + 3) % 3;
  const v3 = (f, uni) => { const c = todSample(f, p); uni.value.set(c[0], c[1], c[2]); };
  v3('zen', U.uZenith); v3('hor', U.uHorizon); v3('glow', U.uSunGlow);
  v3('light', U.uLightColor); v3('amb', U.uAmbient);
  v3('gBase', U.uGrassBase); v3('gTip', U.uGrassTip); v3('gTrans', U.uGrassTrans);
  v3('leaf', U.uLeaf); v3('trunk', U.uBark);
  v3('cLit', skyU.uCloudLit); v3('cShade', skyU.uCloudShade);
  skyU.uCloudCover.value = todSample('cover', p)[0];
  U.uFogDensity.value = todSample('fog', p)[0];
  U.uNight.value = todSample('night', p)[0];
  U.uPetals.value = todSample('petals', p)[0];
  U.uBladeWidth.value = todSample('width', p)[0];
  skyU.uStars.value = todSample('stars', p)[0];
  skyU.uSunVis.value = todSample('sunVis', p)[0];
  skyU.uMoonVis.value = todSample('moonVis', p)[0];
  composite.uniforms.uBloom.value = todSample('bloom', p)[0];
  composite.uniforms.uGrade.value.set(todSample('gSat', p)[0], todSample('gCon', p)[0], todSample('gWarm', p)[0], 0);
  const ld = todSample('ldir', p), sd = todSample('sun', p), md = todSample('moon', p);
  compassDir(ld[0], Math.max(ld[1], 4), U.uLightDir.value);
  compassDir(sd[0], sd[1], skyU.uSunDir.value);
  compassDir(md[0], md[1], skyU.uMoonDir.value);
  compassDir(sd[0], Math.max(sd[1], -4), U.uGlowDir.value);
}
function todPhaseName(p) {
  p = ((p % 3) + 3) % 3;
  if (p < 0.55 || p > 2.75) return 'Morning';
  if (p < 1.35) return 'Golden hour';
  if (p < 1.85) return 'Dusk';
  if (p < 2.45) return 'Night';
  return 'Dawn';
}
