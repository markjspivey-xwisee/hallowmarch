import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRollingHistory, decodeRollingHistory, ROLLING_HISTORY_CODEC } from './rolling-history-codec.js';

const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']'
  : x !== null && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
const document = checkpoints => ({ schema: 'logical-document', owner: 'unchanged-owner', streams: [{ state: { binding: 'retained' } }],
  receipts: [{ operation: 'unchanged-operation' }], checkpoints });
const roundtrip = doc => {
  const wire = JSON.parse(JSON.stringify(encodeRollingHistory(doc))), restored = decodeRollingHistory(wire);
  assert.equal(canonical(restored), canonical(doc)); return restored;
};
const bad = patch => ({ schema: ROLLING_HISTORY_CODEC, current: {}, first: [1], changes: [patch] });

test('all historical timestamps and current ownership/receipts reconstruct exactly without aliases', () => {
  const shared = { nested: { value: 7 }, bytes: ['α', '\ud800', true, null] };
  const doc = document(Array.from({ length: 61 }, (_, i) => ({ at: i * 60000,
    streams: [{ version: i + 1, state: { fixed: shared, p: [123.45 + i / 100, -200 + i / 10, i / 1000] } }] })));
  doc.currentShared = shared;
  const restored = roundtrip(doc);
  assert.equal(restored.checkpoints.length, 61);
  restored.checkpoints[60].streams[0].state.fixed.nested.value = 99;
  assert.equal(restored.checkpoints[0].streams[0].state.fixed.nested.value, 7);
  assert.equal(restored.currentShared.nested.value, 7); assert.equal(shared.nested.value, 7);
});

test('exact numeric changes preserve exponent transitions, subnormals, extremes and canonical zero', () => {
  const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-300, 0.1, 0.30000000000000004,
    1.23, 1.2, 1.21, -1.21, -1.2, 123456789.99, 123456790, 1e21, Number.MAX_VALUE, -Number.MAX_VALUE];
  for (const a of values) for (const b of values) roundtrip(document([{ at: 1, number: a }, { at: 2, number: b }]));
});

test('keyed arrays preserve changes, insertion, deletion and arbitrary order with exact IDs', () => {
  roundtrip(document([
    { at: 1, rows: [{ id: 'a', p: [1.2, 3.4] }, { id: 'b', p: [-5, 2] }, { id: 7, value: true }] },
    { at: 2, rows: [{ id: 7, value: false }, { id: 'c', p: [0, 0] }, { id: 'a', p: [1.21, 3.3] }] },
    { at: 3, rows: [] },
    { at: 4, rows: [{ id: 'b', p: [2, 3] }] },
  ]));
});

test('prototype-like property names remain ordinary own JSON properties', () => {
  const a = JSON.parse('{"__proto__":{"polluted":false},"constructor":{"prototype":{"x":1}}}');
  const b = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":2}},"toString":"value"}');
  const decoded = roundtrip(document([{ at: 1, value: a }, { at: 2, value: b }]));
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(decoded.checkpoints[1].value, '__proto__'), true);
  assert.equal(decoded.checkpoints[1].value.__proto__.polluted, true);
  assert.equal(decoded.checkpoints[0].value.__proto__.polluted, false);
});

test('logical depth remains capped at 64 independently of delta wrapper depth', () => {
  let nested = 0;
  for (let i = 0; i < 59; i++) nested = { nested };
  roundtrip(document([{ value: nested }, { value: { nested } }]));
  for (let i = 0; i < 10; i++) nested = { nested };
  assert.throws(() => encodeRollingHistory(document([{ value: nested }])), { code: 'PAYLOAD_TOO_LARGE' });
});

test('malformed operations reject indexes, duplicate references and oversized numeric operands before allocation', () => {
  for (const patch of [
    [2, 2 ** 32 - 1, []], [2, 2, []], [2, 1, [[-1, [0, 1]]]],
    [2, 1, [[0, [0, 1]], [0, [0, 2]]]], [99], [0], [4, '1', -325],
  ]) assert.throws(() => decodeRollingHistory(bad(patch)), error => ['CORRUPT_DURABLE_STATE', 'PAYLOAD_TOO_LARGE'].includes(error.code));
  for (const patch of [[3, [0, 0], []], [3, [1], []], [3, null, [[2, [0, {}]]]]]) {
    assert.throws(() => decodeRollingHistory({ ...bad(patch), first: [{ id: 'one' }] }), { code: 'CORRUPT_DURABLE_STATE' });
  }
  for (const patch of [[4, '1', -325], [4, '1', 309], [4, '9'.repeat(633)], [4, '1e2'], [4, '+1'], [4, '1', 1]]) {
    assert.throws(() => decodeRollingHistory({ ...bad(patch), first: 1 }), { code: 'CORRUPT_DURABLE_STATE' });
  }
});

test('a compact history cannot amplify beyond the existing aggregate 64MiB logical budget', () => {
  const first = { payload: 'x'.repeat(1200000) };
  const wire = { schema: ROLLING_HISTORY_CODEC, current: {}, first, changes: Array(60).fill(0) };
  assert.throws(() => decodeRollingHistory(wire), { code: 'PAYLOAD_TOO_LARGE' });
});

test('unrelated finite JSON changes and reordered shapes remain exact', () => {
  let n = 37;
  const random = () => (n = (n * 48271) % 2147483647) / 2147483647;
  const value = depth => {
    const r = Math.floor(random() * (depth ? 7 : 5));
    if (r === 0) return null;
    if (r === 1) return random() > 0.5;
    if (r === 2) return random() * (random() > 0.5 ? 1e20 : 1e-20);
    if (r === 3) return Math.round(random() * 100000) / 100;
    if (r === 4) return 'JSON ' + Math.round(random() * 10000) + '\n\u00e9';
    if (r === 5) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth - 1));
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 5) }, (_, i) => ['key-' + i, value(depth - 1)]));
  };
  for (let i = 0; i < 100; i++) roundtrip(document(Array.from({ length: 5 }, (_, at) => ({ at, value: value(3) }))));
});
