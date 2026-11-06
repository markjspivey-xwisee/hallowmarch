import { ROLLING_COLUMNS_CODEC, decodeRollingHistoryColumns } from './rolling-history-columns.js';
/** Lossless JSON history deltas. The logical ownership/CAS document is unchanged. */
export const ROLLING_HISTORY_CODEC = 'urn:hallowmarch:rolling-history-delta:v1';
export const ROLLING_HISTORY_MAX_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 64, MAX_HISTORY = 61;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const copy = value => JSON.parse(JSON.stringify(value));
function fail(capacity = false) {
  throw Object.assign(new Error(capacity ? 'Rolling history exceeds its bounded representation.' : 'Invalid rolling history representation.'),
    { code: capacity ? 'PAYLOAD_TOO_LARGE' : 'CORRUPT_DURABLE_STATE', status: capacity ? 413 : 503 });
}
function context() { return { sizes: new WeakMap(), powers: new Map([[0, 1n]]) }; }
/** Count the reconstructed JSON bytes before allocation/copying. Cached sizes
 * still count each repeated occurrence, and retain subtree depth for reuse. */
function shape(value, ctx, depth = 0, active = new Set()) {
  if (depth > MAX_DEPTH) fail(true);
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) {
    return { bytes: Buffer.byteLength(JSON.stringify(value)), height: 0 };
  }
  if (!Array.isArray(value) && !plain(value) || active.has(value)) fail();
  const cached = ctx.sizes.get(value);
  if (cached) { if (depth + cached.height > MAX_DEPTH) fail(true); return cached; }
  active.add(value);
  let bytes = 2, height = 0, n = 0;
  try {
    const entries = Array.isArray(value) ? value.keys() : Object.keys(value);
    for (const key of entries) {
      if (!own(value, key)) fail();
      const child = shape(value[key], ctx, depth + 1, active);
      bytes += (n++ ? 1 : 0) + child.bytes + (Array.isArray(value) ? 0 : Buffer.byteLength(JSON.stringify(key)) + 1);
      height = Math.max(height, child.height + 1);
      if (bytes > ROLLING_HISTORY_MAX_BYTES) fail(true);
    }
  } finally { active.delete(value); }
  const measured = { bytes, height }; ctx.sizes.set(value, measured); return measured;
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
function numeric(old, next, ctx) {
  const a = decimal(old), b = decimal(next), exponent = Math.min(a.e, b.e);
  const difference = b.n * power(ctx, b.e - exponent) - a.n * power(ctx, a.e - exponent);
  const delta = exponent === a.e ? [4, difference.toString()] : [4, difference.toString(), exponent];
  // Use the exact JSON decimal, never rounding a float or changing game precision.
  const restored = Number((a.n * power(ctx, a.e - exponent) + difference).toString() + 'e' + exponent);
  return JSON.stringify(restored) === JSON.stringify(next) ? delta : [0, next];
}
function keyed(value) {
  if (!value.length) return null;
  const ids = new Map();
  for (let i = 0; i < value.length; i++) {
    const row = value[i], id = row?.id;
    if (!plain(row) || typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id))) return null;
    const key = typeof id + ':' + JSON.stringify(id);
    if (ids.has(key)) return null;
    ids.set(key, i);
  }
  return ids;
}
function changed(old, next, ctx, depth = 0) {
  if (depth > MAX_DEPTH) fail(true);
  if (old === next) return 0;
  let delta = [0, next];
  if (typeof old === 'number' && Number.isFinite(old) && typeof next === 'number' && Number.isFinite(next)) {
    delta = numeric(old, next, ctx);
  } else if (plain(old) && plain(next)) {
    const removed = Object.keys(old).filter(key => !own(next, key)).sort(), entries = [];
    for (const key of Object.keys(next).sort()) {
      const patch = own(old, key) ? changed(old[key], next[key], ctx, depth + 1) : [0, next[key]];
      if (patch !== 0) entries.push([key, patch]);
    }
    if (!removed.length && !entries.length) return 0;
    delta = [1, removed, entries];
  } else if (Array.isArray(old) && Array.isArray(next)) {
    const before = keyed(old), after = keyed(next);
    if (before && after) {
      const order = [], entries = [];
      for (let i = 0; i < next.length; i++) {
        const index = before.get(typeof next[i].id + ':' + JSON.stringify(next[i].id));
        order.push(index === undefined ? [next[i]] : index);
        if (index !== undefined) {
          const patch = changed(old[index], next[i], ctx, depth + 1);
          if (patch !== 0) entries.push([i, patch]);
        }
      }
      const unchangedOrder = old.length === next.length && order.every((index, i) => index === i);
      if (unchangedOrder && !entries.length) return 0;
      delta = [3, unchangedOrder ? null : order, entries];
    } else {
      const entries = [];
      for (let i = 0; i < next.length; i++) {
        const patch = i < old.length ? changed(old[i], next[i], ctx, depth + 1) : [0, next[i]];
        if (patch !== 0) entries.push([i, patch]);
      }
      if (old.length === next.length && !entries.length) return 0;
      delta = [2, next.length, entries];
    }
  }
  // Repeated path tags compress across the hour even when a small position
  // vector's raw patch is larger than its literal. Keep those exact changes;
  // use literals only for disproportionate replacement overhead.
  return Buffer.byteLength(JSON.stringify(delta)) < (shape(next, ctx).bytes + 4) * 4 ? delta : [0, next];
}
function entries(value, length, run) {
  if (!Array.isArray(value) || value.length > length) fail();
  const used = new Set();
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2 || !Number.isInteger(row[0]) || row[0] < 0 || row[0] >= length || used.has(row[0])) fail();
    used.add(row[0]); run(row[0], row[1]);
  }
  return used;
}
function restore(old, delta, ctx, depth = 0) {
  if (depth > MAX_DEPTH) fail(true);
  if (delta === 0) return old;
  if (!Array.isArray(delta) || !Number.isInteger(delta[0])) fail();
  if (delta[0] === 0) {
    if (delta.length !== 2) fail();
    shape(delta[1], ctx, depth); return delta[1];
  }
  if (delta[0] === 4) {
    if (delta.length < 2 || delta.length > 3 || typeof old !== 'number' || !Number.isFinite(old)
      || typeof delta[1] !== 'string' || !/^-?(?:0|[1-9][0-9]{0,631})$/.test(delta[1])) fail();
    const a = decimal(old), exponent = delta.length === 3 ? delta[2] : a.e;
    if (!Number.isInteger(exponent) || exponent < -324 || exponent > 308 || exponent > a.e) fail();
    const next = Number((a.n * power(ctx, a.e - exponent) + BigInt(delta[1])).toString() + 'e' + exponent);
    if (!Number.isFinite(next)) fail(); return next;
  }
  if (delta[0] === 1) {
    if (delta.length !== 3 || !plain(old) || !Array.isArray(delta[1]) || !Array.isArray(delta[2])) fail();
    const touched = new Set();
    for (const key of delta[1]) {
      if (typeof key !== 'string' || touched.has(key) || !own(old, key)) fail();
      touched.add(key);
    }
    for (const row of delta[2]) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || touched.has(row[0])) fail();
      const [key, patch] = row;
      if (!own(old, key) && !(Array.isArray(patch) && patch[0] === 0)) fail();
      touched.add(key);
    }
    const result = Object.fromEntries(Object.entries(old));
    for (const key of delta[1]) delete result[key];
    for (const [key, patch] of delta[2]) {
      Object.defineProperty(result, key, { value: restore(old[key], patch, ctx, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    shape(result, ctx, depth); return result;
  }
  if (delta[0] === 2) {
    const length = delta[1];
    if (delta.length !== 3 || !Array.isArray(old) || !Number.isInteger(length) || length < 0
      || length > Math.floor((ROLLING_HISTORY_MAX_BYTES - 1) / 2) || !Array.isArray(delta[2])
      || delta[2].length < Math.max(0, length - old.length)) fail();
    // Validate indexes and coverage before an attacker-selected length allocates.
    const positions = entries(delta[2], length, () => {});
    for (let i = old.length; i < length; i++) if (!positions.has(i)) fail();
    const result = old.slice(0, length); result.length = length;
    entries(delta[2], length, (i, patch) => {
      if (i >= old.length && !(Array.isArray(patch) && patch[0] === 0)) fail();
      result[i] = restore(old[i], patch, ctx, depth + 1);
    });
    shape(result, ctx, depth); return result;
  }
  if (delta[0] === 3) {
    if (delta.length !== 3 || !Array.isArray(old) || !keyed(old) || delta[1] !== null && !Array.isArray(delta[1])) fail();
    const order = delta[1], seen = new Set();
    if (order !== null) {
      for (const item of order) {
        if (Number.isInteger(item) && item >= 0 && item < old.length && !seen.has(item)) { seen.add(item); continue; }
        if (Array.isArray(item) && item.length === 1) { shape(item[0], ctx, depth + 1); continue; }
        fail();
      }
    }
    entries(delta[2], order === null ? old.length : order.length, () => {});
    const result = order === null ? old.slice() : order.map(item => Number.isInteger(item) ? old[item] : item[0]);
    entries(delta[2], result.length, (i, patch) => { result[i] = restore(result[i], patch, ctx, depth + 1); });
    if (!keyed(result) && result.length) fail();
    shape(result, ctx, depth); return result;
  }
  fail();
}
/** The explicit envelope is storage-only; native stream versions, state/event
 * digests, operation receipts and the logical document retain their old schema. */
export function encodeRollingHistory(doc) {
  const ctx = context(); shape(doc, ctx);
  if (!plain(doc) || !Array.isArray(doc.checkpoints) || doc.checkpoints.length > MAX_HISTORY) fail();
  const { checkpoints, ...current } = doc;
  return { schema: ROLLING_HISTORY_CODEC, current, first: checkpoints[0] ?? null,
    changes: checkpoints.slice(1).map((next, i) => changed(checkpoints[i], next, ctx)) };
}
export function decodeRollingHistory(wire) {
  if (wire?.schema === ROLLING_COLUMNS_CODEC) return decodeRollingHistoryColumns(wire);
  if (!plain(wire) || wire.schema !== ROLLING_HISTORY_CODEC || !plain(wire.current) || own(wire.current, 'checkpoints')
    || Object.keys(wire).some(key => !['schema', 'current', 'first', 'changes'].includes(key))
    || !Array.isArray(wire.changes) || wire.changes.length >= MAX_HISTORY || wire.first === null && wire.changes.length) fail();
  const ctx = context(); shape(wire.current, ctx);
  const current = copy(wire.current), checkpoints = [];
  let doc = { ...current, checkpoints: [] };
  if (wire.first !== null) {
    shape(wire.first, ctx);
    shape({ ...current, checkpoints: [wire.first] }, ctx);
    // Detach every historical snapshot, including unchanged subtrees. Callers
    // cannot mutate a preceding checkpoint through another snapshot's objects.
    checkpoints.push(copy(wire.first)); doc = { ...current, checkpoints: [...checkpoints] }; shape(doc, ctx);
    for (const patch of wire.changes) {
      const next = restore(checkpoints.at(-1), patch, ctx);
      const candidate = { ...current, checkpoints: [...checkpoints, next] };
      shape(candidate, ctx); // Aggregate expansion bound before copying.
      checkpoints.push(copy(next)); doc = { ...current, checkpoints: [...checkpoints] };
    }
  }
  shape(doc, ctx); return doc;
}
