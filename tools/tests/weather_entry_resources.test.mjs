import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';
import * as THREE from 'three';

const source = readFileSync(new URL('../../src/12c_weather2.js', import.meta.url), 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const names = ['wxAllocateClouds', 'wxBuildClouds', 'wxAllocateCloudScreen', 'wxPrepareCloudResources', 'wxBuildShafts'];
const functions = ast.body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name))
  .map(n => source.slice(n.start, n.end)).join('\n');
assert.equal(functions.match(/function wx/g).length, names.length);

function fixture(level = 'medium', safe = false) {
  const targets = [], stats = { random: 0, simulation: 0, draws: 0 };
  class Target extends THREE.WebGLRenderTarget {
    constructor(...args) { super(...args); targets.push(this); this.disposeCount = 0; }
    dispose() { this.disposeCount++; super.dispose(); }
  }
  const uniform = value => ({ value });
  const U = { uCloudMapP: uniform(new THREE.Vector4(4, 5, 6, 7)), uTime: uniform(42),
    uCloudMap: uniform(new THREE.Texture()), uCloudDome: uniform(new THREE.Texture()),
    uCloudDomeOn: uniform(new THREE.Vector4(0, 3, 4, 5)), uCloudScr: uniform(new THREE.Texture()) };
  const ctx = { THREE: { ...THREE, WebGLRenderTarget: Target }, BOOT_SAFE: safe,
    WX_Q: { high: { field: 256, dome: 256, steps: 14, veil: 1, scr: 2 }, medium: { field: 192, dome: 192, steps: 10, veil: 1, scr: 3 }, low: { field: 128, dome: 160, steps: 7, veil: 0, scr: 4 } },
    WXR: { field: null, dome: null, fieldMat: null, domeMat: null, q: null, n: 0, on: !safe },
    quality: { level }, WX_N: 12, WX_SHAFT_N: 8, RT_TYPE: THREE.HalfFloatType, U, scene: new THREE.Scene(),
    skyU: { uCloudLit: uniform(new THREE.Color()), uCloudShade: uniform(new THREE.Color()), uSunVis: uniform(.7) },
    sceneRT: { width: 1280, height: 801 }, FS_VERT: '', GLSL_COMMON: '', GLSL_WXFIELD: '', GLSL_ATMOS: '', GLSL_WXMARCH: '',
    mat: opts => new THREE.ShaderMaterial({ ...opts, uniforms: { ...U, ...opts.uniforms } }),
    pass() { stats.draws++; throw Error('resource allocation must not draw'); },
    wxShelterStep() { stats.simulation++; throw Error('resource allocation must not simulate'); },
    rand() { stats.random++; throw Error('resource allocation must not consume RNG'); } };
  vm.createContext(ctx); vm.runInContext(functions, ctx);
  return { ctx, targets, stats, bindings: () => [U.uCloudMap.value, U.uCloudDome.value, U.uCloudScr.value, ...U.uCloudDomeOn.value.toArray()] };
}

for (const level of ['low', 'medium', 'high']) test('preparation owns exact original resources without enabling weather: ' + level, () => {
  const f = fixture(level), before = f.bindings(), r = f.ctx.wxPrepareCloudResources(), w = f.ctx.WXR;
  assert.deepEqual(Array.from(r, x => x.id), ['weather-field', 'weather-dome', 'weather-screen']);
  assert.equal(r[0].material, w.fieldMat); assert.equal(r[0].target, w.field);
  assert.equal(r[1].material, w.domeMat); assert.equal(r[1].target, w.dome);
  assert.equal(r[2].material, w.scrMat); assert.equal(r[2].target, w.scr);
  assert.deepEqual(f.bindings(), before); assert.equal(w.n, 0); assert.equal(w.scrOn, undefined);
  assert.deepEqual(f.stats, { random: 0, simulation: 0, draws: 0 });
  assert.equal(w.shafts.parent, f.ctx.scene); assert.equal(w.shafts.visible, false); assert.equal(w.shafts.geometry.instanceCount, 0);
  assert.equal(f.targets.length, 3);
  const again = f.ctx.wxPrepareCloudResources();
  assert.equal(again[0].target, r[0].target); assert.equal(again[2].target, r[2].target); assert.equal(f.targets.length, 3);
  f.ctx.wxBuildClouds();
  assert.equal(f.ctx.U.uCloudMap.value, w.field.texture); assert.equal(f.ctx.U.uCloudDome.value, w.dome.texture);
  assert.equal(f.ctx.U.uCloudDomeOn.value.x, 1); assert.equal(w.domeMat.uniforms.uDomeP.value.x, f.ctx.WX_Q[level].steps);
  assert.equal(w.domeMat.uniforms.uDomeP.value.z, f.ctx.WX_Q[level].veil); assert.equal(w.n, 0);
  assert.equal(f.targets.length, 3); assert.equal(f.ctx.U.uCloudScr.value, before[2]);
});

test('resize and quality changes dispose stale targets once and retain original materials', () => {
  const f = fixture(), first = f.ctx.wxPrepareCloudResources();
  f.ctx.sceneRT.width = 300; f.ctx.sceneRT.height = 799;
  const resized = f.ctx.wxPrepareCloudResources();
  assert.equal(first[2].target.disposeCount, 1); assert.equal(resized[2].target.width, 100); assert.equal(resized[2].target.height, 267);
  assert.equal(first[0].target, resized[0].target); assert.equal(first[0].target.disposeCount, 0);
  f.ctx.quality.level = 'low'; const changed = f.ctx.wxPrepareCloudResources();
  assert.equal(first[0].target.disposeCount, 1); assert.equal(first[1].target.disposeCount, 1); assert.equal(resized[2].target.disposeCount, 1);
  for (let i = 0; i < 3; i++) assert.equal(first[i].material, changed[i].material);
  assert.equal(changed[0].target.width, 128); assert.equal(changed[1].target.height, 160); assert.equal(changed[2].target.width, 75);
});

for (const mode of ['recovery', 'off', 'no target']) test('no resources are allocated when unavailable: ' + mode, () => {
  const f = fixture('medium', mode === 'recovery');
  if (mode === 'off') f.ctx.WXR.on = false;
  if (mode === 'no target') f.ctx.sceneRT = null;
  assert.equal(f.ctx.wxPrepareCloudResources().length, 0); assert.equal(f.targets.length, 0);
});

test('first live frame binds the prepared textures and screen pass binds only during its actual draw', () => {
  const frame = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'wxCloudsFrame');
  const body = source.slice(frame.start, frame.end);
  assert.match(body, /U\.uCloudMap\.value !== WXR\.field\.texture/);
  assert.match(body, /U\.uCloudDome\.value !== WXR\.dome\.texture\) wxBuildClouds\(\)/);
  const screen = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'wxCloudsScreen');
  const draw = source.slice(screen.start, screen.end);
  assert(draw.indexOf('wxAllocateCloudScreen();') < draw.indexOf('U.uCloudScr.value = WXR.scr.texture;'));
  assert(draw.indexOf('U.uCloudScr.value = WXR.scr.texture;') < draw.indexOf('pass(WXR.scrMat, WXR.scr)'));
});
