// Actual-source DSP and lifecycle proof. No browser, AudioContext or GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const src = await readFile(new URL('../../src/11b_music.js', import.meta.url), 'utf8');
const originalRaw = await readFile(new URL('./fixtures/music-impulse-original.js', import.meta.url));
assert.equal(createHash('sha256').update(originalRaw).digest('hex'), '858977d4154e367df656848fd728d9526180b6a1302828d183cf3e7ec123f2a1');
const normalized = value => value.replace(/\r\n/g, '\n');
const original = normalized(originalRaw.toString('utf8')), actual = normalized(src);
const from = (text, begin, end) => {
  const a = text.indexOf(begin), b = text.indexOf(end, a);
  assert(a >= 0 && b > a); return text.slice(a, b);
};
const originalFunction = from(original, 'function musicImpulse(ctx, sec)', 'function musicPluckBuffer(');
const actualRegion = from(actual, '// Only time-only doubles are prepared.', 'function musicPluckBuffer(');
const tokens = value => value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\s+/g, '');

function realm(candidate, sr, seed = 1, options = {}) {
  let rngState = seed >>> 0, calls = 0;
  const math = Object.create(Math), audioCalls = [];
  math.random = () => {
    calls++;
    if (options.constantRandom !== undefined) return options.constantRandom;
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const ctx = {sampleRate: sr, createBuffer(channels, length, rate) {
    audioCalls.push(['createBuffer', channels, length, rate]);
    if (options.onCreate) options.onCreate();
    if (options.constructorError) throw options.constructorError;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1000000) throw RangeError('Unsupported buffer length');
    const data = Array.from({length: channels}, () => new Float32Array(length));
    return {data, getChannelData(channel) {audioCalls.push(['getChannelData', channel]); return data[channel];}};
  }};
  const sandbox = {Math: math, Number, Object, Float64Array, AUDIO: {ctx}, MUSIC: {E: null},
    GAME: {ready: true, started: false}, UI: {modal: null}, quality: {level: options.lite ? 'low' : 'medium'},
    IS_TOUCH: false, document: {hidden: false}, GRAPHICS_CONTEXT_LOST: false, GRAPHICS_STARTUP: {stopped: false}};
  vm.createContext(sandbox);
  vm.runInContext((candidate ? actualRegion : originalFunction)
    + '\nthis.call = musicImpulse;'
    + (candidate ? '\nthis.prepare = musicImpulsePrepareFrame; this.cancel = musicImpulsePrepareCancel;'
      + '\nthis.privateState = () => MUSIC_IMPULSE_PREP; this.prepState = musicImpulsePreparationState;' : ''), sandbox);
  return {sandbox, ctx, audioCalls, call: sec => sandbox.call(ctx, sec), rng: () => ({calls, state: rngState, next: math.random()}),
    calls: () => calls};
}
function complete(candidate) {
  for (let turns = 0; turns < 400; turns++) {
    const before = candidate.sandbox.privateState().plan?.next || 0;
    candidate.sandbox.prepare();
    const p = candidate.sandbox.privateState().plan;
    assert(p && p.next - before <= 512 && p.length * 16 <= 2621440, 'Bounded private chunk/allocation');
    if (p.status === 'complete') return p;
  }
  assert.fail('Bounded coefficient inventory did not complete');
}
function compare(originalRealm, candidate, sec) {
  const expected = originalRealm.call(sec), result = candidate.call(sec);
  assert.deepEqual(candidate.audioCalls, originalRealm.audioCalls, 'Original constructor and channel API ordering');
  for (let ch = 0; ch < 2; ch++)
    assert(Buffer.from(expected.data[ch].buffer).equals(Buffer.from(result.data[ch].buffer)), 'Exact full Float32 PCM bytes, channel ' + ch);
  assert.deepEqual(candidate.rng(), originalRealm.rng(), 'Every original draw and the next RNG state');
  return result;
}

