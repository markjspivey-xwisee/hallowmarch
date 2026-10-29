import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../../src/13_main.js', import.meta.url), 'utf8');
const render = readFileSync(new URL('../../src/02_render.js', import.meta.url), 'utf8');
const ambient = main.slice(main.indexOf('const HM_ERRORS ='), main.indexOf('/* ------------------------------------------------------------------ */'));
const extension = 'chrome-extension://ejbalbakoplchlghecdalmeeeajnimhm/scripts/inpage.js';
// Exact raw name/message/stack observed in the protected native Edge reload.
const observed = 'i: Failed to connect to MetaMask\n    at Object.connect (' + extension + ':7:84292)';

function fixture() {
  const handlers = new Map(), logged = [], window = { __hm: { ready: true }, addEventListener(type, handler) { handlers.set(type, handler); } };
  const ctx = { window, URL, console: { error: error => logged.push(error) }, GRAPHICS_STARTUP: {}, GRAPHICS_CONTEXT_LOST: false,
    GAME: { ready: true }, document: { getElementById: () => null } };
  vm.createContext(ctx); vm.runInContext(ambient, ctx);
  const api = vm.runInContext('({HM_ERRORS,HM_AMBIENT_ERRORS,extensionScriptURL,extensionOnlyStack,extensionOnlyCauseChain,extensionAmbientWindowError,reportError})', ctx);
  return { ctx, api, logged, emit(type, values = {}) {
    let prevented = false;
    const event = { isTrusted: true, target: window, currentTarget: window,
      preventDefault() { prevented = true; }, stopPropagation() { throw Error('ambient propagation must remain intact'); }, ...values };
    handlers.get(type)(event); assert.equal(prevented, false); return event;
  } };
}

test('the actual MetaMask extension-only ambient rejection stays out of game errors without hiding the browser event', () => {
  const f = fixture(); f.emit('unhandledrejection', { reason: { name: 'i', message: 'Failed to connect to MetaMask', stack: observed } });
  assert.equal(f.api.HM_ERRORS.length, 0); assert.equal(f.logged.length, 0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.ambientErrors.extensionRejection, 1);
  assert.equal(f.ctx.GAME.ready, true); assert.equal(f.ctx.GRAPHICS_STARTUP.stopped, undefined);
});

test('the native reload rejection proves its outer and cause stacks independently without changing either', () => {
  const f = fixture(), reason = Object.freeze({ name: 'i', message: 'Failed to connect to MetaMask', stack: observed,
    cause: Object.freeze({ name: 'Error', message: 'MetaMask extension not found',
      stack: 'Error: MetaMask extension not found\n    at ' + extension + ':4:42708' }) });
  const before = JSON.stringify(reason);
  f.emit('unhandledrejection', { reason }); f.emit('unhandledrejection', { reason });
  assert.equal(f.api.HM_ERRORS.length, 0); assert.equal(f.logged.length, 0);
  assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 2); assert.equal(JSON.stringify(reason), before);
  assert.equal(f.ctx.GAME.ready, true); assert.equal(f.ctx.GRAPHICS_STARTUP.stopped, undefined);
});

function chain(length, stack = observed) {
  const head = { stack }; let tail = head;
  for (let i = 1; i < length; i++) tail = tail.cause = { stack };
  return head;
}

test('cause proof permits at most eight independently verified nodes', () => {
  const f = fixture(); assert.equal(f.api.extensionOnlyCauseChain(chain(8)), true);
  assert.equal(f.api.extensionOnlyCauseChain(chain(9)), false);
});

test('cause proof enforces the total stack budget as well as the existing per-stack bound', () => {
  const f = fixture(), ending = '\n    at ' + extension + ':1:2';
  const full = 'Error: ' + 'x'.repeat(8192 - 7 - ending.length) + ending;
  assert.equal(full.length, 8192); assert.equal(f.api.extensionOnlyCauseChain(chain(4, full)), true);
  assert.equal(f.api.extensionOnlyCauseChain(chain(5, full)), false);
  assert.equal(f.api.extensionOnlyCauseChain({ stack: full + 'x' }), false);
});

