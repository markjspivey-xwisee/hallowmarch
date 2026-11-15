import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import * as THREE from 'three';
const source = readFileSync(new URL('../../src/02c_water_map.js', import.meta.url), 'utf8');
const functions = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter(n => n.type === 'FunctionDeclaration' && ['rippleAllocate', 'rippleSetup'].includes(n.id.name))
  .map(n => source.slice(n.start, n.end)).join('\n');
function fixture(level = 'medium') {
  const targets = [], draws = [], calls = [];
  class Target extends THREE.WebGLRenderTarget {
    constructor(...args) { super(...args); targets.push(this); this.disposals = 0; }
    dispose() { this.disposals++; super.dispose(); }
  }
  const ctx = vm.createContext({ THREE: { ...THREE, WebGLRenderTarget: Target },
    BOOT_SAFE: false, FLOAT_RT: true, REDUCE_MOTION: false, quality: { level },
    RIPPLE: { res: 0, on: false, rtA: null, rtB: null, acc: .01, steps: 0, drops: [[1, 2, 3, 4]] },
    U: { uRipple: { value: 'original' }, uRippleB: { value: new THREE.Vector4(1, 2, 3, 4) } },
    ZERO_TEX: new THREE.Texture(), rippleClearMat: new THREE.ShaderMaterial(),
    pass(material, target) { draws.push({ material, target }); }, renderer: { setRenderTarget(target) { calls.push(target); } } });
  vm.runInContext(functions, ctx); return { ctx, targets, draws, calls };
}
for (const [level, size] of [['medium', 128], ['high', 256]]) test('allocation precedes ordinary one-time clearing without consuming ripples: ' + level, () => {
  const f = fixture(level), r = f.ctx.RIPPLE; f.ctx.rippleAllocate();
  assert.equal(f.targets.length, 2); assert(r.on); assert(r.needsClear); assert.equal(r.res, size);
  assert.equal(r.rtA.width, size); assert.equal(r.rtB.height, size); assert.equal(r.rtA.texture.type, THREE.HalfFloatType);
  assert.equal(f.draws.length, 0); assert.equal(f.ctx.U.uRipple.value, 'original');
  assert.equal(r.steps, 0); assert.equal(r.acc, .01); assert.equal(r.drops.length, 1);
  f.ctx.rippleAllocate(); assert.equal(f.targets.length, 2); assert(r.needsClear);
  f.ctx.rippleSetup(); assert.equal(r.needsClear, false);
  assert.deepEqual(f.draws.map(d => d.target), [r.rtA, r.rtB]);
  assert(f.draws.every(d => d.material === f.ctx.rippleClearMat)); assert.deepEqual(f.calls, [null]);
  f.ctx.rippleSetup(); assert.equal(f.draws.length, 2); assert.equal(f.targets.length, 2);
  assert.equal(r.steps, 0); assert.equal(r.acc, .01); assert.equal(r.drops.length, 1);
});
test('quality replacement clears only new targets and disabling binds neutral texture on the real setup path', () => {
  const f = fixture(); f.ctx.rippleAllocate(); const old = [f.ctx.RIPPLE.rtA, f.ctx.RIPPLE.rtB];
  f.ctx.quality.level = 'high'; f.ctx.rippleAllocate();
  assert(old.every(t => t.disposals === 1)); assert.equal(f.draws.length, 0);
  f.ctx.rippleSetup(); assert.equal(f.draws.length, 2);
  f.ctx.quality.level = 'low'; f.ctx.rippleAllocate(); assert.equal(f.ctx.RIPPLE.on, false);
  assert.equal(f.ctx.U.uRipple.value, 'original'); f.ctx.rippleSetup();
  assert.equal(f.ctx.U.uRipple.value, f.ctx.ZERO_TEX); assert.equal(f.ctx.U.uRippleB.value.w, 0); assert.equal(f.draws.length, 2);
});
for (const condition of ['BOOT_SAFE', 'FLOAT_RT', 'REDUCE_MOTION']) test('unavailable ripple path allocates no targets: ' + condition, () => {
  const f = fixture(); f.ctx[condition] = condition !== 'FLOAT_RT'; f.ctx.rippleAllocate(); f.ctx.rippleSetup();
  assert.equal(f.targets.length, 0); assert.equal(f.draws.length, 0); assert.equal(f.ctx.U.uRipple.value, f.ctx.ZERO_TEX);
});
