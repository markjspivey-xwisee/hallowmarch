import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { installReadinessResponsivenessProbe, sampleTrustedReadinessInputs } from '../readiness_responsiveness.mjs';

// CPU fixtures test bounded accounting/cleanup only. Mock trust and visibility
// values here are not browser responsiveness or native-input evidence.
function fixture({ supportedEntries = ['longtask', 'event', 'long-animation-frame'] } = {}) {
  let now = 0, nextFrame = 0, focused = true;
  const frames = new Map(), windowListeners = new Map(), documentListeners = new Map(), nodes = [], observers = [];
  const events = map => ({ addEventListener(name, fn) { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(fn); },
    removeEventListener(name, fn) { map.get(name)?.delete(fn); } });
  const document = { hidden: false, hasFocus: () => focused, ...events(documentListeners),
    documentElement: { appendChild(node) { nodes.push(node); } },
    createElement: () => ({ style: {}, textContent: '', setAttribute() {}, remove() { nodes.splice(nodes.indexOf(this), 1); } }) };
  const window = { ...events(windowListeners), __hmStartup: { phase: 'world' } };
  const ctx = { window, document, performance: { now: () => now, timeOrigin: 100000 },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    PerformanceObserver: class { static supportedEntryTypes = supportedEntries;
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(options) { this.options = options; } disconnect() { this.disconnected = true; } } };
  vm.createContext(ctx); vm.runInContext('(' + installReadinessResponsivenessProbe.toString() + ')();', ctx);
  return { ctx, window, document, frames, nodes, observers,
    at: value => { now = value; }, focus: value => { focused = value; },
    frame(at, stamp = at) { now = at; const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(stamp); },
    key(type = 'keydown', changes = {}) { let prevented = 0, stopped = 0;
      const event = { type, code: 'F8', isTrusted: true, timeStamp: now, repeat: false,
        preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; }, ...changes };
      for (const callback of windowListeners.get(type) || []) callback(event);
      return { prevented, stopped };
    },
    visibility(hidden) { document.hidden = hidden; for (const callback of documentListeners.get('visibilitychange') || []) callback(); },
    entry(type, entry) { const observer = observers.find(value => value.options.type === type); observer.callback({ getEntries: () => [entry] }); },
    snapshot: () => JSON.parse(JSON.stringify(window.__readinessResponsive.snapshot())),
    stop: () => JSON.parse(JSON.stringify(window.__readinessResponsive.stop())),
    listenerCount: () => [...windowListeners.values(), ...documentListeners.values()].reduce((count, set) => count + set.size, 0) };
}

test('cadence records real observed phases at both ends and distinguishes hidden intervals', () => {
  const f = fixture(); f.frame(16); f.frame(32);
  f.window.__hmStartup.phase = 'mountains'; f.frame(500);
  f.document.hidden = true; f.frame(1500); f.document.hidden = false; f.frame(2500); f.frame(2516);
  const s = f.stop(); assert.equal(s.firstRafDelayMs, 16); assert.equal(s.frames.visible, 3); assert.equal(s.frames.background, 2);
  assert.equal(s.frames.maxCallbackGapMs, 468); assert.equal(s.frames.histogram.reduce((sum, value) => sum + value, 0), 3);
  const gap = s.frames.worst.find(row => row.visible); assert.equal(gap.phaseFrom, 'world'); assert.equal(gap.phaseTo, 'mountains');
  assert(s.frames.worst.some(row => !row.visible && row.ms === 1000)); assert.equal(f.listenerCount(), 0); assert.equal(f.frames.size, 0);
});

test('callback lag and timestamp cadence are recorded separately', () => {
  const f = fixture(); f.frame(16, 10); f.frame(60, 30); const s = f.stop();
  assert.equal(s.frames.maxCallbackGapMs, 44); assert.equal(s.frames.maxTimestampGapMs, 20); assert.equal(s.frames.maxCallbackLagMs, 30);
});

test('a hidden interval between two visible frames is never counted as foreground starvation', () => {
  const f = fixture(); f.frame(16); f.at(20); f.visibility(true); f.at(2000); f.visibility(false); f.frame(2016);
  const s = f.stop(); assert.equal(s.frames.visible, 0); assert.equal(s.frames.background, 1); assert.equal(s.frames.maxCallbackGapMs, 0);
  assert.equal(s.frames.worst[0].visible, false);
});

