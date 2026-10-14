/* ================================================================== */
/* weather2: weather that is real. Weather systems live on the map:    */
/* fronts, showers, thunderstorms, cloud banks and mist, born where    */
/* the realms' climates make them and carried across the March by the */
/* wind. The weather at any place comes from the systems over it      */
/* (weatherAt), and the clouds are drawn from the same systems: a     */
/* cloud field over the land round the camera (its shadows on the     */
/* ground), and the dome of the sky ray-marched through it (the sky,  */
/* the water's mirror and the northern lights read it).               */
/* ================================================================== */
// The cells: each an ellipse on the map (its half length a along its line, its half width b across it), its cover,
// rain, storm and mist at full strength, how tall its cloud stands; it grows, matures and dies away (s), and moves with
// the wind. The camera's own weather (WEATHER, 05e_weather.js) is the weather at the camera: every reader of WEATHER
// that has a place of its own asks weatherAt there instead. When the weather is held (Always clear in the settings, or a
// test that sets WEATHER.kind with WEATHER.next past 1e6, or WX.on false) it is one weather everywhere, as before.
const WX_N = 12; // cells the shaders see (the nearest to the camera)
const WX_BASE_Y = 230; // the cloud base (world y; the land lies between about -3 and 90 m)
const WX_KINDS = {
  //        half length, half width,  cover, rain, storm, mist, tall,  life (s),   grow, fade, speed (x the wind)
  front: { a: [650, 1050], b: [240, 360], cover: 0.97, precip: 0.8, storm: 0.12, mist: 0, thick: 0.55, life: [820, 1300], grow: 90, fade: 130, speed: [0.9, 1.1] },
  bank: { a: [320, 620], b: [200, 330], cover: 0.84, precip: 0, storm: 0, mist: 0, thick: 0.32, life: [420, 800], grow: 70, fade: 90, speed: [0.85, 1.05] },
  shower: { a: [160, 260], b: [130, 210], cover: 0.93, precip: 0.9, storm: 0.05, mist: 0, thick: 0.64, life: [200, 340], grow: 60, fade: 70, speed: [0.9, 1.15] },
  storm: { a: [220, 340], b: [180, 260], cover: 1.0, precip: 1.0, storm: 1.0, mist: 0, thick: 1.0, life: [240, 380], grow: 75, fade: 80, speed: [0.8, 1.0] },
  mist: { a: [240, 420], b: [200, 330], cover: 0.1, precip: 0, storm: 0, mist: 1.0, thick: 0.03, life: [260, 480], grow: 60, fade: 90, speed: [0.12, 0.25] },
};
// fair-weather cloud of each realm (the cover between the systems), Logres, Ériu, Thule; and how often each realm makes
// a system of its own (a second's chance, with the season's odds deciding what)
const WX_FAIR = [0.22, 0.34, 0.3];
const WX_MAKE = [0.014, 0.03, 0.022];
const WX = {
  on: true, cells: [], id: 1, t: 0,
  // the wind: the bearing it blows FROM (radians, compass), its speed (m/s), and where it is turning to
  wind: { from: 275 * DEG, s: 6, toFrom: 275 * DEG, toS: 6, next: 120 },
  off: { x: 0, z: 0 }, // how far the wind has carried the air (the clouds' noise moves with it)
  spawnT: 3, strikeT: {}, flash: { x: 0, y: 0, z: 0, k: 0 },
  grid: null, // the coarse field over the land (CPU readers) and the ground's wetness
  stats: { made: 0, gone: 0, strikes: 0, far: 0, cloudFlashes: 0, kinds: {} },
  seeded: false,
};
function wxHeld() { return !WX.on || WEATHER.mode !== 'auto' || WEATHER.next > 1e6; }
function wxLive() { return !wxHeld(); }
// a cell's strength through its life: it grows, holds, and dies away
function wxCellS(c) {
  const up = smooth(clamp(c.age / c.grow, 0, 1)), down = smooth(clamp((c.life - c.age) / c.fade, 0, 1));
  return up * down;
}
function wxWindVec() { const f = WX.wind.from; return { x: -Math.sin(f), z: Math.cos(f) }; } // the way it blows toward
// a realm's weight at a place by its bearing (the shaders' wxRealmW mirrors it): as realmWeightsAt, out to the horizon
function wxRealmW(x, z, out) {
  const b = Math.atan2(x, -z), r = Math.hypot(x, z), bl = sstep(10, 60, r);
  let s = 0;
  for (let k = 0; k < 3; k++) { const w = Math.pow(Math.max(0, Math.cos(angDiff(b, REALMS[k].bearing) * 0.75)), 6); out[k] = lerp(1 / 3, w, bl); s += out[k]; }
  for (let k = 0; k < 3; k++) out[k] /= s || 1;
  return out;
}
const _wxRW = [0, 0, 0];
function wxFairAt(x, z) {
  const w = wxRealmW(x, z, _wxRW), S = SEASON ? SEASON.idx : 0;
  const k = S === 3 ? 0.1 : S === 1 ? -0.05 : S === 2 ? 0.04 : 0.02;
  return clamp(w[0] * WX_FAIR[0] + w[1] * WX_FAIR[1] + w[2] * WX_FAIR[2] + k, 0, 0.6);
}
// the systems over a place (no noise: the shape of each cell, as the shaders draw it without their ragged edges)
const _wxF = { cover: 0, precip: 0, storm: 0, mist: 0, thick: 0 };
function wxFieldAt(x, z, o = _wxF) {
  let clear = 1 - wxFairAt(x, z), precip = 0, storm = 0, mist = 0, thick = 0.16;
  for (const c of WX.cells) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz > c.a * c.a * 1.1) continue;
    const al = (dx * c.ca + dz * c.sa) / c.a, ac = (-dx * c.sa + dz * c.ca) / c.b, d = Math.sqrt(al * al + ac * ac);
    if (d >= 1) continue;
    const s = c.s, e = 1 - sstep(0.4, 1, d), core = 1 - sstep(0.25, 0.8, d);
    clear *= 1 - c.cover * s * e;
    precip = Math.max(precip, c.precip * s * core);
    storm = Math.max(storm, c.storm * s * core);
    mist = Math.max(mist, c.mist * s * e);
    thick = Math.max(thick, c.thick * s * e);
  }
  o.cover = 1 - clear; o.precip = precip; o.storm = storm; o.mist = mist; o.thick = thick;
  return o;
}
// what the cover, rain and storm of a place make of the sky there (the old WEATHER_LOOK's measures)
function wxLook(f, o) {
  o.overcast = clamp((f.cover - 0.32) / 0.6, 0, 1) ** 1.15;
  o.raining = clamp(f.precip, 0, 1);
  o.storm = clamp(f.storm, 0, 1);
  o.mist = clamp(f.mist, 0, 1);
  o.fog = clamp(Math.max(0.25 * o.overcast, 0.7 * o.raining + 0.3 * o.storm, 0.45 * o.mist), 0, 1);
  return o;
}
function wxKindOf(o) { return o.storm > 0.5 ? 'storm' : o.raining > 0.3 ? 'rain' : o.mist > 0.5 ? 'mist' : o.overcast > 0.55 ? 'cloudy' : 'clear'; }
function wxLabelOf(kind, snowing) { return kind === 'clear' ? 'Clear' : kind === 'cloudy' ? 'Overcast' : kind === 'mist' ? 'Mist' : snowing > 0.3 ? (kind === 'storm' ? 'Blizzard' : 'Snow') : kind === 'storm' ? 'Storm' : 'Rain'; }
// the air's temperature at a place as the weather over it makes it (farmTempAt asks: the rain and the cloud there)
function wxTempAdj(x, z) {
  const night = U.uNight.value || 0;
  let rain, oc;
  if (wxHeld()) { rain = WEATHER.raining || 0; oc = WEATHER.overcast || 0; }
  else { const f = wxFieldAt(x, z, _wxF2); rain = clamp(f.precip, 0, 1); oc = clamp((f.cover - 0.32) / 0.6, 0, 1); }
  return -2.5 * rain - 1.2 * oc * (1 - night) + 1.5 * oc * night;
}
const _wxF2 = { cover: 0, precip: 0, storm: 0, mist: 0, thick: 0 };
// the same from the coarse grid (the season map's 16,000 texels ask it each second)
function wxTempAdjGrid(x, z) {
  const night = U.uNight.value || 0, rain = clamp(wxGridAt('precip', x, z), 0, 1), oc = clamp((wxGridAt('cover', x, z) - 0.32) / 0.6, 0, 1);
  return -2.5 * rain - 1.2 * oc * (1 - night) + 1.5 * oc * night;
}
/* the weather at a place: { cover, overcast, fog, raining (rain or snow falling), rain, snowing, storm, mist, wind (m/s),
   windX, windZ (the way it blows), temp (°C), wet (how wet the ground is), snow (snow lying), kind, label }. Every system
   with a place of its own asks here (the farms and stores of loops too); the camera's is WEATHER. */
