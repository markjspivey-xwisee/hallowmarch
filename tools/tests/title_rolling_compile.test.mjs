// Actual-source scheduling regressions with fake GPU completion clocks; no WebGL/browser or timing claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../node_modules/acorn/dist/acorn.mjs';
import { basicFixture, entryFixture, THREE, originalController, currentController } from './title_rolling_fixture.mjs';
const normalizeLF = value => value.replace(/\r\n/g, '\n');

function singles(f, count = f.objects.length) {
  const objects = f.objects.slice(0, count);
  for (const object of objects) { object.material.transparent = false; object.material.side = THREE.FrontSide; }
  f.inventory.renderables = objects;
  f.stages.splice(0, f.stages.length, ['post', new Set()], ['sky', new Set()], ['terrain', new Set(objects)]);
  return f;
}
function nextDelay(f) {
  const timer = [...f.timers.values()].sort((a, b) => a.due - b.due)[0];
  assert(timer, 'An owned bounded poll must exist'); return timer.due - f.ctx.performance.now();
}
const receiptOf = f => f.ctx.GRAPHICS_STARTUP.titlePreparations[0];

test('only the scheduler body/diagnostics change; every other inventory/dependency/snapshot function and limits stay exact', () => {
  const old = normalizeLF(originalController), candidate = normalizeLF(currentController);
  const functions = source => new Map(parse(source, { ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration').map(node => [node.id.name, source.slice(node.start, node.end)]));
  const before = functions(old), after = functions(candidate);
  // The independently pinned diagnostics test proves its exact helper/call inverse.
  assert(after.has('titleFailedProgramDiagnostics')); after.delete('titleFailedProgramDiagnostics');
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [name, body] of before) if (name !== 'prepareTitleProgramJobs') assert.equal(after.get(name), body, name);
  const region = source => source.slice(source.indexOf('const jobs = [], inventoryStarted'), source.indexOf('let index = 0, wavePrograms'));
  assert(region(old).length > 1000); assert.equal(region(candidate), region(old));
  assert.equal(candidate.match(/const TITLE_COMPILE_LIMITS[^\n]+/)[0], old.match(/const TITLE_COMPILE_LIMITS[^\n]+/)[0]);
  assert(candidate.includes("errorPolicy: 'finite-batch-drain'")); assert(candidate.includes("admissionPolicy: 'rolling-four-unfinished'"));
  assert(candidate.includes('queuedVisibleMs, family: job.family, observation'));
  assert(candidate.includes('const queuedAt = performance.now(), queuedVisibleMs = visibleElapsed()')); // immutable per-admission deadline
});

test('partial completion refills an unfinished slot; preserved old wave source does not', async () => {
  for (const baseline of [true, false]) {
    const f = singles(basicFixture({ count: 8, readyDelay: 1000 }, { baseline }));
    const promise = f.run(); await f.flush(); assert.equal(f.compileCalls.length, 4);
    f.programs[0].readyAt = 10; f.programs[1].readyAt = 20;
    await f.timer(); assert.equal(f.compileCalls.length, baseline ? 4 : 5);
    await f.timer(); assert.equal(f.compileCalls.length, baseline ? 4 : 6);
    assert(f.programs.filter(program => !f.ctx.forceComplete && f.ctx.performance.now() < program.readyAt).length <= 4);
    const receipt = await f.finish(promise);
    assert(receipt.completed); assert(receipt.maxPending <= 4); assert(receipt.maxPreparesPerTurn <= 4);
    assert.equal(receipt.errorPolicy, baseline ? 'drained-waves' : 'finite-batch-drain'); f.clean();
  }
});

test('a two-program head cannot be skipped into a single free slot', async () => {
  const f = singles(basicFixture({ count: 5, readyDelay: 1000 }));
  f.objects[3].material.transparent = true; f.objects[3].material.side = THREE.DoubleSide;
  const promise = f.run(); await f.flush();
  assert.equal(f.compileCalls.length, 3); assert(!f.calls.some(call => call.object === f.objects[4]));
  f.programs[0].readyAt = 10; await f.timer();
  assert.equal(f.compileCalls.length, 4); assert(!f.calls.some(call => call.object === f.objects[4]));
  assert.equal(f.calls.filter(call => call.object === f.objects[3]).length, 2);
  const receipt = await f.finish(promise); assert.equal(receipt.maxPending, 4); f.clean();
});

test('cached jobs retain their order and do not consume unfinished program slots', async () => {
  const f = singles(basicFixture({ count: 29, readyDelay: 10000 }));
  const plain = f.objects.filter(object => !object.isInstancedMesh), chosen = plain.slice(0, 27), shared = chosen[0].material;
  for (const object of chosen.slice(0, 23)) object.material = shared;
  f.inventory.renderables = chosen; f.stages.splice(0, f.stages.length, ['terrain', new Set(chosen)]);
  const promise = f.run(); await f.flush();
  for (let i = 0; i < 10 && f.compileCalls.length < 26; i++) await f.timer();
  assert.equal(f.compileCalls.length, 26); assert.equal(f.programs.length, 4);
  assert.deepEqual(Array.from(f.calls, call => call.object), Array.from(chosen.slice(0, 26)));
  const receipt = await f.finish(promise); assert.equal(receipt.preparedJobs, 27); assert.equal(receipt.newPrograms, 5);
  assert(receipt.maxPending <= 4); f.clean();
});

test('all 515 original ordered jobs are retained with an independently bounded numeric history', async () => {
  const f = singles(basicFixture({ count: 515, readyDelay: 0 }));
  const receipt = await f.finish(f.run());
  assert.equal(receipt.eligibleJobs, 515); assert.equal(receipt.preparedJobs, 515);
  assert.deepEqual(Array.from(f.calls, call => call.object), Array.from(f.objects));
  assert.equal(receipt.newPrograms, 515); assert.equal(receipt.maxPending, 4);
  assert.equal(receipt.programObservationLimit, 256); assert.equal(receipt.droppedProgramObservations, 259);
  assert.equal(receipt.waveLatency.length, 1); assert.equal(receipt.waveLatency[0].programs.length, 256);
  assert.equal(receipt.waveLatency[0].droppedPrograms, 259); assert.equal(receipt.waveLatency[0].newPrograms, 515);
  for (const row of receipt.waveLatency[0].programs)
    assert(Object.values(row).every(value => value === null || typeof value !== 'object'));
  assert(receipt.maxPreparesPerTurn <= 4); assert.equal(f.randomCalls(), 0); f.clean();
});

test('a queued GL error is explicitly recognized later, but final failure permits neither readiness nor real stages', async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 100 }));
  let realStages = 0;
  const promise = f.run().then(value => { realStages++; return value; });
  await f.flush(); f.glErrors.push(['0x0502']); f.ctx.forceComplete = true;
  await assert.rejects(f.finish(promise), /GL errors/);
  assert.equal(f.compileCalls.length, 8, 'Changed policy admits the unchanged finite batch before recognizing queued GL error');
  assert.equal(realStages, 0); assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined);
  assert.equal(receiptOf(f).completed, false); assert.equal(receiptOf(f).outcome, 'failed');
  assert(f.errorChecks.every(check => check.pendingPrograms.length === 0)); f.clean();
});

