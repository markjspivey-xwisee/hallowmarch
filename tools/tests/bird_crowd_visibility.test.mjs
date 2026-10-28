import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const actors = read('05b_actors.js'), depth = read('09u_depth.js'), main = read('13_main.js'), render = read('02_render.js');
function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const crowd = actors.slice(actors.indexOf('class Crowd {'), actors.indexOf('\nconst HUMAN_ATTRS'));
const birdClass = depth.match(/class GameBirdCrowd extends Crowd \{[\s\S]*?\n\}/)?.[0] || '';
const lod = main.match(/const HUMAN_LOD = [^;]+;/)[0];

function fixture() {
  const scene = new THREE.Scene(), shadowScene = new THREE.Scene(), pools = {}, builds = [], draws = [];
  const shadow = { scene: shadowScene, proxies: [], rt: {}, cam: new THREE.PerspectiveCamera() };
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 500);
  const frustum = new THREE.Frustum();
  const humanPool = () => ({ n: 0, begin() { this.n = 0; }, end() {}, push() { throw Error('Birds must not enter a human pool'); } });
  pools.hen = [humanPool(), humanPool()];
  const context = vm.createContext({ THREE, scene, SHADOW: shadow, crowdBeast: pools, beastMat: new THREE.ShaderMaterial(), DEPTH_FS: 'void main(){ gl_FragColor = vec4(1.0); }',
    beastUniforms: () => ({}), birdUniforms: () => ({}), farmBeastFS: () => 'farm fragment',
    birdVS: isDepth => 'bird vertex ' + isDepth, birdFS: source => 'bird fragment ' + source,
    shareMat: (material, uniforms) => { const result = material.clone(); result.uniforms = uniforms; return result; },
    birdBuild(kind, detail) {
      builds.push([kind, detail]);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      return geometry;
    },
    renderer: { setRenderTarget(value) { assert.equal(value, shadow.rt); }, clear() {}, render(target) {
      const visible = []; target.traverseVisible(object => { if (object.isMesh) visible.push(object); }); draws.push(visible);
    } },
    updateShadowCamera() {},
    camera, frustum, quality: { level: 'high' }, HUMAN_FAR: { high: 90, medium: 60, low: 38 },
    GAME: { t: 10, player: null }, ENT: [], TRAIL_CAND: [], trailSegs: [], TRAIL: { maxSegs: 0 },
    crowdHuman: humanPool(), crowdHumanLo: humanPool(), crowdHumanFar: humanPool(),
    _sph: new THREE.Sphere(), _p4: [], _a4: [], _ca: [], _cb: [], _mi: [], _st: [], _we: [],
    _ma: [], _hc: [], _hb: [], STAMP_R: { pheasant: 0.22, duck: 0.22 }, SHADOW_R: { pheasant: 0.32, duck: 0.3 },
    footLockBegin() {}, footLockEnd() {}, footLockSlot: () => 0, animActValue: entity => entity.anim.act,
    waterAnimPack() {}, beastWx: () => 0,
    dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
  });
  vm.runInContext(crowd + '\n' + birdClass + '\n' + lod + '\n' +
    ['shadowCaster', 'depthFrom', 'liveIn', 'renderShadowPass'].map(name => extract(render, name)).join('\n') + '\n' +
    extract(depth, 'dpBirdCrowds') + '\n' + extract(main, 'drawActors') + '\ndpBirdCrowds();', context);
  function view(forward = true) {
    camera.position.set(0, 3, 0); camera.lookAt(0, 1, forward ? 40 : -40); camera.updateMatrixWorld(true);
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  }
  view();
  const all = () => ['pheasant', 'duck'].flatMap(kind => pools[kind]);
  const proxy = pool => shadow.proxies.find(mesh => mesh.userData.src === pool.mesh);
  const shadows = () => { scene.updateMatrixWorld(true); context.renderShadowPass(0, 0, 0); return draws.at(-1).map(mesh => mesh.id); };
  return { context, scene, pools, builds, all, proxy, shadows, view,
    draw(entities) { context.ENT = entities; context.drawActors(10000, 10000); },
    generic() { return vm.runInContext('new Crowd(new THREE.InstancedBufferGeometry(), beastMat, 1, BEAST_ATTRS)', context); } };
}

function bird(kind, distance, id = 1) {
  return { id, kind, crowd: kind, role: 'bird', alive: true, x: 0, y: 0, z: distance, yaw: 0.4, scale: 1,
    anim: { phase: 0.25, turn: 0, amt: 0.5, act: 0, death: 0, flash: 0 },
    look: { colA: [0.4, 0.5, 0.6], colB: [0.1, 0.2, 0.3] } };
}

