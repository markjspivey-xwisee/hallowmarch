import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';

const source = readFileSync(process.env.HM_MENU_KEY_SOURCE || new URL('../../src/10_ui.js', import.meta.url), 'utf8');
const tree = parse(source, {ecmaVersion: 'latest'});
const helper = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'menuReadingKey');
const handler = tree.body.find(n => n.type === 'ExpressionStatement' && n.expression.callee?.property?.name === 'addEventListener'
  && n.expression.callee.object?.callee?.name === '$' && n.expression.callee.object.arguments[0]?.value === 'menu-body'
  && n.expression.arguments[0]?.value === 'keydown');
assert(handler, 'Use the actual delegated menu-body handler');
const audit = readFileSync(new URL('./menu_usability.py', import.meta.url), 'utf8');
const panelScroll = audit.match(/\nPANEL_SCROLL_QA=r"""([\s\S]*?)"""/)[1];
const productCode = (helper ? source.slice(helper.start, helper.end) : '') + '\n' + source.slice(handler.start, handler.end);

function fixture({tab = 'help', modal = 'menu'} = {}) {
  const surface = () => { const listeners = new Map(); return {listeners,
    addEventListener(type, fn, options) {if (!listeners.has(type)) listeners.set(type, new Map()); listeners.get(type).set(fn, !!options?.capture);},
    removeEventListener(type, fn, capture = false) {if (listeners.get(type)?.get(fn) === capture) listeners.get(type).delete(fn);}}; };
  const scrolls = [], node = Object.assign(surface(), {id: 'menu-body', scrollTop: 7708, scrollHeight: 8289, clientHeight: 581, isConnected: true,
    scrollTo(options) {scrolls.push(options); this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight));}});
  let current = node, radioCalls = 0;
  const document = Object.assign(surface(), {activeElement: node, getElementById: () => current, querySelector: () => null});
  const UI = {menuTab: tab, modal}, window = {}, microtasks = [];
  new Function('$', 'UI', 'document', 'menuRadioKey', productCode)(() => current, UI, document, () => radioCalls++);
  new Function('window', 'document', 'performance', 'queueMicrotask', panelScroll)(window, document, {now: () => 100}, fn => microtasks.push(fn));
  const event = (key, patch = {}) => ({key, timeStamp: 100, isTrusted: true, currentTarget: node, target: node, defaultPrevented: false,
    preventDefault() {this.defaultPrevented = true;}, ...patch});
  const key = (name, patch = {}) => {const e = event(name, patch);
    for (const [fn, capture] of document.listeners.get('keydown') || []) if (capture) fn(e);
    for (const [fn] of node.listeners.get('keydown') || []) fn(e);
    for (const [fn, capture] of document.listeners.get('keydown') || []) if (!capture) fn(e);
    while (microtasks.length) microtasks.shift()(); return e;};
  const emit = (type, stamp = 101, patch = {}) => {for (const [fn] of node.listeners.get(type) || []) fn({type, timeStamp: stamp, isTrusted: true, target: node, ...patch});};
  return {node, document, UI, scrolls, key, emit, api: window.__menuPanelScrollQA,
    replace() {current = {...node};}, get radioCalls() {return radioCalls;}};
}

test('owned standalone reading-panel Home and End have an explicit first/last action even without a native default', () => {
  for (const tab of ['help', 'char', 'chronicle', 'progress', 'companion']) {
    const f = fixture({tab});
    const home = f.key('Home'); assert.equal(f.node.scrollTop, 0, tab); assert.equal(home.defaultPrevented, true);
    assert.deepEqual(f.scrolls[0], {top: 0, behavior: 'instant'});
    const end = f.key('End'); assert.equal(f.node.scrollTop, 7708); assert.equal(end.defaultPrevented, true);
    assert.deepEqual(f.scrolls[1], {top: 8289, behavior: 'instant'});
    assert.equal(f.document.activeElement, f.node); assert.equal(f.radioCalls, 0);
  }
});

test('modifiers, composition, other keys and a previously cancelled key preserve their existing behavior', () => {
  for (const patch of [{altKey: true}, {ctrlKey: true}, {metaKey: true}, {shiftKey: true}, {isComposing: true}, {defaultPrevented: true}]) {
    const f = fixture(), e = f.key('Home', patch); assert.equal(f.scrolls.length, 0); assert.equal(e.defaultPrevented, !!patch.defaultPrevented);
  }
  for (const key of ['PageDown', 'PageUp', 'ArrowDown', 'Tab', 'Escape', 'Enter', ' ']) {
    const f = fixture(); assert.equal(f.key(key).defaultPrevented, false); assert.equal(f.scrolls.length, 0);
  }
});

test('only the current connected reading panel itself can own either key', () => {
  for (const key of ['Home', 'End']) for (const setup of [f => {f.node.isConnected = false;}, f => {f.UI.modal = null;},
    f => {f.document.activeElement = {};}, f => f.replace()]) {
    const f = fixture(); setup(f); assert.equal(f.key(key).defaultPrevented, false); assert.equal(f.scrolls.length, 0);
  }
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'DIV']) {
    const f = fixture(); assert.equal(f.key('Home', {target: {tagName, isContentEditable: true}}).defaultPrevented, false); assert.equal(f.scrolls.length, 0);
  }
  const f = fixture(); assert.equal(f.key('End', {currentTarget: {id: 'menu-tabs'}}).defaultPrevented, false); assert.equal(f.scrolls.length, 0);
});