test('a completed failed link prevents refill even while siblings remain unfinished', async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 1000, failure: 'link' }));
  const promise = f.run(); await f.flush(); const submitted = f.compileCalls.length;
  f.programs[0].readyAt = 10;
  await assert.rejects(f.finish(promise), /failed to link/);
  assert.equal(f.compileCalls.length, submitted); assert.equal(f.queries.length, 1); f.clean();
});

test('context loss wakes immediately and cannot refill, query links or retry the renderer', async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 1000 }));
  const promise = f.run(); await f.flush(); const submitted = f.compileCalls.length;
  f.lose(); await assert.rejects(promise, /Graphics stopped/);
  assert.equal(f.compileCalls.length, submitted); assert.equal(f.queries.length, 0); f.clean();
});

test('context loss observed during a failed-link query remains fatal before refill', async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 1000 }));
  const promise = f.run(); await f.flush(); const submitted = f.compileCalls.length;
  f.programs[0].readyAt = 10;
  f.ctx.gl.getProgramParameter = () => {f.lose(); return false;};
  await assert.rejects(f.finish(promise), /Graphics stopped|context/);
  assert.equal(f.compileCalls.length, submitted); f.clean();
});

for (const change of ['resize', 'hidden', 'generation']) test('stale partial capacity drains without admission: ' + change, async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 100 }));
  const promise = f.run(); await f.flush(); const submitted = f.compileCalls.length;
  f.programs[0].readyAt = 10;
  if (change === 'resize') { f.ctx.TITLE_RESIZE_PENDING = true; f.ctx.window.emit('resize'); }
  if (change === 'hidden') { f.ctx.document.hidden = true; f.ctx.document.emit('visibilitychange'); }
  if (change === 'generation') f.ctx.TITLE_WARM_GENERATION++;
  const receipt = await f.finish(promise); assert(receipt.stale && !receipt.completed);
  assert.equal(f.compileCalls.length, submitted); assert(f.errorChecks.every(check => check.pendingPrograms.length === 0)); f.clean();
});