test('trusted diagnostic input is acknowledged without reaching game listeners and records two later frame opportunities', () => {
  const f = fixture(); f.frame(16); f.at(100); const event = f.key('keydown', { timeStamp: 80 });
  assert.deepEqual(event, { prevented: 1, stopped: 1 }); f.at(105); f.key('keyup'); f.frame(120); f.frame(136);
  const s = f.stop(), input = s.inputs[0]; assert.equal(input.trusted, true); assert.equal(input.inputDelayMs, 20);
  assert.equal(input.nextFrameOpportunityMs, 20); assert.equal(input.secondFrameOpportunityMs, 36); assert.equal(input.keyupAt, 105);
  assert.equal(input.focused, true); assert.equal(input.hidden, false); assert.equal(f.nodes.length, 0); assert.equal(f.frames.size, 0);
});

test('synthetic and unrelated keys cannot masquerade as a trusted sample', () => {
  const f = fixture(); f.key('keydown', { isTrusted: false }); assert.deepEqual(f.key('keydown', { code: 'KeyW' }), { prevented: 0, stopped: 0 });
  const s = f.stop(); assert.equal(s.inputs.length, 0); assert.equal(s.syntheticInputsIgnored, 1);
});

test('invalid timestamps stay unavailable and real epoch timestamps are normalized explicitly', () => {
  const f = fixture(); f.at(100); f.key('keydown', { timeStamp: 100080 }); f.key('keyup');
  f.at(150); f.key('keydown', { timeStamp: 9999999999 }); const s = f.stop();
  assert.equal(s.inputs[0].inputDelayMs, 20); assert.equal(s.inputs[1].eventAt, null); assert.equal(s.inputs[1].inputDelayMs, null);
});

test('incomplete frame acknowledgments and unfocused/hidden input remain visible in the evidence', () => {
  const f = fixture(); f.document.hidden = true; f.focus(false); f.at(10); f.key(); const s = f.stop();
  assert.equal(s.inputs[0].hidden, true); assert.equal(s.inputs[0].focused, false);
  assert.equal(s.inputs[0].nextFrameOpportunityMs, null); assert.equal(s.inputs[0].secondFrameOpportunityMs, null);
});

test('input count, worst-gap lists, observer storage and phase observations are bounded', () => {
  const f = fixture(); for (let i = 0; i < 300; i++) {
    f.window.__hmStartup.phase = 'phase-' + i; f.frame((i + 1) * 100); f.key(); f.key('keyup');
    f.entry('longtask', { startTime: i, duration: 50 + i, name: 'self' });
    f.entry('event', { name: 'keydown', startTime: i, duration: 20 + i, processingStart: i + 5, processingEnd: i + 6, interactionId: i });
  }
  const s = f.stop(); assert.equal(s.inputs.length, 12); assert.equal(s.excessInputs, 288); assert(s.observations.length <= 256);
  assert.equal(s.frames.worst.length, 32); assert.equal(s.longTasks.worst.length, 32); assert.equal(s.eventTiming.worst.length, 32);
  assert.equal(s.longTasks.count, 300); assert.equal(s.longTasks.maxMs, 349); assert.equal(s.eventTiming.count, 300);
  assert.equal(s.longTasks.worst[0].start, 299); assert.equal(s.longTasks.worst[0].deliveryPhase, 'phase-299');
  assert.equal(f.frames.size, 0); assert(f.observers.every(value => value.disconnected));
});

test('stop is idempotent and captured late callbacks cannot restart monitoring', () => {
  const f = fixture(), callbacks = [...f.frames.values()]; f.at(20); const first = f.stop();
  for (const callback of callbacks) callback(50); assert.deepEqual(f.stop(), first); assert.equal(f.frames.size, 0); assert.equal(f.listenerCount(), 0);
  for (const value of f.observers) value.callback({ getEntries: () => [{ startTime: 0, duration: 999 }] });
  assert.equal(f.snapshot().longTasks.count, 0);
});

