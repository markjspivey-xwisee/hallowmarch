import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { encodeRollingHistoryColumns, decodeRollingHistoryColumns, ROLLING_COLUMNS_CODEC } from './rolling-history-columns.js';
import { encodeRollingHistory, decodeRollingHistory } from './rolling-history-codec.js';

const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const document = checkpoints => ({ schema: 'logical-document', owner: 'unchanged-owner',
  streams: [{ state: { binding: 'retained' } }], receipts: [{ operation: 'unchanged-operation' }], checkpoints });
function roundtrip(doc) {
  const wire = JSON.parse(JSON.stringify(encodeRollingHistoryColumns(doc))), restored = decodeRollingHistoryColumns(wire);
  assert.equal(hash(restored), hash(doc)); return { wire, restored };
}
const wire = (columns, count = 2, current = {}) => ({ schema: ROLLING_COLUMNS_CODEC, current, count, columns });
const refused = value => assert.throws(() => decodeRollingHistoryColumns(value),
  error => ['CORRUPT_DURABLE_STATE', 'PAYLOAD_TOO_LARGE'].includes(error.code));
const hasNumeric = value => Array.isArray(value) ? value[0] === 'n' || value.some(hasNumeric)
  : value !== null && typeof value === 'object' && Object.values(value).some(hasNumeric);

test('0, 1, 60 and 61 histories retain all timestamps, current bindings and receipts without aliases', () => {
  for (const count of [0, 1, 60, 61]) {
    const shared = { nested: { value: 7 }, text: ['α', '\ud800', true, null] };
    const doc = document(Array.from({ length: count }, (_, i) => ({ at: i * 60000,
      streams: [{ version: i + 1, state: { fixed: shared, p: [123.45 + i / 100, -200 + i / 10] } }] })));
    doc.shared = shared;
    const { restored } = roundtrip(doc);
    assert.equal(restored.checkpoints.length, count);
    if (count > 1) {
      restored.checkpoints.at(-1).streams[0].state.fixed.nested.value = 99;
      assert.equal(restored.checkpoints[0].streams[0].state.fixed.nested.value, 7);
      assert.equal(restored.shared.nested.value, 7); assert.equal(shared.nested.value, 7);
    }
  }
  assert.throws(() => encodeRollingHistoryColumns(document(Array(62).fill({ at: 0 }))));
  refused(wire(['s', null], 62));
});

test('exact numeric series preserve exponent changes, subnormals, extremes and canonical zero', () => {
  const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-308, -1e-308, 0.1, 0.30000000000000004,
    1.23, 1.2, 1.21, -1.21, 123456789.99, 1e21, Number.MAX_VALUE, -Number.MAX_VALUE];
  for (const a of values) for (const b of values) roundtrip(document([{ at: 1, value: a }, { at: 2, value: b }]));
  const mixed = Array.from({ length: 61 }, (_, i) => ({ at: i, value: i === 30 ? Number.MIN_VALUE : i === 45 ? -Number.MAX_VALUE : Number.MAX_VALUE }));
  const result = roundtrip(document(mixed));
  assert(hasNumeric(result.wire.columns), 'mixed extremes exercise numeric columns rather than only literal fallback');
  const max = 17976931348623157n * 10n ** 616n;
  const explicit = decodeRollingHistoryColumns(wire(['n', -324, max.toString(), [(5n - max).toString()]]));
  assert.equal(explicit.checkpoints[0], Number.MAX_VALUE); assert.equal(explicit.checkpoints[1], Number.MIN_VALUE);
  const signed = decodeRollingHistoryColumns(wire(['n', -324, (-max).toString(), [(2n * max).toString()]]));
  assert.equal(signed.checkpoints[0], -Number.MAX_VALUE); assert.equal(signed.checkpoints[1], Number.MAX_VALUE);
  const zero = roundtrip(document([-0, 0])).restored.checkpoints;
  assert.equal(Object.is(zero[0], -0), false);
});