test('all bird detail pools and their exact-geometry shadow proxies start empty and invisible', () => {
  const f = fixture();
  assert.deepEqual(f.builds, [['pheasant', 0], ['pheasant', 1], ['duck', 0], ['duck', 1]]);
  assert.deepEqual(f.all().map(pool => pool.max), [24, 40, 24, 40]);
  for (const pool of f.all()) {
    assert.equal(pool.n, 0); assert.equal(pool.geo.instanceCount, 0);
    assert.equal(pool.mesh.visible, false, 'An empty bird pool must not enter the color pass.');
    const proxy = f.proxy(pool);
    assert.equal(proxy.visible, false, 'An empty bird proxy must not enter a shadow pass.');
    assert.equal(proxy.geometry, pool.geo); assert.equal(proxy.material.uniforms, pool.mesh.material.uniforms);
    assert.equal(proxy.material.vertexShader, 'bird vertex true');
    assert.equal(pool.mesh.parent, f.scene); assert.equal(pool.mesh.userData.keep, true);
  }
  assert.deepEqual(f.shadows(), []);
  assert.equal(f.generic().mesh.visible, true, 'Generic/human crowd initialization must remain unchanged.');
});

for (const kind of ['pheasant', 'duck']) for (const detail of [0, 1]) {
  test(`${kind} detail ${detail}: committed empty → populated → empty counts own color and shadow visibility`, () => {
    const f = fixture(), pool = f.pools[kind][detail], proxy = f.proxy(pool);
    pool.begin(); pool.push([1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]);
    assert.equal(pool.mesh.visible, false, 'A pending CPU row is not yet a committed instance.');
    pool.end();
    assert.equal(pool.n, 1); assert.equal(pool.geo.instanceCount, 1); assert.equal(pool.mesh.visible, true);
    assert.deepEqual(Array.from(pool.attrs[0].array.slice(0, 4)), [1, 2, 3, 4]);
    for (const attribute of pool.attrs) assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 4 }]);
    assert.deepEqual(f.shadows(), [proxy.id]); assert.equal(proxy.visible, true);
    pool.begin(); pool.end();
    assert.equal(pool.n, 0); assert.equal(pool.geo.instanceCount, 0); assert.equal(pool.mesh.visible, false);
    for (const attribute of pool.attrs) assert.deepEqual(attribute.updateRanges, []);
    assert.deepEqual(f.shadows(), []); assert.equal(proxy.visible, false);
  });
}

for (const [quality, threshold] of [['high', 30], ['medium', 22], ['low', 15]]) for (const kind of ['pheasant', 'duck']) {
  test(`${kind} uses existing ${quality} near/far selection, then clears both render and shadow pools offscreen`, () => {
    const f = fixture(), [near, far] = f.pools[kind], entity = bird(kind, threshold - 0.01);
    f.context.quality.level = quality;
    f.draw([entity]);
    assert.equal(near.n, 1); assert.equal(far.n, 0);
    assert.equal(near.mesh.visible, true); assert.equal(far.mesh.visible, false);
    assert.deepEqual(f.shadows(), [f.proxy(near).id]);
    entity.z = threshold + 0.01; f.draw([entity]);
    assert.equal(near.n, 0); assert.equal(far.n, 1);
    assert.equal(near.mesh.visible, false); assert.equal(far.mesh.visible, true);
    assert.deepEqual(f.shadows(), [f.proxy(far).id]);
    f.view(false); f.draw([entity]);
    assert.equal(near.n + far.n, 0);
    assert.equal(near.mesh.visible || far.mesh.visible, false); assert.deepEqual(f.shadows(), []);
    f.view(); entity.removed = true; f.draw([entity]);
    assert.equal(near.n + far.n, 0); assert.deepEqual(f.shadows(), []);
  });
}

test('near-pool capacity still spills birds into the far pool before both pools clear', () => {
  const f = fixture(), [near, far] = f.pools.pheasant;
  f.draw(Array.from({ length: near.max + 1 }, (_, id) => bird('pheasant', 10, id + 1)));
  assert.equal(near.n, 24); assert.equal(far.n, 1);
  assert.equal(near.mesh.visible && far.mesh.visible, true);
  assert.deepEqual(f.shadows(), [f.proxy(near).id, f.proxy(far).id]);
  f.draw([]);
  assert.equal(near.n + far.n, 0); assert.deepEqual(f.shadows(), []);
});

test('birds remain visible with shadows disabled and acquire matching shadows when the pass resumes', () => {
  const f = fixture(), pool = f.pools.duck[0], target = f.context.SHADOW.rt;
  f.context.quality.level = 'low'; f.context.SHADOW.rt = null;
  f.draw([bird('duck', 10)]); f.context.renderShadowPass(0, 0, 0);
  assert.equal(pool.geo.instanceCount, 1); assert.equal(pool.mesh.visible, true);
  assert.equal(f.proxy(pool).visible, false);
  f.context.SHADOW.rt = target;
  assert.deepEqual(f.shadows(), [f.proxy(pool).id]);
  f.draw([]); assert.deepEqual(f.shadows(), []);
});