for (const [name, cause] of Object.entries({
  null: null, primitive: 'unknown', number: 1, boolean: true, callable: () => {},
  absentStack: {}, emptyStack: { stack: '' }, nonStringStack: { stack: 3 },
  owned: { stack: 'Error: owned\n    at start (https://game.test/game.js:1:2)' },
  mixed: { stack: observed + '\n    at start (https://game.test/game.js:1:2)' },
  unknown: { stack: observed + '\n    unknown stack frame' }, aggregate: { stack: observed, errors: [] },
})) test('nested cause remains a game error: ' + name, () => {
  const f = fixture(); f.emit('unhandledrejection', { reason: { stack: observed, cause } });
  assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 0);
});

test('cycles, unreadable causal properties and aggregate trees fail closed', () => {
  const f = fixture(), self = { stack: observed }; self.cause = self;
  const first = { stack: observed }, second = { stack: observed, cause: first }; first.cause = second;
  assert.equal(f.api.extensionOnlyCauseChain(self), false); assert.equal(f.api.extensionOnlyCauseChain(first), false);
  for (const property of ['cause', 'stack', 'errors']) {
    const cause = { stack: observed }; Object.defineProperty(cause, property, { get() { throw Error('unreadable'); } });
    f.emit('unhandledrejection', { reason: { stack: observed, cause } });
  }
  assert.equal(f.api.HM_ERRORS.length, 1, 'ordinary error reporting still deduplicates the same outer stack');
  assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 0);
});

test('native extension filename corroborates a verified stack and unrelated messages do not determine origin', () => {
  const f = fixture();
  f.emit('error', { filename: extension, error: { stack: 'Error: Shader compiler failed\n    at async ' + extension + ':1:2\n    at Object.fn [as run] (' + extension + ':3:4)' } });
  assert.equal(f.api.HM_AMBIENT_ERRORS.extensionError, 1); assert.equal(f.api.HM_ERRORS.length, 0);
});

const rejectedStacks = {
  'app only': 'Error: Failed to connect to MetaMask\n    at start (https://game.test/game.js:1:2)',
  'mixed app and extension': observed + '\n    at start (https://game.test/game.js:1:2)',
  'unknown native frame': observed + '\n    at Array.map (<anonymous>)',
  'unknown frame': observed + '\n    unrecognized stack text',
  'eval frame': 'Error: rejected\n    at eval (' + extension + ':1:2)',
  'eval with app origin': observed + '\n    at eval (eval at start (https://game.test/game.js:1:2), <anonymous>:1:2)',
  'no frames': 'i: Failed to connect to MetaMask',
  'no header': '    at connect (' + extension + ':1:2)',
  'zero line': 'Error\n    at connect (' + extension + ':0:2)',
  'missing column': 'Error\n    at connect (' + extension + ':1)',
  'invalid extension ID': observed.replace('ejbalbakoplchlghecdalmeeeajnimhm', 'q'.repeat(32)),
  'short extension ID': observed.replace('ejbalbakoplchlghecdalmeeeajnimhm', 'a'.repeat(31)),
  'credentials': 'Error\n    at fn (chrome-extension://user@' + 'a'.repeat(32) + '/a.js:1:2)',
  'port': 'Error\n    at fn (chrome-extension://' + 'a'.repeat(32) + ':80/a.js:1:2)',
  'backslash': observed.replace('/scripts/', '/scripts\\'),
  'noncanonical URI': observed.replace('/scripts/', '/./scripts/'),
  'blob app': 'Error\n    at fn (blob:https://game.test/id:1:2)',
  'too many frames': observed + ('\n    at ' + extension + ':1:2').repeat(33),
  'oversized': 'Error: ' + 'x'.repeat(8192) + '\n    at ' + extension + ':1:2',
};
for (const [name, stack] of Object.entries(rejectedStacks)) test('ambient provenance fails closed: ' + name, () => {
  const f = fixture(); f.emit('unhandledrejection', { reason: { stack } });
  assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.logged.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 0);
});

for (const filename of ['https://game.test/game.js', 'file:///game.js', 'unknown', extension.replace('ejbalbakoplchlghecdalmeeeajnimhm', 'q'.repeat(32))])
test('a nonextension filename vetoes an otherwise extension-only stack: ' + filename.split(':')[0], () => {
  const f = fixture(); f.emit('error', { filename, error: { stack: observed } }); assert.equal(f.api.HM_ERRORS.length, 1);
});

