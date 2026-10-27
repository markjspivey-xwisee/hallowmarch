import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const mainSource = read('src/13_main.js'), lodSource = read('src/13q_lod.js');
function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const end = source.indexOf('\n}', start);
  assert.ok(end >= start, name + ' closes');
  return source.slice(start, end + 2);
}
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
}
class Pool {
  constructor(max) { this.max = max; this.n = 0; this.rows = []; }
  begin() { this.n = 0; this.rows = []; }
  push(...values) {
    if (this.n >= this.max) return;
    this.rows.push(values.map(value => Array.from(value))); this.n++;
  }
  end() {}
}
function human(id, extra = {}) {
  return { id, kind: 'humanoid', role: 'soldier', alive: true, x: 0, y: 0, z: 69, yaw: 0, scale: 1,
    anim: { phase: 0.25, turn: 0, amt: 0.5, death: 0, act: 0, actDur: 0, flash: 0 },
    look: { tabard: [0.3, 0.6, 0.8], armor: [0.5, 0.5, 0.5], skin: 0, hair: 0, mask: 0 },
    ...extra };
}
// Perspective sphere clipping for the command camera's real 62-degree pitch.
// This leaves actors beyond the old 175m disk inside the actual view.
function cameraFrustum(camera, sphere) {
  const pitch = 62 * Math.PI / 180, sine = Math.sin(pitch), cosine = Math.cos(pitch);
  const x = sphere.center.x - camera.position.x, y = sphere.center.y - camera.position.y;
  const z = sphere.center.z - camera.position.z, depth = -y * sine - z * cosine, up = y * cosine - z * sine;
  const vertical = Math.tan(camera.fov * Math.PI / 360), horizontal = vertical * camera.aspect, r = sphere.radius;
  return depth + r >= camera.near && depth - r <= camera.far
    && Math.abs(x) <= depth * horizontal + r * Math.hypot(1, horizontal)
    && Math.abs(up) <= depth * vertical + r * Math.hypot(1, vertical);
}
function renderFixture({ source = mainSource, active = true, level = 'high', entities = [], visible } = {}) {
  const people = [new Pool(72), new Pool(380), new Pool(320)];
  const beasts = { horse: [new Pool(16), new Pool(40)], wolf: [new Pool(32), new Pool(80)] };
  const camera = { position: { x: 0, y: 160, z: 84 }, near: 0.1, far: 900, fov: 55, aspect: 16 / 9 };
  const context = vm.createContext({
    crowdHuman: people[0], crowdHumanLo: people[1], crowdHumanFar: people[2], crowdBeast: beasts,
    camera, THRONE_RTS: { active, distance: 180 }, ENT: entities, quality: { level },
    HUMAN_LOD: { high: 30, medium: 22, low: 15 }, HUMAN_FAR: { high: 90, medium: 60, low: 38 },
    GAME: { t: 100, player: null }, TRAIL_CAND: [], trailSegs: [], TRAIL: { maxSegs: 0 },
    STAMP_R: { humanoid: 0.55, horse: 0.8, wolf: 0.6 }, SHADOW: { rt: null }, SHADOW_R: { humanoid: 0.5 },
    _sph: { center: new Vec3(), radius: 0 }, _p4: [], _a4: [], _ca: [], _cb: [], _mi: [], _st: [], _we: [],
    _ma: [], _hc: [], _hb: [], WB: {}, WEAPON_BITS: 0, HORSE_SEAT: 1.6,
    frustum: { intersectsSphere: sphere => visible ? visible(sphere) : cameraFrustum(camera, sphere) },
    netEntityVisible: entity => !entity.netHidden, netNpcVisible: entity => !entity.npcHidden,
    footLockBegin() {}, footLockEnd() {}, footLockSlot: () => 0, animActValue: () => 0,
    waterAnimPack() {}, wearVisual() {}, humanSlopeYaw: entity => entity.yaw,
    beastLeanYaw: entity => entity.yaw, beastWx: () => 0, late3BardCode: () => 0,
    dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
  });
  vm.runInContext(extract(source, 'drawActors') + '\nthis.renderActors = drawActors;', context);
  return {
    context, camera, people, beasts,
    draw() { context.renderActors(10000, 10000); return people.map(pool => pool.n); },
    snapshot() { return people.map(pool => pool.rows); },
  };
}
function lodFixture(source = lodSource) {
  let fills = 0;
  const camera = { position: { x: 0, y: 20, z: 0 }, fov: 55, aspect: 16 / 9,
    projectionMatrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
  const context = vm.createContext({
    GAME: { built: true }, LOD: { built: true, terrain: [], blocks: [], trees: [], stats: { terrain: [], trees: [] } },
    camera, quality: { level: 'medium' }, THREE: { Vector3: Vec3 }, _tbF: new Vec3(),
    U: { uNearTree: { value: { x: 0, y: 0, z: 0 } } }, SHADOW: { rt: null },
    TERRAIN_LOD_D: { medium: [90, 230] }, TREE_LOD_D: { medium: 80 },
    TREE_FAR2_D: { medium: 200 }, TREE_SPLIT_D: { medium: 60 },
    lodRocks() {}, lodFar() {}, treeBandsFill() { fills++; },
  });
  vm.runInContext(extract(source, 'updateLod') + '\nthis.refresh = updateLod;', context);
  return { camera, refresh: () => context.refresh(), fills: () => fills };
}

test('command camera draws in-frustum soldiers beyond the play camera disk', () => {
  const entities = [human(1, { x: 150, z: -125 })];
  const rts = renderFixture({ entities }); const normal = renderFixture({ entities, active: false });
  assert.ok(Math.hypot(150, -125 - rts.camera.position.z) > 175);
  assert.equal(cameraFrustum(rts.camera, { center: new Vec3(150, 1, -125), radius: 2.4 }), true);
  assert.deepEqual(rts.draw(), [0, 0, 1]);
  assert.deepEqual(normal.draw(), [0, 0, 0]);
});
test('command camera altitude selects distant models at every quality', () => {
  for (const level of ['high', 'medium', 'low']) {
    const rts = renderFixture({ level, entities: [human(1)] });
    const normal = renderFixture({ level, entities: [human(1)], active: false });
    assert.deepEqual(rts.draw(), [0, 0, 1], level);
    assert.deepEqual(normal.draw(), level === 'low' ? [0, 1, 0] : [1, 0, 0], level);
  }
});
test('command camera uses every existing human pool before dropping bodies', () => {
  for (const [count, expected] of [[321, [0, 1, 320]], [720, [20, 380, 320]], [773, [72, 380, 320]]]) {
    const fixture = renderFixture({ entities: Array.from({ length: count }, (_, i) => human(i + 1, { yaw: i / 1000 })) });
    assert.deepEqual(fixture.draw(), expected);
    assert.deepEqual(fixture.people.map(pool => pool.max), [72, 380, 320]);
    assert.equal(fixture.snapshot().flat().length, Math.min(count, 772));
  }
});
test('command camera preserves scene admission and frustum exclusions', () => {
  const fixture = renderFixture({ entities: [
    human(1, { x: 1 }), human(2, { removed: true }), human(3, { netHidden: true }),
    human(4, { npcHidden: true }), human(5, { capHide: true }), human(6, { x: 6 }),
  ], visible: sphere => sphere.center.x !== 6 });
  assert.deepEqual(fixture.draw(), [0, 0, 1]);
  assert.equal(fixture.people[2].rows[0][0][0], 1);
});
test('command camera keeps enemy scouting while normal play visibility stays unchanged', () => {
  const entities = [human(1, { x: 1, warband: { id: 1, realm: 0 } }),
    human(2, { x: 2, warband: { id: 2, realm: 1, spotted: false } }),
    human(3, { x: 3, warband: { id: 3, realm: 1, spotted: true } })];
  const check = active => {
    const fixture = renderFixture({ active, entities }), checked = [];
    fixture.context.GAME.player = { faction: 0 };
    fixture.context.cwSpotted = (band, player) => { assert.equal(player.faction, 0); checked.push(band.id); return band.spotted; };
    const counts = fixture.draw();
    return { fixture, checked, counts };
  };
  const rts = check(true), normal = check(false);
  assert.deepEqual(rts.counts, [0, 0, 2]);
  assert.deepEqual(rts.checked, [2, 3]);
  assert.deepEqual(rts.fixture.people[2].rows.map(row => row[0][0]), [1, 3]);
  assert.deepEqual(normal.counts, [3, 0, 0]); assert.deepEqual(normal.checked, []);
});
test('normal play keeps its horizontal detail thresholds regardless of altitude', () => {
  const make = () => [0, 29.999, 30, 90, 90.001, 175, 175.001].map((x, i) => human(i + 1, { x, z: 0 }));
  const ground = renderFixture({ active: false, entities: make(), visible: () => true });
  const high = renderFixture({ active: false, entities: make(), visible: () => true });
  ground.camera.position.y = 2; ground.camera.position.z = high.camera.position.z = 0;
  assert.deepEqual(ground.draw(), [2, 2, 2]); assert.deepEqual(high.draw(), [2, 2, 2]);
  assert.deepEqual(high.snapshot(), ground.snapshot());
});
test('command camera reuses near mount and beast capacity after distant pools fill', () => {
  const mounted = Array.from({ length: 50 }, (_, i) => human(i + 1, {
    mount: { coat: [0.2, 0.3, 0.4], cloth: [0.3, 0.4, 0.5] }, mountAnim: { phase: 0.2, amt: 0.5 },
  }));
  const horses = renderFixture({ entities: mounted }); horses.draw();
  assert.deepEqual(horses.beasts.horse.map(pool => pool.n), [10, 40]);
  const wolves = renderFixture({ entities: Array.from({ length: 100 }, (_, i) => human(i + 1, {
    kind: 'wolf', look: { colA: [0.2, 0.2, 0.2], colB: [0.4, 0.4, 0.4] },
  })) }); wolves.draw();
  assert.deepEqual(wolves.beasts.wolf.map(pool => pool.n), [20, 80]);
});
test('frustum-filtered tree bands refresh after altitude and projection changes', () => {
  const fixture = lodFixture(); fixture.refresh(); assert.equal(fixture.fills(), 1);
  fixture.refresh(); assert.equal(fixture.fills(), 1);
  fixture.camera.position.y += 0.5; fixture.refresh(); assert.equal(fixture.fills(), 1);
  fixture.camera.position.y += 0.51; fixture.refresh(); assert.equal(fixture.fills(), 2);
  fixture.camera.fov += 0.01; fixture.refresh(); assert.equal(fixture.fills(), 3);
  fixture.camera.aspect += 0.01; fixture.refresh(); assert.equal(fixture.fills(), 4);
  fixture.refresh(); assert.equal(fixture.fills(), 4);
  fixture.camera.projectionMatrix.elements[8] = 0.2; fixture.refresh(); assert.equal(fixture.fills(), 5);
  fixture.camera.projectionMatrix.elements[9] = -0.1; fixture.refresh(); assert.equal(fixture.fills(), 6);
  fixture.refresh(); assert.equal(fixture.fills(), 6);
});
