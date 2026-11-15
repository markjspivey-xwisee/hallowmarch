import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { parse } from 'acorn';

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
const declarations = (source, names) => parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
  .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)
    || node.type === 'VariableDeclaration' && node.declarations.some(decl => names.includes(decl.id.name)))
  .map(node => source.slice(node.start, node.end)).join('\n');

function nestFixture() {
  const scene = new THREE.Scene(), context = vm.createContext({ THREE, scene,
    DEPTH: { ready: true, nests: [], fx: null }, INDOOR: { on: false }, camera: { position: new THREE.Vector3() },
    mat: options => new THREE.ShaderMaterial(options),
    GLSL_COMMON: '', GLSL_ATMOS: '', GLSL_SHADOW: '', GLSL_PLIGHT: '', GLSL_LIGHT: '',
  });
  vm.runInContext(declarations(depth, ['DP_EGG_FS', 'dpBuildNestFX', 'drawDepth']) + '\n'
    + declarations(read('00_util.js'), ['dist2']) + '\n' + declarations(read('05c_beasts.js'), ['fhash']), context);
  const visible = () => { const found = []; scene.traverseVisible(object => { if (object.isMesh) found.push(object); }); return found; };
  return { context, scene, visible };
}

test('nest marker meshes begin empty and invisible, then follow nearby populated counts without replacing resources', () => {
  const f = nestFixture(), c = f.context; c.dpBuildNestFX();
  const { eggs, rings } = c.DEPTH.fx, geometry = eggs.geometry, material = eggs.material;
  assert.equal(eggs.count, 0); assert.equal(rings.count, 0); assert.deepEqual(f.visible(), []);
  assert.equal(eggs.parent, f.scene); assert.equal(rings.parent, f.scene);
  c.drawDepth(0); assert.deepEqual(f.visible(), []);
  c.DEPTH.nests = [{ x: 10, y: 2, z: 20, eggs: 2, seed: .3 }];
  c.drawDepth(0); assert.equal(eggs.count, 2); assert.equal(rings.count, 1); assert.deepEqual(f.visible(), [eggs, rings]);
  const matrices = Array.from(eggs.instanceMatrix.array), colors = Array.from(eggs.instanceColor.array);
  c.camera.position.set(1000, 0, 1000); c.drawDepth(0);
  assert.equal(eggs.count, 0); assert.equal(rings.count, 0); assert.deepEqual(f.visible(), []);
  c.camera.position.set(0, 0, 0); c.drawDepth(0);
  assert.deepEqual(f.visible(), [eggs, rings]); assert.deepEqual(Array.from(eggs.instanceMatrix.array), matrices);
  assert.deepEqual(Array.from(eggs.instanceColor.array), colors); assert.equal(eggs.geometry, geometry); assert.equal(eggs.material, material);
  c.INDOOR.on = true; c.drawDepth(0); assert.deepEqual(f.visible(), []);
  c.INDOOR.on = false; c.drawDepth(0); assert.deepEqual(f.visible(), [eggs, rings]);
  c.DEPTH.nests[0].eggs = 0; c.drawDepth(0);
  assert.equal(eggs.count, 0); assert.equal(rings.count, 1); assert.deepEqual(f.visible(), [rings]);
  c.DEPTH.nests = []; c.drawDepth(0); assert.deepEqual(f.visible(), []);
});

test('nest readiness and original twelve-ring/sixty-egg limits remain intact', () => {
  const f = nestFixture(), c = f.context; c.DEPTH.ready = false; c.drawDepth(0);
  assert.equal(c.DEPTH.fx, null); assert.equal(f.scene.children.length, 0);
  c.DEPTH.ready = true;
  c.DEPTH.nests = Array.from({ length: 20 }, (_, seed) => ({ x: 1, y: 2, z: 3, eggs: 10, seed }));
  c.drawDepth(0); assert.equal(c.DEPTH.fx.eggs.count, 60); assert.equal(c.DEPTH.fx.rings.count, 12);
  assert.deepEqual(f.visible(), [c.DEPTH.fx.eggs, c.DEPTH.fx.rings]);
});