function weatherAt(x, z, out) {
  const o = out || {};
  if (wxHeld()) {
    const W2 = WEATHER;
    o.cover = Math.max(W2.overcast || 0, 0.2); o.overcast = W2.overcast || 0; o.fog = W2.fog || 0; o.raining = W2.raining || 0;
    o.snowing = W2.snowing || 0; o.rain = Math.max(0, o.raining - o.snowing); o.storm = W2.storm || 0; o.mist = W2.mist || 0;
    o.wet = W2.wet || 0; o.kind = W2.kind; o.label = W2.label;
  } else {
    const f = wxFieldAt(x, z, _wxF);
    wxLook(f, o);
    o.cover = f.cover;
    const t = farmTempAt(x, z), coldK = clamp((1.5 - t) / 3.5, 0, 1);
    o.temp = t;
    o.snowing = o.raining * coldK; o.rain = o.raining * (1 - coldK);
    o.wet = wxGridAt('wet', x, z);
    o.kind = wxKindOf(o); o.label = wxLabelOf(o.kind, o.snowing);
  }
  if (o.temp === undefined || wxHeld()) o.temp = farmTempAt(x, z);
  const v = wxWindVec();
  o.wind = WX.wind.s * (1 + 0.8 * o.storm); o.windX = v.x; o.windZ = v.z;
  o.snow = typeof seasonSnowLieAt === 'function' ? Math.max(seasonSnowLieAt(x, z), wxHeld() ? WEATHER.snow || 0 : 0) : 0;
  return o;
}
// rain (not snow) falling at a place, and snow falling: the two most asked
const _wxQ = {};
function wxRainAt(x, z) { if (wxHeld()) return Math.max(0, (WEATHER.raining || 0) - (WEATHER.snowing || 0)); return weatherAt(x, z, _wxQ).rain; }
function wxPrecipAt(x, z) { if (wxHeld()) return WEATHER.raining || 0; return clamp(wxFieldAt(x, z, _wxF2).precip, 0, 1); }
function wxStormAt(x, z) { if (wxHeld()) return WEATHER.storm || 0; return clamp(wxFieldAt(x, z, _wxF2).storm, 0, 1); }
function wxSnowingAt(x, z) { if (wxHeld()) return WEATHER.snowing || 0; return weatherAt(x, z, _wxQ).snowing; }
function wxOvercastAt(x, z) { if (wxHeld()) return WEATHER.overcast || 0; return clamp((wxFieldAt(x, z, _wxF2).cover - 0.32) / 0.6, 0, 1); }
function wxWetAt(x, z) { if (wxHeld()) return WEATHER.wet || 0; return wxGridAt('wet', x, z); }