test('pinned fallback and prepared arithmetic retain actual original bodies and every other music function', () => {
  const body = from(originalFunction, '  for (let ch = 0;', '  return buf;');
  assert(actualRegion.includes(body), 'Literal original fallback channel/RNG/float body');
  const prepared = from(actualRegion, '      for (let ch = 0;', '      MUSIC_IMPULSE_PREP.consumed++;');
  const originalMath = 'const tt = (i - pre) / sr;\nconst env = Math.exp(-decay * tt) * Math.min(1, tt / 0.04);\nconst k = 0.62 * Math.exp(-tt * 1.6) + 0.035;';
  const restored = prepared.replace('const env = prepared.env[i - pre], k = prepared.k[i - pre];', originalMath);
  assert.equal(tokens(restored), tokens(body));
  const prefix = original.slice(0, original.indexOf('function musicImpulse(ctx, sec)'));
  assert.equal(actual.slice(0, actual.indexOf('// Only time-only doubles are prepared.')), prefix);
  const suffix = text => text.slice(text.indexOf('function musicPluckBuffer('));
  assert.equal(suffix(actual).replace('        impulsePreparation: musicImpulsePreparationState(),\n', ''), suffix(original));
});

for (const [sr, sec] of [[22050, 2.4], [32000, 3.4], [44100, 2.4], [44100, 3.4], [48000, 2.4], [48000, 3.4]]) {
  test('complete preparation preserves all PCM bytes and RNG at ' + sr + '/' + sec, () => {
    for (const seed of [1, 0x83ab219d]) {
      const before = realm(false, sr, seed), candidate = realm(true, sr, seed, {lite: sec === 2.4});
      const p = complete(candidate);
      assert.equal(candidate.calls(), 0); assert.deepEqual(candidate.audioCalls, [], 'No early audio construction or buffer access');
      candidate.sandbox.GAME.started = true; candidate.sandbox.UI.modal = null;
      candidate.sandbox.prepare(); assert.equal(candidate.sandbox.privateState().plan, p, 'Live handoff retains only complete data');
      compare(before, candidate, sec);
      assert.equal(candidate.sandbox.privateState().plan, null); assert.equal(p.env, null); assert.equal(p.k, null); assert.equal(p.ctx, null);
      assert.equal(candidate.sandbox.prepState().consumed, 1);
    }
  });
}

test('reflection collisions and sign draws preserve their original float accumulation order', () => {
  const a = realm(false, 8000, 0, {constantRandom: 0.5}), b = realm(true, 8000, 0, {constantRandom: 0.5, lite: true});
  complete(b); compare(a, b, 2.4);
});

test('missing, partial and cancelled preparation use the literal synchronous fallback and release memory', () => {
  for (const mode of ['missing', 'partial', 'cancelled']) {
    const a = realm(false, 44100), b = realm(true, 44100, 1, {lite: true});
    let p;
    if (mode !== 'missing') {b.sandbox.prepare(); p = b.sandbox.privateState().plan;}
    if (mode === 'cancelled') b.sandbox.cancel();
    compare(a, b, 2.4); assert.equal(b.sandbox.prepState().consumed, 0);
    assert.equal(b.sandbox.privateState().plan, null); if (p) assert.equal(p.env, null);
  }
});

test('wrong duration, sample rate and context cannot consume stale coefficients', () => {
  for (const mode of ['duration', 'rate', 'context']) {
    const b = realm(true, 44100); const old = complete(b);
    let sr = 44100, sec = 3.4;
    if (mode === 'duration') sec = 2.4;
    if (mode === 'rate') {sr = 32000; b.ctx.sampleRate = sr;}
    if (mode === 'context') b.sandbox.AUDIO.ctx = {...b.ctx};
    if (mode === 'context') {
      b.sandbox.prepare(); assert.notEqual(b.sandbox.privateState().plan, old);
      assert.equal(old.env, null); b.sandbox.cancel();
    }
    compare(realm(false, sr), b, sec); assert.equal(b.sandbox.prepState().consumed, 0);
  }
});

test('hidden/stopped/context-loss and live/early guards cancel without RNG, constructors or publication', () => {
  for (const change of [s => s.document.hidden = true, s => s.GRAPHICS_STARTUP.stopped = true,
    s => s.GRAPHICS_CONTEXT_LOST = true, s => s.MUSIC.E = {}, s => s.AUDIO.ctx = null,
    s => {s.GAME.started = true; s.UI.modal = null;}, s => s.GAME.ready = false]) {
    const b = realm(true, 44100); b.sandbox.prepare(); const p = b.sandbox.privateState().plan;
    change(b.sandbox); b.sandbox.prepare();
    assert.equal(b.sandbox.privateState().plan, null); assert.equal(p.env, null);
    assert.equal(b.calls(), 0); assert.deepEqual(b.audioCalls, []);
  }
  const b = realm(true, 44100); b.sandbox.GAME.started = true; b.sandbox.UI.modal = 'prologue';
  b.sandbox.prepare(); assert(b.sandbox.privateState().plan, 'Paused prologue can prepare only pure math');
});

