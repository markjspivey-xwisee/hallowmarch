// Actual repository controller/dependency fixtures. Importing this adapter never runs a test suite or creates WebGL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../node_modules/three/build/three.module.js';
import { WebGLPrograms } from '../node_modules/three/src/renderers/webgl/WebGLPrograms.js';
import { parse } from '../node_modules/acorn/dist/acorn.mjs';
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const oracle = JSON.parse(read('tools/tests/fixtures/title_compile_wave_418d.json'));
assert.equal(oracle.revision, '418d7fff33c3076b0c31bb80a0495f624908f4af');
assert.equal(oracle.path, 'src/13o_title_compile.js');
assert.equal(oracle.sha256, '0725349e1e2088d685348c5b12085ddb99a4e0fdba27303c131c9d82220d4a0b');
const originalController = oracle.source;
assert.equal(digest(originalController), oracle.sha256, 'Independent pinned drained-wave control');
const currentController = read('src/13o_title_compile.js');
const basicTests = read('tools/tests/title_compile.test.mjs'), dependencyTests = read('tools/tests/title_dependencies.test.mjs');
const originalRender = read('src/02_render.js');
const rendererSource = read('tools/node_modules/three/src/renderers/WebGLRenderer.js');
function selected(source, names) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const nodes = new Set();
  for (const name of names) {
    const node = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name
      || node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === name));
    assert(node, 'Pinned fixture declaration: ' + name); nodes.add(node);
  }
  return [...nodes].sort((a, b) => a.start - b.start).map(node => source.slice(node.start, node.end)).join('\n');
}
export function basicFixture(options = {}, { baseline = false } = {}) {
  const context = vm.createContext({ assert, vm, THREE, originalRender, rendererSource,
    source: baseline ? originalController : currentController, productPending: 4, productIdlePollMaxMs: 100 });
  vm.runInContext(selected(basicTests, ['avatarFixture', 'actualConstructors', 'compile', 'target', 'fixture'])
    + '\nglobalThis.createFixture=fixture;', context, { timeout: 1000 });
  return context.createFixture(options);
}
export function entryFixture(options = {}, { baseline = false } = {}) {
  const context = vm.createContext({ assert, vm, THREE, WebGLPrograms, read,
    original: originalRender, dive: read('src/07d_dive.js'), diagnostic: read('src/13y_gpu_diagnostic.js'), rendererSource,
    controller: baseline ? originalController : currentController, productPending: 4, regressionPending: 4 });
  vm.runInContext(selected(dependencyTests, ['section', 'constructors', 'grouping', 'compile', 'capture', 'events', 'fixture', 'entryFixture'])
    + '\nglobalThis.createFixture=entryFixture;', context, { timeout: 1000 });
  return context.createFixture(options);
}
export { THREE, originalController, currentController, originalRender, basicTests, dependencyTests };