// how wet a keep's timber is (the burning walls, palisades and towers ask: 04g_blaze.js, 04g_burn.js, 04n_towerfire.js):
// as before, the ground's wetness by the rain falling, and the snow lying, but over that keep
function wxCastleWet(C, wet0, noSnow) {
  if (!wxLive() || !C || !C.S) return wet0;
  const x = C.S.x, z = C.S.z;
  return clamp(wxGridAt('wet', x, z), 0, 1) * (0.4 + 0.6 * clamp(wxGridAt('precip', x, z), 0, 1)) + (noSnow ? 0 : clamp(seasonSnowLieAt(x, z), 0, 1) * 0.3);
}
/* ---- the coarse grid over the land: the field a little ahead of time, and how wet the ground is ---- */
const WX_GN = 32, WX_GC = 1024 / WX_GN;
function wxGridInit() {
  const n = WX_GN * WX_GN;
  WX.grid = { precip: new Float32Array(n), rain: new Float32Array(n), snowing: new Float32Array(n), cover: new Float32Array(n), wet: new Float32Array(n), t: 0 };
}
function wxGridAt(key, x, z) {
  const G = WX.grid;
  if (!G) return key === 'wet' ? WEATHER.wet || 0 : 0;
  const A = G[key], gx = clamp((x + HALF) / WX_GC - 0.5, 0, WX_GN - 1.001), gz = clamp((z + HALF) / WX_GC - 0.5, 0, WX_GN - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, q = j * WX_GN + i;
  return lerp(lerp(A[q], A[q + 1], u), lerp(A[q + WX_GN], A[q + WX_GN + 1], u), v);
}
// the ground soaks up the rain where it falls and dries in the sun and the wind (as WEATHER.wet does at the camera)
function wxGridStep(dt) {
  const G = WX.grid; if (!G) return;
  const sun = sunStrength0(), wind = clamp((U.uWind.value - 1) / 1.5, 0, 1);
  const held = wxHeld();
  for (let j = 0; j < WX_GN; j++) for (let i = 0; i < WX_GN; i++) {
    const q = j * WX_GN + i, x = -HALF + (i + 0.5) * WX_GC, z = -HALF + (j + 0.5) * WX_GC;
    let rain, snowing, cover;
    if (held) { rain = Math.max(0, (WEATHER.raining || 0) - (WEATHER.snowing || 0)); snowing = WEATHER.snowing || 0; cover = WEATHER.overcast || 0; }
    else {
      const f = wxFieldAt(x, z, _wxF2), p = clamp(f.precip, 0, 1);
      const t = farmTempAt(x, z), coldK = clamp((1.5 - t) / 3.5, 0, 1);
      rain = p * (1 - coldK); snowing = p * coldK; cover = f.cover;
      G.precip[q] = p;
    }
    G.rain[q] = rain; G.snowing[q] = snowing; G.cover[q] = cover;
    const sunHere = sun * (1 - clamp((cover - 0.32) / 0.6, 0, 1));
    G.wet[q] = clamp(G.wet[q] + (rain > 0.2 ? dt * rain / 50 : -dt * (1 + 2.6 * sunHere + 0.8 * wind) / 140), 0, 1);
  }
}
// the sun's strength in a clear sky (sunStrength in 05h_wear.js weighs the camera's own cloud)
function sunStrength0() { return clamp(1 - U.uNight.value * 1.3, 0, 1) * clamp(U.uLightDir.value.y * 2.2, 0, 1); }

/* ---- the systems: born of the realms' climates, carried by the wind, growing and dying away ---- */
function wxRand(a) { return a[0] + Math.random() * (a[1] - a[0]); }
function wxMake(kind, x, z, o = {}) {
  const K = WX_KINDS[kind];
  const v = wxWindVec();
  const ang = o.ang !== undefined ? o.ang : kind === 'front' ? Math.atan2(v.z, v.x) + Math.PI / 2 : Math.random() * Math.PI;
  const c = {
    id: WX.id++, kind, x, z, ang, ca: Math.cos(ang), sa: Math.sin(ang),
    a: wxRand(K.a), b: wxRand(K.b), cover: K.cover, precip: K.precip * (o.wetK || 1), storm: K.storm, mist: K.mist, thick: K.thick,
    age: o.age || 0, life: wxRand(K.life), grow: K.grow, fade: K.fade, sp: wxRand(K.speed), realm: o.realm ?? realmAt(clamp(x, -400, 400), clamp(z, -400, 400)), s: 0,
  };
  if (c.b > c.a) { const t = c.a; c.a = c.b; c.b = t; }
  c.s = wxCellS(c);
  WX.cells.push(c);
  WX.stats.made++; WX.stats.kinds[kind] = (WX.stats.kinds[kind] || 0) + 1;
  return c;
}
// what a realm's climate makes now: its season's odds (seasonWeatherOdds, 08h_farming.js), mist only by night and at dawn
function wxClimateKind(realm, upwind) {
  const odds = seasonWeatherOdds(WEATHER_ODDS[realm]);
  let r = Math.random(), i = 0;
  for (; i < odds.length - 1; i++) { if (r < odds[i]) break; r -= odds[i]; }
  const k = ['clear', 'cloudy', 'rain', 'storm', 'mist'][i];
  if (k === 'clear') return null;
  if (k === 'cloudy') return 'bank';
  if (k === 'rain') return upwind || Math.random() < 0.3 ? 'front' : 'shower';
  if (k === 'storm') return 'storm';
  const p = tod.p;
  if (k === 'mist') return upwind ? 'bank' : (p > 1.75 || p < 0.35) ? 'mist' : null;
  return null;
}
function wxSpawnStep(dt) {
  WX.spawnT -= dt;
  if (WX.spawnT > 0) return;
  WX.spawnT = 5 + Math.random() * 5;
  const v = wxWindVec();
  const near = WX.cells.filter((c) => Math.hypot(c.x, c.z) < 1500 && c.kind !== 'mist').length;
  if (near >= 9) return;
  // from beyond the March, upwind: the weather of the realm the wind comes over
  if (Math.random() < 0.55) {
    const side = (Math.random() - 0.5) * 1300, d = 1150 + Math.random() * 250;
    const x = -v.x * d - v.z * side, z = -v.z * d + v.x * side;
    const realm = realmAt(-v.x * 300, -v.z * 300);
    if (Math.random() < WX_MAKE[realm] * 16) { const k = wxClimateKind(realm, true); if (k) wxMake(k, x, z, { realm }); }
  }
  // over a realm: a shower or a storm building in the warm air, a cloud bank, mist in the low ground at night
  for (let r = 0; r < 3; r++) {
    if (Math.random() > WX_MAKE[r] * 12) continue;
    const k = wxClimateKind(r, false);
    if (!k) continue;
    const R = REALMS[r], a = R.bearing + (Math.random() - 0.5) * 100 * DEG, rr = k === 'mist' ? 260 + Math.random() * 180 : 120 + Math.random() * 420;
    // it forms upwind of the place it will cross
    let x = Math.sin(a) * rr - v.x * 250, z = -Math.cos(a) * rr - v.z * 250;
    if (k === 'mist') { x = Math.sin(a) * rr; z = -Math.cos(a) * rr; }
    wxMake(k, x, z, { realm: r });
  }
}
function wxWindStep(dt) {
  const W = WX.wind;
  W.next -= dt;
  if (W.next <= 0) {
    W.next = 160 + Math.random() * 260;
    // westerlies off Ériu most of the year; northerlies out of Thule now and then, more in winter; a calm easterly in summer
    const S = SEASON ? SEASON.idx : 0, r = Math.random();
    const north = S === 3 ? 0.35 : 0.14, east = S === 1 ? 0.12 : 0.05;
    W.toFrom = (r < north ? 15 + Math.random() * 35 : r < north + east ? 100 + Math.random() * 40 : 240 + Math.random() * 60) * DEG;
    W.toS = 3.5 + Math.random() * 6;
  }
  W.from += angDiff(W.from, W.toFrom) * (1 - Math.exp(-dt / 70));
  W.s += (W.toS - W.s) * (1 - Math.exp(-dt / 50));
}
// the simulation step (13_main.js simStep): the systems move, grow and die away; the land's grid follows them
function updateWeather2(dt) {
  if (!WX.grid) wxGridInit();
  WX.t += dt;
  wxWindStep(dt);
  const v = wxWindVec(), s = WX.wind.s;
  WX.off.x += v.x * s * 0.8 * dt; WX.off.z += v.z * s * 0.8 * dt;
  if (!WX.seeded && !wxHeld()) wxSeed();
  const sunUp = sunStrength0();
  for (let i = WX.cells.length - 1; i >= 0; i--) {
    const c = WX.cells[i];
    c.age += dt * (c.kind === 'mist' ? 1 + 2.5 * sunUp : 1); // mist burns off in the sun
    const k = c.sp * s * 0.8;
    c.x += v.x * k * dt; c.z += v.z * k * dt;
    if (c.kind === 'front') { const ta = Math.atan2(v.z, v.x) + Math.PI / 2; c.ang += angDiff(c.ang, ta) * (1 - Math.exp(-dt / 120)); c.ca = Math.cos(c.ang); c.sa = Math.sin(c.ang); }
    c.s = wxCellS(c);
    if (c.age >= c.life || Math.hypot(c.x, c.z) > 2600) { WX.cells.splice(i, 1); WX.stats.gone++; }
  }
  if (!wxHeld()) wxSpawnStep(dt);
  WX.grid.t -= dt;
  if (WX.grid.t <= 0) { const gdt = 0.5 - WX.grid.t; WX.grid.t = 0.5; wxGridStep(gdt); }
  wxStrikeStep(dt);
}
// a world that starts with weather already about it (a new game or an old save): a few systems at their ages
function wxSeed() {
  WX.seeded = true;
  if (WX.cells.length) return;
  for (let n = 0; n < 3; n++) {
    const r = Math.floor(Math.random() * 3), k = wxClimateKind(r, false) || 'bank';
    const a = Math.random() * TAU, rr = 300 + Math.random() * 900;
    wxMake(k === 'mist' ? 'bank' : k, Math.sin(a) * rr, -Math.cos(a) * rr, { realm: r, age: 40 + Math.random() * 200 });
  }
}

/* ---- lightning comes down under the storms (and lights them from within) ---- */
function wxStrikeStep(dt) {
  WX.flash.k = Math.max(0, WX.flash.k - dt * 3.5);
  if (wxHeld() || INDOOR.on) return;
  const cam = camera.position, P = GAME.player;
  for (const c of WX.cells) {
    const st = c.storm * c.s;
    if (st < 0.45) continue;
    const T = WX.strikeT;
    T[c.id] = (T[c.id] ?? 2 + Math.random() * 6) - dt * st;
    if (T[c.id] > 0) continue;
    T[c.id] = 4 + Math.random() * 10;
    // a point under its core
    const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * 0.55;
    const lx = Math.cos(a) * rr * c.a, lz = Math.sin(a) * rr * c.b;
    const x = c.x + lx * c.ca - lz * c.sa, z = c.z + lx * c.sa + lz * c.ca;
    const d = Math.hypot(x - cam.x, z - cam.z);
    if (Math.random() < 0.45) { wxCloudFlash(x, z, d); continue; } // in the cloud: the cloud lights up, thunder rolls
    const onMap = Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10;
    (WX.stats.at || (WX.stats.at = [])).push([Math.round(x), Math.round(z), c.id]); if (WX.stats.at.length > 40) WX.stats.at.shift();
    if (onMap && P && !inDungeon(P) && Math.hypot(x - P.x, z - P.z) < 260) { WX.stats.strikes++; strikeNear(x, z, 0, 28); }
    else if (onMap && Math.random() < 0.5) { WX.stats.strikes++; natureStrike(x, z, 10); wxBoltVisual(x, z, d); }
    else if (d < 2200) { WX.stats.far++; wxBoltVisual(x, z, d); }
  }
}
function wxCloudFlash(x, z, d) {
  const cam = camera.position, y = WX_BASE_Y + 120;
  const L = Math.hypot(x - cam.x, y - cam.y, z - cam.z) || 1;
  WX.flash.x = (x - cam.x) / L; WX.flash.y = (y - cam.y) / L; WX.flash.z = (z - cam.z) / L;
  WX.flash.k = Math.max(WX.flash.k, clamp(1.3 - d / 2400, 0.25, 1));
  WEATHER.flash = Math.max(WEATHER.flash, clamp(0.55 - d / 3000, 0, 0.5));
  WX.stats.cloudFlashes++;
  if (d < 2600) setTimeout(() => sfxAt('thunder', x, y, z, { now: true, vol: clamp(1.4 - d / 2000, 0.25, 1) }), (d / 343) * 1000 * 0.6);
}
// a bolt seen from afar, from the cloud base down to the ground (its glow, the flash in the cloud, thunder after)
function wxBoltVisual(x, z, d) {
  const gy = heightAt(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF)), top = WX_BASE_Y + 20;
  const path = [];
  let px = x + (Math.random() - 0.5) * 60, pz = z + (Math.random() - 0.5) * 60, py = top;
  while (py > gy) {
    const ny = Math.max(gy, py - 6 - Math.random() * 10);
    const nx = px + (Math.random() - 0.5) * 12 + (x - px) * 0.1, nz = pz + (Math.random() - 0.5) * 12 + (z - pz) * 0.1;
    for (let i = 1; i <= 2; i++) path.push([lerp(px, nx, i / 2), lerp(py, ny, i / 2), lerp(pz, nz, i / 2), (3 + Math.random() * 1.5) * (1 + d / 800)]);
    px = nx; py = ny; pz = nz;
  }
  WEATHER.bolts.push({ path, t: 0 });
  wxCloudFlash(x, z, d);
  WEATHER.flash = Math.max(WEATHER.flash, clamp(1 - d / 900, 0.15, 1));
  if (d < 600) lightFlash(clamp(x, -HALF, HALF), gy + 20, clamp(z, -HALF, HALF), 170, [3.0, 3.3, 4.2], 0.5);
}