test('unsupported rates/durations fall back and original constructor exceptions release only the call owner', () => {
  for (const [sr, sec] of [[96000, 3.4], [192000, 2.4], [48000, 1.2], [3, 2.4]]) {
    const a = realm(false, sr), b = realm(true, sr);
    if (sr >= 96000) {b.sandbox.prepare(); assert.equal(b.sandbox.privateState().plan, null);}
    compare(a, b, sec);
  }
  const expectedError = Error('Original createBuffer failure');
  const b = realm(true, 44100, 1, {constructorError: expectedError}), p = complete(b);
  assert.throws(() => b.call(3.4), error => error === expectedError);
  assert.equal(p.env, null); assert.equal(p.ctx, null); assert.equal(b.sandbox.privateState().plan, null);
});

test('an old in-flight call cannot release a newer context generation', () => {
  let b;
  b = realm(true, 44100, 1, {onCreate() {
    b.sandbox.cancel(); b.sandbox.AUDIO.ctx = {sampleRate: 32000}; b.sandbox.prepare();
  }});
  const old = complete(b); b.call(3.4);
  const next = b.sandbox.privateState().plan;
  assert(next && next !== old && next.ctx === b.sandbox.AUDIO.ctx); assert.equal(old.env, null);
});

test('allocation failure is optional and does not retry within the same key or touch audio/RNG', () => {
  const b = realm(true, 44100); let attempts = 0;
  b.sandbox.Float64Array = function () {attempts++; throw Error('Private allocation failed');};
  b.sandbox.prepare(); b.sandbox.prepare();
  assert.equal(attempts, 1); assert.equal(b.sandbox.prepState().status, 'allocation-fallback');
  assert.equal(b.sandbox.prepState().bytes, 0); assert.equal(b.calls(), 0); assert.deepEqual(b.audioCalls, []);
  compare(realm(false, 44100), b, 3.4); assert.equal(b.sandbox.privateState().plan, null);
});

test('completed coefficients are consumed once and subsequent calls preserve original RNG advancement', () => {
  const a = realm(false, 32000), b = realm(true, 32000); complete(b);
  compare(a, b, 3.4); compare(a, b, 3.4);
  assert.equal(b.sandbox.prepState().consumed, 1); assert.equal(b.sandbox.prepState().fallbacks, 1);
});

test('quality changes release the old plan and prepare only the current exact duration', () => {
  const b = realm(true, 44100), old = complete(b);
  b.sandbox.quality.level = 'low'; b.sandbox.prepare();
  assert.equal(old.env, null); assert.equal(b.sandbox.privateState().plan.sec, 2.4);
  complete(b); compare(realm(false, 44100), b, 2.4);
});

test('nonfinite and negative constructor inputs preserve the original failure before any random draw', () => {
  for (const [sr, sec] of [[NaN, 3.4], [Infinity, 2.4], [44100, NaN], [44100, Infinity], [44100, -1]]) {
    const a = realm(false, sr), b = realm(true, sr);
    let first, second;
    try { a.call(sec); } catch (error) { first = error; }
    try { b.call(sec); } catch (error) { second = error; }
    assert(first && second && first.name === second.name && first.message === second.message);
    assert.deepEqual(b.audioCalls, a.audioCalls); assert.deepEqual(b.rng(), a.rng());
  }
});

test('frame wiring adds no wait, scheduler, input or authority call and visibility only cancels private work', async () => {
  const main = await readFile(new URL('../../src/13_main.js', import.meta.url), 'utf8');
  const audio = await readFile(new URL('../../src/11_audio.js', import.meta.url), 'utf8');
  const frame = from(normalized(main), 'function frame(now)', '/* ------------------------------------------------------------------ */');
  assert(frame.includes('requestAnimationFrame(frame)'));
  assert(frame.includes('try { musicImpulsePrepareFrame(); tick(dt); }'));
  assert(!frame.includes('await ')); assert(!frame.includes('netHumanSync('));
  assert(normalized(audio).includes("if (document.hidden) musicImpulsePrepareCancel();\n  if (!AUDIO.ctx) return;"));
  const pure = from(actualRegion, 'function musicImpulsePrepareFrame()', 'function musicImpulsePreparedTake(');
  assert(!pure.includes('Math.random')); assert(!pure.includes('createBuffer(')); assert(!pure.includes('new THREE'));
  assert(!pure.includes('requestAnimationFrame(')); assert(!pure.includes('setTimeout('));
});
