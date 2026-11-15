import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { parse, tokenizer } from 'acorn';
import * as THREE from 'three';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
const source = read('05k_seasons.js'), farming = read('08h_farming.js'), util = read('00_util.js');
const prior = JSON.parse(readFileSync(new URL('./fixtures/season_ice_pr64.json', import.meta.url), 'utf8'));
function extract(text, name) {
  const n = parse(text, { ecmaVersion: 'latest' }).body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(n, name); return text.slice(n.start, n.end);
}
const actual = Object.fromEntries(['seasonIceStep', 'seasonIceSettle', 'seasonIceVisual'].map(name => [name, extract(source, name)]));
actual.seasonTempBase = extract(farming, 'seasonTempBase');
const mulberry = new Function(extract(util, 'mulberry') + '\nreturn mulberry;')();
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const sha = value => createHash('sha256').update(value).digest('hex');
const tokens = value => Array.from(tokenizer(value, { ecmaVersion: 'latest' }), t => value.slice(t.start, t.end));

test('the independent PR64 ice oracle is pinned, while live step/visual/temperature APIs remain unchanged', () => {
  const hashes = {
    seasonIceStep: 'e8132eddaf0aa1009654ccbaa3cf3eeebb25fc7f2335ed0428d9c1116f267577',
    seasonIceSettle: '847e9e323c911187781bb4599f2f060bfb042971b0eb2e5da1b01f9b2f790bd3',
    seasonIceVisual: 'f44e4879b429f6ebb4aef946c2f24b36438a85a026bc55a97102164694b3f43b',
    seasonTempBase: 'b7eb6444a148c67fd835d02a72a038a9db0dec2f0982ff5c4c1651917ddb12a0',
  };
  for (const [name, hash] of Object.entries(hashes)) {
    assert.equal(sha(prior.functions[name].source), hash, name + ' pinned body');
    if (name !== 'seasonIceSettle') assert.deepEqual(tokens(actual[name]), tokens(prior.functions[name].source), name + ' public behavior is untouched');
  }
});

