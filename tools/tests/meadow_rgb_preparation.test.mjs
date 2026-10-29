import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import * as THREE from 'three';
import { parse } from 'acorn';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const terrain = read('03_terrain.js'), util = read('00_util.js');
function declarations(source, names) {
  return parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)
      || node.type === 'VariableDeclaration' && node.declarations.some(decl => names.includes(decl.id.name)))
    .map(node => source.slice(node.start, node.end)).join('\n');
}

// Pinned original synchronous body from 22ae16b / deployed PR64. This oracle is
// intentionally independent of the candidate kernel and available in shallow CI.
const PRIOR_BAKE = `function bakeMeadow(b) {
  const R = CANOPY.res, cell = WSIZE / R;
  const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = -HALF + (i + 0.5) * cell, z = -HALF + (j + 0.5) * cell, q = (j * R + i) * 4;
    const a = vnoise(x * 0.019 + 3.1, z * 0.019 + 7.7) * 0.65 + vnoise(x * 0.071 + 1.3, z * 0.071 + 2.9) * 0.35;
    const bb = vnoise(x * 0.043 + 9.2, z * 0.043 + 4.4) * 0.7 + vnoise(x * 0.15 + 6.1, z * 0.15 + 6.1) * 0.3;
    const c = vnoise(x * 0.027 + 5.5, z * 0.027 + 0.7) * 0.6 + vnoise(x * 0.09 + 2, z * 0.09 + 2) * 0.4;
    b[q] = Math.round(ss(0.56, 0.8, a) * 255); b[q + 1] = Math.round(ss(0.5, 0.74, bb) * 255); b[q + 2] = Math.round(ss(0.45, 0.72, c) * 255);
  }
}`;

function fixture({ prior = false, res = 32, seed = 7 } = {}) {
  const effects = { random: 0, seeded: 0, saves: 0, simulation: 0, textures: 0 };
  const math = Object.create(Math);
  math.random = () => { effects.random++; throw Error('Meadow preparation cannot consume randomness'); };
  class Texture extends THREE.DataTexture { constructor(...args) { super(...args); effects.textures++; } }
  const context = vm.createContext({ THREE: { ...THREE, DataTexture: Texture }, Math: math,
    WSIZE: 1024, HALF: 512, renderTime: 73, GAME: { t: 19, player: { xp: 123 } },
    W: { seed, trees: [{ x: -10, z: 5, kind: 'oak', s: 2, leaf: .6, grow: .8, char: .3 },
      { x: 17, z: -4, kind: 'pine', s: 1.8, felled: true }, { x: 4, z: 15, kind: 'birch', s: 1.2, grow: .4 }] },
    COLL: { boxes: [{ x: -7, z: 8, hx: 3, hz: 2, h: 4, tag: 'house', cos: 1, sin: 0 }], circles: [] },
    U: { uCanopy: { value: new THREE.Texture() }, uGroundAO: { value: new THREE.Texture() } }, window: {},
    seasonCrownK: t => t.kind === 'oak' ? .75 : 1,
    look2PathMap: rg => { rg[1] = 17; }, look3PathMap: rg => { rg[3] = 23; },
    rand: () => { effects.seeded++; throw Error('No shared RNG'); },
    saveGame: () => { effects.saves++; throw Error('No save'); },
    simStep: () => { effects.simulation++; throw Error('No simulation'); },
  });
  const names = ['CANOPY', 'meadowRGB', 'bakeMeadowChunks', 'prepareMeadowRGBChunks', 'bakeMeadow',
    'canopyOf', 'stampCanopy', 'buildGroundAO', 'updateCanopy'];
  let source = declarations(terrain, names);
  if (prior) source = source.replace(declarations(terrain, ['bakeMeadow']), PRIOR_BAKE);
  // The built game shares lexical helpers in one module. Keep those same
  // lexical calls here instead of charging a VM global-proxy hop per noise tap.
  vm.runInContext('globalThis.api=(function(Math){\n'
    + declarations(util, ['clamp', 'hash2', 'vnoise', 'mulberry']) + '\n' + source
    + '\nreturn {CANOPY,bakeMeadow,bakeMeadowChunks,prepareMeadowRGBChunks,updateCanopy,mulberry,peek:()=>meadowRGB,'
    + 'getNoise:()=>vnoise,setNoise:fn=>{vnoise=fn;}};})(Math);', context);
  context.api.CANOPY.res = res;
  const seeded = context.api.mulberry(seed);
  return { context, api: context.api, effects, seeded };
}
function alphaBytes(res, seed) {
  const bytes = new Uint8Array(res * res * 4);
  for (let q = 0; q < bytes.length; q++) bytes[q] = (q * 37 + seed * 13) & 255;
  return bytes;
}
const rawBytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function drain(work, interleave = () => {}) {
  let steps = 0, maximum = 0, active = 0, result;
  do {
    const before = performance.now(); result = work.next(); const elapsed = performance.now() - before;
    maximum = Math.max(maximum, elapsed); active += elapsed; steps++;
    if (!result.done) interleave(steps);
  } while (!result.done);
  return { steps, maxResumeMs: maximum, activeMs: active };
}

