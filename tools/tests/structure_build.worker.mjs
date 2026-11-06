// One complete CPU world/scene per process keeps equivalence checks from retaining
// several geometry sets while testing. This file never creates a renderer.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { structureFixture } from './structure_build.fixture.mjs';
import { canonicalSignature } from './structure_canonical.mjs';

const [mode, seedText, sensitivity] = process.argv.slice(2), seed = Number(seedText);
assert(['prior', 'chunks', 'sync'].includes(mode)); assert(Number.isInteger(seed));
const f = structureFixture({ prior: mode === 'prior' });
f.api.buildWorld(seed);
let activeMs = 0, maxResumeMs = 0, steps = 0;
if (mode === 'chunks') {
  const iterator = f.api.buildStructuresChunks(); let state;
  do {
    const before = performance.now(); state = iterator.next(); const elapsed = performance.now() - before;
    activeMs += elapsed; maxResumeMs = Math.max(maxResumeMs, elapsed); steps++;
    if (!state.done) { assert.equal(f.context.GAME.built, false); await new Promise(resolve => setImmediate(resolve)); }
  } while (!state.done);
  assert.equal(state.value, undefined); assert(steps >= 30);
  assert.equal(iterator.next().done, true);
} else {
  const before = performance.now(); assert.equal(f.api.buildStructures(), undefined);
  activeMs = maxResumeMs = performance.now() - before; steps = 1;
}
assert.deepEqual(f.errors, []); assert.equal(f.api.CASTLES.length, 9);
assert(f.api.FLOOR.list.length > 1000); assert(f.scene.children.length > 150);
const signature = () => canonicalSignature(f.snapshot());
const receipt = () => { const value=f.snapshot();return {canonical:canonicalSignature(value),
  sections:Object.fromEntries(Object.entries(value).filter(([key])=>key!=='id').map(([key,value])=>[key,canonicalSignature(value)]))}; };
const {canonical,sections} = receipt(), domains = {};
if (sensitivity === 'sensitivity') {
  const mesh = f.api.SITE_MESHES.find(value => value.geometry.attributes.position?.count);
  const position = mesh.geometry.attributes.position, first = position.getX(0);
  position.setX(0, first + 0.125); domains.geometry = signature() !== canonical; position.setX(0, first);
  const side = mesh.material.side; mesh.material.side = side === 2 ? 0 : 2;
  domains.material = signature() !== canonical; mesh.material.side = side;
  const floor = f.api.FLOOR.list[0], height = floor.ya; floor.ya = height + 0.125;
  domains.semantic = signature() !== canonical; floor.ya = height;
  const stream = f.rng.find(value => value.values.length), random = stream.values[0]; stream.values[0] = random + 0.125;
  domains.rng = signature() !== canonical; stream.values[0] = random;
  assert.deepEqual(domains, { geometry: true, material: true, semantic: true, rng: true });
  assert.equal(signature(), canonical, 'restoring each domain must restore the complete signature');
}
console.log(JSON.stringify({ mode, seed, canonical, sections, domains, activeMs, maxResumeMs, steps,
  meshes: f.scene.children.length, sites: f.api.SITE_MESHES.length, castles: f.api.CASTLES.length,
  floors: f.api.FLOOR.list.length, houses: f.api.HOUSES.length,
  seededStreams: f.rng.length, seededCalls: f.rng.reduce((count, stream) => count + stream.values.length, 0),
  unseededCalls: f.unseeded.length }));