test('heterogeneous and reordered arrays, missing object keys and prototype names stay ordinary JSON', () => {
  const a = JSON.parse('{"__proto__":{"polluted":false},"constructor":{"prototype":{"x":1}}}');
  const b = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":2}},"toString":"value"}');
  const doc = document([
    { at: 1, rows: [{ id: 'a', p: [1, 2] }, { id: 'b', optional: true }], value: a },
    { at: 2, rows: [{ id: 'b', buffs: [{ kind: 'slow' }] }, false, { id: 'a', p: [1.1] }], value: b },
    { at: 3, rows: [], value: null },
    { at: 4, rows: ['changed', { id: 'a', p: [2, 3, 4], optional: false }], value: a },
  ]);
  const { restored } = roundtrip(doc);
  assert.equal(Object.prototype.polluted, undefined);
  assert(Object.hasOwn(restored.checkpoints[1].value, '__proto__'));
  restored.checkpoints[0].value.__proto__.polluted = 'changed';
  assert.equal(restored.checkpoints[3].value.__proto__.polluted, false);
});

test('logical depth 64 survives deeper wire tags and depth 65 is refused', () => {
  const nested = (value, levels) => { for (let i = 0; i < levels; i++) value = { nested: value }; return value; };
  roundtrip(document([{ value: nested(1, 61) }, { value: nested(2, 61) }]));
  assert.throws(() => encodeRollingHistoryColumns(document([{ value: nested(1, 62) }])), { code: 'PAYLOAD_TOO_LARGE' });
  const shared = nested(0, 61);
  refused(wire(['o', ['value'], [null], [['o', ['nested'], [null], [['s', shared]]]]]));
});

test('malformed tags, memberships, widths and numeric operands reject before expansion', () => {
  for (const node of [
    ['unknown'], ['s'], ['s', 0, 'extra'], ['v', [1]], ['a', [0, 1], []], ['a', [2 ** 32 - 1, 0], []],
    ['a', [-1, 0], []], ['a', [0.5, 0], []], ['o', ['x', 'x'], [null, null], [['s', 1], ['s', 2]]],
    ['o', ['z', 'a'], [null, null], [['s', 1], ['s', 2]]], ['o', ['x'], [[]], [['s', 1]]],
    ['o', ['x'], [[1, 1]], [['s', 1]]], ['o', ['x'], [[2]], [['s', 1]]],
    ['o', ['x'], [[1, 0]], [['s', 1]]], ['o', ['x'], [null], []],
    ['n', -325, 0, [0]], ['n', 309, 0, [0]], ['n', 0, '01', [0]], ['n', 0, '+1', [0]],
    ['n', 0, 1.5, [0]], ['n', 0, Number.MAX_SAFE_INTEGER + 1, [0]], ['n', 0, 1, []],
    ['n', 0, 1, ['9'.repeat(634)]], ['n', -324, 1, [0]], ['n', 308, 1, [1]], ['n', 0, 0, ['1e2']],
  ]) refused(wire(node));
  refused({ ...wire(['s', 0]), unexpected: true });
  refused({ ...wire(null, 0), current: { checkpoints: [] } });
  refused(wire(['s', 0], -1)); refused(wire(['s', 0], 0)); refused(wire(null, 1));
});

test('the complete 64MiB expansion preflight runs before even an earlier valid subtree is copied', () => {
  const bomb = wire(['o', ['early', 'late'], [null, null],
    [['s', { safe: true }], ['s', { payload: 'x'.repeat(1200000) }]]], 61);
  const original = JSON.parse; let copies = 0;
  JSON.parse = (...args) => { copies++; return original(...args); };
  try { assert.throws(() => decodeRollingHistoryColumns(bomb), { code: 'PAYLOAD_TOO_LARGE' }); assert.equal(copies, 0); }
  finally { JSON.parse = original; }
});

test('arbitrary finite JSON shape changes remain exact', () => {
  let n = 37;
  const random = () => (n = n * 48271 % 2147483647) / 2147483647;
  const value = depth => {
    const kind = Math.floor(random() * (depth ? 7 : 5));
    if (kind === 0) return null;
    if (kind === 1) return random() > 0.5;
    if (kind === 2) return random() * (random() > 0.5 ? 1e20 : 1e-20);
    if (kind === 3) return Math.round(random() * 100000) / 100;
    if (kind === 4) return 'JSON ' + Math.round(random() * 10000) + '\n\u00e9';
    if (kind === 5) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth - 1));
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 5) }, (_, i) => ['key-' + i, value(depth - 1)]));
  };
  for (let i = 0; i < 100; i++) roundtrip(document(Array.from({ length: 5 }, (_, at) => ({ at, value: value(3) }))));
});