for (const seed of [7, 19, 503]) test('full map prepared and serial bytes equal the original oracle; seed ' + seed, t => {
  const prior = fixture({ prior: true, res: 512, seed }), f = fixture({ res: 512, seed });
  const expected = alphaBytes(512, seed), serial = expected.slice(), prepared = expected.slice();
  prior.api.bakeMeadow(expected); f.api.bakeMeadow(serial); assert.deepEqual(serial, expected);
  const before = JSON.stringify({ world: f.context.W, player: f.context.GAME.player });
  const measured = drain(f.api.prepareMeadowRGBChunks(), () => {
    // Other host tasks can consume independent RNG and advance unrelated time.
    f.seeded(); Math.random(); f.context.GAME.t += 1; f.context.renderTime += .5;
    assert.equal(f.api.CANOPY.bytes, null); assert.equal(f.api.CANOPY.tex, null);
    assert.equal(f.api.peek(), null, 'partial work must stay private');
  });
  assert.equal(measured.steps, 129, 'four complete rows per resume, plus publication');
  assert(f.api.peek()); const copyAt = performance.now(); f.api.bakeMeadow(prepared);
  const copyMs = performance.now() - copyAt;
  assert.deepEqual(prepared, expected); assert.equal(f.api.peek(), null, 'temporary memory released at consumption');
  assert.equal(JSON.stringify({ world: f.context.W, player: f.context.GAME.player }), before);
  assert.deepEqual(f.effects, { random: 0, seeded: 0, saves: 0, simulation: 0, textures: 0 });
  t.diagnostic(JSON.stringify({ seed, ...measured, copyMs }));
});

test('each resume is bounded by four rows of exact coordinate-noise work', () => {
  const f = fixture({ res: 37 }); let calls = 0, total = 0, maximum = 0;
  const original = f.api.getNoise(); f.api.setNoise((...args) => { calls++; return original(...args); });
  const work = f.api.prepareMeadowRGBChunks(); let result;
  do { calls = 0; result = work.next(); total += calls; maximum = Math.max(maximum, calls); } while (!result.done);
  assert.equal(total, 37 * 37 * 6); assert.equal(maximum, 4 * 37 * 6);
});

test('absent, interrupted and cancelled preparation retain exact synchronous fallback and alpha', () => {
  for (const kind of ['absent', 'interrupted', 'cancelled']) {
    const f = fixture(), prior = fixture({ prior: true });
    if (kind !== 'absent') { const work = f.api.prepareMeadowRGBChunks(); work.next(); if (kind === 'cancelled') work.return(); }
    assert.equal(f.api.peek(), null); const actual = alphaBytes(32, 47), expected = actual.slice();
    f.api.bakeMeadow(actual); prior.api.bakeMeadow(expected); assert.deepEqual(actual, expected, kind);
  }
});