/* ---- the save: the systems, the wind and the air carried (world part 'wx'; one small part the host can share) ---- */
function wxSave() {
  return {
    v: 1, w: [Math.round(WX.wind.from * 1000) / 1000, Math.round(WX.wind.s * 10) / 10, Math.round(WX.wind.toFrom * 1000) / 1000, Math.round(WX.wind.toS * 10) / 10, Math.round(WX.wind.next)],
    o: [Math.round(WX.off.x), Math.round(WX.off.z)],
    c: WX.cells.map((c) => [c.kind, Math.round(c.x), Math.round(c.z), Math.round(c.ang * 1000) / 1000, Math.round(c.a), Math.round(c.b), Math.round(c.age), Math.round(c.life), Math.round(c.sp * 100) / 100, Math.round(c.precip * 100) / 100, c.realm]),
    g: WX.grid ? Array.from(WX.grid.wet, (v) => Math.round(v * 99)) : null,
  };
}
function wxLoad(d) {
  WX.cells.length = 0; WX.strikeT = {}; WX.seeded = false;
  if (!d || typeof d !== 'object' || d.v !== 1) return;
  const num = (v, a, b, def) => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : def);
  if (Array.isArray(d.w)) { WX.wind.from = num(d.w[0], -10, 10, WX.wind.from); WX.wind.s = num(d.w[1], 0, 30, 6); WX.wind.toFrom = num(d.w[2], -10, 10, WX.wind.from); WX.wind.toS = num(d.w[3], 0, 30, 6); WX.wind.next = num(d.w[4], 0, 2000, 120); }
  if (Array.isArray(d.o)) { WX.off.x = num(d.o[0], -1e7, 1e7, 0); WX.off.z = num(d.o[1], -1e7, 1e7, 0); }
  if (Array.isArray(d.c)) for (const r of d.c.slice(0, 40)) {
    if (!Array.isArray(r) || !WX_KINDS[r[0]]) continue;
    const x = num(r[1], -4000, 4000, NaN), z = num(r[2], -4000, 4000, NaN);
    if (!isFinite(x) || !isFinite(z)) continue;
    const c = wxMake(r[0], x, z, { ang: num(r[3], -10, 10, 0), realm: num(r[10], 0, 2, 0) | 0 });
    WX.stats.made--; WX.stats.kinds[r[0]]--;
    c.a = num(r[4], 50, 2000, c.a); c.b = num(r[5], 50, 2000, c.b); c.life = num(r[7], 30, 2000, c.life); c.age = num(r[6], 0, c.life, 0);
    c.sp = num(r[8], 0, 3, c.sp); c.precip = num(r[9], 0, 1.5, c.precip); c.s = wxCellS(c);
  }
  WX.seeded = WX.cells.length > 0;
  if (Array.isArray(d.g) && d.g.length === WX_GN * WX_GN) { if (!WX.grid) wxGridInit(); for (let i = 0; i < d.g.length; i++) WX.grid.wet[i] = num(d.g[i], 0, 99, 0) / 99; }
}
registerSavePart('world', 'wx', {
  save: wxSave, load: wxLoad,
  // a change worth writing: a system made or gone (not their clocks or places, which move all the time)
  key: (d) => (d && Array.isArray(d.c) ? d.c.map((r) => r[0]).join(',') : ''),
});