test('the actual combined initial inventory keeps pooled geometry/material snapshots active during rolling refill', async () => {
  for (const change of ['geometry', 'defines', 'layer']) {
    const f = entryFixture({ shadows: 7, readyDelay: 100 });
    const stages = [['post', new Set()], ['sky', new Set([f.r.skyMesh])], ['terrain', new Set(f.sources)]];
    const promise = f.ctx.prepareTitleInitialPrograms(f.inventory, stages, f.ctx.TITLE_WARM_GENERATION, f.resources);
    await f.flush(); const submitted = f.compileCalls.length;
    if (change === 'geometry') f.sources[1].geometry = new THREE.InstancedBufferGeometry();
    if (change === 'defines') f.sources[1].material.defines = {EXTERNAL_CHANGE: 1};
    if (change === 'layer') f.sources[1].layers.set(4);
    const receipt = await f.finish(promise); assert(receipt.stale && !receipt.completed);
    assert.equal(f.compileCalls.length, submitted); f.clean();
  }
});

test('an error at the stale final drain is fatal rather than a successful replan', async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 100 }));
  const promise = f.run(); await f.flush(); const submitted = f.compileCalls.length;
  f.ctx.TITLE_RESIZE_PENDING = true; f.glErrors.push(['0x0502']); f.ctx.window.emit('resize');
  await assert.rejects(f.finish(promise), /GL errors/); assert.equal(f.compileCalls.length, submitted);
  assert.equal(receiptOf(f).outcome, 'failed'); f.clean();
});

test('the oldest admission deadline survives multiple younger rolling refills', async () => {
  const f = singles(basicFixture({ count: 20, readyDelay: 10 }));
  const promise = f.run(); await f.flush(); f.programs[0].readyAt = 200000;
  await assert.rejects(f.finish(promise), /timed out/);
  assert.equal(f.compileCalls.length, 20); assert(f.ctx.performance.now() >= 90000 && f.ctx.performance.now() <= 90100);
  assert.equal(receiptOf(f).waveLatency[0].programs[0].queuedMs, 0); f.clean();
});

test('final availability wins over a late total deadline, but an unsubmitted job cannot be admitted after it', async () => {
  const final = singles(basicFixture({ count: 1, readyDelay: 1 }));
  const finalPromise = final.run(); await final.flush(); await final.timer(200000);
  assert((await finalPromise).completed); final.clean();
  const remaining = singles(basicFixture({ count: 2, readyDelay: 1, compileMs: 9 }));
  const promise = remaining.run(); await remaining.flush(); assert.equal(remaining.compileCalls.length, 1);
  const rejected = assert.rejects(promise, /time budget/); await remaining.timer(200000); await rejected;
  assert.equal(remaining.compileCalls.length, 1); remaining.clean();
});

test('one synchronous slow compile yields before any additional call and restores renderer state', async () => {
  const f = singles(basicFixture({ count: 5, readyDelay: 1, compileMs: 5000 }));
  const promise = f.run(); await f.flush(); assert.equal(f.compileCalls.length, 1);
  const receipt = await f.finish(promise); assert.equal(receipt.maxPreparesPerTurn, 1);
  assert(receipt.maxSinglePrepareMs >= 5000); assert(receipt.maxFullTurnMs >= 5000);
  assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});

test('backoff wait is clipped to the oldest immutable visible budget after one atomic call', async () => {
  const f = singles(basicFixture({ count: 2, readyDelay: 200000, compileMs: 89999 }));
  const promise = f.run(); await f.flush(); assert.equal(nextDelay(f), 1);
  const rejected = assert.rejects(promise, /timed out/); await f.timer(); await rejected;
  assert.equal(f.compileCalls.length, 1); assert.equal(f.ctx.performance.now(), 90000);
  assert(receiptOf(f).budgetClippedWaits > 0); f.clean();
});