test('egg matrices stay inside their own nests while their tilt uses a separate axis scratch vector', () => {
  const f = nestFixture(), c = f.context;
  c.DEPTH.nests = [{ x: 10, y: 2, z: 20, eggs: 3, seed: .3 }, { x: -8, y: 3, z: 14, eggs: 2, seed: .8 }];
  c.dpBuildNestFX();
  vm.runInContext('Math.random=()=>{throw Error("Drawing nests must not consume randomness");};', c);
  c.drawDepth(0);
  const F = c.DEPTH.fx;
  assert.notEqual(F.axis, F.v); assert.notEqual(F.axis, F.s);
  assert.equal(F.eggs.count, 5); assert.equal(F.rings.count, 2);
  const actual = new THREE.Matrix4(); let index = 0;
  for (const nest of c.DEPTH.nests) for (let k = 0; k < nest.eggs; k++) {
    const angle = k * 2.3 + nest.seed * 6, radius = k ? .05 + .02 * (k % 2) : 0;
    const position = new THREE.Vector3(nest.x + Math.sin(angle) * radius, nest.y + .06, nest.z + Math.cos(angle) * radius);
    const axis = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle)).normalize();
    const expected = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromAxisAngle(axis, 1.2), new THREE.Vector3(1, 1, 1));
    F.eggs.getMatrixAt(index++, actual);
    assert.deepEqual(actual.elements, Array.from(new Float32Array(expected.elements)), 'The complete instance transform has its original tilt and nest-relative position.');
  }
});

function precipitationFixture(level) {
  const scene = new THREE.Scene(), context = vm.createContext({ THREE, scene, quality: { level },
    camera: { position: new THREE.Vector3() }, INDOOR: { on: false }, GAME: { player: null }, WX: { coldK: 0 },
    U: { uWet: { value: 0 }, uSnowCover: { value: 0 }, uRain: { value: 0 } },
    mat: options => new THREE.ShaderMaterial(options),
    GLSL_COMMON: '', GLSL_WORLD: '', GLSL_ROOFS: '', GLSL_SHELTER: '', GLSL_ATMOS: '',
    live: false, peak: 0, _wxCamW: {}, _wxCamLook: [],
    weatherAt: () => ({ kind: 'rain', overcast: 1, fog: 1, raining: 0, storm: 0, mist: 0 }),
    wxGridAt: () => 0, weatherDryRate: () => 1, weatherMeltRate: () => 1,
  });
  context.wxLive = () => context.live; context.wxPrecipBox = () => context.peak;
  vm.runInContext(declarations(read('05e_weather.js'), ['WEATHER', 'WEATHER_LOOK', 'rainMesh', 'RAIN_MAX', 'precipGeometry', 'PRECIP_COMMON', 'buildWeather', 'updateWeather'])
    + '\n' + declarations(read('00_util.js'), ['mulberry', 'clamp'])
    + '\n' + declarations(read('12c_weather2.js'), ['wxLabelOf'])
    + '\nbuildWeather(); globalThis.precipitation={rain:rainMesh,snow:snowMesh,weather:WEATHER};', context);
  const { rain, snow, weather } = context.precipitation;
  Object.assign(weather, { mode: 'auto', kind: 'rain', next: 1e9, raining: 1 });
  return { context, scene, rain, snow };
}

for (const [level, rainCount, snowCount] of [['high', 9000, 6500], ['medium', 5400, 3900], ['low', 2880, 2275]]) {
  test('ordinary ' + level + ' precipitation updates hide zero groups and restore rain/snow without changing title visibility or counts', () => {
    const f = precipitationFixture(level), c = f.context, rainGeometry = f.rain.geometry, snowGeometry = f.snow.geometry;
    // The frozen title inventory still encounters both original materials.
    assert.equal(f.rain.geometry.instanceCount, 0); assert.equal(f.snow.geometry.instanceCount, 0);
    assert.equal(f.rain.visible, true); assert.equal(f.snow.visible, true);
    c.updateWeather(0); assert.equal(f.rain.geometry.instanceCount, rainCount); assert.equal(f.rain.visible, true);
    assert.equal(f.snow.geometry.instanceCount, 0); assert.equal(f.snow.visible, false);
    c.WX.coldK = 1; c.updateWeather(0);
    assert.equal(f.rain.geometry.instanceCount, 0); assert.equal(f.rain.visible, false);
    assert.equal(f.snow.geometry.instanceCount, snowCount); assert.equal(f.snow.visible, true);
    c.INDOOR.on = true; c.updateWeather(0);
    assert.equal(f.rain.geometry.instanceCount, 0); assert.equal(f.snow.geometry.instanceCount, 0);
    assert.equal(f.rain.visible || f.snow.visible, false);
    c.INDOOR.on = false; c.updateWeather(0); assert.equal(f.snow.visible, true);
    c.precipitation.weather.raining = 0; c.updateWeather(0); assert.equal(f.rain.visible || f.snow.visible, false);
    assert.equal(f.rain.geometry, rainGeometry); assert.equal(f.snow.geometry, snowGeometry);
  });
}