function fixture({ old = false, seed = 7, count = 1024, year = 8640, time = year * .88, duplicates = false } = {}) {
  const r = mulberry(seed), tape = [], random = () => { const v = r(); tape.push(v); return v; };
  const gridSize = count * 3 + 20;
  const SICE = { ks: new Int32Array(count), t0: new Float32Array(count), shallow: new Float32Array(count),
    thick: new Float32Array(count), grid: new Float32Array(gridSize), vis: new Float32Array(gridSize), on: true, shore: [], meshes: [] };
  for (let q = 0; q < gridSize; q++) { SICE.grid[q] = (q % 31) / 31; SICE.vis[q] = (q % 17) / 17; }
  for (let q = 0; q < count; q++) {
    SICE.ks[q] = duplicates && q % 3 === 2 ? SICE.ks[q - 1] : q * 3 + 1;
    SICE.t0[q] = 1.2 - random() * 6.5 - random() * 22; SICE.shallow[q] = random(); SICE.thick[q] = random();
  }
  if (count) for (let i = 0; i < Math.min(7, count); i++) SICE.shore.push([count * 3 + 2 + i, [SICE.ks[i], SICE.ks[count - 1 - i]]]);
  for (let m = 0; m < 3; m++) {
    const array = new Float32Array(12 * 4); for (let i = 0; i < array.length; i++) array[i] = random();
    const vs = count ? Int32Array.from([1, 3, 5, 7]) : new Int32Array();
    const kk = count ? Int32Array.from([SICE.ks[0], SICE.ks[count - 1], count * 3 + 2, SICE.ks[(count / 2) | 0]]) : new Int32Array();
    SICE.meshes.push({ attr: new THREE.BufferAttribute(array, 4), vs, kk });
  }
  const SEAS = { frozenN: 77, dirty: false }, SEASON = { t: time, yearSec: year, k: .3, temp: 11 };
  const GAME = { t: 43, player: { xp: 123, level: 1 } }, W = { history: ['earned'] }, effects = { saves: 0, simulation: 0 };
  const functions = old ? Object.fromEntries(Object.entries(prior.functions).map(([name, value]) => [name, value.source])) : actual;
  const math = Object.create(Math); math.random = () => { throw Error('No RNG during ice settling'); };
  const temp = new Function('TAU', 'Math', functions.seasonTempBase + '\nreturn seasonTempBase;')(Math.PI * 2, math), phaseTape = [];
  const temperature = k => { const value = temp(k); phaseTape.push({ k, value }); return value; };
  const api = new Function('SICE', 'SEAS', 'SEASON', 'seasonTempBase', 'Math', 'rand', 'GAME', 'W', 'saveSoon', 'simStep',
    functions.seasonIceStep + '\n' + functions.seasonIceSettle + '\n' + functions.seasonIceVisual
    + '\nreturn {seasonIceStep,seasonIceSettle,seasonIceVisual};')(
    SICE, SEAS, SEASON, temperature, math, random, GAME, W,
    () => { effects.saves++; throw Error('No saving'); }, () => { effects.simulation++; throw Error('No simulation'); });
  return { SICE, SEAS, SEASON, GAME, W, effects, tape, phaseTape, api };
}
function immutable(f) {
  return JSON.stringify({ ks: sha(bytes(f.SICE.ks)), t0: sha(bytes(f.SICE.t0)), shallow: sha(bytes(f.SICE.shallow)),
    shore: f.SICE.shore, meshes: f.SICE.meshes.map(m => [sha(bytes(m.vs)), sha(bytes(m.kk))]),
    SEASON: f.SEASON, GAME: f.GAME, W: f.W, effects: f.effects, tape: f.tape });
}
function equal(a, b) {
  for (const key of ['thick', 'grid', 'vis']) assert.deepEqual(bytes(a.SICE[key]), bytes(b.SICE[key]), 'every ' + key + ' bit, including untouched sparse entries');
  assert.equal(a.SICE.on, b.SICE.on); assert.equal(a.SEAS.frozenN, b.SEAS.frozenN); assert.equal(a.SEAS.dirty, b.SEAS.dirty);
  assert.deepEqual(a.phaseTape, b.phaseTape, 'exact original floating-point t/40 temperature sequence');
  for (let i = 0; i < a.SICE.meshes.length; i++) {
    assert.deepEqual(bytes(a.SICE.meshes[i].attr.array), bytes(b.SICE.meshes[i].attr.array), 'every original mesh channel');
    assert.equal(a.SICE.meshes[i].attr.version, b.SICE.meshes[i].attr.version, 'same forced upload count');
  }
}
function paired(options, modify = () => {}) {
  const a = fixture({ old: true, ...options }), b = fixture(options); modify(a); modify(b);
  const beforeA = immutable(a), beforeB = immutable(b);
  a.api.seasonIceSettle(); b.api.seasonIceSettle(); equal(a, b);
  assert.equal(immutable(a), beforeA); assert.equal(immutable(b), beforeB);
  return { a, b };
}