test('long animation frame attribution bounds entries/scripts/text and retains no window references', () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) f.entry('long-animation-frame', { startTime: i * 100, duration: 60 + i,
    blockingDuration: i, renderStart: i * 100 + 50, styleAndLayoutStart: i * 100 + 55,
    scripts: Array.from({ length: 100 }, (_, index) => ({ startTime: index, duration: index + 1, sourceURL: 'a'.repeat(1000),
      sourceFunctionName: 'b'.repeat(200), invoker: 'c'.repeat(300), window: f.window })) });
  const s = f.stop().longAnimationFrames; assert.equal(s.supported, true); assert.equal(s.unavailableReason, null);
  assert.equal(s.count, 60); assert.equal(s.worst.length, 16); assert.equal(s.maxMs, 119);
  assert.equal(s.worst[0].scriptCount, 100); assert.equal(s.worst[0].scripts.length, 8); assert.equal(s.worst[0].scriptsTruncated, true);
  for (const script of s.worst[0].scripts) {
    assert.equal(script.sourceURL.length, 500); assert.equal(script.sourceFunctionName.length, 100); assert.equal(script.invoker.length, 150);
    assert.equal(script.forcedStyleAndLayoutMs, null); assert(!('window' in script));
  }
});

test('unsupported long animation frame timing is explicit and never mistaken for zero-duration success', () => {
  const f = fixture({ supportedEntries: ['longtask', 'event'] }), s = f.stop();
  assert.equal(s.longAnimationFrames.supported, false); assert.equal(s.longAnimationFrames.unavailableReason, 'unsupported-or-observer-registration-failed');
  assert(!f.observers.some(observer => observer.options.type === 'long-animation-frame'));
});

test('host sampler sends only bounded real keyboard commands in order', async () => {
  const keys = [], page = { keyboard: { async press(key) { keys.push(key); } } };
  const result = await sampleTrustedReadinessInputs(page, { maxSamples: 3, intervalMs: 1, timeoutMs: 100 });
  assert.deepEqual(keys, ['F8', 'F8', 'F8']); assert.equal(result.samples.length, 3); assert(result.samples.every(value => value.deliveredCommand));
  assert.equal(result.timedOut, false);
});

test('the diagnostic key is supported by the actual installed Playwright keyboard table', async () => {
  const require = createRequire(import.meta.url), { USKeyboardLayout } = require('../node_modules/playwright-core/lib/server/usKeyboardLayout.js');
  const result = await sampleTrustedReadinessInputs({ keyboard: { async press() {} } }, { maxSamples: 1 });
  assert(USKeyboardLayout[result.key], 'do not accept mocked keyboard success for an unsupported key');
  assert.equal(USKeyboardLayout[result.key].key, 'F8');
});

test('a timed-out host command never overlaps a retry or next sample', async () => {
  let calls = 0; const page = { keyboard: { press() { calls++; return new Promise(() => {}); } } };
  const result = await sampleTrustedReadinessInputs(page, { maxSamples: 3, intervalMs: 1, timeoutMs: 5 });
  assert.equal(calls, 1); assert.equal(result.samples.length, 1); assert.equal(result.timedOut, true); assert.equal(result.samples[0].deliveredCommand, false);
});

test('host cancellation removes the next scheduled sample without requesting focus or more input', async () => {
  const controller = new AbortController(); let calls = 0;
  const page = { keyboard: { async press() { calls++; controller.abort(); } } };
  const result = await sampleTrustedReadinessInputs(page, { maxSamples: 3, intervalMs: 1, timeoutMs: 100, signal: controller.signal });
  assert.equal(calls, 1); assert.equal(result.aborted, true);
  const before = await sampleTrustedReadinessInputs(page, { signal: controller.signal }); assert.equal(before.samples.length, 0); assert.equal(calls, 1);
});

test('invalid host bounds fail before dispatching any event', async () => {
  const page = { keyboard: { press() { throw Error('must not dispatch'); } } };
  for (const options of [{ maxSamples: 13 }, { intervalMs: 0 }, { timeoutMs: 10001 }]) await assert.rejects(sampleTrustedReadinessInputs(page, options), /Invalid bounded/);
});