/* ================================================================== */
/* the clouds drawn: the cloud field and the dome of the sky            */
/* ================================================================== */
// quality: the field's size, the dome's size, the steps through the cloud, whether the rain hangs under it, how often
// (scr: the main view's own clouds at one pixel in scr of the view each way; the dome, for the water's mirror and the
// northern lights, smaller and drawn less often)
const WX_Q = {
  high: { field: 256, dome: 256, steps: 14, veil: 1, every: 1, scr: 2 },
  medium: { field: 192, dome: 192, steps: 10, veil: 1, every: 2, scr: 3 },
  low: { field: 128, dome: 160, steps: 7, veil: 0, every: 2, scr: 4 },
};
const WX_R = 1500; // the field's warp: metres near the camera per unit (it reaches to the horizon)
const WXR = { field: null, dome: null, fieldMat: null, domeMat: null, q: null, n: 0, on: true, cellA: null, cellB: null, cellC: null, mistY: 0 };
const GLSL_WXFIELD = /* glsl */`
uniform vec4 uWxA[${WX_N}], uWxB[${WX_N}], uWxC[${WX_N}];
uniform vec4 uWxBase; // fair cloud of Logres, Ériu, Thule
uniform vec4 uWxHeld; // a held weather (x >= 0: its cover the whole sky over, its rain, storm, tallness), else x -1
uniform vec4 uWxWind; // the air carried by the wind (x, z), the cells in use
float wxBear(vec2 xz, float b){ float d = mod(atan(xz.x, -xz.y) - b + 3.14159265, 6.2831853) - 3.14159265; return pow(max(0.0, cos(d * 0.75)), 6.0); }
float wxFair(vec2 xz){
  vec3 w = vec3(wxBear(xz, 2.6179939), wxBear(xz, 4.712389), wxBear(xz, 0.5235988));
  w = mix(vec3(1.0 / 3.0), w, smoothstep(10.0, 60.0, length(xz)));
  return dot(w / max(w.x + w.y + w.z, 1e-4), uWxBase.xyz);
}
// cover, rain, storm and tallness at a place from the systems over it (wxFieldAt in 12c_weather2.js, with ragged edges)
vec4 wxField(vec2 xz, out float storm){
  if (uWxHeld.x >= 0.0) { storm = uWxHeld.z; return vec4(uWxHeld.x, uWxHeld.y, uWxHeld.z, uWxHeld.w); }
  float clear = 1.0 - wxFair(xz), precip = 0.0, thick = 0.16; storm = 0.0;
  int n = int(uWxWind.z + 0.5);
  for (int i = 0; i < ${WX_N}; i++) {
    if (i >= n) break;
    vec4 A = uWxA[i], B = uWxB[i], C = uWxC[i];
    vec2 d = xz - A.xy;
    if (dot(d, d) > B.x * B.x * 2.6) continue;
    vec2 l = vec2(dot(d, A.zw), dot(d, vec2(-A.w, A.z))) / B.xy;
    float r = length(l) * (1.0 + (vnoise(xz * 0.0045 + float(i) * 7.13) - 0.5) * 0.42);
    // a storm's anvil spreads out over its tower, farther than its cloud reaches below (the storm channel carries it)
    if (C.y > 0.0) storm = max(storm, C.y * (1.0 - smoothstep(0.3, 1.55, r)) * (r < 1.0 ? 1.0 : 0.85));
    if (r >= 1.0) continue;
    float e = 1.0 - smoothstep(0.4, 1.0, r), core = 1.0 - smoothstep(0.25, 0.8, r);
    clear *= 1.0 - B.z * e;
    precip = max(precip, C.x * core);
    thick = max(thick, B.w * sqrt(max(0.0, 1.0 - r * r)) * (0.35 + 0.65 * e)); // a dome: tallest over its heart
  }
  return vec4(1.0 - clear, precip, storm, thick);
}
`;
// the march itself (the dome's and the screen's): from the eye along rd through the cloud field
const GLSL_WXMARCH = /* glsl */`
uniform sampler2D uCloudMap;
uniform vec4 uCloudMapP, uDomeP, uWxWindD;
uniform vec3 uEye;
uniform vec3 uCloudLit, uCloudShade;
uniform float uSunVis;
vec4 cmap(vec2 xz){ vec2 d = xz - uCloudMapP.xy; vec2 q = d / (uCloudMapP.z + length(d)); return texture(uCloudMap, q * 0.5 + 0.5); }
vec4 wxMarch(vec3 ro, vec3 rd, float jit){
          float base = uCloudMapP.w, topMax = base + 650.0;
          float sy = max(rd.y, 0.012);
          float t0 = max(0.0, (base - ro.y) / sy), t1 = min((topMax - ro.y) / sy, t0 + 6500.0);
          t1 = min(t1, uDomeP.y);
          vec3 C = vec3(0.0); float T = 1.0, tHit = -1.0;
          vec3 L = safeNormalize(uLightDir);
          float sunUp = smoothstep(-0.05, 0.12, L.y);
          vec3 Lf = L.y > 0.08 ? L : safeNormalize(vec3(L.x, 0.08, L.z));
          float cosA = dot(rd, Lf);
          // forward scattering: the cloud's edges toward the sun or the moon light up
          float phase = 0.55 + 0.9 * spow(cosA * 0.5 + 0.5, 6.0) + 0.6 * spow(max(cosA, 0.0), 40.0);
          vec3 amb = mix(uHorizon, uZenith, 0.55);
          if (t1 > t0) {
            // two paces: long strides through the clear air to the first cloud along the ray, then short steps through it
            // (one long stride back), so its edges and crowns are resolved and do not stand in layers
            int steps = int(uDomeP.x + 0.5);
            float dt = (t1 - t0) / float(steps);
            float dtF = clamp(dt * 0.22, 14.0, 150.0);
            float detK = 1.0 - smoothstep(70.0, 420.0, dtF * length(rd.xz));
            vec3 skyA = mix(uHorizon, uZenith, 0.6);
            float t = t0 + jit * dt * 0.5;
            bool fine = false;
            float tBack = t0, tKeep = 0.0; // never step back behind where the short steps last left the cloud; keep short past the stride that found it
            for (int i = 0; i < 56; i++) {
              if (i >= steps * 4 || t > t1 || T < 0.015) break;
              vec3 p = ro + rd * t;
              // within the cloud its sides bulge and draw in with height (a heap of heaps, not a column)
              vec2 xzw = p.xz;
              if (fine) { float hb = clamp((p.y - base) / 600.0, 0.0, 1.0); vec2 pq = (p.xz - uWxWindD.xy) * 0.0032 + p.y * 0.0075; xzw += (vec2(vnoise(pq + 1.3), vnoise(pq.yx - 8.1)) - 0.5) * (70.0 + 230.0 * hb); }
              vec4 F = cmap(xzw);
              float top = base + 45.0 + F.g * 600.0;
              float hh = (p.y - base) / (top - base);
              float av = F.a * smoothstep(base + 530.0, base + 575.0, p.y) * (1.0 - smoothstep(base + 610.0, base + 645.0, p.y));
              bool cloud = (F.r > 0.02 && hh <= 1.08) || av > 0.04;
              if (!fine) {
                if (cloud) { fine = true; tKeep = t + dt * 0.5; t = max(tBack, t - dt) + jit * dtF; continue; }
                t += dt; continue;
              }
              if (!cloud) { if (t > tKeep) { fine = false; tBack = t; } t += dtF; continue; }
              // a flat base, a rounded crown; the shapes broken by a finer noise riding on the wind
              vec2 pw = p.xz - uWxWindD.xy;
              float det2 = 1.0 - smoothstep(16.0, 70.0, dtF * length(rd.xz)); // (the finest only where the steps resolve it)
              float dn = vnoise(pw * 0.0062 + vec2(p.y * 0.011, -p.y * 0.008)) * 0.62 + mix(0.19, vnoise(pw * 0.017 + p.y * 0.015 + 7.1) * 0.38, det2);
              float prof = smoothstep(0.0, 0.06, hh) * (1.0 - smoothstep(0.45 + 0.3 * F.r, 1.0, hh + (dn - 0.5) * 0.35 * detK));
              float dens = clamp(F.r * prof * 1.5 - (1.0 - dn) * mix(0.5, 0.12, F.r) * detK, 0.0, 1.0);
              dens = max(dens, smoothstep(0.04, 0.45, av - (1.0 - dn) * 0.25 * detK) * 0.8);
              if (dens > 0.004) {
                // the light's way out of the cloud toward the sun or the moon (the field a little along it)
                // the light's way to here: two looks along it (near and far), each counting the cloud only where the way
                // passes inside it (under its top), so a side or a crown toward the light is lit and the far side is not
                float od = 0.0;
                for (int k = 0; k < 2; k++) {
                  vec3 q = p + Lf * (k == 0 ? 110.0 : 340.0);
                  vec4 G = cmap(q.xz);
                  float tq = base + 45.0 + G.g * 600.0;
                  float inq = G.r * smoothstep(-20.0, 60.0, tq - q.y) * smoothstep(-30.0, 10.0, q.y - base);
                  inq = max(inq, G.a * step(base + 530.0, q.y) * step(q.y, base + 645.0) * 0.6);
                  od += inq * (k == 0 ? 1.0 : 1.5);
                }
                od += F.r * 0.25 * (1.0 - hh);
                float sunT = exp(-od * 1.7);
                vec3 col = uCloudLit * (sunT * phase * sunUp * 0.95) + (uCloudShade * 0.55 + skyA * 0.32) * (0.5 + 0.5 * hh);
                col *= (1.0 - 0.4 * F.b * (1.0 - hh)) * (1.0 - 0.22 * F.a); // rain and storm darken the base
                col *= 0.82 + 0.36 * dn * detK + 0.18 * (1.0 - detK); // the billows: their crowns catch more of the light
                col += uSunGlow * spow(max(cosA, 0.0), 6.0) * (1.0 - dens) * 0.6 * uSunVis * sunUp;
                float a = 1.0 - exp(-dens * uDomeP.w * dtF);
                if (tHit < 0.0) tHit = t;
                C += T * a * col; T *= 1.0 - a;
              }
              t += dtF;
            }
          }
          // the distance fades the far clouds into the haze of the horizon
          if (tHit > 0.0) {
            float hz = 1.0 - exp(-tHit / 11000.0);
            hz = max(hz, 1.0 - smoothstep(0.0, 0.07, rd.y));
            C = mix(C, skyBase(rd) * (1.0 - T), clamp(hz, 0.0, 0.85));
          }
          // rain and snow hanging under the cloud, seen from afar: a grey veil in front of what lies behind it
          if (uDomeP.z > 0.5 && rd.y < 0.4 && t0 > 60.0) {
            float v = 0.0;
            for (int k = 0; k < 4; k++) { float t = t0 * (float(k) + 0.5) / 4.0; v += cmap(ro.xz + rd.xz * t).b; }
            float va = (1.0 - exp(-v * 0.25 * t0 * 0.0007)) * 0.85;
            vec3 vc = mix(uCloudShade * 0.55 + amb * 0.25, skyBase(rd), 0.35);
            C = va * vc + (1.0 - va) * C; T *= 1.0 - va;
          }
          return vec4(safeColor(C), clamp(T, 0.0, 1.0));
}
`;
function wxBuildClouds() {
  const q = WX_Q[quality.level] || WX_Q.medium;
  WXR.q = q;
  const mk = (n, type) => { const rt = new THREE.WebGLRenderTarget(n, n, { depthBuffer: false, stencilBuffer: false, type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }); rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping; return rt; };
  if (WXR.field) WXR.field.dispose();
  if (WXR.dome) WXR.dome.dispose();
  WXR.field = mk(q.field, THREE.UnsignedByteType);
  WXR.dome = mk(q.dome, RT_TYPE);
  if (!WXR.fieldMat) {
    const cu = { uWxA: { value: Array.from({ length: WX_N }, () => new THREE.Vector4()) }, uWxB: { value: Array.from({ length: WX_N }, () => new THREE.Vector4(1, 1, 0, 0)) }, uWxC: { value: Array.from({ length: WX_N }, () => new THREE.Vector4()) }, uWxBase: { value: new THREE.Vector4(0.2, 0.3, 0.3, 0) }, uWxHeld: { value: new THREE.Vector4(-1, 0, 0, 0) }, uWxWind: { value: new THREE.Vector4() } };
    WXR.cu = cu;
    WXR.fieldMat = new THREE.ShaderMaterial({
      uniforms: { ...cu, uCloudMapP: U.uCloudMapP, uTime: U.uTime },
      vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        ${GLSL_WXFIELD}
        uniform vec4 uCloudMapP;
        varying vec2 vUv;
        void main(){
          vec2 q = vUv * 2.0 - 1.0;
          float L = length(q);
          vec2 d = L < 0.998 ? q * uCloudMapP.z / (1.0 - L) : q / max(L, 1e-4) * uCloudMapP.z * 500.0;
          vec2 xz = uCloudMapP.xy + d;
          float storm;
          vec4 F = wxField(xz, storm);
          // the clouds themselves: heaps of cumulus where the cover is thin, a broken deck as it thickens, a sheet under a
          // full cover; the shapes ride on the wind (the air carried)
          vec2 p = (xz - uWxWind.xy) * (1.0 / 560.0);
          vec2 w = vec2(fbm3(p * 0.7 + 3.1), fbm3(p * 0.7 - 5.7)) - 0.5;
          float n = fbm(p + w * 0.9 + 0.3);
          float c = F.x;
          float thr = mix(0.79, 0.12, c);
          float dens = smoothstep(thr - 0.05, thr + 0.16, n);
          dens = max(dens, smoothstep(0.8, 1.0, c) * (0.62 + 0.3 * n));
          // far off the shapes are lost in the warp's texels: keep their mean
          float far = smoothstep(0.55, 0.9, L);
          dens = mix(dens, smoothstep(0.1, 0.95, c) * 0.9, far * 0.6);
          // each heap stands as tall as its own: the towers of a storm, the low puffs of fair weather
          float bil = fbm3(p * 2.6 + w * 1.4 + 7.3); // billows: the heaps' crowns rise and fall whatever the cover
          float tall = F.w * (0.4 + 0.45 * smoothstep(thr - 0.05, thr + 0.35, n) + 0.55 * smoothstep(0.3, 0.75, bil));
          gl_FragColor = vec4(clamp(dens, 0.0, 1.0), clamp(tall, 0.0, 1.0), clamp(F.y, 0.0, 1.0), clamp(storm, 0.0, 1.0));
        }`,
    });
    WXR.domeMat = mat({
      uniforms: { uCloudLit: skyU.uCloudLit, uCloudShade: skyU.uCloudShade, uSunVis: skyU.uSunVis, uDomeP: { value: new THREE.Vector4(10, 9000, 1, 0.012) }, uWxWindD: cu.uWxWind, uEye: { value: new THREE.Vector3() } },
      vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        ${GLSL_ATMOS}
        ${GLSL_WXMARCH}
        varying vec2 vUv;
        void main(){
          vec2 q = vUv * 2.0 - 1.0;
          float r = length(q);
          if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          float e = 1.5707963 * pow(1.0 - r, 1.6);
          vec2 h = r > 1e-5 ? q / r : vec2(1.0, 0.0);
          vec3 rd = vec3(h.x * cos(e), sin(e), h.y * cos(e));
          // (the pass is drawn with a camera of its own: cameraPosition is not the eye's)
          gl_FragColor = wxMarch(uEye, rd, hash12(gl_FragCoord.xy));
        }`,
    });
    // the main view's own clouds: the same march for each pixel of the view (at a half, a third or a quarter of its size),
    // so they are as sharp as what stands before them; the dome serves the water's mirror and the northern lights
    const du = WXR.domeMat.uniforms;
    WXR.scrMat = mat({
      uniforms: { uCloudLit: du.uCloudLit, uCloudShade: du.uCloudShade, uSunVis: du.uSunVis, uDomeP: du.uDomeP, uWxWindD: du.uWxWindD, uEye: { value: new THREE.Vector3() }, uInvVPw: { value: new THREE.Matrix4() } },
      vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
        ${GLSL_COMMON}
        ${GLSL_ATMOS}
        ${GLSL_WXMARCH}
        uniform mat4 uInvVPw;
        varying vec2 vUv;
        void main(){
          vec4 p = uInvVPw * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 rd = safeNormalize(p.xyz / (abs(p.w) > 1e-6 ? p.w : 1e-6) - uEye);
          if (rd.y < -0.035) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          // interleaved gradient noise: the steps' start spread evenly over neighbouring pixels (no clumps)
          float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          gl_FragColor = wxMarch(uEye, rd, jit);
        }`,
    });
  }
  WXR.domeMat.uniforms.uDomeP.value.set(q.steps, 9000, q.veil, 0.012);
  U.uCloudMap.value = WXR.field.texture;
  U.uCloudDome.value = WXR.dome.texture;
  U.uCloudDomeOn.value.x = 1;
}
// rain hanging under its cloud, seen from afar: a veil of falling streaks through each raining cell, turned to the
// camera, as wide as the rain the cloud field holds along it (the drops round the camera take over within 150 m)
const WX_SHAFT_N = 8;
function wxBuildShafts() {
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1, 1, 1);
  g.setAttribute('position', q.attributes.position); g.setIndex(q.index);
  g.setAttribute('iS', new THREE.InstancedBufferAttribute(new Float32Array(WX_SHAFT_N * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  const m = new THREE.Mesh(g, mat({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec4 iS; // the cell's middle x, z, the veil's half width, its rain
      uniform vec4 uCloudMapP;
      varying vec3 vW; varying float vR;
      void main(){
        vec2 c = iS.xy, to = cameraPosition.xz - c;
        vec2 side = to.x * to.x + to.y * to.y > 1.0 ? normalize(vec2(-to.y, to.x)) : vec2(1.0, 0.0);
        vec2 xz = c + side * position.x * 2.0 * iS.z;
        vW = vec3(xz.x, mix(-24.0, uCloudMapP.w + 15.0, position.y + 0.5), xz.y); vR = iS.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      uniform sampler2D uCloudMap; uniform vec4 uCloudMapP;
      varying vec3 vW; varying float vR;
      void main(){
        vec2 dd = vW.xz - uCloudMapP.xy; vec2 q = dd / (uCloudMapP.z + length(dd));
        vec4 F = texture(uCloudMap, q * 0.5 + 0.5);
        float d = distance(vW, cameraPosition);
        float st = vnoise(vec2((vW.x + vW.z) * 0.06, vW.y * 0.012 + uTime * 0.9)) * 0.6 + vnoise(vec2((vW.x - vW.z) * 0.21, vW.y * 0.05 + uTime * 2.3)) * 0.4;
        float a = smoothstep(0.06, 0.55, F.b) * (0.45 + 0.55 * st) * smoothstep(140.0, 420.0, d) * (1.0 - smoothstep(uCloudMapP.w - 40.0, uCloudMapP.w + 10.0, vW.y)) * 0.5;
        if (a < 0.004) discard;
        vec3 col = (uAmbient * 0.8 + uLightColor * 0.12) * (0.75 - 0.25 * F.a);
        gl_FragColor = vec4(safeColor(applyFog(col, vW)), a);
      }`,
  }));
  m.frustumCulled = false; m.renderOrder = 6;
  scene.add(m);
  WXR.shafts = m;
}
function wxShaftsFrame() {
  if (!WXR.shafts) wxBuildShafts();
  const m = WXR.shafts, A = m.geometry.attributes.iS, cam = camera.position;
  let n = 0;
  if (!INDOOR.on) {
    const L = _wxCellList; // the cells nearest the camera, sorted (wxCloudsFrame)
    for (const [d, c] of L) {
      if (n >= WX_SHAFT_N || d > 4500) break;
      const pr = c.precip * c.s;
      if (pr < 0.15) continue;
      A.array[n * 4] = c.x; A.array[n * 4 + 1] = c.z; A.array[n * 4 + 2] = Math.max(c.a, c.b) * 0.85; A.array[n * 4 + 3] = pr;
      n++;
    }
    if (wxHeld() && (WEATHER.raining || 0) > 0.15) { /* a held rain falls everywhere: the drops show it */ }
  }
  m.geometry.instanceCount = n; m.visible = n > 0;
  if (n) A.needsUpdate = true;
  void cam;
}
// the frame (13_main.js tick, after applyWeather): the cells to the shaders, the field, the dome, the shadows, the mist
const _wxCellList = [];
function wxCloudsFrame(dt) {
  wxShelterStep(dt);
  if (!WXR.on) { U.uCloudDomeOn.value.x = 0; U.uCloudSh.value.w = 0; return; }
  if (!WXR.field || WXR.q !== (WX_Q[quality.level] || WX_Q.medium)) wxBuildClouds();
  const cu = WXR.cu, cam = camera.position, held = wxHeld();
  // the nearest cells
  _wxCellList.length = 0;
  if (!held) for (const c of WX.cells) if (c.s > 0.01 && (c.cover > 0.05 || c.precip > 0)) _wxCellList.push([Math.max(0, Math.hypot(c.x - cam.x, c.z - cam.z) - c.a), c]);
  _wxCellList.sort((a, b) => a[0] - b[0]);
  const n = Math.min(WX_N, _wxCellList.length);
  for (let i = 0; i < n; i++) {
    const c = _wxCellList[i][1];
    cu.uWxA.value[i].set(c.x, c.z, c.ca, c.sa);
    cu.uWxB.value[i].set(c.a, c.b, c.cover * c.s, c.thick * c.s);
    cu.uWxC.value[i].set(c.precip * c.s, c.storm * c.s, c.mist * c.s, 0);
  }
  const fair = [0, 1, 2].map((k) => WX_FAIR[k] + (SEASON && SEASON.idx === 3 ? 0.1 : SEASON && SEASON.idx === 1 ? -0.05 : 0.02));
  cu.uWxBase.value.set(fair[0], fair[1], fair[2], 0);
  const W2 = WEATHER;
  if (held) cu.uWxHeld.value.set(W2.mode === 'clear' && W2.kind === 'clear' ? 0.18 : Math.max(0.16, (W2.overcast || 0) * 0.98 + 0.05 * (W2.raining || 0)), W2.raining || 0, W2.storm || 0, 0.2 + 0.5 * (W2.raining || 0) + 0.4 * (W2.storm || 0));
  else cu.uWxHeld.value.x = -1;
  cu.uWxWind.value.set(WX.off.x, WX.off.z, n, 0);
  // the field round the camera (snapped, so it does not shimmer as the camera moves)
  const sn = 16;
  U.uCloudMapP.value.set(Math.round(cam.x / sn) * sn, Math.round(cam.z / sn) * sn, WX_R, WX_BASE_Y);
  WXR.n++;
  const every = WXR.q.every, dome = !INDOOR.on || WXR.n < 3;
  const prevT = renderer.getRenderTarget();
  if (WXR.n % every === 0 || WXR.n < 3) pass(WXR.fieldMat, WXR.field);
  const de = WXR.scrOn ? every * 2 : every; // (with the view's own clouds the dome serves only the mirror and the aurora)
  if (dome && (WXR.n % de === (de > 1 ? 1 : 0) || WXR.n < 3)) { WXR.domeMat.uniforms.uEye.value.copy(cam); pass(WXR.domeMat, WXR.dome); }
  renderer.setRenderTarget(prevT);
  U.uCloudDomeOn.value.x = 1;
  // the clouds' shadows on the land: the light's way up to the cloud, and how dark they are (fading as the light lowers,
  // gone under a sky already overcast at the camera, where the light itself is dimmed)
  const Ld = U.uLightDir.value, ly = Math.max(Ld.y, 0.15);
  const oc = WEATHER.overcast || 0;
  U.uCloudSh.value.set(Ld.x / ly, Ld.z / ly, 0, INDOOR.on ? 0 : 0.72 * clamp(Ld.y * 4, 0, 1) * (1 - 0.55 * oc));
  wxShaftsFrame();
  // lightning in the cloud
  const F = WX.flash;
  U.uWxFlash.value.set(F.x, F.y, F.z, F.k * F.k * 1.6);
  // mist in the valleys: the camera's own mist, lying over the low ground about it
  const mist = INDOOR.on ? 0 : WEATHER.mist || 0;
  if (mist > 0.01) {
    if (!WXR.mistAt || dist2(WXR.mistAt.x, WXR.mistAt.z, cam.x, cam.z) > 30 * 30) {
      let lo = 1e9; for (let k = 0; k < 16; k++) { const a = k / 16 * TAU, r = 40 + (k % 4) * 60; lo = Math.min(lo, heightAt(cam.x + Math.cos(a) * r, cam.z + Math.sin(a) * r)); }
      WXR.mistAt = { x: cam.x, z: cam.z, lo: Math.max(lo, WATER_Y) };
    }
    U.uMist.value.set(0.05 * mist, WXR.mistAt.lo + 2, 0.11, 0);
  } else U.uMist.value.x = 0;
}

