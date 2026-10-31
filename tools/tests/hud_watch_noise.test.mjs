// Actual registered observer callbacks in an isolated VM; no browser, game or services.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'acorn';

const source = readFileSync(new URL('../../src/10p_hud.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const previous = String.raw`  const noise = (m) => m.attributeName === 'class' && String(m.oldValue || '').replace(/\s*\bhl-[a-z]+\b/g, '').trim() === String(m.target.className || '').replace(/\s*\bhl-[a-z]+\b/g, '').trim();`;
const replacement = String.raw`  const ownedClasses = new Set(['hl-compact', 'hl-off', 'hl-brief', 'hl-brief1', 'hl-old']);
  const unownedClasses = (value) => String(value || '').split(/[\t\n\f\r ]+/).filter((token) => token && !ownedClasses.has(token)).join(' ');
  const noise = (m) => m.attributeName === 'class' && unownedClasses(m.oldValue) === unownedClasses(m.target.className);`;
const original = source.replace(replacement, previous), sha = text => createHash('sha256').update(text).digest('hex');
const owned = ['hl-compact', 'hl-off', 'hl-brief', 'hl-brief1', 'hl-old'];
const host = value => JSON.parse(JSON.stringify(value));
function select(input, name) {
  const rows = parse(input, {ecmaVersion: 'latest'}).body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name
    || node.type === 'VariableDeclaration' && node.declarations.some(row => row.id.name === name));
  assert.equal(rows.length, 1, name); return input.slice(rows[0].start, rows[0].end);
}
function fixture({old = false, resize = true, mutation = true, elementLimit = Infinity} = {}) {
  const elements = new Map(), registrations = {resize: [], mutation: [], events: []};
  let resizeCallback, mutationCallback, resizeConstructed = 0, mutationConstructed = 0, queries = 0;
  class Resize {
    constructor(callback) {resizeConstructed++; resizeCallback = callback;}
    observe(element) {registrations.resize.push(element);}
  }
  class Mutation {
    constructor(callback) {mutationConstructed++; mutationCallback = callback;}
    observe(element, options) {registrations.mutation.push({element, options: host(options)});}
  }
  const node = selector => {
    if (!elements.has(selector)) elements.set(selector, {id: selector.slice(1), className: 'panel'});
    return elements.get(selector);
  };
  const c = vm.createContext({ResizeObserver: resize ? Resize : undefined, MutationObserver: mutation ? Mutation : undefined,
    document: {querySelector: selector => ++queries <= elementLimit ? node(selector) : null},
    addEventListener: (name, callback) => registrations.events.push({name, callback})});
  vm.runInContext(['HUD_ORDER', 'HUDL5', 'HUD_WATCH', 'hudWatch'].map(name => select(old ? original : source, name)).join('\n')
    + '\nglobalThis.view={HUDL5,HUD_WATCH,hudWatch};', c);
  c.view.hudWatch();
  const arm = (dirty = false, why = 'armed') => {c.view.HUDL5.dirty = dirty; c.view.HUDL5.why = why;};
  const record = ({oldValue = 'panel', current = 'panel', attributeName = 'class', type = 'attributes', selector = '#banners'} = {}) => {
    const target = node(selector); target.className = current; return {type, attributeName, oldValue, target};
  };
  return {view: c.view, elements, registrations, node, arm, record,
    deliver: records => {assert.equal(typeof mutationCallback, 'function'); mutationCallback(records);},
    deliverResize: entries => {assert.equal(typeof resizeCallback, 'function'); resizeCallback(entries);},
    constructed: () => ({resize: resizeConstructed, mutation: mutationConstructed})};
}

test('the complete module inverse is exact; the layout and every other helper stay literal', () => {
  assert.equal(source.split(replacement).length, 2, 'One bounded local replacement');
  assert.equal(sha(original), '4f55cdd3f3a26d99fe2b617e7f351f4a442f6813ee9995f75c9a7f48eeadcb27');
  for (const name of ['hudLayout', 'hudReset', 'hudShown', 'hudRect', 'hudSafe', 'hudHeld']) assert.equal(select(source, name), select(original, name), name);
  const tokens = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && ['add', 'remove', 'toggle'].includes(node.callee?.property?.name)
      && node.callee.object?.property?.name === 'classList') {
      for (const arg of node.arguments) if (arg.type === 'Literal' && typeof arg.value === 'string' && arg.value.startsWith('hl-')) tokens.add(arg.value);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  };
  walk(parse(source, {ecmaVersion: 'latest'})); assert.deepEqual([...tokens].sort(), [...owned].sort(), 'Finite actual layout-owned token inventory');
});
test('the original registered callback exposes the numeric-class regression; the candidate ignores it', () => {
  const old = fixture({old: true}), next = fixture();
  for (const f of [old, next]) {f.arm(); f.deliver([f.record({oldValue: 'panel', current: 'panel hl-brief1'})]);}
  assert.equal(old.view.HUDL5.dirty, true); assert.equal(old.view.HUDL5.why, 'banners:class');
  assert.equal(next.view.HUDL5.dirty, false); assert.equal(next.view.HUDL5.why, 'armed');
});
test('each exact owned token can be added or removed without requesting another layout', () => {
  for (const token of owned) for (const remove of [false, true]) {
    const f = fixture(); f.arm(); f.deliver([f.record({oldValue: remove ? 'panel ' + token : 'panel', current: remove ? 'panel' : 'panel ' + token})]);
    assert.equal(f.view.HUDL5.dirty, false, token + (remove ? ' remove' : ' add')); assert.equal(f.view.HUDL5.why, 'armed');
  }
});
test('two reset/reapply-shaped native batches no longer self-redirty at a stable final brief1 class', () => {
  for (const old of [false, true]) {
    const f = fixture({old});
    for (let pass = 0; pass < 2; pass++) {
      f.arm(); const current = 'panel hl-brief1';
      f.deliver(['panel hl-brief1', 'panel', 'panel hl-brief', 'panel'].map(oldValue => f.record({oldValue, current})));
      assert.equal(f.view.HUDL5.dirty, old); assert.equal(f.view.HUDL5.why, old ? 'banners:class' : 'armed');
    }
  }
});
test('real class and class order changes still invalidate, including after an own-only first record', () => {
  for (const [oldValue, current] of [['panel', 'panel selected hl-brief1'], ['panel selected hl-off', 'panel hl-off'], ['a b', 'b a hl-brief1']]) {
    const f = fixture(); f.arm();
    const noise = f.record({oldValue: 'panel', current: 'panel hl-off', selector: '#pf'}), real = f.record({oldValue, current});
    f.deliver([noise, real]); assert.equal(f.view.HUDL5.dirty, true); assert.equal(f.view.HUDL5.why, 'banners:class');
  }
});
test('hidden and childList changes always invalidate with the original reason format', () => {
  for (const options of [{attributeName: 'hidden'}, {type: 'childList', attributeName: null, selector: '#tpad'}]) {
    const f = fixture(); f.arm(); f.deliver([f.record(options)]);
    assert.equal(f.view.HUDL5.dirty, true); assert.equal(f.view.HUDL5.why, options.type === 'childList' ? 'tpad:childList' : 'banners:hidden');
  }
});
test('lookalike or embedded unowned tokens never disappear as an owned prefix', () => {
  for (const token of ['hl-brief11', 'hl-brief1-extra', 'hl-off2', 'hl-compactness', 'hl-offline', 'foo-hl-brief1', 'x\u00a0hl-brief1', 'x\vhl-brief1', '\u00a0']) {
    const f = fixture(); f.arm(); f.deliver([f.record({oldValue: 'panel', current: 'panel ' + token})]);
    assert.equal(f.view.HUDL5.dirty, true, JSON.stringify(token)); assert.equal(f.view.HUDL5.why, 'banners:class');
  }
});
test('only DOM ASCII whitespace separates tokens; null and ordinary empty class values remain safe', () => {
  for (const space of [' ', '\t', '\n', '\f', '\r', ' \t\n']) {
    const f = fixture(); f.arm(); f.deliver([f.record({oldValue: 'panel', current: space + 'panel' + space + 'hl-brief1' + space})]);
    assert.equal(f.view.HUDL5.dirty, false, JSON.stringify(space));
  }
  for (const oldValue of [null, '']) {const f = fixture(); f.arm(); f.deliver([f.record({oldValue, current: 'hl-brief1'})]); assert.equal(f.view.HUDL5.dirty, false);}
});
test('noise never clears an existing dirty state or changes its reason/counters', () => {
  const f = fixture(); f.arm(true, 'real-change');
  const before = {passes: f.view.HUDL5.passes, held: f.view.HUDL5.held, wake: f.view.HUDL5.wake, whys: host(f.view.HUDL5.whys)};
  f.deliver([f.record({oldValue: 'panel', current: 'panel hl-brief1 hl-off'})]);
  assert.equal(f.view.HUDL5.dirty, true); assert.equal(f.view.HUDL5.why, 'real-change');
  for (const key of ['passes', 'held', 'wake']) assert.equal(f.view.HUDL5[key], before[key]);
  assert.deepEqual(host(f.view.HUDL5.whys), before.whys);
});
test('observer targets/options, resize threshold, initialization guards and resize invalidation are retained', () => {
  const f = fixture(); assert.deepEqual(f.constructed(), {resize: 1, mutation: 1});
  const expected = host(f.view.HUD_WATCH); assert.equal(f.registrations.resize.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    const row = f.registrations.mutation[i]; assert.equal(row.element, f.node(expected[i]));
    assert.deepEqual(row.options, {attributes: true, attributeFilter: ['class', 'hidden'], attributeOldValue: true,
      childList: ['banners', 'tpad'].includes(row.element.id), subtree: ['banners', 'tpad'].includes(row.element.id)});
  }
  f.view.hudWatch(); assert.deepEqual(f.constructed(), {resize: 1, mutation: 1});
  const target = f.node('#pf'); f.arm(); f.deliverResize([{target, contentRect: {width: 100, height: 40}}]); assert.equal(f.view.HUDL5.dirty, true);
  f.arm(); f.deliverResize([{target, contentRect: {width: 100.75, height: 40.75}}]); assert.equal(f.view.HUDL5.dirty, false);
  f.deliverResize([{target, contentRect: {width: 100.751, height: 40}}]); assert.equal(f.view.HUDL5.dirty, true);
  f.arm(); assert.equal(f.registrations.events[0].name, 'resize'); f.registrations.events[0].callback(); assert.equal(f.view.HUDL5.dirty, true);
  for (const options of [{resize: false}, {mutation: false}, {elementLimit: 5}]) {
    const unavailable = fixture(options); assert.deepEqual(unavailable.constructed(), {resize: 0, mutation: 0});
  }
});
