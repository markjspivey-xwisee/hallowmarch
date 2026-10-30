// Actual-source ordering and fake-completion checks only; no WebGL, shader execution or timing-gain claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parse } from '../node_modules/acorn/dist/acorn.mjs';
import { entryFixture, THREE } from './title_rolling_fixture.mjs';
import { structurePriorityEdits, undoStructureFamilyPriority } from './title_structure_priority_fixture.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const source = read('src/13o_title_compile.js');
const oracle = JSON.parse(read('tools/tests/fixtures/title_structure_priority_1145461.json'));
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(oracle.revision, '1145461f2d0229cf98d92da8fdf9a38990d4f50f');
assert.equal(oracle.tree, 'b737cb9c88da2f49828a30619167f4776a919325');
assert.equal(oracle.sha256, 'c739469d5b64c349d0e2a080e4fdd2bd315e5a6711d04ca41e89a2c922426fa4');
assert.equal(sha(oracle.source), oracle.sha256);

function declaration(text, name) {
  const node = parse(text, { ecmaVersion: 'latest' }).body.find(value => value.type === 'FunctionDeclaration' && value.id.name === name);
  assert(node, name); return text.slice(node.start, node.end);
}
function orderer(text) {
  const context = vm.createContext({ Math: Object.assign(Object.create(Math), { random() { throw Error('Ordering must not draw RNG'); } }) });
  vm.runInContext(declaration(text, 'titleInitialOrder') + ';globalThis.order=titleInitialOrder;', context);
  return (jobs, receipt) => Array.from(context.order(jobs, receipt));
}
const currentOrder = orderer(source), originalOrder = orderer(oracle.source);
function job(testId, family, chars, cost = 1) {
  const material = { vertexShader: 'v'.repeat(chars), fragmentShader: 'f', side: 0, transparent: false, forceSinglePass: false };
  return { testId, family, object: {}, material, geometry: {}, target: {}, camera: {}, targetScene: {}, version: 0, cost,
    postDependency: false, side: material.side, transparent: material.transparent, forceSinglePass: material.forceSinglePass,
    vertexShader: material.vertexShader, fragmentShader: material.fragmentShader };
}
function receiptFor(jobs) {
  const families = {};
  for (const row of jobs) (families[row.family] ||= { jobs: 0 }).jobs++;
  return { families, deduplicatedJobs: 0 };
}
const ids = jobs => Array.from(jobs, row => row.testId);
function mixedInitial(options = {}) {
  const f = entryFixture(options);
  const structural = f.sources.filter((_, index) => index % 2 === 0);
  const others = f.sources.filter((_, index) => index % 2 !== 0);
  const stages = [['post', new Set()], ['sky', new Set([f.r.skyMesh])], ['terrain', new Set(others)], ['structures', new Set(structural)]];
  let admittedOrder;
  const actual = f.ctx.titleInitialOrder;
  f.ctx.titleInitialOrder = (jobs, receipt) => { admittedOrder = Array.from(actual(jobs, receipt)); return admittedOrder; };
  return Object.assign(f, { structural, stages, ordered: () => admittedOrder,
    runInitial: () => f.ctx.prepareTitleInitialPrograms(f.inventory, stages, f.ctx.TITLE_WARM_GENERATION, f.resources) });
}

test('whole release queue inverse permits only the comparator, honest initial policy and comment', () => {
  assert.equal(undoStructureFamilyPriority(source), oracle.source);
  assert.equal(structurePriorityEdits.length, 3);
  assert.equal(source.match(/const TITLE_COMPILE_LIMITS[^\n]+/)[0], oracle.source.match(/const TITLE_COMPILE_LIMITS[^\n]+/)[0]);
  assert.equal(source.includes('\r'), false);
});

test('the source inverse rejects missing/duplicate allowances and cannot conceal an unrelated guard change', () => {
  for (const edit of structurePriorityEdits) {
    assert.throws(() => undoStructureFamilyPriority(source.replace(edit.after, 'unapproved replacement')));
    assert.throws(() => undoStructureFamilyPriority(source + '\n' + edit.after));
  }
  const mutated = source.replace('pending: 4, perTurn: 4', 'pending: 5, perTurn: 4');
  assert.notEqual(mutated, source);
  assert.throws(() => assert.equal(undoStructureFamilyPriority(mutated), oracle.source));
});