// the main view's own clouds (13_main.js tick, once the camera is placed): the march for each pixel of the view at one
// in scr of its pixels each way, read by the sky (cloudScreen in 02_render.js); off indoors and when the clouds are off
function wxCloudsScreen() {
  const S = U.uCloudScrP.value;
  if (!WXR.on || !WXR.field || !WXR.scrMat || INDOOR.on || !sceneRT || WXR.scrOff) { S.z = 0; WXR.scrOn = false; return; }
  const sc = WXR.q.scr || 3, w = Math.max(1, Math.ceil(sceneRT.width / sc)), h = Math.max(1, Math.ceil(sceneRT.height / sc));
  if (!WXR.scr || WXR.scr.width !== w || WXR.scr.height !== h) {
    if (WXR.scr) WXR.scr.dispose();
    WXR.scr = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, type: RT_TYPE, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    WXR.scr.texture.wrapS = WXR.scr.texture.wrapT = THREE.ClampToEdgeWrapping;
    U.uCloudScr.value = WXR.scr.texture;
  }
  const M = WXR.scrMat.uniforms;
  M.uEye.value.copy(camera.position);
  M.uInvVPw.value.copy(skyU.uInvVP.value);
  const prevT = renderer.getRenderTarget();
  pass(WXR.scrMat, WXR.scr);
  renderer.setRenderTarget(prevT);
  S.set(1 / sceneRT.width, 1 / sceneRT.height, 1, sc);
  WXR.scrOn = true;
}

