// Pure storage transforms; this module never receives SDK keys or performs I/O.
import { gunzipSync, brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';
import { InteregoGamingStore, DurableStoreError } from './interego-store.js';
import { encodeRollingHistory, decodeRollingHistory } from './rolling-history-codec.js';
export const ROLLING_TYPE = 'application/vnd.interego.rolling-checkpoint-delta-v1+br';
export const ROLLING_LEGACY_TYPE = 'application/vnd.interego.rolling-checkpoint+gzip';
const TYPE=ROLLING_TYPE, LEGACY_TYPE=ROLLING_LEGACY_TYPE;
const SCHEMA='urn:hallowmarch:multiplayer-rolling-hour:v1';
const MULTIPLAYER_HISTORY_MS=3600000, MULTIPLAYER_WRITE_BYTES=64*1024*1024;
const MAX_JSON=64*1024*1024, MAX_COMPRESSED=384*1024, MAX_RECEIPTS=16384, MAX_STREAMS=16384;
const BROTLI_WINDOW_BITS=22, WIRE_DEPTH=264;
const error=(message,code='CORRUPT_DURABLE_STATE',status=503)=>{throw new DurableStoreError(message,code,status)};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function canonical(x, depth = 0, maximumDepth = 64) {
  if (depth > maximumDepth) error('Multiplayer snapshot nesting exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413);
  if (x === null || typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x);
  if (typeof x === 'number' && Number.isFinite(x)) return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + Array.from(x, v => canonical(v, depth + 1, maximumDepth)).join(',') + ']';
  if (plain(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k], depth + 1, maximumDepth)).join(',') + '}';
  error('Multiplayer state must be finite JSON.', 'INVALID_INPUT', 400);
}

function boundedBrotli(bytes) {
  if (!bytes.length) error('Empty compressed multiplayer checkpoint.');
  // RFC 7932 section 9.1: inspect WBITS before a decoder allocates its window.
  // The reserved 0010001 code also rejects the large-window extension.
  const first = bytes[0], short = (first >> 1) & 7, extended = (first >> 4) & 7;
  const bits = !(first & 1) ? 16 : short ? 17 + short : extended === 0 ? 17 : extended === 1 ? 0 : 8 + extended;
  if (bits < 10 || bits > BROTLI_WINDOW_BITS) error('Compressed multiplayer window exceeds capacity.');
  return brotliDecompressSync(bytes, { maxOutputLength: MAX_JSON,
    params: { [zlibConstants.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 0 } });
}


function validator(configuration) {
  const {owner,namespace,resourceUrl,now,maxStateBytes,maxEventBytes}=configuration;
  if(typeof owner!=='string'||typeof namespace!=='string'||typeof resourceUrl!=='string'
    || !Number.isSafeInteger(now)||now<0
    || ![maxStateBytes,maxEventBytes].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024*1024)) error('Invalid rolling worker context.');
  return Object.assign(Object.create(InteregoGamingStore.prototype),{owner,namespace,resourceUrl,maxStateBytes,maxEventBytes,now:()=>now});
}
export function validateRollingDocument(doc, configuration) {
    const context = validator(configuration);
    const now = context.now();
    if (!plain(doc) || doc.schema !== SCHEMA || doc.owner !== context.owner || doc.namespace !== context.namespace
      || doc.resourceUrl !== context.resourceUrl || doc.retentionMs !== MULTIPLAYER_HISTORY_MS
      || !Number.isSafeInteger(doc.writtenAt) || doc.writtenAt < 0 || doc.writtenAt > now
      || !Array.isArray(doc.streams) || doc.streams.length > MAX_STREAMS || !Array.isArray(doc.checkpoints) || doc.checkpoints.length > 61
      || !Array.isArray(doc.receipts) || doc.receipts.length > MAX_RECEIPTS
      || !Array.isArray(doc.writeBudget) || doc.writeBudget.length > 61) error('Invalid multiplayer checkpoint ownership, window or clock.');
    let budgetMinute = -1, budgetBytes = 0;
    for (const bucket of doc.writeBudget) {
      if (!plain(bucket) || !Number.isSafeInteger(bucket.minute) || bucket.minute <= budgetMinute
        || bucket.minute > Math.floor(doc.writtenAt / 60000) || !Number.isSafeInteger(bucket.bytes) || bucket.bytes < 1) error('Invalid multiplayer write budget.');
      budgetMinute = bucket.minute; budgetBytes += bucket.bytes;
    }
    if (budgetBytes > MULTIPLAYER_WRITE_BYTES) error('Multiplayer write budget exceeded.');
    const records = entries => {
      if (!Array.isArray(entries) || entries.length > MAX_STREAMS) error('Invalid multiplayer checkpoint records.');
      const seen = new Set();
      for (const r of entries) {
        if (!plain(r) || seen.has(r.streamId)) error('Duplicate multiplayer stream.');
        context.keys(r.streamId); context.streamRecord(r, r.streamId); seen.add(r.streamId);
      }
    };
    records(doc.streams);
    let prior = -1;
    for (const p of doc.checkpoints) {
      if (!plain(p) || !Number.isSafeInteger(p.at) || p.at <= prior || p.at > doc.writtenAt) error('Invalid checkpoint chronology.');
      records(p.streams); prior = p.at;
    }
    const ids = new Set(); prior = -1;
    for (const r of doc.receipts) {
      if (!plain(r) || !/^gaming-v1-[a-f0-9]{64}$/.test(r.operationId) || ids.has(r.operationId) || !/^[a-f0-9]{64}$/.test(r.inputDigest)
        || !Number.isSafeInteger(r.at) || r.at < prior || r.at > doc.writtenAt || !Number.isSafeInteger(r.version) || r.version < 1
        || typeof r.streamId !== 'string' || (Object.hasOwn(r, 'rollbackTargetAt')
          && (!Number.isSafeInteger(r.rollbackTargetAt) || r.rollbackTargetAt < 0 || r.rollbackTargetAt > r.at))) error('Invalid retained operation receipt.');
      context.keys(r.streamId);
      ids.add(r.operationId); prior = r.at;
    }
    return doc;
  }

function compress(wire, measured) {
  const bytes=Buffer.from(canonical(wire,0,WIRE_DEPTH));
  Object.assign(measured,{wireBytes:bytes.length,phase:'document-wire-limit'});
  if(bytes.length>MAX_JSON) error('Encoded rollback window exceeds its uncompressed budget.','PAYLOAD_TOO_LARGE',413);
  const compressed=brotliCompressSync(bytes,{params:{
    [zlibConstants.BROTLI_PARAM_QUALITY]:6,[zlibConstants.BROTLI_PARAM_LGWIN]:BROTLI_WINDOW_BITS}});
  Object.assign(measured,{compressedBytes:compressed.length,phase:'document-compressed-limit'});
  if(compressed.length>MAX_COMPRESSED) error('Rollback window exceeds its compressed storage budget.','PAYLOAD_TOO_LARGE',413);
  measured.phase='native-byte-artifact';
  return compressed;
}
export function encodeRollingDocument(doc,configuration) {
  const measured={phase:'document-json',streams:doc.streams?.length,checkpoints:doc.checkpoints?.length,
    receipts:doc.receipts?.length,writeBudgetBuckets:doc.writeBudget?.length,
    bindings:doc.streams?.find(row=>row.streamId==='player-bindings-v1')?.state?.bindings?.length??0};
  try {
    validateRollingDocument(doc,configuration);
    const raw=Buffer.from(canonical(doc));
    Object.assign(measured,{rawBytes:raw.length,phase:'document-raw-limit'});
    if(raw.length>MAX_JSON) error('Rollback window exceeds its uncompressed budget.','PAYLOAD_TOO_LARGE',413);
    const wire=encodeRollingHistory(doc),compressed=compress(wire,measured);
    return {wire,compressed,measured};
  } catch(e) { e.measured=measured; throw e; }
}
export function finishRollingDocument(wire,writeBudget,configuration,priorMeasured) {
  const measured={...priorMeasured};
  try {
    // Phase B changes only this operation's reservation. Reconstruct and
    // validate the complete document before returning final storage bytes.
    const doc=decodeRollingHistory(wire);
    doc.writeBudget=writeBudget;validateRollingDocument(doc,configuration);
    wire.current.writeBudget=writeBudget;
    measured.writeBudgetBuckets=writeBudget.length;
    const raw=Buffer.from(canonical(doc));
    measured.rawBytes=raw.length;
    if(raw.length>MAX_JSON) error('Rollback window exceeds its uncompressed budget.','PAYLOAD_TOO_LARGE',413);
    return {compressed:compress(wire,measured),measured};
  } catch(e) { e.measured=measured;throw e; }
}
export function decodeRollingDocument(bytes,contentType,configuration) {
  if(![TYPE,LEGACY_TYPE].includes(contentType)) error('Multiplayer artifact type changed.');
  if(bytes.length>MAX_COMPRESSED) error('Multiplayer artifact exceeds its compressed storage budget.','PAYLOAD_TOO_LARGE',413);
  let doc;
  try {
    doc=contentType===LEGACY_TYPE?JSON.parse(gunzipSync(bytes,{maxOutputLength:MAX_JSON}).toString('utf8'))
      :decodeRollingHistory(JSON.parse(boundedBrotli(bytes).toString('utf8')));
  } catch { error('Multiplayer rollback window cannot be decoded.'); }
  return validateRollingDocument(doc,configuration);
}
