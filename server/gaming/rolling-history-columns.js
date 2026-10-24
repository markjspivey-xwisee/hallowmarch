/** Lossless temporal columns for bounded native rolling checkpoints.
 * Historical JSON alone is transformed. Ownership, clocks, versions, receipts
 * and every logical JSON value retain their existing schema and precision. */
export const ROLLING_COLUMNS_CODEC = 'urn:hallowmarch:rolling-history-columns:v1';
export const ROLLING_COLUMNS_MAX_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 64, MAX_WIRE_DEPTH = 264, MAX_HISTORY = 61;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const copy = value => JSON.parse(JSON.stringify(value));
function fail(capacity = false) {
  throw Object.assign(new Error(capacity ? 'Rolling columns exceed their bounded representation.' : 'Invalid rolling column representation.'),
    { code: capacity ? 'PAYLOAD_TOO_LARGE' : 'CORRUPT_DURABLE_STATE', status: capacity ? 413 : 503 });
}
function context() { return { sizes: new WeakMap(), powers: new Map([[0, 1n]]) }; }
/** Cached subtrees still count for every occurrence, including their depth. */
function shape(value, ctx, depth = 0, maximumDepth = MAX_DEPTH, active = new Set()) {
  if (depth > maximumDepth) fail(true);
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return { bytes: Buffer.byteLength(JSON.stringify(value)), height: 0 };
  if (!Array.isArray(value) && !plain(value) || active.has(value)) fail();
  const cached = ctx.sizes.get(value);
  if (cached) { if (depth + cached.height > maximumDepth) fail(true); return cached; }
  active.add(value);
  let bytes = 2, height = 0, n = 0;
  try {
    for (const key of Array.isArray(value) ? value.keys() : Object.keys(value)) {
      if (!own(value, key)) fail();
      const child = shape(value[key], ctx, depth + 1, maximumDepth, active);
      bytes += (n++ ? 1 : 0) + child.bytes + (Array.isArray(value) ? 0 : Buffer.byteLength(JSON.stringify(key)) + 1);
      height = Math.max(height, child.height + 1);
      if (bytes > ROLLING_COLUMNS_MAX_BYTES) fail(true);
    }
  } finally { active.delete(value); }
  const result = { bytes, height }; ctx.sizes.set(value, result); return result;
}
function decimal(value) {
  const [coefficient, exponent = '0'] = JSON.stringify(value).toLowerCase().split('e');
  const point = coefficient.indexOf('.');
  return { n: BigInt(coefficient.replace('.', '')), e: Number(exponent) - (point < 0 ? 0 : coefficient.length - point - 1) };
}
function power(ctx, exponent) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 632) fail();
  if (!ctx.powers.has(exponent)) ctx.powers.set(exponent, 10n ** BigInt(exponent));
  return ctx.powers.get(exponent);
}
const compact = value => value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
function integer(value) {
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail(); return BigInt(value); }
  // A finite double at common exponent -324 can require 633 decimal digits.
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]{0,632})$/.test(value)) fail();
  return BigInt(value);
}
function seriesNumber(value, exponent, ctx) {
  const result = Number(value.toString() + 'e' + exponent);
  if (!Number.isFinite(result)) fail();
  const exact = decimal(result);
  if (exact.e < exponent || exact.n * power(ctx, exact.e - exponent) !== value) fail();
  return result;
}
function numeric(values, ctx) {
  const parts = values.map(decimal), exponent = Math.min(...parts.map(value => value.e));
  const coefficients = parts.map(value => value.n * power(ctx, value.e - exponent));
  const node = ['n', exponent, compact(coefficients[0]), coefficients.slice(1).map((value, i) => compact(value - coefficients[i]))];
  // Reconstruct exact JSON decimals, without another floating-point rounding.
  for (let i = 0; i < values.length; i++) if (JSON.stringify(seriesNumber(coefficients[i], exponent, ctx)) !== JSON.stringify(values[i])) return ['v', values];
  return Buffer.byteLength(JSON.stringify(node)) < Buffer.byteLength(JSON.stringify(['v', values])) * 4 ? node : ['v', values];
}
function columns(values, ctx) {
  const first = values[0];
  if (values.every(value => value === first)) return ['s', first];
  if (values.every(value => typeof value === 'number' && Number.isFinite(value))) return numeric(values, ctx);
  if (values.every(Array.isArray)) {
    const lengths = values.map(value => value.length), width = Math.max(...lengths);
    const children = Array.from({ length: width }, (_, i) => columns(values.filter(value => value.length > i).map(value => value[i]), ctx));
    return lengths.every(length => length === lengths[0]) && children.every(child => child[0] === 's')
      ? ['s', first] : ['a', lengths, children];
  }
  if (values.every(plain)) {
    const keys = [...new Set(values.flatMap(value => Object.keys(value)))].sort(), members = [], children = [];
    for (const key of keys) {
      const present = values.flatMap((value, i) => own(value, key) ? [i] : []);
      members.push(present.length === values.length ? null : present);
      children.push(columns(present.map(i => values[i][key]), ctx));
    }
    return members.every(value => value === null) && children.every(child => child[0] === 's')
      ? ['s', first] : ['o', keys, members, children];
  }
  return ['v', values];
}
function numericValues(node, count, ctx, visit) {
  if (node.length !== 4 || !Number.isInteger(node[1]) || node[1] < -324 || node[1] > 308
    || !Array.isArray(node[3]) || node[3].length !== count - 1) fail();
  let coefficient = integer(node[2]);
  visit(seriesNumber(coefficient, node[1], ctx));
  for (const difference of node[3]) {
    coefficient += integer(difference);
    if (coefficient.toString().replace('-', '').length > 633) fail();
    visit(seriesNumber(coefficient, node[1], ctx));
  }
}
function arrayNode(node, count) {
  const lengths = node[1], children = node[2];
  if (node.length !== 3 || !Array.isArray(lengths) || lengths.length !== count
    || lengths.some(length => !Number.isSafeInteger(length) || length < 0 || length > Math.floor((ROLLING_COLUMNS_MAX_BYTES - 1) / 2))
    || !Array.isArray(children) || children.length !== Math.max(...lengths)) fail();
  return { lengths, children };
}
function objectNode(node, count) {
  const keys = node[1], members = node[2], children = node[3];
  if (node.length !== 4 || !Array.isArray(keys) || !Array.isArray(members) || !Array.isArray(children)
    || keys.length !== members.length || keys.length !== children.length
    || keys.some((key, i) => typeof key !== 'string' || i > 0 && key <= keys[i - 1])) fail();
  for (const present of members) if (present !== null && (!Array.isArray(present) || !present.length || present.length > count
    || present.some((row, i) => !Number.isSafeInteger(row) || row < 0 || row >= count || i > 0 && row <= present[i - 1]))) fail();
  return { keys, members, children };
}
function presentCount(lengths, index) { let count = 0; for (const length of lengths) if (length > index) count++; return count; }
/** Preflight the entire logical expansion before allocating any snapshots. */
function scan(node, count, depth, ctx, charge) {
  if (depth > MAX_DEPTH) fail(true);
  if (!Number.isInteger(count) || count < 1 || count > MAX_HISTORY || !Array.isArray(node)) fail();
  if (node[0] === 's') {
    if (node.length !== 2) fail();
    charge(shape(node[1], ctx, depth).bytes * count); return;
  }
  if (node[0] === 'v') {
    if (node.length !== 2 || !Array.isArray(node[1]) || node[1].length !== count) fail();
    for (const value of node[1]) charge(shape(value, ctx, depth).bytes);
    return;
  }
  if (node[0] === 'n') {
    numericValues(node, count, ctx, value => charge(Buffer.byteLength(JSON.stringify(value)))); return;
  }
  if (node[0] === 'a') {
    const { lengths, children } = arrayNode(node, count);
    charge(lengths.reduce((sum, length) => sum + 2 + Math.max(0, length - 1), 0));
    for (let i = 0; i < children.length; i++) scan(children[i], presentCount(lengths, i), depth + 1, ctx, charge);
    return;
  }
  if (node[0] === 'o') {
    const { keys, members, children } = objectNode(node, count), widths = Array(count).fill(0);
    for (let i = 0; i < keys.length; i++) {
      const size = members[i] === null ? count : members[i].length;
      charge(size * (Buffer.byteLength(JSON.stringify(keys[i])) + 1));
      if (members[i] === null) for (let row = 0; row < count; row++) widths[row]++;
      else for (const row of members[i]) widths[row]++;
    }
    charge(widths.reduce((sum, length) => sum + 2 + Math.max(0, length - 1), 0));
    for (let i = 0; i < children.length; i++) scan(children[i], members[i] === null ? count : members[i].length, depth + 1, ctx, charge);
    return;
  }
  fail();
}
function build(node, count, ctx) {
  if (node[0] === 's') return Array.from({ length: count }, () => copy(node[1]));
  if (node[0] === 'v') return node[1].map(copy);
  if (node[0] === 'n') { const values = []; numericValues(node, count, ctx, value => values.push(value)); return values; }
  if (node[0] === 'a') {
    const rows = Array.from({ length: count }, () => []), lengths = node[1], children = node[2];
    for (let i = 0; i < children.length; i++) {
      const values = build(children[i], presentCount(lengths, i), ctx); let index = 0;
      for (let row = 0; row < count; row++) if (lengths[row] > i) rows[row].push(values[index++]);
    }
    return rows;
  }
  const rows = Array.from({ length: count }, () => ({})), keys = node[1], members = node[2], children = node[3];
  for (let i = 0; i < keys.length; i++) {
    const values = build(children[i], members[i] === null ? count : members[i].length, ctx);
    if (members[i] === null) for (let row = 0; row < count; row++) Object.defineProperty(rows[row], keys[i],
      { value: values[row], enumerable: true, writable: true, configurable: true });
    else for (let index = 0; index < members[i].length; index++) Object.defineProperty(rows[members[i][index]], keys[i],
      { value: values[index], enumerable: true, writable: true, configurable: true });
  }
  return rows;
}
export function encodeRollingHistoryColumns(doc) {
  const ctx = context(); shape(doc, ctx);
  if (!plain(doc) || !Array.isArray(doc.checkpoints) || doc.checkpoints.length > MAX_HISTORY) fail();
  const { checkpoints, ...current } = doc;
  const wire = { schema: ROLLING_COLUMNS_CODEC, current, count: checkpoints.length,
    columns: checkpoints.length ? columns(checkpoints, ctx) : null };
  shape(wire, ctx, 0, MAX_WIRE_DEPTH);
  return wire;
}
export function decodeRollingHistoryColumns(wire) {
  if (!plain(wire) || wire.schema !== ROLLING_COLUMNS_CODEC || !plain(wire.current) || own(wire.current, 'checkpoints')
    || Object.keys(wire).length !== 4 || !['schema', 'current', 'count', 'columns'].every(key => own(wire, key))
    || !Number.isSafeInteger(wire.count) || wire.count < 0 || wire.count > MAX_HISTORY
    || wire.count === 0 && wire.columns !== null) fail();
  const ctx = context(); shape(wire, ctx, 0, MAX_WIRE_DEPTH);
  let bytes = shape({ ...wire.current, checkpoints: [] }, ctx).bytes + Math.max(0, wire.count - 1);
  const charge = addition => { bytes += addition; if (!Number.isSafeInteger(bytes) || bytes > ROLLING_COLUMNS_MAX_BYTES) fail(true); };
  charge(0);
  if (wire.count) scan(wire.columns, wire.count, 2, ctx, charge);
  // Every output copy waits for the complete aggregate/depth/column preflight.
  // Current records and separate snapshots receive independent JSON objects.
  return { ...copy(wire.current), checkpoints: wire.count ? build(wire.columns, wire.count, ctx) : [] };
}