test('capacity-idle backoff resets on completion/refill and listener wake cancels the old wait', async () => {
  const f = singles(basicFixture({ count: 8, readyDelay: 500 }));
  const promise = f.run(); await f.flush();
  for (let i = 0; i < 6 && nextDelay(f) < 100; i++) await f.timer();
  assert.equal(nextDelay(f), 100);
  f.programs[0].readyAt = f.ctx.performance.now(); await f.timer(); assert.equal(f.compileCalls.length, 5);
  assert.equal(nextDelay(f), 10);
  f.ctx.TITLE_RESIZE_PENDING = true; f.ctx.window.emit('resize'); await f.flush();
  assert(nextDelay(f) <= 10); const submitted = f.compileCalls.length;
  assert((await f.finish(promise)).stale); assert.equal(f.compileCalls.length, submitted); f.clean();
});

test('all entry reflections wait until every finite job is admitted and every sibling linked', async () => {
  const f = entryFixture({ shadows: 11, readyDelay: 1000 }), state = f.state();
  f.ctx.renderer.debug.checkShaderErrors = false;
  const promise = f.runEntry(); await f.flush(); const firstSubmitted = f.compileCalls.length;
  f.programs[0].readyAt = 10; await f.timer(); assert(f.compileCalls.length > firstSubmitted);
  assert.equal(f.reflections.length, 0);
  const receipt = await f.finish(promise);
  assert.equal(f.reflections.length, receipt.newPrograms); assert(receipt.reflectedPrograms > 4);
  assert(f.reflections.every(row => row.compiled === f.compileCalls.length && row.checked === true));
  assert(receipt.maxReflectionsPerTurn <= 4); assert(receipt.maxPending <= 4);
  assert.equal(f.ctx.renderer.debug.checkShaderErrors, false); assert.deepEqual(f.state(), state);
  assert.equal(f.currentTarget(), f.originalTarget); assert.equal(f.randomCalls(), 0);
  assert(f.errorChecks.every(count => count === 0)); f.clean();
});

test('an entry final GL error forbids every deferred initializer and leaves readiness unset', async () => {
  const f = entryFixture({ shadows: 11, readyDelay: 50 }), promise = f.runEntry();
  await f.flush(); f.errors.push(['0x0502']);
  await assert.rejects(f.finish(promise), /GL errors/);
  assert.equal(f.reflections.length, 0); assert.equal(receiptOf(f).completed, false);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined); f.clean();
});

for (const failure of ['reflection', 'reflectionGL', 'reflectionDiagnostics', 'reflectionDispose', 'reflectionContext'])
  test('global entry initialization keeps owned failure guards: ' + failure, async () => {
    const f = entryFixture({ shadows: 7, readyDelay: 20, failure });
    f.ctx.renderer.debug.checkShaderErrors = false;
    await assert.rejects(f.finish(f.runEntry()), /reflection|GL errors|diagnostics|disposed|context|Graphics stopped/i);
    assert.equal(f.ctx.renderer.debug.checkShaderErrors, false); assert.equal(receiptOf(f).completed, false); f.clean();
  });

test('a completed entry handle disposed before global reflection fails closed', async () => {
  const f = entryFixture({ shadows: 11, readyDelay: 1000 }), promise = f.runEntry();
  await f.flush(); const first = f.programs[0]; first.readyAt = 10; await f.timer();
  assert.equal(f.reflections.length, 0); first.program = null;
  await assert.rejects(f.finish(promise), /disposed before reflection/); f.clean();
});

test('late final entry completion defers optional initialization; remaining jobs still fail without more work', async () => {
  const final = entryFixture({ shadows: 0, readyDelay: 1 }), promise = final.runEntry();
  await final.flush(); await final.timer(200000); const receipt = await promise;
  assert(receipt.completed); assert.equal(receipt.reflectedPrograms, 0); assert(receipt.deferredReflections > 0); final.clean();
  const unfinished = entryFixture({ shadows: 11, readyDelay: 1 }), pending = unfinished.runEntry();
  await unfinished.flush(); const count = unfinished.compileCalls.length;
  const rejected = assert.rejects(pending, /time budget/); await unfinished.timer(200000); await rejected;
  assert.equal(unfinished.compileCalls.length, count); assert.equal(unfinished.reflections.length, 0); unfinished.clean();
});