/* ---- what is coming: a shower, a front or a storm the wind will carry over a place ---- */
const WX_POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function wxCompass(dx, dz) { const b = Math.atan2(dx, -dz); return WX_POINTS[((Math.round(b / (Math.PI / 4)) % 8) + 8) % 8]; }
function wxForecast(x, z) {
  if (wxHeld()) return null;
  const v = wxWindVec(), s = WX.wind.s * 0.8;
  let best = null;
  for (const c of WX.cells) {
    const st = c.storm * c.s, pr = c.precip * c.s;
    const what = st > 0.5 ? 'storm' : pr > 0.35 ? 'rain' : null;
    if (!what) continue;
    const dx = x - c.x, dz = z - c.z, along = dx * v.x + dz * v.z, across = Math.abs(-dx * v.z + dz * v.x), R = Math.max(c.a, c.b);
    if (along <= 0 || across > R * 0.75) continue; // its way does not pass over here
    const edge = along - R * 0.7;
    if (edge < 0) continue; // here already
    const eta = edge / Math.max(0.3, s * c.sp);
    if (eta > 300 || c.age + eta > c.life - c.fade * 0.5) continue; // too far yet, or it will have died away
    if (!best || eta < best.eta) best = { what, eta, from: wxCompass(c.x - x, c.z - z), id: c.id };
  }
  if (best && best.what === 'rain') best.what = farmTempAt(x, z) < 1 ? 'snow' : 'rain';
  return best;
}
// the war panel's line (10_ui.js): what is coming over you, and from where
let _wxFcT = -1, _wxFcS = '';
function wxForecastText() {
  if (GAME.t - _wxFcT < 1 && _wxFcT >= 0) return _wxFcS;
  _wxFcT = GAME.t;
  const P = GAME.player, f = P && !inDungeon(P) ? wxForecast(P.x, P.z) : null;
  _wxFcS = f ? ` · ${f.what === 'storm' ? 'A storm' : f.what === 'snow' ? 'Snow' : 'Rain'} coming from the ${f.from}` : '';
  return _wxFcS;
}
// what players are told: a field note when weather is first seen coming, a line of help, tips
if (typeof FIELD_NOTES !== 'undefined') Object.assign(FIELD_NOTES, {
  w2coming: { t: 'Weather on the way', x: () => 'Weather crosses the March on the wind: rain off the western sea over Ériu, snow out of Thule, fair skies over Logres. A storm is seen coming long before it breaks; the war panel says what comes and from where. Under a roof you stay dry.' },
});
if (typeof GUIDE_WATCH !== 'undefined') GUIDE_WATCH.w2coming = (P) => !!(P && wxForecastText());
if (typeof GUIDE_HELP !== 'undefined') GUIDE_HELP.push(() => `<h3>Weather</h3><p>Showers, fronts, storms and banks of cloud cross the March on the wind, born of each realm's climate and the season: rain falls under its cloud and the sky is clear beside it. The war panel says what is coming and from where. Rain soaks you and your gear, damps fires and waters the fields; snow lies where it is cold; lightning strikes the tallest things under a storm. Under a roof, in a tower's rooms or a tent you stay dry.</p>`);
if (typeof LOADING_TIPS !== 'undefined') LOADING_TIPS.push(
  'Weather crosses the March on the wind: watch the sky upwind, and the war panel\'s line, to see a storm coming.',
  'Rain falls only under its cloud: a shower can soak one field and leave the next one dry.',
);