for (const field of ['res', 'size', 'half']) test('stale ' + field + ' rejects completed and in-flight preparation', () => {
  for (const completed of [false, true]) {
    const f = fixture(), prior = fixture({ prior: true });
    const work = f.api.prepareMeadowRGBChunks(); if (completed) drain(work); else work.next();
    if (field === 'res') { f.api.CANOPY.res = prior.api.CANOPY.res = 17; }
    else if (field === 'size') f.context.WSIZE = prior.context.WSIZE = 777;
    else f.context.HALF = prior.context.HALF = 389;
    if (!completed) { drain(work); assert.equal(f.api.peek(), null); }
    const actual = alphaBytes(f.api.CANOPY.res, 19), expected = actual.slice();
    f.api.bakeMeadow(actual); prior.api.bakeMeadow(expected); assert.deepEqual(actual, expected); assert.equal(f.api.peek(), null);
  }
});

test('preparation does not replace existing textures or disturb live canopy state', () => {
  const prior = fixture({ prior: true, res: 64 }), f = fixture({ res: 64 });
  const beforeBindings = { ...f.context.U };
  drain(f.api.prepareMeadowRGBChunks());
  assert.equal(f.effects.textures, 0); assert.equal(f.context.U.uCanopy, beforeBindings.uCanopy);
  assert.equal(f.context.U.uGroundAO, beforeBindings.uGroundAO); assert.equal(f.api.CANOPY.acc, null);
  // The actual tree state at first use, not state at preparation, owns alpha.
  for (const v of [f, prior]) {
    v.context.W.trees[0].felled = true; v.context.W.trees[1].felled = false;
    Object.assign(v.context.W.trees[1], { x: 24, z: 8 });
  }
  f.api.updateCanopy(); prior.api.updateCanopy();
  const texture = f.api.CANOPY.tex, ground = f.context.U.uGroundAO.value;
  for (const field of ['bytes', 'acc', 'cache', 'rad', 'ao']) assert.deepEqual(rawBytes(f.api.CANOPY[field]), rawBytes(prior.api.CANOPY[field]), field);
  assert(f.api.CANOPY.bytes.some((value, q) => q % 4 === 3 && value > 0), 'live trees really stamp nonzero alpha');
  assert.deepEqual(rawBytes(ground.image.data), rawBytes(prior.context.U.uGroundAO.value.image.data));
  assert.equal(f.effects.textures, 2); assert.equal(texture.image.data, f.api.CANOPY.bytes);
  assert.equal(texture.minFilter, THREE.LinearFilter); assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.generateMipmaps, false); assert.equal(f.context.U.uCanopy.value, texture);
  assert.equal(f.api.CANOPY.next, 74.5); assert.equal(f.api.peek(), null);
  assert.equal(f.api.prepareMeadowRGBChunks().next().done, true); assert.equal(f.api.peek(), null);
  for (const v of [f, prior]) { v.context.W.trees[1].felled = true; v.context.renderTime += 2; v.api.updateCanopy(); }
  assert.deepEqual(rawBytes(f.api.CANOPY.bytes), rawBytes(prior.api.CANOPY.bytes));
  assert.equal(f.api.CANOPY.tex, texture); assert.equal(f.context.U.uGroundAO.value, ground); assert.equal(f.effects.textures, 2);
});

test('duplicate completed preparation is a no-op, and first use while preparation is paused cannot publish a replacement', () => {
  const f = fixture(); drain(f.api.prepareMeadowRGBChunks()); const prepared = f.api.peek();
  assert.equal(f.api.prepareMeadowRGBChunks().next().done, true); assert.equal(f.api.peek(), prepared);
  const g = fixture(), work = g.api.prepareMeadowRGBChunks(); work.next(); g.api.updateCanopy();
  const texture = g.api.CANOPY.tex, bytes = g.api.CANOPY.bytes.slice(); drain(work);
  assert.equal(g.api.peek(), null); assert.equal(g.api.CANOPY.tex, texture); assert.deepEqual(g.api.CANOPY.bytes, bytes);
});
