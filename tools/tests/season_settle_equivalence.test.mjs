import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parse, tokenizer } from 'acorn';

const source = readFileSync(new URL('../../src/05k_seasons.js', import.meta.url), 'utf8');
const trees = new Map();
function extract(name, text = source) {
  if (!trees.has(text)) trees.set(text, parse(text, { ecmaVersion: 'latest', sourceType: 'module' }).body);
  const node = trees.get(text).find(n => n.type === 'FunctionDeclaration' && n.id.name === name
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  assert(node, name);
  return text.slice(node.start, node.end);
}
// Pinned PR64 oracle, independent of the candidate's traversal and batching.
const original = `function seasonLieStep(dts) {
  const R = SEAS.res, c = SEAS.cell, L = SEAS.lie, Wm = SEAS.warm, B = SEAS.bytes;
  const air = seasonAirNow(), snowing0 = WEATHER.snowing || 0, rain0 = (WEATHER.raining || 0) * (1 - clamp(snowing0 * 3, 0, 1));
  const cx = (camera.position.x + HALF) / c, cz = (camera.position.z + HALF) / c, near2 = (300 / c) ** 2, view2 = (420 / c) ** 2;
  const live = wxLive(), airAdj = live ? wxTempAdjGrid(camera.position.x, camera.position.z) : 0;
  let vmax = 0;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const q = j * R + i, d2 = (i + 0.5 - cx) ** 2 + (j + 0.5 - cz) ** 2;
    let T = air + Wm[q], near = d2 < near2 ? 1 : 0, snowing = snowing0, rain = rain0;
    if (live) {
      const x = -HALF + (i + 0.5) * c, z = -HALF + (j + 0.5) * c;
      near = 1; snowing = wxGridAt('snowing', x, z); rain = wxGridAt('rain', x, z) * (1 - clamp(snowing * 3, 0, 1));
      T += wxTempAdjGrid(x, z) - airAdj;
    }
    let v = L[q];
    if (T < 0.5) v += dts * (0.00035 * Math.min(6, 0.3 + (0.5 - T)) + near * snowing / 70);
    else v -= dts * (T - 0.5) * 0.0011 * (1 + near * 1.5 * rain);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    L[q] = v;
    B[q * 4] = Math.round(v * 255);
    if (d2 < view2 && v > vmax) vmax = v;
  }
  SEAS.lieView = vmax;
  SEAS.dirty = true;
}`;
const originalSettle = `function seasonSettle() {
  SEAS.cur = seasonCurves(SEASON.k);
  seasonIceSettle();
  if (SEAS.lie) { SEAS.lie.fill(0); for (let n = 0; n < 40; n++) seasonLieStep(30); }
  SEAS.lastT = SEASON.t;
  if (typeof CANOPY !== 'undefined' && CANOPY.tex) CANOPY.next = 0;
}`;
const candidate = extract('seasonLieStep');
const digest = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
function tokenDigest(body) {
  const tokens = Array.from(tokenizer(body, { ecmaVersion: 'latest' }), token => body.slice(token.start, token.end));
  return createHash('sha256').update(tokens.join('\0')).digest('hex');
}
test('pinned oracles retain the exact PR64 tokens, excluding comments and whitespace', () => {
  // Independently verified once against git22ae16b. No history is needed in CI.
  assert.equal(tokenDigest(original), '024c470a7077ee3f26478859520e4c8ff2ab48e05fd9f2ad627570d7485ab450');
  assert.equal(tokenDigest(originalSettle), '847067b25bfd50579da62a55c4c7eecea60c03645842352b875eb4c2d4337fba');
});
function fixture(body, { seed = 7, live = false, air = -3, res = 128, cameraX = 17.3, cameraZ = -98.7 } = {}) {
  const SEAS = { res, cell: 1024 / res, lie: new Float32Array(res * res), warm: new Float32Array(res * res), bytes: new Uint8Array(res * res * 4), dirty: false, lieView: 0 };
  for (let q = 0; q < SEAS.lie.length; q++) {
    SEAS.warm[q] = Math.sin((q + seed) * 0.31) * 18;
    SEAS.lie[q] = (q % 11) / 10;
    for (let c = 0; c < 4; c++) SEAS.bytes[q * 4 + c] = (q * 7 + c * 43) % 256;
  }
  let queries = 0;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const grid = (key, x, z) => { queries++; return (Math.sin(x * .019 + seed) * Math.cos(z * .013 + (key === 'rain' ? 3 : key === 'snowing' ? 7 : 13)) + 1) * .5; };
  const temp = (x, z) => -.5 - 2.5 * grid('rain', x, z) + grid('cover', x, z);
  const api = new Function('SEAS', 'WEATHER', 'camera', 'HALF', 'clamp', 'seasonAirNow', 'wxLive', 'wxTempAdjGrid', 'wxGridAt', body + '\nreturn seasonLieStep;')(
    SEAS, { snowing: .37, raining: .82 }, { position: { x: cameraX, z: cameraZ } }, 512, clamp, () => air, () => live, temp, grid);
  return { SEAS, api, queries: () => queries };
}
function equalState(a, b) {
  assert.equal(digest(a.SEAS.lie), digest(b.SEAS.lie), 'every stored Float32 bit');
  assert.equal(digest(a.SEAS.bytes), digest(b.SEAS.bytes), 'all RGBA bytes, including retained channels');
  assert.equal(a.SEAS.lieView, b.SEAS.lieView, 'unrounded final visible maximum');
  assert.equal(a.SEAS.dirty, b.SEAS.dirty);
}
for (const live of [false, true]) for (const seed of [7, 19, 503]) for (const air of [-18, .5, 21]) {
  test(`forty settled steps remain bit exact: live=${live}, seed=${seed}, air=${air}`, () => {
    const options = { live, seed, air }, old = fixture(original, options), next = fixture(candidate, options);
    for (let n = 0; n < 40; n++) old.api(30);
    next.api(30, 40);
    equalState(old, next);
    if (live) assert.equal(old.queries(), next.queries() * 40, 'constant weather sampled once per texel');
  });
}
for (const dts of [0, .1, 1, 30, 100000]) test(`ordinary simulation retains exact one-step results: dt=${dts}`, () => {
  const old = fixture(original, { live: true }), next = fixture(candidate, { live: true });
  old.api(dts); next.api(dts); equalState(old, next);
  assert.equal(old.queries(), next.queries());
});
test('settling batches only the original forty snow steps and keeps clock/canopy/ice semantics', () => {
  const SEAS = { lie: new Float32Array(3).fill(.7), lastT: -1 }, SEASON = { k: .6, t: 4123 }, CANOPY = { tex: {}, next: 99 }, calls = [];
  new Function('SEAS', 'SEASON', 'CANOPY', 'seasonCurves', 'seasonIceSettle', 'seasonLieStep', extract('seasonSettle') + '\nseasonSettle();')(
    SEAS, SEASON, CANOPY, k => ({ k }), () => calls.push('ice'), (dt, steps) => { assert(SEAS.lie.every(v => v === 0)); calls.push([dt, steps]); });
  assert.deepEqual(calls, ['ice', [30, 40]]);
  assert.deepEqual(SEAS.cur, { k: .6 }); assert.equal(SEAS.lastT, 4123); assert.equal(CANOPY.next, 0);
});

const weatherSource = readFileSync(new URL('../../src/12c_weather2.js', import.meta.url), 'utf8');
const utilSource = readFileSync(new URL('../../src/00_util.js', import.meta.url), 'utf8');
const farmingSource = readFileSync(new URL('../../src/08h_farming.js', import.meta.url), 'utf8');
const realDependencies = [
  ...['clamp', 'lerp', 'sstep', 'mulberry'].map(name => extract(name, utilSource)),
  ...['wxHeld', 'wxLive', 'wxGridAt', 'wxTempAdjGrid'].map(name => extract(name, weatherSource)),
  ...['seasonCurves', 'seasonAirNow', 'seasonIceStep', 'seasonIceSettle', 'seasonIceVisual'].map(name => extract(name)),
  extract('seasonTempBase', farmingSource),
].join('\n');

function realFixture(prior = false, { seed = 7, live = true, grid = true, night = .65,
  cameraX = 17.3, cameraZ = -98.7, k = .88, res = 128 } = {}) {
  const n = res * res, WEATHER = { mode: live ? 'auto' : 'clear', next: 321, raining: .72, snowing: .31, overcast: .83, wet: .61 };
  const SEAS = { res, cell: 1024 / res, lie: new Float32Array(n), warm: new Float32Array(n), bytes: new Uint8Array(n * 4),
    lastT: -1, acc: .17, dirty: false, lieView: -.1, cur: null, frozenN: -1 };
  for (let q = 0; q < n; q++) {
    // Realistic realm/high-ground warmth, plus deliberately nonzero saved snow
    // that actual seasonSettle must clear before rebuilding the current season.
    SEAS.warm[q] = 1.2 - (q % 31) * .22 - Math.max(0, 6 + Math.sin((q + seed) * .31) * 75) * .3;
    SEAS.lie[q] = (q % 11) / 10;
    for (let channel = 0; channel < 4; channel++) SEAS.bytes[q * 4 + channel] = (q * 7 + channel * 43) % 256;
  }
  const WX = { on: true, t: 987, grid: null, stats: { made: 7 } };
  if (grid) {
    WX.grid = { t: 444 };
    for (const key of ['precip', 'rain', 'snowing', 'cover', 'wet']) WX.grid[key] = new Float32Array(32 * 32);
    for (let q = 0; q < 32 * 32; q++) {
      const rain = (Math.sin(q * .27 + seed) + 1) / 2, cold = (Math.cos(q * .19 - seed) + 1) / 2;
      WX.grid.precip[q] = rain; WX.grid.snowing[q] = rain * cold; WX.grid.rain[q] = rain * (1 - cold);
      WX.grid.cover[q] = .15 + .85 * (Math.sin(q * .13 + seed) + 1) / 2; WX.grid.wet[q] = .4 + .3 * cold;
    }
  }
  const SICE = { ks: Int32Array.from([1, 7, 10, 20, 33]), t0: Float32Array.from([-9, -7, -3, .4, 1.2]),
    shallow: Float32Array.from([0, .15, .4, .7, 1]), thick: new Float32Array(5).fill(.7), grid: new Float32Array(64),
    vis: new Float32Array(64), shore: [[2, [1, 7]], [11, [10, 20]]], on: false,
    meshes: [{ attr: { array: new Float32Array(16).fill(.34), needsUpdate: false }, vs: Int32Array.from([0, 1, 2, 3]), kk: Int32Array.from([1, 7, 2, 11]) }] };
  const state = { SEAS, WX, WEATHER, SICE, SEASON: { k, t: k * 8640, temp: 10 + 9.5 * Math.cos(Math.PI * 2 * (k - .375)), yearSec: 8640 },
    CANOPY: { tex: { marker: 'existing live texture' }, next: 99 }, U: { uNight: { value: night } },
    camera: { position: { x: cameraX, z: cameraZ } }, GAME: { t: 42, player: { xp: 123, level: 1 } } };
  const effects = { random: 0, seeded: 0, save: 0, simulation: 0 }, math = Object.create(Math);
  math.random = () => { effects.random++; throw Error('Season settling must not consume RNG'); };
  const api = new Function('state', 'Math', 'effects',
    'const {SEAS,WX,WEATHER,SICE,SEASON,CANOPY,U,camera,GAME}=state; const HALF=512,WX_GN=32,WX_GC=32,TAU=Math.PI*2;\n'
    + realDependencies + '\n' + (prior ? original + '\n' + originalSettle : candidate + '\n' + extract('seasonSettle'))
    + '\nconst rawSeeded=mulberry(503); return {seasonLieStep,seasonSettle,seasonAirNow,wxGridAt,wxTempAdjGrid,wxLive,'
    + 'seeded:()=>{effects.seeded++;return rawSeeded();}};')(state, math, effects);
  return { ...state, api, effects };
}
function inputs(f) {
  return JSON.stringify({ WX: f.WX, WEATHER: f.WEATHER, SEASON: f.SEASON, U: f.U, camera: f.camera, GAME: f.GAME,
    map: { warm: digest(f.SEAS.warm), res: f.SEAS.res, cell: f.SEAS.cell, acc: f.SEAS.acc },
    ice: { ks: digest(f.SICE.ks), t0: digest(f.SICE.t0), shallow: digest(f.SICE.shallow), shore: f.SICE.shore,
      meshes: f.SICE.meshes.map(m => ({ vs: digest(m.vs), kk: digest(m.kk) })) }, effects: f.effects });
}
function equalReal(a, b) {
  equalState(a, b);
  for (const field of ['thick', 'grid', 'vis']) assert.equal(digest(a.SICE[field]), digest(b.SICE[field]), 'actual ice ' + field);
  assert.equal(digest(a.SICE.meshes[0].attr.array), digest(b.SICE.meshes[0].attr.array), 'actual ice mesh attributes');
  assert.equal(a.SICE.meshes[0].attr.needsUpdate, b.SICE.meshes[0].attr.needsUpdate);
  assert.equal(a.SICE.on, b.SICE.on); assert.equal(a.SEAS.frozenN, b.SEAS.frozenN);
  assert.deepEqual(a.SEAS.cur, b.SEAS.cur); assert.equal(a.SEAS.lastT, b.SEAS.lastT);
  assert.equal(a.CANOPY.next, b.CANOPY.next);
}

for (const live of [false, true]) for (const seed of [7, 19, 503]) for (const night of [0, 1]) {
  test(`actual zero-reset seasonSettle and real weather/ice helpers: live=${live}, seed=${seed}, night=${night}`, () => {
    const options = { live, seed, night }, prior = realFixture(true, options), next = realFixture(false, options);
    const a = inputs(prior), b = inputs(next), texture = next.CANOPY.tex;
    // Capture full RNG state without using it inside either calculation.
    assert.equal(prior.api.seeded(), next.api.seeded());
    const aa = inputs(prior), bb = inputs(next);
    prior.api.seasonSettle(); next.api.seasonSettle(); equalReal(prior, next);
    assert.equal(inputs(prior), aa); assert.equal(inputs(next), bb);
    assert.equal(prior.api.seeded(), next.api.seeded()); assert.equal(next.CANOPY.tex, texture);
    assert.equal(next.CANOPY.next, 0); assert.equal(next.SEAS.lastT, next.SEASON.t);
    assert(next.SEAS.lie.some(v => v > 0), 'cold regions really accumulate snow after the reset');
    assert.equal(next.effects.random, 0); assert.equal(next.effects.save, 0); assert.equal(next.effects.simulation, 0);
    assert.notEqual(a, aa); assert.notEqual(b, bb, 'the explicit RNG control actually advanced');
  });
}

for (const [x, z] of [[-512, -512], [512, 512], [-900, 900], [900, -900], [0, 0]]) {
  test(`real grid clamps/interpolates correctly at camera ${x},${z}`, () => {
    const options = { cameraX: x, cameraZ: z }, prior = realFixture(true, options), next = realFixture(false, options);
    prior.api.seasonSettle(); next.api.seasonSettle(); equalReal(prior, next);
    for (const p of [-900, -512, -496, 0, 496, 512, 900]) for (const key of ['precip', 'rain', 'snowing', 'cover']) {
      assert.equal(prior.api.wxGridAt(key, p, z), next.api.wxGridAt(key, p, z));
    }
  });
}
test('real absent-weather-grid fallback remains exact', () => {
  const prior = realFixture(true, { grid: false }), next = realFixture(false, { grid: false });
  prior.api.seasonSettle(); next.api.seasonSettle(); equalReal(prior, next);
  assert.equal(next.api.wxGridAt('wet', 0, 0), .61); assert.equal(next.api.wxGridAt('precip', 0, 0), 0);
});

for (const threshold of [300, 420]) for (const delta of [-1e-7, 0, 1e-7]) {
  test(`held-weather strict ${threshold}m camera threshold delta=${delta}`, () => {
    const options = { live: false, night: 0, cameraX: -4 - threshold + delta, cameraZ: 4 }, prior = realFixture(true, options), next = realFixture(false, options);
    for (const f of [prior, next]) {
      f.SEAS.warm.fill(25); f.SEAS.warm[64 * 128 + 63] = 0; f.SEAS.lie.fill(0);
      f.WEATHER.raining = 0; f.WEATHER.snowing = 1; f.WEATHER.overcast = 0; f.SEASON.temp = 0;
    }
    for (let n = 0; n < 40; n++) prior.api.seasonLieStep(30);
    next.api.seasonLieStep(30, 40); equalState(prior, next);
    const snow = next.SEAS.lie[64 * 128 + 63]; assert(snow > 0);
    if (threshold === 300) assert.equal(snow > .9, delta > 0, 'strict < nearby snowfall radius');
    if (threshold === 420) assert.equal(next.SEAS.lieView > 0, delta > 0, 'strict < view radius');
  });
}

for (const temperature of [.5 - 2 ** -24, .5, .5 + 2 ** -24]) test('Float32 freezing boundary ' + temperature, () => {
  const prior = realFixture(true, { live: false, night: 0 }), next = realFixture(false, { live: false, night: 0 });
  for (const f of [prior, next]) {
    f.SEASON.temp = 0; f.WEATHER.raining = f.WEATHER.snowing = f.WEATHER.overcast = 0;
    f.SEAS.warm.fill(temperature); f.SEAS.lie.fill(.43);
  }
  for (let n = 0; n < 40; n++) prior.api.seasonLieStep(30);
  next.api.seasonLieStep(30, 40); equalState(prior, next);
});

test('display bytes and view maximum retain the final unrounded v, not the Float32 stored value', () => {
  let proved = false;
  for (let k = 1; k < 255 && !proved; k++) {
    const prior = realFixture(true, { live: false, night: 0, cameraX: 0, cameraZ: 0, res: 1 }), next = realFixture(false, { live: false, night: 0, cameraX: 0, cameraZ: 0, res: 1 });
    for (const f of [prior, next]) {
      f.SEASON.temp = 0; f.WEATHER.raining = f.WEATHER.snowing = f.WEATHER.overcast = 0; f.SEAS.warm.fill(0); f.SEAS.lie.fill(0);
    }
    const dts = ((k + .5) / 255 - 1e-10) / (.00035 * .8);
    prior.api.seasonLieStep(dts); next.api.seasonLieStep(dts); equalState(prior, next);
    if (prior.SEAS.bytes[0] !== Math.round(prior.SEAS.lie[0] * 255)) {
      assert.notEqual(next.SEAS.lieView, next.SEAS.lie[0]); proved = true;
    }
  }
  assert(proved, 'fixture exercises a real Float32/display rounding distinction');
});

test('CPU comparison uses actual full-size zero-reset settle and real weather/ice helpers', t => {
  const prior = realFixture(true), next = realFixture(false), oldMs = [], newMs = [];
  for (let n = 0; n < 2; n++) { prior.api.seasonSettle(); next.api.seasonSettle(); }
  const measure = f => { const at = performance.now(); f.api.seasonSettle(); return performance.now() - at; };
  for (let n = 0; n < 6; n++) {
    if (n % 2) { newMs.push(measure(next)); oldMs.push(measure(prior)); }
    else { oldMs.push(measure(prior)); newMs.push(measure(next)); }
    equalReal(prior, next);
  }
  const median = a => { const sorted = [...a].sort((x, y) => x - y); return (sorted[2] + sorted[3]) / 2; };
  t.diagnostic(JSON.stringify({ kind: 'warm local CPU only; not native entry timing', originalMs: oldMs, candidateMs: newMs,
    originalMedianMs: median(oldMs), candidateMedianMs: median(newMs) }));
});
