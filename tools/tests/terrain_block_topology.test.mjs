/** Actual pinned Three CPU geometry equivalence; no renderer/browser/services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse, tokenizer } from 'acorn';
import * as OriginalTHREE from 'three';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const source = read('src/13q_lod.js'), world = read('src/01_world.js');
const prior = JSON.parse(read('tools/tests/fixtures/terrain_block_d49f076.json'));
const nodes = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
const declaration = name => { const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name
  || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  assert(node, name); return source.slice(node.start, node.end); };
const actual = ['lodTris', 'TERRAIN_BLOCK_TOPOLOGY', 'terrainBlockTopology', 'terrainBlockGeo'].map(declaration).join('\n');
const candidateSource = declaration('terrainBlockGeo'), numericSource = prior.numericSpan, tailSource = prior.constructorTail;
const digest = text => createHash('sha256').update(text).digest('hex');
const tokens = text => Array.from(tokenizer(text, { ecmaVersion: 'latest' }), token => [token.type.label, token.value]);
function makeBuilder(THREE, H, candidate = false) {
  return new Function('THREE', 'W', 'HN', 'HS', 'HALF', (candidate ? actual : prior.lodTris + '\n' + prior.terrainBlockGeo)
    + '\nreturn { build: terrainBlockGeo, replaceHeights: next => { W.H = next; }, cache: () => '
    + (candidate ? 'TERRAIN_BLOCK_TOPOLOGY' : 'null') + ' };')(THREE, { H }, 513, 2, 512);
}

function heights(seed = 7, kind = 'rough') {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const H = new Float32Array(513 * 513);
  for (let j = 0; j < 513; j++) for (let i = 0; i < 513; i++) {
    H[j * 513 + i] = kind === 'flat' ? 0 : kind === 'negative-zero' ? -0
      : kind === 'slope' ? i * 0.03125 - j * 0.0625
      : Math.sin(i * 0.037) * 17 + Math.cos(j * 0.029) * 11 + (next() - 0.5) * 4;
  }
  return H;
}

function crater(H, cx, cz, radius, depth) {
  for (let j = Math.max(0, cz - radius); j <= Math.min(512, cz + radius); j++)
    for (let i = Math.max(0, cx - radius); i <= Math.min(512, cx + radius); i++) {
      const d = Math.hypot(i - cx, j - cz) / radius;
      if (d < 1) H[j * 513 + i] -= depth * (1 - d * d);
    }
  return H;
}

const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const signature = g => createHash('sha256').update(bytes(g.attributes.position.array)).update(bytes(g.attributes.normal.array))
  .update(bytes(g.index.array)).update(JSON.stringify(g.boundingSphere)).digest('hex');
const stats = { comparisons: [], protectedDomains: {} };

function run(H, candidate, reuse = null) {
  const reads = reuse?.reads || [], constructors = reuse?.constructors || [], random = reuse?.random || [];
  reads.length = constructors.length = random.length = 0;
  const proxy = new Proxy(H, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(+key);
    return Reflect.get(target, key, target);
  } });
  const types = ['BufferGeometry', 'Float32BufferAttribute', 'BufferAttribute', 'Sphere', 'Vector3'];
  const THREE = { ...OriginalTHREE };
  for (const name of types) THREE[name] = new Proxy(OriginalTHREE[name], {
    construct(target, args) {
      constructors.push({ name, args: args.map(x => Array.isArray(x) || ArrayBuffer.isView(x) ? x.length : x?.constructor?.name === 'Vector3' ? [x.x, x.y, x.z] : x),
        reads: reads.length, random: random.length });
      return Reflect.construct(target, args);
    },
  });
  const originalRandom = Math.random;
  let tape = 123456;
  Math.random = () => { tape = (Math.imul(tape, 1664525) + 1013904223) >>> 0; const value = tape / 4294967296; random.push(value); return value; };
  try {
    const builder = reuse?.builder || makeBuilder(THREE, proxy, candidate), geometry = [];
    if (reuse) builder.replaceHeights(proxy);
    for (let bj = 0; bj < 4; bj++) for (let bi = 0; bi < 4; bi++) geometry.push(builder.build(bi, bj));
    return { geometry, reads, constructors, random, builder };
  } finally { Math.random = originalRandom; }
}

test('independently pinned original and current helper retain exact source tokens/arithmetic/resource tail', () => {
  assert.equal(prior.revision, 'd49f076c9c7dd2d073c587dd0c9787da93e1523b');
  assert.equal(digest(prior.lodTris), 'e71440caf7c32cf8e324ddf3b7f3be47fde736f817d447341d5a68d720a91f65');
  assert.equal(digest(prior.terrainBlockGeo), '27afff098df44da1f55ac676c386f03cbd35881efabee444ae0abb68405808fd');
  assert.deepEqual(tokens(declaration('lodTris')), tokens(prior.lodTris));
  assert(world.includes('const WSIZE = 1024, HALF = 512, HN = 513, HS = 2;'));
  assert.equal(candidateSource.split(numericSource).length, 2);
  assert(candidateSource.endsWith(tailSource));
});

for (const [label, H] of [
  ['flat', heights(7, 'flat')], ['negative-zero', heights(7, 'negative-zero')], ['slope', heights(7, 'slope')],
  ['seed7', heights(7)], ['seed19', heights(19)], ['seed503', heights(503)],
  ['edge-crater', crater(heights(19), 0, 0, 17, 21)],
  ['four-block-boundary-crater', crater(heights(503), 256, 256, 23, 14)],
]) test(label + ': all16blocks exactly retain bytes, bounds, UUID RNG, constructor timing and world read order', () => {
  const before = bytes(H).slice(), a = run(H, false), b = run(H, true);
  assert.deepEqual(bytes(H), before, 'building does not mutate live heights');
  assert.deepEqual(a.reads, b.reads, 'every live height access in original order');
  assert.deepEqual(a.random, b.random, 'exact complete Math.random tape');
  assert.deepEqual(a.constructors, b.constructors, 'constructor order/arguments/read+RNG position');
  for (let i = 0; i < 16; i++) {
    const x = a.geometry[i], y = b.geometry[i];
    for (const name of ['position', 'normal']) {
      assert.equal(x.attributes[name].array.constructor, Float32Array);
      assert.deepEqual(bytes(x.attributes[name].array), bytes(y.attributes[name].array), name + 'bytes block' + i);
      assert.equal(x.attributes[name].itemSize, y.attributes[name].itemSize);
    }
    assert.equal(x.index.array.constructor, Uint32Array); assert.equal(y.index.array.constructor, Uint32Array);
    assert.deepEqual(bytes(x.index.array), bytes(y.index.array)); assert.deepEqual(x.boundingSphere, y.boundingSphere);
    assert.equal(x.uuid, y.uuid); assert.equal(x.drawRange.start, y.drawRange.start); assert.equal(x.drawRange.count, y.drawRange.count);
  }
  assert.equal(new Set(b.geometry.map(g => g.index)).size, 16);
  assert.equal(new Set(b.geometry.map(g => g.index.array.buffer)).size, 16, 'no shared index GPU lifecycle');
  const cache = b.builder.cache();
  assert.deepEqual(Object.keys(cache).sort(), ['coords', 'indices']);
  assert.equal(cache.coords.constructor, Uint16Array); assert.equal(cache.indices.constructor, Uint32Array);
  stats.comparisons.push({ label, blocks: 16, combinedSHA256: a.geometry.map(signature),
    verticesPerBlock: b.geometry[0].attributes.position.count, indicesPerBlock: b.geometry[0].index.count,
    randomCalls: a.random.length, constructors: a.constructors.length, heightReads: a.reads.length,
    retainedTopologyBytes: cache.coords.byteLength + cache.indices.byteLength });
  for (const g of [...a.geometry, ...b.geometry]) g.dispose();
});

test('later in-place crater changes and whole live height-array replacements are read, never cached', () => {
  const H = heights(7), before = run(H, true), original = before.geometry.map(signature);
  crater(H, 128, 128, 25, 19);
  const baseline = run(H, false), updated = [];
  for (let bj = 0; bj < 4; bj++) for (let bi = 0; bi < 4; bi++) updated.push(before.builder.build(bi, bj));
  assert(updated.some((g, i) => signature(g) !== original[i]));
  assert.deepEqual(updated.map(signature), baseline.geometry.map(signature));
  const replacement = heights(503, 'slope'), replacedA = run(replacement, false);
  const cache = before.builder.cache();
  const replacedB = run(replacement, true, before);
  assert.equal(before.builder.cache(), cache, 'whole W.H replacement retains the warmed topology');
  assert.deepEqual(replacedA.geometry.map(signature), replacedB.geometry.map(signature));
  assert.deepEqual(replacedA.reads, replacedB.reads, 'replaced array exact read tape');
  assert.deepEqual(replacedA.random, replacedB.random, 'replaced array exact UUID RNG tape');
  assert.deepEqual(replacedA.constructors, replacedB.constructors, 'replaced array exact constructor positions');
  assert.deepEqual(replacedA.geometry.map(g => g.uuid), replacedB.geometry.map(g => g.uuid));
  assert(replacedB.geometry.some((g, i) => signature(g) !== signature(updated[i])));
  for (const g of [...before.geometry, ...baseline.geometry, ...updated, ...replacedA.geometry, ...replacedB.geometry]) g.dispose();
});

test('each geometry owns a fresh Uint32Array and attribute; index edits/disposal cannot alter the cached topology', () => {
  const f = run(heights(7), true), expected = bytes(f.builder.cache().indices).slice();
  f.geometry[0].index.array[0] ^= 1; f.geometry[0].dispose();
  assert.deepEqual(bytes(f.builder.cache().indices), expected);
  const next = f.builder.build(0, 0);
  assert.deepEqual(bytes(next.index.array), expected);
  assert.notEqual(next.index, f.geometry[0].index); assert.notEqual(next.index.array.buffer, f.builder.cache().indices.buffer);
  for (const g of [...f.geometry.slice(1), next]) g.dispose();
});

test('comparisons detect a real perturbation in geometry, index order, bounds, RNG or constructor ordering', () => {
  const f = run(heights(19), true), g = f.geometry[0], sig = signature(g);
  g.attributes.position.array[0] += 1; assert.notEqual(signature(g), sig); g.attributes.position.array[0] -= 1;
  const oldNormal = g.attributes.normal.array[0];
  g.attributes.normal.array[0] = oldNormal + 1; assert.notEqual(signature(g), sig); g.attributes.normal.array[0] = oldNormal;
  g.index.array[0] ^= 1; assert.notEqual(signature(g), sig); g.index.array[0] ^= 1;
  g.boundingSphere.radius += 1; assert.notEqual(signature(g), sig); g.boundingSphere.radius -= 1;
  assert.throws(() => assert.deepEqual(f.random, [0, ...f.random.slice(1)]));
  assert.throws(() => assert.deepEqual(f.constructors, f.constructors.slice().reverse()));
  stats.protectedDomains = { geometry: true, normals: true, indices: true, bounds: true, rng: true, constructors: true, heightReadOrder: true, warmedCacheHeightReplacement: true };
  for (const x of f.geometry) x.dispose();
});

test('all fixture maps and protected domains were compared without a timing threshold', () => {
  assert.equal(stats.comparisons.length, 8);
  assert.deepEqual(stats.protectedDomains, { geometry: true, normals: true, indices: true, bounds: true,
    rng: true, constructors: true, heightReadOrder: true, warmedCacheHeightReplacement: true });
});