test('short structures jobs precede larger other-family jobs without copying the physical jobs', () => {
  const jobs = [job('human', 'crowds-1', 1000), job('town-small', 'structures', 2), job('terrain', 'terrain', 800), job('town-large', 'structures', 10)];
  const output = currentOrder(jobs, receiptFor(jobs));
  assert.deepEqual(ids(output), ['town-large', 'town-small', 'human', 'terrain']);
  assert.equal(output.length, jobs.length); for (const row of output) assert(jobs.includes(row));
});

test('descending source size and original-index ties remain stable in both partitions', () => {
  const jobs = [job('other-a', 'terrain', 30), job('structure-a', 'structures', 5), job('other-b', 'crowds-1', 30),
    job('structure-b', 'structures', 5), job('structure-large', 'structures', 9), job('other-small', 'water', 1)];
  assert.deepEqual(ids(currentOrder(jobs, receiptFor(jobs))), ['structure-large', 'structure-a', 'structure-b', 'other-a', 'other-b', 'other-small']);
});

test('the semantic family match is exact and ignores historic IDs or source lengths as selectors', () => {
  const historic = job('historic-ids', 'terrain', 42312); historic.material.id = 227; historic.object.id = 403; historic.geometry.id = 377;
  const jobs = [historic, job('case', 'Structures', 10), job('entry', 'entry-structures', 9), job('exact', 'structures', 1)];
  assert.deepEqual(ids(currentOrder(jobs, receiptFor(jobs))), ['exact', 'historic-ids', 'case', 'entry']);
});

for (const family of ['terrain', 'structures']) test('a single-partition inventory retains the original order and counters: ' + family, () => {
  const jobs = [job('a', family, 2), job('b', family, 9), job('c', family, 9), job('d', family, 1)];
  const before = receiptFor(jobs), after = receiptFor(jobs);
  assert.deepEqual(ids(currentOrder(jobs, after)), ids(originalOrder(jobs, before)));
  assert.deepEqual(after, before);
});

test('a synthetic finite515-job inventory remains an exact once-only physical permutation with unchanged fields and cost reservations', () => {
  // The observed production515 count is a scale control, not a claim that this synthetic inventory is the real world.
  const jobs = Array.from({ length: 515 }, (_, index) => job('job-' + index, index % 9 === 0 ? 'structures' : 'terrain', (index * 37) % 113, index % 7 === 0 ? 2 : 1));
  const before = jobs.map(row => ({ ...row })), original = originalOrder(jobs, receiptFor(jobs));
  const receipt = receiptFor(jobs), output = currentOrder(jobs, receipt);
  assert.equal(output.length, 515); assert.equal(new Set(output).size, 515); assert.equal(receipt.deduplicatedJobs, 0);
  for (let index = 0; index < jobs.length; index++) assert.deepEqual(jobs[index], before[index]);
  assert.deepEqual(output.filter(row => row.family === 'structures'), original.filter(row => row.family === 'structures'));
  assert.deepEqual(output.filter(row => row.family !== 'structures'), original.filter(row => row.family !== 'structures'));
  assert.equal(output.filter(row => row.family === 'structures').length, 58);
});

test('dedup retains the original nonstructure winner before priority and still ORs entryPreparation', () => {
  const first = job('winner', 'entry-shadow', 100), duplicate = { ...first, testId: 'duplicate', family: 'structures', entryPreparation: true };
  const small = job('independent', 'structures', 1), jobs = [first, duplicate, small], receipt = receiptFor(jobs);
  const output = currentOrder(jobs, receipt);
  assert.deepEqual(ids(output), ['independent', 'winner']); assert.equal(output[1], first);
  assert.equal(first.family, 'entry-shadow'); assert.equal(first.entryPreparation, true); assert.equal(receipt.deduplicatedJobs, 1);
  assert.equal(receipt.families.structures.jobs, 1); assert.equal(receipt.families['entry-shadow'].jobs, 1);
});

test('a structure winner stays the same object and removes only the later duplicate family counter', () => {
  const first = job('winner', 'structures', 1), duplicate = { ...first, testId: 'duplicate', family: 'terrain', entryPreparation: true };
  const jobs = [first, duplicate, job('large', 'crowds-1', 100)], receipt = receiptFor(jobs), output = currentOrder(jobs, receipt);
  assert.deepEqual(ids(output), ['winner', 'large']); assert.equal(output[0], first); assert.equal(first.entryPreparation, true);
  assert.equal(receipt.families.terrain, undefined); assert.equal(receipt.deduplicatedJobs, 1);
});