/* ================================================================== */
/* shelter: no snow or rain under a roof                                */
/* ================================================================== */
// The shelter map (1 m texels over the land, U.uShelter): over each texel the height of the highest roof, room or floor
// standing over it (world y), or far below where the sky is open. Every shader's snowHere (02d_season.js), the ground's
// snow and wet film (03_terrain.js) and the drops of rain and snow (05e_weather.js) read it; wxShelterY / wxSheltered
// answer the same on the CPU. Made again when what stands changes: a house falls or is built back, a stone holes a
// roof, a tower is breached or mended, a roof is built or pulled down, a walk burns through (looked at once a second).
const WXS = { N: 1024, data: null, tex: null, key: '', t: 0, builds: 0, ms: 0, counts: {} };
const WXS_OPEN = -1e4;
function wxsMark(x, z, h) {
  const i = Math.floor(x + 512), j = Math.floor(z + 512);
  if (i < 0 || j < 0 || i >= 1024 || j >= 1024) return;
  const q = j * 1024 + i;
  if (h > WXS.data[q]) WXS.data[q] = h;
}
// a roof record as the rain shaders take it (houseRoofsForRain: houses, built roofs, the towers' rooms): its roof's
// underside over each texel it covers (less its covering's thickness), but not under a hole knocked in it
function wxsRoof(R, hole, under) {
  const reach = R.round ? R.Rr : Math.hypot(R.w / 2 + (R.ohSide || 0), R.d / 2 + (R.ohGable || 0));
  const x0 = Math.floor(R.x - reach), x1 = Math.ceil(R.x + reach), z0 = Math.floor(R.z - reach), z1 = Math.ceil(R.z + reach);
  let n = 0;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, pz = z + 0.5, dx = px - R.x, dz = pz - R.z;
    if (hole && hole.r > 0 && Math.hypot(px - hole.x, pz - hole.z) < hole.r) continue;
    const lx = dx * R.c - dz * R.s, lz = dx * R.s + dz * R.c;
    let h;
    if (R.round) {
      const at = Math.hypot(lx, lz);
      if (at > R.Rr) continue;
      h = Math.min(R.y + R.y0 + R.hc, R.y + R.y0 + (R.Rr - at) * (R.hc / R.Rr));
    } else {
      const hw = R.w / 2 + (R.ohSide || 0), hd = R.d / 2 + (R.ohGable || 0);
      if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
      const top = R.y + R.wallH + R.rh;
      h = Math.min(top, top - hw * R.tn + (hw - Math.abs(lx)) * R.tn);
    }
    wxsMark(px, pz, h - under);
    n++;
  }
  return n;
}
function wxShelterBuild() {
  const t0 = performance.now();
  if (!WXS.data) WXS.data = new Float32Array(1024 * 1024);
  WXS.data.fill(WXS_OPEN);
  const C = WXS.counts = { houses: 0, built: 0, towers: 0, tents: 0, floors: 0 };
  // the houses and the keeps' halls: under the roof's covering (thatch the thickest)
  for (const H of HOUSES) {
    if (!houseIntact(H)) continue;
    const R = H.round ? { x: H.x, z: H.z, c: H.c, s: H.s, round: true, Rr: H.Rr, y: H.y, y0: H.y0, hc: H.hc }
      : { x: H.x, z: H.z, c: H.c, s: H.s, w: H.w, d: H.d, ohSide: H.ohSide, ohGable: H.ohGable, y: H.y, wallH: H.wallH, rh: H.rh, tn: H.tn };
    wxsRoof(R, H.bat && H.bat.hr > 0 ? { x: H.bat.hx, z: H.bat.hz, r: H.bat.hr } : null, 0.45);
    C.houses++;
  }
  // the roofs built by the player
  if (typeof BUILD !== 'undefined') for (const pc of BUILD.pieces) {
    if (!BP[pc.t].roof || (pc.st !== 'built' && pc.st !== 'burning')) continue;
    if (!pc.rainH) { const L = []; buildRoofsForRain(L, pc.x, pc.z); }
    if (pc.rainH) { wxsRoof(pc.rainH, null, 0.3); C.built++; }
  }
  // the towers' rooms (not a breached one: open to the sky)
  if (typeof TOWER !== 'undefined') for (const T of TOWER.list) {
    if (T.breached || !T.rain) continue;
    const R = T.rain, top = T.S.y + T.shelterY - 0.05;
    const reach = T.kind === 'drum' ? T.RI + 0.3 : T.HI * 1.42 + 0.3;
    for (let z = Math.floor(T.wz - reach); z <= Math.ceil(T.wz + reach); z++) for (let x = Math.floor(T.wx - reach); x <= Math.ceil(T.wx + reach); x++) {
      const l = twLocal(T, x + 0.5, z + 0.5);
      if (twInside(T, l.x, l.z, 0.25)) wxsMark(x + 0.5, z + 0.5, top);
    }
    C.towers++;
    void R;
  }
  // the camps' tents (a lean tent of cloth over a bedroll)
  for (const c of COLL.circles || []) {
    if (c.tag !== 'tent' || !c.active) continue;
    const gy = heightAt(c.x, c.z), r = c.r * 0.85;
    for (let z = Math.floor(c.z - r); z <= Math.ceil(c.z + r); z++) for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) if (Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) < r) wxsMark(x + 0.5, z + 0.5, gy + 0.85);
    C.tents++;
  }
  // a walk, a gallery or a deck over open ground: the ground under it lies dry (a floor the masonry fills is no shelter)
  if (typeof FLOOR !== 'undefined') for (const f of FLOOR.list) {
    if (!f.active || f.tag === 'scaffold') continue;
    const top = Math.min(f.ya, f.yb), under = f.th > 0 ? top - f.th : top - 0.12;
    if (f.y0 > -1e3 && f.th <= 0 && f.y0 < top - 0.8) continue; // solid from the ground (a rampart, a stair's masonry)
    const r = f.type === 'disc' ? f.r : Math.hypot(f.hx, f.hz);
    if (r > 40) continue;
    let any = false;
    for (let z = Math.floor(f.z - r); z <= Math.ceil(f.z + r); z++) for (let x = Math.floor(f.x - r); x <= Math.ceil(f.x + r); x++) {
      const px = x + 0.5, pz = z + 0.5;
      if (floorTopOf(f, px, pz) === null) continue;
      if (under - heightAt(px, pz) < 1.3) continue;
      wxsMark(px, pz, under - 0.05); any = true;
    }
    if (any) C.floors++;
  }
  if (!WXS.tex) {
    WXS.tex = new THREE.DataTexture(WXS.data, 1024, 1024, THREE.RedFormat, THREE.FloatType);
    WXS.tex.minFilter = WXS.tex.magFilter = THREE.NearestFilter; WXS.tex.generateMipmaps = false;
    U.uShelter.value = WXS.tex;
  }
  WXS.tex.needsUpdate = true;
  U.uShelterOn.value = 1;
  WXS.builds++; WXS.ms = performance.now() - t0;
}
// what decides the map: each house's state and the hole in its roof, the built roofs, the towers breached, the floors standing
function wxShelterKey() {
  let k = '';
  for (const H of HOUSES) k += houseIntact(H) ? (H.bat && H.bat.hr > 0 ? 'h' + Math.round(H.bat.hr * 10) : '1') : '0';
  if (typeof BUILD !== 'undefined') for (const pc of BUILD.pieces) if (BP[pc.t].roof && (pc.st === 'built' || pc.st === 'burning')) k += 'b' + pc.id;
  if (typeof TOWER !== 'undefined') for (const T of TOWER.list) k += T.breached ? 'x' : 't';
  if (typeof FLOOR !== 'undefined') { let n = 0; for (const f of FLOOR.list) if (f.active) n++; k += 'f' + n; }
  return k;
}
function wxShelterStep(dt) {
  WXS.t -= dt;
  if (WXS.t > 0) return;
  WXS.t = 1;
  if (!HOUSES.length) return;
  const k = wxShelterKey();
  if (k !== WXS.key) { WXS.key = k; wxShelterBuild(); }
}
// the same on the CPU: the shelter's height over a place, and whether a point lies under it
function wxShelterY(x, z) {
  if (x > 600) return 1e5;
  if (!WXS.data || Math.abs(x) > 511.5 || Math.abs(z) > 511.5) return WXS_OPEN;
  return WXS.data[Math.floor(z + 512) * 1024 + Math.floor(x + 512)];
}
function wxSheltered(x, z, y) { return y < wxShelterY(x, z); }

/* ---- test hooks ---- */
function hookWeather2() {
  if (WX.hooked || !window.__hm || !window.__hm.fn) return;
  WX.hooked = true;
  window.__hm.weather2 = {
    WX, WXR, WXS, WX_KINDS, WX_Q, weatherAt, wxForecast, wxForecastText, wxShelterBuild, wxShelterKey, wxShelterY, wxSheltered, wxsRoof, wxFieldAt, wxHeld, wxLive, wxMake, wxSave, wxLoad, wxGridAt, wxRainAt, wxStormAt, wxSnowingAt, wxPrecipAt, wxWetAt, wxOvercastAt,
    updateWeather2, wxCloudFlash, wxBoltVisual, wxStrikeStep, wxCloudsFrame, wxCloudsScreen, wxBuildClouds,
    precip: () => ({ rain: rainMesh, snow: snowMesh }),
    sites: SITES, TRACKS,
    half: (h) => THREE.DataUtils.fromHalfFloat(h),
    // the fair weather's cloud of each realm (tests set a clear sky), the old values back
    fairSet(a) { const old = WX_FAIR.slice(); for (let k = 0; k < 3; k++) WX_FAIR[k] = a[k]; return old; },
    // every cell gone (a calm sky to test in), the wind held
    calm() { WX.cells.length = 0; WX.seeded = true; WX.spawnT = 1e9; return 0; },
    // the systems running again on their own
    release() { WX.spawnT = 1; return 0; },
  };
}
setTimeout(hookWeather2, 0); // window.__hm is made at the end of the script