test('an extension filename never hides mixed, unreadable or absent provenance', () => {
  const f = fixture(); f.emit('error', { filename: extension, error: { stack: rejectedStacks['mixed app and extension'] } });
  assert.equal(f.api.HM_ERRORS.length, 1);
  assert.equal(f.api.extensionAmbientWindowError({ isTrusted: true, target: f.ctx.window, currentTarget: f.ctx.window,
    get error() { throw Error('unreadable'); } }, 'error'), false);
  f.emit('unhandledrejection', { reason: observed }); assert.equal(f.api.HM_ERRORS.length, 2, 'a string payload is not stack evidence');
});

for (const reason of [null, 'unknown rejection', {}, { stack: '' }]) test('a rejection cannot borrow a filename instead of actual stack provenance', () => {
  const f = fixture(); f.emit('unhandledrejection', { filename: extension, reason });
  assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 0);
});

for (const error of [undefined, null, 'unknown error', {}, { stack: null }, { stack: '' }]) test('an error filename alone cannot establish extension-only provenance', () => {
  const f = fixture(); f.emit('error', { filename: extension, error, message: 'Unknown error' });
  assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionError, 0);
});

for (const change of ['synthetic', 'foreign target', 'foreign currentTarget', 'cause', 'aggregate']) test('only proven native window events qualify: ' + change, () => {
  const f = fixture(), values = { reason: { stack: observed } };
  if (change === 'synthetic') values.isTrusted = false;
  if (change === 'foreign target') values.target = {};
  if (change === 'foreign currentTarget') values.currentTarget = {};
  if (change === 'cause') values.reason.cause = { stack: rejectedStacks['app only'] };
  if (change === 'aggregate') values.reason.errors = [{ stack: rejectedStacks['app only'] }];
  f.emit('unhandledrejection', values); assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 0);
});

test('extension diagnostics retain only bounded generic counts, without error messages, IDs or URLs', () => {
  const f = fixture(); for (let i = 0; i < 300; i++) {
    f.emit('error', { filename: extension, error: { stack: observed } }); f.emit('unhandledrejection', { reason: { stack: observed } });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(f.ctx.GRAPHICS_STARTUP.ambientErrors)), { extensionError: 255, extensionRejection: 255 });
  assert.equal(f.api.HM_ERRORS.length, 0); assert.equal(f.logged.length, 0);
});

test('directly caught owned errors retain their original reporting even when their reason looks foreign', () => {
  const f = fixture(), error = { stack: observed }; f.api.reportError(error);
  assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.logged[0], error); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionRejection, 0);
});

test('direct owned boot failure remains stopped and unready with a foreign-shaped reason', () => {
  const f = fixture(), start = main.indexOf('function bootStartFailure(');
  vm.runInContext(main.slice(start, main.indexOf('\nboot().catch', start)), f.ctx);
  f.ctx.bootStartFailure({ stack: observed });
  assert.equal(f.ctx.GRAPHICS_STARTUP.stopped, true); assert.equal(f.ctx.GAME.ready, false); assert.equal(f.ctx.window.__hm.ready, false);
  assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionError, 0);
});

test('owned render catches and real graphics context loss do not use ambient filtering', () => {
  const f = fixture(), start = main.indexOf('function frame(now)');
  Object.assign(f.ctx, { lastNow: 0, requestAnimationFrame() {}, tick() { throw { stack: observed }; } });
  vm.runInContext(main.slice(start, main.indexOf('/* ------------------------------------------------------------------ */', start)), f.ctx);
  f.ctx.frame(16); assert.equal(f.api.HM_ERRORS.length, 1); assert.equal(f.api.HM_AMBIENT_ERRORS.extensionError, 0);
  const position = render.indexOf('function graphicsAssertActive()');
  vm.runInContext(render.slice(position, render.indexOf('\n}', position) + 2), f.ctx);
  f.ctx.GRAPHICS_CONTEXT_LOST = true;
  assert.throws(() => f.ctx.graphicsAssertActive(), /Graphics stopped/);
});