test('Settings keeps its actual radio-key route and cannot invoke reading scroll', () => {
  for (const key of ['Home', 'End', 'ArrowRight']) {
    const f = fixture({tab: 'settings'}); assert.equal(f.key(key).defaultPrevented, false); assert.equal(f.radioCalls, 1); assert.equal(f.scrolls.length, 0);
  }
});

test('QA explicitly distinguishes owned cancellation from native default, retaining movement/end/focus requirements', () => {
  for (const key of ['Home', 'End']) {
    const f = fixture(); if (key === 'End') f.node.scrollTop = 0;
    f.api.startKey(key, 'panel'); const e = f.key(key); assert.equal(e.defaultPrevented, true);
    assert.equal(f.api.keyComplete(true), false, 'A handled key alone is insufficient');
    f.emit('scroll'); assert.equal(f.api.keyComplete(true), false, 'Actual native end is still mandatory');
    f.emit('scrollend', 102); assert.equal(f.api.keyComplete(true), true);
    assert.equal(f.api.keyReceipt().mode, 'panel'); assert.equal(f.api.keyReceipt().down.prevented, true);
    assert.equal(f.api.keyReceipt().down.top, key === 'Home' ? 7708 : 0, 'Real capture position precedes the owned target action');
    f.document.activeElement = {}; assert.equal(f.api.keyComplete(true), false, 'Focus cannot leave the owned panel');
    const before = f.api.keyReceipt(); f.api.finish('key');
    assert.equal(f.document.listeners.get('keydown').size, 0, 'Capture and bubble observers both detach with exact options');
    f.key(key); assert.equal(f.api.keyReceipt().events.length, before.events.length);
  }
  const native = fixture(); native.node.scrollTop = 0; native.api.startKey('PageDown'); const e = native.key('PageDown');
  assert.equal(e.defaultPrevented, false); native.node.scrollTop = 480; native.emit('scroll'); native.emit('scrollend', 102); assert.equal(native.api.keyComplete(true), true);
  assert.throws(() => native.api.startKey('PageDown', 'panel'), /Unsupported/);
  assert.throws(() => native.api.startKey('Home', 'anything'), /Unsupported/);
  const wrong = fixture(); wrong.api.startKey('Home'); wrong.key('Home'); wrong.emit('scroll'); wrong.emit('scrollend', 102);
  assert.equal(wrong.api.keyComplete(true), false, 'The native mode cannot accept an intentional cancellation');
});

test('owned-mode observer refuses synthetic/foreign keys, missing movement and missing or synthetic end', () => {
  for (const patch of [{isTrusted: false}, {target: {}}]) {
    const f = fixture(); f.api.startKey('Home', 'panel'); f.key('Home', patch); f.node.scrollTop = 0; f.emit('scroll'); f.emit('scrollend', 102); assert.equal(f.api.keyComplete(true), false);
  }
  const still = fixture(); still.node.scrollTop = 0; still.api.startKey('Home', 'panel'); still.key('Home'); still.emit('scroll'); still.emit('scrollend', 102); assert.equal(still.api.keyComplete(true), false);
  const noEnd = fixture(); noEnd.api.startKey('Home', 'panel'); noEnd.key('Home'); noEnd.emit('scroll'); noEnd.emit('scrollend', 102, {isTrusted: false}); assert.equal(noEnd.api.keyComplete(true), false);
});

test('existing captured native event ordering/position/watermark boundaries remain intact', () => {
  const browser = readFileSync(new URL('./chronicle_navigation.browser.test.mjs', import.meta.url), 'utf8'), ast = parse(browser, {ecmaVersion: 'latest', sourceType: 'module'});
  const names = ['nativeKeyFactFixture', 'verifyNativeKeyFactOrdering', 'verifyNativeKeyFinalPosition', 'verifyNativeKeyReceiptBoundaries'];
  const extracted = names.map(name => {const n = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); assert(n, name); return browser.slice(n.start, n.end);}).join('\n');
  new Function('assert', 'panelScroll', extracted + '\nverifyNativeKeyFactOrdering();verifyNativeKeyFinalPosition();verifyNativeKeyReceiptBoundaries();')(assert, panelScroll);
});

test('public wait budgets and exact position checks are unchanged; no polling or gameplay in product helper', () => {
  assert(audit.includes("scrollTop<=2\",scrollable)"));
  const wait = audit.slice(audit.indexOf('            async def panel_key('), audit.indexOf('            for viewport in'));
  assert.equal((wait.match(/timeout=5000,polling=50/g) || []).length, 2);
  assert(wait.includes("['Home','End'].includes(key)?'panel':'native'"));
  assert(helper); const text = source.slice(helper.start, helper.end);
  for (const forbidden of ['setTimeout', 'requestAnimationFrame', 'GAME', 'SAVE', 'Math.random', 'getBoundingClientRect', 'querySelectorAll']) assert(!text.includes(forbidden), forbidden);
});