test('source-pair matches do not merge distinct materials, objects, targets or cost2 compound jobs', () => {
  for (const field of ['object', 'material', 'geometry', 'target', 'camera', 'targetScene', 'version', 'cost', 'postDependency', 'side', 'transparent', 'forceSinglePass', 'vertexShader', 'fragmentShader']) {
    const first = job('a', 'structures', 10), second = { ...first, testId: 'b', family: 'terrain' };
    if (['object', 'geometry', 'target', 'camera', 'targetScene'].includes(field)) second[field] = {};
    else if (field === 'material') second.material = { ...first.material };
    else if (['version', 'cost', 'side'].includes(field)) second[field]++;
    else if (['postDependency', 'transparent', 'forceSinglePass'].includes(field)) second[field] = !second[field];
    else second[field] += ' '; // distinct source snapshot
    const receipt = receiptFor([first, second]), output = currentOrder([first, second], receipt);
    assert.deepEqual(ids(output), ['a', 'b'], field); assert.equal(receipt.deduplicatedJobs, 0, field);
    assert.equal(output[0], first); assert.equal(output[1], second);
  }
});

test('actual mixed initial preparation uses the promoted order and retains complete fake-GPU lifecycle and guards', async () => {
  const f = mixedInitial({ shadows: 8, readyDelay: 50 }), before = f.state();
  const parents = f.sources.map(row => row.parent), counts = f.sources.map(row => row.geometry.instanceCount);
  const receipt = await f.finish(f.runInitial()), output = f.ordered();
  const prefix = output.findIndex(row => row.family !== 'structures');
  assert(prefix > 0 && prefix < output.length); assert(output.slice(prefix).every(row => row.family !== 'structures'));
  assert.equal(receipt.queuePolicy, 'combined-structures-first-source-size'); assert.equal(receipt.completed, true);
  assert.equal(receipt.preparedJobs, output.length); assert(receipt.maxPending <= 4); assert(receipt.maxPreparesPerTurn <= 4); assert(receipt.maxReflectionsPerTurn <= 4);
  assert.equal(f.calls[0].object, output[0].object); assert.equal(f.calls[0].material, output[0].material);
  assert.deepEqual(f.state(), before); assert.deepEqual(f.sources.map(row => row.parent), parents); assert.deepEqual(f.sources.map(row => row.geometry.instanceCount), counts);
  assert.equal(f.randomCalls(), 0); assert.equal(f.preflightCalls(), 0); f.clean();
});

test('a promoted cost2 head waits at three pending slots without admitting a cheaper later job', async () => {
  const f = entryFixture({ shadows: 3, readyDelay: 1000 });
  for (let index = 0; index < 3; index++) {
    f.sources[index].material.vertexShader += ' '.repeat((3 - index) * 40);
    f.sources[index].material.transparent = index !== 1; f.sources[index].material.side = index !== 1 ? THREE.DoubleSide : THREE.FrontSide;
    f.sources[index].material.forceSinglePass = false;
  }
  const stages = [['post', new Set()], ['sky', new Set([f.r.skyMesh])], ['structures', new Set(f.sources)]];
  const promise = f.ctx.prepareTitleInitialPrograms(f.inventory, stages, f.ctx.TITLE_WARM_GENERATION, f.resources);
  await f.flush(); assert.equal(f.programs.length, 3);
  assert(f.calls.some(row => row.object === f.sources[0])); assert(f.calls.some(row => row.object === f.sources[1]));
  assert(!f.calls.some(row => row.object === f.sources[2]));
  assert(f.calls.every(row => row.object === f.sources[0] || row.object === f.sources[1]));
  f.programs[0].readyAt = 0; await f.timer(); assert(f.calls.some(row => row.object === f.sources[2]));
  const receipt = await f.finish(promise); assert.equal(receipt.completed, true); assert(receipt.maxPending <= 4); f.clean();
});

test('only initial ordering changes; ordinary post and sky preparation keep their original policy', async () => {
  for (const dependency of ['post', 'sky']) {
    const f = entryFixture({ readyDelay: 0 }), receipt = await f.finish(f.run(dependency));
    assert.equal(receipt.queuePolicy, 'staged'); assert.equal(receipt.dependency, dependency); assert.equal(receipt.completed, true); f.clean();
  }
  const before = declaration(oracle.source, 'prepareTitleProgramJobs');
  const after = declaration(source, 'prepareTitleProgramJobs').replace(structurePriorityEdits[2].after, structurePriorityEdits[2].before);
  assert.equal(after, before, 'No admission/reflection/guard/deadline/fence/diagnostic body change');
});
