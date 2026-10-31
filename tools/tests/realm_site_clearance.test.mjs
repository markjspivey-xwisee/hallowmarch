import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/10p_realm_sites.js', import.meta.url), 'utf8');
function fixture() {
  let clock = 0, terrain = () => 2, water = () => null, walk = () => true, garden = () => null, reads = 0;
  const colliders = [], scope = vm.createContext({
    REALMS: [{ yaw: -5 * Math.PI / 6 }, { yaw: Math.PI / 2 }, { yaw: -Math.PI / 6 }], HALF: 512, WATER_Y: -3.2,
    performance: { now: () => clock }, A2FL: { ground: 0 }, COLL: { boxes: [], circles: [] }, W: { roads: [], rocks: [], trees: [] },
    heightAt: (x, z) => { reads++; return terrain(x, z); }, waterAt: (x, z) => water(x, z),
    isWalkable: (x, z) => walk(x, z), plotAt: (x, z, pad) => garden(x, z, pad),
    collidersNear: () => colliders,
    collCovers: (b, x, z, r) => b.type === 'circle' ? Math.hypot(x - b.x, z - b.z) < b.r + r
      : Math.abs((x - b.x) * Math.cos(b.yaw) - (z - b.z) * Math.sin(b.yaw)) < b.hx + r
        && Math.abs((x - b.x) * Math.sin(b.yaw) + (z - b.z) * Math.cos(b.yaw)) < b.hz + r,
    segDist2: (x, z, ax, az, bx, bz) => {
      const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
    },
  });
  vm.runInContext(source + '\nthis.inspectSite=realmRtsSiteStatus;this.groundSite=realmRtsSiteGround;this.frameSite=realmRtsSiteFrame;this.cache=REALM_RTS_SITE_CACHE;this.groundCache=REALM_RTS_GROUND_CACHE;', scope);
  const plot = { id: 'town:1:15', x: 30, z: 20, home: 1, owner: 1, placementAvailable: true };
  return { scope, plot, colliders, status: (p = plot) => scope.inspectSite(p), ground: (p = plot) => scope.groundSite(p),
    terrain(fn) { terrain = fn; scope.A2FL.ground++; }, water(fn) { water = fn; clock += 500; },
    walk(fn) { walk = fn; clock += 500; }, garden(fn) { garden = fn; clock += 500; },
    tick() { clock += 500; }, reads: () => reads };
}

test('home orientation stays fixed across capture and ground bounds cover the full rotated site', () => {
  const f = fixture(); f.terrain((x, z) => 2 + 0.03 * x - 0.02 * z);
  const before = f.ground(); f.plot.owner = 2; f.plot.yaw = -Math.PI / 6;
  assert.equal(f.scope.frameSite(f.plot).yaw, Math.PI / 2);
  assert.equal(f.ground().min, before.min); assert.equal(f.ground().max, before.max);
  assert.ok(Math.abs(before.min - (2 + 0.03 * 24 - 0.02 * 26)) < 1e-10);
  assert.ok(Math.abs(before.max - (2 + 0.03 * 36 - 0.02 * 14)) < 1e-10);
  assert.ok(before.bottom < before.min); assert.ok(before.top > before.max);
});

test('an interior stream is refused even when all corners are dry and ice makes it walkable', () => {
  const f = fixture(); f.water((x, z) => Math.abs(x - 30) < 0.3 && Math.abs(z - 20) < 5 ? { depth: 0.1 } : null);
  assert.equal(f.status().eligible, false); assert.match(f.status().reason, /dry ground/);
  assert.equal(f.scope.W.rocks.length, 0, 'reading never edits nature');
});

test('a central bump, steep edge and non-finite ground each prevent construction', () => {
  const f = fixture();
  f.terrain((x, z) => Math.abs(x - 30) < 0.2 && Math.abs(z - 20) < 0.2 ? 4 : 2);
  assert.equal(f.status().eligible, false);
  f.terrain((x) => 2 + 0.4 * x); assert.equal(f.status().eligible, false);
  f.terrain((x, z) => x === 30 && z === 20 ? NaN : 2); assert.equal(f.status().eligible, false);
});

test('full-footprint clearance catches thin walls, small rocks, gardens and roads', () => {
  const f = fixture();
  f.colliders.push({ type: 'box', x: 30.4, z: 20, hx: 0.02, hz: 10, yaw: 0, active: true });
  assert.match(f.status().reason, /obstacle/);
  f.colliders.length = 0; f.tick(); f.scope.W.rocks.push({ x: 31.3, z: 22.2, s: 0.3 });
  assert.match(f.status().reason, /obstacle/);
  f.scope.W.rocks.length = 0; f.garden((x, z) => Math.abs(x - 28) < 1 && Math.abs(z - 18) < 1 ? {} : null);
  assert.match(f.status().reason, /garden/);
  f.garden(() => null); f.scope.W.roads.push({ ax: 29.4, az: 0, bx: 29.4, bz: 60, w: 1 }); f.tick();
  assert.match(f.status().reason, /road/);
});

test('tree crowns extending beyond a clear trunk still block the future roof without felling nature', () => {
  const f = fixture(), tree = { x: 38, z: 20, s: 1, kind: 'oak', felled: false };
  f.scope.W.trees.push(tree); assert.match(f.status().reason, /obstacle/);
  assert.equal(tree.felled, false);
  tree.felled = true; f.tick(); assert.equal(f.status().eligible, true, 'fallen logs are handled by their real colliders');
});

test('occupied and unverified sites fail closed while clear sites are available without state changes', () => {
  const f = fixture(), saved = JSON.stringify(f.plot);
  assert.equal(f.status().eligible, true); assert.equal(JSON.stringify(f.plot), saved);
  assert.equal(f.status({ ...f.plot, buildingId: 'b:town:1:15' }).eligible, false);
  assert.equal(f.status({ ...f.plot, placementAvailable: false }).eligible, false);
  assert.equal(f.status({ ...f.plot, x: 505 }).eligible, false);
});

test('ground edits invalidate cached bounds and clearance; steady queries reuse bounded caches', () => {
  const f = fixture(); f.ground(); f.status(); const reads = f.reads();
  f.ground(); f.status(); assert.equal(f.reads(), reads);
  f.terrain(() => 3); assert.equal(f.ground().min, 3); assert.equal(f.status().eligible, true);
  for (let i = 0; i < 500; i++) { const plot = { ...f.plot, id: 'test:' + i }; f.status(plot); f.ground(plot); }
  assert.ok(f.scope.cache.size <= 72); assert.ok(f.scope.groundCache.size <= 144);
});

test('foundation bounds include rendered triangle peaks and hollows between the regular ground samples', () => {
  const f = fixture();
  const geometry = { attributes: { position: { array: new Float32Array([30.35, 8, 20.45, 35.8, 0.2, 24.9, 24.3, 1.5, 15.2]) } }, index: { array: new Uint16Array([0, 1, 2]) } };
  f.scope.LOD = { built: true, terrain: [] }; f.scope.LOD.terrain[36] = { gs: [geometry] };
  const bounds = f.ground();
  assert.ok(bounds.top >= 8.05, 'a sub-sample rendered peak must not penetrate the foundation');
  assert.ok(bounds.bottom < 0.2, 'a sub-sample hollow must not leave a floating foundation edge');
  geometry.attributes.position.array[1] = 12; f.scope.A2FL.ground++;
  assert.ok(f.ground().top >= 12.05, 'ground revisions read updated geometry through the same spatial index');
});