test('live cloud-edge precipitation still appears from the box peak and disappears indoors or at zero density', () => {
  const f = precipitationFixture('medium'), c = f.context;
  c.live = true; c.peak = .4; c.precipitation.weather.raining = 0;
  c.updateWeather(0); assert.equal(f.rain.geometry.instanceCount, Math.round(9000 * .6 * .4 * 1.2)); assert.equal(f.rain.visible, true);
  c.WX.coldK = 1; c.updateWeather(0); assert.equal(f.snow.geometry.instanceCount, Math.round(6500 * .6 * .4 * 1.2)); assert.equal(f.snow.visible, true);
  c.INDOOR.on = true; c.updateWeather(0); assert.equal(f.rain.visible || f.snow.visible, false);
  c.INDOOR.on = false; c.peak = 0; c.updateWeather(0); assert.equal(f.rain.visible || f.snow.visible, false);
});

function seasonalLeavesFixture(level) {
  const scene = new THREE.Scene(), uniform = value => ({ value });
  const U = { uSeasonA: uniform(new THREE.Vector4()), uSeasonB: uniform(new THREE.Vector4()),
    uSeasonC: uniform(new THREE.Vector4()), uSeasonD: uniform(new THREE.Vector4()),
    uSnowK: uniform(new THREE.Vector2()), uSnowCover: uniform(0), uNight: uniform(0),
    uLightColor: uniform(new THREE.Vector3(1, 1, 1)), uAmbient: uniform(new THREE.Vector3(.3, .3, .3)) };
  const context = vm.createContext({ THREE, scene, U, quality: { level },
    SEAS: { inited: true, lieView: 0, dirty: false, tex: null }, SEASON: { k: .125, temp: 12, t: 100, yearSec: 6000 },
    INDOOR: { on: false }, WEATHER: { raining: 0, overcast: 0, snow: 0 }, GAME: { player: null },
    camera: { position: new THREE.Vector3() }, composite: { uniforms: { uGrade: uniform(new THREE.Vector4(1, 1, 1, 1)) } },
    mat: options => new THREE.ShaderMaterial(options), seasonsInit() {}, seasonSnowLieAt: () => 0, wxLive: () => false,
    GLSL_COMMON: '', GLSL_WORLD: '', GLSL_ATMOS: '',
  });
  vm.runInContext(declarations(read('05k_seasons.js'), ['SEASON_LEAVES_MAX', 'seasonParticleGeo', 'buildSeasonFx', 'seasonCurves', 'seasonAirNow', 'seasonsFrame'])
    + '\n' + declarations(read('00_util.js'), ['mulberry', 'clamp', 'sstep']) + '\nbuildSeasonFx();', context);
  return { context, scene, leaves: context.SEAS.leaves };
}

for (const [level, count] of [['high', 900], ['medium', 540], ['low', 315]]) {
  test('seasonal leaves ' + level + ' begin hidden and track autumn → clear → autumn and indoor counts without advancing time or RNG', () => {
    const f = seasonalLeavesFixture(level), c = f.context, leaves = f.leaves, geometry = leaves.geometry, material = leaves.material;
    assert.equal(leaves.geometry.instanceCount, 0); assert.equal(leaves.visible, false); assert.equal(leaves.parent, f.scene);
    const seeds = Array.from(geometry.attributes.aSeed.array), at = c.SEASON.t;
    vm.runInContext('Math.random=()=>{throw Error("Drawing seasonal leaves must not consume randomness");};', c);
    c.SEASON.k = .7; c.seasonsFrame(.016);
    assert.equal(leaves.geometry.instanceCount, count); assert.equal(leaves.visible, true); assert.equal(material.uniforms.uAmount.value, 1);
    for (const k of [.1, .4, .95]) {
      c.SEASON.k = k; c.seasonsFrame(.016);
      assert.equal(leaves.geometry.instanceCount, 0); assert.equal(leaves.visible, false); assert.equal(material.uniforms.uAmount.value, 0);
    }
    c.SEASON.k = .7; c.seasonsFrame(.016); assert.equal(leaves.geometry.instanceCount, count); assert.equal(leaves.visible, true);
    c.INDOOR.on = true; c.seasonsFrame(.016); assert.equal(leaves.geometry.instanceCount, 0); assert.equal(leaves.visible, false);
    c.INDOOR.on = false; c.seasonsFrame(.016); assert.equal(leaves.geometry.instanceCount, count); assert.equal(leaves.visible, true);
    assert.equal(leaves.geometry, geometry); assert.equal(leaves.material, material); assert.equal(c.SEASON.t, at);
    assert.deepEqual(Array.from(geometry.attributes.aSeed.array), seeds); assert.equal(c.SEAS.hole.visible, false);
  });
}