test('fc17 delta-v1 keeps its distinct exact reader contract', () => {
  const doc = document([{ at: 1, rows: [{ id: 'one', p: [1.23, 2] }] }, { at: 2, rows: [{ id: 'one', p: [1.24] }] }]);
  const legacy = JSON.parse(JSON.stringify(encodeRollingHistory(doc)));
  assert.equal(hash(decodeRollingHistory(legacy)), hash(doc));
  assert.throws(() => decodeRollingHistoryColumns(legacy), { code: 'CORRUPT_DURABLE_STATE' });
});

test('authored full moving and churning hours retain every value within the unchanged compressed ceiling', async t => {
  const { realisticRollingWindow } = await import('./rolling-history-scale-fixture.mjs');
  const { realisticChurningRollingWindow } = await import('./rolling-history-churn-fixture.mjs');
  for (const [name, make] of [['moving', realisticRollingWindow], ['churn', realisticChurningRollingWindow]]) {
    const doc = make(), began = performance.now(), { wire: encoded, restored } = roundtrip(doc);
    const compressed = brotliCompressSync(Buffer.from(canonical(encoded)), { params: {
      [constants.BROTLI_PARAM_QUALITY]: 6, [constants.BROTLI_PARAM_LGWIN]: 22 } });
    assert.equal(restored.checkpoints.length, 61);
    assert(restored.checkpoints.every(point => point.streams[0].state.value.worlds.march.activity.entities.rows.length === 523));
    assert.equal(restored.streams.find(row => row.streamId === 'player-bindings-v1').state.bindings.length, 500);
    assert(compressed.length <= 384 * 1024);
    t.diagnostic(JSON.stringify({ proof: 'bounded-columns-' + name, snapshots: 61, bindings: 500,
      rawBytes: Buffer.byteLength(canonical(doc)), wireBytes: Buffer.byteLength(canonical(encoded)),
      compressedBytes: compressed.length, roundtripMs: Math.round(performance.now() - began), exact: true }));
  }
});

test('actual native SDK preserves 122 checkpoint reservations plus admission headroom for moving and churning hours',
  { skip: !process.env.INTEREGO_SDK_TEST_ROOT }, async t => {
    const root = process.env.INTEREGO_SDK_TEST_ROOT;
    const [native, core] = await Promise.all(['pgsl', 'core'].map(name => import(pathToFileURL(root + '/packages/' + name + '/dist/index.js').href)));
    const { realisticRollingWindow } = await import('./rolling-history-scale-fixture.mjs');
    const { realisticChurningRollingWindow } = await import('./rolling-history-churn-fixture.mjs');
    const owner = 'urn:columns:actual-sdk', keys = core.deriveEncryptionKeyPair('a'.repeat(64), owner);
    const scope = { pod: 'https://capacity.example/game/', owner, headUrl: 'https://capacity.example/game/gaming/head',
      artifactContainer: 'https://capacity.example/game/gaming/artifacts/' };
    const client = new native.NativeCommitStore({ scope, senderKeyPair: keys, ownerPublicKey: keys.publicKey,
      recipientPublicKeys: [keys.publicKey], atomicCheckpoint: true, fetch: async () => { throw Error('Sizing must not perform I/O'); } });
    for (const [name, make] of [['moving', realisticRollingWindow], ['churn', realisticChurningRollingWindow]]) {
      const doc = make({ owner, resourceUrl: scope.headUrl }), { wire: encoded } = roundtrip(doc);
      const compressed = brotliCompressSync(Buffer.from(canonical(encoded)), { params: {
        [constants.BROTLI_PARAM_QUALITY]: 6, [constants.BROTLI_PARAM_LGWIN]: 22 } });
      const artifact = native.createNativeByteArtifact({ owner, contentType: 'application/vnd.interego.rolling-checkpoint-delta-v1+br', bytes: compressed });
      const exact = client.atomicCheckpointSize(artifact), reserved = Math.ceil((exact + 4096) / 4096) * 4096;
      assert(exact <= 1024 * 1024); assert(reserved * 128 <= 64 * 1024 * 1024,
        '122 boundary-inclusive regular writes retain six full-size admission reservations');
      t.diagnostic(JSON.stringify({ proof: 'actual-sdk-columns-' + name, compressedBytes: compressed.length,
        encryptedEstimateBytes: exact, reservedBytes: reserved, regular122Bytes: reserved * 122,
        withSixAdmissions128Bytes: reserved * 128, budgetBytes: 64 * 1024 * 1024 }));
    }
  });