for (const seed of [7, 19, 503]) for (const phase of [0, .04, .25, .5, .75, .875, .999999]) {
  test(`real full-year settling is byte exact: seed=${seed}, phase=${phase}`, () => {
    const { b } = paired({ seed, time: 8640 * phase });
    assert.equal(b.phaseTape.length, 216); assert.equal(b.SICE.meshes[0].attr.version, 1);
  });
}
for (const year of [1, 39.5, 40, 41, 80, 8641]) test('exact sample sequence for year length ' + year, () => paired({ year, time: year * .37, count: 73 }));
for (const time of [-17280.1, -.001, 8640 * 9 + .123, 1e9 + .1]) test('original floating sample order survives clock ' + time, () => paired({ time, count: 73 }));
test('duplicate sparse indices preserve final last-cell write ordering without cross-cell feedback', () => paired({ duplicates: true, count: 39 }));
test('a populated time loop with no ice cells still clears on/frozenN and forces only the original visual updates', () => {
  const { b } = paired({ count: 0 }); assert.equal(b.SICE.on, false); assert.equal(b.SEAS.frozenN, 0); assert.equal(b.phaseTape.length, 216);
});
for (const year of [0, -40, NaN]) test('empty time loop preserves flags/grid while clearing thick and running the original visual pass: ' + year, () => {
  const { b } = paired({ year, time: 123, count: 13 });
  assert.equal(b.SICE.on, true); assert.equal(b.SEAS.frozenN, 77); assert.equal(b.phaseTape.length, 0); assert(b.SICE.thick.every(v => v === 0));
});
for (const time of [NaN, Infinity, -Infinity]) test('non-iterating clock retains the original empty-loop result: ' + time, () => {
  const { b } = paired({ time, count: 13 });
  assert.equal(b.SICE.on, true); assert.equal(b.SEAS.frozenN, 77); assert.equal(b.phaseTape.length, 0);
});
test('absent ice inventory retains the original immediate return', () => {
  const a = fixture({ old: true }), b = fixture(); a.SICE.ks = b.SICE.ks = null;
  a.api.seasonIceSettle(); b.api.seasonIceSettle(); equal(a, b);
  assert.equal(b.phaseTape.length, 0); assert.equal(b.SICE.meshes[0].attr.version, 0);
});
for (const offset of [-1.5 - 2 ** -22, -1.5, -1.5 + 2 ** -22, -(2 ** -24), 0, 2 ** -24]) {
  test('exact freezing/melting boundary at one real temperature base, offset=' + offset, () => {
    const { b } = paired({ year: 40, time: 35, count: 1 }, f => { f.SICE.t0[0] = offset; f.SICE.shallow[0] = 0; });
    assert.equal(b.phaseTape[0].value, .5);
  });
}
test('walkable count uses final unrounded v even when the Float32 thick/grid values round above .3', () => {
  const { b } = paired({ year: 40, time: 35, count: 1 }, f => { f.SICE.t0[0] = -14 + 2 ** -20; f.SICE.shallow[0] = 1.2e-7; });
  assert(b.SICE.thick[0] >= .3); assert(b.SICE.grid[b.SICE.ks[0]] >= .3);
  assert.equal(b.SICE.on, false); assert.equal(b.SEAS.frozenN, 0, 'do not count the rounded storage value');
});
test('exact final .3 remains walkable and the live step API still agrees after settling', () => {
  const { a, b } = paired({ year: 40, time: 35, count: 1 }, f => { f.SICE.t0[0] = -14; f.SICE.shallow[0] = 0; });
  assert.equal(b.SICE.on, true); assert.equal(b.SEAS.frozenN, 1);
  for (const [dt, phase] of [[.1, .875], [40, 0], [300, .5], [1, .25]]) { a.api.seasonIceStep(dt, phase); b.api.seasonIceStep(dt, phase); equal(a, b); }
});

test('isolated CPU timing uses the exact original and candidate on full-size sparse ice data', { skip: process.env.HM_ICE_SETTLE_BENCH !== '1' }, t => {
  const a = fixture({ old: true, count: 65536 }), b = fixture({ count: 65536 });
  const measure = f => { f.phaseTape.length = 0; const at = performance.now(); f.api.seasonIceSettle(); return performance.now() - at; };
  const cold = { originalMs: measure(a), candidateMs: measure(b) }; equal(a, b);
  const originalMs = [], candidateMs = [];
  for (let i = 0; i < 6; i++) {
    if (i % 2) { candidateMs.push(measure(b)); originalMs.push(measure(a)); }
    else { originalMs.push(measure(a)); candidateMs.push(measure(b)); }
    equal(a, b);
  }
  const median = values => { const a = [...values].sort((x, y) => x - y); return (a[2] + a[3]) / 2; };
  t.diagnostic(JSON.stringify({ kind: 'isolated Node CPU only, no native/loading claim', cells: 65536, steps: 216, cold,
    originalMs, candidateMs, originalMedianMs: median(originalMs), candidateMedianMs: median(candidateMs) }));
});