function shadowSubmissionFixture(source) {
  const scene = new THREE.Scene(), parent = new THREE.Group();
  scene.add(parent); parent.add(source); scene.updateMatrixWorld(true);
  const proxy = new THREE.Mesh(source.geometry, new THREE.MeshBasicMaterial());
  proxy.userData.src = source;
  const shadow = { rt: {}, scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(), proxies: [proxy] };
  shadow.scene.add(proxy);
  const draws = [], calls = [];
  const context = vm.createContext({ scene, SHADOW: shadow,
    updateShadowCamera(...args) { calls.push(['camera', ...args]); },
    renderer: {
      setRenderTarget(target) { calls.push(['target', target]); },
      clear(...args) { calls.push(['clear', ...args]); },
      render(target, camera) {
        assert.equal(target, shadow.scene); assert.equal(camera, shadow.cam);
        const visible = []; target.traverseVisible(object => { if (object.isMesh) visible.push(object); });
        draws.push(visible); calls.push(['render']);
      },
    },
  });
  const code = parse(render, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .filter(node => node.type === 'FunctionDeclaration' && ['liveIn', 'renderShadowPass'].includes(node.id.name))
    .map(node => render.slice(node.start, node.end)).join('\n');
  vm.runInContext(code, context);
  return { parent, scene, proxy, shadow, calls,
    pass() { context.renderShadowPass(1, 2, 3); return draws.at(-1); },
  };
}

test('an intentional empty LOD shadow stand-in stays empty while the source keeps populated geometry', () => {
  const sourceGeometry = new THREE.InstancedBufferGeometry(); sourceGeometry.instanceCount = 17;
  const source = new THREE.Mesh(sourceGeometry, new THREE.MeshBasicMaterial()), f = shadowSubmissionFixture(source);
  const empty = new THREE.InstancedBufferGeometry(); empty.instanceCount = 0;
  f.proxy.geometry = empty;
  assert.deepEqual(f.pass(), []); assert.equal(f.proxy.geometry, empty);
  assert.equal(source.geometry, sourceGeometry); assert.equal(sourceGeometry.instanceCount, 17); assert(source.visible);
  f.proxy.geometry = sourceGeometry; assert.deepEqual(f.pass(), [f.proxy]);
  f.proxy.geometry = empty; assert.deepEqual(f.pass(), []);
});

test('zero-count InstancedMesh shadow sources skip submission and resume after population', () => {
  const source = new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 3);
  source.position.set(3, 4, 5); source.count = 0;
  const f = shadowSubmissionFixture(source);
  assert.deepEqual(f.pass(), []); assert.equal(f.proxy.visible, false);
  assert.equal(source.visible, true); assert.equal(f.parent.visible, true);
  source.count = 2;
  assert.deepEqual(f.pass(), [f.proxy]); assert.equal(f.proxy.visible, true);
  assert.deepEqual(f.proxy.matrixWorld.elements, source.matrixWorld.elements);
  source.count = 0;
  assert.deepEqual(f.pass(), []);
});

test('zero-count InstancedBufferGeometry shadow sources skip submission but positive and default Infinity counts draw', () => {
  const geometry = new THREE.InstancedBufferGeometry();
  assert.equal(geometry.instanceCount, Infinity);
  const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()), f = shadowSubmissionFixture(source);
  assert.deepEqual(f.pass(), [f.proxy]);
  geometry.instanceCount = 0; assert.deepEqual(f.pass(), []);
  geometry.instanceCount = 1; assert.deepEqual(f.pass(), [f.proxy]);
  geometry.instanceCount = Infinity; assert.deepEqual(f.pass(), [f.proxy]);
  geometry.instanceCount = 0; assert.deepEqual(f.pass(), []);
  assert.equal(source.visible, true); assert.equal(geometry.instanceCount, 0);
});

test('static shadow casters ignore count-like fields and keep the original ancestry and render lifecycle', () => {
  const geometry = new THREE.BufferGeometry(); geometry.instanceCount = 0;
  const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); source.count = 0;
  const f = shadowSubmissionFixture(source);
  assert.deepEqual(f.pass(), [f.proxy]);
  assert.deepEqual(f.calls, [['camera', 1, 2, 3], ['target', f.shadow.rt], ['clear', false, true, false], ['render']]);
  f.parent.visible = false; assert.deepEqual(f.pass(), []);
  f.parent.visible = true; source.visible = false; assert.deepEqual(f.pass(), []);
  source.visible = true; f.parent.remove(source); assert.deepEqual(f.pass(), []);
  f.parent.add(source); assert.deepEqual(f.pass(), [f.proxy]);
});

test('either empty instancing layer excludes a source and a disabled shadow pass remains untouched', () => {
  const geometry = new THREE.InstancedBufferGeometry(); geometry.instanceCount = 0;
  const source = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2), f = shadowSubmissionFixture(source);
  assert.deepEqual(f.pass(), []);
  geometry.instanceCount = 2; assert.deepEqual(f.pass(), [f.proxy]);
  source.count = 0; assert.deepEqual(f.pass(), []);
  f.shadow.rt = null; const count = f.calls.length;
  f.pass(); assert.equal(f.calls.length, count);
});

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
