// Source-only experiment until separately validated: fake completion clocks, no WebGL or speed claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basicFixture, entryFixture, THREE, currentController } from './title_rolling_fixture.mjs';
const lf = value => value.replace(/\r\n/g, '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const original = JSON.parse(readFileSync(new URL('./fixtures/title_compile_rolling_b27.json', import.meta.url), 'utf8'));
const candidate = lf(currentController);
const capacity = 8;
const receiptOf = f => f.ctx.GRAPHICS_STARTUP.titlePreparations[0];

function singles(f) {
  for (const object of f.objects) { object.material.transparent = false; object.material.side = THREE.FrontSide; }
  f.inventory.renderables = f.objects;
  f.stages.splice(0, f.stages.length, ['terrain', new Set(f.objects)]);
  return f;
}
function basic(options = {}) { return singles(basicFixture({ ...options, pendingLimit: capacity })); }
function entry(options = {}) { return entryFixture({ ...options, pendingLimit: capacity }); }
async function fillEight(f) {
  await f.flush();
  assert.equal(f.compileCalls.length, 4, 'the first turn remains four preparations');
  await f.timer();
  assert.equal(f.programs.length, 8); assert.equal(f.compileCalls.length, 8);
  assert.equal(receiptOf(f).maxPreparesPerTurn, 4);
}

test('the independent rolling-four source is pinned and exactly recovered by the three approved inverses', () => {
  assert.equal(original.revision, 'b27fab2ca2d406d321cfd85171f8d6078648c224');
  assert.equal(original.path, 'src/13o_title_compile.js');
  assert.equal(original.sha256, '7df3b4483d92d5f451438759edb25395fe387540a6335fad53d352c854980083');
  assert.equal(hash(original.source), original.sha256);
  assert.equal(candidate.match(/pending:\s*(\d+)/)[1], '8');
  const inverse = candidate.replace('Experimental rolling eight unfinished', 'Experimental rolling four unfinished')
    .replace('pending: 8, perTurn: 4', 'pending: 4, perTurn: 4')
    .replace("admissionPolicy: 'rolling-eight-unfinished'", "admissionPolicy: 'rolling-four-unfinished'");
  assert.equal(inverse, original.source, 'all inventory/order, constructors, cache inputs, GL calls, clocks, errors, owners and finally remain literal');
  assert(!candidate.includes('Math.random')); assert(!candidate.includes('new THREE.'));
});

test('eight unfinished slots fill across two four-prepare turns, retain order and never create a ninth', async () => {
  const f = basic({ count: 12, readyDelay: 1000 }), promise = f.run();
  await fillEight(f, promise); const checks = f.errorChecks.length;
  await f.timer(); assert.equal(f.compileCalls.length, 8); assert.equal(f.queries.length, 0);
  assert.equal(f.errorChecks.length, checks, 'no in-flight GL error query');
  assert.deepEqual(Array.from(f.calls, row => row.object), Array.from(f.objects.slice(0, 8)));
  const receipt = await f.finish(promise);
  assert.equal(receipt.maxPending, 8); assert.equal(receipt.maxPreparesPerTurn, 4);
  assert.equal(receipt.admissionPolicy, 'rolling-eight-unfinished');
  assert.deepEqual(Array.from(f.calls, row => row.object), Array.from(f.objects)); f.clean();
});

test('the 8ms turn budget still yields after two atomic 5ms preparations, not eight calls', async () => {
  const f = basic({ count: 12, readyDelay: 1000, compileMs: 5 }), promise = f.run(); await f.flush();
  assert.equal(f.compileCalls.length, 2); assert.equal(receiptOf(f).maxFullTurnMs, 10);
  const receipt = await f.finish(promise);
  assert(receipt.maxPending <= 8); assert.equal(receipt.maxPreparesPerTurn, 2);
  assert.equal(receipt.maxSinglePrepareMs, 5); assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});

test('a two-program ordered head cannot use a single free eighth slot or skip ahead', async () => {
  const f = basic({ count: 10, readyDelay: 1000 });
  f.objects[7].material.transparent = true; f.objects[7].material.side = THREE.DoubleSide;
  const promise = f.run(); await f.flush(); await f.timer();
  assert.equal(f.programs.length, 7); assert.equal(f.compileCalls.length, 7);
  assert(!f.calls.some(row => row.object === f.objects[7] || row.object === f.objects[8]));
  f.programs[0].readyAt = 0; await f.timer();
  assert.equal(f.programs.length, 9); assert.equal(f.compileCalls.length, 8);
  assert.equal(f.calls.filter(row => row.object === f.objects[7]).length, 2);
  assert(!f.calls.some(row => row.object === f.objects[8]));
  const receipt = await f.finish(promise); assert.equal(receipt.maxPending, 8); f.clean();
});

test('two slow programs can remain pending while cheap completed programs refill only the available slots', async () => {
  const f = basic({ count: 24, readyDelay: 1000 }), promise = f.run(); await fillEight(f, promise);
  const originalTwo = f.programs.slice(0, 2);
  for (let turn = 0; turn < 4; turn++) {
    for (const program of f.programs.slice(2)) program.readyAt = 0;
    const before = f.compileCalls.length; await f.timer();
    assert(f.compileCalls.length > before && f.compileCalls.length <= before + 4);
    assert(originalTwo.every(program => f.ctx.performance.now() < program.readyAt));
    assert(f.programs.filter(program => f.ctx.performance.now() < program.readyAt).length <= 8);
  }
  const receipt = await f.finish(promise);
  assert.equal(receipt.preparedJobs, 24); assert.equal(receipt.maxPending, 8);
  assert.deepEqual(Array.from(f.calls, row => row.object), Array.from(f.objects)); f.clean();
});

test('515 synthetic ordered jobs retain exactly66 renderer cache identities with zero random draws', async () => {
  const f = basic({ count: 515, readyDelay: 10 }), materials = f.objects.slice(0, 66).map(object => object.material);
  for (const [index, object] of f.objects.entries()) {
    object.material = materials[index % 66]; object.isInstancedMesh = false; object.instanceColor = null;
  }
  const receipt = await f.finish(f.run());
  assert.equal(receipt.eligibleJobs, 515); assert.equal(receipt.preparedJobs, 515); assert.equal(receipt.newPrograms, 66);
  assert.equal(f.programs.length, 66); assert.equal(f.queries.length, 66);
  assert.deepEqual(Array.from(f.calls, row => row.object), Array.from(f.objects));
  assert.deepEqual(Array.from(f.calls, row => row.material), Array.from(f.objects, row => row.material));
  assert(receipt.maxPending <= 8); assert(receipt.maxPreparesPerTurn <= 4);
  assert.equal(f.randomCalls(), 0); assert(f.errorChecks.every(row => row.pendingPrograms.length === 0));
  assert.equal(receipt.programObservationLimit, 256); assert.equal(receipt.droppedProgramObservations, 0); f.clean();
});

for (const change of ['resize', 'hidden', 'generation']) test('all eight old slots drain with no new admission after ' + change, async () => {
  const f = basic({ count: 12, readyDelay: 1000 }), promise = f.run(); await fillEight(f, promise);
  if (change === 'resize') { f.ctx.TITLE_RESIZE_PENDING = true; f.ctx.window.emit('resize'); }
  if (change === 'hidden') { f.ctx.document.hidden = true; f.ctx.document.emit('visibilitychange'); }
  if (change === 'generation') f.ctx.TITLE_WARM_GENERATION++;
  const receipt = await f.finish(promise);
  assert.equal(receipt.stale, true); assert.equal(receipt.completed, false); assert.equal(f.compileCalls.length, 8);
  assert.equal(f.queries.length, 8); assert(f.errorChecks.every(row => row.pendingPrograms.length === 0)); f.clean();
});

test('context loss after filling eight rejects before any additional link query or admission', async () => {
  const f = basic({ count: 12, readyDelay: 1000 }), promise = f.run(); await fillEight(f, promise);
  const queries = f.queries.length; const rejected = assert.rejects(promise, /Graphics stopped/); f.lose(); await rejected;
  assert.equal(f.compileCalls.length, 8); assert.equal(f.queries.length, queries); f.clean();
});

test('a completed failed link prevents ninth admission even while seven siblings remain pending', async () => {
  const f = basic({ count: 12, readyDelay: 1000, failure: 'link' }), promise = f.run(); await fillEight(f, promise);
  f.programs[0].readyAt = 0;
  const rejected = assert.rejects(promise, /failed to link/); await f.timer(); await rejected;
  assert.equal(f.compileCalls.length, 8); assert.equal(f.queries.length, 1); assert.equal(receiptOf(f).completed, false); f.clean();
});

test('the oldest90s deadline cannot be renewed by younger eight-slot refills', async () => {
  const f = basic({ count: 24, readyDelay: 10 }), promise = f.run(); await f.flush(); f.programs[0].readyAt = 200000;
  await assert.rejects(f.finish(promise), /timed out/);
  assert.equal(f.compileCalls.length, 24); assert(f.ctx.performance.now() >= 90000 && f.ctx.performance.now() <= 90100);
  assert.equal(receiptOf(f).waveLatency[0].programs[0].queuedMs, 0); f.clean();
});

test('the180s total limit rejects unsubmitted jobs even with spare unfinished capacity', async () => {
  const f = basic({ count: 50, readyDelay: 0, compileMs: 8000 });
  await assert.rejects(f.finish(f.run()), /exceeded its time budget/);
  assert(receiptOf(f).visibleMs >= 180000); assert(receiptOf(f).preparedJobs < 50);
  assert.equal(receiptOf(f).maxPreparesPerTurn, 1); f.clean();
});

test('all entry reflection still waits for the complete batch and remains four-per-turn', async () => {
  const f = entry({ shadows: 11, readyDelay: 1000 }), state = f.state(), promise = f.runEntry();
  await fillEight(f, promise); f.programs[0].readyAt = 0; await f.timer();
  assert.equal(f.reflections.length, 0);
  const receipt = await f.finish(promise);
  assert.equal(receipt.maxPending, 8); assert.equal(f.reflections.length, receipt.newPrograms);
  assert(f.reflections.every(row => row.compiled === f.compileCalls.length));
  assert(receipt.maxReflectionsPerTurn <= 4); assert(receipt.maxPreparesPerTurn <= 4);
  assert(f.errorChecks.every(count => count === 0)); assert.deepEqual(f.state(), state); assert.equal(f.randomCalls(), 0); f.clean();
});

test('a queued entry GL error waits for final drain and forbids every reflection/readiness result', async () => {
  const f = entry({ shadows: 11, readyDelay: 1000 }), promise = f.runEntry(); await fillEight(f, promise);
  f.errors.push(['0x0502']); await assert.rejects(f.finish(promise), /GL errors/);
  assert.equal(f.compileCalls.length, 14); assert.equal(f.reflections.length, 0);
  assert.equal(receiptOf(f).completed, false); assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined);
  assert(f.errorChecks.every(count => count === 0)); f.clean();
});
